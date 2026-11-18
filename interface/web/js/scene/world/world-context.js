

  var math = window.AEVUM.math;
  var M4 = math.M4;
  var canvasWorld = document.getElementById('worldCanvas');
  var canvasModel = document.getElementById('model');
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
    var el = document.getElementById('liveState'); var ld = document.getElementById('loading');
    if (ld) {
      ld.style.display = 'block';
      var line = ld.querySelector('div');
      if (line) line.textContent = 'ERROR / ' + String(e.message || e.error || 'unknown');
    }
    if (el) { el.textContent = 'ERROR ' + e.message; el.style.color = '#ff5a5a'; }
  });
  window.addEventListener('unhandledrejection', function (e) {
    var ld = document.getElementById('loading');
    if (ld) {
      ld.style.display = 'block';
      var line = ld.querySelector('div');
      if (line) line.textContent = 'REJECTED / ' + String(e.reason && (e.reason.message || e.reason));
    }
  });

  var W = 1600;
  var H = 900;
  var FOV = 42 * Math.PI / 180;
  var TERRAIN_SIZE = 200;
  var WATER_LEVEL = -3.2;
  var WEATHER_MODE = new URLSearchParams(window.location.search || '').get('weather') || ((window.location.search || '').indexOf('rain') >= 0 ? 'rain' : 'clear');
  var SUN_DIR = normalize3([-0.35, 0.44, -0.83]);
  var SPAWN = [0, 0];
  var LAKE = [0, -52];

  function setReady(text) {
    document.body.classList.add('is-ready');
    stateEl.textContent = text;
    setTimeout(function () { loading.style.display = 'none'; }, 500);
  }
  function fail(error) {
    console.error(error);
    stateEl.textContent = 'FAIL';
    statEl.textContent = String(error && error.message || error);
    loading.querySelector('div').textContent = 'LOAD FAILED / ' + String(error && error.message || error);
    loading.style.opacity = 1;
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

  