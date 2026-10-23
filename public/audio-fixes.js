/* Keep the original tracks and sound toggle, but never queue obsolete audio in
   the bundled Howler: its stop() does not cancel a pending resume callback. */
(() => {
  'use strict';
  const managers = new Map();
  let context, disposed = false, replayDepth = 0;
  const proto = Ph2.AudioManager.prototype;

  function request(manager) {
    if (!managers.has(manager)) managers.set(manager, { wanted: false, load: null });
    return managers.get(manager);
  }
  function cancelLoad(manager) {
    const pending = request(manager);
    if (pending.load) manager.musicFile?.off('load', pending.load);
    pending.load = null;
  }
  function audioReady() {
    if (!Howler.usingWebAudio) return true;
    if (Howler.ctx?.state !== 'running' || Howler.state === 'suspending') return false;
    // This old Howler does not track a context resumed directly by the browser.
    Howler.state = 'running';
    return true;
  }
  function playCurrent(manager) {
    const pending = request(manager), music = manager.musicFile;
    if (disposed || !pending.wanted || !manager.musicEnabled || !music) return;
    if (music.state() !== 'loaded') {
      if (!pending.load) {
        pending.load = () => { pending.load = null; unlock(); };
        music.once('load', pending.load);
      }
      return;
    }
    if (!audioReady()) return;
    if (!music.playing()) music.play();
    manager.playingMusic = music.playing();
  }
  function flush() {
    for (const manager of managers.keys()) playCurrent(manager);
  }
  function watchContext() {
    if (context === Howler.ctx) return;
    context?.removeEventListener('statechange', flush);
    context = Howler.ctx;
    context?.addEventListener('statechange', flush);
  }
  function unlock() {
    if (disposed) return;
    watchContext();
    if (Howler.state === 'suspending') Howler._autoResume();
    // Attempt immediately on entry; browsers that require activation will retry
    // on the first click, touch, or key. Do not change the user's mute setting.
    if (context && context.state !== 'running' && context.state !== 'closed') {
      context.resume().then(flush).catch(() => {});
    }
    flush();
  }

  proto.stopMusic = function () {
    const pending = request(this);
    pending.wanted = false;
    cancelLoad(this);
    if (this.musicFile?.state() === 'loaded') this.musicFile.stop();
    this.musicFile = null;
    this.playingMusic = false;
  };
  proto.selectMusic = function (music) {
    this.stopMusic();
    this.musicFile = music;
  };
  proto.playMusic = function (music) {
    if (!this.musicEnabled || disposed) return;
    if (this.musicFile !== music) this.selectMusic(music);
    request(this).wanted = true;
    unlock();
  };
  proto.switchMusic = proto.playMusic;
  proto.pauseMusic = function () {
    request(this).wanted = false;
    cancelLoad(this);
    if (this.musicFile?.state() === 'loaded') this.musicFile.pause();
    this.playingMusic = false;
  };
  proto.resumeMusic = function () {
    if (this.musicFile) this.playMusic(this.musicFile);
  };

  const playEffect = proto.playEffect;
  proto.playEffect = function (name, loop) {
    // Effects belong to the current instant. Loading, autoplay restrictions and
    // network catch-up must not turn old explosions into a delayed sound burst.
    if (disposed || replayDepth || !this.sfxEnabled ||
        this.soundsFile?.state() !== 'loaded' ||
        !Object.hasOwn(this.soundsFile._sprite, name) || !audioReady()) return null;
    return playEffect.call(this, name, loop);
  };
  function replay(callback) {
    replayDepth++;
    try { return callback(); } finally { replayDepth--; }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const manager of managers.keys()) manager.stopMusic();
    if (Howler.ctx) Howler.mute(true);
    for (const howl of [...Howler._howls]) howl.unload();
    context?.removeEventListener('statechange', flush);
    if (context && context.state !== 'closed') context.close().catch(() => {});
    for (const type of gestures) window.removeEventListener(type, unlock, true);
    managers.clear();
  }
  const gestures = ['pointerdown', 'click', 'touchend', 'keydown'];
  for (const type of gestures) window.addEventListener(type, unlock, true);
  window.addEventListener('pagehide', event => { if (!event.persisted) dispose(); });
  window.bombItAudio = { unlock, replay, dispose };
})();
