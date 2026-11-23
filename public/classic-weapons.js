/* 4399 special weapons, timed in Flash frames. Source: DoAction.as putSpecial. */
(() => {
  const frameMS = 1000 / 35;
  const flashCell = 30;
  const offsets = {
    [Game.DIRECTION.LEFT]: [-1, 0], [Game.DIRECTION.UP]: [0, -1],
    [Game.DIRECTION.RIGHT]: [1, 0], [Game.DIRECTION.DOWN]: [0, 1],
  };
  const cellAt = (grid, x, y) => grid.cells[x]?.[y];
  const at = cell => obj => obj.gridPositionX === cell.gridPositionX && obj.gridPositionY === cell.gridPositionY;
  const paused = grid => grid.gameStatus === Game.GAME_STATUS.PAUSED;
  // A box that a blast already hit is no longer a Flash brick. Its HTML5 break
  // animation keeps BLOCK on the cell for a while.
  const liveBox = (grid, cell) => cell.cellContains === Game.MAP.BLOCK && grid.boxes.some(at(cell));
  // Flash "brick": out of bounds, walls, unbroken boxes and ice.
  const isBrick = (grid, cell) => !cell || cell.cellContains === Game.MAP.WALL || cell.isFreezeCell || liveBox(grid, cell);
  const hasBomb = (grid, cell) => cell.cellContains === Game.MAP.BOMB || grid.bombs.some(at(cell));

  // Flash addBrickExp clears a brick silently, without score or item drop.
  // The break animation runs on wall time and can finish after the round's
  // grid has shut down (cells = null); skip the item then.
  const revealItem = Game.Box.prototype.revealItem;
  Game.Box.prototype.revealItem = function () {
    if (!this.classicSilent && this.grid.cells) return revealItem.call(this);
  };

  function iceColumn(grid, cell) {
    return grid.weapons.find(weapon => weapon.exists && weapon.weaponType === Game.ITEM_TYPE.FREEZE &&
      weapon.classicCells?.some(entry => entry.cell === cell && !entry.broken));
  }
  // A bomb ray or fire column breaks ice like a brick (brickBreak: score and a
  // 65% drop). A rocket, grenade or mine blast clears it silently.
  function breakIce(grid, cell, player, scored) {
    const column = iceColumn(grid, cell);
    if (!column) { cell.isFreezeCell = false; return; }
    const entry = column.classicCells.find(item => item.cell === cell && !item.broken);
    entry.broken = true;
    entry.sprite.visible = false;
    cell.isFreezeCell = false;
    if (!scored) return;
    grid.game.ph2NotificationManager.postNotification('_ADD_SCORE_BLOCK', player.playerID);
    if (grid.getItemAtCell(cell) == null) grid.createPowerUp(cell);
  }
  // Flash addBrickExp: one cell of damage for 10 frames, which also sets off a
  // bomb or a mine there. The rocket, grenade and mine all use it.
  function brickExp(grid, cell, player) {
    if (hasBomb(grid, cell)) grid.explodeBomb(cell);
    else if (liveBox(grid, cell)) {
      grid.boxes.find(at(cell)).classicSilent = true;
      grid.destroyBox(cell);
    }
    if (cell.isFreezeCell) breakIce(grid, cell, player, false);
    if (cell.cellContains === Game.MAP.MINE) grid.destroyMine(cell);
    const blast = new Game.WeaponExplosion(grid.game, grid, cell, 0, player, Game.DIRECTION.ALL);
    grid.weaponExplosions.push(blast);
    grid.rowsGroup[cell.gridPositionY].add(blast);
    blast.makeExplosion();
    grid.game.ph2AudioManager.playEffect('explosion', false);
  }
  Game.ClassicWeapons = { isBrick, liveBox, breakIce, brickExp };

  // Flash putSpecial refuses every special while its user stands on a bomb.
  const useWeapon = Game.Player.prototype.useWeapon;
  Game.Player.prototype.useWeapon = function () {
    if (this.weaponActive && this.gridCell && hasBomb(this.grid, this.gridCell)) return;
    return useWeapon.call(this);
  };

  // Mine and gas bomb. The mine hides after its 60-frame placement timeline.
  // Either one is set off by flames on its cell (Grid.destroyMine).
  const mineUpdate = Game.Mine.prototype.update;
  Game.Mine.prototype.update = function () {
    mineUpdate.call(this);
    if (!this.placed || !this.exists || paused(this.grid)) return;
    const half = Game.SETTINGS.CELL_WIDTH * Game.SETTINGS.SCALE / 2;
    for (const player of this.grid.players) {
      if (player === this.player || player.dead) continue;
      const dx = player.x - this.x, dy = player.y - this.y;
      // Flash: a mine fires for any enemy within half a cell, shielded or not.
      // A gas bomb needs the enemy's center exactly on it, so a step must end there.
      const hit = this.weaponType === Game.ITEM_TYPE.BATTERY ? Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6 :
        dx * dx + dy * dy < half * half;
      if (!hit) continue;
      const index = this.grid.mines.indexOf(this);
      this.explodeMine(player);
      if (index !== -1) this.grid.mines.splice(index, 1);
      return;
    }
  };
  const explodeMine = Game.Mine.prototype.explodeMine;
  Game.Mine.prototype.explodeMine = function (player) {
    if (this.weaponType !== Game.ITEM_TYPE.MINE) return explodeMine.call(this, player);
    // One addBrickExp cell, not a cross, and no direct kill: the blast hurts
    // whoever is in the cell unless a shield or invulnerability protects them.
    // Callers remove the mine from grid.mines.
    const cell = this.gridCell;
    if (cell.cellContains === Game.MAP.MINE) cell.cellContains = Game.MAP.FREE;
    this.destroy();
    brickExp(this.grid, cell, this.player);
  };

  // The grenade hits its cell and every in-bounds neighbor except walls.
  Game.Grenade.prototype.explodeGrenade = function () {
    const grid = this.grid, center = this.cellFinal;
    brickExp(grid, center, this.player);
    for (const [dx, dy] of Object.values(offsets)) {
      const cell = cellAt(grid, center.gridPositionX + dx, center.gridPositionY + dy);
      if (cell && cell.cellContains !== Game.MAP.WALL) brickExp(grid, cell, this.player);
    }
    this.destroy();
  };

  // The rocket gains 1 Flash px/frame of speed every frame. Each frame it checks,
  // at its rounded cell: an enemy within half a cell, then the edge or a wall
  // (it explodes one cell back), then a bomb or a brick (it explodes there).
  const rocket = Game.Rocket.prototype;
  const rocketUse = rocket.useWeapon;
  rocket.useWeapon = function () {
    const used = rocketUse.call(this);
    if (used) {
      this.classicOrigin = this.gridCell;
      this.classicSpeed = this.classicDistance = this.classicTime = 0;
    }
    return used;
  };
  rocket.update = function () {
    if (paused(this.grid) || !this.isFlying) return;
    Game.Weapon.prototype.update.call(this);
    this.classicTime += this.game.time.elapsedMS;
    while (this.isFlying && this.classicTime + 1e-7 >= frameMS) {
      this.classicTime -= frameMS;
      this.classicFrame();
    }
  };
  rocket.classicFrame = function () {
    const [dx, dy] = offsets[this.direction];
    const origin = this.classicOrigin, cellSize = Game.SETTINGS.CELL_WIDTH * this.gameScale;
    this.classicSpeed += 1;
    this.classicDistance += this.classicSpeed;
    const distance = this.classicDistance * cellSize / flashCell;
    this.x = origin.centerX + dx * distance;
    this.y = origin.centerY + dy * distance - this.offsetY;
    const steps = Math.round(this.classicDistance / flashCell);
    const cell = cellAt(this.grid, origin.gridPositionX + dx * steps, origin.gridPositionY + dy * steps);
    const half = cellSize / 2;
    for (const player of this.grid.players) {
      if (player === this.player || player.dead) continue;
      const px = player.x - this.x, py = player.y - (this.y + this.offsetY);
      if (px * px + py * py < half * half) return this.createExplosion(cell || this.gridCell);
    }
    if (!cell || cell.cellContains === Game.MAP.WALL) {
      return this.createExplosion(cellAt(this.grid, origin.gridPositionX + dx * (steps - 1), origin.gridPositionY + dy * (steps - 1)));
    }
    if (hasBomb(this.grid, cell) || isBrick(this.grid, cell)) return this.createExplosion(cell);
    if (cell !== this.gridCell) this.updateRocketCell(cell);
  };
  rocket.createExplosion = function (cell = this.gridCell) {
    if (!this.isFlying || !this.exists) return;
    this.isFlying = this.active = false;
    this.animationRocket.visible = false;
    brickExp(this.grid, cell, this.player);
    this.destroyRocket();
  };

  // Ice and fire columns. Every 4 frames (4, 8, 12) the next cell is checked as
  // it is then. A blocked cell skips the counter to 12, so cleanup (counter 49)
  // comes early. Each cell's effect sprite lasts 40 frames.
  const columns = Game.Columns.prototype;
  columns.useWeapon = function () {
    Game.Weapon.prototype.useWeapon.call(this);
    const offset = offsets[this.direction];
    if (!offset) return false;
    const first = cellAt(this.grid, this.startingGridX + offset[0], this.startingGridY + offset[1]);
    if (this.weaponType === Game.ITEM_TYPE.FREEZE ? !first || isBrick(this.grid, first) || hasBomb(this.grid, first) :
      !first || first.cellContains === Game.MAP.WALL) return false;
    Object.assign(this, { classicCells: [], classicCounter: 0, classicTime: 0, classicReach: 0, used: true, active: false });
    this.usedCells = []; this.columnSprites = [];
    return true;
  };
  columns.update = function () {
    if (paused(this.grid) || !this.used || !this.exists) return;
    this.classicTime += this.game.time.elapsedMS;
    while (this.exists && this.classicTime + 1e-7 >= frameMS) {
      this.classicTime -= frameMS;
      this.classicFrame();
    }
  };
  columns.classicFrame = function () {
    const ice = this.weaponType === Game.ITEM_TYPE.FREEZE;
    for (const entry of this.classicCells) {
      if (entry.broken || ++entry.age !== 40) continue;
      entry.sprite.ph2Animations.play(ice ? 'ice_out' : 'fire_out', 1, false);
    }
    if (ice) this.classicFreeze();
    if (++this.classicCounter <= 12) {
      if (this.classicCounter % 4) return;
      const [dx, dy] = offsets[this.direction];
      this.classicReach++;
      const cell = cellAt(this.grid, this.startingGridX + dx * this.classicReach, this.startingGridY + dy * this.classicReach);
      const open = ice ? cell && !isBrick(this.grid, cell) && !hasBomb(this.grid, cell) : cell && cell.cellContains !== Game.MAP.WALL;
      if (!open) { this.classicCounter = 12; return; }
      if (ice) this.classicIce(cell); else this.classicFire(cell);
    } else if (this.classicCounter > 48) this.classicCleanup();
  };
  columns.classicAdd = function (cell, key, animation) {
    const sprite = this.game.add.ph2AnimationObject(cell.centerX, cell.centerY, key, 'atlas_library');
    sprite.ph2Animations.play(animation, 1, false);
    this.grid.rowsGroup[cell.gridPositionY].add(sprite);
    this.columnSprites.push(sprite);
    this.usedCells.push(cell);
    this.classicCells.push({ cell, sprite, age: 0, broken: false });
  };
  columns.classicIce = function (cell) {
    cell.isFreezeCell = true;
    cell.dangerOwner = this.player;
    this.classicAdd(cell, 'ice', 'ice_in');
    this.game.ph2AudioManager.playEffect('ice', false);
  };
  columns.classicFire = function (cell) {
    if (hasBomb(this.grid, cell)) this.grid.explodeBomb(cell);
    if (liveBox(this.grid, cell)) {
      this.grid.destroyBox(cell);
      this.game.ph2NotificationManager.postNotification('_ADD_SCORE_BLOCK', this.player.playerID);
    } else if (cell.isFreezeCell) breakIce(this.grid, cell, this.player, true);
    if (cell.cellContains === Game.MAP.MINE) this.grid.destroyMine(cell);
    cell.isDangerCell = true;
    cell.dangerOwner = this.player;
    this.classicAdd(cell, 'fire', 'fire_in');
    this.game.ph2AudioManager.playEffect('fire', false);
  };
  // Each live ice cell sets stopTime = 300 on any hero, its user included,
  // whose center is within 10 of 30 px of the cell's center.
  columns.classicFreeze = function () {
    const reach = Game.SETTINGS.CELL_WIDTH * Game.SETTINGS.SCALE * 10 / flashCell;
    for (const { cell, age, broken } of this.classicCells) {
      if (broken || age >= 40) continue;
      for (const player of this.grid.players) {
        if (player.dead) continue;
        const dx = player.x - cell.centerX, dy = player.y - cell.centerY;
        if (dx * dx + dy * dy < reach * reach) { player.frozen = true; player.frozenTimer = 0; }
      }
    }
  };
  columns.classicCleanup = function () {
    const ice = this.weaponType === Game.ITEM_TYPE.FREEZE;
    for (const { cell, broken } of this.classicCells) {
      if (ice) { if (!broken) cell.isFreezeCell = false; continue; }
      const otherFire = this.grid.weapons.some(weapon => weapon !== this && weapon.exists && weapon.used &&
        weapon.weaponType === Game.ITEM_TYPE.FIRE && weapon.classicCells?.some(entry => entry.cell === cell));
      const liveBlast = [...this.grid.bombExplosions, ...this.grid.weaponExplosions].some(blast =>
        blast.exists && blast.hasExploded && (blast.gridCell === cell || blast.cellsUsed.includes(cell)));
      if (!otherFire && !liveBlast) cell.isDangerCell = false;
    }
    this.used = this.active = this.finish = false;
    this.destroyWeapon();
  };

  // Freezing now comes only from ice contact above. Hide the cell flag from the
  // port's own freeze check, which used the cell and skipped the ice's owner.
  // Mines and gas bombs trigger in Mine.update, by Flash distance.
  const danger = Game.Player.prototype.checkDangerZone;
  Game.Player.prototype.checkDangerZone = function () {
    const cell = this.gridCell;
    if (!cell) return danger.call(this);
    const ice = cell.isFreezeCell, mine = cell.cellContains === Game.MAP.MINE;
    cell.isFreezeCell = false;
    if (mine) cell.cellContains = Game.MAP.FREE;
    try { return danger.call(this); } finally {
      cell.isFreezeCell = ice;
      if (mine && cell.cellContains === Game.MAP.FREE) cell.cellContains = Game.MAP.MINE;
    }
  };
})();
