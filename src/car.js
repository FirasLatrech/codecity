// The garage: three arcade cars, each with its own body, handling, and engine voice.
// Physics step + chase cam live here too.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { thump } from './audio.js';

const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: .5, metalness: .1 });
const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6d5, emissive: 0xffedb0, emissiveIntensity: 3 });

function lamps(group, y, z, spread = 0.55) {
  const l = new THREE.Mesh(new THREE.BoxGeometry(.28, .16, .1), lampMat);
  l.position.set(-spread, y, z);
  const r = l.clone(); r.position.x = spread;
  const glow = new THREE.PointLight(0xffddaa, 40, 30, 2);
  glow.position.set(0, y + .3, z + .1);
  group.add(l, r, glow);
}

function addWheels(group, positions, radius, width) {
  const geo = new THREE.CylinderGeometry(radius, radius, width, 12);
  geo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [x, z] of positions) {
    const w = new THREE.Mesh(geo, mat(0x14171e));
    w.position.set(x, radius, z);
    wheels.push(w); group.add(w);
  }
  return wheels;
}

export const CARS = [
  {
    name: 'coupe', emoji: '🚗',
    spec: { accel: 26, brake: 20, top: 34, boostTop: 55, rev: -14, steer: 4.4 },
    // friendly four-cylinder: mid pitch, mild growl, everyday gearbox
    engine: { type1: 'sawtooth', type2: 'square', f1: 55, ratio: 2, lp: 520, drive: 0.35, vol: 1, gears: [10, 19, 30, 46] },
    build(group) {
      const body = new THREE.Mesh(new RoundedBoxGeometry(1.8, .55, 3.2, 3, .12), mat(0xd7443e));
      body.position.y = .62;
      const nose = new THREE.Mesh(new RoundedBoxGeometry(1.6, .3, .8, 3, .1), mat(0xd7443e));
      nose.position.set(0, .5, 1.9);
      const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.5, .5, 1.5, 3, .12), mat(0xe8e6df));
      cabin.position.set(0, 1.1, -.25);
      group.add(body, nose, cabin);
      lamps(group, .62, 2.3);
      return addWheels(group, [[-.85, 1.05], [.85, 1.05], [-.85, -1.1], [.85, -1.1]], .38, .32);
    },
  },
  {
    name: 'racer', emoji: '🏎️',
    spec: { accel: 38, brake: 24, top: 46, boostTop: 72, rev: -14, steer: 5.2 },
    // high-strung race engine: screams high, hard distortion, long gears
    engine: { type1: 'sawtooth', type2: 'sawtooth', f1: 92, ratio: 1.5, lp: 1250, drive: 0.55, vol: 0.9, gears: [14, 26, 41, 62] },
    build(group) {
      const body = new THREE.Mesh(new RoundedBoxGeometry(1.9, .4, 3.4, 3, .12), mat(0xf5b301));
      body.position.y = .5;
      const nose = new THREE.Mesh(new RoundedBoxGeometry(1.3, .24, 1.1, 3, .1), mat(0xf5b301));
      nose.position.set(0, .44, 2.1);
      const cockpit = new THREE.Mesh(new RoundedBoxGeometry(1.0, .38, 1.2, 3, .12), mat(0x1b2330));
      cockpit.position.set(0, .82, -.1);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.9, .08, .5), mat(0x1b2330));
      wing.position.set(0, 1.02, -1.62);
      const strutL = new THREE.Mesh(new THREE.BoxGeometry(.08, .34, .08), mat(0x1b2330));
      strutL.position.set(-.6, .82, -1.62);
      const strutR = strutL.clone(); strutR.position.x = .6;
      group.add(body, nose, cockpit, wing, strutL, strutR);
      lamps(group, .5, 2.55, .45);
      return addWheels(group, [[-.9, 1.15], [.9, 1.15], [-.9, -1.15], [.9, -1.15]], .36, .42);
    },
  },
  {
    name: 'truck', emoji: '🚚',
    spec: { accel: 15, brake: 14, top: 24, boostTop: 38, rev: -9, steer: 3.1 },
    // big diesel: low chug, short gears that shift early, extra loud
    engine: { type1: 'square', type2: 'sawtooth', f1: 30, ratio: 1.5, lp: 300, drive: 0.3, vol: 1.35, gears: [7, 14, 22, 34] },
    build(group) {
      const cab = new THREE.Mesh(new RoundedBoxGeometry(1.9, 1.15, 1.4, 3, .14), mat(0x3a7bd5));
      cab.position.set(0, 1.02, 1.35);
      const screen = new THREE.Mesh(new RoundedBoxGeometry(1.7, .5, .1, 3, .04), mat(0x1b2330));
      screen.position.set(0, 1.28, 2.03);
      const cargo = new THREE.Mesh(new RoundedBoxGeometry(2.0, 1.5, 3.0, 3, .08), mat(0xcfd6dd));
      cargo.position.set(0, 1.2, -.9);
      group.add(cab, screen, cargo);
      lamps(group, .6, 2.05, .65);
      return addWheels(group, [[-.9, 1.35], [.9, 1.35], [-.9, -1.5], [.9, -1.5]], .45, .36);
    },
  },
];

