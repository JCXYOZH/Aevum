/**
 * Aevum 人形动作：链式 IK、布娃娃、动作匹配。
 */
/**
 * 人形动作 - IK求解器/物理模拟/动作匹配/步态分析/运动重定向
 * 纯JavaScript，零第三方依赖
 * @version 2.0.0
 */
'use strict';

const ActionChain = (function () {

  class IKSolver {
    constructor() {
      this.maxIterations = 20;
      this.tolerance = 0.001;
      this.damping = 0.5;
      this.constraints = new Map();
      this.solveMethods = {
        ccd: this._solveCCD.bind(this),
        fabrik: this._solveFABRIK.bind(this),
        jacobian: this._solveJacobian.bind(this)
      };
    }

    solve(chain, target, method = 'ccd') {
      if (!chain || !Array.isArray(chain.bones) || chain.bones.length < 2) {
        return { iterations: 0, distance: Infinity, success: false };
      }
      if (!Array.isArray(target) || target.length < 3 || !target.every(Number.isFinite)) {
        return { iterations: 0, distance: Infinity, success: false };
      }
      const solver = this.solveMethods[method] || this._solveCCD;
      return solver(chain, target);
    }

    _solveCCD(chain, target) {
      const bones = chain.bones;
      const endEffector = bones[bones.length - 1];
      let iterations = 0;
      let distance = this._distance(endEffector.position, target);
      while (distance > this.tolerance && iterations < this.maxIterations) {
        for (let i = bones.length - 2; i >= 0; i--) {
          const bone = bones[i];
          const toEnd = this._subtract(endEffector.position, bone.position);
          const toTarget = this._subtract(target, bone.position);
          const angle = this._angleBetween(toEnd, toTarget);
          if (Math.abs(angle) < 0.0001) continue;
          const axis = this._normalize(this._cross(toEnd, toTarget));
          const rotation = this._axisAngleToQuaternion(axis, angle * this.damping);
          bone.rotation = this._multiplyQuaternions(rotation, bone.rotation);
          this._updateBonePositions(chain, i);
          distance = this._distance(endEffector.position, target);
          if (distance <= this.tolerance) break;
        }
        iterations++;
      }
      return { iterations, distance, success: distance <= this.tolerance };
    }

    _solveFABRIK(chain, target) {
      const bones = chain.bones;
      const positions = bones.map(b => [...b.position]);
      const lengths = [];
      for (let i = 0; i < bones.length - 1; i++) {
        lengths.push(this._distance(positions[i], positions[i + 1]));
      }
      const rootPosition = [...positions[0]];
      let iterations = 0;
      let distance = this._distance(positions[positions.length - 1], target);
      while (distance > this.tolerance && iterations < this.maxIterations) {
        positions[positions.length - 1] = [...target];
        for (let i = positions.length - 2; i >= 0; i--) {
          const direction = this._normalize(this._subtract(positions[i], positions[i + 1]));
          positions[i] = this._add(positions[i + 1], this._multiply(direction, lengths[i]));
        }
        positions[0] = [...rootPosition];
        for (let i = 0; i < positions.length - 1; i++) {
          const direction = this._normalize(this._subtract(positions[i + 1], positions[i]));
          positions[i + 1] = this._add(positions[i], this._multiply(direction, lengths[i]));
        }
        distance = this._distance(positions[positions.length - 1], target);
        iterations++;
      }
      for (let i = 0; i < bones.length; i++) {
        bones[i].position = positions[i];
      }
      this._updateBoneRotations(chain);
      return { iterations, distance, success: distance <= this.tolerance };
    }

    _solveJacobian(chain, target) {
      const bones = chain.bones;
      const endEffector = bones[bones.length - 1];
      let iterations = 0;
      let distance = this._distance(endEffector.position, target);
      while (distance > this.tolerance && iterations < this.maxIterations) {
        const jacobian = this._computeJacobian(chain);
        const error = this._subtract(target, endEffector.position);
        const deltaTheta = this._solveJacobianTranspose(jacobian, error);
        for (let i = 0; i < bones.length - 1; i++) {
          const axis = [0, 0, 1];
          const rotation = this._axisAngleToQuaternion(axis, deltaTheta[i] * this.damping);
          bones[i].rotation = this._multiplyQuaternions(rotation, bones[i].rotation);
        }
        this._updateBonePositions(chain, 0);
        distance = this._distance(endEffector.position, target);
        iterations++;
      }
      return { iterations, distance, success: distance <= this.tolerance };
    }

    _computeJacobian(chain) {
      const bones = chain.bones;
      const endEffector = bones[bones.length - 1];
      const jacobian = [];
      for (let i = 0; i < bones.length - 1; i++) {
        const axis = [0, 0, 1];
        const toEnd = this._subtract(endEffector.position, bones[i].position);
        const cross = this._cross(axis, toEnd);
        jacobian.push(cross);
      }
      return jacobian;
    }

    _solveJacobianTranspose(jacobian, error) {
      const result = new Array(jacobian.length).fill(0);
      const jtje = new Array(jacobian.length).fill(0);
      let jte = 0;
      for (let i = 0; i < jacobian.length; i++) {
        let dot = 0;
        for (let j = 0; j < 3; j++) {
          dot += jacobian[i][j] * error[j];
        }
        jtje[i] = dot;
        jte += dot * dot;
      }
      const alpha = jte > 0 ? 0.1 / jte : 0;
      for (let i = 0; i < jacobian.length; i++) {
        result[i] = alpha * jtje[i];
      }
      return result;
    }

    _updateBonePositions(chain, startIndex) {
      const bones = chain.bones;
      for (let i = startIndex; i < bones.length - 1; i++) {
        const bone = bones[i];
        const child = bones[i + 1];
        const direction = this._quaternionToVector(bone.rotation, [0, 1, 0]);
        const length = this._distance(bone.position, child.position);
        child.position = this._add(bone.position, this._multiply(direction, length));
      }
    }

    _updateBoneRotations(chain) {
      const bones = chain.bones;
      for (let i = 0; i < bones.length - 1; i++) {
        const direction = this._normalize(this._subtract(bones[i + 1].position, bones[i].position));
        bones[i].rotation = this._vectorToQuaternion(direction);
      }
    }

    _distance(a, b) {
      return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
    }

    _subtract(a, b) {
      return [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
    }

    _add(a, b) {
      return [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
    }

    _multiply(v, s) {
      return [v[0]*s, v[1]*s, v[2]*s];
    }

    _normalize(v) {
      const l = Math.sqrt(v[0]**2 + v[1]**2 + v[2]**2) || 1;
      return [v[0]/l, v[1]/l, v[2]/l];
    }

    _cross(a, b) {
      return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
    }

    _dot(a, b) {
      return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
    }

    _angleBetween(a, b) {
      const dot = this._dot(this._normalize(a), this._normalize(b));
      return Math.acos(Math.max(-1, Math.min(1, dot)));
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

    _quaternionToVector(q, v) {
      const t = [2*(q[1]*v[2]-q[2]*v[1]), 2*(q[2]*v[0]-q[0]*v[2]), 2*(q[0]*v[1]-q[1]*v[0])];
      return [
        v[0] + q[3]*t[0] + q[1]*t[2] - q[2]*t[1],
        v[1] + q[3]*t[1] + q[2]*t[0] - q[0]*t[2],
        v[2] + q[3]*t[2] + q[0]*t[1] - q[1]*t[0]
      ];
    }

    _vectorToQuaternion(v) {
      const forward = [0, 1, 0];
      const dot = this._dot(forward, v);
      if (dot > 0.99999) return [0, 0, 0, 1];
      if (dot < -0.99999) return [0, 0, 1, 0];
      const axis = this._normalize(this._cross(forward, v));
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      return this._axisAngleToQuaternion(axis, angle);
    }

    setMaxIterations(n) { this.maxIterations = n; }
    setTolerance(v) { this.tolerance = v; }
    setDamping(v) { this.damping = Math.max(0, Math.min(1, v)); }
  }

  class RagdollPhysics {
    constructor() {
      this.bodies = [];
      this.joints = [];
      this.gravity = [0, -9.8, 0];
      this.damping = 0.98;
      this.iterations = 10;
      this.enabled = true;
      this.collisionSpheres = [];
      this.groundY = 0;
      this.boneMapping = new Map();
    }

    addBody(config) {
      const body = {
        position: config.position || [0, 0, 0],
        previousPosition: config.position || [0, 0, 0],
        velocity: [0, 0, 0],
        acceleration: [0, 0, 0],
        mass: config.mass || 1,
        radius: config.radius || 0.1,
        boneIndex: config.boneIndex ?? -1,
        name: config.name || '',
        pinned: config.pinned || false,
        restitution: config.restitution || 0.3,
        friction: config.friction || 0.8
      };
      this.bodies.push(body);
      if (body.boneIndex >= 0) {
        this.boneMapping.set(body.boneIndex, body);
      }
      return body;
    }

    addJoint(config) {
      const joint = {
        bodyA: config.bodyA,
        bodyB: config.bodyB,
        restLength: config.restLength || this._distance(config.bodyA.position, config.bodyB.position),
        stiffness: config.stiffness || 1,
        damping: config.damping || 0.5,
        type: config.type || 'distance'
      };
      this.joints.push(joint);
      return joint;
    }

    update(deltaTime) {
      if (!this.enabled) return;
      const dt = Math.min(deltaTime, 1/30);
      for (const body of this.bodies) {
        if (body.pinned) continue;
        body.acceleration = [...this.gravity];
        body.velocity[0] = (body.position[0] - body.previousPosition[0]) / dt * this.damping;
        body.velocity[1] = (body.position[1] - body.previousPosition[1]) / dt * this.damping;
        body.velocity[2] = (body.position[2] - body.previousPosition[2]) / dt * this.damping;
        body.previousPosition = [...body.position];
        body.position[0] += body.velocity[0] * dt + body.acceleration[0] * dt * dt;
        body.position[1] += body.velocity[1] * dt + body.acceleration[1] * dt * dt;
        body.position[2] += body.velocity[2] * dt + body.acceleration[2] * dt * dt;
      }
      for (let iter = 0; iter < this.iterations; iter++) {
        for (const joint of this.joints) {
          this._solveJoint(joint);
        }
        for (const body of this.bodies) {
          this._solveCollisions(body);
        }
      }
    }

    _solveJoint(joint) {
      const a = joint.bodyA;
      const b = joint.bodyB;
      const delta = this._subtract(b.position, a.position);
      const distance = Math.sqrt(delta[0]**2 + delta[1]**2 + delta[2]**2) || 0.001;
      const diff = (distance - joint.restLength) / distance;
      const impulse = [
        delta[0] * diff * 0.5 * joint.stiffness,
        delta[1] * diff * 0.5 * joint.stiffness,
        delta[2] * diff * 0.5 * joint.stiffness
      ];
      if (!a.pinned) {
        a.position[0] += impulse[0];
        a.position[1] += impulse[1];
        a.position[2] += impulse[2];
      }
      if (!b.pinned) {
        b.position[0] -= impulse[0];
        b.position[1] -= impulse[1];
        b.position[2] -= impulse[2];
      }
    }

    _solveCollisions(body) {
      if (body.position[1] - body.radius < this.groundY) {
        body.position[1] = this.groundY + body.radius;
        body.velocity[1] = -body.velocity[1] * body.restitution;
        body.velocity[0] *= body.friction;
        body.velocity[2] *= body.friction;
      }
      for (const sphere of this.collisionSpheres) {
        const delta = this._subtract(body.position, sphere.center);
        const distance = Math.sqrt(delta[0]**2 + delta[1]**2 + delta[2]**2);
        const minDist = body.radius + sphere.radius;
        if (distance < minDist) {
          const push = (minDist - distance) / (distance || 0.001);
          body.position[0] += delta[0] * push;
          body.position[1] += delta[1] * push;
          body.position[2] += delta[2] * push;
        }
      }
    }

    getBodyPosition(boneIndex) {
      const body = this.boneMapping.get(boneIndex);
      return body ? body.position : null;
    }

    setBodyPinned(boneIndex, pinned) {
      const body = this.boneMapping.get(boneIndex);
      if (body) body.pinned = pinned;
    }

    addCollisionSphere(center, radius) {
      this.collisionSpheres.push({ center: [...center], radius });
    }

    setGravity(x, y, z) { this.gravity = [x, y, z]; }
    setDamping(v) { this.damping = Math.max(0, Math.min(1, v)); }
    setIterations(n) { this.iterations = Math.max(1, n); }
    setGroundY(y) { this.groundY = y; }
    setEnabled(v) { this.enabled = v; }
    getBodyCount() { return this.bodies.length; }
    getJointCount() { return this.joints.length; }
    clear() {
      this.bodies = [];
      this.joints = [];
      this.collisionSpheres = [];
      this.boneMapping.clear();
    }

    _distance(a, b) {
      return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
    }

    _subtract(a, b) {
      return [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
    }
  }

  class MotionMatcher {
    constructor() {
      this.motionDatabase = [];
      this.features = [];
      this.currentMotion = null;
      this.currentFrame = 0;
      this.playbackSpeed = 1;
      this.searchWindow = 30;
      this.featureWeights = {
        position: 1,
        velocity: 2,
        direction: 1.5,
        posture: 0.5
      };
      this.callbacks = new Map();
    }

    addMotion(name, frames, features) {
      const motion = {
        name,
        frames,
        features: features || this._extractFeatures(frames),
        frameCount: frames.length,
        loop: true
      };
      this.motionDatabase.push(motion);
      return motion;
    }

    _extractFeatures(frames) {
      const features = [];
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const prevFrame = frames[Math.max(0, i - 1)];
        const nextFrame = frames[Math.min(frames.length - 1, i + 1)];
        const feature = {
          position: frame.rootPosition || [0, 0, 0],
          velocity: [
            (nextFrame.rootPosition?.[0] || 0) - (prevFrame.rootPosition?.[0] || 0),
            (nextFrame.rootPosition?.[1] || 0) - (prevFrame.rootPosition?.[1] || 0),
            (nextFrame.rootPosition?.[2] || 0) - (prevFrame.rootPosition?.[2] || 0)
          ],
          direction: frame.rootDirection || [0, 0, 1],
          posture: this._extractPostureFeature(frame)
        };
        features.push(feature);
      }
      return features;
    }

    _extractPostureFeature(frame) {
      const posture = [];
      if (frame.bones) {
        for (const bone of frame.bones) {
          posture.push(bone.rotation?.[0] || 0);
          posture.push(bone.rotation?.[1] || 0);
          posture.push(bone.rotation?.[2] || 0);
          posture.push(bone.rotation?.[3] || 1);
        }
      }
      return posture;
    }

    search(targetFeature, maxResults = 5) {
      const results = [];
      for (const motion of this.motionDatabase) {
        for (let i = 0; i < motion.frameCount; i++) {
          const distance = this._computeDistance(targetFeature, motion.features[i]);
          results.push({ motion, frameIndex: i, distance });
        }
      }
      results.sort((a, b) => a.distance - b.distance);
      return results.slice(0, maxResults);
    }

    _computeDistance(a, b) {
      let distance = 0;
      distance += this.featureWeights.position * this._vectorDistance(a.position, b.position);
      distance += this.featureWeights.velocity * this._vectorDistance(a.velocity, b.velocity);
      distance += this.featureWeights.direction * (1 - this._dot(a.direction, b.direction));
      if (a.posture && b.posture) {
        distance += this.featureWeights.posture * this._vectorDistance(a.posture, b.posture);
      }
      return distance;
    }

    _vectorDistance(a, b) {
      if (!a || !b || a.length !== b.length) return 0;
      let sum = 0;
      for (let i = 0; i < a.length; i++) {
        sum += (a[i] - b[i]) ** 2;
      }
      return Math.sqrt(sum);
    }

    _dot(a, b) {
      if (!a || !b) return 0;
      let sum = 0;
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        sum += a[i] * b[i];
      }
      return sum;
    }

    play(motionName, startFrame = 0) {
      const motion = this.motionDatabase.find(m => m.name === motionName);
      if (!motion) return false;
      this.currentMotion = motion;
      this.currentFrame = startFrame;
      return true;
    }

    update(deltaTime) {
      if (!this.currentMotion) return null;
      this.currentFrame += deltaTime * this.playbackSpeed * 30;
      if (this.currentFrame >= this.currentMotion.frameCount) {
        if (this.currentMotion.loop) {
          this.currentFrame = this.currentFrame % this.currentMotion.frameCount;
        } else {
          this.currentFrame = this.currentMotion.frameCount - 1;
          const callback = this.callbacks.get('complete');
          if (callback) callback(this.currentMotion.name);
        }
      }
      const frameIndex = Math.floor(this.currentFrame);
      return this.currentMotion.frames[frameIndex];
    }

    getCurrentFrame() {
      if (!this.currentMotion) return null;
      return this.currentMotion.frames[Math.floor(this.currentFrame)];
    }

    getCurrentMotionName() {
      return this.currentMotion?.name || null;
    }

    getMotionNames() {
      return this.motionDatabase.map(m => m.name);
    }

    getMotionCount() {
      return this.motionDatabase.length;
    }

    setPlaybackSpeed(v) { this.playbackSpeed = v; }
    setSearchWindow(n) { this.searchWindow = n; }
    setFeatureWeight(name, weight) {
      if (this.featureWeights.hasOwnProperty(name)) {
        this.featureWeights[name] = weight;
      }
    }
    on(event, callback) { this.callbacks.set(event, callback); }
    clear() {
      this.motionDatabase = [];
      this.currentMotion = null;
      this.callbacks.clear();
    }
  }

  return {
    IKSolver, RagdollPhysics, MotionMatcher
  };
})();

if (typeof window !== 'undefined') window.ActionChain = ActionChain;
if (typeof globalThis !== 'undefined') globalThis.ActionChain = ActionChain;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ActionChain;
}

if (typeof globalThis !== 'undefined') {
  globalThis.AEVUM = globalThis.AEVUM || {};
  globalThis.AEVUM.action = globalThis.AEVUM.action || {};
  globalThis.AEVUM.action.Chain = ActionChain;
}
