
/* ===== 后期处理模糊系统 ===== */
function createBlur(gl, width, height, options){
  const opt = options || {};
  const blur = {
    gl: gl, width, height,
    radius: opt.radius || 4,
    direction: opt.direction || [1,1],
    quality: opt.quality || 'medium',
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
  blur._framebuffer = createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec2 uTexel; uniform vec2 uDirection; uniform float uRadius;
    void main(){ vec4 color=vec4(0.0); float total=0.0; for(float x=-10.0;x<=10.0;x+=1.0){ if(abs(x)>uRadius) continue; float weight=exp(-x*x/(2.0*uRadius*uRadius/3.0)); color+=texture2D(uTex,vUV+uDirection*uTexel*x)*weight; total+=weight; } gl_FragColor=color/total; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  blur._program=gl.createProgram();
  gl.attachShader(blur._program,vs);
  gl.attachShader(blur._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(blur._program);
  function render(inputTexture){
    if(!blur.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,blur._framebuffer.framebuffer);
    gl.viewport(0,0,blur.width,blur.height);
    gl.useProgram(blur._program);
    const aPos=gl.getAttribLocation(blur._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture);
    gl.uniform1i(gl.getUniformLocation(blur._program,'uTex'),0);
    gl.uniform2f(gl.getUniformLocation(blur._program,'uTexel'),1/blur.width,1/blur.height);
    gl.uniform2f(gl.getUniformLocation(blur._program,'uDirection'),blur.direction[0],blur.direction[1]);
    gl.uniform1f(gl.getUniformLocation(blur._program,'uRadius'),blur.radius);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return blur._framebuffer.texture;
  }
  function resize(w,h){ blur.width=w; blur.height=h; }
  function dispose(){ gl.deleteFramebuffer(blur._framebuffer.framebuffer); gl.deleteTexture(blur._framebuffer.texture); gl.deleteProgram(blur._program); }
  console.log('[Blur] 创建完成 radius=' + blur.radius);
  return { render, resize, dispose, blur };
}

/* ===== 后期处理锐化系统 ===== */
function createSharpen(gl, width, height, options){
  const opt = options || {};
  const sh = {
    gl: gl, width, height,
    strength: opt.strength !== undefined ? opt.strength : 0.5,
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
  sh._framebuffer = createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec2 uTexel; uniform float uStrength;
    void main(){ vec4 center=texture2D(uTex,vUV); vec4 blur=vec4(0.0); blur+=texture2D(uTex,vUV+vec2(-1.0,-1.0)*uTexel); blur+=texture2D(uTex,vUV+vec2(1.0,-1.0)*uTexel); blur+=texture2D(uTex,vUV+vec2(-1.0,1.0)*uTexel); blur+=texture2D(uTex,vUV+vec2(1.0,1.0)*uTexel); blur/=4.0; gl_FragColor=center+(center-blur)*uStrength; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  sh._program=gl.createProgram();
  gl.attachShader(sh._program,vs);
  gl.attachShader(sh._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(sh._program);
  function render(inputTexture){
    if(!sh.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,sh._framebuffer.framebuffer);
    gl.viewport(0,0,sh.width,sh.height);
    gl.useProgram(sh._program);
    const aPos=gl.getAttribLocation(sh._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture);
    gl.uniform1i(gl.getUniformLocation(sh._program,'uTex'),0);
    gl.uniform2f(gl.getUniformLocation(sh._program,'uTexel'),1/sh.width,1/sh.height);
    gl.uniform1f(gl.getUniformLocation(sh._program,'uStrength'),sh.strength);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return sh._framebuffer.texture;
  }
  function resize(w,h){ sh.width=w; sh.height=h; }
  function dispose(){ gl.deleteFramebuffer(sh._framebuffer.framebuffer); gl.deleteTexture(sh._framebuffer.texture); gl.deleteProgram(sh._program); }
  console.log('[Sharpen] 创建完成 strength=' + sh.strength);
  return { render, resize, dispose, sh };
}

/* ===== 后期处理边缘检测系统 ===== */
function createEdgeDetection(gl, width, height, options){
  const opt = options || {};
  const ed = {
    gl: gl, width, height,
    threshold: opt.threshold !== undefined ? opt.threshold : 0.2,
    strength: opt.strength !== undefined ? opt.strength : 1,
    color: opt.color ? opt.color.slice() : [0,0,0],
    mode: opt.mode || 'sobel',
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
  ed._framebuffer = createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec2 uTexel; uniform float uThreshold; uniform float uStrength; uniform vec3 uEdgeColor;
    float luma(vec3 c){ return dot(c,vec3(0.299,0.587,0.114)); }
    void main(){ vec4 color=texture2D(uTex,vUV);
      float tl=luma(texture2D(uTex,vUV+vec2(-1.0,-1.0)*uTexel).rgb);
      float t=luma(texture2D(uTex,vUV+vec2(0.0,-1.0)*uTexel).rgb);
      float tr=luma(texture2D(uTex,vUV+vec2(1.0,-1.0)*uTexel).rgb);
      float l=luma(texture2D(uTex,vUV+vec2(-1.0,0.0)*uTexel).rgb);
      float r=luma(texture2D(uTex,vUV+vec2(1.0,0.0)*uTexel).rgb);
      float bl=luma(texture2D(uTex,vUV+vec2(-1.0,1.0)*uTexel).rgb);
      float b=luma(texture2D(uTex,vUV+vec2(0.0,1.0)*uTexel).rgb);
      float br=luma(texture2D(uTex,vUV+vec2(1.0,1.0)*uTexel).rgb);
      float gx=(-tl-2.0*l-bl)+(tr+2.0*r+br);
      float gy=(-tl-2.0*t-tr)+(bl+2.0*b+br);
      float edge=sqrt(gx*gx+gy*gy);
      if(edge>uThreshold){ gl_FragColor=vec4(mix(color.rgb,uEdgeColor,edge*uStrength),color.a); }
      else gl_FragColor=color;
    }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  ed._program=gl.createProgram();
  gl.attachShader(ed._program,vs);
  gl.attachShader(ed._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(ed._program);
  function render(inputTexture){
    if(!ed.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,ed._framebuffer.framebuffer);
    gl.viewport(0,0,ed.width,ed.height);
    gl.useProgram(ed._program);
    const aPos=gl.getAttribLocation(ed._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture);
    gl.uniform1i(gl.getUniformLocation(ed._program,'uTex'),0);
    gl.uniform2f(gl.getUniformLocation(ed._program,'uTexel'),1/ed.width,1/ed.height);
    gl.uniform1f(gl.getUniformLocation(ed._program,'uThreshold'),ed.threshold);
    gl.uniform1f(gl.getUniformLocation(ed._program,'uStrength'),ed.strength);
    gl.uniform3fv(gl.getUniformLocation(ed._program,'uEdgeColor'),ed.color);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return ed._framebuffer.texture;
  }
  function resize(w,h){ ed.width=w; ed.height=h; }
  function dispose(){ gl.deleteFramebuffer(ed._framebuffer.framebuffer); gl.deleteTexture(ed._framebuffer.texture); gl.deleteProgram(ed._program); }
  console.log('[EdgeDetection] 创建完成 threshold=' + ed.threshold);
  return { render, resize, dispose, ed };
}

/* ===== 后期处理屏幕空间反射系统 ===== */
function createScreenSpaceReflection(gl, width, height, options){
  const opt = options || {};
  const ssr = {
    gl: gl, width, height,
    steps: opt.steps || 64,
    thickness: opt.thickness || 0.1,
    maxDistance: opt.maxDistance || 100,
    resolutionScale: opt.resolutionScale || 0.5,
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
  const rw = Math.floor(width*ssr.resolutionScale);
  const rh = Math.floor(height*ssr.resolutionScale);
  ssr._framebuffer = createFB(rw,rh);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uScene; uniform sampler2D uDepth; uniform sampler2D uNormal; uniform mat4 uProjection; uniform mat4 uInverseProjection; uniform int uSteps; uniform float uThickness; uniform float uMaxDistance; uniform vec2 uResolution;
    vec3 getViewPos(vec2 uv, float depth){ vec4 clip=vec4(uv*2.0-1.0, depth*2.0-1.0, 1.0); vec4 view=uInverseProjection*clip; return view.xyz/view.w; }
    vec2 getScreenPos(vec3 viewPos){ vec4 clip=uProjection*vec4(viewPos,1.0); return (clip.xy/clip.w)*0.5+0.5; }
    void main(){ vec4 sceneColor=texture2D(uScene,vUV); float depth=texture2D(uDepth,vUV).r; if(depth>=1.0){ gl_FragColor=sceneColor; return; } vec3 viewPos=getViewPos(vUV,depth); vec3 normal=normalize(texture2D(uNormal,vUV).xyz*2.0-1.0); vec3 viewDir=normalize(viewPos); vec3 reflectDir=reflect(viewDir,normal); vec3 rayPos=viewPos+normal*0.1; vec3 rayStep=reflectDir*(uMaxDistance/float(uSteps)); vec3 ray=rayPos; vec2 hitUV=vec2(-1.0); for(int i=0;i<128;i++){ if(i>=uSteps) break; ray+=rayStep; vec2 screenUV=getScreenPos(ray); if(screenUV.x<0.0||screenUV.x>1.0||screenUV.y<0.0||screenUV.y>1.0) break; float sampleDepth=texture2D(uDepth,screenUV).r; if(sampleDepth>=1.0) continue; vec3 sampleViewPos=getViewPos(screenUV,sampleDepth); float rayDepth=ray.z; float sampleViewDepth=sampleViewPos.z; if(abs(rayDepth-sampleViewDepth)<uThickness && rayDepth<sampleViewDepth){ hitUV=screenUV; break; } } if(hitUV.x>=0.0){ vec4 reflectColor=texture2D(uScene,hitUV); float fresnel=pow(1.0-max(dot(-viewDir,normal),0.0),3.0); gl_FragColor=vec4(mix(sceneColor.rgb,reflectColor.rgb,fresnel*0.5),sceneColor.a); } else gl_FragColor=sceneColor; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  ssr._program=gl.createProgram();
  gl.attachShader(ssr._program,vs);
  gl.attachShader(ssr._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(ssr._program);
  function render(sceneTexture, depthTexture, normalTexture, projectionMatrix, inverseProjectionMatrix){
    if(!ssr.enabled) return sceneTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,ssr._framebuffer.framebuffer);
    gl.viewport(0,0,rw,rh);
    gl.useProgram(ssr._program);
    const aPos=gl.getAttribLocation(ssr._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,sceneTexture); gl.uniform1i(gl.getUniformLocation(ssr._program,'uScene'),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,depthTexture); gl.uniform1i(gl.getUniformLocation(ssr._program,'uDepth'),1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,normalTexture); gl.uniform1i(gl.getUniformLocation(ssr._program,'uNormal'),2);
    gl.uniformMatrix4fv(gl.getUniformLocation(ssr._program,'uProjection'),false,projectionMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(ssr._program,'uInverseProjection'),false,inverseProjectionMatrix);
    gl.uniform1i(gl.getUniformLocation(ssr._program,'uSteps'),ssr.steps);
    gl.uniform1f(gl.getUniformLocation(ssr._program,'uThickness'),ssr.thickness);
    gl.uniform1f(gl.getUniformLocation(ssr._program,'uMaxDistance'),ssr.maxDistance);
    gl.uniform2f(gl.getUniformLocation(ssr._program,'uResolution'),rw,rh);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return ssr._framebuffer.texture;
  }
  function resize(w,h){ ssr.width=w; ssr.height=h; }
  function dispose(){ gl.deleteFramebuffer(ssr._framebuffer.framebuffer); gl.deleteTexture(ssr._framebuffer.texture); gl.deleteProgram(ssr._program); }
  console.log('[SSR] 创建完成 steps=' + ssr.steps + ' resolution=' + rw + 'x' + rh);
  return { render, resize, dispose, ssr };
}

/* ===== 后期处理屏幕空间环境光遮蔽系统 ===== */
function createSSAOEffect(gl, width, height, options){
  const opt = options || {};
  const ssao = {
    gl: gl, width, height,
    radius: opt.radius || 0.5,
    bias: opt.bias || 0.025,
    power: opt.power || 1,
    samples: opt.samples || 32,
    enabled: true,
    _kernel: [],
    _noiseTexture: null,
    _framebuffer: null,
    _blurFramebuffer: null,
    _program: null,
    _blurProgram: null,
  };
  for(let i=0;i<ssao.samples;i++){
    let sample=[Math.random()*2-1,Math.random()*2-1,Math.random()];
    const len=Math.sqrt(sample[0]**2+sample[1]**2+sample[2]**2);
    sample=[sample[0]/len,sample[1]/len,sample[2]/len];
    const scale=i/ssao.samples;
    const lerpScale=0.1+scale*scale*0.9;
    ssao._kernel.push([sample[0]*lerpScale,sample[1]*lerpScale,sample[2]*lerpScale]);
  }
  const noiseData=new Float32Array(16*3);
  for(let i=0;i<16;i++){ noiseData[i*3]=Math.random()*2-1; noiseData[i*3+1]=Math.random()*2-1; noiseData[i*3+2]=0; }
  ssao._noiseTexture=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,ssao._noiseTexture);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,4,4,0,gl.RGB,gl.FLOAT,noiseData);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  ssao._framebuffer=createFB(width/2,height/2);
  ssao._blurFramebuffer=createFB(width/2,height/2);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const ssaoFs=`precision highp float; varying vec2 vUV; uniform sampler2D uPosition; uniform sampler2D uNormal; uniform sampler2D uNoise; uniform vec3 uKernel[32]; uniform mat4 uProjection; uniform float uRadius; uniform float uBias; uniform float uPower; uniform vec2 uNoiseScale; void main(){ vec3 fragPos=texture2D(uPosition,vUV).xyz; vec3 normal=normalize(texture2D(uNormal,vUV).xyz); vec3 randomVec=normalize(texture2D(uNoise,vUV*uNoiseScale).xyz); vec3 tangent=normalize(randomVec-normal*dot(randomVec,normal)); vec3 bitangent=cross(normal,tangent); mat3 TBN=mat3(tangent,bitangent,normal); float occlusion=0.0; for(int i=0;i<32;i++){ vec3 samplePos=TBN*uKernel[i]; samplePos=fragPos+samplePos*uRadius; vec4 offset=uProjection*vec4(samplePos,1.0); offset.xyz/=offset.w; offset.xyz=offset.xyz*0.5+0.5; float sampleDepth=texture2D(uPosition,offset.xy).z; occlusion+=(sampleDepth>=samplePos.z+uBias?1.0:0.0); } occlusion=1.0-(occlusion/32.0); gl_FragColor=vec4(vec3(pow(occlusion,uPower)),1.0); }`;
  const blurFs=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec2 uTexel; void main(){ float result=0.0; for(int x=-2;x<=2;x++){ for(int y=-2;y<=2;y++){ vec2 offset=vec2(float(x),float(y))*uTexel; result+=texture2D(uTex,vUV+offset).r; } } gl_FragColor=vec4(vec3(result/25.0),1.0); }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  ssao._program=gl.createProgram();
  gl.attachShader(ssao._program,vs);
  gl.attachShader(ssao._program,compileShader(gl.FRAGMENT_SHADER,ssaoFs));
  gl.linkProgram(ssao._program);
  ssao._blurProgram=gl.createProgram();
  gl.attachShader(ssao._blurProgram,vs);
  gl.attachShader(ssao._blurProgram,compileShader(gl.FRAGMENT_SHADER,blurFs));
  gl.linkProgram(ssao._blurProgram);
  function render(positionTexture, normalTexture, projectionMatrix){
    if(!ssao.enabled) return null;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,ssao._framebuffer.framebuffer);
    gl.viewport(0,0,width/2,height/2);
    gl.useProgram(ssao._program);
    const aPos=gl.getAttribLocation(ssao._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,positionTexture); gl.uniform1i(gl.getUniformLocation(ssao._program,'uPosition'),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,normalTexture); gl.uniform1i(gl.getUniformLocation(ssao._program,'uNormal'),1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,ssao._noiseTexture); gl.uniform1i(gl.getUniformLocation(ssao._program,'uNoise'),2);
    gl.uniformMatrix4fv(gl.getUniformLocation(ssao._program,'uProjection'),false,projectionMatrix);
    gl.uniform1f(gl.getUniformLocation(ssao._program,'uRadius'),ssao.radius);
    gl.uniform1f(gl.getUniformLocation(ssao._program,'uBias'),ssao.bias);
    gl.uniform1f(gl.getUniformLocation(ssao._program,'uPower'),ssao.power);
    gl.uniform2f(gl.getUniformLocation(ssao._program,'uNoiseScale'),width/4,height/4);
    const kernelLoc=gl.getUniformLocation(ssao._program,'uKernel[0]');
    const kernelFlat=new Float32Array(ssao.samples*3);
    for(let i=0;i<ssao.samples;i++){ kernelFlat[i*3]=ssao._kernel[i][0]; kernelFlat[i*3+1]=ssao._kernel[i][1]; kernelFlat[i*3+2]=ssao._kernel[i][2]; }
    gl.uniform3fv(kernelLoc,kernelFlat);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.bindFramebuffer(gl.FRAMEBUFFER,ssao._blurFramebuffer.framebuffer);
    gl.useProgram(ssao._blurProgram);
    const bPos=gl.getAttribLocation(ssao._blurProgram,'aPos');
    gl.enableVertexAttribArray(bPos);
    gl.vertexAttribPointer(bPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,ssao._framebuffer.texture); gl.uniform1i(gl.getUniformLocation(ssao._blurProgram,'uTex'),0);
    gl.uniform2f(gl.getUniformLocation(ssao._blurProgram,'uTexel'),2/width,2/height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return ssao._blurFramebuffer.texture;
  }
  function resize(w,h){ ssao.width=w; ssao.height=h; }
  function dispose(){ gl.deleteTexture(ssao._noiseTexture); gl.deleteFramebuffer(ssao._framebuffer.framebuffer); gl.deleteTexture(ssao._framebuffer.texture); gl.deleteFramebuffer(ssao._blurFramebuffer.framebuffer); gl.deleteTexture(ssao._blurFramebuffer.texture); gl.deleteProgram(ssao._program); gl.deleteProgram(ssao._blurProgram); }
  console.log('[SSAOEffect] 创建完成 samples=' + ssao.samples);
  return { render, resize, dispose, ssao };
}