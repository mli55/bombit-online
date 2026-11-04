/* Multi-bomb clock regression against the actual Phaser scene traversal.
   Run with a server; supports BASE_URL, PLAYWRIGHT_MODULE, CHROME_BIN, QA_OUTPUT_DIR. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined, headless: true });
const base = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const output = resolve(process.env.QA_OUTPUT_DIR || '.local/bomb-timers-qa');
await mkdir(output, { recursive: true });
const errors = [];
try {
  const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/game/');
  await page.waitForFunction(() => window.onlineBridge?.state === 'mainMenuState');
  await page.evaluate(() => {
    const game = Game.App.getInstance();
    const audit = window.__timerAudit = { step: 0, duplicate: [], explosions: [], ends: [], seen: new WeakMap() };
    const updateLogic = game.updateLogic;
    game.updateLogic = function (...args) { audit.step++; return updateLogic.apply(this, args); };
    for (const name of ['Bomb','BombExplosion','WeaponExplosion','PlayerHuman','PlayerAI']) {
      const update = Game[name].prototype.update;
      Game[name].prototype.update = function (...args) {
        if (audit.seen.get(this) === audit.step) audit.duplicate.push({ name, step: audit.step });
        audit.seen.set(this, audit.step);
        return update.apply(this, args);
      };
    }
    const explode = Game.Bomb.prototype.explode;
    Game.Bomb.prototype.explode = function () {
      this.bombExplosion.auditBorn = audit.step;
      audit.explosions.push({ step: audit.step, fuseMS: this.timer });
      return explode.call(this);
    };
    const end = Game.BombExplosion.prototype.endExplosion;
    Game.BombExplosion.prototype.endExplosion = function () {
      audit.ends.push({ frames: audit.step - this.auditBorn, timerMS: this.timer, power: this.power });
      return end.call(this);
    };
    audit.clear = () => { audit.duplicate = []; audit.explosions = []; audit.ends = []; };
    audit.board = () => {
      const state = game.state.getCurrentState(), grid = state.grid;
      for (const box of grid.boxes) box.destroy(); grid.boxes = [];
      for (const col of grid.cells) for (const c of col) {
        c.cellContains = Game.MAP.FREE; c.isEmpty = true; c.isDangerCell = c.isFreezeCell = c.isItemCell = false;
      }
      for (const p of grid.players) { p.invincible = true; p.invincibilityTimer = -1e8; }
      grid.players[0].bombs = 200;
      return { state, grid, p: grid.players[0] };
    };
    audit.put = (i, { grid, p }) => {
      const c = grid.cells[i % 15][Math.floor(i / 15)];
      p.gridCell = c; p.gridPositionX = c.gridPositionX; p.gridPositionY = c.gridPositionY;
      p.x = c.centerX; p.y = c.centerY; p.putBomb();
    };
  });
  const cases = await page.evaluate(() => {
    const audit = __timerAudit, results = [];
    for (const [count, stagger] of [[1,false],[100,false],[10,true],[40,true],[100,true]]) {
      onlineBridge.start({ seed: 'bomb-timers', difficulty: 1, round: 1, campaignSeed: 'timer-room',
        players: [0,1,2,3].map((character,seat) => ({character,seat})), scores: [0,0,0,0] });
      const board = audit.board(); board.p.power = stagger ? 10 : 1; audit.clear();
      const start = audit.step;
      if (!stagger) for (let i = 0; i < count; i++) audit.put(i, board);
      for (let frame = 0; frame < 500; frame++) {
        if (stagger && frame % 3 === 0 && frame / 3 < count) audit.put(frame / 3, board);
        onlineBridge.advance([onlineBridge.frame + 1, [0,0,0,0]], true);
      }
      results.push({ mode: 'online', count, stagger, duplicate: audit.duplicate,
        firstFuseFrames: audit.explosions[0].step - start,
        matchMS: board.state.gameTimer, ends: audit.ends,
        explosionCount: audit.explosions.length,
        minimumFuseMS: Math.min(...audit.explosions.map(e => e.fuseMS)) });
    }
    return results;
  });
  for (const result of cases) {
    assert.deepEqual(result.duplicate, [], 'Every object updates once per simulation frame');
    assert.equal(result.firstFuseFrames, 103, 'The first bomb fuse is independent of bomb count');
    assert.ok(Math.abs(result.matchMS - 500 * 1000 / 60) < 1e-6);
    assert.equal(result.explosionCount, result.count);
    for (const end of result.ends) {
      const expected = (end.power + 10) * 60 / 35;
      assert.ok(end.frames >= Math.floor(expected) && end.frames <= Math.ceil(expected), `Blast duration: ${JSON.stringify(end)}`);
    }
    if (result.stagger) assert.ok(result.minimumFuseMS < 1700, 'Legitimate chain reactions still trigger young bombs');
  }

  // A fresh native Single Player instance exercises Phaser's own clock, rather
  // than the replay API. Populate in the state update before scene traversal.
  await page.reload(); await page.waitForFunction(() => window.onlineBridge?.state === 'mainMenuState');
  await page.evaluate(() => {
    const game = Game.App.getInstance();
    Game.Instances.DataManager.getTutorialComplete = () => true;
    Game.PlayerAI.prototype.update = Game.Player.prototype.update;
    const record = window.__nativeTimers = { step: 0, duplicate: [], seen: new WeakMap(), placed: 0 };
    const updateLogic = game.updateLogic;
    game.updateLogic = function (...args) { record.step++; return updateLogic.apply(this,args); };
    for (const name of ['Bomb','BombExplosion']) {
      const update = Game[name].prototype.update;
      Game[name].prototype.update = function (...args) {
        if (record.seen.get(this) === record.step) record.duplicate.push({ name, step: record.step });
        record.seen.set(this, record.step); return update.apply(this,args);
      };
    }
    const update = Game.GameplayState.prototype.update;
    Game.GameplayState.prototype.update = function (...args) {
      if (!record.start) {
        record.start = record.step;
        for (const box of this.grid.boxes) box.destroy(); this.grid.boxes = [];
        for (const col of this.grid.cells) for (const c of col) { c.cellContains=Game.MAP.FREE;c.isEmpty=true;c.isDangerCell=c.isFreezeCell=c.isItemCell=false; }
        for (const p of this.grid.players) { p.invincible=true;p.invincibilityTimer=-1e8; }
      }
      const elapsed = record.step - record.start;
      if (elapsed % 3 === 0 && record.placed < 40) {
        const i=record.placed++,p=this.grid.players[0],c=this.grid.cells[i%15][Math.floor(i/15)];
        p.bombs=200;p.power=10;p.gridCell=c;p.gridPositionX=c.gridPositionX;p.gridPositionY=c.gridPositionY;p.x=c.centerX;p.y=c.centerY;p.putBomb();
      }
      if (elapsed > 260) record.done = true;
      return update.apply(this,args);
    };
    game.state.start('gameplayState',true,false,Game.GAME_MODE.ARCADE,1,Game.PLAYER_MODE.SINGLE_PLAYER,Game.MAP_THEME.RANDOM,[0],1);
  });
  await page.waitForFunction(() => window.__nativeTimers?.done, null, { timeout: 15000 });
  const native = await page.evaluate(() => ({ mode: 'single', count: __nativeTimers.placed, duplicate: __nativeTimers.duplicate }));
  assert.deepEqual(native.duplicate, []); assert.equal(native.count, 40); cases.push(native);
  assert.deepEqual(errors, []);
  const summary = { baseURL: base, cases: cases.map(({ ends, ...result }) => ({ ...result, blastFrameRange: ends?.length ? [Math.min(...ends.map(e=>e.frames)),Math.max(...ends.map(e=>e.frames))] : undefined })) };
  await writeFile(resolve(output, 'results.json'), JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify(summary,null,2));
} finally { await browser.close(); }
