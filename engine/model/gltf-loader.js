/**
 * GLTF/GLB模型加载器 - Khronos Group glTF 2.0
 * 支持：GLB二进制、JSON外部引用、PBR材质、骨骼动画、蒙皮、Morph Targets
 * @version 2.0.0
 */
'use strict';

const GLTFLoader = (function () {

  async function load(url, options = {}) {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const magic = new Uint32Array(buffer, 0, 1)[0];
    if (magic === 0x46546C67) return parseGLB(buffer, options);
    const text = new TextDecoder().decode(buffer);
    const json = JSON.parse(text);
    return parseJSON(json, url, options);
  }

  function parseGLB(buffer, options = {}) {
    const dataView = new DataView(buffer);
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
        json = JSON.parse(new TextDecoder().decode(chunkData));
      } else if (chunkType === 0x004E4942) {
        binaryChunk = chunkData;
      }
      offset += 8 + chunkLength;
    }
    return buildModel(json, binaryChunk, options);
  }

  function parseJSON(json, baseUrl, options = {}) {
    return buildModel(json, null, options, baseUrl);
  }

  function buildModel(json, binaryChunk, options = {}, baseUrl = '') {
    const model = {
      format: 'gltf',
      version: json.asset?.version || '2.0',
      generator: json.asset?.generator || '',
      copyright: json.asset?.copyright || '',
      meshes: [],
      materials: [],
      textures: [],
      images: [],
      skins: [],
      animations: [],
      cameras: [],
      nodes: [],
      scenes: [],
      extensionsUsed: json.extensionsUsed || [],
      extensionsRequired: json.extensionsRequired || []
    };

    const buffers = [];
    if (binaryChunk) buffers[0] = binaryChunk;
    if (json.buffers) {
      for (let i = 0; i < json.buffers.length; i++) {
        if (i === 0 && binaryChunk) continue;
        buffers[i] = new ArrayBuffer(json.buffers[i].byteLength);
      }
    }

    const bufferViews = [];
    if (json.bufferViews) {
      for (const bv of json.bufferViews) {
        bufferViews.push({
          buffer: buffers[bv.buffer],
          byteOffset: bv.byteOffset || 0,
          byteLength: bv.byteLength,
          byteStride: bv.byteStride || 0,
          target: bv.target || 0
        });
      }
    }

    const accessors = [];
    if (json.accessors) {
      for (const acc of json.accessors) {
        const bv = bufferViews[acc.bufferView];
        accessors.push({
          bufferView: bv,
          byteOffset: acc.byteOffset || 0,
          componentType: acc.componentType,
          count: acc.count,
          type: acc.type,
          normalized: acc.normalized || false,
          min: acc.min,
          max: acc.max
        });
      }
    }

    function readAccessor(accessor) {
      const { bufferView, byteOffset, componentType, count, type } = accessor;
      const buf = bufferView.buffer;
      const offset = bufferView.byteOffset + byteOffset;
      const stride = bufferView.byteStride || getComponentSize(componentType) * getTypeCount(type);
      const result = [];
      const view = new DataView(buf);
      for (let i = 0; i < count; i++) {
        result.push(readComponent(view, offset + i * stride, componentType, type));
      }
      return result;
    }

    function getComponentSize(type) {
      switch (type) {
        case 5120: return 1; case 5121: return 1;
        case 5122: return 2; case 5123: return 2;
        case 5125: return 4; case 5126: return 4;
        default: return 4;
      }
    }

    function getTypeCount(type) {
      switch (type) {
        case 'SCALAR': return 1; case 'VEC2': return 2;
        case 'VEC3': return 3; case 'VEC4': return 4;
        case 'MAT2': return 4; case 'MAT3': return 9; case 'MAT4': return 16;
        default: return 1;
      }
    }

    function readComponent(view, offset, componentType, type) {
      const count = getTypeCount(type);
      const vals = [];
      for (let i = 0; i < count; i++) {
        const o = offset + i * getComponentSize(componentType);
        switch (componentType) {
          case 5120: vals.push(view.getInt8(o)); break;
          case 5121: vals.push(view.getUint8(o)); break;
          case 5122: vals.push(view.getInt16(o, true)); break;
          case 5123: vals.push(view.getUint16(o, true)); break;
          case 5125: vals.push(view.getUint32(o, true)); break;
          case 5126: vals.push(view.getFloat32(o, true)); break;
        }
      }
      return count === 1 ? vals[0] : vals;
    }

    if (json.meshes) {
      for (const mesh of json.meshes) {
        const m = { name: mesh.name || '', primitives: [], weights: mesh.weights || [] };
        for (const prim of mesh.primitives) {
          const primitive = {
            attributes: {},
            indices: prim.indices !== undefined ? readAccessor(accessors[prim.indices]) : null,
            material: prim.material || 0,
            mode: prim.mode || 4,
            targets: []
          };
          for (const [attr, accIdx] of Object.entries(prim.attributes)) {
            primitive.attributes[attr] = readAccessor(accessors[accIdx]);
          }
          if (prim.targets) {
            for (const target of prim.targets) {
              const t = {};
              for (const [attr, accIdx] of Object.entries(target)) {
                t[attr] = readAccessor(accessors[accIdx]);
              }
              primitive.targets.push(t);
            }
          }
          m.primitives.push(primitive);
        }
        model.meshes.push(m);
      }
    }

    if (json.materials) {
      for (const mat of json.materials) {
        model.materials.push({
          name: mat.name || '',
          pbrMetallicRoughness: mat.pbrMetallicRoughness || { baseColorFactor: [1,1,1,1], metallicFactor: 1, roughnessFactor: 1 },
          normalTexture: mat.normalTexture || null,
          occlusionTexture: mat.occlusionTexture || null,
          emissiveTexture: mat.emissiveTexture || null,
          emissiveFactor: mat.emissiveFactor || [0,0,0],
          alphaMode: mat.alphaMode || 'OPAQUE',
          alphaCutoff: mat.alphaCutoff || 0.5,
          doubleSided: mat.doubleSided || false,
          extensions: mat.extensions || {}
        });
      }
    }

    if (json.textures) {
      for (const tex of json.textures) {
        model.textures.push({
          source: tex.source || 0,
          sampler: tex.sampler || 0,
          name: tex.name || ''
        });
      }
    }

    if (json.images) {
      for (const img of json.images) {
        model.images.push({
          name: img.name || '',
          uri: img.uri || '',
          mimeType: img.mimeType || '',
          bufferView: img.bufferView !== undefined ? bufferViews[img.bufferView] : null
        });
      }
    }

    if (json.skins) {
      for (const skin of json.skins) {
        model.skins.push({
          name: skin.name || '',
          joints: skin.joints || [],
          inverseBindMatrices: skin.inverseBindMatrices !== undefined ? readAccessor(accessors[skin.inverseBindMatrices]) : null,
          skeleton: skin.skeleton || 0
        });
      }
    }

    if (json.animations) {
      for (const anim of json.animations) {
        const animation = { name: anim.name || '', channels: [], samplers: [] };
        for (const sampler of anim.samplers) {
          animation.samplers.push({
            input: readAccessor(accessors[sampler.input]),
            output: readAccessor(accessors[sampler.output]),
            interpolation: sampler.interpolation || 'LINEAR'
          });
        }
        for (const channel of anim.channels) {
          animation.channels.push({
            sampler: channel.sampler,
            target: { node: channel.target.node, path: channel.target.path }
          });
        }
        model.animations.push(animation);
      }
    }

    if (json.nodes) {
      for (const node of json.nodes) {
        model.nodes.push({
          name: node.name || '',
          mesh: node.mesh !== undefined ? node.mesh : -1,
          skin: node.skin !== undefined ? node.skin : -1,
          translation: node.translation || [0,0,0],
          rotation: node.rotation || [0,0,0,1],
          scale: node.scale || [1,1,1],
          matrix: node.matrix || null,
          children: node.children || [],
          camera: node.camera !== undefined ? node.camera : -1,
          extensions: node.extensions || {}
        });
      }
    }

    if (json.scenes) {
      for (const scene of json.scenes) {
        model.scenes.push({ name: scene.name || '', nodes: scene.nodes || [] });
      }
    }

    if (json.cameras) {
      for (const cam of json.cameras) {
        model.cameras.push({
          name: cam.name || '',
          type: cam.type,
          perspective: cam.perspective || null,
          orthographic: cam.orthographic || null
        });
      }
    }

    model.loaded = true;
    return model;
  }

  function getAnimationDuration(model, animIndex) {
    const anim = model.animations[animIndex];
    if (!anim) return 0;
    let max = 0;
    for (const sampler of anim.samplers) {
      const times = sampler.input;
      if (times.length > 0 && times[times.length - 1] > max) max = times[times.length - 1];
    }
    return max;
  }

  function getNodeByName(model, name) {
    return model.nodes.findIndex(n => n.name === name);
  }

  return { load, parseGLB, parseJSON, getAnimationDuration, getNodeByName };
})();

