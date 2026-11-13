/**
 * Aevum 人形动作：带关节限制的 IK、面部动画。
 */
/**
 * 人形动作 - IK求解器/布娃娃物理/运动匹配器/面部动画/手势系统
 * 纯JavaScript，零第三方依赖
 * @version 6.0.0
 */
'use strict';

const ActionJointIK = (function () {

  class IKSolver {
    constructor() {
      this.maxIterations = 20;
      this.tolerance = 0.001;
      this.damping = 0.85;
      this.useLimits = true;
      this.stats = { iterations: 0, solved: 0, failed: 0 };
    }

    solveCCD(joints, target, options = {}) {
      if (!Array.isArray(joints) || joints.length < 2) return false;
      if (!Array.isArray(target) || target.length < 3 || !target.every(Number.isFinite)) return false;
      const maxIterations = options.maxIterations || this.maxIterations;
      const tolerance = options.tolerance || this.tolerance;
      const damping = options.damping || this.damping;
      const useLimits = options.useLimits !== undefined ? options.useLimits : this.useLimits;
      const endEffector = joints[joints.length - 1];
      let iterations = 0;
      for (let i = 0; i < maxIterations; i++) {
        iterations++;
        const currentPosition = this._getEndEffectorPosition(joints);
        const distance = this._distance(currentPosition, target);
        if (distance < tolerance) {
          this.stats.solved++;
          this.stats.iterations += iterations;
          return true;
        }
        for (let j = joints.length - 2; j >= 0; j--) {
          const joint = joints[j];
          const jointPosition = joint.position || [0, 0, 0];
          const toEnd = this._subtract(currentPosition, jointPosition);
          const toTarget = this._subtract(target, jointPosition);
          const cross = this._cross(toEnd, toTarget);
          const crossLength = this._length(cross);
          if (crossLength < 0.0001) continue;
          const dot = this._dot(this._normalize(toEnd), this._normalize(toTarget));
          const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * damping;
          const axis = this._normalize(cross);
          const rotation = this._axisAngleToQuaternion(axis, angle);
          joint.rotation = this._multiplyQuaternion(rotation, joint.rotation || [0, 0, 0, 1]);
          if (useLimits && joint.limits) {
            joint.rotation = this._applyLimits(joint.rotation, joint.limits);
          }
          this._updateJointPositions(joints, j);
        }
      }
      this.stats.failed++;
      this.stats.iterations += iterations;
      return false;
    }

    solveFABRIK(joints, target, options = {}) {
      const maxIterations = options.maxIterations || this.maxIterations;
      const tolerance = options.tolerance || this.tolerance;
      const useLimits = options.useLimits !== undefined ? options.useLimits : this.useLimits;
      const positions = joints.map(j => [...(j.position || [0, 0, 0])]);
      const lengths = [];
      for (let i = 0; i < joints.length - 1; i++) {
        lengths.push(this._distance(positions[i], positions[i + 1]));
      }
      const totalLength = lengths.reduce((a, b) => a + b, 0);
      const basePosition = [...positions[0]];
      const targetDistance = this._distance(basePosition, target);
      if (targetDistance > totalLength) {
        const direction = this._normalize(this._subtract(target, basePosition));
        for (let i = 1; i < positions.length; i++) {
          positions[i] = this._add(positions[i - 1], this._multiply(direction, lengths[i - 1]));
        }
      } else {
        for (let iteration = 0; iteration < maxIterations; iteration++) {
          const endDistance = this._distance(positions[positions.length - 1], target);
          if (endDistance < tolerance) break;
          positions[positions.length - 1] = [...target];
          for (let i = positions.length - 2; i >= 0; i--) {
            const direction = this._normalize(this._subtract(positions[i], positions[i + 1]));
            positions[i] = this._add(positions[i + 1], this._multiply(direction, lengths[i]));
          }
          positions[0] = [...basePosition];
          for (let i = 1; i < positions.length; i++) {
            const direction = this._normalize(this._subtract(positions[i], positions[i - 1]));
            positions[i] = this._add(positions[i - 1], this._multiply(direction, lengths[i - 1]));
          }
        }
      }
      for (let i = 0; i < joints.length; i++) {
        joints[i].position = positions[i];
        if (i < joints.length - 1) {
          const direction = this._normalize(this._subtract(positions[i + 1], positions[i]));
          joints[i].rotation = this._lookRotation(direction, [0, 1, 0]);
          if (useLimits && joints[i].limits) {
            joints[i].rotation = this._applyLimits(joints[i].rotation, joints[i].limits);
          }
        }
      }
      this.stats.solved++;
      return true;
    }

    solveTwoBone(joint1, joint2, joint3, target, options = {}) {
      const elbowAxis = options.elbowAxis || [0, 0, 1];
      const bendDirection = options.bendDirection || 1;
      const pos1 = joint1.position || [0, 0, 0];
      const pos2 = joint2.position || [0, 0, 0];
      const pos3 = joint3.position || [0, 0, 0];
      const length1 = this._distance(pos1, pos2);
      const length2 = this._distance(pos2, pos3);
      const toTarget = this._subtract(target, pos1);
      const targetDistance = this._length(toTarget);
      const clampedDistance = Math.min(targetDistance, length1 + length2 - 0.001);
      const cosAngle2 = (length1 * length1 + length2 * length2 - clampedDistance * clampedDistance) / (2 * length1 * length2);
      const angle2 = Math.acos(Math.max(-1, Math.min(1, cosAngle2)));
      const cosAngle1 = (length1 * length1 + clampedDistance * clampedDistance - length2 * length2) / (2 * length1 * clampedDistance);
      const angle1 = Math.acos(Math.max(-1, Math.min(1, cosAngle1)));
      const targetDirection = this._normalize(toTarget);
      const referenceDirection = this._normalize(this._subtract(pos2, pos1));
      const rotationAxis = this._normalize(this._cross(referenceDirection, targetDirection));
      if (this._length(rotationAxis) < 0.001) {
        rotationAxis[0] = elbowAxis[0];
        rotationAxis[1] = elbowAxis[1];
        rotationAxis[2] = elbowAxis[2];
      }
      const rotation1 = this._axisAngleToQuaternion(rotationAxis, angle1 * bendDirection);
      joint1.rotation = this._multiplyQuaternion(rotation1, joint1.rotation || [0, 0, 0, 1]);
      const elbowRotation = this._axisAngleToQuaternion(rotationAxis, (Math.PI - angle2) * bendDirection);
      joint2.rotation = this._multiplyQuaternion(elbowRotation, joint2.rotation || [0, 0, 0, 1]);
      this.stats.solved++;
      return true;
    }

    _getEndEffectorPosition(joints) {
      return joints[joints.length - 1].position || [0, 0, 0];
    }

    _updateJointPositions(joints, startIndex) {
      for (let i = startIndex; i < joints.length - 1; i++) {
        const joint = joints[i];
        const nextJoint = joints[i + 1];
        const direction = this._quaternionToDirection(joint.rotation || [0, 0, 0, 1]);
        const length = joint.length || this._distance(joint.position || [0, 0, 0], nextJoint.position || [0, 0, 0]);
        nextJoint.position = this._add(joint.position || [0, 0, 0], this._multiply(direction, length));
      }
    }

    _distance(a, b) {
      return Math.sqrt((a[0] - b[0])**2 + (a[1] - b[1])**2 + (a[2] - b[2])**2);
    }

    _length(v) {
      return Math.sqrt(v[0]**2 + v[1]**2 + v[2]**2);
    }

    _normalize(v) {
      const l = this._length(v) || 1;
      return [v[0] / l, v[1] / l, v[2] / l];
    }

    _subtract(a, b) {
      return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    }

    _add(a, b) {
      return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    }

    _multiply(v, s) {
      return [v[0] * s, v[1] * s, v[2] * s];
    }

    _dot(a, b) {
      return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    _cross(a, b) {
      return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
      ];
    }

    _axisAngleToQuaternion(axis, angle) {
      const halfAngle = angle / 2;
      const s = Math.sin(halfAngle);
      return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(halfAngle)];
    }

    _multiplyQuaternion(a, b) {
      return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
      ];
    }

    _quaternionToDirection(q) {
      const x = q[0], y = q[1], z = q[2], w = q[3];
      return [
        2 * (x * z + w * y),
        2 * (y * z - w * x),
        1 - 2 * (x * x + y * y)
      ];
    }

    _lookRotation(forward, up) {
      const f = this._normalize(forward);
      const s = this._normalize(this._cross(up, f));
      const u = this._cross(f, s);
      const m00 = s[0], m01 = s[1], m02 = s[2];
      const m10 = u[0], m11 = u[1], m12 = u[2];
      const m20 = f[0], m21 = f[1], m22 = f[2];
      const trace = m00 + m11 + m22;
      let q;
      if (trace > 0) {
        const s = 0.5 / Math.sqrt(trace + 1);
        q = [(m12 - m21) * s, (m20 - m02) * s, (m01 - m10) * s, 0.25 / s];
      } else if (m00 > m11 && m00 > m22) {
        const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
        q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m12 - m21) / s];
      } else if (m11 > m22) {
        const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
        q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m20 - m02) / s];
      } else {
        const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
        q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m01 - m10) / s];
      }
      return this._normalize(q);
    }

    _applyLimits(rotation, limits) {
      const euler = this._quaternionToEuler(rotation);
      euler[0] = Math.max(limits.minX || -Math.PI, Math.min(limits.maxX || Math.PI, euler[0]));
      euler[1] = Math.max(limits.minY || -Math.PI, Math.min(limits.maxY || Math.PI, euler[1]));
      euler[2] = Math.max(limits.minZ || -Math.PI, Math.min(limits.maxZ || Math.PI, euler[2]));
      return this._eulerToQuaternion(euler);
    }

    _quaternionToEuler(q) {
      const x = q[0], y = q[1], z = q[2], w = q[3];
      const sinr_cosp = 2 * (w * x + y * z);
      const cosr_cosp = 1 - 2 * (x * x + y * y);
      const roll = Math.atan2(sinr_cosp, cosr_cosp);
      const sinp = 2 * (w * y - z * x);
      const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);
      const siny_cosp = 2 * (w * z + x * y);
      const cosy_cosp = 1 - 2 * (y * y + z * z);
      const yaw = Math.atan2(siny_cosp, cosy_cosp);
      return [roll, pitch, yaw];
    }

    _eulerToQuaternion(euler) {
      const roll = euler[0], pitch = euler[1], yaw = euler[2];
      const cr = Math.cos(roll / 2);
      const sr = Math.sin(roll / 2);
      const cp = Math.cos(pitch / 2);
      const sp = Math.sin(pitch / 2);
      const cy = Math.cos(yaw / 2);
      const sy = Math.sin(yaw / 2);
      return [
        sr * cp * cy - cr * sp * sy,
        cr * sp * cy + sr * cp * sy,
        cr * cp * sy - sr * sp * cy,
        cr * cp * cy + sr * sp * sy
      ];
    }

    setMaxIterations(iterations) {
      this.maxIterations = Math.max(1, iterations);
    }

    setTolerance(tolerance) {
      this.tolerance = Math.max(0, tolerance);
    }

    setDamping(damping) {
      this.damping = Math.max(0, Math.min(1, damping));
    }

    setUseLimits(useLimits) {
      this.useLimits = useLimits;
    }

    getStats() {
      return { ...this.stats };
    }

    resetStats() {
      this.stats = { iterations: 0, solved: 0, failed: 0 };
    }
  }

  class FacialAnimator {
    constructor() {
      this.blendShapes = new Map();
      this.currentWeights = new Map();
      this.targetWeights = new Map();
      this.expressions = new Map();
      this.autoBlink = true;
      this.blinkInterval = 4;
      this.blinkDuration = 0.15;
      this.blendSpeed = 8;
      this.lastBlinkTime = 0;
      this.isBlinking = false;
      this.blendProgress = 0;
      this.stats = { blendShapes: 0, expressions: 0, updates: 0 };
      this._initDefaultExpressions();
    }

    _initDefaultExpressions() {
      const expressions = {
        neutral: { eyeBlinkLeft: 0, eyeBlinkRight: 0, eyeLookUpLeft: 0, eyeLookUpRight: 0, eyeLookDownLeft: 0, eyeLookDownRight: 0, eyeLookInLeft: 0, eyeLookInRight: 0, eyeLookOutLeft: 0, eyeLookOutRight: 0, eyeWideLeft: 0, eyeWideRight: 0, eyeSquintLeft: 0, eyeSquintRight: 0, browDownLeft: 0, browDownRight: 0, browInnerUp: 0, browOuterUpLeft: 0, browOuterUpRight: 0, noseSneerLeft: 0, noseSneerRight: 0, jawOpen: 0, jawForward: 0, jawLeft: 0, jawRight: 0, mouthClose: 0, mouthFunnel: 0, mouthPucker: 0, mouthLeft: 0, mouthRight: 0, mouthSmileLeft: 0, mouthSmileRight: 0, mouthFrownLeft: 0, mouthFrownRight: 0, mouthDimpleLeft: 0, mouthDimpleRight: 0, mouthStretchLeft: 0, mouthStretchRight: 0, mouthRollLower: 0, mouthRollUpper: 0, mouthShrugLower: 0, mouthShrugUpper: 0, mouthPressLeft: 0, mouthPressRight: 0, mouthLowerDownLeft: 0, mouthLowerDownRight: 0, mouthUpperUpLeft: 0, mouthUpperUpRight: 0, cheekPuff: 0, cheekSquintLeft: 0, cheekSquintRight: 0, tongueOut: 0 },
        happy: { mouthSmileLeft: 0.8, mouthSmileRight: 0.8, cheekSquintLeft: 0.3, cheekSquintRight: 0.3, eyeWideLeft: 0.2, eyeWideRight: 0.2, browOuterUpLeft: 0.1, browOuterUpRight: 0.1 },
        sad: { mouthFrownLeft: 0.6, mouthFrownRight: 0.6, browInnerUp: 0.8, browDownLeft: 0.2, browDownRight: 0.2, eyeWideLeft: 0.3, eyeWideRight: 0.3 },
        angry: { browDownLeft: 0.8, browDownRight: 0.8, browInnerUp: 0.3, eyeWideLeft: 0.5, eyeWideRight: 0.5, noseSneerLeft: 0.4, noseSneerRight: 0.4, mouthPressLeft: 0.3, mouthPressRight: 0.3 },
        surprised: { eyeWideLeft: 1, eyeWideRight: 1, browInnerUp: 0.8, browOuterUpLeft: 0.8, browOuterUpRight: 0.8, jawOpen: 0.6, mouthUpperUpLeft: 0.3, mouthUpperUpRight: 0.3 },
        scared: { eyeWideLeft: 0.9, eyeWideRight: 0.9, browInnerUp: 0.7, browOuterUpLeft: 0.5, browOuterUpRight: 0.5, mouthStretchLeft: 0.5, mouthStretchRight: 0.5, jawOpen: 0.4 },
        disgusted: { noseSneerLeft: 0.8, noseSneerRight: 0.8, browDownLeft: 0.5, browDownRight: 0.5, mouthUpperUpLeft: 0.4, mouthUpperUpRight: 0.4, mouthLowerDownLeft: 0.2, mouthLowerDownRight: 0.2 },
        thinking: { browInnerUp: 0.3, browDownLeft: 0.2, browDownRight: 0.2, eyeLookUpLeft: 0.3, eyeLookUpRight: 0.3, mouthPressLeft: 0.2, mouthPressRight: 0.2 },
        wink: { eyeBlinkLeft: 1, eyeBlinkRight: 0, mouthSmileLeft: 0.3, mouthSmileRight: 0.3 },
        kiss: { mouthPucker: 0.8, mouthFunnel: 0.3, eyeBlinkLeft: 0.2, eyeBlinkRight: 0.2 }
      };
      for (const [name, weights] of Object.entries(expressions)) {
        this.expressions.set(name, { ...weights });
      }
      this.stats.expressions = this.expressions.size;
    }

    addBlendShape(name, config = {}) {
      this.blendShapes.set(name, {
        name,
        target: config.target || null,
        weight: 0,
        minValue: config.minValue || 0,
        maxValue: config.maxValue || 1,
        category: config.category || 'other'
      });
      this.currentWeights.set(name, 0);
      this.targetWeights.set(name, 0);
      this.stats.blendShapes++;
    }

    removeBlendShape(name) {
      this.blendShapes.delete(name);
      this.currentWeights.delete(name);
      this.targetWeights.delete(name);
      this.stats.blendShapes--;
    }

    setWeight(name, weight, immediate = false) {
      const blendShape = this.blendShapes.get(name);
      if (!blendShape) return;
      const clampedWeight = Math.max(blendShape.minValue, Math.min(blendShape.maxValue, weight));
      this.targetWeights.set(name, clampedWeight);
      if (immediate) {
        this.currentWeights.set(name, clampedWeight);
      }
    }

    getWeight(name) {
      return this.currentWeights.get(name) || 0;
    }

    getTargetWeight(name) {
      return this.targetWeights.get(name) || 0;
    }

    setExpression(name, weight = 1, immediate = false) {
      const expression = this.expressions.get(name);
      if (!expression) return;
      for (const [blendShapeName, blendShapeWeight] of Object.entries(expression)) {
        this.setWeight(blendShapeName, blendShapeWeight * weight, immediate);
      }
    }

    addExpression(name, weights) {
      this.expressions.set(name, { ...weights });
      this.stats.expressions++;
    }

    removeExpression(name) {
      this.expressions.delete(name);
      this.stats.expressions--;
    }

    getExpression(name) {
      return this.expressions.get(name);
    }

    getExpressionNames() {
      return Array.from(this.expressions.keys());
    }

    update(deltaTime, currentTime) {
      const blendFactor = Math.min(1, deltaTime * this.blendSpeed);
      for (const [name, targetWeight] of this.targetWeights) {
        const currentWeight = this.currentWeights.get(name) || 0;
        const newWeight = currentWeight + (targetWeight - currentWeight) * blendFactor;
        this.currentWeights.set(name, newWeight);
      }
      if (this.autoBlink && !this.isBlinking) {
        if (currentTime - this.lastBlinkTime > this.blinkInterval) {
          this.startBlink();
        }
      }
      if (this.isBlinking) {
        this.blendProgress += deltaTime / this.blinkDuration;
        if (this.blendProgress >= 1) {
          this.isBlinking = false;
          this.blendProgress = 0;
          this.lastBlinkTime = currentTime;
          this.setWeight('eyeBlinkLeft', 0);
          this.setWeight('eyeBlinkRight', 0);
        } else {
          const blinkWeight = Math.sin(this.blendProgress * Math.PI);
          this.setWeight('eyeBlinkLeft', blinkWeight, true);
          this.setWeight('eyeBlinkRight', blinkWeight, true);
        }
      }
      this.stats.updates++;
    }

    startBlink() {
      this.isBlinking = true;
      this.blendProgress = 0;
    }

    setAutoBlink(enabled) {
      this.autoBlink = enabled;
    }

    setBlinkInterval(interval) {
      this.blinkInterval = Math.max(0.5, interval);
    }

    setBlinkDuration(duration) {
      this.blinkDuration = Math.max(0.05, duration);
    }

    setBlendSpeed(speed) {
      this.blendSpeed = Math.max(0.1, speed);
    }

    getWeights() {
      const weights = {};
      for (const [name, weight] of this.currentWeights) {
        weights[name] = weight;
      }
      return weights;
    }

    getBlendShapeNames() {
      return Array.from(this.blendShapes.keys());
    }

    getBlendShapeCount() {
      return this.blendShapes.size;
    }

    getStats() {
      return { ...this.stats };
    }

    reset() {
      for (const name of this.currentWeights.keys()) {
        this.currentWeights.set(name, 0);
        this.targetWeights.set(name, 0);
      }
      this.isBlinking = false;
      this.blendProgress = 0;
      this.lastBlinkTime = 0;
    }

    dispose() {
      this.blendShapes.clear();
      this.currentWeights.clear();
      this.targetWeights.clear();
      this.expressions.clear();
    }
  }

  return {
    IKSolver, FacialAnimator
  };
})();

if (typeof window !== 'undefined') window.ActionJointIK = ActionJointIK;
if (typeof globalThis !== 'undefined') globalThis.ActionJointIK = ActionJointIK;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ActionJointIK;
}

if (typeof globalThis !== 'undefined') {
  globalThis.AEVUM = globalThis.AEVUM || {};
  globalThis.AEVUM.action = globalThis.AEVUM.action || {};
  globalThis.AEVUM.action.JointIK = ActionJointIK;
}
