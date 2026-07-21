import { defineConfig, loadEnv } from 'vite';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const CITIES = join(ROOT, 'public/cities');
const CACHE = join(ROOT, '.cache');

// accepts "github.com/owner/repo", full https URLs, trailing .git, or bare "owner/repo"
const GH = /^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;
const SAFE = /^[\w.-]+$/;

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
};

// set GITHUB_TOKEN in .env.local for production: unauthenticated API = 60 req/h per IP
// (≈15 analyzes/h), a token = 5000/h. Tarball + git downloads are not API-limited.
const gh = () => ({
  'user-agent': 'codecity', accept: 'application/vnd.github+json',
  ...(process.env.GITHUB_TOKEN && { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }),
});

// GitHub resolves commit emails to accounts better than any local guess (work emails,
// aliases…). One pass over the recent commits API builds email -> avatar URL.
async function githubAvatars(owner, repo) {
  const map = Object.create(null);
  // 3 pages fetched in parallel — avatar lookup should never be the slow part
  const pages = await Promise.all([1, 2, 3].map(page =>
    fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=100&page=${page}`, {
      headers: gh(),
      signal: AbortSignal.timeout(10_000),
    }).then(r => r.ok ? r.json() : []).catch(() => []) // offline or rate-limited — local guesses still apply
  ));
  for (const c of pages.flat()) {
    const email = c.commit?.author?.email?.toLowerCase();
    if (email && c.author?.avatar_url && !map[email]) map[email] = `${c.author.avatar_url}&s=256`;
  }
  return map;
}

// Optional AI city plan via Groq (set GROQ_API_KEY): the model reads a digest of the
// repo and picks landmark buildings + a motto. One call per analyze, baked into the JSON;
// without a key (or on any failure) the city simply has no landmarks.
async function cityPlan(city) {
  if (!process.env.GROQ_API_KEY) return null;
  const contrib = {};
  for (const b of city.buildings) for (const [n, c] of b.authors ?? []) contrib[n] = (contrib[n] || 0) + c;
  const digest = {
    repo: city.name,
    fileCount: city.buildings.length,
    hotFiles: [...city.buildings].sort((a, b) => (b.commits || 0) - (a.commits || 0)).slice(0, 15)
      .map(b => ({ path: b.path, commits: b.commits || 0, lines: b.lines, daysSinceTouch: b.age })),
    biggestFiles: [...city.buildings].sort((a, b) => b.lines - a.lines).slice(0, 8)
      .map(b => ({ path: b.path, lines: b.lines })),
    topContributors: Object.entries(contrib).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, commits]) => ({ name, commits })),
  };
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are the city planner for CodeCity, which renders a git repo as a 3D night city (file = building, height = size, commits = activity). From the repo stats you receive, return JSON exactly like: {"motto": string, "landmarks": [{"path": string, "title": string, "emoji": string}]}. motto: <=8 playful words about this repo. landmarks: pick 4-6 files that deserve a monument (the churn hotspot, the tallest tower, the heart of the codebase, the freshest construction...). path MUST be copied exactly from the stats. title: <=4 playful words, like a real city landmark name. emoji: exactly one.',
        },
        { role: 'user', content: JSON.stringify(digest) },
      ],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!r.ok) throw new Error(`groq ${r.status}`);
  const plan = JSON.parse((await r.json()).choices[0].message.content);
  plan.landmarks = (plan.landmarks || []).filter(l => city.buildings.some(b => b.path === l.path)).slice(0, 6);
  return plan;
}

// ---- scale guards ----
const inflight = new Map(); // "owner__repo" -> promise of city name: concurrent requests for the same repo share one bake
let active = 0;
const MAX_ACTIVE = 4;  // ponytail: per-process cap, extras get a friendly 503 — put a real queue in front if a launch spike outgrows it
const MAX_CACHED = 40; // repos kept on disk (linux alone is 1.7GB); oldest evicted, their baked city.json stays

function evictCache() {
  try {
    readdirSync(CACHE, { withFileTypes: true }).filter(d => d.isDirectory())
      .map(d => ({ p: join(CACHE, d.name), t: statSync(join(CACHE, d.name)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(MAX_CACHED)
      .forEach(d => rmSync(d.p, { recursive: true, force: true }));
  } catch {}
}

// fetch (cached) + analyze + bake public/cities/<repo>.json; returns the city name
async function bake(owner, repo) {
  const dir = join(CACHE, `${owner}__${repo}`);
  mkdirSync(CACHE, { recursive: true });
  {
    // an empty dir is a corpse from an interrupted fetch, not a cache hit
    if (existsSync(dir) && !readdirSync(dir).length) rmSync(dir, { recursive: true, force: true });
    if (existsSync(dir)) utimesSync(dir, new Date(), new Date()); // cache hits stay young for the evictor
    if (!existsSync(dir)) {
      const meta = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: gh(),
        signal: AbortSignal.timeout(8_000),
      }).then(r => r.ok ? r.json() : null).catch(() => null); // API down → assume normal-sized
      // No clone. Tree = one streamed tarball (file contents never travel through git).
      // History = a blob-less bare clone: commits + trees only, since our
      // `git log --name-only --no-renames` never touches file contents — typically
      // 5-15% of a full clone. The two downloads run in parallel.
      try {
        mkdirSync(dir, { recursive: true });
        const monster = (meta?.size ?? 0) > 2_000_000; // GitHub size is KB — history skipped past ~2GB of git
        if (monster) console.log(`${owner}/${repo} is ${Math.round(meta.size / 1024)}MB — tree only, skipping history`);
        const tree = (async () => {
          const t = await fetch(`https://codeload.github.com/${owner}/${repo}/tar.gz/${meta?.default_branch || 'HEAD'}`, {
            headers: { 'user-agent': 'codecity' }, signal: AbortSignal.timeout(600_000),
          });
          if (!t.ok) throw new Error(`tarball ${t.status}`);
          const tar = spawn('tar', ['-xz', '--strip-components', '1', '-C', dir]);
          await Promise.all([
            new Promise((ok, no) => tar.on('close', c => c ? no(new Error('tar exit ' + c)) : ok())),
            pipeline(Readable.fromWeb(t.body), tar.stdin),
          ]);
        })();
        // monsters skip history — even blob-less, linux's 1.3M commits of metadata are GBs.
        // ponytail: `git clone` locally + `node analyze.mjs` if you want a monster WITH history
        const history = monster ? Promise.resolve() :
          run('git', ['clone', '--bare', '--filter=blob:none', '--single-branch', '--no-tags',
            `https://github.com/${owner}/${repo}.git`, join(dir, '.git')], {
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 600_000, maxBuffer: 16e6,
          }).then(() => run('git', ['-C', dir, 'config', 'core.bare', 'false'])); // bare .git + tarball tree = a normal repo
        await Promise.all([tree, history]);
      } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
    }
  }
  // ponytail: cached fetch is never refreshed — delete .cache/<owner>__<repo> to re-pull
  // The analyzer (sync git log + file walk) runs in a child process so one big repo
  // never freezes the event loop for every other visitor. Avatars fetched in parallel.
  const avatars = await githubAvatars(owner, repo);
  const avatarsFile = join(dir, '.cc-avatars.json');
  writeFileSync(avatarsFile, JSON.stringify(avatars));
  const { stdout } = await run(process.execPath,
    [fileURLToPath(new URL('./analyze.mjs', import.meta.url)), '--bake', dir, repo, avatarsFile],
    { maxBuffer: 256e6, timeout: 300_000 });
  const city = JSON.parse(stdout);
  city.gh = `${owner}/${repo}`; // lets the renderer offer "star this repo" on shared cities
  // big cities skip the AI planner — keep huge repos fast and light
  city.plan = city.buildings.length > 1500
    ? null
    : await cityPlan(city).catch(e => (console.warn('city plan skipped:', e.message), null));
  mkdirSync(CITIES, { recursive: true });
  writeFileSync(join(CITIES, `${repo}.json`), JSON.stringify(city));
  evictCache();
  return city.name;
}

