
/* ===== 材质系统扩展 ===== */
const MaterialType = { STANDARD: 0, PHONG: 1, LAMBERT: 2, TOON: 3, PBR: 4, UNLIT: 5, TRANSPARENT: 6, ADDITIVE: 7, SKYBOX: 8 };
const CullMode = { NONE: 0, FRONT: 1, BACK: 2 };
function createMaterial(type, options){
  const opt = options || {};
  return {
    type: type !== undefined ? type : MaterialType.STANDARD,
    name: opt.name || 'material',
    color: opt.color ? opt.color.slice() : [1,1,1,1],
    ambient: opt.ambient ? opt.ambient.slice() : [0.5,0.5,0.5],
    diffuse: opt.diffuse ? opt.diffuse.slice() : [1,1,1,1],
    specular: opt.specular ? opt.specular.slice() : [0.5,0.5,0.5],
    emissive: opt.emissive ? opt.emissive.slice() : [0,0,0],
    shininess: opt.shininess !== undefined ? opt.shininess : 32,
    metalness: opt.metalness !== undefined ? opt.metalness : 0,
    roughness: opt.roughness !== undefined ? opt.roughness : 0.5,
    opacity: opt.opacity !== undefined ? opt.opacity : 1,
    transparent: opt.transparent || false,
    alphaTest: opt.alphaTest || 0,
    blendMode: opt.blendMode !== undefined ? opt.blendMode : BlendMode.NORMAL,
    cullMode: opt.cullMode !== undefined ? opt.cullMode : CullMode.BACK,
    depthWrite: opt.depthWrite !== false,
    depthTest: opt.depthTest !== false,
    side: opt.side || 'front',
    map: opt.map || null,
    normalMap: opt.normalMap || null,
    specularMap: opt.specularMap || null,
    emissiveMap: opt.emissiveMap || null,
    roughnessMap: opt.roughnessMap || null,
    metalnessMap: opt.metalnessMap || null,
    aoMap: opt.aoMap || null,
    envMap: opt.envMap || null,
    toonGradient: opt.toonGradient || null,
    userData: {},
    _program: null,
    _uniformCache: {},
    clone: function(){
      return createMaterial(this.type, {
        name: this.name+'_copy',
        color: this.color.slice(),
        ambient: this.ambient.slice(),
        diffuse: this.diffuse.slice(),
        specular: this.specular.slice(),
        emissive: this.emissive.slice(),
        shininess: this.shininess,
        metalness: this.metalness,
        roughness: this.roughness,
        opacity: this.opacity,
        transparent: this.transparent,
        alphaTest: this.alphaTest,
        blendMode: this.blendMode,
        cullMode: this.cullMode,
        depthWrite: this.depthWrite,
        depthTest: this.depthTest,
        map: this.map,
        normalMap: this.normalMap,
      });
    },
  };
}
function applyMaterialState(gl, material){
  if(material.transparent || material.opacity < 1){
    gl.enable(gl.BLEND);
    if(material.blendMode === BlendMode.ADDITIVE) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    else if(material.blendMode === BlendMode.MULTIPLY) gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    else if(material.blendMode === BlendMode.SCREEN) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  } else {
    gl.disable(gl.BLEND);
  }
  if(material.cullMode !== CullMode.NONE){
    gl.enable(gl.CULL_FACE);
    gl.cullFace(material.cullMode === CullMode.FRONT ? gl.FRONT : gl.BACK);
  } else {
    gl.disable(gl.CULL_FACE);
  }
  if(material.depthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
  gl.depthMask(material.depthWrite);
}
function createMaterialLibrary(){
  const lib = { materials: new Map(), _default: null };
  function add(name, material){ material.name = name; lib.materials.set(name, material); return material; }
  function get(name){ return lib.materials.get(name) || lib._default; }
  function remove(name){ lib.materials.delete(name); }
  function has(name){ return lib.materials.has(name); }
  function clear(){ lib.materials.clear(); }
  function clone(){
    const newLib = createMaterialLibrary();
    for(const [name, mat] of lib.materials) newLib.add(name, mat.clone());
    return newLib;
  }
  lib._default = createMaterial(MaterialType.STANDARD, {name:'default'});
  return { add, get, remove, has, clear, clone, lib };
}

/* ===== 着色器管理系统 ===== */
function createShaderManager(gl){
  const mgr = {
    gl: gl,
    _programs: new Map(),
    _shaders: new Map(),
    _cache: new Map(),
    _activeProgram: null,
  };
  function compileShader(type, source){
    const key = type + ':' + source.length + ':' + source.substring(0,100);
    if(mgr._shaders.has(key)) return mgr._shaders.get(key);
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if(!gl.getShaderParameter(shader, gl.COMPILE_STATUS)){
      const log = gl.getShaderInfoLog(shader);
      console.log('[ShaderManager] 着色器编译失败:', log);
      console.log('[ShaderManager] 源码:', source);
      return null;
    }
    mgr._shaders.set(key, shader);
    return shader;
  }
  function createProgram(vsSource, fsSource, defines){
    const defStr = defines ? Object.entries(defines).map(([k,v])=>'#define '+k+' '+v).join('\n') : '';
    const vsFull = defStr + '\n' + vsSource;
    const fsFull = defStr + '\n' + fsSource;
    const key = vsFull.length + ':' + fsFull.length + ':' + vsFull.substring(0,50) + fsFull.substring(0,50);
    if(mgr._programs.has(key)) return mgr._programs.get(key);
    const vs = compileShader(gl.VERTEX_SHADER, vsFull);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsFull);
    if(!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program, gl.LINK_STATUS)){
      console.log('[ShaderManager] 程序链接失败:', gl.getProgramInfoLog(program));
      return null;
    }
    const info = {
      program: program,
      attributes: {},
      uniforms: {},
      _uniformCache: {},
    };
    const attrCount = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
    for(let i=0;i<attrCount;i++){
      const attr = gl.getActiveAttrib(program, i);
      info.attributes[attr.name] = gl.getAttribLocation(program, attr.name);
    }
    const uniCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for(let i=0;i<uniCount;i++){
      const uni = gl.getActiveUniform(program, i);
      const name = uni.name.replace(/\[0\]$/, '');
      info.uniforms[name] = gl.getUniformLocation(program, name);
    }
    mgr._programs.set(key, info);
    return info;
  }
  function useProgram(info){
    if(mgr._activeProgram !== info.program){
      gl.useProgram(info.program);
      mgr._activeProgram = info.program;
      return true;
    }
    return false;
  }
  function setUniform(info, name, value){
    const loc = info.uniforms[name];
    if(!loc) return false;
    const cacheKey = name + ':' + (Array.isArray(value) ? value.join(',') : value);
    if(info._uniformCache[cacheKey]) return false;
    info._uniformCache[cacheKey] = true;
    if(typeof value === 'number') gl.uniform1f(loc, value);
    else if(value instanceof Float32Array && value.length === 16) gl.uniformMatrix4fv(loc, false, value);
    else if(value instanceof Float32Array && value.length === 9) gl.uniformMatrix3fv(loc, false, value);
    else if(Array.isArray(value)){
      if(value.length === 2) gl.uniform2fv(loc, value);
      else if(value.length === 3) gl.uniform3fv(loc, value);
      else if(value.length === 4) gl.uniform4fv(loc, value);
    }
    return true;
  }
  function setUniform1i(info, name, value){
    const loc = info.uniforms[name];
    if(loc) gl.uniform1i(loc, value);
  }
  function invalidateCache(info){ info._uniformCache = {}; }
  function dispose(){
    for(const [key, info] of mgr._programs) gl.deleteProgram(info.program);
    for(const [key, shader] of mgr._shaders) gl.deleteShader(shader);
    mgr._programs.clear();
    mgr._shaders.clear();
  }
  console.log('[ShaderManager] 创建完成');
  return { compileShader, createProgram, useProgram, setUniform, setUniform1i, invalidateCache, dispose, mgr };
}

