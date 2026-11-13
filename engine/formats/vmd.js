/**
 * Aevum VMD 动作解析器
 *
 * VMD 是 MMD 的骨骼动作格式：头部固定 30 字节，模型名 20 字节，
 * 随后是按数量排列的骨骼关键帧、Morph 关键帧、相机关键帧和光照关键帧。
 * 骨骼名和 Morph 名通常是 Shift-JIS 编码，这里统一解码成 Unicode。
 *
 * 只做纯解析，不依赖 DOM、WebGL 或渲染器。
 */
'use strict';

const HEADER_SIZE = 30;
const BONE_NAME_SIZE = 15;
const BONE_FRAME_SIZE = BONE_NAME_SIZE + 4 + 12 + 16 + 64;

function decodeShiftJis(bytes) {
  try {
    return new TextDecoder('shift-jis').decode(bytes);
  } catch (error) {
    try {
      return new TextDecoder('shift_jis').decode(bytes);
    } catch (fallbackError) {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

class VMDParser {
  constructor(buffer, options = {}) {
    this.buffer = null;
    this.view = null;
    this.bytes = null;
    this.offset = 0;
    this.stopAfterBones = options.stopAfterBones === true;
    if (buffer) this.setBuffer(buffer);
  }

  setBuffer(buffer) {
    if (buffer && buffer.buffer && !(buffer instanceof ArrayBuffer)) {
      const start = buffer.byteOffset || 0;
      buffer = buffer.buffer.slice(start, start + buffer.byteLength);
    }
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
    this.offset = 0;
    return this;
  }

  ensure(count) {
    if (this.offset + count > this.buffer.byteLength) {
      throw new Error(`VMD 数据越界：offset ${this.offset} + ${count} > ${this.buffer.byteLength}`);
    }
  }

  u8() {
    this.ensure(1);
    const value = this.bytes[this.offset];
    this.offset += 1;
    return value;
  }

  u32() {
    this.ensure(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  f32() {
    this.ensure(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  fixedString(length) {
    this.ensure(length);
    const start = this.offset;
    let end = start;
    while (end < start + length && this.bytes[end] !== 0) end += 1;
    const text = decodeShiftJis(this.bytes.subarray(start, end));
    this.offset += length;
    return text;
  }

  vec3() {
    return [this.f32(), this.f32(), this.f32()];
  }

  quat() {
    return [this.f32(), this.f32(), this.f32(), this.f32()];
  }

  parse(buffer) {
    if (buffer) this.setBuffer(buffer);
    if (!this.buffer) throw new Error('VMD 解析器缺少 ArrayBuffer');
    if (this.buffer.byteLength < HEADER_SIZE + 20 + 4) {
      throw new Error('VMD 文件过短');
    }

    const signatureEnd = Math.min(HEADER_SIZE, this.buffer.byteLength);
    let signature = '';
    for (let i = 0; i < signatureEnd && this.bytes[i] !== 0; i += 1) {
      signature += String.fromCharCode(this.bytes[i]);
    }
    if (!signature.startsWith('Vocaloid Motion Data')) {
      throw new Error(`不是 VMD 文件：${signature.slice(0, 24)}`);
    }

    this.offset = HEADER_SIZE;
    const modelName = this.fixedString(20);
    const boneCount = this.u32();
    const boneKeyframeCount = boneCount;

    const boneFrames = [];
    const boneFrameMap = Object.create(null);

    for (let i = 0; i < boneCount; i += 1) {
      this.ensure(BONE_FRAME_SIZE);
      const name = this.fixedString(BONE_NAME_SIZE);
      const frame = this.u32();
      const position = this.vec3();
      const rotation = this.quat();
      const interpolation = new Uint8Array(64);
      for (let j = 0; j < 64; j += 1) interpolation[j] = this.u8();

      const entry = { name, frame, position, rotation, interpolation };
      boneFrames.push(entry);
      if (!boneFrameMap[name]) boneFrameMap[name] = [];
      boneFrameMap[name].push(entry);
    }

    for (const name of Object.keys(boneFrameMap)) {
      boneFrameMap[name].sort((a, b) => a.frame - b.frame);
    }

    const totalFrames = boneFrames.reduce((max, frame) => Math.max(max, frame.frame), 0);

    if (this.stopAfterBones) {
      return {
        signature,
        modelName,
        boneCount,
        boneKeyframeCount,
        morphCount: 0,
        boneFrames,
        boneFrameMap,
        morphFrames: [],
        morphFrameMap: Object.create(null),
        totalFrames
      };
    }

    let morphCount = 0;
    const morphFrames = [];
    const morphFrameMap = Object.create(null);
    if (this.offset + 4 <= this.buffer.byteLength) {
      morphCount = this.u32();
      for (let i = 0; i < morphCount; i += 1) {
        this.ensure(BONE_NAME_SIZE + 4 + 4);
        const name = this.fixedString(BONE_NAME_SIZE);
        const frame = this.u32();
        const weight = this.f32();
        const entry = { name, frame, weight };
        morphFrames.push(entry);
        if (!morphFrameMap[name]) morphFrameMap[name] = [];
        morphFrameMap[name].push(entry);
      }
      for (const name of Object.keys(morphFrameMap)) {
        morphFrameMap[name].sort((a, b) => a.frame - b.frame);
      }
    }

    return {
      signature,
      modelName,
      boneCount,
      boneKeyframeCount,
      morphCount,
      boneFrames,
      boneFrameMap,
      morphFrames,
      morphFrameMap,
      totalFrames
    };
  }
}

function parseVMD(buffer, options = {}) {
  return new VMDParser(buffer, options).parse();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VMDParser, parseVMD, HEADER_SIZE, BONE_NAME_SIZE, BONE_FRAME_SIZE };
}

if (typeof window !== 'undefined') {
  window.AEVUM = window.AEVUM || {};
  window.AEVUM.formats = window.AEVUM.formats || {};
  window.AEVUM.formats.VMDParser = VMDParser;
  window.AEVUM.formats.parseVMD = parseVMD;
}
