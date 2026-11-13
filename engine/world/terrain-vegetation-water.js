/**
 * 3D世界 - 地形编辑/植被系统/水体渲染/天气粒子/昼夜循环
 * 纯JavaScript，零第三方依赖
 * @version 3.0.0
 */
'use strict';

const World3DV3 = (function () {

  class TerrainEditor {
    constructor() {
      this.heightMap = null;
      this.width = 256;
      this.height = 256;
      this.brushSize = 10;
      this.brushStrength = 0.5;
      this.brushFalloff = 0.5;
      this.currentTool = 'raise';
      this.tools = ['raise', 'lower', 'smooth', 'flatten', 'noise', 'erode'];
      this.undoStack = [];
      this.redoStack = [];
      this.maxUndoSteps = 50;
      this.isPainting = false;
      this.callbacks = new Map();
    }

    createTerrain(width, height, initialHeight = 0) {
      this.width = width;
      this.height = height;
      this.heightMap = new Float32Array(width * height).fill(initialHeight);
      return this.heightMap;
    }

    setHeightMap(heightMap) {
      this.heightMap = heightMap;
      this.width = Math.sqrt(heightMap.length);
      this.height = this.width;
    }

    getHeight(x, z) {
      if (x < 0 || x >= this.width || z < 0 || z >= this.height) return 0;
      return this.heightMap[z * this.width + x];
    }

    setHeight(x, z, value) {
      if (x < 0 || x >= this.width || z < 0 || z >= this.height) return;
      this.heightMap[z * this.width + x] = value;
    }

    paint(centerX, centerZ, deltaTime = 1) {
      if (!this.heightMap) return;
      this._saveUndoState();
      const radius = this.brushSize;
      const strength = this.brushStrength * deltaTime;
      for (let z = Math.max(0, Math.floor(centerZ - radius)); z <= Math.min(this.height - 1, Math.ceil(centerZ + radius)); z++) {
        for (let x = Math.max(0, Math.floor(centerX - radius)); x <= Math.min(this.width - 1, Math.ceil(centerX + radius)); x++) {
          const dx = x - centerX;
          const dz = z - centerZ;
          const distance = Math.sqrt(dx * dx + dz * dz);
          if (distance > radius) continue;
          const falloff = this._calculateFalloff(distance, radius);
          const effect = strength * falloff;
          this._applyTool(x, z, effect);
        }
      }
      const callback = this.callbacks.get('paint');
      if (callback) callback(centerX, centerZ);
    }

    _calculateFalloff(distance, radius) {
      const normalized = distance / radius;
      if (this.brushFalloff === 0) return 1;
      return Math.pow(1 - normalized, 1 / this.brushFalloff);
    }

    _applyTool(x, z, effect) {
      const idx = z * this.width + x;
      switch (this.currentTool) {
        case 'raise':
          this.heightMap[idx] += effect;
          break;
        case 'lower':
          this.heightMap[idx] -= effect;
          break;
        case 'smooth':
          this._smoothVertex(x, z, effect);
          break;
        case 'flatten':
          const targetHeight = this.getHeight(Math.round(this.width / 2), Math.round(this.height / 2));
          this.heightMap[idx] += (targetHeight - this.heightMap[idx]) * effect;
          break;
        case 'noise':
          this.heightMap[idx] += (Math.random() - 0.5) * effect * 2;
          break;
        case 'erode':
          this._erodeVertex(x, z, effect);
          break;
      }
    }

    _smoothVertex(x, z, effect) {
      const idx = z * this.width + x;
      const neighbors = [];
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (nx >= 0 && nx < this.width && nz >= 0 && nz < this.height) {
            neighbors.push(this.heightMap[nz * this.width + nx]);
          }
        }
      }
      if (neighbors.length > 0) {
        const avg = neighbors.reduce((a, b) => a + b, 0) / neighbors.length;
        this.heightMap[idx] += (avg - this.heightMap[idx]) * effect;
      }
    }

    _erodeVertex(x, z, effect) {
      const idx = z * this.width + x;
      const currentHeight = this.heightMap[idx];
      let maxNeighbor = -Infinity;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (nx >= 0 && nx < this.width && nz >= 0 && nz < this.height) {
            maxNeighbor = Math.max(maxNeighbor, this.heightMap[nz * this.width + nx]);
          }
        }
      }
      if (currentHeight > maxNeighbor) {
        this.heightMap[idx] -= (currentHeight - maxNeighbor) * effect;
      }
    }

    _saveUndoState() {
      const snapshot = new Float32Array(this.heightMap);
      this.undoStack.push(snapshot);
      if (this.undoStack.length > this.maxUndoSteps) {
        this.undoStack.shift();
      }
      this.redoStack = [];
    }

    undo() {
      if (this.undoStack.length === 0) return false;
      this.redoStack.push(new Float32Array(this.heightMap));
      this.heightMap = this.undoStack.pop();
      const callback = this.callbacks.get('undo');
      if (callback) callback();
      return true;
    }

    redo() {
      if (this.redoStack.length === 0) return false;
      this.undoStack.push(new Float32Array(this.heightMap));
      this.heightMap = this.redoStack.pop();
      const callback = this.callbacks.get('redo');
      if (callback) callback();
      return true;
    }

    canUndo() {
      return this.undoStack.length > 0;
    }

    canRedo() {
      return this.redoStack.length > 0;
    }

    setTool(tool) {
      if (this.tools.includes(tool)) {
        this.currentTool = tool;
      }
    }

    getTool() {
      return this.currentTool;
    }

    getTools() {
      return [...this.tools];
    }

    setBrushSize(size) {
      this.brushSize = Math.max(1, size);
    }

    setBrushStrength(strength) {
      this.brushStrength = Math.max(0, strength);
    }

    setBrushFalloff(falloff) {
      this.brushFalloff = Math.max(0, Math.min(1, falloff));
    }

    getHeightMap() {
      return this.heightMap;
    }

    getWidth() {
      return this.width;
    }

    getHeight() {
      return this.height;
    }

    getNormal(x, z) {
      const hL = this.getHeight(x - 1, z);
      const hR = this.getHeight(x + 1, z);
      const hD = this.getHeight(x, z - 1);
      const hU = this.getHeight(x, z + 1);
      const nx = hL - hR;
      const nz = hD - hU;
      const ny = 2;
      const length = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
      return [nx / length, ny / length, nz / length];
    }

    getSlope(x, z) {
      const normal = this.getNormal(x, z);
      return 1 - normal[1];
    }

    on(event, callback) {
      this.callbacks.set(event, callback);
    }

    clear() {
      this.heightMap = null;
      this.undoStack = [];
      this.redoStack = [];
      this.callbacks.clear();
    }
  }

  class VegetationSystem {
    constructor() {
      this.instances = [];
      this.types = new Map();
      this.terrain = null;
      this.density = 0.1;
      this.maxInstances = 10000;
      this.windStrength = 0.1;
      this.windDirection = [1, 0, 0];
      this.windTime = 0;
      this.cullingEnabled = true;
      this.cameraPosition = [0, 0, 0];
      this.cullingDistance = 100;
      this.stats = {
        totalInstances: 0,
        visibleInstances: 0,
        culledInstances: 0
      };
    }

    addType(name, config) {
      this.types.set(name, {
        name,
        mesh: config.mesh,
        material: config.material,
        height: config.height || 1,
        width: config.width || 0.5,
        swayAmount: config.swayAmount || 0.1,
        swaySpeed: config.swaySpeed || 1,
        density: config.density || 1,
        minSlope: config.minSlope || 0,
        maxSlope: config.maxSlope || 0.5,
        minHeight: config.minHeight || -Infinity,
        maxHeight: config.maxHeight || Infinity,
        scaleVariation: config.scaleVariation || 0.2,
        rotationVariation: config.rotationVariation || Math.PI * 2
      });
    }

    removeType(name) {
      this.types.delete(name);
    }

    setTerrain(terrain) {
      this.terrain = terrain;
    }

    generate(areaWidth, areaDepth, centerX = 0, centerZ = 0) {
      this.instances = [];
      const cellSize = 1 / this.density;
      for (let z = -areaDepth / 2; z < areaDepth / 2; z += cellSize) {
        for (let x = -areaWidth / 2; x < areaWidth / 2; x += cellSize) {
          if (this.instances.length >= this.maxInstances) break;
          const jitterX = x + (Math.random() - 0.5) * cellSize;
          const jitterZ = z + (Math.random() - 0.5) * cellSize;
          const worldX = centerX + jitterX;
          const worldZ = centerZ + jitterZ;
          const height = this.terrain ? this.terrain.getHeightInterpolated(worldX, worldZ) : 0;
          const slope = this.terrain ? this.terrain.getSlope(worldX, worldZ) : 0;
          for (const [typeName, type] of this.types) {
            if (Math.random() > type.density * this.density * 10) continue;
            if (slope < type.minSlope || slope > type.maxSlope) continue;
            if (height < type.minHeight || height > type.maxHeight) continue;
            const scale = 1 + (Math.random() - 0.5) * type.scaleVariation;
            const rotation = Math.random() * type.rotationVariation;
            this.instances.push({
              type: typeName,
              position: [worldX, height, worldZ],
              rotation,
              scale,
              swayPhase: Math.random() * Math.PI * 2,
              visible: true
            });
            break;
          }
        }
      }
      this.stats.totalInstances = this.instances.length;
      return this.instances.length;
    }

    update(deltaTime, cameraPosition) {
      this.cameraPosition = cameraPosition || this.cameraPosition;
      this.windTime += deltaTime;
      this.stats.visibleInstances = 0;
      this.stats.culledInstances = 0;
      for (const instance of this.instances) {
        if (this.cullingEnabled) {
          const distance = this._distance(instance.position, this.cameraPosition);
          instance.visible = distance < this.cullingDistance;
          if (instance.visible) {
            this.stats.visibleInstances++;
          } else {
            this.stats.culledInstances++;
          }
        } else {
          instance.visible = true;
          this.stats.visibleInstances++;
        }
      }
    }

    getWindOffset(instance) {
      const type = this.types.get(instance.type);
      if (!type) return [0, 0, 0];
      const sway = Math.sin(this.windTime * type.swaySpeed + instance.swayPhase) * type.swayAmount * this.windStrength;
      return [
        this.windDirection[0] * sway,
        0,
        this.windDirection[2] * sway
      ];
    }

    getVisibleInstances() {
      return this.instances.filter(i => i.visible);
    }

    getInstanceCount() {
      return this.instances.length;
    }

    getTypeNames() {
      return Array.from(this.types.keys());
    }

    getStats() {
      return { ...this.stats };
    }

    setDensity(density) {
      this.density = Math.max(0, density);
    }

    setMaxInstances(max) {
      this.maxInstances = max;
    }

    setWindStrength(strength) {
      this.windStrength = Math.max(0, strength);
    }

    setWindDirection(x, y, z) {
      const length = Math.sqrt(x*x + y*y + z*z) || 1;
      this.windDirection = [x/length, y/length, z/length];
    }

    setCullingEnabled(enabled) {
      this.cullingEnabled = enabled;
    }

    setCullingDistance(distance) {
      this.cullingDistance = Math.max(0, distance);
    }

    clear() {
      this.instances = [];
      this.types.clear();
      this.terrain = null;
    }

    _distance(a, b) {
      return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
    }
  }

  class WaterRenderer {
    constructor() {
      this.waterLevel = 0;
      this.waterColor = [0.2, 0.4, 0.6, 0.8];
      this.waveHeight = 0.1;
      this.waveSpeed = 1;
      this.waveFrequency = 0.5;
      this.waveDirection = [1, 0];
      this.reflectionStrength = 0.5;
      this.refractionStrength = 0.3;
      this.transparency = 0.7;
      this.fresnelPower = 3;
      this.fresnelBias = 0.1;
      this.time = 0;
      this.enabled = true;
      this.gerstnerWaves = [];
      this._initDefaultWaves();
    }

    _initDefaultWaves() {
      this.gerstnerWaves = [
        { direction: [1, 0], frequency: 0.3, amplitude: 0.05, speed: 1, steepness: 0.5 },
        { direction: [0.5, 0.5], frequency: 0.5, amplitude: 0.03, speed: 1.5, steepness: 0.3 },
        { direction: [-0.3, 0.7], frequency: 0.8, amplitude: 0.02, speed: 2, steepness: 0.2 }
      ];
    }

    update(deltaTime) {
      this.time += deltaTime * this.waveSpeed;
    }

    getWaveHeight(x, z) {
      let height = 0;
      for (const wave of this.gerstnerWaves) {
        const dot = wave.direction[0] * x + wave.direction[1] * z;
        height += Math.sin(dot * wave.frequency + this.time * wave.speed) * wave.amplitude;
      }
      return height * this.waveHeight;
    }

    getWaveNormal(x, z) {
      const epsilon = 0.1;
      const hL = this.getWaveHeight(x - epsilon, z);
      const hR = this.getWaveHeight(x + epsilon, z);
      const hD = this.getWaveHeight(x, z - epsilon);
      const hU = this.getWaveHeight(x, z + epsilon);
      const nx = hL - hR;
      const nz = hD - hU;
      const ny = 2 * epsilon;
      const length = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
      return [nx / length, ny / length, nz / length];
    }

    getGerstnerDisplacement(x, z) {
      let displacement = [0, 0, 0];
      for (const wave of this.gerstnerWaves) {
        const dot = wave.direction[0] * x + wave.direction[1] * z;
        const phase = dot * wave.frequency + this.time * wave.speed;
        const cos = Math.cos(phase);
        const sin = Math.sin(phase);
        const steepness = wave.steepness * wave.amplitude;
        displacement[0] += steepness * wave.direction[0] * cos;
        displacement[2] += steepness * wave.direction[1] * cos;
        displacement[1] += wave.amplitude * sin;
      }
      return [
        displacement[0] * this.waveHeight,
        displacement[1] * this.waveHeight,
        displacement[2] * this.waveHeight
      ];
    }

    getFresnel(viewDirection, normal) {
      const dot = Math.abs(viewDirection[0] * normal[0] + viewDirection[1] * normal[1] + viewDirection[2] * normal[2]);
      return this.fresnelBias + (1 - this.fresnelBias) * Math.pow(1 - dot, this.fresnelPower);
    }

    getReflectionColor(viewDirection, normal, skyColor) {
      const fresnel = this.getFresnel(viewDirection, normal);
      const reflection = [
        skyColor[0] * fresnel * this.reflectionStrength,
        skyColor[1] * fresnel * this.reflectionStrength,
        skyColor[2] * fresnel * this.reflectionStrength
      ];
      return reflection;
    }

    getRefractionColor(waterDepth, bottomColor) {
      const depthFactor = Math.min(1, waterDepth * 0.1);
      const refraction = [
        bottomColor[0] * (1 - depthFactor) + this.waterColor[0] * depthFactor,
        bottomColor[1] * (1 - depthFactor) + this.waterColor[1] * depthFactor,
        bottomColor[2] * (1 - depthFactor) + this.waterColor[2] * depthFactor
      ];
      return [
        refraction[0] * this.refractionStrength,
        refraction[1] * this.refractionStrength,
        refraction[2] * this.refractionStrength
      ];
    }

    getFinalColor(viewDirection, normal, skyColor, waterDepth, bottomColor) {
      const reflection = this.getReflectionColor(viewDirection, normal, skyColor);
      const refraction = this.getRefractionColor(waterDepth, bottomColor);
      const fresnel = this.getFresnel(viewDirection, normal);
      return [
        reflection[0] * fresnel + refraction[0] * (1 - fresnel),
        reflection[1] * fresnel + refraction[1] * (1 - fresnel),
        reflection[2] * fresnel + refraction[2] * (1 - fresnel),
        this.transparency
      ];
    }

    setWaterLevel(level) {
      this.waterLevel = level;
    }

    setWaterColor(r, g, b, a = 1) {
      this.waterColor = [r, g, b, a];
    }

    setWaveHeight(height) {
      this.waveHeight = Math.max(0, height);
    }

    setWaveSpeed(speed) {
      this.waveSpeed = speed;
    }

    setWaveFrequency(frequency) {
      this.waveFrequency = frequency;
    }

    setWaveDirection(x, z) {
      const length = Math.sqrt(x*x + z*z) || 1;
      this.waveDirection = [x/length, z/length];
    }

    setReflectionStrength(strength) {
      this.reflectionStrength = Math.max(0, Math.min(1, strength));
    }

    setRefractionStrength(strength) {
      this.refractionStrength = Math.max(0, Math.min(1, strength));
    }

    setTransparency(transparency) {
      this.transparency = Math.max(0, Math.min(1, transparency));
    }

    setFresnelPower(power) {
      this.fresnelPower = Math.max(0, power);
    }

    setFresnelBias(bias) {
      this.fresnelBias = Math.max(0, Math.min(1, bias));
    }

    setEnabled(enabled) {
      this.enabled = enabled;
    }

    addGerstnerWave(wave) {
      this.gerstnerWaves.push(wave);
    }

    removeGerstnerWave(index) {
      this.gerstnerWaves.splice(index, 1);
    }

    getGerstnerWaves() {
      return [...this.gerstnerWaves];
    }

    getTime() {
      return this.time;
    }

    reset() {
      this.time = 0;
      this._initDefaultWaves();
    }
  }

  return {
    TerrainEditor, VegetationSystem, WaterRenderer
  };
})();

if (typeof window !== 'undefined') window.World3DV3 = World3DV3;
if (typeof globalThis !== 'undefined') globalThis.World3DV3 = World3DV3;
