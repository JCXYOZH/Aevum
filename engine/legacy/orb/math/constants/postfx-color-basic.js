
/* ===== 后期处理泛光系统 ===== */
function createBloom(gl, width, height, options){
  const opt = options || {};
  const bloom = {
    gl: gl,
    width: width,
    height: height,
    threshold: opt.threshold !== undefined ? opt.threshold : 0.8,
    intensity: opt.intensity !== undefined ? opt.intensity : 0.5,
    radius: opt.radius || 4,
    passes: opt.passes || 3,
    enabled: true,
    _extractProgram: null,
    _blurProgram: null,
    _combineProgram: null,
    _extractFB: null,
    _blurFBs: [],
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
  bloom._extractFB = createFB(width/2, height/2);
  for(let i=0;i<bloom.passes;i++) bloom._blurFBs.push(createFB(width/2, height/2));
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const extractFs='precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uThreshold; void main(){ vec4 c=texture2D(uTex,vUV); float brightness=max(c.r,max(c.g,c.b)); if(brightness>uThreshold){ float contribution=(brightness-uThreshold)/(1.0-uThreshold); gl_FragColor=vec4(c.rgb*contribution,1.0); } else gl_FragColor=vec4(0.0); }';
  const blurFs='precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec2 uTexel; uniform vec2 uDirection; void main(){ vec4 color=vec4(0.0); float weights[5]; weights[0]=0.227027; weights[1]=0.1945946; weights[2]=0.1216216; weights[3]=0.054054; weights[4]=0.016216; color+=texture2D(uTex,vUV)*weights[0]; for(int i=1;i<5;i++){ color+=texture2D(uTex,vUV+uDirection*uTexel*float(i))*weights[i]; color+=texture2D(uTex,vUV-uDirection*uTexel*float(i))*weights[i]; } gl_FragColor=color; }';
  const combineFs='precision highp float; varying vec2 vUV; uniform sampler2D uScene; uniform sampler2D uBloom; uniform float uIntensity; void main(){ vec4 scene=texture2D(uScene,vUV); vec4 bloom=texture2D(uBloom,vUV); gl_FragColor=vec4(scene.rgb+bloom.rgb*uIntensity,scene.a); }';
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  bloom._extractProgram=gl.createProgram();
  gl.attachShader(bloom._extractProgram,vs);
  gl.attachShader(bloom._extractProgram,compileShader(gl.FRAGMENT_SHADER,extractFs));
  gl.linkProgram(bloom._extractProgram);
  bloom._blurProgram=gl.createProgram();
  gl.attachShader(bloom._blurProgram,vs);
  gl.attachShader(bloom._blurProgram,compileShader(gl.FRAGMENT_SHADER,blurFs));
  gl.linkProgram(bloom._blurProgram);
  bloom._combineProgram=gl.createProgram();
  gl.attachShader(bloom._combineProgram,vs);
  gl.attachShader(bloom._combineProgram,compileShader(gl.FRAGMENT_SHADER,combineFs));
  gl.linkProgram(bloom._combineProgram);
  function render(sceneTexture){
    if(!bloom.enabled) return sceneTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,bloom._extractFB.framebuffer);
    gl.viewport(0,0,bloom.width/2,bloom.height/2);
    gl.useProgram(bloom._extractProgram);
    const aPos=gl.getAttribLocation(bloom._extractProgram,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,sceneTexture);
    gl.uniform1i(gl.getUniformLocation(bloom._extractProgram,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(bloom._extractProgram,'uThreshold'),bloom.threshold);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    let currentTex = bloom._extractFB.texture;
    for(let p=0;p<bloom.passes;p++){
      const fb = bloom._blurFBs[p];
      gl.bindFramebuffer(gl.FRAMEBUFFER,fb.framebuffer);
      gl.useProgram(bloom._blurProgram);
      const bp=gl.getAttribLocation(bloom._blurProgram,'aPos');
      gl.enableVertexAttribArray(bp);
      gl.vertexAttribPointer(bp,2,gl.FLOAT,false,0,0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,currentTex);
      gl.uniform1i(gl.getUniformLocation(bloom._blurProgram,'uTex'),0);
      gl.uniform2f(gl.getUniformLocation(bloom._blurProgram,'uTexel'),2/bloom.width,2/bloom.height);
      gl.uniform2f(gl.getUniformLocation(bloom._blurProgram,'uDirection'),1,0);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      currentTex = fb.texture;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.viewport(0,0,bloom.width,bloom.height);
    gl.useProgram(bloom._combineProgram);
    const cp=gl.getAttribLocation(bloom._combineProgram,'aPos');
    gl.enableVertexAttribArray(cp);
    gl.vertexAttribPointer(cp,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,sceneTexture);
    gl.uniform1i(gl.getUniformLocation(bloom._combineProgram,'uScene'),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,currentTex);
    gl.uniform1i(gl.getUniformLocation(bloom._combineProgram,'uBloom'),1);
    gl.uniform1f(gl.getUniformLocation(bloom._combineProgram,'uIntensity'),bloom.intensity);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return null;
  }
  function resize(w,h){ bloom.width=w; bloom.height=h; }
  function dispose(){
    gl.deleteFramebuffer(bloom._extractFB.framebuffer); gl.deleteTexture(bloom._extractFB.texture);
    for(const fb of bloom._blurFBs){ gl.deleteFramebuffer(fb.framebuffer); gl.deleteTexture(fb.texture); }
    gl.deleteProgram(bloom._extractProgram); gl.deleteProgram(bloom._blurProgram); gl.deleteProgram(bloom._combineProgram);
  }
  console.log('[Bloom] 创建完成 ' + width + 'x' + height + ' passes=' + bloom.passes);
  return { render, resize, dispose, bloom };
}

/* ===== 后期处理色彩分级系统 ===== */
function createColorGrading(gl, width, height, options){
  const opt = options || {};
  const cg = {
    gl: gl, width, height,
    lift: opt.lift ? opt.lift.slice() : [0,0,0],
    gamma: opt.gamma ? opt.gamma.slice() : [1,1,1],
    gain: opt.gain ? opt.gain.slice() : [1,1,1],
    offset: opt.offset ? opt.offset.slice() : [0,0,0],
    contrast: opt.contrast !== undefined ? opt.contrast : 1,
    saturation: opt.saturation !== undefined ? opt.saturation : 1,
    hue: opt.hue !== undefined ? opt.hue : 0,
    temperature: opt.temperature !== undefined ? opt.temperature : 0,
    tint: opt.tint !== undefined ? opt.tint : 0,
    shadows: opt.shadows ? opt.shadows.slice() : [0,0,0],
    midtones: opt.midtones ? opt.midtones.slice() : [1,1,1],
    highlights: opt.highlights ? opt.highlights.slice() : [1,1,1],
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
  cg._framebuffer = createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex;
    uniform vec3 uLift; uniform vec3 uGamma; uniform vec3 uGain; uniform vec3 uOffset;
    uniform float uContrast; uniform float uSaturation; uniform float uHue;
    uniform float uTemperature; uniform float uTint;
    uniform vec3 uShadows; uniform vec3 uMidtones; uniform vec3 uHighlights;
    vec3 rgbToHsv(vec3 c){ float mx=max(c.r,max(c.g,c.b)), mn=min(c.r,min(c.g,c.b)); float d=mx-mn; vec3 hsv=vec3(0.0,0.0,mx); if(d!=0.0){ hsv.y=d/mx; if(c.r==mx) hsv.x=(c.g-c.b)/d+(c.g<c.b?6.0:0.0); else if(c.g==mx) hsv.x=(c.b-c.r)/d+2.0; else hsv.x=(c.r-c.g)/d+4.0; hsv.x/=6.0; } return hsv; }
    vec3 hsvToRgb(vec3 hsv){ vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0); vec3 p=abs(fract(hsv.xxx+K.xyz)*6.0-K.www); return hsv.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),hsv.y); }
    void main(){ vec4 color=texture2D(uTex,vUV); vec3 c=color.rgb;
      c = (c-0.5)*uContrast+0.5;
      c = pow(max(c,vec3(0.0)),1.0/uGamma);
      c = c*uGain+uLift+uOffset;
      float luma=dot(c,vec3(0.299,0.587,0.114));
      c=mix(vec3(luma),c,uSaturation);
      vec3 hsv=rgbToHsv(c); hsv.x=fract(hsv.x+uHue/360.0); c=hsvToRgb(hsv);
      c.r+=uTemperature*0.01; c.b-=uTemperature*0.01;
      c.g+=uTint*0.01; c.r-=uTint*0.005; c.b-=uTint*0.005;
      float shadow=smoothstep(0.0,0.3,luma);
      float highlight=smoothstep(0.7,1.0,luma);
      float mid=1.0-shadow-highlight;
      c=c*(uShadows*shadow+uMidtones*mid+uHighlights*highlight);
      gl_FragColor=vec4(clamp(c,0.0,1.0),color.a);
    }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  cg._program=gl.createProgram();
  gl.attachShader(cg._program,vs);
  gl.attachShader(cg._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(cg._program);
  function render(inputTexture){
    if(!cg.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,cg._framebuffer.framebuffer);
    gl.viewport(0,0,cg.width,cg.height);
    gl.useProgram(cg._program);
    const aPos=gl.getAttribLocation(cg._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture);
    gl.uniform1i(gl.getUniformLocation(cg._program,'uTex'),0);
    gl.uniform3fv(gl.getUniformLocation(cg._program,'uLift'),cg.lift);
    gl.uniform3fv(gl.getUniformLocation(cg._program,'uGamma'),cg.gamma);
    gl.uniform3fv(gl.getUniformLocation(cg._program,'uGain'),cg.gain);
    gl.uniform3fv(gl.getUniformLocation(cg._program,'uOffset'),cg.offset);
    gl.uniform1f(gl.getUniformLocation(cg._program,'uContrast'),cg.contrast);
    gl.uniform1f(gl.getUniformLocation(cg._program,'uSaturation'),cg.saturation);
    gl.uniform1f(gl.getUniformLocation(cg._program,'uHue'),cg.hue);
    gl.uniform1f(gl.getUniformLocation(cg._program,'uTemperature'),cg.temperature);
    gl.uniform1f(gl.getUniformLocation(cg._program,'uTint'),cg.tint);
    gl.uniform3fv(gl.getUniformLocation(cg._program,'uShadows'),cg.shadows);
    gl.uniform3fv(gl.getUniformLocation(cg._program,'uMidtones'),cg.midtones);
    gl.uniform3fv(gl.getUniformLocation(cg._program,'uHighlights'),cg.highlights);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return cg._framebuffer.texture;
  }
  function resize(w,h){ cg.width=w; cg.height=h; }
  function dispose(){ gl.deleteFramebuffer(cg._framebuffer.framebuffer); gl.deleteTexture(cg._framebuffer.texture); gl.deleteProgram(cg._program); }
  console.log('[ColorGrading] 创建完成 ' + width + 'x' + height);
  return { render, resize, dispose, cg };
}

/* ===== 后期处理色差系统 ===== */
function createChromaticAberration(gl, width, height, options){
  const opt = options || {};
  const ca = {
    gl: gl, width, height,
    strength: opt.strength !== undefined ? opt.strength : 0.002,
    radial: opt.radial !== false,
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
  ca._framebuffer = createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uStrength; uniform int uRadial;
    void main(){ vec2 dir = uRadial==1 ? normalize(vUV-0.5) : vec2(1.0,0.0);
      float r=texture2D(uTex,vUV+dir*uStrength).r;
      float g=texture2D(uTex,vUV).g;
      float b=texture2D(uTex,vUV-dir*uStrength).b;
      gl_FragColor=vec4(r,g,b,1.0);
    }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  ca._program=gl.createProgram();
  gl.attachShader(ca._program,vs);
  gl.attachShader(ca._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(ca._program);
  function render(inputTexture){
    if(!ca.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,ca._framebuffer.framebuffer);
    gl.viewport(0,0,ca.width,ca.height);
    gl.useProgram(ca._program);
    const aPos=gl.getAttribLocation(ca._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture);
    gl.uniform1i(gl.getUniformLocation(ca._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(ca._program,'uStrength'),ca.strength);
    gl.uniform1i(gl.getUniformLocation(ca._program,'uRadial'),ca.radial?1:0);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return ca._framebuffer.texture;
  }
  function resize(w,h){ ca.width=w; ca.height=h; }
  function dispose(){ gl.deleteFramebuffer(ca._framebuffer.framebuffer); gl.deleteTexture(ca._framebuffer.texture); gl.deleteProgram(ca._program); }
  console.log('[ChromaticAberration] 创建完成 strength=' + ca.strength);
  return { render, resize, dispose, ca };
}

/* ===== 后期处理晕影系统 ===== */
function createVignette(gl, width, height, options){
  const opt = options || {};
  const v = {
    gl: gl, width, height,
    strength: opt.strength !== undefined ? opt.strength : 0.5,
    radius: opt.radius !== undefined ? opt.radius : 0.8,
    softness: opt.softness !== undefined ? opt.softness : 0.5,
    color: opt.color ? opt.color.slice() : [0,0,0],
    enabled: true,
    _program: null,
  };
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uStrength; uniform float uRadius; uniform float uSoftness; uniform vec3 uColor;
    void main(){ vec4 color=texture2D(uTex,vUV); vec2 pos=vUV-0.5; float dist=length(pos); float vignette=smoothstep(uRadius,uRadius-uSoftness,dist); color.rgb=mix(uColor,color.rgb,vignette*uStrength+(1.0-uStrength)); gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  v._program=gl.createProgram();
  gl.attachShader(v._program,vs);
  gl.attachShader(v._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(v._program);
  function render(inputTexture){
    if(!v.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.useProgram(v._program);
    const aPos=gl.getAttribLocation(v._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture);
    gl.uniform1i(gl.getUniformLocation(v._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(v._program,'uStrength'),v.strength);
    gl.uniform1f(gl.getUniformLocation(v._program,'uRadius'),v.radius);
    gl.uniform1f(gl.getUniformLocation(v._program,'uSoftness'),v.softness);
    gl.uniform3fv(gl.getUniformLocation(v._program,'uColor'),v.color);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return null;
  }
  function resize(w,h){ v.width=w; v.height=h; }
  function dispose(){ gl.deleteProgram(v._program); }
  console.log('[Vignette] 创建完成 strength=' + v.strength);
  return { render, resize, dispose, v };
}

/* ===== 后期处理颗粒系统 ===== */
function createFilmGrain(gl, width, height, options){
  const opt = options || {};
  const fg = {
    gl: gl, width, height,
    intensity: opt.intensity !== undefined ? opt.intensity : 0.05,
    animated: opt.animated !== false,
    _time: 0,
    enabled: true,
    _program: null,
  };
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uIntensity; uniform float uTime; uniform vec2 uResolution;
    float rand(vec2 co){ return fract(sin(dot(co.xy,vec2(12.9898,78.233)))*43758.5453); }
    void main(){ vec4 color=texture2D(uTex,vUV); float grain=rand(vUV*uResolution+uTime)*2.0-1.0; color.rgb+=grain*uIntensity; gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  fg._program=gl.createProgram();
  gl.attachShader(fg._program,vs);
  gl.attachShader(fg._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(fg._program);
  function update(dt){ if(fg.animated) fg._time += dt; }
  function render(inputTexture){
    if(!fg.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.useProgram(fg._program);
    const aPos=gl.getAttribLocation(fg._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture);
    gl.uniform1i(gl.getUniformLocation(fg._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(fg._program,'uIntensity'),fg.intensity);
    gl.uniform1f(gl.getUniformLocation(fg._program,'uTime'),fg._time);
    gl.uniform2f(gl.getUniformLocation(fg._program,'uResolution'),fg.width,fg.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return null;
  }
  function resize(w,h){ fg.width=w; fg.height=h; }
  function dispose(){ gl.deleteProgram(fg._program); }
  console.log('[FilmGrain] 创建完成 intensity=' + fg.intensity);
  return { update, render, resize, dispose, fg };
}

/* ===== 后期处理扫描线系统 ===== */
function createScanlines(gl, width, height, options){
  const opt = options || {};
  const sl = {
    gl: gl, width, height,
    intensity: opt.intensity !== undefined ? opt.intensity : 0.1,
    thickness: opt.thickness || 2,
    speed: opt.speed || 0,
    _time: 0,
    enabled: true,
    _program: null,
  };
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uIntensity; uniform float uThickness; uniform float uTime; uniform vec2 uResolution;
    void main(){ vec4 color=texture2D(uTex,vUV); float y=vUV.y*uResolution.y+uTime*100.0; float scanline=mod(floor(y),uThickness); float factor=scanline<1.0?1.0-uIntensity:1.0; color.rgb*=factor; gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  sl._program=gl.createProgram();
  gl.attachShader(sl._program,vs);
  gl.attachShader(sl._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(sl._program);
  function update(dt){ sl._time += dt*sl.speed; }
  function render(inputTexture){
    if(!sl.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.useProgram(sl._program);
    const aPos=gl.getAttribLocation(sl._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture);
    gl.uniform1i(gl.getUniformLocation(sl._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(sl._program,'uIntensity'),sl.intensity);
    gl.uniform1f(gl.getUniformLocation(sl._program,'uThickness'),sl.thickness);
    gl.uniform1f(gl.getUniformLocation(sl._program,'uTime'),sl._time);
    gl.uniform2f(gl.getUniformLocation(sl._program,'uResolution'),sl.width,sl.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return null;
  }
  function resize(w,h){ sl.width=w; sl.height=h; }
  function dispose(){ gl.deleteProgram(sl._program); }
  console.log('[Scanlines] 创建完成 intensity=' + sl.intensity);
  return { update, render, resize, dispose, sl };
}

/* ===== 后期处理CRT效果系统 ===== */
function createCRTEffect(gl, width, height, options){
  const opt = options || {};
  const crt = {
    gl: gl, width, height,
    curvature: opt.curvature !== undefined ? opt.curvature : 0.1,
    scanlineIntensity: opt.scanlineIntensity !== undefined ? opt.scanlineIntensity : 0.15,
    vignetteIntensity: opt.vignetteIntensity !== undefined ? opt.vignetteIntensity : 0.3,
    chromaticAberration: opt.chromaticAberration !== undefined ? opt.chromaticAberration : 0.003,
    noiseIntensity: opt.noiseIntensity !== undefined ? opt.noiseIntensity : 0.02,
    _time: 0,
    enabled: true,
    _program: null,
  };
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uTime; uniform vec2 uResolution;
    uniform float uCurvature; uniform float uScanline; uniform float uVignette; uniform float uCA; uniform float uNoise;
    float rand(vec2 co){ return fract(sin(dot(co.xy,vec2(12.9898,78.233)))*43758.5453); }
    vec2 curve(vec2 uv){ uv=uv*2.0-1.0; uv*=1.0+uCurvature*dot(uv,uv); return uv*0.5+0.5; }
    void main(){ vec2 uv=curve(vUV); if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0){ gl_FragColor=vec4(0.0,0.0,0.0,1.0); return; }
      vec2 dir=normalize(uv-0.5);
      float r=texture2D(uTex,uv+dir*uCA).r;
      float g=texture2D(uTex,uv).g;
      float b=texture2D(uTex,uv-dir*uCA).b;
      vec3 color=vec3(r,g,b);
      float scanline=sin(uv.y*uResolution.y*3.14159)*0.5+0.5;
      color*=1.0-scanline*uScanline;
      float dist=length(uv-0.5);
      color*=1.0-smoothstep(0.3,0.8,dist)*uVignette;
      float noise=rand(uv*uResolution+uTime)*2.0-1.0;
      color+=noise*uNoise;
      gl_FragColor=vec4(color,1.0);
    }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  crt._program=gl.createProgram();
  gl.attachShader(crt._program,vs);
  gl.attachShader(crt._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(crt._program);
  function update(dt){ crt._time += dt; }
  function render(inputTexture){
    if(!crt.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.useProgram(crt._program);
    const aPos=gl.getAttribLocation(crt._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture);
    gl.uniform1i(gl.getUniformLocation(crt._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(crt._program,'uTime'),crt._time);
    gl.uniform2f(gl.getUniformLocation(crt._program,'uResolution'),crt.width,crt.height);
    gl.uniform1f(gl.getUniformLocation(crt._program,'uCurvature'),crt.curvature);
    gl.uniform1f(gl.getUniformLocation(crt._program,'uScanline'),crt.scanlineIntensity);
    gl.uniform1f(gl.getUniformLocation(crt._program,'uVignette'),crt.vignetteIntensity);
    gl.uniform1f(gl.getUniformLocation(crt._program,'uCA'),crt.chromaticAberration);
    gl.uniform1f(gl.getUniformLocation(crt._program,'uNoise'),crt.noiseIntensity);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return null;
  }
  function resize(w,h){ crt.width=w; crt.height=h; }
  function dispose(){ gl.deleteProgram(crt._program); }
  console.log('[CRTEffect] 创建完成 curvature=' + crt.curvature);
  return { update, render, resize, dispose, crt };
}

/* ===== 后期处理像素化系统 ===== */
function createPixelation(gl, width, height, options){
  const opt = options || {};
  const px = {
    gl: gl, width, height,
    pixelSize: opt.pixelSize || 4,
    enabled: true,
    _program: null,
  };
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uPixelSize; uniform vec2 uResolution;
    void main(){ vec2 pixel=vec2(uPixelSize)/uResolution; vec2 uv=floor(vUV/pixel)*pixel+pixel*0.5; gl_FragColor=texture2D(uTex,uv); }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  px._program=gl.createProgram();
  gl.attachShader(px._program,vs);
  gl.attachShader(px._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(px._program);
  function render(inputTexture){
    if(!px.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.useProgram(px._program);
    const aPos=gl.getAttribLocation(px._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture);
    gl.uniform1i(gl.getUniformLocation(px._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(px._program,'uPixelSize'),px.pixelSize);
    gl.uniform2f(gl.getUniformLocation(px._program,'uResolution'),px.width,px.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return null;
  }
  function resize(w,h){ px.width=w; px.height=h; }
  function dispose(){ gl.deleteProgram(px._program); }
  console.log('[Pixelation] 创建完成 pixelSize=' + px.pixelSize);
  return { render, resize, dispose, px };
}