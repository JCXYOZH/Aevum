/**
 * MrHua 3D灵体渲染引擎 - orb-model-renderer
 * 模型渲染(蒙皮/轮廓/色彩)
 * 从 orb-renderer-main.js 拆分 (原行 L3543-L3931)
 * @module orb-model-renderer
 */
'use strict';

function renderModel(renderer, modelInstance, camera, options){
  const {gl,prog,loc} = renderer;
  if(renderer._contextLost) return;
  const {model, boneSystem, animator, posBuf, normBuf, uvBuf, boneIdxBuf, boneWeightBuf, idxBuf, morphOffsetBuf, morphOffsetData, textures, center, size, uniqueBones, materialBounds} = modelInstance;
  const opts = options || {};
  const enableMorph = opts.enableMorph !== false;
  const enableOutline = opts.enableOutline !== false;
  const outlineScale = opts.outlineScale || 0.02;
  const outlineColor = opts.outlineColor || [0.1, 0.1, 0.15];
  // 画质/色彩调整参数
  const exposure = opts.exposure != null ? opts.exposure : 0.85;      // 曝光（降低亮度）
  const saturation = opts.saturation != null ? opts.saturation : 1.35;  // 饱和度（增强色彩）
  const contrast = opts.contrast != null ? opts.contrast : 1.15;        // 对比度
  const brightness = opts.brightness != null ? opts.brightness : -0.05;  // 亮度偏移

  // canvas 尺寸
  const cw = Math.max(1, gl.canvas.width || 1);
  const ch = Math.max(1, gl.canvas.height || 1);
  gl.useProgram(prog);
  gl.viewport(0,0,cw,ch);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // 更新动画
  const _now = performance.now()/1000;
  const dt = Math.min(0.05, Math.max(0.001, _now - (renderModel._lastTime || _now)));
  renderModel._lastTime = _now;
  const anim = animator.update(dt, _now);
  const fullPalette = boneSystem.computePalette(anim.poseRotations, anim.posePositions);

  // 更新形态键（眨眼等）- 每帧根据blinkValue计算偏移并更新buffer
  if(enableMorph && anim.blinkMorphs && anim.blinkMorphs.length > 0){
    if(!renderModel._morphWeights) renderModel._morphWeights = {};
    const mw = renderModel._morphWeights;
    for(const k in mw) delete mw[k];
    for(const m of anim.blinkMorphs){
      mw[m.name] = anim.blinkValue;
      if(m.nameEn) mw[m.nameEn] = anim.blinkValue;
    }
    const morphResult = computeMorphOffsets(model, mw);
    if(morphResult.activeCount > 0 || renderModel._lastMorphActive > 0){
      gl.bindBuffer(gl.ARRAY_BUFFER, morphOffsetBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, morphResult.offsets);
      renderModel._lastMorphActive = morphResult.activeCount;
    }
  }

  // 构建紧凑骨骼调色板（只包含顶点引用的骨骼）- 复用数组避免GC
  const _maxPal = renderer.maxBones || 256;
  const _palLen = Math.min(uniqueBones.length, _maxPal) * 16;
  if(!renderModel._palette || renderModel._palette.length !== _palLen){
    renderModel._palette = new Float32Array(_palLen);
  }
  const palette = renderModel._palette;
  for(let i=0;i<uniqueBones.length && i<_maxPal;i++){
    const srcOff = uniqueBones[i] * 16;
    const dstOff = i * 16;
    palette[dstOff] = fullPalette[srcOff];
    palette[dstOff+1] = fullPalette[srcOff+1];
    palette[dstOff+2] = fullPalette[srcOff+2];
    palette[dstOff+3] = fullPalette[srcOff+3];
    palette[dstOff+4] = fullPalette[srcOff+4];
    palette[dstOff+5] = fullPalette[srcOff+5];
    palette[dstOff+6] = fullPalette[srcOff+6];
    palette[dstOff+7] = fullPalette[srcOff+7];
    palette[dstOff+8] = fullPalette[srcOff+8];
    palette[dstOff+9] = fullPalette[srcOff+9];
    palette[dstOff+10] = fullPalette[srcOff+10];
    palette[dstOff+11] = fullPalette[srcOff+11];
    palette[dstOff+12] = fullPalette[srcOff+12];
    palette[dstOff+13] = fullPalette[srcOff+13];
    palette[dstOff+14] = fullPalette[srcOff+14];
    palette[dstOff+15] = fullPalette[srcOff+15];
  }

  // 相机：相对于模型中心定位，自动计算最优距离
  const cx = center[0], cy = center[1], cz = center[2];
  const maxDim = Math.max(size[0], size[1], size[2], 1);
  const fovy = Math.PI / 4;
  const optimalDist = (size[1] / 2) / Math.tan(fovy / 2) * 1.12;
  const fitDist = camera.distance || Math.max(optimalDist, maxDim * 1.0);
  const camY = camera.height || (cy + size[1] * 0.05);
  const eye = [cx, camY, cz + fitDist];
  const target = [cx, cy, cz];
  const aspect = cw/ch;

  if(!renderModel._proj) renderModel._proj = new Float32Array(16);
  if(!renderModel._view) renderModel._view = new Float32Array(16);
  if(!renderModel._modelMat) renderModel._modelMat = new Float32Array([-1,0,0,0, 0,1,0,0, 0,0,-1,0, 0,0,0,1]);

  M4.perspective(renderModel._proj, Math.PI/4, aspect, 0.1, fitDist * 10 + 1000);
  M4.lookAt(renderModel._view, eye, target, [0,1,0]);

  const _eyeKey = eye[0].toFixed(2)+','+eye[1].toFixed(2)+','+eye[2].toFixed(2);
  if(_eyeKey !== renderModel._lastEyeKey){
    gl.uniform3f(loc.uCameraPos, eye[0], eye[1], eye[2]);
    renderModel._lastEyeKey = _eyeKey;
  }
  gl.uniformMatrix4fv(loc.uProj, false, renderModel._proj);
  gl.uniformMatrix4fv(loc.uView, false, renderModel._view);
  if(!renderModel._modelUploaded){
    gl.uniformMatrix4fv(loc.uModel, false, renderModel._modelMat);
    renderModel._modelUploaded = true;
  }
  if (loc.uBonePalette && palette && palette.length > 0) {
    gl.uniformMatrix4fv(loc.uBonePalette, false, palette);
  }
  gl.uniform1f(loc.uMorphEnabled, enableMorph ? 1.0 : 0.0);
  gl.uniform1f(loc.uOutlineScale, 0.0);
  // 光照设置（降低默认亮度，支持options覆盖）
  const hemIntensity = opts.hemisphereIntensity != null ? opts.hemisphereIntensity : 0.75;
  const rimIntensity = opts.rimIntensity != null ? opts.rimIntensity : 0.08;
  gl.uniform3f(loc.uLightDir, 0.5098, 0.7223, 0.4673);
  // 半球光：天空色（淡蓝）+ 地面色（淡棕）
  gl.uniform3f(loc.uHemisphereSky, 0.55, 0.65, 0.85);
  gl.uniform3f(loc.uHemisphereGround, 0.35, 0.30, 0.25);
  gl.uniform1f(loc.uHemisphereIntensity, hemIntensity);
  // 边缘光
  gl.uniform1f(loc.uRimPower, 3.0);
  gl.uniform1f(loc.uRimIntensity, rimIntensity);
  gl.uniform3f(loc.uRimColor, 0.6, 0.7, 0.95);
  // 色彩调整（曝光/饱和度/对比度/亮度）
  if(!renderModel._colorUniformLogged){
    console.log('[NativeRenderer] color uniforms:', {
      uExposure: loc.uExposure, uSaturation: loc.uSaturation,
      uContrast: loc.uContrast, uBrightness: loc.uBrightness,
      exposure: exposure, saturation: saturation, contrast: contrast, brightness: brightness
    });
    renderModel._colorUniformLogged = true;
  }
  if(loc.uExposure !== null) gl.uniform1f(loc.uExposure, exposure);
  if(loc.uSaturation !== null) gl.uniform1f(loc.uSaturation, saturation);
  if(loc.uContrast !== null) gl.uniform1f(loc.uContrast, contrast);
  if(loc.uBrightness !== null) gl.uniform1f(loc.uBrightness, brightness);
  gl.uniform1i(loc.uRawTexture, 0);

  // 绑定顶点属性 - 使用VAO如果可用
  if(renderer._vaoExt && !modelInstance._vao){
    modelInstance._vao = renderer._vaoExt.createVertexArrayOES();
    renderer._vaoExt.bindVertexArrayOES(modelInstance._vao);
    function _bindAttrib(loc,buffer,size,type){
      if(loc<0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc,size,type,false,0,0);
    }
    _bindAttrib(loc.aPosition,posBuf,3,gl.FLOAT);
    _bindAttrib(loc.aNormal,normBuf,3,gl.FLOAT);
    _bindAttrib(loc.aUV,uvBuf,2,gl.FLOAT);
    _bindAttrib(loc.aBoneIndex,boneIdxBuf,4,gl.FLOAT);
    _bindAttrib(loc.aBoneWeight,boneWeightBuf,4,gl.FLOAT);
    _bindAttrib(loc.aMorphOffset,morphOffsetBuf,3,gl.FLOAT);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    renderer._vaoExt.bindVertexArrayOES(null);
  }

  if(renderer._vaoExt && modelInstance._vao){
    renderer._vaoExt.bindVertexArrayOES(modelInstance._vao);
  } else {
    function bindAttrib(loc,buffer,size,type){
      if(loc<0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc,size,type,false,0,0);
    }
    bindAttrib(loc.aPosition,posBuf,3,gl.FLOAT);
    bindAttrib(loc.aNormal,normBuf,3,gl.FLOAT);
    bindAttrib(loc.aUV,uvBuf,2,gl.FLOAT);
    bindAttrib(loc.aBoneIndex,boneIdxBuf,4,gl.FLOAT);
    bindAttrib(loc.aBoneWeight,boneWeightBuf,4,gl.FLOAT);
    bindAttrib(loc.aMorphOffset,morphOffsetBuf,3,gl.FLOAT);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  }

  // 首帧调试输出
  if (!renderModel._debugLogged) {
    renderModel._debugLogged = true;
    console.log('[NativeRenderer] 首帧调试:', {
      canvas: cw+'x'+ch,
      vertices: model.vertexCount,
      indices: model.indices.length,
      materials: model.materials.length,
      bones: model.boneCount,
      center: center.map(v=>v.toFixed(1)),
      size: size.map(v=>v.toFixed(1)),
      camera: {eye: eye.map(v=>v.toFixed(1)), target: target.map(v=>v.toFixed(1)), fitDist: fitDist.toFixed(1)},
      paletteLen: palette.length,
      uBonePalette: !!loc.uBonePalette,
      aPosition: loc.aPosition,
      glErrCode: gl.getError()
    });
  }

  // 轮廓线渲染通道（背面剔除+法线外扩+纯色）
  if(enableOutline && outlineScale > 0){
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    gl.uniform1f(loc.uOutlineScale, outlineScale);
    gl.uniform3f(loc.uDiffuse, outlineColor[0], outlineColor[1], outlineColor[2]);
    gl.uniform3f(loc.uAmbient, 0, 0, 0);
    gl.uniform3f(loc.uSpecular, 0, 0, 0);
    gl.uniform1f(loc.uShininess, 1);
    gl.uniform1i(loc.uHasTexture, 0);
    gl.drawElements(gl.TRIANGLES, model.indices.length, gl.UNSIGNED_INT, 0);
    gl.disable(gl.CULL_FACE);
    gl.uniform1f(loc.uOutlineScale, 0.0);
  }

  // 视锥剔除：模型完全在视口外则跳过
  const _camDist = camera.distance || 50;
  const _modelRadius = Math.max(size[0], size[1], size[2]) * 0.7;
  if (_camDist > _modelRadius * 8) {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    return;
  }

  // 按材质绘制（按纹理索引排序，减少纹理绑定切换）
  let totalDrawn = 0;
  if (model.materials.length > 0) {
    const _matOrder = [];
    let _origOffset = 0;
    for(let mi=0; mi<model.materials.length; mi++){
      const _c = model.materials[mi].surfaceCount;
      _matOrder.push({mi, tex: model.materials[mi].textureIdx, count: _c, offset: _origOffset});
      _origOffset += _c;
    }
    _matOrder.sort((a,b) => (a.tex||-1) - (b.tex||-1));

    const _viewMat = renderModel._view;
    const _tanHalfFov = Math.tan(Math.PI/8);
    const _aspect = cw/ch;

    // 深度预通道：只渲染不透明材质的深度，减少overdraw
    gl.colorMask(false, false, false, false);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.uniform1i(loc.uHasTexture, 0);
    gl.uniform1i(loc.uRawTexture, 0);
    for(let _di=0; _di<_matOrder.length; _di++){
      const _dmi = _matOrder[_di].mi;
      const _dmat = model.materials[_dmi];
      const _dalpha = _dmat.diffuse[3] !== undefined ? _dmat.diffuse[3] : 1.0;
      if(_dalpha < 0.99) continue;
      const _dc = _dmat.surfaceCount;
      if(_dc <= 0) continue;
      if(materialBounds && materialBounds[_dmi]){
        const _mb = materialBounds[_dmi];
        const _vx = _viewMat[0]*_mb.cx + _viewMat[4]*_mb.cy + _viewMat[8]*_mb.cz + _viewMat[12];
        const _vy = _viewMat[1]*_mb.cx + _viewMat[5]*_mb.cy + _viewMat[9]*_mb.cz + _viewMat[13];
        const _vz = _viewMat[2]*_mb.cx + _viewMat[6]*_mb.cy + _viewMat[10]*_mb.cz + _viewMat[14];
        if(_vz > _mb.r || _vz < -2000) continue;
        const _h = (-_vz) * _tanHalfFov + _mb.r;
        const _w = _h * _aspect;
        if(Math.abs(_vx) > _w || Math.abs(_vy) > _h) continue;
      }
      gl.drawElements(gl.TRIANGLES, _dc, gl.UNSIGNED_INT, _matOrder[_di].offset*4);
    }
    gl.colorMask(true, true, true, true);
    gl.disable(gl.CULL_FACE);

    let _lastTex = -2;
    let _lastDiffR=-1,_lastDiffG=-1,_lastDiffB=-1;
    let _lastAmbR=-1,_lastAmbG=-1,_lastAmbB=-1;
    let _lastSpecR=-1,_lastSpecG=-1,_lastSpecB=-1;
    let _lastShininess=-1;
    let _lastHasTexture=-1;
    let _lastCull = -1;
    let _statDrawCalls = 0;
    let _statTexSwitches = 0;
    let _prevTex = -2;

    let _statCulled = 0;

    for(let _oi=0; _oi<_matOrder.length; _oi++){
      const mi = _matOrder[_oi].mi;
      const mat = model.materials[mi];
      const count = mat.surfaceCount;
      if(count <= 0) continue;

      // 材质级视锥剔除
      if(materialBounds && materialBounds[mi]){
        const _mb = materialBounds[mi];
        const _vx = _viewMat[0]*_mb.cx + _viewMat[4]*_mb.cy + _viewMat[8]*_mb.cz + _viewMat[12];
        const _vy = _viewMat[1]*_mb.cx + _viewMat[5]*_mb.cy + _viewMat[9]*_mb.cz + _viewMat[13];
        const _vz = _viewMat[2]*_mb.cx + _viewMat[6]*_mb.cy + _viewMat[10]*_mb.cz + _viewMat[14];
        if(_vz > _mb.r || _vz < -2000){ _statCulled++; continue; }
        const _h = (-_vz) * _tanHalfFov + _mb.r;
        const _w = _h * _aspect;
        if(Math.abs(_vx) > _w || Math.abs(_vy) > _h){ _statCulled++; continue; }
      }

      const alpha = mat.diffuse[3] !== undefined ? mat.diffuse[3] : 1.0;
      // 强制不透明：忽略材质alpha值，确保模型正常显示不透明
      const isTransparent = false;
      if(isTransparent){
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        if(_lastCull !== 0){ gl.disable(gl.CULL_FACE); _lastCull = 0; }
      } else {
        gl.depthMask(true);
        if(_lastCull !== 1){ gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); _lastCull = 1; }
      }

      // 材质颜色增强：提升饱和度和对比度，让色彩更鲜明
      const _dr = mat.diffuse[0], _dg = mat.diffuse[1], _db = mat.diffuse[2];
      // 灰度值
      const _gray = _dr * 0.299 + _dg * 0.587 + _db * 0.114;
      // 饱和度增强：向灰度值的反方向拉伸
      const _satBoost = 1.25;
      const _diffR = Math.max(0, Math.min(1, _gray + (_dr - _gray) * _satBoost));
      const _diffG = Math.max(0, Math.min(1, _gray + (_dg - _gray) * _satBoost));
      const _diffB = Math.max(0, Math.min(1, _gray + (_db - _gray) * _satBoost));
      if(_diffR!==_lastDiffR || _diffG!==_lastDiffG || _diffB!==_lastDiffB){
        gl.uniform3f(loc.uDiffuse, _diffR, _diffG, _diffB);
        _lastDiffR=_diffR; _lastDiffG=_diffG; _lastDiffB=_diffB;
      }
      const _ambR=mat.ambient[0]*0.7, _ambG=mat.ambient[1]*0.7, _ambB=mat.ambient[2]*0.7;
      if(_ambR!==_lastAmbR || _ambG!==_lastAmbG || _ambB!==_lastAmbB){
        gl.uniform3f(loc.uAmbient, _ambR, _ambG, _ambB);
        _lastAmbR=_ambR; _lastAmbG=_ambG; _lastAmbB=_ambB;
      }
      if(mat.specular[0]!==_lastSpecR || mat.specular[1]!==_lastSpecG || mat.specular[2]!==_lastSpecB){
        gl.uniform3f(loc.uSpecular, mat.specular[0], mat.specular[1], mat.specular[2]);
        _lastSpecR=mat.specular[0]; _lastSpecG=mat.specular[1]; _lastSpecB=mat.specular[2];
      }
      if(mat.shininess!==_lastShininess){
        gl.uniform1f(loc.uShininess, mat.shininess);
        _lastShininess=mat.shininess;
      }

      const texIdx = mat.textureIdx;
      if(texIdx !== _lastTex){
        if(_prevTex !== -2 && texIdx !== _prevTex) _statTexSwitches++;
        _prevTex = texIdx;
        const tex = texIdx >= 0 ? textures[texIdx] : null;
        if(tex){
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.uniform1i(loc.uTexture, 0);
          if(_lastHasTexture !== 1){ gl.uniform1i(loc.uHasTexture, 1); _lastHasTexture=1; }
        } else {
          if(_lastHasTexture !== 0){ gl.uniform1i(loc.uHasTexture, 0); _lastHasTexture=0; }
        }
        _lastTex = texIdx;
      }

      const _mn = mat.name || '';
      const _isEye = _mn.indexOf('目')>=0 || _mn.indexOf('眼')>=0 || _mn.indexOf('瞳')>=0 || _mn.indexOf('眉')>=0;
      if(_isEye){ gl.disable(gl.DEPTH_TEST); } else { gl.enable(gl.DEPTH_TEST); }
      gl.uniform1i(loc.uRawTexture, 0);

      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, _matOrder[_oi].offset*4);
      totalDrawn += count;
      _statDrawCalls++;

      if(isTransparent) gl.depthMask(true);
    }
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    renderModel._lastDrawCalls = _statDrawCalls;
    renderModel._lastTexSwitches = _statTexSwitches;
    renderModel._lastCulled = _statCulled;
  } else {
    // 无材质回退：用默认颜色绘制所有索引
    console.log('[NativeRenderer] 无材质数据，使用回退绘制（默认灰色）');
    gl.uniform3f(loc.uDiffuse, 0.7, 0.7, 0.75);
    gl.uniform3f(loc.uAmbient, 0.3, 0.3, 0.35);
    gl.uniform3f(loc.uSpecular, 0.1, 0.1, 0.1);
    gl.uniform1f(loc.uShininess, 10);
    gl.uniform1i(loc.uHasTexture, 0);
    gl.drawElements(gl.TRIANGLES, model.indices.length, gl.UNSIGNED_INT, 0);
    totalDrawn = model.indices.length;
  }

  renderModel._frameCount = (renderModel._frameCount || 0) + 1;
  if(renderModel._frameCount === 1){ renderModel._fpsStartTime = _now; }
  if(renderModel._frameCount % 120 === 0){
    const _elapsed = _now - (renderModel._fpsStartTime || _now);
    const _fps = _elapsed > 0 ? Math.round(120 / _elapsed) : 0;
    console.log('[NativeRenderer] FPS=' + _fps + ' 帧=' + renderModel._frameCount + ' 三角形=' + (totalDrawn/3) + ' drawCall=' + (renderModel._lastDrawCalls||0) + ' 剔除=' + (renderModel._lastCulled||0) + ' 纹切=' + (renderModel._lastTexSwitches||0) + ' 画布=' + cw + 'x' + ch + ' VAO=' + !!(renderer._vaoExt && modelInstance._vao));
    renderModel._fpsStartTime = _now;
    const err = gl.getError();
    if (err !== 0 && !renderModel._errLogged) {
      renderModel._errLogged = true;
      console.error('[NativeRenderer] WebGL错误码:', err, '绘制三角形:', totalDrawn/3);
    }
  }
}

