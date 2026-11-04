import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const patch = readFileSync(new URL('../public/classic-timing.js', import.meta.url), 'utf8');

function fixture(patched = true) {
  // The exact traversal used by this project's bundled Phaser.Group.update.
  function liveUpdate() { let i = this.children.length; while (i--) this.children[i].update(); }
  const Game = Object.fromEntries(['Grid','GameplayState','BombExplosion','WeaponExplosion','Mine','Rocket','Columns','Player'].map(name => [name, function () {}]));
  Game.Grid.prototype.createTileGroups = function () {
    this.rowsGroup = [0,1].map(() => ({ children: [], update: liveUpdate }));
    this.children = this.rowsGroup;
  };
  Game.Grid.prototype.update = liveUpdate;
  if (patched) vm.runInNewContext(patch, { Game });
  const grid = new Game.Grid(); grid.createTileGroups();
  function add(row, child) { child.parent = row; row.children.push(child); return child; }
  function remove(child) { const row = child.parent; row.children.splice(row.children.indexOf(child), 1); child.parent = null; }
  return { grid, add, remove };
}

test('the bundled live-array traversal double-ticks a blast that removes an earlier bomb', () => {
  const { grid, add, remove } = fixture(false), row = grid.rowsGroup[0];
  const bomb = add(row, { update() {} });
  let ticks = 0;
  add(row, { update() { ticks++; if (bomb.parent) remove(bomb); } });
  grid.update();
  assert.equal(ticks, 2);
});

test('chain removal advances each remaining timer exactly once and skips removed bombs', () => {
  const { grid, add, remove } = fixture(), row = grid.rowsGroup[0];
  let bombTicks = 0, blastTicks = 0;
  const bombs = Array.from({ length: 100 }, () => add(row, { update() { bombTicks++; } }));
  add(row, { update() { blastTicks++; for (const bomb of bombs) if (bomb.parent) remove(bomb); } });
  grid.update();
  assert.equal(blastTicks, 1); assert.equal(bombTicks, 0);
  grid.update(); assert.equal(blastTicks, 2, 'The next frame must still advance normally');
});

test('a moving child reparented into a later row cannot tick twice in one frame', () => {
  const { grid, add, remove } = fixture();
  let ticks = 0;
  const actor = add(grid.rowsGroup[1], { update() {
    ticks++;
    if (this.parent !== grid.rowsGroup[0]) { remove(this); add(grid.rowsGroup[0], this); }
  } });
  grid.update(); assert.equal(ticks, 1);
  grid.update(); assert.equal(ticks, 2);
  assert.equal(actor.parent, grid.rowsGroup[0]);
});

test('new effects appended to a traversed row start on the following frame', () => {
  const { grid, add } = fixture(), row = grid.rowsGroup[0];
  let ticks = 0, created = false;
  add(row, { update() { if (!created) { created = true; add(row, { update() { ticks++; } }); } } });
  grid.update(); assert.equal(ticks, 0);
  grid.update(); assert.equal(ticks, 1);
});
