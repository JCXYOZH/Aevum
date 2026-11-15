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

    var world = scene.slotWorld(slotId);
    var renderer = null;
    var state = { status: "loading", renderer: null };

    function setStatus(text) {
      if (scene.setStatus) scene.setStatus(text);
    }

    function align() {
      if (!world) return;
      var point = scene.project(world);
      if (!point || point.clip < -1.2 || point.clip > 1.2) {
        canvas.hidden = true;
        return;
      }
      canvas.hidden = false;
      canvas.style.left = Math.round(point.x - width / 2) + "px";
      canvas.style.top = Math.round(point.y - height + 12) + "px";
    }

    function boot() {
      if (!world) throw new Error("scene-live2d: slot not found: " + slotId);
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
        align();
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

    var handle = { canvas: canvas, ready: boot(), state: state, renderer: null };
    mount[key] = handle;
    handle.ready.then(function () {
      handle.renderer = renderer;
    }, function () {});
    return handle;
  }

  sceneNS.attachLive2D = attach;
})(window);
