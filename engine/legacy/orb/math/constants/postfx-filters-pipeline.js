
/* ===== 后期处理高反差保留系统 ===== */
function createHighPass(gl, width, height, options){
  const opt = options || {};
  const hp = {
    gl: gl, width, height,
    radius: opt.radius !== undefined ? opt.radius : 1,
    amount: opt.amount !== undefined ? opt.amount : 1,
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
  hp._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uRadius; uniform float uAmount; uniform vec2 uTexel;
    void main(){ vec4 center=texture2D(uTex,vUV); vec4 blur=vec4(0.0); float total=0.0; for(int x=-3;x<=3;x++){ for(int y=-3;y<=3;y++){ float weight=exp(-(float(x*x+y*y))/(2.0*uRadius*uRadius)); blur+=texture2D(uTex,vUV+vec2(float(x),float(y))*uTexel)*weight; total+=weight; } } blur/=total; vec4 highpass=center-blur+0.5; gl_FragColor=mix(center,highpass,uAmount); }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  hp._program=gl.createProgram();
  gl.attachShader(hp._program,vs);
  gl.attachShader(hp._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(hp._program);
  function render(inputTexture){
    if(!hp.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,hp._framebuffer.framebuffer);
    gl.viewport(0,0,hp.width,hp.height);
    gl.useProgram(hp._program);
    const aPos=gl.getAttribLocation(hp._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(hp._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(hp._program,'uRadius'),hp.radius);
    gl.uniform1f(gl.getUniformLocation(hp._program,'uAmount'),hp.amount);
    gl.uniform2f(gl.getUniformLocation(hp._program,'uTexel'),1/hp.width,1/hp.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return hp._framebuffer.texture;
  }
  function resize(w,h){ hp.width=w; hp.height=h; }
  function dispose(){ gl.deleteFramebuffer(hp._framebuffer.framebuffer); gl.deleteTexture(hp._framebuffer.texture); gl.deleteProgram(hp._program); }
  console.log('[HighPass] 创建完成 radius=' + hp.radius);
  return { render, resize, dispose, hp };
}

/* ===== 后期处理最小值系统 ===== */
function createMinimum(gl, width, height, options){
  const opt = options || {};
  const mn = {
    gl: gl, width, height,
    radius: opt.radius || 1,
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
  mn._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform int uRadius; uniform vec2 uTexel;
    void main(){ vec4 minVal=vec4(1.0); for(int x=-3;x<=3;x++){ for(int y=-3;y<=3;y++){ if(abs(x)<=uRadius&&abs(y)<=uRadius){ vec4 sample=texture2D(uTex,vUV+vec2(float(x),float(y))*uTexel); minVal=min(minVal,sample); } } } gl_FragColor=minVal; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  mn._program=gl.createProgram();
  gl.attachShader(mn._program,vs);
  gl.attachShader(mn._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(mn._program);
  function render(inputTexture){
    if(!mn.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,mn._framebuffer.framebuffer);
    gl.viewport(0,0,mn.width,mn.height);
    gl.useProgram(mn._program);
    const aPos=gl.getAttribLocation(mn._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(mn._program,'uTex'),0);
    gl.uniform1i(gl.getUniformLocation(mn._program,'uRadius'),mn.radius);
    gl.uniform2f(gl.getUniformLocation(mn._program,'uTexel'),1/mn.width,1/mn.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return mn._framebuffer.texture;
  }
  function resize(w,h){ mn.width=w; mn.height=h; }
  function dispose(){ gl.deleteFramebuffer(mn._framebuffer.framebuffer); gl.deleteTexture(mn._framebuffer.texture); gl.deleteProgram(mn._program); }
  console.log('[Minimum] 创建完成 radius=' + mn.radius);
  return { render, resize, dispose, mn };
}

/* ===== 后期处理最大值系统 ===== */
function createMaximum(gl, width, height, options){
  const opt = options || {};
  const mx = {
    gl: gl, width, height,
    radius: opt.radius || 1,
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
  mx._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform int uRadius; uniform vec2 uTexel;
    void main(){ vec4 maxVal=vec4(0.0); for(int x=-3;x<=3;x++){ for(int y=-3;y<=3;y++){ if(abs(x)<=uRadius&&abs(y)<=uRadius){ vec4 sample=texture2D(uTex,vUV+vec2(float(x),float(y))*uTexel); maxVal=max(maxVal,sample); } } } gl_FragColor=maxVal; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  mx._program=gl.createProgram();
  gl.attachShader(mx._program,vs);
  gl.attachShader(mx._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(mx._program);
  function render(inputTexture){
    if(!mx.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,mx._framebuffer.framebuffer);
    gl.viewport(0,0,mx.width,mx.height);
    gl.useProgram(mx._program);
    const aPos=gl.getAttribLocation(mx._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(mx._program,'uTex'),0);
    gl.uniform1i(gl.getUniformLocation(mx._program,'uRadius'),mx.radius);
    gl.uniform2f(gl.getUniformLocation(mx._program,'uTexel'),1/mx.width,1/mx.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return mx._framebuffer.texture;
  }
  function resize(w,h){ mx.width=w; mx.height=h; }
  function dispose(){ gl.deleteFramebuffer(mx._framebuffer.framebuffer); gl.deleteTexture(mx._framebuffer.texture); gl.deleteProgram(mx._program); }
  console.log('[Maximum] 创建完成 radius=' + mx.radius);
  return { render, resize, dispose, mx };
}

/* ===== 后期处理中值滤波系统 ===== */
function createMedianFilter(gl, width, height, options){
  const opt = options || {};
  const mf = {
    gl: gl, width, height,
    radius: opt.radius || 1,
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
  mf._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform int uRadius; uniform vec2 uTexel;
    void main(){ vec4 samples[9]; int idx=0; for(int x=-1;x<=1;x++){ for(int y=-1;y<=1;y++){ samples[idx]=texture2D(uTex,vUV+vec2(float(x),float(y))*uTexel); idx++; } } for(int i=0;i<9;i++){ for(int j=i+1;j<9;j++){ if(samples[i].r>samples[j].r){ vec4 tmp=samples[i]; samples[i]=samples[j]; samples[j]=tmp; } } } gl_FragColor=samples[4]; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  mf._program=gl.createProgram();
  gl.attachShader(mf._program,vs);
  gl.attachShader(mf._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(mf._program);
  function render(inputTexture){
    if(!mf.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,mf._framebuffer.framebuffer);
    gl.viewport(0,0,mf.width,mf.height);
    gl.useProgram(mf._program);
    const aPos=gl.getAttribLocation(mf._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(mf._program,'uTex'),0);
    gl.uniform1i(gl.getUniformLocation(mf._program,'uRadius'),mf.radius);
    gl.uniform2f(gl.getUniformLocation(mf._program,'uTexel'),1/mf.width,1/mf.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return mf._framebuffer.texture;
  }
  function resize(w,h){ mf.width=w; mf.height=h; }
  function dispose(){ gl.deleteFramebuffer(mf._framebuffer.framebuffer); gl.deleteTexture(mf._framebuffer.texture); gl.deleteProgram(mf._program); }
  console.log('[MedianFilter] 创建完成 radius=' + mf.radius);
  return { render, resize, dispose, mf };
}

/* ===== 后期处理双边滤波系统 ===== */
function createBilateralFilter(gl, width, height, options){
  const opt = options || {};
  const bf = {
    gl: gl, width, height,
    spatialSigma: opt.spatialSigma !== undefined ? opt.spatialSigma : 2,
    rangeSigma: opt.rangeSigma !== undefined ? opt.rangeSigma : 0.1,
    radius: opt.radius || 3,
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
  bf._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uSpatialSigma; uniform float uRangeSigma; uniform int uRadius; uniform vec2 uTexel;
    void main(){ vec4 center=texture2D(uTex,vUV); vec4 result=vec4(0.0); float total=0.0; for(int x=-3;x<=3;x++){ for(int y=-3;y<=3;y++){ if(abs(x)<=uRadius&&abs(y)<=uRadius){ vec4 sample=texture2D(uTex,vUV+vec2(float(x),float(y))*uTexel); float spatialWeight=exp(-(float(x*x+y*y))/(2.0*uSpatialSigma*uSpatialSigma)); float rangeWeight=exp(-(length(sample.rgb-center.rgb)*length(sample.rgb-center.rgb))/(2.0*uRangeSigma*uRangeSigma)); float weight=spatialWeight*rangeWeight; result+=sample*weight; total+=weight; } } } gl_FragColor=result/total; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  bf._program=gl.createProgram();
  gl.attachShader(bf._program,vs);
  gl.attachShader(bf._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(bf._program);
  function render(inputTexture){
    if(!bf.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,bf._framebuffer.framebuffer);
    gl.viewport(0,0,bf.width,bf.height);
    gl.useProgram(bf._program);
    const aPos=gl.getAttribLocation(bf._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(bf._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(bf._program,'uSpatialSigma'),bf.spatialSigma);
    gl.uniform1f(gl.getUniformLocation(bf._program,'uRangeSigma'),bf.rangeSigma);
    gl.uniform1i(gl.getUniformLocation(bf._program,'uRadius'),bf.radius);
    gl.uniform2f(gl.getUniformLocation(bf._program,'uTexel'),1/bf.width,1/bf.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return bf._framebuffer.texture;
  }
  function resize(w,h){ bf.width=w; bf.height=h; }
  function dispose(){ gl.deleteFramebuffer(bf._framebuffer.framebuffer); gl.deleteTexture(bf._framebuffer.texture); gl.deleteProgram(bf._program); }
  console.log('[BilateralFilter] 创建完成 spatialSigma=' + bf.spatialSigma + ' rangeSigma=' + bf.rangeSigma);
  return { render, resize, dispose, bf };
}

/* ===== 后期处理导向滤波系统 ===== */
function createGuidedFilter(gl, width, height, options){
  const opt = options || {};
  const gf = {
    gl: gl, width, height,
    radius: opt.radius || 4,
    epsilon: opt.epsilon !== undefined ? opt.epsilon : 0.01,
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
  gf._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform int uRadius; uniform float uEpsilon; uniform vec2 uTexel;
    void main(){ vec4 meanI=vec4(0.0); vec4 meanP=vec4(0.0); vec4 corrI=vec4(0.0); vec4 corrIP=vec4(0.0); float count=0.0; for(int x=-4;x<=4;x++){ for(int y=-4;y<=4;y++){ if(abs(x)<=uRadius&&abs(y)<=uRadius){ vec2 uv=vUV+vec2(float(x),float(y))*uTexel; vec4 I=texture2D(uTex,uv); meanI+=I; meanP+=I; corrI+=I*I; corrIP+=I*I; count+=1.0; } } } meanI/=count; meanP/=count; corrI/=count; corrIP/=count; vec4 varI=corrI-meanI*meanI; vec4 covIP=corrIP-meanI*meanP; vec4 a=covIP/(varI+uEpsilon); vec4 b=meanP-a*meanI; vec4 meanA=vec4(0.0); vec4 meanB=vec4(0.0); for(int x=-4;x<=4;x++){ for(int y=-4;y<=4;y++){ if(abs(x)<=uRadius&&abs(y)<=uRadius){ meanA+=a; meanB+=b; } } } meanA/=count; meanB/=count; vec4 center=texture2D(uTex,vUV); gl_FragColor=meanA*center+meanB; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  gf._program=gl.createProgram();
  gl.attachShader(gf._program,vs);
  gl.attachShader(gf._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(gf._program);
  function render(inputTexture){
    if(!gf.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,gf._framebuffer.framebuffer);
    gl.viewport(0,0,gf.width,gf.height);
    gl.useProgram(gf._program);
    const aPos=gl.getAttribLocation(gf._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(gf._program,'uTex'),0);
    gl.uniform1i(gl.getUniformLocation(gf._program,'uRadius'),gf.radius);
    gl.uniform1f(gl.getUniformLocation(gf._program,'uEpsilon'),gf.epsilon);
    gl.uniform2f(gl.getUniformLocation(gf._program,'uTexel'),1/gf.width,1/gf.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return gf._framebuffer.texture;
  }
  function resize(w,h){ gf.width=w; gf.height=h; }
  function dispose(){ gl.deleteFramebuffer(gf._framebuffer.framebuffer); gl.deleteTexture(gf._framebuffer.texture); gl.deleteProgram(gf._program); }
  console.log('[GuidedFilter] 创建完成 radius=' + gf.radius + ' epsilon=' + gf.epsilon);
  return { render, resize, dispose, gf };
}

/* ===== 后期处理各向异性扩散系统 ===== */
function createAnisotropicDiffusion(gl, width, height, options){
  const opt = options || {};
  const ad = {
    gl: gl, width, height,
    iterations: opt.iterations || 1,
    lambda: opt.lambda !== undefined ? opt.lambda : 0.15,
    kappa: opt.kappa !== undefined ? opt.kappa : 0.05,
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
  ad._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uLambda; uniform float uKappa; uniform vec2 uTexel;
    void main(){ vec4 center=texture2D(uTex,vUV); vec4 north=texture2D(uTex,vUV+vec2(0.0,-1.0)*uTexel); vec4 south=texture2D(uTex,vUV+vec2(0.0,1.0)*uTexel); vec4 east=texture2D(uTex,vUV+vec2(1.0,0.0)*uTexel); vec4 west=texture2D(uTex,vUV+vec2(-1.0,0.0)*uTexel); vec4 gradN=north-center; vec4 gradS=south-center; vec4 gradE=east-center; vec4 gradW=west-center; float cN=exp(-(length(gradN.rgb)/uKappa)*(length(gradN.rgb)/uKappa)); float cS=exp(-(length(gradS.rgb)/uKappa)*(length(gradS.rgb)/uKappa)); float cE=exp(-(length(gradE.rgb)/uKappa)*(length(gradE.rgb)/uKappa)); float cW=exp(-(length(gradW.rgb)/uKappa)*(length(gradW.rgb)/uKappa)); vec4 result=center+uLambda*(cN*gradN+cS*gradS+cE*gradE+cW*gradW); gl_FragColor=result; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  ad._program=gl.createProgram();
  gl.attachShader(ad._program,vs);
  gl.attachShader(ad._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(ad._program);
  function render(inputTexture){
    if(!ad.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,ad._framebuffer.framebuffer);
    gl.viewport(0,0,ad.width,ad.height);
    gl.useProgram(ad._program);
    const aPos=gl.getAttribLocation(ad._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(ad._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(ad._program,'uLambda'),ad.lambda);
    gl.uniform1f(gl.getUniformLocation(ad._program,'uKappa'),ad.kappa);
    gl.uniform2f(gl.getUniformLocation(ad._program,'uTexel'),1/ad.width,1/ad.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return ad._framebuffer.texture;
  }
  function resize(w,h){ ad.width=w; ad.height=h; }
  function dispose(){ gl.deleteFramebuffer(ad._framebuffer.framebuffer); gl.deleteTexture(ad._framebuffer.texture); gl.deleteProgram(ad._program); }
  console.log('[AnisotropicDiffusion] 创建完成 lambda=' + ad.lambda + ' kappa=' + ad.kappa);
  return { render, resize, dispose, ad };
}

/* ===== 后期处理形态学操作系统 ===== */
function createMorphology(gl, width, height, options){
  const opt = options || {};
  const mo = {
    gl: gl, width, height,
    operation: opt.operation || 'erode',
    radius: opt.radius || 1,
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
  mo._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform int uOperation; uniform int uRadius; uniform vec2 uTexel;
    void main(){ vec4 result; if(uOperation==0){ result=vec4(1.0); for(int x=-3;x<=3;x++){ for(int y=-3;y<=3;y++){ if(abs(x)<=uRadius&&abs(y)<=uRadius){ vec4 sample=texture2D(uTex,vUV+vec2(float(x),float(y))*uTexel); result=min(result,sample); } } } } else { result=vec4(0.0); for(int x=-3;x<=3;x++){ for(int y=-3;y<=3;y++){ if(abs(x)<=uRadius&&abs(y)<=uRadius){ vec4 sample=texture2D(uTex,vUV+vec2(float(x),float(y))*uTexel); result=max(result,sample); } } } } gl_FragColor=result; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  mo._program=gl.createProgram();
  gl.attachShader(mo._program,vs);
  gl.attachShader(mo._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(mo._program);
  function render(inputTexture){
    if(!mo.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,mo._framebuffer.framebuffer);
    gl.viewport(0,0,mo.width,mo.height);
    gl.useProgram(mo._program);
    const aPos=gl.getAttribLocation(mo._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(mo._program,'uTex'),0);
    gl.uniform1i(gl.getUniformLocation(mo._program,'uOperation'),mo.operation==='erode'?0:1);
    gl.uniform1i(gl.getUniformLocation(mo._program,'uRadius'),mo.radius);
    gl.uniform2f(gl.getUniformLocation(mo._program,'uTexel'),1/mo.width,1/mo.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return mo._framebuffer.texture;
  }
  function resize(w,h){ mo.width=w; mo.height=h; }
  function dispose(){ gl.deleteFramebuffer(mo._framebuffer.framebuffer); gl.deleteTexture(mo._framebuffer.texture); gl.deleteProgram(mo._program); }
  console.log('[Morphology] 创建完成 operation=' + mo.operation + ' radius=' + mo.radius);
  return { render, resize, dispose, mo };
}

/* ===== 后期处理管线（集成所有效果，实时可见） ===== */
function createPostProcessPipeline(gl, width, height){
  const ppl = {
    gl: gl, width: width, height: height,
    effects: {
      brightness: 0, contrast: 1, saturation: 1, hue: 0, temperature: 0,
      vignette: 0, vignetteRadius: 0.5, vignetteSoftness: 0.5,
      grain: 0, sharpen: 0, blur: 0, pixelate: 0, scanlines: 0,
      grayscale: 0, invert: 0, sepia: 0, bloom: 0, threshold: 0.8,
      chromaticAberration: 0, filmGrain: 0, colorGrade: 0,
      exposure: 1, gamma: 1.0,
    },
    _framebuffer: null, _depthBuffer: null, _texture: null,
    _program: null, _quadBuffer: null, _time: 0,
    _enabled: true,
  };

  function createFramebuffer(w, h){
    const fb = gl.createFramebuffer();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { framebuffer: fb, texture: tex, depth: depth };
  }

  const fb = createFramebuffer(width, height);
  ppl._framebuffer = fb.framebuffer;
  ppl._texture = fb.texture;
  ppl._depthBuffer = fb.depth;

  const vsSrc = 'attribute vec2 aPos; varying vec2 vUV; void main(){ vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';
  const fsSrc = `
precision highp float;
varying vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBrightness;
uniform float uContrast;
uniform float uSaturation;
uniform float uHue;
uniform float uTemperature;
uniform float uVignette;
uniform float uVignetteRadius;
uniform float uVignetteSoftness;
uniform float uGrain;
uniform float uSharpen;
uniform float uBlur;
uniform float uPixelate;
uniform float uScanlines;
uniform float uGrayscale;
uniform float uInvert;
uniform float uSepia;
uniform float uChromaticAberration;
uniform float uExposure;
uniform float uGamma;

vec3 rgb2hsv(vec3 c){
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float d = mx - mn;
  vec3 hsv = vec3(0.0, 0.0, mx);
  if(d != 0.0){
    hsv.y = d / mx;
    if(c.r == mx) hsv.x = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if(c.g == mx) hsv.x = (c.b - c.r) / d + 2.0;
    else hsv.x = (c.r - c.g) / d + 4.0;
    hsv.x /= 6.0;
  }
  return hsv;
}
vec3 hsv2rgb(vec3 hsv){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(hsv.xxx + K.xyz) * 6.0 - K.www);
  return hsv.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), hsv.y);
}
float rand(vec2 co){ return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453); }

void main(){
  vec2 uv = vUV;
  if(uPixelate > 0.0){
    vec2 pixel = vec2(uPixelate) / uResolution;
    uv = floor(uv / pixel) * pixel + pixel * 0.5;
  }

  vec3 color;
  if(uChromaticAberration > 0.0){
    vec2 dir = normalize(uv - 0.5) * uChromaticAberration * 0.01;
    float r = texture2D(uTex, uv + dir).r;
    float g = texture2D(uTex, uv).g;
    float b = texture2D(uTex, uv - dir).b;
    color = vec3(r, g, b);
  } else {
    color = texture2D(uTex, uv).rgb;
  }

  if(uBlur > 0.0){
    vec3 blurred = vec3(0.0);
    float total = 0.0;
    for(int x = -3; x <= 3; x++){
      for(int y = -3; y <= 3; y++){
        float weight = exp(-(float(x*x + y*y)) / (2.0 * uBlur * uBlur));
        blurred += texture2D(uTex, uv + vec2(float(x), float(y)) / uResolution * uBlur).rgb * weight;
        total += weight;
      }
    }
    color = mix(color, blurred / total, min(1.0, uBlur * 0.3));
  }

  if(uSharpen > 0.0){
    vec3 center = texture2D(uTex, uv).rgb;
    vec3 blur = vec3(0.0);
    blur += texture2D(uTex, uv + vec2(-1.0, -1.0) / uResolution).rgb;
    blur += texture2D(uTex, uv + vec2(1.0, -1.0) / uResolution).rgb;
    blur += texture2D(uTex, uv + vec2(-1.0, 1.0) / uResolution).rgb;
    blur += texture2D(uTex, uv + vec2(1.0, 1.0) / uResolution).rgb;
    blur /= 4.0;
    color = center + (center - blur) * uSharpen;
  }

  color *= uExposure;
  color += uBrightness;
  color = (color - 0.5) * uContrast + 0.5;

  float gray = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(gray), color, uSaturation);

  if(uHue != 0.0){
    vec3 hsv = rgb2hsv(color);
    hsv.x = fract(hsv.x + uHue / 360.0);
    color = hsv2rgb(hsv);
  }

  if(uTemperature != 0.0){
    if(uTemperature > 0.0){
      color.r += uTemperature * 0.3;
      color.b -= uTemperature * 0.2;
    } else {
      color.r += uTemperature * 0.2;
      color.b -= uTemperature * 0.3;
    }
  }

  if(uSepia > 0.0){
    vec3 sepiaColor = vec3(
      dot(color, vec3(0.393, 0.769, 0.189)),
      dot(color, vec3(0.349, 0.686, 0.168)),
      dot(color, vec3(0.272, 0.534, 0.131))
    );
    color = mix(color, sepiaColor, uSepia);
  }

  if(uGrayscale > 0.0){
    color = mix(color, vec3(gray), uGrayscale);
  }

  if(uInvert > 0.0){
    color = mix(color, 1.0 - color, uInvert);
  }

  if(uScanlines > 0.0){
    float scanline = sin(uv.y * uResolution.y * 3.14159) * 0.5 + 0.5;
    color *= 1.0 - scanline * uScanlines * 0.3;
  }

  if(uVignette > 0.0){
    float dist = length(uv - 0.5);
    float vig = smoothstep(uVignetteRadius, uVignetteRadius - uVignetteSoftness, dist);
    color *= mix(1.0, vig, uVignette);
  }

  if(uGrain > 0.0){
    float noise = rand(uv * uResolution + uTime * 100.0) * 2.0 - 1.0;
    color += noise * uGrain * 0.1;
  }

  color = pow(max(color, vec3(0.0)), vec3(1.0 / uGamma));

  float origAlpha = texture2D(uTex, uv).a;
  float outAlpha = origAlpha > 0.5 ? 1.0 : 0.0;
  gl_FragColor = vec4(color, outAlpha);
}`;

  function compileShader(type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
      console.log('[PostProcessPipeline] 着色器编译失败:', gl.getShaderInfoLog(s));
    }
    return s;
  }

  const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
  ppl._program = gl.createProgram();
  gl.attachShader(ppl._program, vs);
  gl.attachShader(ppl._program, compileShader(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(ppl._program);

  ppl._quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, ppl._quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

  function setEffect(name, value){
    if(ppl.effects.hasOwnProperty(name)){
      ppl.effects[name] = value;
    }
  }

  function getEffect(name){
    return ppl.effects[name];
  }

  function setEnabled(enabled){
    ppl._enabled = enabled;
  }

  function render(renderer, modelInstance, camera, options){
    if(!ppl._enabled){
      renderModel(renderer, modelInstance, camera, options);
      return;
    }
    const gl = renderer.gl;
    ppl._time += 0.016;

    for(let _tu = 0; _tu < 8; _tu++){
      gl.activeTexture(gl.TEXTURE0 + _tu);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.activeTexture(gl.TEXTURE0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, ppl._framebuffer);
    gl.viewport(0, 0, ppl.width, ppl.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    renderModel(renderer, modelInstance, camera, options);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);

    if(renderer._vaoExt && renderer._vaoExt.isVertexArrayOES){
      try { renderer._vaoExt.bindVertexArrayOES(null); } catch(e){}
    }

    for(let i = 0; i < 16; i++){
      try { gl.disableVertexAttribArray(i); } catch(e){}
    }

    gl.useProgram(ppl._program);
    gl.bindBuffer(gl.ARRAY_BUFFER, ppl._quadBuffer);
    const aPos = gl.getAttribLocation(ppl._program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ppl._texture);
    gl.uniform1i(gl.getUniformLocation(ppl._program, 'uTex'), 0);
    gl.uniform2f(gl.getUniformLocation(ppl._program, 'uResolution'), ppl.width, ppl.height);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uTime'), ppl._time);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uBrightness'), ppl.effects.brightness);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uContrast'), ppl.effects.contrast);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uSaturation'), ppl.effects.saturation);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uHue'), ppl.effects.hue);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uTemperature'), ppl.effects.temperature);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uVignette'), ppl.effects.vignette);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uVignetteRadius'), ppl.effects.vignetteRadius);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uVignetteSoftness'), ppl.effects.vignetteSoftness);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uGrain'), ppl.effects.grain);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uSharpen'), ppl.effects.sharpen);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uBlur'), ppl.effects.blur);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uPixelate'), ppl.effects.pixelate);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uScanlines'), ppl.effects.scanlines);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uGrayscale'), ppl.effects.grayscale);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uInvert'), ppl.effects.invert);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uSepia'), ppl.effects.sepia);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uChromaticAberration'), ppl.effects.chromaticAberration);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uExposure'), ppl.effects.exposure);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uGamma'), ppl.effects.gamma);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
  }

  function resize(w, h){
    ppl.width = w;
    ppl.height = h;
    gl.bindTexture(gl.TEXTURE_2D, ppl._texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, ppl._depthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
  }

  function dispose(){
    gl.deleteFramebuffer(ppl._framebuffer);
    gl.deleteTexture(ppl._texture);
    gl.deleteRenderbuffer(ppl._depthBuffer);
    gl.deleteProgram(ppl._program);
    gl.deleteBuffer(ppl._quadBuffer);
  }

  function reset(){
    ppl.effects.brightness = 0;
    ppl.effects.contrast = 1;
    ppl.effects.saturation = 1;
    ppl.effects.hue = 0;
    ppl.effects.temperature = 0;
    ppl.effects.vignette = 0;
    ppl.effects.vignetteRadius = 0.5;
    ppl.effects.vignetteSoftness = 0.5;
    ppl.effects.grain = 0;
    ppl.effects.sharpen = 0;
    ppl.effects.blur = 0;
    ppl.effects.pixelate = 0;
    ppl.effects.scanlines = 0;
    ppl.effects.grayscale = 0;
    ppl.effects.invert = 0;
    ppl.effects.sepia = 0;
    ppl.effects.chromaticAberration = 0;
    ppl.effects.exposure = 1;
    ppl.effects.gamma = 2.2;
  }

  console.log('[PostProcessPipeline] 创建完成 ' + width + 'x' + height + ' 效果数量=21');
  return { render, resize, dispose, setEffect, getEffect, setEnabled, reset, ppl };
}



/* ===== 扩展系统（新增17个子系统） ===== */


/* ===== 样条曲线与路径系统 =====
   支持: 贝塞尔曲线 / Catmull-Rom / B样条 / NURBS简化 / 路径跟随
*/