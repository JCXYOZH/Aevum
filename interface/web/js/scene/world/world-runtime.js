  // ---- runtime -----------------------------------------------------------
  var world = null;
  var fog = null;
  var skyMesh = null;
  var terrainMesh = null;
  var waterMesh = null;
  var treeMesh = null;
  var flowerMesh = null;
  var grassMesh = null;
  var treeGroups = [];
  var grassGroups = [];
  var terrainChunks = [];
  var advancedWater = null;
  var extShaderCompiler = null;
  var birdMesh = null;
  var fireflyMesh = null;
  var birdObjects = [];
  var fireflyObjects = [];
  var sunColor = [1, 0.95, 0.84];

  function buildVegetationGroups(list, meshFn, radius) {
    var groups = [];
    for (var sx = -1; sx <= 1; sx += 2) {
      for (var sz = -1; sz <= 1; sz += 2) {
        var subset = list.filter(function (p) {
          return (sx < 0 ? p.x < 0 : p.x >= 0) && (sz < 0 ? p.z < 0 : p.z >= 0);
        });
        if (!subset.length) continue;
        groups.push({
          mesh: meshFn(subset),
          center: [sx * 34, charPos[1] + 2, sz * 34],
          radius: radius,
          count: subset.length
        });
      }
    }
    return groups;
  }
  var shadowMesh = null;
  var trees = [];
  var grass = [];
  var modelRenderer = null;
  var vrm = null;
  var player = null;
  var clip = 'run';
  var retarget = null;
  var modelMatrix = M4.create();
  var modelBaseY = 0;
  var proceduralSkeleton = null;
  var proceduralMotion = null;
  var proceduralChestBone = null;
  var birdPicker = null;
  var birdPickables = [];
  var pickerCamera = null;
  var grassWindCompute = null;
  var grassWindUBO = null;
  var grassWindVAO = null;
  var grassWindBlock = -1;
  var skinMaterial = null;
  var charPos = [0, 0, 0];
  var charScale = 1;
  var eye = [0, 5, 12];
  var target = [0, 1.5, 0];
  var viewProj = M4.create();
  var cameraPos = eye;
  var last = performance.now();
  var start = last;

  function styleSky() {
    if (!world) return;
    var sun = world.dayNight ? world.dayNight.getSunPosition() : world.sky.getSunDirection();
    var h = Math.max(0, Math.min(1, sun[1] * 1.1));
    var dusk = Math.max(0, 1 - h * 1.7);
    var overcast = world.weather ? Math.min(1, world.weather.getCloudCoverage()) : 0;
    var skyR = 0.10 + 0.22 * h + 0.05 * dusk;
    var skyG = 0.27 + 0.25 * h + 0.02 * dusk;
    var skyB = 0.50 + 0.24 * h;
    var horR = 0.48 + 0.23 * h + 0.22 * dusk;
    var horG = 0.49 + 0.20 * h + 0.08 * dusk;
    var horB = 0.48 + 0.24 * h;
    var oc = overcast * 0.88;
    world.sky.skyColor = [
      skyR * (1 - oc) + 0.38 * oc,
      skyG * (1 - oc) + 0.43 * oc,
      skyB * (1 - oc) + 0.50 * oc
    ];
    world.sky.horizonColor = [
      horR * (1 - oc) + 0.52 * oc,
      horG * (1 - oc) + 0.55 * oc,
      horB * (1 - oc) + 0.58 * oc
    ];
    world.sky.fogColor = [
      (0.54 + 0.16 * h + 0.10 * dusk) * (1 - oc) + 0.48 * oc,
      (0.59 + 0.14 * h + 0.04 * dusk) * (1 - oc) + 0.51 * oc,
      (0.64 + 0.14 * h) * (1 - oc) + 0.55 * oc
    ];
  }

  function sunDirectionFor(time) {
    var angle = time * Math.PI * 2 - Math.PI / 2;
    // Keep the sun in front of the default desktop camera and let its height
    // change across the day. The narrow X arc keeps it inside the wide-but-
    // portrait desktop viewport instead of sliding off the side.
    return normalize3([Math.cos(angle) * 0.22, Math.sin(angle) * 0.55, -1.0]);
  }

  function setupWorldCamera() {    var ground = world ? world.terrain.getHeight(SPAWN[0], SPAWN[1]) : 0;
    charPos = [SPAWN[0], ground, SPAWN[1]];
    eye = [0.75, ground + 2.55, 6.8];
    target = [0, ground + 1.42, 0];
    var view = M4.lookAt(M4.create(), eye, target, [0, 1, 0]);
    var proj = M4.perspective(M4.create(), FOV, W / H, 0.08, 700);
    M4.mult(viewProj, view, proj);
  }

  function updateCamera() {
    if (renderOnly && typeof window.AEVUM_WORLD_CAMERA === 'function') {
      var external = window.AEVUM_WORLD_CAMERA();
      if (external) {
        eye = external.position;
        target = external.target;
        FOV = external.fov;
        W = Math.max(1, external.width || canvasWorld.width || W);
        H = Math.max(1, external.height || canvasWorld.height || H);
      }
    }
    var view = M4.lookAt(M4.create(), eye, target, [0, 1, 0]);
    var proj = M4.perspective(M4.create(), FOV, W / H, 0.08, 700);
    M4.mult(viewProj, view, proj);
    cameraPos = eye;
    if (world && world.camera) {
      world.camera.position = [eye[0], eye[1], eye[2]];
      world.camera.target = [target[0], target[1], target[2]];
      world.camera.fov = FOV * 180 / Math.PI;
      world.camera.aspect = W / H;
      world.camera.update(0);
    }
  }

  function drawSky() {
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(skyProgram);
    var sky = world.sky;
    var sun = sky.getSunDirection();
    var skyTop = sky.getSkyColor();
    var horizon = sky.getHorizonColor();
    var groundColor = sky.groundColor || [0.4, 0.35, 0.3];
    var sunColor = sky.getSunColor();
    var cloud = world.weather ? world.weather.getCloudCoverage() : 0;
    gl.uniformMatrix4fv(uniformLocation(skyProgram, 'uViewProj'), false, viewProj);
    gl.uniform3fv(uniformLocation(skyProgram, 'uCenter'), new Float32Array(cameraPos));
    gl.uniform3fv(uniformLocation(skyProgram, 'uSkyTop'), new Float32Array(skyTop));
    gl.uniform3fv(uniformLocation(skyProgram, 'uSkyHorizon'), new Float32Array(horizon));
    gl.uniform3fv(uniformLocation(skyProgram, 'uGroundColor'), new Float32Array(groundColor));
    gl.uniform3fv(uniformLocation(skyProgram, 'uSunDir'), new Float32Array(normalize3(sun)));
    gl.uniform3fv(uniformLocation(skyProgram, 'uSunColor'), new Float32Array(sunColor));
    gl.uniform3fv(uniformLocation(skyProgram, 'uCloudColor'), new Float32Array([0.88, 0.91, 0.93]));
    gl.uniform1f(uniformLocation(skyProgram, 'uCloud'), cloud);
    var sunNormal = normalize3(sun);
    var starVisibility = Math.max(0, -sunNormal[1] * 7.0);
    starVisibility = Math.min(1, starVisibility);
    gl.uniform1f(uniformLocation(skyProgram, 'uStar'), starVisibility);
    gl.uniform1f(uniformLocation(skyProgram, 'uTime'), world.time || 0);
    gl.uniform1f(uniformLocation(skyProgram, 'uFlash'), world.weather && world.weather.isThundering() ? 0.62 : 0);
    gl.bindVertexArray(skyMesh.vao);
    gl.drawElements(gl.TRIANGLES, skyMesh.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }

  function bindShadow(prog) {
    gl.uniformMatrix4fv(uniformLocation(prog, 'uLightVPs[0]'), false, shadowVPData);
    var dists = world && world.shadows && world.shadows.cascadeDistances;
    if (!dists) dists = [18, 54, 108, 180];
    gl.uniform4f(uniformLocation(prog, 'uShadowDistances'), dists[0], dists[1], dists[2], dists[3]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.uniform1i(uniformLocation(prog, 'uShadowMap'), 1);
    gl.uniform1f(uniformLocation(prog, 'uShadowBias'), 0.0022);
  }

  function drawTerrain() {
    gl.useProgram(terrainProgram);
    var light = world.lights.directionalLight;
    var ambient = world.lights.ambientLight;
    gl.uniformMatrix4fv(uniformLocation(terrainProgram, 'uViewProj'), false, viewProj);
    gl.uniform3fv(uniformLocation(terrainProgram, 'uSunDir'), new Float32Array(normalize3(light.direction)));
    gl.uniform3fv(uniformLocation(terrainProgram, 'uSunColor'), new Float32Array([light.color[0] * light.intensity, light.color[1] * light.intensity, light.color[2] * light.intensity]));
    gl.uniform3fv(uniformLocation(terrainProgram, 'uAmbient'), new Float32Array([ambient.color[0] * ambient.intensity, ambient.color[1] * ambient.intensity, ambient.color[2] * ambient.intensity]));
    gl.uniform3fv(uniformLocation(terrainProgram, 'uFogColor'), new Float32Array(world.sky.fogColor));
    gl.uniform1f(uniformLocation(terrainProgram, 'uFogDensity'), 0.0015);
    gl.uniform3fv(uniformLocation(terrainProgram, 'uCameraPos'), new Float32Array(cameraPos));
    bindShadow(terrainProgram);
    if (terrainChunks.length) {
      // All chunks must use the same LOD: per-chunk LOD selection creates
      // T-junction cracks at chunk borders, which read as bright ridge lines.
      var nearestChunkDistance = Infinity;
      for (var n = 0; n < terrainChunks.length; n++) {
        var ndx = terrainChunks[n].center[0] - cameraPos[0];
        var ndz = terrainChunks[n].center[2] - cameraPos[2];
        nearestChunkDistance = Math.min(nearestChunkDistance, Math.sqrt(ndx * ndx + ndz * ndz));
      }
      var globalLod = world.terrain.getLODLevel(nearestChunkDistance);
      for (var c = 0; c < terrainChunks.length; c++) {
        var chunk = terrainChunks[c];
        // Draw all 16 chunks. Frustum-culling a chunk by its bounding sphere
        // can drop the near ground plane while the camera orbits, which reads
        // as a black lower half. Sixteen draws are cheap enough to keep.
        var level = chunk.levels[globalLod] || chunk.levels[chunk.levels.length - 1];
        gl.bindVertexArray(level.mesh.vao);
        gl.drawElements(gl.TRIANGLES, level.mesh.count, gl.UNSIGNED_INT, 0);
      }
    } else {
      gl.bindVertexArray(terrainMesh.vao);
      gl.drawElements(gl.TRIANGLES, terrainMesh.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  function drawTrees() {
    if (!treeGroups.length) return;
    gl.useProgram(terrainProgram);
    var light = world.lights.directionalLight;
    var ambient = world.lights.ambientLight;
    gl.uniformMatrix4fv(uniformLocation(terrainProgram, 'uViewProj'), false, viewProj);
    gl.uniform3fv(uniformLocation(terrainProgram, 'uSunDir'), new Float32Array(normalize3(light.direction)));
    gl.uniform3fv(uniformLocation(terrainProgram, 'uSunColor'), new Float32Array([light.color[0] * light.intensity, light.color[1] * light.intensity, light.color[2] * light.intensity]));
    gl.uniform3fv(uniformLocation(terrainProgram, 'uAmbient'), new Float32Array([ambient.color[0] * ambient.intensity, ambient.color[1] * ambient.intensity, ambient.color[2] * ambient.intensity]));
    gl.uniform3fv(uniformLocation(terrainProgram, 'uFogColor'), new Float32Array(world.sky.fogColor));
    gl.uniform1f(uniformLocation(terrainProgram, 'uFogDensity'), 0.0015);
    gl.uniform3fv(uniformLocation(terrainProgram, 'uCameraPos'), new Float32Array(cameraPos));
    bindShadow(terrainProgram);
    for (var i = 0; i < treeGroups.length; i++) {
      var g = treeGroups[i];
      if (world.frustumCulling && !world.frustumCulling.isVisible(g.center, g.radius)) continue;
      gl.bindVertexArray(g.mesh.vao);
      gl.drawElements(gl.TRIANGLES, g.mesh.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  function initCharacterSkin() {
    if (!window.SpiritSkin || !window.SpiritSkin.SkinMaterial) {
      throw new Error('SpiritSkin.SkinMaterial is required for character skin');
    }
    skinMaterial = new window.SpiritSkin.SkinMaterial();
    skinMaterial.setSSS({
      enabled: true,
      intensity: 0.8,
      radius: [0.002, 0.010, 0.030],
      color: [1.0, 0.60, 0.40],
      distortion: 0.4,
      power: 2.0,
      scale: 1.0
    });
    skinMaterial.setSheen({
      enabled: true,
      color: [1.0, 0.80, 0.70],
      roughness: 0.5,
      intensity: 0.30
    });
    skinMaterial.setClearcoat({ enabled: true, intensity: 0.08, roughness: 0.10 });
    markGraphics('SpiritSkin');
  }

  function initGraphicsEntry() {
    if (!window.OrbWebGLCore) throw new Error('OrbWebGLCore entry is required');
    window.OrbWebGLCore.init();
    markGraphics('OrbWebGLCore');
  }

  function initGrassWindCompute() {
    if (!window.WebGLCoreExt || !window.WebGLCoreExt.ComputeSimulator) {
      throw new Error('WebGLCoreExt.ComputeSimulator is required; inline grass wind is removed');
    }
    grassWindCompute = new window.WebGLCoreExt.ComputeSimulator({ getContext: function () { return gl; } });
    if (!grassWindCompute.isSupported()) throw new Error('GPU transform feedback is required for grass wind');
    var phases = new Float32Array(64);
    for (var p = 0; p < 64; p++) phases[p] = p * 0.73;
    var phaseBuffer = grassWindCompute.createBuffer('grass-wind-phase', phases, gl.STATIC_DRAW);
    var computeVertex = '#version 300 es\n' +
      'layout(location = 0) in float aPhase;\n' +
      'uniform float uTime;\n' +
      'out vec4 vOffset;\n' +
      'void main(){\n' +
      '  float s = sin(uTime * 1.25 + aPhase);\n' +
      '  vOffset = vec4(s * 0.11, 0.0, cos(uTime * 0.85 + aPhase) * 0.05, 1.0);\n' +
      '  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);\n' +
      '}';
    grassWindCompute.createComputeProgram('grass-wind', computeVertex, ['vOffset']);
    grassWindUBO = grassWindCompute.createBuffer('grass-wind-output', new Float32Array(64 * 4), gl.DYNAMIC_DRAW);
    grassWindCompute.createTransformFeedback('grass-wind-feedback', [grassWindUBO]);
    grassWindVAO = gl.createVertexArray();
    gl.bindVertexArray(grassWindVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, phaseBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    grassWindBlock = gl.getUniformBlockIndex(grassProgram, 'GrassWind');
    if (grassWindBlock === 0xFFFFFFFF) throw new Error('GrassWind UBO block is missing');
    gl.uniformBlockBinding(grassProgram, grassWindBlock, 1);
    markGraphics('gl-compute-post');
  }

  function updateGrassWind(time) {
    if (!grassWindCompute) return;
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 1, null);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(grassWindVAO);
    grassWindCompute.dispatch('grass-wind', 'grass-wind-feedback', 64, { uTime: time });
    gl.bindVertexArray(null);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 1, grassWindUBO);
    markGraphics('gl-compute-post');
  }

  function drawGrass(time) {
    if (!grassGroups.length) return;
    updateGrassWind(time);
    gl.useProgram(grassProgram);
    var light = world.lights.directionalLight;
    var ambient = world.lights.ambientLight;
    gl.uniformMatrix4fv(uniformLocation(grassProgram, 'uViewProj'), false, viewProj);
    gl.uniform1f(uniformLocation(grassProgram, 'uTime'), time);
    gl.uniform3fv(uniformLocation(grassProgram, 'uSunDir'), new Float32Array(normalize3(light.direction)));
    gl.uniform3fv(uniformLocation(grassProgram, 'uSunColor'), new Float32Array([light.color[0] * light.intensity, light.color[1] * light.intensity, light.color[2] * light.intensity]));
    gl.uniform3fv(uniformLocation(grassProgram, 'uAmbient'), new Float32Array([ambient.color[0] * ambient.intensity, ambient.color[1] * ambient.intensity, ambient.color[2] * ambient.intensity]));
    gl.uniform3fv(uniformLocation(grassProgram, 'uFogColor'), new Float32Array(world.sky.fogColor));
    gl.uniform1f(uniformLocation(grassProgram, 'uFogDensity'), 0.0015);
    gl.uniform3fv(uniformLocation(grassProgram, 'uCameraPos'), new Float32Array(cameraPos));
    bindShadow(grassProgram);
    for (var i = 0; i < grassGroups.length; i++) {
      var g = grassGroups[i];
      if (world.frustumCulling && !world.frustumCulling.isVisible(g.center, g.radius)) continue;
      gl.bindVertexArray(g.mesh.vao);
      gl.drawElements(gl.TRIANGLES, g.mesh.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  function drawWater() {
    if (!waterMesh) return;
    gl.useProgram(waterProgram);
    var water = world.water;
    var waves = new Float32Array(8 * 4);
    var phases = new Float32Array(8);
    for (var i = 0; i < 8; i++) {
      var w = water.waves[i];
      waves[i * 4] = w.direction[0];
      waves[i * 4 + 1] = w.direction[1];
      waves[i * 4 + 2] = w.frequency;
      waves[i * 4 + 3] = w.amplitude;
      phases[i] = w.phase;
    }
    var sky = world.sky;
    var gerstner = new Float32Array(16);
    var gerstnerSpeed = new Float32Array(4);
    var fallbackWaves = [
      { direction: [1, 0.3], steepness: 0.06, wavelength: 8, speed: 1 },
      { direction: [0.5, 1], steepness: 0.05, wavelength: 5, speed: 1.2 },
      { direction: [-0.7, 0.5], steepness: 0.04, wavelength: 3, speed: 1.5 },
      { direction: [0.3, -0.8], steepness: 0.03, wavelength: 2, speed: 1.8 }
    ];
    var waveSource = advancedWater && advancedWater.waves.length ? advancedWater.waves : fallbackWaves;
    for (var g = 0; g < 4; g++) {
      var gw = waveSource[g] || fallbackWaves[g];
      gerstner[g * 4] = gw.direction[0];
      gerstner[g * 4 + 1] = gw.direction[1];
      gerstner[g * 4 + 2] = gw.steepness;
      gerstner[g * 4 + 3] = gw.wavelength;
      gerstnerSpeed[g] = gw.speed || 1;
    }
    var waterColor = advancedWater ? advancedWater.waterColor : water.waterColor;
    var deepColor = advancedWater ? advancedWater.deepColor : [0.02, 0.05, 0.10];
    var shallowColor = advancedWater ? advancedWater.shallowColor : [0.12, 0.30, 0.36];
    gl.uniformMatrix4fv(uniformLocation(waterProgram, 'uViewProj'), false, viewProj);
    gl.uniform4fv(uniformLocation(waterProgram, 'uWaves[0]'), waves);
    gl.uniform1fv(uniformLocation(waterProgram, 'uPhases[0]'), phases);
    gl.uniform4fv(uniformLocation(waterProgram, 'uGerstner[0]'), gerstner);
    gl.uniform1fv(uniformLocation(waterProgram, 'uGerstnerSpeed[0]'), gerstnerSpeed);
    gl.uniform1f(uniformLocation(waterProgram, 'uGerstnerTime'), advancedWater ? advancedWater.time : world.time);
    gl.uniform1f(uniformLocation(waterProgram, 'uWaterLevel'), water.waterLevel);
    gl.uniform3fv(uniformLocation(waterProgram, 'uSunDir'), new Float32Array(normalize3(world.lights.directionalLight.direction)));
    gl.uniform3fv(uniformLocation(waterProgram, 'uSunColor'), new Float32Array(world.lights.directionalLight.color));
    gl.uniform3fv(uniformLocation(waterProgram, 'uSkyTop'), new Float32Array(sky.getSkyColor()));
    gl.uniform3fv(uniformLocation(waterProgram, 'uSkyHorizon'), new Float32Array(sky.getHorizonColor()));
    gl.uniform3fv(uniformLocation(waterProgram, 'uCameraPos'), new Float32Array(cameraPos));
    gl.uniform3fv(uniformLocation(waterProgram, 'uWaterColor'), new Float32Array(waterColor.slice(0, 3)));
    gl.uniform3fv(uniformLocation(waterProgram, 'uDeepColor'), new Float32Array(deepColor));
    gl.uniform3fv(uniformLocation(waterProgram, 'uShallowColor'), new Float32Array(shallowColor));
    gl.uniform1f(uniformLocation(waterProgram, 'uFoam'), advancedWater ? advancedWater.foamIntensity : 0.5);
    gl.uniform1f(uniformLocation(waterProgram, 'uCaustic'), advancedWater ? advancedWater.causticIntensity : 0.3);
    gl.uniform1f(uniformLocation(waterProgram, 'uAlpha'), advancedWater ? advancedWater.transparency : 0.72);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(waterMesh.vao);
    gl.drawElements(gl.TRIANGLES, waterMesh.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  function drawRain() {
    if (!world.weather || !rainVAO) return;
    var particles = world.weather.getParticles();
    var n = 0;
    for (var i = 0; i < particles.length && n < 3000; i++) {
      var p = particles[i];
      if (p.type !== 'rain' || p.y < -2) continue;
      var base = n * 6;
      rainData[base] = p.x; rainData[base + 1] = p.y; rainData[base + 2] = p.z;
      rainData[base + 3] = p.x + (p.vx || 0) * 0.045;
      rainData[base + 4] = p.y + (p.vy || -24) * 0.065;
      rainData[base + 5] = p.z + (p.vz || 0) * 0.045;
      n += 1;
    }
    if (!n) return;
    gl.bindVertexArray(rainVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, rainBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, rainData.subarray(0, n * 6));
    gl.useProgram(rainProgram);
    gl.uniformMatrix4fv(uniformLocation(rainProgram, 'uViewProj'), false, viewProj);
    gl.uniform3fv(uniformLocation(rainProgram, 'uColor'), new Float32Array([0.72, 0.84, 0.92]));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawArrays(gl.LINES, 0, n * 2);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  function drawSnow() {
    if (!world.weather || !snowVAO) return;
    var particles = world.weather.getParticles();
    var n = 0;
    for (var i = 0; i < particles.length && n < 3000; i++) {
      var p = particles[i];
      if (p.type !== 'snow' || p.y < -2) continue;
      var base = n * 6;
      snowData[base] = p.x; snowData[base + 1] = p.y; snowData[base + 2] = p.z;
      snowData[base + 3] = p.x + 0.035; snowData[base + 4] = p.y - 0.18; snowData[base + 5] = p.z + 0.02;
      n += 1;
    }
    if (!n) return;
    gl.bindVertexArray(snowVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, snowBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, snowData.subarray(0, n * 6));
    gl.useProgram(snowProgram);
    gl.uniformMatrix4fv(uniformLocation(snowProgram, 'uViewProj'), false, viewProj);
    gl.uniform3fv(uniformLocation(snowProgram, 'uColor'), new Float32Array([0.92, 0.96, 1.0]));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.drawArrays(gl.LINES, 0, n * 2);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  function drawObjects() {
    if (!world || !birdMesh) return;
    var visible = world.getVisibleObjects();
    gl.useProgram(objectProgram);
    gl.uniformMatrix4fv(uniformLocation(objectProgram, 'uViewProj'), false, viewProj);
    gl.uniform3fv(uniformLocation(objectProgram, 'uSunDir'), new Float32Array(normalize3(world.lights.directionalLight.direction)));
    gl.uniform3fv(uniformLocation(objectProgram, 'uSunColor'), new Float32Array(world.lights.directionalLight.color));
    gl.uniform3fv(uniformLocation(objectProgram, 'uAmbient'), new Float32Array(world.lights.ambientLight.color));
    for (var i = 0; i < visible.length; i++) {
      var obj = visible[i];
      if (!obj.mesh) continue;
      var s = obj.scale || 1;
      var yaw = obj.yaw || 0;
      var c = Math.cos(yaw) * s, sn = Math.sin(yaw) * s;
      var m = M4.create();
      m[0] = c; m[2] = -sn; m[8] = sn; m[10] = c;
      m[5] = s; m[12] = obj.position[0]; m[13] = obj.position[1]; m[14] = obj.position[2]; m[15] = 1;
      gl.uniformMatrix4fv(uniformLocation(objectProgram, 'uModel'), false, m);
      gl.uniform3fv(uniformLocation(objectProgram, 'uColor'), new Float32Array(obj.color || [0.14, 0.15, 0.18]));
      gl.uniform1f(uniformLocation(objectProgram, 'uGlow'), obj.glow || 0);
      gl.bindVertexArray(obj.mesh.vao);
      gl.drawElements(gl.TRIANGLES, obj.mesh.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  function spawnBirds() {
    if (!birdMesh || !world) return;
    for (var i = 0; i < 9; i++) {
      var baseX = (i - 4) * 14;
      var baseZ = -92 - Math.abs(i - 4) * 6;
      var birdHeight = 23 + (i % 3) * 3;
      var bird = {
        mesh: birdMesh,
        scale: 0.72 + (i % 3) * 0.08,
        color: [0.13, 0.16, 0.20],
        glow: 0,
        angle: i * 0.8,
        phase: i * 1.7,
        baseX: baseX,
        baseZ: baseZ,
        height: birdHeight,
        position: [baseX, birdHeight, baseZ],
        boundingCenter: [baseX, birdHeight, baseZ],
        boundingRadius: 3,
        yaw: 0,
        update: function (dt) {
          this.behavior.context.bird = this;
          this.behavior.tick(dt);
          if (window.AevumMarkGraphics) window.AevumMarkGraphics('OrbBehavior');
        }
      };
      if (!window.OrbBehavior || !window.OrbBehavior.BehaviorTree || !window.OrbBehavior.Action) {
        throw new Error('OrbBehavior BehaviorTree/Action is required; inline bird patrol is removed');
      }
      bird.behavior = new window.OrbBehavior.BehaviorTree();
      bird.behavior.setRoot(new window.OrbBehavior.Action('bird-orbit-patrol', function (context, dt) {
        var b = context.bird;
        b.angle += dt * 0.45;
        b.position[0] = b.baseX + Math.sin(b.angle + b.phase) * 7;
        b.position[2] = b.baseZ + Math.cos(b.angle * 0.8 + b.phase) * 4;
        b.position[1] = b.height + Math.sin(b.angle * 2 + b.phase) * 1.2;
        b.yaw = -0.22 + Math.sin(b.angle * 0.5 + b.phase) * 0.12;
        b.boundingCenter = b.position;
        return window.OrbBehavior.NodeStatus.SUCCESS;
      }));
      birdObjects.push(bird);
      world.addObject(bird);
    }
  }

  function initBirdPicker() {
    if (!window.OrbInteraction || !window.OrbInteraction.Picker || !window.OrbInteraction.Pickable || !window.OrbMath) {
      throw new Error('OrbInteraction Picker/Pickable is required; inline bird picking is removed');
    }
    var Vec3 = window.OrbMath.Vec3;
    pickerCamera = {
      isPerspective: true,
      position: new Vec3(),
      projectionMatrixInverse: new window.OrbMath.Mat4()
    };
    birdPicker = new window.OrbInteraction.Picker(pickerCamera, canvasWorld);
    for (var i = 0; i < birdObjects.length; i++) {
      var bird = birdObjects[i];
      var pickable = new window.OrbInteraction.Pickable('bird-' + i, { bird: bird });
      pickable.enabled = true;
      birdPickables.push(pickable);
      birdPicker.addObject(pickable);
    }
    function onPointerPick(event) {
      if (!world || !world.camera || !world.camera.projectionMatrix) return;
      pickerCamera.position.set(eye[0], eye[1], eye[2]);
      var inverseProjection = M4.invert(M4.create(), world.camera.projectionMatrix);
      pickerCamera.projectionMatrixInverse.elements.set(inverseProjection);
      for (var p = 0; p < birdPickables.length; p++) {
        var b = birdObjects[p];
        var r = b.boundingRadius || 3;
        var v = [
          new Vec3(b.position[0] - r, b.position[1] - r, b.position[2] - r),
          new Vec3(b.position[0] + r, b.position[1] - r, b.position[2] - r),
          new Vec3(b.position[0] - r, b.position[1] + r, b.position[2] - r),
          new Vec3(b.position[0] + r, b.position[1] + r, b.position[2] - r),
          new Vec3(b.position[0] - r, b.position[1] - r, b.position[2] + r),
          new Vec3(b.position[0] + r, b.position[1] - r, b.position[2] + r),
          new Vec3(b.position[0] - r, b.position[1] + r, b.position[2] + r),
          new Vec3(b.position[0] + r, b.position[1] + r, b.position[2] + r)
        ];
        birdPickables[p].setBoundingFromVertices(v);
      }
      var hit = birdPicker.pickFirst(event.clientX, event.clientY);
      for (var b2 = 0; b2 < birdObjects.length; b2++) birdObjects[b2].glow = 0;
      if (hit && hit.object && hit.object.data && hit.object.data.bird) hit.object.data.bird.glow = 0.35;
      if (window.AevumMarkGraphics) window.AevumMarkGraphics('OrbInteraction');
    }
    canvasWorld.addEventListener('pointermove', onPointerPick, { passive: true });
    canvasWorld.addEventListener('pointerdown', onPointerPick, { passive: true });
  }

  function syncFireflies() {
    if (!fireflyMesh || !world) return;
    var night = world.dayNight && world.dayNight.isNight;
    if (night && fireflyObjects.length === 0) {
      if (!window.OrbPhysics || !window.OrbPhysics.Particle || !window.OrbMath) {
        throw new Error('OrbPhysics Particle/OrbMath is required; inline firefly motion is removed');
      }
      var Vec3 = window.OrbMath.Vec3;
      for (var i = 0; i < 14; i++) {
        var angle = Math.random() * Math.PI * 2;
        var radius = 4 + Math.random() * 18;
        var baseY = world.terrain.getHeight(Math.cos(angle) * radius, Math.sin(angle) * radius) + 0.4 + Math.random() * 2.0;
        var particle = new window.OrbPhysics.Particle(new Vec3(Math.cos(angle) * radius, baseY, Math.sin(angle) * radius), 1);
        var firefly = {
          mesh: fireflyMesh,
          scale: 0.055 + Math.random() * 0.035,
          color: [1.0, 0.78, 0.28],
          glow: 0.95,
          angle: angle,
          radius: radius,
          height: baseY,
          particle: particle,
          position: [particle.position.x, particle.position.y, particle.position.z],
          boundingCenter: [0, 0, 0],
          boundingRadius: 0.4,
          update: function (dt) {
            this.angle += dt * (0.25 + this.scale);
            var targetX = Math.cos(this.angle) * this.radius;
            var targetY = this.height + Math.sin(this.angle * 3.0) * 0.18;
            var targetZ = Math.sin(this.angle) * this.radius;
            this.particle.applyForce(new Vec3(
              (targetX - this.particle.position.x) * 14,
              (targetY - this.particle.position.y) * 10,
              (targetZ - this.particle.position.z) * 14
            ));
            this.particle.updateVerlet(dt, 0.82);
            this.position[0] = this.particle.position.x;
            this.position[1] = this.particle.position.y;
            this.position[2] = this.particle.position.z;
            this.boundingCenter = this.position;
            if (window.AevumMarkGraphics) window.AevumMarkGraphics('OrbPhysics');
          }
        };
        fireflyObjects.push(firefly);
        world.addObject(firefly);
      }
    } else if (!night && fireflyObjects.length) {
      for (var j = 0; j < fireflyObjects.length; j++) world.removeObject(fireflyObjects[j]);
      fireflyObjects.length = 0;
    }
  }

  function drawContactShadow() {
    if (!shadowMesh) return;
    gl.useProgram(shadowProgram);
    gl.uniformMatrix4fv(uniformLocation(shadowProgram, 'uViewProj'), false, viewProj);
    gl.uniform3fv(uniformLocation(shadowProgram, 'uCenter'), new Float32Array([charPos[0], charPos[1] + 0.025, charPos[2]]));
    gl.uniform1f(uniformLocation(shadowProgram, 'uRadius'), 1.85);
    gl.uniform1f(uniformLocation(shadowProgram, 'uOpacity'), 0.34);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(shadowMesh.vao);
    gl.drawElements(gl.TRIANGLES, shadowMesh.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  function renderWorld(now) {
    updateCamera();
    if (world.frustumCulling) world.frustumCulling.update(viewProj);
    makeLightVP(world.lights.directionalLight);
    renderShadowMap();
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0.02, 0.03, 0.045, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    drawSky();
    drawTerrain();
    drawTrees();
    drawGrass(now / 1000);
    drawWater();
    drawObjects();
    drawRain();
    drawSnow();
    drawContactShadow();
    drawPost(now);
  }

  async function boot() {
    function bootStage(text) { if (loading) loading.querySelector('div').textContent = text; }
    bootStage('LOADING / WORLD INIT');
    world = new window.World3DEngine.WorldEngine();
    await world.init({
      terrain: {
        width: TERRAIN_SIZE,
        depth: TERRAIN_SIZE,
        segments: 240,
        octaves: 5,
        scale: 0.018,
        amplitude: 26,
        seed: 20261118
      }
    });
    shapeTerrain(world.terrain);
    world.vegetation = new window.World3DEngine.VegetationSystem(world.terrain);
    world.vegetation.generate({ treeCount: 560, grassCount: 24000 });
    trees = world.vegetation.trees.filter(function (t) {
      var ds = Math.sqrt(t.x * t.x + t.z * t.z);
      var dl = Math.sqrt(t.x * t.x + (t.z - LAKE[1]) * (t.z - LAKE[1]));
      return ds > 13 && dl > 24 && t.y > WATER_LEVEL + 0.6;
    });
    grass = world.vegetation.grass.filter(function (g) {
      var ds = Math.sqrt(g.x * g.x + g.z * g.z);
      var dl = Math.sqrt(g.x * g.x + (g.z - LAKE[1]) * (g.z - LAKE[1]));
      return ds > 9 && dl > 20 && g.y > WATER_LEVEL + 0.5;
    });
    [
      [-9.0, -12.0, 1.15, 0.8],
      [9.5, -15.0, 1.30, 1.8],
      [-25.0, -19.0, 1.55, 2.6],
      [24.0, -21.0, 1.35, 3.2]
    ].forEach(function (h) {
      trees.push({
        x: h[0], z: h[1], y: world.terrain.getHeight(h[0], h[1]),
        scale: h[2], rotation: h[3], type: h[3] > 2 ? 'oak' : 'pine',
        color: [0.18 + h[3] * 0.03, 0.36 + h[3] * 0.02, 0.10]
      });
    });
    trees = trees.filter(function (t) { return !(Math.abs(t.x) < 5.0 && t.z < -6 && t.z > -22); });
    for (var ti = 0; ti < 260; ti++) {
      var ta = Math.random() * Math.PI * 2;
      var tr = 42 + Math.random() * 58;
      var tx = Math.cos(ta) * tr;
      var tz = Math.sin(ta) * tr - 18;
      var ty = world.terrain.getHeight(tx, tz);
      if (ty < WATER_LEVEL + 1.2) continue;
      var ts = 0.30 + Math.random() * 0.55;
      trees.push({
        x: tx, z: tz, y: ty, scale: ts,
        rotation: Math.random() * Math.PI * 2,
        type: Math.random() < 0.76 ? 'pine' : 'oak',
        color: [0.16, 0.30 + Math.random() * 0.06, 0.10]
      });
    }
    for (var gi = 0; gi < 15000; gi += 1) {
      var gx = (Math.random() - 0.5) * 64.0;
      var gz = (Math.random() - 0.5) * 64.0;
      if (gx * gx + gz * gz < 2.4 * 2.4) continue;
      if (gx * gx + (gz - LAKE[1]) * (gz - LAKE[1]) < 19 * 19) continue;
      var gy = world.terrain.getHeight(gx, gz);
      if (gy < WATER_LEVEL + 0.4) continue;
      grass.push({
        x: gx, z: gz, y: gy,
        height: 0.16 + Math.random() * 0.24,
        width: 0.025 + Math.random() * 0.02,
        rotation: Math.random() * Math.PI * 2,
        swayOffset: Math.random() * Math.PI * 2,
        color: [0.12 + Math.random() * 0.04, 0.40 + Math.random() * 0.08, 0.07]
      });
    }
    // 远景草并入同一套草 mesh/shader：只放在低处缓坡，避开山脊线，
    // 不再使用另一套不透明 instanced quad。
    for (var fgi = 0; fgi < 1600; fgi += 1) {
      var fga = Math.random() * Math.PI * 2;
      var fgr = 62 + Math.random() * 34;
      var fgx = Math.cos(fga) * fgr;
      var fgz = Math.sin(fga) * fgr - 16;
      var fgy = world.terrain.getHeight(fgx, fgz);
      if (fgy < WATER_LEVEL + 0.6 || fgy > 7.0) continue;
      var fgdx = world.terrain.getHeight(fgx + 1, fgz) - fgy;
      var fgdz = world.terrain.getHeight(fgx, fgz + 1) - fgy;
      if (Math.abs(fgdx) + Math.abs(fgdz) > 0.8) continue;
      grass.push({
        x: fgx, z: fgz, y: fgy,
        height: 0.20 + Math.random() * 0.30,
        width: 0.030 + Math.random() * 0.025,
        rotation: Math.random() * Math.PI * 2,
        swayOffset: Math.random() * Math.PI * 2,
        color: [0.12 + Math.random() * 0.04, 0.40 + Math.random() * 0.08, 0.07]
      });
    }

    world.water.setWaterLevel(WATER_LEVEL);
    world.water.setWaveHeight(0.16);
    world.weather.setWeather(WEATHER_MODE, false);
    if (WEATHER_MODE !== 'rain' && WEATHER_MODE !== 'storm' && WEATHER_MODE !== 'snow') {
      world.weather.particles.length = 0;
    }
    world.weather.cloudCoverage = (WEATHER_MODE === 'rain' || WEATHER_MODE === 'storm')
      ? 0.62
      : (WEATHER_MODE === 'snow' ? 0.72 : 0.06);
    world.postProcessing.colorGrading.exposure = 1.06;
    world.postProcessing.colorGrading.contrast = 1.12;
    world.postProcessing.colorGrading.saturation = 0.82;
    world.postProcessing.colorGrading.temperature = 0.12;
    world.postProcessing.bloom.intensity = 0.16;
    world.postProcessing.vignette.intensity = 0.24;
    world.postProcessing.filmGrain.intensity = 0.014;
    world.postProcessing.ssao.enabled = true;
    world.postProcessing.ssao.radius = 0.28;
    world.postProcessing.ssao.bias = 0.08;
    world.postProcessing.ssao.intensity = 0.55;
    world.postProcessing.ssao.range = 8;
    world.postProcessing.ssao.samples = 10;
    world.postProcessing.dof.enabled = true;
    world.postProcessing.dof.focusDistance = 18;
    world.postProcessing.dof.focusRange = 12;
    world.postProcessing.dof.blurAmount = 3;
    world.postProcessing.dof.strength = 1;
    world.postProcessing.chromaticAberration.enabled = true;
    world.postProcessing.chromaticAberration.amount = 0.0004;
    world.sky.setTime(0.285);
    world.sky.update(0);
    styleSky();
    world.dayNight.time = TIME_OF_DAY;
    world.dayNight.dayLength = 1800;
    world.dayNight.update(0);
    SUN_DIR = sunDirectionFor(world.dayNight.time);
    world.dayNight.sunPosition = SUN_DIR;
    world.sky.sunDirection = SUN_DIR;
    world.lights.setDirectional(SUN_DIR, world.dayNight.getSunColor(), 1.20);
    world.lights.setAmbient(world.dayNight.getAmbientColor(), 0.46);
    sunColor = [1.0, 0.84, 0.63];
    world.shadows.setQuality('high');
    world.shadows.setShadowDistance(180);
    document.documentElement.setAttribute('data-world3dext', String(!!window.World3DExt));
    document.documentElement.setAttribute('data-ext-core', String(!!(window.WebGLCore && window.WebGLCore.ShaderCompiler)));
    if (window.World3DExt) {
      fog = new window.World3DExt.VolumetricFog({ getContext: function () { return gl; } }, null);
      fog.setFogColor(0.62, 0.69, 0.76);
      fog.setFogDensity(0.0008);
      fog.setFogHeight(11);
      fog.setFogHeightFalloff(1.1);
      fog.setSunScatterIntensity(0.55);
      fog.setSunDirection(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]);

      if (window.WebGLCore && window.WebGLCore.ShaderCompiler) {
        extShaderCompiler = new window.WebGLCore.ShaderCompiler({ getContext: function () { return gl; } });
        var rawExtCompile = extShaderCompiler.compile.bind(extShaderCompiler);
        extShaderCompiler.compile = function (vs, fs, defines) {
          markGraphics('gl-extensions');
          document.documentElement.setAttribute('data-ext-compile', '1');
          return rawExtCompile(
            String(vs || '').replace(/^#version\s+300\s+es\s*/, ''),
            String(fs || '').replace(/^#version\s+300\s+es\s*/, ''),
            defines
          );
        };
        extShaderCompiler.use = function (p) { gl.useProgram(p); };
        extShaderCompiler.getAttributeLocation = function (p, name) { return attrib(p, name); };
        extShaderCompiler.setUniformMatrix4fv = function (p, name, value) {
          var loc = uniformLocation(p, name);
          if (loc) gl.uniformMatrix4fv(loc, false, value);
        };
        extShaderCompiler.setUniform1f = function (p, name, value) {
          var loc = uniformLocation(p, name);
          if (loc) gl.uniform1f(loc, value);
        };
        extShaderCompiler.setUniform1i = function (p, name, value) {
          var loc = uniformLocation(p, name);
          if (loc) gl.uniform1i(loc, value);
        };
        extShaderCompiler.setUniform2f = function (p, name, a, b) {
          var loc = uniformLocation(p, name);
          if (loc) gl.uniform2f(loc, a, b);
        };
        extShaderCompiler.setUniform3f = function (p, name, a, b, c) {
          var loc = uniformLocation(p, name);
          if (loc) gl.uniform3f(loc, a, b, c);
        };
      } else {
        extShaderCompiler = {
          compile: function (vs, fs) { return program(vs, fs); },
          use: function (p) { gl.useProgram(p); },
          getAttributeLocation: function (p, name) { return attrib(p, name); },
          setUniformMatrix4fv: function (p, name, value) { gl.uniformMatrix4fv(uniformLocation(p, name), false, value); },
          setUniform1f: function (p, name, value) { gl.uniform1f(uniformLocation(p, name), value); },
          setUniform1i: function (p, name, value) { gl.uniform1i(uniformLocation(p, name), value); },
          setUniform2f: function (p, name, a, b) { gl.uniform2f(uniformLocation(p, name), a, b); },
          setUniform3f: function (p, name, a, b, c) { gl.uniform3f(uniformLocation(p, name), a, b, c); }
        };
      }

      advancedWater = new window.World3DExt.AdvancedWaterSystem(
        { getContext: function () { return gl; } }, extShaderCompiler
      );
      [
        { direction: [1, 0.3], steepness: 0.06, wavelength: 8, speed: 1.0 },
        { direction: [0.5, 1], steepness: 0.05, wavelength: 5, speed: 1.2 },
        { direction: [-0.7, 0.5], steepness: 0.04, wavelength: 3, speed: 1.5 },
        { direction: [0.3, -0.8], steepness: 0.03, wavelength: 2, speed: 1.8 }
      ].forEach(function (w) { advancedWater.addWave(w); });
      advancedWater.setWaterColor(0.045, 0.15, 0.20, 0.72);
      advancedWater.setDeepColor(0.02, 0.05, 0.10);
      advancedWater.setShallowColor(0.12, 0.30, 0.36);
      advancedWater.setWaveHeight(0.16);
      advancedWater.setWaveSpeed(1.0);
      advancedWater.setWaveScale(1.0);
      advancedWater.setTransparency(0.72);
      advancedWater.setReflectivity(0.55);
      advancedWater.setFoamIntensity(0.55);
      advancedWater.setFoamThreshold(0.5);
      advancedWater.setCausticIntensity(0.38);
      advancedWater.setNormalStrength(1.0);
      advancedWater.init();
      advancedWater.update(0);
      if (systemsEl) {
        systemsEl.textContent = 'TERRAIN ' + TERRAIN_SIZE + '×' + TERRAIN_SIZE + ' · WATER ' +
          advancedWater.getWaveCount() + ' WAVES · ' + world.weather.getCurrentWeather().toUpperCase();
      }
      document.documentElement.setAttribute('data-world3dext', String(!!window.World3DExt));
      document.documentElement.setAttribute('data-advanced-water', String(!!advancedWater));
    }
    setupWorldCamera();

    skyMesh = makeSkySphere();
    terrainMesh = makeTerrainMesh(world.terrain);
    terrainChunks = makeTerrainChunkMeshes(world.terrain, 4);
    waterMesh = makeWaterMesh();
    var nearTrees = trees.filter(function (t) { return Math.sqrt(t.x * t.x + t.z * t.z) < 135; });
    treeGroups = buildVegetationGroups(nearTrees, makeTreeMesh, 58);
    var nearGrass = grass.filter(function (g) { return Math.sqrt(g.x * g.x + g.z * g.z) < 58; });
    grassGroups = buildVegetationGroups(nearGrass, makeGrassMesh, 58);
    var farGrass = grass.filter(function (g) { return Math.sqrt(g.x * g.x + g.z * g.z) >= 58; });
    if (farGrass.length) {
      grassGroups = grassGroups.concat(buildVegetationGroups(farGrass, makeGrassMesh, 110));
    }
    var flowerSpots = [];
    for (var fi = 0; fi < 1100; fi++) {
      var fx = (Math.random() * 2 - 1) * 30;
      var fz = (Math.random() * 2 - 1) * 27;
      var fy = world.terrain.getHeight(fx, fz);
      if (fy < WATER_LEVEL + 0.5) continue;
      flowerSpots.push({ x: fx, y: fy + 0.02, z: fz });
    }
    flowerMesh = makeFlowerMesh(flowerSpots);
    birdMesh = makeBirdMesh();
    fireflyMesh = makeFireflyMesh();
    spawnBirds();
    initBirdPicker();
    initGraphicsEntry();
    initGrassWindCompute();
    shadowMesh = makeShadowMesh();
    createShadowTarget();
    createSceneTarget();
    world.postProcessing.addPass('world-post', null);
    world.postProcessing.addPass('fxaa', null);
    world.postProcessing.setBackend(function (pp, input) {
      var current = input;
      for (var p = 0; p < pp.passes.length; p++) {
        var pass = pp.passes[p];
        if (!pass.enabled) continue;
        if (pass.name === 'world-post') current = drawPostToTarget(current, postFBO, postNow);
        else if (pass.name === 'fxaa') { drawFxaa(current); return null; }
      }
      return current;
    });

    window.AEVUM_WORLD_CONTROL = {
      setTime: function (value) {
        if (!world || !world.dayNight) return;
        var t = ((Number(value) || 0) % 1 + 1) % 1;
        world.dayNight.setTime(t);
        world.dayNight.update(0);
        world.sky.setTime(t);
        world.sky.update(0);
        SUN_DIR = sunDirectionFor(t);
        world.dayNight.sunPosition = SUN_DIR;
        world.sky.sunDirection = SUN_DIR;
        if (world.dayNight.isNight) {
          world.lights.setDirectional(world.dayNight.getMoonPosition(), [0.55, 0.62, 0.92], 0.16);
          world.lights.setAmbient([0.34, 0.40, 0.62], 0.56);
        } else {
          world.lights.setDirectional(SUN_DIR, world.dayNight.getSunColor(), 1.2);
          world.lights.setAmbient(world.dayNight.getAmbientColor(), 0.46);
        }
        styleSky();
      },
      setWeather: function (name) {
        if (!world || !world.weather) return;
        if (world.weather.weatherTypes.indexOf(name) === -1) return;
        world.weather.setWeather(name, false);
        weatherClock = 0;
        weatherNext = 999999;
      },
      getState: function () {
        return {
          time: world && world.dayNight ? world.dayNight.getTime() : 0,
          weather: world && world.weather ? world.weather.getCurrentWeather() : 'clear'
        };
      }
    };

    if (renderOnly) {
      start = performance.now();
      last = start;
      window.AEVUM_WORLD_RENDERER = {
        heightAt: function (x, z) { return world.terrain.getHeight(x, z); },
        resize: function (w, h) {
          w = Math.max(1, Math.round(w));
          h = Math.max(1, Math.round(h));
          W = w;
          H = h;
          canvasWorld.width = w;
          canvasWorld.height = h;
          if (sceneFBO) {
            gl.deleteFramebuffer(sceneFBO);
            gl.deleteTexture(sceneColorTex);
            gl.deleteTexture(sceneDepthTex);
          }
          if (postRenderTarget) {
            postRenderTarget.dispose();
            postRenderTarget = null;
            postFBO = null;
            postColorTex = null;
          } else if (postFBO) {
            gl.deleteFramebuffer(postFBO);
            gl.deleteTexture(postColorTex);
            postFBO = null;
            postColorTex = null;
          }
          createSceneTarget();
        },
        frame: function (now) { frame(now); }
      };
      window.AEVUM_WORLD_READY = true;
      requestAnimationFrame(frame);
      return;
    }

    initCharacterSkin();

    var modelRenderer = new window.AEVUM.render.VRMRenderer(canvasModel, {
      clearColor: [0, 0, 0, 0],
      skinMaterial: skinMaterial,
      lighting: {
        direction: world.lights.directionalLight.direction,
        color: world.lights.directionalLight.color,
        ambient: world.lights.ambientLight.color,
        rim: [0.48, 0.86, 1.0],
        rimStrength: 0.52,
        specular: 0.12
      }
    });

    var vrmRes = await fetch('/engine/assets/models/furina/f%E8%8A%99%E5%AE%81%E5%A8%9C.vrm', { cache: 'no-store' });
    if (!vrmRes.ok) throw new Error('VRM HTTP ' + vrmRes.status);
    bootStage('LOADING / VRM RECEIVED');
    vrm = window.AEVUM.formats.parseVRM(await vrmRes.arrayBuffer());
    await modelRenderer.loadVRM(vrm);
    bootStage('LOADING / VRM READY');

    var actionRes = await fetch('/engine/assets/all_animations.glb', { cache: 'no-store' });    if (!actionRes.ok) throw new Error('GLB HTTP ' + actionRes.status);
    bootStage('LOADING / MOTION RECEIVED');
    var action = window.AEVUM.formats.parseGLB(await actionRes.arrayBuffer());
    player = window.AEVUM.formats.GLTFAnimation.createPlayer(action);
    clip = player.clips.some(function (c) { return c.name === 'run'; }) ? 'run' : 'walk';
    player.setClip(clip).reset().setLoop(true).play();
    player.update(0.08);

    retarget = window.AEVUM.render.AnimationRetarget.retargetPose;

    var bounds = modelRenderer.bounds;
    var modelHeight = bounds.max[1] - bounds.min[1];
    charScale = 2.55 / Math.max(0.001, modelHeight);
    var ground = world.terrain.getHeight(SPAWN[0], SPAWN[1]);
    M4.fromTRS(modelMatrix, [SPAWN[0], ground - bounds.min[1] * charScale, SPAWN[1]], math.Q.fromAxisAngle(math.Q.create(), [0, 1, 0], Math.PI), [charScale, charScale, charScale]);
    modelBaseY = modelMatrix[13];
    if (!window.OrbSkeleton || !window.OrbAnimation || !window.OrbAnimation.ProceduralMotion || !window.OrbAnimation.BreathingMotion) {
      throw new Error('OrbSkeleton/OrbAnimation is required; inline character breathing is removed');
    }
    proceduralSkeleton = new window.OrbSkeleton.Skeleton();
    proceduralChestBone = proceduralSkeleton.addBone('UpperBody', -1);
    proceduralMotion = new window.OrbAnimation.ProceduralMotion(proceduralSkeleton);
    proceduralMotion.register('breathing', window.OrbAnimation.BreathingMotion);
    proceduralMotion.play('breathing', { loop: true, weight: 1, fadeIn: 0.4 });

    statEl.textContent = clip.toUpperCase() + ' / ' + (vrm.humanBones || []).length + ' BONES';
    systemsEl.textContent = 'TERRAIN ' + TERRAIN_SIZE + '×' + TERRAIN_SIZE + ' · TREES ' + trees.length + ' · GRASS ' + grass.length + ' · WATER 8 · ' + world.weather.getCurrentWeather().toUpperCase() + ' · SHADOW ' + world.shadows.shadowMapSize + ' · POST FX';

    start = performance.now();
    last = start;
    var frameCount = 0;
    function frame(now) {
      frameCount += 1;
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (world) {
        world.update(dt);
        if (advancedWater) advancedWater.update(dt);
        syncFireflies();
        if (world.weather.getCurrentWeather() === 'clear') world.weather.particles.length = 0;
        weatherClock += dt;
        if (weatherClock >= weatherNext) {
          weatherClock = 0;
          weatherNext = 180 + Math.random() * 120;
          var roll = Math.random();
          var nextWeather = roll < 0.55 ? 'clear'
            : (roll < 0.74 ? 'cloudy'
              : (roll < 0.87 ? 'rain'
                : (roll < 0.94 ? 'storm' : 'snow')));
          world.weather.setWeather(nextWeather, true);
        }
        world.sky.setTime(world.dayNight.time);
        world.sky.update(0);
        SUN_DIR = sunDirectionFor(world.dayNight.time);
        world.dayNight.sunPosition = SUN_DIR;
        world.sky.sunDirection = SUN_DIR;
        styleSky();
        if (world.dayNight.isNight) {
          world.lights.setDirectional(world.dayNight.getMoonPosition(), [0.55, 0.62, 0.92], 0.16);
          world.lights.setAmbient([0.34, 0.40, 0.62], 0.56);
        } else {
          world.lights.setDirectional(SUN_DIR, world.dayNight.getSunColor(), 1.2);
          world.lights.setAmbient(world.dayNight.getAmbientColor(), 0.46);
        }
        sunColor = world.dayNight.getSunColor();
        if (fog) {
          fog.setSunDirection(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]);
          fog.setFogDensity(0.0008 + world.weather.getFogIntensity() * 0.025 +
            (world.weather.getCurrentWeather() === 'storm' ? 0.012 : 0));
        }
      }
      if (player) player.update(dt);

      if (proceduralMotion) {
        proceduralChestBone.position.y = 0;
        proceduralMotion.update(dt);
        modelMatrix[13] = modelBaseY + proceduralChestBone.position.y * 2.0;
        if (window.AevumMarkGraphics) {
          window.AevumMarkGraphics('OrbSkeleton');
          window.AevumMarkGraphics('OrbAnimation');
        }
      }

      var pose = null;
      if (player && vrm && retarget) {
        pose = retarget(vrm, action.json, player.getPose(), {
          neutralStance: false,
          symmetricArms: false,
          footClearance: true,
          runPose: clip === 'run',
          greetPose: false,
          dt: dt
        });
      }

      renderWorld(now);
      if (systemsEl && frameCount % 20 === 0) {
        systemsEl.textContent = 'TERRAIN ' + TERRAIN_SIZE + '×' + TERRAIN_SIZE +
          ' · TREES ' + trees.length + ' · GRASS ' + grass.length +
          ' · WATER 8 · ' + world.weather.getCurrentWeather().toUpperCase() +
          ' · PARTICLES ' + world.weather.getParticles().length +
          ' · CHUNKS ' + terrainChunks.length +
          ' · SHADOW ' + world.shadows.shadowMapSize + ' · POST FX';
      }
      window.AEVUM_WORLD_STATE = {
        weather: world.weather.getCurrentWeather(),
        particles: world.weather.getParticles().length,
        snow: world.weather.getSnowAccumulation(),
        cloud: world.weather.getCloudCoverage(),
        objects: world.objects.length,
        chunks: terrainChunks.length,
        farTrees: 0
      };
      if (modelRenderer && pose) {
        if (window.AevumMarkGraphics) window.AevumMarkGraphics('SpiritSkin');
        modelRenderer.render(now / 1000, pose.rotation, { translation: pose.translation }, {
          viewProjection: viewProj,
          modelMatrix: modelMatrix,
          cameraPosition: eye,
          lighting: {
            direction: world.lights.directionalLight.direction,
            color: world.lights.directionalLight.color,
            ambient: world.lights.ambientLight.color,
            rim: [0.48, 0.86, 1.0],
            rimStrength: 0.52,
            specular: 0.12
          }
        });
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    setReady('RUNNING');
  }

  boot().catch(function (error) {
    window.__AEVUM_SHOT_ERROR = String(error && error.stack || error);
    fail(error);
  });




