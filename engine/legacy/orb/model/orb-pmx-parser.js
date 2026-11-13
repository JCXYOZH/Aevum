/**
 * MrHua 3D灵体渲染引擎 - orb-pmx-parser
 * PMX模型格式解析器
 * 从 orb-renderer-main.js 拆分 (原行 L490-L2028)
 * @module orb-pmx-parser
 */
'use strict';

/* ===== PMX 名称清洗函数 ===== */
function cleanBoneName(name, index){
  if(typeof name !== 'string') return 'unnamed_bone_' + index;
  let cleaned = name;
  // 去除控制字符（0x00-0x1f 和 0x7f-0x9f），保留换行制表等不保留
  cleaned = cleaned.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '');
  // 去除 Unicode 替代字符（解码失败产生的 U+FFFD）
  cleaned = cleaned.replace(/\uFFFD/g, '');
  // 去除两端空白
  cleaned = cleaned.trim();
  // 截断过长名称（超过200字符的，大概率是错位数据）
  if(cleaned.length > 200){
    cleaned = cleaned.substring(0, 200);
  }
  // 空名称兜底
  if(cleaned.length === 0){
    cleaned = 'unnamed_bone_' + index;
  }
  return cleaned;
}

/* ===== PMX 骨骼表修复扫描器 =====
   扫描骨骼表，检测 flags 说有条件数据但实际字节为0的非标准骨骼。
   返回修复策略数组，每个元素包含 {index, origFlags, newFlags, origCondSize, actualCondSize}
*/
function scanAndRepairBoneTable(dv, buffer, boneSectionStart, boneCount, boneIndexSize, encoding){
  const repairLog = [];
  const decoder = encoding === 1 ? new TextDecoder('utf-8') : new TextDecoder('utf-16le');
  let off = boneSectionStart;
  let repairedCount = 0;

  function _readTextAt(pos, maxLen){
    if(pos + 4 > buffer.byteLength) return null;
    const len = dv.getInt32(pos, true);
    if(len < 0 || len > (maxLen || 500)) return null;
    if(pos + 4 + len > buffer.byteLength) return null;
    const bytes = new Uint8Array(buffer, pos + 4, len);
    // 验证 UTF-16LE 有效性
    if(encoding === 0){
      if(len % 2 !== 0) return null;
      for(let k = 0; k < len; k += 2){
        const code = bytes[k] | (bytes[k+1] << 8);
        if(code === 0 || code > 0xFFFF) return null;
      }
    }
    try{
      return decoder.decode(bytes);
    }catch(e){
      return null;
    }
  }

  function _calcCondSizeStandard(fieldOff, flags){
    let sz = 0, p = fieldOff + 18 + boneIndexSize;
    if(flags & 0x0008){ sz += boneIndexSize + 4; p += boneIndexSize + 4; }
    if(flags & 0x0010){ const s = (flags & 0x0008) ? 4 : (boneIndexSize + 4); sz += s; p += s; }
    if(flags & 0x0020){ sz += 12; p += 12; }
    if(flags & 0x0040){ sz += 24; p += 24; }
    if(flags & 0x0100){ sz += 4; p += 4; }
    if(flags & 0x0004){
      sz += boneIndexSize + 12; p += boneIndexSize + 12;
      try{
        const lc = dv.getInt32(p - 4, true);
        if(lc >= 0 && lc <= 200){
          for(let li = 0; li < lc; li++){
            if(p + boneIndexSize + 1 > buffer.byteLength) break;
            const hl = dv.getUint8(p + boneIndexSize);
            const ls = boneIndexSize + 1 + (hl ? 24 : 0);
            sz += ls; p += ls;
          }
        }
      }catch(e){}
    }
    return sz;
  }

  function _validateNextBone(candidateOff){
    if(candidateOff + 8 > buffer.byteLength) return false;
    const name = _readTextAt(candidateOff, 200);
    if(name === null) return false;
    if(name.length === 0) return false;
    const neOff = candidateOff + 4 + (name.length * (encoding === 0 ? 2 : 1));
    if(neOff + 4 > buffer.byteLength) return false;
    const neLen = dv.getInt32(neOff, true);
    if(neLen < 0 || neLen > 200) return false;
    const fOff = neOff + 4 + neLen;
    if(fOff + 18 + boneIndexSize > buffer.byteLength) return false;
    try{
      const px = dv.getFloat32(fOff, true), py = dv.getFloat32(fOff+4, true), pz = dv.getFloat32(fOff+8, true);
      if(!isFinite(px)||!isFinite(py)||!isFinite(pz)) return false;
      if(Math.abs(px)>100||Math.abs(py)>100||Math.abs(pz)>100) return false;
      const par = boneIndexSize===1?dv.getInt8(fOff+12):dv.getInt16(fOff+12,true);
      if(par<-1||par>=boneCount) return false;
      const fl = dv.getUint16(fOff+12+boneIndexSize+4,true);
      if((fl&0xFF00)!==0) return false;
    }catch(e){ return false; }
    return true;
  }

  for(let i = 0; i < boneCount; i++){
    const boneStart = off;
    if(boneStart + 8 > buffer.byteLength) break;

    const nameLen = dv.getInt32(boneStart, true);
    if(nameLen < 1 || nameLen > 500){
      repairLog.push({index:i, status:'error', reason:'nameLen异常='+nameLen, boneStart:boneStart});
      break;
    }
    const neOff = boneStart + 4 + nameLen;
    if(neOff + 4 > buffer.byteLength) break;
    const nameEnLen = dv.getInt32(neOff, true);
    if(nameEnLen < 0 || nameEnLen > 500){
      repairLog.push({index:i, status:'error', reason:'nameEnLen异常='+nameEnLen, boneStart:boneStart});
      break;
    }
    const fieldOff = neOff + 4 + nameEnLen;
    if(fieldOff + 20 > buffer.byteLength) break;

    // 非标准字段顺序：position→parent→transformLevel→flags
    const flags = dv.getUint16(fieldOff + 12 + boneIndexSize + 4, true);
    const parent = boneIndexSize === 1 ? dv.getInt8(fieldOff + 12) : dv.getInt16(fieldOff + 12, true);

    const standardCondSize = _calcCondSizeStandard(fieldOff, flags);
    const condStart = fieldOff + 20;

    // 尝试标准解析后的下一个骨骼位置
    const standardNextOff = condStart + standardCondSize; // PMX 2.0没有postPos字段
    // 尝试条件数据=0后的下一个骨骼位置（postPos在condStart，2字节）
    const zeroCondNextOff = condStart; // PMX 2.0没有postPos字段

    let actualCondSize = standardCondSize;
    let needsRepair = false;
    let scannedNextOff = -1; // 验证失败时，用扫描找到的下一个骨骼位置

    // 关键：无论 standardCondSize 是否为0，都要验证下一个骨骼位置。
    // flags可能因前一个骨骼错位而读错（如0xe000），导致standardCondSize=0，
    // 但实际条件数据不为0，此时zeroCondNextOff(=condStart)是无效的，必须扫描恢复。
    const zeroCondValid = _validateNextBone(zeroCondNextOff);
    let standardValid = false;
    if(standardCondSize > 0){
      standardValid = _validateNextBone(standardNextOff);
    }

    if(standardCondSize > 0 && !standardValid && zeroCondValid){
      // 标准解析无效，条件数据=0有效 → 需要修复
      needsRepair = true;
      actualCondSize = 0;
    }else if(standardCondSize > 0 && standardValid && zeroCondValid){
      // 两个都有效，用更保守的判断：检查parent是否合理
      if(standardNextOff + 4 <= buffer.byteLength){
        const sNameLen = dv.getInt32(standardNextOff, true);
        if(sNameLen >= 1 && sNameLen <= 200){
          // 标准解析看起来也有效，不强制修复
        }
      }
    }else if(!zeroCondValid){
      // 条件数据=0的位置无效（包括standardCondSize=0但实际有条件数据的情况）：
      // 用扫描找下一个骨骼位置，避免用错误位置推进导致连锁错位
      for(let _scan = 2; _scan <= 65536; _scan += 2){
        const _tryOff = condStart + _scan;
        if(_tryOff + 8 > buffer.byteLength) break;
        if(_validateNextBone(_tryOff)){
          scannedNextOff = _tryOff;
          break;
        }
      }
    }

    if(needsRepair){
      // 修复策略：把 flags 改成只保留物理后（0x0010），这样不需要条件数据
      const newFlags = flags & 0x0010;
      repairLog.push({
        index: i,
        status: 'repaired',
        boneStart: boneStart,
        fieldOff: fieldOff,
        origFlags: flags,
        newFlags: newFlags,
        origCondSize: standardCondSize,
        actualCondSize: 0,
        parent: parent,
        nameLen: nameLen
      });
      repairedCount++;
      // 用修复后的大小推进偏移
      off = boneStart + 4 + nameLen + 4 + nameEnLen + 20; // PMX 2.0没有postPos字段
    }else if(scannedNextOff > 0){
      // 两种假设都无效，但扫描找到了下一个骨骼位置：用扫描到的位置推进，避免连锁错位
      repairLog.push({
        index: i,
        status: 'scan_recovered',
        boneStart: boneStart,
        origFlags: flags,
        origCondSize: standardCondSize,
        actualCondSize: scannedNextOff - condStart,
        parent: parent
      });
      off = scannedNextOff;
    }else{
      repairLog.push({
        index: i,
        status: 'ok',
        boneStart: boneStart,
        origFlags: flags,
        origCondSize: standardCondSize,
        actualCondSize: standardCondSize,
        parent: parent
      });
      off = standardNextOff;
    }
  }

  console.log('[PMX-REPAIR] 骨骼表扫描完成: 总数=' + boneCount + ' 修复=' + repairedCount + ' 错误=' + repairLog.filter(function(r){return r.status==='error';}).length);
  return { repairLog: repairLog, repairedCount: repairedCount, endOff: off };
}

