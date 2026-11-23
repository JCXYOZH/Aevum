/* Single toast owner. */
(function (F) {
  "use strict";

  let timer = null;

  function show(msg) {
    const el = F.dom.$("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(timer);
    timer = setTimeout(function () { el.classList.remove("show"); }, 2400);
  }

  F.ui = F.ui || {};
  F.ui.toast = { show: show };
})(window.AEVUM.FORGE);
