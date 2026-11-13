/* ===== 场景序列化系统 =====
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
    throw new Error('无效的场景格式: ' + data.type);
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



/* ===== 程序化几何生成系统（高级） =====
   支持: 元球 / Voronoi / 分形地形 / 参数化曲面 / 螺旋 / 环面结
*/
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
