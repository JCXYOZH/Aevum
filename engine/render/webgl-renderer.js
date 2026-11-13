/**
 * Aevum 渲染引擎 - 最小 WebGL2 模型渲染器
 *
 * 输入 PMXParser 的模型对象（网格 + 材质 + 骨骼），完成：
 *   - 交错顶点缓冲上传
 *   - 逐材质绘制
 *   - 4 骨骼蒙皮
 *   - 基础方向光 + 贴图
 *
 * 这是渲染管线的第一版：基础 PBR/MMD 材质、toon 渐变、sphere 球面贴图、
 * edge 描边和透明裁剪。暂不包含物理、完整材质排序和 morph 动画。
 *
 * @module Aevum/render/webgl-renderer
 */
(function (root) {
  'use strict';

  // 骨骼矩阵写入 float 纹理，避免 uniform 数组 700 根左右的硬件上限。
  const BONE_TEXTURE_WIDTH = 1024;
  const VERTEX_STRIDE = 16; // position3 + normal3 + uv2 + boneIndex4 + weight4

  function getMath() {
    if (root.AEVUM && root.AEVUM.math) return root.AEVUM.math;
    if (typeof require === 'function') return require('../orb/math.js');
    throw new Error('Aevum math core is not loaded');
  }

  function getTGA() {
    if (root.AEVUM && root.AEVUM.formats && root.AEVUM.formats.tga) return root.AEVUM.formats.tga;
    if (typeof require === 'function') return require('../formats/tga.js');
    throw new Error('Aevum TGA decoder is not loaded');
  }

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error('Shader compile failed: ' + message);
    }
    return shader;
  }

  function createProgram(gl, vertexSource, fragmentSource) {
    const program = gl.createProgram();
    gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error('Program link failed: ' + message);
    }
    return program;
  }

  class AevumRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: true,
        depth: true,
        stencil: false,
        premultipliedAlpha: false
      });
      if (!this.gl) throw new Error('WebGL2 is not available');

      this.math = getMath();
      this.program = createProgram(this.gl, AevumRenderer.VERTEX_SHADER, AevumRenderer.FRAGMENT_SHADER);
      this.locations = {
        viewProj: this.gl.getUniformLocation(this.program, 'uViewProj'),
        model: this.gl.getUniformLocation(this.program, 'uModel'),
        boneTex: this.gl.getUniformLocation(this.program, 'uBoneTex'),
        boneTexSize: this.gl.getUniformLocation(this.program, 'uBoneTexSize'),
        diffuse: this.gl.getUniformLocation(this.program, 'uDiffuse'),
        texture: this.gl.getUniformLocation(this.program, 'uTexture'),
        hasTexture: this.gl.getUniformLocation(this.program, 'uHasTexture'),
        alphaTest: this.gl.getUniformLocation(this.program, 'uAlphaTest'),
        lightOn: this.gl.getUniformLocation(this.program, 'uLightOn'),
        view: this.gl.getUniformLocation(this.program, 'uView'),
        viewport: this.gl.getUniformLocation(this.program, 'uViewport'),
        isOutline: this.gl.getUniformLocation(this.program, 'uIsOutline'),
        outlineWidth: this.gl.getUniformLocation(this.program, 'uOutlineWidth'),
        outlineColor: this.gl.getUniformLocation(this.program, 'uOutlineColor'),
        toon: this.gl.getUniformLocation(this.program, 'uToon'),
        hasToon: this.gl.getUniformLocation(this.program, 'uHasToon'),
        sphere: this.gl.getUniformLocation(this.program, 'uSphere'),
        hasSphere: this.gl.getUniformLocation(this.program, 'uHasSphere'),
        sphereMode: this.gl.getUniformLocation(this.program, 'uSphereMode')
      };
      this.attributes = {
        position: this.gl.getAttribLocation(this.program, 'aPosition'),
        normal: this.gl.getAttribLocation(this.program, 'aNormal'),
        uv: this.gl.getAttribLocation(this.program, 'aUv'),
        boneIndex: this.gl.getAttribLocation(this.program, 'aBoneIndex'),
        weight: this.gl.getAttribLocation(this.program, 'aWeight')
      };

      this.model = null;
      this.buffers = null;
      this.baseVertexData = null;
      this.vertexData = null;
      this.morphBonePose = null;
      this.morphStats = null;
      this.textures = [];
      this.sharedToonTextures = [];
      this.options = { texture: true, light: true, wireframe: false, flipY: false, toon: true, sphere: true, outline: true };
      this.boneMatrices = new Float32Array(0);
      this.boneTexture = this.gl.createTexture();
      this.boneTexWidth = 0;
      this.boneTexHeight = 0;
      this.boneTexData = null;
      this.viewMatrix = this.math.M4.create();
      this.viewProj = this.math.M4.create();
      this.modelMatrix = this.math.M4.create();
      this.camera = { eye: [0, 10, 30], target: [0, 10, 0], fov: Math.PI / 4 };

      this.gl.enable(this.gl.DEPTH_TEST);
      this.gl.enable(this.gl.CULL_FACE);
      this.gl.cullFace(this.gl.BACK);
      this.gl.clearColor(0.04, 0.06, 0.09, 1);
    }

    async loadPMX(parsed, textureUrls, options) {
      const opts = options || {};
      const gl = this.gl;
      const math = this.math;
      const model = parsed;

      this.model = model;
      this.boneMatrices = new Float32Array(Math.max(1, model.boneCount) * 16);
      this._initBoneTexture(model.boneCount);
      this.buffers = this._createBuffers(model);
      this.baseVertexData = this.buffers.vertexData;
      this.vertexData = new Float32Array(this.baseVertexData.length);
      this.morphBonePose = null;
      this.morphStats = null;
      this._fitCamera(model);
      if (opts.rotateY != null) {
        math.M4.identity(this.modelMatrix);
        const q = math.Q.create();
        math.Q.fromAxisAngle(q, [0, 1, 0], opts.rotateY);
        math.Q.toMat4(this.modelMatrix, q);
      } else {
        math.M4.identity(this.modelMatrix);
      }

      this.textures = await this._loadTextures(textureUrls || []);
      this._createSharedToonTextures();
      this.computeBoneMatrices(null);
      return this;
    }

    _initBoneTexture(boneCount) {
      const gl = this.gl;
      const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || BONE_TEXTURE_WIDTH;
      let width = Math.min(BONE_TEXTURE_WIDTH, maxSize);
      width -= width % 4;
      if (width < 4) width = 4;
      const height = Math.max(1, Math.ceil((boneCount * 4) / width));
      this.boneTexWidth = width;
      this.boneTexHeight = height;
      this.boneTexData = new Float32Array(width * height * 4);
      gl.bindTexture(gl.TEXTURE_2D, this.boneTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
    }

    _uploadBoneTexture() {
      if (!this.boneTexture || !this.boneTexData) return;
      const data = this.boneTexData;
      const mats = this.boneMatrices;
      const count = Math.min(this.model.boneCount, mats.length / 16);
      data.fill(0);
      for (let i = 0; i < count; i += 1) {
        for (let column = 0; column < 4; column += 1) {
          const src = i * 16 + column * 4;
          const dst = (i * 4 + column) * 4;
          data[dst] = mats[src];
          data[dst + 1] = mats[src + 1];
          data[dst + 2] = mats[src + 2];
          data[dst + 3] = mats[src + 3];
        }
      }
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.boneTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texSubImage2D(
        gl.TEXTURE_2D, 0, 0, 0, this.boneTexWidth, this.boneTexHeight,
        gl.RGBA, gl.FLOAT, data
      );
    }

    _createBuffers(model) {
      const gl = this.gl;
      const count = model.vertexCount;
      const vertexData = new Float32Array(count * VERTEX_STRIDE);
      const indices = new Uint32Array(model.indexCount);
      const boneCount = Math.max(1, model.boneCount);

      for (let i = 0; i < count; i++) {
        const v = model.vertices[i];
        const base = i * VERTEX_STRIDE;
        vertexData[base] = v.position[0];
        vertexData[base + 1] = v.position[1];
        vertexData[base + 2] = v.position[2];
        vertexData[base + 3] = v.normal[0];
        vertexData[base + 4] = v.normal[1];
        vertexData[base + 5] = v.normal[2];
        vertexData[base + 6] = v.uv[0];
        vertexData[base + 7] = v.uv[1];
        for (let j = 0; j < 4; j++) {
          const index = v.boneIndices[j];
          const weight = v.boneWeights[j] || 0;
          vertexData[base + 8 + j] = (index >= 0 && index < boneCount) ? index : 0;
          vertexData[base + 12 + j] = (index >= 0 && index < boneCount) ? weight : 0;
        }
      }

      for (let i = 0; i < model.indexCount; i++) indices[i] = model.indices[i];

      // 线框用逐三角形三边索引，不能把三角形索引直接按 LINES 绘制。
      const lineIndices = new Uint32Array(model.indexCount * 2);
      let lineWrite = 0;
      for (let i = 0; i + 2 < model.indexCount; i += 3) {
        const a = indices[i];
        const b = indices[i + 1];
        const c = indices[i + 2];
        lineIndices[lineWrite++] = a;
        lineIndices[lineWrite++] = b;
        lineIndices[lineWrite++] = b;
        lineIndices[lineWrite++] = c;
        lineIndices[lineWrite++] = c;
        lineIndices[lineWrite++] = a;
      }

      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);

      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

      const lineIbo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineIbo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lineIndices, gl.STATIC_DRAW);

      const strideBytes = VERTEX_STRIDE * 4;
      const attrs = this.attributes;
      gl.enableVertexAttribArray(attrs.position);
      gl.vertexAttribPointer(attrs.position, 3, gl.FLOAT, false, strideBytes, 0);
      gl.enableVertexAttribArray(attrs.normal);
      gl.vertexAttribPointer(attrs.normal, 3, gl.FLOAT, false, strideBytes, 12);
      gl.enableVertexAttribArray(attrs.uv);
      gl.vertexAttribPointer(attrs.uv, 2, gl.FLOAT, false, strideBytes, 24);
      gl.enableVertexAttribArray(attrs.boneIndex);
      gl.vertexAttribPointer(attrs.boneIndex, 4, gl.FLOAT, false, strideBytes, 32);
      gl.enableVertexAttribArray(attrs.weight);
      gl.vertexAttribPointer(attrs.weight, 4, gl.FLOAT, false, strideBytes, 48);

      const materials = [];
      let offset = 0;
      for (let i = 0; i < model.materials.length; i++) {
        const material = model.materials[i];
        const count = material.surfaceCount || 0;
        if (count <= 0) continue;
        const alpha = material.diffuse[3] == null ? 1 : material.diffuse[3];
        if (alpha === 0) {
          offset += count;
          continue;
        }
        materials.push({
          index: i,
          offset,
          count,
          diffuse: material.diffuse,
          textureIndex: material.textureIndex,
          sphereTextureIndex: material.sphereTextureIndex,
          sphereMode: material.sphereMode,
          sharedToon: material.sharedToon,
          toonTextureIndex: material.toonTextureIndex,
          edge: (material.flags & 0x10) === 0x10,
          edgeSize: material.edgeSize || 0,
          edgeColor: material.edgeColor || [0, 0, 0, 1],
          alphaBlend: alpha < 1,
          doubleSided: (material.flags & 0x01) === 1
        });
        offset += count;
      }

      return { vbo, ibo, lineIbo, vertexData, indices, materials, indexCount: model.indexCount };
    }

    _fitCamera(model) {
      const p = model.vertices.map(v => v.position);
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < p.length; i++) {
        const v = p[i];
        if (v[0] < minX) minX = v[0];
        if (v[1] < minY) minY = v[1];
        if (v[2] < minZ) minZ = v[2];
        if (v[0] > maxX) maxX = v[0];
        if (v[1] > maxY) maxY = v[1];
        if (v[2] > maxZ) maxZ = v[2];
      }
      const center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
      const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
      this.camera.eye = [center[0], center[1] + size * 0.08, center[2] + size * 1.35];
      this.camera.target = center;
      this.camera.size = size;
      this.camera.near = size * 0.01;
      this.camera.far = size * 10;
    }

    async _loadTextures(urls) {
      const gl = this.gl;
      const textures = [];
      const white = this._createSolidTexture(255, 255, 255, 255);
      for (let i = 0; i < urls.length; i++) {
        if (!urls[i]) {
          textures.push(white);
          continue;
        }
        try {
          let texture;
          // PMX 的 UV 以左上角为原点，默认不翻转；TGA 浏览器不能解码，走自解码。
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, this.options.flipY !== false);
          if (/\.tga(?:[?#]|$)/i.test(urls[i])) {
            const response = await fetch(urls[i]);
            if (!response.ok) throw new Error('Texture fetch failed: ' + urls[i]);
            const decoded = getTGA().decodeTGA(await response.arrayBuffer());
            texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, decoded.width, decoded.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, decoded.data);
          } else {
            const image = await this._loadImage(urls[i]);
            texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
          }
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          textures.push(texture);
        } catch (error) {
          console.warn('PMX texture load failed:', urls[i], error);
          textures.push(white);
        }
      }
      return textures;
    }

    _loadImage(url) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Texture load failed: ' + url));
        image.src = url;
      });
    }

    _createSolidTexture(r, g, b, a) {
      const gl = this.gl;
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0,
        gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([r, g, b, a])
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return texture;
    }

    /**
     * PMX 的 sharedToon 不引用模型贴图，MMD 内置 toon01..toon10。
     * 这里生成同方向的灰度 ramp：底部亮、顶部暗，采样时用 1 - N·L。
     */
    _createSharedToonTextures() {
      const gl = this.gl;
      const shades = [0.42, 0.52, 0.62, 0.72, 0.82, 0.90, 0.58, 0.68, 0.76, 0.86];
      this.sharedToonTextures = [null];
      for (let i = 0; i < shades.length; i++) {
        const data = new Uint8Array(256 * 4);
        const shade = shades[i];
        for (let y = 0; y < 256; y++) {
          const t = y / 255;
          const value = 1 - (1 - shade) * Math.min(1, Math.max(0, (t - 0.32) / 0.36));
          const c = Math.round(Math.max(0, Math.min(1, value)) * 255);
          const offset = y * 4;
          data[offset] = c;
          data[offset + 1] = c;
          data[offset + 2] = c;
          data[offset + 3] = 255;
        }
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.sharedToonTextures.push(texture);
      }
    }

    _updateViewProjection() {
      const math = this.math;
      const width = this.canvas.width || 1;
      const height = this.canvas.height || 1;
      const aspect = width / height;
      const view = this.viewMatrix;
      const proj = math.M4.create();
      // 与 tests/orb-math-smoke.html 相同的组合顺序，保持整套引擎一致。
      math.M4.lookAt(view, this.camera.eye, this.camera.target, [0, 1, 0]);
      math.M4.perspective(proj, this.camera.fov, aspect, this.camera.near, this.camera.far);
      math.M4.mult(this.viewProj, view, proj);
      this.lastViewProj = this.viewProj;
    }

    /**
     * 生成骨骼蒙皮矩阵。
     * pose 形如 { [boneIndex]: { rotation: [x,y,z,w], translation: [x,y,z] } }。
     */
    computeBoneMatrices(pose) {
      const model = this.model;
      if (!model) return this.boneMatrices;
      const math = this.math;
      const count = model.boneCount;
      const restGlobal = new Array(count);
      const animGlobal = new Array(count);
      const mats = this.boneMatrices;
      mats.fill(0);

      const identity = math.M4.identity(math.M4.create());
      const restMemo = new Array(count);
      const animMemo = new Array(count);
      const resolving = new Array(count).fill(false);

      function getRest(index) {
        if (index < 0 || index >= count) return identity;
        if (restMemo[index]) return restMemo[index];
        if (resolving[index]) return identity;
        resolving[index] = true;
        const bone = model.bones[index];
        const parent = getRest(bone.parentIndex);
        const local = math.M4.fromTRS(
          math.M4.create(),
          [
            bone.position[0] - (bone.parentIndex >= 0 ? model.bones[bone.parentIndex].position[0] : 0),
            bone.position[1] - (bone.parentIndex >= 0 ? model.bones[bone.parentIndex].position[1] : 0),
            bone.position[2] - (bone.parentIndex >= 0 ? model.bones[bone.parentIndex].position[2] : 0)
          ],
          math.Q.identity(math.Q.create())
        );
        restMemo[index] = math.M4.mult(math.M4.create(), local, parent);
        resolving[index] = false;
        return restMemo[index];
      }

      function getAnim(index) {
        if (index < 0 || index >= count) return identity;
        if (animMemo[index]) return animMemo[index];
        if (resolving[index]) return identity;
        resolving[index] = true;
        const bone = model.bones[index];
        const parent = getAnim(bone.parentIndex);
        const p = pose && pose[index];
        const translation = p && p.translation ? p.translation : [0, 0, 0];
        const rotation = p && p.rotation ? p.rotation : math.Q.identity(math.Q.create());
        const parentPosition = bone.parentIndex >= 0 ? model.bones[bone.parentIndex].position : [0, 0, 0];
        const local = math.M4.fromTRS(
          math.M4.create(),
          [
            bone.position[0] - parentPosition[0] + translation[0],
            bone.position[1] - parentPosition[1] + translation[1],
            bone.position[2] - parentPosition[2] + translation[2]
          ],
          rotation
        );
        animMemo[index] = math.M4.mult(math.M4.create(), local, parent);
        resolving[index] = false;
        return animMemo[index];
      }

      for (let i = 0; i < count; i++) {
        const rest = getRest(i);
        const anim = getAnim(i);
        const invRest = math.M4.invert(math.M4.create(), rest);
        // 蒙皮矩阵必须是 inverseBind * pose；顺序反了会让旋转绕世界原点放大。
        const skin = math.M4.mult(math.M4.create(), invRest, anim);
        mats.set(skin, i * 16);
      }
      this._uploadBoneTexture();
      return mats;
    }

    /**
     * 应用 PMX 变形权重。
     * 顶点变形直接更新交错 VBO 的位置分量；骨骼变形转成 pose 叠加。
     * @param {Object|Array} weights morph 索引 -> 权重，或按索引排列的数组
     * @returns {Object} 统计信息
     */
    setMorphWeights(weights) {
      if (!this.model || !this.buffers) return null;
      const morphApi = root.AEVUM && root.AEVUM.render && root.AEVUM.render.PMXMorph;
      if (!morphApi) throw new Error('PMXMorph 未加载');
      const result = morphApi.apply(this.model, weights);
      const data = this.vertexData;
      data.set(this.baseVertexData);
      for (let i = 0; i < this.model.vertexCount; i++) {
        const base = i * VERTEX_STRIDE;
        data[base] = result.positions[i * 3];
        data[base + 1] = result.positions[i * 3 + 1];
        data[base + 2] = result.positions[i * 3 + 2];
      }
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
      this.morphBonePose = result.bonePose;
      this.morphStats = result.stats;
      return result.stats;
    }

    _mergeMorphPose(pose) {
      if (!this.morphBonePose) return pose;
      const indices = Object.keys(this.morphBonePose);
      if (!indices.length) return pose;
      const math = this.math;
      const merged = {};
      if (pose) {
        for (const key in pose) {
          if (Object.prototype.hasOwnProperty.call(pose, key)) merged[key] = pose[key];
        }
      }
      for (let i = 0; i < indices.length; i++) {
        const index = Number(indices[i]);
        const morph = this.morphBonePose[index];
        const current = merged[index] || {};
        const translation = current.translation ? current.translation.slice() : [0, 0, 0];
        translation[0] += morph.translation[0];
        translation[1] += morph.translation[1];
        translation[2] += morph.translation[2];
        const rotation = current.rotation
          ? current.rotation
          : math.Q.identity(math.Q.create());
        merged[index] = {
          translation,
          rotation: math.Q.mult(math.Q.create(), morph.rotation, rotation)
        };
      }
      return merged;
    }

    render(time, pose) {
      const gl = this.gl;
      if (!this.model || !this.buffers) return;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this._updateViewProjection();
      const effectivePose = this._mergeMorphPose(pose);
      if (effectivePose) this.computeBoneMatrices(effectivePose);

      gl.useProgram(this.program);
      gl.uniformMatrix4fv(this.locations.viewProj, false, this.viewProj);
      gl.uniformMatrix4fv(this.locations.view, false, this.viewMatrix);
      gl.uniformMatrix4fv(this.locations.model, false, this.modelMatrix);
      gl.uniform2f(this.locations.viewport, this.canvas.width || 1, this.canvas.height || 1);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.boneTexture);
      gl.uniform1i(this.locations.boneTex, 1);
      gl.uniform2i(this.locations.boneTexSize, this.boneTexWidth, this.boneTexHeight);
      gl.uniform1f(this.locations.lightOn, this.options.light ? 1 : 0);
      gl.uniform1i(this.locations.toon, 2);
      gl.uniform1i(this.locations.sphere, 3);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.options.wireframe ? this.buffers.lineIbo : this.buffers.ibo);

      // 第一遍：背面外扩描边。只画 PMX edge flag 打开的材质。
      gl.uniform1i(this.locations.isOutline, this.options.outline && !this.options.wireframe ? 1 : 0);
      gl.uniform1i(this.locations.hasTexture, 0);
      gl.uniform1i(this.locations.hasToon, 0);
      gl.uniform1i(this.locations.hasSphere, 0);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.FRONT);
      if (this.options.outline && !this.options.wireframe) {
        for (let i = 0; i < this.buffers.materials.length; i++) {
          const material = this.buffers.materials[i];
          if (!material.edge || !material.edgeSize) continue;
          const edgeColor = material.edgeColor || [0, 0, 0, 1];
          if (edgeColor[3] <= 0.01) continue;
          const width = Math.min(4, Math.max(0.35, material.edgeSize * 0.8));
          gl.uniform1f(this.locations.outlineWidth, width);
          gl.uniform4f(this.locations.outlineColor, edgeColor[0], edgeColor[1], edgeColor[2], edgeColor[3]);
          gl.drawElements(gl.TRIANGLES, material.count, gl.UNSIGNED_INT, material.offset * 4);
        }
      }

      // 第二遍：正常材质，toon + sphere + diffuse。
      gl.uniform1i(this.locations.isOutline, 0);
      gl.cullFace(gl.BACK);
      for (let i = 0; i < this.buffers.materials.length; i++) {
        const material = this.buffers.materials[i];
        const diffuse = material.diffuse || [1, 1, 1, 1];
        gl.uniform4f(this.locations.diffuse, diffuse[0], diffuse[1], diffuse[2], diffuse[3]);
        gl.uniform1f(this.locations.alphaTest, 0.08);
        const texture = this.options.texture ? this.textures[material.textureIndex] : null;
        if (texture) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.uniform1i(this.locations.texture, 0);
          gl.uniform1i(this.locations.hasTexture, 1);
        } else {
          gl.uniform1i(this.locations.hasTexture, 0);
        }

        let toonTexture = null;
        if (this.options.toon && !this.options.wireframe) {
          toonTexture = material.sharedToon
            ? this.sharedToonTextures[material.toonTextureIndex]
            : this.textures[material.toonTextureIndex];
        }
        if (toonTexture) {
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, toonTexture);
          gl.uniform1i(this.locations.hasToon, 1);
        } else {
          gl.uniform1i(this.locations.hasToon, 0);
        }

        let sphereTexture = null;
        if (this.options.sphere && !this.options.wireframe && material.sphereMode > 0) {
          sphereTexture = this.textures[material.sphereTextureIndex];
        }
        if (sphereTexture) {
          gl.activeTexture(gl.TEXTURE3);
          gl.bindTexture(gl.TEXTURE_2D, sphereTexture);
          gl.uniform1i(this.locations.hasSphere, 1);
          gl.uniform1i(this.locations.sphereMode, material.sphereMode);
        } else {
          gl.uniform1i(this.locations.hasSphere, 0);
        }

        if (material.alphaBlend) {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          gl.depthMask(false);
        } else {
          gl.disable(gl.BLEND);
          gl.depthMask(true);
        }
        if (material.doubleSided) gl.disable(gl.CULL_FACE);
        else gl.enable(gl.CULL_FACE);
        gl.drawElements(this.options.wireframe ? gl.LINES : gl.TRIANGLES, this.options.wireframe ? material.count * 2 : material.count, gl.UNSIGNED_INT, (this.options.wireframe ? material.offset * 2 : material.offset) * 4);
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
    }
  }

  AevumRenderer.VERTEX_STRIDE = VERTEX_STRIDE;

  AevumRenderer.VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUv;
