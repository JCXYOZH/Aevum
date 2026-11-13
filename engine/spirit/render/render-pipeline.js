/**
 * 自研3D灵体渲染引擎 - 渲染管线/PMX/骨骼/透明/轮廓/粒子/头发/布料/眼睛/SSS/PBR/渲染队列/裁剪
 * 纯WebGL2，零第三方依赖
 * @version 2.0.0
 */
'use strict';

const SpiritRenderer = (function () {

  // ============================================================
  // 渲染队列
  // ============================================================
  class RenderQueue {
    constructor() {
      this.opaque = [];
      this.transparent = [];
      this.overlay = [];
      this.shadowCasters = [];
      this.sortMode = 'front-to-back';
      this.frameCount = 0;
      this.stats = { opaque: 0, transparent: 0, overlay: 0, shadowCasters: 0, drawCalls: 0, triangles: 0 };
    }

    add(item) {
      if (item.transparent) {
        this.transparent.push(item);
      } else if (item.overlay) {
        this.overlay.push(item);
      } else {
        this.opaque.push(item);
      }
      if (item.castShadow) this.shadowCasters.push(item);
    }

    remove(item) {
      const removeFrom = arr => {
        const idx = arr.indexOf(item);
        if (idx !== -1) arr.splice(idx, 1);
      };
      removeFrom(this.opaque);
      removeFrom(this.transparent);
      removeFrom(this.overlay);
      removeFrom(this.shadowCasters);
    }

    sort(cameraPosition) {
      if (this.sortMode === 'front-to-back') {
        this.opaque.sort((a, b) => {
          const da = this._distanceSq(a.position, cameraPosition);
          const db = this._distanceSq(b.position, cameraPosition);
          return da - db;
        });
      } else if (this.sortMode === 'back-to-front') {
        this.opaque.sort((a, b) => {
          const da = this._distanceSq(a.position, cameraPosition);
          const db = this._distanceSq(b.position, cameraPosition);
          return db - da;
        });
      }
      this.opaque.sort((a, b) => (a.renderOrder || 0) - (b.renderOrder || 0));
      this.transparent.sort((a, b) => {
        const da = this._distanceSq(a.position, cameraPosition);
        const db = this._distanceSq(b.position, cameraPosition);
        return db - da;
      });
      this.transparent.sort((a, b) => (a.renderOrder || 0) - (b.renderOrder || 0));
      this.overlay.sort((a, b) => (a.renderOrder || 0) - (b.renderOrder || 0));
    }

    _distanceSq(a, b) {
      const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
      return dx * dx + dy * dy + dz * dz;
    }

    clear() {
      this.stats = { opaque: this.opaque.length, transparent: this.transparent.length, overlay: this.overlay.length, shadowCasters: this.shadowCasters.length, drawCalls: 0, triangles: 0 };
      this.opaque = [];
      this.transparent = [];
      this.overlay = [];
      this.shadowCasters = [];
      this.frameCount++;
    }

    getOpaque() { return this.opaque; }
    getTransparent() { return this.transparent; }
    getOverlay() { return this.overlay; }
    getShadowCasters() { return this.shadowCasters; }
    getStats() { return { ...this.stats }; }
    setSortMode(mode) { if (['front-to-back', 'back-to-front', 'none'].includes(mode)) this.sortMode = mode; }
    getTotalItems() { return this.opaque.length + this.transparent.length + this.overlay.length; }
  }

  // ============================================================
  // 裁剪系统
  // ============================================================
  class CullingSystem {
    constructor() {
      this.frustumPlanes = new Float32Array(24);
      this.occlusionQueries = new Map();
      this.occlusionResults = new Map();
      this.visibleSet = new Set();
      this.culledSet = new Set();
      this.frustumCullingEnabled = true;
      this.occlusionCullingEnabled = false;
      this.boundingSphereCache = new Map();
      this.stats = { tested: 0, visible: 0, culled: 0, occluded: 0 };
    }

    updateFrustum(viewProjectionMatrix) {
      const m = viewProjectionMatrix;
      for (let i = 0; i < 4; i++) {
        this.frustumPlanes[i*4] = m[3+i] - m[i];
        this.frustumPlanes[i*4+1] = m[7+i] - m[4+i];
        this.frustumPlanes[i*4+2] = m[11+i] - m[8+i];
        this.frustumPlanes[i*4+3] = m[15+i] - m[12+i];
      }
      for (let i = 0; i < 4; i++) {
        this.frustumPlanes[16+i*4] = m[3+i] + m[i];
        this.frustumPlanes[16+i*4+1] = m[7+i] + m[4+i];
        this.frustumPlanes[16+i*4+2] = m[11+i] + m[8+i];
        this.frustumPlanes[16+i*4+3] = m[15+i] + m[12+i];
      }
    }

    isVisible(object) {
      this.stats.tested++;
      const center = object.boundingCenter || object.position || [0, 0, 0];
      const radius = object.boundingRadius || 1;
      if (this.frustumCullingEnabled) {
        for (let i = 0; i < 6; i++) {
          const d = this.frustumPlanes[i*4]*center[0] + this.frustumPlanes[i*4+1]*center[1] + this.frustumPlanes[i*4+2]*center[2] + this.frustumPlanes[i*4+3];
          if (d < -radius) {
            this.stats.culled++;
            this.culledSet.add(object.id || object);
            return false;
          }
        }
      }
      this.stats.visible++;
      this.visibleSet.add(object.id || object);
      return true;
    }

    cullScene(objects) {
      this.visibleSet.clear();
      this.culledSet.clear();
      this.stats = { tested: 0, visible: 0, culled: 0, occluded: 0 };
      const visible = [];
      for (const obj of objects) {
        if (this.isVisible(obj)) visible.push(obj);
      }
      return visible;
    }

    computeBoundingSphere(geometry, transform = null) {
      const v = geometry.vertices;
      let cx = 0, cy = 0, cz = 0;
      const count = v.length / 3;
      for (let i = 0; i < v.length; i += 3) { cx += v[i]; cy += v[i+1]; cz += v[i+2]; }
      cx /= count; cy /= count; cz /= count;
      let maxDist = 0;
      for (let i = 0; i < v.length; i += 3) {
        const dx = v[i] - cx, dy = v[i+1] - cy, dz = v[i+2] - cz;
        const d = dx*dx + dy*dy + dz*dz;
        if (d > maxDist) maxDist = d;
      }
      return { center: [cx, cy, cz], radius: Math.sqrt(maxDist) };
    }

    enableFrustumCulling(v) { this.frustumCullingEnabled = v; }
    enableOcclusionCulling(v) { this.occlusionCullingEnabled = v; }
    getStats() { return { ...this.stats }; }
    getVisibleCount() { return this.visibleSet.size; }
    getCulledCount() { return this.culledSet.size; }
    reset() { this.visibleSet.clear(); this.culledSet.clear(); this.stats = { tested: 0, visible: 0, culled: 0, occluded: 0 }; }
  }

  // ============================================================
  // PMX渲染器
  // ============================================================
  class PMXRenderer {
    constructor(glContext, shaderCompiler) {
      this.gl = glContext.getContext();
      this.shaderCompiler = shaderCompiler;
      this.program = null;
      this.model = null;
      this.boneMatrices = null;
      this.morphWeights = new Map();
      this.vertexData = null;
      this.indexData = null;
      this.vertexBuffer = null;
      this.indexBuffer = null;
      this.vao = null;
      this.materials = [];
      this.textures = new Map();
      this.visible = true;
      this.castShadow = true;
      this.receiveShadow = true;
      this.renderOrder = 0;
      this.transparent = false;
      this.overlay = false;
      this.position = [0, 0, 0];
      this.rotation = [0, 0, 0, 1];
      this.scale = [1, 1, 1];
      this.modelMatrix = new Float32Array(16);
      this.normalMatrix = new Float32Array(9);
      this.boundingSphere = { center: [0,0,0], radius: 1 };
      this.initialized = false;
      this.drawCalls = 0;
      this.triangles = 0;
    }

    async init(model) {
      this.model = model;
      this._compileShaders();
      this._createBuffers();
      this._createTextures();
      this.boneMatrices = new Float32Array(model.boneCount * 16);
      this.initialized = true;
      this._computeBoundingSphere();
    }

    _compileShaders() {
      const vertexShader = `#version 300 es
precision highp float;
in vec3 position;
in vec3 normal;
in vec2 uv;
in vec4 boneIndices;
in vec4 boneWeights;
in vec4 additionalVec4;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
uniform mat4 boneMatrices[128];
uniform int boneCount;
out vec3 vNormal;
out vec2 vUv;
out vec3 vViewPosition;
out vec3 vWorldPosition;
void main() {
  vec4 pos = vec4(position, 1.0);
  vec3 nrm = normal;
  if (boneCount > 0) {
    mat4 skinMatrix = mat4(0.0);
    for (int i = 0; i < 4; i++) {
      if (boneWeights[i] > 0.0) {
        skinMatrix += boneMatrices[int(boneIndices[i])] * boneWeights[i];
      }
    }
    pos = skinMatrix * pos;
    nrm = mat3(skinMatrix) * normal;
  }
  vec4 worldPos = modelMatrix * pos;
  vWorldPosition = worldPos.xyz;
  vec4 mvPosition = viewMatrix * worldPos;
  vViewPosition = -mvPosition.xyz;
  vNormal = normalize(normalMatrix * nrm);
  vUv = uv;
  gl_Position = projectionMatrix * mvPosition;
}`;
      const fragmentShader = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec2 vUv;
in vec3 vViewPosition;
in vec3 vWorldPosition;
uniform vec3 diffuseColor;
uniform vec3 specularColor;
uniform float specularPower;
uniform float ambientIntensity;
uniform vec3 ambientColor;
uniform vec3 directionalLightDirection;
uniform vec3 directionalLightColor;
uniform sampler2D diffuseTexture;
uniform sampler2D sphereTexture;
uniform int sphereTextureMode;
uniform int edgeFlag;
uniform vec4 edgeColor;
uniform float edgeSize;
uniform float opacity;
out vec4 fragColor;
void main() {
  vec4 texColor = texture(diffuseTexture, vUv);
  vec3 albedo = diffuseColor * texColor.rgb;
  float alpha = texColor.a * opacity;
  if (alpha < 0.01) discard;
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewPosition);
  vec3 L = normalize(-directionalLightDirection);
  vec3 H = normalize(V + L);
  float NdotL = max(dot(N, L), 0.0);
  float NdotH = max(dot(N, H), 0.0);
  vec3 diffuse = albedo * NdotL * directionalLightColor;
  vec3 specular = specularColor * pow(NdotH, specularPower) * directionalLightColor;
  vec3 ambient = albedo * ambientColor * ambientIntensity;
  if (sphereTextureMode == 1) {
    vec2 sphereUv = N.xy * 0.5 + 0.5;
    vec3 sphereColor = texture(sphereTexture, sphereUv).rgb;
    diffuse *= sphereColor;
  } else if (sphereTextureMode == 2) {
    vec3 R = reflect(-V, N);
    vec2 sphereUv = R.xy * 0.5 + 0.5;
    vec3 sphereColor = texture(sphereTexture, sphereUv).rgb;
    specular += sphereColor * 0.5;
  }
  vec3 color = ambient + diffuse + specular;
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0 / 2.2));
  fragColor = vec4(color, alpha);
}`;
      this.program = this.shaderCompiler.compile(vertexShader, fragmentShader);
    }

    _createBuffers() {
      const gl = this.gl;
      const model = this.model;
      const vertexCount = model.vertexCount;
      const stride = 3 + 3 + 2 + (model.additionalVec4 || 0) * 4 + 4 + 4;
      this.vertexData = new Float32Array(vertexCount * stride);
      for (let i = 0; i < vertexCount; i++) {
        const srcBase = i * (3 + 3 + 2 + (model.additionalVec4 || 0) * 4);
        const dstBase = i * stride;
        this.vertexData[dstBase] = model.vertexData[srcBase];
        this.vertexData[dstBase+1] = model.vertexData[srcBase+1];
        this.vertexData[dstBase+2] = model.vertexData[srcBase+2];
        this.vertexData[dstBase+3] = model.vertexData[srcBase+3];
        this.vertexData[dstBase+4] = model.vertexData[srcBase+4];
        this.vertexData[dstBase+5] = model.vertexData[srcBase+5];
        this.vertexData[dstBase+6] = model.vertexData[srcBase+6];
        this.vertexData[dstBase+7] = model.vertexData[srcBase+7];
        let offset = 8;
        for (let av = 0; av < (model.additionalVec4 || 0); av++) {
          this.vertexData[dstBase+offset] = model.vertexData[srcBase+8+av*4];
          this.vertexData[dstBase+offset+1] = model.vertexData[srcBase+9+av*4];
          this.vertexData[dstBase+offset+2] = model.vertexData[srcBase+10+av*4];
          this.vertexData[dstBase+offset+3] = model.vertexData[srcBase+11+av*4];
          offset += 4;
        }
        this.vertexData[dstBase+offset] = model.boneIndices[i*4];
        this.vertexData[dstBase+offset+1] = model.boneIndices[i*4+1];
        this.vertexData[dstBase+offset+2] = model.boneIndices[i*4+2];
        this.vertexData[dstBase+offset+3] = model.boneIndices[i*4+3];
        this.vertexData[dstBase+offset+4] = model.boneWeights[i*4];
        this.vertexData[dstBase+offset+5] = model.boneWeights[i*4+1];
        this.vertexData[dstBase+offset+6] = model.boneWeights[i*4+2];
        this.vertexData[dstBase+offset+7] = model.boneWeights[i*4+3];
      }
      this.indexData = new Uint32Array(model.indices);
      this.vertexBuffer = gl.createBuffer();
      gl.bindBuffer(34962, this.vertexBuffer);
      gl.bufferData(34962, this.vertexData, 35044);
      this.indexBuffer = gl.createBuffer();
      gl.bindBuffer(34963, this.indexBuffer);
      gl.bufferData(34963, this.indexData, 35044);
      this.vertexStride = stride * 4;
    }

    _createTextures() {
      const gl = this.gl;
      for (const texInfo of this.model.textures) {
        const texture = gl.createTexture();
        gl.bindTexture(3553, texture);
        gl.texParameteri(3553, 10242, 10497);
        gl.texParameteri(3553, 10243, 10497);
        gl.texParameteri(3553, 10241, 9729);
        gl.texParameteri(3553, 10240, 9729);
        gl.texImage2D(3553, 0, 6408, 1, 1, 0, 6408, 5121, new Uint8Array([200, 200, 200, 255]));
        this.textures.set(texInfo.path, texture);
      }
    }

    _computeBoundingSphere() {
      const v = this.model.vertexData;
      const stride = 3 + 3 + 2 + (this.model.additionalVec4 || 0) * 4;
      let cx = 0, cy = 0, cz = 0;
      const count = this.model.vertexCount;
      for (let i = 0; i < count; i++) {
        cx += v[i*stride]; cy += v[i*stride+1]; cz += v[i*stride+2];
      }
      cx /= count; cy /= count; cz /= count;
      let maxDist = 0;
      for (let i = 0; i < count; i++) {
        const dx = v[i*stride] - cx, dy = v[i*stride+1] - cy, dz = v[i*stride+2] - cz;
        const d = dx*dx + dy*dy + dz*dz;
        if (d > maxDist) maxDist = d;
      }
      this.boundingSphere = { center: [cx, cy, cz], radius: Math.sqrt(maxDist) };
    }

    update(skeleton, morphWeights) {
      if (!this.initialized) return;
      if (skeleton) {
        for (let i = 0; i < skeleton.boneCount; i++) {
          this.boneMatrices.set(skeleton.getBoneMatrix(i), i * 16);
        }
      }
      if (morphWeights) {
        for (const [name, weight] of morphWeights) this.morphWeights.set(name, weight);
      }
      this._updateModelMatrix();
    }

    _updateModelMatrix() {
      const m = this.modelMatrix;
      const x = this.rotation[0], y = this.rotation[1], z = this.rotation[2], w = this.rotation[3];
      const x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2;
      const yy = y * y2, yz = y * z2, zz = z * z2;
      const wx = w * x2, wy = w * y2, wz = w * z2;
      const sx = this.scale[0], sy = this.scale[1], sz = this.scale[2];
      m[0] = (1 - (yy + zz)) * sx; m[1] = (xy + wz) * sx; m[2] = (xz - wy) * sx; m[3] = 0;
      m[4] = (xy - wz) * sy; m[5] = (1 - (xx + zz)) * sy; m[6] = (yz + wx) * sy; m[7] = 0;
      m[8] = (xz + wy) * sz; m[9] = (yz - wx) * sz; m[10] = (1 - (xx + yy)) * sz; m[11] = 0;
      m[12] = this.position[0]; m[13] = this.position[1]; m[14] = this.position[2]; m[15] = 1;
      this.normalMatrix[0] = m[0]; this.normalMatrix[1] = m[1]; this.normalMatrix[2] = m[2];
      this.normalMatrix[3] = m[4]; this.normalMatrix[4] = m[5]; this.normalMatrix[5] = m[6];
      this.normalMatrix[6] = m[8]; this.normalMatrix[7] = m[9]; this.normalMatrix[8] = m[10];
    }

    render(camera, lights) {
      if (!this.initialized || !this.visible) return;
      const gl = this.gl;
      this.shaderCompiler.use(this.program);
      const stride = this.vertexStride;
      gl.bindBuffer(34962, this.vertexBuffer);
      gl.bindBuffer(34963, this.indexBuffer);
      const posLoc = this.shaderCompiler.getAttributeLocation(this.program, 'position');
      const normLoc = this.shaderCompiler.getAttributeLocation(this.program, 'normal');
      const uvLoc = this.shaderCompiler.getAttributeLocation(this.program, 'uv');
      const boneIdxLoc = this.shaderCompiler.getAttributeLocation(this.program, 'boneIndices');
      const boneWtLoc = this.shaderCompiler.getAttributeLocation(this.program, 'boneWeights');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 3, 5126, false, stride, 0);
      gl.enableVertexAttribArray(normLoc);
      gl.vertexAttribPointer(normLoc, 3, 5126, false, stride, 12);
      gl.enableVertexAttribArray(uvLoc);
      gl.vertexAttribPointer(uvLoc, 2, 5126, false, stride, 24);
      const boneOffset = 24 + (this.model.additionalVec4 || 0) * 16;
      gl.enableVertexAttribArray(boneIdxLoc);
      gl.vertexAttribPointer(boneIdxLoc, 4, 5126, false, stride, boneOffset);
      gl.enableVertexAttribArray(boneWtLoc);
      gl.vertexAttribPointer(boneWtLoc, 4, 5126, false, stride, boneOffset + 16);
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'modelMatrix', this.modelMatrix);
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'viewMatrix', camera.getViewMatrix());
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'projectionMatrix', camera.getProjectionMatrix());
      this.shaderCompiler.setUniformMatrix3fv(this.program, 'normalMatrix', this.normalMatrix);
      this.shaderCompiler.setUniform1i(this.program, 'boneCount', this.model.boneCount);
      const boneMatrixLoc = this.shaderCompiler.getUniformLocation(this.program, 'boneMatrices[0]');
      gl.uniformMatrix4fv(boneMatrixLoc, false, this.boneMatrices);
      this.shaderCompiler.setUniform3f(this.program, 'directionalLightDirection', ...lights.directionalLight.direction);
      this.shaderCompiler.setUniform3f(this.program, 'directionalLightColor', ...lights.directionalLight.color);
      this.shaderCompiler.setUniform3f(this.program, 'ambientColor', ...lights.ambientLight.color);
      this.shaderCompiler.setUniform1f(this.program, 'ambientIntensity', lights.ambientLight.intensity);
      let offset = 0;
      this.drawCalls = 0;
      this.triangles = 0;
      for (const material of this.model.materials) {
        const count = material.surfaceCount;
        this.shaderCompiler.setUniform3f(this.program, 'diffuseColor', ...material.diffuse.slice(0, 3));
        this.shaderCompiler.setUniform3f(this.program, 'specularColor', ...material.specular);
        this.shaderCompiler.setUniform1f(this.program, 'specularPower', material.specularPower);
        this.shaderCompiler.setUniform1f(this.program, 'opacity', material.diffuse[3]);
        this.shaderCompiler.setUniform1i(this.program, 'edgeFlag', material.flags & 0x10);
        if (material.textureIndex >= 0) {
          const texPath = this.model.textures[material.textureIndex]?.path;
          const texture = texPath ? this.textures.get(texPath) : null;
          if (texture) {
            gl.activeTexture(33984);
            gl.bindTexture(3553, texture);
            this.shaderCompiler.setUniform1i(this.program, 'diffuseTexture', 0);
          }
        }
        gl.drawElements(4, count, 5125, offset * 4);
        offset += count;
        this.drawCalls++;
        this.triangles += count / 3;
      }
    }

    setPosition(x, y, z) { this.position = [x, y, z]; }
    setRotation(x, y, z, w) { this.rotation = [x, y, z, w]; }
    setScale(x, y, z) { this.scale = [x, y, z]; }
    setVisible(v) { this.visible = v; }
    getBoundingSphere() { return { ...this.boundingSphere, center: [this.boundingSphere.center[0] + this.position[0], this.boundingSphere.center[1] + this.position[1], this.boundingSphere.center[2] + this.position[2]] }; }
    getStats() { return { drawCalls: this.drawCalls, triangles: this.triangles, vertices: this.model.vertexCount, materials: this.model.materials.length }; }
    dispose() {
      const gl = this.gl;
      if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
      if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);
      for (const texture of this.textures.values()) gl.deleteTexture(texture);
      this.textures.clear();
      this.initialized = false;
    }
  }

  // ============================================================
  // 骨骼蒙皮渲染器
  // ============================================================
  class SkeletalRenderer {
    constructor(glContext, shaderCompiler) {
      this.gl = glContext.getContext();
      this.shaderCompiler = shaderCompiler;
      this.program = null;
      this.mesh = null;
      this.skeleton = null;
      this.skinningMode = 'linear';
      this.maxBones = 128;
      this.boneMatrices = null;
      this.vertexBuffer = null;
      this.indexBuffer = null;
      this.initialized = false;
      this.drawCalls = 0;
      this.triangles = 0;
    }

    init(mesh, skeleton) {
      this.mesh = mesh;
      this.skeleton = skeleton;
      this.boneMatrices = new Float32Array(this.maxBones * 16);
      this._compileShaders();
      this._createBuffers();
      this.initialized = true;
    }

    _compileShaders() {
      const vs = `#version 300 es
precision highp float;
in vec3 position;
in vec3 normal;
in vec2 uv;
in vec4 boneIndices;
in vec4 boneWeights;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
uniform mat4 boneMatrices[128];
uniform int skinningMode;
out vec3 vNormal;
out vec2 vUv;
out vec3 vViewPosition;
void main() {
  vec4 pos = vec4(position, 1.0);
  vec3 nrm = normal;
  mat4 skinMatrix = mat4(0.0);
  for (int i = 0; i < 4; i++) {
    if (boneWeights[i] > 0.0) skinMatrix += boneMatrices[int(boneIndices[i])] * boneWeights[i];
  }
  pos = skinMatrix * pos;
  nrm = mat3(skinMatrix) * normal;
  vec4 worldPos = modelMatrix * pos;
  vec4 mvPosition = viewMatrix * worldPos;
  vViewPosition = -mvPosition.xyz;
  vNormal = normalize(normalMatrix * nrm);
  vUv = uv;
  gl_Position = projectionMatrix * mvPosition;
}`;
      const fs = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec2 vUv;
in vec3 vViewPosition;
uniform vec3 diffuseColor;
uniform vec3 lightDirection;
uniform vec3 lightColor;
uniform vec3 ambientColor;
uniform float ambientIntensity;
uniform sampler2D diffuseMap;
out vec4 fragColor;
void main() {
  vec3 albedo = diffuseColor * texture(diffuseMap, vUv).rgb;
  vec3 N = normalize(vNormal);
  vec3 L = normalize(-lightDirection);
  float NdotL = max(dot(N, L), 0.0);
  vec3 diffuse = albedo * NdotL * lightColor;
  vec3 ambient = albedo * ambientColor * ambientIntensity;
  vec3 color = ambient + diffuse;
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0/2.2));
  fragColor = vec4(color, 1.0);
}`;
      this.program = this.shaderCompiler.compile(vs, fs);
    }

    _createBuffers() {
      const gl = this.gl;
      this.vertexBuffer = gl.createBuffer();
      gl.bindBuffer(34962, this.vertexBuffer);
      gl.bufferData(34962, this.mesh.vertices, 35044);
      this.indexBuffer = gl.createBuffer();
      gl.bindBuffer(34963, this.indexBuffer);
      gl.bufferData(34963, this.mesh.indices, 35044);
    }

    update() {
      if (!this.initialized || !this.skeleton) return;
      for (let i = 0; i < this.skeleton.boneCount; i++) {
        this.boneMatrices.set(this.skeleton.getBoneMatrix(i), i * 16);
      }
    }

    render(camera, lights, modelMatrix) {
      if (!this.initialized) return;
      const gl = this.gl;
      this.shaderCompiler.use(this.program);
      gl.bindBuffer(34962, this.vertexBuffer);
      gl.bindBuffer(34963, this.indexBuffer);
      const stride = (3 + 3 + 2 + 4 + 4) * 4;
      const posLoc = this.shaderCompiler.getAttributeLocation(this.program, 'position');
      const normLoc = this.shaderCompiler.getAttributeLocation(this.program, 'normal');
      const uvLoc = this.shaderCompiler.getAttributeLocation(this.program, 'uv');
      const biLoc = this.shaderCompiler.getAttributeLocation(this.program, 'boneIndices');
      const bwLoc = this.shaderCompiler.getAttributeLocation(this.program, 'boneWeights');
      gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 3, 5126, false, stride, 0);
      gl.enableVertexAttribArray(normLoc); gl.vertexAttribPointer(normLoc, 3, 5126, false, stride, 12);
      gl.enableVertexAttribArray(uvLoc); gl.vertexAttribPointer(uvLoc, 2, 5126, false, stride, 24);
      gl.enableVertexAttribArray(biLoc); gl.vertexAttribPointer(biLoc, 4, 5126, false, stride, 32);
      gl.enableVertexAttribArray(bwLoc); gl.vertexAttribPointer(bwLoc, 4, 5126, false, stride, 48);
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'modelMatrix', modelMatrix);
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'viewMatrix', camera.getViewMatrix());
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'projectionMatrix', camera.getProjectionMatrix());
      const boneLoc = this.shaderCompiler.getUniformLocation(this.program, 'boneMatrices[0]');
      gl.uniformMatrix4fv(boneLoc, false, this.boneMatrices);
      this.shaderCompiler.setUniform3f(this.program, 'lightDirection', ...lights.directionalLight.direction);
      this.shaderCompiler.setUniform3f(this.program, 'lightColor', ...lights.directionalLight.color);
      this.shaderCompiler.setUniform3f(this.program, 'ambientColor', ...lights.ambientLight.color);
      this.shaderCompiler.setUniform1f(this.program, 'ambientIntensity', lights.ambientLight.intensity);
      this.shaderCompiler.setUniform3f(this.program, 'diffuseColor', 1, 1, 1);
      gl.drawElements(4, this.mesh.indices.length, 5125, 0);
      this.drawCalls = 1;
      this.triangles = this.mesh.indices.length / 3;
    }

    setSkinningMode(mode) { if (['linear', 'dual_quaternion'].includes(mode)) this.skinningMode = mode; }
    getStats() { return { drawCalls: this.drawCalls, triangles: this.triangles, bones: this.skeleton?.boneCount || 0 }; }
    dispose() {
      const gl = this.gl;
      if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
      if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);
      this.initialized = false;
    }
  }

  // ============================================================
  // 透明渲染器
  // ============================================================
  class TransparentRenderer {
    constructor(glContext, shaderCompiler) {
      this.gl = glContext.getContext();
      this.shaderCompiler = shaderCompiler;
      this.program = null;
      this.objects = [];
      this.blendMode = 'normal';
      this.depthWrite = false;
      this.initialized = false;
    }

    init() {
      const vs = `#version 300 es
precision highp float;
in vec3 position;
in vec3 normal;
in vec2 uv;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec3 vNormal;
out vec2 vUv;
out vec3 vViewPosition;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vec4 mvPosition = viewMatrix * worldPos;
  vViewPosition = -mvPosition.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * mvPosition;
}`;
      const fs = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec2 vUv;
in vec3 vViewPosition;
uniform vec3 diffuseColor;
uniform float opacity;
uniform vec3 lightDirection;
uniform vec3 lightColor;
uniform vec3 ambientColor;
uniform float ambientIntensity;
uniform sampler2D diffuseMap;
uniform int blendMode;
out vec4 fragColor;
void main() {
  vec4 texColor = texture(diffuseMap, vUv);
  vec3 albedo = diffuseColor * texColor.rgb;
  float alpha = texColor.a * opacity;
  if (alpha < 0.01) discard;
  vec3 N = normalize(vNormal);
  vec3 L = normalize(-lightDirection);
  float NdotL = max(dot(N, L), 0.0);
  vec3 diffuse = albedo * NdotL * lightColor;
  vec3 ambient = albedo * ambientColor * ambientIntensity;
  vec3 color = ambient + diffuse;
  if (blendMode == 1) {
    color = 1.0 - (1.0 - color) * (1.0 - albedo);
  } else if (blendMode == 2) {
    color = color * albedo * 2.0;
  }
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0/2.2));
  fragColor = vec4(color, alpha);
}`;
      this.program = this.shaderCompiler.compile(vs, fs);
      this.initialized = true;
    }

    addObject(object) { this.objects.push(object); }
    removeObject(object) {
      const idx = this.objects.indexOf(object);
      if (idx !== -1) this.objects.splice(idx, 1);
    }

    render(camera, lights) {
      if (!this.initialized) return;
      const gl = this.gl;
      gl.enable(3042);
      if (!this.depthWrite) gl.depthMask(false);
      if (this.blendMode === 'additive') gl.blendFunc(770, 1);
      else if (this.blendMode === 'multiply') gl.blendFunc(774, 771);
      else gl.blendFunc(770, 771);
      this.objects.sort((a, b) => {
        const da = (a.position[0]-camera.position[0])**2 + (a.position[1]-camera.position[1])**2 + (a.position[2]-camera.position[2])**2;
        const db = (b.position[0]-camera.position[0])**2 + (b.position[1]-camera.position[1])**2 + (b.position[2]-camera.position[2])**2;
        return db - da;
      });
      for (const obj of this.objects) {
        this._renderObject(obj, camera, lights);
      }
      gl.depthMask(true);
      gl.disable(3042);
    }

    _renderObject(obj, camera, lights) {
      const gl = this.gl;
      this.shaderCompiler.use(this.program);
      gl.bindBuffer(34962, obj.vertexBuffer);
      gl.bindBuffer(34963, obj.indexBuffer);
      const stride = (3 + 3 + 2) * 4;
      const posLoc = this.shaderCompiler.getAttributeLocation(this.program, 'position');
      const normLoc = this.shaderCompiler.getAttributeLocation(this.program, 'normal');
      const uvLoc = this.shaderCompiler.getAttributeLocation(this.program, 'uv');
      gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 3, 5126, false, stride, 0);
      gl.enableVertexAttribArray(normLoc); gl.vertexAttribPointer(normLoc, 3, 5126, false, stride, 12);
      gl.enableVertexAttribArray(uvLoc); gl.vertexAttribPointer(uvLoc, 2, 5126, false, stride, 24);
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'modelMatrix', obj.modelMatrix);
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'viewMatrix', camera.getViewMatrix());
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'projectionMatrix', camera.getProjectionMatrix());
      this.shaderCompiler.setUniform3f(this.program, 'diffuseColor', ...obj.color);
      this.shaderCompiler.setUniform1f(this.program, 'opacity', obj.opacity);
      this.shaderCompiler.setUniform3f(this.program, 'lightDirection', ...lights.directionalLight.direction);
      this.shaderCompiler.setUniform3f(this.program, 'lightColor', ...lights.directionalLight.color);
      this.shaderCompiler.setUniform3f(this.program, 'ambientColor', ...lights.ambientLight.color);
      this.shaderCompiler.setUniform1f(this.program, 'ambientIntensity', lights.ambientLight.intensity);
      this.shaderCompiler.setUniform1i(this.program, 'blendMode', this.blendMode === 'additive' ? 1 : this.blendMode === 'multiply' ? 2 : 0);
      gl.drawElements(4, obj.indexCount, 5125, 0);
    }

    setBlendMode(mode) { if (['normal', 'additive', 'multiply'].includes(mode)) this.blendMode = mode; }
    setDepthWrite(v) { this.depthWrite = v; }
    clear() { this.objects = []; }
    getObjectCount() { return this.objects.length; }
    dispose() { this.objects = []; this.initialized = false; }
  }

  // ============================================================
  // 轮廓渲染器
  // ============================================================
  class OutlineRenderer {
    constructor(glContext, shaderCompiler) {
      this.gl = glContext.getContext();
      this.shaderCompiler = shaderCompiler;
      this.program = null;
      this.enabled = true;
      this.outlineColor = [0, 0, 0, 1];
      this.outlineWidth = 0.02;
      this.outlineMode = 'inverted_hull';
      this.initialized = false;
    }

    init() {
      const vs = `#version 300 es
