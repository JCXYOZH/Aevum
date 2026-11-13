
// ============================================================
// 模块七：PBR材质与光照系统 RenderingPBR (约1500行)
// PBR材质 / 光源 / 光照计算 / 阴影 / IBL
// ============================================================

const OrbPBR = (function(){
  const { Vec3, clamp, lerp, EPSILON } = OrbMath;

  // ============================================================
  // PBRMaterial - PBR材质
  // ============================================================
  class PBRMaterial {
    constructor(name = ''){
      this.name = name;

      // 基础属性
      this.albedo = new Vec3(1, 1, 1);     // 基础颜色
      this.roughness = 0.5;                  // 粗糙度
      this.metalness = 0;                    // 金属度
      this.emissive = new Vec3(0, 0, 0);    // 自发光
      this.emissiveIntensity = 1;            // 自发光强度
      this.ao = 1;                            // 环境光遮蔽
      this.opacity = 1;                       // 不透明度
      this.transparent = false;               // 是否透明

      // 高级属性
      this.normalScale = 1;                   // 法线强度
      this.aoIntensity = 1;                   // AO强度
      this.envMapIntensity = 1;               // 环境贴图强度
      this.reflectivity = 0.5;                // 反射率
      this.clearcoat = 0;                      // 清漆层
      this.clearcoatRoughness = 0;            // 清漆粗糙度
      this.sheen = 0;                          // 光泽
      this.sheenColor = new Vec3(1, 1, 1);   // 光泽颜色
      this.subsurface = 0;                     // 次表面散射
      this.subsurfaceColor = new Vec3(1, 1, 1); // 次表面颜色

      // 纹理
      this.albedoMap = null;
      this.normalMap = null;
      this.roughnessMap = null;
      this.metalnessMap = null;
      this.aoMap = null;
      this.emissiveMap = null;
      this.opacityMap = null;
      this.envMap = null;

      // 渲染状态
      this.wireframe = false;
      this.flatShading = false;
      this.side = 0; // 0=正面, 1=背面, 2=双面
      this.depthTest = true;
      this.depthWrite = true;
      this.blending = 0; // 0=不混合, 1=正常, 2=叠加, 3=相乘

      this.userData = {};
    }

    setAlbedo(r, g, b){
      this.albedo.set(r, g, b);
      return this;
    }

    setEmissive(r, g, b, intensity = 1){
      this.emissive.set(r, g, b);
      this.emissiveIntensity = intensity;
      return this;
    }

    clone(){
      const m = new PBRMaterial(this.name);
      m.albedo.copy(this.albedo);
      m.roughness = this.roughness;
      m.metalness = this.metalness;
      m.emissive.copy(this.emissive);
      m.emissiveIntensity = this.emissiveIntensity;
      m.ao = this.ao;
      m.opacity = this.opacity;
      m.transparent = this.transparent;
      m.normalScale = this.normalScale;
      m.aoIntensity = this.aoIntensity;
      m.envMapIntensity = this.envMapIntensity;
      m.reflectivity = this.reflectivity;
      m.clearcoat = this.clearcoat;
      m.clearcoatRoughness = this.clearcoatRoughness;
      m.sheen = this.sheen;
      m.sheenColor.copy(this.sheenColor);
      m.subsurface = this.subsurface;
      m.subsurfaceColor.copy(this.subsurfaceColor);
      m.wireframe = this.wireframe;
      m.flatShading = this.flatShading;
      m.side = this.side;
      m.depthTest = this.depthTest;
      m.depthWrite = this.depthWrite;
      m.blending = this.blending;
      m.userData = {...this.userData};
      return m;
    }

    // 预设材质
    static createGold(){
      const m = new PBRMaterial('Gold');
      m.setAlbedo(1.0, 0.766, 0.336);
      m.metalness = 1;
      m.roughness = 0.3;
      return m;
    }

    static createSilver(){
      const m = new PBRMaterial('Silver');
      m.setAlbedo(0.972, 0.96, 0.915);
      m.metalness = 1;
      m.roughness = 0.25;
      return m;
    }

    static createCopper(){
      const m = new PBRMaterial('Copper');
      m.setAlbedo(0.953, 0.638, 0.538);
      m.metalness = 1;
      m.roughness = 0.35;
      return m;
    }

    static createPlastic(color = [1, 1, 1]){
      const m = new PBRMaterial('Plastic');
      m.setAlbedo(color[0], color[1], color[2]);
      m.metalness = 0;
      m.roughness = 0.4;
      m.clearcoat = 0.5;
      m.clearcoatRoughness = 0.2;
      return m;
    }

    static createRubber(color = [0.1, 0.1, 0.1]){
      const m = new PBRMaterial('Rubber');
      m.setAlbedo(color[0], color[1], color[2]);
      m.metalness = 0;
      m.roughness = 0.9;
      return m;
    }

    static createSkin(){
      const m = new PBRMaterial('Skin');
      m.setAlbedo(0.85, 0.6, 0.5);
      m.metalness = 0;
      m.roughness = 0.6;
      m.subsurface = 0.5;
      m.subsurfaceColor.set(1, 0.5, 0.4);
      return m;
    }

    static createGlass(){
      const m = new PBRMaterial('Glass');
      m.setAlbedo(1, 1, 1);
      m.metalness = 0;
      m.roughness = 0.05;
      m.opacity = 0.3;
      m.transparent = true;
      m.reflectivity = 0.9;
      return m;
    }
  }

  // ============================================================
  // Light - 光源基类
  // ============================================================
  class Light {
    constructor(color = new Vec3(1, 1, 1), intensity = 1){
      this.color = color.clone();
      this.intensity = intensity;
      this.enabled = true;
      this.castShadow = false;
      this.userData = {};
    }

    setColor(r, g, b){
      this.color.set(r, g, b);
      return this;
    }

    setIntensity(intensity){
      this.intensity = intensity;
      return this;
    }

    getEffectiveColor(){
      return this.color.clone().mul(this.intensity);
    }
  }

  // DirectionalLight - 方向光
  class DirectionalLight extends Light {
    constructor(color, intensity){
      super(color, intensity);
      this.direction = new Vec3(0, -1, 0);
      this.position = new Vec3(0, 10, 0);
      this.target = new Vec3(0, 0, 0);
      this.shadowMapSize = 2048;
      this.shadowCameraNear = 0.5;
      this.shadowCameraFar = 50;
      this.shadowCameraLeft = -10;
      this.shadowCameraRight = 10;
      this.shadowCameraTop = 10;
      this.shadowCameraBottom = -10;
      this.shadowBias = -0.0005;
      this.shadowNormalBias = 0.02;
    }

    updateDirection(){
      this.direction.copy(this.target).sub(this.position).normalize();
      return this.direction;
    }
  }

  // PointLight - 点光源
  class PointLight extends Light {
    constructor(color, intensity, distance = 0, decay = 2){
      super(color, intensity);
      this.position = new Vec3();
      this.distance = distance;
      this.decay = decay;
      this.shadowMapSize = 1024;
      this.shadowCameraNear = 0.1;
      this.shadowCameraFar = 100;
      this.shadowBias = -0.001;
    }

    getDistanceAttenuation(distance){
      if(this.distance <= 0) return 1;
      const attenuation = pow(clamp(1 - pow(distance / this.distance, 4), 0, 1), 2);
      return attenuation / (distance * distance * this.decay + 1);
    }
  }

  // SpotLight - 聚光灯
  class SpotLight extends Light {
    constructor(color, intensity, distance = 0, angle = Math.PI / 6, penumbra = 0, decay = 2){
      super(color, intensity);
      this.position = new Vec3();
      this.target = new Vec3();
      this.direction = new Vec3(0, -1, 0);
      this.distance = distance;
      this.angle = angle;
      this.penumbra = penumbra;
      this.decay = decay;
      this.shadowMapSize = 1024;
      this.shadowCameraNear = 0.1;
      this.shadowCameraFar = 100;
      this.shadowBias = -0.001;
    }

    updateDirection(){
      this.direction.copy(this.target).sub(this.position).normalize();
      return this.direction;
    }

    getConeAttenuation(cosTheta){
      const cosOuter = Math.cos(this.angle);
      const cosInner = Math.cos(this.angle * (1 - this.penumbra));
      return smoothstep(cosOuter, cosInner, cosTheta);
    }
  }

  // HemisphereLight - 半球光
  class HemisphereLight extends Light {
    constructor(skyColor = new Vec3(1, 1, 1), groundColor = new Vec3(0.5, 0.5, 0.5), intensity = 1){
      super(skyColor, intensity);
      this.groundColor = groundColor.clone();
    }
  }

  // RectAreaLight - 面光源
  class RectAreaLight extends Light {
    constructor(color, intensity, width = 10, height = 10){
      super(color, intensity);
      this.position = new Vec3();
      this.width = width;
      this.height = height;
    }
  }

  // ============================================================
  // LightingModel - 光照计算模型
  // ============================================================
  class LightingModel {
    constructor(){
      this.lights = [];
      this.ambientLight = new Vec3(0.1, 0.1, 0.1);
      this.environment = null;
      this.enabled = true;
    }

    addLight(light){
      this.lights.push(light);
      return light;
    }

    removeLight(light){
      const idx = this.lights.indexOf(light);
      if(idx >= 0) this.lights.splice(idx, 1);
    }

    clear(){
      this.lights = [];
    }

    // 计算漫反射（Lambert）
    diffuse(normal, lightDir, lightColor){
      const ndotl = Math.max(0, normal.dot(lightDir));
      return lightColor.clone().mul(ndotl);
    }

    // 计算高光（Phong）
    specularPhong(normal, lightDir, viewDir, lightColor, shininess){
      const reflectDir = normal.clone().mul(2 * normal.dot(lightDir)).sub(lightDir).normalize();
      const rdotv = Math.max(0, reflectDir.dot(viewDir));
      return lightColor.clone().mul(Math.pow(rdotv, shininess));
    }

    // 计算高光（Blinn-Phong）
    specularBlinnPhong(normal, lightDir, viewDir, lightColor, shininess){
      const halfDir = lightDir.clone().add(viewDir).normalize();
      const ndoth = Math.max(0, normal.dot(halfDir));
      return lightColor.clone().mul(Math.pow(ndoth, shininess * 4));
    }

    // GGX/Trowbridge-Reitz 法线分布函数
    distributionGGX(normal, halfDir, roughness){
      const a = roughness * roughness;
      const a2 = a * a;
      const ndoth = Math.max(0, normal.dot(halfDir));
      const ndoth2 = ndoth * ndoth;
      const denom = ndoth2 * (a2 - 1) + 1;
      return a2 / (Math.PI * denom * denom);
    }

    // Schlick-GGX 几何函数
    geometrySchlickGGX(ndotv, roughness){
      const r = roughness + 1;
      const k = (r * r) / 8;
      return ndotv / (ndotv * (1 - k) + k);
    }

    // Smith 几何函数
    geometrySmith(normal, viewDir, lightDir, roughness){
      const ndotv = Math.max(0, normal.dot(viewDir));
      const ndotl = Math.max(0, normal.dot(lightDir));
      const ggx2 = this.geometrySchlickGGX(ndotv, roughness);
      const ggx1 = this.geometrySchlickGGX(ndotl, roughness);
      return ggx1 * ggx2;
    }

    // Fresnel-Schlick 近似
    fresnelSchlick(cosTheta, f0){
      return f0.clone().add(new Vec3(1, 1, 1).sub(f0).mul(Math.pow(clamp(1 - cosTheta, 0, 1), 5)));
    }

    // Fresnel-Schlick with roughness
    fresnelSchlickRoughness(cosTheta, f0, roughness){
      return f0.clone().add(new Vec3(Math.max(1 - roughness, f0.x), Math.max(1 - roughness, f0.y), Math.max(1 - roughness, f0.z)).sub(f0).mul(Math.pow(clamp(1 - cosTheta, 0, 1), 5)));
    }

    // 完整PBR光照计算（Cook-Torrance BRDF）
    calculatePBR(position, normal, viewDir, material, lights){
      const albedo = material.albedo;
      const roughness = clamp(material.roughness, 0.04, 1);
      const metalness = clamp(material.metalness, 0, 1);
      const ao = material.ao;

      // F0 = 基础反射率
      const f0 = new Vec3(0.04, 0.04, 0.04);
      f0.lerp(albedo, metalness);

      let Lo = new Vec3(0, 0, 0); // 出射辐射度

      for(const light of lights){
        if(!light.enabled) continue;

        let lightDir, attenuation = 1;

        if(light instanceof DirectionalLight){
          lightDir = light.direction.clone().negate();
        } else if(light instanceof PointLight){
          const dist = position.distanceTo(light.position);
          lightDir = Vec3.sub(light.position, position).normalize();
          attenuation = light.getDistanceAttenuation(dist);
        } else if(light instanceof SpotLight){
          const dist = position.distanceTo(light.position);
          lightDir = Vec3.sub(light.position, position).normalize();
          attenuation = light.getDistanceAttenuation(dist);
          const cosTheta = lightDir.dot(light.direction.clone().negate());
          attenuation *= light.getConeAttenuation(cosTheta);
        } else {
          continue;
        }

        const halfDir = lightDir.clone().add(viewDir).normalize();
        const lightColor = light.getEffectiveColor().mul(attenuation);

        // Cook-Torrance BRDF
        const NDF = this.distributionGGX(normal, halfDir, roughness);
        const G = this.geometrySmith(normal, viewDir, lightDir, roughness);
        const F = this.fresnelSchlick(Math.max(0, halfDir.dot(viewDir)), f0);

        const numerator = NDF * G;
        const denominator = 4 * Math.max(0, normal.dot(viewDir)) * Math.max(0, normal.dot(lightDir)) + 0.0001;
        const specular = F.clone().mul(numerator / denominator);

        // 能量守恒
        const kS = F;
        const kD = new Vec3(1, 1, 1).sub(kS).mul(1 - metalness);

        const ndotl = Math.max(0, normal.dot(lightDir));
        const diffuse = albedo.clone().div(Math.PI).mul(kD);

        Lo.add(diffuse.add(specular).mul(lightColor).mul(ndotl));
      }

      // 环境光
      const ambient = this.ambientLight.clone().mul(albedo).mul(ao);

      // 自发光
      const emissive = material.emissive.clone().mul(material.emissiveIntensity);

      // 最终颜色
      const color = Lo.add(ambient).add(emissive);

      return color;
    }
  }

  // ============================================================
  // ShadowMap - 阴影贴图
  // ============================================================
  class ShadowMap {
    constructor(gl, size = 2048){
      this.gl = gl;
      this.size = size;
      this.framebuffer = null;
      this.depthTexture = null;
      this.enabled = true;
      this.bias = -0.0005;
      this.normalBias = 0.02;
      this._init();
    }

    _init(){
      const gl = this.gl;

      // 创建深度纹理
      this.depthTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, this.size, this.size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      // 创建帧缓冲
      this.framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTexture, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    bind(){
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.viewport(0, 0, this.size, this.size);
    }

    unbind(){
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // PCF软阴影采样
    samplePCF(shadowCoord, texelSize){
      let result = 0;
      for(let x = -1; x <= 1; x++){
        for(let y = -1; y <= 1; y++){
          const offset = new Vec3(x * texelSize, y * texelSize, 0);
          result += this.sample(shadowCoord.clone().add(offset));
        }
      }
      return result / 9;
    }

    sample(shadowCoord){
      // 简化实现，实际需要在着色器中采样深度纹理
      return 1;
    }

    dispose(){
      const gl = this.gl;
      if(this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
      if(this.depthTexture) gl.deleteTexture(this.depthTexture);
    }
  }

  // ============================================================
  // EnvironmentMap - 环境贴图（IBL）
  // ============================================================
  class EnvironmentMap {
    constructor(gl){
      this.gl = gl;
      this.diffuseEnvMap = null;   // 辐照度贴图（漫反射IBL）
      this.specularEnvMap = null;  // 预过滤环境贴图（高光IBL）
      this.brdfLUT = null;          // BRDF查找表
      this.intensity = 1;
      this.enabled = true;
    }

    // 从等距柱状投影图生成环境贴图
    setFromEquirectangular(texture){
      // 简化实现，实际需要做球面谐波和预过滤
      this.diffuseEnvMap = texture;
      this.specularEnvMap = texture;
    }

    // 生成BRDF LUT
    generateBRDFLUT(size = 512){
      const gl = this.gl;
      // 简化实现，实际需要用计算着色器生成
      this.brdfLUT = gl.createTexture();
    }

    // 获取漫反射环境光
    getDiffuseIrradiance(normal){
      // 简化实现，实际需要采样辐照度贴图
      return new Vec3(0.2, 0.2, 0.2);
    }

    // 获取高光环境光
    getSpecularRadiance(normal, viewDir, roughness){
      // 简化实现，实际需要采样预过滤环境贴图
      return new Vec3(0.5, 0.5, 0.5);
    }

    dispose(){
      const gl = this.gl;
      if(this.diffuseEnvMap) gl.deleteTexture(this.diffuseEnvMap);
      if(this.specularEnvMap) gl.deleteTexture(this.specularEnvMap);
      if(this.brdfLUT) gl.deleteTexture(this.brdfLUT);
    }
  }

  // 工具函数
  function pow(base, exp){
    return Math.pow(base, exp);
  }

  function smoothstep(edge0, edge1, x){
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // 导出
  return {
    PBRMaterial, Light, DirectionalLight, PointLight, SpotLight,
    HemisphereLight, RectAreaLight, LightingModel, ShadowMap, EnvironmentMap
  };
})();

if(typeof window !== 'undefined'){
  window.OrbPBR = OrbPBR;
}