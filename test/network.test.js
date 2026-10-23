import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';

// Set TEST_BASE_URL to exercise the identical protocol against the Worker.
test('HTTP assets and four real WebSockets: input, pause, reconnect and cleanup', { timeout: 20000 }, async t => {
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
      const m = JSON.parse(raw); messages.push(m);
      if (m.type === 'prepare') generation = m.generation;
      if (m.type === 'frame' && m.frame[0] % 30 === 0) send({ type: 'check', tick: m.frame[0], hash: 'test-replica' });
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
  host.send({ type: 'settings', mode: 'battle', difficulty: 1 });
  await host.wait(m => m.type === 'room' && m.settings.mode === 'battle');
  for (let i = 1; i < 4; i++) { const c = await connect(); c.send({ type: 'join', name: 'QA ' + i }); await c.wait(m => m.type === 'joined'); }
  clients.forEach(c => c.send({ type: 'ready', ready: true }));
  await host.wait(m => m.type === 'room' && m.players.every(p => p?.ready));
  host.send({ type: 'start' });
  for (const c of clients) {
    const p = await c.wait(m => m.type === 'prepare'); assert.equal(p.config.players.length, 4);
    c.send({ type: 'prepared', tick: 0, hash: 'test-replica' });
  }
  await host.wait(m => m.type === 'room' && m.phase === 'playing');
  clients[2].send({ type: 'input', keys: 24 });
  const input = await host.wait(m => m.type === 'frame' && m.frame[1][2] === 24);
  for (const c of clients) assert.deepEqual((await c.wait(m => m.type === 'frame' && m.frame[0] === input.frame[0])).frame, input.frame);
  const token = clients[2].messages.find(m => m.type === 'joined').token;
  clients[2].ws.close();
  await host.wait(m => m.type === 'room' && m.phase === 'reconnecting');
  const resumed = await connect(); resumed.send({ type: 'join', token });
  const replay = await resumed.wait(m => m.type === 'prepare');
  assert.ok(replay.history.some(f => f[0] === input.frame[0] && f[1][2] === 24));
  resumed.send({ type: 'prepared', tick: replay.history.at(-1)[0], hash: 'test-replica' });
  await host.wait(m => m.type === 'frame' && m.frame[0] > replay.history.at(-1)[0]);
  host.send({ type: 'pause' }); await host.wait(m => m.type === 'room' && m.phase === 'paused');
  host.send({ type: 'leave' }); await resumed.wait(m => m.type === 'ended');
});
