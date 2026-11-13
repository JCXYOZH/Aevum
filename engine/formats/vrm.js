/**
 * Aevum VRM 解析器
 *
 * VRM 是带人形骨骼约定的 glTF 2.0 文件，通常是 .vrm 后缀的 GLB。
 * 这个模块读取 GLB、VRM 0.x 的 VRM 扩展或 VRM 1.0 的 VRMC_vrm 扩展，
 * 输出元信息、Humanoid 骨骼表、网格和蒙皮统计；不负责 accessor 解码。
 */
'use strict';

const glbModule = (typeof require === 'function')
  ? require('./glb.js')
  : { parseGLB: window.AEVUM.formats.parseGLB };

function normalizeHumanBones(extension) {
  const humanoid = extension && extension.humanoid;
  const bones = humanoid && humanoid.humanBones;
  if (!bones) return [];

  if (Array.isArray(bones)) {
    return bones.map((entry) => ({
      bone: entry.bone,
      node: entry.node,
      useDefaultValues: entry.useDefaultValues !== false
    }));
  }

  return Object.keys(bones).map((bone) => ({
    bone,
    node: bones[bone].node,
    useDefaultValues: bones[bone].useDefaultValues !== false
  }));
}

function parseVRM(buffer, options = {}) {
  const glb = glbModule.parseGLB(buffer, options);
  const json = glb.json;
  const extension = (json.extensions && (json.extensions.VRM || json.extensions.VRMC_vrm)) || null;
  if (!extension) throw new Error('不是 VRM：缺少 VRM 扩展');

  const specVersion = extension.specVersion || (json.extensions.VRM ? '0.x' : '1.0');
  const humanBones = normalizeHumanBones(extension);
  const humanBoneNodes = Object.create(null);
  const nodeNames = json.nodes ? json.nodes.map((node) => node.name || '') : [];

  for (const entry of humanBones) {
    humanBoneNodes[entry.bone] = entry.node;
  }

  const meshes = (json.meshes || []).map((mesh, index) => ({
    index,
    name: mesh.name || `mesh${index}`,
    primitives: (mesh.primitives || []).length
  }));

  const stats = {
    nodes: json.nodes ? json.nodes.length : 0,
    meshes: meshes.length,
    primitives: meshes.reduce((sum, mesh) => sum + mesh.primitives, 0),
    materials: json.materials ? json.materials.length : 0,
    textures: json.textures ? json.textures.length : 0,
    images: json.images ? json.images.length : 0,
    skins: json.skins ? json.skins.length : 0,
    accessors: json.accessors ? json.accessors.length : 0
  };

  return {
    glb,
    json,
    extension,
    specVersion,
    meta: extension.meta || null,
    humanBones,
    humanBoneNodes,
    nodeNames,
    meshes,
    stats
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseVRM, normalizeHumanBones };
}

if (typeof window !== 'undefined') {
  window.AEVUM = window.AEVUM || {};
  window.AEVUM.formats = window.AEVUM.formats || {};
  window.AEVUM.formats.parseVRM = parseVRM;
}
