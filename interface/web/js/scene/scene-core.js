/* Aevum 3D scene core.
   Uses engine/math.js for matrices and engine/world/pipeline for the orbit camera.
   The scene renders a ground grid in WebGL and projects DOM anchors onto it. */
(function (global) {
  "use strict";

  var A = global.AEVUM && global.AEVUM.math;
  var Camera = global.World3DEngine && global.World3DEngine.CameraController;
  var NS = global.AEVUM = global.AEVUM || {};

  if (!A || !Camera) {
    throw new Error("scene-core: engine math or World3DEngine.CameraController is missing");
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function compile(gl, type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      var message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error("scene-core shader: " + message);
    }
    return shader;
  }

  function createProgram(gl, vertexSource, fragmentSource) {
    var vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
    var fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    var program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      var message = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error("scene-core link: " + message);
    }
    return program;
  }

  var VERTEX = [
    "attribute vec2 aPos;",
    "void main() {",
    "  gl_Position = vec4(aPos, 0.0, 1.0);",
    "}"
  ].join("\n");

  function fragment(hasDerivatives) {
    var unit = hasDerivatives
      ? [
          "float gridLine(float v, float width) {",
          "  float d = abs(fract(v - 0.5) - 0.5) / max(fwidth(v), 0.0001);",
          "  return 1.0 - smoothstep(width - 0.5, width + 0.5, d);",
          "}"
        ].join("\n")
      : [
          "float gridLine(float v, float width) {",
          "  float d = abs(fract(v - 0.5) - 0.5);",
          "  return 1.0 - smoothstep(0.0, width * 0.035, d);",
          "}"
        ].join("\n");

    return [
      hasDerivatives ? "#extension GL_OES_standard_derivatives : enable" : "",
      "precision highp float;",
      "uniform mat4 uInvVP;",
      "uniform vec3 uCamPos;",
      "uniform vec2 uResolution;",
      "uniform float uOpacity;",
      unit,
      "void main() {",
      "  vec2 ndc = gl_FragCoord.xy / uResolution * 2.0 - 1.0;",
      "  vec4 nearP = uInvVP * vec4(ndc, -1.0, 1.0);",
      "  vec4 farP = uInvVP * vec4(ndc, 1.0, 1.0);",
      "  vec3 ro = uCamPos;",
      "  vec3 rd = normalize(farP.xyz / farP.w - nearP.xyz / nearP.w);",
      "  if (abs(rd.y) < 0.0001) discard;",
      "  float t = -ro.y / rd.y;",
      "  if (t <= 0.0) discard;",
      "  vec3 p = ro + rd * t;",
      "  float radius = length(p.xz);",
      "  float fade = (1.0 - smoothstep(24.0, 78.0, radius)) * (1.0 - smoothstep(60.0, 160.0, t));",
      "  float minor = max(gridLine(p.x * 1.0, 1.0), gridLine(p.z * 1.0, 1.0));",
      "  float major = max(gridLine(p.x * 0.2, 1.3), gridLine(p.z * 0.2, 1.3));",
      "  vec3 color = vec3(0.46, 0.36, 0.24);",
      "  float alpha = (minor * 0.22 + major * 0.34) * fade * uOpacity;",
      "  gl_FragColor = vec4(color, alpha);",
      "}"
    ].filter(Boolean).join("\n");
  }

  var BOARD_VERTEX = [
    "attribute vec3 aPos;",
    "attribute vec2 aUv;",
    "uniform mat4 uMVP;",
    "varying vec2 vUv;",
    "void main() {",
    "  vUv = aUv;",
    "  gl_Position = uMVP * vec4(aPos, 1.0);",
    "}"
  ].join("\n");

  var BOARD_FRAGMENT = [
    "precision highp float;",
    "uniform sampler2D uTexture;",
    "uniform float uOpacity;",
    "varying vec2 vUv;",
    "void main() {",
    "  vec4 texel = texture2D(uTexture, vUv);",
    "  float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));",
    "  vec3 frame = vec3(0.16, 0.13, 0.10);",
    "  vec3 color = mix(frame, texel.rgb, smoothstep(0.0, 0.012, edge));",
    "  float alpha = smoothstep(0.0, 0.006, edge);",
    "  gl_FragColor = vec4(color, alpha * uOpacity);",
    "}"
  ].join("\n");

  function project(matrix, point, width, height) {
    var x = matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12];
    var y = matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13];
    var z = matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14];
    var w = matrix[3] * point[0] + matrix[7] * point[1] + matrix[11] * point[2] + matrix[15];
    if (w <= 0.001) return null;
    return {
      x: (x / w * 0.5 + 0.5) * width,
      y: (1 - (y / w * 0.5 + 0.5)) * height,
      depth: w,
      clip: z / w
    };
  }

  // Column-major matrix product: out = a * b.
  function multiply(out, a, b) {
    for (var column = 0; column < 4; column += 1) {
      for (var row = 0; row < 4; row += 1) {
        out[column * 4 + row] =
          a[row] * b[column * 4] +
          a[4 + row] * b[column * 4 + 1] +
          a[8 + row] * b[column * 4 + 2] +
          a[12 + row] * b[column * 4 + 3];
      }
    }
  }

  function create(options) {
    var mount = options.mount;
    if (!mount) throw new Error("scene-core: mount is required");

    var nodes = options.nodes || [];
    var slots = options.slots || [];
    var onOpen = options.onOpen || function () {};
    var onSlot = options.onSlot || function () {};
    var onPick = options.onPick || function () {};
    var onGround = options.onGround || function () {};
    var nodePickEnabled = options.nodePick !== false;
    var nodeLabelsEnabled = options.nodeLabels !== false;
    var mounted = false;
    var canvas = null;
    var gl = null;
    var program = null;
    var buffer = null;
    var locations = {};
    var camera = new Camera();
    var inverse = new Float32Array(16);
    var viewMatrix = new Float32Array(16);
    var projectionMatrix = new Float32Array(16);
    var viewProjection = new Float32Array(16);
    var cameraPosition = new Float32Array(3);
    var opacity = options.opacity == null ? 0.9 : options.opacity;
    var groundVisible = options.ground !== false;
    var groundHeight = typeof options.groundHeight === "function" ? options.groundHeight : null;
    var width = 0;
    var height = 0;
    var dpr = 1;
    var frameId = 0;
    var lastTime = 0;
    var readout = null;
    var cursor = null;
    var nodeElements = [];
    var slotElements = [];
    var drag = null;
    var frameHooks = [];
    var boardProgram = null;
    var boardBuffer = null;
    var boardLocations = {};
    var boardTexture = null;
    var boardVisible = false;
    var pendingBackdrop = null;

    camera.mode = "orbit";
    camera.target = [0, 0, 0];
    camera.rotationX = 0.52;
    camera.rotationY = 0.28;
    camera.distance = 14;
    camera.minDistance = 4;
    camera.maxDistance = 34;
    camera.fov = 48;
    camera.rotateSpeed = 0.005;
    camera.update(0);

    function updateMatrices() {
      A.M4.lookAt(viewMatrix, camera.position, camera.target, camera.up);
      A.M4.perspective(projectionMatrix, camera.fov * Math.PI / 180, camera.aspect, camera.near, camera.far);
      multiply(viewProjection, projectionMatrix, viewMatrix);
    }

    function boardGeometry(image) {
      var aspect = image.naturalWidth / Math.max(1, image.naturalHeight);
      var boardHeight = 5.4;
      var boardWidth = boardHeight * aspect;
      if (boardWidth > 16) {
        boardWidth = 16;
        boardHeight = boardWidth / aspect;
      }
      if (boardHeight > 7.4) {
        boardHeight = 7.4;
        boardWidth = boardHeight * aspect;
      }
      var z = -8.5;
      var bottom = 0.2;
      var top = bottom + boardHeight;
      var left = -boardWidth / 2;
      var right = boardWidth / 2;
      return [
        left, bottom, z, 0, 0,
        right, bottom, z, 1, 0,
        left, top, z, 0, 1,
        right, bottom, z, 1, 0,
        right, top, z, 1, 1,
        left, top, z, 0, 1
      ];
    }

    function drawBackdrop() {
      if (!boardVisible || !boardTexture || !boardProgram || !boardBuffer) return;
      if (boardLocations.aPos < 0 || boardLocations.aUv < 0) return;
      gl.useProgram(boardProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, boardBuffer);
      gl.enableVertexAttribArray(boardLocations.aPos);
      gl.enableVertexAttribArray(boardLocations.aUv);
      gl.vertexAttribPointer(boardLocations.aPos, 3, gl.FLOAT, false, 20, 0);
      gl.vertexAttribPointer(boardLocations.aUv, 2, gl.FLOAT, false, 20, 12);
      gl.uniformMatrix4fv(boardLocations.uMVP, false, viewProjection);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, boardTexture);
      gl.uniform1i(boardLocations.uTexture, 0);
      gl.uniform1f(boardLocations.uOpacity, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function setBackdrop(source) {
      pendingBackdrop = source || null;
      if (!gl || !boardProgram) return Promise.resolve(false);
      if (!source) {
        boardVisible = false;
        pendingBackdrop = null;
        draw();
        return Promise.resolve(true);
      }
      return new Promise(function (resolve) {
        var image = new Image();
        image.onload = function () {
          if (!boardTexture) boardTexture = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, boardTexture);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
          } catch (error) {
            if (global.console) console.error("setBackdrop:", error);
            resolve(false);
            return;
          }
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          if (!boardBuffer) boardBuffer = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, boardBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(boardGeometry(image)), gl.STATIC_DRAW);
          boardVisible = true;
          pendingBackdrop = null;
          draw();
          resolve(true);
        };
        image.onerror = function () {
          pendingBackdrop = null;
          resolve(false);
        };
        image.src = source;
      });
    }

    function clearBackdrop() {
      boardVisible = false;
      pendingBackdrop = null;
      draw();
    }

    // The ground is a single plane at y=0. Keep the orbit camera just above it
    // so a downward drag cannot put the eye underneath the plane and erase the grid.
    function clampCamera() {
      if (camera.mode !== "orbit") return;
      var minPitch = 0.055;
      if (camera.rotationX < minPitch) camera.rotationX = minPitch;
      var eyeY = camera.target[1] + camera.distance * Math.sin(camera.rotationX);
      if (eyeY < 0.18) camera.rotationX = Math.asin((0.18 - camera.target[1]) / camera.distance);
    }

    function createElement(tag, className, parent) {
      var el = document.createElement(tag);
      el.className = className;
      if (parent) parent.appendChild(el);
      return el;
    }

    function createOverlay() {
      var overlay = createElement("div", "scene3d__overlay", mount);
      var tools = createElement("div", "scene3d__tools", mount);
      var focus = createElement("button", "scene3d__tool", tools);
      focus.type = "button";
      focus.dataset.sceneView = "focus";
      focus.textContent = "沉浸";
      var viewAngle = createElement("button", "scene3d__tool", tools);
      viewAngle.type = "button";
      viewAngle.dataset.sceneView = "angle";
      viewAngle.textContent = "斜视";
      var viewTop = createElement("button", "scene3d__tool", tools);
      viewTop.type = "button";
      viewTop.dataset.sceneView = "top";
      viewTop.textContent = "俯视";
      var viewLow = createElement("button", "scene3d__tool", tools);
      viewLow.type = "button";
      viewLow.dataset.sceneView = "low";
      viewLow.textContent = "仰视";
      var reset = createElement("button", "scene3d__tool", tools);
      reset.type = "button";
      reset.dataset.sceneView = "reset";
      reset.textContent = "重置";
      readout = createElement("span", "scene3d__readout", mount);
      readout.textContent = "拖拽旋转 · 滚轮缩放 · 点击地面移动角色";
      cursor = createElement("span", "scene3d__cursor", mount);
      cursor.hidden = true;
      return overlay;
    }

    function setView(name) {
      var focus = mount.querySelector('[data-scene-view="focus"]');
      if (name === "focus") {
        var desk = mount.parentElement;
        var active = desk.classList.toggle("scene-focus");
        if (focus) focus.textContent = active ? "返回桌面" : "沉浸";
        if (active) {
          camera.rotationX = 0.52;
          camera.rotationY = 0.28;
          camera.distance = 14;
          camera.update(0);
        }
        draw();
        updateAnchors();
        return;
      }
      if (name === "top") {
        camera.rotationX = 1.16;
        camera.distance = 15;
      } else if (name === "low") {
        camera.rotationX = 0.075;
        camera.distance = 12;
      } else if (name === "angle") {
        camera.rotationX = 0.52;
        camera.distance = 14;
      } else {
        camera.rotationX = 0.52;
        camera.rotationY = 0.28;
        camera.distance = 14;
      }
      camera.update(0);
      draw();
      updateAnchors();
    }

    function worldForGrid(grid) {
      var x = grid[0] * 2.0;
      var z = grid[1] * 2.0;
      return [x, groundHeight ? groundHeight(x, z) + 0.02 : 0.05, z];
    }

    function layout() {
      var overlay = mount.querySelector(".scene3d__overlay");
      if (!overlay) return;
      nodeElements.forEach(function (item) { item.el.remove(); });
      slotElements.forEach(function (item) { item.el.remove(); });
      nodeElements = [];
      slotElements = [];

      nodes.forEach(function (node) {
        if (!nodeLabelsEnabled) return;
        var el = createElement("button", "scene-node scene-node--" + (node.tone || "amber"), overlay);
        el.type = "button";
        el.dataset.sceneNode = node.id;
        el.tabIndex = nodePickEnabled ? 0 : -1;
        el.innerHTML =
          '<span class="scene-node__mark"></span>' +
          '<span class="scene-node__copy"><span class="scene-node__title">' +
          escapeHtml(node.title) + '</span><span class="scene-node__meta">' +
          escapeHtml(node.meta || "") + '</span></span>';
        el.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          onOpen(node.id);
        });
        nodeElements.push({ node: node, el: el, world: worldForGrid(node.grid) });
      });

      slots.forEach(function (slot) {
        var el = createElement("button", "scene-slot", overlay);
        el.type = "button";
        el.dataset.sceneSlot = slot.id;
        el.innerHTML =
          '<span class="scene-slot__ring"></span>' +
          '<span class="scene-slot__label">' + escapeHtml(slot.title) + '</span>' +
          '<span class="scene-slot__meta">' + escapeHtml(slot.meta || "角色位") + '</span>';
        el.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          onSlot(slot);
        });
        slotElements.push({ slot: slot, el: el, world: worldForGrid(slot.grid) });
      });
    }

    function escapeHtml(value) {
      return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function setStatus(text) {
      if (readout) readout.textContent = text;
    }

    function updateAnchors() {
      if (!mounted) return;
      var matrix = viewProjection;
      var rectWidth = mount.clientWidth;
      var rectHeight = mount.clientHeight;

      nodeElements.forEach(function (item) {
        var point = project(matrix, item.world, rectWidth, rectHeight);
        if (!point || point.clip < -1.2 || point.clip > 1.2) {
          item.el.hidden = true;
          return;
        }
        item.el.hidden = false;
        item.el.style.left = point.x + "px";
        item.el.style.top = point.y + "px";
        item.el.style.opacity = String(clamp(1.25 - point.depth / 40, 0.45, 1));
        item.el.style.zIndex = String(1000 + Math.round(400 - point.depth * 10));
      });

      slotElements.forEach(function (item) {
        var point = project(matrix, item.world, rectWidth, rectHeight);
        if (!point || point.clip < -1.2 || point.clip > 1.2) {
          item.el.hidden = true;
          return;
        }
        item.el.hidden = false;
        item.el.style.left = point.x + "px";
        item.el.style.top = point.y + "px";
        item.el.style.opacity = String(clamp(1.1 - point.depth / 50, 0.4, 0.9));
      });
    }

    function draw() {
      if (!gl || !program) return;
      updateMatrices();
      A.M4.invert(inverse, viewProjection);
      cameraPosition[0] = camera.position[0];
      cameraPosition[1] = camera.position[1];
      cameraPosition[2] = camera.position[2];

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!groundVisible) {
        drawBackdrop();
        return;
      }
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(locations.aPos);
      gl.vertexAttribPointer(locations.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(locations.uInvVP, false, inverse);
      gl.uniform3fv(locations.uCamPos, cameraPosition);
      gl.uniform2f(locations.uResolution, canvas.width, canvas.height);
      gl.uniform1f(locations.uOpacity, opacity);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      drawBackdrop();
    }

    function resize() {
      var rect = mount.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      dpr = Math.min(global.devicePixelRatio || 1, 1.7);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      camera.setAspect(width / height);
      camera.update(0);
      draw();
      updateAnchors();
    }

    function loop(now) {
      frameId = global.requestAnimationFrame(loop);
      var dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
      lastTime = now;
      clampCamera();
      camera.update(dt);
      draw();
      frameHooks.forEach(function (hook) {
        try { hook(now, dt); } catch (error) { if (global.console) console.error(error); }
      });
      updateAnchors();
    }

    function screenRay(clientX, clientY) {
      var rect = mount.getBoundingClientRect();
      var ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      var ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;
      var m = inverse;
      function unproject(z) {
        var x = m[0] * ndcX + m[4] * ndcY + m[8] * z + m[12];
        var y = m[1] * ndcX + m[5] * ndcY + m[9] * z + m[13];
        var w = m[3] * ndcX + m[7] * ndcY + m[11] * z + m[15];
        return [x / w, y / w, (m[2] * ndcX + m[6] * ndcY + m[10] * z + m[14]) / w];
      }
      var near = unproject(-1);
      var far = unproject(1);
      var origin = [camera.position[0], camera.position[1], camera.position[2]];
      var direction = [far[0] - near[0], far[1] - near[1], far[2] - near[2]];
      if (Math.abs(direction[1]) < 0.0001) return null;
      var t = -origin[1] / direction[1];
      if (t <= 0) return null;
      var point = [origin[0] + direction[0] * t, 0, origin[2] + direction[2] * t];
      if (groundHeight) {
        for (var step = 0; step < 5; step += 1) {
          var h = groundHeight(point[0], point[2]);
          t = (h - origin[1]) / direction[1];
          if (t <= 0) return null;
          point = [origin[0] + direction[0] * t, h, origin[2] + direction[2] * t];
        }
      }
      return point;
    }

    function showCursor(point) {
      if (!point) return;
      var projected = project(viewProjection, [point[0], point[1] + 0.02, point[2]], width, height);
      if (!projected) return;
      cursor.hidden = false;
      cursor.style.left = projected.x + "px";
      cursor.style.top = projected.y + "px";
      global.clearTimeout(showCursor.timer);
      showCursor.timer = global.setTimeout(function () { cursor.hidden = true; }, 700);
    }

    function pick(clientX, clientY, sourceEvent) {
      var point = screenRay(clientX, clientY);
      if (!point) {
        readout.textContent = "已到网格边缘";
        return;
      }
      showCursor(point);
      var nearest = null;
      var nearestDistance = 2.1;
      nodes.forEach(function (node) {
        var world = [node.grid[0] * 2.0, 0, node.grid[1] * 2.0];
        var distance = Math.hypot(point[0] - world[0], point[2] - world[2]);
        if (distance < nearestDistance) {
          nearest = node;
          nearestDistance = distance;
        }
      });
      if (nodePickEnabled && nearest) {
        readout.textContent = "选中：" + nearest.title;
        onPick(nearest);
        onOpen(nearest.id);
        return;
      }
      readout.textContent = "网格 " + point[0].toFixed(1) + " / " + point[2].toFixed(1);
      onPick(null);
      onGround(point, sourceEvent);
    }

    function bindPointer() {
      canvas.addEventListener("pointerdown", function (event) {
        if (event.button !== 0) return;
        drag = { x: event.clientX, y: event.clientY, moved: false };
        canvas.setPointerCapture(event.pointerId);
      });
      canvas.addEventListener("pointermove", function (event) {
        if (!drag) return;
        var dx = event.clientX - drag.x;
        var dy = event.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) {
          camera.orbit(dx, dy);
          clampCamera();
          camera.update(0);
          drag.x = event.clientX;
          drag.y = event.clientY;
          draw();
          updateAnchors();
        }
      });
      canvas.addEventListener("pointerup", function (event) {
        if (!drag) return;
        var current = drag;
        drag = null;
        if (!current.moved) pick(event.clientX, event.clientY, event);
      });
      canvas.addEventListener("pointercancel", function () { drag = null; });
      canvas.addEventListener("wheel", function (event) {
        event.preventDefault();
        camera.zoom(event.deltaY * 0.018);
        draw();
        updateAnchors();
      }, { passive: false });
      canvas.addEventListener("dblclick", function () { setView("reset"); });
    }

    function bindTools() {
      mount.querySelectorAll("[data-scene-view]").forEach(function (button) {
        button.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          setView(button.dataset.sceneView);
        });
      });
      document.addEventListener("keydown", function (event) {
        if (event.key !== "Escape") return;
        var desk = mount.parentElement;
        if (!desk || !desk.classList.contains("scene-focus")) return;
        setView("focus");
      });
    }

    function mountScene() {
      if (mounted) return api;
      mounted = true;
      mount.classList.add("has-scene");
      mount.parentElement && mount.parentElement.classList.add("has-scene");

      canvas = createElement("canvas", "scene3d__canvas", mount);
      var context = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true }) ||
        canvas.getContext("experimental-webgl", { antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
      if (!context) {
        mount.classList.add("scene3d--fallback");
        layout();
        readout = createElement("span", "scene3d__readout", mount);
        readout.textContent = "当前浏览器不支持 WebGL，显示平面索引";
        return api;
      }
      gl = context;
      var derivatives = gl.getExtension("OES_standard_derivatives");
      try {
        program = createProgram(gl, VERTEX, fragment(Boolean(derivatives)));
      } catch (error) {
        mount.classList.add("scene3d--fallback");
        if (global.console) console.error(error);
        layout();
        return api;
      }
      locations = {
        aPos: gl.getAttribLocation(program, "aPos"),
        uInvVP: gl.getUniformLocation(program, "uInvVP"),
        uCamPos: gl.getUniformLocation(program, "uCamPos"),
        uResolution: gl.getUniformLocation(program, "uResolution"),
        uOpacity: gl.getUniformLocation(program, "uOpacity")
      };
      try {
        boardProgram = createProgram(gl, BOARD_VERTEX, BOARD_FRAGMENT);
        boardLocations = {
          aPos: gl.getAttribLocation(boardProgram, "aPos"),
          aUv: gl.getAttribLocation(boardProgram, "aUv"),
          uMVP: gl.getUniformLocation(boardProgram, "uMVP"),
          uTexture: gl.getUniformLocation(boardProgram, "uTexture"),
          uOpacity: gl.getUniformLocation(boardProgram, "uOpacity")
        };
      } catch (error) {
        boardProgram = null;
        if (global.console) console.error("scene-core backdrop:", error);
      }
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      createOverlay();
      layout();
      bindPointer();
      bindTools();
      resize();
      if (pendingBackdrop) {
        var backdrop = pendingBackdrop;
        pendingBackdrop = null;
        setBackdrop(backdrop);
      }
      if (global.ResizeObserver) {
        new ResizeObserver(resize).observe(mount);
      } else {
        global.addEventListener("resize", resize);
      }
      if (document.hidden) {
        document.addEventListener("visibilitychange", function () {
          if (!document.hidden) {
            lastTime = 0;
            frameId = global.requestAnimationFrame(loop);
          }
        });
      }
      frameId = global.requestAnimationFrame(loop);
      return api;
    }

    function refresh(nextNodes, nextSlots) {
      if (nextNodes) nodes = nextNodes;
      if (nextSlots) slots = nextSlots;
      layout();
      updateAnchors();
    }

    var api = {
      mount: mountScene,
      refresh: refresh,
      setView: setView,
      setStatus: setStatus,
      camera: camera,
      screenRay: screenRay,
      project: function (world) { return project(viewProjection, world, width, height); },
      getViewProjection: function () { return viewProjection; },
      getSize: function () { return { width: width, height: height, dpr: dpr }; },
      setGroundVisible: function (visible) {
        groundVisible = Boolean(visible);
        draw();
      },
      setGroundHeight: function (heightFn) {
        groundHeight = typeof heightFn === "function" ? heightFn : null;
        layout();
        updateAnchors();
      },
      hasGroundHeight: function () { return Boolean(groundHeight); },
      setBackdrop: setBackdrop,
      clearBackdrop: clearBackdrop,
      hasBackdrop: function () { return boardVisible; },
      slotWorld: function (id) {
        for (var i = 0; i < slots.length; i += 1) {
          if (slots[i].id === id) return worldForGrid(slots[i].grid);
        }
        return null;
      },
      setSlotMeta: function (id, meta) {
        slots.forEach(function (slot) {
          if (slot.id === id) slot.meta = meta;
        });
        slotElements.forEach(function (item) {
          if (item.slot.id !== id) return;
          item.slot.meta = meta;
          var label = item.el.querySelector(".scene-slot__meta");
          if (label) label.textContent = meta;
        });
      },
      onFrame: function (hook) {
        if (typeof hook !== "function") return function () {};
        frameHooks.push(hook);
        return function () {
          var index = frameHooks.indexOf(hook);
          if (index >= 0) frameHooks.splice(index, 1);
        };
      },
      onGround: function (hook) {
        if (typeof hook !== "function") return function () {};
        onGround = hook;
        return function () { onGround = function () {}; };
      }
    };
    return api;
  }

  NS.scene = { create: create, project: project };
})(window);
