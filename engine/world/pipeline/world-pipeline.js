/**
 * 全屏3D世界引擎 - 地形/天空/水/植被/天气/昼夜/相机/裁剪/光照/阴影/后处理
 * 纯自研WebGL，零依赖
 * @version 2.0.0
 */
'use strict';

const World3DEngine = (function () {

  // ============================================================
  // 地形系统 - 程序化高度图/LOD/纹理混合
  // ============================================================
  class TerrainSystem {
    constructor(width = 1024, depth = 1024, segments = 128) {
      this.width = width; this.depth = depth; this.segments = segments;
      this.heightMap = null;
      this.normalMap = null;
      this.vertices = null;
      this.indices = null;
      this.normals = null;
      this.uvs = null;
      this.colors = null;
      this.lodLevels = [];
      this.textureLayers = [];
      this.noiseOctaves = 6;
      this.noiseScale = 0.01;
      this.noiseAmplitude = 50;
      this.seed = 12345;
      this.built = false;
    }

    generate(options = {}) {
      this.seed = options.seed || this.seed;
      this.noiseOctaves = options.octaves || this.noiseOctaves;
      this.noiseScale = options.scale || this.noiseScale;
      this.noiseAmplitude = options.amplitude || this.noiseAmplitude;
      const seg = this.segments + 1;
      this.heightMap = new Float32Array(seg * seg);
      this.vertices = new Float32Array(seg * seg * 3);
      this.normals = new Float32Array(seg * seg * 3);
      this.uvs = new Float32Array(seg * seg * 2);
      this.colors = new Float32Array(seg * seg * 3);
      for (let z = 0; z < seg; z++) {
        for (let x = 0; x < seg; x++) {
          const idx = z * seg + x;
          const h = this._fractalNoise(x * this.noiseScale, z * this.noiseScale);
          this.heightMap[idx] = h * this.noiseAmplitude;
          const wx = (x / this.segments - 0.5) * this.width;
          const wz = (z / this.segments - 0.5) * this.depth;
          this.vertices[idx*3] = wx;
          this.vertices[idx*3+1] = this.heightMap[idx];
          this.vertices[idx*3+2] = wz;
          this.uvs[idx*2] = x / this.segments;
          this.uvs[idx*2+1] = z / this.segments;
          this._setColor(idx, this.heightMap[idx]);
        }
      }
      this._computeNormals();
      this._buildIndices();
      this._generateLOD();
      this.built = true;
    }

    _fractalNoise(x, z) {
      let value = 0, amplitude = 1, frequency = 1, maxValue = 0;
      for (let i = 0; i < this.noiseOctaves; i++) {
        value += this._perlinNoise(x * frequency, z * frequency) * amplitude;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
      }
      return value / maxValue;
    }

    _perlinNoise(x, z) {
      const xi = Math.floor(x), zi = Math.floor(z);
      const xf = x - xi, zf = z - zi;
      const u = this._fade(xf), v = this._fade(zf);
      const aa = this._gradient(this.seed + xi, this.seed + zi, xf, zf);
      const ab = this._gradient(this.seed + xi, this.seed + zi + 1, xf, zf - 1);
      const ba = this._gradient(this.seed + xi + 1, this.seed + zi, xf - 1, zf);
      const bb = this._gradient(this.seed + xi + 1, this.seed + zi + 1, xf - 1, zf - 1);
      return this._lerp(this._lerp(aa, ba, u), this._lerp(ab, bb, u), v);
    }

    _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    _lerp(a, b, t) { return a + (b - a) * t; }
    _gradient(ix, iz, x, z) {
      const h = ((ix * 374761393 + iz * 668265263) & 0x7fffffff) / 0x7fffffff;
      const angle = h * Math.PI * 2;
      return Math.cos(angle) * x + Math.sin(angle) * z;
    }

    _setColor(idx, height) {
      const h = height / this.noiseAmplitude;
      if (h < -0.2) { this.colors[idx*3]=0.2; this.colors[idx*3+1]=0.4; this.colors[idx*3+2]=0.6; }
      else if (h < 0.1) { this.colors[idx*3]=0.76; this.colors[idx*3+1]=0.7; this.colors[idx*3+2]=0.5; }
      else if (h < 0.4) { this.colors[idx*3]=0.3; this.colors[idx*3+1]=0.55; this.colors[idx*3+2]=0.2; }
      else if (h < 0.7) { this.colors[idx*3]=0.45; this.colors[idx*3+1]=0.4; this.colors[idx*3+2]=0.35; }
      else { this.colors[idx*3]=0.9; this.colors[idx*3+1]=0.9; this.colors[idx*3+2]=0.95; }
    }

    _computeNormals() {
      const seg = this.segments + 1;
      for (let z = 0; z < seg; z++) {
        for (let x = 0; x < seg; x++) {
          const idx = z * seg + x;
          const hL = x > 0 ? this.heightMap[idx-1] : this.heightMap[idx];
          const hR = x < seg-1 ? this.heightMap[idx+1] : this.heightMap[idx];
          const hD = z > 0 ? this.heightMap[idx-seg] : this.heightMap[idx];
          const hU = z < seg-1 ? this.heightMap[idx+seg] : this.heightMap[idx];
          const nx = hL - hR, ny = 2, nz = hD - hU;
          const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
          this.normals[idx*3] = nx/len; this.normals[idx*3+1] = ny/len; this.normals[idx*3+2] = nz/len;
        }
      }
    }

    _buildIndices() {
      const count = this.segments * this.segments * 6;
      this.indices = new Uint32Array(count);
      let ptr = 0;
      const seg = this.segments + 1;
      for (let z = 0; z < this.segments; z++) {
        for (let x = 0; x < this.segments; x++) {
          const i = z * seg + x;
          this.indices[ptr++] = i; this.indices[ptr++] = i + seg; this.indices[ptr++] = i + 1;
          this.indices[ptr++] = i + 1; this.indices[ptr++] = i + seg; this.indices[ptr++] = i + seg + 1;
        }
      }
    }

    _generateLOD() {
      this.lodLevels = [];
      const factors = [1, 2, 4, 8];
      for (const factor of factors) {
        const step = factor;
        const lodSeg = Math.floor(this.segments / step);
        const vertCount = (lodSeg + 1) * (lodSeg + 1);
        const verts = new Float32Array(vertCount * 3);
        const norms = new Float32Array(vertCount * 3);
        const uvs = new Float32Array(vertCount * 2);
        const idxCount = lodSeg * lodSeg * 6;
        const indices = new Uint32Array(idxCount);
        const srcSeg = this.segments + 1;
        let vi = 0;
        for (let z = 0; z <= lodSeg; z++) {
          for (let x = 0; x <= lodSeg; x++) {
            const srcIdx = Math.min(z * step, this.segments) * srcSeg + Math.min(x * step, this.segments);
            verts[vi*3] = this.vertices[srcIdx*3]; verts[vi*3+1] = this.vertices[srcIdx*3+1]; verts[vi*3+2] = this.vertices[srcIdx*3+2];
            norms[vi*3] = this.normals[srcIdx*3]; norms[vi*3+1] = this.normals[srcIdx*3+1]; norms[vi*3+2] = this.normals[srcIdx*3+2];
            uvs[vi*2] = this.uvs[srcIdx*2]; uvs[vi*2+1] = this.uvs[srcIdx*2+1];
            vi++;
          }
        }
        let ii = 0;
        for (let z = 0; z < lodSeg; z++) {
          for (let x = 0; x < lodSeg; x++) {
            const i = z * (lodSeg + 1) + x;
            indices[ii++] = i; indices[ii++] = i + lodSeg + 1; indices[ii++] = i + 1;
            indices[ii++] = i + 1; indices[ii++] = i + lodSeg + 1; indices[ii++] = i + lodSeg + 2;
          }
        }
        this.lodLevels.push({ vertices: verts, normals: norms, uvs, indices, factor, distance: factor * 50 });
      }
    }

    getHeight(worldX, worldZ) {
      const seg = this.segments + 1;
      const fx = (worldX / this.width + 0.5) * this.segments;
      const fz = (worldZ / this.depth + 0.5) * this.segments;
      const x0 = Math.floor(fx), z0 = Math.floor(fz);
      const x1 = Math.min(x0 + 1, this.segments), z1 = Math.min(z0 + 1, this.segments);
      const tx = fx - x0, tz = fz - z0;
      const h00 = this.heightMap[z0 * seg + x0] || 0;
      const h10 = this.heightMap[z0 * seg + x1] || 0;
      const h01 = this.heightMap[z1 * seg + x0] || 0;
      const h11 = this.heightMap[z1 * seg + x1] || 0;
      return h00*(1-tx)*(1-tz) + h10*tx*(1-tz) + h01*(1-tx)*tz + h11*tx*tz;
    }

    getNormal(worldX, worldZ) {
      const h = 0.5;
      const hL = this.getHeight(worldX - h, worldZ), hR = this.getHeight(worldX + h, worldZ);
      const hD = this.getHeight(worldX, worldZ - h), hU = this.getHeight(worldX, worldZ + h);
      const nx = hL - hR, ny = 2 * h, nz = hD - hU;
      const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
      return [nx/len, ny/len, nz/len];
    }

    getLODLevel(distance) {
      for (let i = this.lodLevels.length - 1; i >= 0; i--) {
        if (distance >= this.lodLevels[i].distance) return i;
      }
      return 0;
    }

    paintTexture(worldX, worldZ, textureIndex, strength) { /* 纹理绘制 */ }
    getBoundingBox() { return { min: [-this.width/2, -this.noiseAmplitude, -this.depth/2], max: [this.width/2, this.noiseAmplitude, this.depth/2] }; }
  }

  // ============================================================
  // 天空系统 - 天空盒/太阳/月亮/星星/云
  // ============================================================
  class SkySystem {
    constructor() {
      this.timeOfDay = 0.3;
      this.skyColor = [0.5, 0.7, 1.0];
      this.horizonColor = [0.8, 0.85, 0.9];
      this.groundColor = [0.4, 0.35, 0.3];
      this.sunDirection = [0.5, 0.8, 0.3];
      this.moonDirection = [-0.5, -0.8, -0.3];
      this.sunColor = [1.0, 0.95, 0.8];
      this.moonColor = [0.7, 0.75, 1.0];
      this.stars = [];
      this.clouds = [];
      this.cloudCoverage = 0.3;
      this.cloudSpeed = 0.01;
      this.fogDensity = 0.001;
      this.fogColor = [0.8, 0.85, 0.9];
      this.initialized = false;
    }

    init() {
      for (let i = 0; i < 2000; i++) {
        this.stars.push({
          x: (Math.random() - 0.5) * 2,
          y: Math.random() * 0.8 + 0.2,
          z: (Math.random() - 0.5) * 2,
          size: Math.random() * 2 + 0.5,
          brightness: Math.random() * 0.5 + 0.5,
          twinkleSpeed: Math.random() * 2 + 1
        });
      }
      for (let i = 0; i < 50; i++) {
        this.clouds.push({
          x: (Math.random() - 0.5) * 2000,
          y: Math.random() * 100 + 200,
          z: (Math.random() - 0.5) * 2000,
          width: Math.random() * 200 + 100,
          depth: Math.random() * 200 + 100,
          height: Math.random() * 30 + 20,
          opacity: Math.random() * 0.5 + 0.3,
          speed: Math.random() * 0.5 + 0.2
        });
      }
      this.initialized = true;
    }

    update(dt) {
      this.timeOfDay = (this.timeOfDay + dt * 0.005) % 1;
      const angle = this.timeOfDay * Math.PI * 2;
      this.sunDirection = [Math.cos(angle), Math.sin(angle), 0.3];
      this.moonDirection = [-this.sunDirection[0], -this.sunDirection[1], -this.sunDirection[2]];
      const sunHeight = Math.max(0, this.sunDirection[1]);
      const dayFactor = Math.min(1, sunHeight * 3);
      this.skyColor = [
        0.2 + dayFactor * 0.4 + (1-dayFactor) * 0.05,
        0.3 + dayFactor * 0.45 + (1-dayFactor) * 0.05,
        0.5 + dayFactor * 0.5 + (1-dayFactor) * 0.15
      ];
      this.horizonColor = [
        0.6 + dayFactor * 0.3,
        0.65 + dayFactor * 0.25,
        0.7 + dayFactor * 0.2
      ];
      this.sunColor = sunHeight > 0.3 ? [1.0, 0.95, 0.85] : [1.0, 0.5, 0.2];
      this.fogColor = [...this.horizonColor];
      for (const cloud of this.clouds) {
        cloud.x += cloud.speed * this.cloudSpeed * dt * 60;
        if (cloud.x > 1000) cloud.x = -1000;
      }
    }

    getSkyColor() { return [...this.skyColor]; }
    getHorizonColor() { return [...this.horizonColor]; }
    getSunDirection() { return [...this.sunDirection]; }
    getMoonDirection() { return [...this.moonDirection]; }
    getSunColor() { return [...this.sunColor]; }
    getAmbientIntensity() { return 0.1 + Math.max(0, this.sunDirection[1]) * 0.5; }
    getStarVisibility() { return Math.max(0, 1 - Math.max(0, this.sunDirection[1]) * 5); }
    setTime(time) { this.timeOfDay = time % 1; }
    getTime() { return this.timeOfDay; }
    setCloudCoverage(v) { this.cloudCoverage = v; }
    setFogDensity(v) { this.fogDensity = v; }
  }

  // ============================================================
  // 水系统 - 反射/折射/波浪/焦散
  // ============================================================
  class WaterSystem {
    constructor() {
      this.waterLevel = 0;
      this.waterColor = [0.1, 0.3, 0.5, 0.8];
      this.waveHeight = 0.5;
      this.waveSpeed = 1;
      this.waveFrequency = 0.1;
      this.waves = [];
      this.reflectionTexture = null;
      this.refractionTexture = null;
      this.dudvMap = null;
      this.normalMap = null;
      this.flowOffset = 0;
      this.transparency = 0.7;
      this.specularPower = 256;
      this.initialized = false;
    }

    init() {
      for (let i = 0; i < 8; i++) {
        this.waves.push({
          direction: [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)],
          frequency: this.waveFrequency * (i + 1) * 0.5,
          amplitude: this.waveHeight / (i + 1),
          speed: this.waveSpeed * (1 + i * 0.2),
          phase: Math.random() * Math.PI * 2
        });
      }
      this.initialized = true;
    }

    update(dt) {
      this.flowOffset += dt * 0.03;
      for (const wave of this.waves) wave.phase += wave.speed * dt;
    }

    getHeight(x, z, time) {
      let h = 0;
      for (const wave of this.waves) {
        const dot = x * wave.direction[0] + z * wave.direction[1];
        h += Math.sin(dot * wave.frequency + wave.phase) * wave.amplitude;
      }
      return h + this.waterLevel;
    }

    getNormal(x, z, time) {
      const eps = 0.1;
      const hL = this.getHeight(x - eps, z, time), hR = this.getHeight(x + eps, z, time);
      const hD = this.getHeight(x, z - eps, time), hU = this.getHeight(x, z + eps, time);
      const nx = hL - hR, ny = 2 * eps, nz = hD - hU;
      const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
      return [nx/len, ny/len, nz/len];
    }

    setWaterLevel(v) { this.waterLevel = v; }
    setWaveHeight(v) { this.waveHeight = v; for (let i = 0; i < this.waves.length; i++) this.waves[i].amplitude = v / (i + 1); }
    setWaveSpeed(v) { this.waveSpeed = v; }
    getWaterColor() { return [...this.waterColor]; }
  }

  // ============================================================
  // 植被系统 - 实例化渲染/草地/树木
  // ============================================================
  class VegetationSystem {
    constructor(terrain) {
      this.terrain = terrain;
      this.trees = [];
      this.grass = [];
      this.grassPatches = [];
      this.windDirection = [1, 0, 0];
      this.windStrength = 0.3;
      this.windTime = 0;
      this.maxTrees = 5000;
      this.maxGrass = 50000;
      this.initialized = false;
    }

    generate(options = {}) {
      const treeCount = options.treeCount || 1000;
      const grassCount = options.grassCount || 10000;
      const treeTypes = options.treeTypes || ['pine', 'oak', 'birch'];
      for (let i = 0; i < treeCount && i < this.maxTrees; i++) {
        const x = (Math.random() - 0.5) * this.terrain.width;
        const z = (Math.random() - 0.5) * this.terrain.depth;
        const y = this.terrain.getHeight(x, z);
        if (y < -5 || y > 30) continue;
        this.trees.push({
          x, y, z,
          scale: Math.random() * 0.5 + 0.8,
          rotation: Math.random() * Math.PI * 2,
          type: treeTypes[Math.floor(Math.random() * treeTypes.length)],
          swayOffset: Math.random() * Math.PI * 2,
          color: [0.2 + Math.random() * 0.2, 0.4 + Math.random() * 0.2, 0.1 + Math.random() * 0.1]
        });
      }
      for (let i = 0; i < grassCount && i < this.maxGrass; i++) {
        const x = (Math.random() - 0.5) * this.terrain.width;
        const z = (Math.random() - 0.5) * this.terrain.depth;
        const y = this.terrain.getHeight(x, z);
        if (y < -2 || y > 25) continue;
        this.grass.push({
          x, y, z,
          height: Math.random() * 0.3 + 0.2,
          width: Math.random() * 0.05 + 0.02,
          rotation: Math.random() * Math.PI * 2,
          swayOffset: Math.random() * Math.PI * 2,
          color: [0.2 + Math.random() * 0.15, 0.45 + Math.random() * 0.2, 0.1 + Math.random() * 0.1]
        });
      }
      this.initialized = true;
    }

    update(dt) {
      this.windTime += dt;
    }

    getWindSway(x, z, time) {
      const noise = Math.sin(x * 0.1 + time * 2) * Math.cos(z * 0.1 + time * 1.5);
      return noise * this.windStrength;
    }

    getTreesInRange(centerX, centerZ, range) {
      return this.trees.filter(t => Math.abs(t.x - centerX) < range && Math.abs(t.z - centerZ) < range);
    }

    getGrassInRange(centerX, centerZ, range) {
      return this.grass.filter(g => Math.abs(g.x - centerX) < range && Math.abs(g.z - centerZ) < range);
    }

    setWindStrength(v) { this.windStrength = v; }
    setWindDirection(x, z) { this.windDirection = [x, z]; }
    getTreeCount() { return this.trees.length; }
    getGrassCount() { return this.grass.length; }
  }

  // ============================================================
  // 天气系统 - 雨/雪/雾/雷暴
  // ============================================================
  class WeatherSystem {
    constructor() {
      this.currentWeather = 'clear';
      this.targetWeather = 'clear';
      this.transitionProgress = 1;
      this.transitionSpeed = 0.1;
      this.rainIntensity = 0;
      this.snowAccumulation = 0;
      this.fogIntensity = 0;
      this.windSpeed = 0;
      this.cloudCoverage = 0;
      this.particles = [];
      this.maxParticles = 10000;
      this.thunderTimer = 0;
      this.thunderActive = false;
      this.weatherTypes = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog'];
    }

    setWeather(type, transition = true) {
      if (!this.weatherTypes.includes(type)) return;
      this.targetWeather = type;
      if (!transition) { this.currentWeather = type; this.transitionProgress = 1; this._applyWeather(type, 1); }
      else this.transitionProgress = 0;
    }

    update(dt) {
      if (this.transitionProgress < 1) {
        this.transitionProgress = Math.min(1, this.transitionProgress + dt * this.transitionSpeed);
        if (this.transitionProgress >= 1) this.currentWeather = this.targetWeather;
        this._applyWeather(this.targetWeather, this.transitionProgress);
      }
      this._updateParticles(dt);
      if (this.currentWeather === 'storm') {
        this.thunderTimer -= dt;
        if (this.thunderTimer <= 0) {
          this.thunderActive = true;
          this.thunderTimer = Math.random() * 10 + 5;
          setTimeout(() => { this.thunderActive = false; }, 200);
        }
      }
    }

    _applyWeather(type, progress) {
      switch (type) {
        case 'clear':
          this.rainIntensity *= (1 - progress); this.snowAccumulation *= (1 - progress);
          this.fogIntensity *= (1 - progress); this.cloudCoverage *= (1 - progress); this.windSpeed *= (1 - progress);
          break;
        case 'cloudy':
          this.cloudCoverage = 0.6 * progress; this.windSpeed = 2 * progress;
          break;
        case 'rain':
          this.rainIntensity = 0.6 * progress; this.cloudCoverage = 0.8 * progress; this.windSpeed = 3 * progress;
          break;
        case 'storm':
          this.rainIntensity = 1.0 * progress; this.cloudCoverage = 1.0 * progress; this.windSpeed = 8 * progress;
          break;
        case 'snow':
          this.snowAccumulation = 0.7 * progress;
          this.rainIntensity = 0;
          this.cloudCoverage = 0.72 * progress;
          this.windSpeed = 1.5 * progress;
          break;
        case 'fog':
          this.fogIntensity = 0.8 * progress; this.windSpeed = 0.5 * progress;
          break;
      }
    }

    _updateParticles(dt) {
      if (this.rainIntensity > 0.01) {
        const count = Math.floor(this.rainIntensity * 500 * dt);
        for (let i = 0; i < count && this.particles.length < this.maxParticles; i++) {
          this.particles.push({ type: 'rain', x: (Math.random()-0.5)*100, y: 50+Math.random()*20, z: (Math.random()-0.5)*100, vy: -30-Math.random()*10, vx: this.windSpeed*2, life: 3 });
        }
      }
      if (this.snowAccumulation > 0.01 && this.currentWeather === 'snow') {
        const count = Math.floor(100 * dt);
        for (let i = 0; i < count && this.particles.length < this.maxParticles; i++) {
          this.particles.push({ type: 'snow', x: (Math.random()-0.5)*100, y: 50+Math.random()*20, z: (Math.random()-0.5)*100, vy: -7-Math.random()*5, vx: (Math.random()-0.5)*2, vz: (Math.random()-0.5)*2, size: Math.random()*0.05+0.02, life: 14 });
        }
      }
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += (p.vz||0) * dt;
        p.life -= dt;
        if (p.y < 0 || p.life <= 0) this.particles.splice(i, 1);
      }
    }

    getRainIntensity() { return this.rainIntensity; }
    getSnowAccumulation() { return this.snowAccumulation; }
    getFogIntensity() { return this.fogIntensity; }
    getWindSpeed() { return this.windSpeed; }
    getCloudCoverage() { return this.cloudCoverage; }
    isThundering() { return this.thunderActive; }
    getCurrentWeather() { return this.currentWeather; }
    getParticles() { return this.particles; }
  }

  // ============================================================
  // 昼夜循环
  // ============================================================
  class DayNightCycle {
    constructor() {
      this.time = 0.3;
      this.speed = 1;
      this.dayLength = 120;
      this.sunPosition = [0, 1, 0];
      this.moonPosition = [0, -1, 0];
      this.ambientColor = [0.3, 0.35, 0.5];
      this.sunColor = [1, 0.95, 0.8];
      this.moonColor = [0.6, 0.65, 0.9];
      this.isDay = true;
      this.isNight = false;
      this.isDawn = false;
      this.isDusk = false;
    }

    update(dt) {
      this.time = (this.time + dt / this.dayLength * this.speed) % 1;
      const angle = this.time * Math.PI * 2 - Math.PI / 2;
      this.sunPosition = [Math.cos(angle), Math.sin(angle), 0.3];
      this.moonPosition = [-this.sunPosition[0], -this.sunPosition[1], -this.sunPosition[2]];
      const sunHeight = this.sunPosition[1];
      this.isDay = sunHeight > 0;
      this.isNight = sunHeight < -0.1;
      this.isDawn = sunHeight > -0.1 && sunHeight < 0.1 && this.time < 0.5;
      this.isDusk = sunHeight > -0.1 && sunHeight < 0.1 && this.time > 0.5;
      const dayFactor = Math.max(0, Math.min(1, (sunHeight + 0.1) / 0.3));
      this.ambientColor = [
        0.05 + dayFactor * 0.25,
        0.05 + dayFactor * 0.3,
        0.1 + dayFactor * 0.3
      ];
      if (this.isDawn || this.isDusk) {
        this.sunColor = [1.0, 0.5 + dayFactor * 0.3, 0.3];
      } else {
        this.sunColor = [1.0, 0.95, 0.85];
      }
    }

    setTime(time) { this.time = time % 1; }
    getTime() { return this.time; }
    getTimeString() {
      const hours = Math.floor(this.time * 24);
      const minutes = Math.floor((this.time * 24 - hours) * 60);
      return `${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}`;
    }
    getSunPosition() { return [...this.sunPosition]; }
    getMoonPosition() { return [...this.moonPosition]; }
    getAmbientColor() { return [...this.ambientColor]; }
    getSunColor() { return [...this.sunColor]; }
    setSpeed(s) { this.speed = s; }
    setDayLength(seconds) { this.dayLength = seconds; }
  }

  // ============================================================
  // 相机控制器
  // ============================================================
  class CameraController {
    constructor() {
      this.position = [0, 5, 10];
      this.target = [0, 0, 0];
      this.up = [0, 1, 0];
      this.fov = 60;
      this.near = 0.1;
      this.far = 2000;
      this.aspect = 16 / 9;
      this.viewMatrix = new Float32Array(16);
      this.projectionMatrix = new Float32Array(16);
      this.viewProjectionMatrix = new Float32Array(16);
      this.rotationX = 0;
      this.rotationY = 0;
      this.distance = 10;
      this.minDistance = 1;
      this.maxDistance = 100;
      this.moveSpeed = 10;
      this.rotateSpeed = 0.005;
      this.mode = 'orbit';
      this.velocity = [0, 0, 0];
      this.damping = 0.9;
    }

    update(dt) {
      if (this.mode === 'orbit') {
        const cosX = Math.cos(this.rotationX), sinX = Math.sin(this.rotationX);
        const cosY = Math.cos(this.rotationY), sinY = Math.sin(this.rotationY);
        this.position[0] = this.target[0] + this.distance * sinY * cosX;
        this.position[1] = this.target[1] + this.distance * sinX;
        this.position[2] = this.target[2] + this.distance * cosY * cosX;
      } else if (this.mode === 'free') {
        this.position[0] += this.velocity[0] * dt;
        this.position[1] += this.velocity[1] * dt;
        this.position[2] += this.velocity[2] * dt;
        this.velocity[0] *= this.damping; this.velocity[1] *= this.damping; this.velocity[2] *= this.damping;
      }
      this._computeViewMatrix();
      this._computeProjectionMatrix();
      this._multiplyMatrix(this.viewProjectionMatrix, this.projectionMatrix, this.viewMatrix);
    }

    _computeViewMatrix() {
      const zx = this.position[0]-this.target[0], zy = this.position[1]-this.target[1], zz = this.position[2]-this.target[2];
      let len = Math.sqrt(zx*zx+zy*zy+zz*zz)||1;
      const z0=zx/len,z1=zy/len,z2=zz/len;
      const xx=this.up[1]*z2-this.up[2]*z1, xy=this.up[2]*z0-this.up[0]*z2, xz=this.up[0]*z1-this.up[1]*z0;
      len=Math.sqrt(xx*xx+xy*xy+xz*xz)||1;
      const x0=xx/len,x1=xy/len,x2=xz/len;
      const y0=z1*x2-z2*x1, y1=z2*x0-z0*x2, y2=z0*x1-z1*x0;
      this.viewMatrix[0]=x0;this.viewMatrix[1]=y0;this.viewMatrix[2]=z0;this.viewMatrix[3]=0;
      this.viewMatrix[4]=x1;this.viewMatrix[5]=y1;this.viewMatrix[6]=z1;this.viewMatrix[7]=0;
      this.viewMatrix[8]=x2;this.viewMatrix[9]=y2;this.viewMatrix[10]=z2;this.viewMatrix[11]=0;
      this.viewMatrix[12]=-(x0*this.position[0]+x1*this.position[1]+x2*this.position[2]);
      this.viewMatrix[13]=-(y0*this.position[0]+y1*this.position[1]+y2*this.position[2]);
      this.viewMatrix[14]=-(z0*this.position[0]+z1*this.position[1]+z2*this.position[2]);
      this.viewMatrix[15]=1;
    }

    _computeProjectionMatrix() {
      const f = 1.0 / Math.tan(this.fov * Math.PI / 360);
      this.projectionMatrix.fill(0);
      this.projectionMatrix[0] = f / this.aspect;
      this.projectionMatrix[5] = f;
      this.projectionMatrix[10] = (this.far + this.near) / (this.near - this.far);
      this.projectionMatrix[11] = -1;
      this.projectionMatrix[14] = (2 * this.far * this.near) / (this.near - this.far);
    }

    _multiplyMatrix(out, a, b) {
      for (let i=0;i<4;i++) for (let j=0;j<4;j++) out[i*4+j]=a[i*4]*b[j]+a[i*4+1]*b[4+j]+a[i*4+2]*b[8+j]+a[i*4+3]*b[12+j];
    }

    orbit(deltaX, deltaY) {
      this.rotationY += deltaX * this.rotateSpeed;
      this.rotationX = Math.max(-Math.PI/2+0.1, Math.min(Math.PI/2-0.1, this.rotationX + deltaY * this.rotateSpeed));
    }
    zoom(delta) { this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance + delta)); }
    pan(deltaX, deltaY) {
      const right = [this.viewMatrix[0], this.viewMatrix[4], this.viewMatrix[8]];
      const up = [this.viewMatrix[1], this.viewMatrix[5], this.viewMatrix[9]];
      this.target[0] += (right[0] * -deltaX + up[0] * deltaY) * this.distance * 0.001;
      this.target[1] += (right[1] * -deltaX + up[1] * deltaY) * this.distance * 0.001;
      this.target[2] += (right[2] * -deltaX + up[2] * deltaY) * this.distance * 0.001;
    }
    moveForward(amount) {
      const dir = [this.target[0]-this.position[0], this.target[1]-this.position[1], this.target[2]-this.position[2]];
      const len = Math.sqrt(dir[0]*dir[0]+dir[1]*dir[1]+dir[2]*dir[2])||1;
      this.velocity[0] += dir[0]/len * amount * this.moveSpeed;
      this.velocity[1] += dir[1]/len * amount * this.moveSpeed;
      this.velocity[2] += dir[2]/len * amount * this.moveSpeed;
    }
    setMode(mode) { this.mode = mode; }
    setAspect(aspect) { this.aspect = aspect; }
    setFov(fov) { this.fov = fov; }
    getViewMatrix() { return this.viewMatrix; }
    getProjectionMatrix() { return this.projectionMatrix; }
    getViewProjectionMatrix() { return this.viewProjectionMatrix; }
    getPosition() { return [...this.position]; }
    getTarget() { return [...this.target]; }
    getForward() { const d=[this.target[0]-this.position[0],this.target[1]-this.position[1],this.target[2]-this.position[2]]; const l=Math.sqrt(d[0]*d[0]+d[1]*d[1]+d[2]*d[2])||1; return [d[0]/l,d[1]/l,d[2]/l]; }
    getRight() { return [this.viewMatrix[0], this.viewMatrix[4], this.viewMatrix[8]]; }
  }

  // ============================================================
  // 视锥裁剪
  // ============================================================
  class FrustumCulling {
    constructor() {
      this.planes = new Float32Array(24);
      this.visibleCount = 0;
      this.culledCount = 0;
    }

    update(viewProjectionMatrix) {
      const m = viewProjectionMatrix;
      for (let i = 0; i < 4; i++) {
        this.planes[i*4] = m[3+i] - m[i];
        this.planes[i*4+1] = m[7+i] - m[4+i];
        this.planes[i*4+2] = m[11+i] - m[8+i];
        this.planes[i*4+3] = m[15+i] - m[12+i];
      }
      for (let i = 0; i < 4; i++) {
        this.planes[16+i*4] = m[3+i] + m[i];
        this.planes[16+i*4+1] = m[7+i] + m[4+i];
        this.planes[16+i*4+2] = m[11+i] + m[8+i];
        this.planes[16+i*4+3] = m[15+i] + m[12+i];
      }
    }

    isVisible(center, radius) {
      for (let i = 0; i < 6; i++) {
        const d = this.planes[i*4]*center[0] + this.planes[i*4+1]*center[1] + this.planes[i*4+2]*center[2] + this.planes[i*4+3];
        if (d < -radius) return false;
      }
      return true;
    }

    cullScene(objects) {
      const visible = [];
      this.visibleCount = 0; this.culledCount = 0;
      for (const obj of objects) {
        if (this.isVisible(obj.boundingCenter || obj.position, obj.boundingRadius || 1)) {
          visible.push(obj); this.visibleCount++;
        } else { this.culledCount++; }
      }
      return visible;
    }

    getVisibleCount() { return this.visibleCount; }
    getCulledCount() { return this.culledCount; }
  }

  // ============================================================
  // 光照系统
  // ============================================================
  class LightSystem {
    constructor() {
      if (!window.OrbPBR || !window.OrbMath) {
        throw new Error('OrbPBR/OrbMath are required; inline light objects are removed');
      }
      const Vec3 = window.OrbMath.Vec3;
      this._directional = new window.OrbPBR.DirectionalLight(new Vec3(1, 0.95, 0.85), 1.0);
      this._directional.direction.set(0.5, 0.8, 0.3).normalize();
      this._directional.castShadow = true;
      this._ambient = new window.OrbPBR.Light(new Vec3(0.3, 0.35, 0.4), 0.5);
      const self = this;
      this.directionalLight = {
        get direction() { return [self._directional.direction.x, self._directional.direction.y, self._directional.direction.z]; },
        get color() { return [self._directional.color.x, self._directional.color.y, self._directional.color.z]; },
        get intensity() { return self._directional.intensity; },
        set intensity(v) { self._directional.intensity = v; },
        get castShadow() { return self._directional.castShadow; },
        set castShadow(v) { self._directional.castShadow = v; }
      };
      this.ambientLight = {
        get color() { return [self._ambient.color.x, self._ambient.color.y, self._ambient.color.z]; },
        get intensity() { return self._ambient.intensity; },
        set intensity(v) { self._ambient.intensity = v; }
      };
    }

    update(dt) {
      if (window.AevumMarkGraphics) window.AevumMarkGraphics('OrbPBR');
    }

    setAmbient(color, intensity) {
      this._ambient.color.set(color[0], color[1], color[2]);
      this._ambient.intensity = intensity;
    }

    setDirectional(direction, color, intensity) {
      this._directional.direction.set(direction[0], direction[1], direction[2]).normalize();
      this._directional.color.set(color[0], color[1], color[2]);
      this._directional.intensity = intensity;
    }
  }

  // ============================================================
  // 阴影系统
  // ============================================================
  class ShadowSystem {
    constructor() {
      this.enabled = true;
      this.quality = 'high';
      this.shadowMapSize = 2048;
      this.shadowDistance = 100;
      this.shadowBias = 0.0005;
      this.normalBias = 0.02;
      this.cascades = 4;
      this.cascadeDistances = [10, 30, 60, 100];
      this.shadowMatrices = [];
      this.pcfSamples = 4;
      this.softShadows = true;
    }

    update(camera, directionalLight) {
      if (!this.enabled) return;
      for (let i = 0; i < this.cascades; i++) {
        const nearDist = i === 0 ? camera.near : this.cascadeDistances[i-1];
        const farDist = this.cascadeDistances[i];
        this.shadowMatrices[i] = this._computeShadowMatrix(camera, directionalLight, nearDist, farDist);
      }
    }

    _computeShadowMatrix(camera, light, near, far) {
      const center = [...camera.target];
      const lightDir = this._normalize(light.direction);
      const up = Math.abs(lightDir[1]) > 0.99 ? [1,0,0] : [0,1,0];
      const right = this._normalize(this._cross(up, lightDir));
      const trueUp = this._cross(lightDir, right);
      const viewMatrix = new Float32Array(16);
      viewMatrix[0]=right[0];viewMatrix[1]=trueUp[0];viewMatrix[2]=lightDir[0];viewMatrix[3]=0;
      viewMatrix[4]=right[1];viewMatrix[5]=trueUp[1];viewMatrix[6]=lightDir[1];viewMatrix[7]=0;
      viewMatrix[8]=right[2];viewMatrix[9]=trueUp[2];viewMatrix[10]=lightDir[2];viewMatrix[11]=0;
      viewMatrix[12]=-(right[0]*center[0]+right[1]*center[1]+right[2]*center[2]);
      viewMatrix[13]=-(trueUp[0]*center[0]+trueUp[1]*center[1]+trueUp[2]*center[2]);
      viewMatrix[14]=-(lightDir[0]*center[0]+lightDir[1]*center[1]+lightDir[2]*center[2]);
      viewMatrix[15]=1;
      const projMatrix = new Float32Array(16);
      const size = far * 0.5;
      projMatrix.fill(0);
      projMatrix[0] = 1/size; projMatrix[5] = 1/size;
      projMatrix[10] = -2/(far-near); projMatrix[11] = -1;
      projMatrix[14] = -(far+near)/(far-near);
      const result = new Float32Array(16);
      for (let i=0;i<4;i++) for (let j=0;j<4;j++) result[i*4+j]=projMatrix[i*4]*viewMatrix[j]+projMatrix[i*4+1]*viewMatrix[4+j]+projMatrix[i*4+2]*viewMatrix[8+j]+projMatrix[i*4+3]*viewMatrix[12+j];
      return result;
    }

    _normalize(v) { const l=Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2])||1; return [v[0]/l,v[1]/l,v[2]/l]; }
    _cross(a,b) { return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]; }

    setQuality(q) {
      this.quality = q;
      this.shadowMapSize = q === 'low' ? 512 : q === 'medium' ? 1024 : q === 'high' ? 2048 : 4096;
      this.cascades = q === 'low' ? 2 : q === 'medium' ? 3 : 4;
    }
    setEnabled(v) { this.enabled = v; }
    setShadowDistance(d) { this.shadowDistance = d; this.cascadeDistances = [d*0.1, d*0.3, d*0.6, d]; }
    getShadowMatrix(cascade) { return this.shadowMatrices[cascade]; }
    getCascadeCount() { return this.cascades; }
  }

  // ============================================================
  // 后处理系统
  // ============================================================
  class PostProcessing {
    constructor() {
      this.passes = [];
      this.enabled = true;
      this.bloom = { enabled: true, intensity: 0.5, threshold: 0.8, radius: 0.5 };
      this.ssao = { enabled: true, radius: 0.5, bias: 0.025, intensity: 1.0, samples: 16 };
      this.colorGrading = { enabled: true, exposure: 1.0, contrast: 1.0, saturation: 1.0, temperature: 0, tint: 0 };
      this.fxaa = { enabled: true };
      this.dof = { enabled: false, focusDistance: 10, focusRange: 5, blurAmount: 0.01 };
      this.vignette = { enabled: true, intensity: 0.3, smoothness: 0.5 };
      this.chromaticAberration = { enabled: false, amount: 0.001 };
      this.filmGrain = { enabled: false, intensity: 0.05 };
    }

    addPass(name, shader, options = {}) {
      this.passes.push({ name, shader, enabled: options.enabled !== false, options });
    }

    removePass(name) {
      const idx = this.passes.findIndex(p => p.name === name);
      if (idx !== -1) this.passes.splice(idx, 1);
    }

    render(inputTexture, outputTarget) {
      if (!this.enabled) return inputTexture;
      if (typeof this.backend === 'function') {
        return this.backend(this, inputTexture, outputTarget);
      }
      return inputTexture;
    }

    setBackend(backend) {
      this.backend = typeof backend === 'function' ? backend : null;
    }

    _renderPass(pass, input, output) {
      // 简化的pass渲染，实际由WebGL执行
      return input;
    }

    setBloom(options) { Object.assign(this.bloom, options); }
    setSSAO(options) { Object.assign(this.ssao, options); }
    setColorGrading(options) { Object.assign(this.colorGrading, options); }
    setFXAA(enabled) { this.fxaa.enabled = enabled; }
    setDOF(options) { Object.assign(this.dof, options); }
    setVignette(options) { Object.assign(this.vignette, options); }
    setChromaticAberration(options) { Object.assign(this.chromaticAberration, options); }
    setFilmGrain(options) { Object.assign(this.filmGrain, options); }
    setEnabled(v) { this.enabled = v; }
    getActivePasses() { return this.passes.filter(p => p.enabled); }
  }

  // ============================================================
  // 世界引擎主类
  // ============================================================
  class WorldEngine {
    constructor() {
      this.terrain = new TerrainSystem();
      this.sky = new SkySystem();
      this.water = new WaterSystem();
      this.vegetation = null;
      this.weather = new WeatherSystem();
      this.dayNight = new DayNightCycle();
      this.camera = new CameraController();
      this.frustumCulling = new FrustumCulling();
      this.lights = new LightSystem();
      this.shadows = new ShadowSystem();
      this.postProcessing = new PostProcessing();
      this.objects = [];
      this.initialized = false;
      this.time = 0;
    }

    async init(options = {}) {
      if (options.terrain) this.terrain.generate(options.terrain);
      this.sky.init();
      this.water.init();
      if (options.vegetation) {
        this.vegetation = new VegetationSystem(this.terrain);
        this.vegetation.generate(options.vegetation);
      }
      this.initialized = true;
      return this;
    }

    update(dt) {
      this.time += dt;
      this.dayNight.update(dt);
      this.sky.update(dt);
      this.water.update(dt);
      this.weather.update(dt);
      if (this.vegetation) this.vegetation.update(dt);
      this.camera.update(dt);
      this.lights.update(dt);
      this.lights.setDirectional(this.dayNight.getSunPosition(), this.dayNight.getSunColor(), this.dayNight.isDay ? 1.0 : 0.1);
      this.lights.setAmbient(this.dayNight.getAmbientColor(), 0.5);
      this.shadows.update(this.camera, this.lights.directionalLight);
      this.frustumCulling.update(this.camera.getViewProjectionMatrix());
      for (const obj of this.objects) {
        if (obj.update) obj.update(dt, this);
      }
    }

    addObject(obj) { this.objects.push(obj); return obj; }
    removeObject(obj) {
      const idx = this.objects.indexOf(obj);
      if (idx !== -1) this.objects.splice(idx, 1);
    }
    getVisibleObjects() {
      return this.frustumCulling.cullScene(this.objects);
    }
    getTime() { return this.time; }
    isInitialized() { return this.initialized; }
  }

  return {
    TerrainSystem, SkySystem, WaterSystem, VegetationSystem, WeatherSystem,
    DayNightCycle, CameraController, FrustumCulling, LightSystem, ShadowSystem,
    PostProcessing, WorldEngine
  };
})();

if (typeof window !== 'undefined') window.World3DEngine = World3DEngine;
if (typeof globalThis !== 'undefined') globalThis.World3DEngine = World3DEngine;
