/**
 * 渲染引擎 - 延迟渲染/阴影映射/后处理管线/粒子系统/光照管理
 * 纯WebGL2，零第三方依赖
 * @version 3.0.0
 */
'use strict';

const SpiritRendererV3 = (function () {

  class DeferredRenderer {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.gBuffer = null;
      this.geometryPassShader = null;
      this.lightingPassShader = null;
      this.compositeShader = null;
      this.width = 1024;
      this.height = 1024;
      this.lights = [];
      this.enabled = true;
      this.stats = {
        drawCalls: 0,
        triangles: 0,
        lightsProcessed: 0
      };
    }

    init(width, height) {
      this.width = width;
      this.height = height;
      this._createGBuffer();
      this._createShaders();
    }

    _createGBuffer() {
      const gl = this.gl;
      const gBuffer = gl.createFramebuffer();
      gl.bindFramebuffer(36160, gBuffer);
      const positionTexture = this._createTexture(34836, 6408, 5126);
      const normalTexture = this._createTexture(34836, 6408, 5126);
      const albedoTexture = this._createTexture(34836, 6408, 5121);
      const materialTexture = this._createTexture(34836, 6408, 5126);
      const depthTexture = gl.createTexture();
      gl.bindTexture(3553, depthTexture);
      gl.texImage2D(3553, 0, 36012, this.width, this.height, 0, 36012, 33635, null);
      gl.texParameteri(3553, 10241, 9729);
      gl.texParameteri(3553, 10240, 9729);
      gl.texParameteri(3553, 10242, 33071);
      gl.texParameteri(3553, 10243, 33071);
      gl.framebufferTexture2D(36160, 36064, 3553, positionTexture, 0);
      gl.framebufferTexture2D(36160, 36065, 3553, normalTexture, 0);
      gl.framebufferTexture2D(36160, 36066, 3553, albedoTexture, 0);
      gl.framebufferTexture2D(36160, 36067, 3553, materialTexture, 0);
      gl.framebufferTexture2D(36160, 36096, 3553, depthTexture, 0);
      gl.drawBuffers([36064, 36065, 36066, 36067]);
      gl.bindFramebuffer(36160, null);
      this.gBuffer = {
        framebuffer: gBuffer,
        positionTexture,
        normalTexture,
        albedoTexture,
        materialTexture,
        depthTexture
      };
    }

    _createTexture(internalFormat, format, type) {
      const gl = this.gl;
      const texture = gl.createTexture();
      gl.bindTexture(3553, texture);
      gl.texImage2D(3553, 0, internalFormat, this.width, this.height, 0, format, type, null);
      gl.texParameteri(3553, 10241, 9729);
      gl.texParameteri(3553, 10240, 9729);
      gl.texParameteri(3553, 10242, 33071);
      gl.texParameteri(3553, 10243, 33071);
      return texture;
    }

    _createShaders() {
      const geometryVS = `#version 300 es
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
      const geometryFS = `#version 300 es
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
void main() {
  gPosition = vec4(vWorldPos, 1.0);
  gNormal = vec4(normalize(vNormal), 1.0);
  gAlbedo = vec4(uAlbedo, 1.0);
  gMaterial = vec4(uRoughness, uMetallic, 0.0, 1.0);
}`;
      const lightingVS = `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vUV;
void main() {
  vUV = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;
      const lightingFS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uPositionTexture;
uniform sampler2D uNormalTexture;
uniform sampler2D uAlbedoTexture;
uniform sampler2D uMaterialTexture;
uniform vec3 uCameraPos;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uLightIntensity;
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
  vec3 worldPos = texture(uPositionTexture, vUV).rgb;
  vec3 normal = texture(uNormalTexture, vUV).rgb;
  vec3 albedo = texture(uAlbedoTexture, vUV).rgb;
  vec2 material = texture(uMaterialTexture, vUV).rg;
  float roughness = material.r;
  float metallic = material.g;
  if (length(worldPos) < 0.001) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec3 N = normalize(normal);
  vec3 V = normalize(uCameraPos - worldPos);
  vec3 L = normalize(uLightDir);
  vec3 H = normalize(V + L);
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
  vec3 Lo = (kD * albedo / 3.14159265 + specular) * uLightColor * uLightIntensity * NdotL;
  vec3 ambient = vec3(0.03) * albedo;
  vec3 color = ambient + Lo;
  fragColor = vec4(color, 1.0);
}`;
      this.geometryPassShader = this._compileShader(geometryVS, geometryFS);
      this.lightingPassShader = this._compileShader(lightingVS, lightingFS);
    }

    _compileShader(vertexSource, fragmentSource) {
      const gl = this.gl;
      const vs = gl.createShader(35633);
      gl.shaderSource(vs, vertexSource);
      gl.compileShader(vs);
      const fs = gl.createShader(35632);
      gl.shaderSource(fs, fragmentSource);
      gl.compileShader(fs);
      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return program;
    }

    geometryPass() {
      if (!this.enabled || !this.gBuffer) return;
      const gl = this.gl;
      gl.bindFramebuffer(36160, this.gBuffer.framebuffer);
      gl.viewport(0, 0, this.width, this.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(16384 | 256);
      gl.useProgram(this.geometryPassShader);
      gl.enable(2929);
      gl.depthMask(true);
      gl.disable(3042);
    }

    lightingPass(cameraPosition, lightDirection, lightColor, lightIntensity) {
      if (!this.enabled || !this.gBuffer) return;
      const gl = this.gl;
      gl.bindFramebuffer(36160, null);
      gl.viewport(0, 0, this.width, this.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(16384);
      gl.useProgram(this.lightingPassShader);
      gl.disable(2929);
      gl.depthMask(false);
      gl.activeTexture(33984);
      gl.bindTexture(3553, this.gBuffer.positionTexture);
      gl.uniform1i(gl.getUniformLocation(this.lightingPassShader, 'uPositionTexture'), 0);
      gl.activeTexture(33985);
      gl.bindTexture(3553, this.gBuffer.normalTexture);
      gl.uniform1i(gl.getUniformLocation(this.lightingPassShader, 'uNormalTexture'), 1);
      gl.activeTexture(33986);
      gl.bindTexture(3553, this.gBuffer.albedoTexture);
      gl.uniform1i(gl.getUniformLocation(this.lightingPassShader, 'uAlbedoTexture'), 2);
      gl.activeTexture(33987);
      gl.bindTexture(3553, this.gBuffer.materialTexture);
      gl.uniform1i(gl.getUniformLocation(this.lightingPassShader, 'uMaterialTexture'), 3);
      gl.uniform3fv(gl.getUniformLocation(this.lightingPassShader, 'uCameraPos'), cameraPosition);
      gl.uniform3fv(gl.getUniformLocation(this.lightingPassShader, 'uLightDir'), lightDirection);
      gl.uniform3fv(gl.getUniformLocation(this.lightingPassShader, 'uLightColor'), lightColor);
      gl.uniform1f(gl.getUniformLocation(this.lightingPassShader, 'uLightIntensity'), lightIntensity);
      this._drawFullscreenQuad();
      this.stats.lightsProcessed = 1;
    }

    _drawFullscreenQuad() {
      const gl = this.gl;
      const buffer = gl.createBuffer();
      gl.bindBuffer(34962, buffer);
      gl.bufferData(34962, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 35044);
      const positionLocation = gl.getAttribLocation(this.lightingPassShader, 'aPosition');
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, 5126, false, 0, 0);
      gl.drawArrays(5, 0, 4);
      gl.deleteBuffer(buffer);
    }

    addLight(config) {
      const light = {
        type: config.type || 'directional',
        position: config.position || [0, 0, 0],
        direction: config.direction || [0, -1, 0],
        color: config.color || [1, 1, 1],
        intensity: config.intensity || 1,
        range: config.range || 10,
        angle: config.angle || Math.PI / 4,
        penumbra: config.penumbra || 0.5,
        castShadow: config.castShadow || false,
        shadowMap: config.shadowMap || null,
        shadowMatrix: config.shadowMatrix || null
      };
      this.lights.push(light);
      return light;
    }

    removeLight(index) {
      this.lights.splice(index, 1);
    }

    getLights() {
      return [...this.lights];
    }

    getLightCount() {
      return this.lights.length;
    }

    resize(width, height) {
      this.width = width;
      this.height = height;
      if (this.gBuffer) {
        this._disposeGBuffer();
        this._createGBuffer();
      }
    }

    _disposeGBuffer() {
      const gl = this.gl;
      gl.deleteFramebuffer(this.gBuffer.framebuffer);
      gl.deleteTexture(this.gBuffer.positionTexture);
      gl.deleteTexture(this.gBuffer.normalTexture);
      gl.deleteTexture(this.gBuffer.albedoTexture);
      gl.deleteTexture(this.gBuffer.materialTexture);
      gl.deleteTexture(this.gBuffer.depthTexture);
    }

    setEnabled(enabled) {
      this.enabled = enabled;
    }

    getStats() {
      return { ...this.stats };
    }

    dispose() {
      this._disposeGBuffer();
      const gl = this.gl;
      if (this.geometryPassShader) gl.deleteProgram(this.geometryPassShader);
      if (this.lightingPassShader) gl.deleteProgram(this.lightingPassShader);
      if (this.compositeShader) gl.deleteProgram(this.compositeShader);
      this.lights = [];
    }
  }

  class ShadowMapper {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.shadowMaps = new Map();
      this.shadowShader = null;
      this.shadowResolution = 2048;
      this.bias = 0.005;
      this.normalBias = 0.02;
      this.pcfSamples = 4;
      this.enabled = true;
      this.stats = {
        shadowMapsCreated: 0,
        shadowDrawCalls: 0
      };
    }

    init() {
      this._createShadowShader();
    }

    _createShadowShader() {
      const vs = `#version 300 es
precision highp float;
in vec3 aPosition;
uniform mat4 uModelMatrix;
uniform mat4 uLightViewMatrix;
uniform mat4 uLightProjectionMatrix;
void main() {
  gl_Position = uLightProjectionMatrix * uLightViewMatrix * uModelMatrix * vec4(aPosition, 1.0);
}`;
      const fs = `#version 300 es
precision highp float;
out vec4 fragColor;
void main() {
  fragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0);
}`;
      this.shadowShader = this._compileShader(vs, fs);
    }

    _compileShader(vertexSource, fragmentSource) {
      const gl = this.gl;
      const vs = gl.createShader(35633);
      gl.shaderSource(vs, vertexSource);
      gl.compileShader(vs);
      const fs = gl.createShader(35632);
      gl.shaderSource(fs, fragmentSource);
      gl.compileShader(fs);
      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return program;
    }

    createShadowMap(name, resolution = this.shadowResolution) {
      const gl = this.gl;
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(36160, framebuffer);
      const depthTexture = gl.createTexture();
      gl.bindTexture(3553, depthTexture);
      gl.texImage2D(3553, 0, 36012, resolution, resolution, 0, 36012, 33635, null);
      gl.texParameteri(3553, 10241, 9729);
      gl.texParameteri(3553, 10240, 9729);
      gl.texParameteri(3553, 10242, 33071);
      gl.texParameteri(3553, 10243, 33071);
      gl.framebufferTexture2D(36160, 36096, 3553, depthTexture, 0);
      gl.drawBuffers([36064]);
      gl.bindFramebuffer(36160, null);
      const shadowMap = {
        name,
        framebuffer,
        depthTexture,
        resolution,
        lightViewMatrix: new Float32Array(16),
        lightProjectionMatrix: new Float32Array(16)
      };
      this.shadowMaps.set(name, shadowMap);
      this.stats.shadowMapsCreated++;
      return shadowMap;
    }

    beginShadowPass(name, lightViewMatrix, lightProjectionMatrix) {
      if (!this.enabled) return;
      const shadowMap = this.shadowMaps.get(name);
      if (!shadowMap) return;
      const gl = this.gl;
      shadowMap.lightViewMatrix.set(lightViewMatrix);
      shadowMap.lightProjectionMatrix.set(lightProjectionMatrix);
      gl.bindFramebuffer(36160, shadowMap.framebuffer);
      gl.viewport(0, 0, shadowMap.resolution, shadowMap.resolution);
      gl.clear(256);
      gl.useProgram(this.shadowShader);
      gl.enable(2929);
      gl.depthMask(true);
      gl.cullFace(1028);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.shadowShader, 'uLightViewMatrix'), false, lightViewMatrix);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.shadowShader, 'uLightProjectionMatrix'), false, lightProjectionMatrix);
    }

    endShadowPass() {
      if (!this.enabled) return;
      const gl = this.gl;
      gl.bindFramebuffer(36160, null);
      gl.cullFace(1029);
    }

    setModelMatrix(modelMatrix) {
      if (!this.enabled || !this.shadowShader) return;
      const gl = this.gl;
      gl.uniformMatrix4fv(gl.getUniformLocation(this.shadowShader, 'uModelMatrix'), false, modelMatrix);
    }

    getShadowMap(name) {
      return this.shadowMaps.get(name);
    }

    getShadowMapNames() {
      return Array.from(this.shadowMaps.keys());
    }

    getShadowMapCount() {
      return this.shadowMaps.size;
    }

    removeShadowMap(name) {
      const shadowMap = this.shadowMaps.get(name);
      if (shadowMap) {
        const gl = this.gl;
        gl.deleteFramebuffer(shadowMap.framebuffer);
        gl.deleteTexture(shadowMap.depthTexture);
        this.shadowMaps.delete(name);
      }
    }

    setShadowResolution(resolution) {
      this.shadowResolution = resolution;
    }

    setBias(bias) {
      this.bias = bias;
    }

    setNormalBias(normalBias) {
      this.normalBias = normalBias;
    }

    setPCFSamples(samples) {
      this.pcfSamples = Math.max(1, Math.min(16, samples));
    }

    setEnabled(enabled) {
      this.enabled = enabled;
    }

    getStats() {
      return { ...this.stats };
    }

    dispose() {
      for (const name of this.shadowMaps.keys()) {
        this.removeShadowMap(name);
      }
      if (this.shadowShader) {
        this.gl.deleteProgram(this.shadowShader);
      }
    }
  }

  class PostProcessingPipeline {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.passes = [];
      this.inputFramebuffer = null;
      this.outputFramebuffer = null;
      this.width = 1024;
      this.height = 1024;
      this.enabled = true;
      this.stats = {
        passesExecuted: 0,
        totalTime: 0
      };
    }

    init(width, height) {
      this.width = width;
      this.height = height;
      this.inputFramebuffer = this._createFramebuffer();
      this.outputFramebuffer = this._createFramebuffer();
    }

    _createFramebuffer() {
      const gl = this.gl;
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(36160, framebuffer);
      const texture = gl.createTexture();
      gl.bindTexture(3553, texture);
      gl.texImage2D(3553, 0, 34836, this.width, this.height, 0, 6408, 5126, null);
      gl.texParameteri(3553, 10241, 9729);
      gl.texParameteri(3553, 10240, 9729);
      gl.texParameteri(3553, 10242, 33071);
      gl.texParameteri(3553, 10243, 33071);
      gl.framebufferTexture2D(36160, 36064, 3553, texture, 0);
      gl.bindFramebuffer(36160, null);
      return { framebuffer, texture };
    }

    addPass(config) {
      const pass = {
        name: config.name || `pass_${this.passes.length}`,
        type: config.type || 'custom',
        shader: config.shader || null,
        uniforms: config.uniforms || {},
        enabled: config.enabled !== false,
        order: config.order || this.passes.length
      };
      if (config.vertexShader && config.fragmentShader) {
        pass.shader = this._compileShader(config.vertexShader, config.fragmentShader);
      }
      this.passes.push(pass);
      this.passes.sort((a, b) => a.order - b.order);
      return pass;
    }

    addBloomPass(intensity = 0.5, threshold = 0.8) {
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
uniform sampler2D uTexture;
uniform float uIntensity;
uniform float uThreshold;
void main() {
  vec3 color = texture(uTexture, vUV).rgb;
  float brightness = dot(color, vec3(0.2126, 0.7152, 0.0722));
  if (brightness > uThreshold) {
    fragColor = vec4(color * uIntensity, 1.0);
  } else {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
  }
}`;
      return this.addPass({
        name: 'bloom_extract',
        type: 'bloom',
        vertexShader: vs,
        fragmentShader: fs,
        uniforms: { uIntensity: intensity, uThreshold: threshold }
      });
    }

    addBlurPass(direction = [1, 0], radius = 4) {
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
uniform sampler2D uTexture;
uniform vec2 uDirection;
uniform float uRadius;
void main() {
  vec2 texelSize = 1.0 / vec2(textureSize(uTexture, 0));
  vec3 result = vec3(0.0);
  float totalWeight = 0.0;
  for (float i = -uRadius; i <= uRadius; i++) {
    float weight = exp(-i * i / (2.0 * uRadius * uRadius / 4.0));
    vec2 offset = uDirection * i * texelSize;
    result += texture(uTexture, vUV + offset).rgb * weight;
    totalWeight += weight;
  }
  fragColor = vec4(result / totalWeight, 1.0);
}`;
      return this.addPass({
        name: `blur_${direction[0] > 0 ? 'horizontal' : 'vertical'}`,
        type: 'blur',
        vertexShader: vs,
        fragmentShader: fs,
        uniforms: { uDirection: direction, uRadius: radius }
      });
    }

    addToneMappingPass(exposure = 1.0, gamma = 2.2) {
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
uniform sampler2D uTexture;
uniform float uExposure;
uniform float uGamma;
void main() {
  vec3 color = texture(uTexture, vUV).rgb;
  color = vec3(1.0) - exp(-color * uExposure);
  color = pow(color, vec3(1.0 / uGamma));
  fragColor = vec4(color, 1.0);
}`;
      return this.addPass({
        name: 'tone_mapping',
        type: 'tone_mapping',
        vertexShader: vs,
        fragmentShader: fs,
        uniforms: { uExposure: exposure, uGamma: gamma }
      });
    }

    addSSAOPass(radius = 0.5, intensity = 1.0) {
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
uniform sampler2D uPositionTexture;
uniform sampler2D uNormalTexture;
uniform sampler2D uNoiseTexture;
uniform float uRadius;
uniform float uIntensity;
uniform vec3 uSamples[32];
uniform mat4 uProjectionMatrix;
void main() {
  vec3 worldPos = texture(uPositionTexture, vUV).rgb;
  vec3 normal = texture(uNormalTexture, vUV).rgb;
  if (length(worldPos) < 0.001) {
    fragColor = vec4(1.0);
    return;
  }
  vec3 randomVec = normalize(texture(uNoiseTexture, vUV * 10.0).rgb * 2.0 - 1.0);
  vec3 tangent = normalize(randomVec - normal * dot(randomVec, normal));
  vec3 bitangent = cross(normal, tangent);
  mat3 TBN = mat3(tangent, bitangent, normal);
  float occlusion = 0.0;
  for (int i = 0; i < 32; i++) {
    vec3 samplePos = TBN * uSamples[i];
    samplePos = worldPos + samplePos * uRadius;
    vec4 offset = uProjectionMatrix * vec4(samplePos, 1.0);
    offset.xyz /= offset.w;
    offset.xyz = offset.xyz * 0.5 + 0.5;
    float sampleDepth = texture(uPositionTexture, offset.xy).z;
    float rangeCheck = smoothstep(0.0, 1.0, uRadius / abs(worldPos.z - sampleDepth));
    occlusion += (sampleDepth >= samplePos.z + 0.025 ? 1.0 : 0.0) * rangeCheck;
  }
  occlusion = 1.0 - (occlusion / 32.0) * uIntensity;
  fragColor = vec4(vec3(occlusion), 1.0);
}`;
      return this.addPass({
        name: 'ssao',
        type: 'ssao',
        vertexShader: vs,
        fragmentShader: fs,
        uniforms: { uRadius: radius, uIntensity: intensity }
      });
    }

    _compileShader(vertexSource, fragmentSource) {
      const gl = this.gl;
      const vs = gl.createShader(35633);
      gl.shaderSource(vs, vertexSource);
      gl.compileShader(vs);
      const fs = gl.createShader(35632);
      gl.shaderSource(fs, fragmentSource);
      gl.compileShader(fs);
      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return program;
    }

    execute(inputTexture) {
      if (!this.enabled) return inputTexture;
      const gl = this.gl;
      let currentTexture = inputTexture;
      let currentFramebuffer = this.outputFramebuffer;
      this.stats.passesExecuted = 0;
      const startTime = performance.now();
      for (const pass of this.passes) {
        if (!pass.enabled || !pass.shader) continue;
        gl.bindFramebuffer(36160, currentFramebuffer.framebuffer);
        gl.viewport(0, 0, this.width, this.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(16384);
        gl.useProgram(pass.shader);
        gl.disable(2929);
        gl.activeTexture(33984);
        gl.bindTexture(3553, currentTexture);
        gl.uniform1i(gl.getUniformLocation(pass.shader, 'uTexture'), 0);
        for (const [name, value] of Object.entries(pass.uniforms)) {
          const location = gl.getUniformLocation(pass.shader, name);
          if (location === null) continue;
          if (typeof value === 'number') {
            gl.uniform1f(location, value);
          } else if (Array.isArray(value)) {
            if (value.length === 2) gl.uniform2fv(location, value);
            else if (value.length === 3) gl.uniform3fv(location, value);
            else if (value.length === 4) gl.uniform4fv(location, value);
          }
        }
        this._drawFullscreenQuad(pass.shader);
        currentTexture = currentFramebuffer.texture;
        currentFramebuffer = currentFramebuffer === this.outputFramebuffer ? this.inputFramebuffer : this.outputFramebuffer;
        this.stats.passesExecuted++;
      }
      this.stats.totalTime = performance.now() - startTime;
      return currentTexture;
    }

    _drawFullscreenQuad(shader) {
      const gl = this.gl;
      const buffer = gl.createBuffer();
      gl.bindBuffer(34962, buffer);
      gl.bufferData(34962, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 35044);
      const positionLocation = gl.getAttribLocation(shader, 'aPosition');
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, 5126, false, 0, 0);
      gl.drawArrays(5, 0, 4);
      gl.deleteBuffer(buffer);
    }

    getPass(name) {
      return this.passes.find(p => p.name === name);
    }

    getPassNames() {
      return this.passes.map(p => p.name);
    }

    getPassCount() {
      return this.passes.length;
    }

    setPassEnabled(name, enabled) {
      const pass = this.getPass(name);
      if (pass) pass.enabled = enabled;
    }

    setPassUniform(name, uniformName, value) {
      const pass = this.getPass(name);
      if (pass) pass.uniforms[uniformName] = value;
    }

    removePass(name) {
      const index = this.passes.findIndex(p => p.name === name);
      if (index !== -1) {
        const pass = this.passes[index];
        if (pass.shader) {
          this.gl.deleteProgram(pass.shader);
        }
        this.passes.splice(index, 1);
      }
    }

    resize(width, height) {
      this.width = width;
      this.height = height;
      if (this.inputFramebuffer) {
        this._disposeFramebuffer(this.inputFramebuffer);
        this._disposeFramebuffer(this.outputFramebuffer);
        this.inputFramebuffer = this._createFramebuffer();
        this.outputFramebuffer = this._createFramebuffer();
      }
    }

    _disposeFramebuffer(fbo) {
      const gl = this.gl;
      gl.deleteFramebuffer(fbo.framebuffer);
      gl.deleteTexture(fbo.texture);
    }

    setEnabled(enabled) {
      this.enabled = enabled;
    }

    getStats() {
      return { ...this.stats };
    }

    dispose() {
      for (const pass of this.passes) {
        if (pass.shader) {
          this.gl.deleteProgram(pass.shader);
        }
      }
      this.passes = [];
      if (this.inputFramebuffer) this._disposeFramebuffer(this.inputFramebuffer);
      if (this.outputFramebuffer) this._disposeFramebuffer(this.outputFramebuffer);
    }
  }

  class ParticleSystem {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.emitters = [];
      this.maxParticles = 10000;
      this.enabled = true;
      this.stats = {
        totalParticles: 0,
        activeParticles: 0,
        emitters: 0
      };
    }

    createEmitter(config) {
      const emitter = {
        name: config.name || `emitter_${this.emitters.length}`,
        position: config.position || [0, 0, 0],
        direction: config.direction || [0, 1, 0],
        spread: config.spread || 0.5,
        rate: config.rate || 10,
        life: config.life || 2,
        size: config.size || 0.1,
        sizeVariation: config.sizeVariation || 0.2,
        speed: config.speed || 1,
        speedVariation: config.speedVariation || 0.3,
        color: config.color || [1, 1, 1, 1],
        colorEnd: config.colorEnd || [1, 1, 1, 0],
        gravity: config.gravity || [0, -9.8, 0],
        drag: config.drag || 0.1,
        blending: config.blending || 'additive',
        texture: config.texture || null,
        enabled: config.enabled !== false,
        particles: [],
        emissionAccumulator: 0
      };
      this.emitters.push(emitter);
      this.stats.emitters++;
      return emitter;
    }

    removeEmitter(name) {
      const index = this.emitters.findIndex(e => e.name === name);
      if (index !== -1) {
        this.emitters.splice(index, 1);
        this.stats.emitters--;
      }
    }

    update(deltaTime) {
      if (!this.enabled) return;
      this.stats.activeParticles = 0;
      for (const emitter of this.emitters) {
        if (!emitter.enabled) continue;
        emitter.emissionAccumulator += emitter.rate * deltaTime;
        while (emitter.emissionAccumulator >= 1) {
          emitter.emissionAccumulator -= 1;
          if (emitter.particles.length < this.maxParticles) {
            this._emitParticle(emitter);
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
          particle.velocity[0] *= (1 - emitter.drag * deltaTime);
          particle.velocity[1] *= (1 - emitter.drag * deltaTime);
          particle.velocity[2] *= (1 - emitter.drag * deltaTime);
          particle.position[0] += particle.velocity[0] * deltaTime;
          particle.position[1] += particle.velocity[1] * deltaTime;
          particle.position[2] += particle.velocity[2] * deltaTime;
          particle.age += deltaTime;
          this.stats.activeParticles++;
        }
      }
      this.stats.totalParticles = this.emitters.reduce((sum, e) => sum + e.particles.length, 0);
    }

    _emitParticle(emitter) {
      const direction = this._normalize([
        emitter.direction[0] + (Math.random() - 0.5) * emitter.spread,
        emitter.direction[1] + (Math.random() - 0.5) * emitter.spread,
        emitter.direction[2] + (Math.random() - 0.5) * emitter.spread
      ]);
      const speed = emitter.speed * (1 + (Math.random() - 0.5) * emitter.speedVariation);
      const size = emitter.size * (1 + (Math.random() - 0.5) * emitter.sizeVariation);
      const particle = {
        position: [...emitter.position],
        velocity: [direction[0] * speed, direction[1] * speed, direction[2] * speed],
        life: emitter.life * (0.8 + Math.random() * 0.4),
        maxLife: emitter.life,
        age: 0,
        size,
        color: [...emitter.color],
        rotation: Math.random() * Math.PI * 2,
        angularVelocity: (Math.random() - 0.5) * 2
      };
      emitter.particles.push(particle);
    }

    _normalize(v) {
      const l = Math.sqrt(v[0]**2 + v[1]**2 + v[2]**2) || 1;
      return [v[0]/l, v[1]/l, v[2]/l];
    }

    getEmitter(name) {
      return this.emitters.find(e => e.name === name);
    }

    getEmitterNames() {
      return this.emitters.map(e => e.name);
    }

    getEmitterCount() {
      return this.emitters.length;
    }

    setEmitterEnabled(name, enabled) {
      const emitter = this.getEmitter(name);
      if (emitter) emitter.enabled = enabled;
    }

    setEmitterPosition(name, x, y, z) {
      const emitter = this.getEmitter(name);
      if (emitter) emitter.position = [x, y, z];
    }

    burst(name, count = 50) {
      const emitter = this.getEmitter(name);
      if (!emitter) return;
      for (let i = 0; i < count; i++) {
        if (emitter.particles.length < this.maxParticles) {
          this._emitParticle(emitter);
        }
      }
    }

    clearEmitter(name) {
      const emitter = this.getEmitter(name);
      if (emitter) emitter.particles = [];
    }

    setMaxParticles(max) {
      this.maxParticles = Math.max(1, max);
    }

    setEnabled(enabled) {
      this.enabled = enabled;
    }

    getStats() {
      return { ...this.stats };
    }

    dispose() {
      this.emitters = [];
      this.stats = { totalParticles: 0, activeParticles: 0, emitters: 0 };
    }
  }

  return {
    DeferredRenderer, ShadowMapper, PostProcessingPipeline, ParticleSystem
  };
})();

if (typeof window !== 'undefined') window.SpiritRendererV3 = SpiritRendererV3;
if (typeof globalThis !== 'undefined') globalThis.SpiritRendererV3 = SpiritRendererV3;
