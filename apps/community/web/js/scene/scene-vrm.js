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
    var world = scene.slotWorld(slotId);
    var startedAt = 0;
    var state = { status: "loading", renderer: null, vrm: null };

    function setStatus(text) {
      if (scene.setStatus) scene.setStatus(text);
    }

    function modelFor(rendererInstance, slotWorld) {
      var b = rendererInstance.bounds;
      var height = b.max[1] - b.min[1];
      if (!height || !isFinite(height)) height = 1;
      var scale = (options.height || 1.75) / height;
      var cx = (b.min[0] + b.max[0]) / 2;
      var cz = (b.min[2] + b.max[2]) / 2;
      return placeMatrix(slotWorld, scale, [cx, b.min[1], cz], options.yaw || 0);
    }

    function placeMatrix(slotWorld, scale, center, yaw) {
      var m = math.M4.create();
      var c = Math.cos(yaw);
      var s = Math.sin(yaw);
      m[0] = c * scale;
      m[1] = 0;
      m[2] = -s * scale;
      m[3] = 0;
      m[4] = 0;
      m[5] = scale;
      m[6] = 0;
      m[7] = 0;
      m[8] = s * scale;
      m[9] = 0;
      m[10] = c * scale;
      m[11] = 0;
      m[12] = slotWorld[0] - (c * scale * center[0] + s * scale * center[2]);
      m[13] = slotWorld[1] - scale * center[1];
      m[14] = slotWorld[2] - (-s * scale * center[0] + c * scale * center[2]);
      m[15] = 1;
      return m;
    }

    function frame(now) {
      if (!renderer || !vrm || !modelMatrix) return;
      if (!startedAt) startedAt = now;
      var pose = Render.makeVRMIdlePose(vrm, (now - startedAt) / 1000);
      renderer.render((now - startedAt) / 1000, pose, null, {
        viewProjection: scene.getViewProjection(),
        modelMatrix: modelMatrix,
        clearColor: [0, 0, 0, 0]
      });
    }

    function boot() {
      if (!world) throw new Error("scene-vrm: slot not found: " + slotId);
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
          modelMatrix = modelFor(renderer, world);
          canvas.hidden = false;
          state.status = "ready";
          var title = vrm.meta && vrm.meta.title ? vrm.meta.title : "已接入";
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

    var handle = { canvas: canvas, ready: boot(), state: state, renderer: null };
    mount.__aevumVrm = handle;
    handle.ready.then(function () {
      handle.renderer = renderer;
    }, function () {});
    return handle;
  }

  sceneNS.attachVRM = attach;
})(window);
