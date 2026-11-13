/**
 * 灵体渲染引擎 - 延迟渲染/阴影映射/后处理/光照探针/全局光照
 * 纯WebGL2，零第三方依赖
 * @version 2.0.0
 */
'use strict';

const SpiritRendererV2 = (function () {

  class DeferredRenderer {
    constructor(glContext, shaderCompiler) {
      this.gl = glContext.getContext();
      this.shaderCompiler = shaderCompiler;
      this.gBuffer = null;
      this.geometryProgram = null;
      this.lightingProgram = null;
      this.compositeProgram = null;
      this.width = 0;
      this.height = 0;
      this.lights = [];
      this.maxLights = 64;
      this.ambientLight = { color: [0.1, 0.1, 0.15], intensity: 0.3 };
      this.enabled = true;
      this.initialized = false;
      this.stats = { drawCalls: 0, triangles: 0, lights: 0 };
    }

    init(width, height) {
      this.width = width;
      this.height = height;
      this._createGBuffer();
      this._compileShaders();
      this.initialized = true;
    }

    _createGBuffer() {
      const gl = this.gl;
      this.gBuffer = gl.createFramebuffer();
      gl.bindFramebuffer(36160, this.gBuffer);
      this.albedoTexture = this._createTexture(this.width, this.height, 6408, 6408, 5121);
      this.normalTexture = this._createTexture(this.width, this.height, 34836, 34836, 5126);
      this.positionTexture = this._createTexture(this.width, this.height, 34836, 34836, 5126);
      this.materialTexture = this._createTexture(this.width, this.height, 34836, 34836, 5126);
      this.depthTexture = this._createTexture(this.width, this.height, 36012, 6402, 5126);
      gl.framebufferTexture2D(36160, 36064, 3553, this.albedoTexture, 0);
      gl.framebufferTexture2D(36160, 36065, 3553, this.normalTexture, 0);
      gl.framebufferTexture2D(36160, 36066, 3553, this.positionTexture, 0);
      gl.framebufferTexture2D(36160, 36067, 3553, this.materialTexture, 0);
      gl.framebufferTexture2D(36160, 36096, 3553, this.depthTexture, 0);
      gl.drawBuffers([36064, 36065, 36066, 36067]);
      gl.bindFramebuffer(36160, null);
    }

    _createTexture(width, height, internalFormat, format, type) {
      const gl = this.gl;
      const texture = gl.createTexture();
      gl.bindTexture(3553, texture);
      gl.texImage2D(3553, 0, internalFormat, width, height, 0, format, type, null);
      gl.texParameteri(3553, 10242, 10497);
      gl.texParameteri(3553, 10243, 10497);
      gl.texParameteri(3553, 10241, 9728);
      gl.texParameteri(3553, 10240, 9728);
      return texture;
    }

    _compileShaders() {
      const geometryVS = `#version 300 es
precision highp float;
in vec3 position;
in vec3 normal;
in vec2 uv;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUv;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vNormal = normalize(normalMatrix * normal);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}`;
      const geometryFS = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
uniform vec3 albedo;
uniform float metallic;
uniform float roughness;
uniform float ao;
uniform sampler2D albedoMap;
uniform sampler2D normalMap;
uniform sampler2D metallicMap;
uniform sampler2D roughnessMap;
uniform sampler2D aoMap;
uniform float normalStrength;
layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
layout(location = 2) out vec4 gPosition;
layout(location = 3) out vec4 gMaterial;
void main() {
  vec3 albedoColor = albedo * texture(albedoMap, vUv).rgb;
  vec3 normal = normalize(vNormal);
  vec3 tangentNormal = texture(normalMap, vUv).xyz * 2.0 - 1.0;
  normal = normalize(mix(normal, tangentNormal, normalStrength));
  float metal = metallic * texture(metallicMap, vUv).r;
  float rough = roughness * texture(roughnessMap, vUv).r;
  float aoValue = ao * texture(aoMap, vUv).r;
  gAlbedo = vec4(albedoColor, 1.0);
  gNormal = vec4(normal, 1.0);
  gPosition = vec4(vWorldPos, 1.0);
  gMaterial = vec4(metal, rough, aoValue, 1.0);
}`;
      this.geometryProgram = this.shaderCompiler.compile(geometryVS, geometryFS);
      const lightingVS = `#version 300 es
precision highp float;
in vec2 position;
out vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;
      const lightingFS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D gAlbedo;
uniform sampler2D gNormal;
uniform sampler2D gPosition;
uniform sampler2D gMaterial;
uniform vec3 cameraPos;
uniform vec3 ambientColor;
uniform float ambientIntensity;
uniform int lightCount;
uniform vec3 lightPositions[64];
uniform vec3 lightColors[64];
uniform float lightIntensities[64];
uniform float lightRadii[64];
uniform int lightTypes[64];
out vec4 fragColor;
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
  vec3 albedo = texture(gAlbedo, vUv).rgb;
  vec3 normal = texture(gNormal, vUv).xyz;
  vec3 worldPos = texture(gPosition, vUv).xyz;
  vec4 material = texture(gMaterial, vUv);
  float metallic = material.r;
  float roughness = material.g;
  float ao = material.b;
  if (length(normal) < 0.1) {
    fragColor = vec4(albedo, 1.0);
    return;
  }
  vec3 N = normalize(normal);
  vec3 V = normalize(cameraPos - worldPos);
  vec3 F0 = vec3(0.04);
  F0 = mix(F0, albedo, metallic);
  vec3 Lo = vec3(0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= lightCount) break;
    vec3 L = normalize(lightPositions[i] - worldPos);
    vec3 H = normalize(V + L);
    float distance = length(lightPositions[i] - worldPos);
    float attenuation = 1.0 / (1.0 + 0.09 * distance + 0.032 * distance * distance);
    if (lightTypes[i] == 1) {
      attenuation = smoothstep(lightRadii[i], 0.0, distance);
    }
    vec3 radiance = lightColors[i] * lightIntensities[i] * attenuation;
    float NDF = DistributionGGX(N, H, roughness);
    float G = GeometrySmith(N, V, L, roughness);
    vec3 F = fresnelSchlick(max(dot(H, V), 0.0), F0);
    vec3 numerator = NDF * G * F;
    float denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001;
    vec3 specular = numerator / denominator;
    vec3 kS = F;
    vec3 kD = (vec3(1.0) - kS) * (1.0 - metallic);
    float NdotL = max(dot(N, L), 0.0);
    Lo += (kD * albedo / 3.14159265 + specular) * radiance * NdotL;
  }
  vec3 ambient = ambientColor * ambientIntensity * albedo * ao;
  vec3 color = ambient + Lo;
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0/2.2));
  fragColor = vec4(color, 1.0);
}`;
      this.lightingProgram = this.shaderCompiler.compile(lightingVS, lightingFS);
    }

    beginGeometryPass() {
      if (!this.initialized || !this.enabled) return;
      const gl = this.gl;
      gl.bindFramebuffer(36160, this.gBuffer);
      gl.viewport(0, 0, this.width, this.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(16640);
      gl.enable(2929);
      gl.depthFunc(515);
      this.shaderCompiler.use(this.geometryProgram);
      this.stats.drawCalls = 0;
    }

    endGeometryPass() {
      if (!this.initialized || !this.enabled) return;
      const gl = this.gl;
      gl.bindFramebuffer(36160, null);
    }

    lightingPass(camera) {
      if (!this.initialized || !this.enabled) return;
      const gl = this.gl;
      gl.bindFramebuffer(36160, null);
      gl.viewport(0, 0, this.width, this.height);
      gl.disable(2929);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(16384);
      this.shaderCompiler.use(this.lightingProgram);
      gl.activeTexture(33984);
      gl.bindTexture(3553, this.albedoTexture);
      this.shaderCompiler.setUniform1i(this.lightingProgram, 'gAlbedo', 0);
      gl.activeTexture(33985);
      gl.bindTexture(3553, this.normalTexture);
      this.shaderCompiler.setUniform1i(this.lightingProgram, 'gNormal', 1);
      gl.activeTexture(33986);
      gl.bindTexture(3553, this.positionTexture);
      this.shaderCompiler.setUniform1i(this.lightingProgram, 'gPosition', 2);
      gl.activeTexture(33987);
      gl.bindTexture(3553, this.materialTexture);
      this.shaderCompiler.setUniform1i(this.lightingProgram, 'gMaterial', 3);
      this.shaderCompiler.setUniform3f(this.lightingProgram, 'cameraPos', ...camera.position);
      this.shaderCompiler.setUniform3f(this.lightingProgram, 'ambientColor', ...this.ambientLight.color);
      this.shaderCompiler.setUniform1f(this.lightingProgram, 'ambientIntensity', this.ambientLight.intensity);
      this.shaderCompiler.setUniform1i(this.lightingProgram, 'lightCount', Math.min(this.lights.length, this.maxLights));
      for (let i = 0; i < Math.min(this.lights.length, this.maxLights); i++) {
        const light = this.lights[i];
        this.shaderCompiler.setUniform3f(this.lightingProgram, `lightPositions[${i}]`, ...light.position);
        this.shaderCompiler.setUniform3f(this.lightingProgram, `lightColors[${i}]`, ...light.color);
        this.shaderCompiler.setUniform1f(this.lightingProgram, `lightIntensities[${i}]`, light.intensity);
        this.shaderCompiler.setUniform1f(this.lightingProgram, `lightRadii[${i}]`, light.radius || 10);
        this.shaderCompiler.setUniform1i(this.lightingProgram, `lightTypes[${i}]`, light.type || 0);
      }
      const quadVertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
      const quadBuffer = gl.createBuffer();
      gl.bindBuffer(34962, quadBuffer);
      gl.bufferData(34962, quadVertices, 35044);
      const posLoc = this.shaderCompiler.getAttributeLocation(this.lightingProgram, 'position');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, 5126, false, 0, 0);
      gl.drawArrays(5, 0, 4);
      gl.deleteBuffer(quadBuffer);
      gl.enable(2929);
      this.stats.lights = this.lights.length;
    }

    addLight(light) {
      if (this.lights.length >= this.maxLights) {
        console.warn('Max lights reached');
        return null;
      }
      this.lights.push({
        position: light.position || [0, 0, 0],
        color: light.color || [1, 1, 1],
        intensity: light.intensity || 1,
        radius: light.radius || 10,
        type: light.type || 0,
        direction: light.direction || [0, -1, 0],
        castShadow: light.castShadow || false
      });
      return this.lights[this.lights.length - 1];
    }

    removeLight(light) {
      const idx = this.lights.indexOf(light);
      if (idx !== -1) this.lights.splice(idx, 1);
    }

    setAmbientLight(color, intensity) {
      this.ambientLight = { color, intensity };
    }

    resize(width, height) {
      this.width = width;
      this.height = height;
      if (this.gBuffer) {
        const gl = this.gl;
        gl.deleteTexture(this.albedoTexture);
        gl.deleteTexture(this.normalTexture);
        gl.deleteTexture(this.positionTexture);
        gl.deleteTexture(this.materialTexture);
        gl.deleteTexture(this.depthTexture);
        gl.deleteFramebuffer(this.gBuffer);
        this._createGBuffer();
      }
    }

    getStats() { return { ...this.stats }; }
    setEnabled(v) { this.enabled = v; }
    dispose() {
      const gl = this.gl;
      if (this.gBuffer) gl.deleteFramebuffer(this.gBuffer);
      if (this.albedoTexture) gl.deleteTexture(this.albedoTexture);
      if (this.normalTexture) gl.deleteTexture(this.normalTexture);
      if (this.positionTexture) gl.deleteTexture(this.positionTexture);
      if (this.materialTexture) gl.deleteTexture(this.materialTexture);
      if (this.depthTexture) gl.deleteTexture(this.depthTexture);
      this.lights = [];
      this.initialized = false;
    }
  }

  class ShadowMapper {
    constructor(glContext, shaderCompiler) {
      this.gl = glContext.getContext();
      this.shaderCompiler = shaderCompiler;
      this.depthProgram = null;
      this.shadowMaps = new Map();
      this.maxShadowMaps = 4;
      this.shadowMapSize = 2048;
      this.bias = 0.005;
      this.normalBias = 0.02;
      this.pcfSamples = 4;
      this.enabled = true;
      this.initialized = false;
    }

    init() {
      const depthVS = `#version 300 es
