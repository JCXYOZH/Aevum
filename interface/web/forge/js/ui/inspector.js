/* Right-side Inspector. Owns form markup and edits; delegates save/load/export/bridge. */
(function (F) {
  "use strict";

  const M = F.math;

  function createInspector(opts) {
    const state = opts.state;
    const container = opts.container;

    function render() {
      if (state.selected.kind === "base") {
        renderBase();
        return;
      }
      renderJoint();
    }

    function renderBase() {
      const doc = state.doc;
      if (F.model.isImported(doc)) {
        container.innerHTML = '<div class="group"><div class="gtitle">SCENE / IMPORTED GRAPH</div>'
          + '<div class="row"><span>DOCUMENT</span><output>' + doc.name + '</output></div>'
          + '<div class="row"><span>SEGMENTS</span><output>' + doc.segments.length + '</output></div>'
          + '<div class="row"><span>TRIANGLES</span><output>' + ((doc.meta && doc.meta.triangleCount) || 0) + '</output></div>'
          + '<div class="row"><span>SOURCE</span><output>' + ((doc.source && doc.source.file) || "-") + '</output></div>'
          + '<div class="note">导入模型按节点自动建 link/joint 树。点左侧关节编辑轴、原点、限位和目标角。</div>'
          + '</div>'
          + documentActions(true)
          + bridgeGroup();
        wireDocumentButtons();
        wireBridgeGroup();
        return;
      }
      container.innerHTML = '<div class="group"><div class="gtitle">BASE GEOMETRY</div>'
        + '<div class="split">'
        + '<div class="field"><label>WIDTH / m</label><input id="bw" type="number" step="0.01" value="' + M.fmt(doc.base.w, 2) + '"></div>'
        + '<div class="field"><label>HEIGHT / m</label><input id="bh" type="number" step="0.01" value="' + M.fmt(doc.base.h, 2) + '"></div>'
        + '</div>'
        + '<div class="field" style="margin-top:9px"><label>DEPTH / m</label><input id="bd" type="number" step="0.01" value="' + M.fmt(doc.base.d, 2) + '"></div>'
        + '<div class="note">Base 只负责固定基准。改尺寸会影响肩关节高度，但不会改控制逻辑。</div>'
        + '</div>'
        + documentActions(true);

      bind("bw", function (v) { doc.base.w = +v || 0.1; });
      bind("bh", function (v) { doc.base.h = +v || 0.1; });
      bind("bd", function (v) { doc.base.d = +v || 0.1; });
      wireDocumentButtons();
    }

    function documentActions(withImport) {
      return '<details class="group fold"><summary><span class="chev">›</span>Document <span class="meta">json · glTF</span></summary>'
        + '<div class="actions">'
        + '<button id="btnSave">Save JSON</button><button id="btnLoad">Load JSON</button>'
        + (withImport ? '<button class="amber" id="btnImport">Import glTF</button>' : '')
        + '</div><div class="note">导入 glTF 后自动生成 link/joint 树；JSON 保存当前建模树和关节参数。</div></details>';
    }

    function bridgeGroup() {
      return '<details class="group fold"><summary><span class="chev">›</span>Kernel bridge <span class="meta">websocket</span></summary>'
        + '<div class="bridge"><div class="status ' + (state.bridge.online ? "on" : "") + '" id="bridgeStatus">'
        + (state.bridge.online ? "CONNECTED" : "DISCONNECTED") + '</div>'
        + '<input id="bridgeUrl" type="text" value="' + state.bridge.url + '">'
        + '<button style="width:100%" id="btnBridge">' + (state.bridge.online ? "Disconnect" : "Connect") + '</button>'
        + '<div class="note">QEMU / 板子里的内核通过这个桥接接入。只有与固定 3R 几何兼容的链会被接管。</div>'
        + '</div></details>';
    }

    function wireBridgeGroup() {
      const btn = F.dom.$("btnBridge");
      if (btn) btn.onclick = function () { opts.onToggleBridge(F.dom.$("bridgeUrl").value.trim()); };
    }

    function kernelStatusMarkup() {
      return state.sim.kernel ? (
        '<details class="group fold" id="kernelStatusGroup" open><summary><span class="chev">›</span>Kernel status <span class="meta">0x03</span></summary>'
        + '<div class="row"><span>MODE</span><output id="ksMode">AUTO</output></div>'
        + '<div class="row"><span>END ERROR</span><output id="ksErr">-- mm</output></div>'
        + '<div class="row"><span>LIMIT MARGIN</span><output id="ksMargin">--</output></div>'
        + '<details class="subfold"><summary>Advanced kinematics</summary>'
        + '<div class="row"><span>MANIPULABILITY</span><output id="ksW">--</output></div>'
        + '<div class="row"><span>SIGMA MIN / MAX</span><output id="ksSigma">--</output></div>'
        + '<div class="row"><span>NULL SHARE</span><output id="ksNull">--</output></div>'
        + '<div class="row"><span>MAX |dq|</span><output id="ksDq">--</output></div>'
        + '<div class="row"><span>TARGET X / Y</span><output id="ksXY">--</output></div>'
        + '</details>'
        + '<div class="note">这里是内核真实状态，不是本地仿真。手动保持 5 秒无新命令回到 AUTO。</div>'
        + '</details>'
      ) : '';
    }

    function renderJoint() {
      const doc = state.doc;
      const i = state.selected.index;
      const s = doc.segments[i];
      if (!s) return;

      if (F.model.isImported(doc)) {
        renderImportedJoint(s, i);
        return;
      }

      container.innerHTML = '<div class="group"><div class="gtitle">JOINT ' + s.id + ' / ' + s.name + '</div>'
        + '<div class="row"><span>TARGET ANGLE</span><output id="vTarget">' + M.fmt(s.target * M.R2D, 1) + '°</output></div>'
        + '<input id="inTarget" type="range" min="' + s.min + '" max="' + s.max + '" step="0.1" value="' + M.fmt(s.target * M.R2D, 1) + '">'
        + '<div class="row"><span>ACTUAL ANGLE</span><output id="vActual">' + M.fmt(s.q * M.R2D, 1) + '°</output></div>'
        + '<div class="split" style="margin-top:10px">'
        + '<div class="field"><label>MIN / deg</label><input id="inMin" type="number" step="1" value="' + M.fmt(s.min, 0) + '"></div>'
        + '<div class="field"><label>MAX / deg</label><input id="inMax" type="number" step="1" value="' + M.fmt(s.max, 0) + '"></div>'
        + '</div>'
        + '<div class="split" style="margin-top:9px">'
        + '<div class="field"><label>TORQUE / N·m</label><input id="inTq" type="number" step="0.5" value="' + M.fmt(s.torque, 1) + '"></div>'
        + '<div class="field"><label>INERTIA</label><input id="inIn" type="number" step="0.001" value="' + M.fmt(s.inertia, 3) + '"></div>'
        + '</div>'
        + '<div class="split" style="margin-top:9px">'
        + '<div class="field"><label>KP</label><input id="inKp" type="number" step="1" value="' + M.fmt(s.kp, 0) + '"></div>'
        + '<div class="field"><label>KD</label><input id="inKd" type="number" step="1" value="' + M.fmt(s.kd, 0) + '"></div>'
        + '</div>'
        + '<div class="note">' + (state.sim.kernel
          ? 'KERNEL MANUAL：拖动 TARGET 会下发 q_target；ACTUAL 来自内核 0x03 状态帧。'
          : '拖动 TARGET 看 PD 跟踪。q 是相对父关节的角度；实际值来自本地仿真。')
        + '</div>'
        + '</div>'
        + kernelStatusMarkup()
        + '<details class="group fold"><summary><span class="chev">›</span>Link geometry <span class="meta">' + M.fmt(s.length, 2) + ' m</span></summary>'
        + '<div class="split">'
        + '<div class="field"><label>LENGTH / m</label><input id="inLen" type="number" step="0.01" value="' + M.fmt(s.length, 2) + '"></div>'
        + '<div class="field"><label>WIDTH / m</label><input id="inWid" type="number" step="0.01" value="' + M.fmt(s.width, 2) + '"></div>'
        + '</div>'
        + '<div class="field" style="margin-top:9px"><label>DEPTH / m</label><input id="inDep" type="number" step="0.01" value="' + M.fmt(s.depth, 2) + '"></div>'
        + '<div class="note">只改 link 尺寸和 joint 参数；不做网格雕刻，也不进入材质系统。</div>'
        + '</details>'
        + documentActions(true)
        + bridgeGroup();

      bind("inTarget", function (v) {
        s.target = +v * M.D2R;
        const out = F.dom.$("vTarget");
        if (out) out.textContent = M.fmt(+v, 1) + "°";
        if (state.sim.kernel && opts.onKernelTarget) opts.onKernelTarget();
      });
      bind("inMin", function (v) {
        s.min = +v;
        s.q = M.clamp(s.q, s.min * M.D2R, s.max * M.D2R);
        state.sim.q[i] = s.q;
      });
      bind("inMax", function (v) {
        s.max = +v;
        s.q = M.clamp(s.q, s.min * M.D2R, s.max * M.D2R);
        state.sim.q[i] = s.q;
      });
      bind("inTq", function (v) { s.torque = Math.max(0, +v); });
      bind("inIn", function (v) { s.inertia = Math.max(0.001, +v); });
      bind("inKp", function (v) { s.kp = Math.max(0, +v); });
      bind("inKd", function (v) { s.kd = Math.max(0, +v); });
      bind("inLen", function (v) {
        s.length = Math.max(0.05, +v);
        if (opts.onTreeChange) opts.onTreeChange();
      });
      bind("inWid", function (v) { s.width = Math.max(0.01, +v); });
      bind("inDep", function (v) { s.depth = Math.max(0.01, +v); });

      wireDocumentButtons();
      wireBridgeGroup();
    }

    function bind(id, handler) {
      const el = F.dom.$(id);
      if (!el) return;
      el.oninput = function (e) { handler(e.target.value); };
    }

    function wireDocumentButtons() {
      const save = F.dom.$("btnSave");
      const load = F.dom.$("btnLoad");
      const imp = F.dom.$("btnImport");
      if (save) save.onclick = function () { opts.onSave(); };
      if (load) load.onclick = function () { opts.onLoad(); };
      if (imp) imp.onclick = function () { if (opts.onImport) opts.onImport(); };
    }

    function renderImportedJoint(s, i) {
      const compat = F.model.kernelCompatibility(state.doc);
      const mesh = s.mesh || {};
      const bounds = mesh.bounds && mesh.bounds.size ? mesh.bounds.size : [s.length, s.width, s.depth];
      container.innerHTML = '<div class="group"><div class="gtitle">JOINT ' + s.id + ' / ' + s.name + '</div>'
        + '<div class="row"><span>TARGET ANGLE</span><output id="vTarget">' + M.fmt(s.target * M.R2D, 1) + '°</output></div>'
        + '<input id="inTarget" type="range" min="' + s.min + '" max="' + s.max + '" step="0.1" value="' + M.fmt(s.target * M.R2D, 1) + '">'
        + '<div class="row"><span>ACTUAL ANGLE</span><output id="vActual">' + M.fmt(s.q * M.R2D, 1) + '°</output></div>'
        + '<div class="split" style="margin-top:10px">'
        + '<div class="field"><label>MIN / deg</label><input id="inMin" type="number" step="1" value="' + M.fmt(s.min, 0) + '"></div>'
        + '<div class="field"><label>MAX / deg</label><input id="inMax" type="number" step="1" value="' + M.fmt(s.max, 0) + '"></div>'
        + '</div>'
        + '<div class="note">拖动 TARGET 直接改这个 joint 的 q。导入模型默认使用本地关节空间 PD。</div>'
        + '</div>'
        + '<div class="group"><div class="gtitle">JOINT FRAME</div>'
        + '<div class="row"><span>AXIS</span><output id="axisRead">' + M.fmt(s.joint.axis[0], 2) + " / " + M.fmt(s.joint.axis[1], 2) + " / " + M.fmt(s.joint.axis[2], 2) + '</output></div>'
        + '<div class="split">'
        + '<div class="field"><label>AXIS X</label><input id="inAx" type="number" step="0.01" value="' + M.fmt(s.joint.axis[0], 3) + '"></div>'
        + '<div class="field"><label>AXIS Y</label><input id="inAy" type="number" step="0.01" value="' + M.fmt(s.joint.axis[1], 3) + '"></div>'
        + '</div>'
        + '<div class="field" style="margin-top:9px"><label>AXIS Z</label><input id="inAz" type="number" step="0.01" value="' + M.fmt(s.joint.axis[2], 3) + '"></div>'
        + '<div class="row" style="margin-top:9px"><span>ORIGIN / m</span><output id="originRead">' + M.fmt(s.joint.origin[0], 3) + " / " + M.fmt(s.joint.origin[1], 3) + " / " + M.fmt(s.joint.origin[2], 3) + '</output></div>'
        + '<div class="split">'
        + '<div class="field"><label>ORIGIN X</label><input id="inOx" type="number" step="0.01" value="' + M.fmt(s.joint.origin[0], 3) + '"></div>'
        + '<div class="field"><label>ORIGIN Y</label><input id="inOy" type="number" step="0.01" value="' + M.fmt(s.joint.origin[1], 3) + '"></div>'
        + '</div>'
        + '<div class="field" style="margin-top:9px"><label>ORIGIN Z</label><input id="inOz" type="number" step="0.01" value="' + M.fmt(s.joint.origin[2], 3) + '"></div>'
        + '</div>'
        + '<details class="group fold"><summary><span class="chev">›</span>Local PD / mesh <span class="meta">' + ((mesh.triangles) || 0) + ' tris</span></summary>'
        + '<div class="split">'
        + '<div class="field"><label>TORQUE / N·m</label><input id="inTq" type="number" step="0.5" value="' + M.fmt(s.torque, 1) + '"></div>'
        + '<div class="field"><label>INERTIA</label><input id="inIn" type="number" step="0.001" value="' + M.fmt(s.inertia, 3) + '"></div>'
        + '</div>'
        + '<div class="split" style="margin-top:9px">'
        + '<div class="field"><label>KP</label><input id="inKp" type="number" step="1" value="' + M.fmt(s.kp, 0) + '"></div>'
        + '<div class="field"><label>KD</label><input id="inKd" type="number" step="1" value="' + M.fmt(s.kd, 0) + '"></div>'
        + '</div>'
        + '<div class="row" style="margin-top:9px"><span>MESH BOUNDS</span><output>' + M.fmt(bounds[0], 3) + " × " + M.fmt(bounds[1], 3) + " × " + M.fmt(bounds[2], 3) + ' m</output></div>'
        + '<div class="row"><span>TRIANGLES</span><output>' + ((mesh.triangles) || 0) + '</output></div>'
        + '<div class="note">KERNEL: ' + (compat.ok ? "COMPATIBLE / " + compat.reason : "LOCAL ONLY / " + compat.reason) + '</div>'
        + '</details>'
        + kernelStatusMarkup()
        + documentActions(true)
        + bridgeGroup();

      bind("inTarget", function (v) {
        s.target = +v * M.D2R;
        const out = F.dom.$("vTarget");
        if (out) out.textContent = M.fmt(+v, 1) + "°";
        if (state.sim.kernel && opts.onKernelTarget) opts.onKernelTarget();
      });
      bind("inMin", function (v) {
        s.min = +v;
        s.q = M.clamp(s.q, s.min * M.D2R, s.max * M.D2R);
        state.sim.q[i] = s.q;
      });
      bind("inMax", function (v) {
        s.max = +v;
        s.q = M.clamp(s.q, s.min * M.D2R, s.max * M.D2R);
        state.sim.q[i] = s.q;
      });
      bind("inTq", function (v) { s.torque = Math.max(0, +v); });
      bind("inIn", function (v) { s.inertia = Math.max(0.001, +v); });
      bind("inKp", function (v) { s.kp = Math.max(0, +v); });
      bind("inKd", function (v) { s.kd = Math.max(0, +v); });
      function setAxis(id, c) {
        bind(id, function (v) {
          s.joint.axis[c] = +v;
          const read = F.dom.$("axisRead");
          if (read) read.textContent = M.fmt(s.joint.axis[0], 2) + " / " + M.fmt(s.joint.axis[1], 2) + " / " + M.fmt(s.joint.axis[2], 2);
        });
      }
      setAxis("inAx", 0);
      setAxis("inAy", 1);
      setAxis("inAz", 2);
      function setOrigin(id, c) {
        bind(id, function (v) {
          s.joint.origin[c] = +v;
          const read = F.dom.$("originRead");
          if (read) read.textContent = M.fmt(s.joint.origin[0], 3) + " / " + M.fmt(s.joint.origin[1], 3) + " / " + M.fmt(s.joint.origin[2], 3);
        });
      }
      setOrigin("inOx", 0);
      setOrigin("inOy", 1);
      setOrigin("inOz", 2);
      wireDocumentButtons();
      wireBridgeGroup();
    }

    function updateRuntime() {
      const s = state.doc.segments[state.selected.index];
      if (!s) return;
      function set(id, text) {
        const el = F.dom.$(id);
        if (el) el.textContent = text;
      }
      set("vActual", M.fmt(s.q * M.R2D, 1) + "°");
      const slider = F.dom.$("inTarget");
      if (slider && document.activeElement !== slider) {
        slider.value = M.fmt(s.target * M.R2D, 1);
        set("vTarget", M.fmt(s.target * M.R2D, 1) + "°");
      }
      if (!state.sim.kernel) return;
      const st = state.sim.kernelStatus;
      if (!st) return;
      set("ksMode", st.mode === 1 ? "MANUAL HOLD" : "AUTO");
      set("ksErr", M.fmt(st.errMm, 2) + " mm");
      set("ksW", M.fmt(st.wManip, 4));
      set("ksSigma", M.fmt(st.sigmaMin, 4) + " / " + M.fmt(st.sigmaMax, 4));
      set("ksNull", M.fmt(st.nullShare * 100, 1) + " %");
      set("ksMargin", M.fmt(st.limitMargin, 1) + "°");
      const dq = Math.max(Math.abs(st.dq[0]), Math.abs(st.dq[1]), Math.abs(st.dq[2]));
      set("ksDq", M.fmt(dq, 3) + " rad/s");
      set("ksXY", M.fmt(st.target[0], 3) + " / " + M.fmt(st.target[1], 3) + " m");
    }

    return { render: render, updateRuntime: updateRuntime };
  }

  F.ui.createInspector = createInspector;
})(window.AEVUM.FORGE);