/* ===== 帧缓冲系统 ===== */
function createFramebuffer(gl, width, height, options){
  const opt = options || {};
  const fb = {
    gl: gl,
    width: width,
    height: height,
    framebuffer: gl.createFramebuffer(),
    colorTexture: null,
    depthTexture: null,
    depthRenderbuffer: null,
    stencilRenderbuffer: null,
    _colorAttachments: [],
  };
  function createColorTexture(attachment){
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opt.minFilter || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, opt.magFilter || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opt.wrapS || gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opt.wrapT || gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment || gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return tex;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb.framebuffer);
  if(opt.colorAttachments && opt.colorAttachments > 1){
    const ext = gl.getExtension('WEBGL_draw_buffers');
    if(ext){
      for(let i=0;i<opt.colorAttachments;i++){
        const tex = createColorTexture(ext['COLOR_ATTACHMENT'+i+'_WEBGL']);
        fb._colorAttachments.push(tex);
      }
      ext.drawBuffersWEBGL(fb._colorAttachments.map((_,i)=>ext['COLOR_ATTACHMENT'+i+'_WEBGL']));
    }
  } else {
    fb.colorTexture = createColorTexture(gl.COLOR_ATTACHMENT0);
  }
  if(opt.depthTexture){
    const ext = gl.getExtension('WEBGL_depth_texture');
    if(ext){
      fb.depthTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, fb.depthTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, fb.depthTexture, 0);
    }
  } else if(opt.depth !== false){
    fb.depthRenderbuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, fb.depthRenderbuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, opt.depthStencil ? gl.DEPTH_STENCIL : gl.DEPTH_COMPONENT16, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, opt.depthStencil ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, fb.depthRenderbuffer);
  }
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if(status !== gl.FRAMEBUFFER_COMPLETE) console.log('[Framebuffer] 不完整:', status);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  function bind(){ gl.bindFramebuffer(gl.FRAMEBUFFER, fb.framebuffer); gl.viewport(0,0,width,height); }
  function unbind(){ gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
  function resize(w, h){
    fb.width = w; fb.height = h;
    if(fb.colorTexture){ gl.bindTexture(gl.TEXTURE_2D, fb.colorTexture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); }
    for(const tex of fb._colorAttachments){ gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); }
    if(fb.depthTexture){ gl.bindTexture(gl.TEXTURE_2D, fb.depthTexture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null); }
    if(fb.depthRenderbuffer){ gl.bindRenderbuffer(gl.RENDERBUFFER, fb.depthRenderbuffer); gl.renderbufferStorage(gl.RENDERBUFFER, opt.depthStencil ? gl.DEPTH_STENCIL : gl.DEPTH_COMPONENT16, w, h); }
  }
  function clear(r,g,b,a){
    bind();
    gl.clearColor(r||0, g||0, b||0, a!==undefined?a:1);
    gl.clear(gl.COLOR_BUFFER_BIT | (fb.depthRenderbuffer||fb.depthTexture ? gl.DEPTH_BUFFER_BIT : 0));
  }
  function dispose(){
    gl.deleteFramebuffer(fb.framebuffer);
    if(fb.colorTexture) gl.deleteTexture(fb.colorTexture);
    if(fb.depthTexture) gl.deleteTexture(fb.depthTexture);
    if(fb.depthRenderbuffer) gl.deleteRenderbuffer(fb.depthRenderbuffer);
    for(const tex of fb._colorAttachments) gl.deleteTexture(tex);
  }
  console.log('[Framebuffer] 创建完成 ' + width + 'x' + height);
  return { bind, unbind, resize, clear, dispose, fb };
}
function createRenderTarget(gl, width, height, options){
  const opt = options || {};
  return {
    framebuffer: createFramebuffer(gl, width, height, opt),
    width: width,
    height: height,
    samples: opt.samples || 1,
    get texture(){ return this.framebuffer.fb.colorTexture; },
    get depthTexture(){ return this.framebuffer.fb.depthTexture; },
  };
}

