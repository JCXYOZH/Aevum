/* API command implementation. Public signatures are declared in api.js only. */
(function (F) {
  "use strict";

  F.app = F.app || {};
  F.app.createApiHandlers = function (deps) {
    const state = deps.state;
    const controls = deps.controls;
    const inspector = deps.inspector;
    const replaceDocument = deps.replaceDocument;
    const saveDoc = deps.saveDoc;
    const bridgeControl = deps.bridgeControl;
    const toast = deps.toast;
    const M = F.math;

    function getState() {
      return {
        running: state.sim.running,
        sine: state.sim.sine,
        time: state.sim.time,
        q: state.sim.q.slice(),
        target: state.doc.segments.map(function (s) { return s.target; }),
        selected: { kind: state.selected.kind, index: state.selected.index },
        bridge: { online: state.bridge.online, url: state.bridge.url },
        document: F.model.clone(state.doc)
      };
    }

    return {
      getState: getState,
      getDocument: function () { return F.model.clone(state.doc); },
      setDocument: function (doc) { replaceDocument(F.model.clone(doc), true); },
      setTarget: function (index, degrees) {
        const s = state.doc.segments[index];
        if (!s) throw new Error("joint index out of range");
        s.target = degrees * M.D2R;
        inspector.render();
      },
      setTargets: function (degrees) {
        degrees.forEach(function (v, i) {
          const s = state.doc.segments[i];
          if (s) s.target = v * M.D2R;
        });
        inspector.render();
      },
      run: function () {
        state.sim.running = true;
        state.sim.last = performance.now();
        state.sim.acc = 0;
        controls.sync();
      },
      pause: function () {
        state.sim.running = false;
        controls.sync();
      },
      reset: function () {
        F.control.reset(state.doc, state.sim);
        controls.sync();
      },
      sine: function (on) {
        state.sim.sine = on === undefined ? !state.sim.sine : !!on;
        if (state.sim.sine) state.sim.running = true;
        state.sim.last = performance.now();
        controls.sync();
      },
      getTelemetry: function () { return F.control.metrics(state.doc, state.sim); },
      exportJson: saveDoc,
      exportXml: function () { F.model.exportXml(state.doc, toast); },
      exportManifest: function () { F.model.exportManifest(state.doc, state.bridge, toast); },
      connect: bridgeControl.connect,
      disconnect: bridgeControl.disconnect
    };
  };
})(window.AEVUM.FORGE);
