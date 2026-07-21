// Smooth synthwave bed → stereo 16-bit WAV. Warm filtered pads that crossfade between
// chords, a legato bass, sparse half-time kick, a soft bell arp, and a Schroeder reverb
// tail for space. Everything additive; reverb + master low-pass do the smoothing.
import { writeFileSync } from 'node:fs';

const SR = 44100;
const DUR = +process.argv[2] || 26.4;
const N = Math.ceil(DUR * SR);
const L = new Float32Array(N), R = new Float32Array(N);

const TAU = Math.PI * 2;
// warm tone: fundamental + gently rolled-off harmonics (no harsh saw)
const warm = (f, t) => Math.sin(TAU * f * t) + 0.28 * Math.sin(TAU * 2 * f * t)
  + 0.12 * Math.sin(TAU * 3 * f * t) + 0.05 * Math.sin(TAU * 4 * f * t);
const sine = (f, t) => Math.sin(TAU * f * t);

let seed = 22;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

// add a mono voice into L/R with a stereo pan (-1..1)
function add(tStart, dur, vol, pan, fn) {
  const i0 = Math.max(0, Math.floor(tStart * SR)), i1 = Math.min(N, Math.ceil((tStart + dur) * SR));
  const gl = vol * Math.cos((pan + 1) * Math.PI / 4), gr = vol * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = i0; i < i1; i++) {
    const s = fn((i - i0) / SR);
    L[i] += s * gl; R[i] += s * gr;
  }
}
// long attack/release so consecutive chords crossfade seamlessly
const pad = (f, tS, dur, pan) => add(tS, dur, 0.12, pan, tl => {
  const env = Math.min(1, tl / 1.0, (dur - tl) / 1.3);
  return warm(f, tl) * Math.max(0, env);
});
// legato bass: one soft note per chord, gentle attack/release
const bass = (f, tS, dur) => add(tS, dur, 0.34, 0, tl => {
  const env = Math.min(1, tl / 0.15, (dur - tl) / 0.4);
  return (Math.sin(TAU * f * tl) + 0.25 * Math.sin(TAU * 2 * f * tl)) * Math.max(0, env);
});
// soft bell arp — sine with slow-ish attack, panned, quiet
const bell = (f, tS, pan) => add(tS, 1.1, 0.05, pan, tl =>
  sine(f, tl) * Math.min(1, tl / 0.03) * Math.exp(-tl * 2.6));
// soft kick, half-time
const kick = tS => add(tS, 0.28, 0.7, 0, tl =>
  Math.sin(TAU * (42 + 70 * Math.exp(-tl * 14)) * tl) * Math.exp(-tl * 7));

const beat = 0.6, chordDur = beat * 4; // 100 BPM
// Am7 – Fmaj7 – Cmaj7 – G: [bassRoot, [voiced tones]]
const prog = [
  [110.00, [220.00, 261.63, 329.63, 392.00]],
  [87.31, [174.61, 261.63, 329.63, 440.00]],
  [130.81, [261.63, 329.63, 392.00, 493.88]],
  [98.00, [196.00, 293.66, 392.00, 440.00]],
];

let t = 0, ci = 0;
while (t < DUR) {
  const [root, tones] = prog[ci++ % prog.length];
  // pads overlap the next chord by the release tail → crossfade
  tones.forEach((f, k) => pad(f, t, chordDur + 0.5, (k / (tones.length - 1)) * 1.4 - 0.7));
  bass(root, t, chordDur + 0.2);
  kick(t); kick(t + beat * 2);               // beats 1 & 3 only
  // a couple of soft bells drifting across the bar
  bell(tones[3] * 2, t + beat * 0.5, 0.5);
  bell(tones[1] * 2, t + beat * 2.5, -0.5);
  t += chordDur;
}

// --- Schroeder reverb on a mono send, added back wet for space/smoothness ---
function comb(buf, delay, g) {
  const out = new Float32Array(buf.length), d = Math.floor(delay * SR);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] + (i >= d ? g * out[i - d] : 0);
  return out;
}
function allpass(buf, delay, g) {
  const out = new Float32Array(buf.length), d = Math.floor(delay * SR);
  for (let i = 0; i < buf.length; i++) {
    const yd = i >= d ? out[i - d] : 0, xd = i >= d ? buf[i - d] : 0;
    out[i] = -g * buf[i] + xd + g * yd;
  }
  return out;
}
function reverb(buf) {
  const c = [comb(buf, .0297, .78), comb(buf, .0371, .76), comb(buf, .0411, .74), comb(buf, .0437, .72)];
  let wet = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) wet[i] = (c[0][i] + c[1][i] + c[2][i] + c[3][i]) * 0.25;
  wet = allpass(wet, .0050, .7);
  wet = allpass(wet, .0017, .7);
  return wet;
}
const mono = new Float32Array(N);
for (let i = 0; i < N; i++) mono[i] = (L[i] + R[i]) * 0.5;
const wet = reverb(mono);
const wetMix = 0.32;
for (let i = 0; i < N; i++) { L[i] += wet[i] * wetMix; R[i] += wet[i] * wetMix; }

// --- master: gentle one-pole low-pass (smooths highs), fades, soft limiter ---
const a = 0.30; // low-pass coefficient (lower = darker/smoother)
let yl = 0, yr = 0;
const fadeIn = 1.2, fadeOut = 2.0, peak = 0.62;
for (let i = 0; i < N; i++) {
  yl += (L[i] - yl) * a; yr += (R[i] - yr) * a;
  const ts = i / SR;
  let g = peak;
  if (ts < fadeIn) g *= ts / fadeIn;
  if (ts > DUR - fadeOut) g *= Math.max(0, (DUR - ts) / fadeOut);
  L[i] = Math.tanh(yl * g); R[i] = Math.tanh(yr * g);
}

// --- write 16-bit stereo WAV ---
const bytes = Buffer.alloc(44 + N * 4);
bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + N * 4, 4); bytes.write('WAVE', 8);
bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
bytes.writeUInt16LE(2, 22); bytes.writeUInt32LE(SR, 24); bytes.writeUInt32LE(SR * 4, 28);
bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34);
bytes.write('data', 36); bytes.writeUInt32LE(N * 4, 40);
let p = 44;
for (let i = 0; i < N; i++) {
  bytes.writeInt16LE(Math.max(-32768, Math.min(32767, L[i] * 32767)), p); p += 2;
  bytes.writeInt16LE(Math.max(-32768, Math.min(32767, R[i] * 32767)), p); p += 2;
}
writeFileSync('/private/tmp/claude-501/-Users-firaslatrach-Desktop-CodeCity/36cf2fbb-81c1-4028-a71a-6016f471d337/scratchpad/music.wav', bytes);
console.log(`music.wav: ${DUR}s stereo, ${N} samples`);
