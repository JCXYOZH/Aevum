/* =================================================================
   core/bus.js —— 极简事件总线
   组件之间只通过事件名通信，谁也不直接引用谁。
   事件清单见 web/README.md。
   ================================================================= */

window.AEVUM = window.AEVUM || {};

(function (A) {
  "use strict";

  const handlers = new Map();

  A.bus = {
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => A.bus.off(name, fn);
    },

    off(name, fn) {
      const set = handlers.get(name);
      if (set) set.delete(fn);
    },

    emit(name, payload) {
      const set = handlers.get(name);
      if (!set) return;
      for (const fn of Array.from(set)) {
        try {
          fn(payload);
        } catch (err) {
          console.error("[bus] handler failed:", name, err);
        }
      }
    },
  };
})(window.AEVUM);
