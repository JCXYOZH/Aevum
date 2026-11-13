/**
 * MrHua 3D灵体渲染引擎 - 扩展模块: orb-extension-fluid-sph
 * 从 legacy/_orb_expand_part3.js 转换 (GBK->UTF-8)
 * @module orb-extension-fluid-sph
 */
'use strict';



/* ===== 流体模拟系统 (SPH - 光滑粒子流体动力学 =====
   支持: 密度/压力求解 / 粘度/ 表面张力 / 边界碰撞
*/
function createSPHFluid(options){
  const fluid = {
    particles: [],
    maxParticles: (options && options.maxParticles) || 2000,
    particleRadius: (options && options.particleRadius) || 0.05,
    smoothingRadius: (options && options.smoothingRadius) || 0.2,
    restDensity: (options && options.restDensity) || 1000,
    stiffness: (options && options.stiffness) || 2000,
    viscosity: (options && options.viscosity) || 250,
    gravity: (options && options.gravity) || [0, -9.8, 0],
    damping: (options && options.damping) || 0.98,
    bounds: (options && options.bounds) || { min: [-2, 0, -2], max: [2, 3, 2] },
    _grid: {},
    _gridSize: 0.2,
    _densities: null,
    _pressures: null,
    _forces: null
  };

  function init(count, startPos, startVel){
    fluid.particles = [];
    const sp = startPos || [0, 1, 0];
    const sv = startVel || [0, 0, 0];
    const side = Math.ceil(Math.pow(count, 1/3));
    let idx = 0;
    for(let z = 0; z < side && idx < count; z++){
      for(let y = 0; y < side && idx < count; y++){
        for(let x = 0; x < side && idx < count; x++){
          fluid.particles.push({
            position: [sp[0] + x * fluid.particleRadius * 2, sp[1] + y * fluid.particleRadius * 2, sp[2] + z * fluid.particleRadius * 2],
            velocity: [sv[0], sv[1], sv[2]],
            density: 0,
            pressure: 0,
            force: [0, 0, 0],
            color: [0.3, 0.5, 0.9, 0.8]
          });
          idx++;
        }
      }
    }
    fluid._densities = new Float32Array(fluid.particles.length);
    fluid._pressures = new Float32Array(fluid.particles.length);
    fluid._forces = new Float32Array(fluid.particles.length * 3);
  }

  function poly6Kernel(r, h){
    if(r > h) return 0;
    const val = (h * h - r * r) / (h * h);
    return 315 / (64 * Math.PI * Math.pow(h, 9)) * val * val * val;
  }

  function spikyKernelGradient(r, h){
    if(r > h || r < 0.0001) return 0;
    const val = (h - r) / h;
    return -45 / (Math.PI * Math.pow(h, 6)) * val * val;
  }

  function viscosityKernelLaplacian(r, h){
    if(r > h) return 0;
    return 45 / (Math.PI * Math.pow(h, 6)) * (h - r);
  }

  function buildGrid(){
    fluid._grid = {};
    for(let i = 0; i < fluid.particles.length; i++){
      const p = fluid.particles[i];
      const gx = Math.floor(p.position[0] / fluid._gridSize);
      const gy = Math.floor(p.position[1] / fluid._gridSize);
      const gz = Math.floor(p.position[2] / fluid._gridSize);
      const key = gx + ',' + gy + ',' + gz;
      if(!fluid._grid[key]) fluid._grid[key] = [];
      fluid._grid[key].push(i);
    }
  }

  function getNeighbors(i){
    const p = fluid.particles[i];
    const gx = Math.floor(p.position[0] / fluid._gridSize);
    const gy = Math.floor(p.position[1] / fluid._gridSize);
    const gz = Math.floor(p.position[2] / fluid._gridSize);
    const neighbors = [];
    for(let dx = -1; dx <= 1; dx++){
      for(let dy = -1; dy <= 1; dy++){
        for(let dz = -1; dz <= 1; dz++){
          const key = (gx+dx) + ',' + (gy+dy) + ',' + (gz+dz);
          if(fluid._grid[key]){
            for(let n = 0; n < fluid._grid[key].length; n++){
              neighbors.push(fluid._grid[key][n]);
            }
          }
        }
      }
    }
    return neighbors;
  }

  function computeDensityPressure(){
    const h = fluid.smoothingRadius;
    for(let i = 0; i < fluid.particles.length; i++){
      const pi = fluid.particles[i];
      let density = 0;
      const neighbors = getNeighbors(i);
      for(let n = 0; n < neighbors.length; n++){
        const j = neighbors[n];
        const pj = fluid.particles[j];
        const dx = pi.position[0] - pj.position[0];
        const dy = pi.position[1] - pj.position[1];
        const dz = pi.position[2] - pj.position[2];
        const r = Math.sqrt(dx*dx + dy*dy + dz*dz);
        density += poly6Kernel(r, h);
      }
      pi.density = Math.max(density, fluid.restDensity * 0.1);
      pi.pressure = fluid.stiffness * (pi.density - fluid.restDensity);
    }
  }

  function computeForces(){
    const h = fluid.smoothingRadius;
    for(let i = 0; i < fluid.particles.length; i++){
      const pi = fluid.particles[i];
      let fx = fluid.gravity[0] * pi.density;
      let fy = fluid.gravity[1] * pi.density;
      let fz = fluid.gravity[2] * pi.density;
      const neighbors = getNeighbors(i);
      for(let n = 0; n < neighbors.length; n++){
        const j = neighbors[n];
        if(j === i) continue;
        const pj = fluid.particles[j];
        const dx = pi.position[0] - pj.position[0];
        const dy = pi.position[1] - pj.position[1];
        const dz = pi.position[2] - pj.position[2];
        const r = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if(r < 0.0001 || r > h) continue;
        const dirX = dx / r, dirY = dy / r, dirZ = dz / r;
        const pressureForce = -((pi.pressure + pj.pressure) / (2 * pj.density)) * spikyKernelGradient(r, h);
        fx += pressureForce * dirX;
        fy += pressureForce * dirY;
        fz += pressureForce * dirZ;
        const viscForce = fluid.viscosity * viscosityKernelLaplacian(r, h) / pj.density;
        fx += viscForce * (pj.velocity[0] - pi.velocity[0]);
        fy += viscForce * (pj.velocity[1] - pi.velocity[1]);
        fz += viscForce * (pj.velocity[2] - pi.velocity[2]);
      }
      pi.force[0] = fx;
      pi.force[1] = fy;
      pi.force[2] = fz;
    }
  }

  function integrate(dt){
    for(let i = 0; i < fluid.particles.length; i++){
      const p = fluid.particles[i];
      p.velocity[0] += (p.force[0] / p.density) * dt;
      p.velocity[1] += (p.force[1] / p.density) * dt;
      p.velocity[2] += (p.force[2] / p.density) * dt;
      p.velocity[0] *= fluid.damping;
      p.velocity[1] *= fluid.damping;
      p.velocity[2] *= fluid.damping;
      p.position[0] += p.velocity[0] * dt;
      p.position[1] += p.velocity[1] * dt;
      p.position[2] += p.velocity[2] * dt;

      const b = fluid.bounds;
      for(let axis = 0; axis < 3; axis++){
        if(p.position[axis] < b.min[axis]){
          p.position[axis] = b.min[axis];
          p.velocity[axis] *= -0.5;
        }
        if(p.position[axis] > b.max[axis]){
          p.position[axis] = b.max[axis];
          p.velocity[axis] *= -0.5;
        }
      }
    }
  }

  function step(dt){
    buildGrid();
    computeDensityPressure();
    computeForces();
    integrate(dt);
  }

  function addParticle(position, velocity){
    if(fluid.particles.length >= fluid.maxParticles) return null;
    const p = {
      position: [position[0], position[1], position[2]],
      velocity: velocity ? [velocity[0],velocity[1],velocity[2]] : [0,0,0],
      density: 0, pressure: 0, force: [0,0,0],
      color: [0.3, 0.5, 0.9, 0.8]
    };
    fluid.particles.push(p);
    return p;
  }

  function getPositions(){
    const arr = new Float32Array(fluid.particles.length * 3);
    for(let i = 0; i < fluid.particles.length; i++){
      arr[i*3] = fluid.particles[i].position[0];
      arr[i*3+1] = fluid.particles[i].position[1];
      arr[i*3+2] = fluid.particles[i].position[2];
    }
    return arr;
  }

  function reset(){
    fluid.particles = [];
  }

  return { init, step, addParticle, getPositions, reset, fluid };
}

