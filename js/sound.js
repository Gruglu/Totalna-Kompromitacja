// Dźwięki syntezowane w przeglądarce (Web Audio), bez plików z zewnątrz.

let ctx = null;
let master = null;
let volume = 0.6;

export function unlock() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx.state !== 'suspended';
}

export const unlocked = () => !!ctx && ctx.state === 'running';

export function setVolume(v) {
  volume = v;
  if (master) master.gain.value = v;
}

function tone(freq, start, dur, { type = 'square', gain = 0.2, slide = null, attack = 0.005 } = {}) {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + attack);
  g.gain.setValueAtTime(gain, t0 + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(start, dur, gain = 0.15, hp = 1200) {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

const SOUNDS = {
  buzz() {
    tone(880, 0, 0.09, { gain: 0.22 });
    tone(1320, 0.09, 0.22, { gain: 0.22 });
  },
  right() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.18, { type: 'triangle', gain: 0.25 }));
    tone(1568, 0.3, 0.35, { type: 'square', gain: 0.08 });
  },
  wrong() {
    tone(160, 0, 0.5, { type: 'sawtooth', gain: 0.22, slide: 90 });
    tone(166, 0, 0.5, { type: 'square', gain: 0.1, slide: 95 });
  },
  timeout() {
    [0, 0.18, 0.36].forEach((t) => tone(440, t, 0.12, { gain: 0.15 }));
    tone(220, 0.54, 0.4, { gain: 0.18 });
  },
  open() {
    tone(1760, 0, 0.05, { gain: 0.1 });
  },
  reveal() {
    noise(0, 0.12, 0.08, 3000);
    tone(330, 0, 0.12, { type: 'triangle', gain: 0.12, slide: 660 });
  },
  dd() {
    const seq = [196, 233, 277, 330, 392, 466, 554, 659];
    seq.forEach((f, i) => tone(f, i * 0.06, 0.1, { gain: 0.14 }));
    tone(784, 0.5, 0.6, { type: 'sawtooth', gain: 0.18 });
    tone(392, 0.5, 0.6, { type: 'square', gain: 0.12 });
    noise(0.5, 0.4, 0.1, 800);
  },
  intro() {
    const mel = [392, 523, 659, 784, 659, 1047];
    mel.forEach((f, i) => tone(f, i * 0.12, 0.16, { type: 'square', gain: 0.13 }));
    tone(131, 0, 0.72, { type: 'triangle', gain: 0.25 });
    tone(196, 0.72, 0.5, { type: 'triangle', gain: 0.25 });
  },
  end() {
    const mel = [523, 659, 784, 1047, 784, 1047, 1319];
    mel.forEach((f, i) => tone(f, i * 0.14, 0.2, { type: 'square', gain: 0.12 }));
    tone(131, 0, 1.0, { type: 'triangle', gain: 0.25 });
  },
  bonus() {
    tone(988, 0, 0.08, { type: 'triangle', gain: 0.18 });
    tone(1319, 0.08, 0.14, { type: 'triangle', gain: 0.18 });
  },
  penalty() {
    tone(330, 0, 0.12, { type: 'square', gain: 0.14 });
    tone(247, 0.12, 0.22, { type: 'square', gain: 0.14 });
  },
  tick() {
    tone(1200, 0, 0.03, { gain: 0.06 });
  },
};

export function play(name) {
  if (!ctx || ctx.state !== 'running') return;
  SOUNDS[name]?.();
}