// Cheap fake shadow: the real shadow map is baked once for the static city, so the
// car carries a soft dark ellipse instead of triggering a shadow pass every frame.
function blobShadow() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 10, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 5.6),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  m.renderOrder = 1;
  return m;
}

// All bodies are built once up front — switching cars is just a visibility flip,
// so it never hitches and never leaks geometries.
export function createCar(scene, idx = 0) {
  const rig = {
    car: { pos: new THREE.Vector3(0, 0, 138), heading: Math.PI, speed: 0, steer: 0 },
    groups: [], wheelsAll: [], group: null, wheels: [], idx: 0, type: CARS[0],
  };
  for (const c of CARS) {
    const g = new THREE.Group();
    g.visible = false;
    scene.add(g);
    rig.groups.push(g);
    rig.wheelsAll.push(c.build(g));
    g.add(blobShadow());
  }
  setCarType(rig, idx);
  return rig;
}

// swap bodies in place — position/heading/speed survive the trade-in
export function setCarType(rig, idx) {
  if (rig.group) rig.group.visible = false;
  rig.idx = (idx + CARS.length) % CARS.length;
  rig.type = CARS[rig.idx];
  rig.group = rig.groups[rig.idx];
  rig.wheels = rig.wheelsAll[rig.idx];
  rig.group.position.copy(rig.car.pos);
  rig.group.rotation.y = rig.car.heading;
  rig.group.visible = true;
}

const R = 1.2;
const blocked = (buildings, x, z) => {
  if (Math.abs(x) > 285 || Math.abs(z) > 285) return true;
  for (const b of buildings)
    if (Math.abs(x - b.x) < b.w / 2 + R && Math.abs(z - b.z) < b.d / 2 + R) return true;
  return false;
};

const _dir = new THREE.Vector3(), _camPos = new THREE.Vector3(), _look = new THREE.Vector3();

// Advances the car one frame and steers the chase cam. Returns the nearest building (or null).
export function driveStep(dt, rig, keys, camera, buildings, groundY) {
  const { car, group, wheels } = rig, spec = rig.type.spec;
  const accel = (keys.f ? spec.accel : 0) - (keys.b ? spec.brake : 0);
  car.speed += accel * (keys.boost ? 1.9 : 1) * dt;
  car.speed -= car.speed * 1.6 * dt;
  if (!accel && Math.abs(car.speed) < 0.15) car.speed = 0;
  car.speed = Math.max(spec.rev, Math.min(keys.boost ? spec.boostTop : spec.top, car.speed));
  const steerIn = (keys.l ? 1 : 0) - (keys.r ? 1 : 0);
  car.steer += (steerIn * 0.42 - car.steer) * Math.min(1, dt * 8);
  car.heading += car.steer * spec.steer * dt * Math.min(1, Math.abs(car.speed) / 10) * Math.sign(car.speed);

  const dir = _dir.set(Math.sin(car.heading), 0, Math.cos(car.heading));
  const nx = car.pos.x + dir.x * car.speed * dt, nz = car.pos.z + dir.z * car.speed * dt;
  if (!blocked(buildings, nx, nz)) { car.pos.x = nx; car.pos.z = nz; }
  else {
    // any contact at real speed is a crash (game mode reads rig.hit); slow nudges are free
    const v = Math.abs(car.speed);
    thump(v);
    if (v > 6) rig.hit = true;
    if (!blocked(buildings, nx, car.pos.z)) { car.pos.x = nx; car.speed *= 0.7; }
    else if (!blocked(buildings, car.pos.x, nz)) { car.pos.z = nz; car.speed *= 0.7; }
    else car.speed *= -0.25;
  }

  car.pos.y += (groundY(car.pos.x, car.pos.z) - car.pos.y) * Math.min(1, dt * 10);
  group.position.copy(car.pos);
  group.rotation.y = car.heading;
  const wr = wheels[0].geometry.parameters.radiusTop;
  for (let i = 0; i < wheels.length; i++) {
    wheels[i].rotation.x += car.speed * dt / wr;
    if (i < 2) wheels[i].rotation.y = car.steer * 1.2;
  }

  _camPos.set(car.pos.x - dir.x * 9.5, car.pos.y + 4.6, car.pos.z - dir.z * 9.5);
  camera.position.lerp(_camPos, 1 - Math.exp(-dt * 3));
  camera.lookAt(_look.set(car.pos.x + dir.x * 7, car.pos.y + 1.6, car.pos.z + dir.z * 7));

  let best = null, bd = 64;
  for (const b of buildings) {
    const dx = Math.max(Math.abs(car.pos.x - b.x) - b.w / 2, 0);
    const dz = Math.max(Math.abs(car.pos.z - b.z) - b.d / 2, 0);
    const d2 = dx * dx + dz * dz;
    if (d2 < bd) { bd = d2; best = b; }
  }
  return best;
}
