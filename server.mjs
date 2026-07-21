#!/usr/bin/env node
// CodeCity server: static files + /raw?p=<repo-relative-path> -> file contents for the in-city reader.
// Usage: node server.mjs   (after node analyze.mjs <repo>)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const dir = new URL('.', import.meta.url).pathname;
let root = null, okPaths = new Set();
try {
  const city = JSON.parse(await readFile(join(dir, 'city.json'), 'utf8'));
  root = city.root;
  okPaths = new Set(city.buildings.map(b => b.path)); // whitelist — no path traversal
} catch { console.warn('no city.json yet — /raw disabled until you run analyze.mjs'); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };
createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    if (u.pathname === '/raw') {
      const p = u.searchParams.get('p');
      if (!root || !okPaths.has(p)) { res.writeHead(404); return res.end('unknown file'); }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(await readFile(join(root, p)));
    }
    const f = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.slice(1));
    if (f.includes('..')) { res.writeHead(403); return res.end(); }
    const data = await readFile(join(dir, f)); // read BEFORE writeHead so a 404 can still set headers
    res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(8137, () => console.log('CodeCity -> http://localhost:8137'));
