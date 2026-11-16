// Plucked-string synth (Karplus–Strong). The buffer maths is pure so it can be tested in Node;
// the Web Audio wiring is browser-only.

(function (root) {
  'use strict';

  /**
   * Render a plucked string at `midi` into a Float32Array.
   * The Karplus–Strong loop here repeats every (N − 0.5) samples, so we pick N and return a
   * playback-rate trim that lands the pitch exactly on the target.
   */
  function renderString(midi, sampleRate, seconds) {
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const len = Math.floor(sampleRate * (seconds || (midi < 52 ? 3.2 : 2.4)));
    const out = new Float32Array(len);
    const N = Math.max(3, Math.round(sampleRate / freq + 0.5));
    const line = new Float32Array(N);
    let prev = 0;
    for (let i = 0; i < N; i++) { const r = Math.random() * 2 - 1; prev = prev * 0.45 + r * 0.55; line[i] = prev; }
    const decay = 0.9965 - (midi - 40) * 0.00004;
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const a = line[idx], b = line[(idx + 1) % N];
      out[i] = a;
      line[idx] = (a + b) * 0.5 * decay;
      idx = (idx + 1) % N;
    }
    return { data: out, rate: freq * (N - 0.5) / sampleRate };
  }

  let ctx = null, master = null;
  const cache = new Map();

  function audio() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 4;
      const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 4200;
      const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 220; body.Q.value = 1.2; body.gain.value = 4;
      master = ctx.createGain(); master.gain.value = 0.9;
      master.connect(body).connect(tone).connect(comp).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function buffer(midi) {
    if (!cache.has(midi)) {
      const r = renderString(midi, ctx.sampleRate);
      const buf = ctx.createBuffer(1, r.data.length, ctx.sampleRate);
      buf.getChannelData(0).set(r.data);
      cache.set(midi, { buf, rate: r.rate });
    }
    return cache.get(midi);
  }

  function pluck(midi, when, level) {
    const { buf, rate } = buffer(midi);
    const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = level;
    src.connect(g).connect(master); src.start(when);
    return src;
  }

  /** Play notes in order, `gap` seconds apart (0.03 ≈ strum, 0.2 ≈ arpeggio). */
  function play(midis, gap) {
    if (!audio()) return;
    const t0 = ctx.currentTime + 0.03;
    midis.forEach((m, i) => pluck(m, t0 + i * (gap || 0), midis.length > 1 ? 0.26 : 0.36));
  }

  /** A sustained reference tone (for tuning by ear). Returns a stop function. */
  function drone(midi) {
    if (!audio()) return () => {};
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const g = ctx.createGain(); g.gain.value = 0;
    const oscs = [1, 2, 3].map((h, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * h;
      const og = ctx.createGain(); og.gain.value = [0.5, 0.22, 0.1][i];
      o.connect(og).connect(g); o.start(); return o;
    });
    g.connect(master);
    g.gain.setTargetAtTime(0.35, ctx.currentTime, 0.04);
    return () => {
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
      oscs.forEach(o => o.stop(ctx.currentTime + 0.4));
    };
  }

  const api = { renderString, play, drone, audio };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Synth = api;
})(typeof window !== 'undefined' ? window : globalThis);
