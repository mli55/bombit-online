/* 4399 human controls: one cell per step, keys checked in a fixed order, and
   fire read every frame at rest (so a held key keeps placing bombs).
   Source: DoAction.as movHero and the frame-2 game loop. */
(() => {
  const frameMS = 1000 / 35;
  // Flash xy order. With several keys held, the first one wins.
  const steps = [
    [-1, 0, Game.DIRECTION.LEFT], [0, -1, Game.DIRECTION.UP],
    [1, 0, Game.DIRECTION.RIGHT], [0, 1, Game.DIRECTION.DOWN],
  ];
  const human = Game.PlayerHuman.prototype;
  const input = Game.InputController.prototype;
  const cellAt = (grid, x, y) => grid.cells[x]?.[y];

  function heldDirections(controller) {
    if (controller.classicOnline) return controller.classicOnlineHeld || [false, false, false, false];
    if (controller.isDesktop && controller.leftKey) {
      return [controller.leftKey, controller.upKey, controller.rightKey, controller.downKey].map(key => !!key?.isDown);
    }
    // The touch stick sets one of the original direction flags.
    return [controller.leftPressed || controller.upLeftPressed || controller.downLeftPressed,
      controller.upPressed, controller.rightPressed || controller.upRightPressed || controller.downRightPressed,
      controller.downPressed];
  }
  function fireHeld(controller) {
    if (controller.classicOnline) return !!controller.onlineActionHeld;
    return !!(controller.isDesktop && controller.actionKey?.isDown);
  }

  // A press only queues fire, like Flash prevFire. It is used when the hero is
  // next at rest, so a bomb pressed mid-step lands on the cell it arrives in.
  human.actionKeyPressed = function () { this.classicPrevFire = true; };

  human.update = function () {
    Game.Player.prototype.update.call(this);
    this.checkPlayerIndicator();
    if (this.dead || this.gameStatus !== Game.GAME_STATUS.PLAYING) return;
    const controller = this.inputController;
    if (!controller.isDesktop && controller.stick && controller.canPressButtons()) controller.checkInputsDPad();
    this.classicHumanTime = (this.classicHumanTime || 0) + this.game.time.elapsedMS;
    while (!this.dead && this.classicHumanTime + 1e-7 >= frameMS) {
      this.classicHumanTime -= frameMS;
      this.classicHumanFrame();
    }
  };

  human.classicHumanFrame = function () {
    const controller = this.inputController;
    const fire = fireHeld(controller);
    if (this.classicMoving) this.classicStep();
    if (this.classicMoving) {
      if (fire) this.classicPrevFire = true;
      return;
    }
    this.movingAnimation = false;
    // Flash stopTime: a frozen hero finishes its step, then waits.
    if (this.frozen) return;
    const held = heldDirections(controller);
    const index = held.findIndex(Boolean);
    if (index !== -1) this.classicBeginStep(index);
    if (!fire && !this.classicPrevFire) return;
    this.classicPrevFire = false;
    // Flash puttAble: after a special, fire does nothing until it is released.
    if (controller.classicPuttable === false) return;
    if (!this.weaponActive) { this.putBomb(); return; }
    // putSpecial needs a hero at rest, so a step started this frame loses it.
    if (this.classicMoving) return;
    const uses = this.weaponCurrentUses, active = this.weaponActive;
    this.useWeapon();
    if ((controller.isDesktop || controller.classicOnline) && (this.weaponCurrentUses !== uses || this.weaponActive !== active)) controller.classicPuttable = false;
  };

  human.classicBeginStep = function (index) {
    const [dx, dy, direction] = steps[index];
    this.direction = direction;
    const cell = cellAt(this.grid, this.gridPositionX + dx, this.gridPositionY + dy);
    if (Game.ClassicWeapons.isBrick(this.grid, cell)) return false;
    const bomb = this.grid.bombs.find(b => b.gridPositionX === cell.gridPositionX && b.gridPositionY === cell.gridPositionY);
    if (bomb || cell.cellContains === Game.MAP.BOMB) {
      // Without a glove, or when the bomb cannot slide, the hero only turns.
      if (!this.canKickBombs || !bomb || !bomb.bombKicked(direction)) return false;
    }
    this.classicMoving = true;
    this.classicFrom = this.gridCell;
    this.classicTo = cell;
    this.classicStepIndex = index;
    this.classicStepFrame = 0;
    this.classicStepFrames = this.slowed ? 20 : (this.classicMoveFrames || 6);
    this.movingAnimation = true;
    this.animationMovement.ph2Animations.resume();
    return true;
  };

  human.classicStep = function () {
    const from = this.classicFrom, to = this.classicTo;
    const progress = Math.min(1, ++this.classicStepFrame / this.classicStepFrames);
    this.x = from.centerX + (to.centerX - from.centerX) * progress;
    this.y = from.centerY + (to.centerY - from.centerY) * progress;
    this.movingAnimation = true;
    // Flash rounds the position to find the hero's cell. Math.round takes .5
    // up, so right and down switch at half way, left and up just after it.
    const [dx, dy] = steps[this.classicStepIndex];
    if (this.gridCell !== to && (dx + dy > 0 ? progress >= 0.5 : progress > 0.5)) this.classicSetCell(to);
    if (progress < 1) return;
    this.classicMoving = false;
    // Items are picked up only at the end of a step.
    this.classicPickup = true;
    try { this.checkItemPickUp(); } finally { this.classicPickup = false; }
  };

  human.classicSetCell = function (cell) {
    if (cell.gridPositionY !== this.gridPositionY) this.grid.rowsGroup[cell.gridPositionY].add(this);
    this.gridCell = cell;
    this.gridPositionX = cell.gridPositionX;
    this.gridPositionY = cell.gridPositionY;
  };

  human.checkItemPickUp = function () {
    if (this.classicPickup) return Game.Player.prototype.checkItemPickUp.call(this);
  };
  // Grid tracking belongs to the step above.
  human.checkActualGridLocation = function () {};

  const createInputs = input.createInputs;
  input.createInputs = function (...args) {
    const result = createInputs.apply(this, args);
    this.classicPuttable = true;
    this.actionKey?.onUp?.add(() => { this.classicPuttable = true; });
    return result;
  };
  // Online frames carry every held direction; the fixed order picks one.
  input.applyOnlineInput = function (mask) {
    this.clearInputs();
    this.classicOnline = true;
    this.classicOnlineHeld = [!!(mask & 4), !!(mask & 1), !!(mask & 8), !!(mask & 2)];
    const held = !!(mask & 16);
    if (this.player.dead) { this.onlineActionHeld = false; this.classicOnlineHeld = [false, false, false, false]; return; }
    if (held && (mask & 32 || !this.onlineActionHeld)) this.player.classicPrevFire = true;
    if (!held) this.classicPuttable = true;
    this.onlineActionHeld = held;
  };
})();
