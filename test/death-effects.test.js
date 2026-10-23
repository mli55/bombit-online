import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the actual upstream Player class without booting the renderer. This
// keeps the death branches and update ordering under test, rather than copying
// a simplified version of them into the fixture.
const source = readFileSync(new URL('../original/bombit-1.min.js', import.meta.url), 'utf8');
const endMarker = 'l.Player=t}';
const end = source.indexOf(endMarker);
const start = source.lastIndexOf('function(l){', end);
assert.ok(start >= 0 && end > start, 'Find the preserved upstream Player definition');
const playerDefinition = source.slice(start, end + endMarker.length);
const explosionEndMarker = 'h.BombExplosion=t}';
const explosionEnd = source.indexOf(explosionEndMarker);
const explosionStart = source.lastIndexOf('function(h){', explosionEnd);
assert.ok(explosionStart >= 0 && explosionEnd > explosionStart, 'Find the preserved upstream BombExplosion definition');
const explosionDefinition = source.slice(explosionStart, explosionEnd + explosionEndMarker.length);
const fixes = readFileSync(new URL('../public/gameplay-fixes.js', import.meta.url), 'utf8');

function fixture({ patched = true, weapon = 'grenade' } = {}) {
  const Game = {
    GAME_STATUS: { PLAYING: 0, GAME_OVER: 1, PAUSED: 2 },
    DIRECTION: { UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3 },
    ITEM_TYPE: { GRENADE: 'grenade' },
    MAP: { FREE: 0, MINE: 1, WALL: 2 },
    SETTINGS: { CELL_WIDTH: 50, CELL_HEIGHT: 50, GRID_WIDTH: 6, GRID_HEIGHT: 6 },
  };
  const context = vm.createContext({
    Game, Phaser: { Group: function Group() {}, Sprite: function Sprite() {} },
    __extends(derived, base) {
      derived.prototype = Object.create(base.prototype);
      derived.prototype.constructor = derived;
    },
  });
  vm.runInContext(`(${playerDefinition})(Game)`, context);
  vm.runInContext(`(${explosionDefinition})(Game)`, context);
  if (patched) vm.runInContext(fixes, context);
  const sprite = () => ({ visible: true, ph2Animations: { play() {}, pause() {} } });
  const firedWeapon = { alive: true };
  const cells = Array.from({ length: 6 }, (_, x) => Array.from({ length: 6 }, (_, y) => ({
    gridPositionX: x, gridPositionY: y, centerX: x * 50, centerY: y * 50,
    cellContains: Game.MAP.FREE, isDangerCell: false, isFreezeCell: false,
    dangerOwner: { playerID: 1 },
  })));
  const player = Object.assign(Object.create(Game.Player.prototype), {
    game: { time: { elapsedMS: 1000 / 60 }, ph2NotificationManager: { postNotification() {} } },
    grid: { cells, mines: [], weapons: [firedWeapon], rowsGroup: cells.map(() => ({ add() {} })) },
    gridCell: cells[1][1], gridPositionX: 1, gridPositionY: 1,
    playerID: 0, lives: 3, dead: false, gameScale: 1,
    gameStatus: Game.GAME_STATUS.PLAYING, initialBlinking: false,
    direction: Game.DIRECTION.DOWN, currentDirection: Game.DIRECTION.DOWN,
    weaponActive: true, weaponCurrentType: weapon, weapons: [firedWeapon, { alive: true }],
    invulnerable: false, invincible: false, shieldActive: false, slowed: false, frozen: false,
    x: 50, y: 50, movingAnimation: false, bombsOnGround: [],
    animationMovement: sprite(), animationDeath: sprite(),
    animationPowerups: sprite(), animationIndicator: sprite(), grenadeIndicator: sprite(),
    inputController: {
      upPressed: true, onlineActionHeld: true,
      clearInputs() { this.upPressed = false; },
    },
    checkItemPickUp() {},
  });
  return { player, Game, firedWeapon };
}

test('upstream death leaves a held weapon icon and grenade target visible', () => {
  const { player } = fixture({ patched: false });
  player.gridCell.isDangerCell = true;
  player.update();
  assert.equal(player.dead, true);
  assert.equal(player.animationPowerups.visible, true);
  assert.equal(player.grenadeIndicator.visible, true);
  player.update();
  assert.equal(player.animationPowerups.visible, true);
  assert.equal(player.grenadeIndicator.visible, true);
});

for (const weapon of ['grenade', 'mine', 'battery', 'rocket', 'freeze', 'fire']) {
  test(`death clears held ${weapon} indicators and input, preserving launched weapons`, () => {
    const { player, firedWeapon } = fixture({ weapon });
    player.gridCell.isDangerCell = true;
    player.update();
    assert.equal(player.dead, true);
    assert.equal(player.lives, 2, 'Original life loss is unchanged');
    assert.equal(player.weaponActive, false);
    for (const key of ['animationPowerups', 'grenadeIndicator', 'animationIndicator']) {
      assert.equal(player[key].visible, false, key);
    }
    assert.equal(player.inputController.upPressed, false);
    assert.equal(player.inputController.onlineActionHeld, false);
    assert.equal(player.grid.weapons[0], firedWeapon);
    assert.equal(firedWeapon.alive, true);
    player.update();
    assert.equal(player.lives, 2, 'Subsequent updates do not repeat death');
    assert.equal(player.animationPowerups.visible, false);
  });
}

test('the separate mine-death path also clears detached indicators', () => {
  const { player, firedWeapon } = fixture();
  player.activateMine(player.gridCell);
  player.update();
  assert.equal(player.dead, true);
  assert.equal(player.lives, 2);
  assert.equal(player.animationPowerups.visible, false);
  assert.equal(player.grenadeIndicator.visible, false);
  assert.equal(player.grid.weapons[0], firedWeapon);
  assert.equal(firedWeapon.alive, true);
});

test('living players retain their held weapon, indicators, and input', () => {
  const { player } = fixture();
  player.update();
  assert.equal(player.dead, false);
  assert.equal(player.weaponActive, true);
  assert.equal(player.animationPowerups.visible, true);
  assert.equal(player.grenadeIndicator.visible, true);
  assert.equal(player.inputController.upPressed, true);
  assert.equal(player.inputController.onlineActionHeld, true);
});
