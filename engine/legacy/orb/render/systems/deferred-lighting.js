function createDeferredRenderer(gl, width, height, options){
  const dr = {
    gl: gl,
    width: width,
    height: height,
    _gBuffer: null,
    _positionTexture: null,
    _normalTexture: null,
    _albedoTexture: null,
    _depthRenderbuffer: null,
    _lightProgram: null,
    _compositeProgram: null,
    _quadBuffer: null,
    _lights: [],
    _maxLights: (options && options.maxLights) || 64,
    _initialized: false
  };

  function init(){
    const gl = dr.gl;
    dr._gBuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, dr._gBuffer);
    dr._positionTexture = createColorTexture(gl, dr.width, dr.height, gl.RGBA16F, gl.FLOAT);
    dr._normalTexture = createColorTexture(gl, dr.width, dr.height, gl.RGBA16F, gl.FLOAT);
    dr._albedoTexture = createColorTexture(gl, dr.width, dr.height, gl.RGBA8, gl.UNSIGNED_BYTE);
    dr._depthRenderbuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, dr._depthRenderbuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, dr.width, dr.height);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dr._positionTexture, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, dr._normalTexture, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, dr._albedoTexture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, dr._depthRenderbuffer);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);

    const geomVS = `
      attribute vec3 aPosition;
      attribute vec3 aNormal;
      attribute vec2 aUV;
      uniform mat4 uModel;
      uniform mat4 uViewProj;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec2 vUV;
      void main(){
        vec4 worldPos = uModel * vec4(aPosition, 1.0);
        vWorldPos = worldPos.xyz;
        vNormal = mat3(uModel) * aNormal;
        vUV = aUV;
        gl_Position = uViewProj * worldPos;
      }
    `;
    const geomFS = `
      precision highp float;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec2 vUV;
      uniform vec3 uAlbedo;
      void main(){
        gl_FragData[0] = vec4(vWorldPos, 1.0);
        gl_FragData[1] = vec4(normalize(vNormal), 1.0);
        gl_FragData[2] = vec4(uAlbedo, 1.0);
      }
    `;
    dr._geomProgram = createShaderProgram(gl, geomVS, geomFS);

    const lightVS = `
      attribute vec2 aPosition;
      varying vec2 vUV;
      void main(){ vUV = aPosition * 0.5 + 0.5; gl_Position = vec4(aPosition, 0.0, 1.0); }
    `;
    const lightFS = `
      precision highp float;
      uniform sampler2D uPositionTex;
      uniform sampler2D uNormalTex;
      uniform sampler2D uAlbedoTex;
      uniform vec3 uCameraPos;
      uniform vec3 uLightPos[64];
      uniform vec3 uLightColor[64];
      uniform float uLightIntensity[64];
      uniform int uLightCount;
      varying vec2 vUV;
      void main(){
        vec3 worldPos = texture2D(uPositionTex, vUV).xyz;
        vec3 normal = normalize(texture2D(uNormalTex, vUV).xyz);
        vec3 albedo = texture2D(uAlbedoTex, vUV).rgb;
        vec3 viewDir = normalize(uCameraPos - worldPos);
        vec3 color = albedo * 0.1;
        for(int i = 0; i < 64; i++){
          if(i >= uLightCount) break;
          vec3 toLight = uLightPos[i] - worldPos;
          float dist = length(toLight);
          toLight /= dist;
          float ndotl = max(dot(normal, toLight), 0.0);
          float atten = uLightIntensity[i] / (dist * dist + 0.1);
          vec3 halfDir = normalize(toLight + viewDir);
          float spec = pow(max(dot(normal, halfDir), 0.0), 32.0);
          color += (albedo * ndotl + spec) * uLightColor[i] * atten;
        }
        gl_FragColor = vec4(color, 1.0);
      }
    `;
    dr._lightProgram = createShaderProgram(gl, lightVS, lightFS);
    const quadVerts = new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]);
    dr._quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, dr._quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
    dr._initialized = true;
  }

  function createColorTexture(gl, w, h, format, type){
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function createShaderProgram(gl, vsSrc, fsSrc){
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSrc); gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSrc); gl.compileShader(fs);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    return prog;
  }

  function addLight(position, color, intensity){
    if(dr._lights.length >= dr._maxLights) return null;
    const light = { position: [position[0],position[1],position[2]], color: [color[0],color[1],color[2]], intensity: intensity || 1 };
    dr._lights.push(light);
    return light;
  }

  function removeLight(light){
    const idx = dr._lights.indexOf(light);
    if(idx >= 0) dr._lights.splice(idx, 1);
  }

  function beginGeometryPass(){
    if(!dr._initialized) return;
    const gl = dr.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dr._gBuffer);
    gl.viewport(0, 0, dr.width, dr.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(dr._geomProgram);
  }

  function endGeometryPass(){
    const gl = dr.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function lightPass(cameraPosition){
    if(!dr._initialized) return;
    const gl = dr.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, dr.width, dr.height);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(dr._lightProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dr._positionTexture);
    gl.uniform1i(gl.getUniformLocation(dr._lightProgram, 'uPositionTex'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, dr._normalTexture);
    gl.uniform1i(gl.getUniformLocation(dr._lightProgram, 'uNormalTex'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, dr._albedoTexture);
    gl.uniform1i(gl.getUniformLocation(dr._lightProgram, 'uAlbedoTex'), 2);
    gl.uniform3fv(gl.getUniformLocation(dr._lightProgram, 'uCameraPos'), cameraPosition);
    const lightPos = new Float32Array(dr._maxLights * 3);
    const lightCol = new Float32Array(dr._maxLights * 3);
    const lightInt = new Float32Array(dr._maxLights);
    for(let i = 0; i < dr._lights.length; i++){
      lightPos[i*3] = dr._lights[i].position[0];
      lightPos[i*3+1] = dr._lights[i].position[1];
      lightPos[i*3+2] = dr._lights[i].position[2];
      lightCol[i*3] = dr._lights[i].color[0];
      lightCol[i*3+1] = dr._lights[i].color[1];
      lightCol[i*3+2] = dr._lights[i].color[2];
      lightInt[i] = dr._lights[i].intensity;
    }
    gl.uniform3fv(gl.getUniformLocation(dr._lightProgram, 'uLightPos'), lightPos);
    gl.uniform3fv(gl.getUniformLocation(dr._lightProgram, 'uLightColor'), lightCol);
    gl.uniform1fv(gl.getUniformLocation(dr._lightProgram, 'uLightIntensity'), lightInt);
    gl.uniform1i(gl.getUniformLocation(dr._lightProgram, 'uLightCount'), dr._lights.length);
    gl.bindBuffer(gl.ARRAY_BUFFER, dr._quadBuffer);
    const posLoc = gl.getAttribLocation(dr._lightProgram, 'aPosition');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.enable(gl.DEPTH_TEST);
  }

  function resize(w, h){
    dr.width = w; dr.height = h;
    if(!dr._initialized) return;
    const gl = dr.gl;
    gl.bindTexture(gl.TEXTURE_2D, dr._positionTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    gl.bindTexture(gl.TEXTURE_2D, dr._normalTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    gl.bindTexture(gl.TEXTURE_2D, dr._albedoTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, dr._depthRenderbuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
  }

  function dispose(){
    const gl = dr.gl;
    if(dr._gBuffer) gl.deleteFramebuffer(dr._gBuffer);
    if(dr._positionTexture) gl.deleteTexture(dr._positionTexture);
    if(dr._normalTexture) gl.deleteTexture(dr._normalTexture);
    if(dr._albedoTexture) gl.deleteTexture(dr._albedoTexture);
    if(dr._depthRenderbuffer) gl.deleteRenderbuffer(dr._depthRenderbuffer);
    if(dr._lightProgram) gl.deleteProgram(dr._lightProgram);
    if(dr._geomProgram) gl.deleteProgram(dr._geomProgram);
    if(dr._quadBuffer) gl.deleteBuffer(dr._quadBuffer);
  }

  return { init, addLight, removeLight, beginGeometryPass, endGeometryPass, lightPass, resize, dispose, dr };
}

/* ===== 级联阴影贴图系统 =====
   支持: 多级阴影 / 视锥分割 / 混合过渡
*/
function createCascadedShadowMaps(gl, options){
  const csm = {
    gl: gl,
    _cascades: [],
    _cascadeCount: (options && options.cascadeCount) || 4,
    _resolution: (options && options.resolution) || 1024,
    _splitScheme: (options && options.splitScheme) || 'practical',
    _lambda: (options && options.lambda) || 0.5,
    _bias: (options && options.bias) || 0.005,
    _normalBias: (options && options.normalBias) || 0.02,
    _lightDirection: [0.5, 1, 0.3],
    _initialized: false
  };

  function init(){
    const gl = csm.gl;
    for(let i = 0; i < csm._cascadeCount; i++){
      const fb = gl.createFramebuffer();
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, csm._resolution, csm._resolution, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
      gl.drawBuffers([gl.NONE]);
      csm._cascades.push({ framebuffer: fb, texture: tex, split: 0, viewProj: M4.create() });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    csm._initialized = true;
  }

  function setLightDirection(x, y, z){
    csm._lightDirection = [x, y, z];
  }

  function computeCascadeSplits(near, far){
    const splits = [];
    const ratio = far / near;
    for(let i = 1; i <= csm._cascadeCount; i++){
      const p = i / csm._cascadeCount;
      const logSplit = near * Math.pow(ratio, p);
      const uniSplit = near + (far - near) * p;
      const split = csm._lambda * logSplit + (1 - csm._lambda) * uniSplit;
      splits.push(split);
    }
    return splits;
  }

  function update(camera, near, far){
    if(!csm._initialized) return;
    const splits = computeCascadeSplits(near, far);
    for(let i = 0; i < csm._cascadeCount; i++){
      csm._cascades[i].split = splits[i];
      const cascadeNear = i === 0 ? near : splits[i-1];
      const cascadeFar = splits[i];
      const lightView = M4.lookAt(M4.create(), csm._lightDirection, [0,0,0], [0,1,0]);
      const lightProj = M4.orthographic ? M4.orthographic(M4.create(), -10, 10, -10, 10, 0.1, 100) : M4.create();
      M4.mult(csm._cascades[i].viewProj, lightProj, lightView);
    }
  }

  function beginCascade(index){
    if(!csm._initialized || index >= csm._cascadeCount) return;
    const gl = csm.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, csm._cascades[index].framebuffer);
    gl.viewport(0, 0, csm._resolution, csm._resolution);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.cullFace(gl.FRONT);
  }

  function endCascade(){
    const gl = csm.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.cullFace(gl.BACK);
  }

  function getCascadeMatrix(index){
    return csm._cascades[index] ? csm._cascades[index].viewProj : null;
  }

  function getCascadeSplit(index){
    return csm._cascades[index] ? csm._cascades[index].split : 0;
  }

  function getShadowMaps(){
    return csm._cascades.map(function(c){ return c.texture; });
  }

  function dispose(){
    const gl = csm.gl;
    for(let i = 0; i < csm._cascades.length; i++){
      gl.deleteFramebuffer(csm._cascades[i].framebuffer);
      gl.deleteTexture(csm._cascades[i].texture);
    }
  }

  return { init, setLightDirection, update, beginCascade, endCascade, getCascadeMatrix, getCascadeSplit, getShadowMaps, dispose, csm };
}

/* ===== 体积光系统 =====
   支持: 光线散射 / 深度参与 / 噪声扰动
*/
function createVolumetricLight(gl, width, height, options){
  const vl = {
    gl: gl,
    width: width,
    height: height,
    _framebuffer: null,
    _texture: null,
    _program: null,
    _quadBuffer: null,
    _density: (options && options.density) || 0.5,
    _decay: (options && options.decay) || 0.95,
    _weight: (options && options.weight) || 0.3,
    _samples: (options && options.samples) || 64,
    _lightPosition: [0, 1, 0],
    _lightColor: [1, 0.95, 0.8],
    _initialized: false
  };

  function init(){
    const gl = vl.gl;
    vl._framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, vl._framebuffer);
    vl._texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, vl._texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, vl.width, vl.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, vl._texture, 0);
    const vs = `
      attribute vec2 aPosition;
      varying vec2 vUV;
      void main(){ vUV = aPosition * 0.5 + 0.5; gl_Position = vec4(aPosition, 0.0, 1.0); }
    `;
    const fs = `
      precision mediump float;
      uniform sampler2D uSceneTex;
      uniform sampler2D uDepthTex;
      uniform vec2 uLightScreenPos;
      uniform vec3 uLightColor;
      uniform float uDensity;
      uniform float uDecay;
      uniform float uWeight;
      uniform int uSamples;
      varying vec2 vUV;
      void main(){
        vec2 texCoord = vUV;
        vec2 deltaTexCoord = (texCoord - uLightScreenPos) / float(uSamples);
        vec3 color = texture2D(uSceneTex, texCoord).rgb;
        float illuminationDecay = 1.0;
        for(int i = 0; i < 128; i++){
          if(i >= uSamples) break;
          texCoord -= deltaTexCoord;
          vec3 sampleColor = texture2D(uSceneTex, texCoord).rgb;
          sampleColor *= illuminationDecay * uWeight;
          color += sampleColor;
          illuminationDecay *= uDecay;
        }
        gl_FragColor = vec4(color * uLightColor * uDensity, 1.0);
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    vl._program = gl.createProgram();
    gl.attachShader(vl._program, vsh);
    gl.attachShader(vl._program, fsh);
    gl.linkProgram(vl._program);
    const quad = new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]);
    vl._quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vl._quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    vl._initialized = true;
  }

  function setLightPosition(x, y){
    vl._lightPosition = [x, y];
  }

  function setLightColor(r, g, b){
    vl._lightColor = [r, g, b];
  }

  function setDensity(v){ vl._density = v; }
  function setDecay(v){ vl._decay = v; }
  function setWeight(v){ vl._weight = v; }
  function setSamples(v){ vl._samples = v; }

  function render(sceneTexture, depthTexture){
    if(!vl._initialized) return;
    const gl = vl.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, vl._framebuffer);
    gl.viewport(0, 0, vl.width, vl.height);
    gl.useProgram(vl._program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
    gl.uniform1i(gl.getUniformLocation(vl._program, 'uSceneTex'), 0);
    if(depthTexture){
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, depthTexture);
      gl.uniform1i(gl.getUniformLocation(vl._program, 'uDepthTex'), 1);
    }
    gl.uniform2fv(gl.getUniformLocation(vl._program, 'uLightScreenPos'), vl._lightPosition);
    gl.uniform3fv(gl.getUniformLocation(vl._program, 'uLightColor'), vl._lightColor);
    gl.uniform1f(gl.getUniformLocation(vl._program, 'uDensity'), vl._density);
    gl.uniform1f(gl.getUniformLocation(vl._program, 'uDecay'), vl._decay);
    gl.uniform1f(gl.getUniformLocation(vl._program, 'uWeight'), vl._weight);
    gl.uniform1i(gl.getUniformLocation(vl._program, 'uSamples'), vl._samples);
    gl.bindBuffer(gl.ARRAY_BUFFER, vl._quadBuffer);
    const posLoc = gl.getAttribLocation(vl._program, 'aPosition');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function getTexture(){
    return vl._texture;
  }

  function dispose(){
    const gl = vl.gl;
    if(vl._framebuffer) gl.deleteFramebuffer(vl._framebuffer);
    if(vl._texture) gl.deleteTexture(vl._texture);
    if(vl._program) gl.deleteProgram(vl._program);
    if(vl._quadBuffer) gl.deleteBuffer(vl._quadBuffer);
  }

  return { init, setLightPosition, setLightColor, setDensity, setDecay, setWeight, setSamples, render, getTexture, dispose, vl };
}

/* ===== 镜头光晕系统 =====
   支持: 鬼影 / 光环 / 自动位置 / 强度控制
*/
function createLensFlare(gl, options){
  const lf = {
    gl: gl,
    _elements: [],
    _program: null,
    _quadBuffer: null,
    _intensity: (options && options.intensity) || 1,
    _threshold: (options && options.threshold) || 0.5,
    _initialized: false
  };

  function init(){
    const gl = lf.gl;
    const vs = `
      attribute vec2 aPosition;
      attribute vec2 aUV;
      attribute vec4 aColor;
      attribute float aSize;
      uniform vec2 uResolution;
      uniform vec2 uLightPos;
      varying vec2 vUV;
      varying vec4 vColor;
      void main(){
        vec2 dir = aPosition - uLightPos;
        vec2 pos = uLightPos + dir * (aSize * 2.0);
        vec2 screenPos = pos / uResolution * 2.0 - 1.0;
        screenPos.y = -screenPos.y;
        gl_Position = vec4(screenPos, 0.0, 1.0);
        gl_PointSize = aSize;
        vUV = aUV;
        vColor = aColor;
      }
    `;
    const fs = `
      precision mediump float;
      uniform sampler2D uFlareTexture;
      varying vec2 vUV;
      varying vec4 vColor;
      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        float dist = length(uv);
        if(dist > 0.5) discard;
        float alpha = smoothstep(0.5, 0.1, dist);
        gl_FragColor = vec4(vColor.rgb, vColor.a * alpha);
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    lf._program = gl.createProgram();
    gl.attachShader(lf._program, vsh);
    gl.attachShader(lf._program, fsh);
    gl.linkProgram(lf._program);
    lf._quadBuffer = gl.createBuffer();
    lf._initialized = true;
    addDefaultElements();
  }

  function addDefaultElements(){
    const colors = [
      [1.0, 0.8, 0.6, 0.8],
      [0.6, 0.8, 1.0, 0.6],
      [1.0, 0.6, 0.8, 0.5],
      [0.8, 1.0, 0.6, 0.4],
      [0.6, 0.6, 1.0, 0.7],
      [1.0, 1.0, 0.8, 0.9]
    ];
    const sizes = [80, 40, 60, 30, 50, 100];
    const distances = [0.2, 0.5, 0.8, 1.2, 1.5, 2.0];
    for(let i = 0; i < 6; i++){
      lf._elements.push({
        color: colors[i],
        size: sizes[i],
        distance: distances[i],
        texture: null
      });
    }
  }

  function addElement(color, size, distance, texture){
    lf._elements.push({ color: color, size: size, distance: distance, texture: texture });
  }

  function setIntensity(v){
    lf._intensity = v;
  }

  function render(lightScreenX, lightScreenY, width, height){
    if(!lf._initialized) return;
    const gl = lf.gl;
    if(lightScreenX < 0 || lightScreenX > width || lightScreenY < 0 || lightScreenY > height) return;
    const centerX = width / 2, centerY = height / 2;
    const dirX = centerX - lightScreenX, dirY = centerY - lightScreenY;
    gl.useProgram(lf._program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.uniform2f(gl.getUniformLocation(lf._program, 'uResolution'), width, height);
    gl.uniform2f(gl.getUniformLocation(lf._program, 'uLightPos'), lightScreenX, lightScreenY);
    const verts = new Float32Array(lf._elements.length * 4 * 9);
    for(let i = 0; i < lf._elements.length; i++){
      const el = lf._elements[i];
      const ex = lightScreenX + dirX * el.distance;
      const ey = lightScreenY + dirY * el.distance;
      const base = i * 36;
      const corners = [[-1,-1],[1,-1],[1,1],[-1,1]];
      const uvs = [[0,0],[1,0],[1,1],[0,1]];
      for(let c = 0; c < 4; c++){
        verts[base+c*9] = ex + corners[c][0] * el.size;
        verts[base+c*9+1] = ey + corners[c][1] * el.size;
        verts[base+c*9+2] = uvs[c][0];
        verts[base+c*9+3] = uvs[c][1];
        verts[base+c*9+4] = el.color[0];
        verts[base+c*9+5] = el.color[1];
        verts[base+c*9+6] = el.color[2];
        verts[base+c*9+7] = el.color[3] * lf._intensity;
        verts[base+c*9+8] = el.size;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, lf._quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    const posLoc = gl.getAttribLocation(lf._program, 'aPosition');
    const uvLoc = gl.getAttribLocation(lf._program, 'aUV');
    const colLoc = gl.getAttribLocation(lf._program, 'aColor');
    const sizeLoc = gl.getAttribLocation(lf._program, 'aSize');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 36, 8);
    gl.enableVertexAttribArray(colLoc);
    gl.vertexAttribPointer(colLoc, 4, gl.FLOAT, false, 36, 16);
    gl.enableVertexAttribArray(sizeLoc);
    gl.vertexAttribPointer(sizeLoc, 1, gl.FLOAT, false, 36, 32);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, lf._elements.length * 4);
    gl.disable(gl.BLEND);
  }

  function dispose(){
    const gl = lf.gl;
    if(lf._program) gl.deleteProgram(lf._program);
    if(lf._quadBuffer) gl.deleteBuffer(lf._quadBuffer);
  }

  return { init, addElement, setIntensity, render, dispose, lf };
}

/* ===== 轮廓渲染系统 =====
   支持: 描边 / 轮廓光 / 后处理边缘检测
*/
function createOutlineRenderer(gl, options){
  const outline = {
    gl: gl,
    _program: null,
    _quadBuffer: null,
    _color: (options && options.color) || [0, 0, 0, 1],
    _thickness: (options && options.thickness) || 2,
    _threshold: (options && options.threshold) || 0.1,
    _initialized: false
  };

  function init(){
    const gl = outline.gl;
    const vs = `
      attribute vec2 aPosition;
      varying vec2 vUV;
      void main(){ vUV = aPosition * 0.5 + 0.5; gl_Position = vec4(aPosition, 0.0, 1.0); }
    `;
    const fs = `
      precision mediump float;
      uniform sampler2D uSceneTex;
      uniform sampler2D uDepthTex;
      uniform vec2 uTexelSize;
      uniform vec4 uOutlineColor;
      uniform float uThreshold;
      varying vec2 vUV;
      void main(){
        float depth = texture2D(uDepthTex, vUV).r;
        float depthL = texture2D(uDepthTex, vUV - vec2(uTexelSize.x, 0.0)).r;
        float depthR = texture2D(uDepthTex, vUV + vec2(uTexelSize.x, 0.0)).r;
        float depthU = texture2D(uDepthTex, vUV - vec2(0.0, uTexelSize.y)).r;
        float depthD = texture2D(uDepthTex, vUV + vec2(0.0, uTexelSize.y)).r;
        float edge = abs(depth - depthL) + abs(depth - depthR) + abs(depth - depthU) + abs(depth - depthD);
        vec3 color = texture2D(uSceneTex, vUV).rgb;
        float colorEdge = 0.0;
        vec3 colorL = texture2D(uSceneTex, vUV - vec2(uTexelSize.x, 0.0)).rgb;
        vec3 colorR = texture2D(uSceneTex, vUV + vec2(uTexelSize.x, 0.0)).rgb;
        colorEdge = length(color - colorL) + length(color - colorR);
        float isEdge = step(uThreshold, edge + colorEdge * 0.5);
        gl_FragColor = vec4(mix(color, uOutlineColor.rgb, isEdge * uOutlineColor.a), 1.0);
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    outline._program = gl.createProgram();
    gl.attachShader(outline._program, vsh);
    gl.attachShader(outline._program, fsh);
    gl.linkProgram(outline._program);
    const quad = new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]);
    outline._quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, outline._quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    outline._initialized = true;
  }

  function setColor(r, g, b, a){
    outline._color = [r, g, b, a];
  }

  function setThickness(v){
    outline._thickness = v;
  }

  function setThreshold(v){
    outline._threshold = v;
  }

  function render(sceneTexture, depthTexture, width, height){
    if(!outline._initialized) return;
    const gl = outline.gl;
    gl.useProgram(outline._program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
    gl.uniform1i(gl.getUniformLocation(outline._program, 'uSceneTex'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    gl.uniform1i(gl.getUniformLocation(outline._program, 'uDepthTex'), 1);
    gl.uniform2f(gl.getUniformLocation(outline._program, 'uTexelSize'), outline._thickness / width, outline._thickness / height);
    gl.uniform4fv(gl.getUniformLocation(outline._program, 'uOutlineColor'), outline._color);
    gl.uniform1f(gl.getUniformLocation(outline._program, 'uThreshold'), outline._threshold);
    gl.bindBuffer(gl.ARRAY_BUFFER, outline._quadBuffer);
    const posLoc = gl.getAttribLocation(outline._program, 'aPosition');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function dispose(){
    const gl = outline.gl;
    if(outline._program) gl.deleteProgram(outline._program);
    if(outline._quadBuffer) gl.deleteBuffer(outline._quadBuffer);
  }

  return { init, setColor, setThickness, setThreshold, render, dispose, outline };
}

/* ===== 质量设置系统 =====
   支持: 预设质量 / 动态调整 / 性能监控
*/