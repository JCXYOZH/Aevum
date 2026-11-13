/**
 * MrHua 3D灵体渲染引擎 - orb-morph
 * 形态键(Morph)偏移计算
 * 从 orb-renderer-main.js 拆分 (原行 L4124-L4143)
 * @module orb-morph
 */
'use strict';

/* ===== 形态键偏移计算 ===== */
function computeMorphOffsets(model, morphWeights){
  const offsets = new Float32Array(model.vertexCount * 3);
  let activeCount = 0;
  for(const morph of model.morphs || []){
    if(morph.type !== 0 || !morph.elements) continue;
    const w = morphWeights[morph.name] || morphWeights[morph.nameEn] || 0;
    if(w <= 0.001) continue;
    activeCount++;
    for(const elem of morph.elements){
      const vi = elem.vertexIndex;
      if(vi < 0 || vi >= model.vertexCount) continue;
      offsets[vi*3] += elem.position[0] * w;
      offsets[vi*3+1] += elem.position[1] * w;
      offsets[vi*3+2] += elem.position[2] * w;
    }
  }
  return { offsets, activeCount };
}

