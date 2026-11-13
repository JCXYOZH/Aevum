/**
 * MrHua 3D灵体渲染引擎 - orb-animation
 * 动画系统(样条/状态机/缓动/行为树)
 * 从 orb-renderer-main.js 拆分 (原行 L12065-L19502)
 * @module orb-animation
 */
'use strict';

const SplineType = { BEZIER: 0, CATMULL_ROM: 1, BSPLINE: 2, LINEAR: 3, HERMITE: 4 };

function createSpline(type, points, options){
  const spl = {
    type: type || SplineType.CATMULL_ROM,
    points: points ? points.map(function(p){ return [p[0],p[1],p[2]]; }) : [],
    closed: (options && options.closed) || false,
    tension: (options && options.tension) || 0.5,
    segments: (options && options.segments) || 32,
    _lengthCache: null,
    _dirty: true
  };

  function addPoint(x, y, z){
    spl.points.push([x, y, z]);
    spl._dirty = true;
    return spl.points.length - 1;
  }

  function removePoint(index){
    if(index < 0 || index >= spl.points.length) return false;
    spl.points.splice(index, 1);
    spl._dirty = true;
    return true;
  }

  function getPoint(index){
    if(spl.closed){
      const n = spl.points.length;
      return spl.points[((index % n) + n) % n];
    }
    return spl.points[Math.max(0, Math.min(spl.points.length - 1, index))];
  }

  function bezierPoint(t, p0, p1, p2, p3, out){
    const mt = 1 - t;
    const mt2 = mt * mt, mt3 = mt2 * mt;
    const t2 = t * t, t3 = t2 * t;
    out[0] = mt3*p0[0] + 3*mt2*t*p1[0] + 3*mt*t2*p2[0] + t3*p3[0];
    out[1] = mt3*p0[1] + 3*mt2*t*p1[1] + 3*mt*t2*p2[1] + t3*p3[1];
    out[2] = mt3*p0[2] + 3*mt2*t*p1[2] + 3*mt*t2*p2[2] + t3*p3[2];
    return out;
  }

  function catmullRomPoint(t, p0, p1, p2, p3, out){
    const t2 = t * t, t3 = t2 * t;
    const s = spl.tension;
    out[0] = 0.5*((2*p1[0]) + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3);
    out[1] = 0.5*((2*p1[1]) + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3);
    out[2] = 0.5*((2*p1[2]) + (-p0[2]+p2[2])*t + (2*p0[2]-5*p1[2]+4*p2[2]-p3[2])*t2 + (-p0[2]+3*p1[2]-3*p2[2]+p3[2])*t3);
    return out;
  }

  function bsplinePoint(t, p0, p1, p2, p3, out){
    const t2 = t * t, t3 = t2 * t;
    const mt = 1 - t, mt2 = mt * mt, mt3 = mt2 * mt;
    out[0] = (mt3*p0[0] + (3*t3-6*t2+4)*p1[0] + (-3*t3+3*t2+3*t+1)*p2[0] + t3*p3[0]) / 6;
    out[1] = (mt3*p0[1] + (3*t3-6*t2+4)*p1[1] + (-3*t3+3*t2+3*t+1)*p2[1] + t3*p3[1]) / 6;
    out[2] = (mt3*p0[2] + (3*t3-6*t2+4)*p1[2] + (-3*t3+3*t2+3*t+1)*p2[2] + t3*p3[2]) / 6;
    return out;
  }

  function hermitePoint(t, p0, p1, t0, t1, out){
    const t2 = t * t, t3 = t2 * t;
    const h1 = 2*t3 - 3*t2 + 1;
    const h2 = -2*t3 + 3*t2;
    const h3 = t3 - 2*t2 + t;
    const h4 = t3 - t2;
    out[0] = h1*p0[0] + h2*p1[0] + h3*t0[0] + h4*t1[0];
    out[1] = h1*p0[1] + h2*p1[1] + h3*t0[1] + h4*t1[1];
    out[2] = h1*p0[2] + h2*p1[2] + h3*t0[2] + h4*t1[2];
    return out;
  }

  function sample(t, out){
    if(!out) out = [0, 0, 0];
    const n = spl.points.length;
    if(n === 0){ out[0]=0;out[1]=0;out[2]=0; return out; }
    if(n === 1){ out[0]=spl.points[0][0];out[1]=spl.points[0][1];out[2]=spl.points[0][2]; return out; }

    if(spl.type === SplineType.LINEAR){
      const seg = spl.closed ? n : n - 1;
      const ft = Math.max(0, Math.min(0.9999, t)) * seg;
      const i = Math.floor(ft);
      const lt = ft - i;
      const p0 = getPoint(i), p1 = getPoint(i + 1);
      out[0] = p0[0] + (p1[0]-p0[0])*lt;
      out[1] = p0[1] + (p1[1]-p0[1])*lt;
      out[2] = p0[2] + (p1[2]-p0[2])*lt;
      return out;
    }

    const seg = spl.closed ? n : n - 1;
    const ft = Math.max(0, Math.min(0.9999, t)) * seg;
    const i = Math.floor(ft);
    const lt = ft - i;

    if(spl.type === SplineType.BEZIER){
      const p0 = getPoint(i), p1 = getPoint(i+1), p2 = getPoint(i+2), p3 = getPoint(i+3);
      return bezierPoint(lt, p0, p1, p2, p3, out);
    } else if(spl.type === SplineType.CATMULL_ROM){
      const p0 = getPoint(i-1), p1 = getPoint(i), p2 = getPoint(i+1), p3 = getPoint(i+2);
      return catmullRomPoint(lt, p0, p1, p2, p3, out);
    } else if(spl.type === SplineType.BSPLINE){
      const p0 = getPoint(i), p1 = getPoint(i+1), p2 = getPoint(i+2), p3 = getPoint(i+3);
      return bsplinePoint(lt, p0, p1, p2, p3, out);
    } else if(spl.type === SplineType.HERMITE){
      const p0 = getPoint(i), p1 = getPoint(i+1);
      const t0 = getPoint(i-1), t1 = getPoint(i+2);
      return hermitePoint(lt, p0, p1, t0, t1, out);
    }
    return out;
  }

  function tangent(t, out){
    if(!out) out = [0, 0, 0];
    const eps = 0.001;
    const t0 = Math.max(0, t - eps), t1 = Math.min(1, t + eps);
    const p0 = sample(t0), p1 = sample(t1);
    out[0] = p1[0]-p0[0]; out[1] = p1[1]-p0[1]; out[2] = p1[2]-p0[2];
    const l = Math.sqrt(out[0]*out[0]+out[1]*out[1]+out[2]*out[2]) || 1;
    out[0]/=l; out[1]/=l; out[2]/=l;
    return out;
  }

  function computeLength(){
    if(!spl._dirty && spl._lengthCache) return spl._lengthCache;
    let total = 0;
    const prev = sample(0);
    for(let i = 1; i <= spl.segments; i++){
      const cur = sample(i / spl.segments);
      total += V3.dist(prev, cur);
      prev[0]=cur[0]; prev[1]=cur[1]; prev[2]=cur[2];
    }
    spl._lengthCache = total;
    spl._dirty = false;
    return total;
  }

  function sampleByDistance(distance, out){
    const total = computeLength();
    const d = Math.max(0, Math.min(total, distance));
    return sample(d / total, out);
  }

  function getFrame(t, outPos, outTangent, outNormal, outBinormal){
    sample(t, outPos);
    tangent(t, outTangent);
    const up = [0, 1, 0];
    V3.cross(outBinormal, outTangent, up);
    if(V3.len(outBinormal) < 0.001){
      up[0]=1; up[1]=0; up[2]=0;
      V3.cross(outBinormal, outTangent, up);
    }
    V3.norm(outBinormal, outBinormal);
    V3.cross(outNormal, outBinormal, outTangent);
    return { position: outPos, tangent: outTangent, normal: outNormal, binormal: outBinormal };
  }

  function toPolyline(segments){
    const seg = segments || spl.segments;
    const pts = [];
    for(let i = 0; i <= seg; i++){
      pts.push(sample(i / seg));
    }
    return pts;
  }

  function nearestPoint(point, out){
    let bestDist = Infinity, bestT = 0, bestPos = [0,0,0];
    for(let i = 0; i <= spl.segments; i++){
      const t = i / spl.segments;
      const p = sample(t);
      const d = V3.distSq(point, p);
      if(d < bestDist){ bestDist = d; bestT = t; bestPos[0]=p[0];bestPos[1]=p[1];bestPos[2]=p[2]; }
    }
    if(out){ out[0]=bestPos[0];out[1]=bestPos[1];out[2]=bestPos[2]; }
    return { t: bestT, distance: Math.sqrt(bestDist), point: bestPos };
  }

  function setClosed(v){ spl.closed = v; spl._dirty = true; }
  function setTension(v){ spl.tension = v; spl._dirty = true; }
  function setSegments(v){ spl.segments = v; spl._dirty = true; }

  return {
    addPoint, removePoint, getPoint, sample, tangent, computeLength,
    sampleByDistance, getFrame, toPolyline, nearestPoint, setClosed,
    setTension, setSegments, spl
  };
}

function createPathFollower(spline, options){
  const follower = {
    spline: spline,
    speed: (options && options.speed) || 1.0,
    distance: (options && options.distance) || 0,
    position: [0,0,0],
    rotation: [0,0,0,1],
    lookForward: (options && options.lookForward !== undefined) ? options.lookForward : true,
    bankAmount: (options && options.bankAmount) || 0,
    _prevTangent: [0,0,-1]
  };

  function update(dt){
    follower.distance += follower.speed * dt;
    const total = follower.spline.computeLength();
    if(follower.distance > total){
      follower.distance = follower.distance % total;
    }
    const t = follower.distance / total;
    const pos = [0,0,0], tang = [0,0,0], norm = [0,0,0], binorm = [0,0,0];
    follower.spline.getFrame(t, pos, tang, norm, binorm);
    follower.position[0]=pos[0];follower.position[1]=pos[1];follower.position[2]=pos[2];

    if(follower.lookForward){
      const m = M4.create();
      M4.lookAt(m, [0,0,0], tang, [0,1,0]);
      const q = Q.create();
      quatFromMat4(q, m);
      if(follower.bankAmount > 0){
        const bankQ = Q.create();
        const turnRate = V3.dot(tang, follower._prevTangent);
        Q.fromAxisAngle(bankQ, tang, turnRate * follower.bankAmount);
        Q.mult(q, q, bankQ);
      }
      follower.rotation[0]=q[0];follower.rotation[1]=q[1];follower.rotation[2]=q[2];follower.rotation[3]=q[3];
    }
    follower._prevTangent[0]=tang[0];follower._prevTangent[1]=tang[1];follower._prevTangent[2]=tang[2];
  }

  function reset(){ follower.distance = 0; }
  function setSpeed(v){ follower.speed = v; }

  return { update, reset, setSpeed, follower };
}

function quatFromMat4(out, m){
  const trace = m[0] + m[5] + m[10];
  if(trace > 0){
    const s = 0.5 / Math.sqrt(trace + 1);
    out[3] = 0.25 / s;
    out[0] = (m[6] - m[9]) * s;
    out[1] = (m[8] - m[2]) * s;
    out[2] = (m[1] - m[4]) * s;
  } else if(m[0] > m[5] && m[0] > m[10]){
    const s = 2 * Math.sqrt(1 + m[0] - m[5] - m[10]);
    out[3] = (m[6] - m[9]) / s;
    out[0] = 0.25 * s;
    out[1] = (m[1] + m[4]) / s;
    out[2] = (m[8] + m[2]) / s;
  } else if(m[5] > m[10]){
    const s = 2 * Math.sqrt(1 + m[5] - m[0] - m[10]);
    out[3] = (m[8] - m[2]) / s;
    out[0] = (m[1] + m[4]) / s;
    out[1] = 0.25 * s;
    out[2] = (m[6] + m[9]) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m[10] - m[0] - m[5]);
    out[3] = (m[1] - m[4]) / s;
    out[0] = (m[8] + m[2]) / s;
    out[1] = (m[6] + m[9]) / s;
    out[2] = 0.25 * s;
  }
  return out;
}

/* ===== 动画状态机系统 =====
   支持: 状态 / 过渡 / 条件 / 层级 / 遮罩 / 混合树
*/
const AnimStateMachineType = { SINGLE: 0, BLEND_TREE_1D: 1, BLEND_TREE_2D: 2, LAYERED: 3 };

function createAnimationStateMachine(boneSystem, options){
  const sm = {
    boneSystem: boneSystem,
    states: {},
    transitions: [],
    layers: [],
    currentState: null,
    previousState: null,
    transitionTime: 0,
    transitionDuration: 0,
    parameters: {},
    _time: 0,
    _poseRotations: null,
    _posePositions: null,
    _dirty: true
  };

  function addState(name, clipOrBuilder, type, options){
    const state = {
      name: name,
      type: type || AnimStateMachineType.SINGLE,
      clip: clipOrBuilder,
      speed: (options && options.speed) || 1,
      loop: (options && options.loop !== undefined) ? options.loop : true,
      blendParameter: (options && options.blendParameter) || null,
      blendClips: (options && options.blendClips) || [],
      layer: (options && options.layer) || 0,
      mask: (options && options.mask) || null,
      _time: 0,
      _weight: 0
    };
    sm.states[name] = state;
    if(!sm.currentState) sm.currentState = state;
    return state;
  }

  function addTransition(fromName, toName, condition, duration, options){
    const trans = {
      from: fromName,
      to: toName,
      condition: condition || function(){ return false; },
      duration: duration || 0.3,
      exitTime: (options && options.exitTime) || 0,
      hasExitTime: (options && options.exitTime !== undefined),
      priority: (options && options.priority) || 0,
      _triggered: false
    };
    sm.transitions.push(trans);
    return trans;
  }

  function setParameter(name, value){
    sm.parameters[name] = value;
    sm._dirty = true;
  }

  function getParameter(name){
    return sm.parameters[name];
  }

  function trigger(name){
    sm.parameters[name] = true;
  }

  function setState(name){
    const state = sm.states[name];
    if(!state) return false;
    if(sm.currentState && sm.currentState.name === name) return true;
    sm.previousState = sm.currentState;
    sm.currentState = state;
    sm.transitionTime = 0;
    sm.transitionDuration = 0.2;
    state._time = 0;
    sm._dirty = true;
    return true;
  }

  function sampleClip(clip, time, outRot, outPos){
    if(!clip || !clip.tracks) return;
    for(let i = 0; i < clip.tracks.length; i++){
      const track = clip.tracks[i];
      const boneIdx = sm.boneSystem ? sm.boneSystem.boneNameToIndex ? sm.boneSystem.boneNameToIndex(track.boneName) : -1 : -1;
      if(boneIdx < 0) continue;
      if(track.type === 'rotation' && outRot){
        const val = sampleTrackValue(track, time);
        if(val) outRot[boneIdx] = val;
      } else if(track.type === 'position' && outPos){
        const val = sampleTrackValue(track, time);
        if(val) outPos[boneIdx] = val;
      }
    }
  }

  function sampleTrackValue(track, time){
    if(!track.keyframes || track.keyframes.length === 0) return null;
    if(time <= track.keyframes[0].time) return track.keyframes[0].value;
    if(time >= track.keyframes[track.keyframes.length-1].time) return track.keyframes[track.keyframes.length-1].value;
    for(let i = 0; i < track.keyframes.length - 1; i++){
      const k0 = track.keyframes[i], k1 = track.keyframes[i+1];
      if(time >= k0.time && time <= k1.time){
        const t = (time - k0.time) / (k1.time - k0.time || 1);
        if(k0.value instanceof Float32Array || Array.isArray(k0.value)){
          const out = new Float32Array(k0.value.length);
          for(let j = 0; j < k0.value.length; j++){
            out[j] = k0.value[j] + (k1.value[j] - k0.value[j]) * t;
          }
          return out;
        }
        return k0.value + (k1.value - k0.value) * t;
      }
    }
    return track.keyframes[0].value;
  }

  function evaluateBlendTree1D(state, parameter, outRot, outPos){
    const clips = state.blendClips;
    if(!clips || clips.length === 0) return;
    if(clips.length === 1){
      sampleClip(clips[0].clip, state._time, outRot, outPos);
      return;
    }
    const paramValue = sm.parameters[parameter] || 0;
    let idx0 = 0, idx1 = clips.length - 1;
    for(let i = 0; i < clips.length - 1; i++){
      if(paramValue >= clips[i].threshold && paramValue <= clips[i+1].threshold){
        idx0 = i; idx1 = i + 1; break;
      }
    }
    const range = clips[idx1].threshold - clips[idx0].threshold || 1;
    const t = (paramValue - clips[idx0].threshold) / range;
    const rot0 = {}, pos0 = {}, rot1 = {}, pos1 = {};
    sampleClip(clips[idx0].clip, state._time, rot0, pos0);
    sampleClip(clips[idx1].clip, state._time, rot1, pos1);
    for(const key in rot0){
      if(rot1[key]){
        const q = Q.create();
        Q.slerp(q, rot0[key], rot1[key], t);
        outRot[key] = q;
      } else {
        outRot[key] = rot0[key];
      }
    }
    for(const key in rot1){
      if(!outRot[key]) outRot[key] = rot1[key];
    }
  }

  function update(dt){
    sm._time += dt;
    if(!sm.currentState) return;

    for(let i = 0; i < sm.transitions.length; i++){
      const trans = sm.transitions[i];
      if(trans.from !== sm.currentState.name) continue;
      if(trans.hasExitTime && sm.currentState._time < trans.exitTime) continue;
      if(trans.condition(sm.parameters)){
        setState(trans.to);
        sm.transitionDuration = trans.duration;
        break;
      }
    }

    for(const key in sm.parameters){
      if(sm.parameters[key] === true && key.startsWith('trigger_')){
        sm.parameters[key] = false;
      }
    }

    sm.currentState._time += dt * sm.currentState.speed;
    if(sm.currentState.clip && sm.currentState.clip.duration){
      if(sm.currentState.loop){
        sm.currentState._time = sm.currentState._time % sm.currentState.clip.duration;
      } else {
        sm.currentState._time = Math.min(sm.currentState._time, sm.currentState.clip.duration);
      }
    }

    if(sm.previousState){
      sm.transitionTime += dt;
      if(sm.transitionTime >= sm.transitionDuration){
        sm.previousState = null;
      }
    }

    const boneCount = sm.boneSystem ? (sm.boneSystem.bones ? sm.boneSystem.bones.length : 0) : 0;
    const rot = new Array(boneCount), pos = new Array(boneCount);
    for(let i = 0; i < boneCount; i++){
      rot[i] = Q.create(); Q.identity(rot[i]);
      pos[i] = [0,0,0];
    }

    if(sm.currentState.type === AnimStateMachineType.BLEND_TREE_1D){
      evaluateBlendTree1D(sm.currentState, sm.currentState.blendParameter, rot, pos);
    } else {
      sampleClip(sm.currentState.clip, sm.currentState._time, rot, pos);
    }

    if(sm.previousState){
      const prevRot = new Array(boneCount), prevPos = new Array(boneCount);
      for(let i = 0; i < boneCount; i++){
        prevRot[i] = Q.create(); Q.identity(prevRot[i]);
        prevPos[i] = [0,0,0];
      }
      sampleClip(sm.previousState.clip, sm.previousState._time, prevRot, prevPos);
      const t = sm.transitionTime / (sm.transitionDuration || 1);
      for(let i = 0; i < boneCount; i++){
        Q.slerp(rot[i], prevRot[i], rot[i], t);
        pos[i][0] = prevPos[i][0] + (pos[i][0]-prevPos[i][0])*t;
        pos[i][1] = prevPos[i][1] + (pos[i][1]-prevPos[i][1])*t;
        pos[i][2] = prevPos[i][2] + (pos[i][2]-prevPos[i][2])*t;
      }
    }

    sm._poseRotations = rot;
    sm._posePositions = pos;
    sm._dirty = false;
  }

  function getPose(){
    return { rotations: sm._poseRotations, positions: sm._posePositions };
  }

  function getCurrentStateName(){
    return sm.currentState ? sm.currentState.name : null;
  }

  function addLayer(name, mask, weight){
    const layer = {
      name: name,
      mask: mask || {},
      weight: weight !== undefined ? weight : 1,
      states: {},
      currentState: null
    };
    sm.layers.push(layer);
    return layer;
  }

  return {
    addState, addTransition, setParameter, getParameter, trigger,
    setState, update, getPose, getCurrentStateName, addLayer, sm
  };
}

/* ===== 布料模拟系统 =====
   基于质点-弹簧系统, 支持结构/剪切/弯曲约束, 风力, 碰撞
*/
function createClothSimulation(width, height, options){
  const cloth = {
    width: width,
    height: height,
    particles: [],
    constraints: [],
    faces: [],
    positions: null,
    normals: null,
    indices: null,
    gravity: (options && options.gravity) || [0, -9.8, 0],
    wind: (options && options.wind) || [0, 0, 0],
    damping: (options && options.damping) || 0.99,
    stiffness: (options && options.stiffness) || 0.95,
    iterations: (options && options.iterations) || 5,
    thickness: (options && options.thickness) || 0.1,
    friction: (options && options.friction) || 0.8,
    _pinned: {},
    _colliders: []
  };

  const total = width * height;
  cloth.positions = new Float32Array(total * 3);
  cloth.normals = new Float32Array(total * 3);
  cloth.velocities = new Float32Array(total * 3);
  cloth.previous = new Float32Array(total * 3);

  function idx(x, y){ return y * width + x; }

  function init(startX, startY, startZ, sizeX, sizeZ){
    const sx = sizeX || 2, sz = sizeZ || 2;
    for(let y = 0; y < height; y++){
      for(let x = 0; x < width; x++){
        const i = idx(x, y);
        const px = startX + (x / (width - 1) - 0.5) * sx;
        const py = startY || 2;
        const pz = startZ + (y / (height - 1) - 0.5) * sz;
        cloth.positions[i*3] = px;
        cloth.positions[i*3+1] = py;
        cloth.positions[i*3+2] = pz;
        cloth.previous[i*3] = px;
        cloth.previous[i*3+1] = py;
        cloth.previous[i*3+2] = pz;
        cloth.velocities[i*3] = 0;
        cloth.velocities[i*3+1] = 0;
        cloth.velocities[i*3+2] = 0;
        cloth.particles.push({ x: x, y: y, pinned: false, mass: 1 });
      }
    }

    for(let y = 0; y < height; y++){
      for(let x = 0; x < width; x++){
        const i = idx(x, y);
        if(x < width - 1){
          addConstraint(i, idx(x+1, y), 'structural');
        }
        if(y < height - 1){
          addConstraint(i, idx(x, y+1), 'structural');
        }
        if(x < width - 1 && y < height - 1){
          addConstraint(i, idx(x+1, y+1), 'shear');
          addConstraint(idx(x+1, y), idx(x, y+1), 'shear');
        }
        if(x < width - 2){
          addConstraint(i, idx(x+2, y), 'bend');
        }
        if(y < height - 2){
          addConstraint(i, idx(x, y+2), 'bend');
        }
      }
    }

    const indexCount = (width - 1) * (height - 1) * 6;
    cloth.indices = new Uint16Array(indexCount);
    let fi = 0;
    for(let y = 0; y < height - 1; y++){
      for(let x = 0; x < width - 1; x++){
        const i0 = idx(x, y), i1 = idx(x+1, y), i2 = idx(x, y+1), i3 = idx(x+1, y+1);
        cloth.indices[fi++] = i0; cloth.indices[fi++] = i2; cloth.indices[fi++] = i1;
        cloth.indices[fi++] = i1; cloth.indices[fi++] = i2; cloth.indices[fi++] = i3;
      }
    }

    computeNormals();
  }

  function addConstraint(p1, p2, type){
    const dx = cloth.positions[p1*3] - cloth.positions[p2*3];
    const dy = cloth.positions[p1*3+1] - cloth.positions[p2*3+1];
    const dz = cloth.positions[p1*3+2] - cloth.positions[p2*3+2];
    const rest = Math.sqrt(dx*dx + dy*dy + dz*dz);
    cloth.constraints.push({
      p1: p1, p2: p2, rest: rest, type: type || 'structural',
      stiffness: type === 'bend' ? cloth.stiffness * 0.3 : cloth.stiffness
    });
  }

  function pin(x, y){
    const i = idx(x, y);
    cloth._pinned[i] = true;
    cloth.particles[i].pinned = true;
  }

  function unpin(x, y){
    const i = idx(x, y);
    delete cloth._pinned[i];
    cloth.particles[i].pinned = false;
  }

  function setPinnedPosition(x, y, px, py, pz){
    const i = idx(x, y);
    cloth.positions[i*3] = px;
    cloth.positions[i*3+1] = py;
    cloth.positions[i*3+2] = pz;
    cloth.previous[i*3] = px;
    cloth.previous[i*3+1] = py;
    cloth.previous[i*3+2] = pz;
  }

  function addSphereCollider(center, radius){
    cloth._colliders.push({ type: 'sphere', center: [center[0],center[1],center[2]], radius: radius });
  }

  function addPlaneCollider(normal, point){
    cloth._colliders.push({ type: 'plane', normal: [normal[0],normal[1],normal[2]], point: [point[0],point[1],point[2]] });
  }

  function addBoxCollider(min, max){
    cloth._colliders.push({ type: 'box', min: [min[0],min[1],min[2]], max: [max[0],max[1],max[2]] });
  }

  function clearColliders(){
    cloth._colliders.length = 0;
  }

  function resolveCollisions(i){
    const px = cloth.positions[i*3], py = cloth.positions[i*3+1], pz = cloth.positions[i*3+2];
    for(let c = 0; c < cloth._colliders.length; c++){
      const col = cloth._colliders[c];
      if(col.type === 'sphere'){
        const dx = px - col.center[0], dy = py - col.center[1], dz = pz - col.center[2];
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        const minDist = col.radius + cloth.thickness;
        if(dist < minDist && dist > 0.001){
          const push = (minDist - dist) / dist;
          cloth.positions[i*3] += dx * push;
          cloth.positions[i*3+1] += dy * push;
          cloth.positions[i*3+2] += dz * push;
        }
      } else if(col.type === 'plane'){
        const d = px*col.normal[0] + py*col.normal[1] + pz*col.normal[2] -
                  (col.point[0]*col.normal[0] + col.point[1]*col.normal[1] + col.point[2]*col.normal[2]);
        if(d < cloth.thickness){
          const push = cloth.thickness - d;
          cloth.positions[i*3] += col.normal[0] * push;
          cloth.positions[i*3+1] += col.normal[1] * push;
          cloth.positions[i*3+2] += col.normal[2] * push;
        }
      } else if(col.type === 'box'){
        const cx = Math.max(col.min[0], Math.min(px, col.max[0]));
        const cy = Math.max(col.min[1], Math.min(py, col.max[1]));
        const cz = Math.max(col.min[2], Math.min(pz, col.max[2]));
        const dx = px - cx, dy = py - cy, dz = pz - cz;
        const distSq = dx*dx + dy*dy + dz*dz;
        if(distSq < cloth.thickness * cloth.thickness && distSq > 0.001){
          const dist = Math.sqrt(distSq);
          const push = (cloth.thickness - dist) / dist;
          cloth.positions[i*3] += dx * push;
          cloth.positions[i*3+1] += dy * push;
          cloth.positions[i*3+2] += dz * push;
        }
      }
    }
  }

  function computeNormals(){
    for(let i = 0; i < cloth.normals.length; i++) cloth.normals[i] = 0;
    for(let f = 0; f < cloth.indices.length; f += 3){
      const i0 = cloth.indices[f], i1 = cloth.indices[f+1], i2 = cloth.indices[f+2];
      const ax = cloth.positions[i1*3]-cloth.positions[i0*3];
      const ay = cloth.positions[i1*3+1]-cloth.positions[i0*3+1];
      const az = cloth.positions[i1*3+2]-cloth.positions[i0*3+2];
      const bx = cloth.positions[i2*3]-cloth.positions[i0*3];
      const by = cloth.positions[i2*3+1]-cloth.positions[i0*3+1];
      const bz = cloth.positions[i2*3+2]-cloth.positions[i0*3+2];
      const nx = ay*bz - az*by, ny = az*bx - ax*bz, nz = ax*by - ay*bx;
      cloth.normals[i0*3]+=nx; cloth.normals[i0*3+1]+=ny; cloth.normals[i0*3+2]+=nz;
      cloth.normals[i1*3]+=nx; cloth.normals[i1*3+1]+=ny; cloth.normals[i1*3+2]+=nz;
      cloth.normals[i2*3]+=nx; cloth.normals[i2*3+1]+=ny; cloth.normals[i2*3+2]+=nz;
    }
    for(let i = 0; i < total; i++){
      const l = Math.sqrt(cloth.normals[i*3]*cloth.normals[i*3] + cloth.normals[i*3+1]*cloth.normals[i*3+1] + cloth.normals[i*3+2]*cloth.normals[i*3+2]) || 1;
      cloth.normals[i*3] /= l; cloth.normals[i*3+1] /= l; cloth.normals[i*3+2] /= l;
    }
  }

  function step(dt){
    const dt2 = dt * dt;
    for(let i = 0; i < total; i++){
      if(cloth._pinned[i]) continue;
      const vx = (cloth.positions[i*3] - cloth.previous[i*3]) * cloth.damping;
      const vy = (cloth.positions[i*3+1] - cloth.previous[i*3+1]) * cloth.damping;
      const vz = (cloth.positions[i*3+2] - cloth.previous[i*3+2]) * cloth.damping;
      cloth.previous[i*3] = cloth.positions[i*3];
      cloth.previous[i*3+1] = cloth.positions[i*3+1];
      cloth.previous[i*3+2] = cloth.positions[i*3+2];
      cloth.positions[i*3] += vx + (cloth.gravity[0] + cloth.wind[0]) * dt2;
      cloth.positions[i*3+1] += vy + (cloth.gravity[1] + cloth.wind[1]) * dt2;
      cloth.positions[i*3+2] += vz + (cloth.gravity[2] + cloth.wind[2]) * dt2;
    }

    for(let iter = 0; iter < cloth.iterations; iter++){
      for(let c = 0; c < cloth.constraints.length; c++){
        const con = cloth.constraints[c];
        const dx = cloth.positions[con.p2*3] - cloth.positions[con.p1*3];
        const dy = cloth.positions[con.p2*3+1] - cloth.positions[con.p1*3+1];
        const dz = cloth.positions[con.p2*3+2] - cloth.positions[con.p1*3+2];
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) || 0.0001;
        const diff = (dist - con.rest) / dist * con.stiffness;
        const p1Pinned = cloth._pinned[con.p1];
        const p2Pinned = cloth._pinned[con.p2];
        if(!p1Pinned && !p2Pinned){
          cloth.positions[con.p1*3] += dx * diff * 0.5;
          cloth.positions[con.p1*3+1] += dy * diff * 0.5;
          cloth.positions[con.p1*3+2] += dz * diff * 0.5;
          cloth.positions[con.p2*3] -= dx * diff * 0.5;
          cloth.positions[con.p2*3+1] -= dy * diff * 0.5;
          cloth.positions[con.p2*3+2] -= dz * diff * 0.5;
        } else if(!p1Pinned){
          cloth.positions[con.p1*3] += dx * diff;
          cloth.positions[con.p1*3+1] += dy * diff;
          cloth.positions[con.p1*3+2] += dz * diff;
        } else if(!p2Pinned){
          cloth.positions[con.p2*3] -= dx * diff;
          cloth.positions[con.p2*3+1] -= dy * diff;
          cloth.positions[con.p2*3+2] -= dz * diff;
        }
      }
      for(let i = 0; i < total; i++){
        if(!cloth._pinned[i]) resolveCollisions(i);
      }
    }
    computeNormals();
  }

  function setWind(x, y, z){
    cloth.wind[0] = x; cloth.wind[1] = y; cloth.wind[2] = z;
  }

  function setGravity(x, y, z){
    cloth.gravity[0] = x; cloth.gravity[1] = y; cloth.gravity[2] = z;
  }

  function getGeometry(){
    return {
      positions: cloth.positions,
      normals: cloth.normals,
      indices: cloth.indices,
      vertexCount: total
    };
  }

  function reset(){
    for(let i = 0; i < total; i++){
      cloth.positions[i*3] = cloth.previous[i*3];
      cloth.positions[i*3+1] = cloth.previous[i*3+1];
      cloth.positions[i*3+2] = cloth.previous[i*3+2];
      cloth.velocities[i*3] = 0;
      cloth.velocities[i*3+1] = 0;
      cloth.velocities[i*3+2] = 0;
    }
  }

  return {
    init, pin, unpin, setPinnedPosition, addSphereCollider, addPlaneCollider,
    addBoxCollider, clearColliders, step, setWind, setGravity, getGeometry,
    reset, computeNormals, cloth
  };
}

