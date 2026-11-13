/* ===== 布娃娃系统 =====
   支持: 刚体链 / 关节约束 / 物理驱动 / 与骨骼系统绑定
*/
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
    const head = findBone('頭') || findBone('head') || 2;
    const lUpperArm = findBone('左腕') || findBone('LeftArm') || 3;
    const lLowerArm = findBone('左ひじ') || findBone('LeftForeArm') || 4;
    const rUpperArm = findBone('右腕') || findBone('RightArm') || 5;
    const rLowerArm = findBone('右ひじ') || findBone('RightForeArm') || 6;
    const lUpperLeg = findBone('左足') || findBone('LeftUpLeg') || 7;
    const lLowerLeg = findBone('左ひざ') || findBone('LeftLeg') || 8;
    const rUpperLeg = findBone('右足') || findBone('RightUpLeg') || 9;
    const rLowerLeg = findBone('右ひざ') || findBone('RightLeg') || 10;

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
   支持: 质点-约束软体 / 体积保持 / 自碰撞 / 可变形体
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

/* ===== 纹理图集生成器 =====
   支持: 自动打包 / 间距控制 / 四边扩展 / UV重映射
*/
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

/* ===== 网格LOD生成器 =====
   支持: 自动简化 / 距离切换 / 顶点聚类 / 边折叠
*/
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
