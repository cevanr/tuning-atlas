# Tuning Atlas

A tuner, retune guide and chord atlas for 50+ alternate guitar tunings. Installable on a phone and works offline.

- **Tune:** a chromatic tuner locked to the tuning you pick, with each string in its real octave (a low C reads as C2, not C3). Auto-detects the string, or tap one to lock it. Reference tone, drone, and adjustable A4.
- **Retune:** pick where you are and where you're going. It lists every string's move in half-steps, flags big jumps, then walks you through string by string with the tuner.
- **Frets:** tap frets and it names the chord in your current tuning, or light up any scale (pentatonics, modes, hirajōshi, in, hijaz) across the neck.
- **Capo:** set a capo and see what your open strings sound like, find the capo fret for any key (and other tunings that suit it), or paste a song's chords to see the easiest capo positions.
- **Atlas:** every tuning with what it sounds like, who played it, and a verified I · IV · V · i chord chart you can hear.

No build step and no dependencies: plain HTML, CSS and JavaScript.

## Run it locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000. The microphone needs `localhost` or `https`.

## How it works

- `js/pitch.js` detects pitch with the YIN algorithm. It's accurate to under a cent and reads down to about 50 Hz.
- `js/synth.js` is a Karplus–Strong plucked-string synth, tuned exactly with a playback-rate trim.
- `js/data.js` holds the tunings and chords. Every chord is checked note by note against its tuning.
- `sw.js` caches the app for offline use. Bump `VERSION` there when you change files.