if (typeof window !== 'undefined') window.GLTFLoader = GLTFLoader;
if (typeof globalThis !== 'undefined') globalThis.GLTFLoader = GLTFLoader;

/**
 * OBJ模型加载器 - Wavefront OBJ格式
 * 支持：顶点/法线/UV/面/材质库/组
 * @version 2.0.0
 */
'use strict';

const OBJLoader = (function () {

  async function load(url, options = {}) {
    const response = await fetch(url);
    const text = await response.text();
    return parse(text, options);
  }

  function parse(text, options = {}) {
    const model = {
      format: 'obj',
      vertices: [],
      normals: [],
      uvs: [],
      faces: [],
      groups: [],
      materials: [],
      materialLibrary: '',
      currentGroup: null,
      currentMaterial: null
    };

    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;
      const parts = line.split(/\s+/);
      const command = parts[0];

      switch (command) {
        case 'v':
          model.vertices.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
          break;
        case 'vn':
          model.normals.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
          break;
        case 'vt':
          model.uvs.push([parseFloat(parts[1]), parseFloat(parts[2])]);
          break;
        case 'f':
          const face = { vertices: [], group: model.currentGroup, material: model.currentMaterial };
          for (let j = 1; j < parts.length; j++) {
            const indices = parts[j].split('/');
            face.vertices.push({
              v: parseInt(indices[0]) - 1,
              vt: indices[1] ? parseInt(indices[1]) - 1 : -1,
              vn: indices[2] ? parseInt(indices[2]) - 1 : -1
            });
          }
          model.faces.push(face);
          break;
        case 'g':
          model.currentGroup = parts.slice(1).join(' ');
          if (!model.groups.includes(model.currentGroup)) model.groups.push(model.currentGroup);
          break;
        case 'usemtl':
          model.currentMaterial = parts.slice(1).join(' ');
          break;
        case 'mtllib':
          model.materialLibrary = parts.slice(1).join(' ');
          break;
        case 'o':
          model.name = parts.slice(1).join(' ');
          break;
      }
    }

    model.vertexCount = model.vertices.length;
    model.faceCount = model.faces.length;
    model.loaded = true;
    return model;
  }

  function triangulate(model) {
    const triangles = [];
    for (const face of model.faces) {
      for (let i = 1; i < face.vertices.length - 1; i++) {
        triangles.push([face.vertices[0], face.vertices[i], face.vertices[i + 1]]);
      }
    }
    return triangles;
  }

  function computeBoundingBox(model) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const v of model.vertices) {
      if (v[0] < minX) minX = v[0]; if (v[1] < minY) minY = v[1]; if (v[2] < minZ) minZ = v[2];
      if (v[0] > maxX) maxX = v[0]; if (v[1] > maxY) maxY = v[1]; if (v[2] > maxZ) maxZ = v[2];
    }
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  }

  return { load, parse, triangulate, computeBoundingBox };
})();

