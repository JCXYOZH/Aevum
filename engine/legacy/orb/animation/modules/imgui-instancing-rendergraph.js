/* ===== 即时模式UI系统 =====
   支持: 按钮 / 滑块 / 复选框 / 文本输入 / 面板 / 标签
*/
function createImGui(gl, options){
  const ui = {
    gl: gl,
    _drawList: [],
    _vertexBuffer: null,
    _indexBuffer: null,
    _program: null,
    _initialized: false,
    _maxVerts: (options && options.maxVerts) || 65536,
    _input: { mouseX: 0, mouseY: 0, mouseDown: false, mousePressed: false, mouseReleased: false, keys: {} },
    _hotItem: null,
    _activeItem: null,
    _currentX: 10,
    _currentY: 10,
    _currentWidth: 200,
    _itemHeight: 28,
    _spacing: 4,
    _fontRenderer: null,
    _style: {
      bgColor: [0.15, 0.15, 0.18, 0.95],
      borderColor: [0.3, 0.3, 0.35, 1],
      textColor: [0.9, 0.9, 0.9, 1],
      buttonColor: [0.25, 0.45, 0.75, 1],
      buttonHoverColor: [0.35, 0.55, 0.85, 1],
      buttonActiveColor: [0.2, 0.35, 0.65, 1],
      sliderColor: [0.3, 0.5, 0.8, 1],
      sliderTrackColor: [0.2, 0.2, 0.25, 1],
      checkColor: [0.3, 0.5, 0.8, 1],
      inputBgColor: [0.1, 0.1, 0.12, 1],
      panelBgColor: [0.12, 0.12, 0.15, 0.92]
    }
  };

  function init(fontRenderer){
    const gl = ui.gl;
    ui._fontRenderer = fontRenderer;
    const vs = `
      attribute vec2 aPosition;
      attribute vec4 aColor;
      attribute vec2 aUV;
      uniform vec2 uResolution;
      varying vec4 vColor;
      varying vec2 vUV;
      void main(){
        vec2 pos = aPosition / uResolution * 2.0 - 1.0;
        pos.y = -pos.y;
        gl_Position = vec4(pos, 0.0, 1.0);
        vColor = aColor;
        vUV = aUV;
      }
    `;
    const fs = `
      precision mediump float;
      uniform sampler2D uTexture;
      uniform float uUseTexture;
      varying vec4 vColor;
      varying vec2 vUV;
      void main(){
        if(uUseTexture > 0.5){
          vec4 tex = texture2D(uTexture, vUV);
          gl_FragColor = vColor * tex;
        } else {
          gl_FragColor = vColor;
        }
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    ui._program = gl.createProgram();
    gl.attachShader(ui._program, vsh);
    gl.attachShader(ui._program, fsh);
    gl.linkProgram(ui._program);

    ui._vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ui._vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, ui._maxVerts * 8 * 4, gl.DYNAMIC_DRAW);
    ui._initialized = true;
  }

  function setInput(mouseX, mouseY, mouseDown, mousePressed, mouseReleased){
    ui._input.mouseX = mouseX;
    ui._input.mouseY = mouseY;
    ui._input.mouseDown = mouseDown;
    ui._input.mousePressed = mousePressed;
    ui._input.mouseReleased = mouseReleased;
  }

  function beginFrame(){
    ui._drawList = [];
    ui._currentX = 10;
    ui._currentY = 10;
  }

  function setCursor(x, y){
    ui._currentX = x;
    ui._currentY = y;
  }

  function setWidth(w){
    ui._currentWidth = w;
  }

  function addRect(x, y, w, h, color, borderColor, borderRadius){
    ui._drawList.push({ type: 'rect', x, y, w, h, color, borderColor, borderRadius: borderRadius || 0 });
  }

  function addText(text, x, y, fontSize, color){
    ui._drawList.push({ type: 'text', text, x, y, fontSize, color });
  }

  function isMouseOver(x, y, w, h){
    return ui._input.mouseX >= x && ui._input.mouseX <= x + w &&
           ui._input.mouseY >= y && ui._input.mouseY <= y + h;
  }

  function button(label, id){
    const x = ui._currentX, y = ui._currentY, w = ui._currentWidth, h = ui._itemHeight;
    const hovered = isMouseOver(x, y, w, h);
    const pressed = hovered && ui._input.mouseDown;
    let color = ui._style.buttonColor;
    if(pressed) color = ui._style.buttonActiveColor;
    else if(hovered) color = ui._style.buttonHoverColor;

    addRect(x, y, w, h, color, ui._style.borderColor, 4);
    if(ui._fontRenderer){
      const tm = ui._fontRenderer.measureText(label, 14);
      addText(label, x + (w - tm.width) / 2, y + (h - 14) / 2, 14, ui._style.textColor);
    }
    ui._currentY += h + ui._spacing;
    return hovered && ui._input.mouseReleased;
  }

  function slider(label, value, min, max, id){
    const x = ui._currentX, y = ui._currentY, w = ui._currentWidth, h = ui._itemHeight;
    const trackY = y + h - 8;
    const trackH = 6;
    const knobW = 14;
    const ratio = (value - min) / (max - min);
    const knobX = x + ratio * (w - knobW);

    addRect(x, trackY, w, trackH, ui._style.sliderTrackColor, null, 3);
    addRect(knobX, trackY - 3, knobW, trackH + 6, ui._style.sliderColor, null, 3);

    if(ui._fontRenderer){
      addText(label + ': ' + value.toFixed(2), x, y, 12, ui._style.textColor);
    }

    const hovered = isMouseOver(x, y, w, h);
    if(hovered && ui._input.mouseDown){
      const newRatio = Math.max(0, Math.min(1, (ui._input.mouseX - x) / (w - knobW)));
      value = min + newRatio * (max - min);
    }
    ui._currentY += h + ui._spacing;
    return value;
  }

  function checkbox(label, checked, id){
    const x = ui._currentX, y = ui._currentY, w = ui._currentWidth, h = ui._itemHeight;
    const boxSize = 18;
    const boxX = x, boxY = y + (h - boxSize) / 2;
    const hovered = isMouseOver(x, y, w, h);

    addRect(boxX, boxY, boxSize, boxSize, checked ? ui._style.checkColor : ui._style.inputBgColor, ui._style.borderColor, 3);
    if(checked && ui._fontRenderer){
      addText('✓', boxX + 2, boxY, 14, [1,1,1,1]);
    }
    if(ui._fontRenderer){
      addText(label, boxX + boxSize + 8, y + (h - 14) / 2, 14, ui._style.textColor);
    }
    ui._currentY += h + ui._spacing;
    if(hovered && ui._input.mouseReleased) return !checked;
    return checked;
  }

  function label(text){
    const x = ui._currentX, y = ui._currentY, h = ui._itemHeight;
    if(ui._fontRenderer){
      addText(text, x, y + (h - 14) / 2, 14, ui._style.textColor);
    }
    ui._currentY += h + ui._spacing;
  }

  function panel(title, x, y, w, h){
    addRect(x, y, w, h, ui._style.panelBgColor, ui._style.borderColor, 6);
    addRect(x, y, w, 30, ui._style.bgColor, null, 6);
    if(ui._fontRenderer && title){
      addText(title, x + 10, y + 8, 14, ui._style.textColor);
    }
    ui._currentX = x + 10;
    ui._currentY = y + 40;
    ui._currentWidth = w - 20;
  }

  function separator(){
    addRect(ui._currentX, ui._currentY, ui._currentWidth, 1, ui._style.borderColor, null, 0);
    ui._currentY += ui._spacing * 2;
  }

  function endFrame(){
    render();
  }

  function render(){
    if(!ui._initialized || ui._drawList.length === 0) return;
    const gl = ui.gl;
    const vertices = new Float32Array(ui._maxVerts * 8);
    let vi = 0;

    for(let i = 0; i < ui._drawList.length; i++){
      const item = ui._drawList[i];
      if(item.type === 'rect'){
        const c = item.color;
        const verts = [
          item.x, item.y, c[0], c[1], c[2], c[3], 0, 0,
          item.x+item.w, item.y, c[0], c[1], c[2], c[3], 1, 0,
          item.x, item.y+item.h, c[0], c[1], c[2], c[3], 0, 1,
          item.x+item.w, item.y, c[0], c[1], c[2], c[3], 1, 0,
          item.x+item.w, item.y+item.h, c[0], c[1], c[2], c[3], 1, 1,
          item.x, item.y+item.h, c[0], c[1], c[2], c[3], 0, 1
        ];
        for(let v = 0; v < 48; v++) vertices[vi++] = verts[v];
      }
    }

    gl.useProgram(ui._program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.uniform2f(gl.getUniformLocation(ui._program, 'uResolution'), gl.canvas.width, gl.canvas.height);
    gl.uniform1f(gl.getUniformLocation(ui._program, 'uUseTexture'), 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, ui._vertexBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices.subarray(0, vi));
    const posLoc = gl.getAttribLocation(ui._program, 'aPosition');
    const colLoc = gl.getAttribLocation(ui._program, 'aColor');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(colLoc);
    gl.vertexAttribPointer(colLoc, 4, gl.FLOAT, false, 32, 8);
    gl.drawArrays(gl.TRIANGLES, 0, vi / 8);

    for(let i = 0; i < ui._drawList.length; i++){
      const item = ui._drawList[i];
      if(item.type === 'text' && ui._fontRenderer){
        ui._fontRenderer.drawText(item.text, item.x, item.y, item.fontSize, item.color);
      }
    }

    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  function dispose(){
    const gl = ui.gl;
    if(ui._vertexBuffer) gl.deleteBuffer(ui._vertexBuffer);
    if(ui._program) gl.deleteProgram(ui._program);
  }

  return { init, setInput, beginFrame, endFrame, setCursor, setWidth, button, slider, checkbox, label, panel, separator, render, dispose, ui };
}

/* ===== GPU实例化系统 =====
   支持: 硬件实例化 / 实例数据缓冲 / 实例剔除 / 实例LOD
*/
function createInstancedRenderer(gl, options){
  const ir = {
    gl: gl,
    instances: [],
    maxInstances: (options && options.maxInstances) || 10000,
    _instanceBuffer: null,
    _instanceData: null,
    _program: null,
    _vao: null,
    _initialized: false,
    _frustumCulling: (options && options.frustumCulling !== false),
    _lodLevels: []
  };

  function init(){
    const gl = ir.gl;
    ir._instanceData = new Float32Array(ir.maxInstances * 16);
    ir._instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ir._instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, ir._instanceData, gl.DYNAMIC_DRAW);

    const vs = `
      attribute vec3 aPosition;
      attribute vec3 aNormal;
      attribute mat4 aInstanceMatrix;
      uniform mat4 uViewProj;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main(){
        vec4 worldPos = aInstanceMatrix * vec4(aPosition, 1.0);
        vWorldPos = worldPos.xyz;
        vNormal = mat3(aInstanceMatrix) * aNormal;
        gl_Position = uViewProj * worldPos;
      }
    `;
    const fs = `
      precision mediump float;
      uniform vec3 uColor;
      uniform vec3 uLightDir;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main(){
        vec3 normal = normalize(vNormal);
        float diff = max(dot(normal, normalize(uLightDir)), 0.0);
        gl_FragColor = vec4(uColor * (0.3 + diff * 0.7), 1.0);
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    ir._program = gl.createProgram();
    gl.attachShader(ir._program, vsh);
    gl.attachShader(ir._program, fsh);
    gl.linkProgram(ir._program);
    ir._initialized = true;
  }

  function addInstance(position, rotation, scale, color){
    if(ir.instances.length >= ir.maxInstances) return null;
    const inst = {
      position: [position[0], position[1], position[2]],
      rotation: rotation ? [rotation[0],rotation[1],rotation[2]] : [0,0,0],
      scale: scale ? [scale[0],scale[1],scale[2]] : [1,1,1],
      color: color ? [color[0],color[1],color[2]] : [1,1,1],
      visible: true,
      _matrix: M4.create()
    };
    updateInstanceMatrix(inst);
    ir.instances.push(inst);
    return inst;
  }

  function updateInstanceMatrix(inst){
    const q = Q.fromEuler(Q.create(), inst.rotation[0], inst.rotation[1], inst.rotation[2]);
    M4.fromTRS(inst._matrix, inst.position, q, inst.scale);
  }

  function removeInstance(inst){
    const idx = ir.instances.indexOf(inst);
    if(idx >= 0) ir.instances.splice(idx, 1);
  }

  function clear(){
    ir.instances.length = 0;
  }

  function setInstancePosition(inst, x, y, z){
    inst.position[0]=x; inst.position[1]=y; inst.position[2]=z;
    updateInstanceMatrix(inst);
  }

  function setInstanceRotation(inst, x, y, z){
    inst.rotation[0]=x; inst.rotation[1]=y; inst.rotation[2]=z;
    updateInstanceMatrix(inst);
  }

  function setInstanceScale(inst, x, y, z){
    inst.scale[0]=x; inst.scale[1]=y; inst.scale[2]=z;
    updateInstanceMatrix(inst);
  }

  function addLODLevel(distance, mesh){
    ir._lodLevels.push({ distance: distance, mesh: mesh });
    ir._lodLevels.sort(function(a,b){ return a.distance - b.distance; });
  }

  function render(geometry, viewProj, cameraPosition, frustum){
    if(!ir._initialized || ir.instances.length === 0) return;
    const gl = ir.gl;
    let visibleCount = 0;

    for(let i = 0; i < ir.instances.length; i++){
      const inst = ir.instances[i];
      if(!inst.visible) continue;
      if(ir._frustumCulling && frustum){
        const center = inst.position;
        const radius = Math.max(inst.scale[0], inst.scale[1], inst.scale[2]) * 2;
        if(!sphereInFrustum(frustum, center, radius)) continue;
      }
      for(let j = 0; j < 16; j++){
        ir._instanceData[visibleCount * 16 + j] = inst._matrix[j];
      }
      visibleCount++;
    }

    if(visibleCount === 0) return;

    gl.useProgram(ir._program);
    gl.uniformMatrix4fv(gl.getUniformLocation(ir._program, 'uViewProj'), false, viewProj);
    gl.uniform3f(gl.getUniformLocation(ir._program, 'uLightDir'), 0.5, 1, 0.3);
    gl.uniform3f(gl.getUniformLocation(ir._program, 'uColor'), 0.8, 0.8, 0.9);

    gl.bindBuffer(gl.ARRAY_BUFFER, ir._instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, ir._instanceData.subarray(0, visibleCount * 16));

    const matrixLoc = gl.getAttribLocation(ir._program, 'aInstanceMatrix');
    for(let i = 0; i < 4; i++){
      gl.enableVertexAttribArray(matrixLoc + i);
      gl.vertexAttribPointer(matrixLoc + i, 4, gl.FLOAT, false, 64, i * 16);
      gl.vertexAttribDivisor(matrixLoc + i, 1);
    }

    if(geometry.vertexBuffer){
      gl.bindBuffer(gl.ARRAY_BUFFER, geometry.vertexBuffer);
      const posLoc = gl.getAttribLocation(ir._program, 'aPosition');
      const normLoc = gl.getAttribLocation(ir._program, 'aNormal');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(normLoc);
      gl.vertexAttribPointer(normLoc, 3, gl.FLOAT, false, 24, 12);
    }

    if(geometry.indexBuffer){
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.indexBuffer);
      gl.drawElementsInstanced(gl.TRIANGLES, geometry.indexCount, gl.UNSIGNED_SHORT, 0, visibleCount);
    } else {
      gl.drawArraysInstanced(gl.TRIANGLES, 0, geometry.vertexCount, visibleCount);
    }

    for(let i = 0; i < 4; i++){
      gl.vertexAttribDivisor(matrixLoc + i, 0);
    }
  }

  function dispose(){
    const gl = ir.gl;
    if(ir._instanceBuffer) gl.deleteBuffer(ir._instanceBuffer);
    if(ir._program) gl.deleteProgram(ir._program);
  }

  return { init, addInstance, removeInstance, clear, setInstancePosition, setInstanceRotation, setInstanceScale, addLODLevel, render, dispose, ir };
}

