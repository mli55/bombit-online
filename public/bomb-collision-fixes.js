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

  // Flash pushes only when a step starts from the cell next to the bomb, so the
  // hero is touching it. The port kicked as soon as the hero's center crossed
  // into that cell, up to half a cell away. Wait for the same contact edge
  // that stops the walk. AI kicks keep their own rules.
  const kickBomb = Game.PlayerHuman.prototype.kickBomb;
  Game.PlayerHuman.prototype.kickBomb = function (cell, direction) {
    const reach = this.cellOffset + 1e-7;
    const touching = {
      [Game.DIRECTION.LEFT]: () => this.x - reach <= cell.right,
      [Game.DIRECTION.RIGHT]: () => this.x + reach >= cell.left,
      [Game.DIRECTION.UP]: () => this.y - reach <= cell.bottom,
      [Game.DIRECTION.DOWN]: () => this.y + reach >= cell.top,
    }[direction];
    if (touching?.()) return kickBomb.call(this, cell, direction);
  };
})();