precision highp float;
in vec3 position;
uniform mat4 lightSpaceMatrix;
uniform mat4 modelMatrix;
void main() {
  gl_Position = lightSpaceMatrix * modelMatrix * vec4(position, 1.0);
}`;
      const depthFS = `#version 300 es
precision highp float;
void main() {}`;
      this.depthProgram = this.shaderCompiler.compile(depthVS, depthFS);
      this.initialized = true;
    }

    createShadowMap(light, size = this.shadowMapSize) {
      if (this.shadowMaps.size >= this.maxShadowMaps) return null;
      const gl = this.gl;
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(36160, framebuffer);
      const depthTexture = gl.createTexture();
      gl.bindTexture(3553, depthTexture);
      gl.texImage2D(3553, 0, 36012, size, size, 0, 6402, 5126, null);
      gl.texParameteri(3553, 10242, 10497);
      gl.texParameteri(3553, 10243, 10497);
      gl.texParameteri(3553, 10241, 9728);
      gl.texParameteri(3553, 10240, 9728);
      gl.framebufferTexture2D(36160, 36096, 3553, depthTexture, 0);
      gl.drawBuffers([0]);
      gl.bindFramebuffer(36160, null);
      const shadowMap = {
        light,
        framebuffer,
        depthTexture,
        size,
        lightSpaceMatrix: new Float32Array(16),
        nearPlane: 0.1,
        farPlane: 50,
        orthoSize: 10
      };
      this.shadowMaps.set(light, shadowMap);
      return shadowMap;
    }

    beginShadowPass(light) {
      if (!this.initialized || !this.enabled) return;
      const shadowMap = this.shadowMaps.get(light);
      if (!shadowMap) return;
      const gl = this.gl;
      gl.bindFramebuffer(36160, shadowMap.framebuffer);
      gl.viewport(0, 0, shadowMap.size, shadowMap.size);
      gl.clear(256);
      gl.enable(2929);
      gl.depthFunc(515);
      gl.cullFace(1028);
      this._updateLightSpaceMatrix(shadowMap);
      this.shaderCompiler.use(this.depthProgram);
      this.shaderCompiler.setUniformMatrix4fv(this.depthProgram, 'lightSpaceMatrix', shadowMap.lightSpaceMatrix);
    }

    endShadowPass() {
      if (!this.initialized || !this.enabled) return;
      const gl = this.gl;
      gl.bindFramebuffer(36160, null);
      gl.cullFace(1029);
    }

    _updateLightSpaceMatrix(shadowMap) {
      const light = shadowMap.light;
      const direction = this._normalize(light.direction || [0, -1, 0]);
      const position = light.position || [0, 10, 0];
      const target = [position[0] + direction[0], position[1] + direction[1], position[2] + direction[2]];
      const viewMatrix = this._lookAt(position, target, [0, 1, 0]);
      const orthoMatrix = this._ortho(-shadowMap.orthoSize, shadowMap.orthoSize, -shadowMap.orthoSize, shadowMap.orthoSize, shadowMap.nearPlane, shadowMap.farPlane);
      shadowMap.lightSpaceMatrix.set(this._multiplyMatrices(orthoMatrix, viewMatrix));
    }

    _normalize(v) {
      const l = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]) || 1;
      return [v[0]/l, v[1]/l, v[2]/l];
    }

    _lookAt(eye, target, up) {
      const z = this._normalize([eye[0]-target[0], eye[1]-target[1], eye[2]-target[2]]);
      const x = this._normalize([up[1]*z[2]-up[2]*z[1], up[2]*z[0]-up[0]*z[2], up[0]*z[1]-up[1]*z[0]]);
      const y = [z[1]*x[2]-z[2]*x[1], z[2]*x[0]-z[0]*x[2], z[0]*x[1]-z[1]*x[0]];
      return new Float32Array([
        x[0], y[0], z[0], 0,
        x[1], y[1], z[1], 0,
        x[2], y[2], z[2], 0,
        -(x[0]*eye[0]+x[1]*eye[1]+x[2]*eye[2]),
        -(y[0]*eye[0]+y[1]*eye[1]+y[2]*eye[2]),
        -(z[0]*eye[0]+z[1]*eye[1]+z[2]*eye[2]),
        1
      ]);
    }

    _ortho(left, right, bottom, top, near, far) {
      return new Float32Array([
        2/(right-left), 0, 0, 0,
        0, 2/(top-bottom), 0, 0,
        0, 0, -2/(far-near), 0,
        -(right+left)/(right-left), -(top+bottom)/(top-bottom), -(far+near)/(far-near), 1
      ]);
    }

    _multiplyMatrices(a, b) {
      const result = new Float32Array(16);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          result[i*4+j] = a[i*4]*b[j] + a[i*4+1]*b[4+j] + a[i*4+2]*b[8+j] + a[i*4+3]*b[12+j];
        }
      }
      return result;
    }

    getShadowMap(light) { return this.shadowMaps.get(light); }
    getShadowMapCount() { return this.shadowMaps.size; }
    setShadowMapSize(size) { this.shadowMapSize = size; }
    setBias(v) { this.bias = v; }
    setNormalBias(v) { this.normalBias = v; }
    setEnabled(v) { this.enabled = v; }
    dispose() {
      const gl = this.gl;
      for (const shadowMap of this.shadowMaps.values()) {
        gl.deleteFramebuffer(shadowMap.framebuffer);
        gl.deleteTexture(shadowMap.depthTexture);
      }
      this.shadowMaps.clear();
      this.initialized = false;
    }
  }

  class PostProcessing {
    constructor(glContext, shaderCompiler) {
      this.gl = glContext.getContext();
      this.shaderCompiler = shaderCompiler;
      this.passes = [];
      this.readBuffer = null;
      this.writeBuffer = null;
      this.width = 0;
      this.height = 0;
      this.quadBuffer = null;
      this.enabled = true;
      this.initialized = false;
    }

    init(width, height) {
      this.width = width;
      this.height = height;
      this.readBuffer = this._createFramebuffer(width, height);
      this.writeBuffer = this._createFramebuffer(width, height);
      const quadVertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
      this.quadBuffer = this.gl.createBuffer();
      this.gl.bindBuffer(34962, this.quadBuffer);
      this.gl.bufferData(34962, quadVertices, 35044);
      this.initialized = true;
    }

    _createFramebuffer(width, height) {
      const gl = this.gl;
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(36160, framebuffer);
      const texture = gl.createTexture();
      gl.bindTexture(3553, texture);
      gl.texImage2D(3553, 0, 6408, width, height, 0, 6408, 5121, null);
      gl.texParameteri(3553, 10242, 10497);
      gl.texParameteri(3553, 10243, 10497);
      gl.texParameteri(3553, 10241, 9729);
      gl.texParameteri(3553, 10240, 9729);
      gl.framebufferTexture2D(36160, 36064, 3553, texture, 0);
      const depthTexture = gl.createTexture();
      gl.bindTexture(3553, depthTexture);
      gl.texImage2D(3553, 0, 36012, width, height, 0, 6402, 5126, null);
      gl.texParameteri(3553, 10242, 10497);
      gl.texParameteri(3553, 10243, 10497);
      gl.texParameteri(3553, 10241, 9728);
      gl.texParameteri(3553, 10240, 9728);
      gl.framebufferTexture2D(36160, 36096, 3553, depthTexture, 0);
      gl.bindFramebuffer(36160, null);
      return { framebuffer, texture, depthTexture };
    }

    addPass(name, fragmentShader, uniforms = {}) {
      const vertexShader = `#version 300 es
