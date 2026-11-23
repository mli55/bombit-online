import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the upstream Player, PlayerHuman and InputController with the Flash
// controls. Only the keyboard, rendering and the map are substitutes.
const upstream = readFileSync(new URL('../original/bombit-1.min.js', import.meta.url), 'utf8');
const patch = readFileSync(new URL('../public/player-controls.js', import.meta.url), 'utf8');
function definition(name, namespace) {
  const marker = `${namespace}.${name}=t}`;
  const end = upstream.indexOf(marker);
  const start = upstream.lastIndexOf(`function(${namespace}){`, end);
  assert.ok(start >= 0 && end > start, `Find upstream ${name}`);
  return upstream.slice(start, end + marker.length);
}
const frameMs = 1000 / 60, flashFrameMs = 1000 / 35;

function fixture() {
  class Signal {
    listeners = [];
    add(fn, receiver) { this.listeners.push([fn, receiver]); }
    dispatch() { for (const [fn, receiver] of this.listeners) fn.call(receiver); }
  }
  const keys = new Map();
  const keyboard = {
    addKey(code) {
      if (!keys.has(code)) keys.set(code, {
        isDown: false, onDown: new Signal(), onUp: new Signal(), enabled: true,
        press() { if (!this.isDown) { this.isDown = true; this.onDown.dispatch(); } },
        release() { if (this.isDown) { this.isDown = false; this.onUp.dispatch(); } },
      });
      return keys.get(code);
    },
  };
  const Game = {
    GAME_STATUS: { PLAYING: 0, GAME_OVER: 1, PAUSED: 2 },
    PLAYER_MODE: { SINGLE_PLAYER: 0, MULTI_PLAYER: 1 },
    DIFFICULTY: { EASY: 0, NORMAL: 1, HARD: 2 },
    DIRECTION: { ALL: 0, UP: 1, LEFT: 4, RIGHT: 5, DOWN: 8 },
    MAP: { FREE: 0, WALL: 1, BLOCK: 3, BOMB: 4, MINE: 7 },
    SETTINGS: { CELL_WIDTH: 49, CELL_HEIGHT: 49, GRID_WIDTH: 7, GRID_HEIGHT: 7, SCALE: 1 },
    Bomb: function Bomb(game, x, y, key, grid, cell) { Object.assign(this, { gridPositionX: cell.gridPositionX, gridPositionY: cell.gridPositionY }); },
    ClassicWeapons: {
      isBrick: (grid, cell) => !cell || cell.cellContains === Game.MAP.WALL || cell.cellContains === Game.MAP.BLOCK || cell.isFreezeCell,
    },
  };
  const context = vm.createContext({
    Game,
    Phaser: {
      Group: function Group() {},
      Keyboard: { LEFT: 37, RIGHT: 39, UP: 38, DOWN: 40, SPACEBAR: 32, ENTER: 13, A: 65, D: 68, W: 87, S: 83 },
    },
    Ph2: { AnimationSystem: { findObject: () => ({ frameName: '' }) } },
    __extends(derived, base) { derived.prototype = Object.create(base.prototype); derived.prototype.constructor = derived; },
  });
  vm.runInContext(`(${definition('Player', 'l')})(Game); (${definition('PlayerHuman', 'c')})(Game); (${definition('InputController', 'i')})(Game);`, context);
  vm.runInContext(patch, context);
  const pickups = [];
  Game.Player.prototype.checkItemPickUp = function () { pickups.push(this.gridCell); };
  const cells = Array.from({ length: 7 }, (_, x) => Array.from({ length: 7 }, (_, y) => ({
    gridPositionX: x, gridPositionY: y, centerX: (x + 0.5) * 49, centerY: (y + 0.5) * 49,
    isEmpty: true, cellContains: Game.MAP.FREE,
  })));
  const game = { device: { desktop: true }, input: { keyboard }, time: { elapsedMS: frameMs }, ph2AudioManager: { playEffect() {} } };
  const grid = {
    charactersChosen: [0], cells, bombs: [], weapons: [], rowsGroup: cells.map(() => ({ add() {} })),
    addBomb(bomb) { this.bombs.push(bomb); },
  };
  const start = cells[3][3];
  const player = Object.assign(Object.create(Game.PlayerHuman.prototype), {
    game, grid, playerID: 0, playerMode: Game.PLAYER_MODE.SINGLE_PLAYER,
    gridCell: start, gridPositionX: 3, gridPositionY: 3, x: start.centerX, y: start.centerY,
    bombs: 9, power: 1, bombsOnGround: [], weapons: [], weaponActive: false,
    direction: Game.DIRECTION.DOWN, gameStatus: Game.GAME_STATUS.PLAYING, dead: false, frozen: false, slowed: false,
    movingAnimation: false, canKickBombs: false, gameScale: 1,
    animationMovement: { ph2Animations: { resume() {}, pause() {} } },
  });
  for (const name of ['checkInitialBlinking', 'checkOwnBombs', 'checkDangerZone', 'checkInvulnerability',
    'checkInvincibility', 'checkSlow', 'checkFreeze', 'checkAnimation', 'checkIndicators', 'checkPlayerIndicator']) player[name] = () => {};
  player.inputController = new Game.InputController(game, player);
  const key = name => player.inputController[`${name}Key`];
  let steps = 0;
  // Rules are in Flash frames (1/35 s); the clock steps at 60 Hz. Convert here.
  function toFlashFrame(flashFrame) {
    const target = Math.ceil(flashFrame * flashFrameMs / frameMs - 1e-9);
    assert.ok(target >= steps, `Flash frame ${flashFrame} is already past`);
    while (steps < target) { steps++; player.update(); }
  }
  const equip = (uses, valid = true) => {
    const shots = [];
    Object.assign(player, { weaponActive: true, weaponCurrentUses: 0, weaponTotalUses: uses });
    player.weapons = Array.from({ length: uses }, () => ({ useWeapon() { if (valid) shots.push(player.direction); return valid; } }));
    return shots;
  };
  return { Game, player, cells, grid, key, toFlashFrame, equip, pickups };
}

