/* Tuning Atlas app: tuner, retune guide, atlas. No build step, no dependencies. */
(function () {
  'use strict';

  const D = window.ATLAS;
  const P = window.Pitch;
  const S = window.Synth;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const byId = id => D.tunings.find(t => t.id === id);
  const STR_NUM = ['6', '5', '4', '3', '2', '1'];
  const NAMES = P.NAMES;

  /* ---------- saved settings (this device only) ---------- */
  const store = {
    get() { try { return JSON.parse(localStorage.getItem('tuning-atlas') || '{}'); } catch (e) { return {}; } },
    set(patch) { try { localStorage.setItem('tuning-atlas', JSON.stringify(Object.assign(store.get(), patch))); } catch (e) {} }
  };
  const saved = store.get();
  const state = {
    tuneId: byId(saved.tuneId) ? saved.tuneId : 'standard',
    fromId: byId(saved.fromId) ? saved.fromId : 'standard',
    toId: byId(saved.toId) ? saved.toId : 'cgcfce',
    a4: saved.a4 >= 415 && saved.a4 <= 466 ? saved.a4 : 440,
    favs: new Set(Array.isArray(saved.favs) ? saved.favs : []),
    q: '', cat: saved.cat || 'all', lowc: !!saved.lowc, open: new Set()
  };

  /* ---------- pitch helpers ---------- */
  const STD = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4
  function midis(t) {
    if (t._m) return t._m;
    const octUp = /octave/.test(t.spelling);
    const notes = t.spelling.replace(/\(.*\)/, '').trim().split(/\s+/);
    const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
    // each string goes to the octave closest to where that string sits in standard tuning
    t._m = notes.map((n, i) => {
      const pc = PC[n]; let best = null;
      for (let m = 24; m <= 84; m++) if (m % 12 === pc && (best === null || Math.abs(m - STD[i]) < Math.abs(best - STD[i]))) best = m;
      return best + (octUp && i < 4 ? 12 : 0);
    });
    return t._m;
  }
  const noteHTML = m => `${NAMES[((m % 12) + 12) % 12]}<sub>${Math.floor(m / 12) - 1}</sub>`;
  const noteText = m => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  const freqOf = m => state.a4 * Math.pow(2, (m - 69) / 12);
  const midiOf = f => 69 + 12 * Math.log2(f / state.a4);

  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 2200);
  }
  function flash(el) { if (!el) return; el.classList.remove('ring'); void el.offsetWidth; el.classList.add('ring'); }

  /* ================= MICROPHONE ================= */
  const Mic = {
    on: false, stream: null, analyser: null, buf: null, raf: 0, last: 0, silentSince: 0,
    smooth: P.makeSmoother(5), listeners: new Set(),
    async start() {
      if (this.on) return true;
      const err = $('#micErr'); err.hidden = true;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showMicError('This browser can’t use the microphone here. Open the app over https in Safari, Chrome or Firefox.');
        return false;
      }
      try {
        const ctx = S.audio();
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        const src = ctx.createMediaStreamSource(this.stream);
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 45;
        this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 4096;
        src.connect(hp).connect(this.analyser);
        this.buf = new Float32Array(this.analyser.fftSize);
        this.on = true; this.smooth(null);
        this.raf = requestAnimationFrame(t => this.loop(t));
        return true;
      } catch (e) {
        const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
        showMicError(denied
          ? 'Microphone access was blocked. Allow the microphone for this site in your browser settings, then tap Start again.'
          : 'No microphone found. Check that one is connected and not in use by another app.');
        return false;
      }
    },
    stop() {
      this.on = false; cancelAnimationFrame(this.raf);
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      this.stream = null; this.emit(null);
    },
    loop(ts) {
      if (!this.on) return;
      this.raf = requestAnimationFrame(t => this.loop(t));
      if (ts - this.last < 45) return; // ~22 readings a second is plenty
      this.last = ts;
      this.analyser.getFloatTimeDomainData(this.buf);
      const r = P.detectPitch(this.buf, this.analyser.context.sampleRate, { minFreq: 55, maxFreq: 1100 });
      if (r && r.clarity > 0.82) {
        this.silentSince = 0;
        this.emit(this.smooth(r.freq));
      } else {
        if (!this.silentSince) this.silentSince = ts;
        if (ts - this.silentSince > 700) { this.smooth(null); this.emit(null); }
      }
    },
    emit(f) { this.listeners.forEach(fn => fn(f)); }
  };
  function showMicError(msg) { const el = $('#micErr'); el.textContent = msg; el.hidden = false; toast('Microphone unavailable'); }

  /* ================= GAUGE ================= */
  function makeGauge(svg) {
    const cx = 160, cy = 150, r = 120;
    const pt = (deg, rad) => [cx + rad * Math.sin(deg * Math.PI / 180), cy - rad * Math.cos(deg * Math.PI / 180)];
    let h = '';
    // in-tune zone: ±5 cents
    const z0 = pt(-6, r - 4), z1 = pt(6, r - 4);
    h += `<path class="zone" d="M${z0[0]} ${z0[1]} A${r - 4} ${r - 4} 0 0 1 ${z1[0]} ${z1[1]}"/>`;
    for (let c = -50; c <= 50; c += 5) {
      const deg = c * 1.2, major = c % 25 === 0;
      const a = pt(deg, r + (major ? 6 : 0)), b = pt(deg, r - 14);
      h += `<line class="tick${major ? ' major' : ''}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;
      if (major) { const l = pt(deg, r + 18); h += `<text class="lbl" x="${l[0]}" y="${l[1] + 4}">${c > 0 ? '+' + c : c}</text>`; }
    }
    h += `<text class="lbl" x="${cx - 104}" y="${cy + 14}">flat</text><text class="lbl" x="${cx + 104}" y="${cy + 14}">sharp</text>`;
    h += `<line class="needle idle" x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r + 18}"/><circle class="hub" cx="${cx}" cy="${cy}" r="6"/>`;
    svg.innerHTML = h;
    const needle = svg.querySelector('.needle');
    let shown = 0;
    return {
      set(cents) {
        if (cents == null) { needle.classList.add('idle'); needle.style.transform = 'rotate(0deg)'; shown = 0; return; }
        needle.classList.remove('idle');
        shown = shown * 0.55 + Math.max(-55, Math.min(55, cents)) * 0.45;
        needle.style.transform = `rotate(${shown * 1.2}deg)`;
      }
    };
  }

  /** Describe a reading against a target: verdict text and class. */
  function judge(freq, target) {
    const cents = 1200 * Math.log2(freq / freqOf(target));
    const semis = Math.round(cents / 100);
    if (Math.abs(semis) >= 1 && Math.abs(cents) > 60) {
      const n = Math.abs(semis);
      return { cents, cls: cents < 0 ? 'flat' : 'sharp', text: cents < 0 ? `${n} half-step${n > 1 ? 's' : ''} low · tune up` : `${n} half-step${n > 1 ? 's' : ''} high · tune down` };
    }
    if (Math.abs(cents) <= 4) return { cents, cls: 'in', text: 'In tune' };
    return { cents, cls: cents < 0 ? 'flat' : 'sharp', text: `${Math.abs(Math.round(cents))} cents ${cents < 0 ? 'flat · tune up' : 'sharp · tune down'}` };
  }

  /* ================= TUNE VIEW ================= */
  const tuneGauge = makeGauge($('#gauge'));
  const tuner = { lock: null, active: 0, done: new Set(), inSince: 0, drone: null };

  function renderTune() {
    const t = byId(state.tuneId), m = midis(t);
    $('#tuneName').textContent = t.name;
    $('#tuneSpelling').textContent = t.spelling.replace(/\s*\(.*\)/, '');
    $('#targets').innerHTML = m.map((x, i) => `
      <button type="button" class="tgt${i === tuner.active ? ' active' : ''}${tuner.lock === i ? ' locked' : ''}${tuner.done.has(i) ? ' done' : ''}" data-i="${i}" aria-pressed="${tuner.lock === i}" aria-label="String ${STR_NUM[i]}, ${noteText(x)}${tuner.lock === i ? ', locked' : ''}">
        <span class="num">${STR_NUM[i]}</span><span class="nt">${noteHTML(x)}</span>
      </button>`).join('');
    $('#lockHint').textContent = tuner.lock == null
      ? 'Auto mode picks the closest string. Tap a string to lock onto it.'
      : `Locked on string ${STR_NUM[tuner.lock]}. Tap it again for auto mode.`;
    $('#refBtn').textContent = `Play ${noteText(m[tuner.lock ?? tuner.active])}`;
    $('#a4Val').textContent = `A4 = ${state.a4} Hz`;
  }

  function onTuneReading(f) {
    if ($('#view-tune').hidden) return;
    const meter = $('#meter');
    if (f == null) {
      tuneGauge.set(null); meter.classList.remove('in');
      $('#bigNote').textContent = '–';
      $('#hz').textContent = Mic.on ? 'Listening… play one string' : 'Tap Start, then play a string';
      $('#verdict').className = 'verdict'; $('#verdict').textContent = Mic.on ? 'Waiting for a note' : 'Tuner is off';
      tuner.inSince = 0;
      return;
    }
    const t = byId(state.tuneId), m = midis(t);
    const heard = midiOf(f);
    let idx = tuner.lock;
    if (idx == null) {
      idx = 0;
      m.forEach((x, i) => { if (Math.abs(x - heard) < Math.abs(m[idx] - heard)) idx = i; });
    }
    if (idx !== tuner.active) { tuner.active = idx; renderTune(); }
    const j = judge(f, m[idx]);
    tuneGauge.set(Math.abs(j.cents) > 60 ? Math.sign(j.cents) * 55 : j.cents);
    $('#bigNote').innerHTML = noteHTML(Math.round(heard));
    $('#hz').textContent = `${f.toFixed(1)} Hz · string ${STR_NUM[idx]} → ${noteText(m[idx])}`;
    $('#verdict').className = 'verdict ' + j.cls; $('#verdict').textContent = j.text;
    meter.classList.toggle('in', j.cls === 'in');
    if (j.cls === 'in') {
      if (!tuner.inSince) tuner.inSince = performance.now();
      if (performance.now() - tuner.inSince > 600 && !tuner.done.has(idx)) { tuner.done.add(idx); renderTune(); }
    } else tuner.inSince = 0;
  }
  Mic.listeners.add(onTuneReading);

  $('#targets').addEventListener('click', e => {
    const b = e.target.closest('.tgt'); if (!b) return;
    const i = +b.dataset.i;
    tuner.lock = tuner.lock === i ? null : i;
    tuner.active = i;
    if (tuner.drone) startDrone();
    renderTune();
  });
  $('#micBtn').addEventListener('click', async () => {
    const b = $('#micBtn');
    if (Mic.on) { Mic.stop(); b.textContent = 'Start tuner'; b.classList.remove('on'); return; }
    if (await Mic.start()) { b.textContent = 'Stop tuner'; b.classList.add('on'); onTuneReading(null); }
  });
  $('#refBtn').addEventListener('click', () => {
    const m = midis(byId(state.tuneId))[tuner.lock ?? tuner.active];
    S.play([m + (state.a4 === 440 ? 0 : 12 * Math.log2(state.a4 / 440))], 0);
  });
  function startDrone() {
    if (tuner.drone) tuner.drone();
    const m = midis(byId(state.tuneId))[tuner.lock ?? tuner.active];
    tuner.drone = S.drone(m + 12 * Math.log2(state.a4 / 440));
  }
  $('#droneBtn').addEventListener('click', () => {
    const b = $('#droneBtn');
    if (tuner.drone) { tuner.drone(); tuner.drone = null; b.setAttribute('aria-pressed', 'false'); return; }
    startDrone(); b.setAttribute('aria-pressed', 'true');
  });
  const setA4 = v => { state.a4 = Math.max(415, Math.min(466, v)); store.set({ a4: state.a4 }); renderTune(); if (tuner.drone) startDrone(); };
  $('#a4Down').addEventListener('click', () => setA4(state.a4 - 1));
  $('#a4Up').addEventListener('click', () => setA4(state.a4 + 1));

  function setTuning(id) {
    state.tuneId = id; store.set({ tuneId: id });
    tuner.lock = null; tuner.active = 0; tuner.done.clear();
    if (tuner.drone) startDrone();
    renderTune();
    if (!$('#view-frets').hidden) { fret.sel = [null, null, null, null, null, null]; renderFrets(); }
  }

  /* ================= RETUNE VIEW ================= */
  const gGauge = makeGauge($('#gGauge'));
  const guide = { on: false, steps: [], i: 0, inSince: 0 };

  function moves() {
    const a = midis(byId(state.fromId)), b = midis(byId(state.toId));
    return a.map((x, i) => ({ i, from: x, to: b[i], d: b[i] - x }));
  }
  function moveWords(d) {
    if (d === 0) return 'No change';
    const n = Math.abs(d);
    return `${d > 0 ? 'Up' : 'Down'} ${n} half-step${n > 1 ? 's' : ''}`;
  }
  function moveWarn(d) {
    if (Math.abs(d) >= 7) return 'That’s a big jump. This tuning usually needs different strings.';
    if (d >= 3) return 'Raising this far adds a lot of tension. Go slowly, or use a lighter string.';
    if (d <= -5) return 'This far down the string may feel floppy. A heavier gauge helps.';
    return '';
  }
  function renderRetune() {
    const f = byId(state.fromId), t = byId(state.toId);
    $('#fromName').textContent = f.name; $('#fromSp').textContent = f.spelling.replace(/\s*\(.*\)/, '');
    $('#toName').textContent = t.name; $('#toSp').textContent = t.spelling.replace(/\s*\(.*\)/, '');
    const ms = moves(), changed = ms.filter(x => x.d !== 0);
    $('#moves').innerHTML = ms.map(x => {
      const w = moveWarn(x.d);
      return `<div class="move">
        <span class="s">${STR_NUM[x.i]}</span><span class="a">${noteHTML(x.from)}</span><span class="arr">→</span><span class="b">${noteHTML(x.to)}</span>
        <span class="d ${x.d === 0 ? 'same' : x.d > 0 ? 'up' : 'down'}">${moveWords(x.d)}</span>
        ${w ? `<span class="warn">${esc(w)}</span>` : ''}
      </div>`;
    }).join('') + `<div class="sum">${changed.length === 0 ? 'Same notes. Nothing to retune.' : `${changed.length} string${changed.length > 1 ? 's' : ''} to move.`}</div>`;
    $('#guideBtn').disabled = changed.length === 0;
    $('#guideBtn').textContent = guide.on ? 'Restart guided retune' : 'Start guided retune';
  }

  function guideStep() {
    const s = guide.steps[guide.i];
    $('#gStep').textContent = `String ${guide.i + 1} of ${guide.steps.length}`;
    $('#gStr').innerHTML = `String ${STR_NUM[s.i]}: ${noteHTML(s.from)} → ${noteHTML(s.to)}`;
    $('#gMove').textContent = moveWords(s.d) + '. Pluck the string and turn its peg until the meter goes green.';
    $('#gNext').textContent = guide.i === guide.steps.length - 1 ? 'Finish' : 'Skip';
    $('#gPrev').disabled = guide.i === 0;
    guide.inSince = 0;
    onGuideReading(null);
  }
  async function startGuide() {
    guide.steps = moves().filter(x => x.d !== 0).sort((a, b) => a.i - b.i);
    if (!guide.steps.length) return;
    guide.on = true; guide.i = 0;
    $('#guide').hidden = false;
    guideStep();
    renderRetune();
    $('#guide').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!Mic.on && await Mic.start()) { $('#micBtn').textContent = 'Stop tuner'; $('#micBtn').classList.add('on'); }
    if (!Mic.on) toast('Allow the microphone to use the guide');
  }
  function endGuide(finished) {
    guide.on = false; $('#guide').hidden = true; renderRetune();
    if (finished) {
      setTuning(state.toId);
      toast(`Done. Tuner set to ${byId(state.toId).name}`);
    }
  }
  function onGuideReading(f) {
    if (!guide.on) return;
    const s = guide.steps[guide.i], meter = $('#gGauge').closest('.meter');
    if (f == null) {
      gGauge.set(null); meter.classList.remove('in');
      $('#gNote').textContent = '–'; $('#gHz').textContent = Mic.on ? 'Listening…' : 'Microphone off';
      $('#gVerdict').className = 'verdict'; $('#gVerdict').textContent = `Target ${noteText(s.to)}`;
      return;
    }
    const j = judge(f, s.to);
    gGauge.set(Math.abs(j.cents) > 60 ? Math.sign(j.cents) * 55 : j.cents);
    $('#gNote').innerHTML = noteHTML(Math.round(midiOf(f)));
    $('#gHz').textContent = `${f.toFixed(1)} Hz`;
    $('#gVerdict').className = 'verdict ' + j.cls; $('#gVerdict').textContent = j.text;
    meter.classList.toggle('in', j.cls === 'in');
    if (j.cls === 'in') {
      if (!guide.inSince) guide.inSince = performance.now();
      if (performance.now() - guide.inSince > 900) {
        guide.inSince = 0;
        if (guide.i < guide.steps.length - 1) { toast(`String ${STR_NUM[s.i]} is in tune`); guide.i++; guideStep(); }
        else endGuide(true);
      }
    } else guide.inSince = 0;
  }
  Mic.listeners.add(onGuideReading);

  $('#guideBtn').addEventListener('click', startGuide);
  $('#gClose').addEventListener('click', () => endGuide(false));
  $('#gPrev').addEventListener('click', () => { if (guide.i > 0) { guide.i--; guideStep(); } });
  $('#gNext').addEventListener('click', () => { if (guide.i < guide.steps.length - 1) { guide.i++; guideStep(); } else endGuide(true); });
  $('#gRef').addEventListener('click', () => S.play([guide.steps[guide.i].to + 12 * Math.log2(state.a4 / 440)], 0));
  $('#swapBtn').addEventListener('click', () => {
    [state.fromId, state.toId] = [state.toId, state.fromId];
    store.set({ fromId: state.fromId, toId: state.toId });
    if (guide.on) endGuide(false); renderRetune();
  });

  /* ================= FRETBOARD VIEW ================= */
  const T = window.Theory;
  const FRETS = 15, INLAYS = new Set([3, 5, 7, 9, 12, 15]);
  const fret = {
    mode: saved.fretMode === 'scale' ? 'scale' : 'chord',
    sel: [null, null, null, null, null, null],
    root: Number.isInteger(saved.scaleRoot) ? saved.scaleRoot : 0,
    scale: T.SCALES.some(s => s[0] === saved.scale) ? saved.scale : 'maj-pent',
    labels: saved.fretLabels === 'deg' ? 'deg' : 'notes'
  };

  function chordMidis() {
    const m = midis(byId(state.tuneId));
    return fret.sel.map((f, i) => f == null ? null : m[i] + f);
  }
  function renderFretChord() {
    const notes = chordMidis(), played = notes.filter(n => n != null);
    $('#cTab').textContent = fret.sel.map(f => f == null ? 'x' : f).join(' ');
    const name = $('#cName'), alt = $('#cAlt');
    if (!played.length) {
      name.textContent = 'Tap the fretboard'; name.classList.add('dim');
      alt.textContent = 'Pick one fret per string. Tap a dot again to mute that string.';
      return;
    }
    const names = T.nameChord(played);
    name.classList.toggle('dim', !names.length);
    name.textContent = names.length ? names[0].name : 'No standard name';
    const pcs = [...new Set(played.map(n => NAMES[n % 12]))].join(' · ');
    alt.textContent = (names.length > 1 ? `Also ${names.slice(1, 3).map(n => n.name).join(', ')} · ` : '') + `Notes: ${pcs}`;
  }
  function scaleOf() { return T.SCALES.find(s => s[0] === fret.scale); }
  function renderFretScale() {
    $('#roots').innerHTML = NAMES.map((n, i) => `<button type="button" data-root="${i}" aria-pressed="${fret.root === i}">${n}</button>`).join('');
    $('#scaleSel').innerHTML = T.SCALES.map(([id, name]) => `<option value="${id}"${id === fret.scale ? ' selected' : ''}>${esc(name)}</option>`).join('');
    $('#lblNotes').setAttribute('aria-pressed', fret.labels === 'notes');
    $('#lblDeg').setAttribute('aria-pressed', fret.labels === 'deg');
    const sc = scaleOf();
    $('#scaleInfo').textContent = `${NAMES[fret.root]} ${sc[1]}: ` + sc[2].map(iv => NAMES[(fret.root + iv) % 12]).join(' · ') + '. Dark dots are the root. Tap any dot to hear it.';
  }
  function renderFretboard() {
    const t = byId(state.tuneId), m = midis(t);
    const sc = scaleOf(), inScale = new Set(sc[2]);
    let h = '<span></span>' + m.map((x, i) => `<span class="hd"><span class="sn">${STR_NUM[i]}</span><span class="on">${noteHTML(x)}</span></span>`).join('');
    for (let f = 0; f <= FRETS; f++) {
      h += `<span class="fn${INLAYS.has(f) ? ' inlay' : ''}">${f === 0 ? '' : f}</span>`;
      for (let i = 0; i < 6; i++) {
        const note = m[i] + f, pc = ((note % 12) + 12) % 12;
        const w = (1.6 - i * 0.18).toFixed(2) + 'px'; // heavier low strings
        let inner = '', label = `String ${STR_NUM[i]}, ${f === 0 ? 'open' : 'fret ' + f}: ${noteText(note)}`;
        if (fret.mode === 'chord') {
          if (fret.sel[i] === f) inner = `<span class="dot on${f === 0 ? ' open' : ''}">${NAMES[pc]}</span>`;
          else if (f === 0 && fret.sel[i] == null) inner = '<span class="mute" aria-hidden="true">×</span>';
        } else {
          const iv = (pc - fret.root + 12) % 12;
          if (inScale.has(iv)) inner = `<span class="dot${iv === 0 ? ' root' : ''}">${fret.labels === 'deg' ? T.DEG[iv] : NAMES[pc]}</span>`;
        }
        h += `<button type="button" class="cell${f === 0 ? ' nut' : ''}" style="--w:${w}" data-s="${i}" data-f="${f}" aria-label="${esc(label)}">${inner}</button>`;
      }
    }
    $('#fb').innerHTML = h;
  }
  function renderFrets() {
    const t = byId(state.tuneId);
    $('#fretName').textContent = t.name; $('#fretSp').textContent = t.spelling.replace(/\s*\(.*\)/, '');
    $('#modeChord').setAttribute('aria-selected', fret.mode === 'chord');
    $('#modeScale').setAttribute('aria-selected', fret.mode === 'scale');
    $('#chordPanel').hidden = fret.mode !== 'chord';
    $('#scalePanel').hidden = fret.mode !== 'scale';
    if (fret.mode === 'chord') renderFretChord(); else renderFretScale();
    renderFretboard();
  }
  const setMode = mode => { fret.mode = mode; store.set({ fretMode: mode }); renderFrets(); };
  $('#modeChord').addEventListener('click', () => setMode('chord'));
  $('#modeScale').addEventListener('click', () => setMode('scale'));
  $('#fb').addEventListener('click', e => {
    const c = e.target.closest('.cell'); if (!c) return;
    const i = +c.dataset.s, f = +c.dataset.f, note = midis(byId(state.tuneId))[i] + f;
    if (fret.mode === 'chord') {
      fret.sel[i] = fret.sel[i] === f ? null : f;
      if (fret.sel[i] != null) S.play([note], 0);
      renderFretChord(); renderFretboard();
    } else {
      S.play([note], 0); flash(c.querySelector('.dot') || c);
    }
  });
  $('#cStrum').addEventListener('click', () => S.play(chordMidis().filter(n => n != null), 0.03));
  $('#cArp').addEventListener('click', () => S.play(chordMidis().filter(n => n != null), 0.2));
  $('#cOpen').addEventListener('click', () => { fret.sel = [0, 0, 0, 0, 0, 0]; renderFrets(); S.play(chordMidis(), 0.03); });
  $('#cClear').addEventListener('click', () => { fret.sel = [null, null, null, null, null, null]; renderFrets(); });
  $('#roots').addEventListener('click', e => {
    const b = e.target.closest('[data-root]'); if (!b) return;
    fret.root = +b.dataset.root; store.set({ scaleRoot: fret.root }); renderFrets();
  });
  $('#scaleSel').addEventListener('change', e => { fret.scale = e.target.value; store.set({ scale: fret.scale }); renderFrets(); });
  $('#lblNotes').addEventListener('click', () => { fret.labels = 'notes'; store.set({ fretLabels: 'notes' }); renderFrets(); });
  $('#lblDeg').addEventListener('click', () => { fret.labels = 'deg'; store.set({ fretLabels: 'deg' }); renderFrets(); });

  /* ================= PICKER SHEET ================= */
  let pickFor = null;
  function openPicker(which) {
    pickFor = which;
    $('#sheetTitle').textContent = which === 'from' ? 'Retune from' : which === 'to' ? 'Retune to' : 'Choose a tuning';
    $('#sheetQ').value = '';
    renderPicker();
    $('#sheet').hidden = false;
    setTimeout(() => $('#sheetQ').focus({ preventScroll: true }), 50);
  }
  function closePicker() { $('#sheet').hidden = true; pickFor = null; }
  function renderPicker() {
    const q = norm($('#sheetQ').value.trim());
    const cur = pickFor === 'from' ? state.fromId : pickFor === 'to' ? state.toId : state.tuneId;
    const ok = t => !q || t.hay.includes(q) || t.spelling.replace(/\s+/g, '').toLowerCase().includes(q.replace(/\s+/g, ''));
    const opt = t => `<button type="button" class="opt${t.id === cur ? ' cur' : ''}" data-id="${t.id}"><b>${esc(t.name)}${state.favs.has(t.id) ? ' ★' : ''}</b><span>${esc(t.spelling.replace(/\s*\(.*\)/, ''))}</span></button>`;
    let h = '';
    const favs = D.tunings.filter(t => state.favs.has(t.id) && ok(t));
    if (favs.length) h += `<div class="gl">Favorites</div>` + favs.map(opt).join('');
    D.cats.forEach(([id, name]) => {
      const list = D.tunings.filter(t => t.cat === id && ok(t));
      if (list.length) h += `<div class="gl">${esc(name)}</div>` + list.map(opt).join('');
    });
    $('#sheetList').innerHTML = h || '<p class="lede" style="padding:12px 2px">No tunings match.</p>';
  }
  document.addEventListener('click', e => {
    const p = e.target.closest('[data-pick]'); if (p) openPicker(p.dataset.pick);
  });
  $('#sheetQ').addEventListener('input', renderPicker);
  $('#sheetClose').addEventListener('click', closePicker);
  $('#sheet').addEventListener('click', e => { if (e.target === $('#sheet')) closePicker(); });
  $('#sheetList').addEventListener('click', e => {
    const o = e.target.closest('.opt'); if (!o) return;
    const id = o.dataset.id;
    if (pickFor === 'tune') setTuning(id);
    else {
      state[pickFor === 'from' ? 'fromId' : 'toId'] = id;
      store.set({ fromId: state.fromId, toId: state.toId });
      if (guide.on) endGuide(false);
      renderRetune();
    }
    closePicker();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#sheet').hidden) closePicker();
    if (e.key === '/' && !$('#view-atlas').hidden && document.activeElement !== $('#q')) { e.preventDefault(); $('#q').focus(); }
  });

  /* ================= ATLAS VIEW ================= */
  D.tunings.forEach(t => {
    const catName = (D.cats.find(c => c[0] === t.cat) || [, ''])[1];
    t.hay = norm([t.name, ...t.aka, t.spelling, t.spelling.replace(/\s+/g, ''), t.sub, t.desc, t.tags.join(' '), catName, t.lowc ? 'low c' : '',
      t.chords.map(c => c.label + ' ' + c.fn).join(' ')].join(' | '));
  });
  const terms = () => norm(state.q).split(/\s+/).filter(Boolean);
  function matches(t, ts) {
    if (state.cat === 'favs' ? !state.favs.has(t.id) : (state.cat !== 'all' && t.cat !== state.cat)) return false;
    if (state.lowc && !t.lowc) return false;
    if (!ts.length) return true;
    const nq = norm(state.q);
    if (/\blow\s*c\b/.test(nq)) {
      if (!t.lowc) return false;
      return nq.replace(/\blow\s*c\b/, ' ').split(/\s+/).filter(Boolean).every(w => t.hay.includes(w));
    }
    const compact = t.spelling.replace(/\s+/g, '').toLowerCase(), q = nq.replace(/\s+/g, '');
    if (ts.length >= 2 && ts.every(w => /^[a-g][#b]?$/.test(w))) return compact.includes(q);
    if (q.length >= 4 && compact.includes(q)) return true;
    return ts.every(w => t.hay.includes(w));
  }
  function hl(text, ts) {
    const out = esc(text);
    const words = ts.filter(w => !/^[a-g]$/.test(w)).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return words.length ? out.replace(new RegExp('(' + words.join('|') + ')(?![^<]*>)', 'gi'), '<mark>$1</mark>') : out;
  }
  function stringsHTML(t) {
    const notes = t.spelling.replace(/\(.*\)/, '').trim().split(/\s+/);
    return `<span class="strings" aria-label="Tuning ${esc(notes.join(' '))}">` + notes.map((n, i) => `<span class="${i === 0 && n === 'C' ? 'low-c' : ''}">${esc(n)}</span>`).join('') + '</span>';
  }
  function tabHTML(t, c) {
    const notes = t.spelling.split(/\s+/), frets = c.tab.split(/\s+/), m = midis(t);
    return '<div class="tab" aria-label="' + esc(c.label + ': ' + c.tab) + '">' +
      notes.map(n => `<span class="s">${esc(n)}</span>`).join('') +
      frets.map((f, i) => f === 'x' ? '<span class="f x" title="Muted">x</span>'
        : `<button type="button" class="f${f === '0' ? ' o' : ''}" data-note="${m[i] + +f}" aria-label="String ${STR_NUM[i]}, fret ${esc(f)}: ${noteText(m[i] + +f)}">${esc(f)}</button>`).join('') + '</div>';
  }
  function cardHTML(t, ts) {
    const open = state.open.has(t.id), fav = state.favs.has(t.id);
    const hit = c => ts.length && ts.some(w => norm(c.label) === w);
    return `<article class="card${open ? ' open' : ''}" id="t-${t.id}">
      <button class="card-head" type="button" aria-expanded="${open}" data-id="${t.id}">
        <span class="nm"><b>${hl(t.name, ts)}${fav ? '<span class="star" aria-label="favorite">★</span>' : ''}</b>${t.aka.length ? `<span class="aka">also ${hl(t.aka.join(', '), ts)}</span>` : ''}</span>
        ${stringsHTML(t)}
        <span class="sub">${hl(t.sub, ts)}</span>
        <span class="chev" aria-hidden="true">›</span>
      </button>
      <div class="body">
        ${(t.desc || t.tags.length) ? `<div class="about">${t.desc ? `<p>${hl(t.desc, ts)}</p>` : ''}${t.tags.length ? `<div class="tags">${t.tags.map(g => `<span class="tag">${esc(g)}</span>`).join('')}</div>` : ''}</div>` : ''}
        <div class="card-acts">
          <button type="button" class="play" data-use="${t.id}">Tune to this</button>
          <button type="button" class="play ghost" data-retune="${t.id}">Retune guide</button>
          <button type="button" class="play ghost" data-fav="${t.id}" aria-pressed="${fav}">${fav ? '★ Saved' : '☆ Favorite'}</button>
        </div>
        <div class="listen">
          <span class="lbl">Open strings</span>
          <div class="opens">${midis(t).map((m, i) => `<button type="button" class="open-s" data-note="${m}" aria-label="String ${STR_NUM[i]}: ${noteText(m)}">${noteHTML(m)}</button>`).join('')}</div>
          <div class="acts">
            <button type="button" class="play" data-strum="${t.id}" data-gap="0.035">▶ Strum</button>
            <button type="button" class="play ghost" data-strum="${t.id}" data-gap="0.32">Low to high</button>
          </div>
        </div>
        ${t.chords.length ? `<div class="chords">${t.chords.map((c, ci) => `
          <div class="chord${hit(c) ? ' hit' : ''}">
            <div class="ch-top"><h3>${esc(c.label)}</h3>
              <span class="acts">
                <button type="button" class="play sm" data-chord="${t.id}:${ci}" data-gap="0.03" aria-label="Strum ${esc(c.label)}">▶</button>
                <button type="button" class="play sm ghost" data-chord="${t.id}:${ci}" data-gap="0.2" aria-label="Pick ${esc(c.label)} one string at a time">Arp</button>
              </span></div>
            <span class="fn">${esc(c.fn)}</span>
            ${tabHTML(t, c)}
            ${c.note ? `<span class="cnote">${esc(c.note)}</span>` : ''}
          </div>`).join('')}</div>` : `<p class="nochords">${esc(t.nochords || 'No chord chart for this tuning.')}</p>`}
      </div>
    </article>`;
  }
  function renderChips() {
    const base = D.tunings.filter(t => !state.lowc || t.lowc);
    const chips = [['all', 'All', base.length]];
    if (state.favs.size) chips.push(['favs', '★ Favorites', base.filter(t => state.favs.has(t.id)).length]);
    D.cats.forEach(([id, name]) => chips.push([id, name, base.filter(t => t.cat === id).length]));
    if (state.cat === 'favs' && !state.favs.size) state.cat = 'all';
    $('#chips').innerHTML = `<button class="chip toggle" type="button" data-lowc aria-pressed="${state.lowc}">Low C only</button>` +
      chips.map(([id, name, n]) => `<button class="chip" type="button" data-cat="${id}" aria-pressed="${state.cat === id}">${esc(name)}<span class="n">${n}</span></button>`).join('');
  }
  function renderAtlas() {
    const ts = terms(), hits = D.tunings.filter(t => matches(t, ts));
    const auto = ts.length && hits.length <= 4;
    $('#groups').innerHTML = D.cats.map(([id, name]) => {
      const list = hits.filter(t => t.cat === id);
      if (!list.length) return '';
      if (auto) list.forEach(t => state.open.add(t.id));
      return `<section class="group"><h2>${esc(name)}</h2><div class="list">${list.map(t => cardHTML(t, ts)).join('')}</div></section>`;
    }).join('');
    $('#empty').hidden = hits.length > 0;
    $('#count').textContent = hits.length === D.tunings.length ? `${hits.length} tunings` : `${hits.length} of ${D.tunings.length}`;
    $('#clear').hidden = !state.q;
  }
  $('#q').addEventListener('input', e => { state.q = e.target.value; if (!state.q) state.open.clear(); renderAtlas(); });
  $('#clear').addEventListener('click', () => { state.q = ''; $('#q').value = ''; state.open.clear(); renderAtlas(); $('#q').focus(); });
  $('#chips').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    if (b.hasAttribute('data-lowc')) state.lowc = !state.lowc; else state.cat = b.dataset.cat;
    store.set({ cat: state.cat, lowc: state.lowc }); renderChips(); renderAtlas();
  });
  $('#expandAll').addEventListener('click', () => { $$('.card').forEach(c => state.open.add(c.id.slice(2))); renderAtlas(); });
  $('#collapseAll').addEventListener('click', () => { state.open.clear(); renderAtlas(); });
  $('#groups').addEventListener('click', e => {
    const one = e.target.closest('[data-note]');
    if (one) { S.play([+one.dataset.note], 0); flash(one); return; }
    const s = e.target.closest('[data-strum]');
    if (s) {
      const gap = +s.dataset.gap; S.play(midis(byId(s.dataset.strum)), gap); flash(s);
      s.closest('.card').querySelectorAll('.open-s').forEach((b, i) => setTimeout(() => flash(b), 30 + i * gap * 1000));
      return;
    }
    const ch = e.target.closest('[data-chord]');
    if (ch) {
      const [id, ci] = ch.dataset.chord.split(':'), t = byId(id), c = t.chords[+ci], m = midis(t), gap = +ch.dataset.gap;
      S.play(c.tab.split(/\s+/).map((f, i) => f === 'x' ? null : m[i] + +f).filter(v => v !== null), gap); flash(ch);
      [...ch.closest('.chord').querySelectorAll('.tab .f')].filter(f => !f.classList.contains('x')).forEach((f, i) => setTimeout(() => flash(f), 30 + i * gap * 1000));
      return;
    }
    const u = e.target.closest('[data-use]');
    if (u) { setTuning(u.dataset.use); location.hash = 'tune'; toast(`Tuner set to ${byId(u.dataset.use).name}`); return; }
    const r = e.target.closest('[data-retune]');
    if (r) {
      state.toId = r.dataset.retune;
      if (state.fromId === state.toId) state.fromId = 'standard';
      store.set({ fromId: state.fromId, toId: state.toId }); location.hash = 'retune'; return;
    }
    const fv = e.target.closest('[data-fav]');
    if (fv) {
      const id = fv.dataset.fav;
      state.favs.has(id) ? state.favs.delete(id) : state.favs.add(id);
      store.set({ favs: [...state.favs] }); renderChips(); renderAtlas(); return;
    }
    const h = e.target.closest('.card-head'); if (!h) return;
    const id = h.dataset.id, open = !state.open.has(id);
    open ? state.open.add(id) : state.open.delete(id);
    h.parentElement.classList.toggle('open', open); h.setAttribute('aria-expanded', open);
  });

  /* ================= ROUTING ================= */
  function route() {
    const v = ['tune', 'retune', 'frets', 'atlas'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'tune';
    $$('.view').forEach(el => { el.hidden = el.id !== 'view-' + v; });
    $$('.tabs a').forEach(a => { if (a.dataset.tab === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (v === 'tune') { renderTune(); onTuneReading(null); }
    if (v === 'retune') renderRetune();
    if (v === 'frets') renderFrets();
    if (v === 'atlas') { renderChips(); renderAtlas(); }
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => { if (document.hidden && tuner.drone) { tuner.drone(); tuner.drone = null; $('#droneBtn').setAttribute('aria-pressed', 'false'); } });

  route();
})();
