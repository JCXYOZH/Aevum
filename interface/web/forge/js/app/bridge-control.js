/* Bridge control: WebSocket lifecycle + inbound q/target application. */
(function (F) {
  "use strict";

  F.app = F.app || {};
  F.app.createBridgeControl = function (opts) {
    const state = opts.state;
    const setKernelPill = opts.setKernelPill || function () {};
    const rerenderInspector = opts.rerenderInspector || function () {};
    const syncControls = opts.syncControls || function () {};
    const onKernelState = opts.onKernelState || function () {};
    const toast = opts.toast || function () {};

    function applyMessage(message) {
      if (!message) return;
      if (Array.isArray(message.q) && message.q.length === 3) {
        const wasKernel = state.sim.kernel;
        message.q.forEach(function (v, i) {
          if (state.doc.segments[i]) {
            state.doc.segments[i].q = v;
            state.sim.q[i] = v;
            state.sim.qd[i] = 0;
          }
        });
        state.sim.kernel = true;
        state.sim.running = false;
        state.sim.sine = false;
        state.sim.qHist.push(message.q.slice());
        if (state.sim.qHist.length > 360) state.sim.qHist.shift();
        if (!wasKernel) {
          setKernelPill("kernel");
          syncControls();
          onKernelState();
          toast("Kernel q 已接入；本地 PD 已暂停（只读）");
        }
        rerenderInspector();
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
          setKernelPill("bridge");
          syncControls();
          rerenderInspector();
          toast("Bridge connected");
        },
        onClose: function () {
          setKernelPill(false);
          state.sim.kernel = false;
          state.sim.running = false;
          state.sim.sine = false;
          state.sim.qHist.length = 0;
          syncControls();
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
          state.sim.kernel = false;
          state.sim.running = false;
          state.sim.sine = false;
          state.sim.qHist.length = 0;
          syncControls();
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
