/* Live2D character pass. Live2D is a 2D renderer, so it gets its own
   screen-space canvas anchored to a ground slot instead of a 3D mesh. */
(function (global) {
  "use strict";

  var NS = global.AEVUM = global.AEVUM || {};
  var sceneNS = NS.scene = NS.scene || {};

  function attach(options) {
    var mount = options.mount;
    var scene = options.scene;
    var slotId = options.slotId || "guide";
    var url = options.modelUrl;
    if (!mount || !scene || !url) throw new Error("scene-live2d: mount, scene and modelUrl are required");
    var key = "__aevumLive2D_" + slotId;
    if (mount[key]) return mount[key];

    var Render = NS.render || {};
    if (!Render.Live2DRenderer) throw new Error("scene-live2d: Live2DRenderer is not loaded");

    var width = options.width || 300;
    var height = options.height || 420;
    var scale = options.scale || 0.55;
    var canvas = document.createElement("canvas");
    canvas.className = "scene3d__live2d";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    canvas.style.transformOrigin = "50% 100%";
    canvas.style.transform = "scale(" + scale + ")";
    var overlay = mount.querySelector(".scene3d__overlay");
    if (overlay) mount.insertBefore(canvas, overlay);
    else mount.appendChild(canvas);

    var home = scene.slotWorld(slotId);
    var position = home ? [home[0], 0, home[2]] : [0, 0, 0];
    var target = null;
    var speed = options.speed == null ? 1.8 : Math.max(0.2, Number(options.speed));
    var renderer = null;
    var state = { status: "loading", renderer: null, position: position.slice(), moving: false };

    function setStatus(text) {
      if (scene.setStatus) scene.setStatus(text);
    }

    function step(dt) {
      var stepDt = dt || 0;
      var wasMoving = state.moving;
      if (target) {
        var dx = target[0] - position[0];
        var dz = target[2] - position[2];
        var distance = Math.sqrt(dx * dx + dz * dz);
        if (distance > 0.01) {
          var distanceStep = Math.min(distance, speed * Math.max(stepDt, 0.001));
          position[0] += dx / distance * distanceStep;
          position[2] += dz / distance * distanceStep;
          state.moving = true;
        } else {
          position[0] = target[0];
          position[2] = target[2];
          target = null;
          state.moving = false;
        }
      } else {
        state.moving = false;
      }
      state.position[0] = position[0];
      state.position[1] = position[1];
      state.position[2] = position[2];
      if (wasMoving !== state.moving) {
        if (state.moving) setStatus("角色位 02 · 移动中");
        else setStatus("角色位 02 · Live2D / 小月");
      }
    }

    function align(dt) {
      if (!home) return;
      step(dt);
      var point = scene.project(position);
      if (!point || point.clip < -1.2 || point.clip > 1.2) {
        canvas.hidden = true;
        return;
      }
      canvas.hidden = false;
      canvas.style.left = Math.round(point.x - width / 2) + "px";
      canvas.style.top = Math.round(point.y - height + 12) + "px";
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
      if (!home) throw new Error("scene-live2d: slot not found: " + slotId);
      canvas.hidden = true;
      setStatus("角色位 02 · 载入 Live2D");
      renderer = new Render.Live2DRenderer(canvas);
      state.renderer = renderer;
      return renderer.loadModel(url).then(function (model) {
        state.status = "ready";
        state.model = model;
        canvas.hidden = false;
        if (scene.setSlotMeta) scene.setSlotMeta(slotId, "Live2D / 小月");
        setStatus("角色位 02 · Live2D / 小月");
        scene.onFrame(align);
        align(0);
        renderer.start();
        return state;
      }).catch(function (error) {
        state.status = "error";
        state.error = error;
        canvas.hidden = true;
        setStatus("角色位 02 · Live2D 加载失败");
        if (global.console) console.error("scene-live2d:", error);
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

  sceneNS.attachLive2D = attach;
})(window);
