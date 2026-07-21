#!/usr/bin/env node
// CodeCity analyzer — walks a repo, lays out a treemap city, writes city.json.
// Usage: node analyze.mjs [repoPath]     (writes ./public/city.json)
//        node analyze.mjs --check        (runs layout self-test, no repo needed)
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, extname, basename, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert';

const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', 'target', 'vendor', 'coverage', '__pycache__', '.venv', 'venv', 'Pods',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'Cargo.lock', 'composer.lock', 'Gemfile.lock', 'poetry.lock', 'uv.lock']);
const WORLD = 200; // city is a WORLD x WORLD square centered on origin

function walk(dir, relPath) {
  const node = { path: relPath || '.', files: [], dirs: [], size: 0 };
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return node; }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const d = walk(p, relPath ? relPath + '/' + e.name : e.name);
      if (d.size > 0) { node.dirs.push(d); node.size += d.size; }
    } else if (e.isFile()) {
      let bytes;
      try { bytes = statSync(p).size; } catch { continue; }
      if (bytes > 2_000_000) continue; // huge = probably an asset, not code
      let buf;
      try { buf = readFileSync(p); } catch { continue; }
      if (buf.includes(0)) continue; // binary
      const lines = buf.length ? buf.toString('utf8').split('\n').length : 0;
      node.files.push({ name: e.name, ext: extname(e.name).toLowerCase(), lines, bytes: Math.max(bytes, 1) });
      node.size += Math.max(bytes, 1);
    }
  }
  return node;
}

// Squarified treemap (Bruls et al.): greedily fill strips along the short
// side, growing each strip while the worst aspect ratio keeps improving.
function worst(row, len) {
  const s = row.reduce((x, y) => x + y.a, 0);
  return Math.max(...row.map(x => Math.max(len * len * x.a / (s * s), s * s / (len * len * x.a))));
}

function squarify(items, rect, place) {
  let rest = items.filter(it => it.weight > 0);
  if (!rest.length || rect.w <= 1e-6 || rect.d <= 1e-6) return;
  const scale = rect.w * rect.d / rest.reduce((s, it) => s + it.weight, 0);
  rest = rest.map(it => ({ it, a: it.weight * scale }));
  const r = { ...rect };
  while (rest.length) {
    const len = Math.min(r.w, r.d);
    if (len <= 1e-6) return;
    const row = [rest[0]];
    let n = 1;
    while (n < rest.length && worst([...row, rest[n]], len) <= worst(row, len)) row.push(rest[n++]);
    const t = row.reduce((s, x) => s + x.a, 0) / len; // strip thickness
    let off = 0;
    for (const x of row) {
      const l = x.a / t;
      if (r.w >= r.d) place(x.it, { x: r.x, z: r.z + off, w: t, d: l });
      else place(x.it, { x: r.x + off, z: r.z, w: l, d: t });
      off += l;
    }
    if (r.w >= r.d) { r.x += t; r.w -= t; } else { r.z += t; r.d -= t; }
    rest = rest.slice(n);
  }
}

function shrink(rect, pad) {
  pad = Math.min(pad, Math.min(rect.w, rect.d) * 0.25);
  return { x: rect.x + pad, z: rect.z + pad, w: rect.w - 2 * pad, d: rect.d - 2 * pad };
}

function layout(node, rect, out, depth = 0) {
  out.districts.push({ x: rect.x, z: rect.z, w: rect.w, d: rect.d, depth, name: node.path });
  const inner = shrink(rect, Math.min(rect.w, rect.d) * 0.04 + 0.25); // streets between districts
  // ponytail: ^0.72 compresses extreme size ratios so tiny files don't become slivers; drop to 1 for true area∝bytes
  const items = [
    ...node.dirs.map(d => ({ weight: d.size ** 0.72, dir: d })),
    ...node.files.map(f => ({ weight: f.bytes ** 0.72, file: f })),
  ].sort((a, b) => b.weight - a.weight);
  squarify(items, inner, (item, r) => {
    if (item.dir) return layout(item.dir, r, out, depth + 1);
    const b = shrink(r, Math.min(r.w, r.d) * 0.15); // gap between buildings
    if (b.w < 0.05 || b.d < 0.05) return;
    // clamp footprint aspect to 5:1 — no sliver houses, the empty rest of the plot stays a yard
    if (b.w > b.d * 5) { const nw = b.d * 5; b.x += (b.w - nw) / 2; b.w = nw; }
    if (b.d > b.w * 5) { const nd = b.w * 5; b.z += (b.d - nd) / 2; b.d = nd; }
    const f = item.file;
    out.buildings.push({
      x: b.x + b.w / 2, z: b.z + b.d / 2, w: b.w, d: b.d,
      h: Math.min(45, Math.max(0.6, Math.sqrt(f.lines) * 0.55)),
      path: node.path === '.' ? f.name : node.path + '/' + f.name,
      ext: f.ext, lines: f.lines, bytes: f.bytes,
    });
  });
}