test('a step takes 6 Flash frames, keeps going after the key is released, and ends on the center', () => {
  const { player, cells, key, toFlashFrame, pickups } = fixture();
  key('right').press();
  toFlashFrame(1);
  key('right').release();
  toFlashFrame(6);
  assert.ok(player.x < cells[4][3].centerX, 'Still moving on frame 6');
  toFlashFrame(7);
  assert.equal(player.x, cells[4][3].centerX);
  assert.equal(player.gridCell, cells[4][3]);
  assert.deepEqual(pickups, [cells[4][3]], 'Items are collected on arrival only');
  toFlashFrame(20);
  assert.equal(player.x, cells[4][3].centerX, 'No further step without a key');
});

test('with several keys held, Flash order left, up, right, down picks the direction', () => {
  for (const [held, expected] of [[['right', 'up'], [3, 2]], [['down', 'left'], [2, 3]], [['down', 'right'], [4, 3]]]) {
    const { player, cells, key, toFlashFrame } = fixture();
    for (const name of held) key(name).press();
    toFlashFrame(7);
    assert.equal(player.gridCell, cells[expected[0]][expected[1]], held.join('+'));
  }
});

test('the hero changes cell when Flash rounding does: right at half way, left just after', () => {
  const { player, cells, key, toFlashFrame } = fixture();
  key('right').press(); toFlashFrame(3);
  assert.equal(player.gridCell, cells[3][3], 'Frame 3 is 2/6 of the step');
  toFlashFrame(4);
  assert.equal(player.gridCell, cells[4][3], 'Frame 4 is exactly half way');
  key('right').release(); toFlashFrame(7);
  key('left').press(); toFlashFrame(11);
  assert.equal(player.gridCell, cells[4][3], 'Half way left still rounds to the start');
  toFlashFrame(12);
  assert.equal(player.gridCell, cells[3][3]);
});

test('walls, boxes, ice and a bomb without a glove only turn the hero', () => {
  const { Game, player, cells, grid, key, toFlashFrame } = fixture();
  cells[4][3].cellContains = Game.MAP.WALL;
  cells[2][3].isFreezeCell = true;
  cells[3][2].cellContains = Game.MAP.BLOCK;
  cells[3][4].cellContains = Game.MAP.BOMB;
  grid.bombs.push({ gridPositionX: 3, gridPositionY: 4, bombKicked() { throw new Error('No glove'); } });
  let frame = 0;
  for (const [name, direction] of [['right', 'RIGHT'], ['left', 'LEFT'], ['up', 'UP'], ['down', 'DOWN']]) {
    key(name).press(); toFlashFrame(frame += 8); key(name).release();
    assert.equal(player.gridCell, cells[3][3]);
    assert.equal(player.direction, Game.DIRECTION[direction]);
  }
});

