// Pitch detection for guitar, using the YIN algorithm (de Cheveigné & Kawahara, 2002).
// Works down to about 50 Hz, so a low C2 (65.4 Hz) string reads cleanly.
// Pure functions, no DOM: usable in the browser and in Node tests.

(function (root) {
  'use strict';

  const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  function rms(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  /**
   * Detect the fundamental frequency of a mono buffer.
   * @returns {{freq:number, clarity:number, level:number}|null}
   */
  function detectPitch(buf, sampleRate, opts = {}) {
    const minF = opts.minFreq || 50;
    const maxF = opts.maxFreq || 1200;
    const threshold = opts.threshold || 0.15;
    const minLevel = opts.minLevel || 0.008;

    const level = rms(buf);
    if (level < minLevel) return null;

    const tauMin = Math.max(2, Math.floor(sampleRate / maxF));
    const tauMax = Math.min(Math.floor(sampleRate / minF), Math.floor(buf.length / 2));
    const W = buf.length - tauMax;
    if (W < tauMax) return null;

    // difference function
    const d = new Float32Array(tauMax + 1);
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let j = 0; j < W; j++) {
        const diff = buf[j] - buf[j + tau];
        sum += diff * diff;
      }
      d[tau] = sum;
    }

    // cumulative mean normalized difference
    const cmnd = new Float32Array(tauMax + 1);
    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      running += d[tau];
      cmnd[tau] = running > 0 ? d[tau] * tau / running : 1;
    }

    // first dip below threshold, then follow it down to its local minimum
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (cmnd[t] < threshold) {
        while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) {
      // no confident dip: take the global minimum if it is reasonably low
      let best = tauMin;
      for (let t = tauMin; t <= tauMax; t++) if (cmnd[t] < cmnd[best]) best = t;
      if (cmnd[best] > 0.35) return null;
      tau = best;
    }

    // parabolic interpolation for sub-sample accuracy
    let betterTau = tau;
    if (tau > 1 && tau < tauMax) {
      const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
      const denom = a + c - 2 * b;
      if (denom !== 0) betterTau = tau + (a - c) / (2 * denom);
    }

    return { freq: sampleRate / betterTau, clarity: 1 - cmnd[tau], level };
  }

  const freqToMidi = f => 69 + 12 * Math.log2(f / 440);
  const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);
  const noteName = m => NAMES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
  const centsOff = (f, targetMidi) => 1200 * Math.log2(f / midiToFreq(targetMidi));

  /** Pick the target string closest to the heard frequency (by pitch distance). */
  function nearestString(freq, targets) {
    const m = freqToMidi(freq);
    let best = 0;
    targets.forEach((t, i) => { if (Math.abs(t - m) < Math.abs(targets[best] - m)) best = i; });
    return best;
  }

  /** Smooths readings: median of recent frequencies, rejecting octave jumps. */
  function makeSmoother(size = 5) {
    const hist = [];
    return function push(freq) {
      if (freq == null) { hist.length = 0; return null; }
      if (hist.length) {
        const last = hist[hist.length - 1];
        const ratio = freq / last;
        // a sudden octave leap is usually a detection slip, not the player
        if ((ratio > 1.9 && ratio < 2.1) || (ratio > 0.47 && ratio < 0.53)) return median(hist);
      }
      hist.push(freq);
      if (hist.length > size) hist.shift();
      return median(hist);
    };
  }
  function median(a) {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  }

  const api = { detectPitch, freqToMidi, midiToFreq, noteName, centsOff, nearestString, makeSmoother, NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pitch = api;
})(typeof window !== 'undefined' ? window : globalThis);
