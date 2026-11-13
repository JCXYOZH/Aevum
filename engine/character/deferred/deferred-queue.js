/**
 * 灵体渲染 - 延迟渲染/阴影映射/后处理/粒子系统/渲染队列
 * 纯WebGL2，零第三方依赖
 * @version 4.0.0
 */
'use strict';

const SpiritRendererV4 = (function () {

  class DeferredRenderer {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.gBuffer = null;
      this.geometryPass = null;
      this.lightingPass = null;
      this.compositePass = null;
      this.width = 0;
      this.height = 0;
      this.lights = [];
      this.maxLights = 64;
      this.enabled = true;
      this.stats = { drawCalls: 0, triangles: 0, lightsProcessed: 0 };
    }

    init(width, height) {
      this.width = width;
      this.height = height;
      this._createGBuffer();
      this._createGeometryPass();
      this._createLightingPass();
      this._createCompositePass();
    }

    _createGBuffer() {
      const gl = this.gl;
      this.gBuffer = gl.createFramebuffer();
      gl.bindFramebuffer(36160, this.gBuffer);
      const positionTexture = gl.createTexture();
      gl.bindTexture(3553, positionTexture);
      gl.texImage2D(3553, 0, 34836, this.width, this.height, 0, 6408, 5126, null);
      gl.texParameteri(3553, 10241, 9728);
      gl.texParameteri(3553, 10240, 9728);
      gl.framebufferTexture2D(36160, 36064, 3553, positionTexture, 0);
      const normalTexture = gl.createTexture();
      gl.bindTexture(3553, normalTexture);
      gl.texImage2D(3553, 0, 34836, this.width, this.height, 0, 6408, 5126, null);
      gl.texParameteri(3553, 10241, 9728);
      gl.texParameteri(3553, 10240, 9728);
      gl.framebufferTexture2D(36160, 36065, 3553, normalTexture, 0);
      const albedoTexture = gl.createTexture();
      gl.bindTexture(3553, albedoTexture);
      gl.texImage2D(3553, 0, 32856, this.width, this.height, 0, 6408, 5121, null);
      gl.texParameteri(3553, 10241, 9728);
      gl.texParameteri(3553, 10240, 9728);
      gl.framebufferTexture2D(36160, 36066, 3553, albedoTexture, 0);
      const materialTexture = gl.createTexture();
      gl.bindTexture(3553, materialTexture);
      gl.texImage2D(3553, 0, 32856, this.width, this.height, 0, 6408, 5121, null);
      gl.texParameteri(3553, 10241, 9728);
      gl.texParameteri(3553, 10240, 9728);
      gl.framebufferTexture2D(36160, 36067, 3553, materialTexture, 0);
      const depthTexture = gl.createTexture();
      gl.bindTexture(3553, depthTexture);
      gl.texImage2D(3553, 0, 36012, this.width, this.height, 0, 36012, 33635, null);
      gl.texParameteri(3553, 10241, 9728);
      gl.texParameteri(3553, 10240, 9728);
      gl.framebufferTexture2D(36160, 36096, 3553, depthTexture, 0);
      gl.drawBuffers([36064, 36065, 36066, 36067]);
      gl.bindFramebuffer(36160, null);
      this.gBufferTextures = { position: positionTexture, normal: normalTexture, albedo: albedoTexture, material: materialTexture, depth: depthTexture };
    }

    _createGeometryPass() {
      const gl = this.gl;
      const vs = `#version 300 es
precision highp float;
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUV;
out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUV;
uniform mat4 uModelMatrix;
uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;
uniform mat3 uNormalMatrix;
void main() {
  vec4 worldPos = uModelMatrix * vec4(aPosition, 1.0);
  vWorldPos = worldPos.xyz;
  vNormal = normalize(uNormalMatrix * aNormal);
  vUV = aUV;
  gl_Position = uProjectionMatrix * uViewMatrix * worldPos;
}`;
      const fs = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUV;
layout(location = 0) out vec4 gPosition;
layout(location = 1) out vec4 gNormal;
layout(location = 2) out vec4 gAlbedo;
layout(location = 3) out vec4 gMaterial;
uniform vec3 uAlbedo;
uniform float uRoughness;
uniform float uMetallic;
uniform float uSubsurface;
void main() {
  gPosition = vec4(vWorldPos, 1.0);
  gNormal = vec4(normalize(vNormal), 1.0);
  gAlbedo = vec4(uAlbedo, 1.0);
  gMaterial = vec4(uRoughness, uMetallic, uSubsurface, 1.0);
}`;
      this.geometryPass = this._compileProgram(vs, fs);
    }

    _createLightingPass() {
      const gl = this.gl;
      const vs = `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vUV;
void main() {
  vUV = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;
      const fs = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D gPosition;
uniform sampler2D gNormal;
uniform sampler2D gAlbedo;
uniform sampler2D gMaterial;
uniform vec3 uCameraPos;
uniform int uLightCount;
uniform vec3 uLightPositions[64];
uniform vec3 uLightColors[64];
uniform float uLightIntensities[64];
uniform float uLightRadii[64];
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
  vec3 worldPos = texture(gPosition, vUV).rgb;
  vec3 normal = texture(gNormal, vUV).rgb;
  vec3 albedo = texture(gAlbedo, vUV).rgb;
  vec4 material = texture(gMaterial, vUV);
  float roughness = material.r;
  float metallic = material.g;
  float subsurface = material.b;
  if (length(normal) < 0.01) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec3 N = normalize(normal);
  vec3 V = normalize(uCameraPos - worldPos);
  vec3 F0 = vec3(0.04);
  F0 = mix(F0, albedo, metallic);
  vec3 Lo = vec3(0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= uLightCount) break;
    vec3 lightPos = uLightPositions[i];
    vec3 lightColor = uLightColors[i];
    float intensity = uLightIntensities[i];
    float radius = uLightRadii[i];
    vec3 L = normalize(lightPos - worldPos);
    vec3 H = normalize(V + L);
    float distance = length(lightPos - worldPos);
    if (distance > radius) continue;
    float attenuation = 1.0 / (1.0 + 0.09 * distance + 0.032 * distance * distance);
    vec3 radiance = lightColor * intensity * attenuation;
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
    Lo += (kD * albedo / 3.14159265 + specular) * radiance * NdotL;
    if (subsurface > 0.0) {
      vec3 sss = albedo * subsurface * (1.0 - NdotL) * 0.5 * attenuation;
      Lo += sss;
    }
  }
  vec3 ambient = vec3(0.03) * albedo;
  vec3 color = ambient + Lo;
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0/2.2));
  fragColor = vec4(color, 1.0);
}`;
      this.lightingPass = this._compileProgram(vs, fs);
    }

    _createCompositePass() {
      const gl = this.gl;
      const vs = `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vUV;
