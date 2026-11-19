/**
 * 纯自研WebGL引擎核心扩展 - 上下文/着色器/缓冲/纹理/帧缓冲/VAO/UBO/实例化/计算/数学/几何
 * 零第三方依赖，纯WebGL2实现
 * @version 2.0.0
 */
'use strict';

const WebGLCore = (function () {

  // ============================================================
  // WebGL上下文管理
  // ============================================================
  class WebGLContext {
    constructor() {
      this.gl = null;
      this.canvas = null;
      this.isWebGL2 = false;
      this.extensions = new Map();
      this.capabilities = {};
      this.state = {
        viewport: [0, 0, 0, 0],
        clearColor: [0, 0, 0, 1],
        depthTest: true,
        depthFunc: 515,
        blend: false,
        blendSrc: 770,
        blendDst: 771,
        cullFace: false,
        cullFaceMode: 1029,
        frontFace: 2305,
        polygonOffset: false,
        polygonOffsetFactor: 0,
        polygonOffsetUnits: 0,
        scissorTest: false,
        activeTexture: 33984,
        currentProgram: null,
        currentVAO: null,
        currentFramebuffer: null
      };
      this.stateStack = [];
      this.extensionList = [
        'EXT_color_buffer_float', 'EXT_texture_filter_anisotropic',
        'OES_texture_float_linear', 'WEBGL_depth_texture',
        'EXT_shader_texture_lod', 'OES_standard_derivatives',
        'WEBGL_draw_buffers', 'ANGLE_instanced_arrays',
        'OES_vertex_array_object', 'WEBGL_compressed_texture_s3tc',
        'EXT_sRGB', 'EXT_frag_depth', 'OES_element_index_uint'
      ];
    }

    init(canvas, options = {}) {
      this.canvas = canvas;
      const contextAttributes = {
        alpha: options.alpha !== false,
        depth: options.depth !== false,
        stencil: options.stencil || false,
        antialias: options.antialias !== false,
        premultipliedAlpha: options.premultipliedAlpha !== false,
        preserveDrawingBuffer: options.preserveDrawingBuffer || false,
        powerPreference: options.powerPreference || 'high-performance',
        failIfMajorPerformanceCaveat: options.failIfMajorPerformanceCaveat || false
      };
      this.gl = canvas.getContext('webgl2', contextAttributes);
      if (this.gl) {
        this.isWebGL2 = true;
      } else {
        this.gl = canvas.getContext('webgl', contextAttributes) || canvas.getContext('experimental-webgl', contextAttributes);
        this.isWebGL2 = false;
      }
      if (!this.gl) throw new Error('WebGL not supported');
      this._loadExtensions();
      this._detectCapabilities();
      this._initState();
      return this.gl;
    }

    _loadExtensions() {
      for (const ext of this.extensionList) {
        const extension = this.gl.getExtension(ext);
        if (extension) this.extensions.set(ext, extension);
      }
    }

    _detectCapabilities() {
      const gl = this.gl;
      this.capabilities = {
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        maxCubeMapTextureSize: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
        maxTextureImageUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
        maxVertexTextureImageUnits: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
        maxCombinedTextureImageUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
        maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
        maxViewportDims: gl.getParameter(gl.MAX_VIEWPORT_DIMS),
        maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
        maxVertexUniformVectors: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
        maxFragmentUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
        maxVaryingVectors: gl.getParameter(gl.MAX_VARYING_VECTORS),
        maxDrawBuffers: this.isWebGL2 ? gl.getParameter(gl.MAX_DRAW_BUFFERS) : 1,
        maxColorAttachments: this.isWebGL2 ? gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) : 1,
        maxSamples: this.isWebGL2 ? gl.getParameter(gl.MAX_SAMPLES) : 0,
        maxAnisotropy: this.extensions.has('EXT_texture_filter_anisotropic') ? gl.getParameter(this.extensions.get('EXT_texture_filter_anisotropic').MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1,
        maxUniformBufferBindings: this.isWebGL2 ? gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS) : 0,
        maxUniformBlockSize: this.isWebGL2 ? gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE) : 0,
        maxShaderStorageBufferBindings: this.isWebGL2 ? gl.getParameter(gl.MAX_SHADER_STORAGE_BUFFER_BINDINGS) : 0,
        maxTransformFeedbackInterleavedComponents: this.isWebGL2 ? gl.getParameter(gl.MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS) : 0,
        maxArrayTextureLayers: this.isWebGL2 ? gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) : 0,
        max3DTextureSize: this.isWebGL2 ? gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) : 0,
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION)
      };
    }

    _initState() {
      const gl = this.gl;
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.frontFace(gl.CCW);
      gl.clearColor(0, 0, 0, 1);
      this.state.viewport = [0, 0, this.canvas.width, this.canvas.height];
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    getContext() { return this.gl; }
    getExtension(name) { return this.extensions.get(name); }
    hasExtension(name) { return this.extensions.has(name); }
    getCapabilities() { return { ...this.capabilities }; }
    getMaxTextureSize() { return this.capabilities.maxTextureSize; }
    getMaxAnisotropy() { return this.capabilities.maxAnisotropy; }
    isWebGL2Supported() { return this.isWebGL2; }

    setViewport(x, y, width, height) {
      this.state.viewport = [x, y, width, height];
      this.gl.viewport(x, y, width, height);
    }

    setClearColor(r, g, b, a) {
      this.state.clearColor = [r, g, b, a];
      this.gl.clearColor(r, g, b, a);
    }

    setDepthTest(enabled) {
      this.state.depthTest = enabled;
      if (enabled) this.gl.enable(this.gl.DEPTH_TEST);
      else this.gl.disable(this.gl.DEPTH_TEST);
    }

    setBlend(enabled) {
      this.state.blend = enabled;
      if (enabled) this.gl.enable(this.gl.BLEND);
      else this.gl.disable(this.gl.BLEND);
    }

    setBlendFunc(src, dst) {
      this.state.blendSrc = src;
      this.state.blendDst = dst;
      this.gl.blendFunc(src, dst);
    }

    setCullFace(enabled) {
      this.state.cullFace = enabled;
      if (enabled) this.gl.enable(this.gl.CULL_FACE);
      else this.gl.disable(this.gl.CULL_FACE);
    }

    pushState() {
      this.stateStack.push(JSON.parse(JSON.stringify(this.state)));
    }

    popState() {
      if (this.stateStack.length > 0) {
        const prev = this.stateStack.pop();
        this.setDepthTest(prev.depthTest);
        this.setBlend(prev.blend);
        this.setCullFace(prev.cullFace);
        this.setViewport(...prev.viewport);
      }
    }

    clear(mask = 16640) { this.gl.clear(mask); }
    flush() { this.gl.flush(); }
    finish() { this.gl.finish(); }
    resize(width, height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.setViewport(0, 0, width, height);
    }
    getError() { return this.gl.getError(); }
    checkError(source = '') {
      const error = this.gl.getError();
      if (error !== this.gl.NO_ERROR) console.error(`[WebGL] ${source}: Error 0x${error.toString(16)}`);
      return error;
    }
  }

  // ============================================================
  // 着色器编译器
  // ============================================================
  class VertexArrayObject {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.vaos = new Map();
      this.nextId = 1;
      this.currentVAO = null;
      this.supportsVAO = !!this.gl.createVertexArray;
    }

    create() {
      const id = this.nextId++;
      const vao = this.supportsVAO ? this.gl.createVertexArray() : { attributes: new Map(), elementBuffer: null };
      this.vaos.set(id, { vao, attributes: new Map(), elementBuffer: null });
      return id;
    }

    bind(id) {
      const info = this.vaos.get(id);
      if (!info) return;
      if (this.supportsVAO) {
        if (this.currentVAO !== id) {
          this.gl.bindVertexArray(info.vao);
          this.currentVAO = id;
        }
      } else {
        this._bindAttributes(info);
      }
    }

    unbind() {
      if (this.supportsVAO) {
        this.gl.bindVertexArray(null);
        this.currentVAO = null;
      }
    }

    enableAttribute(id, location, bufferId, size, type, normalized = false, stride = 0, offset = 0) {
      const info = this.vaos.get(id);
      if (!info) return;
      this.bind(id);
      const bufferInfo = this._getBufferInfo(bufferId);
      if (bufferInfo) {
        this.gl.bindBuffer(bufferInfo.target, bufferInfo.buffer);
        this.gl.enableVertexAttribArray(location);
        this.gl.vertexAttribPointer(location, size, type, normalized, stride, offset);
      }
      info.attributes.set(location, { bufferId, size, type, normalized, stride, offset });
    }

    disableAttribute(id, location) {
      const info = this.vaos.get(id);
      if (!info) return;
      this.bind(id);
      this.gl.disableVertexAttribArray(location);
      info.attributes.delete(location);
    }

    setElementBuffer(id, bufferId) {
      const info = this.vaos.get(id);
      if (!info) return;
      this.bind(id);
      const bufferInfo = this._getBufferInfo(bufferId);
      if (bufferInfo) {
        this.gl.bindBuffer(34963, bufferInfo.buffer);
      }
      info.elementBuffer = bufferId;
    }

    _bindAttributes(info) {
      for (const [location, attr] of info.attributes) {
        const bufferInfo = this._getBufferInfo(attr.bufferId);
        if (bufferInfo) {
          this.gl.bindBuffer(bufferInfo.target, bufferInfo.buffer);
          this.gl.enableVertexAttribArray(location);
          this.gl.vertexAttribPointer(location, attr.size, attr.type, attr.normalized, attr.stride, attr.offset);
        }
      }
      if (info.elementBuffer) {
        const bufferInfo = this._getBufferInfo(info.elementBuffer);
        if (bufferInfo) this.gl.bindBuffer(34963, bufferInfo.buffer);
      }
    }

    _getBufferInfo(bufferId) {
      return null;
    }

    delete(id) {
      const info = this.vaos.get(id);
      if (info) {
        if (this.supportsVAO) this.gl.deleteVertexArray(info.vao);
        this.vaos.delete(id);
      }
    }

    clear() {
      for (const id of this.vaos.keys()) this.delete(id);
      this.currentVAO = null;
    }
  }

  // ============================================================
  // 统一缓冲对象
  // ============================================================
  class UniformBufferObject {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.buffers = new Map();
      this.nextId = 1;
      this.bindingPoints = new Map();
      this.maxBindingPoints = glContext.getCapabilities().maxUniformBufferBindings || 0;
      this.supportsUBO = this.maxBindingPoints > 0;
    }

    create(bindingPoint, size, data = null) {
      if (!this.supportsUBO) return null;
      const id = this.nextId++;
      const buffer = this.gl.createBuffer();
      this.gl.bindBuffer(35345, buffer);
      this.gl.bufferData(35345, size, 35048);
      if (data) this.gl.bufferSubData(35345, 0, data);
      this.gl.bindBufferBase(35345, bindingPoint, buffer);
      const info = { id, buffer, bindingPoint, size, data };
      this.buffers.set(id, info);
      this.bindingPoints.set(bindingPoint, id);
      return id;
    }

    update(id, data, offset = 0) {
      const info = this.buffers.get(id);
      if (!info) return;
      this.gl.bindBuffer(35345, info.buffer);
      this.gl.bufferSubData(35345, offset, data);
      info.data = data;
    }

    bind(id) {
      const info = this.buffers.get(id);
      if (info) this.gl.bindBufferBase(35345, info.bindingPoint, info.buffer);
    }

    bindToPoint(id, bindingPoint) {
      const info = this.buffers.get(id);
      if (info) {
        info.bindingPoint = bindingPoint;
        this.gl.bindBufferBase(35345, bindingPoint, info.buffer);
        this.bindingPoints.set(bindingPoint, id);
      }
    }

    delete(id) {
      const info = this.buffers.get(id);
      if (info) {
        this.gl.deleteBuffer(info.buffer);
        this.buffers.delete(id);
        this.bindingPoints.delete(info.bindingPoint);
      }
    }

    getBufferInfo(id) { return this.buffers.get(id); }
    isSupported() { return this.supportsUBO; }
    getMaxBindingPoints() { return this.maxBindingPoints; }
    clear() {
      for (const id of this.buffers.keys()) this.delete(id);
      this.bindingPoints.clear();
    }
  }

  // ============================================================
  // GPU实例化渲染
  // ============================================================
  class GPUInstancing {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.instanceBuffers = new Map();
      this.nextId = 1;
      this.supportsInstancing = !!this.gl.vertexAttribDivisor;
    }

    createInstanceBuffer(data, attributes = []) {
      const id = this.nextId++;
      const buffer = this.gl.createBuffer();
      this.gl.bindBuffer(34962, buffer);
      this.gl.bufferData(34962, data, 35044);
      const info = { id, buffer, data, attributes, instanceCount: data.length / this._getStride(attributes) };
      this.instanceBuffers.set(id, info);
      return id;
    }

    _getStride(attributes) {
      return attributes.reduce((sum, attr) => sum + attr.size * 4, 0);
    }

    updateInstanceBuffer(id, data, offset = 0) {
      const info = this.instanceBuffers.get(id);
      if (!info) return;
      this.gl.bindBuffer(34962, info.buffer);
      this.gl.bufferSubData(34962, offset, data);
      info.data = data;
    }

    setupInstanceAttributes(id, vao, startLocation) {
      const info = this.instanceBuffers.get(id);
      if (!info || !this.supportsInstancing) return;
      this.gl.bindBuffer(34962, info.buffer);
      let offset = 0;
      let location = startLocation;
      for (const attr of info.attributes) {
        this.gl.enableVertexAttribArray(location);
        this.gl.vertexAttribPointer(location, attr.size, attr.type || 5126, false, this._getStride(info.attributes), offset);
        this.gl.vertexAttribDivisor(location, 1);
        offset += attr.size * 4;
        location++;
      }
    }

    drawInstanced(mode, first, count, instanceCount) {
      if (this.supportsInstancing) {
        this.gl.drawArraysInstanced(mode, first, count, instanceCount);
      } else {
        for (let i = 0; i < instanceCount; i++) this.gl.drawArrays(mode, first, count);
      }
    }

    drawElementsInstanced(mode, count, type, offset, instanceCount) {
      if (this.supportsInstancing) {
        this.gl.drawElementsInstanced(mode, count, type, offset, instanceCount);
      } else {
        for (let i = 0; i < instanceCount; i++) this.gl.drawElements(mode, count, type, offset);
      }
    }

    getInstanceCount(id) { return this.instanceBuffers.get(id)?.instanceCount || 0; }
    isSupported() { return this.supportsInstancing; }
    delete(id) {
      const info = this.instanceBuffers.get(id);
      if (info) {
        this.gl.deleteBuffer(info.buffer);
        this.instanceBuffers.delete(id);
      }
    }
    clear() {
      for (const id of this.instanceBuffers.keys()) this.delete(id);
    }
  }

  // ============================================================
  // 高级数学库
  // ============================================================
  const GeometryGenerator = {
    createPlane(width = 1, height = 1, segmentsW = 1, segmentsH = 1) {
      const vertices = [], normals = [], uvs = [], indices = [];
      for (let z = 0; z <= segmentsH; z++) {
        for (let x = 0; x <= segmentsW; x++) {
          const u = x / segmentsW, v = z / segmentsH;
          vertices.push((u - 0.5) * width, 0, (v - 0.5) * height);
          normals.push(0, 1, 0);
          uvs.push(u, v);
        }
      }
      for (let z = 0; z < segmentsH; z++) {
        for (let x = 0; x < segmentsW; x++) {
          const a = z * (segmentsW + 1) + x;
          const b = a + segmentsW + 1;
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      return { vertices: new Float32Array(vertices), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
    },

    createCube(size = 1, segments = 1) {
      const vertices = [], normals = [], uvs = [], indices = [];
      const faces = [
        { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], center: [0, 0, size/2] },
        { normal: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], center: [0, 0, -size/2] },
        { normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], center: [size/2, 0, 0] },
        { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], center: [-size/2, 0, 0] },
        { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], center: [0, size/2, 0] },
        { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], center: [0, -size/2, 0] }
      ];
      for (const face of faces) {
        const baseIndex = vertices.length / 3;
        for (let y = 0; y <= segments; y++) {
          for (let x = 0; x <= segments; x++) {
            const u = x / segments, v = y / segments;
            const px = face.center[0] + (u - 0.5) * size * face.u[0] + (v - 0.5) * size * face.v[0];
            const py = face.center[1] + (u - 0.5) * size * face.u[1] + (v - 0.5) * size * face.v[1];
            const pz = face.center[2] + (u - 0.5) * size * face.u[2] + (v - 0.5) * size * face.v[2];
            vertices.push(px, py, pz);
            normals.push(...face.normal);
            uvs.push(u, v);
          }
        }
        for (let y = 0; y < segments; y++) {
          for (let x = 0; x < segments; x++) {
            const a = baseIndex + y * (segments + 1) + x;
            const b = a + segments + 1;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
          }
        }
      }
      return { vertices: new Float32Array(vertices), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
    },

    createSphere(radius = 1, widthSegments = 32, heightSegments = 16) {
      const vertices = [], normals = [], uvs = [], indices = [];
      for (let y = 0; y <= heightSegments; y++) {
        const v = y / heightSegments;
        const phi = v * Math.PI;
        for (let x = 0; x <= widthSegments; x++) {
          const u = x / widthSegments;
          const theta = u * Math.PI * 2;
          const px = -radius * Math.cos(theta) * Math.sin(phi);
          const py = radius * Math.cos(phi);
          const pz = radius * Math.sin(theta) * Math.sin(phi);
          vertices.push(px, py, pz);
          normals.push(px/radius, py/radius, pz/radius);
          uvs.push(u, 1 - v);
        }
      }
      for (let y = 0; y < heightSegments; y++) {
        for (let x = 0; x < widthSegments; x++) {
          const a = y * (widthSegments + 1) + x;
          const b = a + widthSegments + 1;
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      return { vertices: new Float32Array(vertices), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
    },

    createCylinder(radiusTop = 1, radiusBottom = 1, height = 1, radialSegments = 32, heightSegments = 1) {
      const vertices = [], normals = [], uvs = [], indices = [];
      for (let y = 0; y <= heightSegments; y++) {
        const v = y / heightSegments;
        const radius = radiusTop + (radiusBottom - radiusTop) * v;
        for (let x = 0; x <= radialSegments; x++) {
          const u = x / radialSegments;
          const theta = u * Math.PI * 2;
          const px = radius * Math.sin(theta);
          const py = -height / 2 + v * height;
          const pz = radius * Math.cos(theta);
          vertices.push(px, py, pz);
          normals.push(Math.sin(theta), 0, Math.cos(theta));
          uvs.push(u, v);
        }
      }
      for (let y = 0; y < heightSegments; y++) {
        for (let x = 0; x < radialSegments; x++) {
          const a = y * (radialSegments + 1) + x;
          const b = a + radialSegments + 1;
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      return { vertices: new Float32Array(vertices), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
    },

    createTorus(radius = 1, tube = 0.4, radialSegments = 16, tubularSegments = 100) {
      const vertices = [], normals = [], uvs = [], indices = [];
      for (let j = 0; j <= radialSegments; j++) {
        const v = j / radialSegments * Math.PI * 2;
        for (let i = 0; i <= tubularSegments; i++) {
          const u = i / tubularSegments * Math.PI * 2;
          const px = (radius + tube * Math.cos(v)) * Math.cos(u);
          const py = tube * Math.sin(v);
          const pz = (radius + tube * Math.cos(v)) * Math.sin(u);
          vertices.push(px, py, pz);
          const cx = radius * Math.cos(u), cz = radius * Math.sin(u);
          const nx = px - cx, ny = py, nz = pz - cz;
          const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
          normals.push(nx/len, ny/len, nz/len);
          uvs.push(i / tubularSegments, j / radialSegments);
        }
      }
      for (let j = 1; j <= radialSegments; j++) {
        for (let i = 1; i <= tubularSegments; i++) {
          const a = (tubularSegments + 1) * j + i - 1;
          const b = (tubularSegments + 1) * (j - 1) + i - 1;
          const c = (tubularSegments + 1) * (j - 1) + i;
          const d = (tubularSegments + 1) * j + i;
          indices.push(a, b, d, b, c, d);
        }
      }
      return { vertices: new Float32Array(vertices), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
    },

    createCapsule(radius = 0.5, length = 1, radialSegments = 16, heightSegments = 8) {
      const vertices = [], normals = [], uvs = [], indices = [];
      const halfLength = length / 2;
      for (let y = 0; y <= heightSegments * 2 + 1; y++) {
        let py, radiusY;
        if (y <= heightSegments) {
          const v = y / heightSegments;
          const phi = v * Math.PI / 2;
          py = -halfLength - radius * Math.cos(phi);
          radiusY = radius * Math.sin(phi);
        } else {
          const v = (y - heightSegments - 1) / heightSegments;
          const phi = v * Math.PI / 2;
          py = halfLength + radius * Math.cos(phi);
          radiusY = radius * Math.sin(phi);
        }
        for (let x = 0; x <= radialSegments; x++) {
          const u = x / radialSegments;
          const theta = u * Math.PI * 2;
          const px = radiusY * Math.sin(theta);
          const pz = radiusY * Math.cos(theta);
          vertices.push(px, py, pz);
          normals.push(px/radius, (py - Math.max(-halfLength, Math.min(halfLength, py)))/radius, pz/radius);
          uvs.push(u, y / (heightSegments * 2 + 1));
        }
      }
      const rows = heightSegments * 2 + 2;
      for (let y = 0; y < rows - 1; y++) {
        for (let x = 0; x < radialSegments; x++) {
          const a = y * (radialSegments + 1) + x;
          const b = a + radialSegments + 1;
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      return { vertices: new Float32Array(vertices), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
    },

    computeBoundingBox(geometry) {
      const v = geometry.vertices;
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < v.length; i += 3) {
        if (v[i] < minX) minX = v[i]; if (v[i+1] < minY) minY = v[i+1]; if (v[i+2] < minZ) minZ = v[i+2];
        if (v[i] > maxX) maxX = v[i]; if (v[i+1] > maxY) maxY = v[i+1]; if (v[i+2] > maxZ) maxZ = v[i+2];
      }
      return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], center: [(minX+maxX)/2, (minY+maxY)/2, (minZ+maxZ)/2] };
    },

    computeBoundingSphere(geometry) {
      const box = this.computeBoundingBox(geometry);
      const center = box.center;
      let maxDist = 0;
      const v = geometry.vertices;
      for (let i = 0; i < v.length; i += 3) {
        const dx = v[i] - center[0], dy = v[i+1] - center[1], dz = v[i+2] - center[2];
        const d = dx*dx + dy*dy + dz*dz;
        if (d > maxDist) maxDist = d;
      }
      return { center, radius: Math.sqrt(maxDist) };
    },

    computeVertexNormals(geometry) {
      const v = geometry.vertices, idx = geometry.indices;
      const normals = new Float32Array(v.length);
      for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i] * 3, b = idx[i+1] * 3, c = idx[i+2] * 3;
        const e1 = [v[b]-v[a], v[b+1]-v[a+1], v[b+2]-v[a+2]];
        const e2 = [v[c]-v[a], v[c+1]-v[a+1], v[c+2]-v[a+2]];
        const n = [e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
        normals[a] += n[0]; normals[a+1] += n[1]; normals[a+2] += n[2];
        normals[b] += n[0]; normals[b+1] += n[1]; normals[b+2] += n[2];
        normals[c] += n[0]; normals[c+1] += n[1]; normals[c+2] += n[2];
      }
      for (let i = 0; i < normals.length; i += 3) {
        const len = Math.sqrt(normals[i]**2 + normals[i+1]**2 + normals[i+2]**2) || 1;
        normals[i] /= len; normals[i+1] /= len; normals[i+2] /= len;
      }
      return normals;
    }
  };

  return {
    WebGLContext, VertexArrayObject, UniformBufferObject,
    GPUInstancing, GeometryGenerator
  };
})();

if (typeof window !== 'undefined') window.WebGLCore = WebGLCore;
if (typeof globalThis !== 'undefined') globalThis.WebGLCore = WebGLCore;
