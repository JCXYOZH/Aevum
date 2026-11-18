/* Top bar component: service pills, clock and the two shell actions.
   It only reports clicks upward; it does not know which panel opens. */
(function (global) {
  "use strict";
  var MD = global.MD;
  MD.components = MD.components || {};

  MD.components.topbar = function (options) {
    var root = options.root;
    var clock = root.querySelector("#clock");
    var foot = options.foot;

    root.querySelectorAll(".pill").forEach(function (pill) {
      pill.addEventListener("click", function () {
        options.onOpen(pill.dataset.svc);
      });
    });
    root.querySelector("#open-launchpad").addEventListener("click", options.onLaunchpad);
    root.querySelector("#open-add").addEventListener("click", options.onAdd);

    function tickClock() {
      if (clock) clock.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    }

    function setPill(service, state, label) {
      var pill = root.querySelector('[data-svc="' + service + '"]');
      if (!pill) return;
      pill.dataset.state = state;
      if (label) {
        var span = pill.querySelector("span");
        if (span) span.textContent = label;
      }
    }

    function setFoot(text) {
      var node = foot && foot.querySelector("#foot-state");
      if (node) node.textContent = text;
    }

    tickClock();
    setInterval(tickClock, 1000);
    return { setPill: setPill, setFoot: setFoot };
  };
})(window);
