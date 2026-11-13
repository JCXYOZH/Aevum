/**
 * MrHua 3D灵体渲染引擎 - 扩展模块: orb-extension-pbr-shaders
 * 从 legacy/_orb_expand_part11.js 转换 (GBK->UTF-8)
 * @module orb-extension-pbr-shaders
 */
'use strict';



/* ===== PBR着色器库=====
   支持: 金属度粗糙度/ 法线贴图 / 环境光遮蔽/ IBL
*/
const PBRShaders = {
  vertexShader: `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec2 aUV;
    attribute vec3 aTangent;
    uniform mat4 uModel;
    uniform mat4 uView;
    uniform mat4 uProj;
    uniform mat3 uNormalMatrix;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec2 vUV;
    varying vec3 vTangent;
    varying vec3 vBitangent;
    void main(){
      vec4 worldPos = uModel * vec4(aPosition, 1.0);
      vWorldPos = worldPos.xyz;
      vNormal = normalize(uNormalMatrix * aNormal);
      vTangent = normalize(uNormalMatrix * aTangent);
      vBitangent = cross(vNormal, vTangent);
      vUV = aUV;
      gl_Position = uProj * uView * worldPos;
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec2 vUV;
    varying vec3 vTangent;
    varying vec3 vBitangent;
    uniform sampler2D uAlbedoMap;
    uniform sampler2D uNormalMap;
    uniform sampler2D uMetallicMap;
    uniform sampler2D uRoughnessMap;
    uniform sampler2D uAOMap;
    uniform vec3 uAlbedo;
    uniform float uMetallic;
    uniform float uRoughness;
    uniform float uAO;
    uniform vec3 uCameraPos;
    uniform vec3 uLightPos[4];
    uniform vec3 uLightColor[4];
    uniform int uLightCount;
    uniform samplerCube uEnvMap;
    uniform samplerCube uIrradianceMap;
    uniform float uEnvIntensity;
    const float PI = 3.14159265359;
    vec3 getNormalFromMap(){
      vec3 tangentNormal = texture2D(uNormalMap, vUV).xyz * 2.0 - 1.0;
      mat3 TBN = mat3(normalize(vTangent), normalize(vBitangent), normalize(vNormal));
      return normalize(TBN * tangentNormal);
    }
    float DistributionGGX(vec3 N, vec3 H, float roughness){
      float a = roughness * roughness;
      float a2 = a * a;
      float NdotH = max(dot(N, H), 0.0);
      float NdotH2 = NdotH * NdotH;
      float nom = a2;
      float denom = (NdotH2 * (a2 - 1.0) + 1.0);
      denom = PI * denom * denom;
      return nom / max(denom, 0.0001);
    }
    float GeometrySchlickGGX(float NdotV, float roughness){
      float r = (roughness + 1.0);
      float k = (r * r) / 8.0;
      float nom = NdotV;
      float denom = NdotV * (1.0 - k) + k;
      return nom / max(denom, 0.0001);
    }
    float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness){
      float NdotV = max(dot(N, V), 0.0);
      float NdotL = max(dot(N, L), 0.0);
      float ggx2 = GeometrySchlickGGX(NdotV, roughness);
      float ggx1 = GeometrySchlickGGX(NdotL, roughness);
      return ggx1 * ggx2;
    }
    vec3 fresnelSchlick(float cosTheta, vec3 F0){
      return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
    }
    vec3 fresnelSchlickRoughness(float cosTheta, vec3 F0, float roughness){
      return F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
    }
    void main(){
      vec3 albedo = texture2D(uAlbedoMap, vUV).rgb * uAlbedo;
      float metallic = texture2D(uMetallicMap, vUV).r * uMetallic;
      float roughness = texture2D(uRoughnessMap, vUV).r * uRoughness;
      float ao = texture2D(uAOMap, vUV).r * uAO;
      vec3 N = getNormalFromMap();
      vec3 V = normalize(uCameraPos - vWorldPos);
      vec3 F0 = vec3(0.04);
      F0 = mix(F0, albedo, metallic);
      vec3 Lo = vec3(0.0);
      for(int i = 0; i < 4; i++){
        if(i >= uLightCount) break;
        vec3 L = normalize(uLightPos[i] - vWorldPos);
        vec3 H = normalize(V + L);
        float distance = length(uLightPos[i] - vWorldPos);
        float attenuation = 1.0 / (distance * distance);
        vec3 radiance = uLightColor[i] * attenuation;
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
        Lo += (kD * albedo / PI + specular) * radiance * NdotL;
      }
      vec3 F = fresnelSchlickRoughness(max(dot(N, V), 0.0), F0, roughness);
      vec3 kS = F;
      vec3 kD = 1.0 - kS;
      kD *= 1.0 - metallic;
      vec3 irradiance = textureCube(uIrradianceMap, N).rgb;
      vec3 diffuse = irradiance * albedo;
      vec3 R = reflect(-V, N);
      vec3 prefilteredColor = textureCube(uEnvMap, R).rgb;
      vec2 envBRDF = vec2(1.0 - roughness, roughness);
      vec3 specular = prefilteredColor * (F * envBRDF.x + envBRDF.y);
      vec3 ambient = (kD * diffuse + specular) * ao * uEnvIntensity;
      vec3 color = ambient + Lo;
      color = color / (color + vec3(1.0));
      color = pow(color, vec3(1.0/2.2));
      gl_FragColor = vec4(color, 1.0);
    }
  `,
  createProgram: function(gl){
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, PBRShaders.vertexShader);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, PBRShaders.fragmentShader);
    gl.compileShader(fs);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    return prog;
  }
};

