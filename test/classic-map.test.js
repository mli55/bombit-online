import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const mapSource = readFileSync(new URL('../public/classic-map.js', import.meta.url), 'utf8');
const rulesSource = readFileSync(new URL('../public/classic-rules.js', import.meta.url), 'utf8');
function load() {
  const Game = { Grid: function () {}, GameplayState: function () {}, Player: function () {}, ScoreManager: function () {}, SETTINGS: { MATCH_TIME: 180000 } };
  Game.GameplayState.prototype.init = Game.Player.prototype.checkItemPickUp = Game.Player.prototype.checkDangerZone =
    Game.Player.prototype.activateMine = () => {};
  const context = vm.createContext({ Game });
  vm.runInContext(mapSource, context);
  vm.runInContext(rulesSource, context);
  return Game;
}
const seeded = seed => n => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return Math.floor(seed / 2 ** 32 * n);
};

test('the 4399 generator keeps spawns open, has the center block, and never walls off open space', () => {
  const { ClassicMap } = load();
  for (let seed = 1; seed <= 200; seed++) {
    const rows = ClassicMap.generate(seeded(seed));
    assert.equal(rows.length, 13); assert.ok(rows.every(row => row.length === 15));
    for (let y = 5; y <= 6; y++) for (let x = 6; x <= 7; x++) assert.equal(rows[y][x], 'wall');
    for (const [x, y] of ClassicMap.spawns) {
      for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) assert.equal(rows[y + dy][x + dx], '', `seed ${seed} spawn ${x},${y}`);
    }
    // A wall is only placed where its eight neighbors form at most three open
    // or closed runs, so the open cells stay connected.
    const open = [];
    for (let y = 0; y < 13; y++) for (let x = 0; x < 15; x++) if (rows[y][x] === '') open.push(`${x},${y}`);
    const seen = new Set([open[0]]), queue = [open[0]];
    while (queue.length) {
      const [x, y] = queue.shift().split(',').map(Number);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const key = `${x + dx},${y + dy}`;
        if (rows[y + dy]?.[x + dx] === '' && !seen.has(key)) { seen.add(key); queue.push(key); }
      }
    }
    assert.equal(seen.size, open.length, `seed ${seed}: every open cell is reachable`);
  }
});

test('the same random stream gives the same map, and different streams differ', () => {
  const { ClassicMap } = load();
  assert.deepEqual(ClassicMap.generate(seeded(7)), ClassicMap.generate(seeded(7)));
  assert.notDeepEqual(ClassicMap.generate(seeded(7)), ClassicMap.generate(seeded(8)));
});

test('the Flash clock drops 0.5 s per 500 ms check and runs out at 179.5 s', () => {
  const { ClassicRules } = load();
  assert.equal(ClassicRules.clock(0), 180);
  assert.equal(ClassicRules.clock(499), 180);
  assert.equal(ClassicRules.clock(500), 179.5);
  assert.equal(ClassicRules.clock(179000), 1);
  assert.ok(ClassicRules.clock(179500) < 1, 'timeup');
});
