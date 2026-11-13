
/* ===== 调试渲染系统 ===== */
const DebugMode = { NONE: 0, WIREFRAME: 1, NORMALS: 2, UV: 3, POSITION: 4, BONE_WEIGHT: 5, DEPTH: 6, ALBEDO: 7, LIGHTING: 8 };
function createDebugRenderer(gl){
  const dr = {
    mode: DebugMode.NONE,
    enabled: false,
    _lineProgram: null,
    _lineBuffer: null,
    _lineCount: 0,
    _aPos: null,
    _aColor: null,
    _uViewProj: null,
  };
  const vsSrc = 'attribute vec3 aPos; attribute vec3 aColor; uniform mat4 uViewProj; varying vec3 vColor; void main(){ vColor=aColor; gl_Position=uViewProj*vec4(aPos,1.0); }';
  const fsSrc = 'precision highp float; varying vec3 vColor; void main(){ gl_FragColor=vec4(vColor,1.0); }';
  function compileShader(type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }
  const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
  dr._lineProgram = gl.createProgram();
  gl.attachShader(dr._lineProgram, vs);
  gl.attachShader(dr._lineProgram, fs);
  gl.linkProgram(dr._lineProgram);
  dr._aPos = gl.getAttribLocation(dr._lineProgram, 'aPos');
  dr._aColor = gl.getAttribLocation(dr._lineProgram, 'aColor');
  dr._uViewProj = gl.getUniformLocation(dr._lineProgram, 'uViewProj');
  dr._lineBuffer = gl.createBuffer();
  function drawLines(vertices, viewProj, color){
    if(vertices.length === 0) return;
    const data = new Float32Array(vertices.length * 6);
    for(let i=0;i<vertices.length;i++){
      data[i*6]=vertices[i][0]; data[i*6+1]=vertices[i][1]; data[i*6+2]=vertices[i][2];
      data[i*6+3]=color[0]; data[i*6+4]=color[1]; data[i*6+5]=color[2];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, dr._lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.useProgram(dr._lineProgram);
    gl.uniformMatrix4fv(dr._uViewProj, false, viewProj);
    gl.enableVertexAttribArray(dr._aPos);
    gl.vertexAttribPointer(dr._aPos, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(dr._aColor);
    gl.vertexAttribPointer(dr._aColor, 3, gl.FLOAT, false, 24, 12);
    gl.drawArrays(gl.LINES, 0, vertices.length);
  }
  function drawAABB(aabb, viewProj, color){
    const c = color || [1,1,0];
    const v = [];
    const corners = AABB.corners(aabb);
    const edges = [[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]];
    for(const e of edges){ v.push(corners[e[0]], corners[e[1]]); }
    drawLines(v, viewProj, c);
  }
  function drawSphere(sphere, viewProj, color, segments){
    const c = color || [0,1,1];
    const seg = segments || 16;
    const v = [];
    for(let i=0;i<seg;i++){
      const a1 = (i/seg)*Math.PI*2, a2 = ((i+1)/seg)*Math.PI*2;
      v.push([sphere.center[0]+Math.cos(a1)*sphere.radius, sphere.center[1], sphere.center[2]+Math.sin(a1)*sphere.radius]);
      v.push([sphere.center[0]+Math.cos(a2)*sphere.radius, sphere.center[1], sphere.center[2]+Math.sin(a2)*sphere.radius]);
      v.push([sphere.center[0]+Math.cos(a1)*sphere.radius, sphere.center[1]+Math.sin(a1)*sphere.radius, sphere.center[2]]);
      v.push([sphere.center[0]+Math.cos(a2)*sphere.radius, sphere.center[1]+Math.sin(a2)*sphere.radius, sphere.center[2]]);
    }
    drawLines(v, viewProj, c);
  }
  function drawBone(boneSystem, boneIndex, viewProj, color){
    const b = boneSystem.bones[boneIndex];
    if(!b) return;
    const c = color || [1,0,0];
    const pos = b.position;
    const v = [pos];
    if(b.parent >= 0 && boneSystem.bones[b.parent]){
      v.push(boneSystem.bones[b.parent].position);
    } else {
      v.push([pos[0], pos[1]+0.5, pos[2]]);
    }
    drawLines(v, viewProj, c);
  }
  function drawSkeleton(boneSystem, viewProj){
    for(let i=0;i<boneSystem.bones.length;i++){
      const hue = i / boneSystem.bones.length;
      const r = Math.sin(hue*6.28)*0.5+0.5;
      const g = Math.sin(hue*6.28+2.09)*0.5+0.5;
      const b = Math.sin(hue*6.28+4.18)*0.5+0.5;
      drawBone(boneSystem, i, viewProj, [r,g,b]);
    }
  }
  function drawNormals(modelInstance, viewProj, length, color){
    const c = color || [0,1,0];
    const len = length || 0.1;
    const v = [];
    const step = Math.max(1, Math.floor(modelInstance.model.vertexCount / 500));
    for(let i=0;i<modelInstance.model.vertexCount;i+=step){
      const px=modelInstance.model.positions[i*3], py=modelInstance.model.positions[i*3+1], pz=modelInstance.model.positions[i*3+2];
      const nx=modelInstance.model.normals[i*3], ny=modelInstance.model.normals[i*3+1], nz=modelInstance.model.normals[i*3+2];
      v.push([px,py,pz], [px+nx*len, py+ny*len, pz+nz*len]);
    }
    drawLines(v, viewProj, c);
  }
  function drawGrid(viewProj, size, divisions, color){
    const s = size || 10, d = divisions || 10;
    const c = color || [0.3,0.3,0.3];
    const v = [];
    const step = s/d;
    for(let i=0;i<=d;i++){
      const p = -s/2 + i*step;
      v.push([p,0,-s/2],[p,0,s/2]);
      v.push([-s/2,0,p],[s/2,0,p]);
    }
    drawLines(v, viewProj, c);
  }
  function dispose(){
    gl.deleteBuffer(dr._lineBuffer);
    gl.deleteProgram(dr._lineProgram);
  }
  console.log('[DebugRenderer] 创建完成');
  return { drawLines, drawAABB, drawSphere, drawBone, drawSkeleton, drawNormals, drawGrid, dispose, dr };
}

/* ===== 场景图系统 ===== */
const NodeType = { ROOT: 0, MESH: 1, LIGHT: 2, CAMERA: 3, GROUP: 4, PARTICLE: 5, EMPTY: 6 };
function createSceneNode(type, name){
  const node = {
    type: type,
    name: name || 'node',
    parent: null,
    children: [],
    position: [0,0,0],
    rotation: [0,0,0,1],
    scale: [1,1,1],
    _localMatrix: new Float32Array(16),
    _worldMatrix: new Float32Array(16),
    _worldDirty: true,
    visible: true,
    castShadow: true,
    receiveShadow: true,
    userData: {},
    mesh: null,
    light: null,
    camera: null,
    boundingBox: null,
    boundingSphere: null,
  };
  M4.identity(node._localMatrix);
  M4.identity(node._worldMatrix);
  return node;
}
function nodeAddChild(parent, child){
  if(child.parent) nodeRemoveChild(child.parent, child);
  parent.children.push(child);
  child.parent = parent;
  child._worldDirty = true;
  return child;
}
function nodeRemoveChild(parent, child){
  const idx = parent.children.indexOf(child);
  if(idx >= 0){ parent.children.splice(idx,1); child.parent = null; child._worldDirty = true; }
  return child;
}
function nodeUpdateLocalMatrix(node){
  M4.fromTRS(node._localMatrix, node.position, node.rotation, node.scale);
  node._worldDirty = true;
}
function nodeUpdateWorldMatrix(node, parentWorldMatrix){
  if(node._worldDirty || parentWorldMatrix){
    nodeUpdateLocalMatrix(node);
    if(parentWorldMatrix){
      M4.mult(node._worldMatrix, parentWorldMatrix, node._localMatrix);
    } else {
      M4.copy(node._worldMatrix, node._localMatrix);
    }
    node._worldDirty = false;
  }
  for(let i=0;i<node.children.length;i++){
    nodeUpdateWorldMatrix(node.children[i], node._worldMatrix);
  }
}
function nodeGetWorldPosition(node, out){
  out[0]=node._worldMatrix[12]; out[1]=node._worldMatrix[13]; out[2]=node._worldMatrix[14]; return out;
}
function nodeGetWorldRotation(node, out){
  const m=node._worldMatrix;
  const trace=m[0]+m[5]+m[10];
  if(trace>0){ const s=0.5/Math.sqrt(trace+1); out[3]=0.25/s; out[0]=(m[6]-m[9])*s; out[1]=(m[8]-m[2])*s; out[2]=(m[1]-m[4])*s; }
  else if(m[0]>m[5]&&m[0]>m[10]){ const s=2*Math.sqrt(1+m[0]-m[5]-m[10]); out[3]=(m[6]-m[9])/s; out[0]=0.25*s; out[1]=(m[1]+m[4])/s; out[2]=(m[8]+m[2])/s; }
  else if(m[5]>m[10]){ const s=2*Math.sqrt(1+m[5]-m[0]-m[10]); out[3]=(m[8]-m[2])/s; out[0]=(m[1]+m[4])/s; out[1]=0.25*s; out[2]=(m[6]+m[9])/s; }
  else { const s=2*Math.sqrt(1+m[10]-m[0]-m[5]); out[3]=(m[1]-m[4])/s; out[0]=(m[8]+m[2])/s; out[1]=(m[6]+m[9])/s; out[2]=0.25*s; }
  return out;
}
function nodeGetWorldScale(node, out){
  const m=node._worldMatrix;
  out[0]=Math.sqrt(m[0]*m[0]+m[1]*m[1]+m[2]*m[2]);
  out[1]=Math.sqrt(m[4]*m[4]+m[5]*m[5]+m[6]*m[6]);
  out[2]=Math.sqrt(m[8]*m[8]+m[9]*m[9]+m[10]*m[10]);
  return out;
}
function nodeTraverse(node, callback, order){
  if(order === 'postorder'){
    for(let i=0;i<node.children.length;i++) nodeTraverse(node.children[i], callback, order);
    callback(node);
  } else {
    callback(node);
    for(let i=0;i<node.children.length;i++) nodeTraverse(node.children[i], callback, order);
  }
}
function nodeFindByName(root, name){
  let result = null;
  nodeTraverse(root, (n)=>{ if(n.name===name && !result) result=n; });
  return result;
}
function nodeFindByType(root, type){
  const result = [];
  nodeTraverse(root, (n)=>{ if(n.type===type) result.push(n); });
  return result;
}
function nodeComputeBoundingBox(node){
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  nodeTraverse(node, (n)=>{
    if(n.boundingBox){
      const wp=[0,0,0]; nodeGetWorldPosition(n, wp);
      min[0]=Math.min(min[0], wp[0]+n.boundingBox.min[0]);
      min[1]=Math.min(min[1], wp[1]+n.boundingBox.min[1]);
      min[2]=Math.min(min[2], wp[2]+n.boundingBox.min[2]);
      max[0]=Math.max(max[0], wp[0]+n.boundingBox.max[0]);
      max[1]=Math.max(max[1], wp[1]+n.boundingBox.max[1]);
      max[2]=Math.max(max[2], wp[2]+n.boundingBox.max[2]);
    }
  });
  return {min, max};
}
function createScene(){
  const scene = createSceneNode(NodeType.ROOT, 'scene');
  scene.ambientLight = [0.3,0.3,0.3];
  scene.fog = { enabled: false, color: [0,0,0], near: 1, far: 100, density: 0.01 };
  scene.background = [0,0,0,0];
  scene._lights = [];
  scene._cameras = [];
  scene._meshes = [];
  function add(node){ nodeAddChild(scene, node); if(node.type===NodeType.LIGHT) scene._lights.push(node); if(node.type===NodeType.CAMERA) scene._cameras.push(node); if(node.type===NodeType.MESH) scene._meshes.push(node); return node; }
  function remove(node){ nodeRemoveChild(scene, node); const li=scene._lights.indexOf(node); if(li>=0)scene._lights.splice(li,1); const ci=scene._cameras.indexOf(node); if(ci>=0)scene._cameras.splice(ci,1); const mi=scene._meshes.indexOf(node); if(mi>=0)scene._meshes.splice(mi,1); return node; }
  function update(){ nodeUpdateWorldMatrix(scene, null); }
  function getLights(){ return scene._lights; }
  function getCameras(){ return scene._cameras; }
  function getMeshes(){ return scene._meshes; }
  return { scene, add, remove, update, getLights, getCameras, getMeshes, root: scene };
}