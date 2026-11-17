/* Showcase scene band. The page keeps its long-form content; this is an
   interactive index over the same sections, not a second content source. */
(function (global) {
  "use strict";

  var scene = global.AEVUM && global.AEVUM.scene;
  var mount = document.getElementById("showcase-scene");
  if (!scene || !mount) return;

  var nodes = [
    { id: "modules", title: "架构", meta: "FORTUNA / LIBERTAS / MEMORIA", grid: [-3.0, -2.0], tone: "teal" },
    { id: "state", title: "阶段", meta: "P0–P9 / 构建记录", grid: [-3.0, 2.0], tone: "amber" },
    { id: "console", title: "控制台", meta: "DESKTOP / 多窗口", grid: [3.0, -2.0], tone: "blue" },
    { id: "join", title: "参与", meta: "OPEN@MRHUA.CN", grid: [3.0, 2.0], tone: "dim" },
    { id: "desktop", title: "进入 3D 桌面", meta: "DESKTOP.HTML / SCENE", grid: [0.0, 0.0], tone: "amber" }
  ];

  var slots = [
    { id: "host", title: "角色位 01", meta: "VRM / 角色模型", grid: [-1.1, 2.5] },
    { id: "guide", title: "角色位 02", meta: "PMX / 角色模型", grid: [1.1, 2.5] }
  ];

  var api = scene.create({
    mount: mount,
    nodes: nodes,
    slots: slots,
    onOpen: function (id) {
      if (id === "desktop") {
        global.location.href = "desktop.html?scene=1";
        return;
      }
      var target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        if (api && api.setStatus) api.setStatus("已定位到 " + target.querySelector("h2").textContent);
      }
    },
    onSlot: function (slot) {
      if (api && api.setStatus) {
        api.setStatus(slot.title + " · 打开 3D 桌面查看角色");
      }
    }
  });

  api.mount();
  if (api.setStatus) api.setStatus("拖拽旋转 · 滚轮缩放 · 点击入口");
  global.AevumShowcaseScene = api;
})(window);