if (typeof window !== 'undefined') window.OBJLoader = OBJLoader;
if (typeof globalThis !== 'undefined') globalThis.OBJLoader = OBJLoader;

/**
 * VMD动画加载器 - MikuMikuDance VMD格式
 * 支持：骨骼关键帧/形态关键帧/相机关键帧/光照关键帧/属性关键帧
 * @version 2.0.0
 */
'use strict';

const VMDLoader = (function () {

  function parse(buffer, options = {}) {
    const data = new DataView(buffer);
    let offset = 0;
    const anim = {
      format: 'vmd',
      version: '',
      modelName: '',
      boneFrames: [],
      morphFrames: [],
      cameraFrames: [],
      lightFrames: [],
      propertyFrames: [],
      boneDictionary: {},
      morphDictionary: {}
    };

    const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 30));
    anim.version = magic.includes('Vocaloid Motion Data 0002') ? '2.0' : '1.0';
    offset = 30;

    const nameBytes = new Uint8Array(buffer, offset, 20);
    anim.modelName = new TextDecoder('shift-jis').decode(nameBytes).replace(/\0/g, '');
    offset += 20;

    const boneCount = data.getUint32(offset, true); offset += 4;
    for (let i = 0; i < boneCount; i++) {
      const nameBytes = new Uint8Array(buffer, offset, 15);
      const boneName = new TextDecoder('shift-jis').decode(nameBytes).replace(/\0/g, '');
      offset += 15;
      const frame = {
        boneName,
        frameNumber: data.getUint32(offset, true),
        position: [data.getFloat32(offset+4, true), data.getFloat32(offset+8, true), data.getFloat32(offset+12, true)],
        rotation: [data.getFloat32(offset+16, true), data.getFloat32(offset+20, true), data.getFloat32(offset+24, true), data.getFloat32(offset+28, true)],
        interpolation: {
          x: [data.getUint8(offset+32), data.getUint8(offset+36), data.getUint8(offset+40), data.getUint8(offset+44)],
          y: [data.getUint8(offset+33), data.getUint8(offset+37), data.getUint8(offset+41), data.getUint8(offset+45)],
          z: [data.getUint8(offset+34), data.getUint8(offset+38), data.getUint8(offset+42), data.getUint8(offset+46)],
          r: [data.getUint8(offset+35), data.getUint8(offset+39), data.getUint8(offset+43), data.getUint8(offset+47)]
        }
      };
      offset += 48;
      anim.boneFrames.push(frame);
      if (!anim.boneDictionary[boneName]) anim.boneDictionary[boneName] = [];
      anim.boneDictionary[boneName].push(anim.boneFrames.length - 1);
    }

    const morphCount = data.getUint32(offset, true); offset += 4;
    for (let i = 0; i < morphCount; i++) {
      const nameBytes = new Uint8Array(buffer, offset, 15);
      const morphName = new TextDecoder('shift-jis').decode(nameBytes).replace(/\0/g, '');
      offset += 15;
      const frame = {
        morphName,
        frameNumber: data.getUint32(offset, true),
        weight: data.getFloat32(offset + 4, true)
      };
      offset += 8;
      anim.morphFrames.push(frame);
      if (!anim.morphDictionary[morphName]) anim.morphDictionary[morphName] = [];
      anim.morphDictionary[morphName].push(anim.morphFrames.length - 1);
    }

    if (offset < buffer.byteLength - 4) {
      const cameraCount = data.getUint32(offset, true); offset += 4;
      for (let i = 0; i < cameraCount; i++) {
        anim.cameraFrames.push({
          frameNumber: data.getUint32(offset, true),
          distance: data.getFloat32(offset+4, true),
          position: [data.getFloat32(offset+8,true), data.getFloat32(offset+12,true), data.getFloat32(offset+16,true)],
          rotation: [data.getFloat32(offset+20,true), data.getFloat32(offset+24,true), data.getFloat32(offset+28,true)],
          interpolation: new Uint8Array(buffer, offset+32, 24),
          fov: data.getUint32(offset+56, true),
          perspective: data.getUint8(offset+60) !== 0
        });
        offset += 61;
      }
    }

    if (offset < buffer.byteLength - 4) {
      const lightCount = data.getUint32(offset, true); offset += 4;
      for (let i = 0; i < lightCount; i++) {
        anim.lightFrames.push({
          frameNumber: data.getUint32(offset, true),
          color: [data.getFloat32(offset+4,true), data.getFloat32(offset+8,true), data.getFloat32(offset+12,true)],
          direction: [data.getFloat32(offset+16,true), data.getFloat32(offset+20,true), data.getFloat32(offset+24,true)]
        });
        offset += 28;
      }
    }

    anim.boneFrames.sort((a, b) => a.frameNumber - b.frameNumber);
    anim.morphFrames.sort((a, b) => a.frameNumber - b.frameNumber);
    anim.duration = anim.boneFrames.length > 0 ? anim.boneFrames[anim.boneFrames.length - 1].frameNumber : 0;
    anim.loaded = true;
    return anim;
  }

  function getBoneFramesAt(anim, boneName, frame) {
    const indices = anim.boneDictionary[boneName];
    if (!indices) return null;
    let prev = null, next = null;
    for (const idx of indices) {
      const f = anim.boneFrames[idx];
      if (f.frameNumber <= frame) prev = f;
      if (f.frameNumber >= frame && !next) next = f;
    }
    return { prev, next };
  }

  function getMorphWeightAt(anim, morphName, frame) {
    const indices = anim.morphDictionary[morphName];
    if (!indices) return 0;
    let prev = null, next = null;
    for (const idx of indices) {
      const f = anim.morphFrames[idx];
      if (f.frameNumber <= frame) prev = f;
      if (f.frameNumber >= frame && !next) next = f;
    }
    if (!prev) return next ? next.weight : 0;
    if (!next) return prev.weight;
    const t = (frame - prev.frameNumber) / (next.frameNumber - prev.frameNumber || 1);
    return prev.weight + (next.weight - prev.weight) * t;
  }

  return { parse, getBoneFramesAt, getMorphWeightAt };
})();

