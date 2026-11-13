/**
 * MrHua 3D灵体渲染引擎 - orb-orbit-camera
 * 轨道相机控制器
 * 从 orb-renderer-main.js 拆分 (原行 L4060-L4123)
 * @module orb-orbit-camera
 */
'use strict';

/* ===== 轨道相机控制器 ===== */
function createOrbitCamera(canvas, center, distance){
  const state = {
    theta: 0, phi: 0.25, radius: distance || 50,
    target: center ? center.slice() : [0, 10, 0],
    dragging: false, panning: false, lastX: 0, lastY: 0,
  };
  function getCamera(){
    const cp = Math.cos(state.phi), sp = Math.sin(state.phi);
    const st = Math.sin(state.theta), ct = Math.cos(state.theta);
    const eye = [
      state.target[0] + state.radius * cp * st,
      state.target[1] + state.radius * sp,
      state.target[2] + state.radius * cp * ct,
    ];
    return {
      x: state.target[0], y: state.target[1], z: state.target[2],
      distance: state.radius, height: eye[1],
      _eye: eye, _target: state.target.slice(),
    };
  }
  function onDown(e){
    if(e.button === 0) state.dragging = true;
    else if(e.button === 2) state.panning = true;
    state.lastX = e.clientX; state.lastY = e.clientY;
  }
  function onMove(e){
    const dx = e.clientX - state.lastX, dy = e.clientY - state.lastY;
    if(state.dragging){
      state.theta -= dx * 0.008;
      state.phi = Math.max(-1.4, Math.min(1.4, state.phi + dy * 0.008));
    }
    if(state.panning){
      const scale = state.radius * 0.002;
      state.target[0] -= dx * scale;
      state.target[1] += dy * scale;
    }
    state.lastX = e.clientX; state.lastY = e.clientY;
  }
  function onUp(){ state.dragging = false; state.panning = false; }
  function onWheel(e){
    e.preventDefault();
    state.radius = Math.max(1, Math.min(2000, state.radius * (1 + e.deltaY * 0.0015)));
  }
  function onCtx(e){ e.preventDefault(); }
  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('wheel', onWheel, {passive: false});
  canvas.addEventListener('contextmenu', onCtx);
  return {
    getCamera, setTarget: (t)=>{ state.target = t.slice(); },
    setRadius: (r)=>{ state.radius = r; },
    reset: ()=>{ state.theta=0; state.phi=0.25; },
    dispose: ()=>{
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onCtx);
    },
  };
}

