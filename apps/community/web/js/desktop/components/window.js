/* Window manager component. A window is a frame plus one panel instance;
   this file owns dragging, resizing, min/max/close and z-order only. */
(function (global) {
  "use strict";
  var MD = global.MD;
  MD.components = MD.components || {};

  MD.components.windowManager = function (options) {
    var desk = options.desk;
    var layer = options.layer;
    var template = options.template;
    var onFocus = options.onFocus || function () {};
    var onClose = options.onClose || function () {};
    var wins = new Map();

    var PRESETS = {
      trainer: { left: 574, top: 18 },
      kernel: { left: 24, top: 28 },
      relay: { left: 34, top: 34 },
      errors: { left: 44, top: 40 },
      exhibit: { left: 30, top: 24 }
    };

    function focus(id) {
      var record = wins.get(id);
      if (!record) return;
      MD.state.z += 1;
      wins.forEach(function (item) { item.el.dataset.focus = "0"; });
      record.el.dataset.focus = "1";
      record.el.style.zIndex = String(MD.state.z);
      onFocus(activeId());
    }

    function activeId() {
      var active = null;
      wins.forEach(function (record) {
        if (record.el.dataset.focus === "1" && !record.el.classList.contains("is-hidden")) active = record.id;
      });
      return active;
    }

    function position(record) {
      var preset = PRESETS[record.id];
      var width = record.el.offsetWidth || record.app.w || 540;
      var left = preset ? preset.left : 16 + wins.size * 24;
      var top = preset ? preset.top : 16 + wins.size * 24;
      left = Math.max(8, Math.min(left, Math.max(8, desk.clientWidth - width - 8)));
      top = Math.max(8, Math.min(top, Math.max(8, desk.clientHeight - 220)));
      record.el.style.left = left + "px";
      record.el.style.top = top + "px";
    }

    function toggleMax(record) {
      if (!record.max) {
        record.prev = {
          left: record.el.style.left,
          top: record.el.style.top,
          width: record.el.style.width,
          height: record.el.style.height
        };
        record.max = true;
        record.el.dataset.max = "1";
      } else {
        record.max = false;
        record.el.dataset.max = "0";
        if (record.prev) {
          record.el.style.left = record.prev.left;
          record.el.style.top = record.prev.top;
          record.el.style.width = record.prev.width;
          record.el.style.height = record.prev.height;
        }
      }
      focus(record.id);
    }

    function bind(record) {
      var el = record.el;
      var bar = el.querySelector(".win__bar");

      el.querySelector('[data-win="min"]').addEventListener("click", function (event) {
        event.stopPropagation();
        hide(record.id);
      });
      el.querySelector('[data-win="max"]').addEventListener("click", function (event) {
        event.stopPropagation();
        toggleMax(record);
      });
      el.querySelector('[data-win="close"]').addEventListener("click", function (event) {
        event.stopPropagation();
        close(record.id);
      });

      el.addEventListener("pointerdown", function () { focus(record.id); });
      bar.addEventListener("dblclick", function () { toggleMax(record); });
      bar.addEventListener("pointerdown", function (event) {
        if (event.target.closest("button") || record.max) return;
        var startX = event.clientX;
        var startY = event.clientY;
        var x0 = el.offsetLeft;
        var y0 = el.offsetTop;
        bar.setPointerCapture(event.pointerId);
        function move(e) {
          var nx = Math.max(0, Math.min(desk.clientWidth - 120, x0 + e.clientX - startX));
          var ny = Math.max(0, Math.min(desk.clientHeight - 40, y0 + e.clientY - startY));
          el.style.left = nx + "px";
          el.style.top = ny + "px";
        }
        function up(e) {
          bar.releasePointerCapture(e.pointerId);
          bar.removeEventListener("pointermove", move);
          bar.removeEventListener("pointerup", up);
        }
        bar.addEventListener("pointermove", move);
        bar.addEventListener("pointerup", up);
      });

      var handle = el.querySelector(".win__resize");
      handle.addEventListener("pointerdown", function (event) {
        event.stopPropagation();
        var startX = event.clientX;
        var startY = event.clientY;
        var w0 = el.offsetWidth;
        var h0 = el.offsetHeight;
        handle.setPointerCapture(event.pointerId);
        function move(e) {
          el.style.width = Math.max(300, w0 + e.clientX - startX) + "px";
          el.style.height = Math.max(220, h0 + e.clientY - startY) + "px";
        }
        function up(e) {
          handle.releasePointerCapture(e.pointerId);
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", up);
        }
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
      });
    }

    function create(record) {
      var fragment = template.content.cloneNode(true);
      var el = fragment.querySelector(".win");
      el.dataset.app = record.id;
      el.querySelector(".win__title").textContent = record.app.title;
      el.querySelector(".win__meta").textContent = record.app.meta || "";
      el.querySelector(".win__body").appendChild(record.panel.element);
      if (record.app.w) el.style.width = record.app.w + "px";
      if (record.app.h) el.style.height = record.app.h + "px";
      layer.appendChild(el);
      record.el = el;
      record.mounted = false;
      record.max = false;
      bind(record);
      position(record);
    }

    function mount(record) {
      if (record.mounted) return;
      record.mounted = true;
      if (typeof record.panel.mount === "function") record.panel.mount();
    }

    function open(id, app, panel) {
      var record = wins.get(id);
      if (!record) {
        record = { id: id, app: app, panel: panel, el: null, mounted: false, max: false };
        wins.set(id, record);
        create(record);
      }
      record.el.classList.remove("is-hidden");
      mount(record);
      focus(id);
      if (typeof record.panel.onShow === "function") record.panel.onShow();
      return record;
    }

    function hide(id) {
      var record = wins.get(id);
      if (!record) return;
      record.el.classList.add("is-hidden");
      onFocus(activeId());
    }

    function close(id) {
      var record = wins.get(id);
      if (!record) return;
      if (typeof record.panel.destroy === "function") record.panel.destroy();
      record.el.remove();
      wins.delete(id);
      onClose(id);
      onFocus(activeId());
    }

    function get(id) { return wins.get(id); }
    function has(id) { return wins.has(id); }
    function forEach(fn) { wins.forEach(fn); }

    return { open: open, hide: hide, close: close, focus: focus, get: get, has: has, forEach: forEach, activeId: activeId };
  };
})(window);
