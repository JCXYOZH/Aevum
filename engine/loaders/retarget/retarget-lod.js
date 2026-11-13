/**
 * 模型格式 - 动画压缩/骨骼重定向/网格优化/格式转换/LOD生成
 * 纯JavaScript，零第三方依赖
 * @version 5.0.0
 */
'use strict';

const ModelFormatsV5 = (function () {

  class AnimationCompressor {
    constructor() {
      this.positionTolerance = 0.001;
      this.rotationTolerance = 0.001;
      this.scaleTolerance = 0.001;
      this.quantizationBits = 16;
      this.enabled = true;
      this.stats = { compressed: 0, originalSize: 0, compressedSize: 0, ratio: 0 };
    }

    compress(animationData, options = {}) {
      const tolerance = {
        position: options.positionTolerance || this.positionTolerance,
        rotation: options.rotationTolerance || this.rotationTolerance,
        scale: options.scaleTolerance || this.scaleTolerance
      };
      const compressed = {
        name: animationData.name,
        duration: animationData.duration,
        fps: animationData.fps,
        tracks: []
      };
      let originalKeyframes = 0;
      let compressedKeyframes = 0;
      for (const track of animationData.tracks) {
        const compressedTrack = {
          boneName: track.boneName,
          type: track.type,
          keyframes: []
        };
        originalKeyframes += track.keyframes.length;
        const keyframes = this._compressKeyframes(track.keyframes, track.type, tolerance);
        compressedTrack.keyframes = keyframes;
        compressedKeyframes += keyframes.length;
        compressed.tracks.push(compressedTrack);
      }
      if (options.quantize) {
        this._quantize(compressed, options.quantizationBits || this.quantizationBits);
      }
      this.stats.compressed++;
      this.stats.originalSize += originalKeyframes;
      this.stats.compressedSize += compressedKeyframes;
      this.stats.ratio = this.stats.originalSize > 0 ? 1 - this.stats.compressedSize / this.stats.originalSize : 0;
      return compressed;
    }

    _compressKeyframes(keyframes, type, tolerance) {
      if (keyframes.length <= 2) return [...keyframes];
      const compressed = [keyframes[0]];
      let lastKeyframe = keyframes[0];
      for (let i = 1; i < keyframes.length - 1; i++) {
        const interpolated = this._interpolate(lastKeyframe, keyframes[i + 1], keyframes[i].time, type);
        const difference = this._calculateDifference(keyframes[i], interpolated, type);
        const tol = type === 'position' ? tolerance.position : type === 'rotation' ? tolerance.rotation : tolerance.scale;
        if (difference > tol) {
          compressed.push(keyframes[i]);
          lastKeyframe = keyframes[i];
        }
      }
      compressed.push(keyframes[keyframes.length - 1]);
      return compressed;
    }

    _interpolate(a, b, time, type) {
      const t = (time - a.time) / (b.time - a.time);
      if (type === 'rotation') {
        return {
          time,
          value: this._slerp(a.value, b.value, t)
        };
      }
      return {
        time,
        value: [
          a.value[0] + (b.value[0] - a.value[0]) * t,
          a.value[1] + (b.value[1] - a.value[1]) * t,
          a.value[2] + (b.value[2] - a.value[2]) * t
        ]
      };
    }

    _slerp(a, b, t) {
      let dot = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
      let b1 = [...b];
      if (dot < 0) {
        b1 = [-b[0], -b[1], -b[2], -b[3]];
        dot = -dot;
      }
      if (dot > 0.9995) {
        return [
          a[0] + (b1[0] - a[0]) * t,
          a[1] + (b1[1] - a[1]) * t,
          a[2] + (b1[2] - a[2]) * t,
          a[3] + (b1[3] - a[3]) * t
        ];
      }
      const theta0 = Math.acos(dot);
      const theta = theta0 * t;
      const sinTheta = Math.sin(theta);
      const sinTheta0 = Math.sin(theta0);
      const s0 = Math.cos(theta) - dot * sinTheta / sinTheta0;
      const s1 = sinTheta / sinTheta0;
      return [
        s0 * a[0] + s1 * b1[0],
        s0 * a[1] + s1 * b1[1],
        s0 * a[2] + s1 * b1[2],
        s0 * a[3] + s1 * b1[3]
      ];
    }

    _calculateDifference(a, b, type) {
      if (type === 'rotation') {
        const dot = Math.abs(a.value[0]*b.value[0] + a.value[1]*b.value[1] + a.value[2]*b.value[2] + a.value[3]*b.value[3]);
        return 1 - Math.min(1, dot);
      }
      return Math.sqrt(
        (a.value[0] - b.value[0])**2 +
        (a.value[1] - b.value[1])**2 +
        (a.value[2] - b.value[2])**2
      );
    }

    _quantize(animation, bits) {
      const maxValue = (1 << bits) - 1;
      for (const track of animation.tracks) {
        for (const keyframe of track.keyframes) {
          if (track.type === 'rotation') {
            keyframe.value = keyframe.value.map(v => Math.round((v + 1) / 2 * maxValue) / maxValue * 2 - 1);
          } else {
            keyframe.value = keyframe.value.map(v => Math.round(v * 1000) / 1000);
          }
        }
      }
    }

    decompress(compressedData) {
      const animation = {
        name: compressedData.name,
        duration: compressedData.duration,
        fps: compressedData.fps,
        tracks: []
      };
      for (const track of compressedData.tracks) {
        const decompressedTrack = {
          boneName: track.boneName,
          type: track.type,
          keyframes: [...track.keyframes]
        };
        animation.tracks.push(decompressedTrack);
      }
      return animation;
    }

    setTolerance(position, rotation, scale) {
      this.positionTolerance = position;
      this.rotationTolerance = rotation;
      this.scaleTolerance = scale;
    }

    setQuantizationBits(bits) {
      this.quantizationBits = bits;
    }

    getStats() {
      return { ...this.stats };
    }

    setEnabled(v) {
      this.enabled = v;
    }

    resetStats() {
      this.stats = { compressed: 0, originalSize: 0, compressedSize: 0, ratio: 0 };
    }
  }

  class BoneRetargeter {
    constructor() {
      this.boneMappings = new Map();
      this.sourceSkeleton = null;
      this.targetSkeleton = null;
      this.retargetingOptions = {
        scale: 1,
        offset: [0, 0, 0],
        mirror: false,
        preservePose: true,
        correctionThreshold: 0.01
      };
      this.stats = { retargeted: 0, bonesMapped: 0, bonesUnmapped: 0 };
    }

    setSourceSkeleton(skeleton) {
      this.sourceSkeleton = skeleton;
    }

    setTargetSkeleton(skeleton) {
      this.targetSkeleton = skeleton;
    }

    addBoneMapping(sourceBone, targetBone) {
      this.boneMappings.set(sourceBone, targetBone);
    }

    removeBoneMapping(sourceBone) {
      this.boneMappings.delete(sourceBone);
    }

    autoMapBones() {
      if (!this.sourceSkeleton || !this.targetSkeleton) return false;
      this.boneMappings.clear();
      const sourceBones = this.sourceSkeleton.bones || [];
      const targetBones = this.targetSkeleton.bones || [];
      const commonNames = [
        ['hips', 'hip', 'pelvis', 'root'],
        ['spine', 'spine1', 'spine2', 'spine3'],
        ['neck', 'neck1', 'neck2'],
        ['head', 'head1', 'head2'],
        ['left_shoulder', 'l_shoulder', 'shoulder_l', 'leftShoulder'],
        ['left_arm', 'l_arm', 'arm_l', 'leftArm', 'left_upper_arm'],
        ['left_forearm', 'l_forearm', 'forearm_l', 'leftForearm', 'left_lower_arm'],
        ['left_hand', 'l_hand', 'hand_l', 'leftHand'],
        ['right_shoulder', 'r_shoulder', 'shoulder_r', 'rightShoulder'],
        ['right_arm', 'r_arm', 'arm_r', 'rightArm', 'right_upper_arm'],
        ['right_forearm', 'r_forearm', 'forearm_r', 'rightForearm', 'right_lower_arm'],
        ['right_hand', 'r_hand', 'hand_r', 'rightHand'],
        ['left_upleg', 'l_upleg', 'upleg_l', 'leftUpLeg', 'left_thigh'],
        ['left_leg', 'l_leg', 'leg_l', 'leftLeg', 'left_calf'],
        ['left_foot', 'l_foot', 'foot_l', 'leftFoot'],
        ['right_upleg', 'r_upleg', 'upleg_r', 'rightUpLeg', 'right_thigh'],
        ['right_leg', 'r_leg', 'leg_r', 'rightLeg', 'right_calf'],
        ['right_foot', 'r_foot', 'foot_r', 'rightFoot']
      ];
      for (const nameGroup of commonNames) {
        let sourceBone = null;
        let targetBone = null;
        for (const name of nameGroup) {
          if (!sourceBone) {
            sourceBone = sourceBones.find(b => b.name.toLowerCase() === name.toLowerCase());
          }
          if (!targetBone) {
            targetBone = targetBones.find(b => b.name.toLowerCase() === name.toLowerCase());
          }
        }
        if (sourceBone && targetBone) {
          this.boneMappings.set(sourceBone.name, targetBone.name);
        }
      }
      this.stats.bonesMapped = this.boneMappings.size;
      this.stats.bonesUnmapped = sourceBones.length - this.boneMappings.size;
      return true;
    }

    retargetAnimation(animation) {
      if (!this.sourceSkeleton || !this.targetSkeleton) {
        throw new Error('Source and target skeletons must be set');
      }
      const retargeted = {
        name: animation.name + '_retargeted',
        duration: animation.duration,
        fps: animation.fps,
        tracks: []
      };
      const scale = this._calculateScale();
      for (const track of animation.tracks) {
        const targetBoneName = this.boneMappings.get(track.boneName);
        if (!targetBoneName) continue;
        const retargetedTrack = {
          boneName: targetBoneName,
          type: track.type,
          keyframes: []
        };
        for (const keyframe of track.keyframes) {
          const retargetedKeyframe = {
            time: keyframe.time,
            value: [...keyframe.value]
          };
          if (track.type === 'position') {
            retargetedKeyframe.value[0] *= scale;
            retargetedKeyframe.value[1] *= scale;
            retargetedKeyframe.value[2] *= scale;
            if (this.retargetingOptions.mirror) {
              retargetedKeyframe.value[0] = -retargetedKeyframe.value[0];
            }
            retargetedKeyframe.value[0] += this.retargetingOptions.offset[0];
            retargetedKeyframe.value[1] += this.retargetingOptions.offset[1];
            retargetedKeyframe.value[2] += this.retargetingOptions.offset[2];
          } else if (track.type === 'rotation') {
            if (this.retargetingOptions.mirror) {
              retargetedKeyframe.value[1] = -retargetedKeyframe.value[1];
              retargetedKeyframe.value[2] = -retargetedKeyframe.value[2];
            }
          }
          retargetedTrack.keyframes.push(retargetedKeyframe);
        }
        retargeted.tracks.push(retargetedTrack);
      }
      this.stats.retargeted++;
      return retargeted;
    }

    _calculateScale() {
      if (!this.sourceSkeleton || !this.targetSkeleton) return 1;
      const sourceHeight = this._calculateSkeletonHeight(this.sourceSkeleton);
      const targetHeight = this._calculateSkeletonHeight(this.targetSkeleton);
      if (sourceHeight > 0 && targetHeight > 0) {
        return targetHeight / sourceHeight;
      }
      return this.retargetingOptions.scale;
    }

    _calculateSkeletonHeight(skeleton) {
      if (!skeleton.bones || skeleton.bones.length === 0) return 0;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const bone of skeleton.bones) {
        if (bone.position) {
          minY = Math.min(minY, bone.position[1]);
          maxY = Math.max(maxY, bone.position[1]);
        }
      }
      return maxY - minY;
    }

    getBoneMappings() {
      return Object.fromEntries(this.boneMappings);
    }

    getMappingCount() {
      return this.boneMappings.size;
    }

    getUnmappedSourceBones() {
      if (!this.sourceSkeleton) return [];
      return this.sourceSkeleton.bones.filter(b => !this.boneMappings.has(b.name)).map(b => b.name);
    }

    setRetargetingOptions(options) {
      this.retargetingOptions = { ...this.retargetingOptions, ...options };
    }

    getRetargetingOptions() {
      return { ...this.retargetingOptions };
    }

    getStats() {
      return { ...this.stats };
    }

    clearMappings() {
      this.boneMappings.clear();
      this.stats.bonesMapped = 0;
      this.stats.bonesUnmapped = 0;
    }

    reset() {
      this.clearMappings();
      this.sourceSkeleton = null;
      this.targetSkeleton = null;
      this.stats = { retargeted: 0, bonesMapped: 0, bonesUnmapped: 0 };
    }
  }

  class MeshOptimizer {
    constructor() {
      this.options = {
        targetTriangleCount: 0,
        targetError: 0.001,
        preserveBorders: true,
        preserveNormals: true,
        preserveUVs: true,
        lockBoundary: true,
        optimizeVertexCache: true,
        optimizeOverdraw: true,
        simplify: true,
        weldVertices: true,
        weldTolerance: 0.0001
      };
      this.stats = { optimized: 0, originalTriangles: 0, optimizedTriangles: 0, ratio: 0 };
    }

    optimize(meshData, options = {}) {
      const opts = { ...this.options, ...options };
      let result = { ...meshData };
      if (opts.weldVertices) {
        result = this._weldVertices(result, opts.weldTolerance);
      }
      if (opts.simplify && opts.targetTriangleCount > 0) {
        result = this._simplify(result, opts);
      }
      if (opts.optimizeVertexCache) {
        result = this._optimizeVertexCache(result);
      }
      if (opts.optimizeOverdraw) {
        result = this._optimizeOverdraw(result);
      }
      this.stats.optimized++;
      this.stats.originalTriangles += meshData.indices ? meshData.indices.length / 3 : meshData.vertices.length / 3;
      this.stats.optimizedTriangles += result.indices ? result.indices.length / 3 : result.vertices.length / 3;
      this.stats.ratio = this.stats.originalTriangles > 0 ? 1 - this.stats.optimizedTriangles / this.stats.originalTriangles : 0;
      return result;
    }

    _weldVertices(meshData, tolerance) {
      if (!meshData.indices) return meshData;
      const uniqueVertices = [];
      const vertexMap = new Map();
      const newIndices = [];
      for (let i = 0; i < meshData.indices.length; i++) {
        const idx = meshData.indices[i];
        const vertexKey = this._createVertexKey(meshData, idx, tolerance);
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
      const newNormals = meshData.normals ? new Float32Array(uniqueVertices.length * 3) : null;
      const newUVs = meshData.uvs ? new Float32Array(uniqueVertices.length * 2) : null;
      for (let i = 0; i < uniqueVertices.length; i++) {
        const srcIdx = uniqueVertices[i];
        newVertices[i*3] = meshData.vertices[srcIdx*3];
        newVertices[i*3+1] = meshData.vertices[srcIdx*3+1];
        newVertices[i*3+2] = meshData.vertices[srcIdx*3+2];
        if (newNormals) {
          newNormals[i*3] = meshData.normals[srcIdx*3];
          newNormals[i*3+1] = meshData.normals[srcIdx*3+1];
          newNormals[i*3+2] = meshData.normals[srcIdx*3+2];
        }
        if (newUVs) {
          newUVs[i*2] = meshData.uvs[srcIdx*2];
          newUVs[i*2+1] = meshData.uvs[srcIdx*2+1];
        }
      }
      return {
        ...meshData,
        vertices: newVertices,
        normals: newNormals,
        uvs: newUVs,
        indices: new Uint32Array(newIndices),
        vertexCount: uniqueVertices.length
      };
    }

    _createVertexKey(meshData, idx, tolerance) {
      const x = Math.round(meshData.vertices[idx*3] / tolerance);
      const y = Math.round(meshData.vertices[idx*3+1] / tolerance);
      const z = Math.round(meshData.vertices[idx*3+2] / tolerance);
      let key = `${x},${y},${z}`;
      if (meshData.normals) {
        const nx = Math.round(meshData.normals[idx*3] / 0.01);
        const ny = Math.round(meshData.normals[idx*3+1] / 0.01);
        const nz = Math.round(meshData.normals[idx*3+2] / 0.01);
        key += `,${nx},${ny},${nz}`;
      }
      if (meshData.uvs) {
        const u = Math.round(meshData.uvs[idx*2] / 0.001);
        const v = Math.round(meshData.uvs[idx*2+1] / 0.001);
        key += `,${u},${v}`;
      }
      return key;
    }

    _simplify(meshData, options) {
      if (!meshData.indices) return meshData;
      const targetCount = options.targetTriangleCount;
      const currentCount = meshData.indices.length / 3;
      if (currentCount <= targetCount) return meshData;
      const vertices = Array.from(meshData.vertices);
      const indices = Array.from(meshData.indices);
      const vertexErrors = new Array(vertices.length / 3).fill(0);
      const vertexTriangles = new Map();
      for (let i = 0; i < indices.length; i += 3) {
        for (let j = 0; j < 3; j++) {
          const v = indices[i + j];
          if (!vertexTriangles.has(v)) vertexTriangles.set(v, []);
          vertexTriangles.get(v).push(i / 3);
        }
      }
      for (let i = 0; i < vertices.length / 3; i++) {
        vertexErrors[i] = this._calculateVertexError(i, vertices, indices, vertexTriangles);
      }
      while (indices.length / 3 > targetCount) {
        let minError = Infinity;
        let minVertex = -1;
        for (let i = 0; i < vertices.length / 3; i++) {
          if (vertexErrors[i] < minError && vertexTriangles.get(i)?.length > 0) {
            minError = vertexErrors[i];
            minVertex = i;
          }
        }
        if (minVertex === -1 || minError > options.targetError * 100) break;
        this._collapseVertex(minVertex, vertices, indices, vertexTriangles, vertexErrors);
      }
      return {
        ...meshData,
        vertices: new Float32Array(vertices),
        indices: new Uint32Array(indices),
        vertexCount: vertices.length / 3
      };
    }

    _calculateVertexError(vertexIndex, vertices, indices, vertexTriangles) {
      const triangles = vertexTriangles.get(vertexIndex);
      if (!triangles || triangles.length === 0) return Infinity;
      let error = 0;
      for (const triIndex of triangles) {
        const i = triIndex * 3;
        const a = indices[i] * 3;
        const b = indices[i + 1] * 3;
        const c = indices[i + 2] * 3;
        const area = this._triangleArea(
          [vertices[a], vertices[a+1], vertices[a+2]],
          [vertices[b], vertices[b+1], vertices[b+2]],
          [vertices[c], vertices[c+1], vertices[c+2]]
        );
        error += area;
      }
      return error / triangles.length;
    }

    _triangleArea(a, b, c) {
      const e1 = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
      const e2 = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
      const cross = [e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
      return 0.5 * Math.sqrt(cross[0]**2 + cross[1]**2 + cross[2]**2);
    }

    _collapseVertex(vertexIndex, vertices, indices, vertexTriangles, vertexErrors) {
      const triangles = vertexTriangles.get(vertexIndex);
      if (!triangles) return;
      const neighbors = new Set();
      for (const triIndex of triangles) {
        const i = triIndex * 3;
        for (let j = 0; j < 3; j++) {
          if (indices[i + j] !== vertexIndex) {
            neighbors.add(indices[i + j]);
          }
        }
      }
      if (neighbors.size === 0) return;
      let bestNeighbor = -1;
      let bestDistance = Infinity;
      for (const neighbor of neighbors) {
        const dx = vertices[vertexIndex*3] - vertices[neighbor*3];
        const dy = vertices[vertexIndex*3+1] - vertices[neighbor*3+1];
        const dz = vertices[vertexIndex*3+2] - vertices[neighbor*3+2];
        const distance = dx*dx + dy*dy + dz*dz;
        if (distance < bestDistance) {
          bestDistance = distance;
          bestNeighbor = neighbor;
        }
      }
      if (bestNeighbor === -1) return;
      for (let i = indices.length - 3; i >= 0; i -= 3) {
        let containsVertex = false;
        let containsNeighbor = false;
        for (let j = 0; j < 3; j++) {
          if (indices[i + j] === vertexIndex) containsVertex = true;
          if (indices[i + j] === bestNeighbor) containsNeighbor = true;
        }
        if (containsVertex && containsNeighbor) {
          indices.splice(i, 3);
        } else if (containsVertex) {
          for (let j = 0; j < 3; j++) {
            if (indices[i + j] === vertexIndex) {
              indices[i + j] = bestNeighbor;
            }
          }
        }
      }
      vertexTriangles.delete(vertexIndex);
      vertexErrors[vertexIndex] = Infinity;
    }

    _optimizeVertexCache(meshData) {
      if (!meshData.indices) return meshData;
      const indices = Array.from(meshData.indices);
      const vertexCount = meshData.vertexCount || meshData.vertices.length / 3;
      const cache = [];
      const cacheSize = 32;
      const triangleScore = [];
      for (let i = 0; i < indices.length; i += 3) {
        let score = 0;
        for (let j = 0; j < 3; j++) {
          if (cache.includes(indices[i + j])) score += 10;
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
            if (cache.includes(indices[triIdx * 3 + j])) score += 10;
            else score += 1;
          }
          triangleScore[triIdx] = score;
        }
      }
      return { ...meshData, indices: new Uint32Array(newIndices) };
    }

    _optimizeOverdraw(meshData) {
      return meshData;
    }

    generateLOD(meshData, levels = 3) {
      const lods = [meshData];
      const baseTriangleCount = meshData.indices ? meshData.indices.length / 3 : meshData.vertices.length / 3;
      for (let i = 1; i < levels; i++) {
        const targetCount = Math.floor(baseTriangleCount * Math.pow(0.5, i));
        const lod = this.optimize(meshData, {
          targetTriangleCount: targetCount,
          simplify: true,
          weldVertices: true
        });
        lods.push(lod);
      }
      return lods;
    }

    setOptions(options) {
      this.options = { ...this.options, ...options };
    }

    getOptions() {
      return { ...this.options };
    }

    getStats() {
      return { ...this.stats };
    }

    resetStats() {
      this.stats = { optimized: 0, originalTriangles: 0, optimizedTriangles: 0, ratio: 0 };
    }
  }

  class FormatConverter {
    constructor() {
      this.converters = new Map();
      this.supportedFormats = new Set();
      this.stats = { converted: 0, failed: 0 };
      this._initDefaultConverters();
    }

    _initDefaultConverters() {
      this.supportedFormats.add('pmx');
      this.supportedFormats.add('pmd');
      this.supportedFormats.add('gltf');
      this.supportedFormats.add('glb');
      this.supportedFormats.add('obj');
      this.supportedFormats.add('fbx');
      this.supportedFormats.add('vrm');
      this.supportedFormats.add('vmd');
    }

    registerConverter(fromFormat, toFormat, converter) {
      const key = `${fromFormat}_to_${toFormat}`;
      this.converters.set(key, converter);
    }

    async convert(data, fromFormat, toFormat, options = {}) {
      const key = `${fromFormat}_to_${toFormat}`;
      const converter = this.converters.get(key);
      if (!converter) {
        throw new Error(`No converter from ${fromFormat} to ${toFormat}`);
      }
      try {
        const result = await converter(data, options);
        this.stats.converted++;
        return result;
      } catch (error) {
        this.stats.failed++;
        throw error;
      }
    }

    canConvert(fromFormat, toFormat) {
      const key = `${fromFormat}_to_${toFormat}`;
      return this.converters.has(key);
    }

    getSupportedFormats() {
      return Array.from(this.supportedFormats);
    }

    getAvailableConversions() {
      return Array.from(this.converters.keys()).map(key => {
        const [from, to] = key.split('_to_');
        return { from, to };
      });
    }

    getStats() {
      return { ...this.stats };
    }

    resetStats() {
      this.stats = { converted: 0, failed: 0 };
    }

    clear() {
      this.converters.clear();
      this._initDefaultConverters();
    }
  }

  return {
    AnimationCompressor, BoneRetargeter, MeshOptimizer, FormatConverter
  };
})();

if (typeof window !== 'undefined') window.ModelFormatsV5 = ModelFormatsV5;
if (typeof globalThis !== 'undefined') globalThis.ModelFormatsV5 = ModelFormatsV5;
