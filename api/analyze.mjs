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
      headers: {
        'user-agent': 'codecity', accept: 'application/vnd.github+json',
        ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(8000),
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
    const city = analyze(dir, repo); // tree-only: serverless has no git
    city.gh = `${owner}/${repo}`;
    res.status(200).json({ name: repo, city });
  } catch {
    res.status(500).json({ error: 'analyze failed — try a smaller repo, or run CodeCity locally for the full experience' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