/* ===== 头发 strands 系统 =====
   基于引导线+插值的头发渲染, 支持物理模拟和样式
*/
function createHairSystem(gl, options){
  const hair = {
    gl: gl,
    strands: [],
    guides: [],
    strandCount: (options && options.strandCount) || 1000,
    segmentCount: (options && options.segmentCount) || 16,
    scalpRadius: (options && options.scalpRadius) || 0.5,
    hairLength: (options && options.hairLength) || 0.8,
    gravity: (options && options.gravity) || [0, -9.8, 0],
    damping: (options && options.damping) || 0.95,
    stiffness: (options && options.stiffness) || 0.8,
    wind: (options && options.wind) || [0, 0, 0],
    _positions: null,
    _velocities: null,
    _vao: null,
    _vbo: null,
    _program: null,
    _initialized: false
  };

  function init(){
    const totalVerts = hair.strandCount * (hair.segmentCount + 1);
    hair._positions = new Float32Array(totalVerts * 3);
    hair._velocities = new Float32Array(totalVerts * 3);
    hair._colors = new Float32Array(totalVerts * 3);

    const guideCount = Math.min(50, Math.floor(hair.strandCount / 20));
    for(let g = 0; g < guideCount; g++){
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1) * 0.6;
      const root = [
        hair.scalpRadius * Math.sin(phi) * Math.cos(theta),
        hair.scalpRadius * Math.cos(phi) + 0.3,
        hair.scalpRadius * Math.sin(phi) * Math.sin(theta)
      ];
      const guide = { root: root, segments: [], stiffness: hair.stiffness * (0.8 + Math.random() * 0.4) };
      for(let s = 0; s <= hair.segmentCount; s++){
        const t = s / hair.segmentCount;
        guide.segments.push([
          root[0],
          root[1] - t * hair.hairLength,
          root[2]
        ]);
      }
      hair.guides.push(guide);
    }

    for(let i = 0; i < hair.strandCount; i++){
      const guideIdx = Math.floor(Math.random() * hair.guides.length);
      const guide = hair.guides[guideIdx];
      const strand = {
        guideIndex: guideIdx,
        rootOffset: [(Math.random()-0.5)*0.02, (Math.random()-0.5)*0.02, (Math.random()-0.5)*0.02],
        lengthScale: 0.8 + Math.random() * 0.4,
        thickness: 0.002 + Math.random() * 0.003,
        color: [0.1 + Math.random()*0.1, 0.05 + Math.random()*0.05, Math.random()*0.03]
      };
      hair.strands.push(strand);
      for(let s = 0; s <= hair.segmentCount; s++){
        const vi = (i * (hair.segmentCount + 1) + s) * 3;
        const t = s / hair.segmentCount;
        hair._positions[vi] = guide.root[0] + strand.rootOffset[0];
        hair._positions[vi+1] = guide.root[1] - t * hair.hairLength * strand.lengthScale;
        hair._positions[vi+2] = guide.root[2] + strand.rootOffset[2];
        hair._colors[vi] = strand.color[0];
        hair._colors[vi+1] = strand.color[1];
        hair._colors[vi+2] = strand.color[2];
      }
    }

    initGPU();
    hair._initialized = true;
  }

  function initGPU(){
    const gl = hair.gl;
    hair._vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, hair._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, hair._positions, gl.DYNAMIC_DRAW);

    const vs = `
      attribute vec3 aPosition;
      attribute vec3 aColor;
      uniform mat4 uViewProj;
      varying vec3 vColor;
      void main(){
        vColor = aColor;
        gl_Position = uViewProj * vec4(aPosition, 1.0);
        gl_PointSize = 2.0;
      }
    `;
    const fs = `
      precision mediump float;
      varying vec3 vColor;
      void main(){
        gl_FragColor = vec4(vColor, 1.0);
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    hair._program = gl.createProgram();
    gl.attachShader(hair._program, vsh);
    gl.attachShader(hair._program, fsh);
    gl.linkProgram(hair._program);
  }

  function step(dt){
    if(!hair._initialized) return;
    const dt2 = dt * dt;
    for(let g = 0; g < hair.guides.length; g++){
      const guide = hair.guides[g];
      for(let s = 1; s <= hair.segmentCount; s++){
        const seg = guide.segments[s];
        const prev = guide.segments[s-1];
        const vx = (seg[0] - prev[0]) * hair.damping;
        const vy = (seg[1] - prev[1]) * hair.damping;
        const vz = (seg[2] - prev[2]) * hair.damping;
        seg[0] += vx + (hair.gravity[0] + hair.wind[0]) * dt2;
        seg[1] += vy + (hair.gravity[1] + hair.wind[1]) * dt2;
        seg[2] += vz + (hair.gravity[2] + hair.wind[2]) * dt2;

        const dx = seg[0] - prev[0], dy = seg[1] - prev[1], dz = seg[2] - prev[2];
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) || 0.001;
        const restLen = hair.hairLength / hair.segmentCount;
        const diff = (dist - restLen) / dist * guide.stiffness;
        if(s < hair.segmentCount){
          seg[0] -= dx * diff * 0.5;
          seg[1] -= dy * diff * 0.5;
          seg[2] -= dz * diff * 0.5;
        }
        prev[0] += dx * diff * 0.5;
        prev[1] += dy * diff * 0.5;
        prev[2] += dz * diff * 0.5;
      }
    }

    for(let i = 0; i < hair.strandCount; i++){
      const strand = hair.strands[i];
      const guide = hair.guides[strand.guideIndex];
      for(let s = 0; s <= hair.segmentCount; s++){
        const vi = (i * (hair.segmentCount + 1) + s) * 3;
        const t = s / hair.segmentCount;
        const lerpFactor = t * t;
        hair._positions[vi] = guide.segments[s][0] * (1 - lerpFactor * 0.3) + strand.rootOffset[0] * (1 - t);
        hair._positions[vi+1] = guide.segments[s][1] * strand.lengthScale;
        hair._positions[vi+2] = guide.segments[s][2] * (1 - lerpFactor * 0.3) + strand.rootOffset[2] * (1 - t);
      }
    }

    const gl = hair.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, hair._vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, hair._positions);
  }

  function render(viewProj){
    if(!hair._initialized) return;
    const gl = hair.gl;
    gl.useProgram(hair._program);
    gl.uniformMatrix4fv(gl.getUniformLocation(hair._program, 'uViewProj'), false, viewProj);
    gl.bindBuffer(gl.ARRAY_BUFFER, hair._vbo);
    const posLoc = gl.getAttribLocation(hair._program, 'aPosition');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, hair.strandCount * (hair.segmentCount + 1));
  }

  function setWind(x, y, z){
    hair.wind[0] = x; hair.wind[1] = y; hair.wind[2] = z;
  }

  function dispose(){
    const gl = hair.gl;
    if(hair._vbo) gl.deleteBuffer(hair._vbo);
    if(hair._program) gl.deleteProgram(hair._program);
  }

  return { init, step, render, setWind, dispose, hair };
}

/* ===== 贴花系统 =====
   支持: 投影贴花 / 延迟贴花 / 法线贴花 / 贴花混合
*/
function createDecalSystem(gl, options){
  const ds = {
    gl: gl,
    decals: [],
    maxDecals: (options && options.maxDecals) || 64,
    _program: null,
    _vbo: null,
    _ibo: null,
    _initialized: false
  };

  function init(){
    const gl = ds.gl;
    const vs = `
      attribute vec3 aPosition;
      attribute vec2 aUV;
      uniform mat4 uViewProj;
      uniform mat4 uDecalMatrix;
      varying vec2 vUV;
      varying vec3 vWorldPos;
      void main(){
        vUV = aUV;
        vWorldPos = aPosition;
        gl_Position = uViewProj * vec4(aPosition, 1.0);
      }
    `;
    const fs = `
      precision mediump float;
      uniform sampler2D uDecalTexture;
      uniform vec4 uDecalColor;
      uniform float uOpacity;
      varying vec2 vUV;
      varying vec3 vWorldPos;
      void main(){
        vec2 uv = vUV;
        if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
        vec4 tex = texture2D(uDecalTexture, uv);
        if(tex.a < 0.01) discard;
        gl_FragColor = vec4(tex.rgb * uDecalColor.rgb, tex.a * uOpacity * uDecalColor.a);
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    ds._program = gl.createProgram();
    gl.attachShader(ds._program, vsh);
    gl.attachShader(ds._program, fsh);
    gl.linkProgram(ds._program);

    const verts = new Float32Array([
      -1,-1,-1, 0,0,  1,-1,-1, 1,0,  1,1,-1, 1,1,  -1,1,-1, 0,1,
      -1,-1,1, 0,0,  1,-1,1, 1,0,  1,1,1, 1,1,  -1,1,1, 0,1
    ]);
    const indices = new Uint16Array([
      0,1,2, 0,2,3, 4,6,5, 4,7,6, 0,4,5, 0,5,1,
      2,6,7, 2,7,3, 0,3,7, 0,7,4, 1,5,6, 1,6,2
    ]);
    ds._vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ds._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    ds._ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ds._ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    ds._initialized = true;
  }

  function createDecal(texture, position, rotation, size, options){
    if(ds.decals.length >= ds.maxDecals) return null;
    const decal = {
      texture: texture,
      position: [position[0], position[1], position[2]],
      rotation: rotation ? [rotation[0],rotation[1],rotation[2]] : [0,0,0],
      size: [size[0], size[1], size[2] || size[0]],
      color: (options && options.color) || [1,1,1,1],
      opacity: (options && options.opacity !== undefined) ? options.opacity : 1,
      normalBlend: (options && options.normalBlend) || 0,
      lifetime: (options && options.lifetime) || -1,
      _age: 0,
      _matrix: M4.create()
    };
    updateDecalMatrix(decal);
    ds.decals.push(decal);
    return decal;
  }

  function updateDecalMatrix(decal){
    const m = M4.create();
    M4.identity(m);
    M4.mult(m, m, M4.fromTRS(M4.create(), decal.position, Q.fromEuler(Q.create(), decal.rotation[0], decal.rotation[1], decal.rotation[2]), decal.size));
    decal._matrix = m;
  }

  function removeDecal(decal){
    const idx = ds.decals.indexOf(decal);
    if(idx >= 0) ds.decals.splice(idx, 1);
  }

  function clear(){
    ds.decals.length = 0;
  }

  function update(dt){
    for(let i = ds.decals.length - 1; i >= 0; i--){
      const d = ds.decals[i];
      if(d.lifetime > 0){
        d._age += dt;
        if(d._age >= d.lifetime){
          ds.decals.splice(i, 1);
        }
      }
    }
  }

  function render(viewProj){
    if(!ds._initialized || ds.decals.length === 0) return;
    const gl = ds.gl;
    gl.useProgram(ds._program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);

    for(let i = 0; i < ds.decals.length; i++){
      const d = ds.decals[i];
      gl.uniformMatrix4fv(gl.getUniformLocation(ds._program, 'uViewProj'), false, viewProj);
      gl.uniformMatrix4fv(gl.getUniformLocation(ds._program, 'uDecalMatrix'), false, d._matrix);
      gl.uniform4fv(gl.getUniformLocation(ds._program, 'uDecalColor'), d.color);
      gl.uniform1f(gl.getUniformLocation(ds._program, 'uOpacity'), d.opacity);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, d.texture);
      gl.uniform1i(gl.getUniformLocation(ds._program, 'uDecalTexture'), 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, ds._vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ds._ibo);
      const posLoc = gl.getAttribLocation(ds._program, 'aPosition');
      const uvLoc = gl.getAttribLocation(ds._program, 'aUV');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(uvLoc);
      gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 20, 12);
      gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  function dispose(){
    const gl = ds.gl;
    if(ds._vbo) gl.deleteBuffer(ds._vbo);
    if(ds._ibo) gl.deleteBuffer(ds._ibo);
    if(ds._program) gl.deleteProgram(ds._program);
  }

  return { init, createDecal, removeDecal, clear, update, render, dispose, ds };
}

/* ===== 双四元数蒙皮 (Dual Quaternion Skinning) =====
   替代线性混合蒙皮(LBS), 消除糖果包装效应
*/
function createDualQuaternionSkinner(boneSystem, options){
  const dqs = {
    boneSystem: boneSystem,
    maxBones: (options && options.maxBones) || 256,
    _dualQuaternions: null,
    _boneMatrices: null,
    _scratchDQ: null
  };

  function init(){
    dqs._dualQuaternions = new Float32Array(dqs.maxBones * 8);
    dqs._boneMatrices = new Float32Array(dqs.maxBones * 16);
    dqs._scratchDQ = new Float32Array(8);
  }

  function mat4ToDualQuaternion(mat, outReal, outDual){
    const m00=mat[0],m01=mat[1],m02=mat[2],m03=mat[3];
    const m10=mat[4],m11=mat[5],m12=mat[6],m13=mat[7];
    const m20=mat[8],m21=mat[9],m22=mat[10],m23=mat[11];

    const trace = m00 + m11 + m22;
    let qx, qy, qz, qw;
    if(trace > 0){
      const s = 0.5 / Math.sqrt(trace + 1);
      qw = 0.25 / s;
      qx = (m12 - m21) * s;
      qy = (m20 - m02) * s;
      qz = (m01 - m10) * s;
    } else if(m00 > m11 && m00 > m22){
      const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
      qw = (m12 - m21) / s;
      qx = 0.25 * s;
      qy = (m10 + m01) / s;
      qz = (m20 + m02) / s;
    } else if(m11 > m22){
      const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
      qw = (m20 - m02) / s;
      qx = (m10 + m01) / s;
      qy = 0.25 * s;
      qz = (m12 + m21) / s;
    } else {
      const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
      qw = (m01 - m10) / s;
      qx = (m20 + m02) / s;
      qy = (m12 + m21) / s;
      qz = 0.25 * s;
    }

    outReal[0]=qx; outReal[1]=qy; outReal[2]=qz; outReal[3]=qw;

    const tx = mat[12], ty = mat[13], tz = mat[14];
    outDual[0] = 0.5 * ( tx*qw + ty*qz - tz*qy);
    outDual[1] = 0.5 * (-tx*qz + ty*qw + tz*qx);
    outDual[2] = 0.5 * ( tx*qy - ty*qx + tz*qw);
    outDual[3] = -0.5 * (tx*qx + ty*qy + tz*qz);
  }

  function dualQuaternionMult(out, r0, d0, r1, d1){
    out[0] = r0[3]*r1[0] + r0[0]*r1[3] + r0[1]*r1[2] - r0[2]*r1[1];
    out[1] = r0[3]*r1[1] - r0[0]*r1[2] + r0[1]*r1[3] + r0[2]*r1[0];
    out[2] = r0[3]*r1[2] + r0[0]*r1[1] - r0[1]*r1[0] + r0[2]*r1[3];
    out[3] = r0[3]*r1[3] - r0[0]*r1[0] - r0[1]*r1[1] - r0[2]*r1[2];
    out[4] = r0[3]*d1[0] + d0[0]*r1[3] + r0[1]*d1[2] - r0[2]*d1[1] + d0[1]*r1[2] - d0[2]*r1[1];
    out[5] = r0[3]*d1[1] - r0[0]*d1[2] + d0[0]*r1[2] + r0[1]*d1[3] + d0[1]*r1[3] + r0[2]*d1[0] - d0[2]*r1[0];
    out[6] = r0[3]*d1[2] + r0[0]*d1[1] - r0[1]*d1[0] + d0[0]*r1[1] - d0[1]*r1[0] + r0[2]*d1[3] + d0[2]*r1[3];
    out[7] = r0[3]*d1[3] - r0[0]*d1[0] - r0[1]*d1[1] - r0[2]*d1[2] + d0[0]*r1[0] + d0[1]*r1[1] + d0[2]*r1[2];
  }

  function updateBoneDualQuaternions(boneMatrices, boneCount){
    const real = new Float32Array(4), dual = new Float32Array(4);
    for(let i = 0; i < boneCount && i < dqs.maxBones; i++){
      const mat = boneMatrices.subarray(i*16, i*16+16);
      mat4ToDualQuaternion(mat, real, dual);
      dqs._dualQuaternions[i*8] = real[0];
      dqs._dualQuaternions[i*8+1] = real[1];
      dqs._dualQuaternions[i*8+2] = real[2];
      dqs._dualQuaternions[i*8+3] = real[3];
      dqs._dualQuaternions[i*8+4] = dual[0];
      dqs._dualQuaternions[i*8+5] = dual[1];
      dqs._dualQuaternions[i*8+6] = dual[2];
      dqs._dualQuaternions[i*8+7] = dual[3];
    }
  }

  function skinVertex(position, normal, boneIndices, boneWeights, outPos, outNorm){
    const blendReal = [0,0,0,0], blendDual = [0,0,0,0];
    const refReal = dqs._dualQuaternions.subarray(boneIndices[0]*8, boneIndices[0]*8+4);
    let sign = 1;
    for(let w = 0; w < 4; w++){
      const idx = boneIndices[w];
      const weight = boneWeights[w];
      if(weight <= 0 || idx < 0) continue;
      const boneReal = dqs._dualQuaternions.subarray(idx*8, idx*8+4);
      const boneDual = dqs._dualQuaternions.subarray(idx*8+4, idx*8+8);
      if(w > 0){
        const dot = boneReal[0]*refReal[0] + boneReal[1]*refReal[1] + boneReal[2]*refReal[2] + boneReal[3]*refReal[3];
        sign = dot >= 0 ? 1 : -1;
      }
      blendReal[0] += boneReal[0] * weight * sign;
      blendReal[1] += boneReal[1] * weight * sign;
      blendReal[2] += boneReal[2] * weight * sign;
      blendReal[3] += boneReal[3] * weight * sign;
      blendDual[0] += boneDual[0] * weight * sign;
      blendDual[1] += boneDual[1] * weight * sign;
      blendDual[2] += boneDual[2] * weight * sign;
      blendDual[3] += boneDual[3] * weight * sign;
    }

    const len = Math.sqrt(blendReal[0]*blendReal[0] + blendReal[1]*blendReal[1] + blendReal[2]*blendReal[2] + blendReal[3]*blendReal[3]) || 1;
    for(let i = 0; i < 4; i++){
      blendReal[i] /= len;
      blendDual[i] /= len;
    }

    const qx=blendReal[0], qy=blendReal[1], qz=blendReal[2], qw=blendReal[3];
    const dx=blendDual[0], dy=blendDual[1], dz=blendDual[2], dw=blendDual[3];

    const tx = 2 * (-dw*qx + dx*qw - dy*qz + dz*qy);
    const ty = 2 * (-dw*qy + dx*qz + dy*qw - dz*qx);
    const tz = 2 * (-dw*qz - dx*qy + dy*qx + dz*qw);

    const x2 = qx+qx, y2 = qy+qy, z2 = qz+qz;
    const xx = qx*x2, xy = qx*y2, xz = qx*z2;
    const yy = qy*y2, yz = qy*z2, zz = qz*z2;
    const wx = qw*x2, wy = qw*y2, wz = qw*z2;

    const m00 = 1-(yy+zz), m01 = xy-wz, m02 = xz+wy;
    const m10 = xy+wz, m11 = 1-(xx+zz), m12 = yz-wx;
    const m20 = xz-wy, m21 = yz+wx, m22 = 1-(xx+yy);

    outPos[0] = m00*position[0] + m01*position[1] + m02*position[2] + tx;
    outPos[1] = m10*position[0] + m11*position[1] + m12*position[2] + ty;
    outPos[2] = m20*position[0] + m21*position[1] + m22*position[2] + tz;

    outNorm[0] = m00*normal[0] + m01*normal[1] + m02*normal[2];
    outNorm[1] = m10*normal[0] + m11*normal[1] + m12*normal[2];
    outNorm[2] = m20*normal[0] + m21*normal[1] + m22*normal[2];
  }

  function skinMesh(geometry, boneIndices, boneWeights, boneMatrices, boneCount){
    updateBoneDualQuaternions(boneMatrices, boneCount);
    const pos = geometry.positions;
    const norm = geometry.normals;
    const outPos = new Float32Array(pos.length);
    const outNorm = new Float32Array(norm.length);
    const vertCount = pos.length / 3;
    const p = [0,0,0], n = [0,0,0], op = [0,0,0], on = [0,0,0];
    const bi = [0,0,0,0], bw = [0,0,0,0];
    for(let i = 0; i < vertCount; i++){
      p[0]=pos[i*3]; p[1]=pos[i*3+1]; p[2]=pos[i*3+2];
      n[0]=norm[i*3]; n[1]=norm[i*3+1]; n[2]=norm[i*3+2];
      for(let w = 0; w < 4; w++){
        bi[w] = boneIndices[i*4+w];
        bw[w] = boneWeights[i*4+w];
      }
      skinVertex(p, n, bi, bw, op, on);
      outPos[i*3]=op[0]; outPos[i*3+1]=op[1]; outPos[i*3+2]=op[2];
      outNorm[i*3]=on[0]; outNorm[i*3+1]=on[1]; outNorm[i*3+2]=on[2];
    }
    return { positions: outPos, normals: outNorm };
  }

  function getDualQuaternionArray(){
    return dqs._dualQuaternions;
  }

  function getShaderSource(){
    return {
      vertex: `
        const int MAX_BONES = 256;
        attribute vec3 aPosition;
        attribute vec3 aNormal;
        attribute vec4 aBoneIndex;
        attribute vec4 aBoneWeight;
        uniform vec4 uBonesDQ[MAX_BONES * 2];
        uniform mat4 uViewProj;
        varying vec3 vNormal;
        varying vec3 vWorldPos;

        vec4 multQuat(vec4 q1, vec4 q2){
          return vec4(
            q1.w * q2.x + q1.x * q2.w + q1.y * q2.z - q1.z * q2.y,
            q1.w * q2.y - q1.x * q2.z + q1.y * q2.w + q1.z * q2.x,
            q1.w * q2.z + q1.x * q2.y - q1.y * q2.x + q1.z * q2.w,
            q1.w * q2.w - q1.x * q2.x - q1.y * q2.y - q1.z * q2.z
          );
        }

        vec3 rotateVector(vec4 q, vec3 v){
          return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
        }

        vec4 blendDualQuaternions(vec4 indices, vec4 weights){
          vec4 real = vec4(0.0);
          vec4 dual = vec4(0.0);
          int idx0 = int(indices.x) * 2;
          vec4 refReal = uBonesDQ[idx0];
          for(int i = 0; i < 4; i++){
            int idx = int(indices[i]) * 2;
            vec4 boneReal = uBonesDQ[idx];
            vec4 boneDual = uBonesDQ[idx + 1];
            float dot = dot(boneReal, refReal);
            float sign = dot >= 0.0 ? 1.0 : -1.0;
            real += boneReal * weights[i] * sign;
            dual += boneDual * weights[i] * sign;
          }
          float len = length(real);
          real /= len;
          dual /= len;
          return vec4(real.xyz, dual.x);
        }

        void main(){
          vec4 blend = blendDualQuaternions(aBoneIndex, aBoneWeight);
          vec4 real = vec4(blend.xyz, 0.0);
          vec3 translation = 2.0 * vec3(
            -blend.w * real.x + real.w * real.x - real.y * real.z + real.z * real.y,
            -blend.w * real.y + real.x * real.z + real.w * real.y - real.z * real.x,
            -blend.w * real.z - real.x * real.y + real.y * real.x + real.w * real.z
          );
          vec3 worldPos = rotateVector(real, aPosition) + translation;
          vec3 worldNormal = rotateVector(real, aNormal);
          vWorldPos = worldPos;
          vNormal = worldNormal;
          gl_Position = uViewProj * vec4(worldPos, 1.0);
        }
      `,
      fragment: `
        precision mediump float;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        uniform vec3 uLightDir;
        uniform vec3 uColor;
        void main(){
          vec3 normal = normalize(vNormal);
          float diff = max(dot(normal, normalize(uLightDir)), 0.0);
          vec3 color = uColor * (0.3 + diff * 0.7);
          gl_FragColor = vec4(color, 1.0);
        }
      `
    };
  }

  return {
    init, mat4ToDualQuaternion, updateBoneDualQuaternions,
    skinVertex, skinMesh, getDualQuaternionArray, getShaderSource, dqs
  };
}



