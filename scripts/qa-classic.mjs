/* Real-engine regression fixtures, driven through the deterministic replay API.
   Run after npm run build and npm start. No test hooks ship in the game. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined, headless: true });
const base = process.env.BASE_URL || 'http://localhost:3000';
const output = resolve(process.env.QA_OUTPUT_DIR || '.local/classic-qa');
await mkdir(output, { recursive: true });
const errors = [], evidence = [];
try {
  const pages = [];
  for (let i = 0; i < 2; i++) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/game/');
    await page.waitForFunction(() => window.onlineBridge?.state === 'mainMenuState');
    pages.push(page);
  }
  const results = [];
  for (const [seat, page] of pages.entries()) results.push(await page.evaluate(seat => {
    const bridge = window.onlineBridge, game = Game.App.getInstance();
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const advance = n => { for (let i = 0; i < n; i++) bridge.advance([bridge.frame + 1, [0, 0, 0, 0]], true); };
    const config = { seed: 'classic-regression', difficulty: 1, round: 1, scores: [0, 0, 0, 0],
      players: [{ seat: 0, character: 2 }, { seat: 1, character: 0 }] };
    bridge.start(config, seat);
    const state = game.state.getCurrentState();
    for (const p of state.grid.players) p.invincible = true;
    state.grid.players.find(p => p.playerID === 2).dead = true;
    advance(1);
    check(state.gameStatus === Game.GAME_STATUS.PLAYING, 'One human survives: round must continue');
    state.grid.players.find(p => p.playerID === 0).dead = true;
    advance(1);
    check(state.gameStatus === Game.GAME_STATUS.GAME_OVER, 'Both humans dead: end this frame');
    check(state.grid.players.filter(p => !p.dead).length === 2, 'Both CPUs still alive');
    check(Ph2.AnimationSystem.findObject('message/image', state.animationLevelEnd).frameName === 'message2.png', 'Loss banner');
    const cpuPositions = state.grid.players.filter(p => !p.dead).map(p => [p.x, p.y]);
    advance(60);
    check(JSON.stringify(cpuPositions) === JSON.stringify(state.grid.players.filter(p => !p.dead).map(p => [p.x, p.y])), 'CPUs stop playing');
    advance(242);
    check(bridge.state === 'gameOverState', 'Enter score screen');
    check(bridge.result.win === false && bridge.result.winner === null && bridge.result.canContinue, 'Shared losing result allows another round');
    check(bridge.result.scores.every(Number.isFinite), 'Finite scores');
    const score = game.state.getCurrentState();
    check(Ph2.UISystem.findObject('container_title/title', score.uiScore).text === 'YOU LOSE', 'Loss score title');
    return { hash: bridge.checksum(), result: bridge.result };
  }, seat));
  assert.deepEqual(results[0], results[1]);
  evidence.push({ check: 'two humans lose while both CPUs survive; identical results across seats', ...results[0] });
  await pages[0].screenshot({ path: resolve(output, 'you-lose.png') });

  evidence.push(await pages[0].evaluate(() => {
    const bridge = window.onlineBridge, game = Game.App.getInstance();
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const advance = n => { for (let i = 0; i < n; i++) bridge.advance([bridge.frame + 1, [0, 0, 0, 0]], true); };
    for (const count of [1, 2, 3, 4]) {
      const players = [3, 1, 0, 2].slice(0, count).map((character, seat) => ({ character, seat }));
      const config = { seed: 'outcome-cases', difficulty: 1, round: 1, players, scores: [0, 0, 0, 0] };
      bridge.start(config);
      let state = game.state.getCurrentState();
      for (const p of state.grid.players) { p.invincible = true; p.dead = players.some(h => h.character === p.playerID); }
      advance(302);
      check(bridge.result?.humansEliminated && !bridge.result.win, `${count} humans eliminated`);
      bridge.start(config);
      state = game.state.getCurrentState();
      for (const p of state.grid.players) { p.invincible = true; p.dead = p.playerID !== players[0].character; }
      advance(302);
      check(bridge.result?.win && bridge.result.winner === players[0].character, `${count}-human survivor wins`);
    }
    return { check: 'one through four humans: complete elimination and sole human winner, with shuffled characters' };
  }));

  const timing = await pages[0].evaluate(() => {
    const bridge = window.onlineBridge, game = Game.App.getInstance();
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const advance = n => { for (let i = 0; i < n; i++) bridge.advance([bridge.frame + 1, [0, 0, 0, 0]], true); };
    const start = () => {
      bridge.start({ seed: 'timing-regression', difficulty: 1, round: 2, scores: [0, 0, 0, 0],
        players: [0, 1, 2, 3].map((character, seat) => ({ character, seat })) });
      const state = game.state.getCurrentState();
      for (const p of state.grid.players) { p.invincible = true; p.initialBlinking = false; }
      return state;
    };
    let state = start(), p = state.grid.players[0];
    p.putBomb();
    const bomb = state.grid.bombs[0];
    check(bomb, 'Bomb placed');
    let frames = 0;
    while (bomb.alive && frames < 200) { advance(1); frames++; }
    check(frames >= 102 && frames <= 104, `Flash bomb fuse: ${frames} frames`);
    const bombFuseMS = frames * 1000 / 60;

    state = start(); p = state.grid.players[0];
    p.frozen = true; p.frozenTimer = 0;
    advance(180);
    check(p.frozen, 'Still frozen at the old 3-second deadline');
    state.pauseGame(); const frozenTimer = p.frozenTimer;
    advance(120); check(p.frozenTimer === frozenTimer, 'Pause does not spend freeze duration');
    state.unpauseGame(); advance(334); check(p.frozen, 'Frozen before 300 Flash frames');
    advance(1); check(!p.frozen, 'Thaws after 300 Flash frames');
    p.activateSlowDown(); advance(1028); check(p.slowed, 'Slow before 600 Flash frames');
    advance(1); check(!p.slowed, 'Slow ends at 600 Flash frames');

    state = start(); p = state.grid.players[0];
    const bomberCell = state.grid.cells[1][1];
    if (bomberCell.cellContains === Game.MAP.BLOCK) state.grid.destroyBox(bomberCell);
    bomberCell.cellContains = Game.MAP.FREE; bomberCell.isEmpty = true;
    p.gridCell = bomberCell; p.gridPositionX = 1; p.gridPositionY = 1;
    p.x = bomberCell.centerX; p.y = bomberCell.centerY;
    const target = state.grid.players[1], targetCell = state.grid.cells[2][1];
    if (targetCell.cellContains === Game.MAP.BLOCK) state.grid.destroyBox(targetCell);
    targetCell.cellContains = Game.MAP.FREE; targetCell.isEmpty = true;
    target.gridCell = targetCell; target.gridPositionX = 2; target.gridPositionY = 1;
    target.x = targetCell.centerX; target.y = targetCell.centerY;
    target.invincible = target.invulnerable = target.shieldActive = false;
    target.frozen = true; target.frozenTimer = 0;
    p.putBomb(); advance(110);
    check(target.dead && target.frozen, 'A planted bomb kills the frozen opponent before thaw');

    const columns = [];
    for (const weaponType of [Game.ITEM_TYPE.FREEZE, Game.ITEM_TYPE.FIRE]) {
      state = start(); p = state.grid.players[0];
      // Isolated open row so all three original column cells can be created.
      for (let x = 1; x <= 5; x++) {
        const cell = state.grid.cells[x][1];
        if (cell.cellContains === Game.MAP.BLOCK) state.grid.destroyBox(cell);
        cell.isEmpty = true; cell.cellContains = Game.MAP.FREE;
      }
      p.gridCell = state.grid.cells[1][1]; p.gridPositionX = 1; p.gridPositionY = 1;
      p.x = p.gridCell.centerX; p.y = p.gridCell.centerY; p.direction = Game.DIRECTION.RIGHT;
      p.createWeapon(weaponType); p.useWeapon();
      const column = state.grid.weapons[0]; check(column, 'Column fired');
      advance(6); check(column.columnSprites.length === 0, 'No double-speed column creation');
      advance(1); check(column.columnSprites.length === 1, 'First cell after 4 Flash frames');
      state.pauseGame(); const elapsed = column.classicElapsed;
      advance(60); check(column.classicElapsed === elapsed, 'Column pause');
      state.unpauseGame(); advance(76);
      check(column.alive, 'Column remains at 1383 ms');
      advance(1); check(!column.exists, `Column cleared at 1400 ms: ${column.classicElapsed}, alive=${column.alive}, exists=${column.exists}`);
      check(column.usedCells.every(c => weaponType === Game.ITEM_TYPE.FREEZE ? !c.isFreezeCell : !c.isDangerCell), 'No leftover ground effect');
      columns.push({ weaponType, durationMS: 1400 });
    }

    state = start(); p = state.grid.players[0];
    p.createWeapon(Game.ITEM_TYPE.MINE); p.useWeapon();
    const mine = state.grid.mines[0], cell = mine.gridCell;
    advance(10); check(Math.abs(mine.visibleTimer - 10 * 1000 / 60) < 0.01, 'Mine updates once per frame');
    state.grid.destroyMine(cell);
    check(!mine.exists && state.grid.mines.length === 0, 'Mine consumed on detonation');
    check(cell.isDangerCell, 'Short detonation hit window');
    advance(17); check(cell.isDangerCell, '10 Flash frames have not elapsed');
    advance(1);
    check(!cell.isDangerCell && cell.cellContains === Game.MAP.FREE, 'No lingering mine hazard');
    check(state.grid.weaponExplosions.length === 0, 'Spent explosion removed');
    advance(120); check(!cell.isDangerCell, 'Mine never rearms');
    return { bombFuseMS, freezeMS: 515 * 1000 / 60, slowMS: 1029 * 1000 / 60, columns, mineBlastMS: 300 };
  });
  evidence.push({ check: 'actual engine timers, pauses, cleanup and next round', ...timing });
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'results.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally { await browser.close(); }
