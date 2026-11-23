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

    function render() {
      const doc = state.doc;
      const selected = state.selected;
      let html = '<div class="tree-item ' + (selected.kind === "base" ? "active" : "") + '" data-kind="base" data-index="-1">'
        + '<span class="tag">FIXED</span><div class="k">BASE</div><div class="v">ground frame · '
        + fmt(doc.base.w, 2) + " × " + fmt(doc.base.d, 2) + ' m</div></div>';

      doc.segments.forEach(function (s, i) {
        const active = selected.kind === "joint" && selected.index === i;
        html += '<div class="tree-item ' + (active ? "active" : "") + '" data-kind="joint" data-index="' + i + '">'
          + '<span class="tag">' + s.id + '</span><div class="k">' + s.name + '</div><div class="v">L '
          + fmt(s.length, 2) + " m · q " + fmt(s.q * R2D, 0) + "° · " + fmt(s.torque, 0) + ' N·m</div></div>';
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
        purposeEl.innerHTML = "<b>BASE / WHY IT EXISTS</b>唯一固定基准。它只提供世界坐标和承重，不参与驱动，不承担控制策略。";
        selIdEl.textContent = "BASE";
        return;
      }
      const s = state.doc.segments[state.selected.index];
      if (!s) return;
      purposeEl.innerHTML = "<b>" + s.id + " / WHY IT EXISTS</b>" + s.name
        + " 关节 + 连杆段。负责这一节的姿态与力矩传递；不负责整机路径规划，也不认识 MuJoCo。";
      selIdEl.textContent = s.id;
    }

    return { render: render, select: select, updatePurpose: updatePurpose };
  }

  F.ui.createDocumentTree = createDocumentTree;
})(window.AEVUM.FORGE);
