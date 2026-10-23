// Shared room protocol for Node and Cloudflare. Game simulation stays in browsers.
export const FPS = 30;
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), n => n.toString(16).padStart(2, '0')).join('');
const cleanName = name => String(name || '玩家').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16) || '玩家';
export class Room {
  constructor(code, { now = () => Date.now(), manual = false } = {}) {
    this.code = code; this.now = now; this.manual = manual; this.players = Array(4).fill(null);
    this.phase = 'lobby'; this.settings = { mode: 'coop', difficulty: 1 }; this.frames = [];
    this.tick = 0; this.created = false; this.timer = null; this.touched = now(); this.checks = new Map();
    this.verified = 0; this.generation = ''; this.result = null;
  }
  send(ws, data) { if (ws?.readyState === 1) ws.send(JSON.stringify(data)); }
  error(ws, message, reset = false) { this.send(ws, { type: 'error', message, reset }); }
  broadcast(data) { for (const p of this.players) if (p) this.send(p.ws, data); }
  roster() {
    return { type: 'room', code: this.code, phase: this.phase, settings: this.settings, tick: this.tick, verified: this.verified,
      players: this.players.map((p, seat) => p ? { seat, name: p.name, character: p.character, online: !!p.ws, ready: p.ready } : null), result: this.result };
  }
  announce() { this.broadcast(this.roster()); }
  members() { return this.players.filter(Boolean); }
  stop() { clearInterval(this.timer); this.timer = null; }
  run() { this.stop(); if (!this.manual) this.timer = setInterval(() => this.step(), 1000 / FPS); }
  prepare(ws) { this.send(ws, { type: 'prepare', generation: this.generation, config: this.config, history: this.frames }); }
  receive(ws, msg) {
    this.touched = this.now();
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    if (msg.type === 'ping') return this.send(ws, { type: 'pong', time: msg.time });
    let seat = this.players.findIndex(p => p?.ws === ws);
    if (msg.type === 'create') {
      if (this.created || seat >= 0) return this.error(ws, '这个房间已经存在，请创建新房间');
      this.created = true; seat = 0;
      this.players[0] = { token: randomToken(), ws, character: 0, name: cleanName(msg.name), ready: false, keys: 0, ack: 0 };
    } else if (msg.type === 'join') {
      if (seat >= 0) return;
      if (!this.created) return this.error(ws, '房间不存在或已过期', true);
      seat = this.players.findIndex(p => p && p.token === msg.token);
      if (seat >= 0) {
        if (this.players[seat].ws) return this.error(ws, '这个玩家已经在线，请用另一个浏览器加入', true);
        this.players[seat].ws = ws; this.players[seat].keys = 0;
      } else {
        if (msg.token) return this.error(ws, '重连身份已过期', true);
        if (this.phase !== 'lobby') return this.error(ws, '正在对局，请等房主返回房间后加入');
        const capacity = this.settings.mode === 'coop' ? 2 : 4;
        seat = this.players.findIndex((p, i) => !p && i < capacity);
        if (seat < 0) return this.error(ws, this.settings.mode === 'coop' ? '闯关最多两人；四人请让房主切换到混战' : '房间已满');
        const used = new Set(this.members().map(p => p.character));
        const character = [0, 1, 2, 3].find(n => !used.has(n));
        this.players[seat] = { token: randomToken(), ws, character, name: cleanName(msg.name), ready: false, keys: 0, ack: 0 };
      }
    } else {
      if (seat < 0) return this.error(ws, '请先加入房间');
      return this.action(seat, msg);
    }
    const p = this.players[seat];
    this.send(ws, { type: 'joined', code: this.code, seat, token: p.token });
    if (this.config && this.phase !== 'lobby') {
      this.stop(); this.phase = 'reconnecting'; p.prepared = false; this.prepare(ws);
    }
    this.announce();
  }
  action(seat, msg) {
    const p = this.players[seat];
    if (msg.type === 'leave') {
      if (seat === 0) { this.broadcast({ type: 'ended' }); this.dispose(); this.players.fill(null); this.created = false; }
      else { this.disconnect(p.ws); this.players[seat] = null; if (this.phase !== 'lobby') this.toLobby(); this.announce(); }
      return;
    }
    if (msg.type === 'kick' && seat === 0 && Number.isInteger(msg.seat) && msg.seat > 0 && msg.seat < 4) {
      this.send(this.players[msg.seat]?.ws, { type: 'ended' }); this.players[msg.seat] = null;
      if (this.phase !== 'lobby') this.toLobby(); return this.announce();
    }
    if (msg.type === 'lobby' && seat === 0) { this.toLobby(); return this.announce(); }
    if (msg.type === 'settings' && seat === 0 && this.phase === 'lobby') {
      if (!['coop', 'battle'].includes(msg.mode) || ![0, 1, 2].includes(msg.difficulty)) return;
      if (msg.mode === 'coop' && this.players.some((x, i) => x && i >= 2)) return this.error(p.ws, '请先让第 3、4 位玩家离开，再切换闯关');
      this.settings = { mode: msg.mode, difficulty: msg.difficulty };
      this.members().forEach(x => { x.ready = false; }); return this.announce();
    }
    if (msg.type === 'character' && this.phase === 'lobby') {
      if (![0, 1, 2, 3].includes(msg.character) || this.members().some(x => x !== p && x.character === msg.character)) return this.error(p.ws, '这个角色已被选择');
      p.character = msg.character; p.ready = false; return this.announce();
    }
    if (msg.type === 'ready' && this.phase === 'lobby') { p.ready = !!msg.ready; return this.announce(); }
    if (msg.type === 'start' && seat === 0 && this.phase === 'lobby') {
      if (this.members().some(x => !x.ws || !x.ready)) return this.error(p.ws, '等所有玩家准备好后再开始');
      this.generation = randomToken().slice(0, 12); this.frames = []; this.tick = 0; this.verified = 0; this.checks.clear(); this.result = null;
      this.config = { ...this.settings, seed: randomToken(), players: this.members().map(x => ({ seat: this.players.indexOf(x), character: x.character, name: x.name })) };
      this.phase = 'loading';
      this.members().forEach(x => { x.prepared = false; x.ack = 0; x.keys = 0; x.pulse = false; x.lastInput = 0; this.prepare(x.ws); });
      return this.announce();
    }
    if (msg.generation !== this.generation) return;
    if (msg.type === 'prepared' && ['loading', 'reconnecting'].includes(this.phase)) {
      if (msg.tick !== this.tick) return this.error(p.ws, '恢复进度不一致，请重新连接');
      p.prepared = true; p.ack = msg.tick; p.prepareHash = msg.hash;
      if (this.members().every(x => x.ws && x.prepared)) {
        // During initial start every peer must have the same generated board.
        if (this.tick === 0 && new Set(this.members().map(x => x.prepareHash)).size > 1) return this.desync(0);
        this.phase = this.result ? 'result' : 'playing';
        this.broadcast({ type: 'started', generation: this.generation });
        if (!this.result) this.run();
      }
      return this.announce();
    }
    if (msg.type === 'input' && this.phase === 'playing' && Number.isInteger(msg.keys) && msg.keys >= 0 && msg.keys <= 31) {
      if ((msg.keys & 16) && !(p.keys & 16)) p.pulse = true;
      p.keys = msg.keys; p.lastInput = this.now(); return;
    }
    if (msg.type === 'check' && Number.isInteger(msg.tick) && msg.tick >= 0 && msg.tick <= this.tick && typeof msg.hash === 'string' && msg.hash.length <= 64) {
      p.ack = Math.max(p.ack, msg.tick);
      let check = this.checks.get(msg.tick);
      if (!check) { check = new Map(); this.checks.set(msg.tick, check); }
      check.set(seat, msg.hash);
      if (check.size === this.members().length) {
        if (new Set(check.values()).size > 1) return this.desync(msg.tick);
        this.verified = Math.max(this.verified, msg.tick);
        this.broadcast({ type: 'verified', tick: this.verified });
        for (const n of this.checks.keys()) if (n <= msg.tick) this.checks.delete(n);
      }
      return;
    }
    if (msg.type === 'result' && seat === 0 && this.phase === 'playing' && msg.result && typeof msg.result === 'object') {
      this.result = { winner: Number.isInteger(msg.result.winner) ? msg.result.winner : null, canContinue: !!msg.result.canContinue, win: !!msg.result.win, level: Number(msg.result.level) || 1, scores: Array.isArray(msg.result.scores) ? msg.result.scores.slice(0, 4).map(Number) : [] };
      this.stop(); this.phase = 'result'; return this.announce();
    }
    if (msg.type === 'continue' && seat === 0 && this.phase === 'result' && this.result?.canContinue) {
      this.pendingCommand = 'continue'; this.result = null; this.phase = 'playing'; this.run(); return this.announce();
    }
    if (msg.type === 'pause' && seat === 0 && ['playing', 'paused'].includes(this.phase)) {
      if (this.phase === 'playing') { this.stop(); this.phase = 'paused'; this.members().forEach(x => { x.keys = 0; x.pulse = false; }); }
      else { this.phase = 'playing'; this.run(); }
      return this.announce();
    }
    if (msg.type === 'fault') { this.stop(); this.phase = 'fault'; this.broadcast({ type: 'error', message: '游戏运行出错，请房主返回房间重开' }); this.announce(); }
  }
  step() {
    if (this.phase !== 'playing') return;
    if (this.members().some(p => !p.ws)) { this.stop(); this.phase = 'reconnecting'; return this.announce(); }
    if (this.tick > 36000) { this.stop(); this.phase = 'fault'; return this.announce(); }
    if (this.members().some(p => this.tick - p.ack > 180)) {
      // A slow or backgrounded client must not silently diverge.
      this.stop(); this.phase = 'paused'; this.broadcast({ type: 'error', message: '有玩家落后，已暂停。等页面恢复后房主可继续。' }); return this.announce();
    }
    const keys = this.players.map(p => {
      if (!p) return 0;
      let mask = this.now() - p.lastInput > 1500 ? 0 : p.keys;
      if (p.pulse) mask |= 16;
      p.pulse = false; return mask;
    });
    const frame = [++this.tick, keys];
    if (this.pendingCommand) { frame.push(this.pendingCommand); this.pendingCommand = null; }
    this.frames.push(frame);
    this.broadcast({ type: 'frame', generation: this.generation, frame });
  }
  desync(tick) { this.stop(); this.phase = 'desync'; this.broadcast({ type: 'error', message: `第 ${tick} 帧状态不一致，已停止对局，请房主返回房间重开` }); this.announce(); }
  disconnect(ws) {
    const p = this.players.find(p => p?.ws === ws); if (!p) return;
    p.ws = null; p.keys = 0; p.pulse = false; p.ready = false; this.touched = this.now();
    if (this.config && this.phase !== 'lobby') { this.stop(); this.phase = 'reconnecting'; }
    this.announce();
  }
  toLobby() { this.stop(); this.config = null; this.frames = []; this.checks.clear(); this.result = null; this.phase = 'lobby'; this.members().forEach(x => { x.ready = false; x.keys = 0; }); }
  dispose() { this.stop(); this.checks.clear(); this.frames = []; }
}
