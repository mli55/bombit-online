import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../original/', import.meta.url));
const base = 'https://html5.gamedistribution.com/rvvASMiM/bf359863a59f41c7b7e06ab637d009e4/';
const entries = new Map();
async function download(relative, url = base + relative) {
  if (entries.has(relative)) return;
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (/<(!doctype|html|body)/i.test(bytes.subarray(0, 100).toString()) && !relative.endsWith('.html')) throw new Error(`Unexpected HTML: ${url}`);
  const filename = path.join(root, relative);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, bytes);
  entries.set(relative, { file: relative, url, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  return bytes.toString();
}
await mkdir(root, { recursive: true });
for (const name of ['index.html', 'version.js', 'resources.json', 'bombit-1.min.js', 'azerion-libs.min.js', 'game-libs.min.js', 'assets/css/app.css', 'assets/fonts/impact/impact-Regular.css']) await download(name);
const resources = JSON.parse(await readFile(path.join(root, 'resources.json'), 'utf8'));
const queue = [];
for (const group of Object.values(resources)) {
  for (const [kind, files] of Object.entries(group)) {
    let prefix = '';
    for (const file of files) {
      if (file.searchPath) { prefix = file.searchPath.replace(/\/?$/, '/'); continue; }
      if (kind === 'atlas') {
        queue.push(prefix + 'x1/' + file.key + '.json', prefix + 'x1/' + file.key + '.png');
      } else {
        const ext = kind === 'image' ? '.png' : '.json';
        queue.push(prefix + (kind === 'image' ? 'x1/' : '') + (file.url || file.key + ext));
      }
    }
  }
}
const source = await readFile(path.join(root, 'bombit-1.min.js'), 'utf8');
for (const match of source.matchAll(/"(assets\/audios\/[^"?]+)\?v=/g)) queue.push(match[1]);
const fontCSS = await readFile(path.join(root, 'assets/fonts/impact/impact-Regular.css'), 'utf8');
for (const match of fontCSS.matchAll(/url\(['"]?([^)'"?#]+)/g)) queue.push('assets/fonts/impact/' + match[1]);
// Six concurrent downloads keep setup quick without flooding the upstream host.
let cursor = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (cursor < queue.length) await download(queue[cursor++]);
}));
const version = await readFile(path.join(root, 'version.js'), 'utf8');
for (const match of version.matchAll(/"(https:[^"]+)"/g)) {
  const url = match[1];
  await download('plugins/' + new URL(url).pathname.split('/').at(-1), url);
}
const manifest = [...entries.values()].sort((a, b) => a.file.localeCompare(b.file));
await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ source: base, retrievedAt: new Date().toISOString(), files: manifest }, null, 2) + '\n');
console.log(`Fetched ${manifest.length} original files (${(manifest.reduce((n, x) => n + x.bytes, 0) / 1048576).toFixed(1)} MiB).`);
