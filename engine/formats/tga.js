/**
 * Aevum 渲染引擎 - TGA 解码
 *
 * 只做 MMD 贴图常见格式：未压缩 / RLE 真彩色、灰度，24/32 位。
 * 输出固定为左上角起点的 RGBA 字节，交给 WebGL 时再统一翻转 Y。
 *
 * @module Aevum/formats/tga
 */
(function (root) {
  'use strict';

  function readUint16(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
  }

  function readPixel(bytes, offset, bpp) {
    if (bpp === 1) {
      const value = bytes[offset];
      return [value, value, value, 255];
    }
    if (bpp === 3) {
      return [bytes[offset + 2], bytes[offset + 1], bytes[offset], 255];
    }
    if (bpp === 4) {
      return [bytes[offset + 2], bytes[offset + 1], bytes[offset], bytes[offset + 3]];
    }
    return [0, 0, 0, 255];
  }

  function decodeTGA(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length < 18) throw new Error('TGA header is truncated');

    const idLength = bytes[0];
    const colorMapType = bytes[1];
    const imageType = bytes[2];
    const colorMapLength = readUint16(bytes, 5);
    const colorMapEntryBits = bytes[7];
    const width = readUint16(bytes, 12);
    const height = readUint16(bytes, 14);
    const pixelDepth = bytes[16];
    const descriptor = bytes[17];
    if (!width || !height) throw new Error('TGA has no pixels');

    const bpp = Math.ceil(pixelDepth / 8);
    let offset = 18 + idLength;
    if (colorMapType === 1) {
      offset += colorMapLength * Math.ceil(colorMapEntryBits / 8);
    }

    const pixelCount = width * height;
    const raw = new Uint8Array(pixelCount * 4);
    const isRle = imageType === 10 || imageType === 11;

    if (!isRle && (imageType === 2 || imageType === 3)) {
      for (let i = 0; i < pixelCount; i += 1) {
        const pixel = readPixel(bytes, offset, bpp);
        raw[i * 4] = pixel[0];
        raw[i * 4 + 1] = pixel[1];
        raw[i * 4 + 2] = pixel[2];
        raw[i * 4 + 3] = pixel[3];
        offset += bpp;
      }
    } else if (isRle && (imageType === 10 || imageType === 11)) {
      let index = 0;
      while (index < pixelCount) {
        const packet = bytes[offset++];
        const count = (packet & 0x7f) + 1;
        if (packet & 0x80) {
          const pixel = readPixel(bytes, offset, bpp);
          offset += bpp;
          for (let i = 0; i < count && index < pixelCount; i += 1) {
            raw[index * 4] = pixel[0];
            raw[index * 4 + 1] = pixel[1];
            raw[index * 4 + 2] = pixel[2];
            raw[index * 4 + 3] = pixel[3];
            index += 1;
          }
        } else {
          for (let i = 0; i < count && index < pixelCount; i += 1) {
            const pixel = readPixel(bytes, offset, bpp);
            raw[index * 4] = pixel[0];
            raw[index * 4 + 1] = pixel[1];
            raw[index * 4 + 2] = pixel[2];
            raw[index * 4 + 3] = pixel[3];
            offset += bpp;
            index += 1;
          }
        }
      }
    } else {
      throw new Error('Unsupported TGA image type: ' + imageType);
    }

    const topOrigin = (descriptor & 0x20) !== 0;
    const rightOrigin = (descriptor & 0x10) !== 0;
    const data = new Uint8Array(pixelCount * 4);
    for (let y = 0; y < height; y += 1) {
      const sourceY = topOrigin ? y : height - 1 - y;
      for (let x = 0; x < width; x += 1) {
        const sourceX = rightOrigin ? width - 1 - x : x;
        const source = (sourceY * width + sourceX) * 4;
        const target = (y * width + x) * 4;
        data[target] = raw[source];
        data[target + 1] = raw[source + 1];
        data[target + 2] = raw[source + 2];
        data[target + 3] = raw[source + 3];
      }
    }

    return { width, height, data };
  }

  const api = { decodeTGA };
  root.AEVUM = root.AEVUM || {};
  root.AEVUM.formats = root.AEVUM.formats || {};
  root.AEVUM.formats.tga = api;
  root.AevumTGA = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
