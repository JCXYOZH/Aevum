/**
 * 灵体皮肤系统扩展 - 高级皮肤材质/皮肤物理模拟/妆容系统/皮肤老化/皮肤定制器
 * 纯WebGL2，零第三方依赖
 * @version 2.0.0
 */
'use strict';

const SpiritSkinExt = (function () {

  // ============================================================
  // 高级皮肤材质系统 - PBR+SSS+sheen+clearcoat+iridescence
  // ============================================================
  class AdvancedSkinMaterial {
    constructor() {
      this.baseColor = [0.85, 0.65, 0.55];
      this.metallic = 0;
      this.roughness = 0.5;
      this.subsurfaceColor = [0.9, 0.5, 0.4];
      this.subsurfaceRadius = [0.002, 0.010, 0.030];
      this.subsurfaceIntensity = 0.8;
      this.sheenColor = [0.8, 0.6, 0.5];
      this.sheenIntensity = 0.3;
      this.sheenRoughness = 0.5;
      this.clearcoat = 0.2;
      this.clearcoatRoughness = 0.1;
      this.clearcoatNormalScale = 1;
      this.iridescence = 0;
      this.iridescenceIOR = 1.3;
      this.iridescenceThickness = 400;
      this.occlusionStrength = 1;
      this.emissive = [0, 0, 0];
      this.emissiveIntensity = 0;
      this.normalScale = 1;
      this.aoIntensity = 1;
      this.textures = {
        albedo: null,
        normal: null,
        roughness: null,
        metallic: null,
        ao: null,
        emissive: null,
        subsurface: null,
        thickness: null,
        curvature: null,
        clearcoat: null,
        sheen: null
      };
      this.skinType = 'normal';
      this.oiliness = 0.3;
      this.moisture = 0.5;
      this.poreDetail = 0.5;
      this.wrinkleIntensity = 0.2;
      this.freckleDensity = 0;
      this.beardDensity = 0;
      this.makeupLayers = [];
    }

    setBaseColor(r, g, b) { this.baseColor = [r, g, b]; }
    setMetallic(v) { this.metallic = Math.max(0, Math.min(1, v)); }
    setRoughness(v) { this.roughness = Math.max(0.04, Math.min(1, v)); }
    setSubsurfaceColor(r, g, b) { this.subsurfaceColor = [r, g, b]; }
    setSubsurfaceRadius(r, g, b) { this.subsurfaceRadius = [r, g, b]; }
    setSubsurfaceIntensity(v) { this.subsurfaceIntensity = Math.max(0, Math.min(1, v)); }
    setSheenColor(r, g, b) { this.sheenColor = [r, g, b]; }
    setSheenIntensity(v) { this.sheenIntensity = Math.max(0, Math.min(1, v)); }
    setSheenRoughness(v) { this.sheenRoughness = Math.max(0, Math.min(1, v)); }
    setClearcoat(v) { this.clearcoat = Math.max(0, Math.min(1, v)); }
    setClearcoatRoughness(v) { this.clearcoatRoughness = Math.max(0, Math.min(1, v)); }
    setIridescence(v) { this.iridescence = Math.max(0, Math.min(1, v)); }
    setIridescenceIOR(v) { this.iridescenceIOR = Math.max(1, v); }
    setIridescenceThickness(v) { this.iridescenceThickness = Math.max(100, Math.min(1000, v)); }
    setEmissive(r, g, b, intensity = 1) { this.emissive = [r, g, b]; this.emissiveIntensity = intensity; }
    setNormalScale(v) { this.normalScale = v; }
    setSkinType(type) {
      this.skinType = type;
      const presets = {
        normal: { roughness: 0.5, oiliness: 0.3, moisture: 0.5, poreDetail: 0.5 },
        oily: { roughness: 0.3, oiliness: 0.8, moisture: 0.3, poreDetail: 0.7 },
        dry: { roughness: 0.7, oiliness: 0.1, moisture: 0.8, poreDetail: 0.3 },
        combination: { roughness: 0.45, oiliness: 0.5, moisture: 0.5, poreDetail: 0.5 },
        sensitive: { roughness: 0.55, oiliness: 0.2, moisture: 0.6, poreDetail: 0.4 }
      };
      const preset = presets[type] || presets.normal;
      this.roughness = preset.roughness;
      this.oiliness = preset.oiliness;
      this.moisture = preset.moisture;
      this.poreDetail = preset.poreDetail;
    }
    setOiliness(v) { this.oiliness = Math.max(0, Math.min(1, v)); }
    setMoisture(v) { this.moisture = Math.max(0, Math.min(1, v)); }
    setPoreDetail(v) { this.poreDetail = Math.max(0, Math.min(1, v)); }
    setWrinkleIntensity(v) { this.wrinkleIntensity = Math.max(0, Math.min(1, v)); }
    setFreckleDensity(v) { this.freckleDensity = Math.max(0, Math.min(1, v)); }
    setBeardDensity(v) { this.beardDensity = Math.max(0, Math.min(1, v)); }

    addMakeupLayer(layer) {
      this.makeupLayers.push({
        name: layer.name || 'layer',
        type: layer.type || 'foundation',
        color: layer.color || [1, 1, 1],
        intensity: layer.intensity || 0.5,
        region: layer.region || 'full',
        texture: layer.texture || null,
        blendMode: layer.blendMode || 'normal',
        order: this.makeupLayers.length
      });
      this.makeupLayers.sort((a, b) => a.order - b.order);
    }

    removeMakeupLayer(name) {
      this.makeupLayers = this.makeupLayers.filter(l => l.name !== name);
    }

    getMakeupLayers() { return [...this.makeupLayers]; }

    setTexture(type, texture) {
      if (this.textures.hasOwnProperty(type)) {
        this.textures[type] = texture;
      }
    }

    getUniforms() {
      return {
        baseColor: this.baseColor,
        metallic: this.metallic,
        roughness: this.roughness,
        subsurfaceColor: this.subsurfaceColor,
        subsurfaceRadius: this.subsurfaceRadius,
        subsurfaceIntensity: this.subsurfaceIntensity,
        sheenColor: this.sheenColor,
        sheenIntensity: this.sheenIntensity,
        sheenRoughness: this.sheenRoughness,
        clearcoat: this.clearcoat,
        clearcoatRoughness: this.clearcoatRoughness,
        iridescence: this.iridescence,
        iridescenceIOR: this.iridescenceIOR,
        iridescenceThickness: this.iridescenceThickness,
        emissive: this.emissive,
        emissiveIntensity: this.emissiveIntensity,
        normalScale: this.normalScale,
        oiliness: this.oiliness,
        moisture: this.moisture,
        poreDetail: this.poreDetail,
        wrinkleIntensity: this.wrinkleIntensity,
        freckleDensity: this.freckleDensity,
        beardDensity: this.beardDensity,
        makeupLayerCount: this.makeupLayers.length
      };
    }

    clone() {
      const clone = new AdvancedSkinMaterial();
      Object.assign(clone, JSON.parse(JSON.stringify(this)));
      clone.makeupLayers = this.makeupLayers.map(l => ({ ...l }));
      return clone;
    }

    toJSON() {
      return {
        baseColor: this.baseColor,
        metallic: this.metallic,
        roughness: this.roughness,
        subsurfaceColor: this.subsurfaceColor,
        subsurfaceRadius: this.subsurfaceRadius,
        subsurfaceIntensity: this.subsurfaceIntensity,
        sheenColor: this.sheenColor,
        sheenIntensity: this.sheenIntensity,
        sheenRoughness: this.sheenRoughness,
        clearcoat: this.clearcoat,
        clearcoatRoughness: this.clearcoatRoughness,
        iridescence: this.iridescence,
        iridescenceIOR: this.iridescenceIOR,
        iridescenceThickness: this.iridescenceThickness,
        skinType: this.skinType,
        oiliness: this.oiliness,
        moisture: this.moisture,
        poreDetail: this.poreDetail,
        wrinkleIntensity: this.wrinkleIntensity,
        freckleDensity: this.freckleDensity,
        beardDensity: this.beardDensity,
        makeupLayers: this.makeupLayers
      };
    }

    fromJSON(data) {
      Object.assign(this, data);
      this.makeupLayers = data.makeupLayers || [];
    }

    dispose() { this.makeupLayers = []; }
  }

  // ============================================================
  // 皮肤物理模拟 - 弹性/抖动/碰撞/脂肪
  // ============================================================
  class SkinPhysics {
    constructor() {
      this.regions = new Map();
      this.gravity = [0, -9.8, 0];
      this.globalStiffness = 0.8;
      this.globalDamping = 0.9;
      this.globalElasticity = 0.5;
      this.collisionSpheres = [];
      this.time = 0;
      this.enabled = true;
      this._initDefaultRegions();
    }

    _initDefaultRegions() {
      this.addRegion('face', { stiffness: 0.9, damping: 0.85, elasticity: 0.3, mass: 0.1, bounce: 0.2 });
      this.addRegion('chest', { stiffness: 0.6, damping: 0.8, elasticity: 0.7, mass: 0.5, bounce: 0.5 });
      this.addRegion('belly', { stiffness: 0.5, damping: 0.75, elasticity: 0.8, mass: 0.8, bounce: 0.6 });
      this.addRegion('buttocks', { stiffness: 0.55, damping: 0.78, elasticity: 0.75, mass: 0.6, bounce: 0.55 });
      this.addRegion('thighs', { stiffness: 0.65, damping: 0.82, elasticity: 0.6, mass: 0.4, bounce: 0.4 });
      this.addRegion('upperArms', { stiffness: 0.7, damping: 0.85, elasticity: 0.5, mass: 0.3, bounce: 0.35 });
      this.addRegion('jowls', { stiffness: 0.75, damping: 0.8, elasticity: 0.6, mass: 0.15, bounce: 0.4 });
      this.addRegion('breasts', { stiffness: 0.45, damping: 0.75, elasticity: 0.85, mass: 0.7, bounce: 0.7 });
    }

    addRegion(name, params) {
      this.regions.set(name, {
        name,
        stiffness: params.stiffness ?? this.globalStiffness,
        damping: params.damping ?? this.globalDamping,
        elasticity: params.elasticity ?? this.globalElasticity,
        mass: params.mass ?? 0.5,
        bounce: params.bounce ?? 0.3,
        vertices: [],
        velocities: [],
        restPositions: [],
        displacements: [],
        enabled: true
      });
    }

    addVerticesToRegion(regionName, vertices, restPositions) {
      const region = this.regions.get(regionName);
      if (!region) return;
      region.vertices = vertices.map(v => [...v]);
      region.restPositions = restPositions.map(v => [...v]);
      region.velocities = vertices.map(() => [0, 0, 0]);
      region.displacements = vertices.map(() => [0, 0, 0]);
    }

    addCollisionSphere(center, radius) {
      this.collisionSpheres.push({ center: [...center], radius });
    }

    update(dt, boneTransforms = {}) {
      if (!this.enabled) return;
      this.time += dt;
      for (const [name, region] of this.regions) {
        if (!region.enabled || region.vertices.length === 0) continue;
        for (let i = 0; i < region.vertices.length; i++) {
          const vertex = region.vertices[i];
          const rest = region.restPositions[i];
          const velocity = region.velocities[i];
          const displacement = region.displacements[i];
          const springForce = [
            (rest[0] - vertex[0]) * region.stiffness,
            (rest[1] - vertex[1]) * region.stiffness,
            (rest[2] - vertex[2]) * region.stiffness
          ];
          const dampingForce = [
            -velocity[0] * region.damping,
            -velocity[1] * region.damping,
            -velocity[2] * region.damping
          ];
          const gravityForce = [
            this.gravity[0] * region.mass,
            this.gravity[1] * region.mass,
            this.gravity[2] * region.mass
          ];
          velocity[0] += (springForce[0] + dampingForce[0] + gravityForce[0]) * dt / region.mass;
          velocity[1] += (springForce[1] + dampingForce[1] + gravityForce[1]) * dt / region.mass;
          velocity[2] += (springForce[2] + dampingForce[2] + gravityForce[2]) * dt / region.mass;
          vertex[0] += velocity[0] * dt;
          vertex[1] += velocity[1] * dt;
          vertex[2] += velocity[2] * dt;
          for (const sphere of this.collisionSpheres) {
            const dx = vertex[0] - sphere.center[0];
            const dy = vertex[1] - sphere.center[1];
            const dz = vertex[2] - sphere.center[2];
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            if (dist < sphere.radius) {
              const push = (sphere.radius - dist) / dist;
              vertex[0] += dx * push;
              vertex[1] += dy * push;
              vertex[2] += dz * push;
              velocity[0] *= -region.bounce;
              velocity[1] *= -region.bounce;
              velocity[2] *= -region.bounce;
            }
          }
          displacement[0] = vertex[0] - rest[0];
          displacement[1] = vertex[1] - rest[1];
          displacement[2] = vertex[2] - rest[2];
        }
      }
    }

    applyImpulse(regionName, position, direction, strength) {
      const region = this.regions.get(regionName);
      if (!region) return;
      for (let i = 0; i < region.vertices.length; i++) {
        const vertex = region.vertices[i];
        const dx = vertex[0] - position[0];
        const dy = vertex[1] - position[1];
        const dz = vertex[2] - position[2];
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        const falloff = Math.max(0, 1 - dist / 2);
        region.velocities[i][0] += direction[0] * strength * falloff;
        region.velocities[i][1] += direction[1] * strength * falloff;
        region.velocities[i][2] += direction[2] * strength * falloff;
      }
    }

    getDisplacement(regionName, vertexIndex) {
      const region = this.regions.get(regionName);
      return region?.displacements[vertexIndex] || [0, 0, 0];
    }

    getRegionDisplacements(regionName) {
      const region = this.regions.get(regionName);
      return region ? [...region.displacements] : [];
    }

    setRegionEnabled(name, enabled) {
      const region = this.regions.get(name);
      if (region) region.enabled = enabled;
    }

    setRegionStiffness(name, v) {
      const region = this.regions.get(name);
      if (region) region.stiffness = Math.max(0, Math.min(1, v));
    }

    setRegionDamping(name, v) {
      const region = this.regions.get(name);
      if (region) region.damping = Math.max(0, Math.min(1, v));
    }

    setRegionElasticity(name, v) {
      const region = this.regions.get(name);
      if (region) region.elasticity = Math.max(0, Math.min(1, v));
    }

    setGlobalStiffness(v) {
      this.globalStiffness = Math.max(0, Math.min(1, v));
      for (const region of this.regions.values()) region.stiffness = this.globalStiffness;
    }

    setGlobalDamping(v) {
      this.globalDamping = Math.max(0, Math.min(1, v));
      for (const region of this.regions.values()) region.damping = this.globalDamping;
    }

    setGravity(x, y, z) { this.gravity = [x, y, z]; }

    getRegionNames() { return Array.from(this.regions.keys()); }

    getRegionCount() { return this.regions.size; }

    getTotalVertices() {
      let total = 0;
      for (const region of this.regions.values()) total += region.vertices.length;
      return total;
    }

    reset() {
      for (const region of this.regions.values()) {
        for (let i = 0; i < region.vertices.length; i++) {
          region.vertices[i] = [...region.restPositions[i]];
          region.velocities[i] = [0, 0, 0];
          region.displacements[i] = [0, 0, 0];
        }
      }
    }

    clearCollisionSpheres() { this.collisionSpheres = []; }

    dispose() { this.regions.clear(); this.collisionSpheres = []; }
  }

  // ============================================================
  // 妆容系统 - 多层妆容/粉底/眼影/腮红/口红/眼线
  // ============================================================
  class MakeupSystem {
    constructor() {
      this.layers = [];
      this.maxLayers = 20;
      this.enabled = true;
      this.intensity = 1;
      this.presets = new Map();
      this._initDefaultPresets();
    }

    _initDefaultPresets() {
      this.addPreset('natural', [
        { type: 'foundation', color: [0.9, 0.75, 0.65], intensity: 0.3, region: 'face' },
        { type: 'blush', color: [0.95, 0.6, 0.6], intensity: 0.3, region: 'cheeks' },
        { type: 'lipstick', color: [0.85, 0.4, 0.45], intensity: 0.5, region: 'lips' },
        { type: 'mascara', color: [0.1, 0.1, 0.15], intensity: 0.6, region: 'eyelashes' }
      ]);
      this.addPreset('glamorous', [
        { type: 'foundation', color: [0.92, 0.78, 0.68], intensity: 0.5, region: 'face' },
        { type: 'eyeshadow', color: [0.6, 0.4, 0.7], intensity: 0.7, region: 'eyelids' },
        { type: 'eyeliner', color: [0.05, 0.05, 0.1], intensity: 0.9, region: 'eye_line' },
        { type: 'blush', color: [1, 0.5, 0.55], intensity: 0.5, region: 'cheeks' },
        { type: 'lipstick', color: [0.9, 0.2, 0.35], intensity: 0.8, region: 'lips' },
        { type: 'highlighter', color: [1, 0.95, 0.9], intensity: 0.6, region: 'cheekbones' },
        { type: 'contour', color: [0.5, 0.35, 0.25], intensity: 0.4, region: 'jawline' }
      ]);
      this.addPreset('gothic', [
        { type: 'foundation', color: [0.85, 0.8, 0.85], intensity: 0.7, region: 'face' },
        { type: 'eyeshadow', color: [0.2, 0.1, 0.3], intensity: 0.9, region: 'eyelids' },
        { type: 'eyeliner', color: [0, 0, 0], intensity: 1, region: 'eye_line' },
        { type: 'lipstick', color: [0.5, 0.05, 0.15], intensity: 0.9, region: 'lips' }
      ]);
    }

    addLayer(layer) {
      if (this.layers.length >= this.maxLayers) return false;
      this.layers.push({
        id: this._generateId(),
        name: layer.name || layer.type || 'layer',
        type: layer.type || 'custom',
        color: layer.color || [1, 1, 1],
        intensity: layer.intensity ?? 0.5,
        region: layer.region || 'full',
        texture: layer.texture || null,
        blendMode: layer.blendMode || 'normal',
        order: layer.order ?? this.layers.length,
        enabled: true,
        smoothness: layer.smoothness ?? 0.5,
        feather: layer.feather ?? 0.3
      });
      this.layers.sort((a, b) => a.order - b.order);
      return true;
    }

    removeLayer(id) {
      this.layers = this.layers.filter(l => l.id !== id);
    }

    getLayer(id) {
      return this.layers.find(l => l.id === id);
    }

    updateLayer(id, updates) {
      const layer = this.getLayer(id);
      if (layer) Object.assign(layer, updates);
    }

    setLayerOrder(id, order) {
      const layer = this.getLayer(id);
      if (layer) {
        layer.order = order;
        this.layers.sort((a, b) => a.order - b.order);
      }
    }

    setLayerEnabled(id, enabled) {
      const layer = this.getLayer(id);
      if (layer) layer.enabled = enabled;
    }

    addPreset(name, layers) {
      this.presets.set(name, layers.map((l, i) => ({ ...l, order: i })));
    }

    applyPreset(name) {
      const preset = this.presets.get(name);
      if (!preset) return false;
      this.layers = [];
      for (const layer of preset) this.addLayer(layer);
      return true;
    }

    getPresetNames() { return Array.from(this.presets.keys()); }

    getActiveLayers() {
      return this.layers.filter(l => l.enabled);
    }

    getLayerCount() { return this.layers.length; }

    setIntensity(v) { this.intensity = Math.max(0, Math.min(1, v)); }
    setEnabled(v) { this.enabled = v; }

    getCombinedColor(region, uv) {
      if (!this.enabled || this.layers.length === 0) return [1, 1, 1, 0];
      let result = [1, 1, 1, 0];
      for (const layer of this.getActiveLayers()) {
        if (layer.region !== region && layer.region !== 'full') continue;
        const layerAlpha = layer.intensity * this.intensity;
        if (layerAlpha <= 0) continue;
        switch (layer.blendMode) {
          case 'multiply':
            result[0] *= layer.color[0];
            result[1] *= layer.color[1];
            result[2] *= layer.color[2];
            break;
          case 'screen':
            result[0] = 1 - (1 - result[0]) * (1 - layer.color[0]);
            result[1] = 1 - (1 - result[1]) * (1 - layer.color[1]);
            result[2] = 1 - (1 - result[2]) * (1 - layer.color[2]);
            break;
          case 'overlay':
            result[0] = result[0] < 0.5 ? 2 * result[0] * layer.color[0] : 1 - 2 * (1 - result[0]) * (1 - layer.color[0]);
            result[1] = result[1] < 0.5 ? 2 * result[1] * layer.color[1] : 1 - 2 * (1 - result[1]) * (1 - layer.color[1]);
            result[2] = result[2] < 0.5 ? 2 * result[2] * layer.color[2] : 1 - 2 * (1 - result[2]) * (1 - layer.color[2]);
            break;
          default:
            result[0] = result[0] * (1 - layerAlpha) + layer.color[0] * layerAlpha;
            result[1] = result[1] * (1 - layerAlpha) + layer.color[1] * layerAlpha;
            result[2] = result[2] * (1 - layerAlpha) + layer.color[2] * layerAlpha;
        }
        result[3] = Math.min(1, result[3] + layerAlpha);
      }
      return result;
    }

    clear() { this.layers = []; }

    toJSON() {
      return {
        layers: this.layers,
        intensity: this.intensity,
        enabled: this.enabled
      };
    }

    fromJSON(data) {
      this.layers = data.layers || [];
      this.intensity = data.intensity ?? 1;
      this.enabled = data.enabled ?? true;
    }

    _generateId() {
      return 'makeup_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    dispose() { this.clear(); this.presets.clear(); }
  }

  // ============================================================
  // 皮肤老化系统 - 皱纹/松弛/色斑/纹理变化
  // ============================================================
  class SkinAgingSystem {
    constructor() {
      this.age = 25;
      this.ageFactor = 0;
      this.wrinkleIntensity = 0;
      this.saggingIntensity = 0;
      this.spotDensity = 0;
      this.poreEnlargement = 0;
      this.dullness = 0;
      this.dryness = 0;
      this.elasticityLoss = 0;
      this.wrinklePatterns = new Map();
      this.ageSpots = [];
      this._initWrinklePatterns();
    }

    _initWrinklePatterns() {
      this.wrinklePatterns.set('forehead', { intensity: 1, frequency: 8, orientation: 'horizontal', region: 'forehead' });
      this.wrinklePatterns.set('crow_feet', { intensity: 1.2, frequency: 6, orientation: 'radial', region: 'eye_corners' });
      this.wrinklePatterns.set('nasolabial', { intensity: 1.5, frequency: 3, orientation: 'vertical', region: 'nose_to_mouth' });
      this.wrinklePatterns.set('marionette', { intensity: 1.3, frequency: 4, orientation: 'vertical', region: 'mouth_corners' });
      this.wrinklePatterns.set('neck', { intensity: 0.8, frequency: 5, orientation: 'horizontal', region: 'neck' });
      this.wrinklePatterns.set('under_eye', { intensity: 1.1, frequency: 4, orientation: 'curved', region: 'under_eyes' });
      this.wrinklePatterns.set('brow', { intensity: 0.9, frequency: 3, orientation: 'vertical', region: 'between_brows' });
      this.wrinklePatterns.set('lip', { intensity: 0.7, frequency: 6, orientation: 'vertical', region: 'around_lips' });
    }

    setAge(age) {
      this.age = Math.max(0, age);
      this.ageFactor = Math.max(0, (this.age - 25) / 50);
      this.wrinkleIntensity = this.ageFactor * 0.8;
      this.saggingIntensity = this.ageFactor * 0.6;
      this.spotDensity = this.ageFactor * 0.5;
      this.poreEnlargement = this.ageFactor * 0.4;
      this.dullness = this.ageFactor * 0.5;
      this.dryness = this.ageFactor * 0.6;
      this.elasticityLoss = this.ageFactor * 0.7;
      this._generateAgeSpots();
    }

    _generateAgeSpots() {
      this.ageSpots = [];
      const count = Math.floor(this.spotDensity * 50);
      for (let i = 0; i < count; i++) {
        this.ageSpots.push({
          position: [Math.random(), Math.random()],
          size: 0.01 + Math.random() * 0.04,
          color: [0.4 + Math.random() * 0.2, 0.3 + Math.random() * 0.15, 0.2 + Math.random() * 0.1],
          intensity: 0.3 + Math.random() * 0.4,
          irregularity: Math.random()
        });
      }
    }

    setWrinkleIntensity(v) { this.wrinkleIntensity = Math.max(0, Math.min(1, v)); }
    setSaggingIntensity(v) { this.saggingIntensity = Math.max(0, Math.min(1, v)); }
    setSpotDensity(v) { this.spotDensity = Math.max(0, Math.min(1, v)); this._generateAgeSpots(); }
    setPoreEnlargement(v) { this.poreEnlargement = Math.max(0, Math.min(1, v)); }
    setDullness(v) { this.dullness = Math.max(0, Math.min(1, v)); }
    setDryness(v) { this.dryness = Math.max(0, Math.min(1, v)); }
    setElasticityLoss(v) { this.elasticityLoss = Math.max(0, Math.min(1, v)); }

    getWrinkleDisplacement(uv, normal) {
      if (this.wrinkleIntensity <= 0) return [0, 0, 0];
      let displacement = 0;
      for (const [name, pattern] of this.wrinklePatterns) {
        const regionFactor = this._getRegionFactor(pattern.region, uv);
        if (regionFactor <= 0) continue;
        const frequency = pattern.frequency;
        let wave = 0;
        switch (pattern.orientation) {
          case 'horizontal':
            wave = Math.sin(uv[1] * frequency * Math.PI * 2) * 0.5 + 0.5;
            break;
          case 'vertical':
            wave = Math.sin(uv[0] * frequency * Math.PI * 2) * 0.5 + 0.5;
            break;
          case 'radial':
            const center = [0.5, 0.5];
            const dist = Math.sqrt((uv[0]-center[0])**2 + (uv[1]-center[1])**2);
            wave = Math.sin(dist * frequency * Math.PI * 2) * 0.5 + 0.5;
            break;
          case 'curved':
            wave = Math.sin((uv[0] * 0.5 + uv[1]) * frequency * Math.PI * 2) * 0.5 + 0.5;
            break;
        }
        displacement += wave * pattern.intensity * regionFactor * this.wrinkleIntensity * 0.01;
      }
      return [normal[0] * displacement, normal[1] * displacement, normal[2] * displacement];
    }

    _getRegionFactor(region, uv) {
      const regions = {
        forehead: uv[1] > 0.65 ? 1 : 0,
        eye_corners: (uv[0] < 0.3 || uv[0] > 0.7) && uv[1] > 0.45 && uv[1] < 0.6 ? 1 : 0,
        nose_to_mouth: uv[1] > 0.3 && uv[1] < 0.45 && Math.abs(uv[0] - 0.5) < 0.2 ? 1 : 0,
        mouth_corners: uv[1] > 0.25 && uv[1] < 0.35 && (uv[0] < 0.35 || uv[0] > 0.65) ? 1 : 0,
        neck: uv[1] < 0.15 ? 1 : 0,
        under_eyes: uv[1] > 0.4 && uv[1] < 0.5 && Math.abs(uv[0] - 0.5) < 0.35 ? 1 : 0,
        between_brows: uv[1] > 0.55 && uv[1] < 0.65 && Math.abs(uv[0] - 0.5) < 0.1 ? 1 : 0,
        around_lips: uv[1] > 0.2 && uv[1] < 0.35 && Math.abs(uv[0] - 0.5) < 0.25 ? 1 : 0
      };
      return regions[region] || 0;
    }

    getSaggingDisplacement(uv, position) {
      if (this.saggingIntensity <= 0) return [0, 0, 0];
      const sagRegions = {
        jowls: { factor: uv[1] > 0.2 && uv[1] < 0.4 && (uv[0] < 0.3 || uv[0] > 0.7) ? 1 : 0, direction: [0, -1, 0.3] },
        eyelids: { factor: uv[1] > 0.5 && uv[1] < 0.6 ? 0.8 : 0, direction: [0, -0.5, 0.2] },
        neck: { factor: uv[1] < 0.15 ? 1 : 0, direction: [0, -1, 0.5] },
        cheeks: { factor: uv[1] > 0.35 && uv[1] < 0.55 ? 0.6 : 0, direction: [0, -0.8, 0.3] }
      };
      let displacement = [0, 0, 0];
      for (const region of Object.values(sagRegions)) {
        if (region.factor <= 0) continue;
        displacement[0] += region.direction[0] * region.factor * this.saggingIntensity * 0.02;
        displacement[1] += region.direction[1] * region.factor * this.saggingIntensity * 0.02;
        displacement[2] += region.direction[2] * region.factor * this.saggingIntensity * 0.02;
      }
      return displacement;
    }

    getAgeSpotColor(uv) {
      if (this.spotDensity <= 0 || this.ageSpots.length === 0) return [1, 1, 1, 0];
      let result = [1, 1, 1, 0];
      for (const spot of this.ageSpots) {
        const dx = uv[0] - spot.position[0];
        const dy = uv[1] - spot.position[1];
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < spot.size) {
          const falloff = 1 - dist / spot.size;
          const irregular = 0.7 + 0.3 * Math.sin(uv[0] * 50 + uv[1] * 30) * spot.irregularity;
          const alpha = falloff * irregular * spot.intensity * this.spotDensity;
          result[0] = result[0] * (1 - alpha) + spot.color[0] * alpha;
          result[1] = result[1] * (1 - alpha) + spot.color[1] * alpha;
          result[2] = result[2] * (1 - alpha) + spot.color[2] * alpha;
          result[3] = Math.min(1, result[3] + alpha);
        }
      }
      return result;
    }

    getSkinToneModifier() {
      return {
        dullness: this.dullness,
        dryness: this.dryness,
        poreEnlargement: this.poreEnlargement,
        elasticityLoss: this.elasticityLoss,
        brightness: 1 - this.dullness * 0.3,
        saturation: 1 - this.dullness * 0.2
      };
    }

    getAge() { return this.age; }
    getAgeFactor() { return this.ageFactor; }
    getWrinklePatternNames() { return Array.from(this.wrinklePatterns.keys()); }
    getAgeSpotCount() { return this.ageSpots.length; }

    reset() {
      this.age = 25;
      this.ageFactor = 0;
      this.wrinkleIntensity = 0;
      this.saggingIntensity = 0;
      this.spotDensity = 0;
      this.poreEnlargement = 0;
      this.dullness = 0;
      this.dryness = 0;
      this.elasticityLoss = 0;
      this.ageSpots = [];
    }

    toJSON() {
      return {
        age: this.age,
        wrinkleIntensity: this.wrinkleIntensity,
        saggingIntensity: this.saggingIntensity,
        spotDensity: this.spotDensity,
        poreEnlargement: this.poreEnlargement,
        dullness: this.dullness,
        dryness: this.dryness,
        elasticityLoss: this.elasticityLoss,
        ageSpots: this.ageSpots
      };
    }

    fromJSON(data) {
      this.age = data.age || 25;
      this.wrinkleIntensity = data.wrinkleIntensity || 0;
      this.saggingIntensity = data.saggingIntensity || 0;
      this.spotDensity = data.spotDensity || 0;
      this.poreEnlargement = data.poreEnlargement || 0;
      this.dullness = data.dullness || 0;
      this.dryness = data.dryness || 0;
      this.elasticityLoss = data.elasticityLoss || 0;
      this.ageSpots = data.ageSpots || [];
      this.setAge(this.age);
    }

    dispose() { this.reset(); this.wrinklePatterns.clear(); }
  }

  return {
    AdvancedSkinMaterial, SkinPhysics, MakeupSystem, SkinAgingSystem
  };
})();

if (typeof window !== 'undefined') window.SpiritSkinExt = SpiritSkinExt;
if (typeof globalThis !== 'undefined') globalThis.SpiritSkinExt = SpiritSkinExt;
