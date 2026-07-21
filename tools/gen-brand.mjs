// Generates the CodeCity logo + social card from one shared isometric-city routine.
// Run: node tools/gen-brand.mjs   then rasterize with rsvg-convert (see README/CLAUDE.md).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const OUT = fileURLToPath(new URL('../public', import.meta.url));

// iso projection factory centered at (cx,cy) with tile size u
function makeIso(cx, cy, ux, uy) {
  return (a, b, h) => [cx + (a - b) * ux, cy + (a + b) * uy - h];
}
const pt = ([x, y]) => `${+x.toFixed(2)} ${+y.toFixed(2)}`;
const poly = (pts, fill) => `<path d="M${pts.map(pt).join(' L')} Z" fill="${fill}"/>`;

function box(P, a0, b0, w, d, h, c) {
  const A = a0, B = b0, A2 = a0 + w, B2 = b0 + d;
  const leftFace = [P(A2, B, 0), P(A2, B2, 0), P(A2, B2, h), P(A2, B, h)];
  const rightFace = [P(A, B2, 0), P(A2, B2, 0), P(A2, B2, h), P(A, B2, h)];
  const top = [P(A, B, h), P(A2, B, h), P(A2, B2, h), P(A, B2, h)];
  return {
    faces: poly(top, c.top) + poly(leftFace, c.left) + poly(rightFace, c.right),
    leftFace, rightFace,
  };
}
function windows(face, cols, rows, fill) {
  const [bl, br, , tl] = face;
  const u = [br[0] - bl[0], br[1] - bl[1]], v = [tl[0] - bl[0], tl[1] - bl[1]];
  const mx = .16, my = .12, gx = .12, gy = .14;
  const wc = (1 - 2 * mx - (cols - 1) * gx) / cols, hc = (1 - 2 * my - (rows - 1) * gy) / rows;
  let out = '';
  const corner = (fa, fb) => [bl[0] + fa * u[0] + fb * v[0], bl[1] + fa * u[1] + fb * v[1]];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const a = mx + i * (wc + gx), b = my + j * (hc + gy);
    out += poly([corner(a, b), corner(a + wc, b), corner(a + wc, b + hc), corner(a, b + hc)], fill);
  }
  return out;
}
// the three-tower cluster; scale drives tile size, everything else in tile units
function cluster(cx, cy, scale) {
  const P = makeIso(cx, cy, 9 * scale, 5 * scale);
  const H = scale; // heights scale with the tile too
  const left = box(P, -1.3, .5, 1, 1, 10 * H, { top: '#6366f1', left: '#4a4dc8', right: '#3a3ca6' });
  const right = box(P, .6, -1.2, 1, 1, 14 * H, { top: '#6d70f5', left: '#4f52d6', right: '#3f41b4' });
  const center = box(P, -.2, -.2, 1.2, 1.2, 22 * H, { top: '#8184ff', left: '#5c5ff0', right: '#4649c4' });
  return poly([P(-1.4, -1.4, 0), P(2.4, -1.4, 0), P(2.4, 2.4, 0), P(-1.4, 2.4, 0)], '#15151f')
    + left.faces + right.faces + center.faces
    + windows(center.leftFace, 3, 4, '#ffd27a') + windows(center.rightFace, 3, 4, '#d99a3f')
    + windows(right.leftFace, 2, 3, '#ffd27a') + windows(left.rightFace, 2, 2, '#d99a3f');
}

// ---- 1. logo (64 tile) ----
const logo = `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="CodeCity">
  <defs><clipPath id="t"><rect x="1" y="1" width="62" height="62" rx="15"/></clipPath></defs>
  <rect x="1" y="1" width="62" height="62" rx="15" fill="#0f0f17"/>
  <g clip-path="url(#t)">${cluster(32, 40, 1)}</g>
  <rect x="1.5" y="1.5" width="61" height="61" rx="14.5" fill="none" stroke="#fff" stroke-opacity="0.09"/>
</svg>`;
writeFileSync(`${OUT}/logo.svg`, logo);

// ---- 2. social card (1200x630) ----
// faint skyline strip along the bottom, then the logo cluster + wordmark
let skyline = '';
const rand = (s => () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)(7);
for (let x = -20, i = 0; x < 1220; i++) {
  const w = 26 + rand() * 34, h = 40 + rand() * 150;
  skyline += `<rect x="${x.toFixed(0)}" y="${(630 - h).toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="#12121c"/>`;
  // a few lit windows
  for (let wy = 630 - h + 12; wy < 620; wy += 16)
    for (let wx = x + 6; wx < x + w - 6; wx += 12)
      if (rand() > .78) skyline += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="3" height="4" fill="#3a3a58"/>`;
  x += w + 4 + rand() * 8;
}

const F = 'Avenir Next, Helvetica Neue, Helvetica, sans-serif';
const og = `<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="0.72" cy="0.42" r="0.5">
      <stop offset="0" stop-color="#6366f1" stop-opacity="0.28"/><stop offset="1" stop-color="#6366f1" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#0a0a0c"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <g opacity="0.65">${skyline}</g>
  <rect width="1200" height="630" fill="#0a0a0c" opacity="0.15"/>
  <!-- hero cluster, right side -->
  <g transform="translate(0,-30)">${cluster(880, 300, 5.4)}</g>
  <!-- wordmark + tagline, left -->
  <text x="90" y="292" font-family="${F}" font-size="118" font-weight="700" letter-spacing="2" fill="#ededed">CODECITY</text>
  <text x="94" y="352" font-family="${F}" font-size="34" font-weight="500" fill="#a9a9c4">every repo is a city — drive through yours</text>
  <g transform="translate(94,404)">
    <rect x="0" y="0" width="13" height="13" rx="3" fill="#6366f1"/>
    <text x="26" y="12" font-family="${F}" font-size="24" font-weight="500" fill="#7ee0a3">3D · drivable · git-history timelapse · race mode</text>
  </g>
  <text x="94" y="560" font-family="${F}" font-size="22" font-weight="500" fill="#6b6b80">built by Firas Latrach</text>
</svg>`;
writeFileSync(`${OUT}/og.svg`, og);
console.log('wrote public/logo.svg + public/og.svg — now rasterize:');
console.log('  cd public');
console.log('  rsvg-convert -w 1200 -h 630 og.svg -o og.png');
console.log('  rsvg-convert -w 512 -h 512 logo.svg -o logo-512.png');
console.log('  rsvg-convert -w 180 -h 180 logo.svg -o apple-touch-icon.png');
console.log('  rsvg-convert -w 32  -h 32  logo.svg -o favicon-32.png');
console.log('  cp logo.svg favicon.svg && rm og.svg');
