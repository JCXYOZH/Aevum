/* Bridge control: WebSocket lifecycle, kernel status ingest, manual joint command. */
(function (F) {
  "use strict";

  const Q16 = 65536;

  function createBridgeControl(opts) {
    const state = opts.state;
    const setKernelPill = opts.setKernelPill || function () {};
    const rerenderInspector = opts.rerenderInspector || function () {};
    const syncControls = opts.syncControls || function () {};
    const onKernelState = opts.onKernelState || function () {};
    const updateKernelStatus = opts.updateKernelStatus || function () {};
    const toast = opts.toast || function () {};

    function q16(v) {
      return (Number(v) || 0) / Q16;
    }

    function applyStatus(message) {
      const compat = F.model.kernelCompatibility(state.doc);
      if (!compat.ok) {
        if (!state.sim.kernelRejected) {
          state.sim.kernelRejected = true;
          toast("当前导入模型不接内核：" + compat.reason + "；仅本地建模/仿真");
        }
        return;
      }
      state.sim.kernelRejected = false;
      const values = message.values || {};
      const q = Array.isArray(message.q) && message.q.length === 3
        ? message.q
        : [q16(values.q0), q16(values.q1), q16(values.q2)];
      const wasKernel = state.sim.kernel;
      const wasMode = state.sim.kernelStatus ? state.sim.kernelStatus.mode : -1;
      const mode = Number(values.mode) || 0;

      /* 内核已经回 AUTO，但本地还停在 MANUAL：超过一个状态周期就跟随内核。 */
      if (mode === 0 && state.sim.manual &&
          performance.now() - (state.sim.manualSince || 0) > 1500) {
        state.sim.manual = false;
      }

      q.forEach(function (v, i) {
        if (state.doc.segments[i]) {
          state.doc.segments[i].q = v;
          if (!state.sim.manual) state.doc.segments[i].target = q16(values["qt" + i]);
          state.sim.q[i] = v;
          state.sim.qd[i] = q16(values["dq" + i]);
        }
      });
      state.sim.kernel = true;
      state.sim.running = false;
      state.sim.sine = false;
      state.sim.kernelStatus = {
        q: [q16(values.q0), q16(values.q1), q16(values.q2)],
        dq: [q16(values.dq0), q16(values.dq1), q16(values.dq2)],
        qTarget: [q16(values.qt0), q16(values.qt1), q16(values.qt2)],
        target: [q16(values.tx), q16(values.ty)],
        errMm: q16(values.err_mm),
        wManip: q16(values.w_manip),
        sigmaMin: q16(values.sigma_min),
        sigmaMax: q16(values.sigma_max),
        nullShare: q16(values.null_share),
        limitMargin: q16(values.limit_margin),
        mode: mode,
        nullOn: Number(values.null_on) || 0,
        at: performance.now()
      };
      state.sim.qHist.push(q.slice());
      if (state.sim.qHist.length > 360) state.sim.qHist.shift();
      if (!wasKernel) {
        setKernelPill("kernel");
        toast("Kernel 完整状态已接入；MANUAL 可下发关节目标");
      }
      syncControls();
      if (!wasKernel || wasMode !== mode) {
        rerenderInspector();
        onKernelState();
      }
      updateKernelStatus();
    }

    function applyMessage(message) {
      if (!message) return;
      if (message.type === "status" && message.values) {
        applyStatus(message);
        return;
      }
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
          toast("Kernel q 已接入；本地 PD 已暂停");
        }
        rerenderInspector();
      }
      if (Array.isArray(message.target)) {
        message.target.forEach(function (v, i) {
          if (state.doc.segments[i]) state.doc.segments[i].target = v;
        });
      }
    }

    function sendManual() {
      if (!state.sim.kernel) return false;
      return F.bridge.send(state.bridge, {
        type: "joint",
        q: state.doc.segments.map(function (s) { return +s.target.toFixed(5); })
      });
    }

    function sendRelease() {
      return F.bridge.send(state.bridge, { type: "release" }, true);
    }

    function setManual(on) {
      if (!state.sim.kernel) return;
      state.sim.manual = !!on;
      state.sim.manualSince = performance.now();
      if (state.sim.manual) {
        /* 从 AUTO 进入手动时先锁当前 q，避免跳到上一条 q_target。 */
        state.doc.segments.forEach(function (s) { s.target = s.q; });
        sendManual();
        toast("MANUAL 保持已开启；释放后立即回 AUTO，桥接断开时 5 秒兜底");
      } else {
        sendRelease();
        toast("MANUAL 已释放；内核立即回 AUTO");
      }
      syncControls();
      rerenderInspector();
    }

    function pulseManual() {
      if (!state.sim.kernel) return;
      state.sim.manual = true;
      state.sim.manualSince = performance.now();
      sendManual();
      syncControls();
    }

    function resetLink() {
      setKernelPill(false);
      state.sim.kernel = false;
      state.sim.manual = false;
      state.sim.manualSince = 0;
      state.sim.kernelStatus = null;
      state.sim.running = false;
      state.sim.sine = false;
      state.sim.qHist.length = 0;
      syncControls();
      rerenderInspector();
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
        onClose: resetLink,
        onError: function (e) {
          toast("Bridge 不可达；本地仿真继续" + (e && e.message ? "（" + e.message + "）" : ""));
        },
        onMessage: applyMessage
      });
    }

    function disconnect() {
      F.bridge.disconnect(state.bridge, { onClose: resetLink });
    }

    function toggle(url) {
      if (state.bridge.online) disconnect();
      else connect(url);
    }

    return {
      connect: connect,
      disconnect: disconnect,
      toggle: toggle,
      applyMessage: applyMessage,
      sendManual: sendManual,
      setManual: setManual,
      pulseManual: pulseManual
    };
  }

  F.app = F.app || {};
  F.app.createBridgeControl = createBridgeControl;
})(window.AEVUM.FORGE);
