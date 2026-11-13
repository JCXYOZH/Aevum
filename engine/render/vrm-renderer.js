/**
 * Aevum VRM 渲染器
 *
 * 读取 parseVRM 的结果，完成：
 *   - glTF accessor 解码（位置、法线、UV、JOINTS、WEIGHTS、索引）
 *   - 节点层级世界矩阵
 *   - skin + inverseBindMatrices 蒙皮
 *   - 内嵌 PNG 贴图
 *   - 基础方向光
 *   - Humanoid 骨骼的程序化待机动作
 *
 * 只做最小可验证管线，不包含 PBR、MToon、SpringBone 和真实动画文件。
 */
(function (root) {
  'use strict';

  const MAX_BONES = 600;

  function getMath() {
    if (root.AEVUM && root.AEVUM.math) return root.AEVUM.math;
    if (typeof require === 'function') return require('../orb/math.js');
    throw new Error('Aevum math core is not loaded');
  }

  function getAccessor() {
    if (root.AEVUM && root.AEVUM.formats && root.AEVUM.formats.readAccessor) {
      return root.AEVUM.formats.readAccessor;
    }
    if (typeof require === 'function') return require('../formats/gltf-accessor.js').readAccessor;
    throw new Error('Aevum accessor decoder is not loaded');
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

  function toFloat32(array) {
    if (array instanceof Float32Array) return array;
    const result = new Float32Array(array.length);
    result.set(array);
    return result;
  }

  function primitiveData(json, binary, primitive, readAccessor) {
    const attrs = primitive.attributes || {};
    const positions = attrs.POSITION !== undefined ? toFloat32(readAccessor(json, binary, attrs.POSITION)) : null;
    if (!positions) throw new Error('VRM primitive 缺少 POSITION');
    const normals = attrs.NORMAL !== undefined ? toFloat32(readAccessor(json, binary, attrs.NORMAL)) : null;
    const uvs = attrs.TEXCOORD_0 !== undefined ? toFloat32(readAccessor(json, binary, attrs.TEXCOORD_0)) : null;
    const joints = attrs.JOINTS_0 !== undefined ? toFloat32(readAccessor(json, binary, attrs.JOINTS_0)) : null;
    const weights = attrs.WEIGHTS_0 !== undefined ? toFloat32(readAccessor(json, binary, attrs.WEIGHTS_0)) : null;
    const indices = primitive.indices !== undefined
      ? readAccessor(json, binary, primitive.indices)
      : null;
    const indexArray = indices && !(indices instanceof Uint32Array)
      ? new Uint32Array(indices)
      : indices;

    return {
      positions,
      normals,
      uvs,
      joints,
      weights,
      indices: indexArray,
      count: positions.length / 3,
      indexCount: indexArray ? indexArray.length : positions.length / 3,
      material: primitive.material,
      mode: primitive.mode === undefined ? 4 : primitive.mode
    };
  }

  function nodeParentMap(json) {
    const parents = new Int32Array(json.nodes ? json.nodes.length : 0).fill(-1);
    for (let i = 0; i < (json.nodes || []).length; i += 1) {
      const children = json.nodes[i].children || [];
      for (const child of children) parents[child] = i;
    }
    return parents;
  }

  /**
   * 计算 glTF 节点世界矩阵。pose 是 nodeIndex -> 四元数，用于覆盖局部旋转；
   * transforms 可选，提供 nodeIndex -> 平移 / 缩放的覆盖，用于播放 glTF 动作。
   */
  function computeNodeWorld(json, math, pose, transforms) {
    const count = (json.nodes || []).length;
    const world = new Array(count);
    const parents = nodeParentMap(json);
    const visiting = new Uint8Array(count);

    function resolve(index) {
      if (index < 0 || index >= count) return math.M4.identity(math.M4.create());
      if (world[index]) return world[index];
      if (visiting[index]) return math.M4.identity(math.M4.create());
      visiting[index] = 1;
      const node = json.nodes[index];
      const parent = resolve(parents[index]);
      const localTranslation = transforms && transforms.translation && transforms.translation[index];
      const localScale = transforms && transforms.scale && transforms.scale[index];
      const translation = localTranslation || node.translation || [0, 0, 0];
      const scale = localScale || node.scale || [1, 1, 1];
      const restRotation = node.rotation || [0, 0, 0, 1];
      const rotation = pose && pose[index] ? pose[index] : restRotation;
      const local = math.M4.fromTRS(math.M4.create(), translation, rotation, scale);
      // Aevum 的 M4 采用行向量约定，子节点矩阵在左、父节点矩阵在右。
      world[index] = math.M4.mult(math.M4.create(), local, parent);
      visiting[index] = 0;
      return world[index];
    }

    for (let i = 0; i < count; i += 1) resolve(i);
    return world;
  }

  function computeSkinMatrices(vrm, world, meshNodeIndex, meshIndex) {
    const math = getMath();
    const json = vrm.json;
    const meshNode = json.nodes[meshNodeIndex];
    const skin = json.skins && json.skins[meshNode.skin];
    if (!skin) return null;

    const readAccessor = getAccessor();
    const inverseBind = readAccessor(json, vrm.glb.binary, skin.inverseBindMatrices);
    const meshInverse = math.M4.invert(math.M4.create(), world[meshNodeIndex]);
    const matrices = new Float32Array(MAX_BONES * 16);
    for (let i = 0; i < MAX_BONES; i += 1) {
      matrices[i * 16 + 0] = 1;
      matrices[i * 16 + 5] = 1;
      matrices[i * 16 + 10] = 1;
      matrices[i * 16 + 15] = 1;
    }

    const count = Math.min(skin.joints.length, MAX_BONES);
    for (let i = 0; i < count; i += 1) {
      const jointNode = skin.joints[i];
      const ibm = new Float32Array(16);
      ibm.set(inverseBind.subarray(i * 16, i * 16 + 16));
      const jointWorld = world[jointNode] || math.M4.identity(math.M4.create());
      // 行向量：position * IBM * jointWorld * inverse(meshWorld)。
      const result = math.M4.mult(
        math.M4.create(),
        math.M4.mult(math.M4.create(), ibm, jointWorld),
        meshInverse
      );
      matrices.set(result, i * 16);
    }
    return matrices;
  }

  function makeIdlePose(vrm, time) {
    const math = getMath();
    const pose = Object.create(null);
    const nodes = vrm.humanBoneNodes || {};
    const t = time;

    function rotate(name, x, y, z) {
      const index = nodes[name];
      if (index === undefined) return;
      const node = vrm.json.nodes[index];
      const rest = node.rotation || [0, 0, 0, 1];
      const delta = math.Q.fromEuler(math.Q.create(), x, y, z);
      pose[index] = math.Q.mult(math.Q.create(), rest, delta);
    }

    rotate('hips', 0, Math.sin(t * 0.8) * 0.03, 0);
    rotate('spine', Math.sin(t * 1.1) * 0.025, 0, Math.sin(t * 0.7) * 0.02);
    rotate('chest', Math.sin(t * 1.2) * 0.02, 0, 0);
    rotate('neck', Math.sin(t * 1.3) * 0.025, 0, 0);
    rotate('head', Math.sin(t * 1.1) * 0.02, Math.sin(t * 0.9) * 0.025, 0);
    rotate('leftUpperArm', 0, 0, 0.72 + Math.sin(t * 1.2) * 0.03);
    rotate('rightUpperArm', 0, 0, -0.72 - Math.sin(t * 1.2) * 0.03);
    rotate('leftLowerArm', 0, 0, 0);
    rotate('rightLowerArm', 0, 0, 0);
    return pose;
  }

  class VRMRenderer {
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
      this.program = createProgram(this.gl, VRMRenderer.VERTEX_SHADER, VRMRenderer.FRAGMENT_SHADER);
      this.locations = {
        viewProj: this.gl.getUniformLocation(this.program, 'uViewProj'),
        mesh: this.gl.getUniformLocation(this.program, 'uMesh'),
        bones: this.gl.getUniformLocation(this.program, 'uBones[0]'),
        baseColor: this.gl.getUniformLocation(this.program, 'uBaseColor'),
        hasTexture: this.gl.getUniformLocation(this.program, 'uHasTexture'),
        texture: this.gl.getUniformLocation(this.program, 'uTexture'),
        lightDir: this.gl.getUniformLocation(this.program, 'uLightDir'),
        lightOn: this.gl.getUniformLocation(this.program, 'uLightOn')
      };
      this.options = { texture: true, light: true, wireframe: false };
      this.textures = [];
      this.primitives = [];
      this.meshes = [];
      this.bounds = null;
    }

    async loadVRM(vrm) {
      const json = vrm.json;
      const binary = vrm.glb.binary;
      const readAccessor = getAccessor();
      this.vrm = vrm;
      this.bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      this.textures = await this.loadTextures(json, binary);
      const world = computeNodeWorld(json, this.math, null);
      // 蒙皮网格的原始顶点可能使用厘米单位，靠骨骼原点先把整体尺度和位置框住。
      if (json.skins) {
        for (let i = 0; i < json.skins.length; i += 1) {
          const joints = json.skins[i].joints || [];
          for (let j = 0; j < joints.length; j += 1) {
            const jointWorld = world[joints[j]];
            if (!jointWorld) continue;
            this.expandBounds([jointWorld[12], jointWorld[13], jointWorld[14]], null);
          }
        }
      }

      for (let nodeIndex = 0; nodeIndex < json.nodes.length; nodeIndex += 1) {
        const node = json.nodes[nodeIndex];
        if (node.mesh === undefined) continue;
        const mesh = json.meshes[node.mesh];
        const meshEntry = { nodeIndex, meshIndex: node.mesh, primitives: [], skinMatrices: null };
        meshEntry.skinMatrices = computeSkinMatrices(vrm, world, nodeIndex, node.mesh);

        for (const primitive of mesh.primitives) {
          if ((primitive.mode === undefined ? 4 : primitive.mode) !== 4) continue;
          const data = primitiveData(json, binary, primitive, readAccessor);
          this.expandBounds(data.positions, world[nodeIndex]);
          const gpu = this.createPrimitive(data);
          meshEntry.primitives.push(gpu);
        }
        this.meshes.push(meshEntry);
      }

      if (!this.meshes.length) throw new Error('VRM 没有可绘制的三角网格');
      return this;
    }

    expandBounds(positions, matrix) {
      for (let i = 0; i < positions.length; i += 3) {
        const p = [positions[i], positions[i + 1], positions[i + 2], 1];
        // 与 M4 的约定保持一致：矩阵乘向量为 m * v。
        const x = matrix ? matrix[0] * p[0] + matrix[4] * p[1] + matrix[8] * p[2] + matrix[12] : p[0];
        const y = matrix ? matrix[1] * p[0] + matrix[5] * p[1] + matrix[9] * p[2] + matrix[13] : p[1];
        const z = matrix ? matrix[2] * p[0] + matrix[6] * p[1] + matrix[10] * p[2] + matrix[14] : p[2];
        this.bounds.min[0] = Math.min(this.bounds.min[0], x);
        this.bounds.min[1] = Math.min(this.bounds.min[1], y);
        this.bounds.min[2] = Math.min(this.bounds.min[2], z);
        this.bounds.max[0] = Math.max(this.bounds.max[0], x);
        this.bounds.max[1] = Math.max(this.bounds.max[1], y);
        this.bounds.max[2] = Math.max(this.bounds.max[2], z);
      }
    }

    createPrimitive(data) {
      const gl = this.gl;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      function attribute(location, array, size) {
        if (!array) return;
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
      }

      attribute(0, data.positions, 3);
      attribute(1, data.normals, 3);
      attribute(2, data.uvs, 2);
      attribute(3, data.joints, 4);
      attribute(4, data.weights, 4);

      const indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      const indices = data.indices || new Uint32Array(data.count);
      if (!data.indices) for (let i = 0; i < indices.length; i += 1) indices[i] = i;
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

      const material = data.material !== undefined ? this.vrm.json.materials[data.material] : null;
      const textureIndex = material && material.pbrMetallicRoughness && material.pbrMetallicRoughness.baseColorTexture
        ? material.pbrMetallicRoughness.baseColorTexture.index
        : -1;
      const baseColor = material && material.pbrMetallicRoughness && material.pbrMetallicRoughness.baseColorFactor
        ? material.pbrMetallicRoughness.baseColorFactor
        : [1, 1, 1, 1];
      const alphaMode = material ? material.alphaMode || 'OPAQUE' : 'OPAQUE';
      const doubleSided = material ? material.doubleSided !== false : true;

      gl.bindVertexArray(null);
      return {
        vao,
        indexCount: data.indexCount,
        texture: textureIndex >= 0 ? this.textures[textureIndex] : null,
        baseColor,
        alphaMode,
        doubleSided
      };
    }

    async loadTextures(json, binary) {
      const gl = this.gl;
      const textures = [];
      const images = json.images || [];
      for (let i = 0; i < images.length; i += 1) {
        const imageDef = images[i];
        if (imageDef.bufferView === undefined) {
          textures.push(null);
          continue;
        }
        try {
          const view = json.bufferViews[imageDef.bufferView];
          const bytes = new Uint8Array(binary, view.byteOffset || 0, view.byteLength);
          const blob = new Blob([bytes], { type: imageDef.mimeType || 'image/png' });
          const url = URL.createObjectURL(blob);
          const image = new Image();
          image.src = url;
          await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = reject;
          });
          const texture = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          textures.push(texture);
          URL.revokeObjectURL(url);
        } catch (error) {
          textures.push(null);
        }
      }
      return textures;
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.floor(this.canvas.clientWidth * dpr);
      const height = Math.floor(this.canvas.clientHeight * dpr);
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
    }

    render(time, pose, transforms) {
      const gl = this.gl;
      const math = this.math;
      this.resize();
      const width = this.canvas.width;
      const height = this.canvas.height;
      gl.viewport(0, 0, width, height);
      gl.clearColor(0.03, 0.045, 0.07, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);

      const world = computeNodeWorld(this.vrm.json, math, pose || null, transforms || null);
      const center = [
        (this.bounds.min[0] + this.bounds.max[0]) / 2,
        (this.bounds.min[1] + this.bounds.max[1]) / 2,
        (this.bounds.min[2] + this.bounds.max[2]) / 2
      ];
      const size = Math.max(
        this.bounds.max[0] - this.bounds.min[0],
        this.bounds.max[1] - this.bounds.min[1],
        this.bounds.max[2] - this.bounds.min[2]
      );
      const distance = size * 2.2 / (this.zoom || 1);
      const yaw = this.viewYaw || 0;
      const eye = [
        center[0] + Math.sin(yaw) * distance,
        center[1] + size * 0.03,
        center[2] - Math.cos(yaw) * distance
      ];
      const view = math.M4.lookAt(math.M4.create(), eye, center, [0, 1, 0]);
      const projection = math.M4.perspective(
        math.M4.create(),
        35 * Math.PI / 180,
        width / (height || 1),
        0.01,
        size * 10 + 10
      );
      const viewProj = math.M4.mult(math.M4.create(), view, projection);
      this.lastViewProj = viewProj;

      gl.useProgram(this.program);
      gl.uniformMatrix4fv(this.locations.viewProj, false, viewProj);
      gl.uniform3fv(this.locations.lightDir, [0.4, 0.8, 0.5]);
      gl.uniform1f(this.locations.lightOn, this.options.light ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(this.locations.texture, 0);

      for (const mesh of this.meshes) {
        const meshWorld = world[mesh.nodeIndex];
        const boneMatrices = computeSkinMatrices(this.vrm, world, mesh.nodeIndex, mesh.meshIndex);
        gl.uniformMatrix4fv(this.locations.mesh, false, meshWorld);
        if (boneMatrices) gl.uniformMatrix4fv(this.locations.bones, false, boneMatrices);

        for (const primitive of mesh.primitives) {
          gl.bindVertexArray(primitive.vao);
          gl.uniform4fv(this.locations.baseColor, primitive.baseColor);
          gl.uniform1i(this.locations.hasTexture, this.options.texture && primitive.texture ? 1 : 0);
          if (primitive.texture) gl.bindTexture(gl.TEXTURE_2D, primitive.texture);

          if (primitive.alphaMode === 'BLEND') {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.depthMask(false);
          } else {
            gl.disable(gl.BLEND);
            gl.depthMask(true);
          }
          if (primitive.alphaMode === 'MASK') {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          }
          gl.drawElements(this.options.wireframe ? gl.LINES : gl.TRIANGLES, primitive.indexCount, gl.UNSIGNED_INT, 0);
        }
      }
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }
  }

  VRMRenderer.VERTEX_SHADER = `#version 300 es
precision highp float;
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUv;
in vec4 aJoints;
in vec4 aWeights;
uniform mat4 uViewProj;
uniform mat4 uMesh;
uniform mat4 uBones[600];
out vec3 vNormal;
out vec2 vUv;
void main() {
  mat4 skin = uBones[int(aJoints.x)] * aWeights.x
            + uBones[int(aJoints.y)] * aWeights.y
            + uBones[int(aJoints.z)] * aWeights.z
            + uBones[int(aJoints.w)] * aWeights.w;
  vec4 skinned = skin * vec4(aPosition, 1.0);
  vNormal = mat3(uMesh * skin) * aNormal;
  vUv = aUv;
  gl_Position = uViewProj * (uMesh * skinned);
}`;

  VRMRenderer.FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec2 vUv;
uniform vec4 uBaseColor;
uniform int uHasTexture;
uniform sampler2D uTexture;
uniform vec3 uLightDir;
uniform float uLightOn;
out vec4 outColor;
void main() {
  vec4 base = uBaseColor;
  if (uHasTexture == 1) base *= texture(uTexture, vUv);
  float ndl = max(dot(normalize(vNormal), normalize(uLightDir)), 0.0);
  vec3 color = base.rgb * (0.45 + 0.55 * ndl * uLightOn);
  outColor = vec4(color, base.a);
}`;

  const api = { VRMRenderer, MAX_BONES, computeNodeWorld, computeSkinMatrices, makeIdlePose, primitiveData };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.AEVUM = root.AEVUM || {};
    root.AEVUM.render = root.AEVUM.render || {};
    root.AEVUM.render.VRMRenderer = VRMRenderer;
    root.AEVUM.render.makeVRMIdlePose = makeIdlePose;
    root.AEVUM.render.computeNodeWorld = computeNodeWorld;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
