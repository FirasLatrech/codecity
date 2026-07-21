// Race mode: checkpoint gates ring the city — drive through them in order, beat the
// clock. Best time per repo lives in localStorage. One InstancedMesh for all gates,
// next gate glows green (accent) + a light column beacon so you can spot it from afar.
import * as THREE from 'three';
import { coinSnd, winSnd } from './audio.js';

const GATES = 8;
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}.${Math.floor(s * 10) % 10}`;

export function createRace({ scene, city, carRig, onBeforeStart }) {
  const raceBtn = document.getElementById('raceBtn');
  const hud = document.getElementById('rhud');
  const gatesEl = document.getElementById('rGates');
  const timeEl = document.getElementById('rTime');
  const bestEl = document.getElementById('rBest');
  const over = document.getElementById('gover');
  const titleEl = document.getElementById('gTitle');
  const statsEl = document.getElementById('gStats');
  const bestKey = `cc-race-${city.name}`;

  // gate spots: same sampling as coins but few, far apart, then sorted by angle
  // around the city center so the circuit actually flows instead of zig-zagging
  const spots = [];
  {
    let plates = city.districts.filter(d => d.depth >= 1);
    if (!plates.length) plates = city.districts;
    const cum = [];
    let total = 0;
    for (const d of plates) cum.push(total += d.w * d.d);
    let guard = 0, spread = 900; // 30 units apart; relaxes if the city is tiny
    while (spots.length < GATES && guard++ < 8000) {
      if (guard % 2000 === 0) spread /= 2;
      const r = Math.random() * total;
      const d = plates[cum.findIndex(c => c >= r)];
      if (!d || d.w < 6 || d.d < 6) continue;
      const x = d.x + 2 + Math.random() * (d.w - 4), z = d.z + 2 + Math.random() * (d.d - 4);
      if (city.buildings.some(b => Math.abs(x - b.x) < b.w / 2 + 2.2 && Math.abs(z - b.z) < b.d / 2 + 2.2)) continue;
      if (spots.some(s => (s.x - x) ** 2 + (s.z - z) ** 2 < spread)) continue;
      spots.push({ x, z, y: 0.12 + d.depth * 0.1 });
    }
    // circuit order: sweep around the center starting from the spawn side
    const a0 = Math.atan2(138, 0);
    spots.sort((a, b) =>
      ((Math.atan2(a.z, a.x) - a0 + Math.PI * 4) % (Math.PI * 2)) -
      ((Math.atan2(b.z, b.x) - a0 + Math.PI * 4) % (Math.PI * 2)));
    // each gate faces the way you drive through it
    spots.forEach((s, i) => {
      const p = i ? spots[i - 1] : { x: 0, z: 138 };
      s.yaw = Math.atan2(s.x - p.x, s.z - p.z);
    });
  }

  const gates = new THREE.InstancedMesh(
    new THREE.TorusGeometry(3, .28, 10, 32),
    new THREE.MeshBasicMaterial({ toneMapped: false }), // bright unlit rings — bloom does the glow
    spots.length);
  gates.visible = false;
  scene.add(gates);
  const NEXT = new THREE.Color(2.2, 4, 2.8).multiplyScalar(.5); // hot green, feeds the bloom
  const AHEAD = new THREE.Color(0x8a6b2f), DONE = new THREE.Color(0x232830);

  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(.5, .5, 70, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x7ee0a3, transparent: true, opacity: .3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  beacon.visible = false;
  scene.add(beacon);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const r = { active: false, next: 0, t: 0 };

  function drawHUD() {
    gatesEl.textContent = `${r.next}/${spots.length}`;
    timeEl.textContent = fmt(r.t);
    const best = +localStorage.getItem(bestKey);
    bestEl.textContent = best ? `best ${fmt(best)}` : 'first run';
  }

  function start() {
    onBeforeStart?.();
    Object.assign(r, { active: true, next: 0, t: 0 });
    carRig.car.pos.set(0, 0, 138);
    carRig.car.heading = Math.PI;
    carRig.car.speed = 0;
    gates.visible = beacon.visible = true;
    hud.classList.add('show');
    over.classList.remove('show');
    raceBtn.classList.add('on');
    drawHUD();
  }
  function stop() {
    r.active = false;
    gates.visible = beacon.visible = false;
    hud.classList.remove('show');
    over.classList.remove('show');
    raceBtn.classList.remove('on');
  }
  function finish() {
    r.active = false;
    beacon.visible = false;
    const best = +localStorage.getItem(bestKey);
    const record = !best || r.t < best;
    if (record) localStorage.setItem(bestKey, r.t);
    titleEl.textContent = record ? 'NEW RECORD 🏁' : 'FINISH 🏁';
    statsEl.textContent = `${spots.length} gates in ${fmt(r.t)}` + (record && best ? ` — beat ${fmt(best)}` : best ? ` — best is ${fmt(best)}` : '');
    document.getElementById('gRetry').onclick = start;
    document.getElementById('gQuit').onclick = stop;
    over.classList.add('show');
    winSnd();
  }

  if (spots.length < 3) raceBtn.style.display = 'none'; // no room for a circuit
  raceBtn.onclick = () => (r.active || over.classList.contains('show')) ? stop() : start();

  // called from the drive branch of the main loop
  function update(dt, t) {
    if (!gates.visible) return;
    if (r.active) {
      r.t += dt;
      const cp = carRig.car.pos, s = spots[r.next];
      if ((cp.x - s.x) ** 2 + (cp.z - s.z) ** 2 < 16) {
        r.next++;
        coinSnd();
        if (r.next === spots.length) finish();
      }
      drawHUD();
    }
    spots.forEach((s, i) => {
      const isNext = r.active && i === r.next;
      const k = isNext ? 1 + Math.sin(t * 5) * .08 : 1;
      q.setFromEuler(e.set(0, s.yaw, 0));
      m.compose(v.set(s.x, s.y + 2.4, s.z), q, sc.set(k, k, k));
      gates.setMatrixAt(i, m);
      gates.setColorAt(i, isNext ? NEXT : i < r.next && r.active ? DONE : AHEAD);
    });
    gates.instanceMatrix.needsUpdate = true;
    gates.instanceColor.needsUpdate = true;
    if (r.active) beacon.position.set(spots[r.next]?.x ?? 0, 35, spots[r.next]?.z ?? 0);
  }

  return { update, stop, get active() { return r.active; } };
}
