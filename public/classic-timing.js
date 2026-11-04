/* Flash Bomb It 1 timings, converted from its 35 fps timeline to game time.
   Source and limits: docs/classic-timing.md. Never use wall-clock timers here. */
(() => {
  const frameMS = 1000 / 35;

  // Phaser's reverse live-array walk revisits the current child if a chain
  // explosion removes an earlier bomb. Snapshot each gameplay row, and share
  // one visited set across rows so moving/reparented players also tick once.
  const createTileGroups = Game.Grid.prototype.createTileGroups;
  Game.Grid.prototype.createTileGroups = function (...args) {
    const result = createTileGroups.apply(this, args);
    const grid = this;
    for (const row of this.rowsGroup) row.update = function () {
      const children = this.children.slice();
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        if (child.parent !== this || grid.classicUpdatedChildren?.has(child)) continue;
        grid.classicUpdatedChildren?.add(child);
        child.update();
      }
    };
    return result;
  };
  const updateGrid = Game.Grid.prototype.update;
  Game.Grid.prototype.update = function (...args) {
    this.classicUpdatedChildren = new WeakSet();
    try { return updateGrid.apply(this, args); }
    finally { this.classicUpdatedChildren = null; }
  };

  const init = Game.GameplayState.prototype.init;
  Game.GameplayState.prototype.init = function (...args) {
    Object.assign(Game.SETTINGS, {
      BOMB_TIMER: 60 * frameMS,
      FROZEN_TIME: 300 * frameMS,
      SLOW_TIME: 600 * frameMS,
    });
    return init.apply(this, args);
  };

  Game.BombExplosion.prototype.checkTimer = function () {
    if (!this.hasExploded) return;
    this.timer += this.game.time.elapsedMS;
    while (this.classicRayDistance < this.power &&
      this.timer + 1e-7 >= (this.classicRayDistance + 1) * frameMS) {
      this.classicPropagate(++this.classicRayDistance);
    }
    // The Flash rays grow one cell per frame, then remain dangerous for 10 frames.
    if (this.timer >= (this.power + 10) * frameMS) this.endExplosion();
  };
  Game.BombExplosion.prototype.createExplosion = function () {
    this.classicStoppedRays = 0;
    this.classicRayDistance = 0;
  };
  Game.BombExplosion.prototype.classicPropagate = function (distance) {
    const rays = [[-1, 0, Game.DIRECTION.LEFT], [0, -1, Game.DIRECTION.UP],
      [1, 0, Game.DIRECTION.RIGHT], [0, 1, Game.DIRECTION.DOWN]];
    rays.forEach(([dx, dy, direction], index) => {
      if (this.classicStoppedRays & (1 << index) ||
          (this.direction !== Game.DIRECTION.ALL && this.direction !== direction)) return;
      const x = this.gridPositionX + dx * distance, y = this.gridPositionY + dy * distance;
      const cell = this.grid.cells[x]?.[y];
      if (!cell || cell.cellContains === Game.MAP.WALL) {
        this.classicStoppedRays |= 1 << index;
        return;
      }
      const block = cell.cellContains === Game.MAP.BLOCK;
      if (block) {
        this.classicStoppedRays |= 1 << index;
        this.grid.destroyBox(cell);
        this.game.ph2NotificationManager.postNotification('_ADD_SCORE_BLOCK', this.player.playerID);
      } else if (cell.cellContains === Game.MAP.BOMB) this.grid.explodeBomb(cell);
      else if (cell.cellContains === Game.MAP.MINE) this.grid.destroyMine(cell);
      // Read occupancy when the wave arrives. A newly placed bomb must also
      // chain, and a box must never disappear before its wave reaches it.
      this.createFire(x, y, dy ? 90 : 0, direction, block || distance === this.power);
    });
  };

  // Each overlapping blast owns its own lifetime. The upstream cleanup clears
  // a boolean globally and can restore a stale BOMB/BLOCK after a chain reaction.
  function finishExplosion() {
    const cells = [this.gridCell, ...this.cellsUsed];
    const contents = cells.map(cell => cell.cellContains);
    const grid = this.grid;
    for (const key of ['bombExplosions', 'weaponExplosions']) {
      const index = grid[key]?.indexOf(this) ?? -1;
      if (index !== -1) grid[key].splice(index, 1);
    }
    for (const sprite of this.explosion) sprite.visible = false;
    this.destroy();
    cells.forEach((cell, index) => {
      const atCell = obj => obj.gridPositionX === cell.gridPositionX && obj.gridPositionY === cell.gridPositionY;
      const bomb = grid.bombs?.find(atCell), mine = grid.mines?.find(atCell);
      const item = grid.getItemAtCell(cell);
      cell.cellContains = bomb ? Game.MAP.BOMB : mine ? Game.MAP.MINE : item != null ? Game.MAP.ITEM :
        [Game.MAP.BOMB, Game.MAP.BLOCK, Game.MAP.ITEM, Game.MAP.MINE].includes(contents[index]) ? Game.MAP.FREE : contents[index];
      cell.isEmpty = !bomb && cell.cellContains !== Game.MAP.WALL && cell.cellContains !== Game.MAP.BLOCK;
      const blast = [...grid.bombExplosions, ...(grid.weaponExplosions || [])].find(other =>
        other !== this && other.exists && other.hasExploded && (other.gridCell === cell || other.cellsUsed.includes(cell)));
      const weapon = grid.weapons?.find(other => other.exists &&
        ((other.weaponType === Game.ITEM_TYPE?.FIRE && other.columnSprites?.some(sprite => sprite.x === cell.centerX && sprite.y === cell.centerY)) ||
         (other instanceof Game.Rocket && other.active && other.gridCell === cell)));
      cell.isDangerCell = !!(blast || weapon);
      if (blast || weapon) cell.dangerOwner = (blast || weapon).player;
      grid.astarGrid.grid[cell.gridPositionX][cell.gridPositionY].weight = bomb ? 0 : 1;
    });
  }
  Game.BombExplosion.prototype.endExplosion = finishExplosion;
  Game.WeaponExplosion.prototype.endExplosion = finishExplosion;

  Game.WeaponExplosion.prototype.checkTimer = function () {
    if (!this.hasExploded || this.grid.gameStatus === Game.GAME_STATUS.PAUSED) return;
    this.timer += this.game.time.elapsedMS;
    if (this.timer >= 10 * frameMS) this.endExplosion();
  };

  // Weapons already belong to Phaser's scene graph. Updating them again from
  // Grid.checkWeapons halves timers and doubles projectile movement.
  Game.Grid.prototype.checkWeapons = function () {
    this.weapons = this.weapons.filter(weapon => weapon.alive && weapon.exists);
  };
  for (const type of [Game.Mine, Game.Rocket]) {
    const update = type.prototype.update;
    type.prototype.update = function () {
      if (this.grid.gameStatus === Game.GAME_STATUS.PAUSED) return;
      update.call(this);
    };
  }

  Game.Columns.prototype.update = function () {
    if (this.grid.gameStatus === Game.GAME_STATUS.PAUSED || (!this.used && !this.active)) return;
    this.classicElapsed = (this.classicElapsed || 0) + this.game.time.elapsedMS;
    // The original creates cells on frames 4, 8, 12 and clears the area on 49.
    while (this.used && this.currentColumn < this.usedCells.length &&
      this.classicElapsed >= (this.currentColumn + 1) * 4 * frameMS) this.createColumn();
    if (this.used && this.currentColumn >= this.usedCells.length) {
      this.used = false;
      this.active = true;
    }
    if (this.classicElapsed + 1e-7 < 49 * frameMS) return;
    const animation = this.weaponType === Game.ITEM_TYPE.FREEZE ? 'ice_out' : 'fire_out';
    for (const sprite of this.columnSprites) sprite.ph2Animations.play(animation, 1, false);
    for (const cell of this.usedCells) {
      const overlappingColumn = this.grid.weapons.some(weapon => weapon !== this && weapon.exists &&
        weapon.weaponType === this.weaponType && weapon.columnSprites?.some(sprite =>
          sprite.x === cell.centerX && sprite.y === cell.centerY));
      if (overlappingColumn) continue;
      // Ice expiry must still clear ice after a bomb overwrites dangerOwner.
      if (this.weaponType === Game.ITEM_TYPE.FREEZE) cell.isFreezeCell = false;
      else {
        const liveBlast = [...this.grid.bombExplosions, ...this.grid.weaponExplosions].some(blast =>
          blast.exists && blast.hasExploded && (blast.gridCell === cell || blast.cellsUsed.includes(cell)));
        if (!liveBlast) cell.isDangerCell = false;
      }
    }
    this.active = this.finish = false;
    this.destroyWeapon();
  };

  const checkFreeze = Game.Player.prototype.checkFreeze;
  Game.Player.prototype.checkFreeze = function () {
    // In Flash, contact refreshes stopTime to 300 each frame. Count the thaw
    // delay from the final ice contact, rather than from the first contact.
    if (this.frozen && this.gridCell?.isFreezeCell && this.gridCell.dangerOwner !== this) {
      this.frozenTimer = 0;
      return;
    }
    checkFreeze.call(this);
  };
})();
