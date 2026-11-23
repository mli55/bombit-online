/* Flash pushBomb: kick rules and the sliding bomb. */
(() => {
  const frameMS = 1000 / 35;
  const offsets = {
    [Game.DIRECTION.LEFT]: [-1, 0], [Game.DIRECTION.RIGHT]: [1, 0],
    [Game.DIRECTION.UP]: [0, -1], [Game.DIRECTION.DOWN]: [0, 1],
  };
  // Flash stops a pushed bomb at another bomb or any "brick": walls, unbroken
  // boxes, ice and the map edge. Heroes, items and mines do not stop it.
  const blocked = (grid, cell) => !cell || cell.cellContains === Game.MAP.BOMB ||
    Game.ClassicWeapons.isBrick(grid, cell);

  const bombKicked = Game.Bomb.prototype.bombKicked;
  Game.Bomb.prototype.bombKicked = function (direction) {
    const offset = offsets[direction];
    if (!offset || this.isKicked || this.isExploding) return false;
    const next = this.grid.cells[this.gridPositionX + offset[0]]?.[this.gridPositionY + offset[1]];
    // The old port started movement even against a wall, then its very first
    // movement update detonated the bomb. Mere contact is not a valid kick.
    if (blocked(this.grid, next)) return false;
    bombKicked.call(this, direction);
    if (!this.isKicked) return false;
    // Like Flash, the bomb claims the next cell at once, so the kicker can
    // follow it into the cell it left.
    this.classicKickOffset = offset;
    this.classicKickFrom = this.gridCell;
    this.classicKickStep = 0;
    this.classicKickTime = 0;
    this.updateBombCell(next);
    return true;
  };

  // A pushed bomb moves one cell per two Flash frames (17.5 cells/s). Its
  // movement replaces the fuse, and it explodes on arriving next to a blocker.
  const update = Game.Bomb.prototype.update;
  Game.Bomb.prototype.update = function () {
    if (!this.isKicked || this.isExploding) return update.call(this);
    if (this.gameStatus === Game.GAME_STATUS.PAUSED) return;
    this.classicKickTime += this.game.time.elapsedMS;
    while (this.isKicked && this.classicKickTime + 1e-7 >= frameMS) {
      this.classicKickTime -= frameMS;
      const from = this.classicKickFrom, to = this.gridCell;
      if (++this.classicKickStep < 2) {
        this.x = (from.centerX + to.centerX) / 2;
        this.y = (from.centerY + to.centerY) / 2;
        continue;
      }
      this.x = to.centerX; this.y = to.centerY;
      const [dx, dy] = this.classicKickOffset;
      const next = this.grid.cells[to.gridPositionX + dx]?.[to.gridPositionY + dy];
      if (blocked(this.grid, next)) { this.explode(); return; }
      this.classicKickFrom = to;
      this.classicKickStep = 0;
      this.updateBombCell(next);
    }
  };

  // The sliding Flash bomb runs only its movement script, which never checks
  // the flames under it. Rays, rockets and columns cannot set it off mid-slide.
  const explodeBomb = Game.Grid.prototype.explodeBomb;
  Game.Grid.prototype.explodeBomb = function (cell) {
    const bomb = this.bombs.find(b => b.gridPositionX === cell.gridPositionX && b.gridPositionY === cell.gridPositionY);
    if (bomb?.isKicked) return;
    return explodeBomb.call(this, cell);
  };
})();