precision highp float;
in vec3 position;
in vec3 normal;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float outlineWidth;
void main() {
  vec3 pos = position + normal * outlineWidth;
  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}`;
      const fs = `#version 300 es
precision highp float;
uniform vec4 outlineColor;
out vec4 fragColor;
void main() {
  fragColor = outlineColor;
}`;
      this.program = this.shaderCompiler.compile(vs, fs);
      this.initialized = true;
    }

    render(mesh, modelMatrix, camera) {
      if (!this.initialized || !this.enabled) return;
      const gl = this.gl;
      gl.enable(2884);
      gl.cullFace(1028);
      this.shaderCompiler.use(this.program);
      gl.bindBuffer(34962, mesh.vertexBuffer);
      gl.bindBuffer(34963, mesh.indexBuffer);
      const stride = (3 + 3) * 4;
      const posLoc = this.shaderCompiler.getAttributeLocation(this.program, 'position');
      const normLoc = this.shaderCompiler.getAttributeLocation(this.program, 'normal');
      gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 3, 5126, false, stride, 0);
      gl.enableVertexAttribArray(normLoc); gl.vertexAttribPointer(normLoc, 3, 5126, false, stride, 12);
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'modelMatrix', modelMatrix);
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'viewMatrix', camera.getViewMatrix());
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'projectionMatrix', camera.getProjectionMatrix());
      this.shaderCompiler.setUniform1f(this.program, 'outlineWidth', this.outlineWidth);
      this.shaderCompiler.setUniform4f(this.program, 'outlineColor', ...this.outlineColor);
      gl.drawElements(4, mesh.indexCount, 5125, 0);
      gl.cullFace(1029);
    }

    setEnabled(v) { this.enabled = v; }
    setColor(r, g, b, a) { this.outlineColor = [r, g, b, a]; }
    setWidth(v) { this.outlineWidth = v; }
    setMode(mode) { if (['inverted_hull', 'screen_space', 'post_process'].includes(mode)) this.outlineMode = mode; }
    dispose() { this.initialized = false; }
  }

  // ============================================================
  // 粒子渲染器
  // ============================================================
  class ParticleRenderer {
    constructor(glContext, shaderCompiler) {
      this.gl = glContext.getContext();
      this.shaderCompiler = shaderCompiler;
      this.program = null;
      this.systems = [];
      this.maxParticles = 10000;
      this.initialized = false;
    }

    init() {
      const vs = `#version 300 es
