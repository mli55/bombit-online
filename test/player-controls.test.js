import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the preserved InputController and Player action methods. Only the
// keyboard, renderer and weapon effects are substitutes in this fixture.
const upstream = readFileSync(new URL('../original/bombit-1.min.js', import.meta.url), 'utf8');
const patch = readFileSync(new URL('../public/player-controls.js', import.meta.url), 'utf8');
function definition(name, namespace) {
  const marker = `${namespace}.${name}=t}`;
  const end = upstream.indexOf(marker);
  const start = upstream.lastIndexOf(`function(${namespace}){`, end);
  assert.ok(start >= 0 && end > start, `Find upstream ${name}`);
  return upstream.slice(start, end + marker.length);
}

function fixture({ offline = false } = {}) {
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
    DIRECTION: { UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3 },
    MAP: { FREE: 0, BOMB: 1, MINE: 2 },
    Bomb: function Bomb(game, x, y, key, grid, cell, power, owner) {
      Object.assign(this, { cell, owner, power });
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
  vm.runInContext(`(${definition('Player', 'l')})(Game); (${definition('InputController', 'i')})(Game);`, context);
  vm.runInContext(patch, context);
  const cells = Array.from({ length: 5 }, (_, x) => [{ isEmpty: true, cellContains: Game.MAP.FREE, centerX: x * 50, centerY: 0 }]);
  const shots = [], attempts = [], moves = [];
  const game = { device: { desktop: true }, input: { keyboard }, ph2AudioManager: { playEffect() {} } };
  const player = Object.assign(Object.create(Game.Player.prototype), {
    game, playerID: 0, playerMode: Game.PLAYER_MODE.SINGLE_PLAYER,
    grid: { charactersChosen: [0], cells, weapons: [], addBomb() {} },
    gridPositionX: 0, gridPositionY: 0, bombs: 2, power: 1, bombsOnGround: [],
    direction: Game.DIRECTION.DOWN, weaponActive: false, weapons: [],
    gameStatus: Game.GAME_STATUS.PLAYING, dead: false, frozen: false,
    movingAnimation: false,
    ...Object.fromEntries(['Up', 'Down', 'Left', 'Right'].map(direction => [`checkMove${direction}`, function () {
      moves.push(direction); this.direction = Game.DIRECTION[direction.toUpperCase()]; this.movingAnimation = true;
    }])),
  });
  const controller = new Game.InputController(game, player);
  const actionKey = controller.actionKey;
  if (!offline) controller.actionKey = { enabled: true };
  const equip = (type, uses = 2, valid = true) => {
    player.weaponActive = true; player.weaponCurrentType = type;
    player.weaponCurrentUses = 0; player.weaponTotalUses = uses;
    player.weapons = Array.from({ length: uses }, () => ({
      useWeapon() { attempts.push(type); if (valid) shots.push({ type, direction: this.direction }); return valid; },
    }));
  };
  const moveCell = x => { player.gridPositionX = x; };
  return { Game, player, controller, actionKey, cells, equip, shots, attempts, moves, moveCell };
}

test('held online bombs use original cell and capacity limits, and release stops placing', () => {
  const { controller, player, moveCell } = fixture();
  controller.applyOnlineInput(48); assert.equal(player.bombsOnGround.length, 1);
  controller.applyOnlineInput(16); assert.equal(player.bombsOnGround.length, 1, 'No duplicate bomb on the same cell');
  moveCell(1); controller.applyOnlineInput(16); assert.equal(player.bombsOnGround.length, 2);
  moveCell(2); controller.applyOnlineInput(16); assert.equal(player.bombsOnGround.length, 2, 'Respect original bomb capacity');
  player.bombsOnGround.shift(); controller.applyOnlineInput(16); assert.equal(player.bombsOnGround.length, 2, 'Resume once a slot is free');
  moveCell(3); controller.applyOnlineInput(0); player.bombsOnGround.shift(); controller.applyOnlineInput(0);
  assert.equal(player.bombsOnGround.length, 1); assert.equal(controller.bombHoldEnabled, false); assert.equal(controller.onlineActionHeld, false);
});

for (const type of ['grenade', 'rocket', 'fire', 'freeze', 'mine', 'battery']) {
  test(`${type} retains original per-press dispatch, direction and charge consumption`, () => {
    const { controller, player, equip, shots, moveCell, Game } = fixture(); equip(type);
    player.direction = Game.DIRECTION.LEFT; controller.applyOnlineInput(48);
    for (let i = 0; i < 20; i++) controller.applyOnlineInput(16);
    assert.equal(shots.length, 1); assert.equal(player.weaponCurrentUses, 1); assert.equal(shots[0].direction, Game.DIRECTION.LEFT);
    player.direction = Game.DIRECTION.RIGHT; controller.applyOnlineInput(48);
    assert.equal(shots.length, 2, 'A server pulse preserves rapid release/re-press between adjacent frames');
    assert.equal(shots[1].direction, Game.DIRECTION.RIGHT); assert.equal(player.weaponActive, false);
    moveCell(1); controller.applyOnlineInput(16); assert.equal(player.bombsOnGround.length, 0, 'Last skill charge does not turn the same hold into bombs');
    controller.applyOnlineInput(0); controller.applyOnlineInput(16); assert.equal(player.bombsOnGround.length, 1, 'Legacy frame masks and a fresh bomb press still work');
  });
}

test('picking up a skill while holding a bomb never fires the newly collected skill', () => {
  const { controller, equip, shots, player } = fixture();
  controller.applyOnlineInput(16); equip('grenade');
  for (let i = 0; i < 10; i++) controller.applyOnlineInput(16);
  assert.equal(shots.length, 0); assert.equal(player.weaponCurrentUses, 0);
  controller.applyOnlineInput(0); controller.applyOnlineInput(48); assert.equal(shots.length, 1);
});

test('original freeze and pause guards defer held bombs; release and death clear the latch', () => {
  const { controller, player, moveCell, Game } = fixture();
  player.frozen = true; controller.applyOnlineInput(48); controller.applyOnlineInput(16);
  assert.equal(player.bombsOnGround.length, 0); assert.equal(controller.bombHoldEnabled, true);
  player.frozen = false; controller.applyOnlineInput(16); assert.equal(player.bombsOnGround.length, 1);
  moveCell(1); player.gameStatus = Game.GAME_STATUS.PAUSED; controller.applyOnlineInput(16);
  assert.equal(player.bombsOnGround.length, 1);
  player.gameStatus = Game.GAME_STATUS.PLAYING; controller.applyOnlineInput(16); assert.equal(player.bombsOnGround.length, 2);
  player.dead = true; controller.applyOnlineInput(24);
  assert.equal(controller.bombHoldEnabled, false); assert.equal(controller.onlineActionHeld, false); assert.equal(controller.rightPressed, false);
});

test('a rejected original skill use preserves its charge and does not repeat while held', () => {
  const { controller, equip, player, shots, attempts } = fixture(); equip('grenade', 2, false);
  controller.applyOnlineInput(48); controller.applyOnlineInput(16);
  assert.equal(shots.length, 0); assert.equal(player.weaponCurrentUses, 0); assert.equal(player.weaponActive, true);
  assert.equal(attempts.length, 1, 'A blocked skill is retried only on a new press');
  assert.equal(controller.bombHoldEnabled, false);
});

test('offline Single Player keeps native movement and adds bomb hold without changing skill presses', () => {
  const { controller, actionKey, player, moveCell, equip, shots, moves } = fixture({ offline: true });
  controller.leftKey.press(); controller.checkInput(); assert.deepEqual(moves, ['Left']);
  controller.leftKey.release(); controller.checkInput(); assert.equal(player.movingAnimation, false);
  actionKey.press(); assert.equal(player.bombsOnGround.length, 1);
  moveCell(1); controller.checkInput(); assert.equal(player.bombsOnGround.length, 2);
  actionKey.release(); assert.equal(controller.bombHoldEnabled, false);
  moveCell(2); player.bombsOnGround.shift(); controller.checkInput(); assert.equal(player.bombsOnGround.length, 1);
  equip('rocket'); actionKey.press(); for (let i = 0; i < 10; i++) controller.checkInput();
  assert.equal(shots.length, 1);
  actionKey.release(); actionKey.press(); controller.checkInput(); assert.equal(shots.length, 2);
  assert.equal(player.bombsOnGround.length, 1, 'Skill exhaustion does not auto-place a bomb offline either');
  actionKey.release(); assert.equal(controller.bombHoldEnabled, false);
});

test('held input and release end with identical controller flags across repeated replicas', () => {
  const replicas = [fixture(), fixture()];
  for (const mask of [48, 16, 24, 16, 0, 1, 0, 48, 16, 0]) {
    for (const { controller } of replicas) controller.applyOnlineInput(mask);
    assert.deepEqual(
      Object.fromEntries(Object.entries(replicas[0].controller).filter(([, v]) => typeof v === 'boolean')),
      Object.fromEntries(Object.entries(replicas[1].controller).filter(([, v]) => typeof v === 'boolean')),
    );
  }
  assert.equal(replicas[0].controller.bombHoldEnabled, false); assert.equal(replicas[0].controller.onlineActionHeld, false);
});