/* ===== PMX 二进制解析器 ===== */
function parsePMX(buffer){
  const dv = new DataView(buffer);
  let off = 0;
  console.log('[PMX] parsePMX 开始 buffer.byteLength=' + buffer.byteLength);
  const magic = String.fromCharCode(dv.getUint8(off),dv.getUint8(off+1),dv.getUint8(off+2),dv.getUint8(off+3));
  off += 4;
  console.log('[PMX] magic=' + JSON.stringify(magic) + ' off=' + off);
  if(magic !== 'PMX ') throw new Error('不是 PMX 文件: '+JSON.stringify(magic));
  const version = dv.getFloat32(off,true); off += 4;
  console.log('[PMX] version=' + version + ' off=' + off);
  const globalsCount = dv.getUint8(off); off += 1;
  console.log('[PMX] globalsCount=' + globalsCount + ' off=' + off);
  const encoding = dv.getUint8(off); off += 1; // 0=UTF-16LE, 1=UTF-8
  const uvCount = dv.getUint8(off); off += 1;
  const vertexIndexSize = dv.getUint8(off); off += 1;
  const textureIndexSize = dv.getUint8(off); off += 1;
  const materialIndexSize = dv.getUint8(off); off += 1;
  const boneIndexSize = dv.getUint8(off); off += 1;
  const morphIndexSize = dv.getUint8(off); off += 1;
  const rigidbodyIndexSize = dv.getUint8(off); off += 1;
  off = globalsCount >= 9 ? off + (globalsCount-8) : off;
  console.log('[PMX] globals完成 off=' + off + ' encoding=' + encoding + ' uvCount=' + uvCount + ' boneIdxSize=' + boneIndexSize + ' vertIdxSize=' + vertexIndexSize + ' next4bytes=0x' + dv.getUint32(off,true).toString(16));

  const decoder = encoding === 1 ? new TextDecoder('utf-8') : new TextDecoder('utf-16le');
  function readText(maxLen){
    const len = dv.getInt32(off,true); off += 4;
    if(len <= 0) return '';
    const limit = maxLen ? Math.min(maxLen, buffer.byteLength) : Math.min(buffer.byteLength, 1000000);
    if(len > limit){
      throw new Error('readText 长度异常: len=' + len + ' (0x' + len.toString(16) + ') off=' + (off-4) + ' limit=' + limit + ' buffer=' + buffer.byteLength + ' next4=0x' + dv.getUint32(off-4,true).toString(16));
    }
    const bytes = new Uint8Array(buffer, off, len); off += len;
    return decoder.decode(bytes);
  }
  function readI(size){
    let v;
    if(size===1) v=dv.getInt8(off);
    else if(size===2) v=dv.getInt16(off,true);
    else v=dv.getInt32(off,true);
    off += size; return v;
  }
  function readU(size){
    let v;
    if(size===1) v=dv.getUint8(off);
    else if(size===2) v=dv.getUint16(off,true);
    else v=dv.getUint32(off,true);
    off += size; return v;
  }
  function readVec3(){ const v=[dv.getFloat32(off,true),dv.getFloat32(off+4,true),dv.getFloat32(off+8,true)]; off+=12; return v; }
  function readVec4(){ const v=[dv.getFloat32(off,true),dv.getFloat32(off+4,true),dv.getFloat32(off+8,true),dv.getFloat32(off+12,true)]; off+=16; return v; }

  const modelName = readText();
  const modelNameEn = readText();
  const comment = readText();
  const commentEn = readText();
  console.log('[PMX] 头部完成 off=' + off + ' encoding=' + encoding + ' uvCount=' + uvCount + ' boneIdxSize=' + boneIndexSize + ' vertIdxSize=' + vertexIndexSize);

  // 顶点
  const vertexCount = dv.getInt32(off,true); off += 4;
  console.log('[PMX] 顶点数=' + vertexCount + ' off=' + off);
  if (vertexCount < 0 || vertexCount > 10000000) throw new Error('顶点数异常: ' + vertexCount + ' at offset ' + (off-4));
  const positions = new Float32Array(vertexCount*3);
  const normals = new Float32Array(vertexCount*3);
  const uvs = new Float32Array(vertexCount*2);
  const boneIndices = new Int32Array(vertexCount*4);
  const boneWeights = new Float32Array(vertexCount*4);
  const weightTypes = new Uint8Array(vertexCount);
  for(let i=0;i<vertexCount;i++){
    const p=readVec3(); positions[i*3]=p[0];positions[i*3+1]=p[1];positions[i*3+2]=p[2];
    const n=readVec3(); normals[i*3]=n[0];normals[i*3+1]=n[1];normals[i*3+2]=n[2];
    const uv=[dv.getFloat32(off,true),dv.getFloat32(off+4,true)]; off+=8; uvs[i*2]=uv[0];uvs[i*2+1]=uv[1];
    off += uvCount*16;
    const wt = dv.getUint8(off); off += 1;
    weightTypes[i]=wt;
    if(wt===0){ // BDEF1
      boneIndices[i*4]=readI(boneIndexSize);
      boneWeights[i*4]=1;
    } else if(wt===1){ // BDEF2
      boneIndices[i*4]=readI(boneIndexSize); boneIndices[i*4+1]=readI(boneIndexSize);
      const w=dv.getFloat32(off,true); off+=4;
      boneWeights[i*4]=w; boneWeights[i*4+1]=1-w;
    } else if(wt===2){ // BDEF4
      for(let j=0;j<4;j++) boneIndices[i*4+j]=readI(boneIndexSize);
      for(let j=0;j<4;j++){ boneWeights[i*4+j]=dv.getFloat32(off,true); off+=4; }
    } else if(wt===3){ // SDEF
      boneIndices[i*4]=readI(boneIndexSize); boneIndices[i*4+1]=readI(boneIndexSize);
      const w=dv.getFloat32(off,true); off+=4;
      boneWeights[i*4]=w; boneWeights[i*4+1]=1-w;
      off += 36; // C(vec3) + R0(vec3) + R1(vec3) = 36 bytes
    } else if(wt===4){ // QDEF (weightType=4)
      for(let j=0;j<4;j++) boneIndices[i*4+j]=readI(boneIndexSize);
      for(let j=0;j<4;j++){ boneWeights[i*4+j]=dv.getFloat32(off,true); off+=4; }
      off += 64; // QDEF额外四元数数据: 4个四元数，每个4float=16字节，共64字节
    } else {
      throw new Error('未知权重类型: ' + wt + ' at vertex ' + i);
    }
    off += 4; // edge scale
  }
  const _wt = {};
  for(let i=0;i<vertexCount;i++){ const t=weightTypes[i]; _wt[t]=(_wt[t]||0)+1; }
  console.log('[PMX] 顶点解析完成 off=' + off + ' 权重类型分布:', _wt);
  // 检查顶点坐标范围
  let _minX=999,_minY=999,_minZ=999,_maxX=-999,_maxY=-999,_maxZ=-999;
  let _badVerts = 0, _firstBad = -1, _lastBad = -1;
  const _badByType = {};
  for(let i=0;i<vertexCount;i++){
    const x=positions[i*3], y=positions[i*3+1], z=positions[i*3+2];
    if(x<_minX)_minX=x; if(x>_maxX)_maxX=x;
    if(y<_minY)_minY=y; if(y>_maxY)_maxY=y;
    if(z<_minZ)_minZ=z; if(z>_maxZ)_maxZ=z;
    if(!isFinite(x) || !isFinite(y) || !isFinite(z) || Math.abs(x)>100 || Math.abs(y)>100 || Math.abs(z)>100){
      _badVerts++;
      if(_firstBad<0) _firstBad=i;
      _lastBad=i;
      const _t=weightTypes[i]; _badByType[_t]=(_badByType[_t]||0)+1;
    }
  }
  console.log('[PMX] 顶点坐标范围: X=[' + _minX.toFixed(3) + ',' + _maxX.toFixed(3) + '] Y=[' + _minY.toFixed(3) + ',' + _maxY.toFixed(3) + '] Z=[' + _minZ.toFixed(3) + ',' + _maxZ.toFixed(3) + ']');
  if(_badVerts>0){
    console.log('[PMX] 异常顶点数=' + _badVerts + ' 首个=' + _firstBad + ' 末个=' + _lastBad + ' 按权重类型:', _badByType);
  }
  let _minU=999,_minV=999,_maxU=-999,_maxV=-999;
  for(let i=0;i<vertexCount;i++){ const u=uvs[i*2],v=uvs[i*2+1]; if(u<_minU)_minU=u; if(u>_maxU)_maxU=u; if(v<_minV)_minV=v; if(v>_maxV)_maxV=v; }
  console.log('[PMX] UV范围: U=[' + _minU.toFixed(3) + ',' + _maxU.toFixed(3) + '] V=[' + _minV.toFixed(3) + ',' + _maxV.toFixed(3) + ']');

  // 面
  const faceCount = dv.getInt32(off,true); off += 4;
  console.log('[PMX] 面数=' + faceCount + ' off=' + off);
  if (faceCount < 0 || faceCount > 100000000) throw new Error('面数异常: ' + faceCount + ' at offset ' + (off-4));
  const indices = new Uint32Array(faceCount);
  for(let i=0;i<faceCount;i++){ indices[i]=readU(vertexIndexSize); }
  console.log('[PMX] 面解析完成 off=' + off);
  // 检查面索引范围
  let _badIdx = 0, _maxIdx = 0;
  for(let i=0;i<faceCount;i++){ if(indices[i]>=vertexCount) _badIdx++; if(indices[i]>_maxIdx)_maxIdx=indices[i]; }
  if(_badIdx>0) console.log('[PMX] 异常面索引数=' + _badIdx + ' 最大索引=' + _maxIdx + ' 顶点数=' + vertexCount);

  // 纹理
  const textureCount = dv.getInt32(off,true); off += 4;
  console.log('[PMX] 纹理数=' + textureCount + ' off=' + off);
  const textures = [];
  for(let i=0;i<textureCount;i++){ textures.push(readText()); }
  console.log('[PMX] 纹理解析完成 off=' + off);

  // 材质
  const materialCount = dv.getInt32(off,true); off += 4;
  console.log('[PMX] 材质数=' + materialCount + ' off=' + off);
  if (materialCount < 0 || materialCount > 100000) throw new Error('材质数异常: ' + materialCount + ' at offset ' + (off-4));
  const materials = [];
  let _totalSurfaces = 0;
  let _matParseError = false;
  for(let i=0;i<materialCount;i++){
    const _matStart = off;
    try{
      const name=readText(), nameEn=readText();
      const diffuse=readVec4();
      const specular=readVec3();
      const shininess=dv.getFloat32(off,true); off+=4;
      const ambient=readVec3();
      const flags=dv.getUint8(off); off+=1;
      const edgeColor=readVec4();
      const edgeSize=dv.getFloat32(off,true); off+=4;
      const textureIdx=readI(textureIndexSize);
      const sphereTextureIdx=readI(textureIndexSize);
      const sphereMode=dv.getUint8(off); off+=1;
      const sharedToon=dv.getUint8(off); off+=1;
      const toonIdx = sharedToon ? dv.getInt8(off) : readI(textureIndexSize);
      off += sharedToon ? 1 : 0;
      const metadata=readText();
      const surfaceCount=dv.getInt32(off,true); off+=4;
      _totalSurfaces += surfaceCount;
      materials.push({name,diffuse,specular,shininess,ambient,flags,edgeColor,edgeSize,textureIdx,sphereTextureIdx,sphereMode,sharedToon,toonIdx,metadata,surfaceCount});
    }catch(e){
      console.error('[PMX-MAT] 材质#' + i + ' 解析失败 matStart=' + _matStart + ' err=' + e.message);
      _matParseError = true;
      break;
    }
  }
  // 验证材质表面数总和
  console.log('[PMX-MAT] 材质解析完成 count=' + materials.length + '/' + materialCount + ' totalSurfaces=' + _totalSurfaces + ' faceCount=' + faceCount + ' match=' + (_totalSurfaces === faceCount));
  if(_totalSurfaces !== faceCount){
    console.warn('[PMX-MAT] 警告: 材质表面数总和(' + _totalSurfaces + ')与面数(' + faceCount + ')不一致!');
  }
  for(let mi=0;mi<materials.length;mi++){
    const m = materials[mi];
    console.log('[PMX-MAT] #' + mi + ' name=' + JSON.stringify(m.name) + ' diffuse=(' + m.diffuse.map(function(v){return v.toFixed(2);}).join(',') + ') ambient=(' + m.ambient.map(function(v){return v.toFixed(2);}).join(',') + ') tex=' + m.textureIdx + ' sphere=' + m.sphereTextureIdx + ' sphereMode=' + m.sphereMode + ' sharedToon=' + m.sharedToon + ' toon=' + m.toonIdx + ' surfaces=' + m.surfaceCount + ' flags=0x' + m.flags.toString(16));
  }

  // 骨骼
  const boneCount = dv.getInt32(off,true); off += 4;
  if (boneCount < 0 || boneCount > 100000) throw new Error('骨骼数异常: ' + boneCount + ' at offset ' + (off-4));
  console.log('[PMX] 骨骼数=' + boneCount + ' off=' + off);
  const _boneSectionStart = off;
  // ===== 骨骼表修复扫描：检测 flags 说有条件数据但实际为0的非标准骨骼 =====
  const _repairResult = scanAndRepairBoneTable(dv, buffer, _boneSectionStart, boneCount, boneIndexSize, encoding);
  const _repairLog = _repairResult.repairLog;
  const _repairedBoneSet = {};
  // 从修复日志提取所有骨骼位置（按索引排序），用于入口验证时的大范围恢复
  // scanAndRepairBoneTable 已经扫描了整个骨骼段，比 _boneMap（仅前100KB）覆盖范围大得多
  const _allBonePositions = [];
  for(const _r of _repairLog){
    if(_r.status === 'repaired'){
      _repairedBoneSet[_r.index] = _r;
    }
    if(_r.boneStart && _r.boneStart > 0){
      _allBonePositions.push({index: _r.index, off: _r.boneStart, status: _r.status});
    }
  }
  _allBonePositions.sort((a,b) => a.off - b.off);
  const _scanRecoveredCount = _repairLog.filter(r => r.status === 'scan_recovered').length;
  console.log('[PMX] 骨骼修复策略已加载: 修复骨骼数=' + _repairResult.repairedCount + ', 扫描恢复=' + _scanRecoveredCount + ', 总位置=' + _allBonePositions.length);
  const _scanEnd = Math.min(off + 100000, buffer.byteLength);
  const _boneMap = [];
  for(let _so = off; _so < _scanEnd - 20; _so++){
    const _nlen = dv.getInt32(_so, true);
    if(_nlen < 1 || _nlen > 200) continue;
    if(_so + 4 + _nlen > buffer.byteLength) continue;
    const _nb = new Uint8Array(buffer, _so + 4, _nlen);
    let _nv = true;
    if(encoding === 0){
      if(_nlen % 2 !== 0) _nv = false;
      else { for(let _k=0;_k<_nlen;_k+=2){ const _c=_nb[_k]|(_nb[_k+1]<<8); if(_c===0||_c>0xFFFF){_nv=false;break;} } }
    }
    if(!_nv) continue;
    let _p = _so + 4 + _nlen;
    const _nelen = dv.getInt32(_p, true);
    if(_nelen < 0 || _nelen > 200) continue;
    if(_p + 4 + _nelen > buffer.byteLength) continue;
    const _nm = decoder.decode(_nb);
    const _raw64 = _so+64 <= buffer.byteLength ? Array.from(new Uint8Array(buffer,_so,64)).map(b=>b.toString(16).padStart(2,'0')).join(' ') : 'EOF';
    _boneMap.push({off:_so, name:_nm, nameLen:_nlen, nameEnLen:_nelen, gap:_boneMap.length > 0 ? _so - _boneMap[_boneMap.length-1].off : 0, raw64:_raw64});
  }
  console.log('[PMX-BONEMAP] 扫描完成 候选=' + _boneMap.length + ' (position-first格式)');

  // ===== 独立预扫描骨骼位置：不依赖条件数据大小推进，彻底避免连锁错位 =====
  // 借鉴参考文件 _bonePositions 思路：从骨骼段起始位置扫描整个骨骼段（最大2MB），
  // 用宽松的连续验证（至少2个骨骼的name/nameEn长度有效）收集所有有效骨骼位置。
  // 正式解析时直接用这些位置，即使某个骨骼条件数据大小算错，下一个位置还是正确的。
  const _bonePositions = [];
  const _maxBoneScan = Math.min(_boneSectionStart + 2000000, buffer.byteLength - 100);
  function _validateBoneLoose(pos){
    // 宽松验证：只检查name和nameEn长度有效，不检查flags高位（非标准模型flags可能有高位）
    try{
      if(pos + 8 > buffer.byteLength) return false;
      const nLen = dv.getInt32(pos, true);
      if(nLen < 1 || nLen > 200) return false;
      if(encoding === 0 && nLen % 2 !== 0) return false;
      const neOff = pos + 4 + nLen;
      if(neOff + 4 > buffer.byteLength) return false;
      const neLen = dv.getInt32(neOff, true);
      if(neLen < 0 || neLen > 200) return false;
      if(encoding === 0 && neLen > 0 && neLen % 2 !== 0) return false;
      // 检查字段数据最小大小（position 12 + parent + transformLevel 4 + flags 2）
      const fOff = neOff + 4 + neLen;
      if(fOff + 18 + boneIndexSize > buffer.byteLength) return false;
      return true;
    }catch(e){ return false; }
  }
  for(let _scanOff = _boneSectionStart; _scanOff < _maxBoneScan; _scanOff += 2){
    // 连续验证至少2个骨骼，确保位置正确（避免假阳性）
    if(_validateBoneLoose(_scanOff)){
      let _chainValid = true;
      let _nextOff = _scanOff;
      for(let _c = 0; _c < 2; _c++){
        if(!_validateBoneLoose(_nextOff)){ _chainValid = false; break; }
        // 推进到下一个骨骼的最小位置（name + nameEn + 最小字段数据）
        const _nLen = dv.getInt32(_nextOff, true);
        const _neOff = _nextOff + 4 + _nLen;
        const _neLen = dv.getInt32(_neOff, true);
        _nextOff = _neOff + 4 + _neLen + 18 + boneIndexSize;
      }
      if(_chainValid){
        // 位置间距至少50字节（避免重复收集同一个骨骼）
        if(_bonePositions.length === 0 || _scanOff - _bonePositions[_bonePositions.length-1] >= 50){
          _bonePositions.push(_scanOff);
          if(_bonePositions.length >= boneCount) break;
        }
      }
    }
  }
  console.log('[PMX-PRESCAN] 独立预扫描骨骼位置完成: 收集到' + _bonePositions.length + '个位置 (boneCount=' + boneCount + ')');

  const bones = [];
  let _boneFlagHist = {};
  let _prevBoneEnd = 0;
  const _boneFieldOrders = [
    // 标准及常见非标准排列
    ['position','parent','transformLevel','flags'],
    ['parent','transformLevel','flags','position'],
    ['parent','transformLevel','position','flags'],
    ['transformLevel','parent','flags','position'],
    ['position','flags','parent','transformLevel'],
    ['flags','parent','transformLevel','position'],
    ['position','transformLevel','parent','flags'],
    ['parent','position','transformLevel','flags'],
    ['transformLevel','position','parent','flags'],
    ['flags','position','parent','transformLevel'],
    ['position','parent','flags','transformLevel'],
    ['parent','flags','position','transformLevel'],
  ];
  let _boneFieldOrder = null;
  function _tryBoneOrder(baseOff, order){
    let p = baseOff;
    const r = {};
    for(const f of order){
      if(f === 'parent'){ r.parent = boneIndexSize===1 ? dv.getInt8(p) : dv.getInt16(p,true); p += boneIndexSize; }
      else if(f === 'transformLevel'){ r.transformLevel = dv.getInt32(p,true); p += 4; }
      else if(f === 'flags'){ r.flags = dv.getUint16(p,true); p += 2; }
      else if(f === 'position'){ r.position = [dv.getFloat32(p,true), dv.getFloat32(p+4,true), dv.getFloat32(p+8,true)]; p += 12; }
    }
    r.endOff = p;
    r.fieldOff = baseOff;
    return r;
  }
  function _validateBoneFields(r){
    if(r.parent < -1 || r.parent >= boneCount) return false;
    if(r.transformLevel < -10000 || r.transformLevel > 100000) return false;
    if((r.flags & 0xFF00) !== 0) return false;
    if(r.flags > 0x003F && (r.flags & 0x003F) === 0) return false;
    for(const v of r.position){
      if(!isFinite(v) || Math.abs(v) > 100000) return false;
    }
    return true;
  }
  // 健壮的骨骼字段顺序自适应检测器：从骨骼真实起始位置出发，正确计算每个骨骼的字节大小
  /**
   * PMX 2.0 骨骼条件数据大小统一计算函数
   *
   * PMX flags 位定义（条件数据部分）：
   *   bit0 (0x0001): 可表示      - 无条件数据
   *   bit1 (0x0002): 可操作      - 无条件数据
   *   bit2 (0x0004): IK          - IKターゲット + ループ回数 + 制限角度 + IKリンク数 + IKリンクデータ
   *   bit3 (0x0008): 移動付与    - 付与親索引(boneIndexSize) + 移動付与率(float32, 4)
   *   bit4 (0x0010): 回転付与    - 若未设移動付与则读付与親索引 + 回転付与率(4)；移動付与已读索引则共享
   *   bit5 (0x0020): 固定軸      - 固定軸方向(vec3, 12)
   *   bit6 (0x0040): ローカル付与 - X軸(vec3, 12) + Z軸(vec3, 12) = 24
   *   bit7 (0x0080): 物理後      - 无条件数据
   *   bit8 (0x0100): 外部親      - 外部親ボーン索引(int32, 4)
   *   bit9+ (0x0200+): 保留位     - 非标准模型可能设置，计算时忽略
   *
   * 健壮性校验：
   *   - flags包含保留高位时记录警告（不中断计算）
   *   - IK链接数 > 20 时记录警告，> 200 时返回-1（视为读取错误）
   *   - 条件数据总大小 > 4KB 时记录警告（单个骨骼条件数据通常不超过4KB）
   *
   * @param {number} fieldOff - 字段数据起始偏移（position开始处）
   * @param {number} flags - 骨骼flags值
   * @param {boolean} precise - true=精确模式(读取IK链接数计算完整大小)，false=粗略模式(只估算IK固定部分)
   * @returns {number} 条件数据大小（字节），计算失败返回-1
   */
  function _calcCondSize(fieldOff, flags, precise){
    // flags合理性校验：保留高位(0x0200以上)非标准，记录警告但继续计算标准位
    if(flags & 0xFE00){
      console.warn('[PMX-COND] flags包含非标准保留高位: 0x' + flags.toString(16) + ' (仅计算标准位0x0001-0x0100)');
    }
    let sz = 0, p = fieldOff + 20; // 条件数据起始：字段数据固定20字节(position12+parent2+transformLevel4+flags2)
    try{
      // 移動付与 (0x0008): 付与親索引 + 移動付与率
      if(flags & 0x0008){ if(p+boneIndexSize+4>buffer.byteLength) return -1; sz+=boneIndexSize+4; p+=boneIndexSize+4; }
      // 回転付与 (0x0010): 移動付与已读付与親索引则共享，否则需读索引；回転付与率总是4字节
      if(flags & 0x0010){
        const needParent = !(flags & 0x0008);
        const s = (needParent ? boneIndexSize : 0) + 4;
        if(p+s>buffer.byteLength) return -1; sz+=s; p+=s;
      }
      // 固定軸 (0x0020): vec3 = 12字节
      if(flags & 0x0020){ if(p+12>buffer.byteLength) return -1; sz+=12; p+=12; }
      // ローカル付与 (0x0040): X軸vec3 + Z軸vec3 = 24字节
      if(flags & 0x0040){ if(p+24>buffer.byteLength) return -1; sz+=24; p+=24; }
      // 外部親 (0x0100): int32 = 4字节
      if(flags & 0x0100){ if(p+4>buffer.byteLength) return -1; sz+=4; p+=4; }
      // IK (0x0004): IKターゲット + ループ回数 + 制限角度 + IKリンク数 + IKリンクデータ
      if(flags & 0x0004){
        if(p+boneIndexSize+12>buffer.byteLength) return -1;
        sz+=boneIndexSize+12; // IK固定部分
        p+=boneIndexSize+12;
        if(precise){
          // 精确模式：读取IK链接数，计算完整链接数据大小
          const lcOff = p - 4; // IKリンク数在固定部分末尾（最后4字节）
          const lc = dv.getInt32(lcOff, true);
          // IK链接数合理性校验：通常<=20，>200视为读取错误
          if(lc < 0 || lc > 200) return -1;
          if(lc > 20) console.warn('[PMX-COND] IK链接数异常偏大: ' + lc + ' (通常<=20)');
          for(let li=0;li<lc;li++){
            if(p+boneIndexSize+1>buffer.byteLength) return -1;
            const hl=dv.getUint8(p+boneIndexSize); // リンクの制限フラグ
            const ls=boneIndexSize+1+(hl?24:0);     // 有制限则+24字节(min/max vec3)
            sz+=ls; p+=ls;
          }
        }
      }
      // 条件数据大小上限校验：单个骨骼通常不超过4KB
      if(sz > 4096) console.warn('[PMX-COND] 条件数据大小超过4KB: ' + sz + ' bytes (flags=0x' + flags.toString(16) + ')');
      return sz;
    }catch(e){ return -1; }
  }
  // 精确模式别名：读取IK链接数，计算完整条件数据大小（用于骨骼解析循环）
  function _calcCondSizeAt(fieldOff, flags){
    return _calcCondSize(fieldOff, flags, true);
  }
  // 验证指定偏移是否是一个有效的骨骼起始位置
  function _isValidBone(off){
    try{
      if(off + 8 > buffer.byteLength) return false;
      const nameLen = dv.getInt32(off, true);
      if(nameLen < 1 || nameLen > 200) return false;
      if(encoding === 0 && nameLen % 2 !== 0) return false;
      const neOff = off + 4 + nameLen;
      if(neOff + 4 > buffer.byteLength) return false;
      const nameEnLen = dv.getInt32(neOff, true);
      if(nameEnLen < 0 || nameEnLen > 200) return false;
      if(encoding === 0 && nameEnLen > 0 && nameEnLen % 2 !== 0) return false;
      const fOff = neOff + 4 + nameEnLen;
      if(fOff + 20 > buffer.byteLength) return false;
      // 验证position是合理的浮点数（PMX模型坐标通常在-50到50之间）
      const px = dv.getFloat32(fOff, true);
      const py = dv.getFloat32(fOff + 4, true);
      const pz = dv.getFloat32(fOff + 8, true);
      if(!isFinite(px) || !isFinite(py) || !isFinite(pz)) return false;
      if(Math.abs(px) > 100 || Math.abs(py) > 100 || Math.abs(pz) > 100) return false;
      // 验证parent是有效的骨骼索引（-1到boneCount之间）
      const parent = dv.getInt32(fOff + 12, true);
      if(parent < -1 || parent > boneCount) return false;
      // 验证transformLevel是合理的（0到1000之间）
      const tl = dv.getInt32(fOff + 12 + boneIndexSize, true);
      if(tl < 0 || tl > 1000) return false;
      // 验证flags高字节为0
      const _fl = dv.getUint16(fOff + 12 + boneIndexSize + 4, true);
      if((_fl & 0xFF00) !== 0) return false;
      return true;
    }catch(e){ return false; }
  }
  function _parseBoneAt(baseOff, order){
    try{
      if(baseOff+8>buffer.byteLength) return null;
      const nameLen=dv.getInt32(baseOff,true);
      if(nameLen<1||nameLen>200) return null;
      const neOff=baseOff+4+nameLen;
      if(neOff+4>buffer.byteLength) return null;
      const nameEnLen=dv.getInt32(neOff,true);
      if(nameEnLen<0||nameEnLen>200) return null;
      const fieldOff=neOff+4+nameEnLen;
      if(fieldOff+20>buffer.byteLength) return null;
      // 计算各字段偏移
      let flagsOff=0, parentOff=0, posOff=0, _po=0;
      for(const f of order){
        if(f==='flags') flagsOff=_po;
        else if(f==='parent') parentOff=_po;
        else if(f==='position') posOff=_po;
        if(f==='parent') _po+=boneIndexSize;
        else if(f==='transformLevel') _po+=4;
        else if(f==='flags') _po+=2;
        else if(f==='position') _po+=12;
      }
      const flags=dv.getUint16(fieldOff+flagsOff,true);
      // 不严格验证flags范围，因为非标准模型可能有大的flags值
      const parent=boneIndexSize===1?dv.getInt8(fieldOff+parentOff):dv.getInt16(fieldOff+parentOff,true);
      const px=dv.getFloat32(fieldOff+posOff,true);
      const py=dv.getFloat32(fieldOff+posOff+4,true);
      const pz=dv.getFloat32(fieldOff+posOff+8,true);
      const condSize=_calcCondSizeAt(fieldOff, flags);
      if(condSize<0) return null;
      const size=4+nameLen+4+nameEnLen+20+condSize; // PMX骨骼没有postPos字段
      return {nameLen, nameEnLen, fieldOff, flags, parent, pos:[px,py,pz], condSize, size};
    }catch(e){ return null; }
  }
  function _adaptiveDetectOrder(){
    try{
      const boneStart = _boneSectionStart;
      if(boneStart+8>buffer.byteLength) return null;
      let bestOrder=null, bestScore=-1, bestDetails='';
      const _results = [];
      for(const order of _boneFieldOrders){
        try{
          let curOff=boneStart, validCount=0, score=0;
          let parentValid=0, flagsValid=0, posValid=0, condValid=0;
          const bones=[];
          let _failReason = '';
          for(let bi=0;bi<8;bi++){ // 检测前8个骨骼
            const b=_parseBoneAt(curOff, order);
            if(!b){ _failReason = 'parseBoneAt returned null at bone#' + bi; break; }
            // parent验证：放宽条件，只要在合理范围内即可
            let _pValid = (b.parent >= -1 && b.parent < boneCount);
            // bone#0的parent可以是-1或任何小值
            if(bi === 0 && b.parent >= -1 && b.parent < 10) _pValid = true;
            if(_pValid) parentValid++;
            // flags验证：高字节应为0，且不应为0
            let _fValid = ((b.flags & 0xFF00) === 0) && (b.flags > 0) && (b.flags < 0x1000);
            if(_fValid) flagsValid++;
            // position验证：放宽范围
            let _posValid = isFinite(b.pos[0]) && isFinite(b.pos[1]) && isFinite(b.pos[2]) &&
                           Math.abs(b.pos[0]) < 500 && b.pos[1] > -50 && b.pos[1] < 200 && Math.abs(b.pos[2]) < 500;
            if(_posValid) posValid++;
            // condSize验证
            if(b.condSize >= 0 && b.condSize < 10000) condValid++;
            bones.push(b);
            validCount++;
            // 对标准顺序的前2个骨骼进行详细dump
            if(order.join('→') === 'position→parent→transformLevel→flags' && bi <= 1){
              const _dumpLen = Math.min(64, buffer.byteLength - curOff);
              const _dumpBytes = Array.from(new Uint8Array(buffer, curOff, _dumpLen)).map(x=>x.toString(16).padStart(2,'0')).join(' ');
              console.log('[PMX-AUTODETECT-DUMP] bone#' + bi + ' nameLen=' + b.nameLen + ' nameEnLen=' + b.nameEnLen + ' fieldOff=' + b.fieldOff + ' flags=0x' + b.flags.toString(16) + ' parent=' + b.parent + ' pos=(' + b.pos[0].toFixed(3) + ',' + b.pos[1].toFixed(3) + ',' + b.pos[2].toFixed(3) + ') condSize=' + b.condSize + ' size=' + b.size + ' nextOff=' + (curOff + b.size) + ' nextBytes(' + _dumpLen + '): ' + _dumpBytes);
            }
            curOff+=b.size;
          }
          if(validCount < 2){
            console.log('[PMX-AUTODETECT-DEBUG] order=' + order.join('→') + ' validCount=' + validCount + ' failReason=' + _failReason);
            continue;
          }
          // 综合评分
          score = parentValid * 50 + flagsValid * 30 + posValid * 20 + condValid * 10 + validCount * 5;
          // 非根骨骼parent不应为-1
          for(let bi=1;bi<bones.length;bi++){ if(bones[bi].parent === -1) score -= 3; }
          // 骨骼大小应相对稳定
          if(bones.length >= 3){
            const sizes = bones.map(b=>b.size);
            const avgSize = sizes.reduce((a,b)=>a+b,0) / sizes.length;
            const variance = sizes.reduce((sum,s)=>sum + Math.pow(s-avgSize,2), 0) / sizes.length;
            if(variance < 10000) score += 10; // 大小相对稳定加分
          }
          _results.push({order, score, validCount, parentValid, flagsValid, posValid, condValid});
          if(score > bestScore){
            bestScore = score;
            bestOrder = order;
            bestDetails = `valid=${validCount}/8 parent=${parentValid} flags=${flagsValid} pos=${posValid} cond=${condValid}`;
          }
        }catch(e){
          console.log('[PMX-AUTODETECT-DEBUG] order=' + order.join('→') + ' exception: ' + e.message);
          continue;
        }
      }
      // 输出所有候选顺序的得分，便于调试
      console.log('[PMX-AUTODETECT] 所有候选顺序得分:');
      _results.sort((a,b)=>b.score-a.score);
      for(const r of _results.slice(0, 5)){
        console.log(`  ${r.order.join('→')}: score=${r.score} valid=${r.validCount}/8 parent=${r.parentValid} flags=${r.flagsValid} pos=${r.posValid} cond=${r.condValid}`);
      }
      if(bestOrder && bestScore >= 100){ // 降低阈值
        console.log('[PMX] 自适应检测字段顺序成功: ' + bestOrder.join(' → ') + ' (' + bestDetails + ', score=' + bestScore + ')');
        return bestOrder;
      }
      console.log('[PMX] 自适应检测未找到高置信度顺序，最佳: ' + (bestOrder?bestOrder.join('→'):'none') + ' score=' + bestScore);
      return null;
    }catch(e){
      console.log('[PMX] 自适应检测异常: ' + e.message);
      return null;
    }
  }
  // 先尝试自适应检测骨骼字段顺序（MMD模型作者多数不遵守规范）
  const _detectedOrder = _adaptiveDetectOrder();
  if(_detectedOrder){
    _boneFieldOrder = _detectedOrder;
    console.log('[PMX] 自适应检测字段顺序成功: ' + _boneFieldOrder.join(' → '));
  } else {
    // 回退到标准字段顺序：position→parent→transformLevel→flags
    _boneFieldOrder = ['position','parent','transformLevel','flags'];
    console.log('[PMX] 自适应检测失败，使用标准字段顺序: position → parent → transformLevel → flags');
  }
  // ============================================================
  // 骨骼解析容错工具函数
  // ============================================================

  /**
   * 从指定位置扫描下一个有效的骨骼起始偏移量。
   * 验证逻辑：读取int32名称长度 -> 校验范围(1~200) -> 校验名称字节编码有效性
   *           -> 读取后续int32英名称长度 -> 校验范围(0~200) -> 校验英名称字节有效性
   * @param {number} startOff - 起始搜索偏移量
   * @param {number} maxScan  - 最大搜索字节数
   * @returns {number} 找到的骨骼起始偏移量，未找到返回 -1
   */
  function _scanNextBone(startOff, maxScan, minConsecutive){
    const _minConsec = minConsecutive || 1;
    for(let skip = 2; skip <= maxScan; skip += 2){
      const tryOff = startOff + skip;
      if(tryOff + 8 > buffer.byteLength) break;
      const nameLen = dv.getInt32(tryOff, true);
      if(nameLen < 1 || nameLen > 200) continue;
      if(tryOff + 4 + nameLen + 4 > buffer.byteLength) continue;
      // 校验名称字节编码有效性
      const nameBytes = new Uint8Array(buffer, tryOff + 4, nameLen);
      let nameValid = true;
      if(encoding === 0){
        if(nameLen % 2 !== 0){ nameValid = false; }
        else {
          for(let k = 0; k < nameLen; k += 2){
            const code = nameBytes[k] | (nameBytes[k+1] << 8);
            if(code === 0 || code > 0xFFFF){ nameValid = false; break; }
          }
        }
      }
      if(!nameValid) continue;
      // 校验英名称长度和字节有效性
      const nameEnLenOff = tryOff + 4 + nameLen;
      const nameEnLen = dv.getInt32(nameEnLenOff, true);
      if(nameEnLen < 0 || nameEnLen > 200) continue;
      if(nameEnLen > 0 && nameEnLenOff + 4 + nameEnLen <= buffer.byteLength){
        if(encoding === 0 && nameEnLen % 2 !== 0) continue;
        const nameEnBytes = new Uint8Array(buffer, nameEnLenOff + 4, nameEnLen);
        let nameEnValid = true;
        if(encoding === 0){
          for(let k = 0; k < nameEnLen; k += 2){
            const code = nameEnBytes[k] | (nameEnBytes[k+1] << 8);
            if(code === 0 || code > 0xFFFF){ nameEnValid = false; break; }
          }
        }
        if(!nameEnValid) continue;
      }
      // 完整字段验证：确保不是条件数据内部的假阳性（IK数据/付与数据中可能出现类似名称长度的值）
      // _isValidBone 会验证 position 范围、parent 索引范围、flags 值合理性
      if(typeof _isValidBone === 'function' && !_isValidBone(tryOff)) continue;
      // 连续验证：minConsecutive>1时，验证后续骨骼是否也连续有效（排除假阳性）
      if(_minConsec > 1){
        let _consecCount = 1, _curOff = tryOff, _consecOk = true;
        for(let _ci = 1; _ci < _minConsec; _ci++){
          if(_curOff + 8 > buffer.byteLength){ _consecOk = false; break; }
          const _nl = dv.getInt32(_curOff, true);
          if(_nl < 1 || _nl > 200){ _consecOk = false; break; }
          const _nelOff = _curOff + 4 + _nl;
          if(_nelOff + 4 > buffer.byteLength){ _consecOk = false; break; }
          const _nel = dv.getInt32(_nelOff, true);
          if(_nel < 0 || _nel > 200){ _consecOk = false; break; }
          const _fOff = _nelOff + 4 + _nel;
          if(_fOff + 20 > buffer.byteLength){ _consecOk = false; break; }
          const _fl = dv.getUint16(_fOff + 12 + boneIndexSize + 4, true);
          let _condSz = 0;
          if(_fl & 0x0008) _condSz += boneIndexSize + 4;
          if(_fl & 0x0010) _condSz += (_fl & 0x0008) ? 4 : (boneIndexSize + 4);
          if(_fl & 0x0020) _condSz += 12;
          if(_fl & 0x0040) _condSz += 24;
          if(_fl & 0x0100) _condSz += 4;
          if(_fl & 0x0004) _condSz += boneIndexSize + 12;
          const _nextOff = _fOff + 20 + Math.min(_condSz, 8192);
          if(_nextOff + 8 > buffer.byteLength){ _consecOk = false; break; }
          if(typeof _isValidBone === 'function' && !_isValidBone(_nextOff)){ _consecOk = false; break; }
          _curOff = _nextOff;
          _consecCount++;
        }
        if(!_consecOk || _consecCount < _minConsec) continue;
      }
      return tryOff; // 找到有效骨骼起始位置
    }
    return -1; // 未找到
  }

  /**
   * 创建占位骨骼对象。
   * 当某个骨骼解析失败时，用占位对象填充以保持骨骼索引连续性，
   * 避免顶点蒙皮索引越界。占位骨骼position为原点，parent=-1（无父骨骼）。
   * @param {number} idx - 骨骼索引（用于命名占位对象）
   * @returns {object} 占位骨骼对象
   */
  function _makePlaceholderBone(idx){
    return {
      name: '__placeholder_' + idx,
      nameEn: '',
      parent: -1,
      transformLevel: 0,
      flags: 0,
      position: [0, 0, 0],
      postPos: -1,
      inheritParent: -1,
      inheritRotationRatio: 0,
      inheritTranslationRatio: 0,
      fixedAxis: null,
      localInherit: null,
      ikData: null
    };
  }

  for(let i=0;i<boneCount;i++){
    // 优先使用独立预扫描的位置：不依赖前一个骨骼的条件数据大小推进，彻底避免连锁错位
    // 借鉴参考文件 _bonePositions 思路
    if(i < _bonePositions.length){
      off = _bonePositions[i];
    }
    // 入口验证：非首个骨骼且没有预扫描位置时，确认当前位置是有效骨骼起始。
    // 若前一个骨骼条件数据大小算错导致off错位，在此处尽早扫描恢复，
    // 而不是等到name读取抛出异常后再处理（减少连锁错误）。
    if(i >= _bonePositions.length && i > 0 && typeof _isValidBone === 'function' && !_isValidBone(off)){
      // 第一步：小范围扫描（4KB），快速恢复轻微错位
      let _rescueOff = _scanNextBone(off, 4096);
      if(_rescueOff > 0){
        console.warn('[PMX-RESCUE] bone#' + i + ' 入口位置无效(off=' + off + ')，扫描恢复到 ' + _rescueOff + ' (跳过' + (_rescueOff - off) + '字节)');
        off = _rescueOff;
      } else {
        // 第二步：从预扫描位置表找下一个有效骨骼位置（覆盖整个骨骼段）
        let _prescanOff = -1;
        for(const _bp of _allBonePositions){
          if(_bp.off > off && _bp.off - off < 2000000){
            _prescanOff = _bp.off;
            break;
          }
        }
        if(_prescanOff > 0){
          console.warn('[PMX-RESCUE] bone#' + i + ' 入口位置无效(off=' + off + ')，预扫描表恢复到 ' + _prescanOff + ' (跳过' + (_prescanOff - off) + '字节)');
          off = _prescanOff;
        } else {
          console.warn('[PMX-RESCUE] bone#' + i + ' 入口位置无效(off=' + off + ')，小范围扫描和预扫描表均未恢复，将由name读取容错处理');
        }
      }
    }
    const _boneStart = off;
    const _raw4 = off+4 <= buffer.byteLength ? '0x'+dv.getUint32(off,true).toString(16) : 'EOF';
    const _raw8 = off+8 <= buffer.byteLength ? Array.from(new Uint8Array(buffer,off,Math.min(16,buffer.byteLength-off))).map(b=>b.toString(16).padStart(2,'0')).join(' ') : 'EOF';
    const _raw48 = off+48 <= buffer.byteLength ? Array.from(new Uint8Array(buffer,off,48)).map(b=>b.toString(16).padStart(2,'0')).join(' ') : 'EOF';
    let name, nameEn;
    try{
      if(i < 10) console.log('[PMX] bone#' + i + ' pre-name off=' + off + ' raw4=' + _raw4 + ' raw48=' + _raw48);
      name=readText(1000);
      if(!name || name.length === 0){ throw new Error('bone name empty, len<=0 at off=' + (_boneStart)); }
    }catch(e){
      // name读取失败处理流程（4步降级，最后才跳出循环）：
      // 1. 调用_scanNextBone在当前骨骼附近重新同步（偏移量错位通常<200KB）
      // 2. 重新同步失败则扫描下一个骨骼位置，当前骨骼用_makePlaceholderBone填充
      // 3. 扫描不到下一个骨骼时检查是否已到达形态键段（骨骼段结束标志）
      // 4. 全部失败才break（最后手段，会导致后续骨骼缺失）
      // 关键原则：绝不能因单个骨骼name失败就丢弃所有剩余骨骼，
      //           否则顶点蒙皮索引大量越界，模型只剩上半身或渲染崩溃。
      const _prevInfo = i > 0
        ? ' prevBone=' + JSON.stringify(bones[i-1].name) + ' prevFlags=0x' + bones[i-1].flags.toString(16) + ' prevSize=' + (_boneStart - _prevBoneEnd)
        : '';
      console.warn('[PMX] 骨骼#' + i + ' name读取失败 boneStart=' + _boneStart + ' raw4=' + _raw4 + _prevInfo + ' err=' + e.message);

      // 步骤1：重新同步到当前骨骼正确起始位置
      // 先用连续验证(minConsecutive=2)排除假阳性，找不到则降级到单个验证(minConsecutive=1)
      let _resyncOff = _scanNextBone(_boneStart, 2000000, 2);
      if(_resyncOff < 0){
        _resyncOff = _scanNextBone(_boneStart, 2000000, 1); // 降级：单个验证
        if(_resyncOff >= 0) console.log('[PMX-RESYNC] bone#' + i + ' 连续验证未找到，降级为单个验证: off=' + _resyncOff);
      }
      if(_resyncOff >= 0){
        console.log('[PMX-RESYNC] bone#' + i + ' name重同步: 原off=' + _boneStart + ' -> 新off=' + _resyncOff + ' (跳过' + (_resyncOff - _boneStart) + '字节)');
        off = _resyncOff;
        name = readText(1000);
      } else {
        // 步骤2：扫描下一个骨骼位置，当前骨骼用占位对象填充
        // 使用连续验证(minConsecutive=2)排除假阳性，找不到则降级到单个验证
        let _nextOff = _scanNextBone(_boneStart + 2, 2000000, 2);
        if(_nextOff < 0){
          _nextOff = _scanNextBone(_boneStart + 2, 2000000, 1); // 降级：单个验证
          if(_nextOff >= 0) console.log('[PMX] bone#' + i + ' 步骤2连续验证未找到，降级为单个验证: off=' + _nextOff);
        }
        if(_nextOff >= 0){
          console.warn('[PMX] 骨骼#' + i + ' 无法解析，创建占位骨骼，从下一个位置继续: ' + _nextOff + ' (scan=' + (_nextOff - _boneStart) + ')');
          bones.push(_makePlaceholderBone(i));
          off = _nextOff;
          name = bones[bones.length - 1].name;
          nameEn = '';
          _prevBoneEnd = off;
          continue; // 跳过当前骨骼后续字段解析，直接进入下一个骨骼
        }
        // 步骤3：检查是否已到达形态键段（骨骼段结束标志）
        // 关键：必须连续验证至少2个形态键结构，否则条件数据内部的IK数据/浮点数
        // 很容易出现"形态键数合理+名称长度合理+面板值0-8"的假阳性，
        // 导致误判骨骼段结束，后续骨骼被填充为占位骨骼，模型部分肢体变形。
        // 增强：形态键数异常（过大）时也向前扫描，因为off可能越过了真正的形态键段位置
        let _morphFound = false;
        for(let _scan = -20000; _scan < 500000; _scan += 2){
          const _tryOff = _boneStart + _scan;
          if(_tryOff < 0 || _tryOff + 8 > buffer.byteLength) continue;
          const _tryCount = dv.getInt32(_tryOff, true);
          // 放宽范围：1-5000，同时允许异常大的值（可能是越过了真正位置，需要验证后续结构）
          if(_tryCount < 1 || (_tryCount > 5000 && _tryCount < 100000)) continue;
          // 连续验证前2个形态键结构（名称→英名称→面板→类型→元素数）
          let _moff = _tryOff + 4;
          let _morphValid = 0;
          for(let _mi = 0; _mi < Math.min(2, _tryCount); _mi++){
            if(_moff + 8 > buffer.byteLength) break;
            const _nl = dv.getInt32(_moff, true);
            if(_nl < 0 || _nl > 300) break;
            if(encoding === 0 && _nl > 0 && _nl % 2 !== 0) break;
            if(_moff + 4 + _nl + 4 > buffer.byteLength) break;
            const _nel = dv.getInt32(_moff + 4 + _nl, true);
            if(_nel < 0 || _nel > 300) break;
            if(encoding === 0 && _nel > 0 && _nel % 2 !== 0) break;
            const _metaOff = _moff + 4 + _nl + 4 + _nel;
            if(_metaOff + 6 > buffer.byteLength) break;
            const _panel = dv.getUint8(_metaOff);
            const _type = dv.getUint8(_metaOff + 1);
            if(_panel > 4 || _type > 8) break; // 面板0-4，类型0-8
            const _elemCount = dv.getInt32(_metaOff + 2, true);
            if(_elemCount < 0 || _elemCount > 200000) break;
            // 估算元素大小，验证结束位置不越界
            let _elemSize = 0;
            if(_type === 1) _elemSize = vertexIndexSize + 12;      // vertex
            else if(_type === 2) _elemSize = boneIndexSize + 16;   // bone
            else if(_type === 3) _elemSize = 16;                     // uv
            else if(_type >= 4 && _type <= 7) _elemSize = vertexIndexSize * 4 + 16; // additional uv
            else if(_type === 8) _elemSize = vertexIndexSize * 2 + 16; // material
            const _endOff = _metaOff + 6 + _elemCount * _elemSize;
            if(_endOff > buffer.byteLength) break;
            _moff = _endOff;
            _morphValid++;
          }
          if(_morphValid >= 2){ // 至少连续2个形态键有效才确认
            console.log('[PMX-AUTOSCAN] 检测到形态键段开始: off=' + _tryOff + ' count=' + _tryCount + ' 连续验证=' + _morphValid + '个形态键');
            off = _tryOff;
            _morphFound = true;
            break;
          }
        }
        if(_morphFound){
          // 步骤3a：到达形态键段，骨骼实际已全部解析完，填充剩余占位骨骼保持索引连续
          const _remaining = boneCount - bones.length;
          console.warn('[PMX] 骨骼#' + i + ' 检测到形态键段，填充剩余' + _remaining + '个占位骨骼（骨骼段实际已结束）');
          for(let _pi = bones.length; _pi < boneCount; _pi++){
            bones.push(_makePlaceholderBone(_pi));
          }
          break;
        }
        // 步骤3.5：正向扫描均失败时，从buffer末尾反向扫描形态键段
        // 正向扫描可能因偏移量错位过大而错过形态键段，反向扫描从已知的文件末尾出发更可靠
        // 找到形态键段后直接确认骨骼段结束，填充剩余占位骨骼，设置off为形态键段位置
        let _morphStartOff = -1;
        for(let _rscan = buffer.byteLength - 4; _rscan > _boneStart + 1000; _rscan -= 4){
          if(_rscan + 8 > buffer.byteLength) continue;
          const _rmc = dv.getInt32(_rscan, true);
          if(_rmc < 1 || _rmc > 500) continue;
          // 连续验证前2个形态键结构
          let _rmoff = _rscan + 4, _rmvalid = 0;
          for(let _rmi = 0; _rmi < Math.min(2, _rmc); _rmi++){
            if(_rmoff + 8 > buffer.byteLength) break;
            const _rnl = dv.getInt32(_rmoff, true);
            if(_rnl < 0 || _rnl > 300) break;
            if(encoding === 0 && _rnl > 0 && _rnl % 2 !== 0) break;
            if(_rmoff + 4 + _rnl + 4 > buffer.byteLength) break;
            const _rnel = dv.getInt32(_rmoff + 4 + _rnl, true);
            if(_rnel < 0 || _rnel > 300) break;
            if(encoding === 0 && _rnel > 0 && _rnel % 2 !== 0) break;
            const _rmetaOff = _rmoff + 4 + _rnl + 4 + _rnel;
            if(_rmetaOff + 6 > buffer.byteLength) break;
            const _rpanel = dv.getUint8(_rmetaOff);
            const _rtype = dv.getUint8(_rmetaOff + 1);
            if(_rpanel > 4 || _rtype > 8) break;
            const _relemCount = dv.getInt32(_rmetaOff + 2, true);
            if(_relemCount < 0 || _relemCount > 200000) break;
            let _relemSize = 0;
            if(_rtype === 1) _relemSize = vertexIndexSize + 12;
            else if(_rtype === 2) _relemSize = boneIndexSize + 16;
            else if(_rtype === 3) _relemSize = 16;
            else if(_rtype >= 4 && _rtype <= 7) _relemSize = vertexIndexSize * 4 + 16;
            else if(_rtype === 8) _relemSize = vertexIndexSize * 2 + 16;
            const _rendOff = _rmetaOff + 6 + _relemCount * _relemSize;
            if(_rendOff > buffer.byteLength) break;
            _rmoff = _rendOff;
            _rmvalid++;
          }
          if(_rmvalid >= 2){
            _morphStartOff = _rscan;
            console.log('[PMX-REVERSE] 反向扫描找到形态键段: off=' + _rscan + ' count=' + _rmc);
            break;
          }
        }
        // 找到形态键段：确认骨骼段已结束，填充剩余占位骨骼，设置off为形态键段位置
        if(_morphStartOff > 0){
          const _remainingRev = boneCount - bones.length;
          if(_remainingRev > 0){
            console.warn('[PMX-REVERSE] 骨骼段实际已结束，填充剩余' + _remainingRev + '个占位骨骼，off跳到形态键段: ' + _morphStartOff);
            for(let _rpi = bones.length; _rpi < boneCount; _rpi++){
              bones.push(_makePlaceholderBone(_rpi));
            }
          } else {
            console.warn('[PMX-REVERSE] 骨骼段已结束(已解析' + bones.length + '/' + boneCount + ')，off跳到形态键段: ' + _morphStartOff);
          }
          off = _morphStartOff;
          break; // 跳出骨骼循环，继续解析形态键
        }

        // 步骤4：全部失败（包括反向扫描），填充剩余占位骨骼后跳出循环（最后手段）
        // 关键：必须填充剩余占位骨骼，保持bones.length === boneCount，
        // 否则后续顶点蒙皮按boneCount访问骨骼时会越界读到undefined，
        // 导致骨骼矩阵全0/NaN，模型对应肢体严重扭曲或消失。
        const _remaining4 = Math.max(0, boneCount - bones.length);
        console.error('[PMX] 骨骼#' + i + ' 重新同步和扫描均失败(含反向扫描)，填充剩余' + _remaining4 + '个占位骨骼（偏移量严重错位，对应肢体可能变形）');
        for(let _pi4 = bones.length; _pi4 < boneCount; _pi4++){
          bones.push(_makePlaceholderBone(_pi4));
        }
        off = _boneStart;
        break;
      }
    }
    try{
      nameEn=readText(1000);
    }catch(e){
      // nameEn读取失败处理：
      // nameEn只是英文名称，不影响骨骼结构和蒙皮。失败时用空字符串兜底即可。
      // 注意：此时off可能已因nameEn长度字段异常而错位，后续position/parent/flags
      // 可能从错误位置读取。若后续字段也连续失败，外层字段解析的容错会接管。
      // 绝不能在此处break，否则会丢弃所有剩余骨骼（导致模型只有上半身）。
      console.warn('[PMX] 骨骼#' + i + ' nameEn读取失败(使用空名称继续) name=' + JSON.stringify(name) + ' offAfterName=' + off + ' err=' + e.message);
      nameEn = '';
    }
    _prevBoneEnd = off;
    // ===== 名称清洗：去除控制字符、截断异常长名称、空名称兜底 =====
    name = cleanBoneName(name, i);
    nameEn = cleanBoneName(nameEn, i);
    if(_boneFieldOrder === null){
      for(const order of _boneFieldOrders){
        const r = _tryBoneOrder(off, order);
        if(_validateBoneFields(r)){
          _boneFieldOrder = order;
          console.log('[PMX] 自动检测骨骼字段顺序: ' + order.join(' → ') + ' (bone#0验证通过)');
          break;
        }
      }
      if(_boneFieldOrder === null){
        _boneFieldOrder = _boneFieldOrders[0];
        console.log('[PMX] 骨骼字段顺序检测失败，回退标准格式');
      }
    }
    // bone#0完整原始字节dump，用于分析字段布局
    if(i === 0){
      const _rawLen = Math.min(160, buffer.byteLength - _boneStart);
      const _rawBytes = Array.from(new Uint8Array(buffer, _boneStart, _rawLen)).map(b=>b.toString(16).padStart(2,'0')).join(' ');
      console.log('[PMX-RAW] bone#0 raw(' + _rawLen + ') at ' + _boneStart + ': ' + _rawBytes);
      console.log('[PMX-RAW] boneIndexSize=' + boneIndexSize + ' encoding=' + encoding);
    }
    if(i <= 2 || i === 82 || (i >= 630 && i <= 645) || (i >= 55 && i <= 70)){
      const _dumpNameLen = dv.getInt32(_boneStart, true);
      const _dumpNameEnLenOff = _boneStart + 4 + _dumpNameLen;
      const _dumpNameEnLen = _dumpNameEnLenOff + 4 <= buffer.byteLength ? dv.getInt32(_dumpNameEnLenOff, true) : -1;
      const _fullLen = Math.min(250, buffer.byteLength - _boneStart);
      const _fullBytes = Array.from(new Uint8Array(buffer, _boneStart, _fullLen)).map(b=>b.toString(16).padStart(2,'0')).join(' ');
      console.log('[PMX-FULL] bone#' + i + ' start=' + _boneStart + ' nameLen=' + _dumpNameLen + ' nameEnLenOff=' + _dumpNameEnLenOff + ' nameEnLen=' + _dumpNameEnLen + ' fieldStart=' + off + ' dump(' + _fullLen + '): ' + _fullBytes);
    }
    const _bf = _tryBoneOrder(off, _boneFieldOrder);
    if(i <= 2 || i === 82 || (i >= 630 && i <= 645) || (i >= 55 && i <= 70)){
      const _fieldBytes = Array.from(new Uint8Array(buffer, off, 20)).map(b=>b.toString(16).padStart(2,'0')).join(' ');
      console.log('[PMX-FIELD2] bone#' + i + ' fieldOff=' + off + ' boneIdxSize=' + boneIndexSize + ' fieldBytes=' + _fieldBytes + ' parent=' + _bf.parent + ' transform=' + _bf.transformLevel + ' flags=0x' + _bf.flags.toString(16) + ' pos=(' + _bf.position[0].toFixed(3) + ',' + _bf.position[1].toFixed(3) + ',' + _bf.position[2].toFixed(3) + ')');
    }
    off = _bf.endOff;
    const position = _bf.position;
    const parent = _bf.parent;
    const transformLevel = _bf.transformLevel;
    const flags = _bf.flags;
    _boneFlagHist[flags] = (_boneFlagHist[flags]||0)+1;
    if(i < 5 || (i >= 630 && i <= 645) || (i >= 55 && i <= 70)) console.log('[PMX-DIAG] bone#' + i + ' flags=0x' + flags.toString(16) + ' boneStart=' + _boneStart + ' curOff=' + off + ' prevNameEnd=' + _prevBoneEnd + ' parent=' + parent + ' transform=' + transformLevel + ' pos=(' + position[0].toFixed(3) + ',' + position[1].toFixed(3) + ',' + position[2].toFixed(3) + ')');
    if(i < 3 || (i >= 630 && i <= 645) || (i >= 55 && i <= 70)){
      const _dumpLen = Math.min(80, buffer.byteLength - off);
      const _dumpBytes = Array.from(new Uint8Array(buffer, off, _dumpLen)).map(b=>b.toString(16).padStart(2,'0')).join(' ');
      console.log('[PMX-COND] bone#' + i + ' condStart=' + off + ' dump(' + _dumpLen + '): ' + _dumpBytes);
    }
    let inheritParent=-1, inheritRotationRatio=0, inheritTranslationRatio=0, fixedAxis=null, localInherit=null, ikData=null, postPos=-1;
    const _condStart = off;
    let _calcCond = _calcCondSizeAt(_bf.fieldOff, flags);
    // 先扫描下一个骨骼的起始位置，用于条件数据解析失败时的回退
    // flags含高位(0x0200以上)时，标准位计算的_calcCond不可靠（可能为0但实际有数据），
    // 此时用较大的固定扫描范围(8192字节)，避免因_calcCond=0导致只扫256字节而错过下一个骨骼
    let _nextBoneOff = -1;
    if(i < boneCount - 1){
      const _flagsHigh = (flags & 0xFE00) !== 0;
      // 最小扫描范围4096字节（参考文件的经验值），flags含高位时8192字节
      // 避免因_calcCond=0导致只扫256字节而错过下一个骨骼
      const _maxScanRange = _flagsHigh ? 8192 : Math.max(4096, _calcCond + 512);
      for(let _scan = 0; _scan <= _maxScanRange; _scan += 2){
        const _tryOff = _condStart + _scan;
        if(_tryOff === off) continue;
        if(_isValidBone(_tryOff)){
          _nextBoneOff = _tryOff;
          break;
        }
      }
    }
    // ===== 骨骼表修复：如果当前骨骼在修复列表中，条件数据实际为0，直接读postPos =====
    const _repairInfo = _repairedBoneSet[i];
    if(_repairInfo){
      if(i < 100 || i >= boneCount - 5){
        console.log('[PMX-REPAIR] bone#' + i + ' 应用修复: name=' + JSON.stringify(name) + ' origFlags=0x' + flags.toString(16) + ' newFlags=0x' + _repairInfo.newFlags.toString(16) + ' origCond=' + _calcCond + ' actualCond=0 postPosOff=' + _condStart);
      }
      // PMX骨骼没有postPos字段，条件数据之后直接是下一个骨骼
      off = _condStart;
      // 用修复后的flags覆盖（只保留物理后0x0010）
      // 注意：不修改原始flags变量，因为后续日志可能需要原值；但条件数据已经按0处理
    } else {
    try{
      // PMX 2.0 标准条件数据解析顺序：
      // 1. 移動付与(0x0008): 付与親索引 + 移動付与率
      // 2. 回転付与(0x0010): 若未设移動付与则读付与親索引(共享) + 回転付与率
      // 3. 固定軸(0x0020): 固定軸方向vec3
      // 4. ローカル付与(0x0040): X軸vec3 + Z軸vec3
      // 5. 外部親(0x0100): 外部親ボーン索引int32
      // 6. IK(0x0004): IKターゲット + ループ回数 + 制限角度 + IKリンク数 + IKリンクデータ
      if(flags & 0x0008){ inheritParent=readI(boneIndexSize); inheritTranslationRatio=dv.getFloat32(off,true); off+=4; }
      if(flags & 0x0010){ if(!(flags & 0x0008)) inheritParent=readI(boneIndexSize); inheritRotationRatio=dv.getFloat32(off,true); off+=4; }
      if(flags & 0x0020){ fixedAxis=readVec3(); }
      if(flags & 0x0040){ const _localX=readVec3(); const _localZ=readVec3(); localInherit={x:_localX,z:_localZ}; }
      if(flags & 0x0100){ /* 外部親索引: 读取但暂不影响运行时 */ const _extParent=dv.getInt32(off,true); off+=4; }
      if(flags & 0x0004){
        // IK: IKターゲット + ループ回数 + 制限角度 + IKリンク数 + IKリンクデータ
        const ikTarget=readI(boneIndexSize);
        const loop=dv.getInt32(off,true); off+=4;
        const rotationLimit=dv.getFloat32(off,true); off+=4;
        const linkCount=dv.getInt32(off,true); off+=4;
        if(linkCount < 0 || linkCount > 200){
          throw new Error('IK linkCount invalid: ' + linkCount);
        }
        const links=[];
        let _ikParseOk = true;
        for(let j=0;j<linkCount;j++){
          if(off + boneIndexSize + 1 > buffer.byteLength){ _ikParseOk = false; break; }
          const linkBone=readI(boneIndexSize);
          const hasLimit=dv.getUint8(off); off+=1;
          let minLimit=null,maxLimit=null;
          if(hasLimit){
            if(off + 24 > buffer.byteLength){ _ikParseOk = false; break; }
            minLimit=readVec3(); maxLimit=readVec3();
          }
          links.push({bone:linkBone,hasLimit,minLimit,maxLimit});
        }
        if(_ikParseOk){
          ikData={ikTarget,loop,rotationLimit,links};
        }
      }
      // PMX骨骼没有postPos字段，条件数据之后直接是下一个骨骼

      // 条件数据大小一致性校验：对比实际读取字节数与_calcCond计算值
      // 差异过大说明flags位判断或IK链接数读取有误，可能导致下一个骨骼起始错位
      const _actualCond = off - _condStart;
      // flags含高位(0x0200以上)时，标准位计算的条件数据大小不可靠，强制扫描验证
      const _flagsHasHighBits = (flags & 0xFE00) !== 0;
      const _sizeMismatch = _calcCond > 0 && Math.abs(_actualCond - _calcCond) > 32;
      if(_flagsHasHighBits || _sizeMismatch){
        if(i < 20 || (i >= 55 && i <= 70) || _flagsHasHighBits){
          console.warn('[PMX-COND-CHECK] bone#' + i + ' 条件数据校验: name=' + JSON.stringify(name) + ' flags=0x' + flags.toString(16) + ' calc=' + _calcCond + ' actual=' + _actualCond + ' highBits=' + _flagsHasHighBits);
        }
        // 优先用扫描到的下一个骨骼位置修正（已通过_isValidBone完整验证）
        if(_nextBoneOff > 0 && _isValidBone(_nextBoneOff)){
          if(off !== _nextBoneOff){
            if(i < 20 || (i >= 55 && i <= 70) || _flagsHasHighBits){
              console.warn('[PMX-COND-CHECK] bone#' + i + ' 用扫描位置修正: oldOff=' + off + ' newOff=' + _nextBoneOff);
            }
            off = _nextBoneOff;
          }
        } else if(!_isValidBone(off)){
          // 扫描位置不可用且当前位置无效，从condStart小范围扫描恢复
          const _fallback = _scanNextBone(_condStart, 8192);
          if(_fallback > 0){
            console.warn('[PMX-COND-CHECK] bone#' + i + ' 回退扫描恢复: ' + _fallback);
            off = _fallback;
          }
        }
      }
    }catch(e){
      if(i < 10 || (i >= 630 && i <= 645) || (i >= 55 && i <= 70)) console.log('[PMX] bone#' + i + ' 条件数据解析失败 name=' + JSON.stringify(name) + ' flags=0x' + flags.toString(16) + ' calcCond=' + _calcCond + ' nextBoneOff=' + _nextBoneOff + ' err=' + e.message);
      // 回退策略（按可靠性排序）：
      // 1. _nextBoneOff：扫描到的下一个骨骼起始位置（已通过_isValidBone完整验证）
      // 2. _calcCond：按flags计算的条件数据大小（仅在合理范围内使用）
      // 3. 都不可靠时从_condStart小范围扫描恢复
      if(_nextBoneOff > 0 && typeof _isValidBone === 'function' && _isValidBone(_nextBoneOff)){
        off = _nextBoneOff;
      } else if(_calcCond > 0 && _calcCond < 8192){
        // 条件数据大小合理性上限：单个骨骼条件数据通常不超过8KB
        off = _condStart + _calcCond;
      } else {
        const _fallbackOff = _scanNextBone(_condStart, 4096);
        if(_fallbackOff > 0){
          console.warn('[PMX-FALLBACK] bone#' + i + ' 回退扫描恢复到 ' + _fallbackOff);
          off = _fallbackOff;
        } else {
          // 最后手段：按_calcCond跳转（即使不合理），避免off停留在条件数据中间
          off = _condStart + Math.max(0, Math.min(_calcCond, 4096));
        }
      }
    }
    } // end of else (非修复骨骼)
    // 条件数据解析后验证：强制确认off位置是有效的下一个骨骼起始
    // 不依赖_nextBoneOff是否找到，直接验证；无效则用扫描位置或重新扫描
    if(i < boneCount - 1){
      if(!_isValidBone(off)){
        // 当前位置无效，优先用已扫描到的_nextBoneOff
        if(_nextBoneOff > 0 && _isValidBone(_nextBoneOff)){
          if(i < 10 || (i >= 55 && i <= 70) || (flags & 0xFE00)){
            console.log('[PMX-SCANFIX] bone#' + i + ' 条件数据大小修正(扫描位置): name=' + JSON.stringify(name) + ' flags=0x' + flags.toString(16) + ' oldOff=' + off + ' newOff=' + _nextBoneOff + ' oldCond=' + (off - _condStart) + ' newCond=' + (_nextBoneOff - _condStart));
          }
          off = _nextBoneOff;
        } else {
          // _nextBoneOff不可用，从_condStart重新扫描更大范围
          const _rescan = _scanNextBone(_condStart, 16384);
          if(_rescan > 0){
            if(i < 10 || (i >= 55 && i <= 70) || (flags & 0xFE00)){
              console.log('[PMX-SCANFIX] bone#' + i + ' 条件数据大小修正(重新扫描): name=' + JSON.stringify(name) + ' flags=0x' + flags.toString(16) + ' oldOff=' + off + ' newOff=' + _rescan + ' oldCond=' + (off - _condStart) + ' newCond=' + (_rescan - _condStart));
            }
            off = _rescan;
          }
          // 重新扫描也失败，保持off不变（后续入口验证会处理）
        }
      }
    }
    // 自动检测：如果下一个骨骼无效，从condStart开始扫描找到正确的位置
    if(i < boneCount - 1){
      // 严格版骨骼起始验证：在外部_isValidBone基础上增加flags高字节应为0的校验
      // 注意：函数名必须与外部_isValidBone区分，否则会覆盖外部函数导致后续验证逻辑混乱
      const _isValidBoneStrict = function(candOff){
        if(candOff + 8 > buffer.byteLength) return false;
        const nl = dv.getInt32(candOff, true);
        if(nl < 1 || nl > 200) return false;
        if(encoding === 0 && nl % 2 !== 0) return false; // UTF-16LE必须偶数
        if(candOff + 4 + nl + 4 > buffer.byteLength) return false;
        // 验证name字节是否为有效UTF-16LE
        if(encoding === 0){
          for(let _k = 0; _k < nl; _k += 2){
            const _code = dv.getUint8(candOff + 4 + _k) | (dv.getUint8(candOff + 4 + _k + 1) << 8);
            if(_code === 0 || _code > 0xFFFF) return false;
          }
        }
        const nel = dv.getInt32(candOff + 4 + nl, true);
        if(nel < 0 || nel > 200) return false;
        if(encoding === 0 && nel > 0 && nel % 2 !== 0) return false;
        // 字段数据验证
        const fOff = candOff + 4 + nl + 4 + nel;
        if(fOff + 20 > buffer.byteLength) return false;
        for(let _pi = 0; _pi < 3; _pi++){
          const _pv = dv.getFloat32(fOff + _pi*4, true);
          if(!isFinite(_pv) || Math.abs(_pv) > 1000) return false;
        }
        const _par = boneIndexSize === 1 ? dv.getInt8(fOff + 12) : dv.getInt16(fOff + 12, true);
        if(_par < -1 || _par >= boneCount) return false;
        const _tl = dv.getInt32(fOff + 12 + boneIndexSize, true);
        if(_tl < -10000 || _tl > 100000) return false;
        const _fl = dv.getUint16(fOff + 12 + boneIndexSize + 4, true);
        if((_fl & 0xFF00) !== 0) return false; // flags高字节应为0（严格校验）
        // flags可以为0（某些骨骼没有特殊属性）
        return true;
      };

      if(!_isValidBoneStrict(off)){
        // 从condStart开始扫描，尝试不同的条件数据大小（PMX骨骼没有postPos字段）
        let _found = false;
        const _maxScan = Math.max(128, _calcCond + 32);
        // 第一轮：严格验证
        for(let _scan = 0; _scan <= _maxScan; _scan += 2){
          const _tryOff = _condStart + _scan;
          if(_tryOff === off) continue;
          if(_isValidBone(_tryOff)){
            if(i < 100 || (i >= 78 && i <= 90) || i >= 1280 || (i >= 630 && i <= 645) || (i >= 55 && i <= 70)){
              console.debug('[PMX-AUTOFIX] bone#' + i + ' 条件数据自动修正(严格) name=' + JSON.stringify(name) + ' flags=0x' + flags.toString(16) + ' calcCond=' + _calcCond + ' actualCond=' + _scan + ' oldOff=' + off + ' newOff=' + _tryOff);
            }
            off = _tryOff;
            _found = true;
            break;
          }
        }
        // 第二轮：宽松验证（只检查nameLen和nameEnLen范围）
        if(!_found){
          for(let _scan = 0; _scan <= _maxScan; _scan += 2){
            const _tryOff = _condStart + _scan;
            if(_tryOff === off) continue;
            if(_tryOff + 8 > buffer.byteLength) continue;
            const _nl = dv.getInt32(_tryOff, true);
            if(_nl < 2 || _nl > 100) continue;
            if(encoding === 0 && _nl % 2 !== 0) continue;
            if(_tryOff + 4 + _nl + 4 > buffer.byteLength) continue;
            const _nel = dv.getInt32(_tryOff + 4 + _nl, true);
            if(_nel < 0 || _nel > 100) continue;
            if(encoding === 0 && _nel > 0 && _nel % 2 !== 0) continue;
            if(i < 100 || i >= 1280 || (i >= 630 && i <= 645) || (i >= 55 && i <= 70)){
              console.debug('[PMX-AUTOFIX] bone#' + i + ' 条件数据自动修正(宽松) name=' + JSON.stringify(name) + ' flags=0x' + flags.toString(16) + ' calcCond=' + _calcCond + ' actualCond=' + _scan + ' oldOff=' + off + ' newOff=' + _tryOff + ' nextNameLen=' + _nl);
            }
            off = _tryOff;
            _found = true;
            break;
          }
        }
        if(!_found && (i < 10 || (i >= 630 && i <= 645) || (i >= 55 && i <= 70))){
          console.log('[PMX-AUTOFIX] bone#' + i + ' 自动修正失败 name=' + JSON.stringify(name) + ' flags=0x' + flags.toString(16) + ' calcCond=' + _calcCond + ' off=' + off + ' condStart=' + _condStart);
        }
      }
    }
    const _actualCond = off - _condStart;
    bones.push({name,nameEn,parent,transformLevel,flags,position:position||[0,0,0],postPos,inheritParent,inheritRotationRatio,inheritTranslationRatio,fixedAxis,localInherit,ikData,_startOff:_boneStart,_endOff:off});
    if(i < 5 || (i >= 78 && i <= 88) || i % 200 === 0 || i === boneCount-1){
      console.log('[PMX] bone#' + i + ' name=' + JSON.stringify(name) + ' parent=' + parent + ' pos=[' + position[0].toFixed(2) + ',' + position[1].toFixed(2) + ',' + position[2].toFixed(2) + '] flags=0x' + flags.toString(16) + ' condCalc=' + _calcCond + ' condActual=' + _actualCond + ' ik=' + (!!ikData) + (ikData?' links='+ikData.links.length:'') + ' off=' + _boneStart + '->' + off + ' size=' + (off-_boneStart));
    }
  }
  console.log('[PMX] 骨骼解析完成 off=' + off + ' boneCount=' + boneCount + ' flagHist=' + JSON.stringify(_boneFlagHist));

  // 形态键 (morphs) - 只解析顶点形态键用于眨眼
  let morphCount = dv.getInt32(off,true);
  if(morphCount < 2 || morphCount > 100000){
    // 通用形态键位置检测：连续验证多个形态键结构，不依赖特定morphCount值
    let _found = false;
    let _bestScore = -1, _bestMc = 0, _bestOff = 0;
    // 验证单个形态键结构是否合理，返回结束偏移或-1
    function _validateMorph(moff){
      if(moff + 8 > buffer.byteLength) return -1;
      const nl = dv.getInt32(moff, true);
      if(nl < 0 || nl > 300) return -1;
      if(encoding === 0 && nl > 0 && nl % 2 !== 0) return -1;
      if(moff + 4 + nl + 4 > buffer.byteLength) return -1;
      const nel = dv.getInt32(moff + 4 + nl, true);
      if(nel < 0 || nel > 300) return -1;
      if(encoding === 0 && nel > 0 && nel % 2 !== 0) return -1;
      const panelOff = moff + 4 + nl + 4 + nel;
      if(panelOff + 6 > buffer.byteLength) return -1;
      const panel = dv.getUint8(panelOff);
      const type = dv.getUint8(panelOff + 1);
      if(panel > 4 || type > 8) return -1;
      const elemCount = dv.getInt32(panelOff + 2, true);
      if(elemCount < 0 || elemCount > 200000) return -1;
      // 估算形态键元素大小，验证结束位置合理
      let elemSize = 0;
      if(type === 0) elemSize = 0; // group
      else if(type === 1) elemSize = (vertexIndexSize + 12); // vertex
      else if(type === 2) elemSize = (boneIndexSize + 16); // bone
      else if(type === 3) elemSize = 16; // uv
      else if(type >= 4 && type <= 7) elemSize = (vertexIndexSize * 4 + 16); // additional uv
      else if(type === 8) elemSize = (vertexIndexSize * 2 + 16); // material
      const endOff = panelOff + 6 + elemCount * elemSize;
      if(endOff > buffer.byteLength) return -1;
      return endOff;
    }
    // 增大扫描范围：向前5000字节，向后200000字节（参考文件经验值）
    // 骨骼段结束后off可能越过形态键段真正起始位置数千字节，必须向前扫足够远
    for(let _scan = -20000; _scan < 200000; _scan += 1){
      const _so = off + _scan;
      if(_so < 0 || _so + 4 > buffer.byteLength) continue;
      const _mc = dv.getInt32(_so, true);
      if(_mc < 1 || _mc > 5000) continue; // 放宽到5000
      // 连续验证前3个形态键
      let _moff = _so + 4;
      let _validCount = 0;
      for(let _mi = 0; _mi < Math.min(3, _mc); _mi++){
        const _end = _validateMorph(_moff);
        if(_end < 0) break;
        _moff = _end;
        _validCount++;
      }
      if(_validCount < 1) continue; // 降低到至少1个形态键合理
      // 评分：连续验证通过的形态键数量 + morphCount合理范围 + 扫描距离惩罚
      let _score = _validCount * 50;
      if(_mc >= 5 && _mc <= 500) _score += 10;
      if(_mc >= 10 && _mc <= 200) _score += 5;
      _score += Math.max(0, 20 - Math.abs(_scan) / 100); // 距离越近得分越高
      if(_score > _bestScore){
        _bestScore = _score;
        _bestMc = _mc;
        _bestOff = _so;
      }
      if(_validCount >= 1 && _score >= 50){
        morphCount = _mc;
        off = _so + 4;
        console.log('[PMX-MORPH-RESYNC] 形态键位置重同步: 原off=' + (off-4-_scan) + ' 跳过' + _scan + '字节 -> 新off=' + _so + ' morphCount=' + _mc + ' 连续验证=' + _validCount + '个形态键');
        _found = true;
        break;
      }
    }
    if(!_found && _bestScore > 0){
      morphCount = _bestMc;
      off = _bestOff + 4;
      console.log('[PMX-MORPH-RESYNC] 形态键位置重同步(最佳匹配): morphCount=' + _bestMc + ' off=' + _bestOff + ' score=' + _bestScore);
      _found = true;
    }
    if(!_found) throw new Error('形态键数异常: ' + morphCount + ' at offset ' + off);
  } else {
    off += 4;
  }
  console.log('[PMX] 形态键数=' + morphCount + ' off=' + off);
  const morphs = [];
  for(let i=0;i<morphCount;i++){
    const morphStartOff = off;
    let name, nameEn, panel, type, elemCount;
    let _morphOk = true;
    try{
      name=readText(); nameEn=readText();
      panel=dv.getUint8(off); off+=1;
      type=dv.getUint8(off); off+=1;
      elemCount=dv.getInt32(off,true); off+=4;
      if(elemCount < 0 || elemCount > 1000000) throw new Error('elemCount异常: ' + elemCount);
      if(panel > 4 || type > 8) throw new Error('panel/type异常: panel=' + panel + ' type=' + type);
    }catch(e){
      _morphOk = false;
      let _errMsg = String(e.message || e).replace(/Invalid/gi, '无效').replace(/error/gi, '错误').replace(/fail/gi, '失败');
      console.log('[PMX] 形态键#' + i + ' 头部读取失败 off=' + morphStartOff + ' 尝试resync err=' + _errMsg);
    }
    if(_morphOk){
      try{
        const elements=[];
        if(type===1){
          for(let j=0;j<elemCount;j++){
            const vi=readU(vertexIndexSize);
            const pos=readVec3();
            elements.push({vertexIndex:vi,position:pos});
          }
        } else if(type===0){
          for(let j=0;j<elemCount;j++){ off+=4+4; }
        } else if(type===2){
          for(let j=0;j<elemCount;j++){ off+=boneIndexSize+12+16; }
        } else if(type===3){
          for(let j=0;j<elemCount;j++){ off+=materialIndexSize+113; }
        } else if(type>=4 && type<=8){
          for(let j=0;j<elemCount;j++){ off+=vertexIndexSize+16; }
        } else {
          for(let j=0;j<elemCount;j++){ off+=8; }
        }
        if(off > buffer.byteLength) throw new Error('偏移越界 off=' + off);
        if(i < 10 || type !== 1 || i === morphCount-1) console.debug('[PMX] morph#' + i + ' name=' + JSON.stringify(name) + ' type=' + type + ' elem=' + elemCount + ' off=' + morphStartOff + '->' + off);
        morphs.push({name,nameEn,panel,type,elements});
      }catch(e){
        _morphOk = false;
        let _errMsg = String(e.message || e).replace(/Invalid/gi, '无效').replace(/error/gi, '错误').replace(/fail/gi, '失败');
        console.log('[PMX] 形态键#' + i + ' 元素解析失败 name=' + JSON.stringify(name) + ' type=' + type + ' elem=' + elemCount + ' err=' + _errMsg);
      }
    }
    if(!_morphOk){
      let _resynced = false;
      for(let _scan = 2; _scan < 2000; _scan += 1){
        const _so = morphStartOff + _scan;
        if(_so + 12 > buffer.byteLength) break;
        const _nl = dv.getInt32(_so, true);
        if(_nl < 0 || _nl > 100 || _so + 4 + _nl + 4 > buffer.byteLength) continue;
        if(encoding === 0 && _nl > 0 && _nl % 2 !== 0) continue;
        const _nel = dv.getInt32(_so + 4 + _nl, true);
        if(_nel < 0 || _nel > 100) continue;
        const _hdrEnd = _so + 4 + _nl + 4 + _nel + 1 + 1 + 4;
        if(_hdrEnd > buffer.byteLength) continue;
        const _pan = dv.getUint8(_so + 4 + _nl + 4 + _nel);
        const _typ = dv.getUint8(_so + 4 + _nl + 4 + _nel + 1);
        const _ec = dv.getInt32(_so + 4 + _nl + 4 + _nel + 2, true);
        if(_pan > 4 || _typ > 8 || _ec < 0 || _ec > 100000) continue;
        off = _so;
        console.log('[PMX-MORPH-RESYNC] 形态键#' + i + ' 重同步: 跳过' + _scan + '字节 -> off=' + _so + ' 推测nameLen=' + _nl + ' type=' + _typ + ' elem=' + _ec);
        _resynced = true;
        break;
      }
      if(!_resynced){
        console.log('[PMX] 形态键#' + i + ' resync失败，终止形态键解析 off=' + off);
        break;
      } else {
        i--;
      }
    }
  }
  console.log('[PMX] 形态键解析完成 off=' + off + ' remaining=' + (buffer.byteLength - off));

  return {
    version, modelName, modelNameEn, comment,
    vertexCount, faceCount, textureCount, materialCount, boneCount, morphCount,
    positions, normals, uvs, boneIndices, boneWeights, weightTypes, indices,
    textures, materials, bones, morphs,
  };
}