/* ===== 卡通着色器 =====
   支持: 色阶 / 边缘检测/ 描边 /  Rim光*/
const ToonShaders = {
  vertexShader: `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec2 aUV;
    uniform mat4 uModel;
    uniform mat4 uView;
    uniform mat4 uProj;
    uniform mat3 uNormalMatrix;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    varying vec2 vUV;
    void main(){
      vec4 worldPos = uModel * vec4(aPosition, 1.0);
      vWorldPos = worldPos.xyz;
      vNormal = normalize(uNormalMatrix * aNormal);
      vUV = aUV;
      gl_Position = uProj * uView * worldPos;
    }
  `,
  fragmentShader: `
    precision mediump float;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    varying vec2 vUV;
    uniform vec3 uColor;
    uniform vec3 uLightDir;
    uniform vec3 uCameraPos;
    uniform float uRimPower;
    uniform float uRimAmount;
    uniform int uColorBands;
    uniform sampler2D uTexture;
    uniform bool uUseTexture;
    void main(){
      vec3 N = normalize(vNormal);
      vec3 L = normalize(uLightDir);
      vec3 V = normalize(uCameraPos - vWorldPos);
      float NdotL = dot(N, L) * 0.5 + 0.5;
      float bands = float(uColorBands);
      float toon = floor(NdotL * bands) / bands;
      vec3 baseColor = uUseTexture ? texture2D(uTexture, vUV).rgb : uColor;
      vec3 color = baseColor * (0.3 + 0.7 * toon);
      float rim = 1.0 - max(dot(V, N), 0.0);
      rim = pow(rim, uRimPower) * uRimAmount;
      color += vec3(rim);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
  outlineVertex: `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    uniform mat4 uModel;
    uniform mat4 uView;
    uniform mat4 uProj;
    uniform float uOutlineWidth;
    void main(){
      vec3 pos = aPosition + aNormal * uOutlineWidth;
      gl_Position = uProj * uView * uModel * vec4(pos, 1.0);
    }
  `,
  outlineFragment: `
    precision mediump float;
    uniform vec3 uOutlineColor;
    void main(){
      gl_FragColor = vec4(uOutlineColor, 1.0);
    }
  `,
  createProgram: function(gl){
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, ToonShaders.vertexShader);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, ToonShaders.fragmentShader);
    gl.compileShader(fs);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    return prog;
  },
  createOutlineProgram: function(gl){
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, ToonShaders.outlineVertex);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, ToonShaders.outlineFragment);
    gl.compileShader(fs);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    return prog;
  }
};

/* ===== 玻璃/透明着色器 =====
   支持: 折射 / 反射 / 菲涅尔/ 色散
*/
const GlassShaders = {
  vertexShader: `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    uniform mat4 uModel;
    uniform mat4 uView;
    uniform mat4 uProj;
    uniform mat3 uNormalMatrix;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    void main(){
      vec4 worldPos = uModel * vec4(aPosition, 1.0);
      vWorldPos = worldPos.xyz;
      vNormal = normalize(uNormalMatrix * aNormal);
      vViewDir = normalize(worldPos.xyz - (uView * vec4(0.0, 0.0, 0.0, 1.0)).xyz);
      gl_Position = uProj * uView * worldPos;
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    uniform samplerCube uEnvMap;
    uniform vec3 uColor;
    uniform float uIOR;
    uniform float uRoughness;
    uniform float uTransmission;
    uniform float uDispersion;
    void main(){
      vec3 N = normalize(vNormal);
      vec3 V = normalize(-vViewDir);
      float cosTheta = max(dot(V, N), 0.0);
      float F0 = pow((uIOR - 1.0) / (uIOR + 1.0), 2.0);
      float fresnel = F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
      vec3 R = reflect(-V, N);
      vec3 reflection = textureCube(uEnvMap, R).rgb;
      float eta = 1.0 / uIOR;
      vec3 T = refract(-V, N, eta);
      vec3 refraction = textureCube(uEnvMap, T).rgb;
      if(uDispersion > 0.0){
        vec3 Tr = refract(-V, N, 1.0 / (uIOR + uDispersion));
        vec3 Tb = refract(-V, N, 1.0 / (uIOR - uDispersion));
        refraction.r = textureCube(uEnvMap, Tr).r;
        refraction.b = textureCube(uEnvMap, Tb).b;
      }
      vec3 color = mix(refraction * uColor, reflection, fresnel);
      color = mix(color, reflection * uColor, uRoughness * 0.5);
      float alpha = mix(1.0 - uTransmission, 1.0, fresnel);
      gl_FragColor = vec4(color, alpha);
    }
  `,
  createProgram: function(gl){
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, GlassShaders.vertexShader);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, GlassShaders.fragmentShader);
    gl.compileShader(fs);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    return prog;
  }
};

/* ===== 皮肤着色器 =====
   支持: 次表面散射/ 透射 / 细节法线
*/
const SkinShaders = {
  vertexShader: `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec2 aUV;
    uniform mat4 uModel;
    uniform mat4 uView;
    uniform mat4 uProj;
    uniform mat3 uNormalMatrix;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec2 vUV;
    void main(){
      vec4 worldPos = uModel * vec4(aPosition, 1.0);
      vWorldPos = worldPos.xyz;
      vNormal = normalize(uNormalMatrix * aNormal);
      vUV = aUV;
      gl_Position = uProj * uView * worldPos;
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec2 vUV;
    uniform sampler2D uAlbedoMap;
    uniform sampler2D uNormalMap;
    uniform vec3 uLightPos;
    uniform vec3 uLightColor;
    uniform vec3 uCameraPos;
    uniform vec3 uSSSColor;
    uniform float uSSSIntensity;
    uniform float uSSSDistortion;
    uniform float uSSSPower;
    uniform float uSSSScale;
    void main(){
      vec3 albedo = texture2D(uAlbedoMap, vUV).rgb;
      vec3 N = normalize(vNormal);
      vec3 L = normalize(uLightPos - vWorldPos);
      vec3 V = normalize(uCameraPos - vWorldPos);
      vec3 H = normalize(V + L);
      float NdotL = max(dot(N, L), 0.0);
      vec3 diffuse = albedo * NdotL * uLightColor;
      vec3 lightBack = L + N * uSSSDistortion;
      float VdotL = max(dot(V, -lightBack), 0.0);
      float sss = pow(VdotL, uSSSPower) * uSSSIntensity;
      float dist = length(uLightPos - vWorldPos);
      float attenuation = 1.0 / (dist * dist + 0.1);
      vec3 subsurface = uSSSColor * sss * attenuation * uSSSScale;
      float spec = pow(max(dot(N, H), 0.0), 64.0) * 0.3;
      vec3 color = diffuse + subsurface + spec * uLightColor;
      color = color / (color + vec3(1.0));
      color = pow(color, vec3(1.0/2.2));
      gl_FragColor = vec4(color, 1.0);
    }
  `,
  createProgram: function(gl){
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, SkinShaders.vertexShader);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, SkinShaders.fragmentShader);
    gl.compileShader(fs);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    return prog;
  }
};

/* ===== 头发着色器 =====
   支持: Kajiya-Kay / 各向异性高光/ 双重高光
*/
const HairShaders = {
  vertexShader: `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec3 aTangent;
    attribute vec2 aUV;
    uniform mat4 uModel;
    uniform mat4 uView;
    uniform mat4 uProj;
    uniform mat3 uNormalMatrix;
    varying vec3 vWorldPos;
    varying vec3 vTangent;
    varying vec2 vUV;
    void main(){
      vec4 worldPos = uModel * vec4(aPosition, 1.0);
      vWorldPos = worldPos.xyz;
      vTangent = normalize(uNormalMatrix * aTangent);
      vUV = aUV;
      gl_Position = uProj * uView * worldPos;
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec3 vWorldPos;
    varying vec3 vTangent;
    varying vec2 vUV;
    uniform sampler2D uAlbedoMap;
    uniform vec3 uLightPos;
    uniform vec3 uLightColor;
    uniform vec3 uCameraPos;
    uniform vec3 uSpecularColor1;
    uniform vec3 uSpecularColor2;
    uniform float uSpecularPower1;
    uniform float uSpecularPower2;
    uniform float uSpecularShift1;
    uniform float uSpecularShift2;
    uniform float uAmbient;
    void main(){
      vec3 albedo = texture2D(uAlbedoMap, vUV).rgb;
      vec3 T = normalize(vTangent);
      vec3 L = normalize(uLightPos - vWorldPos);
      vec3 V = normalize(uCameraPos - vWorldPos);
      vec3 H = normalize(V + L);
      float TdotL = dot(T, L);
      float TdotH = dot(T, H);
      float sinTL = sqrt(max(1.0 - TdotL * TdotL, 0.0));
      float diffuse = sinTL;
      float sinTH1 = sqrt(max(1.0 - (TdotH + uSpecularShift1) * (TdotH + uSpecularShift1), 0.0));
      float spec1 = pow(sinTH1, uSpecularPower1);
      float sinTH2 = sqrt(max(1.0 - (TdotH + uSpecularShift2) * (TdotH + uSpecularShift2), 0.0));
      float spec2 = pow(sinTH2, uSpecularPower2);
      vec3 color = albedo * (diffuse + uAmbient) * uLightColor;
      color += uSpecularColor1 * spec1 * uLightColor;
      color += uSpecularColor2 * spec2 * uLightColor;
      color = color / (color + vec3(1.0));
      color = pow(color, vec3(1.0/2.2));
      gl_FragColor = vec4(color, 1.0);
    }
  `,
  createProgram: function(gl){
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, HairShaders.vertexShader);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, HairShaders.fragmentShader);
    gl.compileShader(fs);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    return prog;
  }
};

/* ===== 水着色器 =====
   支持: 菲涅尔/ 折射 / 反射 / 法线动画 / 焦散
*/
const WaterShaders = {
  vertexShader: `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec2 aUV;
    uniform mat4 uModel;
    uniform mat4 uView;
    uniform mat4 uProj;
    uniform float uTime;
    uniform float uWaveHeight;
    uniform float uWaveFrequency;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec2 vUV;
    varying float vWave;
    void main(){
      vec3 pos = aPosition;
      float wave1 = sin(pos.x * uWaveFrequency + uTime) * uWaveHeight;
      float wave2 = sin(pos.z * uWaveFrequency * 1.3 + uTime * 1.2) * uWaveHeight * 0.7;
      float wave3 = sin((pos.x + pos.z) * uWaveFrequency * 0.7 + uTime * 0.8) * uWaveHeight * 0.5;
      pos.y += wave1 + wave2 + wave3;
      vWave = wave1 + wave2 + wave3;
      vec4 worldPos = uModel * vec4(pos, 1.0);
      vWorldPos = worldPos.xyz;
      float dx = cos(pos.x * uWaveFrequency + uTime) * uWaveHeight * uWaveFrequency;
      float dz = cos(pos.z * uWaveFrequency * 1.3 + uTime * 1.2) * uWaveHeight * 0.7 * uWaveFrequency * 1.3;
      vNormal = normalize(vec3(-dx, 1.0, -dz));
      vUV = aUV;
      gl_Position = uProj * uView * worldPos;
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec2 vUV;
    varying float vWave;
    uniform samplerCube uEnvMap;
    uniform sampler2D uReflectionMap;
    uniform sampler2D uRefractionMap;
    uniform vec3 uDeepColor;
    uniform vec3 uShallowColor;
    uniform vec3 uCameraPos;
    uniform float uTime;
    uniform float uTransparency;
    uniform float uShininess;
    uniform float uFresnelPower;
    void main(){
      vec3 N = normalize(vNormal);
      vec3 V = normalize(uCameraPos - vWorldPos);
      float cosTheta = max(dot(V, N), 0.0);
      float fresnel = pow(1.0 - cosTheta, uFresnelPower);
      vec3 R = reflect(-V, N);
      vec3 reflection = textureCube(uEnvMap, R).rgb;
      vec2 refractionUV = vUV + N.xz * 0.05;
      vec3 refraction = texture2D(uRefractionMap, refractionUV).rgb;
      float depthFactor = smoothstep(0.0, 1.0, vWave * 2.0 + 0.5);
      vec3 waterColor = mix(uDeepColor, uShallowColor, depthFactor);
      vec3 color = mix(refraction * waterColor, reflection, fresnel);
      vec3 L = normalize(vec3(0.5, 1.0, 0.3));
      vec3 H = normalize(V + L);
      float spec = pow(max(dot(N, H), 0.0), uShininess) * 0.8;
      color += vec3(spec);
      float caustic = sin(vWorldPos.x * 10.0 + uTime * 2.0) * sin(vWorldPos.z * 10.0 + uTime * 1.5) * 0.5 + 0.5;
      color += caustic * 0.1 * (1.0 - fresnel);
      gl_FragColor = vec4(color, mix(uTransparency, 1.0, fresnel));
    }
  `,
  createProgram: function(gl){
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, WaterShaders.vertexShader);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, WaterShaders.fragmentShader);
    gl.compileShader(fs);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    return prog;
  }
};

/* ===== 天空着色器 =====
   支持: 大气散射 / 太阳 / 云/ 昼夜循环
*/
const SkyShaders = {
  vertexShader: `
    attribute vec3 aPosition;
    uniform mat4 uView;
    uniform mat4 uProj;
    varying vec3 vDirection;
    void main(){
      vDirection = aPosition;
      mat4 viewNoTranslation = uView;
      viewNoTranslation[3] = vec4(0.0, 0.0, 0.0, 1.0);
      gl_Position = (uProj * viewNoTranslation * vec4(aPosition * 500.0, 1.0)).xyww;
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec3 vDirection;
    uniform vec3 uSunDirection;
    uniform vec3 uSunColor;
    uniform vec3 uSkyColor;
    uniform vec3 uGroundColor;
    uniform float uTime;
    uniform float uTurbidity;
    uniform float uRayleigh;
    uniform float uMieCoefficient;
    uniform float uMieDirectionalG;
    const float PI = 3.14159265359;
    vec3 totalRayleigh(vec3 lambda){
      return (8.0 * pow(PI, 3.0) * pow(pow(1.0, 2.0) - 1.0, 2.0) * (6.0 + 3.0 * uMieDirectionalG)) /
             (3.0 * 1.0 * pow(lambda, vec3(4.0)) * (6.0 - 7.0 * uMieDirectionalG));
    }
    float rayleighPhase(float cosTheta){
      return (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);
    }
    vec3 totalMie(vec3 lambda, vec3 K, float T){
      float c = (0.2 * T) * 10E-18;
      return 0.434 * c * PI * pow((2.0 * PI) / lambda, vec3(2.0)) * K;
    }
    float hgPhase(float cosTheta, float g){
      return (1.0 / (4.0 * PI)) * ((1.0 - g * g) / pow(1.0 - 2.0 * g * cosTheta + g * g, 1.5));
    }
    void main(){
      vec3 dir = normalize(vDirection);
      float sunHeight = max(uSunDirection.y, 0.0);
      float cosTheta = max(dot(dir, uSunDirection), 0.0);
      vec3 lambda = vec3(0.68, 0.55, 0.45);
      vec3 K = vec3(0.686, 0.678, 0.666);
      vec3 betaR = totalRayleigh(lambda) * uRayleigh;
      vec3 betaM = totalMie(lambda, K, uTurbidity) * uMieCoefficient;
      float sR = 1.0 / (betaR.x + betaR.y + betaR.z) * 0.5;
      float sM = 1.0 / (betaM.x + betaM.y + betaM.z) * 0.5;
      vec3 Fex = exp(-(betaR * sR + betaM * sM));
      float cosSun = max(dot(dir, uSunDirection), 0.0);
      float rPhase = rayleighPhase(cosSun * 0.5 + 0.5);
      vec3 betaRTheta = betaR * rPhase;
      float mPhase = hgPhase(cosSun, uMieDirectionalG);
      vec3 betaMTheta = betaM * mPhase;
      vec3 Lin = ((betaRTheta + betaMTheta) / (betaR + betaM)) * (1.0 - Fex);
      Lin *= mix(vec3(1.0), pow(betaRTheta * Fex, vec3(0.5)), clamp(pow(1.0 - sunHeight, 2.0), 0.0, 1.0));
      vec3 L0 = vec3(0.1) * Fex;
      float sunDisc = smoothstep(0.9995, 0.9999, cosTheta);
      L0 += uSunColor * sunDisc * 10.0;
      vec3 color = Lin + L0;
      color = pow(color, vec3(1.0/2.2));
      if(dir.y < 0.0){
        color = mix(color, uGroundColor, smoothstep(0.0, -0.3, dir.y));
      }
      gl_FragColor = vec4(color, 1.0);
    }
  `,
  createProgram: function(gl){
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, SkyShaders.vertexShader);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, SkyShaders.fragmentShader);
    gl.compileShader(fs);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    return prog;
  }
};

/* ===== 材质预设库=====
   支持: 标准材质 / 金属 / 塑料 / 皮肤 / 头发 / 玻璃 / 陶瓷*/
const MaterialPresets = {
  standard: function(color){
    return {
      type: 'pbr',
      albedo: color || [0.8, 0.8, 0.8],
      metallic: 0,
      roughness: 0.5,
      ao: 1,
      normalScale: 1,
      envIntensity: 1,
      transparent: false,
      opacity: 1,
      side: 'front',
      depthWrite: true,
      depthTest: true
    };
  },
  metal: function(color, roughness){
    return {
      type: 'pbr',
      albedo: color || [0.9, 0.9, 0.9],
      metallic: 1,
      roughness: roughness !== undefined ? roughness : 0.2,
      ao: 1,
      normalScale: 1,
      envIntensity: 1.5,
      transparent: false,
      opacity: 1
    };
  },
  plastic: function(color, roughness){
    return {
      type: 'pbr',
      albedo: color || [0.8, 0.2, 0.2],
      metallic: 0,
      roughness: roughness !== undefined ? roughness : 0.4,
      ao: 1,
      normalScale: 1,
      envIntensity: 0.8,
      transparent: false,
      opacity: 1
    };
  },
  skin: function(color){
    return {
      type: 'skin',
      albedo: color || [0.85, 0.65, 0.55],
      metallic: 0,
      roughness: 0.6,
      sssColor: [1.0, 0.5, 0.4],
      sssIntensity: 0.8,
      sssDistortion: 0.4,
      sssPower: 3.0,
      sssScale: 1.0,
      transparent: false,
      opacity: 1
    };
  },
  hair: function(color){
    return {
      type: 'hair',
      albedo: color || [0.2, 0.15, 0.1],
      specularColor1: [1.0, 0.9, 0.8],
      specularColor2: [0.8, 0.6, 0.4],
      specularPower1: 64,
      specularPower2: 32,
      specularShift1: 0.3,
      specularShift2: -0.3,
      ambient: 0.2,
      transparent: false,
      opacity: 1
    };
  },
  glass: function(color, ior){
    return {
      type: 'glass',
      albedo: color || [0.9, 0.95, 1.0],
      ior: ior || 1.5,
      roughness: 0.05,
      transmission: 0.9,
      dispersion: 0.02,
      transparent: true,
      opacity: 0.8,
      depthWrite: false
    };
  },
  water: function(){
    return {
      type: 'water',
      deepColor: [0.0, 0.1, 0.3],
      shallowColor: [0.1, 0.4, 0.6],
      transparency: 0.7,
      shininess: 256,
      fresnelPower: 3.0,
      waveHeight: 0.1,
      waveFrequency: 2.0,
      transparent: true,
      opacity: 0.8,
      depthWrite: false
    };
  },
  toon: function(color, bands){
    return {
      type: 'toon',
      albedo: color || [0.8, 0.6, 0.4],
      colorBands: bands || 4,
      rimPower: 3.0,
      rimAmount: 0.5,
      outlineWidth: 0.02,
      outlineColor: [0, 0, 0],
      transparent: false,
      opacity: 1
    };
  },
  emissive: function(color, intensity){
    return {
      type: 'pbr',
      albedo: [0, 0, 0],
      emissive: color || [1, 1, 1],
      emissiveIntensity: intensity || 1,
      metallic: 0,
      roughness: 1,
      transparent: false,
      opacity: 1
    };
  },
  terrain: function(){
    return {
      type: 'terrain',
      grassColor: [0.3, 0.5, 0.2],
      dirtColor: [0.5, 0.4, 0.3],
      rockColor: [0.5, 0.5, 0.5],
      snowColor: [0.9, 0.9, 0.95],
      grassHeight: 0.3,
      rockHeight: 0.6,
      snowHeight: 0.85,
      metallic: 0,
      roughness: 0.9,
      transparent: false,
      opacity: 1
    };
  },
  getPresetNames: function(){
    return ['standard', 'metal', 'plastic', 'skin', 'hair', 'glass', 'water', 'toon', 'emissive', 'terrain'];
  }
};

/* ===== 程序化纹理生成器 =====
   支持: 噪声 / 渐变 / 棋盘 / 条纹 / 砖墙 / 木纹 / 大理石*/
function createProceduralTexture(width, height, options){
  const pt = {
    width: width || 256,
    height: height || 256,
    _canvas: null,
    _context: null,
    _data: null
  };

  function init(){
    pt._canvas = document.createElement('canvas');
    pt._canvas.width = pt.width;
    pt._canvas.height = pt.height;
    pt._context = pt._canvas.getContext('2d');
    pt._data = pt._context.createImageData(pt.width, pt.height);
  }

  function setPixel(x, y, r, g, b, a){
    const idx = (y * pt.width + x) * 4;
    pt._data.data[idx] = r;
    pt._data.data[idx+1] = g;
    pt._data.data[idx+2] = b;
    pt._data.data[idx+3] = a !== undefined ? a : 255;
  }

  function getPixel(x, y){
    const idx = (y * pt.width + x) * 4;
    return [
      pt._data.data[idx],
      pt._data.data[idx+1],
      pt._data.data[idx+2],
      pt._data.data[idx+3]
    ];
  }

  function noise2D(x, y, seed){
    const s = seed || 0;
    const n = Math.sin(x * 12.9898 + y * 78.233 + s * 43.758) * 43758.5453;
    return n - Math.floor(n);
  }

  function smoothNoise(x, y, seed){
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const a = noise2D(ix, iy, seed);
    const b = noise2D(ix + 1, iy, seed);
    const c = noise2D(ix, iy + 1, seed);
    const d = noise2D(ix + 1, iy + 1, seed);
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
  }

  function fbm(x, y, octaves, seed){
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    for(let i = 0; i < octaves; i++){
      value += amplitude * smoothNoise(x * frequency, y * frequency, seed + i);
      amplitude *= 0.5;
      frequency *= 2;
    }
    return value;
  }

  function generateGradient(color1, color2, direction){
    const dir = direction || 'vertical';
    for(let y = 0; y < pt.height; y++){
      for(let x = 0; x < pt.width; x++){
        let t;
        if(dir === 'vertical') t = y / pt.height;
        else if(dir === 'horizontal') t = x / pt.width;
        else if(dir === 'diagonal') t = (x + y) / (pt.width + pt.height);
        else t = y / pt.height;
        const r = Math.floor(color1[0] + (color2[0] - color1[0]) * t);
        const g = Math.floor(color1[1] + (color2[1] - color1[1]) * t);
        const b = Math.floor(color1[2] + (color2[2] - color1[2]) * t);
        setPixel(x, y, r, g, b);
      }
    }
  }

  function generateCheckerboard(color1, color2, size){
    const s = size || 32;
    for(let y = 0; y < pt.height; y++){
      for(let x = 0; x < pt.width; x++){
        const check = (Math.floor(x / s) + Math.floor(y / s)) % 2;
        const color = check ? color1 : color2;
        setPixel(x, y, color[0], color[1], color[2]);
      }
    }
  }

  function generateNoise(scale, octaves, seed){
    for(let y = 0; y < pt.height; y++){
      for(let x = 0; x < pt.width; x++){
        const value = fbm(x / scale, y / scale, octaves || 4, seed || 0);
        const v = Math.floor(value * 255);
        setPixel(x, y, v, v, v);
      }
    }
  }

  function generateWood(baseColor, grainColor, scale, seed){
    for(let y = 0; y < pt.height; y++){
      for(let x = 0; x < pt.width; x++){
        const nx = x / pt.width * scale;
        const ny = y / pt.height * scale;
        const noise = fbm(nx, ny, 4, seed || 0);
        const grain = Math.sin((nx + noise * 0.5) * 20) * 0.5 + 0.5;
        const t = grain * 0.7 + noise * 0.3;
        const r = Math.floor(baseColor[0] + (grainColor[0] - baseColor[0]) * t);
        const g = Math.floor(baseColor[1] + (grainColor[1] - baseColor[1]) * t);
        const b = Math.floor(baseColor[2] + (grainColor[2] - baseColor[2]) * t);
        setPixel(x, y, r, g, b);
      }
    }
  }

  function generateMarble(baseColor, veinColor, scale, seed){
    for(let y = 0; y < pt.height; y++){
      for(let x = 0; x < pt.width; x++){
        const nx = x / pt.width * scale;
        const ny = y / pt.height * scale;
        const noise = fbm(nx, ny, 5, seed || 0);
        const marble = Math.sin((nx + ny + noise * 2) * 5) * 0.5 + 0.5;
        const veins = Math.pow(marble, 3);
        const t = veins * 0.8 + noise * 0.2;
        const r = Math.floor(baseColor[0] + (veinColor[0] - baseColor[0]) * t);
        const g = Math.floor(baseColor[1] + (veinColor[1] - baseColor[1]) * t);
        const b = Math.floor(baseColor[2] + (veinColor[2] - baseColor[2]) * t);
        setPixel(x, y, r, g, b);
      }
    }
  }

  function generateBrick(baseColor, mortarColor, brickWidth, brickHeight){
    const bw = brickWidth || 64;
    const bh = brickHeight || 32;
    for(let y = 0; y < pt.height; y++){
      for(let x = 0; x < pt.width; x++){
        const row = Math.floor(y / bh);
        const offset = row % 2 === 0 ? 0 : bw / 2;
        const bx = (x + offset) % bw;
        const by = y % bh;
        const mortar = bx < 2 || by < 2;
        const color = mortar ? mortarColor : baseColor;
        const variation = noise2D(Math.floor((x + offset) / bw), Math.floor(y / bh), 1) * 20 - 10;
        setPixel(x, y,
          Math.max(0, Math.min(255, color[0] + variation)),
          Math.max(0, Math.min(255, color[1] + variation)),
          Math.max(0, Math.min(255, color[2] + variation))
        );
      }
    }
  }

  function toCanvas(){
    pt._context.putImageData(pt._data, 0, 0);
    return pt._canvas;
  }

  function toDataURL(){
    return toCanvas().toDataURL();
  }

  function toTexture(gl){
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, toCanvas());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.generateMipmap(gl.TEXTURE_2D);
    return texture;
  }

  init();
  return { setPixel, getPixel, generateGradient, generateCheckerboard, generateNoise, generateWood, generateMarble, generateBrick, toCanvas, toDataURL, toTexture, pt };
}
