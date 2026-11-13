/**
 * 模型格式 - GLTF加载器/OBJ加载器/VMD动画加载器/格式转换器/模型缓存
 * 纯JavaScript，零第三方依赖
 * @version 6.0.0
 */
'use strict';

const ModelFormatsV6 = (function () {

  class GLTFLoader {
    constructor() {
      this.cache = new Map();
      this.options = {
        loadImages: true,
        loadBuffers: true,
        generateMipmaps: true,
        crossOrigin: 'anonymous'
      };
      this.stats = { loaded: 0, failed: 0, cached: 0 };
    }

    async load(url, options = {}) {
      const opts = { ...this.options, ...options };
      const cacheKey = url;
      if (this.cache.has(cacheKey) && !opts.forceReload) {
        this.stats.cached++;
        return this.cache.get(cacheKey);
      }
      try {
        const response = await fetch(url);
        const gltf = await response.json();
        const model = await this._parseGLTF(gltf, url, opts);
        this.cache.set(cacheKey, model);
        this.stats.loaded++;
        return model;
      } catch (error) {
        this.stats.failed++;
        throw error;
      }
    }

    async _parseGLTF(gltf, baseUrl, options) {
      const model = {
        asset: gltf.asset,
        scene: gltf.scene || 0,
        scenes: [],
        nodes: [],
        meshes: [],
        materials: [],
        textures: [],
        images: [],
        skins: [],
        animations: [],
        cameras: [],
        extensionsUsed: gltf.extensionsUsed || [],
        extensionsRequired: gltf.extensionsRequired || []
      };
      const buffers = await this._loadBuffers(gltf, baseUrl, options);
      const bufferViews = this._parseBufferViews(gltf, buffers);
      const accessors = this._parseAccessors(gltf, bufferViews);
      if (gltf.images) {
        model.images = await this._loadImages(gltf, baseUrl, buffers, options);
      }
      if (gltf.textures) {
        model.textures = this._parseTextures(gltf, model.images);
      }
      if (gltf.materials) {
        model.materials = this._parseMaterials(gltf, model.textures);
      }
      if (gltf.meshes) {
        model.meshes = this._parseMeshes(gltf, accessors, model.materials);
      }
      if (gltf.nodes) {
        model.nodes = this._parseNodes(gltf, model.meshes);
      }
      if (gltf.scenes) {
        model.scenes = this._parseScenes(gltf, model.nodes);
      }
      if (gltf.skins) {
        model.skins = this._parseSkins(gltf, accessors, model.nodes);
      }
      if (gltf.animations) {
        model.animations = this._parseAnimations(gltf, accessors, model.nodes);
      }
      if (gltf.cameras) {
        model.cameras = this._parseCameras(gltf);
      }
      return model;
    }

    async _loadBuffers(gltf, baseUrl, options) {
      const buffers = [];
      if (!gltf.buffers) return buffers;
      for (const bufferDef of gltf.buffers) {
        if (bufferDef.uri && bufferDef.uri.startsWith('data:')) {
          const base64 = bufferDef.uri.split(',')[1];
          const binary = atob(base64);
          const array = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            array[i] = binary.charCodeAt(i);
          }
          buffers.push(array.buffer);
        } else if (bufferDef.uri) {
          const url = new URL(bufferDef.uri, baseUrl).href;
          const response = await fetch(url);
          const arrayBuffer = await response.arrayBuffer();
          buffers.push(arrayBuffer);
        } else {
          buffers.push(new ArrayBuffer(bufferDef.byteLength));
        }
      }
      return buffers;
    }

    _parseBufferViews(gltf, buffers) {
      const bufferViews = [];
      if (!gltf.bufferViews) return bufferViews;
      for (const viewDef of gltf.bufferViews) {
        const buffer = buffers[viewDef.buffer];
        const view = new DataView(buffer, viewDef.byteOffset || 0, viewDef.byteLength);
        bufferViews.push({
          view,
          target: viewDef.target,
          byteStride: viewDef.byteStride || 0
        });
      }
      return bufferViews;
    }

    _parseAccessors(gltf, bufferViews) {
      const accessors = [];
      if (!gltf.accessors) return accessors;
      for (const accessorDef of gltf.accessors) {
        const bufferView = bufferViews[accessorDef.bufferView];
        const componentType = accessorDef.componentType;
        const type = accessorDef.type;
        const count = accessorDef.count;
        const byteOffset = accessorDef.byteOffset || 0;
        let data;
        if (bufferView) {
          const view = bufferView.view;
          const stride = bufferView.byteStride || this._getComponentSize(componentType) * this._getComponentCount(type);
          if (componentType === 5126) {
            data = new Float32Array(count * this._getComponentCount(type));
            for (let i = 0; i < count; i++) {
              for (let j = 0; j < this._getComponentCount(type); j++) {
                data[i * this._getComponentCount(type) + j] = view.getFloat32(byteOffset + i * stride + j * 4, true);
              }
            }
          } else if (componentType === 5123) {
            data = new Uint16Array(count * this._getComponentCount(type));
            for (let i = 0; i < count; i++) {
              for (let j = 0; j < this._getComponentCount(type); j++) {
                data[i * this._getComponentCount(type) + j] = view.getUint16(byteOffset + i * stride + j * 2, true);
              }
            }
          } else if (componentType === 5125) {
            data = new Uint32Array(count * this._getComponentCount(type));
            for (let i = 0; i < count; i++) {
              for (let j = 0; j < this._getComponentCount(type); j++) {
                data[i * this._getComponentCount(type) + j] = view.getUint32(byteOffset + i * stride + j * 4, true);
              }
            }
          } else if (componentType === 5121) {
            data = new Uint8Array(count * this._getComponentCount(type));
            for (let i = 0; i < count; i++) {
              for (let j = 0; j < this._getComponentCount(type); j++) {
                data[i * this._getComponentCount(type) + j] = view.getUint8(byteOffset + i * stride + j);
              }
            }
          }
        }
        accessors.push({
          data,
          componentType,
          type,
          count,
          min: accessorDef.min,
          max: accessorDef.max,
          normalized: accessorDef.normalized || false
        });
      }
      return accessors;
    }

    _getComponentSize(componentType) {
      switch (componentType) {
        case 5120: return 1;
        case 5121: return 1;
        case 5122: return 2;
        case 5123: return 2;
        case 5125: return 4;
        case 5126: return 4;
        default: return 4;
      }
    }

    _getComponentCount(type) {
      switch (type) {
        case 'SCALAR': return 1;
        case 'VEC2': return 2;
        case 'VEC3': return 3;
        case 'VEC4': return 4;
        case 'MAT2': return 4;
        case 'MAT3': return 9;
        case 'MAT4': return 16;
        default: return 1;
      }
    }

    async _loadImages(gltf, baseUrl, buffers, options) {
      const images = [];
      for (const imageDef of gltf.images) {
        if (imageDef.uri) {
          const url = imageDef.uri.startsWith('data:') ? imageDef.uri : new URL(imageDef.uri, baseUrl).href;
          const img = new Image();
          img.crossOrigin = options.crossOrigin;
          img.src = url;
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
          });
          images.push({ image: img, name: imageDef.name });
        } else if (imageDef.bufferView !== undefined) {
          images.push({ bufferView: imageDef.bufferView, mimeType: imageDef.mimeType, name: imageDef.name });
        }
      }
      return images;
    }

    _parseTextures(gltf, images) {
      const textures = [];
      for (const textureDef of gltf.textures) {
        textures.push({
          source: images[textureDef.source],
          sampler: textureDef.sampler,
          name: textureDef.name
        });
      }
      return textures;
    }

    _parseMaterials(gltf, textures) {
      const materials = [];
      for (const materialDef of gltf.materials) {
        const pbr = materialDef.pbrMetallicRoughness || {};
        materials.push({
          name: materialDef.name,
          baseColorFactor: pbr.baseColorFactor || [1, 1, 1, 1],
          baseColorTexture: pbr.baseColorTexture ? textures[pbr.baseColorTexture.index] : null,
          metallicFactor: pbr.metallicFactor !== undefined ? pbr.metallicFactor : 1,
          roughnessFactor: pbr.roughnessFactor !== undefined ? pbr.roughnessFactor : 1,
          metallicRoughnessTexture: pbr.metallicRoughnessTexture ? textures[pbr.metallicRoughnessTexture.index] : null,
          normalTexture: materialDef.normalTexture ? textures[materialDef.normalTexture.index] : null,
          occlusionTexture: materialDef.occlusionTexture ? textures[materialDef.occlusionTexture.index] : null,
          emissiveTexture: materialDef.emissiveTexture ? textures[materialDef.emissiveTexture.index] : null,
          emissiveFactor: materialDef.emissiveFactor || [0, 0, 0],
          alphaMode: materialDef.alphaMode || 'OPAQUE',
          alphaCutoff: materialDef.alphaCutoff || 0.5,
          doubleSided: materialDef.doubleSided || false
        });
      }
      return materials;
    }

    _parseMeshes(gltf, accessors, materials) {
      const meshes = [];
      for (const meshDef of gltf.meshes) {
        const primitives = [];
        for (const primitiveDef of meshDef.primitives) {
          const attributes = {};
          for (const [name, index] of Object.entries(primitiveDef.attributes)) {
            attributes[name] = accessors[index];
          }
          primitives.push({
            attributes,
            indices: primitiveDef.indices !== undefined ? accessors[primitiveDef.indices] : null,
            material: primitiveDef.material !== undefined ? materials[primitiveDef.material] : null,
            mode: primitiveDef.mode || 4,
            targets: primitiveDef.targets || []
          });
        }
        meshes.push({
          name: meshDef.name,
          primitives,
          weights: meshDef.weights || []
        });
      }
      return meshes;
    }

    _parseNodes(gltf, meshes) {
      const nodes = [];
      for (const nodeDef of gltf.nodes) {
        nodes.push({
          name: nodeDef.name,
          mesh: nodeDef.mesh !== undefined ? meshes[nodeDef.mesh] : null,
          children: nodeDef.children || [],
          translation: nodeDef.translation || [0, 0, 0],
          rotation: nodeDef.rotation || [0, 0, 0, 1],
          scale: nodeDef.scale || [1, 1, 1],
          matrix: nodeDef.matrix || null,
          skin: nodeDef.skin,
          camera: nodeDef.camera,
          weights: nodeDef.weights || []
        });
      }
      return nodes;
    }

    _parseScenes(gltf, nodes) {
      const scenes = [];
      for (const sceneDef of gltf.scenes) {
        scenes.push({
          name: sceneDef.name,
          nodes: (sceneDef.nodes || []).map(i => nodes[i])
        });
      }
      return scenes;
    }

    _parseSkins(gltf, accessors, nodes) {
      const skins = [];
      for (const skinDef of gltf.skins) {
        skins.push({
          name: skinDef.name,
          joints: (skinDef.joints || []).map(i => nodes[i]),
          inverseBindMatrices: skinDef.inverseBindMatrices !== undefined ? accessors[skinDef.inverseBindMatrices] : null,
          skeleton: skinDef.skeleton !== undefined ? nodes[skinDef.skeleton] : null
        });
      }
      return skins;
    }

    _parseAnimations(gltf, accessors, nodes) {
      const animations = [];
      for (const animDef of gltf.animations) {
        const channels = [];
        for (const channelDef of animDef.channels) {
          channels.push({
            sampler: animDef.samplers[channelDef.sampler],
            target: {
              node: channelDef.target.node !== undefined ? nodes[channelDef.target.node] : null,
              path: channelDef.target.path
            }
          });
        }
        const samplers = [];
        for (const samplerDef of animDef.samplers) {
          samplers.push({
            input: accessors[samplerDef.input],
            output: accessors[samplerDef.output],
            interpolation: samplerDef.interpolation || 'LINEAR'
          });
        }
        animations.push({
          name: animDef.name,
          channels,
          samplers
        });
      }
      return animations;
    }

    _parseCameras(gltf) {
      const cameras = [];
      for (const cameraDef of gltf.cameras) {
        if (cameraDef.type === 'perspective') {
          cameras.push({
            name: cameraDef.name,
            type: 'perspective',
            perspective: {
              aspectRatio: cameraDef.perspective.aspectRatio,
              yfov: cameraDef.perspective.yfov,
              zfar: cameraDef.perspective.zfar,
              znear: cameraDef.perspective.znear
            }
          });
        } else if (cameraDef.type === 'orthographic') {
          cameras.push({
            name: cameraDef.name,
            type: 'orthographic',
            orthographic: {
              xmag: cameraDef.orthographic.xmag,
              ymag: cameraDef.orthographic.ymag,
              zfar: cameraDef.orthographic.zfar,
              znear: cameraDef.orthographic.znear
            }
          });
        }
      }
      return cameras;
    }

    getCache(url) {
      return this.cache.get(url);
    }

    hasCache(url) {
      return this.cache.has(url);
    }

    clearCache() {
      this.cache.clear();
    }

    getStats() {
      return { ...this.stats, cacheSize: this.cache.size };
    }

    setOptions(options) {
      this.options = { ...this.options, ...options };
    }

    dispose() {
      this.clearCache();
    }
  }

  class OBJLoader {
    constructor() {
      this.cache = new Map();
      this.options = {
        computeNormals: true,
        computeUVs: true,
        triangulate: true
      };
      this.stats = { loaded: 0, failed: 0, cached: 0 };
    }

    async load(url, options = {}) {
      const opts = { ...this.options, ...options };
      const cacheKey = url;
      if (this.cache.has(cacheKey) && !opts.forceReload) {
        this.stats.cached++;
        return this.cache.get(cacheKey);
      }
      try {
        const response = await fetch(url);
        const text = await response.text();
        const model = this.parse(text, opts);
        this.cache.set(cacheKey, model);
        this.stats.loaded++;
        return model;
      } catch (error) {
        this.stats.failed++;
        throw error;
      }
    }

    parse(text, options = {}) {
      const opts = { ...this.options, ...options };
      const vertices = [];
      const normals = [];
      const uvs = [];
      const faces = [];
      const materials = new Map();
      let currentMaterial = null;
      const lines = text.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || trimmed === '') continue;
        const parts = trimmed.split(/\s+/);
        const command = parts[0];
        switch (command) {
          case 'v':
            vertices.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
            break;
          case 'vn':
            normals.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
            break;
          case 'vt':
            uvs.push([parseFloat(parts[1]), parseFloat(parts[2])]);
            break;
          case 'f':
            const face = [];
            for (let i = 1; i < parts.length; i++) {
              const indices = parts[i].split('/');
              face.push({
                vertex: parseInt(indices[0]) - 1,
                uv: indices[1] ? parseInt(indices[1]) - 1 : -1,
                normal: indices[2] ? parseInt(indices[2]) - 1 : -1
              });
            }
            faces.push({ vertices: face, material: currentMaterial });
            break;
          case 'usemtl':
            currentMaterial = parts[1];
            break;
          case 'mtllib':
            break;
        }
      }
      const model = {
        vertices: new Float32Array(vertices.flat()),
        normals: normals.length > 0 ? new Float32Array(normals.flat()) : null,
        uvs: uvs.length > 0 ? new Float32Array(uvs.flat()) : null,
        faces,
        materials,
        vertexCount: vertices.length,
        faceCount: faces.length
      };
      if (opts.triangulate) {
        model.triangles = this._triangulate(faces);
      }
      if (opts.computeNormals && !model.normals) {
        model.normals = this._computeNormals(vertices, model.triangles || faces);
      }
      return model;
    }

    _triangulate(faces) {
      const triangles = [];
      for (const face of faces) {
        if (face.vertices.length === 3) {
          triangles.push(face);
        } else if (face.vertices.length === 4) {
          triangles.push({ vertices: [face.vertices[0], face.vertices[1], face.vertices[2]], material: face.material });
          triangles.push({ vertices: [face.vertices[0], face.vertices[2], face.vertices[3]], material: face.material });
        } else {
          for (let i = 1; i < face.vertices.length - 1; i++) {
            triangles.push({ vertices: [face.vertices[0], face.vertices[i], face.vertices[i + 1]], material: face.material });
          }
        }
      }
      return triangles;
    }

    _computeNormals(vertices, faces) {
      const normals = new Float32Array(vertices.length * 3);
      for (const face of faces) {
        const a = face.vertices[0].vertex * 3;
        const b = face.vertices[1].vertex * 3;
        const c = face.vertices[2].vertex * 3;
        const e1 = [vertices[b][0] - vertices[a][0], vertices[b][1] - vertices[a][1], vertices[b][2] - vertices[a][2]];
        const e2 = [vertices[c][0] - vertices[a][0], vertices[c][1] - vertices[a][1], vertices[c][2] - vertices[a][2]];
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        normals[a] += n[0]; normals[a + 1] += n[1]; normals[a + 2] += n[2];
        normals[b] += n[0]; normals[b + 1] += n[1]; normals[b + 2] += n[2];
        normals[c] += n[0]; normals[c + 1] += n[1]; normals[c + 2] += n[2];
      }
      for (let i = 0; i < normals.length; i += 3) {
        const length = Math.sqrt(normals[i]**2 + normals[i+1]**2 + normals[i+2]**2) || 1;
        normals[i] /= length;
        normals[i+1] /= length;
        normals[i+2] /= length;
      }
      return normals;
    }

    getCache(url) {
      return this.cache.get(url);
    }

    hasCache(url) {
      return this.cache.has(url);
    }

    clearCache() {
      this.cache.clear();
    }

    getStats() {
      return { ...this.stats, cacheSize: this.cache.size };
    }

    setOptions(options) {
      this.options = { ...this.options, ...options };
    }

    dispose() {
      this.clearCache();
    }
  }

  class VMDAnimationLoader {
    constructor() {
      this.cache = new Map();
      this.options = {
        interpolate: true,
        loop: true
      };
      this.stats = { loaded: 0, failed: 0, cached: 0 };
    }

    async load(url, options = {}) {
      const opts = { ...this.options, ...options };
      const cacheKey = url;
      if (this.cache.has(cacheKey) && !opts.forceReload) {
        this.stats.cached++;
        return this.cache.get(cacheKey);
      }
      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const animation = this.parse(arrayBuffer, opts);
        this.cache.set(cacheKey, animation);
        this.stats.loaded++;
        return animation;
      } catch (error) {
        this.stats.failed++;
        throw error;
      }
    }

    parse(arrayBuffer, options = {}) {
      const opts = { ...this.options, ...options };
      const dataView = new DataView(arrayBuffer);
      let offset = 0;
      const header = this._readString(dataView, offset, 30);
      offset += 30;
      const version = this._readString(dataView, offset, 20);
      offset += 20;
      const modelName = this._readString(dataView, offset, 20);
      offset += 20;
      const boneKeyframeCount = dataView.getUint32(offset, true);
      offset += 4;
      const boneFrames = [];
      for (let i = 0; i < boneKeyframeCount; i++) {
        const frame = this._readBoneFrame(dataView, offset);
        boneFrames.push(frame);
        offset += 111;
      }
      const morphKeyframeCount = dataView.getUint32(offset, true);
      offset += 4;
      const morphFrames = [];
      for (let i = 0; i < morphKeyframeCount; i++) {
        const frame = this._readMorphFrame(dataView, offset);
        morphFrames.push(frame);
        offset += 23;
      }
      const cameraKeyframeCount = dataView.getUint32(offset, true);
      offset += 4;
      const cameraFrames = [];
      for (let i = 0; i < cameraKeyframeCount; i++) {
        const frame = this._readCameraFrame(dataView, offset);
        cameraFrames.push(frame);
        offset += 128;
      }
      const lightKeyframeCount = dataView.getUint32(offset, true);
      offset += 4;
      const lightFrames = [];
      for (let i = 0; i < lightKeyframeCount; i++) {
        const frame = this._readLightFrame(dataView, offset);
        lightFrames.push(frame);
        offset += 28;
      }
      const animation = {
        header,
        version,
        modelName,
        boneFrames,
        morphFrames,
        cameraFrames,
        lightFrames,
        duration: this._calculateDuration(boneFrames, morphFrames),
        boneTracks: this._buildBoneTracks(boneFrames),
        morphTracks: this._buildMorphTracks(morphFrames)
      };
      return animation;
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
          x: [dataView.getUint8(offset + 47 + i * 4), dataView.getUint8(offset + 48 + i * 4)],
          y: [dataView.getUint8(offset + 49 + i * 4), dataView.getUint8(offset + 50 + i * 4)]
        });
      }
      return { boneName, frameNumber, position, rotation, interpolation };
    }

    _readMorphFrame(dataView, offset) {
      const morphName = this._readString(dataView, offset, 15);
      const frameNumber = dataView.getUint32(offset + 15, true);
      const weight = dataView.getFloat32(offset + 19, true);
      return { morphName, frameNumber, weight };
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
          x: [dataView.getUint8(offset + 32 + i * 4), dataView.getUint8(offset + 33 + i * 4)],
          y: [dataView.getUint8(offset + 34 + i * 4), dataView.getUint8(offset + 35 + i * 4)]
        });
      }
      const viewingAngle = dataView.getUint32(offset + 56, true);
      const perspective = dataView.getUint8(offset + 60);
      return { frameNumber, distance, position, rotation, interpolation, viewingAngle, perspective };
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
      return { frameNumber, color, direction };
    }

    _calculateDuration(boneFrames, morphFrames) {
      let maxFrame = 0;
      for (const frame of boneFrames) {
        maxFrame = Math.max(maxFrame, frame.frameNumber);
      }
      for (const frame of morphFrames) {
        maxFrame = Math.max(maxFrame, frame.frameNumber);
      }
      return maxFrame / 30;
    }

    _buildBoneTracks(boneFrames) {
      const tracks = new Map();
      for (const frame of boneFrames) {
        if (!tracks.has(frame.boneName)) {
          tracks.set(frame.boneName, []);
        }
        tracks.get(frame.boneName).push(frame);
      }
      for (const track of tracks.values()) {
        track.sort((a, b) => a.frameNumber - b.frameNumber);
      }
      return tracks;
    }

    _buildMorphTracks(morphFrames) {
      const tracks = new Map();
      for (const frame of morphFrames) {
        if (!tracks.has(frame.morphName)) {
          tracks.set(frame.morphName, []);
        }
        tracks.get(frame.morphName).push(frame);
      }
      for (const track of tracks.values()) {
        track.sort((a, b) => a.frameNumber - b.frameNumber);
      }
      return tracks;
    }

    getCache(url) {
      return this.cache.get(url);
    }

    hasCache(url) {
      return this.cache.has(url);
    }

    clearCache() {
      this.cache.clear();
    }

    getStats() {
      return { ...this.stats, cacheSize: this.cache.size };
    }

    setOptions(options) {
      this.options = { ...this.options, ...options };
    }

    dispose() {
      this.clearCache();
    }
  }

  return {
    GLTFLoader, OBJLoader, VMDAnimationLoader
  };
})();

if (typeof window !== 'undefined') window.ModelFormatsV6 = ModelFormatsV6;
if (typeof globalThis !== 'undefined') globalThis.ModelFormatsV6 = ModelFormatsV6;
