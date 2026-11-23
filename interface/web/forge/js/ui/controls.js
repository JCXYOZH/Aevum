/* Header transport controls. Only mutates state through callbacks supplied by app.js. */
(function (F) {
  "use strict";

  function createControls(opts) {
    const state = opts.state;
    const btnRun = F.dom.$("btnRun");
    const btnSine = F.dom.$("btnSine");
    const btnReset = F.dom.$("btnReset");
    const modePill = F.dom.$("modePill");

    function sync() {
      const kernel = !!state.sim.kernel;
      btnRun.textContent = kernel ? "KERNEL MODE" : (state.sim.running ? "PAUSE" : "RUN");
      btnSine.textContent = kernel ? "SINE OFF" : (state.sim.sine ? "SINE ON" : "SINE TEST");
      btnRun.disabled = kernel;
      btnSine.disabled = kernel;
      btnReset.disabled = kernel;
      if (kernel) {
        modePill.textContent = "KERNEL q / READ ONLY";
        modePill.className = "pill on";
      } else if (state.bridge.online) {
        modePill.textContent = "BRIDGE / WAIT q";
        modePill.className = "pill on";
      } else {
        modePill.textContent = state.sim.running ? "LOCAL SIM / RUN" : "LOCAL SIM";
        modePill.className = state.sim.running ? "pill on" : "pill";
      }
    }

    btnRun.onclick = function () {
      opts.onRun();
      sync();
    };
    btnSine.onclick = function () {
      opts.onSine();
      sync();
    };
    btnReset.onclick = function () {
      opts.onReset();
      sync();
    };

    return { sync: sync };
  }

  F.ui.createControls = createControls;
})(window.AEVUM.FORGE);
