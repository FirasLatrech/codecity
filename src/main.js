// CodeCity renderer entry: scene bootstrap, driving, inspection UI, animation loop.
// Everything it knows comes from city.json — the analyzer bakes in layout + git stats.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildCity, extColor, baseY } from './city.js';
import { face, faceSprite } from './faces.js';
import { audio, initAudio, chime, engine, setEngineProfile } from './audio.js';
import { CARS, createCar, setCarType, driveStep } from './car.js';

let city;
try { city = await (await fetch('/city.json')).json(); }
catch {
  const e = document.getElementById('err');
  e.style.display = 'grid';
  e.innerHTML = '<div>no <b>city.json</b> yet.<br><br>run:&nbsp; <code>npm run analyze /path/to/repo</code></div>';
  throw new Error('no city.json');
}
const q = new URLSearchParams(location.search);
const shot = q.has('shot'); // deterministic still for screenshot diffing

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);
scene.fog = new THREE.FogExp2(0x0b0e14, 0.0016);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
camera.position.set(420, 320, 420);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0x8fb8de, 0x10141c, 0.95));
const sun = new THREE.DirectionalLight(0xfff2d9, 1.6);
sun.position.set(120, 180, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, far: 500 });
scene.add(sun);

const { buildingsMesh, beaconMat, HOT, groundY } = buildCity(scene, city);

// ---------- faces: the team greets you at the gate, top authors float over hot buildings ----------
const contrib = {};
for (const b of city.buildings) for (const [n, c, h] of b.authors ?? []) { const e = contrib[n] ??= { n: 0, h }; e.n += c; }
const team = Object.entries(contrib).sort((a, b) => b[1].n - a[1].n).slice(0, 4);
const gate = [];
team.forEach(([name, { h }], i) => {
  const s = faceSprite(name, h, 9);
  s.position.set((i - (team.length - 1) / 2) * 11, 5.6, 108);
  scene.add(s);
  gate.push({ s, y0: 5.6, ph: i * 1.3 });
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

// ---------- the car ----------
const carRig = createCar(scene);
const carBtn = document.getElementById('carBtn');
setEngineProfile(carRig.type.engine);
carBtn.textContent = carRig.type.emoji;
function nextCar() {
  setCarType(carRig, carRig.idx + 1);
  setEngineProfile(carRig.type.engine);
  carBtn.textContent = carRig.type.emoji;
  chime();
}
carBtn.onclick = nextCar;

// ---------- input ----------
const keys = {};
const KEY = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r', ShiftLeft: 'boost', ShiftRight: 'boost' };
addEventListener('pointerdown', initAudio);
addEventListener('keydown', e => {
  initAudio();
  if (viewerOpen) {
    if (e.code === 'Escape' || e.code === 'KeyE') closeViewer();
    return;
  }
  if (e.code === 'KeyC') nextCar();
  if (e.code === 'KeyM') toggleSnd();
  if (e.code === 'KeyE' && cur) openFile(cur);
  if (KEY[e.code]) { keys[KEY[e.code]] = true; e.preventDefault(); }
});
addEventListener('keyup', e => { if (KEY[e.code]) keys[KEY[e.code]] = false; });

const sndBtn = document.getElementById('sndBtn');
function toggleSnd() {
  audio.muted = !audio.muted;
  sndBtn.textContent = audio.muted ? '🔇' : '🔊';
  if (audio.master) audio.master.gain.value = audio.muted ? 0 : 1;
  if (!audio.muted) initAudio();
}
sndBtn.onclick = toggleSnd;

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
    const r = await fetch('/raw?p=' + encodeURIComponent(b.path));
    vbody.textContent = r.ok ? await r.text() : 'could not load file';
  } catch { vbody.textContent = 'could not load file'; }
}
function closeViewer() { viewer.style.display = 'none'; viewerOpen = false; }
document.getElementById('vclose').onclick = closeViewer;

document.getElementById('repoline').textContent =
  `${city.name} · ${city.buildings.length} files · ${team.map(([n]) => n).join(', ')}`;
setTimeout(() => document.getElementById('brand').classList.add('dim'), 6000);

// ---------- post ----------
// MSAA render target — without samples the bloom pipeline drops the canvas's antialiasing
const composer = new EffectComposer(renderer,
  new THREE.WebGLRenderTarget(innerWidth, innerHeight, { samples: 4, type: THREE.HalfFloatType }));
composer.setPixelRatio(Math.min(devicePixelRatio, 2));
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.4, 1.0));
composer.addPass(new OutputPass());

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
  composer.setSize(innerWidth, innerHeight);
});

if (shot) { camera.position.set(150, 120, 150); camera.lookAt(0, 0, 0); }

const clock = new THREE.Clock();
let t = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;
  if (!shot && !viewerOpen) setCurrent(driveStep(dt, carRig, keys, camera, city.buildings, groundY));
  beaconMat.emissiveIntensity = 2.4 + Math.sin(t * 2) * 0.5;
  for (const r of residents) r.s.position.set(r.b.x, baseY(r.b) + r.b.h + 3.6 + Math.sin(t * 1.6 + r.ph) * 0.35, r.b.z);
  for (const s of gate) s.s.position.y = s.y0 + Math.sin(t * 1.3 + s.ph) * 0.3;
  if (cur && inspectFace.visible) inspectFace.position.set(cur.x, baseY(cur) + cur.h + 3, cur.z);
  engine(carRig.car.speed, !viewerOpen);
  if (q.has('nobloom')) renderer.render(scene, camera); else composer.render();
  stats?.update();
});
