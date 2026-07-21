// Author face sprites: drawn cartoon face immediately, real avatar swaps in when the URL loads.
import * as THREE from 'three';

export const hashCode = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

const faceCache = new Map();
export function face(name, url) {
  if (faceCache.has(name)) return faceCache.get(name);
  const c = document.createElement('canvas');
  c.width = 128; c.height = 176;
  const g = c.getContext('2d');
  const drawAll = img => {
    g.clearRect(0, 0, 128, 176);
    g.save();
    g.beginPath(); g.arc(64, 64, 58, 0, 7); g.clip();
    if (img) g.drawImage(img, 0, 0, 128, 128);
    else {
      g.fillStyle = `hsl(${hashCode(name) % 360} 55% 62%)`; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#20242c';
      g.beginPath(); g.arc(44, 56, 6.5, 0, 7); g.arc(84, 56, 6.5, 0, 7); g.fill();
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(46, 54, 2.2, 0, 7); g.arc(86, 54, 2.2, 0, 7); g.fill();
      g.strokeStyle = '#20242c'; g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath(); g.arc(64, 74, 17, Math.PI * 0.18, Math.PI * 0.82); g.stroke();
      g.fillStyle = 'rgba(255,120,120,.35)';
      g.beginPath(); g.arc(34, 74, 8, 0, 7); g.arc(94, 74, 8, 0, 7); g.fill();
    }
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 5;
    g.beginPath(); g.arc(64, 64, 58, 0, 7); g.stroke();
    const label = name.length > 14 ? name.slice(0, 13) + '…' : name;
    g.font = '700 19px ui-monospace, monospace';
    const pw = Math.min(124, g.measureText(label).width + 20);
    g.fillStyle = 'rgba(10,14,20,.9)';
    g.beginPath(); g.roundRect((128 - pw) / 2, 136, pw, 30, 9); g.fill();
    g.fillStyle = '#e6edf3'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, 64, 152);
  };
  drawAll(null);
  const tex = new THREE.CanvasTexture(c);
  const entry = { tex, url: c.toDataURL() };
  if (url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { drawAll(img); tex.needsUpdate = true; entry.url = c.toDataURL(); };
    img.src = url;
  }
  faceCache.set(name, entry);
  return entry;
}

export const faceSprite = (name, url, h) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: face(name, url).tex, transparent: true }));
  s.scale.set(h * 0.727, h, 1); // canvas is 128x176
  return s;
};