/* ===== 视锥剔除系统 ===== */
function createFrustum(){
  return { planes: [new Float32Array(4),new Float32Array(4),new Float32Array(4),new Float32Array(4),new Float32Array(4),new Float32Array(4)] };
}
function extractFrustumFromMatrix(frustum, m){
  const planes = frustum.planes;
  planes[0][0]=m[3]-m[0]; planes[0][1]=m[7]-m[4]; planes[0][2]=m[11]-m[8]; planes[0][3]=m[15]-m[12];
  planes[1][0]=m[3]+m[0]; planes[1][1]=m[7]+m[4]; planes[1][2]=m[11]+m[8]; planes[1][3]=m[15]+m[12];
  planes[2][0]=m[3]+m[1]; planes[2][1]=m[7]+m[5]; planes[2][2]=m[11]+m[9]; planes[2][3]=m[15]+m[13];
  planes[3][0]=m[3]-m[1]; planes[3][1]=m[7]-m[5]; planes[3][2]=m[11]-m[9]; planes[3][3]=m[15]-m[13];
  planes[4][0]=m[3]-m[2]; planes[4][1]=m[7]-m[6]; planes[4][2]=m[11]-m[10]; planes[4][3]=m[15]-m[14];
  planes[5][0]=m[3]+m[2]; planes[5][1]=m[7]+m[6]; planes[5][2]=m[11]+m[10]; planes[5][3]=m[15]+m[14];
  for(let i=0;i<6;i++){
    const p=planes[i], len=Math.sqrt(p[0]*p[0]+p[1]*p[1]+p[2]*p[2]);
    p[0]/=len; p[1]/=len; p[2]/=len; p[3]/=len;
  }
  return frustum;
}
function pointInFrustum(frustum, x, y, z){
  for(let i=0;i<6;i++){
    const p=frustum.planes[i];
    if(p[0]*x+p[1]*y+p[2]*z+p[3] < 0) return false;
  }
  return true;
}
function sphereInFrustum(frustum, center, radius){
  for(let i=0;i<6;i++){
    const p=frustum.planes[i];
    if(p[0]*center[0]+p[1]*center[1]+p[2]*center[2]+p[3] < -radius) return false;
  }
  return true;
}
function aabbInFrustum(frustum, min, max){
  for(let i=0;i<6;i++){
    const p=frustum.planes[i];
    const vx=p[0]>0?max[0]:min[0], vy=p[1]>0?max[1]:min[1], vz=p[2]>0?max[2]:min[2];
    if(p[0]*vx+p[1]*vy+p[2]*vz+p[3] < 0) return false;
  }
  return true;
}
function createFrustumCuller(){
  return {
    frustum: createFrustum(),
    _culled: 0,
    _total: 0,
    update: function(viewProjMatrix){ extractFrustumFromMatrix(this.frustum, viewProjMatrix); this._culled=0; this._total=0; },
    testSphere: function(center, radius){ this._total++; if(!sphereInFrustum(this.frustum, center, radius)){ this._culled++; return false; } return true; },
    testAABB: function(min, max){ this._total++; if(!aabbInFrustum(this.frustum, min, max)){ this._culled++; return false; } return true; },
    testPoint: function(x,y,z){ this._total++; if(!pointInFrustum(this.frustum,x,y,z)){ this._culled++; return false; } return true; },
    getStats: function(){ return { culled: this._culled, total: this._total, rate: this._total>0 ? (this._culled/this._total*100).toFixed(1)+'%' : '0%' }; },
  };
}

