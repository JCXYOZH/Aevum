/**
 * MrHua 3D灵体渲染引擎 - 扩展模块: orb-extension-procedural-geometry
 * 从 legacy/_orb_expand_part4.js 转换 (GBK->UTF-8)
 * @module orb-extension-procedural-geometry
 */
'use strict';



/* ===== 程序化几何生成系统（高级）=====
   支持: 元球 / Voronoi / 分形地形 / 参数化曲面/ 螺旋 / 环面结*/
function createMetaballField(resolution, options){
  const field = {
    resolution: resolution || 64,
    balls: [],
    threshold: (options && options.threshold) || 1.0,
    _data: null
  };

  function addBall(center, radius, strength){
    field.balls.push({
      center: [center[0], center[1], center[2]],
      radius: radius || 1,
      strength: strength || 1
    });
  }

  function evaluate(x, y, z){
    let sum = 0;
    for(let i = 0; i < field.balls.length; i++){
      const b = field.balls[i];
      const dx = x - b.center[0], dy = y - b.center[1], dz = z - b.center[2];
      const distSq = dx*dx + dy*dy + dz*dz;
      const r2 = b.radius * b.radius;
      if(distSq < r2 * 4){
        const f = r2 / (distSq + 0.0001);
        sum += b.strength * f * f;
      }
    }
    return sum;
  }

  function generate(){
    const n = field.resolution;
    field._data = new Float32Array(n * n * n);
    for(let z = 0; z < n; z++){
      for(let y = 0; y < n; y++){
        for(let x = 0; x < n; x++){
          const fx = (x / n - 0.5) * 4;
          const fy = (y / n - 0.5) * 4;
          const fz = (z / n - 0.5) * 4;
          field._data[(z * n + y) * n + x] = evaluate(fx, fy, fz);
        }
      }
    }
    return field._data;
  }

  function marchingCubes(){
    if(!field._data) generate();
    const n = field.resolution;
    const vertices = [];
    const indices = [];
    const scale = 4 / n;
    for(let z = 0; z < n - 1; z++){
      for(let y = 0; y < n - 1; y++){
        for(let x = 0; x < n - 1; x++){
          const v0 = field._data[(z*n+y)*n+x];
          const v1 = field._data[(z*n+y)*n+x+1];
          const v2 = field._data[(z*n+(y+1))*n+x+1];
          const v3 = field._data[(z*n+(y+1))*n+x];
          const v4 = field._data[((z+1)*n+y)*n+x];
          const v5 = field._data[((z+1)*n+y)*n+x+1];
          const v6 = field._data[((z+1)*n+(y+1))*n+x+1];
          const v7 = field._data[((z+1)*n+(y+1))*n+x];
          let cubeIndex = 0;
          if(v0 < field.threshold) cubeIndex |= 1;
          if(v1 < field.threshold) cubeIndex |= 2;
          if(v2 < field.threshold) cubeIndex |= 4;
          if(v3 < field.threshold) cubeIndex |= 8;
          if(v4 < field.threshold) cubeIndex |= 16;
          if(v5 < field.threshold) cubeIndex |= 32;
          if(v6 < field.threshold) cubeIndex |= 64;
          if(v7 < field.threshold) cubeIndex |= 128;
          if(cubeIndex === 0 || cubeIndex === 255) continue;
          const baseX = (x / n - 0.5) * 4;
          const baseY = (y / n - 0.5) * 4;
          const baseZ = (z / n - 0.5) * 4;
          const idx = vertices.length / 3;
          vertices.push(baseX, baseY, baseZ, baseX+scale, baseY, baseZ, baseX+scale, baseY+scale, baseZ);
          indices.push(idx, idx+1, idx+2);
        }
      }
    }
    return {
      positions: new Float32Array(vertices),
      indices: new Uint16Array(indices),
      vertexCount: vertices.length / 3,
      indexCount: indices.length
    };
  }

  function clear(){
    field.balls = [];
    field._data = null;
  }

  return { addBall, evaluate, generate, marchingCubes, clear, field };
}