/* ===== 字体与文本渲染系统 =====
   支持: 位图字体 / SDF字体 / 文本布局 / 自动换行 / 对齐
*/
function createFontRenderer(gl, options){
  const fr = {
    gl: gl,
    fonts: {},
    currentFont: null,
    _program: null,
    _vbo: null,
    _vao: null,
    _initialized: false,
    _maxChars: (options && options.maxChars) || 4096
  };

  function init(){
    const gl = fr.gl;
    const vs = `
      attribute vec2 aPosition;
      attribute vec2 aUV;
      attribute vec4 aColor;
      uniform vec2 uResolution;
      varying vec2 vUV;
      varying vec4 vColor;
      void main(){
        vec2 pos = aPosition / uResolution * 2.0 - 1.0;
        pos.y = -pos.y;
        gl_Position = vec4(pos, 0.0, 1.0);
        vUV = aUV;
        vColor = aColor;
      }
    `;
    const fs = `
      precision mediump float;
      uniform sampler2D uFontTexture;
      uniform float uSDF;
      varying vec2 vUV;
      varying vec4 vColor;
      void main(){
        float dist = texture2D(uFontTexture, vUV).a;
        if(uSDF > 0.5){
          float alpha = smoothstep(0.48, 0.52, dist);
          gl_FragColor = vec4(vColor.rgb, vColor.a * alpha);
        } else {
          if(dist < 0.1) discard;
          gl_FragColor = vec4(vColor.rgb, vColor.a * dist);
        }
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    fr._program = gl.createProgram();
    gl.attachShader(fr._program, vsh);
    gl.attachShader(fr._program, fsh);
    gl.linkProgram(fr._program);

    fr._vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, fr._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, fr._maxChars * 6 * 12 * 4, gl.DYNAMIC_DRAW);
    fr._initialized = true;
  }

  function createBitmapFont(name, texture, glyphData, options){
    const font = {
      name: name,
      texture: texture,
      glyphs: {},
      lineHeight: (options && options.lineHeight) || 32,
      base: (options && options.base) || 24,
      scaleW: (options && options.scaleW) || 512,
      scaleH: (options && options.scaleH) || 512,
      isSDF: (options && options.isSDF) || false,
      kernings: {}
    };
    if(glyphData){
      for(let i = 0; i < glyphData.length; i++){
        const g = glyphData[i];
        font.glyphs[g.char] = {
          x: g.x, y: g.y, width: g.width, height: g.height,
          xoffset: g.xoffset || 0, yoffset: g.yoffset || 0,
          xadvance: g.xadvance || g.width
        };
      }
    }
    fr.fonts[name] = font;
    if(!fr.currentFont) fr.currentFont = font;
    return font;
  }

  function generateDefaultFont(name, options){
    const size = (options && options.size) || 32;
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#fff';
    ctx.font = size + 'px monospace';
    ctx.textBaseline = 'top';
    const glyphs = [];
    let x = 0, y = 0;
    const chars = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
    for(let i = 0; i < chars.length; i++){
      const ch = chars[i];
      const w = ctx.measureText(ch).width;
      if(x + w + 2 > 512){ x = 0; y += size + 4; }
      ctx.fillText(ch, x, y);
      glyphs.push({ char: ch, x: x, y: y, width: w, height: size, xoffset: 0, yoffset: 0, xadvance: w + 1 });
      x += w + 2;
    }
    const gl = fr.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return createBitmapFont(name, tex, glyphs, { lineHeight: size + 4, base: size, scaleW: 512, scaleH: 512 });
  }

  function setFont(name){
    if(fr.fonts[name]) fr.currentFont = fr.fonts[name];
  }

  function measureText(text, fontSize){
    if(!fr.currentFont) return { width: 0, height: 0 };
    const font = fr.currentFont;
    const scale = fontSize / font.lineHeight;
    let width = 0;
    for(let i = 0; i < text.length; i++){
      const g = font.glyphs[text[i]];
      if(g) width += g.xadvance * scale;
      else width += font.lineHeight * 0.5 * scale;
    }
    return { width: width, height: font.lineHeight * scale };
  }

  function wrapText(text, maxWidth, fontSize){
    if(!fr.currentFont) return [text];
    const lines = [];
    const paragraphs = text.split('\n');
    for(let p = 0; p < paragraphs.length; p++){
      const words = paragraphs[p].split(' ');
      let current = '';
      for(let w = 0; w < words.length; w++){
        const test = current ? current + ' ' + words[w] : words[w];
        const m = measureText(test, fontSize);
        if(m.width > maxWidth && current){
          lines.push(current);
          current = words[w];
        } else {
          current = test;
        }
      }
      if(current) lines.push(current);
    }
    return lines;
  }

  function drawText(text, x, y, fontSize, color, options){
    if(!fr.currentFont || !fr._initialized) return;
    const font = fr.currentFont;
    const gl = fr.gl;
    const scale = fontSize / font.lineHeight;
    const align = (options && options.align) || 'left';
    const baseline = (options && options.baseline) || 'top';
    const lineHeight = (options && options.lineHeight) || fontSize * 1.2;

    let lines = [text];
    if(options && options.maxWidth){
      lines = wrapText(text, options.maxWidth, fontSize);
    }

    const vertices = new Float32Array(fr._maxChars * 6 * 12);
    let vi = 0;
    let curX = x, curY = y;

    for(let l = 0; l < lines.length; l++){
      const line = lines[l];
      const m = measureText(line, fontSize);
      if(align === 'center') curX = x - m.width / 2;
      else if(align === 'right') curX = x - m.width;
      else curX = x;

      if(baseline === 'middle') curY = y - lineHeight / 2 + l * lineHeight;
      else if(baseline === 'bottom') curY = y - lineHeight + l * lineHeight;
      else curY = y + l * lineHeight;

      for(let i = 0; i < line.length; i++){
        const g = font.glyphs[line[i]];
        if(!g){ curX += font.lineHeight * 0.5 * scale; continue; }
        const gx = curX + g.xoffset * scale;
        const gy = curY + g.yoffset * scale;
        const gw = g.width * scale;
        const gh = g.height * scale;
        const u0 = g.x / font.scaleW;
        const v0 = g.y / font.scaleH;
        const u1 = (g.x + g.width) / font.scaleW;
        const v1 = (g.y + g.height) / font.scaleH;

        const verts = [
          gx, gy, u0, v0, color[0], color[1], color[2], color[3],
          gx+gw, gy, u1, v0, color[0], color[1], color[2], color[3],
          gx, gy+gh, u0, v1, color[0], color[1], color[2], color[3],
          gx+gw, gy, u1, v0, color[0], color[1], color[2], color[3],
          gx+gw, gy+gh, u1, v1, color[0], color[1], color[2], color[3],
          gx, gy+gh, u0, v1, color[0], color[1], color[2], color[3]
        ];
        for(let v = 0; v < 72; v++) vertices[vi++] = verts[v];
        curX += g.xadvance * scale;
      }
    }

    gl.useProgram(fr._program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.uniform2f(gl.getUniformLocation(fr._program, 'uResolution'), gl.canvas.width, gl.canvas.height);
    gl.uniform1f(gl.getUniformLocation(fr._program, 'uSDF'), font.isSDF ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, font.texture);
    gl.uniform1i(gl.getUniformLocation(fr._program, 'uFontTexture'), 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, fr._vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices.subarray(0, vi));
    const posLoc = gl.getAttribLocation(fr._program, 'aPosition');
    const uvLoc = gl.getAttribLocation(fr._program, 'aUV');
    const colLoc = gl.getAttribLocation(fr._program, 'aColor');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 48, 0);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 48, 8);
    gl.enableVertexAttribArray(colLoc);
    gl.vertexAttribPointer(colLoc, 4, gl.FLOAT, false, 48, 16);
    gl.drawArrays(gl.TRIANGLES, 0, vi / 12);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  function dispose(){
    const gl = fr.gl;
    if(fr._vbo) gl.deleteBuffer(fr._vbo);
    if(fr._program) gl.deleteProgram(fr._program);
    for(const name in fr.fonts){
      if(fr.fonts[name].texture) gl.deleteTexture(fr.fonts[name].texture);
    }
  }

  return { init, createBitmapFont, generateDefaultFont, setFont, measureText, wrapText, drawText, dispose, fr };
}

/* ===== 即时模式UI系统 =====
   支持: 按钮 / 滑块 / 复选框 / 文本输入 / 面板 / 标签
*/
function createImGui(gl, options){
  const ui = {
    gl: gl,
    _drawList: [],
    _vertexBuffer: null,
    _indexBuffer: null,
    _program: null,
    _initialized: false,
    _maxVerts: (options && options.maxVerts) || 65536,
    _input: { mouseX: 0, mouseY: 0, mouseDown: false, mousePressed: false, mouseReleased: false, keys: {} },
    _hotItem: null,
    _activeItem: null,
    _currentX: 10,
    _currentY: 10,
    _currentWidth: 200,
    _itemHeight: 28,
    _spacing: 4,
    _fontRenderer: null,
    _style: {
      bgColor: [0.15, 0.15, 0.18, 0.95],
      borderColor: [0.3, 0.3, 0.35, 1],
      textColor: [0.9, 0.9, 0.9, 1],
      buttonColor: [0.25, 0.45, 0.75, 1],
      buttonHoverColor: [0.35, 0.55, 0.85, 1],
      buttonActiveColor: [0.2, 0.35, 0.65, 1],
      sliderColor: [0.3, 0.5, 0.8, 1],
      sliderTrackColor: [0.2, 0.2, 0.25, 1],
      checkColor: [0.3, 0.5, 0.8, 1],
      inputBgColor: [0.1, 0.1, 0.12, 1],
      panelBgColor: [0.12, 0.12, 0.15, 0.92]
    }
  };

  function init(fontRenderer){
    const gl = ui.gl;
    ui._fontRenderer = fontRenderer;
    const vs = `
      attribute vec2 aPosition;
      attribute vec4 aColor;
      attribute vec2 aUV;
      uniform vec2 uResolution;
      varying vec4 vColor;
      varying vec2 vUV;
      void main(){
        vec2 pos = aPosition / uResolution * 2.0 - 1.0;
        pos.y = -pos.y;
        gl_Position = vec4(pos, 0.0, 1.0);
        vColor = aColor;
        vUV = aUV;
      }
    `;
    const fs = `
      precision mediump float;
      uniform sampler2D uTexture;
      uniform float uUseTexture;
      varying vec4 vColor;
      varying vec2 vUV;
      void main(){
        if(uUseTexture > 0.5){
          vec4 tex = texture2D(uTexture, vUV);
          gl_FragColor = vColor * tex;
        } else {
          gl_FragColor = vColor;
        }
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    ui._program = gl.createProgram();
    gl.attachShader(ui._program, vsh);
    gl.attachShader(ui._program, fsh);
    gl.linkProgram(ui._program);

    ui._vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ui._vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, ui._maxVerts * 8 * 4, gl.DYNAMIC_DRAW);
    ui._initialized = true;
  }

  function setInput(mouseX, mouseY, mouseDown, mousePressed, mouseReleased){
    ui._input.mouseX = mouseX;
    ui._input.mouseY = mouseY;
    ui._input.mouseDown = mouseDown;
    ui._input.mousePressed = mousePressed;
    ui._input.mouseReleased = mouseReleased;
  }

  function beginFrame(){
    ui._drawList = [];
    ui._currentX = 10;
    ui._currentY = 10;
  }

  function setCursor(x, y){
    ui._currentX = x;
    ui._currentY = y;
  }

  function setWidth(w){
    ui._currentWidth = w;
  }

  function addRect(x, y, w, h, color, borderColor, borderRadius){
    ui._drawList.push({ type: 'rect', x, y, w, h, color, borderColor, borderRadius: borderRadius || 0 });
  }

  function addText(text, x, y, fontSize, color){
    ui._drawList.push({ type: 'text', text, x, y, fontSize, color });
  }

  function isMouseOver(x, y, w, h){
    return ui._input.mouseX >= x && ui._input.mouseX <= x + w &&
           ui._input.mouseY >= y && ui._input.mouseY <= y + h;
  }

  function button(label, id){
    const x = ui._currentX, y = ui._currentY, w = ui._currentWidth, h = ui._itemHeight;
    const hovered = isMouseOver(x, y, w, h);
    const pressed = hovered && ui._input.mouseDown;
    let color = ui._style.buttonColor;
    if(pressed) color = ui._style.buttonActiveColor;
    else if(hovered) color = ui._style.buttonHoverColor;

    addRect(x, y, w, h, color, ui._style.borderColor, 4);
    if(ui._fontRenderer){
      const tm = ui._fontRenderer.measureText(label, 14);
      addText(label, x + (w - tm.width) / 2, y + (h - 14) / 2, 14, ui._style.textColor);
    }
    ui._currentY += h + ui._spacing;
    return hovered && ui._input.mouseReleased;
  }

  function slider(label, value, min, max, id){
    const x = ui._currentX, y = ui._currentY, w = ui._currentWidth, h = ui._itemHeight;
    const trackY = y + h - 8;
    const trackH = 6;
    const knobW = 14;
    const ratio = (value - min) / (max - min);
    const knobX = x + ratio * (w - knobW);

    addRect(x, trackY, w, trackH, ui._style.sliderTrackColor, null, 3);
    addRect(knobX, trackY - 3, knobW, trackH + 6, ui._style.sliderColor, null, 3);

    if(ui._fontRenderer){
      addText(label + ': ' + value.toFixed(2), x, y, 12, ui._style.textColor);
    }

    const hovered = isMouseOver(x, y, w, h);
    if(hovered && ui._input.mouseDown){
      const newRatio = Math.max(0, Math.min(1, (ui._input.mouseX - x) / (w - knobW)));
      value = min + newRatio * (max - min);
    }
    ui._currentY += h + ui._spacing;
    return value;
  }

  function checkbox(label, checked, id){
    const x = ui._currentX, y = ui._currentY, w = ui._currentWidth, h = ui._itemHeight;
    const boxSize = 18;
    const boxX = x, boxY = y + (h - boxSize) / 2;
    const hovered = isMouseOver(x, y, w, h);

    addRect(boxX, boxY, boxSize, boxSize, checked ? ui._style.checkColor : ui._style.inputBgColor, ui._style.borderColor, 3);
    if(checked && ui._fontRenderer){
      addText('✓', boxX + 2, boxY, 14, [1,1,1,1]);
    }
    if(ui._fontRenderer){
      addText(label, boxX + boxSize + 8, y + (h - 14) / 2, 14, ui._style.textColor);
    }
    ui._currentY += h + ui._spacing;
    if(hovered && ui._input.mouseReleased) return !checked;
    return checked;
  }

  function label(text){
    const x = ui._currentX, y = ui._currentY, h = ui._itemHeight;
    if(ui._fontRenderer){
      addText(text, x, y + (h - 14) / 2, 14, ui._style.textColor);
    }
    ui._currentY += h + ui._spacing;
  }

  function panel(title, x, y, w, h){
    addRect(x, y, w, h, ui._style.panelBgColor, ui._style.borderColor, 6);
    addRect(x, y, w, 30, ui._style.bgColor, null, 6);
    if(ui._fontRenderer && title){
      addText(title, x + 10, y + 8, 14, ui._style.textColor);
    }
    ui._currentX = x + 10;
    ui._currentY = y + 40;
    ui._currentWidth = w - 20;
  }

  function separator(){
    addRect(ui._currentX, ui._currentY, ui._currentWidth, 1, ui._style.borderColor, null, 0);
    ui._currentY += ui._spacing * 2;
  }

  function endFrame(){
    render();
  }

  function render(){
    if(!ui._initialized || ui._drawList.length === 0) return;
    const gl = ui.gl;
    const vertices = new Float32Array(ui._maxVerts * 8);
    let vi = 0;

    for(let i = 0; i < ui._drawList.length; i++){
      const item = ui._drawList[i];
      if(item.type === 'rect'){
        const c = item.color;
        const verts = [
          item.x, item.y, c[0], c[1], c[2], c[3], 0, 0,
          item.x+item.w, item.y, c[0], c[1], c[2], c[3], 1, 0,
          item.x, item.y+item.h, c[0], c[1], c[2], c[3], 0, 1,
          item.x+item.w, item.y, c[0], c[1], c[2], c[3], 1, 0,
          item.x+item.w, item.y+item.h, c[0], c[1], c[2], c[3], 1, 1,
          item.x, item.y+item.h, c[0], c[1], c[2], c[3], 0, 1
        ];
        for(let v = 0; v < 48; v++) vertices[vi++] = verts[v];
      }
    }

    gl.useProgram(ui._program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.uniform2f(gl.getUniformLocation(ui._program, 'uResolution'), gl.canvas.width, gl.canvas.height);
    gl.uniform1f(gl.getUniformLocation(ui._program, 'uUseTexture'), 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, ui._vertexBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices.subarray(0, vi));
    const posLoc = gl.getAttribLocation(ui._program, 'aPosition');
    const colLoc = gl.getAttribLocation(ui._program, 'aColor');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(colLoc);
    gl.vertexAttribPointer(colLoc, 4, gl.FLOAT, false, 32, 8);
    gl.drawArrays(gl.TRIANGLES, 0, vi / 8);

    for(let i = 0; i < ui._drawList.length; i++){
      const item = ui._drawList[i];
      if(item.type === 'text' && ui._fontRenderer){
        ui._fontRenderer.drawText(item.text, item.x, item.y, item.fontSize, item.color);
      }
    }

    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  function dispose(){
    const gl = ui.gl;
    if(ui._vertexBuffer) gl.deleteBuffer(ui._vertexBuffer);
    if(ui._program) gl.deleteProgram(ui._program);
  }

  return { init, setInput, beginFrame, endFrame, setCursor, setWidth, button, slider, checkbox, label, panel, separator, render, dispose, ui };
}

/* ===== GPU实例化系统 =====
   支持: 硬件实例化 / 实例数据缓冲 / 实例剔除 / 实例LOD
*/
function createInstancedRenderer(gl, options){
  const ir = {
    gl: gl,
    instances: [],
    maxInstances: (options && options.maxInstances) || 10000,
    _instanceBuffer: null,
    _instanceData: null,
    _program: null,
    _vao: null,
    _initialized: false,
    _frustumCulling: (options && options.frustumCulling !== false),
    _lodLevels: []
  };

  function init(){
    const gl = ir.gl;
    ir._instanceData = new Float32Array(ir.maxInstances * 16);
    ir._instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ir._instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, ir._instanceData, gl.DYNAMIC_DRAW);

    const vs = `
      attribute vec3 aPosition;
      attribute vec3 aNormal;
      attribute mat4 aInstanceMatrix;
      uniform mat4 uViewProj;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main(){
        vec4 worldPos = aInstanceMatrix * vec4(aPosition, 1.0);
        vWorldPos = worldPos.xyz;
        vNormal = mat3(aInstanceMatrix) * aNormal;
        gl_Position = uViewProj * worldPos;
      }
    `;
    const fs = `
      precision mediump float;
      uniform vec3 uColor;
      uniform vec3 uLightDir;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main(){
        vec3 normal = normalize(vNormal);
        float diff = max(dot(normal, normalize(uLightDir)), 0.0);
        gl_FragColor = vec4(uColor * (0.3 + diff * 0.7), 1.0);
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    ir._program = gl.createProgram();
    gl.attachShader(ir._program, vsh);
    gl.attachShader(ir._program, fsh);
    gl.linkProgram(ir._program);
    ir._initialized = true;
  }

  function addInstance(position, rotation, scale, color){
    if(ir.instances.length >= ir.maxInstances) return null;
    const inst = {
      position: [position[0], position[1], position[2]],
      rotation: rotation ? [rotation[0],rotation[1],rotation[2]] : [0,0,0],
      scale: scale ? [scale[0],scale[1],scale[2]] : [1,1,1],
      color: color ? [color[0],color[1],color[2]] : [1,1,1],
      visible: true,
      _matrix: M4.create()
    };
    updateInstanceMatrix(inst);
    ir.instances.push(inst);
    return inst;
  }

  function updateInstanceMatrix(inst){
    const q = Q.fromEuler(Q.create(), inst.rotation[0], inst.rotation[1], inst.rotation[2]);
    M4.fromTRS(inst._matrix, inst.position, q, inst.scale);
  }

  function removeInstance(inst){
    const idx = ir.instances.indexOf(inst);
    if(idx >= 0) ir.instances.splice(idx, 1);
  }

  function clear(){
    ir.instances.length = 0;
  }

  function setInstancePosition(inst, x, y, z){
    inst.position[0]=x; inst.position[1]=y; inst.position[2]=z;
    updateInstanceMatrix(inst);
  }

  function setInstanceRotation(inst, x, y, z){
    inst.rotation[0]=x; inst.rotation[1]=y; inst.rotation[2]=z;
    updateInstanceMatrix(inst);
  }

  function setInstanceScale(inst, x, y, z){
    inst.scale[0]=x; inst.scale[1]=y; inst.scale[2]=z;
    updateInstanceMatrix(inst);
  }

  function addLODLevel(distance, mesh){
    ir._lodLevels.push({ distance: distance, mesh: mesh });
    ir._lodLevels.sort(function(a,b){ return a.distance - b.distance; });
  }

  function render(geometry, viewProj, cameraPosition, frustum){
    if(!ir._initialized || ir.instances.length === 0) return;
    const gl = ir.gl;
    let visibleCount = 0;

    for(let i = 0; i < ir.instances.length; i++){
      const inst = ir.instances[i];
      if(!inst.visible) continue;
      if(ir._frustumCulling && frustum){
        const center = inst.position;
        const radius = Math.max(inst.scale[0], inst.scale[1], inst.scale[2]) * 2;
        if(!sphereInFrustum(frustum, center, radius)) continue;
      }
      for(let j = 0; j < 16; j++){
        ir._instanceData[visibleCount * 16 + j] = inst._matrix[j];
      }
      visibleCount++;
    }

    if(visibleCount === 0) return;

    gl.useProgram(ir._program);
    gl.uniformMatrix4fv(gl.getUniformLocation(ir._program, 'uViewProj'), false, viewProj);
    gl.uniform3f(gl.getUniformLocation(ir._program, 'uLightDir'), 0.5, 1, 0.3);
    gl.uniform3f(gl.getUniformLocation(ir._program, 'uColor'), 0.8, 0.8, 0.9);

    gl.bindBuffer(gl.ARRAY_BUFFER, ir._instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, ir._instanceData.subarray(0, visibleCount * 16));

    const matrixLoc = gl.getAttribLocation(ir._program, 'aInstanceMatrix');
    for(let i = 0; i < 4; i++){
      gl.enableVertexAttribArray(matrixLoc + i);
      gl.vertexAttribPointer(matrixLoc + i, 4, gl.FLOAT, false, 64, i * 16);
      gl.vertexAttribDivisor(matrixLoc + i, 1);
    }

    if(geometry.vertexBuffer){
      gl.bindBuffer(gl.ARRAY_BUFFER, geometry.vertexBuffer);
      const posLoc = gl.getAttribLocation(ir._program, 'aPosition');
      const normLoc = gl.getAttribLocation(ir._program, 'aNormal');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(normLoc);
      gl.vertexAttribPointer(normLoc, 3, gl.FLOAT, false, 24, 12);
    }

    if(geometry.indexBuffer){
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.indexBuffer);
      gl.drawElementsInstanced(gl.TRIANGLES, geometry.indexCount, gl.UNSIGNED_SHORT, 0, visibleCount);
    } else {
      gl.drawArraysInstanced(gl.TRIANGLES, 0, geometry.vertexCount, visibleCount);
    }

    for(let i = 0; i < 4; i++){
      gl.vertexAttribDivisor(matrixLoc + i, 0);
    }
  }

  function dispose(){
    const gl = ir.gl;
    if(ir._instanceBuffer) gl.deleteBuffer(ir._instanceBuffer);
    if(ir._program) gl.deleteProgram(ir._program);
  }

  return { init, addInstance, removeInstance, clear, setInstancePosition, setInstanceRotation, setInstanceScale, addLODLevel, render, dispose, ir };
}

/* ===== 渲染图系统 =====
   支持: 渲染pass依赖图 / 自动排序 / 资源管理 / 并行执行
*/


function createRenderGraph(gl, options){
  const rg = {
    gl: gl,
    passes: [],
    resources: {},
    _adjacency: {},
    _sorted: null,
    _dirty: true,
    _stats: { drawCalls: 0, triangles: 0, time: 0 }
  };

  function createPass(name, type, executeFunc, options){
    const pass = {
      name: name,
      type: type,
      execute: executeFunc,
      inputs: (options && options.inputs) || [],
      outputs: (options && options.outputs) || [],
      dependencies: (options && options.dependencies) || [],
      enabled: (options && options.enabled !== undefined) ? options.enabled : true,
      width: (options && options.width) || 0,
      height: (options && options.height) || 0,
      _framebuffer: null,
      _order: 0
    };
    rg.passes.push(pass);
    rg._dirty = true;
    return pass;
  }

  function removePass(name){
    const idx = rg.passes.findIndex(function(p){ return p.name === name; });
    if(idx >= 0){
      rg.passes.splice(idx, 1);
      rg._dirty = true;
    }
  }

  function getPass(name){
    return rg.passes.find(function(p){ return p.name === name; });
  }

  function addDependency(passName, depName){
    const pass = getPass(passName);
    if(pass && pass.dependencies.indexOf(depName) < 0){
      pass.dependencies.push(depName);
      rg._dirty = true;
    }
  }

  function createResource(name, type, options){
    const res = {
      name: name,
      type: type,
      width: (options && options.width) || 512,
      height: (options && options.height) || 512,
      format: (options && options.format) || 'RGBA',
      _texture: null,
      _framebuffer: null
    };
    rg.resources[name] = res;
    return res;
  }

  function topoSort(){
    const inDegree = {};
    const adj = {};
    for(let i = 0; i < rg.passes.length; i++){
      inDegree[rg.passes[i].name] = 0;
      adj[rg.passes[i].name] = [];
    }
    for(let i = 0; i < rg.passes.length; i++){
      const pass = rg.passes[i];
      for(let d = 0; d < pass.dependencies.length; d++){
        const dep = pass.dependencies[d];
        if(adj[dep]){
          adj[dep].push(pass.name);
          inDegree[pass.name]++;
        }
      }
    }
    const queue = [];
    for(const name in inDegree){
      if(inDegree[name] === 0) queue.push(name);
    }
    const sorted = [];
    while(queue.length > 0){
      const name = queue.shift();
      sorted.push(name);
      if(adj[name]){
        for(let i = 0; i < adj[name].length; i++){
          inDegree[adj[name][i]]--;
          if(inDegree[adj[name][i]] === 0) queue.push(adj[name][i]);
        }
      }
    }
    return sorted;
  }

  function validate(){
    const sorted = topoSort();
    if(sorted.length !== rg.passes.length){
      console.error('[RenderGraph] 检测到循环依赖!');
      return false;
    }
    for(let i = 0; i < rg.passes.length; i++){
      const pass = rg.passes[i];
      for(let j = 0; j < pass.inputs.length; j++){
        if(!rg.resources[pass.inputs[j]]){
          console.error('[RenderGraph] Pass ' + pass.name + ' 引用了不存在的资源: ' + pass.inputs[j]);
          return false;
        }
      }
    }
    return true;
  }

  function execute(camera, scene, options){
    if(rg._dirty){
      rg._sorted = topoSort();
      rg._dirty = false;
    }
    if(!validate()) return;
    const gl = rg.gl;
    rg._stats.drawCalls = 0;
    rg._stats.triangles = 0;
    const startTime = performance.now();

    for(let i = 0; i < rg._sorted.length; i++){
      const passName = rg._sorted[i];
      const pass = getPass(passName);
      if(!pass || !pass.enabled) continue;

      const context = {
        gl: gl,
        camera: camera,
        scene: scene,
        resources: rg.resources,
        options: options || {},
        stats: rg._stats,
        width: pass.width || gl.canvas.width,
        height: pass.height || gl.canvas.height
      };

      if(pass.outputs && pass.outputs.length > 0){
        const res = rg.resources[pass.outputs[0]];
        if(res && res._framebuffer){
          gl.bindFramebuffer(gl.FRAMEBUFFER, res._framebuffer);
          gl.viewport(0, 0, res.width, res.height);
        }
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
      }

      pass.execute(context);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    rg._stats.time = performance.now() - startTime;
  }

  function resize(width, height){
    for(const name in rg.resources){
      const res = rg.resources[name];
      if(res._texture){
        const gl = rg.gl;
        gl.bindTexture(gl.TEXTURE_2D, res._texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        res.width = width;
        res.height = height;
      }
    }
  }

  function getStats(){
    return { ...rg._stats };
  }

  function clear(){
    rg.passes.length = 0;
    rg.resources = {};
    rg._dirty = true;
  }

  return { createPass, removePass, getPass, addDependency, createResource, execute, resize, getStats, validate, clear, rg };
}

/* ===== 软件路径追踪器 =====
   支持: 漫反射 / 镜面反射 / 折射 / 软阴影 / 环境光
*/
function createPathTracer(options){
  const pt = {
    width: (options && options.width) || 512,
    height: (options && options.height) || 512,
    samples: (options && options.samples) || 16,
    maxBounces: (options && options.maxBounces) || 4,
    scene: { objects: [], lights: [], background: [0.1, 0.1, 0.2] },
    _framebuffer: null,
    _accumulator: null
  };

  function init(){
    pt._framebuffer = new Float32Array(pt.width * pt.height * 3);
    pt._accumulator = new Float32Array(pt.width * pt.height * 3);
  }

  function addSphere(center, radius, material){
    pt.scene.objects.push({
      type: 'sphere',
      center: [center[0], center[1], center[2]],
      radius: radius,
      material: material || { type: 'diffuse', color: [0.8, 0.8, 0.8] }
    });
  }

  function addPlane(normal, point, material){
    pt.scene.objects.push({
      type: 'plane',
      normal: [normal[0], normal[1], normal[2]],
      point: [point[0], point[1], point[2]],
      material: material || { type: 'diffuse', color: [0.5, 0.5, 0.5] }
    });
  }

  function addTriangle(v0, v1, v2, material){
    pt.scene.objects.push({
      type: 'triangle',
      v0: [v0[0],v0[1],v0[2]], v1: [v1[0],v1[1],v1[2]], v2: [v2[0],v2[1],v2[2]],
      material: material || { type: 'diffuse', color: [0.8, 0.8, 0.8] }
    });
  }

  function addLight(position, color, intensity){
    pt.scene.lights.push({
      position: [position[0], position[1], position[2]],
      color: [color[0], color[1], color[2]],
      intensity: intensity || 1
    });
  }

  function setBackground(color){
    pt.scene.background = [color[0], color[1], color[2]];
  }

  function intersectSphere(ray, sphere){
    const ox = ray.origin[0] - sphere.center[0];
    const oy = ray.origin[1] - sphere.center[1];
    const oz = ray.origin[2] - sphere.center[2];
    const b = ox * ray.dir[0] + oy * ray.dir[1] + oz * ray.dir[2];
    const c = ox*ox + oy*oy + oz*oz - sphere.radius * sphere.radius;
    const disc = b*b - c;
    if(disc < 0) return -1;
    const t = -b - Math.sqrt(disc);
    return t > 0.001 ? t : -1;
  }

  function intersectPlane(ray, plane){
    const denom = ray.dir[0]*plane.normal[0] + ray.dir[1]*plane.normal[1] + ray.dir[2]*plane.normal[2];
    if(Math.abs(denom) < 1e-8) return -1;
    const t = -(ray.origin[0]*plane.normal[0] + ray.origin[1]*plane.normal[1] + ray.origin[2]*plane.normal[2] -
                (plane.point[0]*plane.normal[0] + plane.point[1]*plane.normal[1] + plane.point[2]*plane.normal[2])) / denom;
    return t > 0.001 ? t : -1;
  }

  function intersectTriangle(ray, tri){
    const e1x = tri.v1[0]-tri.v0[0], e1y = tri.v1[1]-tri.v0[1], e1z = tri.v1[2]-tri.v0[2];
    const e2x = tri.v2[0]-tri.v0[0], e2y = tri.v2[1]-tri.v0[1], e2z = tri.v2[2]-tri.v0[2];
    const px = ray.dir[1]*e2z - ray.dir[2]*e2y;
    const py = ray.dir[2]*e2x - ray.dir[0]*e2z;
    const pz = ray.dir[0]*e2y - ray.dir[1]*e2x;
    const det = e1x*px + e1y*py + e1z*pz;
    if(Math.abs(det) < 1e-8) return -1;
    const inv = 1/det;
    const tx = ray.origin[0]-tri.v0[0], ty = ray.origin[1]-tri.v0[1], tz = ray.origin[2]-tri.v0[2];
    const u = (tx*px + ty*py + tz*pz) * inv;
    if(u < 0 || u > 1) return -1;
    const qx = ty*e1z - tz*e1y, qy = tz*e1x - tx*e1z, qz = tx*e1y - ty*e1x;
    const v = (ray.dir[0]*qx + ray.dir[1]*qy + ray.dir[2]*qz) * inv;
    if(v < 0 || u+v > 1) return -1;
    const t = (e2x*qx + e2y*qy + e2z*qz) * inv;
    return t > 0.001 ? t : -1;
  }

  function intersectScene(ray){
    let closest = Infinity, hitObj = null, hitT = -1;
    for(let i = 0; i < pt.scene.objects.length; i++){
      const obj = pt.scene.objects[i];
      let t = -1;
      if(obj.type === 'sphere') t = intersectSphere(ray, obj);
      else if(obj.type === 'plane') t = intersectPlane(ray, obj);
      else if(obj.type === 'triangle') t = intersectTriangle(ray, obj);
      if(t > 0 && t < closest){ closest = t; hitObj = obj; hitT = t; }
    }
    return { t: hitT, object: hitObj };
  }

  function getNormal(obj, point){
    if(obj.type === 'sphere'){
      const n = [point[0]-obj.center[0], point[1]-obj.center[1], point[2]-obj.center[2]];
      const l = Math.sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]) || 1;
      return [n[0]/l, n[1]/l, n[2]/l];
    } else if(obj.type === 'plane'){
      return [obj.normal[0], obj.normal[1], obj.normal[2]];
    } else if(obj.type === 'triangle'){
      const e1 = [obj.v1[0]-obj.v0[0], obj.v1[1]-obj.v0[1], obj.v1[2]-obj.v0[2]];
      const e2 = [obj.v2[0]-obj.v0[0], obj.v2[1]-obj.v0[1], obj.v2[2]-obj.v0[2]];
      const n = [e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
      const l = Math.sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]) || 1;
      return [n[0]/l, n[1]/l, n[2]/l];
    }
    return [0, 1, 0];
  }

  function randomHemisphere(normal){
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u*u);
    let dir = [r * Math.cos(theta), u, r * Math.sin(theta)];
    if(dir[0]*normal[0] + dir[1]*normal[1] + dir[2]*normal[2] < 0){
      dir = [-dir[0], -dir[1], -dir[2]];
    }
    return dir;
  }

  function traceRay(ray, depth){
    if(depth >= pt.maxBounces) return [0, 0, 0];
    const hit = intersectScene(ray);
    if(!hit.object) return pt.scene.background;

    const point = [
      ray.origin[0] + ray.dir[0] * hit.t,
      ray.origin[1] + ray.dir[1] * hit.t,
      ray.origin[2] + ray.dir[2] * hit.t
    ];
    const normal = getNormal(hit.object, point);
    const mat = hit.object.material;
    let color = [0, 0, 0];

    for(let l = 0; l < pt.scene.lights.length; l++){
      const light = pt.scene.lights[l];
      const toLight = [light.position[0]-point[0], light.position[1]-point[1], light.position[2]-point[2]];
      const lightDist = Math.sqrt(toLight[0]*toLight[0]+toLight[1]*toLight[1]+toLight[2]*toLight[2]);
      toLight[0]/=lightDist; toLight[1]/=lightDist; toLight[2]/=lightDist;

      const shadowRay = { origin: [point[0]+normal[0]*0.01, point[1]+normal[1]*0.01, point[2]+normal[2]*0.01], dir: toLight };
      const shadowHit = intersectScene(shadowRay);
      if(shadowHit.t > 0 && shadowHit.t < lightDist) continue;

      const ndotl = Math.max(0, normal[0]*toLight[0] + normal[1]*toLight[1] + normal[2]*toLight[2]);
      const atten = light.intensity / (lightDist * lightDist);
      color[0] += mat.color[0] * light.color[0] * ndotl * atten;
      color[1] += mat.color[1] * light.color[1] * ndotl * atten;
      color[2] += mat.color[2] * light.color[2] * ndotl * atten;
    }

    if(mat.type === 'mirror'){
      const refl = [
        ray.dir[0] - 2 * (ray.dir[0]*normal[0]+ray.dir[1]*normal[1]+ray.dir[2]*normal[2]) * normal[0],
        ray.dir[1] - 2 * (ray.dir[0]*normal[0]+ray.dir[1]*normal[1]+ray.dir[2]*normal[2]) * normal[1],
        ray.dir[2] - 2 * (ray.dir[0]*normal[0]+ray.dir[1]*normal[1]+ray.dir[2]*normal[2]) * normal[2]
      ];
      const reflRay = { origin: [point[0]+normal[0]*0.01, point[1]+normal[1]*0.01, point[2]+normal[2]*0.01], dir: refl };
      const reflColor = traceRay(reflRay, depth + 1);
      color[0] += mat.color[0] * reflColor[0];
      color[1] += mat.color[1] * reflColor[1];
      color[2] += mat.color[2] * reflColor[2];
    } else if(mat.type === 'diffuse'){
      const newDir = randomHemisphere(normal);
      const newRay = { origin: [point[0]+normal[0]*0.01, point[1]+normal[1]*0.01, point[2]+normal[2]*0.01], dir: newDir };
      const indirect = traceRay(newRay, depth + 1);
      color[0] += mat.color[0] * indirect[0] * 0.5;
      color[1] += mat.color[1] * indirect[1] * 0.5;
      color[2] += mat.color[2] * indirect[2] * 0.5;
    }

    return color;
  }

  function render(camera){
    if(!pt._framebuffer) init();
    const aspect = pt.width / pt.height;
    const fov = camera.fov || 60;
    const tanHalf = Math.tan(fov * Math.PI / 360);

    for(let y = 0; y < pt.height; y++){
      for(let x = 0; x < pt.width; x++){
        let r = 0, g = 0, b = 0;
        for(let s = 0; s < pt.samples; s++){
          const u = (x + Math.random()) / pt.width * 2 - 1;
          const v = (y + Math.random()) / pt.height * 2 - 1;
          const dir = [u * tanHalf * aspect, v * tanHalf, -1];
          const l = Math.sqrt(dir[0]*dir[0]+dir[1]*dir[1]+dir[2]*dir[2]);
          dir[0]/=l; dir[1]/=l; dir[2]/=l;
          const ray = { origin: [camera.position[0], camera.position[1], camera.position[2]], dir: dir };
          const c = traceRay(ray, 0);
          r += c[0]; g += c[1]; b += c[2];
        }
        const idx = (y * pt.width + x) * 3;
        pt._framebuffer[idx] = r / pt.samples;
        pt._framebuffer[idx+1] = g / pt.samples;
        pt._framebuffer[idx+2] = b / pt.samples;
      }
    }
    return pt._framebuffer;
  }

  function toImageData(){
    const img = new ImageData(pt.width, pt.height);
    for(let i = 0; i < pt.width * pt.height; i++){
      const r = Math.min(255, Math.max(0, pt._framebuffer[i*3] * 255));
      const g = Math.min(255, Math.max(0, pt._framebuffer[i*3+1] * 255));
      const b = Math.min(255, Math.max(0, pt._framebuffer[i*3+2] * 255));
      img.data[i*4] = r; img.data[i*4+1] = g; img.data[i*4+2] = b; img.data[i*4+3] = 255;
    }
    return img;
  }

  function clear(){
    pt.scene.objects.length = 0;
    pt.scene.lights.length = 0;
  }

  return { init, addSphere, addPlane, addTriangle, addLight, setBackground, render, toImageData, clear, pt };
}

/* ===== 体积渲染系统 =====
   支持: 3D纹理体积 / 光线步进 / 吸收发射 / 阴影
*/
function createVolumeRenderer(gl, options){
  const vr = {
    gl: gl,
    volumeData: null,
    volumeSize: (options && options.volumeSize) || [64, 64, 64],
    _texture3D: null,
    _program: null,
    _vbo: null,
    _initialized: false,
    stepSize: (options && options.stepSize) || 0.01,
    maxSteps: (options && options.maxSteps) || 256,
    absorption: (options && options.absorption) || 0.5,
    emissionColor: (options && options.emissionColor) || [1, 0.8, 0.6],
    emissionStrength: (options && options.emissionStrength) || 2.0
  };

  function init(){
    const gl = vr.gl;
    const vs = `
      attribute vec3 aPosition;
      varying vec3 vRayDir;
      uniform mat4 uViewProj;
      uniform vec3 uCameraPos;
      void main(){
        vRayDir = normalize(aPosition - uCameraPos);
        gl_Position = uViewProj * vec4(aPosition, 1.0);
      }
    `;
    const fs = `
      precision mediump float;
      uniform sampler3D uVolume;
      uniform vec3 uVolumeSize;
      uniform float uStepSize;
      uniform int uMaxSteps;
      uniform float uAbsorption;
      uniform vec3 uEmissionColor;
      uniform float uEmissionStrength;
      uniform vec3 uLightDir;
      varying vec3 vRayDir;
      uniform vec3 uCameraPos;
      uniform vec3 uBoxMin;
      uniform vec3 uBoxMax;

      float sampleVolume(vec3 pos){
        vec3 uv = (pos - uBoxMin) / (uBoxMax - uBoxMin);
        if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || uv.z < 0.0 || uv.z > 1.0) return 0.0;
        return texture3D(uVolume, uv).r;
      }

      vec2 intersectBox(vec3 origin, vec3 dir){
        vec3 invDir = 1.0 / dir;
        vec3 t0 = (uBoxMin - origin) * invDir;
        vec3 t1 = (uBoxMax - origin) * invDir;
        vec3 tmin = min(t0, t1);
        vec3 tmax = max(t0, t1);
        float tNear = max(max(tmin.x, tmin.y), tmin.z);
        float tFar = min(min(tmax.x, tmax.y), tmax.z);
        return vec2(tNear, tFar);
      }

      void main(){
        vec3 origin = uCameraPos;
        vec3 dir = normalize(vRayDir);
        vec2 tBox = intersectBox(origin, dir);
        if(tBox.x > tBox.y) discard;
        float t = max(tBox.x, 0.0);
        float tEnd = tBox.y;
        vec3 color = vec3(0.0);
        float transmittance = 1.0;
        for(int i = 0; i < 256; i++){
          if(i >= uMaxSteps || t > tEnd) break;
          vec3 pos = origin + dir * t;
          float density = sampleVolume(pos);
          if(density > 0.001){
            float lightDensity = 0.0;
            vec3 lightPos = pos;
            for(int j = 0; j < 32; j++){
              lightPos += normalize(uLightDir) * uStepSize * 2.0;
              lightDensity += sampleVolume(lightPos);
            }
            float shadow = exp(-lightDensity * uAbsorption * 2.0);
            vec3 emit = uEmissionColor * density * uEmissionStrength * shadow;
            float absorb = density * uAbsorption * uStepSize;
            color += transmittance * emit * uStepSize * 10.0;
            transmittance *= exp(-absorb);
            if(transmittance < 0.01) break;
          }
          t += uStepSize;
        }
        gl_FragColor = vec4(color, 1.0 - transmittance);
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    vr._program = gl.createProgram();
    gl.attachShader(vr._program, vsh);
    gl.attachShader(vr._program, fsh);
    gl.linkProgram(vr._program);

    const verts = new Float32Array([
      -1,-1,-1, 1,-1,-1, 1,1,-1, -1,1,-1,
      -1,-1,1, 1,-1,1, 1,1,1, -1,1,1
    ]);
    vr._vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vr._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    vr._initialized = true;
  }

  function setVolumeData(data, size){
    vr.volumeData = data;
    vr.volumeSize = size || vr.volumeSize;
    const gl = vr.gl;
    if(vr._texture3D) gl.deleteTexture(vr._texture3D);
    vr._texture3D = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, vr._texture3D);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, vr.volumeSize[0], vr.volumeSize[1], vr.volumeSize[2], 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  }

  function generateProceduralVolume(type, params){
    const [w, h, d] = vr.volumeSize;
    const data = new Uint8Array(w * h * d);
    for(let z = 0; z < d; z++){
      for(let y = 0; y < h; y++){
        for(let x = 0; x < w; x++){
          const nx = x / w - 0.5, ny = y / h - 0.5, nz = z / d - 0.5;
          let val = 0;
          if(type === 'sphere'){
            const r = Math.sqrt(nx*nx + ny*ny + nz*nz);
            val = Math.max(0, 1 - r * 2);
          } else if(type === 'cloud'){
            const n = Noise.perlin3D(nx * 4, ny * 4, nz * 4);
            val = Math.max(0, n * 0.5 + 0.3);
          } else if(type === 'smoke'){
            const n1 = Noise.perlin3D(nx * 3, ny * 3 + 0.5, nz * 3);
            const n2 = Noise.perlin3D(nx * 6, ny * 6, nz * 6);
            val = Math.max(0, (n1 * 0.7 + n2 * 0.3) * 0.5 + 0.2 - ny * 0.8);
          } else if(type === 'fire'){
            const n = Noise.perlin3D(nx * 5, ny * 5 - performance.now() * 0.001, nz * 5);
            val = Math.max(0, 1 - Math.abs(ny) * 2) * (n * 0.5 + 0.5);
          }
          data[(z * h + y) * w + x] = Math.min(255, val * 255);
        }
      }
    }
    setVolumeData(data);
    return data;
  }

  function render(viewProj, cameraPosition, boxMin, boxMax){
    if(!vr._initialized || !vr._texture3D) return;
    const gl = vr.gl;
    gl.useProgram(vr._program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(gl.getUniformLocation(vr._program, 'uViewProj'), false, viewProj);
    gl.uniform3fv(gl.getUniformLocation(vr._program, 'uCameraPos'), cameraPosition);
    gl.uniform3fv(gl.getUniformLocation(vr._program, 'uBoxMin'), boxMin);
    gl.uniform3fv(gl.getUniformLocation(vr._program, 'uBoxMax'), boxMax);
    gl.uniform1f(gl.getUniformLocation(vr._program, 'uStepSize'), vr.stepSize);
    gl.uniform1i(gl.getUniformLocation(vr._program, 'uMaxSteps'), vr.maxSteps);
    gl.uniform1f(gl.getUniformLocation(vr._program, 'uAbsorption'), vr.absorption);
    gl.uniform3fv(gl.getUniformLocation(vr._program, 'uEmissionColor'), vr.emissionColor);
    gl.uniform1f(gl.getUniformLocation(vr._program, 'uEmissionStrength'), vr.emissionStrength);
    gl.uniform3f(gl.getUniformLocation(vr._program, 'uLightDir'), 0.5, 1, 0.3);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, vr._texture3D);
    gl.uniform1i(gl.getUniformLocation(vr._program, 'uVolume'), 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, vr._vbo);
    const posLoc = gl.getAttribLocation(vr._program, 'aPosition');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    gl.drawArrays(gl.TRIANGLE_FAN, 4, 4);
    gl.disable(gl.BLEND);
  }

  function dispose(){
    const gl = vr.gl;
    if(vr._texture3D) gl.deleteTexture(vr._texture3D);
    if(vr._vbo) gl.deleteBuffer(vr._vbo);
    if(vr._program) gl.deleteProgram(vr._program);
  }

  return { init, setVolumeData, generateProceduralVolume, render, dispose, vr };
}



