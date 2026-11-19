(function(){
'use strict';


  var math = window.AEVUM.math;
  var M4 = math.M4;
  var renderOnly = window.AEVUM_WORLD_RENDER_ONLY === true;
  var canvasWorld = window.AEVUM_WORLD_CANVAS || document.getElementById('worldCanvas');
  if (!canvasWorld) throw new Error('world canvas is missing');
  var canvasModel = renderOnly ? null : document.getElementById('model');
  var stateEl = document.getElementById('liveState');
  var statEl = document.getElementById('metaStat');
  var systemsEl = document.getElementById('metaSystems');
  var loading = document.getElementById('loading');

  var gl = canvasWorld.getContext('webgl2', {
    alpha: false,
    antialias: true,
    depth: true,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true
  });
  if (!gl) throw new Error('WebGL2 is not available');
  window.addEventListener('error', function (e) {
    var el = stateEl; var ld = loading;
    if (ld) {
      ld.style.display = 'block';
      var line = ld.querySelector('div');
      if (line) line.textContent = 'ERROR / ' + String(e.message || e.error || 'unknown');
    }
    if (el) { el.textContent = 'ERROR ' + e.message; el.style.color = '#ff5a5a'; }
  });
  window.addEventListener('unhandledrejection', function (e) {
    if (!loading) return;
    loading.style.display = 'block';
    var line = loading.querySelector('div');
    if (line) line.textContent = 'REJECTED / ' + String(e.reason && (e.reason.message || e.reason));
  });

  var W = renderOnly ? Math.max(1, canvasWorld.width) : 1600;
  var H = renderOnly ? Math.max(1, canvasWorld.height) : 900;
  var FOV = 56 * Math.PI / 180;
  var TERRAIN_SIZE = 200;
  var WATER_LEVEL = -3.2;
  var params = new URLSearchParams((window.location && window.location.search) || '');
  var WEATHER_MODE = params.get('weather') || (((window.location && window.location.search) || '').indexOf('rain') >= 0 ? 'rain' : 'clear');
  var TIME_OF_DAY = parseFloat(params.get('time'));
  if (!isFinite(TIME_OF_DAY) || TIME_OF_DAY < 0 || TIME_OF_DAY > 1) TIME_OF_DAY = 0.30;
  var SUN_DIR = normalize3([-0.35, 0.44, -0.83]);
  var SPAWN = [0, 0];
  var LAKE = [0, -52];
  var weatherClock = 0;
  var weatherNext = 180 + Math.random() * 120;

  function setReady(text) {
    if (!stateEl) return;
    document.body.classList.add('is-ready');
    stateEl.textContent = text;
    setTimeout(function () { if (loading) loading.style.display = 'none'; }, 500);
  }
  function fail(error) {
    console.error(error);
    if (!stateEl) return;
    stateEl.textContent = 'FAIL';
    if (statEl) statEl.textContent = String(error && error.message || error);
    if (loading) {
      var line = loading.querySelector('div');
      if (line) line.textContent = 'LOAD FAILED / ' + String(error && error.message || error);
      loading.style.opacity = 1;
    }
  }

  function compile(type, source) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) + '\n' + source);
    }
    return sh;
  }
  function program(vsSource, fsSource) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSource));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p));
    }
    return p;
  }
  function uniformLocation(p, name) { return gl.getUniformLocation(p, name); }
  function attrib(p, name) { return gl.getAttribLocation(p, name); }
  function buffer(data, target) {
    var b = gl.createBuffer();
    gl.bindBuffer(target || gl.ARRAY_BUFFER, b);
    gl.bufferData(target || gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }
  function bindAttrib(p, name, b, size, stride, offset) {
    var loc = attrib(p, name);
    if (loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride || 0, offset || 0);
  }

  function createMesh(positions, normals, colors, indices, flex) {
    positions = positions instanceof Float32Array ? positions : new Float32Array(positions);
    normals = normals ? (normals instanceof Float32Array ? normals : new Float32Array(normals)) : null;
    colors = colors ? (colors instanceof Float32Array ? colors : new Float32Array(colors)) : null;
    indices = indices instanceof Uint32Array ? indices : new Uint32Array(indices);
    flex = flex ? (flex instanceof Float32Array ? flex : new Float32Array(flex)) : null;
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var posBuffer = buffer(positions, gl.ARRAY_BUFFER);
    bindAttrib(programRef, 'aPos', posBuffer, 3, 0, 0);
    if (normals) bindAttrib(programRef, 'aNormal', buffer(normals, gl.ARRAY_BUFFER), 3, 0, 0);
    if (colors) bindAttrib(programRef, 'aColor', buffer(colors, gl.ARRAY_BUFFER), 3, 0, 0);
    if (flex) bindAttrib(programRef, 'aFlex', buffer(flex, gl.ARRAY_BUFFER), 1, 0, 0);
    var ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao: vao, count: indices.length, ibo: ibo, posBuffer: posBuffer };
  }

  
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
    'uniform float uCloud; uniform float uStar; uniform float uTime; uniform float uFlash;\n' +
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
    '  sky+=uSunColor*pow(sd,9000.0)*1.15;\n' +
    '  sky+=uSunColor*pow(sd,90.0)*0.11;\n' +
    '  vec2 uv=d.xz/(max(d.y,0.05)+0.22)*0.72;\n' +
    '  float n=fbm(uv*2.4+vec2(uTime*0.006,0.0));\n' +
    '  float cloud=smoothstep(0.54-uCloud*0.12,0.82,n)*smoothstep(0.0,0.22,d.y);\n' +
    '  sky=mix(sky,uCloudColor,cloud*0.30);\n' +
    '  float star=0.0;\n' +
    '  if(uStar>0.01){\n' +
    '    vec2 sp=d.xz*1100.0; vec2 cell=floor(sp); float r=length(fract(sp)-0.5);\n' +
    '    star=step(0.9992,hash(cell))*pow(max(0.0,1.0-r*2.0),12.0)*uStar*smoothstep(0.02,0.24,d.y);\n' +
    '  }\n' +
    '  sky+=vec3(star)*0.85;\n' +
    '  sky+=vec3(0.62,0.70,0.82)*uFlash;\n' +
    '  outColor=vec4(sky,1.0);\n' +
    '}'
  );
  var waterProgram = program(
    '#version 300 es\n' +
    'in vec2 aPos;\n' +
    'uniform mat4 uViewProj; uniform vec4 uWaves[8]; uniform float uPhases[8];\n' +
    'uniform vec4 uGerstner[4]; uniform float uGerstnerSpeed[4]; uniform float uGerstnerTime;\n' +
    'uniform float uWaterLevel;\n' +
    'out vec3 vWorld; out vec3 vNormal; out float vCrest;\n' +
    'void main(){\n' +
    '  vec2 p=aPos; float y=0.0, dx=0.0, dz=0.0;\n' +
    '  for(int i=0;i<8;i++){ vec4 w=uWaves[i]; float ph=dot(p,w.xy)*w.z+uPhases[i];\n' +
    '    y+=sin(ph)*w.w; dx+=cos(ph)*w.w*w.x*w.z; dz+=cos(ph)*w.w*w.y*w.z; }\n' +
    '  for(int g=0;g<4;g++){ vec4 gw=uGerstner[g]; float k=6.28318/max(gw.w,0.001);\n' +
    '    float c=sqrt(9.8/k); vec2 dir=normalize(gw.xy+vec2(0.0001));\n' +
    '    float f=k*(dot(dir,p)-c*uGerstnerTime*uGerstnerSpeed[g]); float a=gw.z/k;\n' +
    '    y+=a*cos(f); dx+=-dir.x*gw.z*sin(f); dz+=-dir.y*gw.z*sin(f); }\n' +
    '  vCrest=y;\n' +
    '  vWorld=vec3(p.x,uWaterLevel+y,p.y);\n' +
    '  vNormal=normalize(vec3(-dx,1.0,-dz));\n' +
    '  gl_Position=uViewProj*vec4(vWorld,1.0);\n' +
    '}',
    '#version 300 es\n' +
    'precision highp float;\n' +
    'in vec3 vWorld; in vec3 vNormal; in float vCrest;\n' +
    'uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyTop; uniform vec3 uSkyHorizon;\n' +
    'uniform vec3 uCameraPos; uniform vec3 uWaterColor; uniform vec3 uDeepColor; uniform vec3 uShallowColor;\n' +
    'uniform float uAlpha; uniform float uFoam; uniform float uCaustic;\n' +
    'float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }\n' +
    'float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);\n' +
    '  float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));\n' +
    '  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }\n' +
    'out vec4 outColor;\n' +
    'void main(){\n' +
    '  vec3 n=normalize(vNormal); vec3 V=normalize(uCameraPos-vWorld);\n' +
    '  float fres=pow(1.0-max(dot(n,V),0.0),3.0);\n' +
    '  vec3 refl=mix(uSkyHorizon,uSkyTop,0.55);\n' +
    '  vec3 body=mix(uShallowColor,uDeepColor,clamp((vCrest+0.22)/0.44,0.0,1.0));\n' +
    '  vec3 col=mix(body,refl,0.18+fres*0.78);\n' +
    '  vec3 R=reflect(-normalize(uSunDir),n);\n' +
    '  float spec=pow(max(dot(R,V),0.0),180.0);\n' +
    '  col+=uSunColor*spec*1.6;\n' +
    '  float foam=smoothstep(0.16,0.30,vCrest)*uFoam;\n' +
    '  foam*=0.55+0.45*noise(vWorld.xz*7.0);\n' +
    '  col=mix(col,vec3(0.86,0.91,0.92),clamp(foam,0.0,0.38));\n' +
    '  float caustic=noise(vWorld.xz*4.0)*noise(vWorld.xz*7.0+1.7);\n' +
    '  col+=vec3(0.90,0.96,0.82)*caustic*uCaustic;\n' +
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
    '    shadow=(d < sc.z-uShadowBias) ? 0.62 : 1.0;\n' +
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
    '  scene+=bloom*0.125*uBloom;\n  float sunDist=length((vUv-uSunScreen)*vec2(1.55,1.0));\n  scene+=vec3(1.0,0.70,0.40)*(exp(-sunDist*180.0)*0.03+exp(-sunDist*420.0)*0.10);\n' +
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

  var objectProgram = program(
    '#version 300 es\n' +
    'in vec3 aPos; in vec3 aNormal; uniform mat4 uViewProj; uniform mat4 uModel;\n' +
    'out vec3 vNormal; out vec3 vWorld;\n' +
    'void main(){ vec4 w=uModel*vec4(aPos,1.0); vWorld=w.xyz; vNormal=normalize(mat3(uModel)*aNormal); gl_Position=uViewProj*w; }',
    '#version 300 es\n' +
    'precision highp float;\n' +
    'in vec3 vNormal; in vec3 vWorld;\n' +
    'uniform vec3 uColor; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uAmbient; uniform float uGlow;\n' +
    'out vec4 outColor;\n' +
    'void main(){ vec3 n=normalize(vNormal); float ndl=max(dot(n,normalize(uSunDir)),0.0);\n' +
    '  vec3 lit=uColor*(uAmbient+uSunColor*(0.25+0.75*ndl))+uColor*uGlow;\n' +
    '  lit=lit/(lit+vec3(1.0)); outColor=vec4(lit,1.0); }'
  );
  var snowProgram = program(
    '#version 300 es\n' +
    'in vec3 aPos; uniform mat4 uViewProj;\n' +
    'void main(){ gl_Position=uViewProj*vec4(aPos,1.0); }',
    '#version 300 es\n' +
    'precision mediump float;\n' +
    'uniform vec3 uColor; out vec4 outColor;\n' +
    'void main(){ outColor=vec4(uColor,0.78); }'
  );
  var fxaaProgram = program(
    '#version 300 es\n' +
    'in vec2 aPos; out vec2 vUv;\n' +
    'void main(){ vUv=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }',
    '#version 300 es\n' +
    'precision highp float;\n' +
    'in vec2 vUv; uniform sampler2D uTex; uniform vec2 uTexel;\n' +
    'out vec4 outColor;\n' +
    'void main(){ vec3 c=texture(uTex,vUv).rgb;\n' +
    '  vec3 n=texture(uTex,vUv+vec2(0.0,-uTexel.y)).rgb;\n' +
    '  vec3 s=texture(uTex,vUv+vec2(0.0,uTexel.y)).rgb;\n' +
    '  vec3 e=texture(uTex,vUv+vec2(uTexel.x,0.0)).rgb;\n' +
    '  vec3 w=texture(uTex,vUv+vec2(-uTexel.x,0.0)).rgb;\n' +
    '  vec3 m=(n+s+e+w)*0.25; vec3 edge=abs(c-m);\n' +
    '  float amount=clamp(max(edge.r,max(edge.g,edge.b))*1.7,0.0,0.30);\n' +
    '  outColor=vec4(mix(c,m,amount),1.0); }'
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
  var snowVAO = null;
  var snowBuffer = null;
  var snowData = new Float32Array(3000 * 2 * 3);

  var programRef = terrainProgram;
  var SHADOW_SIZE = 2048;
  var shadowFBO = null;
  var shadowTex = null;
  var sceneFBO = null;
  var sceneColorTex = null;
  var sceneDepthTex = null;
  var postFBO = null;
  var postColorTex = null;
  var fxaaQuadVAO = null;
  var postNow = 0;
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

    postColorTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, postColorTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    postFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, postFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, postColorTex, 0);
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
      var rainLoc = attrib(rainProgram, 'aPos');
      gl.enableVertexAttribArray(rainLoc);
      gl.vertexAttribPointer(rainLoc, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
    if (!snowVAO) {
      snowVAO = gl.createVertexArray();
      gl.bindVertexArray(snowVAO);
      snowBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, snowBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, snowData, gl.DYNAMIC_DRAW);
      var snowLoc = attrib(snowProgram, 'aPos');
      gl.enableVertexAttribArray(snowLoc);
      gl.vertexAttribPointer(snowLoc, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
    if (!fxaaQuadVAO) {
      fxaaQuadVAO = gl.createVertexArray();
      gl.bindVertexArray(fxaaQuadVAO);
      var fxaaQuad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, fxaaQuad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
      var fxaaLoc = attrib(fxaaProgram, 'aPos');
      gl.enableVertexAttribArray(fxaaLoc);
      gl.vertexAttribPointer(fxaaLoc, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
  }

  function makeLightVP(light) {
    if (!world || !world.shadows || !world.camera) return;
    world.shadows.update(world.camera, light);
    var cascade = world.shadows.getShadowMatrix(2) || world.shadows.getShadowMatrix(1) || world.shadows.getShadowMatrix(0);
    if (cascade) {
      lightVP.set(cascade);
      return;
    }
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
    var depthLoc = attrib(depthProgram, 'aPos');
    var meshes = [terrainMesh];
    for (var tg = 0; tg < treeGroups.length; tg++) meshes.push(treeGroups[tg].mesh);
    for (var gg = 0; gg < grassGroups.length; gg++) meshes.push(grassGroups[gg].mesh);
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

  function sunScreenUV() {
    if (!world || !world.sky) return [2.0, 2.0];
    var sun = normalize3(world.sky.getSunDirection());
    // The sun is a point far along its sky direction, not a screen-space decal.
    var p = [eye[0] + sun[0] * 500, eye[1] + sun[1] * 500, eye[2] + sun[2] * 500];
    var m = viewProj;
    var w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (w <= 0.001 || sun[1] <= 0.02) return [2.0, 2.0];
    var x = (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w;
    var y = (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w;
    return [x * 0.5 + 0.5, y * 0.5 + 0.5];
  }

  function drawPostToTarget(inputTexture, target, now) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target || null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(postProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
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
    var sunScreen = sunScreenUV();
    gl.uniform2f(uniformLocation(postProgram, 'uSunScreen'), sunScreen[0], sunScreen[1]);
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
    return postColorTex;
  }

  function drawFxaa(inputTexture) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(fxaaProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.uniform1i(uniformLocation(fxaaProgram, 'uTex'), 0);
    gl.uniform2f(uniformLocation(fxaaProgram, 'uTexel'), 1.0 / Math.max(1, W), 1.0 / Math.max(1, H));
    gl.bindVertexArray(fxaaQuadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
  }

  function drawPost(now) {
    postNow = now;
    if (world && world.postProcessing && typeof world.postProcessing.render === 'function') {
      world.postProcessing.render(sceneColorTex, null);
      return;
    }
    drawPostToTarget(sceneColorTex, postFBO, now);
    drawFxaa(postColorTex);
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

  
// ---- tree / grass meshes ---------------------------------------------
  function pushCone(out, cx, cy, cz, radius, height, color, segments) {
    var base = out.pos.length / 3;
    for (var i = 0; i < segments; i++) {
      var a0 = i / segments * Math.PI * 2;
      var a1 = (i + 1) / segments * Math.PI * 2;
      var p0 = [cx + Math.cos(a0) * radius, cy, cz + Math.sin(a0) * radius];
      var p1 = [cx + Math.cos(a1) * radius, cy, cz + Math.sin(a1) * radius];
      var tip = [cx, cy + height, cz];
      var n0 = normalize3([Math.cos(a0), 0.45, Math.sin(a0)]);
      var n1 = normalize3([Math.cos(a1), 0.45, Math.sin(a1)]);
      var nTip = [0, 1, 0];
      out.pos.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], tip[0], tip[1], tip[2]);
      out.nor.push(n0[0], n0[1], n0[2], n1[0], n1[1], n1[2], nTip[0], nTip[1], nTip[2]);
      for (var k = 0; k < 3; k++) out.col.push(color[0], color[1], color[2]);
      out.idx.push(base + i * 3, base + i * 3 + 1, base + i * 3 + 2);
    }
  }
  function pushEllipsoid(out, cx, cy, cz, rx, ry, rz, color, segments, rings) {
    var base = out.pos.length / 3;
    for (var y = 0; y <= rings; y++) {
      var phi = y / rings * Math.PI;
      for (var x = 0; x <= segments; x++) {
        var theta = x / segments * Math.PI * 2;
        var px = Math.sin(phi) * Math.cos(theta);
        var py = Math.cos(phi);
        var pz = Math.sin(phi) * Math.sin(theta);
        out.pos.push(cx + px * rx, cy + py * ry, cz + pz * rz);
        var n = normalize3([px / rx, py / ry, pz / rz]);
        out.nor.push(n[0], n[1], n[2]);
        out.col.push(color[0], color[1], color[2]);
      }
    }
    for (var y2 = 0; y2 < rings; y2++) {
      for (var x2 = 0; x2 < segments; x2++) {
        var a = base + y2 * (segments + 1) + x2;
        var b = a + segments + 1;
        out.idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }

  function pushCylinder(out, cx, cy, cz, radius, height, color, segments) {
    var base = out.pos.length / 3;
    for (var i = 0; i < segments; i++) {
      var a0 = i / segments * Math.PI * 2;
      var a1 = (i + 1) / segments * Math.PI * 2;
      var p0 = [cx + Math.cos(a0) * radius, cy, cz + Math.sin(a0) * radius];
      var p1 = [cx + Math.cos(a1) * radius, cy, cz + Math.sin(a1) * radius];
      var p2 = [p1[0], cy + height, p1[2]];
      var p3 = [p0[0], cy + height, p0[2]];
      var n0 = [Math.cos(a0), 0, Math.sin(a0)], n1 = [Math.cos(a1), 0, Math.sin(a1)];
      out.pos.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
      out.nor.push(n0[0], n0[1], n0[2], n1[0], n1[1], n1[2], n1[0], n1[1], n1[2], n0[0], n0[1], n0[2]);
      for (var k = 0; k < 4; k++) out.col.push(color[0], color[1], color[2]);
      out.idx.push(base + i * 4, base + i * 4 + 1, base + i * 4 + 2, base + i * 4, base + i * 4 + 2, base + i * 4 + 3);
    }
  }
  function normalize3(v) {
    var l = Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]) || 1;
    return [v[0]/l, v[1]/l, v[2]/l];
  }
  function makeTreeMesh(trees) {
    var out = { pos: [], nor: [], col: [], idx: [] };
    for (var i = 0; i < trees.length; i++) {
      var t = trees[i];
      var s = t.scale || 1;
      var kind = t.type || 'pine';
      var bark = kind === 'birch' ? [0.46, 0.42, 0.34] : [0.20, 0.15, 0.10];
      var leaf = t.color || [0.18, 0.34, 0.12];
      var crown = [leaf[0] * 0.38, leaf[1] * 0.52, leaf[2] * 0.28];
      var light = [leaf[0] * 0.52, leaf[1] * 0.68, leaf[2] * 0.38];
      if (kind === 'pine') {
        pushCylinder(out, t.x, t.y, t.z, 0.10 * s, 1.55 * s, bark, 6);
        pushCone(out, t.x, t.y + 0.95 * s, t.z, 1.05 * s, 1.65 * s, crown, 9);
        pushCone(out, t.x, t.y + 1.72 * s, t.z, 0.82 * s, 1.45 * s, light, 9);
        pushCone(out, t.x, t.y + 2.42 * s, t.z, 0.55 * s, 1.18 * s, light, 9);
      } else {
        pushCylinder(out, t.x, t.y, t.z, kind === 'birch' ? 0.065 * s : 0.11 * s, 2.05 * s, bark, 6);
        pushEllipsoid(out, t.x, t.y + 1.86 * s, t.z, 0.92 * s, 0.76 * s, 0.88 * s, crown, 8, 5);
        pushEllipsoid(out, t.x - 0.48 * s, t.y + 1.55 * s, t.z + 0.18 * s, 0.58 * s, 0.52 * s, 0.58 * s, light, 7, 4);
        pushEllipsoid(out, t.x + 0.42 * s, t.y + 1.52 * s, t.z - 0.16 * s, 0.54 * s, 0.48 * s, 0.56 * s, crown, 7, 4);
      }
    }
    programRef = terrainProgram;
    return createMesh(new Float32Array(out.pos), new Float32Array(out.nor), new Float32Array(out.col), new Uint32Array(out.idx));
  }
  function makeFlowerMesh(flowers) {
    var out = { pos: [], nor: [], col: [], idx: [] };
    var base = 0;
    for (var i = 0; i < flowers.length; i++) {
      var f = flowers[i];
      var c = i % 5 === 0 ? [0.92, 0.88, 0.70] : (i % 3 === 0 ? [0.82, 0.72, 0.32] : [0.88, 0.82, 0.52]);
      var h = 0.14 + (i % 3) * 0.03, w = 0.045;
      for (var a = 0; a < 3; a++) {
        var ang = a * 1.047;
        var dx = Math.cos(ang) * w, dz = Math.sin(ang) * w;
        out.pos.push(f.x - dx, f.y, f.z - dz, f.x + dx, f.y, f.z + dz, f.x + dx, f.y + h, f.z + dz, f.x - dx, f.y + h, f.z - dz);
        for (var n = 0; n < 4; n++) { out.nor.push(0, 1, 0); out.col.push(c[0], c[1], c[2]); }
        out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        base += 4;
      }
    }
    return out.pos.length ? createMesh(out.pos, out.nor, out.col, out.idx, null) : null;
  }

  function makeGrassMesh(grass) {
    var out = { pos: [], nor: [], col: [], flex: [], idx: [] };
    for (var i = 0; i < grass.length; i++) {
      var g = grass[i];
      var y0 = g.y + 0.01;
      var h = Math.max(0.09, g.height * 0.62);
      var w = Math.max(0.008, g.width * 0.48);
      var c = g.color || [0.18, 0.38, 0.10];
      c = [0.07 + (c[0] - 0.20) * 0.08, 0.17 + (c[1] - 0.45) * 0.10, 0.035 + (c[2] - 0.10) * 0.05];
      for (var q = 0; q < 4; q++) {
        var ang = g.rotation + q * 0.62 + 0.3;
        var ox = Math.cos(g.rotation + q * 1.8) * 0.075;
        var oz = Math.sin(g.rotation + q * 1.8) * 0.075;
        var hq = h * (0.66 + ((q * 17) % 9) * 0.045);
        var dx = Math.cos(ang) * w, dz = Math.sin(ang) * w;
        var base = out.pos.length / 3;
        out.pos.push(g.x - dx + ox, y0, g.z - dz + oz, g.x + dx + ox, y0, g.z + dz + oz, g.x + dx + ox, y0 + hq, g.z + dz + oz, g.x - dx + ox, y0 + hq, g.z - dz + oz);
        out.nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
        out.col.push(c[0]*0.88, c[1]*0.92, c[2]*0.88, c[0]*0.88, c[1]*0.92, c[2]*0.88, c[0]*1.18, c[1]*1.22, c[2]*1.08, c[0]*1.18, c[1]*1.22, c[2]*1.08);
        out.flex.push(0, 0, 1, 1);
        out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    programRef = grassProgram;
    return createMesh(new Float32Array(out.pos), new Float32Array(out.nor), new Float32Array(out.col), new Uint32Array(out.idx), new Float32Array(out.flex));
  }

  function makeBirdMesh() {
    // A distant bird needs a readable silhouette, not four large polygons.
    // Wings sweep back from the shoulders; the tail closes the body.
    var verts = [
      [0, 0.00, -0.56],       // 0 head / front
      [0, 0.05, 0.48],        // 1 tail
      [-0.20, 0.04, -0.06],   // 2 left shoulder
      [-1.16, 0.12, 0.30],    // 3 left wing tip
      [-0.54, 0.06, 0.52],    // 4 left trailing edge
      [0.20, 0.04, -0.06],    // 5 right shoulder
      [1.16, 0.12, 0.30],     // 6 right wing tip
      [0.54, 0.06, 0.52]      // 7 right trailing edge
    ];
    var tris = [
      [0, 2, 3], [0, 3, 4], [0, 4, 1],
      [0, 5, 6], [0, 6, 7], [0, 7, 1]
    ];
    var out = { pos: [], nor: [], col: [], idx: [] };
    var base = 0;
    for (var t = 0; t < tris.length; t++) {
      for (var v = 0; v < 3; v++) {
        var p = verts[tris[t][v]];
        out.pos.push(p[0], p[1], p[2]);
        var n = normalize3([p[0] * 0.12, 1, p[2] * 0.12]);
        out.nor.push(n[0], n[1], n[2]);
        out.col.push(0.12, 0.15, 0.19);
      }
      out.idx.push(base, base + 1, base + 2);
      base += 3;
    }
    programRef = objectProgram;
    return createMesh(new Float32Array(out.pos), new Float32Array(out.nor), new Float32Array(out.col), new Uint32Array(out.idx));
  }

  function makeFireflyMesh() {
    var points = [
      [0, 0.5, 0], [0, -0.5, 0],
      [0.45, 0, 0], [-0.45, 0, 0],
      [0, 0, 0.45], [0, 0, -0.45]
    ];
    var faces = [
      [0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2],
      [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5]
    ];
    var out = { pos: [], nor: [], col: [], idx: [] };
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      out.pos.push(p[0], p[1], p[2]);
      var n = normalize3(p);
      out.nor.push(n[0], n[1], n[2]);
      out.col.push(0.9, 0.85, 0.45);
    }
    for (var f = 0; f < faces.length; f++) {
      out.idx.push(faces[f][0], faces[f][1], faces[f][2]);
    }
    programRef = objectProgram;
    return createMesh(new Float32Array(out.pos), new Float32Array(out.nor), new Float32Array(out.col), new Uint32Array(out.idx));
  }

  
// ---- terrain shaping --------------------------------------------------
  function smoothstep(a, b, x) {
    var t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  function shapeTerrain(t) {
    var seg = t.segments + 1;
    for (var i = 0; i < seg * seg; i++) {
      var x = t.vertices[i * 3];
      var z = t.vertices[i * 3 + 2];
      var h = t.heightMap[i];
      var ds = Math.sqrt((x - SPAWN[0]) * (x - SPAWN[0]) + (z - SPAWN[1]) * (z - SPAWN[1]));
      var spawnBlend = 1 - smoothstep(7.5, 20.0, ds);
      h = h * (1 - spawnBlend) + 0.0 * spawnBlend;
      var dl = Math.sqrt((x - LAKE[0]) * (x - LAKE[0]) + (z - LAKE[1]) * (z - LAKE[1]));
      var lakeBlend = 1 - smoothstep(13.0, 26.0, dl);
      h = h * (1 - lakeBlend) + (-9.5) * lakeBlend;
      var ridge = smoothstep(58.0, 96.0, -z);
      h += ridge * (10.0 + 8.0 * Math.sin(x * 0.12 + 1.2));
      t.heightMap[i] = h;
      t.vertices[i * 3 + 1] = h;
    }
    t._computeNormals();
    for (var j = 0; j < seg * seg; j++) {
      var hh = t.heightMap[j];
      var ny = t.normals[j * 3 + 1];
      var c0 = 0.16, c1 = 0.22, c2 = 0.10;
      if (hh < WATER_LEVEL - 0.5) { c0 = 0.04; c1 = 0.07; c2 = 0.07; }
      else if (hh < WATER_LEVEL + 0.80) { c0 = 0.32; c1 = 0.28; c2 = 0.18; }
      else if (hh < 6.0) { c0 = 0.16; c1 = 0.22; c2 = 0.10; }
      else if (hh < 13.0) { c0 = 0.22; c1 = 0.21; c2 = 0.17; }
      else { c0 = 0.40; c1 = 0.43; c2 = 0.47; }
      if (ny < 0.56) {
        c0 = c0 * 0.68 + 0.20;
        c1 = c1 * 0.68 + 0.19;
        c2 = c2 * 0.68 + 0.17;
      }
      var patch = 0.5 + 0.5 * Math.sin(x * 0.23 + Math.cos(z * 0.17) * 1.8);
      var patch2 = 0.5 + 0.5 * Math.sin(x * 0.07 - z * 0.11);
      if (hh >= WATER_LEVEL + 0.8 && hh < 6.0) {
        c0 = c0 * (0.76 + 0.26 * patch) + 0.035 * patch2;
        c1 = c1 * (0.86 + 0.18 * patch);
        c2 = c2 * (0.74 + 0.14 * patch) + 0.012 * patch2;
      }
      t.colors[j * 3] = c0;
      t.colors[j * 3 + 1] = c1;
      t.colors[j * 3 + 2] = c2;
    }
    t.built = true;
  }

  // Split the terrain into chunks so TerrainSystem's LOD levels can actually
  // be selected per visible region instead of being generated and ignored.
  function makeTerrainChunkMeshes(terrain, chunkCount) {
    var chunks = [];
    var seg = terrain.segments;
    var srcSeg = seg + 1;
    var cellsPerChunk = seg / chunkCount;
    var chunkWorld = TERRAIN_SIZE / chunkCount;
    var lodDefs = terrain.lodLevels && terrain.lodLevels.length
      ? terrain.lodLevels
      : [{ factor: 1 }, { factor: 2 }, { factor: 4 }, { factor: 8 }];

    for (var cz = 0; cz < chunkCount; cz++) {
      for (var cx = 0; cx < chunkCount; cx++) {
        var x0 = cx * cellsPerChunk;
        var z0 = cz * cellsPerChunk;
        var midX = -TERRAIN_SIZE * 0.5 + (x0 + cellsPerChunk * 0.5) / seg * TERRAIN_SIZE;
        var midZ = -TERRAIN_SIZE * 0.5 + (z0 + cellsPerChunk * 0.5) / seg * TERRAIN_SIZE;
        var center = [midX, terrain.getHeight(midX, midZ), midZ];
        var radius = Math.sqrt(2) * chunkWorld * 0.5 + 18;
        var levels = [];

        for (var li = 0; li < lodDefs.length; li++) {
          var step = lodDefs[li].factor || (1 << li);
          var nx = Math.ceil(cellsPerChunk / step);
          var vertCount = (nx + 1) * (nx + 1);
          var positions = new Float32Array(vertCount * 3);
          var normals = new Float32Array(vertCount * 3);
          var colors = new Float32Array(vertCount * 3);
          var indices = new Uint32Array(nx * nx * 6);
          var vi = 0;

          for (var j = 0; j <= nx; j++) {
            var srcZ = z0 + Math.min(j * step, cellsPerChunk);
            for (var i = 0; i <= nx; i++) {
              var srcX = x0 + Math.min(i * step, cellsPerChunk);
              var src = srcZ * srcSeg + srcX;
              positions[vi * 3] = terrain.vertices[src * 3];
              positions[vi * 3 + 1] = terrain.vertices[src * 3 + 1];
              positions[vi * 3 + 2] = terrain.vertices[src * 3 + 2];
              normals[vi * 3] = terrain.normals[src * 3];
              normals[vi * 3 + 1] = terrain.normals[src * 3 + 1];
              normals[vi * 3 + 2] = terrain.normals[src * 3 + 2];
              colors[vi * 3] = terrain.colors[src * 3];
              colors[vi * 3 + 1] = terrain.colors[src * 3 + 1];
              colors[vi * 3 + 2] = terrain.colors[src * 3 + 2];
              vi++;
            }
          }

          var ii = 0;
          for (var z = 0; z < nx; z++) {
            for (var x = 0; x < nx; x++) {
              var a = z * (nx + 1) + x;
              var b = a + nx + 1;
              indices[ii++] = a; indices[ii++] = b; indices[ii++] = a + 1;
              indices[ii++] = a + 1; indices[ii++] = b; indices[ii++] = b + 1;
            }
          }

          programRef = terrainProgram;
          levels.push({
            mesh: createMesh(positions, normals, colors, indices),
            factor: step,
            distance: lodDefs[li].distance || step * 50
          });
        }

        chunks.push({ center: center, radius: radius, levels: levels });
      }
    }
    return chunks;
  }

  
  // ---- runtime -----------------------------------------------------------
  var world = null;
  var fog = null;
  var skyMesh = null;
  var terrainMesh = null;
  var waterMesh = null;
  var treeMesh = null;
  var flowerMesh = null;
  var grassMesh = null;
  var treeGroups = [];
  var grassGroups = [];
  var terrainChunks = [];
  var advancedWater = null;
  var advancedVegetation = null;
  var extShaderCompiler = null;
  var birdMesh = null;
  var fireflyMesh = null;
  var birdObjects = [];
  var fireflyObjects = [];
  var sunColor = [1, 0.95, 0.84];

  function buildVegetationGroups(list, meshFn, radius) {
    var groups = [];
    for (var sx = -1; sx <= 1; sx += 2) {
      for (var sz = -1; sz <= 1; sz += 2) {
        var subset = list.filter(function (p) {
          return (sx < 0 ? p.x < 0 : p.x >= 0) && (sz < 0 ? p.z < 0 : p.z >= 0);
        });
        if (!subset.length) continue;
        groups.push({
          mesh: meshFn(subset),
          center: [sx * 34, charPos[1] + 2, sz * 34],
          radius: radius,
          count: subset.length
        });
      }
    }
    return groups;
  }
  var shadowMesh = null;
  var trees = [];
  var grass = [];
  var modelRenderer = null;
  var vrm = null;
  var player = null;
  var clip = 'run';
  var retarget = null;
  var modelMatrix = M4.create();
  var charPos = [0, 0, 0];
  var charScale = 1;
  var eye = [0, 5, 12];
  var target = [0, 1.5, 0];
  var viewProj = M4.create();
  var cameraPos = eye;
  var last = performance.now();
  var start = last;

  function styleSky() {
    if (!world) return;
    var sun = world.dayNight ? world.dayNight.getSunPosition() : world.sky.getSunDirection();
    var h = Math.max(0, Math.min(1, sun[1] * 1.1));
    var dusk = Math.max(0, 1 - h * 1.7);
    var overcast = world.weather ? Math.min(1, world.weather.getCloudCoverage()) : 0;
    var skyR = 0.10 + 0.22 * h + 0.05 * dusk;
    var skyG = 0.27 + 0.25 * h + 0.02 * dusk;
    var skyB = 0.50 + 0.24 * h;
    var horR = 0.48 + 0.23 * h + 0.22 * dusk;
    var horG = 0.49 + 0.20 * h + 0.08 * dusk;
    var horB = 0.48 + 0.24 * h;
    var oc = overcast * 0.88;
    world.sky.skyColor = [
      skyR * (1 - oc) + 0.38 * oc,
      skyG * (1 - oc) + 0.43 * oc,
      skyB * (1 - oc) + 0.50 * oc
    ];
    world.sky.horizonColor = [
      horR * (1 - oc) + 0.52 * oc,
      horG * (1 - oc) + 0.55 * oc,
      horB * (1 - oc) + 0.58 * oc
    ];
    world.sky.fogColor = [
      (0.54 + 0.16 * h + 0.10 * dusk) * (1 - oc) + 0.48 * oc,
      (0.59 + 0.14 * h + 0.04 * dusk) * (1 - oc) + 0.51 * oc,
      (0.64 + 0.14 * h) * (1 - oc) + 0.55 * oc
    ];
  }

  function sunDirectionFor(time) {
    var angle = time * Math.PI * 2 - Math.PI / 2;
    // Keep the sun in front of the default desktop camera and let its height
    // change across the day. The narrow X arc keeps it inside the wide-but-
    // portrait desktop viewport instead of sliding off the side.
    return normalize3([Math.cos(angle) * 0.22, Math.sin(angle) * 0.55, -1.0]);
  }

  function setupWorldCamera() {    var ground = world ? world.terrain.getHeight(SPAWN[0], SPAWN[1]) : 0;
    charPos = [SPAWN[0], ground, SPAWN[1]];
    eye = [0.75, ground + 2.55, 6.8];
    target = [0, ground + 1.42, 0];
    var view = M4.lookAt(M4.create(), eye, target, [0, 1, 0]);
    var proj = M4.perspective(M4.create(), FOV, W / H, 0.08, 700);
    M4.mult(viewProj, view, proj);
  }

  function updateCamera() {
    if (renderOnly && typeof window.AEVUM_WORLD_CAMERA === 'function') {
      var external = window.AEVUM_WORLD_CAMERA();
      if (external) {
        eye = external.position;
        target = external.target;
        FOV = external.fov;
        W = Math.max(1, external.width || canvasWorld.width || W);
        H = Math.max(1, external.height || canvasWorld.height || H);
      }
    }
    var view = M4.lookAt(M4.create(), eye, target, [0, 1, 0]);
    var proj = M4.perspective(M4.create(), FOV, W / H, 0.08, 700);
    M4.mult(viewProj, view, proj);
    cameraPos = eye;
    if (world && world.camera) {
      world.camera.position = [eye[0], eye[1], eye[2]];
      world.camera.target = [target[0], target[1], target[2]];
      world.camera.fov = FOV * 180 / Math.PI;
      world.camera.aspect = W / H;
      world.camera.update(0);
    }
  }

  function drawSky() {
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(skyProgram);
    var sky = world.sky;
    var sun = sky.getSunDirection();
    var skyTop = sky.getSkyColor();
    var horizon = sky.getHorizonColor();
    var groundColor = sky.groundColor || [0.4, 0.35, 0.3];
    var sunColor = sky.getSunColor();
    var cloud = world.weather ? world.weather.getCloudCoverage() : 0;
    gl.uniformMatrix4fv(uniformLocation(skyProgram, 'uViewProj'), false, viewProj);
    gl.uniform3fv(uniformLocation(skyProgram, 'uCenter'), new Float32Array(cameraPos));
    gl.uniform3fv(uniformLocation(skyProgram, 'uSkyTop'), new Float32Array(skyTop));
    gl.uniform3fv(uniformLocation(skyProgram, 'uSkyHorizon'), new Float32Array(horizon));
    gl.uniform3fv(uniformLocation(skyProgram, 'uGroundColor'), new Float32Array(groundColor));
    gl.uniform3fv(uniformLocation(skyProgram, 'uSunDir'), new Float32Array(normalize3(sun)));
    gl.uniform3fv(uniformLocation(skyProgram, 'uSunColor'), new Float32Array(sunColor));
    gl.uniform3fv(uniformLocation(skyProgram, 'uCloudColor'), new Float32Array([0.88, 0.91, 0.93]));
    gl.uniform1f(uniformLocation(skyProgram, 'uCloud'), cloud);
    var sunNormal = normalize3(sun);
    var starVisibility = Math.max(0, -sunNormal[1] * 7.0);
    starVisibility = Math.min(1, starVisibility);
    gl.uniform1f(uniformLocation(skyProgram, 'uStar'), starVisibility);
    gl.uniform1f(uniformLocation(skyProgram, 'uTime'), world.time || 0);
    gl.uniform1f(uniformLocation(skyProgram, 'uFlash'), world.weather && world.weather.isThundering() ? 0.62 : 0);
    gl.bindVertexArray(skyMesh.vao);
    gl.drawElements(gl.TRIANGLES, skyMesh.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }

  function bindShadow(prog) {
    gl.uniformMatrix4fv(uniformLocation(prog, 'uLightVP'), false, lightVP);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.uniform1i(uniformLocation(prog, 'uShadowMap'), 1);
    gl.uniform1f(uniformLocation(prog, 'uShadowBias'), 0.0022);
  }

  function drawTerrain() {
    gl.useProgram(terrainProgram);
    var light = world.lights.directionalLight;
    var ambient = world.lights.ambientLight;
    gl.uniformMatrix4fv(uniformLocation(terrainProgram, 'uViewProj'), false, viewProj);
    gl.uniform3fv(uniformLocation(terrainProgram, 'uSunDir'), new Float32Array(normalize3(light.direction)));
    gl.uniform3fv(uniformLocation(terrainProgram, 'uSunColor'), new Float32Array([light.color[0] * light.intensity, light.color[1] * light.intensity, light.color[2] * light.intensity]));
    gl.uniform3fv(uniformLocation(terrainProgram, 'uAmbient'), new Float32Array([ambient.color[0] * ambient.intensity, ambient.color[1] * ambient.intensity, ambient.color[2] * ambient.intensity]));
    gl.uniform3fv(uniformLocation(terrainProgram, 'uFogColor'), new Float32Array(world.sky.fogColor));
    gl.uniform1f(uniformLocation(terrainProgram, 'uFogDensity'), 0.0015);
    gl.uniform3fv(uniformLocation(terrainProgram, 'uCameraPos'), new Float32Array(cameraPos));
    bindShadow(terrainProgram);
    if (terrainChunks.length) {
      for (var c = 0; c < terrainChunks.length; c++) {
        var chunk = terrainChunks[c];
        // Draw all 16 chunks. Frustum-culling a chunk by its bounding sphere
        // can drop the near ground plane while the camera orbits, which reads
        // as a black lower half. Sixteen draws are cheap enough to keep.
        var dx = chunk.center[0] - cameraPos[0];
        var dz = chunk.center[2] - cameraPos[2];
        var lod = world.terrain.getLODLevel(Math.sqrt(dx * dx + dz * dz));
        var level = chunk.levels[lod] || chunk.levels[chunk.levels.length - 1];
        gl.bindVertexArray(level.mesh.vao);
        gl.drawElements(gl.TRIANGLES, level.mesh.count, gl.UNSIGNED_INT, 0);
      }
    } else {
      gl.bindVertexArray(terrainMesh.vao);
      gl.drawElements(gl.TRIANGLES, terrainMesh.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  function drawTrees() {
    if (!treeGroups.length) return;
    gl.useProgram(terrainProgram);
    var light = world.lights.directionalLight;
    var ambient = world.lights.ambientLight;
    gl.uniformMatrix4fv(uniformLocation(terrainProgram, 'uViewProj'), false, viewProj);
    gl.uniform3fv(uniformLocation(terrainProgram, 'uSunDir'), new Float32Array(normalize3(light.direction)));
    gl.uniform3fv(uniformLocation(terrainProgram, 'uSunColor'), new Float32Array([light.color[0] * light.intensity, light.color[1] * light.intensity, light.color[2] * light.intensity]));
    gl.uniform3fv(uniformLocation(terrainProgram, 'uAmbient'), new Float32Array([ambient.color[0] * ambient.intensity, ambient.color[1] * ambient.intensity, ambient.color[2] * ambient.intensity]));
    gl.uniform3fv(uniformLocation(terrainProgram, 'uFogColor'), new Float32Array(world.sky.fogColor));
    gl.uniform1f(uniformLocation(terrainProgram, 'uFogDensity'), 0.0015);
    gl.uniform3fv(uniformLocation(terrainProgram, 'uCameraPos'), new Float32Array(cameraPos));
    bindShadow(terrainProgram);
    for (var i = 0; i < treeGroups.length; i++) {
      var g = treeGroups[i];
      if (world.frustumCulling && !world.frustumCulling.isVisible(g.center, g.radius)) continue;
      gl.bindVertexArray(g.mesh.vao);
      gl.drawElements(gl.TRIANGLES, g.mesh.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  function drawGrass(time) {
    if (!grassGroups.length) return;
    gl.useProgram(grassProgram);
    var light = world.lights.directionalLight;
    var ambient = world.lights.ambientLight;
    gl.uniformMatrix4fv(uniformLocation(grassProgram, 'uViewProj'), false, viewProj);
    gl.uniform1f(uniformLocation(grassProgram, 'uTime'), time);
    gl.uniform3fv(uniformLocation(grassProgram, 'uSunDir'), new Float32Array(normalize3(light.direction)));
    gl.uniform3fv(uniformLocation(grassProgram, 'uSunColor'), new Float32Array([light.color[0] * light.intensity, light.color[1] * light.intensity, light.color[2] * light.intensity]));
    gl.uniform3fv(uniformLocation(grassProgram, 'uAmbient'), new Float32Array([ambient.color[0] * ambient.intensity, ambient.color[1] * ambient.intensity, ambient.color[2] * ambient.intensity]));
    gl.uniform3fv(uniformLocation(grassProgram, 'uFogColor'), new Float32Array(world.sky.fogColor));
    gl.uniform1f(uniformLocation(grassProgram, 'uFogDensity'), 0.0015);
    gl.uniform3fv(uniformLocation(grassProgram, 'uCameraPos'), new Float32Array(cameraPos));
    bindShadow(grassProgram);
    for (var i = 0; i < grassGroups.length; i++) {
      var g = grassGroups[i];
      if (world.frustumCulling && !world.frustumCulling.isVisible(g.center, g.radius)) continue;
      gl.bindVertexArray(g.mesh.vao);
      gl.drawElements(gl.TRIANGLES, g.mesh.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  function drawWater() {
    if (!waterMesh) return;
    gl.useProgram(waterProgram);
    var water = world.water;
    var waves = new Float32Array(8 * 4);
    var phases = new Float32Array(8);
    for (var i = 0; i < 8; i++) {
      var w = water.waves[i];
      waves[i * 4] = w.direction[0];
      waves[i * 4 + 1] = w.direction[1];
      waves[i * 4 + 2] = w.frequency;
      waves[i * 4 + 3] = w.amplitude;
      phases[i] = w.phase;
    }
    var sky = world.sky;
    var gerstner = new Float32Array(16);
    var gerstnerSpeed = new Float32Array(4);
    var fallbackWaves = [
      { direction: [1, 0.3], steepness: 0.06, wavelength: 8, speed: 1 },
      { direction: [0.5, 1], steepness: 0.05, wavelength: 5, speed: 1.2 },
      { direction: [-0.7, 0.5], steepness: 0.04, wavelength: 3, speed: 1.5 },
      { direction: [0.3, -0.8], steepness: 0.03, wavelength: 2, speed: 1.8 }
    ];
    var waveSource = advancedWater && advancedWater.waves.length ? advancedWater.waves : fallbackWaves;
    for (var g = 0; g < 4; g++) {
      var gw = waveSource[g] || fallbackWaves[g];
      gerstner[g * 4] = gw.direction[0];
      gerstner[g * 4 + 1] = gw.direction[1];
      gerstner[g * 4 + 2] = gw.steepness;
      gerstner[g * 4 + 3] = gw.wavelength;
      gerstnerSpeed[g] = gw.speed || 1;
    }
    var waterColor = advancedWater ? advancedWater.waterColor : water.waterColor;
    var deepColor = advancedWater ? advancedWater.deepColor : [0.02, 0.05, 0.10];
    var shallowColor = advancedWater ? advancedWater.shallowColor : [0.12, 0.30, 0.36];
    gl.uniformMatrix4fv(uniformLocation(waterProgram, 'uViewProj'), false, viewProj);
    gl.uniform4fv(uniformLocation(waterProgram, 'uWaves[0]'), waves);
    gl.uniform1fv(uniformLocation(waterProgram, 'uPhases[0]'), phases);
    gl.uniform4fv(uniformLocation(waterProgram, 'uGerstner[0]'), gerstner);
    gl.uniform1fv(uniformLocation(waterProgram, 'uGerstnerSpeed[0]'), gerstnerSpeed);
    gl.uniform1f(uniformLocation(waterProgram, 'uGerstnerTime'), advancedWater ? advancedWater.time : world.time);
    gl.uniform1f(uniformLocation(waterProgram, 'uWaterLevel'), water.waterLevel);
    gl.uniform3fv(uniformLocation(waterProgram, 'uSunDir'), new Float32Array(normalize3(world.lights.directionalLight.direction)));
    gl.uniform3fv(uniformLocation(waterProgram, 'uSunColor'), new Float32Array(world.lights.directionalLight.color));
    gl.uniform3fv(uniformLocation(waterProgram, 'uSkyTop'), new Float32Array(sky.getSkyColor()));
    gl.uniform3fv(uniformLocation(waterProgram, 'uSkyHorizon'), new Float32Array(sky.getHorizonColor()));
    gl.uniform3fv(uniformLocation(waterProgram, 'uCameraPos'), new Float32Array(cameraPos));
    gl.uniform3fv(uniformLocation(waterProgram, 'uWaterColor'), new Float32Array(waterColor.slice(0, 3)));
    gl.uniform3fv(uniformLocation(waterProgram, 'uDeepColor'), new Float32Array(deepColor));
    gl.uniform3fv(uniformLocation(waterProgram, 'uShallowColor'), new Float32Array(shallowColor));
    gl.uniform1f(uniformLocation(waterProgram, 'uFoam'), advancedWater ? advancedWater.foamIntensity : 0.5);
    gl.uniform1f(uniformLocation(waterProgram, 'uCaustic'), advancedWater ? advancedWater.causticIntensity : 0.3);
    gl.uniform1f(uniformLocation(waterProgram, 'uAlpha'), advancedWater ? advancedWater.transparency : 0.72);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(waterMesh.vao);
    gl.drawElements(gl.TRIANGLES, waterMesh.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  function drawRain() {
    if (!world.weather || !rainVAO) return;
    var particles = world.weather.getParticles();
    var n = 0;
    for (var i = 0; i < particles.length && n < 3000; i++) {
      var p = particles[i];
      if (p.type !== 'rain' || p.y < -2) continue;
      var base = n * 6;
      rainData[base] = p.x; rainData[base + 1] = p.y; rainData[base + 2] = p.z;
      rainData[base + 3] = p.x + (p.vx || 0) * 0.045;
      rainData[base + 4] = p.y + (p.vy || -24) * 0.065;
      rainData[base + 5] = p.z + (p.vz || 0) * 0.045;
      n += 1;
    }
    if (!n) return;
    gl.bindVertexArray(rainVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, rainBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, rainData.subarray(0, n * 6));
    gl.useProgram(rainProgram);
    gl.uniformMatrix4fv(uniformLocation(rainProgram, 'uViewProj'), false, viewProj);
    gl.uniform3fv(uniformLocation(rainProgram, 'uColor'), new Float32Array([0.72, 0.84, 0.92]));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawArrays(gl.LINES, 0, n * 2);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  function drawSnow() {
    if (!world.weather || !snowVAO) return;
    var particles = world.weather.getParticles();
    var n = 0;
    for (var i = 0; i < particles.length && n < 3000; i++) {
      var p = particles[i];
      if (p.type !== 'snow' || p.y < -2) continue;
      var base = n * 6;
      snowData[base] = p.x; snowData[base + 1] = p.y; snowData[base + 2] = p.z;
      snowData[base + 3] = p.x + 0.035; snowData[base + 4] = p.y - 0.18; snowData[base + 5] = p.z + 0.02;
      n += 1;
    }
    if (!n) return;
    gl.bindVertexArray(snowVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, snowBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, snowData.subarray(0, n * 6));
    gl.useProgram(snowProgram);
    gl.uniformMatrix4fv(uniformLocation(snowProgram, 'uViewProj'), false, viewProj);
    gl.uniform3fv(uniformLocation(snowProgram, 'uColor'), new Float32Array([0.92, 0.96, 1.0]));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.drawArrays(gl.LINES, 0, n * 2);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  function drawObjects() {
    if (!world || !birdMesh) return;
    var visible = world.getVisibleObjects();
    gl.useProgram(objectProgram);
    gl.uniformMatrix4fv(uniformLocation(objectProgram, 'uViewProj'), false, viewProj);
    gl.uniform3fv(uniformLocation(objectProgram, 'uSunDir'), new Float32Array(normalize3(world.lights.directionalLight.direction)));
    gl.uniform3fv(uniformLocation(objectProgram, 'uSunColor'), new Float32Array(world.lights.directionalLight.color));
    gl.uniform3fv(uniformLocation(objectProgram, 'uAmbient'), new Float32Array(world.lights.ambientLight.color));
    for (var i = 0; i < visible.length; i++) {
      var obj = visible[i];
      if (!obj.mesh) continue;
      var s = obj.scale || 1;
      var yaw = obj.yaw || 0;
      var c = Math.cos(yaw) * s, sn = Math.sin(yaw) * s;
      var m = M4.create();
      m[0] = c; m[2] = -sn; m[8] = sn; m[10] = c;
      m[5] = s; m[12] = obj.position[0]; m[13] = obj.position[1]; m[14] = obj.position[2]; m[15] = 1;
      gl.uniformMatrix4fv(uniformLocation(objectProgram, 'uModel'), false, m);
      gl.uniform3fv(uniformLocation(objectProgram, 'uColor'), new Float32Array(obj.color || [0.14, 0.15, 0.18]));
      gl.uniform1f(uniformLocation(objectProgram, 'uGlow'), obj.glow || 0);
      gl.bindVertexArray(obj.mesh.vao);
      gl.drawElements(gl.TRIANGLES, obj.mesh.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  function spawnBirds() {
    if (!birdMesh || !world) return;
    for (var i = 0; i < 9; i++) {
      var baseX = (i - 4) * 14;
      var baseZ = -92 - Math.abs(i - 4) * 6;
      var birdHeight = 23 + (i % 3) * 3;
      var bird = {
        mesh: birdMesh,
        scale: 0.72 + (i % 3) * 0.08,
        color: [0.13, 0.16, 0.20],
        glow: 0,
        angle: i * 0.8,
        phase: i * 1.7,
        baseX: baseX,
        baseZ: baseZ,
        height: birdHeight,
        position: [baseX, birdHeight, baseZ],
        boundingCenter: [baseX, birdHeight, baseZ],
        boundingRadius: 3,
        yaw: 0,
        update: function (dt) {
          this.angle += dt * 0.45;
          this.position[0] = this.baseX + Math.sin(this.angle + this.phase) * 7;
          this.position[2] = this.baseZ + Math.cos(this.angle * 0.8 + this.phase) * 4;
          this.position[1] = this.height + Math.sin(this.angle * 2 + this.phase) * 1.2;
          this.yaw = -0.22 + Math.sin(this.angle * 0.5 + this.phase) * 0.12;
          this.boundingCenter = this.position;
        }
      };
      birdObjects.push(bird);
      world.addObject(bird);
    }
  }

  function syncFireflies() {
    if (!fireflyMesh || !world) return;
    var night = world.dayNight && world.dayNight.isNight;
    if (night && fireflyObjects.length === 0) {
      for (var i = 0; i < 14; i++) {
        var angle = Math.random() * Math.PI * 2;
        var radius = 4 + Math.random() * 18;
        var firefly = {
          mesh: fireflyMesh,
          scale: 0.055 + Math.random() * 0.035,
          color: [1.0, 0.78, 0.28],
          glow: 0.95,
          angle: angle,
          radius: radius,
          height: 0.4 + Math.random() * 2.0,
          position: [Math.cos(angle) * radius, world.terrain.getHeight(Math.cos(angle) * radius, Math.sin(angle) * radius), Math.sin(angle) * radius],
          boundingCenter: [0, 0, 0],
          boundingRadius: 0.4,
          update: function (dt) {
            this.angle += dt * (0.25 + this.scale);
            this.position[0] = Math.cos(this.angle) * this.radius;
            this.position[2] = Math.sin(this.angle) * this.radius;
            this.position[1] = this.height + Math.sin(this.angle * 3.0) * 0.18;
            this.boundingCenter = this.position;
          }
        };
        fireflyObjects.push(firefly);
        world.addObject(firefly);
      }
    } else if (!night && fireflyObjects.length) {
      for (var j = 0; j < fireflyObjects.length; j++) world.removeObject(fireflyObjects[j]);
      fireflyObjects.length = 0;
    }
  }

  function drawContactShadow() {
    if (!shadowMesh) return;
    gl.useProgram(shadowProgram);
    gl.uniformMatrix4fv(uniformLocation(shadowProgram, 'uViewProj'), false, viewProj);
    gl.uniform3fv(uniformLocation(shadowProgram, 'uCenter'), new Float32Array([charPos[0], charPos[1] + 0.025, charPos[2]]));
    gl.uniform1f(uniformLocation(shadowProgram, 'uRadius'), 1.85);
    gl.uniform1f(uniformLocation(shadowProgram, 'uOpacity'), 0.34);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(shadowMesh.vao);
    gl.drawElements(gl.TRIANGLES, shadowMesh.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  function renderWorld(now) {
    updateCamera();
    if (world.frustumCulling) world.frustumCulling.update(viewProj);
    makeLightVP(world.lights.directionalLight);
    renderShadowMap();
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0.02, 0.03, 0.045, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    drawSky();
    drawTerrain();
    drawTrees();
    if (advancedVegetation) {
      advancedVegetation.render(world.camera, world.lights, { trees: false, grass: false });
    }
    drawGrass(now / 1000);
    drawWater();
    drawObjects();
    drawRain();
    drawSnow();
    drawContactShadow();
    drawPost(now);
  }

  async function boot() {
    function bootStage(text) { if (loading) loading.querySelector('div').textContent = text; }
    bootStage('LOADING / WORLD INIT');
    world = new window.World3DEngine.WorldEngine();
    await world.init({
      terrain: {
        width: TERRAIN_SIZE,
        depth: TERRAIN_SIZE,
        segments: 240,
        octaves: 5,
        scale: 0.018,
        amplitude: 26,
        seed: 20261118
      }
    });
    shapeTerrain(world.terrain);
    world.vegetation = new window.World3DEngine.VegetationSystem(world.terrain);
    world.vegetation.generate({ treeCount: 560, grassCount: 24000 });
    trees = world.vegetation.trees.filter(function (t) {
      var ds = Math.sqrt(t.x * t.x + t.z * t.z);
      var dl = Math.sqrt(t.x * t.x + (t.z - LAKE[1]) * (t.z - LAKE[1]));
      return ds > 13 && dl > 24 && t.y > WATER_LEVEL + 0.6;
    });
    grass = world.vegetation.grass.filter(function (g) {
      var ds = Math.sqrt(g.x * g.x + g.z * g.z);
      var dl = Math.sqrt(g.x * g.x + (g.z - LAKE[1]) * (g.z - LAKE[1]));
      return ds > 9 && dl > 20 && g.y > WATER_LEVEL + 0.5;
    });
    [
      [-9.0, -12.0, 1.15, 0.8],
      [9.5, -15.0, 1.30, 1.8],
      [-25.0, -19.0, 1.55, 2.6],
      [24.0, -21.0, 1.35, 3.2]
    ].forEach(function (h) {
      trees.push({
        x: h[0], z: h[1], y: world.terrain.getHeight(h[0], h[1]),
        scale: h[2], rotation: h[3], type: h[3] > 2 ? 'oak' : 'pine',
        color: [0.18 + h[3] * 0.03, 0.36 + h[3] * 0.02, 0.10]
      });
    });
    trees = trees.filter(function (t) { return !(Math.abs(t.x) < 5.0 && t.z < -6 && t.z > -22); });
    for (var ti = 0; ti < 260; ti++) {
      var ta = Math.random() * Math.PI * 2;
      var tr = 42 + Math.random() * 58;
      var tx = Math.cos(ta) * tr;
      var tz = Math.sin(ta) * tr - 18;
      var ty = world.terrain.getHeight(tx, tz);
      if (ty < WATER_LEVEL + 1.2) continue;
      var ts = 0.30 + Math.random() * 0.55;
      trees.push({
        x: tx, z: tz, y: ty, scale: ts,
        rotation: Math.random() * Math.PI * 2,
        type: Math.random() < 0.76 ? 'pine' : 'oak',
        color: [0.16, 0.30 + Math.random() * 0.06, 0.10]
      });
    }
    for (var gi = 0; gi < 15000; gi += 1) {
      var gx = (Math.random() - 0.5) * 64.0;
      var gz = (Math.random() - 0.5) * 64.0;
      if (gx * gx + gz * gz < 2.4 * 2.4) continue;
      if (gx * gx + (gz - LAKE[1]) * (gz - LAKE[1]) < 19 * 19) continue;
      var gy = world.terrain.getHeight(gx, gz);
      if (gy < WATER_LEVEL + 0.4) continue;
      grass.push({
        x: gx, z: gz, y: gy,
        height: 0.16 + Math.random() * 0.24,
        width: 0.025 + Math.random() * 0.02,
        rotation: Math.random() * Math.PI * 2,
        swayOffset: Math.random() * Math.PI * 2,
        color: [0.12 + Math.random() * 0.04, 0.40 + Math.random() * 0.08, 0.07]
      });
    }

    world.water.setWaterLevel(WATER_LEVEL);
    world.water.setWaveHeight(0.16);
    world.weather.setWeather(WEATHER_MODE, false);
    if (WEATHER_MODE !== 'rain' && WEATHER_MODE !== 'storm' && WEATHER_MODE !== 'snow') {
      world.weather.particles.length = 0;
    }
    world.weather.cloudCoverage = (WEATHER_MODE === 'rain' || WEATHER_MODE === 'storm')
      ? 0.62
      : (WEATHER_MODE === 'snow' ? 0.72 : 0.06);
    world.postProcessing.colorGrading.exposure = 1.06;
    world.postProcessing.colorGrading.contrast = 1.12;
    world.postProcessing.colorGrading.saturation = 0.82;
    world.postProcessing.colorGrading.temperature = 0.12;
    world.postProcessing.bloom.intensity = 0.16;
    world.postProcessing.vignette.intensity = 0.24;
    world.postProcessing.filmGrain.intensity = 0.014;
    world.sky.setTime(0.285);
    world.sky.update(0);
    styleSky();
    world.dayNight.time = TIME_OF_DAY;
    world.dayNight.dayLength = 1800;
    world.dayNight.update(0);
    SUN_DIR = sunDirectionFor(world.dayNight.time);
    world.dayNight.sunPosition = SUN_DIR;
    world.sky.sunDirection = SUN_DIR;
    world.lights.setDirectional(SUN_DIR, world.dayNight.getSunColor(), 1.20);
    world.lights.setAmbient(world.dayNight.getAmbientColor(), 0.46);
    sunColor = [1.0, 0.84, 0.63];
    world.shadows.setQuality('medium');
    world.shadows.setShadowDistance(180);
    if (window.World3DExt) {
      fog = new window.World3DExt.VolumetricFog({ getContext: function () { return gl; } }, null);
      fog.setFogColor(0.62, 0.69, 0.76);
      fog.setFogDensity(0.0008);
      fog.setFogHeight(11);
      fog.setFogHeightFalloff(1.1);
      fog.setSunScatterIntensity(0.55);
      fog.setSunDirection(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]);

      extShaderCompiler = {
        compile: function (vs, fs) { return program(vs, fs); },
        use: function (p) { gl.useProgram(p); },
        getAttributeLocation: function (p, name) { return attrib(p, name); },
        setUniformMatrix4fv: function (p, name, value) { gl.uniformMatrix4fv(uniformLocation(p, name), false, value); },
        setUniform1f: function (p, name, value) { gl.uniform1f(uniformLocation(p, name), value); },
        setUniform1i: function (p, name, value) { gl.uniform1i(uniformLocation(p, name), value); },
        setUniform2f: function (p, name, a, b) { gl.uniform2f(uniformLocation(p, name), a, b); },
        setUniform3f: function (p, name, a, b, c) { gl.uniform3f(uniformLocation(p, name), a, b, c); }
      };

      advancedWater = new window.World3DExt.AdvancedWaterSystem(
        { getContext: function () { return gl; } }, extShaderCompiler
      );
      [
        { direction: [1, 0.3], steepness: 0.06, wavelength: 8, speed: 1.0 },
        { direction: [0.5, 1], steepness: 0.05, wavelength: 5, speed: 1.2 },
        { direction: [-0.7, 0.5], steepness: 0.04, wavelength: 3, speed: 1.5 },
        { direction: [0.3, -0.8], steepness: 0.03, wavelength: 2, speed: 1.8 }
      ].forEach(function (w) { advancedWater.addWave(w); });
      advancedWater.setWaterColor(0.045, 0.15, 0.20, 0.72);
      advancedWater.setDeepColor(0.02, 0.05, 0.10);
      advancedWater.setShallowColor(0.12, 0.30, 0.36);
      advancedWater.setWaveHeight(0.16);
      advancedWater.setWaveSpeed(1.0);
      advancedWater.setWaveScale(1.0);
      advancedWater.setTransparency(0.72);
      advancedWater.setReflectivity(0.55);
      advancedWater.setFoamIntensity(0.55);
      advancedWater.setFoamThreshold(0.5);
      advancedWater.setCausticIntensity(0.38);
      advancedWater.setNormalStrength(1.0);
      advancedWater.update(0);
      if (systemsEl) {
        systemsEl.textContent = 'TERRAIN ' + TERRAIN_SIZE + '×' + TERRAIN_SIZE + ' · WATER ' +
          advancedWater.getWaveCount() + ' WAVES · ' + world.weather.getCurrentWeather().toUpperCase();
      }
    }
    setupWorldCamera();

    skyMesh = makeSkySphere();
    terrainMesh = makeTerrainMesh(world.terrain);
    terrainChunks = makeTerrainChunkMeshes(world.terrain, 4);
    waterMesh = makeWaterMesh();
    var nearTrees = trees.filter(function (t) { return Math.sqrt(t.x * t.x + t.z * t.z) < 135; });
    treeGroups = buildVegetationGroups(nearTrees, makeTreeMesh, 58);
    var nearGrass = grass.filter(function (g) { return Math.sqrt(g.x * g.x + g.z * g.z) < 58; });
    grassGroups = buildVegetationGroups(nearGrass, makeGrassMesh, 58);

    if (window.World3DExt && extShaderCompiler) {
      advancedVegetation = new window.World3DExt.VegetationSystem(
        { getContext: function () { return gl; } }, extShaderCompiler
      );
      advancedVegetation.init();
      advancedVegetation.setLodDistance(180);
      advancedVegetation.setWindStrength(0.28);
      advancedVegetation.setWindDirection(1, 0, 0.35);
      // Far trees are drawn by the base tree groups with the terrain shader
      // (fog + shadows). The extension's instanced canopy/grass quads produced
      // bright strips over the ridge, so its render layer stays off in this pass.
      for (var fg = 0; fg < 1600; fg++) {
        var fa = Math.random() * Math.PI * 2;
        var fr = 62 + Math.random() * 34;
        var fx = Math.cos(fa) * fr;
        var fz = Math.sin(fa) * fr - 16;
        var fy = world.terrain.getHeight(fx, fz);
        if (fy > WATER_LEVEL + 0.6) advancedVegetation.addGrass([fx, fy, fz], 0.7 + Math.random() * 0.5);
      }
    }
    var flowerSpots = [];
    for (var fi = 0; fi < 1100; fi++) {
      var fx = (Math.random() * 2 - 1) * 30;
      var fz = (Math.random() * 2 - 1) * 27;
      var fy = world.terrain.getHeight(fx, fz);
      if (fy < WATER_LEVEL + 0.5) continue;
      flowerSpots.push({ x: fx, y: fy + 0.02, z: fz });
    }
    flowerMesh = makeFlowerMesh(flowerSpots);
    birdMesh = makeBirdMesh();
    fireflyMesh = makeFireflyMesh();
    spawnBirds();
    shadowMesh = makeShadowMesh();
    createShadowTarget();
    createSceneTarget();
    world.postProcessing.addPass('world-post', null);
    world.postProcessing.addPass('fxaa', null);
    world.postProcessing.setBackend(function (pp, input) {
      var current = input;
      for (var p = 0; p < pp.passes.length; p++) {
        var pass = pp.passes[p];
        if (!pass.enabled) continue;
        if (pass.name === 'world-post') current = drawPostToTarget(current, postFBO, postNow);
        else if (pass.name === 'fxaa') { drawFxaa(current); return null; }
      }
      return current;
    });

    window.AEVUM_WORLD_CONTROL = {
      setTime: function (value) {
        if (!world || !world.dayNight) return;
        var t = ((Number(value) || 0) % 1 + 1) % 1;
        world.dayNight.setTime(t);
        world.dayNight.update(0);
        world.sky.setTime(t);
        world.sky.update(0);
        SUN_DIR = sunDirectionFor(t);
        world.dayNight.sunPosition = SUN_DIR;
        world.sky.sunDirection = SUN_DIR;
        if (world.dayNight.isNight) {
          world.lights.setDirectional(world.dayNight.getMoonPosition(), [0.55, 0.62, 0.92], 0.16);
          world.lights.setAmbient([0.34, 0.40, 0.62], 0.56);
        } else {
          world.lights.setDirectional(SUN_DIR, world.dayNight.getSunColor(), 1.2);
          world.lights.setAmbient(world.dayNight.getAmbientColor(), 0.46);
        }
        styleSky();
      },
      setWeather: function (name) {
        if (!world || !world.weather) return;
        if (world.weather.weatherTypes.indexOf(name) === -1) return;
        world.weather.setWeather(name, false);
        weatherClock = 0;
        weatherNext = 999999;
      },
      getState: function () {
        return {
          time: world && world.dayNight ? world.dayNight.getTime() : 0,
          weather: world && world.weather ? world.weather.getCurrentWeather() : 'clear'
        };
      }
    };

    if (renderOnly) {
      start = performance.now();
      last = start;
      window.AEVUM_WORLD_RENDERER = {
        heightAt: function (x, z) { return world.terrain.getHeight(x, z); },
        resize: function (w, h) {
          w = Math.max(1, Math.round(w));
          h = Math.max(1, Math.round(h));
          W = w;
          H = h;
          canvasWorld.width = w;
          canvasWorld.height = h;
          if (sceneFBO) {
            gl.deleteFramebuffer(sceneFBO);
            gl.deleteTexture(sceneColorTex);
            gl.deleteTexture(sceneDepthTex);
          }
          if (postFBO) {
            gl.deleteFramebuffer(postFBO);
            gl.deleteTexture(postColorTex);
          }
          createSceneTarget();
        },
        frame: function (now) { frame(now); }
      };
      window.AEVUM_WORLD_READY = true;
      requestAnimationFrame(frame);
      return;
    }

    var modelRenderer = new window.AEVUM.render.VRMRenderer(canvasModel, {
      clearColor: [0, 0, 0, 0],
      lighting: {
        direction: world.lights.directionalLight.direction,
        color: world.lights.directionalLight.color,
        ambient: world.lights.ambientLight.color,
        rim: [0.48, 0.86, 1.0],
        rimStrength: 0.52,
        specular: 0.12
      }
    });

    var vrmRes = await fetch('/engine/assets/models/furina/f%E8%8A%99%E5%AE%81%E5%A8%9C.vrm', { cache: 'no-store' });
    if (!vrmRes.ok) throw new Error('VRM HTTP ' + vrmRes.status);
    bootStage('LOADING / VRM RECEIVED');
    vrm = window.AEVUM.formats.parseVRM(await vrmRes.arrayBuffer());
    await modelRenderer.loadVRM(vrm);
    bootStage('LOADING / VRM READY');

    var actionRes = await fetch('/engine/assets/all_animations.glb', { cache: 'no-store' });    if (!actionRes.ok) throw new Error('GLB HTTP ' + actionRes.status);
    bootStage('LOADING / MOTION RECEIVED');
    var action = window.AEVUM.formats.parseGLB(await actionRes.arrayBuffer());
    player = window.AEVUM.formats.GLTFAnimation.createPlayer(action);
    clip = player.clips.some(function (c) { return c.name === 'run'; }) ? 'run' : 'walk';
    player.setClip(clip).reset().setLoop(true).play();
    player.update(0.08);

    retarget = window.AEVUM.render.AnimationRetarget.retargetPose;

    var bounds = modelRenderer.bounds;
    var modelHeight = bounds.max[1] - bounds.min[1];
    charScale = 2.55 / Math.max(0.001, modelHeight);
    var ground = world.terrain.getHeight(SPAWN[0], SPAWN[1]);
    M4.fromTRS(modelMatrix, [SPAWN[0], ground - bounds.min[1] * charScale, SPAWN[1]], math.Q.fromAxisAngle(math.Q.create(), [0, 1, 0], Math.PI), [charScale, charScale, charScale]);

    statEl.textContent = clip.toUpperCase() + ' / ' + (vrm.humanBones || []).length + ' BONES';
    systemsEl.textContent = 'TERRAIN ' + TERRAIN_SIZE + '×' + TERRAIN_SIZE + ' · TREES ' + trees.length + ' · GRASS ' + grass.length + ' · WATER 8 · ' + world.weather.getCurrentWeather().toUpperCase() + ' · SHADOW ' + world.shadows.shadowMapSize + ' · POST FX';

    start = performance.now();
    last = start;
    var frameCount = 0;
    function frame(now) {
      frameCount += 1;
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (world) {
        world.update(dt);
        if (advancedWater) advancedWater.update(dt);
        syncFireflies();
        if (world.weather.getCurrentWeather() === 'clear') world.weather.particles.length = 0;
        weatherClock += dt;
        if (weatherClock >= weatherNext) {
          weatherClock = 0;
          weatherNext = 180 + Math.random() * 120;
          var roll = Math.random();
          var nextWeather = roll < 0.55 ? 'clear'
            : (roll < 0.74 ? 'cloudy'
              : (roll < 0.87 ? 'rain'
                : (roll < 0.94 ? 'storm' : 'snow')));
          world.weather.setWeather(nextWeather, true);
        }
        world.sky.setTime(world.dayNight.time);
        world.sky.update(0);
        SUN_DIR = sunDirectionFor(world.dayNight.time);
        world.dayNight.sunPosition = SUN_DIR;
        world.sky.sunDirection = SUN_DIR;
        styleSky();
        if (world.dayNight.isNight) {
          world.lights.setDirectional(world.dayNight.getMoonPosition(), [0.55, 0.62, 0.92], 0.16);
          world.lights.setAmbient([0.34, 0.40, 0.62], 0.56);
        } else {
          world.lights.setDirectional(SUN_DIR, world.dayNight.getSunColor(), 1.2);
          world.lights.setAmbient(world.dayNight.getAmbientColor(), 0.46);
        }
        sunColor = world.dayNight.getSunColor();
        if (fog) {
          fog.setSunDirection(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]);
          fog.setFogDensity(0.0008 + world.weather.getFogIntensity() * 0.025 +
            (world.weather.getCurrentWeather() === 'storm' ? 0.012 : 0));
        }
        if (advancedVegetation) {
          advancedVegetation.setWindStrength(0.16 + world.weather.getWindSpeed() * 0.045);
        }
      }
      if (player) player.update(dt);
      if (advancedVegetation) advancedVegetation.update(dt, world.camera);

      var pose = null;
      if (player && vrm && retarget) {
        pose = retarget(vrm, action.json, player.getPose(), {
          neutralStance: false,
          symmetricArms: false,
          footClearance: true,
          runPose: clip === 'run',
          greetPose: false,
          dt: dt
        });
      }

      renderWorld(now);
      if (systemsEl && frameCount % 20 === 0) {
        systemsEl.textContent = 'TERRAIN ' + TERRAIN_SIZE + '×' + TERRAIN_SIZE +
          ' · TREES ' + trees.length + ' · GRASS ' + grass.length +
          ' · WATER 8 · ' + world.weather.getCurrentWeather().toUpperCase() +
          ' · PARTICLES ' + world.weather.getParticles().length +
          ' · CHUNKS ' + terrainChunks.length +
          ' · SHADOW ' + world.shadows.shadowMapSize + ' · POST FX';
      }
      window.AEVUM_WORLD_STATE = {
        weather: world.weather.getCurrentWeather(),
        particles: world.weather.getParticles().length,
        snow: world.weather.getSnowAccumulation(),
        cloud: world.weather.getCloudCoverage(),
        objects: world.objects.length,
        chunks: terrainChunks.length,
        farTrees: advancedVegetation ? advancedVegetation.trees.length : 0
      };
      if (modelRenderer && pose) {
        modelRenderer.render(now / 1000, pose.rotation, { translation: pose.translation }, {
          viewProjection: viewProj,
          modelMatrix: modelMatrix,
          cameraPosition: eye,
          lighting: {
            direction: world.lights.directionalLight.direction,
            color: world.lights.directionalLight.color,
            ambient: world.lights.ambientLight.color,
            rim: [0.48, 0.86, 1.0],
            rimStrength: 0.52,
            specular: 0.12
          }
        });
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    setReady('RUNNING');
  }

  boot().catch(function (error) {
    window.__AEVUM_SHOT_ERROR = String(error && error.stack || error);
    fail(error);
  });
})();
