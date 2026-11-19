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
    '    float coc=smoothstep(uDofFocus-uDofRange,uDofFocus+uDofRange,center);\n' +
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
    '    vec2 ca=(vUv-0.5)*uChroma*8.0;\n' +
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
  var fxaaQuadVAO = null;
  var postNow = 0;
  var postQuadVAO = null;
  var lightVP = M4.create();
  var lightVPs = [M4.create(), M4.create(), M4.create(), M4.create()];
  var shadowVPData = new Float32Array(16 * 4);

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
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(fxaaProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.uniform1i(uniformLocation(fxaaProgram, 'uTex'), 0);
    gl.uniform2f(uniformLocation(fxaaProgram, 'uTexel'), 1.0 / Math.max(1, W), 1.0 / Math.max(1, H));
    var chromatic = world && world.postProcessing ? world.postProcessing.chromaticAberration : null;
    gl.uniform1f(uniformLocation(fxaaProgram, 'uChroma'), chromatic && chromatic.enabled ? chromatic.amount : 0);
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

  