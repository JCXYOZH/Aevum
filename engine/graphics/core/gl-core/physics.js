
// ============================================================
// 模块四：物理系统 PhysicsSystem (约1500行)
// 质点-弹簧 / Verlet积分 / 布料模拟 / 头发模拟 / 碰撞检测
// ============================================================

const OrbPhysics = (function(){
  const { Vec3, Quat, Mat4, clamp, lerp, damp, EPSILON } = OrbMath;

  // ============================================================
  // Particle - 质点
  // ============================================================
  class Particle {
    constructor(position, mass = 1){
      this.position = position.clone();
      this.prevPosition = position.clone();
      this.velocity = new Vec3();
      this.acceleration = new Vec3();
      this.force = new Vec3();
      this.mass = mass;
      this.invMass = mass > 0 ? 1 / mass : 0;
      this.pinned = false;
      this.collisionRadius = 0;
      this.userData = {};
    }

    applyForce(force){
      this.force.add(force);
    }

    clearForce(){
      this.force.set(0, 0, 0);
    }

    updateVerlet(dt, damping = 0.99){
      if(this.pinned) return;

      const velocity = Vec3.sub(this.position, this.prevPosition).mul(damping);
      this.prevPosition.copy(this.position);

      // Verlet积分: x(t+dt) = x(t) + v(t)*dt + a(t)*dt^2
      const acceleration = this.force.clone().mul(this.invMass);
      this.position.add(velocity).add(acceleration.mul(dt * dt));

      this.velocity.copy(velocity);
      this.clearForce();
    }

    updateEuler(dt, damping = 0.99){
      if(this.pinned) return;

      const acceleration = this.force.clone().mul(this.invMass);
      this.velocity.add(acceleration.mul(dt));
      this.velocity.mul(damping);
      this.position.add(this.velocity.clone().mul(dt));
      this.clearForce();
    }

    pin(position = null){
      this.pinned = true;
      if(position) this.position.copy(position);
      this.prevPosition.copy(this.position);
      this.velocity.set(0, 0, 0);
    }

    unpin(){
      this.pinned = false;
    }
  }

  // ============================================================
  // Spring - 弹簧约束
  // ============================================================
  class Spring {
    constructor(particleA, particleB, restLength = -1, stiffness = 0.5, damping = 0.1){
      this.particleA = particleA;
      this.particleB = particleB;
      this.restLength = restLength >= 0 ? restLength : particleA.position.distanceTo(particleB.position);
      this.stiffness = stiffness;
      this.damping = damping;
      this.enabled = true;
    }

    satisfy(){
      if(!this.enabled) return;

      const delta = Vec3.sub(this.particleB.position, this.particleA.position);
      const distance = delta.length();
      if(distance < EPSILON) return;

      const diff = (distance - this.restLength) / distance;
      const correction = delta.mul(diff * 0.5 * this.stiffness);

      // 阻尼
      const relativeVelocity = Vec3.sub(this.particleB.velocity, this.particleA.velocity);
      const dampingForce = delta.clone().normalize().mul(relativeVelocity.dot(delta.clone().normalize()) * this.damping);

      if(!this.particleA.pinned){
        this.particleA.position.add(correction);
        this.particleA.velocity.add(dampingForce.clone().mul(this.particleA.invMass));
      }
      if(!this.particleB.pinned){
        this.particleB.position.sub(correction);
        this.particleB.velocity.sub(dampingForce.clone().mul(this.particleB.invMass));
      }
    }

    applyForce(){
      if(!this.enabled) return;

      const delta = Vec3.sub(this.particleB.position, this.particleA.position);
      const distance = delta.length();
      if(distance < EPSILON) return;

      const force = delta.normalize().mul((distance - this.restLength) * this.stiffness);
      this.particleA.applyForce(force);
      this.particleB.applyForce(force.clone().negate());
    }
  }

  // ============================================================
  // DistanceConstraint - 距离约束（硬约束）
  // ============================================================
  class DistanceConstraint {
    constructor(particleA, particleB, distance = -1){
      this.particleA = particleA;
      this.particleB = particleB;
      this.distance = distance >= 0 ? distance : particleA.position.distanceTo(particleB.position);
      this.iterations = 3;
      this.enabled = true;
    }

    satisfy(){
      if(!this.enabled) return;

      for(let i = 0; i < this.iterations; i++){
        const delta = Vec3.sub(this.particleB.position, this.particleA.position);
        const currentDist = delta.length();
        if(currentDist < EPSILON) continue;

        const diff = (currentDist - this.distance) / currentDist;
        const correction = delta.mul(diff * 0.5);

        const totalInvMass = this.particleA.invMass + this.particleB.invMass;
        if(totalInvMass < EPSILON) continue;

        const weightA = this.particleA.invMass / totalInvMass;
        const weightB = this.particleB.invMass / totalInvMass;

        if(!this.particleA.pinned) this.particleA.position.add(correction.clone().mul(weightA));
        if(!this.particleB.pinned) this.particleB.position.sub(correction.clone().mul(weightB));
      }
    }
  }

  // ============================================================
  // BendConstraint - 弯曲约束（用于布料）
  // ============================================================
  class BendConstraint {
    constructor(particleA, particleB, particleC, stiffness = 0.3){
      this.particleA = particleA;
      this.particleB = particleB;
      this.particleC = particleC;
      this.restAngle = this._computeAngle();
      this.stiffness = stiffness;
      this.enabled = true;
    }

    _computeAngle(){
      const ab = Vec3.sub(this.particleB.position, this.particleA.position).normalize();
      const cb = Vec3.sub(this.particleB.position, this.particleC.position).normalize();
      return Math.acos(clamp(ab.dot(cb), -1, 1));
    }

    satisfy(){
      if(!this.enabled) return;

      const currentAngle = this._computeAngle();
      const angleDiff = currentAngle - this.restAngle;

      if(Math.abs(angleDiff) < EPSILON) return;

      // 计算修正方向
      const ab = Vec3.sub(this.particleB.position, this.particleA.position);
      const cb = Vec3.sub(this.particleB.position, this.particleC.position);
      const normal = Vec3.cross(ab, cb).normalize();

      if(normal.lengthSq() < EPSILON) return;

      const correction = normal.mul(angleDiff * this.stiffness * 0.5);

      if(!this.particleA.pinned) this.particleA.position.add(correction);
      if(!this.particleC.pinned) this.particleC.position.sub(correction);
    }
  }

  // ============================================================
  // PinConstraint - 固定约束
  // ============================================================
  class PinConstraint {
    constructor(particle, position){
      this.particle = particle;
      this.position = position.clone();
      this.stiffness = 1;
      this.enabled = true;
    }

    satisfy(){
      if(!this.enabled) return;
      if(this.particle.pinned){
        this.particle.position.copy(this.position);
        return;
      }
      const delta = Vec3.sub(this.position, this.particle.position);
      this.particle.position.add(delta.mul(this.stiffness));
    }
  }

  // ============================================================
  // Collider - 碰撞体基类
  // ============================================================
  class Collider {
    constructor(){
      this.position = new Vec3();
      this.enabled = true;
      this.friction = 0.5;
      this.restitution = 0.3;
    }

    collide(particle){
      return false;
    }
  }

  // 球体碰撞体
  class SphereCollider extends Collider {
    constructor(position, radius){
      super();
      this.position = position.clone();
      this.radius = radius;
    }

    collide(particle){
      if(!this.enabled) return false;

      const delta = Vec3.sub(particle.position, this.position);
      const distance = delta.length();
      const minDist = this.radius + particle.collisionRadius;

      if(distance < minDist && distance > EPSILON){
        const normal = delta.normalize();
        const penetration = minDist - distance;

        // 位置修正
        particle.position.add(normal.mul(penetration));

        // 速度反射
        const velocityNormal = particle.velocity.dot(normal);
        if(velocityNormal < 0){
          particle.velocity.sub(normal.mul(velocityNormal * (1 + this.restitution)));
          // 摩擦
          const tangent = particle.velocity.clone().sub(normal.mul(particle.velocity.dot(normal)));
          particle.velocity.sub(tangent.mul(this.friction));
        }

        return true;
      }
      return false;
    }
  }

  // 平面碰撞体
  class PlaneCollider extends Collider {
    constructor(position, normal){
      super();
      this.position = position.clone();
      this.normal = normal.clone().normalize();
    }

    collide(particle){
      if(!this.enabled) return false;

      const delta = Vec3.sub(particle.position, this.position);
      const distance = delta.dot(this.normal);
      const minDist = particle.collisionRadius;

      if(distance < minDist){
        // 位置修正
        particle.position.add(this.normal.clone().mul(minDist - distance));

        // 速度反射
        const velocityNormal = particle.velocity.dot(this.normal);
        if(velocityNormal < 0){
          particle.velocity.sub(this.normal.clone().mul(velocityNormal * (1 + this.restitution)));
          const tangent = particle.velocity.clone().sub(this.normal.clone().mul(particle.velocity.dot(this.normal)));
          particle.velocity.sub(tangent.mul(this.friction));
        }

        return true;
      }
      return false;
    }
  }

  // 胶囊体碰撞体
  class CapsuleCollider extends Collider {
    constructor(start, end, radius){
      super();
      this.start = start.clone();
      this.end = end.clone();
      this.radius = radius;
    }

    get position(){
      return Vec3.lerp(this.start, this.end, 0.5);
    }

    collide(particle){
      if(!this.enabled) return false;

      // 找到粒子到线段的最近点
      const ab = Vec3.sub(this.end, this.start);
      const ap = Vec3.sub(particle.position, this.start);
      const t = clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
      const closest = this.start.clone().add(ab.mul(t));

      const delta = Vec3.sub(particle.position, closest);
      const distance = delta.length();
      const minDist = this.radius + particle.collisionRadius;

      if(distance < minDist && distance > EPSILON){
        const normal = delta.normalize();
        const penetration = minDist - distance;

        particle.position.add(normal.mul(penetration));

        const velocityNormal = particle.velocity.dot(normal);
        if(velocityNormal < 0){
          particle.velocity.sub(normal.mul(velocityNormal * (1 + this.restitution)));
          const tangent = particle.velocity.clone().sub(normal.mul(particle.velocity.dot(normal)));
          particle.velocity.sub(tangent.mul(this.friction));
        }

        return true;
      }
      return false;
    }
  }

  // ============================================================
  // Cloth - 布料模拟
  // ============================================================
  class Cloth {
    constructor(width, height, segmentsX, segmentsY, origin = new Vec3(), mass = 1){
      this.width = width;
      this.height = height;
      this.segmentsX = segmentsX;
      this.segmentsY = segmentsY;
      this.particles = [];
      this.springs = [];
      this.bendConstraints = [];
      this.colliders = [];
      this.gravity = new Vec3(0, -9.8, 0);
      this.wind = new Vec3();
      this.damping = 0.99;
      this.iterations = 5;
      this.enabled = true;

      this._initParticles(origin, mass);
      this._initSprings();
      this._initBendConstraints();
    }

    _initParticles(origin, mass){
      const dx = this.width / this.segmentsX;
      const dy = this.height / this.segmentsY;

      for(let y = 0; y <= this.segmentsY; y++){
        for(let x = 0; x <= this.segmentsX; x++){
          const pos = new Vec3(
            origin.x + x * dx - this.width / 2,
            origin.y - y * dy + this.height / 2,
            origin.z
          );
          const particle = new Particle(pos, mass);
          particle.collisionRadius = 0.01;
          this.particles.push(particle);
        }
      }
    }

    _getIndex(x, y){
      return y * (this.segmentsX + 1) + x;
    }

    _initSprings(){
      // 结构弹簧（水平和垂直）
      for(let y = 0; y <= this.segmentsY; y++){
        for(let x = 0; x <= this.segmentsX; x++){
          const idx = this._getIndex(x, y);

          // 水平
          if(x < this.segmentsX){
            const right = this._getIndex(x + 1, y);
            this.springs.push(new Spring(this.particles[idx], this.particles[right], -1, 0.8, 0.1));
          }

          // 垂直
          if(y < this.segmentsY){
            const down = this._getIndex(x, y + 1);
            this.springs.push(new Spring(this.particles[idx], this.particles[down], -1, 0.8, 0.1));
          }
        }
      }

      // 剪切弹簧（对角线）
      for(let y = 0; y < this.segmentsY; y++){
        for(let x = 0; x < this.segmentsX; x++){
          const idx = this._getIndex(x, y);
          const diag1 = this._getIndex(x + 1, y + 1);
          const diag2 = this._getIndex(x + 1, y);
          const diag3 = this._getIndex(x, y + 1);

          this.springs.push(new Spring(this.particles[idx], this.particles[diag1], -1, 0.3, 0.1));
          this.springs.push(new Spring(this.particles[diag2], this.particles[diag3], -1, 0.3, 0.1));
        }
      }
    }

    _initBendConstraints(){
      // 弯曲约束（隔一个粒子）
      for(let y = 0; y <= this.segmentsY; y++){
        for(let x = 0; x <= this.segmentsX - 2; x++){
          const idx = this._getIndex(x, y);
          const mid = this._getIndex(x + 1, y);
          const far = this._getIndex(x + 2, y);
          this.bendConstraints.push(new BendConstraint(this.particles[idx], this.particles[mid], this.particles[far], 0.2));
        }
      }

      for(let y = 0; y <= this.segmentsY - 2; y++){
        for(let x = 0; x <= this.segmentsX; x++){
          const idx = this._getIndex(x, y);
          const mid = this._getIndex(x, y + 1);
          const far = this._getIndex(x, y + 2);
          this.bendConstraints.push(new BendConstraint(this.particles[idx], this.particles[mid], this.particles[far], 0.2));
        }
      }
    }

    pinRow(row, pinned = true){
      for(let x = 0; x <= this.segmentsX; x++){
        const idx = this._getIndex(x, row);
        if(pinned) this.particles[idx].pin();
        else this.particles[idx].unpin();
      }
    }

    pinColumn(col, pinned = true){
      for(let y = 0; y <= this.segmentsY; y++){
        const idx = this._getIndex(col, y);
        if(pinned) this.particles[idx].pin();
        else this.particles[idx].unpin();
      }
    }

    pinParticle(x, y, pinned = true){
      const idx = this._getIndex(x, y);
      if(pinned) this.particles[idx].pin();
      else this.particles[idx].unpin();
    }

    addCollider(collider){
      this.colliders.push(collider);
      return collider;
    }

    update(dt){
      if(!this.enabled) return;

      // 应用力
      for(const particle of this.particles){
        if(particle.pinned) continue;
        particle.applyForce(this.gravity.clone().mul(particle.mass));
        // 风力（基于法线的简化计算）
        if(this.wind.lengthSq() > EPSILON){
          particle.applyForce(this.wind.clone().mul(0.1));
        }
      }

      // Verlet积分
      for(const particle of this.particles){
        particle.updateVerlet(dt, this.damping);
      }

      // 约束迭代
      for(let i = 0; i < this.iterations; i++){
        for(const spring of this.springs){
          spring.satisfy();
        }
        for(const constraint of this.bendConstraints){
          constraint.satisfy();
        }

        // 碰撞
        for(const particle of this.particles){
          if(particle.pinned) continue;
          for(const collider of this.colliders){
            collider.collide(particle);
          }
        }
      }
    }

    getVertices(){
      return this.particles.map(p => p.position);
    }

    getIndices(){
      const indices = [];
      for(let y = 0; y < this.segmentsY; y++){
        for(let x = 0; x < this.segmentsX; x++){
          const a = this._getIndex(x, y);
          const b = this._getIndex(x + 1, y);
          const c = this._getIndex(x, y + 1);
          const d = this._getIndex(x + 1, y + 1);
          indices.push(a, c, b);
          indices.push(b, c, d);
        }
      }
      return indices;
    }

    getNormals(){
      const normals = new Array(this.particles.length);
      for(let i = 0; i < normals.length; i++){
        normals[i] = new Vec3();
      }

      const indices = this.getIndices();
      for(let i = 0; i < indices.length; i += 3){
        const a = this.particles[indices[i]].position;
        const b = this.particles[indices[i + 1]].position;
        const c = this.particles[indices[i + 2]].position;

        const ab = Vec3.sub(b, a);
        const ac = Vec3.sub(c, a);
        const normal = Vec3.cross(ab, ac).normalize();

        normals[indices[i]].add(normal);
        normals[indices[i + 1]].add(normal);
        normals[indices[i + 2]].add(normal);
      }

      for(const normal of normals){
        normal.normalize();
      }

      return normals;
    }
  }

  // ============================================================
  // HairSim - 头发模拟（链状弹簧）
  // ============================================================
  class HairStrand {
    constructor(origin, direction, length, segments, mass = 0.1){
      this.origin = origin.clone();
      this.direction = direction.clone().normalize();
      this.length = length;
      this.segments = segments;
      this.particles = [];
      this.springs = [];
      this.colliders = [];
      this.gravity = new Vec3(0, -9.8, 0);
      this.damping = 0.95;
      this.stiffness = 0.8;
      this.iterations = 3;
      this.enabled = true;

      this._initParticles(mass);
      this._initSprings();
    }

    _initParticles(mass){
      const segLength = this.length / this.segments;

      for(let i = 0; i <= this.segments; i++){
        const pos = this.origin.clone().add(this.direction.clone().mul(segLength * i));
        const particle = new Particle(pos, mass);
        particle.collisionRadius = 0.02;
        if(i === 0) particle.pin();
        this.particles.push(particle);
      }
    }

    _initSprings(){
      const segLength = this.length / this.segments;

      for(let i = 0; i < this.segments; i++){
        // 结构弹簧
        this.springs.push(new Spring(this.particles[i], this.particles[i + 1], segLength, this.stiffness, 0.1));
      }

      // 弯曲约束（隔一个粒子）
      for(let i = 0; i < this.segments - 1; i++){
        this.springs.push(new Spring(this.particles[i], this.particles[i + 2], segLength * 2, this.stiffness * 0.3, 0.1));
      }
    }

    setOrigin(position){
      this.origin.copy(position);
      this.particles[0].position.copy(position);
      this.particles[0].prevPosition.copy(position);
    }

    addCollider(collider){
      this.colliders.push(collider);
      return collider;
    }

    update(dt){
      if(!this.enabled) return;

      // 应用力
      for(const particle of this.particles){
        if(particle.pinned) continue;
        particle.applyForce(this.gravity.clone().mul(particle.mass));
      }

      // Verlet积分
      for(const particle of this.particles){
        particle.updateVerlet(dt, this.damping);
      }

      // 约束迭代
      for(let i = 0; i < this.iterations; i++){
        for(const spring of this.springs){
          spring.satisfy();
        }

        // 碰撞
        for(const particle of this.particles){
          if(particle.pinned) continue;
          for(const collider of this.colliders){
            collider.collide(particle);
          }
        }
      }
    }

    getVertices(){
      return this.particles.map(p => p.position);
    }

    getTipPosition(){
      return this.particles[this.particles.length - 1].position.clone();
    }
  }

  // 头发系统（多股头发）
  class HairSystem {
    constructor(){
      this.strands = [];
      this.colliders = [];
      this.gravity = new Vec3(0, -9.8, 0);
      this.wind = new Vec3();
      this.enabled = true;
    }

    addStrand(strand){
      this.strands.push(strand);
      for(const collider of this.colliders){
        strand.addCollider(collider);
      }
      return strand;
    }

    addCollider(collider){
      this.colliders.push(collider);
      for(const strand of this.strands){
        strand.addCollider(collider);
      }
      return collider;
    }

    createStrands(origin, count, length, segments, spread = 0.5){
      for(let i = 0; i < count; i++){
        const angle = (i / count) * Math.PI * 2;
        const direction = new Vec3(
          Math.cos(angle) * spread,
          -1,
          Math.sin(angle) * spread
        ).normalize();

        const offset = new Vec3(
          Math.cos(angle) * 0.1,
          0,
          Math.sin(angle) * 0.1
        );

        const strand = new HairStrand(origin.clone().add(offset), direction, length, segments, 0.05);
        strand.gravity.copy(this.gravity);
        this.addStrand(strand);
      }
    }

    update(dt){
      if(!this.enabled) return;

      for(const strand of this.strands){
        strand.gravity.copy(this.gravity);
        strand.update(dt);
      }
    }

    getAllVertices(){
      const vertices = [];
      for(const strand of this.strands){
        vertices.push(...strand.getVertices());
      }
      return vertices;
    }
  }

  // ============================================================
  // PhysicsWorld - 物理世界
  // ============================================================
  class PhysicsWorld {
    constructor(){
      this.particles = [];
      this.springs = [];
      this.constraints = [];
      this.colliders = [];
      this.cloths = [];
      this.hairSystems = [];
      this.gravity = new Vec3(0, -9.8, 0);
      this.damping = 0.99;
      this.iterations = 5;
      this.enabled = true;
      this.time = 0;
    }

    addParticle(particle){
      this.particles.push(particle);
      return particle;
    }

    addSpring(spring){
      this.springs.push(spring);
      return spring;
    }

    addConstraint(constraint){
      this.constraints.push(constraint);
      return constraint;
    }

    addCollider(collider){
      this.colliders.push(collider);
      return collider;
    }

    addCloth(cloth){
      this.cloths.push(cloth);
      for(const collider of this.colliders){
        cloth.addCollider(collider);
      }
      return cloth;
    }

    addHairSystem(system){
      this.hairSystems.push(system);
      return system;
    }

    update(dt){
      if(!this.enabled) return;

      this.time += dt;

      // 更新布料
      for(const cloth of this.cloths){
        cloth.gravity.copy(this.gravity);
        cloth.update(dt);
      }

      // 更新头发
      for(const hair of this.hairSystems){
        hair.gravity.copy(this.gravity);
        hair.update(dt);
      }

      // 更新独立粒子
      for(const particle of this.particles){
        if(particle.pinned) continue;
        particle.applyForce(this.gravity.clone().mul(particle.mass));
        particle.updateVerlet(dt, this.damping);
      }

      // 约束迭代
      for(let i = 0; i < this.iterations; i++){
        for(const spring of this.springs){
          spring.satisfy();
        }
        for(const constraint of this.constraints){
          constraint.satisfy();
        }

        // 碰撞
        for(const particle of this.particles){
          if(particle.pinned) continue;
          for(const collider of this.colliders){
            collider.collide(particle);
          }
        }
      }
    }

    clear(){
      this.particles = [];
      this.springs = [];
      this.constraints = [];
      this.colliders = [];
      this.cloths = [];
      this.hairSystems = [];
    }
  }

  // 导出
  return {
    Particle, Spring, DistanceConstraint, BendConstraint, PinConstraint,
    Collider, SphereCollider, PlaneCollider, CapsuleCollider,
    Cloth, HairStrand, HairSystem, PhysicsWorld
  };
})();

if(typeof window !== 'undefined'){
  window.OrbPhysics = OrbPhysics;
}