const $ = id => document.getElementById(id);
const colors = ['#fc65ae', '#f4d254', '#6cc2ef', '#95cf55'];
const colorNames = ['粉色', '黄色', '蓝色', '绿色'];
let socket, identity = null, room = null, generation = '', bridge = null, iframe = null;
let leaving = false, reconnectTimer, toastTimer, loaded = false, sound = false, preparing = false;
let keys = new Set(), pingTime = 0, packetQueue = [], onGameReady;
const stored = (() => { try { return JSON.parse(sessionStorage.getItem('bomb-it-room')); } catch { return null; } })();
$('name').value = localStorage.getItem('bomb-it-name') || '';
const invitation = new URLSearchParams(location.search).get('room');
if (invitation) $('code').value = invitation.toUpperCase();
function notice(message) { $('notice').textContent = message; $('notice').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('notice').hidden = true; }, 7000); }
function send(msg) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ generation, ...msg })); }
function status(text, online = false) { $('connection').textContent = text; $('dot').classList.toggle('online', online); }
function mask() {
  let n = 0; for (const key of keys) n |= ({ KeyW:1, ArrowUp:1, KeyS:2, ArrowDown:2, KeyA:4, ArrowLeft:4, KeyD:8, ArrowRight:8, Space:16, Enter:16 })[key] || 0;
  return n;
}
function release() { keys.clear(); send({ type: 'input', keys: 0 }); }
function input(code, down) {
  if (!room || room.phase !== 'playing') return;
  down ? keys.add(code) : keys.delete(code); send({ type: 'input', keys: mask() });
}
function connect(code, create = false, token) {
  leaving = false; clearTimeout(reconnectTimer); status('连接房间…');
  if (socket) { socket.onclose = null; socket.close(); }
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/${code}`);
  socket.onopen = () => {
    const name = $('name').value.trim() || '玩家'; localStorage.setItem('bomb-it-name', name);
    send({ type: create ? 'create' : 'join', name, token });
  };
  socket.onmessage = async event => {
    let msg; try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type === 'joined') {
      identity = { code: msg.code, token: msg.token, seat: msg.seat };
      sessionStorage.setItem('bomb-it-room', JSON.stringify(identity));
      history.replaceState(null, '', `?room=${msg.code}`); status('已连接', true);
      $('welcome').hidden = true; $('room').hidden = false; $('room-code').textContent = msg.code;
      $('invite').value = `${location.origin}/?room=${msg.code}`;
    } else if (msg.type === 'room') { room = msg; render(); }
    else if (msg.type === 'prepare') {
      generation = msg.generation; packetQueue = []; preparing = true;
      try {
        await loadGame();
        bridge.start(msg.config); bridge.sound(sound);
        for (let i = 0; i < msg.history.length; i++) {
          bridge.advance(msg.history[i], true);
          if (i % 90 === 0) { $('overlay-detail').textContent = `恢复对局 ${Math.round(i / Math.max(1, msg.history.length) * 100)}%`; await new Promise(r => setTimeout(r, 0)); }
        }
        preparing = false;
        send({ type: 'prepared', tick: bridge.frame, hash: bridge.checksum() });
        for (const frame of packetQueue) bridge.advance(frame); packetQueue = [];
      } catch (error) { preparing = false; notice('游戏加载失败：' + error.message); send({ type: 'fault' }); }
    } else if (msg.type === 'frame' && msg.generation === generation) {
      if (preparing || !bridge) packetQueue.push(msg.frame);
      else try { bridge.advance(msg.frame); } catch (error) { notice(error.message); send({ type: 'fault' }); }
    } else if (msg.type === 'verified') { $('sync').textContent = `状态一致 · ${msg.tick} 帧`; }
    else if (msg.type === 'pong') { pingTime = Math.max(0, Date.now() - msg.time); status(`${pingTime} ms`, true); }
    else if (msg.type === 'error') {
      notice(msg.message);
      if (msg.reset) { sessionStorage.removeItem('bomb-it-room'); identity = null; leaving = true; }
    } else if (msg.type === 'ended') { notice('房间已结束'); leave(false); }
  };
  socket.onclose = () => {
    release();
    if (leaving) { status('准备开玩'); return; }
    status('连接断开');
    if (!leaving && identity) {
      if (room) { room.phase = 'reconnecting'; render(); }
      reconnectTimer = setTimeout(() => connect(identity.code, false, identity.token), 1500);
    } else if (!identity) notice('连接失败，请稍后重试。免费服务器首次启动可能需要约一分钟。');
  };
  socket.onerror = () => status('连接暂不可用');
}
function leave(notify = true) {
  leaving = true; clearTimeout(reconnectTimer); if (notify) send({ type: 'leave' });
  socket?.close(); identity = room = bridge = null; iframe?.remove(); iframe = null;
  sessionStorage.removeItem('bomb-it-room'); history.replaceState(null, '', location.pathname);
  $('welcome').hidden = false; $('room').hidden = true; status('准备开玩');
  document.body.classList.remove('in-game');
}
function loadGame() {
  return new Promise((resolve, reject) => {
    bridge = null; loaded = false; iframe?.remove();
    iframe = document.createElement('iframe'); iframe.title = '原版 Bomb It 1 游戏'; iframe.allow = 'autoplay; fullscreen'; iframe.src = '/game/';
    $('game-mount').replaceChildren(iframe);
    const timeout = setTimeout(() => reject(new Error('原版素材加载超时，请返回房间重试')), 45000);
    onGameReady = () => { clearTimeout(timeout); bridge = iframe.contentWindow.onlineBridge; loaded = true; resolve(); };
  });
}
window.addEventListener('message', e => {
  if (e.origin !== location.origin || e.source !== iframe?.contentWindow || e.data?.source !== 'bomb-it-game') return;
  const msg = e.data;
  if (msg.type === 'ready') onGameReady?.();
  else if (msg.type === 'key') input(msg.code, msg.down);
  else if (msg.type === 'release') release();
  else if (msg.type === 'check') send({ type: 'check', tick: msg.tick, hash: msg.hash });
  else if (msg.type === 'result' && identity?.seat === 0) send({ type: 'result', result: msg.result });
  else if (msg.type === 'pause-request' && identity?.seat === 0) send({ type: 'pause' });
  else if (msg.type === 'error') { notice('原版引擎错误：' + msg.message.split('\n')[0]); send({ type: 'fault' }); }
});
function render() {
  if (!room || !identity) return;
  const host = identity.seat === 0, lobby = room.phase === 'lobby';
  document.body.classList.toggle('in-game', !lobby);
  $('lobby').hidden = !lobby; $('play').hidden = lobby;
  if (lobby && bridge) { iframe?.remove(); iframe = bridge = null; }
  $('coop').classList.toggle('active', room.settings.mode === 'coop');
  $('battle').classList.toggle('active', room.settings.mode === 'battle');
  $('coop').disabled = $('battle').disabled = $('difficulty').disabled = !host;
  $('difficulty').value = room.settings.difficulty;
  $('capacity').textContent = `${room.players.filter(Boolean).length} / ${room.settings.mode === 'coop' ? 2 : 4} 位真人`;
  $('mode-help').textContent = room.settings.mode === 'coop' ? '保留原版闯关、生命和计分规则；最多两位真人。' : '四个角色各自为战，空位由电脑补齐。时间到仍有多人存活则平局。';
  $('players').replaceChildren();
  const cpuCharacters = [0,1,2,3].filter(c => !room.players.some(p => p?.character === c));
  room.players.forEach((p, seat) => {
    const slot = document.createElement('div'); slot.className = 'player-slot' + (p ? ' occupied' : '') + (seat === identity.seat ? ' mine' : '');
    const head = document.createElement('div'); head.className = 'head head' + (p?.character ?? cpuCharacters.shift()); slot.append(head);
    const name = document.createElement('div'); name.className = 'player-name'; name.textContent = p ? `${p.name}${seat === identity.seat ? ' · 你' : ''}` : '电脑'; slot.append(name);
    const state = document.createElement('div'); state.className = 'player-state' + (p?.ready ? ' ready' : ''); state.textContent = !p ? '空位自动补齐' : !p.online ? '离线 · 等待重连' : p.ready ? '✓ 已准备' : seat === 0 ? '房主 · 未准备' : '等待准备'; slot.append(state);
    if (host && p && seat > 0) { const kick = document.createElement('button'); kick.className = 'kick'; kick.textContent = '×'; kick.title = '移出 ' + p.name; kick.onclick = () => send({ type: 'kick', seat }); slot.append(kick); }
    $('players').append(slot);
  });
  $('characters').replaceChildren();
  colors.forEach((color, character) => {
    const button = document.createElement('button'); button.style.background = color; button.title = colorNames[character] + '机器人'; button.setAttribute('aria-label', button.title);
    const mine = room.players[identity.seat]?.character === character; button.classList.toggle('selected', mine); button.setAttribute('aria-pressed', mine);
    button.disabled = room.players.some(p => p && p.seat !== identity.seat && p.character === character);
    button.onclick = () => send({ type: 'character', character }); $('characters').append(button);
  });
  $('ready').textContent = room.players[identity.seat]?.ready ? '取消准备' : '我准备好了';
  $('start').hidden = !host; $('start').disabled = room.players.filter(Boolean).some(p => !p.ready || !p.online);
  $('ready-help').textContent = host ? '大家准备好后就能开局，空位由电脑补齐。' : '准备好后，等待房主开始游戏。';
  $('pause').hidden = $('back').hidden = !host; $('pause').disabled = !['playing','paused'].includes(room.phase);
  $('pause').textContent = room.phase === 'paused' ? '继续游戏' : '暂停';
  $('overlay').hidden = room.phase === 'playing'; $('continue').hidden = true;
  const me = room.players[identity.seat];
  $('game-status').textContent = `${room.settings.mode === 'coop' ? '原版闯关' : '四人混战'} · 你是${colorNames[me?.character ?? 0]}机器人`;
  const messages = { loading: ['一起出发','正在加载原版游戏','所有玩家加载完成后会一起开始。'], reconnecting: ['连接恢复中','等待玩家重新连接','对局已暂停，重连后自动恢复。'], paused: ['休息一下','游戏已暂停','房主点击“继续游戏”后一起继续。'], desync: ['同步已停止','检测到状态不一致','请房主返回房间重新开局。'], fault: ['暂时无法继续','游戏运行出错','请房主返回房间重新开局。'] };
  let message = messages[room.phase];
  if (room.phase === 'result' && room.result) {
    const result = room.result;
    if (room.settings.mode === 'battle') {
      const winner = room.players.find(p => p?.character === result.winner);
      message = ['本局结束', result.winner === null ? '平局！' : `${winner?.name || colorNames[result.winner] + '电脑'} 获胜`, '房主返回房间，就可以再来一局。'];
    } else {
      message = ['原版关卡结算', result.win ? '闯关成功！' : '再接再厉', result.canContinue ? '原版生命和积分已保留，房主可以继续。' : '本轮闯关结束，返回房间可以重新开始。'];
      $('continue').hidden = !host || !result.canContinue;
      $('continue').textContent = result.win ? '继续下一关 →' : '重试本关 →';
    }
  }
  if (message) { $('overlay-label').textContent = message[0]; $('overlay-title').textContent = message[1]; $('overlay-detail').textContent = message[2]; }
}
$('create').onclick = () => {
  const code = Array.from(crypto.getRandomValues(new Uint8Array(5)), n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
  connect(code, true);
};
$('join-form').onsubmit = e => { e.preventDefault(); const code = $('code').value.trim().toUpperCase(); if (!/^[A-F0-9]{10}$/.test(code)) return notice('请输入邀请链接里的 10 位房间码'); connect(code); };
$('leave').onclick = () => leave();
$('copy').onclick = async () => { try { await navigator.clipboard.writeText($('invite').value); notice('邀请链接已复制'); } catch { $('invite').select(); notice('请复制上方邀请链接'); } };
$('coop').onclick = () => send({ type: 'settings', mode: 'coop', difficulty: Number($('difficulty').value) });
$('battle').onclick = () => send({ type: 'settings', mode: 'battle', difficulty: Number($('difficulty').value) });
$('difficulty').onchange = () => send({ type: 'settings', mode: room.settings.mode, difficulty: Number($('difficulty').value) });
$('ready').onclick = () => send({ type: 'ready', ready: !room.players[identity.seat]?.ready });
$('start').onclick = () => send({ type: 'start' });
$('pause').onclick = () => { release(); send({ type: 'pause' }); };
$('back').onclick = () => { release(); send({ type: 'lobby' }); };
$('continue').onclick = () => { release(); send({ type: 'continue' }); };
$('sound').onclick = () => { sound = !sound; bridge?.sound(sound); $('sound').textContent = sound ? '关闭声音' : '开启声音'; };
$('fullscreen').onclick = () => $('stage').requestFullscreen?.().catch(() => notice('当前浏览器不支持全屏'));
for (const type of ['keydown','keyup']) window.addEventListener(type, e => {
  if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName) || !room || $('play').hidden) return;
  if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','Enter'].includes(e.code)) { e.preventDefault(); if (!e.repeat) input(e.code, type === 'keydown'); }
});
window.addEventListener('blur', release); document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
for (const button of document.querySelectorAll('[data-key]')) {
  button.onpointerdown = e => { e.preventDefault(); button.setPointerCapture(e.pointerId); input(button.dataset.key, true); };
  button.onpointerup = button.onpointercancel = () => input(button.dataset.key, false);
}
setInterval(() => { if (room?.phase === 'playing') send({ type: 'input', keys: mask() }); }, 500);
setInterval(() => { if (socket?.readyState === WebSocket.OPEN) send({ type: 'ping', time: Date.now() }); }, 3000);
if (stored && (!invitation || invitation.toUpperCase() === stored.code)) { identity = stored; connect(stored.code, false, stored.token); }
