// CodeCity analyze server — the git-powered backend for the hosted site.
// Serverless (api/analyze.mjs) can't clone, so it rebuilds history from the
// rate-limited GitHub API. This box HAS git: it does a blob-less clone and runs
// the real analyzer — full timelapse/heat/authors, any repo size, zero API-per-
// commit cost. Deploy on Railway/Render; Vercel proxies /analyze here.
//
//   PORT           provided by the host
//   GITHUB_TOKEN   optional — lifts avatar-lookup rate limits (recommended)
//   ALLOW_ORIGIN   optional — CORS origin, defaults to '*'
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { analyze } from './analyze.mjs';

const run = promisify(execFile);
const PORT = process.env.PORT || 8140;
const CACHE = '/tmp/cc-cache';
const GH = /^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;
const gh = () => ({ 'user-agent': 'codecity', accept: 'application/vnd.github+json',
  ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) });

// commit emails -> avatar URLs (GitHub API); degrades to {} offline/limited
async function githubAvatars(owner, repo) {
  const map = Object.create(null);
  const pages = await Promise.all([1, 2, 3].map(page =>
    fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=100&page=${page}`, {
      headers: gh(), signal: AbortSignal.timeout(10_000),
    }).then(r => r.ok ? r.json() : []).catch(() => [])));
  for (const c of pages.flat()) {
    const email = c.commit?.author?.email?.toLowerCase();
    if (email && c.author?.avatar_url && !map[email]) map[email] = `${c.author.avatar_url}&s=256`;
  }
  return map;
}

const inflight = new Map(); // share one bake across concurrent requests for the same repo

async function bake(owner, repo) {
  const dir = join(CACHE, `${owner}__${repo}`);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    try {
      const meta = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: gh(), signal: AbortSignal.timeout(8_000),
      }).then(r => r.ok ? r.json() : null).catch(() => null);
      const monster = (meta?.size ?? 0) > 2_000_000; // KB — skip history past ~2GB of git
      // tree = streamed tarball; history = blob-less bare clone. In parallel.
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
      const history = monster ? Promise.resolve() :
        run('git', ['clone', '--bare', '--filter=blob:none', '--single-branch', '--no-tags',
          `https://github.com/${owner}/${repo}.git`, join(dir, '.git')], {
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 600_000, maxBuffer: 16e6,
        }).then(() => run('git', ['-C', dir, 'config', 'core.bare', 'false']));
      await Promise.all([tree, history]);
    } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
  }
  const avatars = await githubAvatars(owner, repo);
  const city = analyze(dir, repo, avatars); // real git log -> full history
  city.gh = `${owner}/${repo}`;
  delete city.root; // server-only filesystem path — never ship it to the client
  return city;
}

const send = (res, code, body) => {
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': process.env.ALLOW_ORIGIN || '*',
    'cache-control': 'public, max-age=600',
  });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/health') return send(res, 200, { ok: true });
  if (u.pathname !== '/analyze') return send(res, 404, { error: 'not found' });
  const m = GH.exec((u.searchParams.get('url') || '').trim());
  if (!m) return send(res, 400, { error: 'that does not look like a GitHub repo — try github.com/owner/repo' });
  const [, owner, repo] = m;
  const key = `${owner}__${repo}`;
  try {
    if (!inflight.has(key)) inflight.set(key, bake(owner, repo).finally(() => inflight.delete(key)));
    const city = await inflight.get(key);
    send(res, 200, { name: repo, city });
  } catch (e) {
    send(res, 500, { error: e.message?.includes('tarball 404') ? `could not fetch ${owner}/${repo} — is it public?` : 'analyze failed — try again' });
  }
}).listen(PORT, () => console.log(`codecity analyze server on :${PORT}`));