in vec4 aBoneIndex;
in vec4 aWeight;

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat4 uView;
uniform vec2 uViewport;
uniform int uIsOutline;
uniform float uOutlineWidth;
uniform sampler2D uBoneTex;
uniform ivec2 uBoneTexSize;

out vec3 vNormal;
out vec3 vViewNormal;
out vec2 vUv;

mat4 readBone(int index) {
  int base = index * 4;
  int total = uBoneTexSize.x * uBoneTexSize.y;
  if (index < 0 || base + 3 >= total) return mat4(1.0);
  int x = base % uBoneTexSize.x;
  int y = base / uBoneTexSize.x;
  vec4 c0 = texelFetch(uBoneTex, ivec2(x, y), 0);
  vec4 c1 = texelFetch(uBoneTex, ivec2(x + 1, y), 0);
  vec4 c2 = texelFetch(uBoneTex, ivec2(x + 2, y), 0);
  vec4 c3 = texelFetch(uBoneTex, ivec2(x + 3, y), 0);
  return mat4(c0, c1, c2, c3);
}

void main() {
  mat4 skin =
    readBone(int(aBoneIndex.x)) * aWeight.x +
    readBone(int(aBoneIndex.y)) * aWeight.y +
    readBone(int(aBoneIndex.z)) * aWeight.z +
    readBone(int(aBoneIndex.w)) * aWeight.w;
  vec4 worldPosition = uModel * skin * vec4(aPosition, 1.0);
  vec3 worldNormal = mat3(uModel) * mat3(skin) * aNormal;
  vNormal = worldNormal;
  vViewNormal = mat3(uView) * worldNormal;
  vUv = aUv;
  vec4 clipPosition = uViewProj * worldPosition;
  if (uIsOutline == 1) {
    vec2 direction = normalize(vViewNormal.xy + vec2(0.00001));
    clipPosition.xy += direction * (2.0 * uOutlineWidth / max(uViewport, vec2(1.0))) * clipPosition.w;
  }
  gl_Position = clipPosition;
}
`;

  AevumRenderer.FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
in vec3 vNormal;
in vec3 vViewNormal;
in vec2 vUv;

uniform vec4 uDiffuse;
uniform sampler2D uTexture;
uniform int uHasTexture;
uniform float uAlphaTest;
uniform float uLightOn;
uniform int uIsOutline;
uniform vec4 uOutlineColor;
uniform int uHasToon;
uniform sampler2D uToon;
uniform int uHasSphere;
uniform sampler2D uSphere;
uniform int uSphereMode;

out vec4 fragColor;

void main() {
  if (uIsOutline == 1) {
    fragColor = uOutlineColor;
    return;
  }
  vec3 normal = normalize(vNormal);
  vec3 lightDir = normalize(vec3(0.35, 0.85, 0.45));
  float lambert = max(dot(normal, lightDir), 0.0);
  float ambient = 0.42 + 0.18 * max(normal.y, 0.0);
  vec4 color = uDiffuse;
  if (uHasTexture == 1) {
    vec4 texel = texture(uTexture, vUv);
    if (texel.a < uAlphaTest) discard;
    color *= texel;
  }
  if (uHasToon == 1 && uLightOn > 0.5) {
    float ndl = clamp(lambert, 0.02, 0.98);
    vec3 ramp = vec3(
      texture(uToon, vec2(0.5, 1.0 - ndl)).r,
      texture(uToon, vec2(0.5, 1.0 - ndl)).g,
      texture(uToon, vec2(0.5, 1.0 - ndl)).b
    );
    color.rgb *= ramp;
  } else {
    color.rgb *= ambient + 0.62 * lambert * uLightOn;
  }
  if (uHasSphere == 1) {
    vec2 sphereUv = normalize(vViewNormal).xy * 0.5 + 0.5;
    vec4 sphereColor = texture(uSphere, sphereUv);
    if (uSphereMode == 1) {
      color.rgb *= sphereColor.rgb;
    } else if (uSphereMode == 2) {
      color.rgb = min(vec3(1.0), color.rgb + sphereColor.rgb);
    }
  }
  fragColor = color;
}
`;

  function makeIdlePose(model, time) {
    const math = getMath();
    const pose = {};
    const names = {};
    for (let i = 0; i < model.bones.length; i++) names[model.bones[i].name] = i;

    function setRotation(name, x, y, z) {
      const index = names[name];
      if (index == null) return;
      const q = math.Q.create();
      math.Q.fromEuler(q, x, y, z);
      pose[index] = pose[index] || {};
      pose[index].rotation = q;
    }

    const t = time;
    setRotation('センター', 0, Math.sin(t * 0.9) * 0.055, 0);
    setRotation('上半身', Math.sin(t * 1.2) * 0.045, 0, Math.sin(t * 0.8) * 0.035);
    setRotation('首', Math.sin(t * 1.4) * 0.035, 0, Math.sin(t * 0.7) * 0.025);
    setRotation('左肩', 0, 0, -0.18 + Math.sin(t * 1.1) * 0.06);
    setRotation('右肩', 0, 0, 0.18 - Math.sin(t * 1.1) * 0.06);

    function normalize3(v) {
      const length = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
      return [v[0] / length, v[1] / length, v[2] / length];
    }

    function quatFromVectors(from, to) {
      const a = normalize3(from);
      const b = normalize3(to);
      const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      if (dot > 0.9999) return math.Q.identity(math.Q.create());
      if (dot < -0.9999) {
        const q = math.Q.create();
        math.Q.fromAxisAngle(q, [0, 0, 1], Math.PI);
        return q;
      }
      const axis = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
      ];
      const q = math.Q.create();
      const length = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]) || 1;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      math.Q.fromAxisAngle(q, [axis[0] / length, axis[1] / length, axis[2] / length], angle);
      return q;
    }

    function aimArm(upperName, elbowName, target) {
      const upper = names[upperName];
      const elbow = names[elbowName];
      if (upper == null || elbow == null) return;
      const a = model.bones[upper].position;
      const b = model.bones[elbow].position;
      const q = quatFromVectors([b[0] - a[0], b[1] - a[1], b[2] - a[2]], target);
      pose[upper] = pose[upper] || {};
      pose[upper].rotation = q;
    }

    // 上臂从 PMX 的静止外展方向，转到自然下垂方向；略外展、略向前，避开裙摆。
    aimArm('左腕', '左ひじ', [0.4, -0.88, 0.1]);
    aimArm('右腕', '右ひじ', [-0.4, -0.88, 0.1]);
    return pose;
  }

  const api = { AevumRenderer, makeIdlePose };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.AEVUM = root.AEVUM || {};
    root.AEVUM.render = root.AEVUM.render || {};
    root.AEVUM.render.WebGLRenderer = AevumRenderer;
    root.AEVUM.render.makeIdlePose = makeIdlePose;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
