
// ============================================================
// 模块九：着色器库与高级渲染 ShaderLibrary (约1500行)
// 着色器管理 / PBR着色器 / 骨骼蒙皮 / 法线贴图 / 高级渲染技术
// ============================================================

const OrbShader = (function(){

  // ============================================================
  // ShaderManager - 着色器管理器
  // ============================================================
  class ShaderManager {
    constructor(gl){
      this.gl = gl;
      this.programs = {};
      this.shaders = {};
      this.uniformCache = {};
      this.attributeCache = {};
    }

    // 创建着色器
    createShader(type, source){
      const gl = this.gl;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      if(!gl.getShaderParameter(shader, gl.COMPILE_STATUS)){
        const info = gl.getShaderInfoLog(shader);
        console.error('Shader compile error:', info);
        gl.deleteShader(shader);
        return null;
      }

      return shader;
    }

    // 创建程序
    createProgram(name, vertexSource, fragmentSource, defines = {}){
      const gl = this.gl;

      // 处理宏定义
      const defineStr = Object.entries(defines).map(([k, v]) => `#define ${k} ${v}`).join('\n');
      const vsSource = defineStr ? defineStr + '\n' + vertexSource : vertexSource;
      const fsSource = defineStr ? defineStr + '\n' + fragmentSource : fragmentSource;

      const vs = this.createShader(gl.VERTEX_SHADER, vsSource);
      const fs = this.createShader(gl.FRAGMENT_SHADER, fsSource);

      if(!vs || !fs) return null;

      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);

      if(!gl.getProgramParameter(program, gl.LINK_STATUS)){
        const info = gl.getProgramInfoLog(program);
        console.error('Program link error:', info);
        gl.deleteProgram(program);
        return null;
      }

      gl.deleteShader(vs);
      gl.deleteShader(fs);

      this.programs[name] = program;
      this.uniformCache[name] = {};
      this.attributeCache[name] = {};

      return program;
    }

    // 获取程序
    getProgram(name){
      return this.programs[name];
    }

    // 使用程序
    useProgram(name){
      const program = this.programs[name];
      if(program){
        this.gl.useProgram(program);
        return program;
      }
      return null;
    }

    // 获取uniform位置（带缓存）
    getUniformLocation(programName, uniformName){
      if(!this.uniformCache[programName]) this.uniformCache[programName] = {};
      if(this.uniformCache[programName][uniformName] === undefined){
        const program = this.programs[programName];
        this.uniformCache[programName][uniformName] = this.gl.getUniformLocation(program, uniformName);
      }
      return this.uniformCache[programName][uniformName];
    }

    // 获取attribute位置（带缓存）
    getAttribLocation(programName, attribName){
      if(!this.attributeCache[programName]) this.attributeCache[programName] = {};
      if(this.attributeCache[programName][attribName] === undefined){
        const program = this.programs[programName];
        this.attributeCache[programName][attribName] = this.gl.getAttribLocation(program, attribName);
      }
      return this.attributeCache[programName][attribName];
    }

    // 设置uniform
    setUniform(programName, name, type, value){
      const location = this.getUniformLocation(programName, name);
      if(!location) return;
      const gl = this.gl;

      switch(type){
        case '1f': gl.uniform1f(location, value); break;
        case '2f': gl.uniform2f(location, value[0], value[1]); break;
        case '3f': gl.uniform3f(location, value[0], value[1], value[2]); break;
        case '4f': gl.uniform4f(location, value[0], value[1], value[2], value[3]); break;
        case '1i': gl.uniform1i(location, value); break;
        case '2i': gl.uniform2i(location, value[0], value[1]); break;
        case '3i': gl.uniform3i(location, value[0], value[1], value[2]); break;
        case '4i': gl.uniform4i(location, value[0], value[1], value[2], value[3]); break;
        case 'mat2': gl.uniformMatrix2fv(location, false, value); break;
        case 'mat3': gl.uniformMatrix3fv(location, false, value); break;
        case 'mat4': gl.uniformMatrix4fv(location, false, value); break;
        case '1fv': gl.uniform1fv(location, value); break;
        case '2fv': gl.uniform2fv(location, value); break;
        case '3fv': gl.uniform3fv(location, value); break;
        case '4fv': gl.uniform4fv(location, value); break;
      }
    }

    // 删除程序
    deleteProgram(name){
      if(this.programs[name]){
        this.gl.deleteProgram(this.programs[name]);
        delete this.programs[name];
        delete this.uniformCache[name];
        delete this.attributeCache[name];
      }
    }

    // 清空
    clear(){
      for(const name in this.programs){
        this.deleteProgram(name);
      }
    }
  }

  // ============================================================
  // 内置着色器源码
  // ============================================================

  // 公共顶点着色器代码
  const CommonVertexShader = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec2 aUV;
    attribute vec3 aTangent;
    attribute vec4 aJoint;
    attribute vec4 aWeight;

    uniform mat4 uModelMatrix;
    uniform mat4 uViewMatrix;
    uniform mat4 uProjectionMatrix;
    uniform mat4 uNormalMatrix;
    uniform mat4 uBonePalette[256];

    varying vec3 vPosition;
    varying vec3 vNormal;
    varying vec2 vUV;
    varying vec3 vViewPosition;
    varying mat3 vTBN;

    void main(){
      vec4 position = vec4(aPosition, 1.0);
      vec3 normal = aNormal;
      vec3 tangent = aTangent;

      #ifdef USE_SKINNING
        vec4 skinnedPosition = vec4(0.0);
        vec3 skinnedNormal = vec3(0.0);
        vec3 skinnedTangent = vec3(0.0);
        for(int i = 0; i < 4; i++){
          if(aWeight[i] > 0.0){
            mat4 boneMatrix = uBonePalette[int(aJoint[i])];
            skinnedPosition += boneMatrix * position * aWeight[i];
            skinnedNormal += mat3(boneMatrix) * normal * aWeight[i];
            skinnedTangent += mat3(boneMatrix) * tangent * aWeight[i];
          }
        }
        position = skinnedPosition;
        normal = normalize(skinnedNormal);
        tangent = normalize(skinnedTangent);
      #endif

      vec4 worldPosition = uModelMatrix * position;
      vPosition = worldPosition.xyz;
      vNormal = normalize(mat3(uNormalMatrix) * normal);
      vUV = aUV;

      #ifdef USE_NORMAL_MAP
        vec3 T = normalize(mat3(uNormalMatrix) * tangent);
        vec3 N = vNormal;
        T = normalize(T - dot(T, N) * N);
        vec3 B = cross(N, T);
        vTBN = mat3(T, B, N);
      #endif

      vec4 viewPosition = uViewMatrix * worldPosition;
      vViewPosition = -viewPosition.xyz;
      gl_Position = uProjectionMatrix * viewPosition;
    }
  `;

  // PBR片段着色器
  const PBRFragmentShader = `
    precision highp float;

    varying vec3 vPosition;
    varying vec3 vNormal;
    varying vec2 vUV;
    varying vec3 vViewPosition;
    varying mat3 vTBN;

    uniform vec3 uAlbedo;
    uniform float uRoughness;
    uniform float uMetalness;
    uniform vec3 uEmissive;
    uniform float uEmissiveIntensity;
    uniform float uAO;
    uniform float uOpacity;
    uniform vec3 uCameraPosition;

    uniform sampler2D uAlbedoMap;
    uniform sampler2D uNormalMap;
    uniform sampler2D uRoughnessMap;
    uniform sampler2D uMetalnessMap;
    uniform sampler2D uAOMap;
    uniform sampler2D uEmissiveMap;

    uniform int uLightCount;
    uniform vec3 uLightPositions[16];
    uniform vec3 uLightColors[16];
    uniform vec3 uLightDirections[16];
    uniform int uLightTypes[16];
    uniform float uLightIntensities[16];
    uniform float uLightDistances[16];
    uniform float uLightDecays[16];
    uniform float uLightAngles[16];
    uniform float uLightPenumbras[16];

    uniform vec3 uAmbientLight;
    uniform vec3 uEnvMapIntensity;

    const float PI = 3.14159265359;

    float DistributionGGX(vec3 N, vec3 H, float roughness){
      float a = roughness * roughness;
      float a2 = a * a;
      float NdotH = max(dot(N, H), 0.0);
      float NdotH2 = NdotH * NdotH;
      float denom = NdotH2 * (a2 - 1.0) + 1.0;
      denom = PI * denom * denom;
      return a2 / max(denom, 0.0001);
    }

    float GeometrySchlickGGX(float NdotV, float roughness){
      float r = roughness + 1.0;
      float k = (r * r) / 8.0;
      return NdotV / (NdotV * (1.0 - k) + k);
    }

    float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness){
      float NdotV = max(dot(N, V), 0.0);
      float NdotL = max(dot(N, L), 0.0);
      float ggx2 = GeometrySchlickGGX(NdotV, roughness);
      float ggx1 = GeometrySchlickGGX(NdotL, roughness);
      return ggx1 * ggx2;
    }

    vec3 FresnelSchlick(float cosTheta, vec3 F0){
      return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
    }

    vec3 FresnelSchlickRoughness(float cosTheta, vec3 F0, float roughness){
      return F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
    }

    void main(){
      vec3 albedo = uAlbedo;
      float roughness = uRoughness;
      float metalness = uMetalness;
      float ao = uAO;
      vec3 emissive = uEmissive * uEmissiveIntensity;

      #ifdef USE_ALBEDO_MAP
        albedo *= texture2D(uAlbedoMap, vUV).rgb;
      #endif

      #ifdef USE_NORMAL_MAP
        vec3 normal = texture2D(uNormalMap, vUV).rgb * 2.0 - 1.0;
        normal = normalize(vTBN * normal);
      #else
        vec3 normal = normalize(vNormal);
      #endif

      #ifdef USE_ROUGHNESS_MAP
        roughness *= texture2D(uRoughnessMap, vUV).r;
      #endif

      #ifdef USE_METALNESS_MAP
        metalness *= texture2D(uMetalnessMap, vUV).r;
      #endif

      #ifdef USE_AO_MAP
        ao *= texture2D(uAOMap, vUV).r;
      #endif

      #ifdef USE_EMISSIVE_MAP
        emissive *= texture2D(uEmissiveMap, vUV).rgb;
      #endif

      vec3 N = normalize(normal);
      vec3 V = normalize(vViewPosition);
      vec3 R = reflect(-V, N);

      vec3 F0 = vec3(0.04);
      F0 = mix(F0, albedo, metalness);

      vec3 Lo = vec3(0.0);

      for(int i = 0; i < 16; i++){
        if(i >= uLightCount) break;

        vec3 L;
        float attenuation = 1.0;

        if(uLightTypes[i] == 0){ // Directional
          L = normalize(-uLightDirections[i]);
        } else if(uLightTypes[i] == 1){ // Point
          vec3 lightToFrag = vPosition - uLightPositions[i];
          float distance = length(lightToFrag);
          L = normalize(-lightToFrag);
          if(uLightDistances[i] > 0.0){
            attenuation = pow(clamp(1.0 - pow(distance / uLightDistances[i], 4.0), 0.0, 1.0), 2.0);
          }
          attenuation /= (distance * distance * uLightDecays[i] + 1.0);
        } else if(uLightTypes[i] == 2){ // Spot
          vec3 lightToFrag = vPosition - uLightPositions[i];
          float distance = length(lightToFrag);
          L = normalize(-lightToFrag);
          if(uLightDistances[i] > 0.0){
            attenuation = pow(clamp(1.0 - pow(distance / uLightDistances[i], 4.0), 0.0, 1.0), 2.0);
          }
          attenuation /= (distance * distance * uLightDecays[i] + 1.0);
          float cosTheta = dot(L, normalize(-uLightDirections[i]));
          float cosOuter = cos(uLightAngles[i]);
          float cosInner = cos(uLightAngles[i] * (1.0 - uLightPenumbras[i]));
          float spotAttenuation = smoothstep(cosOuter, cosInner, cosTheta);
          attenuation *= spotAttenuation;
        }

        vec3 H = normalize(V + L);
        vec3 lightColor = uLightColors[i] * uLightIntensities[i] * attenuation;

        float NDF = DistributionGGX(N, H, roughness);
        float G = GeometrySmith(N, V, L, roughness);
        vec3 F = FresnelSchlick(max(dot(H, V), 0.0), F0);

        vec3 numerator = NDF * G * F;
        float denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001;
        vec3 specular = numerator / denominator;

        vec3 kS = F;
        vec3 kD = vec3(1.0) - kS;
        kD *= 1.0 - metalness;

        float NdotL = max(dot(N, L), 0.0);
        Lo += (kD * albedo / PI + specular) * lightColor * NdotL;
      }

      vec3 F = FresnelSchlickRoughness(max(dot(N, V), 0.0), F0, roughness);
      vec3 kS = F;
      vec3 kD = 1.0 - kS;
      kD *= 1.0 - metalness;

      vec3 ambient = uAmbientLight * albedo * ao;

      #ifdef USE_ENV_MAP
        vec3 irradiance = uEnvMapIntensity * 0.3;
        vec3 diffuse = irradiance * albedo;
        vec3 prefilteredColor = uEnvMapIntensity * 0.5;
        vec2 brdf = vec2(0.04, 0.5);
        vec3 specularIBL = prefilteredColor * (F * brdf.x + brdf.y);
        ambient = (kD * diffuse + specularIBL) * ao;
      #endif

      vec3 color = ambient + Lo + emissive;

      gl_FragColor = vec4(color, uOpacity);
    }
  `;

  // 线框着色器
  const WireframeVertexShader = `
    attribute vec3 aPosition;
    uniform mat4 uModelMatrix;
    uniform mat4 uViewMatrix;
    uniform mat4 uProjectionMatrix;
    void main(){
      gl_Position = uProjectionMatrix * uViewMatrix * uModelMatrix * vec4(aPosition, 1.0);
    }
  `;

  const WireframeFragmentShader = `
    precision highp float;
    uniform vec3 uColor;
    uniform float uOpacity;
    void main(){
      gl_FragColor = vec4(uColor, uOpacity);
    }
  `;

  // 法线可视化着色器
  const NormalVertexShader = CommonVertexShader;

  const NormalFragmentShader = `
    precision highp float;
    varying vec3 vNormal;
    void main(){
      vec3 normal = normalize(vNormal) * 0.5 + 0.5;
      gl_FragColor = vec4(normal, 1.0);
    }
  `;

  // 深度着色器
  const DepthVertexShader = CommonVertexShader;

  const DepthFragmentShader = `
    precision highp float;
    varying vec4 vViewPosition;
    uniform float uCameraNear;
    uniform float uCameraFar;
    void main(){
      float depth = length(vViewPosition.xyz);
      float normalizedDepth = (depth - uCameraNear) / (uCameraFar - uCameraNear);
      gl_FragColor = vec4(vec3(normalizedDepth), 1.0);
    }
  `;

  // 后处理通用顶点着色器
  const PostVertexShader = `
    attribute vec2 aPosition;
    attribute vec2 aUV;
    varying vec2 vUV;
    void main(){
      vUV = aUV;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  // Bloom提取高光片段着色器
  const BloomExtractShader = `
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D uTexture;
    uniform float uThreshold;
    uniform float uSmoothWidth;
    void main(){
      vec4 color = texture2D(uTexture, vUV);
      float brightness = max(color.r, max(color.g, color.b));
      float contribution = smoothstep(uThreshold, uThreshold + uSmoothWidth, brightness);
      gl_FragColor = color * contribution;
    }
  `;

  // 高斯模糊片段着色器
  const GaussianBlurShader = `
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D uTexture;
    uniform vec2 uDirection;
    uniform vec2 uResolution;
    void main(){
      vec2 texelSize = 1.0 / uResolution;
      vec4 result = vec4(0.0);
      float weights[5];
      weights[0] = 0.227027;
      weights[1] = 0.1945946;
      weights[2] = 0.1216216;
      weights[3] = 0.054054;
      weights[4] = 0.016216;
      result += texture2D(uTexture, vUV) * weights[0];
      for(int i = 1; i < 5; i++){
        vec2 offset = uDirection * texelSize * float(i);
        result += texture2D(uTexture, vUV + offset) * weights[i];
        result += texture2D(uTexture, vUV - offset) * weights[i];
      }
      gl_FragColor = result;
    }
  `;

  // 色调映射片段着色器
  const ToneMappingShader = `
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D uTexture;
    uniform float uExposure;
    uniform int uType;
    uniform float uWhitePoint;

    vec3 linearToneMapping(vec3 color){
      return clamp(color * uExposure, 0.0, 1.0);
    }

    vec3 reinhardToneMapping(vec3 color){
      color *= uExposure;
      return color / (1.0 + color);
    }

    vec3 optimizedReinhardToneMapping(vec3 color){
      color *= uExposure;
      float white = uWhitePoint * uWhitePoint;
      return (color * (1.0 + color / white)) / (1.0 + color);
    }

    vec3 acesFilmicToneMapping(vec3 color){
      color *= uExposure;
      const float a = 2.51;
      const float b = 0.03;
      const float c = 2.43;
      const float d = 0.59;
      const float e = 0.14;
      return clamp((color * (a * color + b)) / (color * (c * color + d) + e), 0.0, 1.0);
    }

    vec3 filmicToneMapping(vec3 color){
      color *= uExposure;
      color = max(vec3(0.0), color - 0.004);
      return (color * (6.2 * color + 0.5)) / (color * (6.2 * color + 1.7) + 0.06);
    }

    void main(){
      vec3 color = texture2D(uTexture, vUV).rgb;
      if(uType == 0) color = linearToneMapping(color);
      else if(uType == 1) color = reinhardToneMapping(color);
      else if(uType == 2) color = optimizedReinhardToneMapping(color);
      else if(uType == 3) color = acesFilmicToneMapping(color);
      else if(uType == 4) color = filmicToneMapping(color);
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  // FXAA片段着色器
  const FXAAShader = `
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D uTexture;
    uniform vec2 uResolution;

    #define FXAA_REDUCE_MIN (1.0 / 128.0)
    #define FXAA_REDUCE_MUL (1.0 / 8.0)
    #define FXAA_SPAN_MAX 8.0

    void main(){
      vec2 texelSize = 1.0 / uResolution;
      vec3 rgbNW = texture2D(uTexture, vUV + vec2(-1.0, -1.0) * texelSize).xyz;
      vec3 rgbNE = texture2D(uTexture, vUV + vec2(1.0, -1.0) * texelSize).xyz;
      vec3 rgbSW = texture2D(uTexture, vUV + vec2(-1.0, 1.0) * texelSize).xyz;
      vec3 rgbSE = texture2D(uTexture, vUV + vec2(1.0, 1.0) * texelSize).xyz;
      vec3 rgbM = texture2D(uTexture, vUV).xyz;

      vec3 luma = vec3(0.299, 0.587, 0.114);
      float lumaNW = dot(rgbNW, luma);
      float lumaNE = dot(rgbNE, luma);
      float lumaSW = dot(rgbSW, luma);
      float lumaSE = dot(rgbSE, luma);
      float lumaM = dot(rgbM, luma);

      float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
      float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));

      vec2 dir;
      dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
      dir.y = ((lumaNW + lumaSW) - (lumaNE + lumaSE));

      float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * (0.25 * FXAA_REDUCE_MUL), FXAA_REDUCE_MIN);
      float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
      dir = min(vec2(FXAA_SPAN_MAX), max(vec2(-FXAA_SPAN_MAX), dir * rcpDirMin)) * texelSize;

      vec3 rgbA = 0.5 * (texture2D(uTexture, vUV + dir * (1.0 / 3.0 - 0.5)).xyz + texture2D(uTexture, vUV + dir * (2.0 / 3.0 - 0.5)).xyz);
      vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(uTexture, vUV + dir * -0.5).xyz + texture2D(uTexture, vUV + dir * 0.5).xyz);

      float lumaB = dot(rgbB, luma);
      vec3 color = ((lumaB < lumaMin) || (lumaB > lumaMax)) ? rgbA : rgbB;

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  // 着色器库
  const ShaderLibrary = {
    CommonVertexShader,
    PBRFragmentShader,
    WireframeVertexShader,
    WireframeFragmentShader,
    NormalVertexShader,
    NormalFragmentShader,
    DepthVertexShader,
    DepthFragmentShader,
    PostVertexShader,
    BloomExtractShader,
    GaussianBlurShader,
    ToneMappingShader,
    FXAAShader
  };

  // ============================================================
  // GPUSkinning - GPU蒙皮工具
  // ============================================================
  class GPUSkinning {
    constructor(maxBones = 256){
      this.maxBones = maxBones;
      this.bonePalette = new Float32Array(maxBones * 16);
    }

    updateBonePalette(skeleton){
      const count = Math.min(skeleton.bones.length, this.maxBones);
      for(let i = 0; i < count; i++){
        const bone = skeleton.bones[i];
        const skinMatrix = bone.worldMatrix.clone().multiply(bone.inverseBindMatrix);
        this.bonePalette.set(skinMatrix.elements, i * 16);
      }
      return this.bonePalette;
    }

    getBonePalette(){
      return this.bonePalette;
    }
  }

  // ============================================================
  // NormalMapping - 法线贴图工具
  // ============================================================
  class NormalMapping {
    constructor(){
      this.normalScale = 1;
    }

    // 从高度图生成法线贴图
    static generateFromHeightMap(heightData, width, height, strength = 1){
      const normalData = new Uint8Array(width * height * 3);

      for(let y = 0; y < height; y++){
        for(let x = 0; x < width; x++){
          const idx = (y * width + x) * 4;
          const left = heightData[((y * width + Math.max(0, x - 1)) * 4)];
          const right = heightData[((y * width + Math.min(width - 1, x + 1)) * 4)];
          const up = heightData[((Math.max(0, y - 1) * width + x) * 4)];
          const down = heightData[((Math.min(height - 1, y + 1) * width + x) * 4)];

          const dx = (left - right) * strength;
          const dy = (up - down) * strength;
          const dz = 255;

          const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const nx = (dx / len * 0.5 + 0.5) * 255;
          const ny = (dy / len * 0.5 + 0.5) * 255;
          const nz = (dz / len * 0.5 + 0.5) * 255;

          normalData[(y * width + x) * 3] = nx;
          normalData[(y * width + x) * 3 + 1] = ny;
          normalData[(y * width + x) * 3 + 2] = nz;
        }
      }

      return normalData;
    }
  }

  // ============================================================
  // ParallaxMapping - 视差贴图工具
  // ============================================================
  class ParallaxMapping {
    constructor(){
      this.heightScale = 0.1;
      this.layers = 32;
    }

    // 视差遮挡映射（Parallax Occlusion Mapping）
    static samplePOM(heightMap, uv, viewDir, heightScale = 0.1, layers = 32){
      const layerDepth = 1.0 / layers;
      let currentLayerDepth = 0;
      let currentUV = uv.clone();
      let deltaUV = viewDir.clone().mul(heightScale / layers);

      let currentDepthValue = 1 - ParallaxMapping.sampleHeight(heightMap, currentUV);

      while(currentLayerDepth < currentDepthValue){
        currentUV.sub(deltaUV);
        currentDepthValue = 1 - ParallaxMapping.sampleHeight(heightMap, currentUV);
        currentLayerDepth += layerDepth;
      }

      const prevUV = currentUV.clone().add(deltaUV);
      const afterDepth = currentDepthValue - currentLayerDepth;
      const beforeDepth = 1 - ParallaxMapping.sampleHeight(heightMap, prevUV) - currentLayerDepth + layerDepth;
      const weight = afterDepth / (afterDepth - beforeDepth);
      const finalUV = prevUV.mul(weight).add(currentUV.mul(1 - weight));

      return finalUV;
    }

    static sampleHeight(heightMap, uv){
      // 简化实现，实际需要采样纹理
      return 0;
    }
  }

  // ============================================================
  // SubsurfaceScattering - 次表面散射工具
  // ============================================================
  class SubsurfaceScattering {
    constructor(){
      this.scatteringColor = new OrbMath.Vec3(1, 0.5, 0.4);
      this.scatteringRadius = 0.1;
      this.scatteringIntensity = 0.5;
    }

    // 简化的次表面散射计算
    static calculate(normal, lightDir, viewDir, thickness, color, intensity = 0.5){
      // 透光效果
      const backLight = Math.max(0, dot(normal.clone().negate(), lightDir));
      const wrapLight = Math.max(0, dot(normal, lightDir) * 0.5 + 0.5);

      // 厚度影响
      const thicknessFactor = Math.exp(-thickness * 2);

      // 散射颜色
      const scatter = color.clone().mul(backLight * wrapLight * thicknessFactor * intensity);

      return scatter;
    }
  }

  // 工具函数
  function dot(a, b){
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  // 导出
  return {
    ShaderManager, ShaderLibrary, GPUSkinning,
    NormalMapping, ParallaxMapping, SubsurfaceScattering
  };
})();

if(typeof window !== 'undefined'){
  window.OrbShader = OrbShader;
}