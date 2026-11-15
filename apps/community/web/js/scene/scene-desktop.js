/* desktop.html scene layout.
   The scene is an index over the existing apps: clicking a node opens the same
   window that the dock or launchpad would open. No panel logic lives here. */
(function (global) {
  "use strict";

  var scene = global.AEVUM && global.AEVUM.scene;
  var MD = global.MD;
  if (!scene || !MD) return;

  var placements = {
    overview: { grid: [-1.5, 0.0], tone: "amber" },
    kernel: { grid: [-3.4, -2.6], tone: "teal" },
    trainer: { grid: [-0.2, -3.4], tone: "amber" },
    model: { grid: [3.0, -2.6], tone: "blue" },
    relay: { grid: [-3.4, 1.8], tone: "amber" },
    errors: { grid: [3.0, 1.8], tone: "red" },
    exhibit: { grid: [0.0, 3.2], tone: "dim" }
  };

  var slots = [
    { id: "host", title: "角色位 01", meta: "HOST / 待接入", grid: [-1.2, 2.2] },
    { id: "guide", title: "角色位 02", meta: "GUIDE / 待接入", grid: [1.2, 2.2] }
  ];

  function placementFor(app, index) {
    if (placements[app.id]) return placements[app.id];
    var angle = (index * 0.9) - 2.2;
    var radius = 5.0;
    return {
      grid: [Math.cos(angle) * radius, Math.sin(angle) * radius],
      tone: "dim"
    };
  }

  function buildNodes() {
    return MD.listApps().map(function (app, index) {
      var placement = placementFor(app, index);
      return {
        id: app.id,
        title: app.title,
        meta: app.meta || "",
        grid: placement.grid,
        tone: placement.tone
      };
    });
  }

  var mount = document.getElementById("scene3d");
  if (!mount) return;

  var api = scene.create({
    mount: mount,
    nodes: buildNodes(),
    slots: slots,
    onOpen: function (id) {
      if (!MD.getApp(id)) return;
      var desk = mount.parentElement;
      if (desk && desk.classList.contains("scene-focus")) api.setView("focus");
      MD.bus.emit("request-open", id);
    },
    onSlot: function (slot) {
      MD.bus.emit("request-open", "model");
      if (api && api.setStatus) {
        api.setStatus(slot.title + " 已预留 · 打开模型对话接角色");
      }
    },
    onPick: function (node) {
      if (node && api && api.setStatus) api.setStatus("选中 " + node.title);
    }
  });

  api.mount();
  if (new URLSearchParams(global.location.search).get("scene") === "1") {
    api.setView("focus");
  }
  var params = new URLSearchParams(global.location.search);
  var requestedView = params.get("view");
  if (requestedView) api.setView(requestedView);
  var hostHandle = null;
  var guideHandle = null;
  var look = null;
  if (global.AEVUM.render && global.AEVUM.render.LookController) {
    look = global.AEVUM.render.LookController.createLookController({
      maxYaw: 0.48,
      maxPitch: 0.22,
      smoothing: 0.22,
      deadZone: 0.06
    });
    api.onFrame(function (now, dt) { look.update(dt); });
    mount.addEventListener("pointermove", function (event) {
      var rect = mount.getBoundingClientRect();
      look.setPointer(
        ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        ((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1
      );
    });
    mount.addEventListener("pointerleave", function () { look.clearPointer(); });
  }

  function moveNearest(point) {
    var candidates = [];
    if (hostHandle && hostHandle.moveTo) candidates.push({ title: "角色位 01", handle: hostHandle });
    if (guideHandle && guideHandle.moveTo) candidates.push({ title: "角色位 02", handle: guideHandle });
    if (!candidates.length) return;
    var nearest = null;
    var nearestDistance = Infinity;
    candidates.forEach(function (item) {
      var current = item.handle.getPosition ? item.handle.getPosition() : [0, 0, 0];
      var distance = Math.hypot(point[0] - current[0], point[2] - current[2]);
      if (distance < nearestDistance) {
        nearest = item;
        nearestDistance = distance;
      }
    });
    if (nearest) {
      nearest.handle.moveTo(point);
      api.setStatus(nearest.title + " · 移动中");
    }
  }

  api.onGround(moveNearest);

  if (global.AEVUM.scene.attachVRM) {
    var yaw = params.get("yaw");
    hostHandle = global.AEVUM.scene.attachVRM({
      mount: mount,
      scene: api,
      slotId: "host",
      height: 1.75,
      yaw: yaw === null ? Math.PI : Number(yaw),
      look: look,
      modelUrl: "/engine/assets/models/furina/" + encodeURIComponent("f芙宁娜.vrm")
    });
  }
  if (global.AEVUM.scene.attachPMX && params.get("guide") !== "live2d") {
    var pmxYaw = params.get("pmxYaw");
    guideHandle = global.AEVUM.scene.attachPMX({
      mount: mount,
      scene: api,
      slotId: "guide",
      height: 1.75,
      yaw: pmxYaw === null ? Math.PI : Number(pmxYaw),
      look: look,
      modelUrl: "/engine/assets/models/ganyu/" + encodeURIComponent("甘雨.pmx"),
      baseUrl: "/engine/assets/models/ganyu/"
    });
  }
  if (global.AEVUM.scene.attachLive2D && params.get("guide") === "live2d") {
    guideHandle = global.AEVUM.scene.attachLive2D({
      mount: mount,
      scene: api,
      slotId: "guide",
      modelUrl: "/engine/assets/models/live2d/xiaoyue/" + encodeURIComponent("xiaoyue.model3.json")
    });
  }
  MD.bus.on("apps", function () {
    api.refresh(buildNodes(), slots);
  });

  global.MemoriaScene = api;
})(window);
