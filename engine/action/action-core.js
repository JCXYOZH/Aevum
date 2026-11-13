/**
 * Aevum 人形动作：骨骼、蒙皮矩阵、IK、动画混合、动作图、布娃娃、表情、手势、移动、状态机。
 */
/**
 * 人形动作引擎 - 骨骼/IK/动画混合/运动图/布娃娃/面部/手势/移动/状态机
 * 纯自研，零依赖
 * @version 2.0.0
 */
'use strict';

const ActionCore = (function () {

  // ============================================================
  // 骨骼系统
  // ============================================================
  class Bone {
    constructor(name, index) {
      this.name = name;
      this.index = index;
      this.parent = -1;
      this.children = [];
      this.position = [0, 0, 0];
      this.rotation = [0, 0, 0, 1];
      this.scale = [1, 1, 1];
      this.restPosition = [0, 0, 0];
      this.restRotation = [0, 0, 0, 1];
      this.inverseBindMatrix = new Float32Array(16);
      this.localMatrix = new Float32Array(16);
      this.worldMatrix = new Float32Array(16);
      this.offsetMatrix = new Float32Array(16);
      this.ik = null;
      this.physics = null;
      this.morph = null;
      this.visible = true;
      this.userData = {};
    }

    setPosition(x, y, z) { this.position[0] = x; this.position[1] = y; this.position[2] = z; }
    setRotation(x, y, z, w) { this.rotation[0] = x; this.rotation[1] = y; this.rotation[2] = z; this.rotation[3] = w; }
    setScale(x, y, z) { this.scale[0] = x; this.scale[1] = y; this.scale[2] = z; }
    reset() { this.position.set(this.restPosition); this.rotation.set(this.restRotation); this.scale.set([1,1,1]); }
  }

  class SkeletonSystem {
    constructor() {
      this.bones = [];
      this.boneMap = new Map();
      this.rootBones = [];
      this.boneMatrices = null;
      this.boneCount = 0;
      this.ikChains = [];
      this.initialized = false;
    }

    buildFromBones(boneData) {
      this.bones = [];
      this.boneMap.clear();
      this.rootBones = [];
      for (let i = 0; i < boneData.length; i++) {
        const data = boneData[i];
        const bone = new Bone(data.name || `bone_${i}`, i);
        const parent = Number(data.parent);
        bone.parent = Number.isInteger(parent) && parent >= 0 && parent < boneData.length && parent !== i ? parent : -1;
        bone.position = data.position || [0,0,0];
        bone.rotation = data.rotation || [0,0,0,1];
        bone.restPosition = [...bone.position];
        bone.restRotation = [...bone.rotation];
        if (data.inverseBindMatrix) bone.inverseBindMatrix.set(data.inverseBindMatrix);
        if (data.ik) bone.ik = data.ik;
        this.bones.push(bone);
        this.boneMap.set(bone.name, i);
      }
      for (let i = 0; i < this.bones.length; i++) {
        const bone = this.bones[i];
        if (bone.parent >= 0) this.bones[bone.parent].children.push(i);
        else this.rootBones.push(i);
      }
      this.boneCount = this.bones.length;
      this.boneMatrices = new Float32Array(this.boneCount * 16);
      this._computeInverseBindMatrices();
      this.initialized = true;
      return this;
    }

    _computeInverseBindMatrices() {
      for (const rootIdx of this.rootBones) this._computeBoneMatrix(rootIdx);
      for (let i = 0; i < this.bones.length; i++) {
        const bone = this.bones[i];
        this._invertMatrix(bone.inverseBindMatrix, bone.worldMatrix);
      }
    }

    _computeBoneMatrix(index) {
      const bone = this.bones[index];
      this._composeMatrix(bone.localMatrix, bone.position, bone.rotation, bone.scale);
      if (bone.parent >= 0) {
        this._multiplyMatrix(bone.worldMatrix, this.bones[bone.parent].worldMatrix, bone.localMatrix);
      } else {
        bone.worldMatrix.set(bone.localMatrix);
      }
      for (const child of bone.children) this._computeBoneMatrix(child);
    }

    update() {
      for (const rootIdx of this.rootBones) this._updateBone(rootIdx);
      for (let i = 0; i < this.bones.length; i++) {
        const bone = this.bones[i];
        this._multiplyMatrix(this.boneMatrices.subarray(i*16, i*16+16), bone.worldMatrix, bone.inverseBindMatrix);
      }
    }

    _updateBone(index) {
      const bone = this.bones[index];
      this._composeMatrix(bone.localMatrix, bone.position, bone.rotation, bone.scale);
      if (bone.parent >= 0) {
        this._multiplyMatrix(bone.worldMatrix, this.bones[bone.parent].worldMatrix, bone.localMatrix);
      } else {
        bone.worldMatrix.set(bone.localMatrix);
      }
      for (const child of bone.children) this._updateBone(child);
    }

    getBone(name) { const idx = this.boneMap.get(name); return idx !== undefined ? this.bones[idx] : null; }
    getBoneIndex(name) { return this.boneMap.get(name); }
    getBoneMatrix(index) { return this.boneMatrices.subarray(index * 16, index * 16 + 16); }
    getBoneWorldPosition(index) { const m = this.bones[index].worldMatrix; return [m[12], m[13], m[14]]; }
    getBoneWorldRotation(index) { return this._matrixToQuat(this.bones[index].worldMatrix); }

    setBonePosition(name, x, y, z) { const bone = this.getBone(name); if (bone) bone.setPosition(x, y, z); }
    setBoneRotation(name, x, y, z, w) { const bone = this.getBone(name); if (bone) bone.setRotation(x, y, z, w); }
    resetBone(name) { const bone = this.getBone(name); if (bone) bone.reset(); }
    resetAll() { for (const bone of this.bones) bone.reset(); }

    _composeMatrix(out, pos, rot, scale) {
      const x = rot[0], y = rot[1], z = rot[2], w = rot[3];
      const x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2;
      const yy = y * y2, yz = y * z2, zz = z * z2;
      const wx = w * x2, wy = w * y2, wz = w * z2;
      const sx = scale[0], sy = scale[1], sz = scale[2];
      out[0] = (1 - (yy + zz)) * sx; out[1] = (xy + wz) * sx; out[2] = (xz - wy) * sx; out[3] = 0;
      out[4] = (xy - wz) * sy; out[5] = (1 - (xx + zz)) * sy; out[6] = (yz + wx) * sy; out[7] = 0;
      out[8] = (xz + wy) * sz; out[9] = (yz - wx) * sz; out[10] = (1 - (xx + yy)) * sz; out[11] = 0;
      out[12] = pos[0]; out[13] = pos[1]; out[14] = pos[2]; out[15] = 1;
    }

    _multiplyMatrix(out, a, b) {
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        out[i*4+j] = a[i*4]*b[j] + a[i*4+1]*b[4+j] + a[i*4+2]*b[8+j] + a[i*4+3]*b[12+j];
      }
    }

    _invertMatrix(out, a) {
      const a00=a[0],a01=a[1],a02=a[2],a03=a[3],a10=a[4],a11=a[5],a12=a[6],a13=a[7];
      const a20=a[8],a21=a[9],a22=a[10],a23=a[11],a30=a[12],a31=a[13],a32=a[14],a33=a[15];
      const b00=a00*a11-a01*a10,b01=a00*a12-a02*a10,b02=a00*a13-a03*a10;
      const b03=a01*a12-a02*a11,b04=a01*a13-a03*a11,b05=a02*a13-a03*a12;
      const b06=a20*a31-a21*a30,b07=a20*a32-a22*a30,b08=a20*a33-a23*a30;
      const b09=a21*a32-a22*a31,b10=a21*a33-a23*a31,b11=a22*a33-a23*a32;
      let det=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
      if(!det) return;
      det=1/det;
      out[0]=(a11*b11-a12*b10+a13*b09)*det;
      out[1]=(a02*b10-a01*b11-a03*b09)*det;
      out[2]=(a31*b05-a32*b04+a33*b03)*det;
      out[3]=(a22*b04-a21*b05-a23*b03)*det;
      out[4]=(a12*b08-a10*b11-a13*b07)*det;
      out[5]=(a00*b11-a02*b08+a03*b07)*det;
      out[6]=(a32*b02-a30*b05-a33*b01)*det;
      out[7]=(a20*b05-a22*b02+a23*b01)*det;
      out[8]=(a10*b10-a11*b08+a13*b06)*det;
      out[9]=(a01*b08-a00*b10-a03*b06)*det;
      out[10]=(a30*b04-a31*b02+a33*b00)*det;
      out[11]=(a21*b02-a20*b04-a23*b00)*det;
      out[12]=(a11*b07-a10*b09-a12*b06)*det;
      out[13]=(a00*b09-a01*b07+a02*b06)*det;
      out[14]=(a31*b01-a30*b03-a32*b00)*det;
      out[15]=(a20*b03-a21*b01+a22*b00)*det;
    }

    _matrixToQuat(m) {
      const trace = m[0] + m[5] + m[10];
      let x, y, z, w;
      if (trace > 0) {
        const s = 0.5 / Math.sqrt(trace + 1);
        w = 0.25 / s; x = (m[6] - m[9]) * s; y = (m[8] - m[2]) * s; z = (m[1] - m[4]) * s;
      } else if (m[0] > m[5] && m[0] > m[10]) {
        const s = 2 * Math.sqrt(1 + m[0] - m[5] - m[10]);
        w = (m[6] - m[9]) / s; x = 0.25 * s; y = (m[4] + m[1]) / s; z = (m[8] + m[2]) / s;
      } else if (m[5] > m[10]) {
        const s = 2 * Math.sqrt(1 + m[5] - m[0] - m[10]);
        w = (m[8] - m[2]) / s; x = (m[4] + m[1]) / s; y = 0.25 * s; z = (m[9] + m[6]) / s;
      } else {
        const s = 2 * Math.sqrt(1 + m[10] - m[0] - m[5]);
        w = (m[1] - m[4]) / s; x = (m[8] + m[2]) / s; y = (m[9] + m[6]) / s; z = 0.25 * s;
      }
      return [x, y, z, w];
    }
  }

  // ============================================================
  // IK求解器
  // ============================================================
  class IKSolver {
    constructor() {
      this.maxIterations = 20;
      this.threshold = 0.001;
      this.damping = 0.85;
    }

    solveCCD(bones, chain, target, poleVector = null) {
      if (!Array.isArray(bones) || !Array.isArray(chain) || chain.length < 2) return;
      if (!chain.every(i => Number.isInteger(i) && i >= 0 && i < bones.length)) return;
      if (!Array.isArray(target) || target.length < 3 || !target.every(Number.isFinite)) return;
      const endEffector = bones[chain[chain.length - 1]];
      for (let iter = 0; iter < this.maxIterations; iter++) {
        for (let i = chain.length - 2; i >= 0; i--) {
          const bone = bones[chain[i]];
          const bonePos = this._getWorldPosition(bones, chain[i]);
          const endPos = this._getWorldPosition(bones, chain[chain.length - 1]);
          const toEnd = this._sub(endPos, bonePos);
          const toTarget = this._sub(target, bonePos);
          const len1 = this._length(toEnd), len2 = this._length(toTarget);
          if (len1 < 1e-6 || len2 < 1e-6) continue;
          const dot = this._dot(toEnd, toTarget) / (len1 * len2);
          const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
          if (Math.abs(angle) < this.threshold) continue;
          const axis = this._normalize(this._cross(toEnd, toTarget));
          const q = this._axisAngleToQuat(axis, angle * this.damping);
          bone.rotation = this._multiplyQuat(q, bone.rotation);
          if (poleVector) this._constrainToPole(bones, chain[i], bonePos, poleVector);
        }
        const newEndPos = this._getWorldPosition(bones, chain[chain.length - 1]);
        if (this._distance(newEndPos, target) < this.threshold) break;
      }
    }

    solveFABRIK(bones, chain, target) {
      if (!Array.isArray(bones) || !Array.isArray(chain) || chain.length < 2) return;
      if (!chain.every(i => Number.isInteger(i) && i >= 0 && i < bones.length)) return;
      if (!Array.isArray(target) || target.length < 3 || !target.every(Number.isFinite)) return;
      const positions = chain.map(i => this._getWorldPosition(bones, i));
      const lengths = [];
      for (let i = 0; i < chain.length - 1; i++) lengths.push(this._distance(positions[i], positions[i+1]));
      for (let iter = 0; iter < this.maxIterations; iter++) {
        positions[positions.length - 1] = [...target];
        for (let i = positions.length - 2; i >= 0; i--) {
          const dir = this._normalize(this._sub(positions[i], positions[i+1]));
          positions[i] = this._add(positions[i+1], this._scale(dir, lengths[i]));
        }
        for (let i = 1; i < positions.length; i++) {
          const dir = this._normalize(this._sub(positions[i], positions[i-1]));
          positions[i] = this._add(positions[i-1], this._scale(dir, lengths[i-1]));
        }
        if (this._distance(positions[positions.length-1], target) < this.threshold) break;
      }
      for (let i = 0; i < chain.length - 1; i++) {
        const bone = bones[chain[i]];
        const nextPos = positions[i+1];
        const bonePos = positions[i];
        const dir = this._normalize(this._sub(nextPos, bonePos));
        const targetQuat = this._lookRotation(dir);
        bone.rotation = targetQuat;
      }
    }

    solveTwoBone(bones, upper, lower, end, target, bendDir = null) {
      if (!Array.isArray(bones)) return;
      if (![upper, lower, end].every(i => Number.isInteger(i) && i >= 0 && i < bones.length)) return;
      if (!Array.isArray(target) || target.length < 3 || !target.every(Number.isFinite)) return;
      const upperBone = bones[upper], lowerBone = bones[lower];
      const upperPos = this._getWorldPosition(bones, upper);
      const lowerPos = this._getWorldPosition(bones, lower);
      const endPos = this._getWorldPosition(bones, end);
      const lenUpper = this._distance(upperPos, lowerPos);
      const lenLower = this._distance(lowerPos, endPos);
      const dist = Math.min(this._distance(upperPos, target), lenUpper + lenLower - 0.001);
      const cosAngle = (lenUpper*lenUpper + dist*dist - lenLower*lenLower) / (2 * lenUpper * dist);
      const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
      const toTarget = this._normalize(this._sub(target, upperPos));
      let axis;
      if (bendDir) {
        axis = this._normalize(this._cross(toTarget, bendDir));
      } else {
        const currentDir = this._normalize(this._sub(lowerPos, upperPos));
        axis = this._normalize(this._cross(currentDir, toTarget));
        if (this._length(axis) < 0.01) axis = [0, 0, 1];
      }
      const q1 = this._axisAngleToQuat(axis, angle);
      const dir1 = this._normalize(this._sub(this._rotateVector(toTarget, q1), [0,0,0]));
      upperBone.rotation = this._lookRotation(dir1);
      const newLowerPos = this._add(upperPos, this._scale(dir1, lenUpper));
      const toEnd = this._normalize(this._sub(target, newLowerPos));
      lowerBone.rotation = this._lookRotation(toEnd);
    }

    _getWorldPosition(bones, index) {
      const m = bones[index].worldMatrix;
      return [m[12], m[13], m[14]];
    }
    _sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
    _add(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
    _scale(v, s) { return [v[0]*s, v[1]*s, v[2]*s]; }
    _dot(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
    _cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
    _length(v) { return Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]); }
    _normalize(v) { const l = this._length(v)||1; return [v[0]/l, v[1]/l, v[2]/l]; }
    _distance(a, b) { return this._length(this._sub(a, b)); }
    _multiplyQuat(a, b) {
      return [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1], a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
              a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3], a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
    }
    _axisAngleToQuat(axis, angle) {
      const s = Math.sin(angle/2);
      return [axis[0]*s, axis[1]*s, axis[2]*s, Math.cos(angle/2)];
    }
    _lookRotation(forward) {
      const f = this._normalize(forward);
      const up = Math.abs(f[1]) > 0.99 ? [1,0,0] : [0,1,0];
      const right = this._normalize(this._cross(up, f));
      const u = this._cross(f, right);
      const m = [right[0],right[1],right[2],0, u[0],u[1],u[2],0, f[0],f[1],f[2],0, 0,0,0,1];
      const trace = m[0]+m[5]+m[10];
      if (trace > 0) { const s=0.5/Math.sqrt(trace+1); return [(m[6]-m[9])*s,(m[8]-m[2])*s,(m[1]-m[4])*s,0.25/s]; }
      if (m[0]>m[5]&&m[0]>m[10]) { const s=2*Math.sqrt(1+m[0]-m[5]-m[10]); return [0.25*s,(m[4]+m[1])/s,(m[8]+m[2])/s,(m[6]-m[9])/s]; }
      if (m[5]>m[10]) { const s=2*Math.sqrt(1+m[5]-m[0]-m[10]); return [(m[4]+m[1])/s,0.25*s,(m[9]+m[6])/s,(m[8]-m[2])/s]; }
      const s=2*Math.sqrt(1+m[10]-m[0]-m[5]); return [(m[8]+m[2])/s,(m[9]+m[6])/s,0.25*s,(m[1]-m[4])/s];
    }
    _rotateVector(v, q) {
      const [x,y,z,w] = q;
      const t = 2*(x*v[0]+y*v[1]+z*v[2]);
      return [v[0]+t*x+(w*w-x*x-y*y-z*z)*v[0]+2*(w*y*v[2]-w*z*v[1]),
              v[1]+t*y+(w*w-x*x-y*y-z*z)*v[1]+2*(w*z*v[0]-w*x*v[2]),
              v[2]+t*z+(w*w-x*x-y*y-z*z)*v[2]+2*(w*x*v[1]-w*y*v[0])];
    }
    _constrainToPole(bones, index, bonePos, pole) { /* 极向量约束 */ }
  }

  // ============================================================
  // 动画混合器
  // ============================================================
  class AnimationBlender {
    constructor(skeleton) {
      this.skeleton = skeleton;
      this.layers = [];
      this.currentAnimation = null;
      this.blendTime = 0.3;
      this.blendProgress = 1;
      this.prevAnimation = null;
      this.additiveAnimations = [];
      this.timeScale = 1;
    }

    play(animation, blendTime = 0.3) {
      if (!animation) return;
      if (this.currentAnimation === animation) return;
      this.prevAnimation = this.currentAnimation ? { ...this.currentAnimation, time: this.currentAnimation.time } : null;
      this.currentAnimation = { clip: animation, time: 0, weight: 1 };
      this.blendTime = blendTime;
      this.blendProgress = 0;
    }

    addAdditive(animation, weight = 0.5) {
      this.additiveAnimations.push({ clip: animation, time: 0, weight, active: true });
    }

    removeAdditive(animation) {
      const idx = this.additiveAnimations.findIndex(a => a.clip === animation);
      if (idx !== -1) this.additiveAnimations.splice(idx, 1);
    }

    update(dt) {
      if (!this.currentAnimation) return;
      this.currentAnimation.time += dt * this.timeScale;
      if (this.blendProgress < 1) {
        this.blendProgress = Math.min(1, this.blendProgress + dt / this.blendTime);
      }
      for (const add of this.additiveAnimations) {
        if (add.active) add.time += dt * this.timeScale;
      }
      this._applyAnimation();
    }

    _applyAnimation() {
      const clip = this.currentAnimation.clip;
      const t = this.currentAnimation.time % clip.duration;
      for (const boneName in clip.tracks) {
        const track = clip.tracks[boneName];
        const bone = this.skeleton.getBone(boneName);
        if (!bone) continue;
        const pos = this._sampleVector(track.position, t);
        const rot = this._sampleQuat(track.rotation, t);
        if (this.prevAnimation && this.blendProgress < 1) {
          const prevTrack = this.prevAnimation.clip.tracks[boneName];
          if (prevTrack) {
            const prevPos = this._sampleVector(prevTrack.position, this.prevAnimation.time);
            const prevRot = this._sampleQuat(prevTrack.rotation, this.prevAnimation.time);
            const w = this.blendProgress;
            bone.position = [prevPos[0]+(pos[0]-prevPos[0])*w, prevPos[1]+(pos[1]-prevPos[1])*w, prevPos[2]+(pos[2]-prevPos[2])*w];
            bone.rotation = this._slerp(prevRot, rot, w);
          } else { bone.position = pos; bone.rotation = rot; }
        } else { bone.position = pos; bone.rotation = rot; }
        for (const add of this.additiveAnimations) {
          const addTrack = add.clip.tracks[boneName];
          if (addTrack && add.active) {
            const addRot = this._sampleQuat(addTrack.rotation, add.time);
            bone.rotation = this._multiplyQuat(bone.rotation, this._scaleQuat(addRot, add.weight));
          }
        }
      }
    }

    _sampleVector(track, time) {
      if (!track || track.times.length === 0) return [0,0,0];
      const { times, values } = track;
      if (time <= times[0]) return values[0];
      if (time >= times[times.length-1]) return values[values.length-1];
      for (let i = 0; i < times.length - 1; i++) {
        if (time >= times[i] && time <= times[i+1]) {
          const t = (time - times[i]) / (times[i+1] - times[i]);
          return [values[i][0]+(values[i+1][0]-values[i][0])*t, values[i][1]+(values[i+1][1]-values[i][1])*t, values[i][2]+(values[i+1][2]-values[i][2])*t];
        }
      }
      return values[values.length-1];
    }

    _sampleQuat(track, time) {
      if (!track || track.times.length === 0) return [0,0,0,1];
      const { times, values } = track;
      if (time <= times[0]) return values[0];
      if (time >= times[times.length-1]) return values[values.length-1];
      for (let i = 0; i < times.length - 1; i++) {
        if (time >= times[i] && time <= times[i+1]) {
          const t = (time - times[i]) / (times[i+1] - times[i]);
          return this._slerp(values[i], values[i+1], t);
        }
      }
      return values[values.length-1];
    }

    _slerp(a, b, t) {
      let dot = a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];
      let b2 = [...b];
      if (dot < 0) { b2 = b2.map(v => -v); dot = -dot; }
      if (dot > 0.9995) return a.map((v,i) => v + (b2[i]-v)*t);
      const theta0 = Math.acos(dot), theta = theta0 * t;
      const sinTheta = Math.sin(theta), sinTheta0 = Math.sin(theta0);
      const s0 = Math.cos(theta) - dot * sinTheta / sinTheta0, s1 = sinTheta / sinTheta0;
      return a.map((v,i) => v*s0 + b2[i]*s1);
    }

    _multiplyQuat(a, b) {
      return [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1], a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
              a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3], a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
    }
    _scaleQuat(q, s) { const l = Math.sqrt(q[0]*q[0]+q[1]*q[1]+q[2]*q[2]+q[3]*q[3])||1; const angle = 2*Math.acos(Math.min(1,q[3]/l)); const na = angle*s; const ratio = Math.sin(na/2)/Math.sin(angle/2); return [q[0]*ratio,q[1]*ratio,q[2]*ratio,Math.cos(na/2)]; }

    stop() { this.currentAnimation = null; this.prevAnimation = null; this.additiveAnimations = []; }
    getCurrentTime() { return this.currentAnimation ? this.currentAnimation.time : 0; }
    setTimeScale(s) { this.timeScale = s; }
  }

  // ============================================================
  // 运动图
  // ============================================================
  class MotionGraph {
    constructor() {
      this.states = new Map();
      this.transitions = new Map();
      this.currentState = null;
      this.parameters = new Map();
      this.stateTime = 0;
    }

    addState(name, animation, options = {}) {
      this.states.set(name, { animation, speed: options.speed || 1, loop: options.loop !== false, exitTime: options.exitTime || 0 });
      if (!this.currentState) this.currentState = name;
    }

    addTransition(from, to, condition, options = {}) {
      const key = `${from}->${to}`;
      this.transitions.set(key, { from, to, condition, duration: options.duration || 0.2, hasExitTime: options.hasExitTime || false, exitTime: options.exitTime || 0 });
    }

    setParameter(name, value) { this.parameters.set(name, value); this._checkTransitions(); }
    getParameter(name) { return this.parameters.get(name); }

    setState(name) {
      if (!this.states.has(name)) return;
      this.currentState = name;
      this.stateTime = 0;
    }

    update(dt, blender) {
      this.stateTime += dt;
      const state = this.states.get(this.currentState);
      if (state) {
        if (state.loop && this.stateTime >= state.animation.duration) this.stateTime = 0;
        if (!state.loop && this.stateTime >= state.animation.duration) this._checkTransitions(true);
      }
      this._checkTransitions();
    }

    _checkTransitions(forceExit = false) {
      for (const [key, trans] of this.transitions) {
        if (trans.from !== this.currentState) continue;
        let canTransition = trans.condition(this.parameters);
        if (trans.hasExitTime && this.stateTime < trans.exitTime) canTransition = false;
        if (forceExit && !canTransition) canTransition = true;
        if (canTransition) {
          this.currentState = trans.to;
          this.stateTime = 0;
          return;
        }
      }
    }

    getCurrentState() { return this.currentState; }
    getStateAnimation() { return this.states.get(this.currentState)?.animation; }
    reset() { this.currentState = this.states.keys().next().value; this.stateTime = 0; this.parameters.clear(); }
  }

  // ============================================================
  // 布娃娃物理
  // ============================================================
  class RagdollPhysics {
    constructor(skeleton) {
      this.skeleton = skeleton;
      this.joints = [];
      this.active = false;
      this.gravity = [0, -9.8, 0];
      this.damping = 0.98;
      this.iterations = 8;
      this.groundY = 0;
    }

    init(config) {
      this.joints = [];
      for (const item of config) {
        this.joints.push({
          boneIndex: item.boneIndex,
          position: [...item.position],
          prevPosition: [...item.position],
          velocity: [0,0,0],
          mass: item.mass || 1,
          radius: item.radius || 0.1,
          pinned: item.pinned || false
        });
      }
      this.constraints = config.map((item, i) => item.connections ? item.connections.map(c => ({ a: i, b: this.joints.findIndex(j => j.boneIndex === c), rest: 0 })) : []).flat();
      for (const c of this.constraints) {
        c.rest = this._distance(this.joints[c.a].position, this.joints[c.b].position);
      }
    }

    update(dt) {
      if (!this.active) return;
      for (const joint of this.joints) {
        if (joint.pinned) continue;
        joint.velocity[0] = (joint.position[0] - joint.prevPosition[0]) * this.damping;
        joint.velocity[1] = (joint.position[1] - joint.prevPosition[1]) * this.damping;
        joint.velocity[2] = (joint.position[2] - joint.prevPosition[2]) * this.damping;
        joint.prevPosition = [...joint.position];
        joint.position[0] += joint.velocity[0] + this.gravity[0] * dt * dt;
        joint.position[1] += joint.velocity[1] + this.gravity[1] * dt * dt;
        joint.position[2] += joint.velocity[2] + this.gravity[2] * dt * dt;
        if (joint.position[1] < this.groundY + joint.radius) {
          joint.position[1] = this.groundY + joint.radius;
          joint.velocity[1] *= -0.3;
        }
      }
      for (let iter = 0; iter < this.iterations; iter++) {
        for (const c of this.constraints) {
          const a = this.joints[c.a], b = this.joints[c.b];
          const delta = this._sub(b.position, a.position);
          const dist = this._length(delta) || 0.001;
          const diff = (dist - c.rest) / dist;
          if (!a.pinned) { a.position[0] += delta[0]*0.5*diff; a.position[1] += delta[1]*0.5*diff; a.position[2] += delta[2]*0.5*diff; }
          if (!b.pinned) { b.position[0] -= delta[0]*0.5*diff; b.position[1] -= delta[1]*0.5*diff; b.position[2] -= delta[2]*0.5*diff; }
        }
      }
      for (const joint of this.joints) {
        const bone = this.skeleton.bones[joint.boneIndex];
        if (bone) bone.position = [...joint.position];
      }
    }

    applyForce(jointIndex, force) {
      const joint = this.joints[jointIndex];
      if (joint && !joint.pinned) {
        joint.position[0] += force[0] / joint.mass;
        joint.position[1] += force[1] / joint.mass;
        joint.position[2] += force[2] / joint.mass;
      }
    }

    setActive(v) { this.active = v; }
    _sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
    _length(v){return Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);}
    _distance(a,b){return this._length(this._sub(a,b));}
  }

  // ============================================================
  // 面部动画系统
  // ============================================================
  class FacialAnimation {
    constructor(model) {
      this.model = model;
      this.morphWeights = new Map();
      this.expressions = new Map();
      this.currentExpression = null;
      this.expressionWeight = 0;
      this.blinkTimer = 0;
      this.blinkInterval = 3;
      this.isBlinking = false;
      this.lipSyncValues = { a: 0, i: 0, u: 0, e: 0, o: 0 };
    }

    setMorph(name, weight) { this.morphWeights.set(name, weight); }
    getMorph(name) { return this.morphWeights.get(name) || 0; }

    addExpression(name, morphs) { this.expressions.set(name, morphs); }

    playExpression(name, weight = 1, duration = 0.5) {
      this.currentExpression = name;
      this.targetExpressionWeight = weight;
      this.expressionDuration = duration;
      this.expressionTimer = 0;
    }

    update(dt) {
      this.blinkTimer += dt;
      if (this.blinkTimer > this.blinkInterval && !this.isBlinking) {
        this.isBlinking = true;
        this.blinkTimer = 0;
      }
      if (this.isBlinking) {
        const blinkPhase = this.blinkTimer / 0.15;
        if (blinkPhase >= 1) { this.isBlinking = false; this.setMorph('まばたき', 0); }
        else { const w = blinkPhase < 0.5 ? blinkPhase * 2 : (1 - blinkPhase) * 2; this.setMorph('まばたき', w); }
      }
      if (this.currentExpression) {
        this.expressionTimer += dt;
        const t = Math.min(1, this.expressionTimer / this.expressionDuration);
        this.expressionWeight = this.targetExpressionWeight * (t < 0.5 ? t * 2 : (1 - t) * 2);
        const morphs = this.expressions.get(this.currentExpression);
        if (morphs) for (const [name, w] of Object.entries(morphs)) this.setMorph(name, w * this.expressionWeight);
        if (t >= 1) this.currentExpression = null;
      }
    }

    lipSync(audioData) {
      if (!audioData) return;
      const volume = Math.abs(audioData);
      this.lipSyncValues.a = Math.max(0, volume - 0.3) * 2;
      this.setMorph('あ', this.lipSyncValues.a);
      this.setMorph('い', this.lipSyncValues.i);
      this.setMorph('う', this.lipSyncValues.u);
      this.setMorph('え', this.lipSyncValues.e);
      this.setMorph('お', this.lipSyncValues.o);
    }

    setBlinkRate(interval) { this.blinkInterval = interval; }
    triggerBlink() { this.isBlinking = true; this.blinkTimer = 0; }
    reset() { this.morphWeights.clear(); this.currentExpression = null; }
    getMorphWeights() { return Object.fromEntries(this.morphWeights); }
  }

  // ============================================================
  // 手势系统
  // ============================================================
  class GestureSystem {
    constructor(skeleton) {
      this.skeleton = skeleton;
      this.gestures = new Map();
      this.currentGesture = null;
      this.gestureTime = 0;
      this.queue = [];
      this.blendWeight = 0;
    }

    addGesture(name, keyframes) { this.gestures.set(name, keyframes); }

    playGesture(name, blendTime = 0.2) {
      if (!this.gestures.has(name)) return;
      this.queue.push({ name, blendTime });
      if (!this.currentGesture) this._nextGesture();
    }

    _nextGesture() {
      if (this.queue.length === 0) { this.currentGesture = null; return; }
      const next = this.queue.shift();
      this.currentGesture = next.name;
      this.gestureTime = 0;
      this.targetBlendTime = next.blendTime;
      this.blendWeight = 0;
    }

    update(dt) {
      if (!this.currentGesture) return;
      this.gestureTime += dt;
      const keyframes = this.gestures.get(this.currentGesture);
      const duration = keyframes[keyframes.length - 1].time;
      if (this.gestureTime >= duration) {
        this._nextGesture();
        return;
      }
      this.blendWeight = Math.min(1, this.blendWeight + dt / this.targetBlendTime);
      for (let i = 0; i < keyframes.length - 1; i++) {
        if (this.gestureTime >= keyframes[i].time && this.gestureTime <= keyframes[i+1].time) {
          const t = (this.gestureTime - keyframes[i].time) / (keyframes[i+1].time - keyframes[i].time);
          for (const [bone, rot] of Object.entries(keyframes[i].rotations)) {
            const nextRot = keyframes[i+1].rotations[bone];
            const boneObj = this.skeleton.getBone(bone);
            if (boneObj && nextRot) {
              const blended = rot.map((v, j) => v + (nextRot[j] - v) * t * this.blendWeight);
              boneObj.rotation = blended;
            }
          }
          break;
        }
      }
    }

    stopGesture() { this.currentGesture = null; this.queue = []; this.blendWeight = 0; }
    isPlaying() { return this.currentGesture !== null; }
    getCurrentGesture() { return this.currentGesture; }
  }

  // ============================================================
  // 移动控制器
  // ============================================================
  class LocomotionController {
    constructor(skeleton) {
      this.skeleton = skeleton;
      this.speed = 0;
      this.direction = 0;
      this.targetSpeed = 0;
      this.targetDirection = 0;
      this.acceleration = 2;
      this.deceleration = 3;
      this.turnSpeed = 5;
      this.position = [0, 0, 0];
      this.velocity = [0, 0, 0];
      this.footPhase = 0;
      this.footPlacement = { left: [0,0,0], right: [0,0,0] };
      this.groundHeight = 0;
      this.strideLength = 0.6;
      this.cadence = 120;
    }

    setTargetSpeed(speed) { this.targetSpeed = speed; }
    setTargetDirection(angle) { this.targetDirection = angle; }

    update(dt) {
      if (this.targetSpeed > this.speed) this.speed = Math.min(this.targetSpeed, this.speed + this.acceleration * dt);
      else this.speed = Math.max(this.targetSpeed, this.speed - this.deceleration * dt);
      let dirDiff = this.targetDirection - this.direction;
      while (dirDiff > Math.PI) dirDiff -= Math.PI * 2;
      while (dirDiff < -Math.PI) dirDiff += Math.PI * 2;
      this.direction += dirDiff * Math.min(1, this.turnSpeed * dt);
      const moveSpeed = this.speed * dt;
      this.velocity[0] = Math.sin(this.direction) * moveSpeed;
      this.velocity[2] = Math.cos(this.direction) * moveSpeed;
      this.position[0] += this.velocity[0];
      this.position[2] += this.velocity[2];
      this.position[1] = this.groundHeight;
      if (Math.abs(this.speed) > 0.01) {
        this.footPhase += (this.speed / this.strideLength) * dt * (this.cadence / 60);
        this._updateFootPlacement();
      }
      const root = this.skeleton.bones.find(b => b.parent === -1);
      if (root) { root.position = [...this.position]; root.rotation = [0, Math.sin(this.direction/2), 0, Math.cos(this.direction/2)]; }
    }

    _updateFootPlacement() {
      const phase = this.footPhase % (Math.PI * 2);
      const lift = Math.abs(Math.sin(phase)) * 0.05;
      this.footPlacement.left = [this.position[0] + Math.sin(phase) * 0.1, this.groundHeight + lift, this.position[2] + Math.cos(phase) * 0.15];
      this.footPlacement.right = [this.position[0] - Math.sin(phase) * 0.1, this.groundHeight + (1-lift), this.position[2] - Math.cos(phase) * 0.15];
    }

    getFootPlacement() { return this.footPlacement; }
    getPosition() { return [...this.position]; }
    getVelocity() { return [...this.velocity]; }
    reset() { this.speed = 0; this.direction = 0; this.position = [0,0,0]; this.velocity = [0,0,0]; this.footPhase = 0; }
  }

  // ============================================================
  // 动作状态机
  // ============================================================
  class ActionStateMachine {
    constructor() {
      this.states = new Map();
      this.transitions = new Map();
      this.currentState = null;
      this.stateTime = 0;
      this.conditions = new Map();
      this.onStateChange = null;
    }

    addState(name, config = {}) {
      this.states.set(name, { enter: config.enter || null, update: config.update || null, exit: config.exit || null, duration: config.duration || 0 });
      if (!this.currentState) this.currentState = name;
    }

    addTransition(from, to, condition, options = {}) {
      const key = `${from}:${to}`;
      this.transitions.set(key, { from, to, condition, priority: options.priority || 0, hasExitTime: options.hasExitTime || false, exitTime: options.exitTime || 0 });
    }

    setCondition(name, value) { this.conditions.set(name, value); this._evaluateTransitions(); }
    getCondition(name) { return this.conditions.get(name); }

    trigger(eventName) { this.setCondition(eventName, true); }

    update(dt) {
      this.stateTime += dt;
      const state = this.states.get(this.currentState);
      if (state && state.update) state.update(dt, this.stateTime);
      if (state && state.duration > 0 && this.stateTime >= state.duration) this._evaluateTransitions(true);
      this._evaluateTransitions();
    }

    _evaluateTransitions(force = false) {
      const candidates = [];
      for (const [key, trans] of this.transitions) {
        if (trans.from !== this.currentState) continue;
        let canTransition = trans.condition(this.conditions);
        if (trans.hasExitTime && this.stateTime < trans.exitTime) canTransition = false;
        if (force && !canTransition) canTransition = true;
        if (canTransition) candidates.push(trans);
      }
      if (candidates.length > 0) {
        candidates.sort((a, b) => b.priority - a.priority);
        this._changeState(candidates[0].to);
      }
    }

    _changeState(to) {
      const fromState = this.states.get(this.currentState);
      if (fromState && fromState.exit) fromState.exit();
      this.currentState = to;
      this.stateTime = 0;
      const toState = this.states.get(to);
      if (toState && toState.enter) toState.enter();
      if (this.onStateChange) this.onStateChange(to);
      for (const key of this.conditions.keys()) if (key.startsWith('event_')) this.conditions.delete(key);
    }

    getState() { return this.currentState; }
    getStateTime() { return this.stateTime; }
    reset() { this.currentState = this.states.keys().next().value; this.stateTime = 0; this.conditions.clear(); }
  }

  return {
    Bone, SkeletonSystem, IKSolver, AnimationBlender, MotionGraph,
    RagdollPhysics, FacialAnimation, GestureSystem, LocomotionController, ActionStateMachine
  };
})();

if (typeof window !== 'undefined') window.ActionCore = ActionCore;
if (typeof globalThis !== 'undefined') globalThis.ActionCore = ActionCore;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ActionCore;
}

if (typeof globalThis !== 'undefined') {
  globalThis.AEVUM = globalThis.AEVUM || {};
  globalThis.AEVUM.action = globalThis.AEVUM.action || {};
  globalThis.AEVUM.action.Core = ActionCore;
}
