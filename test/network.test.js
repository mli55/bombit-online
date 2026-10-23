import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';
import { FPS } from '../shared/room.js';

// Set TEST_BASE_URL to exercise the identical protocol against the Worker.
test('HTTP assets and four real WebSockets: 60 Hz input, repeated rounds and uninterrupted reconnect', { timeout: 25000 }, async t => {
  let base = process.env.TEST_BASE_URL;
  if (!base) {
    const app = createApp();
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${app.server.address().port}`;
    t.after(() => app.close());
  }
  assert.deepEqual(await (await fetch(base + '/health')).json(), { ok: true });
  for (const [path, type] of [['/', 'text/html'], ['/game/', 'text/html'], ['/game/bombit-1.min.js', 'javascript'], ['/adapter.js', 'javascript']]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get('content-type').includes(type), path);
  }
  const code = randomBytes(5).toString('hex').toUpperCase();
  const clients = [];
  async function connect() {
    const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws/' + code, { origin: base });
    const messages = []; let generation = '';
    ws.on('message', raw => {
      const m = JSON.parse(raw); m.receivedAt = performance.now(); messages.push(m);
      if (m.type === 'prepare') generation = m.generation;
      if (m.type === 'frame' && m.frame[0] % FPS === 0) send({ type: 'check', tick: m.frame[0], hash: 'test-replica' });
    });
    const send = data => ws.send(JSON.stringify({ generation, ...data }));
    const wait = async predicate => {
      const limit = Date.now() + 5000;
      while (Date.now() < limit) {
        const found = messages.find(predicate); if (found) return found;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw Error('Timed out; messages: ' + JSON.stringify(messages.slice(-4)));
    };
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const client = { ws, messages, send, wait }; clients.push(client); return client;
  }
  t.after(() => clients.forEach(c => c.ws.terminate()));
  const host = await connect(); host.send({ type: 'create', name: 'Network QA' });
  await host.wait(m => m.type === 'joined');
  host.send({ type: 'settings', difficulty: 2 });
  await host.wait(m => m.type === 'room' && m.settings.difficulty === 2);
  for (let i = 1; i < 4; i++) { const c = await connect(); c.send({ type: 'join', name: 'QA ' + i }); await c.wait(m => m.type === 'joined'); }
  const fullRoom = await host.wait(m => m.type === 'room' && m.players.every(Boolean));
  assert.deepEqual(fullRoom.players.map(p => p.name), ['P1', 'P2', 'P3', 'P4']);
  host.send({ type: 'settings', difficulty: 1, name: 'Ignored custom name' });
  const configuredRoom = await host.wait(m => m.type === 'room' && m.settings.difficulty === 1 && m.players.every(Boolean) && m.receivedAt > fullRoom.receivedAt);
  assert.deepEqual(configuredRoom.settings, { difficulty: 1 });
  assert.deepEqual(configuredRoom.players.map(p => p.name), ['P1', 'P2', 'P3', 'P4']);
  clients.forEach(c => c.send({ type: 'ready', ready: true }));
  await host.wait(m => m.type === 'room' && m.players.every(p => p?.ready));
  host.send({ type: 'start' });
  for (const c of clients) {
    const p = await c.wait(m => m.type === 'prepare'); assert.equal(p.config.players.length, 4);
    assert.equal(Object.hasOwn(p.config, 'mode'), false); assert.equal(p.config.difficulty, 1);
    assert.deepEqual(p.config.players.map(player => player.name), ['P1', 'P2', 'P3', 'P4']);
    assert.equal(p.config.tickRate, 60); assert.equal(p.config.round, 1); assert.deepEqual(p.config.scores, [0, 0, 0, 0]);
    c.send({ type: 'prepared', tick: 0, hash: 'test-replica' });
  }
  await host.wait(m => m.type === 'room' && m.phase === 'playing');
  const first = await host.wait(m => m.type === 'frame' && m.frame[0] === 1);
  const later = await host.wait(m => m.type === 'frame' && m.generation === first.generation && m.frame[0] === FPS + 1);
  const elapsed = later.receivedAt - first.receivedAt;
  assert.ok(elapsed >= 800 && elapsed <= 1500, `${FPS} frames took ${Math.round(elapsed)} ms (expected about 1000 ms)`);
  t.diagnostic(`${FPS} live network frames: ${Math.round(elapsed)} ms`);
  clients[2].send({ type: 'input', keys: 24 });
  const input = await host.wait(m => m.type === 'frame' && m.frame[1][2] === 24);
  for (const c of clients) assert.deepEqual((await c.wait(m => m.type === 'frame' && m.frame[0] === input.frame[0])).frame, input.frame);
  const token = clients[2].messages.find(m => m.type === 'joined').token;
  clients[2].ws.close();
  const offline = await host.wait(m => m.type === 'room' && m.players[2]?.online === false);
  assert.equal(offline.phase, 'playing');
  host.send({ type: 'input', keys: 8 });
  const uninterrupted = await host.wait(m => m.type === 'frame' && m.frame[0] >= offline.tick + FPS / 2);
  assert.equal(uninterrupted.frame[1][0], 8); assert.equal(uninterrupted.frame[1][2], 0);
  const resumed = await connect(); resumed.send({ type: 'join', token, name: 'Renamed on reconnect' });
  const replay = await resumed.wait(m => m.type === 'prepare');
  assert.ok(replay.history.some(f => f[0] === input.frame[0] && f[1][2] === 24));
  assert.equal(replay.config.players[2].name, 'P3');
  assert.equal(replay.tick, replay.history.at(-1)[0]);
  resumed.send({ type: 'input', keys: 24 });
  const duringReplay = await resumed.wait(m => m.type === 'frame' && m.frame[0] >= replay.tick + 3);
  assert.equal(duringReplay.frame[1][2], 0);
  assert.deepEqual((await host.wait(m => m.type === 'frame' && m.frame[0] === duringReplay.frame[0])).frame, duringReplay.frame);
  resumed.send({ type: 'prepared', tick: replay.tick, hash: 'test-replica' });
  await host.wait(m => m.type === 'room' && m.tick >= duringReplay.frame[0] && m.players[2]?.prepared === true);
  resumed.send({ type: 'input', keys: 8 });
  await host.wait(m => m.type === 'frame' && m.frame[0] > duringReplay.frame[0] && m.frame[1][2] === 8);
  assert.ok(!host.messages.some(m => m.type === 'room' && ['paused', 'reconnecting'].includes(m.phase)));
  const active = [host, clients[1], resumed, clients[3]];
  let previousGeneration = replay.generation;
  for (let round = 2; round <= 4; round++) {
    const scores = [round * 100, round * 50, round * 25, round * 10];
    host.send({ type: 'result', result: { winner: round % 4, canContinue: false, level: round - 1, scores } });
    const result = await host.wait(m => m.type === 'room' && m.phase === 'result' && m.result.level === round - 1);
    assert.equal(result.result.canContinue, true);
    host.send({ type: 'continue' });
    const preparations = await Promise.all(active.map(c => c.wait(m => m.type === 'prepare' && m.config.round === round)));
    const generation = preparations[0].generation;
    assert.notEqual(generation, previousGeneration);
    preparations.forEach((p, i) => {
      assert.equal(p.generation, generation); assert.deepEqual(p.history, []); assert.deepEqual(p.config.scores, scores);
      assert.equal(p.config.players.length, 4); assert.equal(p.config.tickRate, FPS);
      active[i].send({ type: 'prepared', tick: 0, hash: 'test-replica' });
    });
    for (const c of active) {
      const firstFrame = await c.wait(m => m.type === 'frame' && m.generation === generation && m.frame[0] === 1);
      assert.deepEqual(firstFrame.frame, [1, [0, 0, 0, 0]]);
    }
    previousGeneration = generation;
  }
  host.send({ type: 'pause' }); await host.wait(m => m.type === 'room' && m.phase === 'paused');
  host.send({ type: 'leave' }); await resumed.wait(m => m.type === 'ended');
});
