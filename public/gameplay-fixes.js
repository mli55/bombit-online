/* Gameplay timing and player lifecycle adjustments around the original engine. */
(() => {
  // Finish the visible flame and its danger cells together, using the game clock
  // so pauses and deterministic online replays keep the same duration.
  Game.BombExplosion.prototype.checkTimer = function () {
    if (!this.hasExploded) return;
    this.timer += this.game.time.elapsedMS;
    if (this.timer >= 300) this.endExplosion();
  };

  const updatePlayer = Game.Player.prototype.update;
  Game.Player.prototype.update = function () {
    updatePlayer.call(this);
    if (!this.dead) return;

    // These indicators belong to the grid, rather than the player's sprite.
    // The original stops updating dead players, leaving their last icon visible.
    // Launched weapons remain in grid.weapons and finish their normal lifetime.
    this.weaponActive = false;
    this.animationPowerups.visible = false;
    this.grenadeIndicator.visible = false;
    this.animationIndicator.visible = false;
    if (this.inputController) {
      this.inputController.clearInputs();
      this.inputController.clearActionHold?.();
      this.inputController.onlineActionHeld = false;
    }
  };
})();
