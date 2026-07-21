// CodeCity renderer entry: scene bootstrap, driving, inspection UI, animation loop.
// Everything it knows comes from city.json — the analyzer bakes in layout + git stats.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildCity, extColor, baseY, textPlane, signSprite } from './city.js';
import { face, faceSprite } from './faces.js';
import { audio, initAudio, chime, engine, setEngineProfile } from './audio.js';
import { CARS, createCar, setCarType, driveStep } from './car.js';
import { composeCard } from './share.js';
import { createGame } from './game.js';
import { createRace } from './race.js';

// ---------- routing: /<repoName> drives that city, / is the landing page ----------
const repoName = decodeURIComponent(location.pathname.split('/')[1] || '');

function home(message) {
  const el = document.getElementById('home');
  const form = document.getElementById('homeForm');
  const input = document.getElementById('homeUrl');
  const go = document.getElementById('homeGo');
  const status = document.getElementById('homeStatus');
  el.classList.add('show');
  document.getElementById('brand').style.display = 'none';
  if (message) { status.textContent = message; status.classList.add('err'); }
  input.focus();

  // rotating accent word — vanilla port of the agency's RotatingText:
  // chars exit up, next word's chars rise from below, 20ms stagger, mask width stretches along
  const ROT = ['yours', 'react', 'vite', 'three.js'];
  const rmask = el.querySelector('.rmask'), rword = el.querySelector('.rword');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const chars = (word, below) => rword.replaceChildren(...[...word].map((c, i) => {
    const s = document.createElement('span');
    s.className = below ? 'ch below' : 'ch';
    s.style.transitionDelay = `${i * 20}ms`;
    s.textContent = c;
    return s;
  }));
  let ri = 0;
  setInterval(() => {
    ri = (ri + 1) % ROT.length;
    if (reduce) { rword.textContent = ROT[ri]; return; }
    rmask.style.width = rmask.offsetWidth + 'px'; // freeze so the swap can't jump
    chars(rword.textContent, false);
    requestAnimationFrame(() => {
      for (const s of rword.children) s.classList.add('up');
      setTimeout(() => {
        chars(ROT[ri], true);
        rmask.style.width = rword.scrollWidth + 'px'; // stretch to the new word
        requestAnimationFrame(() => {
          for (const s of rword.children) s.classList.remove('below');
        });
      }, 320);
    });
  }, 2600);
  form.onsubmit = async e => {
    e.preventDefault();
    if (!input.value.trim()) return;
    go.disabled = true;
    status.classList.remove('err');
    status.textContent = 'cloning + analyzing… big repos can take a minute';
    try {
      const r = await fetch('/analyze?url=' + encodeURIComponent(input.value.trim()));
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      location.pathname = '/' + j.name; // the city loads from its own URL
    } catch (err) {
      status.textContent = err.message || 'something went wrong — try again';
      status.classList.add('err');
      go.disabled = false;
    }
  };
}

if (!repoName) { home(); throw new Error('landing'); }

let city;
try {
  const r = await fetch(`/cities/${encodeURIComponent(repoName)}.json`);
  if (!r.ok) throw 0;
  city = await r.json();
} catch {
  history.replaceState(null, '', '/');
  home(`no city "${repoName}" here yet — paste its GitHub URL to build it`);
  throw new Error('unknown city');
}
const q = new URLSearchParams(location.search);
const shot = q.has('shot'); // deterministic still for screenshot diffing
document.body.classList.add('city'); // reveals in-city-only chrome like the play button

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);
scene.fog = new THREE.FogExp2(0x0b0e14, 0.0016);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
camera.position.set(420, 320, 420);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// the city never moves — bake the shadow map ONCE instead of re-rendering 1000+ buildings
// into it every frame (the car uses a blob shadow, so nothing dynamic casts)
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0x8fb8de, 0x10141c, 0.95));
const sun = new THREE.DirectionalLight(0xfff2d9, 1.6);
sun.position.set(120, 180, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096); // baked once, so we can afford sharp
Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, far: 500 });
scene.add(sun);

const { buildingsMesh, beaconMat, HOT, groundY, setCityTime, timeline: TL } = buildCity(scene, city);

