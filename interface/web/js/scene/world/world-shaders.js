// ---- programs ---------------------------------------------------------
  var terrainProgram = program(
    '#version 300 es\n' +
    'in vec3 aPos; in vec3 aNormal; in vec3 aColor;\n' +
    'uniform mat4 uViewProj;\n' +
    'out vec3 vNormal; out vec3 vColor; out vec3 vWorld;\n' +
    'void main(){ vNormal=aNormal; vColor=aColor; vWorld=aPos; gl_Position=uViewProj*vec4(aPos,1.0); }',
    '#version 300 es\n' +
    'precision highp float;\n' +
    'float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }\n' +
    'float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);\n' +
    '  float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));\n' +
    '  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }\n' +
    'in vec3 vNormal; in vec3 vColor; in vec3 vWorld;\n' +
    'uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uAmbient;\n' +
    'uniform vec3 uFogColor; uniform float uFogDensity; uniform vec3 uCameraPos;\n' +
    'uniform mat4 uLightVP; uniform sampler2D uShadowMap; uniform float uShadowBias;\n' +
    'out vec4 outColor;\n' +
    'void main(){\n' +
    '  vec3 n=normalize(vNormal);\n' +
    '  float ndl=max(dot(n,normalize(uSunDir)),0.0);\n' +
    '  vec3 base=vColor;\n' +
    '  float macro=noise(vWorld.xz*0.10);\n' +
    '  base*=0.82+0.30*macro;\n' +
    '  float slope=1.0-n.y;\n' +
    '  base=mix(base, vec3(0.29,0.27,0.24), smoothstep(0.55,0.92,slope)*0.58);\n' +
    '  float grain=noise(vWorld.xz*2.1);\n' +
    '  base*=0.88+0.14*grain;\n' +
    '  vec4 sc=uLightVP*vec4(vWorld,1.0); sc.xyz/=sc.w; sc.xyz=sc.xyz*0.5+0.5;\n' +
    '  float shadow=1.0;\n' +
    '  if(sc.x>0.0 && sc.x<1.0 && sc.y>0.0 && sc.y<1.0 && sc.z<1.0){\n' +
    '    float d=texture(uShadowMap,sc.xy).r;\n' +
    '    shadow=(d < sc.z-uShadowBias) ? 0.38 : 1.0;\n' +
    '  }\n' +
    '  vec3 lit=base*(uAmbient + uSunColor*(0.25+0.85*ndl)*shadow);\n' +
    '  float dist=length(vWorld-uCameraPos);\n' +
    '  float fog=1.0-exp(-pow(dist*uFogDensity,2.0));\n' +
    '  lit=mix(lit,uFogColor,clamp(fog,0.0,0.82));\n' +
    '  lit=lit/(lit+vec3(1.0));\n' +
    '  outColor=vec4(lit,1.0);\n' +
    '}'
  );
  var skyProgram = program(
    '#version 300 es\n' +
    'in vec3 aPos;\n' +
    'uniform mat4 uViewProj; uniform vec3 uCenter;\n' +
    'out vec3 vDir;\n' +
    'void main(){ vDir=aPos; gl_Position=uViewProj*vec4(aPos*500.0+uCenter,1.0); }',
    '#version 300 es\n' +
    'precision highp float;\n' +
    'in vec3 vDir;\n' +
    'uniform vec3 uSkyTop; uniform vec3 uSkyHorizon; uniform vec3 uGroundColor;\n' +
    'uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uCloudColor;\n' +
    'uniform float uCloud; uniform float uStar; uniform float uTime;\n' +
    'out vec4 outColor;\n' +
    'float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }\n' +
    'float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);\n' +
    '  float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));\n' +
    '  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }\n' +
    'float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=noise(p)*a; p=p*2.02+vec2(3.7,1.3); a*=0.5; } return v; }\n' +
    'void main(){\n' +
    '  vec3 d=normalize(vDir);\n' +
    '  float up=max(d.y,0.0);\n' +
    '  vec3 sky=mix(vec3(1.0,0.62,0.38), vec3(0.035,0.135,0.32), smoothstep(-0.01,0.10,d.y));\n' +
    '  vec3 ground=mix(uSkyHorizon,uGroundColor,smoothstep(0.0,-0.35,d.y));\n' +
    '  sky=mix(sky,ground,smoothstep(0.02,-0.18,d.y));\n' +
    '  float sd=max(dot(d,normalize(uSunDir)),0.0);\n' +
    '  sky+=uSunColor*pow(sd,700.0)*4.2;\n' +
    '  sky+=uSunColor*pow(sd,16.0)*0.28;\n' +
    '  vec2 uv=d.xz/(max(d.y,0.05)+0.22)*0.72;\n' +
    '  float n=fbm(uv*2.4+vec2(uTime*0.006,0.0));\n' +
    '  float cloud=smoothstep(0.54-uCloud*0.12,0.82,n)*smoothstep(0.0,0.22,d.y);\n' +
    '  sky=mix(sky,uCloudColor,cloud*0.30);\n' +
    '  float star=step(0.9975,hash(floor(d.xz*720.0)))*uStar;\n' +
    '  sky+=vec3(star)*0.85;\n' +
    '  outColor=vec4(sky,1.0);\n' +
    '}'
  );
  var waterProgram = program(
    '#version 300 es\n' +
    'in vec2 aPos;\n' +
    'uniform mat4 uViewProj; uniform vec4 uWaves[8]; uniform float uPhases[8];\n' +
    'uniform float uWaterLevel;\n' +
    'out vec3 vWorld; out vec3 vNormal;\n' +
    'void main(){\n' +
    '  vec2 p=aPos; float y=0.0, dx=0.0, dz=0.0;\n' +
    '  for(int i=0;i<8;i++){ vec4 w=uWaves[i]; float ph=dot(p,w.xy)*w.z+uPhases[i];\n' +
    '    y+=sin(ph)*w.w; dx+=cos(ph)*w.w*w.x*w.z; dz+=cos(ph)*w.w*w.y*w.z; }\n' +
    '  vWorld=vec3(p.x,uWaterLevel+y,p.y);\n' +
    '  vNormal=normalize(vec3(-dx,1.0,-dz));\n' +
    '  gl_Position=uViewProj*vec4(vWorld,1.0);\n' +
    '}',
    '#version 300 es\n' +
    'precision highp float;\n' +
    'in vec3 vWorld; in vec3 vNormal;\n' +
    'uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyTop; uniform vec3 uSkyHorizon;\n' +
    'uniform vec3 uCameraPos; uniform vec3 uWaterColor; uniform float uAlpha;\n' +
    'out vec4 outColor;\n' +
    'void main(){\n' +
    '  vec3 n=normalize(vNormal); vec3 V=normalize(uCameraPos-vWorld);\n' +
    '  float fres=pow(1.0-max(dot(n,V),0.0),3.0);\n' +
    '  vec3 refl=mix(uSkyHorizon,uSkyTop,0.55);\n' +
    '  vec3 col=mix(uWaterColor,refl,0.18+fres*0.78);\n' +
    '  vec3 R=reflect(-normalize(uSunDir),n);\n' +
    '  float spec=pow(max(dot(R,V),0.0),180.0);\n' +
    '  col+=uSunColor*spec*1.6;\n' +
    '  float alpha=clamp(uAlpha+fres*0.22,0.38,0.94);\n' +
    '  outColor=vec4(col,alpha);\n' +
    '}'
  );
  var grassProgram = program(
    '#version 300 es\n' +
    'in vec3 aPos; in vec3 aNormal; in vec3 aColor; in float aFlex;\n' +
    'uniform mat4 uViewProj; uniform float uTime; uniform vec3 uSunDir;\n' +
    'out vec3 vNormal; out vec3 vColor; out vec3 vWorld;\n' +
    'void main(){\n' +
    '  vec3 p=aPos; float sway=sin(uTime*1.8+p.x*0.55+p.z*0.44)*0.11*aFlex;\n' +
    '  p.x+=sway; p.z+=sway*0.35; vNormal=aNormal; vColor=aColor; vWorld=p;\n' +
    '  gl_Position=uViewProj*vec4(p,1.0);\n' +
    '}',
    '#version 300 es\n' +
    'precision highp float;\n' +
    'in vec3 vNormal; in vec3 vColor; in vec3 vWorld;\n' +
    'uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uAmbient;\n' +
    'uniform vec3 uFogColor; uniform float uFogDensity; uniform vec3 uCameraPos;\n' +
    'uniform mat4 uLightVP; uniform sampler2D uShadowMap; uniform float uShadowBias;\n' +
    'out vec4 outColor;\n' +
    'void main(){\n' +
    '  vec3 n=normalize(vNormal);\n' +
    '  float ndl=max(dot(n,normalize(uSunDir)),0.0);\n' +
    '  vec4 sc=uLightVP*vec4(vWorld,1.0); sc.xyz/=sc.w; sc.xyz=sc.xyz*0.5+0.5;\n' +
    '  float shadow=1.0;\n' +
    '  if(sc.x>0.0 && sc.x<1.0 && sc.y>0.0 && sc.y<1.0 && sc.z<1.0){\n' +
    '    float d=texture(uShadowMap,sc.xy).r;\n' +
    '    shadow=(d < sc.z-uShadowBias) ? 1.0 : 1.0;\n' +
    '  }\n' +
    '  vec3 lit=vColor*(uAmbient+uSunColor*(0.32+0.75*ndl)*shadow);\n' +
    '  float dist=length(vWorld-uCameraPos);\n' +
    '  float fog=1.0-exp(-pow(dist*uFogDensity,2.0));\n' +
    '  lit=mix(lit,uFogColor,clamp(fog,0.0,0.78));\n' +
    '  lit=lit/(lit+vec3(1.0));\n' +
    '  outColor=vec4(lit,1.0);\n' +
    '}'
  );
  var shadowProgram = program(
    '#version 300 es\n' +
    'in vec2 aPos;\n' +
    'uniform mat4 uViewProj; uniform vec3 uCenter; uniform float uRadius;\n' +
    'out vec2 vLocal;\n' +
    'void main(){ vLocal=aPos; vec2 p=uCenter.xz+aPos*uRadius; gl_Position=uViewProj*vec4(p.x,uCenter.y,p.y,1.0); }',
    '#version 300 es\n' +
    'precision highp float;\n' +
    'in vec2 vLocal;\n' +
    'uniform float uOpacity;\n' +
    'out vec4 outColor;\n' +
    'void main(){ float d=length(vLocal); float a=smoothstep(1.0,0.08,d)*uOpacity; outColor=vec4(0.02,0.03,0.04,a); }'
  );

  var depthProgram = program(
    '#version 300 es\n' +
    'in vec3 aPos; uniform mat4 uLightVP;\n' +
    'void main(){ gl_Position=uLightVP*vec4(aPos,1.0); }',
    '#version 300 es\n' +
    'precision mediump float;\n' +
    'void main(){}'
  );
  var postProgram = program(
    '#version 300 es\n' +
    'in vec2 aPos; out vec2 vUv;\n' +
    'void main(){ vUv=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }',
    '#version 300 es\n' +
    'precision highp float;\n' +
    'in vec2 vUv;\n' +
    'uniform sampler2D uScene; uniform sampler2D uDepth;\n' +
    'uniform mat4 uInvViewProj;\n' +
    'uniform vec3 uCameraPos; uniform vec3 uFogColor; uniform vec3 uSunDir; uniform vec3 uSunColor;\n' +
    'uniform float uTime; uniform float uFogDensity; uniform float uFogHeight; uniform float uFogFalloff;\n' +
    'uniform float uExposure; uniform float uContrast; uniform float uSaturation; uniform float uTemperature;\n' +
    'uniform float uBloom; uniform float uVignette; uniform float uGrain; uniform vec2 uSunScreen; uniform float uNear; uniform float uFar;\n' +
    'out vec4 outColor;\n' +
    'float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }\n' +
    'vec3 worldFromDepth(vec2 uv,float depth){\n' +
    '  vec4 clip=vec4(uv*2.0-1.0,depth*2.0-1.0,1.0);\n' +
    '  vec4 world=uInvViewProj*clip; world/=world.w; return world.xyz;\n' +
    '}\n' +
    'void main(){\n' +
    '  vec3 scene=texture(uScene,vUv).rgb;\n' +
    '  float depth=texture(uDepth,vUv).r;\n' +
    '  if(depth<0.9999){\n' +
    '    vec3 wp=worldFromDepth(vUv,depth);\n' +
    '    vec3 ray=normalize(wp-uCameraPos);\n' +
    '    float len=length(wp-uCameraPos);\n' +
    '    float stepSize=min(len,180.0)/12.0;\n' +
    '    vec3 fogAcc=vec3(0.0); float trans=1.0;\n' +
    '    for(int i=0;i<12;i++){\n' +
    '      vec3 p=uCameraPos+ray*((float(i)+0.5)*stepSize);\n' +
    '      float hf=exp(-max(0.0,p.y-uFogHeight)*uFogFalloff);\n' +
    '      float amt=uFogDensity*hf*stepSize;\n' +
    '      float sd=max(dot(ray,normalize(uSunDir)),0.0);\n' +
    '      vec3 scat=uFogColor+uSunColor*pow(sd,8.0)*0.35;\n' +
    '      fogAcc+=scat*amt*trans; trans*=exp(-amt);\n' +
    '    }\n' +
    '    scene=scene*trans+fogAcc;\n' +
    '  }\n' +
    '  vec3 bloom=vec3(0.0);\n' +
    '  for(int i=0;i<8;i++){\n' +
    '    float a=float(i)*0.785398;\n' +
    '    vec2 o=vec2(cos(a),sin(a))*0.006;\n' +
    '    bloom+=max(texture(uScene,vUv+o).rgb-0.62,0.0);\n' +
    '  }\n' +
    '  scene+=bloom*0.125*uBloom;\n  float sunDist=length((vUv-uSunScreen)*vec2(1.55,1.0));\n  scene+=vec3(1.0,0.70,0.40)*(exp(-sunDist*11.0)*0.26+exp(-sunDist*26.0)*0.9);\n' +
    '  scene*=uExposure;\n' +
    '  scene=(scene*(2.51*scene+0.03))/(scene*(2.43*scene+0.59)+0.14);\n' +
    '  float lum=dot(scene,vec3(0.299,0.587,0.114));\n' +
    '  scene=mix(vec3(lum),scene,uSaturation);\n' +
    '  scene=(scene-0.5)*uContrast+0.5;\n' +
    '  scene.r+=uTemperature*0.08; scene.b-=uTemperature*0.08;\n' +
    '  float d=length(vUv-0.5);\n' +
    '  scene*=1.0-uVignette*smoothstep(0.35,0.78,d);\n' +
    '  scene+=(hash(vUv+uTime)-0.5)*uGrain;\n' +
    '  scene=pow(max(scene,0.0),vec3(1.0/2.2));\n' +
    '  outColor=vec4(scene,1.0);\n' +
    '}'
  );

  var rainProgram = program(
    '#version 300 es\n' +
    'in vec3 aPos; uniform mat4 uViewProj;\n' +
    'void main(){ gl_Position=uViewProj*vec4(aPos,1.0); }',
    '#version 300 es\n' +
    'precision mediump float;\n' +
    'uniform vec3 uColor;\n' +
    'out vec4 outColor;\n' +
    'void main(){ outColor=vec4(uColor,0.55); }'
  );
  var rainVAO = null;
  var rainBuffer = null;
  var rainData = new Float32Array(3000 * 2 * 3);

  var programRef = terrainProgram;
  var SHADOW_SIZE = 2048;
  var shadowFBO = null;
  var shadowTex = null;
  var sceneFBO = null;
  var sceneColorTex = null;
  var sceneDepthTex = null;
  var postQuadVAO = null;
  var lightVP = M4.create();

  function createShadowTarget() {
    shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    shadowFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function createSceneTarget() {
    var w = canvasWorld.width, h = canvasWorld.height;
    sceneColorTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, sceneColorTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    sceneDepthTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, sceneDepthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    sceneFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneColorTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, sceneDepthTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (!postQuadVAO) {
      postQuadVAO = gl.createVertexArray();
      gl.bindVertexArray(postQuadVAO);
      var quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
      var loc = uniformLocation(postProgram, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
    if (!rainVAO) {
      rainVAO = gl.createVertexArray();
      gl.bindVertexArray(rainVAO);
      rainBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, rainBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, rainData, gl.DYNAMIC_DRAW);
      var rainLoc = uniformLocation(rainProgram, 'aPos');
      gl.enableVertexAttribArray(rainLoc);
      gl.vertexAttribPointer(rainLoc, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
  }

  function makeLightVP(light) {
    var dir = light.direction;
    var eye = [charPos[0] + dir[0] * 80, charPos[1] + 20 + dir[1] * 80, charPos[2] + dir[2] * 80];
    var view = M4.lookAt(M4.create(), eye, [charPos[0], charPos[1] + 4, charPos[2]], [0,1,0]);
    var proj = M4.create();
    proj.fill(0);
    var s = 62;
    proj[0] = 1/s; proj[5] = 1/s;
    proj[10] = -2/160; proj[14] = -1; proj[11] = -1; proj[15] = 1;
    M4.mult(lightVP, proj, view);
  }

  function renderShadowMap() {
    if (!shadowFBO) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(depthProgram);
    gl.uniformMatrix4fv(uniformLocation(depthProgram, 'uLightVP'), false, lightVP);
    var depthLoc = uniformLocation(depthProgram, 'aPos');
    var meshes = [terrainMesh].concat(treeGroups.map(function(g){return g.mesh;}), grassGroups.map(function(g){return g.mesh;}));
    for (var i = 0; i < meshes.length; i++) {
      if (!meshes[i]) continue;
      if (!meshes[i].shadowVAO) {
        var sv = gl.createVertexArray();
        gl.bindVertexArray(sv);
        gl.bindBuffer(gl.ARRAY_BUFFER, meshes[i].posBuffer);
        gl.enableVertexAttribArray(depthLoc);
        gl.vertexAttribPointer(depthLoc, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshes[i].ibo);
        gl.bindVertexArray(null);
        meshes[i].shadowVAO = sv;
      }
      gl.bindVertexArray(meshes[i].shadowVAO);
      gl.drawElements(gl.TRIANGLES, meshes[i].count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO);
  }

  function drawPost(now) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasWorld.width, canvasWorld.height);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(postProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneColorTex);
    gl.uniform1i(uniformLocation(postProgram, 'uScene'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sceneDepthTex);
    gl.uniform1i(uniformLocation(postProgram, 'uDepth'), 1);
    var inv = M4.invert(M4.create(), viewProj);
    gl.uniformMatrix4fv(uniformLocation(postProgram, 'uInvViewProj'), false, inv);
    gl.uniform3fv(uniformLocation(postProgram, 'uCameraPos'), new Float32Array(eye));
    var pp = world && world.postProcessing ? world.postProcessing : null;
    var exposure = pp && pp.colorGrading ? pp.colorGrading.exposure : 1.06;
    var contrast = pp && pp.colorGrading ? pp.colorGrading.contrast : 1.04;
    var sat = pp && pp.colorGrading ? pp.colorGrading.saturation : 1.04;
    gl.uniform1f(uniformLocation(postProgram, 'uExposure'), exposure);
    gl.uniform1f(uniformLocation(postProgram, 'uContrast'), contrast);
    gl.uniform1f(uniformLocation(postProgram, 'uSaturation'), sat);
    gl.uniform1f(uniformLocation(postProgram, 'uTemperature'), pp ? pp.colorGrading.temperature * 0.02 : 0);
    gl.uniform1f(uniformLocation(postProgram, 'uBloom'), pp && pp.bloom ? pp.bloom.intensity : 0.35);
    gl.uniform1f(uniformLocation(postProgram, 'uVignette'), pp && pp.vignette ? pp.vignette.intensity : 0.28);
    gl.uniform1f(uniformLocation(postProgram, 'uGrain'), pp && pp.filmGrain ? pp.filmGrain.intensity : 0.035);
    gl.uniform2f(uniformLocation(postProgram, 'uSunScreen'), 0.44, 0.94);
    gl.uniform1f(uniformLocation(postProgram, 'uTime'), now * 0.001);
    gl.uniform1f(uniformLocation(postProgram, 'uNear'), 0.1);
    gl.uniform1f(uniformLocation(postProgram, 'uFar'), 400);
    if (fog) {
      gl.uniform3fv(uniformLocation(postProgram, 'uFogColor'), new Float32Array(fog.fogColor));
      gl.uniform3fv(uniformLocation(postProgram, 'uSunDir'), new Float32Array(fog.sunDirection));
      gl.uniform1f(uniformLocation(postProgram, 'uFogDensity'), fog.fogDensity);
      gl.uniform1f(uniformLocation(postProgram, 'uFogHeight'), fog.fogHeight);
      gl.uniform1f(uniformLocation(postProgram, 'uFogFalloff'), fog.fogHeightFalloff);
    }
    gl.uniform3fv(uniformLocation(postProgram, 'uSunColor'), new Float32Array(sunColor));
    gl.bindVertexArray(postQuadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
  }


  function makeSkySphere() {
    var lat = 18, lon = 36;
    var positions = [], indices = [];
    for (var y = 0; y <= lat; y++) {
      var phi = y / lat * Math.PI;
      for (var x = 0; x <= lon; x++) {
        var theta = x / lon * Math.PI * 2;
        positions.push(
          Math.cos(theta) * Math.sin(phi),
          Math.cos(phi),
          Math.sin(theta) * Math.sin(phi)
        );
      }
    }
    for (var y2 = 0; y2 < lat; y2++) {
      for (var x2 = 0; x2 < lon; x2++) {
        var i = y2 * (lon + 1) + x2;
        indices.push(i, i + lon + 1, i + 1, i + 1, i + lon + 1, i + lon + 2);
      }
    }
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var b = buffer(new Float32Array(positions), gl.ARRAY_BUFFER);
    var loc = attrib(skyProgram, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    var ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao: vao, count: indices.length };
  }

  function makeTerrainMesh(terrain) {
    programRef = terrainProgram;
    return createMesh(terrain.vertices, terrain.normals, terrain.colors, terrain.indices);
  }

  function makeWaterMesh() {
    var seg = 128;
    var positions = [], indices = [];
    for (var z = 0; z <= seg; z++) {
      for (var x = 0; x <= seg; x++) {
        positions.push((x / seg - 0.5) * TERRAIN_SIZE, (z / seg - 0.5) * TERRAIN_SIZE);
      }
    }
    for (var z2 = 0; z2 < seg; z2++) {
      for (var x2 = 0; x2 < seg; x2++) {
        var i = z2 * (seg + 1) + x2;
        indices.push(i, i + seg + 1, i + 1, i + 1, i + seg + 1, i + seg + 2);
      }
    }
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var b = buffer(new Float32Array(positions), gl.ARRAY_BUFFER);
    var loc = attrib(waterProgram, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao: vao, count: indices.length };
  }

  function makeShadowMesh() {
    var seg = 40, positions = [], indices = [];
    positions.push(0, 0);
    for (var i = 0; i < seg; i++) {
      var a = i / seg * Math.PI * 2;
      positions.push(Math.cos(a), Math.sin(a));
    }
    for (var j = 0; j < seg; j++) indices.push(0, 2 + j, 2 + ((j + 1) % seg));
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var b = buffer(new Float32Array(positions), gl.ARRAY_BUFFER);
    var loc = attrib(shadowProgram, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao: vao, count: indices.length };
  }

  