/* Dock component: the left rail is a projection of the app registry, not a
   second hard-coded list. Buttons only emit ids. */
(function (global) {
  "use strict";
  var MD = global.MD;
  MD.components = MD.components || {};

  MD.components.dock = function (options) {
    var root = options.root;

    root.querySelectorAll(".dock__btn[data-open]").forEach(function (button) {
      var app = MD.getApp(button.dataset.open);
      button.innerHTML = MD.icon(app ? app.icon : "page") + "<span>" + (app ? app.title : button.dataset.open) + "</span>";
      button.addEventListener("click", function () { options.onOpen(button.dataset.open); });
    });
    root.querySelector("#dock-launchpad").innerHTML = MD.icon("grid") + "<span>启动台</span>";
    root.querySelector("#dock-add").innerHTML = MD.icon("plus") + "<span>新增</span>";

    root.querySelector("#dock-launchpad").addEventListener("click", options.onLaunchpad);
    root.querySelector("#dock-add").addEventListener("click", options.onAdd);

    function refresh(activeId) {
      root.querySelectorAll("[data-dock]").forEach(function (button) {
        button.dataset.active = button.dataset.dock === activeId ? "1" : "0";
      });
    }

    return { refresh: refresh };
  };
})(window);
