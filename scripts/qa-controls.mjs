/* Focused actual-engine fixtures for controls, lives and hidden promotions.
   Run after all source changes and npm run build, with the server running.
   BASE_URL=http://localhost:3000 node scripts/qa-controls.mjs
   Optional: PLAYWRIGHT_MODULE, CHROME_BIN, QA_OUTPUT_DIR.
   These isolated fixtures clear a corridor and disable enemy attacks so tests
   observe the real item/input methods without random enemies ending a round. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseURL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const output = resolve(process.env.QA_OUTPUT_DIR || resolve(root, '.local', 'controls-qa'));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const evidence = { baseURL, startedAt: new Date().toISOString(), checks: [] }, errors = [];
const record = (name, detail = {}) => {
  evidence.checks.push({ name, ...detail });
  console.log('PASS ' + name + (Object.keys(detail).length ? ' ' + JSON.stringify(detail) : ''));
};
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined, headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', error => errors.push(error.stack || error.message));

async function loadMenu() {
  await page.goto(baseURL + '/game/');
  await page.waitForFunction(() => window.onlineBridge?.state === 'mainMenuState');
  await page.evaluate(() => onlineBridge.sound(false));
}

async function start(online = true, humans = 4) {
  await page.keyboard.up('Space'); await page.keyboard.up('ArrowRight');
  await page.evaluate(({ online, humans }) => {
    const game = Game.App.getInstance();
    window.__controlsPreviousGrid = game.state.getCurrentState().grid;
    if (online) onlineBridge.start({ difficulty: 1, tickRate: 60, round: 1, scores: [0, 0, 0, 0], seed: 'controls-qa',
      players: Array.from({ length: humans }, (_, seat) => ({ seat, character: seat, name: `P${seat + 1}` })) }, 0);
    else {
      Game.Instances.DataManager.getTutorialComplete = () => true;
      Game.PlayerAI.prototype.update = Game.Player.prototype.update;
      game.input.keyboard.start(); game.input.enabled = true;
      game.state.start('gameplayState', true, false, Game.GAME_MODE.ARCADE, 1,
        Game.PLAYER_MODE.SINGLE_PLAYER, Game.MAP_THEME.RANDOM, [0], 1);
    }
  }, { online, humans });
  // Phaser queues native state.start() until its next logic update. A previous
  // gameplay scene already has four players, so checking only their count can
  // capture that old grid just before shutdown destroys its animation children.
  await page.waitForFunction(() => {
    const state = Game.App.getInstance().state.getCurrentState(), grid = state.grid;
    return grid && grid !== window.__controlsPreviousGrid && grid.players?.length === 4 &&
      state.uiPlayerLives?.length === 4 &&
      grid.players.every(player => Ph2.AnimationSystem.findObject('hero_powerup', player.animationPowerups));
  });
  await page.evaluate(() => {
    const game = Game.App.getInstance(), state = game.state.getCurrentState(), grid = state.grid;
    for (const box of grid.boxes) box.destroy(); grid.boxes = [];
    for (const column of grid.cells) for (const cell of column) {
      cell.cellContains = Game.MAP.FREE; cell.isEmpty = true; cell.isDangerCell = false;
      cell.isFreezeCell = false; cell.isItemCell = false; grid.astarGrid.grid[cell.gridPositionX][cell.gridPositionY].weight = 1;
    }
    for (const player of grid.players) {
      player.invincible = true; player.invincibilityTimer = -1e8; player.initialBlinking = false;
      player.gameStatus = Game.GAME_STATUS.PLAYING;
    }
    const player = grid.players[0]; player.direction = Game.DIRECTION.RIGHT;
    player.inputController.inputDisabled = false;
    const placements = [];
    const putBomb = player.putBomb;
    player.putBomb = function () {
      const count = grid.bombs.length; const result = putBomb.call(this);
      if (grid.bombs.length > count) placements.push([this.gridPositionX, this.gridPositionY]);
      return result;
    };
    window.__controlsQA = { game, state, grid, player, placements };
  });
}

async function advance(count, mask = 0) {
  await page.evaluate(({ count, mask }) => {
    for (let i = 0; i < count; i++) onlineBridge.advance([onlineBridge.frame + 1, [mask, 0, 0, 0]], true);
  }, { count, mask });
}
const stats = () => page.evaluate(() => {
  const { player, placements, grid } = __controlsQA;
  return { placements: placements.slice(), bombs: grid.bombs.length, uses: player.weaponCurrentUses,
    weaponActive: player.weaponActive, x: player.gridPositionX, y: player.gridPositionY };
});

async function assertPromotion(label) {
  const result = await page.evaluate(() => {
    const state = Game.App.getInstance().state.getCurrentState();
    const button = state.buttonBombit2 || state.buttonBombIt2;
    if (!button) return { found: false };
    button.visible = true;
    return { found: true, visible: button.visible, inputEnabled: button.inputEnabled,
      children: (button.children || []).map(child => ({ name: child.name, visible: child.worldVisible })) };
  });
  assert(result.found, label + ': original promotion fixture missing');
  assert.equal(result.visible, false, label + ': promotion became visible');
  assert.equal(result.inputEnabled, false, label + ': promotion still accepts pointer input');
  record(label, result);
}

try {
  await loadMenu();
  await assertPromotion('main-menu promotion hidden');
  await page.evaluate(() => {
    const state = Game.App.getInstance().state.getCurrentState();
    state.selectNewGame(); state.selectPlayerMode(state.button2Player);
    for (const frame of ['esp.png', 'hol.png', 'eng.png']) { state.flagSelected.frameName = frame; state.changeLanguage(); state.resize(); }
  });
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForTimeout(100);
  await assertPromotion('promotion stays hidden after native settings, languages and resize');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: resolve(output, 'menu-without-promotion.png') });

  // The native branch receives actual browser keyboard events; it has no room
  // or replay input. Two bombs must be placed while moving under one key hold.
  await loadMenu(); await start(false);
  await page.evaluate(() => { __controlsQA.player.bombs = 2; });
  await page.locator('canvas').click({ position: { x: 620, y: 360 } });
  await page.keyboard.down('Space'); await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(700);
  const nativeHeld = await stats();
  assert.equal(nativeHeld.placements.length, 2, 'Native Space hold must place consecutive bombs up to capacity');
  assert.equal(new Set(nativeHeld.placements.map(String)).size, 2, 'Native hold must respect occupied cells');
  await page.keyboard.up('Space');
  await page.waitForTimeout(200); await page.keyboard.up('ArrowRight');
  assert.equal((await stats()).placements.length, 2, 'Native key release must stop repeated bombs');
  record('native real-key Space hold, map limit, capacity and release', nativeHeld);

  await start(false); await page.evaluate(() => { __controlsQA.player.bombs = 0; });
  await page.keyboard.down('Space'); await page.waitForTimeout(60);
  await page.evaluate(() => __controlsQA.player.createWeapon(Game.ITEM_TYPE.FIRE));
  await page.waitForTimeout(150); assert.equal((await stats()).uses, 0);
  await page.keyboard.up('Space'); await page.keyboard.down('Space');
  await page.waitForTimeout(250); assert.equal((await stats()).uses, 1);
  await page.keyboard.up('Space');
  record('native held Space does not activate a newly acquired skill; a fresh press fires once');

  await loadMenu(); await start();
  const initialLives = await page.evaluate(() => ({ lives: __controlsQA.grid.players.map(p => p.lives),
    display: __controlsQA.state.uiPlayerLives.map(text => text.text) }));
  assert.deepEqual(initialLives, { lives: [1, 1, 1, 1], display: ['1', '1', '1', '1'] });
  const pickups = await page.evaluate(() => {
    const { game, state, grid, player } = __controlsQA;
    const types = [['BOMB', 'powerup_bomb'], ['POWER', 'powerup_bigger_explosion'], ['SPEED', 'powerup_fast'],
      ['SHIELD', 'powerup_shield'], ['KICK_BOMBS', 'powerup_push'], ['HEART', 'powerup_life']];
    return types.map(([type, key]) => {
      const cell = player.gridCell, item = new Game.Item(game, cell, key, Game.ITEM_TYPE[type]);
      cell.cellContains = Game.MAP.ITEM; cell.isItemCell = true;
      grid.rowsGroup[cell.gridPositionY].add(item); grid.items.push(item);
      player.checkItemPickUp();
      return { type, lives: player.lives, display: state.uiPlayerLives[0].text, remainingItems: grid.items.length };
    });
  });
  for (const pickup of pickups) {
    assert.equal(pickup.lives, pickup.type === 'HEART' ? 2 : 1);
    assert.equal(pickup.display, String(pickup.lives)); assert.equal(pickup.remainingItems, 0);
  }
  record('online one initial life; actual pickups update the life display only for hearts', { initialLives, pickups });

  await start(); await page.evaluate(() => { __controlsQA.player.bombs = 2; });
  await advance(60, 24);
  const onlineHeld = await stats();
  assert.equal(onlineHeld.placements.length, 2); assert.equal(new Set(onlineHeld.placements.map(String)).size, 2);
  await advance(20, 8); assert.equal((await stats()).placements.length, 2);
  record('online held-bomb placement, capacity, occupied cells and release', onlineHeld);

  // All original skill classes run normally. Holding must not consume a second
  // charge or turn a depleted one-charge skill into a stream of ordinary bombs.
  const skills = [];
  for (const type of ['GRENADE', 'ROCKET', 'FIRE', 'FREEZE', 'MINE', 'BATTERY']) {
    await start();
    await page.evaluate(type => __controlsQA.player.createWeapon(Game.ITEM_TYPE[type]), type);
    await advance(1, 48); await advance(45, 16);
    const held = await stats();
    assert.equal(held.uses, 1, type + ': holding must activate exactly once');
    assert.equal(held.placements.length, 0, type + ': holding must not switch to ordinary bombs');
    skills.push({ type, uses: held.uses, bombs: held.placements.length });
  }
  record('all six original skill classes retain one activation per press', { skills });

  await start(); await page.evaluate(() => { __controlsQA.player.bombs = 0; });
  await advance(1, 48);
  await page.evaluate(() => __controlsQA.player.createWeapon(Game.ITEM_TYPE.FIRE));
  await advance(30, 16); assert.equal((await stats()).uses, 0);
  await advance(1, 0); await advance(1, 48); assert.equal((await stats()).uses, 1);
  await advance(10, 16); assert.equal((await stats()).uses, 1);
  await advance(1, 48); assert.equal((await stats()).uses, 2);
  record('holding does not auto-fire a newly acquired skill; bit 32 preserves a rapid repress');

  await start();
  await page.evaluate(() => { __controlsQA.player.frozen = true; });
  await advance(12, 16); assert.equal((await stats()).placements.length, 0);
  await page.evaluate(() => { __controlsQA.player.frozen = false; __controlsQA.player.dead = true; });
  await advance(12, 48); assert.equal((await stats()).placements.length, 0);
  record('held action still respects frozen and dead players');

  await start();
  await page.evaluate(() => __controlsQA.state.gameOver(true));
  await advance(310);
  assert.equal(await page.evaluate(() => onlineBridge.state), 'gameOverState');
  const resultPromo = await page.evaluate(() => {
    const state = Game.App.getInstance().state.getCurrentState();
    return { scoreVisible: state.uiScore.visible, highscoreVisible: state.uiHighscores.visible };
  });
  assert.equal(resultPromo.scoreVisible, true); assert.equal(resultPromo.highscoreVisible, false);
  record('online next-round result keeps the original highscore promotion subtree hidden', resultPromo);
  // The original finished-campaign/highscore branch creates a different promo
  // control from the next-round score screen. Exercise that branch explicitly.
  await loadMenu(); await start(false);
  await page.evaluate(() => {
    const { game, state } = __controlsQA;
    game.state.start('gameOverState', true, false, state.gameMode, state.difficulty,
      Game.PLAYER_MODE.SINGLE_PLAYER, state.grid.mapTheme, [0], state.scoreManager, true, Game.GAME_END.LOSE, 1);
  });
  await page.waitForFunction(() => onlineBridge.state === 'gameOverState' && Game.App.getInstance().state.getCurrentState().buttonBombIt2);
  await page.evaluate(() => { const state = Game.App.getInstance().state.getCurrentState(); state.localizeUI(); state.resize(); });
  await assertPromotion('native results promotion hidden after localization and resize');
  assert.deepEqual(errors, [], 'Engine runtime errors');
  evidence.ok = true;
} catch (error) {
  evidence.ok = false; evidence.error = error.stack || String(error);
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  evidence.errors = errors; evidence.finishedAt = new Date().toISOString();
  await writeFile(resolve(output, 'controls-qa-results.json'), JSON.stringify(evidence, null, 2) + '\n');
  await browser.close();
}
