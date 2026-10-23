const $ = id => document.getElementById(id);
const inputCodes = ['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','Enter'];
const directions = { KeyW:1, ArrowUp:1, KeyS:2, ArrowDown:2, KeyA:4, ArrowLeft:4, KeyD:8, ArrowRight:8 };
let socket, identity = null, room = null, generation = '', bridge = null, iframe;
let leaving = false, reconnectTimer, toastTimer, preparing = false, packetQueue = [];
let loadId = 0, prepareId = 0, onGameReady, loadPromise, queuedSettings, selectingDifficulty = false;
const keys = new Set();
let activeDirection = null;
// Keep reconnect credentials only for this page's lifetime. A refresh starts over.
try { sessionStorage.removeItem('bomb-it-room'); } catch {}
const pageURL = new URL(location.href);
const refreshed = performance.getEntriesByType('navigation')[0]?.type === 'reload';
const invitation = refreshed ? null : pageURL.searchParams.get('room');
if (pageURL.searchParams.has('room')) {
  pageURL.searchParams.delete('room');
  history.replaceState(null, '', pageURL.pathname + pageURL.search + pageURL.hash);
}
if (invitation) { $('code').value = invitation.toUpperCase(); $('network').hidden = false; $('network').open = true; }
function notice(message) { $('notice').textContent = message; $('notice').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('notice').hidden = true; }, 6000); }
function send(msg) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ generation, ...msg })); }
function status(text) { $('connection').textContent = text; }
function mask() { return (directions[activeDirection] || 0) | (keys.has('Space') || keys.has('Enter') ? 16 : 0); }
function release() { keys.clear(); activeDirection = null; send({ type: 'input', keys: 0 }); }
function input(code, down) {
  // Always process key-up, including while paused or disconnected.
  if (down === keys.has(code)) return;
  down ? keys.add(code) : keys.delete(code);
  // Like the native keyboard: the latest direction wins; releasing it stops.
  // Keep older held keys tracked so their autorepeat cannot steal the turn back.
  if (directions[code]) {
    if (down) activeDirection = code;
    else if (activeDirection === code) activeDirection = null;
  }
  if (room?.phase === 'playing' && !preparing) send({ type: 'input', keys: mask() });
}
function loadGame() {
  const id = ++loadId;
  bridge = null; iframe?.remove();
  iframe = document.createElement('iframe'); iframe.title = 'Bomb It 1'; iframe.allow = 'autoplay; fullscreen'; iframe.src = '/game/?v=6';
  $('game-mount').replaceChildren(iframe); $('loading').hidden = false;
  loadPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { if (id === loadId) reject(new Error('原版素材加载超时，请刷新页面')); }, 45000);
    onGameReady = () => { clearTimeout(timeout); if (id !== loadId) return; bridge = iframe.contentWindow.onlineBridge; $('loading').hidden = true; resolve(bridge); };
  });
  return loadPromise;
}
async function prepare(msg) {
  const id = ++prepareId; generation = msg.generation; packetQueue = []; preparing = true; release();
  try {
    const game = await loadGame(); if (id !== prepareId) return;
    game.start(msg.config, identity.seat);
    for (let i = 0; i < msg.history.length; i++) {
      game.advance(msg.history[i], true);
      if (i % 240 === 0) { $('loading').hidden = false; $('loading').textContent = `恢复对局 ${Math.round(i / Math.max(1, msg.history.length) * 100)}%`; await new Promise(r => setTimeout(r, 0)); if (id !== prepareId) return; }
    }
    while (packetQueue.length) {
      const batch = packetQueue.splice(0);
      for (const frame of batch) game.advance(frame, true);
      if (batch.length > 240) { await new Promise(r => setTimeout(r, 0)); if (id !== prepareId) return; }
    }
    preparing = false; $('loading').hidden = true;
    send({ type: 'prepared', tick: game.frame, hash: game.checksum() });
    // A peer can reach a result while this browser is catching up.
    if (game.result && room?.phase === 'playing') send({ type: 'result', result: game.result });
    render();
  } catch (error) { if (id !== prepareId) return; preparing = false; notice('游戏加载失败：' + error.message); send({ type: 'fault' }); }
}
function connect(code, create = false, token) {
  leaving = false; clearTimeout(reconnectTimer); status('连接中…');
  if (socket) { socket.onclose = null; socket.close(); }
  const ws = socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/${code}`);
  ws.onopen = () => send({ type: create ? 'create' : 'join', token });
  ws.onmessage = event => {
    if (socket !== ws) return;
    let msg; try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type === 'joined') {
      identity = { code: msg.code, token: msg.token, seat: msg.seat };
      status('已连接');
      $('network').hidden = false;
      $('invite').value = `${location.origin}/?room=${msg.code}`;
      if (create) notice('选好角色后准备；右上角“联机”可复制邀请链接');
      if (queuedSettings) { send({ type: 'settings', ...queuedSettings }); queuedSettings = null; }
    } else if (msg.type === 'room') {
      const previous = room; room = msg;
      if (previous && room.phase !== previous.phase) release();
      if (previous) for (const p of room.players.filter(Boolean)) {
        const old = previous.players[p.seat];
        if (old?.online && !p.online) notice(`${p.name} 掉线了，角色停止操作`);
        if (old && !old.online && p.online) notice(`${p.name} 已重新连接`);
      }
      render();
      const reporter = room.players.find(p => p?.online && p.prepared);
      const priorReporter = previous?.players.find(p => p?.online && p.prepared);
      if (room.phase === 'playing' && previous?.phase === 'playing' && priorReporter?.seat !== reporter?.seat && !preparing && bridge?.result && reporter?.seat === identity.seat) send({ type: 'result', result: bridge.result });
      if (room.phase === 'lobby' && !selectingDifficulty) {
        if (previous && previous.phase !== 'lobby') { ++prepareId; preparing = false; loadGame().then(() => { if (room?.phase === 'lobby') bridge.showLobby(room, identity); }).catch(e => notice(e.message)); }
        else loadPromise.then(() => { if (room?.phase === 'lobby' && !selectingDifficulty) bridge?.showLobby(room, identity); });
      }
    } else if (msg.type === 'prepare') prepare(msg);
    else if (msg.type === 'frame' && msg.generation === generation) {
      if (preparing || !bridge) packetQueue.push(msg.frame);
      else try { bridge.advance(msg.frame); } catch (error) { notice(error.message); send({ type: 'fault' }); }
    } else if (msg.type === 'verified') $('sync').textContent = `状态一致 · ${msg.tick} 帧`;
    else if (msg.type === 'pong') { if (room?.phase !== 'paused') { const offline = room?.players.filter(p => p && !p.online).map(p => `${p.seat + 1}P 掉线`) || []; status([...offline, `${Math.max(0, Date.now() - msg.time)} ms`].join(' · ')); } }
    else if (msg.type === 'error') {
      notice(msg.message);
      if (msg.reset) { leave(false); $('network').hidden = false; $('network').open = true; }
    } else if (msg.type === 'ended') { notice('房间已结束'); leave(false); }
  };
  ws.onclose = () => {
    if (socket !== ws) return; release();
    if (leaving) return;
    status('掉线 · 重连中');
    if (identity) reconnectTimer = setTimeout(() => connect(identity.code, false, identity.token), 1200);
    else notice('连接失败，请稍后重试');
  };
  ws.onerror = () => status('连接暂不可用');
}
function leave(notify = true) {
  leaving = true; clearTimeout(reconnectTimer); release(); if (notify) send({ type: 'leave' });
  socket?.close(); socket = null; identity = room = null; generation = ''; ++prepareId; preparing = false; selectingDifficulty = false;
  $('network').hidden = true; $('room-info').hidden = true; $('touch').hidden = true; status('准备开玩'); loadGame().catch(e => notice(e.message));
}
function render() {
  if (!room || !identity) return;
  bridge?.updateRoster?.(room);
  const host = identity.seat === 0;
  $('room-info').hidden = false; $('room-label').textContent = `房间 ${identity.code} · ${room.players.filter(Boolean).length}/4`;
  $('roster').textContent = room.players.filter(Boolean).map(p => `${p.name}${p.seat === identity.seat ? '（你）' : ''} · ${!p.online ? '掉线' : room.phase === 'lobby' ? (p.ready ? '已准备' : '选人中') : '在线'}`).join('\n');
  $('back').hidden = $('difficulty-settings').hidden = !host; $('difficulty-settings').disabled = room.phase !== 'lobby';
  $('resume').hidden = !(host && room.phase === 'paused');
  $('touch').hidden = room.phase !== 'playing';
  if (room.phase === 'loading' || preparing) status('加载中…');
  if (room.phase === 'paused') { status('已暂停'); $('network').open = true; }
  if (room.phase === 'playing') $('network').open = false;
  if (['fault','desync'].includes(room.phase)) { status('请重新选人'); $('network').open = true; }
  const offline = room.players.filter(p => p && !p.online).map(p => `${p.seat + 1}P 掉线`);
  if (offline.length) status(offline.join(' · '));
}
function confirmSelection() {
  if (!room || room.phase !== 'lobby') return;
  const me = room.players[identity.seat];
  if (identity.seat === 0 && me.ready && room.players.filter(Boolean).every(p => p.ready && p.online)) send({ type: 'start' });
  else send({ type: 'ready', ready: !me.ready });
}
window.addEventListener('message', e => {
  if (e.origin !== location.origin || e.source !== iframe?.contentWindow || e.data?.source !== 'bomb-it-game') return;
  const msg = e.data;
  if (msg.type === 'ready') onGameReady?.();
  else if (msg.type === 'multiplayer-request') { $('network').hidden = false; $('network').open = false; }
  else if (msg.type === 'single-request') {
    release(); $('network').hidden = true;
    if (room || identity) { leave(); loadPromise.then(() => { bridge.startSingle(msg.difficulty); iframe.focus(); }).catch(e => notice(e.message)); }
    else { bridge.startSingle(msg.difficulty); iframe.focus(); }
  }
  else if (msg.type === 'settings-request') {
    selectingDifficulty = false;
    if (room && identity?.seat === 0) send({ type: 'settings', difficulty: msg.difficulty });
    else if (!room) { queuedSettings = { difficulty: msg.difficulty }; const code = Array.from(crypto.getRandomValues(new Uint8Array(5)), n => n.toString(16).padStart(2,'0')).join('').toUpperCase(); connect(code, true); }
    else notice('难度由房主选择');
  } else if (msg.type === 'character-request') send({ type: 'character', character: msg.character });
  else if (msg.type === 'confirm-request') confirmSelection();
  else if (msg.type === 'continue-request') { if (identity?.seat === 0) send({ type: 'continue' }); else notice('等待房主开始下一局'); }
  else if (msg.type === 'lobby-request') { if (identity?.seat === 0) send({ type: 'lobby' }); else notice('等待房主返回选人'); }
  else if (msg.type === 'key') input(msg.code, msg.down);
  else if (msg.type === 'release') release();
  else if (msg.type === 'check') send({ type: 'check', tick: msg.tick, hash: msg.hash });
  else if (msg.type === 'result') send({ type: 'result', result: msg.result });
  else if (msg.type === 'pause-request') { if (identity?.seat === 0) { release(); send({ type: 'pause' }); } else notice('暂停由房主控制'); }
  else if (msg.type === 'error') { notice('游戏错误：' + msg.message.split('\n')[0]); send({ type: 'fault' }); }
});
$('join-form').onsubmit = e => { e.preventDefault(); const code = $('code').value.trim().toUpperCase(); if (!/^[A-F0-9]{10}$/.test(code)) return notice('请输入 10 位房间码'); if (identity) return notice('请先离开当前房间'); connect(code); };
$('leave').onclick = () => leave();
$('copy').onclick = async () => { try { await navigator.clipboard.writeText($('invite').value); notice('邀请链接已复制'); } catch { $('invite').select(); notice('请复制邀请链接'); } };
$('back').onclick = () => { release(); send({ type: 'lobby' }); };
$('difficulty-settings').onclick = () => { selectingDifficulty = true; bridge?.showMainMenu(); $('network').open = false; };
$('resume').onclick = () => send({ type: 'pause' });
$('fullscreen').onclick = () => document.documentElement.requestFullscreen?.().catch(() => notice('当前浏览器不支持全屏'));
for (const type of ['keydown','keyup']) window.addEventListener(type, e => {
  if (type === 'keyup' && keys.has(e.code)) input(e.code, false);
  if (['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.target.tagName) || !inputCodes.includes(e.code)) return;
  if (bridge?.menuKey?.(e.code, type === 'keydown', e.repeat)) { e.preventDefault(); return; }
  if (bridge?.result && ['Space','Enter'].includes(e.code)) { e.preventDefault(); if (type === 'keyup' && identity?.seat === 0) send({ type: bridge.result.canContinue ? 'continue' : 'lobby' }); return; }
  if (room) { e.preventDefault(); if (!e.repeat) input(e.code, type === 'keydown'); }
});
$('network').addEventListener('focusin', release);
window.addEventListener('blur', release); document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
for (const button of document.querySelectorAll('[data-key]')) { button.onpointerdown = e => { e.preventDefault(); button.setPointerCapture(e.pointerId); input(button.dataset.key, true); }; button.onpointerup = button.onpointercancel = () => input(button.dataset.key, false); }
setInterval(() => { if (room?.phase === 'playing' && !preparing) send({ type: 'input', keys: mask() }); }, 500);
setInterval(() => { if (socket?.readyState === WebSocket.OPEN) send({ type: 'ping', time: Date.now() }); }, 3000);
loadGame().catch(e => notice(e.message));
if (invitation && /^[A-F0-9]{10}$/i.test(invitation)) connect(invitation.toUpperCase());
