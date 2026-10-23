import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FPS, Room } from '../shared/room.js';
const socket = () => ({ readyState: 1, messages: [], send(text) { this.messages.push(JSON.parse(text)); }, close(code, reason) { this.closed = { code, reason }; this.readyState = 3; } });
function setup(count = 4, options = {}) {
  let now = 0; const room = new Room('0123456789', { manual: true, now: () => now, ...options }); const clients = Array.from({ length: count }, socket);
  room.receive(clients[0], { type: 'create', name: 'Host' });
  room.receive(clients[0], { type: 'settings', difficulty: 1 });
  for (const client of clients.slice(1)) room.receive(client, { type: 'join', name: 'Friend' });
  const act = (seat, msg) => room.receive(clients[seat], { generation: room.generation, ...msg });
  const start = () => { for (let i = 0; i < count; i++) act(i, { type: 'ready', ready: true }); act(0, { type: 'start' }); for (let i = 0; i < count; i++) act(i, { type: 'prepared', tick: 0, hash: 'same' }); };
  return { room, clients, act, start, setTime(t) { now = t; } };
}
test('1–4 humans start with automatic player names and one ruleset', () => {
  for (let count = 1; count <= 4; count++) {
    const { room, start } = setup(count); start();
    assert.equal(room.phase, 'playing'); assert.equal(room.config.players.length, count);
    assert.deepEqual(room.settings, { difficulty: 1 }); assert.equal(Object.hasOwn(room.config, 'mode'), false);
    assert.deepEqual(room.config.players.map(p => p.name), Array.from({ length: count }, (_, i) => `P${i + 1}`));
    assert.deepEqual(room.roster().players.filter(Boolean).map(p => p.name), room.config.players.map(p => p.name));
    assert.equal(room.config.tickRate, 60); assert.equal(room.config.round, 1); assert.deepEqual(room.config.scores, [0, 0, 0, 0]);
    assert.equal(new Set(room.config.players.map(p => p.character)).size, count); room.step(); assert.equal(room.frames[0][1].length, 4);
  }
});
test('rooms cap humans at four with no seat stealing', () => {
  const { room, clients } = setup(4); const fifth = socket(); room.receive(fifth, { type: 'join' }); assert.equal(fifth.messages.at(-1).type, 'error');
  const token = clients[0].messages.find(m => m.type === 'joined').token; room.receive(fifth, { type: 'join', token }); assert.equal(fifth.messages.at(-1).type, 'error');
});
test('settings only change difficulty; legacy modes and client names never replace seats or P1–P4', () => {
  const { room, clients, act } = setup(4);
  const tokens = room.players.map(p => p.token), names = ['P1', 'P2', 'P3', 'P4'];
  assert.deepEqual(room.players.map(p => p.name), names);
  for (const [mode, difficulty] of [['coop', 0], ['battle', 2]]) {
    act(0, { type: 'settings', mode, difficulty, name: 'Replace everyone' });
    assert.deepEqual(room.settings, { difficulty }); assert.deepEqual(room.players.map(p => p.token), tokens); assert.deepEqual(room.roster().players.map(p => p.name), names);
  }
  room.disconnect(clients[2]); const reconnect = socket(); room.receive(reconnect, { type: 'join', token: tokens[2], name: 'New custom name' });
  assert.equal(room.players[2].name, 'P3'); assert.deepEqual(room.roster().players.map(p => p.name), names);
});
test('only host may start, alter settings or pause; all players must be ready', () => {
  const { room, act, start } = setup(); act(1, { type: 'start' }); assert.equal(room.phase, 'lobby'); act(0, { type: 'start' }); assert.equal(room.phase, 'lobby');
  act(1, { type: 'settings', difficulty: 2 }); assert.deepEqual(room.settings, { difficulty: 1 }); start(); act(1, { type: 'pause' }); assert.equal(room.phase, 'playing');
});
test('input is tied to authenticated seat, invalid masks rejected and short taps retained', () => {
  const { room, act, start, setTime } = setup(); start();
  act(2, { type: 'input', seat: 0, keys: 8 }); act(0, { type: 'input', keys: 1024 });
  act(1, { type: 'input', keys: 16 }); act(1, { type: 'input', keys: 0 }); room.step(); assert.deepEqual(room.frames[0][1], [0,16,8,0]);
  room.step(); assert.deepEqual(room.frames[1][1], [0,0,8,0]); setTime(2000); room.step(); assert.deepEqual(room.frames[2][1], [0,0,0,0]);
});
test('disconnect leaves the match running with zero input; replay catches up behind live frames', () => {
  const { room, clients, act, start } = setup(); start(); act(2, { type: 'input', keys: 24 }); room.step();
  const token = clients[2].messages.find(m => m.type === 'joined').token, epoch = room.timerEpoch;
  room.disconnect(clients[2]); assert.equal(room.phase, 'playing'); assert.equal(room.running, true); assert.equal(room.timerEpoch, epoch);
  assert.equal(room.players[2].keys, 0); assert.equal(room.players[2].pulse, false); assert.equal(room.roster().players[2].online, false);
  act(0, { type: 'input', keys: 8 }); room.step(); assert.deepEqual(room.frames.at(-1)[1], [8, 0, 0, 0]);
  const reconnect = socket(); room.receive(reconnect, { type: 'join', token });
  const preparation = reconnect.messages.find(m => m.type === 'prepare');
  assert.deepEqual(preparation.history, room.frames); assert.equal(preparation.tick, room.tick); assert.equal(room.roster().players[2].prepared, false);
  room.receive(reconnect, { type: 'input', generation: room.generation, keys: 24 }); assert.equal(room.players[2].keys, 0);
  room.step(); assert.ok(reconnect.messages.some(m => m.type === 'frame' && m.frame[0] > preparation.tick));
  room.receive(reconnect, { type: 'prepared', generation: room.generation, tick: -1, hash: 'same' }); assert.equal(room.players[2].prepared, false);
  room.receive(reconnect, { type: 'prepared', generation: room.generation, tick: preparation.tick, hash: 'same' });
  assert.equal(room.phase, 'playing'); assert.equal(room.players[2].ack, preparation.tick); assert.equal(room.timerEpoch, epoch);
  act(2, { type: 'input', keys: 8 }); assert.equal(room.players[2].keys, 0);
  room.receive(reconnect, { type: 'input', generation: room.generation, keys: 8 }); room.step(); assert.equal(room.frames.at(-1)[1][2], 8);
});
test('disconnect and replay preserve an existing pause or result', () => {
  for (const phase of ['paused', 'result']) {
    const { room, clients, act, start } = setup(2); start(); room.step();
    if (phase === 'paused') act(0, { type: 'pause' });
    else act(0, { type: 'result', result: { winner: 0, scores: [20, 10, 0, 0] } });
    const result = room.result, tick = room.tick, epoch = room.timerEpoch;
    const token = clients[1].messages.find(m => m.type === 'joined').token;
    room.disconnect(clients[1]); assert.equal(room.phase, phase);
    const reconnect = socket(); room.receive(reconnect, { type: 'join', token });
    room.receive(reconnect, { type: 'prepared', generation: room.generation, tick, hash: 'same' });
    assert.equal(room.phase, phase); assert.deepEqual(room.result, result); assert.equal(room.running, false); assert.equal(room.timerEpoch, epoch);
    room.step(); assert.equal(room.tick, tick);
  }
});
test('initial loading waits for online replicas but an offline member does not block play', () => {
  const { room, clients, act } = setup(2);
  act(0, { type: 'ready', ready: true }); act(1, { type: 'ready', ready: true }); act(0, { type: 'start' });
  act(0, { type: 'prepared', tick: 0, hash: 'same' }); assert.equal(room.phase, 'loading');
  room.disconnect(clients[1]); assert.equal(room.phase, 'playing');
  room.step(); assert.deepEqual(room.frames[0], [1, [0, 0, 0, 0]]);
});
test('checkpoints wait only for online prepared replicas', () => {
  const { room, clients, act, start } = setup(3); start(); room.step(); room.disconnect(clients[2]);
  act(0, { type: 'check', tick: 1, hash: 'same' }); act(1, { type: 'check', tick: 1, hash: 'same' }); assert.equal(room.verified, 1);
  const token = clients[2].messages.find(m => m.type === 'joined').token;
  const reconnect = socket(); room.receive(reconnect, { type: 'join', token }); room.step();
  room.receive(reconnect, { type: 'check', generation: room.generation, tick: 2, hash: 'stale' });
  act(0, { type: 'check', tick: 2, hash: 'same' }); act(1, { type: 'check', tick: 2, hash: 'same' }); assert.equal(room.verified, 2); assert.equal(room.phase, 'playing');
});
test('five seconds of silence closes a half-open connection without pausing other players', () => {
  const { room, clients, act, start, setTime } = setup(2); start(); act(1, { type: 'input', keys: 24 });
  setTime(5000); act(0, { type: 'ping', time: 5000 }); room.step(); assert.equal(room.players[1].ws, clients[1]);
  setTime(5001); act(0, { type: 'input', keys: 8 }); const before = room.tick; room.step();
  assert.equal(room.players[0].lastSeen, 5001); assert.equal(room.players[1].ws, null); assert.equal(room.players[1].keys, 0); assert.equal(room.players[1].pulse, false);
  assert.deepEqual(clients[1].closed, { code: 1012, reason: 'Reconnect' });
  assert.equal(room.phase, 'playing'); assert.equal(room.running, true); assert.equal(room.tick, before + 1); assert.deepEqual(room.frames.at(-1)[1], [8, 0, 0, 0]);
  assert.equal(clients[0].messages.filter(m => m.type === 'room').at(-1).players[1].online, false);
});
test('ping refreshes application activity, and an unprepared replay is not timed out', () => {
  const { room, clients, act, start, setTime } = setup(2); start(); room.replayPlayer(room.players[1]);
  setTime(6000); act(0, { type: 'ping', time: 6000 }); room.step();
  assert.equal(room.players[0].lastSeen, 6000); assert.equal(room.players[0].ws, clients[0]);
  assert.equal(room.players[1].ws, clients[1]); assert.equal(room.players[1].prepared, false); assert.equal(clients[1].closed, undefined);
  assert.equal(room.phase, 'playing');
});
test('the first online prepared player reports results while the host is offline', () => {
  const { room, clients, act, start } = setup(4); start(); room.disconnect(clients[0]);
  act(2, { type: 'result', result: { winner: 2 } }); assert.equal(room.phase, 'playing');
  act(1, { type: 'result', result: { winner: 1 } }); assert.equal(room.phase, 'result'); assert.equal(room.result.winner, 1);
  act(1, { type: 'continue' }); assert.equal(room.phase, 'result');
  const token = clients[0].messages.find(m => m.type === 'joined').token;
  const reconnect = socket(); room.receive(reconnect, { type: 'join', token });
  room.receive(reconnect, { type: 'prepared', generation: room.generation, tick: room.tick, hash: 'same' });
  room.receive(reconnect, { type: 'continue', generation: room.generation }); assert.equal(room.phase, 'loading'); assert.equal(room.config.round, 2);
});
test('all peers must agree at initialization and ongoing checkpoints', () => {
  const { room, act, start } = setup(); start(); room.step(); act(0,{type:'check',tick:1,hash:'a'});act(1,{type:'check',tick:1,hash:'a'});act(2,{type:'check',tick:1,hash:'b'});act(3,{type:'check',tick:1,hash:'a'});
  assert.equal(room.phase, 'desync'); const tick=room.tick;room.step();assert.equal(room.tick,tick);
});
test('late joins rejected, returning to lobby clears match, host departure ends room', () => {
  const { room, clients, act, start } = setup(2); start(); const late=socket();room.receive(late,{type:'join'});assert.equal(late.messages.at(-1).type,'error');
  act(0,{type:'lobby'});assert.equal(room.phase,'lobby');assert.equal(room.config,null);act(0,{type:'leave'});assert.equal(room.created,false);assert.ok(clients[1].messages.some(m=>m.type==='ended'));
});
test('returning to lobby while the next round loads resets the match', () => {
  const { room, act, start } = setup(2); start();
  act(0, { type: 'result', result: { canContinue: true } });
  act(0, { type: 'continue' }); act(0, { type: 'lobby' });
  start(); room.step(); assert.equal(room.frames[0].length, 2); assert.equal(room.config.round, 1); assert.deepEqual(room.config.scores, [0, 0, 0, 0]);
});
test('every result continues through fresh rounds with the same seats and cumulative scores', () => {
  const { room, clients, act, start } = setup(); start();
  const originalPlayers = room.config.players, tokens = room.players.map(p => p.token);
  for (let round = 1; round <= 5; round++) {
    room.step();
    act(2, { type: 'input', keys: 24 });
    const generation = room.generation, seed = room.config.seed;
    const scores = [round * 100, round * 60, round * 20, round * 10];
    act(0, { type: 'result', result: { winner: round % 4, canContinue: false, scores } });
    assert.equal(room.result.canContinue, true);
    act(1, { type: 'continue' }); assert.equal(room.phase, 'result');
    act(0, { type: 'continue' });
    assert.equal(room.phase, 'loading'); assert.notEqual(room.generation, generation); assert.notEqual(room.config.seed, seed);
    assert.equal(room.tick, 0); assert.deepEqual(room.frames, []); assert.equal(room.verified, 0); assert.equal(room.checks.size, 0);
    assert.equal(room.config.round, round + 1); assert.equal(room.config.tickRate, 60); assert.deepEqual(room.config.scores, scores);
    assert.deepEqual(room.config.players, originalPlayers); assert.deepEqual(room.players.map(p => p.token), tokens);
    assert.ok(room.players.every(p => !p.prepared && p.ack === 0 && p.keys === 0 && !p.pulse));
    for (const client of clients) {
      const preparation = client.messages.filter(m => m.type === 'prepare').at(-1);
      assert.equal(preparation.generation, room.generation); assert.deepEqual(preparation.history, []); assert.deepEqual(preparation.config.scores, scores);
    }
    // A delayed response or input from the previous round must never enter this one.
    act(0, { type: 'prepared', generation, tick: 0, hash: 'old' }); assert.equal(room.players[0].prepared, false);
    for (let seat = 0; seat < 3; seat++) act(seat, { type: 'prepared', tick: 0, hash: 'same-' + round });
    assert.equal(room.phase, 'loading');
    act(3, { type: 'prepared', tick: 0, hash: 'same-' + round }); assert.equal(room.phase, 'playing');
    act(2, { type: 'input', generation, keys: 16 }); room.step(); assert.deepEqual(room.frames[0], [1, [0, 0, 0, 0]]);
  }
});
test('scores always have four finite values and returning to the lobby resets rounds', () => {
  const { room, act, start } = setup(1); start();
  act(0, { type: 'result', result: { scores: [35, '40', 'invalid'] } }); act(0, { type: 'continue' });
  assert.deepEqual(room.config.scores, [35, 40, 0, 0]);
  act(0, { type: 'lobby' }); start(); assert.equal(room.config.round, 1); assert.deepEqual(room.config.scores, [0, 0, 0, 0]);
});