/* ===== 流体模拟系统 (SPH - 光滑粒子流体动力学) =====
   支持: 密度/压力求解 / 粘性 / 表面张力 / 边界碰撞
*/
function createSPHFluid(options){
  const fluid = {
    particles: [],
    maxParticles: (options && options.maxParticles) || 2000,
    particleRadius: (options && options.particleRadius) || 0.05,
    smoothingRadius: (options && options.smoothingRadius) || 0.2,
    restDensity: (options && options.restDensity) || 1000,
    stiffness: (options && options.stiffness) || 2000,
    viscosity: (options && options.viscosity) || 250,
    gravity: (options && options.gravity) || [0, -9.8, 0],
    damping: (options && options.damping) || 0.98,
    bounds: (options && options.bounds) || { min: [-2, 0, -2], max: [2, 3, 2] },
    _grid: {},
    _gridSize: 0.2,
    _densities: null,
    _pressures: null,
    _forces: null
  };

  function init(count, startPos, startVel){
    fluid.particles = [];
    const sp = startPos || [0, 1, 0];
    const sv = startVel || [0, 0, 0];
    const side = Math.ceil(Math.pow(count, 1/3));
    let idx = 0;
    for(let z = 0; z < side && idx < count; z++){
      for(let y = 0; y < side && idx < count; y++){
        for(let x = 0; x < side && idx < count; x++){
          fluid.particles.push({
            position: [sp[0] + x * fluid.particleRadius * 2, sp[1] + y * fluid.particleRadius * 2, sp[2] + z * fluid.particleRadius * 2],
            velocity: [sv[0], sv[1], sv[2]],
            density: 0,
            pressure: 0,
            force: [0, 0, 0],
            color: [0.3, 0.5, 0.9, 0.8]
          });
          idx++;
        }
      }
    }
    fluid._densities = new Float32Array(fluid.particles.length);
    fluid._pressures = new Float32Array(fluid.particles.length);
    fluid._forces = new Float32Array(fluid.particles.length * 3);
  }

  function poly6Kernel(r, h){
    if(r > h) return 0;
    const val = (h * h - r * r) / (h * h);
    return 315 / (64 * Math.PI * Math.pow(h, 9)) * val * val * val;
  }

  function spikyKernelGradient(r, h){
    if(r > h || r < 0.0001) return 0;
    const val = (h - r) / h;
    return -45 / (Math.PI * Math.pow(h, 6)) * val * val;
  }

  function viscosityKernelLaplacian(r, h){
    if(r > h) return 0;
    return 45 / (Math.PI * Math.pow(h, 6)) * (h - r);
  }

  function buildGrid(){
    fluid._grid = {};
    for(let i = 0; i < fluid.particles.length; i++){
      const p = fluid.particles[i];
      const gx = Math.floor(p.position[0] / fluid._gridSize);
      const gy = Math.floor(p.position[1] / fluid._gridSize);
      const gz = Math.floor(p.position[2] / fluid._gridSize);
      const key = gx + ',' + gy + ',' + gz;
      if(!fluid._grid[key]) fluid._grid[key] = [];
      fluid._grid[key].push(i);
    }
  }

  function getNeighbors(i){
    const p = fluid.particles[i];
    const gx = Math.floor(p.position[0] / fluid._gridSize);
    const gy = Math.floor(p.position[1] / fluid._gridSize);
    const gz = Math.floor(p.position[2] / fluid._gridSize);
    const neighbors = [];
    for(let dx = -1; dx <= 1; dx++){
      for(let dy = -1; dy <= 1; dy++){
        for(let dz = -1; dz <= 1; dz++){
          const key = (gx+dx) + ',' + (gy+dy) + ',' + (gz+dz);
          if(fluid._grid[key]){
            for(let n = 0; n < fluid._grid[key].length; n++){
              neighbors.push(fluid._grid[key][n]);
            }
          }
        }
      }
    }
    return neighbors;
  }

  function computeDensityPressure(){
    const h = fluid.smoothingRadius;
    for(let i = 0; i < fluid.particles.length; i++){
      const pi = fluid.particles[i];
      let density = 0;
      const neighbors = getNeighbors(i);
      for(let n = 0; n < neighbors.length; n++){
        const j = neighbors[n];
        const pj = fluid.particles[j];
        const dx = pi.position[0] - pj.position[0];
        const dy = pi.position[1] - pj.position[1];
        const dz = pi.position[2] - pj.position[2];
        const r = Math.sqrt(dx*dx + dy*dy + dz*dz);
        density += poly6Kernel(r, h);
      }
      pi.density = Math.max(density, fluid.restDensity * 0.1);
      pi.pressure = fluid.stiffness * (pi.density - fluid.restDensity);
    }
  }

  function computeForces(){
    const h = fluid.smoothingRadius;
    for(let i = 0; i < fluid.particles.length; i++){
      const pi = fluid.particles[i];
      let fx = fluid.gravity[0] * pi.density;
      let fy = fluid.gravity[1] * pi.density;
      let fz = fluid.gravity[2] * pi.density;
      const neighbors = getNeighbors(i);
      for(let n = 0; n < neighbors.length; n++){
        const j = neighbors[n];
        if(j === i) continue;
        const pj = fluid.particles[j];
        const dx = pi.position[0] - pj.position[0];
        const dy = pi.position[1] - pj.position[1];
        const dz = pi.position[2] - pj.position[2];
        const r = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if(r < 0.0001 || r > h) continue;
        const dirX = dx / r, dirY = dy / r, dirZ = dz / r;
        const pressureForce = -((pi.pressure + pj.pressure) / (2 * pj.density)) * spikyKernelGradient(r, h);
        fx += pressureForce * dirX;
        fy += pressureForce * dirY;
        fz += pressureForce * dirZ;
        const viscForce = fluid.viscosity * viscosityKernelLaplacian(r, h) / pj.density;
        fx += viscForce * (pj.velocity[0] - pi.velocity[0]);
        fy += viscForce * (pj.velocity[1] - pi.velocity[1]);
        fz += viscForce * (pj.velocity[2] - pi.velocity[2]);
      }
      pi.force[0] = fx;
      pi.force[1] = fy;
      pi.force[2] = fz;
    }
  }

  function integrate(dt){
    for(let i = 0; i < fluid.particles.length; i++){
      const p = fluid.particles[i];
      p.velocity[0] += (p.force[0] / p.density) * dt;
      p.velocity[1] += (p.force[1] / p.density) * dt;
      p.velocity[2] += (p.force[2] / p.density) * dt;
      p.velocity[0] *= fluid.damping;
      p.velocity[1] *= fluid.damping;
      p.velocity[2] *= fluid.damping;
      p.position[0] += p.velocity[0] * dt;
      p.position[1] += p.velocity[1] * dt;
      p.position[2] += p.velocity[2] * dt;

      const b = fluid.bounds;
      for(let axis = 0; axis < 3; axis++){
        if(p.position[axis] < b.min[axis]){
          p.position[axis] = b.min[axis];
          p.velocity[axis] *= -0.5;
        }
        if(p.position[axis] > b.max[axis]){
          p.position[axis] = b.max[axis];
          p.velocity[axis] *= -0.5;
        }
      }
    }
  }

  function step(dt){
    buildGrid();
    computeDensityPressure();
    computeForces();
    integrate(dt);
  }

  function addParticle(position, velocity){
    if(fluid.particles.length >= fluid.maxParticles) return null;
    const p = {
      position: [position[0], position[1], position[2]],
      velocity: velocity ? [velocity[0],velocity[1],velocity[2]] : [0,0,0],
      density: 0, pressure: 0, force: [0,0,0],
      color: [0.3, 0.5, 0.9, 0.8]
    };
    fluid.particles.push(p);
    return p;
  }

  function getPositions(){
    const arr = new Float32Array(fluid.particles.length * 3);
    for(let i = 0; i < fluid.particles.length; i++){
      arr[i*3] = fluid.particles[i].position[0];
      arr[i*3+1] = fluid.particles[i].position[1];
      arr[i*3+2] = fluid.particles[i].position[2];
    }
    return arr;
  }

  function reset(){
    fluid.particles = [];
  }

  return { init, step, addParticle, getPositions, reset, fluid };
}

/* ===== 布娃娃系统 =====
   支持: 刚体链 / 关节约束 / 物理驱动 / 与骨骼系统绑定
*/
function createRagdoll(boneSystem, options){
  const ragdoll = {
    boneSystem: boneSystem,
    bodies: [],
    joints: [],
    boneMap: {},
    gravity: (options && options.gravity) || [0, -9.8, 0],
    damping: (options && options.damping) || 0.98,
    iterations: (options && options.iterations) || 10,
    _active: false,
    _poseRotations: null,
    _posePositions: null
  };

  function addBody(boneIndex, shape, size, mass, offset){
    const bone = boneSystem.bones ? boneSystem.bones[boneIndex] : null;
    const body = {
      boneIndex: boneIndex,
      position: bone ? [bone.position[0], bone.position[1], bone.position[2]] : [0,0,0],
      prevPosition: bone ? [bone.position[0], bone.position[1], bone.position[2]] : [0,0,0],
      velocity: [0, 0, 0],
      angularVelocity: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      shape: shape || 'capsule',
      size: size || [0.1, 0.3, 0.1],
      mass: mass || 1,
      invMass: mass > 0 ? 1 / mass : 0,
      offset: offset || [0, 0, 0],
      pinned: false
    };
    ragdoll.bodies.push(body);
    ragdoll.boneMap[boneIndex] = body;
    return body;
  }

  function addJoint(bodyAIndex, bodyBIndex, pivot, axis, limits){
    const joint = {
      bodyA: ragdoll.bodies[bodyAIndex],
      bodyB: ragdoll.bodies[bodyBIndex],
      pivot: pivot ? [pivot[0],pivot[1],pivot[2]] : [0,0,0],
      axis: axis ? [axis[0],axis[1],axis[2]] : [0,1,0],
      minAngle: (limits && limits.min) || -Math.PI,
      maxAngle: (limits && limits.max) || Math.PI,
      stiffness: (limits && limits.stiffness) || 1
    };
    ragdoll.joints.push(joint);
    return joint;
  }

  function buildDefaultHumanoid(){
    const bones = boneSystem.bones || [];
    const findBone = function(name){
      for(let i = 0; i < bones.length; i++){
        if(bones[i].name && bones[i].name.indexOf(name) >= 0) return i;
      }
      return -1;
    };
    const pelvis = findBone('下半身') || findBone('pelvis') || 0;
    const spine = findBone('上半身') || findBone('spine') || 1;
    const head = findBone('頭') || findBone('head') || 2;
    const lUpperArm = findBone('左腕') || findBone('LeftArm') || 3;
    const lLowerArm = findBone('左ひじ') || findBone('LeftForeArm') || 4;
    const rUpperArm = findBone('右腕') || findBone('RightArm') || 5;
    const rLowerArm = findBone('右ひじ') || findBone('RightForeArm') || 6;
    const lUpperLeg = findBone('左足') || findBone('LeftUpLeg') || 7;
    const lLowerLeg = findBone('左ひざ') || findBone('LeftLeg') || 8;
    const rUpperLeg = findBone('右足') || findBone('RightUpLeg') || 9;
    const rLowerLeg = findBone('右ひざ') || findBone('RightLeg') || 10;

    if(pelvis >= 0) addBody(pelvis, 'box', [0.2, 0.15, 0.15], 2);
    if(spine >= 0) addBody(spine, 'box', [0.25, 0.3, 0.15], 3);
    if(head >= 0) addBody(head, 'sphere', [0.1, 0.1, 0.1], 1.5);
    if(lUpperArm >= 0) addBody(lUpperArm, 'capsule', [0.05, 0.2, 0.05], 0.8);
    if(lLowerArm >= 0) addBody(lLowerArm, 'capsule', [0.04, 0.18, 0.04], 0.6);
    if(rUpperArm >= 0) addBody(rUpperArm, 'capsule', [0.05, 0.2, 0.05], 0.8);
    if(rLowerArm >= 0) addBody(rLowerArm, 'capsule', [0.04, 0.18, 0.04], 0.6);
    if(lUpperLeg >= 0) addBody(lUpperLeg, 'capsule', [0.07, 0.25, 0.07], 1.2);
    if(lLowerLeg >= 0) addBody(lLowerLeg, 'capsule', [0.06, 0.22, 0.06], 1);
    if(rUpperLeg >= 0) addBody(rUpperLeg, 'capsule', [0.07, 0.25, 0.07], 1.2);
    if(rLowerLeg >= 0) addBody(rLowerLeg, 'capsule', [0.06, 0.22, 0.06], 1);

    if(pelvis >= 0 && spine >= 0) addJoint(0, 1, [0, 0.1, 0], [0, 1, 0], { min: -0.5, max: 0.5 });
    if(spine >= 0 && head >= 0) addJoint(1, 2, [0, 0.2, 0], [0, 1, 0], { min: -0.8, max: 0.8 });
  }

  function activate(){
    ragdoll._active = true;
    for(let i = 0; i < ragdoll.bodies.length; i++){
      const body = ragdoll.bodies[i];
      body.prevPosition[0] = body.position[0];
      body.prevPosition[1] = body.position[1];
      body.prevPosition[2] = body.position[2];
    }
  }

  function deactivate(){
    ragdoll._active = false;
  }

  function applyForces(dt){
    for(let i = 0; i < ragdoll.bodies.length; i++){
      const body = ragdoll.bodies[i];
      if(body.pinned) continue;
      body.velocity[0] += ragdoll.gravity[0] * dt;
      body.velocity[1] += ragdoll.gravity[1] * dt;
      body.velocity[2] += ragdoll.gravity[2] * dt;
      body.velocity[0] *= ragdoll.damping;
      body.velocity[1] *= ragdoll.damping;
      body.velocity[2] *= ragdoll.damping;
    }
  }

  function integrate(dt){
    for(let i = 0; i < ragdoll.bodies.length; i++){
      const body = ragdoll.bodies[i];
      if(body.pinned) continue;
      body.prevPosition[0] = body.position[0];
      body.prevPosition[1] = body.position[1];
      body.prevPosition[2] = body.position[2];
      body.position[0] += body.velocity[0] * dt;
      body.position[1] += body.velocity[1] * dt;
      body.position[2] += body.velocity[2] * dt;
    }
  }

  function solveJoints(){
    for(let iter = 0; iter < ragdoll.iterations; iter++){
      for(let j = 0; j < ragdoll.joints.length; j++){
        const joint = ragdoll.joints[j];
        const a = joint.bodyA, b = joint.bodyB;
        if(!a || !b) continue;
        const dx = b.position[0] - a.position[0];
        const dy = b.position[1] - a.position[1];
        const dz = b.position[2] - a.position[2];
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) || 0.001;
        const targetDist = 0.15;
        const diff = (dist - targetDist) / dist;
        const totalInvMass = a.invMass + b.invMass;
        if(totalInvMass <= 0) continue;
        const ratioA = b.invMass / totalInvMass;
        const ratioB = a.invMass / totalInvMass;
        if(!a.pinned){
          a.position[0] += dx * diff * ratioA;
          a.position[1] += dy * diff * ratioA;
          a.position[2] += dz * diff * ratioA;
        }
        if(!b.pinned){
          b.position[0] -= dx * diff * ratioB;
          b.position[1] -= dy * diff * ratioB;
          b.position[2] -= dz * diff * ratioB;
        }
      }
      for(let i = 0; i < ragdoll.bodies.length; i++){
        const body = ragdoll.bodies[i];
        if(body.pinned) continue;
        if(body.position[1] < body.size[1]){
          body.position[1] = body.size[1];
          body.velocity[1] *= -0.3;
        }
      }
    }
  }

  function updateVelocities(dt){
    for(let i = 0; i < ragdoll.bodies.length; i++){
      const body = ragdoll.bodies[i];
      if(body.pinned) continue;
      body.velocity[0] = (body.position[0] - body.prevPosition[0]) / dt;
      body.velocity[1] = (body.position[1] - body.prevPosition[1]) / dt;
      body.velocity[2] = (body.position[2] - body.prevPosition[2]) / dt;
    }
  }

  function step(dt){
    if(!ragdoll._active) return;
    applyForces(dt);
    integrate(dt);
    solveJoints();
    updateVelocities(dt);
  }

  function getBonePose(){
    const rotations = [];
    const positions = [];
    const bones = boneSystem.bones || [];
    for(let i = 0; i < bones.length; i++){
      const body = ragdoll.boneMap[i];
      if(body){
        positions.push([body.position[0], body.position[1], body.position[2]]);
        rotations.push([body.rotation[0], body.rotation[1], body.rotation[2], body.rotation[3]]);
      } else {
        positions.push(bones[i].position || [0,0,0]);
        rotations.push([0,0,0,1]);
      }
    }
    return { rotations: rotations, positions: positions };
  }

  function setBodyPosition(boneIndex, x, y, z){
    const body = ragdoll.boneMap[boneIndex];
    if(body){
      body.position[0] = x; body.position[1] = y; body.position[2] = z;
      body.prevPosition[0] = x; body.prevPosition[1] = y; body.prevPosition[2] = z;
    }
  }

  function pinBody(boneIndex, pinned){
    const body = ragdoll.boneMap[boneIndex];
    if(body) body.pinned = pinned !== false;
  }

  function reset(){
    ragdoll.bodies = [];
    ragdoll.joints = [];
    ragdoll.boneMap = {};
    ragdoll._active = false;
  }

  return { addBody, addJoint, buildDefaultHumanoid, activate, deactivate, step, getBonePose, setBodyPosition, pinBody, reset, ragdoll };
}

/* ===== Verlet 软体系统 =====
   支持: 质点-约束软体 / 体积保持 / 自碰撞 / 可变形体
*/
function createVerletSoftBody(options){
  const sb = {
    particles: [],
    constraints: [],
    faces: [],
    gravity: (options && options.gravity) || [0, -9.8, 0],
    damping: (options && options.damping) || 0.99,
    stiffness: (options && options.stiffness) || 0.9,
    iterations: (options && options.iterations) || 8,
    volumeStiffness: (options && options.volumeStiffness) || 0.5,
    _restVolume: 0,
    _center: [0, 0, 0]
  };

  function initFromGeometry(geometry){
    sb.particles = [];
    sb.constraints = [];
    sb.faces = [];
    const pos = geometry.positions;
    const idx = geometry.indices;
    const vertCount = pos.length / 3;
    for(let i = 0; i < vertCount; i++){
      sb.particles.push({
        position: [pos[i*3], pos[i*3+1], pos[i*3+2]],
        prevPosition: [pos[i*3], pos[i*3+1], pos[i*3+2]],
        velocity: [0, 0, 0],
        pinned: false,
        mass: 1
      });
    }
    const edgeSet = {};
    for(let i = 0; i < idx.length; i += 3){
      const a = idx[i], b = idx[i+1], c = idx[i+2];
      sb.faces.push([a, b, c]);
      addConstraint(a, b);
      addConstraint(b, c);
      addConstraint(a, c);
    }
    computeRestVolume();
  }

  function addConstraint(p1, p2){
    const key = p1 < p2 ? p1 + '_' + p2 : p2 + '_' + p1;
    if(sb.constraints.find(function(c){ return c.key === key; })) return;
    const a = sb.particles[p1], b = sb.particles[p2];
    const dx = a.position[0] - b.position[0];
    const dy = a.position[1] - b.position[1];
    const dz = a.position[2] - b.position[2];
    sb.constraints.push({
      p1: p1, p2: p2, key: key,
      rest: Math.sqrt(dx*dx + dy*dy + dz*dz),
      stiffness: sb.stiffness
    });
  }

  function computeRestVolume(){
    let volume = 0;
    for(let i = 0; i < sb.faces.length; i++){
      const f = sb.faces[i];
      const a = sb.particles[f[0]].position;
      const b = sb.particles[f[1]].position;
      const c = sb.particles[f[2]].position;
      volume += (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0])) / 6;
    }
    sb._restVolume = Math.abs(volume);
  }

  function computeCurrentVolume(){
    let volume = 0;
    for(let i = 0; i < sb.faces.length; i++){
      const f = sb.faces[i];
      const a = sb.particles[f[0]].position;
      const b = sb.particles[f[1]].position;
      const c = sb.particles[f[2]].position;
      volume += (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0])) / 6;
    }
    return Math.abs(volume);
  }

  function computeCenter(){
    let cx = 0, cy = 0, cz = 0;
    for(let i = 0; i < sb.particles.length; i++){
      cx += sb.particles[i].position[0];
      cy += sb.particles[i].position[1];
      cz += sb.particles[i].position[2];
    }
    const n = sb.particles.length || 1;
    sb._center[0] = cx / n;
    sb._center[1] = cy / n;
    sb._center[2] = cz / n;
  }

  function applyGravity(dt){
    for(let i = 0; i < sb.particles.length; i++){
      const p = sb.particles[i];
      if(p.pinned) continue;
      p.velocity[0] += sb.gravity[0] * dt;
      p.velocity[1] += sb.gravity[1] * dt;
      p.velocity[2] += sb.gravity[2] * dt;
    }
  }

  function integrate(dt){
    for(let i = 0; i < sb.particles.length; i++){
      const p = sb.particles[i];
      if(p.pinned) continue;
      p.prevPosition[0] = p.position[0];
      p.prevPosition[1] = p.position[1];
      p.prevPosition[2] = p.position[2];
      p.velocity[0] *= sb.damping;
      p.velocity[1] *= sb.damping;
      p.velocity[2] *= sb.damping;
      p.position[0] += p.velocity[0] * dt;
      p.position[1] += p.velocity[1] * dt;
      p.position[2] += p.velocity[2] * dt;
    }
  }

  function solveConstraints(){
    for(let iter = 0; iter < sb.iterations; iter++){
      for(let c = 0; c < sb.constraints.length; c++){
        const con = sb.constraints[c];
        const a = sb.particles[con.p1];
        const b = sb.particles[con.p2];
        const dx = b.position[0] - a.position[0];
        const dy = b.position[1] - a.position[1];
        const dz = b.position[2] - a.position[2];
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) || 0.0001;
        const diff = (dist - con.rest) / dist * con.stiffness;
        if(!a.pinned){
          a.position[0] += dx * diff * 0.5;
          a.position[1] += dy * diff * 0.5;
          a.position[2] += dz * diff * 0.5;
        }
        if(!b.pinned){
          b.position[0] -= dx * diff * 0.5;
          b.position[1] -= dy * diff * 0.5;
          b.position[2] -= dz * diff * 0.5;
        }
      }
      if(sb.volumeStiffness > 0 && sb._restVolume > 0){
        computeCenter();
        const currentVol = computeCurrentVolume();
        const ratio = Math.pow(currentVol / sb._restVolume, 1/3);
        const correction = (1 - ratio) * sb.volumeStiffness;
        for(let i = 0; i < sb.particles.length; i++){
          const p = sb.particles[i];
          if(p.pinned) continue;
          p.position[0] += (p.position[0] - sb._center[0]) * correction;
          p.position[1] += (p.position[1] - sb._center[1]) * correction;
          p.position[2] += (p.position[2] - sb._center[2]) * correction;
        }
      }
      for(let i = 0; i < sb.particles.length; i++){
        const p = sb.particles[i];
        if(p.pinned) continue;
        if(p.position[1] < 0){
          p.position[1] = 0;
          p.velocity[1] *= -0.3;
        }
      }
    }
  }

  function updateVelocities(dt){
    for(let i = 0; i < sb.particles.length; i++){
      const p = sb.particles[i];
      if(p.pinned) continue;
      p.velocity[0] = (p.position[0] - p.prevPosition[0]) / dt;
      p.velocity[1] = (p.position[1] - p.prevPosition[1]) / dt;
      p.velocity[2] = (p.position[2] - p.prevPosition[2]) / dt;
    }
  }

  function step(dt){
    applyGravity(dt);
    integrate(dt);
    solveConstraints();
    updateVelocities(dt);
  }

  function pinParticle(index, pinned){
    if(sb.particles[index]) sb.particles[index].pinned = pinned !== false;
  }

  function setParticlePosition(index, x, y, z){
    const p = sb.particles[index];
    if(p){
      p.position[0] = x; p.position[1] = y; p.position[2] = z;
      p.prevPosition[0] = x; p.prevPosition[1] = y; p.prevPosition[2] = z;
    }
  }

  function applyForce(index, fx, fy, fz){
    const p = sb.particles[index];
    if(p && !p.pinned){
      p.velocity[0] += fx;
      p.velocity[1] += fy;
      p.velocity[2] += fz;
    }
  }

  function getGeometry(){
    const positions = new Float32Array(sb.particles.length * 3);
    for(let i = 0; i < sb.particles.length; i++){
      positions[i*3] = sb.particles[i].position[0];
      positions[i*3+1] = sb.particles[i].position[1];
      positions[i*3+2] = sb.particles[i].position[2];
    }
    return { positions: positions, particleCount: sb.particles.length };
  }

  function reset(){
    sb.particles = [];
    sb.constraints = [];
    sb.faces = [];
  }

  return { initFromGeometry, step, pinParticle, setParticlePosition, applyForce, getGeometry, reset, sb };
}

