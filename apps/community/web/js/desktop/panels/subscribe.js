/* Subscription panel: a native 3D-desktop window.
   It reuses the existing MrHua subscription partial markup and the existing
   loop-subscribe request logic; it never opens an iframe or an embed URL. */
(function (global) {
  "use strict";
  var MD = global.MD;
  MD.panels = MD.panels || {};

  MD.panels.subscribe = function () {
    var root = document.createElement("div");
    root.className = "pad subscribe-native";
    root.innerHTML = '<p class="subscribe-native__loading">正在打开订阅…</p>';

    var disposed = false;

    function adaptLegacyMarkup() {
      // The partial carries MrHua's form classes. Desktop has its own input
      // and button rules, so map to those instead of copying the old CSS.
      var form = root.querySelector("#loop-subscribe-form");
      if (form) form.classList.remove("auth-form");

      root.querySelectorAll(".form-group").forEach(function (item) {
        item.classList.add("field");
        item.classList.remove("form-group");
      });

      root.querySelectorAll(".auth-input").forEach(function (input) {
        input.classList.remove("auth-input");
      });

      var submit = root.querySelector("#loop-subscribe-submit");
      if (submit) {
        submit.classList.remove("btn-primary");
        submit.classList.add("tbtn", "tbtn--solid");
      }
    }

    function init() {
      fetch("/mrhua/partials/windows/workspace/subscribe.html", {
        credentials: "same-origin",
        headers: { "Accept": "text/html" }
      })
        .then(function (response) {
          if (!response.ok) throw new Error("订阅内容加载失败");
          return response.text();
        })
        .then(function (html) {
          if (disposed) return;
          var doc = new DOMParser().parseFromString(html, "text/html");
          var body = doc.querySelector("#win-subscribe .window-body");
          if (!body) throw new Error("订阅内容结构不完整");
          root.innerHTML = body.innerHTML;
          adaptLegacyMarkup();
          if (global.MrHuaSubscribe && typeof global.MrHuaSubscribe.init === "function") {
            global.MrHuaSubscribe.init();
          }
          if (global.MrHuaSubscribe && typeof global.MrHuaSubscribe.open === "function") {
            global.MrHuaSubscribe.open();
          }
        })
        .catch(function (error) {
          if (disposed) return;
          root.innerHTML = '<p class="subscribe-native__error">' +
            (error && error.message ? error.message : "订阅窗口暂时无法打开") +
            "</p>";
        });
    }

    init();

    return {
      element: root,
      mount: function () {
        var email = root.querySelector("#loop-subscribe-email");
        if (email) email.focus();
      },
      onShow: function () {
        var email = root.querySelector("#loop-subscribe-email");
        if (email) email.focus();
      },
      destroy: function () {
        disposed = true;
      }
    };
  };
})(window);
