/* 4399 Bomb It 1 movement, pickups and scoring. Source: docs/classic-parity.md. */
(() => {
  const weapons = ['battery', 'fire', 'freeze', 'grenade', 'mine', 'rocket'];
  let onlineRound = null, localOrder = null, localCycle = -1;
  const shuffle = random => {
    const order = weapons.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = random(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  };
  Game.ClassicRules = {
    orderForRound(seed, round) {
      // The server-issued random room code survives reconnects and round changes.
      // A private RNG leaves the map/gameplay stream untouched and requires no
      // previous rounds in the replay history or new backend protocol fields.
      let state = 2166136261;
      for (const char of String(seed)) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
      const random = n => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return Math.floor(state / 0x100000000 * n);
      };
      let order;
      for (let cycle = 0; cycle <= Math.floor((round - 1) / 3); cycle++) {
        const previous = order?.at(-1);
        order = shuffle(random);
        if (order[0] === previous) [order[0], order[5]] = [order[5], order[0]];
      }
      return order;
    },
    configureRound(game, order, round, campaignSeed) {
      const valid = order?.length === 6 && new Set(order).size === 6 && order.every(x => weapons.includes(x));
      onlineRound = { order: valid ? order.slice() : campaignSeed != null ? this.orderForRound(campaignSeed, round) : shuffle(n => game.rnd.integerInRange(0, n - 1)), round };
    },
  };
  const init = Game.GameplayState.prototype.init;
  Game.GameplayState.prototype.init = function (...args) {
    const level = onlineRound?.round || args[5] || 1;
    const cycle = Math.floor((level - 1) / 3);
    if (!onlineRound && (level === 1 || cycle !== localCycle || !localOrder)) {
      const previous = localOrder?.at(-1);
      localOrder = shuffle(n => this.game.rnd.integerInRange(0, n - 1));
      if (localOrder[0] === previous) [localOrder[0], localOrder[5]] = [localOrder[5], localOrder[0]];
      localCycle = cycle;
    }
    const order = onlineRound?.order || localOrder;
    const pair = order.slice(((level - 1) % 3) * 2, ((level - 1) % 3) * 2 + 2);
    onlineRound = null;
    Object.assign(Game.SETTINGS, {
      INITIAL_SPEED: Game.SETTINGS.CELL_WIDTH * 35 / 6000,
      SPEED_INCREASE: 0, // Speed pickups change frame counts: 6 -> 5 -> 4 -> 3.
      MAX_SPEED: Game.SETTINGS.CELL_WIDTH * 35 / 3000,
      SLOW_SPEED: Game.SETTINGS.CELL_WIDTH * 35 / 20000,
      MAX_BOMB_POWER: 10,
      MAX_BOMBS: Number.MAX_SAFE_INTEGER,
      CHANCE_POWER_UP: 65,
      CHANCE_POWER_UP_BEING_WEAPON: 20,
      POWER_UP_CHANCES: [
        { name: 'heart', chance: 1 }, { name: 'push', chance: 14 },
        { name: 'bomb', chance: 25 }, { name: 'shield', chance: 10 },
        { name: 'power', chance: 25 }, { name: 'speed', chance: 25 },
      ],
      WEAPON_CHANCES: pair.map(name => ({ name, chance: 50 })),
    });
    return init.apply(this, args);
  };

  const pickup = Game.Player.prototype.checkItemPickUp;
  Game.Player.prototype.checkItemPickUp = function () {
    const cell = this.gridCell;
    const type = cell?.isItemCell ? this.grid.getItemAtCell(cell) : null;
    const isAI = this.isAI;
    // Normal Flash CPUs may collect hearts, but not speed or special weapons.
    if (isAI && this.grid.difficulty === Game.DIFFICULTY.NORMAL && type === Game.ITEM_TYPE.HEART) this.isAI = false;
    try { pickup.call(this); } finally { this.isAI = isAI; }
    if (type === Game.ITEM_TYPE.SPEED && !cell.isItemCell) {
      this.classicMoveFrames = Math.max(3, (this.classicMoveFrames || 6) - 1);
      this.speed = Game.SETTINGS.CELL_WIDTH * 35 / (this.classicMoveFrames * 1000);
    }
  };

  Game.ScoreManager.prototype.addLeftOverTime = function (elapsedMS, playerID) {
    const score = Math.floor(Math.max(0, Game.SETTINGS.MATCH_TIME - elapsedMS) / 100);
    this.leftOverScores[playerID] += score;
    this.totalScores[playerID] += score;
    this.finalScores[playerID] += score;
    this.updatePlayerScore(playerID);
  };
  // Flash credits a damaging hit before hurtHero consumes a shield. The HTML5
  // engine already credits lethal hits, so only add the missing shield case.
  function creditShieldHit(player, cell) {
    if (player.shieldActive && !player.invulnerable && !player.invincible &&
        cell?.dangerOwner && cell.dangerOwner.playerID !== player.playerID) {
      player.game.ph2NotificationManager.postNotification('_ADD_SCORE_KILLS', cell.dangerOwner.playerID);
    }
  }
  const danger = Game.Player.prototype.checkDangerZone;
  Game.Player.prototype.checkDangerZone = function () {
    if (this.gridCell?.isDangerCell) creditShieldHit(this, this.gridCell);
    return danger.call(this);
  };
  const mine = Game.Player.prototype.activateMine;
  Game.Player.prototype.activateMine = function (cell) {
    creditShieldHit(this, cell);
    return mine.call(this, cell);
  };
})();
