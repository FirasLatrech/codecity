// CodeCity analyzer — walks a repo, lays out a treemap city, produces a city object.
// Usage: node analyze.mjs [repoPath]     (writes ./public/cities/<name>.json)
//        node analyze.mjs --check        (runs layout self-test, no repo needed)
// Also importable: analyze(repoPath, name?) → city  (used by the /analyze endpoint in vite.config.js)
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
      // one byte pass: binary sniff + newline count, no utf8 decode (big-repo speed)
      let lines = 0, binary = false;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 0) { binary = true; break; }
        if (buf[i] === 10) lines++;
      }
      if (binary) continue;
      if (buf.length && buf[buf.length - 1] !== 10) lines++;
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
// emailAvatars: optional email -> avatar URL map (GitHub API-resolved) that beats the local guesses.
// ponytail: paths are repo-root-relative — analyzing a subdir of a repo won't match; run from the repo root.
function gitStats(repo, emailAvatars = {}) {
  try {
    // ponytail: history capped at 50k commits — on monster repos the timelapse shows the
    // recent 50k, which is still a great show; drop the cap if someone needs full linux history
    const out = execSync("git log --max-count=50000 '--format=%ct|%ae|%an' --name-only --no-renames", {
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
        // Object.create(null): author names/emails are attacker-controlled strings —
        // a commit authored as "constructor" must not hit Object.prototype
        if (!id) ident.set(key, id = { names: Object.create(null), avatar: '', gh: false });
        id.names[name] = (id.names[name] || 0) + 1;
        // avatar priority: GitHub API-resolved email > noreply-derived > gravatar guess
        if (Object.hasOwn(emailAvatars, email) && !id.gh) {
          id.gh = true;
          id.avatar = emailAvatars[email];
        }
        const gh = /^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/.exec(email);
        if (gh && !id.gh) {
          id.gh = true;
          // /u/<id> for new-style noreply, /<username> for old-style — both CORS-safe (github.com/<user>.png is not)
          id.avatar = gh[1] ? `https://avatars.githubusercontent.com/u/${gh[1]}?s=256` : `https://avatars.githubusercontent.com/${gh[2]}?s=256`;
        } else if (!id.avatar) {
          id.avatar = `https://www.gravatar.com/avatar/${createHash('md5').update(email).digest('hex')}?s=256&d=404`;
        }
        continue;
      }
      let s = map.get(line);
      if (!s) map.set(line, s = { commits: 0, last: 0, first: Infinity, times: [], authors: Object.create(null) });
      s.commits++;
      if (t > s.last) s.last = t;
      if (t < s.first) s.first = t;
      s.times.push(t); // full history per file — bucketed into the growth curve later
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

const MAX_FILES = 3500; // ponytail: giant repos keep only their biggest files — city stays light + drivable

function collectSizes(node, out = []) {
  for (const f of node.files) out.push(f.bytes);
  for (const d of node.dirs) collectSizes(d, out);
  return out;
}
function prune(node, min) {
  node.files = node.files.filter(f => f.bytes >= min);
  node.dirs = node.dirs.filter(d => prune(d, min).size > 0);
  node.size = node.files.reduce((s, f) => s + f.bytes, 0) + node.dirs.reduce((s, d) => s + d.size, 0);
  return node;
}

// gitOverride: pre-computed history map in gitStats' shape — lets environments
// without a git binary (serverless) supply history from the GitHub API instead.
export function analyze(repoPath, name, emailAvatars, gitOverride) {
  const repo = resolve(repoPath);
  const root = walk(repo, '');
  if (!root.size) throw new Error(`no readable text files found in ${repo}`);
  const sizes = collectSizes(root).sort((a, b) => b - a);
  if (sizes.length > MAX_FILES) {
    prune(root, sizes[MAX_FILES - 1]);
    console.log(`big repo: keeping the ~${MAX_FILES} biggest of ${sizes.length} files`);
  }
  const city = build(root, name || basename(repo));
  city.root = repo; // the /raw endpoint (vite.config.js) reads file contents from here for the in-city viewer
  const git = gitOverride ?? gitStats(repo, emailAvatars);
  if (git) {
    const now = Date.now() / 1000;
    // repo lifespan -> timelapse timeline; per-building growth = commits per 1/32 of that span
    let t0 = Infinity, t1 = 0;
    for (const s of git.values()) {
      if (s.first < t0) t0 = s.first;
      if (s.last > t1) t1 = s.last;
    }
    const B = 32, span = Math.max(1, t1 - t0);
    if (t1 > 0) city.timeline = { start: t0, end: t1, buckets: B };
    for (const b of city.buildings) {
      const s = git.get(b.path);
      if (s) {
        b.commits = s.commits;
        b.age = Math.max(0, Math.round((now - s.last) / 86400));
        b.authors = Object.values(s.authors).sort((a, z) => z.n - a.n).slice(0, 3)
          .map(a => [a.name, a.n, a.h]); // top 3 co-authors [name, commits, avatarURL]
        b.born = s.first;
        const g = new Array(B).fill(0);
        for (const t of s.times) g[Math.min(B - 1, Math.floor(((t - t0) / span) * B))]++;
        b.g = g;
      }
    }
  }
  return city;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--check') {
    check();
  } else if (process.argv[2] === '--bake') {
    // server mode: node analyze.mjs --bake <repoPath> <name> [avatarsJsonPath]
    // city JSON on stdout — runs in a child process so a big analyze never blocks the server
    try {
      const avatars = process.argv[5] ? JSON.parse(readFileSync(process.argv[5], 'utf8')) : {};
      process.stdout.write(JSON.stringify(analyze(process.argv[3], process.argv[4], avatars)));
    } catch (e) { console.error(e.message); process.exit(1); }
  } else {
    try {
      const city = analyze(process.argv[2] || '.');
      const dir = fileURLToPath(new URL('./public/cities/', import.meta.url));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${city.name}.json`), JSON.stringify(city));
      console.log(`${city.name}: ${city.buildings.length} buildings, ${city.districts.length} districts -> http://localhost:8137/${city.name}`);
    } catch (e) { console.error(e.message); process.exit(1); }
  }
}
