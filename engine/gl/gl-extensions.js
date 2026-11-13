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
  class ShaderCompiler {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.programs = new Map();
      this.shaders = new Map();
      this.uniformCache = new Map();
      this.attributeCache = new Map();
      this.defines = new Map();
      this.includeCache = new Map();
    }

    compile(vertexSource, fragmentSource, defines = {}) {
      const key = this._hashSource(vertexSource + fragmentSource + JSON.stringify(defines));
      if (this.programs.has(key)) return this.programs.get(key);
      const defineString = this._buildDefines(defines);
      const vertexShader = this._compileShader(this.gl.VERTEX_SHADER, defineString + vertexSource);
      const fragmentShader = this._compileShader(this.gl.FRAGMENT_SHADER, defineString + fragmentSource);
      const program = this.gl.createProgram();
      this.gl.attachShader(program, vertexShader);
      this.gl.attachShader(program, fragmentShader);
      this.gl.linkProgram(program);
      if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
        const info = this.gl.getProgramInfoLog(program);
        this.gl.deleteProgram(program);
        throw new Error(`Program link error: ${info}`);
      }
      this.gl.deleteShader(vertexShader);
      this.gl.deleteShader(fragmentShader);
      this.programs.set(key, program);
      this._cacheUniforms(program);
      this._cacheAttributes(program);
      return program;
    }

    _compileShader(type, source) {
      const shader = this.gl.createShader(type);
      this.gl.shaderSource(shader, source);
      this.gl.compileShader(shader);
      if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
        const info = this.gl.getShaderInfoLog(shader);
        this.gl.deleteShader(shader);
        const typeName = type === this.gl.VERTEX_SHADER ? 'Vertex' : 'Fragment';
        throw new Error(`${typeName} shader compile error: ${info}\nSource:\n${source}`);
      }
      return shader;
    }

    _buildDefines(defines) {
      let str = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
      for (const [key, value] of Object.entries(defines)) {
        str += `#define ${key} ${value}\n`;
      }
      return str;
    }

    _hashSource(source) {
      let hash = 0;
      for (let i = 0; i < source.length; i++) {
        const char = source.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
      }
      return hash.toString(36);
    }

    _cacheUniforms(program) {
      const uniformCount = this.gl.getProgramParameter(program, this.gl.ACTIVE_UNIFORMS);
      const uniforms = {};
      for (let i = 0; i < uniformCount; i++) {
        const info = this.gl.getActiveUniform(program, i);
        const location = this.gl.getUniformLocation(program, info.name);
        uniforms[info.name] = { location, type: info.type, size: info.size };
      }
      this.uniformCache.set(program, uniforms);
    }

    _cacheAttributes(program) {
      const attribCount = this.gl.getProgramParameter(program, this.gl.ACTIVE_ATTRIBUTES);
      const attributes = {};
      for (let i = 0; i < attribCount; i++) {
        const info = this.gl.getActiveAttrib(program, i);
        const location = this.gl.getAttribLocation(program, info.name);
        attributes[info.name] = { location, type: info.type, size: info.size };
      }
      this.attributeCache.set(program, attributes);
    }

    use(program) {
      if (this.gl.getParameter(this.gl.CURRENT_PROGRAM) !== program) {
        this.gl.useProgram(program);
      }
    }

    getUniformLocation(program, name) {
      const uniforms = this.uniformCache.get(program);
      return uniforms && uniforms[name] ? uniforms[name].location : this.gl.getUniformLocation(program, name);
    }

    getAttributeLocation(program, name) {
      const attributes = this.attributeCache.get(program);
      return attributes && attributes[name] ? attributes[name].location : this.gl.getAttribLocation(program, name);
    }

    setUniform1f(program, name, x) { this.gl.uniform1f(this.getUniformLocation(program, name), x); }
    setUniform2f(program, name, x, y) { this.gl.uniform2f(this.getUniformLocation(program, name), x, y); }
    setUniform3f(program, name, x, y, z) { this.gl.uniform3f(this.getUniformLocation(program, name), x, y, z); }
    setUniform4f(program, name, x, y, z, w) { this.gl.uniform4f(this.getUniformLocation(program, name), x, y, z, w); }
    setUniform1i(program, name, x) { this.gl.uniform1i(this.getUniformLocation(program, name), x); }
    setUniform2i(program, name, x, y) { this.gl.uniform2i(this.getUniformLocation(program, name), x, y); }
    setUniform3i(program, name, x, y, z) { this.gl.uniform3i(this.getUniformLocation(program, name), x, y, z); }
    setUniform4i(program, name, x, y, z, w) { this.gl.uniform4i(this.getUniformLocation(program, name), x, y, z, w); }
    setUniformMatrix2fv(program, name, value) { this.gl.uniformMatrix2fv(this.getUniformLocation(program, name), false, value); }
    setUniformMatrix3fv(program, name, value) { this.gl.uniformMatrix3fv(this.getUniformLocation(program, name), false, value); }
    setUniformMatrix4fv(program, name, value) { this.gl.uniformMatrix4fv(this.getUniformLocation(program, name), false, value); }
    setUniform1fv(program, name, value) { this.gl.uniform1fv(this.getUniformLocation(program, name), value); }
    setUniform2fv(program, name, value) { this.gl.uniform2fv(this.getUniformLocation(program, name), value); }
    setUniform3fv(program, name, value) { this.gl.uniform3fv(this.getUniformLocation(program, name), value); }
    setUniform4fv(program, name, value) { this.gl.uniform4fv(this.getUniformLocation(program, name), value); }

    getProgramCount() { return this.programs.size; }
    deleteProgram(program) {
      this.gl.deleteProgram(program);
      this.programs.forEach((p, key) => { if (p === program) this.programs.delete(key); });
      this.uniformCache.delete(program);
      this.attributeCache.delete(program);
    }
    clear() {
      for (const program of this.programs.values()) this.gl.deleteProgram(program);
      this.programs.clear();
      this.uniformCache.clear();
      this.attributeCache.clear();
    }
  }

  // ============================================================
  // 缓冲管理器
  // ============================================================
  class BufferManager {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.buffers = new Map();
      this.nextId = 1;
      this.totalMemory = 0;
    }

    createBuffer(target, data, usage = 35044) {
      const id = this.nextId++;
      const buffer = this.gl.createBuffer();
      this.gl.bindBuffer(target, buffer);
      if (data) this.gl.bufferData(target, data, usage);
      const info = {
        id, buffer, target, usage,
        size: data ? data.byteLength : 0,
        count: data ? data.length : 0,
        type: this._detectType(data)
      };
      this.buffers.set(id, info);
      this.totalMemory += info.size;
      return id;
    }

    _detectType(data) {
      if (data instanceof Float32Array) return 5126;
      if (data instanceof Uint16Array) return 5123;
      if (data instanceof Uint32Array) return 5125;
      if (data instanceof Int16Array) return 5122;
      if (data instanceof Int8Array) return 5120;
      if (data instanceof Uint8Array) return 5121;
      return 5126;
    }

    updateBuffer(id, data, offset = 0) {
      const info = this.buffers.get(id);
      if (!info) return;
      this.gl.bindBuffer(info.target, info.buffer);
      this.gl.bufferSubData(info.target, offset, data);
      info.size = Math.max(info.size, offset + data.byteLength);
      info.count = Math.max(info.count, offset / (data.BYTES_PER_ELEMENT || 4) + data.length);
    }

    bindBuffer(id) {
      const info = this.buffers.get(id);
      if (info) this.gl.bindBuffer(info.target, info.buffer);
    }

    unbindBuffer(target) { this.gl.bindBuffer(target, null); }

    deleteBuffer(id) {
      const info = this.buffers.get(id);
      if (info) {
        this.gl.deleteBuffer(info.buffer);
        this.totalMemory -= info.size;
        this.buffers.delete(id);
      }
    }

    getBufferInfo(id) { return this.buffers.get(id); }
    getBuffer(id) { return this.buffers.get(id)?.buffer; }
    getTotalMemory() { return this.totalMemory; }
    getBufferCount() { return this.buffers.size; }
    clear() {
      for (const info of this.buffers.values()) this.gl.deleteBuffer(info.buffer);
      this.buffers.clear();
      this.totalMemory = 0;
    }
  }

  // ============================================================
  // 纹理管理器
  // ============================================================
  class TextureManager {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.textures = new Map();
      this.nextId = 1;
      this.totalMemory = 0;
      this.boundTextures = new Map();
      this.maxTextureUnits = glContext.getCapabilities().maxTextureImageUnits;
    }

    createTexture(options = {}) {
      const id = this.nextId++;
      const target = options.target || 3553;
      const texture = this.gl.createTexture();
      const info = {
        id, texture, target,
        width: options.width || 0,
        height: options.height || 0,
        depth: options.depth || 0,
        format: options.format || 6408,
        internalFormat: options.internalFormat || 6408,
        type: options.type || 5121,
        minFilter: options.minFilter || 9729,
        magFilter: options.magFilter || 9729,
        wrapS: options.wrapS || 10497,
        wrapT: options.wrapT || 10497,
        wrapR: options.wrapR || 10497,
        generateMipmaps: options.generateMipmaps !== false,
        mipmaps: options.generateMipmaps !== false,
        anisotropy: options.anisotropy || 1,
        size: 0,
        image: null
      };
      this.textures.set(id, info);
      this.bindTexture(id, 0);
      this._applyParameters(info);
      return id;
    }

    uploadTexture(id, image, options = {}) {
      const info = this.textures.get(id);
      if (!info) return;
      this.bindTexture(id, 0);
      const target = info.target;
      if (target === 3553) {
        this.gl.texImage2D(target, 0, info.internalFormat, info.format, info.type, image);
        info.width = image.width || image.videoWidth;
        info.height = image.height || image.videoHeight;
      } else if (target === 34067) {
        for (let face = 0; face < 6; face++) {
          if (image[face]) this.gl.texImage2D(34069 + face, 0, info.internalFormat, info.format, info.type, image[face]);
        }
        info.width = image[0]?.width || 0;
        info.height = image[0]?.height || 0;
      }
      if (info.generateMipmaps && this._isPowerOfTwo(info.width) && this._isPowerOfTwo(info.height)) {
        this.gl.generateMipmap(target);
        info.mipmaps = true;
      }
      info.size = this._calculateSize(info);
      this.totalMemory += info.size;
      info.image = image;
    }

    uploadTextureData(id, width, height, data, options = {}) {
      const info = this.textures.get(id);
      if (!info) return;
      this.bindTexture(id, 0);
      this.gl.texImage2D(info.target, 0, info.internalFormat, width, height, 0, info.format, info.type, data);
      info.width = width;
      info.height = height;
      if (info.generateMipmaps && this._isPowerOfTwo(width) && this._isPowerOfTwo(height)) {
        this.gl.generateMipmap(info.target);
      }
      info.size = this._calculateSize(info);
      this.totalMemory += info.size;
    }

    _applyParameters(info) {
      const gl = this.gl;
      gl.texParameteri(info.target, gl.TEXTURE_MIN_FILTER, info.minFilter);
      gl.texParameteri(info.target, gl.TEXTURE_MAG_FILTER, info.magFilter);
      gl.texParameteri(info.target, gl.TEXTURE_WRAP_S, info.wrapS);
      gl.texParameteri(info.target, gl.TEXTURE_WRAP_T, info.wrapT);
      if (info.target === 35866) gl.texParameteri(info.target, gl.TEXTURE_WRAP_R, info.wrapR);
    }

    _isPowerOfTwo(x) { return (x & (x - 1)) === 0 && x !== 0; }

    _calculateSize(info) {
      const bytesPerPixel = this._getBytesPerPixel(info.format, info.type);
      let size = info.width * info.height * bytesPerPixel;
      if (info.mipmaps) size = Math.floor(size * 1.333);
      if (info.target === 34067) size *= 6;
      return size;
    }

    _getBytesPerPixel(format, type) {
      const formatMap = { 6406: 1, 6407: 3, 6408: 4, 6410: 2, 6413: 2, 36249: 1, 36250: 2, 36251: 3, 36252: 4 };
      const typeMultiplier = { 5121: 1, 5123: 2, 5125: 4, 5126: 4, 36193: 2, 36195: 4 };
      return (formatMap[format] || 4) * (typeMultiplier[type] || 1);
    }

    bindTexture(id, unit = 0) {
      const info = this.textures.get(id);
      if (!info) return;
      if (this.boundTextures.get(unit) !== id) {
        this.gl.activeTexture(33984 + unit);
        this.gl.bindTexture(info.target, info.texture);
        this.boundTextures.set(unit, id);
      }
    }

    unbindTexture(unit = 0) {
      this.gl.activeTexture(33984 + unit);
      this.gl.bindTexture(3553, null);
      this.boundTextures.delete(unit);
    }

    setTextureParameters(id, params) {
      const info = this.textures.get(id);
      if (!info) return;
      Object.assign(info, params);
      this.bindTexture(id, 0);
      this._applyParameters(info);
    }

    generateMipmaps(id) {
      const info = this.textures.get(id);
      if (!info) return;
      this.bindTexture(id, 0);
      this.gl.generateMipmap(info.target);
      info.mipmaps = true;
    }

    deleteTexture(id) {
      const info = this.textures.get(id);
      if (info) {
        this.gl.deleteTexture(info.texture);
        this.totalMemory -= info.size;
        this.textures.delete(id);
        this.boundTextures.forEach((tid, unit) => { if (tid === id) this.boundTextures.delete(unit); });
      }
    }

    getTextureInfo(id) { return this.textures.get(id); }
    getTexture(id) { return this.textures.get(id)?.texture; }
    getTotalMemory() { return this.totalMemory; }
    getTextureCount() { return this.textures.size; }
    clear() {
      for (const info of this.textures.values()) this.gl.deleteTexture(info.texture);
      this.textures.clear();
      this.boundTextures.clear();
      this.totalMemory = 0;
    }
  }

  // ============================================================
  // 帧缓冲管理器
  // ============================================================
  class FramebufferManager {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.framebuffers = new Map();
      this.renderbuffers = new Map();
      this.nextId = 1;
      this.currentFramebuffer = null;
      this.defaultFramebuffer = null;
    }

    createFramebuffer(width, height, options = {}) {
      const id = this.nextId++;
      const framebuffer = this.gl.createFramebuffer();
      const info = {
        id, framebuffer, width, height,
        colorAttachments: [],
        depthAttachment: null,
        stencilAttachment: null,
        status: 0
      };
      this.gl.bindFramebuffer(36160, framebuffer);
      if (options.color !== false) {
        const colorTexture = this._createColorTexture(width, height, options);
        info.colorAttachments.push(colorTexture);
        this.gl.framebufferTexture2D(36160, 36064, 3553, colorTexture.texture, 0);
      }
      if (options.depth !== false) {
        const depthRenderbuffer = this.gl.createRenderbuffer();
        this.gl.bindRenderbuffer(36161, depthRenderbuffer);
        this.gl.renderbufferStorage(36161, options.depthFormat || 33189, width, height);
        this.gl.framebufferRenderbuffer(36160, 36096, 36161, depthRenderbuffer);
        info.depthAttachment = { renderbuffer: depthRenderbuffer, format: options.depthFormat || 33189 };
      }
      info.status = this.gl.checkFramebufferStatus(36160);
      this.gl.bindFramebuffer(36160, null);
      this.framebuffers.set(id, info);
      return id;
    }

    _createColorTexture(width, height, options = {}) {
      const texture = this.gl.createTexture();
      this.gl.bindTexture(3553, texture);
      this.gl.texImage2D(3553, 0, options.internalFormat || 32856, width, height, 0, options.format || 6408, options.type || 5121, null);
      this.gl.texParameteri(3553, 3553, 9728);
      this.gl.texParameteri(3553, 3554, 9728);
      this.gl.texParameteri(3553, 10242, 33071);
      this.gl.texParameteri(3553, 10243, 33071);
      return { texture, width, height, format: options.format || 6408, type: options.type || 5121 };
    }

    bindFramebuffer(id) {
      const info = id ? this.framebuffers.get(id) : null;
      const fb = info ? info.framebuffer : null;
      if (this.currentFramebuffer !== id) {
        this.gl.bindFramebuffer(36160, fb);
        if (info) this.gl.viewport(0, 0, info.width, info.height);
        this.currentFramebuffer = id;
      }
    }

    unbindFramebuffer() {
      this.gl.bindFramebuffer(36160, null);
      this.currentFramebuffer = null;
    }

    checkStatus(id) {
      const info = this.framebuffers.get(id);
      if (!info) return 0;
      this.bindFramebuffer(id);
      info.status = this.gl.checkFramebufferStatus(36160);
      return info.status;
    }

    blitFramebuffer(srcId, dstId, srcX, srcY, srcW, srcH, dstX, dstY, dstW, dstH, mask = 16384, filter = 9728) {
      const src = this.framebuffers.get(srcId);
      const dst = dstId ? this.framebuffers.get(dstId) : null;
      this.gl.bindFramebuffer(36008, src ? src.framebuffer : null);
      this.gl.bindFramebuffer(36009, dst ? dst.framebuffer : null);
      this.gl.blitFramebuffer(srcX, srcY, srcW, srcH, dstX, dstY, dstW, dstH, mask, filter);
      this.bindFramebuffer(this.currentFramebuffer);
    }

    getColorTexture(id, attachment = 0) {
      const info = this.framebuffers.get(id);
      return info && info.colorAttachments[attachment] ? info.colorAttachments[attachment].texture : null;
    }

    getFramebufferInfo(id) { return this.framebuffers.get(id); }
    deleteFramebuffer(id) {
      const info = this.framebuffers.get(id);
      if (info) {
        this.gl.deleteFramebuffer(info.framebuffer);
        for (const att of info.colorAttachments) this.gl.deleteTexture(att.texture);
        if (info.depthAttachment) this.gl.deleteRenderbuffer(info.depthAttachment.renderbuffer);
        if (info.stencilAttachment) this.gl.deleteRenderbuffer(info.stencilAttachment.renderbuffer);
        this.framebuffers.delete(id);
      }
    }
    clear() {
      for (const id of this.framebuffers.keys()) this.deleteFramebuffer(id);
      for (const rb of this.renderbuffers.values()) this.gl.deleteRenderbuffer(rb);
      this.renderbuffers.clear();
    }
  }

  // ============================================================
  // 顶点数组对象
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
  const AdvancedMath = {
    decomposeMatrix(matrix) {
      const m = matrix;
      const translation = [m[12], m[13], m[14]];
      const scale = [
        Math.sqrt(m[0]*m[0] + m[1]*m[1] + m[2]*m[2]),
        Math.sqrt(m[4]*m[4] + m[5]*m[5] + m[6]*m[6]),
        Math.sqrt(m[8]*m[8] + m[9]*m[9] + m[10]*m[10])
      ];
      const rotationMatrix = new Float32Array(9);
      rotationMatrix[0] = m[0]/scale[0]; rotationMatrix[1] = m[1]/scale[0]; rotationMatrix[2] = m[2]/scale[0];
      rotationMatrix[3] = m[4]/scale[1]; rotationMatrix[4] = m[5]/scale[1]; rotationMatrix[5] = m[6]/scale[1];
      rotationMatrix[6] = m[8]/scale[2]; rotationMatrix[7] = m[9]/scale[2]; rotationMatrix[8] = m[10]/scale[2];
      const rotation = this.matrixToQuat(rotationMatrix);
      return { translation, rotation, scale };
    },

    matrixToQuat(m) {
      const trace = m[0] + m[4] + m[8];
      let x, y, z, w;
      if (trace > 0) {
        const s = 0.5 / Math.sqrt(trace + 1);
        w = 0.25 / s; x = (m[5] - m[7]) * s; y = (m[6] - m[2]) * s; z = (m[1] - m[3]) * s;
      } else if (m[0] > m[4] && m[0] > m[8]) {
        const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8]);
        w = (m[5] - m[7]) / s; x = 0.25 * s; y = (m[3] + m[1]) / s; z = (m[6] + m[2]) / s;
      } else if (m[4] > m[8]) {
        const s = 2 * Math.sqrt(1 + m[4] - m[0] - m[8]);
        w = (m[6] - m[2]) / s; x = (m[3] + m[1]) / s; y = 0.25 * s; z = (m[7] + m[5]) / s;
      } else {
        const s = 2 * Math.sqrt(1 + m[8] - m[0] - m[4]);
        w = (m[1] - m[3]) / s; x = (m[6] + m[2]) / s; y = (m[7] + m[5]) / s; z = 0.25 * s;
      }
      return [x, y, z, w];
    },

    quatToMatrix(q) {
      const [x, y, z, w] = q;
      const x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2;
      const yy = y * y2, yz = y * z2, zz = z * z2;
      const wx = w * x2, wy = w * y2, wz = w * z2;
      const m = new Float32Array(16);
      m[0] = 1 - (yy + zz); m[1] = xy + wz; m[2] = xz - wy; m[3] = 0;
      m[4] = xy - wz; m[5] = 1 - (xx + zz); m[6] = yz + wx; m[7] = 0;
      m[8] = xz + wy; m[9] = yz - wx; m[10] = 1 - (xx + yy); m[11] = 0;
      m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
      return m;
    },

    eulerToQuat(x, y, z, order = 'XYZ') {
      const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
      const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
      if (order === 'XYZ') return [s1*c2*c3 + c1*s2*s3, c1*s2*c3 - s1*c2*s3, c1*c2*s3 + s1*s2*c3, c1*c2*c3 - s1*s2*s3];
      if (order === 'YXZ') return [s1*c2*c3 + c1*s2*s3, c1*s2*c3 - s1*c2*s3, c1*c2*s3 - s1*s2*c3, c1*c2*c3 + s1*s2*s3];
      if (order === 'ZXY') return [s1*c2*c3 - c1*s2*s3, c1*s2*c3 + s1*c2*s3, c1*c2*s3 + s1*s2*c3, c1*c2*c3 - s1*s2*s3];
      if (order === 'ZYX') return [s1*c2*c3 - c1*s2*s3, c1*s2*c3 + s1*c2*s3, c1*c2*s3 - s1*s2*c3, c1*c2*c3 + s1*s2*s3];
      if (order === 'YZX') return [s1*c2*c3 + c1*s2*s3, c1*s2*c3 + s1*c2*s3, c1*c2*s3 - s1*s2*c3, c1*c2*c3 - s1*s2*s3];
      return [s1*c2*c3 + c1*s2*s3, c1*s2*c3 - s1*c2*s3, c1*c2*s3 + s1*s2*c3, c1*c2*c3 - s1*s2*s3];
    },

    quatToEuler(q, order = 'XYZ') {
      const [x, y, z, w] = q;
      const m = this.quatToMatrix(q);
      if (order === 'XYZ') {
        return [
          Math.atan2(m[6], m[10]),
          Math.asin(Math.max(-1, Math.min(1, -m[2]))),
          Math.atan2(m[1], m[0])
        ];
      }
      return [Math.atan2(m[6], m[10]), Math.asin(-m[2]), Math.atan2(m[1], m[0])];
    },

    slerp(a, b, t) {
      let dot = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
      let b2 = [...b];
      if (dot < 0) { b2 = b2.map(v => -v); dot = -dot; }
      if (dot > 0.9995) return a.map((v, i) => v + (b2[i] - v) * t);
      const theta0 = Math.acos(dot), theta = theta0 * t;
      const sinTheta = Math.sin(theta), sinTheta0 = Math.sin(theta0);
      const s0 = Math.cos(theta) - dot * sinTheta / sinTheta0, s1 = sinTheta / sinTheta0;
      return a.map((v, i) => v * s0 + b2[i] * s1);
    },

    nlerp(a, b, t) {
      const result = a.map((v, i) => v + (b[i] - v) * t);
      const len = Math.sqrt(result[0]**2 + result[1]**2 + result[2]**2 + result[3]**2) || 1;
      return result.map(v => v / len);
    },

    lookAt(eye, target, up) {
      const z = this.normalize([eye[0]-target[0], eye[1]-target[1], eye[2]-target[2]]);
      const x = this.normalize(this.cross(up, z));
      const y = this.cross(z, x);
      const m = new Float32Array(16);
      m[0]=x[0]; m[1]=y[0]; m[2]=z[0]; m[3]=0;
      m[4]=x[1]; m[5]=y[1]; m[6]=z[1]; m[7]=0;
      m[8]=x[2]; m[9]=y[2]; m[10]=z[2]; m[11]=0;
      m[12]=-(x[0]*eye[0]+x[1]*eye[1]+x[2]*eye[2]);
      m[13]=-(y[0]*eye[0]+y[1]*eye[1]+y[2]*eye[2]);
      m[14]=-(z[0]*eye[0]+z[1]*eye[1]+z[2]*eye[2]);
      m[15]=1;
      return m;
    },

    perspective(fovy, aspect, near, far) {
      const f = 1.0 / Math.tan(fovy / 2);
      const m = new Float32Array(16);
      m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far);
      m[11] = -1; m[14] = (2 * far * near) / (near - far);
      return m;
    },

    orthographic(left, right, bottom, top, near, far) {
      const m = new Float32Array(16);
      m[0] = 2 / (right - left); m[5] = 2 / (top - bottom); m[10] = -2 / (far - near);
      m[12] = -(right + left) / (right - left); m[13] = -(top + bottom) / (top - bottom);
      m[14] = -(far + near) / (far - near); m[15] = 1;
      return m;
    },

    normalize(v) { const l = Math.sqrt(v[0]**2+v[1]**2+v[2]**2)||1; return [v[0]/l, v[1]/l, v[2]/l]; },
    cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; },
    dot(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; },
    lerp(a, b, t) { return a + (b - a) * t; },
    clamp(v, min, max) { return Math.max(min, Math.min(max, v)); },
    smoothstep(edge0, edge1, x) { const t = this.clamp((x-edge0)/(edge1-edge0), 0, 1); return t*t*(3-2*t); },
    degreesToRadians(d) { return d * Math.PI / 180; },
    radiansToDegrees(r) { return r * 180 / Math.PI; }
  };

  // ============================================================
  // 几何体生成器
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
    WebGLContext, ShaderCompiler, BufferManager, TextureManager,
    FramebufferManager, VertexArrayObject, UniformBufferObject,
    GPUInstancing, AdvancedMath, GeometryGenerator
  };
})();

if (typeof window !== 'undefined') window.WebGLCore = WebGLCore;
if (typeof globalThis !== 'undefined') globalThis.WebGLCore = WebGLCore;
