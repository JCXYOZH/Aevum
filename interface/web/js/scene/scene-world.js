/* desktop world layer.
   The real WebGL2 world is a sibling canvas behind the transparent scene-core
   canvas. It shares the orbit camera with the desktop, so dragging, zooming,
   picking and character placement all keep working on the same terrain. */
(function (global) {
  "use strict";

  var params = new URLSearchParams((global.location && global.location.search) || "");
  if (params.get("world") !== "1") return;

  var scene = global.MemoriaScene;
  var mount = document.getElementById("scene3d");
  if (!scene || !mount) return;

  function fail(message) {
    if (scene.setStatus) scene.setStatus(message);
    if (global.console) console.warn("scene-world:", message);
  }

  var canvas = document.createElement("canvas");
  canvas.className = "scene3d__world";
  canvas.setAttribute("aria-hidden", "true");
  var ground = mount.querySelector(".scene3d__canvas");
  if (ground && ground.parentNode) ground.parentNode.insertBefore(canvas, ground);
  else mount.appendChild(canvas);

  function sizeWorld() {
    var rect = mount.getBoundingClientRect();
    var width = Math.max(1, Math.round(rect.width));
    var height = Math.max(1, Math.round(rect.height));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    if (global.AEVUM_WORLD_RENDERER) global.AEVUM_WORLD_RENDERER.resize(width, height);
  }

  sizeWorld();
  scene.setGroundVisible(false);
  if (scene.camera) {
    scene.camera.target = [0, 1.2, 0];
    scene.camera.distance = 21;
    scene.camera.rotationX = 0.16;
    scene.camera.rotationY = 0.28;
    scene.camera.fov = 64;
    scene.camera.update(0);
  }

  global.AEVUM_WORLD_RENDER_ONLY = true;
  global.AEVUM_WORLD_CANVAS = canvas;
  global.AEVUM_WORLD_CAMERA = function () {
    var camera = scene.camera;
    if (!camera) return null;
    return {
      position: [camera.position[0], camera.position[1], camera.position[2]],
      target: [camera.target[0], camera.target[1], camera.target[2]],
      fov: camera.fov * Math.PI / 180,
      width: canvas.width,
      height: canvas.height
    };
  };

  var resizeQueued = false;
  function onResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    global.requestAnimationFrame(function () {
      resizeQueued = false;
      sizeWorld();
    });
  }
  if (global.ResizeObserver) new global.ResizeObserver(onResize).observe(mount);
  else global.addEventListener("resize", onResize);

  var script = document.createElement("script");
  script.src = "js/scene/world/world-scene.bundle.js?v=20261119cp";
  script.async = true;
  script.onerror = function () { fail("世界渲染器装载失败"); };
  script.onload = function () {
    var attempts = 0;
    var timer = global.setInterval(function () {
      attempts += 1;
      if (global.__AEVUM_SHOT_ERROR) {
        global.clearInterval(timer);
        global.AEVUM_SCENE_READY = true;
        fail(String(global.__AEVUM_SHOT_ERROR).split("\n")[0]);
        return;
      }
      var renderer = global.AEVUM_WORLD_RENDERER;
      if (renderer && typeof renderer.heightAt === "function") {
        global.clearInterval(timer);
        scene.setGroundHeight(function (x, z) { return renderer.heightAt(x, z); });
        renderer.resize(canvas.width, canvas.height);
        global.AEVUM_SCENE_READY = true;
        scene.setStatus("开放世界 · 拖拽旋转 · 滚轮缩放 · 点击地面移动角色");
        return;
      }
      if (attempts > 80) {
        global.clearInterval(timer);
        global.AEVUM_SCENE_READY = true;
        fail("世界渲染器初始化超时");
      }
    }, 100);
  };
  document.head.appendChild(script);

  global.MemoriaWorld = {
    canvas: canvas,
    ready: function () { return Boolean(global.AEVUM_WORLD_READY && global.AEVUM_SCENE_READY); }
  };
})(window);












