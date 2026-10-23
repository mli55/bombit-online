import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
await rm(root + 'public/game', { recursive: true, force: true });
await mkdir(root + 'public/game', { recursive: true });
await cp(root + 'original', root + 'public/game', { recursive: true });
let code = await readFile(root + 'original/bombit-1.min.js', 'utf8');
if (!code.includes('renderer:Phaser.AUTO')) throw new Error('Upstream renderer changed; review the adapter.');
// Keep Phaser.AUTO: GPU rendering where available, Canvas fallback otherwise.
await writeFile(root + 'public/game/bombit-1.min.js', code);
await cp(root + 'public/game.html', root + 'public/game/index.html');
console.log('Original game + online adapter built.');
