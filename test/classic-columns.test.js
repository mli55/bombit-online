import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/classic-weapons.js', import.meta.url), 'utf8');
const flashFrameMs = 1000 / 35, frameMs = 1000 / 60;

function fixture(weaponType) {
  const proto = () => function () {};
  const Game = {
    DIRECTION: { ALL: 0, UP: 1, LEFT: 4, RIGHT: 5, DOWN: 8 },
    MAP: { FREE: 0, WALL: 1, BLOCK: 3, BOMB: 4, MINE: 7 },
    ITEM_TYPE: { FIRE: 'fire', FREEZE: 'freeze', BATTERY: 'battery', MINE: 'mine' },
    GAME_STATUS: { PLAYING: 0, PAUSED: 1 },
    SETTINGS: { CELL_WIDTH: 49, SCALE: 1 },
  };
  for (const name of ['Box', 'Player', 'Mine', 'Grenade', 'Rocket', 'Columns', 'Weapon', 'Grid', 'WeaponExplosion']) Game[name] = proto();
  Game.Weapon.prototype.useWeapon = () => {};
  Game.Grid.prototype.update = () => {};
  vm.runInContext(source, vm.createContext({ Game }));

  const game = {
    time: { elapsedMS: frameMs },
    add: { ph2AnimationObject: () => {
      const sprite = { visible: true, played: [] };
      sprite.ph2Animations = { play: name => sprite.played.push(name) };
      return sprite;
    } },
    ph2AudioManager: { playEffect() {} },
    ph2NotificationManager: { postNotification() {} },
  };
  const cells = Array.from({ length: 15 }, (_, x) => Array.from({ length: 13 }, (_, y) =>
    ({ gridPositionX: x, gridPositionY: y, centerX: x * 49, centerY: y * 49, cellContains: Game.MAP.FREE })));
  const grid = Object.assign(Object.create(Game.Grid.prototype), {
    game, cells, gameStatus: Game.GAME_STATUS.PLAYING, boxes: [], bombs: [], players: [],
    bombExplosions: [], weaponExplosions: [], weapons: [],
    rowsGroup: Array.from({ length: 13 }, () => ({ add() {} })),
  });
  const column = Object.assign(Object.create(Game.Columns.prototype), {
    game, grid, weaponType, exists: true, direction: Game.DIRECTION.RIGHT,
    startingGridX: 2, startingGridY: 5, player: { playerID: 0 },
    destroyWeapon() { this.exists = false; },
  });
  grid.weapons.push(column);
  assert.equal(column.useWeapon(), true);

  let steps = 0;
  const advanceToFlashFrame = flashFrame => {
    const target = Math.ceil(flashFrame * flashFrameMs / frameMs - 1e-9);
    assert.ok(target >= steps, `Flash frame ${flashFrame} is already past`);
    for (; steps < target; steps++) { column.update(); grid.update(); }
  };
  const sprites = () => [...column.classicCells].map(entry => entry.sprite);
  return { column, cells, advanceToFlashFrame, sprites };
}

for (const [weaponType, out] of [['fire', 'fire_out'], ['freeze', 'ice_out']]) {
  test(`every ${weaponType} column cell plays out at its own age 40, after the column is gone`, () => {
    const f = fixture(weaponType);
    f.advanceToFlashFrame(12);
    assert.equal(f.sprites().length, 3, 'cells added at frames 4, 8 and 12');
    f.advanceToFlashFrame(44);
    assert.deepEqual(f.sprites().map(s => s.played.includes(out)), [true, false, false]);
    f.advanceToFlashFrame(49);
    assert.equal(f.column.exists, false, 'cleanup at counter 49');
    assert.deepEqual(f.sprites().map(s => s.played.includes(out)), [true, true, false]);
    f.advanceToFlashFrame(51);
    assert.equal(f.sprites()[2].played.includes(out), false);
    f.advanceToFlashFrame(52);
    assert.deepEqual(f.sprites().map(s => s.played.filter(name => name === out).length), [1, 1, 1]);
  });
}

test('a column blocked early still plays out each of its cells', () => {
  const f = fixture('fire');
  f.cells[4][5].cellContains = 1; // a wall two cells away
  f.advanceToFlashFrame(8);
  assert.equal(f.sprites().length, 1);
  f.advanceToFlashFrame(44);
  assert.equal(f.column.exists, true);
  assert.deepEqual(f.sprites()[0].played, ['fire_in', 'fire_out']);
  f.advanceToFlashFrame(45);
  assert.equal(f.column.exists, false, 'the blocked cell skips the counter to 12, so cleanup is 4 frames early');
});
