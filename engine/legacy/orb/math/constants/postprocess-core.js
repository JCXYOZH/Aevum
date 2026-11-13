
/* ===== 后处理系统 ===== */
const PostProcessType = { BLOOM: 0, SSAO: 1, DOF: 2, TONEMAP: 3, FXAA: 4, VIGNETTE: 5, COLOR_GRADE: 6 };
function createPostProcess(gl, type, width, height, options){
  const opt = options || {};
  const pp = {
    type: type,
    width: width,
    height: height,
    enabled: opt.enabled !== false,
    intensity: opt.intensity !== undefined ? opt.intensity : 1,
    threshold: opt.threshold !== undefined ? opt.threshold : 0.8,
    radius: opt.radius !== undefined ? opt.radius : 4,
    _framebuffer: null,
    _texture: null,
    _depthBuffer: null,
    _program: null,
    _quadBuffer: null,
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const db = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, db);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, db);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return {framebuffer: fb, texture: tex, depthBuffer: db};
  }
  const fb = createFramebuffer(width, height);
  pp._framebuffer = fb.framebuffer;
  pp._texture = fb.texture;
  pp._depthBuffer = fb.depthBuffer;
  const quadVerts = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
  pp._quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pp._quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
  const vsSrc = 'attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  let fsSrc = '';
  if(type === PostProcessType.BLOOM){
    fsSrc = 'precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uThreshold; uniform float uIntensity; uniform vec2 uTexel; void main(){ vec4 c=texture2D(uTex,vUV); float b=max(c.r,max(c.g,c.b)); if(b>uThreshold){ gl_FragColor=c*uIntensity; } else { gl_FragColor=vec4(0.0); } }';
  } else if(type === PostProcessType.TONEMAP){
    fsSrc = 'precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uIntensity; uniform float uExposure; void main(){ vec3 c=texture2D(uTex,vUV).rgb*uExposure; c=c/(c*0.8+vec3(1.0)); c=pow(max(c,0.0),vec3(0.4545)); gl_FragColor=vec4(c,1.0); }';
  } else if(type === PostProcessType.VIGNETTE){
    fsSrc = 'precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uIntensity; void main(){ vec4 c=texture2D(uTex,vUV); vec2 d=vUV-0.5; float v=1.0-dot(d,d)*uIntensity*2.0; gl_FragColor=vec4(c.rgb*v,1.0); }';
  } else if(type === PostProcessType.FXAA){
    fsSrc = 'precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec2 uTexel; void main(){ vec3 c=texture2D(uTex,vUV).rgb; vec3 nw=texture2D(uTex,vUV+vec2(-uTexel.x,-uTexel.y)).rgb; vec3 ne=texture2D(uTex,vUV+vec2(uTexel.x,-uTexel.y)).rgb; vec3 sw=texture2D(uTex,vUV+vec2(-uTexel.x,uTexel.y)).rgb; vec3 se=texture2D(uTex,vUV+vec2(uTexel.x,uTexel.y)).rgb; float l=c.r*0.299+c.g*0.587+c.b*0.114; float ln=nw.r*0.299+nw.g*0.587+nw.b*0.114; float le=ne.r*0.299+ne.g*0.587+ne.b*0.114; float ls=sw.r*0.299+sw.g*0.587+sw.b*0.114; float lse=se.r*0.299+se.g*0.587+se.b*0.114; float minL=min(l,min(ln,min(le,min(ls,lse)))); float maxL=max(l,max(ln,max(le,max(ls,lse)))); if(maxL-minL<0.05){gl_FragColor=vec4(c,1.0);return;} vec2 dir=vec2((ls+lse)-(ln+le),(le+lse)-(ln+ls)); float d=max(abs(dir.x),abs(dir.y)); dir/=d; vec3 r1=texture2D(uTex,vUV+dir*uTexel*0.5).rgb; vec3 r2=texture2D(uTex,vUV-dir*uTexel*0.5).rgb; gl_FragColor=vec4((r1+r2+c)*0.333,1.0); }';
  } else if(type === PostProcessType.COLOR_GRADE){
    fsSrc = 'precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uIntensity; uniform vec3 uSaturation; uniform vec3 uContrast; uniform vec3 uBrightness; void main(){ vec3 c=texture2D(uTex,vUV).rgb; float l=dot(c,vec3(0.299,0.587,0.114)); c=mix(vec3(l),c,uSaturation); c=(c-0.5)*uContrast+0.5+uBrightness; gl_FragColor=vec4(c,1.0); }';
  } else {
    fsSrc = 'precision highp float; varying vec2 vUV; uniform sampler2D uTex; void main(){ gl_FragColor=texture2D(uTex,vUV); }';
  }
  function compileShader(type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.log('[PostProcess] 着色器编译失败:', gl.getShaderInfoLog(s));
    return s;
  }
  const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
  pp._program = gl.createProgram();
  gl.attachShader(pp._program, vs);
  gl.attachShader(pp._program, fs);
  gl.linkProgram(pp._program);
  pp._uTex = gl.getUniformLocation(pp._program, 'uTex');
  pp._uIntensity = gl.getUniformLocation(pp._program, 'uIntensity');
  pp._uThreshold = gl.getUniformLocation(pp._program, 'uThreshold');
  pp._uTexel = gl.getUniformLocation(pp._program, 'uTexel');
  pp._uExposure = gl.getUniformLocation(pp._program, 'uExposure');
  pp._uSaturation = gl.getUniformLocation(pp._program, 'uSaturation');
  pp._uContrast = gl.getUniformLocation(pp._program, 'uContrast');
  pp._uBrightness = gl.getUniformLocation(pp._program, 'uBrightness');
  pp._aPos = gl.getAttribLocation(pp._program, 'aPos');
  function render(inputTexture){
    if(!pp.enabled) return inputTexture;
    gl.bindFramebuffer(gl.FRAMEBUFFER, pp._framebuffer);
    gl.viewport(0,0,pp.width,pp.height);
    gl.useProgram(pp._program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.uniform1i(pp._uTex, 0);
    if(pp._uIntensity) gl.uniform1f(pp._uIntensity, pp.intensity);
    if(pp._uThreshold) gl.uniform1f(pp._uThreshold, pp.threshold);
    if(pp._uTexel) gl.uniform2f(pp._uTexel, 1/pp.width, 1/pp.height);
    if(pp._uExposure) gl.uniform1f(pp._uExposure, opt.exposure || 1);
    if(pp._uSaturation) gl.uniform3f(pp._uSaturation, opt.saturation||1, opt.saturation||1, opt.saturation||1);
    if(pp._uContrast) gl.uniform3f(pp._uContrast, opt.contrast||1, opt.contrast||1, opt.contrast||1);
    if(pp._uBrightness) gl.uniform3f(pp._uBrightness, opt.brightness||0, opt.brightness||0, opt.brightness||0);
    gl.bindBuffer(gl.ARRAY_BUFFER, pp._quadBuffer);
    gl.enableVertexAttribArray(pp._aPos);
    gl.vertexAttribPointer(pp._aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return pp._texture;
  }
  function resize(w, h){
    pp.width = w; pp.height = h;
    gl.bindTexture(gl.TEXTURE_2D, pp._texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, pp._depthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
  }
  function dispose(){
    gl.deleteFramebuffer(pp._framebuffer);
    gl.deleteTexture(pp._texture);
    gl.deleteRenderbuffer(pp._depthBuffer);
    gl.deleteBuffer(pp._quadBuffer);
    gl.deleteProgram(pp._program);
  }
  console.log('[PostProcess] 创建完成 type=' + type + ' size=' + width + 'x' + height);
  return { render, resize, dispose, get texture(){return pp._texture;}, get framebuffer(){return pp._framebuffer;}, pp };
}
function createPostProcessChain(gl, width, height){
  const chain = { passes: [], _readBuffer: null, _writeBuffer: null, width, height };
  function createReadWriteBuffer(w, h){
    const fb = gl.createFramebuffer();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return {framebuffer: fb, texture: tex};
  }
  chain._readBuffer = createReadWriteBuffer(width, height);
  chain._writeBuffer = createReadWriteBuffer(width, height);
  function addPass(type, options){
    const pp = createPostProcess(gl, type, width, height, options);
    chain.passes.push(pp);
    return pp;
  }
  function begin(){
    gl.bindFramebuffer(gl.FRAMEBUFFER, chain._readBuffer.framebuffer);
    gl.viewport(0,0,width,height);
  }
  function end(){
    let tex = chain._readBuffer.texture;
    for(let i=0;i<chain.passes.length;i++){
      if(!chain.passes[i].pp.enabled) continue;
      tex = chain.passes[i].render(tex);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0,0,width,height);
    return tex;
  }
  function resize(w, h){
    chain.width = w; chain.height = h;
    for(const buf of [chain._readBuffer, chain._writeBuffer]){
      gl.bindTexture(gl.TEXTURE_2D, buf.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    for(const pp of chain.passes) pp.resize(w, h);
  }
  function dispose(){
    for(const pp of chain.passes) pp.dispose();
    gl.deleteFramebuffer(chain._readBuffer.framebuffer);
    gl.deleteTexture(chain._readBuffer.texture);
    gl.deleteFramebuffer(chain._writeBuffer.framebuffer);
    gl.deleteTexture(chain._writeBuffer.texture);
  }
  return { addPass, begin, end, resize, dispose, chain };
}