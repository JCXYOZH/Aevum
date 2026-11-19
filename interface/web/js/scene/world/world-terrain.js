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

  