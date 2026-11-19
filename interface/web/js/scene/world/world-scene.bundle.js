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

  var W = Math.max(1, canvasWorld.clientWidth || canvasWorld.width || 1);
  var H = Math.max(1, canvasWorld.clientHeight || canvasWorld.height || 1);
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
  var orbShaderManager = null;
  var orbShaderSeq = 0;
  var graphicsUsage = window.AEVUM_GRAPHICS_USAGE || (window.AEVUM_GRAPHICS_USAGE = {});
  var graphicsUsageDirty = false;
  function markGraphics(name) {
    graphicsUsage[name] = (graphicsUsage[name] || 0) + 1;
    if (graphicsUsageDirty) return;
    graphicsUsageDirty = true;
    setTimeout(function () {
      graphicsUsageDirty = false;
      if (document.documentElement) {
        document.documentElement.setAttribute('data-graphics-usage', JSON.stringify(graphicsUsage));
      }
    }, 200);
  }
  window.AevumMarkGraphics = markGraphics;

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

  function program(vsSource, fsSource) {
    if (!window.OrbShader || !window.OrbShader.ShaderManager) {
      throw new Error('OrbShader.ShaderManager is required; inline shader compiler is removed');
    }
    if (!orbShaderManager) orbShaderManager = new window.OrbShader.ShaderManager(gl);
    var orbProgram = orbShaderManager.createProgram('world-' + (orbShaderSeq++), vsSource, fsSource);
    if (!orbProgram) throw new Error('OrbShader failed to create program');
    markGraphics('OrbShader');
    return orbProgram;
  }
  function uniformLocation(p, name) { return gl.getUniformLocation(p, name); }
  function attrib(p, name) { return gl.getAttribLocation(p, name); }
  var bufferSeq = 0;
  var meshSeq = 0;
  function buffer(data, target) {
    return managedBuffer('world-buffer-' + (bufferSeq++), data, target);
  }
  var v5BufferManager = null;
  function managedBuffer(name, data, target, usage) {
    if (!window.WebGLCoreV5 || !window.WebGLCoreV5.BufferManager) {
      throw new Error('WebGLCoreV5.BufferManager is required; inline buffer fallback is removed');
    }
    if (!v5BufferManager) v5BufferManager = new window.WebGLCoreV5.BufferManager({ getContext: function () { return gl; } });
    var info = v5BufferManager.create(name, {
      target: target || gl.ARRAY_BUFFER,
      data: data,
      usage: usage || gl.STATIC_DRAW,
      count: 0
    });
    markGraphics('WebGLCoreV5');
    return info.id;
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
    var buffers = [];
    var posBuffer = buffer(positions, gl.ARRAY_BUFFER);
    buffers.push(posBuffer);
    bindAttrib(programRef, 'aPos', posBuffer, 3, 0, 0);
    if (normals) { var normalBuffer = buffer(normals, gl.ARRAY_BUFFER); buffers.push(normalBuffer); bindAttrib(programRef, 'aNormal', normalBuffer, 3, 0, 0); }
    if (colors) { var colorBuffer = buffer(colors, gl.ARRAY_BUFFER); buffers.push(colorBuffer); bindAttrib(programRef, 'aColor', colorBuffer, 3, 0, 0); }
    if (flex) { var flexBuffer = buffer(flex, gl.ARRAY_BUFFER); buffers.push(flexBuffer); bindAttrib(programRef, 'aFlex', flexBuffer, 1, 0, 0); }
    var ibo = managedBuffer('world-mesh-index-' + (meshSeq++), indices, gl.ELEMENT_ARRAY_BUFFER);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bindVertexArray(null);
    return { vao: vao, count: indices.length, ibo: ibo, posBuffer: posBuffer, buffers: buffers };
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
    'uniform mat4 uLightVPs[4]; uniform vec4 uShadowDistances; uniform sampler2D uShadowMap; uniform float uShadowBias;\n' +
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
    '  float viewDist=length(vWorld-uCameraPos);\n' +
    '  float cascade=0.0;\n' +
    '  if(viewDist>uShadowDistances.x) cascade=1.0;\n' +
    '  if(viewDist>uShadowDistances.y) cascade=2.0;\n' +
    '  if(viewDist>uShadowDistances.z) cascade=3.0;\n' +
    '  vec4 sc;\n' +
    '  if(cascade<0.5) sc=uLightVPs[0]*vec4(vWorld,1.0);\n' +
    '  else if(cascade<1.5) sc=uLightVPs[1]*vec4(vWorld,1.0);\n' +
    '  else if(cascade<2.5) sc=uLightVPs[2]*vec4(vWorld,1.0);\n' +
    '  else sc=uLightVPs[3]*vec4(vWorld,1.0);\n' +
    '  sc.xyz/=sc.w; vec2 suv=sc.xy*0.5+0.5;\n' +
    '  float shadow=1.0;\n' +
    '  if(suv.x>0.001 && suv.x<0.999 && suv.y>0.001 && suv.y<0.999 && sc.z<1.0){\n' +
    '    vec2 off=vec2((cascade>0.5 && cascade<1.5) || cascade>2.5 ? 0.5 : 0.0,\n' +
    '                  cascade>1.5 ? 0.5 : 0.0);\n' +
    '    vec2 atlas=off+suv*0.5;\n' +
    '    float d=texture(uShadowMap,atlas).r;\n' +
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
    'layout(std140) uniform GrassWind { vec4 uWindOffsets[64]; };\n' +
    'uniform mat4 uViewProj; uniform float uTime; uniform vec3 uSunDir;\n' +
    'out vec3 vNormal; out vec3 vColor; out vec3 vWorld;\n' +
    'void main(){\n' +
    '  int wi=int(mod(float(int(floor(aPos.x*0.55))+int(floor(aPos.z*0.44))),64.0));\n' +
    '  vec4 wind=uWindOffsets[wi]; float sway=(wind.x+wind.z)*aFlex;\n' +
    '  vec3 p=aPos; p.x+=sway; p.z+=wind.z*aFlex*0.35; vNormal=aNormal; vColor=aColor; vWorld=p;\n' +
    '  gl_Position=uViewProj*vec4(p,1.0);\n' +
    '}',
    '#version 300 es\n' +
    'precision highp float;\n' +
    'in vec3 vNormal; in vec3 vColor; in vec3 vWorld;\n' +
    'uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uAmbient;\n' +
    'uniform vec3 uFogColor; uniform float uFogDensity; uniform vec3 uCameraPos;\n' +
    'uniform mat4 uLightVPs[4]; uniform vec4 uShadowDistances; uniform sampler2D uShadowMap; uniform float uShadowBias;\n' +
    'out vec4 outColor;\n' +
    'void main(){\n' +
    '  vec3 n=normalize(vNormal);\n' +
    '  float ndl=max(dot(n,normalize(uSunDir)),0.0);\n' +
    '  float viewDist=length(vWorld-uCameraPos);\n' +
    '  float cascade=0.0;\n' +
    '  if(viewDist>uShadowDistances.x) cascade=1.0;\n' +
    '  if(viewDist>uShadowDistances.y) cascade=2.0;\n' +
    '  if(viewDist>uShadowDistances.z) cascade=3.0;\n' +
    '  vec4 sc;\n' +
    '  if(cascade<0.5) sc=uLightVPs[0]*vec4(vWorld,1.0);\n' +
    '  else if(cascade<1.5) sc=uLightVPs[1]*vec4(vWorld,1.0);\n' +
    '  else if(cascade<2.5) sc=uLightVPs[2]*vec4(vWorld,1.0);\n' +
    '  else sc=uLightVPs[3]*vec4(vWorld,1.0);\n' +
    '  sc.xyz/=sc.w; vec2 suv=sc.xy*0.5+0.5;\n' +
    '  float shadow=1.0;\n' +
    '  if(suv.x>0.001 && suv.x<0.999 && suv.y>0.001 && suv.y<0.999 && sc.z<1.0){\n' +
    '    vec2 off=vec2((cascade>0.5 && cascade<1.5) || cascade>2.5 ? 0.5 : 0.0,\n' +
    '                  cascade>1.5 ? 0.5 : 0.0);\n' +
    '    vec2 atlas=off+suv*0.5;\n' +
    '    float d=texture(uShadowMap,atlas).r;\n' +
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
    'uniform vec2 uTexel;\n' +
    'uniform float uSsao; uniform float uSsaoRadius; uniform float uSsaoBias; uniform float uSsaoIntensity; uniform float uSsaoRange; uniform float uSsaoSamples;\n' +
    'uniform float uDof; uniform float uDofFocus; uniform float uDofRange; uniform float uDofAmount;\n' +
    'out vec4 outColor;\n' +
    'float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }\n' +
    'vec3 worldFromDepth(vec2 uv,float depth){\n' +
    '  vec4 clip=vec4(uv*2.0-1.0,depth*2.0-1.0,1.0);\n' +
    '  vec4 world=uInvViewProj*clip; world/=world.w; return world.xyz;\n' +
    '}\n' +
    'float linearDepth(float d){ float ndc=d*2.0-1.0; return (2.0*uNear*uFar)/(uFar+uNear-ndc*(uFar-uNear)); }\n' +
    'vec3 sampleScene(vec2 uv){ return texture(uScene,clamp(uv,vec2(0.001),vec2(0.999))).rgb; }\n' +
    'void main(){\n' +
    '  vec3 scene=texture(uScene,vUv).rgb;\n' +
    '  float depth=texture(uDepth,vUv).r;\n' +
    '  // SSAO: depth-only contact darkening, no extra G-buffer required.\n' +
    '  float ao=1.0;\n' +
    '  if(uSsao>0.001 && depth<0.9999){\n' +
    '    float center=linearDepth(depth); float occ=0.0;\n' +
    '    for(int i=0;i<12;i++){\n' +
    '      if(float(i)>=uSsaoSamples) break;\n' +
    '      float a=float(i)*2.399963+hash(vUv)*6.283185;\n' +
    '      float r=sqrt((float(i)+1.0)/12.0)*uSsaoRadius*0.012;\n' +
    '      float sd=texture(uDepth,vUv+vec2(cos(a),sin(a))*r).r;\n' +
    '      if(sd<0.9999){\n' +
    '        float sl=linearDepth(sd); float diff=center-sl;\n' +
    '        if(diff>uSsaoBias && diff<uSsaoRange) occ+=1.0-diff/uSsaoRange;\n' +
    '      }\n' +
    '    }\n' +
    '    ao=clamp(1.0-uSsaoIntensity*(occ/12.0),0.45,1.0);\n' +
    '    scene*=mix(1.0,ao,uSsao);\n' +
    '  }\n' +
    '  // Depth of field: far field softens around the chosen focus distance.\n' +
    '  if(uDof>0.001 && depth<0.9999){\n' +
    '    float center=linearDepth(depth);\n' +
    '    float nearCoc=smoothstep(uDofFocus-uDofRange,uDofFocus+uDofRange,center);\n' +
    '    float farCut=1.0-smoothstep(uDofFocus+uDofRange,uDofFocus+uDofRange*2.0,center);\n' +
    '    float coc=nearCoc*farCut;\n' +
    '    if(coc>0.01){\n' +
    '      vec3 blurred=vec3(0.0);\n' +
    '      for(int i=0;i<8;i++){\n' +
    '        float a=float(i)*0.785398;\n' +
    '        float r2=(1.0+float(i%2))*uDofAmount;\n' +
    '        blurred+=sampleScene(vUv+vec2(cos(a),sin(a))*uTexel*r2);\n' +
    '      }\n' +
    '      blurred/=8.0; scene=mix(scene,blurred,coc*uDof);\n' +
    '    }\n' +
    '  }\n' +
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
    'in vec2 vUv; uniform sampler2D uTex; uniform vec2 uTexel; uniform float uChroma;\n' +
    'out vec4 outColor;\n' +
    'void main(){ vec3 c=texture(uTex,vUv).rgb;\n' +
    '  vec3 n=texture(uTex,vUv+vec2(0.0,-uTexel.y)).rgb;\n' +
    '  vec3 s=texture(uTex,vUv+vec2(0.0,uTexel.y)).rgb;\n' +
    '  vec3 e=texture(uTex,vUv+vec2(uTexel.x,0.0)).rgb;\n' +
    '  vec3 w=texture(uTex,vUv+vec2(-uTexel.x,0.0)).rgb;\n' +
    '  vec3 m=(n+s+e+w)*0.25; vec3 edge=abs(c-m);\n' +
    '  float amount=clamp(max(edge.r,max(edge.g,edge.b))*1.7,0.0,0.30);\n' +
    '  vec3 finalColor=mix(c,m,amount);\n' +
    '  if(uChroma>0.00001){\n' +
    '    float edge=smoothstep(0.55,0.95,length(vUv-0.5));\n' +
    '    vec2 ca=(vUv-0.5)*uChroma*8.0*edge;\n' +
    '    finalColor.r=texture(uTex,clamp(vUv+ca,vec2(0.001),vec2(0.999))).r;\n' +
    '    finalColor.b=texture(uTex,clamp(vUv-ca,vec2(0.001),vec2(0.999))).b;\n' +
    '  }\n' +
    '  outColor=vec4(finalColor,1.0); }'
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
  var SHADOW_TILES = 2;
  var SHADOW_TILE_SIZE = SHADOW_SIZE / SHADOW_TILES;
  var shadowFBO = null;
  var shadowTex = null;
  var sceneFBO = null;
  var sceneColorTex = null;
  var sceneDepthTex = null;
  var postFBO = null;
  var postColorTex = null;
  var postRenderTarget = null;
  var v5FramebufferManager = null;
  var v5TextureManager = null;
  var v2GeometryProcessor = null;
  var v5FxaaPipeline = null;
  var fxaaQuadVAO = null;
  var postNow = 0;
  var postQuadVAO = null;
  var lightVP = M4.create();
  var lightVPs = [M4.create(), M4.create(), M4.create(), M4.create()];
  var shadowVPData = new Float32Array(16 * 4);

  function createShadowTarget() {
    if (!window.WebGLCoreV5 || !window.WebGLCoreV5.TextureManager || !window.WebGLCoreV5.FramebufferManager) {
      throw new Error('WebGLCoreV5 TextureManager/FramebufferManager is required; inline shadow target is removed');
    }
    if (!v5TextureManager) v5TextureManager = new window.WebGLCoreV5.TextureManager({ getContext: function () { return gl; } });
    if (!v5FramebufferManager) v5FramebufferManager = new window.WebGLCoreV5.FramebufferManager({ getContext: function () { return gl; } });
    var shadowTextureInfo = v5TextureManager.create('world-shadow-depth', {
      width: SHADOW_SIZE,
      height: SHADOW_SIZE,
      internalFormat: gl.DEPTH_COMPONENT24,
      format: gl.DEPTH_COMPONENT,
      type: gl.UNSIGNED_INT,
      minFilter: gl.NEAREST,
      magFilter: gl.NEAREST,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
      generateMipmaps: false
    });
    shadowTex = shadowTextureInfo.id;
    var shadowFramebufferInfo = v5FramebufferManager.create('world-shadow', { width: SHADOW_SIZE, height: SHADOW_SIZE });
    v5FramebufferManager.attach(shadowFramebufferInfo, {
      attachmentPoint: gl.DEPTH_ATTACHMENT,
      texture: shadowTex,
      textureTarget: gl.TEXTURE_2D
    });
    gl.drawBuffers([gl.NONE]);
    shadowFBO = shadowFramebufferInfo.id;
    v5FramebufferManager.unbind();
    markGraphics('WebGLCoreV5');
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
    if (!window.WebGLCoreV5 || !window.WebGLCoreV5.FramebufferManager) {
      throw new Error('WebGLCoreV5.FramebufferManager is required; inline scene FBO is removed');
    }
    if (!v5FramebufferManager) v5FramebufferManager = new window.WebGLCoreV5.FramebufferManager({ getContext: function () { return gl; } });
    var sceneFramebufferInfo = v5FramebufferManager.create('world-scene', { width: w, height: h });
    v5FramebufferManager.attach(sceneFramebufferInfo, {
      attachmentPoint: gl.COLOR_ATTACHMENT0,
      texture: sceneColorTex,
      textureTarget: gl.TEXTURE_2D
    });
    v5FramebufferManager.attach(sceneFramebufferInfo, {
      attachmentPoint: gl.DEPTH_ATTACHMENT,
      texture: sceneDepthTex,
      textureTarget: gl.TEXTURE_2D
    });
    sceneFBO = sceneFramebufferInfo.id;
    v5FramebufferManager.unbind();
    markGraphics('WebGLCoreV5');

    if (!window.OrbPost || !window.OrbPost.RenderTarget) {
      throw new Error('OrbPost.RenderTarget is required; inline post FBO fallback is removed');
    }
    postRenderTarget = new window.OrbPost.RenderTarget(gl, w, h, { depthBuffer: false });
    postFBO = postRenderTarget.framebuffer;
    postColorTex = postRenderTarget.texture;
    markGraphics('OrbPost');

    if (!postQuadVAO) {
      postQuadVAO = gl.createVertexArray();
      gl.bindVertexArray(postQuadVAO);
      var quad = managedBuffer('world-post-quad', new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.ARRAY_BUFFER);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      var loc = uniformLocation(postProgram, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
    if (!rainVAO) {
      rainVAO = gl.createVertexArray();
      gl.bindVertexArray(rainVAO);
      rainBuffer = managedBuffer('world-rain-buffer', rainData, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, rainBuffer);
      var rainLoc = attrib(rainProgram, 'aPos');
      gl.enableVertexAttribArray(rainLoc);
      gl.vertexAttribPointer(rainLoc, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
    if (!snowVAO) {
      snowVAO = gl.createVertexArray();
      gl.bindVertexArray(snowVAO);
      snowBuffer = managedBuffer('world-snow-buffer', snowData, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, snowBuffer);
      var snowLoc = attrib(snowProgram, 'aPos');
      gl.enableVertexAttribArray(snowLoc);
      gl.vertexAttribPointer(snowLoc, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
    if (!fxaaQuadVAO) {
      fxaaQuadVAO = gl.createVertexArray();
      gl.bindVertexArray(fxaaQuadVAO);
      var fxaaQuad = managedBuffer('world-fxaa-quad', new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.ARRAY_BUFFER);
      gl.bindBuffer(gl.ARRAY_BUFFER, fxaaQuad);
      var fxaaLoc = attrib(fxaaProgram, 'aPos');
      gl.enableVertexAttribArray(fxaaLoc);
      gl.vertexAttribPointer(fxaaLoc, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
  }

  function makeLightVP(light) {
    if (!world || !world.shadows || !world.camera) return;
    world.shadows.update(world.camera, light);
    var cascades = world.shadows.cascades || 4;
    for (var c = 0; c < 4; c++) {
      var source = world.shadows.getShadowMatrix(Math.min(c, cascades - 1));
      if (source) {
        lightVPs[c].set(source);
      } else {
        var dir = light.direction;
        var eye = [charPos[0] + dir[0] * 80, charPos[1] + 20 + dir[1] * 80, charPos[2] + dir[2] * 80];
        var view = M4.lookAt(M4.create(), eye, [charPos[0], charPos[1] + 4, charPos[2]], [0,1,0]);
        var proj = M4.create();
        proj.fill(0);
        var s = 42 + c * 28;
        proj[0] = 1/s; proj[5] = 1/s;
        proj[10] = -2/160; proj[14] = -1; proj[11] = -1; proj[15] = 1;
        M4.mult(lightVPs[c], proj, view);
      }
      shadowVPData.set(lightVPs[c], c * 16);
    }
    lightVP.set(lightVPs[0]);
  }

  function renderShadowMap() {
    if (!shadowFBO) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(depthProgram);
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
    }
    for (var c = 0; c < 4; c++) {
      var col = c % SHADOW_TILES;
      var row = Math.floor(c / SHADOW_TILES);
      gl.viewport(col * SHADOW_TILE_SIZE, row * SHADOW_TILE_SIZE, SHADOW_TILE_SIZE, SHADOW_TILE_SIZE);
      gl.uniformMatrix4fv(uniformLocation(depthProgram, 'uLightVP'), false, lightVPs[c]);
      for (var mi = 0; mi < meshes.length; mi++) {
        if (!meshes[mi]) continue;
        gl.bindVertexArray(meshes[mi].shadowVAO);
        gl.drawElements(gl.TRIANGLES, meshes[mi].count, gl.UNSIGNED_INT, 0);
      }
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
    gl.uniform2f(uniformLocation(postProgram, 'uTexel'), 1.0 / Math.max(1, W), 1.0 / Math.max(1, H));
    var ssao = pp && pp.ssao ? pp.ssao : null;
    var dof = pp && pp.dof ? pp.dof : null;
    gl.uniform1f(uniformLocation(postProgram, 'uSsao'), ssao && ssao.enabled !== false ? 1 : 0);
    gl.uniform1f(uniformLocation(postProgram, 'uSsaoRadius'), ssao ? ssao.radius : 0.28);
    gl.uniform1f(uniformLocation(postProgram, 'uSsaoBias'), ssao ? ssao.bias : 0.08);
    gl.uniform1f(uniformLocation(postProgram, 'uSsaoIntensity'), ssao ? ssao.intensity : 0.55);
    gl.uniform1f(uniformLocation(postProgram, 'uSsaoRange'), ssao && ssao.range ? ssao.range : 6);
    gl.uniform1f(uniformLocation(postProgram, 'uSsaoSamples'), ssao ? ssao.samples : 10);
    gl.uniform1f(uniformLocation(postProgram, 'uDof'), dof && dof.enabled !== false ? (dof.strength || 1) : 0);
    gl.uniform1f(uniformLocation(postProgram, 'uDofFocus'), dof ? dof.focusDistance : 16);
    gl.uniform1f(uniformLocation(postProgram, 'uDofRange'), dof ? dof.focusRange : 14);
    gl.uniform1f(uniformLocation(postProgram, 'uDofAmount'), dof ? dof.blurAmount : 5);
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
    var chromatic = world && world.postProcessing ? world.postProcessing.chromaticAberration : null;
    if (!window.WebGLCoreV5 || !window.WebGLCoreV5.RenderPipeline) {
      throw new Error('WebGLCoreV5.RenderPipeline is required; inline FXAA fallback is removed');
    }
    if (!v5FxaaPipeline) {
      v5FxaaPipeline = new window.WebGLCoreV5.RenderPipeline({ getContext: function () { return gl; } });
      v5FxaaPipeline.addPass('fxaa', {
        program: fxaaProgram,
        framebuffer: null,
        viewport: [0, 0, W, H],
        clearMask: 0,
        depthTest: false,
        depthWrite: false,
        cullFace: false,
        blend: false,
        textures: [],
        uniforms: {}
      });
    }
    var fxaaPass = v5FxaaPipeline.getPass('fxaa');
    fxaaPass.viewport = [0, 0, W, H];
    fxaaPass.textures = [inputTexture];
    fxaaPass.uniforms.uTexel = [1.0 / Math.max(1, W), 1.0 / Math.max(1, H)];
    fxaaPass.uniforms.uChroma = chromatic && chromatic.enabled ? chromatic.amount : 0;
    v5FxaaPipeline.beginPass('fxaa');
    markGraphics('WebGLCoreV5');
    gl.bindVertexArray(fxaaQuadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    if (v5FxaaPipeline) v5FxaaPipeline.endPass();
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
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
    if (!window.WebGLCore || !window.WebGLCore.GeometryGenerator) {
      throw new Error('WebGLCore.GeometryGenerator is required; inline sky sphere generation is removed');
    }
    var sphere = window.WebGLCore.GeometryGenerator.createSphere(1, 36, 18);
    if (!sphere || !sphere.vertices || !sphere.indices) throw new Error('GeometryGenerator failed to create sky sphere');
    var positions = sphere.vertices;
    var indices = sphere.indices;
    markGraphics('gl-extensions');
    if (!window.WebGLCoreV2 || !window.WebGLCoreV2.GeometryProcessor) {
      throw new Error('WebGLCoreV2.GeometryProcessor is required; inline sky geometry fallback is removed');
    }
    if (!v2GeometryProcessor) v2GeometryProcessor = new window.WebGLCoreV2.GeometryProcessor();
    var skyGeometry = v2GeometryProcessor.createGeometry('world-sky-sphere', { vertices: positions, indices: indices });
    if (!skyGeometry) throw new Error('WebGLCoreV2 failed to create sky geometry');
    positions = skyGeometry.vertices;
    indices = skyGeometry.indices;
    markGraphics('WebGLCoreV2');
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var b = managedBuffer('world-sky-position', new Float32Array(positions), gl.ARRAY_BUFFER);
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    var loc = attrib(skyProgram, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    var ibo = managedBuffer('world-sky-index', new Uint32Array(indices), gl.ELEMENT_ARRAY_BUFFER);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
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
    var ibo = managedBuffer('world-water-index', new Uint32Array(indices), gl.ELEMENT_ARRAY_BUFFER);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
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
    var ibo = managedBuffer('world-shadow-index', new Uint32Array(indices), gl.ELEMENT_ARRAY_BUFFER);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bindVertexArray(null);
    return { vao: vao, count: indices.length };
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

  // ---- streaming terrain ------------------------------------------------
  // The original terrain remains the height/vegetation source near spawn.
  // Outside its bounds the same deterministic noise is extended and blended
  // into a visible ring of streamed chunks.
  var STREAM_CHUNK_SIZE = 64;
  var STREAM_CHUNK_SEGMENTS = 20;
  var STREAM_RADIUS = 4;
  var STREAM_GRASS_PER_CHUNK = 0;
  var streamChunks = new Map();
  var streamNoise = null;
  var detailGrassMesh = null;
  var detailGrassKey = '';

  function streamProceduralHeight(x, z) {
    if (!streamNoise) {
      streamNoise = new window.World3DEngine.TerrainSystem(1, 1, 1);
      streamNoise.noiseOctaves = 5;
      streamNoise.noiseScale = 0.018;
      streamNoise.noiseAmplitude = 26;
      streamNoise.seed = 20261118;
    }
    return streamNoise._fractalNoise(x * 0.018, z * 0.018) * 26;
  }

  function streamHeightAt(terrain, x, z) {
    var edge = TERRAIN_SIZE * 0.5;
    var ax = Math.abs(x);
    var az = Math.abs(z);
    if (ax <= edge && az <= edge) return terrain.getHeight(x, z);
    var insideX = Math.max(-edge, Math.min(edge, x));
    var insideZ = Math.max(-edge, Math.min(edge, z));
    var edgeHeight = terrain.getHeight(insideX, insideZ);
    var outside = Math.max(ax, az) - edge;
    var blend = smoothstep(0, 120, outside);
    return edgeHeight * (1 - blend) + streamProceduralHeight(x, z) * blend;
  }

  function streamHash(cx, cz, seed) {
    var h = (cx * 374761393 + cz * 668265263 + seed * 1442695041) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967295;
  }

  function makeStreamChunkVegetation(terrain, cx, cz, centerX, centerZ) {
    var trees = [];
    var grass = [];
    var treeMesh = null;
    var grassMesh = null;
    if (Math.sqrt(centerX * centerX + centerZ * centerZ) > 105) {
      for (var ti = 0; ti < 20; ti++) {
        var tx = cx * STREAM_CHUNK_SIZE + 5 + streamHash(cx, cz, ti * 3 + 1) * (STREAM_CHUNK_SIZE - 10);
        var tz = cz * STREAM_CHUNK_SIZE + 5 + streamHash(cx, cz, ti * 3 + 2) * (STREAM_CHUNK_SIZE - 10);
        var ty = streamHeightAt(terrain, tx, tz);
        if (ty < WATER_LEVEL + 0.7) continue;
        trees.push({
          x: tx, y: ty, z: tz,
          scale: 0.8 + streamHash(cx, cz, ti * 3 + 3) * 0.7,
          type: streamHash(cx, cz, ti * 3 + 4) > 0.72 ? 'birch' : 'pine',
          color: streamHash(cx, cz, ti * 3 + 5) > 0.5 ? [0.42, 0.62, 0.24] : [0.36, 0.54, 0.20]
        });
      }
      if (trees.length) treeMesh = makeTreeMesh(trees);
    }
    if (Math.sqrt(centerX * centerX + centerZ * centerZ) > 36) {
      for (var gi = 0; gi < STREAM_GRASS_PER_CHUNK; gi++) {
        var gx = cx * STREAM_CHUNK_SIZE + 2 + streamHash(cx, cz, 1000 + gi * 3) * (STREAM_CHUNK_SIZE - 4);
        var gz = cz * STREAM_CHUNK_SIZE + 2 + streamHash(cx, cz, 1001 + gi * 3) * (STREAM_CHUNK_SIZE - 4);
        var gy = streamHeightAt(terrain, gx, gz);
        if (gy < WATER_LEVEL + 0.4) continue;
        grass.push({
          x: gx, y: gy, z: gz,
          height: 0.34 + streamHash(cx, cz, 1002 + gi * 3) * 0.5,
          width: 0.07 + streamHash(cx, cz, 1003 + gi * 3) * 0.08,
          rotation: streamHash(cx, cz, 1004 + gi * 3) * Math.PI * 2,
          color: [0.34, 0.62, 0.18]
        });
      }
      if (grass.length) grassMesh = makeGrassMesh(grass);
    }
    return { treeMesh: treeMesh, grassMesh: grassMesh, trees: trees };
  }

  function makeStreamChunkMesh(terrain, cx, cz) {
    var size = STREAM_CHUNK_SIZE;
    var seg = STREAM_CHUNK_SEGMENTS;
    var originX = cx * size;
    var originZ = cz * size;
    var n = seg + 1;
    var positions = new Float32Array(n * n * 3);
    var normals = new Float32Array(n * n * 3);
    var colors = new Float32Array(n * n * 3);
    var indices = new Uint32Array(seg * seg * 6);
    var vi = 0;
    var eps = 0.8;
    for (var j = 0; j <= seg; j++) {
      for (var i = 0; i <= seg; i++) {
        var wx = originX + i / seg * size;
        var wz = originZ + j / seg * size;
        var h = streamHeightAt(terrain, wx, wz);
        var hx = streamHeightAt(terrain, wx + eps, wz) - streamHeightAt(terrain, wx - eps, wz);
        var hz = streamHeightAt(terrain, wx, wz + eps) - streamHeightAt(terrain, wx, wz - eps);
        var nx = -hx, ny = 2 * eps, nz = -hz;
        var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        positions[vi * 3] = wx;
        positions[vi * 3 + 1] = h;
        positions[vi * 3 + 2] = wz;
        normals[vi * 3] = nx;
        normals[vi * 3 + 1] = ny;
        normals[vi * 3 + 2] = nz;
        var rock = ny < 0.55;
        var snow = h > 22 && ny > 0.6;
        var cr = rock ? 0.36 : 0.24, cg = rock ? 0.33 : 0.44, cb = rock ? 0.29 : 0.16;
        if (snow) { cr = 0.78; cg = 0.80; cb = 0.82; }
        colors[vi * 3] = cr;
        colors[vi * 3 + 1] = cg;
        colors[vi * 3 + 2] = cb;
        vi++;
      }
    }
    var ii = 0;
    for (var z = 0; z < seg; z++) {
      for (var x = 0; x < seg; x++) {
        var a = z * n + x;
        var b = a + n;
        indices[ii++] = a; indices[ii++] = b; indices[ii++] = a + 1;
        indices[ii++] = a + 1; indices[ii++] = b; indices[ii++] = b + 1;
      }
    }
    programRef = terrainProgram;
    return createMesh(positions, normals, colors, indices);
  }

  function disposeMesh(mesh) {
    if (!mesh) return;
    gl.deleteVertexArray(mesh.vao);
    if (mesh.ibo) gl.deleteBuffer(mesh.ibo);
    var buffers = mesh.buffers || [];
    for (var i = 0; i < buffers.length; i++) gl.deleteBuffer(buffers[i]);
  }

  function disposeStreamChunk(chunk) {
    if (!chunk) return;
    if (chunk.levels) {
      for (var i = 0; i < chunk.levels.length; i++) disposeMesh(chunk.levels[i].mesh);
    }
    disposeMesh(chunk.treeMesh);
    disposeMesh(chunk.grassMesh);
  }

  function rebuildDetailGrass(terrain, pcx, pcz, centerX, centerZ) {
    disposeMesh(detailGrassMesh);
    detailGrassMesh = null;
    var locations = [];
    var grid = 0;
    for (var dz = -1; dz <= 1; dz++) {
      for (var dx = -1; dx <= 1; dx++) {
        var cx = pcx + dx;
        var cz = pcz + dz;
        if (Math.sqrt((cx * STREAM_CHUNK_SIZE + 32) * (cx * STREAM_CHUNK_SIZE + 32) +
          (cz * STREAM_CHUNK_SIZE + 32) * (cz * STREAM_CHUNK_SIZE + 32)) < 36) continue;
        for (var gi = 0; gi < 2200; gi++) {
          var gx = cx * STREAM_CHUNK_SIZE + 2 + streamHash(cx, cz, 5000 + gi * 3) * (STREAM_CHUNK_SIZE - 4);
          var gz = cz * STREAM_CHUNK_SIZE + 2 + streamHash(cx, cz, 5001 + gi * 3) * (STREAM_CHUNK_SIZE - 4);
          var gy = streamHeightAt(terrain, gx, gz);
          if (gy < WATER_LEVEL + 0.4) continue;
          locations.push({
            x: gx, y: gy, z: gz,
            height: 0.12 + streamHash(cx, cz, 5002 + gi * 3) * 0.20,
            width: 0.018 + streamHash(cx, cz, 5003 + gi * 3) * 0.016,
            rotation: streamHash(cx, cz, 5004 + gi * 3) * Math.PI * 2,
            color: [0.30, 0.56, 0.18]
          });
          grid++;
        }
      }
    }
    if (locations.length) detailGrassMesh = makeGrassMesh(locations);
    document.documentElement.setAttribute('data-detail-grass', String(locations.length));
  }

  function updateTerrainStream(terrain, px, pz) {
    var size = STREAM_CHUNK_SIZE;
    var radius = STREAM_RADIUS;
    var pcx = Math.floor(px / size);
    var pcz = Math.floor(pz / size);
    for (var dz = -radius; dz <= radius; dz++) {
      for (var dx = -radius; dx <= radius; dx++) {
        var cx = pcx + dx;
        var cz = pcz + dz;
        var key = cx + ',' + cz;
        if (streamChunks.has(key)) continue;
        var mesh = makeStreamChunkMesh(terrain, cx, cz);
        var centerX = cx * size + size * 0.5;
        var centerZ = cz * size + size * 0.5;
        var centerY = streamHeightAt(terrain, centerX, centerZ);
        var vegetation = makeStreamChunkVegetation(terrain, cx, cz, centerX, centerZ);
        streamChunks.set(key, {
          cx: cx, cz: cz,
          center: [centerX, centerY, centerZ],
          radius: Math.sqrt(2) * size * 0.5 + 8,
          treeMesh: vegetation.treeMesh,
          grassMesh: vegetation.grassMesh,
          trees: vegetation.trees,
          levels: [{ mesh: mesh, factor: 1, distance: 0 }]
        });
      }
    }
    streamChunks.forEach(function (chunk, key) {
      if (Math.abs(chunk.cx - pcx) > radius + 1 || Math.abs(chunk.cz - pcz) > radius + 1) {
        disposeStreamChunk(chunk);
        streamChunks.delete(key);
      }
    });
    terrainChunks = [];
    var streamTreeCount = 0;
    var streamGrassCount = 0;
    var streamGrassVerts = 0;
    streamChunks.forEach(function (chunk) {
      terrainChunks.push(chunk);
      if (chunk.treeMesh) streamTreeCount++;
      if (chunk.grassMesh) {
        streamGrassCount++;
        streamGrassVerts += chunk.grassMesh.count;
      }
    });
    document.documentElement.setAttribute('data-stream-veg', JSON.stringify({
      trees: streamTreeCount, grass: streamGrassCount,
      grassVerts: streamGrassVerts, chunks: terrainChunks.length
    }));
    var detailKey = pcx + ',' + pcz;
    if (detailKey !== detailGrassKey) {
      detailGrassKey = detailKey;
      rebuildDetailGrass(terrain, pcx, pcz);
    }
    if (window.AevumMarkGraphics) window.AevumMarkGraphics('TerrainStream');
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
    if (!window.OrbMath || !window.OrbMath.Vec3) {
      throw new Error('OrbMath.Vec3 is required; inline normalize3 is removed');
    }
    var ov = new window.OrbMath.Vec3(v[0], v[1], v[2]).normalize();
    if (window.AEVUM_GRAPHICS_USAGE) window.AEVUM_GRAPHICS_USAGE.OrbMath = (window.AEVUM_GRAPHICS_USAGE.OrbMath || 0) + 1;
    return [ov.x, ov.y, ov.z];
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
  var modelBaseY = 0;
  var proceduralSkeleton = null;
  var proceduralMotion = null;
  var proceduralChestBone = null;
  var birdPicker = null;
  var birdPickables = [];
  var pickerCamera = null;
  var grassWindCompute = null;
  var grassWindUBO = null;
  var grassWindVAO = null;
  var grassWindBlock = -1;
  var skinMaterial = null;
  var charPos = [0, 0, 0];
  var charScale = 1;
  var charYaw = Math.PI;
  var charYawCurrent = Math.PI;
  var keys = Object.create(null);
  var modelBoundsMinY = 0;
  var hasIdleClip = false;
  var roamBroadcast = 0;
  function publishRoamState(name, data) {
    document.documentElement.setAttribute('data-roam', JSON.stringify({
      state: name,
      x: Number((data && data.x) || 0),
      y: Number((data && data.y) || 0),
      z: Number((data && data.z) || 0),
      yaw: Number((data && data.yaw) || 0),
      chunks: (data && data.chunks) || 0,
      clip: (data && data.clip) || ''
    }));
  }
  var eye = [0, 5, 12];
  var target = [0, 1.5, 0];
  var viewProj = M4.create();
  var cameraPos = eye;
  var last = performance.now();
  var start = last;
  var fpsFrames = 0;
  var fpsClock = last;

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

  function setupWorldCamera() {
    document.documentElement.setAttribute('data-roam-boot',
      [String(renderOnly), String(!!world), String(!!modelRenderer)].join('|'));
    var ground = world ? world.terrain.getHeight(SPAWN[0], SPAWN[1]) : 0;
    charPos = [SPAWN[0], ground, SPAWN[1]];
    charYaw = Math.PI;
    charYawCurrent = Math.PI;
    eye = [0.75, ground + 2.55, 6.8];
    target = [0, ground + 1.42, 0];
    var view = M4.lookAt(M4.create(), eye, target, [0, 1, 0]);
    var proj = M4.perspective(M4.create(), FOV, W / H, 0.08, 700);
    M4.mult(viewProj, view, proj);
  }

  function initRoamInput() {
    function capture(code) {
      return code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD' ||
        code === 'ShiftLeft' || code === 'ShiftRight' ||
        code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight';
    }
    window.addEventListener('keydown', function (e) {
      if (!capture(e.code)) return;
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '')) return;
      keys[e.code] = true;
      if (e.code.indexOf('Arrow') === 0) e.preventDefault();
    }, { passive: false });
    window.addEventListener('keyup', function (e) {
      if (capture(e.code)) keys[e.code] = false;
    });
  }

  function initCameraInput() {
    if (!canvasWorld) return;
    canvasWorld.style.cursor = 'grab';
    canvasWorld.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      camDragging = true;
      camLastX = e.clientX;
      camLastY = e.clientY;
      canvasWorld.style.cursor = 'grabbing';
      e.preventDefault();
    });
    window.addEventListener('pointermove', function (e) {
      if (!camDragging) return;
      var dx = e.clientX - camLastX;
      var dy = e.clientY - camLastY;
      camLastX = e.clientX;
      camLastY = e.clientY;
      camYaw -= dx * 0.0042;
      camPitch = Math.max(0.04, Math.min(1.05, camPitch + dy * 0.0032));
    });
    window.addEventListener('pointerup', function () {
      if (!camDragging) return;
      camDragging = false;
      canvasWorld.style.cursor = 'grab';
    });
    canvasWorld.addEventListener('wheel', function (e) {
      e.preventDefault();
      camDistance = Math.max(3.2, Math.min(16, camDistance + e.deltaY * 0.006));
    }, { passive: false });
    canvasWorld.addEventListener('dblclick', function () {
      camYaw = charYawCurrent;
      camPitch = 0.24;
      camDistance = 7.2;
    });
  }

  function treeBlocks(x, z) {
    var i;
    for (i = 0; i < trees.length; i++) {
      var t = trees[i];
      var r = 0.8 * (t.scale || 1);
      if ((x - t.x) * (x - t.x) + (z - t.z) * (z - t.z) < r * r) return true;
    }
    var blockedByChunkTree = false;
    streamChunks.forEach(function (chunk) {
      if (blockedByChunkTree || !chunk.trees) return;
      for (var j = 0; j < chunk.trees.length; j++) {
        var st = chunk.trees[j];
        var sr = 0.8 * (st.scale || 1);
        if ((x - st.x) * (x - st.x) + (z - st.z) * (z - st.z) < sr * sr) {
          blockedByChunkTree = true;
          return;
        }
      }
    });
    return blockedByChunkTree;
  }

  function canWalkAt(x, z, fromX, fromZ) {
    if (streamHeightAt(world.terrain, x, z) < WATER_LEVEL + 0.35) return false;
    if (!treeBlocks(x, z)) return true;
    return typeof fromX === 'number' && treeBlocks(fromX, fromZ);
  }

  window.AevumWorldDebug = {
    heightAt: function (x, z) { return world ? streamHeightAt(world.terrain, x, z) : null; },
    canWalk: function (x, z) { return !!world && canWalkAt(x, z); },
    waterLevel: function () { return WATER_LEVEL; }
  };

  // ---- 联机位置通道（HTTP 状态中继，8Hz 上报） --------------------------
  var relayBase = '';
  var netId = '';
  var netName = '';
  var netStatus = 'offline';
  var netOnline = 0;
  var netClock = 0;
  var netBroadcast = 0;
  var netInFlight = false;
  var remotePlayers = Object.create(null);
  var avatarParts = null;
  var playerTagEls = Object.create(null);
  var roomId = 'world-lobby';
  var roomMembers = [];
  var roomMessages = [];
  var roomStatus = 'connecting';
  var roomClock = 0;
  var roomPollClock = 0;
  var roomInFlight = false;
  var roomEls = null;
  var roomJoinedOnce = false;
  var roomSystemLines = [];
  var roomBaselineNames = null;
  var camYaw = Math.PI;
  var camPitch = 0.24;
  var camBroadcast = 0;
  var camDistance = 7.2;
  var camDragging = false;
  var camLastX = 0;
  var camLastY = 0;
  var modelName = '默认 VRM';
  var motionData = null;

  function initNetwork() {
    var query = new URLSearchParams(window.location.search);
    relayBase = query.get('relay') || '';
    if (!relayBase) {
      relayBase = (location.hostname === '127.0.0.1' || location.hostname === 'localhost')
        ? 'http://' + location.hostname + ':8790'
        : location.origin + '/relay';
    }
    relayBase = relayBase.replace(/\/+$/, '');
    try {
      netId = window.sessionStorage.getItem('aevum.world.netId') || '';
      if (!netId) {
        netId = (window.crypto && window.crypto.randomUUID)
          ? window.crypto.randomUUID()
          : 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        window.sessionStorage.setItem('aevum.world.netId', netId);
      }
    } catch (e) {
      netId = 'p' + Math.random().toString(36).slice(2, 10);
    }
    netName = query.get('name') || ('旅人-' + netId.slice(0, 4));
    document.documentElement.setAttribute('data-net',
      JSON.stringify({ status: 'connecting', id: netId, relay: relayBase, online: 0, remote: 0 }));
  }

  function netColorFor(id) {
    var palette = [
      [0.98, 0.48, 0.22], [0.22, 0.72, 0.96], [0.62, 0.88, 0.34],
      [0.94, 0.68, 0.24], [0.78, 0.48, 0.96], [0.28, 0.86, 0.72]
    ];
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
    return palette[h % palette.length];
  }

  function buildAvatarMesh(boxes) {
    var positions = [];
    var normals = [];
    var indices = [];
    function box(cx, cy, cz, hx, hy, hz) {
      var base = positions.length / 3;
      var faces = [
        [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
        [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
        [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
        [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
        [[0, 0, 1], [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]]],
        [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]]
      ];
      for (var f = 0; f < faces.length; f++) {
        var n = faces[f][0];
        var q = faces[f][1];
        for (var v = 0; v < 4; v++) {
          positions.push(cx + q[v][0] * hx, cy + q[v][1] * hy, cz + q[v][2] * hz);
          normals.push(n[0], n[1], n[2]);
        }
        var o = base + f * 4;
        indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
      }
    }
    for (var b = 0; b < boxes.length; b++) box.apply(null, boxes[b]);
    return createMesh(positions, normals, null, indices);
  }

  function makeAvatarMesh() {
    return {
      body: buildAvatarMesh([
        [0, 0.78, 0, 0.22, 0.16, 0.13],
        [-0.15, 0.38, 0, 0.09, 0.40, 0.10],
        [0.15, 0.38, 0, 0.09, 0.40, 0.10],
        [-0.34, 1.28, 0, 0.07, 0.30, 0.09],
        [0.34, 1.28, 0, 0.07, 0.30, 0.09]
      ]),
      torso: buildAvatarMesh([[0, 1.32, 0, 0.26, 0.42, 0.15]]),
      core: buildAvatarMesh([[0, 1.34, 0.16, 0.09, 0.09, 0.02]]),
      head: buildAvatarMesh([[0, 1.86, 0, 0.16, 0.17, 0.16]])
    };
  }
  function applyRemotePlayers(list) {
    var now = performance.now();
    var seenId = false;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.id === netId) { seenId = true; continue; }
      var r = remotePlayers[p.id];
      if (!r) {
        r = remotePlayers[p.id] = {
          id: p.id, name: p.name || '旅人',
          x: p.x, y: p.y, z: p.z, yaw: p.yaw,
          tx: p.x, ty: p.y, tz: p.z, tyaw: p.yaw,
          clip: p.clip || 'walk', color: netColorFor(p.id), last: now
        };
      } else {
        r.tx = p.x; r.ty = p.y; r.tz = p.z; r.tyaw = p.yaw;
        r.clip = p.clip || r.clip;
        r.last = now;
      }
    }
    for (var id in remotePlayers) {
      if (now - remotePlayers[id].last > 5000) delete remotePlayers[id];
    }
    netOnline = list.length;
  }

  function sendNetState() {
    if (netInFlight || !world || !modelRenderer) return;
    netInFlight = true;
    fetch(relayBase + '/v1/world/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        id: netId, name: netName,
        room: roomId,
        x: +charPos[0].toFixed(3), y: +charPos[1].toFixed(3), z: +charPos[2].toFixed(3),
        yaw: +charYawCurrent.toFixed(3), clip: clip
      })
    }).then(function (res) { return res.json(); }).then(function (data) {
      if (!data || !data.ok) throw new Error('relay error');
      netStatus = 'online';
      applyRemotePlayers(data.players || []);
    }).catch(function () {
      netStatus = 'offline';
    }).finally(function () {
      netInFlight = false;
    });
  }

  function updateNetwork(dt) {
    if (!relayBase) return;
    netClock += dt;
    netBroadcast += dt;
    if (netClock >= 0.12) {
      netClock = 0;
      sendNetState();
    }
    var k = Math.min(1, dt * 12);
    for (var id in remotePlayers) {
      var r = remotePlayers[id];
      r.x += (r.tx - r.x) * k;
      r.y += (r.ty - r.y) * k;
      r.z += (r.tz - r.z) * k;
      var dy = ((r.tyaw - r.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      r.yaw += dy * k;
    }
    if (netBroadcast >= 0.5) {
      netBroadcast = 0;
      document.documentElement.setAttribute('data-net', JSON.stringify({
        status: netStatus, id: netId, name: netName, relay: relayBase,
        online: netOnline,
        remote: Object.keys(remotePlayers).length,
        players: Object.keys(remotePlayers).map(function (rid) {
          return { name: remotePlayers[rid].name, x: remotePlayers[rid].x, z: remotePlayers[rid].z };
        })
      }));
    }
  }

  function drawRemotePlayers() {
    if (!avatarParts) return;
    var ids = Object.keys(remotePlayers);
    if (!ids.length) return;
    gl.useProgram(objectProgram);
    gl.uniformMatrix4fv(uniformLocation(objectProgram, 'uViewProj'), false, viewProj);
    gl.uniform3fv(uniformLocation(objectProgram, 'uSunDir'), new Float32Array(normalize3(world.lights.directionalLight.direction)));
    gl.uniform3fv(uniformLocation(objectProgram, 'uSunColor'), new Float32Array(world.lights.directionalLight.color));
    gl.uniform3fv(uniformLocation(objectProgram, 'uAmbient'), new Float32Array(world.lights.ambientLight.color));
    for (var i = 0; i < ids.length; i++) {
      var r = remotePlayers[ids[i]];
      var dx = r.x - charPos[0], dz = r.z - charPos[2];
      var dist2 = dx * dx + dz * dz;
      var cdx = r.x - cameraPos[0], cdy = r.y + 1.2 - cameraPos[1], cdz = r.z - cameraPos[2];
      var cameraDist = Math.sqrt(cdx * cdx + cdy * cdy + cdz * cdz);
      var nearFade = Math.min(1, Math.max(0, (cameraDist - 5.0) / 3.0));
      if (dist2 > 90 * 90 || dist2 < 2.4 * 2.4 || nearFade < 0.08) continue;
      var avatarScale = 0.8 * (0.5 + nearFade * 0.5);
      var m = M4.fromTRS(M4.create(), [r.x, r.y, r.z],
        math.Q.fromAxisAngle(math.Q.create(), [0, 1, 0], r.yaw + Math.PI),
        [avatarScale, avatarScale, avatarScale]);
      gl.uniformMatrix4fv(uniformLocation(objectProgram, 'uModel'), false, m);
      gl.uniform1f(uniformLocation(objectProgram, 'uGlow'), 0.12);
      gl.uniform3fv(uniformLocation(objectProgram, 'uColor'), new Float32Array([0.10, 0.14, 0.18]));
      gl.bindVertexArray(avatarParts.body.vao);
      gl.drawElements(gl.TRIANGLES, avatarParts.body.count, gl.UNSIGNED_INT, 0);
      gl.uniform3fv(uniformLocation(objectProgram, 'uColor'), new Float32Array(r.color));
      gl.bindVertexArray(avatarParts.torso.vao);
      gl.drawElements(gl.TRIANGLES, avatarParts.torso.count, gl.UNSIGNED_INT, 0);
      gl.uniform3fv(uniformLocation(objectProgram, 'uColor'), new Float32Array([0.82, 0.66, 0.52]));
      gl.bindVertexArray(avatarParts.head.vao);
      gl.drawElements(gl.TRIANGLES, avatarParts.head.count, gl.UNSIGNED_INT, 0);
      gl.uniform1f(uniformLocation(objectProgram, 'uGlow'), 0.55);
      gl.uniform3fv(uniformLocation(objectProgram, 'uColor'), new Float32Array([0.86, 0.94, 0.62]));
      gl.bindVertexArray(avatarParts.core.vao);
      gl.drawElements(gl.TRIANGLES, avatarParts.core.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  function updatePlayerTags() {
    var root = document.getElementById('playerTags');
    if (!root) return;
    var rect = canvasWorld.getBoundingClientRect();
    var ids = Object.keys(remotePlayers);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var r = remotePlayers[id];
      var tag = playerTagEls[id];
      if (!tag) {
        tag = document.createElement('div');
        tag.className = 'player-tag';
        tag.textContent = r.name || '旅人';
        root.appendChild(tag);
        playerTagEls[id] = tag;
      }
      var tx = r.x, ty = r.y + 2.4, tz = r.z;
      var cw = viewProj[3] * tx + viewProj[7] * ty + viewProj[11] * tz + viewProj[15];
      if (cw <= 0.05) { tag.style.display = 'none'; continue; }
      var cx = (viewProj[0] * tx + viewProj[4] * ty + viewProj[8] * tz + viewProj[12]) / cw;
      var cy = (viewProj[1] * tx + viewProj[5] * ty + viewProj[9] * tz + viewProj[13]) / cw;
      var sx = (cx * 0.5 + 0.5) * rect.width;
      var sy = (1 - (cy * 0.5 + 0.5)) * rect.height;
      var ddx = r.x - charPos[0], ddz = r.z - charPos[2];
      var near = ddx * ddx + ddz * ddz < 2.4 * 2.4;
      var cdx = r.x - cameraPos[0], cdy = r.y + 1.2 - cameraPos[1], cdz = r.z - cameraPos[2];
      if (cdx * cdx + cdy * cdy + cdz * cdz < 7 * 7) near = true;
      if (near || ddx * ddx + ddz * ddz > 70 * 70 || sx < -40 || sx > rect.width + 40 || sy < -20 || sy > rect.height + 20) {
        tag.style.display = 'none';
        continue;
      }
      tag.style.display = 'block';
      tag.style.transform = 'translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px) translate(-50%,-100%)';
    }
    for (var rid in playerTagEls) {
      if (!remotePlayers[rid]) {
        playerTagEls[rid].remove();
        delete playerTagEls[rid];
      }
    }
  }

  function initWorldUI() {
    var query = new URLSearchParams(window.location.search);
    var requestedRoom = (query.get('room') || 'world-lobby').trim();
    roomId = /^[A-Za-z0-9_-]{1,32}$/.test(requestedRoom) ? requestedRoom : 'world-lobby';
    roomEls = {
      panel: document.getElementById('socialPanel'),
      log: document.getElementById('chatLog'),
      form: document.getElementById('chatForm'),
      input: document.getElementById('chatInput'),
      room: document.getElementById('roomLabel'),
      online: document.getElementById('roomOnline'),
      state: document.getElementById('modelState'),
      pick: document.getElementById('modelPick'),
      file: document.getElementById('modelFile')
    };
    if (roomEls.room) roomEls.room.textContent = 'ROOM · ' + roomId;
    if (roomEls.form) {
      roomEls.form.addEventListener('submit', function (e) {
        e.preventDefault();
        sendChat();
      });
    }
    if (roomEls.pick && roomEls.file) {
      roomEls.pick.addEventListener('click', function () { roomEls.file.click(); });
      roomEls.file.addEventListener('change', function () {
        var file = roomEls.file.files && roomEls.file.files[0];
        if (file) loadCharacterFile(file);
        roomEls.file.value = '';
      });
    }
    document.documentElement.setAttribute('data-room', JSON.stringify({ room: roomId, status: 'connecting' }));
    window.addEventListener('pagehide', leaveRoom);
    addSystemLine('正在连接房间 ' + roomId + '…');
    window.AevumWorldRuntime = {
      loadCharacterFile: loadCharacterFile,
      loadCharacterBuffer: applyCharacterBuffer,
      room: function () { return roomId; },
      players: function () { return roomMembers; },
      camera: function () { return { yaw: camYaw, pitch: camPitch, distance: camDistance }; }
    };
  }

  function roomTime(ts) {
    try {
      var d = new Date(ts);
      return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    } catch (e) { return '--:--'; }
  }

  function addSystemLine(text) {
    roomSystemLines.push({ text: text, ts: Date.now() });
    if (roomSystemLines.length > 10) roomSystemLines.shift();
    renderChat();
  }

  function renderChat() {
    if (!roomEls || !roomEls.log) return;
    var log = roomEls.log;
    log.innerHTML = '';
    roomSystemLines.forEach(function (line) {
      var el = document.createElement('div');
      el.className = 'chat-line is-system';
      el.textContent = line.text;
      log.appendChild(el);
    });
    roomMessages.slice(-80).forEach(function (m) {
      var el = document.createElement('div');
      el.className = 'chat-line' + (m.id === netId ? ' is-self' : '');
      var who = document.createElement('span');
      who.className = 'who';
      who.textContent = m.name || '旅人';
      var when = document.createElement('span');
      when.className = 'when';
      when.textContent = roomTime(m.ts);
      var body = document.createElement('span');
      body.className = 'body';
      body.textContent = m.text;
      el.appendChild(who);
      el.appendChild(when);
      el.appendChild(body);
      log.appendChild(el);
    });
    log.scrollTop = log.scrollHeight;
  }

  function applyRoomSnapshot(data) {
    if (!data || !data.ok) return;
    if (data.exists) {
      roomSystemLines = roomSystemLines.filter(function (line) {
        return line.text.indexOf('正在连接') === -1;
      });
    }
    roomStatus = data.exists ? 'online' : 'empty';
    if (data.exists) {
      roomMessages = Array.isArray(data.messages) ? data.messages : [];
      roomMembers = Array.isArray(data.members) ? data.members : [];
      var names = roomMembers.map(function (m) { return m.id + ':' + m.name; });
      if (roomBaselineNames) {
        names.forEach(function (entry) {
          if (roomBaselineNames.indexOf(entry) === -1) {
            var nm = entry.split(':').slice(1).join(':');
            if (nm !== netName) addSystemLine(nm + ' 进入房间');
          }
        });
        roomBaselineNames.forEach(function (entry) {
          if (names.indexOf(entry) === -1 && roomBaselineNames.length > 0) {
            var nm = entry.split(':').slice(1).join(':');
            if (nm !== netName) addSystemLine(nm + ' 离开房间');
          }
        });
      }
      roomBaselineNames = names;
      if (roomEls && roomEls.online) roomEls.online.textContent = roomMembers.length + ' ONLINE';
    } else {
      roomMessages = [];
      roomMembers = [];
      roomBaselineNames = null;
      roomSystemLines = [];
      if (roomEls && roomEls.online) roomEls.online.textContent = '0 ONLINE';
      addSystemLine('房间已关闭，最后一人离开后记录已销毁');
    }
    renderChat();
    document.documentElement.setAttribute('data-room', JSON.stringify({
      room: roomId, status: roomStatus, online: roomMembers.length,
      members: roomMembers.map(function (m) { return m.name; }),
      messages: roomMessages.length
    }));
  }

  function joinRoom() {
    if (roomInFlight) return;
    roomInFlight = true;
    fetch(relayBase + '/v1/world/rooms/' + encodeURIComponent(roomId) + '/join', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ id: netId, name: netName })
    }).then(function (res) { return res.json(); }).then(function (data) {
      if (!data || !data.ok) throw new Error('join failed');
      roomJoinedOnce = true;
      applyRoomSnapshot(data);
    }).catch(function () {
      roomStatus = 'offline';
      if (roomEls && roomEls.online) roomEls.online.textContent = 'OFFLINE';
      document.documentElement.setAttribute('data-room', JSON.stringify({ room: roomId, status: 'offline' }));
    }).finally(function () { roomInFlight = false; });
  }

  function pollRoom() {
    if (roomInFlight) return;
    roomInFlight = true;
    fetch(relayBase + '/v1/world/rooms/' + encodeURIComponent(roomId), { cache: 'no-store' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data || !data.ok) throw new Error('poll failed');
        applyRoomSnapshot(data);
      })
      .catch(function () {
        roomStatus = 'offline';
      })
      .finally(function () { roomInFlight = false; });
  }

  function updateRoom(dt) {
    if (!relayBase) return;
    roomClock += dt;
    roomPollClock += dt;
    if (roomClock >= 2.5) {
      roomClock = 0;
      joinRoom();
    }
    if (roomPollClock >= 1.1) {
      roomPollClock = 0;
      pollRoom();
    }
  }

  function sendChat() {
    if (!roomEls || !roomEls.input) return;
    var text = roomEls.input.value.trim();
    if (!text) return;
    roomEls.input.value = '';
    fetch(relayBase + '/v1/world/rooms/' + encodeURIComponent(roomId) + '/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ id: netId, text: text })
    }).then(function (res) { return res.json(); }).then(function (data) {
      if (!data || !data.ok) throw new Error(data && data.message || 'send failed');
      applyRoomSnapshot(data);
      if (roomEls && roomEls.input) roomEls.input.focus();
    }).catch(function (err) {
      addSystemLine('发送失败：' + (err && err.message ? err.message : '中继不可用'));
    });
  }

  function leaveRoom() {
    if (!relayBase || !netId) return;
    var url = relayBase + '/v1/world/rooms/' + encodeURIComponent(roomId) + '/leave';
    var body = JSON.stringify({ id: netId });
    try {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
    } catch (e) { /* ignore */ }
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
    } catch (e) { /* ignore */ }
  }

  function inflateRawBytes(bytes) {
    if (!window.DecompressionStream) return Promise.reject(new Error('当前浏览器不支持 ZIP 解压'));
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  async function extractVRMFromZip(file) {
    var buf = await file.arrayBuffer();
    var dv = new DataView(buf);
    var eocd = -1;
    var lower = Math.max(0, buf.byteLength - 65557);
    for (var i = buf.byteLength - 22; i >= lower; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ZIP 目录损坏，找不到 EOCD');
    var count = dv.getUint16(eocd + 10, true);
    var cdOffset = dv.getUint32(eocd + 16, true);
    var p = cdOffset;
    var best = null;
    var decoder = new TextDecoder('utf-8');
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true);
      var compSize = dv.getUint32(p + 20, true);
      var uncompSize = dv.getUint32(p + 24, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var commentLen = dv.getUint16(p + 32, true);
      var localOffset = dv.getUint32(p + 42, true);
      var name = decoder.decode(new Uint8Array(buf, p + 46, nameLen));
      if (/\.vrm$/i.test(name) && (!best || uncompSize > best.uncompSize)) {
        best = { name: name, method: method, compSize: compSize, localOffset: localOffset };
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    if (!best) throw new Error('ZIP 内没有 .vrm 文件；目前只支持 VRM 角色模型');
    if (dv.getUint32(best.localOffset, true) !== 0x04034b50) throw new Error('ZIP 本地头损坏');
    var lNameLen = dv.getUint16(best.localOffset + 26, true);
    var lExtraLen = dv.getUint16(best.localOffset + 28, true);
    var dataStart = best.localOffset + 30 + lNameLen + lExtraLen;
    var raw = new Uint8Array(buf, dataStart, best.compSize);
    if (best.method === 0) return { name: best.name, bytes: raw };
    if (best.method === 8) {
      var inflated = await inflateRawBytes(raw);
      return { name: best.name, bytes: inflated };
    }
    throw new Error('不支持的 ZIP 压缩方式 ' + best.method);
  }

  async function applyCharacterBuffer(buffer, label) {
    if (!modelRenderer || !window.AEVUM || !window.AEVUM.formats) throw new Error('角色渲染器尚未就绪');
    var next = window.AEVUM.formats.parseVRM(buffer);
    await modelRenderer.loadVRM(next);
    vrm = next;
    if (motionData) {
      player = window.AEVUM.formats.GLTFAnimation.createPlayer(motionData);
      hasIdleClip = player.clips.some(function (c) { return c.name === 'idle'; });
      var wanted = player.clips.some(function (c) { return c.name === clip; }) ? clip : 'walk';
      clip = wanted;
      player.setClip(clip).reset().setLoop(true).play();
      player.update(0.08);
    }
    var bounds = modelRenderer.bounds;
    modelBoundsMinY = bounds.min[1];
    charScale = 2.55 / Math.max(0.001, bounds.max[1] - bounds.min[1]);
    charPos[1] = streamHeightAt(world.terrain, charPos[0], charPos[2]);
    M4.fromTRS(modelMatrix, [charPos[0], charPos[1] - bounds.min[1] * charScale, charPos[2]],
      math.Q.fromAxisAngle(math.Q.create(), [0, 1, 0], charYawCurrent + Math.PI),
      [charScale, charScale, charScale]);
    modelBaseY = modelMatrix[13];
    modelName = label;
    if (statEl) statEl.textContent = (clip || 'walk').toUpperCase() + ' / ' + (vrm.humanBones || []).length + ' BONES';
    if (roomEls && roomEls.state) roomEls.state.textContent = label;
    document.documentElement.setAttribute('data-model', JSON.stringify({
      name: label, format: 'vrm', bones: (vrm.humanBones || []).length, height: 2.55
    }));
  }

  async function loadCharacterFile(file) {
    if (!roomEls || !roomEls.state) return;
    roomEls.state.textContent = '识别中…';
    try {
      var head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      var isZip = file.name.toLowerCase().endsWith('.zip') || (head[0] === 0x50 && head[1] === 0x4b);
      var buffer;
      var label = file.name.replace(/\.(zip|vrm)$/i, '');
      if (isZip) {
        roomEls.state.textContent = '解压 ZIP…';
        var entry = await extractVRMFromZip(file);
        var exact = new ArrayBuffer(entry.bytes.byteLength);
        new Uint8Array(exact).set(entry.bytes);
        buffer = exact;
        label = entry.name.split('/').pop().replace(/\.vrm$/i, '');
      } else if (file.name.toLowerCase().endsWith('.vrm') ||
        (head.length >= 4 && head[0] === 0x67 && head[1] === 0x6c && head[2] === 0x54 && head[3] === 0x46)) {
        buffer = await file.arrayBuffer();
      } else {
        throw new Error('只支持 .vrm 或包含 .vrm 的 .zip');
      }
      roomEls.state.textContent = '加载模型…';
      await applyCharacterBuffer(buffer, label);
      roomEls.state.textContent = '已加载 ' + label + ' · VRM';
      addSystemLine('角色模型已切换：' + label);
    } catch (err) {
      roomEls.state.textContent = '加载失败：' + (err && err.message ? err.message : '未知错误');
      addSystemLine('模型加载失败：' + (err && err.message ? err.message : '未知错误'));
    }
  }

  function updateRoamCharacter(dt) {
    if (renderOnly || !world || !modelRenderer) {
      publishRoamState(renderOnly ? 'render-only' : (!world ? 'no-world' : 'no-model'), {});
      return;
    }
    var forward = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    var strafe = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    if (keys.ArrowUp) forward += 1;
    if (keys.ArrowDown) forward -= 1;
    if (keys.ArrowRight) strafe += 1;
    if (keys.ArrowLeft) strafe -= 1;
    var camfx = Math.sin(camYaw);
    var camfz = Math.cos(camYaw);
    var dx = camfx * forward - camfz * strafe;
    var dz = camfz * forward + camfx * strafe;
    var moving = dx !== 0 || dz !== 0;
    if (moving) {
      var len = Math.sqrt(dx * dx + dz * dz) || 1;
      dx /= len; dz /= len;
      var speed = (keys.ShiftLeft || keys.ShiftRight) ? 5.6 : 1.8;
      var nextX = charPos[0] + dx * speed * dt;
      var nextZ = charPos[2] + dz * speed * dt;
      var moved = false;
      if (canWalkAt(nextX, nextZ, charPos[0], charPos[2])) {
        charPos[0] = nextX;
        charPos[2] = nextZ;
        charYaw = Math.atan2(dx, dz);
        moved = true;
      } else if (canWalkAt(nextX, charPos[2], charPos[0], charPos[2])) {
        charPos[0] = nextX;
        charYaw = Math.atan2(dx, 0);
        moved = true;
      } else if (canWalkAt(charPos[0], nextZ, charPos[0], charPos[2])) {
        charPos[2] = nextZ;
        charYaw = Math.atan2(0, dz);
        moved = true;
      } else {
        var baseYaw = Math.atan2(dx, dz);
        var deflects = [0.5, -0.5, 1.0, -1.0, Math.PI];
        for (var di = 0; di < deflects.length && !moved; di++) {
          var ao = baseYaw + deflects[di];
          var ox = charPos[0] + Math.sin(ao) * speed * dt;
          var oz = charPos[2] + Math.cos(ao) * speed * dt;
          if (canWalkAt(ox, oz)) {
            charPos[0] = ox;
            charPos[2] = oz;
            charYaw = ao;
            moved = true;
          }
        }
      }
      if (!moved) moving = false;
    }
    charPos[1] = streamHeightAt(world.terrain, charPos[0], charPos[2]);
    updateTerrainStream(world.terrain, charPos[0], charPos[2]);
    var diff = ((charYaw - charYawCurrent + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    charYawCurrent += diff * Math.min(1, dt * 10);
    modelBaseY = charPos[1] - modelBoundsMinY * charScale;
    M4.fromTRS(modelMatrix, [charPos[0], modelBaseY, charPos[2]],
      math.Q.fromAxisAngle(math.Q.create(), [0, 1, 0], charYawCurrent + Math.PI),
      [charScale, charScale, charScale]);
    if (player) {
      var nextClip = moving ? ((keys.ShiftLeft || keys.ShiftRight) ? 'run' : 'walk') : (hasIdleClip ? 'idle' : 'walk');
      if (clip !== nextClip) {
        clip = nextClip;
        player.setClip(clip).reset().setLoop(true).play();
      }
    }
    roamBroadcast += dt;
    if (roamBroadcast >= 0.5) {
      roamBroadcast = 0;
      publishRoamState('roaming', {
        x: charPos[0], y: charPos[1], z: charPos[2], yaw: charYawCurrent,
        cam: camYaw, chunks: terrainChunks.length, clip: clip
      });
    }
    if (window.AevumMarkGraphics) window.AevumMarkGraphics('RoamController');
  }

  function cameraClearRatio(target, eye) {
    var near = [];
    var i, t;
    for (i = 0; i < trees.length; i++) {
      var tr = trees[i];
      var dx = tr.x - target[0], dz = tr.z - target[2];
      if (dx * dx + dz * dz < 16 * 16) near.push([tr.x, tr.z, 2.5 * (tr.scale || 1)]);
    }
    streamChunks.forEach(function (chunk) {
      if (!chunk.trees) return;
      for (var j = 0; j < chunk.trees.length; j++) {
        var st = chunk.trees[j];
        var sx = st.x - target[0], sz = st.z - target[2];
        if (sx * sx + sz * sz < 16 * 16) near.push([st.x, st.z, 2.5 * (st.scale || 1)]);
      }
    });
    var ratio = 1;
    var px, pz;
    for (i = 1; i <= 12; i++) {
      t = i / 12;
      px = target[0] + (eye[0] - target[0]) * t;
      pz = target[2] + (eye[2] - target[2]) * t;
      for (var k = 0; k < near.length; k++) {
        var nx = px - near[k][0], nz = pz - near[k][1];
        if (nx * nx + nz * nz < near[k][2] * near[k][2]) {
          ratio = Math.min(ratio, Math.max(0.32, (i - 1) / 12));
          break;
        }
      }
    }
    // A hill between the character and the camera is an opaque wall that
    // grows/shrinks with the wheel. Pull the camera in front of the first
    // terrain sample that rises above the sight line.
    if (world && world.terrain) {
      for (i = 1; i <= 12; i++) {
        t = i / 12;
        px = target[0] + (eye[0] - target[0]) * t;
        pz = target[2] + (eye[2] - target[2]) * t;
        var cy = target[1] + (eye[1] - target[1]) * t;
        if (cy < streamHeightAt(world.terrain, px, pz) + 0.35) {
          ratio = Math.min(ratio, Math.max(0.30, (i - 1) / 12));
          break;
        }
      }
    }
    return ratio;
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
    } else {
      var fx = Math.sin(camYaw);
      var fz = Math.cos(camYaw);
      var horizontal = camDistance * Math.cos(camPitch);
      var lift = 1.5 + camDistance * Math.sin(camPitch);
      var desiredEye = [charPos[0] - fx * horizontal, charPos[1] + lift, charPos[2] - fz * horizontal];
      var desiredTarget = [charPos[0], charPos[1] + 1.45, charPos[2]];
      if (world && world.terrain) {
        var cameraGround = streamHeightAt(world.terrain, desiredEye[0], desiredEye[2]);
        if (desiredEye[1] < cameraGround + 0.8) desiredEye[1] = cameraGround + 0.8;
      }
      var clearRatio = cameraClearRatio(desiredTarget, desiredEye);
      if (clearRatio < 1) {
        desiredEye[0] = desiredTarget[0] + (desiredEye[0] - desiredTarget[0]) * clearRatio;
        desiredEye[1] = desiredTarget[1] + (desiredEye[1] - desiredTarget[1]) * clearRatio;
        desiredEye[2] = desiredTarget[2] + (desiredEye[2] - desiredTarget[2]) * clearRatio;
      }
      var smooth = 1 - Math.pow(0.001, 1 / 60);
      eye = [
        eye[0] + (desiredEye[0] - eye[0]) * smooth,
        eye[1] + (desiredEye[1] - eye[1]) * smooth,
        eye[2] + (desiredEye[2] - eye[2]) * smooth
      ];
      target = [
        target[0] + (desiredTarget[0] - target[0]) * smooth,
        target[1] + (desiredTarget[1] - target[1]) * smooth,
        target[2] + (desiredTarget[2] - target[2]) * smooth
      ];
    }
    var view = M4.lookAt(M4.create(), eye, target, [0, 1, 0]);
    var proj = M4.perspective(M4.create(), FOV, W / H, 0.08, 700);
    M4.mult(viewProj, view, proj);
    cameraPos = eye;
    camBroadcast += 1;
    if (camBroadcast >= 15) {
      camBroadcast = 0;
      document.documentElement.setAttribute('data-cam', JSON.stringify({
        yaw: +camYaw.toFixed(3), pitch: +camPitch.toFixed(3), distance: +camDistance.toFixed(2)
      }));
    }
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
    gl.uniformMatrix4fv(uniformLocation(prog, 'uLightVPs[0]'), false, shadowVPData);
    var dists = world && world.shadows && world.shadows.cascadeDistances;
    if (!dists) dists = [18, 54, 108, 180];
    gl.uniform4f(uniformLocation(prog, 'uShadowDistances'), dists[0], dists[1], dists[2], dists[3]);
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
      // All chunks must use the same LOD: per-chunk LOD selection creates
      // T-junction cracks at chunk borders, which read as bright ridge lines.
      var nearestChunkDistance = Infinity;
      for (var n = 0; n < terrainChunks.length; n++) {
        var ndx = terrainChunks[n].center[0] - cameraPos[0];
        var ndz = terrainChunks[n].center[2] - cameraPos[2];
        nearestChunkDistance = Math.min(nearestChunkDistance, Math.sqrt(ndx * ndx + ndz * ndz));
      }
      var globalLod = world.terrain.getLODLevel(nearestChunkDistance);
      for (var c = 0; c < terrainChunks.length; c++) {
        var chunk = terrainChunks[c];
        // Draw all 16 chunks. Frustum-culling a chunk by its bounding sphere
        // can drop the near ground plane while the camera orbits, which reads
        // as a black lower half. Sixteen draws are cheap enough to keep.
        var level = chunk.levels[globalLod] || chunk.levels[chunk.levels.length - 1];
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
    if (!treeGroups.length && !terrainChunks.length) return;
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
      gl.bindVertexArray(g.mesh.vao);
      gl.drawElements(gl.TRIANGLES, g.mesh.count, gl.UNSIGNED_INT, 0);
    }
    for (var c = 0; c < terrainChunks.length; c++) {
      var chunk = terrainChunks[c];
      if (!chunk.treeMesh) continue;
      gl.bindVertexArray(chunk.treeMesh.vao);
      gl.drawElements(gl.TRIANGLES, chunk.treeMesh.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  function initCharacterSkin() {
    if (!window.SpiritSkin || !window.SpiritSkin.SkinMaterial) {
      throw new Error('SpiritSkin.SkinMaterial is required for character skin');
    }
    skinMaterial = new window.SpiritSkin.SkinMaterial();
    skinMaterial.setSSS({
      enabled: true,
      intensity: 0.8,
      radius: [0.002, 0.010, 0.030],
      color: [1.0, 0.60, 0.40],
      distortion: 0.4,
      power: 2.0,
      scale: 1.0
    });
    skinMaterial.setSheen({
      enabled: true,
      color: [1.0, 0.80, 0.70],
      roughness: 0.5,
      intensity: 0.30
    });
    skinMaterial.setClearcoat({ enabled: true, intensity: 0.08, roughness: 0.10 });
    markGraphics('SpiritSkin');
  }

  function initGraphicsEntry() {
    if (!window.OrbWebGLCore) throw new Error('OrbWebGLCore entry is required');
    window.OrbWebGLCore.init();
    markGraphics('OrbWebGLCore');
  }

  function initGrassWindCompute() {
    if (!window.WebGLCoreExt || !window.WebGLCoreExt.ComputeSimulator) {
      throw new Error('WebGLCoreExt.ComputeSimulator is required; inline grass wind is removed');
    }
    grassWindCompute = new window.WebGLCoreExt.ComputeSimulator({ getContext: function () { return gl; } });
    if (!grassWindCompute.isSupported()) throw new Error('GPU transform feedback is required for grass wind');
    var phases = new Float32Array(64);
    for (var p = 0; p < 64; p++) phases[p] = p * 0.73;
    var phaseBuffer = grassWindCompute.createBuffer('grass-wind-phase', phases, gl.STATIC_DRAW);
    var computeVertex = '#version 300 es\n' +
      'layout(location = 0) in float aPhase;\n' +
      'uniform float uTime;\n' +
      'out vec4 vOffset;\n' +
      'void main(){\n' +
      '  float s = sin(uTime * 1.25 + aPhase);\n' +
      '  vOffset = vec4(s * 0.11, 0.0, cos(uTime * 0.85 + aPhase) * 0.05, 1.0);\n' +
      '  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);\n' +
      '}';
    grassWindCompute.createComputeProgram('grass-wind', computeVertex, ['vOffset']);
    grassWindUBO = grassWindCompute.createBuffer('grass-wind-output', new Float32Array(64 * 4), gl.DYNAMIC_DRAW);
    grassWindCompute.createTransformFeedback('grass-wind-feedback', [grassWindUBO]);
    grassWindVAO = gl.createVertexArray();
    gl.bindVertexArray(grassWindVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, phaseBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    grassWindBlock = gl.getUniformBlockIndex(grassProgram, 'GrassWind');
    if (grassWindBlock === 0xFFFFFFFF) throw new Error('GrassWind UBO block is missing');
    gl.uniformBlockBinding(grassProgram, grassWindBlock, 1);
    markGraphics('gl-compute-post');
  }

  function updateGrassWind(time) {
    if (!grassWindCompute) return;
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 1, null);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(grassWindVAO);
    grassWindCompute.dispatch('grass-wind', 'grass-wind-feedback', 64, { uTime: time });
    gl.bindVertexArray(null);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 1, grassWindUBO);
    markGraphics('gl-compute-post');
  }

  function drawGrass(time) {
    if (!grassGroups.length && !terrainChunks.length) return;
    updateGrassWind(time);
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
      gl.bindVertexArray(g.mesh.vao);
      gl.drawElements(gl.TRIANGLES, g.mesh.count, gl.UNSIGNED_INT, 0);
    }
    for (var c = 0; c < terrainChunks.length; c++) {
      var chunk = terrainChunks[c];
      if (!chunk.grassMesh) continue;
      gl.bindVertexArray(chunk.grassMesh.vao);
      gl.drawElements(gl.TRIANGLES, chunk.grassMesh.count, gl.UNSIGNED_INT, 0);
    }
    if (detailGrassMesh) {
      gl.bindVertexArray(detailGrassMesh.vao);
      gl.drawElements(gl.TRIANGLES, detailGrassMesh.count, gl.UNSIGNED_INT, 0);
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
          this.behavior.context.bird = this;
          this.behavior.tick(dt);
          if (window.AevumMarkGraphics) window.AevumMarkGraphics('OrbBehavior');
        }
      };
      if (!window.OrbBehavior || !window.OrbBehavior.BehaviorTree || !window.OrbBehavior.Action) {
        throw new Error('OrbBehavior BehaviorTree/Action is required; inline bird patrol is removed');
      }
      bird.behavior = new window.OrbBehavior.BehaviorTree();
      bird.behavior.setRoot(new window.OrbBehavior.Action('bird-orbit-patrol', function (context, dt) {
        var b = context.bird;
        b.angle += dt * 0.45;
        b.position[0] = b.baseX + Math.sin(b.angle + b.phase) * 7;
        b.position[2] = b.baseZ + Math.cos(b.angle * 0.8 + b.phase) * 4;
        b.position[1] = b.height + Math.sin(b.angle * 2 + b.phase) * 1.2;
        b.yaw = -0.22 + Math.sin(b.angle * 0.5 + b.phase) * 0.12;
        b.boundingCenter = b.position;
        return window.OrbBehavior.NodeStatus.SUCCESS;
      }));
      birdObjects.push(bird);
      world.addObject(bird);
    }
  }

  function initBirdPicker() {
    if (!window.OrbInteraction || !window.OrbInteraction.Picker || !window.OrbInteraction.Pickable || !window.OrbMath) {
      throw new Error('OrbInteraction Picker/Pickable is required; inline bird picking is removed');
    }
    var Vec3 = window.OrbMath.Vec3;
    pickerCamera = {
      isPerspective: true,
      position: new Vec3(),
      projectionMatrixInverse: new window.OrbMath.Mat4()
    };
    birdPicker = new window.OrbInteraction.Picker(pickerCamera, canvasWorld);
    for (var i = 0; i < birdObjects.length; i++) {
      var bird = birdObjects[i];
      var pickable = new window.OrbInteraction.Pickable('bird-' + i, { bird: bird });
      pickable.enabled = true;
      birdPickables.push(pickable);
      birdPicker.addObject(pickable);
    }
    function onPointerPick(event) {
      if (!world || !world.camera || !world.camera.projectionMatrix) return;
      pickerCamera.position.set(eye[0], eye[1], eye[2]);
      var inverseProjection = M4.invert(M4.create(), world.camera.projectionMatrix);
      pickerCamera.projectionMatrixInverse.elements.set(inverseProjection);
      for (var p = 0; p < birdPickables.length; p++) {
        var b = birdObjects[p];
        var r = b.boundingRadius || 3;
        var v = [
          new Vec3(b.position[0] - r, b.position[1] - r, b.position[2] - r),
          new Vec3(b.position[0] + r, b.position[1] - r, b.position[2] - r),
          new Vec3(b.position[0] - r, b.position[1] + r, b.position[2] - r),
          new Vec3(b.position[0] + r, b.position[1] + r, b.position[2] - r),
          new Vec3(b.position[0] - r, b.position[1] - r, b.position[2] + r),
          new Vec3(b.position[0] + r, b.position[1] - r, b.position[2] + r),
          new Vec3(b.position[0] - r, b.position[1] + r, b.position[2] + r),
          new Vec3(b.position[0] + r, b.position[1] + r, b.position[2] + r)
        ];
        birdPickables[p].setBoundingFromVertices(v);
      }
      var hit = birdPicker.pickFirst(event.clientX, event.clientY);
      for (var b2 = 0; b2 < birdObjects.length; b2++) birdObjects[b2].glow = 0;
      if (hit && hit.object && hit.object.data && hit.object.data.bird) hit.object.data.bird.glow = 0.35;
      if (window.AevumMarkGraphics) window.AevumMarkGraphics('OrbInteraction');
    }
    canvasWorld.addEventListener('pointermove', onPointerPick, { passive: true });
    canvasWorld.addEventListener('pointerdown', onPointerPick, { passive: true });
  }

  function syncFireflies() {
    if (!fireflyMesh || !world) return;
    var night = world.dayNight && world.dayNight.isNight;
    if (night && fireflyObjects.length === 0) {
      if (!window.OrbPhysics || !window.OrbPhysics.Particle || !window.OrbMath) {
        throw new Error('OrbPhysics Particle/OrbMath is required; inline firefly motion is removed');
      }
      var Vec3 = window.OrbMath.Vec3;
      for (var i = 0; i < 14; i++) {
        var angle = Math.random() * Math.PI * 2;
        var radius = 4 + Math.random() * 18;
        var baseY = world.terrain.getHeight(Math.cos(angle) * radius, Math.sin(angle) * radius) + 0.4 + Math.random() * 2.0;
        var particle = new window.OrbPhysics.Particle(new Vec3(Math.cos(angle) * radius, baseY, Math.sin(angle) * radius), 1);
        var firefly = {
          mesh: fireflyMesh,
          scale: 0.055 + Math.random() * 0.035,
          color: [1.0, 0.78, 0.28],
          glow: 0.95,
          angle: angle,
          radius: radius,
          height: baseY,
          particle: particle,
          position: [particle.position.x, particle.position.y, particle.position.z],
          boundingCenter: [0, 0, 0],
          boundingRadius: 0.4,
          update: function (dt) {
            this.angle += dt * (0.25 + this.scale);
            var targetX = Math.cos(this.angle) * this.radius;
            var targetY = this.height + Math.sin(this.angle * 3.0) * 0.18;
            var targetZ = Math.sin(this.angle) * this.radius;
            this.particle.applyForce(new Vec3(
              (targetX - this.particle.position.x) * 14,
              (targetY - this.particle.position.y) * 10,
              (targetZ - this.particle.position.z) * 14
            ));
            this.particle.updateVerlet(dt, 0.82);
            this.position[0] = this.particle.position.x;
            this.position[1] = this.particle.position.y;
            this.position[2] = this.particle.position.z;
            this.boundingCenter = this.position;
            if (window.AevumMarkGraphics) window.AevumMarkGraphics('OrbPhysics');
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
    updatePlayerTags();
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
    drawGrass(now / 1000);
    drawWater();
    drawObjects();
    drawRemotePlayers();
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
    // 远景草并入同一套草 mesh/shader：只放在低处缓坡，避开山脊线，
    // 不再使用另一套不透明 instanced quad。
    for (var fgi = 0; fgi < 1600; fgi += 1) {
      var fga = Math.random() * Math.PI * 2;
      var fgr = 62 + Math.random() * 34;
      var fgx = Math.cos(fga) * fgr;
      var fgz = Math.sin(fga) * fgr - 16;
      var fgy = world.terrain.getHeight(fgx, fgz);
      if (fgy < WATER_LEVEL + 0.6 || fgy > 7.0) continue;
      var fgdx = world.terrain.getHeight(fgx + 1, fgz) - fgy;
      var fgdz = world.terrain.getHeight(fgx, fgz + 1) - fgy;
      if (Math.abs(fgdx) + Math.abs(fgdz) > 0.8) continue;
      grass.push({
        x: fgx, z: fgz, y: fgy,
        height: 0.20 + Math.random() * 0.30,
        width: 0.030 + Math.random() * 0.025,
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
    world.postProcessing.ssao.enabled = true;
    world.postProcessing.ssao.radius = 0.28;
    world.postProcessing.ssao.bias = 0.08;
    world.postProcessing.ssao.intensity = 0.55;
    world.postProcessing.ssao.range = 8;
    world.postProcessing.ssao.samples = 10;
    world.postProcessing.dof.enabled = true;
    world.postProcessing.dof.focusDistance = 18;
    world.postProcessing.dof.focusRange = 12;
    world.postProcessing.dof.blurAmount = 3;
    world.postProcessing.dof.strength = 1;
    world.postProcessing.chromaticAberration.enabled = true;
    world.postProcessing.chromaticAberration.amount = 0.0004;
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
    world.shadows.setQuality('high');
    world.shadows.setShadowDistance(180);
    document.documentElement.setAttribute('data-world3dext', String(!!window.World3DExt));
    document.documentElement.setAttribute('data-ext-core', String(!!(window.WebGLCore && window.WebGLCore.ShaderCompiler)));
    if (window.World3DExt) {
      fog = new window.World3DExt.VolumetricFog({ getContext: function () { return gl; } }, null);
      fog.setFogColor(0.62, 0.69, 0.76);
      fog.setFogDensity(0.0008);
      fog.setFogHeight(11);
      fog.setFogHeightFalloff(1.1);
      fog.setSunScatterIntensity(0.55);
      fog.setSunDirection(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]);

      if (window.WebGLCore && window.WebGLCore.ShaderCompiler) {
        extShaderCompiler = new window.WebGLCore.ShaderCompiler({ getContext: function () { return gl; } });
        var rawExtCompile = extShaderCompiler.compile.bind(extShaderCompiler);
        extShaderCompiler.compile = function (vs, fs, defines) {
          markGraphics('gl-extensions');
          document.documentElement.setAttribute('data-ext-compile', '1');
          return rawExtCompile(
            String(vs || '').replace(/^#version\s+300\s+es\s*/, ''),
            String(fs || '').replace(/^#version\s+300\s+es\s*/, ''),
            defines
          );
        };
        extShaderCompiler.use = function (p) { gl.useProgram(p); };
        extShaderCompiler.getAttributeLocation = function (p, name) { return attrib(p, name); };
        extShaderCompiler.setUniformMatrix4fv = function (p, name, value) {
          var loc = uniformLocation(p, name);
          if (loc) gl.uniformMatrix4fv(loc, false, value);
        };
        extShaderCompiler.setUniform1f = function (p, name, value) {
          var loc = uniformLocation(p, name);
          if (loc) gl.uniform1f(loc, value);
        };
        extShaderCompiler.setUniform1i = function (p, name, value) {
          var loc = uniformLocation(p, name);
          if (loc) gl.uniform1i(loc, value);
        };
        extShaderCompiler.setUniform2f = function (p, name, a, b) {
          var loc = uniformLocation(p, name);
          if (loc) gl.uniform2f(loc, a, b);
        };
        extShaderCompiler.setUniform3f = function (p, name, a, b, c) {
          var loc = uniformLocation(p, name);
          if (loc) gl.uniform3f(loc, a, b, c);
        };
      } else {
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
      }

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
      advancedWater.init();
      advancedWater.update(0);
      if (systemsEl) {
        systemsEl.textContent = 'TERRAIN STREAM 64m · WATER ' +
          advancedWater.getWaveCount() + ' WAVES · ' + world.weather.getCurrentWeather().toUpperCase();
      }
      document.documentElement.setAttribute('data-world3dext', String(!!window.World3DExt));
      document.documentElement.setAttribute('data-advanced-water', String(!!advancedWater));
    }
    setupWorldCamera();
    initRoamInput();
    initCameraInput();
    initNetwork();
    initWorldUI();
    avatarParts = makeAvatarMesh();

    skyMesh = makeSkySphere();
    terrainMesh = makeTerrainMesh(world.terrain);
    terrainChunks = [];
    updateTerrainStream(world.terrain, SPAWN[0], SPAWN[1]);
    waterMesh = makeWaterMesh();
    var nearTrees = trees.filter(function (t) { return Math.sqrt(t.x * t.x + t.z * t.z) < 135; });
    treeGroups = buildVegetationGroups(nearTrees, makeTreeMesh, 58);
    var nearGrass = grass.filter(function (g) { return Math.sqrt(g.x * g.x + g.z * g.z) < 58; });
    grassGroups = buildVegetationGroups(nearGrass, makeGrassMesh, 58);
    var farGrass = grass.filter(function (g) { return Math.sqrt(g.x * g.x + g.z * g.z) >= 58; });
    if (farGrass.length) {
      grassGroups = grassGroups.concat(buildVegetationGroups(farGrass, makeGrassMesh, 110));
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
    initBirdPicker();
    initGraphicsEntry();
    initGrassWindCompute();
    shadowMesh = makeShadowMesh();
    createShadowTarget();
    resizeWorldCanvas();
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
          if (postRenderTarget) {
            postRenderTarget.dispose();
            postRenderTarget = null;
            postFBO = null;
            postColorTex = null;
          } else if (postFBO) {
            gl.deleteFramebuffer(postFBO);
            gl.deleteTexture(postColorTex);
            postFBO = null;
            postColorTex = null;
          }
          createSceneTarget();
        },
        frame: function (now) { frame(now); }
      };
      window.AEVUM_WORLD_READY = true;
      requestAnimationFrame(frame);
      return;
    }

    initCharacterSkin();

    modelRenderer = new window.AEVUM.render.VRMRenderer(canvasModel, {
      clearColor: [0, 0, 0, 0],
      skinMaterial: skinMaterial,
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
    motionData = window.AEVUM.formats.parseGLB(await actionRes.arrayBuffer());
    player = window.AEVUM.formats.GLTFAnimation.createPlayer(motionData);
    hasIdleClip = player.clips.some(function (c) { return c.name === 'idle'; });
    document.documentElement.setAttribute('data-clips',
      player.clips.map(function (c) { return c.name; }).join(','));
    clip = player.clips.some(function (c) { return c.name === 'run'; }) ? 'run' : 'walk';
    player.setClip(clip).reset().setLoop(true).play();
    player.update(0.08);

    retarget = window.AEVUM.render.AnimationRetarget.retargetPose;

    var bounds = modelRenderer.bounds;
    var modelHeight = bounds.max[1] - bounds.min[1];
    modelBoundsMinY = bounds.min[1];
    charScale = 2.55 / Math.max(0.001, modelHeight);
    var ground = world.terrain.getHeight(SPAWN[0], SPAWN[1]);
    M4.fromTRS(modelMatrix, [SPAWN[0], ground - bounds.min[1] * charScale, SPAWN[1]], math.Q.fromAxisAngle(math.Q.create(), [0, 1, 0], 0), [charScale, charScale, charScale]);
    modelBaseY = modelMatrix[13];
    if (!window.OrbSkeleton || !window.OrbAnimation || !window.OrbAnimation.ProceduralMotion || !window.OrbAnimation.BreathingMotion) {
      throw new Error('OrbSkeleton/OrbAnimation is required; inline character breathing is removed');
    }
    proceduralSkeleton = new window.OrbSkeleton.Skeleton();
    proceduralChestBone = proceduralSkeleton.addBone('UpperBody', -1);
    proceduralMotion = new window.OrbAnimation.ProceduralMotion(proceduralSkeleton);
    proceduralMotion.register('breathing', window.OrbAnimation.BreathingMotion);
    proceduralMotion.play('breathing', { loop: true, weight: 1, fadeIn: 0.4 });

    statEl.textContent = clip.toUpperCase() + ' / ' + (vrm.humanBones || []).length + ' BONES';
    systemsEl.textContent = 'TERRAIN ' + TERRAIN_SIZE + '×' + TERRAIN_SIZE + ' · TREES ' + trees.length + ' · GRASS ' + grass.length + ' · WATER 8 · ' + world.weather.getCurrentWeather().toUpperCase() + ' · SHADOW ' + world.shadows.shadowMapSize + ' · POST FX';

    start = performance.now();
    last = start;
    var frameCount = 0;

    function resizeWorldCanvas() {
      var cw = Math.max(1, Math.round(canvasWorld.clientWidth || window.innerWidth || W));
      var ch = Math.max(1, Math.round(canvasWorld.clientHeight || window.innerHeight || H));
      var same = W === cw && H === ch && canvasWorld.width === cw && canvasWorld.height === ch;
      if (same && sceneFBO) return;
      W = cw;
      H = ch;
      canvasWorld.width = cw;
      canvasWorld.height = ch;
      var metaSize = document.getElementById('metaSize');
      if (metaSize) metaSize.textContent = cw + ' × ' + ch + ' / WEBGL2';
      if (sceneFBO) {
        gl.deleteFramebuffer(sceneFBO);
        gl.deleteTexture(sceneColorTex);
        gl.deleteTexture(sceneDepthTex);
        sceneFBO = null;
        sceneColorTex = null;
        sceneDepthTex = null;
      }
      if (postRenderTarget) {
        postRenderTarget.dispose();
        postRenderTarget = null;
        postFBO = null;
        postColorTex = null;
      } else if (postFBO) {
        gl.deleteFramebuffer(postFBO);
        gl.deleteTexture(postColorTex);
        postFBO = null;
        postColorTex = null;
      }
      createSceneTarget();
    }

    function frame(now) {
      frameCount += 1;
      resizeWorldCanvas();
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
      }
      updateRoamCharacter(dt);
      updateNetwork(dt);
      updateRoom(dt);
      if (player) player.update(dt);

      if (proceduralMotion) {
        proceduralChestBone.position.y = 0;
        proceduralMotion.update(dt);
        modelMatrix[13] = modelBaseY + proceduralChestBone.position.y * 2.0;
        if (window.AevumMarkGraphics) {
          window.AevumMarkGraphics('OrbSkeleton');
          window.AevumMarkGraphics('OrbAnimation');
        }
      }

      var pose = null;
      if (player && vrm && retarget) {
        pose = retarget(vrm, motionData.json, player.getPose(), {
          neutralStance: false,
          symmetricArms: false,
          footClearance: true,
          runPose: clip === 'run',
          greetPose: false,
          dt: dt
        });
      }

      renderWorld(now);
      fpsFrames++;
      if (now - fpsClock >= 1000) {
        document.documentElement.setAttribute('data-fps',
          String(Number((fpsFrames * 1000 / (now - fpsClock)).toFixed(1))));
        fpsFrames = 0;
        fpsClock = now;
      }
      if (systemsEl && frameCount % 20 === 0) {
        systemsEl.textContent = 'TERRAIN STREAM · TREES ' + trees.length + ' + ' +
          terrainChunks.length + ' CHUNK FORESTS · GRASS ' + grass.length +
          ' · WATER 8 · ' + world.weather.getCurrentWeather().toUpperCase() +
          ' · PARTICLES ' + world.weather.getParticles().length +
          ' · CHUNKS ' + terrainChunks.length +
          ' · SHADOW ' + world.shadows.shadowMapSize + ' · POST FX' +
          ' · ONLINE ' + netOnline;
      }
      window.AEVUM_WORLD_STATE = {
        weather: world.weather.getCurrentWeather(),
        particles: world.weather.getParticles().length,
        snow: world.weather.getSnowAccumulation(),
        cloud: world.weather.getCloudCoverage(),
        objects: world.objects.length,
        chunks: terrainChunks.length,
        farTrees: 0
      };
      if (modelRenderer && pose) {
        if (window.AevumMarkGraphics) window.AevumMarkGraphics('SpiritSkin');
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
