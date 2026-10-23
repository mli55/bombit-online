/* User-requested bomb holding, with the original per-press skill controls. */
(() => {
  const input = Game.InputController.prototype;
  const pressAction = input.actionKeyPressed;
  const createInputs = input.createInputs;
  const checkInput = input.checkInput;

  input.clearActionHold = function () {
    this.bombHoldEnabled = false;
    this.onlineActionHeld = false;
  };

  input.actionKeyPressed = function () {
    // Lock this press to its starting item: picking up a skill or using its
    // final charge must not fire a different item during the same hold.
    this.bombHoldEnabled = !this.player.dead && !this.player.weaponActive;
    return pressAction.call(this);
  };

  function repeatBomb(controller) {
    if (controller.bombHoldEnabled && !controller.player.weaponActive) {
      // The original path checks frozen/dead status, free cells and bomb limits.
      pressAction.call(controller);
    }
  }

  input.applyOnlineInput = function (mask) {
    this.clearInputs();
    if (this.player.dead) { this.clearActionHold(); return; }
    if (mask & 1) this.upPressed = true;
    else if (mask & 2) this.downPressed = true;
    else if (mask & 4) this.leftPressed = true;
    else if (mask & 8) this.rightPressed = true;

    const held = !!(mask & 16);
    const pressed = held && (!!(mask & 32) || !this.onlineActionHeld);
    if (pressed) this.actionKeyPressed();
    else if (held) repeatBomb(this);
    else this.clearActionHold();
    this.onlineActionHeld = held;
  };

  input.createInputs = function (...args) {
    const result = createInputs.apply(this, args);
    this.clearActionHold();
    this.actionKey?.onUp?.add(this.clearActionHold, this);
    return result;
  };

  input.checkInput = function (...args) {
    const result = checkInput.apply(this, args);
    // Online controllers have no native key state. Offline retains the
    // original movement callbacks and only adds held-bomb attempts.
    if (this.isDesktop && typeof this.actionKey?.isDown === 'boolean') {
      if (!this.actionKey.isDown || this.player.dead) this.clearActionHold();
      else repeatBomb(this);
    }
    return result;
  };
})();
