# Audio Glitcher

A small web-based realtime and offline audio "glitch" playground. Load an audio file or use your microphone, pick a glitch mode, tweak intensity and rate/size, then play or render an offline glitched WAV for download.

Features
- Realtime glitching (with microphone or loaded file) using Web Audio nodes and ScriptProcessor fallbacks.
- Multiple glitch modes: stutter, bitcrush, buffer shuffle, tape stop, granular, reverse (offline), glitch gate, pitch drop, vinyl scratch, bass boost (experimental), audio corrupt (experimental).
- Offline rendering to WAV via an OfflineAudioContext and download link.
- Simple waveform visualization and level meter.
- Randomize preset button.

How to use
1. Open index.html in a modern browser (Chrome/Edge/Firefox). For local file editing, serve via a local static server (e.g. `npx http-server` or `python -m http.server`) to avoid CORS issues with audio decoding.
2. Load an audio file with the file picker or toggle "Live Input" to use your microphone (you will be prompted for permission).
3. Select a glitch mode, adjust Intensity and Rate/Size sliders, then press Play for realtime playback or Render & Download for offline processing.
4. Use Download to save the rendered WAV.

Developer notes
- Entry points: index.html, app.js. Glitch chain logic lives in glitch.js; offline rendering is in render.js. Visualization helpers are in viz.js; WAV conversion util is in utils.js.
- Uses seedrandom from esm.sh via import map for deterministic/random behaviours.
- ScriptProcessor nodes are used for compatibility; some modes attach cleanup hooks to the source node via source._glitchCleanup to ensure intervals/processors are cleared on stop.
- Offline-only operations: reverse mode and some heavier offline approximations (e.g., denser vinyl scratch) are processed in render.js.
- Known limitations: experimental modes (bassBoost, audioCorrupt) are flagged as experimental; ScriptProcessor is deprecated but used for broader compatibility; large buffers and intensive densities may be CPU-heavy.
- When stopping playback the app attempts to run cleanup hooks attached to sources; ensure proper stop/disconnect to avoid orphaned intervals or scheduled BufferSource nodes.

Files of interest
- index.html — UI layout
- app.js — main app logic and UI wiring
- glitch.js — realtime glitch chain builder
- render.js — offline rendering logic
- viz.js, utils.js, style.css — helpers and styling

License
- MIT