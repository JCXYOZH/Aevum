
/* ===== 后期处理色阶系统 ===== */
function createLevels(gl, width, height, options){
  const opt = options || {};
  const lv = {
    gl: gl, width, height,
    inputBlack: opt.inputBlack !== undefined ? opt.inputBlack : 0,
    inputWhite: opt.inputWhite !== undefined ? opt.inputWhite : 1,
    gamma: opt.gamma !== undefined ? opt.gamma : 1,
    outputBlack: opt.outputBlack !== undefined ? opt.outputBlack : 0,
    outputWhite: opt.outputWhite !== undefined ? opt.outputWhite : 1,
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
  lv._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uInputBlack; uniform float uInputWhite; uniform float uGamma; uniform float uOutputBlack; uniform float uOutputWhite;
    void main(){ vec4 color=texture2D(uTex,vUV); color.rgb=(color.rgb-uInputBlack)/(uInputWhite-uInputBlack); color.rgb=pow(max(color.rgb,vec3(0.0)),vec3(1.0/uGamma)); color.rgb=color.rgb*(uOutputWhite-uOutputBlack)+uOutputBlack; gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  lv._program=gl.createProgram();
  gl.attachShader(lv._program,vs);
  gl.attachShader(lv._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(lv._program);
  function render(inputTexture){
    if(!lv.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,lv._framebuffer.framebuffer);
    gl.viewport(0,0,lv.width,lv.height);
    gl.useProgram(lv._program);
    const aPos=gl.getAttribLocation(lv._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(lv._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(lv._program,'uInputBlack'),lv.inputBlack);
    gl.uniform1f(gl.getUniformLocation(lv._program,'uInputWhite'),lv.inputWhite);
    gl.uniform1f(gl.getUniformLocation(lv._program,'uGamma'),lv.gamma);
    gl.uniform1f(gl.getUniformLocation(lv._program,'uOutputBlack'),lv.outputBlack);
    gl.uniform1f(gl.getUniformLocation(lv._program,'uOutputWhite'),lv.outputWhite);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return lv._framebuffer.texture;
  }
  function resize(w,h){ lv.width=w; lv.height=h; }
  function dispose(){ gl.deleteFramebuffer(lv._framebuffer.framebuffer); gl.deleteTexture(lv._framebuffer.texture); gl.deleteProgram(lv._program); }
  console.log('[Levels] 创建完成 gamma=' + lv.gamma);
  return { render, resize, dispose, lv };
}

/* ===== 后期处理色相饱和度系统 ===== */
function createHueSaturation(gl, width, height, options){
  const opt = options || {};
  const hs = {
    gl: gl, width, height,
    hue: opt.hue !== undefined ? opt.hue : 0,
    saturation: opt.saturation !== undefined ? opt.saturation : 0,
    lightness: opt.lightness !== undefined ? opt.lightness : 0,
    colorize: opt.colorize || false,
    colorizeHue: opt.colorizeHue !== undefined ? opt.colorizeHue : 0,
    colorizeSaturation: opt.colorizeSaturation !== undefined ? opt.colorizeSaturation : 0.5,
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
  hs._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uHue; uniform float uSaturation; uniform float uLightness; uniform int uColorize; uniform float uColorizeHue; uniform float uColorizeSaturation;
    vec3 rgb2hsl(vec3 c){ float mx=max(c.r,max(c.g,c.b)), mn=min(c.r,min(c.g,c.b)); float h=0.0,s=0.0,l=(mx+mn)*0.5; if(mx!=mn){ float d=mx-mn; s=l>0.5?d/(2.0-mx-mn):d/(mx+mn); if(c.r==mx) h=(c.g-c.b)/d+(c.g<c.b?6.0:0.0); else if(c.g==mx) h=(c.b-c.r)/d+2.0; else h=(c.r-c.g)/d+4.0; h/=6.0; } return vec3(h,s,l); }
    vec3 hsl2rgb(vec3 hsl){ float h=hsl.x,s=hsl.y,l=hsl.z; if(s==0.0) return vec3(l); float q=l<0.5?l*(1.0+s):l+s-l*s; float p=2.0*l-q; vec3 k=vec3(h+1.0/3.0,h,h-1.0/3.0); for(int i=0;i<3;i++){ if(k[i]<0.0) k[i]+=1.0; if(k[i]>1.0) k[i]-=1.0; } vec3 rgb; for(int i=0;i<3;i++){ if(k[i]<1.0/6.0) rgb[i]=p+(q-p)*6.0*k[i]; else if(k[i]<0.5) rgb[i]=q; else if(k[i]<2.0/3.0) rgb[i]=p+(q-p)*(2.0/3.0-k[i])*6.0; else rgb[i]=p; } return rgb; }
    void main(){ vec4 color=texture2D(uTex,vUV); vec3 hsl=rgb2hsl(color.rgb); if(uColorize==1){ hsl.x=uColorizeHue/360.0; hsl.y=uColorizeSaturation; } else { hsl.x=fract(hsl.x+uHue/360.0); hsl.y=clamp(hsl.y+uSaturation,0.0,1.0); } hsl.z=clamp(hsl.z+uLightness,0.0,1.0); color.rgb=hsl2rgb(hsl); gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  hs._program=gl.createProgram();
  gl.attachShader(hs._program,vs);
  gl.attachShader(hs._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(hs._program);
  function render(inputTexture){
    if(!hs.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,hs._framebuffer.framebuffer);
    gl.viewport(0,0,hs.width,hs.height);
    gl.useProgram(hs._program);
    const aPos=gl.getAttribLocation(hs._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(hs._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(hs._program,'uHue'),hs.hue);
    gl.uniform1f(gl.getUniformLocation(hs._program,'uSaturation'),hs.saturation);
    gl.uniform1f(gl.getUniformLocation(hs._program,'uLightness'),hs.lightness);
    gl.uniform1i(gl.getUniformLocation(hs._program,'uColorize'),hs.colorize?1:0);
    gl.uniform1f(gl.getUniformLocation(hs._program,'uColorizeHue'),hs.colorizeHue);
    gl.uniform1f(gl.getUniformLocation(hs._program,'uColorizeSaturation'),hs.colorizeSaturation);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return hs._framebuffer.texture;
  }
  function resize(w,h){ hs.width=w; hs.height=h; }
  function dispose(){ gl.deleteFramebuffer(hs._framebuffer.framebuffer); gl.deleteTexture(hs._framebuffer.texture); gl.deleteProgram(hs._program); }
  console.log('[HueSaturation] 创建完成 hue=' + hs.hue + ' saturation=' + hs.saturation);
  return { render, resize, dispose, hs };
}

/* ===== 后期处理可选颜色系统 ===== */
function createSelectiveColor(gl, width, height, options){
  const opt = options || {};
  const sc = {
    gl: gl, width, height,
    reds: opt.reds ? opt.reds.slice() : [0,0,0,0],
    yellows: opt.yellows ? opt.yellows.slice() : [0,0,0,0],
    greens: opt.greens ? opt.greens.slice() : [0,0,0,0],
    cyans: opt.cyans ? opt.cyans.slice() : [0,0,0,0],
    blues: opt.blues ? opt.blues.slice() : [0,0,0,0],
    magentas: opt.magentas ? opt.magentas.slice() : [0,0,0,0],
    whites: opt.whites ? opt.whites.slice() : [0,0,0,0],
    neutrals: opt.neutrals ? opt.neutrals.slice() : [0,0,0,0],
    blacks: opt.blacks ? opt.blacks.slice() : [0,0,0,0],
    method: opt.method || 'relative',
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
  sc._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec4 uReds; uniform vec4 uYellows; uniform vec4 uGreens; uniform vec4 uCyans; uniform vec4 uBlues; uniform vec4 uMagentas; uniform vec4 uWhites; uniform vec4 uNeutrals; uniform vec4 uBlacks; uniform int uMethod;
    vec4 applyColor(vec4 color, vec4 adj, float amount){ if(uMethod==0){ color.r+=adj.r*color.r*amount; color.g+=adj.g*color.g*amount; color.b+=adj.b*color.b*amount; color.a+=adj.a*(1.0-color.a)*amount; } else { color.r+=adj.r*amount; color.g+=adj.g*amount; color.b+=adj.b*amount; color.a+=adj.a*amount; } return color; }
    void main(){ vec4 color=texture2D(uTex,vUV); float mx=max(color.r,max(color.g,color.b)); float mn=min(color.r,min(color.g,color.b)); float luma=(mx+mn)*0.5; if(color.r>color.g&&color.r>color.b) color=applyColor(color,uReds,1.0); else if(color.g>color.r&&color.g>color.b) color=applyColor(color,uGreens,1.0); else if(color.b>color.r&&color.b>color.g) color=applyColor(color,uBlues,1.0); else if(color.r>color.b&&color.g>color.b) color=applyColor(color,uYellows,1.0); else if(color.g>color.r&&color.b>color.r) color=applyColor(color,uCyans,1.0); else if(color.r>color.g&&color.b>color.g) color=applyColor(color,uMagentas,1.0); if(luma>0.8) color=applyColor(color,uWhites,1.0); else if(luma<0.2) color=applyColor(color,uBlacks,1.0); else color=applyColor(color,uNeutrals,1.0); gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  sc._program=gl.createProgram();
  gl.attachShader(sc._program,vs);
  gl.attachShader(sc._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(sc._program);
  function render(inputTexture){
    if(!sc.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,sc._framebuffer.framebuffer);
    gl.viewport(0,0,sc.width,sc.height);
    gl.useProgram(sc._program);
    const aPos=gl.getAttribLocation(sc._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(sc._program,'uTex'),0);
    gl.uniform4fv(gl.getUniformLocation(sc._program,'uReds'),sc.reds);
    gl.uniform4fv(gl.getUniformLocation(sc._program,'uYellows'),sc.yellows);
    gl.uniform4fv(gl.getUniformLocation(sc._program,'uGreens'),sc.greens);
    gl.uniform4fv(gl.getUniformLocation(sc._program,'uCyans'),sc.cyans);
    gl.uniform4fv(gl.getUniformLocation(sc._program,'uBlues'),sc.blues);
    gl.uniform4fv(gl.getUniformLocation(sc._program,'uMagentas'),sc.magentas);
    gl.uniform4fv(gl.getUniformLocation(sc._program,'uWhites'),sc.whites);
    gl.uniform4fv(gl.getUniformLocation(sc._program,'uNeutrals'),sc.neutrals);
    gl.uniform4fv(gl.getUniformLocation(sc._program,'uBlacks'),sc.blacks);
    gl.uniform1i(gl.getUniformLocation(sc._program,'uMethod'),sc.method==='relative'?0:1);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return sc._framebuffer.texture;
  }
  function resize(w,h){ sc.width=w; sc.height=h; }
  function dispose(){ gl.deleteFramebuffer(sc._framebuffer.framebuffer); gl.deleteTexture(sc._framebuffer.texture); gl.deleteProgram(sc._program); }
  console.log('[SelectiveColor] 创建完成 method=' + sc.method);
  return { render, resize, dispose, sc };
}

/* ===== 后期处理通道混合器系统 ===== */
function createChannelMixer(gl, width, height, options){
  const opt = options || {};
  const cm = {
    gl: gl, width, height,
    red: opt.red ? opt.red.slice() : [1,0,0,0],
    green: opt.green ? opt.green.slice() : [0,1,0,0],
    blue: opt.blue ? opt.blue.slice() : [0,0,1,0],
    monochrome: opt.monochrome || false,
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
  cm._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec4 uRed; uniform vec4 uGreen; uniform vec4 uBlue; uniform int uMonochrome;
    void main(){ vec4 color=texture2D(uTex,vUV); vec3 c=color.rgb; float r=dot(c,uRed.rgb)+uRed.a; float g=dot(c,uGreen.rgb)+uGreen.a; float b=dot(c,uBlue.rgb)+uBlue.a; if(uMonochrome==1){ float gray=r*0.299+g*0.587+b*0.114; gl_FragColor=vec4(vec3(gray),color.a); } else gl_FragColor=vec4(r,g,b,color.a); }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  cm._program=gl.createProgram();
  gl.attachShader(cm._program,vs);
  gl.attachShader(cm._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(cm._program);
  function render(inputTexture){
    if(!cm.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,cm._framebuffer.framebuffer);
    gl.viewport(0,0,cm.width,cm.height);
    gl.useProgram(cm._program);
    const aPos=gl.getAttribLocation(cm._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(cm._program,'uTex'),0);
    gl.uniform4fv(gl.getUniformLocation(cm._program,'uRed'),cm.red);
    gl.uniform4fv(gl.getUniformLocation(cm._program,'uGreen'),cm.green);
    gl.uniform4fv(gl.getUniformLocation(cm._program,'uBlue'),cm.blue);
    gl.uniform1i(gl.getUniformLocation(cm._program,'uMonochrome'),cm.monochrome?1:0);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return cm._framebuffer.texture;
  }
  function resize(w,h){ cm.width=w; cm.height=h; }
  function dispose(){ gl.deleteFramebuffer(cm._framebuffer.framebuffer); gl.deleteTexture(cm._framebuffer.texture); gl.deleteProgram(cm._program); }
  console.log('[ChannelMixer] 创建完成 monochrome=' + cm.monochrome);
  return { render, resize, dispose, cm };
}

/* ===== 后期处理渐变映射系统 ===== */
function createGradientMap(gl, width, height, options){
  const opt = options || {};
  const gm = {
    gl: gl, width, height,
    gradient: opt.gradient ? opt.gradient.slice() : [[0,0,0],[1,1,1]],
    enabled: true,
    _program: null,
    _framebuffer: null,
    _gradientTexture: null,
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
  gm._framebuffer=createFB(width,height);
  function createGradientTexture(gradient){
    const size=256;
    const data=new Uint8Array(size*4);
    for(let i=0;i<size;i++){
      const t=i/(size-1);
      let r=0,g=0,b=0;
      for(let j=0;j<gradient.length-1;j++){
        const t0=j/(gradient.length-1);
        const t1=(j+1)/(gradient.length-1);
        if(t>=t0&&t<=t1){
          const f=(t-t0)/(t1-t0);
          r=gradient[j][0]*(1-f)+gradient[j+1][0]*f;
          g=gradient[j][1]*(1-f)+gradient[j+1][1]*f;
          b=gradient[j][2]*(1-f)+gradient[j+1][2]*f;
          break;
        }
      }
      data[i*4]=Math.floor(r*255);
      data[i*4+1]=Math.floor(g*255);
      data[i*4+2]=Math.floor(b*255);
      data[i*4+3]=255;
    }
    const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,size,1,0,gl.RGBA,gl.UNSIGNED_BYTE,data);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    return tex;
  }
  gm._gradientTexture=createGradientTexture(gm.gradient);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform sampler2D uGradient; void main(){ vec4 color=texture2D(uTex,vUV); float gray=dot(color.rgb,vec3(0.299,0.587,0.114)); vec3 mapped=texture2D(uGradient,vec2(gray,0.5)).rgb; gl_FragColor=vec4(mapped,color.a); }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  gm._program=gl.createProgram();
  gl.attachShader(gm._program,vs);
  gl.attachShader(gm._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(gm._program);
  function render(inputTexture){
    if(!gm.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,gm._framebuffer.framebuffer);
    gl.viewport(0,0,gm.width,gm.height);
    gl.useProgram(gm._program);
    const aPos=gl.getAttribLocation(gm._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(gm._program,'uTex'),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,gm._gradientTexture); gl.uniform1i(gl.getUniformLocation(gm._program,'uGradient'),1);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return gm._framebuffer.texture;
  }
  function resize(w,h){ gm.width=w; gm.height=h; }
  function dispose(){ gl.deleteFramebuffer(gm._framebuffer.framebuffer); gl.deleteTexture(gm._framebuffer.texture); gl.deleteTexture(gm._gradientTexture); gl.deleteProgram(gm._program); }
  console.log('[GradientMap] 创建完成 gradient stops=' + gm.gradient.length);
  return { render, resize, dispose, gm };
}

/* ===== 后期处理照片滤镜系统 ===== */
function createPhotoFilter(gl, width, height, options){
  const opt = options || {};
  const pf = {
    gl: gl, width, height,
    color: opt.color ? opt.color.slice() : [1,0.8,0.6],
    density: opt.density !== undefined ? opt.density : 0.25,
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
  pf._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec3 uColor; uniform float uDensity; uniform int uPreserveLuminosity;
    void main(){ vec4 color=texture2D(uTex,vUV); float luma=dot(color.rgb,vec3(0.299,0.587,0.114)); vec3 filtered=mix(color.rgb,uColor,uDensity); if(uPreserveLuminosity==1){ float newLuma=dot(filtered,vec3(0.299,0.587,0.114)); filtered*=luma/max(newLuma,0.001); } gl_FragColor=vec4(filtered,color.a); }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  pf._program=gl.createProgram();
  gl.attachShader(pf._program,vs);
  gl.attachShader(pf._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(pf._program);
  function render(inputTexture){
    if(!pf.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,pf._framebuffer.framebuffer);
    gl.viewport(0,0,pf.width,pf.height);
    gl.useProgram(pf._program);
    const aPos=gl.getAttribLocation(pf._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(pf._program,'uTex'),0);
    gl.uniform3fv(gl.getUniformLocation(pf._program,'uColor'),pf.color);
    gl.uniform1f(gl.getUniformLocation(pf._program,'uDensity'),pf.density);
    gl.uniform1i(gl.getUniformLocation(pf._program,'uPreserveLuminosity'),pf.preserveLuminosity?1:0);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return pf._framebuffer.texture;
  }
  function resize(w,h){ pf.width=w; pf.height=h; }
  function dispose(){ gl.deleteFramebuffer(pf._framebuffer.framebuffer); gl.deleteTexture(pf._framebuffer.texture); gl.deleteProgram(pf._program); }
  console.log('[PhotoFilter] 创建完成 density=' + pf.density);
  return { render, resize, dispose, pf };
}

/* ===== 后期处理阴影高光系统 ===== */
function createShadowHighlight(gl, width, height, options){
  const opt = options || {};
  const sh = {
    gl: gl, width, height,
    shadowAmount: opt.shadowAmount !== undefined ? opt.shadowAmount : 0,
    highlightAmount: opt.highlightAmount !== undefined ? opt.highlightAmount : 0,
    shadowTone: opt.shadowTone !== undefined ? opt.shadowTone : 0.5,
    highlightTone: opt.highlightTone !== undefined ? opt.highlightTone : 0.5,
    radius: opt.radius !== undefined ? opt.radius : 100,
    colorCorrection: opt.colorCorrection !== undefined ? opt.colorCorrection : 0,
    midtoneContrast: opt.midtoneContrast !== undefined ? opt.midtoneContrast : 0,
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
  sh._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uShadowAmount; uniform float uHighlightAmount; uniform float uShadowTone; uniform float uHighlightTone; uniform float uColorCorrection; uniform float uMidtoneContrast;
    void main(){ vec4 color=texture2D(uTex,vUV); float luma=dot(color.rgb,vec3(0.299,0.587,0.114)); float shadowMask=1.0-smoothstep(0.0,uShadowTone,luma); float highlightMask=smoothstep(1.0-uHighlightTone,1.0,luma); float midtoneMask=1.0-shadowMask-highlightMask; color.rgb+=uShadowAmount*shadowMask*0.5; color.rgb-=uHighlightAmount*highlightMask*0.5; color.rgb=(color.rgb-0.5)*midtoneMask*uMidtoneContrast+color.rgb; gl_FragColor=color; }`;
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
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(sh._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(sh._program,'uShadowAmount'),sh.shadowAmount);
    gl.uniform1f(gl.getUniformLocation(sh._program,'uHighlightAmount'),sh.highlightAmount);
    gl.uniform1f(gl.getUniformLocation(sh._program,'uShadowTone'),sh.shadowTone);
    gl.uniform1f(gl.getUniformLocation(sh._program,'uHighlightTone'),sh.highlightTone);
    gl.uniform1f(gl.getUniformLocation(sh._program,'uColorCorrection'),sh.colorCorrection);
    gl.uniform1f(gl.getUniformLocation(sh._program,'uMidtoneContrast'),sh.midtoneContrast);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return sh._framebuffer.texture;
  }
  function resize(w,h){ sh.width=w; sh.height=h; }
  function dispose(){ gl.deleteFramebuffer(sh._framebuffer.framebuffer); gl.deleteTexture(sh._framebuffer.texture); gl.deleteProgram(sh._program); }
  console.log('[ShadowHighlight] 创建完成 shadow=' + sh.shadowAmount + ' highlight=' + sh.highlightAmount);
  return { render, resize, dispose, sh };
}

/* ===== 后期处理HDR色调系统 ===== */
function createHDRToning(gl, width, height, options){
  const opt = options || {};
  const hdr = {
    gl: gl, width, height,
    radius: opt.radius !== undefined ? opt.radius : 1,
    strength: opt.strength !== undefined ? opt.strength : 0.5,
    gamma: opt.gamma !== undefined ? opt.gamma : 1,
    exposure: opt.exposure !== undefined ? opt.exposure : 0,
    detail: opt.detail !== undefined ? opt.detail : 0.5,
    saturation: opt.saturation !== undefined ? opt.saturation : 0.5,
    radius2: opt.radius2 !== undefined ? opt.radius2 : 1,
    strength2: opt.strength2 !== undefined ? opt.strength2 : 0.5,
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
  hdr._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uRadius; uniform float uStrength; uniform float uGamma; uniform float uExposure; uniform float uDetail; uniform float uSaturation;
    void main(){ vec4 color=texture2D(uTex,vUV); float luma=dot(color.rgb,vec3(0.299,0.587,0.114)); vec3 hdrColor=color.rgb*(1.0+uExposure); hdrColor=pow(max(hdrColor,vec3(0.0)),vec3(1.0/uGamma)); float gray=dot(hdrColor,vec3(0.299,0.587,0.114)); hdrColor=mix(vec3(gray),hdrColor,uSaturation); gl_FragColor=vec4(hdrColor,color.a); }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  hdr._program=gl.createProgram();
  gl.attachShader(hdr._program,vs);
  gl.attachShader(hdr._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(hdr._program);
  function render(inputTexture){
    if(!hdr.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,hdr._framebuffer.framebuffer);
    gl.viewport(0,0,hdr.width,hdr.height);
    gl.useProgram(hdr._program);
    const aPos=gl.getAttribLocation(hdr._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(hdr._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(hdr._program,'uRadius'),hdr.radius);
    gl.uniform1f(gl.getUniformLocation(hdr._program,'uStrength'),hdr.strength);
    gl.uniform1f(gl.getUniformLocation(hdr._program,'uGamma'),hdr.gamma);
    gl.uniform1f(gl.getUniformLocation(hdr._program,'uExposure'),hdr.exposure);
    gl.uniform1f(gl.getUniformLocation(hdr._program,'uDetail'),hdr.detail);
    gl.uniform1f(gl.getUniformLocation(hdr._program,'uSaturation'),hdr.saturation);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return hdr._framebuffer.texture;
  }
  function resize(w,h){ hdr.width=w; hdr.height=h; }
  function dispose(){ gl.deleteFramebuffer(hdr._framebuffer.framebuffer); gl.deleteTexture(hdr._framebuffer.texture); gl.deleteProgram(hdr._program); }
  console.log('[HDRToning] 创建完成 strength=' + hdr.strength);
  return { render, resize, dispose, hdr };
}

/* ===== 后期处理去噪系统 ===== */
function createDenoise(gl, width, height, options){
  const opt = options || {};
  const dn = {
    gl: gl, width, height,
    strength: opt.strength !== undefined ? opt.strength : 0.5,
    threshold: opt.threshold !== undefined ? opt.threshold : 0.1,
    radius: opt.radius || 2,
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
  dn._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uStrength; uniform float uThreshold; uniform vec2 uTexel;
    void main(){ vec4 center=texture2D(uTex,vUV); vec4 result=vec4(0.0); float total=0.0; for(int x=-3;x<=3;x++){ for(int y=-3;y<=3;y++){ vec4 sample=texture2D(uTex,vUV+vec2(float(x),float(y))*uTexel); float diff=length(sample.rgb-center.rgb); float weight=exp(-diff*diff/(uThreshold*uThreshold))*exp(-(float(x*x+y*y))/9.0); result+=sample*weight; total+=weight; } } result/=total; gl_FragColor=mix(center,result,uStrength); }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  dn._program=gl.createProgram();
  gl.attachShader(dn._program,vs);
  gl.attachShader(dn._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(dn._program);
  function render(inputTexture){
    if(!dn.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,dn._framebuffer.framebuffer);
    gl.viewport(0,0,dn.width,dn.height);
    gl.useProgram(dn._program);
    const aPos=gl.getAttribLocation(dn._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(dn._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(dn._program,'uStrength'),dn.strength);
    gl.uniform1f(gl.getUniformLocation(dn._program,'uThreshold'),dn.threshold);
    gl.uniform2f(gl.getUniformLocation(dn._program,'uTexel'),1/dn.width,1/dn.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return dn._framebuffer.texture;
  }
  function resize(w,h){ dn.width=w; dn.height=h; }
  function dispose(){ gl.deleteFramebuffer(dn._framebuffer.framebuffer); gl.deleteTexture(dn._framebuffer.texture); gl.deleteProgram(dn._program); }
  console.log('[Denoise] 创建完成 strength=' + dn.strength);
  return { render, resize, dispose, dn };
}

/* ===== 后期处理USM锐化系统 ===== */
function createUnsharpMask(gl, width, height, options){
  const opt = options || {};
  const usm = {
    gl: gl, width, height,
    amount: opt.amount !== undefined ? opt.amount : 0.5,
    radius: opt.radius !== undefined ? opt.radius : 1,
    threshold: opt.threshold !== undefined ? opt.threshold : 0,
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
  usm._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uAmount; uniform float uRadius; uniform float uThreshold; uniform vec2 uTexel;
    void main(){ vec4 center=texture2D(uTex,vUV); vec4 blur=vec4(0.0); float total=0.0; for(int x=-3;x<=3;x++){ for(int y=-3;y<=3;y++){ float weight=exp(-(float(x*x+y*y))/(2.0*uRadius*uRadius)); blur+=texture2D(uTex,vUV+vec2(float(x),float(y))*uTexel)*weight; total+=weight; } } blur/=total; vec4 sharp=center+(center-blur)*uAmount; float diff=length(center.rgb-blur.rgb); if(diff<uThreshold) sharp=center; gl_FragColor=sharp; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  usm._program=gl.createProgram();
  gl.attachShader(usm._program,vs);
  gl.attachShader(usm._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(usm._program);
  function render(inputTexture){
    if(!usm.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,usm._framebuffer.framebuffer);
    gl.viewport(0,0,usm.width,usm.height);
    gl.useProgram(usm._program);
    const aPos=gl.getAttribLocation(usm._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(usm._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(usm._program,'uAmount'),usm.amount);
    gl.uniform1f(gl.getUniformLocation(usm._program,'uRadius'),usm.radius);
    gl.uniform1f(gl.getUniformLocation(usm._program,'uThreshold'),usm.threshold);
    gl.uniform2f(gl.getUniformLocation(usm._program,'uTexel'),1/usm.width,1/usm.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return usm._framebuffer.texture;
  }
  function resize(w,h){ usm.width=w; usm.height=h; }
  function dispose(){ gl.deleteFramebuffer(usm._framebuffer.framebuffer); gl.deleteTexture(usm._framebuffer.texture); gl.deleteProgram(usm._program); }
  console.log('[UnsharpMask] 创建完成 amount=' + usm.amount + ' radius=' + usm.radius);
  return { render, resize, dispose, usm };
}