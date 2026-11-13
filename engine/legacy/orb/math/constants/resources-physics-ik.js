
/* ===== 资源管理系统 ===== */
function createResourceManager(){
  const rm = {
    _cache: new Map(),
    _loading: new Map(),
    _loaders: {},
    _baseUrl: '',
    maxCacheSize: 100,
  };
  function registerLoader(type, loader){ rm._loaders[type] = loader; }
  function setBaseUrl(url){ rm._baseUrl = url; }
  function getCacheKey(type, url){ return type + ':' + url; }
  async function load(type, url, options){
    const key = getCacheKey(type, url);
    if(rm._cache.has(key)) return rm._cache.get(key);
    if(rm._loading.has(key)) return rm._loading.get(key);
    const loader = rm._loaders[type];
    if(!loader) throw new Error('未知资源类型: ' + type);
    const fullUrl = rm._baseUrl + url;
    const promise = loader(fullUrl, options).then((resource)=>{
      rm._cache.set(key, resource);
      rm._loading.delete(key);
      if(rm._cache.size > rm.maxCacheSize){
        const firstKey = rm._cache.keys().next().value;
        rm._cache.delete(firstKey);
      }
      return resource;
    }).catch((e)=>{
      rm._loading.delete(key);
      throw e;
    });
    rm._loading.set(key, promise);
    return promise;
  }
  function get(type, url){
    const key = getCacheKey(type, url);
    return rm._cache.get(key) || null;
  }
  function has(type, url){
    const key = getCacheKey(type, url);
    return rm._cache.has(key);
  }
  function release(type, url){
    const key = getCacheKey(type, url);
    const resource = rm._cache.get(key);
    if(resource && resource.dispose) resource.dispose();
    rm._cache.delete(key);
  }
  function clear(){
    for(const [key, resource] of rm._cache){
      if(resource && resource.dispose) resource.dispose();
    }
    rm._cache.clear();
    rm._loading.clear();
  }
  function getCacheInfo(){
    return {
      cached: rm._cache.size,
      loading: rm._loading.size,
      maxSize: rm.maxCacheSize,
      types: Object.keys(rm._loaders),
    };
  }
  registerLoader('pmx', async (url)=>{
    const resp = await fetch(url);
    if(!resp.ok) throw new Error('PMX加载失败: '+resp.status);
    const buf = await resp.arrayBuffer();
    return parsePMX(buf);
  });
  registerLoader('pmd', async (url)=>{
    const resp = await fetch(url);
    if(!resp.ok) throw new Error('PMD加载失败: '+resp.status);
    const buf = await resp.arrayBuffer();
    return parsePMD(buf);
  });
  registerLoader('vmd', async (url)=>{
    const resp = await fetch(url);
    if(!resp.ok) throw new Error('VMD加载失败: '+resp.status);
    const buf = await resp.arrayBuffer();
    return parseVMD(buf);
  });
  registerLoader('texture', async (url, gl)=>{
    return new Promise((resolve,reject)=>{
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = ()=>{
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.generateMipmap(gl.TEXTURE_2D);
        resolve(tex);
      };
      img.onerror = ()=>reject(new Error('纹理加载失败: '+url));
      img.src = url;
    });
  });
  registerLoader('json', async (url)=>{
    const resp = await fetch(url);
    if(!resp.ok) throw new Error('JSON加载失败: '+resp.status);
    return resp.json();
  });
  registerLoader('text', async (url)=>{
    const resp = await fetch(url);
    if(!resp.ok) throw new Error('文本加载失败: '+resp.status);
    return resp.text();
  });
  console.log('[ResourceManager] 创建完成 内置加载器: pmx,pmd,vmd,texture,json,text');
  return { load, get, has, release, clear, registerLoader, setBaseUrl, getCacheInfo, rm };
}

