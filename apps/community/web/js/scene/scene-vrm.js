/* VRM character pass for the 3D ground-grid scene.
   It draws into its own transparent WebGL2 canvas and shares the scene's
   viewProjection, so the model stands on the same y=0 grid as the nodes. */
(function (global) {
  "use strict";

  var NS = global.AEVUM = global.AEVUM || {};
  var sceneNS = NS.scene = NS.scene || {};

  function attach(options) {
    var mount = options.mount;
    var scene = options.scene;
    var slotId = options.slotId || "host";
    var url = options.modelUrl;
    if (!mount || !scene || !url) throw new Error("scene-vrm: mount, scene and modelUrl are required");
    if (mount.__aevumVrm) return mount.__aevumVrm;

    var math = NS.math;
    var Render = NS.render || {};
    var formats = NS.formats || {};
    if (!math || !Render.VRMRenderer || !formats.parseVRM) {
      throw new Error("scene-vrm: VRM renderer or parser is not loaded");
    }

    var canvas = document.createElement("canvas");
    canvas.className = "scene3d__characters";
    canvas.setAttribute("aria-hidden", "true");
    var overlay = mount.querySelector(".scene3d__overlay");
    if (overlay) mount.insertBefore(canvas, overlay);
    else mount.appendChild(canvas);

    var renderer = null;
    var vrm = null;
    var modelMatrix = null;
    var home = scene.slotWorld(slotId);
    var position = home ? [home[0], 0, home[2]] : [0, 0, 0];
    var target = null;
    var baseYaw = Number(options.yaw) || 0;
    var yaw = baseYaw;
    var speed = options.speed == null ? 1.8 : Math.max(0.2, Number(options.speed));
    var moving = false;
    var metrics = null;
    var look = options.look || null;
    var bindings = null;
    var startedAt = 0;
    var state = {
      status: "loading",
      renderer: null,
      vrm: null,
      label: "角色位 01",
      title: "",
      position: position.slice(),
      moving: false
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

    function metricsFor(rendererInstance) {
      var b = rendererInstance.bounds;
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
      if (target) {
        var dx = target[0] - position[0];
        var dz = target[2] - position[2];
        var distance = Math.sqrt(dx * dx + dz * dz);
        if (distance > 0.01) {
          var distanceStep = Math.min(distance, speed * Math.max(stepDt, 0.001));
          position[0] += dx / distance * distanceStep;
          position[2] += dz / distance * distanceStep;
          var desiredYaw = baseYaw + Math.atan2(dx, dz);
          yaw = lerpAngle(yaw, desiredYaw, 1 - Math.exp(-Math.max(stepDt, 0.001) * 7));
          moving = true;
        } else {
          position[0] = target[0];
          position[2] = target[2];
          target = null;
          moving = false;
        }
      } else {
        yaw = lerpAngle(yaw, baseYaw, 1 - Math.exp(-Math.max(stepDt, 0.001) * 3));
        moving = false;
      }
      state.position[0] = position[0];
      state.position[1] = position[1];
      state.position[2] = position[2];
      state.moving = moving;
      state.yaw = yaw;
      if (wasMoving !== moving) {
        if (moving) setStatus(state.label + " · 移动中");
        else if (state.title) setStatus(state.label + " · VRM / " + state.title);
        else setStatus(state.label + " · 待机");
      }
    }

    function frame(now, dt) {
      if (!renderer || !vrm || !metrics) return;
      if (!startedAt) startedAt = now;
      step(dt);
      modelMatrix = placeMatrix(position, metrics, yaw);
      var t = (now - startedAt) / 1000;
      var pose;
      var animation = Render.ProceduralAnimation;
      if (animation && animation.makeVRMPose) {
        pose = animation.makeVRMPose(vrm, t, {
          state: moving ? "walk" : "idle",
          look: look ? look.getLook() : null,
          bindings: bindings
        });
      } else {
        pose = Render.makeVRMIdlePose(vrm, t);
      }
      renderer.render(t, pose, null, {
        viewProjection: scene.getViewProjection(),
        modelMatrix: modelMatrix,
        clearColor: [0, 0, 0, 0]
      });
    }

    function moveTo(point) {
      if (!point) return;
      target = [
        Math.max(-18, Math.min(18, Number(point[0]) || 0)),
        0,
        Math.max(-18, Math.min(18, Number(point[2]) || 0))
      ];
    }

    function boot() {
      if (!home) throw new Error("scene-vrm: slot not found: " + slotId);
      canvas.hidden = true;
      setStatus("角色位 01 · 载入 VRM");
      renderer = new Render.VRMRenderer(canvas, {
        context: { alpha: true, antialias: true },
        clearColor: [0, 0, 0, 0]
      });
      state.renderer = renderer;
      return fetch(url)
        .then(function (response) {
          if (!response.ok) throw new Error("VRM 加载失败 " + response.status + " · " + url);
          return response.arrayBuffer();
        })
        .then(function (buffer) {
          vrm = formats.parseVRM(buffer);
          state.vrm = vrm;
          return renderer.loadVRM(vrm);
        })
        .then(function () {
          metrics = metricsFor(renderer);
          var animation = Render.ProceduralAnimation;
          if (animation && animation.detectVRMBones) bindings = animation.detectVRMBones(vrm);
          modelMatrix = placeMatrix(position, metrics, yaw);
          canvas.hidden = false;
          state.status = "ready";
          var title = vrm.meta && vrm.meta.title ? vrm.meta.title : "已接入";
          state.title = title;
          if (scene.setSlotMeta) scene.setSlotMeta(slotId, "VRM / " + title);
          setStatus("角色位 01 · VRM / " + title);
          scene.onFrame(frame);
          return state;
        })
        .catch(function (error) {
          state.status = "error";
          state.error = error;
          canvas.hidden = true;
          setStatus("角色位 01 · VRM 加载失败");
          if (global.console) console.error("scene-vrm:", error);
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
    mount.__aevumVrm = handle;
    handle.ready.then(function () {
      handle.renderer = renderer;
    }, function () {});
    return handle;
  }

  sceneNS.attachVRM = attach;
})(window);
