// One-click cinematic trailer: runs a scripted multi-shot camera sequence and records
// it to a 1080p WebM with baked-in captions. captureStream on the WebGL canvas alone
// would miss HTML overlays, so every frame the rendered GL frame is drawn onto a 2D
// canvas together with the captions, and THAT canvas is what MediaRecorder captures.
import * as THREE from 'three';

const easeInOut = p => p < .5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
const smooth = p => p * p * (3 - 2 * p);
const lerp = (a, b, t) => a + (b - a) * t;

export function createTrailer(deps) {
  const { camera, glCanvas, city, setCityTime, uToSec, hasTL,
    setLiveShadows, applyTier, getTier, hideDecor, onBefore, onDone } = deps;

  const W = 1920, H = 1080;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');

  // each shot: duration, caption, and a camera path cam(u)->[eye, target]
  const shots = [
    { d: 5.0, title: 'CODECITY', sub: 'every repo is a city',
      cam: u => { const e = easeInOut(u); return [[lerp(250, 120, e), lerp(150, 52, e), lerp(250, 150, e)], [0, 8, 0]]; } },
    { d: 4.5, title: 'drive through yours', sub: 'buildings are files · districts are folders',
      cam: u => { const x = lerp(-135, 135, u); return [[x, 15, 44], [x + 55, 6, 8]]; } },
    { d: 7.0, title: 'watch it grow', sub: 'git history, replayed commit by commit', grow: true,
      cam: u => { const a = -0.6 + u * Math.PI * 1.1; return [[Math.cos(a) * 178, 116, Math.sin(a) * 178], [0, 4, 0]]; } },
    { d: 4.5, title: 'three cars · real engines', sub: 'race the gates, beat your time',
      cam: u => { const a = 0.4 + u * Math.PI * 1.3; return [[Math.cos(a) * 92, 24, Math.sin(a) * 92], [0, 7, 0]]; } },
    { d: 5.5, title: 'CODECITY', sub: 'paste any GitHub repo · ★ star it in one click',
      cam: u => { const e = easeInOut(u); return [[lerp(110, 215, e), lerp(58, 150, e), lerp(140, 215, e)], [0, 6, 0]]; } },
  ];
  const total = shots.reduce((s, x) => s + x.d, 0);

  let active = false, t = 0, si = -1, rec = null, stream = null, chunks = null, savedTier = 0;

  // which shot is time t in? returns [index, localU]
  function at(time) {
    let acc = 0;
    for (let i = 0; i < shots.length; i++) {
      if (time < acc + shots[i].d || i === shots.length - 1)
        return [i, Math.min(1, Math.max(0, (time - acc) / shots[i].d))];
      acc += shots[i].d;
    }
    return [shots.length - 1, 1];
  }

  function start() {
    if (active) return;
    onBefore?.();
    active = true; t = 0; si = -1;
    savedTier = getTier();
    applyTier(0);        // record at max quality
    hideDecor(true);     // no floating faces / landmark signs cluttering the shot
    if (hasTL) setLiveShadows(true);
    stream = cv.captureStream(60);
    const mime = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(m => MediaRecorder.isTypeSupported(m)) || '';
    rec = new MediaRecorder(stream, { ...(mime && { mimeType: mime }), videoBitsPerSecond: 16_000_000 });
    chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = finish;
    rec.start();
  }

  function cancel() { if (active && rec?.state === 'recording') rec.stop(); }

  function finish() {
    const type = rec.mimeType || 'video/webm';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(chunks, { type }));
    a.download = `codecity-trailer-${city.name}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    stream.getTracks().forEach(tr => tr.stop());
    active = false; rec = null; stream = null; chunks = null;
    hideDecor(false);
    if (hasTL) { setLiveShadows(false); setCityTime(null); }
    applyTier(savedTier);
    onDone?.();
  }

  const _l = new THREE.Vector3();
  function update(dt) {
    if (!active) return;
    t += dt;
    const [idx, u] = at(t);
    const shot = shots[idx];
    if (idx !== si) { si = idx; if (!shot.grow) setCityTime(null); } // non-grow shots show the finished city
    if (shot.grow && hasTL) setCityTime(uToSec(smooth(u)));
    const [[px, py, pz], [lx, ly, lz]] = shot.cam(u);
    camera.position.set(px, py, pz);
    camera.lookAt(_l.set(lx, ly, lz));
    if (t >= total && rec?.state === 'recording') rec.stop();
  }

  // draw the just-rendered GL frame + captions into the 2D canvas (called AFTER render,
  // same loop tick, so the GL drawing buffer is still valid without preserveDrawingBuffer)
  function composite() {
    if (!active) return;
    const cw = glCanvas.width, ch = glCanvas.height, s = Math.max(W / cw, H / ch);
    const dw = cw * s, dh = ch * s;
    g.drawImage(glCanvas, (W - dw) / 2, (H - dh) / 2, dw, dh);

    const [idx, u] = at(t);
    const shot = shots[idx];
    const fade = Math.max(0, Math.min(1, u / 0.14, (1 - u) / 0.14));

    // bottom scrim for caption legibility
    const grd = g.createLinearGradient(0, H * 0.52, 0, H);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(8,8,12,0.78)');
    g.fillStyle = grd; g.fillRect(0, H * 0.52, W, H * 0.48);

    // persistent brand, top-left
    g.globalAlpha = 0.9;
    g.fillStyle = '#6366f1'; g.fillRect(80, 72, 22, 22);
    g.fillStyle = '#ededed';
    g.font = '600 30px "Space Grotesk", "Helvetica Neue", sans-serif';
    g.textBaseline = 'alphabetic';
    g.fillText('CODECITY', 114, 91);
    g.globalAlpha = 1;

    // caption, lower-left, fades in/out per shot
    g.globalAlpha = fade;
    g.fillStyle = '#ffffff';
    g.font = '700 84px "Space Grotesk", "Helvetica Neue", sans-serif';
    g.fillText(shot.title, 84, H - 152);
    g.fillStyle = 'rgba(255,255,255,0.82)';
    g.font = '500 40px "Inter Tight", "Helvetica Neue", sans-serif';
    g.fillText(shot.sub, 88, H - 96);
    g.globalAlpha = 1;

    // thin progress bar, reads as intentional
    g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(0, H - 8, W, 8);
    g.fillStyle = '#6366f1'; g.fillRect(0, H - 8, W * Math.min(1, t / total), 8);
  }

  return { start, cancel, update, composite, get active() { return active; } };
}