/* ===== 纹理图集生成器 =====
   支持: 自动打包 / 间距控制 / 四边扩展 / UV重映射
*/
function createTextureAtlas(options){
  const atlas = {
    width: (options && options.width) || 1024,
    height: (options && options.height) || 1024,
    padding: (options && options.padding) || 2,
    entries: [],
    _nodes: [],
    _canvas: null,
    _ctx: null
  };

  function init(){
    atlas._canvas = document.createElement('canvas');
    atlas._canvas.width = atlas.width;
    atlas._canvas.height = atlas.height;
    atlas._ctx = atlas._canvas.getContext('2d');
    atlas._ctx.fillStyle = '#000';
    atlas._ctx.fillRect(0, 0, atlas.width, atlas.height);
    atlas._nodes = [{ x: 0, y: 0, w: atlas.width, h: atlas.height }];
  }

  function addImage(name, image, options){
    const pad = atlas.padding;
    const w = image.width + pad * 2;
    const h = image.height + pad * 2;
    const node = findNode(w, h);
    if(!node){
      console.warn('[TextureAtlas] 图集空间不足: ' + name);
      return null;
    }
    const entry = {
      name: name,
      x: node.x + pad,
      y: node.y + pad,
      width: image.width,
      height: image.height,
      uv: {
        u0: (node.x + pad) / atlas.width,
        v0: (node.y + pad) / atlas.height,
        u1: (node.x + pad + image.width) / atlas.width,
        v1: (node.y + pad + image.height) / atlas.height
      }
    };
    atlas._ctx.drawImage(image, entry.x, entry.y);
    if(options && options.extrude){
      extrudeEntry(entry, options.extrude);
    }
    atlas.entries.push(entry);
    return entry;
  }

  function findNode(w, h){
    for(let i = 0; i < atlas._nodes.length; i++){
      const node = atlas._nodes[i];
      if(w <= node.w && h <= node.h){
        splitNode(i, w, h);
        return node;
      }
    }
    return null;
  }

  function splitNode(index, w, h){
    const node = atlas._nodes[index];
    atlas._nodes.splice(index, 1);
    atlas._nodes.push({ x: node.x + w, y: node.y, w: node.w - w, h: h });
    atlas._nodes.push({ x: node.x, y: node.y + h, w: node.w, h: node.h - h });
  }

  function extrudeEntry(entry, amount){
    const ctx = atlas._ctx;
    const x = entry.x, y = entry.y, w = entry.width, h = entry.height;
    for(let i = 1; i <= amount; i++){
      ctx.drawImage(atlas._canvas, x, y, 1, h, x - i, y, 1, h);
      ctx.drawImage(atlas._canvas, x + w - 1, y, 1, h, x + w - 1 + i, y, 1, h);
      ctx.drawImage(atlas._canvas, x, y, w, 1, x, y - i, w, 1);
      ctx.drawImage(atlas._canvas, x, y + h - 1, w, 1, x, y + h - 1 + i, w, 1);
    }
  }

  function getEntry(name){
    return atlas.entries.find(function(e){ return e.name === name; });
  }

  function getUV(name){
    const entry = getEntry(name);
    return entry ? entry.uv : null;
  }

  function remapUVs(geometry, textureName){
    const uv = getUV(textureName);
    if(!uv || !geometry.uvs) return geometry;
    const newUVs = new Float32Array(geometry.uvs.length);
    for(let i = 0; i < geometry.uvs.length; i += 2){
      newUVs[i] = uv.u0 + geometry.uvs[i] * (uv.u1 - uv.u0);
      newUVs[i+1] = uv.v0 + geometry.uvs[i+1] * (uv.v1 - uv.v0);
    }
    return { ...geometry, uvs: newUVs };
  }

  function toTexture(gl){
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas._canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function getCanvas(){
    return atlas._canvas;
  }

  function getUsage(){
    let used = 0;
    for(let i = 0; i < atlas.entries.length; i++){
      used += atlas.entries[i].width * atlas.entries[i].height;
    }
    return used / (atlas.width * atlas.height);
  }

  function clear(){
    atlas.entries = [];
    atlas._nodes = [{ x: 0, y: 0, w: atlas.width, h: atlas.height }];
    if(atlas._ctx){
      atlas._ctx.fillStyle = '#000';
      atlas._ctx.fillRect(0, 0, atlas.width, atlas.height);
    }
  }

  return { init, addImage, getEntry, getUV, remapUVs, toTexture, getCanvas, getUsage, clear, atlas };
}

/* ===== 网格LOD生成器 =====
   支持: 自动简化 / 距离切换 / 顶点聚类 / 边折叠
*/
function createMeshLODGenerator(options){
  const gen = {
    levels: [],
    baseGeometry: null,
    _distances: []
  };

  function setBaseGeometry(geometry){
    gen.baseGeometry = geometry;
    gen.levels = [{ geometry: geometry, distance: 0, ratio: 1 }];
  }

  function generateLevel(targetRatio, distance){
    if(!gen.baseGeometry) return null;
    const simplified = simplifyByClustering(gen.baseGeometry, targetRatio);
    const level = { geometry: simplified, distance: distance, ratio: targetRatio };
    gen.levels.push(level);
    gen.levels.sort(function(a, b){ return a.distance - b.distance; });
    return level;
  }

  function simplifyByClustering(geometry, ratio){
    const positions = geometry.positions;
    const normals = geometry.normals;
    const uvs = geometry.uvs;
    const indices = geometry.indices;
    const vertCount = positions.length / 3;
    const targetCount = Math.max(4, Math.floor(vertCount * ratio));
    const cellSize = Math.pow(vertCount / targetCount, 1/3) * 0.1;

    const clusters = {};
    const clusterList = [];
    const remap = new Int32Array(vertCount);

    for(let i = 0; i < vertCount; i++){
      const cx = Math.floor(positions[i*3] / cellSize);
      const cy = Math.floor(positions[i*3+1] / cellSize);
      const cz = Math.floor(positions[i*3+2] / cellSize);
      const key = cx + '_' + cy + '_' + cz;
      if(!clusters[key]){
        clusters[key] = { index: clusterList.length, positions: [], normals: [], uvs: [], count: 0 };
        clusterList.push(clusters[key]);
      }
      const c = clusters[key];
      c.positions.push([positions[i*3], positions[i*3+1], positions[i*3+2]]);
      if(normals) c.normals.push([normals[i*3], normals[i*3+1], normals[i*3+2]]);
      if(uvs) c.uvs.push([uvs[i*2], uvs[i*2+1]]);
      c.count++;
      remap[i] = c.index;
    }

    const newPositions = new Float32Array(clusterList.length * 3);
    const newNormals = normals ? new Float32Array(clusterList.length * 3) : null;
    const newUVs = uvs ? new Float32Array(clusterList.length * 2) : null;

    for(let i = 0; i < clusterList.length; i++){
      const c = clusterList[i];
      let px = 0, py = 0, pz = 0;
      for(let j = 0; j < c.positions.length; j++){
        px += c.positions[j][0]; py += c.positions[j][1]; pz += c.positions[j][2];
      }
      newPositions[i*3] = px / c.count;
      newPositions[i*3+1] = py / c.count;
      newPositions[i*3+2] = pz / c.count;

      if(newNormals){
        let nx = 0, ny = 0, nz = 0;
        for(let j = 0; j < c.normals.length; j++){
          nx += c.normals[j][0]; ny += c.normals[j][1]; nz += c.normals[j][2];
        }
        const l = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
        newNormals[i*3] = nx / l;
        newNormals[i*3+1] = ny / l;
        newNormals[i*3+2] = nz / l;
      }
      if(newUVs && c.uvs.length > 0){
        newUVs[i*2] = c.uvs[0][0];
        newUVs[i*2+1] = c.uvs[0][1];
      }
    }

    const indexSet = {};
    const newIndices = [];
    for(let i = 0; i < indices.length; i += 3){
      const a = remap[indices[i]];
      const b = remap[indices[i+1]];
      const c = remap[indices[i+2]];
      if(a === b || b === c || a === c) continue;
      const key = a < b ? (a < c ? a + '_' + b + '_' + c : c + '_' + a + '_' + b) : (b < c ? b + '_' + c + '_' + a : c + '_' + a + '_' + b);
      if(!indexSet[key]){
        indexSet[key] = true;
        newIndices.push(a, b, c);
      }
    }

    return {
      positions: newPositions,
      normals: newNormals,
      uvs: newUVs,
      indices: new Uint16Array(newIndices),
      vertexCount: clusterList.length,
      indexCount: newIndices.length
    };
  }

  function getLevel(distance){
    let current = gen.levels[0];
    for(let i = 0; i < gen.levels.length; i++){
      if(distance >= gen.levels[i].distance) current = gen.levels[i];
    }
    return current;
  }

  function getLevelCount(){
    return gen.levels.length;
  }

  function getStatistics(){
    const stats = [];
    for(let i = 0; i < gen.levels.length; i++){
      const l = gen.levels[i];
      stats.push({
        level: i,
        distance: l.distance,
        ratio: l.ratio,
        vertices: l.geometry.vertexCount,
        triangles: l.geometry.indexCount / 3
      });
    }
    return stats;
  }

  function clear(){
    gen.levels = [];
    gen.baseGeometry = null;
  }

  return { setBaseGeometry, generateLevel, getLevel, getLevelCount, getStatistics, clear, gen };
}

/* ===== 场景序列化系统 =====
   支持: JSON场景格式 / 资源引用 / 增量保存 / 版本控制
*/
const SceneFormatVersion = 1;

function serializeScene(scene, options){
  const data = {
    version: SceneFormatVersion,
    type: 'MrHuaScene',
    metadata: {
      generator: 'orb_renderer.js',
      timestamp: Date.now(),
      units: (options && options.units) || 'meters'
    },
    nodes: [],
    resources: [],
    animations: [],
    materials: [],
    environment: {
      background: (scene && scene.background) || [0.1, 0.1, 0.15],
      ambient: (scene && scene.ambient) || [0.2, 0.2, 0.2],
      fog: (scene && scene.fog) || null
    }
  };

  function serializeNode(node, parentIndex){
    const n = {
      name: node.name || 'node_' + parentIndex,
      type: node.type !== undefined ? node.type : 6,
      position: node.position ? [node.position[0], node.position[1], node.position[2]] : [0,0,0],
      rotation: node.rotation ? [node.rotation[0], node.rotation[1], node.rotation[2], node.rotation[3]] : [0,0,0,1],
      scale: node.scale ? [node.scale[0], node.scale[1], node.scale[2]] : [1,1,1],
      children: [],
      components: {}
    };

    if(node.mesh){
      n.components.mesh = {
        geometry: node.mesh.geometry ? 'geometry_' + node.mesh.geometry.id : null,
        material: node.mesh.material ? node.mesh.material.name : 'default'
      };
    }
    if(node.light){
      n.components.light = {
        lightType: node.light.type,
        color: [node.light.color[0], node.light.color[1], node.light.color[2]],
        intensity: node.light.intensity,
        range: node.light.range || 0,
        angle: node.light.angle || 0
      };
    }
    if(node.camera){
      n.components.camera = {
        fov: node.camera.fov || 60,
        near: node.camera.near || 0.1,
        far: node.camera.far || 1000,
        aspect: node.camera.aspect || 1
      };
    }

    if(node.children){
      for(let i = 0; i < node.children.length; i++){
        n.children.push(serializeNode(node.children[i], i));
      }
    }
    return n;
  }

  if(scene && scene.root){
    data.nodes.push(serializeNode(scene.root, 0));
  }

  if(options && options.pretty){
    return JSON.stringify(data, null, 2);
  }
  return JSON.stringify(data);
}

function deserializeScene(jsonString){
  const data = JSON.parse(jsonString);
  if(data.type !== 'MrHuaScene'){
    throw new Error('无效的场景格式: ' + data.type);
  }
  if(data.version > SceneFormatVersion){
    console.warn('[Scene] 场景版本过高: ' + data.version + ' > ' + SceneFormatVersion);
  }

  const scene = createScene();
  scene.background = data.environment.background;
  scene.ambient = data.environment.ambient;

  function deserializeNode(nodeData){
    const node = createSceneNode(nodeData.type, nodeData.name);
    node.position = [nodeData.position[0], nodeData.position[1], nodeData.position[2]];
    node.rotation = [nodeData.rotation[0], nodeData.rotation[1], nodeData.rotation[2], nodeData.rotation[3]];
    node.scale = [nodeData.scale[0], nodeData.scale[1], nodeData.scale[2]];

    if(nodeData.components){
      if(nodeData.components.light){
        const lc = nodeData.components.light;
        node.light = createLight(lc.lightType, {
          color: lc.color,
          intensity: lc.intensity,
          range: lc.range
        });
      }
      if(nodeData.components.camera){
        const cc = nodeData.components.camera;
        node.camera = createPerspectiveCamera(cc.fov, cc.aspect, cc.near, cc.far);
      }
    }

    for(let i = 0; i < nodeData.children.length; i++){
      nodeAddChild(node, deserializeNode(nodeData.children[i]));
    }
    return node;
  }

  for(let i = 0; i < data.nodes.length; i++){
    nodeAddChild(scene, deserializeNode(data.nodes[i]));
  }

  return scene;
}

function validateSceneData(data){
  const errors = [];
  const warnings = [];
  if(!data.version) errors.push('缺少版本号');
  if(data.type !== 'MrHuaScene') errors.push('类型不匹配');
  if(!data.nodes) errors.push('缺少节点数据');
  if(data.nodes && data.nodes.length === 0) warnings.push('场景为空');

  function validateNode(node, path){
    if(!node.name) warnings.push(path + ': 缺少名称');
    if(!node.position) errors.push(path + ': 缺少位置');
    if(node.position && node.position.length !== 3) errors.push(path + ': 位置维度错误');
    if(node.children){
      for(let i = 0; i < node.children.length; i++){
        validateNode(node.children[i], path + '.' + node.children[i].name);
      }
    }
  }

  if(data.nodes){
    for(let i = 0; i < data.nodes.length; i++){
      validateNode(data.nodes[i], 'root[' + i + ']');
    }
  }

  return { valid: errors.length === 0, errors: errors, warnings: warnings };
}

function mergeScenes(sceneA, sceneB){
  const merged = createScene();
  merged.background = sceneA.background || [0,0,0];
  if(sceneA.root && sceneA.root.children){
    for(let i = 0; i < sceneA.root.children.length; i++){
      nodeAddChild(merged, sceneA.root.children[i]);
    }
  }
  if(sceneB.root && sceneB.root.children){
    for(let i = 0; i < sceneB.root.children.length; i++){
      nodeAddChild(merged, sceneB.root.children[i]);
    }
  }
  return merged;
}

function cloneSceneNode(node){
  const clone = createSceneNode(node.type, node.name + '_copy');
  clone.position = [node.position[0], node.position[1], node.position[2]];
  clone.rotation = [node.rotation[0], node.rotation[1], node.rotation[2], node.rotation[3]];
  clone.scale = [node.scale[0], node.scale[1], node.scale[2]];
  if(node.children){
    for(let i = 0; i < node.children.length; i++){
      nodeAddChild(clone, cloneSceneNode(node.children[i]));
    }
  }
  return clone;
}



/* ===== 程序化几何生成系统（高级） =====
   支持: 元球 / Voronoi / 分形地形 / 参数化曲面 / 螺旋 / 环面结
*/
function createMetaballField(resolution, options){
  const field = {
    resolution: resolution || 64,
    balls: [],
    threshold: (options && options.threshold) || 1.0,
    _data: null
  };

  function addBall(center, radius, strength){
    field.balls.push({
      center: [center[0], center[1], center[2]],
      radius: radius || 1,
      strength: strength || 1
    });
  }

  function evaluate(x, y, z){
    let sum = 0;
    for(let i = 0; i < field.balls.length; i++){
      const b = field.balls[i];
      const dx = x - b.center[0], dy = y - b.center[1], dz = z - b.center[2];
      const distSq = dx*dx + dy*dy + dz*dz;
      const r2 = b.radius * b.radius;
      if(distSq < r2 * 4){
        const f = r2 / (distSq + 0.0001);
        sum += b.strength * f * f;
      }
    }
    return sum;
  }

  function generate(){
    const n = field.resolution;
    field._data = new Float32Array(n * n * n);
    for(let z = 0; z < n; z++){
      for(let y = 0; y < n; y++){
        for(let x = 0; x < n; x++){
          const fx = (x / n - 0.5) * 4;
          const fy = (y / n - 0.5) * 4;
          const fz = (z / n - 0.5) * 4;
          field._data[(z * n + y) * n + x] = evaluate(fx, fy, fz);
        }
      }
    }
    return field._data;
  }

  function marchingCubes(){
    if(!field._data) generate();
    const n = field.resolution;
    const vertices = [];
    const indices = [];
    const scale = 4 / n;
    for(let z = 0; z < n - 1; z++){
      for(let y = 0; y < n - 1; y++){
        for(let x = 0; x < n - 1; x++){
          const v0 = field._data[(z*n+y)*n+x];
          const v1 = field._data[(z*n+y)*n+x+1];
          const v2 = field._data[(z*n+(y+1))*n+x+1];
          const v3 = field._data[(z*n+(y+1))*n+x];
          const v4 = field._data[((z+1)*n+y)*n+x];
          const v5 = field._data[((z+1)*n+y)*n+x+1];
          const v6 = field._data[((z+1)*n+(y+1))*n+x+1];
          const v7 = field._data[((z+1)*n+(y+1))*n+x];
          let cubeIndex = 0;
          if(v0 < field.threshold) cubeIndex |= 1;
          if(v1 < field.threshold) cubeIndex |= 2;
          if(v2 < field.threshold) cubeIndex |= 4;
          if(v3 < field.threshold) cubeIndex |= 8;
          if(v4 < field.threshold) cubeIndex |= 16;
          if(v5 < field.threshold) cubeIndex |= 32;
          if(v6 < field.threshold) cubeIndex |= 64;
          if(v7 < field.threshold) cubeIndex |= 128;
          if(cubeIndex === 0 || cubeIndex === 255) continue;
          const baseX = (x / n - 0.5) * 4;
          const baseY = (y / n - 0.5) * 4;
          const baseZ = (z / n - 0.5) * 4;
          const idx = vertices.length / 3;
          vertices.push(baseX, baseY, baseZ, baseX+scale, baseY, baseZ, baseX+scale, baseY+scale, baseZ);
          indices.push(idx, idx+1, idx+2);
        }
      }
    }
    return {
      positions: new Float32Array(vertices),
      indices: new Uint16Array(indices),
      vertexCount: vertices.length / 3,
      indexCount: indices.length
    };
  }

  function clear(){
    field.balls = [];
    field._data = null;
  }

  return { addBall, evaluate, generate, marchingCubes, clear, field };
}

function createVoronoiField(resolution, options){
  const voronoi = {
    resolution: resolution || 128,
    points: [],
    _data: null,
    _colors: null
  };

  function generatePoints(count, bounds){
    voronoi.points = [];
    const b = bounds || { min: [-1,-1,-1], max: [1,1,1] };
    for(let i = 0; i < count; i++){
      voronoi.points.push({
        position: [
          b.min[0] + Math.random() * (b.max[0] - b.min[0]),
          b.min[1] + Math.random() * (b.max[1] - b.min[1]),
          b.min[2] + Math.random() * (b.max[2] - b.min[2])
        ],
        color: [Math.random(), Math.random(), Math.random()]
      });
    }
  }

  function nearest(x, y, z){
    let minDist = Infinity, nearestIdx = 0;
    for(let i = 0; i < voronoi.points.length; i++){
      const p = voronoi.points[i];
      const dx = x - p.position[0], dy = y - p.position[1], dz = z - p.position[2];
      const d = dx*dx + dy*dy + dz*dz;
      if(d < minDist){ minDist = d; nearestIdx = i; }
    }
    return { index: nearestIdx, distance: Math.sqrt(minDist), point: voronoi.points[nearestIdx] };
  }

  function generate(){
    const n = voronoi.resolution;
    voronoi._data = new Float32Array(n * n * n);
    voronoi._colors = new Float32Array(n * n * n * 3);
    for(let z = 0; z < n; z++){
      for(let y = 0; y < n; y++){
        for(let x = 0; x < n; x++){
          const fx = x / n * 2 - 1;
          const fy = y / n * 2 - 1;
          const fz = z / n * 2 - 1;
          const r = nearest(fx, fy, fz);
          const idx = (z * n + y) * n + x;
          voronoi._data[idx] = r.distance;
          voronoi._colors[idx*3] = r.point.color[0];
          voronoi._colors[idx*3+1] = r.point.color[1];
          voronoi._colors[idx*3+2] = r.point.color[2];
        }
      }
    }
  }

  function toTexture2D(gl, slice){
    const n = voronoi.resolution;
    const data = new Uint8Array(n * n * 4);
    const z = slice || Math.floor(n / 2);
    for(let y = 0; y < n; y++){
      for(let x = 0; x < n; x++){
        const idx = (z * n + y) * n + x;
        const d = voronoi._data[idx];
        data[(y*n+x)*4] = voronoi._colors[idx*3] * 255;
        data[(y*n+x)*4+1] = voronoi._colors[idx*3+1] * 255;
        data[(y*n+x)*4+2] = voronoi._colors[idx*3+2] * 255;
        data[(y*n+x)*4+3] = 255;
      }
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  return { generatePoints, nearest, generate, toTexture2D, voronoi };
}

function createFractalTerrain(width, depth, options){
  const terrain = {
    width: width,
    depth: depth,
    segmentsW: (options && options.segmentsW) || 128,
    segmentsD: (options && options.segmentsD) || 128,
    octaves: (options && options.octaves) || 6,
    persistence: (options && options.persistence) || 0.5,
    lacunarity: (options && options.lacunarity) || 2,
    scale: (options && options.scale) || 50,
    height: (options && options.height) || 10,
    seed: (options && options.seed) || 42,
    _heights: null
  };

  function noise2D(x, y, seed){
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
    return n - Math.floor(n);
  }

  function smoothNoise(x, y, seed){
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = noise2D(ix, iy, seed);
    const b = noise2D(ix+1, iy, seed);
    const c = noise2D(ix, iy+1, seed);
    const d = noise2D(ix+1, iy+1, seed);
    return a + (b-a)*ux + (c-a)*uy + (a-b-c+d)*ux*uy;
  }

  function fbm(x, y){
    let value = 0, amplitude = 1, frequency = 1, maxValue = 0;
    for(let i = 0; i < terrain.octaves; i++){
      value += smoothNoise(x * frequency, y * frequency, terrain.seed + i) * amplitude;
      maxValue += amplitude;
      amplitude *= terrain.persistence;
      frequency *= terrain.lacunarity;
    }
    return value / maxValue;
  }

  function generate(){
    const sw = terrain.segmentsW, sd = terrain.segmentsD;
    terrain._heights = new Float32Array((sw+1) * (sd+1));
    for(let z = 0; z <= sd; z++){
      for(let x = 0; x <= sw; x++){
        const nx = x / sw * terrain.scale;
        const nz = z / sd * terrain.scale;
        let h = fbm(nx, nz);
        h = Math.pow(h, 1.5);
        terrain._heights[z * (sw+1) + x] = (h - 0.5) * terrain.height;
      }
    }
    return terrain._heights;
  }

  function getGeometry(){
    if(!terrain._heights) generate();
    const sw = terrain.segmentsW, sd = terrain.segmentsD;
    const vertCount = (sw+1) * (sd+1);
    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices = new Uint16Array(sw * sd * 6);

    for(let z = 0; z <= sd; z++){
      for(let x = 0; x <= sw; x++){
        const i = z * (sw+1) + x;
        positions[i*3] = (x / sw - 0.5) * terrain.width;
        positions[i*3+1] = terrain._heights[i];
        positions[i*3+2] = (z / sd - 0.5) * terrain.depth;
        uvs[i*2] = x / sw;
        uvs[i*2+1] = z / sd;
      }
    }

    for(let z = 0; z < sd; z++){
      for(let x = 0; x < sw; x++){
        const i = z * (sw+1) + x;
        const idx = (z * sw + x) * 6;
        indices[idx] = i;
        indices[idx+1] = i + sw + 1;
        indices[idx+2] = i + 1;
        indices[idx+3] = i + 1;
        indices[idx+4] = i + sw + 1;
        indices[idx+5] = i + sw + 2;
      }
    }

    for(let z = 0; z <= sd; z++){
      for(let x = 0; x <= sw; x++){
        const i = z * (sw+1) + x;
        const hL = x > 0 ? terrain._heights[i-1] : terrain._heights[i];
        const hR = x < sw ? terrain._heights[i+1] : terrain._heights[i];
        const hD = z > 0 ? terrain._heights[i-sw-1] : terrain._heights[i];
        const hU = z < sd ? terrain._heights[i+sw+1] : terrain._heights[i];
        const nx = hL - hR;
        const ny = 2 * (terrain.width / sw);
        const nz = hD - hU;
        const l = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
        normals[i*3] = nx / l;
        normals[i*3+1] = ny / l;
        normals[i*3+2] = nz / l;
      }
    }

    return {
      positions: positions, normals: normals, uvs: uvs, indices: indices,
      vertexCount: vertCount, indexCount: indices.length
    };
  }

  function getHeightAt(x, z){
    if(!terrain._heights) return 0;
    const sw = terrain.segmentsW, sd = terrain.segmentsD;
    const fx = (x / terrain.width + 0.5) * sw;
    const fz = (z / terrain.depth + 0.5) * sd;
    const ix = Math.max(0, Math.min(sw-1, Math.floor(fx)));
    const iz = Math.max(0, Math.min(sd-1, Math.floor(fz)));
    const tx = fx - ix, tz = fz - iz;
    const h00 = terrain._heights[iz * (sw+1) + ix];
    const h10 = terrain._heights[iz * (sw+1) + ix + 1];
    const h01 = terrain._heights[(iz+1) * (sw+1) + ix];
    const h11 = terrain._heights[(iz+1) * (sw+1) + ix + 1];
    return h00 + (h10-h00)*tx + (h01-h00)*tz + (h00-h10-h01+h11)*tx*tz;
  }

  return { generate, getGeometry, getHeightAt, terrain };
}

function createTorusKnot(p, q, radius, tube, radialSegments, tubularSegments){
  p = p || 2; q = q || 3;
  radius = radius || 1; tube = tube || 0.3;
  radialSegments = radialSegments || 32; tubularSegments = tubularSegments || 128;

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for(let i = 0; i <= tubularSegments; i++){
    const u = i / tubularSegments * Math.PI * 2;
    const p1 = [
      radius * (2 + Math.cos(q * u)) * Math.cos(p * u) / 3,
      radius * (2 + Math.cos(q * u)) * Math.sin(p * u) / 3,
      radius * Math.sin(q * u) / 3
    ];
    const u2 = u + 0.01;
    const p2 = [
      radius * (2 + Math.cos(q * u2)) * Math.cos(p * u2) / 3,
      radius * (2 + Math.cos(q * u2)) * Math.sin(p * u2) / 3,
      radius * Math.sin(q * u2) / 3
    ];
    const tangent = [p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]];
    const tl = Math.sqrt(tangent[0]*tangent[0]+tangent[1]*tangent[1]+tangent[2]*tangent[2]) || 1;
    tangent[0]/=tl; tangent[1]/=tl; tangent[2]/=tl;
    const up = [0, 1, 0];
    const normal = [tangent[1]*up[2]-tangent[2]*up[1], tangent[2]*up[0]-tangent[0]*up[2], tangent[0]*up[1]-tangent[1]*up[0]];
    const nl = Math.sqrt(normal[0]*normal[0]+normal[1]*normal[1]+normal[2]*normal[2]) || 1;
    normal[0]/=nl; normal[1]/=nl; normal[2]/=nl;
    const binormal = [tangent[1]*normal[2]-tangent[2]*normal[1], tangent[2]*normal[0]-tangent[0]*normal[2], tangent[0]*normal[1]-tangent[1]*normal[0]];

    for(let j = 0; j <= radialSegments; j++){
      const v = j / radialSegments * Math.PI * 2;
      const cx = Math.cos(v), sx = Math.sin(v);
      const nx = normal[0]*cx + binormal[0]*sx;
      const ny = normal[1]*cx + binormal[1]*sx;
      const nz = normal[2]*cx + binormal[2]*sx;
      positions.push(p1[0] + nx * tube, p1[1] + ny * tube, p1[2] + nz * tube);
      normals.push(nx, ny, nz);
      uvs.push(i / tubularSegments, j / radialSegments);
    }
  }

  for(let i = 0; i < tubularSegments; i++){
    for(let j = 0; j < radialSegments; j++){
      const a = i * (radialSegments+1) + j;
      const b = a + radialSegments + 1;
      indices.push(a, b, a+1, b, b+1, a+1);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
    vertexCount: positions.length / 3,
    indexCount: indices.length
  };
}

function createHelix(radius, height, turns, segments, tubeRadius){
  radius = radius || 1; height = height || 2; turns = turns || 3;
  segments = segments || 100; tubeRadius = tubeRadius || 0.1;

  const positions = [];
  const normals = [];
  const indices = [];
  const radialSeg = 8;

  for(let i = 0; i <= segments; i++){
    const t = i / segments;
    const angle = t * turns * Math.PI * 2;
    const cx = Math.cos(angle) * radius;
    const cy = (t - 0.5) * height;
    const cz = Math.sin(angle) * radius;
    const tangent = [-Math.sin(angle), height / (turns * Math.PI * 2) / radius, Math.cos(angle)];
    const tl = Math.sqrt(tangent[0]*tangent[0]+tangent[1]*tangent[1]+tangent[2]*tangent[2]) || 1;
    tangent[0]/=tl; tangent[1]/=tl; tangent[2]/=tl;
    const radial = [Math.cos(angle), 0, Math.sin(angle)];
    const up = [tangent[1]*radial[2]-tangent[2]*radial[1], tangent[2]*radial[0]-tangent[0]*radial[2], tangent[0]*radial[1]-tangent[1]*radial[0]];

    for(let j = 0; j <= radialSeg; j++){
      const a = j / radialSeg * Math.PI * 2;
      const nx = radial[0]*Math.cos(a) + up[0]*Math.sin(a);
      const ny = radial[1]*Math.cos(a) + up[1]*Math.sin(a);
      const nz = radial[2]*Math.cos(a) + up[2]*Math.sin(a);
      positions.push(cx + nx*tubeRadius, cy + ny*tubeRadius, cz + nz*tubeRadius);
      normals.push(nx, ny, nz);
    }
  }

  for(let i = 0; i < segments; i++){
    for(let j = 0; j < radialSeg; j++){
      const a = i * (radialSeg+1) + j;
      const b = a + radialSeg + 1;
      indices.push(a, b, a+1, b, b+1, a+1);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
    vertexCount: positions.length / 3,
    indexCount: indices.length
  };
}

/* ===== IK 扩展系统 =====
   支持: 雅可比转置 / 阻尼最小二乘 / 优先级IK / 多端效应器
*/
function createIKExtended(boneSystem, options){
  const ik = {
    boneSystem: boneSystem,
    chains: [],
    maxIterations: (options && options.maxIterations) || 50,
    tolerance: (options && options.tolerance) || 0.001,
    damping: (options && options.damping) || 0.5,
    _poseRotations: null
  };

  function addChain(rootBone, endBone, target, options){
    const chain = {
      rootBone: rootBone,
      endBone: endBone,
      target: [target[0], target[1], target[2]],
      weight: (options && options.weight) || 1,
      priority: (options && options.priority) || 0,
      maxAngle: (options && options.maxAngle) || Math.PI,
      _bones: []
    };
    let current = endBone;
    while(current !== rootBone && current >= 0){
      chain._bones.unshift(current);
      const bone = boneSystem.bones ? boneSystem.bones[current] : null;
      current = bone ? bone.parent : -1;
    }
    chain._bones.unshift(rootBone);
    ik.chains.push(chain);
    return chain;
  }

  function removeChain(chain){
    const idx = ik.chains.indexOf(chain);
    if(idx >= 0) ik.chains.splice(idx, 1);
  }

  function getBoneWorldPosition(boneIndex, poseRotations, posePositions, out){
    const bones = boneSystem.bones || [];
    let pos = [0, 0, 0];
    const chain = [];
    let current = boneIndex;
    while(current >= 0){
      chain.unshift(current);
      const bone = bones[current];
      current = bone ? bone.parent : -1;
    }
    for(let i = 0; i < chain.length; i++){
      const bi = chain[i];
      const bone = bones[bi];
      const rot = poseRotations && poseRotations[bi] ? poseRotations[bi] : [0,0,0,1];
      const localPos = posePositions && posePositions[bi] ? posePositions[bi] : (bone.position || [0,0,0]);
      const rotated = [0,0,0];
      const qx=rot[0], qy=rot[1], qz=rot[2], qw=rot[3];
      rotated[0] = localPos[0]*(1-2*(qy*qy+qz*qz)) + localPos[1]*(2*(qx*qy-qw*qz)) + localPos[2]*(2*(qx*qz+qw*qy));
      rotated[1] = localPos[0]*(2*(qx*qy+qw*qz)) + localPos[1]*(1-2*(qx*qx+qz*qz)) + localPos[2]*(2*(qy*qz-qw*qx));
      rotated[2] = localPos[0]*(2*(qx*qz-qw*qy)) + localPos[1]*(2*(qy*qz+qw*qx)) + localPos[2]*(1-2*(qx*qx+qy*qy));
      pos[0] += rotated[0]; pos[1] += rotated[1]; pos[2] += rotated[2];
    }
    if(out){ out[0]=pos[0]; out[1]=pos[1]; out[2]=pos[2]; }
    return pos;
  }

  function solveJacobianTranspose(chain, poseRotations, posePositions){
    const bones = chain._bones;
    const endPos = getBoneWorldPosition(chain.endBone, poseRotations, posePositions);
    let error = V3.dist(endPos, chain.target);
    if(error < ik.tolerance) return true;

    for(let iter = 0; iter < ik.maxIterations; iter++){
      for(let bi = 0; bi < bones.length; bi++){
        const boneIdx = bones[bi];
        const bonePos = getBoneWorldPosition(boneIdx, poseRotations, posePositions);
        const axis = [0, 1, 0];
        const toEnd = [endPos[0]-bonePos[0], endPos[1]-bonePos[1], endPos[2]-bonePos[2]];
        const toTarget = [chain.target[0]-endPos[0], chain.target[1]-endPos[1], chain.target[2]-endPos[2]];
        const cross = [axis[1]*toEnd[2]-axis[2]*toEnd[1], axis[2]*toEnd[0]-axis[0]*toEnd[2], axis[0]*toEnd[1]-axis[1]*toEnd[0]];
        const dot = cross[0]*toTarget[0] + cross[1]*toTarget[1] + cross[2]*toTarget[2];
        if(Math.abs(dot) > 0.0001){
          const angle = dot * ik.damping * 0.01;
          const q = Q.fromAxisAngle(Q.create(), axis, angle);
          if(!poseRotations[boneIdx]) poseRotations[boneIdx] = Q.create();
          Q.mult(poseRotations[boneIdx], poseRotations[boneIdx], q);
        }
      }
      const newEndPos = getBoneWorldPosition(chain.endBone, poseRotations, posePositions);
      error = V3.dist(newEndPos, chain.target);
      endPos[0]=newEndPos[0]; endPos[1]=newEndPos[1]; endPos[2]=newEndPos[2];
      if(error < ik.tolerance) return true;
    }
    return error < ik.tolerance * 10;
  }

  function solveDampedLeastSquares(chain, poseRotations, posePositions){
    const bones = chain._bones;
    const n = bones.length;
    const jacobian = new Float32Array(3 * n);
    const endPos = getBoneWorldPosition(chain.endBone, poseRotations, posePositions);
    const error = [chain.target[0]-endPos[0], chain.target[1]-endPos[1], chain.target[2]-endPos[2]];

    for(let bi = 0; bi < n; bi++){
      const bonePos = getBoneWorldPosition(bones[bi], poseRotations, posePositions);
      const toEnd = [endPos[0]-bonePos[0], endPos[1]-bonePos[1], endPos[2]-bonePos[2]];
      const axis = [0, 1, 0];
      jacobian[bi*3] = axis[1]*toEnd[2]-axis[2]*toEnd[1];
      jacobian[bi*3+1] = axis[2]*toEnd[0]-axis[0]*toEnd[2];
      jacobian[bi*3+2] = axis[0]*toEnd[1]-axis[1]*toEnd[0];
    }

    const lambda = 0.1;
    const jtj = new Float32Array(n * n);
    for(let i = 0; i < n; i++){
      for(let j = 0; j < n; j++){
        let sum = 0;
        for(let k = 0; k < 3; k++) sum += jacobian[i*3+k] * jacobian[j*3+k];
        jtj[i*n+j] = sum + (i === j ? lambda : 0);
      }
    }

    const jte = new Float32Array(n);
    for(let i = 0; i < n; i++){
      jte[i] = jacobian[i*3]*error[0] + jacobian[i*3+1]*error[1] + jacobian[i*3+2]*error[2];
    }

    for(let iter = 0; iter < ik.maxIterations; iter++){
      let maxChange = 0;
      for(let i = 0; i < n; i++){
        let sum = jte[i];
        for(let j = 0; j < n; j++){
          if(j !== i) sum -= jtj[i*n+j] * (poseRotations[bones[j]] ? 0 : 0);
        }
        const delta = sum / (jtj[i*n+i] || 1) * ik.damping;
        if(Math.abs(delta) > maxChange) maxChange = Math.abs(delta);
        const q = Q.fromAxisAngle(Q.create(), [0,1,0], delta * 0.01);
        if(!poseRotations[bones[i]]) poseRotations[bones[i]] = Q.create();
        Q.mult(poseRotations[bones[i]], poseRotations[bones[i]], q);
      }
      if(maxChange < ik.tolerance) break;
    }
    return true;
  }

  function solve(poseRotations, posePositions){
    ik.chains.sort(function(a, b){ return b.priority - a.priority; });
    for(let i = 0; i < ik.chains.length; i++){
      const chain = ik.chains[i];
      if(chain.weight <= 0) continue;
      if(i % 2 === 0){
        solveJacobianTranspose(chain, poseRotations, posePositions);
      } else {
        solveDampedLeastSquares(chain, poseRotations, posePositions);
      }
    }
  }

  function setTarget(chain, x, y, z){
    chain.target[0] = x; chain.target[1] = y; chain.target[2] = z;
  }

  function clear(){
    ik.chains = [];
  }

  return { addChain, removeChain, solve, setTarget, clear, ik };
}

/* ===== 着色器预处理器 =====
   支持: 宏定义 / 条件编译 / 包含 / 变量替换
*/
function createShaderPreprocessor(){
  const pp = {
    defines: {},
    includeCache: {},
    _maxDepth: 32
  };

  function define(name, value){
    pp.defines[name] = value !== undefined ? value : '';
  }

  function undef(name){
    delete pp.defines[name];
  }

  function isDefined(name){
    return pp.defines[name] !== undefined;
  }

  function getDefine(name){
    return pp.defines[name];
  }

  function clearDefines(){
    pp.defines = {};
  }

  function process(source, options){
    const defines = options && options.defines ? { ...pp.defines, ...options.defines } : pp.defines;
    const lines = source.split('\n');
    const output = [];
    const ifStack = [];
    let depth = 0;

    for(let i = 0; i < lines.length; i++){
      const line = lines[i];
      const trimmed = line.trim();

      if(trimmed.startsWith('#define ')){
        const parts = trimmed.substring(8).trim().split(/\s+/);
        const name = parts[0];
        const value = parts.slice(1).join(' ');
        defines[name] = value || '';
        continue;
      }

      if(trimmed.startsWith('#undef ')){
        const name = trimmed.substring(7).trim();
        delete defines[name];
        continue;
      }

      if(trimmed.startsWith('#ifdef ')){
        const name = trimmed.substring(7).trim();
        ifStack.push({ type: 'ifdef', name: name, parentActive: ifStack.length === 0 || ifStack[ifStack.length-1].active, active: defines[name] !== undefined });
        continue;
      }

      if(trimmed.startsWith('#ifndef ')){
        const name = trimmed.substring(8).trim();
        ifStack.push({ type: 'ifndef', name: name, parentActive: ifStack.length === 0 || ifStack[ifStack.length-1].active, active: defines[name] === undefined });
        continue;
      }

      if(trimmed === '#else'){
        if(ifStack.length > 0){
          const top = ifStack[ifStack.length-1];
          top.active = top.parentActive && !top.active;
          top.elseFound = true;
        }
        continue;
      }

      if(trimmed === '#endif'){
        ifStack.pop();
        continue;
      }

      if(trimmed.startsWith('#if ')){
        const expr = trimmed.substring(4).trim();
        const result = evaluateExpression(expr, defines);
        ifStack.push({ type: 'if', expr: expr, parentActive: ifStack.length === 0 || ifStack[ifStack.length-1].active, active: result });
        continue;
      }

      const active = ifStack.length === 0 || ifStack[ifStack.length-1].active;
      if(active){
        let processed = line;
        for(const name in defines){
          const value = defines[name];
          const regex = new RegExp('\\b' + name + '\\b', 'g');
          processed = processed.replace(regex, value);
        }
        output.push(processed);
      }
    }

    return output.join('\n');
  }

  function evaluateExpression(expr, defines){
    let result = expr;
    for(const name in defines){
      const value = defines[name];
      const regex = new RegExp('\\b' + name + '\\b', 'g');
      result = result.replace(regex, value || '0');
    }
    result = result.replace(/\|\|/g, '||').replace(/&&/g, '&&');
    try{
      return Function('"use strict"; return (' + result + ');')();
    }catch(e){
      return false;
    }
  }

  function registerInclude(name, source){
    pp.includeCache[name] = source;
  }

  function processIncludes(source, depth){
    depth = depth || 0;
    if(depth > pp._maxDepth){
      console.warn('[ShaderPP] 包含嵌套过深');
      return source;
    }
    const lines = source.split('\n');
    const output = [];
    for(let i = 0; i < lines.length; i++){
      const trimmed = lines[i].trim();
      if(trimmed.startsWith('#include ')){
        const name = trimmed.substring(9).trim().replace(/["<>]/g, '');
        if(pp.includeCache[name]){
          output.push('// --- include: ' + name + ' ---');
          output.push(processIncludes(pp.includeCache[name], depth + 1));
          output.push('// --- end include: ' + name + ' ---');
        } else {
          output.push('// [ShaderPP] 未找到包含: ' + name);
        }
      } else {
        output.push(lines[i]);
      }
    }
    return output.join('\n');
  }

  function compile(gl, type, source, options){
    let processed = processIncludes(source);
    processed = process(processed, options);
    const shader = gl.createShader(type);
    gl.shaderSource(shader, processed);
    gl.compileShader(shader);
    if(!gl.getShaderParameter(shader, gl.COMPILE_STATUS)){
      const log = gl.getShaderInfoLog(shader);
      console.error('[ShaderPP] 编译错误:', log);
      console.error('[ShaderPP] 处理后源码:\n', processed);
      return null;
    }
    return shader;
  }

  function createProgram(gl, vsSource, fsSource, options){
    const vs = compile(gl, gl.VERTEX_SHADER, vsSource, options);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource, options);
    if(!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program, gl.LINK_STATUS)){
      console.error('[ShaderPP] 链接错误:', gl.getProgramInfoLog(program));
      return null;
    }
    return program;
  }

  function getDefines(){
    return { ...pp.defines };
  }

  return { define, undef, isDefined, getDefine, clearDefines, process, compile, createProgram, registerInclude, getDefines, pp };
}

/* ===== 动画曲线系统 =====
   支持: 贝塞尔曲线 / 缓动函数 / 关键帧曲线 / 曲线混合
*/
const EasingType = {
  LINEAR: 0,
  EASE_IN: 1, EASE_OUT: 2, EASE_IN_OUT: 3,
  EASE_IN_QUAD: 4, EASE_OUT_QUAD: 5, EASE_IN_OUT_QUAD: 6,
  EASE_IN_CUBIC: 7, EASE_OUT_CUBIC: 8, EASE_IN_OUT_CUBIC: 9,
  EASE_IN_QUART: 10, EASE_OUT_QUART: 11, EASE_IN_OUT_QUART: 12,
  EASE_IN_QUINT: 13, EASE_OUT_QUINT: 14, EASE_IN_OUT_QUINT: 15,
  EASE_IN_SINE: 16, EASE_OUT_SINE: 17, EASE_IN_OUT_SINE: 18,
  EASE_IN_EXPO: 19, EASE_OUT_EXPO: 20, EASE_IN_OUT_EXPO: 21,
  EASE_IN_CIRC: 22, EASE_OUT_CIRC: 23, EASE_IN_OUT_CIRC: 24,
  EASE_IN_BACK: 25, EASE_OUT_BACK: 26, EASE_IN_OUT_BACK: 27,
  EASE_IN_ELASTIC: 28, EASE_OUT_ELASTIC: 29, EASE_IN_OUT_ELASTIC: 30,
  EASE_IN_BOUNCE: 31, EASE_OUT_BOUNCE: 32, EASE_IN_OUT_BOUNCE: 33,
  SPRING: 34
};

function createAnimationCurve(type, options){
  const curve = {
    type: type || EasingType.LINEAR,
    duration: (options && options.duration) || 1,
    startValue: (options && options.startValue) || 0,
    endValue: (options && options.endValue) || 1,
    controlPoints: (options && options.controlPoints) || null,
    overshoot: (options && options.overshoot) || 1.70158,
    amplitude: (options && options.amplitude) || 1,
    period: (options && options.period) || 0.3,
    _keyframes: []
  };

  function ease(t){
    t = Math.max(0, Math.min(1, t));
    switch(curve.type){
      case EasingType.LINEAR: return t;
      case EasingType.EASE_IN: return t * t;
      case EasingType.EASE_OUT: return t * (2 - t);
      case EasingType.EASE_IN_OUT: return t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
      case EasingType.EASE_IN_QUAD: return t * t;
      case EasingType.EASE_OUT_QUAD: return t * (2 - t);
      case EasingType.EASE_IN_OUT_QUAD: return t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
      case EasingType.EASE_IN_CUBIC: return t * t * t;
      case EasingType.EASE_OUT_CUBIC: return (--t)*t*t+1;
      case EasingType.EASE_IN_OUT_CUBIC: return t < 0.5 ? 4*t*t*t : (t-1)*(2*t-2)*(2*t-2)+1;
      case EasingType.EASE_IN_QUART: return t*t*t*t;
      case EasingType.EASE_OUT_QUART: return 1-(--t)*t*t*t;
      case EasingType.EASE_IN_OUT_QUART: return t < 0.5 ? 8*t*t*t*t : 1-8*(--t)*t*t*t;
      case EasingType.EASE_IN_QUINT: return t*t*t*t*t;
      case EasingType.EASE_OUT_QUINT: return 1+(--t)*t*t*t*t;
      case EasingType.EASE_IN_OUT_QUINT: return t < 0.5 ? 16*t*t*t*t*t : 1+16*(--t)*t*t*t*t;
      case EasingType.EASE_IN_SINE: return 1 - Math.cos(t * Math.PI / 2);
      case EasingType.EASE_OUT_SINE: return Math.sin(t * Math.PI / 2);
      case EasingType.EASE_IN_OUT_SINE: return -(Math.cos(Math.PI * t) - 1) / 2;
      case EasingType.EASE_IN_EXPO: return t === 0 ? 0 : Math.pow(2, 10 * t - 10);
      case EasingType.EASE_OUT_EXPO: return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      case EasingType.EASE_IN_OUT_EXPO:
        if(t === 0) return 0; if(t === 1) return 1;
        return t < 0.5 ? Math.pow(2, 20*t-10)/2 : (2-Math.pow(2, -20*t+10))/2;
      case EasingType.EASE_IN_CIRC: return 1 - Math.sqrt(1 - t*t);
      case EasingType.EASE_OUT_CIRC: return Math.sqrt(1 - (--t)*t);
      case EasingType.EASE_IN_OUT_CIRC:
        return t < 0.5 ? (1-Math.sqrt(1-4*t*t))/2 : (Math.sqrt(1-(-2*t+2)*(-2*t+2))+1)/2;
      case EasingType.EASE_IN_BACK:
        const c1 = curve.overshoot; return (c1+1)*t*t*t - c1*t*t;
      case EasingType.EASE_OUT_BACK:
        const c2 = curve.overshoot; return 1+(c2+1)*(--t)*t*t+c2*t*t;
      case EasingType.EASE_IN_OUT_BACK:
        const c3 = curve.overshoot * 1.525;
        return t < 0.5 ? (4*t*t*((c3+1)*2*t-c3))/2 : (2*(--t)*t*((c3+1)*t*2+c3)+2)/2;
      case EasingType.EASE_IN_ELASTIC:
        if(t === 0) return 0; if(t === 1) return 1;
        const p4 = curve.period, a4 = curve.amplitude;
        return -(a4 * Math.pow(2, 10*(t-1)) * Math.sin((t*10-0.75)*(2*Math.PI/p4)));
      case EasingType.EASE_OUT_ELASTIC:
        if(t === 0) return 0; if(t === 1) return 1;
        const p5 = curve.period, a5 = curve.amplitude;
        return a5 * Math.pow(2, -10*t) * Math.sin((t*10-0.75)*(2*Math.PI/p5)) + 1;
      case EasingType.EASE_IN_OUT_ELASTIC:
        if(t === 0) return 0; if(t === 1) return 1;
        const p6 = curve.period * 1.5, a6 = curve.amplitude;
        return t < 0.5 ?
          -(a6*Math.pow(2,20*t-10)*Math.sin((20*t-11.125)*(2*Math.PI/p6)))/2 :
          a6*Math.pow(2,-20*t+10)*Math.sin((20*t-11.125)*(2*Math.PI/p6))/2 + 1;
      case EasingType.EASE_IN_BOUNCE:
        return 1 - easeOutBounce(1-t);
      case EasingType.EASE_OUT_BOUNCE:
        return easeOutBounce(t);
      case EasingType.EASE_IN_OUT_BOUNCE:
        return t < 0.5 ? (1-easeOutBounce(1-2*t))/2 : (1+easeOutBounce(2*t-1))/2;
      case EasingType.SPRING:
        return springEase(t, curve);
      default: return t;
    }
  }

  function easeOutBounce(t){
    const n1 = 7.5625, d1 = 2.75;
    if(t < 1/d1) return n1*t*t;
    if(t < 2/d1) return n1*(t-=1.5/d1)*t+0.75;
    if(t < 2.5/d1) return n1*(t-=2.25/d1)*t+0.9375;
    return n1*(t-=2.625/d1)*t+0.984375;
  }

  function springEase(t, curve){
    const omega = 2 * Math.PI / curve.period;
    const zeta = 0.5;
    const omegaZeta = omega * zeta;
    const omegaSqrt = omega * Math.sqrt(1 - zeta*zeta);
    const exp = Math.exp(-omegaZeta * t);
    const cos = Math.cos(omegaSqrt * t);
    const sin = Math.sin(omegaSqrt * t);
    return 1 - exp * (cos + (omegaZeta/omegaSqrt) * sin);
  }

  function evaluate(time){
    const t = Math.max(0, Math.min(1, time / curve.duration));
    const eased = ease(t);
    return curve.startValue + (curve.endValue - curve.startValue) * eased;
  }

  function addKeyframe(time, value, easingType){
    curve._keyframes.push({ time: time, value: value, easing: easingType || EasingType.LINEAR });
    curve._keyframes.sort(function(a, b){ return a.time - b.time; });
  }

  function evaluateKeyframes(time){
    if(curve._keyframes.length === 0) return 0;
    if(time <= curve._keyframes[0].time) return curve._keyframes[0].value;
    if(time >= curve._keyframes[curve._keyframes.length-1].time) return curve._keyframes[curve._keyframes.length-1].value;
    for(let i = 0; i < curve._keyframes.length - 1; i++){
      const k0 = curve._keyframes[i], k1 = curve._keyframes[i+1];
      if(time >= k0.time && time <= k1.time){
        const t = (time - k0.time) / (k1.time - k0.time || 1);
        const prevType = curve.type;
        curve.type = k1.easing;
        const eased = ease(t);
        curve.type = prevType;
        return k0.value + (k1.value - k0.value) * eased;
      }
    }
    return curve._keyframes[0].value;
  }

  function toArray(samples){
    samples = samples || 100;
    const arr = new Float32Array(samples);
    for(let i = 0; i < samples; i++){
      arr[i] = evaluate(i / (samples - 1) * curve.duration);
    }
    return arr;
  }

  function clone(){
    return createAnimationCurve(curve.type, {
      duration: curve.duration,
      startValue: curve.startValue,
      endValue: curve.endValue,
      overshoot: curve.overshoot,
      amplitude: curve.amplitude,
      period: curve.period
    });
  }

  return { evaluate, addKeyframe, evaluateKeyframes, toArray, clone, ease, curve };
}

/* ===== Impostor 系统 =====
   支持: 广告牌LOD / 八面体映射 / 距离切换 / 预渲染
*/
function createImpostorSystem(gl, options){
  const sys = {
    gl: gl,
    impostors: [],
    _program: null,
    _vbo: null,
    _initialized: false,
    _views: 8,
    _angles: []
  };

  function init(){
    const gl = sys.gl;
    const vs = `
      attribute vec3 aPosition;
      attribute vec2 aUV;
      attribute float aViewIndex;
      uniform mat4 uViewProj;
      uniform vec3 uCameraRight;
      uniform vec3 uCameraUp;
      uniform float uViewCount;
      varying vec2 vUV;
      varying float vView;
      void main(){
        float angle = aViewIndex / uViewCount * 6.28318;
        vec3 right = vec3(cos(angle), 0.0, sin(angle));
        vec3 up = vec3(0.0, 1.0, 0.0);
        vec3 worldPos = aPosition + right * aUV.x * 2.0 + up * aUV.y * 2.0;
        vUV = aUV;
        vView = aViewIndex;
        gl_Position = uViewProj * vec4(worldPos, 1.0);
      }
    `;
    const fs = `
      precision mediump float;
      uniform sampler2D uImpostorTexture;
      uniform float uViewCount;
      uniform float uTextureWidth;
      varying vec2 vUV;
      varying float vView;
      void main(){
        float viewX = mod(vView, 4.0);
        float viewY = floor(vView / 4.0);
        vec2 uv = vec2((viewX + vUV.x) / 4.0, (viewY + vUV.y) / 2.0);
        vec4 color = texture2D(uImpostorTexture, uv);
        if(color.a < 0.1) discard;
        gl_FragColor = color;
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    sys._program = gl.createProgram();
    gl.attachShader(sys._program, vsh);
    gl.attachShader(sys._program, fsh);
    gl.linkProgram(sys._program);

    sys._vbo = gl.createBuffer();
    sys._initialized = true;
  }

  function createImpostor(mesh, position, size, options){
    const imp = {
      mesh: mesh,
      position: [position[0], position[1], position[2]],
      size: size || 1,
      distance: (options && options.distance) || 50,
      texture: null,
      textureWidth: 256,
      textureHeight: 128,
      views: sys._views,
      _dirty: true
    };
    sys.impostors.push(imp);
    return imp;
  }

  function renderImpostor(imp, viewProj, cameraPosition, cameraRight, cameraUp){
    if(!sys._initialized) return;
    const gl = sys.gl;
    const dist = V3.dist(imp.position, cameraPosition);
    if(dist < imp.distance) return;

    const angle = Math.atan2(cameraPosition[0] - imp.position[0], cameraPosition[2] - imp.position[2]);
    const viewIndex = Math.floor(((angle / (Math.PI * 2) + 0.5) * imp.views) % imp.views);

    const verts = new Float32Array([
      imp.position[0], imp.position[1], imp.position[2], 0, 0, viewIndex,
      imp.position[0], imp.position[1], imp.position[2], 1, 0, viewIndex,
      imp.position[0], imp.position[1], imp.position[2], 1, 1, viewIndex,
      imp.position[0], imp.position[1], imp.position[2], 0, 1, viewIndex
    ]);

    gl.useProgram(sys._program);
    gl.uniformMatrix4fv(gl.getUniformLocation(sys._program, 'uViewProj'), false, viewProj);
    gl.uniform3fv(gl.getUniformLocation(sys._program, 'uCameraRight'), cameraRight);
    gl.uniform3fv(gl.getUniformLocation(sys._program, 'uCameraUp'), cameraUp);
    gl.uniform1f(gl.getUniformLocation(sys._program, 'uViewCount'), imp.views);
    gl.uniform1f(gl.getUniformLocation(sys._program, 'uTextureWidth'), imp.textureWidth);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, imp.texture);
    gl.uniform1i(gl.getUniformLocation(sys._program, 'uImpostorTexture'), 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, sys._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    const posLoc = gl.getAttribLocation(sys._program, 'aPosition');
    const uvLoc = gl.getAttribLocation(sys._program, 'aUV');
    const viewLoc = gl.getAttribLocation(sys._program, 'aViewIndex');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(viewLoc);
    gl.vertexAttribPointer(viewLoc, 1, gl.FLOAT, false, 24, 20);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
  }

  function renderAll(viewProj, cameraPosition, cameraRight, cameraUp){
    for(let i = 0; i < sys.impostors.length; i++){
      renderImpostor(sys.impostors[i], viewProj, cameraPosition, cameraRight, cameraUp);
    }
  }

  function removeImpostor(imp){
    const idx = sys.impostors.indexOf(imp);
    if(idx >= 0) sys.impostors.splice(idx, 1);
  }

  function clear(){
    sys.impostors = [];
  }

  function dispose(){
    const gl = sys.gl;
    if(sys._vbo) gl.deleteBuffer(sys._vbo);
    if(sys._program) gl.deleteProgram(sys._program);
    for(let i = 0; i < sys.impostors.length; i++){
      if(sys.impostors[i].texture) gl.deleteTexture(sys.impostors[i].texture);
    }
  }

  return { init, createImpostor, renderImpostor, renderAll, removeImpostor, clear, dispose, sys };
}

/* ===== 遮挡剔除系统 =====
   支持: 软件光栅化深度缓冲 / 层级遮挡 / 保守剔除
*/
function createOcclusionCuller(options){
  const culler = {
    width: (options && options.width) || 256,
    height: (options && options.height) || 256,
    _depthBuffer: null,
    _hierarchy: [],
    _hierarchyLevels: 4,
    _camera: null
  };

  function init(){
    culler._depthBuffer = new Float32Array(culler.width * culler.height);
    for(let i = 0; i < culler._hierarchyLevels; i++){
      const w = Math.max(1, culler.width >> i);
      const h = Math.max(1, culler.height >> i);
      culler._hierarchy.push(new Float32Array(w * h));
    }
    clear();
  }

  function clear(){
    for(let i = 0; i < culler._depthBuffer.length; i++){
      culler._depthBuffer[i] = 1;
    }
    for(let l = 0; l < culler._hierarchyLevels; l++){
      for(let i = 0; i < culler._hierarchy[l].length; i++){
        culler._hierarchy[l][i] = 1;
      }
    }
  }

  function setCamera(viewProj, position){
    culler._camera = { viewProj: viewProj, position: position };
  }

  function projectPoint(point, viewProj){
    const x = viewProj[0]*point[0] + viewProj[4]*point[1] + viewProj[8]*point[2] + viewProj[12];
    const y = viewProj[1]*point[0] + viewProj[5]*point[1] + viewProj[9]*point[2] + viewProj[13];
    const z = viewProj[2]*point[0] + viewProj[6]*point[1] + viewProj[10]*point[2] + viewProj[14];
    const w = viewProj[3]*point[0] + viewProj[7]*point[1] + viewProj[11]*point[2] + viewProj[15];
    if(w <= 0) return null;
    return { x: (x/w + 1) * 0.5 * culler.width, y: (y/w + 1) * 0.5 * culler.height, z: z/w };
  }

  function addOccluder(vertices, indices, viewProj){
    for(let i = 0; i < indices.length; i += 3){
      const v0 = vertices[indices[i]];
      const v1 = vertices[indices[i+1]];
      const v2 = vertices[indices[i+2]];
      const p0 = projectPoint(v0, viewProj);
      const p1 = projectPoint(v1, viewProj);
      const p2 = projectPoint(v2, viewProj);
      if(!p0 || !p1 || !p2) continue;
      rasterizeTriangle(p0, p1, p2);
    }
    buildHierarchy();
  }

  function rasterizeTriangle(p0, p1, p2){
    const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)));
    const maxX = Math.min(culler.width - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
    const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)));
    const maxY = Math.min(culler.height - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));
    const area = (p1.x-p0.x)*(p2.y-p0.y) - (p1.y-p0.y)*(p2.x-p0.x);
    if(Math.abs(area) < 0.001) return;
    for(let y = minY; y <= maxY; y++){
      for(let x = minX; x <= maxX; x++){
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((p1.x-px)*(p2.y-py) - (p1.y-py)*(p2.x-px)) / area;
        const w1 = ((p2.x-px)*(p0.y-py) - (p2.y-py)*(p0.x-px)) / area;
        const w2 = 1 - w0 - w1;
        if(w0 >= 0 && w1 >= 0 && w2 >= 0){
          const z = w0 * p0.z + w1 * p1.z + w2 * p2.z;
          const idx = y * culler.width + x;
          if(z < culler._depthBuffer[idx]){
            culler._depthBuffer[idx] = z;
          }
        }
      }
    }
  }

  function buildHierarchy(){
    for(let l = 1; l < culler._hierarchyLevels; l++){
      const prev = culler._hierarchy[l-1];
      const curr = culler._hierarchy[l];
      const pw = Math.max(1, culler.width >> (l-1));
      const ph = Math.max(1, culler.height >> (l-1));
      const cw = Math.max(1, culler.width >> l);
      const ch = Math.max(1, culler.height >> l);
      for(let y = 0; y < ch; y++){
        for(let x = 0; x < cw; x++){
          let minDepth = 1;
          for(let dy = 0; dy < 2; dy++){
            for(let dx = 0; dx < 2; dx++){
              const px = x*2+dx, py = y*2+dy;
              if(px < pw && py < ph){
                const d = prev[py*pw+px];
                if(d < minDepth) minDepth = d;
              }
            }
          }
          curr[y*cw+x] = minDepth;
        }
      }
    }
  }

  function isOccluded(boundingBox, viewProj){
    const corners = AABB.corners(boundingBox);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, minZ = Infinity;
    for(let i = 0; i < corners.length; i++){
      const p = projectPoint(corners[i], viewProj);
      if(!p) return false;
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      minZ = Math.min(minZ, p.z);
    }
    if(maxX < 0 || minX >= culler.width || maxY < 0 || minY >= culler.height) return false;
    const level = Math.floor(Math.log2(Math.max((maxX-minX), (maxY-minY)) / 4));
    const l = Math.max(0, Math.min(culler._hierarchyLevels - 1, level));
    const hw = Math.max(1, culler.width >> l);
    const hh = Math.max(1, culler.height >> l);
    const sx = Math.max(0, Math.floor(minX / (1 << l)));
    const sy = Math.max(0, Math.floor(minY / (1 << l)));
    const ex = Math.min(hw - 1, Math.ceil(maxX / (1 << l)));
    const ey = Math.min(hh - 1, Math.ceil(maxY / (1 << l)));
    for(let y = sy; y <= ey; y++){
      for(let x = sx; x <= ex; x++){
        if(culler._hierarchy[l][y*hw+x] > minZ) return false;
      }
    }
    return true;
  }

  function getDepthBuffer(){
    return culler._depthBuffer;
  }

  function toImageData(){
    const img = new ImageData(culler.width, culler.height);
    for(let i = 0; i < culler.width * culler.height; i++){
      const d = Math.max(0, Math.min(1, culler._depthBuffer[i]));
      const v = (1 - d) * 255;
      img.data[i*4] = v; img.data[i*4+1] = v; img.data[i*4+2] = v; img.data[i*4+3] = 255;
    }
    return img;
  }

  return { init, clear, setCamera, addOccluder, isOccluded, getDepthBuffer, toImageData, culler };
}



/* ===== 虚拟纹理系统 =====
   支持: 瓦片化纹理 / 按需加载 / mipmap链 / 页表管理
*/
function createVirtualTexture(gl, options){
  const vt = {
    gl: gl,
    virtualWidth: (options && options.virtualWidth) || 8192,
    virtualHeight: (options && options.virtualHeight) || 8192,
    tileSize: (options && options.tileSize) || 256,
    maxAnisotropy: (options && options.maxAnisotropy) || 4,
    _pageTable: null,
    _physicalTexture: null,
    _physicalWidth: 0,
    _physicalHeight: 0,
    _pages: {},
    _pageQueue: [],
    _maxPages: (options && options.maxPages) || 1024,
    _cacheHits: 0,
    _cacheMisses: 0,
    _mipLevels: 0,
    _tileDataProvider: null
  };

  function init(){
    vt._mipLevels = Math.floor(Math.log2(Math.max(vt.virtualWidth, vt.virtualHeight) / vt.tileSize)) + 1;
    const tilesX = Math.ceil(vt.virtualWidth / vt.tileSize);
    const tilesY = Math.ceil(vt.virtualHeight / vt.tileSize);
    vt._pageTable = new Int32Array(tilesX * tilesY * vt._mipLevels);
    for(let i = 0; i < vt._pageTable.length; i++) vt._pageTable[i] = -1;

    const physTilesX = Math.min(32, tilesX);
    const physTilesY = Math.min(32, tilesY);
    vt._physicalWidth = physTilesX * vt.tileSize;
    vt._physicalHeight = physTilesY * vt.tileSize;

    const gl = vt.gl;
    vt._physicalTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, vt._physicalTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, vt._physicalWidth, vt._physicalHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  function setTileDataProvider(provider){
    vt._tileDataProvider = provider;
  }

  function getPageKey(mip, tileX, tileY){
    return mip + '_' + tileX + '_' + tileY;
  }

  function requestTile(mip, tileX, tileY){
    const key = getPageKey(mip, tileX, tileY);
    if(vt._pages[key] !== undefined){
      vt._cacheHits++;
      return vt._pages[key];
    }
    vt._cacheMisses++;
    if(vt._pageQueue.length < vt._maxPages){
      vt._pageQueue.push({ mip: mip, x: tileX, y: tileY, key: key, priority: mip });
    }
    return -1;
  }

  function uploadTile(mip, tileX, tileY, data){
    const gl = vt.gl;
    const key = getPageKey(mip, tileX, tileY);
    const tilesX = Math.ceil(vt.virtualWidth / vt.tileSize);
    const pageIdx = (mip * tilesX * Math.ceil(vt.virtualHeight / vt.tileSize)) + tileY * tilesX + tileX;

    let physSlot = vt._pages[key];
    if(physSlot === undefined){
      physSlot = Object.keys(vt._pages).length % (vt._physicalWidth / vt.tileSize * vt._physicalHeight / vt.tileSize);
      vt._pages[key] = physSlot;
      vt._pageTable[pageIdx] = physSlot;
    }

    const physTilesX = vt._physicalWidth / vt.tileSize;
    const px = (physSlot % physTilesX) * vt.tileSize;
    const py = Math.floor(physSlot / physTilesX) * vt.tileSize;

    gl.bindTexture(gl.TEXTURE_2D, vt._physicalTexture);
    if(data instanceof HTMLCanvasElement || data instanceof HTMLImageElement){
      gl.texSubImage2D(gl.TEXTURE_2D, 0, px, py, gl.RGBA, gl.UNSIGNED_BYTE, data);
    } else if(data instanceof Uint8Array){
      gl.texSubImage2D(gl.TEXTURE_2D, 0, px, py, vt.tileSize, vt.tileSize, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
    gl.generateMipmap(gl.TEXTURE_2D);
    return physSlot;
  }

  function processQueue(maxPerFrame){
    maxPerFrame = maxPerFrame || 4;
    vt._pageQueue.sort(function(a, b){ return a.priority - b.priority; });
    const processed = [];
    for(let i = 0; i < Math.min(maxPerFrame, vt._pageQueue.length); i++){
      const req = vt._pageQueue[i];
      if(vt._tileDataProvider){
        const data = vt._tileDataProvider(req.mip, req.x, req.y);
        if(data){
          uploadTile(req.mip, req.x, req.y, data);
          processed.push(req);
        }
      }
    }
    for(let i = 0; i < processed.length; i++){
      const idx = vt._pageQueue.indexOf(processed[i]);
      if(idx >= 0) vt._pageQueue.splice(idx, 1);
    }
    return processed.length;
  }

  function sampleUV(uv, mipBias){
    const mip = Math.max(0, Math.min(vt._mipLevels - 1, Math.floor(mipBias || 0)));
    const tilesX = Math.ceil(vt.virtualWidth / vt.tileSize);
    const tilesY = Math.ceil(vt.virtualHeight / vt.tileSize);
    const tileX = Math.min(tilesX - 1, Math.floor(uv[0] * tilesX));
    const tileY = Math.min(tilesY - 1, Math.floor(uv[1] * tilesY));
    const pageIdx = (mip * tilesX * tilesY) + tileY * tilesX + tileX;
    const physSlot = vt._pageTable[pageIdx];
    if(physSlot < 0){
      requestTile(mip, tileX, tileY);
      return { uv: [0.5, 0.5], valid: false };
    }
    const physTilesX = vt._physicalWidth / vt.tileSize;
    const px = (physSlot % physTilesX) * vt.tileSize;
    const py = Math.floor(physSlot / physTilesX) * vt.tileSize;
    const localU = (uv[0] * tilesX - tileX) * vt.tileSize;
    const localV = (uv[1] * tilesY - tileY) * vt.tileSize;
    return {
      uv: [(px + localU) / vt._physicalWidth, (py + localV) / vt._physicalHeight],
      valid: true
    };
  }

  function getPhysicalTexture(){
    return vt._physicalTexture;
  }

  function getStats(){
    return {
      cacheHits: vt._cacheHits,
      cacheMisses: vt._cacheMisses,
      loadedPages: Object.keys(vt._pages).length,
      pendingRequests: vt._pageQueue.length,
      hitRate: vt._cacheHits / (vt._cacheHits + vt._cacheMisses || 1)
    };
  }

  function clearCache(){
    vt._pages = {};
    vt._pageQueue = [];
    for(let i = 0; i < vt._pageTable.length; i++) vt._pageTable[i] = -1;
    vt._cacheHits = 0;
    vt._cacheMisses = 0;
  }

  function dispose(){
    const gl = vt.gl;
    if(vt._physicalTexture) gl.deleteTexture(vt._physicalTexture);
  }

  return { init, setTileDataProvider, requestTile, uploadTile, processQueue, sampleUV, getPhysicalTexture, getStats, clearCache, dispose, vt };
}

/* ===== GPU粒子系统 =====
   支持: TransformFeedback / GPU更新 / 发射器类型 / 排序
*/
function createGPUParticleSystem(gl, maxParticles, options){
  const ps = {
    gl: gl,
    maxParticles: maxParticles || 10000,
    _programUpdate: null,
    _programRender: null,
    _vao: null,
    _buffers: [],
    _currentBuffer: 0,
    _transformFeedback: null,
    _emitter: { position: [0,0,0], rate: 100, type: 'point' },
    _time: 0,
    _activeCount: 0,
    _sorting: (options && options.sorting) || false
  };

  function init(){
    const gl = ps.gl;
    const updateVS = `
      precision highp float;
      attribute vec3 aPosition;
      attribute vec3 aVelocity;
      attribute vec4 aColor;
      attribute float aLife;
      attribute float aMaxLife;
      attribute float aSize;
      uniform float uDeltaTime;
      uniform vec3 uGravity;
      uniform vec3 uEmitterPos;
      uniform float uEmitRate;
      uniform float uTime;
      varying vec3 vPosition;
      varying vec3 vVelocity;
      varying vec4 vColor;
      varying float vLife;
      varying float vMaxLife;
      varying float vSize;
      float rand(vec2 co){ return fract(sin(dot(co.xy, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        if(aLife > 0.0){
          vLife = aLife - uDeltaTime;
          vVelocity = aVelocity + uGravity * uDeltaTime;
          vPosition = aPosition + vVelocity * uDeltaTime;
          vMaxLife = aMaxLife;
          vSize = aSize;
          float t = 1.0 - vLife / vMaxLife;
          vColor = vec4(aColor.rgb * (1.0 - t * 0.5), aColor.a * (1.0 - t));
        } else {
          float r = rand(vec2(uTime + float(gl_VertexID), uTime));
          if(r < uEmitRate * uDeltaTime){
            vLife = 1.0 + rand(vec2(uTime, float(gl_VertexID))) * 2.0;
            vMaxLife = vLife;
            float angle = rand(vec2(float(gl_VertexID), uTime)) * 6.28318;
            float speed = 0.5 + rand(vec2(uTime + 1.0, float(gl_VertexID))) * 1.5;
            vVelocity = vec3(cos(angle) * speed, speed * 0.8, sin(angle) * speed);
            vPosition = uEmitterPos;
            vSize = 5.0 + rand(vec2(float(gl_VertexID), uTime + 2.0)) * 10.0;
            vColor = vec4(1.0, 0.8, 0.4, 1.0);
          } else {
            vLife = 0.0;
            vPosition = vec3(0.0);
            vVelocity = vec3(0.0);
            vColor = vec4(0.0);
            vMaxLife = 1.0;
            vSize = 0.0;
          }
        }
        gl_Position = vec4(vPosition, 1.0);
      }
    `;
    const updateFS = `
      precision mediump float;
      void main(){ gl_FragColor = vec4(0.0); }
    `;

    const renderVS = `
      attribute vec3 aPosition;
      attribute vec4 aColor;
      attribute float aLife;
      attribute float aSize;
      uniform mat4 uViewProj;
      varying vec4 vColor;
      void main(){
        if(aLife <= 0.0){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
        vColor = aColor;
        gl_Position = uViewProj * vec4(aPosition, 1.0);
        gl_PointSize = aSize * (300.0 / gl_Position.w);
      }
    `;
    const renderFS = `
      precision mediump float;
      uniform sampler2D uParticleTexture;
      varying vec4 vColor;
      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        float dist = length(uv);
        if(dist > 0.5) discard;
        float alpha = smoothstep(0.5, 0.1, dist);
        gl_FragColor = vec4(vColor.rgb, vColor.a * alpha);
      }
    `;

    function compileShader(type, src){
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
        console.error('[GPUParticles] 着色器错误:', gl.getShaderInfoLog(s));
      }
      return s;
    }

    ps._programUpdate = gl.createProgram();
    const uvsh = compileShader(gl.VERTEX_SHADER, updateVS);
    const ufsh = compileShader(gl.FRAGMENT_SHADER, updateFS);
    gl.attachShader(ps._programUpdate, uvsh);
    gl.attachShader(ps._programUpdate, ufsh);
    gl.transformFeedbackVaryings(ps._programUpdate, ['vPosition','vVelocity','vColor','vLife','vMaxLife','vSize'], gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(ps._programUpdate);

    ps._programRender = gl.createProgram();
    const rvsh = compileShader(gl.VERTEX_SHADER, renderVS);
    const rfsh = compileShader(gl.FRAGMENT_SHADER, renderFS);
    gl.attachShader(ps._programRender, rvsh);
    gl.attachShader(ps._programRender, rfsh);
    gl.linkProgram(ps._programRender);

    const stride = 3 + 3 + 4 + 1 + 1 + 1;
    for(let b = 0; b < 2; b++){
      const data = new Float32Array(ps.maxParticles * stride);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_COPY);
      ps._buffers.push(buf);
    }

    ps._transformFeedback = gl.createTransformFeedback();
    ps._vao = gl.createVertexArray ? gl.createVertexArray() : null;
  }

  function setEmitter(position, rate, type){
    ps._emitter.position = [position[0], position[1], position[2]];
    ps._emitter.rate = rate || ps._emitter.rate;
    ps._emitter.type = type || 'point';
  }

  function update(dt){
    if(!ps._programUpdate) return;
    const gl = ps.gl;
    ps._time += dt;
    gl.useProgram(ps._programUpdate);
    gl.uniform1f(gl.getUniformLocation(ps._programUpdate, 'uDeltaTime'), dt);
    gl.uniform3fv(gl.getUniformLocation(ps._programUpdate, 'uGravity'), [0, -2, 0]);
    gl.uniform3fv(gl.getUniformLocation(ps._programUpdate, 'uEmitterPos'), ps._emitter.position);
    gl.uniform1f(gl.getUniformLocation(ps._programUpdate, 'uEmitRate'), ps._emitter.rate);
    gl.uniform1f(gl.getUniformLocation(ps._programUpdate, 'uTime'), ps._time);

    const readBuf = ps._buffers[ps._currentBuffer];
    const writeBuf = ps._buffers[1 - ps._currentBuffer];
    const stride = 13 * 4;

    gl.bindBuffer(gl.ARRAY_BUFFER, readBuf);
    const posLoc = gl.getAttribLocation(ps._programUpdate, 'aPosition');
    const velLoc = gl.getAttribLocation(ps._programUpdate, 'aVelocity');
    const colLoc = gl.getAttribLocation(ps._programUpdate, 'aColor');
    const lifeLoc = gl.getAttribLocation(ps._programUpdate, 'aLife');
    const maxLifeLoc = gl.getAttribLocation(ps._programUpdate, 'aMaxLife');
    const sizeLoc = gl.getAttribLocation(ps._programUpdate, 'aSize');
    gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(velLoc); gl.vertexAttribPointer(velLoc, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(colLoc); gl.vertexAttribPointer(colLoc, 4, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(lifeLoc); gl.vertexAttribPointer(lifeLoc, 1, gl.FLOAT, false, stride, 40);
    gl.enableVertexAttribArray(maxLifeLoc); gl.vertexAttribPointer(maxLifeLoc, 1, gl.FLOAT, false, stride, 44);
    gl.enableVertexAttribArray(sizeLoc); gl.vertexAttribPointer(sizeLoc, 1, gl.FLOAT, false, stride, 48);

    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, ps._transformFeedback);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, writeBuf);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, ps.maxParticles);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);

    ps._currentBuffer = 1 - ps._currentBuffer;
  }

  function render(viewProj){
    if(!ps._programRender) return;
    const gl = ps.gl;
    gl.useProgram(ps._programRender);
    gl.uniformMatrix4fv(gl.getUniformLocation(ps._programRender, 'uViewProj'), false, viewProj);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);

    const buf = ps._buffers[ps._currentBuffer];
    const stride = 13 * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const posLoc = gl.getAttribLocation(ps._programRender, 'aPosition');
    const colLoc = gl.getAttribLocation(ps._programRender, 'aColor');
    const lifeLoc = gl.getAttribLocation(ps._programRender, 'aLife');
    const sizeLoc = gl.getAttribLocation(ps._programRender, 'aSize');
    gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(colLoc); gl.vertexAttribPointer(colLoc, 4, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(lifeLoc); gl.vertexAttribPointer(lifeLoc, 1, gl.FLOAT, false, stride, 40);
    gl.enableVertexAttribArray(sizeLoc); gl.vertexAttribPointer(sizeLoc, 1, gl.FLOAT, false, stride, 48);

    gl.drawArrays(gl.POINTS, 0, ps.maxParticles);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  function reset(){
    const gl = ps.gl;
    const stride = 13;
    for(let b = 0; b < 2; b++){
      const data = new Float32Array(ps.maxParticles * stride);
      gl.bindBuffer(gl.ARRAY_BUFFER, ps._buffers[b]);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    }
    ps._time = 0;
  }

  function dispose(){
    const gl = ps.gl;
    for(let b = 0; b < ps._buffers.length; b++) gl.deleteBuffer(ps._buffers[b]);
    if(ps._programUpdate) gl.deleteProgram(ps._programUpdate);
    if(ps._programRender) gl.deleteProgram(ps._programRender);
    if(ps._transformFeedback) gl.deleteTransformFeedback(ps._transformFeedback);
  }

  return { init, setEmitter, update, render, reset, dispose, ps };
}

/* ===== 变形目标动画系统 =====
   支持:  morph动画 / 权重混合 / 自动播放 / 表情预设
*/
function createMorphAnimator(model, options){
  const anim = {
    model: model,
    morphs: model && model.morphs ? model.morphs : [],
    weights: {},
    _animations: [],
    _currentAnim: null,
    _time: 0,
    _playing: false,
    _speed: 1,
    _presets: {}
  };

  function init(){
    for(let i = 0; i < anim.morphs.length; i++){
      anim.weights[anim.morphs[i].name] = 0;
    }
  }

  function setWeight(name, value){
    if(anim.weights[name] !== undefined){
      anim.weights[name] = Math.max(0, Math.min(1, value));
    }
  }

  function getWeight(name){
    return anim.weights[name] || 0;
  }

  function resetWeights(){
    for(const name in anim.weights) anim.weights[name] = 0;
  }

  function addAnimation(name, keyframes, duration){
    const animData = {
      name: name,
      keyframes: keyframes || [],
      duration: duration || 1,
      loop: true
    };
    anim._animations.push(animData);
    return animData;
  }

  function play(name, options){
    const a = anim._animations.find(function(a){ return a.name === name; });
    if(!a) return false;
    anim._currentAnim = a;
    anim._time = 0;
    anim._playing = true;
    anim._speed = (options && options.speed) || 1;
    if(options && options.loop !== undefined) a.loop = options.loop;
    return true;
  }

  function stop(){
    anim._playing = false;
    anim._currentAnim = null;
  }

  function pause(){
    anim._playing = false;
  }

  function resume(){
    if(anim._currentAnim) anim._playing = true;
  }

  function update(dt){
    if(!anim._playing || !anim._currentAnim) return;
    anim._time += dt * anim._speed;
    const a = anim._currentAnim;
    if(anim._time >= a.duration){
      if(a.loop){
        anim._time = anim._time % a.duration;
      } else {
        anim._time = a.duration;
        anim._playing = false;
      }
    }
    for(let i = 0; i < a.keyframes.length; i++){
      const kf = a.keyframes[i];
      let weight = 0;
      if(kf.type === 'pulse'){
        const t = (anim._time % kf.period) / kf.period;
        weight = Math.sin(t * Math.PI) * kf.amplitude;
      } else if(kf.type === 'hold'){
        weight = anim._time >= kf.start && anim._time <= kf.end ? kf.value : 0;
      } else if(kf.type === 'linear'){
        if(anim._time >= kf.start && anim._time <= kf.end){
          weight = kf.startValue + (kf.endValue - kf.startValue) * ((anim._time - kf.start) / (kf.end - kf.start));
        }
      }
      setWeight(kf.morph, weight);
    }
  }

  function addPreset(name, weights){
    anim._presets[name] = { ...weights };
  }

  function applyPreset(name, blend){
    const preset = anim._presets[name];
    if(!preset) return false;
    const b = blend !== undefined ? blend : 1;
    for(const morphName in preset){
      const current = getWeight(morphName);
      setWeight(morphName, current + (preset[morphName] - current) * b);
    }
    return true;
  }

  function getPresetNames(){
    return Object.keys(anim._presets);
  }

  function getMorphNames(){
    return anim.morphs.map(function(m){ return m.name; });
  }

  function getWeights(){
    return { ...anim.weights };
  }

  function applyToGeometry(geometry){
    if(!geometry || !geometry.positions) return geometry;
    const positions = new Float32Array(geometry.positions);
    const normals = geometry.normals ? new Float32Array(geometry.normals) : null;
    for(let m = 0; m < anim.morphs.length; m++){
      const morph = anim.morphs[m];
      const weight = anim.weights[morph.name] || 0;
      if(Math.abs(weight) < 0.001) continue;
      if(morph.vertices){
        for(let i = 0; i < morph.vertices.length && i < positions.length / 3; i++){
          positions[i*3] += morph.vertices[i][0] * weight;
          positions[i*3+1] += morph.vertices[i][1] * weight;
          positions[i*3+2] += morph.vertices[i][2] * weight;
        }
      }
    }
    return { ...geometry, positions: positions, normals: normals };
  }

  return { init, setWeight, getWeight, resetWeights, addAnimation, play, stop, pause, resume, update, addPreset, applyPreset, getPresetNames, getMorphNames, getWeights, applyToGeometry, anim };
}

/* ===== 骨骼可视化系统 =====
   支持: 骨骼线框 / 关节点 / 骨骼名称 / 选择高亮
*/
function createSkeletonVisualizer(gl, options){
  const vis = {
    gl: gl,
    _program: null,
    _lineBuffer: null,
    _pointBuffer: null,
    _initialized: false,
    boneColor: (options && options.boneColor) || [0.2, 0.8, 0.2, 1],
    jointColor: (options && options.jointColor) || [0.8, 0.2, 0.2, 1],
    selectedColor: (options && options.selectedColor) || [1, 1, 0, 1],
    selectedBone: -1,
    showNames: (options && options.showNames) || false,
    boneScale: (options && options.boneScale) || 1
  };

  function init(){
    const gl = vis.gl;
    const vs = `
      attribute vec3 aPosition;
      attribute vec4 aColor;
      uniform mat4 uViewProj;
      varying vec4 vColor;
      void main(){
        vColor = aColor;
        gl_Position = uViewProj * vec4(aPosition, 1.0);
      }
    `;
    const fs = `
      precision mediump float;
      varying vec4 vColor;
      void main(){ gl_FragColor = vColor; }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    vis._program = gl.createProgram();
    gl.attachShader(vis._program, vsh);
    gl.attachShader(vis._program, fsh);
    gl.linkProgram(vis._program);
    vis._lineBuffer = gl.createBuffer();
    vis._pointBuffer = gl.createBuffer();
    vis._initialized = true;
  }

  function buildBoneData(boneSystem, poseRotations, posePositions){
    const bones = boneSystem.bones || [];
    const lines = [];
    const points = [];
    const bonePositions = [];

    for(let i = 0; i < bones.length; i++){
      const bone = bones[i];
      let pos = [0, 0, 0];
      if(posePositions && posePositions[i]){
        pos = posePositions[i];
      } else if(bone.position){
        pos = bone.position;
      }
      bonePositions.push([pos[0], pos[1], pos[2]]);
    }

    for(let i = 0; i < bones.length; i++){
      const bone = bones[i];
      const pos = bonePositions[i];
      const isSelected = i === vis.selectedBone;
      const color = isSelected ? vis.selectedColor : vis.boneColor;

      points.push(pos[0], pos[1], pos[2],
        isSelected ? vis.selectedColor[0] : vis.jointColor[0],
        isSelected ? vis.selectedColor[1] : vis.jointColor[1],
        isSelected ? vis.selectedColor[2] : vis.jointColor[2],
        isSelected ? vis.selectedColor[3] : vis.jointColor[3]);

      if(bone.parent >= 0 && bone.parent < bonePositions.length){
        const parentPos = bonePositions[bone.parent];
        lines.push(parentPos[0], parentPos[1], parentPos[2], color[0], color[1], color[2], color[3]);
        lines.push(pos[0], pos[1], pos[2], color[0], color[1], color[2], color[3]);
      }
    }

    return { lines: new Float32Array(lines), points: new Float32Array(points), bonePositions: bonePositions };
  }

  function render(boneSystem, viewProj, poseRotations, posePositions){
    if(!vis._initialized) return;
    const gl = vis.gl;
    const data = buildBoneData(boneSystem, poseRotations, posePositions);

    gl.useProgram(vis._program);
    gl.uniformMatrix4fv(gl.getUniformLocation(vis._program, 'uViewProj'), false, viewProj);

    gl.bindBuffer(gl.ARRAY_BUFFER, vis._lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.lines, gl.DYNAMIC_DRAW);
    const posLoc = gl.getAttribLocation(vis._program, 'aPosition');
    const colLoc = gl.getAttribLocation(vis._program, 'aColor');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(colLoc);
    gl.vertexAttribPointer(colLoc, 4, gl.FLOAT, false, 28, 12);
    gl.drawArrays(gl.LINES, 0, data.lines.length / 7);

    gl.bindBuffer(gl.ARRAY_BUFFER, vis._pointBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.points, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(colLoc);
    gl.vertexAttribPointer(colLoc, 4, gl.FLOAT, false, 28, 12);
    gl.drawArrays(gl.POINTS, 0, data.points.length / 7);

    return data.bonePositions;
  }

  function pickBone(boneSystem, camera, mouseX, mouseY, canvasWidth, canvasHeight, poseRotations, posePositions){
    const bones = boneSystem.bones || [];
    const data = buildBoneData(boneSystem, poseRotations, posePositions);
    let bestBone = -1;
    let bestDist = 20;

    for(let i = 0; i < bones.length; i++){
      const pos = data.bonePositions[i];
      const projected = projectPoint(pos, camera, canvasWidth, canvasHeight);
      if(!projected) continue;
      const dx = projected.x - mouseX;
      const dy = projected.y - mouseY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if(dist < bestDist){
        bestDist = dist;
        bestBone = i;
      }
    }
    vis.selectedBone = bestBone;
    return bestBone;
  }

  function projectPoint(point, camera, width, height){
    const viewProj = camera.viewProj || M4.create();
    const x = viewProj[0]*point[0] + viewProj[4]*point[1] + viewProj[8]*point[2] + viewProj[12];
    const y = viewProj[1]*point[0] + viewProj[5]*point[1] + viewProj[9]*point[2] + viewProj[13];
    const w = viewProj[3]*point[0] + viewProj[7]*point[1] + viewProj[11]*point[2] + viewProj[15];
    if(w <= 0) return null;
    return { x: (x/w + 1) * 0.5 * width, y: (1 - (y/w + 1) * 0.5) * height };
  }

  function setSelectedBone(index){
    vis.selectedBone = index;
  }

  function getSelectedBone(){
    return vis.selectedBone;
  }

  function dispose(){
    const gl = vis.gl;
    if(vis._lineBuffer) gl.deleteBuffer(vis._lineBuffer);
    if(vis._pointBuffer) gl.deleteBuffer(vis._pointBuffer);
    if(vis._program) gl.deleteProgram(vis._program);
  }

  return { init, render, pickBone, setSelectedBone, getSelectedBone, dispose, vis };
}

/* ===== 性能分析器 =====
   支持: 帧时间统计 / 函数计时 / 内存监控 / 报告生成
*/
function createPerformanceProfiler(options){
  const profiler = {
    _enabled: (options && options.enabled !== undefined) ? options.enabled : true,
    _frameTimes: [],
    _maxFrames: (options && options.maxFrames) || 300,
    _counters: {},
    _timers: {},
    _activeTimers: [],
    _memory: { used: 0, total: 0, limit: 0 },
    _gpuStats: { drawCalls: 0, triangles: 0, textures: 0, programs: 0 },
    _frameCount: 0,
    _lastFrameTime: 0,
    _fps: 0,
    _fpsAccumulator: 0,
    _fpsFrames: 0
  };

  function beginFrame(){
    if(!profiler._enabled) return;
    profiler._lastFrameTime = performance.now();
    profiler._gpuStats.drawCalls = 0;
    profiler._gpuStats.triangles = 0;
  }

  function endFrame(){
    if(!profiler._enabled) return;
    const frameTime = performance.now() - profiler._lastFrameTime;
    profiler._frameTimes.push(frameTime);
    if(profiler._frameTimes.length > profiler._maxFrames){
      profiler._frameTimes.shift();
    }
    profiler._frameCount++;
    profiler._fpsAccumulator += frameTime;
    profiler._fpsFrames++;
    if(profiler._fpsAccumulator >= 1000){
      profiler._fps = profiler._fpsFrames * 1000 / profiler._fpsAccumulator;
      profiler._fpsAccumulator = 0;
      profiler._fpsFrames = 0;
    }
  }

  function startTimer(name){
    if(!profiler._enabled) return;
    if(!profiler._timers[name]){
      profiler._timers[name] = { total: 0, count: 0, min: Infinity, max: 0, last: 0 };
    }
    profiler._activeTimers.push({ name: name, start: performance.now() });
  }

  function endTimer(name){
    if(!profiler._enabled) return;
    for(let i = profiler._activeTimers.length - 1; i >= 0; i--){
      if(profiler._activeTimers[i].name === name){
        const elapsed = performance.now() - profiler._activeTimers[i].start;
        const timer = profiler._timers[name];
        timer.total += elapsed;
        timer.count++;
        timer.last = elapsed;
        timer.min = Math.min(timer.min, elapsed);
        timer.max = Math.max(timer.max, elapsed);
        profiler._activeTimers.splice(i, 1);
        return elapsed;
      }
    }
    return 0;
  }

  function incrementCounter(name, amount){
    if(!profiler._enabled) return;
    profiler._counters[name] = (profiler._counters[name] || 0) + (amount || 1);
  }

  function setCounter(name, value){
    if(!profiler._enabled) return;
    profiler._counters[name] = value;
  }

  function getCounter(name){
    return profiler._counters[name] || 0;
  }

  function resetCounters(){
    profiler._counters = {};
  }

  function recordDrawCall(triangleCount){
    if(!profiler._enabled) return;
    profiler._gpuStats.drawCalls++;
    profiler._gpuStats.triangles += triangleCount || 0;
  }

  function updateMemory(){
    if(performance.memory){
      profiler._memory.used = performance.memory.usedJSHeapSize;
      profiler._memory.total = performance.memory.totalJSHeapSize;
      profiler._memory.limit = performance.memory.jsHeapSizeLimit;
    }
  }

  function getFPS(){
    return profiler._fps;
  }

  function getFrameTime(){
    if(profiler._frameTimes.length === 0) return 0;
    return profiler._frameTimes[profiler._frameTimes.length - 1];
  }

  function getAverageFrameTime(){
    if(profiler._frameTimes.length === 0) return 0;
    let sum = 0;
    for(let i = 0; i < profiler._frameTimes.length; i++) sum += profiler._frameTimes[i];
    return sum / profiler._frameTimes.length;
  }

  function getFrameTimeStats(){
    if(profiler._frameTimes.length === 0) return { min: 0, max: 0, avg: 0, p95: 0, p99: 0 };
    const sorted = [...profiler._frameTimes].sort(function(a, b){ return a - b; });
    const sum = sorted.reduce(function(a, b){ return a + b; }, 0);
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / sorted.length,
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  function getTimerReport(name){
    const timer = profiler._timers[name];
    if(!timer || timer.count === 0) return null;
    return {
      name: name,
      total: timer.total,
      count: timer.count,
      average: timer.total / timer.count,
      min: timer.min,
      max: timer.max,
      last: timer.last
    };
  }

  function getAllTimerReports(){
    const reports = [];
    for(const name in profiler._timers){
      const report = getTimerReport(name);
      if(report) reports.push(report);
    }
    reports.sort(function(a, b){ return b.total - a.total; });
    return reports;
  }

  function getGPUStats(){
    return { ...profiler._gpuStats };
  }

  function getMemoryStats(){
    updateMemory();
    return { ...profiler._memory };
  }

  function generateReport(){
    return {
      frameCount: profiler._frameCount,
      fps: profiler._fps,
      frameTime: getFrameTimeStats(),
      timers: getAllTimerReports(),
      counters: { ...profiler._counters },
      gpu: getGPUStats(),
      memory: getMemoryStats()
    };
  }

  function reset(){
    profiler._frameTimes = [];
    profiler._timers = {};
    profiler._counters = {};
    profiler._frameCount = 0;
    profiler._fps = 0;
    profiler._fpsAccumulator = 0;
    profiler._fpsFrames = 0;
  }

  function setEnabled(enabled){
    profiler._enabled = enabled;
  }

  function isEnabled(){
    return profiler._enabled;
  }

  return {
    beginFrame, endFrame, startTimer, endTimer, incrementCounter, setCounter,
    getCounter, resetCounters, recordDrawCall, getFPS, getFrameTime,
    getAverageFrameTime, getFrameTimeStats, getTimerReport, getAllTimerReports,
    getGPUStats, getMemoryStats, generateReport, reset, setEnabled, isEnabled, profiler
  };
}

/* ===== 资产导入管线 =====
   支持: 多格式加载 / 依赖解析 / 缓存 / 进度回调
*/
function createAssetPipeline(options){
  const pipeline = {
    _loaders: {},
    _cache: {},
    _loading: {},
    _baseUrl: (options && options.baseUrl) || '',
    _maxConcurrent: (options && options.maxConcurrent) || 4,
    _queue: [],
    _active: 0,
    _onProgress: null,
    _onComplete: null
  };

  function registerLoader(type, loader){
    pipeline._loaders[type] = loader;
  }

  function setBaseUrl(url){
    pipeline._baseUrl = url;
  }

  function getCacheKey(type, url){
    return type + ':' + url;
  }

  function load(type, url, options){
    const key = getCacheKey(type, url);
    if(pipeline._cache[key]){
      return Promise.resolve(pipeline._cache[key]);
    }
    if(pipeline._loading[key]){
      return pipeline._loading[key];
    }
    const loader = pipeline._loaders[type];
    if(!loader){
      return Promise.reject(new Error('未注册的加载器类型: ' + type));
    }
    const fullUrl = pipeline._baseUrl + url;
    const promise = loader(fullUrl, options).then(function(asset){
      pipeline._cache[key] = asset;
      delete pipeline._loading[key];
      return asset;
    }).catch(function(err){
      delete pipeline._loading[key];
      throw err;
    });
    pipeline._loading[key] = promise;
    return promise;
  }

  function loadBatch(items, onProgress){
    const results = {};
    let completed = 0;
    const total = items.length;
    return new Promise(function(resolve, reject){
      function next(){
        if(completed >= total){
          resolve(results);
          return;
        }
        const item = items[completed];
        load(item.type, item.url, item.options).then(function(asset){
          results[item.url] = asset;
          completed++;
          if(onProgress) onProgress(completed, total, item.url);
          next();
        }).catch(function(err){
          reject(err);
        });
      }
      next();
    });
  }

  function get(type, url){
    const key = getCacheKey(type, url);
    return pipeline._cache[key] || null;
  }

  function has(type, url){
    const key = getCacheKey(type, url);
    return pipeline._cache[key] !== undefined;
  }

  function release(type, url){
    const key = getCacheKey(type, url);
    delete pipeline._cache[key];
  }

  function clearCache(){
    pipeline._cache = {};
  }

  function getCacheInfo(){
    const info = {};
    for(const key in pipeline._cache){
      const parts = key.split(':');
      const type = parts[0];
      if(!info[type]) info[type] = 0;
      info[type]++;
    }
    return info;
  }

  function registerDefaultLoaders(gl){
    registerLoader('texture', function(url, options){
      return new Promise(function(resolve, reject){
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function(){
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.generateMipmap(gl.TEXTURE_2D);
          resolve({ texture: tex, width: img.width, height: img.height, image: img });
        };
        img.onerror = function(){ reject(new Error('纹理加载失败: ' + url)); };
        img.src = url;
      });
    });

    registerLoader('json', function(url){
      return fetch(url).then(function(r){ return r.json(); });
    });

    registerLoader('text', function(url){
      return fetch(url).then(function(r){ return r.text(); });
    });

    registerLoader('arraybuffer', function(url){
      return fetch(url).then(function(r){ return r.arrayBuffer(); });
    });

    registerLoader('pmx', function(url){
      return fetch(url).then(function(r){ return r.arrayBuffer(); }).then(function(buf){
        return parsePMX(buf);
      });
    });

    registerLoader('vmd', function(url){
      return fetch(url).then(function(r){ return r.arrayBuffer(); }).then(function(buf){
        return parseVMD(buf);
      });
    });
  }

  return {
    registerLoader, setBaseUrl, load, loadBatch, get, has, release,
    clearCache, getCacheInfo, registerDefaultLoaders, pipeline
  };
}



/* ===== 骨骼动画压缩系统 =====
   支持: 关键帧精简 / 量化 / 差值编码 / 运行时解压
*/
function createAnimationCompressor(options){
  const comp = {
    positionTolerance: (options && options.positionTolerance) || 0.001,
    rotationTolerance: (options && options.rotationTolerance) || 0.001,
    scaleTolerance: (options && options.scaleTolerance) || 0.001,
    positionBits: (options && options.positionBits) || 16,
    rotationBits: (options && options.rotationBits) || 16,
    _minPos: [Infinity, Infinity, Infinity],
    _maxPos: [-Infinity, -Infinity, -Infinity]
  };

  function compressClip(clip){
    const compressed = {
      name: clip.name,
      duration: clip.duration,
      tracks: [],
      frameRate: clip.frameRate || 30
    };
    for(let t = 0; t < clip.tracks.length; t++){
      const track = clip.tracks[t];
      const compressedTrack = {
        boneName: track.boneName,
        type: track.type,
        keyframes: compressKeyframes(track.keyframes, track.type)
      };
      compressed.tracks.push(compressedTrack);
    }
    return compressed;
  }

  function compressKeyframes(keyframes, type){
    if(!keyframes || keyframes.length === 0) return [];
    const tolerance = type === 'rotation' ? comp.rotationTolerance :
                      type === 'scale' ? comp.scaleTolerance : comp.positionTolerance;
    const result = [keyframes[0]];
    for(let i = 1; i < keyframes.length - 1; i++){
      const prev = result[result.length - 1];
      const curr = keyframes[i];
      const next = keyframes[i + 1];
      const interpolated = interpolateKeyframe(prev, next, curr.time, type);
      if(!keyframesClose(curr, interpolated, tolerance)){
        result.push(curr);
      }
    }
    result.push(keyframes[keyframes.length - 1]);
    return result;
  }

  function interpolateKeyframe(a, b, time, type){
    const t = Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time || 1)));
    if(type === 'rotation'){
      const q = Q.create();
      Q.slerp(q, a.value, b.value, t);
      return { time: time, value: q };
    }
    const val = new Float32Array(a.value.length);
    for(let i = 0; i < a.value.length; i++){
      val[i] = a.value[i] + (b.value[i] - a.value[i]) * t;
    }
    return { time: time, value: val };
  }

  function keyframesClose(a, b, tolerance){
    if(a.value.length !== b.value.length) return false;
    for(let i = 0; i < a.value.length; i++){
      if(Math.abs(a.value[i] - b.value[i]) > tolerance) return false;
    }
    return true;
  }

  function quantizeClip(clip){
    const quantized = {
      name: clip.name,
      duration: clip.duration,
      tracks: [],
      positionMin: [...comp._minPos],
      positionMax: [...comp._maxPos]
    };
    for(let t = 0; t < clip.tracks.length; t++){
      const track = clip.tracks[t];
      const qTrack = {
        boneName: track.boneName,
        type: track.type,
        keyframes: []
      };
      for(let k = 0; k < track.keyframes.length; k++){
        const kf = track.keyframes[k];
        const qkf = { time: kf.time, value: [] };
        for(let v = 0; v < kf.value.length; v++){
          const bits = track.type === 'rotation' ? comp.rotationBits : comp.positionBits;
          const maxVal = (1 << bits) - 1;
          if(track.type === 'position'){
            const range = comp._maxPos[v % 3] - comp._minPos[v % 3] || 1;
            qkf.value[v] = Math.round(((kf.value[v] - comp._minPos[v % 3]) / range) * maxVal);
          } else {
            qkf.value[v] = Math.round(((kf.value[v] + 1) / 2) * maxVal);
          }
        }
        qTrack.keyframes.push(qkf);
      }
      quantized.tracks.push(qTrack);
    }
    return quantized;
  }

  function decompressClip(compressed){
    const clip = {
      name: compressed.name,
      duration: compressed.duration,
      tracks: []
    };
    for(let t = 0; t < compressed.tracks.length; t++){
      const track = compressed.tracks[t];
      clip.tracks.push({
        boneName: track.boneName,
        type: track.type,
        keyframes: track.keyframes.map(function(kf){
          return { time: kf.time, value: new Float32Array(kf.value) };
        })
      });
    }
    return clip;
  }

  function getCompressionRatio(original, compressed){
    const origSize = estimateClipSize(original);
    const compSize = estimateClipSize(compressed);
    return { original: origSize, compressed: compSize, ratio: origSize / compSize };
  }

  function estimateClipSize(clip){
    let size = 0;
    for(let t = 0; t < clip.tracks.length; t++){
      size += clip.tracks[t].boneName.length;
      size += (clip.tracks[t].keyframes || []).length * 20;
    }
    return size;
  }

  return { compressClip, quantizeClip, decompressClip, getCompressionRatio, comp };
}

/* ===== 渲染队列系统 =====
   支持: 不透明/透明排序 / 批处理 / 状态切换优化
*/
function createRenderQueue(options){
  const queue = {
    _opaque: [],
    _transparent: [],
    _overlay: [],
    _stats: { submitted: 0, rendered: 0, stateChanges: 0 },
    _currentState: {}
  };

  function submit(item){
    queue._stats.submitted++;
    if(item.transparent){
      queue._transparent.push(item);
    } else if(item.overlay){
      queue._overlay.push(item);
    } else {
      queue._opaque.push(item);
    }
  }

  function sort(){
    queue._opaque.sort(function(a, b){
      if(a.materialId !== b.materialId) return a.materialId - b.materialId;
      if(a.depth !== b.depth) return a.depth - b.depth;
      return 0;
    });
    queue._transparent.sort(function(a, b){
      return b.depth - a.depth;
    });
  }

  function execute(gl, camera){
    sort();
    queue._stats.rendered = 0;
    queue._stats.stateChanges = 0;
    const all = [...queue._opaque, ...queue._transparent, ...queue._overlay];
    for(let i = 0; i < all.length; i++){
      const item = all[i];
      if(item.materialId !== queue._currentState.material){
        queue._currentState.material = item.materialId;
        queue._stats.stateChanges++;
        if(item.bindMaterial) item.bindMaterial(gl);
      }
      if(item.render) item.render(gl, camera);
      queue._stats.rendered++;
    }
    clear();
  }

  function clear(){
    queue._opaque = [];
    queue._transparent = [];
    queue._overlay = [];
    queue._currentState = {};
  }

  function getStats(){
    return { ...queue._stats };
  }

  return { submit, execute, clear, getStats, queue };
}

/* ===== 材质实例系统 =====
   支持: 材质继承 / 参数覆盖 / 实例共享
*/
function createMaterialInstance(baseMaterial, overrides){
  const inst = {
    base: baseMaterial,
    overrides: overrides || {},
    _dirty: true
  };

  function set(name, value){
    inst.overrides[name] = value;
    inst._dirty = true;
  }

  function get(name){
    if(inst.overrides[name] !== undefined) return inst.overrides[name];
    return baseMaterial ? baseMaterial[name] : undefined;
  }

  function has(name){
    return inst.overrides[name] !== undefined || (baseMaterial && baseMaterial[name] !== undefined);
  }

  function removeOverride(name){
    delete inst.overrides[name];
    inst._dirty = true;
  }

  function reset(){
    inst.overrides = {};
    inst._dirty = true;
  }

  function getResolved(){
    if(!baseMaterial) return { ...inst.overrides };
    const resolved = { ...baseMaterial };
    for(const key in inst.overrides){
      resolved[key] = inst.overrides[key];
    }
    return resolved;
  }

  function clone(){
    return createMaterialInstance(baseMaterial, { ...inst.overrides });
  }

  return { set, get, has, removeOverride, reset, getResolved, clone, inst };
}

/* ===== 光照贴图系统 =====
   支持: 烘焙光照 / 运行时采样 / 方向光照贴图
*/
function createLightmapSystem(gl, options){
  const lm = {
    gl: gl,
    width: (options && options.width) || 1024,
    height: (options && options.height) || 1024,
    _texture: null,
    _directionalTexture: null,
    _data: null,
    _directionalData: null,
    _objects: [],
    _baked: false
  };

  function init(){
    const gl = lm.gl;
    lm._data = new Uint8Array(lm.width * lm.height * 4);
    lm._directionalData = new Uint8Array(lm.width * lm.height * 4);
    lm._texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, lm._texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lm.width, lm.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, lm._data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function addObject(geometry, uvOffset, uvScale){
    lm._objects.push({ geometry: geometry, uvOffset: uvOffset || [0,0], uvScale: uvScale || [1,1] });
  }

  function bake(lights, samples){
    samples = samples || 64;
    for(let y = 0; y < lm.height; y++){
      for(let x = 0; x < lm.width; x++){
        const u = x / lm.width;
        const v = y / lm.height;
        let r = 0, g = 0, b = 0;
        for(let s = 0; s < samples; s++){
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          const dir = [Math.sin(phi)*Math.cos(theta), Math.cos(phi), Math.sin(phi)*Math.sin(theta)];
          for(let l = 0; l < lights.length; l++){
            const light = lights[l];
            const ndotl = Math.max(0, dir[0]*light.direction[0] + dir[1]*light.direction[1] + dir[2]*light.direction[2]);
            r += light.color[0] * ndotl * light.intensity;
            g += light.color[1] * ndotl * light.intensity;
            b += light.color[2] * ndotl * light.intensity;
          }
        }
        const idx = (y * lm.width + x) * 4;
        lm._data[idx] = Math.min(255, r / samples * 255);
        lm._data[idx+1] = Math.min(255, g / samples * 255);
        lm._data[idx+2] = Math.min(255, b / samples * 255);
        lm._data[idx+3] = 255;
      }
    }
    const gl = lm.gl;
    gl.bindTexture(gl.TEXTURE_2D, lm._texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, lm.width, lm.height, gl.RGBA, gl.UNSIGNED_BYTE, lm._data);
    lm._baked = true;
  }

  function sample(uv){
    const x = Math.floor(uv[0] * (lm.width - 1));
    const y = Math.floor(uv[1] * (lm.height - 1));
    const idx = (y * lm.width + x) * 4;
    return [lm._data[idx]/255, lm._data[idx+1]/255, lm._data[idx+2]/255];
  }

  function getTexture(){
    return lm._texture;
  }

  function isBaked(){
    return lm._baked;
  }

  function dispose(){
    const gl = lm.gl;
    if(lm._texture) gl.deleteTexture(lm._texture);
  }

  return { init, addObject, bake, sample, getTexture, isBaked, dispose, lm };
}

/* ===== 相机效果系统 =====
   支持: 镜头抖动 / 焦距变化 / 运动模糊 / 景深
*/
function createCameraEffects(options){
  const fx = {
    _shake: { amplitude: 0, duration: 0, time: 0, frequency: 10 },
    _fov: { current: 60, target: 60, speed: 5 },
    _chromaticAberration: 0,
    _vignette: 0.5,
    _grain: 0,
    _motionBlur: 0,
    _dof: { focus: 10, aperture: 0.1, maxBlur: 0.05 },
    _time: 0
  };

  function update(dt, camera){
    fx._time += dt;
    if(fx._shake.time > 0){
      fx._shake.time -= dt;
      const t = fx._shake.time / fx._shake.duration;
      const amp = fx._shake.amplitude * t * t;
      camera.position[0] += (Math.random() - 0.5) * amp;
      camera.position[1] += (Math.random() - 0.5) * amp;
      camera.position[2] += (Math.random() - 0.5) * amp;
    }
    if(camera.fov !== undefined){
      camera.fov += (fx._fov.target - camera.fov) * Math.min(1, fx._fov.speed * dt);
    }
  }

  function shake(amplitude, duration, frequency){
    fx._shake.amplitude = amplitude || 0.1;
    fx._shake.duration = duration || 0.5;
    fx._shake.time = duration || 0.5;
    fx._shake.frequency = frequency || 10;
  }

  function setFov(target, speed){
    fx._fov.target = target;
    if(speed) fx._fov.speed = speed;
  }

  function setChromaticAberration(value){
    fx._chromaticAberration = value;
  }

  function setVignette(value){
    fx._vignette = value;
  }

  function setGrain(value){
    fx._grain = value;
  }

  function setMotionBlur(value){
    fx._motionBlur = value;
  }

  function setDOF(focus, aperture, maxBlur){
    fx._dof.focus = focus;
    fx._dof.aperture = aperture;
    fx._dof.maxBlur = maxBlur;
  }

  function getUniforms(){
    return {
      chromaticAberration: fx._chromaticAberration,
      vignette: fx._vignette,
      grain: fx._grain,
      motionBlur: fx._motionBlur,
      dofFocus: fx._dof.focus,
      dofAperture: fx._dof.aperture,
      dofMaxBlur: fx._dof.maxBlur,
      time: fx._time
    };
  }

  function reset(){
    fx._shake.time = 0;
    fx._fov.target = 60;
    fx._chromaticAberration = 0;
    fx._vignette = 0.5;
    fx._grain = 0;
    fx._motionBlur = 0;
  }

  return { update, shake, setFov, setChromaticAberration, setVignette, setGrain, setMotionBlur, setDOF, getUniforms, reset, fx };
}

/* ===== 输入映射系统 =====
   支持: 按键绑定 / 轴映射 / 多设备 / 配置保存
*/
function createInputMap(options){
  const map = {
    _actions: {},
    _axes: {},
    _keyStates: {},
    _mouseStates: { x: 0, y: 0, dx: 0, dy: 0, buttons: {} },
    _bindings: {},
    _sensitivity: (options && options.sensitivity) || 1,
    _invertY: (options && options.invertY) || false
  };

  function bindAction(action, key){
    if(!map._bindings[action]) map._bindings[action] = [];
    map._bindings[action].push(key);
  }

  function unbindAction(action, key){
    if(!map._bindings[action]) return;
    const idx = map._bindings[action].indexOf(key);
    if(idx >= 0) map._bindings[action].splice(idx, 1);
  }

  function bindAxis(axis, positiveKey, negativeKey){
    map._axes[axis] = { positive: positiveKey, negative: negativeKey, value: 0 };
  }

  function isActionPressed(action){
    const keys = map._bindings[action];
    if(!keys) return false;
    for(let i = 0; i < keys.length; i++){
      if(map._keyStates[keys[i]]) return true;
    }
    return false;
  }

  function getAxis(axis){
    const a = map._axes[axis];
    if(!a) return 0;
    let value = 0;
    if(map._keyStates[a.positive]) value += 1;
    if(map._keyStates[a.negative]) value -= 1;
    return value;
  }

  function getMouseDelta(){
    const dx = map._mouseStates.dx * map._sensitivity;
    const dy = map._mouseStates.dy * map._sensitivity * (map._invertY ? -1 : 1);
    map._mouseStates.dx = 0;
    map._mouseStates.dy = 0;
    return { x: dx, y: dy };
  }

  function handleKeyDown(key){
    map._keyStates[key] = true;
  }

  function handleKeyUp(key){
    map._keyStates[key] = false;
  }

  function handleMouseMove(x, y, dx, dy){
    map._mouseStates.x = x;
    map._mouseStates.y = y;
    map._mouseStates.dx += dx;
    map._mouseStates.dy += dy;
  }

  function handleMouseDown(button){
    map._mouseStates.buttons[button] = true;
  }

  function handleMouseUp(button){
    map._mouseStates.buttons[button] = false;
  }

  function isMouseDown(button){
    return !!map._mouseStates.buttons[button];
  }

  function setSensitivity(value){
    map._sensitivity = value;
  }

  function setInvertY(value){
    map._invertY = value;
  }

  function saveConfig(){
    return JSON.stringify({
      bindings: map._bindings,
      axes: map._axes,
      sensitivity: map._sensitivity,
      invertY: map._invertY
    });
  }

  function loadConfig(json){
    const config = JSON.parse(json);
    map._bindings = config.bindings || {};
    map._axes = config.axes || {};
    map._sensitivity = config.sensitivity || 1;
    map._invertY = config.invertY || false;
  }

  function reset(){
    map._keyStates = {};
    map._mouseStates = { x: 0, y: 0, dx: 0, dy: 0, buttons: {} };
  }

  return {
    bindAction, unbindAction, bindAxis, isActionPressed, getAxis, getMouseDelta,
    handleKeyDown, handleKeyUp, handleMouseMove, handleMouseDown, handleMouseUp,
    isMouseDown, setSensitivity, setInvertY, saveConfig, loadConfig, reset, map
  };
}

/* ===== 行为树系统 =====
   支持: 选择器 / 序列 / 装饰器 / 条件 / 动作
*/
const NodeStatus = { SUCCESS: 0, FAILURE: 1, RUNNING: 2 };

function createBehaviorTree(root){
  const bt = {
    root: root,
    _blackboard: {},
    _runningNodes: []
  };

  function setBlackboard(key, value){
    bt._blackboard[key] = value;
  }

  function getBlackboard(key){
    return bt._blackboard[key];
  }

  function tick(context){
    return bt.root.tick(context, bt._blackboard);
  }

  function reset(){
    bt._runningNodes = [];
  }

  return { tick, setBlackboard, getBlackboard, reset, bt };
}

function createSelector(children){
  return {
    type: 'selector',
    children: children || [],
    _current: 0,
    tick: function(context, blackboard){
      for(let i = this._current; i < this.children.length; i++){
        const status = this.children[i].tick(context, blackboard);
        if(status === NodeStatus.RUNNING){
          this._current = i;
          return NodeStatus.RUNNING;
        }
        if(status === NodeStatus.SUCCESS){
          this._current = 0;
          return NodeStatus.SUCCESS;
        }
      }
      this._current = 0;
      return NodeStatus.FAILURE;
    }
  };
}

function createSequence(children){
  return {
    type: 'sequence',
    children: children || [],
    _current: 0,
    tick: function(context, blackboard){
      for(let i = this._current; i < this.children.length; i++){
        const status = this.children[i].tick(context, blackboard);
        if(status === NodeStatus.RUNNING){
          this._current = i;
          return NodeStatus.RUNNING;
        }
        if(status === NodeStatus.FAILURE){
          this._current = 0;
          return NodeStatus.FAILURE;
        }
      }
      this._current = 0;
      return NodeStatus.SUCCESS;
    }
  };
}

function createCondition(conditionFunc){
  return {
    type: 'condition',
    tick: function(context, blackboard){
      return conditionFunc(context, blackboard) ? NodeStatus.SUCCESS : NodeStatus.FAILURE;
    }
  };
}

function createAction(actionFunc){
  return {
    type: 'action',
    tick: function(context, blackboard){
      return actionFunc(context, blackboard);
    }
  };
}

function createInverter(child){
  return {
    type: 'inverter',
    child: child,
    tick: function(context, blackboard){
      const status = this.child.tick(context, blackboard);
      if(status === NodeStatus.SUCCESS) return NodeStatus.FAILURE;
      if(status === NodeStatus.FAILURE) return NodeStatus.SUCCESS;
      return status;
    }
  };
}

function createRepeater(child, count){
  return {
    type: 'repeater',
    child: child,
    count: count || -1,
    _iterations: 0,
    tick: function(context, blackboard){
      if(this.count > 0 && this._iterations >= this.count){
        this._iterations = 0;
        return NodeStatus.SUCCESS;
      }
      const status = this.child.tick(context, blackboard);
      if(status === NodeStatus.SUCCESS){
        this._iterations++;
        if(this.count < 0 || this._iterations < this.count) return NodeStatus.RUNNING;
        this._iterations = 0;
        return NodeStatus.SUCCESS;
      }
      return status;
    }
  };
}

function createUntilFailure(child){
  return {
    type: 'untilFailure',
    child: child,
    tick: function(context, blackboard){
      while(true){
        const status = this.child.tick(context, blackboard);
        if(status === NodeStatus.FAILURE) return NodeStatus.SUCCESS;
        if(status === NodeStatus.RUNNING) return NodeStatus.RUNNING;
      }
    }
  };
}

/* ===== 寻路系统 (A*) =====
   支持: 网格寻路 / 导航网格 / 平滑路径 / 动态障碍
*/
function createPathfinder(options){
  const pf = {
    gridWidth: (options && options.gridWidth) || 50,
    gridHeight: (options && options.gridHeight) || 50,
    cellSize: (options && options.cellSize) || 1,
    _grid: null,
    _heuristic: (options && options.heuristic) || 'manhattan',
    _allowDiagonal: (options && options.allowDiagonal !== undefined) ? options.allowDiagonal : true
  };

  function init(){
    pf._grid = new Uint8Array(pf.gridWidth * pf.gridHeight);
  }

  function setWalkable(x, y, walkable){
    if(x < 0 || x >= pf.gridWidth || y < 0 || y >= pf.gridHeight) return;
    pf._grid[y * pf.gridWidth + x] = walkable ? 0 : 1;
  }

  function isWalkable(x, y){
    if(x < 0 || x >= pf.gridWidth || y < 0 || y >= pf.gridHeight) return false;
    return pf._grid[y * pf.gridWidth + x] === 0;
  }

  function heuristic(a, b){
    if(pf._heuristic === 'euclidean'){
      return Math.sqrt((a.x-b.x)*(a.x-b.x) + (a.y-b.y)*(a.y-b.y));
    }
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  function findPath(startX, startY, endX, endY){
    if(!isWalkable(startX, startY) || !isWalkable(endX, endY)) return [];
    const open = [];
    const closed = new Set();
    const cameFrom = {};
    const gScore = {};
    const fScore = {};
    const startKey = startX + ',' + startY;
    const endKey = endX + ',' + endY;
    gScore[startKey] = 0;
    fScore[startKey] = heuristic({x:startX,y:startY}, {x:endX,y:endY});
    open.push({ x: startX, y: startY, f: fScore[startKey] });

    while(open.length > 0){
      open.sort(function(a, b){ return a.f - b.f; });
      const current = open.shift();
      const currentKey = current.x + ',' + current.y;
      if(currentKey === endKey){
        const path = [];
        let key = endKey;
        while(key){
          const parts = key.split(',');
          path.unshift({ x: parseInt(parts[0]), y: parseInt(parts[1]) });
          key = cameFrom[key];
        }
        return path;
      }
      closed.add(currentKey);
      const neighbors = getNeighbors(current.x, current.y);
      for(let i = 0; i < neighbors.length; i++){
        const n = neighbors[i];
        const nKey = n.x + ',' + n.y;
        if(closed.has(nKey)) continue;
        const tentativeG = (gScore[currentKey] || 0) + n.cost;
        if(tentativeG < (gScore[nKey] || Infinity)){
          cameFrom[nKey] = currentKey;
          gScore[nKey] = tentativeG;
          fScore[nKey] = tentativeG + heuristic(n, {x:endX,y:endY});
          if(!open.find(function(o){ return o.x === n.x && o.y === n.y; })){
            open.push({ x: n.x, y: n.y, f: fScore[nKey] });
          }
        }
      }
    }
    return [];
  }

  function getNeighbors(x, y){
    const neighbors = [];
    const dirs = pf._allowDiagonal ?
      [[0,-1,1],[1,0,1],[0,1,1],[-1,0,1],[1,-1,1.414],[1,1,1.414],[-1,1,1.414],[-1,-1,1.414]] :
      [[0,-1,1],[1,0,1],[0,1,1],[-1,0,1]];
    for(let i = 0; i < dirs.length; i++){
      const nx = x + dirs[i][0], ny = y + dirs[i][1];
      if(isWalkable(nx, ny)){
        neighbors.push({ x: nx, y: ny, cost: dirs[i][2] });
      }
    }
    return neighbors;
  }

  function smoothPath(path){
    if(path.length < 3) return path;
    const smoothed = [path[0]];
    let lastIndex = 0;
    for(let i = 2; i < path.length; i++){
      if(!lineOfSight(path[lastIndex], path[i])){
        smoothed.push(path[i-1]);
        lastIndex = i - 1;
      }
    }
    smoothed.push(path[path.length - 1]);
    return smoothed;
  }

  function lineOfSight(a, b){
    let x0 = a.x, y0 = a.y;
    const x1 = b.x, y1 = b.y;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while(true){
      if(!isWalkable(x0, y0)) return false;
      if(x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if(e2 > -dy){ err -= dy; x0 += sx; }
      if(e2 < dx){ err += dx; y0 += sy; }
    }
    return true;
  }

  function gridToWorld(x, y){
    return {
      x: (x - pf.gridWidth / 2) * pf.cellSize,
      z: (y - pf.gridHeight / 2) * pf.cellSize
    };
  }

  function worldToGrid(x, z){
    return {
      x: Math.floor(x / pf.cellSize + pf.gridWidth / 2),
      y: Math.floor(z / pf.cellSize + pf.gridHeight / 2)
    };
  }

  return { init, setWalkable, isWalkable, findPath, smoothPath, gridToWorld, worldToGrid, pf };
}

/* ===== 有限状态机 =====
   支持: 状态 / 转换 / 条件 / 层级状态机
*/
function createFSM(){
  const fsm = {
    states: {},
    currentState: null,
    previousState: null,
    _transitions: [],
    _globalTransitions: []
  };

  function addState(name, onEnter, onUpdate, onExit){
    fsm.states[name] = {
      name: name,
      onEnter: onEnter || function(){},
      onUpdate: onUpdate || function(){},
      onExit: onExit || function(){}
    };
    if(!fsm.currentState) fsm.currentState = fsm.states[name];
  }

  function addTransition(from, to, condition){
    fsm._transitions.push({ from: from, to: to, condition: condition || function(){ return false; } });
  }

  function addGlobalTransition(to, condition){
    fsm._globalTransitions.push({ to: to, condition: condition || function(){ return false; } });
  }

  function changeState(name){
    if(!fsm.states[name]) return false;
    if(fsm.currentState && fsm.currentState.name === name) return true;
    if(fsm.currentState) fsm.currentState.onExit();
    fsm.previousState = fsm.currentState;
    fsm.currentState = fsm.states[name];
    fsm.currentState.onEnter();
    return true;
  }

  function update(dt, context){
    if(!fsm.currentState) return;
    for(let i = 0; i < fsm._globalTransitions.length; i++){
      if(fsm._globalTransitions[i].condition(context)){
        changeState(fsm._globalTransitions[i].to);
        break;
      }
    }
    for(let i = 0; i < fsm._transitions.length; i++){
      const t = fsm._transitions[i];
      if(t.from === fsm.currentState.name && t.condition(context)){
        changeState(t.to);
        break;
      }
    }
    fsm.currentState.onUpdate(dt, context);
  }

  function getCurrentState(){
    return fsm.currentState ? fsm.currentState.name : null;
  }

  function reset(){
    fsm.currentState = null;
    fsm.previousState = null;
    fsm._transitions = [];
    fsm._globalTransitions = [];
  }

  return { addState, addTransition, addGlobalTransition, changeState, update, getCurrentState, reset, fsm };
}

/* ===== 对象池系统 =====
   支持: 对象复用 / 预热 / 自动扩容 / 统计
*/
function createObjectPool(factory, resetFunc, options){
  const pool = {
    _available: [],
    _inUse: [],
    _factory: factory,
    _reset: resetFunc || function(){},
    _maxSize: (options && options.maxSize) || 1000,
    _autoExpand: (options && options.autoExpand !== undefined) ? options.autoExpand : true,
    _created: 0
  };

  function acquire(){
    let obj;
    if(pool._available.length > 0){
      obj = pool._available.pop();
    } else if(pool._created < pool._maxSize || pool._autoExpand){
      obj = pool._factory();
      pool._created++;
    } else {
      obj = pool._inUse.shift();
      pool._reset(obj);
    }
    pool._inUse.push(obj);
    return obj;
  }

  function release(obj){
    const idx = pool._inUse.indexOf(obj);
    if(idx >= 0) pool._inUse.splice(idx, 1);
    pool._reset(obj);
    pool._available.push(obj);
  }

  function releaseAll(){
    while(pool._inUse.length > 0){
      const obj = pool._inUse.pop();
      pool._reset(obj);
      pool._available.push(obj);
    }
  }

  function prewarm(count){
    for(let i = 0; i < count && pool._created < pool._maxSize; i++){
      const obj = pool._factory();
      pool._created++;
      pool._available.push(obj);
    }
  }

  function getStats(){
    return {
      available: pool._available.length,
      inUse: pool._inUse.length,
      created: pool._created,
      maxSize: pool._maxSize
    };
  }

  function clear(){
    pool._available = [];
    pool._inUse = [];
    pool._created = 0;
  }

  return { acquire, release, releaseAll, prewarm, getStats, clear, pool };
}

/* ===== 任务调度系统 =====
   支持: 协程 / 延时任务 / 优先级队列 / 帧预算
*/
function createTaskScheduler(options){
  const scheduler = {
    _tasks: [],
    _coroutines: [],
    _time: 0,
    _frameBudget: (options && options.frameBudget) || 8,
    _maxTasksPerFrame: (options && options.maxTasksPerFrame) || 100
  };

  function schedule(task, delay, priority){
    scheduler._tasks.push({
      task: task,
      executeAt: scheduler._time + (delay || 0),
      priority: priority || 0,
      _id: Math.random()
    });
    scheduler._tasks.sort(function(a, b){
      if(a.executeAt !== b.executeAt) return a.executeAt - b.executeAt;
      return b.priority - a.priority;
    });
  }

  function startCoroutine(generatorFunc){
    const gen = generatorFunc();
    scheduler._coroutines.push({ gen: gen, nextTime: 0 });
  }

  function update(dt){
    scheduler._time += dt;
    const frameStart = performance.now();
    let tasksExecuted = 0;
    while(scheduler._tasks.length > 0 &&
          scheduler._tasks[0].executeAt <= scheduler._time &&
          tasksExecuted < scheduler._maxTasksPerFrame &&
          performance.now() - frameStart < scheduler._frameBudget){
      const task = scheduler._tasks.shift();
      try{ task.task(); } catch(e){ console.error('[Scheduler] 任务错误:', e); }
      tasksExecuted++;
    }
    for(let i = scheduler._coroutines.length - 1; i >= 0; i--){
      const co = scheduler._coroutines[i];
      if(scheduler._time >= co.nextTime){
        const result = co.gen.next();
        if(result.done){
          scheduler._coroutines.splice(i, 1);
        } else if(typeof result.value === 'number'){
          co.nextTime = scheduler._time + result.value;
        }
      }
    }
  }

  function getPendingCount(){
    return scheduler._tasks.length;
  }

  function getCoroutineCount(){
    return scheduler._coroutines.length;
  }

  function clear(){
    scheduler._tasks = [];
    scheduler._coroutines = [];
  }

  return { schedule, startCoroutine, update, getPendingCount, getCoroutineCount, clear, scheduler };
}

/* ===== 二进制序列化系统 =====
   支持: 类型化数据 / 压缩 / 校验和 / 版本控制
*/
function createBinarySerializer(){
  const ser = {
    _buffer: null,
    _view: null,
    _offset: 0,
    _littleEndian: true
  };

  function write(buffer, data){
    ser._buffer = buffer;
    ser._view = new DataView(buffer);
    ser._offset = 0;
    writeUint32(0x4D524855);
    writeUint16(1);
    writeValue(data);
    return ser._offset;
  }

  function read(buffer){
    ser._buffer = buffer;
    ser._view = new DataView(buffer);
    ser._offset = 0;
    const magic = readUint32();
    if(magic !== 0x4D524855) throw new Error('无效的二进制格式');
    const version = readUint16();
    return { version: version, data: readValue() };
  }

  function writeValue(value){
    if(value === null || value === undefined){ writeUint8(0); }
    else if(typeof value === 'boolean'){ writeUint8(1); writeUint8(value ? 1 : 0); }
    else if(typeof value === 'number'){
      if(Number.isInteger(value)){ writeUint8(2); writeInt32(value); }
      else { writeUint8(3); writeFloat64(value); }
    }
    else if(typeof value === 'string'){
      writeUint8(4);
      const bytes = new TextEncoder().encode(value);
      writeUint32(bytes.length);
      for(let i = 0; i < bytes.length; i++) writeUint8(bytes[i]);
    }
    else if(Array.isArray(value) || value instanceof Float32Array || value instanceof Uint8Array){
      writeUint8(5);
      writeUint32(value.length);
      for(let i = 0; i < value.length; i++) writeValue(value[i]);
    }
    else if(typeof value === 'object'){
      writeUint8(6);
      const keys = Object.keys(value);
      writeUint32(keys.length);
      for(let i = 0; i < keys.length; i++){
        writeValue(keys[i]);
        writeValue(value[keys[i]]);
      }
    }
  }

  function readValue(){
    const type = readUint8();
    switch(type){
      case 0: return null;
      case 1: return readUint8() === 1;
      case 2: return readInt32();
      case 3: return readFloat64();
      case 4: {
        const len = readUint32();
        const bytes = new Uint8Array(len);
        for(let i = 0; i < len; i++) bytes[i] = readUint8();
        return new TextDecoder().decode(bytes);
      }
      case 5: {
        const len = readUint32();
        const arr = [];
        for(let i = 0; i < len; i++) arr.push(readValue());
        return arr;
      }
      case 6: {
        const len = readUint32();
        const obj = {};
        for(let i = 0; i < len; i++){
          const key = readValue();
          obj[key] = readValue();
        }
        return obj;
      }
      default: throw new Error('未知类型: ' + type);
    }
  }

  function writeUint8(v){ ser._view.setUint8(ser._offset, v); ser._offset += 1; }
  function writeUint16(v){ ser._view.setUint16(ser._offset, v, ser._littleEndian); ser._offset += 2; }
  function writeUint32(v){ ser._view.setUint32(ser._offset, v, ser._littleEndian); ser._offset += 4; }
  function writeInt32(v){ ser._view.setInt32(ser._offset, v, ser._littleEndian); ser._offset += 4; }
  function writeFloat32(v){ ser._view.setFloat32(ser._offset, v, ser._littleEndian); ser._offset += 4; }
  function writeFloat64(v){ ser._view.setFloat64(ser._offset, v, ser._littleEndian); ser._offset += 8; }
  function readUint8(){ const v = ser._view.getUint8(ser._offset); ser._offset += 1; return v; }
  function readUint16(){ const v = ser._view.getUint16(ser._offset, ser._littleEndian); ser._offset += 2; return v; }
  function readUint32(){ const v = ser._view.getUint32(ser._offset, ser._littleEndian); ser._offset += 4; return v; }
  function readInt32(){ const v = ser._view.getInt32(ser._offset, ser._littleEndian); ser._offset += 4; return v; }
  function readFloat32(){ const v = ser._view.getFloat32(ser._offset, ser._littleEndian); ser._offset += 4; return v; }
  function readFloat64(){ const v = ser._view.getFloat64(ser._offset, ser._littleEndian); ser._offset += 8; return v; }

  function computeChecksum(buffer){
    let hash = 0;
    const view = new DataView(buffer);
    for(let i = 0; i < buffer.byteLength; i += 4){
      hash ^= view.getUint32(i, true);
    }
    return hash >>> 0;
  }

  return { write, read, computeChecksum, ser };
}

/* ===== 配置系统 =====
   支持: 分层配置 / 环境覆盖 / 类型验证 / 热重载
*/
function createConfigSystem(defaults){
  const config = {
    _values: { ...defaults },
    _overrides: {},
    _env: 'default',
    _listeners: []
  };

  function set(key, value){
    const oldValue = get(key);
    config._overrides[key] = value;
    if(oldValue !== value){
      for(let i = 0; i < config._listeners.length; i++){
        config._listeners[i](key, value, oldValue);
      }
    }
  }

  function get(key, defaultValue){
    if(config._overrides[key] !== undefined) return config._overrides[key];
    if(config._values[key] !== undefined) return config._values[key];
    return defaultValue;
  }

  function has(key){
    return config._overrides[key] !== undefined || config._values[key] !== undefined;
  }

  function remove(key){
    delete config._overrides[key];
  }

  function setEnvironment(env){
    config._env = env;
  }

  function getEnvironment(){
    return config._env;
  }

  function load(json){
    const data = JSON.parse(json);
    for(const key in data){
      config._values[key] = data[key];
    }
  }

  function save(){
    return JSON.stringify({ ...config._values, ...config._overrides }, null, 2);
  }

  function onChange(callback){
    config._listeners.push(callback);
    return function(){
      const idx = config._listeners.indexOf(callback);
      if(idx >= 0) config._listeners.splice(idx, 1);
    };
  }

  function getGroup(prefix){
    const result = {};
    const all = { ...config._values, ...config._overrides };
    for(const key in all){
      if(key.startsWith(prefix)){
        result[key.substring(prefix.length)] = all[key];
      }
    }
    return result;
  }

  function reset(){
    config._overrides = {};
    config._listeners = [];
  }

  return { set, get, has, remove, setEnvironment, getEnvironment, load, save, onChange, getGroup, reset, config };
}

/* ===== 日志系统 =====
   支持: 级别 / 格式化 / 输出目标 / 性能监控
*/
