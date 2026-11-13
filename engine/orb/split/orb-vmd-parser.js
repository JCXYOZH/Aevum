/**
 * MrHua 3D灵体渲染引擎 - orb-vmd-parser
 * VMD动画文件解析器
 * 从 orb-renderer-main.js 拆分 (原行 L2244-L2362)
 * @module orb-vmd-parser
 */
'use strict';

/* ===== VMD 动画文件解析器（MMD动作格式） ===== */
function parseVMD(buffer){
  const dv = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  let off = 0;
  console.log('[VMD] parseVMD 开始 buffer.byteLength=' + buffer.byteLength);
  const magic = String.fromCharCode(u8[0],u8[1],u8[2],u8[3],u8[4],u8[5],u8[6],u8[7],u8[8],u8[9],u8[10],u8[11],u8[12],u8[13],u8[14]);
  if(magic.substring(0,3) !== 'Vocal') throw new Error('不是 VMD 文件: '+magic.substring(0,10));
  const version = String.fromCharCode(...u8.subarray(0,30)).replace(/\0/g,'');
  off = 30;
  console.log('[VMD] version=' + version + ' off=' + off);
  function readStr(len){
    let end = off;
    for(let i=0;i<len;i++){ if(u8[off+i]===0){end=off+i;break;} end=off+i+1; }
    const s = new TextDecoder('shift-jis').decode(u8.subarray(off,end));
    off += len; return s;
  }
  function readU8(){ const v=u8[off]; off++; return v; }
  function readU16(){ const v=dv.getUint16(off,true); off+=2; return v; }
  function readU32(){ const v=dv.getUint32(off,true); off+=4; return v; }
  function readF32(){ const v=dv.getFloat32(off,true); off+=4; return v; }
  function readVec3(){ return [readF32(),readF32(),readF32()]; }
  function readQuat(){ return [readF32(),readF32(),readF32(),readF32()]; }
  const modelName = readStr(20);
  console.log('[VMD] modelName=' + modelName + ' off=' + off);
  const boneKeyframeCount = readU32();
  console.log('[VMD] boneKeyframeCount=' + boneKeyframeCount + ' off=' + off);
  const boneFrames = [];
  const boneFrameMap = {};
  for(let i=0;i<boneKeyframeCount;i++){
    const boneName = readStr(15);
    const frame = readU32();
    const position = readVec3();
    const rotation = readQuat();
    const interpolation = new Uint8Array(64);
    for(let j=0;j<64;j++) interpolation[j]=readU8();
    const entry = {frame, position, rotation, interpolation};
    boneFrames.push(entry);
    if(!boneFrameMap[boneName]) boneFrameMap[boneName]=[];
    boneFrameMap[boneName].push(entry);
  }
  for(const name in boneFrameMap) boneFrameMap[name].sort((a,b)=>a.frame-b.frame);
  console.log('[VMD] 骨骼关键帧解析完成 off=' + off);
  const morphKeyframeCount = readU32();
  console.log('[VMD] morphKeyframeCount=' + morphKeyframeCount + ' off=' + off);
  const morphFrames = [];
  const morphFrameMap = {};
  for(let i=0;i<morphKeyframeCount;i++){
    const morphName = readStr(15);
    const frame = readU32();
    const weight = readF32();
    const entry = {frame, weight};
    morphFrames.push(entry);
    if(!morphFrameMap[morphName]) morphFrameMap[morphName]=[];
    morphFrameMap[morphName].push(entry);
  }
  for(const name in morphFrameMap) morphFrameMap[name].sort((a,b)=>a.frame-b.frame);
  console.log('[VMD] 形态键关键帧解析完成 off=' + off);
  let cameraKeyframeCount = 0;
  const cameraFrames = [];
  if(off < buffer.byteLength - 4){
    try {
      cameraKeyframeCount = readU32();
      console.log('[VMD] cameraKeyframeCount=' + cameraKeyframeCount + ' off=' + off);
      for(let i=0;i<cameraKeyframeCount;i++){
        const frame = readU32();
        const distance = readF32();
        const position = readVec3();
        const rotation = readVec3();
        const interpolation = new Uint8Array(24);
        for(let j=0;j<24;j++) interpolation[j]=readU8();
        const fov = readU32();
        const perspective = readU8();
        cameraFrames.push({frame, distance, position, rotation, interpolation, fov, perspective});
      }
      cameraFrames.sort((a,b)=>a.frame-b.frame);
      console.log('[VMD] 相机关键帧解析完成 off=' + off);
    } catch(e){ console.log('[VMD] 相机关键帧解析跳过:', e.message); }
  }
  let lightKeyframeCount = 0;
  const lightFrames = [];
  if(off < buffer.byteLength - 4){
    try {
      lightKeyframeCount = readU32();
      console.log('[VMD] lightKeyframeCount=' + lightKeyframeCount + ' off=' + off);
      for(let i=0;i<lightKeyframeCount;i++){
        const frame = readU32();
        const color = readVec3();
        const direction = readVec3();
        lightFrames.push({frame, color, direction});
      }
      lightFrames.sort((a,b)=>a.frame-b.frame);
      console.log('[VMD] 光照关键帧解析完成 off=' + off);
    } catch(e){ console.log('[VMD] 光照关键帧解析跳过:', e.message); }
  }
  let selfShadowKeyframeCount = 0;
  const selfShadowFrames = [];
  if(off < buffer.byteLength - 4){
    try {
      selfShadowKeyframeCount = readU32();
      for(let i=0;i<selfShadowKeyframeCount;i++){
        const frame = readU32();
        const mode = readU8();
        const distance = readF32();
        selfShadowFrames.push({frame, mode, distance});
      }
      console.log('[VMD] 自阴影关键帧解析完成 count=' + selfShadowKeyframeCount);
    } catch(e){ console.log('[VMD] 自阴影关键帧解析跳过:', e.message); }
  }
  const totalFrames = boneFrames.length>0 ? Math.max(...boneFrames.map(f=>f.frame)) : 0;
  console.log('[VMD] parseVMD 完成 boneFrames=' + boneKeyframeCount + ' morphFrames=' + morphKeyframeCount + ' cameraFrames=' + cameraKeyframeCount + ' lightFrames=' + lightKeyframeCount + ' totalFrames=' + totalFrames);
  return {
    version, modelName, totalFrames,
    boneFrames, boneFrameMap,
    morphFrames, morphFrameMap,
    cameraFrames, lightFrames, selfShadowFrames,
  };
}

