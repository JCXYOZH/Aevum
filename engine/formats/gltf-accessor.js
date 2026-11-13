/**
 * glTF accessor 解码。
 *
 * 把 glTF 的 accessor / bufferView 读成浏览器和 WebGL 可直接使用的
 * Float32Array / Uint32Array / Uint16Array。支持 byteStride、normalized、
 * SCALAR / VEC2 / VEC3 / VEC4 / MAT4。
 */
'use strict';

const COMPONENTS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16
};

const COMPONENT_SIZE = {
  5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4
};

function readComponent(view, offset, componentType) {
  switch (componentType) {
    case 5120: return view.getInt8(offset);
    case 5121: return view.getUint8(offset);
    case 5122: return view.getInt16(offset, true);
    case 5123: return view.getUint16(offset, true);
    case 5125: return view.getUint32(offset, true);
    case 5126: return view.getFloat32(offset, true);
    default: throw new Error(`不支持的 accessor componentType：${componentType}`);
  }
}

function normalizeComponent(value, componentType) {
  switch (componentType) {
    case 5120: return Math.max(value / 127, -1);
    case 5121: return value / 255;
    case 5122: return Math.max(value / 32767, -1);
    case 5123: return value / 65535;
    default: return value;
  }
}

function createResult(accessor, componentType) {
  const count = accessor.count;
  const components = COMPONENTS[accessor.type];
  const total = count * components;
  if (componentType === 5125) return new Uint32Array(total);
  if (componentType === 5123) return new Uint16Array(total);
  return new Float32Array(total);
}

function readAccessor(json, binary, accessorIndex) {
  const accessor = json.accessors && json.accessors[accessorIndex];
  if (!accessor) throw new Error(`accessor 不存在：${accessorIndex}`);
  if (accessor.bufferView === undefined) {
    throw new Error(`accessor ${accessorIndex} 没有 bufferView，暂不支持 sparse`);
  }

  const bufferView = json.bufferViews[accessor.bufferView];
  if (!bufferView) throw new Error(`bufferView 不存在：${accessor.bufferView}`);
  const components = COMPONENTS[accessor.type];
  if (!components) throw new Error(`不支持的 accessor type：${accessor.type}`);

  const componentType = accessor.componentType;
  const componentSize = COMPONENT_SIZE[componentType];
  if (!componentSize) throw new Error(`不支持的 componentType：${componentType}`);

  const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = bufferView.byteStride || componentSize * components;
  const view = new DataView(binary);
  const result = createResult(accessor, componentType);
  let out = 0;

  for (let i = 0; i < accessor.count; i += 1) {
    const base = byteOffset + i * stride;
    for (let c = 0; c < components; c += 1) {
      let value = readComponent(view, base + c * componentSize, componentType);
      if (accessor.normalized) value = normalizeComponent(value, componentType);
      result[out] = value;
      out += 1;
    }
  }

  return result;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { readAccessor, COMPONENTS, COMPONENT_SIZE };
}

if (typeof window !== 'undefined') {
  window.AEVUM = window.AEVUM || {};
  window.AEVUM.formats = window.AEVUM.formats || {};
  window.AEVUM.formats.readAccessor = readAccessor;
}
