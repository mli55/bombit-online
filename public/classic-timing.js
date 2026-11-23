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
      // The mine's placement timeline stops (hidden) at frame 60.
      TIME_TO_HIDE_MINE: 59 * frameMS,
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
      // Flash clears a broken brick at once, so a second wave passes through it.
      // Here the box keeps BLOCK until its break animation ends, after
      // Grid.destroyBox has already removed it from grid.boxes.
      const block = cell.cellContains === Game.MAP.BLOCK && this.grid.boxes.some(box =>
        box.gridPositionX === x && box.gridPositionY === y);
      // Ice is a Flash brick too: the ray stops there and breaks it.
      const ice = !block && cell.isFreezeCell;
      if (block) {
        this.classicStoppedRays |= 1 << index;
        this.grid.destroyBox(cell);
        this.game.ph2NotificationManager.postNotification('_ADD_SCORE_BLOCK', this.player.playerID);
      } else if (ice) {
        this.classicStoppedRays |= 1 << index;
        Game.ClassicWeapons.breakIce(this.grid, cell, this.player, true);
      } else if (cell.cellContains === Game.MAP.BOMB) this.grid.explodeBomb(cell);
      if (!block && cell.cellContains === Game.MAP.MINE) this.grid.destroyMine(cell);
      // Read occupancy when the wave arrives. A newly placed bomb must also
      // chain, and a box must never disappear before its wave reaches it.
      this.createFire(x, y, dy ? 90 : 0, direction, block || ice || distance === this.power);
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
    // Damage ends here. Flash then fades the flames by 20% a frame and removes
    // them on the fifth frame.
    this.hasExploded = false;
    (grid.classicFading ||= []).push({ owner: this, sprites: [this, ...this.explosion], frames: 0 });
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
  const gridUpdate = Game.Grid.prototype.update;
  Game.Grid.prototype.update = function () {
    gridUpdate.call(this);
    if (!this.classicFading?.length || this.gameStatus === Game.GAME_STATUS.PAUSED) return;
    this.classicFadeTime = (this.classicFadeTime || 0) + this.game.time.elapsedMS;
    while (this.classicFadeTime + 1e-7 >= frameMS) {
      this.classicFadeTime -= frameMS;
      for (const fade of this.classicFading) {
        const alpha = 1 - 0.2 * ++fade.frames;
        for (const sprite of fade.sprites) sprite.alpha = alpha;
        if (fade.frames < 5) continue;
        for (const sprite of fade.sprites) sprite.visible = false;
        fade.owner.destroy();
      }
      this.classicFading = this.classicFading.filter(fade => fade.frames < 5);
    }
    if (!this.classicFading.length) this.classicFadeTime = 0;
  };
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

})();