test('with a glove the hero steps into the cell a kicked bomb leaves; a bomb that cannot move stops it', () => {
  const { Game, player, cells, grid, key, toFlashFrame } = fixture();
  player.canKickBombs = true;
  cells[4][3].cellContains = Game.MAP.BOMB;
  let allowed = false;
  grid.bombs.push({ gridPositionX: 4, gridPositionY: 3, bombKicked(direction) {
    assert.equal(direction, Game.DIRECTION.RIGHT);
    if (allowed) cells[4][3].cellContains = Game.MAP.FREE;
    return allowed;
  } });
  key('right').press(); toFlashFrame(8);
  assert.equal(player.gridCell, cells[3][3], 'A blocked kick keeps the hero in place');
  allowed = true; toFlashFrame(16);
  assert.equal(player.gridCell, cells[4][3]);
});

test('fire pressed mid-step drops the bomb on the arrival cell; holding fire keeps dropping bombs', () => {
  const { player, cells, grid, key, toFlashFrame } = fixture();
  key('right').press(); toFlashFrame(2);
  key('action').press(); key('action').release();
  assert.equal(grid.bombs.length, 0, 'A press only queues the bomb');
  key('right').release(); toFlashFrame(7);
  assert.deepEqual(grid.bombs.map(b => [b.gridPositionX, b.gridPositionY]), [[4, 3]]);
  key('action').press(); key('down').press(); toFlashFrame(25);
  assert.deepEqual(grid.bombs.map(b => [b.gridPositionX, b.gridPositionY]), [[4, 3], [4, 4], [4, 5]],
    'Each step start places a bomb on the cell being left, as Flash putBomb runs after movHero');
  assert.equal(player.gridCell, cells[4][6]);
});

test('a special fires once per press at rest, blocks bombs until release, and is lost if a step starts', () => {
  const { player, key, toFlashFrame, equip, grid } = fixture();
  const shots = equip(2);
  key('action').press(); toFlashFrame(10);
  assert.equal(shots.length, 1);
  assert.equal(grid.bombs.length, 0);
  key('action').release(); key('action').press(); toFlashFrame(11);
  assert.equal(shots.length, 2);
  assert.equal(player.weaponActive, false);
  toFlashFrame(15);
  assert.equal(grid.bombs.length, 0, 'The same hold does not turn into bombs');
  key('action').release();
  const more = equip(2);
  key('action').press(); key('right').press(); toFlashFrame(16);
  assert.equal(more.length, 0, 'putSpecial needs a hero at rest');
});

test('a rejected special is retried every frame while fire is held', () => {
  const { player, key, toFlashFrame, equip } = fixture();
  let tries = 0;
  equip(2, false);
  player.weapons = player.weapons.map(() => ({ useWeapon() { tries++; return false; } }));
  key('action').press(); toFlashFrame(5);
  assert.equal(tries, 5);
});

test('a frozen hero finishes its step, then neither moves nor fires', () => {
  const { player, cells, grid, key, toFlashFrame } = fixture();
  key('right').press(); toFlashFrame(2);
  player.frozen = true; key('action').press(); toFlashFrame(30);
  assert.equal(player.gridCell, cells[4][3]);
  assert.equal(grid.bombs.length, 0);
});

test('online masks carry every held direction and a fresh press between frames', () => {
  const { player, cells, grid, toFlashFrame } = fixture();
  const controller = player.inputController;
  controller.applyOnlineInput(8 | 1);
  toFlashFrame(1);
  controller.applyOnlineInput(0);
  toFlashFrame(7);
  assert.equal(player.gridCell, cells[3][2], 'Up wins over right');
  controller.applyOnlineInput(16 | 32); controller.applyOnlineInput(0);
  toFlashFrame(8);
  assert.equal(grid.bombs.length, 1, 'A press and release within one Flash frame still drops a bomb');
  player.dead = true; controller.applyOnlineInput(16 | 8);
  assert.equal(controller.onlineActionHeld, false);
});
