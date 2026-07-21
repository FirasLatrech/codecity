// Static city geometry: district plates, buildings, hot beacons, street names, entrance, trees.
// Layout math lives in analyze.mjs — this only renders what city.json says.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { hashCode } from './faces.js';

const PALETTE = {
  '.js': 0xf1c40f, '.mjs': 0xf1c40f, '.cjs': 0xf1c40f, '.ts': 0x3178c6, '.jsx': 0x61dafb, '.tsx': 0x61dafb,
  '.css': 0x2965f1, '.scss': 0xcd6799, '.html': 0xe34f26, '.json': 0x6fbf73, '.md': 0x8b98a9,
  '.py': 0x4b8bbe, '.rs': 0xdea584, '.go': 0x00add8, '.java': 0xb07219, '.rb': 0xcc342d,
  '.c': 0x9db4c0, '.h': 0x9db4c0, '.cpp': 0xf34b7d, '.php': 0x777bb3, '.swift': 0xf05138,
  '.dart': 0x00b4ab, '.vue': 0x41b883, '.svelte': 0xff3e00, '.yml': 0xcb6c4d, '.yaml': 0xcb6c4d,
};
export const extColor = ext => new THREE.Color(PALETTE[ext] ??
  new THREE.Color().setHSL((hashCode(ext || '?') % 20) / 20, .45, .55).getHex());

const depthOf = p => p.split('/').length - 1;
export const baseY = b => 0.12 + depthOf(b.path) * 0.1;

export function textPlane(text, maxW, color = 'rgba(230,237,243,.5)') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  let size = 68;
  g.font = `700 ${size}px ui-monospace, monospace`;
  while (g.measureText(text).width > 480 && size > 18) { size -= 4; g.font = `700 ${size}px ui-monospace, monospace`; }
  g.fillStyle = color;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 66);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8; // ground labels are read at grazing angles
  const w = Math.min(maxW, Math.max(6, text.length * 1.1));
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4),
    new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  p.rotation.x = -Math.PI / 2;
  return p;
}

export function buildCity(scene, city) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const roundedBox = new RoundedBoxGeometry(1, 1, 1, 3, 0.07);
  const m = new THREE.Matrix4();

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200),
    new THREE.MeshStandardMaterial({ color: 0x0e1219, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const plates = new THREE.InstancedMesh(box,
    new THREE.MeshStandardMaterial({ roughness: 0.95 }), city.districts.length);
  city.districts.forEach((d, i) => {
    const y = 0.12 + d.depth * 0.1;
    m.compose(new THREE.Vector3(d.x + d.w / 2, y / 2, d.z + d.d / 2), new THREE.Quaternion(), new THREE.Vector3(d.w, y, d.d));
    plates.setMatrixAt(i, m);
    plates.setColorAt(i, new THREE.Color().setHSL(0.6, 0.15, 0.09 + Math.min(d.depth, 6) * 0.02));
  });
  plates.receiveShadow = true;
  scene.add(plates);

  const groundY = (x, z) => {
    let top = 0;
    for (const d of city.districts)
      if (x >= d.x && x <= d.x + d.w && z >= d.z && z <= d.z + d.d) top = Math.max(top, 0.12 + d.depth * 0.1);
    return top;
  };

  // street names
  for (const d of city.districts) {
    if (d.depth === 0 || d.depth > 2 || d.w < 7) continue;
    if (d.depth === 2 && d.w * d.d < 500) continue;
    const label = textPlane(d.name.split('/').at(-1), d.w * 0.85);
    label.position.set(d.x + d.w / 2, 0.13 + d.depth * 0.1, d.z + d.d - label.geometry.parameters.height / 2 - 0.6);
    scene.add(label);
  }

  // entrance road with center dashes, leading into the city
  {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 1024;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(42,50,64,.5)'; g.fillRect(0, 0, 128, 1024);
    g.fillStyle = 'rgba(230,237,243,.4)';
    for (let y = 10; y < 1024; y += 74) g.fillRect(60, y, 8, 40);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(7, 44),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.015, 122);
    scene.add(road);

    const title = textPlane(city.name.toUpperCase(), 34, 'rgba(230,237,243,.85)');
    title.position.set(0, 0.03, 103);
    scene.add(title);
    const hint = textPlane('WASD · ZQSD · ARROWS — SHIFT boost · E read file · C change car', 30, 'rgba(230,237,243,.7)');
    hint.position.set(0, 0.03, 131);
    scene.add(hint);
  }

  // buildings: one clean mesh + tiny rooftop lamps on hot files
  const sortedCommits = city.buildings.map(b => b.commits || 0).sort((a, b) => a - b);
  const HOT = Math.max(3, sortedCommits[Math.floor(sortedCommits.length * 0.9)] || 0);
  const hotB = city.buildings.filter(b => (b.commits || 0) >= HOT);

  const buildingsMesh = new THREE.InstancedMesh(roundedBox,
    new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.12 }), city.buildings.length);
  city.buildings.forEach((b, i) => {
    m.compose(new THREE.Vector3(b.x, baseY(b) + b.h / 2, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w, b.h, b.d));
    buildingsMesh.setMatrixAt(i, m);
    buildingsMesh.setColorAt(i, extColor(b.ext));
    b._i = i;
  });
  buildingsMesh.castShadow = buildingsMesh.receiveShadow = true;
  scene.add(buildingsMesh);

  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x281c0c, emissive: 0xffb45e, emissiveIntensity: 2.6 });
  const beacons = new THREE.InstancedMesh(box, beaconMat, hotB.length);
  hotB.forEach((b, i) => {
    const s = Math.min(0.55, Math.max(0.3, Math.min(b.w, b.d) * 0.25));
    m.compose(new THREE.Vector3(b.x, baseY(b) + b.h + s / 2 + 0.02, b.z), new THREE.Quaternion(), new THREE.Vector3(s, s * 0.7, s));
    beacons.setMatrixAt(i, m);
  });
  scene.add(beacons);

  // trees on the outskirts
  {
    const N = 140;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(.25, .38, 1.6, 6),
      new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 1 }), N);
    const leaf = new THREE.InstancedMesh(new THREE.ConeGeometry(1.7, 3.6, 7),
      new THREE.MeshStandardMaterial({ roughness: 1 }), N);
    for (let i = 0; i < N; i++) {
      const r = 155 + Math.random() * 120, a = Math.random() * Math.PI * 2, s = 0.7 + Math.random();
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) < 12 && z > 95) continue; // keep the entrance road clear
      m.compose(new THREE.Vector3(x, 0.8 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      trunk.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, 3.4 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      leaf.setMatrixAt(i, m);
      leaf.setColorAt(i, new THREE.Color().setHSL(0.36 + Math.random() * 0.06, 0.5, 0.22 + Math.random() * 0.12));
    }
    scene.add(trunk, leaf);
  }

  return { buildingsMesh, beaconMat, HOT, groundY };
}