/* ===== 物理系统（简化刚体动力学） ===== */
const BodyType = { STATIC: 0, DYNAMIC: 1, KINEMATIC: 2 };
const ShapeType = { SPHERE: 0, BOX: 1, CAPSULE: 2, PLANE: 3, MESH: 4 };
function createRigidBody(options){
  const opt = options || {};
  return {
    type: opt.type !== undefined ? opt.type : BodyType.DYNAMIC,
    shape: opt.shape || ShapeType.SPHERE,
    position: opt.position ? opt.position.slice() : [0,0,0],
    rotation: opt.rotation ? opt.rotation.slice() : [0,0,0,1],
    linearVelocity: [0,0,0],
    angularVelocity: [0,0,0],
    force: [0,0,0],
    torque: [0,0,0],
    mass: opt.mass !== undefined ? opt.mass : 1,
    invMass: opt.mass ? 1/opt.mass : 0,
    inertia: opt.inertia ? opt.inertia.slice() : [1,1,1],
    invInertia: opt.inertia ? [1/opt.inertia[0],1/opt.inertia[1],1/opt.inertia[2]] : [0,0,0],
    restitution: opt.restitution !== undefined ? opt.restitution : 0.5,
    friction: opt.friction !== undefined ? opt.friction : 0.5,
    linearDamping: opt.linearDamping !== undefined ? opt.linearDamping : 0.01,
    angularDamping: opt.angularDamping !== undefined ? opt.angularDamping : 0.01,
    radius: opt.radius || 0.5,
    halfExtents: opt.halfExtents ? opt.halfExtents.slice() : [0.5,0.5,0.5],
    height: opt.height || 1,
    awake: true,
    sleepThreshold: 0.1,
    sleepTimer: 0,
    userData: {},
    _collisionFilter: opt.collisionFilter || 0xFFFF,
    _collisionMask: opt.collisionMask || 0xFFFF,
  };
}
function createPhysicsWorld(options){
  const opt = options || {};
  const world = {
    bodies: [],
    gravity: opt.gravity ? opt.gravity.slice() : [0,-9.8,0],
    timeStep: opt.timeStep || 1/60,
    maxSubSteps: opt.maxSubSteps || 4,
    _accumulator: 0,
    _broadphase: 'brute',
    _contactPairs: [],
  };
  function addBody(body){ world.bodies.push(body); return body; }
  function removeBody(body){
    const idx = world.bodies.indexOf(body);
    if(idx >= 0) world.bodies.splice(idx,1);
    return body;
  }
  function applyForce(body, force, point){
    if(body.type !== BodyType.DYNAMIC) return;
    body.force[0] += force[0]; body.force[1] += force[1]; body.force[2] += force[2];
    if(point){
      const r=[point[0]-body.position[0],point[1]-body.position[1],point[2]-body.position[2]];
      body.torque[0] += r[1]*force[2]-r[2]*force[1];
      body.torque[1] += r[2]*force[0]-r[0]*force[2];
      body.torque[2] += r[0]*force[1]-r[1]*force[0];
    }
    body.awake = true;
  }
  function applyImpulse(body, impulse, point){
    if(body.type !== BodyType.DYNAMIC) return;
    body.linearVelocity[0] += impulse[0]*body.invMass;
    body.linearVelocity[1] += impulse[1]*body.invMass;
    body.linearVelocity[2] += impulse[2]*body.invMass;
    if(point){
      const r=[point[0]-body.position[0],point[1]-body.position[1],point[2]-body.position[2]];
      const t=[r[1]*impulse[2]-r[2]*impulse[1], r[2]*impulse[0]-r[0]*impulse[2], r[0]*impulse[1]-r[1]*impulse[0]];
      body.angularVelocity[0] += t[0]*body.invInertia[0];
      body.angularVelocity[1] += t[1]*body.invInertia[1];
      body.angularVelocity[2] += t[2]*body.invInertia[2];
    }
    body.awake = true;
  }
  function sphereSphereCollision(a, b){
    const dx=b.position[0]-a.position[0], dy=b.position[1]-a.position[1], dz=b.position[2]-a.position[2];
    const dist=Math.sqrt(dx*dx+dy*dy+dz*dz);
    const minDist=a.radius+b.radius;
    if(dist >= minDist) return null;
    const nx=dist>0?dx/dist:1, ny=dist>0?dy/dist:0, nz=dist>0?dz/dist:0;
    return { normal:[nx,ny,nz], penetration:minDist-dist, contactPoint:[a.position[0]+nx*a.radius, a.position[1]+ny*a.radius, a.position[2]+nz*a.radius] };
  }
  function boxBoxCollision(a, b){
    const dx=b.position[0]-a.position[0], dy=b.position[1]-a.position[1], dz=b.position[2]-a.position[2];
    const overlapX=a.halfExtents[0]+b.halfExtents[0]-Math.abs(dx);
    const overlapY=a.halfExtents[1]+b.halfExtents[1]-Math.abs(dy);
    const overlapZ=a.halfExtents[2]+b.halfExtents[2]-Math.abs(dz);
    if(overlapX<=0||overlapY<=0||overlapZ<=0) return null;
    let normal=[0,0,0], penetration=0;
    if(overlapX<overlapY&&overlapX<overlapZ){ normal=[dx>0?1:-1,0,0]; penetration=overlapX; }
    else if(overlapY<overlapZ){ normal=[0,dy>0?1:-1,0]; penetration=overlapY; }
    else { normal=[0,0,dz>0?1:-1]; penetration=overlapZ; }
    return { normal, penetration, contactPoint:[(a.position[0]+b.position[0])/2,(a.position[1]+b.position[1])/2,(a.position[2]+b.position[2])/2] };
  }
  function detectCollision(a, b){
    if(a.shape===ShapeType.SPHERE && b.shape===ShapeType.SPHERE) return sphereSphereCollision(a,b);
    if(a.shape===ShapeType.BOX && b.shape===ShapeType.BOX) return boxBoxCollision(a,b);
    if(a.shape===ShapeType.SPHERE && b.shape===ShapeType.BOX){
      const closest=[Math.max(b.position[0]-b.halfExtents[0],Math.min(a.position[0],b.position[0]+b.halfExtents[0])),
                     Math.max(b.position[1]-b.halfExtents[1],Math.min(a.position[1],b.position[1]+b.halfExtents[1])),
                     Math.max(b.position[2]-b.halfExtents[2],Math.min(a.position[2],b.position[2]+b.halfExtents[2]))];
      const dx=a.position[0]-closest[0], dy=a.position[1]-closest[1], dz=a.position[2]-closest[2];
      const dist=Math.sqrt(dx*dx+dy*dy+dz*dz);
      if(dist>=a.radius) return null;
      const nx=dist>0?dx/dist:0, ny=dist>0?dy/dist:1, nz=dist>0?dz/dist:0;
      return { normal:[nx,ny,nz], penetration:a.radius-dist, contactPoint:closest };
    }
    if(a.shape===ShapeType.BOX && b.shape===ShapeType.SPHERE){
      const c = detectCollision(b,a);
      if(c) c.normal = [-c.normal[0],-c.normal[1],-c.normal[2]];
      return c;
    }
    return null;
  }
  function resolveCollision(a, b, contact){
    if(a.type===BodyType.STATIC && b.type===BodyType.STATIC) return;
    const rv=[b.linearVelocity[0]-a.linearVelocity[0], b.linearVelocity[1]-a.linearVelocity[1], b.linearVelocity[2]-a.linearVelocity[2]];
    const velAlongNormal=rv[0]*contact.normal[0]+rv[1]*contact.normal[1]+rv[2]*contact.normal[2];
    if(velAlongNormal > 0) return;
    const e=Math.min(a.restitution, b.restitution);
    const j=-(1+e)*velAlongNormal/(a.invMass+b.invMass);
    const impulse=[j*contact.normal[0], j*contact.normal[1], j*contact.normal[2]];
    if(a.type===BodyType.DYNAMIC){ a.linearVelocity[0]-=impulse[0]*a.invMass; a.linearVelocity[1]-=impulse[1]*a.invMass; a.linearVelocity[2]-=impulse[2]*a.invMass; a.awake=true; }
    if(b.type===BodyType.DYNAMIC){ b.linearVelocity[0]+=impulse[0]*b.invMass; b.linearVelocity[1]+=impulse[1]*b.invMass; b.linearVelocity[2]+=impulse[2]*b.invMass; b.awake=true; }
    const percent=0.8, slop=0.01;
    const correction=Math.max(contact.penetration-slop,0)/(a.invMass+b.invMass)*percent;
    if(a.type===BodyType.DYNAMIC){ a.position[0]-=correction*contact.normal[0]*a.invMass; a.position[1]-=correction*contact.normal[1]*a.invMass; a.position[2]-=correction*contact.normal[2]*a.invMass; }
    if(b.type===BodyType.DYNAMIC){ b.position[0]+=correction*contact.normal[0]*b.invMass; b.position[1]+=correction*contact.normal[1]*b.invMass; b.position[2]+=correction*contact.normal[2]*b.invMass; }
  }
  function step(dt){
    world._accumulator += dt;
    let steps = 0;
    while(world._accumulator >= world.timeStep && steps < world.maxSubSteps){
      stepInternal(world.timeStep);
      world._accumulator -= world.timeStep;
      steps++;
    }
  }
  function stepInternal(dt){
    for(const body of world.bodies){
      if(body.type !== BodyType.DYNAMIC || !body.awake) continue;
      body.force[0] += world.gravity[0]*body.mass;
      body.force[1] += world.gravity[1]*body.mass;
      body.force[2] += world.gravity[2]*body.mass;
      body.linearVelocity[0] += body.force[0]*body.invMass*dt;
      body.linearVelocity[1] += body.force[1]*body.invMass*dt;
      body.linearVelocity[2] += body.force[2]*body.invMass*dt;
      body.angularVelocity[0] += body.torque[0]*body.invInertia[0]*dt;
      body.angularVelocity[1] += body.torque[1]*body.invInertia[1]*dt;
      body.angularVelocity[2] += body.torque[2]*body.invInertia[2]*dt;
      const ld=1-body.linearDamping, ad=1-body.angularDamping;
      body.linearVelocity[0]*=ld; body.linearVelocity[1]*=ld; body.linearVelocity[2]*=ld;
      body.angularVelocity[0]*=ad; body.angularVelocity[1]*=ad; body.angularVelocity[2]*=ad;
      body.position[0]+=body.linearVelocity[0]*dt;
      body.position[1]+=body.linearVelocity[1]*dt;
      body.position[2]+=body.linearVelocity[2]*dt;
      body.force[0]=body.force[1]=body.force[2]=0;
      body.torque[0]=body.torque[1]=body.torque[2]=0;
      const speed=Math.sqrt(body.linearVelocity[0]**2+body.linearVelocity[1]**2+body.linearVelocity[2]**2);
      if(speed < body.sleepThreshold){ body.sleepTimer += dt; if(body.sleepTimer > 0.5) body.awake = false; }
      else { body.sleepTimer = 0; body.awake = true; }
    }
    for(let i=0;i<world.bodies.length;i++){
      for(let j=i+1;j<world.bodies.length;j++){
        const a=world.bodies[i], b=world.bodies[j];
        if(a.type===BodyType.STATIC && b.type===BodyType.STATIC) continue;
        if((a._collisionFilter & b._collisionMask)===0) continue;
        const contact = detectCollision(a,b);
        if(contact) resolveCollision(a,b,contact);
      }
    }
  }
  function clear(){ world.bodies.length = 0; world._accumulator = 0; }
  console.log('[PhysicsWorld] 创建完成 bodies=' + world.bodies.length + ' gravity=' + world.gravity);
  return { addBody, removeBody, applyForce, applyImpulse, step, clear, detectCollision, world };
}

