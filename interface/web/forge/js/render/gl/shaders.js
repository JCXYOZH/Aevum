/* GLSL sources. Kept separate from context creation so shading can be swapped. */
(function (F) {
  "use strict";

  F.render = F.render || {};
  F.render.shaders = {
    bgVertex: `
attribute vec2 aPos; varying vec2 vUV;
void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }`,
    bgFragment: `
precision mediump float;
varying vec2 vUV; uniform float uAspect;
void main(){
  vec2 p=vUV;
  float r=length((p-vec2(0.5))*vec2(uAspect,1.0));
  vec3 top=vec3(0.055,0.068,0.082);
  vec3 bottom=vec3(0.020,0.026,0.032);
  vec3 col=mix(bottom,top,p.y);
  col*=1.0-0.20*smoothstep(0.30,0.95,r);
  gl_FragColor=vec4(col,1.0);
}`,

    meshVertex: `
attribute vec3 aPos; attribute vec3 aNormal;
uniform mat4 uVP; uniform mat4 uModel; uniform mat3 uNormal;
varying vec3 vN; varying vec3 vWorld;
void main(){
  vN=normalize(uNormal*aNormal);
  vec4 w=uModel*vec4(aPos,1.0);
  vWorld=w.xyz;
  gl_Position=uVP*w;
}`,
    meshFragment: `
precision mediump float;
varying vec3 vN; varying vec3 vWorld;
uniform vec3 uColor; uniform vec3 uEye; uniform float uAlpha; uniform float uFlat;
void main(){
  if(uFlat>0.5){ gl_FragColor=vec4(uColor,uAlpha); return; }
  vec3 n=normalize(vN);
  vec3 V=normalize(uEye-vWorld);
  vec3 L1=normalize(vec3(0.35,0.82,0.46));
  vec3 L2=normalize(vec3(-0.65,0.25,0.55));
  float d1=max(dot(n,L1),0.0);
  float d2=max(dot(n,L2),0.0);
  float key=0.24+0.58*d1+0.20*d2;
  float spec=pow(max(dot(reflect(-L1,n),V),0.0),26.0)*0.55;
  float fres=pow(1.0-max(dot(n,V),0.0),3.0);
  vec3 c=uColor*key
    + vec3(0.24,0.30,0.36)*spec
    + vec3(0.10,0.15,0.18)*fres*0.55;
  gl_FragColor=vec4(c,uAlpha);
}`,

    lineVertex: `
attribute vec3 aPos; uniform mat4 uVP;
void main(){ gl_Position=uVP*vec4(aPos,1.0); }`,
    lineFragment: `
precision mediump float; uniform vec3 uColor; uniform float uAlpha;
void main(){ gl_FragColor=vec4(uColor,uAlpha); }`,

    gridVertex: `
attribute vec3 aPos; uniform mat4 uVP; varying vec3 vWorld;
void main(){ vWorld=aPos; gl_Position=uVP*vec4(aPos,1.0); }`,
    gridFragment: `
precision mediump float;
varying vec3 vWorld; uniform vec3 uEye;
float gridLine(vec2 p,float s,float w){
  vec2 q=abs(fract(p/s+0.5)-0.5)*s;
  float d=min(q.x,q.y);
  return 1.0-smoothstep(w,w*1.8,d);
}
void main(){
  vec2 p=vWorld.xz;
  float minor=gridLine(p,0.25,0.007);
  float major=gridLine(p,1.00,0.013);
  float dist=length(vWorld.xz-uEye.xz);
  float fade=1.0-smoothstep(4.0,18.0,dist);
  vec3 col=vec3(0.022,0.029,0.036);
  col=mix(col,vec3(0.075,0.10,0.12),minor*fade*0.30);
  col=mix(col,vec3(0.14,0.18,0.22),major*fade*0.55);
  float axisX=1.0-smoothstep(0.0,0.006,abs(p.y));
  float axisZ=1.0-smoothstep(0.0,0.006,abs(p.x));
  col=mix(col,vec3(0.26,0.13,0.15),axisX*fade*0.38);
  col=mix(col,vec3(0.10,0.16,0.28),axisZ*fade*0.42);
  gl_FragColor=vec4(col,1.0);
}`,

    shadowVertex: `
attribute vec3 aPos; uniform mat4 uVP; uniform mat4 uModel; varying vec2 vP;
void main(){ vP=aPos.xz; gl_Position=uVP*uModel*vec4(aPos,1.0); }`,
    shadowFragment: `
precision mediump float; varying vec2 vP; uniform float uAlpha;
void main(){
  float r=length(vP);
  float a=(1.0-smoothstep(0.18,1.0,r))*uAlpha;
  gl_FragColor=vec4(0.0,0.0,0.0,a);
}`
  };
})(window.AEVUM.FORGE);