/* ===== 布娃娃系统=====
   支持: 刚体组/ 关节约束 / 物理驱动 / 与骨骼系统绑定*/
function createRagdoll(boneSystem, options){
  const ragdoll = {
    boneSystem: boneSystem,
    bodies: [],
    joints: [],
    boneMap: {},
    gravity: (options && options.gravity) || [0, -9.8, 0],
    damping: (options && options.damping) || 0.98,
    iterations: (options && options.iterations) || 10,
    _active: false,
    _poseRotations: null,
    _posePositions: null
  };

  function addBody(boneIndex, shape, size, mass, offset){
    const bone = boneSystem.bones ? boneSystem.bones[boneIndex] : null;
    const body = {
      boneIndex: boneIndex,
      position: bone ? [bone.position[0], bone.position[1], bone.position[2]] : [0,0,0],
      prevPosition: bone ? [bone.position[0], bone.position[1], bone.position[2]] : [0,0,0],
      velocity: [0, 0, 0],
      angularVelocity: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      shape: shape || 'capsule',
      size: size || [0.1, 0.3, 0.1],
      mass: mass || 1,
      invMass: mass > 0 ? 1 / mass : 0,
      offset: offset || [0, 0, 0],
      pinned: false
    };
    ragdoll.bodies.push(body);
    ragdoll.boneMap[boneIndex] = body;
    return body;
  }

  function addJoint(bodyAIndex, bodyBIndex, pivot, axis, limits){
    const joint = {
      bodyA: ragdoll.bodies[bodyAIndex],
      bodyB: ragdoll.bodies[bodyBIndex],
      pivot: pivot ? [pivot[0],pivot[1],pivot[2]] : [0,0,0],
      axis: axis ? [axis[0],axis[1],axis[2]] : [0,1,0],
      minAngle: (limits && limits.min) || -Math.PI,
      maxAngle: (limits && limits.max) || Math.PI,
      stiffness: (limits && limits.stiffness) || 1
    };
    ragdoll.joints.push(joint);
    return joint;
  }

  function buildDefaultHumanoid(){
    const bones = boneSystem.bones || [];
    const findBone = function(name){
      for(let i = 0; i < bones.length; i++){
        if(bones[i].name && bones[i].name.indexOf(name) >= 0) return i;
      }
      return -1;
    };
    const pelvis = findBone('下半身') || findBone('pelvis') || 0;
    const spine = findBone('上半身') || findBone('spine') || 1;
    const head = findBone('头') || findBone('head') || 2;
    const lUpperArm = findBone('左腕') || findBone('LeftArm') || 3;
    const lLowerArm = findBone('左ひじ') || findBone('LeftForeArm') || 4;
    const rUpperArm = findBone('右腕') || findBone('RightArm') || 5;
    const rLowerArm = findBone('右ひじ') || findBone('RightForeArm') || 6;
    const lUpperLeg = findBone('左足') || findBone('LeftUpLeg') || 7;
    const lLowerLeg = findBone('左ひじ') || findBone('LeftLeg') || 8;
    const rUpperLeg = findBone('右足') || findBone('RightUpLeg') || 9;
    const rLowerLeg = findBone('右ひじ') || findBone('RightLeg') || 10;

    if(pelvis >= 0) addBody(pelvis, 'box', [0.2, 0.15, 0.15], 2);
    if(spine >= 0) addBody(spine, 'box', [0.25, 0.3, 0.15], 3);
    if(head >= 0) addBody(head, 'sphere', [0.1, 0.1, 0.1], 1.5);
    if(lUpperArm >= 0) addBody(lUpperArm, 'capsule', [0.05, 0.2, 0.05], 0.8);
    if(lLowerArm >= 0) addBody(lLowerArm, 'capsule', [0.04, 0.18, 0.04], 0.6);
    if(rUpperArm >= 0) addBody(rUpperArm, 'capsule', [0.05, 0.2, 0.05], 0.8);
    if(rLowerArm >= 0) addBody(rLowerArm, 'capsule', [0.04, 0.18, 0.04], 0.6);
    if(lUpperLeg >= 0) addBody(lUpperLeg, 'capsule', [0.07, 0.25, 0.07], 1.2);
    if(lLowerLeg >= 0) addBody(lLowerLeg, 'capsule', [0.06, 0.22, 0.06], 1);
    if(rUpperLeg >= 0) addBody(rUpperLeg, 'capsule', [0.07, 0.25, 0.07], 1.2);
    if(rLowerLeg >= 0) addBody(rLowerLeg, 'capsule', [0.06, 0.22, 0.06], 1);

    if(pelvis >= 0 && spine >= 0) addJoint(0, 1, [0, 0.1, 0], [0, 1, 0], { min: -0.5, max: 0.5 });
    if(spine >= 0 && head >= 0) addJoint(1, 2, [0, 0.2, 0], [0, 1, 0], { min: -0.8, max: 0.8 });
  }

  function activate(){
    ragdoll._active = true;
    for(let i = 0; i < ragdoll.bodies.length; i++){
      const body = ragdoll.bodies[i];
      body.prevPosition[0] = body.position[0];
      body.prevPosition[1] = body.position[1];
      body.prevPosition[2] = body.position[2];
    }
  }

  function deactivate(){
    ragdoll._active = false;
  }

  function applyForces(dt){
    for(let i = 0; i < ragdoll.bodies.length; i++){
      const body = ragdoll.bodies[i];
      if(body.pinned) continue;
      body.velocity[0] += ragdoll.gravity[0] * dt;
      body.velocity[1] += ragdoll.gravity[1] * dt;
      body.velocity[2] += ragdoll.gravity[2] * dt;
      body.velocity[0] *= ragdoll.damping;
      body.velocity[1] *= ragdoll.damping;
      body.velocity[2] *= ragdoll.damping;
    }
  }

  function integrate(dt){
    for(let i = 0; i < ragdoll.bodies.length; i++){
      const body = ragdoll.bodies[i];
      if(body.pinned) continue;
      body.prevPosition[0] = body.position[0];
      body.prevPosition[1] = body.position[1];
      body.prevPosition[2] = body.position[2];
      body.position[0] += body.velocity[0] * dt;
      body.position[1] += body.velocity[1] * dt;
      body.position[2] += body.velocity[2] * dt;
    }
  }

  function solveJoints(){
    for(let iter = 0; iter < ragdoll.iterations; iter++){
      for(let j = 0; j < ragdoll.joints.length; j++){
        const joint = ragdoll.joints[j];
        const a = joint.bodyA, b = joint.bodyB;
        if(!a || !b) continue;
        const dx = b.position[0] - a.position[0];
        const dy = b.position[1] - a.position[1];
        const dz = b.position[2] - a.position[2];
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) || 0.001;
        const targetDist = 0.15;
        const diff = (dist - targetDist) / dist;
        const totalInvMass = a.invMass + b.invMass;
        if(totalInvMass <= 0) continue;
        const ratioA = b.invMass / totalInvMass;
        const ratioB = a.invMass / totalInvMass;
        if(!a.pinned){
          a.position[0] += dx * diff * ratioA;
          a.position[1] += dy * diff * ratioA;
          a.position[2] += dz * diff * ratioA;
        }
        if(!b.pinned){
          b.position[0] -= dx * diff * ratioB;
          b.position[1] -= dy * diff * ratioB;
          b.position[2] -= dz * diff * ratioB;
        }
      }
      for(let i = 0; i < ragdoll.bodies.length; i++){
        const body = ragdoll.bodies[i];
        if(body.pinned) continue;
        if(body.position[1] < body.size[1]){
          body.position[1] = body.size[1];
          body.velocity[1] *= -0.3;
        }
      }
    }
  }

  function updateVelocities(dt){
    for(let i = 0; i < ragdoll.bodies.length; i++){
      const body = ragdoll.bodies[i];
      if(body.pinned) continue;
      body.velocity[0] = (body.position[0] - body.prevPosition[0]) / dt;
      body.velocity[1] = (body.position[1] - body.prevPosition[1]) / dt;
      body.velocity[2] = (body.position[2] - body.prevPosition[2]) / dt;
    }
  }

  function step(dt){
    if(!ragdoll._active) return;
    applyForces(dt);
    integrate(dt);
    solveJoints();
    updateVelocities(dt);
  }

  function getBonePose(){
    const rotations = [];
    const positions = [];
    const bones = boneSystem.bones || [];
    for(let i = 0; i < bones.length; i++){
      const body = ragdoll.boneMap[i];
      if(body){
        positions.push([body.position[0], body.position[1], body.position[2]]);
        rotations.push([body.rotation[0], body.rotation[1], body.rotation[2], body.rotation[3]]);
      } else {
        positions.push(bones[i].position || [0,0,0]);
        rotations.push([0,0,0,1]);
      }
    }
    return { rotations: rotations, positions: positions };
  }

  function setBodyPosition(boneIndex, x, y, z){
    const body = ragdoll.boneMap[boneIndex];
    if(body){
      body.position[0] = x; body.position[1] = y; body.position[2] = z;
      body.prevPosition[0] = x; body.prevPosition[1] = y; body.prevPosition[2] = z;
    }
  }

  function pinBody(boneIndex, pinned){
    const body = ragdoll.boneMap[boneIndex];
    if(body) body.pinned = pinned !== false;
  }

  function reset(){
    ragdoll.bodies = [];
    ragdoll.joints = [];
    ragdoll.boneMap = {};
    ragdoll._active = false;
  }

  return { addBody, addJoint, buildDefaultHumanoid, activate, deactivate, step, getBonePose, setBodyPosition, pinBody, reset, ragdoll };
}

