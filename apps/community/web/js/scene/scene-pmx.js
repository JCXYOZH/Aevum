/* PMX character pass for the 3D ground-grid scene. */
(function (global) {
  "use strict";

  var NS = global.AEVUM = global.AEVUM || {};
  var sceneNS = NS.scene = NS.scene || {};

  function encodePath(path) {
    return String(path).split("/").map(encodeURIComponent).join("/");
  }

  function attach(options) {
    var mount = options.mount;
    var scene = options.scene;
    var slotId = options.slotId || "guide";
    var url = options.modelUrl;
    var baseUrl = options.baseUrl || url.substring(0, url.lastIndexOf("/") + 1);
    if (!mount || !scene || !url) throw new Error("scene-pmx: mount, scene and modelUrl are required");
    var key = "__aevumPmx_" + slotId;
    if (mount[key]) return mount[key];

    var math = NS.math;
    var Render = NS.render || {};
    var formats = NS.formats || {};
    if (!math || !Render.WebGLRenderer || !formats.parsePMX) {
      throw new Error("scene-pmx: PMX renderer or parser is not loaded");
    }

    var canvas = document.createElement("canvas");
    canvas.className = "scene3d__characters";
    canvas.setAttribute("aria-hidden", "true");
    var characterMount = options.characterMount || mount;
    var overlay = mount.querySelector(".scene3d__overlay");
    if (overlay && characterMount === mount) mount.insertBefore(canvas, overlay);
    else characterMount.appendChild(canvas);

    var renderer = null;
    var model = null;
    var modelMatrix = null;
    var home = scene.slotWorld(slotId);
    var position = home ? [home[0], 0, home[2]] : [0, 0, 0];
    var target = null;
    var baseYaw = Number(options.yaw) || 0;
    var yaw = baseYaw;
    var speed = options.speed == null ? 1.8 : Math.max(0.2, Number(options.speed));
    var runMode = false;
    var runSpeed = options.runSpeed == null ? 3.2 : Math.max(0.2, Number(options.runSpeed));
    var runDistance = options.runDistance == null ? 5 : Math.max(0.5, Number(options.runDistance));
    var moving = false;
    var metrics = null;
    var look = options.look || null;
    var bindings = null;
    var startedAt = 0;
    var state = {
      status: "loading",
      renderer: null,
      model: null,
      label: "角色位 02",
      title: "",
      position: position.slice(),
      moving: false,
      running: false
    };

    function setStatus(text) {
      if (scene.setStatus) scene.setStatus(text);
    }

    function lerpAngle(from, to, alpha) {
      var delta = (to - from + Math.PI) % (Math.PI * 2);
      if (delta < 0) delta += Math.PI * 2;
      delta -= Math.PI;
      return from + delta * alpha;
    }

    function boundsOf(parsed) {
      var min = [Infinity, Infinity, Infinity];
      var max = [-Infinity, -Infinity, -Infinity];
      for (var i = 0; i < parsed.vertices.length; i += 1) {
        var p = parsed.vertices[i].position;
        for (var axis = 0; axis < 3; axis += 1) {
          if (p[axis] < min[axis]) min[axis] = p[axis];
          if (p[axis] > max[axis]) max[axis] = p[axis];
        }
      }
      return { min: min, max: max };
    }

    function metricsFor(parsed) {
      var b = boundsOf(parsed);
      var height = b.max[1] - b.min[1];
      if (!height || !isFinite(height)) height = 1;
      return {
        scale: (options.height || 1.75) / height,
        center: [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2]
      };
    }

    function placeMatrix(point, m, angle) {
      var matrix = math.M4.create();
      var c = Math.cos(angle);
      var s = Math.sin(angle);
      var scale = m.scale;
      var center = m.center;
      matrix[0] = c * scale;
      matrix[1] = 0;
      matrix[2] = -s * scale;
      matrix[3] = 0;
      matrix[4] = 0;
      matrix[5] = scale;
      matrix[6] = 0;
      matrix[7] = 0;
      matrix[8] = s * scale;
      matrix[9] = 0;
      matrix[10] = c * scale;
      matrix[11] = 0;
      matrix[12] = point[0] - (c * scale * center[0] + s * scale * center[2]);
      matrix[13] = point[1] - scale * center[1];
      matrix[14] = point[2] - (-s * scale * center[0] + c * scale * center[2]);
      matrix[15] = 1;
      return matrix;
    }

    function step(dt) {
      var stepDt = dt || 0;
      var wasMoving = moving;
      var wasRunning = moving && runMode;
      if (target) {
        var dx = target[0] - position[0];
        var dz = target[2] - position[2];
        var distance = Math.sqrt(dx * dx + dz * dz);
        if (distance > 0.01) {
          var distanceStep = Math.min(distance, (runMode ? runSpeed : speed) * Math.max(stepDt, 0.001));
          position[0] += dx / distance * distanceStep;
          position[2] += dz / distance * distanceStep;
          var desiredYaw = baseYaw + Math.atan2(dx, dz);
          yaw = lerpAngle(yaw, desiredYaw, 1 - Math.exp(-Math.max(stepDt, 0.001) * 7));
          moving = true;
        } else {
          position[0] = target[0];
          position[2] = target[2];
          target = null;
          runMode = false;
          moving = false;
        }
      } else {
        yaw = lerpAngle(yaw, baseYaw, 1 - Math.exp(-Math.max(stepDt, 0.001) * 3));
        runMode = false;
        moving = false;
      }
      state.position[0] = position[0];
      state.position[1] = position[1];
      state.position[2] = position[2];
      state.moving = moving;
      state.running = moving && runMode;
      state.yaw = yaw;
      if (wasMoving !== moving || wasRunning !== state.running) {
        if (state.running) setStatus(state.label + " · 跑步中");
        else if (moving) setStatus(state.label + " · 移动中");
        else if (state.title) setStatus(state.label + " · PMX / " + state.title);
        else setStatus(state.label + " · 待机");
      }
    }

    function sizeCanvas() {
      if (!scene.getSize) return;
      var size = scene.getSize();
      var dpr = size.dpr || global.devicePixelRatio || 1;
      var width = Math.max(1, Math.round((size.width || canvas.clientWidth) * dpr));
      var height = Math.max(1, Math.round((size.height || canvas.clientHeight) * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }

    function frame(now, dt) {
      if (!renderer || !model || !metrics) return;
      if (!startedAt) startedAt = now;
      sizeCanvas();
      step(dt);
      modelMatrix = placeMatrix(position, metrics, yaw);
      var t = (now - startedAt) / 1000;
      var pose;
      var animation = Render.ProceduralAnimation;
      if (animation && animation.makePMXPose) {
        pose = animation.makePMXPose(model, t, {
          state: moving ? (state.running ? "run" : "walk") : "idle",
          armDown: -1.05,
          armAxis: "z",
          look: look ? look.getLook() : null,
          bindings: bindings
        });
      } else {
        pose = Render.makeIdlePose(model, t);
      }
      renderer.render(t, pose, {
        viewProjection: scene.getViewProjection(),
        modelMatrix: modelMatrix,
        clearColor: [0, 0, 0, 0]
      });
    }

    function moveTo(point, moveOptions) {
      if (!point) return;
      var nextTarget = [
        Math.max(-18, Math.min(18, Number(point[0]) || 0)),
        0,
        Math.max(-18, Math.min(18, Number(point[2]) || 0))
      ];
      var distance = Math.hypot(nextTarget[0] - position[0], nextTarget[2] - position[2]);
      target = nextTarget;
      runMode = Boolean(moveOptions && moveOptions.run) || distance > runDistance;
    }

    function boot() {
      if (!home) throw new Error("scene-pmx: slot not found: " + slotId);
      canvas.hidden = true;
      setStatus("角色位 02 · 载入 PMX");
      renderer = new Render.WebGLRenderer(canvas, {
        context: { alpha: true, antialias: true },
        clearColor: [0, 0, 0, 0]
      });
      state.renderer = renderer;
      return fetch(url)
        .then(function (response) {
          if (!response.ok) throw new Error("PMX 加载失败 " + response.status + " · " + url);
          return response.arrayBuffer();
        })
        .then(function (buffer) {
          model = formats.parsePMX(buffer);
          state.model = model;
          var textureUrls = model.textures.map(function (texture) {
            return baseUrl + encodePath(texture.path);
          });
          return renderer.loadPMX(model, textureUrls);
        })
        .then(function () {
          metrics = metricsFor(model);
          var animation = Render.ProceduralAnimation;
          if (animation && animation.detectPMXBones) bindings = animation.detectPMXBones(model);
          modelMatrix = placeMatrix(position, metrics, yaw);
          canvas.hidden = false;
          state.status = "ready";
          var title = model.modelName || "已接入";
          state.title = title;
          if (scene.setSlotMeta) scene.setSlotMeta(slotId, "PMX / " + title);
          setStatus("角色位 02 · PMX / " + title);
          scene.onFrame(frame);
          return state;
        })
        .catch(function (error) {
          state.status = "error";
          state.error = error;
          canvas.hidden = true;
          setStatus("角色位 02 · PMX 加载失败");
          if (global.console) console.error("scene-pmx:", error);
          throw error;
        });
    }

    var handle = {
      canvas: canvas,
      ready: boot(),
      state: state,
      renderer: null,
      moveTo: moveTo,
      getPosition: function () { return state.position.slice(); }
    };
    mount[key] = handle;
    handle.ready.then(function () {
      handle.renderer = renderer;
    }, function () {});
    return handle;
  }

  sceneNS.attachPMX = attach;
})(window);
