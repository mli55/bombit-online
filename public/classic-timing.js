/* Flash Bomb It 1 timings, converted from its 35 fps timeline to game time.
   Source and limits: docs/classic-timing.md. Never use wall-clock timers here. */
(() => {
  const frameMS = 1000 / 35;
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
    // The Flash rays grow one cell per frame, then remain dangerous for 10 frames.
    if (this.timer >= (this.power + 10) * frameMS) this.endExplosion();
  };
  Game.BombExplosion.prototype.checkEmpty = function (x, y, distance, direction) {
    const cell = this.grid.cells[x][y];
    const angle = y === this.gridPositionY ? 0 : 90;
    this.game.time.events.add(distance * frameMS, () => {
      if (!this.exists) return;
      if (cell.cellContains === Game.MAP.MINE) this.grid.destroyMine(cell);
      if ([Game.MAP.FREE, Game.MAP.ITEM, Game.MAP.MINE].includes(cell.cellContains)) {
        this.createFire(x, y, angle, direction, distance === this.power);
      }
    }, this);
    return distance;
  };

  Game.WeaponExplosion.prototype.checkTimer = function () {
    if (!this.hasExploded || this.grid.gameStatus === Game.GAME_STATUS.PAUSED) return;
    this.timer += this.game.time.elapsedMS;
    if (this.timer >= 10 * frameMS) this.endExplosion();
  };
  const endWeaponExplosion = Game.WeaponExplosion.prototype.endExplosion;
  Game.WeaponExplosion.prototype.endExplosion = function () {
    // Upstream accidentally removes from bombExplosions twice and never removes
    // weaponExplosions. A spent mine/grenade/rocket must not stay in that registry.
    const index = this.grid.weaponExplosions.indexOf(this);
    if (index !== -1) this.grid.weaponExplosions.splice(index, 1);
    endWeaponExplosion.call(this);
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
