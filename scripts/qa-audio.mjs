/* Actual Chrome / Web Audio regression checks. Run after npm run build, with
   npm start already serving the app; this script never starts its own server.
   BASE_URL=http://localhost:3000 node scripts/qa-audio.mjs
   Optional: PLAYWRIGHT_MODULE, CHROME_BIN, QA_OUTPUT_DIR.

   A native AudioBufferSourceNode start/stop/ended trace detects leaked sources,
   including sources scheduled while AudioContext is suspended. This verifies
   browser playback state and routing, not acoustic output or perceived mixing.
   Single-player uses the real UI. Online/replay checks use a separate isolated
   bridge fixture (no room transport); menu return there is a state fixture.
   Chrome is launched twice to cover permitted and gesture-required autoplay. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseURL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const output = resolve(process.env.QA_OUTPUT_DIR || resolve(root, '.local', 'audio-qa'));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const evidence = { baseURL, startedAt: new Date().toISOString(), checks: [], limitations: [
  'No microphone/audio-loopback capture: checks source lifecycle and routing, not perceived sound.',
  'Online start and replay use the production bridge in an isolated engine fixture, without a room server.',
  'Chrome desktop Web Audio only; mobile/Safari and HTMLMediaElement fallback are not covered.'
] };
const browsers = [], pages = [], errors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const record = (name, detail = {}) => {
  evidence.checks.push({ name, ...detail });
  console.log('PASS ' + name + (Object.keys(detail).length ? ' ' + JSON.stringify(detail) : ''));
};

// Install before any application script. Do not fake AudioContext.state,
// resume(), user activation, Howl.play(), or the browser's autoplay decision.
function instrumentSources() {
  const trace = [], records = new Map();
  let nextId = 0;
  const prototype = window.AudioBufferSourceNode?.prototype;
  if (!prototype) throw new Error('This QA requires native Web Audio');
  const nativeStart = prototype.start, nativeStop = prototype.stop;
  function owner(node) {
    for (const howl of window.Howler?._howls || []) for (const sound of howl._sounds || []) {
      if (sound._node?.bufferSource === node) return { src: String(howl._src), sprite: sound._sprite || null };
    }
    return { src: node.buffer?.length === 1 ? 'unlock-buffer' : 'unidentified', sprite: null };
  }
  prototype.start = function (...args) {
    const metadata = owner(this), now = this.context.currentTime;
    const record = { id: ++nextId, node: this, ...metadata, loop: this.loop,
      startAt: Math.max(now, Number(args[0]) || 0), stopAt: Infinity, ended: false,
      duration: this.loop ? Infinity : Number(args[2]) || Math.max(0, (this.buffer?.duration || 0) - (Number(args[1]) || 0)) };
    const result = nativeStart.apply(this, args);
    records.set(this, record);
    trace.push({ action: 'start', id: record.id, ...metadata, loop: record.loop, state: this.context.state });
    this.addEventListener('ended', () => { record.ended = true; trace.push({ action: 'ended', id: record.id, src: record.src }); }, { once: true });
    return result;
  };
  prototype.stop = function (...args) {
    const result = nativeStop.apply(this, args), record = records.get(this);
    if (record) {
      record.stopAt = Math.max(this.context.currentTime, Number(args[0]) || 0);
      trace.push({ action: 'stop', id: record.id, src: record.src, state: this.context.state });
    }
    return result;
  };
  window.__audioQA = {
    trace,
    snapshot() {
      const game = window.Game?.App.getInstance(), manager = game?.ph2AudioManager;
      const active = [...records.values()].filter(record => !record.ended &&
        record.stopAt > record.node.context.currentTime &&
        (record.loop || record.startAt + record.duration > record.node.context.currentTime))
        .map(({ id, src, sprite, loop, node }) => ({ id, src, sprite, loop, context: node.context.state }));
      return { state: window.onlineBridge?.state, context: window.Howler?.ctx?.state,
        active, selected: manager?.musicFile?._src || null, muted: window.Howler?._muted,
        preference: window.Game?.Instances.DataManager?.getAudio(), sfx: manager?.sfxEnabled,
        currentMusic: game?.state.getCurrentState()?.currentMusic?._src || null,
        queued: (window.Howler?._howls || []).filter(howl => /music_/.test(String(howl._src)))
          .map(howl => ({ src: String(howl._src), queue: (howl._queue || []).map(item => item.event),
            resumeListeners: (howl._onresume || []).length })),
        trace: trace.slice() };
    }
  };
}
async function until(check, message, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await delay(50); }
  throw new Error(message);
}
async function launch(policy) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined, headless: true,
    args: ['--autoplay-policy=' + policy, '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  browsers.push(browser); return browser;
}
async function player(browser, label, direct = false) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(instrumentSources);
  const page = await context.newPage(); pages.push({ page, label });
  page.on('pageerror', error => errors.push({ label, message: error.stack || error.message }));
  const cdp = await context.newCDPSession(page), executionContexts = new Map();
  cdp.on('Runtime.executionContextCreated', ({ context }) => {
    if (context.auxData?.isDefault) executionContexts.set(context.auxData.frameId, context.id);
  });
  cdp.on('Runtime.executionContextsCleared', () => executionContexts.clear());
  await cdp.send('Runtime.enable');
  await page.goto(baseURL + (direct ? '/game/' : '/'), { waitUntil: 'domcontentloaded' });
  const frame = await until(() => page.frames().find(frame => frame.url().startsWith(baseURL + '/game/')), 'Game frame did not load');
  const findFrame = tree => tree.frame.url.startsWith(baseURL + '/game/') ? tree.frame :
    (tree.childFrames || []).map(findFrame).find(Boolean);
  const gameFrameId = await until(async () => findFrame((await cdp.send('Page.getFrameTree')).frameTree)?.id, 'Missing game frame ID');
  const executionContextId = await until(() => executionContexts.get(gameFrameId), 'Missing game execution context');
  // Playwright evaluate() enables CDP userGesture and would silently invalidate
  // strict-autoplay tests. Every fixture evaluation uses explicitly false here.
  const evaluate = async (fn, argument) => {
    const result = await cdp.send('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(argument) ?? ''})`,
      contextId: executionContextId, returnByValue: true, awaitPromise: true, userGesture: false });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await until(() => evaluate(() => window.onlineBridge?.state === 'mainMenuState' &&
    Game.Music.MAIN_MENU?.state() === 'loaded' && Game.Music.GAMEPLAY.every(howl => howl.state() === 'loaded')), 'Menu/audio assets did not load');
  return { page, frame, context, label, evaluate };
}
const snapshot = test => test.evaluate(() => __audioQA.snapshot());
const music = state => state.active.filter(source => /music_/.test(source.src));
async function onlyMusic(test, pattern, description) {
  await until(async () => {
    const state = await snapshot(test), sources = music(state);
    return state.context === 'running' && sources.length === 1 && pattern.test(sources[0].src);
  }, description + ': expected exactly one running BGM source');
  await delay(150); // Let delayed resume/play handlers expose duplicated sources.
  const state = await snapshot(test), sources = music(state);
  assert.equal(sources.length, 1, description + ': duplicate native BGM sources');
  assert.match(sources[0].src, pattern, description + ': wrong BGM');
  assert.equal(sources[0].context, 'running');
  return state;
}
async function nativeClick(test, property) {
  const position = await test.evaluate(property => {
    const game = Game.App.getInstance(), button = game.state.getCurrentState()[property];
    if (!button?.visible) throw new Error('Missing visible native button: ' + property);
    const bounds = button.getBounds(), canvas = game.canvas.getBoundingClientRect();
    return { x: canvas.left + (bounds.x + bounds.width / 2) * canvas.width / game.width,
      y: canvas.top + (bounds.y + bounds.height / 2) * canvas.height / game.height };
  }, property);
  const element = await test.frame.frameElement().catch(() => null);
  const offset = element ? await element.boundingBox() : { x: 0, y: 0 };
  assert(offset, 'Native canvas must be visible');
  await test.page.mouse.click(offset.x + position.x, offset.y + position.y);
}
async function startOnline(test) {
  await test.evaluate(() => onlineBridge.start({ difficulty: 1, tickRate: 60, round: 1,
    scores: [0, 0, 0, 0], seed: 'audio-regression',
    players: Array.from({ length: 4 }, (_, seat) => ({ seat, character: seat, name: `P${seat + 1}` })) }, 0));
  await until(() => test.evaluate(() => onlineBridge.state === 'gameplayState'), 'Online gameplay did not start');
}
async function fixtureMenu(test) {
  await test.evaluate(() => {
    const game = Game.App.getInstance();
    game.state.start('mainMenuState', true, false);
    // An online engine deliberately advances state only via its fixed clock.
    if (onlineBridge.online) game.updateLogic(0);
  });
  await until(() => test.evaluate(() => onlineBridge.state === 'mainMenuState'), 'Menu state did not start');
}

await mkdir(output, { recursive: true });
try {
  const allowed = await launch('no-user-gesture-required');
  const solo = await player(allowed, 'autoplay-single-player');
  const initial = await onlyMusic(solo, /music_menu\./, 'Initial menu autoplay');
  assert.equal(initial.active.filter(source => /audiosprite/.test(source.src)).length, 0,
    'An idle menu must not start an unexplained sound-effect source');
  record('Permitted autoplay: entering the menu immediately starts exactly one native menu BGM', { source: music(initial)[0].src });
  await nativeClick(solo, 'buttonStartGame');
  await nativeClick(solo, 'button1Player');
  await nativeClick(solo, 'buttonNormal');
  await solo.frame.waitForFunction(() => onlineBridge.state === 'characterSelectState');
  await onlyMusic(solo, /music_menu\./, 'Single-player character selector');
  await nativeClick(solo, 'hero1'); await solo.page.keyboard.press('Space');
  await solo.frame.waitForFunction(() => onlineBridge.state === 'gameplayState');
  const gameplay = await onlyMusic(solo, /music_gp_level[1-4]\./, 'Native single-player gameplay');
  assert.equal(music(gameplay)[0].src, gameplay.currentMusic, 'Single-player must play the original state-selected track');
  record('Native single-player UI retains menu music through selection, then switches to one original gameplay BGM', { source: gameplay.currentMusic });
  await fixtureMenu(solo);
  await onlyMusic(solo, /music_menu\./, 'Return from single-player gameplay');
  record('Returning from single-player gameplay restores one menu BGM (isolated state return)');
  await solo.context.close();

  const online = await player(allowed, 'online-replay-fixture', true);
  await onlyMusic(online, /music_menu\./, 'Online fixture menu');
  await startOnline(online);
  const onlineState = await onlyMusic(online, /music_gp_level[1-4]\./, 'Online bridge start');
  assert.equal(music(onlineState)[0].src, onlineState.currentMusic, 'Online must play the original state-selected track');
  record('Online start switches exclusively to the original selected gameplay BGM', { source: onlineState.currentMusic });
  // Replay real bomb placement/explosion through advance(), and observe requests
  // above the suppression layer as well as actual native buffer starts below it.
  await online.evaluate(() => {
    const game = Game.App.getInstance(), manager = game.ph2AudioManager;
    const state = game.state.getCurrentState();
    for (const player of state.grid.players) {
      player.invincible = true; player.invincibilityTimer = -1e8;
      player.initialBlinking = false; player.inputController.inputDisabled = false;
    }
    window.__effectRequests = [];
    const play = manager.playEffect;
    manager.playEffect = function (name, ...args) { __effectRequests.push(name); return play.call(this, name, ...args); };
    window.__replayTraceStart = __audioQA.trace.length;
    for (let tick = 1; tick <= 240; tick++) onlineBridge.advance([tick, [tick === 1 ? 16 : 0, 0, 0, 0]], true);
  });
  await delay(150);
  const replay = await online.evaluate(() => ({ requests: __effectRequests,
    starts: __audioQA.trace.slice(__replayTraceStart).filter(item => item.action === 'start' && /audiosprite/.test(item.src)) }));
  assert(replay.requests.includes('put_bomb') && replay.requests.includes('explosion'),
    'Replay fixture must exercise actual bomb placement and explosion effects');
  assert.deepEqual(replay.starts, [], 'Historical replay effects must not start audio buffers');
  const live = await online.evaluate(() => {
    const before = __audioQA.trace.length, startFrame = onlineBridge.frame;
    onlineBridge.advance([startFrame + 1, [16, 0, 0, 0]], false);
    return __audioQA.trace.slice(before).filter(item => item.action === 'start' && /audiosprite/.test(item.src));
  });
  assert(live.some(item => item.sprite === 'put_bomb'), 'Live frames must still play actual bomb placement effects');
  record('Replay suppresses historical put_bomb/explosion sources; live advance still starts a put_bomb source', { replayEffectRequests: replay.requests, liveSources: live.length });
  await fixtureMenu(online); await onlyMusic(online, /music_menu\./, 'Return from online fixture');
  record('Returning from online gameplay restores one menu BGM (isolated state return)');
  await online.context.close();

  const strict = await launch('document-user-activation-required');
  for (const gesture of ['pointer', 'keyboard']) {
    const test = await player(strict, 'strict-' + gesture);
    assert.equal((await snapshot(test)).context, 'suspended', 'Strict autoplay fixture must actually begin suspended');
    if (gesture === 'pointer') await test.page.mouse.click(5, 5);
    else await test.page.keyboard.press('q');
    await onlyMusic(test, /music_menu\./, 'First ' + gesture + ' unlock');
    record('First ' + (gesture === 'pointer' ? 'iframe pointer' : 'parent-page keyboard') + ' gesture unlocks one menu BGM under strict autoplay');
    await test.context.close();
  }

  const deferred = await player(strict, 'strict-menu-to-game-before-unlock', true);
  assert.equal((await snapshot(deferred)).context, 'suspended');
  await startOnline(deferred);
  assert.equal((await snapshot(deferred)).context, 'suspended', 'Programmatic state transitions must not fake user activation');
  await deferred.page.keyboard.press('q');
  const unlocked = await onlyMusic(deferred, /music_gp_level[1-4]\./, 'Deferred menu-to-game transition');
  assert.equal(music(unlocked)[0].src, unlocked.currentMusic);
  // Allow another gesture and an explicit unlock call to expose queued repeats.
  await deferred.page.mouse.click(5, 5);
  await deferred.evaluate(() => onlineBridge.unlockAudio());
  await onlyMusic(deferred, /music_gp_level[1-4]\./, 'Repeated unlock after deferred transition');
  record('Suspended menu → gameplay → first gesture retains only the current track; repeated unlock does not duplicate it');
  await deferred.context.close();

  const muted = await player(strict, 'strict-muted-before-unlock', true);
  assert.equal((await snapshot(muted)).context, 'suspended');
  await muted.evaluate(() => onlineBridge.sound(false));
  await muted.page.keyboard.press('q'); await muted.page.mouse.click(5, 5);
  assert.equal((await snapshot(muted)).muted, true, 'Unlock gestures must preserve the explicit bridge mute setting');
  await muted.evaluate(() => onlineBridge.sound(true));
  await onlyMusic(muted, /music_menu\./, 'Explicit bridge unmute');
  await nativeClick(muted, 'buttonAudio');
  assert.equal((await snapshot(muted)).preference, false, 'Native audio button must save the muted preference');
  await muted.page.keyboard.press('q'); await muted.page.mouse.click(5, 5);
  await muted.evaluate(() => onlineBridge.unlockAudio());
  const nativeMuted = await snapshot(muted);
  assert.equal(nativeMuted.preference, false, 'Unlock must not undo the native audio preference');
  assert.equal(nativeMuted.sfx, false, 'Unlock must not re-enable native sound effects');
  assert.equal(music(nativeMuted).length, 0, 'Native audio-off must stop every music buffer');
  await nativeClick(muted, 'buttonAudio');
  await onlyMusic(muted, /music_menu\./, 'Explicit native unmute');
  record('Bridge mute and native audio-off survive later pointer/keyboard unlocks; explicit unmute restores one BGM');
  await muted.evaluate(() => onlineBridge.disposeAudio());
  await delay(100);
  assert.equal((await snapshot(muted)).active.filter(source => /music_|audiosprite/.test(source.src)).length, 0,
    'Disposing an old game frame must stop all of its actual audio sources');
  record('Disposing a game frame stops its native music/effect sources');
  await muted.context.close();

  assert.deepEqual(errors, [], 'Browser runtime errors occurred');
  evidence.completedAt = new Date().toISOString();
  console.log('ALL AUDIO QA PASS');
} catch (error) {
  evidence.failure = error.stack || String(error); evidence.runtimeErrors = errors;
  evidence.failures = [];
  for (const { page, label } of pages) {
    if (page.isClosed()) continue;
    const frames = [];
    for (const frame of page.frames()) {
      const audio = await frame.evaluate(() => window.__audioQA?.snapshot()).catch(() => null);
      if (audio) frames.push({ url: frame.url(), audio });
    }
    evidence.failures.push({ label, frames });
    await page.screenshot({ path: resolve(output, label + '-failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  await writeFile(resolve(output, 'audio-qa-results.json'), JSON.stringify(evidence, null, 2) + '\n');
  for (const browser of browsers) await browser.close();
}
