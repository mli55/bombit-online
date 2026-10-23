import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the actual final Howler definition shipped by the original game, and its
// Ph2 manager. Only browser events, WebAudio nodes and wall-clock timers are
// substitutes: queued play/resume callbacks and stop/pause are upstream code.
const upstream = readFileSync(new URL('../original/game-libs.min.js', import.meta.url), 'utf8');
const fixes = readFileSync(new URL('../public/audio-fixes.js', import.meta.url), 'utf8');
const howlStart = upstream.indexOf('function(){var e=function(){this.init()};e.prototype=');
const howlEnd = upstream.indexOf('}(),function(n,r){', howlStart);
const managerStart = upstream.indexOf('function(Ph2){var AudioManager=function()');
const managerMarker = 'Ph2.AudioManager=AudioManager}';
const managerEnd = upstream.indexOf(managerMarker, managerStart);
assert.ok(howlStart >= 0 && howlEnd > howlStart, 'Find the final bundled Howler');
assert.ok(managerStart >= 0 && managerEnd > managerStart, 'Find the upstream audio manager');

function fixture({ patched = true, suspended = false } = {}) {
  const timers = new Map(), sources = [], pendingResumes = [];
  let nextTimer = 1;
  class Events {
    listeners = new Map();
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    dispatch(type, event = {}) { for (const fn of [...this.listeners.get(type) || []]) fn(event); }
  }
  class AudioContext extends Events {
    state = suspended ? 'suspended' : 'running';
    currentTime = 0;
    sampleRate = 44100;
    resumeRequests = 0;
    destination = {};
    createGain() {
      return { gain: { value: 1, setValueAtTime(value) { this.value = value; } }, connect() {}, disconnect() {} };
    }
    createBufferSource() {
      const node = { buffer: null, playbackRate: {}, active: false,
        connect() {}, disconnect() {},
        start() { this.active = true; sources.push(this); },
        stop() { this.active = false; },
      };
      return node;
    }
    resume() {
      this.resumeRequests++;
      return this.state === 'running' ? Promise.resolve() : new Promise(resolve => pendingResumes.push(resolve));
    }
    suspend() { this.state = 'suspended'; this.dispatch('statechange'); return Promise.resolve(); }
    close() { this.state = 'closed'; this.dispatch('statechange'); return Promise.resolve(); }
  }
  const browser = new Events();
  Object.assign(browser, { navigator: { userAgent: 'Desktop', platform: 'MacIntel', appVersion: '' }, location: { protocol: 'http:' } });
  const context = vm.createContext({
    window: browser, document: new Events(), AudioContext,
    Audio: class { muted = false; canPlayType() { return 'probably'; } },
    Ph2: {},
    setTimeout(fn, delay = 0) { const id = nextTimer++; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    clearInterval(id) { timers.delete(id); },
  });
  vm.runInContext(`(${upstream.slice(howlStart, howlEnd + 1)})();`, context);
  Object.assign(context, { Howler: browser.Howler, Howl: browser.Howl });
  vm.runInContext(`(${upstream.slice(managerStart, managerEnd + managerMarker.length)})(Ph2);`, context);
  if (patched) vm.runInContext(fixes, context);
  const manager = new context.Ph2.AudioManager({ onPause: { add() {} }, onResume: { add() {} } });
  function flushTimers() {
    for (let i = 0; i < 100; i++) {
      const ready = [...timers].filter(([, timer]) => timer.delay === 0);
      if (!ready.length) return;
      for (const [id, timer] of ready) { timers.delete(id); timer.fn(); }
    }
    assert.fail('Audio event queue did not settle');
  }
  function track(name, { loaded = true, effect = false } = {}) {
    const sound = new context.Howl({ src: [name], preload: false, loop: !effect,
      sprite: effect ? { explosion: [2600, 500], put_bomb: [0, 250] } : { __default: [0, 30000] },
    });
    sound._src = name;
    sound._state = loaded ? 'loaded' : 'loading';
    // Resource decoding is irrelevant to the playback race. WebAudio nodes
    // accept a marker buffer, allowing source starts to identify their track.
    const refresh = sound._refreshBuffer;
    sound._refreshBuffer = function (item) { refresh.call(this, item); item._node.bufferSource.buffer = name; return this; };
    return sound;
  }
  function load(sound) {
    sound._state = 'loaded';
    sound._emit('load');
    sound._loadQueue();
    flushTimers();
  }
  async function resume() {
    context.Howler.ctx.state = 'running';
    context.Howler.ctx.dispatch('statechange');
    for (const resolve of pendingResumes.splice(0)) resolve();
    await Promise.resolve();
    await Promise.resolve();
    flushTimers();
  }
  const active = () => sources.filter(node => node.active).map(node => node.buffer);
  async function idle() {
    for (const [id, timer] of [...timers]) if (timer.delay === 30000) { timers.delete(id); timer.fn(); }
    await Promise.resolve();
    flushTimers();
  }
  return { manager, track, load, resume, idle, active, sources, browser, flushTimers, Howler: context.Howler, audio: browser.bombItAudio };
}

test('upstream stop leaves a deferred menu source that starts with the gameplay music on resume', async () => {
  const { manager, track, resume, active } = fixture({ patched: false, suspended: true });
  const menu = track('menu'), gameplay = track('gameplay');
  manager.playMusic(menu);
  manager.switchMusic(gameplay);
  assert.equal(menu.playing(), false, 'Howler reports the stopped track as inactive');
  await resume();
  assert.deepEqual(active(), ['menu', 'gameplay'], 'Both original resume callbacks still start a source');
});

test('unlock plays only the current scene, even after switching while autoplay was blocked', async () => {
  const { manager, track, resume, active } = fixture({ suspended: true });
  const menu = track('menu'), gameplay = track('gameplay');
  manager.playMusic(menu);
  manager.switchMusic(gameplay);
  await resume();
  assert.deepEqual(active(), ['gameplay']);
  assert.equal(menu.playing(), false);
  assert.equal(manager.playingMusic, true);
});

test('changing scenes before audio finishes loading never starts the obsolete menu track', () => {
  const { manager, track, load, active, sources } = fixture();
  const menu = track('menu', { loaded: false }), gameplay = track('gameplay', { loaded: false });
  manager.playMusic(menu);
  manager.switchMusic(gameplay);
  load(menu);
  assert.deepEqual(active(), []);
  load(gameplay);
  assert.deepEqual(active(), ['gameplay']);
  assert.equal(sources.length, 1);
});

test('a slow-loading BGM retries context resume after the upstream idle suspension', async () => {
  const { manager, track, load, idle, resume, active, Howler } = fixture();
  const menu = track('menu', { loaded: false });
  manager.playMusic(menu);
  await idle();
  assert.equal(Howler.ctx.state, 'suspended');
  assert.equal(Howler.state, 'suspended');
  load(menu);
  assert.ok(Howler.ctx.resumeRequests > 0, 'Loading completion retries the context instead of waiting for another gesture');
  await resume();
  assert.deepEqual(active(), ['menu']);
});

test('a music request during automatic suspension schedules resume after it completes', () => {
  const { manager, track, active, Howler } = fixture();
  const menu = track('menu');
  Howler.state = 'suspending';
  manager.playMusic(menu);
  assert.equal(Howler._resumeAfterSuspend, true);
  assert.deepEqual(active(), [], 'Do not start a source in a context that is still suspending');
});

test('repeated unlocks and requests for the same BGM keep one playing instance', () => {
  const { manager, track, audio, active, sources, browser } = fixture();
  const menu = track('menu');
  manager.playMusic(menu);
  manager.playMusic(menu);
  manager.switchMusic(menu);
  audio.unlock();
  browser.dispatch('pointerdown');
  browser.dispatch('click');
  assert.deepEqual(active(), ['menu']);
  assert.equal(sources.length, 1);
});

test('pause stays paused through unlock, resume restores one instance, and stop cancels deferred playback', async () => {
  const { manager, track, audio, active, resume } = fixture();
  const menu = track('menu');
  manager.playMusic(menu);
  manager.pauseMusic();
  audio.unlock();
  assert.deepEqual(active(), []);
  assert.equal(manager.playingMusic, false);
  manager.resumeMusic();
  assert.deepEqual(active(), ['menu']);
  manager.stopMusic();
  audio.unlock();
  await resume();
  assert.deepEqual(active(), []);
  assert.equal(manager.musicFile, null);
});

test('the original sound toggle and focus mute remain effective after gestures and context changes', async () => {
  const { manager, track, audio, active, resume, Howler } = fixture();
  const menu = track('menu'), effects = track('effects', { effect: true });
  manager.setAudioEffectsFile(effects);
  manager.playMusic(menu);
  manager.gamePaused();
  audio.unlock();
  await resume();
  assert.equal(menu.mute(), true);
  assert.equal(effects.mute(), true);
  manager.gameResumed();
  assert.equal(menu.mute(), false);
  manager.stopMusic();
  manager.switchSfxState();
  audio.unlock();
  assert.equal(manager.playEffect('explosion', false), null);
  assert.deepEqual(active(), []);
  Howler.mute(true);
  audio.unlock();
  assert.equal(Howler._muted, true, 'Unlock never turns the global sound switch on');
});

test('effects during replay, loading or blocked autoplay are discarded instead of queued', async () => {
  const { manager, track, load, resume, audio, active, sources } = fixture({ suspended: true });
  const effects = track('effects', { effect: true, loaded: false });
  manager.setAudioEffectsFile(effects);
  assert.equal(manager.playEffect('explosion', false), null);
  load(effects);
  assert.equal(manager.playEffect('explosion', false), null);
  assert.equal(audio.replay(() => manager.playEffect('explosion', false)), null);
  await resume();
  assert.deepEqual(active(), []);
  assert.equal(audio.replay(() => audio.replay(() => manager.playEffect('explosion', false))), null);
  assert.throws(() => audio.replay(() => { throw new Error('interrupted replay'); }), /interrupted replay/);
  assert.equal(manager.playEffect('menuPress', false), null, 'Unknown sprite does not play the audio collection');
  manager.playEffect('put_bomb', false);
  assert.deepEqual(active(), ['effects']);
  assert.equal(sources.length, 1, 'Only the new live effect started');
});

test('disposing a frame prevents delayed music and gesture retries from restarting it', async () => {
  const { manager, track, audio, resume, active, browser } = fixture({ suspended: true });
  manager.playMusic(track('menu'));
  audio.dispose();
  await resume();
  browser.dispatch('click');
  audio.unlock();
  assert.deepEqual(active(), []);
  assert.equal(manager.musicFile, null);
});
