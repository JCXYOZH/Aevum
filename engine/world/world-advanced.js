/**
 * 3D世界引擎扩展 - 高级水系统/植被系统/光照系统/天气系统/后处理/体积雾
 * 纯WebGL2，零第三方依赖
 * @version 2.0.0
 */
'use strict';

const World3DExt = (function () {

  // ============================================================
  // 高级水系统 - Gerstner波浪/反射/折射/焦散
  // ============================================================
  class AdvancedWaterSystem {
    constructor(glContext, shaderCompiler) {
      this.gl = glContext.getContext();
      this.shaderCompiler = shaderCompiler;
      this.program = null;
      this.waterPlane = null;
      this.waves = [];
      this.time = 0;
      this.waterColor = [0.1, 0.3, 0.5, 0.8];
      this.deepColor = [0.02, 0.05, 0.1];
      this.shallowColor = [0.2, 0.5, 0.6];
      this.transparency = 0.7;
      this.reflectivity = 0.5;
      this.waveHeight = 0.3;
      this.waveSpeed = 1;
      this.waveScale = 1;
      this.foamIntensity = 0.5;
      this.foamThreshold = 0.5;
      this.causticIntensity = 0.3;
      this.normalStrength = 1;
      this.initialized = false;
      this.reflectionFramebuffer = null;
      this.refractionFramebuffer = null;
    }

    init() {
      const vs = `#version 300 es
precision highp float;
in vec3 position;
in vec2 uv;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float time;
uniform float waveHeight;
uniform float waveScale;
uniform float waveSpeed;
out vec3 vWorldPosition;
out vec2 vUv;
out vec3 vNormal;
float gerstnerWave(vec2 pos, vec2 dir, float steepness, float wavelength, float speed, float t, out vec3 tangent, out vec3 binormal) {
  float k = 6.28318 / wavelength;
  float c = sqrt(9.8 / k);
  vec2 d = normalize(dir);
  float f = k * (dot(d, pos) - c * t * speed);
  float a = steepness / k;
  tangent = vec3(1.0 - d.x * d.x * steepness * sin(f), d.x * steepness * cos(f), -d.x * d.y * steepness * sin(f));
  binormal = vec3(-d.x * d.y * steepness * sin(f), d.y * steepness * cos(f), 1.0 - d.y * d.y * steepness * sin(f));
  return a * cos(f);
}
void main() {
  vec3 pos = position;
  vec3 tangent = vec3(1, 0, 0);
  vec3 binormal = vec3(0, 0, 1);
  vec3 totalTangent = vec3(0);
  vec3 totalBinormal = vec3(0);
  float waveSum = 0.0;
  waveSum += gerstnerWave(pos.xz * waveScale, vec2(1.0, 0.3), 0.15, 8.0, 1.0, time * waveSpeed, tangent, binormal);
  totalTangent += tangent; totalBinormal += binormal;
  waveSum += gerstnerWave(pos.xz * waveScale, vec2(0.5, 1.0), 0.12, 5.0, 1.2, time * waveSpeed, tangent, binormal);
  totalTangent += tangent; totalBinormal += binormal;
  waveSum += gerstnerWave(pos.xz * waveScale, vec2(-0.7, 0.5), 0.1, 3.0, 1.5, time * waveSpeed, tangent, binormal);
  totalTangent += tangent; totalBinormal += binormal;
  waveSum += gerstnerWave(pos.xz * waveScale, vec2(0.3, -0.8), 0.08, 2.0, 1.8, time * waveSpeed, tangent, binormal);
  totalTangent += tangent; totalBinormal += binormal;
  pos.y += waveSum * waveHeight;
  vec3 normal = normalize(cross(totalBinormal, totalTangent));
  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPosition = worldPos.xyz;
  vUv = uv;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}`;
      const fs = `#version 300 es
precision highp float;
in vec3 vWorldPosition;
in vec2 vUv;
in vec3 vNormal;
uniform vec3 waterColor;
uniform vec3 deepColor;
uniform vec3 shallowColor;
uniform float transparency;
uniform float reflectivity;
uniform float foamIntensity;
uniform float foamThreshold;
uniform float causticIntensity;
uniform float normalStrength;
uniform vec3 cameraPosition;
uniform vec3 lightDirection;
uniform vec3 lightColor;
uniform vec3 ambientColor;
uniform float ambientIntensity;
uniform float time;
uniform sampler2D reflectionMap;
uniform sampler2D refractionMap;
uniform sampler2D depthMap;
out vec4 fragColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPosition);
  vec3 L = normalize(-lightDirection);
  vec3 H = normalize(V + L);
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  fresnel = mix(0.02, 1.0, fresnel);
  vec2 screenUv = vUv;
  vec3 reflectionColor = texture(reflectionMap, screenUv + N.xz * 0.02).rgb;
  vec3 refractionColor = texture(refractionMap, screenUv + N.xz * 0.01).rgb;
  float depth = texture(depthMap, screenUv).r;
  float waterDepth = smoothstep(0.0, 0.1, depth);
  vec3 color = mix(shallowColor, deepColor, waterDepth);
  color = mix(refractionColor, color, 0.5);
  color = mix(color, reflectionColor, fresnel * reflectivity);
  float NdotL = max(dot(N, L), 0.0);
  float NdotH = max(dot(N, H), 0.0);
  vec3 specular = lightColor * pow(NdotH, 200.0) * 0.8;
  color += specular;
  color += waterColor * NdotL * 0.1;
  float foam = smoothstep(foamThreshold, foamThreshold + 0.1, noise(vWorldPosition.xz * 2.0 + time * 0.5));
  foam *= smoothstep(0.3, 0.7, waterDepth);
  color = mix(color, vec3(1.0), foam * foamIntensity);
  float caustic = noise(vWorldPosition.xz * 5.0 + time * 0.3) * noise(vWorldPosition.xz * 7.0 - time * 0.2);
  color += caustic * causticIntensity * (1.0 - waterDepth) * lightColor;
  color += ambientColor * ambientIntensity * 0.3;
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0/2.2));
  fragColor = vec4(color, mix(transparency, 1.0, fresnel * 0.5));
}`;
      this.program = this.shaderCompiler.compile(vs, fs);
      this._createWaterPlane();
      this.initialized = true;
    }

    _createWaterPlane() {
      const size = 100;
      const segments = 128;
      const vertices = [];
      const uvs = [];
      const indices = [];
      for (let z = 0; z <= segments; z++) {
        for (let x = 0; x <= segments; x++) {
          vertices.push((x / segments - 0.5) * size, 0, (z / segments - 0.5) * size);
          uvs.push(x / segments, z / segments);
        }
      }
      for (let z = 0; z < segments; z++) {
        for (let x = 0; x < segments; x++) {
          const a = z * (segments + 1) + x;
          const b = a + segments + 1;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
      this.waterPlane = {
        vertexData: new Float32Array(vertices),
        uvData: new Float32Array(uvs),
        indexData: new Uint32Array(indices),
        vertexBuffer: null,
        uvBuffer: null,
        indexBuffer: null
      };
    }

    addWave(params) {
      this.waves.push({
        direction: params.direction || [1, 0],
        steepness: params.steepness || 0.1,
        wavelength: params.wavelength || 8,
        speed: params.speed || 1
      });
    }

    update(dt) {
      this.time += dt;
    }

    render(camera, lights) {
      if (!this.initialized) return;
      const gl = this.gl;
      this.shaderCompiler.use(this.program);
      if (!this.waterPlane.vertexBuffer) {
        this.waterPlane.vertexBuffer = gl.createBuffer();
        this.waterPlane.uvBuffer = gl.createBuffer();
        this.waterPlane.indexBuffer = gl.createBuffer();
      }
      gl.bindBuffer(34962, this.waterPlane.vertexBuffer);
      gl.bufferData(34962, this.waterPlane.vertexData, 35044);
      gl.bindBuffer(34962, this.waterPlane.uvBuffer);
      gl.bufferData(34962, this.waterPlane.uvData, 35044);
      gl.bindBuffer(34963, this.waterPlane.indexBuffer);
      gl.bufferData(34963, this.waterPlane.indexData, 35044);
      const posLoc = this.shaderCompiler.getAttributeLocation(this.program, 'position');
      const uvLoc = this.shaderCompiler.getAttributeLocation(this.program, 'uv');
      gl.bindBuffer(34962, this.waterPlane.vertexBuffer);
      gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 3, 5126, false, 0, 0);
      gl.bindBuffer(34962, this.waterPlane.uvBuffer);
      gl.enableVertexAttribArray(uvLoc); gl.vertexAttribPointer(uvLoc, 2, 5126, false, 0, 0);
      const modelMatrix = new Float32Array(16);
      modelMatrix[0] = 1; modelMatrix[5] = 1; modelMatrix[10] = 1; modelMatrix[15] = 1;
      modelMatrix[13] = -0.5;
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'modelMatrix', modelMatrix);
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'viewMatrix', camera.getViewMatrix());
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'projectionMatrix', camera.getProjectionMatrix());
      this.shaderCompiler.setUniform1f(this.program, 'time', this.time);
      this.shaderCompiler.setUniform1f(this.program, 'waveHeight', this.waveHeight);
      this.shaderCompiler.setUniform1f(this.program, 'waveScale', this.waveScale);
      this.shaderCompiler.setUniform1f(this.program, 'waveSpeed', this.waveSpeed);
      this.shaderCompiler.setUniform3f(this.program, 'waterColor', ...this.waterColor.slice(0, 3));
      this.shaderCompiler.setUniform3f(this.program, 'deepColor', ...this.deepColor);
      this.shaderCompiler.setUniform3f(this.program, 'shallowColor', ...this.shallowColor);
      this.shaderCompiler.setUniform1f(this.program, 'transparency', this.transparency);
      this.shaderCompiler.setUniform1f(this.program, 'reflectivity', this.reflectivity);
      this.shaderCompiler.setUniform1f(this.program, 'foamIntensity', this.foamIntensity);
      this.shaderCompiler.setUniform1f(this.program, 'foamThreshold', this.foamThreshold);
      this.shaderCompiler.setUniform1f(this.program, 'causticIntensity', this.causticIntensity);
      this.shaderCompiler.setUniform1f(this.program, 'normalStrength', this.normalStrength);
      this.shaderCompiler.setUniform3f(this.program, 'cameraPosition', ...camera.position);
      this.shaderCompiler.setUniform3f(this.program, 'lightDirection', ...lights.directionalLight.direction);
      this.shaderCompiler.setUniform3f(this.program, 'lightColor', ...lights.directionalLight.color);
      this.shaderCompiler.setUniform3f(this.program, 'ambientColor', ...lights.ambientLight.color);
      this.shaderCompiler.setUniform1f(this.program, 'ambientIntensity', lights.ambientLight.intensity);
      gl.enable(3042);
      gl.blendFunc(770, 771);
      gl.drawElements(4, this.waterPlane.indexData.length, 5125, 0);
      gl.disable(3042);
    }

    setWaterColor(r, g, b, a = 1) { this.waterColor = [r, g, b, a]; }
    setDeepColor(r, g, b) { this.deepColor = [r, g, b]; }
    setShallowColor(r, g, b) { this.shallowColor = [r, g, b]; }
    setWaveHeight(v) { this.waveHeight = v; }
    setWaveSpeed(v) { this.waveSpeed = v; }
    setWaveScale(v) { this.waveScale = v; }
    setTransparency(v) { this.transparency = Math.max(0, Math.min(1, v)); }
    setReflectivity(v) { this.reflectivity = Math.max(0, Math.min(1, v)); }
    setFoamIntensity(v) { this.foamIntensity = v; }
    getWaveCount() { return this.waves.length; }
    getWaterHeight(x, z) {
      let height = 0;
      for (const wave of this.waves) {
        const k = (Math.PI * 2) / wave.wavelength;
        const c = Math.sqrt(9.8 / k);
        const d = this._normalize(wave.direction);
        const f = k * (d[0] * x + d[1] * z - c * this.time * wave.speed);
        height += (wave.steepness / k) * Math.cos(f) * this.waveHeight;
      }
      return height;
    }
    _normalize(v) { const l = Math.sqrt(v[0]*v[0]+v[1]*v[1]) || 1; return [v[0]/l, v[1]/l]; }
    dispose() {
      const gl = this.gl;
      if (this.waterPlane) {
        if (this.waterPlane.vertexBuffer) gl.deleteBuffer(this.waterPlane.vertexBuffer);
        if (this.waterPlane.uvBuffer) gl.deleteBuffer(this.waterPlane.uvBuffer);
        if (this.waterPlane.indexBuffer) gl.deleteBuffer(this.waterPlane.indexBuffer);
      }
      this.waves = [];
      this.initialized = false;
    }
  }

  // ============================================================
  // 植被系统 - 实例化渲染/风摆动/LOD
  // ============================================================
  class VegetationSystem {
    constructor(glContext, shaderCompiler) {
      this.gl = glContext.getContext();
      this.shaderCompiler = shaderCompiler;
      this.program = null;
      this.trees = [];
      this.grass = [];
      this.maxInstances = 10000;
      this.windStrength = 0.2;
      this.windDirection = [1, 0, 0];
      this.time = 0;
      this.lodDistance = 50;
      this.initialized = false;
      this.drawCalls = 0;
      this.instancesRendered = 0;
    }

    init() {
      const vs = `#version 300 es
precision highp float;
in vec3 position;
in vec3 normal;
in vec2 uv;
in vec3 instancePosition;
in vec4 instanceRotation;
in vec3 instanceScale;
in float instanceType;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float time;
uniform vec3 windDirection;
uniform float windStrength;
out vec3 vNormal;
out vec2 vUv;
out vec3 vWorldPosition;
out float vType;
vec3 rotateVector(vec4 q, vec3 v) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}
void main() {
  vec3 pos = position * instanceScale;
  float windFactor = smoothstep(0.0, 1.0, position.y);
  float sway = sin(time * 2.0 + instancePosition.x * 0.5 + instancePosition.z * 0.3) * windStrength * windFactor;
  pos.x += sway * windDirection.x;
  pos.z += sway * windDirection.z;
  pos = rotateVector(instanceRotation, pos);
  pos += instancePosition;
  vec4 worldPos = vec4(pos, 1.0);
  vWorldPosition = worldPos.xyz;
  vNormal = normalize(rotateVector(instanceRotation, normal));
  vUv = uv;
  vType = instanceType;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}`;
      const fs = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec2 vUv;
in vec3 vWorldPosition;
in float vType;
uniform vec3 lightDirection;
uniform vec3 lightColor;
uniform vec3 ambientColor;
uniform float ambientIntensity;
uniform vec3 treeColor;
uniform vec3 grassColor;
uniform vec3 trunkColor;
out vec4 fragColor;
void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(-lightDirection);
  float NdotL = max(dot(N, L), 0.0);
  vec3 color;
  if (vType < 0.5) {
    color = mix(treeColor, treeColor * 0.7, vUv.y);
  } else if (vType < 1.5) {
    color = grassColor * (0.7 + 0.3 * sin(vUv.x * 10.0));
  } else {
    color = trunkColor;
  }
  vec3 diffuse = color * NdotL * lightColor;
  vec3 ambient = color * ambientColor * ambientIntensity;
  vec3 finalColor = ambient + diffuse;
  finalColor = finalColor / (finalColor + vec3(1.0));
  finalColor = pow(finalColor, vec3(1.0/2.2));
  fragColor = vec4(finalColor, 1.0);
}`;
      this.program = this.shaderCompiler.compile(vs, fs);
      this.initialized = true;
    }

    addTree(position, scale = 1, rotation = [0, 0, 0, 1]) {
      this.trees.push({
        position: [...position],
        scale: [scale, scale * (1.2 + Math.random() * 0.3), scale],
        rotation: [...rotation],
        type: 0,
        height: 3 * scale
      });
    }

    addGrass(position, scale = 1) {
      this.grass.push({
        position: [...position],
        scale: [scale * 0.1, scale * (0.3 + Math.random() * 0.2), scale * 0.1],
        rotation: [0, Math.random() * Math.PI * 2, 0, 1],
        type: 1
      });
    }

    generateForest(center, radius, treeCount, grassCount, heightFunc) {
      for (let i = 0; i < treeCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * radius;
        const x = center[0] + Math.cos(angle) * r;
        const z = center[2] + Math.sin(angle) * r;
        const y = heightFunc ? heightFunc(x, z) : 0;
        this.addTree([x, y, z], 0.8 + Math.random() * 0.6);
      }
      for (let i = 0; i < grassCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * radius;
        const x = center[0] + Math.cos(angle) * r;
        const z = center[2] + Math.sin(angle) * r;
        const y = heightFunc ? heightFunc(x, z) : 0;
        this.addGrass([x, y, z], 0.8 + Math.random() * 0.4);
      }
    }

    update(dt, camera) {
      this.time += dt;
      this.drawCalls = 0;
      this.instancesRendered = 0;
    }

    render(camera, lights) {
      if (!this.initialized) return;
      const gl = this.gl;
      const allInstances = [...this.trees, ...this.grass];
      const visibleInstances = allInstances.filter(inst => {
        const dx = inst.position[0] - camera.position[0];
        const dz = inst.position[2] - camera.position[2];
        return dx * dx + dz * dz < this.lodDistance * this.lodDistance * 4;
      });
      if (visibleInstances.length === 0) return;
      this.shaderCompiler.use(this.program);
      const treeGeometry = this._createTreeGeometry();
      const grassGeometry = this._createGrassGeometry();
      for (let type = 0; type < 2; type++) {
        const typeInstances = visibleInstances.filter(inst => inst.type === type);
        if (typeInstances.length === 0) continue;
        const geo = type === 0 ? treeGeometry : grassGeometry;
        const instanceData = new Float32Array(typeInstances.length * 11);
        for (let i = 0; i < typeInstances.length; i++) {
          const inst = typeInstances[i];
          const base = i * 11;
          instanceData[base] = inst.position[0];
          instanceData[base+1] = inst.position[1];
          instanceData[base+2] = inst.position[2];
          instanceData[base+3] = inst.rotation[0];
          instanceData[base+4] = inst.rotation[1];
          instanceData[base+5] = inst.rotation[2];
          instanceData[base+6] = inst.rotation[3];
          instanceData[base+7] = inst.scale[0];
          instanceData[base+8] = inst.scale[1];
          instanceData[base+9] = inst.scale[2];
          instanceData[base+10] = inst.type;
        }
        const instanceBuffer = gl.createBuffer();
        gl.bindBuffer(34962, instanceBuffer);
        gl.bufferData(34962, instanceData, 35048);
        gl.bindBuffer(34962, geo.vertexBuffer);
        gl.bufferData(34962, geo.vertexData, 35044);
        gl.bindBuffer(34963, geo.indexBuffer);
        gl.bufferData(34963, geo.indexData, 35044);
        const stride = 8 * 4;
        const posLoc = this.shaderCompiler.getAttributeLocation(this.program, 'position');
        const normLoc = this.shaderCompiler.getAttributeLocation(this.program, 'normal');
        const uvLoc = this.shaderCompiler.getAttributeLocation(this.program, 'uv');
        gl.bindBuffer(34962, geo.vertexBuffer);
        gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 3, 5126, false, stride, 0);
        gl.enableVertexAttribArray(normLoc); gl.vertexAttribPointer(normLoc, 3, 5126, false, stride, 12);
        gl.enableVertexAttribArray(uvLoc); gl.vertexAttribPointer(uvLoc, 2, 5126, false, stride, 24);
        const instPosLoc = this.shaderCompiler.getAttributeLocation(this.program, 'instancePosition');
        const instRotLoc = this.shaderCompiler.getAttributeLocation(this.program, 'instanceRotation');
        const instScaleLoc = this.shaderCompiler.getAttributeLocation(this.program, 'instanceScale');
        const instTypeLoc = this.shaderCompiler.getAttributeLocation(this.program, 'instanceType');
        gl.bindBuffer(34962, instanceBuffer);
        gl.enableVertexAttribArray(instPosLoc); gl.vertexAttribPointer(instPosLoc, 3, 5126, false, 44, 0);
        gl.vertexAttribDivisor(instPosLoc, 1);
        gl.enableVertexAttribArray(instRotLoc); gl.vertexAttribPointer(instRotLoc, 4, 5126, false, 44, 12);
        gl.vertexAttribDivisor(instRotLoc, 1);
        gl.enableVertexAttribArray(instScaleLoc); gl.vertexAttribPointer(instScaleLoc, 3, 5126, false, 44, 28);
        gl.vertexAttribDivisor(instScaleLoc, 1);
        gl.enableVertexAttribArray(instTypeLoc); gl.vertexAttribPointer(instTypeLoc, 1, 5126, false, 44, 40);
        gl.vertexAttribDivisor(instTypeLoc, 1);
        this.shaderCompiler.setUniformMatrix4fv(this.program, 'viewMatrix', camera.getViewMatrix());
        this.shaderCompiler.setUniformMatrix4fv(this.program, 'projectionMatrix', camera.getProjectionMatrix());
        this.shaderCompiler.setUniform1f(this.program, 'time', this.time);
        this.shaderCompiler.setUniform3f(this.program, 'windDirection', ...this.windDirection);
        this.shaderCompiler.setUniform1f(this.program, 'windStrength', this.windStrength);
        this.shaderCompiler.setUniform3f(this.program, 'lightDirection', ...lights.directionalLight.direction);
        this.shaderCompiler.setUniform3f(this.program, 'lightColor', ...lights.directionalLight.color);
        this.shaderCompiler.setUniform3f(this.program, 'ambientColor', ...lights.ambientLight.color);
        this.shaderCompiler.setUniform1f(this.program, 'ambientIntensity', lights.ambientLight.intensity);
        this.shaderCompiler.setUniform3f(this.program, 'treeColor', 0.2, 0.5, 0.15);
        this.shaderCompiler.setUniform3f(this.program, 'grassColor', 0.3, 0.6, 0.2);
        this.shaderCompiler.setUniform3f(this.program, 'trunkColor', 0.4, 0.25, 0.15);
        gl.drawElementsInstanced(4, geo.indexData.length, 5125, 0, typeInstances.length);
        this.drawCalls++;
        this.instancesRendered += typeInstances.length;
        gl.deleteBuffer(instanceBuffer);
      }
    }

    _createTreeGeometry() {
      const vertices = [];
      const indices = [];
      const trunkSegments = 8;
      const trunkHeight = 1.5;
      const trunkRadius = 0.15;
      for (let i = 0; i <= trunkSegments; i++) {
        const angle = (i / trunkSegments) * Math.PI * 2;
        const x = Math.cos(angle) * trunkRadius;
        const z = Math.sin(angle) * trunkRadius;
        vertices.push(x, 0, z, x/trunkRadius, 0, z/trunkRadius, 0, 0);
        vertices.push(x, trunkHeight, z, x/trunkRadius, 0, z/trunkRadius, 0, 1);
      }
      for (let i = 0; i < trunkSegments; i++) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const crownCenter = vertices.length / 8;
      const crownRadius = 0.8;
      const crownSegments = 12;
      for (let i = 0; i <= crownSegments; i++) {
        const angle = (i / crownSegments) * Math.PI * 2;
        const x = Math.cos(angle) * crownRadius;
        const z = Math.sin(angle) * crownRadius;
        vertices.push(x, trunkHeight + crownRadius * 0.5, z, 0, 1, 0, i / crownSegments, 0);
        vertices.push(x * 0.7, trunkHeight + crownRadius * 1.5, z * 0.7, 0, 1, 0, i / crownSegments, 1);
      }
      for (let i = 0; i < crownSegments; i++) {
        const a = crownCenter + i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      return {
        vertexData: new Float32Array(vertices),
        indexData: new Uint32Array(indices),
        vertexBuffer: this.gl.createBuffer(),
        indexBuffer: this.gl.createBuffer()
      };
    }

    _createGrassGeometry() {
      const vertices = [
        -0.5, 0, 0, 0, 0, 1, 0, 0,
        0.5, 0, 0, 0, 0, 1, 1, 0,
        -0.3, 1, 0, 0, 0, 1, 0.1, 1,
        0.3, 1, 0, 0, 0, 1, 0.9, 1
      ];
      const indices = [0, 1, 2, 1, 3, 2];
      return {
        vertexData: new Float32Array(vertices),
        indexData: new Uint32Array(indices),
        vertexBuffer: this.gl.createBuffer(),
        indexBuffer: this.gl.createBuffer()
      };
    }

    setWindStrength(v) { this.windStrength = v; }
    setWindDirection(x, y, z) { this.windDirection = [x, y, z]; }
    setLodDistance(v) { this.lodDistance = v; }
    getTreeCount() { return this.trees.length; }
    getGrassCount() { return this.grass.length; }
    getStats() { return { drawCalls: this.drawCalls, instancesRendered: this.instancesRendered, trees: this.trees.length, grass: this.grass.length }; }
    clear() { this.trees = []; this.grass = []; }
    dispose() { this.clear(); this.initialized = false; }
  }

  // ============================================================
  // 体积雾系统
  // ============================================================
  class VolumetricFog {
    constructor(glContext, shaderCompiler) {
      this.gl = glContext.getContext();
      this.shaderCompiler = shaderCompiler;
      this.program = null;
      this.fogColor = [0.7, 0.75, 0.8];
      this.fogDensity = 0.02;
      this.fogHeight = 10;
      this.fogHeightFalloff = 0.5;
      this.sunScatterIntensity = 0.5;
      this.sunDirection = [0.5, 0.8, 0.3];
      this.initialized = false;
    }

    init() {
      const vs = `#version 300 es
precision highp float;
in vec2 position;
out vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;
      const fs = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D sceneTexture;
uniform sampler2D depthTexture;
uniform mat4 inverseProjection;
uniform mat4 inverseView;
uniform vec3 cameraPosition;
uniform vec3 fogColor;
uniform float fogDensity;
uniform float fogHeight;
uniform float fogHeightFalloff;
uniform float sunScatterIntensity;
uniform vec3 sunDirection;
uniform vec3 sunColor;
uniform float nearPlane;
uniform float farPlane;
out vec4 fragColor;
float getLinearDepth(float depth) {
  float z = depth * 2.0 - 1.0;
  return (2.0 * nearPlane * farPlane) / (farPlane + nearPlane - z * (farPlane - nearPlane));
}
vec3 getWorldPosition(vec2 uv, float depth) {
  vec4 clipPos = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 viewPos = inverseProjection * clipPos;
  viewPos /= viewPos.w;
  vec4 worldPos = inverseView * viewPos;
  return worldPos.xyz;
}
void main() {
  vec3 sceneColor = texture(sceneTexture, vUv).rgb;
  float depth = texture(depthTexture, vUv).r;
  if (depth >= 1.0) {
    fragColor = vec4(sceneColor, 1.0);
    return;
  }
  vec3 worldPos = getWorldPosition(vUv, depth);
  vec3 rayDir = normalize(worldPos - cameraPosition);
  float rayLength = length(worldPos - cameraPosition);
  const int STEPS = 32;
  float stepSize = rayLength / float(STEPS);
  vec3 fogAccum = vec3(0.0);
  float transmittance = 1.0;
  for (int i = 0; i < STEPS; i++) {
    float t = (float(i) + 0.5) * stepSize;
    vec3 samplePos = cameraPosition + rayDir * t;
    float heightFactor = exp(-max(0.0, samplePos.y - fogHeight) * fogHeightFalloff);
    float fogAmount = fogDensity * heightFactor * stepSize;
    float sunDot = max(dot(rayDir, sunDirection), 0.0);
    float sunScatter = pow(sunDot, 8.0) * sunScatterIntensity;
    vec3 scatterColor = fogColor + sunColor * sunScatter;
    fogAccum += scatterColor * fogAmount * transmittance;
    transmittance *= exp(-fogAmount);
  }
  vec3 finalColor = sceneColor * transmittance + fogAccum;
  finalColor = finalColor / (finalColor + vec3(1.0));
  finalColor = pow(finalColor, vec3(1.0/2.2));
  fragColor = vec4(finalColor, 1.0);
}`;
      this.program = this.shaderCompiler.compile(vs, fs);
      this.initialized = true;
    }

    apply(sceneTexture, depthTexture, camera, nearPlane, farPlane) {
      if (!this.initialized) return;
      const gl = this.gl;
      this.shaderCompiler.use(this.program);
      const quadVertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
      const quadBuffer = gl.createBuffer();
      gl.bindBuffer(34962, quadBuffer);
      gl.bufferData(34962, quadVertices, 35044);
      const posLoc = this.shaderCompiler.getAttributeLocation(this.program, 'position');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, 5126, false, 0, 0);
      gl.activeTexture(33984);
      gl.bindTexture(3553, sceneTexture);
      this.shaderCompiler.setUniform1i(this.program, 'sceneTexture', 0);
      gl.activeTexture(33985);
      gl.bindTexture(3553, depthTexture);
      this.shaderCompiler.setUniform1i(this.program, 'depthTexture', 1);
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'inverseProjection', camera.getInverseProjectionMatrix());
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'inverseView', camera.getInverseViewMatrix());
      this.shaderCompiler.setUniform3f(this.program, 'cameraPosition', ...camera.position);
      this.shaderCompiler.setUniform3f(this.program, 'fogColor', ...this.fogColor);
      this.shaderCompiler.setUniform1f(this.program, 'fogDensity', this.fogDensity);
      this.shaderCompiler.setUniform1f(this.program, 'fogHeight', this.fogHeight);
      this.shaderCompiler.setUniform1f(this.program, 'fogHeightFalloff', this.fogHeightFalloff);
      this.shaderCompiler.setUniform1f(this.program, 'sunScatterIntensity', this.sunScatterIntensity);
      this.shaderCompiler.setUniform3f(this.program, 'sunDirection', ...this.sunDirection);
      this.shaderCompiler.setUniform3f(this.program, 'sunColor', 1, 0.95, 0.85);
      this.shaderCompiler.setUniform1f(this.program, 'nearPlane', nearPlane);
      this.shaderCompiler.setUniform1f(this.program, 'farPlane', farPlane);
      gl.drawArrays(5, 0, 4);
      gl.deleteBuffer(quadBuffer);
    }

    setFogColor(r, g, b) { this.fogColor = [r, g, b]; }
    setFogDensity(v) { this.fogDensity = Math.max(0, v); }
    setFogHeight(v) { this.fogHeight = v; }
    setFogHeightFalloff(v) { this.fogHeightFalloff = v; }
    setSunScatterIntensity(v) { this.sunScatterIntensity = v; }
    setSunDirection(x, y, z) { this.sunDirection = this._normalize([x, y, z]); }
    _normalize(v) { const l = Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; }
    dispose() { this.initialized = false; }
  }

  return {
    AdvancedWaterSystem, VegetationSystem, VolumetricFog
  };
})();

if (typeof window !== 'undefined') window.World3DExt = World3DExt;
if (typeof globalThis !== 'undefined') globalThis.World3DExt = World3DExt;
