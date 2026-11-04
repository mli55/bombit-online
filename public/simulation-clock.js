/* Gameplay advances in logic steps, never in display-refresh intervals. */
(() => {
  const update = Phaser.Game.prototype.update;
  Phaser.Game.prototype.update = function (time) {
    if (this.state.current !== 'gameplayState') return update.call(this, time);
    const forceSingleUpdate = this.forceSingleUpdate;
    // At 30 Hz, consume two 60 Hz logic steps rather than losing half the time.
    // Phaser caps added elapsed time at three steps. Its additional heuristic
    // drops valid frames when 30/60 Hz rounding alternates the step count.
    this.forceSingleUpdate = false;
    this._spiraling = 0;
    try { return update.call(this, time); }
    finally { this.forceSingleUpdate = forceSingleUpdate; }
  };
  const updateLogic = Phaser.Game.prototype.updateLogic;
  Phaser.Game.prototype.updateLogic = function (seconds) {
    // Normalize before state.preUpdate as well: it can enter gameplay and place
    // the first bomb during what began as a menu/loading update.
    const elapsedMS = this.time.elapsedMS;
    this.time.elapsedMS = seconds * 1000;
    try { return updateLogic.call(this, seconds); }
    finally { this.time.elapsedMS = elapsedMS; }
  };
})();
