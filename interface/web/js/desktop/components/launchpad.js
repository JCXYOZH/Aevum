/* Launchpad component: one grid, built from the app registry. Custom slots
   are represented by the same tile shape as built-ins. */
(function (global) {
  "use strict";
  var MD = global.MD;
  MD.components = MD.components || {};

  MD.components.launchpad = function (options) {
    var root = options.root;
    var grid = root.querySelector("#launchpad-grid");

    function render() {
      grid.innerHTML = "";
      MD.listApps().forEach(function (app) {
        var tile = document.createElement("button");
        tile.className = "app-tile";
        tile.type = "button";
        tile.dataset.open = app.id;
        tile.innerHTML = MD.icon(app.icon, "app-tile__icon") +
          '<span class="app-tile__title">' + MD.escapeText(app.title) + "</span>" +
          '<span class="app-tile__desc">' + MD.escapeText(app.meta + " · " + app.desc) + "</span>";
        if (app.custom) {
          var remove = document.createElement("span");
          remove.className = "slot__x";
          remove.dataset.removeCustom = app.id;
          remove.title = "移除";
          remove.textContent = "×";
          tile.appendChild(remove);
        }
        grid.appendChild(tile);
      });
      var add = document.createElement("button");
      add.className = "app-tile";
      add.type = "button";
      add.dataset.add = "1";
      add.innerHTML = MD.icon("plus", "app-tile__icon") +
        '<span class="app-tile__title">新增窗口</span>' +
        '<span class="app-tile__desc">留一个位置给别人：名字 + 地址，存到本机。</span>';
      grid.appendChild(add);
    }

    grid.addEventListener("click", function (event) {
      var remove = event.target.closest("[data-remove-custom]");
      if (remove) {
        event.stopPropagation();
        options.onRemove(remove.dataset.removeCustom);
        return;
      }
      var add = event.target.closest("[data-add]");
      if (add) { options.onAdd(); return; }
      var open = event.target.closest("[data-open]");
      if (open) options.onOpen(open.dataset.open);
    });

    root.querySelector("#close-launchpad").addEventListener("click", hide);
    MD.bus.on("apps", render);
    render();

    function show() {
      root.hidden = false;
      render();
    }
    function hide() { root.hidden = true; }
    function isVisible() { return !root.hidden; }

    return { render: render, show: show, hide: hide, isVisible: isVisible };
  };
})(window);
