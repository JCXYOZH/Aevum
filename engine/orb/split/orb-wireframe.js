/**
 * MrHua 3D灵体渲染引擎 - orb-wireframe
 * 线框渲染模式(诊断用)
 * 从 orb-renderer-main.js 拆分 (原行 L3932-L3991)
 * @module orb-wireframe
 */
'use strict';

/* ===== 线框渲染模式（诊断用） ===== */
function renderWireframe(renderer, modelInstance, camera){
  const {gl,prog,loc} = renderer;
  if(renderer._contextLost) return;
  const {model, posBuf, idxBuf, center, size} = modelInstance;
  const cw = Math.max(1, gl.canvas.width || 1);
  const ch = Math.max(1, gl.canvas.height || 1);
  gl.useProgram(prog);
  gl.viewport(0,0,cw,ch);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const cx = center[0], cy = center[1], cz = center[2];
  const maxDim = Math.max(size[0], size[1], size[2], 1);
  const fitDist = (camera && camera.distance) || (maxDim * 2.5);
  const eye = [cx, cy + size[1]*0.15, cz + fitDist];
  const target = [cx, cy, cz];
  const aspect = cw/ch;
  const proj = M4.perspective(M4.create(), Math.PI/4, aspect, 0.1, fitDist*10+1000);
  const view = M4.lookAt(M4.create(), eye, target, [0,1,0]);
  const modelMat = new Float32Array([-1,0,0,0, 0,1,0,0, 0,0,-1,0, 0,0,0,1]);
  gl.uniformMatrix4fv(loc.uProj, false, proj);
  gl.uniformMatrix4fv(loc.uView, false, view);
  gl.uniformMatrix4fv(loc.uModel, false, modelMat);
  // 线框用单位调色板，禁用蒙皮
  const identityPalette = new Float32Array(120*16);
  for(let i=0;i<120;i++){ identityPalette[i*16]=1; identityPalette[i*16+5]=1; identityPalette[i*16+10]=1; identityPalette[i*16+15]=1; }
  if(loc.uBonePalette) gl.uniformMatrix4fv(loc.uBonePalette, false, identityPalette);
  gl.uniform3f(loc.uDiffuse, 0.3, 0.9, 0.4);
  gl.uniform3f(loc.uAmbient, 0.2, 0.2, 0.2);
  gl.uniform3f(loc.uSpecular, 0, 0, 0);
  gl.uniform1f(loc.uShininess, 1);
  gl.uniform1i(loc.uHasTexture, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.enableVertexAttribArray(loc.aPosition);
  gl.vertexAttribPointer(loc.aPosition, 3, gl.FLOAT, false, 0, 0);
  // 禁用其他属性
  if(loc.aNormal >= 0) gl.disableVertexAttribArray(loc.aNormal);
  if(loc.aUV >= 0) gl.disableVertexAttribArray(loc.aUV);
  if(loc.aBoneIndex >= 0) gl.disableVertexAttribArray(loc.aBoneIndex);
  if(loc.aBoneWeight >= 0) gl.disableVertexAttribArray(loc.aBoneWeight);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  // 用 LINES 绘制线框（每3个索引组成三角形，拆成3条边）
  const triCount = model.indices.length / 3;
  const lineIndices = new Uint32Array(triCount * 6);
  for(let t=0;t<triCount;t++){
    const i0 = model.indices[t*3], i1 = model.indices[t*3+1], i2 = model.indices[t*3+2];
    lineIndices[t*6]=i0; lineIndices[t*6+1]=i1;
    lineIndices[t*6+2]=i1; lineIndices[t*6+3]=i2;
    lineIndices[t*6+4]=i2; lineIndices[t*6+5]=i0;
  }
  const lineBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lineIndices, gl.STREAM_DRAW);
  gl.drawElements(gl.LINES, lineIndices.length, gl.UNSIGNED_INT, 0);
  gl.deleteBuffer(lineBuf);
  // 读取中心像素确认有绘制
  const pixel = new Uint8Array(4);
  gl.readPixels(Math.floor(cw/2), Math.floor(ch/2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  console.log('[NativeRenderer][Wireframe] 线框渲染完成 三角形:' + triCount + ' 线段:' + (lineIndices.length/2) + ' 中心像素RGBA:', pixel[0], pixel[1], pixel[2], pixel[3]);
}

