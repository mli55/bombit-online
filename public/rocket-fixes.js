/* Rockets disappear on impact; a separate single-cell blast owns the damage. */
(() => {
  const rocket = Game.Rocket.prototype;
  rocket.update = function () {
    if (this.grid.gameStatus === Game.GAME_STATUS.PAUSED || !this.isFlying) return;
    Game.Weapon.prototype.update.call(this);
    this.checkMovement();
    if (this.isFlying) this.checkPlayers();
  };
  rocket.updateRocketCell = function (cell) {
    if (!this.isFlying) return;
    if (this.gridCell.gridPositionY !== cell.gridPositionY) this.grid.rowsGroup[cell.gridPositionY].add(this);
    this.startingGridX = cell.gridPositionX;
    this.startingGridY = cell.gridPositionY;
    this.gridCell = cell;
    // Flying over a cell neither changes its contents nor leaves ground fire.
    // In particular, never restore the launch-time contents of a different cell.
  };
  rocket.checkPlayers = function () {
    if (!this.isFlying) return;
    const radius = Game.SETTINGS.CELL_WIDTH * this.gameScale * 0.5;
    for (const player of this.grid.players) {
      if (player === this.player || player.dead) continue;
      const dx = player.x - this.x, dy = player.y - (this.y + this.offsetY);
      if (dx * dx + dy * dy < radius * radius) { this.createExplosion(); return; }
    }
  };
  rocket.rocketCollision = function (cell) {
    if (!this.isFlying) return;
    if (cell.cellContains === Game.MAP.WALL) this.createExplosion(this.gridCell);
    else if (cell.cellContains === Game.MAP.BLOCK) {
      this.grid.destroyBox(cell);
      this.game.ph2NotificationManager.postNotification('_ADD_SCORE_BLOCK', this.player.playerID);
      this.createExplosion(cell);
    } else if (cell.cellContains === Game.MAP.BOMB) {
      this.grid.explodeBomb(cell);
      this.createExplosion(cell);
    }
  };
  rocket.createExplosion = function (cell = this.gridCell) {
    if (!this.isFlying || !this.exists) return;
    this.isFlying = this.active = false;
    this.animationRocket.visible = false;
    const blast = new Game.WeaponExplosion(this.game, this.grid, cell, 0, this.player, Game.DIRECTION.ALL);
    this.impactExplosion = blast;
    this.grid.weaponExplosions.push(blast);
    this.grid.rowsGroup[cell.gridPositionY].add(blast);
    blast.makeExplosion();
    this.game.ph2AudioManager.playEffect('explosion', false);
    this.destroyRocket();
  };
  rocket.destroyRocket = function () {
    this.isFlying = this.active = false;
    const index = this.grid.weapons.indexOf(this);
    if (index !== -1) this.grid.weapons.splice(index, 1);
    this.destroy();
  };
})();
