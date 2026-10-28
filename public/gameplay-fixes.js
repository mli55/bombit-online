/* Gameplay timing and player lifecycle adjustments around the original engine. */
(() => {
  const activateMine = Game.Player.prototype.activateMine;
  Game.Player.prototype.activateMine = function (cell) {
    // Upstream kills on a stepped-on mine without checking the shield. Spend it
    // like checkDangerZone does; the 2 s invulnerability covers the mine blast.
    if (!this.shieldActive) return activateMine.call(this, cell);
    this.shieldActive = false;
    this.invulnerable = true;
    this.tweenInvulnerable = this.game.add.tween(this).to({ alpha: 0.5 }, 100, 'Linear', true, 0, -1, true);
    this.game.ph2NotificationManager.postNotification('_UPDATE_UIS');
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
