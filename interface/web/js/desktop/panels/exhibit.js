/* Exhibit panel: the preserved long page lives in an iframe, so it remains
   a normal launch item instead of being deleted or flattened into a card. */
(function (global) {
  "use strict";
  var MD = global.MD;
  MD.panels = MD.panels || {};

  MD.panels.exhibit = function (options) {
    options = options || {};
    var root = document.createElement("div");
    root.style.height = "100%";
    var url = options.url || "index.html";
    root.innerHTML = '<iframe src="' + MD.escapeAttr(url) + '" title="' + MD.escapeAttr(options.title || "展示页") + '" style="width:100%;height:100%;border:0;display:block;background:#fff"></iframe>';
    return { element: root };
  };
})(window);
