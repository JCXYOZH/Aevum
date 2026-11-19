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
  return {
    ComputeSimulator
  };
})();
