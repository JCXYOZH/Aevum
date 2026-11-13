/**
 * MrHua 3D灵体渲染引擎 - orb-diagnose
 * 渲染诊断与状态检查
 * 从 orb-renderer-main.js 拆分 (原行 L3992-L4059)
 * @module orb-diagnose
 */
'use strict';

/* ===== 渲染诊断 ===== */
function diagnoseRender(renderer, modelInstance, camera){
  const {gl,prog,loc} = renderer;
  if(renderer._contextLost) return {contextLost:true};
  const {model, posBuf, normBuf, uvBuf, boneIdxBuf, boneWeightBuf, idxBuf, textures, center, size} = modelInstance;
  const diag = {
    canvas: gl.canvas.width + 'x' + gl.canvas.height,
    glErrCode: gl.getError(),
    program: gl.getProgramParameter(prog, gl.LINK_STATUS),
    uniforms: {
      uProj: loc.uProj, uView: loc.uView, uModel: loc.uModel,
      uBonePalette: loc.uBonePalette, uLightDir: loc.uLightDir,
      uDiffuse: loc.uDiffuse, uAmbient: loc.uAmbient, uSpecular: loc.uSpecular,
      uShininess: loc.uShininess, uTexture: loc.uTexture, uHasTexture: loc.uHasTexture,
      uCameraPos: loc.uCameraPos,
    },
    attribs: {
      aPosition: loc.aPosition, aNormal: loc.aNormal, aUV: loc.aUV,
      aBoneIndex: loc.aBoneIndex, aBoneWeight: loc.aBoneWeight,
    },
    model: {
      vertices: model.vertexCount, indices: model.indices.length,
      materials: model.materials.length, bones: model.boneCount,
      textures: model.textureCount, loadedTextures: textures.filter(t=>t).length,
    },
    bounds: {
      center: center.map(v=>v.toFixed(2)),
      size: size.map(v=>v.toFixed(2)),
      maxDim: Math.max(size[0], size[1], size[2]).toFixed(2),
    },
    positionRange: {
      min: [Infinity,Infinity,Infinity], max: [-Infinity,-Infinity,-Infinity],
    },
  };
  // 检查顶点数据范围
  for(let i=0;i<model.vertexCount;i++){
    const x=model.positions[i*3], y=model.positions[i*3+1], z=model.positions[i*3+2];
    if(x<diag.positionRange.min[0]) diag.positionRange.min[0]=x;
    if(y<diag.positionRange.min[1]) diag.positionRange.min[1]=y;
    if(z<diag.positionRange.min[2]) diag.positionRange.min[2]=z;
    if(x>diag.positionRange.max[0]) diag.positionRange.max[0]=x;
    if(y>diag.positionRange.max[1]) diag.positionRange.max[1]=y;
    if(z>diag.positionRange.max[2]) diag.positionRange.max[2]=z;
  }
  diag.positionRange.min = diag.positionRange.min.map(v=>v.toFixed(2));
  diag.positionRange.max = diag.positionRange.max.map(v=>v.toFixed(2));
  // 检查索引范围
  let maxIdx = 0, minIdx = Infinity;
  for(let i=0;i<model.indices.length;i++){
    if(model.indices[i]>maxIdx) maxIdx=model.indices[i];
    if(model.indices[i]<minIdx) minIdx=model.indices[i];
  }
  diag.indexRange = {min: minIdx, max: maxIdx, valid: maxIdx < model.vertexCount};
  // 检查骨骼权重
  let zeroWeightCount = 0, validWeightCount = 0;
  for(let i=0;i<model.vertexCount;i++){
    const w0=model.boneWeights[i*4], w1=model.boneWeights[i*4+1], w2=model.boneWeights[i*4+2], w3=model.boneWeights[i*4+3];
    const sum = w0+w1+w2+w3;
    if(sum < 0.01) zeroWeightCount++; else validWeightCount++;
  }
  diag.boneWeights = {zeroWeight: zeroWeightCount, validWeight: validWeightCount, total: model.vertexCount};
  console.log('[NativeRenderer][Diagnose] 渲染诊断报告:', diag);
  // 自动尝试线框渲染
  try { renderWireframe(renderer, modelInstance, camera); }
  catch(e){ console.log('[NativeRenderer][Diagnose] 线框渲染失败:', e.message); }
  return diag;
}

