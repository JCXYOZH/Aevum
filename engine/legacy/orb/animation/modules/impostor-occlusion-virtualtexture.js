/* ===== Impostor 系统 =====
   支持: 广告牌LOD / 八面体映射 / 距离切换 / 预渲染
*/
function createImpostorSystem(gl, options){
  const sys = {
    gl: gl,
    impostors: [],
    _program: null,
    _vbo: null,
    _initialized: false,
    _views: 8,
    _angles: []
  };

  function init(){
    const gl = sys.gl;
    const vs = `
      attribute vec3 aPosition;
      attribute vec2 aUV;
      attribute float aViewIndex;
      uniform mat4 uViewProj;
      uniform vec3 uCameraRight;
      uniform vec3 uCameraUp;
      uniform float uViewCount;
      varying vec2 vUV;
      varying float vView;
      void main(){
        float angle = aViewIndex / uViewCount * 6.28318;
        vec3 right = vec3(cos(angle), 0.0, sin(angle));
        vec3 up = vec3(0.0, 1.0, 0.0);
        vec3 worldPos = aPosition + right * aUV.x * 2.0 + up * aUV.y * 2.0;
        vUV = aUV;
        vView = aViewIndex;
        gl_Position = uViewProj * vec4(worldPos, 1.0);
      }
    `;
    const fs = `
      precision mediump float;
      uniform sampler2D uImpostorTexture;
      uniform float uViewCount;
      uniform float uTextureWidth;
      varying vec2 vUV;
      varying float vView;
      void main(){
        float viewX = mod(vView, 4.0);
        float viewY = floor(vView / 4.0);
        vec2 uv = vec2((viewX + vUV.x) / 4.0, (viewY + vUV.y) / 2.0);
        vec4 color = texture2D(uImpostorTexture, uv);
        if(color.a < 0.1) discard;
        gl_FragColor = color;
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    sys._program = gl.createProgram();
    gl.attachShader(sys._program, vsh);
    gl.attachShader(sys._program, fsh);
    gl.linkProgram(sys._program);

    sys._vbo = gl.createBuffer();
    sys._initialized = true;
  }

  function createImpostor(mesh, position, size, options){
    const imp = {
      mesh: mesh,
      position: [position[0], position[1], position[2]],
      size: size || 1,
      distance: (options && options.distance) || 50,
      texture: null,
      textureWidth: 256,
      textureHeight: 128,
      views: sys._views,
      _dirty: true
    };
    sys.impostors.push(imp);
    return imp;
  }

  function renderImpostor(imp, viewProj, cameraPosition, cameraRight, cameraUp){
    if(!sys._initialized) return;
    const gl = sys.gl;
    const dist = V3.dist(imp.position, cameraPosition);
    if(dist < imp.distance) return;

    const angle = Math.atan2(cameraPosition[0] - imp.position[0], cameraPosition[2] - imp.position[2]);
    const viewIndex = Math.floor(((angle / (Math.PI * 2) + 0.5) * imp.views) % imp.views);

    const verts = new Float32Array([
      imp.position[0], imp.position[1], imp.position[2], 0, 0, viewIndex,
      imp.position[0], imp.position[1], imp.position[2], 1, 0, viewIndex,
      imp.position[0], imp.position[1], imp.position[2], 1, 1, viewIndex,
      imp.position[0], imp.position[1], imp.position[2], 0, 1, viewIndex
    ]);

    gl.useProgram(sys._program);
    gl.uniformMatrix4fv(gl.getUniformLocation(sys._program, 'uViewProj'), false, viewProj);
    gl.uniform3fv(gl.getUniformLocation(sys._program, 'uCameraRight'), cameraRight);
    gl.uniform3fv(gl.getUniformLocation(sys._program, 'uCameraUp'), cameraUp);
    gl.uniform1f(gl.getUniformLocation(sys._program, 'uViewCount'), imp.views);
    gl.uniform1f(gl.getUniformLocation(sys._program, 'uTextureWidth'), imp.textureWidth);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, imp.texture);
    gl.uniform1i(gl.getUniformLocation(sys._program, 'uImpostorTexture'), 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, sys._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    const posLoc = gl.getAttribLocation(sys._program, 'aPosition');
    const uvLoc = gl.getAttribLocation(sys._program, 'aUV');
    const viewLoc = gl.getAttribLocation(sys._program, 'aViewIndex');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(viewLoc);
    gl.vertexAttribPointer(viewLoc, 1, gl.FLOAT, false, 24, 20);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
  }

  function renderAll(viewProj, cameraPosition, cameraRight, cameraUp){
    for(let i = 0; i < sys.impostors.length; i++){
      renderImpostor(sys.impostors[i], viewProj, cameraPosition, cameraRight, cameraUp);
    }
  }

  function removeImpostor(imp){
    const idx = sys.impostors.indexOf(imp);
    if(idx >= 0) sys.impostors.splice(idx, 1);
  }

  function clear(){
    sys.impostors = [];
  }

  function dispose(){
    const gl = sys.gl;
    if(sys._vbo) gl.deleteBuffer(sys._vbo);
    if(sys._program) gl.deleteProgram(sys._program);
    for(let i = 0; i < sys.impostors.length; i++){
      if(sys.impostors[i].texture) gl.deleteTexture(sys.impostors[i].texture);
    }
  }

  return { init, createImpostor, renderImpostor, renderAll, removeImpostor, clear, dispose, sys };
}

/* ===== 遮挡剔除系统 =====
   支持: 软件光栅化深度缓冲 / 层级遮挡 / 保守剔除
*/
function createOcclusionCuller(options){
  const culler = {
    width: (options && options.width) || 256,
    height: (options && options.height) || 256,
    _depthBuffer: null,
    _hierarchy: [],
    _hierarchyLevels: 4,
    _camera: null
  };

  function init(){
    culler._depthBuffer = new Float32Array(culler.width * culler.height);
    for(let i = 0; i < culler._hierarchyLevels; i++){
      const w = Math.max(1, culler.width >> i);
      const h = Math.max(1, culler.height >> i);
      culler._hierarchy.push(new Float32Array(w * h));
    }
    clear();
  }

  function clear(){
    for(let i = 0; i < culler._depthBuffer.length; i++){
      culler._depthBuffer[i] = 1;
    }
    for(let l = 0; l < culler._hierarchyLevels; l++){
      for(let i = 0; i < culler._hierarchy[l].length; i++){
        culler._hierarchy[l][i] = 1;
      }
    }
  }

  function setCamera(viewProj, position){
    culler._camera = { viewProj: viewProj, position: position };
  }

  function projectPoint(point, viewProj){
    const x = viewProj[0]*point[0] + viewProj[4]*point[1] + viewProj[8]*point[2] + viewProj[12];
    const y = viewProj[1]*point[0] + viewProj[5]*point[1] + viewProj[9]*point[2] + viewProj[13];
    const z = viewProj[2]*point[0] + viewProj[6]*point[1] + viewProj[10]*point[2] + viewProj[14];
    const w = viewProj[3]*point[0] + viewProj[7]*point[1] + viewProj[11]*point[2] + viewProj[15];
    if(w <= 0) return null;
    return { x: (x/w + 1) * 0.5 * culler.width, y: (y/w + 1) * 0.5 * culler.height, z: z/w };
  }

  function addOccluder(vertices, indices, viewProj){
    for(let i = 0; i < indices.length; i += 3){
      const v0 = vertices[indices[i]];
      const v1 = vertices[indices[i+1]];
      const v2 = vertices[indices[i+2]];
      const p0 = projectPoint(v0, viewProj);
      const p1 = projectPoint(v1, viewProj);
      const p2 = projectPoint(v2, viewProj);
      if(!p0 || !p1 || !p2) continue;
      rasterizeTriangle(p0, p1, p2);
    }
    buildHierarchy();
  }

  function rasterizeTriangle(p0, p1, p2){
    const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)));
    const maxX = Math.min(culler.width - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
    const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)));
    const maxY = Math.min(culler.height - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));
    const area = (p1.x-p0.x)*(p2.y-p0.y) - (p1.y-p0.y)*(p2.x-p0.x);
    if(Math.abs(area) < 0.001) return;
    for(let y = minY; y <= maxY; y++){
      for(let x = minX; x <= maxX; x++){
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((p1.x-px)*(p2.y-py) - (p1.y-py)*(p2.x-px)) / area;
        const w1 = ((p2.x-px)*(p0.y-py) - (p2.y-py)*(p0.x-px)) / area;
        const w2 = 1 - w0 - w1;
        if(w0 >= 0 && w1 >= 0 && w2 >= 0){
          const z = w0 * p0.z + w1 * p1.z + w2 * p2.z;
          const idx = y * culler.width + x;
          if(z < culler._depthBuffer[idx]){
            culler._depthBuffer[idx] = z;
          }
        }
      }
    }
  }

  function buildHierarchy(){
    for(let l = 1; l < culler._hierarchyLevels; l++){
      const prev = culler._hierarchy[l-1];
      const curr = culler._hierarchy[l];
      const pw = Math.max(1, culler.width >> (l-1));
      const ph = Math.max(1, culler.height >> (l-1));
      const cw = Math.max(1, culler.width >> l);
      const ch = Math.max(1, culler.height >> l);
      for(let y = 0; y < ch; y++){
        for(let x = 0; x < cw; x++){
          let minDepth = 1;
          for(let dy = 0; dy < 2; dy++){
            for(let dx = 0; dx < 2; dx++){
              const px = x*2+dx, py = y*2+dy;
              if(px < pw && py < ph){
                const d = prev[py*pw+px];
                if(d < minDepth) minDepth = d;
              }
            }
          }
          curr[y*cw+x] = minDepth;
        }
      }
    }
  }

  function isOccluded(boundingBox, viewProj){
    const corners = AABB.corners(boundingBox);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, minZ = Infinity;
    for(let i = 0; i < corners.length; i++){
      const p = projectPoint(corners[i], viewProj);
      if(!p) return false;
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      minZ = Math.min(minZ, p.z);
    }
    if(maxX < 0 || minX >= culler.width || maxY < 0 || minY >= culler.height) return false;
    const level = Math.floor(Math.log2(Math.max((maxX-minX), (maxY-minY)) / 4));
    const l = Math.max(0, Math.min(culler._hierarchyLevels - 1, level));
    const hw = Math.max(1, culler.width >> l);
    const hh = Math.max(1, culler.height >> l);
    const sx = Math.max(0, Math.floor(minX / (1 << l)));
    const sy = Math.max(0, Math.floor(minY / (1 << l)));
    const ex = Math.min(hw - 1, Math.ceil(maxX / (1 << l)));
    const ey = Math.min(hh - 1, Math.ceil(maxY / (1 << l)));
    for(let y = sy; y <= ey; y++){
      for(let x = sx; x <= ex; x++){
        if(culler._hierarchy[l][y*hw+x] > minZ) return false;
      }
    }
    return true;
  }

  function getDepthBuffer(){
    return culler._depthBuffer;
  }

  function toImageData(){
    const img = new ImageData(culler.width, culler.height);
    for(let i = 0; i < culler.width * culler.height; i++){
      const d = Math.max(0, Math.min(1, culler._depthBuffer[i]));
      const v = (1 - d) * 255;
      img.data[i*4] = v; img.data[i*4+1] = v; img.data[i*4+2] = v; img.data[i*4+3] = 255;
    }
    return img;
  }

  return { init, clear, setCamera, addOccluder, isOccluded, getDepthBuffer, toImageData, culler };
}



/* ===== 虚拟纹理系统 =====
   支持: 瓦片化纹理 / 按需加载 / mipmap链 / 页表管理
*/
function createVirtualTexture(gl, options){
  const vt = {
    gl: gl,
    virtualWidth: (options && options.virtualWidth) || 8192,
    virtualHeight: (options && options.virtualHeight) || 8192,
    tileSize: (options && options.tileSize) || 256,
    maxAnisotropy: (options && options.maxAnisotropy) || 4,
    _pageTable: null,
    _physicalTexture: null,
    _physicalWidth: 0,
    _physicalHeight: 0,
    _pages: {},
    _pageQueue: [],
    _maxPages: (options && options.maxPages) || 1024,
    _cacheHits: 0,
    _cacheMisses: 0,
    _mipLevels: 0,
    _tileDataProvider: null
  };

  function init(){
    vt._mipLevels = Math.floor(Math.log2(Math.max(vt.virtualWidth, vt.virtualHeight) / vt.tileSize)) + 1;
    const tilesX = Math.ceil(vt.virtualWidth / vt.tileSize);
    const tilesY = Math.ceil(vt.virtualHeight / vt.tileSize);
    vt._pageTable = new Int32Array(tilesX * tilesY * vt._mipLevels);
    for(let i = 0; i < vt._pageTable.length; i++) vt._pageTable[i] = -1;

    const physTilesX = Math.min(32, tilesX);
    const physTilesY = Math.min(32, tilesY);
    vt._physicalWidth = physTilesX * vt.tileSize;
    vt._physicalHeight = physTilesY * vt.tileSize;

    const gl = vt.gl;
    vt._physicalTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, vt._physicalTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, vt._physicalWidth, vt._physicalHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  function setTileDataProvider(provider){
    vt._tileDataProvider = provider;
  }

  function getPageKey(mip, tileX, tileY){
    return mip + '_' + tileX + '_' + tileY;
  }

  function requestTile(mip, tileX, tileY){
    const key = getPageKey(mip, tileX, tileY);
    if(vt._pages[key] !== undefined){
      vt._cacheHits++;
      return vt._pages[key];
    }
    vt._cacheMisses++;
    if(vt._pageQueue.length < vt._maxPages){
      vt._pageQueue.push({ mip: mip, x: tileX, y: tileY, key: key, priority: mip });
    }
    return -1;
  }

  function uploadTile(mip, tileX, tileY, data){
    const gl = vt.gl;
    const key = getPageKey(mip, tileX, tileY);
    const tilesX = Math.ceil(vt.virtualWidth / vt.tileSize);
    const pageIdx = (mip * tilesX * Math.ceil(vt.virtualHeight / vt.tileSize)) + tileY * tilesX + tileX;

    let physSlot = vt._pages[key];
    if(physSlot === undefined){
      physSlot = Object.keys(vt._pages).length % (vt._physicalWidth / vt.tileSize * vt._physicalHeight / vt.tileSize);
      vt._pages[key] = physSlot;
      vt._pageTable[pageIdx] = physSlot;
    }

    const physTilesX = vt._physicalWidth / vt.tileSize;
    const px = (physSlot % physTilesX) * vt.tileSize;
    const py = Math.floor(physSlot / physTilesX) * vt.tileSize;

    gl.bindTexture(gl.TEXTURE_2D, vt._physicalTexture);
    if(data instanceof HTMLCanvasElement || data instanceof HTMLImageElement){
      gl.texSubImage2D(gl.TEXTURE_2D, 0, px, py, gl.RGBA, gl.UNSIGNED_BYTE, data);
    } else if(data instanceof Uint8Array){
      gl.texSubImage2D(gl.TEXTURE_2D, 0, px, py, vt.tileSize, vt.tileSize, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
    gl.generateMipmap(gl.TEXTURE_2D);
    return physSlot;
  }

  function processQueue(maxPerFrame){
    maxPerFrame = maxPerFrame || 4;
    vt._pageQueue.sort(function(a, b){ return a.priority - b.priority; });
    const processed = [];
    for(let i = 0; i < Math.min(maxPerFrame, vt._pageQueue.length); i++){
      const req = vt._pageQueue[i];
      if(vt._tileDataProvider){
        const data = vt._tileDataProvider(req.mip, req.x, req.y);
        if(data){
          uploadTile(req.mip, req.x, req.y, data);
          processed.push(req);
        }
      }
    }
    for(let i = 0; i < processed.length; i++){
      const idx = vt._pageQueue.indexOf(processed[i]);
      if(idx >= 0) vt._pageQueue.splice(idx, 1);
    }
    return processed.length;
  }

  function sampleUV(uv, mipBias){
    const mip = Math.max(0, Math.min(vt._mipLevels - 1, Math.floor(mipBias || 0)));
    const tilesX = Math.ceil(vt.virtualWidth / vt.tileSize);
    const tilesY = Math.ceil(vt.virtualHeight / vt.tileSize);
    const tileX = Math.min(tilesX - 1, Math.floor(uv[0] * tilesX));
    const tileY = Math.min(tilesY - 1, Math.floor(uv[1] * tilesY));
    const pageIdx = (mip * tilesX * tilesY) + tileY * tilesX + tileX;
    const physSlot = vt._pageTable[pageIdx];
    if(physSlot < 0){
      requestTile(mip, tileX, tileY);
      return { uv: [0.5, 0.5], valid: false };
    }
    const physTilesX = vt._physicalWidth / vt.tileSize;
    const px = (physSlot % physTilesX) * vt.tileSize;
    const py = Math.floor(physSlot / physTilesX) * vt.tileSize;
    const localU = (uv[0] * tilesX - tileX) * vt.tileSize;
    const localV = (uv[1] * tilesY - tileY) * vt.tileSize;
    return {
      uv: [(px + localU) / vt._physicalWidth, (py + localV) / vt._physicalHeight],
      valid: true
    };
  }

  function getPhysicalTexture(){
    return vt._physicalTexture;
  }

  function getStats(){
    return {
      cacheHits: vt._cacheHits,
      cacheMisses: vt._cacheMisses,
      loadedPages: Object.keys(vt._pages).length,
      pendingRequests: vt._pageQueue.length,
      hitRate: vt._cacheHits / (vt._cacheHits + vt._cacheMisses || 1)
    };
  }

  function clearCache(){
    vt._pages = {};
    vt._pageQueue = [];
    for(let i = 0; i < vt._pageTable.length; i++) vt._pageTable[i] = -1;
    vt._cacheHits = 0;
    vt._cacheMisses = 0;
  }

  function dispose(){
    const gl = vt.gl;
    if(vt._physicalTexture) gl.deleteTexture(vt._physicalTexture);
  }

  return { init, setTileDataProvider, requestTile, uploadTile, processQueue, sampleUV, getPhysicalTexture, getStats, clearCache, dispose, vt };
}
