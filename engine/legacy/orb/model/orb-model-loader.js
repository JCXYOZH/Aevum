/**
 * MrHua 3D灵体渲染引擎 - orb-model-loader
 * 模型加载与实例化
 * 从 orb-renderer-main.js 拆分 (原行 L3421-L3542)
 * @module orb-model-loader
 */
'use strict';

/* ===== 模型实例 ===== */
async function loadPMXModel(url, renderer){
  console.log('[NativeRenderer] loadPMXModel 开始 url=' + url);
  const resp = await fetch(url);
  if(!resp.ok) throw new Error('加载失败: '+resp.status);
  const buffer = await resp.arrayBuffer();
  console.log('[NativeRenderer] 文件下载完成 size=' + buffer.byteLength);
  let model;
  try { model = parsePMX(buffer); }
  catch(e) { console.error('[NativeRenderer] parsePMX 失败:', e.message); throw e; }
  console.log('[NativeRenderer] parsePMX 完成 vertices=' + model.vertexCount + ' faces=' + model.faceCount + ' bones=' + model.boneCount + ' materials=' + model.materialCount);

  // 紧凑骨骼调色板：收集顶点引用的唯一骨骼索引，重映射到0~N-1
  const MAX_PALETTE = renderer.maxBones || 256;
  const uniqueBoneSet = new Set();
  for(let i=0;i<model.boneIndices.length;i++){
    const idx = model.boneIndices[i];
    if(idx >= 0) uniqueBoneSet.add(idx);
  }
  const uniqueBones = Array.from(uniqueBoneSet).sort((a,b)=>a-b);
  const boneRemap = new Int32Array(model.boneCount).fill(-1);
  for(let i=0;i<uniqueBones.length;i++){ boneRemap[uniqueBones[i]] = i; }
  if(uniqueBones.length > MAX_PALETTE){
    console.log('[NativeRenderer] 顶点引用骨骼=' + uniqueBones.length + ' 超过调色板上限=' + MAX_PALETTE + '，超出部分映射到骨骼0');
  } else {
    console.log('[NativeRenderer] 骨骼调色板: 总骨骼=' + model.boneCount + ' 顶点引用=' + uniqueBones.length + ' 上限=' + MAX_PALETTE);
  }

  let boneSystem;
  try { boneSystem = buildBoneSystem(model, uniqueBones); }
  catch(e) { console.error('[NativeRenderer] buildBoneSystem 失败:', e.message); throw e; }
  console.log('[NativeRenderer] buildBoneSystem 完成 computeOrder=' + (boneSystem.computeOrder ? boneSystem.computeOrder.length : 'all'));
  let animator;
  try { animator = createProceduralAnimator(boneSystem, model); }
  catch(e) { console.error('[NativeRenderer] createProceduralAnimator 失败:', e.message); throw e; }
  console.log('[NativeRenderer] createProceduralAnimator 完成');
  // 暴露到全局，方便控制台调试
  window.animator = animator;
  // 自动绑定鼠标看向交互
  if(animator.bindMouseLook && renderer.gl && renderer.gl.canvas){
    animator.bindMouseLook(renderer.gl.canvas);
  }

  // 创建顶点缓冲
  const posBuf = renderer.createBuffer(model.positions, renderer.gl.ARRAY_BUFFER);
  const normBuf = renderer.createBuffer(model.normals, renderer.gl.ARRAY_BUFFER);
  const uvBuf = renderer.createBuffer(model.uvs, renderer.gl.ARRAY_BUFFER);

  // 重映射顶点骨骼索引，超出调色板上限的映射到0
  const remappedBoneIndices = new Float32Array(model.boneIndices.length);
  for(let i=0;i<model.boneIndices.length;i++){
    const orig = model.boneIndices[i];
    const remapped = (orig >= 0 && boneRemap[orig] >= 0) ? boneRemap[orig] : 0;
    remappedBoneIndices[i] = remapped < MAX_PALETTE ? remapped : 0;
  }
  const boneIdxBuf = renderer.createBuffer(remappedBoneIndices, renderer.gl.ARRAY_BUFFER);
  const boneWeightBuf = renderer.createBuffer(model.boneWeights, renderer.gl.ARRAY_BUFFER);
  const idxBuf = renderer.createBuffer(model.indices, renderer.gl.ELEMENT_ARRAY_BUFFER);
  // 形态键偏移缓冲（动态更新）
  const morphOffsetData = new Float32Array(model.vertexCount * 3);
  const morphOffsetBuf = renderer.createBuffer(morphOffsetData, renderer.gl.ARRAY_BUFFER);

  // 加载纹理（并行）
  const baseUrl = url.substring(0, url.lastIndexOf('/')+1);
  console.log('[NativeRenderer] 开始加载纹理 count=' + model.textureCount);
  const textures = new Array(model.textureCount);
  const _texPromises = [];
  for(let i=0;i<model.textureCount;i++){
    const texPath = model.textures[i];
    if(texPath){
      const texUrl = baseUrl + texPath.replace(/\\/g,'/');
      _texPromises.push(renderer.loadTexture(texUrl).then(t => { textures[i] = t; }).catch(e => { console.log('[NativeRenderer] 纹理加载失败 [' + i + ']:', texUrl, e.message); textures[i] = null; }));
    }
  }
  if(_texPromises.length > 0) await Promise.all(_texPromises);
  console.log('[NativeRenderer] 纹理加载完成');
  for(let i=0;i<model.textureCount;i++){
    console.log('[NativeRenderer] 纹理[' + i + '] path=' + JSON.stringify(model.textures[i]) + ' loaded=' + (textures[i] ? 'YES' : 'NO') + ' url=' + (baseUrl + (model.textures[i]||'').replace(/\\/g,'/')));
  }

  // 计算包围盒
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(let i=0;i<model.vertexCount;i++){
    const x=model.positions[i*3],y=model.positions[i*3+1],z=model.positions[i*3+2];
    if(x<minX)minX=x; if(y<minY)minY=y; if(z<minZ)minZ=z;
    if(x>maxX)maxX=x; if(y>maxY)maxY=y; if(z>maxZ)maxZ=z;
  }
  const center = [(minX+maxX)/2, (minY+maxY)/2, (minZ+maxZ)/2];
  const size = [maxX-minX, maxY-minY, maxZ-minZ];

  // 预计算每个材质的边界球（用于视锥剔除）
  const materialBounds = new Array(model.materials.length);
  let _idxOff = 0;
  for(let mi=0; mi<model.materials.length; mi++){
    const _sc = model.materials[mi].surfaceCount;
    let _mnx=Infinity,_mny=Infinity,_mnz=Infinity,_mxx=-Infinity,_mxy=-Infinity,_mxz=-Infinity;
    for(let k=0;k<_sc;k++){
      const _vi = model.indices[_idxOff+k];
      const _vx=model.positions[_vi*3],_vy=model.positions[_vi*3+1],_vz=model.positions[_vi*3+2];
      if(_vx<_mnx)_mnx=_vx; if(_vy<_mny)_mny=_vy; if(_vz<_mnz)_mnz=_vz;
      if(_vx>_mxx)_mxx=_vx; if(_vy>_mxy)_mxy=_vy; if(_vz>_mxz)_mxz=_vz;
    }
    const _cx=(_mnx+_mxx)*0.5,_cy=(_mny+_mxy)*0.5,_cz=(_mnz+_mxz)*0.5;
    const _dx=_mxx-_cx,_dy=_mxy-_cy,_dz=_mxz-_cz;
    const _r=Math.sqrt(_dx*_dx+_dy*_dy+_dz*_dz);
    materialBounds[mi] = {cx:_cx,cy:_cy,cz:_cz,r:_r};
    _idxOff += _sc;
  }

  return {
    model, boneSystem, animator,
    posBuf, normBuf, uvBuf, boneIdxBuf, boneWeightBuf, idxBuf,
    morphOffsetBuf, morphOffsetData,
    textures, center, size, uniqueBones, materialBounds,
    vertexCount: model.vertexCount, indexCount: model.indices.length,
    raycast: function(camera, mouseX, mouseY, canvasWidth, canvasHeight){
      return raycastModel(this, camera, mouseX, mouseY, canvasWidth, canvasHeight);
    },
    materialCount: model.materialCount,
  };
}

