import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const upstream = readFileSync(new URL('../original/bombit-1.min.js', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../public/classic-rules.js', import.meta.url), 'utf8');
const ai = readFileSync(new URL('../public/classic-ai.js', import.meta.url), 'utf8');
function fixture() {
  const Game = {
    SETTINGS: JSON.parse(readFileSync(new URL('../original/assets/json/balance.json', import.meta.url))).SETTINGS,
    GAME_STATUS: { PLAYING: 0, PAUSED: 1, GAME_OVER: 2 },
    MAP: { FREE: 0, BLOCK: 1, WALL: 2, BOMB: 3, ITEM: 4, MINE: 5 },
    DIFFICULTY: { EASY: 0, NORMAL: 1, HARD: 2 },
    DIRECTION: { LEFT: 0, UP: 1, RIGHT: 2, DOWN: 3 },
    ITEM_TYPE: Object.fromEntries(['BOMB','POWER','SPEED','KICK_BOMBS','SHIELD','HEART','BATTERY','FIRE','FREEZE','GRENADE','MINE','ROCKET'].map(x => [x, x])),
    GameplayState: function () {},
    Item: function (game, cell, key, itemType) { Object.assign(this, { itemType, key, gridPositionX: cell.gridPositionX, gridPositionY: cell.gridPositionY }); },
  };
  Game.GameplayState.prototype.init = function () {};
  const context = vm.createContext({ Game, Phaser: { Group: function () {}, Sprite: function () {} },
    __extends(derived, base) { derived.prototype = Object.create(base.prototype); derived.prototype.constructor = derived; },
  });
  for (const [name, ns] of [['Player','l'], ['PlayerAI','l'], ['Grid','g'], ['ScoreManager','i']]) {
    const marker = `${ns}.${name}=t}`, end = upstream.indexOf(marker), start = upstream.lastIndexOf(`function(${ns}){`, end);
    assert.ok(start >= 0 && end > start);
    vm.runInContext(`(${upstream.slice(start, end + marker.length)})(Game)`, context);
  }
  vm.runInContext(rules, context); vm.runInContext(ai, context);
  let seed = 123456;
  const game = { time: { elapsedMS: 1000 / 60 }, rnd: { integerInRange(min, max) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return min + Math.floor(seed / 2 ** 32 * (max - min + 1));
  } }, ph2NotificationManager: { addObserver() {}, postNotification() {} }, ph2AudioManager: { playEffect() {} } };
  new Game.GameplayState().init.call({ game }, 0, 1, 0, 0, [0], 1);
  const cells = Array.from({ length: 11 }, (_, x) => Array.from({ length: 11 }, (_, y) => ({
    gridPositionX: x, gridPositionY: y, centerX: x * 49, centerY: y * 49,
    cellContains: Game.MAP.FREE, isEmpty: true, isDangerCell: false, isItemCell: false,
  })));
  const grid = Object.assign(Object.create(Game.Grid.prototype), {
    game, cells, bombs: [], bombExplosions: [], items: [], difficulty: 1,
    rowsGroup: cells.map(() => ({ add() {} })), powerupChances: [], weaponChances: [],
  });
  grid.createChancesArray();
  const player = Object.assign(Object.create(Game.PlayerAI.prototype), {
    game, grid, gridCell: cells[5][5], gridPositionX: 5, gridPositionY: 5, x: 245, y: 245,
    speed: Game.SETTINGS.INITIAL_SPEED, gameScale: 1, gameStatus: Game.GAME_STATUS.PLAYING,
    dead: false, isAI: true, moving: false, lives: 1, playerID: 0,
  });
  return { Game, game, grid, player };
}

test('pickups follow 65% drop, 20% weapon and the original conditional distribution', () => {
  const { Game, game, grid } = fixture();
  const cell = grid.cells[1][1];
  const samples = [65, 20, 0]; game.rnd.integerInRange = () => samples.shift();
  grid.createPowerUp(cell);
  assert.ok(['BATTERY','FIRE','FREEZE','GRENADE','MINE','ROCKET'].includes(grid.items[0].itemType));
  const count = grid.items.length;
  game.rnd.integerInRange = () => 66; grid.createPowerUp(cell);
  assert.equal(grid.items.length, count, 'Roll 66 must not drop');
  assert.equal(grid.powerupChances.filter(x => x.name === 'heart').length, 1);
  assert.equal(grid.powerupChances.filter(x => x.name === 'push').length, 14);
  for (const name of ['bomb','power','speed']) assert.equal(grid.powerupChances.filter(x => x.name === name).length, 25);
  assert.equal(grid.powerupChances.filter(x => x.name === 'shield').length, 10);
  assert.equal(new Set(grid.weaponChances.map(x => x.name)).size, 2);
  assert.equal(Game.SETTINGS.MAX_BOMB_POWER, 10);
});

test('supplied weapon schedule selects a different pair each round without client history', () => {
  const { Game, game } = fixture();
  const order = ['battery','fire','freeze','grenade','mine','rocket'];
  for (const round of [3, 1, 2, 3]) {
    Game.ClassicRules.configureRound(game, order, round);
    Game.GameplayState.prototype.init.call({ game }, 0, 1, 0, 0, [0], round);
    assert.deepEqual(Array.from(Game.SETTINGS.WEAPON_CHANCES, x => x.name), order.slice((round - 1) * 2, round * 2));
  }
});

function pickup(f, type) {
  const { Game, player, grid } = f, cell = player.gridCell;
  cell.isItemCell = true; cell.cellContains = Game.MAP.ITEM;
  grid.getItemAtCell = () => type;
  grid.removeItemFromArray = c => { c.isItemCell = false; c.cellContains = Game.MAP.FREE; };
  player.checkItemPickUp();
}
test('speed shoes use 6/5/4/3 frames per cell and stop at the original cap', () => {
  const f = fixture(); f.player.isAI = false;
  assert.equal(f.player.speed, 49 * 35 / 6000);
  for (const frames of [5,4,3,3]) {
    pickup(f, f.Game.ITEM_TYPE.SPEED);
    assert.equal(f.player.speed, 49 * 35 / (frames * 1000));
  }
  f.player.bombs = 9; pickup(f, f.Game.ITEM_TYPE.BOMB); assert.equal(f.player.bombs, 10);
});
test('normal CPUs collect hearts but reject speed and special weapons; easy CPUs reject hearts', () => {
  const f = fixture();
  pickup(f, f.Game.ITEM_TYPE.HEART); assert.equal(f.player.lives, 2); assert.equal(f.player.isAI, true);
  pickup(f, f.Game.ITEM_TYPE.SPEED); assert.equal(f.player.gridCell.isItemCell, true);
  pickup(f, f.Game.ITEM_TYPE.ROCKET); assert.equal(f.player.gridCell.isItemCell, true);
  f.grid.difficulty = 0; pickup(f, f.Game.ITEM_TYPE.HEART); assert.equal(f.player.lives, 2);
});
test('time score rewards remaining seconds, not elapsed milliseconds, and never goes negative', () => {
  const { Game, game } = fixture();
  const scores = new Game.ScoreManager(game, [], 1);
  scores.addLeftOverTime(30000, 0);
  assert.equal(scores.leftOverScores[0], 1500);
  assert.equal(scores.finalScores[0], 1500);
  scores.addLeftOverTime(180001, 0); assert.equal(scores.finalScores[0], 1500);
});
test('CPU safety sees full bomb ranges and active blast origins, but not through walls', () => {
  const { Game, player, grid } = fixture();
  grid.bombs.push({ gridPositionX: 8, gridPositionY: 5, power: 4 });
  assert.equal(player.classicSafe(5, 5), false);
  grid.cells[7][5].cellContains = Game.MAP.WALL;
  assert.equal(player.classicSafe(5, 5), true);
  grid.bombExplosions.push({ exists: true, hasExploded: true, gridPositionX: 5, gridPositionY: 5, power: 1 });
  assert.equal(player.classicSafe(5, 5), false);
});
test('CPU decisions use 35 Hz with pause and freeze, rather than 60 random rolls per second', () => {
  const { Game, player, game } = fixture();
  for (const name of ['checkInitialBlinking','checkActualGridLocation','checkItemPickUp','checkOwnBombs','checkDangerZone','checkInvulnerability','checkInvincibility','checkSlow','checkFreeze','checkAnimation','checkIndicators']) player[name] = () => {};
  let decisions = 0; player.classicThink = () => { decisions++; };
  for (let i = 0; i < 60; i++) player.update();
  assert.equal(decisions, 35);
  player.gameStatus = Game.GAME_STATUS.PAUSED;
  for (let i = 0; i < 60; i++) player.update();
  assert.equal(decisions, 35);
  player.gameStatus = Game.GAME_STATUS.PLAYING; player.frozen = true;
  for (let i = 0; i < 60; i++) player.update();
  assert.equal(decisions, 35);
  assert.equal(game.time.elapsedMS, 1000 / 60);
});
test('CPU escape roll respects easy/normal/hard thresholds', () => {
  for (const [difficulty, roll, moves] of [[0,20,0],[0,19,1],[1,60,0],[1,59,1],[2,99,1]]) {
    const { player, game, grid } = fixture(); grid.difficulty = difficulty;
    player.classicSafe = () => false; player.classicScore = () => 1;
    let called = 0; player.classicBeginMove = () => called++;
    const values = [roll, 0]; game.rnd.integerInRange = () => values.shift();
    player.classicThink(); assert.equal(called, moves);
  }
});
test('CPU only plants a bomb when an exit has at least two safe continuations', () => {
  for (const [score, expected] of [[1,0],[2,1]]) {
    const { player, game } = fixture(); player.classicSafe = () => true; player.classicScore = () => score;
    const values = [99, 0, 0]; game.rnd.integerInRange = () => values.shift();
    let bombs = 0; player.putBomb = () => bombs++; player.classicBeginMove = () => {};
    player.classicThink(); assert.equal(bombs, expected);
  }
});

test('room-seeded weapon cycles can be rebuilt at any round without previous client state', () => {
  const { Game } = fixture();
  const first = Game.ClassicRules.orderForRound('A1B2C3D4E5', 1);
  for (const round of [2,3]) assert.deepEqual(Game.ClassicRules.orderForRound('A1B2C3D4E5', round), first);
  const fourth = Game.ClassicRules.orderForRound('A1B2C3D4E5', 4);
  assert.equal(new Set(fourth).size, 6);
  assert.notEqual(fourth[0], first.at(-1));
  assert.deepEqual(Game.ClassicRules.orderForRound('A1B2C3D4E5', 40), Game.ClassicRules.orderForRound('A1B2C3D4E5', 40));
  assert.notDeepEqual(Game.ClassicRules.orderForRound('0011223344', 1), first);
});
