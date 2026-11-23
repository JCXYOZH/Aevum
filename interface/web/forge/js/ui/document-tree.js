/* Left-side BodyDocument tree. Reads state, emits selection, never touches the 3D scene. */
(function (F) {
  "use strict";

  const fmt = F.math.fmt;
  const R2D = F.math.R2D;

  function createDocumentTree(opts) {
    const state = opts.state;
    const treeEl = opts.tree;
    const purposeEl = opts.purpose;
    const selIdEl = opts.selId;
    const onSelect = opts.onSelect || function () {};

    function detailFor(s) {
      if (F.model.isImported(state.doc)) {
        return s.mesh
          ? (s.mesh.triangles + " tris · q " + fmt(s.q * R2D, 0) + "°")
          : ("transform · q " + fmt(s.q * R2D, 0) + "°");
      }
      return "L " + fmt(s.length, 2) + " m · q " + fmt(s.q * R2D, 0) + "° · " + fmt(s.torque, 0) + " N·m";
    }

    function render() {
      const doc = state.doc;
      const selected = state.selected;
      let html = '<div class="tree-item ' + (selected.kind === "base" ? "active" : "") + '" data-kind="base" data-index="-1">'
        + '<span class="tag">' + (F.model.isImported(doc) ? "SCENE" : "FIXED") + '</span><div class="k">'
        + (F.model.isImported(doc) ? "IMPORTED ROOT" : "BASE") + '</div><div class="v">'
        + (F.model.isImported(doc)
          ? doc.segments.length + " link · " + ((doc.meta && doc.meta.triangleCount) || 0) + " tris"
          : "ground frame · " + fmt(doc.base.w, 2) + " × " + fmt(doc.base.d, 2) + " m")
        + '</div></div>';

      doc.segments.forEach(function (s, i) {
        const active = selected.kind === "joint" && selected.index === i;
        html += '<div class="tree-item ' + (active ? "active" : "") + '" data-kind="joint" data-index="' + i + '">'
          + '<span class="tag">' + s.id + '</span><div class="k">' + s.name + '</div>'
          + '<div class="v" data-q="' + i + '">' + detailFor(s) + '</div></div>';
      });

      treeEl.innerHTML = html;
      treeEl.querySelectorAll(".tree-item").forEach(function (el) {
        el.onclick = function () {
          select(el.dataset.kind, Number(el.dataset.index));
        };
      });
      updatePurpose();
    }

    function select(kind, index) {
      state.selected = { kind: kind, index: index };
      render();
      onSelect(kind, index);
    }

    function updatePurpose() {
      if (state.selected.kind === "base") {
        if (F.model.isImported(state.doc)) {
          purposeEl.innerHTML = "<b>SCENE / IMPORTED GRAPH</b>导入模型的根节点集合。每个节点变成一个 segment；父子节点自动生成 joint。";
          selIdEl.textContent = "SCENE";
          return;
        }
        purposeEl.innerHTML = "<b>BASE / WHY IT EXISTS</b>唯一固定基准。它只提供世界坐标和承重，不参与驱动，不承担控制策略。";
        selIdEl.textContent = "BASE";
        return;
      }
      const s = state.doc.segments[state.selected.index];
      if (!s) return;
      if (F.model.isImported(state.doc)) {
        const compat = F.model.kernelCompatibility(state.doc);
        purposeEl.innerHTML = "<b>" + s.id + " / IMPORTED JOINT</b>parent "
          + (s.parent < 0 ? "SCENE" : "L" + s.parent) + " · axis "
          + s.joint.axis.map(function (v) { return fmt(v, 2); }).join("/")
          + " · " + (compat.ok ? "KERNEL COMPATIBLE" : "LOCAL ONLY");
        selIdEl.textContent = s.id;
        return;
      }
      purposeEl.innerHTML = "<b>" + s.id + " / WHY IT EXISTS</b>" + s.name
        + " 关节 + 连杆段。负责这一节的姿态与力矩传递；不负责整机路径规划，也不认识 MuJoCo。";
      selIdEl.textContent = s.id;
    }

    function updateRuntime() {
      state.doc.segments.forEach(function (s, i) {
        const el = treeEl.querySelector('[data-q="' + i + '"]');
        if (el) el.textContent = detailFor(s);
      });
    }

    return { render: render, select: select, updatePurpose: updatePurpose, updateRuntime: updateRuntime };
  }

  F.ui.createDocumentTree = createDocumentTree;
})(window.AEVUM.FORGE);
