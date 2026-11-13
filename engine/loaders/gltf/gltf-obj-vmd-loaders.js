/**
 * 模型格式 - GLTF加载器/OBJ加载器/VMD动画加载器/网格优化器/纹理图集
 * 纯JavaScript，零第三方依赖
 * @version 4.0.0
 */
'use strict';

const ModelFormatsV4 = (function () {

  class GLTFLoader {
    constructor() {
      this.supportedExtensions = ['KHR_materials_pbrSpecularGlossiness', 'KHR_materials_unlit', 'KHR_texture_transform'];
      this.dracoLoader = null;
      this.meshoptDecoder = null;
      this.textureLoader = null;
      this.binaryBuffer = null;
      this.stats = {
        meshesLoaded: 0,
        materialsLoaded: 0,
        texturesLoaded: 0,
        animationsLoaded: 0,
        totalVertices: 0,
        totalTriangles: 0
      };
    }

    async load(url, options = {}) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load GLTF: ${url}`);
      }
      const isGLB = url.toLowerCase().endsWith('.glb') || options.binary;
      if (isGLB) {
        const buffer = await response.arrayBuffer();
        return this.parseGLB(buffer, options);
      } else {
        const json = await response.json();
        const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
        return this.parseGLTF(json, baseUrl, options);
      }
    }

    async parseGLB(buffer, options = {}) {
      const dataView = new DataView(buffer);
      const magic = dataView.getUint32(0, true);
      if (magic !== 0x46546C67) {
        throw new Error('Invalid GLB file: magic number mismatch');
      }
      const version = dataView.getUint32(4, true);
      const length = dataView.getUint32(8, true);
      let offset = 12;
      let json = null;
      let binaryChunk = null;
      while (offset < length) {
        const chunkLength = dataView.getUint32(offset, true);
        const chunkType = dataView.getUint32(offset + 4, true);
        const chunkData = buffer.slice(offset + 8, offset + 8 + chunkLength);
        if (chunkType === 0x4E4F534A) {
          const text = new TextDecoder('utf-8').decode(chunkData);
          json = JSON.parse(text);
        } else if (chunkType === 0x004E4942) {
          binaryChunk = chunkData;
        }
        offset += 8 + chunkLength;
      }
      if (!json) {
        throw new Error('Invalid GLB file: no JSON chunk found');
      }
      this.binaryBuffer = binaryChunk;
      return this._processGLTF(json, '', options);
    }

    async parseGLTF(json, baseUrl = '', options = {}) {
      return this._processGLTF(json, baseUrl, options);
    }

    async _processGLTF(json, baseUrl, options) {
      const result = {
        asset: json.asset || {},
        scene: null,
        scenes: [],
        nodes: [],
        meshes: [],
        materials: [],
        textures: [],
        images: [],
        animations: [],
        skins: [],
        cameras: [],
        extensionsUsed: json.extensionsUsed || [],
        extensionsRequired: json.extensionsRequired || []
      };
      if (json.buffers && json.buffers.length > 0) {
        if (!this.binaryBuffer && baseUrl) {
          const bufferUrl = baseUrl + json.buffers[0].uri;
          const response = await fetch(bufferUrl);
          this.binaryBuffer = await response.arrayBuffer();
        }
      }
      if (json.bufferViews) {
        result.bufferViews = json.bufferViews.map((bv, index) => ({
          ...bv,
          data: this.binaryBuffer ? this.binaryBuffer.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength) : null
        }));
      }
      if (json.accessors) {
        result.accessors = json.accessors.map((accessor, index) => ({
          ...accessor,
          data: this._readAccessor(accessor, result.bufferViews)
        }));
      }
      if (json.materials) {
        result.materials = json.materials.map((mat, index) => this._processMaterial(mat, index));
        this.stats.materialsLoaded = result.materials.length;
      }
      if (json.textures) {
        result.textures = json.textures.map((tex, index) => this._processTexture(tex, index, json.images, baseUrl));
        this.stats.texturesLoaded = result.textures.length;
      }
      if (json.meshes) {
        result.meshes = json.meshes.map((mesh, index) => this._processMesh(mesh, index, result.accessors, result.materials));
        this.stats.meshesLoaded = result.meshes.length;
        for (const mesh of result.meshes) {
          for (const primitive of mesh.primitives) {
            this.stats.totalVertices += primitive.vertexCount || 0;
            this.stats.totalTriangles += primitive.indexCount ? primitive.indexCount / 3 : (primitive.vertexCount || 0) / 3;
          }
        }
      }
      if (json.nodes) {
        result.nodes = json.nodes.map((node, index) => this._processNode(node, index, result.meshes, result.skins));
      }
      if (json.skins) {
        result.skins = json.skins.map((skin, index) => this._processSkin(skin, index, result.accessors, result.nodes));
      }
      if (json.animations) {
        result.animations = json.animations.map((anim, index) => this._processAnimation(anim, index, result.accessors, result.nodes));
        this.stats.animationsLoaded = result.animations.length;
      }
      if (json.scenes) {
        result.scenes = json.scenes.map((scene, index) => ({
          name: scene.name || `scene_${index}`,
          nodes: scene.nodes || [],
          index
        }));
      }
      if (json.scene !== undefined && result.scenes[json.scene]) {
        result.scene = result.scenes[json.scene];
      } else if (result.scenes.length > 0) {
        result.scene = result.scenes[0];
      }
      return result;
    }

    _readAccessor(accessor, bufferViews) {
      if (!bufferViews || !accessor.bufferView !== undefined && accessor.bufferView === undefined) {
        return null;
      }
      const bufferView = bufferViews[accessor.bufferView];
      if (!bufferView || !bufferView.data) return null;
      const byteOffset = (accessor.byteOffset || 0) + (bufferView.byteOffset || 0);
      const componentType = accessor.componentType;
      const type = accessor.type;
      const componentCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }[type] || 1;
      const count = accessor.count;
      let TypedArray;
      let elementSize;
      switch (componentType) {
        case 5120: TypedArray = Int8Array; elementSize = 1; break;
        case 5121: TypedArray = Uint8Array; elementSize = 1; break;
        case 5122: TypedArray = Int16Array; elementSize = 2; break;
        case 5123: TypedArray = Uint16Array; elementSize = 2; break;
        case 5125: TypedArray = Uint32Array; elementSize = 4; break;
        case 5126: TypedArray = Float32Array; elementSize = 4; break;
        default: return null;
      }
      const data = new TypedArray(bufferView.data, byteOffset, count * componentCount);
      return { data, componentType, type, componentCount, count };
    }

    _processMaterial(mat, index) {
      const material = {
        name: mat.name || `material_${index}`,
        index,
        pbrMetallicRoughness: mat.pbrMetallicRoughness ? {
          baseColorFactor: mat.pbrMetallicRoughness.baseColorFactor || [1, 1, 1, 1],
          baseColorTexture: mat.pbrMetallicRoughness.baseColorTexture,
          metallicFactor: mat.pbrMetallicRoughness.metallicFactor !== undefined ? mat.pbrMetallicRoughness.metallicFactor : 1,
          roughnessFactor: mat.pbrMetallicRoughness.roughnessFactor !== undefined ? mat.pbrMetallicRoughness.roughnessFactor : 1,
          metallicRoughnessTexture: mat.pbrMetallicRoughness.metallicRoughnessTexture
        } : null,
        normalTexture: mat.normalTexture,
        occlusionTexture: mat.occlusionTexture,
        emissiveTexture: mat.emissiveTexture,
        emissiveFactor: mat.emissiveFactor || [0, 0, 0],
        alphaMode: mat.alphaMode || 'OPAQUE',
        alphaCutoff: mat.alphaCutoff !== undefined ? mat.alphaCutoff : 0.5,
        doubleSided: mat.doubleSided || false,
        extensions: mat.extensions || {}
      };
      return material;
    }

    _processTexture(tex, index, images, baseUrl) {
      const texture = {
        name: tex.name || `texture_${index}`,
        index,
        sampler: tex.sampler !== undefined ? {
          magFilter: 9729,
          minFilter: 9987,
          wrapS: 10497,
          wrapT: 10497
        } : null,
        source: tex.source !== undefined ? (images ? images[tex.source] : null) : null,
        url: tex.source !== undefined && images && images[tex.source]?.uri ? baseUrl + images[tex.source].uri : null
      };
      return texture;
    }

    _processMesh(mesh, index, accessors, materials) {
      const result = {
        name: mesh.name || `mesh_${index}`,
        index,
        primitives: [],
        weights: mesh.weights || []
      };
      for (const primitive of mesh.primitives) {
        const prim = {
          attributes: {},
          indices: null,
          material: primitive.material !== undefined ? materials[primitive.material] : null,
          mode: primitive.mode !== undefined ? primitive.mode : 4,
          targets: primitive.targets || [],
          vertexCount: 0,
          indexCount: 0
        };
        for (const [attrName, accessorIndex] of Object.entries(primitive.attributes)) {
          const accessor = accessors[accessorIndex];
          if (accessor && accessor.data) {
            prim.attributes[attrName] = accessor.data.data;
            if (attrName === 'POSITION') {
              prim.vertexCount = accessor.count;
            }
          }
        }
        if (primitive.indices !== undefined) {
          const accessor = accessors[primitive.indices];
          if (accessor && accessor.data) {
            prim.indices = accessor.data.data;
            prim.indexCount = accessor.count;
          }
        }
        result.primitives.push(prim);
      }
      return result;
    }

    _processNode(node, index, meshes, skins) {
      return {
        name: node.name || `node_${index}`,
        index,
        children: node.children || [],
        mesh: node.mesh !== undefined ? meshes[node.mesh] : null,
        skin: node.skin !== undefined ? skins[node.skin] : null,
        translation: node.translation || [0, 0, 0],
        rotation: node.rotation || [0, 0, 0, 1],
        scale: node.scale || [1, 1, 1],
        matrix: node.matrix || null,
        camera: node.camera !== undefined ? node.camera : null,
        extensions: node.extensions || {}
      };
    }

    _processSkin(skin, index, accessors, nodes) {
      return {
        name: skin.name || `skin_${index}`,
        index,
        joints: skin.joints || [],
        skeleton: skin.skeleton !== undefined ? nodes[skin.skeleton] : null,
        inverseBindMatrices: skin.inverseBindMatrices !== undefined ? accessors[skin.inverseBindMatrices]?.data?.data : null
      };
    }

    _processAnimation(anim, index, accessors, nodes) {
      const animation = {
        name: anim.name || `animation_${index}`,
        index,
        channels: [],
        samplers: [],
        duration: 0
      };
      for (const sampler of anim.samplers) {
        const inputAccessor = accessors[sampler.input];
        const outputAccessor = accessors[sampler.output];
        const samplerData = {
          input: inputAccessor?.data?.data,
          output: outputAccessor?.data?.data,
          interpolation: sampler.interpolation || 'LINEAR',
          inputCount: inputAccessor?.count || 0,
          outputCount: outputAccessor?.count || 0
        };
        animation.samplers.push(samplerData);
        if (inputAccessor?.data?.data && inputAccessor.data.data.length > 0) {
          animation.duration = Math.max(animation.duration, inputAccessor.data.data[inputAccessor.data.data.length - 1]);
        }
      }
      for (const channel of anim.channels) {
        animation.channels.push({
          sampler: animation.samplers[channel.sampler],
          target: {
            node: channel.target.node !== undefined ? nodes[channel.target.node] : null,
            path: channel.target.path
          }
        });
      }
      return animation;
    }

    getStats() {
      return { ...this.stats };
    }

    setDracoLoader(loader) {
      this.dracoLoader = loader;
    }

    setMeshoptDecoder(decoder) {
      this.meshoptDecoder = decoder;
    }

    setTextureLoader(loader) {
      this.textureLoader = loader;
    }

    dispose() {
      this.binaryBuffer = null;
      this.stats = {
        meshesLoaded: 0,
        materialsLoaded: 0,
        texturesLoaded: 0,
        animationsLoaded: 0,
        totalVertices: 0,
        totalTriangles: 0
      };
    }
  }

  class OBJLoader {
    constructor() {
      this.stats = {
        vertices: 0,
        normals: 0,
        uvs: 0,
        faces: 0,
        materials: 0,
        objects: 0
      };
    }

    async load(url, options = {}) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load OBJ: ${url}`);
      }
      const text = await response.text();
      return this.parse(text, options);
    }

    parse(text, options = {}) {
      const result = {
        objects: [],
        materials: [],
        vertices: [],
        normals: [],
        uvs: [],
        currentObject: null,
        currentMaterial: null
      };
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.length === 0 || line.startsWith('#')) continue;
        const parts = line.split(/\s+/);
        const command = parts[0];
        switch (command) {
          case 'o':
          case 'g':
            result.currentObject = {
              name: parts[1] || `object_${result.objects.length}`,
              vertices: [],
              normals: [],
              uvs: [],
              indices: [],
              material: null
            };
            result.objects.push(result.currentObject);
            break;
          case 'v':
            result.vertices.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
            break;
          case 'vn':
            result.normals.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
            break;
          case 'vt':
            result.uvs.push(parseFloat(parts[1]), parseFloat(parts[2]));
            break;
          case 'f':
            if (!result.currentObject) {
              result.currentObject = {
                name: `object_${result.objects.length}`,
                vertices: [],
                normals: [],
                uvs: [],
                indices: [],
                material: null
              };
              result.objects.push(result.currentObject);
            }
            this._parseFace(parts, result);
            break;
          case 'usemtl':
            result.currentMaterial = parts[1];
            if (result.currentObject) {
              result.currentObject.material = result.currentMaterial;
            }
            break;
          case 'mtllib':
            result.mtllib = parts[1];
            break;
        }
      }
      this._finalizeObjects(result);
      this.stats.vertices = result.vertices.length / 3;
      this.stats.normals = result.normals.length / 3;
      this.stats.uvs = result.uvs.length / 2;
      this.stats.objects = result.objects.length;
      return result;
    }

    _parseFace(parts, result) {
      const vertices = [];
      for (let i = 1; i < parts.length; i++) {
        const indices = parts[i].split('/');
        const vIndex = parseInt(indices[0]) - 1;
        const uvIndex = indices[1] ? parseInt(indices[1]) - 1 : -1;
        const nIndex = indices[2] ? parseInt(indices[2]) - 1 : -1;
        vertices.push({ v: vIndex, uv: uvIndex, n: nIndex });
      }
      if (vertices.length === 3) {
        this._addTriangle(vertices[0], vertices[1], vertices[2], result);
      } else if (vertices.length === 4) {
        this._addTriangle(vertices[0], vertices[1], vertices[2], result);
        this._addTriangle(vertices[0], vertices[2], vertices[3], result);
      } else if (vertices.length > 4) {
        for (let i = 1; i < vertices.length - 1; i++) {
          this._addTriangle(vertices[0], vertices[i], vertices[i + 1], result);
        }
      }
    }

    _addTriangle(a, b, c, result) {
      const obj = result.currentObject;
      const vertexMap = new Map();
      const processVertex = (vertex) => {
        const key = `${vertex.v}/${vertex.uv}/${vertex.n}`;
        if (vertexMap.has(key)) {
          return vertexMap.get(key);
        }
        const index = obj.vertices.length / 3;
        if (vertex.v >= 0 && vertex.v * 3 + 2 < result.vertices.length) {
          obj.vertices.push(result.vertices[vertex.v * 3], result.vertices[vertex.v * 3 + 1], result.vertices[vertex.v * 3 + 2]);
        } else {
          obj.vertices.push(0, 0, 0);
        }
        if (vertex.n >= 0 && vertex.n * 3 + 2 < result.normals.length) {
          obj.normals.push(result.normals[vertex.n * 3], result.normals[vertex.n * 3 + 1], result.normals[vertex.n * 3 + 2]);
        } else {
          obj.normals.push(0, 1, 0);
        }
        if (vertex.uv >= 0 && vertex.uv * 2 + 1 < result.uvs.length) {
          obj.uvs.push(result.uvs[vertex.uv * 2], result.uvs[vertex.uv * 2 + 1]);
        } else {
          obj.uvs.push(0, 0);
        }
        vertexMap.set(key, index);
        return index;
      };
      const ia = processVertex(a);
      const ib = processVertex(b);
      const ic = processVertex(c);
      obj.indices.push(ia, ib, ic);
      this.stats.faces++;
    }

    _finalizeObjects(result) {
      for (const obj of result.objects) {
        obj.vertexCount = obj.vertices.length / 3;
        obj.indexCount = obj.indices.length;
        obj.vertexArray = new Float32Array(obj.vertices);
        obj.normalArray = new Float32Array(obj.normals);
        obj.uvArray = new Float32Array(obj.uvs);
        obj.indexArray = new Uint32Array(obj.indices);
        if (obj.normals.length === 0) {
          this._computeNormals(obj);
        }
      }
    }

    _computeNormals(obj) {
      const normals = new Float32Array(obj.vertices.length);
      for (let i = 0; i < obj.indices.length; i += 3) {
        const a = obj.indices[i] * 3;
        const b = obj.indices[i + 1] * 3;
        const c = obj.indices[i + 2] * 3;
        const e1 = [obj.vertices[b] - obj.vertices[a], obj.vertices[b + 1] - obj.vertices[a + 1], obj.vertices[b + 2] - obj.vertices[a + 2]];
        const e2 = [obj.vertices[c] - obj.vertices[a], obj.vertices[c + 1] - obj.vertices[a + 1], obj.vertices[c + 2] - obj.vertices[a + 2]];
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        normals[a] += n[0]; normals[a + 1] += n[1]; normals[a + 2] += n[2];
        normals[b] += n[0]; normals[b + 1] += n[1]; normals[b + 2] += n[2];
        normals[c] += n[0]; normals[c + 1] += n[1]; normals[c + 2] += n[2];
      }
      for (let i = 0; i < normals.length; i += 3) {
        const l = Math.sqrt(normals[i] ** 2 + normals[i + 1] ** 2 + normals[i + 2] ** 2) || 1;
        normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l;
      }
      obj.normals = Array.from(normals);
      obj.normalArray = normals;
    }

    getStats() {
      return { ...this.stats };
    }

    dispose() {
      this.stats = {
        vertices: 0,
        normals: 0,
        uvs: 0,
        faces: 0,
        materials: 0,
        objects: 0
      };
    }
  }

  class VMDAnimationLoader {
    constructor() {
      this.stats = {
        boneFrames: 0,
        morphFrames: 0,
        cameraFrames: 0,
        lightFrames: 0,
        duration: 0
      };
    }

    async load(url, options = {}) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load VMD: ${url}`);
      }
      const buffer = await response.arrayBuffer();
      return this.parse(buffer, options);
    }

    parse(buffer, options = {}) {
      const dataView = new DataView(buffer);
      const result = {
        header: {},
        boneAnimation: new Map(),
        morphAnimation: new Map(),
        cameraAnimation: [],
        lightAnimation: [],
        duration: 0
      };
      const magic = this._readString(dataView, 0, 30);
      if (!magic.startsWith('Vocaloid Motion Data')) {
        throw new Error('Invalid VMD file: magic number mismatch');
      }
      result.header.magic = magic;
      result.header.modelName = this._readString(dataView, 30, 20);
      let offset = 50;
      const boneFrameCount = dataView.getUint32(offset, true);
      offset += 4;
      for (let i = 0; i < boneFrameCount; i++) {
        const frame = this._readBoneFrame(dataView, offset);
        offset += frame.byteLength;
        if (!result.boneAnimation.has(frame.boneName)) {
          result.boneAnimation.set(frame.boneName, []);
        }
        result.boneAnimation.get(frame.boneName).push(frame);
        result.duration = Math.max(result.duration, frame.frameNumber);
        this.stats.boneFrames++;
      }
      const morphFrameCount = dataView.getUint32(offset, true);
      offset += 4;
      for (let i = 0; i < morphFrameCount; i++) {
        const frame = this._readMorphFrame(dataView, offset);
        offset += frame.byteLength;
        if (!result.morphAnimation.has(frame.morphName)) {
          result.morphAnimation.set(frame.morphName, []);
        }
        result.morphAnimation.get(frame.morphName).push(frame);
        result.duration = Math.max(result.duration, frame.frameNumber);
        this.stats.morphFrames++;
      }
      if (offset < buffer.byteLength) {
        const cameraFrameCount = dataView.getUint32(offset, true);
        offset += 4;
        for (let i = 0; i < cameraFrameCount; i++) {
          const frame = this._readCameraFrame(dataView, offset);
          offset += frame.byteLength;
          result.cameraAnimation.push(frame);
          result.duration = Math.max(result.duration, frame.frameNumber);
          this.stats.cameraFrames++;
        }
      }
      if (offset < buffer.byteLength) {
        const lightFrameCount = dataView.getUint32(offset, true);
        offset += 4;
        for (let i = 0; i < lightFrameCount; i++) {
          const frame = this._readLightFrame(dataView, offset);
          offset += frame.byteLength;
          result.lightAnimation.push(frame);
          result.duration = Math.max(result.duration, frame.frameNumber);
          this.stats.lightFrames++;
        }
      }
      for (const [boneName, frames] of result.boneAnimation) {
        frames.sort((a, b) => a.frameNumber - b.frameNumber);
      }
      for (const [morphName, frames] of result.morphAnimation) {
        frames.sort((a, b) => a.frameNumber - b.frameNumber);
      }
      result.cameraAnimation.sort((a, b) => a.frameNumber - b.frameNumber);
      result.lightAnimation.sort((a, b) => a.frameNumber - b.frameNumber);
      result.duration = result.duration / 30;
      this.stats.duration = result.duration;
      return result;
    }

    _readBoneFrame(dataView, offset) {
      const boneName = this._readString(dataView, offset, 15);
      const frameNumber = dataView.getUint32(offset + 15, true);
      const position = [
        dataView.getFloat32(offset + 19, true),
        dataView.getFloat32(offset + 23, true),
        dataView.getFloat32(offset + 27, true)
      ];
      const rotation = [
        dataView.getFloat32(offset + 31, true),
        dataView.getFloat32(offset + 35, true),
        dataView.getFloat32(offset + 39, true),
        dataView.getFloat32(offset + 43, true)
      ];
      const interpolation = [];
      for (let i = 0; i < 4; i++) {
        interpolation.push({
          x1: dataView.getUint8(offset + 47 + i * 4),
          y1: dataView.getUint8(offset + 48 + i * 4),
          x2: dataView.getUint8(offset + 49 + i * 4),
          y2: dataView.getUint8(offset + 50 + i * 4)
        });
      }
      return {
        boneName,
        frameNumber,
        position,
        rotation,
        interpolation,
        byteLength: 79
      };
    }

    _readMorphFrame(dataView, offset) {
      const morphName = this._readString(dataView, offset, 15);
      const frameNumber = dataView.getUint32(offset + 15, true);
      const weight = dataView.getFloat32(offset + 19, true);
      return {
        morphName,
        frameNumber,
        weight,
        byteLength: 23
      };
    }

    _readCameraFrame(dataView, offset) {
      const frameNumber = dataView.getUint32(offset, true);
      const distance = dataView.getFloat32(offset + 4, true);
      const position = [
        dataView.getFloat32(offset + 8, true),
        dataView.getFloat32(offset + 12, true),
        dataView.getFloat32(offset + 16, true)
      ];
      const rotation = [
        dataView.getFloat32(offset + 20, true),
        dataView.getFloat32(offset + 24, true),
        dataView.getFloat32(offset + 28, true)
      ];
      const interpolation = [];
      for (let i = 0; i < 6; i++) {
        interpolation.push({
          x1: dataView.getUint8(offset + 32 + i * 4),
          y1: dataView.getUint8(offset + 33 + i * 4),
          x2: dataView.getUint8(offset + 34 + i * 4),
          y2: dataView.getUint8(offset + 35 + i * 4)
        });
      }
      const viewAngle = dataView.getUint32(offset + 56, true);
      const perspective = dataView.getUint8(offset + 60) === 0;
      return {
        frameNumber,
        distance,
        position,
        rotation,
        interpolation,
        viewAngle,
        perspective,
        byteLength: 61
      };
    }

    _readLightFrame(dataView, offset) {
      const frameNumber = dataView.getUint32(offset, true);
      const color = [
        dataView.getFloat32(offset + 4, true),
        dataView.getFloat32(offset + 8, true),
        dataView.getFloat32(offset + 12, true)
      ];
      const direction = [
        dataView.getFloat32(offset + 16, true),
        dataView.getFloat32(offset + 20, true),
        dataView.getFloat32(offset + 24, true)
      ];
      return {
        frameNumber,
        color,
        direction,
        byteLength: 28
      };
    }

    _readString(dataView, offset, length) {
      let str = '';
      for (let i = 0; i < length; i++) {
        const charCode = dataView.getUint8(offset + i);
        if (charCode === 0) break;
        str += String.fromCharCode(charCode);
      }
      return str;
    }

    getBoneAnimation(boneName) {
      return this.boneAnimation.get(boneName) || [];
    }

    getMorphAnimation(morphName) {
      return this.morphAnimation.get(morphName) || [];
    }

    getBoneNames() {
      return Array.from(this.boneAnimation.keys());
    }

    getMorphNames() {
      return Array.from(this.morphAnimation.keys());
    }

    getStats() {
      return { ...this.stats };
    }

    dispose() {
      this.stats = {
        boneFrames: 0,
        morphFrames: 0,
        cameraFrames: 0,
        lightFrames: 0,
        duration: 0
      };
    }
  }

  return {
    GLTFLoader, OBJLoader, VMDAnimationLoader
  };
})();

if (typeof window !== 'undefined') window.ModelFormatsV4 = ModelFormatsV4;
if (typeof globalThis !== 'undefined') globalThis.ModelFormatsV4 = ModelFormatsV4;
