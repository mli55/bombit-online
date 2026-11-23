import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the real upstream PlayerHuman.checkMoveRight with the kick fix, so the
// walk, the contact stop and the kick request keep their original order.
const source = readFileSync(new URL('../original/bombit-1.min.js', import.meta.url), 'utf8');
function definition(marker, header) {
  const end = source.indexOf(marker);
  const start = source.lastIndexOf(header, end);
  assert.ok(start >= 0 && end > start, `Find ${marker}`);
  return source.slice(start, end + marker.length);
}
const player = definition('l.Player=t}', 'function(l){');
const human = definition('c.PlayerHuman=t}', 'function(c){');
const fixes = readFileSync(new URL('../public/bomb-collision-fixes.js', import.meta.url), 'utf8');

function fixture() {
  const Game = {
    DIRECTION: { UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3 },
    MAP: { FREE: 0, WALL: 1, BLOCK: 3, BOMB: 4 },
    SETTINGS: { CELL_WIDTH: 49, CELL_HEIGHT: 49, GRID_WIDTH: 13, GRID_HEIGHT: 11, SLOW_SPEED: 0.1 },
    Bomb: function Bomb() {},
  };
  Game.Bomb.prototype.bombKicked = function () { this.isKicked = true; };
  const context = vm.createContext({ Game, Phaser: { Group: function Group() {} },
    __extends(derived, base) { derived.prototype = Object.create(base.prototype); derived.prototype.constructor = derived; } });
  vm.runInContext(`(${player})(Game)`, context);
  vm.runInContext(`(${human})(Game)`, context);
  vm.runInContext(fixes, context);
  const cells = Array.from({ length: 13 }, (_, x) => Array.from({ length: 11 }, (_, y) => ({
    gridPositionX: x, gridPositionY: y, centerX: x * 49 + 24.5, centerY: y * 49 + 24.5,
    left: x * 49, right: x * 49 + 49, top: y * 49, bottom: y * 49 + 49,
    isEmpty: true, cellContains: Game.MAP.FREE,
  })));
  const bombCell = cells[4][5];
  bombCell.isEmpty = false; bombCell.cellContains = Game.MAP.BOMB;
  const bomb = Object.assign(Object.create(Game.Bomb.prototype), { grid: { cells }, gridPositionX: 4, gridPositionY: 5, isKicked: false });
  const hero = Object.assign(Object.create(Game.PlayerHuman.prototype), {
    grid: { cells, bombs: [bomb] }, gridCell: cells[3][5], gridPositionX: 3, gridPositionY: 5,
    x: cells[3][5].left + 2, y: cells[3][5].centerY, speed: 0.2375, gameScale: 1, cellOffset: 24.5,
    canKickBombs: true, game: { time: { elapsedMS: 1000 / 60 } },
    animationMovement: { ph2Animations: { resume() {} } },
  });
  return { hero, bomb };
}

test('a gloved hero walks up to an adjacent bomb before kicking it', () => {
  const { hero, bomb } = fixture();
  hero.checkMoveRight();
  assert.equal(bomb.isKicked, false, 'Entering the next-to-bomb cell is not contact');
  assert.ok(hero.x > hero.gridCell.left + 2, 'The hero keeps walking toward the bomb');
  let frames = 0;
  while (!bomb.isKicked && frames++ < 60) hero.checkMoveRight();
  assert.equal(bomb.isKicked, true);
  assert.equal(hero.x, hero.gridCell.centerX, 'The kick happens with the hero against the bomb');
});

test('a hero already touching the bomb kicks it at once', () => {
  const { hero, bomb } = fixture();
  hero.x = hero.gridCell.centerX;
  hero.checkMoveRight();
  assert.equal(bomb.isKicked, true);
});
