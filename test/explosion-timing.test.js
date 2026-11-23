import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const upstream = readFileSync(new URL('../original/bombit-1.min.js', import.meta.url), 'utf8');
const fixes = readFileSync(new URL('../public/classic-timing.js', import.meta.url), 'utf8');

function definition(className, namespace) {
  const endMarker = `${namespace}.${className}=t}`;
  const end = upstream.indexOf(endMarker);
  const start = upstream.lastIndexOf(`function(${namespace}){`, end);
  assert.ok(start >= 0 && end > start, `Find the preserved upstream ${className} definition`);
  return upstream.slice(start, end + endMarker.length);
}

const bombExplosionDefinition = definition('BombExplosion', 'h');
const fireExplosionDefinition = definition('FireExplosion', 'l');
const frameMs = 1000 / 60;
const flashFrameMs = 1000 / 35;

function fixture({ patched = true, power = 1 } = {}) {
  // Keep the original propagation, cell cleanup, and timer methods. Only Phaser
  // rendering and timer delivery are represented here, with the online clock's
  // 60 Hz ordering: due callbacks run before the object's update.
  function Sprite(game, x, y, key, frameName) {
    Object.assign(this, { game, x, y, key, frameName, visible: true, exists: true });
    this.anchor = this.scale = { set() {} };
  }
  Sprite.prototype.destroy = function () {
    this.destroyed = true;
    this.visible = this.exists = false;
    this.parent?.remove(this);
  };
  const Game = {
    GAME_STATUS: { PLAYING: 0, PAUSED: 1, GAME_OVER: 2 },
    DIRECTION: { ALL: 0, UP: 1, DOWN: 2, LEFT: 3, RIGHT: 4 },
    MAP: { FREE: 0, ITEM: 1, BOMB: 2, MINE: 3, BLOCK: 4, WALL: 5 },
    SETTINGS: { SCALE: 1, GRID_WIDTH: 13, GRID_HEIGHT: 13 },
    Player: function Player() {},
    GameplayState: function () {}, WeaponExplosion: function () {},
    Grid: function () {}, Mine: function () {}, Rocket: function () {}, Columns: function () {},
  };
  Game.Player.prototype.update = function () {};
  Game.Grid.prototype.update = function () {};
  const context = vm.createContext({
    Game, Phaser: { Sprite },
    __extends(derived, base) {
      derived.prototype = Object.create(base.prototype);
      derived.prototype.constructor = derived;
    },
  });
  vm.runInContext(`(${bombExplosionDefinition})(Game)`, context);
  vm.runInContext(`(${fireExplosionDefinition})(Game)`, context);
  if (patched) vm.runInContext(fixes, context);

  let elapsed = 0;
  const pending = [];
  const game = {
    ph2NotificationManager: { postNotification() {} },
    time: { elapsedMS: frameMs, events: {
      add(delay, callback, owner) { pending.push({ due: elapsed + delay, callback, owner }); },
    } },
  };
  const cells = Array.from({ length: 13 }, (_, x) => Array.from({ length: 13 }, (_, y) => ({
    gridPositionX: x, gridPositionY: y, centerX: x * 49, centerY: y * 49,
    isEmpty: true, isDangerCell: false, cellContains: Game.MAP.FREE,
  })));
  const grid = {
    cells,
    bombs: [],
    boxes: [],
    bombExplosions: [],
    astarGrid: { grid: cells.map(column => column.map(() => ({ weight: 1 }))) },
    rowsGroup: cells.map(() => ({
      children: [],
      add(sprite) { this.children.push(sprite); sprite.parent = this; },
      remove(sprite) { this.children.splice(this.children.indexOf(sprite), 1); },
    })),
    game, gameStatus: Game.GAME_STATUS.PLAYING,
    getItemAtCell() { return null; },
    destroyBombExplosion(cell) {
      this.bombExplosions = this.bombExplosions.filter(explosion => explosion.gridCell !== cell);
    },
  };
  Object.setPrototypeOf(grid, Game.Grid.prototype);
  const center = cells[6][6];
  center.isEmpty = false;
  center.cellContains = Game.MAP.BOMB;
  const explosion = new Game.BombExplosion(game, grid, center, power, 'tile_exp_red1.png', { playerID: 0 });
  explosion.gameStatus = Game.GAME_STATUS.PLAYING;
  grid.bombExplosions.push(explosion);
  grid.rowsGroup[6].add(explosion);

  let steps = 0;
  function advance(frames) {
    for (let frame = 0; frame < frames; frame++) {
      steps++;
      elapsed += frameMs;
      for (let i = 0; i < pending.length;) {
        if (pending[i].due > elapsed) { i++; continue; }
        const event = pending.splice(i, 1)[0];
        event.callback.call(event.owner);
      }
      if (!explosion.destroyed) explosion.update();
      grid.update();
    }
  }
  const dangerousCells = () => cells.flat().filter(cell => cell.isDangerCell);
  const visibleFlames = () => grid.rowsGroup.flatMap(row => row.children).filter(sprite => sprite.visible);
  // Rules are written in Flash frames (1/35 s) but the clock steps at 60 Hz.
  // Convert here; do not hand-count 60 Hz steps in tests.
  function advanceToFlashFrame(flashFrame) {
    const target = Math.ceil(flashFrame * flashFrameMs / frameMs - 1e-9);
    assert.ok(target >= steps, `Flash frame ${flashFrame} is already past`);
    advance(target - steps);
  }
  return { Game, explosion, center, grid, pending, advance, advanceToFlashFrame, dangerousCells, visibleFlames };
}

