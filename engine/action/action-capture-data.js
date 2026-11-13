/**
 * Aevum 人形动作：动作捕捉数据、动作合成、面部捕捉、步态生成。
 */
/**
 * 人形动作 - 动作捕捉数据处理/运动合成器/面部捕捉处理器/步态生成器/运动重定向
 * 纯JavaScript，零第三方依赖
 * @version 4.0.0
 */
'use strict';

const ActionCaptureData = (function () {

  class MotionCaptureDataProcessor {
    constructor() {
      this.rawData = [];
      this.processedData = [];
      this.skeleton = null;
      this.markers = new Map();
      this.calibrationData = null;
      this.isCalibrated = false;
      this.smoothingFactor = 0.5;
      this.filterEnabled = true;
      this.filterOrder = 4;
      this.maxHistoryLength = 100;
      this.confidenceThreshold = 0.5;
      this.stats = {
        totalFrames: 0,
        processedFrames: 0,
        droppedFrames: 0,
        averageConfidence: 0
      };
    }

    setSkeleton(skeleton) {
      this.skeleton = skeleton;
      this._autoMapMarkers();
    }

    _autoMapMarkers() {
      if (!this.skeleton) return;
      this.markers.clear();
      const markerDefinitions = [
        { name: 'head', bone: 'head', offset: [0, 0.1, 0] },
        { name: 'neck', bone: 'neck', offset: [0, 0, 0] },
        { name: 'leftShoulder', bone: 'leftShoulder', offset: [0, 0, 0] },
        { name: 'rightShoulder', bone: 'rightShoulder', offset: [0, 0, 0] },
        { name: 'leftElbow', bone: 'leftUpperArm', offset: [0, -0.2, 0] },
        { name: 'rightElbow', bone: 'rightUpperArm', offset: [0, -0.2, 0] },
        { name: 'leftWrist', bone: 'leftHand', offset: [0, 0, 0] },
        { name: 'rightWrist', bone: 'rightHand', offset: [0, 0, 0] },
        { name: 'leftHip', bone: 'leftUpperLeg', offset: [0, 0, 0] },
        { name: 'rightHip', bone: 'rightUpperLeg', offset: [0, 0, 0] },
        { name: 'leftKnee', bone: 'leftLowerLeg', offset: [0, -0.2, 0] },
        { name: 'rightKnee', bone: 'rightLowerLeg', offset: [0, -0.2, 0] },
        { name: 'leftAnkle', bone: 'leftFoot', offset: [0, 0, 0] },
        { name: 'rightAnkle', bone: 'rightFoot', offset: [0, 0, 0] },
        { name: 'spine', bone: 'spine', offset: [0, 0, 0] },
        { name: 'chest', bone: 'chest', offset: [0, 0, 0] }
      ];
      for (const def of markerDefinitions) {
        this.markers.set(def.name, {
          name: def.name,
          bone: def.bone,
          offset: def.offset,
          position: [0, 0, 0],
          confidence: 0
        });
      }
    }

    calibrate(markerData) {
      if (!this.skeleton) {
        throw new Error('Skeleton must be set before calibration');
      }
      this.calibrationData = this._extractMarkerPositions(markerData);
      this.isCalibrated = true;
      return this.calibrationData;
    }

    processFrame(markerData) {
      this.stats.totalFrames++;
      const positions = this._extractMarkerPositions(markerData);
      const avgConfidence = this._calculateAverageConfidence(positions);
      this.stats.averageConfidence = (this.stats.averageConfidence * (this.stats.totalFrames - 1) + avgConfidence) / this.stats.totalFrames;
      if (avgConfidence < this.confidenceThreshold) {
        this.stats.droppedFrames++;
        return null;
      }
      this.rawData.push(positions);
      if (this.rawData.length > this.maxHistoryLength) {
        this.rawData.shift();
      }
      let processed = positions;
      if (this.filterEnabled) {
        processed = this._applyFilter(positions);
      }
      this.processedData.push(processed);
      if (this.processedData.length > this.maxHistoryLength) {
        this.processedData.shift();
      }
      const pose = this._convertToSkeletonPose(processed);
      this.stats.processedFrames++;
      return pose;
    }

    _extractMarkerPositions(markerData) {
      const positions = new Map();
      for (const [name, data] of Object.entries(markerData)) {
        if (this.markers.has(name)) {
          const marker = this.markers.get(name);
          marker.position = data.position || [0, 0, 0];
          marker.confidence = data.confidence ?? 1;
          positions.set(name, {
            position: [...marker.position],
            confidence: marker.confidence
          });
        }
      }
      return positions;
    }

    _calculateAverageConfidence(positions) {
      let total = 0;
      let count = 0;
      for (const data of positions.values()) {
        total += data.confidence;
        count++;
      }
      return count > 0 ? total / count : 0;
    }

    _applyFilter(positions) {
      if (this.rawData.length < this.filterOrder) return positions;
      const filtered = new Map();
      for (const [name, data] of positions) {
        const history = [];
        for (let i = Math.max(0, this.rawData.length - this.filterOrder); i < this.rawData.length; i++) {
          const historical = this.rawData[i].get(name);
          if (historical) history.push(historical.position);
        }
        if (history.length >= 2) {
          const smoothed = this._exponentialSmoothing(history, this.smoothingFactor);
          filtered.set(name, {
            position: smoothed,
            confidence: data.confidence
          });
        } else {
          filtered.set(name, data);
        }
      }
      return filtered;
    }

    _exponentialSmoothing(history, alpha) {
      let result = [...history[0]];
      for (let i = 1; i < history.length; i++) {
        result = [
          result[0] * (1 - alpha) + history[i][0] * alpha,
          result[1] * (1 - alpha) + history[i][1] * alpha,
          result[2] * (1 - alpha) + history[i][2] * alpha
        ];
      }
      return result;
    }

    _convertToSkeletonPose(positions) {
      if (!this.skeleton) return null;
      const pose = {};
      for (const [markerName, data] of positions) {
        const marker = this.markers.get(markerName);
        if (!marker) continue;
        const boneName = marker.bone;
        const offset = marker.offset;
        const bonePosition = [
          data.position[0] - offset[0],
          data.position[1] - offset[1],
          data.position[2] - offset[2]
        ];
        pose[boneName] = {
          position: bonePosition,
          confidence: data.confidence
        };
      }
      return this._inverseKinematics(pose);
    }

    _inverseKinematics(pose) {
      const result = { ...pose };
      const chains = [
        { end: 'leftHand', joints: ['leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand'] },
        { end: 'rightHand', joints: ['rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand'] },
        { end: 'leftFoot', joints: ['leftUpperLeg', 'leftLowerLeg', 'leftFoot'] },
        { end: 'rightFoot', joints: ['rightUpperLeg', 'rightLowerLeg', 'rightFoot'] }
      ];
      for (const chain of chains) {
        const endPosition = pose[chain.end]?.position;
        if (!endPosition) continue;
        const jointPositions = chain.joints.map(j => pose[j]?.position).filter(Boolean);
        if (jointPositions.length < 2) continue;
        const solved = this._solveCCD(jointPositions, endPosition);
        for (let i = 0; i < chain.joints.length; i++) {
          if (solved[i] && result[chain.joints[i]]) {
            result[chain.joints[i]].position = solved[i];
          }
        }
      }
      return result;
    }

    _solveCCD(joints, target, iterations = 10) {
      const result = joints.map(j => [...j]);
      for (let iter = 0; iter < iterations; iter++) {
        for (let i = result.length - 2; i >= 0; i--) {
          const toEnd = this._subtract(result[result.length - 1], result[i]);
          const toTarget = this._subtract(target, result[i]);
          const angle = this._angleBetween(toEnd, toTarget);
          if (Math.abs(angle) < 0.001) continue;
          const axis = this._normalize(this._cross(toEnd, toTarget));
          const rotation = this._axisAngleToQuaternion(axis, angle);
          for (let j = i + 1; j < result.length; j++) {
            const relative = this._subtract(result[j], result[i]);
            const rotated = this._quaternionToVector(rotation, relative);
            result[j] = this._add(result[i], rotated);
          }
        }
        const distance = this._distance(result[result.length - 1], target);
        if (distance < 0.001) break;
      }
      return result;
    }

    _distance(a, b) {
      return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
    }
    _subtract(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
    _add(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
    _normalize(v) {
      const l = Math.sqrt(v[0]**2 + v[1]**2 + v[2]**2) || 1;
      return [v[0]/l, v[1]/l, v[2]/l];
    }
    _cross(a, b) {
      return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
    }
    _dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
    _angleBetween(a, b) {
      const dot = this._dot(this._normalize(a), this._normalize(b));
      return Math.acos(Math.max(-1, Math.min(1, dot)));
    }
    _axisAngleToQuaternion(axis, angle) {
      const s = Math.sin(angle / 2);
      return [axis[0]*s, axis[1]*s, axis[2]*s, Math.cos(angle / 2)];
    }
    _quaternionToVector(q, v) {
      const t = [2*(q[1]*v[2]-q[2]*v[1]), 2*(q[2]*v[0]-q[0]*v[2]), 2*(q[0]*v[1]-q[1]*v[0])];
      return [
        v[0] + q[3]*t[0] + q[1]*t[2] - q[2]*t[1],
        v[1] + q[3]*t[1] + q[2]*t[0] - q[0]*t[2],
        v[2] + q[3]*t[2] + q[0]*t[1] - q[1]*t[0]
      ];
    }

    getMarkerNames() {
      return Array.from(this.markers.keys());
    }

    getMarkerPosition(name) {
      const marker = this.markers.get(name);
      return marker ? marker.position : null;
    }

    getMarkerConfidence(name) {
      const marker = this.markers.get(name);
      return marker ? marker.confidence : 0;
    }

    getStats() {
      return { ...this.stats };
    }

    setSmoothingFactor(factor) {
      this.smoothingFactor = Math.max(0, Math.min(1, factor));
    }

    setFilterEnabled(enabled) {
      this.filterEnabled = enabled;
    }

    setFilterOrder(order) {
      this.filterOrder = Math.max(1, Math.min(20, order));
    }

    setConfidenceThreshold(threshold) {
      this.confidenceThreshold = Math.max(0, Math.min(1, threshold));
    }

    isCalibratedState() {
      return this.isCalibrated;
    }

    getCalibrationData() {
      return this.calibrationData;
    }

    reset() {
      this.rawData = [];
      this.processedData = [];
      this.isCalibrated = false;
      this.calibrationData = null;
      this.stats = {
        totalFrames: 0,
        processedFrames: 0,
        droppedFrames: 0,
        averageConfidence: 0
      };
    }

    clear() {
      this.reset();
      this.markers.clear();
      this.skeleton = null;
    }
  }

  class MotionSynthesizer {
    constructor() {
      this.motionDatabase = [];
      this.currentMotion = null;
      this.currentFrame = 0;
      this.playbackSpeed = 1;
      this.blendWeight = 0;
      this.blendMotion = null;
      this.blendFrame = 0;
      this.parameters = {
        speed: 1,
        direction: 0,
        intensity: 0.5,
        style: 'default'
      };
      this.callbacks = new Map();
      this.isPlaying = false;
    }

    addMotion(name, frames, metadata = {}) {
      const motion = {
        name,
        frames,
        frameCount: frames.length,
        metadata,
        loop: metadata.loop !== false,
        duration: metadata.duration || frames.length / 30
      };
      this.motionDatabase.push(motion);
      return motion;
    }

    removeMotion(name) {
      const index = this.motionDatabase.findIndex(m => m.name === name);
      if (index !== -1) {
        this.motionDatabase.splice(index, 1);
      }
    }

    play(name, options = {}) {
      const motion = this.motionDatabase.find(m => m.name === name);
      if (!motion) {
        console.warn(`Motion not found: ${name}`);
        return false;
      }
      if (this.currentMotion && options.blend !== false) {
        this.blendMotion = this.currentMotion;
        this.blendFrame = this.currentFrame;
        this.blendWeight = 1;
      }
      this.currentMotion = motion;
      this.currentFrame = options.startFrame || 0;
      this.playbackSpeed = options.speed || 1;
      this.isPlaying = true;
      const callback = this.callbacks.get('play');
      if (callback) callback(name);
      return true;
    }

    stop() {
      this.isPlaying = false;
      this.currentMotion = null;
      this.currentFrame = 0;
      this.blendMotion = null;
      this.blendWeight = 0;
    }

    update(deltaTime) {
      if (!this.isPlaying || !this.currentMotion) return null;
      this.currentFrame += deltaTime * this.playbackSpeed * 30;
      if (this.currentFrame >= this.currentMotion.frameCount) {
        if (this.currentMotion.loop) {
          this.currentFrame = this.currentFrame % this.currentMotion.frameCount;
        } else {
          this.currentFrame = this.currentMotion.frameCount - 1;
          this.isPlaying = false;
          const callback = this.callbacks.get('complete');
          if (callback) callback(this.currentMotion.name);
        }
      }
      if (this.blendMotion && this.blendWeight > 0) {
        this.blendWeight -= deltaTime * 2;
        this.blendFrame += deltaTime * this.playbackSpeed * 30;
        if (this.blendWeight <= 0) {
          this.blendMotion = null;
          this.blendWeight = 0;
        }
      }
      return this.evaluate();
    }

    evaluate() {
      if (!this.currentMotion) return null;
      const frameIndex = Math.floor(this.currentFrame);
      const frame = this.currentMotion.frames[Math.min(frameIndex, this.currentMotion.frameCount - 1)];
      if (this.blendMotion && this.blendWeight > 0) {
        const blendFrameIndex = Math.floor(this.blendFrame);
        const blendFrame = this.blendMotion.frames[Math.min(blendFrameIndex, this.blendMotion.frameCount - 1)];
        return this._blendFrames(blendFrame, frame, 1 - this.blendWeight);
      }
      return this._applyParameters(frame);
    }

    _blendFrames(frameA, frameB, weight) {
      if (!frameA || !frameB) return frameA || frameB;
      const result = {
        bones: {},
        morphs: {},
        rootPosition: [0, 0, 0],
        rootRotation: [0, 0, 0, 1]
      };
      const allBones = new Set([...Object.keys(frameA.bones || {}), ...Object.keys(frameB.bones || {})]);
      for (const boneName of allBones) {
        const boneA = frameA.bones?.[boneName];
        const boneB = frameB.bones?.[boneName];
        if (boneA && boneB) {
          result.bones[boneName] = {
            position: [
              boneA.position[0] * (1 - weight) + boneB.position[0] * weight,
              boneA.position[1] * (1 - weight) + boneB.position[1] * weight,
              boneA.position[2] * (1 - weight) + boneB.position[2] * weight
            ],
            rotation: this._slerp(boneA.rotation, boneB.rotation, weight),
            scale: [
              boneA.scale[0] * (1 - weight) + boneB.scale[0] * weight,
              boneA.scale[1] * (1 - weight) + boneB.scale[1] * weight,
              boneA.scale[2] * (1 - weight) + boneB.scale[2] * weight
            ]
          };
        } else {
          result.bones[boneName] = boneA || boneB;
        }
      }
      const allMorphs = new Set([...Object.keys(frameA.morphs || {}), ...Object.keys(frameB.morphs || {})]);
      for (const morphName of allMorphs) {
        const morphA = frameA.morphs?.[morphName] || 0;
        const morphB = frameB.morphs?.[morphName] || 0;
        result.morphs[morphName] = morphA * (1 - weight) + morphB * weight;
      }
      if (frameA.rootPosition && frameB.rootPosition) {
        result.rootPosition = [
          frameA.rootPosition[0] * (1 - weight) + frameB.rootPosition[0] * weight,
          frameA.rootPosition[1] * (1 - weight) + frameB.rootPosition[1] * weight,
          frameA.rootPosition[2] * (1 - weight) + frameB.rootPosition[2] * weight
        ];
      }
      if (frameA.rootRotation && frameB.rootRotation) {
        result.rootRotation = this._slerp(frameA.rootRotation, frameB.rootRotation, weight);
      }
      return result;
    }

    _applyParameters(frame) {
      const result = JSON.parse(JSON.stringify(frame));
      if (this.parameters.speed !== 1) {
        for (const bone of Object.values(result.bones || {})) {
          if (bone.position) {
            bone.position[0] *= this.parameters.speed;
            bone.position[2] *= this.parameters.speed;
          }
        }
      }
      if (this.parameters.direction !== 0) {
        const rotation = this._axisAngleToQuaternion([0, 1, 0], this.parameters.direction);
        if (result.rootRotation) {
          result.rootRotation = this._multiplyQuaternions(rotation, result.rootRotation);
        }
        for (const bone of Object.values(result.bones || {})) {
          if (bone.rotation) {
            bone.rotation = this._multiplyQuaternions(rotation, bone.rotation);
          }
        }
      }
      return result;
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

    _axisAngleToQuaternion(axis, angle) {
      const s = Math.sin(angle / 2);
      return [axis[0]*s, axis[1]*s, axis[2]*s, Math.cos(angle / 2)];
    }

    _multiplyQuaternions(a, b) {
      return [
        a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
        a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
        a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
        a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2]
      ];
    }

    getCurrentMotionName() {
      return this.currentMotion?.name || null;
    }

    getCurrentFrame() {
      return this.currentFrame;
    }

    getMotionNames() {
      return this.motionDatabase.map(m => m.name);
    }

    getMotionCount() {
      return this.motionDatabase.length;
    }

    setParameter(name, value) {
      if (this.parameters.hasOwnProperty(name)) {
        this.parameters[name] = value;
      }
    }

    getParameter(name) {
      return this.parameters[name];
    }

    setPlaybackSpeed(speed) {
      this.playbackSpeed = speed;
    }

    on(event, callback) {
      this.callbacks.set(event, callback);
    }

    isPlayingState() {
      return this.isPlaying;
    }

    clear() {
      this.motionDatabase = [];
      this.currentMotion = null;
      this.blendMotion = null;
      this.callbacks.clear();
    }
  }

  class FacialCaptureProcessor {
    constructor() {
      this.landmarks = new Map();
      this.blendshapes = new Map();
      this.currentExpression = 'neutral';
      this.expressionIntensity = 0;
      this.smoothingFactor = 0.5;
      this.history = [];
      this.maxHistoryLength = 10;
      this.expressions = {
        neutral: { brow: 0, eye: 0, mouth: 0, cheek: 0, jaw: 0 },
        happy: { brow: 0.1, eye: 0.3, mouth: 0.8, cheek: 0.6, jaw: 0.1 },
        sad: { brow: 0.6, eye: 0.4, mouth: -0.5, cheek: -0.2, jaw: 0.2 },
        angry: { brow: 0.9, eye: 0.6, mouth: -0.3, cheek: 0.1, jaw: 0.4 },
        surprised: { brow: 0.8, eye: 0.9, mouth: 0.5, cheek: 0.2, jaw: 0.7 },
        fear: { brow: 0.7, eye: 0.8, mouth: -0.2, cheek: -0.1, jaw: 0.5 },
        disgust: { brow: 0.3, eye: 0.2, mouth: -0.6, cheek: 0.3, jaw: 0.1 },
        contempt: { brow: 0.2, eye: 0.1, mouth: -0.3, cheek: 0.4, jaw: 0 },
        blink: { brow: 0, eye: 1, mouth: 0, cheek: 0, jaw: 0 },
        talk: { brow: 0, eye: 0, mouth: 0.5, cheek: 0, jaw: 0.3 }
      };
      this.stats = {
        framesProcessed: 0,
        expressionsDetected: 0,
        averageConfidence: 0
      };
    }

    processFrame(landmarkData) {
      this.stats.framesProcessed++;
      const landmarks = this._extractLandmarks(landmarkData);
      this.history.push(landmarks);
      if (this.history.length > this.maxHistoryLength) {
        this.history.shift();
      }
      const smoothed = this._smoothLandmarks(landmarks);
      const blendshapes = this._computeBlendshapes(smoothed);
      const expression = this._detectExpression(blendshapes);
      this.currentExpression = expression.name;
      this.expressionIntensity = expression.confidence;
      this.stats.expressionsDetected++;
      this.stats.averageConfidence = (this.stats.averageConfidence * (this.stats.framesProcessed - 1) + expression.confidence) / this.stats.framesProcessed;
      return {
        landmarks: smoothed,
        blendshapes,
        expression: this.currentExpression,
        intensity: this.expressionIntensity,
        confidence: expression.confidence
      };
    }

    _extractLandmarks(landmarkData) {
      const landmarks = new Map();
      for (const [name, data] of Object.entries(landmarkData)) {
        landmarks.set(name, {
          position: data.position || [0, 0, 0],
          confidence: data.confidence ?? 1
        });
      }
      return landmarks;
    }

    _smoothLandmarks(landmarks) {
      if (this.history.length < 2) return landmarks;
      const smoothed = new Map();
      for (const [name, data] of landmarks) {
        const history = [];
        for (let i = Math.max(0, this.history.length - 5); i < this.history.length; i++) {
          const historical = this.history[i].get(name);
          if (historical) history.push(historical.position);
        }
        if (history.length >= 2) {
          const smoothedPos = this._exponentialSmoothing(history, this.smoothingFactor);
          smoothed.set(name, {
            position: smoothedPos,
            confidence: data.confidence
          });
        } else {
          smoothed.set(name, data);
        }
      }
      return smoothed;
    }

    _exponentialSmoothing(history, alpha) {
      let result = [...history[0]];
      for (let i = 1; i < history.length; i++) {
        result = [
          result[0] * (1 - alpha) + history[i][0] * alpha,
          result[1] * (1 - alpha) + history[i][1] * alpha,
          result[2] * (1 - alpha) + history[i][2] * alpha
        ];
      }
      return result;
    }

    _computeBlendshapes(landmarks) {
      const blendshapes = new Map();
      const leftEye = landmarks.get('leftEye');
      const rightEye = landmarks.get('rightEye');
      const leftBrow = landmarks.get('leftBrow');
      const rightBrow = landmarks.get('rightBrow');
      const mouthLeft = landmarks.get('mouthLeft');
      const mouthRight = landmarks.get('mouthRight');
      const mouthTop = landmarks.get('mouthTop');
      const mouthBottom = landmarks.get('mouthBottom');
      const jaw = landmarks.get('jaw');
      const cheekLeft = landmarks.get('leftCheek');
      const cheekRight = landmarks.get('rightCheek');
      if (leftEye && rightEye) {
        const eyeOpen = this._distance(leftEye.position, rightEye.position);
        blendshapes.set('eyeOpen', Math.min(1, eyeOpen / 0.1));
        blendshapes.set('blink', 1 - Math.min(1, eyeOpen / 0.1));
      }
      if (leftBrow && rightBrow) {
        const browHeight = (leftBrow.position[1] + rightBrow.position[1]) / 2;
        blendshapes.set('browUp', Math.max(0, Math.min(1, (browHeight - 0.3) / 0.2)));
        blendshapes.set('browDown', Math.max(0, Math.min(1, (0.3 - browHeight) / 0.2)));
      }
      if (mouthLeft && mouthRight && mouthTop && mouthBottom) {
        const mouthWidth = this._distance(mouthLeft.position, mouthRight.position);
        const mouthHeight = this._distance(mouthTop.position, mouthBottom.position);
        blendshapes.set('mouthOpen', Math.min(1, mouthHeight / 0.05));
        blendshapes.set('mouthWide', Math.min(1, mouthWidth / 0.15));
        blendshapes.set('mouthNarrow', Math.max(0, 1 - mouthWidth / 0.1));
        blendshapes.set('smile', Math.min(1, (mouthWidth - 0.08) / 0.07) * (1 - blendshapes.get('mouthOpen') || 0));
        blendshapes.set('frown', Math.max(0, 1 - (mouthWidth / 0.1)) * (1 - blendshapes.get('mouthOpen') || 0));
      }
      if (jaw) {
        blendshapes.set('jawOpen', Math.min(1, jaw.position[1] / 0.05));
      }
      if (cheekLeft && cheekRight) {
        const cheekHeight = (cheekLeft.position[1] + cheekRight.position[1]) / 2;
        blendshapes.set('cheekRaise', Math.max(0, Math.min(1, (cheekHeight - 0.2) / 0.1)));
      }
      return blendshapes;
    }

    _detectExpression(blendshapes) {
      let bestExpression = 'neutral';
      let bestScore = 0;
      for (const [name, weights] of Object.entries(this.expressions)) {
        let score = 0;
        let totalWeight = 0;
        for (const [feature, weight] of Object.entries(weights)) {
          const blendshapeValue = Math.abs(blendshapes.get(feature) || 0);
          score += Math.abs(blendshapeValue - Math.abs(weight)) * weight;
          totalWeight += Math.abs(weight);
        }
        if (totalWeight > 0) {
          score = 1 - score / totalWeight;
        }
        if (score > bestScore) {
          bestScore = score;
          bestExpression = name;
        }
      }
      return { name: bestExpression, confidence: bestScore };
    }

    _distance(a, b) {
      return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
    }

    getCurrentExpression() {
      return this.currentExpression;
    }

    getExpressionIntensity() {
      return this.expressionIntensity;
    }

    getBlendshape(name) {
      return this.blendshapes.get(name) || 0;
    }

    getBlendshapes() {
      return Object.fromEntries(this.blendshapes);
    }

    getExpressionNames() {
      return Object.keys(this.expressions);
    }

    getStats() {
      return { ...this.stats };
    }

    setSmoothingFactor(factor) {
      this.smoothingFactor = Math.max(0, Math.min(1, factor));
    }

    addExpression(name, weights) {
      this.expressions[name] = weights;
    }

    removeExpression(name) {
      delete this.expressions[name];
    }

    reset() {
      this.landmarks.clear();
      this.blendshapes.clear();
      this.currentExpression = 'neutral';
      this.expressionIntensity = 0;
      this.history = [];
      this.stats = {
        framesProcessed: 0,
        expressionsDetected: 0,
        averageConfidence: 0
      };
    }

    clear() {
      this.reset();
      this.expressions = {
        neutral: { brow: 0, eye: 0, mouth: 0, cheek: 0, jaw: 0 }
      };
    }
  }

  class GaitGenerator {
    constructor() {
      this.parameters = {
        speed: 1,
        strideLength: 0.7,
        strideHeight: 0.1,
        stepWidth: 0.2,
        hipSwing: 0.1,
        armSwing: 0.3,
        bodyBob: 0.05,
        bodyLean: 0,
        kneeBend: 0.2,
        anklePitch: 0.1,
        cadence: 100
      };
      this.phase = 0;
      this.isWalking = false;
      this.direction = [0, 0, 1];
      this.position = [0, 0, 0];
      this.velocity = [0, 0, 0];
      this.callbacks = new Map();
    }

    start() {
      this.isWalking = true;
      this.phase = 0;
      const callback = this.callbacks.get('start');
      if (callback) callback();
    }

    stop() {
      this.isWalking = false;
      const callback = this.callbacks.get('stop');
      if (callback) callback();
    }

    update(deltaTime) {
      if (!this.isWalking) return null;
      this.phase += deltaTime * this.parameters.cadence / 60 * this.parameters.speed;
      if (this.phase >= Math.PI * 2) {
        this.phase -= Math.PI * 2;
        const callback = this.callbacks.get('step');
        if (callback) callback();
      }
      const pose = this._generatePose();
      this._updatePosition(deltaTime);
      return pose;
    }

    _generatePose() {
      const phase = this.phase;
      const params = this.parameters;
      const leftPhase = phase;
      const rightPhase = phase + Math.PI;
      const pose = {
        bones: {},
        rootPosition: [...this.position],
        rootRotation: [0, 0, 0, 1]
      };
      const leftHipHeight = Math.sin(leftPhase) * params.strideHeight;
      const rightHipHeight = Math.sin(rightPhase) * params.strideHeight;
      const hipHeight = (leftHipHeight + rightHipHeight) / 2 + params.bodyBob;
      pose.rootPosition[1] += hipHeight;
      const hipSwing = Math.sin(phase) * params.hipSwing;
      pose.rootRotation = this._eulerToQuaternion([0, hipSwing, params.bodyLean]);
      const leftLegPhase = Math.sin(leftPhase);
      const rightLegPhase = Math.sin(rightPhase);
      pose.bones['leftUpperLeg'] = {
        rotation: this._eulerToQuaternion([leftLegPhase * params.strideLength * 0.5, 0, 0]),
        position: [params.stepWidth, 0, 0]
      };
      pose.bones['rightUpperLeg'] = {
        rotation: this._eulerToQuaternion([rightLegPhase * params.strideLength * 0.5, 0, 0]),
        position: [-params.stepWidth, 0, 0]
      };
      const leftKneeBend = Math.max(0, -leftLegPhase) * params.kneeBend;
      const rightKneeBend = Math.max(0, -rightLegPhase) * params.kneeBend;
      pose.bones['leftLowerLeg'] = {
        rotation: this._eulerToQuaternion([-leftKneeBend, 0, 0])
      };
      pose.bones['rightLowerLeg'] = {
        rotation: this._eulerToQuaternion([-rightKneeBend, 0, 0])
      };
      const leftAnklePitch = Math.sin(leftPhase + Math.PI / 2) * params.anklePitch;
      const rightAnklePitch = Math.sin(rightPhase + Math.PI / 2) * params.anklePitch;
      pose.bones['leftFoot'] = {
        rotation: this._eulerToQuaternion([leftAnklePitch, 0, 0])
      };
      pose.bones['rightFoot'] = {
        rotation: this._eulerToQuaternion([rightAnklePitch, 0, 0])
      };
      const leftArmPhase = Math.sin(rightPhase) * params.armSwing;
      const rightArmPhase = Math.sin(leftPhase) * params.armSwing;
      pose.bones['leftUpperArm'] = {
        rotation: this._eulerToQuaternion([leftArmPhase, 0, 0])
      };
      pose.bones['rightUpperArm'] = {
        rotation: this._eulerToQuaternion([rightArmPhase, 0, 0])
      };
      pose.bones['leftLowerArm'] = {
        rotation: this._eulerToQuaternion([-Math.abs(leftArmPhase) * 0.3, 0, 0])
      };
      pose.bones['rightLowerArm'] = {
        rotation: this._eulerToQuaternion([-Math.abs(rightArmPhase) * 0.3, 0, 0])
      };
      return pose;
    }

    _updatePosition(deltaTime) {
      const speed = this.parameters.speed * this.parameters.strideLength * this.parameters.cadence / 60;
      this.velocity = [
        this.direction[0] * speed,
        0,
        this.direction[2] * speed
      ];
      this.position[0] += this.velocity[0] * deltaTime;
      this.position[2] += this.velocity[2] * deltaTime;
    }

    _eulerToQuaternion(euler) {
      const [x, y, z] = euler;
      const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
      const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
      const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
      return [
        sx * cy * cz + cx * sy * sz,
        cx * sy * cz - sx * cy * sz,
        cx * cy * sz + sx * sy * cz,
        cx * cy * cz - sx * sy * sz
      ];
    }

    setParameter(name, value) {
      if (this.parameters.hasOwnProperty(name)) {
        this.parameters[name] = value;
      }
    }

    getParameter(name) {
      return this.parameters[name];
    }

    setDirection(x, y, z) {
      const length = Math.sqrt(x*x + y*y + z*z) || 1;
      this.direction = [x/length, y/length, z/length];
    }

    setPosition(x, y, z) {
      this.position = [x, y, z];
    }

    getPosition() {
      return [...this.position];
    }

    getVelocity() {
      return [...this.velocity];
    }

    getPhase() {
      return this.phase;
    }

    isWalkingState() {
      return this.isWalking;
    }

    on(event, callback) {
      this.callbacks.set(event, callback);
    }

    reset() {
      this.phase = 0;
      this.position = [0, 0, 0];
      this.velocity = [0, 0, 0];
      this.isWalking = false;
    }
  }

  return {
    MotionCaptureDataProcessor, MotionSynthesizer, FacialCaptureProcessor, GaitGenerator
  };
})();

if (typeof window !== 'undefined') window.ActionCaptureData = ActionCaptureData;
if (typeof globalThis !== 'undefined') globalThis.ActionCaptureData = ActionCaptureData;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ActionCaptureData;
}

if (typeof globalThis !== 'undefined') {
  globalThis.AEVUM = globalThis.AEVUM || {};
  globalThis.AEVUM.action = globalThis.AEVUM.action || {};
  globalThis.AEVUM.action.CaptureData = ActionCaptureData;
}
