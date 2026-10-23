/* The upstream menus and animated character selector, with room actions at their edges.
   This file only changes presentation and emits requests. The server still chooses
   the shared roster and starts or continues the deterministic game. */
(() => {
  'use strict';
  const bridge = window.onlineBridge;
  const game = Game.App.getInstance();
  const report = (type, data = {}) => parent.postMessage({ source: 'bomb-it-game', type, ...data }, location.origin);
  const find = (path, root) => Ph2.UISystem.findObject(path, root);
  const colors = ['#ff7ab7', '#ffe05a', '#8ed6ff', '#b9e86c'];
  let room = null, identity = null, enteringLobby = false, onlineSelection = false;
  const pressed = new Set();

  function removePromotion(button) {
    if (!button) return;
    button.inputEnabled = false;
    button.visibility?.enable(false);
    // Some native menu transitions restore visibility. Keep the whole promo
    // subtree hidden, including its NEW badge and click target.
    Object.defineProperty(button, 'visible', { configurable: true, get: () => false, set() {} });
  }
  for (const [State, property] of [[Game.MainMenuState, 'buttonBombit2'], [Game.GameOverState, 'buttonBombIt2']]) {
    const create = State.prototype.create;
    State.prototype.create = function (...args) {
      const result = create.apply(this, args);
      removePromotion(this[property]);
      return result;
    };
  }

  const mainLocalize = Game.MainMenuState.prototype.localizeUI;
  Game.MainMenuState.prototype.localizeUI = function () {
    mainLocalize.call(this);
    const prefix = 'settings_buttons_container/container_players_buttons/';
    for (const [button, text] of [['1player_button', 'SINGLE PLAYER'], ['2players_button', 'MULTIPLAYER']]) {
      const path = prefix + button + '/text';
      find(path, this.uiMainMenu).setText(text);
      Game.Instances.LocalizationManager.fitFontSizeUI(path, this.uiMainMenu,
        175 * Game.SETTINGS.SCALE, -1, 25 * Game.SETTINGS.SCALE);
    }
  };
  const selectPlayerMode = Game.MainMenuState.prototype.selectPlayerMode;
  Game.MainMenuState.prototype.selectPlayerMode = function (button) {
    selectPlayerMode.call(this, button);
    onlineSelection = button === this.button2Player || button.name === '2players_button';
    if (onlineSelection) report('multiplayer-request');
  };
  Game.MainMenuState.prototype.gotoCharacterSelect = function () {
    report(onlineSelection ? 'settings-request' : 'single-request', { difficulty: this.difficulty });
  };

  function currentSelector() {
    if (!onlineSelection || !room || room.phase !== 'lobby' || game.state.current !== 'characterSelectState') return null;
    const state = game.state.getCurrentState();
    return state.onlineSelectorReady ? state : null;
  }
  function self() { return room?.players?.[identity?.seat]; }
  function choose(character) {
    const state = currentSelector(), me = self();
    if (!state || !me || !Number.isInteger(character) || character < 0 || character > 3) return;
    if (room.players.some((p, seat) => p && seat !== identity.seat && p.character === character)) return;
    if (me.character !== character) report('character-request', { character });
  }
  function move(direction) {
    const me = self();
    if (!me) return;
    for (let offset = 1; offset < 4; offset++) {
      const character = (me.character + direction * offset + 4) % 4;
      if (!room.players.some((p, seat) => p && seat !== identity.seat && p.character === character)) {
        choose(character); return;
      }
    }
  }
  function confirm() {
    if (currentSelector() && self()) report('confirm-request');
  }
  function textAt(parentObject, x, y, size, text = '') {
    const label = game.add.text(x, y, text, {
      font: `${size}px impact`, fill: '#ffffff', align: 'center',
      stroke: '#347eb5', strokeThickness: 5
    });
    label.anchor.set(0.5); parentObject.addChild(label);
    return label;
  }
  function fit(label, text, width = 150) {
    label.scale.set(1); label.setText(text);
    if (label.width > width) label.scale.set(width / label.width);
  }
  function layoutSelector(state) {
    // Keep the original keyboard instructions; show its native mobile confirm
    // button beside them so clicking and touch need no new web controls.
    const mobile = state.mobileContainer;
    mobile.visibility.enable(false); mobile.visible = true;
    mobile.x = game.width * 0.5 + 390; mobile.y = 580;
    find('controls_mobile/move_text', state.uiCharacterSelect).visible = false;
    const desktop = find('controls_desktop', state.uiCharacterSelect);
    desktop.visibility.enable(false); desktop.visible = true;
    find('controls_desktop/player1_text', state.uiCharacterSelect).visible = false;
    find('controls_desktop_2players', state.uiCharacterSelect).visible = false;
  }
  function refreshSelector(state = currentSelector()) {
    if (!state || !room || !identity) return;
    const me = self();
    if (!me) return;
    state.playerCursorIndex1 = me.character;
    state.charactersChosen = [me.character];
    for (let character = 0; character < 4; character++) {
      const owner = room.players.find(p => p?.character === character);
      const seat = owner ? room.players.indexOf(owner) : -1;
      const hero = state[`hero${character + 1}`];
      const indicator = state[`heroIndicator${character + 1}`];
      const arrow = state[`heroArrow${character + 1}`];
      const labels = state.onlineLabels[character];
      const mine = seat === identity.seat;
      arrow.visible = !!owner;
      arrow.alpha = mine ? 1 : 0.55;
      // Preserve the original 1P/2P sprites. The same position and type treatment
      // extend the selector to seats 3 and 4 without drawing different heroes.
      indicator.visible = !!owner && seat < 2;
      if (indicator.visible) indicator.frameName = `player${seat + 1}${character ? '_' + (character + 1) : ''}.png`;
      labels.seat.visible = !!owner && seat >= 2;
      if (labels.seat.visible) { labels.seat.setText(`${seat + 1}P`); labels.seat.fill = colors[character]; }
      fit(labels.name, owner ? `${owner.name}${mine ? ' · YOU' : ''}` : 'CPU');
      labels.name.fill = mine ? colors[character] : '#ffffff';
      labels.status.setText(owner ? (owner.online ? (owner.ready ? 'READY' : 'WAITING') : 'OFFLINE') : '');
      labels.status.fill = owner?.ready ? '#c7f88a' : '#ffffff';
      const animation = owner ? 'select_character_hero' : 'select_character_hero_stand';
      if (hero.onlineAnimation !== animation) { hero.onlineAnimation = animation; hero.ph2Animations.play(animation, 1, true); }
      hero.inputEnabled = !owner || mine;
      if (hero.input) hero.input.useHandCursor = !owner || mine;
    }
    const members = room.players.filter(Boolean);
    const allReady = members.every(p => p.online && p.ready);
    const label = identity.seat === 0 && allReady ? 'START' : me.ready ? 'WAITING' : 'READY';
    state.onlineConfirmText.setText(label);
    state.buttonMobile.alpha = me.ready && !(identity.seat === 0 && allReady) ? 0.75 : 1;
    layoutSelector(state);
  }

  const selectCreate = Game.CharacterSelectState.prototype.create;
  Game.CharacterSelectState.prototype.create = function () {
    if (!onlineSelection) return selectCreate.call(this);
    selectCreate.call(this);
    enteringLobby = false;
    this.onlineSelectorReady = true;
    this.onlineLabels = [];
    for (let character = 0; character < 4; character++) {
      const hero = this[`hero${character + 1}`];
      const indicator = this[`heroIndicator${character + 1}`];
      hero.inputEnabled = true;
      hero.events.onInputDown.add(() => choose(character));
      this.onlineLabels.push({
        seat: textAt(hero, indicator.x, indicator.y, 44),
        name: textAt(this.heroes, hero.x, 40, 24),
        status: textAt(this.heroes, hero.x, 72, 22)
      });
    }
    this.onlineConfirmText = find('controls_mobile/button_text', this.uiCharacterSelect);
    this.buttonMobile.inputEnabled = true;
    this.buttonMobile.input.useHandCursor = true;
    this.buttonMobile.events.onInputDown.add(confirm);
    // The caption is clickable too, as it sits above the original round button.
    this.onlineConfirmText.inputEnabled = true;
    this.onlineConfirmText.input.useHandCursor = true;
    this.onlineConfirmText.events.onInputDown.add(confirm);
    refreshSelector(this);
  };
  const selectInputs = Game.CharacterSelectState.prototype.createInputs;
  Game.CharacterSelectState.prototype.createInputs = function () {
    if (!onlineSelection) return selectInputs.call(this);
    // Upstream shutdown expects these Phaser.Key objects. Keys themselves are
    // routed through menuKey so key repeats and two keyboard APIs cannot double
    // ready a player or start a match locally.
    this.leftKey1 = game.input.keyboard.addKey(Phaser.Keyboard.LEFT);
    this.rightKey1 = game.input.keyboard.addKey(Phaser.Keyboard.RIGHT);
    this.actionKey1 = game.input.keyboard.addKey(Phaser.Keyboard.SPACEBAR);
  };
  for (const [method, onlineAction] of Object.entries({
    moveLeftPlayer1: () => move(-1), moveRightPlayer1: () => move(1),
    selectCharacterPlayer1: confirm, selectPlayer1onUp: () => {}, gotoGameplay: () => {}
  })) {
    const original = Game.CharacterSelectState.prototype[method];
    Game.CharacterSelectState.prototype[method] = function (...args) {
      return onlineSelection ? onlineAction(...args) : original.apply(this, args);
    };
  }
  const selectResize = Game.CharacterSelectState.prototype.resize;
  Game.CharacterSelectState.prototype.resize = function () {
    selectResize.call(this);
    if (onlineSelection && this.onlineSelectorReady) layoutSelector(this);
  };
  const selectShutdown = Game.CharacterSelectState.prototype.shutdown;
  Game.CharacterSelectState.prototype.shutdown = function () {
    this.onlineSelectorReady = false; this.onlineLabels = null; pressed.clear();
    selectShutdown.call(this);
  };

  bridge.showLobby = function (nextRoom, nextIdentity) {
    onlineSelection = true; room = nextRoom; identity = nextIdentity;
    if (room?.phase !== 'lobby' || !self()) return false;
    if (game.state.current === 'gameplayState' || game.state.current === 'gameOverState') return false;
    game.input.enabled = true; game.input.keyboard.stop();
    if (game.state.current === 'characterSelectState' && game.state.getCurrentState().onlineSelectorReady) refreshSelector();
    else if (!enteringLobby) {
      enteringLobby = true; pressed.clear();
      game.state.start('characterSelectState', true, false, Game.GAME_MODE.ARCADE,
        room.settings.difficulty, Game.PLAYER_MODE.SINGLE_PLAYER);
    }
    return true;
  };
  bridge.startSingle = function (difficulty) {
    room = identity = null; onlineSelection = false; enteringLobby = false; pressed.clear();
    game.input.enabled = true; game.input.keyboard.start();
    game.state.start('characterSelectState', true, false, Game.GAME_MODE.ARCADE,
      difficulty, Game.PLAYER_MODE.SINGLE_PLAYER);
    return true;
  };
  bridge.showMainMenu = function () {
    if (game.state.current === 'gameplayState' || game.state.current === 'gameOverState') return false;
    room = identity = null; onlineSelection = false; enteringLobby = false; pressed.clear();
    game.input.enabled = true; game.input.keyboard.stop();
    game.state.start('mainMenuState', true, false);
    return true;
  };
  bridge.menuKey = function (code, down, repeat = false) {
    if (!currentSelector()) return false;
    if (!['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Space', 'Enter'].includes(code)) return false;
    if (!down) { pressed.delete(code); return true; }
    if (repeat || pressed.has(code)) return true;
    pressed.add(code);
    if (code === 'ArrowLeft' || code === 'KeyA') move(-1);
    else if (code === 'ArrowRight' || code === 'KeyD') move(1);
    else confirm();
    return true;
  };
  for (const type of ['keydown', 'keyup']) window.addEventListener(type, event => {
    if (bridge.menuKey(event.code, type === 'keydown', event.repeat)) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener('blur', () => pressed.clear());
})();