// Damage is over. The flames may still be fading (see the fade test).
function assertFinished(f) {
  // Upstream destroys the blast at once; the patch keeps it to fade.
  assert.ok(f.explosion.destroyed || f.explosion.hasExploded === false, 'The blast no longer deals damage');
  assert.equal(f.grid.bombExplosions.length, 0, 'Explosion is removed from the grid');
  assert.equal(f.dangerousCells().length, 0, 'No dangerous cells remain while the flames fade');
  assert.equal(f.center.isEmpty, true);
  assert.equal(f.center.cellContains, f.Game.MAP.FREE);
  for (const cell of f.explosion.cellsUsed) {
    assert.equal(cell.cellContains, f.Game.MAP.FREE);
    assert.equal(f.grid.astarGrid.grid[cell.gridPositionX][cell.gridPositionY].weight, 1);
  }
}

test('the preserved upstream flame and danger duration is 500 ms at 60 Hz', () => {
  const f = fixture({ patched: false });
  f.explosion.makeExplosion();
  f.advance(29);
  assert.equal(f.visibleFlames().length, 5);
  assert.equal(f.dangerousCells().length, 5);
  f.advance(1);
  assertFinished(f);
});

test('flames and dangerous cells finish together after the Flash 11-frame lifetime (315–317 ms at 60 Hz)', () => {
  const f = fixture();
  f.explosion.makeExplosion();
  f.advance(18);
  assert.equal(f.visibleFlames().length, 5);
  assert.equal(f.dangerousCells().length, 5);
  f.advance(1);
  assertFinished(f);
});

test('five-cell rays finish propagating before cleanup and never reappear', () => {
  const f = fixture({ power: 5 });
  f.explosion.makeExplosion();
  f.advance(1);
  assert.equal(f.visibleFlames().length, 1, 'Only the center appears before the first delayed segment');
  f.advance(8);
  assert.equal(f.visibleFlames().length, 21);
  assert.equal(f.dangerousCells().length, 21);
  f.advance(17);
  assertFinished(f);
  f.advance(42);
  assertFinished(f);
  assert.equal(f.visibleFlames().length, 0);
});

test('after the damage ends, flames fade 20% per Flash frame and go on the fifth', () => {
  const f = fixture();
  f.explosion.makeExplosion();
  // Power 1: the ray lands on Flash frame 1 and the damage ends on frame 11.
  f.advanceToFlashFrame(11);
  assertFinished(f);
  assert.equal(f.visibleFlames().length, 5, 'Center and four ray ends are still drawn');
  f.advanceToFlashFrame(12);
  for (const sprite of f.visibleFlames()) assert.ok(Math.abs(sprite.alpha - 0.8) < 1e-9);
  f.advanceToFlashFrame(15);
  assert.equal(f.visibleFlames().length, 5);
  for (const sprite of f.visibleFlames()) assert.ok(Math.abs(sprite.alpha - 0.2) < 1e-9);
  f.advanceToFlashFrame(16);
  assert.equal(f.visibleFlames().length, 0);
  assert.equal(f.explosion.destroyed, true);
});

test('pause preserves the remaining flame duration and resumes cleanup', () => {
  const f = fixture();
  f.explosion.makeExplosion();
  f.advance(6);
  const timerBeforePause = f.explosion.timer;
  f.explosion.gameStatus = f.Game.GAME_STATUS.PAUSED;
  f.advance(60);
  assert.equal(f.explosion.timer, timerBeforePause);
  assert.equal(f.visibleFlames().length, 5);
  assert.equal(f.dangerousCells().length, 5);
  f.explosion.gameStatus = f.Game.GAME_STATUS.PLAYING;
  f.advance(13);
  assertFinished(f);
});

test('an untriggered explosion does not consume its flame lifetime', () => {
  const f = fixture();
  f.advance(180);
  assert.equal(f.explosion.timer, 0);
  assert.equal(f.explosion.destroyed, undefined);
  assert.equal(f.visibleFlames().length, 0);
  assert.equal(f.dangerousCells().length, 0);
  f.explosion.makeExplosion();
  f.advance(19);
  assertFinished(f);
});

