// ---- terrain shaping --------------------------------------------------
  function smoothstep(a, b, x) {
    var t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  function shapeTerrain(t) {
    var seg = t.segments + 1;
    for (var i = 0; i < seg * seg; i++) {
      var x = t.vertices[i * 3];
      var z = t.vertices[i * 3 + 2];
      var h = t.heightMap[i];
      var ds = Math.sqrt((x - SPAWN[0]) * (x - SPAWN[0]) + (z - SPAWN[1]) * (z - SPAWN[1]));
      var spawnBlend = 1 - smoothstep(7.5, 20.0, ds);
      h = h * (1 - spawnBlend) + 0.0 * spawnBlend;
      var dl = Math.sqrt((x - LAKE[0]) * (x - LAKE[0]) + (z - LAKE[1]) * (z - LAKE[1]));
      var lakeBlend = 1 - smoothstep(13.0, 26.0, dl);
      h = h * (1 - lakeBlend) + (-9.5) * lakeBlend;
      var ridge = smoothstep(58.0, 96.0, -z);
      h += ridge * (10.0 + 8.0 * Math.sin(x * 0.12 + 1.2));
      t.heightMap[i] = h;
      t.vertices[i * 3 + 1] = h;
    }
    t._computeNormals();
    for (var j = 0; j < seg * seg; j++) {
      var hh = t.heightMap[j];
      var ny = t.normals[j * 3 + 1];
      var c0 = 0.16, c1 = 0.22, c2 = 0.10;
      if (hh < WATER_LEVEL - 0.5) { c0 = 0.04; c1 = 0.07; c2 = 0.07; }
      else if (hh < WATER_LEVEL + 0.80) { c0 = 0.32; c1 = 0.28; c2 = 0.18; }
      else if (hh < 6.0) { c0 = 0.16; c1 = 0.22; c2 = 0.10; }
      else if (hh < 13.0) { c0 = 0.22; c1 = 0.21; c2 = 0.17; }
      else { c0 = 0.40; c1 = 0.43; c2 = 0.47; }
      if (ny < 0.56) {
        c0 = c0 * 0.68 + 0.20;
        c1 = c1 * 0.68 + 0.19;
        c2 = c2 * 0.68 + 0.17;
      }
      var patch = 0.5 + 0.5 * Math.sin(x * 0.23 + Math.cos(z * 0.17) * 1.8);
      var patch2 = 0.5 + 0.5 * Math.sin(x * 0.07 - z * 0.11);
      if (hh >= WATER_LEVEL + 0.8 && hh < 6.0) {
        c0 = c0 * (0.76 + 0.26 * patch) + 0.035 * patch2;
        c1 = c1 * (0.86 + 0.18 * patch);
        c2 = c2 * (0.74 + 0.14 * patch) + 0.012 * patch2;
      }
      t.colors[j * 3] = c0;
      t.colors[j * 3 + 1] = c1;
      t.colors[j * 3 + 2] = c2;
    }
    t.built = true;
  }

  // Split the terrain into chunks so TerrainSystem's LOD levels can actually
  // be selected per visible region instead of being generated and ignored.
  function makeTerrainChunkMeshes(terrain, chunkCount) {
    var chunks = [];
    var seg = terrain.segments;
    var srcSeg = seg + 1;
    var cellsPerChunk = seg / chunkCount;
    var chunkWorld = TERRAIN_SIZE / chunkCount;
    var lodDefs = terrain.lodLevels && terrain.lodLevels.length
      ? terrain.lodLevels
      : [{ factor: 1 }, { factor: 2 }, { factor: 4 }, { factor: 8 }];

    for (var cz = 0; cz < chunkCount; cz++) {
      for (var cx = 0; cx < chunkCount; cx++) {
        var x0 = cx * cellsPerChunk;
        var z0 = cz * cellsPerChunk;
        var midX = -TERRAIN_SIZE * 0.5 + (x0 + cellsPerChunk * 0.5) / seg * TERRAIN_SIZE;
        var midZ = -TERRAIN_SIZE * 0.5 + (z0 + cellsPerChunk * 0.5) / seg * TERRAIN_SIZE;
        var center = [midX, terrain.getHeight(midX, midZ), midZ];
        var radius = Math.sqrt(2) * chunkWorld * 0.5 + 18;
        var levels = [];

        for (var li = 0; li < lodDefs.length; li++) {
          var step = lodDefs[li].factor || (1 << li);
          var nx = Math.ceil(cellsPerChunk / step);
          var vertCount = (nx + 1) * (nx + 1);
          var positions = new Float32Array(vertCount * 3);
          var normals = new Float32Array(vertCount * 3);
          var colors = new Float32Array(vertCount * 3);
          var indices = new Uint32Array(nx * nx * 6);
          var vi = 0;

          for (var j = 0; j <= nx; j++) {
            var srcZ = z0 + Math.min(j * step, cellsPerChunk);
            for (var i = 0; i <= nx; i++) {
              var srcX = x0 + Math.min(i * step, cellsPerChunk);
              var src = srcZ * srcSeg + srcX;
              positions[vi * 3] = terrain.vertices[src * 3];
              positions[vi * 3 + 1] = terrain.vertices[src * 3 + 1];
              positions[vi * 3 + 2] = terrain.vertices[src * 3 + 2];
              normals[vi * 3] = terrain.normals[src * 3];
              normals[vi * 3 + 1] = terrain.normals[src * 3 + 1];
              normals[vi * 3 + 2] = terrain.normals[src * 3 + 2];
              colors[vi * 3] = terrain.colors[src * 3];
              colors[vi * 3 + 1] = terrain.colors[src * 3 + 1];
              colors[vi * 3 + 2] = terrain.colors[src * 3 + 2];
              vi++;
            }
          }

          var ii = 0;
          for (var z = 0; z < nx; z++) {
            for (var x = 0; x < nx; x++) {
              var a = z * (nx + 1) + x;
              var b = a + nx + 1;
              indices[ii++] = a; indices[ii++] = b; indices[ii++] = a + 1;
              indices[ii++] = a + 1; indices[ii++] = b; indices[ii++] = b + 1;
            }
          }

          programRef = terrainProgram;
          levels.push({
            mesh: createMesh(positions, normals, colors, indices),
            factor: step,
            distance: lodDefs[li].distance || step * 50
          });
        }

        chunks.push({ center: center, radius: radius, levels: levels });
      }
    }
    return chunks;
  }

  // ---- streaming terrain ------------------------------------------------
  // The original terrain remains the height/vegetation source near spawn.
  // Outside its bounds the same deterministic noise is extended and blended
  // into a visible ring of streamed chunks.
  var STREAM_CHUNK_SIZE = 64;
  var STREAM_CHUNK_SEGMENTS = 20;
  var STREAM_RADIUS = 4;
  var STREAM_GRASS_PER_CHUNK = 0;
  var streamChunks = new Map();
  var streamNoise = null;
  var detailGrassMesh = null;
  var detailGrassKey = '';

  function streamProceduralHeight(x, z) {
    if (!streamNoise) {
      streamNoise = new window.World3DEngine.TerrainSystem(1, 1, 1);
      streamNoise.noiseOctaves = 5;
      streamNoise.noiseScale = 0.018;
      streamNoise.noiseAmplitude = 26;
      streamNoise.seed = 20261118;
    }
    return streamNoise._fractalNoise(x * 0.018, z * 0.018) * 26;
  }

  function streamHeightAt(terrain, x, z) {
    var edge = TERRAIN_SIZE * 0.5;
    var ax = Math.abs(x);
    var az = Math.abs(z);
    if (ax <= edge && az <= edge) return terrain.getHeight(x, z);
    var insideX = Math.max(-edge, Math.min(edge, x));
    var insideZ = Math.max(-edge, Math.min(edge, z));
    var edgeHeight = terrain.getHeight(insideX, insideZ);
    var outside = Math.max(ax, az) - edge;
    var blend = smoothstep(0, 120, outside);
    return edgeHeight * (1 - blend) + streamProceduralHeight(x, z) * blend;
  }

  function streamHash(cx, cz, seed) {
    var h = (cx * 374761393 + cz * 668265263 + seed * 1442695041) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967295;
  }

  function makeStreamChunkVegetation(terrain, cx, cz, centerX, centerZ) {
    var trees = [];
    var grass = [];
    var treeMesh = null;
    var grassMesh = null;
    if (Math.sqrt(centerX * centerX + centerZ * centerZ) > 105) {
      for (var ti = 0; ti < 20; ti++) {
        var tx = cx * STREAM_CHUNK_SIZE + 5 + streamHash(cx, cz, ti * 3 + 1) * (STREAM_CHUNK_SIZE - 10);
        var tz = cz * STREAM_CHUNK_SIZE + 5 + streamHash(cx, cz, ti * 3 + 2) * (STREAM_CHUNK_SIZE - 10);
        var ty = streamHeightAt(terrain, tx, tz);
        if (ty < WATER_LEVEL + 0.7) continue;
        trees.push({
          x: tx, y: ty, z: tz,
          scale: 0.8 + streamHash(cx, cz, ti * 3 + 3) * 0.7,
          type: streamHash(cx, cz, ti * 3 + 4) > 0.72 ? 'birch' : 'pine',
          color: streamHash(cx, cz, ti * 3 + 5) > 0.5 ? [0.42, 0.62, 0.24] : [0.36, 0.54, 0.20]
        });
      }
      if (trees.length) treeMesh = makeTreeMesh(trees);
    }
    if (Math.sqrt(centerX * centerX + centerZ * centerZ) > 36) {
      for (var gi = 0; gi < STREAM_GRASS_PER_CHUNK; gi++) {
        var gx = cx * STREAM_CHUNK_SIZE + 2 + streamHash(cx, cz, 1000 + gi * 3) * (STREAM_CHUNK_SIZE - 4);
        var gz = cz * STREAM_CHUNK_SIZE + 2 + streamHash(cx, cz, 1001 + gi * 3) * (STREAM_CHUNK_SIZE - 4);
        var gy = streamHeightAt(terrain, gx, gz);
        if (gy < WATER_LEVEL + 0.4) continue;
        grass.push({
          x: gx, y: gy, z: gz,
          height: 0.34 + streamHash(cx, cz, 1002 + gi * 3) * 0.5,
          width: 0.07 + streamHash(cx, cz, 1003 + gi * 3) * 0.08,
          rotation: streamHash(cx, cz, 1004 + gi * 3) * Math.PI * 2,
          color: [0.34, 0.62, 0.18]
        });
      }
      if (grass.length) grassMesh = makeGrassMesh(grass);
    }
    return { treeMesh: treeMesh, grassMesh: grassMesh, trees: trees };
  }

  function makeStreamChunkMesh(terrain, cx, cz) {
    var size = STREAM_CHUNK_SIZE;
    var seg = STREAM_CHUNK_SEGMENTS;
    var originX = cx * size;
    var originZ = cz * size;
    var n = seg + 1;
    var positions = new Float32Array(n * n * 3);
    var normals = new Float32Array(n * n * 3);
    var colors = new Float32Array(n * n * 3);
    var indices = new Uint32Array(seg * seg * 6);
    var vi = 0;
    var eps = 0.8;
    for (var j = 0; j <= seg; j++) {
      for (var i = 0; i <= seg; i++) {
        var wx = originX + i / seg * size;
        var wz = originZ + j / seg * size;
        var h = streamHeightAt(terrain, wx, wz);
        var hx = streamHeightAt(terrain, wx + eps, wz) - streamHeightAt(terrain, wx - eps, wz);
        var hz = streamHeightAt(terrain, wx, wz + eps) - streamHeightAt(terrain, wx, wz - eps);
        var nx = -hx, ny = 2 * eps, nz = -hz;
        var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        positions[vi * 3] = wx;
        positions[vi * 3 + 1] = h;
        positions[vi * 3 + 2] = wz;
        normals[vi * 3] = nx;
        normals[vi * 3 + 1] = ny;
        normals[vi * 3 + 2] = nz;
        var rock = ny < 0.55;
        var snow = h > 22 && ny > 0.6;
        var cr = rock ? 0.36 : 0.24, cg = rock ? 0.33 : 0.44, cb = rock ? 0.29 : 0.16;
        if (snow) { cr = 0.78; cg = 0.80; cb = 0.82; }
        colors[vi * 3] = cr;
        colors[vi * 3 + 1] = cg;
        colors[vi * 3 + 2] = cb;
        vi++;
      }
    }
    var ii = 0;
    for (var z = 0; z < seg; z++) {
      for (var x = 0; x < seg; x++) {
        var a = z * n + x;
        var b = a + n;
        indices[ii++] = a; indices[ii++] = b; indices[ii++] = a + 1;
        indices[ii++] = a + 1; indices[ii++] = b; indices[ii++] = b + 1;
      }
    }
    programRef = terrainProgram;
    return createMesh(positions, normals, colors, indices);
  }

  function disposeMesh(mesh) {
    if (!mesh) return;
    gl.deleteVertexArray(mesh.vao);
    if (mesh.ibo) gl.deleteBuffer(mesh.ibo);
    var buffers = mesh.buffers || [];
    for (var i = 0; i < buffers.length; i++) gl.deleteBuffer(buffers[i]);
  }

  function disposeStreamChunk(chunk) {
    if (!chunk) return;
    if (chunk.levels) {
      for (var i = 0; i < chunk.levels.length; i++) disposeMesh(chunk.levels[i].mesh);
    }
    disposeMesh(chunk.treeMesh);
    disposeMesh(chunk.grassMesh);
  }

  function rebuildDetailGrass(terrain, pcx, pcz, centerX, centerZ) {
    disposeMesh(detailGrassMesh);
    detailGrassMesh = null;
    var locations = [];
    var grid = 0;
    for (var dz = -1; dz <= 1; dz++) {
      for (var dx = -1; dx <= 1; dx++) {
        var cx = pcx + dx;
        var cz = pcz + dz;
        if (Math.sqrt((cx * STREAM_CHUNK_SIZE + 32) * (cx * STREAM_CHUNK_SIZE + 32) +
          (cz * STREAM_CHUNK_SIZE + 32) * (cz * STREAM_CHUNK_SIZE + 32)) < 36) continue;
        for (var gi = 0; gi < 2200; gi++) {
          var gx = cx * STREAM_CHUNK_SIZE + 2 + streamHash(cx, cz, 5000 + gi * 3) * (STREAM_CHUNK_SIZE - 4);
          var gz = cz * STREAM_CHUNK_SIZE + 2 + streamHash(cx, cz, 5001 + gi * 3) * (STREAM_CHUNK_SIZE - 4);
          var gy = streamHeightAt(terrain, gx, gz);
          if (gy < WATER_LEVEL + 0.4) continue;
          locations.push({
            x: gx, y: gy, z: gz,
            height: 0.12 + streamHash(cx, cz, 5002 + gi * 3) * 0.20,
            width: 0.018 + streamHash(cx, cz, 5003 + gi * 3) * 0.016,
            rotation: streamHash(cx, cz, 5004 + gi * 3) * Math.PI * 2,
            color: [0.30, 0.56, 0.18]
          });
          grid++;
        }
      }
    }
    if (locations.length) detailGrassMesh = makeGrassMesh(locations);
    document.documentElement.setAttribute('data-detail-grass', String(locations.length));
  }

  function updateTerrainStream(terrain, px, pz) {
    var size = STREAM_CHUNK_SIZE;
    var radius = STREAM_RADIUS;
    var pcx = Math.floor(px / size);
    var pcz = Math.floor(pz / size);
    for (var dz = -radius; dz <= radius; dz++) {
      for (var dx = -radius; dx <= radius; dx++) {
        var cx = pcx + dx;
        var cz = pcz + dz;
        var key = cx + ',' + cz;
        if (streamChunks.has(key)) continue;
        var mesh = makeStreamChunkMesh(terrain, cx, cz);
        var centerX = cx * size + size * 0.5;
        var centerZ = cz * size + size * 0.5;
        var centerY = streamHeightAt(terrain, centerX, centerZ);
        var vegetation = makeStreamChunkVegetation(terrain, cx, cz, centerX, centerZ);
        streamChunks.set(key, {
          cx: cx, cz: cz,
          center: [centerX, centerY, centerZ],
          radius: Math.sqrt(2) * size * 0.5 + 8,
          treeMesh: vegetation.treeMesh,
          grassMesh: vegetation.grassMesh,
          trees: vegetation.trees,
          levels: [{ mesh: mesh, factor: 1, distance: 0 }]
        });
      }
    }
    streamChunks.forEach(function (chunk, key) {
      if (Math.abs(chunk.cx - pcx) > radius + 1 || Math.abs(chunk.cz - pcz) > radius + 1) {
        disposeStreamChunk(chunk);
        streamChunks.delete(key);
      }
    });
    terrainChunks = [];
    var streamTreeCount = 0;
    var streamGrassCount = 0;
    var streamGrassVerts = 0;
    streamChunks.forEach(function (chunk) {
      terrainChunks.push(chunk);
      if (chunk.treeMesh) streamTreeCount++;
      if (chunk.grassMesh) {
        streamGrassCount++;
        streamGrassVerts += chunk.grassMesh.count;
      }
    });
    document.documentElement.setAttribute('data-stream-veg', JSON.stringify({
      trees: streamTreeCount, grass: streamGrassCount,
      grassVerts: streamGrassVerts, chunks: terrainChunks.length
    }));
    var detailKey = pcx + ',' + pcz;
    if (detailKey !== detailGrassKey) {
      detailGrassKey = detailKey;
      rebuildDetailGrass(terrain, pcx, pcz);
    }
    if (window.AevumMarkGraphics) window.AevumMarkGraphics('TerrainStream');
  }

