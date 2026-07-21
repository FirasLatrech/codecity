// Coin-run game mode: coins scatter across the district plates, 5 hearts,
// every hard crash into a building costs one (1.2s grace so a scrape isn't fatal),
// zero hearts = wrecked, all coins = city cleaned. One InstancedMesh for all coins.
import * as THREE from 'three';
import { coinSnd, hurtSnd, winSnd, loseSnd } from './audio.js';

const COINS = 40, LIVES = 5;

export function createGame({ scene, city, carRig, onBeforeStart }) {
  const playBtn = document.getElementById('playBtn');
  const hud = document.getElementById('ghud');
  const heartsEl = hud.querySelector('.hearts');
  const coinsEl = document.getElementById('gCoins');
  const timeEl = document.getElementById('gTime');
  const over = document.getElementById('gover');
  const titleEl = document.getElementById('gTitle');
  const statsEl = document.getElementById('gStats');
  const hurtFx = document.getElementById('hurtFx');

  // coin spots: random points on district plates, never inside a building,
  // never on top of each other — weighted by plate area so big districts get more
  const spots = [];
  {
    // flat repos have no sub-districts — fall back to the root plate
    let plates = city.districts.filter(d => d.depth >= 1);
    if (!plates.length) plates = city.districts;
    const cum = [];
    let total = 0;
    for (const d of plates) cum.push(total += d.w * d.d);
    let guard = 0;
    while (spots.length < COINS && guard++ < 5000) {
      const r = Math.random() * total;
      const d = plates[cum.findIndex(c => c >= r)];
      if (!d || d.w < 4 || d.d < 4) continue;
      const x = d.x + 1.5 + Math.random() * (d.w - 3), z = d.z + 1.5 + Math.random() * (d.d - 3);
      if (city.buildings.some(b => Math.abs(x - b.x) < b.w / 2 + 1.2 && Math.abs(z - b.z) < b.d / 2 + 1.2)) continue;
      if (spots.some(s => (s.x - x) ** 2 + (s.z - z) ** 2 < 40)) continue;
      spots.push({ x, z, y: 0.12 + d.depth * 0.1, taken: false });
    }
  }

  const geo = new THREE.CylinderGeometry(.55, .55, .14, 20);
  geo.rotateX(Math.PI / 2); // stand on edge, Mario-style
  const coins = new THREE.InstancedMesh(geo,
    new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0xcc8a00, emissiveIntensity: .9, metalness: .8, roughness: .25 }),
    spots.length);
  coins.visible = false;
  scene.add(coins);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3();
  const S1 = new THREE.Vector3(1, 1, 1), S0 = new THREE.Vector3(.001, .001, .001);

  const g = { active: false, lives: LIVES, got: 0, t: 0, inv: 0 };

  function drawHUD() {
    heartsEl.replaceChildren(...Array.from({ length: LIVES }, (_, i) => {
      const s = document.createElement('span');
      s.textContent = '♥';
      if (i >= g.lives) s.className = 'lost';
      return s;
    }));
    coinsEl.textContent = `🪙 ${g.got}/${spots.length}`;
    timeEl.textContent = `${Math.floor(g.t / 60)}:${String(Math.floor(g.t) % 60).padStart(2, '0')}`;
  }

  function start() {
    onBeforeStart?.();
    Object.assign(g, { active: true, lives: LIVES, got: 0, t: 0, inv: 0 });
    for (const s of spots) s.taken = false;
    carRig.car.pos.set(0, 0, 138);
    carRig.car.heading = Math.PI;
    carRig.car.speed = 0;
    carRig.hit = false;
    coins.visible = true;
    hud.classList.add('show');
    over.classList.remove('show');
    playBtn.classList.add('on');
    drawHUD();
  }
  function stop() {
    g.active = false;
    coins.visible = false;
    hud.classList.remove('show');
    over.classList.remove('show');
    playBtn.classList.remove('on');
  }
  function end(won) {
    g.active = false;
    titleEl.textContent = won ? 'CITY CLEANED 🏆' : 'WRECKED 💥';
    statsEl.textContent = won
      ? `all ${spots.length} coins in ${timeEl.textContent}`
      : `${g.got}/${spots.length} coins — the buildings won`;
    // the overlay buttons are shared with race mode — whoever ends owns them
    document.getElementById('gRetry').onclick = start;
    document.getElementById('gQuit').onclick = stop;
    over.classList.add('show');
    (won ? winSnd : loseSnd)();
  }

  if (!spots.length) playBtn.style.display = 'none'; // nowhere to put coins — no game
  playBtn.onclick = () => (g.active || over.classList.contains('show')) ? stop() : start();

  // called from the drive branch of the main loop
  function update(dt, t) {
    if (!g.active) return;
    g.t += dt;
    if (g.inv > 0) g.inv -= dt;
    const cp = carRig.car.pos;
    spots.forEach((s, i) => {
      if (s.taken) { m.compose(v.set(s.x, -2, s.z), q, S0); coins.setMatrixAt(i, m); return; }
      q.setFromEuler(e.set(0, t * 2.2 + i, 0));
      m.compose(v.set(s.x, s.y + .85 + Math.sin(t * 2.5 + i) * .12, s.z), q, S1);
      coins.setMatrixAt(i, m);
      if ((cp.x - s.x) ** 2 + (cp.z - s.z) ** 2 < 3.2) {
        s.taken = true;
        g.got++;
        coinSnd();
        drawHUD();
        if (g.got === spots.length) end(true);
      }
    });
    coins.instanceMatrix.needsUpdate = true;
    if (carRig.hit && g.inv <= 0 && g.active) {
      g.lives--;
      g.inv = 1.2;
      hurtSnd();
      hurtFx.classList.add('show');
      setTimeout(() => hurtFx.classList.remove('show'), 320);
      drawHUD();
      if (g.lives <= 0) end(false);
    }
    carRig.hit = false;
    timeEl.textContent = `${Math.floor(g.t / 60)}:${String(Math.floor(g.t) % 60).padStart(2, '0')}`;
  }

  return { update, start, stop, get active() { return g.active; } };
}
