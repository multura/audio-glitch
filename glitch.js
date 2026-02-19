/*
  Contains the realtime createGlitchChain function moved out of app.js.
  It mirrors the previous createGlitchChain implementation.
*/
import seedrandom from "seedrandom";
let rng = seedrandom();

export function setRngSeed(s){
  rng = seedrandom(s);
}

export async function createGlitchChain(ctx, source, intensityVal, pVal, mode, isLive=false, bassBoost=false){
  const input = ctx.createGain();
  try{ source.connect(input); }catch(e){ /* ignore */ }

  let out = input;

  if(mode === 'stutter'){
    if(!isLive && source.buffer){
      const stutterNode = ctx.createGain();
      const chunkSec = Math.max(0.02, pVal * 0.6);
      const interval = 0.05;
      const handle = setInterval(()=>{
        if(!source.buffer) return;
        const b = source.buffer;
        const start = (rng()*Math.max(0, b.duration - chunkSec));
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.loop = false;
        s.connect(stutterNode);
        s.start();
        setTimeout(()=>{ try{ s.stop(); s.disconnect(); }catch(e){} }, 100 + (1-intensityVal)*400 + rng()*500);
      }, interval*1000);
      // attach cleanup hook to source so callers can clear intervals/processors on stop
      source._glitchCleanup = source._glitchCleanup || [];
      source._glitchCleanup.push(()=>{ try{ clearInterval(handle); }catch(e){} });
      const _prev_onended_stutter = source.onended;
      source.onended = ()=>{ try{ clearInterval(handle); }catch(e){} if(typeof _prev_onended_stutter === 'function') _prev_onended_stutter(); };
      out = stutterNode;
    } else {
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const chunk = Math.floor(Math.max(0.01, pVal*0.5) * ctx.sampleRate);
      const ring = new Float32Array(chunk);
      let rp=0, filled=false, counter=0;
      proc.onaudioprocess = function(e){
        const inData = e.inputBuffer.getChannelData(0);
        const outData = e.outputBuffer.getChannelData(0);
        for(let i=0;i<inData.length;i++){
          ring[rp] = inData[i];
          rp = (rp+1)%chunk;
          if(++counter > chunk) filled = true;
          outData[i] = filled && (rng() < intensityVal*0.7) ? ring[(rp+i)%chunk] : inData[i];
        }
      };
      out = proc;
      input.connect(proc);
    }
  } else if(mode === 'bitcrush'){
    const bits = Math.max(2, Math.floor(16 - intensityVal*14));
    const normfreq = Math.max(0.01, pVal);
    const reducer = ctx.createScriptProcessor(4096, 1, 1);
    let ph = 0;
    let last = 0;
    reducer.onaudioprocess = function(e){
      const input = e.inputBuffer.getChannelData(0);
      const output = e.outputBuffer.getChannelData(0);
      for(let i=0;i<input.length;i++){
        ph += normfreq;
        if(ph >= 1.0){
          ph -= 1.0;
          last = Math.round(input[i] * (1<<bits)) / (1<<bits);
        }
        output[i] = last;
      }
    };
    // cleanup for processor
    source._glitchCleanup = source._glitchCleanup || [];
    source._glitchCleanup.push(()=>{ try{ reducer.disconnect(); reducer.onaudioprocess = null; }catch(e){} });
    out = reducer;
    input.connect(reducer);
  } else if(mode === 'bufferShuffle'){
    if(!isLive && source.buffer){
      // Continuous shuffled-slice spawner for offline/recorded buffer playback
      const shuffleGain = ctx.createGain();
      shuffleGain.gain.value = intensityVal;
      const originalGain = ctx.createGain();
      originalGain.gain.value = 1 - intensityVal;
      // keep original audio present but reduced
      try{ input.connect(originalGain); originalGain.connect(shuffleGain); }catch(e){}
      const b = source.buffer;
      const sliceSec = Math.max(0.02, pVal * 0.8);
      const minInterval = Math.max(30, 200 - intensityVal*140); // ms between spawns
      // spawn function creates a short slice and schedules it
      const spawnSlice = ()=>{
        const s = ctx.createBufferSource();
        const bufLen = Math.floor(sliceSec * b.sampleRate);
        const buf = ctx.createBuffer(b.numberOfChannels, bufLen, b.sampleRate);
        const start = Math.floor(rng() * Math.max(0, b.length - bufLen));
        for(let ch=0; ch<b.numberOfChannels; ch++){
          const src = b.getChannelData(ch);
          const dst = buf.getChannelData(ch);
          for(let j=0;j<dst.length;j++) dst[j] = src[start + j];
          if(rng() > 0.7) Array.prototype.reverse.call(dst);
        }
        s.buffer = buf;
        s.playbackRate.value = 0.9 + rng()*0.3;
        const g = ctx.createGain();
        g.gain.value = 0.4 + rng()*0.6;
        s.connect(g);
        g.connect(shuffleGain);
        // schedule slightly in future for smoothness
        const when = ctx.currentTime + rng()*0.15;
        try{ s.start(when); }catch(e){}
        // ensure cleanup of this scheduled source
        setTimeout(()=>{ try{ s.stop(); s.disconnect(); }catch(e){} }, (sliceSec + 0.5) * 1000);
      };
      // initial burst
      const initialCount = Math.max(1, Math.floor(4 * intensityVal + 1));
      for(let i=0;i<initialCount;i++) spawnSlice();
      // continuous spawning interval
      const handle = setInterval(()=>{
        // probabilistically spawn 1..2 slices depending on intensity
        const toSpawn = (rng() < intensityVal) ? 1 + Math.floor(rng()*1.5) : 1;
        for(let i=0;i<toSpawn;i++) spawnSlice();
      }, Math.max(40, minInterval));
      // attach cleanup so stopping removes the interval and leaves no orphaned sources
      source._glitchCleanup = source._glitchCleanup || [];
      source._glitchCleanup.push(()=>{ try{ clearInterval(handle); }catch(e){} });
      const _prev_onended_bufferShuffle = source.onended;
      source.onended = ()=>{ try{ clearInterval(handle); }catch(e){} if(typeof _prev_onended_bufferShuffle === 'function') _prev_onended_bufferShuffle(); };
      // mark that input already wired to shuffleGain chain
      try{ shuffleGain._noAutoConnect = true; }catch(e){}
      out = shuffleGain;
    } else {
      const delay = ctx.createDelay(1.0);
      const fb = ctx.createGain();
      fb.gain.value = 0.2 * intensityVal;
      delay.delayTime.value = Math.max(0.01, pVal*0.5);
      input.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      out = delay;
    }
  } else if(mode === 'tapestop'){
    if(!isLive && source.buffer){
      const gainNode = ctx.createGain();
      input.connect(gainNode);
      out = gainNode;
    } else {
      const delay = ctx.createDelay(1.0);
      const fb = ctx.createGain();
      fb.gain.value = 0.5 * intensityVal;
      input.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      out = delay;
    }
  } else if(mode === 'granular'){
    if(!isLive && source.buffer){
      const gGain = ctx.createGain();
      gGain.gain.value = intensityVal;
      const b = source.buffer;
      const grainSize = Math.max(0.02, pVal*0.4);
      const density = Math.max(5, Math.floor(40 * intensityVal + 1));
      const grains = setInterval(()=>{
        for(let i=0;i<Math.floor(density);i++){
          const s = ctx.createBufferSource();
          const start = Math.max(0, rng() * Math.max(0, b.duration - grainSize));
          s.buffer = b;
          s.playbackRate.value = 0.8 + rng()*0.8;
          const g = ctx.createGain();
          g.gain.value = 0.6;
          s.connect(g);
          g.connect(gGain);
          s.start(ctx.currentTime + rng()*0.05, start, grainSize);
          setTimeout(()=>{ try{ s.stop(); s.disconnect(); }catch(e){} }, (grainSize+0.1)*1000);
        }
      }, Math.max(40, 120 - intensityVal*100));
      source._glitchCleanup = source._glitchCleanup || [];
      source._glitchCleanup.push(()=>{ try{ clearInterval(grains); }catch(e){} });
      const _prev_onended_bufferShuffle = source.onended;
      source.onended = ()=>{ try{ clearInterval(grains); }catch(e){} if(typeof _prev_onended_bufferShuffle === 'function') _prev_onended_bufferShuffle(); };
      out = gGain;
    } else {
      const noise = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, 256, ctx.sampleRate);
      buf.getChannelData(0).fill(0);
      noise.buffer = buf;
      noise.loop = true;
      const g = ctx.createGain(); g.gain.value = 0.0001;
      noise.connect(g);
      g.connect(input);
      try{ noise.start(); }catch(e){}
      out = input;
    }
  } else if(mode === 'reverse'){
    out = input;
  } else if(mode === 'glitchGate'){
    const gate = ctx.createGain();
    gate.gain.value = 1;
    const rate = Math.max(0.05, pVal*10);
    const trig = setInterval(()=>{
      const on = rng() < intensityVal;
      gate.gain.setValueAtTime(on ? 1 : 0, ctx.currentTime);
      gate.gain.linearRampToValueAtTime(on ? 1 : 0, ctx.currentTime + rate*0.4);
    }, rate*200);
    // attach cleanup
    source._glitchCleanup = source._glitchCleanup || [];
    source._glitchCleanup.push(()=>{ try{ clearInterval(trig); }catch(e){} });
    try{ input.connect(gate); }catch(e){}
    const _prev_onended_glitchGate = source.onended;
    source.onended = ()=>{ try{ if(!isLive) clearInterval(trig); }catch(e){} if(typeof _prev_onended_glitchGate === 'function') _prev_onended_glitchGate(); };
    out = gate;
  } else if(mode === 'pitchDrop'){
    if(isLive){
      const delay = ctx.createDelay(1.0);
      const fb = ctx.createGain();
      fb.gain.value = 0.3 * intensityVal;
      input.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      let cw = 0;
      const handle = setInterval(()=>{
        delay.delayTime.value = 0.01 + (pVal * 0.9) * (0.5 + rng()*0.5) * (1 + cw*0.1);
        cw = (cw+1)%10;
      }, 200);
      source._glitchCleanup = source._glitchCleanup || [];
      source._glitchCleanup.push(()=>{ try{ clearInterval(handle); }catch(e){} });
      const _prev_onended_pitchDrop = source.onended;
      source.onended = ()=>{ try{ if(!isLive) clearInterval(handle); }catch(e){} if(typeof _prev_onended_pitchDrop === 'function') _prev_onended_pitchDrop(); };
      out = delay;
    } else out = input;
  } else if(mode === 'vinylScratch'){
    // Realtime vinyl scratch simulation: spawn short reversed/forward slices and rapid pitch/position changes
    if(!isLive && source.buffer){
      const scratchGain = ctx.createGain();
      scratchGain.gain.value = 1;
      const b = source.buffer;
      const sliceSec = Math.max(0.01, pVal * 0.12);
      const spawn = ()=>{
        const s = ctx.createBufferSource();
        const bufLen = Math.floor(sliceSec * b.sampleRate);
        const buf = ctx.createBuffer(b.numberOfChannels, bufLen, b.sampleRate);
        const start = Math.floor(rng() * Math.max(0, b.length - bufLen));
        const reverse = rng() > 0.5;
        for(let ch=0; ch<b.numberOfChannels; ch++){
          const src = b.getChannelData(ch);
          const dst = buf.getChannelData(ch);
          for(let j=0;j<dst.length;j++){
            dst[j] = src[start + (reverse ? (bufLen-1-j) : j)];
          }
          // occasional extra transient boost
          if(rng() < 0.3) for(let j=0;j<Math.min(8,dst.length);j++) dst[j] *= 1.2;
        }
        s.buffer = buf;
        s.playbackRate.value = 0.8 + rng()*1.6;
        const g = ctx.createGain();
        g.gain.value = 0.6 + rng()*0.8;
        s.connect(g);
        g.connect(scratchGain);
        const when = ctx.currentTime + rng()*0.06;
        try{ s.start(when); }catch(e){}
        setTimeout(()=>{ try{ s.stop(); s.disconnect(); }catch(e){} }, (sliceSec + 0.3) * 1000);
      };
      // continuous sporadic scratches
      const handle = setInterval(()=>{
        const count = rng() < intensityVal ? 1 + Math.floor(rng()*2) : 1;
        for(let i=0;i<count;i++) spawn();
      }, Math.max(30, 200 - intensityVal*160));
      source._glitchCleanup = source._glitchCleanup || [];
      source._glitchCleanup.push(()=>{ try{ clearInterval(handle); }catch(e){} });
      const _prev_onended = source.onended;
      source.onended = ()=>{ try{ clearInterval(handle); }catch(e){} if(typeof _prev_onended === 'function') _prev_onended(); };
      try{ input.connect(scratchGain); }catch(e){}
      try{ scratchGain._noAutoConnect = true; }catch(e){}
      out = scratchGain;
    } else {
      // live path: small script processor that jitter-reads a ring buffer to create scratchy repeats
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const chunk = Math.floor(Math.max(0.01, pVal*0.2) * ctx.sampleRate);
      const ring = new Float32Array(chunk);
      let rp=0, filled=false, counter=0;
      let freezeLen = 0;
      proc.onaudioprocess = function(e){
        const inData = e.inputBuffer.getChannelData(0);
        const outData = e.outputBuffer.getChannelData(0);
        for(let i=0;i<inData.length;i++){
          ring[rp] = inData[i];
          rp = (rp+1)%chunk;
          if(++counter > chunk) filled = true;
          if(freezeLen > 0){
            outData[i] = ring[(rp+i)%chunk];
            freezeLen--;
            continue;
          }
          if(rng() < intensityVal*0.005){
            freezeLen = Math.floor(rng()*Math.max(4, chunk*0.2));
            outData[i] = ring[(rp+i)%chunk];
            continue;
          }
          // occasional reversed playback emulation: pull from earlier in ring
          if(filled && rng() < intensityVal*0.01){
            const idx = (rp - Math.floor(rng()*chunk) + chunk) % chunk;
            outData[i] = ring[idx];
            continue;
          }
          outData[i] = inData[i];
        }
      };
      source._glitchCleanup = source._glitchCleanup || [];
      source._glitchCleanup.push(()=>{ try{ proc.disconnect(); proc.onaudioprocess = null; }catch(e){} });
      out = proc;
    }
  } else if(mode === 'bassBoost'){
    // Experimental realtime bass boost mode: stronger lowshelf plus subtle saturation
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'lowshelf';
    shelf.frequency.value = 150;
    shelf.gain.value = Math.min(24, 8 * intensityVal + 6); // more aggressive
    const waveShaper = ctx.createWaveShaper();
    // mild soft clipping curve scaled by intensity
    const curveLen = 2048;
    const curve = new Float32Array(curveLen);
    const k = 2 + intensityVal * 8;
    for(let i=0;i<curveLen;i++){
      const x = (i*2/curveLen) - 1;
      curve[i] = (1 + k) * x / (1 + k * Math.abs(x));
    }
    waveShaper.curve = curve;
    waveShaper.oversample = '2x';
    try{ input.connect(shelf); shelf.connect(waveShaper); }catch(e){}
    out = waveShaper;
  } else if(mode === 'audioCorrupt'){
    // Experimental aggressive corrupting mode: random bit flips, sample skips and burst mutes.
    const proc = ctx.createScriptProcessor(4096, 2, 2);
    proc.onaudioprocess = function(e){
      const chCount = Math.min(e.inputBuffer.numberOfChannels, 2);
      for(let ch=0; ch<chCount; ch++){
        const inData = e.inputBuffer.getChannelData(ch);
        const outData = e.outputBuffer.getChannelData(ch);
        for(let i=0;i<inData.length;i++){
          let v = inData[i];
          // random sample freeze/skips
          if(rng() < intensityVal*0.002) {
            const len = Math.floor(rng() * 256 + 16);
            const val = v;
            for(let j=0;j<len && i<inData.length;j++,i++) outData[i] = val;
            i--; continue;
          }
          // bit noise: quantize occasionally and XOR-like perturb
          if(rng() < intensityVal*0.01){
            let q = Math.floor((v + 1) * 32767);
            q = q ^ (Math.floor(rng()*255) << (Math.floor(rng()*3)*4));
            v = (q / 32767) - 1;
          }
          // short bursts of mute
          if(rng() < intensityVal*0.001) { outData[i] = 0; continue; }
          // otherwise small random jitter
          outData[i] = v + ((rng()-0.5)*0.02*intensityVal);
        }
      }
    };
    // cleanup for corrupt processor
    source._glitchCleanup = source._glitchCleanup || [];
    source._glitchCleanup.push(()=>{ try{ proc.disconnect(); proc.onaudioprocess = null; }catch(e){} });
    out = proc;
  }

  // Insert optional lowshelf bass boost after built chain
  if(bassBoost){
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'lowshelf';
    shelf.frequency.value = 200;
    shelf.gain.value = Math.min(18, 6 * intensityVal); // modest boost scaled by intensity
    try{
      if(out !== input && out instanceof AudioNode){
        // chain -> shelf
        try{ out.connect(shelf); }catch(e){}
      } else {
        // input -> shelf
        try{ input.connect(shelf); }catch(e){}
      }
      return shelf;
    }catch(e){
      // fallback to original out
    }
  }

  if(out !== input) {
    if(out instanceof AudioNode) {
      // only auto-connect if the branch didn't already wire the input
      if(!out._noAutoConnect){
        try{ input.connect(out); }catch(e){}
      }
      return out;
    }
  }
  return out;
}