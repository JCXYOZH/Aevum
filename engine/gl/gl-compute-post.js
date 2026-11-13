/**
 * WebGL核心扩展 - 计算着色器模拟/实例化渲染/高级纹理/帧缓冲管理/后处理管线
 * 纯WebGL2，零第三方依赖
 * @version 2.0.0
 */
'use strict';

const WebGLCoreExt = (function () {

  // ============================================================
  // 计算着色器模拟器（WebGL2无compute shader，用变换反馈模拟）
  // ============================================================
  class ComputeSimulator {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.programs = new Map();
      this.transformFeedbacks = new Map();
      this.uniforms = new Map();
      this.buffers = new Map();
      this.maxWorkGroups = [64, 64, 64];
      this.workGroupSize = [256, 1, 1];
      this.supported = true;
      this._checkSupport();
    }

    _checkSupport() {
      const gl = this.gl;
      const ext = gl.getExtension('WEBGL_transform_feedback');
      if (!ext) {
        console.warn('Transform feedback not supported, compute simulation will be limited');
        this.supported = false;
      }
    }

    createComputeProgram(name, vertexShader, varyings) {
      const gl = this.gl;
      const vs = gl.createShader(35633);
      gl.shaderSource(vs, vertexShader);
      gl.compileShader(vs);
      if (!gl.getShaderParameter(vs, 35713)) {
        throw new Error('Compute vertex shader compile error: ' + gl.getShaderInfoLog(vs));
      }
      const fs = gl.createShader(35632);
      gl.shaderSource(fs, '#version 300 es\nprecision highp float;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }');
      gl.compileShader(fs);
      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.transformFeedbackVaryings(program, varyings, 35981);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, 35714)) {
        throw new Error('Compute program link error: ' + gl.getProgramInfoLog(program));
      }
      this.programs.set(name, program);
      return program;
    }

    createBuffer(name, data, usage = 35048) {
      const gl = this.gl;
      const buffer = gl.createBuffer();
      gl.bindBuffer(34962, buffer);
      gl.bufferData(34962, data, usage);
      this.buffers.set(name, buffer);
      return buffer;
    }

    createTransformFeedback(name, buffers, indices) {
      const gl = this.gl;
      const tf = gl.createTransformFeedback();
      gl.bindTransformFeedback(36386, tf);
      for (let i = 0; i < buffers.length; i++) {
        gl.bindBufferBase(35982, indices ? indices[i] : i, buffers[i]);
      }
      gl.bindTransformFeedback(36386, null);
      this.transformFeedbacks.set(name, tf);
      return tf;
    }

    dispatch(programName, transformFeedbackName, count, uniforms = {}) {
      if (!this.supported) return;
      const gl = this.gl;
      const program = this.programs.get(programName);
      const tf = this.transformFeedbacks.get(transformFeedbackName);
      if (!program || !tf) return;
      gl.useProgram(program);
      for (const [name, value] of Object.entries(uniforms)) {
        const loc = gl.getUniformLocation(program, name);
        if (loc) {
          if (Array.isArray(value)) {
            if (value.length === 2) gl.uniform2fv(loc, value);
            else if (value.length === 3) gl.uniform3fv(loc, value);
            else if (value.length === 4) gl.uniform4fv(loc, value);
            else if (value.length === 9) gl.uniformMatrix3fv(loc, false, value);
            else if (value.length === 16) gl.uniformMatrix4fv(loc, false, value);
          } else {
            gl.uniform1f(loc, value);
          }
        }
      }
      gl.enable(3089);
      gl.rasterizerDiscard?.(true);
      gl.bindTransformFeedback(36386, tf);
      gl.beginTransformFeedback(0);
      gl.drawArrays(0, 0, count);
      gl.endTransformFeedback();
      gl.bindTransformFeedback(36386, null);
      gl.rasterizerDiscard?.(false);
      gl.disable(3089);
    }

    readBuffer(name, offset, length) {
      const gl = this.gl;
      const buffer = this.buffers.get(name);
      if (!buffer) return null;
      gl.bindBuffer(34962, buffer);
      const data = new Float32Array(length);
      gl.getBufferSubData(34962, offset, data);
      return data;
    }

    setWorkGroupSize(x, y = 1, z = 1) {
      this.workGroupSize = [x, y, z];
    }

    getMaxWorkGroups() { return [...this.maxWorkGroups]; }

    isSupported() { return this.supported; }

    dispose() {
      const gl = this.gl;
      for (const program of this.programs.values()) gl.deleteProgram(program);
      for (const buffer of this.buffers.values()) gl.deleteBuffer(buffer);
      for (const tf of this.transformFeedbacks.values()) gl.deleteTransformFeedback(tf);
      this.programs.clear();
      this.buffers.clear();
      this.transformFeedbacks.clear();
    }
  }

  // ============================================================
  // 实例化渲染器
  // ============================================================
  class InstancedRenderer {
    constructor(glContext, shaderCompiler) {
      this.gl = glContext.getContext();
      this.shaderCompiler = shaderCompiler;
      this.program = null;
      this.instances = new Map();
      this.maxInstances = 100000;
      this.instanceBuffers = new Map();
      this.initialized = false;
      this.drawCalls = 0;
      this.instancesRendered = 0;
    }

    init(vertexShader, fragmentShader) {
      this.program = this.shaderCompiler.compile(vertexShader, fragmentShader);
      this.initialized = true;
    }

    addInstanceBatch(name, geometry, instanceData, attributes) {
      const gl = this.gl;
      const batch = {
        geometry,
        instanceData,
        attributes,
        instanceCount: instanceData.length / attributes.reduce((sum, a) => sum + a.size, 0),
        vertexBuffer: gl.createBuffer(),
        indexBuffer: gl.createBuffer(),
        instanceBuffer: gl.createBuffer(),
        visible: true
      };
      gl.bindBuffer(34962, batch.vertexBuffer);
      gl.bufferData(34962, geometry.vertices, 35044);
      gl.bindBuffer(34963, batch.indexBuffer);
      gl.bufferData(34963, geometry.indices, 35044);
      gl.bindBuffer(34962, batch.instanceBuffer);
      gl.bufferData(34962, instanceData, 35048);
      this.instances.set(name, batch);
      return batch;
    }

    updateInstanceData(name, instanceData) {
      const batch = this.instances.get(name);
      if (!batch) return;
      const gl = this.gl;
      gl.bindBuffer(34962, batch.instanceBuffer);
      gl.bufferSubData(34962, 0, instanceData);
      batch.instanceData = instanceData;
      batch.instanceCount = instanceData.length / batch.attributes.reduce((sum, a) => sum + a.size, 0);
    }

    render(camera, lights, uniforms = {}) {
      if (!this.initialized) return;
      const gl = this.gl;
      this.drawCalls = 0;
      this.instancesRendered = 0;
      this.shaderCompiler.use(this.program);
      for (const [name, batch] of this.instances) {
        if (!batch.visible || batch.instanceCount === 0) continue;
        const stride = batch.attributes.reduce((sum, a) => sum + a.size, 0) * 4;
        gl.bindBuffer(34962, batch.vertexBuffer);
        const posLoc = this.shaderCompiler.getAttributeLocation(this.program, 'position');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 3, 5126, false, geometry.vertexStride || 32, 0);
        let offset = 0;
        for (const attr of batch.attributes) {
          const loc = this.shaderCompiler.getAttributeLocation(this.program, attr.name);
          gl.bindBuffer(34962, batch.instanceBuffer);
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, attr.size, 5126, false, stride, offset);
          gl.vertexAttribDivisor(loc, 1);
          offset += attr.size * 4;
        }
        gl.bindBuffer(34963, batch.indexBuffer);
        for (const [uniformName, value] of Object.entries(uniforms)) {
          const loc = this.shaderCompiler.getUniformLocation(this.program, uniformName);
          if (loc) {
            if (Array.isArray(value)) {
              if (value.length === 16) gl.uniformMatrix4fv(loc, false, value);
              else if (value.length === 3) gl.uniform3fv(loc, value);
              else if (value.length === 4) gl.uniform4fv(loc, value);
            } else {
              gl.uniform1f(loc, value);
            }
          }
        }
        gl.drawElementsInstanced(4, batch.geometry.indices.length, 5125, 0, batch.instanceCount);
        this.drawCalls++;
        this.instancesRendered += batch.instanceCount;
      }
    }

    setBatchVisible(name, visible) {
      const batch = this.instances.get(name);
      if (batch) batch.visible = visible;
    }

    removeBatch(name) {
      const batch = this.instances.get(name);
      if (batch) {
        const gl = this.gl;
        gl.deleteBuffer(batch.vertexBuffer);
        gl.deleteBuffer(batch.indexBuffer);
        gl.deleteBuffer(batch.instanceBuffer);
        this.instances.delete(name);
      }
    }

    getBatchCount() { return this.instances.size; }

    getTotalInstances() {
      let total = 0;
      for (const batch of this.instances.values()) total += batch.instanceCount;
      return total;
    }

    getStats() { return { drawCalls: this.drawCalls, instancesRendered: this.instancesRendered, batches: this.instances.size }; }

    clear() {
      for (const name of this.instances.keys()) this.removeBatch(name);
    }

    dispose() { this.clear(); this.initialized = false; }
  }

  // ============================================================
  // 高级纹理管理器
  // ============================================================
  class AdvancedTextureManager {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.textures = new Map();
      this.samplers = new Map();
      this.maxTextureSize = 0;
      this.maxArrayTextureLayers = 0;
      this.maxCubemapSize = 0;
      this.anisotropyExtension = null;
      this.maxAnisotropy = 1;
      this._initLimits();
    }

    _initLimits() {
      const gl = this.gl;
      this.maxTextureSize = gl.getParameter(3379);
      this.maxArrayTextureLayers = gl.getParameter(35071);
      this.maxCubemapSize = gl.getParameter(34076);
      this.anisotropyExtension = gl.getExtension('EXT_texture_filter_anisotropic');
      if (this.anisotropyExtension) {
        this.maxAnisotropy = gl.getParameter(this.anisotropyExtension.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      }
    }

    createTexture2D(name, width, height, data = null, options = {}) {
      const gl = this.gl;
      const texture = gl.createTexture();
      gl.bindTexture(3553, texture);
      const internalFormat = options.internalFormat || 6408;
      const format = options.format || 6408;
      const type = options.type || 5121;
      gl.texImage2D(3553, 0, internalFormat, width, height, 0, format, type, data);
      gl.texParameteri(3553, 10242, options.wrapS || 10497);
      gl.texParameteri(3553, 10243, options.wrapT || 10497);
      gl.texParameteri(3553, 10241, options.minFilter || 9729);
      gl.texParameteri(3553, 10240, options.magFilter || 9729);
      if (options.generateMipmaps) {
        gl.generateMipmap(3553);
        gl.texParameteri(3553, 10241, 9987);
      }
      if (this.anisotropyExtension && options.anisotropy) {
        gl.texParameterf(3553, this.anisotropyExtension.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(options.anisotropy, this.maxAnisotropy));
      }
      const textureInfo = {
        texture,
        width,
        height,
        type: '2d',
        internalFormat,
        format,
        options
      };
      this.textures.set(name, textureInfo);
      return texture;
    }

    createTextureArray(name, width, height, layers, data = null, options = {}) {
      const gl = this.gl;
      const texture = gl.createTexture();
      gl.bindTexture(35866, texture);
      const internalFormat = options.internalFormat || 6408;
      const format = options.format || 6408;
      const type = options.type || 5121;
      gl.texImage3D(35866, 0, internalFormat, width, height, layers, 0, format, type, data);
      gl.texParameteri(35866, 10242, options.wrapS || 10497);
      gl.texParameteri(35866, 10243, options.wrapT || 10497);
      gl.texParameteri(35866, 35070, options.wrapR || 10497);
      gl.texParameteri(35866, 10241, options.minFilter || 9729);
      gl.texParameteri(35866, 10240, options.magFilter || 9729);
      const textureInfo = {
        texture,
        width,
        height,
        layers,
        type: 'array',
        internalFormat,
        format,
        options
      };
      this.textures.set(name, textureInfo);
      return texture;
    }

    createCubemap(name, size, faces = [], options = {}) {
      const gl = this.gl;
      const texture = gl.createTexture();
      gl.bindTexture(34067, texture);
      const internalFormat = options.internalFormat || 6408;
      const format = options.format || 6408;
      const type = options.type || 5121;
      for (let i = 0; i < 6; i++) {
        gl.texImage2D(34069 + i, 0, internalFormat, size, size, 0, format, type, faces[i] || null);
      }
      gl.texParameteri(34067, 10242, 10497);
      gl.texParameteri(34067, 10243, 10497);
      gl.texParameteri(34067, 10241, options.minFilter || 9729);
      gl.texParameteri(34067, 10240, options.magFilter || 9729);
      const textureInfo = {
        texture,
        size,
        type: 'cubemap',
        internalFormat,
        format,
        options
      };
      this.textures.set(name, textureInfo);
      return texture;
    }

    createRenderTexture(name, width, height, options = {}) {
      const gl = this.gl;
      const texture = gl.createTexture();
      gl.bindTexture(3553, texture);
      const internalFormat = options.internalFormat || 6408;
      gl.texImage2D(3553, 0, internalFormat, width, height, 0, options.format || 6408, options.type || 5121, null);
      gl.texParameteri(3553, 10242, 10497);
      gl.texParameteri(3553, 10243, 10497);
      gl.texParameteri(3553, 10241, options.minFilter || 9729);
      gl.texParameteri(3553, 10240, options.magFilter || 9729);
      const textureInfo = {
        texture,
        width,
        height,
        type: 'render',
        internalFormat,
        options
      };
      this.textures.set(name, textureInfo);
      return texture;
    }

    createDepthTexture(name, width, height, options = {}) {
      const gl = this.gl;
      const texture = gl.createTexture();
      gl.bindTexture(3553, texture);
      gl.texImage2D(3553, 0, 36012, width, height, 0, 6402, 5126, null);
      gl.texParameteri(3553, 10242, 10497);
      gl.texParameteri(3553, 10243, 10497);
      gl.texParameteri(3553, 10241, 9728);
      gl.texParameteri(3553, 10240, 9728);
      const textureInfo = {
        texture,
        width,
        height,
        type: 'depth',
        options
      };
      this.textures.set(name, textureInfo);
      return texture;
    }

    updateTexture2D(name, x, y, width, height, data) {
      const textureInfo = this.textures.get(name);
      if (!textureInfo || textureInfo.type !== '2d') return;
      const gl = this.gl;
      gl.bindTexture(3553, textureInfo.texture);
      gl.texSubImage2D(3553, 0, x, y, width, height, textureInfo.format, 5121, data);
    }

    generateMipmaps(name) {
      const textureInfo = this.textures.get(name);
      if (!textureInfo) return;
      const gl = this.gl;
      gl.bindTexture(textureInfo.type === 'cubemap' ? 34067 : 3553, textureInfo.texture);
      gl.generateMipmap(textureInfo.type === 'cubemap' ? 34067 : 3553);
    }

    bindTexture(name, unit = 0) {
      const textureInfo = this.textures.get(name);
      if (!textureInfo) return;
      const gl = this.gl;
      gl.activeTexture(33984 + unit);
      const target = textureInfo.type === 'cubemap' ? 34067 : textureInfo.type === 'array' ? 35866 : 3553;
      gl.bindTexture(target, textureInfo.texture);
    }

    getTexture(name) {
      return this.textures.get(name)?.texture;
    }

    getTextureInfo(name) {
      return this.textures.get(name);
    }

    deleteTexture(name) {
      const textureInfo = this.textures.get(name);
      if (textureInfo) {
        this.gl.deleteTexture(textureInfo.texture);
        this.textures.delete(name);
      }
    }

    getMaxTextureSize() { return this.maxTextureSize; }
    getMaxAnisotropy() { return this.maxAnisotropy; }
    getTextureCount() { return this.textures.size; }
    getMemoryUsage() {
      let total = 0;
      for (const info of this.textures.values()) {
        let bytes = 4;
        if (info.internalFormat === 6408) bytes = 4;
        else if (info.internalFormat === 6407) bytes = 3;
        else if (info.internalFormat === 36012) bytes = 4;
        total += (info.width || info.size) * (info.height || info.size) * (info.layers || (info.type === 'cubemap' ? 6 : 1)) * bytes;
      }
      return total;
    }
    clear() {
      for (const name of this.textures.keys()) this.deleteTexture(name);
    }
    dispose() { this.clear(); }
  }

  // ============================================================
  // 帧缓冲管理器
  // ============================================================
  class FramebufferManager {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.framebuffers = new Map();
      this.renderbuffers = new Map();
      this.maxColorAttachments = 0;
      this.maxFramebufferWidth = 0;
      this.maxFramebufferHeight = 0;
      this._initLimits();
    }

    _initLimits() {
      const gl = this.gl;
      this.maxColorAttachments = gl.getParameter(36013);
      this.maxFramebufferWidth = gl.getParameter(36010);
      this.maxFramebufferHeight = gl.getParameter(36011);
    }

    createFramebuffer(name, width, height, options = {}) {
      const gl = this.gl;
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(36160, fbo);
      const colorAttachments = options.colorAttachments || 1;
      const drawBuffers = [];
      for (let i = 0; i < colorAttachments; i++) {
        const texture = gl.createTexture();
        gl.bindTexture(3553, texture);
        gl.texImage2D(3553, 0, options.internalFormat || 6408, width, height, 0, options.format || 6408, options.type || 5121, null);
        gl.texParameteri(3553, 10242, 10497);
        gl.texParameteri(3553, 10243, 10497);
        gl.texParameteri(3553, 10241, options.minFilter || 9729);
        gl.texParameteri(3553, 10240, options.magFilter || 9729);
        gl.framebufferTexture2D(36160, 36064 + i, 3553, texture, 0);
        drawBuffers.push(36064 + i);
        if (!fbo.textures) fbo.textures = [];
        fbo.textures.push(texture);
      }
      if (options.depth) {
        const depthTexture = gl.createTexture();
        gl.bindTexture(3553, depthTexture);
        gl.texImage2D(3553, 0, 36012, width, height, 0, 6402, 5126, null);
        gl.texParameteri(3553, 10242, 10497);
        gl.texParameteri(3553, 10243, 10497);
        gl.texParameteri(3553, 10241, 9728);
        gl.texParameteri(3553, 10240, 9728);
        gl.framebufferTexture2D(36160, 36096, 3553, depthTexture, 0);
        fbo.depthTexture = depthTexture;
      }
      if (options.stencil) {
        const stencilRenderbuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(36161, stencilRenderbuffer);
        gl.renderbufferStorage(36161, 36168, width, height);
        gl.framebufferRenderbuffer(36160, 36128, 36161, stencilRenderbuffer);
        fbo.stencilRenderbuffer = stencilRenderbuffer;
      }
      gl.drawBuffers(drawBuffers);
      const status = gl.checkFramebufferStatus(36160);
      if (status !== 36053) {
        console.error('Framebuffer incomplete: ' + status);
      }
      gl.bindFramebuffer(36160, null);
      const fboInfo = {
        framebuffer: fbo,
        width,
        height,
        colorAttachments,
        options,
        textures: fbo.textures,
        depthTexture: fbo.depthTexture,
        stencilRenderbuffer: fbo.stencilRenderbuffer
      };
      this.framebuffers.set(name, fboInfo);
      return fbo;
    }

    bindFramebuffer(name) {
      const fboInfo = this.framebuffers.get(name);
      if (fboInfo) {
        this.gl.bindFramebuffer(36160, fboInfo.framebuffer);
        this.gl.viewport(0, 0, fboInfo.width, fboInfo.height);
      }
    }

    unbindFramebuffer() {
      this.gl.bindFramebuffer(36160, null);
    }

    getColorTexture(name, attachment = 0) {
      const fboInfo = this.framebuffers.get(name);
      return fboInfo?.textures?.[attachment];
    }

    getDepthTexture(name) {
      const fboInfo = this.framebuffers.get(name);
      return fboInfo?.depthTexture;
    }

    resizeFramebuffer(name, width, height) {
      const fboInfo = this.framebuffers.get(name);
      if (!fboInfo) return;
      const gl = this.gl;
      gl.bindFramebuffer(36160, fboInfo.framebuffer);
      for (let i = 0; i < fboInfo.textures.length; i++) {
        gl.bindTexture(3553, fboInfo.textures[i]);
        gl.texImage2D(3553, 0, fboInfo.options.internalFormat || 6408, width, height, 0, fboInfo.options.format || 6408, fboInfo.options.type || 5121, null);
      }
      if (fboInfo.depthTexture) {
        gl.bindTexture(3553, fboInfo.depthTexture);
        gl.texImage2D(3553, 0, 36012, width, height, 0, 6402, 5126, null);
      }
      fboInfo.width = width;
      fboInfo.height = height;
      gl.bindFramebuffer(36160, null);
    }

    deleteFramebuffer(name) {
      const fboInfo = this.framebuffers.get(name);
      if (fboInfo) {
        const gl = this.gl;
        gl.deleteFramebuffer(fboInfo.framebuffer);
        for (const texture of fboInfo.textures) gl.deleteTexture(texture);
        if (fboInfo.depthTexture) gl.deleteTexture(fboInfo.depthTexture);
        if (fboInfo.stencilRenderbuffer) gl.deleteRenderbuffer(fboInfo.stencilRenderbuffer);
        this.framebuffers.delete(name);
      }
    }

    getFramebufferCount() { return this.framebuffers.size; }
    getMaxColorAttachments() { return this.maxColorAttachments; }
    clear() { for (const name of this.framebuffers.keys()) this.deleteFramebuffer(name); }
    dispose() { this.clear(); }
  }

  return {
    ComputeSimulator, InstancedRenderer, AdvancedTextureManager, FramebufferManager
  };
})();

if (typeof window !== 'undefined') window.WebGLCoreExt = WebGLCoreExt;
if (typeof globalThis !== 'undefined') globalThis.WebGLCoreExt = WebGLCoreExt;
