/**
 * Aevum 人形动作：动作匹配、布娃娃。
 */
/**
 * 人形动作 - 运动匹配/布娃娃物理/动作捕捉/步态生成/面部动画
 * 纯JavaScript，零第三方依赖
 * @version 5.0.0
 */
'use strict';

const ActionMatcher = (function () {

  class MotionMatcher {
    constructor() {
      this.motionDatabase = [];
      this.currentMotion = null;
      this.currentTime = 0;
      this.playbackSpeed = 1;
      this.loop = true;
      this.matchingThreshold = 0.5;
      this.blendTime = 0.2;
      this.isBlending = false;
      this.blendProgress = 0;
      this.previousMotion = null;
      this.previousTime = 0;
      this.callbacks = new Map();
      this.stats = { matches: 0, blends: 0, totalMotions: 0 };
    }

    addMotion(motion) {
      this.motionDatabase.push({
        ...motion,
        id: this._generateId(),
        features: this._extractFeatures(motion),
        duration: this._calculateDuration(motion)
      });
      this.stats.totalMotions++;
      return this.motionDatabase.length - 1;
    }

    removeMotion(index) {
      this.motionDatabase.splice(index, 1);
      this.stats.totalMotions--;
    }

    _extractFeatures(motion) {
      const features = {
        averageSpeed: 0,
        verticalSpeed: 0,
        direction: [0, 0, 1],
        strideLength: 0,
        strideFrequency: 0,
        upperBodyActivity: 0,
        lowerBodyActivity: 0,
        jumpHeight: 0,
        rotationSpeed: 0
      };
      if (!motion.tracks || motion.tracks.length === 0) return features;
      let totalSpeed = 0;
      let totalVerticalSpeed = 0;
      let frameCount = 0;
      const hipTrack = motion.tracks.find(t => t.boneName.toLowerCase().includes('hip') || t.boneName.toLowerCase().includes('pelvis'));
      if (hipTrack && hipTrack.keyframes.length > 1) {
        for (let i = 1; i < hipTrack.keyframes.length; i++) {
          const prev = hipTrack.keyframes[i - 1];
          const curr = hipTrack.keyframes[i];
          const dt = curr.time - prev.time;
          if (dt > 0) {
            const speed = Math.sqrt(
              (curr.value[0] - prev.value[0])**2 +
              (curr.value[2] - prev.value[2])**2
            ) / dt;
            totalSpeed += speed;
            totalVerticalSpeed += Math.abs(curr.value[1] - prev.value[1]) / dt;
            frameCount++;
          }
        }
      }
      features.averageSpeed = frameCount > 0 ? totalSpeed / frameCount : 0;
      features.verticalSpeed = frameCount > 0 ? totalVerticalSpeed / frameCount : 0;
      return features;
    }

    _calculateDuration(motion) {
      if (!motion.tracks || motion.tracks.length === 0) return 0;
      let maxTime = 0;
      for (const track of motion.tracks) {
        if (track.keyframes.length > 0) {
          maxTime = Math.max(maxTime, track.keyframes[track.keyframes.length - 1].time);
        }
      }
      return maxTime;
    }

    match(queryFeatures) {
      let bestMatch = -1;
      let bestScore = Infinity;
      for (let i = 0; i < this.motionDatabase.length; i++) {
        const motion = this.motionDatabase[i];
        const score = this._calculateDistance(queryFeatures, motion.features);
        if (score < bestScore && score < this.matchingThreshold * 10) {
          bestScore = score;
          bestMatch = i;
        }
      }
      if (bestMatch >= 0) {
        this.stats.matches++;
        return { index: bestMatch, motion: this.motionDatabase[bestMatch], score: bestScore };
      }
      return null;
    }

    _calculateDistance(a, b) {
      let distance = 0;
      distance += (a.averageSpeed - b.averageSpeed)**2 * 2;
      distance += (a.verticalSpeed - b.verticalSpeed)**2 * 1.5;
      distance += (a.strideLength - b.strideLength)**2;
      distance += (a.strideFrequency - b.strideFrequency)**2;
      distance += (a.upperBodyActivity - b.upperBodyActivity)**2;
      distance += (a.lowerBodyActivity - b.lowerBodyActivity)**2 * 1.5;
      distance += (a.jumpHeight - b.jumpHeight)**2;
      distance += (a.rotationSpeed - b.rotationSpeed)**2;
      return Math.sqrt(distance);
    }

    play(motionIndex, startTime = 0) {
      const motion = this.motionDatabase[motionIndex];
      if (!motion) return false;
      if (this.currentMotion && !this.isBlending) {
        this.previousMotion = this.currentMotion;
        this.previousTime = this.currentTime;
        this.isBlending = true;
        this.blendProgress = 0;
        this.stats.blends++;
      }
      this.currentMotion = motion;
      this.currentTime = startTime;
      const callback = this.callbacks.get('play');
      if (callback) callback(motion, startTime);
      return true;
    }

    update(deltaTime) {
      if (!this.currentMotion) return null;
      this.currentTime += deltaTime * this.playbackSpeed;
      if (this.currentTime >= this.currentMotion.duration) {
        if (this.loop) {
          this.currentTime = this.currentTime % this.currentMotion.duration;
        } else {
          this.currentTime = this.currentMotion.duration;
          const callback = this.callbacks.get('end');
          if (callback) callback(this.currentMotion);
        }
      }
      if (this.isBlending) {
        this.blendProgress += deltaTime / this.blendTime;
        if (this.blendProgress >= 1) {
          this.isBlending = false;
          this.blendProgress = 0;
          this.previousMotion = null;
        }
      }
      return this.sample(this.currentTime);
    }

    sample(time) {
      if (!this.currentMotion) return null;
      const pose = this._sampleMotion(this.currentMotion, time);
      if (this.isBlending && this.previousMotion) {
        const previousPose = this._sampleMotion(this.previousMotion, this.previousTime);
        return this._blendPoses(previousPose, pose, this.blendProgress);
      }
      return pose;
    }

    _sampleMotion(motion, time) {
      const pose = {
        bones: new Map(),
        time
      };
      for (const track of motion.tracks) {
        const bonePose = this._sampleTrack(track, time);
        pose.bones.set(track.boneName, bonePose);
      }
      return pose;
    }

    _sampleTrack(track, time) {
      if (track.keyframes.length === 0) return null;
      if (time <= track.keyframes[0].time) {
        return { ...track.keyframes[0] };
      }
      if (time >= track.keyframes[track.keyframes.length - 1].time) {
        return { ...track.keyframes[track.keyframes.length - 1] };
      }
      for (let i = 0; i < track.keyframes.length - 1; i++) {
        const a = track.keyframes[i];
        const b = track.keyframes[i + 1];
        if (time >= a.time && time <= b.time) {
          const t = (time - a.time) / (b.time - a.time);
          if (track.type === 'rotation') {
            return { time, value: this._slerp(a.value, b.value, t) };
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
      }
      return { ...track.keyframes[track.keyframes.length - 1] };
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

    _blendPoses(poseA, poseB, t) {
      const blended = {
        bones: new Map(),
        time: poseB.time
      };
      for (const [boneName, boneB] of poseB.bones) {
        const boneA = poseA.bones.get(boneName);
        if (boneA && boneB) {
          if (boneA.value.length === 4) {
            blended.bones.set(boneName, {
              time: boneB.time,
              value: this._slerp(boneA.value, boneB.value, t)
            });
          } else {
            blended.bones.set(boneName, {
              time: boneB.time,
              value: [
                boneA.value[0] + (boneB.value[0] - boneA.value[0]) * t,
                boneA.value[1] + (boneB.value[1] - boneA.value[1]) * t,
                boneA.value[2] + (boneB.value[2] - boneA.value[2]) * t
              ]
            });
          }
        } else if (boneB) {
          blended.bones.set(boneName, { ...boneB });
        }
      }
      return blended;
    }

    getCurrentMotion() {
      return this.currentMotion;
    }

    getCurrentTime() {
      return this.currentTime;
    }

    setPlaybackSpeed(speed) {
      this.playbackSpeed = speed;
    }

    setLoop(loop) {
      this.loop = loop;
    }

    setBlendTime(time) {
      this.blendTime = Math.max(0, time);
    }

    setMatchingThreshold(threshold) {
      this.matchingThreshold = threshold;
    }

    getMotionCount() {
      return this.motionDatabase.length;
    }

    getMotion(index) {
      return this.motionDatabase[index];
    }

    getStats() {
      return { ...this.stats };
    }

    on(event, callback) {
      this.callbacks.set(event, callback);
    }

    off(event) {
      this.callbacks.delete(event);
    }

    stop() {
      this.currentMotion = null;
      this.currentTime = 0;
      this.isBlending = false;
      this.previousMotion = null;
    }

    clear() {
      this.stop();
      this.motionDatabase = [];
      this.callbacks.clear();
      this.stats = { matches: 0, blends: 0, totalMotions: 0 };
    }

    _generateId() {
      return 'motion_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
    }
  }

  class RagdollPhysics {
    constructor() {
      this.bodies = [];
      this.joints = [];
      this.gravity = [0, -9.8, 0];
      this.damping = 0.98;
      this.iterations = 8;
      this.enabled = false;
      this.groundY = 0;
      this.groundFriction = 0.8;
      this.bounce = 0.3;
      this.stats = { bodies: 0, joints: 0, active: false };
    }

    addBody(config) {
      const body = {
        id: this.bodies.length,
        position: config.position || [0, 0, 0],
        previousPosition: config.position || [0, 0, 0],
        velocity: [0, 0, 0],
        angularVelocity: [0, 0, 0],
        rotation: config.rotation || [0, 0, 0, 1],
        mass: config.mass || 1,
        invMass: 1 / (config.mass || 1),
        size: config.size || [0.1, 0.1, 0.1],
        type: config.type || 'box',
        boneName: config.boneName || '',
        friction: config.friction || 0.5,
        restitution: config.restitution || 0.3,
        active: config.active !== false
      };
      this.bodies.push(body);
      this.stats.bodies++;
      return body;
    }

    removeBody(id) {
      const index = this.bodies.findIndex(b => b.id === id);
      if (index !== -1) {
        this.bodies.splice(index, 1);
        this.joints = this.joints.filter(j => j.bodyA !== id && j.bodyB !== id);
        this.stats.bodies--;
      }
    }

    addJoint(config) {
      const joint = {
        id: this.joints.length,
        bodyA: config.bodyA,
        bodyB: config.bodyB,
        anchorA: config.anchorA || [0, 0, 0],
        anchorB: config.anchorB || [0, 0, 0],
        type: config.type || 'hinge',
        axis: config.axis || [0, 1, 0],
        minAngle: config.minAngle || -Math.PI,
        maxAngle: config.maxAngle || Math.PI,
        stiffness: config.stiffness || 1,
        damping: config.damping || 0.5,
        active: config.active !== false
      };
      this.joints.push(joint);
      this.stats.joints++;
      return joint;
    }

    removeJoint(id) {
      const index = this.joints.findIndex(j => j.id === id);
      if (index !== -1) {
        this.joints.splice(index, 1);
        this.stats.joints--;
      }
    }

    update(deltaTime) {
      if (!this.enabled) return;
      const dt = Math.min(deltaTime, 1 / 30);
      for (const body of this.bodies) {
        if (!body.active) continue;
        body.velocity[0] += this.gravity[0] * dt;
        body.velocity[1] += this.gravity[1] * dt;
        body.velocity[2] += this.gravity[2] * dt;
        body.velocity[0] *= this.damping;
        body.velocity[1] *= this.damping;
        body.velocity[2] *= this.damping;
        body.previousPosition = [...body.position];
        body.position[0] += body.velocity[0] * dt;
        body.position[1] += body.velocity[1] * dt;
        body.position[2] += body.velocity[2] * dt;
        this._resolveGroundCollision(body);
      }
      for (let i = 0; i < this.iterations; i++) {
        for (const joint of this.joints) {
          if (!joint.active) continue;
          this._solveJoint(joint);
        }
        for (const body of this.bodies) {
          if (!body.active) continue;
          this._resolveGroundCollision(body);
        }
      }
      for (const body of this.bodies) {
        if (!body.active) continue;
        body.velocity[0] = (body.position[0] - body.previousPosition[0]) / dt;
        body.velocity[1] = (body.position[1] - body.previousPosition[1]) / dt;
        body.velocity[2] = (body.position[2] - body.previousPosition[2]) / dt;
      }
      this.stats.active = true;
    }

    _resolveGroundCollision(body) {
      const halfHeight = body.size[1] / 2;
      if (body.position[1] - halfHeight < this.groundY) {
        body.position[1] = this.groundY + halfHeight;
        if (body.velocity[1] < 0) {
          body.velocity[1] = -body.velocity[1] * this.bounce;
        }
        body.velocity[0] *= this.groundFriction;
        body.velocity[2] *= this.groundFriction;
      }
    }

    _solveJoint(joint) {
      const bodyA = this.bodies.find(b => b.id === joint.bodyA);
      const bodyB = this.bodies.find(b => b.id === joint.bodyB);
      if (!bodyA || !bodyB) return;
      const worldAnchorA = [
        bodyA.position[0] + joint.anchorA[0],
        bodyA.position[1] + joint.anchorA[1],
        bodyA.position[2] + joint.anchorA[2]
      ];
      const worldAnchorB = [
        bodyB.position[0] + joint.anchorB[0],
        bodyB.position[1] + joint.anchorB[1],
        bodyB.position[2] + joint.anchorB[2]
      ];
      const delta = [
        worldAnchorB[0] - worldAnchorA[0],
        worldAnchorB[1] - worldAnchorA[1],
        worldAnchorB[2] - worldAnchorA[2]
      ];
      const distance = Math.sqrt(delta[0]**2 + delta[1]**2 + delta[2]**2);
      if (distance < 0.0001) return;
      const correction = distance * 0.5 * joint.stiffness;
      const direction = [delta[0] / distance, delta[1] / distance, delta[2] / distance];
      const totalInvMass = bodyA.invMass + bodyB.invMass;
      if (totalInvMass > 0) {
        bodyA.position[0] += direction[0] * correction * (bodyA.invMass / totalInvMass);
        bodyA.position[1] += direction[1] * correction * (bodyA.invMass / totalInvMass);
        bodyA.position[2] += direction[2] * correction * (bodyA.invMass / totalInvMass);
        bodyB.position[0] -= direction[0] * correction * (bodyB.invMass / totalInvMass);
        bodyB.position[1] -= direction[1] * correction * (bodyB.invMass / totalInvMass);
        bodyB.position[2] -= direction[2] * correction * (bodyB.invMass / totalInvMass);
      }
    }

    setBodyPosition(id, position) {
      const body = this.bodies.find(b => b.id === id);
      if (body) {
        body.position = [...position];
        body.previousPosition = [...position];
      }
    }

    setBodyVelocity(id, velocity) {
      const body = this.bodies.find(b => b.id === id);
      if (body) body.velocity = [...velocity];
    }

    getBody(id) {
      return this.bodies.find(b => b.id === id);
    }

    getBodyByBoneName(boneName) {
      return this.bodies.find(b => b.boneName === boneName);
    }

    getBodies() {
      return [...this.bodies];
    }

    getJoints() {
      return [...this.joints];
    }

    setGravity(x, y, z) {
      this.gravity = [x, y, z];
    }

    setDamping(damping) {
      this.damping = Math.max(0, Math.min(1, damping));
    }

    setIterations(iterations) {
      this.iterations = Math.max(1, iterations);
    }

    setGroundY(y) {
      this.groundY = y;
    }

    setEnabled(v) {
      this.enabled = v;
      this.stats.active = v;
    }

    isEnabled() {
      return this.enabled;
    }

    getStats() {
      return { ...this.stats };
    }

    clear() {
      this.bodies = [];
      this.joints = [];
      this.enabled = false;
      this.stats = { bodies: 0, joints: 0, active: false };
    }
  }

  return {
    MotionMatcher, RagdollPhysics
  };
})();

if (typeof window !== 'undefined') window.ActionMatcher = ActionMatcher;
if (typeof globalThis !== 'undefined') globalThis.ActionMatcher = ActionMatcher;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ActionMatcher;
}

if (typeof globalThis !== 'undefined') {
  globalThis.AEVUM = globalThis.AEVUM || {};
  globalThis.AEVUM.action = globalThis.AEVUM.action || {};
  globalThis.AEVUM.action.Matcher = ActionMatcher;
}
