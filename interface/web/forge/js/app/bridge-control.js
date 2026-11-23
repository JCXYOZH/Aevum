/* Bridge control: WebSocket lifecycle + inbound q/target application. */
(function (F) {
  "use strict";

  F.app = F.app || {};
  F.app.createBridgeControl = function (opts) {
    const state = opts.state;
    const setKernelPill = opts.setKernelPill || function () {};
    const rerenderInspector = opts.rerenderInspector || function () {};
    const toast = opts.toast || function () {};

    function applyMessage(message) {
      if (!message) return;
      if (Array.isArray(message.q)) {
        message.q.forEach(function (v, i) {
          if (state.doc.segments[i]) {
            state.doc.segments[i].q = v;
            state.sim.q[i] = v;
          }
        });
      }
      if (Array.isArray(message.target)) {
        message.target.forEach(function (v, i) {
          if (state.doc.segments[i]) state.doc.segments[i].target = v;
        });
      }
    }

    function connect(url) {
      state.bridge.url = url || state.bridge.url;
      if (state.bridge.online) return;
      F.bridge.connect(state.bridge, {
        onOpen: function () {
          setKernelPill(true);
          rerenderInspector();
          toast("Bridge connected");
        },
        onClose: function () {
          setKernelPill(false);
          rerenderInspector();
        },
        onError: function (e) {
          toast("Bridge 不可达；本地仿真继续" + (e && e.message ? "（" + e.message + "）" : ""));
        },
        onMessage: applyMessage
      });
    }

    function disconnect() {
      F.bridge.disconnect(state.bridge, {
        onClose: function () {
          setKernelPill(false);
          rerenderInspector();
        }
      });
    }

    function toggle(url) {
      if (state.bridge.online) disconnect();
      else connect(url);
    }

    return { connect: connect, disconnect: disconnect, toggle: toggle, applyMessage: applyMessage };
  };
})(window.AEVUM.FORGE);
