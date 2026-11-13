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
