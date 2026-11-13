/**
 * 3D世界 - 地形生成器/大气散射/LOD系统/天气系统/昼夜循环
 * 纯JavaScript，零第三方依赖
 * @version 4.0.0
 */
'use strict';

const World3DV4 = (function () {

  class TerrainGenerator {
    constructor() {
      this.width = 256;
      this.height = 256;
      this.scale = 10;
      this.heightScale = 20;
      this.octaves = 6;
      this.persistence = 0.5;
      this.lacunarity = 2;
      this.seed = 12345;
      this.heightMap = null;
      this.normalMap = null;
      this.colorMap = null;
      this.permutation = this._generatePermutation(this.seed);
    }

    generate() {
      this.heightMap = new Float32Array(this.width * this.height);
      this.normalMap = new Float32Array(this.width * this.height * 3);
      this.colorMap = new Float32Array(this.width * this.height * 3);
      for (let z = 0; z < this.height; z++) {
        for (let x = 0; x < this.width; x++) {
          const idx = z * this.width + x;
          this.heightMap[idx] = this._generateHeight(x, z);
        }
      }
      this._computeNormals();
      this._computeColors();
      return this.heightMap;
    }

    _generateHeight(x, z) {
      let amplitude = 1;
      let frequency = 1;
      let height = 0;
      let maxValue = 0;
      for (let i = 0; i < this.octaves; i++) {
        const sampleX = x / this.width * this.scale * frequency;
        const sampleZ = z / this.height * this.scale * frequency;
        height += this._perlinNoise(sampleX, sampleZ) * amplitude;
        maxValue += amplitude;
        amplitude *= this.persistence;
        frequency *= this.lacunarity;
      }
      return (height / maxValue) * this.heightScale;
    }

    _perlinNoise(x, z) {
      const X = Math.floor(x) & 255;
      const Z = Math.floor(z) & 255;
      const xf = x - Math.floor(x);
      const zf = z - Math.floor(z);
      const u = this._fade(xf);
      const v = this._fade(zf);
      const aa = this.permutation[(this.permutation[X] + Z) & 255];
      const ab = this.permutation[(this.permutation[X] + Z + 1) & 255];
      const ba = this.permutation[(this.permutation[X + 1] + Z) & 255];
      const bb = this.permutation[(this.permutation[X + 1] + Z + 1) & 255];
      const x1 = this._lerp(this._grad(aa, xf, zf), this._grad(ba, xf - 1, zf), u);
      const x2 = this._lerp(this._grad(ab, xf, zf - 1), this._grad(bb, xf - 1, zf - 1), u);
      return this._lerp(x1, x2, v);
    }

    _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    _lerp(a, b, t) { return a + t * (b - a); }
    _grad(hash, x, z) {
      const h = hash & 3;
      const u = h < 2 ? x : z;
      const v = h < 2 ? z : x;
      return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    _generatePermutation(seed) {
      const p = new Array(512);
      const permutation = new Array(256);
      for (let i = 0; i < 256; i++) permutation[i] = i;
      let n = seed;
      for (let i = 255; i > 0; i--) {
        n = (n * 16807) % 2147483647;
        const j = n % (i + 1);
        [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
      }
      for (let i = 0; i < 512; i++) p[i] = permutation[i & 255];
      return p;
    }

    _computeNormals() {
      for (let z = 0; z < this.height; z++) {
        for (let x = 0; x < this.width; x++) {
          const idx = z * this.width + x;
          const hL = this.heightMap[Math.max(0, x - 1) + z * this.width];
          const hR = this.heightMap[Math.min(this.width - 1, x + 1) + z * this.width];
          const hD = this.heightMap[x + Math.max(0, z - 1) * this.width];
          const hU = this.heightMap[x + Math.min(this.height - 1, z + 1) * this.width];
          const nx = hL - hR;
          const nz = hD - hU;
          const ny = 2;
          const length = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
          this.normalMap[idx * 3] = nx / length;
          this.normalMap[idx * 3 + 1] = ny / length;
          this.normalMap[idx * 3 + 2] = nz / length;
        }
      }
    }

    _computeColors() {
      for (let z = 0; z < this.height; z++) {
        for (let x = 0; x < this.width; x++) {
          const idx = z * this.width + x;
          const height = this.heightMap[idx];
          const slope = 1 - this.normalMap[idx * 3 + 1];
          let color;
          if (height < this.heightScale * 0.1) {
            color = [0.76, 0.7, 0.5];
          } else if (height < this.heightScale * 0.3) {
            color = [0.4, 0.6, 0.3];
          } else if (height < this.heightScale * 0.5) {
            color = [0.3, 0.5, 0.25];
          } else if (height < this.heightScale * 0.7) {
            color = [0.5, 0.45, 0.4];
          } else {
            color = [0.9, 0.9, 0.95];
          }
          if (slope > 0.5) {
            color = [0.4, 0.35, 0.3];
          }
          this.colorMap[idx * 3] = color[0];
          this.colorMap[idx * 3 + 1] = color[1];
          this.colorMap[idx * 3 + 2] = color[2];
        }
      }
    }

    getHeight(x, z) {
      const ix = Math.floor(x);
      const iz = Math.floor(z);
      if (ix < 0 || ix >= this.width || iz < 0 || iz >= this.height) return 0;
      return this.heightMap[iz * this.width + ix];
    }

    getHeightInterpolated(x, z) {
      const x0 = Math.floor(x);
      const z0 = Math.floor(z);
      const x1 = Math.min(x0 + 1, this.width - 1);
      const z1 = Math.min(z0 + 1, this.height - 1);
      const tx = x - x0;
      const tz = z - z0;
      const h00 = this.getHeight(x0, z0);
      const h10 = this.getHeight(x1, z0);
      const h01 = this.getHeight(x0, z1);
      const h11 = this.getHeight(x1, z1);
      const h0 = h00 + (h10 - h00) * tx;
      const h1 = h01 + (h11 - h01) * tx;
      return h0 + (h1 - h0) * tz;
    }

    getNormal(x, z) {
      const ix = Math.floor(x);
      const iz = Math.floor(z);
      if (ix < 0 || ix >= this.width || iz < 0 || iz >= this.height) return [0, 1, 0];
      const idx = iz * this.width + ix;
      return [this.normalMap[idx*3], this.normalMap[idx*3+1], this.normalMap[idx*3+2]];
    }

    getSlope(x, z) {
      const normal = this.getNormal(x, z);
      return 1 - normal[1];
    }

    getMeshData() {
      const vertices = new Float32Array(this.width * this.height * 3);
      const normals = new Float32Array(this.width * this.height * 3);
      const uvs = new Float32Array(this.width * this.height * 2);
      const colors = new Float32Array(this.width * this.height * 3);
      const indices = new Uint32Array((this.width - 1) * (this.height - 1) * 6);
      for (let z = 0; z < this.height; z++) {
        for (let x = 0; x < this.width; x++) {
          const idx = z * this.width + x;
          vertices[idx*3] = (x - this.width / 2) / this.width * this.scale * 10;
          vertices[idx*3+1] = this.heightMap[idx];
          vertices[idx*3+2] = (z - this.height / 2) / this.height * this.scale * 10;
          normals[idx*3] = this.normalMap[idx*3];
          normals[idx*3+1] = this.normalMap[idx*3+1];
          normals[idx*3+2] = this.normalMap[idx*3+2];
          uvs[idx*2] = x / this.width;
          uvs[idx*2+1] = z / this.height;
          colors[idx*3] = this.colorMap[idx*3];
          colors[idx*3+1] = this.colorMap[idx*3+1];
          colors[idx*3+2] = this.colorMap[idx*3+2];
        }
      }
      let idx = 0;
      for (let z = 0; z < this.height - 1; z++) {
        for (let x = 0; x < this.width - 1; x++) {
          const a = z * this.width + x;
          const b = a + this.width;
          indices[idx++] = a;
          indices[idx++] = b;
          indices[idx++] = a + 1;
          indices[idx++] = a + 1;
          indices[idx++] = b;
          indices[idx++] = b + 1;
        }
      }
      return { vertices, normals, uvs, colors, indices, vertexCount: this.width * this.height, indexCount: indices.length };
    }

    setSeed(seed) {
      this.seed = seed;
      this.permutation = this._generatePermutation(seed);
    }
    setSize(width, height) { this.width = width; this.height = height; }
    setScale(scale) { this.scale = scale; }
    setHeightScale(scale) { this.heightScale = scale; }
    setOctaves(octaves) { this.octaves = octaves; }
    setPersistence(persistence) { this.persistence = persistence; }
    setLacunarity(lacunarity) { this.lacunarity = lacunarity; }
    getHeightMap() { return this.heightMap; }
    getNormalMap() { return this.normalMap; }
    getColorMap() { return this.colorMap; }
  }

  class AtmosphericScattering {
    constructor() {
      this.sunDirection = [0, 1, 0];
      this.sunIntensity = 1;
      this.rayleighCoefficient = [5.5, 13, 22.4];
      this.mieCoefficient = [21, 21, 21];
      this.rayleighScaleHeight = 8000;
      this.mieScaleHeight = 1200;
      this.miePreferredDirection = 0.758;
      this.atmosphereRadius = 6420000;
      this.planetRadius = 6371000;
      this.numPrimarySteps = 16;
      this.numSecondarySteps = 8;
      this.exposure = 1;
      this.enabled = true;
    }

    computeSkyColor(direction) {
      if (!this.enabled) return [0.5, 0.7, 1];
      const sunDir = this._normalize(this.sunDirection);
      const viewDir = this._normalize(direction);
      const planetCenter = [0, -this.planetRadius, 0];
      const rayOrigin = [0, 0, 0];
      const atmosphereIntersection = this._raySphereIntersection(rayOrigin, viewDir, planetCenter, this.atmosphereRadius);
      if (!atmosphereIntersection) return [0, 0, 0];
      const planetIntersection = this._raySphereIntersection(rayOrigin, viewDir, planetCenter, this.planetRadius);
      const rayLength = planetIntersection ? Math.min(atmosphereIntersection, planetIntersection) : atmosphereIntersection;
      const stepSize = rayLength / this.numPrimarySteps;
      let totalRayleigh = [0, 0, 0];
      let totalMie = [0, 0, 0];
      let opticalDepthRayleigh = 0;
      let opticalDepthMie = 0;
      for (let i = 0; i < this.numPrimarySteps; i++) {
        const samplePosition = this._add(rayOrigin, this._multiply(viewDir, stepSize * (i + 0.5)));
        const height = this._distance(samplePosition, planetCenter) - this.planetRadius;
        const rayleighDensity = Math.exp(-height / this.rayleighScaleHeight) * stepSize;
        const mieDensity = Math.exp(-height / this.mieScaleHeight) * stepSize;
        opticalDepthRayleigh += rayleighDensity;
        opticalDepthMie += mieDensity;
        const sunRayLength = this._raySphereIntersection(samplePosition, sunDir, planetCenter, this.atmosphereRadius);
        if (sunRayLength) {
          const sunStepSize = sunRayLength / this.numSecondarySteps;
          let sunOpticalDepthRayleigh = 0;
          let sunOpticalDepthMie = 0;
          for (let j = 0; j < this.numSecondarySteps; j++) {
            const sunSamplePosition = this._add(samplePosition, this._multiply(sunDir, sunStepSize * (j + 0.5)));
            const sunHeight = this._distance(sunSamplePosition, planetCenter) - this.planetRadius;
            sunOpticalDepthRayleigh += Math.exp(-sunHeight / this.rayleighScaleHeight) * sunStepSize;
            sunOpticalDepthMie += Math.exp(-sunHeight / this.mieScaleHeight) * sunStepSize;
          }
          const attenuation = [
            Math.exp(-(this.rayleighCoefficient[0] * (opticalDepthRayleigh + sunOpticalDepthRayleigh) + this.mieCoefficient[0] * (opticalDepthMie + sunOpticalDepthMie))),
            Math.exp(-(this.rayleighCoefficient[1] * (opticalDepthRayleigh + sunOpticalDepthRayleigh) + this.mieCoefficient[1] * (opticalDepthMie + sunOpticalDepthMie))),
            Math.exp(-(this.rayleighCoefficient[2] * (opticalDepthRayleigh + sunOpticalDepthRayleigh) + this.mieCoefficient[2] * (opticalDepthMie + sunOpticalDepthMie)))
          ];
          totalRayleigh[0] += rayleighDensity * attenuation[0];
          totalRayleigh[1] += rayleighDensity * attenuation[1];
          totalRayleigh[2] += rayleighDensity * attenuation[2];
          totalMie[0] += mieDensity * attenuation[0];
          totalMie[1] += mieDensity * attenuation[1];
          totalMie[2] += mieDensity * attenuation[2];
        }
      }
      const mu = this._dot(viewDir, sunDir);
      const phaseRayleigh = 3 / (16 * Math.PI) * (1 + mu * mu);
      const g = this.miePreferredDirection;
      const phaseMie = 3 / (8 * Math.PI) * ((1 - g * g) * (1 + mu * mu)) / ((2 + g * g) * Math.pow(1 + g * g - 2 * g * mu, 1.5));
      const color = [
        (totalRayleigh[0] * this.rayleighCoefficient[0] * phaseRayleigh + totalMie[0] * this.mieCoefficient[0] * phaseMie) * this.sunIntensity * this.exposure,
        (totalRayleigh[1] * this.rayleighCoefficient[1] * phaseRayleigh + totalMie[1] * this.mieCoefficient[1] * phaseMie) * this.sunIntensity * this.exposure,
        (totalRayleigh[2] * this.rayleighCoefficient[2] * phaseRayleigh + totalMie[2] * this.mieCoefficient[2] * phaseMie) * this.sunIntensity * this.exposure
      ];
      return [
        1 - Math.exp(-color[0]),
        1 - Math.exp(-color[1]),
        1 - Math.exp(-color[2])
      ];
    }

    _raySphereIntersection(origin, direction, center, radius) {
      const oc = this._subtract(origin, center);
      const a = this._dot(direction, direction);
      const b = 2 * this._dot(oc, direction);
      const c = this._dot(oc, oc) - radius * radius;
      const discriminant = b * b - 4 * a * c;
      if (discriminant < 0) return null;
      const t = (-b - Math.sqrt(discriminant)) / (2 * a);
      return t > 0 ? t : null;
    }

    _normalize(v) {
      const l = Math.sqrt(v[0]**2 + v[1]**2 + v[2]**2) || 1;
      return [v[0]/l, v[1]/l, v[2]/l];
    }
    _add(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
    _subtract(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
    _multiply(v, s) { return [v[0]*s, v[1]*s, v[2]*s]; }
    _dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
    _distance(a, b) { return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2); }

    setSunDirection(x, y, z) { this.sunDirection = [x, y, z]; }
    setSunIntensity(v) { this.sunIntensity = v; }
    setExposure(v) { this.exposure = v; }
    setEnabled(v) { this.enabled = v; }
  }

  class LODSystem {
    constructor() {
      this.levels = [];
      this.currentLevel = 0;
      this.cameraPosition = [0, 0, 0];
      this.transitionDistance = 10;
      this.enabled = true;
      this.stats = { totalObjects: 0, visibleObjects: 0, culledObjects: 0 };
    }

    addLevel(config) {
      this.levels.push({
        distance: config.distance || 0,
        mesh: config.mesh,
        material: config.material,
        polygonCount: config.polygonCount || 0,
        enabled: config.enabled !== false
      });
      this.levels.sort((a, b) => a.distance - b.distance);
    }

    removeLevel(index) {
      this.levels.splice(index, 1);
    }

    update(objects, cameraPosition) {
      this.cameraPosition = cameraPosition;
      this.stats = { totalObjects: objects.length, visibleObjects: 0, culledObjects: 0 };
      for (const obj of objects) {
        const distance = this._distance(obj.position, cameraPosition);
        const level = this._getLevelForDistance(distance);
        if (level >= 0 && this.levels[level]) {
          obj.currentLOD = level;
          obj.currentMesh = this.levels[level].mesh;
          obj.currentMaterial = this.levels[level].material;
          this.stats.visibleObjects++;
        } else {
          obj.visible = false;
          this.stats.culledObjects++;
        }
      }
    }

    _getLevelForDistance(distance) {
      for (let i = this.levels.length - 1; i >= 0; i--) {
        if (distance >= this.levels[i].distance) return i;
      }
      return 0;
    }

    _distance(a, b) {
      return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
    }

    getLevelCount() { return this.levels.length; }
    getStats() { return { ...this.stats }; }
    setEnabled(v) { this.enabled = v; }
    clear() { this.levels = []; }
  }

  class WeatherSystem {
    constructor() {
      this.currentWeather = 'clear';
      this.targetWeather = 'clear';
      this.transitionSpeed = 0.1;
      this.intensity = 0;
      this.targetIntensity = 0;
      this.windDirection = [1, 0, 0];
      this.windSpeed = 0;
      this.temperature = 20;
      this.humidity = 50;
      this.pressure = 1013;
      this.cloudCoverage = 0;
      this.fogDensity = 0;
      this.rainParticles = [];
      this.snowParticles = [];
      this.particleCount = 1000;
      this.areaSize = 50;
      this.enabled = true;
      this.weatherTypes = {
        clear: { intensity: 0, cloudCoverage: 0, fogDensity: 0, windSpeed: 0.1, humidity: 30 },
        cloudy: { intensity: 0.3, cloudCoverage: 0.6, fogDensity: 0.01, windSpeed: 0.3, humidity: 60 },
        overcast: { intensity: 0.5, cloudCoverage: 0.9, fogDensity: 0.02, windSpeed: 0.5, humidity: 75 },
        rain: { intensity: 0.7, cloudCoverage: 0.95, fogDensity: 0.03, windSpeed: 0.8, humidity: 90 },
        storm: { intensity: 1, cloudCoverage: 1, fogDensity: 0.05, windSpeed: 1.5, humidity: 95 },
        snow: { intensity: 0.6, cloudCoverage: 0.8, fogDensity: 0.04, windSpeed: 0.4, humidity: 80 },
        fog: { intensity: 0.4, cloudCoverage: 0.3, fogDensity: 0.1, windSpeed: 0.05, humidity: 95 }
      };
    }

    setWeather(type) {
      if (this.weatherTypes[type]) {
        this.targetWeather = type;
        const weather = this.weatherTypes[type];
        this.targetIntensity = weather.intensity;
      }
    }

    update(deltaTime) {
      if (!this.enabled) return;
      this.intensity += (this.targetIntensity - this.intensity) * this.transitionSpeed * deltaTime;
      const weather = this.weatherTypes[this.targetWeather];
      this.cloudCoverage += (weather.cloudCoverage - this.cloudCoverage) * this.transitionSpeed * deltaTime;
      this.fogDensity += (weather.fogDensity - this.fogDensity) * this.transitionSpeed * deltaTime;
      this.windSpeed += (weather.windSpeed - this.windSpeed) * this.transitionSpeed * deltaTime;
      this.humidity += (weather.humidity - this.humidity) * this.transitionSpeed * deltaTime;
      if (this.targetWeather === 'rain' || this.targetWeather === 'storm') {
        this._updateRain(deltaTime);
      } else if (this.targetWeather === 'snow') {
        this._updateSnow(deltaTime);
      }
    }

    _updateRain(deltaTime) {
      if (this.rainParticles.length === 0) {
        for (let i = 0; i < this.particleCount; i++) {
          this.rainParticles.push({
            x: (Math.random() - 0.5) * this.areaSize,
            y: Math.random() * this.areaSize,
            z: (Math.random() - 0.5) * this.areaSize,
            speed: 15 + Math.random() * 10,
            length: 0.5 + Math.random() * 0.5
          });
        }
      }
      for (const particle of this.rainParticles) {
        particle.y -= particle.speed * deltaTime * this.intensity;
        particle.x += this.windDirection[0] * this.windSpeed * deltaTime * 5;
        particle.z += this.windDirection[2] * this.windSpeed * deltaTime * 5;
        if (particle.y < 0) {
          particle.y = this.areaSize;
          particle.x = (Math.random() - 0.5) * this.areaSize;
          particle.z = (Math.random() - 0.5) * this.areaSize;
        }
      }
    }

    _updateSnow(deltaTime) {
      if (this.snowParticles.length === 0) {
        for (let i = 0; i < this.particleCount; i++) {
          this.snowParticles.push({
            x: (Math.random() - 0.5) * this.areaSize,
            y: Math.random() * this.areaSize,
            z: (Math.random() - 0.5) * this.areaSize,
            speed: 1 + Math.random() * 2,
            size: 0.02 + Math.random() * 0.03,
            phase: Math.random() * Math.PI * 2
          });
        }
      }
      for (const particle of this.snowParticles) {
        particle.y -= particle.speed * deltaTime * this.intensity;
        particle.phase += deltaTime * 2;
        particle.x += Math.sin(particle.phase) * 0.5 * deltaTime + this.windDirection[0] * this.windSpeed * deltaTime * 2;
        particle.z += Math.cos(particle.phase) * 0.5 * deltaTime + this.windDirection[2] * this.windSpeed * deltaTime * 2;
        if (particle.y < 0) {
          particle.y = this.areaSize;
          particle.x = (Math.random() - 0.5) * this.areaSize;
          particle.z = (Math.random() - 0.5) * this.areaSize;
        }
      }
    }

    getCurrentWeather() { return this.currentWeather; }
    getIntensity() { return this.intensity; }
    getCloudCoverage() { return this.cloudCoverage; }
    getFogDensity() { return this.fogDensity; }
    getWindSpeed() { return this.windSpeed; }
    getWindDirection() { return [...this.windDirection]; }
    getTemperature() { return this.temperature; }
    getHumidity() { return this.humidity; }
    getRainParticles() { return this.rainParticles; }
    getSnowParticles() { return this.snowParticles; }
    setWindDirection(x, y, z) { this.windDirection = [x, y, z]; }
    setTemperature(v) { this.temperature = v; }
    setEnabled(v) { this.enabled = v; }
    getWeatherTypes() { return Object.keys(this.weatherTypes); }
    clear() { this.rainParticles = []; this.snowParticles = []; }
  }

  return {
    TerrainGenerator, AtmosphericScattering, LODSystem, WeatherSystem
  };
})();

if (typeof window !== 'undefined') window.World3DV4 = World3DV4;
if (typeof globalThis !== 'undefined') globalThis.World3DV4 = World3DV4;
