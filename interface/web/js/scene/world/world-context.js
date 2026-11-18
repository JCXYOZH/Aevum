

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

  