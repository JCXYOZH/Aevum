/* Camera panel: a local-only photo surface.
   Captures the 3D scene (ground grid + characters), or accepts an image file.
   Nothing is uploaded and nothing is written to localStorage: every photo is
   released when the page reloads. */
(function (global) {
  "use strict";
  var MD = global.MD;
  MD.panels = MD.panels || {};

  MD.panels.camera = function () {
    var root = document.createElement("div");
    root.className = "pad camera-panel";
    root.tabIndex = 0;
    root.innerHTML =
      '<div class="camera-head">' +
        '<div><strong>拍照</strong><span class="small">3D 场景 / 本地文件</span></div>' +
        '<span class="camera-badge">仅本次页面内存</span>' +
      '</div>' +
      '<div class="camera-stage" data-field="camera-stage">' +
        '<p class="camera-empty" data-field="camera-empty">按“拍下场景”把地面网格和角色一起收进画面，或拖入一张本地图片。</p>' +
        '<img class="camera-photo" data-field="camera-photo" alt="拍照结果" hidden>' +
      '</div>' +
      '<div class="camera-actions">' +
        '<button class="tbtn tbtn--solid" type="button" data-field="camera-capture">拍下场景</button>' +
        '<button class="tbtn" type="button" data-field="camera-choose">选择图片</button>' +
        '<button class="tbtn" type="button" data-field="camera-clear">清空</button>' +
        '<span class="camera-state" data-field="camera-state">等待拍照</span>' +
        '<input type="file" accept="image/*" data-field="camera-file" hidden>' +
      '</div>' +
      '<p class="camera-note">图片只存在这个窗口和场景的内存里，刷新即消失，不会上传，也不会写入 localStorage；载入后会自动放进 3D 背景板。</p>';

    var stage = root.querySelector('[data-field="camera-stage"]');
    var empty = root.querySelector('[data-field="camera-empty"]');
    var photo = root.querySelector('[data-field="camera-photo"]');
    var state = root.querySelector('[data-field="camera-state"]');
    var fileInput = root.querySelector('[data-field="camera-file"]');
    var choose = root.querySelector('[data-field="camera-choose"]');
    var clear = root.querySelector('[data-field="camera-clear"]');
    var capture = root.querySelector('[data-field="camera-capture"]');

    function setState(text) {
      if (state) state.textContent = text;
    }

    function placeOnScene(source) {
      var scene = global.MemoriaScene;
      if (!scene || typeof scene.setBackdrop !== "function") return;
      scene.setBackdrop(source).catch(function () {
        setState("照片已留在窗口，3D 背景板载入失败");
      });
    }

    function showPhoto(source, label) {
      if (!source) return;
      photo.src = source;
      photo.hidden = false;
      empty.hidden = true;
      stage.classList.add("has-photo");
      setState(label || "已载入");
      placeOnScene(source);
    }

    function clearPhoto() {
      photo.removeAttribute("src");
      photo.hidden = true;
      empty.hidden = false;
      stage.classList.remove("has-photo");
      fileInput.value = "";
      var scene = global.MemoriaScene;
      if (scene && typeof scene.clearBackdrop === "function") scene.clearBackdrop();
      setState("已清空");
    }

    function readFile(file) {
      if (!file || !/^image\//.test(file.type || "")) {
        setState("只接受图片文件");
        return;
      }
      var reader = new FileReader();
      reader.onload = function () { showPhoto(String(reader.result || ""), "本地图片"); };
      reader.onerror = function () { setState("读取失败"); };
      reader.readAsDataURL(file);
    }

    capture.addEventListener("click", function () {
      var scene = global.MemoriaScene;
      if (!scene || typeof scene.capturePhoto !== "function") {
        setState("3D 场景还没有准备好");
        return;
      }
      try {
        var data = scene.capturePhoto();
        if (!data) {
          setState("场景还没有可拍的内容");
          return;
        }
        showPhoto(data, "3D 场景 · 已拍下");
        stage.classList.remove("is-flashing");
        void stage.offsetWidth;
        stage.classList.add("is-flashing");
      } catch (error) {
        setState("拍照失败：" + (error && error.message ? error.message : "未知错误"));
      }
    });

    choose.addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function () { readFile(fileInput.files && fileInput.files[0]); });
    clear.addEventListener("click", clearPhoto);

    root.addEventListener("dragover", function (event) {
      event.preventDefault();
      stage.classList.add("is-drop");
    });
    root.addEventListener("dragleave", function () {
      stage.classList.remove("is-drop");
    });
    root.addEventListener("drop", function (event) {
      event.preventDefault();
      stage.classList.remove("is-drop");
      var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      readFile(file);
    });

    return {
      element: root,
      mount: function () { root.focus(); },
      onShow: function () { root.focus(); },
      destroy: function () { photo.removeAttribute("src"); }
    };
  };
})(window);
