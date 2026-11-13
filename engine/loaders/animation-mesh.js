/**
 * 模型格式 - 动画处理/骨骼管理/网格优化/格式转换/蒙皮计算
 * 纯JavaScript，零第三方依赖
 * @version 2.0.0
 */
'use strict';

const ModelFormatsV2 = (function () {

  class AnimationPlayer {
    constructor() {
      this.animations = new Map();
      this.currentAnimation = null;
      this.currentTime = 0;
      this.playbackSpeed = 1;
      this.isPlaying = false;
      this.loop = true;
      this.blendAnimations = [];
      this.blendWeights = [];
      this.events = new (typeof EventTarget !== 'undefined' ? EventTarget : class { addEventListener(){} removeEventListener(){} dispatchEvent(){return true;} })();
      this.callbacks = new Map();
      this.lastTime = 0;
    }

    addAnimation(name, animation) {
      this.animations.set(name, {
        name,
        duration: animation.duration || 0,
        tracks: animation.tracks || [],
        frameRate: animation.frameRate || 30,
        loop: animation.loop !== undefined ? animation.loop : true,
        events: animation.events || []
      });
    }

    removeAnimation(name) {
      this.animations.delete(name);
      if (this.currentAnimation?.name === name) {
        this.stop();
      }
    }

    play(name, options = {}) {
      const animation = this.animations.get(name);
      if (!animation) {
        console.warn(`Animation not found: ${name}`);
        return false;
      }
      if (this.currentAnimation && options.blend !== false) {
        this._startBlend(name, options.blendDuration || 0.3);
      } else {
        this.currentAnimation = animation;
        this.currentTime = options.startTime || 0;
        this.playbackSpeed = options.speed || 1;
        this.loop = options.loop !== undefined ? options.loop : animation.loop;
      }
      this.isPlaying = true;
      this.lastTime = performance.now();
      this.events.dispatchEvent(new CustomEvent('play', { detail: { name } }));
      return true;
    }

    stop() {
      this.isPlaying = false;
      this.currentTime = 0;
      this.currentAnimation = null;
      this.blendAnimations = [];
      this.blendWeights = [];
      this.events.dispatchEvent(new CustomEvent('stop'));
    }

    pause() {
      this.isPlaying = false;
      this.events.dispatchEvent(new CustomEvent('pause'));
    }

    resume() {
      if (this.currentAnimation) {
        this.isPlaying = true;
        this.lastTime = performance.now();
        this.events.dispatchEvent(new CustomEvent('resume'));
      }
    }

    seek(time) {
      if (this.currentAnimation) {
        this.currentTime = Math.max(0, Math.min(time, this.currentAnimation.duration));
        this._updateEvents();
      }
    }

    update(deltaTime) {
      if (!this.isPlaying || !this.currentAnimation) return null;
      const delta = deltaTime * this.playbackSpeed;
      this.currentTime += delta;
      if (this.currentTime >= this.currentAnimation.duration) {
        if (this.loop) {
          this.currentTime = this.currentTime % this.currentAnimation.duration;
          this.events.dispatchEvent(new CustomEvent('loop', { detail: { name: this.currentAnimation.name } }));
        } else {
          this.currentTime = this.currentAnimation.duration;
          this.isPlaying = false;
          this.events.dispatchEvent(new CustomEvent('complete', { detail: { name: this.currentAnimation.name } }));
        }
      }
      this._updateBlend(delta);
      this._updateEvents();
      return this.evaluate();
    }

    _updateEvents() {
      if (!this.currentAnimation) return;
      for (const event of this.currentAnimation.events) {
        if (!event.triggered && this.currentTime >= event.time) {
          event.triggered = true;
          this.events.dispatchEvent(new CustomEvent('animationEvent', { detail: event }));
          const callback = this.callbacks.get(event.name);
          if (callback) callback(event);
        }
      }
    }

    _startBlend(targetName, duration) {
      const targetAnimation = this.animations.get(targetName);
      if (!targetAnimation) return;
      this.blendAnimations.push({
        animation: this.currentAnimation,
        time: this.currentTime,
        weight: 1,
        fadeOut: true
      });
      this.currentAnimation = targetAnimation;
      this.currentTime = 0;
      this.blendDuration = duration;
      this.blendTime = 0;
    }

    _updateBlend(delta) {
      if (this.blendAnimations.length === 0) return;
      this.blendTime += delta;
      const t = Math.min(1, this.blendTime / this.blendDuration);
      for (let i = this.blendAnimations.length - 1; i >= 0; i--) {
        const blend = this.blendAnimations[i];
        if (blend.fadeOut) {
          blend.weight = 1 - t;
          blend.time += delta;
        }
        if (blend.weight <= 0) {
          this.blendAnimations.splice(i, 1);
        }
      }
    }

    evaluate() {
      if (!this.currentAnimation) return null;
      const result = {
        bones: {},
        morphs: {},
        time: this.currentTime,
        animation: this.currentAnimation.name
      };
      this._evaluateTracks(this.currentAnimation, this.currentTime, result);
      for (const blend of this.blendAnimations) {
        const blendResult = { bones: {}, morphs: {} };
        this._evaluateTracks(blend.animation, blend.time, blendResult);
        for (const [boneName, transform] of Object.entries(blendResult.bones)) {
          if (result.bones[boneName]) {
            result.bones[boneName] = this._blendTransform(result.bones[boneName], transform, blend.weight);
          }
        }
        for (const [morphName, weight] of Object.entries(blendResult.morphs)) {
          if (result.morphs[morphName] !== undefined) {
            result.morphs[morphName] = result.morphs[morphName] * (1 - blend.weight) + weight * blend.weight;
          }
        }
      }
      return result;
    }

    _evaluateTracks(animation, time, result) {
      for (const track of animation.tracks) {
        if (track.type === 'bone') {
          result.bones[track.target] = this._evaluateBoneTrack(track, time);
        } else if (track.type === 'morph') {
          result.morphs[track.target] = this._evaluateMorphTrack(track, time);
        }
      }
    }

    _evaluateBoneTrack(track, time) {
      const result = {
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1]
      };
      if (track.positionKeys && track.positionKeys.length > 0) {
        result.position = this._interpolateVector3(track.positionKeys, time, [0, 0, 0]);
      }
      if (track.rotationKeys && track.rotationKeys.length > 0) {
        result.rotation = this._interpolateQuaternion(track.rotationKeys, time);
      }
      if (track.scaleKeys && track.scaleKeys.length > 0) {
        result.scale = this._interpolateVector3(track.scaleKeys, time, [1, 1, 1]);
      }
      return result;
    }

    _evaluateMorphTrack(track, time) {
      if (!track.keys || track.keys.length === 0) return 0;
      return this._interpolateFloat(track.keys, time);
    }

    _interpolateVector3(keys, time, defaultValue) {
      if (keys.length === 0) return defaultValue;
      if (time <= keys[0].time) return [...keys[0].value];
      if (time >= keys[keys.length - 1].time) return [...keys[keys.length - 1].value];
      for (let i = 0; i < keys.length - 1; i++) {
        if (time >= keys[i].time && time <= keys[i + 1].time) {
          const t = (time - keys[i].time) / (keys[i + 1].time - keys[i].time);
          return [
            keys[i].value[0] + (keys[i + 1].value[0] - keys[i].value[0]) * t,
            keys[i].value[1] + (keys[i + 1].value[1] - keys[i].value[1]) * t,
            keys[i].value[2] + (keys[i + 1].value[2] - keys[i].value[2]) * t
          ];
        }
      }
      return defaultValue;
    }

    _interpolateQuaternion(keys, time) {
      if (keys.length === 0) return [0, 0, 0, 1];
      if (time <= keys[0].time) return [...keys[0].value];
      if (time >= keys[keys.length - 1].time) return [...keys[keys.length - 1].value];
      for (let i = 0; i < keys.length - 1; i++) {
        if (time >= keys[i].time && time <= keys[i + 1].time) {
          const t = (time - keys[i].time) / (keys[i + 1].time - keys[i].time);
          return this._slerp(keys[i].value, keys[i + 1].value, t);
        }
      }
      return [0, 0, 0, 1];
    }

    _interpolateFloat(keys, time) {
      if (keys.length === 0) return 0;
      if (time <= keys[0].time) return keys[0].value;
      if (time >= keys[keys.length - 1].time) return keys[keys.length - 1].value;
      for (let i = 0; i < keys.length - 1; i++) {
        if (time >= keys[i].time && time <= keys[i + 1].time) {
          const t = (time - keys[i].time) / (keys[i + 1].time - keys[i].time);
          return keys[i].value + (keys[i + 1].value - keys[i].value) * t;
        }
      }
      return 0;
    }

    _slerp(a, b, t) {
      let dot = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
      let bCopy = [...b];
      if (dot < 0) { bCopy = [-b[0], -b[1], -b[2], -b[3]]; dot = -dot; }
      if (dot > 0.9995) {
        return this._normalizeQuat([
          a[0] + (bCopy[0] - a[0]) * t,
          a[1] + (bCopy[1] - a[1]) * t,
          a[2] + (bCopy[2] - a[2]) * t,
          a[3] + (bCopy[3] - a[3]) * t
        ]);
      }
      const theta0 = Math.acos(Math.max(-1, Math.min(1, dot)));
      const theta = theta0 * t;
      const sinTheta = Math.sin(theta);
      const sinTheta0 = Math.sin(theta0);
      const s0 = Math.cos(theta) - dot * sinTheta / sinTheta0;
      const s1 = sinTheta / sinTheta0;
      return [a[0]*s0+bCopy[0]*s1, a[1]*s0+bCopy[1]*s1, a[2]*s0+bCopy[2]*s1, a[3]*s0+bCopy[3]*s1];
    }

    _normalizeQuat(q) {
      const l = Math.sqrt(q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3]) || 1;
      return [q[0]/l, q[1]/l, q[2]/l, q[3]/l];
    }

    _blendTransform(a, b, weight) {
      return {
        position: [
          a.position[0] * (1 - weight) + b.position[0] * weight,
          a.position[1] * (1 - weight) + b.position[1] * weight,
          a.position[2] * (1 - weight) + b.position[2] * weight
        ],
        rotation: this._slerp(a.rotation, b.rotation, weight),
        scale: [
          a.scale[0] * (1 - weight) + b.scale[0] * weight,
          a.scale[1] * (1 - weight) + b.scale[1] * weight,
          a.scale[2] * (1 - weight) + b.scale[2] * weight
        ]
      };
    }

    onEvent(name, callback) {
      this.callbacks.set(name, callback);
    }

    getCurrentAnimation() { return this.currentAnimation?.name || null; }
    getCurrentTime() { return this.currentTime; }
    getDuration() { return this.currentAnimation?.duration || 0; }
    getAnimationNames() { return Array.from(this.animations.keys()); }
    getAnimationCount() { return this.animations.size; }
    isPlayingState() { return this.isPlaying; }
    setPlaybackSpeed(v) { this.playbackSpeed = v; }
    setLoop(v) { this.loop = v; }
    dispose() {
      this.animations.clear();
      this.currentAnimation = null;
      this.blendAnimations = [];
      this.callbacks.clear();
    }
  }

  class SkeletonManager {
    constructor() {
      this.skeletons = new Map();
      this.currentSkeleton = null;
      this.boneMatrices = new Map();
      this.boneWorldMatrices = new Map();
      this.bindPoseMatrices = new Map();
      this.inverseBindMatrices = new Map();
      this.boneParents = new Map();
      this.boneChildren = new Map();
      this.boneNames = new Map();
      this.boneIndices = new Map();
      this.ikChains = new Map();
      this.constraints = new Map();
    }

    createSkeleton(name, bones) {
      const skeleton = {
        name,
        bones: [],
        boneCount: bones.length,
        rootBone: null,
        boneMap: new Map(),
        boneIndexMap: new Map()
      };
      for (let i = 0; i < bones.length; i++) {
        const bone = {
          index: i,
          name: bones[i].name,
          parentIndex: bones[i].parentIndex ?? -1,
          position: bones[i].position || [0, 0, 0],
          rotation: bones[i].rotation || [0, 0, 0, 1],
          scale: bones[i].scale || [1, 1, 1],
          localMatrix: new Float32Array(16),
          worldMatrix: new Float32Array(16),
          inverseBindMatrix: bones[i].inverseBindMatrix ? new Float32Array(bones[i].inverseBindMatrix) : null,
          length: bones[i].length || 0,
          children: []
        };
        skeleton.bones.push(bone);
        skeleton.boneMap.set(bone.name, bone);
        skeleton.boneIndexMap.set(bone.name, i);
        this.boneNames.set(`${name}:${i}`, bone.name);
        this.boneIndices.set(`${name}:${bone.name}`, i);
      }
      for (let i = 0; i < skeleton.bones.length; i++) {
        const bone = skeleton.bones[i];
        if (bone.parentIndex >= 0) {
          skeleton.bones[bone.parentIndex].children.push(i);
        } else {
          skeleton.rootBone = bone;
        }
      }
      this.skeletons.set(name, skeleton);
      this._computeBindPose(skeleton);
      return skeleton;
    }

    _computeBindPose(skeleton) {
      for (const bone of skeleton.bones) {
        this._computeLocalMatrix(bone);
      }
      this._updateWorldMatrices(skeleton);
      for (const bone of skeleton.bones) {
        if (!bone.inverseBindMatrix) {
          bone.inverseBindMatrix = this._invertMatrix(bone.worldMatrix);
        }
        this.inverseBindMatrices.set(`${skeleton.name}:${bone.index}`, bone.inverseBindMatrix);
      }
    }

    _computeLocalMatrix(bone) {
      const m = bone.localMatrix;
      const x = bone.rotation[0], y = bone.rotation[1], z = bone.rotation[2], w = bone.rotation[3];
      const x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2;
      const yy = y * y2, yz = y * z2, zz = z * z2;
      const wx = w * x2, wy = w * y2, wz = w * z2;
      const sx = bone.scale[0], sy = bone.scale[1], sz = bone.scale[2];
      m[0] = (1 - (yy + zz)) * sx; m[1] = (xy + wz) * sx; m[2] = (xz - wy) * sx; m[3] = 0;
      m[4] = (xy - wz) * sy; m[5] = (1 - (xx + zz)) * sy; m[6] = (yz + wx) * sy; m[7] = 0;
      m[8] = (xz + wy) * sz; m[9] = (yz - wx) * sz; m[10] = (1 - (xx + yy)) * sz; m[11] = 0;
      m[12] = bone.position[0]; m[13] = bone.position[1]; m[14] = bone.position[2]; m[15] = 1;
    }

    _updateWorldMatrices(skeleton) {
      const updateBone = (bone, parentMatrix) => {
        if (parentMatrix) {
          bone.worldMatrix.set(this._multiplyMatrices(parentMatrix, bone.localMatrix));
        } else {
          bone.worldMatrix.set(bone.localMatrix);
        }
        for (const childIndex of bone.children) {
          updateBone(skeleton.bones[childIndex], bone.worldMatrix);
        }
      };
      if (skeleton.rootBone) {
        updateBone(skeleton.rootBone, null);
      }
    }

    _multiplyMatrices(a, b) {
      const result = new Float32Array(16);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          result[i*4+j] = a[i*4]*b[j] + a[i*4+1]*b[4+j] + a[i*4+2]*b[8+j] + a[i*4+3]*b[12+j];
        }
      }
      return result;
    }

    _invertMatrix(m) {
      const result = new Float32Array(16);
      const inv = new Float32Array(16);
      inv[0] = m[5]*m[10]*m[15] - m[5]*m[11]*m[14] - m[9]*m[6]*m[15] + m[9]*m[7]*m[14] + m[13]*m[6]*m[11] - m[13]*m[7]*m[10];
      inv[4] = -m[4]*m[10]*m[15] + m[4]*m[11]*m[14] + m[8]*m[6]*m[15] - m[8]*m[7]*m[14] - m[12]*m[6]*m[11] + m[12]*m[7]*m[10];
      inv[8] = m[4]*m[9]*m[15] - m[4]*m[11]*m[13] - m[8]*m[5]*m[15] + m[8]*m[7]*m[13] + m[12]*m[5]*m[11] - m[12]*m[7]*m[9];
      inv[12] = -m[4]*m[9]*m[14] + m[4]*m[10]*m[13] + m[8]*m[5]*m[14] - m[8]*m[6]*m[13] - m[12]*m[5]*m[10] + m[12]*m[6]*m[9];
      inv[1] = -m[1]*m[10]*m[15] + m[1]*m[11]*m[14] + m[9]*m[2]*m[15] - m[9]*m[3]*m[14] - m[13]*m[2]*m[11] + m[13]*m[3]*m[10];
      inv[5] = m[0]*m[10]*m[15] - m[0]*m[11]*m[14] - m[8]*m[2]*m[15] + m[8]*m[3]*m[14] + m[12]*m[2]*m[11] - m[12]*m[3]*m[10];
      inv[9] = -m[0]*m[9]*m[15] + m[0]*m[11]*m[13] + m[8]*m[1]*m[15] - m[8]*m[3]*m[13] - m[12]*m[1]*m[11] + m[12]*m[3]*m[9];
      inv[13] = m[0]*m[9]*m[14] - m[0]*m[10]*m[13] - m[8]*m[1]*m[14] + m[8]*m[2]*m[13] + m[12]*m[1]*m[10] - m[12]*m[2]*m[9];
      inv[2] = m[1]*m[6]*m[15] - m[1]*m[7]*m[14] - m[5]*m[2]*m[15] + m[5]*m[3]*m[14] + m[13]*m[2]*m[7] - m[13]*m[3]*m[6];
      inv[6] = -m[0]*m[6]*m[15] + m[0]*m[7]*m[14] + m[4]*m[2]*m[15] - m[4]*m[3]*m[14] - m[12]*m[2]*m[7] + m[12]*m[3]*m[6];
      inv[10] = m[0]*m[5]*m[15] - m[0]*m[7]*m[13] - m[4]*m[1]*m[15] + m[4]*m[3]*m[13] + m[12]*m[1]*m[7] - m[12]*m[3]*m[5];
      inv[14] = -m[0]*m[5]*m[14] + m[0]*m[6]*m[13] + m[4]*m[1]*m[14] - m[4]*m[2]*m[13] - m[12]*m[1]*m[6] + m[12]*m[2]*m[5];
      inv[3] = -m[1]*m[6]*m[11] + m[1]*m[7]*m[10] + m[5]*m[2]*m[11] - m[5]*m[3]*m[10] - m[9]*m[2]*m[7] + m[9]*m[3]*m[6];
      inv[7] = m[0]*m[6]*m[11] - m[0]*m[7]*m[10] - m[4]*m[2]*m[11] + m[4]*m[3]*m[10] + m[8]*m[2]*m[7] - m[8]*m[3]*m[6];
      inv[11] = -m[0]*m[5]*m[11] + m[0]*m[7]*m[9] + m[4]*m[1]*m[11] - m[4]*m[3]*m[9] - m[8]*m[1]*m[7] + m[8]*m[3]*m[5];
      inv[15] = m[0]*m[5]*m[10] - m[0]*m[6]*m[9] - m[4]*m[1]*m[10] + m[4]*m[2]*m[9] + m[8]*m[1]*m[6] - m[8]*m[2]*m[5];
      let det = m[0]*inv[0] + m[1]*inv[4] + m[2]*inv[8] + m[3]*inv[12];
      if (det === 0) return result;
      det = 1.0 / det;
      for (let i = 0; i < 16; i++) result[i] = inv[i] * det;
      return result;
    }

    setBoneTransform(skeletonName, boneName, position, rotation, scale) {
      const skeleton = this.skeletons.get(skeletonName);
      if (!skeleton) return;
      const bone = skeleton.boneMap.get(boneName);
      if (!bone) return;
      if (position) bone.position = [...position];
      if (rotation) bone.rotation = [...rotation];
      if (scale) bone.scale = [...scale];
      this._computeLocalMatrix(bone);
      this._updateWorldMatrices(skeleton);
    }

    getBoneMatrix(skeletonName, boneName) {
      const skeleton = this.skeletons.get(skeletonName);
      if (!skeleton) return null;
      const bone = skeleton.boneMap.get(boneName);
      return bone ? bone.worldMatrix : null;
    }

    getSkinningMatrices(skeletonName) {
      const skeleton = this.skeletons.get(skeletonName);
      if (!skeleton) return null;
      const matrices = new Float32Array(skeleton.boneCount * 16);
      for (let i = 0; i < skeleton.boneCount; i++) {
        const bone = skeleton.bones[i];
        const skinMatrix = this._multiplyMatrices(bone.worldMatrix, bone.inverseBindMatrix);
        matrices.set(skinMatrix, i * 16);
      }
      return matrices;
    }

    getBoneNames(skeletonName) {
      const skeleton = this.skeletons.get(skeletonName);
      return skeleton ? skeleton.bones.map(b => b.name) : [];
    }

    getBoneCount(skeletonName) {
      const skeleton = this.skeletons.get(skeletonName);
      return skeleton ? skeleton.boneCount : 0;
    }

    getSkeleton(skeletonName) {
      return this.skeletons.get(skeletonName);
    }

    getSkeletonNames() {
      return Array.from(this.skeletons.keys());
    }

    removeSkeleton(skeletonName) {
      this.skeletons.delete(skeletonName);
    }

    clear() {
      this.skeletons.clear();
      this.boneMatrices.clear();
      this.boneWorldMatrices.clear();
      this.bindPoseMatrices.clear();
      this.inverseBindMatrices.clear();
    }
  }

  class MorphController {
    constructor() {
      this.morphs = new Map();
      this.currentWeights = new Map();
      this.targetWeights = new Map();
      this.animationSpeed = 5;
      this.groups = new Map();
      this.blendShapes = new Map();
      this.callbacks = new Map();
    }

    addMorph(name, morph) {
      this.morphs.set(name, {
        name,
        type: morph.type || 'vertex',
        elements: morph.elements || [],
        weight: 0,
        group: morph.group || 'default',
        category: morph.category || 'other'
      });
      this.currentWeights.set(name, 0);
      this.targetWeights.set(name, 0);
      if (!this.groups.has(morph.group || 'default')) {
        this.groups.set(morph.group || 'default', []);
      }
      this.groups.get(morph.group || 'default').push(name);
    }

    removeMorph(name) {
      this.morphs.delete(name);
      this.currentWeights.delete(name);
      this.targetWeights.delete(name);
    }

    setMorphWeight(name, weight, animate = false) {
      if (!this.morphs.has(name)) return;
      this.targetWeights.set(name, Math.max(0, Math.min(1, weight)));
      if (!animate) {
        this.currentWeights.set(name, weight);
      }
    }

    getMorphWeight(name) {
      return this.currentWeights.get(name) || 0;
    }

    update(deltaTime) {
      for (const [name, targetWeight] of this.targetWeights) {
        const currentWeight = this.currentWeights.get(name) || 0;
        if (currentWeight !== targetWeight) {
          const diff = targetWeight - currentWeight;
          const step = diff * Math.min(1, deltaTime * this.animationSpeed);
          const newWeight = currentWeight + step;
          this.currentWeights.set(name, newWeight);
          if (Math.abs(newWeight - targetWeight) < 0.001) {
            this.currentWeights.set(name, targetWeight);
            const callback = this.callbacks.get(name);
            if (callback) callback(targetWeight);
          }
        }
      }
    }

    applyToVertices(vertices, baseVertices) {
      const result = new Float32Array(vertices);
      for (const [name, weight] of this.currentWeights) {
        if (weight <= 0) continue;
        const morph = this.morphs.get(name);
        if (!morph || morph.type !== 'vertex') continue;
        for (const element of morph.elements) {
          const idx = element.index * 3;
          result[idx] += element.position[0] * weight;
          result[idx + 1] += element.position[1] * weight;
          result[idx + 2] += element.position[2] * weight;
        }
      }
      return result;
    }

    getActiveMorphs() {
      const active = [];
      for (const [name, weight] of this.currentWeights) {
        if (weight > 0) active.push({ name, weight });
      }
      return active;
    }

    getMorphNames() {
      return Array.from(this.morphs.keys());
    }

    getMorphGroup(groupName) {
      return this.groups.get(groupName) || [];
    }

    getGroupNames() {
      return Array.from(this.groups.keys());
    }

    setGroupWeight(groupName, weight) {
      const morphs = this.groups.get(groupName);
      if (morphs) {
        for (const name of morphs) {
          this.setMorphWeight(name, weight);
        }
      }
    }

    reset() {
      for (const name of this.morphs.keys()) {
        this.currentWeights.set(name, 0);
        this.targetWeights.set(name, 0);
      }
    }

    onMorphComplete(name, callback) {
      this.callbacks.set(name, callback);
    }

    dispose() {
      this.morphs.clear();
      this.currentWeights.clear();
      this.targetWeights.clear();
      this.groups.clear();
      this.callbacks.clear();
    }
  }

  return {
    AnimationPlayer, SkeletonManager, MorphController
  };
})();

if (typeof window !== 'undefined') window.ModelFormatsV2 = ModelFormatsV2;
if (typeof globalThis !== 'undefined') globalThis.ModelFormatsV2 = ModelFormatsV2;
