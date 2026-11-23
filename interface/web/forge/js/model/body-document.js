/* BodyDocument: the only place that defines the robot body schema and defaults. */
(function (F) {
  "use strict";

  function defaultDoc() {
    return {
      format: "aevum.body/0",
      name: "AEVUM 3R ARM",
      base: { w: 0.54, h: 0.24, d: 0.38, mass: 2.2, color: [0.15, 0.19, 0.23] },
      segments: [
        { id: "J1", name: "SHOULDER", q: -0.35, target: -0.35, min: -170, max: 170, torque: 12, inertia: 0.035, damping: 0.05, kp: 38, kd: 9, length: 0.62, width: 0.12, depth: 0.14, mass: 1.1, color: [0.18, 0.62, 0.72] },
        { id: "J2", name: "ELBOW", q: 0.68, target: 0.68, min: -150, max: 150, torque: 9, inertia: 0.022, damping: 0.04, kp: 32, kd: 7, length: 0.52, width: 0.10, depth: 0.12, mass: 0.8, color: [0.22, 0.50, 0.70] },
        { id: "J3", name: "WRIST", q: -1.05, target: -1.05, min: -170, max: 170, torque: 5, inertia: 0.012, damping: 0.03, kp: 24, kd: 5, length: 0.24, width: 0.075, depth: 0.09, mass: 0.35, color: [0.70, 0.45, 0.18] }
      ],
      tool: { length: 0.20, width: 0.075, depth: 0.09, color: [0.82, 0.55, 0.22] },
      control: { loop_hz: 100, dt: 0.01 }
    };
  }

  function clone(doc) {
    return JSON.parse(JSON.stringify(doc));
  }

  function validate(doc) {
    if (!doc || !Array.isArray(doc.segments) || !doc.segments.length) {
      throw new Error("missing segments");
    }
    if (!doc.base || !doc.tool || !doc.control) {
      throw new Error("missing base/tool/control");
    }
    return doc;
  }

  F.model = F.model || {};
  F.model.defaultDoc = defaultDoc;
  F.model.clone = clone;
  F.model.validate = validate;
})(window.AEVUM.FORGE);
