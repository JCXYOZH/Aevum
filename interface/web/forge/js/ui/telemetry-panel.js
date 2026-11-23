/* Footer telemetry + error chart. Read-only view of state. */
(function (F) {
  "use strict";

  function createTelemetryPanel(opts) {
    const state = opts.state;
    const chart = opts.chart;
    const ctx = chart.getContext("2d");
    const onMetrics = opts.onMetrics || function () {};

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = chart.clientWidth || 1;
      const h = chart.clientHeight || 1;
      if (chart.width !== Math.floor(w * dpr) || chart.height !== Math.floor(h * dpr)) {
        chart.width = Math.floor(w * dpr);
        chart.height = Math.floor(h * dpr);
      }
    }

    function drawChart() {
      resize();
      const w = chart.width;
      const h = chart.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#0b1014";
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "#1d2a31";
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = h * i / 4;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      if (state.sim.kernel) {
        drawKernelChart(w, h);
        return;
      }

      const data = state.sim.errHist;
      if (data.length > 1) {
        ctx.strokeStyle = "#37c7d4";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        data.forEach(function (v, i) {
          const x = i / (data.length - 1) * w;
          const y = h - F.math.clamp(v, 0, 40) / 40 * h;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.stroke();
      }

      ctx.fillStyle = "#6d838c";
      ctx.font = "10px Segoe UI";
      ctx.fillText("JOINT ERROR / 40° FULL SCALE", 8, 14);
    }

    function drawKernelChart(w, h) {
      const colors = ["#37c7d4", "#e0a34a", "#9a7ad6"];
      const data = state.sim.qHist;
      if (data.length > 1) {
        for (let j = 0; j < 3; j++) {
          ctx.strokeStyle = colors[j];
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          data.forEach(function (q, i) {
            const deg = F.math.clamp(q[j] * F.math.R2D, -180, 180);
            const x = i / (data.length - 1) * w;
            const y = h - (deg + 180) / 360 * h;
            if (i) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
          });
          ctx.stroke();
        }
      }
      ctx.fillStyle = "#6d838c";
      ctx.font = "10px Segoe UI";
      ctx.fillText(state.sim.manual ? "KERNEL q / MANUAL HOLD · DEG" : "KERNEL q / AUTO · DEG", 8, 14);
      ctx.fillStyle = "#37c7d4";
      ctx.fillText("J1", 170, 14);
      ctx.fillStyle = "#e0a34a";
      ctx.fillText("J2", 188, 14);
      ctx.fillStyle = "#9a7ad6";
      ctx.fillText("J3", 206, 14);
    }

    function update(now) {
      if (now - state.sim.lastUi < 80) return;
      state.sim.lastUi = now;

      const kernel = !!state.sim.kernel;
      if (kernel) {
        const st = state.sim.kernelStatus || {};
        F.dom.$("mLoop").textContent = "KERNEL 0x03";
        F.dom.$("mMode").textContent = st.mode === 1 ? "manual hold" : "auto fallback";
        F.dom.$("mRms").textContent = st.errMm == null ? "N/A" : F.math.fmt(st.errMm, 2) + " mm";
        F.dom.$("mPeak").textContent = st.wManip == null ? "N/A" : F.math.fmt(st.wManip, 4);
        F.dom.$("mTorque").textContent = st.sigmaMin == null ? "N/A" : F.math.fmt(st.sigmaMin, 3) + " / " + F.math.fmt(st.sigmaMax, 3);
        F.dom.$("mLoss").textContent = st.nullShare == null ? "N/A" : F.math.fmt(st.nullShare * 100, 1) + "%";
        F.dom.$("mTime").textContent = st.limitMargin == null ? "N/A" : F.math.fmt(st.limitMargin, 1) + "°";
        F.dom.$("mRms").nextElementSibling.textContent = "end effector";
        F.dom.$("mPeak").nextElementSibling.textContent = "manipulability";
        F.dom.$("mTorque").nextElementSibling.textContent = "sigma min / max";
        F.dom.$("mLoss").nextElementSibling.textContent = "null-space share";
        F.dom.$("mTime").nextElementSibling.textContent = "limit margin";
        drawChart();
        onMetrics({
          kernel: true,
          manual: !!state.sim.manual,
          q: state.sim.q.slice(),
          dq: (st.dq || [0, 0, 0]).slice(),
          qTarget: (st.qTarget || [0, 0, 0]).slice(),
          target: (st.target || [0, 0]).slice(),
          errMm: st.errMm,
          wManip: st.wManip,
          sigmaMin: st.sigmaMin,
          sigmaMax: st.sigmaMax,
          nullShare: st.nullShare,
          limitMargin: st.limitMargin,
          mode: st.mode,
          rms: null,
          peak: null,
          torque: null,
          loss: 0
        });
        return;
      }

      const doc = state.doc;
      const metrics = F.control.metrics(doc, state.sim);

      F.dom.$("mLoop").textContent = state.sim.running ? "100 Hz" : "PAUSED";
      F.dom.$("mMode").textContent = state.bridge.online ? "bridge live" : (state.sim.sine ? "sine injection" : "local PD");
      F.dom.$("mRms").textContent = F.math.fmt(metrics.rms, 1) + "°";
      F.dom.$("mPeak").textContent = F.math.fmt(metrics.peak, 1) + "°";
      F.dom.$("mTorque").textContent = F.math.fmt(metrics.torque, 1);
      F.dom.$("mLoss").textContent = "0";
      F.dom.$("mTime").textContent = F.math.fmt(state.sim.time, 2);
      F.dom.$("mRms").nextElementSibling.textContent = "target vs actual";
      F.dom.$("mPeak").nextElementSibling.textContent = "last 3 seconds";
      F.dom.$("mTorque").nextElementSibling.textContent = "N·m / all joints";
      F.dom.$("mTime").nextElementSibling.textContent = "seconds";

      drawChart();
      onMetrics(metrics);
    }

    return { update: update, resize: resize, drawChart: drawChart };
  }

  F.ui.createTelemetryPanel = createTelemetryPanel;
})(window.AEVUM.FORGE);
