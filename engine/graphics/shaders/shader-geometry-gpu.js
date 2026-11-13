/**
 * WebGL核心 - 着色器管理/几何处理/GPU工具/管线状态/顶点数组对象
 * 纯WebGL2，零第三方依赖
 * @version 6.0.0
 */
'use strict';

const WebGLCoreV6 = (function () {

  class ShaderManager {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.programs = new Map();
      this.shaders = new Map();
      this.uniformCache = new Map();
      this.attributeCache = new Map();
      this.currentProgram = null;
      this.includeSources = new Map();
      this.defines = new Map();
      this.stats = { compiled: 0, failed: 0, cached: 0 };
    }

    addInclude(name, source) {
      this.includeSources.set(name, source);
    }

    addDefine(name, value = '') {
      this.defines.set(name, value);
    }

    removeDefine(name) {
      this.defines.delete(name);
    }

    compile(vertexSource, fragmentSource, name = '') {
      const cacheKey = this._hashString(vertexSource + fragmentSource + JSON.stringify(Object.fromEntries(this.defines)));
      if (this.programs.has(cacheKey)) {
        this.stats.cached++;
        return this.programs.get(cacheKey);
      }
      const processedVS = this._processSource(vertexSource, 'vertex');
      const processedFS = this._processSource(fragmentSource, 'fragment');
      const vs = this._compileShader(35633, processedVS);
      const fs = this._compileShader(35632, processedFS);
      if (!vs || !fs) {
        this.stats.failed++;
        return null;
      }
      const program = this.gl.createProgram();
      this.gl.attachShader(program, vs);
      this.gl.attachShader(program, fs);
      this.gl.linkProgram(program);
      if (!this.gl.getProgramParameter(program, 35714)) {
        const error = this.gl.getProgramInfoLog(program);
        console.error('Program link error:', error);
        this.gl.deleteProgram(program);
        this.stats.failed++;
        return null;
      }
      this.gl.deleteShader(vs);
      this.gl.deleteShader(fs);
      const programInfo = {
        program,
        name,
        uniforms: new Map(),
        attributes: new Map(),
        cacheKey
      };
      this._cacheUniforms(programInfo);
      this._cacheAttributes(programInfo);
      this.programs.set(cacheKey, programInfo);
      if (name) this.programs.set(name, programInfo);
      this.stats.compiled++;
      return programInfo;
    }

    _compileShader(type, source) {
      const gl = this.gl;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, 35713)) {
        const error = gl.getShaderInfoLog(shader);
        console.error('Shader compile error:', error);
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    _processSource(source, type) {
      let processed = source;
      let defines = '#version 300 es\n';
      for (const [name, value] of this.defines) {
        defines += `#define ${name} ${value}\n`;
      }
      processed = processed.replace('#version 300 es', defines);
      processed = processed.replace(/#include\s+<([^>]+)>/g, (match, name) => {
        return this.includeSources.get(name) || match;
      });
      return processed;
    }

    _cacheUniforms(programInfo) {
      const gl = this.gl;
      const count = gl.getProgramParameter(programInfo.program, 35718);
      for (let i = 0; i < count; i++) {
        const info = gl.getActiveUniform(programInfo.program, i);
        if (info) {
          const location = gl.getUniformLocation(programInfo.program, info.name);
          programInfo.uniforms.set(info.name, { location, type: info.type, size: info.size });
        }
      }
    }

    _cacheAttributes(programInfo) {
      const gl = this.gl;
      const count = gl.getProgramParameter(programInfo.program, 35721);
      for (let i = 0; i < count; i++) {
        const info = gl.getActiveAttrib(programInfo.program, i);
        if (info) {
          const location = gl.getAttribLocation(programInfo.program, info.name);
          programInfo.attributes.set(info.name, { location, type: info.type, size: info.size });
        }
      }
    }

    use(programInfo) {
      if (typeof programInfo === 'string') {
        programInfo = this.programs.get(programInfo);
      }
      if (!programInfo) return;
      if (this.currentProgram !== programInfo.program) {
        this.gl.useProgram(programInfo.program);
        this.currentProgram = programInfo.program;
      }
    }

    getUniformLocation(programInfo, name) {
      if (typeof programInfo === 'string') {
        programInfo = this.programs.get(programInfo);
      }
      if (!programInfo) return -1;
      const uniform = programInfo.uniforms.get(name);
      return uniform ? uniform.location : this.gl.getUniformLocation(programInfo.program, name);
    }

    getAttributeLocation(programInfo, name) {
      if (typeof programInfo === 'string') {
        programInfo = this.programs.get(programInfo);
      }
      if (!programInfo) return -1;
      const attribute = programInfo.attributes.get(name);
      return attribute ? attribute.location : this.gl.getAttribLocation(programInfo.program, name);
    }

    setUniform1f(programInfo, name, value) {
      const loc = this.getUniformLocation(programInfo, name);
      if (loc !== -1) this.gl.uniform1f(loc, value);
    }

    setUniform2f(programInfo, name, x, y) {
      const loc = this.getUniformLocation(programInfo, name);
      if (loc !== -1) this.gl.uniform2f(loc, x, y);
    }

    setUniform3f(programInfo, name, x, y, z) {
      const loc = this.getUniformLocation(programInfo, name);
      if (loc !== -1) this.gl.uniform3f(loc, x, y, z);
    }

    setUniform4f(programInfo, name, x, y, z, w) {
      const loc = this.getUniformLocation(programInfo, name);
      if (loc !== -1) this.gl.uniform4f(loc, x, y, z, w);
    }

    setUniform1i(programInfo, name, value) {
      const loc = this.getUniformLocation(programInfo, name);
      if (loc !== -1) this.gl.uniform1i(loc, value);
    }

    setUniformMatrix4fv(programInfo, name, value) {
      const loc = this.getUniformLocation(programInfo, name);
      if (loc !== -1) this.gl.uniformMatrix4fv(loc, false, value);
    }

    setUniformMatrix3fv(programInfo, name, value) {
      const loc = this.getUniformLocation(programInfo, name);
      if (loc !== -1) this.gl.uniformMatrix3fv(loc, false, value);
    }

    setUniform2fv(programInfo, name, value) {
      const loc = this.getUniformLocation(programInfo, name);
      if (loc !== -1) this.gl.uniform2fv(loc, value);
    }

    setUniform3fv(programInfo, name, value) {
      const loc = this.getUniformLocation(programInfo, name);
      if (loc !== -1) this.gl.uniform3fv(loc, value);
    }

    setUniform4fv(programInfo, name, value) {
      const loc = this.getUniformLocation(programInfo, name);
      if (loc !== -1) this.gl.uniform4fv(loc, value);
    }

    getProgram(name) { return this.programs.get(name); }
    getProgramCount() { return this.programs.size; }
    getStats() { return { ...this.stats }; }
    deleteProgram(name) {
      const programInfo = this.programs.get(name);
      if (programInfo) {
        this.gl.deleteProgram(programInfo.program);
        this.programs.delete(name);
      }
    }
    clear() {
      for (const [key, programInfo] of this.programs) {
        if (typeof key === 'string' && !key.startsWith('program_')) {
          this.gl.deleteProgram(programInfo.program);
        }
      }
      this.programs.clear();
      this.includeSources.clear();
      this.defines.clear();
    }
    _hashString(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
      }
      return 'program_' + hash.toString(36);
    }
  }

  class GeometryProcessor {
    constructor() {
      this.geometries = new Map();
      this.optimizers = new Map();
      this._initDefaultOptimizers();
    }

    _initDefaultOptimizers() {
      this.optimizers.set('weld', this._weldVertices.bind(this));
      this.optimizers.set('reindex', this._reindexGeometry.bind(this));
      this.optimizers.set('optimizeCache', this._optimizeVertexCache.bind(this));
      this.optimizers.set('computeNormals', this._computeNormals.bind(this));
      this.optimizers.set('computeTangents', this._computeTangents.bind(this));
      this.optimizers.set('deindex', this._deindexGeometry.bind(this));
      this.optimizers.set('merge', this._mergeGeometries.bind(this));
    }

    createGeometry(name, data) {
      const geometry = {
        name,
        vertices: data.vertices ? new Float32Array(data.vertices) : null,
        normals: data.normals ? new Float32Array(data.normals) : null,
        uvs: data.uvs ? new Float32Array(data.uvs) : null,
        tangents: data.tangents ? new Float32Array(data.tangents) : null,
        colors: data.colors ? new Float32Array(data.colors) : null,
        indices: data.indices ? new Uint32Array(data.indices) : null,
        vertexCount: data.vertices ? data.vertices.length / 3 : 0,
        indexCount: data.indices ? data.indices.length : 0,
        boundingBox: null,
        boundingSphere: null,
        metadata: data.metadata || {}
      };
      this._computeBounds(geometry);
      this.geometries.set(name, geometry);
      return geometry;
    }

    optimize(name, optimizers = []) {
      const geometry = this.geometries.get(name);
      if (!geometry) return null;
      let result = geometry;
      for (const optimizerName of optimizers) {
        const optimizer = this.optimizers.get(optimizerName);
        if (optimizer) {
          result = optimizer(result);
        }
      }
      this.geometries.set(name, result);
      return result;
    }

    _weldVertices(geometry, tolerance = 0.0001) {
      if (!geometry.indices) return geometry;
      const uniqueVertices = [];
      const vertexMap = new Map();
      const newIndices = [];
      for (let i = 0; i < geometry.indices.length; i++) {
        const idx = geometry.indices[i];
        const vertexKey = this._createVertexKey(geometry, idx, tolerance);
        if (vertexMap.has(vertexKey)) {
          newIndices.push(vertexMap.get(vertexKey));
        } else {
          const newIdx = uniqueVertices.length;
          vertexMap.set(vertexKey, newIdx);
          uniqueVertices.push(idx);
          newIndices.push(newIdx);
        }
      }
      const newVertices = new Float32Array(uniqueVertices.length * 3);
      const newNormals = geometry.normals ? new Float32Array(uniqueVertices.length * 3) : null;
      const newUVs = geometry.uvs ? new Float32Array(uniqueVertices.length * 2) : null;
      for (let i = 0; i < uniqueVertices.length; i++) {
        const srcIdx = uniqueVertices[i];
        newVertices[i*3] = geometry.vertices[srcIdx*3];
        newVertices[i*3+1] = geometry.vertices[srcIdx*3+1];
        newVertices[i*3+2] = geometry.vertices[srcIdx*3+2];
        if (newNormals) {
          newNormals[i*3] = geometry.normals[srcIdx*3];
          newNormals[i*3+1] = geometry.normals[srcIdx*3+1];
          newNormals[i*3+2] = geometry.normals[srcIdx*3+2];
        }
        if (newUVs) {
          newUVs[i*2] = geometry.uvs[srcIdx*2];
          newUVs[i*2+1] = geometry.uvs[srcIdx*2+1];
        }
      }
      return {
        ...geometry,
        vertices: newVertices,
        normals: newNormals,
        uvs: newUVs,
        indices: new Uint32Array(newIndices),
        vertexCount: uniqueVertices.length,
        indexCount: newIndices.length
      };
    }

    _createVertexKey(geometry, idx, tolerance) {
      const x = Math.round(geometry.vertices[idx*3] / tolerance);
      const y = Math.round(geometry.vertices[idx*3+1] / tolerance);
      const z = Math.round(geometry.vertices[idx*3+2] / tolerance);
      let key = `${x},${y},${z}`;
      if (geometry.normals) {
        const nx = Math.round(geometry.normals[idx*3] / 0.01);
        const ny = Math.round(geometry.normals[idx*3+1] / 0.01);
        const nz = Math.round(geometry.normals[idx*3+2] / 0.01);
        key += `,${nx},${ny},${nz}`;
      }
      if (geometry.uvs) {
        const u = Math.round(geometry.uvs[idx*2] / 0.001);
        const v = Math.round(geometry.uvs[idx*2+1] / 0.001);
        key += `,${u},${v}`;
      }
      return key;
    }

    _reindexGeometry(geometry) {
      if (geometry.indices) return geometry;
      const uniqueMap = new Map();
      const indices = [];
      const vertices = [];
      const normals = geometry.normals ? [] : null;
      const uvs = geometry.uvs ? [] : null;
      const vertexCount = geometry.vertices.length / 3;
      for (let i = 0; i < vertexCount; i++) {
        const key = `${geometry.vertices[i*3]},${geometry.vertices[i*3+1]},${geometry.vertices[i*3+2]}`;
        if (uniqueMap.has(key)) {
          indices.push(uniqueMap.get(key));
        } else {
          const newIdx = vertices.length / 3;
          uniqueMap.set(key, newIdx);
          vertices.push(geometry.vertices[i*3], geometry.vertices[i*3+1], geometry.vertices[i*3+2]);
          if (normals) normals.push(geometry.normals[i*3], geometry.normals[i*3+1], geometry.normals[i*3+2]);
          if (uvs) uvs.push(geometry.uvs[i*2], geometry.uvs[i*2+1]);
          indices.push(newIdx);
        }
      }
      return {
        ...geometry,
        vertices: new Float32Array(vertices),
        normals: normals ? new Float32Array(normals) : null,
        uvs: uvs ? new Float32Array(uvs) : null,
        indices: new Uint32Array(indices),
        vertexCount: vertices.length / 3,
        indexCount: indices.length
      };
    }

    _optimizeVertexCache(geometry) {
      if (!geometry.indices) return geometry;
      const indices = Array.from(geometry.indices);
      const vertexCount = geometry.vertexCount;
      const cache = [];
      const cacheSize = 32;
      const triangleScore = [];
      for (let i = 0; i < indices.length; i += 3) {
        let score = 0;
        for (let j = 0; j < 3; j++) {
          const idx = indices[i + j];
          if (cache.includes(idx)) score += 10;
          else score += 1;
        }
        triangleScore.push(score);
      }
      const newIndices = [];
      const remaining = new Set(Array.from({ length: indices.length / 3 }, (_, i) => i));
      while (remaining.size > 0) {
        let bestTriangle = -1;
        let bestScore = -1;
        for (const triIdx of remaining) {
          if (triangleScore[triIdx] > bestScore) {
            bestScore = triangleScore[triIdx];
            bestTriangle = triIdx;
          }
        }
        if (bestTriangle === -1) break;
        remaining.delete(bestTriangle);
        for (let j = 0; j < 3; j++) {
          const idx = indices[bestTriangle * 3 + j];
          newIndices.push(idx);
          const cacheIdx = cache.indexOf(idx);
          if (cacheIdx !== -1) cache.splice(cacheIdx, 1);
          cache.unshift(idx);
          if (cache.length > cacheSize) cache.pop();
        }
        for (const triIdx of remaining) {
          let score = 0;
          for (let j = 0; j < 3; j++) {
            const idx = indices[triIdx * 3 + j];
            if (cache.includes(idx)) score += 10;
            else score += 1;
          }
          triangleScore[triIdx] = score;
        }
      }
      return { ...geometry, indices: new Uint32Array(newIndices) };
    }

    _computeNormals(geometry) {
      if (!geometry.indices || !geometry.vertices) return geometry;
      const normals = new Float32Array(geometry.vertices.length);
      for (let i = 0; i < geometry.indices.length; i += 3) {
        const a = geometry.indices[i] * 3;
        const b = geometry.indices[i + 1] * 3;
        const c = geometry.indices[i + 2] * 3;
        const e1 = [geometry.vertices[b] - geometry.vertices[a], geometry.vertices[b+1] - geometry.vertices[a+1], geometry.vertices[b+2] - geometry.vertices[a+2]];
        const e2 = [geometry.vertices[c] - geometry.vertices[a], geometry.vertices[c+1] - geometry.vertices[a+1], geometry.vertices[c+2] - geometry.vertices[a+2]];
        const n = [e1[1]*e2[2] - e1[2]*e2[1], e1[2]*e2[0] - e1[0]*e2[2], e1[0]*e2[1] - e1[1]*e2[0]];
        normals[a] += n[0]; normals[a+1] += n[1]; normals[a+2] += n[2];
        normals[b] += n[0]; normals[b+1] += n[1]; normals[b+2] += n[2];
        normals[c] += n[0]; normals[c+1] += n[1]; normals[c+2] += n[2];
      }
      for (let i = 0; i < normals.length; i += 3) {
        const l = Math.sqrt(normals[i]**2 + normals[i+1]**2 + normals[i+2]**2) || 1;
        normals[i] /= l; normals[i+1] /= l; normals[i+2] /= l;
      }
      return { ...geometry, normals };
    }

    _computeTangents(geometry) {
      if (!geometry.indices || !geometry.vertices || !geometry.uvs) return geometry;
      const tangents = new Float32Array(geometry.vertices.length);
      for (let i = 0; i < geometry.indices.length; i += 3) {
        const a = geometry.indices[i];
        const b = geometry.indices[i + 1];
        const c = geometry.indices[i + 2];
        const e1 = [geometry.vertices[b*3] - geometry.vertices[a*3], geometry.vertices[b*3+1] - geometry.vertices[a*3+1], geometry.vertices[b*3+2] - geometry.vertices[a*3+2]];
        const e2 = [geometry.vertices[c*3] - geometry.vertices[a*3], geometry.vertices[c*3+1] - geometry.vertices[a*3+1], geometry.vertices[c*3+2] - geometry.vertices[a*3+2]];
        const duv1 = [geometry.uvs[b*2] - geometry.uvs[a*2], geometry.uvs[b*2+1] - geometry.uvs[a*2+1]];
        const duv2 = [geometry.uvs[c*2] - geometry.uvs[a*2], geometry.uvs[c*2+1] - geometry.uvs[a*2+1]];
        const f = 1 / (duv1[0] * duv2[1] - duv2[0] * duv1[1] + 0.0001);
        const t = [f * (duv2[1] * e1[0] - duv1[1] * e2[0]), f * (duv2[1] * e1[1] - duv1[1] * e2[1]), f * (duv2[1] * e1[2] - duv1[1] * e2[2])];
        for (const idx of [a, b, c]) {
          tangents[idx*3] += t[0]; tangents[idx*3+1] += t[1]; tangents[idx*3+2] += t[2];
        }
      }
      for (let i = 0; i < tangents.length; i += 3) {
        const n = geometry.normals ? [geometry.normals[i], geometry.normals[i+1], geometry.normals[i+2]] : [0, 1, 0];
        const t = [tangents[i], tangents[i+1], tangents[i+2]];
        const dot = n[0]*t[0] + n[1]*t[1] + n[2]*t[2];
        tangents[i] = t[0] - n[0] * dot;
        tangents[i+1] = t[1] - n[1] * dot;
        tangents[i+2] = t[2] - n[2] * dot;
        const l = Math.sqrt(tangents[i]**2 + tangents[i+1]**2 + tangents[i+2]**2) || 1;
        tangents[i] /= l; tangents[i+1] /= l; tangents[i+2] /= l;
      }
      return { ...geometry, tangents };
    }

    _deindexGeometry(geometry) {
      if (!geometry.indices) return geometry;
      const vertexCount = geometry.indices.length;
      const vertices = new Float32Array(vertexCount * 3);
      const normals = geometry.normals ? new Float32Array(vertexCount * 3) : null;
      const uvs = geometry.uvs ? new Float32Array(vertexCount * 2) : null;
      for (let i = 0; i < vertexCount; i++) {
        const srcIdx = geometry.indices[i];
        vertices[i*3] = geometry.vertices[srcIdx*3];
        vertices[i*3+1] = geometry.vertices[srcIdx*3+1];
        vertices[i*3+2] = geometry.vertices[srcIdx*3+2];
        if (normals) {
          normals[i*3] = geometry.normals[srcIdx*3];
          normals[i*3+1] = geometry.normals[srcIdx*3+1];
          normals[i*3+2] = geometry.normals[srcIdx*3+2];
        }
        if (uvs) {
          uvs[i*2] = geometry.uvs[srcIdx*2];
          uvs[i*2+1] = geometry.uvs[srcIdx*2+1];
        }
      }
      return { ...geometry, vertices, normals, uvs, indices: null, vertexCount, indexCount: 0 };
    }

    _mergeGeometries(geometries) {
      let totalVertices = 0;
      let totalIndices = 0;
      for (const geo of geometries) {
        totalVertices += geo.vertexCount;
        totalIndices += geo.indexCount;
      }
      const vertices = new Float32Array(totalVertices * 3);
      const normals = new Float32Array(totalVertices * 3);
      const uvs = new Float32Array(totalVertices * 2);
      const indices = new Uint32Array(totalIndices);
      let vertexOffset = 0;
      let indexOffset = 0;
      for (const geo of geometries) {
        vertices.set(geo.vertices, vertexOffset * 3);
        if (geo.normals) normals.set(geo.normals, vertexOffset * 3);
        if (geo.uvs) uvs.set(geo.uvs, vertexOffset * 2);
        if (geo.indices) {
          for (let i = 0; i < geo.indexCount; i++) {
            indices[indexOffset + i] = geo.indices[i] + vertexOffset;
          }
        }
        vertexOffset += geo.vertexCount;
        indexOffset += geo.indexCount;
      }
      const result = {
        vertices, normals, uvs, indices,
        vertexCount: totalVertices,
        indexCount: totalIndices
      };
      this._computeBounds(result);
      return result;
    }

    _computeBounds(geometry) {
      if (!geometry.vertices) return;
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < geometry.vertices.length; i += 3) {
        minX = Math.min(minX, geometry.vertices[i]);
        minY = Math.min(minY, geometry.vertices[i+1]);
        minZ = Math.min(minZ, geometry.vertices[i+2]);
        maxX = Math.max(maxX, geometry.vertices[i]);
        maxY = Math.max(maxY, geometry.vertices[i+1]);
        maxZ = Math.max(maxZ, geometry.vertices[i+2]);
      }
      geometry.boundingBox = { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
      const center = [(minX+maxX)/2, (minY+maxY)/2, (minZ+maxZ)/2];
      let maxRadius = 0;
      for (let i = 0; i < geometry.vertices.length; i += 3) {
        const dx = geometry.vertices[i] - center[0];
        const dy = geometry.vertices[i+1] - center[1];
        const dz = geometry.vertices[i+2] - center[2];
        maxRadius = Math.max(maxRadius, Math.sqrt(dx*dx + dy*dy + dz*dz));
      }
      geometry.boundingSphere = { center, radius: maxRadius };
    }

    getGeometry(name) { return this.geometries.get(name); }
    getGeometryCount() { return this.geometries.size; }
    removeGeometry(name) { this.geometries.delete(name); }
    clear() { this.geometries.clear(); }
  }

  class PipelineState {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.state = {
        depthTest: true,
        depthWrite: true,
        depthFunc: 515,
        cullFace: true,
        cullFaceMode: 1029,
        frontFace: 2305,
        blend: false,
        blendSrc: 770,
        blendDst: 771,
        blendSrcAlpha: 1,
        blendDstAlpha: 0,
        blendEquation: 32774,
        scissorTest: false,
        scissorX: 0,
        scissorY: 0,
        scissorWidth: 0,
        scissorHeight: 0,
        polygonOffset: false,
        polygonOffsetFactor: 0,
        polygonOffsetUnits: 0,
        colorMask: [true, true, true, true],
        stencilTest: false,
        stencilFunc: 519,
        stencilRef: 0,
        stencilMask: 255,
        stencilFail: 7680,
        stencilZFail: 7680,
        stencilZPass: 7680,
        dither: true
      };
      this.cache = { ...this.state };
      this.dirty = true;
    }

    setDepthTest(enabled) { this.state.depthTest = enabled; this.dirty = true; }
    setDepthWrite(enabled) { this.state.depthWrite = enabled; this.dirty = true; }
    setDepthFunc(func) { this.state.depthFunc = func; this.dirty = true; }
    setCullFace(enabled) { this.state.cullFace = enabled; this.dirty = true; }
    setCullFaceMode(mode) { this.state.cullFaceMode = mode; this.dirty = true; }
    setFrontFace(mode) { this.state.frontFace = mode; this.dirty = true; }
    setBlend(enabled) { this.state.blend = enabled; this.dirty = true; }
    setBlendFunc(src, dst) { this.state.blendSrc = src; this.state.blendDst = dst; this.dirty = true; }
    setBlendFuncSeparate(srcRGB, dstRGB, srcAlpha, dstAlpha) {
      this.state.blendSrc = srcRGB;
      this.state.blendDst = dstRGB;
      this.state.blendSrcAlpha = srcAlpha;
      this.state.blendDstAlpha = dstAlpha;
      this.dirty = true;
    }
    setBlendEquation(mode) { this.state.blendEquation = mode; this.dirty = true; }
    setScissorTest(enabled) { this.state.scissorTest = enabled; this.dirty = true; }
    setScissor(x, y, width, height) {
      this.state.scissorX = x;
      this.state.scissorY = y;
      this.state.scissorWidth = width;
      this.state.scissorHeight = height;
      this.dirty = true;
    }
    setPolygonOffset(enabled, factor = 0, units = 0) {
      this.state.polygonOffset = enabled;
      this.state.polygonOffsetFactor = factor;
      this.state.polygonOffsetUnits = units;
      this.dirty = true;
    }
    setColorMask(r, g, b, a) {
      this.state.colorMask = [r, g, b, a];
      this.dirty = true;
    }
    setStencilTest(enabled) { this.state.stencilTest = enabled; this.dirty = true; }
    setStencilFunc(func, ref, mask) {
      this.state.stencilFunc = func;
      this.state.stencilRef = ref;
      this.state.stencilMask = mask;
      this.dirty = true;
    }
    setStencilOp(fail, zFail, zPass) {
      this.state.stencilFail = fail;
      this.state.stencilZFail = zFail;
      this.state.stencilZPass = zPass;
      this.dirty = true;
    }
    setDither(enabled) { this.state.dither = enabled; this.dirty = true; }

    apply() {
      if (!this.dirty) return;
      const gl = this.gl;
      const s = this.state;
      if (s.depthTest) gl.enable(2929); else gl.disable(2929);
      gl.depthMask(s.depthWrite);
      gl.depthFunc(s.depthFunc);
      if (s.cullFace) gl.enable(2884); else gl.disable(2884);
      gl.cullFace(s.cullFaceMode);
      gl.frontFace(s.frontFace);
      if (s.blend) gl.enable(3042); else gl.disable(3042);
      gl.blendFunc(s.blendSrc, s.blendDst);
      gl.blendEquation(s.blendEquation);
      if (s.scissorTest) {
        gl.enable(3089);
        gl.scissor(s.scissorX, s.scissorY, s.scissorWidth, s.scissorHeight);
      } else {
        gl.disable(3089);
      }
      if (s.polygonOffset) {
        gl.enable(32823);
        gl.polygonOffset(s.polygonOffsetFactor, s.polygonOffsetUnits);
      } else {
        gl.disable(32823);
      }
      gl.colorMask(s.colorMask[0], s.colorMask[1], s.colorMask[2], s.colorMask[3]);
      if (s.stencilTest) {
        gl.enable(2960);
        gl.stencilFunc(s.stencilFunc, s.stencilRef, s.stencilMask);
        gl.stencilOp(s.stencilFail, s.stencilZFail, s.stencilZPass);
      } else {
        gl.disable(2960);
      }
      if (s.dither) gl.enable(3024); else gl.disable(3024);
      this.cache = { ...s };
      this.dirty = false;
    }

    reset() {
      this.state = {
        depthTest: true, depthWrite: true, depthFunc: 515,
        cullFace: true, cullFaceMode: 1029, frontFace: 2305,
        blend: false, blendSrc: 770, blendDst: 771,
        blendSrcAlpha: 1, blendDstAlpha: 0, blendEquation: 32774,
        scissorTest: false, scissorX: 0, scissorY: 0, scissorWidth: 0, scissorHeight: 0,
        polygonOffset: false, polygonOffsetFactor: 0, polygonOffsetUnits: 0,
        colorMask: [true, true, true, true],
        stencilTest: false, stencilFunc: 519, stencilRef: 0, stencilMask: 255,
        stencilFail: 7680, stencilZFail: 7680, stencilZPass: 7680,
        dither: true
      };
      this.dirty = true;
    }

    getState() { return { ...this.state }; }
    isDirty() { return this.dirty; }
  }

  return {
    ShaderManager, GeometryProcessor, PipelineState
  };
})();

if (typeof window !== 'undefined') window.WebGLCoreV6 = WebGLCoreV6;
if (typeof globalThis !== 'undefined') globalThis.WebGLCoreV6 = WebGLCoreV6;
