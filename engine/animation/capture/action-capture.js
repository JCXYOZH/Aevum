/**
 * Aevum 人形动作：动作捕捉、动作合成、面部捕捉、步态生成。
 */
/**
 * 人形动作引擎扩展 - 动作捕捉/运动合成/面部捕捉/步态生成/动作状态机扩展
 * 纯JavaScript，零第三方依赖
 * @version 2.0.0
 */
'use strict';

const ActionCapture = (function () {

  // ============================================================
  // 动作捕捉数据处理器
  // ============================================================
  class MotionCaptureProcessor {
    constructor() {
      this.markers = new Map();
      this.trackedBones = new Map();
      this.calibrationPose = null;
      this.isCalibrated = false;
      this.smoothingFactor = 0.5;
      this.filterOrder = 2;
      this.filterBuffers = new Map();
      this.jointPositions = new Map();
      this.jointRotations = new Map();
      this.confidenceThreshold = 0.5;
      this.timeWindow = 0.1;
      this.lastUpdateTime = 0;
    }

    calibrate(markerData) {
      this.calibrationPose = { markers: new Map(), timestamp: Date.now() };
      for (const [name, data] of markerData) {
        this.calibrationPose.markers.set(name, {
          position: [...data.position],
          confidence: data.confidence || 1
        });
      }
      this.isCalibrated = true;
      return this.calibrationPose;
    }

    addMarker(name, position, confidence = 1) {
      this.markers.set(name, { position: [...position], confidence, timestamp: performance.now() });
    }

    update(markerData, dt) {
      for (const [name, data] of markerData) {
        if (data.confidence < this.confidenceThreshold) continue;
        const smoothed = this._smooth(name, data.position, dt);
        this.markers.set(name, { position: smoothed, confidence: data.confidence, timestamp: performance.now() });
      }
      this._computeJointPositions();
      this._computeJointRotations();
      this.lastUpdateTime = performance.now();
    }

    _smooth(name, position, dt) {
      if (!this.filterBuffers.has(name)) {
        this.filterBuffers.set(name, [[...position], [...position]]);
      }
      const buffers = this.filterBuffers.get(name);
      const alpha = Math.min(1, dt / (this.timeWindow + dt));
      const smoothed = [
        buffers[0][0] + (position[0] - buffers[0][0]) * alpha,
        buffers[0][1] + (position[1] - buffers[0][1]) * alpha,
        buffers[0][2] + (position[2] - buffers[0][2]) * alpha
      ];
      buffers[1] = [...buffers[0]];
      buffers[0] = [...smoothed];
      return smoothed;
    }

    _computeJointPositions() {
      const jointDefinitions = {
        head: ['nose', 'left_eye', 'right_eye'],
        neck: ['left_shoulder', 'right_shoulder'],
        spine: ['left_hip', 'right_hip'],
        leftShoulder: ['left_shoulder'],
        leftElbow: ['left_elbow'],
        leftWrist: ['left_wrist'],
        rightShoulder: ['right_shoulder'],
        rightElbow: ['right_elbow'],
        rightWrist: ['right_wrist'],
        leftHip: ['left_hip'],
        leftKnee: ['left_knee'],
        leftAnkle: ['left_ankle'],
        rightHip: ['right_hip'],
        rightKnee: ['right_knee'],
        rightAnkle: ['right_ankle']
      };
      for (const [joint, markerNames] of Object.entries(jointDefinitions)) {
        let x = 0, y = 0, z = 0, count = 0;
        for (const name of markerNames) {
          const marker = this.markers.get(name);
          if (marker) {
            x += marker.position[0];
            y += marker.position[1];
            z += marker.position[2];
            count++;
          }
        }
        if (count > 0) {
          this.jointPositions.set(joint, [x / count, y / count, z / count]);
        }
      }
    }

    _computeJointRotations() {
      const pairs = [
        ['leftUpperArm', 'leftShoulder', 'leftElbow'],
        ['leftLowerArm', 'leftElbow', 'leftWrist'],
        ['rightUpperArm', 'rightShoulder', 'rightElbow'],
        ['rightLowerArm', 'rightElbow', 'rightWrist'],
        ['leftUpperLeg', 'leftHip', 'leftKnee'],
        ['leftLowerLeg', 'leftKnee', 'leftAnkle'],
        ['rightUpperLeg', 'rightHip', 'rightKnee'],
        ['rightLowerLeg', 'rightKnee', 'rightAnkle']
      ];
      for (const [bone, startJoint, endJoint] of pairs) {
        const start = this.jointPositions.get(startJoint);
        const end = this.jointPositions.get(endJoint);
        if (start && end) {
          const direction = this._normalize([end[0] - start[0], end[1] - start[1], end[2] - start[2]]);
          const rotation = this._directionToQuaternion(direction);
          this.jointRotations.set(bone, rotation);
        }
      }
    }

    _normalize(v) {
      const l = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]) || 1;
      return [v[0]/l, v[1]/l, v[2]/l];
    }

    _directionToQuaternion(direction) {
      const forward = [0, 0, 1];
      const dot = forward[0]*direction[0] + forward[1]*direction[1] + forward[2]*direction[2];
      if (dot > 0.99999) return [0, 0, 0, 1];
      if (dot < -0.99999) return [0, 1, 0, 0];
      const axis = this._normalize([
        forward[1]*direction[2] - forward[2]*direction[1],
        forward[2]*direction[0] - forward[0]*direction[2],
        forward[0]*direction[1] - forward[1]*direction[0]
      ]);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      const s = Math.sin(angle / 2);
      return [axis[0]*s, axis[1]*s, axis[2]*s, Math.cos(angle / 2)];
    }

    getSkeletonPose() {
      const pose = { bones: [], timestamp: performance.now() };
      const boneOrder = ['spine', 'neck', 'head', 'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftWrist', 'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightWrist', 'leftHip', 'leftUpperLeg', 'leftLowerLeg', 'leftAnkle', 'rightHip', 'rightUpperLeg', 'rightLowerLeg', 'rightAnkle'];
      for (const bone of boneOrder) {
        pose.bones.push({
          name: bone,
          position: this.jointPositions.get(bone) || [0, 0, 0],
          rotation: this.jointRotations.get(bone) || [0, 0, 0, 1],
          confidence: this._getBoneConfidence(bone)
        });
      }
      return pose;
    }

    _getBoneConfidence(bone) {
      const markerMap = {
        spine: ['left_hip', 'right_hip'],
        neck: ['left_shoulder', 'right_shoulder'],
        head: ['nose'],
        leftUpperArm: ['left_shoulder', 'left_elbow'],
        leftLowerArm: ['left_elbow', 'left_wrist'],
        rightUpperArm: ['right_shoulder', 'right_elbow'],
        rightLowerArm: ['right_elbow', 'right_wrist'],
        leftUpperLeg: ['left_hip', 'left_knee'],
        leftLowerLeg: ['left_knee', 'left_ankle'],
        rightUpperLeg: ['right_hip', 'right_knee'],
        rightLowerLeg: ['right_knee', 'right_ankle']
      };
      const markers = markerMap[bone] || [];
      let totalConfidence = 0;
      for (const name of markers) {
        const marker = this.markers.get(name);
        totalConfidence += marker ? marker.confidence : 0;
      }
      return markers.length > 0 ? totalConfidence / markers.length : 0;
    }

    setSmoothingFactor(v) { this.smoothingFactor = Math.max(0, Math.min(1, v)); }
    setConfidenceThreshold(v) { this.confidenceThreshold = Math.max(0, Math.min(1, v)); }
    setTimeWindow(v) { this.timeWindow = Math.max(0.001, v); }
    getMarkerCount() { return this.markers.size; }
    getTrackedJointCount() { return this.jointPositions.size; }
    isCalibratedState() { return this.isCalibrated; }
    reset() {
      this.markers.clear();
      this.jointPositions.clear();
      this.jointRotations.clear();
      this.filterBuffers.clear();
      this.isCalibrated = false;
      this.calibrationPose = null;
    }
    dispose() { this.reset(); }
  }

  // ============================================================
  // 运动合成器
  // ============================================================
  class MotionSynthesizer {
    constructor() {
      this.motionClips = new Map();
      this.currentMotion = null;
      this.blendTree = null;
      this.blendWeight = 0;
      this.playbackSpeed = 1;
      this.loop = true;
      this.time = 0;
      this.isPlaying = false;
      this.motionGraph = null;
      this.currentState = null;
      this.transitionTime = 0;
      this.transitionDuration = 0.3;
      this.isTransitioning = false;
      this.targetState = null;
      this.poseCache = null;
    }

    addMotionClip(name, clip) {
      this.motionClips.set(name, {
        name,
        duration: clip.duration || 1,
        frames: clip.frames || [],
        frameRate: clip.frameRate || 30,
        loop: clip.loop !== undefined ? clip.loop : true,
        rootMotion: clip.rootMotion || false
      });
    }

    removeMotionClip(name) { this.motionClips.delete(name); }

    play(name, options = {}) {
      const clip = this.motionClips.get(name);
      if (!clip) return false;
      if (this.currentMotion && options.blend !== false) {
        this._startTransition(name, options.blendDuration || this.transitionDuration);
      } else {
        this.currentMotion = clip;
        this.time = options.startTime || 0;
        this.playbackSpeed = options.speed || 1;
        this.loop = options.loop !== undefined ? options.loop : clip.loop;
      }
      this.isPlaying = true;
      return true;
    }

    stop() {
      this.isPlaying = false;
      this.time = 0;
      this.isTransitioning = false;
    }

    pause() { this.isPlaying = false; }

    resume() { if (this.currentMotion) this.isPlaying = true; }

    _startTransition(targetName, duration) {
      this.targetState = this.motionClips.get(targetName);
      this.transitionTime = 0;
      this.transitionDuration = duration;
      this.isTransitioning = true;
    }

    update(dt) {
      if (!this.isPlaying) return this.poseCache;
      const deltaTime = dt * this.playbackSpeed;
      if (this.isTransitioning && this.targetState) {
        this.transitionTime += deltaTime;
        if (this.transitionTime >= this.transitionDuration) {
          this.currentMotion = this.targetState;
          this.time = 0;
          this.isTransitioning = false;
          this.targetState = null;
        }
      }
      if (this.currentMotion) {
        this.time += deltaTime;
        if (this.loop) {
          this.time = this.time % this.currentMotion.duration;
        } else if (this.time >= this.currentMotion.duration) {
          this.time = this.currentMotion.duration;
          this.isPlaying = false;
        }
      }
      this.poseCache = this._evaluatePose(this.time);
      return this.poseCache;
    }

    _evaluatePose(time) {
      if (!this.currentMotion) return null;
      const clip = this.currentMotion;
      const frameTime = 1 / clip.frameRate;
      const frameIndex = Math.min(Math.floor(time / frameTime), clip.frames.length - 1);
      const nextFrameIndex = Math.min(frameIndex + 1, clip.frames.length - 1);
      const blendFactor = (time % frameTime) / frameTime;
      const frameA = clip.frames[frameIndex];
      const frameB = clip.frames[nextFrameIndex];
      if (!frameA) return null;
      const pose = { bones: [], timestamp: time };
      const boneCount = Math.max(frameA.bones?.length || 0, frameB?.bones?.length || 0);
      for (let i = 0; i < boneCount; i++) {
        const boneA = frameA.bones?.[i];
        const boneB = frameB?.bones?.[i];
        if (!boneA && !boneB) continue;
        const position = boneA ? this._lerpVec3(boneA.position, boneB?.position || boneA.position, blendFactor) : boneB.position;
        const rotation = boneA ? this._slerpQuat(boneA.rotation, boneB?.rotation || boneA.rotation, blendFactor) : boneB.rotation;
        pose.bones.push({ name: boneA?.name || boneB?.name, position, rotation });
      }
      if (this.isTransitioning && this.targetState) {
        const targetPose = this._evaluateClipPose(this.targetState, 0);
        const t = this.transitionTime / this.transitionDuration;
        return this._blendPoses(pose, targetPose, t);
      }
      return pose;
    }

    _evaluateClipPose(clip, time) {
      if (!clip || clip.frames.length === 0) return null;
      const frameTime = 1 / clip.frameRate;
      const frameIndex = Math.min(Math.floor(time / frameTime), clip.frames.length - 1);
      return clip.frames[frameIndex];
    }

    _blendPoses(poseA, poseB, weight) {
      if (!poseA) return poseB;
      if (!poseB) return poseA;
      const result = { bones: [], timestamp: poseA.timestamp };
      const boneCount = Math.max(poseA.bones.length, poseB.bones.length);
      for (let i = 0; i < boneCount; i++) {
        const boneA = poseA.bones[i];
        const boneB = poseB.bones[i];
        if (!boneA && !boneB) continue;
        result.bones.push({
          name: boneA?.name || boneB?.name,
          position: this._lerpVec3(boneA?.position || [0,0,0], boneB?.position || [0,0,0], weight),
          rotation: this._slerpQuat(boneA?.rotation || [0,0,0,1], boneB?.rotation || [0,0,0,1], weight)
        });
      }
      return result;
    }

    _lerpVec3(a, b, t) {
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }

    _slerpQuat(a, b, t) {
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
      return [a[0]*s0 + bCopy[0]*s1, a[1]*s0 + bCopy[1]*s1, a[2]*s0 + bCopy[2]*s1, a[3]*s0 + bCopy[3]*s1];
    }

    _normalizeQuat(q) {
      const l = Math.sqrt(q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3]) || 1;
      return [q[0]/l, q[1]/l, q[2]/l, q[3]/l];
    }

    setPlaybackSpeed(v) { this.playbackSpeed = v; }
    setLoop(v) { this.loop = v; }
    getCurrentTime() { return this.time; }
    getDuration() { return this.currentMotion?.duration || 0; }
    getMotionClipCount() { return this.motionClips.size; }
    getMotionClipNames() { return Array.from(this.motionClips.keys()); }
    isPlayingState() { return this.isPlaying; }
    getCurrentPose() { return this.poseCache; }
    seek(time) { if (this.currentMotion) { this.time = Math.max(0, Math.min(time, this.currentMotion.duration)); this.poseCache = this._evaluatePose(this.time); } }
    dispose() { this.motionClips.clear(); this.currentMotion = null; this.poseCache = null; }
  }

  // ============================================================
  // 面部捕捉处理器
  // ============================================================
  class FacialCaptureProcessor {
    constructor() {
      this.faceLandmarks = new Map();
      this.blendShapes = new Map();
      this.calibrationData = null;
      this.isCalibrated = false;
      this.smoothing = 0.5;
      this.smoothedValues = new Map();
      this.expressionWeights = new Map();
      this.headRotation = [0, 0, 0, 1];
      this.headPosition = [0, 0, 0];
      this.eyeRotation = [0, 0];
      this.blinkWeight = 0;
      this.mouthOpen = 0;
      this.mouthSmile = 0;
      this.browRaise = 0;
      this.browFurrow = 0;
      this.eyeWide = 0;
      this.eyeSquint = 0;
      this.jawOpen = 0;
      this.lipPucker = 0;
      this.lipFunnel = 0;
      this.noseSneer = 0;
      this.cheekPuff = 0;
      this.tongueOut = 0;
    }

    calibrate(landmarks) {
      this.calibrationData = {
        eyeHeight: this._computeEyeHeight(landmarks),
        mouthWidth: this._computeMouthWidth(landmarks),
        mouthHeight: this._computeMouthHeight(landmarks),
        browHeight: this._computeBrowHeight(landmarks),
        noseWidth: this._computeNoseWidth(landmarks),
        faceWidth: this._computeFaceWidth(landmarks),
        faceHeight: this._computeFaceHeight(landmarks),
        timestamp: Date.now()
      };
      this.isCalibrated = true;
      return this.calibrationData;
    }

    update(landmarks, dt) {
      for (const [name, point] of landmarks) {
        this.faceLandmarks.set(name, { x: point.x, y: point.y, z: point.z || 0, confidence: point.confidence || 1 });
      }
      this._computeHeadTransform(landmarks);
      this._computeEyeParameters(landmarks, dt);
      this._computeMouthParameters(landmarks, dt);
      this._computeBrowParameters(landmarks, dt);
      this._computeNoseParameters(landmarks, dt);
      this._computeBlendShapes();
    }

    _computeHeadTransform(landmarks) {
      const leftEye = landmarks.get('left_eye') || landmarks.get(33);
      const rightEye = landmarks.get('right_eye') || landmarks.get(263);
      const nose = landmarks.get('nose_tip') || landmarks.get(1);
      const chin = landmarks.get('chin') || landmarks.get(152);
      if (leftEye && rightEye && nose) {
        const eyeMidX = (leftEye.x + rightEye.x) / 2;
        const eyeMidY = (leftEye.y + rightEye.y) / 2;
        const dx = rightEye.x - leftEye.x;
        const dy = rightEye.y - leftEye.y;
        const yaw = Math.atan2(nose.x - eyeMidX, 1) * 2;
        const pitch = Math.atan2(nose.y - eyeMidY, 1) * 2;
        const roll = Math.atan2(dy, dx);
        this.headRotation = this._eulerToQuaternion(pitch, yaw, roll);
        this.headPosition = [eyeMidX, eyeMidY, 0];
      }
    }

    _computeEyeParameters(landmarks, dt) {
      const leftEyeTop = landmarks.get('left_eye_top') || landmarks.get(159);
      const leftEyeBottom = landmarks.get('left_eye_bottom') || landmarks.get(145);
      const rightEyeTop = landmarks.get('right_eye_top') || landmarks.get(386);
      const rightEyeBottom = landmarks.get('right_eye_bottom') || landmarks.get(374);
      if (leftEyeTop && leftEyeBottom && rightEyeTop && rightEyeBottom) {
        const leftHeight = Math.abs(leftEyeTop.y - leftEyeBottom.y);
        const rightHeight = Math.abs(rightEyeTop.y - rightEyeBottom.y);
        const avgHeight = (leftHeight + rightHeight) / 2;
        const calibratedHeight = this.calibrationData?.eyeHeight || avgHeight;
        const blink = Math.max(0, 1 - avgHeight / (calibratedHeight * 1.2));
        this.blinkWeight = this._smoothValue('blink', blink, dt);
        this.eyeWide = Math.max(0, avgHeight / calibratedHeight - 1);
        this.eyeSquint = Math.max(0, 1 - avgHeight / (calibratedHeight * 0.8));
      }
      const leftIris = landmarks.get('left_iris') || landmarks.get(468);
      const rightIris = landmarks.get('right_iris') || landmarks.get(473);
      if (leftIris && rightIris) {
        const leftEyeCenter = landmarks.get('left_eye_center') || landmarks.get(33);
        const rightEyeCenter = landmarks.get('right_eye_center') || landmarks.get(263);
        if (leftEyeCenter && rightEyeCenter) {
          this.eyeRotation[0] = ((leftIris.x - leftEyeCenter.x) + (rightIris.x - rightEyeCenter.x)) / 2 * 5;
          this.eyeRotation[1] = ((leftIris.y - leftEyeCenter.y) + (rightIris.y - rightEyeCenter.y)) / 2 * 5;
        }
      }
    }

    _computeMouthParameters(landmarks, dt) {
      const upperLip = landmarks.get('upper_lip') || landmarks.get(13);
      const lowerLip = landmarks.get('lower_lip') || landmarks.get(14);
      const mouthLeft = landmarks.get('mouth_left') || landmarks.get(61);
      const mouthRight = landmarks.get('mouth_right') || landmarks.get(291);
      if (upperLip && lowerLip && mouthLeft && mouthRight) {
        const mouthHeight = Math.abs(upperLip.y - lowerLip.y);
        const mouthWidth = Math.abs(mouthRight.x - mouthLeft.x);
        const calibratedHeight = this.calibrationData?.mouthHeight || mouthHeight;
        const calibratedWidth = this.calibrationData?.mouthWidth || mouthWidth;
        this.mouthOpen = this._smoothValue('mouthOpen', Math.min(1, mouthHeight / (calibratedHeight * 3)), dt);
        this.jawOpen = this.mouthOpen * 0.8;
        const mouthCenterY = (upperLip.y + lowerLip.y) / 2;
        const cornerAvgY = (mouthLeft.y + mouthRight.y) / 2;
        this.mouthSmile = this._smoothValue('mouthSmile', Math.max(-1, Math.min(1, (mouthCenterY - cornerAvgY) * 10)), dt);
        this.lipPucker = Math.max(0, 1 - mouthWidth / (calibratedWidth * 0.8));
        this.lipFunnel = Math.max(0, mouthWidth / calibratedWidth - 1) * this.mouthOpen;
      }
    }

    _computeBrowParameters(landmarks, dt) {
      const leftBrow = landmarks.get('left_brow') || landmarks.get(105);
      const rightBrow = landmarks.get('right_brow') || landmarks.get(334);
      const leftEye = landmarks.get('left_eye') || landmarks.get(33);
      const rightEye = landmarks.get('right_eye') || landmarks.get(263);
      if (leftBrow && rightBrow && leftEye && rightEye) {
        const leftDistance = Math.abs(leftBrow.y - leftEye.y);
        const rightDistance = Math.abs(rightBrow.y - rightEye.y);
        const avgDistance = (leftDistance + rightDistance) / 2;
        const calibrated = this.calibrationData?.browHeight || avgDistance;
        this.browRaise = this._smoothValue('browRaise', Math.max(0, avgDistance / calibrated - 1) * 3, dt);
        this.browFurrow = this._smoothValue('browFurrow', Math.max(0, 1 - avgDistance / (calibrated * 0.9)), dt);
      }
    }

    _computeNoseParameters(landmarks, dt) {
      const noseLeft = landmarks.get('nose_left') || landmarks.get(71);
      const noseRight = landmarks.get('nose_right') || landmarks.get(300);
      if (noseLeft && noseRight) {
        const noseWidth = Math.abs(noseRight.x - noseLeft.x);
        const calibrated = this.calibrationData?.noseWidth || noseWidth;
        this.noseSneer = this._smoothValue('noseSneer', Math.max(0, noseWidth / calibrated - 1) * 2, dt);
      }
    }

    _computeBlendShapes() {
      this.blendShapes.set('eyeBlinkLeft', this.blinkWeight);
      this.blendShapes.set('eyeBlinkRight', this.blinkWeight);
      this.blendShapes.set('eyeWideLeft', this.eyeWide);
      this.blendShapes.set('eyeWideRight', this.eyeWide);
      this.blendShapes.set('eyeSquintLeft', this.eyeSquint);
      this.blendShapes.set('eyeSquintRight', this.eyeSquint);
      this.blendShapes.set('jawOpen', this.jawOpen);
      this.blendShapes.set('mouthOpen', this.mouthOpen);
      this.blendShapes.set('mouthSmileLeft', Math.max(0, this.mouthSmile));
      this.blendShapes.set('mouthSmileRight', Math.max(0, this.mouthSmile));
      this.blendShapes.set('mouthFrownLeft', Math.max(0, -this.mouthSmile));
      this.blendShapes.set('mouthFrownRight', Math.max(0, -this.mouthSmile));
      this.blendShapes.set('mouthPucker', this.lipPucker);
      this.blendShapes.set('mouthFunnel', this.lipFunnel);
      this.blendShapes.set('browInnerUp', this.browRaise * 0.5);
      this.blendShapes.set('browOuterUpLeft', this.browRaise);
      this.blendShapes.set('browOuterUpRight', this.browRaise);
      this.blendShapes.set('browDownLeft', this.browFurrow);
      this.blendShapes.set('browDownRight', this.browFurrow);
      this.blendShapes.set('noseSneerLeft', this.noseSneer);
      this.blendShapes.set('noseSneerRight', this.noseSneer);
      this.blendShapes.set('cheekPuff', this.cheekPuff);
      this.blendShapes.set('tongueOut', this.tongueOut);
    }

    _computeEyeHeight(landmarks) {
      const top = landmarks.get('left_eye_top') || landmarks.get(159);
      const bottom = landmarks.get('left_eye_bottom') || landmarks.get(145);
      return top && bottom ? Math.abs(top.y - bottom.y) : 0.02;
    }

    _computeMouthWidth(landmarks) {
      const left = landmarks.get('mouth_left') || landmarks.get(61);
      const right = landmarks.get('mouth_right') || landmarks.get(291);
      return left && right ? Math.abs(right.x - left.x) : 0.1;
    }

    _computeMouthHeight(landmarks) {
      const upper = landmarks.get('upper_lip') || landmarks.get(13);
      const lower = landmarks.get('lower_lip') || landmarks.get(14);
      return upper && lower ? Math.abs(upper.y - lower.y) : 0.01;
    }

    _computeBrowHeight(landmarks) {
      const brow = landmarks.get('left_brow') || landmarks.get(105);
      const eye = landmarks.get('left_eye') || landmarks.get(33);
      return brow && eye ? Math.abs(brow.y - eye.y) : 0.05;
    }

    _computeNoseWidth(landmarks) {
      const left = landmarks.get('nose_left') || landmarks.get(71);
      const right = landmarks.get('nose_right') || landmarks.get(300);
      return left && right ? Math.abs(right.x - left.x) : 0.03;
    }

    _computeFaceWidth(landmarks) {
      const left = landmarks.get('face_left') || landmarks.get(234);
      const right = landmarks.get('face_right') || landmarks.get(454);
      return left && right ? Math.abs(right.x - left.x) : 0.3;
    }

    _computeFaceHeight(landmarks) {
      const top = landmarks.get('face_top') || landmarks.get(10);
      const bottom = landmarks.get('chin') || landmarks.get(152);
      return top && bottom ? Math.abs(bottom.y - top.y) : 0.4;
    }

    _smoothValue(name, value, dt) {
      if (!this.smoothedValues.has(name)) this.smoothedValues.set(name, value);
      const prev = this.smoothedValues.get(name);
      const alpha = Math.min(1, dt / (this.smoothing + dt));
      const smoothed = prev + (value - prev) * alpha;
      this.smoothedValues.set(name, smoothed);
      return smoothed;
    }

    _eulerToQuaternion(x, y, z) {
      const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
      const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
      const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
      return [sx*cy*cz - cx*sy*sz, cx*sy*cz + sx*cy*sz, cx*cy*sz - sx*sy*cz, cx*cy*cz + sx*sy*sz];
    }

    getBlendShapes() { return Object.fromEntries(this.blendShapes); }
    getHeadRotation() { return [...this.headRotation]; }
    getHeadPosition() { return [...this.headPosition]; }
    getEyeRotation() { return [...this.eyeRotation]; }
    getBlinkWeight() { return this.blinkWeight; }
    getMouthOpen() { return this.mouthOpen; }
    getMouthSmile() { return this.mouthSmile; }
    setSmoothing(v) { this.smoothing = Math.max(0, Math.min(1, v)); }
    isCalibratedState() { return this.isCalibrated; }
    getLandmarkCount() { return this.faceLandmarks.size; }
    reset() {
      this.faceLandmarks.clear();
      this.blendShapes.clear();
      this.smoothedValues.clear();
      this.isCalibrated = false;
      this.calibrationData = null;
    }
    dispose() { this.reset(); }
  }

  // ============================================================
  // 步态生成器
  // ============================================================
  class GaitGenerator {
    constructor() {
      this.speed = 1;
      this.direction = [0, 0, 1];
      this.isMoving = false;
      this.phase = 0;
      this.strideLength = 0.6;
      this.stepHeight = 0.1;
      this.hipSwing = 0.05;
      this.armSwing = 0.3;
      this.bodyBob = 0.03;
      this.bodyLean = 0.05;
      this.kneeBend = 0.2;
      this.footLift = 0.05;
      this.footDrop = 0.02;
      this.turnSpeed = 0;
      this.targetDirection = [0, 0, 1];
      this.pelvisHeight = 0.9;
      this.legLength = 0.8;
      this.armLength = 0.6;
      this.shoulderWidth = 0.4;
      this.hipWidth = 0.25;
      this.lastPhase = 0;
    }

    update(dt) {
      const delta = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
      if (this.isMoving) {
        const speed = Number.isFinite(this.speed) ? this.speed : 0;
        const stride = Number.isFinite(this.strideLength) && this.strideLength > 0 ? this.strideLength : 1;
        const stepFrequency = speed / stride;
        this.phase += delta * stepFrequency * Math.PI * 2;
        this.phase = Number.isFinite(this.phase) ? this.phase % (Math.PI * 2) : 0;
      }
      this._updateDirection(delta);
      this.lastPhase = this.phase;
    }

    _updateDirection(dt) {
      const currentAngle = Math.atan2(this.direction[0], this.direction[2]);
      const targetAngle = Math.atan2(this.targetDirection[0], this.targetDirection[2]);
      let diff = targetAngle - currentAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const maxTurn = this.turnSpeed * dt;
      const turn = Math.max(-maxTurn, Math.min(maxTurn, diff));
      const newAngle = currentAngle + turn;
      this.direction = [Math.sin(newAngle), 0, Math.cos(newAngle)];
    }

    getPose() {
      const pose = { bones: [], pelvis: [0, this.pelvisHeight, 0], pelvisRotation: [0, 0, 0, 1] };
      const phase = this.phase;
      const leftPhase = phase;
      const rightPhase = phase + Math.PI;
      const leftStep = Math.sin(leftPhase);
      const rightStep = Math.sin(rightPhase);
      const leftLift = Math.max(0, Math.sin(leftPhase));
      const rightLift = Math.max(0, Math.sin(rightPhase));
      const bodyOffset = Math.sin(phase * 2) * this.bodyBob;
      pose.pelvis[1] = this.pelvisHeight + bodyOffset;
      pose.pelvis[0] = Math.sin(phase) * this.hipSwing;
      const hipYaw = Math.atan2(this.direction[0], this.direction[2]);
      pose.pelvisRotation = this._eulerToQuaternion(0, hipYaw, Math.sin(phase) * this.bodyLean * 0.5);
      pose.bones.push({
        name: 'leftUpperLeg',
        position: [-this.hipWidth / 2, 0, 0],
        rotation: this._eulerToQuaternion(leftStep * 0.5 + this.kneeBend * leftLift, 0, 0)
      });
      pose.bones.push({
        name: 'leftLowerLeg',
        position: [0, -this.legLength * 0.5, 0],
        rotation: this._eulerToQuaternion(-this.kneeBend * leftLift - this.footDrop * (1 - leftLift), 0, 0)
      });
      pose.bones.push({
        name: 'leftFoot',
        position: [0, -this.legLength * 0.5, 0],
        rotation: this._eulerToQuaternion(this.footLift * leftLift, 0, 0)
      });
      pose.bones.push({
        name: 'rightUpperLeg',
        position: [this.hipWidth / 2, 0, 0],
        rotation: this._eulerToQuaternion(rightStep * 0.5 + this.kneeBend * rightLift, 0, 0)
      });
      pose.bones.push({
        name: 'rightLowerLeg',
        position: [0, -this.legLength * 0.5, 0],
        rotation: this._eulerToQuaternion(-this.kneeBend * rightLift - this.footDrop * (1 - rightLift), 0, 0)
      });
      pose.bones.push({
        name: 'rightFoot',
        position: [0, -this.legLength * 0.5, 0],
        rotation: this._eulerToQuaternion(this.footLift * rightLift, 0, 0)
      });
      pose.bones.push({
        name: 'leftUpperArm',
        position: [-this.shoulderWidth / 2, 0.3, 0],
        rotation: this._eulerToQuaternion(-rightStep * this.armSwing, 0, 0.1)
      });
      pose.bones.push({
        name: 'leftLowerArm',
        position: [0, -this.armLength * 0.5, 0],
        rotation: this._eulerToQuaternion(-0.3 - Math.abs(rightStep) * 0.2, 0, 0)
      });
      pose.bones.push({
        name: 'rightUpperArm',
        position: [this.shoulderWidth / 2, 0.3, 0],
        rotation: this._eulerToQuaternion(-leftStep * this.armSwing, 0, -0.1)
      });
      pose.bones.push({
        name: 'rightLowerArm',
        position: [0, -this.armLength * 0.5, 0],
        rotation: this._eulerToQuaternion(-0.3 - Math.abs(leftStep) * 0.2, 0, 0)
      });
      pose.bones.push({
        name: 'spine',
        position: [0, 0.2, 0],
        rotation: this._eulerToQuaternion(this.bodyLean * (this.isMoving ? 1 : 0), 0, -Math.sin(phase) * this.hipSwing * 0.5)
      });
      pose.bones.push({
        name: 'head',
        position: [0, 0.5, 0],
        rotation: this._eulerToQuaternion(0, 0, Math.sin(phase) * this.hipSwing * 0.3)
      });
      return pose;
    }

    _eulerToQuaternion(x, y, z) {
      const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
      const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
      const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
      return [sx*cy*cz - cx*sy*sz, cx*sy*cz + sx*cy*sz, cx*cy*sz - sx*sy*cz, cx*cy*cz + sx*sy*sz];
    }

    setSpeed(v) {
      const n = Number(v);
      if (Number.isFinite(n)) this.speed = Math.min(20, Math.max(0, n));
    }
    setDirection(x, z) { this.targetDirection = this._normalize([x, 0, z]); }
    setMoving(v) { this.isMoving = !!v; }
    setStrideLength(v) {
      const n = Number(v);
      if (Number.isFinite(n)) this.strideLength = Math.min(5, Math.max(0.1, n));
    }
    setStepHeight(v) {
      const n = Number(v);
      if (Number.isFinite(n)) this.stepHeight = Math.min(2, Math.max(0, n));
    }
    setHipSwing(v) {
      const n = Number(v);
      if (Number.isFinite(n)) this.hipSwing = Math.min(1, Math.max(-1, n));
    }
    setArmSwing(v) {
      const n = Number(v);
      if (Number.isFinite(n)) this.armSwing = Math.min(2, Math.max(-2, n));
    }
    setBodyBob(v) {
      const n = Number(v);
      if (Number.isFinite(n)) this.bodyBob = Math.min(1, Math.max(0, n));
    }
    setTurnSpeed(v) {
      const n = Number(v);
      if (Number.isFinite(n)) this.turnSpeed = Math.min(20, Math.max(0, n));
    }
    getPhase() { return this.phase; }
    isMovingState() { return this.isMoving; }
    reset() { this.phase = 0; this.isMoving = false; this.direction = [0, 0, 1]; this.targetDirection = [0, 0, 1]; }
    _normalize(v) {
      const x = Number.isFinite(v && v[0]) ? v[0] : 0;
      const y = Number.isFinite(v && v[1]) ? v[1] : 0;
      const z = Number.isFinite(v && v[2]) ? v[2] : 0;
      const l = Math.sqrt(x * x + y * y + z * z);
      if (!l) return [0, 0, 1];
      return [x / l, y / l, z / l];
    }
    dispose() { this.reset(); }
  }

  return {
    MotionCaptureProcessor, MotionSynthesizer, FacialCaptureProcessor, GaitGenerator
  };
})();

if (typeof window !== 'undefined') window.ActionCapture = ActionCapture;
if (typeof globalThis !== 'undefined') globalThis.ActionCapture = ActionCapture;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ActionCapture;
}

if (typeof globalThis !== 'undefined') {
  globalThis.AEVUM = globalThis.AEVUM || {};
  globalThis.AEVUM.action = globalThis.AEVUM.action || {};
  globalThis.AEVUM.action.Capture = ActionCapture;
}