/* ===== Verlet 软体系统 =====
   支持: 质点-约束软体 / 体积保持 / 自碰撞/ 可变形体
*/
function createVerletSoftBody(options){
  const sb = {
    particles: [],
    constraints: [],
    faces: [],
    gravity: (options && options.gravity) || [0, -9.8, 0],
    damping: (options && options.damping) || 0.99,
    stiffness: (options && options.stiffness) || 0.9,
    iterations: (options && options.iterations) || 8,
    volumeStiffness: (options && options.volumeStiffness) || 0.5,
    _restVolume: 0,
    _center: [0, 0, 0]
  };

  function initFromGeometry(geometry){
    sb.particles = [];
    sb.constraints = [];
    sb.faces = [];
    const pos = geometry.positions;
    const idx = geometry.indices;
    const vertCount = pos.length / 3;
    for(let i = 0; i < vertCount; i++){
      sb.particles.push({
        position: [pos[i*3], pos[i*3+1], pos[i*3+2]],
        prevPosition: [pos[i*3], pos[i*3+1], pos[i*3+2]],
        velocity: [0, 0, 0],
        pinned: false,
        mass: 1
      });
    }
    const edgeSet = {};
    for(let i = 0; i < idx.length; i += 3){
      const a = idx[i], b = idx[i+1], c = idx[i+2];
      sb.faces.push([a, b, c]);
      addConstraint(a, b);
      addConstraint(b, c);
      addConstraint(a, c);
    }
    computeRestVolume();
  }

  function addConstraint(p1, p2){
    const key = p1 < p2 ? p1 + '_' + p2 : p2 + '_' + p1;
    if(sb.constraints.find(function(c){ return c.key === key; })) return;
    const a = sb.particles[p1], b = sb.particles[p2];
    const dx = a.position[0] - b.position[0];
    const dy = a.position[1] - b.position[1];
    const dz = a.position[2] - b.position[2];
    sb.constraints.push({
      p1: p1, p2: p2, key: key,
      rest: Math.sqrt(dx*dx + dy*dy + dz*dz),
      stiffness: sb.stiffness
    });
  }

  function computeRestVolume(){
    let volume = 0;
    for(let i = 0; i < sb.faces.length; i++){
      const f = sb.faces[i];
      const a = sb.particles[f[0]].position;
      const b = sb.particles[f[1]].position;
      const c = sb.particles[f[2]].position;
      volume += (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0])) / 6;
    }
    sb._restVolume = Math.abs(volume);
  }

  function computeCurrentVolume(){
    let volume = 0;
    for(let i = 0; i < sb.faces.length; i++){
      const f = sb.faces[i];
      const a = sb.particles[f[0]].position;
      const b = sb.particles[f[1]].position;
      const c = sb.particles[f[2]].position;
      volume += (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0])) / 6;
    }
    return Math.abs(volume);
  }

  function computeCenter(){
    let cx = 0, cy = 0, cz = 0;
    for(let i = 0; i < sb.particles.length; i++){
      cx += sb.particles[i].position[0];
      cy += sb.particles[i].position[1];
      cz += sb.particles[i].position[2];
    }
    const n = sb.particles.length || 1;
    sb._center[0] = cx / n;
    sb._center[1] = cy / n;
    sb._center[2] = cz / n;
  }

  function applyGravity(dt){
    for(let i = 0; i < sb.particles.length; i++){
      const p = sb.particles[i];
      if(p.pinned) continue;
      p.velocity[0] += sb.gravity[0] * dt;
      p.velocity[1] += sb.gravity[1] * dt;
      p.velocity[2] += sb.gravity[2] * dt;
    }
  }

  function integrate(dt){
    for(let i = 0; i < sb.particles.length; i++){
      const p = sb.particles[i];
      if(p.pinned) continue;
      p.prevPosition[0] = p.position[0];
      p.prevPosition[1] = p.position[1];
      p.prevPosition[2] = p.position[2];
      p.velocity[0] *= sb.damping;
      p.velocity[1] *= sb.damping;
      p.velocity[2] *= sb.damping;
      p.position[0] += p.velocity[0] * dt;
      p.position[1] += p.velocity[1] * dt;
      p.position[2] += p.velocity[2] * dt;
    }
  }

  function solveConstraints(){
    for(let iter = 0; iter < sb.iterations; iter++){
      for(let c = 0; c < sb.constraints.length; c++){
        const con = sb.constraints[c];
        const a = sb.particles[con.p1];
        const b = sb.particles[con.p2];
        const dx = b.position[0] - a.position[0];
        const dy = b.position[1] - a.position[1];
        const dz = b.position[2] - a.position[2];
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) || 0.0001;
        const diff = (dist - con.rest) / dist * con.stiffness;
        if(!a.pinned){
          a.position[0] += dx * diff * 0.5;
          a.position[1] += dy * diff * 0.5;
          a.position[2] += dz * diff * 0.5;
        }
        if(!b.pinned){
          b.position[0] -= dx * diff * 0.5;
          b.position[1] -= dy * diff * 0.5;
          b.position[2] -= dz * diff * 0.5;
        }
      }
      if(sb.volumeStiffness > 0 && sb._restVolume > 0){
        computeCenter();
        const currentVol = computeCurrentVolume();
        const ratio = Math.pow(currentVol / sb._restVolume, 1/3);
        const correction = (1 - ratio) * sb.volumeStiffness;
        for(let i = 0; i < sb.particles.length; i++){
          const p = sb.particles[i];
          if(p.pinned) continue;
          p.position[0] += (p.position[0] - sb._center[0]) * correction;
          p.position[1] += (p.position[1] - sb._center[1]) * correction;
          p.position[2] += (p.position[2] - sb._center[2]) * correction;
        }
      }
      for(let i = 0; i < sb.particles.length; i++){
        const p = sb.particles[i];
        if(p.pinned) continue;
        if(p.position[1] < 0){
          p.position[1] = 0;
          p.velocity[1] *= -0.3;
        }
      }
    }
  }

  function updateVelocities(dt){
    for(let i = 0; i < sb.particles.length; i++){
      const p = sb.particles[i];
      if(p.pinned) continue;
      p.velocity[0] = (p.position[0] - p.prevPosition[0]) / dt;
      p.velocity[1] = (p.position[1] - p.prevPosition[1]) / dt;
      p.velocity[2] = (p.position[2] - p.prevPosition[2]) / dt;
    }
  }

  function step(dt){
    applyGravity(dt);
    integrate(dt);
    solveConstraints();
    updateVelocities(dt);
  }

  function pinParticle(index, pinned){
    if(sb.particles[index]) sb.particles[index].pinned = pinned !== false;
  }

  function setParticlePosition(index, x, y, z){
    const p = sb.particles[index];
    if(p){
      p.position[0] = x; p.position[1] = y; p.position[2] = z;
      p.prevPosition[0] = x; p.prevPosition[1] = y; p.prevPosition[2] = z;
    }
  }

  function applyForce(index, fx, fy, fz){
    const p = sb.particles[index];
    if(p && !p.pinned){
      p.velocity[0] += fx;
      p.velocity[1] += fy;
      p.velocity[2] += fz;
    }
  }

  function getGeometry(){
    const positions = new Float32Array(sb.particles.length * 3);
    for(let i = 0; i < sb.particles.length; i++){
      positions[i*3] = sb.particles[i].position[0];
      positions[i*3+1] = sb.particles[i].position[1];
      positions[i*3+2] = sb.particles[i].position[2];
    }
    return { positions: positions, particleCount: sb.particles.length };
  }

  function reset(){
    sb.particles = [];
    sb.constraints = [];
    sb.faces = [];
  }

  return { initFromGeometry, step, pinParticle, setParticlePosition, applyForce, getGeometry, reset, sb };
}

