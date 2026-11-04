/* Flash pushBomb rejects a kick unless the next cell is open. */
(() => {
  const bombKicked = Game.Bomb.prototype.bombKicked;
  Game.Bomb.prototype.bombKicked = function (direction) {
    const offsets = {
      [Game.DIRECTION.LEFT]: [-1, 0], [Game.DIRECTION.RIGHT]: [1, 0],
      [Game.DIRECTION.UP]: [0, -1], [Game.DIRECTION.DOWN]: [0, 1],
    };
    const offset = offsets[direction];
    if (!offset || this.isKicked || this.isExploding) return false;
    const next = this.grid.cells[this.gridPositionX + offset[0]]?.[this.gridPositionY + offset[1]];
    // The old port started movement even against a wall, then its very first
    // movement update detonated the bomb. Mere contact is not a valid kick.
    if (!next || !next.isEmpty || [Game.MAP.WALL, Game.MAP.BLOCK, Game.MAP.BOMB].includes(next.cellContains)) return false;
    bombKicked.call(this, direction);
    return this.isKicked;
  };
})();
