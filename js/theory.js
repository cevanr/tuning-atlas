// Music theory helpers: name a chord from the notes being played, and build scales.
// Pure functions, usable in the browser and in Node tests.

(function (root) {
  'use strict';

  const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  // Chord shapes as intervals above the root. Order = preference when two names fit equally.
  const CHORDS = [
    ['', [0, 4, 7]], ['m', [0, 3, 7]], ['5', [0, 7]],
    ['sus4', [0, 5, 7]], ['sus2', [0, 2, 7]],
    ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]], ['6', [0, 4, 7, 9]], ['m6', [0, 3, 7, 9]],
    ['dim', [0, 3, 6]], ['aug', [0, 4, 8]], ['m7b5', [0, 3, 6, 10]], ['dim7', [0, 3, 6, 9]], ['mMaj7', [0, 3, 7, 11]],
    ['add9', [0, 2, 4, 7]], ['madd9', [0, 2, 3, 7]], ['add11', [0, 4, 5, 7]], ['madd11', [0, 3, 5, 7]],
    ['7sus4', [0, 5, 7, 10]], ['6/9', [0, 2, 4, 7, 9]], ['9', [0, 2, 4, 7, 10]], ['maj9', [0, 2, 4, 7, 11]], ['m9', [0, 2, 3, 7, 10]],
    ['11', [0, 2, 4, 5, 7, 10]], ['m11', [0, 2, 3, 5, 7, 10]], ['maj7#11', [0, 4, 6, 7, 11]], ['7b9', [0, 1, 4, 7, 10]],
    ['6sus2', [0, 2, 7, 9]], ['m7(11)', [0, 3, 5, 7, 10]], ['maj13', [0, 2, 4, 7, 9, 11]],
    // shells without a fifth, common on guitar
    ['(no5)', [0, 4]], ['m(no5)', [0, 3]], ['7(no5)', [0, 4, 10]], ['maj7(no5)', [0, 4, 11]], ['m7(no5)', [0, 3, 10]]
  ];
  const DEG = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];
  const DEG_EXT = { 1: 'b9', 2: '9', 5: '11', 6: '#11', 8: 'b13', 9: '13' };

  /**
   * Name the chord made by these MIDI notes (any order). Lowest note is the bass.
   * @returns {Array<{name:string, root:number, quality:string, bass:number, exact:boolean}>} best first
   */
  function nameChord(midis) {
    const notes = midis.filter(m => m != null);
    if (!notes.length) return [];
    const bass = ((Math.min(...notes) % 12) + 12) % 12;
    const pcs = [...new Set(notes.map(m => ((m % 12) + 12) % 12))];
    if (pcs.length === 1) return [{ name: NAMES[pcs[0]] + ' (single note)', root: pcs[0], quality: 'note', bass, exact: true }];
    const out = [];
    for (const root of pcs) {
      const iv = new Set(pcs.map(p => (p - root + 12) % 12));
      const exactHere = CHORDS.some(([, shape]) => shape.length === iv.size && shape.every(x => iv.has(x)));
      CHORDS.forEach(([q, shape], rank) => {
        const has = shape.every(x => iv.has(x));
        if (!has) return;
        const extra = [...iv].filter(x => !shape.includes(x));
        if (extra.length && exactHere) return;              // a real name exists for this root: skip "add" spellings
        if (extra.length > 2) return;                       // too far from the shape to be a useful name
        if (extra.length && shape.length < 3) return;       // two-note shells only name themselves
        if (extra.some(x => x === 3 || x === 4 || x === 7 || x === 10 || x === 11)) return; // these change the chord's quality
        const exact = extra.length === 0;
        let name = NAMES[root] + q + (extra.length ? `(add ${extra.map(x => DEG_EXT[x] || DEG[x]).join(',')})` : '');
        if (bass !== root) name += '/' + NAMES[bass];
        // score: exact beats extras; root in bass helps; simpler shapes first
        const score = (exact ? 0 : 20 + extra.length * 5) + (bass === root ? 0 : 6) + rank * 0.2 + (shape.length < 3 ? 4 : 0);
        out.push({ name, root, quality: q, bass, exact, score });
      });
    }
    out.sort((a, b) => a.score - b.score);
    const seen = new Set();
    return out.filter(c => !seen.has(c.name) && seen.add(c.name)).slice(0, 4);
  }

  // Scales as intervals above the root.
  const SCALES = [
    ['major', 'Major (Ionian)', [0, 2, 4, 5, 7, 9, 11]],
    ['minor', 'Natural minor (Aeolian)', [0, 2, 3, 5, 7, 8, 10]],
    ['maj-pent', 'Major pentatonic', [0, 2, 4, 7, 9]],
    ['min-pent', 'Minor pentatonic', [0, 3, 5, 7, 10]],
    ['blues', 'Blues', [0, 3, 5, 6, 7, 10]],
    ['dorian', 'Dorian', [0, 2, 3, 5, 7, 9, 10]],
    ['mixolydian', 'Mixolydian', [0, 2, 4, 5, 7, 9, 10]],
    ['phrygian', 'Phrygian', [0, 1, 3, 5, 7, 8, 10]],
    ['lydian', 'Lydian', [0, 2, 4, 6, 7, 9, 11]],
    ['harm-minor', 'Harmonic minor', [0, 2, 3, 5, 7, 8, 11]],
    ['hijaz', 'Hijaz (Phrygian dominant)', [0, 1, 4, 5, 7, 8, 10]],
    ['hirajoshi', 'Hirajōshi (Japan)', [0, 2, 3, 7, 8]],
    ['in', 'In / Miyako-bushi (Japan)', [0, 1, 5, 7, 8]],
    ['yo', 'Yo (Japan)', [0, 2, 5, 7, 9]],
    ['gong', 'Gong pentatonic (China)', [0, 2, 4, 7, 9]],
    ['slendro', 'Slendro-like (Java)', [0, 2, 5, 7, 9]]
  ];
  /* ---------- capo and transposition ---------- */
  const PC = { C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, F: 5, 'E#': 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11 };
  const CHORD_RE = /^([A-G][#b]?)([^\s/]*)(?:\/([A-G][#b]?))?$/;

  /** Split a chord name into root, quality and optional bass. Returns null if it isn't a chord. */
  function parseChord(name) {
    const m = CHORD_RE.exec(String(name).trim());
    if (!m || !(m[1] in PC)) return null;
    if (m[2] && !/^(m|maj|min|dim|aug|sus|add|\d|\(|-|\+|M|°|ø)/.test(m[2])) return null;
    return { root: PC[m[1]], quality: m[2] || '', bass: m[3] && m[3] in PC ? PC[m[3]] : null };
  }
  /** Move a chord name by n half-steps: transposeChord('G/B', 2) === 'A/C#'. */
  function transposeChord(name, n) {
    const c = parseChord(name);
    if (!c) return name;
    const sh = x => NAMES[((x + n) % 12 + 12) % 12];
    return sh(c.root) + c.quality + (c.bass != null ? '/' + sh(c.bass) : '');
  }
  /** Pull chord names out of free text like "| G  D/F# | Em C |" (ignores bar lines and junk). */
  function parseProgression(text) {
    return String(text).replace(/[|,;]+/g, ' ').split(/\s+/).filter(Boolean).filter(w => parseChord(w));
  }
  /** Capo fret (0–11) that makes a tuning whose home key is `homePc` sound in `keyPc`. */
  const capoFor = (homePc, keyPc) => ((keyPc - homePc) % 12 + 12) % 12;

  /**
   * Rank capo positions for a song: for each capo, the shapes you'd play, and how many are easy.
   * @param {string[]} chords  the song's chords as they sound
   * @param {Set<string>} easy shapes that are easy in this tuning (root+quality, no bass)
   */
  function rankCapos(chords, easy, maxCapo = 9) {
    const uniq = [...new Set(chords)];
    const rows = [];
    for (let capo = 0; capo <= maxCapo; capo++) {
      const shapes = uniq.map(ch => transposeChord(ch, -capo));
      const plain = s => { const c = parseChord(s); return NAMES[c.root] + c.quality; };
      const easyCount = shapes.filter(s => easy.has(plain(s))).length;
      rows.push({ capo, shapes, easyCount, total: uniq.length });
    }
    // best: most easy shapes, then lowest capo
    const ranked = [...rows].sort((a, b) => b.easyCount - a.easyCount || a.capo - b.capo);
    return { rows, best: ranked.slice(0, 3).filter(r => r.easyCount > 0).map(r => r.capo) };
  }

  // Shapes most players find easy in standard tuning (open chords, no full barres).
  const STANDARD_EASY = ['C', 'A', 'G', 'E', 'D', 'Am', 'Em', 'Dm', 'A7', 'B7', 'C7', 'D7', 'E7', 'G7',
    'Am7', 'Em7', 'Dm7', 'Cmaj7', 'Fmaj7', 'Amaj7', 'Dmaj7', 'Dsus2', 'Dsus4', 'Asus2', 'Asus4', 'Esus4', 'Cadd9', 'G6', 'A6', 'E5', 'A5', 'D5'];

  const api = { nameChord, SCALES, NAMES, DEG, PC, parseChord, transposeChord, parseProgression, capoFor, rankCapos, STANDARD_EASY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Theory = api;
})(typeof window !== 'undefined' ? window : globalThis);
