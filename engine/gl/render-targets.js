/**
 * WebGL核心 - 渲染管线/帧缓冲管理/纹理管理/着色器编译/缓冲管理
 * 纯WebGL2，零第三方依赖
 * @version 3.0.0
 */
'use strict';

const WebGLCoreV3 = (function () {

  class RenderPipeline {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.stages = [];
      this.currentStage = 0;
      this.frameBuffers = new Map();
      this.shaders = new Map();
      this.uniforms = new Map();
      this.enabled = true;
      this.stats = {
        drawCalls: 0,
        triangles: 0,
        textureBinds: 0,
        shaderSwitches: 0
      };
    }

    addStage(config) {
      const stage = {
        name: config.name || `stage_${this.stages.length}`,
        type: config.type || 'render',
        shader: config.shader || null,
        frameBuffer: config.frameBuffer || null,
        inputs: config.inputs || [],
        outputs: config.outputs || [],
        enabled: config.enabled !== false,
        clearColor: config.clearColor || [0, 0, 0, 1],
        clearDepth: config.clearDepth !== false,
        viewport: config.viewport || null,
        depthTest: config.depthTest !== false,
        depthWrite: config.depthWrite !== false,
        blend: config.blend || false,
        cullFace: config.cullFace !== false
      };
      this.stages.push(stage);
      return stage;
    }

    removeStage(name) {
      const index = this.stages.findIndex(s => s.name === name);
      if (index !== -1) {
        this.stages.splice(index, 1);
      }
    }

    getStage(name) {
      return this.stages.find(s => s.name === name);
    }

    setStageEnabled(name, enabled) {
      const stage = this.getStage(name);
      if (stage) {
        stage.enabled = enabled;
      }
    }

    execute() {
      if (!this.enabled) return;
      this.stats = { drawCalls: 0, triangles: 0, textureBinds: 0, shaderSwitches: 0 };
      for (let i = 0; i < this.stages.length; i++) {
        const stage = this.stages[i];
        if (!stage.enabled) continue;
        this.currentStage = i;
        this._executeStage(stage);
      }
    }

    _executeStage(stage) {
      const gl = this.gl;
      if (stage.frameBuffer) {
        const fbo = this.frameBuffers.get(stage.frameBuffer);
        if (fbo) {
          gl.bindFramebuffer(36160, fbo);
        }
      } else {
        gl.bindFramebuffer(36160, null);
      }
      if (stage.viewport) {
        gl.viewport(stage.viewport[0], stage.viewport[1], stage.viewport[2], stage.viewport[3]);
      }
      if (stage.clearColor) {
        gl.clearColor(stage.clearColor[0], stage.clearColor[1], stage.clearColor[2], stage.clearColor[3]);
      }
      let clearMask = 0;
      if (stage.clearColor) clearMask |= 16384;
      if (stage.clearDepth) clearMask |= 256;
      if (clearMask) gl.clear(clearMask);
      if (stage.depthTest) gl.enable(2929); else gl.disable(2929);
      gl.depthMask(stage.depthWrite);
      if (stage.blend) {
        gl.enable(3042);
        gl.blendFunc(770, 771);
      } else {
        gl.disable(3042);
      }
      if (stage.cullFace) gl.enable(2884); else gl.disable(2884);
      if (stage.shader) {
        const shader = this.shaders.get(stage.shader);
        if (shader) {
          gl.useProgram(shader.program);
          this.stats.shaderSwitches++;
          this._bindUniforms(shader);
          this._bindTextures(stage.inputs);
        }
      }
    }

    _bindUniforms(shader) {
      const gl = this.gl;
      for (const [name, value] of shader.uniforms) {
        const location = gl.getUniformLocation(shader.program, name);
        if (location === null) continue;
        if (typeof value === 'number') {
          gl.uniform1f(location, value);
        } else if (Array.isArray(value)) {
          if (value.length === 2) gl.uniform2fv(location, value);
          else if (value.length === 3) gl.uniform3fv(location, value);
          else if (value.length === 4) gl.uniform4fv(location, value);
          else if (value.length === 9) gl.uniformMatrix3fv(location, false, value);
          else if (value.length === 16) gl.uniformMatrix4fv(location, false, value);
        }
      }
    }

    _bindTextures(inputs) {
      const gl = this.gl;
      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        if (input.texture) {
          gl.activeTexture(33984 + i);
          gl.bindTexture(3553, input.texture);
          this.stats.textureBinds++;
        }
      }
    }

    addFrameBuffer(name, config) {
      const gl = this.gl;
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(36160, fbo);
      const textures = [];
      const drawBuffers = [];
      for (let i = 0; i < (config.attachments || 1); i++) {
        const texture = gl.createTexture();
        gl.bindTexture(3553, texture);
        gl.texImage2D(3553, 0, config.internalFormat || 34836, config.width || 1024, config.height || 1024, 0, config.format || 6408, config.type || 5126, null);
        gl.texParameteri(3553, 10241, 9729);
        gl.texParameteri(3553, 10240, 9729);
        gl.texParameteri(3553, 10242, 33071);
        gl.texParameteri(3553, 10243, 33071);
        gl.framebufferTexture2D(36160, 36064 + i, 3553, texture, 0);
        textures.push(texture);
        drawBuffers.push(36064 + i);
      }
      if (config.depthBuffer) {
        const depthTexture = gl.createTexture();
        gl.bindTexture(3553, depthTexture);
        gl.texImage2D(3553, 0, 36012, config.width || 1024, config.height || 1024, 0, 36012, 33635, null);
        gl.texParameteri(3553, 10241, 9729);
        gl.texParameteri(3553, 10240, 9729);
        gl.texParameteri(3553, 10242, 33071);
        gl.texParameteri(3553, 10243, 33071);
        gl.framebufferTexture2D(36160, 36096, 3553, depthTexture, 0);
        textures.push(depthTexture);
      }
      gl.drawBuffers(drawBuffers);
      gl.bindFramebuffer(36160, null);
      const frameBuffer = {
        name,
        fbo,
        textures,
        width: config.width || 1024,
        height: config.height || 1024,
        attachments: config.attachments || 1
      };
      this.frameBuffers.set(name, frameBuffer);
      return frameBuffer;
    }

    removeFrameBuffer(name) {
      const fbo = this.frameBuffers.get(name);
      if (fbo) {
        const gl = this.gl;
        gl.deleteFramebuffer(fbo.fbo);
        for (const texture of fbo.textures) {
          gl.deleteTexture(texture);
        }
        this.frameBuffers.delete(name);
      }
    }

    getFrameBuffer(name) {
      return this.frameBuffers.get(name);
    }

    addShader(name, vertexSource, fragmentSource) {
      const gl = this.gl;
      const vs = this._compileShader(35633, vertexSource);
      const fs = this._compileShader(35632, fragmentSource);
      if (!vs || !fs) return null;
      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, 35714)) {
        console.error('Program link error:', gl.getProgramInfoLog(program));
        return null;
      }
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      const shader = {
        name,
        program,
        uniforms: new Map(),
        attributes: new Map()
      };
      this._cacheUniforms(shader);
      this._cacheAttributes(shader);
      this.shaders.set(name, shader);
      return shader;
    }

    _compileShader(type, source) {
      const gl = this.gl;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, 35713)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    _cacheUniforms(shader) {
      const gl = this.gl;
      const count = gl.getProgramParameter(shader.program, 35718);
      for (let i = 0; i < count; i++) {
        const info = gl.getActiveUniform(shader.program, i);
        if (info) {
          const location = gl.getUniformLocation(shader.program, info.name);
          shader.uniforms.set(info.name, { location, type: info.type, size: info.size });
        }
      }
    }

    _cacheAttributes(shader) {
      const gl = this.gl;
      const count = gl.getProgramParameter(shader.program, 35721);
      for (let i = 0; i < count; i++) {
        const info = gl.getActiveAttrib(shader.program, i);
        if (info) {
          const location = gl.getAttribLocation(shader.program, info.name);
          shader.attributes.set(info.name, { location, type: info.type, size: info.size });
        }
      }
    }

    setUniform(shaderName, uniformName, value) {
      const shader = this.shaders.get(shaderName);
      if (shader) {
        shader.uniforms.set(uniformName, value);
      }
    }

    getShader(name) {
      return this.shaders.get(name);
    }

    removeShader(name) {
      const shader = this.shaders.get(name);
      if (shader) {
        this.gl.deleteProgram(shader.program);
        this.shaders.delete(name);
      }
    }

    getStats() {
      return { ...this.stats };
    }

    setEnabled(enabled) {
      this.enabled = enabled;
    }

    getStageCount() {
      return this.stages.length;
    }

    getFrameBufferCount() {
      return this.frameBuffers.size;
    }

    getShaderCount() {
      return this.shaders.size;
    }

    clear() {
      for (const name of this.frameBuffers.keys()) {
        this.removeFrameBuffer(name);
      }
      for (const name of this.shaders.keys()) {
        this.removeShader(name);
      }
      this.stages = [];
    }
  }

  class TextureManager {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.textures = new Map();
      this.samplers = new Map();
      this.currentTextureUnit = 0;
      this.maxTextureUnits = this.gl.getParameter(34930);
      this.stats = {
        totalTextures: 0,
        totalMemory: 0,
        textureBinds: 0
      };
    }

    createTexture(name, config) {
      const gl = this.gl;
      const texture = gl.createTexture();
      const target = config.target || 3553;
      gl.bindTexture(target, texture);
      if (config.image) {
        gl.texImage2D(target, 0, config.internalFormat || 6408, config.format || 6408, config.type || 5121, config.image);
      } else if (config.data) {
        gl.texImage2D(target, 0, config.internalFormat || 6408, config.width || 256, config.height || 256, 0, config.format || 6408, config.type || 5121, config.data);
      } else {
        gl.texImage2D(target, 0, config.internalFormat || 6408, config.width || 256, config.height || 256, 0, config.format || 6408, config.type || 5121, null);
      }
      gl.texParameteri(target, 10241, config.minFilter || 9729);
      gl.texParameteri(target, 10240, config.magFilter || 9729);
      gl.texParameteri(target, 10242, config.wrapS || 33071);
      gl.texParameteri(target, 10243, config.wrapT || 33071);
      if (config.generateMipmaps) {
        gl.generateMipmap(target);
      }
      gl.bindTexture(target, null);
      const textureInfo = {
        name,
        texture,
        target,
        width: config.width || (config.image?.width || 256),
        height: config.height || (config.image?.height || 256),
        format: config.format || 6408,
        type: config.type || 5121,
        internalFormat: config.internalFormat || 6408,
        memorySize: this._estimateMemorySize(config.width || 256, config.height || 256, config.format || 6408, config.type || 5121)
      };
      this.textures.set(name, textureInfo);
      this.stats.totalTextures++;
      this.stats.totalMemory += textureInfo.memorySize;
      return textureInfo;
    }

    _estimateMemorySize(width, height, format, type) {
      let bytesPerPixel = 4;
      if (format === 6407 || format === 33321) bytesPerPixel = 1;
      else if (format === 6409 || format === 33322) bytesPerPixel = 2;
      else if (format === 6410 || format === 33323) bytesPerPixel = 2;
      else if (format === 6408) bytesPerPixel = 3;
      else if (format === 6408 && type === 5126) bytesPerPixel = 12;
      if (type === 5126) bytesPerPixel *= 4;
      else if (type === 33635) bytesPerPixel *= 4;
      return width * height * bytesPerPixel;
    }

    bindTexture(name, unit = 0) {
      const textureInfo = this.textures.get(name);
      if (!textureInfo) return;
      const gl = this.gl;
      gl.activeTexture(33984 + unit);
      gl.bindTexture(textureInfo.target, textureInfo.texture);
      this.stats.textureBinds++;
      this.currentTextureUnit = unit;
    }

    unbindTexture(unit = 0) {
      const gl = this.gl;
      gl.activeTexture(33984 + unit);
      gl.bindTexture(3553, null);
    }

    updateTexture(name, data, x = 0, y = 0, width, height) {
      const textureInfo = this.textures.get(name);
      if (!textureInfo) return;
      const gl = this.gl;
      gl.bindTexture(textureInfo.target, textureInfo.texture);
      gl.texSubImage2D(textureInfo.target, 0, x, y, width || textureInfo.width, height || textureInfo.height, textureInfo.format, textureInfo.type, data);
      gl.bindTexture(textureInfo.target, null);
    }

    generateMipmaps(name) {
      const textureInfo = this.textures.get(name);
      if (!textureInfo) return;
      const gl = this.gl;
      gl.bindTexture(textureInfo.target, textureInfo.texture);
      gl.generateMipmap(textureInfo.target);
      gl.bindTexture(textureInfo.target, null);
    }

    setTextureParameter(name, parameter, value) {
      const textureInfo = this.textures.get(name);
      if (!textureInfo) return;
      const gl = this.gl;
      gl.bindTexture(textureInfo.target, textureInfo.texture);
      gl.texParameteri(textureInfo.target, parameter, value);
      gl.bindTexture(textureInfo.target, null);
    }

    getTexture(name) {
      return this.textures.get(name);
    }

    removeTexture(name) {
      const textureInfo = this.textures.get(name);
      if (textureInfo) {
        this.gl.deleteTexture(textureInfo.texture);
        this.stats.totalMemory -= textureInfo.memorySize;
        this.stats.totalTextures--;
        this.textures.delete(name);
      }
    }

    createSampler(name, config) {
      const gl = this.gl;
      const sampler = gl.createSampler();
      gl.samplerParameteri(sampler, 10241, config.minFilter || 9729);
      gl.samplerParameteri(sampler, 10240, config.magFilter || 9729);
      gl.samplerParameteri(sampler, 10242, config.wrapS || 33071);
      gl.samplerParameteri(sampler, 10243, config.wrapT || 33071);
      if (config.minLod !== undefined) gl.samplerParameterf(sampler, 33082, config.minLod);
      if (config.maxLod !== undefined) gl.samplerParameterf(sampler, 33083, config.maxLod);
      const samplerInfo = { name, sampler };
      this.samplers.set(name, samplerInfo);
      return samplerInfo;
    }

    bindSampler(name, unit = 0) {
      const samplerInfo = this.samplers.get(name);
      if (samplerInfo) {
        this.gl.bindSampler(unit, samplerInfo.sampler);
      }
    }

    unbindSampler(unit = 0) {
      this.gl.bindSampler(unit, null);
    }

    removeSampler(name) {
      const samplerInfo = this.samplers.get(name);
      if (samplerInfo) {
        this.gl.deleteSampler(samplerInfo.sampler);
        this.samplers.delete(name);
      }
    }

    getStats() {
      return { ...this.stats };
    }

    getTextureNames() {
      return Array.from(this.textures.keys());
    }

    getTextureCount() {
      return this.textures.size;
    }

    getMaxTextureUnits() {
      return this.maxTextureUnits;
    }

    clear() {
      for (const name of this.textures.keys()) {
        this.removeTexture(name);
      }
      for (const name of this.samplers.keys()) {
        this.removeSampler(name);
      }
    }
  }

  class BufferManager {
    constructor(glContext) {
      this.gl = glContext.getContext();
      this.buffers = new Map();
      this.vertexArrays = new Map();
      this.currentVAO = null;
      this.stats = {
        totalBuffers: 0,
        totalMemory: 0,
        bufferBinds: 0
      };
    }

    createBuffer(name, config) {
      const gl = this.gl;
      const buffer = gl.createBuffer();
      const target = config.target || 34962;
      gl.bindBuffer(target, buffer);
      if (config.data) {
        gl.bufferData(target, config.data, config.usage || 35044);
      } else if (config.size) {
        gl.bufferData(target, config.size, config.usage || 35044);
      }
      gl.bindBuffer(target, null);
      const bufferInfo = {
        name,
        buffer,
        target,
        usage: config.usage || 35044,
        size: config.size || (config.data?.byteLength || 0),
        count: config.count || 0,
        itemSize: config.itemSize || 0
      };
      this.buffers.set(name, bufferInfo);
      this.stats.totalBuffers++;
      this.stats.totalMemory += bufferInfo.size;
      return bufferInfo;
    }

    bindBuffer(name, target = 34962) {
      const bufferInfo = this.buffers.get(name);
      if (bufferInfo) {
        this.gl.bindBuffer(target || bufferInfo.target, bufferInfo.buffer);
        this.stats.bufferBinds++;
      }
    }

    unbindBuffer(target = 34962) {
      this.gl.bindBuffer(target, null);
    }

    updateBuffer(name, data, offset = 0) {
      const bufferInfo = this.buffers.get(name);
      if (!bufferInfo) return;
      const gl = this.gl;
      gl.bindBuffer(bufferInfo.target, bufferInfo.buffer);
      gl.bufferSubData(bufferInfo.target, offset, data);
      gl.bindBuffer(bufferInfo.target, null);
    }

    createVertexArray(name) {
      const gl = this.gl;
      const vao = gl.createVertexArray();
      const vaoInfo = {
        name,
        vao,
        attributes: new Map(),
        indexBuffer: null
      };
      this.vertexArrays.set(name, vaoInfo);
      return vaoInfo;
    }

    bindVertexArray(name) {
      const vaoInfo = this.vertexArrays.get(name);
      if (vaoInfo) {
        this.gl.bindVertexArray(vaoInfo.vao);
        this.currentVAO = name;
      }
    }

    unbindVertexArray() {
      this.gl.bindVertexArray(null);
      this.currentVAO = null;
    }

    setVertexAttribute(vaoName, config) {
      const vaoInfo = this.vertexArrays.get(vaoName);
      if (!vaoInfo) return;
      const gl = this.gl;
      this.bindVertexArray(vaoName);
      const bufferInfo = this.buffers.get(config.buffer);
      if (bufferInfo) {
        gl.bindBuffer(bufferInfo.target, bufferInfo.buffer);
      }
      gl.enableVertexAttribArray(config.index);
      gl.vertexAttribPointer(config.index, config.size, config.type || 5126, config.normalized || false, config.stride || 0, config.offset || 0);
      if (config.divisor !== undefined) {
        gl.vertexAttribDivisor(config.index, config.divisor);
      }
      vaoInfo.attributes.set(config.index, config);
      this.unbindVertexArray();
    }

    setIndexBuffer(vaoName, bufferName) {
      const vaoInfo = this.vertexArrays.get(vaoName);
      if (!vaoInfo) return;
      const bufferInfo = this.buffers.get(bufferName);
      if (!bufferInfo) return;
      this.bindVertexArray(vaoName);
      this.gl.bindBuffer(34963, bufferInfo.buffer);
      vaoInfo.indexBuffer = bufferName;
      this.unbindVertexArray();
    }

    draw(vaoName, mode = 4, count, offset = 0) {
      const vaoInfo = this.vertexArrays.get(vaoName);
      if (!vaoInfo) return;
      this.bindVertexArray(vaoName);
      if (vaoInfo.indexBuffer) {
        this.gl.drawElements(mode, count || vaoInfo.indexCount || 0, 5125, offset * 4);
      } else {
        this.gl.drawArrays(mode, offset, count || 0);
      }
      this.unbindVertexArray();
    }

    drawInstanced(vaoName, mode = 4, count, instanceCount, offset = 0) {
      const vaoInfo = this.vertexArrays.get(vaoName);
      if (!vaoInfo) return;
      this.bindVertexArray(vaoName);
      if (vaoInfo.indexBuffer) {
        this.gl.drawElementsInstanced(mode, count || 0, 5125, offset * 4, instanceCount);
      } else {
        this.gl.drawArraysInstanced(mode, offset, count || 0, instanceCount);
      }
      this.unbindVertexArray();
    }

    getBuffer(name) {
      return this.buffers.get(name);
    }

    getVertexArray(name) {
      return this.vertexArrays.get(name);
    }

    removeBuffer(name) {
      const bufferInfo = this.buffers.get(name);
      if (bufferInfo) {
        this.gl.deleteBuffer(bufferInfo.buffer);
        this.stats.totalMemory -= bufferInfo.size;
        this.stats.totalBuffers--;
        this.buffers.delete(name);
      }
    }

    removeVertexArray(name) {
      const vaoInfo = this.vertexArrays.get(name);
      if (vaoInfo) {
        this.gl.deleteVertexArray(vaoInfo.vao);
        this.vertexArrays.delete(name);
      }
    }

    getStats() {
      return { ...this.stats };
    }

    getBufferNames() {
      return Array.from(this.buffers.keys());
    }

    getVertexArrayNames() {
      return Array.from(this.vertexArrays.keys());
    }

    getBufferCount() {
      return this.buffers.size;
    }

    getVertexArrayCount() {
      return this.vertexArrays.size;
    }

    clear() {
      for (const name of this.buffers.keys()) {
        this.removeBuffer(name);
      }
      for (const name of this.vertexArrays.keys()) {
        this.removeVertexArray(name);
      }
    }
  }

  return {
    RenderPipeline, TextureManager, BufferManager
  };
})();

if (typeof window !== 'undefined') window.WebGLCoreV3 = WebGLCoreV3;
if (typeof globalThis !== 'undefined') globalThis.WebGLCoreV3 = WebGLCoreV3;
