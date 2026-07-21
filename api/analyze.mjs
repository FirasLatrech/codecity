// Real /analyze for serverless: no git binary and no shared disk here, so the
// repo tree comes from a streamed tarball (pure-JS untar into /tmp), the
// analyzer runs tree-only (no history -> no timelapse/heat/faces for hosted
// bakes), and the baked city returns in the response — the client stores it
// in sessionStorage and drives it. The full experience still lives in the dev
// server (vite.config.js), which has git.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { analyze } from '../analyze.mjs';

const GH = /^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;
const MAX_KB = 150_000; // GitHub-reported repo size cap (KB) — beyond this, run locally
const MAX_TAR = 80 << 20; // compressed tarball cap
const MAX_API_COMMITS = 300; // API history: 1 call per commit — beyond this, tree-only

const ghHeaders = () => ({
  'user-agent': 'codecity', accept: 'application/vnd.github+json',
  ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
});

async function pmap(items, fn, n) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

// Rebuild gitStats' per-file history map from the GitHub commits API — full
// timelapse/heat/authors for small repos with no git binary in sight.
// Null (-> tree-only) when: no token (unauth quota is 60/h, shared per egress
// IP — a public demo would burn it instantly), > MAX_API_COMMITS, or API errors.
async function historyFromApi(owner, repo) {
  if (!process.env.GITHUB_TOKEN) return null;
  const shas = [];
  for (let page = 1; page <= MAX_API_COMMITS / 100; page++) {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=100&page=${page}`, {
      headers: ghHeaders(), signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!r?.ok) return null;
    const j = await r.json();
    for (const c of j) shas.push(c.sha);
    if (j.length < 100) break;
    if (page === MAX_API_COMMITS / 100 && j.length === 100) return null; // more history than the API budget
  }
  if (!shas.length) return null;
  const details = await pmap(shas, sha =>
    fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}`, {
      headers: ghHeaders(), signal: AbortSignal.timeout(10_000),
    }).then(r => r.ok ? r.json() : null).catch(() => null), 16);
  // same shapes and identity-merge rule as gitStats in analyze.mjs
  const map = new Map(), ident = new Map();
  for (const c of details) {
    if (!c?.commit) continue;
    const t = Math.round(Date.parse(c.commit.author?.date || c.commit.committer?.date || 0) / 1000);
    const name = c.commit.author?.name || c.author?.login || 'unknown';
    const email = (c.commit.author?.email || '').toLowerCase();
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || email;
    let id = ident.get(key);
    if (!id) ident.set(key, id = { names: Object.create(null), avatar: '', gh: false });
    id.names[name] = (id.names[name] || 0) + 1;
    if (c.author?.avatar_url && !id.gh) { id.gh = true; id.avatar = `${c.author.avatar_url}&s=256`; }
    for (const f of c.files ?? []) {
      const p = f.filename;
      if (!p) continue;
      let s = map.get(p);
      if (!s) map.set(p, s = { commits: 0, last: 0, first: Infinity, times: [], authors: Object.create(null) });
      s.commits++;
      if (t > s.last) s.last = t;
      if (t < s.first) s.first = t;
      s.times.push(t);
      (s.authors[key] ||= { n: 0 }).n++;
    }
  }
  if (!map.size) return null;
  for (const s of map.values())
    for (const k of Object.keys(s.authors)) {
      const id = ident.get(k);
      s.authors[k].name = Object.entries(id.names).sort((a, b) => b[1] - a[1])[0][0];
      s.authors[k].h = id.avatar;
    }
  return map;
}

// minimal tar reader: 512-byte headers, size in octal at 124, type flag at 156.
// ponytail: GNU long-name entries (>100-char paths) are skipped, not resolved —
// those files just don't get buildings; fine for a demo bake.
function untar(buf, dest) {
  let off = 0;
  while (off + 512 <= buf.length) {
    const block = buf.subarray(off, off + 512);
    if (block.every(b => b === 0)) break;
    const name = block.toString('utf8', 0, 100).replace(/\0.*$/, '');
    const size = parseInt(block.toString('utf8', 124, 136).trim(), 8) || 0;
    const type = String.fromCharCode(block[156]);
    off += 512;
    const rel = name.split('/').slice(1).join('/'); // strip "<repo>-<ref>/"
    if (rel && !rel.includes('..')) {
      const p = join(dest, rel);
      if (type === '5') mkdirSync(p, { recursive: true });
      else if (type === '0' || type === '\0') {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, buf.subarray(off, off + size));
      }
    }
    off += Math.ceil(size / 512) * 512;
  }
}

export default async function handler(req, res) {
  const m = GH.exec(String(req.query.url || '').trim());
  if (!m) return res.status(400).json({ error: 'that does not look like a GitHub repo — try github.com/owner/repo' });
  const [, owner, repo] = m;
  const dir = join('/tmp', `${owner}__${repo}`);
  try {
    const meta = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: ghHeaders(), signal: AbortSignal.timeout(8000),
    }).then(r => r.ok ? r.json() : null).catch(() => null);
    if (meta?.size > MAX_KB) {
      return res.status(413).json({ error: `${owner}/${repo} is ~${Math.round(meta.size / 1024)}MB — too big for the hosted demo. run CodeCity locally for the full city` });
    }
    const t = await fetch(`https://codeload.github.com/${owner}/${repo}/tar.gz/${meta?.default_branch || 'HEAD'}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!t.ok) return res.status(404).json({ error: `could not fetch ${owner}/${repo} — is it public?` });
    const gz = Buffer.from(await t.arrayBuffer());
    if (gz.length > MAX_TAR) return res.status(413).json({ error: 'repo too big for the hosted demo — run CodeCity locally' });
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    untar(gunzipSync(gz, { maxOutputLength: 400 << 20 }), dir);
    // small repos get REAL history via the commits API (timelapse, heat,
    // per-file authors); big ones fall back to tree-only
    const history = await historyFromApi(owner, repo);
    const city = analyze(dir, repo, undefined, history);
    city.gh = `${owner}/${repo}`;
    // no git history -> no per-file authors, but one API call still gets the
    // real team: top contributors with avatars, baked as city.team for the gate
    const contribs = await fetch(`https://api.github.com/repos/${owner}/${repo}/contributors?per_page=10`, {
      headers: ghHeaders(), signal: AbortSignal.timeout(8000),
    }).then(r => r.ok ? r.json() : []).catch(() => []);
    city.team = contribs
      .filter(c => c.type === 'User' && !c.login?.endsWith('[bot]'))
      .slice(0, 8)
      .map(c => [c.login, c.contributions, `${c.avatar_url}&s=256`]);
    res.status(200).json({ name: repo, city });
  } catch {
    res.status(500).json({ error: 'analyze failed — try a smaller repo, or run CodeCity locally for the full experience' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
