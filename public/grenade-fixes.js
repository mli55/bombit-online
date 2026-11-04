/* The yellow throwing weapon's marker and launch share one two-cell target. */
(() => {
  function target(player, direction) {
    const offsets = {
      [Game.DIRECTION.LEFT]: [-2, 0], [Game.DIRECTION.RIGHT]: [2, 0],
      [Game.DIRECTION.UP]: [0, -2], [Game.DIRECTION.DOWN]: [0, 2],
    };
    const offset = offsets[direction];
    if (!offset) return null;
    const cell = player.grid.cells[player.gridCell.gridPositionX + offset[0]]?.[player.gridCell.gridPositionY + offset[1]];
    return cell && cell.cellContains !== Game.MAP.WALL ? cell : null;
  }
  Game.Player.prototype.checkGrenadeIndicator = function () {
    const cell = target(this, this.direction);
    this.grenadeIndicator.visible = !!cell;
    if (cell) {
      this.grenadeIndicator.x = cell.centerX;
      this.grenadeIndicator.y = cell.centerY;
    }
  };
  Game.Grenade.prototype.useWeapon = function () {
    const cell = target(this.player, this.direction);
    // Reject before changing animation or retaining a target from an earlier try.
    this.cellFinal = cell;
    if (!cell) return false;
    Game.Weapon.prototype.useWeapon.call(this);
    this.gridCell = this.player.gridCell;
    this.scale.x = this.direction === Game.DIRECTION.LEFT ? -1 : 1;
    const name = this.direction === Game.DIRECTION.UP ? 'grenade_up' :
      this.direction === Game.DIRECTION.DOWN ? 'grenade_down' : 'grenade_right';
    const animation = this.animationGrenade.ph2Animations.play(name, 1, false);
    // The artwork's wall-clock tween must not decide when gameplay explodes.
    // Seek the paused timeline from the same simulation clock as the fuse.
    animation.pause();
    this.classicFlightAnimation = animation;
    this.classicFlightMS = 0;
    this.classicFlightDuration = animation.timeline.duration() * 1000;
    this.animationGrenade.visible = true;
    this.x = this.gridCell.centerX;
    this.y = this.gridCell.centerY;
    this.grid.rowsGroup[cell.gridPositionY].add(this);
    this.game.ph2AudioManager.playEffect('grenade', false);
    this.launchGrenade();
    return true;
  };
  Game.Grenade.prototype.update = function () {
    if (!this.classicFlightAnimation || !this.exists || this.grid.gameStatus === Game.GAME_STATUS.PAUSED) return;
    Game.Weapon.prototype.update.call(this);
    this.classicFlightMS += this.game.time.elapsedMS;
    this.classicFlightAnimation.timeline.progress(Math.min(1, this.classicFlightMS / this.classicFlightDuration), true);
    if (this.classicFlightMS + 1e-7 >= this.classicFlightDuration) this.explodeGrenade();
  };
})();
