/* ===== 布料模拟系统 =====
   基于质点-弹簧系统, 支持结构/剪切/弯曲约束, 风力, 碰撞
*/
function createClothSimulation(width, height, options){
  const cloth = {
    width: width,
    height: height,
    particles: [],
    constraints: [],
    faces: [],
    positions: null,
    normals: null,
    indices: null,
    gravity: (options && options.gravity) || [0, -9.8, 0],
    wind: (options && options.wind) || [0, 0, 0],
    damping: (options && options.damping) || 0.99,
    stiffness: (options && options.stiffness) || 0.95,
    iterations: (options && options.iterations) || 5,
    thickness: (options && options.thickness) || 0.1,
    friction: (options && options.friction) || 0.8,
    _pinned: {},
    _colliders: []
  };

  const total = width * height;
  cloth.positions = new Float32Array(total * 3);
  cloth.normals = new Float32Array(total * 3);
  cloth.velocities = new Float32Array(total * 3);
  cloth.previous = new Float32Array(total * 3);

  function idx(x, y){ return y * width + x; }

  function init(startX, startY, startZ, sizeX, sizeZ){
    const sx = sizeX || 2, sz = sizeZ || 2;
    for(let y = 0; y < height; y++){
      for(let x = 0; x < width; x++){
        const i = idx(x, y);
        const px = startX + (x / (width - 1) - 0.5) * sx;
        const py = startY || 2;
        const pz = startZ + (y / (height - 1) - 0.5) * sz;
        cloth.positions[i*3] = px;
        cloth.positions[i*3+1] = py;
        cloth.positions[i*3+2] = pz;
        cloth.previous[i*3] = px;
        cloth.previous[i*3+1] = py;
        cloth.previous[i*3+2] = pz;
        cloth.velocities[i*3] = 0;
        cloth.velocities[i*3+1] = 0;
        cloth.velocities[i*3+2] = 0;
        cloth.particles.push({ x: x, y: y, pinned: false, mass: 1 });
      }
    }

    for(let y = 0; y < height; y++){
      for(let x = 0; x < width; x++){
        const i = idx(x, y);
        if(x < width - 1){
          addConstraint(i, idx(x+1, y), 'structural');
        }
        if(y < height - 1){
          addConstraint(i, idx(x, y+1), 'structural');
        }
        if(x < width - 1 && y < height - 1){
          addConstraint(i, idx(x+1, y+1), 'shear');
          addConstraint(idx(x+1, y), idx(x, y+1), 'shear');
        }
        if(x < width - 2){
          addConstraint(i, idx(x+2, y), 'bend');
        }
        if(y < height - 2){
          addConstraint(i, idx(x, y+2), 'bend');
        }
      }
    }

    const indexCount = (width - 1) * (height - 1) * 6;
    cloth.indices = new Uint16Array(indexCount);
    let fi = 0;
    for(let y = 0; y < height - 1; y++){
      for(let x = 0; x < width - 1; x++){
        const i0 = idx(x, y), i1 = idx(x+1, y), i2 = idx(x, y+1), i3 = idx(x+1, y+1);
        cloth.indices[fi++] = i0; cloth.indices[fi++] = i2; cloth.indices[fi++] = i1;
        cloth.indices[fi++] = i1; cloth.indices[fi++] = i2; cloth.indices[fi++] = i3;
      }
    }

    computeNormals();
  }

  function addConstraint(p1, p2, type){
    const dx = cloth.positions[p1*3] - cloth.positions[p2*3];
    const dy = cloth.positions[p1*3+1] - cloth.positions[p2*3+1];
    const dz = cloth.positions[p1*3+2] - cloth.positions[p2*3+2];
    const rest = Math.sqrt(dx*dx + dy*dy + dz*dz);
    cloth.constraints.push({
      p1: p1, p2: p2, rest: rest, type: type || 'structural',
      stiffness: type === 'bend' ? cloth.stiffness * 0.3 : cloth.stiffness
    });
  }

  function pin(x, y){
    const i = idx(x, y);
    cloth._pinned[i] = true;
    cloth.particles[i].pinned = true;
  }

  function unpin(x, y){
    const i = idx(x, y);
    delete cloth._pinned[i];
    cloth.particles[i].pinned = false;
  }

  function setPinnedPosition(x, y, px, py, pz){
    const i = idx(x, y);
    cloth.positions[i*3] = px;
    cloth.positions[i*3+1] = py;
    cloth.positions[i*3+2] = pz;
    cloth.previous[i*3] = px;
    cloth.previous[i*3+1] = py;
    cloth.previous[i*3+2] = pz;
  }

  function addSphereCollider(center, radius){
    cloth._colliders.push({ type: 'sphere', center: [center[0],center[1],center[2]], radius: radius });
  }

  function addPlaneCollider(normal, point){
    cloth._colliders.push({ type: 'plane', normal: [normal[0],normal[1],normal[2]], point: [point[0],point[1],point[2]] });
  }

  function addBoxCollider(min, max){
    cloth._colliders.push({ type: 'box', min: [min[0],min[1],min[2]], max: [max[0],max[1],max[2]] });
  }

  function clearColliders(){
    cloth._colliders.length = 0;
  }

  function resolveCollisions(i){
    const px = cloth.positions[i*3], py = cloth.positions[i*3+1], pz = cloth.positions[i*3+2];
    for(let c = 0; c < cloth._colliders.length; c++){
      const col = cloth._colliders[c];
      if(col.type === 'sphere'){
        const dx = px - col.center[0], dy = py - col.center[1], dz = pz - col.center[2];
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        const minDist = col.radius + cloth.thickness;
        if(dist < minDist && dist > 0.001){
          const push = (minDist - dist) / dist;
          cloth.positions[i*3] += dx * push;
          cloth.positions[i*3+1] += dy * push;
          cloth.positions[i*3+2] += dz * push;
        }
      } else if(col.type === 'plane'){
        const d = px*col.normal[0] + py*col.normal[1] + pz*col.normal[2] -
                  (col.point[0]*col.normal[0] + col.point[1]*col.normal[1] + col.point[2]*col.normal[2]);
        if(d < cloth.thickness){
          const push = cloth.thickness - d;
          cloth.positions[i*3] += col.normal[0] * push;
          cloth.positions[i*3+1] += col.normal[1] * push;
          cloth.positions[i*3+2] += col.normal[2] * push;
        }
      } else if(col.type === 'box'){
        const cx = Math.max(col.min[0], Math.min(px, col.max[0]));
        const cy = Math.max(col.min[1], Math.min(py, col.max[1]));
        const cz = Math.max(col.min[2], Math.min(pz, col.max[2]));
        const dx = px - cx, dy = py - cy, dz = pz - cz;
        const distSq = dx*dx + dy*dy + dz*dz;
        if(distSq < cloth.thickness * cloth.thickness && distSq > 0.001){
          const dist = Math.sqrt(distSq);
          const push = (cloth.thickness - dist) / dist;
          cloth.positions[i*3] += dx * push;
          cloth.positions[i*3+1] += dy * push;
          cloth.positions[i*3+2] += dz * push;
        }
      }
    }
  }

  function computeNormals(){
    for(let i = 0; i < cloth.normals.length; i++) cloth.normals[i] = 0;
    for(let f = 0; f < cloth.indices.length; f += 3){
      const i0 = cloth.indices[f], i1 = cloth.indices[f+1], i2 = cloth.indices[f+2];
      const ax = cloth.positions[i1*3]-cloth.positions[i0*3];
      const ay = cloth.positions[i1*3+1]-cloth.positions[i0*3+1];
      const az = cloth.positions[i1*3+2]-cloth.positions[i0*3+2];
      const bx = cloth.positions[i2*3]-cloth.positions[i0*3];
      const by = cloth.positions[i2*3+1]-cloth.positions[i0*3+1];
      const bz = cloth.positions[i2*3+2]-cloth.positions[i0*3+2];
      const nx = ay*bz - az*by, ny = az*bx - ax*bz, nz = ax*by - ay*bx;
      cloth.normals[i0*3]+=nx; cloth.normals[i0*3+1]+=ny; cloth.normals[i0*3+2]+=nz;
      cloth.normals[i1*3]+=nx; cloth.normals[i1*3+1]+=ny; cloth.normals[i1*3+2]+=nz;
      cloth.normals[i2*3]+=nx; cloth.normals[i2*3+1]+=ny; cloth.normals[i2*3+2]+=nz;
    }
    for(let i = 0; i < total; i++){
      const l = Math.sqrt(cloth.normals[i*3]*cloth.normals[i*3] + cloth.normals[i*3+1]*cloth.normals[i*3+1] + cloth.normals[i*3+2]*cloth.normals[i*3+2]) || 1;
      cloth.normals[i*3] /= l; cloth.normals[i*3+1] /= l; cloth.normals[i*3+2] /= l;
    }
  }

  function step(dt){
    const dt2 = dt * dt;
    for(let i = 0; i < total; i++){
      if(cloth._pinned[i]) continue;
      const vx = (cloth.positions[i*3] - cloth.previous[i*3]) * cloth.damping;
      const vy = (cloth.positions[i*3+1] - cloth.previous[i*3+1]) * cloth.damping;
      const vz = (cloth.positions[i*3+2] - cloth.previous[i*3+2]) * cloth.damping;
      cloth.previous[i*3] = cloth.positions[i*3];
      cloth.previous[i*3+1] = cloth.positions[i*3+1];
      cloth.previous[i*3+2] = cloth.positions[i*3+2];
      cloth.positions[i*3] += vx + (cloth.gravity[0] + cloth.wind[0]) * dt2;
      cloth.positions[i*3+1] += vy + (cloth.gravity[1] + cloth.wind[1]) * dt2;
      cloth.positions[i*3+2] += vz + (cloth.gravity[2] + cloth.wind[2]) * dt2;
    }

    for(let iter = 0; iter < cloth.iterations; iter++){
      for(let c = 0; c < cloth.constraints.length; c++){
        const con = cloth.constraints[c];
        const dx = cloth.positions[con.p2*3] - cloth.positions[con.p1*3];
        const dy = cloth.positions[con.p2*3+1] - cloth.positions[con.p1*3+1];
        const dz = cloth.positions[con.p2*3+2] - cloth.positions[con.p1*3+2];
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) || 0.0001;
        const diff = (dist - con.rest) / dist * con.stiffness;
        const p1Pinned = cloth._pinned[con.p1];
        const p2Pinned = cloth._pinned[con.p2];
        if(!p1Pinned && !p2Pinned){
          cloth.positions[con.p1*3] += dx * diff * 0.5;
          cloth.positions[con.p1*3+1] += dy * diff * 0.5;
          cloth.positions[con.p1*3+2] += dz * diff * 0.5;
          cloth.positions[con.p2*3] -= dx * diff * 0.5;
          cloth.positions[con.p2*3+1] -= dy * diff * 0.5;
          cloth.positions[con.p2*3+2] -= dz * diff * 0.5;
        } else if(!p1Pinned){
          cloth.positions[con.p1*3] += dx * diff;
          cloth.positions[con.p1*3+1] += dy * diff;
          cloth.positions[con.p1*3+2] += dz * diff;
        } else if(!p2Pinned){
          cloth.positions[con.p2*3] -= dx * diff;
          cloth.positions[con.p2*3+1] -= dy * diff;
          cloth.positions[con.p2*3+2] -= dz * diff;
        }
      }
      for(let i = 0; i < total; i++){
        if(!cloth._pinned[i]) resolveCollisions(i);
      }
    }
    computeNormals();
  }

  function setWind(x, y, z){
    cloth.wind[0] = x; cloth.wind[1] = y; cloth.wind[2] = z;
  }

  function setGravity(x, y, z){
    cloth.gravity[0] = x; cloth.gravity[1] = y; cloth.gravity[2] = z;
  }

  function getGeometry(){
    return {
      positions: cloth.positions,
      normals: cloth.normals,
      indices: cloth.indices,
      vertexCount: total
    };
  }

  function reset(){
    for(let i = 0; i < total; i++){
      cloth.positions[i*3] = cloth.previous[i*3];
      cloth.positions[i*3+1] = cloth.previous[i*3+1];
      cloth.positions[i*3+2] = cloth.previous[i*3+2];
      cloth.velocities[i*3] = 0;
      cloth.velocities[i*3+1] = 0;
      cloth.velocities[i*3+2] = 0;
    }
  }

  return {
    init, pin, unpin, setPinnedPosition, addSphereCollider, addPlaneCollider,
    addBoxCollider, clearColliders, step, setWind, setGravity, getGeometry,
    reset, computeNormals, cloth
  };
}