test('a round ending does not freeze its final explosion', () => {
  const f = fixture();
  f.explosion.makeExplosion();
  f.advance(3);
  f.explosion.gameStatus = f.Game.GAME_STATUS.GAME_OVER;
  f.advance(16);
  assertFinished(f);
});

test('a chain bomb is triggered when the wave reaches its cell, even if placed after ignition', () => {
  const f = fixture({ power: 5 });
  let hit = false;
  f.grid.explodeBomb = cell => { hit = true; cell.cellContains = f.Game.MAP.FREE; };
  f.explosion.makeExplosion();
  const target = f.grid.cells[9][6];
  target.cellContains = f.Game.MAP.BOMB; target.isEmpty = false;
  f.advance(5); // 83.3 ms, before the third Flash frame.
  assert.equal(hit, false);
  f.advance(1);
  assert.equal(hit, true);
  f.advance(3);
  assert.equal(f.grid.cells[10][6].isDangerCell, true, 'The ray continues through a chained bomb');
});

test('a box blocks the ray and is destroyed only on arrival; hard walls block without damage', () => {
  const f = fixture({ power: 5 });
  const box = f.grid.cells[9][6], wall = f.grid.cells[3][6];
  box.cellContains = f.Game.MAP.BLOCK; box.isEmpty = false;
  f.grid.boxes.push({ gridPositionX: 9, gridPositionY: 6 });
  wall.cellContains = f.Game.MAP.WALL; wall.isEmpty = false;
  let destroyed = 0;
  f.grid.destroyBox = cell => { destroyed++; cell.cellContains = f.Game.MAP.FREE; cell.isEmpty = true; };
  f.explosion.makeExplosion();
  f.advance(5); assert.equal(destroyed, 0);
  f.advance(1); assert.equal(destroyed, 1); assert.equal(box.isDangerCell, true);
  f.advance(3);
  assert.equal(f.grid.cells[10][6].isDangerCell, false);
  assert.equal(wall.isDangerCell, false);
  f.advance(20);
  assert.equal(box.cellContains, f.Game.MAP.FREE, 'Cleanup does not restore a destroyed box');
});

test('a box still breaking from an earlier wave lets a later wave through to the next box', () => {
  // Two bombs side by side: the nearer blast already broke the first box, whose
  // cell keeps BLOCK until its animation ends. Flash cleared it at once.
  const f = fixture({ power: 5 });
  const breaking = f.grid.cells[8][6], next = f.grid.cells[9][6];
  for (const cell of [breaking, next]) { cell.cellContains = f.Game.MAP.BLOCK; cell.isEmpty = false; }
  f.grid.boxes.push({ gridPositionX: 9, gridPositionY: 6 });
  const destroyed = [];
  f.grid.destroyBox = cell => {
    destroyed.push(cell);
    f.grid.boxes = f.grid.boxes.filter(box => box.gridPositionX !== cell.gridPositionX || box.gridPositionY !== cell.gridPositionY);
  };
  let scored = 0;
  f.explosion.game.ph2NotificationManager.postNotification = name => { if (name === '_ADD_SCORE_BLOCK') scored++; };
  f.explosion.makeExplosion();
  // The ray reaches distance n on Flash frame n.
  f.advanceToFlashFrame(2);
  assert.deepEqual(destroyed, [], 'The breaking box is not destroyed or scored twice');
  assert.equal(breaking.isDangerCell, true);
  f.advanceToFlashFrame(3);
  assert.deepEqual(destroyed, [next]);
  assert.equal(scored, 1);
  f.advanceToFlashFrame(4);
  assert.equal(f.grid.cells[10][6].isDangerCell, false, 'The ray stops at the box it broke');
});

test('pausing before the first wave stops both propagation and damage lifetime', () => {
  const f = fixture({ power: 5 });
  f.explosion.makeExplosion(); f.advance(1);
  f.explosion.gameStatus = f.Game.GAME_STATUS.PAUSED;
  f.advance(60);
  assert.equal(f.dangerousCells().length, 1);
  f.explosion.gameStatus = f.Game.GAME_STATUS.PLAYING;
  f.advance(1);
  assert.equal(f.dangerousCells().length, 5);
});

test('one blast ending cannot clear a later overlapping blast', () => {
  const f = fixture();
  f.explosion.makeExplosion(); f.advance(2);
  const overlap = f.grid.cells[7][6];
  const later = { exists: true, hasExploded: true, gridCell: overlap, cellsUsed: [], player: { playerID: 1 } };
  f.grid.bombExplosions.push(later);
  f.advance(17);
  assert.equal(overlap.isDangerCell, true);
  assert.equal(overlap.dangerOwner.playerID, 1);
});


test('power ten retains its full twenty-Flash-frame damage lifetime', () => {
  const f = fixture({ power: 10 });
  f.explosion.makeExplosion(); f.advance(34);
  assert.equal(f.explosion.exists, true);
  f.advance(1);
  assertFinished(f);
});
