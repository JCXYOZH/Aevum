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
    var overlay = mount.querySelector(".scene3d__overlay");
    if (overlay) mount.insertBefore(canvas, overlay);
    else mount.appendChild(canvas);

    var renderer = null;
    var model = null;
    var modelMatrix = null;
    var world = scene.slotWorld(slotId);
    var startedAt = 0;
    var state = { status: "loading", renderer: null, model: null };

    function setStatus(text) {
      if (scene.setStatus) scene.setStatus(text);
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

    function modelFor(bounds, slotWorld) {
      var height = bounds.max[1] - bounds.min[1];
      if (!height || !isFinite(height)) height = 1;
      var scale = (options.height || 1.75) / height;
      var cx = (bounds.min[0] + bounds.max[0]) / 2;
      var cz = (bounds.min[2] + bounds.max[2]) / 2;
      return placeMatrix(slotWorld, scale, [cx, bounds.min[1], cz], options.yaw || 0);
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
      if (!renderer || !model || !modelMatrix) return;
      if (!startedAt) startedAt = now;
      var pose = Render.makeIdlePose(model, (now - startedAt) / 1000);
      renderer.render((now - startedAt) / 1000, pose, {
        viewProjection: scene.getViewProjection(),
        modelMatrix: modelMatrix,
        clearColor: [0, 0, 0, 0]
      });
    }

    function boot() {
      if (!world) throw new Error("scene-pmx: slot not found: " + slotId);
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
          modelMatrix = modelFor(boundsOf(model), world);
          canvas.hidden = false;
          state.status = "ready";
          var title = model.modelName || "已接入";
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

    var handle = { canvas: canvas, ready: boot(), state: state, renderer: null };
    mount[key] = handle;
    handle.ready.then(function () {
      handle.renderer = renderer;
    }, function () {});
    return handle;
  }

  sceneNS.attachPMX = attach;
})(window);