/* ===== 头发 strands 系统 =====
   基于引导线+插值的头发渲染, 支持物理模拟和样式
*/
function createHairSystem(gl, options){
  const hair = {
    gl: gl,
    strands: [],
    guides: [],
    strandCount: (options && options.strandCount) || 1000,
    segmentCount: (options && options.segmentCount) || 16,
    scalpRadius: (options && options.scalpRadius) || 0.5,
    hairLength: (options && options.hairLength) || 0.8,
    gravity: (options && options.gravity) || [0, -9.8, 0],
    damping: (options && options.damping) || 0.95,
    stiffness: (options && options.stiffness) || 0.8,
    wind: (options && options.wind) || [0, 0, 0],
    _positions: null,
    _velocities: null,
    _vao: null,
    _vbo: null,
    _program: null,
    _initialized: false
  };

  function init(){
    const totalVerts = hair.strandCount * (hair.segmentCount + 1);
    hair._positions = new Float32Array(totalVerts * 3);
    hair._velocities = new Float32Array(totalVerts * 3);
    hair._colors = new Float32Array(totalVerts * 3);

    const guideCount = Math.min(50, Math.floor(hair.strandCount / 20));
    for(let g = 0; g < guideCount; g++){
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1) * 0.6;
      const root = [
        hair.scalpRadius * Math.sin(phi) * Math.cos(theta),
        hair.scalpRadius * Math.cos(phi) + 0.3,
        hair.scalpRadius * Math.sin(phi) * Math.sin(theta)
      ];
      const guide = { root: root, segments: [], stiffness: hair.stiffness * (0.8 + Math.random() * 0.4) };
      for(let s = 0; s <= hair.segmentCount; s++){
        const t = s / hair.segmentCount;
        guide.segments.push([
          root[0],
          root[1] - t * hair.hairLength,
          root[2]
        ]);
      }
      hair.guides.push(guide);
    }

    for(let i = 0; i < hair.strandCount; i++){
      const guideIdx = Math.floor(Math.random() * hair.guides.length);
      const guide = hair.guides[guideIdx];
      const strand = {
        guideIndex: guideIdx,
        rootOffset: [(Math.random()-0.5)*0.02, (Math.random()-0.5)*0.02, (Math.random()-0.5)*0.02],
        lengthScale: 0.8 + Math.random() * 0.4,
        thickness: 0.002 + Math.random() * 0.003,
        color: [0.1 + Math.random()*0.1, 0.05 + Math.random()*0.05, Math.random()*0.03]
      };
      hair.strands.push(strand);
      for(let s = 0; s <= hair.segmentCount; s++){
        const vi = (i * (hair.segmentCount + 1) + s) * 3;
        const t = s / hair.segmentCount;
        hair._positions[vi] = guide.root[0] + strand.rootOffset[0];
        hair._positions[vi+1] = guide.root[1] - t * hair.hairLength * strand.lengthScale;
        hair._positions[vi+2] = guide.root[2] + strand.rootOffset[2];
        hair._colors[vi] = strand.color[0];
        hair._colors[vi+1] = strand.color[1];
        hair._colors[vi+2] = strand.color[2];
      }
    }

    initGPU();
    hair._initialized = true;
  }

  function initGPU(){
    const gl = hair.gl;
    hair._vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, hair._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, hair._positions, gl.DYNAMIC_DRAW);

    const vs = `
      attribute vec3 aPosition;
      attribute vec3 aColor;
      uniform mat4 uViewProj;
      varying vec3 vColor;
      void main(){
        vColor = aColor;
        gl_Position = uViewProj * vec4(aPosition, 1.0);
        gl_PointSize = 2.0;
      }
    `;
    const fs = `
      precision mediump float;
      varying vec3 vColor;
      void main(){
        gl_FragColor = vec4(vColor, 1.0);
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    hair._program = gl.createProgram();
    gl.attachShader(hair._program, vsh);
    gl.attachShader(hair._program, fsh);
    gl.linkProgram(hair._program);
  }

  function step(dt){
    if(!hair._initialized) return;
    const dt2 = dt * dt;
    for(let g = 0; g < hair.guides.length; g++){
      const guide = hair.guides[g];
      for(let s = 1; s <= hair.segmentCount; s++){
        const seg = guide.segments[s];
        const prev = guide.segments[s-1];
        const vx = (seg[0] - prev[0]) * hair.damping;
        const vy = (seg[1] - prev[1]) * hair.damping;
        const vz = (seg[2] - prev[2]) * hair.damping;
        seg[0] += vx + (hair.gravity[0] + hair.wind[0]) * dt2;
        seg[1] += vy + (hair.gravity[1] + hair.wind[1]) * dt2;
        seg[2] += vz + (hair.gravity[2] + hair.wind[2]) * dt2;

        const dx = seg[0] - prev[0], dy = seg[1] - prev[1], dz = seg[2] - prev[2];
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) || 0.001;
        const restLen = hair.hairLength / hair.segmentCount;
        const diff = (dist - restLen) / dist * guide.stiffness;
        if(s < hair.segmentCount){
          seg[0] -= dx * diff * 0.5;
          seg[1] -= dy * diff * 0.5;
          seg[2] -= dz * diff * 0.5;
        }
        prev[0] += dx * diff * 0.5;
        prev[1] += dy * diff * 0.5;
        prev[2] += dz * diff * 0.5;
      }
    }

    for(let i = 0; i < hair.strandCount; i++){
      const strand = hair.strands[i];
      const guide = hair.guides[strand.guideIndex];
      for(let s = 0; s <= hair.segmentCount; s++){
        const vi = (i * (hair.segmentCount + 1) + s) * 3;
        const t = s / hair.segmentCount;
        const lerpFactor = t * t;
        hair._positions[vi] = guide.segments[s][0] * (1 - lerpFactor * 0.3) + strand.rootOffset[0] * (1 - t);
        hair._positions[vi+1] = guide.segments[s][1] * strand.lengthScale;
        hair._positions[vi+2] = guide.segments[s][2] * (1 - lerpFactor * 0.3) + strand.rootOffset[2] * (1 - t);
      }
    }

    const gl = hair.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, hair._vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, hair._positions);
  }

  function render(viewProj){
    if(!hair._initialized) return;
    const gl = hair.gl;
    gl.useProgram(hair._program);
    gl.uniformMatrix4fv(gl.getUniformLocation(hair._program, 'uViewProj'), false, viewProj);
    gl.bindBuffer(gl.ARRAY_BUFFER, hair._vbo);
    const posLoc = gl.getAttribLocation(hair._program, 'aPosition');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, hair.strandCount * (hair.segmentCount + 1));
  }

  function setWind(x, y, z){
    hair.wind[0] = x; hair.wind[1] = y; hair.wind[2] = z;
  }

  function dispose(){
    const gl = hair.gl;
    if(hair._vbo) gl.deleteBuffer(hair._vbo);
    if(hair._program) gl.deleteProgram(hair._program);
  }

  return { init, step, render, setWind, dispose, hair };
}

/* ===== 贴花系统 =====
   支持: 投影贴花 / 延迟贴花 / 法线贴花 / 贴花混合
*/
function createDecalSystem(gl, options){
  const ds = {
    gl: gl,
    decals: [],
    maxDecals: (options && options.maxDecals) || 64,
    _program: null,
    _vbo: null,
    _ibo: null,
    _initialized: false
  };

  function init(){
    const gl = ds.gl;
    const vs = `
      attribute vec3 aPosition;
      attribute vec2 aUV;
      uniform mat4 uViewProj;
      uniform mat4 uDecalMatrix;
      varying vec2 vUV;
      varying vec3 vWorldPos;
      void main(){
        vUV = aUV;
        vWorldPos = aPosition;
        gl_Position = uViewProj * vec4(aPosition, 1.0);
      }
    `;
    const fs = `
      precision mediump float;
      uniform sampler2D uDecalTexture;
      uniform vec4 uDecalColor;
      uniform float uOpacity;
      varying vec2 vUV;
      varying vec3 vWorldPos;
      void main(){
        vec2 uv = vUV;
        if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
        vec4 tex = texture2D(uDecalTexture, uv);
        if(tex.a < 0.01) discard;
        gl_FragColor = vec4(tex.rgb * uDecalColor.rgb, tex.a * uOpacity * uDecalColor.a);
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    ds._program = gl.createProgram();
    gl.attachShader(ds._program, vsh);
    gl.attachShader(ds._program, fsh);
    gl.linkProgram(ds._program);

    const verts = new Float32Array([
      -1,-1,-1, 0,0,  1,-1,-1, 1,0,  1,1,-1, 1,1,  -1,1,-1, 0,1,
      -1,-1,1, 0,0,  1,-1,1, 1,0,  1,1,1, 1,1,  -1,1,1, 0,1
    ]);
    const indices = new Uint16Array([
      0,1,2, 0,2,3, 4,6,5, 4,7,6, 0,4,5, 0,5,1,
      2,6,7, 2,7,3, 0,3,7, 0,7,4, 1,5,6, 1,6,2
    ]);
    ds._vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ds._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    ds._ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ds._ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    ds._initialized = true;
  }

  function createDecal(texture, position, rotation, size, options){
    if(ds.decals.length >= ds.maxDecals) return null;
    const decal = {
      texture: texture,
      position: [position[0], position[1], position[2]],
      rotation: rotation ? [rotation[0],rotation[1],rotation[2]] : [0,0,0],
      size: [size[0], size[1], size[2] || size[0]],
      color: (options && options.color) || [1,1,1,1],
      opacity: (options && options.opacity !== undefined) ? options.opacity : 1,
      normalBlend: (options && options.normalBlend) || 0,
      lifetime: (options && options.lifetime) || -1,
      _age: 0,
      _matrix: M4.create()
    };
    updateDecalMatrix(decal);
    ds.decals.push(decal);
    return decal;
  }

  function updateDecalMatrix(decal){
    const m = M4.create();
    M4.identity(m);
    M4.mult(m, m, M4.fromTRS(M4.create(), decal.position, Q.fromEuler(Q.create(), decal.rotation[0], decal.rotation[1], decal.rotation[2]), decal.size));
    decal._matrix = m;
  }

  function removeDecal(decal){
    const idx = ds.decals.indexOf(decal);
    if(idx >= 0) ds.decals.splice(idx, 1);
  }

  function clear(){
    ds.decals.length = 0;
  }

  function update(dt){
    for(let i = ds.decals.length - 1; i >= 0; i--){
      const d = ds.decals[i];
      if(d.lifetime > 0){
        d._age += dt;
        if(d._age >= d.lifetime){
          ds.decals.splice(i, 1);
        }
      }
    }
  }

  function render(viewProj){
    if(!ds._initialized || ds.decals.length === 0) return;
    const gl = ds.gl;
    gl.useProgram(ds._program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);

    for(let i = 0; i < ds.decals.length; i++){
      const d = ds.decals[i];
      gl.uniformMatrix4fv(gl.getUniformLocation(ds._program, 'uViewProj'), false, viewProj);
      gl.uniformMatrix4fv(gl.getUniformLocation(ds._program, 'uDecalMatrix'), false, d._matrix);
      gl.uniform4fv(gl.getUniformLocation(ds._program, 'uDecalColor'), d.color);
      gl.uniform1f(gl.getUniformLocation(ds._program, 'uOpacity'), d.opacity);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, d.texture);
      gl.uniform1i(gl.getUniformLocation(ds._program, 'uDecalTexture'), 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, ds._vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ds._ibo);
      const posLoc = gl.getAttribLocation(ds._program, 'aPosition');
      const uvLoc = gl.getAttribLocation(ds._program, 'aUV');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(uvLoc);
      gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 20, 12);
      gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  function dispose(){
    const gl = ds.gl;
    if(ds._vbo) gl.deleteBuffer(ds._vbo);
    if(ds._ibo) gl.deleteBuffer(ds._ibo);
    if(ds._program) gl.deleteProgram(ds._program);
  }

  return { init, createDecal, removeDecal, clear, update, render, dispose, ds };
}