/* ===== 八叉树空间分区 ===== */
function createOctree(min, max, maxDepth, maxObjects){
  return {
    min: min ? min.slice() : [-Infinity,-Infinity,-Infinity],
    max: max ? max.slice() : [Infinity,Infinity,Infinity],
    maxDepth: maxDepth || 8,
    maxObjects: maxObjects || 8,
    depth: 0,
    objects: [],
    children: null,
    _objectCount: 0,
  };
}
function octreeGetCenter(node){ return [(node.min[0]+node.max[0])/2, (node.min[1]+node.max[1])/2, (node.min[2]+node.max[2])/2]; }
function octreeContains(node, min, max){
  return min[0]>=node.min[0] && max[0]<=node.max[0] &&
         min[1]>=node.min[1] && max[1]<=node.max[1] &&
         min[2]>=node.min[2] && max[2]<=node.max[2];
}
function octreeIntersects(node, min, max){
  return min[0]<=node.max[0] && max[0]>=node.min[0] &&
         min[1]<=node.max[1] && max[1]>=node.min[1] &&
         min[2]<=node.max[2] && max[2]>=node.min[2];
}
function octreeSubdivide(node){
  const center = octreeGetCenter(node);
  node.children = [];
  for(let i=0;i<8;i++){
    const min = [
      (i&1)?center[0]:node.min[0],
      (i&2)?center[1]:node.min[1],
      (i&4)?center[2]:node.min[2],
    ];
    const max = [
      (i&1)?node.max[0]:center[0],
      (i&2)?node.max[1]:center[1],
      (i&4)?node.max[2]:center[2],
    ];
    const child = createOctree(min, max, node.maxDepth, node.maxObjects);
    child.depth = node.depth + 1;
    node.children.push(child);
  }
}
function octreeInsert(node, object, min, max){
  if(!octreeContains(node, min, max)){
    if(node.depth === 0){
      node.objects.push({object, min, max});
      node._objectCount++;
      return true;
    }
    return false;
  }
  if(node.children){
    for(const child of node.children){
      if(octreeInsert(child, object, min, max)) return true;
    }
  }
  node.objects.push({object, min, max});
  node._objectCount++;
  if(!node.children && node.objects.length > node.maxObjects && node.depth < node.maxDepth){
    octreeSubdivide(node);
    const oldObjects = node.objects;
    node.objects = [];
    for(const obj of oldObjects) octreeInsert(node, obj.object, obj.min, obj.max);
  }
  return true;
}
function octreeQuery(node, min, max, results){
  results = results || [];
  if(!octreeIntersects(node, min, max)) return results;
  for(const obj of node.objects){
    if(obj.min[0]<=max[0] && obj.max[0]>=min[0] &&
       obj.min[1]<=max[1] && obj.max[1]>=min[1] &&
       obj.min[2]<=max[2] && obj.max[2]>=min[2]){
      results.push(obj.object);
    }
  }
  if(node.children){
    for(const child of node.children) octreeQuery(child, min, max, results);
  }
  return results;
}
function octreeQuerySphere(node, center, radius, results){
  results = results || [];
  const min=[center[0]-radius,center[1]-radius,center[2]-radius];
  const max=[center[0]+radius,center[1]+radius,center[2]+radius];
  if(!octreeIntersects(node, min, max)) return results;
  for(const obj of node.objects){
    const cx=Math.max(obj.min[0],Math.min(center[0],obj.max[0]));
    const cy=Math.max(obj.min[1],Math.min(center[1],obj.max[1]));
    const cz=Math.max(obj.min[2],Math.min(center[2],obj.max[2]));
    const dx=center[0]-cx, dy=center[1]-cy, dz=center[2]-cz;
    if(dx*dx+dy*dy+dz*dz <= radius*radius) results.push(obj.object);
  }
  if(node.children){
    for(const child of node.children) octreeQuerySphere(child, center, radius, results);
  }
  return results;
}
function octreeClear(node){
  node.objects = [];
  node.children = null;
  node._objectCount = 0;
}
function octreeGetAllObjects(node, results){
  results = results || [];
  for(const obj of node.objects) results.push(obj.object);
  if(node.children) for(const child of node.children) octreeGetAllObjects(child, results);
  return results;
}