function fakeClock() {
  let now = 0, nextId = 0; const timers = new Map();
  return {
    now: () => now,
    setTimer(callback, delay) { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimer(id) { timers.delete(id); },
    get count() { return timers.size; },
    stall(ms) { now += ms; },
    advance(to) {
      while (timers.size) {
        const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (timer.at > to) break;
        timers.delete(id); now = Math.max(now, timer.at); timer.callback();
      }
      now = to;
    }
  };
}
test('deadline scheduler runs at 60 Hz without integer-interval acceleration', () => {
  const clock = fakeClock();
  const { room, act, start } = setup(1, { ...clock, manual: false }); start();
  clock.advance(1000); assert.ok(room.tick >= 59 && room.tick <= 60, `${room.tick} frames in one second`);
  act(0, { type: 'ping', time: clock.now() });
  clock.advance(3000); act(0, { type: 'ping', time: clock.now() });
  clock.advance(5000); assert.ok(room.tick >= 299 && room.tick <= 300, `${room.tick} frames in five seconds`);
  assert.equal(clock.count, 1); room.stop(); assert.equal(clock.count, 0);
});
test('a late clock callback preserves game-frame order without a catch-up burst', () => {
  const clock = fakeClock();
  const { room, act, start } = setup(1, { ...clock, manual: false }); start();
  clock.advance(100); const before = room.tick;
  clock.stall(500); clock.advance(600); assert.equal(room.tick, before + 1);
  clock.advance(700); assert.ok(room.tick >= before + 6 && room.tick <= before + 7);
  assert.deepEqual(room.frames.map(f => f[0]), Array.from({ length: room.tick }, (_, i) => i + 1));
  act(0, { type: 'pause' }); assert.equal(clock.count, 0); const paused = room.tick;
  clock.advance(5000); assert.equal(room.tick, paused);
  act(0, { type: 'pause' }); clock.advance(5100); assert.ok(room.tick >= paused + 5 && room.tick <= paused + 6); room.stop();
});
test('six-second lag replays only the slow replica while other players keep moving', () => {
  const { room, clients, act, start } = setup(2); start();
  room.tick = FPS * 6; room.players[0].ack = room.tick; room.step(); assert.equal(room.players[1].prepared, true);
  act(0, { type: 'input', keys: 8 }); act(1, { type: 'input', keys: 24 });
  room.step(); assert.equal(room.phase, 'playing'); assert.equal(room.players[0].prepared, true); assert.equal(room.players[1].prepared, false);
  assert.deepEqual(room.frames.at(-1)[1], [8, 0, 0, 0]);
  const preparations = clients[1].messages.filter(m => m.type === 'prepare'); assert.equal(preparations.length, 2);
  assert.equal(clients[0].messages.filter(m => m.type === 'prepare').length, 1);
  for (let i = 0; i < 5; i++) room.step();
  assert.equal(clients[1].messages.filter(m => m.type === 'prepare').length, 2);
  act(1, { type: 'input', keys: 8 }); assert.equal(room.players[1].keys, 0);
  act(0, { type: 'check', tick: room.tick, hash: 'same' }); assert.equal(room.verified, room.tick);
  act(1, { type: 'prepared', tick: preparations.at(-1).tick, hash: 'same' }); assert.equal(room.players[1].prepared, true);
  act(1, { type: 'input', keys: 8 }); room.step(); assert.equal(room.frames.at(-1)[1][1], 8);
});
test('all-offline rooms stop their clock and the first prepared return resumes it once', () => {
  const clock = fakeClock();
  const { room, clients, act, start } = setup(2, { ...clock, manual: false }); start();
  act(0, { type: 'input', keys: 8 }); clock.advance(100); const tick = room.tick;
  const token = clients[0].messages.find(m => m.type === 'joined').token;
  room.disconnect(clients[0]); assert.equal(clock.count, 1); room.disconnect(clients[1]);
  assert.equal(room.phase, 'playing'); assert.equal(room.running, false); assert.equal(clock.count, 0);
  clock.advance(1000); assert.equal(room.tick, tick);
  const reconnect = socket(); room.receive(reconnect, { type: 'join', token });
  assert.equal(room.phase, 'playing'); assert.equal(room.running, false); assert.equal(clock.count, 0);
  room.receive(reconnect, { type: 'input', generation: room.generation, keys: 24 }); assert.equal(room.players[0].keys, 0);
  room.receive(reconnect, { type: 'prepared', generation: room.generation, tick, hash: 'same' });
  assert.equal(room.running, true); assert.equal(clock.count, 1); const epoch = room.timerEpoch;
  room.receive(reconnect, { type: 'prepared', generation: room.generation, tick, hash: 'same' }); assert.equal(room.timerEpoch, epoch);
  clock.advance(1100); assert.ok(room.tick >= tick + 5 && room.tick <= tick + 6); assert.ok(room.frames.slice(tick).every(frame => frame[1].every(mask => mask === 0)));
  room.stop();
});
test('60 Hz preserves the twenty-minute history limit', () => {
  const history = setup(1); history.start(); history.room.tick = FPS * 60 * 20 - 1; history.room.players[0].ack = history.room.tick;
  history.room.step(); assert.equal(history.room.phase, 'playing'); history.room.step(); assert.equal(history.room.phase, 'fault');
});
