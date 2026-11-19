
// ============================================================
// 模块三：动画状态机与动作混合 AnimationSystem (约1800行)
// 状态机 / 动作混合 / 动作过渡 / 动作叠加 / 程序化动作库
// ============================================================

const OrbAnimation = (function(){
  const { Vec3, Quat, Mat4, clamp, lerp, damp, dampAngle, smoothstep, smootherstep, EPSILON, PI2 } = OrbMath;
  const { Skeleton, Bone } = OrbSkeleton;

  // ============================================================
  // AnimationClip - 动画剪辑（关键帧数据）
  // ============================================================
  class AnimationClip {
    constructor(name = '', duration = 0){
      this.name = name;
      this.duration = duration;
      this.tracks = [];       // 轨道列表
      this.loop = true;
      this.speed = 1;
      this.events = [];        // 动画事件 {time, name, data}
    }

    addTrack(track){
      this.tracks.push(track);
      return track;
    }

    findTrack(boneName){
      return this.tracks.find(t => t.boneName === boneName);
    }

    addEvent(time, name, data = {}){
      this.events.push({time, name, data});
      this.events.sort((a, b) => a.time - b.time);
    }

    getEventsBetween(startTime, endTime){
      return this.events.filter(e => e.time >= startTime && e.time < endTime);
    }

    clone(){
      const c = new AnimationClip(this.name, this.duration);
      c.loop = this.loop;
      c.speed = this.speed;
      c.tracks = this.tracks.map(t => t.clone());
      c.events = this.events.map(e => ({...e}));
      return c;
    }
  }

  // 动画轨道（单个骨骼的关键帧）
  class AnimationTrack {
    constructor(boneName = ''){
      this.boneName = boneName;
      this.positionKeys = [];  // [{time, value: Vec3}]
      this.rotationKeys = [];  // [{time, value: Quat}]
      this.scaleKeys = [];     // [{time, value: Vec3}]
    }

    addPositionKey(time, position){
      this.positionKeys.push({time, value: position.clone()});
      this.positionKeys.sort((a, b) => a.time - b.time);
    }

    addRotationKey(time, rotation){
      this.rotationKeys.push({time, value: rotation.clone()});
      this.rotationKeys.sort((a, b) => a.time - b.time);
    }

    addScaleKey(time, scale){
      this.scaleKeys.push({time, value: scale.clone()});
      this.scaleKeys.sort((a, b) => a.time - b.time);
    }

    sample(time, loop, duration){
      const result = {
        position: null,
        rotation: null,
        scale: null
      };

      if(this.positionKeys.length > 0){
        result.position = this._sampleVec3(this.positionKeys, time, loop, duration);
      }
      if(this.rotationKeys.length > 0){
        result.rotation = this._sampleQuat(this.rotationKeys, time, loop, duration);
      }
      if(this.scaleKeys.length > 0){
        result.scale = this._sampleVec3(this.scaleKeys, time, loop, duration);
      }

      return result;
    }

    _sampleVec3(keys, time, loop, duration){
      if(keys.length === 1) return keys[0].value.clone();

      let t = time;
      if(loop && duration > 0){
        t = t % duration;
        if(t < 0) t += duration;
      }

      // 找到前后关键帧
      let prev = keys[0], next = keys[keys.length - 1];
      for(let i = 0; i < keys.length - 1; i++){
        if(t >= keys[i].time && t <= keys[i + 1].time){
          prev = keys[i];
          next = keys[i + 1];
          break;
        }
      }

      if(prev === next) return prev.value.clone();

      const span = next.time - prev.time;
      const alpha = span > EPSILON ? (t - prev.time) / span : 0;
      return Vec3.lerp(prev.value, next.value, alpha);
    }

    _sampleQuat(keys, time, loop, duration){
      if(keys.length === 1) return keys[0].value.clone();

      let t = time;
      if(loop && duration > 0){
        t = t % duration;
        if(t < 0) t += duration;
      }

      let prev = keys[0], next = keys[keys.length - 1];
      for(let i = 0; i < keys.length - 1; i++){
        if(t >= keys[i].time && t <= keys[i + 1].time){
          prev = keys[i];
          next = keys[i + 1];
          break;
        }
      }

      if(prev === next) return prev.value.clone();

      const span = next.time - prev.time;
      const alpha = span > EPSILON ? (t - prev.time) / span : 0;
      return Quat.slerp(prev.value, next.value, alpha);
    }

    clone(){
      const t = new AnimationTrack(this.boneName);
      t.positionKeys = this.positionKeys.map(k => ({time: k.time, value: k.value.clone()}));
      t.rotationKeys = this.rotationKeys.map(k => ({time: k.time, value: k.value.clone()}));
      t.scaleKeys = this.scaleKeys.map(k => ({time: k.time, value: k.value.clone()}));
      return t;
    }
  }

  // ============================================================
  // AnimationLayer - 动画层
  // ============================================================
  class AnimationLayer {
    constructor(name = '', weight = 1){
      this.name = name;
      this.weight = weight;
      this.enabled = true;
      this.blendingMode = 'override'; // override / additive / mask
      this.mask = null;  // 骨骼掩码 Set
      this.currentState = null;
      this.states = {};
      this.transitions = [];
      this.playing = false;
    }

    addState(name, clip, options = {}){
      this.states[name] = {
        name,
        clip,
        time: 0,
        speed: options.speed || 1,
        loop: options.loop !== undefined ? options.loop : true,
        weight: 1,
        ...options
      };
      return this.states[name];
    }

    addTransition(from, to, options = {}){
      this.transitions.push({
        from, to,
        duration: options.duration || 0.3,
        exitTime: options.exitTime || 0,
        hasExitTime: options.hasExitTime || false,
        condition: options.condition || null,
        offset: options.offset || 0
      });
    }

    play(stateName, offset = 0){
      const state = this.states[stateName];
      if(!state) return;
      if(this.currentState && this.currentState.name === stateName){
        this.currentState.time = offset;
        return;
      }
      // 过渡
      if(this.currentState){
        this._startTransition(this.currentState.name, stateName, offset);
      } else {
        this.currentState = state;
        state.time = offset;
        state.weight = 1;
      }
      this.playing = true;
    }

    _startTransition(fromName, toName, offset = 0){
      const fromState = this.states[fromName];
      const toState = this.states[toName];
      if(!fromState || !toState) return;

      const transition = this.transitions.find(t => t.from === fromName && t.to === toName);
      const duration = transition ? transition.duration : 0.3;

      this._transition = {
        fromState,
        toState,
        time: 0,
        duration,
        offset
      };

      toState.time = offset;
      toState.weight = 0;
    }

    update(dt, skeleton){
      if(!this.enabled || !this.playing) return;

      // 处理过渡
      if(this._transition){
        this._transition.time += dt;
        const alpha = clamp(this._transition.time / this._transition.duration, 0, 1);
        const eased = smootherstep(0, 1, alpha);

        this._transition.fromState.weight = 1 - eased;
        this._transition.toState.weight = eased;

        // 更新两个状态
        this._updateState(this._transition.fromState, dt, skeleton);
        this._updateState(this._transition.toState, dt, skeleton);

        if(alpha >= 1){
          this.currentState = this._transition.toState;
          this.currentState.weight = 1;
          this._transition = null;
        }
      } else if(this.currentState){
        this._updateState(this.currentState, dt, skeleton);
      }
    }

    _updateState(state, dt, skeleton){
      if(!state || !state.clip) return;

      state.time += dt * state.speed * state.clip.speed;

      if(state.clip.loop && state.clip.duration > 0){
        state.time = state.time % state.clip.duration;
        if(state.time < 0) state.time += state.clip.duration;
      }

      // 应用到骨骼
      const w = state.weight * this.weight;
      if(w <= 0) return;

      for(const track of state.clip.tracks){
        const bone = skeleton.getBone(track.boneName);
        if(!bone) continue;

        // 检查掩码
        if(this.mask && !this.mask.has(track.boneName)) continue;

        const sample = track.sample(state.time, state.clip.loop, state.clip.duration);

        if(this.blendingMode === 'additive'){
          if(sample.position) bone.position.add(sample.position.clone().mul(w));
          if(sample.rotation) bone.rotation.multiply(Quat.slerp(Quat.identity(), sample.rotation, w));
          if(sample.scale){
            bone.scale.x *= 1 + (sample.scale.x - 1) * w;
            bone.scale.y *= 1 + (sample.scale.y - 1) * w;
            bone.scale.z *= 1 + (sample.scale.z - 1) * w;
          }
        } else {
          if(sample.position) bone.position.lerp(sample.position, w);
          if(sample.rotation) bone.rotation.slerp(sample.rotation, w);
          if(sample.scale) bone.scale.lerp(sample.scale, w);
        }
      }
    }

    stop(){
      this.playing = false;
      this.currentState = null;
      this._transition = null;
    }

    getCurrentTime(){
      return this.currentState ? this.currentState.time : 0;
    }

    getCurrentStateName(){
      return this.currentState ? this.currentState.name : null;
    }
  }

  // ============================================================
  // AnimationController - 动画控制器（状态机）
  // ============================================================
  class AnimationController {
    constructor(skeleton){
      this.skeleton = skeleton;
      this.layers = [];
      this.parameters = {};  // 状态机参数
      this.clips = {};       // 动画剪辑库
      this.events = [];      // 全局事件
      this.eventListeners = {};
      this.time = 0;
      this.playing = true;
      this.speed = 1;
    }

    addLayer(name, weight = 1){
      const layer = new AnimationLayer(name, weight);
      this.layers.push(layer);
      return layer;
    }

    getLayer(name){
      return this.layers.find(l => l.name === name);
    }

    addClip(name, clip){
      this.clips[name] = clip;
      return clip;
    }

    getClip(name){
      return this.clips[name];
    }

    setParameter(name, value){
      this.parameters[name] = value;
      this._checkTransitions();
    }

    getParameter(name){
      return this.parameters[name];
    }

    trigger(name){
      this.setParameter(name, true);
    }

    _checkTransitions(){
      for(const layer of this.layers){
        if(!layer.currentState) continue;
        for(const transition of layer.transitions){
          if(transition.from !== layer.currentState.name) continue;
          if(transition.condition && transition.condition(this.parameters)){
            layer.play(transition.to, transition.offset || 0);
            break;
          }
        }
      }
    }

    play(layerName, stateName, offset = 0){
      const layer = this.getLayer(layerName);
      if(layer) layer.play(stateName, offset);
    }

    stop(layerName = null){
      if(layerName){
        const layer = this.getLayer(layerName);
        if(layer) layer.stop();
      } else {
        for(const layer of this.layers) layer.stop();
      }
    }

    update(dt){
      if(!this.playing) return;

      const scaledDt = dt * this.speed;
      this.time += scaledDt;

      // 先重置到初始姿态（基础层）
      if(this.layers.length > 0 && this.layers[0].enabled){
        this.skeleton.resetToRestPose();
      }

      // 更新各层
      for(const layer of this.layers){
        layer.update(scaledDt, this.skeleton);
      }

      // 重置trigger参数
      for(const key in this.parameters){
        if(this.parameters[key] === true && key.startsWith('trigger_')){
          this.parameters[key] = false;
        }
      }
    }

    on(eventName, callback){
      if(!this.eventListeners[eventName]){
        this.eventListeners[eventName] = [];
      }
      this.eventListeners[eventName].push(callback);
    }

    off(eventName, callback){
      if(!this.eventListeners[eventName]) return;
      const idx = this.eventListeners[eventName].indexOf(callback);
      if(idx >= 0) this.eventListeners[eventName].splice(idx, 1);
    }

    emit(eventName, data){
      if(!this.eventListeners[eventName]) return;
      for(const cb of this.eventListeners[eventName]){
        cb(data);
      }
    }
  }

  // ============================================================
  // ProceduralMotion - 程序化动作生成器
  // 不依赖任何动画数据，完全用数学公式生成动作
  // ============================================================
  class ProceduralMotion {
    constructor(skeleton){
      this.skeleton = skeleton;
      this.time = 0;
      this.enabled = true;
      this.motions = {};
      this.activeMotions = [];
    }

    // 注册动作
    register(name, motion){
      this.motions[name] = motion;
      return motion;
    }

    // 播放动作
    play(name, options = {}){
      const motion = this.motions[name];
      if(!motion) return null;

      const instance = {
        name,
        motion,
        time: 0,
        duration: options.duration || motion.duration || 1,
        weight: 0,
        targetWeight: options.weight || 1,
        fadeIn: options.fadeIn || 0.2,
        fadeOut: options.fadeOut || 0.2,
        loop: options.loop || false,
        speed: options.speed || 1,
        layer: options.layer || 0,
        mask: options.mask || null,
        done: false,
        ...options
      };

      this.activeMotions.push(instance);
      return instance;
    }

    // 停止动作
    stop(name, fadeOut = 0.2){
      for(const m of this.activeMotions){
        if(m.name === name){
          m.targetWeight = 0;
          m.fadeOut = fadeOut;
          m.stopping = true;
        }
      }
    }

    // 停止所有动作
    stopAll(fadeOut = 0.2){
      for(const m of this.activeMotions){
        m.targetWeight = 0;
        m.fadeOut = fadeOut;
        m.stopping = true;
      }
    }

    // 更新
    update(dt){
      if(!this.enabled) return;

      this.time += dt;

      // 按层级排序
      this.activeMotions.sort((a, b) => a.layer - b.layer);

      for(let i = this.activeMotions.length - 1; i >= 0; i--){
        const m = this.activeMotions[i];

        // 更新权重
        if(m.stopping){
          m.weight = Math.max(0, m.weight - dt / m.fadeOut);
        } else {
          m.weight = Math.min(m.targetWeight, m.weight + dt / m.fadeIn);
        }

        // 更新时间
        m.time += dt * m.speed;

        // 检查是否完成
        if(!m.loop && m.time >= m.duration){
          if(m.stopping || m.fadeOut <= 0){
            m.done = true;
          } else {
            m.stopping = true;
          }
        }

        // 应用动作
        if(m.weight > EPSILON && m.motion.update){
          const normalizedTime = m.duration > 0 ? m.time / m.duration : 0;
          m.motion.update(this.skeleton, normalizedTime, m.time, m.weight, m);
        }

        // 移除完成的动作
        if(m.done && m.weight <= EPSILON){
          this.activeMotions.splice(i, 1);
        }
      }
    }

    // 检查动作是否在播放
    isPlaying(name){
      return this.activeMotions.some(m => m.name === name && !m.stopping);
    }
  }

  // ============================================================
  // 内置程序化动作库
  // ============================================================

  // 呼吸动作
  const BreathingMotion = {
    duration: 4,
    update(skeleton, normalizedTime, time, weight){
      const breath = Math.sin(time * Math.PI * 0.5) * 0.5 + 0.5;
      const chestBone = skeleton.getBone('上半身') || skeleton.getBone('UpperBody') || skeleton.getBone('胸');
      if(chestBone){
        chestBone.position.y += breath * 0.02 * weight;
        chestBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), breath * 0.02 * weight));
      }
      // 肩膀微动
      const shoulderL = skeleton.getBone('左肩') || skeleton.getBone('LeftShoulder');
      const shoulderR = skeleton.getBone('右肩') || skeleton.getBone('RightShoulder');
      if(shoulderL) shoulderL.position.y += breath * 0.01 * weight;
      if(shoulderR) shoulderR.position.y += breath * 0.01 * weight;
    }
  };

  // 眨眼动作
  const BlinkMotion = {
    duration: 0.15,
    update(skeleton, normalizedTime, time, weight){
      const blink = Math.sin(normalizedTime * Math.PI);
      const eyeL = skeleton.getBone('左目') || skeleton.getBone('LeftEye');
      const eyeR = skeleton.getBone('右目') || skeleton.getBone('RightEye');
      if(eyeL) eyeL.scale.y *= (1 - blink * 0.9 * weight);
      if(eyeR) eyeR.scale.y *= (1 - blink * 0.9 * weight);
    }
  };

  // 视线追踪
  const LookAtMotion = {
    duration: Infinity,
    target: new Vec3(),
    update(skeleton, normalizedTime, time, weight, instance){
      const target = instance.target || this.target;
      const headBone = skeleton.getBone('頭') || skeleton.getBone('Head') || skeleton.getBone('首');
      if(!headBone) return;

      const toTarget = Vec3.sub(target, headBone.worldPosition).normalize();
      const currentForward = headBone.getForward();
      const rot = new Quat().setFromUnitVectors(currentForward, toTarget);
      const targetRot = headBone.rotation.clone().premultiply(rot);

      // 限制头部旋转
      const euler = targetRot.toEuler();
      euler.x = clamp(euler.x, -0.3, 0.3);
      euler.y = clamp(euler.y, -0.5, 0.5);
      euler.z = clamp(euler.z, -0.1, 0.1);
      targetRot.setFromEuler(euler.x, euler.y, euler.z);

      headBone.rotation.slerp(targetRot, weight * 0.1);
      headBone.rotation.normalize();
    }
  };

  // 闲置微动作
  const IdleMotion = {
    duration: 8,
    update(skeleton, normalizedTime, time, weight){
      // 重心转移
      const shift = Math.sin(time * 0.5) * 0.5;
      const hipBone = skeleton.getBone('下半身') || skeleton.getBone('LowerBody') || skeleton.getBone('腰');
      if(hipBone){
        hipBone.position.x += shift * 0.02 * weight;
        hipBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 1, 0), shift * 0.05 * weight));
      }

      // 身体摇摆
      const sway = Math.sin(time * 0.3) * 0.5;
      const upperBone = skeleton.getBone('上半身') || skeleton.getBone('UpperBody');
      if(upperBone){
        upperBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, 1), sway * 0.03 * weight));
      }

      // 手臂自然摆动
      const armSwing = Math.sin(time * 0.8) * 0.3;
      const armL = skeleton.getBone('左腕') || skeleton.getBone('LeftArm');
      const armR = skeleton.getBone('右腕') || skeleton.getBone('RightArm');
      if(armL) armL.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), armSwing * 0.1 * weight));
      if(armR) armR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -armSwing * 0.1 * weight));
    }
  };

  // 挥手动作
  const WaveMotion = {
    duration: 1.5,
    side: 'right',
    update(skeleton, normalizedTime, time, weight, instance){
      const side = instance.side || this.side;
      const shoulderName = side === 'right' ? '右肩' : '左肩';
      const armName = side === 'right' ? '右腕' : '左腕';
      const elbowName = side === 'right' ? '右ひじ' : '左ひじ';
      const wristName = side === 'right' ? '右手首' : '左手首';

      const shoulder = skeleton.getBone(shoulderName);
      const arm = skeleton.getBone(armName);
      const elbow = skeleton.getBone(elbowName);
      const wrist = skeleton.getBone(wristName);

      // 抬手阶段 (0-0.3)
      const raisePhase = smoothstep(0, 0.3, normalizedTime);
      // 挥手阶段 (0.3-0.8)
      const wavePhase = smoothstep(0.3, 0.8, normalizedTime);
      // 放下阶段 (0.8-1.0)
      const lowerPhase = 1 - smoothstep(0.8, 1.0, normalizedTime);

      const armUp = raisePhase * lowerPhase;
      const waveAmount = wavePhase * lowerPhase;

      if(arm){
        // 抬起手臂
        arm.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, side === 'right' ? -1 : 1), Math.PI * 0.4 * armUp * weight));
        arm.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -0.3 * armUp * weight));
      }

      if(elbow){
        // 弯曲肘部
        elbow.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, 1), -Math.PI * 0.6 * armUp * weight));
      }

      if(wrist && waveAmount > 0){
        // 手腕摆动
        const wave = Math.sin(time * 8) * waveAmount;
        wrist.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 1, 0), wave * 0.4 * weight));
        wrist.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), wave * 0.2 * weight));
      }
    }
  };

  // 点头动作
  const NodMotion = {
    duration: 0.6,
    update(skeleton, normalizedTime, time, weight){
      const nod = Math.sin(normalizedTime * Math.PI * 2) * (1 - normalizedTime);
      const headBone = skeleton.getBone('頭') || skeleton.getBone('Head');
      if(headBone){
        headBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), nod * 0.3 * weight));
      }
    }
  };

  // 摇头动作
  const ShakeHeadMotion = {
    duration: 0.8,
    update(skeleton, normalizedTime, time, weight){
      const shake = Math.sin(normalizedTime * Math.PI * 3) * (1 - normalizedTime);
      const headBone = skeleton.getBone('頭') || skeleton.getBone('Head');
      if(headBone){
        headBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 1, 0), shake * 0.4 * weight));
      }
    }
  };

  // 走路动作（循环）
  const WalkMotion = {
    duration: 1.2,
    speed: 1,
    update(skeleton, normalizedTime, time, weight, instance){
      const cycle = (time * (instance.speed || this.speed)) % 1;
      const walkAngle = cycle * Math.PI * 2;

      // 腿部摆动
      const hipL = skeleton.getBone('左足') || skeleton.getBone('LeftLeg');
      const hipR = skeleton.getBone('右足') || skeleton.getBone('RightLeg');
      const kneeL = skeleton.getBone('左ひざ') || skeleton.getBone('LeftKnee');
      const kneeR = skeleton.getBone('右ひざ') || skeleton.getBone('RightKnee');
      const ankleL = skeleton.getBone('左足首') || skeleton.getBone('LeftAnkle');
      const ankleR = skeleton.getBone('右足首') || skeleton.getBone('RightAnkle');

      const legSwing = Math.sin(walkAngle) * 0.5;
      const kneeBend = Math.max(0, Math.sin(walkAngle + Math.PI)) * 0.5;

      if(hipL) hipL.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), legSwing * weight));
      if(hipR) hipR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -legSwing * weight));
      if(kneeL) kneeL.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -kneeBend * weight));
      if(kneeR) kneeR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -Math.max(0, Math.sin(walkAngle)) * 0.5 * weight));
      if(ankleL) ankleL.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -legSwing * 0.3 * weight));
      if(ankleR) ankleR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), legSwing * 0.3 * weight));

      // 手臂反向摆动
      const armL = skeleton.getBone('左腕') || skeleton.getBone('LeftArm');
      const armR = skeleton.getBone('右腕') || skeleton.getBone('RightArm');
      if(armL) armL.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -legSwing * 0.4 * weight));
      if(armR) armR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), legSwing * 0.4 * weight));

      // 身体上下起伏
      const hipBone = skeleton.getBone('下半身') || skeleton.getBone('LowerBody');
      if(hipBone){
        const bob = Math.abs(Math.sin(walkAngle)) * 0.02;
        hipBone.position.y -= bob * weight;
        // 身体扭转
        hipBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 1, 0), legSwing * 0.1 * weight));
      }
    }
  };

  // 跳跃动作
  const JumpMotion = {
    duration: 0.8,
    update(skeleton, normalizedTime, time, weight){
      // 跳跃曲线
      const jumpHeight = Math.sin(normalizedTime * Math.PI);
      const crouch = normalizedTime < 0.2 ? normalizedTime / 0.2 : (normalizedTime > 0.8 ? (1 - normalizedTime) / 0.2 : 0);

      const hipBone = skeleton.getBone('下半身') || skeleton.getBone('LowerBody');
      if(hipBone){
        hipBone.position.y += jumpHeight * 0.3 * weight;
        hipBone.position.y -= crouch * 0.1 * weight;
      }

      // 起跳和落地时弯曲膝盖
      const kneeL = skeleton.getBone('左ひざ') || skeleton.getBone('LeftKnee');
      const kneeR = skeleton.getBone('右ひざ') || skeleton.getBone('RightKnee');
      if(kneeL) kneeL.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -crouch * 0.8 * weight));
      if(kneeR) kneeR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -crouch * 0.8 * weight));

      // 空中时手臂张开
      const armL = skeleton.getBone('左腕') || skeleton.getBone('LeftArm');
      const armR = skeleton.getBone('右腕') || skeleton.getBone('RightArm');
      if(armL) armL.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, 1), jumpHeight * 0.5 * weight));
      if(armR) armR.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, -1), jumpHeight * 0.5 * weight));
    }
  };

  // 害羞动作
  const ShyMotion = {
    duration: 2,
    update(skeleton, normalizedTime, time, weight){
      const fade = Math.sin(normalizedTime * Math.PI);

      // 低头
      const headBone = skeleton.getBone('頭') || skeleton.getBone('Head');
      if(headBone){
        headBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), 0.2 * fade * weight));
        headBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, 1), 0.1 * fade * weight));
      }

      // 手摸脸
      const armR = skeleton.getBone('右腕') || skeleton.getBone('RightArm');
      const elbowR = skeleton.getBone('右ひじ') || skeleton.getBone('RightElbow');
      if(armR){
        armR.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, -1), Math.PI * 0.5 * fade * weight));
        armR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -0.5 * fade * weight));
      }
      if(elbowR){
        elbowR.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, 1), -Math.PI * 0.7 * fade * weight));
      }

      // 身体微扭
      const upperBone = skeleton.getBone('上半身') || skeleton.getBone('UpperBody');
      if(upperBone){
        upperBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 1, 0), 0.1 * fade * weight));
      }
    }
  };

  // 生气动作
  const AngryMotion = {
    duration: 1.5,
    update(skeleton, normalizedTime, time, weight){
      const intensity = Math.sin(normalizedTime * Math.PI * 3) * 0.5 + 0.5;

      // 握拳
      const fistL = skeleton.getBone('左手首') || skeleton.getBone('LeftWrist');
      const fistR = skeleton.getBone('右手首') || skeleton.getBone('RightWrist');
      if(fistL) fistL.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), intensity * 0.3 * weight));
      if(fistR) fistR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), intensity * 0.3 * weight));

      // 身体前倾
      const upperBone = skeleton.getBone('上半身') || skeleton.getBone('UpperBody');
      if(upperBone){
        upperBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), intensity * 0.2 * weight));
      }

      // 皱眉（通过眉毛骨骼，如果有的话）
      const browL = skeleton.getBone('左眉') || skeleton.getBone('LeftBrow');
      const browR = skeleton.getBone('右眉') || skeleton.getBone('RightBrow');
      if(browL) browL.position.y -= intensity * 0.01 * weight;
      if(browR) browR.position.y -= intensity * 0.01 * weight;
    }
  };

  // 开心动作
  const HappyMotion = {
    duration: 1.5,
    update(skeleton, normalizedTime, time, weight){
      const bounce = Math.abs(Math.sin(normalizedTime * Math.PI * 4)) * (1 - normalizedTime * 0.5);

      // 身体上下跳动
      const hipBone = skeleton.getBone('下半身') || skeleton.getBone('LowerBody');
      if(hipBone){
        hipBone.position.y += bounce * 0.05 * weight;
      }

      // 手臂摆动
      const armL = skeleton.getBone('左腕') || skeleton.getBone('LeftArm');
      const armR = skeleton.getBone('右腕') || skeleton.getBone('RightArm');
      if(armL) armL.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, 1), bounce * 0.3 * weight));
      if(armR) armR.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, -1), bounce * 0.3 * weight));

      // 头部微动
      const headBone = skeleton.getBone('頭') || skeleton.getBone('Head');
      if(headBone){
        headBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 1, 0), bounce * 0.1 * weight));
      }
    }
  };

  // 悲伤动作
  const SadMotion = {
    duration: 2,
    update(skeleton, normalizedTime, time, weight){
      const fade = Math.sin(normalizedTime * Math.PI);

      // 低头
      const headBone = skeleton.getBone('頭') || skeleton.getBone('Head');
      if(headBone){
        headBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), 0.3 * fade * weight));
      }

      // 肩膀下垂
      const shoulderL = skeleton.getBone('左肩') || skeleton.getBone('LeftShoulder');
      const shoulderR = skeleton.getBone('右肩') || skeleton.getBone('RightShoulder');
      if(shoulderL) shoulderL.position.y -= 0.02 * fade * weight;
      if(shoulderR) shoulderR.position.y -= 0.02 * fade * weight;

      // 身体蜷缩
      const upperBone = skeleton.getBone('上半身') || skeleton.getBone('UpperBody');
      if(upperBone){
        upperBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), 0.1 * fade * weight));
      }

      // 手臂自然下垂
      const armL = skeleton.getBone('左腕') || skeleton.getBone('LeftArm');
      const armR = skeleton.getBone('右腕') || skeleton.getBone('RightArm');
      if(armL) armL.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), 0.2 * fade * weight));
      if(armR) armR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), 0.2 * fade * weight));
    }
  };

  // 惊讶动作
  const SurprisedMotion = {
    duration: 0.8,
    update(skeleton, normalizedTime, time, weight){
      const fade = Math.sin(normalizedTime * Math.PI);

      // 头部后仰
      const headBone = skeleton.getBone('頭') || skeleton.getBone('Head');
      if(headBone){
        headBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -0.2 * fade * weight));
      }

      // 身体后仰
      const upperBone = skeleton.getBone('上半身') || skeleton.getBone('UpperBody');
      if(upperBone){
        upperBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -0.1 * fade * weight));
      }

      // 手臂抬起
      const armL = skeleton.getBone('左腕') || skeleton.getBone('LeftArm');
      const armR = skeleton.getBone('右腕') || skeleton.getBone('RightArm');
      if(armL) armL.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, 1), 0.5 * fade * weight));
      if(armR) armR.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, -1), 0.5 * fade * weight));
    }
  };

  // 思考动作
  const ThinkingMotion = {
    duration: 3,
    update(skeleton, normalizedTime, time, weight){
      const sway = Math.sin(time * 0.8) * 0.5;

      // 手托下巴
      const armR = skeleton.getBone('右腕') || skeleton.getBone('RightArm');
      const elbowR = skeleton.getBone('右ひじ') || skeleton.getBone('RightElbow');
      const wristR = skeleton.getBone('右手首') || skeleton.getBone('RightWrist');
      if(armR){
        armR.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, -1), Math.PI * 0.6 * weight));
        armR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -0.8 * weight));
      }
      if(elbowR){
        elbowR.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, 1), -Math.PI * 0.8 * weight));
      }
      if(wristR){
        wristR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), 0.3 * weight));
      }

      // 头部倾斜
      const headBone = skeleton.getBone('頭') || skeleton.getBone('Head');
      if(headBone){
        headBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, 1), sway * 0.1 * weight));
        headBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), 0.1 * weight));
      }
    }
  };

  // 指向动作
  const PointMotion = {
    duration: 1,
    side: 'right',
    update(skeleton, normalizedTime, time, weight, instance){
      const side = instance.side || this.side;
      const raisePhase = smoothstep(0, 0.3, normalizedTime);
      const holdPhase = 1 - smoothstep(0.7, 1.0, normalizedTime);
      const amount = raisePhase * holdPhase;

      const shoulderName = side === 'right' ? '右肩' : '左肩';
      const armName = side === 'right' ? '右腕' : '左腕';
      const elbowName = side === 'right' ? '右ひじ' : '左ひじ';

      const arm = skeleton.getBone(armName);
      const elbow = skeleton.getBone(elbowName);

      if(arm){
        // 伸直手臂指向
        arm.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, side === 'right' ? -1 : 1), Math.PI * 0.5 * amount * weight));
        arm.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -0.3 * amount * weight));
      }

      if(elbow){
        // 伸直肘部
        elbow.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, 1), 0.1 * amount * weight));
      }
    }
  };

  // 动作库
  const MotionLibrary = {
    breathing: BreathingMotion,
    blink: BlinkMotion,
    lookAt: LookAtMotion,
    idle: IdleMotion,
    wave: WaveMotion,
    nod: NodMotion,
    shakeHead: ShakeHeadMotion,
    walk: WalkMotion,
    jump: JumpMotion,
    shy: ShyMotion,
    angry: AngryMotion,
    happy: HappyMotion,
    sad: SadMotion,
    surprised: SurprisedMotion,
    thinking: ThinkingMotion,
    point: PointMotion
  };

  // 导出
  return {
    AnimationClip, AnimationTrack, AnimationLayer, AnimationController,
    ProceduralMotion, MotionLibrary,
    BreathingMotion, BlinkMotion, LookAtMotion, IdleMotion,
    WaveMotion, NodMotion, ShakeHeadMotion, WalkMotion,
    JumpMotion, ShyMotion, AngryMotion, HappyMotion,
    SadMotion, SurprisedMotion, ThinkingMotion, PointMotion
  };
})();

if(typeof window !== 'undefined'){
  window.OrbAnimation = OrbAnimation;
}