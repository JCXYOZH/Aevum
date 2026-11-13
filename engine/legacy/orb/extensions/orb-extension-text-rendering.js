/**
 * MrHua 3D灵体渲染引擎 - 扩展模块: orb-extension-text-rendering
 * 从 legacy/_orb_expand_part2.js 转换 (GBK->UTF-8)
 * @module orb-extension-text-rendering
 */
'use strict';



/* ===== 字体与文本渲染系统=====
   支持: 位图字体 / SDF字体 / 文本布局 / 自动换行 / 对齐
*/
function createFontRenderer(gl, options){
  const fr = {
    gl: gl,
    fonts: {},
    currentFont: null,
    _program: null,
    _vbo: null,
    _vao: null,
    _initialized: false,
    _maxChars: (options && options.maxChars) || 4096
  };

  function init(){
    const gl = fr.gl;
    const vs = `
      attribute vec2 aPosition;
      attribute vec2 aUV;
      attribute vec4 aColor;
      uniform vec2 uResolution;
      varying vec2 vUV;
      varying vec4 vColor;
      void main(){
        vec2 pos = aPosition / uResolution * 2.0 - 1.0;
        pos.y = -pos.y;
        gl_Position = vec4(pos, 0.0, 1.0);
        vUV = aUV;
        vColor = aColor;
      }
    `;
    const fs = `
      precision mediump float;
      uniform sampler2D uFontTexture;
      uniform float uSDF;
      varying vec2 vUV;
      varying vec4 vColor;
      void main(){
        float dist = texture2D(uFontTexture, vUV).a;
        if(uSDF > 0.5){
          float alpha = smoothstep(0.48, 0.52, dist);
          gl_FragColor = vec4(vColor.rgb, vColor.a * alpha);
        } else {
          if(dist < 0.1) discard;
          gl_FragColor = vec4(vColor.rgb, vColor.a * dist);
        }
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    fr._program = gl.createProgram();
    gl.attachShader(fr._program, vsh);
    gl.attachShader(fr._program, fsh);
    gl.linkProgram(fr._program);

    fr._vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, fr._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, fr._maxChars * 6 * 12 * 4, gl.DYNAMIC_DRAW);
    fr._initialized = true;
  }

  function createBitmapFont(name, texture, glyphData, options){
    const font = {
      name: name,
      texture: texture,
      glyphs: {},
      lineHeight: (options && options.lineHeight) || 32,
      base: (options && options.base) || 24,
      scaleW: (options && options.scaleW) || 512,
      scaleH: (options && options.scaleH) || 512,
      isSDF: (options && options.isSDF) || false,
      kernings: {}
    };
    if(glyphData){
      for(let i = 0; i < glyphData.length; i++){
        const g = glyphData[i];
        font.glyphs[g.char] = {
          x: g.x, y: g.y, width: g.width, height: g.height,
          xoffset: g.xoffset || 0, yoffset: g.yoffset || 0,
          xadvance: g.xadvance || g.width
        };
      }
    }
    fr.fonts[name] = font;
    if(!fr.currentFont) fr.currentFont = font;
    return font;
  }

  function generateDefaultFont(name, options){
    const size = (options && options.size) || 32;
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#fff';
    ctx.font = size + 'px monospace';
    ctx.textBaseline = 'top';
    const glyphs = [];
    let x = 0, y = 0;
    const chars = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
    for(let i = 0; i < chars.length; i++){
      const ch = chars[i];
      const w = ctx.measureText(ch).width;
      if(x + w + 2 > 512){ x = 0; y += size + 4; }
      ctx.fillText(ch, x, y);
      glyphs.push({ char: ch, x: x, y: y, width: w, height: size, xoffset: 0, yoffset: 0, xadvance: w + 1 });
      x += w + 2;
    }
    const gl = fr.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return createBitmapFont(name, tex, glyphs, { lineHeight: size + 4, base: size, scaleW: 512, scaleH: 512 });
  }

  function setFont(name){
    if(fr.fonts[name]) fr.currentFont = fr.fonts[name];
  }

  function measureText(text, fontSize){
    if(!fr.currentFont) return { width: 0, height: 0 };
    const font = fr.currentFont;
    const scale = fontSize / font.lineHeight;
    let width = 0;
    for(let i = 0; i < text.length; i++){
      const g = font.glyphs[text[i]];
      if(g) width += g.xadvance * scale;
      else width += font.lineHeight * 0.5 * scale;
    }
    return { width: width, height: font.lineHeight * scale };
  }

  function wrapText(text, maxWidth, fontSize){
    if(!fr.currentFont) return [text];
    const lines = [];
    const paragraphs = text.split('\n');
    for(let p = 0; p < paragraphs.length; p++){
      const words = paragraphs[p].split(' ');
      let current = '';
      for(let w = 0; w < words.length; w++){
        const test = current ? current + ' ' + words[w] : words[w];
        const m = measureText(test, fontSize);
        if(m.width > maxWidth && current){
          lines.push(current);
          current = words[w];
        } else {
          current = test;
        }
      }
      if(current) lines.push(current);
    }
    return lines;
  }

  function drawText(text, x, y, fontSize, color, options){
    if(!fr.currentFont || !fr._initialized) return;
    const font = fr.currentFont;
    const gl = fr.gl;
    const scale = fontSize / font.lineHeight;
    const align = (options && options.align) || 'left';
    const baseline = (options && options.baseline) || 'top';
    const lineHeight = (options && options.lineHeight) || fontSize * 1.2;

    let lines = [text];
    if(options && options.maxWidth){
      lines = wrapText(text, options.maxWidth, fontSize);
    }

    const vertices = new Float32Array(fr._maxChars * 6 * 12);
    let vi = 0;
    let curX = x, curY = y;

    for(let l = 0; l < lines.length; l++){
      const line = lines[l];
      const m = measureText(line, fontSize);
      if(align === 'center') curX = x - m.width / 2;
      else if(align === 'right') curX = x - m.width;
      else curX = x;

      if(baseline === 'middle') curY = y - lineHeight / 2 + l * lineHeight;
      else if(baseline === 'bottom') curY = y - lineHeight + l * lineHeight;
      else curY = y + l * lineHeight;

      for(let i = 0; i < line.length; i++){
        const g = font.glyphs[line[i]];
        if(!g){ curX += font.lineHeight * 0.5 * scale; continue; }
        const gx = curX + g.xoffset * scale;
        const gy = curY + g.yoffset * scale;
        const gw = g.width * scale;
        const gh = g.height * scale;
        const u0 = g.x / font.scaleW;
        const v0 = g.y / font.scaleH;
        const u1 = (g.x + g.width) / font.scaleW;
        const v1 = (g.y + g.height) / font.scaleH;

        const verts = [
          gx, gy, u0, v0, color[0], color[1], color[2], color[3],
          gx+gw, gy, u1, v0, color[0], color[1], color[2], color[3],
          gx, gy+gh, u0, v1, color[0], color[1], color[2], color[3],
          gx+gw, gy, u1, v0, color[0], color[1], color[2], color[3],
          gx+gw, gy+gh, u1, v1, color[0], color[1], color[2], color[3],
          gx, gy+gh, u0, v1, color[0], color[1], color[2], color[3]
        ];
        for(let v = 0; v < 72; v++) vertices[vi++] = verts[v];
        curX += g.xadvance * scale;
      }
    }

    gl.useProgram(fr._program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.uniform2f(gl.getUniformLocation(fr._program, 'uResolution'), gl.canvas.width, gl.canvas.height);
    gl.uniform1f(gl.getUniformLocation(fr._program, 'uSDF'), font.isSDF ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, font.texture);
    gl.uniform1i(gl.getUniformLocation(fr._program, 'uFontTexture'), 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, fr._vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices.subarray(0, vi));
    const posLoc = gl.getAttribLocation(fr._program, 'aPosition');
    const uvLoc = gl.getAttribLocation(fr._program, 'aUV');
    const colLoc = gl.getAttribLocation(fr._program, 'aColor');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 48, 0);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 48, 8);
    gl.enableVertexAttribArray(colLoc);
    gl.vertexAttribPointer(colLoc, 4, gl.FLOAT, false, 48, 16);
    gl.drawArrays(gl.TRIANGLES, 0, vi / 12);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  function dispose(){
    const gl = fr.gl;
    if(fr._vbo) gl.deleteBuffer(fr._vbo);
    if(fr._program) gl.deleteProgram(fr._program);
    for(const name in fr.fonts){
      if(fr.fonts[name].texture) gl.deleteTexture(fr.fonts[name].texture);
    }
  }

  return { init, createBitmapFont, generateDefaultFont, setFont, measureText, wrapText, drawText, dispose, fr };
}

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
      addText('FPS', boxX + 2, boxY, 14, [1,1,1,1]);
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

/* ===== GPU实例化系统=====
   支持: 硬件实例化/ 实例数据缓冲 / 实例剔除 / 实例LOD
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

/* ===== 渲染图系统=====
   支持: 渲染pass依赖图/ 自动排序 / 资源管理 / 并行执行
*/
const RenderPassType = { SHADOW: 0, OPAQUE: 1, TRANSPARENT: 2, POST_PROCESS: 3, UI: 4, DEBUG: 5 };

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
          console.error('[RenderGraph] Pass ' + pass.name + ' 引用了不存在的资源 ' + pass.inputs[j]);
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

/* ===== 软件路径追踪器=====
   支持: 漫反射/ 镜面反射 / 折射 / 软阴影/ 环境光*/
function createPathTracer(options){
  const pt = {
    width: (options && options.width) || 512,
    height: (options && options.height) || 512,
    samples: (options && options.samples) || 16,
    maxBounces: (options && options.maxBounces) || 4,
    scene: { objects: [], lights: [], background: [0.1, 0.1, 0.2] },
    _framebuffer: null,
    _accumulator: null
  };

  function init(){
    pt._framebuffer = new Float32Array(pt.width * pt.height * 3);
    pt._accumulator = new Float32Array(pt.width * pt.height * 3);
  }

  function addSphere(center, radius, material){
    pt.scene.objects.push({
      type: 'sphere',
      center: [center[0], center[1], center[2]],
      radius: radius,
      material: material || { type: 'diffuse', color: [0.8, 0.8, 0.8] }
    });
  }

  function addPlane(normal, point, material){
    pt.scene.objects.push({
      type: 'plane',
      normal: [normal[0], normal[1], normal[2]],
      point: [point[0], point[1], point[2]],
      material: material || { type: 'diffuse', color: [0.5, 0.5, 0.5] }
    });
  }

  function addTriangle(v0, v1, v2, material){
    pt.scene.objects.push({
      type: 'triangle',
      v0: [v0[0],v0[1],v0[2]], v1: [v1[0],v1[1],v1[2]], v2: [v2[0],v2[1],v2[2]],
      material: material || { type: 'diffuse', color: [0.8, 0.8, 0.8] }
    });
  }

  function addLight(position, color, intensity){
    pt.scene.lights.push({
      position: [position[0], position[1], position[2]],
      color: [color[0], color[1], color[2]],
      intensity: intensity || 1
    });
  }

  function setBackground(color){
    pt.scene.background = [color[0], color[1], color[2]];
  }

  function intersectSphere(ray, sphere){
    const ox = ray.origin[0] - sphere.center[0];
    const oy = ray.origin[1] - sphere.center[1];
    const oz = ray.origin[2] - sphere.center[2];
    const b = ox * ray.dir[0] + oy * ray.dir[1] + oz * ray.dir[2];
    const c = ox*ox + oy*oy + oz*oz - sphere.radius * sphere.radius;
    const disc = b*b - c;
    if(disc < 0) return -1;
    const t = -b - Math.sqrt(disc);
    return t > 0.001 ? t : -1;
  }

  function intersectPlane(ray, plane){
    const denom = ray.dir[0]*plane.normal[0] + ray.dir[1]*plane.normal[1] + ray.dir[2]*plane.normal[2];
    if(Math.abs(denom) < 1e-8) return -1;
    const t = -(ray.origin[0]*plane.normal[0] + ray.origin[1]*plane.normal[1] + ray.origin[2]*plane.normal[2] -
                (plane.point[0]*plane.normal[0] + plane.point[1]*plane.normal[1] + plane.point[2]*plane.normal[2])) / denom;
    return t > 0.001 ? t : -1;
  }

  function intersectTriangle(ray, tri){
    const e1x = tri.v1[0]-tri.v0[0], e1y = tri.v1[1]-tri.v0[1], e1z = tri.v1[2]-tri.v0[2];
    const e2x = tri.v2[0]-tri.v0[0], e2y = tri.v2[1]-tri.v0[1], e2z = tri.v2[2]-tri.v0[2];
    const px = ray.dir[1]*e2z - ray.dir[2]*e2y;
    const py = ray.dir[2]*e2x - ray.dir[0]*e2z;
    const pz = ray.dir[0]*e2y - ray.dir[1]*e2x;
    const det = e1x*px + e1y*py + e1z*pz;
    if(Math.abs(det) < 1e-8) return -1;
    const inv = 1/det;
    const tx = ray.origin[0]-tri.v0[0], ty = ray.origin[1]-tri.v0[1], tz = ray.origin[2]-tri.v0[2];
    const u = (tx*px + ty*py + tz*pz) * inv;
    if(u < 0 || u > 1) return -1;
    const qx = ty*e1z - tz*e1y, qy = tz*e1x - tx*e1z, qz = tx*e1y - ty*e1x;
    const v = (ray.dir[0]*qx + ray.dir[1]*qy + ray.dir[2]*qz) * inv;
    if(v < 0 || u+v > 1) return -1;
    const t = (e2x*qx + e2y*qy + e2z*qz) * inv;
    return t > 0.001 ? t : -1;
  }

  function intersectScene(ray){
    let closest = Infinity, hitObj = null, hitT = -1;
    for(let i = 0; i < pt.scene.objects.length; i++){
      const obj = pt.scene.objects[i];
      let t = -1;
      if(obj.type === 'sphere') t = intersectSphere(ray, obj);
      else if(obj.type === 'plane') t = intersectPlane(ray, obj);
      else if(obj.type === 'triangle') t = intersectTriangle(ray, obj);
      if(t > 0 && t < closest){ closest = t; hitObj = obj; hitT = t; }
    }
    return { t: hitT, object: hitObj };
  }

  function getNormal(obj, point){
    if(obj.type === 'sphere'){
      const n = [point[0]-obj.center[0], point[1]-obj.center[1], point[2]-obj.center[2]];
      const l = Math.sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]) || 1;
      return [n[0]/l, n[1]/l, n[2]/l];
    } else if(obj.type === 'plane'){
      return [obj.normal[0], obj.normal[1], obj.normal[2]];
    } else if(obj.type === 'triangle'){
      const e1 = [obj.v1[0]-obj.v0[0], obj.v1[1]-obj.v0[1], obj.v1[2]-obj.v0[2]];
      const e2 = [obj.v2[0]-obj.v0[0], obj.v2[1]-obj.v0[1], obj.v2[2]-obj.v0[2]];
      const n = [e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
      const l = Math.sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]) || 1;
      return [n[0]/l, n[1]/l, n[2]/l];
    }
    return [0, 1, 0];
  }

  function randomHemisphere(normal){
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u*u);
    let dir = [r * Math.cos(theta), u, r * Math.sin(theta)];
    if(dir[0]*normal[0] + dir[1]*normal[1] + dir[2]*normal[2] < 0){
      dir = [-dir[0], -dir[1], -dir[2]];
    }
    return dir;
  }

  function traceRay(ray, depth){
    if(depth >= pt.maxBounces) return [0, 0, 0];
    const hit = intersectScene(ray);
    if(!hit.object) return pt.scene.background;

    const point = [
      ray.origin[0] + ray.dir[0] * hit.t,
      ray.origin[1] + ray.dir[1] * hit.t,
      ray.origin[2] + ray.dir[2] * hit.t
    ];
    const normal = getNormal(hit.object, point);
    const mat = hit.object.material;
    let color = [0, 0, 0];

    for(let l = 0; l < pt.scene.lights.length; l++){
      const light = pt.scene.lights[l];
      const toLight = [light.position[0]-point[0], light.position[1]-point[1], light.position[2]-point[2]];
      const lightDist = Math.sqrt(toLight[0]*toLight[0]+toLight[1]*toLight[1]+toLight[2]*toLight[2]);
      toLight[0]/=lightDist; toLight[1]/=lightDist; toLight[2]/=lightDist;

      const shadowRay = { origin: [point[0]+normal[0]*0.01, point[1]+normal[1]*0.01, point[2]+normal[2]*0.01], dir: toLight };
      const shadowHit = intersectScene(shadowRay);
      if(shadowHit.t > 0 && shadowHit.t < lightDist) continue;

      const ndotl = Math.max(0, normal[0]*toLight[0] + normal[1]*toLight[1] + normal[2]*toLight[2]);
      const atten = light.intensity / (lightDist * lightDist);
      color[0] += mat.color[0] * light.color[0] * ndotl * atten;
      color[1] += mat.color[1] * light.color[1] * ndotl * atten;
      color[2] += mat.color[2] * light.color[2] * ndotl * atten;
    }

    if(mat.type === 'mirror'){
      const refl = [
        ray.dir[0] - 2 * (ray.dir[0]*normal[0]+ray.dir[1]*normal[1]+ray.dir[2]*normal[2]) * normal[0],
        ray.dir[1] - 2 * (ray.dir[0]*normal[0]+ray.dir[1]*normal[1]+ray.dir[2]*normal[2]) * normal[1],
        ray.dir[2] - 2 * (ray.dir[0]*normal[0]+ray.dir[1]*normal[1]+ray.dir[2]*normal[2]) * normal[2]
      ];
      const reflRay = { origin: [point[0]+normal[0]*0.01, point[1]+normal[1]*0.01, point[2]+normal[2]*0.01], dir: refl };
      const reflColor = traceRay(reflRay, depth + 1);
      color[0] += mat.color[0] * reflColor[0];
      color[1] += mat.color[1] * reflColor[1];
      color[2] += mat.color[2] * reflColor[2];
    } else if(mat.type === 'diffuse'){
      const newDir = randomHemisphere(normal);
      const newRay = { origin: [point[0]+normal[0]*0.01, point[1]+normal[1]*0.01, point[2]+normal[2]*0.01], dir: newDir };
      const indirect = traceRay(newRay, depth + 1);
      color[0] += mat.color[0] * indirect[0] * 0.5;
      color[1] += mat.color[1] * indirect[1] * 0.5;
      color[2] += mat.color[2] * indirect[2] * 0.5;
    }

    return color;
  }

  function render(camera){
    if(!pt._framebuffer) init();
    const aspect = pt.width / pt.height;
    const fov = camera.fov || 60;
    const tanHalf = Math.tan(fov * Math.PI / 360);

    for(let y = 0; y < pt.height; y++){
      for(let x = 0; x < pt.width; x++){
        let r = 0, g = 0, b = 0;
        for(let s = 0; s < pt.samples; s++){
          const u = (x + Math.random()) / pt.width * 2 - 1;
          const v = (y + Math.random()) / pt.height * 2 - 1;
          const dir = [u * tanHalf * aspect, v * tanHalf, -1];
          const l = Math.sqrt(dir[0]*dir[0]+dir[1]*dir[1]+dir[2]*dir[2]);
          dir[0]/=l; dir[1]/=l; dir[2]/=l;
          const ray = { origin: [camera.position[0], camera.position[1], camera.position[2]], dir: dir };
          const c = traceRay(ray, 0);
          r += c[0]; g += c[1]; b += c[2];
        }
        const idx = (y * pt.width + x) * 3;
        pt._framebuffer[idx] = r / pt.samples;
        pt._framebuffer[idx+1] = g / pt.samples;
        pt._framebuffer[idx+2] = b / pt.samples;
      }
    }
    return pt._framebuffer;
  }

  function toImageData(){
    const img = new ImageData(pt.width, pt.height);
    for(let i = 0; i < pt.width * pt.height; i++){
      const r = Math.min(255, Math.max(0, pt._framebuffer[i*3] * 255));
      const g = Math.min(255, Math.max(0, pt._framebuffer[i*3+1] * 255));
      const b = Math.min(255, Math.max(0, pt._framebuffer[i*3+2] * 255));
      img.data[i*4] = r; img.data[i*4+1] = g; img.data[i*4+2] = b; img.data[i*4+3] = 255;
    }
    return img;
  }

  function clear(){
    pt.scene.objects.length = 0;
    pt.scene.lights.length = 0;
  }

  return { init, addSphere, addPlane, addTriangle, addLight, setBackground, render, toImageData, clear, pt };
}

/* ===== 体积渲染系统 =====
   支持: 3D纹理体积 / 光线步进 / 吸收发射 / 阴影
*/
function createVolumeRenderer(gl, options){
  const vr = {
    gl: gl,
    volumeData: null,
    volumeSize: (options && options.volumeSize) || [64, 64, 64],
    _texture3D: null,
    _program: null,
    _vbo: null,
    _initialized: false,
    stepSize: (options && options.stepSize) || 0.01,
    maxSteps: (options && options.maxSteps) || 256,
    absorption: (options && options.absorption) || 0.5,
    emissionColor: (options && options.emissionColor) || [1, 0.8, 0.6],
    emissionStrength: (options && options.emissionStrength) || 2.0
  };

  function init(){
    const gl = vr.gl;
    const vs = `
      attribute vec3 aPosition;
      varying vec3 vRayDir;
      uniform mat4 uViewProj;
      uniform vec3 uCameraPos;
      void main(){
        vRayDir = normalize(aPosition - uCameraPos);
        gl_Position = uViewProj * vec4(aPosition, 1.0);
      }
    `;
    const fs = `
      precision mediump float;
      uniform sampler3D uVolume;
      uniform vec3 uVolumeSize;
      uniform float uStepSize;
      uniform int uMaxSteps;
      uniform float uAbsorption;
      uniform vec3 uEmissionColor;
      uniform float uEmissionStrength;
      uniform vec3 uLightDir;
      varying vec3 vRayDir;
      uniform vec3 uCameraPos;
      uniform vec3 uBoxMin;
      uniform vec3 uBoxMax;

      float sampleVolume(vec3 pos){
        vec3 uv = (pos - uBoxMin) / (uBoxMax - uBoxMin);
        if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || uv.z < 0.0 || uv.z > 1.0) return 0.0;
        return texture3D(uVolume, uv).r;
      }

      vec2 intersectBox(vec3 origin, vec3 dir){
        vec3 invDir = 1.0 / dir;
        vec3 t0 = (uBoxMin - origin) * invDir;
        vec3 t1 = (uBoxMax - origin) * invDir;
        vec3 tmin = min(t0, t1);
        vec3 tmax = max(t0, t1);
        float tNear = max(max(tmin.x, tmin.y), tmin.z);
        float tFar = min(min(tmax.x, tmax.y), tmax.z);
        return vec2(tNear, tFar);
      }

      void main(){
        vec3 origin = uCameraPos;
        vec3 dir = normalize(vRayDir);
        vec2 tBox = intersectBox(origin, dir);
        if(tBox.x > tBox.y) discard;
        float t = max(tBox.x, 0.0);
        float tEnd = tBox.y;
        vec3 color = vec3(0.0);
        float transmittance = 1.0;
        for(int i = 0; i < 256; i++){
          if(i >= uMaxSteps || t > tEnd) break;
          vec3 pos = origin + dir * t;
          float density = sampleVolume(pos);
          if(density > 0.001){
            float lightDensity = 0.0;
            vec3 lightPos = pos;
            for(int j = 0; j < 32; j++){
              lightPos += normalize(uLightDir) * uStepSize * 2.0;
              lightDensity += sampleVolume(lightPos);
            }
            float shadow = exp(-lightDensity * uAbsorption * 2.0);
            vec3 emit = uEmissionColor * density * uEmissionStrength * shadow;
            float absorb = density * uAbsorption * uStepSize;
            color += transmittance * emit * uStepSize * 10.0;
            transmittance *= exp(-absorb);
            if(transmittance < 0.01) break;
          }
          t += uStepSize;
        }
        gl_FragColor = vec4(color, 1.0 - transmittance);
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    vr._program = gl.createProgram();
    gl.attachShader(vr._program, vsh);
    gl.attachShader(vr._program, fsh);
    gl.linkProgram(vr._program);

    const verts = new Float32Array([
      -1,-1,-1, 1,-1,-1, 1,1,-1, -1,1,-1,
      -1,-1,1, 1,-1,1, 1,1,1, -1,1,1
    ]);
    vr._vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vr._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    vr._initialized = true;
  }

  function setVolumeData(data, size){
    vr.volumeData = data;
    vr.volumeSize = size || vr.volumeSize;
    const gl = vr.gl;
    if(vr._texture3D) gl.deleteTexture(vr._texture3D);
    vr._texture3D = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, vr._texture3D);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, vr.volumeSize[0], vr.volumeSize[1], vr.volumeSize[2], 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  }

  function generateProceduralVolume(type, params){
    const [w, h, d] = vr.volumeSize;
    const data = new Uint8Array(w * h * d);
    for(let z = 0; z < d; z++){
      for(let y = 0; y < h; y++){
        for(let x = 0; x < w; x++){
          const nx = x / w - 0.5, ny = y / h - 0.5, nz = z / d - 0.5;
          let val = 0;
          if(type === 'sphere'){
            const r = Math.sqrt(nx*nx + ny*ny + nz*nz);
            val = Math.max(0, 1 - r * 2);
          } else if(type === 'cloud'){
            const n = Noise.perlin3D(nx * 4, ny * 4, nz * 4);
            val = Math.max(0, n * 0.5 + 0.3);
          } else if(type === 'smoke'){
            const n1 = Noise.perlin3D(nx * 3, ny * 3 + 0.5, nz * 3);
            const n2 = Noise.perlin3D(nx * 6, ny * 6, nz * 6);
            val = Math.max(0, (n1 * 0.7 + n2 * 0.3) * 0.5 + 0.2 - ny * 0.8);
          } else if(type === 'fire'){
            const n = Noise.perlin3D(nx * 5, ny * 5 - performance.now() * 0.001, nz * 5);
            val = Math.max(0, 1 - Math.abs(ny) * 2) * (n * 0.5 + 0.5);
          }
          data[(z * h + y) * w + x] = Math.min(255, val * 255);
        }
      }
    }
    setVolumeData(data);
    return data;
  }

  function render(viewProj, cameraPosition, boxMin, boxMax){
    if(!vr._initialized || !vr._texture3D) return;
    const gl = vr.gl;
    gl.useProgram(vr._program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(gl.getUniformLocation(vr._program, 'uViewProj'), false, viewProj);
    gl.uniform3fv(gl.getUniformLocation(vr._program, 'uCameraPos'), cameraPosition);
    gl.uniform3fv(gl.getUniformLocation(vr._program, 'uBoxMin'), boxMin);
    gl.uniform3fv(gl.getUniformLocation(vr._program, 'uBoxMax'), boxMax);
    gl.uniform1f(gl.getUniformLocation(vr._program, 'uStepSize'), vr.stepSize);
    gl.uniform1i(gl.getUniformLocation(vr._program, 'uMaxSteps'), vr.maxSteps);
    gl.uniform1f(gl.getUniformLocation(vr._program, 'uAbsorption'), vr.absorption);
    gl.uniform3fv(gl.getUniformLocation(vr._program, 'uEmissionColor'), vr.emissionColor);
    gl.uniform1f(gl.getUniformLocation(vr._program, 'uEmissionStrength'), vr.emissionStrength);
    gl.uniform3f(gl.getUniformLocation(vr._program, 'uLightDir'), 0.5, 1, 0.3);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, vr._texture3D);
    gl.uniform1i(gl.getUniformLocation(vr._program, 'uVolume'), 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, vr._vbo);
    const posLoc = gl.getAttribLocation(vr._program, 'aPosition');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    gl.drawArrays(gl.TRIANGLE_FAN, 4, 4);
    gl.disable(gl.BLEND);
  }

  function dispose(){
    const gl = vr.gl;
    if(vr._texture3D) gl.deleteTexture(vr._texture3D);
    if(vr._vbo) gl.deleteBuffer(vr._vbo);
    if(vr._program) gl.deleteProgram(vr._program);
  }

  return { init, setVolumeData, generateProceduralVolume, render, dispose, vr };
}
