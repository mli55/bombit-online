import { DurableObject } from 'cloudflare:workers';
import { Room } from '../shared/room.js';
export class GameRoom extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.room = null; this.sockets = new Set(); }
  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    if (this.sockets.size >= 8) return new Response('Room connection limit', { status: 429 });
    const code = new URL(request.url).pathname.slice(4);
    this.room ||= new Room(code);
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    server.accept(); this.sockets.add(server);
    let windowAt = Date.now(), messages = 0;
    server.addEventListener('message', event => {
      if (Date.now() - windowAt > 1000) { windowAt = Date.now(); messages = 0; }
      if (++messages > 100 || typeof event.data !== 'string' || event.data.length > 8192) return server.close(1008, 'Message limit');
      try { this.room.receive(server, JSON.parse(event.data)); } catch { this.room.error(server, '消息格式错误'); }
    });
    const close = () => { this.sockets.delete(server); this.room.disconnect(server); };
    server.addEventListener('close', close); server.addEventListener('error', close);
    return new Response(null, { status: 101, webSocket: client });
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true });
    if (url.pathname.startsWith('/ws/')) {
      if (!/^\/ws\/[A-F0-9]{10}$/.test(url.pathname)) return new Response('Invalid room', { status: 400 });
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin) return new Response('Forbidden', { status: 403 });
      const id = env.ROOMS.idFromName(url.pathname.slice(4));
      return env.ROOMS.get(id, { locationHint: 'enam' }).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};