/* ===== 纹理图集生成器=====
   支持: 自动打包 / 间距控制 / 四边扩展 / UV重映射*/
function createTextureAtlas(options){
  const atlas = {
    width: (options && options.width) || 1024,
    height: (options && options.height) || 1024,
    padding: (options && options.padding) || 2,
    entries: [],
    _nodes: [],
    _canvas: null,
    _ctx: null
  };

  function init(){
    atlas._canvas = document.createElement('canvas');
    atlas._canvas.width = atlas.width;
    atlas._canvas.height = atlas.height;
    atlas._ctx = atlas._canvas.getContext('2d');
    atlas._ctx.fillStyle = '#000';
    atlas._ctx.fillRect(0, 0, atlas.width, atlas.height);
    atlas._nodes = [{ x: 0, y: 0, w: atlas.width, h: atlas.height }];
  }

  function addImage(name, image, options){
    const pad = atlas.padding;
    const w = image.width + pad * 2;
    const h = image.height + pad * 2;
    const node = findNode(w, h);
    if(!node){
      console.warn('[TextureAtlas] 图集空间不足: ' + name);
      return null;
    }
    const entry = {
      name: name,
      x: node.x + pad,
      y: node.y + pad,
      width: image.width,
      height: image.height,
      uv: {
        u0: (node.x + pad) / atlas.width,
        v0: (node.y + pad) / atlas.height,
        u1: (node.x + pad + image.width) / atlas.width,
        v1: (node.y + pad + image.height) / atlas.height
      }
    };
    atlas._ctx.drawImage(image, entry.x, entry.y);
    if(options && options.extrude){
      extrudeEntry(entry, options.extrude);
    }
    atlas.entries.push(entry);
    return entry;
  }

  function findNode(w, h){
    for(let i = 0; i < atlas._nodes.length; i++){
      const node = atlas._nodes[i];
      if(w <= node.w && h <= node.h){
        splitNode(i, w, h);
        return node;
      }
    }
    return null;
  }

  function splitNode(index, w, h){
    const node = atlas._nodes[index];
    atlas._nodes.splice(index, 1);
    atlas._nodes.push({ x: node.x + w, y: node.y, w: node.w - w, h: h });
    atlas._nodes.push({ x: node.x, y: node.y + h, w: node.w, h: node.h - h });
  }

  function extrudeEntry(entry, amount){
    const ctx = atlas._ctx;
    const x = entry.x, y = entry.y, w = entry.width, h = entry.height;
    for(let i = 1; i <= amount; i++){
      ctx.drawImage(atlas._canvas, x, y, 1, h, x - i, y, 1, h);
      ctx.drawImage(atlas._canvas, x + w - 1, y, 1, h, x + w - 1 + i, y, 1, h);
      ctx.drawImage(atlas._canvas, x, y, w, 1, x, y - i, w, 1);
      ctx.drawImage(atlas._canvas, x, y + h - 1, w, 1, x, y + h - 1 + i, w, 1);
    }
  }

  function getEntry(name){
    return atlas.entries.find(function(e){ return e.name === name; });
  }

  function getUV(name){
    const entry = getEntry(name);
    return entry ? entry.uv : null;
  }

  function remapUVs(geometry, textureName){
    const uv = getUV(textureName);
    if(!uv || !geometry.uvs) return geometry;
    const newUVs = new Float32Array(geometry.uvs.length);
    for(let i = 0; i < geometry.uvs.length; i += 2){
      newUVs[i] = uv.u0 + geometry.uvs[i] * (uv.u1 - uv.u0);
      newUVs[i+1] = uv.v0 + geometry.uvs[i+1] * (uv.v1 - uv.v0);
    }
    return { ...geometry, uvs: newUVs };
  }

  function toTexture(gl){
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas._canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function getCanvas(){
    return atlas._canvas;
  }

  function getUsage(){
    let used = 0;
    for(let i = 0; i < atlas.entries.length; i++){
      used += atlas.entries[i].width * atlas.entries[i].height;
    }
    return used / (atlas.width * atlas.height);
  }

  function clear(){
    atlas.entries = [];
    atlas._nodes = [{ x: 0, y: 0, w: atlas.width, h: atlas.height }];
    if(atlas._ctx){
      atlas._ctx.fillStyle = '#000';
      atlas._ctx.fillRect(0, 0, atlas.width, atlas.height);
    }
  }

  return { init, addImage, getEntry, getUV, remapUVs, toTexture, getCanvas, getUsage, clear, atlas };
}

/* ===== 网格LOD生成器=====
   支持: 自动简化/ 距离切换 / 顶点聚类 / 边折叠*/
function createMeshLODGenerator(options){
  const gen = {
    levels: [],
    baseGeometry: null,
    _distances: []
  };

  function setBaseGeometry(geometry){
    gen.baseGeometry = geometry;
    gen.levels = [{ geometry: geometry, distance: 0, ratio: 1 }];
  }

  function generateLevel(targetRatio, distance){
    if(!gen.baseGeometry) return null;
    const simplified = simplifyByClustering(gen.baseGeometry, targetRatio);
    const level = { geometry: simplified, distance: distance, ratio: targetRatio };
    gen.levels.push(level);
    gen.levels.sort(function(a, b){ return a.distance - b.distance; });
    return level;
  }

  function simplifyByClustering(geometry, ratio){
    const positions = geometry.positions;
    const normals = geometry.normals;
    const uvs = geometry.uvs;
    const indices = geometry.indices;
    const vertCount = positions.length / 3;
    const targetCount = Math.max(4, Math.floor(vertCount * ratio));
    const cellSize = Math.pow(vertCount / targetCount, 1/3) * 0.1;

    const clusters = {};
    const clusterList = [];
    const remap = new Int32Array(vertCount);

    for(let i = 0; i < vertCount; i++){
      const cx = Math.floor(positions[i*3] / cellSize);
      const cy = Math.floor(positions[i*3+1] / cellSize);
      const cz = Math.floor(positions[i*3+2] / cellSize);
      const key = cx + '_' + cy + '_' + cz;
      if(!clusters[key]){
        clusters[key] = { index: clusterList.length, positions: [], normals: [], uvs: [], count: 0 };
        clusterList.push(clusters[key]);
      }
      const c = clusters[key];
      c.positions.push([positions[i*3], positions[i*3+1], positions[i*3+2]]);
      if(normals) c.normals.push([normals[i*3], normals[i*3+1], normals[i*3+2]]);
      if(uvs) c.uvs.push([uvs[i*2], uvs[i*2+1]]);
      c.count++;
      remap[i] = c.index;
    }

    const newPositions = new Float32Array(clusterList.length * 3);
    const newNormals = normals ? new Float32Array(clusterList.length * 3) : null;
    const newUVs = uvs ? new Float32Array(clusterList.length * 2) : null;

    for(let i = 0; i < clusterList.length; i++){
      const c = clusterList[i];
      let px = 0, py = 0, pz = 0;
      for(let j = 0; j < c.positions.length; j++){
        px += c.positions[j][0]; py += c.positions[j][1]; pz += c.positions[j][2];
      }
      newPositions[i*3] = px / c.count;
      newPositions[i*3+1] = py / c.count;
      newPositions[i*3+2] = pz / c.count;

      if(newNormals){
        let nx = 0, ny = 0, nz = 0;
        for(let j = 0; j < c.normals.length; j++){
          nx += c.normals[j][0]; ny += c.normals[j][1]; nz += c.normals[j][2];
        }
        const l = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
        newNormals[i*3] = nx / l;
        newNormals[i*3+1] = ny / l;
        newNormals[i*3+2] = nz / l;
      }
      if(newUVs && c.uvs.length > 0){
        newUVs[i*2] = c.uvs[0][0];
        newUVs[i*2+1] = c.uvs[0][1];
      }
    }

    const indexSet = {};
    const newIndices = [];
    for(let i = 0; i < indices.length; i += 3){
      const a = remap[indices[i]];
      const b = remap[indices[i+1]];
      const c = remap[indices[i+2]];
      if(a === b || b === c || a === c) continue;
      const key = a < b ? (a < c ? a + '_' + b + '_' + c : c + '_' + a + '_' + b) : (b < c ? b + '_' + c + '_' + a : c + '_' + a + '_' + b);
      if(!indexSet[key]){
        indexSet[key] = true;
        newIndices.push(a, b, c);
      }
    }

    return {
      positions: newPositions,
      normals: newNormals,
      uvs: newUVs,
      indices: new Uint16Array(newIndices),
      vertexCount: clusterList.length,
      indexCount: newIndices.length
    };
  }

  function getLevel(distance){
    let current = gen.levels[0];
    for(let i = 0; i < gen.levels.length; i++){
      if(distance >= gen.levels[i].distance) current = gen.levels[i];
    }
    return current;
  }

  function getLevelCount(){
    return gen.levels.length;
  }

  function getStatistics(){
    const stats = [];
    for(let i = 0; i < gen.levels.length; i++){
      const l = gen.levels[i];
      stats.push({
        level: i,
        distance: l.distance,
        ratio: l.ratio,
        vertices: l.geometry.vertexCount,
        triangles: l.geometry.indexCount / 3
      });
    }
    return stats;
  }

  function clear(){
    gen.levels = [];
    gen.baseGeometry = null;
  }

  return { setBaseGeometry, generateLevel, getLevel, getLevelCount, getStatistics, clear, gen };
}

/* ===== 场景序列化系统=====
   支持: JSON场景格式 / 资源引用 / 增量保存 / 版本控制
*/
const SceneFormatVersion = 1;

function serializeScene(scene, options){
  const data = {
    version: SceneFormatVersion,
    type: 'MrHuaScene',
    metadata: {
      generator: 'orb_renderer.js',
      timestamp: Date.now(),
      units: (options && options.units) || 'meters'
    },
    nodes: [],
    resources: [],
    animations: [],
    materials: [],
    environment: {
      background: (scene && scene.background) || [0.1, 0.1, 0.15],
      ambient: (scene && scene.ambient) || [0.2, 0.2, 0.2],
      fog: (scene && scene.fog) || null
    }
  };

  function serializeNode(node, parentIndex){
    const n = {
      name: node.name || 'node_' + parentIndex,
      type: node.type !== undefined ? node.type : 6,
      position: node.position ? [node.position[0], node.position[1], node.position[2]] : [0,0,0],
      rotation: node.rotation ? [node.rotation[0], node.rotation[1], node.rotation[2], node.rotation[3]] : [0,0,0,1],
      scale: node.scale ? [node.scale[0], node.scale[1], node.scale[2]] : [1,1,1],
      children: [],
      components: {}
    };

    if(node.mesh){
      n.components.mesh = {
        geometry: node.mesh.geometry ? 'geometry_' + node.mesh.geometry.id : null,
        material: node.mesh.material ? node.mesh.material.name : 'default'
      };
    }
    if(node.light){
      n.components.light = {
        lightType: node.light.type,
        color: [node.light.color[0], node.light.color[1], node.light.color[2]],
        intensity: node.light.intensity,
        range: node.light.range || 0,
        angle: node.light.angle || 0
      };
    }
    if(node.camera){
      n.components.camera = {
        fov: node.camera.fov || 60,
        near: node.camera.near || 0.1,
        far: node.camera.far || 1000,
        aspect: node.camera.aspect || 1
      };
    }

    if(node.children){
      for(let i = 0; i < node.children.length; i++){
        n.children.push(serializeNode(node.children[i], i));
      }
    }
    return n;
  }

  if(scene && scene.root){
    data.nodes.push(serializeNode(scene.root, 0));
  }

  if(options && options.pretty){
    return JSON.stringify(data, null, 2);
  }
  return JSON.stringify(data);
}

function deserializeScene(jsonString){
  const data = JSON.parse(jsonString);
  if(data.type !== 'MrHuaScene'){
    throw new Error('无效的场景格式 ' + data.type);
  }
  if(data.version > SceneFormatVersion){
    console.warn('[Scene] 场景版本过高: ' + data.version + ' > ' + SceneFormatVersion);
  }

  const scene = createScene();
  scene.background = data.environment.background;
  scene.ambient = data.environment.ambient;

  function deserializeNode(nodeData){
    const node = createSceneNode(nodeData.type, nodeData.name);
    node.position = [nodeData.position[0], nodeData.position[1], nodeData.position[2]];
    node.rotation = [nodeData.rotation[0], nodeData.rotation[1], nodeData.rotation[2], nodeData.rotation[3]];
    node.scale = [nodeData.scale[0], nodeData.scale[1], nodeData.scale[2]];

    if(nodeData.components){
      if(nodeData.components.light){
        const lc = nodeData.components.light;
        node.light = createLight(lc.lightType, {
          color: lc.color,
          intensity: lc.intensity,
          range: lc.range
        });
      }
      if(nodeData.components.camera){
        const cc = nodeData.components.camera;
        node.camera = createPerspectiveCamera(cc.fov, cc.aspect, cc.near, cc.far);
      }
    }

    for(let i = 0; i < nodeData.children.length; i++){
      nodeAddChild(node, deserializeNode(nodeData.children[i]));
    }
    return node;
  }

  for(let i = 0; i < data.nodes.length; i++){
    nodeAddChild(scene, deserializeNode(data.nodes[i]));
  }

  return scene;
}

function validateSceneData(data){
  const errors = [];
  const warnings = [];
  if(!data.version) errors.push('缺少版本号');
  if(data.type !== 'MrHuaScene') errors.push('类型不匹配');
  if(!data.nodes) errors.push('缺少节点数据');
  if(data.nodes && data.nodes.length === 0) warnings.push('场景为空');

  function validateNode(node, path){
    if(!node.name) warnings.push(path + ': 缺少名称');
    if(!node.position) errors.push(path + ': 缺少位置');
    if(node.position && node.position.length !== 3) errors.push(path + ': 位置维度错误');
    if(node.children){
      for(let i = 0; i < node.children.length; i++){
        validateNode(node.children[i], path + '.' + node.children[i].name);
      }
    }
  }

  if(data.nodes){
    for(let i = 0; i < data.nodes.length; i++){
      validateNode(data.nodes[i], 'root[' + i + ']');
    }
  }

  return { valid: errors.length === 0, errors: errors, warnings: warnings };
}

function mergeScenes(sceneA, sceneB){
  const merged = createScene();
  merged.background = sceneA.background || [0,0,0];
  if(sceneA.root && sceneA.root.children){
    for(let i = 0; i < sceneA.root.children.length; i++){
      nodeAddChild(merged, sceneA.root.children[i]);
    }
  }
  if(sceneB.root && sceneB.root.children){
    for(let i = 0; i < sceneB.root.children.length; i++){
      nodeAddChild(merged, sceneB.root.children[i]);
    }
  }
  return merged;
}

function cloneSceneNode(node){
  const clone = createSceneNode(node.type, node.name + '_copy');
  clone.position = [node.position[0], node.position[1], node.position[2]];
  clone.rotation = [node.rotation[0], node.rotation[1], node.rotation[2], node.rotation[3]];
  clone.scale = [node.scale[0], node.scale[1], node.scale[2]];
  if(node.children){
    for(let i = 0; i < node.children.length; i++){
      nodeAddChild(clone, cloneSceneNode(node.children[i]));
    }
  }
  return clone;
}
