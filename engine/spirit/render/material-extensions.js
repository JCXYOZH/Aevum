/**
 * 灵体渲染引擎扩展 - 头发/布料/眼睛/次表面散射/PBR渲染器
 * 纯WebGL2，零第三方依赖
 * @version 2.0.0
 */
'use strict';

const SpiritRendererExt = (function () {

  // ============================================================
  // 头发渲染器 - Kajiya-Kay着色/物理模拟/实例化
  // ============================================================
  class HairRenderer {
    constructor(glContext, shaderCompiler) {
      this.gl = glContext.getContext();
      this.shaderCompiler = shaderCompiler;
      this.program = null;
      this.hairStrands = [];
      this.hairMeshes = [];
      this.maxStrands = 10000;
      this.segmentsPerStrand = 16;
      this.hairColor = [0.1, 0.08, 0.06, 1.0];
      this.highlightColor = [0.4, 0.3, 0.2, 1.0];
      this.specularPower = 60;
      this.specularIntensity = 0.8;
      this.roughness = 0.3;
      this.alpha = 0.9;
      this.windStrength = 0.1;
      this.windDirection = [1, 0, 0];
      this.gravity = [0, -0.5, 0];
      this.stiffness = 0.8;
      this.damping = 0.9;
      this.vertexBuffer = null;
      this.indexBuffer = null;
      this.initialized = false;
      this.time = 0;
      this.drawCalls = 0;
      this.triangles = 0;
    }

    init() {
      const vs = `#version 300 es
precision highp float;
in vec3 position;
in vec3 tangent;
in vec2 uv;
in vec3 color;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float time;
uniform vec3 windDirection;
uniform float windStrength;
out vec3 vTangent;
out vec2 vUv;
out vec3 vColor;
out vec3 vViewPosition;
out vec3 vWorldPosition;
void main() {
  vec3 pos = position;
  float strandFactor = uv.y;
  pos += windDirection * sin(time * 2.0 + position.y * 5.0) * windStrength * strandFactor;
  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPosition = worldPos.xyz;
  vec4 mvPosition = viewMatrix * worldPos;
  vViewPosition = -mvPosition.xyz;
  vTangent = normalize(mat3(modelMatrix) * tangent);
  vUv = uv;
  vColor = color;
  gl_Position = projectionMatrix * mvPosition;
}`;
      const fs = `#version 300 es
precision highp float;
in vec3 vTangent;
in vec2 vUv;
in vec3 vColor;
in vec3 vViewPosition;
in vec3 vWorldPosition;
uniform vec3 hairColor;
uniform vec3 highlightColor;
uniform vec3 lightDirection;
uniform vec3 lightColor;
uniform vec3 ambientColor;
uniform float ambientIntensity;
uniform float specularPower;
uniform float specularIntensity;
uniform float roughness;
uniform float alpha;
uniform vec3 cameraPosition;
out vec4 fragColor;
void main() {
  vec3 T = normalize(vTangent);
  vec3 V = normalize(vViewPosition);
  vec3 L = normalize(-lightDirection);
  vec3 H = normalize(V + L);
  float NdotL = abs(dot(T, L));
  float diffuse = NdotL * 0.5 + 0.5;
  float specAngle = dot(T, H);
  float specular = pow(specAngle * specAngle, specularPower) * specularIntensity;
  float shift = 0.3;
  float specAngle2 = dot(T, normalize(V + reflect(L, vec3(0.0, 1.0, 0.0)) + vec3(0.0, shift, 0.0)));
  float specular2 = pow(max(0.0, specAngle2), specularPower * 0.5) * specularIntensity * 0.5;
  vec3 color = mix(hairColor, highlightColor, vUv.y * 0.5);
  color *= vColor;
  vec3 finalColor = color * (ambientColor * ambientIntensity + diffuse * lightColor);
  finalColor += (specular + specular2) * lightColor;
  float strandAlpha = alpha * smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
  finalColor = finalColor / (finalColor + vec3(1.0));
  finalColor = pow(finalColor, vec3(1.0/2.2));
  fragColor = vec4(finalColor, strandAlpha);
}`;
      this.program = this.shaderCompiler.compile(vs, fs);
      this.initialized = true;
    }

    createStrand(startPos, direction, length, segments = 16, thickness = 0.01) {
      const strand = {
        points: [],
        velocities: [],
        thickness,
        color: [...this.hairColor.slice(0, 3)],
        root: [...startPos],
        direction: [...direction],
        length,
        segments
      };
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        strand.points.push([
          startPos[0] + direction[0] * length * t,
          startPos[1] + direction[1] * length * t,
          startPos[2] + direction[2] * length * t
        ]);
        strand.velocities.push([0, 0, 0]);
      }
      this.hairStrands.push(strand);
      return strand;
    }

    createHairPatch(center, normal, count, length, radius = 0.1) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * radius;
        const startPos = [
          center[0] + Math.cos(angle) * r,
          center[1] + Math.sin(angle) * r * 0.5,
          center[2] + Math.sin(angle) * r
        ];
        const dir = [
          normal[0] + (Math.random() - 0.5) * 0.3,
          normal[1] + (Math.random() - 0.5) * 0.3,
          normal[2] + (Math.random() - 0.5) * 0.3
        ];
        const len = length * (0.8 + Math.random() * 0.4);
        this.createStrand(startPos, this._normalize(dir), len, this.segmentsPerStrand, 0.005 + Math.random() * 0.005);
      }
    }

    _normalize(v) {
      const l = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]) || 1;
      return [v[0]/l, v[1]/l, v[2]/l];
    }

    update(dt) {
      if (!this.initialized) return;
      this.time += dt;
      for (const strand of this.hairStrands) {
        strand.points[0] = [...strand.root];
        for (let i = 1; i < strand.points.length; i++) {
          const p = strand.points[i];
          const v = strand.velocities[i];
          const prev = strand.points[i - 1];
          v[0] += this.gravity[0] * dt;
          v[1] += this.gravity[1] * dt;
          v[2] += this.gravity[2] * dt;
          v[0] += this.windDirection[0] * this.windStrength * Math.sin(this.time * 3 + i * 0.5) * dt;
          v[1] += this.windDirection[1] * this.windStrength * Math.sin(this.time * 2 + i * 0.3) * dt;
          v[2] += this.windDirection[2] * this.windStrength * Math.cos(this.time * 2.5 + i * 0.4) * dt;
          v[0] *= this.damping;
          v[1] *= this.damping;
          v[2] *= this.damping;
          p[0] += v[0] * dt * 60;
          p[1] += v[1] * dt * 60;
          p[2] += v[2] * dt * 60;
          const dx = p[0] - prev[0], dy = p[1] - prev[1], dz = p[2] - prev[2];
          const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) || 0.001;
          const restLength = strand.length / strand.segments;
          const diff = (dist - restLength) / dist;
          if (i > 1) {
            p[0] -= dx * diff * this.stiffness * 0.5;
            p[1] -= dy * diff * this.stiffness * 0.5;
            p[2] -= dz * diff * this.stiffness * 0.5;
          }
        }
      }
    }

    render(camera, lights, modelMatrix) {
      if (!this.initialized || this.hairStrands.length === 0) return;
      const gl = this.gl;
      gl.enable(3042);
      gl.blendFunc(770, 771);
      this.shaderCompiler.use(this.program);
      let totalVertices = 0;
      let totalIndices = 0;
      for (const strand of this.hairStrands) {
        totalVertices += (strand.segments + 1) * 2;
        totalIndices += strand.segments * 6;
      }
      const vertices = new Float32Array(totalVertices * 11);
      const indices = new Uint32Array(totalIndices);
      let vIdx = 0, iIdx = 0;
      for (const strand of this.hairStrands) {
        const baseVertex = vIdx / 11;
        for (let i = 0; i <= strand.segments; i++) {
          const t = i / strand.segments;
          const p = strand.points[i];
          const next = strand.points[Math.min(i + 1, strand.segments)];
          const tangent = this._normalize([next[0] - p[0], next[1] - p[1], next[2] - p[2]]);
          const thickness = strand.thickness * (1 - t * 0.5);
          for (let side = -1; side <= 1; side += 2) {
            vertices[vIdx++] = p[0] + tangent[1] * thickness * side;
            vertices[vIdx++] = p[1] - tangent[0] * thickness * side;
            vertices[vIdx++] = p[2];
            vertices[vIdx++] = tangent[0];
            vertices[vIdx++] = tangent[1];
            vertices[vIdx++] = tangent[2];
            vertices[vIdx++] = (side + 1) * 0.5;
            vertices[vIdx++] = t;
            vertices[vIdx++] = strand.color[0];
            vertices[vIdx++] = strand.color[1];
            vertices[vIdx++] = strand.color[2];
          }
        }
        for (let i = 0; i < strand.segments; i++) {
          const a = baseVertex + i * 2;
          indices[iIdx++] = a;
          indices[iIdx++] = a + 1;
          indices[iIdx++] = a + 2;
          indices[iIdx++] = a + 1;
          indices[iIdx++] = a + 3;
          indices[iIdx++] = a + 2;
        }
      }
      if (!this.vertexBuffer) this.vertexBuffer = gl.createBuffer();
      if (!this.indexBuffer) this.indexBuffer = gl.createBuffer();
      gl.bindBuffer(34962, this.vertexBuffer);
      gl.bufferData(34962, vertices, 35048);
      gl.bindBuffer(34963, this.indexBuffer);
      gl.bufferData(34963, indices, 35048);
      const stride = 44;
      const posLoc = this.shaderCompiler.getAttributeLocation(this.program, 'position');
      const tanLoc = this.shaderCompiler.getAttributeLocation(this.program, 'tangent');
      const uvLoc = this.shaderCompiler.getAttributeLocation(this.program, 'uv');
      const colLoc = this.shaderCompiler.getAttributeLocation(this.program, 'color');
      gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 3, 5126, false, stride, 0);
      gl.enableVertexAttribArray(tanLoc); gl.vertexAttribPointer(tanLoc, 3, 5126, false, stride, 12);
      gl.enableVertexAttribArray(uvLoc); gl.vertexAttribPointer(uvLoc, 2, 5126, false, stride, 24);
      gl.enableVertexAttribArray(colLoc); gl.vertexAttribPointer(colLoc, 3, 5126, false, stride, 32);
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'modelMatrix', modelMatrix);
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'viewMatrix', camera.getViewMatrix());
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'projectionMatrix', camera.getProjectionMatrix());
      this.shaderCompiler.setUniform1f(this.program, 'time', this.time);
      this.shaderCompiler.setUniform3f(this.program, 'windDirection', ...this.windDirection);
      this.shaderCompiler.setUniform1f(this.program, 'windStrength', this.windStrength);
      this.shaderCompiler.setUniform3f(this.program, 'hairColor', ...this.hairColor.slice(0, 3));
      this.shaderCompiler.setUniform3f(this.program, 'highlightColor', ...this.highlightColor.slice(0, 3));
      this.shaderCompiler.setUniform3f(this.program, 'lightDirection', ...lights.directionalLight.direction);
      this.shaderCompiler.setUniform3f(this.program, 'lightColor', ...lights.directionalLight.color);
      this.shaderCompiler.setUniform3f(this.program, 'ambientColor', ...lights.ambientLight.color);
      this.shaderCompiler.setUniform1f(this.program, 'ambientIntensity', lights.ambientLight.intensity);
      this.shaderCompiler.setUniform1f(this.program, 'specularPower', this.specularPower);
      this.shaderCompiler.setUniform1f(this.program, 'specularIntensity', this.specularIntensity);
      this.shaderCompiler.setUniform1f(this.program, 'roughness', this.roughness);
      this.shaderCompiler.setUniform1f(this.program, 'alpha', this.alpha);
      this.shaderCompiler.setUniform3f(this.program, 'cameraPosition', ...camera.position);
      gl.drawElements(4, indices.length, 5125, 0);
      this.drawCalls = 1;
      this.triangles = indices.length / 3;
      gl.disable(3042);
    }

    setHairColor(r, g, b, a = 1) { this.hairColor = [r, g, b, a]; }
    setHighlightColor(r, g, b, a = 1) { this.highlightColor = [r, g, b, a]; }
    setWindStrength(v) { this.windStrength = v; }
    setWindDirection(x, y, z) { this.windDirection = [x, y, z]; }
    setGravity(x, y, z) { this.gravity = [x, y, z]; }
    setStiffness(v) { this.stiffness = Math.max(0, Math.min(1, v)); }
    setDamping(v) { this.damping = Math.max(0, Math.min(1, v)); }
    getStrandCount() { return this.hairStrands.length; }
    getStats() { return { drawCalls: this.drawCalls, triangles: this.triangles, strands: this.hairStrands.length }; }
    clear() { this.hairStrands = []; }
    dispose() {
      const gl = this.gl;
      if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
      if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);
      this.hairStrands = [];
      this.initialized = false;
    }
  }

  // ============================================================
  // 布料渲染器 - 质点弹簧系统/碰撞/风
  // ============================================================
  class ClothRenderer {
    constructor(glContext, shaderCompiler) {
      this.gl = glContext.getContext();
      this.shaderCompiler = shaderCompiler;
      this.program = null;
      this.cloths = [];
      this.gravity = [0, -9.8, 0];
      this.wind = [0, 0, 0];
      this.windStrength = 0;
      this.damping = 0.99;
      this.stiffness = 0.9;
      this.iterations = 5;
      this.initialized = false;
      this.time = 0;
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
uniform mat3 normalMatrix;
out vec3 vNormal;
out vec2 vUv;
out vec3 vViewPosition;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vec4 mvPosition = viewMatrix * worldPos;
  vViewPosition = -mvPosition.xyz;
  vNormal = normalize(normalMatrix * normal);
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
uniform float roughness;
uniform float metallic;
out vec4 fragColor;
void main() {
  vec3 albedo = diffuseColor * texture(diffuseMap, vUv).rgb;
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewPosition);
  vec3 L = normalize(-lightDirection);
  vec3 H = normalize(V + L);
  float NdotL = max(dot(N, L), 0.0);
  float NdotH = max(dot(N, H), 0.0);
  vec3 diffuse = albedo * NdotL * lightColor;
  vec3 F0 = mix(vec3(0.04), albedo, metallic);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  float D = pow(NdotH, (1.0 - roughness) * 100.0);
  vec3 specular = F * D * lightColor;
  vec3 ambient = albedo * ambientColor * ambientIntensity;
  vec3 color = ambient + diffuse + specular;
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0/2.2));
  fragColor = vec4(color, 1.0);
}`;
      this.program = this.shaderCompiler.compile(vs, fs);
      this.initialized = true;
    }

    createCloth(width, height, segmentsW, segmentsH, options = {}) {
      const cloth = {
        width, height, segmentsW, segmentsH,
        particles: [],
        constraints: [],
        vertexBuffer: null,
        indexBuffer: null,
        normalBuffer: null,
        color: options.color || [0.8, 0.7, 0.6],
        texture: options.texture || null,
        pinned: options.pinned || [],
        position: options.position || [0, 0, 0],
        rotation: options.rotation || [0, 0, 0],
        modelMatrix: new Float32Array(16),
        thickness: options.thickness || 0.01,
        friction: options.friction || 0.8
      };
      const particleCount = (segmentsW + 1) * (segmentsH + 1);
      for (let y = 0; y <= segmentsH; y++) {
        for (let x = 0; x <= segmentsW; x++) {
          const px = (x / segmentsW - 0.5) * width;
          const py = (y / segmentsH) * height;
          cloth.particles.push({
            position: [px, py, 0],
            prevPosition: [px, py, 0],
            velocity: [0, 0, 0],
            mass: 1,
            pinned: false,
            normal: [0, 0, 1]
          });
        }
      }
      for (const pin of cloth.pinned) {
        const idx = pin.y * (segmentsW + 1) + pin.x;
        if (cloth.particles[idx]) cloth.particles[idx].pinned = true;
      }
      for (let y = 0; y <= segmentsH; y++) {
        for (let x = 0; x <= segmentsW; x++) {
          const idx = y * (segmentsW + 1) + x;
          if (x < segmentsW) {
            cloth.constraints.push({ a: idx, b: idx + 1, rest: width / segmentsW, stiffness: this.stiffness });
          }
          if (y < segmentsH) {
            cloth.constraints.push({ a: idx, b: idx + segmentsW + 1, rest: height / segmentsH, stiffness: this.stiffness });
          }
          if (x < segmentsW && y < segmentsH) {
            cloth.constraints.push({ a: idx, b: idx + segmentsW + 2, rest: Math.sqrt((width/segmentsW)**2 + (height/segmentsH)**2), stiffness: this.stiffness * 0.5 });
            cloth.constraints.push({ a: idx + 1, b: idx + segmentsW + 1, rest: Math.sqrt((width/segmentsW)**2 + (height/segmentsH)**2), stiffness: this.stiffness * 0.5 });
          }
        }
      }
      const indexCount = segmentsW * segmentsH * 6;
      const indices = new Uint32Array(indexCount);
      let iIdx = 0;
      for (let y = 0; y < segmentsH; y++) {
        for (let x = 0; x < segmentsW; x++) {
          const a = y * (segmentsW + 1) + x;
          const b = a + segmentsW + 1;
          indices[iIdx++] = a; indices[iIdx++] = b; indices[iIdx++] = a + 1;
          indices[iIdx++] = a + 1; indices[iIdx++] = b; indices[iIdx++] = b + 1;
        }
      }
      cloth.indexData = indices;
      cloth.vertexData = new Float32Array(particleCount * 3);
      cloth.normalData = new Float32Array(particleCount * 3);
      cloth.uvData = new Float32Array(particleCount * 2);
      for (let y = 0; y <= segmentsH; y++) {
        for (let x = 0; x <= segmentsW; x++) {
          const idx = y * (segmentsW + 1) + x;
          cloth.uvData[idx * 2] = x / segmentsW;
          cloth.uvData[idx * 2 + 1] = y / segmentsH;
        }
      }
      this.cloths.push(cloth);
      return cloth;
    }

    update(dt) {
      if (!this.initialized) return;
      this.time += dt;
      for (const cloth of this.cloths) {
        for (const p of cloth.particles) {
          if (p.pinned) continue;
          p.velocity[0] = (p.position[0] - p.prevPosition[0]) * this.damping;
          p.velocity[1] = (p.position[1] - p.prevPosition[1]) * this.damping;
          p.velocity[2] = (p.position[2] - p.prevPosition[2]) * this.damping;
          p.prevPosition = [...p.position];
          const windFactor = 0.5 + Math.sin(this.time * 2 + p.position[0] * 3) * 0.5;
          p.position[0] += (p.velocity[0] + this.gravity[0] * dt + this.wind[0] * this.windStrength * windFactor) * dt * 60;
          p.position[1] += (p.velocity[1] + this.gravity[1] * dt + this.wind[1] * this.windStrength * windFactor) * dt * 60;
          p.position[2] += (p.velocity[2] + this.gravity[2] * dt + this.wind[2] * this.windStrength * windFactor) * dt * 60;
        }
        for (let iter = 0; iter < this.iterations; iter++) {
          for (const c of cloth.constraints) {
            const pa = cloth.particles[c.a];
            const pb = cloth.particles[c.b];
            const dx = pb.position[0] - pa.position[0];
            const dy = pb.position[1] - pa.position[1];
            const dz = pb.position[2] - pa.position[2];
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) || 0.001;
            const diff = (dist - c.rest) / dist * c.stiffness;
            if (!pa.pinned) {
              pa.position[0] += dx * diff * 0.5;
              pa.position[1] += dy * diff * 0.5;
              pa.position[2] += dz * diff * 0.5;
            }
            if (!pb.pinned) {
              pb.position[0] -= dx * diff * 0.5;
              pb.position[1] -= dy * diff * 0.5;
              pb.position[2] -= dz * diff * 0.5;
            }
          }
        }
        for (let i = 0; i < cloth.particles.length; i++) {
          cloth.vertexData[i * 3] = cloth.particles[i].position[0];
          cloth.vertexData[i * 3 + 1] = cloth.particles[i].position[1];
          cloth.vertexData[i * 3 + 2] = cloth.particles[i].position[2];
        }
        this._computeNormals(cloth);
        this._updateModelMatrix(cloth);
      }
    }

    _computeNormals(cloth) {
      const { segmentsW, segmentsH } = cloth;
      for (let i = 0; i < cloth.particles.length; i++) {
        cloth.normalData[i * 3] = 0;
        cloth.normalData[i * 3 + 1] = 0;
        cloth.normalData[i * 3 + 2] = 0;
      }
      for (let y = 0; y < segmentsH; y++) {
        for (let x = 0; x < segmentsW; x++) {
          const a = y * (segmentsW + 1) + x;
          const b = a + segmentsW + 1;
          const c = a + 1;
          const pa = cloth.particles[a].position;
          const pb = cloth.particles[b].position;
          const pc = cloth.particles[c].position;
          const e1 = [pb[0]-pa[0], pb[1]-pa[1], pb[2]-pa[2]];
          const e2 = [pc[0]-pa[0], pc[1]-pa[1], pc[2]-pa[2]];
          const n = [e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
          for (const idx of [a, b, c]) {
            cloth.normalData[idx*3] += n[0];
            cloth.normalData[idx*3+1] += n[1];
            cloth.normalData[idx*3+2] += n[2];
          }
        }
      }
      for (let i = 0; i < cloth.particles.length; i++) {
        const l = Math.sqrt(cloth.normalData[i*3]**2 + cloth.normalData[i*3+1]**2 + cloth.normalData[i*3+2]**2) || 1;
        cloth.normalData[i*3] /= l;
        cloth.normalData[i*3+1] /= l;
        cloth.normalData[i*3+2] /= l;
      }
    }

    _updateModelMatrix(cloth) {
      const m = cloth.modelMatrix;
      const cx = Math.cos(cloth.rotation[0]), sx = Math.sin(cloth.rotation[0]);
      const cy = Math.cos(cloth.rotation[1]), sy = Math.sin(cloth.rotation[1]);
      const cz = Math.cos(cloth.rotation[2]), sz = Math.sin(cloth.rotation[2]);
      m[0] = cy*cz; m[1] = cy*sz; m[2] = -sy; m[3] = 0;
      m[4] = sx*sy*cz - cx*sz; m[5] = sx*sy*sz + cx*cz; m[6] = sx*cy; m[7] = 0;
      m[8] = cx*sy*cz + sx*sz; m[9] = cx*sy*sz - sx*cz; m[10] = cx*cy; m[11] = 0;
      m[12] = cloth.position[0]; m[13] = cloth.position[1]; m[14] = cloth.position[2]; m[15] = 1;
    }

    render(camera, lights) {
      if (!this.initialized) return;
      const gl = this.gl;
      for (const cloth of this.cloths) {
        this.shaderCompiler.use(this.program);
        if (!cloth.vertexBuffer) cloth.vertexBuffer = gl.createBuffer();
        if (!cloth.normalBuffer) cloth.normalBuffer = gl.createBuffer();
        if (!cloth.indexBuffer) cloth.indexBuffer = gl.createBuffer();
        gl.bindBuffer(34962, cloth.vertexBuffer);
        gl.bufferData(34962, cloth.vertexData, 35048);
        gl.bindBuffer(34962, cloth.normalBuffer);
        gl.bufferData(34962, cloth.normalData, 35048);
        gl.bindBuffer(34963, cloth.indexBuffer);
        gl.bufferData(34963, cloth.indexData, 35044);
        const posLoc = this.shaderCompiler.getAttributeLocation(this.program, 'position');
        const normLoc = this.shaderCompiler.getAttributeLocation(this.program, 'normal');
        const uvLoc = this.shaderCompiler.getAttributeLocation(this.program, 'uv');
        gl.bindBuffer(34962, cloth.vertexBuffer);
        gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 3, 5126, false, 0, 0);
        gl.bindBuffer(34962, cloth.normalBuffer);
        gl.enableVertexAttribArray(normLoc); gl.vertexAttribPointer(normLoc, 3, 5126, false, 0, 0);
        gl.enableVertexAttribArray(uvLoc);
        gl.vertexAttribPointer(uvLoc, 2, 5126, false, 0, 0);
        this.shaderCompiler.setUniformMatrix4fv(this.program, 'modelMatrix', cloth.modelMatrix);
        this.shaderCompiler.setUniformMatrix4fv(this.program, 'viewMatrix', camera.getViewMatrix());
        this.shaderCompiler.setUniformMatrix4fv(this.program, 'projectionMatrix', camera.getProjectionMatrix());
        const normalMatrix = new Float32Array(9);
        normalMatrix[0] = cloth.modelMatrix[0]; normalMatrix[1] = cloth.modelMatrix[1]; normalMatrix[2] = cloth.modelMatrix[2];
        normalMatrix[3] = cloth.modelMatrix[4]; normalMatrix[4] = cloth.modelMatrix[5]; normalMatrix[5] = cloth.modelMatrix[6];
        normalMatrix[6] = cloth.modelMatrix[8]; normalMatrix[7] = cloth.modelMatrix[9]; normalMatrix[8] = cloth.modelMatrix[10];
        this.shaderCompiler.setUniformMatrix3fv(this.program, 'normalMatrix', normalMatrix);
        this.shaderCompiler.setUniform3f(this.program, 'diffuseColor', ...cloth.color);
        this.shaderCompiler.setUniform3f(this.program, 'lightDirection', ...lights.directionalLight.direction);
        this.shaderCompiler.setUniform3f(this.program, 'lightColor', ...lights.directionalLight.color);
        this.shaderCompiler.setUniform3f(this.program, 'ambientColor', ...lights.ambientLight.color);
        this.shaderCompiler.setUniform1f(this.program, 'ambientIntensity', lights.ambientLight.intensity);
        this.shaderCompiler.setUniform1f(this.program, 'roughness', 0.7);
        this.shaderCompiler.setUniform1f(this.program, 'metallic', 0.0);
        gl.drawElements(4, cloth.indexData.length, 5125, 0);
      }
    }

    setGravity(x, y, z) { this.gravity = [x, y, z]; }
    setWind(x, y, z) { this.wind = [x, y, z]; }
    setWindStrength(v) { this.windStrength = v; }
    setDamping(v) { this.damping = Math.max(0, Math.min(1, v)); }
    setStiffness(v) { this.stiffness = Math.max(0, Math.min(1, v)); }
    setIterations(n) { this.iterations = Math.max(1, n); }
    getClothCount() { return this.cloths.length; }
    removeCloth(cloth) {
      const idx = this.cloths.indexOf(cloth);
      if (idx !== -1) this.cloths.splice(idx, 1);
    }
    clear() { this.cloths = []; }
    dispose() {
      for (const cloth of this.cloths) {
        const gl = this.gl;
        if (cloth.vertexBuffer) gl.deleteBuffer(cloth.vertexBuffer);
        if (cloth.normalBuffer) gl.deleteBuffer(cloth.normalBuffer);
        if (cloth.indexBuffer) gl.deleteBuffer(cloth.indexBuffer);
      }
      this.cloths = [];
      this.initialized = false;
    }
  }

  // ============================================================
  // 眼睛渲染器 - 虹膜/瞳孔/高光/反射
  // ============================================================
  class EyeRenderer {
    constructor(glContext, shaderCompiler) {
      this.gl = glContext.getContext();
      this.shaderCompiler = shaderCompiler;
      this.program = null;
      this.leftEye = null;
      this.rightEye = null;
      this.irisColor = [0.3, 0.5, 0.8];
      this.pupilSize = 0.3;
      this.highlightIntensity = 1.0;
      this.reflectionIntensity = 0.5;
      this.eyeRotation = [0, 0];
      this.blinkWeight = 0;
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
uniform vec2 eyeRotation;
out vec3 vNormal;
out vec2 vUv;
out vec3 vViewPosition;
out vec3 vWorldPosition;
void main() {
  vec3 pos = position;
  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPosition = worldPos.xyz;
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
in vec3 vWorldPosition;
uniform vec3 irisColor;
uniform float pupilSize;
uniform float highlightIntensity;
uniform float reflectionIntensity;
uniform float blinkWeight;
uniform vec3 lightDirection;
uniform vec3 lightColor;
uniform vec3 ambientColor;
uniform float ambientIntensity;
uniform vec3 cameraPosition;
uniform vec3 scleraColor;
out vec4 fragColor;
void main() {
  vec2 center = vUv - 0.5;
  float dist = length(center);
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewPosition);
  vec3 L = normalize(-lightDirection);
  vec3 H = normalize(V + L);
  float NdotL = max(dot(N, L), 0.0);
  float NdotH = max(dot(N, H), 0.0);
  float NdotV = max(dot(N, V), 0.0);
  vec3 color;
  float irisRadius = 0.35;
  float pupilRadius = irisRadius * pupilSize;
  if (dist < pupilRadius) {
    color = vec3(0.02, 0.01, 0.01);
  } else if (dist < irisRadius) {
    float irisFactor = (dist - pupilRadius) / (irisRadius - pupilRadius);
    vec3 irisInner = irisColor * 0.5;
    vec3 irisOuter = irisColor * 1.2;
    color = mix(irisInner, irisOuter, irisFactor);
    float radial = sin(irisFactor * 40.0) * 0.1 + 0.9;
    color *= radial;
    float limbal = smoothstep(irisRadius * 0.8, irisRadius, dist);
    color = mix(color, color * 0.3, limbal * 0.5);
  } else {
    color = scleraColor;
    float veinFactor = smoothstep(irisRadius * 1.2, 0.5, dist) * 0.1;
    color += vec3(veinFactor, 0, 0);
  }
  vec3 diffuse = color * NdotL * lightColor;
  vec3 ambient = color * ambientColor * ambientIntensity;
  float specular = pow(NdotH, 100.0) * highlightIntensity;
  vec3 reflection = vec3(0.8, 0.9, 1.0) * pow(1.0 - NdotV, 3.0) * reflectionIntensity;
  vec3 finalColor = ambient + diffuse + specular * lightColor + reflection;
  float upperLid = smoothstep(0.5 - blinkWeight * 0.4, 0.5, vUv.y);
  float lowerLid = smoothstep(0.5 + blinkWeight * 0.4, 0.5, vUv.y);
  float lidFactor = min(upperLid, lowerLid);
  finalColor = mix(vec3(0.1, 0.05, 0.05), finalColor, lidFactor);
  finalColor = finalColor / (finalColor + vec3(1.0));
  finalColor = pow(finalColor, vec3(1.0/2.2));
  fragColor = vec4(finalColor, 1.0);
}`;
      this.program = this.shaderCompiler.compile(vs, fs);
      this.initialized = true;
    }

    createEye(side = 'left') {
      const eye = {
        side,
        position: side === 'left' ? [-0.15, 0.05, 0.1] : [0.15, 0.05, 0.1],
        rotation: [0, 0, 0],
        scale: [0.12, 0.12, 0.08],
        modelMatrix: new Float32Array(16),
        vertexBuffer: null,
        indexBuffer: null,
        normalBuffer: null,
        uvBuffer: null
      };
      this._createEyeGeometry(eye);
      if (side === 'left') this.leftEye = eye;
      else this.rightEye = eye;
      return eye;
    }

    _createEyeGeometry(eye) {
      const segments = 32;
      const rings = 16;
      const vertices = [];
      const normals = [];
      const uvs = [];
      const indices = [];
      for (let r = 0; r <= rings; r++) {
        const phi = (r / rings) * Math.PI * 0.5;
        for (let s = 0; s <= segments; s++) {
          const theta = (s / segments) * Math.PI * 2;
          const x = Math.sin(phi) * Math.cos(theta);
          const y = Math.sin(phi) * Math.sin(theta);
          const z = Math.cos(phi);
          vertices.push(x * eye.scale[0], y * eye.scale[1], z * eye.scale[2]);
          normals.push(x, y, z);
          uvs.push(s / segments, r / rings);
        }
      }
      for (let r = 0; r < rings; r++) {
        for (let s = 0; s < segments; s++) {
          const a = r * (segments + 1) + s;
          const b = a + segments + 1;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
      eye.vertexData = new Float32Array(vertices);
      eye.normalData = new Float32Array(normals);
      eye.uvData = new Float32Array(uvs);
      eye.indexData = new Uint32Array(indices);
    }

    update(dt) {
      if (!this.initialized) return;
      for (const eye of [this.leftEye, this.rightEye]) {
        if (!eye) continue;
        eye.rotation[0] = this.eyeRotation[1];
        eye.rotation[1] = this.eyeRotation[0];
        this._updateModelMatrix(eye);
      }
    }

    _updateModelMatrix(eye) {
      const m = eye.modelMatrix;
      const cx = Math.cos(eye.rotation[0]), sx = Math.sin(eye.rotation[0]);
      const cy = Math.cos(eye.rotation[1]), sy = Math.sin(eye.rotation[1]);
      m[0] = cy; m[1] = 0; m[2] = -sy; m[3] = 0;
      m[4] = sx*sy; m[5] = cx; m[6] = sx*cy; m[7] = 0;
      m[8] = cx*sy; m[9] = -sx; m[10] = cx*cy; m[11] = 0;
      m[12] = eye.position[0]; m[13] = eye.position[1]; m[14] = eye.position[2]; m[15] = 1;
    }

    render(camera, lights) {
      if (!this.initialized) return;
      const gl = this.gl;
      for (const eye of [this.leftEye, this.rightEye]) {
        if (!eye) continue;
        this.shaderCompiler.use(this.program);
        if (!eye.vertexBuffer) {
          eye.vertexBuffer = gl.createBuffer();
          eye.normalBuffer = gl.createBuffer();
          eye.uvBuffer = gl.createBuffer();
          eye.indexBuffer = gl.createBuffer();
        }
        gl.bindBuffer(34962, eye.vertexBuffer);
        gl.bufferData(34962, eye.vertexData, 35044);
        gl.bindBuffer(34962, eye.normalBuffer);
        gl.bufferData(34962, eye.normalData, 35044);
        gl.bindBuffer(34962, eye.uvBuffer);
        gl.bufferData(34962, eye.uvData, 35044);
        gl.bindBuffer(34963, eye.indexBuffer);
        gl.bufferData(34963, eye.indexData, 35044);
        const posLoc = this.shaderCompiler.getAttributeLocation(this.program, 'position');
        const normLoc = this.shaderCompiler.getAttributeLocation(this.program, 'normal');
        const uvLoc = this.shaderCompiler.getAttributeLocation(this.program, 'uv');
        gl.bindBuffer(34962, eye.vertexBuffer);
        gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 3, 5126, false, 0, 0);
        gl.bindBuffer(34962, eye.normalBuffer);
        gl.enableVertexAttribArray(normLoc); gl.vertexAttribPointer(normLoc, 3, 5126, false, 0, 0);
        gl.bindBuffer(34962, eye.uvBuffer);
        gl.enableVertexAttribArray(uvLoc); gl.vertexAttribPointer(uvLoc, 2, 5126, false, 0, 0);
        this.shaderCompiler.setUniformMatrix4fv(this.program, 'modelMatrix', eye.modelMatrix);
        this.shaderCompiler.setUniformMatrix4fv(this.program, 'viewMatrix', camera.getViewMatrix());
        this.shaderCompiler.setUniformMatrix4fv(this.program, 'projectionMatrix', camera.getProjectionMatrix());
        this.shaderCompiler.setUniform2f(this.program, 'eyeRotation', this.eyeRotation[0], this.eyeRotation[1]);
        this.shaderCompiler.setUniform3f(this.program, 'irisColor', ...this.irisColor);
        this.shaderCompiler.setUniform1f(this.program, 'pupilSize', this.pupilSize);
        this.shaderCompiler.setUniform1f(this.program, 'highlightIntensity', this.highlightIntensity);
        this.shaderCompiler.setUniform1f(this.program, 'reflectionIntensity', this.reflectionIntensity);
        this.shaderCompiler.setUniform1f(this.program, 'blinkWeight', this.blinkWeight);
        this.shaderCompiler.setUniform3f(this.program, 'lightDirection', ...lights.directionalLight.direction);
        this.shaderCompiler.setUniform3f(this.program, 'lightColor', ...lights.directionalLight.color);
        this.shaderCompiler.setUniform3f(this.program, 'ambientColor', ...lights.ambientLight.color);
        this.shaderCompiler.setUniform1f(this.program, 'ambientIntensity', lights.ambientLight.intensity);
        this.shaderCompiler.setUniform3f(this.program, 'cameraPosition', ...camera.position);
        this.shaderCompiler.setUniform3f(this.program, 'scleraColor', 0.95, 0.93, 0.9);
        gl.drawElements(4, eye.indexData.length, 5125, 0);
      }
    }

    setIrisColor(r, g, b) { this.irisColor = [r, g, b]; }
    setPupilSize(v) { this.pupilSize = Math.max(0.1, Math.min(0.8, v)); }
    setEyeRotation(x, y) { this.eyeRotation = [x, y]; }
    setBlinkWeight(v) { this.blinkWeight = Math.max(0, Math.min(1, v)); }
    setHighlightIntensity(v) { this.highlightIntensity = v; }
    setReflectionIntensity(v) { this.reflectionIntensity = v; }
    lookAt(target, headPosition) {
      const dx = target[0] - headPosition[0];
      const dy = target[1] - headPosition[1];
      const dz = target[2] - headPosition[2];
      this.eyeRotation[0] = Math.atan2(dx, dz);
      this.eyeRotation[1] = Math.atan2(dy, Math.sqrt(dx*dx + dz*dz));
    }
    dispose() {
      const gl = this.gl;
      for (const eye of [this.leftEye, this.rightEye]) {
        if (eye) {
          if (eye.vertexBuffer) gl.deleteBuffer(eye.vertexBuffer);
          if (eye.normalBuffer) gl.deleteBuffer(eye.normalBuffer);
          if (eye.uvBuffer) gl.deleteBuffer(eye.uvBuffer);
          if (eye.indexBuffer) gl.deleteBuffer(eye.indexBuffer);
        }
      }
      this.leftEye = null;
      this.rightEye = null;
      this.initialized = false;
    }
  }

  // ============================================================
  // 次表面散射渲染器
  // ============================================================
  class SSSRenderer {
    constructor(glContext, shaderCompiler) {
      this.gl = glContext.getContext();
      this.shaderCompiler = shaderCompiler;
      this.program = null;
      this.intensity = 0.8;
      this.radius = [0.002, 0.010, 0.030];
      this.color = [1.0, 0.6, 0.4];
      this.thicknessScale = 1.0;
      this.distortion = 0.4;
      this.power = 2.0;
      this.scale = 1.0;
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
uniform mat3 normalMatrix;
out vec3 vNormal;
out vec2 vUv;
out vec3 vViewPosition;
out vec3 vWorldPosition;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  vec4 mvPosition = viewMatrix * worldPos;
  vViewPosition = -mvPosition.xyz;
  vNormal = normalize(normalMatrix * normal);
  vUv = uv;
  gl_Position = projectionMatrix * mvPosition;
}`;
      const fs = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec2 vUv;
in vec3 vViewPosition;
in vec3 vWorldPosition;
uniform vec3 diffuseColor;
uniform vec3 lightDirection;
uniform vec3 lightColor;
uniform vec3 ambientColor;
uniform float ambientIntensity;
uniform sampler2D diffuseMap;
uniform sampler2D thicknessMap;
uniform sampler2D curvatureMap;
uniform float sssIntensity;
uniform vec3 sssRadius;
uniform vec3 sssColor;
uniform float sssDistortion;
uniform float sssPower;
uniform float sssScale;
uniform float thicknessScale;
uniform vec3 cameraPosition;
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
float geometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
  float NdotV = max(dot(N, V), 0.0);
  float NdotL = max(dot(N, L), 0.0);
  float r = roughness + 1.0;
  float k = (r * r) / 8.0;
  float ggxV = NdotV / (NdotV * (1.0 - k) + k);
  float ggxL = NdotL / (NdotL * (1.0 - k) + k);
  return ggxV * ggxL;
}
void main() {
  vec3 albedo = diffuseColor * texture(diffuseMap, vUv).rgb;
  float thickness = texture(thicknessMap, vUv).r * thicknessScale;
  float curvature = texture(curvatureMap, vUv).r;
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewPosition);
  vec3 L = normalize(-lightDirection);
  vec3 H = normalize(V + L);
  float NdotL = max(dot(N, L), 0.0);
  float NdotV = max(dot(N, V), 0.0);
  float roughness = 0.5 + curvature * 0.3;
  vec3 F0 = vec3(0.04);
  vec3 F = fresnelSchlick(NdotV, F0);
  float D = distributionGGX(N, H, roughness);
  float G = geometrySmith(N, V, L, roughness);
  vec3 specular = (D * G * F) / (4.0 * NdotV * NdotL + 0.001);
  vec3 kS = F;
  vec3 kD = (1.0 - kS);
  vec3 diffuse = kD * albedo / 3.14159265;
  vec3 distortedN = normalize(N + L * sssDistortion);
  float wrap = max(dot(distortedN, V), 0.0);
  float sssFactor = pow(wrap, sssPower) * sssIntensity;
  vec3 attenuation = exp(-thickness * sssScale / max(sssRadius, vec3(0.001)));
  vec3 subsurface = sssColor * albedo * sssFactor * (1.0 - attenuation) * NdotL;
  vec3 Lo = (diffuse + specular) * lightColor * NdotL;
  Lo += subsurface * lightColor;
  vec3 ambient = albedo * ambientColor * ambientIntensity;
  vec3 color = ambient + Lo;
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0/2.2));
  fragColor = vec4(color, 1.0);
}`;
      this.program = this.shaderCompiler.compile(vs, fs);
      this.initialized = true;
    }

    render(mesh, modelMatrix, camera, lights) {
      if (!this.initialized) return;
      const gl = this.gl;
      this.shaderCompiler.use(this.program);
      gl.bindBuffer(34962, mesh.vertexBuffer);
      gl.bindBuffer(34963, mesh.indexBuffer);
      const stride = (3 + 3 + 2) * 4;
      const posLoc = this.shaderCompiler.getAttributeLocation(this.program, 'position');
      const normLoc = this.shaderCompiler.getAttributeLocation(this.program, 'normal');
      const uvLoc = this.shaderCompiler.getAttributeLocation(this.program, 'uv');
      gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 3, 5126, false, stride, 0);
      gl.enableVertexAttribArray(normLoc); gl.vertexAttribPointer(normLoc, 3, 5126, false, stride, 12);
      gl.enableVertexAttribArray(uvLoc); gl.vertexAttribPointer(uvLoc, 2, 5126, false, stride, 24);
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'modelMatrix', modelMatrix);
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'viewMatrix', camera.getViewMatrix());
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'projectionMatrix', camera.getProjectionMatrix());
      const normalMatrix = new Float32Array(9);
      normalMatrix[0] = modelMatrix[0]; normalMatrix[1] = modelMatrix[1]; normalMatrix[2] = modelMatrix[2];
      normalMatrix[3] = modelMatrix[4]; normalMatrix[4] = modelMatrix[5]; normalMatrix[5] = modelMatrix[6];
      normalMatrix[6] = modelMatrix[8]; normalMatrix[7] = modelMatrix[9]; normalMatrix[8] = modelMatrix[10];
      this.shaderCompiler.setUniformMatrix3fv(this.program, 'normalMatrix', normalMatrix);
      this.shaderCompiler.setUniform3f(this.program, 'diffuseColor', ...mesh.color);
      this.shaderCompiler.setUniform3f(this.program, 'lightDirection', ...lights.directionalLight.direction);
      this.shaderCompiler.setUniform3f(this.program, 'lightColor', ...lights.directionalLight.color);
      this.shaderCompiler.setUniform3f(this.program, 'ambientColor', ...lights.ambientLight.color);
      this.shaderCompiler.setUniform1f(this.program, 'ambientIntensity', lights.ambientLight.intensity);
      this.shaderCompiler.setUniform1f(this.program, 'sssIntensity', this.intensity);
      this.shaderCompiler.setUniform3f(this.program, 'sssRadius', ...this.radius);
      this.shaderCompiler.setUniform3f(this.program, 'sssColor', ...this.color);
      this.shaderCompiler.setUniform1f(this.program, 'sssDistortion', this.distortion);
      this.shaderCompiler.setUniform1f(this.program, 'sssPower', this.power);
      this.shaderCompiler.setUniform1f(this.program, 'sssScale', this.scale);
      this.shaderCompiler.setUniform1f(this.program, 'thicknessScale', this.thicknessScale);
      this.shaderCompiler.setUniform3f(this.program, 'cameraPosition', ...camera.position);
      gl.drawElements(4, mesh.indexCount, 5125, 0);
    }

    setIntensity(v) { this.intensity = Math.max(0, v); }
    setRadius(r, g, b) { this.radius = [r, g, b]; }
    setColor(r, g, b) { this.color = [r, g, b]; }
    setDistortion(v) { this.distortion = v; }
    setPower(v) { this.power = v; }
    setScale(v) { this.scale = v; }
    setThicknessScale(v) { this.thicknessScale = v; }
    dispose() { this.initialized = false; }
  }

  // ============================================================
  // PBR渲染器
  // ============================================================
  class PBRRenderer {
    constructor(glContext, shaderCompiler) {
      this.gl = glContext.getContext();
      this.shaderCompiler = shaderCompiler;
      this.program = null;
      this.initialized = false;
      this.envMapIntensity = 1.0;
      this.toneMapping = 'ACES';
      this.exposure = 1.0;
    }

    init() {
      const vs = `#version 300 es
precision highp float;
in vec3 position;
in vec3 normal;
in vec2 uv;
in vec3 tangent;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
out vec3 vNormal;
out vec2 vUv;
out vec3 vViewPosition;
out vec3 vWorldPosition;
out vec3 vTangent;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  vec4 mvPosition = viewMatrix * worldPos;
  vViewPosition = -mvPosition.xyz;
  vNormal = normalize(normalMatrix * normal);
  vTangent = normalize(normalMatrix * tangent);
  vUv = uv;
  gl_Position = projectionMatrix * mvPosition;
}`;
      const fs = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec2 vUv;
in vec3 vViewPosition;
in vec3 vWorldPosition;
in vec3 vTangent;
uniform vec3 albedoColor;
uniform float metallic;
uniform float roughness;
uniform float aoIntensity;
uniform vec3 emissiveColor;
uniform float emissiveIntensity;
uniform vec3 lightDirection;
uniform vec3 lightColor;
uniform vec3 ambientColor;
uniform float ambientIntensity;
uniform sampler2D albedoMap;
uniform sampler2D normalMap;
uniform sampler2D metallicMap;
uniform sampler2D roughnessMap;
uniform sampler2D aoMap;
uniform sampler2D emissiveMap;
uniform float normalStrength;
uniform float envMapIntensity;
uniform float exposure;
uniform vec3 cameraPosition;
out vec4 fragColor;
const float PI = 3.14159265359;
vec3 fresnelSchlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
vec3 fresnelSchlickRoughness(float cosTheta, vec3 F0, float roughness) {
  return F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
float distributionGGX(vec3 N, vec3 H, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float NdotH = max(dot(N, H), 0.0);
  float NdotH2 = NdotH * NdotH;
  float denom = (NdotH2 * (a2 - 1.0) + 1.0);
  denom = PI * denom * denom;
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
vec3 getNormalFromMap() {
  vec3 tangentNormal = texture(normalMap, vUv).xyz * 2.0 - 1.0;
  vec3 N = normalize(vNormal);
  vec3 T = normalize(vTangent);
  T = normalize(T - dot(T, N) * N);
  vec3 B = cross(N, T);
  mat3 TBN = mat3(T, B, N);
  return normalize(TBN * tangentNormal);
}
void main() {
  vec3 albedo = albedoColor * texture(albedoMap, vUv).rgb;
  float metal = metallic * texture(metallicMap, vUv).r;
  float rough = max(0.04, roughness * texture(roughnessMap, vUv).r);
  float ao = texture(aoMap, vUv).r;
  vec3 emissive = emissiveColor * emissiveIntensity * texture(emissiveMap, vUv).rgb;
  vec3 N = getNormalFromMap();
  vec3 V = normalize(vViewPosition);
  vec3 F0 = vec3(0.04);
  F0 = mix(F0, albedo, metal);
  vec3 Lo = vec3(0.0);
  vec3 L = normalize(-lightDirection);
  vec3 H = normalize(V + L);
  float NDF = distributionGGX(N, H, rough);
  float G = geometrySmith(N, V, L, rough);
  vec3 F = fresnelSchlick(max(dot(H, V), 0.0), F0);
  vec3 numerator = NDF * G * F;
  float denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001;
  vec3 specular = numerator / denominator;
  vec3 kS = F;
  vec3 kD = (vec3(1.0) - kS) * (1.0 - metal);
  float NdotL = max(dot(N, L), 0.0);
  Lo += (kD * albedo / PI + specular) * lightColor * NdotL;
  vec3 F_ambient = fresnelSchlickRoughness(max(dot(N, V), 0.0), F0, rough);
  vec3 kS_ambient = F_ambient;
  vec3 kD_ambient = (1.0 - kS_ambient) * (1.0 - metal);
  vec3 irradiance = ambientColor * ambientIntensity;
  vec3 diffuseAmbient = irradiance * albedo;
  vec3 ambientColorFinal = (kD_ambient * diffuseAmbient) * ao * aoIntensity;
  vec3 color = ambientColorFinal + Lo + emissive;
  color *= exposure;
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0/2.2));
  fragColor = vec4(color, 1.0);
}`;
      this.program = this.shaderCompiler.compile(vs, fs);
      this.initialized = true;
    }

    render(mesh, modelMatrix, camera, lights) {
      if (!this.initialized) return;
      const gl = this.gl;
      this.shaderCompiler.use(this.program);
      gl.bindBuffer(34962, mesh.vertexBuffer);
      gl.bindBuffer(34963, mesh.indexBuffer);
      const stride = (3 + 3 + 2 + 3) * 4;
      const posLoc = this.shaderCompiler.getAttributeLocation(this.program, 'position');
      const normLoc = this.shaderCompiler.getAttributeLocation(this.program, 'normal');
      const uvLoc = this.shaderCompiler.getAttributeLocation(this.program, 'uv');
      const tanLoc = this.shaderCompiler.getAttributeLocation(this.program, 'tangent');
      gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 3, 5126, false, stride, 0);
      gl.enableVertexAttribArray(normLoc); gl.vertexAttribPointer(normLoc, 3, 5126, false, stride, 12);
      gl.enableVertexAttribArray(uvLoc); gl.vertexAttribPointer(uvLoc, 2, 5126, false, stride, 24);
      gl.enableVertexAttribArray(tanLoc); gl.vertexAttribPointer(tanLoc, 3, 5126, false, stride, 32);
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'modelMatrix', modelMatrix);
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'viewMatrix', camera.getViewMatrix());
      this.shaderCompiler.setUniformMatrix4fv(this.program, 'projectionMatrix', camera.getProjectionMatrix());
      const normalMatrix = new Float32Array(9);
      normalMatrix[0] = modelMatrix[0]; normalMatrix[1] = modelMatrix[1]; normalMatrix[2] = modelMatrix[2];
      normalMatrix[3] = modelMatrix[4]; normalMatrix[4] = modelMatrix[5]; normalMatrix[5] = modelMatrix[6];
      normalMatrix[6] = modelMatrix[8]; normalMatrix[7] = modelMatrix[9]; normalMatrix[8] = modelMatrix[10];
      this.shaderCompiler.setUniformMatrix3fv(this.program, 'normalMatrix', normalMatrix);
      this.shaderCompiler.setUniform3f(this.program, 'albedoColor', ...mesh.albedo || [1,1,1]);
      this.shaderCompiler.setUniform1f(this.program, 'metallic', mesh.metallic || 0);
      this.shaderCompiler.setUniform1f(this.program, 'roughness', mesh.roughness || 0.5);
      this.shaderCompiler.setUniform1f(this.program, 'aoIntensity', mesh.aoIntensity || 1);
      this.shaderCompiler.setUniform3f(this.program, 'emissiveColor', ...mesh.emissive || [0,0,0]);
      this.shaderCompiler.setUniform1f(this.program, 'emissiveIntensity', mesh.emissiveIntensity || 0);
      this.shaderCompiler.setUniform3f(this.program, 'lightDirection', ...lights.directionalLight.direction);
      this.shaderCompiler.setUniform3f(this.program, 'lightColor', ...lights.directionalLight.color);
      this.shaderCompiler.setUniform3f(this.program, 'ambientColor', ...lights.ambientLight.color);
      this.shaderCompiler.setUniform1f(this.program, 'ambientIntensity', lights.ambientLight.intensity);
      this.shaderCompiler.setUniform1f(this.program, 'normalStrength', mesh.normalStrength || 1);
      this.shaderCompiler.setUniform1f(this.program, 'envMapIntensity', this.envMapIntensity);
      this.shaderCompiler.setUniform1f(this.program, 'exposure', this.exposure);
      this.shaderCompiler.setUniform3f(this.program, 'cameraPosition', ...camera.position);
      gl.drawElements(4, mesh.indexCount, 5125, 0);
    }

    setEnvMapIntensity(v) { this.envMapIntensity = v; }
    setExposure(v) { this.exposure = v; }
    setToneMapping(mode) { this.toneMapping = mode; }
    dispose() { this.initialized = false; }
  }

  return {
    HairRenderer, ClothRenderer, EyeRenderer, SSSRenderer, PBRRenderer
  };
})();

if (typeof window !== 'undefined') window.SpiritRendererExt = SpiritRendererExt;
if (typeof globalThis !== 'undefined') globalThis.SpiritRendererExt = SpiritRendererExt;
