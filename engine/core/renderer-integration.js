/**
 * OrbRenderer Integration - 渲染引擎集成适配层
 * 把orb_engine_core.js的骨骼/动画系统接入现有orb_renderer.js渲染管线
 * 无第三方依赖，纯自研
 * @version 1.0.0
 */

'use strict';

;
// 防御性检查：确保依赖模块已加载
const _deps = {
  Math: typeof OrbMath !== 'undefined' ? OrbMath : null,
  Skeleton: typeof OrbSkeleton !== 'undefined' ? OrbSkeleton : null,
  Animation: typeof OrbAnimation !== 'undefined' ? OrbAnimation : null
};
;
if(!_deps.Math || !_deps.Skeleton || !_deps.Animation){
  console.error('[OrbIntegration] 依赖模块缺失，集成层将以降级模式运行');
}

const OrbIntegration = (function(){
  const { Vec3, Quat, Mat4, clamp, lerp, EPSILON } = _deps.Math || {};
  const { Skeleton, Bone, IKSolver, SpringManager } = _deps.Skeleton || {};
  const { ProceduralMotion, MotionLibrary } = _deps.Animation || {};

  // ============================================================
  // PMX模型 → OrbSkeleton 转换
  // ============================================================
  function pmxToOrbSkeleton(pmxModel){
    const skeleton = new Skeleton();
    const bones = pmxModel.bones || [];
    ;
    // 第一遍：创建所有骨骼（parent先设为-1，避免指向未添加的骨骼）
    for(let i = 0; i < bones.length; i++){
      const b = bones[i];
      const bone = skeleton.addBone(b.name || ('bone_' + i), -1);
      bone.index = i;
      bone.nameEn = b.nameEn || '';
      bone.flags = b.flags || 0;
      bone.ikData = b.ikData || null;
      bone.inheritParent = b.inheritParent;
      bone.inheritRotationRatio = b.inheritRotationRatio;
      bone.inheritTranslationRatio = b.inheritTranslationRatio;
      bone.fixedAxis = b.fixedAxis;
      bone.localInherit = b.localInherit;
      bone.postPos = b.postPos;
      bone.transformLevel = b.transformLevel || 0;

      // PMX的position是绝对位置，需要在第二遍计算相对位置
      bone.position.set(b.position ? b.position[0] : 0, b.position ? b.position[1] : 0, b.position ? b.position[2] : 0);
      bone.restPosition.copy(bone.position);
      bone.rotation.identity();
      bone.restRotation.identity();
      bone.scale.set(1, 1, 1);
      bone.restScale.set(1, 1, 1);
    }

    // 第二遍：设置正确的parent和children关系
    skeleton.rootBones = [];
    for(let i = 0; i < bones.length; i++){
      const b = bones[i];
      const bone = skeleton.bones[i];
      const parentIdx = (b.parent !== undefined && b.parent !== null) ? b.parent : -1;

      if(parentIdx >= 0 && parentIdx < skeleton.bones.length){
        bone.parent = parentIdx;
        skeleton.bones[parentIdx].addChild(i);
      } else {
        bone.parent = -1;
        skeleton.rootBones.push(i);
      }
    }
    ;
    // 第三遍：计算相对位置（PMX的position是绝对位置）
    // 先保存所有骨骼的绝对位置，避免父骨骼被修改后影响子骨骼计算
    const absolutePositions = new Array(skeleton.bones.length);
    for(let i = 0; i < skeleton.bones.length; i++){
      absolutePositions[i] = skeleton.bones[i].position.clone();
    }
    for(let i = 0; i < skeleton.bones.length; i++){
      const bone = skeleton.bones[i];
      if(bone.parent >= 0 && bone.parent < skeleton.bones.length){
        const parentAbsPos = absolutePositions[bone.parent];
        const relPos = Vec3.sub(absolutePositions[i], parentAbsPos);
        bone.position.copy(relPos);
        bone.restPosition.copy(relPos);
      }
      // 计算骨骼长度（到第一个子骨骼的距离，基于相对位置）
      if(bone.children.length > 0 && bone.children[0] < skeleton.bones.length){
        const firstChild = skeleton.bones[bone.children[0]];
        if(firstChild){
          bone.length = bone.position.distanceTo(firstChild.position);
        }
      }
    }
    ;
    // 构建计算顺序
    ;
    skeleton.buildComputeOrder();
    ;
    // 计算逆绑定矩阵
    skeleton.computeWorldMatrices();
    for(const bone of skeleton.bones){
      bone.inverseBindMatrix.copy(bone.worldMatrix).inverse();
    }

    return skeleton;
  }

  // ============================================================
  // OrbSkeleton → 骨骼调色板（Float32Array，用于GPU蒙皮）
  // ============================================================
  function skeletonToPalette(skeleton, maxBones = 256, boneRemap = null){
    const count = Math.min(skeleton.bones.length, maxBones);
    const palette = new Float32Array(count * 16);

    skeleton.computeWorldMatrices();

    for(let i = 0; i < count; i++){
      const bone = skeleton.bones[i];
      // 蒙皮矩阵 = 世界矩阵 * 逆绑定矩阵
      const skinMatrix = bone.worldMatrix.clone().multiply(bone.inverseBindMatrix);
      palette.set(skinMatrix.elements, i * 16);
    }

    return palette;
  }

  // ============================================================
  // 程序化动作桥接器
  // 连接OrbAnimation.ProceduralMotion和现有渲染管线
  // ============================================================
  class ProceduralMotionBridge {
    constructor(skeleton, pmxModel){
      this.skeleton = skeleton;
      this.pmxModel = pmxModel;
      this.motion = new ProceduralMotion(skeleton);
      this.enabled = true;
      this.time = 0;
      this.lastDt = 0;

      // 注册所有内置动作
      for(const name in MotionLibrary){
        this.motion.register(name, MotionLibrary[name]);
      }

      // 骨骼名称映射（PMX日文名 → 通用名）
      this.boneAlias = {
        'センター': 'center',
        '下半身': 'lowerBody',
        '上半身': 'upperBody',
        '首': 'neck',
        '頭': 'head',
        '右肩': 'rightShoulder',
        '右腕': 'rightArm',
        '右ひじ': 'rightElbow',
        '右手首': 'rightWrist',
        '左肩': 'leftShoulder',
        '左腕': 'leftArm',
        '左ひじ': 'leftElbow',
        '左手首': 'leftWrist',
        '右足': 'rightLeg',
        '右ひざ': 'rightKnee',
        '右足首': 'rightAnkle',
        '左足': 'leftLeg',
        '左ひざ': 'leftKnee',
        '左足首': 'leftAnkle',
        '右目': 'rightEye',
        '左目': 'leftEye'
      };
    }

    // 播放动作
    play(name, options = {}){
      if(!this.enabled) return null;
      return this.motion.play(name, options);
    }

    // 停止动作
    stop(name, fadeOut = 0.2){
      this.motion.stop(name, fadeOut);
    }

    // 停止所有动作
    stopAll(fadeOut = 0.2){
      this.motion.stopAll(fadeOut);
    }

    // 每帧更新
    update(dt){
      if(!this.enabled) return;
      this.time += dt;
      this.lastDt = dt;

      // 先重置到初始姿态
      this.skeleton.resetToRestPose();

      // 更新程序化动作
      this.motion.update(dt);

      // 计算世界矩阵
      this.skeleton.computeWorldMatrices();
    }

    // 获取骨骼调色板
    getPalette(maxBones = 256){
      return skeletonToPalette(this.skeleton, maxBones);
    }

    // 获取骨骼旋转（兼容旧接口）
    getPoseRotations(){
      const rotations = [];
      for(const bone of this.skeleton.bones){
        rotations.push([bone.rotation.x, bone.rotation.y, bone.rotation.z, bone.rotation.w]);
      }
      return rotations;
    }

    // 获取骨骼位置（兼容旧接口）
    getPosePositions(){
      const positions = [];
      for(const bone of this.skeleton.bones){
        // 返回绝对位置（兼容旧接口）
        positions.push([bone.worldPosition.x, bone.worldPosition.y, bone.worldPosition.z]);
      }
      return positions;
    }

    // 挥手（兼容旧接口）
    wave(side = 'right'){
      return this.play('wave', {side, duration: 1.5, fadeIn: 0.1, fadeOut: 0.3});
    }

    // 点头
    nod(){
      return this.play('nod', {duration: 0.6, fadeIn: 0.05, fadeOut: 0.2});
    }

    // 摇头
    shakeHead(){
      return this.play('shakeHead', {duration: 0.8, fadeIn: 0.05, fadeOut: 0.2});
    }

    // 眨眼
    blink(){
      return this.play('blink', {duration: 0.15, fadeIn: 0.01, fadeOut: 0.05});
    }

    // 闲置微动作（循环）
    idle(){
      return this.play('idle', {duration: 8, loop: true, fadeIn: 0.5, fadeOut: 0.5});
    }

    // 呼吸（循环）
    breathing(){
      return this.play('breathing', {duration: 4, loop: true, fadeIn: 0.5, fadeOut: 0.5});
    }

    // 走路（循环）
    walk(){
      return this.play('walk', {duration: 1.2, loop: true, fadeIn: 0.2, fadeOut: 0.3});
    }

    // 跳跃
    jump(){
      return this.play('jump', {duration: 0.8, fadeIn: 0.05, fadeOut: 0.2});
    }

    // 害羞
    shy(){
      return this.play('shy', {duration: 2, fadeIn: 0.2, fadeOut: 0.5});
    }

    // 生气
    angry(){
      return this.play('angry', {duration: 1.5, fadeIn: 0.1, fadeOut: 0.3});
    }

    // 开心
    happy(){
      return this.play('happy', {duration: 1.5, fadeIn: 0.1, fadeOut: 0.3});
    }

    // 悲伤
    sad(){
      return this.play('sad', {duration: 2, fadeIn: 0.2, fadeOut: 0.5});
    }

    // 惊讶
    surprised(){
      return this.play('surprised', {duration: 0.8, fadeIn: 0.05, fadeOut: 0.2});
    }

    // 思考
    thinking(){
      return this.play('thinking', {duration: 3, loop: true, fadeIn: 0.3, fadeOut: 0.5});
    }

    // 指向
    point(side = 'right'){
      return this.play('point', {side, duration: 1, fadeIn: 0.1, fadeOut: 0.3});
    }

    // 视线追踪
    lookAt(target){
      const instance = this.play('lookAt', {duration: Infinity, loop: true, fadeIn: 0.3});
      if(instance && instance.motion){
        instance.motion.target = target;
      }
      return instance;
    }

    // 检查动作是否在播放
    isPlaying(name){
      return this.motion.isPlaying(name);
    }

    // 转储骨骼诊断信息
    dumpBoneDiagnostics(filter = null){
      const result = [];
      for(let i = 0; i < this.skeleton.bones.length; i++){
        const bone = this.skeleton.bones[i];
        if(filter && !bone.name.includes(filter)) continue;
        result.push({
          index: i,
          name: bone.name,
          parent: bone.parent,
          position: [bone.position.x, bone.position.y, bone.position.z],
          worldPosition: [bone.worldPosition.x, bone.worldPosition.y, bone.worldPosition.z],
          rotation: [bone.rotation.x, bone.rotation.y, bone.rotation.z, bone.rotation.w],
          length: bone.length,
          children: bone.children.length
        });
      }
      return result;
    }
  }

  // ============================================================
  // IK桥接器
  // ============================================================
  class IKBridge {
    constructor(skeleton){
      this.skeleton = skeleton;
      this.solver = new IKSolver(skeleton);
      this.enabled = true;
    }

    // 手臂IK
    solveArm(side, target, poleVector = null){
      if(!this.enabled) return false;

      const prefix = side === 'right' ? '右' : '左';
      const shoulder = this.skeleton.getBoneIndex(prefix + '肩');
      const arm = this.skeleton.getBoneIndex(prefix + '腕');
      const elbow = this.skeleton.getBoneIndex(prefix + 'ひじ');
      const wrist = this.skeleton.getBoneIndex(prefix + '手首');

      if(arm < 0 || elbow < 0 || wrist < 0) return false;

      return this.solver.solveTwoBone(arm, elbow, wrist, target, poleVector);
    }

    // 腿部IK
    solveLeg(side, target, poleVector = null){
      if(!this.enabled) return false;

      const prefix = side === 'right' ? '右' : '左';
      const leg = this.skeleton.getBoneIndex(prefix + '足');
      const knee = this.skeleton.getBoneIndex(prefix + 'ひざ');
      const ankle = this.skeleton.getBoneIndex(prefix + '足首');

      if(leg < 0 || knee < 0 || ankle < 0) return false;

      return this.solver.solveTwoBone(leg, knee, ankle, target, poleVector);
    }

    // 通用CCD IK
    solveCCD(chain, target){
      if(!this.enabled) return false;
      this.solver.useCCD = true;
      return this.solver.solve(chain, target);
    }

    // 通用FABRIK IK
    solveFABRIK(chain, target){
      if(!this.enabled) return false;
      this.solver.useCCD = false;
      return this.solver.solve(chain, target);
    }
  }

  // ============================================================
  // 集成管理器
  // ============================================================
  class IntegrationManager {
    constructor(){
      this.skeleton = null;
      this.motionBridge = null;
      this.ikBridge = null;
      this.pmxModel = null;
      this.useOrbSkeleton = false; // 开关：是否使用新骨骼系统
      this.useOrbMotion = false;   // 开关：是否使用新动作系统
    }

    // 初始化（从PMX模型）
    initFromPMX(pmxModel){
      ;
      this.pmxModel = pmxModel;

      try {
        // 构建OrbSkeleton
        if(!Skeleton){
          console.error('[OrbIntegration] Skeleton类未定义，无法初始化骨骼系统');
          return this;
        }
        this.skeleton = pmxToOrbSkeleton(pmxModel);
        ;
        // 创建动作桥接器
        if(ProceduralMotion){
          this.motionBridge = new ProceduralMotionBridge(this.skeleton, pmxModel);
          ;
        } else {
          console.warn('[OrbIntegration] ProceduralMotion未定义，动作系统不可用');
        }

        // 创建IK桥接器
        if(IKSolver){
          this.ikBridge = new IKBridge(this.skeleton);
          ;
        } else {
          console.warn('[OrbIntegration] IKSolver未定义，IK系统不可用');
        }

        ;
      } catch(e){
        console.error('[OrbIntegration] initFromPMX 失败:', e.message, e.stack);
        this.skeleton = null;
        this.motionBridge = null;
        this.ikBridge = null;
      }

      return this;
    }

    // 每帧更新
    update(dt){
      if(this.useOrbMotion && this.motionBridge){
        this.motionBridge.update(dt);
      } else if(this.useOrbSkeleton && this.skeleton){
        this.skeleton.computeWorldMatrices();
      }
    }

    // 获取骨骼调色板
    getPalette(maxBones = 256, boneRemap = null){
      if(this.useOrbSkeleton && this.skeleton){
        return skeletonToPalette(this.skeleton, maxBones, boneRemap);
      }
      return null;
    }

    // 启用新骨骼系统
    enableSkeleton(enabled = true){
      this.useOrbSkeleton = enabled;
      ;
    }

    // 启用新动作系统
    enableMotion(enabled = true){
      this.useOrbMotion = enabled;
      ;
    }

    // 全部启用
    enableAll(){
      this.enableSkeleton(true);
      this.enableMotion(true);
    }

    // 全部禁用（回退到原生系统）
    disableAll(){
      this.enableSkeleton(false);
      this.enableMotion(false);
    }
  }

  // 单例
  let _instance = null;
  function getInstance(){
    if(!_instance) _instance = new IntegrationManager();
    return _instance;
  }

  // 导出
  return {
    pmxToOrbSkeleton,
    skeletonToPalette,
    ProceduralMotionBridge,
    IKBridge,
    IntegrationManager,
    getInstance
  };
})();

if(typeof window !== 'undefined'){
  window.OrbIntegration = OrbIntegration;
  ;
}
