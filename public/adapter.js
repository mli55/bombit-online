/* Bomb It 1 network adapter. Original source and assets are preserved in /original.
   60 network frames/second, one deterministic simulation step per frame.
   No video streaming, no remote eval, and no client wall-clock in the simulation. */
(() => {
  const report = (type, data = {}) => parent.postMessage({ source: 'bomb-it-game', type, ...data }, location.origin);
  window.addEventListener('error', event => report('error', { message: event.error?.stack || event.message }));
  window.addEventListener('unhandledrejection', event => report('error', { message: String(event.reason) }));
  window.libs = window.libs.map(url => '/game/plugins/' + url.split('/').at(-1));
  let done, fired = false;
  const fontReady = document.fonts.load('25px impact').catch(() => []).then(() => { Phaser.Text.fontPropertiesCache = {}; });
  const splash = { create: () => fontReady, setLoadProgress(value) {
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
  for (const method of ['onBlur', 'onFocus']) {
    const original = Fabrique.PauseHandler.prototype[method];
    Fabrique.PauseHandler.prototype[method] = function (...args) {
      if (!active) return original.apply(this, args);
    };
  }
  const bootInit = Game.BootState.prototype.init;
  Game.BootState.prototype.init = function () {
    this.game.device.desktop = true; Game.SETTINGS.SCALE = 1;
    bootInit.call(this);
    // The selector chooses the keyboard route: native for Single Player,
    // room messages for Multiplayer. Online input is never applied locally.
    this.game.input.keyboard.stop();
  };
  const createInputs = Game.InputController.prototype.createInputs;
  Game.InputController.prototype.createInputs = function () {
    if (!active) {
      this.game.input.enabled = true; this.game.input.keyboard.start();
      return createInputs.call(this);
    }
    this.isDesktop = true; this.clearInputs(); this.actionKey = { enabled: true };
  };
  const indicator = Game.PlayerHuman.prototype.createPlayerIndicator;
  Game.PlayerHuman.prototype.createPlayerIndicator = function () {
    indicator.call(this);
    if (!active) return;
    const seat = config?.players.find(p => p.character === this.playerID)?.seat ?? this.playerNumber;
    if (seat >= 2) {
      const label = Ph2.AnimationSystem.findObject('avatar1_player', this.animationIndicator);
      label.visible = false;
      const text = this.game.add.text(label.x, label.y, `${seat + 1}P`, { font: 'bold 24px Arial', fill: '#ffffff', stroke: '#222222', strokeThickness: 4 });
      text.anchor.set(.5); label.parent.addChild(text);
      this.onlineSeatLabel = { source: label, text };
    }
  };
  // Keep per-browser saved lives/tutorial preferences out of the shared simulation.
  const memory = { lives1: 3, lives2: 3 };
  const onlineData = {
    getLivesPlayer1: () => memory.lives1,
    getLivesPlayer2: () => memory.lives2,
    saveLivesPlayer1: value => { memory.lives1 = value; },
    saveLivesPlayer2: value => { memory.lives2 = value; },
    getTutorialComplete: () => true,
    getLanguage: () => 'en-US'
  };
  for (const [method, online] of Object.entries(onlineData)) {
    const original = Game.DataManager.prototype[method];
    Game.DataManager.prototype[method] = function (...args) {
      return active ? online(...args) : original.apply(this, args);
    };
  }

  let config, localSeat = 0, roundOutcome = null, frame = 0, simulationStep = 0, pendingResult = null, resultReported = false;
  let active = false, inSimulation = false, now = 1000000;
  let gsRoot, gsFrames;
  const realNow = Date.now;
  Date.now = () => inSimulation ? now : realNow();
  const game = Game.App.getInstance();
  const localCharacter = () => config.players.find(p => p.seat === localSeat)?.character ?? config.players[0].character;
  const originalUpdate = game.update;
  game.update = function (time) {
    if (!active) return originalUpdate.call(this, time);
    // Rendering can run at the monitor refresh rate; it never advances gameplay.
    this.input.update();
    syncSeatIndicators();
    this.stage.updateTransform();
    this.updateRender(0);
  };
  function syncSeatIndicators() {
    if (game.state.current !== 'gameplayState') return;
    for (const player of game.state.getCurrentState().grid?.players || []) {
      if (!player.onlineSeatLabel) continue;
      const { source, text } = player.onlineSeatLabel;
      // The original arrow timeline animates this sprite's local transform.
      // Keep 3P/4P attached to that same animation rather than its initial position.
      source.visible = false;
      text.position.copyFrom(source.position); text.scale.copyFrom(source.scale);
      text.rotation = source.rotation; text.alpha = source.alpha;
    }
  }
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
    syncSeatIndicators();
    game.stage.updateTransform();
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
    if (active) for (const p of this.players) p.lives = Game.SETTINGS.INITIAL_LIVES;
  };
  const checkPlayers = Game.GameplayState.prototype.checkPlayers;
  Game.GameplayState.prototype.checkPlayers = function () {
    if (!active) return checkPlayers.call(this);
    // Defer elimination evaluation to the end of the simulation step, allowing ties.
    for (const p of this.grid.players) if (p.dead) this[`overlay${p.playerID + 1}`].visible = true;
  };
  const gameOver = Game.GameplayState.prototype.gameOver;
  Game.GameplayState.prototype.gameOver = function (timedOut) {
    if (!active) return gameOver.call(this, timedOut);
    if (roundOutcome) return;
    // The original score manager ranks surviving players, including its tie order.
    const winner = this.scoreManager.getMaxScore(this.grid.players) ?? null;
    roundOutcome = { winner, canContinue: true, level: config.round || 1 };
    if (winner !== null) {
      this.scoreManager.addLeftOverTime(this.gameTimer, winner);
      this.scoreManager.addExtraScore(winner);
    }
    this.gameTimer = 0;
    this.gameStatus = this.grid.gameStatus = Game.GAME_STATUS.GAME_OVER;
    for (const p of this.grid.players) p.onMatchEnd();
    game.ph2AudioManager.stopMusic(); game.ph2AudioManager.playEffect('level_complete', false);
    const message = Ph2.AnimationSystem.findObject('message/image', this.animationLevelEnd);
    message.frameName = timedOut ? 'message1.png' : 'message3.png';
    this.animationLevelEnd.visible = true;
    this.animationLevelEnd.ph2Animations.play('message_gameplay', 1, false);
    game.time.events.add(5000, () => game.state.start('gameOverState', true, false,
      this.gameMode, this.difficulty, Game.PLAYER_MODE.SINGLE_PLAYER, this.grid.mapTheme,
      this.characters, this.scoreManager, false, Game.GAME_END.WIN, config.round || 1), this);
  };
  // Original buttons request a shared action; only server frames advance gameplay.
  const pausePressed = Game.GameplayState.prototype.pausePressed;
  Game.GameplayState.prototype.pausePressed = function () {
    if (!active) return pausePressed.call(this);
    report('pause-request');
  };
  const createCheats = Game.GameplayState.prototype.createCheats;
  Game.GameplayState.prototype.createCheats = function () {
    if (!active) return createCheats.call(this);
  };
  const gameOverCreate = Game.GameOverState.prototype.create;
  Game.GameOverState.prototype.create = function () {
    gameOverCreate.call(this);
    if (!active) return;
    pendingResult = { winner: null, canContinue: !this.isGameOver, win: this.gameEnd === Game.GAME_END.WIN,
      level: this.level, ...roundOutcome, scores: this.scoreManager.finalScores.slice() };
    const character = localCharacter();
    // Each browser uses the same original board, with only its displayed numbers personalized.
    for (const [text, scores] of Object.entries({ textEnemiesKilled1: 'killScores', textDestruction1: 'destructionScores',
      textLeftOverTime1: 'leftOverScores', textExtraScore1: 'extraScores', textTotalScore1: 'totalScores', textFinalScore1: 'finalScores' })) {
      this[text].setText(String(this.scoreManager[scores][character]));
    }
    const winner = config.players.find(p => p.character === roundOutcome.winner);
    const title = roundOutcome.winner === null ? 'DRAW' : winner ? `P${winner.seat + 1} WINS` : 'CPU WINS';
    Ph2.UISystem.findObject('container_title/title', this.uiScore).setText(title);
    Game.Instances.LocalizationManager.fitFontSizeUI('container_title/title', this.uiScore,
      125 * Game.SETTINGS.SCALE, -1, 25 * Game.SETTINGS.SCALE);
    this.textButton.setText(localSeat === 0 ? 'NEXT ROUND' : 'WAIT FOR HOST');
  };
  const resultListeners = Game.GameOverState.prototype.addTouchListeners;
  Game.GameOverState.prototype.addTouchListeners = function () {
    if (!active) return resultListeners.call(this);
    this.buttonNextLevel.onInputUp.add(this.nextStep, this);
  };
  const nextStep = Game.GameOverState.prototype.nextStep;
  Game.GameOverState.prototype.nextStep = function () {
    if (!active) return nextStep.call(this);
    report('continue-request');
  };
  const gotoMainMenu = Game.GameOverState.prototype.gotoMainMenu;
  Game.GameOverState.prototype.gotoMainMenu = function () {
    if (!active) return gotoMainMenu.call(this);
    report('lobby-request');
  };

  function start(settings, seat = 0) {
    localSeat = seat; roundOutcome = null; config = settings; active = true; frame = simulationStep = 0; now = 1000000;
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
      game.input.keyboard.stop(); game.input.enabled = true;
      game.stage.disableVisibilityChange = true;
      game.onBlur.removeAll(); game.onFocus.removeAll();
      game.state.start('gameplayState', true, false, Game.GAME_MODE.ARCADE, config.difficulty,
        config.players.length === 1 ? Game.PLAYER_MODE.SINGLE_PLAYER : Game.PLAYER_MODE.MULTI_PLAYER,
        Game.MAP_THEME.RANDOM, config.players.map(p => p.character), config.round || 1);
      // Enter the pending state and complete creation without advancing a simulation frame.
      game.time.elapsed = game.time.elapsedMS = game.time.physicsElapsedMS = 0;
      game.updateLogic(0);
      if (config.scores) game.state.getCurrentState().scoreManager.finalScores = config.scores.slice();
      game.stage.updateTransform(); game.updateRender(0);
    });
    return checksum();
  }
  function advance(packet, replay = false) {
    const [n, masks] = packet;
    if (n !== frame + 1) throw new Error(`Frame sequence ${frame} → ${n}`);
    inClock(() => {
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
      if (game.state.current === 'gameplayState' && !pendingResult && !roundOutcome && current.grid.players.filter(p => !p.dead).length <= 1) current.gameOver(false);
      frame = n;
    });
    if (pendingResult && !resultReported && !replay) { resultReported = true; report('result', { result: pendingResult }); }
    if (frame % 60 === 0 && !replay) report('check', { tick: frame, hash: checksum(), state: game.state.current });
  }
  // Gameplay fields + RNG + timers, excluding textures, local audio and DOM sizing.
  function snapshot() {
    const state = game.state.getCurrentState(), grid = state.grid;
    const scalar = obj => Object.fromEntries(Object.keys(obj).sort().filter(k => !['alpha', 'visible', 'renderOrderID', 'worldPosition', 'z', 'name'].includes(k) && !k.startsWith('_') && ['number', 'boolean', 'string'].includes(typeof obj[k])).map(k => [k, obj[k]]));
    return { frame, random: game.rnd.state(), state: game.state.current,
      memory: { ...memory }, result: pendingResult,
      playerMode: state.playerMode, characters: (state.characters || state.charactersChosen || []).slice(), level: state.levelNumber ?? state.level,
      time: [now, state.gameTimer],
      players: grid?.players.map(p => ({ data: { ...scalar(p), x: p.x, y: p.y }, path: p.pathCells?.map(c => [c.gridPositionX, c.gridPositionY]), controller: p.inputController ? scalar(p.inputController) : null })),
      cells: grid?.cells.map(col => col.map(c => [c.cellContains, c.isEmpty, c.isDangerCell, c.isFreezeCell, c.isItemCell, c.dangerOwner?.playerID])),
      objects: grid ? ['bombs', 'items', 'mines', 'weapons', 'bombExplosions', 'weaponExplosions', 'boxes'].map(key => grid[key].map(o => ({ ...scalar(o), x: o.x, y: o.y }))) : null,
      scores: state.scoreManager?.totalScores, finalScores: state.scoreManager?.finalScores, timers: game.time.events.events.map(e => [e.tick, e.delay, e.loop, e.repeatCount]) };
  }
  function checksum() {
    const text = JSON.stringify(snapshot()); let hash = 2166136261;
    for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
  function sound(on) { window.Howler?.mute(!on); if (on) window.Howler?.ctx?.resume(); }
  function updateRoster(room) {
    if (!active || game.state.current !== 'gameplayState') return;
    const state = game.state.getCurrentState();
    state.onlineStatusLabels ||= {};
    for (const player of room.players.filter(Boolean)) {
      let label = state.onlineStatusLabels[player.character];
      if (!label || !label.exists) {
        const avatar = state[`avatar${player.character + 1}`];
        label = game.add.text(avatar.x, avatar.y + 58, '', { font: 'bold 17px Arial', fill: '#ffdddd', stroke: '#302031', strokeThickness: 4 });
        label.anchor.set(.5); avatar.parent.addChild(label); state.onlineStatusLabels[player.character] = label;
      }
      label.setText(!player.online ? 'OFFLINE' : player.prepared === false ? 'RECONNECTING' : '');
    }
  }
  window.onlineBridge = { start, advance, checksum, snapshot, sound, updateRoster, get online() { return active; }, get frame() { return frame; }, get state() { return game.state.current; }, get result() { return pendingResult; } };
  let ready = false;
  const wait = setInterval(() => {
    if (game.state.current === 'mainMenuState' && Game.Instances.DataManager && !ready) {
      ready = true; clearInterval(wait); report('ready');
    }
  }, 100);
  // Capture keys even when the embedded canvas has focus. Nothing is applied locally.
  for (const type of ['keydown', 'keyup']) window.addEventListener(type, e => {
    if (!active) return;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','Space','Enter'].includes(e.code)) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (pendingResult && ['Space', 'Enter'].includes(e.code)) { if (type === 'keyup') report(pendingResult.canContinue ? 'continue-request' : 'lobby-request'); }
      else report('key', { code: e.code, down: type === 'keydown' });
    }
  }, true);
  window.addEventListener('blur', () => { if (active) report('release'); });
})();
