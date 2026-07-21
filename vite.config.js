import { defineConfig, loadEnv } from 'vite';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { analyze } from './analyze.mjs';

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

// GitHub resolves commit emails to accounts better than any local guess (work emails,
// aliases…). One pass over the recent commits API builds email -> avatar URL.
// Unauthenticated rate limit is 60 req/h — 3 pages per analyze is well within it.
async function githubAvatars(owner, repo) {
  const map = Object.create(null);
  // 3 pages fetched in parallel — avatar lookup should never be the slow part
  const pages = await Promise.all([1, 2, 3].map(page =>
    fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=100&page=${page}`, {
      headers: { 'user-agent': 'codecity', accept: 'application/vnd.github+json' },
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

// GET /analyze?url=<github repo> — clone (cached), analyze, bake public/cities/<repo>.json
async function handleAnalyze(u, res) {
  const m = GH.exec((u.searchParams.get('url') || '').trim());
  if (!m) return json(res, 400, { error: 'that does not look like a GitHub repo — try github.com/owner/repo' });
  const [, owner, repo] = m;
  const dir = join(CACHE, `${owner}__${repo}`);
  try {
    if (!existsSync(dir)) {
      mkdirSync(CACHE, { recursive: true });
      // execFile (no shell) + validated owner/repo — nothing to inject
      await run('git', ['clone', '--single-branch', '--no-tags', `https://github.com/${owner}/${repo}.git`, dir], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 300_000, maxBuffer: 16e6,
      }).catch(e => { rmSync(dir, { recursive: true, force: true }); throw e; });
    }
    // ponytail: cached clone is never refreshed — delete .cache/<owner>__<repo> to re-pull
    const city = analyze(dir, repo, await githubAvatars(owner, repo));
    // big cities skip the AI planner — keep huge repos fast and light
    city.plan = city.buildings.length > 1500
      ? null
      : await cityPlan(city).catch(e => (console.warn('city plan skipped:', e.message), null));
    mkdirSync(CITIES, { recursive: true });
    writeFileSync(join(CITIES, `${repo}.json`), JSON.stringify(city));
    json(res, 200, { name: city.name });
  } catch (e) {
    json(res, 500, { error: 'clone or analysis failed — is the repo public and spelled right?' });
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
    server: { port: 8137 },
    preview: { port: 8137 },
  };
});
