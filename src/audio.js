// Everything synthesized, no audio files. The engine is a small virtual gearbox:
// two oscillators through a soft-clip waveshaper (growl) into a lowpass, pitch
// driven by RPM that climbs within each gear and drops on shifts — that shift
// pattern is what makes it read as a real engine instead of a drone. A looping
// noise bed fades in with speed for wind/road, and collisions are a sine pitch-drop
// thud plus a noise burst. Per-car character comes from the engine profile.
export const audio = {
  ctx: null, muted: false,
  profile: { type1: 'sawtooth', type2: 'square', f1: 55, ratio: 2, lp: 520, drive: 0.35, vol: 1, gears: [10, 19, 30, 46] },
};

function shaperCurve(drive) {
  const n = 256, c = new Float32Array(n), k = 1 + drive * 12;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}

// swap the engine voice (car change) — live if the context is already running
export function setEngineProfile(p) {
  audio.profile = p;
  if (!audio.ctx) return;
  audio.osc.type = p.type1;
  audio.osc2.type = p.type2;
  audio.lp.frequency.value = p.lp;
  audio.shaper.curve = shaperCurve(p.drive);
}

export function initAudio() {
  if (audio.ctx || audio.muted) return;
  const ctx = audio.ctx = new AudioContext();
  const p = audio.profile;
  const master = audio.master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  // engine: osc pair -> soft clip -> lowpass -> gain
  const osc = audio.osc = ctx.createOscillator(); osc.type = p.type1; osc.frequency.value = p.f1;
  const osc2 = audio.osc2 = ctx.createOscillator(); osc2.type = p.type2; osc2.frequency.value = p.f1 * p.ratio;
  const g2 = ctx.createGain(); g2.gain.value = 0.5;
  const shaper = audio.shaper = ctx.createWaveShaper(); shaper.curve = shaperCurve(p.drive); shaper.oversample = '2x';
  const lp = audio.lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = p.lp; lp.Q.value = 0.8;
  const eg = audio.engineGain = ctx.createGain(); eg.gain.value = 0;
  osc.connect(shaper); osc2.connect(g2); g2.connect(shaper);
  shaper.connect(lp); lp.connect(eg); eg.connect(master);
  osc.start(); osc2.start();

  // shared white-noise buffer (wind loop + collision bursts)
  const len = ctx.sampleRate, buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  audio.noise = buf;

  // wind/road noise rises with speed²
  const wind = ctx.createBufferSource(); wind.buffer = buf; wind.loop = true;
  const wlp = ctx.createBiquadFilter(); wlp.type = 'lowpass'; wlp.frequency.value = 650;
  const wg = audio.windGain = ctx.createGain(); wg.gain.value = 0;
  wind.connect(wlp); wlp.connect(wg); wg.connect(master);
  wind.start();
}

let lastThump = 0;
export function thump(v) {
  if (!audio.ctx || audio.muted || audio.ctx.currentTime - lastThump < 0.15) return;
  const ctx = audio.ctx, t0 = lastThump = ctx.currentTime;
  // body: low sine dropping in pitch — the "thud"
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(95, t0);
  o.frequency.exponentialRampToValueAtTime(30, t0 + 0.22);
  const og = ctx.createGain();
  og.gain.setValueAtTime(Math.min(0.5, 0.1 + v * 0.013), t0);
  og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
  o.connect(og).connect(audio.master);
  o.start(t0); o.stop(t0 + 0.3);
  // debris: filtered noise burst
  const s = ctx.createBufferSource(); s.buffer = audio.noise;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 340;
  const g = ctx.createGain();
  g.gain.setValueAtTime(Math.min(0.35, 0.06 + v * 0.01), t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
  s.connect(lp).connect(g).connect(audio.master);
  s.start(t0); s.stop(t0 + 0.25);
}

let lastChime = 0;
export function chime() {
  if (!audio.ctx || audio.muted || audio.ctx.currentTime - lastChime < 0.3) return;
  lastChime = audio.ctx.currentTime;
  const ctx = audio.ctx, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(740, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(1170, ctx.currentTime + 0.09);
  g.gain.setValueAtTime(0.03, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
  o.connect(g); g.connect(audio.master);
  o.start(); o.stop(ctx.currentTime + 0.25);
}

// tiny sequenced-note player for the game jingles: [freq, startOffset, duration][]
function notes(seq, type, vol) {
  if (!audio.ctx || audio.muted) return;
  const ctx = audio.ctx;
  for (const [f, t0, d] of seq) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    const T = ctx.currentTime + t0;
    g.gain.setValueAtTime(vol, T);
    g.gain.exponentialRampToValueAtTime(0.0001, T + d);
    o.connect(g); g.connect(audio.master);
    o.start(T); o.stop(T + d + 0.02);
  }
}
export const coinSnd = () => notes([[988, 0, .09], [1319, .08, .2]], 'square', .04);
export const hurtSnd = () => notes([[196, 0, .18], [131, .09, .28]], 'sawtooth', .07);
export const winSnd = () => notes([[523, 0, .15], [659, .12, .15], [784, .24, .15], [1047, .36, .5]], 'square', .05);
export const loseSnd = () => notes([[392, 0, .25], [330, .2, .25], [262, .4, .3], [196, .6, .55]], 'sawtooth', .06);

// per-frame: map speed -> gear -> RPM -> pitch/volume; on=false fades the engine out
export function engine(speed, on) {
  if (!audio.ctx) return;
  const p = audio.profile, v = Math.abs(speed), t = audio.ctx.currentTime;
  let lo = 0, hi = p.gears[p.gears.length - 1] * 1.6; // past top gear the revs just keep climbing
  for (const g of p.gears) { if (v < g) { hi = g; break; } lo = g; }
  const norm = Math.min(1, (v - lo) / (hi - lo));
  // first gear pulls from idle; after a shift the revs land at ~30%, like a real box
  const rpm = lo === 0 ? norm : 0.3 + 0.7 * norm;
  const f = p.f1 * (0.55 + rpm * 1.5);
  audio.osc.frequency.setTargetAtTime(f, t, 0.04);
  audio.osc2.frequency.setTargetAtTime(f * p.ratio, t, 0.04);
  const live = on && !audio.muted;
  // idle rumble when stopped, swells with revs
  const eng = live ? Math.min(0.09, (0.02 + rpm * 0.035 + (v > 0.5 ? 0.012 : 0)) * p.vol) : 0;
  audio.engineGain.gain.setTargetAtTime(eng, t, 0.08);
  audio.windGain.gain.setTargetAtTime(live ? Math.min(0.05, (v / 55) ** 2 * 0.05) : 0, t, 0.15);
}
