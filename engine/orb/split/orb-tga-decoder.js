/**
 * MrHua 3D灵体渲染引擎 - orb-tga-decoder
 * TGA纹理解码器(纯手写零依赖)
 * 从 orb-renderer-main.js 拆分 (原行 L2452-L2544)
 * @module orb-tga-decoder
 */
'use strict';

/* ===== TGA 纹理解码器（纯手写，零依赖） ===== */
function decodeTGA(buffer){
  const dv = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  let off = 0;
  const idLen = dv.getUint8(off++);
  const colorMapType = dv.getUint8(off++);
  const imageType = dv.getUint8(off++);
  off += 5; // color map spec
  const xOrigin = dv.getUint16(off,true); off += 2;
  const yOrigin = dv.getUint16(off,true); off += 2;
  const width = dv.getUint16(off,true); off += 2;
  const height = dv.getUint16(off,true); off += 2;
  const depth = dv.getUint8(off++);
  const descriptor = dv.getUint8(off++);
  off += idLen; // skip image ID
  if(colorMapType !== 0) off += 0; // skip color map (simplified)

  const bytesPerPixel = depth >> 3;
  if(width <= 0 || height <= 0 || width > 8192 || height > 8192) throw new Error('TGA 尺寸异常: ' + width + 'x' + height);
  if(depth !== 8 && depth !== 16 && depth !== 24 && depth !== 32) throw new Error('TGA 色深不支持: ' + depth);
  const pixelCount = width * height;
  if(pixelCount > 67108864) throw new Error('TGA 像素数过大: ' + pixelCount);
  const rgba = new Uint8Array(pixelCount * 4);

  function readPixel(srcOff){
    if(depth === 32){
      rgba[srcOff*4]   = u8[off+2]; // R
      rgba[srcOff*4+1] = u8[off+1]; // G
      rgba[srcOff*4+2] = u8[off];   // B
      rgba[srcOff*4+3] = u8[off+3]; // A
      off += 4;
    } else if(depth === 24){
      rgba[srcOff*4]   = u8[off+2];
      rgba[srcOff*4+1] = u8[off+1];
      rgba[srcOff*4+2] = u8[off];
      rgba[srcOff*4+3] = 255;
      off += 3;
    } else if(depth === 16){
      const c = dv.getUint16(off,true); off += 2;
      rgba[srcOff*4]   = ((c >> 10) & 0x1F) << 3;
      rgba[srcOff*4+1] = ((c >> 5) & 0x1F) << 3;
      rgba[srcOff*4+2] = (c & 0x1F) << 3;
      rgba[srcOff*4+3] = (c & 0x8000) ? 255 : 255;
    } else if(depth === 8){
      const g = u8[off++];
      rgba[srcOff*4]=g; rgba[srcOff*4+1]=g; rgba[srcOff*4+2]=g; rgba[srcOff*4+3]=255;
    }
  }

  if(imageType === 2 || imageType === 3){
    // 未压缩
    for(let i=0;i<pixelCount;i++) readPixel(i);
  } else if(imageType === 10 || imageType === 11){
    // RLE 压缩
    let i = 0;
    while(i < pixelCount){
      const packet = u8[off++];
      const count = (packet & 0x7F) + 1;
      if(packet & 0x80){
        // RLE 包：重复单个像素
        const rleOff = off;
        for(let j=0;j<count && i<pixelCount;j++){
          off = rleOff;
          readPixel(i++);
        }
        off = rleOff + bytesPerPixel;
      } else {
        // 原始包：读取 count 个像素
        for(let j=0;j<count && i<pixelCount;j++) readPixel(i++);
      }
    }
  } else {
    throw new Error('不支持的 TGA 类型: ' + imageType);
  }

  // 处理上下翻转（descriptor bit 5 = 1 表示从上到下，需要翻转以匹配WebGL）
  const flipY = (descriptor & 0x20) !== 0;
  if(flipY){
    const rowSize = width * 4;
    const tmp = new Uint8Array(rowSize);
    for(let y=0;y<height/2;y++){
      const top = y * rowSize;
      const bot = (height-1-y) * rowSize;
      tmp.set(rgba.subarray(top, top+rowSize));
      rgba.copyWithin(top, bot, bot+rowSize);
      rgba.set(tmp, bot);
    }
  }

  return {width, height, data: rgba, descriptor, imageType, depth};
}