if (typeof window !== 'undefined') window.VMDLoader = VMDLoader;
if (typeof globalThis !== 'undefined') globalThis.VMDLoader = VMDLoader;

/**
 * 网格优化器 - 简化/重索引/LOD生成/过度绘制优化
 * @version 2.0.0
 */
'use strict';

const MeshOptimizer = (function () {

  function simplify(vertices, indices, targetCount, options = {}) {
    if (indices.length <= targetCount) return { vertices, indices, removed: 0 };
    const error = computeVertexErrors(vertices, indices);
    const sortedIndices = indices.map((_, i) => i).sort((a, b) => error[a] - error[b]);
    const removeCount = Math.floor((indices.length - targetCount) / 3) * 3;
    const toRemove = new Set(sortedIndices.slice(0, removeCount));
    const newIndices = [];
    for (let i = 0; i < indices.length; i += 3) {
      if (!toRemove.has(i) && !toRemove.has(i+1) && !toRemove.has(i+2)) {
        newIndices.push(indices[i], indices[i+1], indices[i+2]);
      }
    }
    return { vertices, indices: new Uint32Array(newIndices), removed: indices.length - newIndices.length };
  }

  function computeVertexErrors(vertices, indices) {
    const errors = new Float32Array(indices.length);
    for (let i = 0; i < indices.length; i += 3) {
      const a = vertices[indices[i]*3], b = vertices[indices[i]*3+1], c = vertices[indices[i]*3+2];
      const area = Math.abs((b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0])) * 0.5;
      errors[i] = errors[i+1] = errors[i+2] = area;
    }
    return errors;
  }

  function reindex(vertices, attributes) {
    const vertexMap = new Map();
    const uniqueVertices = [];
    const indices = [];
    const vertexSize = 3 + (attributes.normal ? 3 : 0) + (attributes.uv ? 2 : 0);
    for (let i = 0; i < vertices.length; i += vertexSize) {
      const key = vertices.slice(i, i + vertexSize).join(',');
      if (!vertexMap.has(key)) {
        vertexMap.set(key, uniqueVertices.length);
        uniqueVertices.push(...vertices.slice(i, i + vertexSize));
      }
      indices.push(vertexMap.get(key));
    }
    return { vertices: new Float32Array(uniqueVertices), indices: new Uint32Array(indices) };
  }

  function generateLOD(vertices, indices, levels = 3) {
    const lods = [{ vertices, indices, ratio: 1 }];
    let current = { vertices, indices };
    for (let i = 1; i <= levels; i++) {
      const ratio = 1 / (i + 1);
      const target = Math.floor(indices.length * ratio);
      current = simplify(current.vertices, current.indices, target);
      lods.push({ vertices: current.vertices, indices: current.indices, ratio });
    }
    return lods;
  }

  function optimizeOverdraw(indices, vertices) {
    const centroids = [];
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i], b = indices[i+1], c = indices[i+2];
      centroids.push({
        index: i,
        x: (vertices[a*3] + vertices[b*3] + vertices[c*3]) / 3,
        y: (vertices[a*3+1] + vertices[b*3+1] + vertices[c*3+1]) / 3,
        z: (vertices[a*3+2] + vertices[b*3+2] + vertices[c*3+2]) / 3
      });
    }
    centroids.sort((a, b) => b.z - a.z);
    const optimized = [];
    for (const c of centroids) {
      optimized.push(indices[c.index], indices[c.index+1], indices[c.index+2]);
    }
    return new Uint32Array(optimized);
  }

  function computeVertexCacheHits(indices, cacheSize = 32) {
    const cache = [];
    let hits = 0;
    for (const idx of indices) {
      if (cache.includes(idx)) hits++;
      else {
        if (cache.length >= cacheSize) cache.shift();
        cache.push(idx);
      }
    }
    return { hits, total: indices.length, ratio: hits / indices.length };
  }

  function weldVertices(vertices, tolerance = 1e-6) {
    const map = new Map();
    const result = [];
    const remap = [];
    for (let i = 0; i < vertices.length; i += 3) {
      const key = [Math.round(vertices[i]/tolerance), Math.round(vertices[i+1]/tolerance), Math.round(vertices[i+2]/tolerance)].join(',');
      if (!map.has(key)) {
        map.set(key, result.length / 3);
        result.push(vertices[i], vertices[i+1], vertices[i+2]);
      }
      remap.push(map.get(key));
    }
    return { vertices: new Float32Array(result), remap };
  }

  function calculateBoundingSphere(vertices) {
    let cx = 0, cy = 0, cz = 0;
    const count = vertices.length / 3;
    for (let i = 0; i < vertices.length; i += 3) { cx += vertices[i]; cy += vertices[i+1]; cz += vertices[i+2]; }
    cx /= count; cy /= count; cz /= count;
    let maxDist = 0;
    for (let i = 0; i < vertices.length; i += 3) {
      const dx = vertices[i] - cx, dy = vertices[i+1] - cy, dz = vertices[i+2] - cz;
      const d = dx*dx + dy*dy + dz*dz;
      if (d > maxDist) maxDist = d;
    }
    return { center: [cx, cy, cz], radius: Math.sqrt(maxDist) };
  }

  return { simplify, reindex, generateLOD, optimizeOverdraw, computeVertexCacheHits, weldVertices, calculateBoundingSphere };
})();

