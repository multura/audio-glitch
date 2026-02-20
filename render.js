/*
  Offline render logic moved out of app.js for clarity.
*/
import seedrandom from "seedrandom";

export async function renderOffline(buffer, mode, intensityVal, pVal, bassBoost=false){
  const offlineCtx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

  // Simple deterministic RNG for offline render
  const localRng = seedrandom('render'+Math.random());

  let resultBuf = null;

  if(mode === 'bitcrush'){
    const inData = [];
    for(let ch=0; ch<buffer.numberOfChannels; ch++) inData.push(buffer.getChannelData(ch));
    const outBuf = offlineCtx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const bits = Math.max(2, Math.floor(16 - intensityVal*14));
    const normfreq = Math.max(0.01, pVal);
    let ph = 0;
    let last = 0;
    for(let i=0;i<buffer.length;i++){
      ph += normfreq;
      if(ph >= 1.0){
        ph -= 1.0;
        let v=0;
        for(let ch=0;ch<buffer.numberOfChannels;ch++) v += inData[ch][i];
        v /= buffer.numberOfChannels;
        last = Math.round(v * (1<<bits)) / (1<<bits);
      }
      for(let ch=0;ch<buffer.numberOfChannels;ch++) outBuf.getChannelData(ch)[i] = last;
    }
    resultBuf = outBuf;
  } else if(mode === 'stutter'){
    const outBuf = offlineCtx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const chunk = Math.floor(Math.max(0.02, pVal*0.6) * buffer.sampleRate);
    for(let i=0;i<buffer.length;i++){
      const insert = localRng() < intensityVal*0.2;
      const srcIdx = insert ? Math.max(0, Math.floor(localRng()*(buffer.length - chunk))) : i;
      for(let ch=0; ch<buffer.numberOfChannels; ch++){
        outBuf.getChannelData(ch)[i] = buffer.getChannelData(ch)[srcIdx];
      }
    }
    resultBuf = outBuf;
  } else if(mode === 'bufferShuffle'){
    // Build output by copying the original then overlaying many short shuffled slices.
    const outBuf = offlineCtx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    // copy baseline audio
    for(let ch=0; ch<buffer.numberOfChannels; ch++){
      outBuf.getChannelData(ch).set(buffer.getChannelData(ch));
    }
    // slice parameters
    const sliceSec = Math.max(0.02, pVal * 0.8);
    const sliceLen = Math.max(1, Math.floor(sliceSec * buffer.sampleRate));
    // density controls how many slices are spawned; scale with intensity to produce more rearrangement when stronger
    const density = Math.floor(1 + intensityVal * 200);

    for(let n=0; n<density; n++){
      const dstPos = Math.floor(localRng() * Math.max(0, buffer.length - sliceLen));
      const srcPos = Math.floor(localRng() * Math.max(0, buffer.length - sliceLen));
      const reverse = localRng() > 0.7;
      const playbackScale = 0.9 + localRng() * 0.4; // slight pitch/length variation
      const gainMix = 0.4 + localRng() * 0.6; // per-slice gain
      for(let i=0; i<sliceLen; i++){
        const srcIdx = Math.min(buffer.length-1, srcPos + (reverse ? (sliceLen-1 - i) : i));
        const dstIdx = Math.min(buffer.length-1, dstPos + Math.floor(i * playbackScale));
        for(let ch=0; ch<buffer.numberOfChannels; ch++){
          const srcVal = buffer.getChannelData(ch)[srcIdx] || 0;
          // mix slice into output rather than replacing to avoid abrupt discontinuities/noise
          outBuf.getChannelData(ch)[dstIdx] = (outBuf.getChannelData(ch)[dstIdx] * (1 - gainMix * intensityVal)) + (srcVal * gainMix * intensityVal);
        }
      }
    }
    resultBuf = outBuf;
  } else if(mode === 'tapestop'){
    const out = offlineCtx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const stopStart = Math.floor(buffer.length * (0.6 + (1-intensityVal)*0.35));
    for(let i=0;i<buffer.length;i++){
      const rel = i < stopStart ? i : stopStart + Math.floor((i-stopStart) * (1 - (i-stopStart)/(buffer.length-stopStart)) * (0.9*intensityVal));
      for(let ch=0;ch<buffer.numberOfChannels;ch++) out.getChannelData(ch)[i] = buffer.getChannelData(ch)[Math.min(buffer.length-1, Math.floor(rel))];
    }
    resultBuf = out;
  } else if(mode === 'granular'){
    const out = offlineCtx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const grainSize = Math.floor(Math.max(0.02, pVal*0.4) * buffer.sampleRate);
    for(let i=0;i<buffer.length;i++){
      let val = 0;
      const samples = Math.max(1, Math.floor(intensityVal*6));
      for(let s=0;s<samples;s++){
        const start = Math.floor(localRng()*(buffer.length - grainSize));
        const idx = start + (i % grainSize);
        for(let ch=0;ch<buffer.numberOfChannels;ch++){
          val += buffer.getChannelData(ch)[Math.min(buffer.length-1, idx)];
        }
      }
      val /= (samples * buffer.numberOfChannels);
      for(let ch=0;ch<buffer.numberOfChannels;ch++) out.getChannelData(ch)[i] = val;
    }
    resultBuf = out;
  } else if(mode === 'reverse'){
    const out = offlineCtx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for(let ch=0; ch<buffer.numberOfChannels; ch++){
      const src = buffer.getChannelData(ch);
      const dst = out.getChannelData(ch);
      for(let i=0;i<src.length;i++) dst[i] = src[src.length-1-i];
    }
    resultBuf = out;
  } else if(mode === 'glitchGate'){
    const out = offlineCtx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const rate = Math.max(0.05, pVal*10);
    for(let i=0;i<buffer.length;i++){
      const on = localRng() < intensityVal;
      for(let ch=0;ch<buffer.numberOfChannels;ch++){
        out.getChannelData(ch)[i] = on ? buffer.getChannelData(ch)[i] : 0;
      }
      if(i % Math.floor(rate*buffer.sampleRate) === 0) localRng();
    }
    resultBuf = out;
  } else if(mode === 'pitchDrop'){
    const out = offlineCtx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const stopStart = Math.floor(buffer.length * (0.5 + (1-intensityVal)*0.4));
    for(let i=0;i<buffer.length;i++){
      const rel = i < stopStart ? i : stopStart + Math.floor((i-stopStart) * (1 - (i-stopStart)/(buffer.length-stopStart)) * (0.9*intensityVal));
      for(let ch=0;ch<buffer.numberOfChannels;ch++) out.getChannelData(ch)[i] = buffer.getChannelData(ch)[Math.min(buffer.length-1, Math.floor(rel))];
    }
    resultBuf = out;
  } else if(mode === 'vinylScratch'){
    // Offline vinyl scratch simulation: spawn short reversed/forward slices with pitch variation
    const out = offlineCtx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    // copy baseline
    for(let ch=0; ch<buffer.numberOfChannels; ch++){
      out.getChannelData(ch).set(buffer.getChannelData(ch));
    }
    const localRng = seedrandom('scratch'+Math.random());
    const sliceSec = Math.max(0.01, pVal * 0.12); // very short slices
    const sliceLen = Math.floor(sliceSec * buffer.sampleRate);
    const density = Math.floor(1 + intensityVal * 300); // more scratches with intensity
    for(let n=0;n<density;n++){
      const pos = Math.floor(localRng() * Math.max(0, buffer.length - sliceLen));
      const reverse = localRng() > 0.5;
      const pitch = 0.6 + localRng()*1.4;
      // write slice into output with stronger transient
      for(let i=0;i<sliceLen;i++){
        const srcIdx = pos + i;
        const dstIdx = Math.min(buffer.length-1, pos + Math.floor(i * (1/pitch)));
        for(let ch=0; ch<buffer.numberOfChannels; ch++){
          const src = buffer.getChannelData(ch);
          let val = src[reverse ? (pos + (sliceLen-1-i)) : srcIdx] || 0;
          // apply small envelope and mix
          const env = 1.0 - Math.abs((i / sliceLen) - 0.5) * 2;
          out.getChannelData(ch)[dstIdx] = (out.getChannelData(ch)[dstIdx] * 0.6) + (val * env * 0.8 * intensityVal);
        }
      }
    }
    resultBuf = out;
  } else if(mode === 'bassBoost'){
    // Offline stronger bass boost experimental: lowshelf + slight saturation via waveshaping
    const outBuf = offlineCtx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    // copy input
    for(let ch=0; ch<buffer.numberOfChannels; ch++){
      outBuf.getChannelData(ch).set(buffer.getChannelData(ch));
    }
    // simple low-shelf approximation by boosting low-frequency samples via a running low-pass envelope
    const cutoff = 200;
    const rc = 1/(2*Math.PI*cutoff);
    const dt = 1 / buffer.sampleRate;
    const alpha = dt / (rc + dt);
    for(let ch=0; ch<buffer.numberOfChannels; ch++){
      const src = buffer.getChannelData(ch);
      const dst = outBuf.getChannelData(ch);
      let low = 0;
      const gain = Math.min(24, 8 * intensityVal + 6) / 6; // scale
      for(let i=0;i<src.length;i++){
        low += (src[i] - low) * alpha;
        dst[i] = src[i] + low * gain * 0.5;
        // soft clip
        if(dst[i] > 1) dst[i] = 1;
        if(dst[i] < -1) dst[i] = -1;
      }
    }
    resultBuf = outBuf;
  } else if(mode === 'audioCorrupt'){
    // Offline experimental corrupt: random freezes, bit mangles, short mutes
    const out = offlineCtx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for(let ch=0; ch<buffer.numberOfChannels; ch++){
      const src = buffer.getChannelData(ch);
      const dst = out.getChannelData(ch);
      let i=0;
      while(i<src.length){
        if(Math.random() < intensityVal*0.002){
          const len = Math.floor(Math.random()*512 + 16);
          const val = src[i];
          for(let j=0;j<len && i<src.length;j++,i++) dst[i] = val;
          continue;
        }
        if(Math.random() < intensityVal*0.01){
          // bit perturb
          let q = Math.floor((src[i] + 1) * 32767);
          q = q ^ (Math.floor(Math.random()*255) << (Math.floor(Math.random()*3)*4));
          dst[i] = (q / 32767) - 1;
          i++; continue;
        }
        if(Math.random() < intensityVal*0.001){
          dst[i] = 0; i++; continue;
        }
        dst[i] = src[i] + ((Math.random()-0.5)*0.02*intensityVal);
        i++;
      }
    }
    resultBuf = out;
  } else {
    resultBuf = buffer;
  }

  // If bassBoost requested, run the result through a lowshelf in an offline context
  if(bassBoost){
    const procCtx = new OfflineAudioContext(resultBuf.numberOfChannels, resultBuf.length, resultBuf.sampleRate);
    const src = procCtx.createBufferSource();
    src.buffer = resultBuf;
    const shelf = procCtx.createBiquadFilter();
    shelf.type = 'lowshelf';
    shelf.frequency.value = 200;
    shelf.gain.value = Math.min(18, 6 * intensityVal);
    src.connect(shelf);
    shelf.connect(procCtx.destination);
    src.start();
    const rendered = await procCtx.startRendering();
    return rendered;
  }

  return resultBuf;
}