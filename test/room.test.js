import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../shared/room.js';
const socket = () => ({ readyState: 1, messages: [], send(text) { this.messages.push(JSON.parse(text)); } });
function setup(count = 4, mode = 'battle') {
  let now = 0; const room = new Room('0123456789', { manual: true, now: () => now }); const clients = Array.from({ length: count }, socket);
  room.receive(clients[0], { type: 'create', name: 'Host' });
  room.receive(clients[0], { type: 'settings', mode, difficulty: 1 });
  for (const client of clients.slice(1)) room.receive(client, { type: 'join', name: 'Friend' });
  const act = (seat, msg) => room.receive(clients[seat], { generation: room.generation, ...msg });
  const start = () => { for (let i = 0; i < count; i++) act(i, { type: 'ready', ready: true }); act(0, { type: 'start' }); for (let i = 0; i < count; i++) act(i, { type: 'prepared', tick: 0, hash: 'same' }); };
  return { room, clients, act, start, setTime(t) { now = t; } };
}
test('1–4 humans start with exactly four available characters', () => {
  for (let count = 1; count <= 4; count++) {
    const { room, start } = setup(count); start();
    assert.equal(room.phase, 'playing'); assert.equal(room.config.players.length, count);
    assert.equal(new Set(room.config.players.map(p => p.character)).size, count); room.step(); assert.equal(room.frames[0][1].length, 4);
  }
});
test('campaign caps humans at two; battle caps at four; no seat stealing', () => {
  for (const [mode, count] of [['coop',2],['battle',4]]) {
    const { room, clients } = setup(count, mode); const fifth = socket(); room.receive(fifth, { type: 'join' }); assert.equal(fifth.messages.at(-1).type, 'error');
    const token = clients[0].messages.find(m => m.type === 'joined').token; room.receive(fifth, { type: 'join', token }); assert.equal(fifth.messages.at(-1).type, 'error');
  }
});
test('only host may start, alter settings or pause; all players must be ready', () => {
  const { room, act, start } = setup(); act(1, { type: 'start' }); assert.equal(room.phase, 'lobby'); act(0, { type: 'start' }); assert.equal(room.phase, 'lobby');
  act(1, { type: 'settings', mode: 'coop', difficulty: 2 }); assert.equal(room.settings.mode, 'battle'); start(); act(1, { type: 'pause' }); assert.equal(room.phase, 'playing');
});
test('input is tied to authenticated seat, invalid masks rejected and short taps retained', () => {
  const { room, act, start, setTime } = setup(); start();
  act(2, { type: 'input', seat: 0, keys: 8 }); act(0, { type: 'input', keys: 1024 });
  act(1, { type: 'input', keys: 16 }); act(1, { type: 'input', keys: 0 }); room.step(); assert.deepEqual(room.frames[0][1], [0,16,8,0]);
  room.step(); assert.deepEqual(room.frames[1][1], [0,0,8,0]); setTime(2000); room.step(); assert.deepEqual(room.frames[2][1], [0,0,0,0]);
});
test('disconnect pauses, reconnect authenticates and supplies exact replay', () => {
  const { room, clients, act, start } = setup(); start(); room.step(); const token = clients[2].messages.find(m => m.type === 'joined').token;
  room.disconnect(clients[2]); assert.equal(room.phase, 'reconnecting'); const reconnect = socket(); room.receive(reconnect, { type: 'join', token });
  assert.deepEqual(reconnect.messages.find(m => m.type === 'prepare').history, room.frames);
  room.receive(reconnect, { type: 'prepared', generation: room.generation, tick: 1, hash: 'same' }); assert.equal(room.phase, 'playing');
  act(2, { type: 'input', keys: 8 }); assert.equal(room.players[2].keys, 0);
});
test('all peers must agree at initialization and ongoing checkpoints', () => {
  const { room, act, start } = setup(); start(); room.step(); act(0,{type:'check',tick:1,hash:'a'});act(1,{type:'check',tick:1,hash:'a'});act(2,{type:'check',tick:1,hash:'b'});act(3,{type:'check',tick:1,hash:'a'});
  assert.equal(room.phase, 'desync'); const tick=room.tick;room.step();assert.equal(room.tick,tick);
});
test('late joins rejected, returning to lobby clears match, host departure ends room', () => {
  const { room, clients, act, start } = setup(2); start(); const late=socket();room.receive(late,{type:'join'});assert.equal(late.messages.at(-1).type,'error');
  act(0,{type:'lobby'});assert.equal(room.phase,'lobby');assert.equal(room.config,null);act(0,{type:'leave'});assert.equal(room.created,false);assert.ok(clients[1].messages.some(m=>m.type==='ended'));
});
test('continued campaign is one ordered command for every replica', () => {
  const { room, act, start } = setup(2,'coop');start();act(0,{type:'result',result:{canContinue:true,win:true,level:2}});assert.equal(room.phase,'result');
  act(1,{type:'continue'});assert.equal(room.phase,'result');act(0,{type:'continue'});room.step();assert.equal(room.frames[0][2],'continue');
});
test('returning to lobby cancels a queued level continuation', () => {
  const { room, act, start } = setup(2, 'coop'); start();
  act(0, { type: 'result', result: { canContinue: true } });
  act(0, { type: 'continue' }); act(0, { type: 'lobby' });
  start(); room.step(); assert.equal(room.frames[0].length, 2);
});
