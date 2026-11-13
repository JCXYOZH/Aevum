/**
 * 模型格式 - 动画压缩/骨骼重定向/网格优化/格式转换/蒙皮计算
 * 纯JavaScript，零第三方依赖
 * @version 3.0.0
 */
'use strict';

const ModelFormatsV3 = (function () {

  class AnimationCompressor {
    constructor() {
      this.compressionLevel = 0.5;
      this.positionTolerance = 0.001;
      this.rotationTolerance = 0.001;
      this.scaleTolerance = 0.001;
      this.quantizationBits = 16;
      this.useKeyframeReduction = true;
      this.useQuantization = true;
      this.useDeltaEncoding = true;
      this.stats = {
        originalSize: 0,
        compressedSize: 0,
        ratio: 0,
        keyframesRemoved: 0
      };
    }

    compress(animation) {
      this.stats.originalSize = this._estimateSize(animation);
      let result = {
        name: animation.name,
        duration: animation.duration,
        frameRate: animation.frameRate,
        tracks: []
      };
      for (const track of animation.tracks) {
        const compressedTrack = this._compressTrack(track);
        result.tracks.push(compressedTrack);
      }
      if (this.useQuantization) {
        result = this._quantizeAnimation(result);
      }
      if (this.useDeltaEncoding) {
        result = this._deltaEncodeAnimation(result);
      }
      this.stats.compressedSize = this._estimateSize(result);
      this.stats.ratio = this.stats.originalSize > 0 ? this.stats.compressedSize / this.stats.originalSize : 0;
      return result;
    }

    _compressTrack(track) {
      const compressedTrack = {
        target: track.target,
        type: track.type,
        positionKeys: track.positionKeys ? this._reduceKeyframes(track.positionKeys, this.positionTolerance) : null,
        rotationKeys: track.rotationKeys ? this._reduceKeyframes(track.rotationKeys, this.rotationTolerance) : null,
        scaleKeys: track.scaleKeys ? this._reduceKeyframes(track.scaleKeys, this.scaleTolerance) : null
      };
      return compressedTrack;
    }

    _reduceKeyframes(keys, tolerance) {
      if (!this.useKeyframeReduction || keys.length <= 2) return keys;
      const reduced = [keys[0]];
      for (let i = 1; i < keys.length - 1; i++) {
        const prev = reduced[reduced.length - 1];
        const next = keys[i + 1];
        const interpolated = this._interpolateKeyframe(prev, next, keys[i].time);
        if (!this._keyframeApproxEqual(keys[i], interpolated, tolerance)) {
          reduced.push(keys[i]);
        } else {
          this.stats.keyframesRemoved++;
        }
      }
      reduced.push(keys[keys.length - 1]);
      return reduced;
    }

    _interpolateKeyframe(a, b, time) {
      if (time <= a.time) return { ...a, time };
      if (time >= b.time) return { ...b, time };
      const t = (time - a.time) / (b.time - a.time);
      if (a.value.length === 4) {
        return { time, value: this._slerp(a.value, b.value, t) };
      }
      return {
        time,
        value: a.value.map((v, i) => v + (b.value[i] - v) * t)
      };
    }

    _keyframeApproxEqual(a, b, tolerance) {
      if (a.value.length !== b.value.length) return false;
      for (let i = 0; i < a.value.length; i++) {
        if (Math.abs(a.value[i] - b.value[i]) > tolerance) return false;
      }
      return true;
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

    _quantizeAnimation(animation) {
      const maxValue = Math.pow(2, this.quantizationBits - 1) - 1;
      const quantized = {
        ...animation,
        quantization: { bits: this.quantizationBits, maxValue },
        tracks: animation.tracks.map(track => ({
          ...track,
          positionKeys: track.positionKeys?.map(k => ({
            time: k.time,
            value: k.value.map(v => Math.round(v * maxValue))
          })),
          rotationKeys: track.rotationKeys?.map(k => ({
            time: k.time,
            value: k.value.map(v => Math.round(v * maxValue))
          })),
          scaleKeys: track.scaleKeys?.map(k => ({
            time: k.time,
            value: k.value.map(v => Math.round(v * maxValue))
          }))
        }))
      };
      return quantized;
    }

    _deltaEncodeAnimation(animation) {
      const deltaEncoded = {
        ...animation,
        tracks: animation.tracks.map(track => ({
          ...track,
          positionKeys: track.positionKeys ? this._deltaEncodeKeys(track.positionKeys) : null,
          rotationKeys: track.rotationKeys ? this._deltaEncodeKeys(track.rotationKeys) : null,
          scaleKeys: track.scaleKeys ? this._deltaEncodeKeys(track.scaleKeys) : null
        }))
      };
      return deltaEncoded;
    }

    _deltaEncodeKeys(keys) {
      const encoded = [keys[0]];
      for (let i = 1; i < keys.length; i++) {
        const prev = keys[i - 1];
        encoded.push({
          time: keys[i].time - prev.time,
          value: keys[i].value.map((v, j) => v - prev.value[j])
        });
      }
      return encoded;
    }

    decompress(animation) {
      let result = { ...animation };
      if (animation.quantization) {
        result = this._dequantizeAnimation(result);
      }
      if (this.useDeltaEncoding && animation.tracks?.[0]?.positionKeys?.length > 1) {
        result = this._deltaDecodeAnimation(result);
      }
      return result;
    }

    _dequantizeAnimation(animation) {
      const maxValue = animation.quantization.maxValue;
      return {
        ...animation,
        tracks: animation.tracks.map(track => ({
          ...track,
          positionKeys: track.positionKeys?.map(k => ({
            time: k.time,
            value: k.value.map(v => v / maxValue)
          })),
          rotationKeys: track.rotationKeys?.map(k => ({
            time: k.time,
            value: k.value.map(v => v / maxValue)
          })),
          scaleKeys: track.scaleKeys?.map(k => ({
            time: k.time,
            value: k.value.map(v => v / maxValue)
          }))
        }))
      };
    }

    _deltaDecodeAnimation(animation) {
      return {
        ...animation,
        tracks: animation.tracks.map(track => ({
          ...track,
          positionKeys: track.positionKeys ? this._deltaDecodeKeys(track.positionKeys) : null,
          rotationKeys: track.rotationKeys ? this._deltaDecodeKeys(track.rotationKeys) : null,
          scaleKeys: track.scaleKeys ? this._deltaDecodeKeys(track.scaleKeys) : null
        }))
      };
    }

    _deltaDecodeKeys(keys) {
      const decoded = [keys[0]];
      for (let i = 1; i < keys.length; i++) {
        const prev = decoded[i - 1];
        decoded.push({
          time: prev.time + keys[i].time,
          value: keys[i].value.map((v, j) => prev.value[j] + v)
        });
      }
      return decoded;
    }

    _estimateSize(data) {
      return JSON.stringify(data).length * 2;
    }

    setCompressionLevel(level) {
      this.compressionLevel = Math.max(0, Math.min(1, level));
      this.positionTolerance = 0.001 * (1 + level);
      this.rotationTolerance = 0.001 * (1 + level);
      this.scaleTolerance = 0.001 * (1 + level);
      this.quantizationBits = Math.max(8, Math.min(32, Math.round(16 - level * 8)));
    }

    getStats() { return { ...this.stats }; }
    setPositionTolerance(v) { this.positionTolerance = v; }
    setRotationTolerance(v) { this.rotationTolerance = v; }
    setScaleTolerance(v) { this.scaleTolerance = v; }
    setQuantizationBits(bits) { this.quantizationBits = Math.max(8, Math.min(32, bits)); }
    setKeyframeReduction(enabled) { this.useKeyframeReduction = enabled; }
    setQuantization(enabled) { this.useQuantization = enabled; }
    setDeltaEncoding(enabled) { this.useDeltaEncoding = enabled; }
    reset() {
      this.stats = { originalSize: 0, compressedSize: 0, ratio: 0, keyframesRemoved: 0 };
    }
  }

  class BoneRetargeter {
    constructor() {
      this.sourceSkeleton = null;
      this.targetSkeleton = null;
      this.boneMapping = new Map();
      this.retargetingOptions = {
        preserveOrientation: true,
        preserveLength: false,
        scaleBones: true,
        offsetRoot: true,
        mirror: false
      };
      this.calibrationData = null;
    }

    setSourceSkeleton(skeleton) {
      this.sourceSkeleton = skeleton;
      this._autoMapBones();
    }

    setTargetSkeleton(skeleton) {
      this.targetSkeleton = skeleton;
      this._autoMapBones();
    }

    _autoMapBones() {
      if (!this.sourceSkeleton || !this.targetSkeleton) return;
      this.boneMapping.clear();
      const commonBoneNames = [
        ['hips', 'pelvis', 'root', 'Hips', 'Pelvis', 'Root'],
        ['spine', 'Spine', 'spine_01'],
        ['chest', 'Chest', 'spine_02'],
        ['neck', 'Neck'],
        ['head', 'Head'],
        ['leftShoulder', 'L_Shoulder', 'LeftShoulder', 'shoulder_L'],
        ['leftUpperArm', 'L_UpperArm', 'LeftUpperArm', 'upperarm_L'],
        ['leftLowerArm', 'L_LowerArm', 'LeftLowerArm', 'lowerarm_L'],
        ['leftHand', 'L_Hand', 'LeftHand', 'hand_L'],
        ['rightShoulder', 'R_Shoulder', 'RightShoulder', 'shoulder_R'],
        ['rightUpperArm', 'R_UpperArm', 'RightUpperArm', 'upperarm_R'],
        ['rightLowerArm', 'R_LowerArm', 'RightLowerArm', 'lowerarm_R'],
        ['rightHand', 'R_Hand', 'RightHand', 'hand_R'],
        ['leftUpperLeg', 'L_UpperLeg', 'LeftUpperLeg', 'thigh_L'],
        ['leftLowerLeg', 'L_LowerLeg', 'LeftLowerLeg', 'calf_L'],
        ['leftFoot', 'L_Foot', 'LeftFoot', 'foot_L'],
        ['rightUpperLeg', 'R_UpperLeg', 'RightUpperLeg', 'thigh_R'],
        ['rightLowerLeg', 'R_LowerLeg', 'RightLowerLeg', 'calf_R'],
        ['rightFoot', 'R_Foot', 'RightFoot', 'foot_R']
      ];
      for (const nameGroup of commonBoneNames) {
        let sourceBone = null;
        let targetBone = null;
        for (const name of nameGroup) {
          if (!sourceBone && this.sourceSkeleton.boneMap?.has(name)) {
            sourceBone = name;
          }
          if (!targetBone && this.targetSkeleton.boneMap?.has(name)) {
            targetBone = name;
          }
        }
        if (sourceBone && targetBone) {
          this.boneMapping.set(sourceBone, targetBone);
        }
      }
    }

    mapBone(sourceBoneName, targetBoneName) {
      this.boneMapping.set(sourceBoneName, targetBoneName);
    }

    unmapBone(sourceBoneName) {
      this.boneMapping.delete(sourceBoneName);
    }

    getBoneMapping() {
      return Object.fromEntries(this.boneMapping);
    }

    calibrate() {
      if (!this.sourceSkeleton || !this.targetSkeleton) return null;
      this.calibrationData = {
        sourceBindPose: this._extractBindPose(this.sourceSkeleton),
        targetBindPose: this._extractBindPose(this.targetSkeleton),
        scaleFactors: this._computeScaleFactors()
      };
      return this.calibrationData;
    }

    _extractBindPose(skeleton) {
      const pose = {};
      for (const bone of skeleton.bones) {
        pose[bone.name] = {
          position: [...bone.position],
          rotation: [...bone.rotation],
          scale: [...bone.scale],
          length: bone.length || 0
        };
      }
      return pose;
    }

    _computeScaleFactors() {
      const factors = {};
      for (const [sourceBone, targetBone] of this.boneMapping) {
        const sourceLength = this.calibrationData.sourceBindPose[sourceBone]?.length || 1;
        const targetLength = this.calibrationData.targetBindPose[targetBone]?.length || 1;
        factors[sourceBone] = targetLength / sourceLength;
      }
      return factors;
    }

    retargetAnimation(animation) {
      if (!this.sourceSkeleton || !this.targetSkeleton || !this.calibrationData) {
        throw new Error('Skeletons and calibration data required for retargeting');
      }
      const retargeted = {
        name: animation.name + '_retargeted',
        duration: animation.duration,
        frameRate: animation.frameRate,
        tracks: []
      };
      for (const track of animation.tracks) {
        const targetBone = this.boneMapping.get(track.target);
        if (!targetBone) continue;
        const retargetedTrack = {
          target: targetBone,
          type: track.type,
          positionKeys: track.positionKeys ? this._retargetPositionKeys(track.positionKeys, track.target, targetBone) : null,
          rotationKeys: track.rotationKeys ? this._retargetRotationKeys(track.rotationKeys, track.target, targetBone) : null,
          scaleKeys: track.scaleKeys ? this._retargetScaleKeys(track.scaleKeys, track.target, targetBone) : null
        };
        retargeted.tracks.push(retargetedTrack);
      }
      return retargeted;
    }

    _retargetPositionKeys(keys, sourceBone, targetBone) {
      const scaleFactor = this.calibrationData.scaleFactors[sourceBone] || 1;
      const sourceBind = this.calibrationData.sourceBindPose[sourceBone];
      const targetBind = this.calibrationData.targetBindPose[targetBone];
      return keys.map(key => {
        let position = [...key.value];
        if (this.retargetingOptions.scaleBones) {
          position = position.map(v => v * scaleFactor);
        }
        if (this.retargetingOptions.offsetRoot && sourceBone === this.sourceSkeleton.rootBone?.name) {
          const offset = [
            (targetBind?.position[0] || 0) - (sourceBind?.position[0] || 0) * scaleFactor,
            (targetBind?.position[1] || 0) - (sourceBind?.position[1] || 0) * scaleFactor,
            (targetBind?.position[2] || 0) - (sourceBind?.position[2] || 0) * scaleFactor
          ];
          position = [position[0] + offset[0], position[1] + offset[1], position[2] + offset[2]];
        }
        return { time: key.time, value: position };
      });
    }

    _retargetRotationKeys(keys, sourceBone, targetBone) {
      const sourceBind = this.calibrationData.sourceBindPose[sourceBone];
      const targetBind = this.calibrationData.targetBindPose[targetBone];
      return keys.map(key => {
        let rotation = [...key.value];
        if (this.retargetingOptions.preserveOrientation && sourceBind && targetBind) {
          const sourceInv = this._invertQuaternion(sourceBind.rotation);
          const targetQuat = targetBind.rotation;
          rotation = this._multiplyQuaternions(targetQuat, this._multiplyQuaternions(sourceInv, rotation));
        }
        if (this.retargetingOptions.mirror) {
          rotation = [rotation[0], -rotation[1], -rotation[2], rotation[3]];
        }
        return { time: key.time, value: this._normalizeQuat(rotation) };
      });
    }

    _retargetScaleKeys(keys, sourceBone, targetBone) {
      return keys.map(key => ({ time: key.time, value: [...key.value] }));
    }

    _invertQuaternion(q) {
      const dot = q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3];
      return dot > 0 ? [-q[0]/dot, -q[1]/dot, -q[2]/dot, q[3]/dot] : [0, 0, 0, 1];
    }

    _multiplyQuaternions(a, b) {
      return [
        a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
        a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
        a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
        a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2]
      ];
    }

    _normalizeQuat(q) {
      const l = Math.sqrt(q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3]) || 1;
      return [q[0]/l, q[1]/l, q[2]/l, q[3]/l];
    }

    setRetargetingOption(name, value) {
      if (this.retargetingOptions.hasOwnProperty(name)) {
        this.retargetingOptions[name] = value;
      }
    }

    getRetargetingOptions() {
      return { ...this.retargetingOptions };
    }

    getMappedBoneCount() {
      return this.boneMapping.size;
    }

    clear() {
      this.sourceSkeleton = null;
      this.targetSkeleton = null;
      this.boneMapping.clear();
      this.calibrationData = null;
    }
  }

  class MeshOptimizer {
    constructor() {
      this.optimizationOptions = {
        weldVertices: true,
        weldTolerance: 0.0001,
        reindex: true,
        optimizeCache: true,
        computeNormals: false,
        computeTangents: false,
        simplify: false,
        simplificationRatio: 0.5,
        mergeDuplicateMaterials: true
      };
      this.stats = {
        originalVertices: 0,
        optimizedVertices: 0,
        originalIndices: 0,
        optimizedIndices: 0,
        trianglesRemoved: 0
      };
    }

    optimize(mesh) {
      this.stats.originalVertices = mesh.vertexCount;
      this.stats.originalIndices = mesh.indexCount;
      let result = { ...mesh };
      if (this.optimizationOptions.weldVertices) {
        result = this._weldVertices(result, this.optimizationOptions.weldTolerance);
      }
      if (this.optimizationOptions.reindex) {
        result = this._reindex(result);
      }
      if (this.optimizationOptions.optimizeCache) {
        result = this._optimizeVertexCache(result);
      }
      if (this.optimizationOptions.computeNormals && !result.normals) {
        result = this._computeNormals(result);
      }
      if (this.optimizationOptions.computeTangents && result.uvs && !result.tangents) {
        result = this._computeTangents(result);
      }
      if (this.optimizationOptions.simplify) {
        result = this._simplify(result, this.optimizationOptions.simplificationRatio);
      }
      this.stats.optimizedVertices = result.vertexCount;
      this.stats.optimizedIndices = result.indexCount;
      this.stats.trianglesRemoved = (this.stats.originalIndices - this.stats.optimizedIndices) / 3;
      return result;
    }

    _weldVertices(mesh, tolerance) {
      if (!mesh.indices) return mesh;
      const uniqueVertices = [];
      const vertexMap = new Map();
      const newIndices = [];
      for (let i = 0; i < mesh.indices.length; i++) {
        const idx = mesh.indices[i];
        const vertexKey = this._createVertexKey(mesh, idx, tolerance);
        if (vertexMap.has(vertexKey)) {
          newIndices.push(vertexMap.get(vertexKey));
        } else {
          const newIdx = uniqueVertices.length;
          vertexMap.set(vertexKey, newIdx);
          uniqueVertices.push(idx);
          newIndices.push(newIdx);
        }
      }
      const newVertices = new Float32Array(uniqueVertices.length * 3);
      const newNormals = mesh.normals ? new Float32Array(uniqueVertices.length * 3) : null;
      const newUVs = mesh.uvs ? new Float32Array(uniqueVertices.length * 2) : null;
      const newColors = mesh.colors ? new Float32Array(uniqueVertices.length * 3) : null;
      for (let i = 0; i < uniqueVertices.length; i++) {
        const srcIdx = uniqueVertices[i];
        newVertices[i*3] = mesh.vertices[srcIdx*3];
        newVertices[i*3+1] = mesh.vertices[srcIdx*3+1];
        newVertices[i*3+2] = mesh.vertices[srcIdx*3+2];
        if (newNormals) {
          newNormals[i*3] = mesh.normals[srcIdx*3];
          newNormals[i*3+1] = mesh.normals[srcIdx*3+1];
          newNormals[i*3+2] = mesh.normals[srcIdx*3+2];
        }
        if (newUVs) {
          newUVs[i*2] = mesh.uvs[srcIdx*2];
          newUVs[i*2+1] = mesh.uvs[srcIdx*2+1];
        }
        if (newColors) {
          newColors[i*3] = mesh.colors[srcIdx*3];
          newColors[i*3+1] = mesh.colors[srcIdx*3+1];
          newColors[i*3+2] = mesh.colors[srcIdx*3+2];
        }
      }
      return {
        ...mesh,
        vertices: newVertices,
        normals: newNormals,
        uvs: newUVs,
        colors: newColors,
        indices: new Uint32Array(newIndices),
        vertexCount: uniqueVertices.length,
        indexCount: newIndices.length
      };
    }

    _createVertexKey(mesh, idx, tolerance) {
      const x = Math.round(mesh.vertices[idx*3] / tolerance);
      const y = Math.round(mesh.vertices[idx*3+1] / tolerance);
      const z = Math.round(mesh.vertices[idx*3+2] / tolerance);
      let key = `${x},${y},${z}`;
      if (mesh.normals) {
        const nx = Math.round(mesh.normals[idx*3] / 0.01);
        const ny = Math.round(mesh.normals[idx*3+1] / 0.01);
        const nz = Math.round(mesh.normals[idx*3+2] / 0.01);
        key += `,${nx},${ny},${nz}`;
      }
      if (mesh.uvs) {
        const u = Math.round(mesh.uvs[idx*2] / 0.001);
        const v = Math.round(mesh.uvs[idx*2+1] / 0.001);
        key += `,${u},${v}`;
      }
      return key;
    }

    _reindex(mesh) {
      if (mesh.indices) return mesh;
      const uniqueMap = new Map();
      const indices = [];
      const vertices = [];
      const normals = mesh.normals ? [] : null;
      const uvs = mesh.uvs ? [] : null;
      const vertexCount = mesh.vertices.length / 3;
      for (let i = 0; i < vertexCount; i++) {
        const key = `${mesh.vertices[i*3]},${mesh.vertices[i*3+1]},${mesh.vertices[i*3+2]}`;
        if (uniqueMap.has(key)) {
          indices.push(uniqueMap.get(key));
        } else {
          const newIdx = vertices.length / 3;
          uniqueMap.set(key, newIdx);
          vertices.push(mesh.vertices[i*3], mesh.vertices[i*3+1], mesh.vertices[i*3+2]);
          if (normals) normals.push(mesh.normals[i*3], mesh.normals[i*3+1], mesh.normals[i*3+2]);
          if (uvs) uvs.push(mesh.uvs[i*2], mesh.uvs[i*2+1]);
          indices.push(newIdx);
        }
      }
      return {
        ...mesh,
        vertices: new Float32Array(vertices),
        normals: normals ? new Float32Array(normals) : null,
        uvs: uvs ? new Float32Array(uvs) : null,
        indices: new Uint32Array(indices),
        vertexCount: vertices.length / 3,
        indexCount: indices.length
      };
    }

    _optimizeVertexCache(mesh) {
      if (!mesh.indices) return mesh;
      const indices = Array.from(mesh.indices);
      const vertexCount = mesh.vertexCount;
      const cache = [];
      const cacheSize = 32;
      const triangleScore = [];
      for (let i = 0; i < indices.length; i += 3) {
        let score = 0;
        for (let j = 0; j < 3; j++) {
          const idx = indices[i + j];
          if (cache.includes(idx)) score += 10;
          else score += 1;
        }
        triangleScore.push(score);
      }
      const newIndices = [];
      const remaining = new Set(Array.from({ length: indices.length / 3 }, (_, i) => i));
      while (remaining.size > 0) {
        let bestTriangle = -1;
        let bestScore = -1;
        for (const triIdx of remaining) {
          if (triangleScore[triIdx] > bestScore) {
            bestScore = triangleScore[triIdx];
            bestTriangle = triIdx;
          }
        }
        if (bestTriangle === -1) break;
        remaining.delete(bestTriangle);
        for (let j = 0; j < 3; j++) {
          const idx = indices[bestTriangle * 3 + j];
          newIndices.push(idx);
          const cacheIdx = cache.indexOf(idx);
          if (cacheIdx !== -1) cache.splice(cacheIdx, 1);
          cache.unshift(idx);
          if (cache.length > cacheSize) cache.pop();
        }
        for (const triIdx of remaining) {
          let score = 0;
          for (let j = 0; j < 3; j++) {
            const idx = indices[triIdx * 3 + j];
            if (cache.includes(idx)) score += 10;
            else score += 1;
          }
          triangleScore[triIdx] = score;
        }
      }
      return { ...mesh, indices: new Uint32Array(newIndices) };
    }

    _computeNormals(mesh) {
      if (!mesh.indices || !mesh.vertices) return mesh;
      const normals = new Float32Array(mesh.vertices.length);
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const a = mesh.indices[i] * 3;
        const b = mesh.indices[i + 1] * 3;
        const c = mesh.indices[i + 2] * 3;
        const e1 = [mesh.vertices[b] - mesh.vertices[a], mesh.vertices[b+1] - mesh.vertices[a+1], mesh.vertices[b+2] - mesh.vertices[a+2]];
        const e2 = [mesh.vertices[c] - mesh.vertices[a], mesh.vertices[c+1] - mesh.vertices[a+1], mesh.vertices[c+2] - mesh.vertices[a+2]];
        const n = [e1[1]*e2[2] - e1[2]*e2[1], e1[2]*e2[0] - e1[0]*e2[2], e1[0]*e2[1] - e1[1]*e2[0]];
        normals[a] += n[0]; normals[a+1] += n[1]; normals[a+2] += n[2];
        normals[b] += n[0]; normals[b+1] += n[1]; normals[b+2] += n[2];
        normals[c] += n[0]; normals[c+1] += n[1]; normals[c+2] += n[2];
      }
      for (let i = 0; i < normals.length; i += 3) {
        const l = Math.sqrt(normals[i]**2 + normals[i+1]**2 + normals[i+2]**2) || 1;
        normals[i] /= l; normals[i+1] /= l; normals[i+2] /= l;
      }
      return { ...mesh, normals };
    }

    _computeTangents(mesh) {
      if (!mesh.indices || !mesh.vertices || !mesh.uvs) return mesh;
      const tangents = new Float32Array(mesh.vertices.length);
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const a = mesh.indices[i];
        const b = mesh.indices[i + 1];
        const c = mesh.indices[i + 2];
        const e1 = [mesh.vertices[b*3] - mesh.vertices[a*3], mesh.vertices[b*3+1] - mesh.vertices[a*3+1], mesh.vertices[b*3+2] - mesh.vertices[a*3+2]];
        const e2 = [mesh.vertices[c*3] - mesh.vertices[a*3], mesh.vertices[c*3+1] - mesh.vertices[a*3+1], mesh.vertices[c*3+2] - mesh.vertices[a*3+2]];
        const duv1 = [mesh.uvs[b*2] - mesh.uvs[a*2], mesh.uvs[b*2+1] - mesh.uvs[a*2+1]];
        const duv2 = [mesh.uvs[c*2] - mesh.uvs[a*2], mesh.uvs[c*2+1] - mesh.uvs[a*2+1]];
        const f = 1 / (duv1[0] * duv2[1] - duv2[0] * duv1[1] + 0.0001);
        const t = [f * (duv2[1] * e1[0] - duv1[1] * e2[0]), f * (duv2[1] * e1[1] - duv1[1] * e2[1]), f * (duv2[1] * e1[2] - duv1[1] * e2[2])];
        for (const idx of [a, b, c]) {
          tangents[idx*3] += t[0]; tangents[idx*3+1] += t[1]; tangents[idx*3+2] += t[2];
        }
      }
      for (let i = 0; i < tangents.length; i += 3) {
        const n = mesh.normals ? [mesh.normals[i], mesh.normals[i+1], mesh.normals[i+2]] : [0, 1, 0];
        const t = [tangents[i], tangents[i+1], tangents[i+2]];
        const dot = n[0]*t[0] + n[1]*t[1] + n[2]*t[2];
        tangents[i] = t[0] - n[0] * dot;
        tangents[i+1] = t[1] - n[1] * dot;
        tangents[i+2] = t[2] - n[2] * dot;
        const l = Math.sqrt(tangents[i]**2 + tangents[i+1]**2 + tangents[i+2]**2) || 1;
        tangents[i] /= l; tangents[i+1] /= l; tangents[i+2] /= l;
      }
      return { ...mesh, tangents };
    }

    _simplify(mesh, ratio) {
      const targetIndexCount = Math.floor(mesh.indexCount * ratio);
      if (mesh.indexCount <= targetIndexCount) return mesh;
      const vertexError = new Float32Array(mesh.vertexCount).fill(Infinity);
      const vertexCollapse = new Int32Array(mesh.vertexCount).fill(-1);
      const edges = this._findEdges(mesh);
      for (const edge of edges) {
        const error = this._computeEdgeError(mesh, edge[0], edge[1]);
        if (error < vertexError[edge[0]]) {
          vertexError[edge[0]] = error;
          vertexCollapse[edge[0]] = edge[1];
        }
      }
      const sortedVertices = Array.from({ length: mesh.vertexCount }, (_, i) => i)
        .filter(v => vertexCollapse[v] !== -1)
        .sort((a, b) => vertexError[a] - vertexError[b]);
      const vertexMap = new Int32Array(mesh.vertexCount).fill(-1);
      const newVertices = [];
      const newIndices = [];
      let collapseCount = 0;
      const maxCollapses = mesh.vertexCount - Math.floor(mesh.vertexCount * ratio);
      for (const vertex of sortedVertices) {
        if (collapseCount >= maxCollapses) break;
        if (vertexCollapse[vertex] !== -1 && vertexMap[vertex] === -1) {
          vertexMap[vertex] = vertexCollapse[vertex];
          collapseCount++;
        }
      }
      for (let i = 0; i < mesh.vertexCount; i++) {
        if (vertexMap[i] === -1) {
          vertexMap[i] = newVertices.length;
          newVertices.push(i);
        } else {
          vertexMap[i] = vertexMap[vertexMap[i]];
        }
      }
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const a = vertexMap[mesh.indices[i]];
        const b = vertexMap[mesh.indices[i + 1]];
        const c = vertexMap[mesh.indices[i + 2]];
        if (a !== b && b !== c && a !== c) {
          newIndices.push(a, b, c);
        }
      }
      const resultVertices = new Float32Array(newVertices.length * 3);
      const resultNormals = mesh.normals ? new Float32Array(newVertices.length * 3) : null;
      const resultUVs = mesh.uvs ? new Float32Array(newVertices.length * 2) : null;
      for (let i = 0; i < newVertices.length; i++) {
        const srcIdx = newVertices[i];
        resultVertices[i*3] = mesh.vertices[srcIdx*3];
        resultVertices[i*3+1] = mesh.vertices[srcIdx*3+1];
        resultVertices[i*3+2] = mesh.vertices[srcIdx*3+2];
        if (resultNormals) {
          resultNormals[i*3] = mesh.normals[srcIdx*3];
          resultNormals[i*3+1] = mesh.normals[srcIdx*3+1];
          resultNormals[i*3+2] = mesh.normals[srcIdx*3+2];
        }
        if (resultUVs) {
          resultUVs[i*2] = mesh.uvs[srcIdx*2];
          resultUVs[i*2+1] = mesh.uvs[srcIdx*2+1];
        }
      }
      return {
        ...mesh,
        vertices: resultVertices,
        normals: resultNormals,
        uvs: resultUVs,
        indices: new Uint32Array(newIndices),
        vertexCount: newVertices.length,
        indexCount: newIndices.length
      };
    }

    _findEdges(mesh) {
      const edges = new Set();
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const a = mesh.indices[i];
        const b = mesh.indices[i + 1];
        const c = mesh.indices[i + 2];
        edges.add(`${Math.min(a,b)},${Math.max(a,b)}`);
        edges.add(`${Math.min(b,c)},${Math.max(b,c)}`);
        edges.add(`${Math.min(c,a)},${Math.max(c,a)}`);
      }
      return Array.from(edges).map(e => e.split(',').map(Number));
    }

    _computeEdgeError(mesh, a, b) {
      const error = [
        mesh.vertices[a*3] - mesh.vertices[b*3],
        mesh.vertices[a*3+1] - mesh.vertices[b*3+1],
        mesh.vertices[a*3+2] - mesh.vertices[b*3+2]
      ];
      return Math.sqrt(error[0]**2 + error[1]**2 + error[2]**2);
    }

    setOption(name, value) {
      if (this.optimizationOptions.hasOwnProperty(name)) {
        this.optimizationOptions[name] = value;
      }
    }

    getOptions() {
      return { ...this.optimizationOptions };
    }

    getStats() {
      return { ...this.stats };
    }

    reset() {
      this.stats = {
        originalVertices: 0,
        optimizedVertices: 0,
        originalIndices: 0,
        optimizedIndices: 0,
        trianglesRemoved: 0
      };
    }
  }

  return {
    AnimationCompressor, BoneRetargeter, MeshOptimizer
  };
})();

if (typeof window !== 'undefined') window.ModelFormatsV3 = ModelFormatsV3;
if (typeof globalThis !== 'undefined') globalThis.ModelFormatsV3 = ModelFormatsV3;
