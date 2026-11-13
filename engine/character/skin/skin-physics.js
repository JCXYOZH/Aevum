/**
 * 灵体皮肤 - 材质系统/纹理生成/物理模拟/妆容系统/老化系统
 * 纯JavaScript，零第三方依赖
 * @version 4.0.0
 */
'use strict';

const SpiritSkinV4 = (function () {

  class SkinMaterialSystem {
    constructor() {
      this.materials = new Map();
      this.currentMaterial = null;
      this.presets = new Map();
      this.shaderCache = new Map();
      this._initDefaultPresets();
    }

    _initDefaultPresets() {
      const presets = {
        default: {
          baseColor: [0.85, 0.72, 0.62],
          roughness: 0.5,
          metallic: 0,
          subsurface: 0.3,
          subsurfaceColor: [0.9, 0.6, 0.5],
          subsurfaceRadius: [0.01, 0.02, 0.04],
          sheen: 0.2,
          sheenColor: [0.9, 0.8, 0.7],
          sheenRoughness: 0.5,
          clearcoat: 0,
          clearcoatRoughness: 0.1,
          specular: 0.5,
          specularTint: 0,
          anisotropic: 0,
          anisotropicRotation: 0,
          transmission: 0,
          ior: 1.4,
          thickness: 0.5,
          attenuationColor: [1, 0.8, 0.7],
          attenuationDistance: 1
        },
        pale: {
          baseColor: [0.92, 0.82, 0.74],
          roughness: 0.45,
          subsurface: 0.4,
          subsurfaceColor: [0.95, 0.7, 0.6],
          sheen: 0.3
        },
        tan: {
          baseColor: [0.75, 0.58, 0.45],
          roughness: 0.55,
          subsurface: 0.25,
          subsurfaceColor: [0.85, 0.55, 0.45]
        },
        dark: {
          baseColor: [0.5, 0.35, 0.25],
          roughness: 0.6,
          subsurface: 0.2,
          subsurfaceColor: [0.7, 0.45, 0.35]
        },
        asian: {
          baseColor: [0.88, 0.75, 0.65],
          roughness: 0.48,
          subsurface: 0.35,
          subsurfaceColor: [0.92, 0.65, 0.55],
          sheen: 0.25
        }
      };
      for (const [name, config] of Object.entries(presets)) {
        this.presets.set(name, config);
      }
    }

    createMaterial(name, config = {}) {
      const preset = this.presets.get(config.preset || 'default') || this.presets.get('default');
      const material = {
        name,
        ...preset,
        ...config,
        id: this._generateId(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        textures: {},
        uniforms: {},
        shaderVariant: this._computeShaderVariant({ ...preset, ...config })
      };
      this.materials.set(name, material);
      return material;
    }

    _computeShaderVariant(config) {
      let variant = 'skin';
      if (config.subsurface > 0) variant += '_sss';
      if (config.sheen > 0) variant += '_sheen';
      if (config.clearcoat > 0) variant += '_clearcoat';
      if (config.transmission > 0) variant += '_transmission';
      if (config.anisotropic > 0) variant += '_anisotropic';
      return variant;
    }

    updateMaterial(name, updates) {
      const material = this.materials.get(name);
      if (!material) return null;
      Object.assign(material, updates);
      material.updatedAt = Date.now();
      material.shaderVariant = this._computeShaderVariant(material);
      return material;
    }

    getMaterial(name) {
      return this.materials.get(name);
    }

    setCurrentMaterial(name) {
      this.currentMaterial = this.materials.get(name) || null;
    }

    getCurrentMaterial() {
      return this.currentMaterial;
    }

    addTexture(materialName, slot, texture) {
      const material = this.materials.get(materialName);
      if (material) {
        material.textures[slot] = texture;
      }
    }

    removeTexture(materialName, slot) {
      const material = this.materials.get(materialName);
      if (material && material.textures[slot]) {
        delete material.textures[slot];
      }
    }

    addPreset(name, config) {
      this.presets.set(name, { ...config });
    }

    getPreset(name) {
      return this.presets.get(name);
    }

    getPresetNames() {
      return Array.from(this.presets.keys());
    }

    getMaterialNames() {
      return Array.from(this.materials.keys());
    }

    getMaterialCount() {
      return this.materials.size;
    }

    removeMaterial(name) {
      this.materials.delete(name);
      if (this.currentMaterial?.name === name) {
        this.currentMaterial = null;
      }
    }

    cloneMaterial(sourceName, newName) {
      const source = this.materials.get(sourceName);
      if (!source) return null;
      const clone = JSON.parse(JSON.stringify(source));
      clone.name = newName;
      clone.id = this._generateId();
      clone.createdAt = Date.now();
      clone.updatedAt = Date.now();
      this.materials.set(newName, clone);
      return clone;
    }

    exportMaterial(name) {
      const material = this.materials.get(name);
      return material ? JSON.stringify(material, null, 2) : null;
    }

    importMaterial(json) {
      try {
        const material = JSON.parse(json);
        if (material.name) {
          this.materials.set(material.name, material);
          return material;
        }
      } catch (e) {
        console.error('Failed to import material:', e);
      }
      return null;
    }

    getShaderSource(materialName) {
      const material = this.materials.get(materialName);
      if (!material) return null;
      if (this.shaderCache.has(material.shaderVariant)) {
        return this.shaderCache.get(material.shaderVariant);
      }
      const shader = {
        vertex: this._generateVertexShader(material),
        fragment: this._generateFragmentShader(material)
      };
      this.shaderCache.set(material.shaderVariant, shader);
      return shader;
    }

    _generateVertexShader(material) {
      return `#version 300 es
precision highp float;
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUV;
in vec3 aTangent;
out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUV;
out vec3 vTangent;
uniform mat4 uModelMatrix;
uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;
uniform mat3 uNormalMatrix;
void main() {
  vec4 worldPos = uModelMatrix * vec4(aPosition, 1.0);
  vWorldPos = worldPos.xyz;
  vNormal = normalize(uNormalMatrix * aNormal);
  vUV = aUV;
  vTangent = normalize(uNormalMatrix * aTangent);
  gl_Position = uProjectionMatrix * uViewMatrix * worldPos;
}`;
    }

    _generateFragmentShader(material) {
      let features = '';
      if (material.subsurface > 0) features += '#define USE_SSS\n';
      if (material.sheen > 0) features += '#define USE_SHEEN\n';
      if (material.clearcoat > 0) features += '#define USE_CLEARCOAT\n';
      return `#version 300 es
precision highp float;
${features}
in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUV;
in vec3 vTangent;
out vec4 fragColor;
uniform vec3 uBaseColor;
uniform float uRoughness;
uniform float uMetallic;
uniform vec3 uCameraPos;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
#ifdef USE_SSS
uniform float uSubsurface;
uniform vec3 uSubsurfaceColor;
uniform vec3 uSubsurfaceRadius;
#endif
#ifdef USE_SHEEN
uniform float uSheen;
uniform vec3 uSheenColor;
uniform float uSheenRoughness;
#endif
#ifdef USE_CLEARCOAT
uniform float uClearcoat;
uniform float uClearcoatRoughness;
#endif
float DistributionGGX(vec3 N, vec3 H, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float NdotH = max(dot(N, H), 0.0);
  float NdotH2 = NdotH * NdotH;
  float denom = (NdotH2 * (a2 - 1.0) + 1.0);
  denom = 3.14159265 * denom * denom;
  return a2 / max(denom, 0.0001);
}
float GeometrySchlickGGX(float NdotV, float roughness) {
  float r = (roughness + 1.0);
  float k = (r * r) / 8.0;
  return NdotV / (NdotV * (1.0 - k) + k);
}
float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
  float NdotV = max(dot(N, V), 0.0);
  float NdotL = max(dot(N, L), 0.0);
  return GeometrySchlickGGX(NdotV, roughness) * GeometrySchlickGGX(NdotL, roughness);
}
vec3 fresnelSchlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCameraPos - vWorldPos);
  vec3 L = normalize(uLightDir);
  vec3 H = normalize(V + L);
  vec3 albedo = uBaseColor;
  float roughness = uRoughness;
  float metallic = uMetallic;
  vec3 F0 = vec3(0.04);
  F0 = mix(F0, albedo, metallic);
  float NDF = DistributionGGX(N, H, roughness);
  float G = GeometrySmith(N, V, L, roughness);
  vec3 F = fresnelSchlick(max(dot(H, V), 0.0), F0);
  vec3 numerator = NDF * G * F;
  float denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001;
  vec3 specular = numerator / denominator;
  vec3 kS = F;
  vec3 kD = vec3(1.0) - kS;
  kD *= 1.0 - metallic;
  float NdotL = max(dot(N, L), 0.0);
  vec3 Lo = (kD * albedo / 3.14159265 + specular) * uLightColor * NdotL;
#ifdef USE_SSS
  vec3 sss = uSubsurfaceColor * uSubsurface * (1.0 - NdotL) * 0.5;
  Lo += sss;
#endif
#ifdef USE_SHEEN
  float sheenFactor = pow(1.0 - max(dot(N, V), 0.0), 2.0);
  vec3 sheen = uSheenColor * uSheen * sheenFactor;
  Lo += sheen;
#endif
#ifdef USE_CLEARCOAT
  vec3 clearcoatNormal = N;
  float clearcoatNDF = DistributionGGX(clearcoatNormal, H, uClearcoatRoughness);
  float clearcoatG = GeometrySmith(clearcoatNormal, V, L, uClearcoatRoughness);
  vec3 clearcoatF = fresnelSchlick(max(dot(H, V), 0.0), vec3(0.04));
  vec3 clearcoatSpecular = (clearcoatNDF * clearcoatG * clearcoatF) / (4.0 * max(dot(clearcoatNormal, V), 0.0) * max(dot(clearcoatNormal, L), 0.0) + 0.0001);
  Lo += clearcoatSpecular * uClearcoat * uLightColor * NdotL;
#endif
  vec3 ambient = vec3(0.03) * albedo;
  vec3 color = ambient + Lo;
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0/2.2));
  fragColor = vec4(color, 1.0);
}`;
    }

    clear() {
      this.materials.clear();
      this.shaderCache.clear();
      this.currentMaterial = null;
    }

    _generateId() {
      return 'mat_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
    }
  }

  class SkinTextureGenerator {
    constructor() {
      this.textures = new Map();
      this.noiseSeed = 12345;
      this.permutation = this._generatePermutation(this.noiseSeed);
    }

    generate(type, width = 512, height = 512, options = {}) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const imageData = ctx.createImageData(width, height);
      switch (type) {
        case 'albedo':
          this._generateAlbedo(imageData, width, height, options);
          break;
        case 'normal':
          this._generateNormal(imageData, width, height, options);
          break;
        case 'roughness':
          this._generateRoughness(imageData, width, height, options);
          break;
        case 'subsurface':
          this._generateSubsurface(imageData, width, height, options);
          break;
        case 'specular':
          this._generateSpecular(imageData, width, height, options);
          break;
        case 'displacement':
          this._generateDisplacement(imageData, width, height, options);
          break;
        case 'ambient_occlusion':
          this._generateAO(imageData, width, height, options);
          break;
        default:
          return null;
      }
      ctx.putImageData(imageData, 0, 0);
      const texture = {
        type,
        width,
        height,
        canvas,
        data: imageData.data,
        id: this._generateId(),
        createdAt: Date.now()
      };
      this.textures.set(`${type}_${Date.now()}`, texture);
      return texture;
    }

    _generateAlbedo(imageData, width, height, options) {
      const baseColor = options.baseColor || [0.85, 0.72, 0.62];
      const variation = options.variation || 0.1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const noise = this._perlin2D(x / 50, y / 50);
          const fineNoise = this._perlin2D(x / 10, y / 10);
          const variationAmount = (noise * 0.7 + fineNoise * 0.3) * variation;
          imageData.data[idx] = Math.min(255, Math.max(0, (baseColor[0] + variationAmount) * 255));
          imageData.data[idx + 1] = Math.min(255, Math.max(0, (baseColor[1] + variationAmount * 0.8) * 255));
          imageData.data[idx + 2] = Math.min(255, Math.max(0, (baseColor[2] + variationAmount * 0.6) * 255));
          imageData.data[idx + 3] = 255;
        }
      }
    }

    _generateNormal(imageData, width, height, options) {
      const strength = options.strength || 1;
      const scale = options.scale || 20;
      const heightMap = new Float32Array(width * height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          heightMap[y * width + x] = this._perlin2D(x / scale, y / scale);
        }
      }
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const xL = heightMap[y * width + Math.max(0, x - 1)];
          const xR = heightMap[y * width + Math.min(width - 1, x + 1)];
          const yD = heightMap[Math.max(0, y - 1) * width + x];
          const yU = heightMap[Math.min(height - 1, y + 1) * width + x];
          const dx = (xR - xL) * strength;
          const dy = (yU - yD) * strength;
          const normal = this._normalize([-dx, -dy, 1]);
          imageData.data[idx] = (normal[0] * 0.5 + 0.5) * 255;
          imageData.data[idx + 1] = (normal[1] * 0.5 + 0.5) * 255;
          imageData.data[idx + 2] = (normal[2] * 0.5 + 0.5) * 255;
          imageData.data[idx + 3] = 255;
        }
      }
    }

    _generateRoughness(imageData, width, height, options) {
      const baseRoughness = options.baseRoughness || 0.5;
      const variation = options.variation || 0.2;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const noise = this._perlin2D(x / 30, y / 30);
          const roughness = Math.min(1, Math.max(0, baseRoughness + noise * variation));
          const value = roughness * 255;
          imageData.data[idx] = value;
          imageData.data[idx + 1] = value;
          imageData.data[idx + 2] = value;
          imageData.data[idx + 3] = 255;
        }
      }
    }

    _generateSubsurface(imageData, width, height, options) {
      const baseSubsurface = options.baseSubsurface || 0.3;
      const variation = options.variation || 0.15;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const noise = this._perlin2D(x / 40, y / 40);
          const subsurface = Math.min(1, Math.max(0, baseSubsurface + noise * variation));
          const value = subsurface * 255;
          imageData.data[idx] = value;
          imageData.data[idx + 1] = value;
          imageData.data[idx + 2] = value;
          imageData.data[idx + 3] = 255;
        }
      }
    }

    _generateSpecular(imageData, width, height, options) {
      const baseSpecular = options.baseSpecular || 0.5;
      const variation = options.variation || 0.1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const noise = this._perlin2D(x / 25, y / 25);
          const specular = Math.min(1, Math.max(0, baseSpecular + noise * variation));
          const value = specular * 255;
          imageData.data[idx] = value;
          imageData.data[idx + 1] = value;
          imageData.data[idx + 2] = value;
          imageData.data[idx + 3] = 255;
        }
      }
    }

    _generateDisplacement(imageData, width, height, options) {
      const strength = options.strength || 0.5;
      const scale = options.scale || 15;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const noise = this._perlin2D(x / scale, y / scale);
          const fineNoise = this._perlin2D(x / (scale / 3), y / (scale / 3));
          const displacement = (noise * 0.7 + fineNoise * 0.3) * strength;
          const value = (displacement * 0.5 + 0.5) * 255;
          imageData.data[idx] = value;
          imageData.data[idx + 1] = value;
          imageData.data[idx + 2] = value;
          imageData.data[idx + 3] = 255;
        }
      }
    }

    _generateAO(imageData, width, height, options) {
      const strength = options.strength || 0.8;
      const scale = options.scale || 30;
      const heightMap = new Float32Array(width * height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          heightMap[y * width + x] = this._perlin2D(x / scale, y / scale);
        }
      }
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          let occlusion = 0;
          const centerHeight = heightMap[y * width + x];
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = Math.min(width - 1, Math.max(0, x + dx));
              const ny = Math.min(height - 1, Math.max(0, y + dy));
              const neighborHeight = heightMap[ny * width + nx];
              if (neighborHeight > centerHeight) {
                occlusion += (neighborHeight - centerHeight) * 0.1;
              }
            }
          }
          const ao = Math.min(1, Math.max(0, 1 - occlusion * strength));
          const value = ao * 255;
          imageData.data[idx] = value;
          imageData.data[idx + 1] = value;
          imageData.data[idx + 2] = value;
          imageData.data[idx + 3] = 255;
        }
      }
    }

    _perlin2D(x, y) {
      const X = Math.floor(x) & 255;
      const Y = Math.floor(y) & 255;
      const xf = x - Math.floor(x);
      const yf = y - Math.floor(y);
      const u = this._fade(xf);
      const v = this._fade(yf);
      const aa = this.permutation[(this.permutation[X] + Y) & 255];
      const ab = this.permutation[(this.permutation[X] + Y + 1) & 255];
      const ba = this.permutation[(this.permutation[X + 1] + Y) & 255];
      const bb = this.permutation[(this.permutation[X + 1] + Y + 1) & 255];
      const x1 = this._lerp(this._grad(aa, xf, yf), this._grad(ba, xf - 1, yf), u);
      const x2 = this._lerp(this._grad(ab, xf, yf - 1), this._grad(bb, xf - 1, yf - 1), u);
      return this._lerp(x1, x2, v);
    }

    _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    _lerp(a, b, t) { return a + t * (b - a); }
    _grad(hash, x, y) {
      const h = hash & 3;
      const u = h < 2 ? x : y;
      const v = h < 2 ? y : x;
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

    _normalize(v) {
      const l = Math.sqrt(v[0]**2 + v[1]**2 + v[2]**2) || 1;
      return [v[0]/l, v[1]/l, v[2]/l];
    }

    setSeed(seed) {
      this.noiseSeed = seed;
      this.permutation = this._generatePermutation(seed);
    }

    getTexture(name) {
      return this.textures.get(name);
    }

    getTextureNames() {
      return Array.from(this.textures.keys());
    }

    getTextureCount() {
      return this.textures.size;
    }

    removeTexture(name) {
      this.textures.delete(name);
    }

    clear() {
      this.textures.clear();
    }

    _generateId() {
      return 'tex_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
    }
  }

  class MakeupSystem {
    constructor() {
      this.layers = new Map();
      this.currentLook = null;
      this.presets = new Map();
      this._initDefaultPresets();
    }

    _initDefaultPresets() {
      const presets = {
        natural: {
          foundation: { coverage: 0.3, color: [0.9, 0.8, 0.7] },
          blush: { intensity: 0.2, color: [1, 0.6, 0.6], position: 'cheeks' },
          eyeshadow: { intensity: 0.1, color: [0.8, 0.7, 0.6], style: 'natural' },
          eyeliner: { intensity: 0.3, color: [0.1, 0.1, 0.1], style: 'thin' },
          mascara: { intensity: 0.4, color: [0.05, 0.05, 0.05], length: 0.3 },
          lipstick: { intensity: 0.5, color: [0.9, 0.4, 0.4], finish: 'matte' },
          highlight: { intensity: 0.2, color: [1, 0.95, 0.9], position: 'cheekbones' },
          contour: { intensity: 0.15, color: [0.6, 0.45, 0.35], position: 'cheeks' }
        },
        glamorous: {
          foundation: { coverage: 0.6, color: [0.92, 0.82, 0.72] },
          blush: { intensity: 0.4, color: [1, 0.5, 0.5], position: 'cheeks' },
          eyeshadow: { intensity: 0.6, color: [0.7, 0.5, 0.8], style: 'smoky' },
          eyeliner: { intensity: 0.8, color: [0, 0, 0], style: 'winged' },
          mascara: { intensity: 0.8, color: [0, 0, 0], length: 0.6 },
          lipstick: { intensity: 0.8, color: [0.9, 0.2, 0.3], finish: 'glossy' },
          highlight: { intensity: 0.5, color: [1, 1, 0.95], position: 'cheekbones' },
          contour: { intensity: 0.4, color: [0.5, 0.35, 0.25], position: 'cheeks' }
        }
      };
      for (const [name, config] of Object.entries(presets)) {
        this.presets.set(name, JSON.parse(JSON.stringify(config)));
      }
    }

    addLayer(name, config) {
      this.layers.set(name, {
        name,
        type: config.type || 'color',
        intensity: config.intensity || 0.5,
        color: config.color || [1, 1, 1],
        position: config.position || 'face',
        style: config.style || 'default',
        texture: config.texture || null,
        blendMode: config.blendMode || 'normal',
        enabled: config.enabled !== false,
        order: config.order || this.layers.size
      });
    }

    removeLayer(name) {
      this.layers.delete(name);
    }

    updateLayer(name, updates) {
      const layer = this.layers.get(name);
      if (layer) {
        Object.assign(layer, updates);
      }
    }

    applyPreset(name) {
      const preset = this.presets.get(name);
      if (!preset) return false;
      this.layers.clear();
      for (const [layerName, config] of Object.entries(preset)) {
        this.addLayer(layerName, config);
      }
      this.currentLook = name;
      return true;
    }

    addPreset(name, config) {
      this.presets.set(name, JSON.parse(JSON.stringify(config)));
    }

    getPreset(name) {
      return this.presets.get(name);
    }

    getPresetNames() {
      return Array.from(this.presets.keys());
    }

    getLayer(name) {
      return this.layers.get(name);
    }

    getLayerNames() {
      return Array.from(this.layers.keys());
    }

    getLayers() {
      return Array.from(this.layers.values()).sort((a, b) => a.order - b.order);
    }

    getCurrentLook() {
      return this.currentLook;
    }

    setLayerEnabled(name, enabled) {
      const layer = this.layers.get(name);
      if (layer) layer.enabled = enabled;
    }

    setLayerIntensity(name, intensity) {
      const layer = this.layers.get(name);
      if (layer) layer.intensity = Math.max(0, Math.min(1, intensity));
    }

    setLayerColor(name, color) {
      const layer = this.layers.get(name);
      if (layer) layer.color = [...color];
    }

    exportLook() {
      const layers = {};
      for (const [name, layer] of this.layers) {
        layers[name] = { ...layer };
      }
      return JSON.stringify({ name: this.currentLook, layers }, null, 2);
    }

    importLook(json) {
      try {
        const look = JSON.parse(json);
        this.layers.clear();
        for (const [name, config] of Object.entries(look.layers)) {
          this.layers.set(name, config);
        }
        this.currentLook = look.name || 'imported';
        return true;
      } catch (e) {
        console.error('Failed to import look:', e);
        return false;
      }
    }

    clear() {
      this.layers.clear();
      this.currentLook = null;
    }
  }

  return {
    SkinMaterialSystem, SkinTextureGenerator, MakeupSystem
  };
})();

if (typeof window !== 'undefined') window.SpiritSkinV4 = SpiritSkinV4;
if (typeof globalThis !== 'undefined') globalThis.SpiritSkinV4 = SpiritSkinV4;
