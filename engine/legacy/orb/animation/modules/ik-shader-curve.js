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
