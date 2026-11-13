
/* ===== 后期处理景深系统 ===== */
function createDepthOfFieldEffect(gl, width, height, options){
  const opt = options || {};
  const dof = {
    gl: gl, width, height,
    focus: opt.focus || 10,
    aperture: opt.aperture || 0.025,
    maxBlur: opt.maxBlur || 0.01,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  dof._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uColor; uniform sampler2D uDepth; uniform float uFocus; uniform float uAperture; uniform float uMaxBlur; uniform vec2 uTexel; void main(){ float depth=texture2D(uDepth,vUV).r; float blur=abs(depth-uFocus)*uAperture; blur=min(blur,uMaxBlur); vec4 color=vec4(0.0); float total=0.0; for(int x=-4;x<=4;x++){ for(int y=-4;y<=4;y++){ vec2 offset=vec2(float(x),float(y))*uTexel*blur*10.0; float w=1.0-length(vec2(float(x),float(y)))*0.1; color+=texture2D(uColor,vUV+offset)*w; total+=w; } } gl_FragColor=color/total; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  dof._program=gl.createProgram();
  gl.attachShader(dof._program,vs);
  gl.attachShader(dof._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(dof._program);
  function render(colorTexture, depthTexture){
    if(!dof.enabled) return colorTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,dof._framebuffer.framebuffer);
    gl.viewport(0,0,dof.width,dof.height);
    gl.useProgram(dof._program);
    const aPos=gl.getAttribLocation(dof._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,colorTexture); gl.uniform1i(gl.getUniformLocation(dof._program,'uColor'),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,depthTexture); gl.uniform1i(gl.getUniformLocation(dof._program,'uDepth'),1);
    gl.uniform1f(gl.getUniformLocation(dof._program,'uFocus'),dof.focus);
    gl.uniform1f(gl.getUniformLocation(dof._program,'uAperture'),dof.aperture);
    gl.uniform1f(gl.getUniformLocation(dof._program,'uMaxBlur'),dof.maxBlur);
    gl.uniform2f(gl.getUniformLocation(dof._program,'uTexel'),1/dof.width,1/dof.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return dof._framebuffer.texture;
  }
  function resize(w,h){ dof.width=w; dof.height=h; }
  function dispose(){ gl.deleteFramebuffer(dof._framebuffer.framebuffer); gl.deleteTexture(dof._framebuffer.texture); gl.deleteProgram(dof._program); }
  console.log('[DOFEffect] 创建完成 focus=' + dof.focus);
  return { render, resize, dispose, dof };
}

/* ===== 后期处理运动模糊系统 ===== */
function createMotionBlurEffect(gl, width, height, options){
  const opt = options || {};
  const mb = {
    gl: gl, width, height,
    strength: opt.strength || 0.5,
    samples: opt.samples || 16,
    enabled: true,
    _program: null,
    _framebuffer: null,
    _velocityTexture: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  mb._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uColor; uniform sampler2D uVelocity; uniform float uStrength; uniform int uSamples; void main(){ vec2 velocity=texture2D(uVelocity,vUV).xy*uStrength; vec4 color=vec4(0.0); for(int i=0;i<32;i++){ if(i>=uSamples) break; float t=float(i)/float(uSamples); vec2 offset=velocity*(t-0.5); color+=texture2D(uColor,vUV+offset); } gl_FragColor=color/float(uSamples); }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  mb._program=gl.createProgram();
  gl.attachShader(mb._program,vs);
  gl.attachShader(mb._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(mb._program);
  function render(colorTexture, velocityTexture){
    if(!mb.enabled) return colorTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,mb._framebuffer.framebuffer);
    gl.viewport(0,0,mb.width,mb.height);
    gl.useProgram(mb._program);
    const aPos=gl.getAttribLocation(mb._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,colorTexture); gl.uniform1i(gl.getUniformLocation(mb._program,'uColor'),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,velocityTexture); gl.uniform1i(gl.getUniformLocation(mb._program,'uVelocity'),1);
    gl.uniform1f(gl.getUniformLocation(mb._program,'uStrength'),mb.strength);
    gl.uniform1i(gl.getUniformLocation(mb._program,'uSamples'),mb.samples);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return mb._framebuffer.texture;
  }
  function resize(w,h){ mb.width=w; mb.height=h; }
  function dispose(){ gl.deleteFramebuffer(mb._framebuffer.framebuffer); gl.deleteTexture(mb._framebuffer.texture); gl.deleteProgram(mb._program); }
  console.log('[MotionBlurEffect] 创建完成 strength=' + mb.strength + ' samples=' + mb.samples);
  return { render, resize, dispose, mb };
}

/* ===== 后期处理色调映射系统 ===== */
function createToneMappingEffect(gl, width, height, options){
  const opt = options || {};
  const tm = {
    gl: gl, width, height,
    type: opt.type !== undefined ? opt.type : ToneMappingType.ACES,
    exposure: opt.exposure !== undefined ? opt.exposure : 1,
    whitePoint: opt.whitePoint || 11.2,
    contrast: opt.contrast !== undefined ? opt.contrast : 1,
    saturation: opt.saturation !== undefined ? opt.saturation : 1,
    gamma: opt.gamma !== undefined ? opt.gamma : 2.2,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  tm._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform int uType; uniform float uExposure; uniform float uWhitePoint; uniform float uContrast; uniform float uSaturation; uniform float uGamma;
    vec3 reinhard(vec3 c){ return c/(1.0+c); }
    vec3 reinhardExtended(vec3 c, float wp){ float w=wp*wp; return c*(1.0+c/w)/(1.0+c); }
    vec3 aces(vec3 c){ float a=2.51,b=0.03,cc=2.43,d=0.59,e=0.14; return max(vec3(0.0),(c*(a*c+b))/(c*(cc*c+d)+e)); }
    vec3 acesFilmic(vec3 c, float wp){ float a=0.6,b=0.13,cc=0.1,d=0.0,e=0.01,f=0.3; vec3 wb=vec3(wp); wb=((wb*(a*wb+b*cc)+d*e)/(wb*(a*wb+b)+d*f))-e/f; c=((c*(a*c+b*cc)+d*e)/(c*(a*c+b)+d*f))-e/f; return c/wb; }
    vec3 uncharted2(vec3 c, float wp){ float a=0.15,b=0.5,cc=0.1,d=0.2,e=0.02,f=0.3; vec3 wb=vec3(wp); wb=((wb*(a*wb+cc*b)+d*e)/(wb*(a*wb+b)+d*f))-e/f; c=((c*(a*c+cc*b)+d*e)/(c*(a*c+b)+d*f))-e/f; return c/wb; }
    vec3 agx(vec3 c){ vec3 x2=c*c, x3=x2*c; return c*(3.4*x2+1.0)/(3.4*x3+2.1*x2+1.0); }
    void main(){ vec4 color=texture2D(uTex,vUV); vec3 c=color.rgb*uExposure;
      if(uType==1) c=reinhard(c);
      else if(uType==2) c=reinhardExtended(c,uWhitePoint);
      else if(uType==3) c=aces(c);
      else if(uType==4) c=acesFilmic(c,uWhitePoint);
      else if(uType==5) c=uncharted2(c,uWhitePoint);
      else if(uType==6) c=agx(c);
      c=(c-0.5)*uContrast+0.5;
      float gray=dot(c,vec3(0.299,0.587,0.114));
      c=mix(vec3(gray),c,uSaturation);
      c=pow(max(c,vec3(0.0)),vec3(1.0/uGamma));
      gl_FragColor=vec4(c,color.a);
    }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  tm._program=gl.createProgram();
  gl.attachShader(tm._program,vs);
  gl.attachShader(tm._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(tm._program);
  function render(inputTexture){
    if(!tm.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,tm._framebuffer.framebuffer);
    gl.viewport(0,0,tm.width,tm.height);
    gl.useProgram(tm._program);
    const aPos=gl.getAttribLocation(tm._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(tm._program,'uTex'),0);
    gl.uniform1i(gl.getUniformLocation(tm._program,'uType'),tm.type);
    gl.uniform1f(gl.getUniformLocation(tm._program,'uExposure'),tm.exposure);
    gl.uniform1f(gl.getUniformLocation(tm._program,'uWhitePoint'),tm.whitePoint);
    gl.uniform1f(gl.getUniformLocation(tm._program,'uContrast'),tm.contrast);
    gl.uniform1f(gl.getUniformLocation(tm._program,'uSaturation'),tm.saturation);
    gl.uniform1f(gl.getUniformLocation(tm._program,'uGamma'),tm.gamma);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return tm._framebuffer.texture;
  }
  function resize(w,h){ tm.width=w; tm.height=h; }
  function dispose(){ gl.deleteFramebuffer(tm._framebuffer.framebuffer); gl.deleteTexture(tm._framebuffer.texture); gl.deleteProgram(tm._program); }
  console.log('[ToneMappingEffect] 创建完成 type=' + tm.type);
  return { render, resize, dispose, tm };
}

/* ===== 后期处理色彩空间转换系统 ===== */
function createColorSpaceConversion(gl, width, height, options){
  const opt = options || {};
  const csc = {
    gl: gl, width, height,
    inputSpace: opt.inputSpace !== undefined ? opt.inputSpace : ColorSpace.LINEAR,
    outputSpace: opt.outputSpace !== undefined ? opt.outputSpace : ColorSpace.SRGB,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  csc._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform int uInput; uniform int uOutput;
    float srgbToLinear(float c){ return c<=0.04045?c/12.92:pow((c+0.055)/1.055,2.4); }
    float linearToSrgb(float c){ return c<=0.0031308?c*12.92:1.055*pow(c,1.0/2.4)-0.055; }
    vec3 convert(vec3 c, int from, int to){
      if(from==to) return c;
      vec3 linear=c;
      if(from==0) linear=vec3(srgbToLinear(c.r),srgbToLinear(c.g),srgbToLinear(c.b));
      if(to==0) return vec3(linearToSrgb(linear.r),linearToSrgb(linear.g),linearToSrgb(linear.b));
      return linear;
    }
    void main(){ vec4 color=texture2D(uTex,vUV); gl_FragColor=vec4(convert(color.rgb,uInput,uOutput),color.a); }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  csc._program=gl.createProgram();
  gl.attachShader(csc._program,vs);
  gl.attachShader(csc._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(csc._program);
  function render(inputTexture){
    if(!csc.enabled || csc.inputSpace===csc.outputSpace) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,csc._framebuffer.framebuffer);
    gl.viewport(0,0,csc.width,csc.height);
    gl.useProgram(csc._program);
    const aPos=gl.getAttribLocation(csc._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(csc._program,'uTex'),0);
    gl.uniform1i(gl.getUniformLocation(csc._program,'uInput'),csc.inputSpace);
    gl.uniform1i(gl.getUniformLocation(csc._program,'uOutput'),csc.outputSpace);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return csc._framebuffer.texture;
  }
  function resize(w,h){ csc.width=w; csc.height=h; }
  function dispose(){ gl.deleteFramebuffer(csc._framebuffer.framebuffer); gl.deleteTexture(csc._framebuffer.texture); gl.deleteProgram(csc._program); }
  console.log('[ColorSpaceConversion] 创建完成 ' + csc.inputSpace + ' -> ' + csc.outputSpace);
  return { render, resize, dispose, csc };
}

/* ===== 后期处理伽马校正系统 ===== */
function createGammaCorrection(gl, width, height, options){
  const opt = options || {};
  const gc = {
    gl: gl, width, height,
    gamma: opt.gamma !== undefined ? opt.gamma : 2.2,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  gc._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uGamma; void main(){ vec4 color=texture2D(uTex,vUV); color.rgb=pow(max(color.rgb,vec3(0.0)),vec3(1.0/uGamma)); gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  gc._program=gl.createProgram();
  gl.attachShader(gc._program,vs);
  gl.attachShader(gc._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(gc._program);
  function render(inputTexture){
    if(!gc.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,gc._framebuffer.framebuffer);
    gl.viewport(0,0,gc.width,gc.height);
    gl.useProgram(gc._program);
    const aPos=gl.getAttribLocation(gc._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(gc._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(gc._program,'uGamma'),gc.gamma);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return gc._framebuffer.texture;
  }
  function resize(w,h){ gc.width=w; gc.height=h; }
  function dispose(){ gl.deleteFramebuffer(gc._framebuffer.framebuffer); gl.deleteTexture(gc._framebuffer.texture); gl.deleteProgram(gc._program); }
  console.log('[GammaCorrection] 创建完成 gamma=' + gc.gamma);
  return { render, resize, dispose, gc };
}

/* ===== 后期处理曝光系统 ===== */
function createExposure(gl, width, height, options){
  const opt = options || {};
  const exp = {
    gl: gl, width, height,
    exposure: opt.exposure !== undefined ? opt.exposure : 1,
    autoExposure: opt.autoExposure || false,
    minExposure: opt.minExposure || 0.1,
    maxExposure: opt.maxExposure || 10,
    targetLuminance: opt.targetLuminance || 0.5,
    adaptationSpeed: opt.adaptationSpeed || 1,
    _currentExposure: opt.exposure !== undefined ? opt.exposure : 1,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  exp._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uExposure; void main(){ vec4 color=texture2D(uTex,vUV); color.rgb*=uExposure; gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  exp._program=gl.createProgram();
  gl.attachShader(exp._program,vs);
  gl.attachShader(exp._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(exp._program);
  function update(dt, inputTexture){
    if(!exp.autoExposure) return;
    exp._currentExposure += (exp.exposure-exp._currentExposure)*Math.min(1,dt*exp.adaptationSpeed);
  }
  function render(inputTexture){
    if(!exp.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,exp._framebuffer.framebuffer);
    gl.viewport(0,0,exp.width,exp.height);
    gl.useProgram(exp._program);
    const aPos=gl.getAttribLocation(exp._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(exp._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(exp._program,'uExposure'),exp.autoExposure?exp._currentExposure:exp.exposure);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return exp._framebuffer.texture;
  }
  function resize(w,h){ exp.width=w; exp.height=h; }
  function dispose(){ gl.deleteFramebuffer(exp._framebuffer.framebuffer); gl.deleteTexture(exp._framebuffer.texture); gl.deleteProgram(exp._program); }
  console.log('[Exposure] 创建完成 exposure=' + exp.exposure);
  return { update, render, resize, dispose, exp };
}

/* ===== 后期处理白平衡系统 ===== */
function createWhiteBalance(gl, width, height, options){
  const opt = options || {};
  const wb = {
    gl: gl, width, height,
    temperature: opt.temperature !== undefined ? opt.temperature : 0,
    tint: opt.tint !== undefined ? opt.tint : 0,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  wb._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uTemperature; uniform float uTint;
    vec3 temperatureColor(float t){ vec3 c=vec3(1.0); if(t<0.0){ c.b=1.0+min(0.6,-t*0.01); c.r=1.0+min(0.6,t*0.01); } else { c.r=1.0+min(0.6,t*0.01); c.b=1.0-min(0.6,t*0.01); } return c; }
    void main(){ vec4 color=texture2D(uTex,vUV); vec3 temp=temperatureColor(uTemperature); color.rgb*=temp; color.g+=uTint*0.01; color.r-=uTint*0.005; color.b-=uTint*0.005; gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  wb._program=gl.createProgram();
  gl.attachShader(wb._program,vs);
  gl.attachShader(wb._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(wb._program);
  function render(inputTexture){
    if(!wb.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,wb._framebuffer.framebuffer);
    gl.viewport(0,0,wb.width,wb.height);
    gl.useProgram(wb._program);
    const aPos=gl.getAttribLocation(wb._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(wb._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(wb._program,'uTemperature'),wb.temperature);
    gl.uniform1f(gl.getUniformLocation(wb._program,'uTint'),wb.tint);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return wb._framebuffer.texture;
  }
  function resize(w,h){ wb.width=w; wb.height=h; }
  function dispose(){ gl.deleteFramebuffer(wb._framebuffer.framebuffer); gl.deleteTexture(wb._framebuffer.texture); gl.deleteProgram(wb._program); }
  console.log('[WhiteBalance] 创建完成 temperature=' + wb.temperature + ' tint=' + wb.tint);
  return { render, resize, dispose, wb };
}

/* ===== 后期处理对比度系统 ===== */
function createContrast(gl, width, height, options){
  const opt = options || {};
  const c = {
    gl: gl, width, height,
    contrast: opt.contrast !== undefined ? opt.contrast : 1,
    brightness: opt.brightness !== undefined ? opt.brightness : 0,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  c._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uContrast; uniform float uBrightness; void main(){ vec4 color=texture2D(uTex,vUV); color.rgb=(color.rgb-0.5)*uContrast+0.5+uBrightness; gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  c._program=gl.createProgram();
  gl.attachShader(c._program,vs);
  gl.attachShader(c._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(c._program);
  function render(inputTexture){
    if(!c.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,c._framebuffer.framebuffer);
    gl.viewport(0,0,c.width,c.height);
    gl.useProgram(c._program);
    const aPos=gl.getAttribLocation(c._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(c._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(c._program,'uContrast'),c.contrast);
    gl.uniform1f(gl.getUniformLocation(c._program,'uBrightness'),c.brightness);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return c._framebuffer.texture;
  }
  function resize(w,h){ c.width=w; c.height=h; }
  function dispose(){ gl.deleteFramebuffer(c._framebuffer.framebuffer); gl.deleteTexture(c._framebuffer.texture); gl.deleteProgram(c._program); }
  console.log('[Contrast] 创建完成 contrast=' + c.contrast);
  return { render, resize, dispose, c };
}

/* ===== 后期处理饱和度系统 ===== */
function createSaturation(gl, width, height, options){
  const opt = options || {};
  const s = {
    gl: gl, width, height,
    saturation: opt.saturation !== undefined ? opt.saturation : 1,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  s._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uSaturation; void main(){ vec4 color=texture2D(uTex,vUV); float gray=dot(color.rgb,vec3(0.299,0.587,0.114)); color.rgb=mix(vec3(gray),color.rgb,uSaturation); gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  s._program=gl.createProgram();
  gl.attachShader(s._program,vs);
  gl.attachShader(s._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(s._program);
  function render(inputTexture){
    if(!s.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,s._framebuffer.framebuffer);
    gl.viewport(0,0,s.width,s.height);
    gl.useProgram(s._program);
    const aPos=gl.getAttribLocation(s._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(s._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(s._program,'uSaturation'),s.saturation);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return s._framebuffer.texture;
  }
  function resize(w,h){ s.width=w; s.height=h; }
  function dispose(){ gl.deleteFramebuffer(s._framebuffer.framebuffer); gl.deleteTexture(s._framebuffer.texture); gl.deleteProgram(s._program); }
  console.log('[Saturation] 创建完成 saturation=' + s.saturation);
  return { render, resize, dispose, s };
}

/* ===== 后期处理亮度系统 ===== */
function createBrightness(gl, width, height, options){
  const opt = options || {};
  const b = {
    gl: gl, width, height,
    brightness: opt.brightness !== undefined ? opt.brightness : 0,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  b._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uBrightness; void main(){ vec4 color=texture2D(uTex,vUV); color.rgb+=uBrightness; gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  b._program=gl.createProgram();
  gl.attachShader(b._program,vs);
  gl.attachShader(b._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(b._program);
  function render(inputTexture){
    if(!b.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,b._framebuffer.framebuffer);
    gl.viewport(0,0,b.width,b.height);
    gl.useProgram(b._program);
    const aPos=gl.getAttribLocation(b._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(b._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(b._program,'uBrightness'),b.brightness);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return b._framebuffer.texture;
  }
  function resize(w,h){ b.width=w; b.height=h; }
  function dispose(){ gl.deleteFramebuffer(b._framebuffer.framebuffer); gl.deleteTexture(b._framebuffer.texture); gl.deleteProgram(b._program); }
  console.log('[Brightness] 创建完成 brightness=' + b.brightness);
  return { render, resize, dispose, b };
}

/* ===== 后期处理色相系统 ===== */
function createHueShift(gl, width, height, options){
  const opt = options || {};
  const h = {
    gl: gl, width, height,
    hue: opt.hue !== undefined ? opt.hue : 0,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  h._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uHue;
    vec3 rgb2hsv(vec3 c){ float mx=max(c.r,max(c.g,c.b)), mn=min(c.r,min(c.g,c.b)); float d=mx-mn; vec3 hsv=vec3(0.0,0.0,mx); if(d!=0.0){ hsv.y=d/mx; if(c.r==mx) hsv.x=(c.g-c.b)/d+(c.g<c.b?6.0:0.0); else if(c.g==mx) hsv.x=(c.b-c.r)/d+2.0; else hsv.x=(c.r-c.g)/d+4.0; hsv.x/=6.0; } return hsv; }
    vec3 hsv2rgb(vec3 hsv){ vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0); vec3 p=abs(fract(hsv.xxx+K.xyz)*6.0-K.www); return hsv.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),hsv.y); }
    void main(){ vec4 color=texture2D(uTex,vUV); vec3 hsv=rgb2hsv(color.rgb); hsv.x=fract(hsv.x+uHue/360.0); color.rgb=hsv2rgb(hsv); gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  h._program=gl.createProgram();
  gl.attachShader(h._program,vs);
  gl.attachShader(h._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(h._program);
  function render(inputTexture){
    if(!h.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,h._framebuffer.framebuffer);
    gl.viewport(0,0,h.width,h.height);
    gl.useProgram(h._program);
    const aPos=gl.getAttribLocation(h._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(h._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(h._program,'uHue'),h.hue);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return h._framebuffer.texture;
  }
  function resize(w,h){ h.width=w; h.height=h; }
  function dispose(){ gl.deleteFramebuffer(h._framebuffer.framebuffer); gl.deleteTexture(h._framebuffer.texture); gl.deleteProgram(h._program); }
  console.log('[HueShift] 创建完成 hue=' + h.hue);
  return { render, resize, dispose, h };
}

/* ===== 后期处理色温系统 ===== */
function createColorTemperature(gl, width, height, options){
  const opt = options || {};
  const ct = {
    gl: gl, width, height,
    temperature: opt.temperature !== undefined ? opt.temperature : 0,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  ct._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uTemperature;
    vec3 tempColor(float t){ vec3 c=vec3(1.0); if(t<0.0){ c.b=1.0+min(0.6,-t*0.01); c.r=1.0+min(0.6,t*0.01); } else { c.r=1.0+min(0.6,t*0.01); c.b=1.0-min(0.6,t*0.01); } return c; }
    void main(){ vec4 color=texture2D(uTex,vUV); vec3 temp=tempColor(uTemperature); color.rgb*=temp; gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  ct._program=gl.createProgram();
  gl.attachShader(ct._program,vs);
  gl.attachShader(ct._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(ct._program);
  function render(inputTexture){
    if(!ct.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,ct._framebuffer.framebuffer);
    gl.viewport(0,0,ct.width,ct.height);
    gl.useProgram(ct._program);
    const aPos=gl.getAttribLocation(ct._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(ct._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(ct._program,'uTemperature'),ct.temperature);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return ct._framebuffer.texture;
  }
  function resize(w,h){ ct.width=w; ct.height=h; }
  function dispose(){ gl.deleteFramebuffer(ct._framebuffer.framebuffer); gl.deleteTexture(ct._framebuffer.texture); gl.deleteProgram(ct._program); }
  console.log('[ColorTemperature] 创建完成 temperature=' + ct.temperature);
  return { render, resize, dispose, ct };
}

/* ===== 后期处理色彩平衡系统 ===== */
function createColorBalance(gl, width, height, options){
  const opt = options || {};
  const cb = {
    gl: gl, width, height,
    shadows: opt.shadows ? opt.shadows.slice() : [0,0,0],
    midtones: opt.midtones ? opt.midtones.slice() : [0,0,0],
    highlights: opt.highlights ? opt.highlights.slice() : [0,0,0],
    preserveLuminosity: opt.preserveLuminosity !== undefined ? opt.preserveLuminosity : true,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  cb._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec3 uShadows; uniform vec3 uMidtones; uniform vec3 uHighlights; uniform int uPreserveLuminosity;
    void main(){ vec4 color=texture2D(uTex,vUV); float luma=dot(color.rgb,vec3(0.299,0.587,0.114)); float shadowMask=1.0-smoothstep(0.0,0.5,luma); float highlightMask=smoothstep(0.5,1.0,luma); float midtoneMask=1.0-shadowMask-highlightMask; vec3 balance=uShadows*shadowMask+uMidtones*midtoneMask+uHighlights*highlightMask; color.rgb+=balance; if(uPreserveLuminosity==1){ float newLuma=dot(color.rgb,vec3(0.299,0.587,0.114)); color.rgb*=luma/max(newLuma,0.001); } gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  cb._program=gl.createProgram();
  gl.attachShader(cb._program,vs);
  gl.attachShader(cb._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(cb._program);
  function render(inputTexture){
    if(!cb.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,cb._framebuffer.framebuffer);
    gl.viewport(0,0,cb.width,cb.height);
    gl.useProgram(cb._program);
    const aPos=gl.getAttribLocation(cb._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(cb._program,'uTex'),0);
    gl.uniform3fv(gl.getUniformLocation(cb._program,'uShadows'),cb.shadows);
    gl.uniform3fv(gl.getUniformLocation(cb._program,'uMidtones'),cb.midtones);
    gl.uniform3fv(gl.getUniformLocation(cb._program,'uHighlights'),cb.highlights);
    gl.uniform1i(gl.getUniformLocation(cb._program,'uPreserveLuminosity'),cb.preserveLuminosity?1:0);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return cb._framebuffer.texture;
  }
  function resize(w,h){ cb.width=w; cb.height=h; }
  function dispose(){ gl.deleteFramebuffer(cb._framebuffer.framebuffer); gl.deleteTexture(cb._framebuffer.texture); gl.deleteProgram(cb._program); }
  console.log('[ColorBalance] 创建完成');
  return { render, resize, dispose, cb };
}

/* ===== 后期处理曲线系统 ===== */
function createCurves(gl, width, height, options){
  const opt = options || {};
  const cv = {
    gl: gl, width, height,
    redCurve: opt.redCurve ? opt.redCurve.slice() : [0,0.25,0.5,0.75,1],
    greenCurve: opt.greenCurve ? opt.greenCurve.slice() : [0,0.25,0.5,0.75,1],
    blueCurve: opt.blueCurve ? opt.blueCurve.slice() : [0,0.25,0.5,0.75,1],
    rgbCurve: opt.rgbCurve ? opt.rgbCurve.slice() : [0,0.25,0.5,0.75,1],
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  cv._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uRed[5]; uniform float uGreen[5]; uniform float uBlue[5]; uniform float uRGB[5];
    float sampleCurve(float x, float c[5]){ float t=x*4.0; int i=int(floor(t)); float f=fract(t); if(i>=4) return c[4]; if(i<0) return c[0]; return mix(c[i],c[i+1],f); }
    void main(){ vec4 color=texture2D(uTex,vUV); color.r=sampleCurve(color.r,uRed); color.g=sampleCurve(color.g,uGreen); color.b=sampleCurve(color.b,uBlue); color.rgb=vec3(sampleCurve(color.r,uRGB),sampleCurve(color.g,uRGB),sampleCurve(color.b,uRGB)); gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  cv._program=gl.createProgram();
  gl.attachShader(cv._program,vs);
  gl.attachShader(cv._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(cv._program);
  function render(inputTexture){
    if(!cv.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,cv._framebuffer.framebuffer);
    gl.viewport(0,0,cv.width,cv.height);
    gl.useProgram(cv._program);
    const aPos=gl.getAttribLocation(cv._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(cv._program,'uTex'),0);
    gl.uniform1fv(gl.getUniformLocation(cv._program,'uRed[0]'),cv.redCurve);
    gl.uniform1fv(gl.getUniformLocation(cv._program,'uGreen[0]'),cv.greenCurve);
    gl.uniform1fv(gl.getUniformLocation(cv._program,'uBlue[0]'),cv.blueCurve);
    gl.uniform1fv(gl.getUniformLocation(cv._program,'uRGB[0]'),cv.rgbCurve);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return cv._framebuffer.texture;
  }
  function resize(w,h){ cv.width=w; cv.height=h; }
  function dispose(){ gl.deleteFramebuffer(cv._framebuffer.framebuffer); gl.deleteTexture(cv._framebuffer.texture); gl.deleteProgram(cv._program); }
  console.log('[Curves] 创建完成');
  return { render, resize, dispose, cv };
}