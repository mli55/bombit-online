/* Real-browser UI/network smoke test. Run after npm run build and npm start.
   BASE_URL=http://localhost:3000 node scripts/qa-ui.mjs
   Optional: PLAYWRIGHT_MODULE, CHROME_BIN, QA_OUTPUT_DIR, QA_RESULT_UI=0.
   The live room is driven only by clicks and keys. A separate, clearly isolated
   engine fixture fast-forwards its public replay API to check the result button. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseURL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const output = resolve(process.env.QA_OUTPUT_DIR || resolve(root, 'docs'));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chrome = process.env.CHROME_BIN || undefined;
const started = Date.now(), evidence = { baseURL, startedAt: new Date().toISOString(), checks: [] }, errors = [];
const contexts = [], pages = [], observations = new Map();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const record = (name, detail = {}) => { evidence.checks.push({ name, ...detail }); console.log('PASS ' + name + (Object.keys(detail).length ? ' ' + JSON.stringify(detail) : '')); };
async function until(check, message, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await delay(60); }
  throw new Error(message);
}
function observe(page, label) {
  const observation = { label, room: null, generation: '', lastFrame: 0, verified: 0, sockets: 0, checks: new Map(), messages: [] };
  observations.set(page, observation);
  page.on('pageerror', error => errors.push({ page: label, message: error.stack || error.message }));
  page.on('console', message => { if (message.type() === 'error' && message.text().startsWith('[bombit-qa-engine]')) errors.push({ page: label, message: message.text() }); });
  page.on('websocket', ws => {
    observation.sockets++;
    if (!/\/ws\//.test(ws.url())) return;
    ws.on('framereceived', ({ payload }) => {
      let message; try { message = JSON.parse(String(payload)); } catch { return; }
      if (message.type === 'room') observation.room = message;
      if (message.type === 'prepare') {
        if (observation.generation !== message.generation) observation.verified = 0;
        observation.generation = message.generation; observation.lastFrame = message.tick || 0;
      }
      if (message.type === 'frame') observation.lastFrame = message.frame[0];
      if (message.type === 'verified') observation.verified = message.tick;
      if (message.type === 'error') observation.messages.push(message.message);
    });
    ws.on('framesent', ({ payload }) => {
      let message; try { message = JSON.parse(String(payload)); } catch { return; }
      if (message.type === 'check') observation.checks.set(`${message.generation}:${message.tick}`, message.hash);
    });
  });
  return observation;
}
async function newPlayer(browser, label, url = baseURL + '/') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  contexts.push(context);
  await context.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.__qaSockets = [];
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) { super(...args); window.__qaSockets.push(this); }
    };
    window.addEventListener('message', event => {
      if (event.data?.source === 'bomb-it-game' && event.data.type === 'error') console.error('[bombit-qa-engine] ' + event.data.message);
    });
  });
  const page = await context.newPage(); pages.push(page); observe(page, label);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { context, page };
}
async function gameFrame(page) {
  if (new URL(page.url()).pathname === '/game/') return page.mainFrame();
  await page.locator('#game-mount iframe').waitFor();
  const element = await page.locator('#game-mount iframe').elementHandle();
  return element ? element.contentFrame() : null;
}
async function stateIs(page, state, timeout = 45000) {
  await until(async () => {
    try { const frame = await gameFrame(page); return frame ? await frame.evaluate(expected => window.onlineBridge?.state === expected, state) : false; }
    catch (error) { if (/Execution context|detached|destroyed|Target closed/.test(error.message)) return false; throw error; }
  }, `Timed out waiting for ${observations.get(page)?.label || 'fixture'} to enter ${state}`, timeout);
}
async function frameNumber(page) { return (await gameFrame(page)).evaluate(() => window.onlineBridge.frame); }
async function setPanel(page, open) {
  if (await page.locator('#network').evaluate(element => element.open) !== open) await page.locator('#network > summary').click();
}
async function nativeClick(page, property) {
  const frame = await gameFrame(page);
  const position = await frame.evaluate(property => {
    const game = Game.App.getInstance(), state = game.state.getCurrentState();
    const target = state[property];
    if (!target || !target.visible) throw new Error('Native control is missing or hidden: ' + property);
    const bounds = target.getBounds(), canvas = game.canvas.getBoundingClientRect();
    return { x: canvas.left + (bounds.x + bounds.width / 2) * canvas.width / game.width,
      y: canvas.top + (bounds.y + bounds.height / 2) * canvas.height / game.height };
  }, property);
  const frameElement = await frame.frameElement().catch(() => null);
  const offset = frameElement ? await frameElement.boundingBox() : { x: 0, y: 0 };
  assert(offset, 'The game iframe must be visible before clicking');
  await page.mouse.click(offset.x + position.x, offset.y + position.y);
}
async function waitRoom(page, predicate, description, timeout = 45000) {
  return until(() => {
    const room = observations.get(page).room;
    if (room && ['fault', 'desync'].includes(room.phase)) throw new Error(`${description}: server entered ${room.phase}; ${observations.get(page).messages.join('; ')}`);
    return room && predicate(room) ? room : false;
  }, description, timeout);
}
async function readyByKeyboard(page, seat) {
  await setPanel(page, false);
  const character = await (await gameFrame(page)).evaluate(() => Game.App.getInstance().state.getCurrentState().playerCursorIndex1);
  await nativeClick(page, 'hero' + (character + 1));
  await page.keyboard.press('Space');
  await waitRoom(page, room => room.players[seat]?.ready, `Player ${seat + 1} did not become ready through Space`);
}
async function commonHash(afterTick = 0) {
  return until(() => {
    const host = observations.get(pages[0]);
    for (const [key, hash] of [...host.checks].reverse()) {
      const tick = Number(key.split(':').at(-1));
      if (tick <= afterTick || !key.startsWith(host.generation + ':')) continue;
      const hashes = pages.slice(0, 4).map(page => observations.get(page).checks.get(key));
      if (hashes.every(Boolean)) {
        assert(hashes.every(value => value === hash), `Four peers diverged at exact tick ${tick}: ${hashes.join(', ')}`);
        if (pages.slice(0, 4).every(page => observations.get(page).verified >= tick)) return { tick, hash };
      }
    }
    return false;
  }, 'Four clients did not verify the same post-reconnection frame/hash', 45000);
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: chrome, headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
try {
  const host = (await newPlayer(browser, 'host')).page;
  await stateIs(host, 'mainMenuState');
  await host.screenshot({ path: resolve(output, 'main-menu.png') });
  assert.equal(await host.locator('#name, input[name="name"]').count(), 0, 'The lobby must not ask players to choose names');
  await setPanel(host, false);
  assert.equal(await host.locator('#network').isHidden(), true, 'The main menu must not show networking before Multiplayer');
  await nativeClick(host, 'buttonStartGame');
  await nativeClick(host, 'button2Player');
  await host.screenshot({ path: resolve(output, 'difficulty-menu.png') });
  await until(() => host.locator('#network').isVisible(), 'Multiplayer must reveal room controls');
  await nativeClick(host, 'buttonNormal');
  await stateIs(host, 'characterSelectState');
  await setPanel(host, false);
  const code = new URL(await host.locator('#invite').inputValue()).searchParams.get('room');
  assert.match(code || '', /^[0-9A-F]{10}$/);
  assert.equal(new URL(host.url()).searchParams.has('room'), false, 'Creating a room must not make refresh join it again');
  await waitRoom(host, room => room.settings.difficulty === 1, 'Native NORMAL button did not create a room at normal difficulty');
  // Choose blue while it is vacant. Later joins must fill the remaining colors.
  await nativeClick(host, 'hero3');
  await waitRoom(host, room => room.players[0]?.character === 2, 'Clicking the original blue robot did not select blue');
  record('Native Multiplayer and difficulty create a room; native robot selects blue', { room: code });
  const guests = [], names = ['P1', 'P2', 'P3', 'P4'];
  for (let seat = 1; seat < 4; seat++) {
    const guest = await newPlayer(browser, `guest-${seat}`, `${baseURL}/?room=${code}`); guests.push(guest);
    assert.equal(await guest.page.locator('#name, input[name="name"]').count(), 0, 'Joining must not require a name');
    await stateIs(guest.page, 'characterSelectState');
    await waitRoom(guest.page, room => room.players[seat]?.name === names[seat], `Guest ${seat} did not join its seat`);
    assert.equal(new URL(guest.page.url()).searchParams.has('room'), false, 'An invitation must be consumed after opening it');
    assert.equal(await guest.page.evaluate(() => sessionStorage.getItem('bomb-it-room')), null, 'Joining must not persist a room identity');
  }
  await waitRoom(host, room => room.players.filter(Boolean).length === 4, 'All four original selectors must share one room');
  const characters = observations.get(host).room.players.map(player => player.character);
  assert.equal(new Set(characters).size, 4);
  assert.deepEqual(observations.get(host).room.players.map(player => player.name), names, 'Players must be automatically named P1–P4 by seat');
  for (let i = 0; i < guests.length; i++) await readyByKeyboard(guests[i].page, i + 1);
  await nativeClick(host, 'buttonMobile');
  await waitRoom(host, room => room.players.every(player => player?.ready), 'Host native confirmation did not ready every player');
  await until(async () => (await (await gameFrame(host)).evaluate(() => Game.App.getInstance().state.getCurrentState().onlineConfirmText.text)) === 'START', 'Native confirm button did not switch to START');
  await host.locator('#notice').waitFor({ state: 'hidden' });
  await host.screenshot({ path: resolve(output, 'online-lobby.png') });
  record('Four original character selectors, Space readiness, and native START', { characters });
  await nativeClick(host, 'buttonMobile');
  await Promise.all(pages.slice(0, 4).map(page => stateIs(page, 'gameplayState')));
  await waitRoom(host, room => room.phase === 'playing', 'Four players did not start together');
  const initialSync = await commonHash();
  assert.match(await host.locator('#sync').textContent(), /状态一致/);
  const beforeFrame = await frameNumber(host), beforeTime = performance.now();
  await delay(1000);
  const afterFrame = await frameNumber(host), elapsed = performance.now() - beforeTime;
  const fps = (afterFrame - beforeFrame) * 1000 / elapsed;
  assert(fps >= 48 && fps <= 70, `Expected about 60 ordered frames/sec; observed ${fps.toFixed(2)}`);
  await host.screenshot({ path: resolve(output, 'online-battle.png') });
  record('Real-time 60 Hz room and matching four-client hashes', { frames: afterFrame - beforeFrame, elapsedMs: Math.round(elapsed), fps: Number(fps.toFixed(2)), ...initialSync });

  const disconnected = guests[0], disconnectStart = Date.now();
  const beforeDisconnect = await frameNumber(host);
  await disconnected.context.setOffline(true);
  // Some Chrome versions leave existing WebSockets open under network emulation.
  // Close only the captured transport so reconnect retains this document's identity.
  await disconnected.page.evaluate(() => {
    window.__qaReconnectDocument = true;
    for (const ws of window.__qaSockets) if (ws.readyState === WebSocket.OPEN) ws.close(4000, 'QA connection interruption');
  });
  await waitRoom(host, room => !room.players[1]?.online, 'The server did not notice the disconnected browser', 10000);
  await delay(Math.max(0, 5000 - (Date.now() - disconnectStart)));
  const duringDisconnect = await frameNumber(host);
  assert(duringDisconnect > beforeDisconnect + 180, 'The connected players stopped while another player was offline');
  assert.match((await host.locator('#roster').textContent()) + (await host.locator('#connection').textContent()), /掉线/);
  record('Disconnected player is labeled and the other players keep running', { advancedFrames: duringDisconnect - beforeDisconnect, offlineMs: Date.now() - disconnectStart });
  await disconnected.context.setOffline(false);
  await stateIs(disconnected.page, 'gameplayState');
  await waitRoom(host, room => room.players[1]?.online && room.players[1]?.prepared, 'Returning player did not finish deterministic catch-up');
  assert.equal(await disconnected.page.evaluate(() => window.__qaReconnectDocument), true, 'Transient reconnect must retain the same document');
  const recoveredSync = await commonHash(duringDisconnect);
  record('Reconnect catches up to an exact shared frame and checksum', recoveredSync);

  await setPanel(host, false);
  await nativeClick(host, 'buttonPause');
  await Promise.all(pages.slice(0, 4).map(page => waitRoom(page, room => room.phase === 'paused', 'Native pause did not pause every player')));
  await delay(120);
  const pausedFrames = await Promise.all(pages.slice(0, 4).map(frameNumber));
  await delay(600);
  assert.deepEqual(await Promise.all(pages.slice(0, 4).map(frameNumber)), pausedFrames, 'Some replica advanced while the room was paused');
  assert.equal(new Set(pausedFrames).size, 1, 'Peers paused at different ordered frames');
  // Close the small network panel so it cannot cover the native canvas button.
  await setPanel(host, false); await nativeClick(host, 'buttonPause');
  await waitRoom(host, room => room.phase === 'playing', 'Native pause button did not resume the room');
  await until(async () => await frameNumber(host) > pausedFrames[0] + 30, 'The resumed room did not advance');
  record('Original pause button pauses and resumes all four replicas', { pausedAt: pausedFrames[0] });

  // Change only difficulty through the original menu, preserving the room and
  // its four automatic player identities through the Multiplayer branch.
  await setPanel(host, true); await host.locator('#back').click();
  await Promise.all(pages.slice(0, 4).map(page => stateIs(page, 'characterSelectState')));
  await setPanel(host, true); await host.locator('#difficulty-settings').click();
  await stateIs(host, 'mainMenuState');
  await nativeClick(host, 'buttonStartGame');
  await nativeClick(host, 'button2Player');
  await nativeClick(host, 'buttonHard');
  await stateIs(host, 'characterSelectState');
  await waitRoom(host, room => room.settings.difficulty === 2 && room.players.filter(Boolean).length === 4,
    'The original difficulty selector must preserve all four joined players');
  assert.equal(new URL(await host.locator('#invite').inputValue()).searchParams.get('room'), code, 'Changing difficulty must preserve the room invitation');
  assert.deepEqual(observations.get(host).room.players.map(player => player.name), names);
  for (let i = 0; i < guests.length; i++) await readyByKeyboard(guests[i].page, i + 1);
  await nativeClick(host, 'buttonMobile');
  await waitRoom(host, room => room.players.every(player => player?.ready), 'All four players must be ready after changing difficulty');
  await until(async () => (await (await gameFrame(host)).evaluate(() => Game.App.getInstance().state.getCurrentState().onlineConfirmText.text)) === 'START', 'The updated room did not expose native START');
  await nativeClick(host, 'buttonMobile');
  await Promise.all(pages.slice(0, 4).map(page => stateIs(page, 'gameplayState')));
  await waitRoom(host, room => room.phase === 'playing' && room.settings.difficulty === 2, 'Four players failed to start at the new difficulty');
  const difficultySync = await commonHash();
  record('Native difficulty changes preserve P1–P4 and synchronized play', difficultySync);

  // A separate browser follows the untouched original single-player path. It
  // must neither open a WebSocket nor display the multiplayer room controls.
  const solo = await newPlayer(browser, 'original-single-player');
  await stateIs(solo.page, 'mainMenuState');
  assert.equal(await solo.page.locator('#network').isHidden(), true);
  await nativeClick(solo.page, 'buttonStartGame');
  await nativeClick(solo.page, 'button1Player');
  await nativeClick(solo.page, 'buttonNormal');
  await stateIs(solo.page, 'characterSelectState');
  await nativeClick(solo.page, 'hero1');
  await solo.page.keyboard.press('ArrowRight');
  await until(async () => (await (await gameFrame(solo.page)).evaluate(() => Game.App.getInstance().state.getCurrentState().playerCursorIndex1)) === 1,
    'Original single-player arrow keys did not select a character');
  await solo.page.keyboard.press('Space');
  await stateIs(solo.page, 'gameplayState');
  assert.equal(await (await gameFrame(solo.page)).evaluate(() => window.onlineBridge.online), false,
    'Original Single Player must not activate deterministic network input');
  await until(async () => (await (await gameFrame(solo.page)).evaluate(() => {
    const state = Game.App.getInstance().state.getCurrentState();
    return !state.showingTutorial && state.gameStatus === Game.GAME_STATUS.PLAYING;
  })), 'The original first-run tutorial did not finish', 12000);
  await solo.page.keyboard.down('ArrowLeft');
  await until(async () => (await (await gameFrame(solo.page)).evaluate(() => {
    const player = Game.App.getInstance().state.getCurrentState().grid.players.find(player => player instanceof Game.PlayerHuman);
    return player.inputController.leftPressed;
  })), 'Single Player did not receive its original movement key');
  await solo.page.keyboard.up('ArrowLeft');
  await until(async () => (await (await gameFrame(solo.page)).evaluate(() => {
    const player = Game.App.getInstance().state.getCurrentState().grid.players.find(player => player instanceof Game.PlayerHuman);
    return !player.inputController.leftPressed;
  })), 'Single Player did not release its original movement key');
  const soloState = await (await gameFrame(solo.page)).evaluate(() => {
    const game = Game.App.getInstance(), state = game.state.getCurrentState();
    return { humans: state.grid.players.filter(player => player instanceof Game.PlayerHuman).length,
      character: state.characters[0], timer: state.gameTimer };
  });
  assert.equal(soloState.humans, 1); assert.equal(soloState.character, 1);
  await delay(600);
  const soloTimer = await (await gameFrame(solo.page)).evaluate(() => Game.App.getInstance().state.getCurrentState().gameTimer);
  assert(soloTimer > soloState.timer + 200, 'Original single-player logic must advance without server frames');
  assert.equal(observations.get(solo.page).sockets, 0, 'Single Player must not create any WebSocket');
  assert.equal(observations.get(solo.page).room, null);
  assert.equal(await solo.page.locator('#network').isHidden(), true, 'Single Player must keep room controls hidden');
  await nativeClick(solo.page, 'buttonPause');
  await until(async () => (await (await gameFrame(solo.page)).evaluate(() => Game.App.getInstance().state.getCurrentState().gameStatus === Game.GAME_STATUS.PAUSED)),
    'The original Single Player pause button did not pause');
  const pausedSoloTimer = await (await gameFrame(solo.page)).evaluate(() => Game.App.getInstance().state.getCurrentState().gameTimer);
  await delay(250);
  assert.equal(await (await gameFrame(solo.page)).evaluate(() => Game.App.getInstance().state.getCurrentState().gameTimer), pausedSoloTimer);
  await nativeClick(solo.page, 'buttonPause');
  await until(async () => (await (await gameFrame(solo.page)).evaluate(() => Game.App.getInstance().state.getCurrentState().gameStatus === Game.GAME_STATUS.PLAYING)),
    'The original Single Player pause button did not resume');
  record('Original Single Player tutorial, character keys, movement input, and pause work without networking', { character: soloState.character, humans: soloState.humans });
  await solo.context.close();

  if (process.env.QA_RESULT_UI !== '0') {
    // A separate engine fixture avoids waiting three real minutes or altering the
    // real room. This is the same public start/replay interface used by qa.html.
    const fixture = (await newPlayer(browser, 'native-result-fixture', baseURL + '/game/')).page;
    await stateIs(fixture, 'mainMenuState');
    await fixture.evaluate(async () => {
      window.__qaContinueRequests = 0;
      window.addEventListener('message', event => {
        if (event.data?.source === 'bomb-it-game' && event.data.type === 'continue-request') window.__qaContinueRequests++;
      });
      const bridge = window.onlineBridge;
      bridge.start({ difficulty: 1, tickRate: 60, round: 1, scores: [0, 0, 0, 0], seed: 'native-next-round-ui',
        players: Array.from({ length: 4 }, (_, seat) => ({ seat, character: seat, name: 'P' + (seat + 1) })) }, 0);
      for (let tick = 1; tick <= 12000 && !bridge.result; tick++) {
        bridge.advance([tick, [0, 0, 0, 0]], true);
        if (tick % 240 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
    });
    await stateIs(fixture, 'gameOverState');
    await fixture.screenshot({ path: resolve(output, 'round-result.png') });
    const result = await fixture.evaluate(() => ({ result: window.onlineBridge.result, text: Game.App.getInstance().state.getCurrentState().textButton.text }));
    assert.equal(result.result.canContinue, true); assert.equal(result.text, 'NEXT ROUND');
    await nativeClick(fixture, 'buttonNextLevel');
    await until(() => fixture.evaluate(() => window.__qaContinueRequests === 1), 'Clicking original NEXT ROUND did not emit a single continuation request');
    record('Isolated original score screen and clickable NEXT ROUND', { simulatedFrame: await frameNumber(fixture) });
  }
  // Reload is deliberately different from a transient socket failure. Test a
  // consumed invitation and the URL/storage left behind by an older release.
  for (const [page, legacyURL] of [[guests[0].page, false], [host, true]]) {
    const beforeSockets = observations.get(page).sockets;
    await page.evaluate(({ code, legacyURL }) => {
      sessionStorage.setItem('bomb-it-room', JSON.stringify({ code, token: 'legacy-room-token', seat: 0 }));
      if (legacyURL) history.replaceState(null, '', `?room=${code}`);
    }, { code, legacyURL });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await stateIs(page, 'mainMenuState');
    await delay(1500);
    assert.equal(await page.locator('#network').isHidden(), true, 'Refreshing must return to the original menu with room controls hidden');
    assert.equal(new URL(page.url()).searchParams.has('room'), false, 'Refreshing must remove an old room query');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('bomb-it-room')), null, 'Refreshing must discard any legacy room identity');
    assert.equal(observations.get(page).sockets, beforeSockets, 'Refreshing must not reconnect or join another seat');
    assert.equal(await (await gameFrame(page)).evaluate(() => window.onlineBridge.online), false, 'Refreshing must start the original offline menu');
  }
  record('Fresh invitations join once; refresh forgets the room, clears legacy identity, and opens no WebSocket');
  assert.deepEqual(errors, [], 'Browser or engine runtime errors occurred');
  evidence.completedAt = new Date().toISOString(); evidence.elapsedMs = Date.now() - started;
  await writeFile(resolve(output, 'ui-qa-results.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log('ALL UI QA PASS');
} catch (error) {
  evidence.failure = error.stack || String(error); evidence.runtimeErrors = errors;
  evidence.rooms = [...observations.values()].map(({ label, room, messages }) => ({ label, room, messages }));
  for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: resolve(output, `ui-qa-failure-${i}.png`) }).catch(() => {});
  await writeFile(resolve(output, 'ui-qa-results.json'), JSON.stringify(evidence, null, 2) + '\n');
  throw error;
} finally {
  await browser.close();
}
