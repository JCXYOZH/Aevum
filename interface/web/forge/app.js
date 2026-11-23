/* Root composition: state, module wiring, document actions, boot. */
(function (F) {
  "use strict";

  const $ = F.dom.$;

  const state = {
    doc: F.model.defaultDoc(),
    selected: { kind: "joint", index: 0 },
    sim: null,
    cam: F.render.createCamera(),
    bridge: F.bridge.create("ws://127.0.0.1:8765")
  };
  state.sim = F.control.createSim(state.doc);

  const canvas = $("gl");
  let labels = null;
  let renderer = null;
  try {
    labels = F.render.createJointLabels($("labels"), canvas);
    renderer = F.render.createRenderer(canvas, labels);
  } catch (e) {
    const stage = document.querySelector(".stage");
    if (stage) {
      stage.innerHTML = '<div style="padding:30px;color:#e45b58;font:600 14px Segoe UI">WebGL 不可用。请用 Chrome / Edge 打开。</div>';
    }
    return;
  }

  let tree = null;
  let inspector = null;
  let controls = null;
  let telemetry = null;

  function setKernelPill(online) {
    const pill = $("kernelPill");
    pill.textContent = online ? "KERNEL LINK" : "KERNEL OFFLINE";
    pill.className = online ? "pill on" : "pill warn";
  }

  function replaceDocument(doc, notify) {
    state.doc = F.model.validate(doc);
    state.selected = { kind: "joint", index: 0 };
    state.sim = F.control.createSim(state.doc);
    labels.ensure(state.doc);
    tree.render();
    inspector.render();
    controls.sync();
    telemetry.resize();
    if (notify) F.ui.toast.show("BodyDocument 已加载");
  }

  function saveDoc() {
    F.model.exportJson(state.doc, F.ui.toast.show);
  }

  function loadDoc(file) {
    F.dom.readFile(file, function (err, text) {
      if (err) {
        F.ui.toast.show("加载失败: " + err.message);
        return;
      }
      try {
        replaceDocument(JSON.parse(text), true);
      } catch (e) {
        F.ui.toast.show("加载失败: " + e.message);
      }
    });
  }

  const bridgeControl = F.app.createBridgeControl({
    state: state,
    setKernelPill: setKernelPill,
    rerenderInspector: function () { if (inspector) inspector.render(); },
    toast: F.ui.toast.show
  });

  tree = F.ui.createDocumentTree({
    state: state,
    tree: $("tree"),
    purpose: $("purpose"),
    selId: $("selId"),
    onSelect: function () { if (inspector) inspector.render(); }
  });

  inspector = F.ui.createInspector({
    state: state,
    container: $("inspector"),
    onTreeChange: function () { tree.render(); },
    onSave: saveDoc,
    onLoad: function () { $("fileDoc").click(); },
    onExportXml: function () { F.model.exportXml(state.doc, F.ui.toast.show); },
    onExportManifest: function () { F.model.exportManifest(state.doc, state.bridge, F.ui.toast.show); },
    onToggleBridge: bridgeControl.toggle
  });

  controls = F.ui.createControls({
    state: state,
    onRun: function () {
      state.sim.running = !state.sim.running;
      state.sim.last = performance.now();
      state.sim.acc = 0;
    },
    onSine: function () {
      state.sim.sine = !state.sim.sine;
      state.sim.running = true;
      state.sim.last = performance.now();
      F.ui.toast.show(state.sim.sine ? "正弦激励已开启" : "已回到目标角");
    },
    onReset: function () {
      F.control.reset(state.doc, state.sim);
      F.ui.toast.show("已复位到目标姿态");
    }
  });

  telemetry = F.ui.createTelemetryPanel({
    state: state,
    chart: $("chart"),
    onMetrics: function (metrics) {
      api._emit({
        type: "telemetry",
        rms: metrics.rms,
        peak: metrics.peak,
        torque: metrics.torque,
        time: state.sim.time,
        running: state.sim.running,
        sine: state.sim.sine,
        bridge: state.bridge.online
      });
    }
  });

  const handlers = F.app.createApiHandlers({
    state: state,
    controls: controls,
    inspector: inspector,
    replaceDocument: replaceDocument,
    saveDoc: saveDoc,
    bridgeControl: bridgeControl,
    toast: F.ui.toast.show
  });
  const api = F.api.bind(handlers);

  labels.ensure(state.doc);
  tree.render();
  inspector.render();
  controls.sync();
  telemetry.resize();
  setKernelPill(false);

  $("fileDoc").onchange = function (e) {
    if (e.target.files[0]) loadDoc(e.target.files[0]);
    e.target.value = "";
  };
  window.addEventListener("resize", function () { telemetry.resize(); });

  F.app.startFrameLoop({
    state: state,
    renderer: renderer,
    telemetry: telemetry,
    bridge: state.bridge
  });
})(window.AEVUM.FORGE);
