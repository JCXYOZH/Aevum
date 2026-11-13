/**
 * Aevum GLB 容器解析器
 *
 * GLB 是 glTF 2.0 的二进制封装：12 字节文件头 + 若干 chunk。
 * 第一个 chunk 必须是 JSON，第二个通常是通过 BIN 存放的顶点、索引和贴图数据。
 * 这里只拆容器和 JSON，不负责 accessor 解码或渲染。
 */
'use strict';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK = 0x4e4f534a; // 'JSON'
const BIN_CHUNK = 0x004e4942; // 'BIN\0'

class GLBParser {
  constructor(buffer, options = {}) {
    this.buffer = null;
    this.view = null;
    this.bytes = null;
    this.options = options;
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
    return this;
  }

  parse(buffer) {
    if (buffer) this.setBuffer(buffer);
    if (!this.buffer || this.buffer.byteLength < 12) {
      throw new Error('GLB 文件过短');
    }

    const magic = this.view.getUint32(0, true);
    if (magic !== GLB_MAGIC) {
      throw new Error('不是 GLB 文件');
    }
    const version = this.view.getUint32(4, true);
    if (version !== 2) {
      throw new Error(`不支持的 GLB 版本：${version}`);
    }

    const declaredLength = this.view.getUint32(8, true);
    const length = Math.min(declaredLength || this.buffer.byteLength, this.buffer.byteLength);
    let offset = 12;
    let json = null;
    let binary = null;
    const chunks = [];

    while (offset + 8 <= length) {
      const chunkLength = this.view.getUint32(offset, true);
      const chunkType = this.view.getUint32(offset + 4, true);
      const dataStart = offset + 8;
      const dataEnd = dataStart + chunkLength;
      if (dataEnd > length) throw new Error('GLB chunk 越界');

      if (chunkType === JSON_CHUNK) {
        const text = new TextDecoder('utf-8').decode(this.bytes.subarray(dataStart, dataEnd));
        json = JSON.parse(text);
        chunks.push({ type: 'JSON', length: chunkLength });
      } else if (chunkType === BIN_CHUNK) {
        binary = this.buffer.slice(dataStart, dataEnd);
        chunks.push({ type: 'BIN', length: chunkLength });
      } else {
        chunks.push({ type: `0x${chunkType.toString(16)}`, length: chunkLength });
      }

      offset = dataEnd;
    }

    if (!json) throw new Error('GLB 缺少 JSON chunk');

    return {
      version,
      length,
      json,
      binary,
      chunks,
      asset: json.asset || null
    };
  }
}

function parseGLB(buffer, options = {}) {
  return new GLBParser(buffer, options).parse();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GLBParser, parseGLB, GLB_MAGIC, JSON_CHUNK, BIN_CHUNK };
}

if (typeof window !== 'undefined') {
  window.AEVUM = window.AEVUM || {};
  window.AEVUM.formats = window.AEVUM.formats || {};
  window.AEVUM.formats.GLBParser = GLBParser;
  window.AEVUM.formats.parseGLB = parseGLB;
}