/* ===== 网格优化系统 ===== */
function computeMeshBounds(geometry){
  const pos = geometry.positions;
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(let i=0;i<pos.length;i+=3){
    minX=Math.min(minX,pos[i]); minY=Math.min(minY,pos[i+1]); minZ=Math.min(minZ,pos[i+2]);
    maxX=Math.max(maxX,pos[i]); maxY=Math.max(maxY,pos[i+1]); maxZ=Math.max(maxZ,pos[i+2]);
  }
  return { min:[minX,minY,minZ], max:[maxX,maxY,maxZ], center:[(minX+maxX)/2,(minY+maxY)/2,(minZ+maxZ)/2], size:[maxX-minX,maxY-minY,maxZ-minZ] };
}
function computeMeshBoundingSphere(geometry){
  const bounds = computeMeshBounds(geometry);
  const center = bounds.center;
  let maxDist = 0;
  const pos = geometry.positions;
  for(let i=0;i<pos.length;i+=3){
    const dx=pos[i]-center[0], dy=pos[i+1]-center[1], dz=pos[i+2]-center[2];
    maxDist = Math.max(maxDist, dx*dx+dy*dy+dz*dz);
  }
  return { center, radius: Math.sqrt(maxDist) };
}
function mergeVertices(geometry, tolerance){
  const tol = tolerance || 0.0001;
  const pos = geometry.positions, normals = geometry.normals, uvs = geometry.uvs;
  const indices = geometry.indices;
  const newPositions = [], newNormals = [], newUVs = [], newIndices = [];
  const vertexMap = new Map();
  function hashVertex(i){
    const x=Math.round(pos[i*3]/tol), y=Math.round(pos[i*3+1]/tol), z=Math.round(pos[i*3+2]/tol);
    const nx=normals?Math.round(normals[i*3]/tol):0, ny=normals?Math.round(normals[i*3+1]/tol):0, nz=normals?Math.round(normals[i*3+2]/tol):0;
    const u=uvs?Math.round(uvs[i*2]/tol):0, v=uvs?Math.round(uvs[i*2+1]/tol):0;
    return x+','+y+','+z+','+nx+','+ny+','+nz+','+u+','+v;
  }
  for(let i=0;i<indices.length;i++){
    const idx = indices[i];
    const hash = hashVertex(idx);
    if(vertexMap.has(hash)){
      newIndices.push(vertexMap.get(hash));
    } else {
      const newIdx = newPositions.length/3;
      vertexMap.set(hash, newIdx);
      newPositions.push(pos[idx*3], pos[idx*3+1], pos[idx*3+2]);
      if(normals) newNormals.push(normals[idx*3], normals[idx*3+1], normals[idx*3+2]);
      if(uvs) newUVs.push(uvs[idx*2], uvs[idx*2+1]);
      newIndices.push(newIdx);
    }
  }
  return {
    positions: new Float32Array(newPositions),
    normals: normals ? new Float32Array(newNormals) : null,
    uvs: uvs ? new Float32Array(newUVs) : null,
    indices: new Uint32Array(newIndices),
    vertexCount: newPositions.length/3,
    indexCount: newIndices.length,
  };
}
function computeVertexNormals(geometry){
  const pos = geometry.positions, indices = geometry.indices;
  const normals = new Float32Array(pos.length);
  for(let i=0;i<indices.length;i+=3){
    const ia=indices[i]*3, ib=indices[i+1]*3, ic=indices[i+2]*3;
    const ax=pos[ib]-pos[ia], ay=pos[ib+1]-pos[ia+1], az=pos[ib+2]-pos[ia+2];
    const bx=pos[ic]-pos[ia], by=pos[ic+1]-pos[ia+1], bz=pos[ic+2]-pos[ia+2];
    const nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx;
    normals[ia]+=nx; normals[ia+1]+=ny; normals[ia+2]+=nz;
    normals[ib]+=nx; normals[ib+1]+=ny; normals[ib+2]+=nz;
    normals[ic]+=nx; normals[ic+1]+=ny; normals[ic+2]+=nz;
  }
  for(let i=0;i<normals.length;i+=3){
    const l=Math.sqrt(normals[i]**2+normals[i+1]**2+normals[i+2]**2)||1;
    normals[i]/=l; normals[i+1]/=l; normals[i+2]/=l;
  }
  geometry.normals = normals;
  return geometry;
}
function computeTangents(geometry){
  const pos = geometry.positions, normals = geometry.normals, uvs = geometry.uvs, indices = geometry.indices;
  if(!uvs) return geometry;
  const tangents = new Float32Array(pos.length/3*4);
  const tan1 = new Float32Array(pos.length), tan2 = new Float32Array(pos.length);
  for(let i=0;i<indices.length;i+=3){
    const ia=indices[i], ib=indices[i+1], ic=indices[i+2];
    const x1=pos[ib*3]-pos[ia*3], y1=pos[ib*3+1]-pos[ia*3+1], z1=pos[ib*3+2]-pos[ia*3+2];
    const x2=pos[ic*3]-pos[ia*3], y2=pos[ic*3+1]-pos[ia*3+1], z2=pos[ic*3+2]-pos[ia*3+2];
    const s1=uvs[ib*2]-uvs[ia*2], t1=uvs[ib*2+1]-uvs[ia*2+1];
    const s2=uvs[ic*2]-uvs[ia*2], t2=uvs[ic*2+1]-uvs[ia*2+1];
    const r=1/(s1*t2-s2*t1);
    const sx=(t2*x1-t1*x2)*r, sy=(t2*y1-t1*y2)*r, sz=(t2*z1-t1*z2)*r;
    const tx=(s1*x2-s2*x1)*r, ty=(s1*y2-s2*y1)*r, tz=(s1*z2-s2*z1)*r;
    tan1[ia*3]+=sx; tan1[ia*3+1]+=sy; tan1[ia*3+2]+=sz;
    tan1[ib*3]+=sx; tan1[ib*3+1]+=sy; tan1[ib*3+2]+=sz;
    tan1[ic*3]+=sx; tan1[ic*3+1]+=sy; tan1[ic*3+2]+=sz;
    tan2[ia*3]+=tx; tan2[ia*3+1]+=ty; tan2[ia*3+2]+=tz;
    tan2[ib*3]+=tx; tan2[ib*3+1]+=ty; tan2[ib*3+2]+=tz;
    tan2[ic*3]+=tx; tan2[ic*3+1]+=ty; tan2[ic*3+2]+=tz;
  }
  for(let i=0;i<pos.length/3;i++){
    const n=[normals[i*3],normals[i*3+1],normals[i*3+2]];
    const t=[tan1[i*3],tan1[i*3+1],tan1[i*3+2]];
    const dot=n[0]*t[0]+n[1]*t[1]+n[2]*t[2];
    const tangent=[t[0]-n[0]*dot, t[1]-n[1]*dot, t[2]-n[2]*dot];
    const tl=Math.sqrt(tangent[0]**2+tangent[1]**2+tangent[2]**2)||1;
    tangent[0]/=tl; tangent[1]/=tl; tangent[2]/=tl;
    const b=[n[1]*t[2]-n[2]*t[1], n[2]*t[0]-n[0]*t[2], n[0]*t[1]-n[1]*t[0]];
    const hand = (b[0]*tan2[i*3]+b[1]*tan2[i*3+1]+b[2]*tan2[i*3+2]) < 0 ? -1 : 1;
    tangents[i*4]=tangent[0]; tangents[i*4+1]=tangent[1]; tangents[i*4+2]=tangent[2]; tangents[i*4+3]=hand;
  }
  geometry.tangents = tangents;
  return geometry;
}
function simplifyMesh(geometry, targetRatio){
  const ratio = targetRatio || 0.5;
  const targetCount = Math.floor(geometry.indexCount * ratio / 3) * 3;
  if(targetCount >= geometry.indexCount) return geometry;
  const pos = geometry.positions, indices = geometry.indices;
  const errors = [];
  for(let i=0;i<indices.length;i+=3){
    const ia=indices[i]*3, ib=indices[i+1]*3, ic=indices[i+2]*3;
    const area = Math.abs((pos[ib]-pos[ia])*(pos[ic+1]-pos[ia+1])-(pos[ib+1]-pos[ia+1])*(pos[ic]-pos[ia]))*0.5;
    errors.push({index:i, area:area});
  }
  errors.sort((a,b)=>a.area-b.area);
  const removeCount = (geometry.indexCount - targetCount) / 3;
  const removeSet = new Set();
  for(let i=0;i<removeCount && i<errors.length;i++) removeSet.add(errors[i].index);
  const newIndices = [];
  for(let i=0;i<indices.length;i+=3){
    if(!removeSet.has(i)) newIndices.push(indices[i], indices[i+1], indices[i+2]);
  }
  return {
    positions: geometry.positions,
    normals: geometry.normals,
    uvs: geometry.uvs,
    indices: new Uint32Array(newIndices),
    vertexCount: geometry.vertexCount,
    indexCount: newIndices.length,
  };
}