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
      ctx.fillText("KERNEL q / READ ONLY · DEG", 8, 14);
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
        F.dom.$("mLoop").textContent = "KERNEL q";
        F.dom.$("mMode").textContent = "read-only · local PD off";
        F.dom.$("mRms").textContent = "N/A";
        F.dom.$("mPeak").textContent = "N/A";
        F.dom.$("mTorque").textContent = "N/A";
        F.dom.$("mLoss").textContent = "0";
        F.dom.$("mTime").textContent = "N/A";
        F.dom.$("mRms").nextElementSibling.textContent = "kernel q / read only";
        F.dom.$("mPeak").nextElementSibling.textContent = "not measured";
        F.dom.$("mTorque").nextElementSibling.textContent = "local PD off";
        F.dom.$("mTime").nextElementSibling.textContent = "local PD off";
        drawChart();
        onMetrics({
          kernel: true,
          q: state.sim.q.slice(),
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