// GET /analyze?url=<github repo> — deduped + capped, then bake
async function handleAnalyze(u, res) {
  const m = GH.exec((u.searchParams.get('url') || '').trim());
  if (!m) return json(res, 400, { error: 'that does not look like a GitHub repo — try github.com/owner/repo' });
  const [, owner, repo] = m;
  const key = `${owner}__${repo}`;
  // already building this exact repo? ride the same bake instead of racing into the same dir
  if (inflight.has(key)) {
    try { return json(res, 200, { name: await inflight.get(key) }); }
    catch { return json(res, 500, { error: 'clone or analysis failed — is the repo public and spelled right?' }); }
  }
  if (active >= MAX_ACTIVE) return json(res, 503, { error: 'the city foundry is busy — give it a few seconds and try again' });
  active++;
  const p = bake(owner, repo);
  inflight.set(key, p);
  try {
    json(res, 200, { name: await p });
  } catch (e) {
    console.warn(`analyze ${owner}/${repo} failed:`, e.stderr?.toString().trim() || e.message || e);
    json(res, 500, { error: 'clone or analysis failed — is the repo public and spelled right?' });
  } finally {
    active--;
    inflight.delete(key);
  }
}

// GET /raw?repo=<name>&p=<repo-relative-path> — file contents for the in-city reader.
// Paths are whitelisted against the baked city — no traversal.
function handleRaw(u, res) {
  try {
    const repo = u.searchParams.get('repo'), p = u.searchParams.get('p');
    if (!SAFE.test(repo)) throw new Error('bad repo');
    const city = JSON.parse(readFileSync(join(CITIES, `${repo}.json`), 'utf8'));
    if (!city.buildings.some(b => b.path === p)) throw new Error('unknown file');
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(readFileSync(join(city.root, p)));
  } catch { res.statusCode = 404; res.end('unknown file'); }
}

function cityApi() {
  const handler = (req, res, next) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/analyze') return handleAnalyze(u, res);
    if (u.pathname === '/raw') return handleRaw(u, res);
    next();
  };
  return {
    name: 'codecity-api',
    // note: no return value — vite calls a returned value as a post-hook
    configureServer(s) { s.middlewares.use(handler); },
    configurePreviewServer(s) { s.middlewares.use(handler); },
  };
}

export default defineConfig(({ mode }) => {
  // pull GROQ_API_KEY (etc.) from .env/.env.local into the server process — never the client
  Object.assign(process.env, loadEnv(mode, ROOT, ''));
  return {
    plugins: [cityApi()],
    build: { target: 'esnext' }, // main.js uses top-level await
    // never watch the clone cache or baked cities — extracting linux is 80k file events
    server: { port: 8137, watch: { ignored: ['**/.cache/**', '**/public/cities/**'] } },
    preview: { port: 8137 },
  };
});
