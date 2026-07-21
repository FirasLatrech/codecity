// Bakes the landing-page example cities into public/cities/ — meant for CI/build
// (the Vercel build container has git, tar, and network; serverless runtime does not).
// Same two-download recipe as the dev server: streamed tarball for the tree +
// blob-less bare clone for history, in parallel.
// Usage: node tools/bake-examples.mjs [repoName...]   (no args = all examples)
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { analyze } from '../analyze.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// keep in sync with the #explore postcards in index.html
const EXAMPLES = ['FirasLatrech/reqlog', 'honojs/hono', 'expressjs/express'];

const gh = () => ({
  'user-agent': 'codecity',
  accept: 'application/vnd.github+json',
  ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
});

// commit emails -> avatar URLs via the GitHub API; degrades to {} offline/rate-limited
async function avatars(owner, repo) {
  const map = Object.create(null);
  const pages = await Promise.all([1, 2, 3].map(page =>
    fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=100&page=${page}`, {
      headers: gh(), signal: AbortSignal.timeout(10_000),
    }).then(r => r.ok ? r.json() : []).catch(() => [])
  ));
  for (const c of pages.flat()) {
    const email = c.commit?.author?.email?.toLowerCase();
    if (email && c.author?.avatar_url && !map[email]) map[email] = `${c.author.avatar_url}&s=256`;
  }
  return map;
}

async function bake(owner, repo) {
  const dir = join(ROOT, '.cache', `${owner}__${repo}`);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    try {
      const meta = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: gh(), signal: AbortSignal.timeout(10_000),
      }).then(r => r.ok ? r.json() : null).catch(() => null);
      const tree = (async () => {
        const t = await fetch(`https://codeload.github.com/${owner}/${repo}/tar.gz/${meta?.default_branch || 'HEAD'}`);
        if (!t.ok) throw new Error(`tarball ${t.status} for ${owner}/${repo}`);
        const tar = spawn('tar', ['-xz', '--strip-components', '1', '-C', dir]);
        await Promise.all([
          new Promise((res, rej) => tar.on('close', c => c ? rej(new Error('tar failed')) : res())),
          new Promise((res, rej) => Readable.fromWeb(t.body).pipe(tar.stdin).on('finish', res).on('error', rej)),
        ]);
      })();
      const history = run('git', ['clone', '--bare', '--filter=blob:none', '--single-branch',
        `https://github.com/${owner}/${repo}.git`, join(dir, '.git')], { maxBuffer: 1e8 })
        .then(() => run('git', ['-C', dir, 'config', 'core.bare', 'false']));
      await Promise.all([tree, history]);
    } catch (e) {
      rmSync(dir, { recursive: true, force: true });
      throw e;
    }
  }
  const city = analyze(dir, repo, await avatars(owner, repo));
  city.gh = `${owner}/${repo}`; // lets the renderer star-link + lets /raw proxy file reads
  mkdirSync(join(ROOT, 'public/cities'), { recursive: true });
  writeFileSync(join(ROOT, 'public/cities', `${repo}.json`), JSON.stringify(city));
  console.log(`baked ${owner}/${repo} -> public/cities/${repo}.json`);
}

const only = process.argv.slice(2);
let failed = 0;
for (const spec of EXAMPLES) {
  const [owner, repo] = spec.split('/');
  if (only.length && !only.includes(repo)) continue;
  // one broken example shouldn't sink the whole deploy — its card falls back to the seeded skyline
  try { await bake(owner, repo); } catch (e) { failed++; console.error(`skipping ${spec}: ${e.message}`); }
}
if (failed) console.error(`${failed} example(s) failed to bake`);
