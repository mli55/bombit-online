/* Rocket cell tracking. Flight and impact rules are in classic-weapons.js. */
(() => {
  const rocket = Game.Rocket.prototype;
  rocket.updateRocketCell = function (cell) {
    if (!this.isFlying) return;
    if (this.gridCell.gridPositionY !== cell.gridPositionY) this.grid.rowsGroup[cell.gridPositionY].add(this);
    this.startingGridX = cell.gridPositionX;
    this.startingGridY = cell.gridPositionY;
    this.gridCell = cell;
    // Flying over a cell neither changes its contents nor leaves ground fire.
    // In particular, never restore the launch-time contents of a different cell.
  };
  rocket.destroyRocket = function () {
    this.isFlying = this.active = false;
    const index = this.grid.weapons.indexOf(this);
    if (index !== -1) this.grid.weapons.splice(index, 1);
    this.destroy();
  };
})();
