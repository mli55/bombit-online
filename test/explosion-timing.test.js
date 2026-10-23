import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const upstream = readFileSync(new URL('../original/bombit-1.min.js', import.meta.url), 'utf8');
const fixes = readFileSync(new URL('../public/gameplay-fixes.js', import.meta.url), 'utf8');

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
    MAP: { FREE: 0, ITEM: 1, BOMB: 2, MINE: 3, BLOCK: 4 },
    SETTINGS: { SCALE: 1, GRID_WIDTH: 13, GRID_HEIGHT: 13 },
    Player: function Player() {},
  };
  Game.Player.prototype.update = function () {};
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
    bombExplosions: [],
    astarGrid: { grid: cells.map(column => column.map(() => ({ weight: 1 }))) },
    rowsGroup: cells.map(() => ({
      children: [],
      add(sprite) { this.children.push(sprite); sprite.parent = this; },
      remove(sprite) { this.children.splice(this.children.indexOf(sprite), 1); },
    })),
    getItemAtCell() { return null; },
    destroyBombExplosion(cell) {
      this.bombExplosions = this.bombExplosions.filter(explosion => explosion.gridCell !== cell);
    },
  };
  const center = cells[6][6];
  center.isEmpty = false;
  center.cellContains = Game.MAP.BOMB;
  const explosion = new Game.BombExplosion(game, grid, center, power, 'tile_exp_red1.png', { playerID: 0 });
  explosion.gameStatus = Game.GAME_STATUS.PLAYING;
  grid.bombExplosions.push(explosion);
  grid.rowsGroup[6].add(explosion);

  function advance(frames) {
    for (let frame = 0; frame < frames; frame++) {
      elapsed += frameMs;
      for (let i = 0; i < pending.length;) {
        if (pending[i].due > elapsed) { i++; continue; }
        const event = pending.splice(i, 1)[0];
        event.callback.call(event.owner);
      }
      if (!explosion.destroyed) explosion.update();
    }
  }
  const dangerousCells = () => cells.flat().filter(cell => cell.isDangerCell);
  const visibleFlames = () => grid.rowsGroup.flatMap(row => row.children).filter(sprite => sprite.visible);
  return { Game, explosion, center, grid, pending, advance, dangerousCells, visibleFlames };
}

function assertFinished(f) {
  assert.equal(f.explosion.destroyed, true, 'Center sprite is destroyed');
  assert.equal(f.grid.bombExplosions.length, 0, 'Explosion is removed from the grid');
  assert.equal(f.visibleFlames().length, 0, 'All ray segments become invisible with the center');
  assert.equal(f.dangerousCells().length, 0, 'No invisible dangerous cells remain');
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

test('flames and dangerous cells finish together at 300 ms at 60 Hz', () => {
  const f = fixture();
  f.explosion.makeExplosion();
  f.advance(17);
  assert.equal(f.visibleFlames().length, 5);
  assert.equal(f.dangerousCells().length, 5);
  f.advance(1);
  assertFinished(f);
});

test('maximum-power rays finish propagating before cleanup and never reappear', () => {
  const f = fixture({ power: 5 });
  f.explosion.makeExplosion();
  assert.equal(f.pending.length, 20, 'Each ray cell uses the original 25 ms per-cell delay');
  f.advance(1);
  assert.equal(f.visibleFlames().length, 1, 'Only the center appears before the first delayed segment');
  f.advance(7);
  assert.equal(f.pending.length, 0, 'All maximum-power segments have appeared by 133 ms');
  assert.equal(f.visibleFlames().length, 21);
  assert.equal(f.dangerousCells().length, 21);
  f.advance(10);
  assertFinished(f);
  f.advance(42);
  assertFinished(f);
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
  f.advance(12);
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
  f.advance(18);
  assertFinished(f);
});

test('a round ending does not freeze its final explosion', () => {
  const f = fixture();
  f.explosion.makeExplosion();
  f.advance(3);
  f.explosion.gameStatus = f.Game.GAME_STATUS.GAME_OVER;
  f.advance(15);
  assertFinished(f);
});
