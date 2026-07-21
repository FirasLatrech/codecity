// Share card composer: the rendered city is the hero (full-bleed), a single bottom
// scrim buys text contrast, identity bottom-left, contributor faces bottom-right,
// watermark top-right. 1600x900 — crisp on every social feed.
import { face } from './faces.js';

export function composeCard(glCanvas, city, team) {
  const W = 1600, H = 900;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  // cover-fit the 3D frame
  const s = Math.max(W / glCanvas.width, H / glCanvas.height);
  g.drawImage(glCanvas, (W - glCanvas.width * s) / 2, (H - glCanvas.height * s) / 2,
    glCanvas.width * s, glCanvas.height * s);

  // bottom scrim — the one gradient this design gets, purely for legibility
  const grad = g.createLinearGradient(0, H * 0.5, 0, H);
  grad.addColorStop(0, 'rgba(6,9,14,0)');
  grad.addColorStop(1, 'rgba(6,9,14,.88)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // watermark
  g.textAlign = 'right'; g.textBaseline = 'top';
  g.fillStyle = '#e6edf3'; g.font = '700 30px ui-monospace, monospace';
  g.fillText('C O D E C I T Y', W - 56, 44);
  g.fillStyle = '#7ee0a3'; g.font = '700 20px ui-monospace, monospace';
  g.fillText('codecity.dev', W - 56, 84);

  // identity: name, motto, stats
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillStyle = '#ffffff'; g.font = '700 78px ui-monospace, monospace';
  g.fillText(city.name, 56, H - 152);
  if (city.plan?.motto) {
    g.fillStyle = 'rgba(255,233,201,.92)'; g.font = 'italic 27px ui-monospace, monospace';
    g.fillText(`“${city.plan.motto}”`, 58, H - 106);
  }
  const commits = city.buildings.reduce((n, b) => n + (b.commits || 0), 0);
  const year = city.timeline && new Date(city.timeline.start * 1000).getFullYear();
  g.fillStyle = '#b9c4d0'; g.font = '24px ui-monospace, monospace';
  g.fillText([
    `${city.buildings.length.toLocaleString()} files`,
    commits && `${commits.toLocaleString()} commits`,
    team.length && `${team.length} builders`,
    year && `since ${year}`,
  ].filter(Boolean).join('   ·   '), 58, H - 56);

  // contributor pyramid, bottom-right: #1 biggest and on top, the rest trail left
  let x = W - 56;
  const placed = team.slice(0, 4).map(([name, { h }], i) => {
    const img = face(name, h).tex.image; // 256x352 canvas incl. ring + name pill
    const fh = i === 0 ? 188 : 128, fw = fh * (256 / 352);
    x -= fw - (i ? 16 : 0);
    return { img, x, y: H - 44 - fh, fw, fh };
  });
  for (const p of placed.reverse()) g.drawImage(p.img, p.x, p.y, p.fw, p.fh);

  return c;
}
