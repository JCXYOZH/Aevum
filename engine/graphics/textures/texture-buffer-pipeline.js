/**
 * WebGL核心 - 渲染管线/纹理管理/缓冲管理/帧缓冲管理/VAO管理
 * 纯WebGL2，零第三方依赖
 * @version 5.0.0
 */
'use strict';

const WebGLCoreV5 = (function () {

  class RenderPipeline {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.passes = [];
      this.currentPass = null;
      this.enabled = true;
      this.stats = { drawCalls: 0, triangles: 0, passes: 0 };
      this.globalState = {
        depthTest: true,
        depthWrite: true,
        cullFace: true,
        blend: false,
        scissorTest: false
      };
    }

    addPass(name, config = {}) {
      const pass = {
        name,
        program: config.program,
        framebuffer: config.framebuffer || null,
        viewport: config.viewport || [0, 0, 0, 0],
        clearColor: config.clearColor || [0, 0, 0, 1],
        clearDepth: config.clearDepth !== undefined ? config.clearDepth : 1,
        clearStencil: config.clearStencil || 0,
        clearMask: config.clearMask || 16640,
        depthTest: config.depthTest !== undefined ? config.depthTest : true,
        depthWrite: config.depthWrite !== undefined ? config.depthWrite : true,
        depthFunc: config.depthFunc || 515,
        cullFace: config.cullFace !== undefined ? config.cullFace : true,
        cullFaceMode: config.cullFaceMode || 1029,
        frontFace: config.frontFace || 2305,
        blend: config.blend || false,
        blendSrc: config.blendSrc || 770,
        blendDst: config.blendDst || 771,
        blendEquation: config.blendEquation || 32774,
        scissorTest: config.scissorTest || false,
        scissor: config.scissor || [0, 0, 0, 0],
        polygonOffset: config.polygonOffset || false,
        polygonOffsetFactor: config.polygonOffsetFactor || 0,
        polygonOffsetUnits: config.polygonOffsetUnits || 0,
        colorMask: config.colorMask || [true, true, true, true],
        uniforms: config.uniforms || {},
        textures: config.textures || [],
        enabled: config.enabled !== false,
        order: this.passes.length
      };
      this.passes.push(pass);
      this.stats.passes++;
      return pass;
    }

    removePass(name) {
      const index = this.passes.findIndex(p => p.name === name);
      if (index !== -1) {
        this.passes.splice(index, 1);
        this.stats.passes--;
      }
    }

    getPass(name) {
      return this.passes.find(p => p.name === name);
    }

    setPassEnabled(name, enabled) {
      const pass = this.getPass(name);
      if (pass) pass.enabled = enabled;
    }

    beginPass(name) {
      const pass = this.getPass(name);
      if (!pass || !pass.enabled) return false;
      this.currentPass = pass;
      const gl = this.gl;
      if (pass.framebuffer) {
        gl.bindFramebuffer(36160, pass.framebuffer);
      } else {
        gl.bindFramebuffer(36160, null);
      }
      if (pass.viewport[2] > 0 && pass.viewport[3] > 0) {
        gl.viewport(pass.viewport[0], pass.viewport[1], pass.viewport[2], pass.viewport[3]);
      }
      gl.clearColor(pass.clearColor[0], pass.clearColor[1], pass.clearColor[2], pass.clearColor[3]);
      gl.clearDepth(pass.clearDepth);
      gl.clearStencil(pass.clearStencil);
      gl.clear(pass.clearMask);
      if (pass.depthTest) gl.enable(2929); else gl.disable(2929);
      gl.depthMask(pass.depthWrite);
      gl.depthFunc(pass.depthFunc);
      if (pass.cullFace) gl.enable(2884); else gl.disable(2884);
      gl.cullFace(pass.cullFaceMode);
      gl.frontFace(pass.frontFace);
      if (pass.blend) gl.enable(3042); else gl.disable(3042);
      gl.blendFunc(pass.blendSrc, pass.blendDst);
      gl.blendEquation(pass.blendEquation);
      if (pass.scissorTest) {
        gl.enable(3089);
        gl.scissor(pass.scissor[0], pass.scissor[1], pass.scissor[2], pass.scissor[3]);
      } else {
        gl.disable(3089);
      }
      if (pass.polygonOffset) {
        gl.enable(32823);
        gl.polygonOffset(pass.polygonOffsetFactor, pass.polygonOffsetUnits);
      } else {
        gl.disable(32823);
      }
      gl.colorMask(pass.colorMask[0], pass.colorMask[1], pass.colorMask[2], pass.colorMask[3]);
      if (pass.program) {
        gl.useProgram(pass.program);
        for (const [name, value] of Object.entries(pass.uniforms)) {
          this._setUniform(pass.program, name, value);
        }
        for (let i = 0; i < pass.textures.length; i++) {
          gl.activeTexture(33984 + i);
          gl.bindTexture(3553, pass.textures[i]);
        }
      }
      return true;
    }

    endPass() {
      this.currentPass = null;
    }

    _setUniform(program, name, value) {
      const gl = this.gl;
      const location = gl.getUniformLocation(program, name);
      if (location === -1) return;
      if (typeof value === 'number') {
        gl.uniform1f(location, value);
      } else if (Array.isArray(value)) {
        if (value.length === 2) gl.uniform2fv(location, value);
        else if (value.length === 3) gl.uniform3fv(location, value);
        else if (value.length === 4) gl.uniform4fv(location, value);
        else if (value.length === 9) gl.uniformMatrix3fv(location, false, value);
        else if (value.length === 16) gl.uniformMatrix4fv(location, false, value);
      } else if (value instanceof Float32Array) {
        if (value.length === 16) gl.uniformMatrix4fv(location, false, value);
        else if (value.length === 9) gl.uniformMatrix3fv(location, false, value);
        else if (value.length === 4) gl.uniform4fv(location, value);
        else if (value.length === 3) gl.uniform3fv(location, value);
        else if (value.length === 2) gl.uniform2fv(location, value);
      }
    }

    draw(mode, first, count) {
      if (!this.currentPass) return;
      this.gl.drawArrays(mode, first, count);
      this.stats.drawCalls++;
      if (mode === 4) this.stats.triangles += count / 3;
    }

    drawElements(mode, count, type, offset) {
      if (!this.currentPass) return;
      this.gl.drawElements(mode, count, type, offset);
      this.stats.drawCalls++;
      if (mode === 4) this.stats.triangles += count / 3;
    }

    execute() {
      if (!this.enabled) return;
      this.stats.drawCalls = 0;
      this.stats.triangles = 0;
      for (const pass of this.passes) {
        if (!pass.enabled) continue;
        this.beginPass(pass.name);
        const callback = pass.callback;
        if (callback) callback(this);
        this.endPass();
      }
    }

    setPassCallback(name, callback) {
      const pass = this.getPass(name);
      if (pass) pass.callback = callback;
    }

    setPassUniform(name, uniformName, value) {
      const pass = this.getPass(name);
      if (pass) pass.uniforms[uniformName] = value;
    }

    setPassTexture(name, index, texture) {
      const pass = this.getPass(name);
      if (pass) pass.textures[index] = texture;
    }

    getPassCount() {
      return this.passes.length;
    }

    getStats() {
      return { ...this.stats };
    }

    resetStats() {
      this.stats = { drawCalls: 0, triangles: 0, passes: this.passes.length };
    }

    setEnabled(v) {
      this.enabled = v;
    }

    isEnabled() {
      return this.enabled;
    }

    clear() {
      this.passes = [];
      this.currentPass = null;
      this.stats = { drawCalls: 0, triangles: 0, passes: 0 };
    }
  }

  class TextureManager {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.textures = new Map();
      this.maxAnisotropy = 1;
      this.stats = { created: 0, deleted: 0, memory: 0, active: 0 };
      this.boundTextures = new Array(16).fill(null);
      this.activeTextureUnit = 0;
    }

    create(name, config = {}) {
      const gl = this.gl;
      const texture = gl.createTexture();
      const target = config.target || 3553;
      const textureInfo = {
        id: texture,
        name,
        target,
        width: config.width || 0,
        height: config.height || 0,
        depth: config.depth || 0,
        format: config.format || 6408,
        internalFormat: config.internalFormat || config.format || 32856,
        type: config.type || 5121,
        levels: config.levels || 1,
        generateMipmaps: config.generateMipmaps !== false,
        minFilter: config.minFilter || 9986,
        magFilter: config.magFilter || 9729,
        wrapS: config.wrapS || 10497,
        wrapT: config.wrapT || 10497,
        wrapR: config.wrapR || 10497,
        anisotropy: config.anisotropy || 1,
        compareMode: config.compareMode || 0,
        compareFunc: config.compareFunc || 513,
        immutable: config.immutable || false,
        memorySize: 0,
        createdAt: Date.now()
      };
      this.bind(textureInfo, 0);
      if (config.data) {
        this.upload(textureInfo, config.data, config.width, config.height);
      } else if (config.width && config.height) {
        this.allocate(textureInfo, config.width, config.height);
      }
      gl.texParameteri(target, 10241, textureInfo.minFilter);
      gl.texParameteri(target, 10240, textureInfo.magFilter);
      gl.texParameteri(target, 10242, textureInfo.wrapS);
      gl.texParameteri(target, 10243, textureInfo.wrapT);
      if (target === 35866) {
        gl.texParameteri(target, 32882, textureInfo.wrapR);
      }
      if (textureInfo.generateMipmaps && textureInfo.width > 0 && textureInfo.height > 0) {
        gl.generateMipmap(target);
      }
      this.textures.set(name, textureInfo);
      this.stats.created++;
      this.stats.active++;
      return textureInfo;
    }

    upload(textureInfo, data, width, height, level = 0) {
      const gl = this.gl;
      this.bind(textureInfo, 0);
      if (textureInfo.target === 3553) {
        gl.texImage2D(3553, level, textureInfo.internalFormat, width, height, 0, textureInfo.format, textureInfo.type, data);
      }
      textureInfo.width = width;
      textureInfo.height = height;
      textureInfo.memorySize = this._calculateMemorySize(textureInfo);
      this.stats.memory += textureInfo.memorySize;
    }

    allocate(textureInfo, width, height, depth = 0) {
      const gl = this.gl;
      this.bind(textureInfo, 0);
      if (textureInfo.target === 3553) {
        gl.texImage2D(3553, 0, textureInfo.internalFormat, width, height, 0, textureInfo.format, textureInfo.type, null);
      }
      textureInfo.width = width;
      textureInfo.height = height;
      textureInfo.depth = depth;
      textureInfo.memorySize = this._calculateMemorySize(textureInfo);
      this.stats.memory += textureInfo.memorySize;
    }

    _calculateMemorySize(textureInfo) {
      let bytesPerPixel = 4;
      if (textureInfo.type === 5126) bytesPerPixel = 16;
      else if (textureInfo.type === 36193) bytesPerPixel = 8;
      else if (textureInfo.type === 33635) bytesPerPixel = 4;
      else if (textureInfo.type === 32819) bytesPerPixel = 4;
      else if (textureInfo.type === 32820) bytesPerPixel = 2;
      let size = textureInfo.width * textureInfo.height * bytesPerPixel;
      if (textureInfo.generateMipmaps) {
        size = size * 4 / 3;
      }
      return Math.floor(size);
    }

    bind(textureInfo, unit = 0) {
      const gl = this.gl;
      if (this.activeTextureUnit !== unit) {
        gl.activeTexture(33984 + unit);
        this.activeTextureUnit = unit;
      }
      if (this.boundTextures[unit] !== textureInfo?.id) {
        gl.bindTexture(textureInfo.target, textureInfo.id);
        this.boundTextures[unit] = textureInfo.id;
      }
    }

    unbind(unit = 0) {
      const gl = this.gl;
      if (this.activeTextureUnit !== unit) {
        gl.activeTexture(33984 + unit);
        this.activeTextureUnit = unit;
      }
      gl.bindTexture(3553, null);
      this.boundTextures[unit] = null;
    }

    get(name) {
      return this.textures.get(name);
    }

    has(name) {
      return this.textures.has(name);
    }

    remove(name) {
      const textureInfo = this.textures.get(name);
      if (textureInfo) {
        this.gl.deleteTexture(textureInfo.id);
        this.stats.memory -= textureInfo.memorySize;
        this.stats.deleted++;
        this.stats.active--;
        this.textures.delete(name);
        for (let i = 0; i < this.boundTextures.length; i++) {
          if (this.boundTextures[i] === textureInfo.id) {
            this.boundTextures[i] = null;
          }
        }
      }
    }

    setFilter(name, minFilter, magFilter) {
      const textureInfo = this.textures.get(name);
      if (!textureInfo) return;
      this.bind(textureInfo, 0);
      this.gl.texParameteri(textureInfo.target, 10241, minFilter);
      this.gl.texParameteri(textureInfo.target, 10240, magFilter);
      textureInfo.minFilter = minFilter;
      textureInfo.magFilter = magFilter;
    }

    setWrap(name, wrapS, wrapT, wrapR) {
      const textureInfo = this.textures.get(name);
      if (!textureInfo) return;
      this.bind(textureInfo, 0);
      this.gl.texParameteri(textureInfo.target, 10242, wrapS);
      this.gl.texParameteri(textureInfo.target, 10243, wrapT);
      if (wrapR && textureInfo.target === 35866) {
        this.gl.texParameteri(textureInfo.target, 32882, wrapR);
      }
      textureInfo.wrapS = wrapS;
      textureInfo.wrapT = wrapT;
      if (wrapR) textureInfo.wrapR = wrapR;
    }

    generateMipmaps(name) {
      const textureInfo = this.textures.get(name);
      if (!textureInfo) return;
      this.bind(textureInfo, 0);
      this.gl.generateMipmap(textureInfo.target);
    }

    getTextureNames() {
      return Array.from(this.textures.keys());
    }

    getTextureCount() {
      return this.textures.size;
    }

    getStats() {
      return {
        ...this.stats,
        memoryMB: (this.stats.memory / (1024 * 1024)).toFixed(2)
      };
    }

    clear() {
      for (const name of this.textures.keys()) {
        this.remove(name);
      }
      this.boundTextures = new Array(16).fill(null);
    }
  }

  class BufferManager {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.buffers = new Map();
      this.stats = { created: 0, deleted: 0, memory: 0, active: 0 };
      this.boundBuffers = new Map();
    }

    create(name, config = {}) {
      const gl = this.gl;
      const buffer = gl.createBuffer();
      const target = config.target || 34962;
      const bufferInfo = {
        id: buffer,
        name,
        target,
        usage: config.usage || 35044,
        size: 0,
        itemSize: config.itemSize || 3,
        itemCount: 0,
        dataType: config.dataType || 5126,
        normalized: config.normalized || false,
        stride: config.stride || 0,
        offset: config.offset || 0,
        memorySize: 0,
        createdAt: Date.now()
      };
      if (config.data) {
        this.upload(bufferInfo, config.data);
      }
      this.buffers.set(name, bufferInfo);
      this.stats.created++;
      this.stats.active++;
      return bufferInfo;
    }

    upload(bufferInfo, data, offset = 0) {
      const gl = this.gl;
      this.bind(bufferInfo);
      if (offset === 0) {
        gl.bufferData(bufferInfo.target, data, bufferInfo.usage);
      } else {
        gl.bufferSubData(bufferInfo.target, offset, data);
      }
      bufferInfo.size = data.byteLength || data.length * 4;
      bufferInfo.itemCount = bufferInfo.size / (bufferInfo.itemSize * this._getTypeSize(bufferInfo.dataType));
      bufferInfo.memorySize = bufferInfo.size;
      this.stats.memory += bufferInfo.size;
    }

    allocate(bufferInfo, size) {
      const gl = this.gl;
      this.bind(bufferInfo);
      gl.bufferData(bufferInfo.target, size, bufferInfo.usage);
      bufferInfo.size = size;
      bufferInfo.memorySize = size;
      this.stats.memory += size;
    }

    _getTypeSize(type) {
      switch (type) {
        case 5120: return 1;
        case 5121: return 1;
        case 5122: return 2;
        case 5123: return 2;
        case 5125: return 4;
        case 5126: return 4;
        default: return 4;
      }
    }

    bind(bufferInfo) {
      if (this.boundBuffers.get(bufferInfo.target) !== bufferInfo.id) {
        this.gl.bindBuffer(bufferInfo.target, bufferInfo.id);
        this.boundBuffers.set(bufferInfo.target, bufferInfo.id);
      }
    }

    unbind(target) {
      this.gl.bindBuffer(target, null);
      this.boundBuffers.delete(target);
    }

    get(name) {
      return this.buffers.get(name);
    }

    has(name) {
      return this.buffers.has(name);
    }

    remove(name) {
      const bufferInfo = this.buffers.get(name);
      if (bufferInfo) {
        this.gl.deleteBuffer(bufferInfo.id);
        this.stats.memory -= bufferInfo.memorySize;
        this.stats.deleted++;
        this.stats.active--;
        this.buffers.delete(name);
        for (const [target, id] of this.boundBuffers) {
          if (id === bufferInfo.id) {
            this.boundBuffers.delete(target);
          }
        }
      }
    }

    setAttribute(bufferInfo, location, itemSize, type, normalized, stride, offset) {
      const gl = this.gl;
      this.bind(bufferInfo);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, itemSize || bufferInfo.itemSize, type || bufferInfo.dataType, normalized || bufferInfo.normalized, stride || bufferInfo.stride, offset || bufferInfo.offset);
    }

    setDivisor(location, divisor) {
      this.gl.vertexAttribDivisor(location, divisor);
    }

    getBufferNames() {
      return Array.from(this.buffers.keys());
    }

    getBufferCount() {
      return this.buffers.size;
    }

    getStats() {
      return {
        ...this.stats,
        memoryMB: (this.stats.memory / (1024 * 1024)).toFixed(2)
      };
    }

    clear() {
      for (const name of this.buffers.keys()) {
        this.remove(name);
      }
      this.boundBuffers.clear();
    }
  }

  class FramebufferManager {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.framebuffers = new Map();
      this.stats = { created: 0, deleted: 0, active: 0 };
      this.boundFramebuffer = null;
      this.boundReadFramebuffer = null;
      this.boundDrawFramebuffer = null;
    }

    create(name, config = {}) {
      const gl = this.gl;
      const framebuffer = gl.createFramebuffer();
      const framebufferInfo = {
        id: framebuffer,
        name,
        width: config.width || 0,
        height: config.height || 0,
        attachments: new Map(),
        drawBuffers: [],
        status: 0,
        createdAt: Date.now()
      };
      this.bind(framebufferInfo);
      if (config.attachments) {
        for (const attachment of config.attachments) {
          this.attach(framebufferInfo, attachment);
        }
      }
      this.framebuffers.set(name, framebufferInfo);
      this.stats.created++;
      this.stats.active++;
      return framebufferInfo;
    }

    attach(framebufferInfo, config) {
      const gl = this.gl;
      this.bind(framebufferInfo);
      const attachmentPoint = config.attachmentPoint || 36064;
      if (config.texture) {
        gl.framebufferTexture2D(36160, attachmentPoint, config.textureTarget || 3553, config.texture, config.level || 0);
      } else if (config.renderbuffer) {
        gl.framebufferRenderbuffer(36160, attachmentPoint, 36161, config.renderbuffer);
      }
      framebufferInfo.attachments.set(attachmentPoint, config);
      if (attachmentPoint >= 36064 && attachmentPoint <= 36079) {
        if (!framebufferInfo.drawBuffers.includes(attachmentPoint)) {
          framebufferInfo.drawBuffers.push(attachmentPoint);
        }
        gl.drawBuffers(framebufferInfo.drawBuffers);
      }
      framebufferInfo.status = gl.checkFramebufferStatus(36160);
    }

    detach(framebufferInfo, attachmentPoint) {
      const gl = this.gl;
      this.bind(framebufferInfo);
      gl.framebufferTexture2D(36160, attachmentPoint, 3553, null, 0);
      framebufferInfo.attachments.delete(attachmentPoint);
      framebufferInfo.drawBuffers = framebufferInfo.drawBuffers.filter(a => a !== attachmentPoint);
      if (framebufferInfo.drawBuffers.length > 0) {
        gl.drawBuffers(framebufferInfo.drawBuffers);
      }
      framebufferInfo.status = gl.checkFramebufferStatus(36160);
    }

    bind(framebufferInfo, target = 36160) {
      const gl = this.gl;
      if (target === 36160) {
        if (this.boundFramebuffer !== framebufferInfo?.id) {
          gl.bindFramebuffer(36160, framebufferInfo?.id || null);
          this.boundFramebuffer = framebufferInfo?.id || null;
        }
      } else if (target === 36008) {
        if (this.boundReadFramebuffer !== framebufferInfo?.id) {
          gl.bindFramebuffer(36008, framebufferInfo?.id || null);
          this.boundReadFramebuffer = framebufferInfo?.id || null;
        }
      } else if (target === 36009) {
        if (this.boundDrawFramebuffer !== framebufferInfo?.id) {
          gl.bindFramebuffer(36009, framebufferInfo?.id || null);
          this.boundDrawFramebuffer = framebufferInfo?.id || null;
        }
      }
    }

    unbind(target = 36160) {
      const gl = this.gl;
      gl.bindFramebuffer(target, null);
      if (target === 36160) this.boundFramebuffer = null;
      else if (target === 36008) this.boundReadFramebuffer = null;
      else if (target === 36009) this.boundDrawFramebuffer = null;
    }

    blit(source, destination, srcX, srcY, srcWidth, srcHeight, dstX, dstY, dstWidth, dstHeight, mask, filter) {
      const gl = this.gl;
      this.bind(source, 36008);
      this.bind(destination, 36009);
      gl.blitFramebuffer(srcX, srcY, srcWidth, srcHeight, dstX, dstY, dstWidth, dstHeight, mask || 16384, filter || 9728);
    }

    checkStatus(framebufferInfo) {
      this.bind(framebufferInfo);
      return this.gl.checkFramebufferStatus(36160);
    }

    get(name) {
      return this.framebuffers.get(name);
    }

    has(name) {
      return this.framebuffers.has(name);
    }

    remove(name) {
      const framebufferInfo = this.framebuffers.get(name);
      if (framebufferInfo) {
        this.gl.deleteFramebuffer(framebufferInfo.id);
        this.stats.deleted++;
        this.stats.active--;
        this.framebuffers.delete(name);
        if (this.boundFramebuffer === framebufferInfo.id) this.boundFramebuffer = null;
        if (this.boundReadFramebuffer === framebufferInfo.id) this.boundReadFramebuffer = null;
        if (this.boundDrawFramebuffer === framebufferInfo.id) this.boundDrawFramebuffer = null;
      }
    }

    getFramebufferNames() {
      return Array.from(this.framebuffers.keys());
    }

    getFramebufferCount() {
      return this.framebuffers.size;
    }

    getStats() {
      return { ...this.stats };
    }

    clear() {
      for (const name of this.framebuffers.keys()) {
        this.remove(name);
      }
      this.boundFramebuffer = null;
      this.boundReadFramebuffer = null;
      this.boundDrawFramebuffer = null;
    }
  }

  return {
    RenderPipeline, TextureManager, BufferManager, FramebufferManager
  };
})();

if (typeof window !== 'undefined') window.WebGLCoreV5 = WebGLCoreV5;
if (typeof globalThis !== 'undefined') globalThis.WebGLCoreV5 = WebGLCoreV5;
