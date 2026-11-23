/* 4399 protection, timer and single-player round end. Source: DoAction.as gameover/hurtHero. */
(() => {
  const frameMS = 1000 / 35;
  const online = () => !!window.onlineBridge?.online;
  const player = Game.Player.prototype;
  const startInvulnerable = p => {
    p.invulnerable = true;
    p.invulnerabilityTimer = 0;
    p.tweenInvulnerable?.stop(true);
    p.tweenInvulnerable = p.game.add.tween(p).to({ alpha: 0.5 }, 100, 'Linear', true, 0, -1, true);
  };

  // A spent shield or a lost CPU life gives varShield = 60 frames.
  player.checkInvulnerability = function () {
    if (!this.invulnerable) return;
    this.invulnerabilityTimer += this.game.time.elapsedMS;
    if (this.invulnerabilityTimer + 1e-7 < 60 * frameMS) return;
    this.invulnerable = false;
    this.invulnerabilityTimer = 0;
    this.tweenInvulnerable.stop(true);
    this.alpha = 1;
  };
  // Each hero starts with varShield = 60 + random(4) frames, during which
  // flames do not hurt it.
  player.checkInitialBlinking = function () {
    if (!this.initialBlinking) return;
    this.classicBlinkMS ??= (60 + this.game.rnd.integerInRange(0, 3)) * frameMS;
    this.blinkTimer += this.game.time.elapsedMS;
    if (this.blinkTimer + 1e-7 < this.classicBlinkMS) return;
    this.blinkTimer = 0;
    this.initialBlinking = false;
    this.tweenInvulnerable.stop(true);
    this.alpha = 1;
  };
  const danger = player.checkDangerZone;
  player.checkDangerZone = function () {
    if (this.initialBlinking) return;
    const cell = this.gridCell;
    // A single-player CPU with a spare life loses it and blinks for 60 frames;
    // only its last life kills it. The hit still scores for the attacker.
    if (this.isAI && this.lives > 1 && !online() && cell?.isDangerCell && !this.shieldActive &&
        !this.invulnerable && !this.invincible) {
      this.lives--;
      startInvulnerable(this);
      if (cell.dangerOwner && cell.dangerOwner.playerID !== this.playerID) {
        this.game.ph2NotificationManager.postNotification('_ADD_SCORE_KILLS', cell.dangerOwner.playerID);
      }
      this.game.ph2NotificationManager.postNotification('_UPDATE_UIS');
      return;
    }
    return danger.call(this);
  };

  // The Flash clock ends the round once fewer than 1 s remain, at 179.5 s.
  const clock = Game.ClassicRules.clock;
  const state = Game.GameplayState.prototype;
  state.checkTime = function () {
    if (this.gameStatus !== Game.GAME_STATUS.PLAYING) return;
    this.gameTimer += this.game.time.elapsedMS;
    this.updateTime();
    if (clock(this.gameTimer) < 1) {
      this.classicTimedOut = true;
      this.gameOver(true);
    }
  };
  state.updateTime = function () {
    const t = this.classicTimedOut || clock(this.gameTimer) < 1 ? 0 : Math.floor(clock(this.gameTimer));
    this.uiSeconds.setText(String(t % 60).padStart(2, '0'));
    this.uiMinutes.setText(String(Math.floor(t / 60)).padStart(2, '0'));
  };

  // CPU lives carry over between stages of one campaign (Flash heroObj.life).
  let cpuLives = {}, level = 1;
  const init = state.init;
  state.init = function (...args) {
    level = args[5] || 1;
    this.classicTimedOut = false;
    this.classicTimeupWin = null;
    return init.apply(this, args);
  };
  const createPlayers = Game.Grid.prototype.createPlayers;
  Game.Grid.prototype.createPlayers = function () {
    createPlayers.call(this);
    if (online() || level <= 1) { cpuLives = {}; return; }
    for (const p of this.players) if (p.isAI && cpuLives[p.playerID] != null) p.lives = cpuLives[p.playerID];
  };

  // Timeup compares the best stage score of living humans with that of living
  // CPUs (both start at 0). Humans win only when strictly ahead, and then
  // receive the 1000 bonus but no time score. Easy has no automatic win.
  state.checkArcadeScores = function () {
    const alive = this.grid.players.filter(p => !p.dead);
    const humans = alive.filter(p => !p.isAI);
    const win = this.classicTimedOut ? !!this.classicTimeupWin : humans.length > 0;
    this.endGame = win ? Game.GAME_END.WIN : Game.GAME_END.LOSE;
    if (!win) return;
    for (const p of humans) {
      if (!this.classicTimedOut) this.scoreManager.addLeftOverTime(this.gameTimer, p.playerID);
      this.scoreManager.addExtraScore(p.playerID);
    }
  };

  const gameOver = state.gameOver;
  state.gameOver = function (timedOut) {
    if (online() || this.gameStatus === Game.GAME_STATUS.GAME_OVER) return gameOver.call(this, timedOut);
    const players = this.grid.players;
    if (this.classicTimedOut) {
      const best = list => Math.max(0, ...list.map(p => this.scoreManager.totalScores[p.playerID]));
      const alive = players.filter(p => !p.dead);
      this.classicTimeupWin = best(alive.filter(p => !p.isAI)) > best(alive.filter(p => p.isAI));
      // A lost timeup costs every living human a life, and they explode.
      if (!this.classicTimeupWin) for (const p of alive) if (!p.isAI) p.lives--;
    }
    const timeupLosers = this.classicTimedOut && !this.classicTimeupWin ? players.filter(p => !p.dead && !p.isAI) : [];
    const before = players.map(p => p.lives);
    // Flash shows the result for 5500 ms, and any key release skips it.
    const events = this.game.time.events, add = events.add;
    let pending = null;
    events.add = function (delay, callback, context, ...rest) {
      if (delay !== 5000 || pending) return add.call(this, delay, callback, context, ...rest);
      pending = { callback, context };
      pending.event = add.call(this, 5500, () => pending.run(), null);
      return pending.event;
    };
    try { gameOver.call(this, timedOut); } finally { delete events.add; if (events.add !== add) events.add = add; }
    for (const p of timeupLosers) {
      p.animationMovement.visible = false;
      p.animationDeath.visible = true;
      p.animationDeath.ph2Animations.play(p.playerID < 2 ? 'hero_pink_yellow_death' : 'hero_blue_green_death', 1, false);
    }
    const humans = players.filter(p => !p.isAI);
    const final = humans.every(p => p.lives <= 0);
    // Unless the campaign is over, every hero without lives returns with one
    // life for 1000 points of its campaign total.
    if (!final) {
      players.forEach((p, index) => {
        if (before[index] > 0) return;
        p.lives = 1;
        const scores = this.scoreManager.finalScores;
        scores[p.playerID] = Math.max(0, scores[p.playerID] - 1000);
      });
    }
    for (const p of players) if (p.isAI) cpuLives[p.playerID] = Math.max(1, p.lives);
    if (!pending) return;
    const game = this.game;
    const skip = () => { if (game.state.current === 'gameplayState') pending.run(); };
    pending.run = () => {
      if (pending.done) return;
      pending.done = true;
      window.removeEventListener('keyup', skip);
      events.remove(pending.event);
      pending.callback.call(pending.context);
    };
    window.addEventListener('keyup', skip);
  };
})();
