import seedrandom from "seedrandom";
import { createGlitchChain } from "./glitch.js";
import { renderOffline } from "./render.js";
import { bufferToWav } from "./utils.js";
import { setupViz, drawViz, stopViz } from "./viz.js";

const fileIn = document.getElementById('file');
const liveToggle = document.getElementById('liveToggle');
const playBtn = document.getElementById('play');
const stopBtn = document.getElementById('stop');
const renderBtn = document.getElementById('render');
const downloadA = document.getElementById('download');
const modeSel = document.getElementById('mode');
const intensity = document.getElementById('intensity');
const param = document.getElementById('param');
const randomizeBtn = document.getElementById('randomize');
const meterFill = document.getElementById('meterFill');

const canvas = document.getElementById('viz');

let audioCtx = null;
let sourceNode = null;
let sourceRendered = null;
let micStream = null;
let micSource = null;
let analyser = null;
let animationId = null;
let currentBuffer = null;
let playing = false;
let rng = seedrandom();

setupViz(canvas);

function updateMeter(val){
  meterFill.style.width = `${Math.min(100, Math.max(0, val*100))}%`;
}

/* ensure an AudioContext exists / is unlocked on user interaction (helps iPhone/Safari) */
function ensureAudioCtx(){
  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  // try to resume if suspended (iOS requires user gesture)
  if(audioCtx.state === 'suspended') {
    audioCtx.resume().catch(()=>{/* ignore */});
  }
}

/* robust decoder to support older Safari callback-style decodeAudioData */
async function decodeAudioBuffer(arrBuffer){
  // prefer promise-style if available
  try{
    // some browsers return a promise
    const decoded = await audioCtx.decodeAudioData(arrBuffer.slice(0));
    return decoded;
  }catch(err){
    // fallback for callback-style decodeAudioData
    return await new Promise((resolve, reject)=>{
      try{
        audioCtx.decodeAudioData(arrBuffer.slice(0), resolve, reject);
      }catch(e){
        reject(e);
      }
    });
  }
}

/* create/unlock audio context on user gestures that commonly appear on iOS */
['click','touchstart','keydown'].forEach(evt=>{
  window.addEventListener(evt, ensureAudioCtx, {passive:true, once:true});
});

fileIn.addEventListener('change', async (e)=>{
  const f = e.target.files && e.target.files[0];
  if(!f) return;
  ensureAudioCtx();
  const arr = await f.arrayBuffer();
  try{
    currentBuffer = await decodeAudioBuffer(arr);
  }catch(err){
    console.error('decodeAudioData failed', err);
    return;
  }
  playBtn.disabled = false;
  stopBtn.disabled = true;
  renderBtn.disabled = false;
  downloadA.classList.add('disabled');
  downloadA.href = '';
  updateMeter(0);
});

liveToggle.addEventListener('change', async ()=>{
  const liveDesc = document.getElementById('liveDesc');
  if(liveToggle.checked){
    liveDesc.textContent = 'LIVE INPUT: Requesting microphone access…';
    try{
      micStream = await navigator.mediaDevices.getUserMedia({audio:true});
      if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      micSource = audioCtx.createMediaStreamSource(micStream);
      playBtn.disabled = false;
      stopBtn.disabled = false;
      renderBtn.disabled = true;
      liveDesc.textContent = 'LIVE INPUT: Microphone active - using live input for realtime glitching.';
    }catch(e){
      liveToggle.checked = false;
      liveDesc.textContent = 'LIVE INPUT: Microphone access denied or unavailable.';
      console.warn('mic denied', e);
    }
  }else{
    stopMic();
    if(!currentBuffer) playBtn.disabled = true;
    renderBtn.disabled = currentBuffer ? false : true;
    liveDesc.textContent = 'LIVE INPUT: Use your microphone as the realtime audio source for glitching; toggle to enable live input.';
  }
});

playBtn.addEventListener('click', async ()=>{
  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if(playing) return;

  const master = audioCtx.createGain();
  master.gain.value = 1;

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;

  if(liveToggle.checked && micSource){
    const nodeChain = await createGlitchChain(audioCtx, micSource, intensity.valueAsNumber, param.valueAsNumber, modeSel.value, true, false);
    nodeChain.connect(master);
    master.connect(analyser);
    analyser.connect(audioCtx.destination);
    playing = true;
    playBtn.disabled = true;
    stopBtn.disabled = false;
    drawViz(analyser);
    monitorLevel();
    return;
  }

  if(!currentBuffer) return;
  sourceNode = audioCtx.createBufferSource();
  sourceNode.buffer = currentBuffer;

  const nodeChain = await createGlitchChain(audioCtx, sourceNode, intensity.valueAsNumber, param.valueAsNumber, modeSel.value, false, false);
  nodeChain.connect(master);
  master.connect(analyser);
  analyser.connect(audioCtx.destination);

  sourceNode.start();
  playing = true;
  playBtn.disabled = true;
  stopBtn.disabled = false;
  drawViz(analyser);
  monitorLevel();
  sourceNode.onended = ()=> {
    playing = false;
    playBtn.disabled = false;
    stopBtn.disabled = true;
    stopViz();
    updateMeter(0);
  }
});