// ---------- faces: the team greets you at the gate, top authors float over hot buildings ----------
const contrib = Object.create(null); // author names are untrusted — keep Object.prototype out of the roster
for (const b of city.buildings) for (const [n, c, h] of b.authors ?? []) { const e = contrib[n] ??= { n: 0, h }; e.n += c; }
const team = Object.entries(contrib).sort((a, b) => b[1].n - a[1].n).slice(0, 5);
const gate = [];
// contribution pyramid: #1 front and center, big and high; the rest fan out
// left/right, lower, smaller, and further back — size follows commit share
const maxN = team[0]?.[1].n || 1;
team.forEach(([name, { h, n }], i) => {
  const size = 6 + 5 * (n / maxN);
  const ring = Math.ceil(i / 2);                    // 0, then 1,1, 2,2…
  const side = i === 0 ? 0 : (i % 2 ? -1 : 1);      // center, L, R, L, R
  const x = side * ring * 10.5;
  const y = i === 0 ? 8 : 5.4 - (ring - 1) * 1.1;
  const s = faceSprite(name, h, size);
  s.position.set(x, y, 106 + ring * 2.5);
  scene.add(s);
  gate.push({ s, y0: y, ph: i * 1.3 });
});
const residents = [];
[...city.buildings].filter(b => b.authors?.length)
  .sort((a, b) => (b.commits || 0) - (a.commits || 0)).slice(0, 12)
  .forEach((b, i) => {
    const s = faceSprite(b.authors[0][0], b.authors[0][2], 5.5);
    scene.add(s);
    residents.push({ s, b, ph: i * 1.7 });
  });
const inspectFace = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }));
inspectFace.scale.set(4 * 0.727, 4, 1);
inspectFace.visible = false;
scene.add(inspectFace);

// ---------- AI city plan: landmark signs + motto (baked at analyze time, optional) ----------
const landmarkSigns = [];
for (const lm of city.plan?.landmarks ?? []) {
  const b = city.buildings.find(x => x.path === lm.path);
  if (!b) continue;
  const s = signSprite(`${lm.emoji || '⭐'} ${lm.title}`);
  s.position.set(b.x, baseY(b) + b.h + 6.5, b.z);
  scene.add(s);
  landmarkSigns.push(s);
}
if (city.plan?.motto) {
  const m = textPlane(`“${city.plan.motto}”`, 30, 'rgba(255,220,160,.75)');
  m.position.set(0, 0.03, 96);
  scene.add(m);
}

// ---------- the car ----------
// ---------- timelapse: scrub the city through its git history ----------
const tlEl = document.getElementById('tl');
const tlPlayBtn = document.getElementById('tlPlay');
const tlScrub = document.getElementById('tlScrub');
const tlDate = document.getElementById('tlDate');
const tlBtn = document.getElementById('tlBtn');
let tlOpen = false, tlPlaying = false, tlU = 0, orbitA = 0;

// While the city is regrowing (timelapse / recorded clip) the baked 4096 shadow map
// would show the full present-day skyline under an empty field. Switch to a cheap
// live 1024 map so shadows grow with the buildings, re-bake sharp when static again.
function setLiveShadows(live) {
  sun.shadow.map?.dispose();
  sun.shadow.map = null;
  sun.shadow.mapSize.setScalar(live ? 1024 : 4096);
  renderer.shadowMap.autoUpdate = live;
  renderer.shadowMap.needsUpdate = true;
}

// playback runs through *activity*, not wall-clock time — quiet years fly by,
// busy months get their moment. u in [0,1] -> unix seconds via the commit histogram.
let uToSec = u => TL ? TL.start + u * (TL.end - TL.start) : 0;
if (TL) {
  const B = TL.buckets, hist = new Array(B).fill(0);
  for (const b of city.buildings) b.g?.forEach((n, i) => hist[i] += n);
  const prefix = [0];
  for (const n of hist) prefix.push(prefix.at(-1) + n);
  const total = prefix[B];
  if (total > 0) uToSec = u => {
    const target = Math.min(total, Math.max(0, u * total));
    let k = 0;
    while (k < B - 1 && prefix[k + 1] < target) k++;
    const inBucket = hist[k] ? (target - prefix[k]) / hist[k] : 1;
    return TL.start + ((k + inBucket) / B) * (TL.end - TL.start);
  };
}