function createVoronoiField(resolution, options){
  const voronoi = {
    resolution: resolution || 128,
    points: [],
    _data: null,
    _colors: null
  };

  function generatePoints(count, bounds){
    voronoi.points = [];
    const b = bounds || { min: [-1,-1,-1], max: [1,1,1] };
    for(let i = 0; i < count; i++){
      voronoi.points.push({
        position: [
          b.min[0] + Math.random() * (b.max[0] - b.min[0]),
          b.min[1] + Math.random() * (b.max[1] - b.min[1]),
          b.min[2] + Math.random() * (b.max[2] - b.min[2])
        ],
        color: [Math.random(), Math.random(), Math.random()]
      });
    }
  }

  function nearest(x, y, z){
    let minDist = Infinity, nearestIdx = 0;
    for(let i = 0; i < voronoi.points.length; i++){
      const p = voronoi.points[i];
      const dx = x - p.position[0], dy = y - p.position[1], dz = z - p.position[2];
      const d = dx*dx + dy*dy + dz*dz;
      if(d < minDist){ minDist = d; nearestIdx = i; }
    }
    return { index: nearestIdx, distance: Math.sqrt(minDist), point: voronoi.points[nearestIdx] };
  }

  function generate(){
    const n = voronoi.resolution;
    voronoi._data = new Float32Array(n * n * n);
    voronoi._colors = new Float32Array(n * n * n * 3);
    for(let z = 0; z < n; z++){
      for(let y = 0; y < n; y++){
        for(let x = 0; x < n; x++){
          const fx = x / n * 2 - 1;
          const fy = y / n * 2 - 1;
          const fz = z / n * 2 - 1;
          const r = nearest(fx, fy, fz);
          const idx = (z * n + y) * n + x;
          voronoi._data[idx] = r.distance;
          voronoi._colors[idx*3] = r.point.color[0];
          voronoi._colors[idx*3+1] = r.point.color[1];
          voronoi._colors[idx*3+2] = r.point.color[2];
        }
      }
    }
  }

  function toTexture2D(gl, slice){
    const n = voronoi.resolution;
    const data = new Uint8Array(n * n * 4);
    const z = slice || Math.floor(n / 2);
    for(let y = 0; y < n; y++){
      for(let x = 0; x < n; x++){
        const idx = (z * n + y) * n + x;
        const d = voronoi._data[idx];
        data[(y*n+x)*4] = voronoi._colors[idx*3] * 255;
        data[(y*n+x)*4+1] = voronoi._colors[idx*3+1] * 255;
        data[(y*n+x)*4+2] = voronoi._colors[idx*3+2] * 255;
        data[(y*n+x)*4+3] = 255;
      }
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  return { generatePoints, nearest, generate, toTexture2D, voronoi };
}

function createFractalTerrain(width, depth, options){
  const terrain = {
    width: width,
    depth: depth,
    segmentsW: (options && options.segmentsW) || 128,
    segmentsD: (options && options.segmentsD) || 128,
    octaves: (options && options.octaves) || 6,
    persistence: (options && options.persistence) || 0.5,
    lacunarity: (options && options.lacunarity) || 2,
    scale: (options && options.scale) || 50,
    height: (options && options.height) || 10,
    seed: (options && options.seed) || 42,
    _heights: null
  };

  function noise2D(x, y, seed){
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
    return n - Math.floor(n);
  }

  function smoothNoise(x, y, seed){
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = noise2D(ix, iy, seed);
    const b = noise2D(ix+1, iy, seed);
    const c = noise2D(ix, iy+1, seed);
    const d = noise2D(ix+1, iy+1, seed);
    return a + (b-a)*ux + (c-a)*uy + (a-b-c+d)*ux*uy;
  }

  function fbm(x, y){
    let value = 0, amplitude = 1, frequency = 1, maxValue = 0;
    for(let i = 0; i < terrain.octaves; i++){
      value += smoothNoise(x * frequency, y * frequency, terrain.seed + i) * amplitude;
      maxValue += amplitude;
      amplitude *= terrain.persistence;
      frequency *= terrain.lacunarity;
    }
    return value / maxValue;
  }

  function generate(){
    const sw = terrain.segmentsW, sd = terrain.segmentsD;
    terrain._heights = new Float32Array((sw+1) * (sd+1));
    for(let z = 0; z <= sd; z++){
      for(let x = 0; x <= sw; x++){
        const nx = x / sw * terrain.scale;
        const nz = z / sd * terrain.scale;
        let h = fbm(nx, nz);
        h = Math.pow(h, 1.5);
        terrain._heights[z * (sw+1) + x] = (h - 0.5) * terrain.height;
      }
    }
    return terrain._heights;
  }

  function getGeometry(){
    if(!terrain._heights) generate();
    const sw = terrain.segmentsW, sd = terrain.segmentsD;
    const vertCount = (sw+1) * (sd+1);
    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices = new Uint16Array(sw * sd * 6);

    for(let z = 0; z <= sd; z++){
      for(let x = 0; x <= sw; x++){
        const i = z * (sw+1) + x;
        positions[i*3] = (x / sw - 0.5) * terrain.width;
        positions[i*3+1] = terrain._heights[i];
        positions[i*3+2] = (z / sd - 0.5) * terrain.depth;
        uvs[i*2] = x / sw;
        uvs[i*2+1] = z / sd;
      }
    }

    for(let z = 0; z < sd; z++){
      for(let x = 0; x < sw; x++){
        const i = z * (sw+1) + x;
        const idx = (z * sw + x) * 6;
        indices[idx] = i;
        indices[idx+1] = i + sw + 1;
        indices[idx+2] = i + 1;
        indices[idx+3] = i + 1;
        indices[idx+4] = i + sw + 1;
        indices[idx+5] = i + sw + 2;
      }
    }

    for(let z = 0; z <= sd; z++){
      for(let x = 0; x <= sw; x++){
        const i = z * (sw+1) + x;
        const hL = x > 0 ? terrain._heights[i-1] : terrain._heights[i];
        const hR = x < sw ? terrain._heights[i+1] : terrain._heights[i];
        const hD = z > 0 ? terrain._heights[i-sw-1] : terrain._heights[i];
        const hU = z < sd ? terrain._heights[i+sw+1] : terrain._heights[i];
        const nx = hL - hR;
        const ny = 2 * (terrain.width / sw);
        const nz = hD - hU;
        const l = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
        normals[i*3] = nx / l;
        normals[i*3+1] = ny / l;
        normals[i*3+2] = nz / l;
      }
    }

    return {
      positions: positions, normals: normals, uvs: uvs, indices: indices,
      vertexCount: vertCount, indexCount: indices.length
    };
  }

  function getHeightAt(x, z){
    if(!terrain._heights) return 0;
    const sw = terrain.segmentsW, sd = terrain.segmentsD;
    const fx = (x / terrain.width + 0.5) * sw;
    const fz = (z / terrain.depth + 0.5) * sd;
    const ix = Math.max(0, Math.min(sw-1, Math.floor(fx)));
    const iz = Math.max(0, Math.min(sd-1, Math.floor(fz)));
    const tx = fx - ix, tz = fz - iz;
    const h00 = terrain._heights[iz * (sw+1) + ix];
    const h10 = terrain._heights[iz * (sw+1) + ix + 1];
    const h01 = terrain._heights[(iz+1) * (sw+1) + ix];
    const h11 = terrain._heights[(iz+1) * (sw+1) + ix + 1];
    return h00 + (h10-h00)*tx + (h01-h00)*tz + (h00-h10-h01+h11)*tx*tz;
  }

  return { generate, getGeometry, getHeightAt, terrain };
}

function createTorusKnot(p, q, radius, tube, radialSegments, tubularSegments){
  p = p || 2; q = q || 3;
  radius = radius || 1; tube = tube || 0.3;
  radialSegments = radialSegments || 32; tubularSegments = tubularSegments || 128;

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for(let i = 0; i <= tubularSegments; i++){
    const u = i / tubularSegments * Math.PI * 2;
    const p1 = [
      radius * (2 + Math.cos(q * u)) * Math.cos(p * u) / 3,
      radius * (2 + Math.cos(q * u)) * Math.sin(p * u) / 3,
      radius * Math.sin(q * u) / 3
    ];
    const u2 = u + 0.01;
    const p2 = [
      radius * (2 + Math.cos(q * u2)) * Math.cos(p * u2) / 3,
      radius * (2 + Math.cos(q * u2)) * Math.sin(p * u2) / 3,
      radius * Math.sin(q * u2) / 3
    ];
    const tangent = [p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]];
    const tl = Math.sqrt(tangent[0]*tangent[0]+tangent[1]*tangent[1]+tangent[2]*tangent[2]) || 1;
    tangent[0]/=tl; tangent[1]/=tl; tangent[2]/=tl;
    const up = [0, 1, 0];
    const normal = [tangent[1]*up[2]-tangent[2]*up[1], tangent[2]*up[0]-tangent[0]*up[2], tangent[0]*up[1]-tangent[1]*up[0]];
    const nl = Math.sqrt(normal[0]*normal[0]+normal[1]*normal[1]+normal[2]*normal[2]) || 1;
    normal[0]/=nl; normal[1]/=nl; normal[2]/=nl;
    const binormal = [tangent[1]*normal[2]-tangent[2]*normal[1], tangent[2]*normal[0]-tangent[0]*normal[2], tangent[0]*normal[1]-tangent[1]*normal[0]];

    for(let j = 0; j <= radialSegments; j++){
      const v = j / radialSegments * Math.PI * 2;
      const cx = Math.cos(v), sx = Math.sin(v);
      const nx = normal[0]*cx + binormal[0]*sx;
      const ny = normal[1]*cx + binormal[1]*sx;
      const nz = normal[2]*cx + binormal[2]*sx;
      positions.push(p1[0] + nx * tube, p1[1] + ny * tube, p1[2] + nz * tube);
      normals.push(nx, ny, nz);
      uvs.push(i / tubularSegments, j / radialSegments);
    }
  }

  for(let i = 0; i < tubularSegments; i++){
    for(let j = 0; j < radialSegments; j++){
      const a = i * (radialSegments+1) + j;
      const b = a + radialSegments + 1;
      indices.push(a, b, a+1, b, b+1, a+1);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
    vertexCount: positions.length / 3,
    indexCount: indices.length
  };
}

function createHelix(radius, height, turns, segments, tubeRadius){
  radius = radius || 1; height = height || 2; turns = turns || 3;
  segments = segments || 100; tubeRadius = tubeRadius || 0.1;

  const positions = [];
  const normals = [];
  const indices = [];
  const radialSeg = 8;

  for(let i = 0; i <= segments; i++){
    const t = i / segments;
    const angle = t * turns * Math.PI * 2;
    const cx = Math.cos(angle) * radius;
    const cy = (t - 0.5) * height;
    const cz = Math.sin(angle) * radius;
    const tangent = [-Math.sin(angle), height / (turns * Math.PI * 2) / radius, Math.cos(angle)];
    const tl = Math.sqrt(tangent[0]*tangent[0]+tangent[1]*tangent[1]+tangent[2]*tangent[2]) || 1;
    tangent[0]/=tl; tangent[1]/=tl; tangent[2]/=tl;
    const radial = [Math.cos(angle), 0, Math.sin(angle)];
    const up = [tangent[1]*radial[2]-tangent[2]*radial[1], tangent[2]*radial[0]-tangent[0]*radial[2], tangent[0]*radial[1]-tangent[1]*radial[0]];

    for(let j = 0; j <= radialSeg; j++){
      const a = j / radialSeg * Math.PI * 2;
      const nx = radial[0]*Math.cos(a) + up[0]*Math.sin(a);
      const ny = radial[1]*Math.cos(a) + up[1]*Math.sin(a);
      const nz = radial[2]*Math.cos(a) + up[2]*Math.sin(a);
      positions.push(cx + nx*tubeRadius, cy + ny*tubeRadius, cz + nz*tubeRadius);
      normals.push(nx, ny, nz);
    }
  }

  for(let i = 0; i < segments; i++){
    for(let j = 0; j < radialSeg; j++){
      const a = i * (radialSeg+1) + j;
      const b = a + radialSeg + 1;
      indices.push(a, b, a+1, b, b+1, a+1);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
    vertexCount: positions.length / 3,
    indexCount: indices.length
  };
}

/* ===== IK 扩展系统 =====
   支持: 雅可比转置/ 阻尼最小二乘/ 优先级IK / 多端效应器*/
function createIKExtended(boneSystem, options){
  const ik = {
    boneSystem: boneSystem,
    chains: [],
    maxIterations: (options && options.maxIterations) || 50,
    tolerance: (options && options.tolerance) || 0.001,
    damping: (options && options.damping) || 0.5,
    _poseRotations: null
  };

  function addChain(rootBone, endBone, target, options){
    const chain = {
      rootBone: rootBone,
      endBone: endBone,
      target: [target[0], target[1], target[2]],
      weight: (options && options.weight) || 1,
      priority: (options && options.priority) || 0,
      maxAngle: (options && options.maxAngle) || Math.PI,
      _bones: []
    };
    let current = endBone;
    while(current !== rootBone && current >= 0){
      chain._bones.unshift(current);
      const bone = boneSystem.bones ? boneSystem.bones[current] : null;
      current = bone ? bone.parent : -1;
    }
    chain._bones.unshift(rootBone);
    ik.chains.push(chain);
    return chain;
  }

  function removeChain(chain){
    const idx = ik.chains.indexOf(chain);
    if(idx >= 0) ik.chains.splice(idx, 1);
  }

  function getBoneWorldPosition(boneIndex, poseRotations, posePositions, out){
    const bones = boneSystem.bones || [];
    let pos = [0, 0, 0];
    const chain = [];
    let current = boneIndex;
    while(current >= 0){
      chain.unshift(current);
      const bone = bones[current];
      current = bone ? bone.parent : -1;
    }
    for(let i = 0; i < chain.length; i++){
      const bi = chain[i];
      const bone = bones[bi];
      const rot = poseRotations && poseRotations[bi] ? poseRotations[bi] : [0,0,0,1];
      const localPos = posePositions && posePositions[bi] ? posePositions[bi] : (bone.position || [0,0,0]);
      const rotated = [0,0,0];
      const qx=rot[0], qy=rot[1], qz=rot[2], qw=rot[3];
      rotated[0] = localPos[0]*(1-2*(qy*qy+qz*qz)) + localPos[1]*(2*(qx*qy-qw*qz)) + localPos[2]*(2*(qx*qz+qw*qy));
      rotated[1] = localPos[0]*(2*(qx*qy+qw*qz)) + localPos[1]*(1-2*(qx*qx+qz*qz)) + localPos[2]*(2*(qy*qz-qw*qx));
      rotated[2] = localPos[0]*(2*(qx*qz-qw*qy)) + localPos[1]*(2*(qy*qz+qw*qx)) + localPos[2]*(1-2*(qx*qx+qy*qy));
      pos[0] += rotated[0]; pos[1] += rotated[1]; pos[2] += rotated[2];
    }
    if(out){ out[0]=pos[0]; out[1]=pos[1]; out[2]=pos[2]; }
    return pos;
  }

  function solveJacobianTranspose(chain, poseRotations, posePositions){
    const bones = chain._bones;
    const endPos = getBoneWorldPosition(chain.endBone, poseRotations, posePositions);
    let error = V3.dist(endPos, chain.target);
    if(error < ik.tolerance) return true;

    for(let iter = 0; iter < ik.maxIterations; iter++){
      for(let bi = 0; bi < bones.length; bi++){
        const boneIdx = bones[bi];
        const bonePos = getBoneWorldPosition(boneIdx, poseRotations, posePositions);
        const axis = [0, 1, 0];
        const toEnd = [endPos[0]-bonePos[0], endPos[1]-bonePos[1], endPos[2]-bonePos[2]];
        const toTarget = [chain.target[0]-endPos[0], chain.target[1]-endPos[1], chain.target[2]-endPos[2]];
        const cross = [axis[1]*toEnd[2]-axis[2]*toEnd[1], axis[2]*toEnd[0]-axis[0]*toEnd[2], axis[0]*toEnd[1]-axis[1]*toEnd[0]];
        const dot = cross[0]*toTarget[0] + cross[1]*toTarget[1] + cross[2]*toTarget[2];
        if(Math.abs(dot) > 0.0001){
          const angle = dot * ik.damping * 0.01;
          const q = Q.fromAxisAngle(Q.create(), axis, angle);
          if(!poseRotations[boneIdx]) poseRotations[boneIdx] = Q.create();
          Q.mult(poseRotations[boneIdx], poseRotations[boneIdx], q);
        }
      }
      const newEndPos = getBoneWorldPosition(chain.endBone, poseRotations, posePositions);
      error = V3.dist(newEndPos, chain.target);
      endPos[0]=newEndPos[0]; endPos[1]=newEndPos[1]; endPos[2]=newEndPos[2];
      if(error < ik.tolerance) return true;
    }
    return error < ik.tolerance * 10;
  }

  function solveDampedLeastSquares(chain, poseRotations, posePositions){
    const bones = chain._bones;
    const n = bones.length;
    const jacobian = new Float32Array(3 * n);
    const endPos = getBoneWorldPosition(chain.endBone, poseRotations, posePositions);
    const error = [chain.target[0]-endPos[0], chain.target[1]-endPos[1], chain.target[2]-endPos[2]];

    for(let bi = 0; bi < n; bi++){
      const bonePos = getBoneWorldPosition(bones[bi], poseRotations, posePositions);
      const toEnd = [endPos[0]-bonePos[0], endPos[1]-bonePos[1], endPos[2]-bonePos[2]];
      const axis = [0, 1, 0];
      jacobian[bi*3] = axis[1]*toEnd[2]-axis[2]*toEnd[1];
      jacobian[bi*3+1] = axis[2]*toEnd[0]-axis[0]*toEnd[2];
      jacobian[bi*3+2] = axis[0]*toEnd[1]-axis[1]*toEnd[0];
    }

    const lambda = 0.1;
    const jtj = new Float32Array(n * n);
    for(let i = 0; i < n; i++){
      for(let j = 0; j < n; j++){
        let sum = 0;
        for(let k = 0; k < 3; k++) sum += jacobian[i*3+k] * jacobian[j*3+k];
        jtj[i*n+j] = sum + (i === j ? lambda : 0);
      }
    }

    const jte = new Float32Array(n);
    for(let i = 0; i < n; i++){
      jte[i] = jacobian[i*3]*error[0] + jacobian[i*3+1]*error[1] + jacobian[i*3+2]*error[2];
    }

    for(let iter = 0; iter < ik.maxIterations; iter++){
      let maxChange = 0;
      for(let i = 0; i < n; i++){
        let sum = jte[i];
        for(let j = 0; j < n; j++){
          if(j !== i) sum -= jtj[i*n+j] * (poseRotations[bones[j]] ? 0 : 0);
        }
        const delta = sum / (jtj[i*n+i] || 1) * ik.damping;
        if(Math.abs(delta) > maxChange) maxChange = Math.abs(delta);
        const q = Q.fromAxisAngle(Q.create(), [0,1,0], delta * 0.01);
        if(!poseRotations[bones[i]]) poseRotations[bones[i]] = Q.create();
        Q.mult(poseRotations[bones[i]], poseRotations[bones[i]], q);
      }
      if(maxChange < ik.tolerance) break;
    }
    return true;
  }

  function solve(poseRotations, posePositions){
    ik.chains.sort(function(a, b){ return b.priority - a.priority; });
    for(let i = 0; i < ik.chains.length; i++){
      const chain = ik.chains[i];
      if(chain.weight <= 0) continue;
      if(i % 2 === 0){
        solveJacobianTranspose(chain, poseRotations, posePositions);
      } else {
        solveDampedLeastSquares(chain, poseRotations, posePositions);
      }
    }
  }

  function setTarget(chain, x, y, z){
    chain.target[0] = x; chain.target[1] = y; chain.target[2] = z;
  }

  function clear(){
    ik.chains = [];
  }

  return { addChain, removeChain, solve, setTarget, clear, ik };
}

/* ===== 着色器预处理器 =====
   支持: 宏定义/ 条件编译 / 包含 / 变量替换
*/
function createShaderPreprocessor(){
  const pp = {
    defines: {},
    includeCache: {},
    _maxDepth: 32
  };

  function define(name, value){
    pp.defines[name] = value !== undefined ? value : '';
  }

  function undef(name){
    delete pp.defines[name];
  }

  function isDefined(name){
    return pp.defines[name] !== undefined;
  }

  function getDefine(name){
    return pp.defines[name];
  }

  function clearDefines(){
    pp.defines = {};
  }

  function process(source, options){
    const defines = options && options.defines ? { ...pp.defines, ...options.defines } : pp.defines;
    const lines = source.split('\n');
    const output = [];
    const ifStack = [];
    let depth = 0;

    for(let i = 0; i < lines.length; i++){
      const line = lines[i];
      const trimmed = line.trim();

      if(trimmed.startsWith('#define ')){
        const parts = trimmed.substring(8).trim().split(/\s+/);
        const name = parts[0];
        const value = parts.slice(1).join(' ');
        defines[name] = value || '';
        continue;
      }

      if(trimmed.startsWith('#undef ')){
        const name = trimmed.substring(7).trim();
        delete defines[name];
        continue;
      }

      if(trimmed.startsWith('#ifdef ')){
        const name = trimmed.substring(7).trim();
        ifStack.push({ type: 'ifdef', name: name, parentActive: ifStack.length === 0 || ifStack[ifStack.length-1].active, active: defines[name] !== undefined });
        continue;
      }

      if(trimmed.startsWith('#ifndef ')){
        const name = trimmed.substring(8).trim();
        ifStack.push({ type: 'ifndef', name: name, parentActive: ifStack.length === 0 || ifStack[ifStack.length-1].active, active: defines[name] === undefined });
        continue;
      }

      if(trimmed === '#else'){
        if(ifStack.length > 0){
          const top = ifStack[ifStack.length-1];
          top.active = top.parentActive && !top.active;
          top.elseFound = true;
        }
        continue;
      }

      if(trimmed === '#endif'){
        ifStack.pop();
        continue;
      }

      if(trimmed.startsWith('#if ')){
        const expr = trimmed.substring(4).trim();
        const result = evaluateExpression(expr, defines);
        ifStack.push({ type: 'if', expr: expr, parentActive: ifStack.length === 0 || ifStack[ifStack.length-1].active, active: result });
        continue;
      }

      const active = ifStack.length === 0 || ifStack[ifStack.length-1].active;
      if(active){
        let processed = line;
        for(const name in defines){
          const value = defines[name];
          const regex = new RegExp('\\b' + name + '\\b', 'g');
          processed = processed.replace(regex, value);
        }
        output.push(processed);
      }
    }

    return output.join('\n');
  }

  function evaluateExpression(expr, defines){
    let result = expr;
    for(const name in defines){
      const value = defines[name];
      const regex = new RegExp('\\b' + name + '\\b', 'g');
      result = result.replace(regex, value || '0');
    }
    result = result.replace(/\|\|/g, '||').replace(/&&/g, '&&');
    try{
      return Function('"use strict"; return (' + result + ');')();
    }catch(e){
      return false;
    }
  }

  function registerInclude(name, source){
    pp.includeCache[name] = source;
  }

  function processIncludes(source, depth){
    depth = depth || 0;
    if(depth > pp._maxDepth){
      console.warn('[ShaderPP] 包含嵌套过深');
      return source;
    }
    const lines = source.split('\n');
    const output = [];
    for(let i = 0; i < lines.length; i++){
      const trimmed = lines[i].trim();
      if(trimmed.startsWith('#include ')){
        const name = trimmed.substring(9).trim().replace(/["<>]/g, '');
        if(pp.includeCache[name]){
          output.push('// --- include: ' + name + ' ---');
          output.push(processIncludes(pp.includeCache[name], depth + 1));
          output.push('// --- end include: ' + name + ' ---');
        } else {
          output.push('// [ShaderPP] 未找到包含 ' + name);
        }
      } else {
        output.push(lines[i]);
      }
    }
    return output.join('\n');
  }

  function compile(gl, type, source, options){
    let processed = processIncludes(source);
    processed = process(processed, options);
    const shader = gl.createShader(type);
    gl.shaderSource(shader, processed);
    gl.compileShader(shader);
    if(!gl.getShaderParameter(shader, gl.COMPILE_STATUS)){
      const log = gl.getShaderInfoLog(shader);
      console.error('[ShaderPP] 编译错误:', log);
      console.error('[ShaderPP] 处理后源码\n', processed);
      return null;
    }
    return shader;
  }

  function createProgram(gl, vsSource, fsSource, options){
    const vs = compile(gl, gl.VERTEX_SHADER, vsSource, options);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource, options);
    if(!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program, gl.LINK_STATUS)){
      console.error('[ShaderPP] 链接错误:', gl.getProgramInfoLog(program));
      return null;
    }
    return program;
  }

  function getDefines(){
    return { ...pp.defines };
  }

  return { define, undef, isDefined, getDefine, clearDefines, process, compile, createProgram, registerInclude, getDefines, pp };
}

/* ===== 动画曲线系统 =====
   支持: 贝塞尔曲面/ 缓动函数 / 关键帧曲面/ 曲线混合
*/
const EasingType = {
  LINEAR: 0,
  EASE_IN: 1, EASE_OUT: 2, EASE_IN_OUT: 3,
  EASE_IN_QUAD: 4, EASE_OUT_QUAD: 5, EASE_IN_OUT_QUAD: 6,
  EASE_IN_CUBIC: 7, EASE_OUT_CUBIC: 8, EASE_IN_OUT_CUBIC: 9,
  EASE_IN_QUART: 10, EASE_OUT_QUART: 11, EASE_IN_OUT_QUART: 12,
  EASE_IN_QUINT: 13, EASE_OUT_QUINT: 14, EASE_IN_OUT_QUINT: 15,
  EASE_IN_SINE: 16, EASE_OUT_SINE: 17, EASE_IN_OUT_SINE: 18,
  EASE_IN_EXPO: 19, EASE_OUT_EXPO: 20, EASE_IN_OUT_EXPO: 21,
  EASE_IN_CIRC: 22, EASE_OUT_CIRC: 23, EASE_IN_OUT_CIRC: 24,
  EASE_IN_BACK: 25, EASE_OUT_BACK: 26, EASE_IN_OUT_BACK: 27,
  EASE_IN_ELASTIC: 28, EASE_OUT_ELASTIC: 29, EASE_IN_OUT_ELASTIC: 30,
  EASE_IN_BOUNCE: 31, EASE_OUT_BOUNCE: 32, EASE_IN_OUT_BOUNCE: 33,
  SPRING: 34
};

function createAnimationCurve(type, options){
  const curve = {
    type: type || EasingType.LINEAR,
    duration: (options && options.duration) || 1,
    startValue: (options && options.startValue) || 0,
    endValue: (options && options.endValue) || 1,
    controlPoints: (options && options.controlPoints) || null,
    overshoot: (options && options.overshoot) || 1.70158,
    amplitude: (options && options.amplitude) || 1,
    period: (options && options.period) || 0.3,
    _keyframes: []
  };

  function ease(t){
    t = Math.max(0, Math.min(1, t));
    switch(curve.type){
      case EasingType.LINEAR: return t;
      case EasingType.EASE_IN: return t * t;
      case EasingType.EASE_OUT: return t * (2 - t);
      case EasingType.EASE_IN_OUT: return t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
      case EasingType.EASE_IN_QUAD: return t * t;
      case EasingType.EASE_OUT_QUAD: return t * (2 - t);
      case EasingType.EASE_IN_OUT_QUAD: return t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
      case EasingType.EASE_IN_CUBIC: return t * t * t;
      case EasingType.EASE_OUT_CUBIC: return (--t)*t*t+1;
      case EasingType.EASE_IN_OUT_CUBIC: return t < 0.5 ? 4*t*t*t : (t-1)*(2*t-2)*(2*t-2)+1;
      case EasingType.EASE_IN_QUART: return t*t*t*t;
      case EasingType.EASE_OUT_QUART: return 1-(--t)*t*t*t;
      case EasingType.EASE_IN_OUT_QUART: return t < 0.5 ? 8*t*t*t*t : 1-8*(--t)*t*t*t;
      case EasingType.EASE_IN_QUINT: return t*t*t*t*t;
      case EasingType.EASE_OUT_QUINT: return 1+(--t)*t*t*t*t;
      case EasingType.EASE_IN_OUT_QUINT: return t < 0.5 ? 16*t*t*t*t*t : 1+16*(--t)*t*t*t*t;
      case EasingType.EASE_IN_SINE: return 1 - Math.cos(t * Math.PI / 2);
      case EasingType.EASE_OUT_SINE: return Math.sin(t * Math.PI / 2);
      case EasingType.EASE_IN_OUT_SINE: return -(Math.cos(Math.PI * t) - 1) / 2;
      case EasingType.EASE_IN_EXPO: return t === 0 ? 0 : Math.pow(2, 10 * t - 10);
      case EasingType.EASE_OUT_EXPO: return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      case EasingType.EASE_IN_OUT_EXPO:
        if(t === 0) return 0; if(t === 1) return 1;
        return t < 0.5 ? Math.pow(2, 20*t-10)/2 : (2-Math.pow(2, -20*t+10))/2;
      case EasingType.EASE_IN_CIRC: return 1 - Math.sqrt(1 - t*t);
      case EasingType.EASE_OUT_CIRC: return Math.sqrt(1 - (--t)*t);
      case EasingType.EASE_IN_OUT_CIRC:
        return t < 0.5 ? (1-Math.sqrt(1-4*t*t))/2 : (Math.sqrt(1-(-2*t+2)*(-2*t+2))+1)/2;
      case EasingType.EASE_IN_BACK:
        const c1 = curve.overshoot; return (c1+1)*t*t*t - c1*t*t;
      case EasingType.EASE_OUT_BACK:
        const c2 = curve.overshoot; return 1+(c2+1)*(--t)*t*t+c2*t*t;
      case EasingType.EASE_IN_OUT_BACK:
        const c3 = curve.overshoot * 1.525;
        return t < 0.5 ? (4*t*t*((c3+1)*2*t-c3))/2 : (2*(--t)*t*((c3+1)*t*2+c3)+2)/2;
      case EasingType.EASE_IN_ELASTIC:
        if(t === 0) return 0; if(t === 1) return 1;
        const p4 = curve.period, a4 = curve.amplitude;
        return -(a4 * Math.pow(2, 10*(t-1)) * Math.sin((t*10-0.75)*(2*Math.PI/p4)));
      case EasingType.EASE_OUT_ELASTIC:
        if(t === 0) return 0; if(t === 1) return 1;
        const p5 = curve.period, a5 = curve.amplitude;
        return a5 * Math.pow(2, -10*t) * Math.sin((t*10-0.75)*(2*Math.PI/p5)) + 1;
      case EasingType.EASE_IN_OUT_ELASTIC:
        if(t === 0) return 0; if(t === 1) return 1;
        const p6 = curve.period * 1.5, a6 = curve.amplitude;
        return t < 0.5 ?
          -(a6*Math.pow(2,20*t-10)*Math.sin((20*t-11.125)*(2*Math.PI/p6)))/2 :
          a6*Math.pow(2,-20*t+10)*Math.sin((20*t-11.125)*(2*Math.PI/p6))/2 + 1;
      case EasingType.EASE_IN_BOUNCE:
        return 1 - easeOutBounce(1-t);
      case EasingType.EASE_OUT_BOUNCE:
        return easeOutBounce(t);
      case EasingType.EASE_IN_OUT_BOUNCE:
        return t < 0.5 ? (1-easeOutBounce(1-2*t))/2 : (1+easeOutBounce(2*t-1))/2;
      case EasingType.SPRING:
        return springEase(t, curve);
      default: return t;
    }
  }

  function easeOutBounce(t){
    const n1 = 7.5625, d1 = 2.75;
    if(t < 1/d1) return n1*t*t;
    if(t < 2/d1) return n1*(t-=1.5/d1)*t+0.75;
    if(t < 2.5/d1) return n1*(t-=2.25/d1)*t+0.9375;
    return n1*(t-=2.625/d1)*t+0.984375;
  }

  function springEase(t, curve){
    const omega = 2 * Math.PI / curve.period;
    const zeta = 0.5;
    const omegaZeta = omega * zeta;
    const omegaSqrt = omega * Math.sqrt(1 - zeta*zeta);
    const exp = Math.exp(-omegaZeta * t);
    const cos = Math.cos(omegaSqrt * t);
    const sin = Math.sin(omegaSqrt * t);
    return 1 - exp * (cos + (omegaZeta/omegaSqrt) * sin);
  }

  function evaluate(time){
    const t = Math.max(0, Math.min(1, time / curve.duration));
    const eased = ease(t);
    return curve.startValue + (curve.endValue - curve.startValue) * eased;
  }

  function addKeyframe(time, value, easingType){
    curve._keyframes.push({ time: time, value: value, easing: easingType || EasingType.LINEAR });
    curve._keyframes.sort(function(a, b){ return a.time - b.time; });
  }

  function evaluateKeyframes(time){
    if(curve._keyframes.length === 0) return 0;
    if(time <= curve._keyframes[0].time) return curve._keyframes[0].value;
    if(time >= curve._keyframes[curve._keyframes.length-1].time) return curve._keyframes[curve._keyframes.length-1].value;
    for(let i = 0; i < curve._keyframes.length - 1; i++){
      const k0 = curve._keyframes[i], k1 = curve._keyframes[i+1];
      if(time >= k0.time && time <= k1.time){
        const t = (time - k0.time) / (k1.time - k0.time || 1);
        const prevType = curve.type;
        curve.type = k1.easing;
        const eased = ease(t);
        curve.type = prevType;
        return k0.value + (k1.value - k0.value) * eased;
      }
    }
    return curve._keyframes[0].value;
  }

  function toArray(samples){
    samples = samples || 100;
    const arr = new Float32Array(samples);
    for(let i = 0; i < samples; i++){
      arr[i] = evaluate(i / (samples - 1) * curve.duration);
    }
    return arr;
  }

  function clone(){
    return createAnimationCurve(curve.type, {
      duration: curve.duration,
      startValue: curve.startValue,
      endValue: curve.endValue,
      overshoot: curve.overshoot,
      amplitude: curve.amplitude,
      period: curve.period
    });
  }

  return { evaluate, addKeyframe, evaluateKeyframes, toArray, clone, ease, curve };
}

/* ===== Impostor 系统 =====
   支持: 广告牌LOD / 八面体映射/ 距离切换 / 预渲染*/
function createImpostorSystem(gl, options){
  const sys = {
    gl: gl,
    impostors: [],
    _program: null,
    _vbo: null,
    _initialized: false,
    _views: 8,
    _angles: []
  };

  function init(){
    const gl = sys.gl;
    const vs = `
      attribute vec3 aPosition;
      attribute vec2 aUV;
      attribute float aViewIndex;
      uniform mat4 uViewProj;
      uniform vec3 uCameraRight;
      uniform vec3 uCameraUp;
      uniform float uViewCount;
      varying vec2 vUV;
      varying float vView;
      void main(){
        float angle = aViewIndex / uViewCount * 6.28318;
        vec3 right = vec3(cos(angle), 0.0, sin(angle));
        vec3 up = vec3(0.0, 1.0, 0.0);
        vec3 worldPos = aPosition + right * aUV.x * 2.0 + up * aUV.y * 2.0;
        vUV = aUV;
        vView = aViewIndex;
        gl_Position = uViewProj * vec4(worldPos, 1.0);
      }
    `;
    const fs = `
      precision mediump float;
      uniform sampler2D uImpostorTexture;
      uniform float uViewCount;
      uniform float uTextureWidth;
      varying vec2 vUV;
      varying float vView;
      void main(){
        float viewX = mod(vView, 4.0);
        float viewY = floor(vView / 4.0);
        vec2 uv = vec2((viewX + vUV.x) / 4.0, (viewY + vUV.y) / 2.0);
        vec4 color = texture2D(uImpostorTexture, uv);
        if(color.a < 0.1) discard;
        gl_FragColor = color;
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    sys._program = gl.createProgram();
    gl.attachShader(sys._program, vsh);
    gl.attachShader(sys._program, fsh);
    gl.linkProgram(sys._program);

    sys._vbo = gl.createBuffer();
    sys._initialized = true;
  }

  function createImpostor(mesh, position, size, options){
    const imp = {
      mesh: mesh,
      position: [position[0], position[1], position[2]],
      size: size || 1,
      distance: (options && options.distance) || 50,
      texture: null,
      textureWidth: 256,
      textureHeight: 128,
      views: sys._views,
      _dirty: true
    };
    sys.impostors.push(imp);
    return imp;
  }

  function renderImpostor(imp, viewProj, cameraPosition, cameraRight, cameraUp){
    if(!sys._initialized) return;
    const gl = sys.gl;
    const dist = V3.dist(imp.position, cameraPosition);
    if(dist < imp.distance) return;

    const angle = Math.atan2(cameraPosition[0] - imp.position[0], cameraPosition[2] - imp.position[2]);
    const viewIndex = Math.floor(((angle / (Math.PI * 2) + 0.5) * imp.views) % imp.views);

    const verts = new Float32Array([
      imp.position[0], imp.position[1], imp.position[2], 0, 0, viewIndex,
      imp.position[0], imp.position[1], imp.position[2], 1, 0, viewIndex,
      imp.position[0], imp.position[1], imp.position[2], 1, 1, viewIndex,
      imp.position[0], imp.position[1], imp.position[2], 0, 1, viewIndex
    ]);

    gl.useProgram(sys._program);
    gl.uniformMatrix4fv(gl.getUniformLocation(sys._program, 'uViewProj'), false, viewProj);
    gl.uniform3fv(gl.getUniformLocation(sys._program, 'uCameraRight'), cameraRight);
    gl.uniform3fv(gl.getUniformLocation(sys._program, 'uCameraUp'), cameraUp);
    gl.uniform1f(gl.getUniformLocation(sys._program, 'uViewCount'), imp.views);
    gl.uniform1f(gl.getUniformLocation(sys._program, 'uTextureWidth'), imp.textureWidth);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, imp.texture);
    gl.uniform1i(gl.getUniformLocation(sys._program, 'uImpostorTexture'), 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, sys._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    const posLoc = gl.getAttribLocation(sys._program, 'aPosition');
    const uvLoc = gl.getAttribLocation(sys._program, 'aUV');
    const viewLoc = gl.getAttribLocation(sys._program, 'aViewIndex');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(viewLoc);
    gl.vertexAttribPointer(viewLoc, 1, gl.FLOAT, false, 24, 20);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
  }

  function renderAll(viewProj, cameraPosition, cameraRight, cameraUp){
    for(let i = 0; i < sys.impostors.length; i++){
      renderImpostor(sys.impostors[i], viewProj, cameraPosition, cameraRight, cameraUp);
    }
  }

  function removeImpostor(imp){
    const idx = sys.impostors.indexOf(imp);
    if(idx >= 0) sys.impostors.splice(idx, 1);
  }

  function clear(){
    sys.impostors = [];
  }

  function dispose(){
    const gl = sys.gl;
    if(sys._vbo) gl.deleteBuffer(sys._vbo);
    if(sys._program) gl.deleteProgram(sys._program);
    for(let i = 0; i < sys.impostors.length; i++){
      if(sys.impostors[i].texture) gl.deleteTexture(sys.impostors[i].texture);
    }
  }

  return { init, createImpostor, renderImpostor, renderAll, removeImpostor, clear, dispose, sys };
}

/* ===== 遮挡剔除系统 =====
   支持: 软件光栅化深度缓动/ 层级遮挡 / 保守剔除
*/
function createOcclusionCuller(options){
  const culler = {
    width: (options && options.width) || 256,
    height: (options && options.height) || 256,
    _depthBuffer: null,
    _hierarchy: [],
    _hierarchyLevels: 4,
    _camera: null
  };

  function init(){
    culler._depthBuffer = new Float32Array(culler.width * culler.height);
    for(let i = 0; i < culler._hierarchyLevels; i++){
      const w = Math.max(1, culler.width >> i);
      const h = Math.max(1, culler.height >> i);
      culler._hierarchy.push(new Float32Array(w * h));
    }
    clear();
  }

  function clear(){
    for(let i = 0; i < culler._depthBuffer.length; i++){
      culler._depthBuffer[i] = 1;
    }
    for(let l = 0; l < culler._hierarchyLevels; l++){
      for(let i = 0; i < culler._hierarchy[l].length; i++){
        culler._hierarchy[l][i] = 1;
      }
    }
  }

  function setCamera(viewProj, position){
    culler._camera = { viewProj: viewProj, position: position };
  }

  function projectPoint(point, viewProj){
    const x = viewProj[0]*point[0] + viewProj[4]*point[1] + viewProj[8]*point[2] + viewProj[12];
    const y = viewProj[1]*point[0] + viewProj[5]*point[1] + viewProj[9]*point[2] + viewProj[13];
    const z = viewProj[2]*point[0] + viewProj[6]*point[1] + viewProj[10]*point[2] + viewProj[14];
    const w = viewProj[3]*point[0] + viewProj[7]*point[1] + viewProj[11]*point[2] + viewProj[15];
    if(w <= 0) return null;
    return { x: (x/w + 1) * 0.5 * culler.width, y: (y/w + 1) * 0.5 * culler.height, z: z/w };
  }

  function addOccluder(vertices, indices, viewProj){
    for(let i = 0; i < indices.length; i += 3){
      const v0 = vertices[indices[i]];
      const v1 = vertices[indices[i+1]];
      const v2 = vertices[indices[i+2]];
      const p0 = projectPoint(v0, viewProj);
      const p1 = projectPoint(v1, viewProj);
      const p2 = projectPoint(v2, viewProj);
      if(!p0 || !p1 || !p2) continue;
      rasterizeTriangle(p0, p1, p2);
    }
    buildHierarchy();
  }

  function rasterizeTriangle(p0, p1, p2){
    const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)));
    const maxX = Math.min(culler.width - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
    const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)));
    const maxY = Math.min(culler.height - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));
    const area = (p1.x-p0.x)*(p2.y-p0.y) - (p1.y-p0.y)*(p2.x-p0.x);
    if(Math.abs(area) < 0.001) return;
    for(let y = minY; y <= maxY; y++){
      for(let x = minX; x <= maxX; x++){
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((p1.x-px)*(p2.y-py) - (p1.y-py)*(p2.x-px)) / area;
        const w1 = ((p2.x-px)*(p0.y-py) - (p2.y-py)*(p0.x-px)) / area;
        const w2 = 1 - w0 - w1;
        if(w0 >= 0 && w1 >= 0 && w2 >= 0){
          const z = w0 * p0.z + w1 * p1.z + w2 * p2.z;
          const idx = y * culler.width + x;
          if(z < culler._depthBuffer[idx]){
            culler._depthBuffer[idx] = z;
          }
        }
      }
    }
  }

  function buildHierarchy(){
    for(let l = 1; l < culler._hierarchyLevels; l++){
      const prev = culler._hierarchy[l-1];
      const curr = culler._hierarchy[l];
      const pw = Math.max(1, culler.width >> (l-1));
      const ph = Math.max(1, culler.height >> (l-1));
      const cw = Math.max(1, culler.width >> l);
      const ch = Math.max(1, culler.height >> l);
      for(let y = 0; y < ch; y++){
        for(let x = 0; x < cw; x++){
          let minDepth = 1;
          for(let dy = 0; dy < 2; dy++){
            for(let dx = 0; dx < 2; dx++){
              const px = x*2+dx, py = y*2+dy;
              if(px < pw && py < ph){
                const d = prev[py*pw+px];
                if(d < minDepth) minDepth = d;
              }
            }
          }
          curr[y*cw+x] = minDepth;
        }
      }
    }
  }

  function isOccluded(boundingBox, viewProj){
    const corners = AABB.corners(boundingBox);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, minZ = Infinity;
    for(let i = 0; i < corners.length; i++){
      const p = projectPoint(corners[i], viewProj);
      if(!p) return false;
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      minZ = Math.min(minZ, p.z);
    }
    if(maxX < 0 || minX >= culler.width || maxY < 0 || minY >= culler.height) return false;
    const level = Math.floor(Math.log2(Math.max((maxX-minX), (maxY-minY)) / 4));
    const l = Math.max(0, Math.min(culler._hierarchyLevels - 1, level));
    const hw = Math.max(1, culler.width >> l);
    const hh = Math.max(1, culler.height >> l);
    const sx = Math.max(0, Math.floor(minX / (1 << l)));
    const sy = Math.max(0, Math.floor(minY / (1 << l)));
    const ex = Math.min(hw - 1, Math.ceil(maxX / (1 << l)));
    const ey = Math.min(hh - 1, Math.ceil(maxY / (1 << l)));
    for(let y = sy; y <= ey; y++){
      for(let x = sx; x <= ex; x++){
        if(culler._hierarchy[l][y*hw+x] > minZ) return false;
      }
    }
    return true;
  }

  function getDepthBuffer(){
    return culler._depthBuffer;
  }

  function toImageData(){
    const img = new ImageData(culler.width, culler.height);
    for(let i = 0; i < culler.width * culler.height; i++){
      const d = Math.max(0, Math.min(1, culler._depthBuffer[i]));
      const v = (1 - d) * 255;
      img.data[i*4] = v; img.data[i*4+1] = v; img.data[i*4+2] = v; img.data[i*4+3] = 255;
    }
    return img;
  }

  return { init, clear, setCamera, addOccluder, isOccluded, getDepthBuffer, toImageData, culler };
}
