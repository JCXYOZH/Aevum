/**
 * MrHua 3D灵体渲染引擎 - 扩展模块: orb-extension-splines
 * 从 legacy/_orb_expand_part1.js 转换 (GBK->UTF-8)
 * @module orb-extension-splines
 */
'use strict';



/* ===== 样条曲线与路径系统=====
   支持: 贝塞尔曲面/ Catmull-Rom / B样条 / NURBS简化/ 路径跟随
*/
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
   支持: 状态/ 过渡 / 条件 / 层级 / 遮罩 / 混合树*/
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
   基于引导线插值的头发渲染, 支持物理模拟和样条*/
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
   替代线性混合蒙皮LBS), 消除糖果包装效应
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