stopBtn.addEventListener('click', ()=>{
  if(liveToggle.checked){
    stopMic();
    playBtn.disabled = currentBuffer ? false : true;
    stopBtn.disabled = true;
    return;
  }
  if(sourceNode){
    // run any cleanup hooks attached by createGlitchChain
    try{
      if(sourceNode._glitchCleanup && Array.isArray(sourceNode._glitchCleanup)){
        sourceNode._glitchCleanup.forEach(fn=>{ try{ fn(); }catch(e){} });
      }
    }catch(e){}
    try{ sourceNode.stop(); }catch(e){}
    try{ sourceNode.disconnect(); }catch(e){}
    sourceNode = null;
    // update UI after stopping the live/source playback
    playing = false;
    playBtn.disabled = currentBuffer ? false : true;
    stopBtn.disabled = true;
    stopViz();
    updateMeter(0);
  }
  if(sourceRendered){
    try{
      if(sourceRendered._glitchCleanup && Array.isArray(sourceRendered._glitchCleanup)){
        sourceRendered._glitchCleanup.forEach(fn=>{ try{ fn(); }catch(e){} });
      }
    }catch(e){}
    try{ sourceRendered.stop(); }catch(e){}
    try{ sourceRendered.disconnect(); }catch(e){}
    sourceRendered = null;
    playing = false;
    playBtn.disabled = currentBuffer ? false : true;
    stopBtn.disabled = true;
    stopViz();
    updateMeter(0);
  }
});

/* mode descriptions shown beneath selector */
const modeDescriptions = {
  stutter: "Repeats short chunks to create rhythmic stutters and repeats.",
  bitcrush: "Reduces bit depth / sample rate for gritty lo-fi digital distortion.",
  bufferShuffle: "Plays shuffled slices of the buffer to create jumpy rearrangements.",
  tapestop: "Simulates a slowing tape or vinyl stop effect toward the end of playback.",
  granular: "Plays many short grains from the source to create dense textures.",
  reverse: "Completely reverses the audio (offline render only).",
  glitchGate: "Randomly gates audio on/off creating choppy, rhythmic cuts.",
  pitchDrop: "Gradually shifts playback timing to produce pitch-drop effects.",
  vinylScratch: "Short reversed/forward slices and rapid pitch/position changes to emulate scratching.",
  bassBoost: "Enhances low frequencies and soft-saturates for heavier bass (experimental).",
  audioCorrupt: "Aggressive corruptions: bit flips, freezes and dropouts (experimental)."
};

function updateModeDescription(){
  const el = document.getElementById('modeDesc');
  if(!el) return;
  const key = modeSel.value;
  el.textContent = modeDescriptions[key] || "";
}
modeSel.addEventListener('change', updateModeDescription);
updateModeDescription();

randomizeBtn.addEventListener('click', ()=>{
  rng = seedrandom(String(Math.random()));
  const modes = ['stutter','bitcrush','bufferShuffle','tapestop','granular','reverse','glitchGate','pitchDrop','vinylScratch','bassBoost','audioCorrupt'];
  modeSel.value = modes[Math.floor(rng()*modes.length)];
  intensity.value = (rng()*0.9+0.05).toFixed(2);
  param.value = (rng()*0.9+0.02).toFixed(2);
  updateModeDescription();
});

renderBtn.addEventListener('click', async ()=>{
  if(!currentBuffer) return;
  renderBtn.disabled = true;
  const rendered = await renderOffline(currentBuffer, modeSel.value, intensity.valueAsNumber, param.valueAsNumber, false);
  const wav = bufferToWav(rendered);
  const blob = new Blob([wav], {type:'audio/wav'});
  const url = URL.createObjectURL(blob);
  downloadA.href = url;
  downloadA.classList.remove('disabled');

  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  try{ await audioCtx.resume(); }catch(e){}

  if(sourceRendered){
    try{ sourceRendered.stop(); }catch(e){}
    try{ sourceRendered.disconnect(); }catch(e){}
    sourceRendered = null;
  }

  const master = audioCtx.createGain();
  master.gain.value = 1;
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;

  sourceRendered = audioCtx.createBufferSource();
  sourceRendered.buffer = rendered;
  sourceRendered.loop = false;

  try{ sourceRendered.connect(master); }catch(e){}
  master.connect(analyser);
  analyser.connect(audioCtx.destination);

  sourceRendered.start();
  playing = true;
  playBtn.disabled = true;
  stopBtn.disabled = false;
  drawViz(analyser);
  monitorLevel();

  sourceRendered.onended = ()=> {
    playing = false;
    playBtn.disabled = false;
    stopBtn.disabled = true;
    stopViz();
    updateMeter(0);
    sourceRendered = null;
  };

  renderBtn.disabled = false;
});

function stopMic(){
  if(micStream){
    micStream.getTracks().forEach(t=>t.stop());
    micStream = null;
  }
  if(micSource){
    try{
      if(micSource._glitchCleanup && Array.isArray(micSource._glitchCleanup)){
        micSource._glitchCleanup.forEach(fn=>{ try{ fn(); }catch(e){} });
      }
    }catch(e){}
    try{ micSource.disconnect(); }catch(e){}
    micSource = null;
  }
  liveToggle.checked = false;
}

function monitorLevel(){
  if(!analyser) return;
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(data);
  let sum=0;
  for(let i=0;i<data.length;i++){
    const v = (data[i]-128)/128;
    sum += Math.abs(v);
  }
  const avg = sum / data.length;
  updateMeter(Math.min(1, avg*1.5));
  if((playing && !liveToggle.checked) || (liveToggle.checked && micSource)) requestAnimationFrame(monitorLevel);
}
