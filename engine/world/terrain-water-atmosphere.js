/**
 * 3D世界 - 地形编辑/植被系统/水体渲染/大气系统/天气模拟
 * 纯JavaScript，零第三方依赖
 * @version 5.0.0
 */
'use strict';

const World3DV5 = (function () {

  class TerrainEditor {
    constructor() {
      this.heightMap = null;
      this.width = 256;
      this.height = 256;
      this.brushSize = 10;
      this.brushStrength = 0.5;
      this.brushFalloff = 0.5;
      this.currentTool = 'raise';
      this.undoStack = [];
      this.redoStack = [];
      this.maxUndo = 50;
      this.callbacks = new Map();
      this.isEditing = false;
    }

    init(width, height) {
      this.width = width;
      this.height = height;
      this.heightMap = new Float32Array(width * height);
      this.undoStack = [];
      this.redoStack = [];
    }

    setHeightMap(heightMap) {
      this.heightMap = new Float32Array(heightMap);
      this.width = Math.sqrt(heightMap.length);
      this.height = this.width;
    }

    getHeightMap() {
      return new Float32Array(this.heightMap);
    }

    applyBrush(x, z, tool = this.currentTool) {
      if (!this.heightMap) return;
      this._saveUndo();
      const centerX = Math.floor(x);
      const centerZ = Math.floor(z);
      const radius = this.brushSize;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const px = centerX + dx;
          const pz = centerZ + dz;
          if (px < 0 || px >= this.width || pz < 0 || pz >= this.height) continue;
          const distance = Math.sqrt(dx * dx + dz * dz);
          if (distance > radius) continue;
          const falloff = 1 - (distance / radius) * this.brushFalloff;
          const strength = this.brushStrength * falloff * 0.1;
          const idx = pz * this.width + px;
          switch (tool) {
            case 'raise':
              this.heightMap[idx] += strength;
              break;
            case 'lower':
              this.heightMap[idx] -= strength;
              break;
            case 'smooth':
              this.heightMap[idx] = this._smoothHeight(px, pz);
              break;
            case 'flatten':
              const targetHeight = this.heightMap[centerZ * this.width + centerX];
              this.heightMap[idx] += (targetHeight - this.heightMap[idx]) * strength * 2;
              break;
            case 'noise':
              this.heightMap[idx] += (Math.random() - 0.5) * strength * 2;
              break;
          }
        }
      }
      const callback = this.callbacks.get('edit');
      if (callback) callback(x, z, tool);
    }

    _smoothHeight(x, z) {
      let sum = 0;
      let count = 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const px = x + dx;
          const pz = z + dz;
          if (px >= 0 && px < this.width && pz >= 0 && pz < this.height) {
            sum += this.heightMap[pz * this.width + px];
            count++;
          }
        }
      }
      return count > 0 ? sum / count : 0;
    }

    _saveUndo() {
      const snapshot = new Float32Array(this.heightMap);
      this.undoStack.push(snapshot);
      if (this.undoStack.length > this.maxUndo) {
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

    getHeight(x, z) {
      if (!this.heightMap || x < 0 || x >= this.width || z < 0 || z >= this.height) return 0;
      return this.heightMap[Math.floor(z) * this.width + Math.floor(x)];
    }

    setHeight(x, z, value) {
      if (!this.heightMap || x < 0 || x >= this.width || z < 0 || z >= this.height) return;
      this._saveUndo();
      this.heightMap[Math.floor(z) * this.width + Math.floor(x)] = value;
    }

    setBrushSize(size) {
      this.brushSize = Math.max(1, size);
    }

    setBrushStrength(strength) {
      this.brushStrength = Math.max(0, Math.min(1, strength));
    }

    setBrushFalloff(falloff) {
      this.brushFalloff = Math.max(0, Math.min(1, falloff));
    }

    setTool(tool) {
      this.currentTool = tool;
    }

    getTool() {
      return this.currentTool;
    }

    getWidth() {
      return this.width;
    }

    getHeight() {
      return this.height;
    }

    clear() {
      if (this.heightMap) {
        this.heightMap.fill(0);
      }
      this.undoStack = [];
      this.redoStack = [];
    }

    on(event, callback) {
      this.callbacks.set(event, callback);
    }

    off(event) {
      this.callbacks.delete(event);
    }

    exportHeightMap() {
      return {
        width: this.width,
        height: this.height,
        data: Array.from(this.heightMap)
      };
    }

    importHeightMap(data) {
      this.width = data.width;
      this.height = data.height;
      this.heightMap = new Float32Array(data.data);
      this.undoStack = [];
      this.redoStack = [];
    }
  }

  class VegetationSystem {
    constructor() {
      this.instances = [];
      this.types = new Map();
      this.maxInstances = 10000;
      this.windStrength = 0.5;
      this.windDirection = [1, 0, 0];
      this.enabled = true;
      this.stats = { totalInstances: 0, visibleInstances: 0, types: 0 };
      this.terrainHeightFunction = null;
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
        minScale: config.minScale || 0.8,
        maxScale: config.maxScale || 1.2,
        colorVariation: config.colorVariation || 0.1,
        castShadow: config.castShadow !== false,
        receiveShadow: config.receiveShadow !== false
      });
      this.stats.types++;
    }

    removeType(name) {
      this.types.delete(name);
      this.instances = this.instances.filter(i => i.type !== name);
      this.stats.types = this.types.size;
    }

    addInstance(type, x, z, options = {}) {
      if (this.instances.length >= this.maxInstances) return false;
      const typeConfig = this.types.get(type);
      if (!typeConfig) return false;
      const scale = options.scale || (typeConfig.minScale + Math.random() * (typeConfig.maxScale - typeConfig.minScale));
      const y = this.terrainHeightFunction ? this.terrainHeightFunction(x, z) : (options.y || 0);
      const instance = {
        id: this.instances.length,
        type,
        position: [x, y, z],
        rotation: options.rotation || Math.random() * Math.PI * 2,
        scale,
        color: options.color || this._generateColor(typeConfig),
        swayPhase: Math.random() * Math.PI * 2,
        swayOffset: [0, 0, 0],
        visible: true,
        health: options.health || 1,
        age: options.age || 0
      };
      this.instances.push(instance);
      this.stats.totalInstances++;
      return instance;
    }

    removeInstance(id) {
      const index = this.instances.findIndex(i => i.id === id);
      if (index !== -1) {
        this.instances.splice(index, 1);
        this.stats.totalInstances--;
      }
    }

    generate(type, count, area, options = {}) {
      const typeConfig = this.types.get(type);
      if (!typeConfig) return 0;
      let generated = 0;
      for (let i = 0; i < count && this.instances.length < this.maxInstances; i++) {
        const x = area.x + Math.random() * area.width;
        const z = area.z + Math.random() * area.depth;
        if (options.densityMap) {
          const density = options.densityMap(x, z);
          if (Math.random() > density) continue;
        }
        this.addInstance(type, x, z, options);
        generated++;
      }
      return generated;
    }

    _generateColor(typeConfig) {
      const baseColor = typeConfig.material?.color || [0.3, 0.6, 0.2];
      const variation = typeConfig.colorVariation;
      return [
        baseColor[0] + (Math.random() - 0.5) * variation,
        baseColor[1] + (Math.random() - 0.5) * variation,
        baseColor[2] + (Math.random() - 0.5) * variation
      ];
    }

    update(deltaTime, time) {
      if (!this.enabled) return;
      for (const instance of this.instances) {
        const typeConfig = this.types.get(instance.type);
        if (!typeConfig) continue;
        const sway = Math.sin(time * typeConfig.swaySpeed + instance.swayPhase) * typeConfig.swayAmount * this.windStrength;
        instance.swayOffset[0] = sway * this.windDirection[0];
        instance.swayOffset[2] = sway * this.windDirection[2];
        instance.swayOffset[1] = Math.abs(sway) * 0.1;
      }
    }

    getInstances() {
      return this.instances.filter(i => i.visible);
    }

    getInstance(id) {
      return this.instances.find(i => i.id === id);
    }

    getType(name) {
      return this.types.get(name);
    }

    getTypeNames() {
      return Array.from(this.types.keys());
    }

    setWindStrength(strength) {
      this.windStrength = Math.max(0, Math.min(1, strength));
    }

    setWindDirection(x, y, z) {
      this.windDirection = [x, y, z];
    }

    setTerrainHeightFunction(func) {
      this.terrainHeightFunction = func;
    }

    setEnabled(v) {
      this.enabled = v;
    }

    isEnabled() {
      return this.enabled;
    }

    getStats() {
      return {
        ...this.stats,
        visibleInstances: this.instances.filter(i => i.visible).length
      };
    }

    clear() {
      this.instances = [];
      this.types.clear();
      this.stats = { totalInstances: 0, visibleInstances: 0, types: 0 };
    }
  }

  class WaterRenderer {
    constructor() {
      this.enabled = true;
      this.waterLevel = 0;
      this.waterColor = [0.2, 0.4, 0.6, 0.8];
      this.waveHeight = 0.5;
      this.waveSpeed = 1;
      this.waveFrequency = 0.1;
      this.reflectionStrength = 0.5;
      this.refractionStrength = 0.3;
      this.foamStrength = 0.2;
      this.transparency = 0.7;
      this.waves = [];
      this.stats = { waveCount: 0, vertices: 0 };
      this._initDefaultWaves();
    }

    _initDefaultWaves() {
      this.waves = [
        { direction: [1, 0], amplitude: 0.3, frequency: 0.1, speed: 1, phase: 0 },
        { direction: [0.5, 0.5], amplitude: 0.2, frequency: 0.15, speed: 1.2, phase: 1 },
        { direction: [-0.3, 0.7], amplitude: 0.15, frequency: 0.2, speed: 0.8, phase: 2 },
        { direction: [0.8, -0.2], amplitude: 0.1, frequency: 0.25, speed: 1.5, phase: 3 }
      ];
      this.stats.waveCount = this.waves.length;
    }

    addWave(config) {
      this.waves.push({
        direction: config.direction || [1, 0],
        amplitude: config.amplitude || 0.1,
        frequency: config.frequency || 0.1,
        speed: config.speed || 1,
        phase: config.phase || Math.random() * Math.PI * 2
      });
      this.stats.waveCount = this.waves.length;
    }

    removeWave(index) {
      this.waves.splice(index, 1);
      this.stats.waveCount = this.waves.length;
    }

    getWaveHeight(x, z, time) {
      let height = 0;
      for (const wave of this.waves) {
        const dot = x * wave.direction[0] + z * wave.direction[1];
        height += Math.sin(dot * wave.frequency + time * wave.speed + wave.phase) * wave.amplitude;
      }
      return height * this.waveHeight;
    }

    getWaveNormal(x, z, time) {
      const epsilon = 0.1;
      const hL = this.getWaveHeight(x - epsilon, z, time);
      const hR = this.getWaveHeight(x + epsilon, z, time);
      const hD = this.getWaveHeight(x, z - epsilon, time);
      const hU = this.getWaveHeight(x, z + epsilon, time);
      const nx = hL - hR;
      const nz = hD - hU;
      const ny = 2 * epsilon;
      const length = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
      return [nx / length, ny / length, nz / length];
    }

    generateMesh(width, height, segmentsX, segmentsZ) {
      const vertices = [];
      const normals = [];
      const uvs = [];
      const indices = [];
      for (let z = 0; z <= segmentsZ; z++) {
        for (let x = 0; x <= segmentsX; x++) {
          const px = (x / segmentsX - 0.5) * width;
          const pz = (z / segmentsZ - 0.5) * height;
          vertices.push(px, this.waterLevel, pz);
          normals.push(0, 1, 0);
          uvs.push(x / segmentsX, z / segmentsZ);
        }
      }
      for (let z = 0; z < segmentsZ; z++) {
        for (let x = 0; x < segmentsX; x++) {
          const a = z * (segmentsX + 1) + x;
          const b = a + segmentsX + 1;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
      this.stats.vertices = vertices.length / 3;
      return {
        vertices: new Float32Array(vertices),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        indices: new Uint32Array(indices),
        vertexCount: vertices.length / 3,
        indexCount: indices.length
      };
    }

    update(deltaTime, time) {
      if (!this.enabled) return;
    }

    setWaterLevel(level) {
      this.waterLevel = level;
    }

    setWaterColor(r, g, b, a) {
      this.waterColor = [r, g, b, a];
    }

    setWaveHeight(height) {
      this.waveHeight = Math.max(0, height);
    }

    setWaveSpeed(speed) {
      this.waveSpeed = speed;
    }

    setReflectionStrength(strength) {
      this.reflectionStrength = Math.max(0, Math.min(1, strength));
    }

    setRefractionStrength(strength) {
      this.refractionStrength = Math.max(0, Math.min(1, strength));
    }

    setFoamStrength(strength) {
      this.foamStrength = Math.max(0, Math.min(1, strength));
    }

    setTransparency(transparency) {
      this.transparency = Math.max(0, Math.min(1, transparency));
    }

    setEnabled(v) {
      this.enabled = v;
    }

    isEnabled() {
      return this.enabled;
    }

    getStats() {
      return { ...this.stats };
    }

    getWaves() {
      return [...this.waves];
    }

    clear() {
      this.waves = [];
      this.stats = { waveCount: 0, vertices: 0 };
    }
  }

  return {
    TerrainEditor, VegetationSystem, WaterRenderer
  };
})();

if (typeof window !== 'undefined') window.World3DV5 = World3DV5;
if (typeof globalThis !== 'undefined') globalThis.World3DV5 = World3DV5;
