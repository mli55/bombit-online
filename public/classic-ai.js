/* Flash's local safety/escape decisions, evaluated at 35 Hz on simulation time. */
(() => {
  const frameMS = 1000 / 35;
  const directions = [
    [-1, 0, Game.DIRECTION.LEFT], [0, -1, Game.DIRECTION.UP],
    [1, 0, Game.DIRECTION.RIGHT], [0, 1, Game.DIRECTION.DOWN],
  ];
  const ai = Game.PlayerAI.prototype;
  const cellAt = (grid, x, y) => grid.cells[x]?.[y];
  const brick = cell => !cell || cell.cellContains === Game.MAP.WALL || cell.cellContains === Game.MAP.BLOCK || cell.isFreezeCell;
  const random = (player, n) => player.game.rnd.integerInRange(0, n - 1);

  ai.classicSafe = function (x, y) {
    const cell = cellAt(this.grid, x, y);
    if (brick(cell) || cell.cellContains === Game.MAP.BOMB || cell.isDangerCell) return false;
    const threats = [...this.grid.bombs, ...this.grid.bombExplosions.filter(b => b.exists && b.hasExploded)];
    if (threats.some(b => b.gridPositionX === x && b.gridPositionY === y)) return false;
    for (const [dx, dy] of directions) {
      for (let distance = 1; ; distance++) {
        const nextX = x + dx * distance, nextY = y + dy * distance;
        if (brick(cellAt(this.grid, nextX, nextY))) break;
        if (threats.some(b => b.gridPositionX === nextX && b.gridPositionY === nextY && b.power >= distance)) return false;
      }
    }
    return true;
  };
  ai.classicScore = function (x, y) {
    if (!this.classicSafe(x, y)) return -1;
    return directions.filter(([dx, dy]) => this.classicSafe(x + dx, y + dy)).length;
  };
  ai.classicBeginMove = function (index) {
    const [dx, dy, direction] = directions[index];
    this.direction = direction;
    const x = this.gridPositionX, y = this.gridPositionY;
    const cell = cellAt(this.grid, x + dx, y + dy);
    if (brick(cell)) return false;
    if (cell.cellContains === Game.MAP.BOMB) {
      if (!this.canKickBombs || brick(cellAt(this.grid, x + 2 * dx, y + 2 * dy)) ||
          cellAt(this.grid, x + 2 * dx, y + 2 * dy).cellContains === Game.MAP.BOMB) return false;
      this.kickBomb(cell, direction);
    }
    this.classicStartX = this.x; this.classicStartY = this.y;
    this.classicEndX = cell.centerX; this.classicEndY = cell.centerY;
    this.classicMoveStep = 0;
    this.moving = this.movingAnimation = true;
    return true;
  };
  ai.classicThink = function () {
    const x = this.gridPositionX, y = this.gridPositionY;
    let mode;
    if (this.classicSafe(x, y)) {
      if (random(this, 100) < 20) mode = 'wander';
      else if (random(this, 100) < 5) mode = 'bomb';
      else return;
    } else {
      if (random(this, 100) >= [20, 60, 100][this.grid.difficulty]) return;
      mode = 'escape';
    }
    const first = random(this, 4);
    let best = 0, chosen = -1;
    for (let i = 0; i < 4; i++) {
      const index = (first + i) % 4, [dx, dy] = directions[index];
      let score = this.classicScore(x + dx, y + dy);
      if (mode !== 'escape' && score <= 0) continue;
      if (mode === 'wander') {
        if (cellAt(this.grid, x + dx, y + dy).isItemCell) score += 5;
        score += random(this, 3);
      }
      if (score >= best) { best = score; chosen = index; }
    }
    if (mode === 'escape' && chosen < 0) chosen = random(this, 4);
    if (chosen < 0 || (mode === 'bomb' && best < 2)) return;
    if (mode === 'bomb') {
      if (this.weaponActive) this.useWeapon();
      else this.putBomb();
    }
    this.classicBeginMove(chosen);
  };
  ai.update = function () {
    Game.Player.prototype.update.call(this);
    if (this.dead || this.gameStatus !== Game.GAME_STATUS.PLAYING) return;
    this.classicAITime = (this.classicAITime || 0) + this.game.time.elapsedMS;
    while (this.classicAITime + 1e-7 >= frameMS) {
      this.classicAITime -= frameMS;
      if (this.moving) {
        const frames = this.slowed ? 20 : (this.classicMoveFrames || 6);
        const progress = Math.min(1, ++this.classicMoveStep / frames);
        this.x = this.classicStartX + (this.classicEndX - this.classicStartX) * progress;
        this.y = this.classicStartY + (this.classicEndY - this.classicStartY) * progress;
        this.checkActualGridLocation();
        this.movingAnimation = true;
        if (progress === 1) this.moving = false;
      } else if (!this.frozen) {
        this.movingAnimation = false;
        this.classicThink();
      }
    }
  };
})();