void main() {
  vUV = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;
      const fs = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uExposure;
uniform float uBloomIntensity;
void main() {
  vec3 scene = texture(uScene, vUV).rgb;
  vec3 bloom = texture(uBloom, vUV).rgb;
  vec3 color = scene + bloom * uBloomIntensity;
  color = vec3(1.0) - exp(-color * uExposure);
  color = pow(color, vec3(1.0/2.2));
  fragColor = vec4(color, 1.0);
}`;
      this.compositePass = this._compileProgram(vs, fs);
    }

    _compileProgram(vsSource, fsSource) {
      const gl = this.gl;
      const vs = gl.createShader(35633);
      gl.shaderSource(vs, vsSource);
      gl.compileShader(vs);
      const fs = gl.createShader(35632);
      gl.shaderSource(fs, fsSource);
      gl.compileShader(fs);
      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return program;
    }

    addLight(light) {
      if (this.lights.length >= this.maxLights) return false;
      this.lights.push({
        position: light.position || [0, 0, 0],
        color: light.color || [1, 1, 1],
        intensity: light.intensity || 1,
        radius: light.radius || 10,
        type: light.type || 'point',
        direction: light.direction || [0, -1, 0],
        enabled: light.enabled !== false
      });
      return true;
    }

    removeLight(index) {
      this.lights.splice(index, 1);
    }

    updateLight(index, updates) {
      if (this.lights[index]) {
        Object.assign(this.lights[index], updates);
      }
    }

    beginGeometryPass() {
      const gl = this.gl;
      gl.bindFramebuffer(36160, this.gBuffer);
      gl.viewport(0, 0, this.width, this.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(16640);
      gl.useProgram(this.geometryPass);
      this.stats.drawCalls = 0;
    }

    endGeometryPass() {
      const gl = this.gl;
      gl.bindFramebuffer(36160, null);
    }

    beginLightingPass() {
      const gl = this.gl;
      gl.useProgram(this.lightingPass);
      gl.activeTexture(33984);
      gl.bindTexture(3553, this.gBufferTextures.position);
      gl.uniform1i(gl.getUniformLocation(this.lightingPass, 'gPosition'), 0);
      gl.activeTexture(33985);
      gl.bindTexture(3553, this.gBufferTextures.normal);
      gl.uniform1i(gl.getUniformLocation(this.lightingPass, 'gNormal'), 1);
      gl.activeTexture(33986);
      gl.bindTexture(3553, this.gBufferTextures.albedo);
      gl.uniform1i(gl.getUniformLocation(this.lightingPass, 'gAlbedo'), 2);
      gl.activeTexture(33987);
      gl.bindTexture(3553, this.gBufferTextures.material);
      gl.uniform1i(gl.getUniformLocation(this.lightingPass, 'gMaterial'), 3);
      const enabledLights = this.lights.filter(l => l.enabled);
      gl.uniform1i(gl.getUniformLocation(this.lightingPass, 'uLightCount'), enabledLights.length);
      for (let i = 0; i < enabledLights.length; i++) {
        gl.uniform3fv(gl.getUniformLocation(this.lightingPass, `uLightPositions[${i}]`), enabledLights[i].position);
        gl.uniform3fv(gl.getUniformLocation(this.lightingPass, `uLightColors[${i}]`), enabledLights[i].color);
        gl.uniform1f(gl.getUniformLocation(this.lightingPass, `uLightIntensities[${i}]`), enabledLights[i].intensity);
        gl.uniform1f(gl.getUniformLocation(this.lightingPass, `uLightRadii[${i}]`), enabledLights[i].radius);
      }
      this.stats.lightsProcessed = enabledLights.length;
    }

    render(cameraPos) {
      const gl = this.gl;
      gl.uniform3fv(gl.getUniformLocation(this.lightingPass, 'uCameraPos'), cameraPos);
      gl.drawArrays(4, 0, 3);
      this.stats.drawCalls++;
    }

    resize(width, height) {
      this.width = width;
      this.height = height;
      if (this.gBuffer) {
        this._createGBuffer();
      }
    }

    getGBufferTextures() {
      return { ...this.gBufferTextures };
    }

    getStats() {
      return { ...this.stats };
    }

    getLightCount() {
      return this.lights.length;
    }

    getMaxLights() {
      return this.maxLights;
    }

    setEnabled(v) {
      this.enabled = v;
    }

    isEnabled() {
      return this.enabled;
    }

    clearLights() {
      this.lights = [];
    }

    dispose() {
      const gl = this.gl;
      if (this.gBuffer) gl.deleteFramebuffer(this.gBuffer);
      if (this.geometryPass) gl.deleteProgram(this.geometryPass);
      if (this.lightingPass) gl.deleteProgram(this.lightingPass);
      if (this.compositePass) gl.deleteProgram(this.compositePass);
      if (this.gBufferTextures) {
        for (const texture of Object.values(this.gBufferTextures)) {
          gl.deleteTexture(texture);
        }
      }
    }
  }

  class ShadowMapper {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.shadowMap = null;
      this.shadowMapSize = 2048;
      this.cascadeCount = 4;
      this.cascadeDistances = [10, 30, 80, 200];
      this.lightMatrix = null;
      this.bias = 0.005;
      this.normalBias = 0.02;
      this.pcfSamples = 16;
      this.enabled = true;
      this.shadowProgram = null;
    }

    init() {
      this._createShadowMap();
      this._createShadowProgram();
    }

    _createShadowMap() {
      const gl = this.gl;
      this.shadowMap = gl.createFramebuffer();
      gl.bindFramebuffer(36160, this.shadowMap);
      const depthTexture = gl.createTexture();
      gl.bindTexture(3553, depthTexture);
      gl.texImage2D(3553, 0, 36012, this.shadowMapSize, this.shadowMapSize, 0, 36012, 33635, null);
      gl.texParameteri(3553, 10241, 9729);
      gl.texParameteri(3553, 10240, 9729);
      gl.texParameteri(3553, 10242, 33071);
      gl.texParameteri(3553, 10243, 33071);
      gl.framebufferTexture2D(36160, 36096, 3553, depthTexture, 0);
      gl.drawBuffers([36064]);
      gl.bindFramebuffer(36160, null);
      this.depthTexture = depthTexture;
    }

    _createShadowProgram() {
      const gl = this.gl;
      const vs = `#version 300 es
precision highp float;
in vec3 aPosition;
uniform mat4 uLightMatrix;
uniform mat4 uModelMatrix;
void main() {
  gl_Position = uLightMatrix * uModelMatrix * vec4(aPosition, 1.0);
}`;
      const fs = `#version 300 es
precision highp float;
void main() {
  gl_FragDepth = gl_FragCoord.z;
}`;
      this.shadowProgram = this._compileProgram(vs, fs);
    }

    _compileProgram(vsSource, fsSource) {
      const gl = this.gl;
      const vs = gl.createShader(35633);
      gl.shaderSource(vs, vsSource);
      gl.compileShader(vs);
      const fs = gl.createShader(35632);
      gl.shaderSource(fs, fsSource);
      gl.compileShader(fs);
      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return program;
    }

    setLightMatrix(matrix) {
      this.lightMatrix = matrix;
    }

    begin() {
      const gl = this.gl;
      gl.bindFramebuffer(36160, this.shadowMap);
      gl.viewport(0, 0, this.shadowMapSize, this.shadowMapSize);
      gl.clear(256);
      gl.useProgram(this.shadowProgram);
      if (this.lightMatrix) {
        gl.uniformMatrix4fv(gl.getUniformLocation(this.shadowProgram, 'uLightMatrix'), false, this.lightMatrix);
      }
    }

    render(modelMatrix) {
      const gl = this.gl;
      gl.uniformMatrix4fv(gl.getUniformLocation(this.shadowProgram, 'uModelMatrix'), false, modelMatrix);
    }

    end() {
      const gl = this.gl;
      gl.bindFramebuffer(36160, null);
    }

    getShadowMap() {
      return this.depthTexture;
    }

    getLightMatrix() {
      return this.lightMatrix;
    }

    setBias(bias) {
      this.bias = bias;
    }

    setNormalBias(bias) {
      this.normalBias = bias;
    }

    setShadowMapSize(size) {
      this.shadowMapSize = size;
      this._createShadowMap();
    }

    setCascadeCount(count) {
      this.cascadeCount = Math.max(1, Math.min(4, count));
    }

    setCascadeDistances(distances) {
      this.cascadeDistances = distances;
    }

    setEnabled(v) {
      this.enabled = v;
    }

    isEnabled() {
      return this.enabled;
    }

    dispose() {
      const gl = this.gl;
      if (this.shadowMap) gl.deleteFramebuffer(this.shadowMap);
      if (this.shadowProgram) gl.deleteProgram(this.shadowProgram);
      if (this.depthTexture) gl.deleteTexture(this.depthTexture);
    }
  }

  class PostProcessPipeline {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.passes = [];
      this.inputTexture = null;
      this.outputFramebuffer = null;
      this.width = 0;
      this.height = 0;
      this.enabled = true;
      this.quadBuffer = null;
    }

    init(width, height) {
      this.width = width;
      this.height = height;
      this._createQuadBuffer();
    }

    _createQuadBuffer() {
      const gl = this.gl;
      this.quadBuffer = gl.createBuffer();
      gl.bindBuffer(34962, this.quadBuffer);
      gl.bufferData(34962, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 35044);
    }

    addPass(name, shader, uniforms = {}) {
      const gl = this.gl;
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(36160, framebuffer);
      const texture = gl.createTexture();
      gl.bindTexture(3553, texture);
      gl.texImage2D(3553, 0, 32856, this.width, this.height, 0, 6408, 5121, null);
      gl.texParameteri(3553, 10241, 9728);
      gl.texParameteri(3553, 10240, 9728);
      gl.framebufferTexture2D(36160, 36064, 3553, texture, 0);
      gl.bindFramebuffer(36160, null);
      const program = this._compileProgram(shader.vertex, shader.fragment);
      this.passes.push({
        name,
        program,
        framebuffer,
        texture,
        uniforms,
        enabled: true
      });
      return this.passes.length - 1;
    }

    _compileProgram(vsSource, fsSource) {
      const gl = this.gl;
      const vs = gl.createShader(35633);
      gl.shaderSource(vs, vsSource);
      gl.compileShader(vs);
      const fs = gl.createShader(35632);
      gl.shaderSource(fs, fsSource);
      gl.compileShader(fs);
      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return program;
    }

    setPassEnabled(index, enabled) {
      if (this.passes[index]) {
        this.passes[index].enabled = enabled;
      }
    }

    updatePassUniform(index, name, value) {
      if (this.passes[index]) {
        this.passes[index].uniforms[name] = value;
      }
    }

    render(inputTexture) {
      if (!this.enabled) return inputTexture;
      const gl = this.gl;
      let currentTexture = inputTexture;
      gl.bindBuffer(34962, this.quadBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, 5126, false, 0, 0);
      for (let i = 0; i < this.passes.length; i++) {
        const pass = this.passes[i];
        if (!pass.enabled) continue;
        gl.bindFramebuffer(36160, pass.framebuffer);
        gl.viewport(0, 0, this.width, this.height);
        gl.useProgram(pass.program);
        gl.activeTexture(33984);
        gl.bindTexture(3553, currentTexture);
        gl.uniform1i(gl.getUniformLocation(pass.program, 'uTexture'), 0);
        for (const [name, value] of Object.entries(pass.uniforms)) {
          const location = gl.getUniformLocation(pass.program, name);
          if (location !== -1) {
            if (typeof value === 'number') {
              gl.uniform1f(location, value);
            } else if (Array.isArray(value)) {
              if (value.length === 2) gl.uniform2fv(location, value);
              else if (value.length === 3) gl.uniform3fv(location, value);
              else if (value.length === 4) gl.uniform4fv(location, value);
            }
          }
        }
        gl.drawArrays(5, 0, 4);
        currentTexture = pass.texture;
      }
      gl.bindFramebuffer(36160, null);
      return currentTexture;
    }

    resize(width, height) {
      this.width = width;
      this.height = height;
      const gl = this.gl;
      for (const pass of this.passes) {
        gl.bindTexture(3553, pass.texture);
        gl.texImage2D(3553, 0, 32856, width, height, 0, 6408, 5121, null);
      }
    }

    getPassCount() {
      return this.passes.length;
    }

    getPass(index) {
      return this.passes[index];
    }

    removePass(index) {
      const gl = this.gl;
      const pass = this.passes[index];
      if (pass) {
        gl.deleteFramebuffer(pass.framebuffer);
        gl.deleteProgram(pass.program);
        gl.deleteTexture(pass.texture);
        this.passes.splice(index, 1);
      }
    }

    setEnabled(v) {
      this.enabled = v;
    }

    isEnabled() {
      return this.enabled;
    }

    clear() {
      const gl = this.gl;
      for (const pass of this.passes) {
        gl.deleteFramebuffer(pass.framebuffer);
        gl.deleteProgram(pass.program);
        gl.deleteTexture(pass.texture);
      }
      this.passes = [];
    }

    dispose() {
      this.clear();
      if (this.quadBuffer) this.gl.deleteBuffer(this.quadBuffer);
    }
  }

  class ParticleSystem {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.emitters = new Map();
      this.maxParticles = 10000;
      this.enabled = true;
      this.stats = { totalParticles: 0, activeEmitters: 0, drawCalls: 0 };
    }

    createEmitter(name, config = {}) {
      const emitter = {
        name,
        position: config.position || [0, 0, 0],
        direction: config.direction || [0, 1, 0],
        spread: config.spread || 0.5,
        rate: config.rate || 10,
        life: config.life || 2,
        size: config.size || 0.1,
        sizeVariation: config.sizeVariation || 0.5,
        speed: config.speed || 1,
        speedVariation: config.speedVariation || 0.5,
        color: config.color || [1, 1, 1],
        colorEnd: config.colorEnd || [1, 1, 1],
        opacity: config.opacity || 1,
        gravity: config.gravity || [0, -9.8, 0],
        drag: config.drag || 0.1,
        blendMode: config.blendMode || 'additive',
        texture: config.texture || null,
        maxParticles: config.maxParticles || 1000,
        particles: [],
        active: config.active !== false,
        emissionAccumulator: 0
      };
      this.emitters.set(name, emitter);
      return emitter;
    }

    removeEmitter(name) {
      this.emitters.delete(name);
    }

    update(deltaTime) {
      if (!this.enabled) return;
      this.stats.totalParticles = 0;
      this.stats.activeEmitters = 0;
      for (const emitter of this.emitters.values()) {
        if (!emitter.active) continue;
        this.stats.activeEmitters++;
        if (emitter.rate > 0) {
          emitter.emissionAccumulator += emitter.rate * deltaTime;
          while (emitter.emissionAccumulator >= 1 && emitter.particles.length < emitter.maxParticles) {
            this._emitParticle(emitter);
            emitter.emissionAccumulator -= 1;
          }
        }
        for (let i = emitter.particles.length - 1; i >= 0; i--) {
          const particle = emitter.particles[i];
          particle.life -= deltaTime;
          if (particle.life <= 0) {
            emitter.particles.splice(i, 1);
            continue;
          }
          particle.velocity[0] += emitter.gravity[0] * deltaTime;
          particle.velocity[1] += emitter.gravity[1] * deltaTime;
          particle.velocity[2] += emitter.gravity[2] * deltaTime;
          const dragFactor = 1 - emitter.drag * deltaTime;
          particle.velocity[0] *= dragFactor;
          particle.velocity[1] *= dragFactor;
          particle.velocity[2] *= dragFactor;
          particle.position[0] += particle.velocity[0] * deltaTime;
          particle.position[1] += particle.velocity[1] * deltaTime;
          particle.position[2] += particle.velocity[2] * deltaTime;
          particle.age += deltaTime;
        }
        this.stats.totalParticles += emitter.particles.length;
      }
    }

    _emitParticle(emitter) {
      const direction = [...emitter.direction];
      const spread = emitter.spread;
      direction[0] += (Math.random() - 0.5) * spread;
      direction[1] += (Math.random() - 0.5) * spread;
      direction[2] += (Math.random() - 0.5) * spread;
      const length = Math.sqrt(direction[0]**2 + direction[1]**2 + direction[2]**2) || 1;
      direction[0] /= length;
      direction[1] /= length;
      direction[2] /= length;
      const speed = emitter.speed * (1 + (Math.random() - 0.5) * emitter.speedVariation);
      const size = emitter.size * (1 + (Math.random() - 0.5) * emitter.sizeVariation);
      emitter.particles.push({
        position: [...emitter.position],
        velocity: [direction[0] * speed, direction[1] * speed, direction[2] * speed],
        life: emitter.life * (0.8 + Math.random() * 0.4),
        age: 0,
        size,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 2
      });
    }

    getEmitter(name) {
      return this.emitters.get(name);
    }

    getEmitterNames() {
      return Array.from(this.emitters.keys());
    }

    getEmitterCount() {
      return this.emitters.size;
    }

    getParticles(emitterName) {
      const emitter = this.emitters.get(emitterName);
      return emitter ? emitter.particles : [];
    }

    setEmitterActive(name, active) {
      const emitter = this.emitters.get(name);
      if (emitter) emitter.active = active;
    }

    setEmitterPosition(name, position) {
      const emitter = this.emitters.get(name);
      if (emitter) emitter.position = [...position];
    }

    burst(emitterName, count = 50) {
      const emitter = this.emitters.get(emitterName);
      if (!emitter) return;
      for (let i = 0; i < count && emitter.particles.length < emitter.maxParticles; i++) {
        this._emitParticle(emitter);
      }
    }

    getStats() {
      return { ...this.stats };
    }

    setEnabled(v) {
      this.enabled = v;
    }

    isEnabled() {
      return this.enabled;
    }

    clear() {
      this.emitters.clear();
    }

    dispose() {
      this.clear();
    }
  }

  return {
    DeferredRenderer, ShadowMapper, PostProcessPipeline, ParticleSystem
  };
})();

if (typeof window !== 'undefined') window.SpiritRendererV4 = SpiritRendererV4;
if (typeof globalThis !== 'undefined') globalThis.SpiritRendererV4 = SpiritRendererV4;
