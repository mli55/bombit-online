/* Bomb It 1 network adapter. Original source and assets are preserved in /original.
   30 network frames/second, two deterministic 60 Hz simulation steps per frame.
   No video streaming, no remote eval, and no client wall-clock in the simulation. */
(() => {
  const report = (type, data = {}) => parent.postMessage({ source: 'bomb-it-game', type, ...data }, location.origin);
  window.addEventListener('error', event => report('error', { message: event.error?.stack || event.message }));
  window.addEventListener('unhandledrejection', event => report('error', { message: String(event.reason) }));
  window.libs = window.libs.map(url => '/game/plugins/' + url.split('/').at(-1));
  let done, fired = false;
  const splash = { create: () => Promise.resolve(), setLoadProgress(value) {
    if (value === 100 && !fired) { fired = true; setTimeout(() => done?.(), 50); }
  }, setButtonCallback(callback) { done = callback; }, destroy() { document.getElementById('loader').hidden = true; } };
  h5branding.SplashLoader.getInstance = () => splash;
  h5branding.Utils.inGDGameZone = () => true;
  h5branding.Utils.isOnDevice = () => false;
  h5branding.Utils.getBrandingDomain = () => h5branding.BrandingDomain.Neutral;
  h5branding.Branding.outGoingLinksAllowed = () => false;
  Fabrique.AdHandler.prototype.init = function () {};
  Fabrique.AdHandler.prototype.showAd = function (_placement, resumed) { resumed?.(); };
  Fabrique.AdHandler.prototype.isAdPlaying = () => false;
  Fabrique.PauseHandler.prototype.onBlur = function () {};
  Fabrique.PauseHandler.prototype.onFocus = function () {};
  const bootInit = Game.BootState.prototype.init;
  Game.BootState.prototype.init = function () {
    this.game.device.desktop = true; Game.SETTINGS.SCALE = 1;
    bootInit.call(this);
    // Network input is applied directly to each original InputController.
    this.game.input.keyboard.stop(); this.game.stage.disableVisibilityChange = true;
    this.game.onBlur.removeAll(); this.game.onFocus.removeAll();
  };
  Game.InputController.prototype.createInputs = function () {
    this.isDesktop = true; this.clearInputs(); this.actionKey = { enabled: true };
  };
  const indicator = Game.PlayerHuman.prototype.createPlayerIndicator;
  Game.PlayerHuman.prototype.createPlayerIndicator = function () {
    indicator.call(this);
    if (this.playerNumber >= 2) {
      const label = Ph2.AnimationSystem.findObject('avatar1_player', this.animationIndicator);
      label.visible = false;
      const text = this.game.add.text(label.x, label.y, `${this.playerNumber + 1}P`, { font: 'bold 24px Arial', fill: '#ffffff', stroke: '#222222', strokeThickness: 4 });
      text.anchor.set(.5); label.parent.addChild(text);
    }
  };
  // Keep per-browser saved lives/tutorial preferences out of the shared simulation.
  const memory = { lives1: 3, lives2: 3 };
  Game.DataManager.prototype.getLivesPlayer1 = () => memory.lives1;
  Game.DataManager.prototype.getLivesPlayer2 = () => memory.lives2;
  Game.DataManager.prototype.saveLivesPlayer1 = value => { memory.lives1 = value; };
  Game.DataManager.prototype.saveLivesPlayer2 = value => { memory.lives2 = value; };
  Game.DataManager.prototype.getTutorialComplete = () => true;
  Game.DataManager.prototype.getLanguage = () => 'en-US';

  let config, frame = 0, simulationStep = 0, pendingResult = null, resultReported = false;
  let active = false, inSimulation = false, now = 1000000;
  let gsRoot, gsFrames;
  const realNow = Date.now;
  Date.now = () => inSimulation ? now : realNow();
  const game = Game.App.getInstance();
  const originalUpdate = game.update;
  game.update = function (time) {
    if (!active) return originalUpdate.call(this, time);
    // Rendering can run at the monitor refresh rate; it never advances gameplay.
    this.updateRender(0);
  };
  function inClock(callback) {
    inSimulation = true;
    try { return callback(); } finally { inSimulation = false; }
  }
  function clockStep() {
    now = 1000000 + ++simulationStep * (1000 / 60);
    const time = game.time;
    time.prevTime = time.now; time.time = now; time.now = now;
    time.elapsed = time.elapsedMS = time.physicsElapsedMS = 1000 / 60;
    time.physicsElapsed = time.desiredFpsMult = 1 / 60;
    time.events.update(now); time.updateTimers();
    game.updateLogic(1 / 60);
    TweenLite.ticker.time = simulationStep / 60; TweenLite.ticker.frame = simulationStep;
    TweenLite.render();
  }
  // Lodash samples use a separate RNG from Phaser in the upstream game.
  // Route them through the same seeded source so the AI and board are reproducible.
  _.sample = function (collection, n) {
    const values = Array.isArray(collection) ? collection.slice() : Object.values(collection);
    if (n == null) return values.length ? values[game.rnd.integerInRange(0, values.length - 1)] : undefined;
    const selected = [];
    while (selected.length < n && values.length) selected.push(values.splice(game.rnd.integerInRange(0, values.length - 1), 1)[0]);
    return selected;
  };
  const createPlayers = Game.Grid.prototype.createPlayers;
  Game.Grid.prototype.createPlayers = function () {
    createPlayers.call(this);
    if (config?.mode === 'battle') {
      for (const p of this.players) p.lives = Game.SETTINGS.INITIAL_LIVES;
    }
  };
  const checkPlayers = Game.GameplayState.prototype.checkPlayers;
  Game.GameplayState.prototype.checkPlayers = function () {
    if (config?.mode !== 'battle') return checkPlayers.call(this);
    // Defer elimination evaluation to the end of the simulation step, allowing ties.
    for (const p of this.grid.players) if (p.dead) this[`overlay${p.playerID + 1}`].visible = true;
  };
  const gameOver = Game.GameplayState.prototype.gameOver;
  Game.GameplayState.prototype.gameOver = function (timedOut) {
    if (config?.mode !== 'battle') return gameOver.call(this, timedOut);
    if (pendingResult) return;
    const alive = this.grid.players.filter(p => !p.dead);
    pendingResult = { winner: alive.length === 1 ? alive[0].playerID : null, canContinue: false, level: 1, scores: this.scoreManager.totalScores.slice() };
    this.gameStatus = Game.GAME_STATUS.GAME_OVER;
    this.grid.gameStatus = Game.GAME_STATUS.GAME_OVER;
    for (const p of this.grid.players) p.onMatchEnd();
    game.ph2AudioManager.stopMusic(); game.ph2AudioManager.playEffect('level_complete', false);
  };
  // The room toolbar owns pause/continue; local UI cannot alter a single replica.
  Game.GameplayState.prototype.pausePressed = function () { report('pause-request'); };
  Game.GameplayState.prototype.createCheats = function () {};
  const gameOverCreate = Game.GameOverState.prototype.create;
  Game.GameOverState.prototype.create = function () {
    gameOverCreate.call(this);
    pendingResult = { winner: null, canContinue: !this.isGameOver, win: this.gameEnd === Game.GAME_END.WIN, level: this.level, scores: this.scoreManager.finalScores.slice() };
  };
  Game.GameOverState.prototype.addTouchListeners = function () {};

  function start(settings) {
    config = settings; active = true; frame = simulationStep = 0; now = 1000000;
    pendingResult = null; resultReported = false;
    inClock(() => {
      // Ph2 uses GSAP for callbacks as well as animation. Drive that clock too.
      gsRoot ||= new TimelineMax()._timeline;
      gsFrames ||= new TimelineMax({ useFrames: true })._timeline;
      TweenLite.ticker.removeEventListener('tick', TweenLite.render);
      TweenLite.ticker.sleep(); TweenLite.ticker.wake = () => {};
      TweenMax.killAll(false, true, true, true);
      for (const root of [gsRoot, gsFrames]) root._time = root._totalTime = root._startTime = 0;
      TweenLite.ticker.time = TweenLite.ticker.frame = 0;
      game.rnd.sow([config.seed]);
      memory.lives1 = memory.lives2 = Game.SETTINGS.INITIAL_LIVES;
      game.time.removeAll(); game.tweens.removeAll();
      game.time.time = game.time.now = game.time.prevTime = now;
      game.time.events = new Phaser.Timer(game, false); game.time.events.start();
      game.time._timers = []; game._paused = false;
      game.input.keyboard.stop(); game.input.enabled = false;
      game.state.start('gameplayState', true, false, Game.GAME_MODE.ARCADE, config.difficulty,
        config.players.length === 1 ? Game.PLAYER_MODE.SINGLE_PLAYER : Game.PLAYER_MODE.MULTI_PLAYER,
        Game.MAP_THEME.RANDOM, config.players.map(p => p.character), 1);
      // Enter the pending state and complete creation without advancing a simulation frame.
      game.time.elapsed = game.time.elapsedMS = game.time.physicsElapsedMS = 0;
      game.updateLogic(0);
      game.stage.updateTransform(); game.updateRender(0);
    });
    return checksum();
  }
  function advance(packet, replay = false) {
    const [n, masks, command] = packet;
    if (n !== frame + 1) throw new Error(`Frame sequence ${frame} → ${n}`);
    inClock(() => {
      if (command === 'continue') {
        const state = game.state.getCurrentState();
        if (game.state.current !== 'gameOverState' || state.isGameOver) throw new Error('Invalid level continuation');
        pendingResult = null; resultReported = false; state.gotoGameplay();
      }
      for (let substep = 0; substep < 2; substep++) {
        const state = game.state.getCurrentState();
        if (game.state.current === 'gameplayState' && state.grid && !pendingResult) {
          for (const human of config.players) {
            const p = state.grid.players.find(p => p.playerID === human.character);
            const input = p.inputController, mask = masks[human.seat] || 0;
            input.clearInputs();
            // Match original single-axis movement: the first direction takes priority.
            if (mask & 1) input.upPressed = true;
            else if (mask & 2) input.downPressed = true;
            else if (mask & 4) input.leftPressed = true;
            else if (mask & 8) input.rightPressed = true;
            if ((mask & 16) && !input.onlineActionHeld) input.actionKeyPressed();
            input.onlineActionHeld = !!(mask & 16);
          }
        }
        clockStep();
        const current = game.state.getCurrentState();
        if (config.mode === 'battle' && game.state.current === 'gameplayState' && !pendingResult && current.grid.players.filter(p => !p.dead).length <= 1) current.gameOver(false);
      }
      frame = n;
    });
    if (pendingResult && !resultReported && !replay) { resultReported = true; report('result', { result: pendingResult }); }
    if (frame % 30 === 0 && !replay) report('check', { tick: frame, hash: checksum(), state: game.state.current });
  }
  // Gameplay fields + RNG + timers, excluding textures, local audio and DOM sizing.
  function snapshot() {
    const state = game.state.getCurrentState(), grid = state.grid;
    const scalar = obj => Object.fromEntries(Object.keys(obj).sort().filter(k => !['alpha', 'visible', 'renderOrderID', 'worldPosition', 'z', 'name'].includes(k) && !k.startsWith('_') && ['number', 'boolean', 'string'].includes(typeof obj[k])).map(k => [k, obj[k]]));
    return { frame, random: game.rnd.state(), state: game.state.current, memory: { ...memory }, result: pendingResult,
      time: [now, state.gameTimer],
      players: grid?.players.map(p => ({ data: { ...scalar(p), x: p.x, y: p.y }, path: p.pathCells?.map(c => [c.gridPositionX, c.gridPositionY]), controller: p.inputController ? scalar(p.inputController) : null })),
      cells: grid?.cells.map(col => col.map(c => [c.cellContains, c.isEmpty, c.isDangerCell, c.isFreezeCell, c.isItemCell, c.dangerOwner?.playerID])),
      objects: grid ? ['bombs', 'items', 'mines', 'weapons', 'bombExplosions', 'weaponExplosions', 'boxes'].map(key => grid[key].map(o => ({ ...scalar(o), x: o.x, y: o.y }))) : null,
      scores: state.scoreManager?.totalScores, timers: game.time.events.events.map(e => [e.tick, e.delay, e.loop, e.repeatCount]) };
  }
  function checksum() {
    const text = JSON.stringify(snapshot()); let hash = 2166136261;
    for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
  function sound(on) { window.Howler?.mute(!on); if (on) window.Howler?.ctx?.resume(); }
  window.onlineBridge = { start, advance, checksum, snapshot, sound, get frame() { return frame; }, get state() { return game.state.current; }, get result() { return pendingResult; } };
  let ready = false;
  const wait = setInterval(() => {
    if (game.state.current === 'mainMenuState' && Game.Instances.DataManager && !ready) {
      ready = true; clearInterval(wait); report('ready');
    }
  }, 100);
  // Capture keys even when the embedded canvas has focus. Nothing is applied locally.
  for (const type of ['keydown', 'keyup']) window.addEventListener(type, e => {
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','Space','Enter'].includes(e.code)) {
      e.preventDefault(); e.stopImmediatePropagation(); report('key', { code: e.code, down: type === 'keydown' });
    }
  }, true);
  window.addEventListener('blur', () => report('release'));
})();