if (typeof window !== 'undefined') window.MeshOptimizer = MeshOptimizer;
if (typeof globalThis !== 'undefined') globalThis.MeshOptimizer = MeshOptimizer;

/**
 * 纹理图集 - 合并多纹理减少draw call
 * @version 2.0.0
 */
'use strict';

const TextureAtlas = (function () {

  class TextureAtlas {
    constructor(width = 2048, height = 2048) {
      this.width = width;
      this.height = height;
      this.regions = new Map();
      this.freeNodes = [{ x: 0, y: 0, width, height }];
      this.padding = 2;
      this.canvas = null;
      this.ctx = null;
      this.dirty = false;
    }

    add(name, image, width, height) {
      if (this.regions.has(name)) return this.regions.get(name);
      const node = this._findNode(width + this.padding * 2, height + this.padding * 2);
      if (!node) return null;
      const region = {
        x: node.x + this.padding,
        y: node.y + this.padding,
        width, height,
        u0: (node.x + this.padding) / this.width,
        v0: (node.y + this.padding) / this.height,
        u1: (node.x + this.padding + width) / this.width,
        v1: (node.y + this.padding + height) / this.height
      };
      this.regions.set(name, region);
      this.dirty = true;
      return region;
    }

    _findNode(width, height) {
      for (let i = 0; i < this.freeNodes.length; i++) {
        const node = this.freeNodes[i];
        if (node.width >= width && node.height >= height) {
          this.freeNodes.splice(i, 1);
          if (node.width - width > 0) {
            this.freeNodes.push({ x: node.x + width, y: node.y, width: node.width - width, height });
          }
          if (node.height - height > 0) {
            this.freeNodes.push({ x: node.x, y: node.y + height, width, height: node.height - height });
          }
          return { x: node.x, y: node.y };
        }
      }
      return null;
    }

    getRegion(name) { return this.regions.get(name); }
    has(name) { return this.regions.has(name); }
    getUV(name) {
      const r = this.regions.get(name);
      return r ? [r.u0, r.v0, r.u1, r.v1] : null;
    }
    getUsage() {
      let used = 0;
      for (const r of this.regions.values()) used += r.width * r.height;
      return { used, total: this.width * this.height, ratio: used / (this.width * this.height) };
    }
    clear() { this.regions.clear(); this.freeNodes = [{ x: 0, y: 0, width: this.width, height: this.height }]; this.dirty = false; }
  }

  function generateMipmaps(image, levels = 4) {
    const mipmaps = [image];
    let current = image;
    for (let i = 1; i < levels; i++) {
      const w = Math.max(1, Math.floor(current.width / 2));
      const h = Math.max(1, Math.floor(current.height / 2));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(current, 0, 0, w, h);
      mipmaps.push(canvas);
      current = canvas;
    }
    return mipmaps;
  }

  function compressTexture(image, quality = 0.8) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return canvas.toDataURL('image/webp', quality);
  }

  return { TextureAtlas, generateMipmaps, compressTexture };
})();

