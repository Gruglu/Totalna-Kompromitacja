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
  // koło fortuny
  wheel() {
    const seq = [262, 330, 392, 523, 392, 523, 659, 784];
    seq.forEach((f, i) => tone(f, i * 0.07, 0.12, { type: 'square', gain: 0.12 }));
    tone(1047, 0.56, 0.5, { type: 'triangle', gain: 0.2 });
    noise(0.56, 0.3, 0.08, 2000);
  },
  spin() {
    noise(0, 0.6, 0.14, 600);
    tone(120, 0, 0.6, { type: 'sawtooth', gain: 0.12, slide: 480 });
  },
  click() {
    tone(2400, 0, 0.018, { gain: 0.07 });
    noise(0, 0.012, 0.05, 5000);
  },
  land() {
    tone(150, 0, 0.25, { type: 'sine', gain: 0.4, slide: 50 });
    [659, 784, 1047].forEach((f, i) => tone(f, 0.05 + i * 0.06, 0.2, { type: 'triangle', gain: 0.2 }));
  },
  pass() {
    tone(784, 0, 0.08, { gain: 0.12 });
    tone(523, 0.08, 0.16, { gain: 0.12 });
  },
  draw() {
    noise(0, 0.2, 0.06, 1500);
  },
  rule() {
    tone(660, 0, 0.05, { gain: 0.1 });
    tone(990, 0.05, 0.09, { gain: 0.1 });
  },
  // czołówka, ok. 11 s, zsynchronizowana z animacją w board.js (OPENER)
  opener() {
    // włączenie kineskopu
    noise(0, 0.5, 0.12, 400);
    tone(60, 0, 0.5, { type: 'sine', gain: 0.3, slide: 1400 });
    tone(55, 0.5, 3.1, { type: 'triangle', gain: 0.12 });
    // pikanie przy każdej linii logu
    for (let i = 0; i < 8; i++) tone(i === 3 || i === 6 ? 220 : 1760, 0.6 + i * 0.36, i === 3 || i === 6 ? 0.14 : 0.03, { gain: 0.08 });
    // zakłócenie i uderzenie z logo
    noise(3.55, 0.2, 0.25, 900);
    const hit = (t, root) => {
      tone(150, t, 0.3, { type: 'sine', gain: 0.55, slide: 38 });
      noise(t, 1.2, 0.14, 4000);
      [1, 1.5, 2].forEach((m) => tone(root * m, t, 0.9, { type: 'sawtooth', gain: 0.07 }));
    };
    hit(3.75, 110);
    hit(4.45, 98);
    // motyw: 132 BPM, a-moll, bas + bęben + melodia
    const B = 60 / 132;
    const t0 = 5.0;
    const bass = [55, 55, 110, 55, 65.4, 65.4, 130.8, 65.4, 49, 49, 98, 49, 41.2, 41.2, 82.4, 98];
    const lead = [440, 0, 523, 659, 784, 0, 659, 523, 587, 0, 523, 494, 440, 0, 0, 0, 440, 0, 523, 659, 880, 0, 784, 659, 698, 659, 587, 523, 494, 0, 0, 0];
    for (let i = 0; i < 16; i++) {
      const t = t0 + (i * B) / 2;
      tone(bass[i], t, B / 2.2, { type: 'square', gain: 0.11 });
      if (i % 2 === 0) tone(140, t, 0.2, { type: 'sine', gain: 0.45, slide: 42 });
      if (i % 4 === 2) noise(t, 0.16, 0.16, 1600);
      noise(t + B / 4, 0.03, 0.04, 7000);
    }
    for (let i = 0; i < 16; i++) {
      const t = t0 + 8 * B + (i * B) / 2;
      tone(bass[i], t, B / 2.2, { type: 'square', gain: 0.11 });
      if (i % 2 === 0) tone(140, t, 0.2, { type: 'sine', gain: 0.45, slide: 42 });
      if (i % 4 === 2) noise(t, 0.16, 0.16, 1600);
      noise(t + B / 4, 0.03, 0.04, 7000);
    }
    lead.forEach((f, i) => f && tone(f, t0 + (i * B) / 2, B / 2.4, { type: 'square', gain: 0.06 }));
    // akord na koniec
    const tEnd = t0 + 16 * B;
    tone(150, tEnd, 0.4, { type: 'sine', gain: 0.55, slide: 36 });
    noise(tEnd, 1.6, 0.12, 3500);
    [110, 165, 220, 330].forEach((f) => tone(f, tEnd, 1.8, { type: 'sawtooth', gain: 0.06 }));
    tone(880, tEnd, 1.8, { type: 'square', gain: 0.04 });
  },
};

// audio z pytań przechodzi przez ten sam mikser, żeby był analizator do wizualizacji
const routed = new WeakMap();
export function connectMedia(el) {
  if (!ctx) return null;
  if (routed.has(el)) return routed.get(el);
  try {
    const src = ctx.createMediaElementSource(el);
    const an = ctx.createAnalyser();
    an.fftSize = 256;
    an.smoothingTimeConstant = 0.72;
    src.connect(an).connect(master);
    routed.set(el, an);
    return an;
  } catch {
    return null;
  }
}

export function play(name) {
  if (!ctx || ctx.state !== 'running') return;
  SOUNDS[name]?.();
}
