// Shared room protocol for Node and Cloudflare. Game simulation stays in browsers.
export const FPS = 60;
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), n => n.toString(16).padStart(2, '0')).join('');
const scoresForPlayers = scores => Array.from({ length: 4 }, (_, i) => Number.isFinite(Number(scores?.[i])) ? Number(scores[i]) : 0);
export class Room {
  constructor(code, { now = () => Date.now(), manual = false, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.code = code; this.now = now; this.manual = manual; this.players = Array(4).fill(null);
    // Do not call native Workers timers with Room as their receiver.
    this.setTimer = (callback, delay) => setTimer(callback, delay);
    this.clearTimer = timer => clearTimer(timer); this.timerEpoch = 0;
    this.phase = 'lobby'; this.settings = { difficulty: 1 }; this.frames = [];
    this.tick = 0; this.created = false; this.timer = null; this.running = false; this.touched = now(); this.checks = new Map();
    this.verified = 0; this.generation = ''; this.result = null;
  }
  send(ws, data) { if (ws?.readyState === 1) ws.send(JSON.stringify(data)); }
  error(ws, message, reset = false) { this.send(ws, { type: 'error', message, reset }); }
  broadcast(data) { for (const p of this.players) if (p) this.send(p.ws, data); }
  roster() {
    return { type: 'room', code: this.code, phase: this.phase, settings: this.settings, tick: this.tick, verified: this.verified,
      players: this.players.map((p, seat) => p ? { seat, name: p.name, character: p.character, online: !!p.ws, ready: p.ready, prepared: !!p.prepared } : null), result: this.result };
  }
  announce() { this.broadcast(this.roster()); }
  members() { return this.players.filter(Boolean); }
  stop() { this.clearTimer(this.timer); this.timer = null; this.running = false; this.timerEpoch++; }
  run() {
    this.stop();
    this.running = true;
    if (this.manual) return;
    const interval = 1000 / FPS, epoch = this.timerEpoch;
    let deadline = this.now() + interval;
    const schedule = () => { this.timer = this.setTimer(tick, Math.max(0, Math.ceil(deadline - this.now()))); };
    const tick = () => {
      if (epoch !== this.timerEpoch) return;
      this.timer = null;
      if (this.now() < deadline) return schedule();
      this.step();
      if (epoch !== this.timerEpoch || this.phase !== 'playing') return;
      deadline += interval;
      // A late callback emits one ordered game frame, never a burst of catch-up frames.
      // Keep the fractional deadlines so 60 Hz does not become a 16 ms interval.
      const after = this.now();
      if (deadline <= after) {
        deadline += (Math.floor((after - deadline) / interval) + 1) * interval;
        // Floating-point rounding must not schedule another frame at the same instant.
        if (deadline <= after) deadline += interval;
      }
      schedule();
    };
    schedule();
  }
  prepare(ws) { this.send(ws, { type: 'prepare', generation: this.generation, tick: this.tick, config: this.config, history: this.frames }); }
  replayPlayer(p) {
    p.prepared = false; p.keys = 0; p.pulse = false; p.lastInput = 0;
    this.prepare(p.ws);
  }
  startWhenLoaded() {
    if (this.phase !== 'loading') return;
    const online = this.members().filter(p => p.ws);
    if (!online.length || online.some(p => !p.prepared)) return;
    if (this.tick === 0 && new Set(online.map(p => p.prepareHash)).size > 1) return this.desync(0);
    this.phase = this.result ? 'result' : 'playing';
    this.broadcast({ type: 'started', generation: this.generation });
    if (this.phase === 'playing' && !this.running) this.run();
  }
  startMatch({ round = 1, scores = [0, 0, 0, 0] } = {}) {
    this.stop();
    this.generation = randomToken().slice(0, 12); this.frames = []; this.tick = 0; this.verified = 0; this.checks.clear(); this.result = null;
    this.config = { ...this.settings, tickRate: FPS, round, scores: scoresForPlayers(scores), seed: randomToken(), players: this.members().map(x => ({ seat: this.players.indexOf(x), character: x.character, name: x.name })) };
    this.phase = 'loading';
    this.members().forEach(x => { x.prepared = false; x.prepareHash = null; x.ack = 0; x.keys = 0; x.pulse = false; x.lastInput = 0; this.prepare(x.ws); });
    this.announce();
  }
  receive(ws, msg) {
    const receivedAt = this.now(); this.touched = receivedAt;
    let seat = this.players.findIndex(p => p?.ws === ws);
    if (seat >= 0) this.players[seat].lastSeen = receivedAt;
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    if (msg.type === 'ping') return this.send(ws, { type: 'pong', time: msg.time });
    if (msg.type === 'create') {
      if (this.created || seat >= 0) return this.error(ws, '这个房间已经存在，请创建新房间');
      this.created = true; seat = 0;
      this.players[0] = { token: randomToken(), ws, character: 0, name: 'P1', ready: false, keys: 0, ack: 0, lastSeen: receivedAt };
    } else if (msg.type === 'join') {
      if (seat >= 0) return;
      if (!this.created) return this.error(ws, '房间不存在或已过期', true);
      seat = this.players.findIndex(p => p && p.token === msg.token);
      if (seat >= 0) {
        if (this.players[seat].ws) return this.error(ws, '这个玩家已经在线，请用另一个浏览器加入', true);
        this.players[seat].ws = ws; this.players[seat].keys = 0; this.players[seat].lastSeen = receivedAt;
      } else {
        if (msg.token) return this.error(ws, '重连身份已过期', true);
        if (this.phase !== 'lobby') return this.error(ws, '正在对局，请等房主返回房间后加入');
        seat = this.players.findIndex(p => !p);
        if (seat < 0) return this.error(ws, '房间已满');
        const used = new Set(this.members().map(p => p.character));
        const character = [0, 1, 2, 3].find(n => !used.has(n));
        this.players[seat] = { token: randomToken(), ws, character, name: `P${seat + 1}`, ready: false, keys: 0, ack: 0, lastSeen: receivedAt };
      }
    } else {
      if (seat < 0) return this.error(ws, '请先加入房间');
      return this.action(seat, msg);
    }
    const p = this.players[seat];
    this.send(ws, { type: 'joined', code: this.code, seat, token: p.token });
    if (this.config && this.phase !== 'lobby') this.replayPlayer(p);
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
      if (![0, 1, 2].includes(msg.difficulty)) return;
      this.settings = { difficulty: msg.difficulty };
      this.members().forEach(x => { x.ready = false; }); return this.announce();
    }
    if (msg.type === 'character' && this.phase === 'lobby') {
      if (![0, 1, 2, 3].includes(msg.character) || this.members().some(x => x !== p && x.character === msg.character)) return this.error(p.ws, '这个角色已被选择');
      p.character = msg.character; p.ready = false; return this.announce();
    }
    if (msg.type === 'ready' && this.phase === 'lobby') { p.ready = !!msg.ready; return this.announce(); }
    if (msg.type === 'start' && seat === 0 && this.phase === 'lobby') {
      if (this.members().some(x => !x.ws || !x.ready)) return this.error(p.ws, '等所有玩家准备好后再开始');
      return this.startMatch();
    }
    if (msg.generation !== this.generation) return;
    if (msg.type === 'prepared' && this.config && this.phase !== 'lobby') {
      if (p.prepared) return;
      if (!Number.isInteger(msg.tick) || msg.tick < 0 || msg.tick > this.tick) return this.error(p.ws, '恢复进度不一致，请重新连接');
      p.prepared = true; p.ack = msg.tick; p.prepareHash = msg.hash;
      if (this.phase === 'loading') this.startWhenLoaded();
      // If everyone had disconnected, resume only after the first returning replica is ready.
      // An individual replay must never stop or restart the room's existing clock.
      else if (this.phase === 'playing' && !this.running) this.run();
      return this.announce();
    }
    if (msg.type === 'input' && this.phase === 'playing' && p.prepared && Number.isInteger(msg.keys) && msg.keys >= 0 && msg.keys <= 31) {
      if ((msg.keys & 16) && !(p.keys & 16)) p.pulse = true;
      p.keys = msg.keys; p.lastInput = this.now(); return;
    }
    if (msg.type === 'check' && p.prepared && Number.isInteger(msg.tick) && msg.tick >= 0 && msg.tick <= this.tick && typeof msg.hash === 'string' && msg.hash.length <= 64) {
      p.ack = Math.max(p.ack, msg.tick);
      if (msg.tick <= this.verified) return;
      let check = this.checks.get(msg.tick);
      if (!check) { check = new Map(); this.checks.set(msg.tick, check); }
      check.set(seat, msg.hash);
      const online = this.members().map((member) => this.players.indexOf(member)).filter(i => this.players[i].ws && this.players[i].prepared);
      if (online.length && online.every(i => check.has(i))) {
        if (new Set(online.map(i => check.get(i))).size > 1) return this.desync(msg.tick);
        this.verified = Math.max(this.verified, msg.tick);
        this.broadcast({ type: 'verified', tick: this.verified });
        for (const n of this.checks.keys()) if (n <= msg.tick) this.checks.delete(n);
      }
      return;
    }
    if (msg.type === 'result' && seat === this.players.findIndex(member => member?.ws && member.prepared) && this.phase === 'playing' && msg.result && typeof msg.result === 'object') {
      this.result = { winner: Number.isInteger(msg.result.winner) ? msg.result.winner : null, canContinue: true, win: !!msg.result.win, level: Number(msg.result.level) || 1, scores: scoresForPlayers(msg.result.scores) };
      this.stop(); this.phase = 'result'; return this.announce();
    }
    if (msg.type === 'continue' && seat === 0 && this.phase === 'result' && this.result) {
      return this.startMatch({ round: this.config.round + 1, scores: this.result.scores });
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
    for (const p of this.members().filter(member => member.ws && member.prepared && this.now() - member.lastSeen > 5000)) {
      // Application heartbeats detect half-open connections before the platform's TCP timeout.
      const ws = p.ws; this.disconnect(ws);
      try { ws.close?.(1012, 'Reconnect'); } catch {}
    }
    if (!this.members().some(p => p.ws)) { this.stop(); return; }
    if (this.tick >= FPS * 60 * 20) { this.stop(); this.phase = 'fault'; return this.announce(); }
    const lagging = this.members().filter(p => p.ws && p.prepared && this.tick - p.ack > FPS * 6);
    if (lagging.length) {
      // Recover only the slow replica; other players keep receiving ordered live frames.
      lagging.forEach(p => this.replayPlayer(p));
      this.announce();
    }
    const keys = this.players.map(p => {
      if (!p?.ws || !p.prepared) return 0;
      let mask = this.now() - p.lastInput > 1500 ? 0 : p.keys;
      if (p.pulse) mask |= 16;
      p.pulse = false; return mask;
    });
    const frame = [++this.tick, keys];
    this.frames.push(frame);
    this.broadcast({ type: 'frame', generation: this.generation, frame });
  }
  desync(tick) { this.stop(); this.phase = 'desync'; this.broadcast({ type: 'error', message: `第 ${tick} 帧状态不一致，已停止对局，请房主返回房间重开` }); this.announce(); }
  disconnect(ws) {
    const p = this.players.find(p => p?.ws === ws); if (!p) return;
    p.ws = null; p.keys = 0; p.pulse = false; p.ready = false; p.prepared = false; this.touched = this.now();
    if (!this.members().some(member => member.ws)) this.stop();
    else this.startWhenLoaded();
    this.announce();
  }
  toLobby() { this.stop(); this.config = null; this.frames = []; this.checks.clear(); this.result = null; this.phase = 'lobby'; this.members().forEach(x => { x.ready = false; x.keys = 0; }); }
  dispose() { this.stop(); this.checks.clear(); this.frames = []; }
}
