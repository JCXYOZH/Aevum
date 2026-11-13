
// ============================================================
// 模块二：骨骼系统 SkeletonSystem (约1500行)
// FK前向运动学 / IK反向运动学 / 骨骼约束 / 物理骨骼
// ============================================================

const OrbSkeleton = (function(){
  const { Vec3, Quat, Mat4, clamp, lerp, damp, dampAngle, EPSILON } = OrbMath;

  // ============================================================
  // Bone - 单个骨骼
  // ============================================================
  class Bone {
    constructor(index, name = ''){
      this.index = index;
      this.name = name;
      this.parent = -1;
      this.children = [];
      this.position = new Vec3();       // 局部位置（相对于父骨骼）
      this.rotation = new Quat();       // 局部旋转
      this.scale = new Vec3(1, 1, 1);   // 局部缩放
      this.restPosition = new Vec3();    // 初始位置
      this.restRotation = new Quat();    // 初始旋转
      this.restScale = new Vec3(1, 1, 1);
      this.worldPosition = new Vec3();   // 世界位置
      this.worldRotation = new Quat();   // 世界旋转
      this.worldScale = new Vec3(1, 1, 1);
      this.worldMatrix = new Mat4();      // 世界矩阵
      this.inverseBindMatrix = new Mat4(); // 逆绑定矩阵
      this.length = 0;                    // 骨骼长度
      this.flags = 0;                     // 骨骼标志
      this.ikData = null;                 // IK数据
      this.physicsData = null;            // 物理数据
      this.constraints = [];              // 约束列表
      this.userData = {};                  // 用户自定义数据
    }

    setParent(parentIndex){
      this.parent = parentIndex;
    }

    addChild(childIndex){
      if(!this.children.includes(childIndex)){
        this.children.push(childIndex);
      }
    }

    saveRestPose(){
      this.restPosition.copy(this.position);
      this.restRotation.copy(this.rotation);
      this.restScale.copy(this.scale);
    }

    loadRestPose(){
      this.position.copy(this.restPosition);
      this.rotation.copy(this.restRotation);
      this.scale.copy(this.restScale);
    }

    resetToRest(){
      this.position.copy(this.restPosition);
      this.rotation.copy(this.restRotation);
      this.scale.copy(this.restScale);
    }

    getForward(){
      return new Vec3(0, 0, -1).applyQuaternion(this.worldRotation);
    }

    getUp(){
      return new Vec3(0, 1, 0).applyQuaternion(this.worldRotation);
    }

    getRight(){
      return new Vec3(1, 0, 0).applyQuaternion(this.worldRotation);
    }

    clone(){
      const b = new Bone(this.index, this.name);
      b.parent = this.parent;
      b.children = [...this.children];
      b.position.copy(this.position);
      b.rotation.copy(this.rotation);
      b.scale.copy(this.scale);
      b.restPosition.copy(this.restPosition);
      b.restRotation.copy(this.restRotation);
      b.restScale.copy(this.restScale);
      b.worldPosition.copy(this.worldPosition);
      b.worldRotation.copy(this.worldRotation);
      b.worldScale.copy(this.worldScale);
      b.worldMatrix.copy(this.worldMatrix);
      b.inverseBindMatrix.copy(this.inverseBindMatrix);
      b.length = this.length;
      b.flags = this.flags;
      b.userData = {...this.userData};
      return b;
    }
  }

  // ============================================================
  // Skeleton - 骨骼层级
  // ============================================================
  class Skeleton {
    constructor(){
      this.bones = [];
      this.rootBones = [];
      this.computeOrder = [];  // 从根到叶的计算顺序
      this.boneMap = {};       // 名称到索引的映射
      this.bonePalette = null; // 骨骼调色板（Float32Array，用于GPU蒙皮）
      this.paletteSize = 0;
      this.dirty = true;
      this.userData = {};
    }

    addBone(name, parentIndex = -1){
      const index = this.bones.length;
      const bone = new Bone(index, name);
      bone.parent = parentIndex;
      this.bones.push(bone);
      this.boneMap[name] = index;
      if(parentIndex >= 0 && parentIndex < this.bones.length){
        this.bones[parentIndex].addChild(index);
      } else {
        this.rootBones.push(index);
      }
      this.dirty = true;
      return bone;
    }

    getBone(nameOrIndex){
      if(typeof nameOrIndex === 'number'){
        return this.bones[nameOrIndex];
      }
      const idx = this.boneMap[nameOrIndex];
      return idx !== undefined ? this.bones[idx] : null;
    }

    getBoneIndex(name){
      return this.boneMap[name];
    }

    buildComputeOrder(){
      this.computeOrder = [];
      const visited = new Set();
      const visit = (index) => {
        if(visited.has(index)) return;
        visited.add(index);
        const bone = this.bones[index];
        if(bone.parent >= 0 && !visited.has(bone.parent)){
          visit(bone.parent);
        }
        this.computeOrder.push(index);
        for(const child of bone.children){
          visit(child);
        }
      };
      for(const root of this.rootBones){
        visit(root);
      }
      // 确保所有骨骼都被访问
      for(let i = 0; i < this.bones.length; i++){
        if(!visited.has(i)){
          visit(i);
        }
      }
      this.dirty = true;
      return this.computeOrder;
    }

    computeWorldMatrices(){
      if(this.computeOrder.length !== this.bones.length){
        this.buildComputeOrder();
      }
      for(const idx of this.computeOrder){
        const bone = this.bones[idx];
        if(bone.parent >= 0){
          const parent = this.bones[bone.parent];
          // 世界旋转 = 父世界旋转 * 局部旋转
          bone.worldRotation.copy(parent.worldRotation).multiply(bone.rotation);
          // 世界位置 = 父世界位置 + 父世界旋转 * (局部位置 * 父世界缩放)
          const localPos = bone.position.clone();
          localPos.x *= parent.worldScale.x;
          localPos.y *= parent.worldScale.y;
          localPos.z *= parent.worldScale.z;
          localPos.applyQuaternion(parent.worldRotation);
          bone.worldPosition.copy(parent.worldPosition).add(localPos);
          // 世界缩放
          bone.worldScale.set(
            parent.worldScale.x * bone.scale.x,
            parent.worldScale.y * bone.scale.y,
            parent.worldScale.z * bone.scale.z
          );
        } else {
          bone.worldRotation.copy(bone.rotation);
          bone.worldPosition.copy(bone.position);
          bone.worldScale.copy(bone.scale);
        }
        // 组合世界矩阵
        bone.worldMatrix.compose(bone.worldPosition, bone.worldRotation, bone.worldScale);
      }
      this.dirty = false;
    }

    updateBonePalette(maxBones = 256){
      if(!this.bonePalette || this.bonePalette.length < maxBones * 16){
        this.bonePalette = new Float32Array(maxBones * 16);
      }
      this.paletteSize = Math.min(this.bones.length, maxBones);
      for(let i = 0; i < this.paletteSize; i++){
        const bone = this.bones[i];
        // 蒙皮矩阵 = 世界矩阵 * 逆绑定矩阵
        const skinMatrix = bone.worldMatrix.clone().multiply(bone.inverseBindMatrix);
        this.bonePalette.set(skinMatrix.elements, i * 16);
      }
      return this.bonePalette;
    }

    resetToRestPose(){
      for(const bone of this.bones){
        bone.resetToRest();
      }
      this.dirty = true;
    }

    saveRestPose(){
      for(const bone of this.bones){
        bone.saveRestPose();
      }
    }

    setBoneRotation(nameOrIndex, rotation){
      const bone = this.getBone(nameOrIndex);
      if(bone){
        bone.rotation.copy(rotation);
        this.dirty = true;
      }
    }

    setBonePosition(nameOrIndex, position){
      const bone = this.getBone(nameOrIndex);
      if(bone){
        bone.position.copy(position);
        this.dirty = true;
      }
    }

    getChain(startBone, endBone){
      const chain = [];
      let current = this.getBone(endBone);
      while(current && current.index !== startBone){
        chain.unshift(current.index);
        if(current.parent < 0) break;
        current = this.bones[current.parent];
      }
      if(current && current.index === startBone){
        chain.unshift(startBone);
      }
      return chain;
    }

    getTipPosition(boneIndex){
      const bone = this.bones[boneIndex];
      if(!bone) return null;
      // 骨骼末端 = 世界位置 + 骨骼长度 * 前向方向
      const tip = bone.getForward().mul(bone.length);
      return bone.worldPosition.clone().add(tip);
    }

    clone(){
      const s = new Skeleton();
      for(const bone of this.bones){
        const b = bone.clone();
        s.bones.push(b);
        s.boneMap[b.name] = b.index;
      }
      s.rootBones = [...this.rootBones];
      s.computeOrder = [...this.computeOrder];
      s.userData = {...this.userData};
      return s;
    }
  }

  // ============================================================
  // IKSolver - IK求解器（CCD和FABRIK）
  // ============================================================
  class IKSolver {
    constructor(skeleton){
      this.skeleton = skeleton;
      this.maxIterations = 20;
      this.tolerance = 0.001;
      this.useCCD = true; // true=CCD, false=FABRIK
    }

    solve(chain, target, poleVector = null){
      if(chain.length < 2) return false;
      if(this.useCCD){
        return this.solveCCD(chain, target, poleVector);
      } else {
        return this.solveFABRIK(chain, target, poleVector);
      }
    }

    // CCD (Cyclic Coordinate Descent) 算法
    solveCCD(chain, target, poleVector){
      const bones = chain.map(i => this.skeleton.bones[i]);
      const endEffector = bones[bones.length - 1];
      let success = false;

      for(let iter = 0; iter < this.maxIterations; iter++){
        // 从末端向根遍历
        for(let i = bones.length - 2; i >= 0; i--){
          const bone = bones[i];
          this.skeleton.computeWorldMatrices();

          // 获取末端执行器位置
          const endPos = endEffector.worldPosition.clone();
          const bonePos = bone.worldPosition.clone();

          // 计算旋转
          const toEnd = Vec3.sub(endPos, bonePos).normalize();
          const toTarget = Vec3.sub(target, bonePos).normalize();

          if(toEnd.lengthSq() < EPSILON || toTarget.lengthSq() < EPSILON) continue;

          const dot = clamp(toEnd.dot(toTarget), -1, 1);
          const angle = Math.acos(dot);

          if(Math.abs(angle) < EPSILON) continue;

          const axis = Vec3.cross(toEnd, toTarget).normalize();
          if(axis.lengthSq() < EPSILON) continue;

          // 限制旋转角度
          const maxAngle = Math.PI * 0.5;
          const rotAngle = clamp(angle, -maxAngle, maxAngle);
          const deltaRot = Quat.fromAxisAngle(axis, rotAngle);

          // 应用到局部旋转
          bone.rotation.premultiply(deltaRot);
          bone.rotation.normalize();

          // 极向量约束
          if(poleVector && i > 0){
            this.applyPoleConstraint(bone, poleVector);
          }
        }

        // 检查是否到达目标
        this.skeleton.computeWorldMatrices();
        const dist = endEffector.worldPosition.distanceTo(target);
        if(dist < this.tolerance){
          success = true;
          break;
        }
      }

      this.skeleton.computeWorldMatrices();
      return success;
    }

    // FABRIK (Forward And Backward Reaching Inverse Kinematics) 算法
    solveFABRIK(chain, target, poleVector){
      const bones = chain.map(i => this.skeleton.bones[i]);
      const n = bones.length;

      // 收集关节位置
      const positions = [];
      for(const bone of bones){
        positions.push(bone.worldPosition.clone());
      }
      // 末端执行器位置
      const endEffector = bones[n - 1];
      positions.push(endEffector.worldPosition.clone());

      // 计算每段长度
      const lengths = [];
      for(let i = 0; i < n; i++){
        lengths.push(positions[i].distanceTo(positions[i + 1]));
      }

      const rootPos = positions[0].clone();
      let success = false;

      for(let iter = 0; iter < this.maxIterations; iter++){
        // 前向传播：从末端到根
        positions[n] = target.clone();
        for(let i = n - 1; i >= 0; i--){
          const dir = Vec3.sub(positions[i], positions[i + 1]).normalize();
          positions[i] = positions[i + 1].clone().add(dir.mul(lengths[i]));
        }

        // 后向传播：从根到末端
        positions[0] = rootPos.clone();
        for(let i = 0; i < n; i++){
          const dir = Vec3.sub(positions[i + 1], positions[i]).normalize();
          positions[i + 1] = positions[i].clone().add(dir.mul(lengths[i]));
        }

        // 检查收敛
        const dist = positions[n].distanceTo(target);
        if(dist < this.tolerance){
          success = true;
          break;
        }
      }

      // 将位置转换为旋转
      for(let i = 0; i < n - 1; i++){
        const bone = bones[i];
        const nextBone = bones[i + 1];

        // 计算当前骨骼到下一骨骼的方向
        const currentDir = Vec3.sub(nextBone.worldPosition, bone.worldPosition).normalize();
        const targetDir = Vec3.sub(positions[i + 1], positions[i]).normalize();

        if(currentDir.lengthSq() > EPSILON && targetDir.lengthSq() > EPSILON){
          const rot = new Quat().setFromUnitVectors(currentDir, targetDir);
          bone.rotation.premultiply(rot);
          bone.rotation.normalize();
        }
      }

      this.skeleton.computeWorldMatrices();
      return success;
    }

    applyPoleConstraint(bone, poleVector){
      // 极向量约束：使骨骼平面朝向极向量
      this.skeleton.computeWorldMatrices();
      const bonePos = bone.worldPosition.clone();
      const poleDir = Vec3.sub(poleVector, bonePos).normalize();

      // 获取骨骼的右方向
      const right = bone.getRight();
      const dot = clamp(right.dot(poleDir), -1, 1);
      const angle = Math.acos(dot);

      if(Math.abs(angle) > EPSILON){
        const axis = bone.getForward();
        const deltaRot = Quat.fromAxisAngle(axis, angle);
        bone.rotation.premultiply(deltaRot);
        bone.rotation.normalize();
      }
    }

    // 双骨IK（专门用于手臂/腿）
    solveTwoBone(upperBone, lowerBone, endBone, target, poleVector, elbowBend = 0){
      const upper = this.skeleton.getBone(upperBone);
      const lower = this.skeleton.getBone(lowerBone);
      const end = this.skeleton.getBone(endBone);

      if(!upper || !lower || !end) return false;

      this.skeleton.computeWorldMatrices();

      const upperPos = upper.worldPosition.clone();
      const lowerPos = lower.worldPosition.clone();
      const endPos = end.worldPosition.clone();

      const upperLen = upperPos.distanceTo(lowerPos);
      const lowerLen = lowerPos.distanceTo(endPos);
      const totalLen = upperLen + lowerLen;
      const targetDist = upperPos.distanceTo(target);

      // 如果目标太远，伸直手臂
      if(targetDist >= totalLen - EPSILON){
        const dir = Vec3.sub(target, upperPos).normalize();
        const newLowerPos = upperPos.clone().add(dir.mul(upperLen));
        const newEndPos = newLowerPos.clone().add(dir.mul(lowerLen));
        this._applyTwoBoneRotation(upper, lower, upperPos, newLowerPos, newEndPos, poleVector);
        return true;
      }

      // 如果目标太近，弯曲手臂
      const minDist = Math.abs(upperLen - lowerLen);
      if(targetDist <= minDist + EPSILON){
        const dir = Vec3.sub(target, upperPos).normalize();
        const bendDir = poleVector ? Vec3.sub(poleVector, upperPos).normalize() : new Vec3(0, 1, 0);
        const newLowerPos = upperPos.clone().add(bendDir.mul(upperLen));
        const newEndPos = newLowerPos.clone().add(dir.mul(lowerLen));
        this._applyTwoBoneRotation(upper, lower, upperPos, newLowerPos, newEndPos, poleVector);
        return true;
      }

      // 正常情况：用余弦定理计算肘部位置
      const a = upperLen;
      const b = lowerLen;
      const c = targetDist;
      const cosAngle = (a * a + c * c - b * b) / (2 * a * c);
      const angle = Math.acos(clamp(cosAngle, -1, 1));

      // 计算肘部平面
      const toTarget = Vec3.sub(target, upperPos).normalize();
      let planeNormal;
      if(poleVector){
        const toPole = Vec3.sub(poleVector, upperPos).normalize();
        planeNormal = Vec3.cross(toTarget, toPole).normalize();
        if(planeNormal.lengthSq() < EPSILON){
          planeNormal = new Vec3(0, 0, 1);
        }
      } else {
        planeNormal = new Vec3(0, 0, 1);
      }

      // 计算肘部位置
      const elbowDir = toTarget.clone().applyQuaternion(Quat.fromAxisAngle(planeNormal, angle)).normalize();
      const newLowerPos = upperPos.clone().add(elbowDir.mul(upperLen));
      const newEndPos = target.clone();

      this._applyTwoBoneRotation(upper, lower, upperPos, newLowerPos, newEndPos, poleVector);
      return true;
    }

    _applyTwoBoneRotation(upper, lower, upperPos, newLowerPos, newEndPos, poleVector){
      // 计算上臂旋转
      const currentUpperDir = Vec3.sub(lower.worldPosition, upper.worldPosition).normalize();
      const targetUpperDir = Vec3.sub(newLowerPos, upperPos).normalize();
      const upperRot = new Quat().setFromUnitVectors(currentUpperDir, targetUpperDir);
      upper.rotation.premultiply(upperRot);
      upper.rotation.normalize();

      this.skeleton.computeWorldMatrices();

      // 计算下臂旋转
      const currentLowerDir = Vec3.sub(newEndPos, newLowerPos).normalize();
      const lowerEnd = this.skeleton.bones[lower.children[0]] || lower;
      const actualLowerDir = Vec3.sub(lowerEnd.worldPosition, lower.worldPosition).normalize();
      const lowerRot = new Quat().setFromUnitVectors(actualLowerDir, currentLowerDir);
      lower.rotation.premultiply(lowerRot);
      lower.rotation.normalize();

      this.skeleton.computeWorldMatrices();
    }
  }

  // ============================================================
  // BoneConstraint - 骨骼约束基类
  // ============================================================
  class BoneConstraint {
    constructor(boneIndex, targetBoneIndex, weight = 1){
      this.boneIndex = boneIndex;
      this.targetBoneIndex = targetBoneIndex;
      this.weight = weight;
      this.enabled = true;
    }
    apply(skeleton, dt){}
  }

  // LookAt约束
  class LookAtConstraint extends BoneConstraint {
    constructor(boneIndex, targetBoneIndex, weight = 1){
      super(boneIndex, targetBoneIndex, weight);
      this.upVector = new Vec3(0, 1, 0);
      this.limitX = Math.PI;
      this.limitY = Math.PI;
      this.limitZ = Math.PI;
    }

    apply(skeleton, dt){
      if(!this.enabled) return;
      const bone = skeleton.bones[this.boneIndex];
      const target = skeleton.bones[this.targetBoneIndex];
      if(!bone || !target) return;

      const toTarget = Vec3.sub(target.worldPosition, bone.worldPosition).normalize();
      const currentForward = bone.getForward();

      const rot = new Quat().setFromUnitVectors(currentForward, toTarget);
      const targetRot = bone.rotation.clone().premultiply(rot);

      // 限制旋转
      const euler = targetRot.toEuler();
      euler.x = clamp(euler.x, -this.limitX, this.limitX);
      euler.y = clamp(euler.y, -this.limitY, this.limitY);
      euler.z = clamp(euler.z, -this.limitZ, this.limitZ);
      targetRot.setFromEuler(euler.x, euler.y, euler.z);

      bone.rotation.slerp(targetRot, this.weight);
      bone.rotation.normalize();
    }
  }

  // Aim约束
  class AimConstraint extends BoneConstraint {
    constructor(boneIndex, targetBoneIndex, weight = 1){
      super(boneIndex, targetBoneIndex, weight);
      this.axis = new Vec3(1, 0, 0);
      this.upVector = new Vec3(0, 1, 0);
    }

    apply(skeleton, dt){
      if(!this.enabled) return;
      const bone = skeleton.bones[this.boneIndex];
      const target = skeleton.bones[this.targetBoneIndex];
      if(!bone || !target) return;

      const toTarget = Vec3.sub(target.worldPosition, bone.worldPosition).normalize();
      const currentAxis = this.axis.clone().applyQuaternion(bone.worldRotation);
      const rot = new Quat().setFromUnitVectors(currentAxis, toTarget);
      const targetRot = bone.rotation.clone().premultiply(rot);
      bone.rotation.slerp(targetRot, this.weight);
      bone.rotation.normalize();
    }
  }

  // Parent约束
  class ParentConstraint extends BoneConstraint {
    constructor(boneIndex, targetBoneIndex, weight = 1){
      super(boneIndex, targetBoneIndex, weight);
      this.positionOffset = new Vec3();
      this.rotationOffset = new Quat();
      this.affectPosition = true;
      this.affectRotation = true;
    }

    apply(skeleton, dt){
      if(!this.enabled) return;
      const bone = skeleton.bones[this.boneIndex];
      const target = skeleton.bones[this.targetBoneIndex];
      if(!bone || !target) return;

      if(this.affectPosition){
        const targetPos = target.worldPosition.clone().add(this.positionOffset);
        const localPos = targetPos.clone().applyQuaternion(target.worldRotation.clone().inverse());
        bone.position.lerp(localPos, this.weight);
      }

      if(this.affectRotation){
        const targetRot = target.worldRotation.clone().multiply(this.rotationOffset);
        const localRot = target.worldRotation.clone().inverse().multiply(targetRot);
        bone.rotation.slerp(localRot, this.weight);
        bone.rotation.normalize();
      }
    }
  }

  // Orient约束
  class OrientConstraint extends BoneConstraint {
    constructor(boneIndex, targetBoneIndex, weight = 1){
      super(boneIndex, targetBoneIndex, weight);
      this.offset = new Quat();
    }

    apply(skeleton, dt){
      if(!this.enabled) return;
      const bone = skeleton.bones[this.boneIndex];
      const target = skeleton.bones[this.targetBoneIndex];
      if(!bone || !target) return;

      const targetRot = target.worldRotation.clone().multiply(this.offset);
      bone.rotation.slerp(targetRot, this.weight);
      bone.rotation.normalize();
    }
  }

  // 约束管理器
  class ConstraintManager {
    constructor(skeleton){
      this.skeleton = skeleton;
      this.constraints = [];
    }

    add(constraint){
      this.constraints.push(constraint);
      return constraint;
    }

    remove(constraint){
      const idx = this.constraints.indexOf(constraint);
      if(idx >= 0) this.constraints.splice(idx, 1);
    }

    applyAll(dt){
      for(const c of this.constraints){
        c.apply(this.skeleton, dt);
      }
    }

    clear(){
      this.constraints = [];
    }
  }

  // ============================================================
  // SpringBone - 弹簧骨骼（物理模拟）
  // ============================================================
  class SpringBone {
    constructor(boneIndex){
      this.boneIndex = boneIndex;
      this.stiffness = 0.5;      // 刚度
      this.damping = 0.5;        // 阻尼
      this.gravity = new Vec3(0, -9.8, 0); // 重力
      this.gravityPower = 0.1;   // 重力强度
      this.radius = 0.1;         // 碰撞半径
      this.springForce = new Vec3(); // 当前弹簧力
      this.prevPosition = new Vec3(); // 上一帧位置
      this.colliders = [];        // 碰撞体列表
      this.enabled = true;
      this.limits = null;         // 旋转限制 {minX, maxX, minY, maxY, minZ, maxZ}
    }

    update(skeleton, dt){
      if(!this.enabled) return;
      const bone = skeleton.bones[this.boneIndex];
      if(!bone) return;

      const currentPos = bone.worldPosition.clone();

      // Verlet积分
      const velocity = Vec3.sub(currentPos, this.prevPosition).mul(this.damping);
      const force = this.springForce.clone().mul(this.stiffness);
      force.add(this.gravity.clone().mul(this.gravityPower * dt));

      const newPos = currentPos.clone().add(velocity).add(force);

      // 碰撞检测
      for(const collider of this.colliders){
        this.resolveCollision(newPos, collider);
      }

      // 应用新位置（通过旋转父骨骼）
      if(bone.parent >= 0){
        const parent = skeleton.bones[bone.parent];
        const toCurrent = Vec3.sub(currentPos, parent.worldPosition).normalize();
        const toNew = Vec3.sub(newPos, parent.worldPosition).normalize();

        if(toCurrent.lengthSq() > EPSILON && toNew.lengthSq() > EPSILON){
          const rot = new Quat().setFromUnitVectors(toCurrent, toNew);
          parent.rotation.premultiply(rot);
          parent.rotation.normalize();

          // 应用旋转限制
          if(this.limits){
            this.applyLimits(parent);
          }
        }
      }

      this.prevPosition.copy(currentPos);
      this.springForce.mul(0.9); // 弹簧力衰减
    }

    resolveCollision(position, collider){
      const dist = position.distanceTo(collider.position);
      const minDist = this.radius + collider.radius;
      if(dist < minDist && dist > EPSILON){
        const normal = Vec3.sub(position, collider.position).normalize();
        const push = normal.mul(minDist - dist);
        position.add(push);
      }
    }

    applyLimits(bone){
      const euler = bone.rotation.toEuler();
      if(this.limits.minX !== undefined) euler.x = Math.max(this.limits.minX, euler.x);
      if(this.limits.maxX !== undefined) euler.x = Math.min(this.limits.maxX, euler.x);
      if(this.limits.minY !== undefined) euler.y = Math.max(this.limits.minY, euler.y);
      if(this.limits.maxY !== undefined) euler.y = Math.min(this.limits.maxY, euler.y);
      if(this.limits.minZ !== undefined) euler.z = Math.max(this.limits.minZ, euler.z);
      if(this.limits.maxZ !== undefined) euler.z = Math.min(this.limits.maxZ, euler.z);
      bone.rotation.setFromEuler(euler.x, euler.y, euler.z);
    }

    addCollider(collider){
      this.colliders.push(collider);
    }
  }

  // 碰撞体
  class BoneCollider {
    constructor(position, radius){
      this.position = position || new Vec3();
      this.radius = radius || 0.1;
    }
  }

  // 弹簧骨骼管理器
  class SpringManager {
    constructor(skeleton){
      this.skeleton = skeleton;
      this.springBones = [];
      this.colliders = [];
    }

    addSpringBone(boneIndex){
      const sb = new SpringBone(boneIndex);
      this.springBones.push(sb);
      return sb;
    }

    addCollider(position, radius){
      const c = new BoneCollider(position, radius);
      this.colliders.push(c);
      return c;
    }

    update(dt){
      this.skeleton.computeWorldMatrices();
      for(const sb of this.springBones){
        sb.update(this.skeleton, dt);
      }
      this.skeleton.computeWorldMatrices();
    }

    clear(){
      this.springBones = [];
      this.colliders = [];
    }
  }

  // 导出
  return {
    Bone, Skeleton, IKSolver,
    BoneConstraint, LookAtConstraint, AimConstraint,
    ParentConstraint, OrientConstraint, ConstraintManager,
    SpringBone, BoneCollider, SpringManager
  };
})();

if(typeof window !== 'undefined'){
  window.OrbSkeleton = OrbSkeleton;
}