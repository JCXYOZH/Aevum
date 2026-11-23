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
      container.innerHTML = '<div class="group"><div class="gtitle">BASE GEOMETRY</div>'
        + '<div class="split">'
        + '<div class="field"><label>WIDTH / m</label><input id="bw" type="number" step="0.01" value="' + M.fmt(doc.base.w, 2) + '"></div>'
        + '<div class="field"><label>HEIGHT / m</label><input id="bh" type="number" step="0.01" value="' + M.fmt(doc.base.h, 2) + '"></div>'
        + '</div>'
        + '<div class="field" style="margin-top:9px"><label>DEPTH / m</label><input id="bd" type="number" step="0.01" value="' + M.fmt(doc.base.d, 2) + '"></div>'
        + '<div class="note">Base 只负责固定基准。改尺寸会影响肩关节高度，但不会改控制逻辑。</div>'
        + '</div>'
        + '<div class="group"><div class="gtitle">DOCUMENT</div><div class="actions">'
        + '<button id="btnSave">SAVE JSON</button><button id="btnLoad">LOAD JSON</button>'
        + '</div></div>';

      bind("bw", function (v) { doc.base.w = +v || 0.1; });
      bind("bh", function (v) { doc.base.h = +v || 0.1; });
      bind("bd", function (v) { doc.base.d = +v || 0.1; });
      wireDocumentButtons();
    }

    function renderJoint() {
      const doc = state.doc;
      const i = state.selected.index;
      const s = doc.segments[i];
      if (!s) return;

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
        + '<div class="note">拖动 TARGET 看 PD 跟踪。q 是相对父关节的角度；实际值来自本地仿真。</div>'
        + '</div>'
        + '<div class="group"><div class="gtitle">LINK GEOMETRY</div>'
        + '<div class="split">'
        + '<div class="field"><label>LENGTH / m</label><input id="inLen" type="number" step="0.01" value="' + M.fmt(s.length, 2) + '"></div>'
        + '<div class="field"><label>WIDTH / m</label><input id="inWid" type="number" step="0.01" value="' + M.fmt(s.width, 2) + '"></div>'
        + '</div>'
        + '<div class="field" style="margin-top:9px"><label>DEPTH / m</label><input id="inDep" type="number" step="0.01" value="' + M.fmt(s.depth, 2) + '"></div>'
        + '<div class="note">这是机器人专用建模：只改 link 尺寸和 joint 参数，不做网格雕刻、不碰材质系统。</div>'
        + '</div>'
        + '<div class="group"><div class="gtitle">DOCUMENT OUTPUT</div>'
        + '<div class="actions"><button id="btnSave">SAVE JSON</button><button id="btnLoad">LOAD JSON</button></div>'
        + '<div class="actions" style="margin-top:7px"><button class="amber" id="btnXml">MUJOCO XML</button><button id="btnManifest">BUS MANIFEST</button></div>'
        + '</div>'
        + '<div class="group"><div class="gtitle">KERNEL BRIDGE / EXPERIMENTAL SEAM</div>'
        + '<div class="bridge"><div class="status ' + (state.bridge.online ? "on" : "") + '" id="bridgeStatus">'
        + (state.bridge.online ? "CONNECTED" : "DISCONNECTED") + '</div>'
        + '<input id="bridgeUrl" type="text" value="' + state.bridge.url + '">'
        + '<button style="width:100%" id="btnBridge">' + (state.bridge.online ? "DISCONNECT" : "CONNECT") + '</button>'
        + '<div class="note">内核不在这里被 import。它跑在 QEMU/板子里；这里只接临时 WebSocket 桥，报文格式见 BUS MANIFEST。</div>'
        + '</div></div>';

      bind("inTarget", function (v) {
        s.target = +v * M.D2R;
        const out = F.dom.$("vTarget");
        if (out) out.textContent = M.fmt(+v, 1) + "°";
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
      F.dom.$("btnXml").onclick = function () { opts.onExportXml(); };
      F.dom.$("btnManifest").onclick = function () { opts.onExportManifest(); };
      F.dom.$("btnBridge").onclick = function () {
        opts.onToggleBridge(F.dom.$("bridgeUrl").value.trim());
      };
    }

    function bind(id, handler) {
      const el = F.dom.$(id);
      if (!el) return;
      el.oninput = function (e) { handler(e.target.value); };
    }

    function wireDocumentButtons() {
      const save = F.dom.$("btnSave");
      const load = F.dom.$("btnLoad");
      if (save) save.onclick = function () { opts.onSave(); };
      if (load) load.onclick = function () { opts.onLoad(); };
    }

    return { render: render };
  }

  F.ui.createInspector = createInspector;
})(window.AEVUM.FORGE);