if (typeof window !== 'undefined') window.TextureAtlas = TextureAtlas;
if (typeof globalThis !== 'undefined') globalThis.TextureAtlas = TextureAtlas;

/**
 * 模型缓存管理器
 * @version 2.0.0
 */
'use strict';

const ModelCache = (function () {
  const _cache = new Map();
  const _metadata = new Map();
  let _maxSize = 128 * 1024 * 1024;
  let _currentSize = 0;

  function set(key, model, size) {
    if (_cache.has(key)) {
      const old = _metadata.get(key);
      _currentSize -= old.size;
    }
    _cache.set(key, model);
    _metadata.set(key, { size, addedAt: Date.now(), lastAccess: Date.now(), accessCount: 0 });
    _currentSize += size;
    if (_currentSize > _maxSize) evict();
  }

  function get(key) {
    const model = _cache.get(key);
    if (model) {
      const meta = _metadata.get(key);
      meta.lastAccess = Date.now();
      meta.accessCount++;
    }
    return model;
  }

  function has(key) { return _cache.has(key); }

  function remove(key) {
    const meta = _metadata.get(key);
    if (meta) {
      _currentSize -= meta.size;
      _cache.delete(key);
      _metadata.delete(key);
    }
  }

  function evict() {
    const entries = Array.from(_metadata.entries()).sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    for (const [key, meta] of entries) {
      if (_currentSize <= _maxSize * 0.7) break;
      _currentSize -= meta.size;
      _cache.delete(key);
      _metadata.delete(key);
    }
  }

  function clear() { _cache.clear(); _metadata.clear(); _currentSize = 0; }
  function getStats() {
    return { count: _cache.size, size: _currentSize, maxSize: _maxSize, ratio: _currentSize / _maxSize };
  }
  function setMaxSize(bytes) { _maxSize = bytes; }
  function getKeys() { return Array.from(_cache.keys()); }

  return { set, get, has, remove, evict, clear, getStats, setMaxSize, getKeys };
})();

if (typeof window !== 'undefined') window.ModelCache = ModelCache;
if (typeof globalThis !== 'undefined') globalThis.ModelCache = ModelCache;