function build(root, name) {
  const out = { name, generated: new Date().toISOString(), districts: [], buildings: [] };
  layout(root, { x: -WORLD / 2, z: -WORLD / 2, w: WORLD, d: WORLD }, out);
  return out;
}

function check() {
  const fakeFile = (name, bytes) => ({ name, ext: '.js', lines: bytes, bytes });
  const root = {
    path: '.', size: 1000, dirs: [
      { path: 'src', size: 700, dirs: [], files: [fakeFile('a.js', 400), fakeFile('b.js', 200), fakeFile('c.js', 100)] },
      { path: 'lib', size: 200, dirs: [], files: [fakeFile('d.js', 200)] },
    ],
    files: [fakeFile('readme.md', 100)],
  };
  const city = build(root, 'check');
  assert.equal(city.buildings.length, 5, 'every file becomes a building');
  const H = WORLD / 2;
  for (const b of city.buildings) {
    assert.ok(b.w > 0 && b.d > 0 && b.h > 0, 'positive dimensions');
    assert.ok(Math.abs(b.x) + b.w / 2 <= H && Math.abs(b.z) + b.d / 2 <= H, 'inside world');
  }
  for (let i = 0; i < city.buildings.length; i++) for (let j = i + 1; j < city.buildings.length; j++) {
    const a = city.buildings[i], b = city.buildings[j];
    const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 1e-9 && Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 1e-9;
    assert.ok(!overlap, `buildings overlap: ${a.path} / ${b.path}`);
  }
  console.log('check ok — 5 buildings, no overlaps, all inside world');
}

// One `git log` pass -> per-file { commits, last touch }. Null if not a git repo.
// ponytail: paths are repo-root-relative — analyzing a subdir of a repo won't match; run from the repo root.
function gitStats(repo) {
  try {
    const out = execSync("git log '--format=%ct|%ae|%an' --name-only --no-renames", {
      cwd: repo, maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    const map = new Map();
    // ponytail: identities merged by first-5-letters of normalized name — the same human often
    // commits as both "Firas_Latrach <work email>" and "FirasLatrech <github noreply>"
    const ident = new Map(); // key -> { names: {raw: count}, avatar, gh }
    let t = 0, key = '';
    for (const line of out.split('\n')) {
      if (!line) continue;
      const h = /^(\d+)\|([^|]*)\|(.*)$/.exec(line);
      if (h) {
        t = +h[1];
        const email = h[2].trim().toLowerCase(), name = h[3];
        key = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || email;
        let id = ident.get(key);
        if (!id) ident.set(key, id = { names: {}, avatar: '', gh: false });
        id.names[name] = (id.names[name] || 0) + 1;
        // GitHub noreply emails carry a guaranteed avatar — prefer it over gravatar guesses
        const gh = /^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/.exec(email);
        if (gh && !id.gh) {
          id.gh = true;
          id.avatar = gh[1] ? `https://avatars.githubusercontent.com/u/${gh[1]}?s=256` : `https://github.com/${gh[2]}.png?size=256`;
        } else if (!id.avatar) {
          id.avatar = `https://www.gravatar.com/avatar/${createHash('md5').update(email).digest('hex')}?s=256&d=404`;
        }
        continue;
      }
      let s = map.get(line);
      if (!s) map.set(line, s = { commits: 0, last: 0, authors: {} });
      s.commits++;
      if (t > s.last) s.last = t;
      const a = s.authors[key] ||= { n: 0 };
      a.n++;
    }
    // resolve each identity key to its most-used display name + best avatar
    for (const s of map.values())
      for (const k of Object.keys(s.authors)) {
        const id = ident.get(k);
        s.authors[k].name = Object.entries(id.names).sort((a, b) => b[1] - a[1])[0][0];
        s.authors[k].h = id.avatar;
      }
    return map;
  } catch { return null; }
}

if (process.argv[2] === '--check') {
  check();
} else {
  const repo = resolve(process.argv[2] || '.');
  const root = walk(repo, '');
  if (!root.size) { console.error(`no readable text files found in ${repo}`); process.exit(1); }
  const city = build(root, basename(repo));
  city.root = repo; // the /raw endpoint (vite.config.js) reads file contents from here for the in-city viewer
  const git = gitStats(repo);
  if (git) {
    const now = Date.now() / 1000;
    for (const b of city.buildings) {
      const s = git.get(b.path);
      if (s) {
        b.commits = s.commits;
        b.age = Math.max(0, Math.round((now - s.last) / 86400));
        b.authors = Object.values(s.authors).sort((a, z) => z.n - a.n).slice(0, 3)
          .map(a => [a.name, a.n, a.h]); // top 3 co-authors [name, commits, avatarURL]
      }
    }
  }
  writeFileSync(new URL('./public/city.json', import.meta.url), JSON.stringify(city));
  console.log(`${city.name}: ${city.buildings.length} buildings, ${city.districts.length} districts${git ? ', git-enriched' : ''} -> city.json`);
}
