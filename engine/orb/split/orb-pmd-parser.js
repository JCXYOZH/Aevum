/**
 * MrHua 3D灵体渲染引擎 - orb-pmd-parser
 * PMD模型格式解析器(MMD旧版)
 * 从 orb-renderer-main.js 拆分 (原行 L2029-L2128)
 * @module orb-pmd-parser
 */
'use strict';

/* ===== PMD 二进制解析器（MMD旧版格式） ===== */
function parsePMD(buffer){
  const dv = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  let off = 0;
  console.log('[PMD] parsePMD 开始 buffer.byteLength=' + buffer.byteLength);
  const magic = String.fromCharCode(u8[0],u8[1],u8[2]);
  if(magic !== 'Pmd') throw new Error('不是 PMD 文件: '+magic);
  const version = dv.getFloat32(3,true); off = 7;
  console.log('[PMD] version=' + version + ' off=' + off);
  function readStr(len){
    let end = off;
    for(let i=0;i<len;i++){ if(u8[off+i]===0){end=off+i;break;} end=off+i+1; }
    const s = new TextDecoder('shift-jis').decode(u8.subarray(off,end));
    off += len; return s;
  }
  function readU16(){ const v=dv.getUint16(off,true); off+=2; return v; }
  function readU32(){ const v=dv.getUint32(off,true); off+=4; return v; }
  function readF32(){ const v=dv.getFloat32(off,true); off+=4; return v; }
  function readVec3(){ const v=[readF32(),readF32(),readF32()]; return v; }
  const modelName = readStr(20);
  const comment = readStr(256);
  console.log('[PMD] modelName=' + modelName + ' off=' + off);
  const vertexCount = readU32();
  console.log('[PMD] vertexCount=' + vertexCount + ' off=' + off);
  const positions = new Float32Array(vertexCount*3);
  const normals = new Float32Array(vertexCount*3);
  const uvs = new Float32Array(vertexCount*2);
  const boneIndices = new Int32Array(vertexCount*2);
  const boneWeights = new Float32Array(vertexCount*2);
  const edgeFlags = new Uint8Array(vertexCount);
  for(let i=0;i<vertexCount;i++){
    positions[i*3]=readF32(); positions[i*3+1]=readF32(); positions[i*3+2]=readF32();
    normals[i*3]=readF32(); normals[i*3+1]=readF32(); normals[i*3+2]=readF32();
    uvs[i*2]=readF32(); uvs[i*2+1]=readF32();
    boneIndices[i*2]=readU16(); boneIndices[i*2+1]=readU16();
    const w = readU16()/100;
    boneWeights[i*2]=w; boneWeights[i*2+1]=1-w;
    edgeFlags[i]=u8[off]; off++;
  }
  console.log('[PMD] 顶点解析完成 off=' + off);
  const faceCount = readU32();
  const indices = new Uint32Array(faceCount);
  for(let i=0;i<faceCount;i++) indices[i]=readU16();
  console.log('[PMD] 面解析完成 faces=' + faceCount + ' off=' + off);
  const materialCount = readU32();
  const materials = [];
  for(let i=0;i<materialCount;i++){
    const diffuse=[readF32(),readF32(),readF32(),readF32()];
    const shininess=readF32();
    const specular=[readF32(),readF32(),readF32()];
    const ambient=[readF32(),readF32(),readF32()];
    const toonIdx=u8[off]; off++;
    const edgeFlag=u8[off]; off++;
    const surfaceCount=readU32();
    const textureName=readStr(20).trim();
    materials.push({name:'mat_'+i, diffuse, specular, ambient, shininess, textureIdx: textureName?0:-1, surfaceCount, toonIdx, edgeFlag});
  }
  console.log('[PMD] 材质解析完成 materials=' + materials.length + ' off=' + off);
  const boneCount = readU16();
  const bones = [];
  for(let i=0;i<boneCount;i++){
    const name=readStr(20);
    const parent=readU16();
    const tailIndex=readU16();
    const type=u8[off]; off++;
    const IKIndex=readU16();
    const position=readVec3();
    bones.push({name, parent: parent===0xFFFF?-1:parent, tailIndex, type, IKIndex, position, rotation:[0,0,0,1], scale:[1,1,1]});
  }
  console.log('[PMD] 骨骼解析完成 bones=' + bones.length + ' off=' + off);
  const morphCount = readU16();
  const morphs = [];
  for(let i=0;i<morphCount;i++){
    const name=readStr(20);
    const vertCount=readU32();
    const vertices=[];
    for(let j=0;j<vertCount;j++){
      const idx=readU32();
      const pos=readVec3();
      vertices.push({idx,pos});
    }
    morphs.push({name,vertices});
  }
  console.log('[PMD] 形态键解析完成 morphs=' + morphs.length + ' off=' + off);
  const textures = [];
  for(let i=0;i<materials.length;i++){
    if(materials[i].textureIdx>=0 && textures.length===0) textures.push('texture.bmp');
  }
  console.log('[PMD] parsePMD 完成 vertices=' + vertexCount + ' faces=' + faceCount + ' bones=' + boneCount + ' materials=' + materialCount);
  return {
    vertexCount, faceCount, boneCount: bones.length, materialCount: materials.length,
    textureCount: textures.length, morphCount: morphs.length,
    positions, normals, uvs, boneIndices, boneWeights, indices,
    textures, materials, bones, morphs, edgeFlags,
    encoding: 1, uvCount: 1, boneIdxSize: 2, vertIdxSize: 2,
    modelName, comment,
  };
}

