/*
  Visualization helpers extracted from app.js
*/
export function setupViz(canvas){
  const ctx = canvas.getContext('2d');
  function fitCanvas(){
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
    ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
  }
  fitCanvas();
  window.addEventListener('resize', fitCanvas);
}

let vizAnim = null;
let vizCtx = null;
let vizCanvas = null;

export function drawViz(analyser){
  vizCanvas = document.getElementById('viz');
  vizCtx = vizCanvas.getContext('2d');
  function render(){
    if(!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);
    vizCtx.clearRect(0,0,vizCanvas.clientWidth,vizCanvas.clientHeight);
    vizCtx.lineWidth = 1;
    vizCtx.strokeStyle = '#fff';
    vizCtx.beginPath();
    const h = vizCanvas.clientHeight;
    for(let i=0;i<data.length;i++){
      const x = (i / data.length) * vizCanvas.clientWidth;
      const v = data[i] / 128.0;
      const y = (v * h) / 2;
      if(i===0) vizCtx.moveTo(x,y); else vizCtx.lineTo(x,y);
    }
    vizCtx.stroke();
    vizAnim = requestAnimationFrame(render);
  }
  cancelAnimationFrame(vizAnim);
  vizAnim = requestAnimationFrame(render);
}

export function stopViz(){
  if(vizAnim) cancelAnimationFrame(vizAnim);
}