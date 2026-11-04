/* Actual-engine fixtures for the five 4399 rule changes, including fresh replay. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined, headless: true });
const base = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const output = resolve(process.env.QA_OUTPUT_DIR || '.local/classic-rules-qa');
const errors = [], evidence = [];
await mkdir(output, { recursive: true });
async function open() {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.stack || e.message));
  await page.goto(base + '/game/');
  await page.waitForFunction(() => window.onlineBridge?.state === 'mainMenuState');
  return page;
}
try {
  const page = await open();
  evidence.push(await page.evaluate(() => {
    const bridge = onlineBridge, game = Game.App.getInstance();
    const check = (value, message) => { if (!value) throw Error(message); };
    const order = ['battery','fire','freeze','grenade','mine','rocket'];
    const advance = (n, mask = 0) => { for (let i = 0; i < n; i++) bridge.advance([bridge.frame + 1, [mask,0,0,0]], true); };
    const start = (round = 1) => {
      bridge.start({ seed: 'classic-rules', difficulty: 1, round, weaponOrder: order, scores: [0,0,0,0],
        players: [0,1,2,3].map((character,seat) => ({character,seat})) });
      const state = game.state.getCurrentState(), grid = state.grid;
      for (const box of grid.boxes) box.destroy(); grid.boxes = [];
      for (const col of grid.cells) for (const cell of col) {
        cell.cellContains = Game.MAP.FREE; cell.isEmpty = true;
        cell.isDangerCell = cell.isFreezeCell = cell.isItemCell = false;
      }
      for (const p of grid.players) { p.invincible = true; p.initialBlinking = false; }
      return { state, grid, p: grid.players[0] };
    };
    const place = (p, grid, x, y) => {
      const cell = grid.cells[x][y]; p.gridCell = cell; p.gridPositionX = x; p.gridPositionY = y;
      p.x = cell.centerX; p.y = cell.centerY;
    };
    const speeds = [];
    for (const shoes of [0,1,2,3,4]) {
      const { p, grid } = start(); place(p, grid, 1, 1);
      for (let i = 0; i < shoes; i++) {
        const cell = p.gridCell;
        const item = new Game.Item(game, cell, 'powerup_fast', Game.ITEM_TYPE.SPEED);
        grid.items.push(item); grid.rowsGroup[cell.gridPositionY].add(item);
        cell.isItemCell = true; cell.cellContains = Game.MAP.ITEM;
        p.checkItemPickUp();
      }
      const x = p.x; advance(30, 8);
      const frames = Math.max(3, 6 - shoes), expected = Game.SETTINGS.CELL_WIDTH * 35 / (frames * 1000);
      check(Math.abs(p.speed - expected) < 1e-9, `Speed setting at ${shoes} shoes`);
      const distance = (p.x - x) / Game.SETTINGS.CELL_WIDTH;
      check(Math.abs(distance - 17.5 / frames) < 0.2, `Actual movement at ${shoes} shoes: ${distance}`);
      speeds.push({ shoes, cellsInHalfSecond: distance, framesPerCell: frames });
    }
    let { p, grid, state } = start(); place(p, grid, 1, 1); p.power = 5; p.putBomb();
    const first = grid.bombs[0];
    const secondPlayer = grid.players[1]; place(secondPlayer, grid, 4, 1); secondPlayer.putBomb();
    const second = grid.bombs[1]; first.explode();
    advance(5); check(second.alive, 'Three-cell chain must wait for wave arrival');
    advance(1); check(!second.alive, 'Three-cell chain must fire on wave arrival');
    advance(80);
    check(!grid.cells[4][1].isDangerCell && grid.cells[4][1].cellContains !== Game.MAP.BOMB, 'Chain cleanup');

    const pairs = [];
    for (const round of [1,2,3]) { start(round); pairs.push(Game.SETTINGS.WEAPON_CHANCES.map(x => x.name)); }
    check(new Set(pairs.flat()).size === 6, 'Six weapons over three rounds');
    ({p, grid, state} = start());
    state.scoreManager.addLeftOverTime(30000, p.playerID);
    check(state.scoreManager.leftOverScores[p.playerID] === 1500, '150 remaining seconds -> 1500 points');
    const victim = grid.players[1]; victim.invincible = false; victim.shieldActive = true;
    victim.gridCell.isDangerCell = true; victim.gridCell.dangerOwner = p;
    victim.checkDangerZone();
    check(!victim.dead && victim.lives === 1 && state.scoreManager.killScores[p.playerID] === 1000, 'Shield hit credits the original score');
    victim.checkDangerZone(); check(state.scoreManager.killScores[p.playerID] === 1000, 'Invulnerability prevents duplicate scoring');
    return { check: 'actual movement, delayed chain, weapon cycle, time bonus and shield score', speeds, pairs, timeBonus: 1500 };
  }));

  // Run unmodified AI against actual randomized boards. A fresh browser then
  // replays the same full input stream, as a reconnecting client would.
  const peer = await open();
  for (const difficulty of [0,1,2]) {
    const config = { seed: `classic-ai-${difficulty}`, difficulty, round: 2,
      campaignSeed: 'A1B2C3D4E5',
      scores: [0,0,0,0], players: [{ seat: 0, character: 2 }] };
    const run = async tab => tab.evaluate(config => {
      onlineBridge.start(config);
      const hashes = [], game = Game.App.getInstance();
      let moves = 0, bombs = 0;
      const initial = game.state.getCurrentState().grid.players.map(p => [p.x, p.y]);
      for (let frame = 1; frame <= 1200; frame++) {
        onlineBridge.advance([frame, [0,0,0,0]], true);
        if (frame % 60 === 0) {
          hashes.push(onlineBridge.checksum());
          const grid = game.state.getCurrentState().grid;
          if (grid) {
            moves += grid.players.filter((p,i) => p.isAI && (p.x !== initial[i][0] || p.y !== initial[i][1])).length;
            bombs += grid.bombs.length;
          }
        }
      }
      return { hashes, moves, bombs, result: onlineBridge.result };
    }, config);
    const first = await run(page), replay = await run(peer);
    assert.deepEqual(replay, first, `Difficulty ${difficulty}: fresh replica must exactly replay AI and effects`);
    assert.ok(first.moves > 0, `Difficulty ${difficulty}: AI must move`);
    assert.ok(first.bombs > 0, `Difficulty ${difficulty}: AI must place bombs`);
    evidence.push({ check: '20-second actual AI run and fresh replica replay', difficulty, ...first });
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'results.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally { await browser.close(); }