/* ===== 渲染图系统 =====
   支持: 渲染pass依赖图 / 自动排序 / 资源管理 / 并行执行
*/


function createRenderGraph(gl, options){
  const rg = {
    gl: gl,
    passes: [],
    resources: {},
    _adjacency: {},
    _sorted: null,
    _dirty: true,
    _stats: { drawCalls: 0, triangles: 0, time: 0 }
  };

  function createPass(name, type, executeFunc, options){
    const pass = {
      name: name,
      type: type,
      execute: executeFunc,
      inputs: (options && options.inputs) || [],
      outputs: (options && options.outputs) || [],
      dependencies: (options && options.dependencies) || [],
      enabled: (options && options.enabled !== undefined) ? options.enabled : true,
      width: (options && options.width) || 0,
      height: (options && options.height) || 0,
      _framebuffer: null,
      _order: 0
    };
    rg.passes.push(pass);
    rg._dirty = true;
    return pass;
  }

  function removePass(name){
    const idx = rg.passes.findIndex(function(p){ return p.name === name; });
    if(idx >= 0){
      rg.passes.splice(idx, 1);
      rg._dirty = true;
    }
  }

  function getPass(name){
    return rg.passes.find(function(p){ return p.name === name; });
  }

  function addDependency(passName, depName){
    const pass = getPass(passName);
    if(pass && pass.dependencies.indexOf(depName) < 0){
      pass.dependencies.push(depName);
      rg._dirty = true;
    }
  }

  function createResource(name, type, options){
    const res = {
      name: name,
      type: type,
      width: (options && options.width) || 512,
      height: (options && options.height) || 512,
      format: (options && options.format) || 'RGBA',
      _texture: null,
      _framebuffer: null
    };
    rg.resources[name] = res;
    return res;
  }

  function topoSort(){
    const inDegree = {};
    const adj = {};
    for(let i = 0; i < rg.passes.length; i++){
      inDegree[rg.passes[i].name] = 0;
      adj[rg.passes[i].name] = [];
    }
    for(let i = 0; i < rg.passes.length; i++){
      const pass = rg.passes[i];
      for(let d = 0; d < pass.dependencies.length; d++){
        const dep = pass.dependencies[d];
        if(adj[dep]){
          adj[dep].push(pass.name);
          inDegree[pass.name]++;
        }
      }
    }
    const queue = [];
    for(const name in inDegree){
      if(inDegree[name] === 0) queue.push(name);
    }
    const sorted = [];
    while(queue.length > 0){
      const name = queue.shift();
      sorted.push(name);
      if(adj[name]){
        for(let i = 0; i < adj[name].length; i++){
          inDegree[adj[name][i]]--;
          if(inDegree[adj[name][i]] === 0) queue.push(adj[name][i]);
        }
      }
    }
    return sorted;
  }

  function validate(){
    const sorted = topoSort();
    if(sorted.length !== rg.passes.length){
      console.error('[RenderGraph] 检测到循环依赖!');
      return false;
    }
    for(let i = 0; i < rg.passes.length; i++){
      const pass = rg.passes[i];
      for(let j = 0; j < pass.inputs.length; j++){
        if(!rg.resources[pass.inputs[j]]){
          console.error('[RenderGraph] Pass ' + pass.name + ' 引用了不存在的资源: ' + pass.inputs[j]);
          return false;
        }
      }
    }
    return true;
  }

  function execute(camera, scene, options){
    if(rg._dirty){
      rg._sorted = topoSort();
      rg._dirty = false;
    }
    if(!validate()) return;
    const gl = rg.gl;
    rg._stats.drawCalls = 0;
    rg._stats.triangles = 0;
    const startTime = performance.now();

    for(let i = 0; i < rg._sorted.length; i++){
      const passName = rg._sorted[i];
      const pass = getPass(passName);
      if(!pass || !pass.enabled) continue;

      const context = {
        gl: gl,
        camera: camera,
        scene: scene,
        resources: rg.resources,
        options: options || {},
        stats: rg._stats,
        width: pass.width || gl.canvas.width,
        height: pass.height || gl.canvas.height
      };

      if(pass.outputs && pass.outputs.length > 0){
        const res = rg.resources[pass.outputs[0]];
        if(res && res._framebuffer){
          gl.bindFramebuffer(gl.FRAMEBUFFER, res._framebuffer);
          gl.viewport(0, 0, res.width, res.height);
        }
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
      }

      pass.execute(context);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    rg._stats.time = performance.now() - startTime;
  }

  function resize(width, height){
    for(const name in rg.resources){
      const res = rg.resources[name];
      if(res._texture){
        const gl = rg.gl;
        gl.bindTexture(gl.TEXTURE_2D, res._texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        res.width = width;
        res.height = height;
      }
    }
  }

  function getStats(){
    return { ...rg._stats };
  }

  function clear(){
    rg.passes.length = 0;
    rg.resources = {};
    rg._dirty = true;
  }

  return { createPass, removePass, getPass, addDependency, createResource, execute, resize, getStats, validate, clear, rg };
}
