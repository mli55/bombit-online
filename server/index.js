import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from '../shared/room.js';
const ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
export function createApp() {
  const rooms = new Map();
  const server = http.createServer(async (req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
      const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
      if (pathname === '/health') { res.setHeader('Content-Type', 'application/json'); return res.end('{"ok":true}'); }
      const relative = pathname === '/' ? 'index.html' : pathname === '/game/' ? 'game/index.html' : pathname.slice(1);
      const filename = path.resolve(ROOT, relative);
      if (!filename.startsWith(ROOT) || relative.split('/').some(x => x.startsWith('.'))) { res.writeHead(403); return res.end(); }
      const bytes = await readFile(filename);
      res.setHeader('Content-Type', MIME[path.extname(filename)] || 'application/octet-stream');
      res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Cache-Control', pathname.startsWith('/game/') ? 'public, max-age=3600' : 'no-cache');
      res.setHeader('Content-Length', bytes.length); res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    let valid = false;
    try { valid = (!req.headers.origin || new URL(req.headers.origin).host === req.headers.host) && /^\/ws\/[A-F0-9]{10}$/.test(req.url); } catch {}
    if (!valid || wss.clients.size >= 100 || rooms.size >= 30 && !rooms.has(req.url.slice(4))) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, ws => {
      const code = req.url.slice(4);
      if (!rooms.has(code)) rooms.set(code, new Room(code));
      const room = rooms.get(code); ws.alive = true;
      let windowAt = Date.now(), messages = 0;
      ws.on('pong', () => { ws.alive = true; }); ws.on('error', () => {});
      ws.on('close', () => room.disconnect(ws));
      ws.on('message', (raw, binary) => {
        if (Date.now() - windowAt > 1000) { windowAt = Date.now(); messages = 0; }
        if (++messages > 100 || binary) return ws.close(1008, 'Rate limit');
        try { room.receive(ws, JSON.parse(raw)); } catch { room.error(ws, 'Invalid message format.'); }
      });
    });
  });
  const timer = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } }
    for (const [code, room] of rooms) if (!room.members().some(x => x.ws) && Date.now() - room.touched > 600000) { room.dispose(); rooms.delete(code); }
  }, 15000); timer.unref();
  return { server, rooms, async close() { clearInterval(timer); for (const r of rooms.values()) r.dispose(); for (const ws of wss.clients) ws.terminate(); await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp(); const port = Number(process.env.PORT) || 3000;
  app.server.listen(port, '0.0.0.0', () => console.log(`Bomb It Online: http://localhost:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close().then(() => process.exit(0)));
}
