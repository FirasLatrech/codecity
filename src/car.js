// The arcade car: mesh, physics step, collision, chase cam.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { thump } from './audio.js';

export function createCar(scene) {
  const car = { pos: new THREE.Vector3(0, 0, 138), heading: Math.PI, speed: 0, steer: 0 };
  const group = new THREE.Group();
  const wheels = [];
  const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: .5, metalness: .1 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(1.8, .55, 3.2, 3, .12), mat(0xd7443e));
  body.position.y = .62;
  const nose = new THREE.Mesh(new RoundedBoxGeometry(1.6, .3, .8, 3, .1), mat(0xd7443e));
  nose.position.set(0, .5, 1.9);
  const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.5, .5, 1.5, 3, .12), mat(0xe8e6df));
  cabin.position.set(0, 1.1, -.25);
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff6d5, emissive: 0xffedb0, emissiveIntensity: 3 });
  const lampL = new THREE.Mesh(new THREE.BoxGeometry(.28, .16, .1), lightMat); lampL.position.set(-.55, .62, 2.3);
  const lampR = lampL.clone(); lampR.position.x = .55;
  const glow = new THREE.PointLight(0xffddaa, 40, 30, 2); glow.position.set(0, .9, 2.4);
  const wheelGeo = new THREE.CylinderGeometry(.38, .38, .32, 12); wheelGeo.rotateZ(Math.PI / 2);
  for (const [x, z] of [[-.85, 1.05], [.85, 1.05], [-.85, -1.1], [.85, -1.1]]) {
    const w = new THREE.Mesh(wheelGeo, mat(0x14171e));
    w.position.set(x, .38, z);
    wheels.push(w); group.add(w);
  }
  for (const p of [body, nose, cabin]) p.castShadow = true;
  group.add(body, nose, cabin, lampL, lampR, glow);
  scene.add(group);
  return { car, group, wheels };
}

const R = 1.2;
const blocked = (buildings, x, z) => {
  if (Math.abs(x) > 285 || Math.abs(z) > 285) return true;
  for (const b of buildings)
    if (Math.abs(x - b.x) < b.w / 2 + R && Math.abs(z - b.z) < b.d / 2 + R) return true;
  return false;
};

// Advances the car one frame and steers the chase cam. Returns the nearest building (or null).
export function driveStep(dt, { car, group, wheels }, keys, camera, buildings, groundY) {
  const accel = (keys.f ? 26 : 0) - (keys.b ? 20 : 0);
  car.speed += accel * (keys.boost ? 1.9 : 1) * dt;
  car.speed -= car.speed * 1.6 * dt;
  if (!accel && Math.abs(car.speed) < 0.15) car.speed = 0;
  car.speed = Math.max(-14, Math.min(keys.boost ? 55 : 34, car.speed));
  const steerIn = (keys.l ? 1 : 0) - (keys.r ? 1 : 0);
  car.steer += (steerIn * 0.42 - car.steer) * Math.min(1, dt * 8);
  car.heading += car.steer * 4.4 * dt * Math.min(1, Math.abs(car.speed) / 10) * Math.sign(car.speed);

  const dir = new THREE.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading));
  const nx = car.pos.x + dir.x * car.speed * dt, nz = car.pos.z + dir.z * car.speed * dt;
  if (!blocked(buildings, nx, nz)) { car.pos.x = nx; car.pos.z = nz; }
  else if (!blocked(buildings, nx, car.pos.z)) { car.pos.x = nx; car.speed *= 0.7; }
  else if (!blocked(buildings, car.pos.x, nz)) { car.pos.z = nz; car.speed *= 0.7; }
  else { thump(Math.abs(car.speed)); car.speed *= -0.25; }

  car.pos.y += (groundY(car.pos.x, car.pos.z) - car.pos.y) * Math.min(1, dt * 10);
  group.position.copy(car.pos);
  group.rotation.y = car.heading;
  for (let i = 0; i < 4; i++) {
    wheels[i].rotation.x += car.speed * dt / 0.38;
    if (i < 2) wheels[i].rotation.y = car.steer * 1.2;
  }

  const camPos = new THREE.Vector3(car.pos.x - dir.x * 9.5, car.pos.y + 4.6, car.pos.z - dir.z * 9.5);
  camera.position.lerp(camPos, 1 - Math.exp(-dt * 3));
  camera.lookAt(car.pos.x + dir.x * 7, car.pos.y + 1.6, car.pos.z + dir.z * 7);

  let best = null, bd = 64;
  for (const b of buildings) {
    const dx = Math.max(Math.abs(car.pos.x - b.x) - b.w / 2, 0);
    const dz = Math.max(Math.abs(car.pos.z - b.z) - b.d / 2, 0);
    const d2 = dx * dx + dz * dz;
    if (d2 < bd) { bd = d2; best = b; }
  }
  return best;
}
