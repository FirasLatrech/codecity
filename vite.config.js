import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// /raw?p=<repo-relative-path> -> file contents for the in-city reader.
// Paths are whitelisted against city.json — no traversal.
function rawEndpoint() {
  const handler = (req, res, next) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname !== '/raw') return next();
    try {
      // re-read every request so a fresh `npm run analyze` is picked up live
      const city = JSON.parse(readFileSync(new URL('./public/city.json', import.meta.url), 'utf8'));
      const p = u.searchParams.get('p');
      if (!city.buildings.some(b => b.path === p)) throw new Error('unknown file');
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(readFileSync(join(city.root, p)));
    } catch { res.statusCode = 404; res.end('unknown file'); }
  };
  return {
    name: 'codecity-raw',
    // note: no return value — vite calls a returned value as a post-hook
    configureServer(s) { s.middlewares.use(handler); },
    configurePreviewServer(s) { s.middlewares.use(handler); },
  };
}

export default defineConfig({
  plugins: [rawEndpoint()],
  build: { target: 'esnext' }, // main.js uses top-level await
  server: { port: 8137 },
  preview: { port: 8137 },
});
