/**
 * MrHua 3D灵体渲染引擎 - orb-raycast
 * 鼠标射线检测与拾取
 * 从 orb-renderer-main.js 拆分 (原行 L3290-L3420)
 * @module orb-raycast
 */
'use strict';

/* ===== 鼠标射线检测 ===== */
function raycastModel(modelInstance, camera, mouseX, mouseY, canvasWidth, canvasHeight){
  if(!modelInstance || !modelInstance.model) return null;
  const model = modelInstance.model;
  const positions = model.positions;
  const indices = model.indices;
  const normals = model.normals;

  // 计算相机矩阵（与renderModel保持一致）
  const proj = new Float32Array(16);
  const view = new Float32Array(16);
  const aspect = canvasWidth / canvasHeight;
  const fitDist = camera.distance || 50;
  const camX = camera.x || 0, camY = camera.y || 10, camZ = camera.z || 0;
  const camHeight = camera.height || 12;
  M4.perspective(proj, Math.PI/4, aspect, 0.1, fitDist * 10 + 1000);
  M4.lookAt(view, [camX, camY + camHeight, fitDist], [camX, camY, camZ], [0,1,0]);

  // 模型矩阵（PMX模型需要翻转X和Z轴）
  const modelMat = new Float32Array([-1,0,0,0, 0,1,0,0, 0,0,-1,0, 0,0,0,1]);

  // 计算MVP矩阵
  const vp = new Float32Array(16);
  M4.multiply(vp, proj, view);
  const mvp = new Float32Array(16);
  M4.multiply(mvp, vp, modelMat);

  // 逆MVP矩阵，用于将屏幕坐标转换为世界坐标
  const invMvp = new Float32Array(16);
  M4.invert(invMvp, mvp);

  // 鼠标坐标转换为标准化设备坐标 (-1 ~ 1)
  const ndcX = (mouseX / canvasWidth) * 2 - 1;
  const ndcY = 1 - (mouseY / canvasHeight) * 2;

  // 计算射线的近点和远点（世界坐标）- 手动4x4矩阵点变换
  function transformPoint4(p, m){
    const x = m[0]*p[0] + m[1]*p[1] + m[2]*p[2] + m[3];
    const y = m[4]*p[0] + m[5]*p[1] + m[6]*p[2] + m[7];
    const z = m[8]*p[0] + m[9]*p[1] + m[10]*p[2] + m[11];
    const w = m[12]*p[0] + m[13]*p[1] + m[14]*p[2] + m[15];
    if(w !== 0 && w !== 1) return [x/w, y/w, z/w];
    return [x, y, z];
  }
  const nearPoint = transformPoint4([ndcX, ndcY, -1], invMvp);
  const farPoint = transformPoint4([ndcX, ndcY, 1], invMvp);

  // 射线方向
  const rayDir = [farPoint[0] - nearPoint[0], farPoint[1] - nearPoint[1], farPoint[2] - nearPoint[2]];
  const rayLen = Math.sqrt(rayDir[0]*rayDir[0] + rayDir[1]*rayDir[1] + rayDir[2]*rayDir[2]);
  rayDir[0] /= rayLen; rayDir[1] /= rayLen; rayDir[2] /= rayLen;

  // 遍历所有三角形，检测交点
  let closestT = Infinity;
  let closestTri = -1;
  let closestPoint = null;
  const triCount = indices.length / 3;

  for(let ti = 0; ti < triCount; ti++){
    const i0 = indices[ti*3] * 3;
    const i1 = indices[ti*3+1] * 3;
    const i2 = indices[ti*3+2] * 3;

    const v0 = [positions[i0], positions[i0+1], positions[i0+2]];
    const v1 = [positions[i1], positions[i1+1], positions[i1+2]];
    const v2 = [positions[i2], positions[i2+1], positions[i2+2]];

    // Moller-Trumbore射线-三角形相交算法
    const edge1 = [v1[0]-v0[0], v1[1]-v0[1], v1[2]-v0[2]];
    const edge2 = [v2[0]-v0[0], v2[1]-v0[1], v2[2]-v0[2]];
    const h = [
      rayDir[1]*edge2[2] - rayDir[2]*edge2[1],
      rayDir[2]*edge2[0] - rayDir[0]*edge2[2],
      rayDir[0]*edge2[1] - rayDir[1]*edge2[0]
    ];
    const a = edge1[0]*h[0] + edge1[1]*h[1] + edge1[2]*h[2];
    if(Math.abs(a) < 1e-8) continue;

    const f = 1 / a;
    const s = [nearPoint[0]-v0[0], nearPoint[1]-v0[1], nearPoint[2]-v0[2]];
    const u = f * (s[0]*h[0] + s[1]*h[1] + s[2]*h[2]);
    if(u < 0 || u > 1) continue;

    const q = [
      s[1]*edge1[2] - s[2]*edge1[1],
      s[2]*edge1[0] - s[0]*edge1[2],
      s[0]*edge1[1] - s[1]*edge1[0]
    ];
    const v = f * (rayDir[0]*q[0] + rayDir[1]*q[1] + rayDir[2]*q[2]);
    if(v < 0 || u + v > 1) continue;

    const t = f * (edge2[0]*q[0] + edge2[1]*q[1] + edge2[2]*q[2]);
    if(t > 1e-6 && t < closestT){
      closestT = t;
      closestTri = ti;
      closestPoint = [
        nearPoint[0] + rayDir[0]*t,
        nearPoint[1] + rayDir[1]*t,
        nearPoint[2] + rayDir[2]*t
      ];
    }
  }

  if(closestTri < 0) return null;

  // 计算交点的法线（插值）
  const i0 = indices[closestTri*3] * 3;
  const i1 = indices[closestTri*3+1] * 3;
  const i2 = indices[closestTri*3+2] * 3;
  const n0 = [normals[i0], normals[i0+1], normals[i0+2]];
  const n1 = [normals[i1], normals[i1+1], normals[i1+2]];
  const n2 = [normals[i2], normals[i2+1], normals[i2+2]];

  // 找到交点对应的骨骼（简化：返回三角形第一个顶点的骨骼）
  const boneIdx = model.boneIndices ? model.boneIndices[indices[closestTri*3]] : -1;
  const boneName = boneIdx >= 0 && model.bones ? model.bones[boneIdx].name : 'unknown';

  return {
    triangle: closestTri,
    point: closestPoint,
    distance: closestT,
    normal: [
      (n0[0]+n1[0]+n2[0])/3,
      (n0[1]+n1[1]+n2[1])/3,
      (n0[2]+n1[2]+n2[2])/3
    ],
    boneIndex: boneIdx,
    boneName: boneName
  };
}

