// Everything synthesized, no audio files: engine drone, collision thump, inspect chime.
export const audio = { ctx: null, muted: false };

export function initAudio() {
  if (audio.ctx || audio.muted) return;
  const ctx = audio.ctx = new AudioContext();
  const master = audio.master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 46;
  const osc2 = ctx.createOscillator(); osc2.type = 'square'; osc2.frequency.value = 92;
  const g2 = ctx.createGain(); g2.gain.value = 0.3;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
  const eg = audio.engineGain = ctx.createGain(); eg.gain.value = 0;
  osc.connect(lp); osc2.connect(g2); g2.connect(lp); lp.connect(eg); eg.connect(master);
  osc.start(); osc2.start();
  audio.osc = osc; audio.osc2 = osc2;
  const len = ctx.sampleRate * 0.2, buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  audio.noise = buf;
}

let lastThump = 0;
export function thump(v) {
  if (!audio.ctx || audio.muted || audio.ctx.currentTime - lastThump < 0.15) return;
  lastThump = audio.ctx.currentTime;
  const ctx = audio.ctx, s = ctx.createBufferSource();
  s.buffer = audio.noise;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
  const g = ctx.createGain(); g.gain.value = Math.min(0.4, 0.05 + v * 0.012);
  s.connect(lp); lp.connect(g); g.connect(audio.master);
  s.start();
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

// speed-tracking engine drone; on=false silences it (orbit mode, viewer open, muted)
export function engine(speed, on) {
  if (!audio.ctx) return;
  const v = Math.abs(speed);
  audio.osc.frequency.value = 46 + v * 2.4;
  audio.osc2.frequency.value = 92 + v * 4.8;
  audio.engineGain.gain.value = on && !audio.muted ? Math.min(0.05, 0.008 + v * 0.0011) : 0;
}