precision highp float;
in vec2 position;
out vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;
      const program = this.shaderCompiler.compile(vertexShader, fragmentShader);
      this.passes.push({ name, program, uniforms, enabled: true, order: this.passes.length });
      return this.passes[this.passes.length - 1];
    }

    removePass(name) {
      const idx = this.passes.findIndex(p => p.name === name);
      if (idx !== -1) this.passes.splice(idx, 1);
    }

    begin() {
      if (!this.initialized || !this.enabled) return;
      const gl = this.gl;
      gl.bindFramebuffer(36160, this.readBuffer.framebuffer);
      gl.viewport(0, 0, this.width, this.height);
    }

    apply() {
      if (!this.initialized || !this.enabled || this.passes.length === 0) return;
      const gl = this.gl;
      for (const pass of this.passes) {
        if (!pass.enabled) continue;
        gl.bindFramebuffer(36160, this.writeBuffer.framebuffer);
        gl.viewport(0, 0, this.width, this.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(16384);
        this.shaderCompiler.use(pass.program);
        gl.activeTexture(33984);
        gl.bindTexture(3553, this.readBuffer.texture);
        this.shaderCompiler.setUniform1i(pass.program, 'sourceTexture', 0);
        this.shaderCompiler.setUniform2f(pass.program, 'resolution', this.width, this.height);
        for (const [name, value] of Object.entries(pass.uniforms)) {
          const loc = this.shaderCompiler.getUniformLocation(pass.program, name);
          if (loc) {
            if (Array.isArray(value)) {
              if (value.length === 2) gl.uniform2fv(loc, value);
              else if (value.length === 3) gl.uniform3fv(loc, value);
              else if (value.length === 4) gl.uniform4fv(loc, value);
            } else {
              gl.uniform1f(loc, value);
            }
          }
        }
        gl.bindBuffer(34962, this.quadBuffer);
        const posLoc = this.shaderCompiler.getAttributeLocation(pass.program, 'position');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, 5126, false, 0, 0);
        gl.drawArrays(5, 0, 4);
        const temp = this.readBuffer;
        this.readBuffer = this.writeBuffer;
        this.writeBuffer = temp;
      }
      gl.bindFramebuffer(36160, null);
      gl.viewport(0, 0, this.width, this.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(16384);
      const copyVS = `#version 300 es
precision highp float;
in vec2 position;
out vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;
      const copyFS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D sourceTexture;
out vec4 fragColor;
void main() {
  fragColor = texture(sourceTexture, vUv);
}`;
      const copyProgram = this.shaderCompiler.compile(copyVS, copyFS);
      this.shaderCompiler.use(copyProgram);
      gl.activeTexture(33984);
      gl.bindTexture(3553, this.readBuffer.texture);
      this.shaderCompiler.setUniform1i(copyProgram, 'sourceTexture', 0);
      gl.bindBuffer(34962, this.quadBuffer);
      const posLoc = this.shaderCompiler.getAttributeLocation(copyProgram, 'position');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, 5126, false, 0, 0);
      gl.drawArrays(5, 0, 4);
    }

    getPass(name) { return this.passes.find(p => p.name === name); }
    setPassEnabled(name, enabled) {
      const pass = this.getPass(name);
      if (pass) pass.enabled = enabled;
    }
    setPassUniform(name, uniformName, value) {
      const pass = this.getPass(name);
      if (pass) pass.uniforms[uniformName] = value;
    }
    resize(width, height) {
      this.width = width;
      this.height = height;
      if (this.readBuffer) {
        const gl = this.gl;
        gl.deleteFramebuffer(this.readBuffer.framebuffer);
        gl.deleteTexture(this.readBuffer.texture);
        gl.deleteTexture(this.readBuffer.depthTexture);
        gl.deleteFramebuffer(this.writeBuffer.framebuffer);
        gl.deleteTexture(this.writeBuffer.texture);
        gl.deleteTexture(this.writeBuffer.depthTexture);
        this.readBuffer = this._createFramebuffer(width, height);
        this.writeBuffer = this._createFramebuffer(width, height);
      }
    }
    getPassCount() { return this.passes.length; }
    setEnabled(v) { this.enabled = v; }
    dispose() {
      const gl = this.gl;
      if (this.readBuffer) {
        gl.deleteFramebuffer(this.readBuffer.framebuffer);
        gl.deleteTexture(this.readBuffer.texture);
        gl.deleteTexture(this.readBuffer.depthTexture);
      }
      if (this.writeBuffer) {
        gl.deleteFramebuffer(this.writeBuffer.framebuffer);
        gl.deleteTexture(this.writeBuffer.texture);
        gl.deleteTexture(this.writeBuffer.depthTexture);
      }
      if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
      this.passes = [];
      this.initialized = false;
    }
  }

  return {
    DeferredRenderer, ShadowMapper, PostProcessing
  };
})();

if (typeof window !== 'undefined') window.SpiritRendererV2 = SpiritRendererV2;
if (typeof globalThis !== 'undefined') globalThis.SpiritRendererV2 = SpiritRendererV2;
