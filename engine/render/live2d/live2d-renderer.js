/* ============================================================
 * live2d-renderer.js — 自研 Live2D (Cubism 4) 渲染器
 * 依赖：live2dcubismcore.min.js（官方运行时）
 * 不依赖 PIXI.js 或任何三方渲染库
 * ============================================================ */
(function() {
'use strict';

// ============ 工具函数 ============
function _log() {}
function _err(msg) { console.error('[AevumLive2D] ' + msg); }

// 加载JSON
function _loadJSON(url) {
  return fetch(url).then(r => {
    if(!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    return r.json();
  });
}

// 加载ArrayBuffer
function _loadArrayBuffer(url) {
  return fetch(url).then(r => {
    if(!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    return r.arrayBuffer();
  });
}

// 加载图片纹理
function _loadTexture(gl, url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      _log('纹理加载成功: ' + url + ' 尺寸=' + img.width + 'x' + img.height + ' 2的幂=' + ((img.width & (img.width-1)) === 0 && (img.height & (img.height-1)) === 0));
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // Cubism的UV Y轴向下，需要翻转
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      // 不使用MIPMAP（非2的幂纹理不支持，且Live2D不需要）
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
      resolve(tex);
    };
    img.onerror = () => reject(new Error('纹理加载失败: ' + url));
    img.src = url;
  });
}

// ============ 着色器 ============
const VS_SRC = `
attribute vec2 a_pos;
attribute vec2 a_uv;
uniform mat4 u_mvp;
varying vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = u_mvp * vec4(a_pos, 0.0, 1.0);
}`;

const FS_SRC = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_opacity;
uniform float u_debugColor; // 测试用：>0时输出固定颜色，不采样纹理
void main() {
  if(u_debugColor > 0.5) {
    gl_FragColor = vec4(1.0, 0.2, 0.2, u_opacity);
    return;
  }
  vec4 c = texture2D(u_tex, v_uv);
  c.a *= u_opacity;
  if(c.a < 0.01) discard;
  gl_FragColor = c;
}`;

function _createShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error('着色器编译失败: ' + info);
  }
  return s;
}

function _createProgram(gl) {
  const vs = _createShader(gl, gl.VERTEX_SHADER, VS_SRC);
  const fs = _createShader(gl, gl.FRAGMENT_SHADER, FS_SRC);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog);
    throw new Error('程序链接失败: ' + info);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return {
    program: prog,
    a_pos: gl.getAttribLocation(prog, 'a_pos'),
    a_uv: gl.getAttribLocation(prog, 'a_uv'),
    u_mvp: gl.getUniformLocation(prog, 'u_mvp'),
    u_tex: gl.getUniformLocation(prog, 'u_tex'),
    u_opacity: gl.getUniformLocation(prog, 'u_opacity'),
    u_debugColor: gl.getUniformLocation(prog, 'u_debugColor')
  };
}

// ============ 矩阵工具 ============
function _mat4Identity() {
  return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
}

function _mat4Ortho(left, right, bottom, top, near, far) {
  const m = new Float32Array(16);
  const rl = 1 / (right - left);
  const tb = 1 / (top - bottom);
  const nf = 1 / (far - near);
  m[0] = 2 * rl;
  m[5] = 2 * tb;
  m[10] = -2 * nf;
  m[12] = -(right + left) * rl;
  m[13] = -(top + bottom) * tb;
  m[14] = -(far + near) * nf;
  m[15] = 1;
  return m;
}

function _mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for(let i = 0; i < 4; i++) {
    for(let j = 0; j < 4; j++) {
      out[i*4+j] = a[i*4+0]*b[0*4+j] + a[i*4+1]*b[1*4+j] + a[i*4+2]*b[2*4+j] + a[i*4+3]*b[3*4+j];
    }
  }
  return out;
}

function _mat4Translate(m, x, y, z) {
  const out = new Float32Array(m);
  out[12] = m[0]*x + m[4]*y + m[8]*z + m[12];
  out[13] = m[1]*x + m[5]*y + m[9]*z + m[13];
  out[14] = m[2]*x + m[6]*y + m[10]*z + m[14];
  out[15] = m[3]*x + m[7]*y + m[11]*z + m[15];
  return out;
}

function _mat4Scale(m, x, y, z) {
  const out = new Float32Array(m);
  out[0] *= x; out[1] *= x; out[2] *= x; out[3] *= x;
  out[4] *= y; out[5] *= y; out[6] *= y; out[7] *= y;
  out[8] *= z; out[9] *= z; out[10] *= z; out[11] *= z;
  return out;
}

// ============ Live2D 模型类 ============
class Live2DModel {
  constructor(gl, moc, textures, config) {
    this.gl = gl;
    this.moc = moc;
    this.textures = textures;
    this.config = config;
    if(!moc.drawables) throw new Error('moc.drawables 不存在，Moc键=' + Object.keys(moc).join(', '));
    if(!moc.parameters) throw new Error('moc.parameters 不存在，Moc键=' + Object.keys(moc).join(', '));
    this.drawables = moc.drawables;
    this.parameters = moc.parameters;
    _log('drawables.count=' + this.drawables.count + ', parameters.count=' + this.parameters.count);
    // 探测moc类型和update方法
    _log('moc类型: ' + (moc.constructor ? moc.constructor.name : typeof moc));
    _log('moc自身键: ' + Object.keys(moc).join(', '));
    const mocProto = Object.getPrototypeOf(moc);
    _log('moc原型属性: ' + (mocProto ? Object.getOwnPropertyNames(mocProto).join(', ') : '无'));
    _log('moc.update存在: ' + (typeof moc.update === 'function'));
    _log('moc.revive存在: ' + (typeof moc.revive === 'function'));
    // 先调用update初始化变形器和顶点位置（Cubism Model创建后顶点可能未初始化）
    try {
      if(typeof moc.update === 'function') {
        moc.update();
        _log('初始化update调用成功');
      }
    } catch(e) {
      _err('初始化update失败: ' + e.message);
    }
    this._paramMap = {};
    this._initParamMap();
    this._initBuffers();
    this._time = 0;
    this._blinkTimer = 0;
    this._blinkState = 'open'; // open, closing, closed, opening
    this._blinkValue = 1;
    this._nextBlink = 2 + Math.random() * 4;
    this._breathPhase = 0;
    this._lookX = 0;
    this._lookY = 0;
    this._modelMatrix = _mat4Identity();
    this._canvasWidth = 0;
    this._canvasHeight = 0;
    this._motion = null;
    this._motionTime = 0;
    this._motionLoop = true;
    this._motionWeight = 1;
    this._motionFade = 0;
    this._motionElapsed = 0;
  }

  /**
   * 绑定 motion3 动作。动作只驱动参数曲线，随后由 update() 统一提交给 Core。
   * @param {object} motion Live2DMotion 实例
   * @param {object} [options] loop / weight / fade / time
   */
  setMotion(motion, options) {
    const opts = options || {};
    this._motion = motion || null;
    this._motionTime = Number(opts.time) || 0;
    this._motionLoop = opts.loop !== false;
    this._motionWeight = opts.weight === undefined ? 1 : Math.max(0, Math.min(1, opts.weight));
    this._motionFade = Math.max(0, Number(opts.fade) || 0);
    this._motionElapsed = 0;
  }

  setMotionTime(time) {
    this._motionTime = Number(time) || 0;
    this._motionElapsed = this._motionTime;
  }

  stopMotion() {
    this._motion = null;
  }

  _applyMotion(dt) {
    if(!this._motion) return;
    if(this._motionFade > 0 && this._motionElapsed < this._motionFade) {
      this._motionElapsed += dt;
    }
    const weight = this._motionFade > 0
      ? this._motionWeight * Math.min(1, this._motionElapsed / this._motionFade)
      : this._motionWeight;
    const values = this._motion.sampleAt(this._motionTime);
    for(const id in values) {
      const target = values[id];
      const current = this.getParam(id);
      this.setParam(id, current + (target - current) * weight);
    }
  }

  _initParamMap() {
    const ids = this.parameters.ids;
    _log('parameters对象键: ' + Object.keys(this.parameters).join(', '));
    _log('parameters对象属性名: ' + Object.getOwnPropertyNames(this.parameters).join(', '));
    // 探测minimums/maximums/values是否存在
    for(const k of ['values','minimums','maximums','defaults','min','max','count','ids']) {
      _log('  parameters.' + k + ' = ' + typeof this.parameters[k] + (this.parameters[k] && this.parameters[k].length ? ' (length=' + this.parameters[k].length + ')' : ''));
    }
    for(let i = 0; i < this.parameters.count; i++) {
      const id = this._decodeID(ids, i);
      this._paramMap[id] = i;
    }
    _log('参数数量: ' + this.parameters.count + ', 映射: ' + Object.keys(this._paramMap).join(', '));
  }

  _decodeID(ids, index) {
    // Cubism core 的 ids 是 csmVector 类型，用 .at(index) 读取
    try {
      if(ids && typeof ids.at === 'function') return ids.at(index);
      if(Array.isArray(ids)) return ids[index];
      if(ids && ids.ptr) {
        const core = window.Live2DCubismCore;
        if(core && core.Vector && core.Vector.prototype && core.Vector.prototype.at) {
          return core.Vector.prototype.at.call(ids, index);
        }
      }
    } catch(e) {}
    return 'param_' + index;
  }

  _initBuffers() {
    const gl = this.gl;
    const d = this.drawables;
    _log('drawables对象键: ' + Object.keys(d).join(', '));

    // 检测是否为扁平数组（Cubism 4 core标准格式）
    const isFlat = d.vertexPositions && d.vertexPositions.buffer && d.vertexPositions.BYTES_PER_ELEMENT !== undefined;
    _log('vertexPositions类型: ' + (d.vertexPositions ? d.vertexPositions.constructor.name : 'undefined') + ' length=' + (d.vertexPositions ? d.vertexPositions.length : 'N/A') + ' isFlat=' + isFlat);
    _log('indices类型: ' + (d.indices ? d.indices.constructor.name : 'undefined') + ' length=' + (d.indices ? d.indices.length : 'N/A'));
    _log('vertexCounts类型: ' + (d.vertexCounts ? d.vertexCounts.constructor.name : 'undefined') + ' length=' + (d.vertexCounts ? d.vertexCounts.length : 'N/A'));
    _log('indexCounts类型: ' + (d.indexCounts ? d.indexCounts.constructor.name : 'undefined') + ' length=' + (d.indexCounts ? d.indexCounts.length : 'N/A'));

    // 计算每个drawable的顶点和索引偏移量（用于扁平数组）
    this._vertexOffsets = [];
    this._indexOffsets = [];
    let vertexOffset = 0;
    let indexOffset = 0;
    for(let i = 0; i < d.count; i++) {
      this._vertexOffsets.push(vertexOffset);
      this._indexOffsets.push(indexOffset);
      const vc = d.vertexCounts ? (typeof d.vertexCounts.at === 'function' ? d.vertexCounts.at(i) : d.vertexCounts[i]) : 0;
      const ic = d.indexCounts ? (typeof d.indexCounts.at === 'function' ? d.indexCounts.at(i) : d.indexCounts[i]) : 0;
      vertexOffset += vc * 2;
      indexOffset += ic;
    }
    _log('扁平数组: 总顶点浮点数=' + vertexOffset + ' 总索引数=' + indexOffset);

    // 检测是否需要Uint32索引扩展
    this._useUint32 = false;
    if(d.indices && d.indices.BYTES_PER_ELEMENT === 4) {
      this._useUint32 = true;
      const ext = gl.getExtension('OES_element_index_uint');
      _log('启用OES_element_index_uint扩展: ' + (ext ? '成功' : '失败'));
    }

    this._vertexBuffers = [];
    this._uvBuffers = [];
    this._indexBuffers = [];
    this._indexCounts = [];
    this._indexTypes = [];
    this._validDrawables = [];

    let skipped = 0;
    for(let i = 0; i < d.count; i++) {
      const vc = d.vertexCounts ? (typeof d.vertexCounts.at === 'function' ? d.vertexCounts.at(i) : d.vertexCounts[i]) : 0;
      const ic = d.indexCounts ? (typeof d.indexCounts.at === 'function' ? d.indexCounts.at(i) : d.indexCounts[i]) : 0;

      // 获取第i个drawable的顶点/UV/索引数据
      let positions, uvs, indices;
      if(isFlat) {
        // 扁平数组：用偏移量和subarray切片
        const vOff = this._vertexOffsets[i];
        const iOff = this._indexOffsets[i];
        positions = d.vertexPositions.subarray(vOff, vOff + vc * 2);
        uvs = d.vertexUvs.subarray(vOff, vOff + vc * 2);
        indices = d.indices.subarray(iOff, iOff + ic);
      } else {
        // 数组的数组：直接索引
        positions = d.vertexPositions ? d.vertexPositions[i] : null;
        uvs = d.vertexUvs ? d.vertexUvs[i] : null;
        indices = d.indices ? d.indices[i] : null;
      }

      if(!positions || !uvs || !indices || positions.length === 0 || indices.length === 0) {
        this._vertexBuffers.push(null);
        this._uvBuffers.push(null);
        this._indexBuffers.push(null);
        this._indexCounts.push(0);
        this._indexTypes.push(gl.UNSIGNED_SHORT);
        skipped++;
        continue;
      }

      // 类型检测与强制转换：普通Array -> TypedArray（WebGL bufferData要求ArrayBufferView）
      if(!positions.buffer) {
        if(i === 0) _log('positions是普通Array，转换为Float32Array');
        positions = new Float32Array(positions);
      }
      if(!uvs.buffer) {
        if(i === 0) _log('uvs是普通Array，转换为Float32Array');
        uvs = new Float32Array(uvs);
      }
      if(!indices.buffer) {
        if(i === 0) _log('indices是普通Array，转换为Uint16Array');
        indices = new Uint16Array(indices);
      }
      // 检测索引值是否超过Uint16范围，超过则用Uint32
      let idxType = (indices.BYTES_PER_ELEMENT === 4) ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      if(idxType === gl.UNSIGNED_SHORT) {
        let maxIdx = 0;
        for(let k = 0; k < Math.min(indices.length, 500); k++) {
          if(indices[k] > maxIdx) maxIdx = indices[k];
        }
        if(maxIdx > 65535) {
          if(i === 0) _log('索引值超过65535 (max=' + maxIdx + ')，转换为Uint32Array');
          indices = new Uint32Array(indices);
          idxType = gl.UNSIGNED_INT;
          if(!this._useUint32) {
            this._useUint32 = true;
            gl.getExtension('OES_element_index_uint');
          }
        }
      }
      if(i === 0) {
        // 检测第一个drawable的索引值范围
        let maxIdx = 0, minIdx = 65535;
        for(let k = 0; k < indices.length; k++) {
          if(indices[k] > maxIdx) maxIdx = indices[k];
          if(indices[k] < minIdx) minIdx = indices[k];
        }
        // 检测UV范围
        let uvMinX = 999, uvMinY = 999, uvMaxX = -999, uvMaxY = -999;
        for(let k = 0; k < uvs.length / 2; k++) {
          const u = uvs[k*2], v = uvs[k*2+1];
          if(u < uvMinX) uvMinX = u; if(u > uvMaxX) uvMaxX = u;
          if(v < uvMinY) uvMinY = v; if(v > uvMaxY) uvMaxY = v;
        }
        _log('drawable#0数据类型: positions=' + positions.constructor.name + '(' + positions.length + ') uvs=' + uvs.constructor.name + '(' + uvs.length + ') indices=' + indices.constructor.name + '(' + indices.length + ') idxType=' + idxType);
        _log('drawable#0: 顶点数=' + (positions.length/2) + ' 索引范围=[' + minIdx + ',' + maxIdx + '] (顶点数=' + (positions.length/2) + ')' + (maxIdx >= positions.length/2 ? ' ⚠️索引超出局部顶点数！可能是全局索引' : ''));
        _log('drawable#0: UV范围 X=[' + uvMinX.toFixed(3) + ',' + uvMaxX.toFixed(3) + '] Y=[' + uvMinY.toFixed(3) + ',' + uvMaxY.toFixed(3) + ']');
        _log('drawable#0: 顶点范围 X=[' + Math.min(...positions.filter((_,i)=>i%2===0)).toFixed(3) + ',' + Math.max(...positions.filter((_,i)=>i%2===0)).toFixed(3) + '] Y=[' + Math.min(...positions.filter((_,i)=>i%2===1)).toFixed(3) + ',' + Math.max(...positions.filter((_,i)=>i%2===1)).toFixed(3) + ']');
      }

      const vBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vBuf);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);

      const uvBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);

      const iBuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

      this._vertexBuffers.push(vBuf);
      this._uvBuffers.push(uvBuf);
      this._indexBuffers.push(iBuf);
      this._indexCounts.push(indices.length);
      this._indexTypes.push(idxType);
      this._validDrawables.push(i);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    _log('Drawable数量: ' + d.count + ' 有效=' + this._validDrawables.length + ' 跳过=' + skipped);

    // 检测所有drawable的顶点范围，找出异常drawable
    let abnormalDrawables = [];
    let globalMinX = Infinity, globalMinY = Infinity, globalMaxX = -Infinity, globalMaxY = -Infinity;
    for(let i = 0; i < d.count; i++) {
      const positions = isFlat ? null : (d.vertexPositions ? d.vertexPositions[i] : null);
      if(!positions || positions.length === 0) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let hasNaN = false;
      for(let j = 0; j < positions.length / 2; j++) {
        const x = positions[j*2], y = positions[j*2+1];
        if(isNaN(x) || isNaN(y) || !isFinite(x) || !isFinite(y)) { hasNaN = true; continue; }
        if(x < minX) minX = x; if(x > maxX) maxX = x;
        if(y < minY) minY = y; if(y > maxY) maxY = y;
        if(x < globalMinX) globalMinX = x; if(x > globalMaxX) globalMaxX = x;
        if(y < globalMinY) globalMinY = y; if(y > globalMaxY) globalMaxY = y;
      }
      const w = maxX - minX, h = maxY - minY;
      if(hasNaN || w > 5 || h > 5 || minX < -10 || maxX > 10 || minY < -10 || maxY > 10) {
        abnormalDrawables.push({i, minX, maxX, minY, maxY, w, h, hasNaN, vCount: positions.length/2});
      }
    }
    _log('全局顶点范围: X=[' + globalMinX.toFixed(3) + ',' + globalMaxX.toFixed(3) + '] Y=[' + globalMinY.toFixed(3) + ',' + globalMaxY.toFixed(3) + ']');
    _log('异常drawable数量: ' + abnormalDrawables.length);
    if(abnormalDrawables.length > 0) {
      _log('前10个异常drawable: ' + JSON.stringify(abnormalDrawables.slice(0, 10).map(a => '#' + a.i + '(X[' + a.minX.toFixed(2) + ',' + a.maxX.toFixed(2) + '] Y[' + a.minY.toFixed(2) + ',' + a.maxY.toFixed(2) + ']' + (a.hasNaN ? ' NaN!' : '') + ')')));
    }

    // 检测所有drawable的索引范围，确认是否是全局索引
    let globalIdxCount = 0;
    let maxGlobalIdx = 0;
    let abnormalIdxDrawables = [];
    for(let i = 0; i < d.count; i++) {
      const indices = isFlat ? null : (d.indices ? d.indices[i] : null);
      if(!indices || indices.length === 0) continue;
      const vc = d.vertexCounts ? (typeof d.vertexCounts.at === 'function' ? d.vertexCounts.at(i) : d.vertexCounts[i]) : (positions ? positions.length/2 : 0);
      let minIdx = 65535, maxIdx = 0;
      for(let k = 0; k < indices.length; k++) {
        if(indices[k] < minIdx) minIdx = indices[k];
        if(indices[k] > maxIdx) maxIdx = indices[k];
      }
      if(maxIdx > maxGlobalIdx) maxGlobalIdx = maxIdx;
      globalIdxCount += indices.length;
      if(maxIdx >= vc && vc > 0) {
        abnormalIdxDrawables.push({i, vc, minIdx, maxIdx});
      }
    }
    _log('索引检测: 总索引数=' + globalIdxCount + ' 全局最大索引=' + maxGlobalIdx + ' 索引超出局部顶点数的drawable=' + abnormalIdxDrawables.length);
    if(abnormalIdxDrawables.length > 0) {
      _log('⚠️ 前10个索引异常drawable: ' + JSON.stringify(abnormalIdxDrawables.slice(0, 10).map(a => '#' + a.i + '(顶点数=' + a.vc + ' 索引范围=[' + a.minIdx + ',' + a.maxIdx + '])')));
      _log('⚠️ 索引是全局索引！需要减去顶点偏移量转换为局部索引');
    }

    // 检测遮罩
    let maskedCount = 0;
    if(d.maskCounts) {
      for(let i = 0; i < d.count; i++) {
        const mc = typeof d.maskCounts.at === 'function' ? d.maskCounts.at(i) : d.maskCounts[i];
        if(mc > 0) maskedCount++;
      }
    }
    _log('需要遮罩的drawable数量: ' + maskedCount + '/' + d.count);

    // 调试：统计所有drawable的顶点坐标范围
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let totalVerts = 0, totalIndices = 0;
    let firstDrawableInfo = '';
    for(let i = 0; i < d.count; i++) {
      const vc = d.vertexCounts ? (typeof d.vertexCounts.at === 'function' ? d.vertexCounts.at(i) : d.vertexCounts[i]) : 0;
      const ic = d.indexCounts ? (typeof d.indexCounts.at === 'function' ? d.indexCounts.at(i) : d.indexCounts[i]) : 0;
      let positions, indices;
      if(isFlat) {
        const vOff = this._vertexOffsets[i];
        const iOff = this._indexOffsets[i];
        positions = d.vertexPositions.subarray(vOff, vOff + vc * 2);
        indices = d.indices.subarray(iOff, iOff + ic);
      } else {
        positions = d.vertexPositions ? d.vertexPositions[i] : null;
        indices = d.indices ? d.indices[i] : null;
      }
      if(!positions || !indices || positions.length === 0) continue;
      const vCount = positions.length / 2;
      totalVerts += vCount;
      totalIndices += indices.length;
      for(let j = 0; j < vCount; j++) {
        const x = positions[j*2], y = positions[j*2+1];
        if(x < minX) minX = x; if(x > maxX) maxX = x;
        if(y < minY) minY = y; if(y > maxY) maxY = y;
      }
      if(i === 0) {
        firstDrawableInfo = 'drawable#0: vCount=' + vCount + ', idxCount=' + indices.length + ', idxType=' + (indices.BYTES_PER_ELEMENT || '?') + ', texIdx=' + (d.textureIndices ? (typeof d.textureIndices.at === 'function' ? d.textureIndices.at(i) : d.textureIndices[i]) : '?') + ', pos[0]=(' + positions[0].toFixed(2) + ',' + positions[1].toFixed(2) + ')';
      }
    }
    _log('顶点范围: X=[' + minX.toFixed(2) + ',' + maxX.toFixed(2) + '] Y=[' + minY.toFixed(2) + ',' + maxY.toFixed(2) + '] 总顶点=' + totalVerts + ' 总索引=' + totalIndices);
    _log(firstDrawableInfo);
    _log('纹理数量: ' + this.textures.length);
    // 保存坐标范围用于自动缩放
    this._coordMinX = minX; this._coordMaxX = maxX;
    this._coordMinY = minY; this._coordMaxY = maxY;
  }

  setParam(id, value) {
    const idx = this._paramMap[id];
    if(idx === undefined) return false;
    const p = this.parameters;
    // Cubism 4 core属性名: minimumValues/maximumValues
    let min = -Infinity, max = Infinity;
    if(p.minimumValues && p.minimumValues[idx] !== undefined) min = p.minimumValues[idx];
    else if(p.minimums && p.minimums[idx] !== undefined) min = p.minimums[idx];
    else if(p.min && p.min[idx] !== undefined) min = p.min[idx];
    if(p.maximumValues && p.maximumValues[idx] !== undefined) max = p.maximumValues[idx];
    else if(p.maximums && p.maximums[idx] !== undefined) max = p.maximums[idx];
    else if(p.max && p.max[idx] !== undefined) max = p.max[idx];
    const clamped = Math.max(min, Math.min(max, value));
    if(p.values && p.values[idx] !== undefined) {
      p.values[idx] = clamped;
      return true;
    }
    return false;
  }

  getParam(id) {
    const idx = this._paramMap[id];
    if(idx === undefined) return 0;
    const p = this.parameters;
    if(p.values && p.values[idx] !== undefined) return p.values[idx];
    return 0;
  }

  /**
   * 应用 Live2D 表情（exp3.json）。
   *
   * 只处理 exp3 的 Parameters 表：按 Blend 规则把值写入模型参数，随后由
   * renderFrame/update 统一提交给 Cubism Core。Blend 支持 Add、Multiply、Overwrite，
   * 与 Cubism 表达式语义一致；未知参数直接跳过，不报错。
   *
   * @param {object} expression exp3.json 解析后的对象
   * @param {number} [weight=1] 混合权重，0 表示不应用，1 表示完整应用
   * @returns {number} 实际写入的参数数量
   */
  applyExpression(expression, weight) {
    const w = weight === undefined ? 1 : Math.max(0, Math.min(1, weight));
    const list = expression && Array.isArray(expression.Parameters) ? expression.Parameters : [];
    let applied = 0;
    for(let i = 0; i < list.length; i++) {
      const item = list[i];
      if(!item || !item.Id) continue;
      const idx = this._paramMap[item.Id];
      if(idx === undefined) continue;
      const base = this.getParam(item.Id);
      const value = Number(item.Value) || 0;
      const blend = item.Blend || 'Add';
      let next = base;
      if(blend === 'Multiply') next = base * value;
      else if(blend === 'Overwrite') next = value;
      else next = base + value;
      this.setParam(item.Id, base + (next - base) * w);
      applied++;
    }
    return applied;
  }

  /**
   * 加载并缓存 exp3.json，返回解析对象；不自动应用，调用方决定时机。
   * @param {string} url exp3.json 地址（相对或绝对 URL）
   * @returns {Promise<object>}
   */
  async loadExpression(url) {
    const response = await fetch(url);
    if(!response.ok) throw new Error('exp3 加载失败: ' + response.status + ' ' + url);
    return response.json();
  }

  setLookTarget(x, y) {
    this._lookX = Math.max(-1, Math.min(1, x));
    this._lookY = Math.max(-1, Math.min(1, y));
  }

  // 立即触发眨眼
  triggerBlink() {
    this._blinkState = 'closing';
    this._blinkTimer = 0;
    this._blinkValue = 1;
  }

  // 点头（通过ParamAngleY临时动画）
  triggerNod() {
    if(this._nodAnim) clearInterval(this._nodAnim);
    let phase = 0;
    const origY = this.getParam('ParamAngleY');
    this._nodAnim = setInterval(() => {
      phase += 0.18;
      if(phase >= Math.PI) {
        this.setParam('ParamAngleY', origY);
        clearInterval(this._nodAnim);
        this._nodAnim = null;
        return;
      }
      this.setParam('ParamAngleY', origY + Math.sin(phase) * 15);
    }, 16);
  }

  // 摇头（通过ParamAngleX临时动画）
  triggerShake() {
    if(this._shakeAnim) clearInterval(this._shakeAnim);
    let phase = 0;
    const origX = this.getParam('ParamAngleX');
    this._shakeAnim = setInterval(() => {
      phase += 0.22;
      if(phase >= Math.PI * 2) {
        this.setParam('ParamAngleX', origX);
        clearInterval(this._shakeAnim);
        this._shakeAnim = null;
        return;
      }
      this.setParam('ParamAngleX', origX + Math.sin(phase) * 20);
    }, 16);
  }

  // 挥手（通过手臂参数，如果模型支持）
  triggerWave(side) {
    const s = side || 'right';
    // 尝试设置手臂参数（不同模型参数名不同）
    const armParams = s === 'left'
      ? ['ParamArmL', 'ParamLeftArm', 'ParamArmLeft']
      : ['ParamArmR', 'ParamRightArm', 'ParamArmRight'];
    for(const p of armParams) {
      if(this._paramMap[p] !== undefined) {
        const orig = this.getParam(p);
        this.setParam(p, orig + 30);
        setTimeout(() => this.setParam(p, orig), 800);
        return true;
      }
    }
    // 回退：用身体倾斜模拟挥手
    const origBody = this.getParam('ParamBodyAngleX');
    this.setParam('ParamBodyAngleX', origBody + (s === 'left' ? -5 : 5));
    setTimeout(() => this.setParam('ParamBodyAngleX', origBody), 800);
    return false;
  }

  // 设置情绪
  setEmotion(emotion) {
    this._emotion = emotion || 'neutral';
    // 常见情绪参数映射
    const emotionMap = {
      happy:   { ParamMouthOpenY: 0.3, ParamEyeLOpen: 1.2, ParamEyeROpen: 1.2, ParamBrowLY: -5, ParamBrowRY: -5 },
      sad:     { ParamMouthOpenY: 0, ParamEyeLOpen: 0.7, ParamEyeROpen: 0.7, ParamBrowLY: 8, ParamBrowRY: 8 },
      angry:   { ParamMouthOpenY: 0.1, ParamEyeLOpen: 0.9, ParamEyeROpen: 0.9, ParamBrowLY: 10, ParamBrowRY: 10 },
      surprised:{ ParamMouthOpenY: 0.6, ParamEyeLOpen: 1.5, ParamEyeROpen: 1.5, ParamBrowLY: -10, ParamBrowRY: -10 },
      neutral: { ParamMouthOpenY: 0, ParamEyeLOpen: 1, ParamEyeROpen: 1, ParamBrowLY: 0, ParamBrowRY: 0 }
    };
    const params = emotionMap[this._emotion] || emotionMap.neutral;
    for(const k in params) {
      if(this._paramMap[k] !== undefined) {
        this.setParam(k, params[k]);
      }
    }
  }

  // 设置说话音量（0-1），用于口型同步
  setTalkVolume(vol) {
    this._talkVolume = Math.max(0, Math.min(1, vol));
    // 嘴部张开度跟随音量
    if(this._paramMap['ParamMouthOpenY'] !== undefined) {
      this.setParam('ParamMouthOpenY', this._talkVolume * 0.8);
    }
  }

  // 批量更新参数（由外部动作系统调用）
  updateParams(params) {
    if(!params) return;
    if(params.breath !== undefined && this._paramMap['ParamBreath'] !== undefined) {
      this.setParam('ParamBreath', params.breath);
    }
    if(params.talkVolume !== undefined) {
      this.setTalkVolume(params.talkVolume);
    }
    if(params.lookX !== undefined && params.lookY !== undefined) {
      this.setLookTarget(params.lookX, params.lookY);
    }
    if(params.emotion !== undefined) {
      this.setEmotion(params.emotion);
    }
  }

  update(dt) {
    this._time += dt;

    // 临时禁用参数设置，测试是否是参数导致碎片
    const DISABLE_PARAMS = false;
    if(!DISABLE_PARAMS) {
      this._breathPhase += dt * 1.5;
      // 呼吸
      const breath = Math.sin(this._breathPhase) * 0.5 + 0.5;
      this.setParam('ParamBreath', breath);

      // 眨眼状态机
      this._blinkTimer += dt;
      if(this._blinkState === 'open') {
        if(this._blinkTimer > this._nextBlink) {
          this._blinkState = 'closing';
          this._blinkTimer = 0;
        }
        this._blinkValue = 1;
      } else if(this._blinkState === 'closing') {
        this._blinkValue = 1 - this._blinkTimer / 0.1;
        if(this._blinkTimer >= 0.1) {
          this._blinkState = 'closed';
          this._blinkTimer = 0;
          this._blinkValue = 0;
        }
      } else if(this._blinkState === 'closed') {
        this._blinkValue = 0;
        if(this._blinkTimer >= 0.08) {
          this._blinkState = 'opening';
          this._blinkTimer = 0;
        }
      } else if(this._blinkState === 'opening') {
        this._blinkValue = this._blinkTimer / 0.15;
        if(this._blinkTimer >= 0.15) {
          this._blinkState = 'open';
          this._blinkTimer = 0;
          this._nextBlink = 2 + Math.random() * 4;
          this._blinkValue = 1;
        }
      }
      this.setParam('ParamEyeLOpen', this._blinkValue);
      this.setParam('ParamEyeROpen', this._blinkValue);

      // 鼠标跟随（平滑）
      const targetAngleX = this._lookX * 30;
      const targetAngleY = this._lookY * 20;
      const curAngleX = this.getParam('ParamAngleX');
      const curAngleY = this.getParam('ParamAngleY');
      const lerp = 1 - Math.pow(0.001, dt);
      this.setParam('ParamAngleX', curAngleX + (targetAngleX - curAngleX) * lerp);
      this.setParam('ParamAngleY', curAngleY + (targetAngleY - curAngleY) * lerp);
      this.setParam('ParamBodyAngleX', this.getParam('ParamAngleX') * 0.3);
    }

    if(this._motion) {
      this._motionTime += dt;
      this._applyMotion(dt);
    }

    // 更新Cubism模型
    let vertBefore = null;
    if(this.drawables.vertexPositions) {
      const isFlat = this.drawables.vertexPositions.buffer && this.drawables.vertexPositions.BYTES_PER_ELEMENT !== undefined;
      if(isFlat) {
        vertBefore = this.drawables.vertexPositions[0];
      } else if(this.drawables.vertexPositions[0]) {
        vertBefore = this.drawables.vertexPositions[0][0];
      }
    }
    try {
      if(typeof this.moc.update === 'function') {
        this.moc.update();
      } else {
        if(!this._updateWarned) { _err('moc.update不存在！顶点位置不会更新'); this._updateWarned = true; }
      }
    } catch(e) {
      _err('moc.update失败: ' + e.message);
    }
    // 检测顶点位置是否变化
    if(vertBefore !== null && this.drawables.vertexPositions) {
      const isFlat = this.drawables.vertexPositions.buffer && this.drawables.vertexPositions.BYTES_PER_ELEMENT !== undefined;
      let vertAfter;
      if(isFlat) {
        vertAfter = this.drawables.vertexPositions[0];
      } else if(this.drawables.vertexPositions[0]) {
        vertAfter = this.drawables.vertexPositions[0][0];
      }
      if(vertAfter !== undefined && !this._vertChangeWarned && Math.abs(vertAfter - vertBefore) < 0.00001) {
        _log('提示: update后顶点位置微小变化 (before=' + vertBefore + ', after=' + vertAfter + ')，属正常（呼吸/眨眼对第0个顶点影响极小）');
        this._vertChangeWarned = true;
      }
    }

    // 更新顶点缓冲（变形后顶点位置会变化）
    // 临时禁用顶点缓冲更新，测试是否是update导致碎片
    const DISABLE_VERTEX_UPDATE = false;
    if(DISABLE_VERTEX_UPDATE && !this._vertexUpdateDisabledLogged) {
      _log('⚠️ 顶点缓冲更新已禁用，使用初始顶点位置渲染');
      this._vertexUpdateDisabledLogged = true;
    }
    const gl = this.gl;
    const d = this.drawables;
    if(!DISABLE_VERTEX_UPDATE && d.vertexPositions) {
      const isFlat = d.vertexPositions.buffer && d.vertexPositions.BYTES_PER_ELEMENT !== undefined;
      for(let i = 0; i < d.count; i++) {
        if(!this._vertexBuffers[i]) continue;
        let positions;
        if(isFlat) {
          const vc = d.vertexCounts ? (typeof d.vertexCounts.at === 'function' ? d.vertexCounts.at(i) : d.vertexCounts[i]) : 0;
          const vOff = this._vertexOffsets[i];
          positions = d.vertexPositions.subarray(vOff, vOff + vc * 2);
        } else {
          positions = d.vertexPositions[i];
        }
        if(positions && positions.length > 0) {
          // 第一次update时检测NaN
          if(!this._nanChecked) {
            for(let j = 0; j < positions.length; j++) {
              if(isNaN(positions[j]) || !isFinite(positions[j])) {
                _err('⚠️ 顶点NaN检测: drawable#' + i + ' 顶点#' + j + ' = ' + positions[j]);
                this._nanFound = true;
                break;
              }
            }
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, this._vertexBuffers[i]);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
        }
      }
      if(!this._nanChecked) {
        this._nanChecked = true;
        if(!this._nanFound) _log('顶点NaN检测: 所有顶点正常，无NaN/无穷大');
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  render(gl, program, mvp) {
    const d = this.drawables;
    const renderOrder = this._getRenderOrder();

    // 清除深度缓冲，防止其他渲染污染
    gl.clear(gl.DEPTH_BUFFER_BIT);
    // 强制重置所有可能影响渲染的状态
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.blendEquation(gl.FUNC_ADD);
    gl.colorMask(true, true, true, true);
    gl.depthMask(false);

    // 检测drawOrders排序（仅第一次）
    if(!this._orderChecked && d.drawOrders) {
      const orders = [];
      for(let i = 0; i < Math.min(d.count, 20); i++) {
        const v = typeof d.drawOrders.at === 'function' ? d.drawOrders.at(i) : d.drawOrders[i];
        orders.push(v);
      }
      _log('drawOrders前20个值: ' + orders.join(', ') + ' 排序后前5个索引: ' + renderOrder.slice(0, 5).join(','));
      this._orderChecked = true;
    }

    gl.useProgram(program.program);
    gl.uniformMatrix4fv(program.u_mvp, false, mvp);
    gl.uniform1i(program.u_tex, 0);
    gl.uniform1f(program.u_debugColor, 0.0); // 正常采样纹理
    gl.activeTexture(gl.TEXTURE0);

    gl.enableVertexAttribArray(program.a_pos);
    gl.enableVertexAttribArray(program.a_uv);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE); // Cubism顶点顺序不统一，禁用面剔除
    gl.disable(gl.DEPTH_TEST); // 2D渲染禁用深度测试

    let rendered = 0, skippedVisible = 0, skippedOpacity = 0, skippedTex = 0, skippedInvalid = 0;
    for(let idx = 0; idx < renderOrder.length; idx++) {
      const i = renderOrder[idx];
      // 跳过无效drawable
      if(!this._vertexBuffers[i] || !this._indexBuffers[i] || this._indexCounts[i] === 0) { skippedInvalid++; continue; }
      // 检查可见性（Cubism dynamicFlags第0位：1=可见）
      const dynamicFlags = d.dynamicFlags ? d.dynamicFlags[i] : 1;
      if(dynamicFlags !== undefined && dynamicFlags !== 0 && (dynamicFlags & 1) === 0) { skippedVisible++; continue; }

      const opacity = d.opacities ? d.opacities[i] : 1;
      if(opacity <= 0.01) { skippedOpacity++; continue; }

      const texIdx = d.textureIndices ? d.textureIndices[i] : 0;
      if(texIdx < 0 || texIdx >= this.textures.length) { skippedTex++; continue; }

      gl.bindBuffer(gl.ARRAY_BUFFER, this._vertexBuffers[i]);
      gl.vertexAttribPointer(program.a_pos, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this._uvBuffers[i]);
      gl.vertexAttribPointer(program.a_uv, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._indexBuffers[i]);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[texIdx]);
      gl.uniform1f(program.u_opacity, opacity);

      gl.drawElements(gl.TRIANGLES, this._indexCounts[i], this._indexTypes[i], 0);
      rendered++;
    }

    if(!this._renderLogCount || this._renderLogCount % 60 === 0) {
      _log('渲染统计: 渲染=' + rendered + ' 跳过(无效=' + skippedInvalid + ',不可见=' + skippedVisible + ',透明=' + skippedOpacity + ',无纹理=' + skippedTex + ') 总计=' + renderOrder.length);

    }
    this._renderLogCount = (this._renderLogCount || 0) + 1;

    gl.disable(gl.CULL_FACE);
    gl.disableVertexAttribArray(program.a_pos);
    gl.disableVertexAttribArray(program.a_uv);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  }

  _getRenderOrder() {
    const d = this.drawables;
    // Cubism 4 core: drawOrders是绘制顺序（值越大越先绘制，在后面），renderOrders用于透明排序
    // Cubism 4 core 的 renderOrders 才是最终透明排序；drawOrders 可能全部相同，优先用 renderOrders
    const orders = d.renderOrders || d.drawOrders;
    if(orders) {
      const order = [];
      for(let i = 0; i < d.count; i++) order.push(i);
      order.sort((a, b) => {
        const va = typeof orders.at === 'function' ? orders.at(a) : orders[a];
        const vb = typeof orders.at === 'function' ? orders.at(b) : orders[b];
        return (va || 0) - (vb || 0);
      });
      return order;
    }
    // 兜底：按索引顺序
    const order = [];
    for(let i = 0; i < d.count; i++) order.push(i);
    return order;
  }

  resize(canvasWidth, canvasHeight) {
    this._canvasWidth = canvasWidth;
    this._canvasHeight = canvasHeight;
    // 模型矩阵在getMVP中基于正交投影范围计算，这里不计算
  }

  getMVP(canvasWidth, canvasHeight) {
    const aspect = canvasWidth / canvasHeight;
    // 正交投影：Y范围[-1,1]，X范围[-aspect,aspect]
    const ortho = _mat4Ortho(-aspect, aspect, -1, 1, -1, 1);
    // 基于模型坐标范围计算缩放，适配视口（留5%边距，让模型更大）
    if(this._coordMaxX !== undefined) {
      const modelW = this._coordMaxX - this._coordMinX;
      const modelH = this._coordMaxY - this._coordMinY;
      const centerX = (this._coordMinX + this._coordMaxX) / 2;
      const centerY = (this._coordMinY + this._coordMaxY) / 2;
      // 视口Y方向2个单位，留5%边距即1.9个单位
      const scaleY = 1.9 / modelH;
      const scaleX = (2 * aspect * 0.95) / modelW;
      const scale = Math.min(scaleX, scaleY);
      let m = _mat4Identity();
      // 先平移到原点，再缩放（Cubism Y向上，WebGL正交投影Y也向上，不需要翻转）
      m = _mat4Translate(m, -centerX, -centerY, 0);
      m = _mat4Scale(m, scale, scale, 1);
      if(!this._mvpLogCount || this._mvpLogCount % 120 === 0) {
        _log('getMVP: canvas=' + canvasWidth + 'x' + canvasHeight + ' aspect=' + aspect.toFixed(2) + ' modelW=' + modelW.toFixed(2) + ' modelH=' + modelH.toFixed(2) + ' center=(' + centerX.toFixed(2) + ',' + centerY.toFixed(2) + ') scale=' + scale.toFixed(3));
      }
      this._mvpLogCount = (this._mvpLogCount || 0) + 1;
      return _mat4Multiply(ortho, m);
    }
    return ortho;
  }

  destroy() {
    const gl = this.gl;
    for(let i = 0; i < this._vertexBuffers.length; i++) {
      gl.deleteBuffer(this._vertexBuffers[i]);
      gl.deleteBuffer(this._uvBuffers[i]);
      gl.deleteBuffer(this._indexBuffers[i]);
    }
    for(let i = 0; i < this.textures.length; i++) {
      gl.deleteTexture(this.textures[i]);
    }
    if(this.moc && this.moc.release) {
      try { this.moc.release(); } catch(e) {}
    }
  }
}

// ============ 渲染器类 ============
class Live2DRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
      preserveDrawingBuffer: false
    });
    if(!this.gl) throw new Error('WebGL 不可用');
    this.program = _createProgram(this.gl);
    this.model = null;
    this._animId = null;
    this._lastTime = 0;
    this._running = false;
    _log('渲染器初始化完成');
  }

  async loadModel(model3Url) {
    const baseUrl = model3Url.substring(0, model3Url.lastIndexOf('/') + 1);
    _log('加载模型配置: ' + model3Url);
    const config = await _loadJSON(model3Url);

    // 加载 moc3
    const mocFile = config.FileReferences ? config.FileReferences.Moc : config.moc;
    if(!mocFile) throw new Error('配置中未找到 Moc 文件');
    _log('加载 Moc: ' + mocFile);
    const mocBuffer = await _loadArrayBuffer(baseUrl + mocFile);

    // 解析 moc3
    const core = window.Live2DCubismCore;
    if(!core) throw new Error('Cubism Core 未加载');
    _log('Cubism Core 键: ' + Object.keys(core).join(', '));
    _log('Cubism Core 属性名: ' + Object.getOwnPropertyNames(core).join(', '));
    if(core.Moc) {
      _log('Moc 静态键: ' + Object.keys(core.Moc).join(', '));
      _log('Moc 静态属性名: ' + Object.getOwnPropertyNames(core.Moc).join(', '));
      _log('Moc 原型属性名: ' + (core.Moc.prototype ? Object.getOwnPropertyNames(core.Moc.prototype).join(', ') : '无prototype'));
    }
    // 检查是否有 Vector、Drawable、Parameter 等类
    for(const cls of ['Vector', 'Drawable', 'Parameter', 'Part', 'Moc', 'Model', 'Drawables', 'Parameters', 'Parts', 'CanvasInfo']) {
      if(core[cls]) {
        _log('core.' + cls + ' 存在, 类型=' + typeof core[cls]);
        if(typeof core[cls] === 'function') {
          _log('  ' + cls + ' 静态键: ' + Object.keys(core[cls]).join(', '));
          _log('  ' + cls + ' 原型属性: ' + (core[cls].prototype ? Object.getOwnPropertyNames(core[cls].prototype).join(', ') : '无prototype'));
        }
      }
    }

    // 尝试多种方式创建 Moc 实例
    let moc = null;
    let createMethod = '';
    // 方式1: fromArrayBuffer
    if(core.Moc && typeof core.Moc.fromArrayBuffer === 'function') {
      try { moc = core.Moc.fromArrayBuffer(mocBuffer); createMethod = 'Moc.fromArrayBuffer'; }
      catch(e) { _log('fromArrayBuffer失败: ' + e.message); }
    }
    // 方式2: new Moc(buffer)
    if(!moc && core.Moc) {
      try { moc = new core.Moc(mocBuffer); createMethod = 'new Moc(buffer)'; }
      catch(e) { _log('new Moc(buffer)失败: ' + e.message); }
    }
    // 方式3: new Moc() + 方法初始化
    if(!moc && core.Moc) {
      try {
        const m = new core.Moc();
        if(typeof m.init === 'function') { m.init(mocBuffer); moc = m; createMethod = 'new Moc()+init'; }
        else if(typeof m.load === 'function') { m.load(mocBuffer); moc = m; createMethod = 'new Moc()+load'; }
      } catch(e) { _log('new Moc()+init/load失败: ' + e.message); }
    }
    // 方式4: core.createMoc
    if(!moc && typeof core.createMoc === 'function') {
      try { moc = core.createMoc(mocBuffer); createMethod = 'core.createMoc'; }
      catch(e) { _log('core.createMoc失败: ' + e.message); }
    }
    if(!moc) throw new Error('所有Moc创建方式均失败');
    _log('Moc创建方式: ' + createMethod);
    _log('Moc实例自身键: ' + Object.keys(moc).join(', '));
    _log('Moc实例属性名: ' + Object.getOwnPropertyNames(moc).join(', '));
    const proto = Object.getPrototypeOf(moc);
    _log('Moc原型属性名: ' + (proto ? Object.getOwnPropertyNames(proto).join(', ') : '无原型'));

    // 尝试用 core.Model 创建高层模型实例（Cubism 4 core的高层API在Model上）
    let model = null;
    let modelCreateMethod = '';
    if(core.Model) {
      // 方式1: Model.fromMoc(moc)
      if(typeof core.Model.fromMoc === 'function') {
        try { model = core.Model.fromMoc(moc); modelCreateMethod = 'Model.fromMoc'; }
        catch(e) { _log('Model.fromMoc失败: ' + e.message); }
      }
      // 方式2: new Model(moc)
      if(!model) {
        try { model = new core.Model(moc); modelCreateMethod = 'new Model(moc)'; }
        catch(e) { _log('new Model(moc)失败: ' + e.message); }
      }
      // 方式3: Model.create(moc)
      if(!model && typeof core.Model.create === 'function') {
        try { model = core.Model.create(moc); modelCreateMethod = 'Model.create'; }
        catch(e) { _log('Model.create失败: ' + e.message); }
      }
      // 方式4: Model.fromArrayBuffer(buffer)
      if(!model && typeof core.Model.fromArrayBuffer === 'function') {
        try { model = core.Model.fromArrayBuffer(mocBuffer); modelCreateMethod = 'Model.fromArrayBuffer'; }
        catch(e) { _log('Model.fromArrayBuffer失败: ' + e.message); }
      }
    }
    if(model) {
      _log('Model创建方式: ' + modelCreateMethod);
      _log('Model实例自身键: ' + Object.keys(model).join(', '));
      _log('Model实例属性名: ' + Object.getOwnPropertyNames(model).join(', '));
      const mproto = Object.getPrototypeOf(model);
      _log('Model原型属性名: ' + (mproto ? Object.getOwnPropertyNames(mproto).join(', ') : '无原型'));
    } else {
      _log('无法创建Model实例，将直接使用Moc实例');
    }

    // 决定用哪个对象来获取drawables和parameters
    const target = model || moc;
    const targetName = model ? 'Model' : 'Moc';

    // 全面探测所有可能的属性和方法
    const allProbes = ['drawables','parameters','parts','artMeshes','deformers','getDrawables','getParameters','getParts','getArtMeshes','count','size','update','revive','canRevive','isRevived','release','destroy','dispose','_drawables','_parameters','_parts'];
    for(const p of allProbes) {
      const v = target[p];
      if(typeof v !== 'undefined') {
        _log('  ' + targetName + '.' + p + ' = ' + typeof v + (typeof v === 'function' ? ' (函数)' : (v && typeof v === 'object' ? ', 键=' + Object.keys(v).join(',') : '')));
      }
    }

    // 尝试调用可能的getter方法
    function tryGet(obj, names) {
      for(const n of names) {
        try {
          if(typeof obj[n] === 'function') { const r = obj[n](); if(r) return r; }
          else if(obj[n]) return obj[n];
        } catch(e) {}
      }
      return null;
    }

    // 先尝试revive
    if(typeof target.revive === 'function') {
      try { target.revive(); _log('调用' + targetName + '.revive()成功'); }
      catch(e) { _log(targetName + '.revive()异常: ' + e.message); }
    } else if(typeof target.canRevive === 'function') {
      try { if(target.canRevive()) { target.revive(); _log('调用canRevive->revive成功'); } }
      catch(e) { _log('canRevive异常: ' + e.message); }
    }

    // 尝试获取drawables
    let drawables = tryGet(target, ['drawables','getDrawables','_drawables']);
    // 尝试静态方法
    if(!drawables && core.Model && typeof core.Model.getDrawables === 'function') {
      try { drawables = core.Model.getDrawables(target); } catch(e) {}
    }
    if(!drawables && core.Drawables) {
      try { drawables = new core.Drawables(target); _log('用new core.Drawables(target)创建'); } catch(e) {}
    }
    _log('drawables获取结果: ' + (drawables ? ('类型=' + typeof drawables + ', 键=' + Object.keys(drawables).join(',') + ', count=' + (drawables.count !== undefined ? drawables.count : (drawables.size !== undefined ? drawables.size : '未知'))) : 'null/undefined'));

    // 尝试获取parameters
    let parameters = tryGet(target, ['parameters','getParameters','_parameters']);
    if(!parameters && core.Model && typeof core.Model.getParameters === 'function') {
      try { parameters = core.Model.getParameters(target); } catch(e) {}
    }
    if(!parameters && core.Parameters) {
      try { parameters = new core.Parameters(target); _log('用new core.Parameters(target)创建'); } catch(e) {}
    }
    _log('parameters获取结果: ' + (parameters ? ('类型=' + typeof parameters + ', 键=' + Object.keys(parameters).join(',') + ', count=' + (parameters.count !== undefined ? parameters.count : (parameters.size !== undefined ? parameters.size : '未知'))) : 'null/undefined'));

    if(!drawables) {
      _err('无法获取drawables! target=' + targetName + '，请检查上方日志中的' + targetName + '原型属性名');
      throw new Error('无法获取drawables，target=' + targetName + '，原型属性=' + (Object.getPrototypeOf(target) ? Object.getOwnPropertyNames(Object.getPrototypeOf(target)).join(',') : '无'));
    }

    // 把获取到的drawables和parameters挂到target上（统一接口）
    if(!target.drawables && drawables) target.drawables = drawables;
    if(!target.parameters && parameters) target.parameters = parameters;

    // 加载纹理
    const textures = [];
    const textureFiles = config.FileReferences ? config.FileReferences.Textures : config.textures;
    if(textureFiles && textureFiles.length) {
      for(let i = 0; i < textureFiles.length; i++) {
        _log('加载纹理 ' + (i+1) + '/' + textureFiles.length + ': ' + textureFiles[i]);
        const tex = await _loadTexture(this.gl, baseUrl + textureFiles[i]);
        textures.push(tex);
      }
    }

    this.model = new Live2DModel(this.gl, target, textures, config);
    this.resize();
    _log('模型加载完成');
    return this.model;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = this.canvas.clientWidth || this.canvas.width;
    let h = this.canvas.clientHeight || this.canvas.height;
    // 安全限制：canvas尺寸不超过屏幕尺寸的2倍，且不小于300px（避免尺寸太小导致马赛克）
    const maxW = Math.min(window.innerWidth * 2, 4096);
    const maxH = Math.min(window.innerHeight * 2, 4096);
    const minW = 300, minH = 300;
    if (w <= 0 || w > maxW || h <= 0 || h > maxH || w < minW || h < minH) {
      console.warn('[AevumLive2D] canvas尺寸异常，使用限制尺寸:', w, 'x', h);
      w = Math.max(Math.min(w || 400, maxW), minW);
      h = Math.max(Math.min(h || 600, maxH), minH);
    }
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    if(this.model) this.model.resize(this.canvas.width, this.canvas.height);
    console.log('[AevumLive2D] resize:', w, 'x', h, '->', this.canvas.width, 'x', this.canvas.height, 'dpr=', dpr);
  }

  start() {
    if(this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    const loop = (now) => {
      if(!this._running) return;
      const dt = Math.min((now - this._lastTime) / 1000, 0.1);
      this._lastTime = now;
      this._render(dt);
      this._animId = requestAnimationFrame(loop);
    };
    this._animId = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    if(this._animId) {
      cancelAnimationFrame(this._animId);
      this._animId = null;
    }
  }

  _render(dt) {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if(!this.model) return;
    this.model.update(dt);
    const mvp = this.model.getMVP(this.canvas.width, this.canvas.height);
    this.model.render(gl, this.program, mvp);
  }

  // 单帧推进，供无 requestAnimationFrame 的测试页做固定时间验证。
  renderFrame(dt) {
    this._render(dt || 0);
  }

  setLookTarget(x, y) {
    if(this.model) this.model.setLookTarget(x, y);
  }

  async loadMotion(url) {
    const response = await fetch(url);
    if(!response.ok) throw new Error('motion3 加载失败: ' + response.status + ' ' + url);
    const json = await response.json();
    const Motion = window.AEVUM && window.AEVUM.formats && window.AEVUM.formats.Live2DMotion;
    if(!Motion) throw new Error('Live2DMotion 未加载');
    return new Motion(json);
  }

  setMotion(motion, options) {
    if(this.model) this.model.setMotion(motion, options);
  }

  setMotionTime(time) {
    if(this.model) this.model.setMotionTime(time);
  }

  stopMotion() {
    if(this.model) this.model.stopMotion();
  }

  triggerBlink() { if(this.model) this.model.triggerBlink(); }
  triggerWave(side) { if(this.model) return this.model.triggerWave(side); return false; }
  triggerNod() { if(this.model) this.model.triggerNod(); }
  triggerShake() { if(this.model) this.model.triggerShake(); }
  setEmotion(emotion) { if(this.model) this.model.setEmotion(emotion); }
  setTalkVolume(vol) { if(this.model) this.model.setTalkVolume(vol); }
  updateParams(params) { if(this.model) this.model.updateParams(params); }
  getModel() { return this.model; }

  destroy() {
    this.stop();
    if(this.model) {
      this.model.destroy();
      this.model = null;
    }
    if(this.program) {
      this.gl.deleteProgram(this.program.program);
      this.program = null;
    }
  }
}

// ============ 全局导出 ============
window.Live2DRenderer = Live2DRenderer;
window.Live2DModel = Live2DModel;
window.AEVUM = window.AEVUM || {};
window.AEVUM.render = window.AEVUM.render || {};
window.AEVUM.render.Live2DRenderer = Live2DRenderer;

// 检查 Cubism Core 是否加载
if(typeof window.Live2DCubismCore === 'undefined') {
  _err('警告: Cubism Core (live2dcubismcore.min.js) 未加载');
} else {
  _log('Cubism Core 已检测, 版本: ' + (window.Live2DCubismCore.Version || 'unknown'));
}

})();
