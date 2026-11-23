/* RequestAnimationFrame loop. Owns time order, not scene or control formulas. */
(function (F) {
  "use strict";

  F.app = F.app || {};
  F.app.startFrameLoop = function (opts) {
    const state = opts.state;
    const renderer = opts.renderer;
    const telemetry = opts.telemetry;
    const bridge = opts.bridge;

    function frame(now) {
      const scene = F.render.buildArmScene(state.doc);
      const vp = F.render.viewProjection(state.cam, renderer.canvas);
      renderer.draw(state.doc, scene, vp, state.selected);

      if (state.sim.running && !state.sim.kernel) {
        F.control.tick(state.doc, state.sim, now, function (packet) {
          F.bridge.send(bridge, packet);
        });
      }
      telemetry.update(now);

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  };
})(window.AEVUM.FORGE);
