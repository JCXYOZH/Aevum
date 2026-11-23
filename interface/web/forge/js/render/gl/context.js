/* WebGL context + shader programs. One owner of gl state creation. */
(function (F) {
  "use strict";

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s));
    }
    return s;
  }

  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p));
    }
    return p;
  }

  function createContext(canvas) {
    const gl = canvas.getContext("webgl", { antialias: true, alpha: false, stencil: false })
      || canvas.getContext("experimental-webgl");
    if (!gl) throw new Error("WebGL unavailable");

    const shaders = F.render.shaders;
    const meshProg = program(gl, shaders.meshVertex, shaders.meshFragment);
    const lineProg = program(gl, shaders.lineVertex, shaders.lineFragment);
    const bgProg = program(gl, shaders.bgVertex, shaders.bgFragment);
    const gridProg = program(gl, shaders.gridVertex, shaders.gridFragment);
    const shadowProg = program(gl, shaders.shadowVertex, shaders.shadowFragment);

    return {
      canvas: canvas,
      gl: gl,
      meshProg: meshProg,
      lineProg: lineProg,
      bgProg: bgProg,
      gridProg: gridProg,
      shadowProg: shadowProg,
      meshLoc: {
        aPos: gl.getAttribLocation(meshProg, "aPos"),
        aNormal: gl.getAttribLocation(meshProg, "aNormal"),
        uVP: gl.getUniformLocation(meshProg, "uVP"),
        uModel: gl.getUniformLocation(meshProg, "uModel"),
        uNormal: gl.getUniformLocation(meshProg, "uNormal"),
        uColor: gl.getUniformLocation(meshProg, "uColor"),
        uEye: gl.getUniformLocation(meshProg, "uEye"),
        uAlpha: gl.getUniformLocation(meshProg, "uAlpha"),
        uFlat: gl.getUniformLocation(meshProg, "uFlat")
      },
      lineLoc: {
        aPos: gl.getAttribLocation(lineProg, "aPos"),
        uVP: gl.getUniformLocation(lineProg, "uVP"),
        uColor: gl.getUniformLocation(lineProg, "uColor"),
        uAlpha: gl.getUniformLocation(lineProg, "uAlpha")
      },
      bgLoc: {
        aPos: gl.getAttribLocation(bgProg, "aPos"),
        uAspect: gl.getUniformLocation(bgProg, "uAspect")
      },
      gridLoc: {
        aPos: gl.getAttribLocation(gridProg, "aPos"),
        uVP: gl.getUniformLocation(gridProg, "uVP"),
        uEye: gl.getUniformLocation(gridProg, "uEye")
      },
      shadowLoc: {
        aPos: gl.getAttribLocation(shadowProg, "aPos"),
        uVP: gl.getUniformLocation(shadowProg, "uVP"),
        uModel: gl.getUniformLocation(shadowProg, "uModel"),
        uAlpha: gl.getUniformLocation(shadowProg, "uAlpha")
      }
    };
  }

  F.render.createContext = createContext;
})(window.AEVUM.FORGE);
