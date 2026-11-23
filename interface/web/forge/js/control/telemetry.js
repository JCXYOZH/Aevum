/* Telemetry metrics: read-only projection of doc + sim. */
(function (F) {
  "use strict";

  const R2D = F.math.R2D;

  function metrics(doc, sim) {
    const errs = doc.segments.map(function (s) {
      return Math.abs((s.target - s.q) * R2D);
    });
    const rms = Math.sqrt(errs.reduce(function (a, b) { return a + b * b; }, 0) / errs.length);
    const peak = Math.max.apply(null, errs);
    const torque = doc.segments.reduce(function (a, s, i) {
      return a + Math.abs(s.kp * (s.target - s.q) - s.kd * sim.qd[i]);
    }, 0);
    return { errs: errs, rms: rms, peak: peak, torque: torque, loss: 0 };
  }

  F.control = F.control || {};
  F.control.metrics = metrics;
})(window.AEVUM.FORGE);