function applyTL() {
  const sec = uToSec(tlU);
  setCityTime(sec);
  tlScrub.value = Math.round(tlU * 1000);
  tlDate.textContent = new Date(sec * 1000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
function setPlaying(p) {
  tlPlaying = p;
  tlPlayBtn.classList.toggle('playing', p);
}
function setTimeline(open) {
  if (!TL) return;
  tlOpen = open;
  tlEl.classList.toggle('show', open);
  for (const s of landmarkSigns) s.visible = !open;
  for (const r of residents) r.s.visible = !open;
  setLiveShadows(open);
  if (open) {
    setCurrent(null);
    orbitA = Math.atan2(camera.position.z - 0.001, camera.position.x + 0.001);
    tlU = 0;
    applyTL();
    setPlaying(true); // one press = the show starts
  } else {
    setPlaying(false);
    setCityTime(null);
  }
  refreshTip();
}
if (!TL) tlBtn.style.display = 'none';
tlBtn.onclick = () => setTimeline(!tlOpen);
tlPlayBtn.onclick = () => {
  if (!tlPlaying && tlU >= 1) tlU = 0;
  setPlaying(!tlPlaying);
};
tlScrub.oninput = () => {
  setPlaying(false);
  tlU = tlScrub.value / 1000;
  applyTL();
};

const carRig = createCar(scene);
const game = createGame({
  scene, city, carRig,
  onBeforeStart: () => { if (tlOpen) setTimeline(false); if (viewerOpen) closeViewer(); race.stop(); },
});
const race = createRace({
  scene, city, carRig,
  onBeforeStart: () => { if (tlOpen) setTimeline(false); if (viewerOpen) closeViewer(); game.stop(); },
});
const carBtn = document.getElementById('carBtn');
setEngineProfile(carRig.type.engine);
function nextCar() {
  setCarType(carRig, carRig.idx + 1);
  setEngineProfile(carRig.type.engine);
  carBtn.classList.remove('hop'); void carBtn.offsetWidth; carBtn.classList.add('hop');
  refreshTip();
  chime();
}
carBtn.onclick = nextCar;

// ---------- share card: cinematic still + 8s orbit clip ----------
const shareEl = document.getElementById('share');
const shareImg = document.getElementById('shareImg');
const shareRecBtn = document.getElementById('shareRec');
let shareOpen = false, captureNext = false, recState = null, savedCam = null, cardCanvas = null;
function openShare() {
  if (shareOpen || recState) return;
  shareOpen = true;
  savedCam = { pos: camera.position.clone(), quat: camera.quaternion.clone(), tier };
  applyTier(0); // the card deserves max quality
  captureNext = true; // composed right after the next rendered frame
}
function closeShare() {
  shareOpen = false;
  captureNext = false; // a pending capture would resurrect the modal after close
  shareEl.classList.remove('show');
  if (savedCam) {
    camera.position.copy(savedCam.pos);
    camera.quaternion.copy(savedCam.quat);
    applyTier(savedCam.tier); // give back the quality tier the machine had earned
  }
}
function finishCapture() {
  cardCanvas = composeCard(renderer.domElement, city, team);
  shareImg.src = cardCanvas.toDataURL('image/png');
  shareEl.classList.add('show');
}
document.getElementById('shareBtn').onclick = openShare;
document.getElementById('shareClose').onclick = closeShare;
document.getElementById('shareDl').onclick = () => cardCanvas?.toBlob(b => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = `codecity-${city.name}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});
shareRecBtn.onclick = () => {
  if (recState) return;
  const stream = renderer.domElement.captureStream(60);
  // old Safari has no webm — fall through to mp4, or let the browser pick
  const mime = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(m => MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, { ...(mime && { mimeType: mime }), videoBitsPerSecond: 14_000_000 });
  const chunks = [];
  rec.ondataavailable = e => chunks.push(e.data);
  rec.onstop = () => {
    stream.getTracks().forEach(tr => tr.stop()); // a live capture track taxes every paint forever
    const type = rec.mimeType || 'video/webm';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(chunks, { type }));
    a.download = `codecity-${city.name}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    recState = null;
    shareRecBtn.disabled = false;
    shareRecBtn.textContent = 'record 8s clip';
    setCityTime(tlOpen ? uToSec(tlU) : null);
    if (TL && !tlOpen) setLiveShadows(false);
    shareEl.classList.add('show');
  };
  shareRecBtn.disabled = true;
  shareRecBtn.textContent = 'recording… 8s';
  shareEl.classList.remove('show'); // clear the stage while filming
  if (TL) setLiveShadows(true); // shadows must grow with the city on film
  recState = { t: 0, dur: 8, rec, a0: Math.atan2(150, 150) };
  rec.start();
};

// ---------- input ----------
const keys = {};
const KEY = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r', ShiftLeft: 'boost', ShiftRight: 'boost' };
addEventListener('pointerdown', initAudio);
addEventListener('keydown', e => {
  initAudio();
  if (recState) return; // don't disturb the take
  if (shot) return; // ?shot is a deterministic still — keys would strand its camera
  if (shareOpen) {
    if (e.code === 'Escape' || e.code === 'KeyP') closeShare();
    return;
  }
  if (viewerOpen) {
    if (e.code === 'Escape' || e.code === 'KeyE') closeViewer();
    return;
  }
  if (tlOpen) {
    if (e.code === 'Escape' || e.code === 'KeyT') setTimeline(false);
    if (e.code === 'Space') { e.preventDefault(); tlPlayBtn.onclick(); }
    if (e.code === 'KeyP') openShare();
    return;
  }
  if (e.code === 'KeyC') nextCar();
  if (e.code === 'KeyM') toggleSnd();
  if (e.code === 'KeyT') setTimeline(true);
  if (e.code === 'KeyP') openShare();
  if (e.code === 'KeyG') document.getElementById('playBtn').click();
  if (e.code === 'KeyR') document.getElementById('raceBtn').click();
  if (e.code === 'KeyE' && cur) openFile(cur);
  if (KEY[e.code]) { keys[KEY[e.code]] = true; e.preventDefault(); }
});
addEventListener('keyup', e => { if (KEY[e.code]) keys[KEY[e.code]] = false; });

const sndBtn = document.getElementById('sndBtn');
function toggleSnd() {
  audio.muted = !audio.muted;
  sndBtn.classList.toggle('muted', audio.muted);
  refreshTip();
  if (audio.master) audio.master.gain.value = audio.muted ? 0 : 1;
  if (!audio.muted) initAudio();
}
sndBtn.onclick = toggleSnd;

// ---------- cursor tooltip (agency-style): lands on the pointer, then trails it ----------
const tip = document.createElement('div');
tip.id = 'tip';
document.body.appendChild(tip);
const TIP_GAP = 14, TIP_EDGE = 8;
const tipSnap = matchMedia('(prefers-reduced-motion: reduce)').matches;
let tipLabel = null, tipX = 0, tipY = 0, tipCX = 0, tipCY = 0, tipRaf = 0;
function tipTarget() {
  const w = tip.offsetWidth, h = tip.offsetHeight;
  return {
    x: tipCX + TIP_GAP + w > innerWidth - TIP_EDGE ? tipCX - w - TIP_GAP : tipCX + TIP_GAP,
    y: tipCY + TIP_GAP + h > innerHeight - TIP_EDGE ? tipCY - h - TIP_GAP : tipCY + TIP_GAP,
  };
}
function tipTick() {
  const t = tipTarget();
  tipX += (t.x - tipX) * (tipSnap ? 1 : 0.18);
  tipY += (t.y - tipY) * (tipSnap ? 1 : 0.18);
  tip.style.transform = `translate(${tipX}px,${tipY}px)`;
  tipRaf = requestAnimationFrame(tipTick);
}
function refreshTip() { if (tipLabel) tip.textContent = tipLabel(); }
function tooltip(el, label) {
  el.addEventListener('mouseenter', e => {
    tipCX = e.clientX; tipCY = e.clientY;
    tipLabel = label;
    refreshTip();
    const t = tipTarget();
    tipX = t.x; tipY = t.y;
    tip.style.transform = `translate(${tipX}px,${tipY}px)`;
    tip.classList.add('show');
    cancelAnimationFrame(tipRaf);
    tipRaf = requestAnimationFrame(tipTick);
  });
  el.addEventListener('mousemove', e => { tipCX = e.clientX; tipCY = e.clientY; });
  el.addEventListener('mouseleave', () => {
    tipLabel = null;
    tip.classList.remove('show');
    cancelAnimationFrame(tipRaf);
  });
}
tooltip(carBtn, () => `car: ${carRig.type.name} — C`);
tooltip(sndBtn, () => audio.muted ? 'unmute — M' : 'mute — M');
tooltip(tlBtn, () => tlOpen ? 'exit timelapse — T' : 'timelapse — T');
tooltip(document.getElementById('shareBtn'), () => 'share card — P');
tooltip(document.getElementById('raceBtn'), () => 'race the gates — R');

// ---------- inspection card + file viewer ----------
const fmtAge = a => a === 0 ? 'today' : a === 1 ? 'yesterday' : a < 30 ? a + ' days ago' : a < 365 ? Math.round(a / 30) + ' months ago' : (a / 365).toFixed(1) + ' years ago';
const card = document.getElementById('card');
const facesEl = card.querySelector('.faces');
const pathEl = card.querySelector('.path');
const metaEl = card.querySelector('.meta');
let cur = null;
function setCurrent(b) {
  if (b === cur) return;
  if (cur) { buildingsMesh.setColorAt(cur._i, extColor(cur.ext)); buildingsMesh.instanceColor.needsUpdate = true; }
  cur = b;
  if (!b) { card.classList.remove('show'); inspectFace.visible = false; return; }
  buildingsMesh.setColorAt(b._i, extColor(b.ext).multiplyScalar(2.2));
  buildingsMesh.instanceColor.needsUpdate = true;
  chime();
  card.classList.add('show');

  facesEl.replaceChildren(...(b.authors ?? []).map(([n, , h]) => {
    const img = document.createElement('img');
    img.title = n;
    img.src = h || face(n).url;
    img.onerror = () => { img.onerror = null; img.src = face(n).url; };
    return img;
  }));
  const parts = b.path.split('/');
  pathEl.innerHTML = parts.slice(0, -1).map(p => p + ' / ').join('') + `<b>${parts.at(-1)}</b>`;
  metaEl.innerHTML = [
    `<em>${b.lines.toLocaleString()}</em> lines`,
    `<em>${(b.bytes / 1024).toFixed(1)}</em> KB`,
    b.commits && `<em>${b.commits}</em> commits${b.commits >= HOT ? ' 🔥' : ''}`,
    b.age != null && `touched <em>${fmtAge(b.age)}</em>`,
    b.authors?.length && b.authors.map(([n, c]) => `${n} ×${c}`).join(', '),
    'press <em>E</em> to read',
  ].filter(Boolean).join(' · ');
  if (b.authors?.length) {
    inspectFace.material.map = face(b.authors[0][0], b.authors[0][2]).tex;
    inspectFace.material.needsUpdate = true;
    inspectFace.visible = true;
  } else inspectFace.visible = false;
}

const viewer = document.getElementById('viewer');
const vpath = document.getElementById('vpath');
const vbody = document.getElementById('vbody');
let viewerOpen = false;
async function openFile(b) {
  vpath.textContent = b.path;
  vbody.textContent = 'loading…';
  viewer.style.display = 'flex';
  viewerOpen = true;
  for (const k of Object.keys(keys)) keys[k] = false;
  try {
    const r = await fetch(`/raw?repo=${encodeURIComponent(repoName)}&p=${encodeURIComponent(b.path)}`);
    vbody.textContent = r.ok ? await r.text() : 'could not load file';
  } catch { vbody.textContent = 'could not load file'; }
}
function closeViewer() { viewer.style.display = 'none'; viewerOpen = false; }
document.getElementById('vclose').onclick = closeViewer;

document.getElementById('repoline').textContent =
  `${city.name} · ${city.buildings.length} files · ${team.map(([n]) => n).join(', ')}`;
setTimeout(() => document.getElementById('brand').classList.add('dim'), 6000);

// ---------- post + adaptive quality ----------
// MSAA render target — without samples the bloom pipeline drops the canvas's antialiasing.
// If a machine can't hold the frame rate, quality steps down (resolution → MSAA → bloom)
// and creeps back up once it's been smooth for a while.
const TIERS = [
  { pr: 2, samples: 2, bloom: true },
  { pr: 1.5, samples: 2, bloom: true },
  { pr: 1, samples: 0, bloom: false }, // bare renderer keeps the canvas's own MSAA
];
let tier = 0, composer = null, passes = [];
function applyTier(i) {
  if (composer && i === tier) return; // already there — rebuilding would only leak
  tier = i;
  const T = TIERS[i], pr = Math.min(devicePixelRatio, T.pr);
  renderer.setPixelRatio(pr);
  // EffectComposer.dispose() does NOT dispose added passes — the bloom pass alone
  // owns 11 render targets, so free them explicitly or leak ~30MB GPU per rebuild
  for (const p of passes) p.dispose?.();
  passes = [];
  composer?.dispose();
  composer = null;
  if (T.bloom && !q.has('nobloom')) {
    composer = new EffectComposer(renderer,
      new THREE.WebGLRenderTarget(innerWidth, innerHeight, { samples: T.samples, type: THREE.HalfFloatType }));
    composer.setPixelRatio(pr);
    passes = [
      new RenderPass(scene, camera),
      new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.4, 1.0),
      new OutputPass(),
    ];
    for (const p of passes) composer.addPass(p);
  }
}
applyTier(0);

