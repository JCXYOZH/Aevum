/* GLSL sources. Kept separate from context creation so shading can be swapped. */
(function (F) {
  "use strict";

  F.render = F.render || {};
  F.render.shaders = {
    meshVertex: `
attribute vec3 aPos; attribute vec3 aNormal;
uniform mat4 uVP; uniform mat4 uModel; uniform mat3 uNormal;
varying vec3 vN;
void main(){
  vN=normalize(uNormal*aNormal);
  gl_Position=uVP*uModel*vec4(aPos,1.0);
}`,
    meshFragment: `
precision mediump float;
varying vec3 vN;
uniform vec3 uColor;
void main(){
  vec3 n=normalize(vN);
  vec3 L=normalize(vec3(0.45,0.85,-0.35));
  float d=max(dot(n,L),0.0);
  vec3 c=uColor*(0.34+0.66*d);
  c+=vec3(0.08,0.12,0.14)*pow(1.0-abs(n.z),2.0);
  gl_FragColor=vec4(c,1.0);
}`,
    lineVertex: `
attribute vec3 aPos; uniform mat4 uVP;
void main(){ gl_Position=uVP*vec4(aPos,1.0); }`,
    lineFragment: `
precision mediump float; uniform vec3 uColor;
void main(){ gl_FragColor=vec4(uColor,0.35); }`
  };
})(window.AEVUM.FORGE);
