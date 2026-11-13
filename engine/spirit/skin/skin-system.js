/**
 * 灵体皮肤系统 - 材质/纹理/着色器/变形/物理/形态/颜色/妆容/湿度/老化/定制
 * 纯自研，次表面散射/物理皮肤渲染
 * @version 2.0.0
 */
'use strict';

const SpiritSkin = (function () {

  // ============================================================
  // 皮肤材质
  // ============================================================
  class SkinMaterial {
    constructor() {
      this.diffuseColor = [0.85, 0.65, 0.55, 1.0];
      this.normalStrength = 1.0;
      this.roughness = 0.6;
      this.metallic = 0.0;
      this.subsurfaceScattering = {
        enabled: true,
        intensity: 0.8,
        radius: [0.002, 0.010, 0.030],
        color: [1.0, 0.6, 0.4],
        thicknessScale: 1.0,
        distortion: 0.4,
        power: 2.0,
        scale: 1.0
      };
      this.sheen = {
        enabled: true,
        color: [1.0, 0.8, 0.7],
        roughness: 0.5,
        intensity: 0.3
      };
      this.clearcoat = {
        enabled: false,
        intensity: 0.1,
        roughness: 0.1
      };
      this.emissive = {
        enabled: false,
        color: [0, 0, 0],
        intensity: 0
      };
      this.opacity = 1.0;
      this.transmission = 0.0;
      this.ior = 1.4;
      this.thickness = 0.5;
      this.attenuationColor = [1, 0.8, 0.6];
      this.attenuationDistance = 0.5;
      this.specularColor = [1, 1, 1];
      this.specularIntensity = 0.5;
      this.envMapIntensity = 0.5;
      this.lightMapIntensity = 1.0;
      this.aoMapIntensity = 1.0;
      this.displacementScale = 0.0;
      this.displacementBias = 0.0;
      this.wireframe = false;
      this.side = 1029;
      this.flatShading = false;
      this.vertexColors = false;
      this.dithering = true;
      this.premultipliedAlpha = false;
      this.alphaTest = 0;
      this.depthWrite = true;
      this.depthTest = true;
      this.colorWrite = [true, true, true, true];
      this.blending = 1;
      this.blendSrc = 770;
      this.blendDst = 771;
      this.blendSrcAlpha = 1;
      this.blendDstAlpha = 1;
      this.polygonOffset = false;
      this.polygonOffsetFactor = 0;
      this.polygonOffsetUnits = 0;
      this.userData = {};
      this.version = 0;
    }

    setDiffuse(r, g, b, a = 1) { this.diffuseColor = [r, g, b, a]; this.version++; }
    setRoughness(v) { this.roughness = Math.max(0, Math.min(1, v)); this.version++; }
    setMetallic(v) { this.metallic = Math.max(0, Math.min(1, v)); this.version++; }
    setNormalStrength(v) { this.normalStrength = v; this.version++; }
    setOpacity(v) { this.opacity = Math.max(0, Math.min(1, v)); this.version++; }
    setSSS(options) { Object.assign(this.subsurfaceScattering, options); this.version++; }
    setSheen(options) { Object.assign(this.sheen, options); this.version++; }
    setClearcoat(options) { Object.assign(this.clearcoat, options); this.version++; }
    setEmissive(color, intensity) { this.emissive.color = color; this.emissive.intensity = intensity; this.emissive.enabled = intensity > 0; this.version++; }
    setTransmission(v) { this.transmission = Math.max(0, Math.min(1, v)); this.version++; }
    setThickness(v) { this.thickness = v; this.version++; }
    setIOR(v) { this.ior = v; this.version++; }
    clone() {
      const mat = new SkinMaterial();
      Object.assign(mat, JSON.parse(JSON.stringify(this)));
      return mat;
    }
    copy(source) {
      Object.assign(this, JSON.parse(JSON.stringify(source)));
      this.version++;
    }
    getUniforms() {
      return {
        diffuseColor: this.diffuseColor,
        normalStrength: this.normalStrength,
        roughness: this.roughness,
        metallic: this.metallic,
        sssIntensity: this.subsurfaceScattering.intensity,
        sssRadius: this.subsurfaceScattering.radius,
        sssColor: this.subsurfaceScattering.color,
        sssDistortion: this.subsurfaceScattering.distortion,
        sssPower: this.subsurfaceScattering.power,
        sssScale: this.subsurfaceScattering.scale,
        sheenColor: this.sheen.color,
        sheenRoughness: this.sheen.roughness,
        sheenIntensity: this.sheen.intensity,
        clearcoatIntensity: this.clearcoat.intensity,
        clearcoatRoughness: this.clearcoat.roughness,
        emissiveColor: this.emissive.color,
        emissiveIntensity: this.emissive.intensity,
        opacity: this.opacity,
        transmission: this.transmission,
        ior: this.ior,
        thickness: this.thickness,
        attenuationColor: this.attenuationColor,
        attenuationDistance: this.attenuationDistance,
        specularColor: this.specularColor,
        specularIntensity: this.specularIntensity,
        envMapIntensity: this.envMapIntensity
      };
    }
    dispose() { this.userData = {}; }
  }

  // ============================================================
  // 皮肤纹理
  // ============================================================
  class SkinTexture {
    constructor() {
      this.diffuseMap = null;
      this.normalMap = null;
      this.roughnessMap = null;
      this.metallicMap = null;
      this.aoMap = null;
      this.emissiveMap = null;
      this.thicknessMap = null;
      this.curvatureMap = null;
      this.displacementMap = null;
      this.specularMap = null;
      this.textureParameters = {
        wrapS: 10497,
        wrapT: 10497,
        minFilter: 9987,
        magFilter: 9729,
        anisotropy: 8,
        generateMipmaps: true
      };
      this.uvScale = [1, 1];
      this.uvOffset = [0, 0];
      this.uvRotation = 0;
      this.colorSpace = 'srgb';
      this.initialized = false;
    }

    setDiffuseMap(texture) { this.diffuseMap = texture; }
    setNormalMap(texture) { this.normalMap = texture; }
    setRoughnessMap(texture) { this.roughnessMap = texture; }
    setMetallicMap(texture) { this.metallicMap = texture; }
    setAOMap(texture) { this.aoMap = texture; }
    setEmissiveMap(texture) { this.emissiveMap = texture; }
    setThicknessMap(texture) { this.thicknessMap = texture; }
    setCurvatureMap(texture) { this.curvatureMap = texture; }
    setDisplacementMap(texture) { this.displacementMap = texture; }
    setSpecularMap(texture) { this.specularMap = texture; }

    generateNormalMap(diffuseTexture, strength = 1.0, scale = 2) {
      const canvas = document.createElement('canvas');
      canvas.width = diffuseTexture.width;
      canvas.height = diffuseTexture.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(diffuseTexture, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const normalData = new Uint8ClampedArray(data.length);
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const idx = (y * canvas.width + x) * 4;
          const gray = (data[idx] * 0.299 + data[idx+1] * 0.587 + data[idx+2] * 0.114) / 255;
          const grayL = x > 0 ? (data[idx-4] * 0.299 + data[idx-3] * 0.587 + data[idx-2] * 0.114) / 255 : gray;
          const grayR = x < canvas.width-1 ? (data[idx+4] * 0.299 + data[idx+5] * 0.587 + data[idx+6] * 0.114) / 255 : gray;
          const grayU = y > 0 ? (data[idx-canvas.width*4] * 0.299 + data[idx-canvas.width*4+1] * 0.587 + data[idx-canvas.width*4+2] * 0.114) / 255 : gray;
          const grayD = y < canvas.height-1 ? (data[idx+canvas.width*4] * 0.299 + data[idx+canvas.width*4+1] * 0.587 + data[idx+canvas.width*4+2] * 0.114) / 255 : gray;
          const dx = (grayR - grayL) * strength * scale;
          const dy = (grayD - grayU) * strength * scale;
          const dz = 1.0;
          const len = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
          normalData[idx] = ((dx / len) * 0.5 + 0.5) * 255;
          normalData[idx+1] = ((dy / len) * 0.5 + 0.5) * 255;
          normalData[idx+2] = ((dz / len) * 0.5 + 0.5) * 255;
          normalData[idx+3] = 255;
        }
      }
      const normalCanvas = document.createElement('canvas');
      normalCanvas.width = canvas.width;
      normalCanvas.height = canvas.height;
      normalCanvas.getContext('2d').putImageData(new ImageData(normalData, canvas.width, canvas.height), 0, 0);
      return normalCanvas;
    }

    generateRoughnessMap(diffuseTexture, baseRoughness = 0.6) {
      const canvas = document.createElement('canvas');
      canvas.width = diffuseTexture.width;
      canvas.height = diffuseTexture.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(diffuseTexture, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const gray = (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114) / 255;
        const roughness = Math.max(0, Math.min(1, baseRoughness + (gray - 0.5) * 0.3));
        data[i] = data[i+1] = data[i+2] = roughness * 255;
      }
      ctx.putImageData(imageData, 0, 0);
      return canvas;
    }

    blendTextures(baseTexture, overlayTexture, blendMode = 'normal', opacity = 1.0) {
      const canvas = document.createElement('canvas');
      canvas.width = baseTexture.width;
      canvas.height = baseTexture.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(baseTexture, 0, 0);
      ctx.globalAlpha = opacity;
      if (blendMode === 'multiply') ctx.globalCompositeOperation = 'multiply';
      else if (blendMode === 'screen') ctx.globalCompositeOperation = 'screen';
      else if (blendMode === 'overlay') ctx.globalCompositeOperation = 'overlay';
      else if (blendMode === 'soft-light') ctx.globalCompositeOperation = 'soft-light';
      ctx.drawImage(overlayTexture, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      return canvas;
    }

    setUVScale(x, y) { this.uvScale = [x, y]; }
    setUVOffset(x, y) { this.uvOffset = [x, y]; }
    setUVRotation(r) { this.uvRotation = r; }
    setTextureParameters(params) { Object.assign(this.textureParameters, params); }
    getTextureList() {
      return {
        diffuse: this.diffuseMap,
        normal: this.normalMap,
        roughness: this.roughnessMap,
        metallic: this.metallicMap,
        ao: this.aoMap,
        emissive: this.emissiveMap,
        thickness: this.thicknessMap,
        curvature: this.curvatureMap,
        displacement: this.displacementMap,
        specular: this.specularMap
      };
    }
    clone() {
      const tex = new SkinTexture();
      Object.assign(tex, JSON.parse(JSON.stringify(this)));
      return tex;
    }
    dispose() {
      this.diffuseMap = null; this.normalMap = null; this.roughnessMap = null;
      this.metallicMap = null; this.aoMap = null; this.emissiveMap = null;
      this.thicknessMap = null; this.curvatureMap = null; this.displacementMap = null;
      this.specularMap = null;
    }
  }

  // ============================================================
  // 皮肤着色器
  // ============================================================
  class SkinShader {
    constructor() {
      this.quality = 'high';
      this.features = {
        subsurfaceScattering: true,
        normalMapping: true,
        roughnessMapping: true,
        ambientOcclusion: true,
        sheen: true,
        clearcoat: false,
        emissive: false,
        transmission: false,
        displacement: false,
        vertexColors: false,
        fog: true,
        shadows: true,
        envMap: false,
        dithering: true,
        toneMapping: true
      };
      this.defines = {};
      this.vertexShader = '';
      this.fragmentShader = '';
      this.compiled = false;
    }

    setQuality(q) {
      this.quality = q;
      if (q === 'low') {
        this.features.subsurfaceScattering = false;
        this.features.normalMapping = false;
        this.features.sheen = false;
        this.features.dithering = false;
      } else if (q === 'medium') {
        this.features.subsurfaceScattering = true;
        this.features.normalMapping = true;
        this.features.sheen = false;
      }
      this.compiled = false;
    }

    toggleFeature(name, enabled) {
      if (name in this.features) {
        this.features[name] = enabled;
        this.compiled = false;
      }
    }

    compile() {
      this.defines = {};
      if (this.features.subsurfaceScattering) this.defines.USE_SSS = '';
      if (this.features.normalMapping) this.defines.USE_NORMALMAP = '';
      if (this.features.roughnessMapping) this.defines.USE_ROUGHNESSMAP = '';
      if (this.features.ambientOcclusion) this.defines.USE_AOMAP = '';
      if (this.features.sheen) this.defines.USE_SHEEN = '';
      if (this.features.clearcoat) this.defines.USE_CLEARCOAT = '';
      if (this.features.emissive) this.defines.USE_EMISSIVEMAP = '';
      if (this.features.transmission) this.defines.USE_TRANSMISSION = '';
      if (this.features.displacement) this.defines.USE_DISPLACEMENTMAP = '';
      if (this.features.vertexColors) this.defines.USE_COLOR = '';
      if (this.features.fog) this.defines.USE_FOG = '';
      if (this.features.shadows) this.defines.USE_SHADOWMAP = '';
      if (this.features.envMap) this.defines.USE_ENVMAP = '';
      if (this.features.dithering) this.defines.USE_DITHERING = '';
      if (this.features.toneMapping) this.defines.USE_TONEMAPPING = '';
      this.vertexShader = this._generateVertexShader();
      this.fragmentShader = this._generateFragmentShader();
      this.compiled = true;
      return { vertex: this.vertexShader, fragment: this.fragmentShader, defines: this.defines };
    }

    _generateVertexShader() {
      return `
in vec3 position;
in vec3 normal;
in vec2 uv;
${this.features.vertexColors ? 'in vec3 color;' : ''}
${this.features.displacement ? 'in float displacement;' : ''}

uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
${this.features.displacement ? 'uniform float displacementScale; uniform float displacementBias; uniform sampler2D displacementMap;' : ''}

out vec3 vPosition;
out vec3 vNormal;
out vec2 vUv;
out vec3 vViewPosition;
out vec3 vWorldPosition;
${this.features.vertexColors ? 'out vec3 vColor;' : ''}
${this.features.shadows ? 'out vec4 vShadowCoord;' : ''}

void main() {
  vec3 pos = position;
  vec3 nrm = normal;
  ${this.features.displacement ? `
  float disp = texture(displacementMap, uv).r;
  pos += normal * (disp * displacementScale + displacementBias);
  ` : ''}
  ${this.features.vertexColors ? 'vColor = color;' : ''}
  vUv = uv;
  vNormal = normalize(normalMatrix * nrm);
  vPosition = pos;
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  vViewPosition = -mvPosition.xyz;
  vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
  vWorldPosition = worldPosition.xyz;
  ${this.features.shadows ? 'vShadowCoord = shadowMatrix * worldPosition;' : ''}
  gl_Position = projectionMatrix * mvPosition;
}`;
    }

    _generateFragmentShader() {
      return `
precision highp float;
in vec3 vPosition;
in vec3 vNormal;
in vec2 vUv;
in vec3 vViewPosition;
in vec3 vWorldPosition;
${this.features.vertexColors ? 'in vec3 vColor;' : ''}
${this.features.shadows ? 'in vec4 vShadowCoord;' : ''}

uniform vec3 diffuseColor;
uniform float normalStrength;
uniform float roughness;
uniform float metallic;
uniform float opacity;
${this.features.normalMapping ? 'uniform sampler2D normalMap;' : ''}
${this.features.roughnessMapping ? 'uniform sampler2D roughnessMap;' : ''}
${this.features.ambientOcclusion ? 'uniform sampler2D aoMap; uniform float aoMapIntensity;' : ''}
uniform sampler2D diffuseMap;
${this.features.subsurfaceScattering ? `
uniform float sssIntensity;
uniform vec3 sssRadius;
uniform vec3 sssColor;
uniform float sssDistortion;
uniform float sssPower;
uniform float sssScale;
uniform sampler2D thicknessMap;
` : ''}
${this.features.sheen ? `
uniform vec3 sheenColor;
uniform float sheenRoughness;
uniform float sheenIntensity;
` : ''}
${this.features.clearcoat ? `
uniform float clearcoatIntensity;
uniform float clearcoatRoughness;
` : ''}
${this.features.emissive ? `
uniform vec3 emissiveColor;
uniform float emissiveIntensity;
uniform sampler2D emissiveMap;
` : ''}
${this.features.transmission ? `
uniform float transmission;
uniform float ior;
uniform float thickness;
uniform vec3 attenuationColor;
uniform float attenuationDistance;
` : ''}
uniform vec3 specularColor;
uniform float specularIntensity;
${this.features.envMap ? 'uniform float envMapIntensity; uniform samplerCube envMap;' : ''}
${this.features.fog ? 'uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;' : ''}
${this.features.shadows ? 'uniform sampler2D shadowMap; uniform float shadowBias; uniform float shadowRadius;' : ''}

uniform vec3 ambientLightColor;
uniform vec3 directionalLightDirection;
uniform vec3 directionalLightColor;
uniform vec3 pointLightPosition;
uniform vec3 pointLightColor;
uniform float pointLightDistance;

out vec4 fragColor;

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

float distributionGGX(vec3 N, vec3 H, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float NdotH = max(dot(N, H), 0.0);
  float NdotH2 = NdotH * NdotH;
  float denom = (NdotH2 * (a2 - 1.0) + 1.0);
  denom = 3.14159265 * denom * denom;
  return a2 / max(denom, 0.0001);
}

float geometrySchlickGGX(float NdotV, float roughness) {
  float r = (roughness + 1.0);
  float k = (r * r) / 8.0;
  return NdotV / (NdotV * (1.0 - k) + k);
}

float geometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
  float NdotV = max(dot(N, V), 0.0);
  float NdotL = max(dot(N, L), 0.0);
  return geometrySchlickGGX(NdotV, roughness) * geometrySchlickGGX(NdotL, roughness);
}

${this.features.subsurfaceScattering ? `
vec3 subsurfaceScattering(vec3 N, vec3 V, vec3 L, vec3 albedo, float thickness) {
  vec3 H = normalize(V + L);
  float NdotL = max(dot(N, L), 0.0);
  float VdotL = max(dot(V, L), 0.0);
  vec3 distortion = N * sssDistortion + L * (1.0 - sssDistortion);
  float wrap = max(dot(distortion, V), 0.0);
  float sss = pow(wrap, sssPower) * sssIntensity;
  vec3 scatterColor = sssColor * albedo;
  vec3 attenuation = exp(-thickness * sssScale / max(sssRadius, vec3(0.001)));
  return scatterColor * sss * (1.0 - attenuation) * NdotL;
}
` : ''}

${this.features.sheen ? `
vec3 sheenBRDF(vec3 N, vec3 V, vec3 L, vec3 H) {
  float NdotH = max(dot(N, H), 0.0);
  float sheenDistribution = pow(1.0 - NdotH, 5.0) * sheenIntensity;
  return sheenColor * sheenDistribution;
}
` : ''}

${this.features.shadows ? `
float getShadow(vec4 shadowCoord) {
  vec3 projCoords = shadowCoord.xyz / shadowCoord.w;
  projCoords = projCoords * 0.5 + 0.5;
  float currentDepth = projCoords.z;
  float shadow = 0.0;
  vec2 texelSize = 1.0 / vec2(textureSize(shadowMap, 0));
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      float pcfDepth = texture(shadowMap, projCoords.xy + vec2(x, y) * texelSize).r;
      shadow += currentDepth - shadowBias > pcfDepth ? 1.0 : 0.0;
    }
  }
  return shadow / 9.0;
}
` : ''}

void main() {
  vec4 diffuseTex = texture(diffuseMap, vUv);
  vec3 albedo = diffuseColor * diffuseTex.rgb;
  ${this.features.vertexColors ? 'albedo *= vColor;' : ''}
  float alpha = diffuseTex.a * opacity;
  if (alpha < 0.01) discard;

  vec3 N = normalize(vNormal);
  ${this.features.normalMapping ? `
  vec3 normalTex = texture(normalMap, vUv).rgb * 2.0 - 1.0;
  normalTex.xy *= normalStrength;
  N = normalize(N + normalTex);
  ` : ''}

  vec3 V = normalize(vViewPosition);
  float NdotV = max(dot(N, V), 0.0);

  float rough = roughness;
  ${this.features.roughnessMapping ? 'rough *= texture(roughnessMap, vUv).r;' : ''}
  rough = max(0.04, rough);

  vec3 F0 = mix(vec3(0.04), albedo, metallic);
  F0 = mix(F0, specularColor, specularIntensity);

  vec3 Lo = vec3(0.0);

  vec3 L = normalize(-directionalLightDirection);
  vec3 H = normalize(V + L);
  float NdotL = max(dot(N, L), 0.0);
  float D = distributionGGX(N, H, rough);
  float G = geometrySmith(N, V, L, rough);
  vec3 F = fresnelSchlick(NdotV, F0);
  vec3 numerator = D * G * F;
  float denominator = 4.0 * NdotV * NdotL + 0.0001;
  vec3 specular = numerator / denominator;
  vec3 kS = F;
  vec3 kD = (1.0 - kS) * (1.0 - metallic);
  vec3 radiance = directionalLightColor;
  Lo += (kD * albedo / 3.14159265 + specular) * radiance * NdotL;

  ${this.features.subsurfaceScattering ? `
  float thickness = texture(thicknessMap, vUv).r;
  Lo += subsurfaceScattering(N, V, L, albedo, thickness);
  ` : ''}

  ${this.features.sheen ? 'Lo += sheenBRDF(N, V, L, H);' : ''}

  ${this.features.clearcoat ? `
  float ccD = distributionGGX(N, H, clearcoatRoughness);
  float ccG = geometrySmith(N, V, L, clearcoatRoughness);
  vec3 ccF = fresnelSchlick(NdotV, vec3(0.04));
  vec3 clearcoatSpec = (ccD * ccG * ccF) / (4.0 * NdotV * NdotL + 0.0001);
  Lo += clearcoatSpec * clearcoatIntensity * radiance * NdotL;
  ` : ''}

  ${this.features.shadows ? `
  float shadow = getShadow(vShadowCoord);
  Lo *= (1.0 - shadow * 0.7);
  ` : ''}

  vec3 ambient = ambientLightColor * albedo;
  ${this.features.ambientOcclusion ? 'ambient *= mix(1.0, texture(aoMap, vUv).r, aoMapIntensity);' : ''}

  ${this.features.envMap ? `
  vec3 R = reflect(-V, N);
  vec3 envColor = texture(envMap, R).rgb * envMapIntensity;
  ambient += envColor * kS * (1.0 - rough);
  ` : ''}

  vec3 color = ambient + Lo;

  ${this.features.emissive ? `
  vec3 emissiveTex = texture(emissiveMap, vUv).rgb;
  color += emissiveColor * emissiveIntensity * emissiveTex;
  ` : ''}

  ${this.features.transmission ? `
  vec3 transmittance = exp(-albedo * thickness / max(attenuationDistance, 0.001));
  color = mix(color, color * transmittance, transmission);
  ` : ''}

  ${this.features.toneMapping ? `
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0 / 2.2));
  ` : ''}

  ${this.features.fog ? `
  float fogDepth = length(vViewPosition);
  float fogFactor = smoothstep(fogNear, fogFar, fogDepth);
  color = mix(color, fogColor, fogFactor);
  ` : ''}

  ${this.features.dithering ? `
  float dither = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
  color += (dither - 0.5) / 255.0;
  ` : ''}

  fragColor = vec4(color, alpha);
}`;
    }

    getVertexShader() { if (!this.compiled) this.compile(); return this.vertexShader; }
    getFragmentShader() { if (!this.compiled) this.compile(); return this.fragmentShader; }
    getDefines() { if (!this.compiled) this.compile(); return this.defines; }
    getQuality() { return this.quality; }
    isFeatureEnabled(name) { return this.features[name] || false; }
    clone() {
      const shader = new SkinShader();
      shader.quality = this.quality;
      shader.features = { ...this.features };
      shader.compiled = false;
      return shader;
    }
    dispose() { this.vertexShader = ''; this.fragmentShader = ''; this.compiled = false; }
  }

  // ============================================================
  // 皮肤变形系统
  // ============================================================
  class SkinDeformation {
    constructor() {
      this.wrinkles = new Map();
      this.stretchZones = new Map();
      this.deformationMap = null;
      this.deformationStrength = 1.0;
      this.smoothingIterations = 3;
      this.vertexOffsets = null;
      this.vertexCount = 0;
      this.initialized = false;
      this.animationTime = 0;
    }

    init(vertexCount) {
      this.vertexCount = vertexCount;
      this.vertexOffsets = new Float32Array(vertexCount * 3);
      this.deformationMap = new Float32Array(vertexCount);
      this.initialized = true;
    }

    addWrinkle(name, config) {
      this.wrinkles.set(name, {
        center: config.center || [0, 0],
        direction: config.direction || [1, 0],
        width: config.width || 0.1,
        depth: config.depth || 0.01,
        frequency: config.frequency || 5,
        amplitude: config.amplitude || 0.005,
        weight: 0,
        targetWeight: 0
      });
    }

    addStretchZone(name, config) {
      this.stretchZones.set(name, {
        center: config.center || [0, 0],
        radius: config.radius || 0.2,
        stretchX: config.stretchX || 1,
        stretchY: config.stretchY || 1,
        weight: 0,
        targetWeight: 0
      });
    }

    setWrinkleWeight(name, weight) {
      const wrinkle = this.wrinkles.get(name);
      if (wrinkle) wrinkle.targetWeight = weight;
    }

    setStretchWeight(name, weight) {
      const zone = this.stretchZones.get(name);
      if (zone) zone.targetWeight = weight;
    }

    update(dt, vertices, uvs, normals) {
      if (!this.initialized) return;
      this.animationTime += dt;
      for (const wrinkle of this.wrinkles.values()) {
        wrinkle.weight += (wrinkle.targetWeight - wrinkle.weight) * Math.min(1, dt * 10);
      }
      for (const zone of this.stretchZones.values()) {
        zone.weight += (zone.targetWeight - zone.weight) * Math.min(1, dt * 10);
      }
      this.vertexOffsets.fill(0);
      this.deformationMap.fill(0);
      for (let i = 0; i < this.vertexCount; i++) {
        const u = uvs[i * 2], v = uvs[i * 2 + 1];
        let offsetX = 0, offsetY = 0, offsetZ = 0;
        let deform = 0;
        for (const wrinkle of this.wrinkles.values()) {
          if (wrinkle.weight < 0.01) continue;
          const dx = u - wrinkle.center[0];
          const dy = v - wrinkle.center[1];
          const dist = Math.sqrt(dx * dx + dy * dy);
          const falloff = Math.exp(-dist * dist / (wrinkle.width * wrinkle.width));
          const wave = Math.sin((dx * wrinkle.direction[0] + dy * wrinkle.direction[1]) * wrinkle.frequency * Math.PI * 2) * 0.5 + 0.5;
          const displacement = wave * wrinkle.amplitude * wrinkle.weight * falloff * this.deformationStrength;
          offsetZ += displacement;
          deform += falloff * wrinkle.weight;
        }
        for (const zone of this.stretchZones.values()) {
          if (zone.weight < 0.01) continue;
          const dx = u - zone.center[0];
          const dy = v - zone.center[1];
          const dist = Math.sqrt(dx * dx + dy * dy);
          const falloff = Math.exp(-dist * dist / (zone.radius * zone.radius));
          offsetX += dx * (zone.stretchX - 1) * zone.weight * falloff;
          offsetY += dy * (zone.stretchY - 1) * zone.weight * falloff;
          deform += falloff * zone.weight;
        }
        this.vertexOffsets[i * 3] = offsetX;
        this.vertexOffsets[i * 3 + 1] = offsetY;
        this.vertexOffsets[i * 3 + 2] = offsetZ;
        this.deformationMap[i] = Math.min(1, deform);
      }
      this._smoothDeformation();
    }

    _smoothDeformation() {
      if (this.smoothingIterations <= 0) return;
      const temp = new Float32Array(this.vertexCount * 3);
      for (let iter = 0; iter < this.smoothingIterations; iter++) {
        temp.set(this.vertexOffsets);
        for (let i = 1; i < this.vertexCount - 1; i++) {
          this.vertexOffsets[i * 3] = (temp[(i-1)*3] + temp[i*3] + temp[(i+1)*3]) / 3;
          this.vertexOffsets[i*3+1] = (temp[(i-1)*3+1] + temp[i*3+1] + temp[(i+1)*3+1]) / 3;
          this.vertexOffsets[i*3+2] = (temp[(i-1)*3+2] + temp[i*3+2] + temp[(i+1)*3+2]) / 3;
        }
      }
    }

    getVertexOffsets() { return this.vertexOffsets; }
    getDeformationMap() { return this.deformationMap; }
    getWrinkle(name) { return this.wrinkles.get(name); }
    getStretchZone(name) { return this.stretchZones.get(name); }
    setDeformationStrength(v) { this.deformationStrength = v; }
    setSmoothingIterations(n) { this.smoothingIterations = n; }
    reset() {
      for (const w of this.wrinkles.values()) { w.weight = 0; w.targetWeight = 0; }
      for (const z of this.stretchZones.values()) { z.weight = 0; z.targetWeight = 0; }
      if (this.vertexOffsets) this.vertexOffsets.fill(0);
      if (this.deformationMap) this.deformationMap.fill(0);
    }
    dispose() {
      this.wrinkles.clear();
      this.stretchZones.clear();
      this.vertexOffsets = null;
      this.deformationMap = null;
      this.initialized = false;
    }
  }

  // ============================================================
  // 皮肤物理（抖动/弹性）
  // ============================================================
  class SkinPhysics {
    constructor() {
      this.particles = [];
      this.springs = [];
      this.elasticity = 0.8;
      this.damping = 0.92;
      this.gravity = [0, -0.01, 0];
      this.wind = [0, 0, 0];
      this.windStrength = 0;
      this.iterations = 4;
      this.jiggleZones = new Map();
      this.initialized = false;
      this.time = 0;
    }

    init(vertexCount, positions, config = {}) {
      this.particles = [];
      this.springs = [];
      this.elasticity = config.elasticity || 0.8;
      this.damping = config.damping || 0.92;
      this.iterations = config.iterations || 4;
      for (let i = 0; i < vertexCount; i++) {
        this.particles.push({
          position: [positions[i*3], positions[i*3+1], positions[i*3+2]],
          prevPosition: [positions[i*3], positions[i*3+1], positions[i*3+2]],
          originalPosition: [positions[i*3], positions[i*3+1], positions[i*3+2]],
          velocity: [0, 0, 0],
          mass: 1,
          pinned: false,
          zone: null
        });
      }
      this.initialized = true;
    }

    addJiggleZone(name, config) {
      this.jiggleZones.set(name, {
        center: config.center || [0, 0, 0],
        radius: config.radius || 0.5,
        stiffness: config.stiffness || 0.5,
        damping: config.damping || 0.8,
        amplitude: config.amplitude || 0.02,
        frequency: config.frequency || 3,
        phase: Math.random() * Math.PI * 2,
        weight: 0
      });
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        const dx = p.originalPosition[0] - config.center[0];
        const dy = p.originalPosition[1] - config.center[1];
        const dz = p.originalPosition[2] - config.center[2];
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (dist < config.radius) {
          p.zone = name;
          p.mass = 1 + (1 - dist / config.radius) * 2;
        }
      }
    }

    setJiggleWeight(name, weight) {
      const zone = this.jiggleZones.get(name);
      if (zone) zone.weight = weight;
    }

    update(dt) {
      if (!this.initialized) return;
      this.time += dt;
      this.wind = [
        Math.sin(this.time * 0.5) * this.windStrength,
        Math.cos(this.time * 0.3) * this.windStrength * 0.5,
        Math.sin(this.time * 0.7) * this.windStrength
      ];
      for (const p of this.particles) {
        if (p.pinned) continue;
        p.velocity[0] = (p.position[0] - p.prevPosition[0]) * this.damping;
        p.velocity[1] = (p.position[1] - p.prevPosition[1]) * this.damping;
        p.velocity[2] = (p.position[2] - p.prevPosition[2]) * this.damping;
        p.prevPosition = [...p.position];
        p.position[0] += p.velocity[0] + this.gravity[0] * dt * dt * 60 + this.wind[0] * dt;
        p.position[1] += p.velocity[1] + this.gravity[1] * dt * dt * 60 + this.wind[1] * dt;
        p.position[2] += p.velocity[2] + this.gravity[2] * dt * dt * 60 + this.wind[2] * dt;
        if (p.zone) {
          const zone = this.jiggleZones.get(p.zone);
          if (zone && zone.weight > 0) {
            const dx = p.originalPosition[0] - p.position[0];
            const dy = p.originalPosition[1] - p.position[1];
            const dz = p.originalPosition[2] - p.position[2];
            p.position[0] += dx * zone.stiffness * zone.weight * dt * 10;
            p.position[1] += dy * zone.stiffness * zone.weight * dt * 10;
            p.position[2] += dz * zone.stiffness * zone.weight * dt * 10;
            const jiggle = Math.sin(this.time * zone.frequency * Math.PI * 2 + zone.phase) * zone.amplitude * zone.weight;
            p.position[1] += jiggle / p.mass;
          }
        }
      }
      for (let iter = 0; iter < this.iterations; iter++) {
        for (const spring of this.springs) {
          this._satisfySpring(spring);
        }
      }
    }

    _satisfySpring(spring) {
      const p1 = this.particles[spring.a];
      const p2 = this.particles[spring.b];
      const dx = p2.position[0] - p1.position[0];
      const dy = p2.position[1] - p1.position[1];
      const dz = p2.position[2] - p1.position[2];
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) || 0.001;
      const diff = (dist - spring.restLength) / dist;
      const stiffness = spring.stiffness * this.elasticity;
      if (!p1.pinned) {
        p1.position[0] += dx * 0.5 * diff * stiffness;
        p1.position[1] += dy * 0.5 * diff * stiffness;
        p1.position[2] += dz * 0.5 * diff * stiffness;
      }
      if (!p2.pinned) {
        p2.position[0] -= dx * 0.5 * diff * stiffness;
        p2.position[1] -= dy * 0.5 * diff * stiffness;
        p2.position[2] -= dz * 0.5 * diff * stiffness;
      }
    }

    addSpring(a, b, stiffness = 0.5) {
      const p1 = this.particles[a], p2 = this.particles[b];
      const dx = p1.originalPosition[0] - p2.originalPosition[0];
      const dy = p1.originalPosition[1] - p2.originalPosition[1];
      const dz = p1.originalPosition[2] - p2.originalPosition[2];
      this.springs.push({ a, b, restLength: Math.sqrt(dx*dx+dy*dy+dz*dz), stiffness });
    }

    pinParticle(index) { if (this.particles[index]) this.particles[index].pinned = true; }
    unpinParticle(index) { if (this.particles[index]) this.particles[index].pinned = false; }
    getParticlePosition(index) { return this.particles[index] ? [...this.particles[index].position] : null; }
    getJiggleOffset(index) {
      const p = this.particles[index];
      if (!p) return [0, 0, 0];
      return [p.position[0] - p.originalPosition[0], p.position[1] - p.originalPosition[1], p.position[2] - p.originalPosition[2]];
    }
    setElasticity(v) { this.elasticity = v; }
    setDamping(v) { this.damping = v; }
    setGravity(x, y, z) { this.gravity = [x, y, z]; }
    setWindStrength(v) { this.windStrength = v; }
    applyForce(index, force) {
      const p = this.particles[index];
      if (p && !p.pinned) {
        p.position[0] += force[0] / p.mass;
        p.position[1] += force[1] / p.mass;
        p.position[2] += force[2] / p.mass;
      }
    }
    reset() {
      for (const p of this.particles) {
        p.position = [...p.originalPosition];
        p.prevPosition = [...p.originalPosition];
        p.velocity = [0, 0, 0];
      }
    }
    dispose() {
      this.particles = [];
      this.springs = [];
      this.jiggleZones.clear();
      this.initialized = false;
    }
  }

  // ============================================================
  // 皮肤形态目标系统
  // ============================================================
  class SkinMorph {
    constructor() {
      this.morphTargets = new Map();
      this.morphWeights = new Map();
      this.targetWeights = new Map();
      this.vertexCount = 0;
      this.blendedOffsets = null;
      this.blendSpeed = 8;
      this.initialized = false;
      this.currentExpression = 'neutral';
      this.expressionHistory = [];
    }

    init(vertexCount) {
      this.vertexCount = vertexCount;
      this.blendedOffsets = new Float32Array(vertexCount * 3);
      this.initialized = true;
    }

    addMorphTarget(name, offsets, influence = null) {
      this.morphTargets.set(name, {
        offsets: new Float32Array(offsets),
        influence: influence ? new Float32Array(influence) : null,
        weight: 0
      });
      this.morphWeights.set(name, 0);
      this.targetWeights.set(name, 0);
    }

    setMorphWeight(name, weight) {
      if (this.morphTargets.has(name)) {
        this.targetWeights.set(name, Math.max(0, Math.min(1, weight)));
      }
    }

    getMorphWeight(name) { return this.morphWeights.get(name) || 0; }

    setExpression(expression, morphWeights) {
      this.currentExpression = expression;
      this.expressionHistory.push({ expression, time: Date.now() });
      if (this.expressionHistory.length > 50) this.expressionHistory.shift();
      for (const [name, weight] of Object.entries(morphWeights)) {
        this.setMorphWeight(name, weight);
      }
    }

    update(dt) {
      if (!this.initialized) return;
      for (const [name, target] of this.targetWeights) {
        const current = this.morphWeights.get(name) || 0;
        const newWeight = current + (target - current) * Math.min(1, dt * this.blendSpeed);
        this.morphWeights.set(name, newWeight);
        const morph = this.morphTargets.get(name);
        if (morph) morph.weight = newWeight;
      }
      this.blendedOffsets.fill(0);
      for (const [name, morph] of this.morphTargets) {
        const weight = this.morphWeights.get(name) || 0;
        if (weight < 0.001) continue;
        for (let i = 0; i < this.vertexCount * 3; i++) {
          const influence = morph.influence ? morph.influence[i] : 1;
          this.blendedOffsets[i] += morph.offsets[i] * weight * influence;
        }
      }
    }

    getBlendedOffsets() { return this.blendedOffsets; }
    getMorphTarget(name) { return this.morphTargets.get(name); }
    getMorphNames() { return Array.from(this.morphTargets.keys()); }
    getActiveMorphs(threshold = 0.01) {
      const active = [];
      for (const [name, weight] of this.morphWeights) {
        if (weight > threshold) active.push({ name, weight });
      }
      return active;
    }
    getCurrentExpression() { return this.currentExpression; }
    getExpressionHistory() { return [...this.expressionHistory]; }
    setBlendSpeed(v) { this.blendSpeed = v; }
    reset() {
      for (const name of this.morphWeights.keys()) {
        this.morphWeights.set(name, 0);
        this.targetWeights.set(name, 0);
      }
      if (this.blendedOffsets) this.blendedOffsets.fill(0);
      this.currentExpression = 'neutral';
    }
    dispose() {
      this.morphTargets.clear();
      this.morphWeights.clear();
      this.targetWeights.clear();
      this.blendedOffsets = null;
      this.initialized = false;
    }
  }

  // ============================================================
  // 皮肤颜色系统
  // ============================================================
  class SkinColor {
    constructor() {
      this.baseColor = [0.85, 0.65, 0.55];
      this.tone = 0.5;
      this.blush = 0;
      this.blushColor = [1.0, 0.5, 0.5];
      this.sunTan = 0;
      this.tanColor = [0.7, 0.5, 0.35];
      this.pallor = 0;
      this.pallorColor = [0.9, 0.85, 0.8];
      this.brightness = 1.0;
      this.contrast = 1.0;
      this.saturation = 1.0;
      this.hueShift = 0;
      this.warmth = 0.5;
      this.undertone = 'neutral';
      this.ageSpots = 0;
      this.freckles = 0;
      this.veins = 0;
      this.redness = 0;
      this.yellowness = 0;
      this.oiliness = 0.3;
      this.dryness = 0.2;
      this.sensitivity = 0.2;
    }

    setBaseColor(r, g, b) { this.baseColor = [r, g, b]; }
    setTone(v) { this.tone = Math.max(0, Math.min(1, v)); }
    setBlush(v) { this.blush = Math.max(0, Math.min(1, v)); }
    setSunTan(v) { this.sunTan = Math.max(0, Math.min(1, v)); }
    setPallor(v) { this.pallor = Math.max(0, Math.min(1, v)); }
    setBrightness(v) { this.brightness = Math.max(0, Math.min(2, v)); }
    setContrast(v) { this.contrast = Math.max(0, Math.min(2, v)); }
    setSaturation(v) { this.saturation = Math.max(0, Math.min(2, v)); }
    setHueShift(v) { this.hueShift = v; }
    setWarmth(v) { this.warmth = Math.max(0, Math.min(1, v)); }
    setUndertone(t) { if (['warm', 'cool', 'neutral'].includes(t)) this.undertone = t; }
    setRedness(v) { this.redness = Math.max(0, Math.min(1, v)); }
    setYellowness(v) { this.yellowness = Math.max(0, Math.min(1, v)); }
    setOiliness(v) { this.oiliness = Math.max(0, Math.min(1, v)); }
    setDryness(v) { this.dryness = Math.max(0, Math.min(1, v)); }

    getColor() {
      let color = [...this.baseColor];
      const toneFactor = this.tone * 0.3 - 0.15;
      color = color.map(c => c + toneFactor);
      if (this.sunTan > 0) {
        color = color.map((c, i) => c * (1 - this.sunTan) + this.tanColor[i] * this.sunTan);
      }
      if (this.pallor > 0) {
        color = color.map((c, i) => c * (1 - this.pallor) + this.pallorColor[i] * this.pallor);
      }
      if (this.redness > 0) {
        color[0] = color[0] * (1 + this.redness * 0.3);
        color[1] = color[1] * (1 - this.redness * 0.1);
        color[2] = color[2] * (1 - this.redness * 0.1);
      }
      if (this.yellowness > 0) {
        color[0] = color[0] * (1 + this.yellowness * 0.1);
        color[1] = color[1] * (1 + this.yellowness * 0.1);
        color[2] = color[2] * (1 - this.yellowness * 0.15);
      }
      if (this.undertone === 'warm') {
        color[0] += 0.02; color[1] += 0.01; color[2] -= 0.02;
      } else if (this.undertone === 'cool') {
        color[0] -= 0.02; color[1] += 0.01; color[2] += 0.02;
      }
      color = color.map(c => c * this.brightness);
      color = color.map(c => (c - 0.5) * this.contrast + 0.5);
      const gray = color.reduce((a, b) => a + b, 0) / 3;
      color = color.map(c => gray + (c - gray) * this.saturation);
      if (this.hueShift !== 0) {
        const hsl = this._rgbToHsl(color[0], color[1], color[2]);
        hsl[0] = (hsl[0] + this.hueShift) % 1;
        color = this._hslToRgb(hsl[0], hsl[1], hsl[2]);
      }
      return color.map(c => Math.max(0, Math.min(1, c)));
    }

    getBlushColor() {
      return this.blushColor.map(c => c * this.blush);
    }

    _rgbToHsl(r, g, b) {
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h, s, l = (max + min) / 2;
      if (max === min) { h = s = 0; }
      else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = (g - b) / d + (g < b ? 6 : 0); break;
          case g: h = (b - r) / d + 2; break;
          case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
      }
      return [h, s, l];
    }

    _hslToRgb(h, s, l) {
      let r, g, b;
      if (s === 0) { r = g = b = l; }
      else {
        const hue2rgb = (p, q, t) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1/6) return p + (q - p) * 6 * t;
          if (t < 1/2) return q;
          if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
          return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
      }
      return [r, g, b];
    }

    adjustHSL(h, s, l) {
      const current = this._rgbToHsl(this.baseColor[0], this.baseColor[1], this.baseColor[2]);
      const newHsl = [(current[0] + h) % 1, Math.max(0, Math.min(1, current[1] + s)), Math.max(0, Math.min(1, current[2] + l))];
      this.baseColor = this._hslToRgb(newHsl[0], newHsl[1], newHsl[2]);
    }

    getSkinType() {
      const luminance = this.baseColor[0] * 0.299 + this.baseColor[1] * 0.587 + this.baseColor[2] * 0.114;
      if (luminance > 0.8) return 'fair';
      if (luminance > 0.65) return 'light';
      if (luminance > 0.5) return 'medium';
      if (luminance > 0.35) return 'tan';
      return 'dark';
    }

    clone() {
      const color = new SkinColor();
      Object.assign(color, JSON.parse(JSON.stringify(this)));
      return color;
    }

    reset() {
      this.baseColor = [0.85, 0.65, 0.55];
      this.tone = 0.5;
      this.blush = 0;
      this.sunTan = 0;
      this.pallor = 0;
      this.brightness = 1.0;
      this.contrast = 1.0;
      this.saturation = 1.0;
      this.hueShift = 0;
      this.redness = 0;
      this.yellowness = 0;
    }
  }

  // ============================================================
  // 皮肤妆容系统
  // ============================================================
  class SkinMakeup {
    constructor() {
      this.foundation = { enabled: false, color: [0.9, 0.75, 0.65], coverage: 0.5, dewy: 0.5 };
      this.concealer = { enabled: false, color: [0.95, 0.8, 0.7], coverage: 0.7, area: 'under_eye' };
      this.powder = { enabled: false, color: [1, 0.95, 0.9], coverage: 0.3, matte: 0.8 };
      this.blush = { enabled: false, color: [1, 0.5, 0.5], intensity: 0.5, position: 'apple', style: 'natural' };
      this.eyeshadow = { enabled: false, colors: [[0.8, 0.7, 0.6], [0.6, 0.4, 0.5], [0.3, 0.2, 0.3]], intensity: 0.6, style: 'smoky' };
      this.eyeliner = { enabled: false, color: [0.1, 0.1, 0.1], thickness: 0.3, style: 'winged', wingLength: 0.5 };
      this.mascara = { enabled: false, color: [0.05, 0.05, 0.05], volume: 0.5, length: 0.5, curl: 0.3 };
      this.eyebrows = { enabled: false, color: [0.3, 0.2, 0.15], thickness: 0.4, arch: 0.5, style: 'natural' };
      this.lipstick = { enabled: false, color: [0.8, 0.2, 0.3], intensity: 0.8, finish: 'matte', gloss: 0.2, liner: [0.6, 0.1, 0.2] };
      this.highlighter = { enabled: false, color: [1, 0.95, 0.9], intensity: 0.5, areas: ['cheekbone', 'nose', 'cupids_bow'] };
      this.contour = { enabled: false, color: [0.5, 0.35, 0.25], intensity: 0.4, areas: ['cheek', 'jawline', 'nose'] };
      this.makeupIntensity = 1.0;
      this.lookName = 'natural';
      this.presets = new Map();
    }

    setFoundation(options) { Object.assign(this.foundation, options); this.foundation.enabled = true; }
    setConcealer(options) { Object.assign(this.concealer, options); this.concealer.enabled = true; }
    setPowder(options) { Object.assign(this.powder, options); this.powder.enabled = true; }
    setBlush(options) { Object.assign(this.blush, options); this.blush.enabled = true; }
    setEyeshadow(options) { Object.assign(this.eyeshadow, options); this.eyeshadow.enabled = true; }
    setEyeliner(options) { Object.assign(this.eyeliner, options); this.eyeliner.enabled = true; }
    setMascara(options) { Object.assign(this.mascara, options); this.mascara.enabled = true; }
    setEyebrows(options) { Object.assign(this.eyebrows, options); this.eyebrows.enabled = true; }
    setLipstick(options) { Object.assign(this.lipstick, options); this.lipstick.enabled = true; }
    setHighlighter(options) { Object.assign(this.highlighter, options); this.highlighter.enabled = true; }
    setContour(options) { Object.assign(this.contour, options); this.contour.enabled = true; }

    applyPreset(name) {
      const preset = this.presets.get(name);
      if (preset) {
        Object.assign(this, JSON.parse(JSON.stringify(preset)));
        this.lookName = name;
      }
    }

    savePreset(name) {
      this.presets.set(name, JSON.parse(JSON.stringify(this)));
      this.lookName = name;
    }

    getMakeupLayers() {
      const layers = [];
      if (this.foundation.enabled) layers.push({ type: 'foundation', ...this.foundation, order: 0 });
      if (this.concealer.enabled) layers.push({ type: 'concealer', ...this.concealer, order: 1 });
      if (this.powder.enabled) layers.push({ type: 'powder', ...this.powder, order: 2 });
      if (this.contour.enabled) layers.push({ type: 'contour', ...this.contour, order: 3 });
      if (this.blush.enabled) layers.push({ type: 'blush', ...this.blush, order: 4 });
      if (this.highlighter.enabled) layers.push({ type: 'highlighter', ...this.highlighter, order: 5 });
      if (this.eyeshadow.enabled) layers.push({ type: 'eyeshadow', ...this.eyeshadow, order: 6 });
      if (this.eyeliner.enabled) layers.push({ type: 'eyeliner', ...this.eyeliner, order: 7 });
      if (this.mascara.enabled) layers.push({ type: 'mascara', ...this.mascara, order: 8 });
      if (this.eyebrows.enabled) layers.push({ type: 'eyebrows', ...this.eyebrows, order: 9 });
      if (this.lipstick.enabled) layers.push({ type: 'lipstick', ...this.lipstick, order: 10 });
      return layers.sort((a, b) => a.order - b.order).map(l => ({ ...l, intensity: l.intensity !== undefined ? l.intensity * this.makeupIntensity : this.makeupIntensity }));
    }

    setMakeupIntensity(v) { this.makeupIntensity = Math.max(0, Math.min(1, v)); }
    getLookName() { return this.lookName; }
    getPresetNames() { return Array.from(this.presets.keys()); }
    removeMakeup() {
      for (const key of Object.keys(this)) {
        if (this[key] && typeof this[key] === 'object' && 'enabled' in this[key]) {
          this[key].enabled = false;
        }
      }
      this.lookName = 'none';
    }
    clone() {
      const makeup = new SkinMakeup();
      Object.assign(makeup, JSON.parse(JSON.stringify(this)));
      return makeup;
    }
  }

  // ============================================================
  // 皮肤湿度系统
  // ============================================================
  class SkinWetness {
    constructor() {
      this.wetness = 0;
      this.targetWetness = 0;
      this.sweatRate = 0;
      this.sweatAccumulation = 0;
      this.waterDroplets = [];
      this.maxDroplets = 200;
      this.wetMap = null;
      this.vertexCount = 0;
      this.dryingRate = 0.1;
      this.spreadRate = 0.5;
      this.initialized = false;
      this.time = 0;
      this.sweatZones = {
        forehead: 0.8,
        nose: 0.6,
        upper_lip: 0.5,
        chin: 0.4,
        neck: 0.7,
        chest: 0.6,
        back: 0.5,
        armpits: 0.9
      };
    }

    init(vertexCount) {
      this.vertexCount = vertexCount;
      this.wetMap = new Float32Array(vertexCount);
      this.initialized = true;
    }

    setWetness(v) { this.targetWetness = Math.max(0, Math.min(1, v)); }
    setSweatRate(v) { this.sweatRate = Math.max(0, v); }

    update(dt, uvs = null) {
      if (!this.initialized) return;
      this.time += dt;
      this.wetness += (this.targetWetness - this.wetness) * Math.min(1, dt * 2);
      this.sweatAccumulation += this.sweatRate * dt;
      if (this.sweatAccumulation > 0.01) {
        this.wetness = Math.min(1, this.wetness + this.sweatAccumulation * 0.1);
        this.sweatAccumulation = 0;
      }
      if (this.wetness > 0 && this.targetWetness < this.wetness) {
        this.wetness = Math.max(0, this.wetness - this.dryingRate * dt);
      }
      for (let i = 0; i < this.vertexCount; i++) {
        let zoneFactor = 0.3;
        if (uvs) {
          const u = uvs[i * 2], v = uvs[i * 2 + 1];
          if (v > 0.7) zoneFactor = this.sweatZones.forehead;
          else if (v > 0.55) zoneFactor = this.sweatZones.nose;
          else if (v > 0.45) zoneFactor = this.sweatZones.upper_lip;
          else if (v > 0.35) zoneFactor = this.sweatZones.chin;
          else zoneFactor = 0.3;
        }
        const target = this.wetness * zoneFactor;
        this.wetMap[i] += (target - this.wetMap[i]) * Math.min(1, dt * this.spreadRate);
      }
      this._updateDroplets(dt);
    }

    _updateDroplets(dt) {
      if (this.wetness > 0.3 && this.waterDroplets.length < this.maxDroplets && Math.random() < this.wetness * 0.1) {
        this.waterDroplets.push({
          x: Math.random(),
          y: Math.random(),
          size: Math.random() * 0.02 + 0.005,
          speed: Math.random() * 0.05 + 0.02,
          opacity: Math.random() * 0.5 + 0.5,
          life: 1
        });
      }
      for (let i = this.waterDroplets.length - 1; i >= 0; i--) {
        const d = this.waterDroplets[i];
        d.y -= d.speed * dt;
        d.life -= dt * 0.2;
        if (d.y < 0 || d.life <= 0) this.waterDroplets.splice(i, 1);
      }
    }

    applyWater(amount = 0.5) {
      this.targetWetness = Math.min(1, this.targetWetness + amount);
      for (let i = 0; i < 20; i++) {
        this.waterDroplets.push({
          x: Math.random(), y: Math.random(),
          size: Math.random() * 0.03 + 0.01,
          speed: Math.random() * 0.1 + 0.05,
          opacity: Math.random() * 0.5 + 0.5,
          life: 1
        });
      }
    }

    dry(amount = 0.3) {
      this.targetWetness = Math.max(0, this.targetWetness - amount);
    }

    getWetMap() { return this.wetMap; }
    getWetness() { return this.wetness; }
    getDroplets() { return [...this.waterDroplets]; }
    getSpecularBoost() { return this.wetness * 0.8; }
    getRoughnessReduction() { return this.wetness * 0.5; }
    setDryingRate(v) { this.dryingRate = v; }
    setSpreadRate(v) { this.spreadRate = v; }
    reset() {
      this.wetness = 0;
      this.targetWetness = 0;
      this.sweatRate = 0;
      this.sweatAccumulation = 0;
      this.waterDroplets = [];
      if (this.wetMap) this.wetMap.fill(0);
    }
    dispose() {
      this.wetMap = null;
      this.waterDroplets = [];
      this.initialized = false;
    }
  }

  // ============================================================
  // 皮肤老化系统
  // ============================================================
  class SkinAging {
    constructor() {
      this.age = 20;
      this.targetAge = 20;
      this.agingIntensity = 0;
      this.wrinkleMap = null;
      this.saggingMap = null;
      this.ageSpots = [];
      this.vertexCount = 0;
      this.initialized = false;
      this.wrinkleZones = {
        forehead: { intensity: 0.8, direction: 'horizontal', frequency: 8 },
        crow_feet: { intensity: 0.7, direction: 'radial', frequency: 6 },
        smile_lines: { intensity: 0.6, direction: 'vertical', frequency: 4 },
        frown_lines: { intensity: 0.5, direction: 'vertical', frequency: 3 },
        neck: { intensity: 0.7, direction: 'horizontal', frequency: 5 },
        under_eye: { intensity: 0.6, direction: 'curved', frequency: 4 }
      };
    }

    init(vertexCount) {
      this.vertexCount = vertexCount;
      this.wrinkleMap = new Float32Array(vertexCount);
      this.saggingMap = new Float32Array(vertexCount * 3);
      this.initialized = true;
      this._generateAgeSpots();
    }

    setAge(age) {
      this.targetAge = Math.max(0, age);
    }

    update(dt, uvs = null) {
      if (!this.initialized) return;
      this.age += (this.targetAge - this.age) * Math.min(1, dt * 0.5);
      this.agingIntensity = Math.max(0, (this.age - 20) / 60);
      for (let i = 0; i < this.vertexCount; i++) {
        let wrinkle = 0;
        let sagX = 0, sagY = 0, sagZ = 0;
        if (uvs) {
          const u = uvs[i * 2], v = uvs[i * 2 + 1];
          if (v > 0.7) {
            const zone = this.wrinkleZones.forehead;
            wrinkle += Math.sin(u * zone.frequency * Math.PI * 2) * zone.intensity * (v - 0.7) * 3;
          }
          if (u < 0.3 && v > 0.4 && v < 0.6) {
            const zone = this.wrinkleZones.crow_feet;
            const dist = Math.sqrt((u - 0.15) ** 2 + (v - 0.5) ** 2);
            wrinkle += Math.sin(dist * zone.frequency * Math.PI) * zone.intensity * Math.max(0, 1 - dist * 5);
          }
          if (u > 0.35 && u < 0.65 && v > 0.35 && v < 0.5) {
            const zone = this.wrinkleZones.smile_lines;
            wrinkle += Math.sin((u - 0.5) * zone.frequency * Math.PI) * zone.intensity * Math.abs(v - 0.42) * 5;
          }
          if (v < 0.3) {
            sagY -= this.agingIntensity * 0.02 * (0.3 - v) * 3;
          }
          if (u > 0.6 && v > 0.3 && v < 0.6) {
            sagX -= this.agingIntensity * 0.01;
            sagY -= this.agingIntensity * 0.015;
          }
        }
        this.wrinkleMap[i] = Math.max(0, wrinkle) * this.agingIntensity;
        this.saggingMap[i * 3] = sagX;
        this.saggingMap[i * 3 + 1] = sagY;
        this.saggingMap[i * 3 + 2] = sagZ;
      }
    }

    _generateAgeSpots() {
      this.ageSpots = [];
      const count = Math.floor(this.agingIntensity * 50);
      for (let i = 0; i < count; i++) {
        this.ageSpots.push({
          u: Math.random(),
          v: Math.random(),
          size: Math.random() * 0.03 + 0.01,
          color: [0.4 + Math.random() * 0.2, 0.3 + Math.random() * 0.15, 0.2 + Math.random() * 0.1],
          intensity: Math.random() * 0.5 + 0.3
        });
      }
    }

    getWrinkleMap() { return this.wrinkleMap; }
    getSaggingMap() { return this.saggingMap; }
    getAgeSpots() { return [...this.ageSpots]; }
    getAge() { return this.age; }
    getAgingIntensity() { return this.agingIntensity; }
    getElasticity() { return Math.max(0.2, 1 - this.agingIntensity * 0.5); }
    getCollagenLevel() { return Math.max(0.3, 1 - this.agingIntensity * 0.6); }
    setAgingIntensity(v) { this.agingIntensity = Math.max(0, Math.min(1, v)); }
    reset() {
      this.age = 20;
      this.targetAge = 20;
      this.agingIntensity = 0;
      if (this.wrinkleMap) this.wrinkleMap.fill(0);
      if (this.saggingMap) this.saggingMap.fill(0);
      this.ageSpots = [];
    }
    dispose() {
      this.wrinkleMap = null;
      this.saggingMap = null;
      this.ageSpots = [];
      this.initialized = false;
    }
  }

  // ============================================================
  // 皮肤定制器
  // ============================================================
  class SkinCustomizer {
    constructor() {
      this.material = new SkinMaterial();
      this.texture = new SkinTexture();
      this.shader = new SkinShader();
      this.color = new SkinColor();
      this.makeup = new SkinMakeup();
      this.deformation = new SkinDeformation();
      this.physics = new SkinPhysics();
      this.morph = new SkinMorph();
      this.wetness = new SkinWetness();
      this.aging = new SkinAging();
      this.presets = new Map();
      this.currentPreset = 'default';
      this.vertexCount = 0;
      this.initialized = false;
    }

    init(vertexCount) {
      this.vertexCount = vertexCount;
      this.deformation.init(vertexCount);
      this.morph.init(vertexCount);
      this.wetness.init(vertexCount);
      this.aging.init(vertexCount);
      this.shader.compile();
      this.initialized = true;
      this._createDefaultPresets();
    }

    _createDefaultPresets() {
      const fair = this.exportConfig();
      fair.color.baseColor = [0.95, 0.8, 0.7];
      fair.color.tone = 0.3;
      this.presets.set('fair', fair);
      const light = this.exportConfig();
      light.color.baseColor = [0.85, 0.68, 0.55];
      light.color.tone = 0.5;
      this.presets.set('light', light);
      const medium = this.exportConfig();
      medium.color.baseColor = [0.75, 0.55, 0.4];
      medium.color.tone = 0.65;
      this.presets.set('medium', medium);
      const tan = this.exportConfig();
      tan.color.baseColor = [0.65, 0.45, 0.3];
      tan.color.tone = 0.8;
      this.presets.set('tan', tan);
      const dark = this.exportConfig();
      dark.color.baseColor = [0.45, 0.3, 0.2];
      dark.color.tone = 0.95;
      this.presets.set('dark', dark);
    }

    loadPreset(name) {
      const preset = this.presets.get(name);
      if (preset) {
        this.importConfig(preset);
        this.currentPreset = name;
      }
    }

    savePreset(name) {
      this.presets.set(name, this.exportConfig());
      this.currentPreset = name;
    }

    randomize() {
      this.color.setBaseColor(
        0.6 + Math.random() * 0.35,
        0.45 + Math.random() * 0.35,
        0.35 + Math.random() * 0.3
      );
      this.color.setTone(0.3 + Math.random() * 0.6);
      this.material.setRoughness(0.4 + Math.random() * 0.4);
      this.material.setSSS({ intensity: 0.5 + Math.random() * 0.5 });
      this.aging.setAge(18 + Math.random() * 40);
      this.currentPreset = 'random';
    }

    exportConfig() {
      return {
        material: JSON.parse(JSON.stringify(this.material)),
        color: JSON.parse(JSON.stringify(this.color)),
        makeup: JSON.parse(JSON.stringify(this.makeup)),
        shader: { quality: this.shader.quality, features: { ...this.shader.features } },
        wetness: { wetness: this.wetness.wetness, sweatRate: this.wetness.sweatRate },
        aging: { age: this.aging.age, agingIntensity: this.aging.agingIntensity }
      };
    }

    importConfig(config) {
      if (config.material) Object.assign(this.material, config.material);
      if (config.color) Object.assign(this.color, config.color);
      if (config.makeup) Object.assign(this.makeup, config.makeup);
      if (config.shader) {
        this.shader.setQuality(config.shader.quality || 'high');
        if (config.shader.features) {
          for (const [name, enabled] of Object.entries(config.shader.features)) {
            this.shader.toggleFeature(name, enabled);
          }
        }
      }
      if (config.wetness) {
        this.wetness.setWetness(config.wetness.wetness || 0);
        this.wetness.setSweatRate(config.wetness.sweatRate || 0);
      }
      if (config.aging) {
        this.aging.setAge(config.aging.age || 20);
        this.aging.setAgingIntensity(config.aging.agingIntensity || 0);
      }
    }

    update(dt, vertices, uvs, normals) {
      if (!this.initialized) return;
      this.color.update ? this.color.update(dt) : null;
      this.deformation.update(dt, vertices, uvs, normals);
      this.physics.update(dt);
      this.morph.update(dt);
      this.wetness.update(dt, uvs);
      this.aging.update(dt, uvs);
    }

    getFinalMaterial() {
      const uniforms = this.material.getUniforms();
      uniforms.diffuseColor = this.color.getColor();
      uniforms.roughness = Math.max(0.04, this.material.roughness - this.wetness.getRoughnessReduction());
      uniforms.specularIntensity = this.material.specularIntensity + this.wetness.getSpecularBoost();
      return uniforms;
    }

    getVertexDisplacement() {
      if (!this.initialized) return null;
      const displacement = new Float32Array(this.vertexCount * 3);
      for (let i = 0; i < this.vertexCount * 3; i++) {
        displacement[i] = (this.deformation.vertexOffsets?.[i] || 0)
          + (this.morph.blendedOffsets?.[i] || 0)
          + (this.aging.saggingMap?.[i] || 0);
      }
      return displacement;
    }

    getPresetNames() { return Array.from(this.presets.keys()); }
    getCurrentPreset() { return this.currentPreset; }
    isInitialized() { return this.initialized; }
    dispose() {
      this.material.dispose();
      this.texture.dispose();
      this.shader.dispose();
      this.deformation.dispose();
      this.physics.dispose();
      this.morph.dispose();
      this.wetness.dispose();
      this.aging.dispose();
      this.initialized = false;
    }
  }

  return {
    SkinMaterial, SkinTexture, SkinShader, SkinDeformation, SkinPhysics,
    SkinMorph, SkinColor, SkinMakeup, SkinWetness, SkinAging, SkinCustomizer
  };
})();

if (typeof window !== 'undefined') window.SpiritSkin = SpiritSkin;
if (typeof globalThis !== 'undefined') globalThis.SpiritSkin = SpiritSkin;