let frames = 0, acc = 0, calm = 0, aqNow = 0, upgradedAt = -1e9, banned = -1;
function autoQuality(dt) {
  aqNow += dt;
  frames++; acc += dt;
  if (acc < 2) return;
  const fps = frames / acc;
  frames = 0; acc = 0;
  if (fps < 45 && tier < TIERS.length - 1) {
    if (aqNow - upgradedAt < 15) banned = tier; // that upgrade didn't hold — never chase it again
    applyTier(tier + 1);
    calm = 0;
  } else if (fps > 56 && tier > 0 && tier - 1 !== banned && ++calm >= 5) { // ~10s smooth before upgrading
    upgradedAt = aqNow;
    applyTier(tier - 1);
    calm = 0;
  } else if (fps <= 56) calm = 0;
}

let stats = null;
if (q.has('debug')) {
  const { default: Stats } = await import('three/addons/libs/stats.module.js');
  stats = new Stats();
  stats.dom.style.cssText = 'position:fixed;top:114px;right:10px;';
  document.body.appendChild(stats.dom);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer?.setSize(innerWidth, innerHeight);
});

if (shot) { camera.position.set(150, 120, 150); camera.lookAt(0, 0, 0); }

const clock = new THREE.Clock();
let t = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;
  if (recState) {
    // one full orbit while the city grows from nothing — the money shot
    recState.t += dt;
    const p = Math.min(1, recState.t / recState.dur);
    const a = recState.a0 + p * Math.PI * 2;
    camera.position.set(Math.cos(a) * 170, 112, Math.sin(a) * 170);
    camera.lookAt(0, 4, 0);
    if (TL) setCityTime(uToSec(p * p * (3 - 2 * p)));
    if (p >= 1 && recState.rec.state === 'recording') recState.rec.stop();
  } else if (shareOpen) {
    if (captureNext) { camera.position.set(122, 78, 122); camera.lookAt(0, 4, 0); }
  } else if (tlOpen) {
    if (tlPlaying) {
      tlU = Math.min(1, tlU + dt / 15); // full history in 15s
      applyTL();
      if (tlU >= 1) setPlaying(false);
    }
    orbitA += dt * 0.12;
    camera.position.set(Math.cos(orbitA) * 175, 118, Math.sin(orbitA) * 175);
    camera.lookAt(0, 4, 0);
  } else if (!shot && !viewerOpen) {
    setCurrent(driveStep(dt, carRig, keys, camera, city.buildings, groundY));
    game.update(dt, t);
    race.update(dt, t);
  }
  beaconMat.emissiveIntensity = 2.4 + Math.sin(t * 2) * 0.5;
  for (const r of residents) r.s.position.set(r.b.x, baseY(r.b) + r.b.h + 3.6 + Math.sin(t * 1.6 + r.ph) * 0.35, r.b.z);
  for (const s of gate) s.s.position.y = s.y0 + Math.sin(t * 1.3 + s.ph) * 0.3;
  if (cur && inspectFace.visible) inspectFace.position.set(cur.x, baseY(cur) + cur.h + 3, cur.z);
  engine(carRig.car.speed, !viewerOpen && !tlOpen && !shareOpen && !recState);
  if (!shot && !shareOpen && !recState) autoQuality(dt); // ?shot stays deterministic; captures stay max-quality
  if (composer) composer.render(); else renderer.render(scene, camera);
  if (captureNext) { captureNext = false; finishCapture(); }
  stats?.update();
});