/* ===== IK 反向运动学系统 ===== */
function createIKSolver(boneSystem){
  const solver = {
    boneSystem: boneSystem,
    iterations: 20,
    tolerance: 0.001,
    damping: 0.5,
    _chains: [],
  };
  function createChain(rootBoneIndex, endBoneIndex, targetPosition){
    const bones = [];
    let idx = endBoneIndex;
    while(idx >= 0 && idx !== rootBoneIndex){
      bones.unshift(idx);
      idx = boneSystem.bones[idx].parent;
    }
    if(idx === rootBoneIndex) bones.unshift(rootBoneIndex);
    return {
      root: rootBoneIndex,
      end: endBoneIndex,
      bones: bones,
      target: targetPosition ? targetPosition.slice() : [0,0,0],
      poleTarget: null,
      enabled: true,
      weight: 1,
    };
  }
  function addChain(rootBoneIndex, endBoneIndex, targetPosition){
    const chain = createChain(rootBoneIndex, endBoneIndex, targetPosition);
    solver._chains.push(chain);
    return chain;
  }
  function removeChain(chain){
    const idx = solver._chains.indexOf(chain);
    if(idx >= 0) solver._chains.splice(idx,1);
  }
  function getBoneWorldPosition(boneIndex, palette, out){
    const m = palette;
    const off = boneIndex*16;
    out[0] = m[off+12];
    out[1] = m[off+13];
    out[2] = m[off+14];
    return out;
  }
  function solveFABRIK(chain, palette){
    const bones = chain.bones;
    const n = bones.length;
    if(n < 2) return;
    const positions = new Array(n);
    const lengths = new Array(n-1);
    for(let i=0;i<n;i++){
      positions[i] = getBoneWorldPosition(bones[i], palette, [0,0,0]);
    }
    for(let i=0;i<n-1;i++){
      lengths[i] = V3.dist(positions[i], positions[i+1]);
    }
    const target = chain.target;
    const origin = positions[0].slice();
    for(let iter=0; iter<solver.iterations; iter++){
      let dist = V3.dist(positions[n-1], target);
      if(dist < solver.tolerance) break;
      positions[n-1] = target.slice();
      for(let i=n-2;i>=0;i--){
        const dir = [positions[i][0]-positions[i+1][0], positions[i][1]-positions[i+1][1], positions[i][2]-positions[i+1][2]];
        const l = Math.sqrt(dir[0]**2+dir[1]**2+dir[2]**2)||1;
        positions[i] = [positions[i+1][0]+dir[0]/l*lengths[i], positions[i+1][1]+dir[1]/l*lengths[i], positions[i+1][2]+dir[2]/l*lengths[i]];
      }
      positions[0] = origin.slice();
      for(let i=1;i<n;i++){
        const dir = [positions[i][0]-positions[i-1][0], positions[i][1]-positions[i-1][1], positions[i][2]-positions[i-1][2]];
        const l = Math.sqrt(dir[0]**2+dir[1]**2+dir[2]**2)||1;
        positions[i] = [positions[i-1][0]+dir[0]/l*lengths[i-1], positions[i-1][1]+dir[1]/l*lengths[i-1], positions[i-1][2]+dir[2]/l*lengths[i-1]];
      }
    }
    return positions;
  }
  function solveCCD(chain, poseRotations){
    const bones = chain.bones;
    const n = bones.length;
    if(n < 2) return;
    const target = chain.target;
    for(let iter=0; iter<solver.iterations; iter++){
      const endPos = getBoneWorldPosition(bones[n-1], boneSystem.palette, [0,0,0]);
      let dist = V3.dist(endPos, target);
      if(dist < solver.tolerance) break;
      for(let i=n-2;i>=0;i--){
        const bonePos = getBoneWorldPosition(bones[i], boneSystem.palette, [0,0,0]);
        const toEnd = [endPos[0]-bonePos[0], endPos[1]-bonePos[1], endPos[2]-bonePos[2]];
        const toTarget = [target[0]-bonePos[0], target[1]-bonePos[1], target[2]-bonePos[2]];
        const cross = [toEnd[1]*toTarget[2]-toEnd[2]*toTarget[1], toEnd[2]*toTarget[0]-toEnd[0]*toTarget[2], toEnd[0]*toTarget[1]-toEnd[1]*toTarget[0]];
        const dot = toEnd[0]*toTarget[0]+toEnd[1]*toTarget[1]+toEnd[2]*toTarget[2];
        const l1=Math.sqrt(toEnd[0]**2+toEnd[1]**2+toEnd[2]**2)||1;
        const l2=Math.sqrt(toTarget[0]**2+toTarget[1]**2+toTarget[2]**2)||1;
        const cosAngle = Math.max(-1, Math.min(1, dot/(l1*l2)));
        const angle = Math.acos(cosAngle) * solver.damping;
        if(angle < 0.0001) continue;
        const cl=Math.sqrt(cross[0]**2+cross[1]**2+cross[2]**2)||1;
        const axis=[cross[0]/cl, cross[1]/cl, cross[2]/cl];
        const halfAngle=angle*0.5;
        const s=Math.sin(halfAngle);
        const deltaQ=[axis[0]*s, axis[1]*s, axis[2]*s, Math.cos(halfAngle)];
        const curQ = poseRotations[bones[i]] || [0,0,0,1];
        const newQ=[0,0,0,1];
        Q.mult(newQ, deltaQ, curQ);
        poseRotations[bones[i]] = newQ;
        boneSystem.computePalette(poseRotations, null);
      }
    }
  }
  function solve(poseRotations){
    for(const chain of solver._chains){
      if(!chain.enabled) continue;
      solveCCD(chain, poseRotations);
    }
  }
  function clear(){ solver._chains.length = 0; }
  console.log('[IKSolver] 创建完成 bones=' + boneSystem.bones.length);
  return { addChain, removeChain, solve, clear, solver };
}