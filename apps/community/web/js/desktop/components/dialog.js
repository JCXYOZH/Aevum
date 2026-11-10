/* Add-window dialog component. It collects two fields and delegates the
   decision to onSubmit; it never writes storage itself. */
(function (global) {
  "use strict";
  var MD = global.MD;
  MD.components = MD.components || {};

  MD.components.addDialog = function (options) {
    var root = options.root;
    var title = root.querySelector("#custom-title");
    var url = root.querySelector("#custom-url");
    var error = root.querySelector("#add-error");

    function open() {
      title.value = "";
      url.value = "";
      error.textContent = "";
      root.hidden = false;
      title.focus();
    }
    function close() { root.hidden = true; }
    function isOpen() { return !root.hidden; }

    root.querySelector("#add-cancel").addEventListener("click", close);
    root.querySelector("#add-save").addEventListener("click", function () {
      var result = options.onSubmit(title.value.trim(), url.value.trim());
      if (result) { error.textContent = result; return; }
      close();
    });
    root.addEventListener("click", function (event) {
      if (event.target === root) close();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && isOpen()) close();
    });

    return { open: open, close: close, isOpen: isOpen };
  };
})(window);