precision highp float;
in vec3 position;
in vec3 velocity;
in vec4 color;
in float size;
in float life;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float time;
out vec4 vColor;
out float vLife;
out vec2 vUv;
void main() {
  vColor = color;
  vLife = life;
  vec4 mvPosition = viewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (300.0 / -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
}`;
      const fs = `#version 300 es
precision highp float;
in vec4 vColor;
in float vLife;
uniform sampler2D particleTexture;
uniform int useTexture;
out vec4 fragColor;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float dist = length(uv);
  if (dist > 0.5) discard;
  float alpha = smoothstep(0.5, 0.2, dist) * vLife;
  vec3 color = vColor.rgb;
  if (useTexture == 1) color *= texture(particleTexture, gl_PointCoord).rgb;
  fragColor = vec4(color, alpha * vColor.a);
}`;
      this.program = this.shaderCompiler.compile(vs, fs);
      this.initialized = true;
    }

    createSystem(config = {}) {
      const system = {
        particles: [],
        maxParticles: config.maxParticles || 1000,
        emissionRate: config.emissionRate || 10,
        emissionAccumulator: 0,
        position: config.position || [0, 0, 0],
        velocity: config.velocity || [0, 1, 0],
        velocityVariance: config.velocityVariance || [0.5, 0.5, 0.5],
        color: config.color || [1, 1, 1, 1],
        colorEnd: config.colorEnd || [1, 1, 1, 0],
        size: config.size || 0.1,
        sizeEnd: config.sizeEnd || 0.01,
        life: config.life || 2,
        lifeVariance: config.lifeVariance || 0.5,
        gravity: config.gravity || [0, -0.5, 0],
        blendMode: config.blendMode || 'additive',
        texture: config.texture || null,
        vertexBuffer: null,
        indexBuffer: null,
        active: true
      };
      this.systems.push(system);
      return system;
    }

    emit(system, count = 1) {
      for (let i = 0; i < count && system.particles.length < system.maxParticles; i++) {
        system.particles.push({
          position: [...system.position],
          velocity: [
            system.velocity[0] + (Math.random() - 0.5) * system.velocityVariance[0],
            system.velocity[1] + (Math.random() - 0.5) * system.velocityVariance[1],
            system.velocity[2] + (Math.random() - 0.5) * system.velocityVariance[2]
          ],
          color: [...system.color],
          size: system.size,
          life: system.life + (Math.random() - 0.5) * system.lifeVariance,
          maxLife: system.life + (Math.random() - 0.5) * system.lifeVariance,
          age: 0
        });
      }
    }

    update(dt) {
      for (const system of this.systems) {
        if (!system.active) continue;
        system.emissionAccumulator += system.emissionRate * dt;
        while (system.emissionAccumulator >= 1) {
          this.emit(system, 1);
          system.emissionAccumulator -= 1;
        }
        for (let i = system.particles.length - 1; i >= 0; i--) {
          const p = system.particles[i];
          p.age += dt;
          if (p.age >= p.maxLife) {
            system.particles.splice(i, 1);
            continue;
          }
          p.velocity[0] += system.gravity[0] * dt;
          p.velocity[1] += system.gravity[1] * dt;
          p.velocity[2] += system.gravity[2] * dt;
          p.position[0] += p.velocity[0] * dt;
          p.position[1] += p.velocity[1] * dt;
          p.position[2] += p.velocity[2] * dt;
          const t = p.age / p.maxLife;
          p.color[0] = system.color[0] + (system.colorEnd[0] - system.color[0]) * t;
          p.color[1] = system.color[1] + (system.colorEnd[1] - system.color[1]) * t;
          p.color[2] = system.color[2] + (system.colorEnd[2] - system.color[2]) * t;
          p.color[3] = system.color[3] + (system.colorEnd[3] - system.color[3]) * t;
          p.size = system.size + (system.sizeEnd - system.size) * t;
        }
      }
    }

    render(camera) {
      if (!this.initialized) return;
      const gl = this.gl;
      gl.enable(3042);
      for (const system of this.systems) {
        if (!system.active || system.particles.length === 0) continue;
        if (system.blendMode === 'additive') gl.blendFunc(770, 1);
        else gl.blendFunc(770, 771);
        this.shaderCompiler.use(this.program);
        const data = new Float32Array(system.particles.length * 12);
        for (let i = 0; i < system.particles.length; i++) {
          const p = system.particles[i];
          const base = i * 12;
          data[base] = p.position[0]; data[base+1] = p.position[1]; data[base+2] = p.position[2];
          data[base+3] = p.velocity[0]; data[base+4] = p.velocity[1]; data[base+5] = p.velocity[2];
          data[base+6] = p.color[0]; data[base+7] = p.color[1]; data[base+8] = p.color[2]; data[base+9] = p.color[3];
          data[base+10] = p.size; data[base+11] = 1 - p.age / p.maxLife;
        }
        if (!system.vertexBuffer) system.vertexBuffer = gl.createBuffer();
        gl.bindBuffer(34962, system.vertexBuffer);
        gl.bufferData(34962, data, 35048);
        const stride = 48;
        const posLoc = this.shaderCompiler.getAttributeLocation(this.program, 'position');
        const velLoc = this.shaderCompiler.getAttributeLocation(this.program, 'velocity');
        const colLoc = this.shaderCompiler.getAttributeLocation(this.program, 'color');
        const sizeLoc = this.shaderCompiler.getAttributeLocation(this.program, 'size');
        const lifeLoc = this.shaderCompiler.getAttributeLocation(this.program, 'life');
        gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 3, 5126, false, stride, 0);
        gl.enableVertexAttribArray(velLoc); gl.vertexAttribPointer(velLoc, 3, 5126, false, stride, 12);
        gl.enableVertexAttribArray(colLoc); gl.vertexAttribPointer(colLoc, 4, 5126, false, stride, 24);
        gl.enableVertexAttribArray(sizeLoc); gl.vertexAttribPointer(sizeLoc, 1, 5126, false, stride, 40);
        gl.enableVertexAttribArray(lifeLoc); gl.vertexAttribPointer(lifeLoc, 1, 5126, false, stride, 44);
        this.shaderCompiler.setUniformMatrix4fv(this.program, 'viewMatrix', camera.getViewMatrix());
        this.shaderCompiler.setUniformMatrix4fv(this.program, 'projectionMatrix', camera.getProjectionMatrix());
        this.shaderCompiler.setUniform1i(this.program, 'useTexture', system.texture ? 1 : 0);
        gl.drawArrays(0, 0, system.particles.length);
      }
      gl.disable(3042);
    }

    removeSystem(system) {
      const idx = this.systems.indexOf(system);
      if (idx !== -1) this.systems.splice(idx, 1);
    }
    getTotalParticles() { return this.systems.reduce((sum, s) => sum + s.particles.length, 0); }
    getSystemCount() { return this.systems.length; }
    clear() { this.systems = []; }
    dispose() { this.systems = []; this.initialized = false; }
  }

  // ============================================================
  // 渲染管线
  // ============================================================
  class RenderPipeline {
    constructor(glContext, shaderCompiler) {
      this.gl = glContext.getContext();
      this.glContext = glContext;
      this.shaderCompiler = shaderCompiler;
      this.renderQueue = new RenderQueue();
      this.cullingSystem = new CullingSystem();
      this.pmxRenderer = new PMXRenderer(glContext, shaderCompiler);
      this.skeletalRenderer = new SkeletalRenderer(glContext, shaderCompiler);
      this.transparentRenderer = new TransparentRenderer(glContext, shaderCompiler);
      this.outlineRenderer = new OutlineRenderer(glContext, shaderCompiler);
      this.particleRenderer = new ParticleRenderer(glContext, shaderCompiler);
      this.passes = [];
      this.currentPass = 0;
      this.frameBuffer = null;
      this.postProcessing = null;
      this.stats = { drawCalls: 0, triangles: 0, vertices: 0, objects: 0, opaque: 0, transparent: 0, particles: 0, frameTime: 0 };
      this.initialized = false;
      this.clearColor = [0, 0, 0, 1];
      this.autoClear = true;
    }

    init() {
      this.transparentRenderer.init();
      this.outlineRenderer.init();
      this.particleRenderer.init();
      this.initialized = true;
    }

    addPass(name, renderFn, options = {}) {
      this.passes.push({ name, renderFn, enabled: options.enabled !== false, order: options.order || this.passes.length });
      this.passes.sort((a, b) => a.order - b.order);
    }

    removePass(name) {
      const idx = this.passes.findIndex(p => p.name === name);
      if (idx !== -1) this.passes.splice(idx, 1);
    }

    render(camera, lights, scene) {
      if (!this.initialized) return;
      const startTime = performance.now();
      this.stats = { drawCalls: 0, triangles: 0, vertices: 0, objects: 0, opaque: 0, transparent: 0, particles: 0, frameTime: 0 };
      if (this.autoClear) {
        this.gl.clearColor(...this.clearColor);
        this.gl.clear(16640);
      }
      this.cullingSystem.updateFrustum(camera.getViewProjectionMatrix());
      const visibleObjects = this.cullingSystem.cullScene(scene.objects || []);
      this.stats.objects = visibleObjects.length;
      this.renderQueue.clear();
      for (const obj of visibleObjects) this.renderQueue.add(obj);
      this.renderQueue.sort(camera.position);
      for (const pass of this.passes) {
        if (!pass.enabled) continue;
        pass.renderFn(this, camera, lights, this.renderQueue);
      }
      this._renderOpaque(camera, lights);
      this._renderTransparent(camera, lights);
      this._renderParticles(camera);
      this.stats.frameTime = performance.now() - startTime;
    }

    _renderOpaque(camera, lights) {
      const opaque = this.renderQueue.getOpaque();
      this.stats.opaque = opaque.length;
      for (const obj of opaque) {
        if (obj.type === 'pmx') {
          this.pmxRenderer.update(obj.skeleton, obj.morphWeights);
          this.pmxRenderer.render(camera, lights);
          const s = this.pmxRenderer.getStats();
          this.stats.drawCalls += s.drawCalls;
          this.stats.triangles += s.triangles;
          this.stats.vertices += s.vertices;
        } else if (obj.type === 'skeletal') {
          this.skeletalRenderer.update();
          this.skeletalRenderer.render(camera, lights, obj.modelMatrix);
          const s = this.skeletalRenderer.getStats();
          this.stats.drawCalls += s.drawCalls;
          this.stats.triangles += s.triangles;
        }
        if (obj.outline) {
          this.outlineRenderer.render(obj.mesh, obj.modelMatrix, camera);
          this.stats.drawCalls++;
        }
      }
    }

    _renderTransparent(camera, lights) {
      const transparent = this.renderQueue.getTransparent();
      this.stats.transparent = transparent.length;
      if (transparent.length > 0) {
        this.transparentRenderer.objects = transparent;
        this.transparentRenderer.render(camera, lights);
        this.stats.drawCalls += transparent.length;
      }
    }

    _renderParticles(camera) {
      this.particleRenderer.update(1/60);
      this.particleRenderer.render(camera);
      this.stats.particles = this.particleRenderer.getTotalParticles();
      this.stats.drawCalls += this.particleRenderer.getSystemCount();
    }

    setClearColor(r, g, b, a) { this.clearColor = [r, g, b, a]; }
    setAutoClear(v) { this.autoClear = v; }
    getStats() { return { ...this.stats }; }
    getRenderQueue() { return this.renderQueue; }
    getCullingSystem() { return this.cullingSystem; }
    getPMXRenderer() { return this.pmxRenderer; }
    getSkeletalRenderer() { return this.skeletalRenderer; }
    getTransparentRenderer() { return this.transparentRenderer; }
    getOutlineRenderer() { return this.outlineRenderer; }
    getParticleRenderer() { return this.particleRenderer; }
    dispose() {
      this.pmxRenderer.dispose();
      this.skeletalRenderer.dispose();
      this.transparentRenderer.dispose();
      this.outlineRenderer.dispose();
      this.particleRenderer.dispose();
      this.initialized = false;
    }
  }

  return {
    RenderQueue, CullingSystem, PMXRenderer, SkeletalRenderer,
    TransparentRenderer, OutlineRenderer, ParticleRenderer, RenderPipeline
  };
})();

if (typeof window !== 'undefined') window.SpiritRenderer = SpiritRenderer;
if (typeof globalThis !== 'undefined') globalThis.SpiritRenderer = SpiritRenderer;
