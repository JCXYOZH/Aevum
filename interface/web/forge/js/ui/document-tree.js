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
    const searchEl = opts.search || null;
    const onSelect = opts.onSelect || function () {};

    function filter(query) {
      const q = String(query || "").trim().toLowerCase();
      let shown = 0;
      treeEl.querySelectorAll(".tree-item").forEach(function (el) {
        const hit = !q || el.textContent.toLowerCase().indexOf(q) >= 0;
        el.style.display = hit ? "" : "none";
        if (hit) shown++;
      });
      let empty = treeEl.querySelector(".tree-empty");
      if (!shown && q) {
        if (!empty) {
          empty = document.createElement("div");
          empty.className = "tree-empty";
          treeEl.appendChild(empty);
        }
        empty.textContent = "No link or joint matches “" + q + "”.";
      } else if (empty) {
        empty.remove();
      }
    }

    if (searchEl) {
      searchEl.addEventListener("input", function () { filter(searchEl.value); });
    }

    function detailFor(s) {
      if (F.model.isImported(state.doc)) {
        return s.mesh
          ? (s.mesh.triangles + " tris · q " + fmt(s.q * R2D, 0) + "°")
          : ("transform · q " + fmt(s.q * R2D, 0) + "°");
      }
      return "L " + fmt(s.length, 2) + " m · q " + fmt(s.q * R2D, 0) + "° · " + fmt(s.torque, 0) + " N·m";
    }

    function depthOf(index) {
      let depth = 0;
      let p = state.doc.segments[index] && state.doc.segments[index].parent;
      while (p >= 0 && depth < 10) {
        depth++;
        p = state.doc.segments[p] ? state.doc.segments[p].parent : -1;
      }
      return depth;
    }

    function render() {
      const doc = state.doc;
      const selected = state.selected;
      let html = '<div class="tree-item ' + (selected.kind === "base" ? "active" : "") + '" data-kind="base" data-index="-1">'
        + '<span class="icon">' + (F.model.isImported(doc) ? "S" : "B") + '</span>'
        + '<span class="tag">' + (F.model.isImported(doc) ? "SCENE" : "FIXED") + '</span><div class="k">'
        + (F.model.isImported(doc) ? "IMPORTED ROOT" : "BASE") + '</div><div class="v">'
        + (F.model.isImported(doc)
          ? doc.segments.length + " link · " + ((doc.meta && doc.meta.triangleCount) || 0) + " tris"
          : "ground frame · " + fmt(doc.base.w, 2) + " × " + fmt(doc.base.d, 2) + " m")
        + '</div></div>';

      doc.segments.forEach(function (s, i) {
        const active = selected.kind === "joint" && selected.index === i;
        const depth = depthOf(i);
        html += '<div class="tree-item ' + (active ? "active" : "") + '" data-kind="joint" data-index="' + i + '" style="padding-left:' + (6 + depth * 14) + 'px">'
          + '<span class="icon">J</span><span class="tag">' + s.id + '</span><div class="k">' + s.name + '</div>'
          + '<div class="v" data-q="' + i + '">' + detailFor(s) + '</div></div>';
      });

      treeEl.innerHTML = html;
      treeEl.querySelectorAll(".tree-item").forEach(function (el) {
        el.onclick = function () {
          select(el.dataset.kind, Number(el.dataset.index));
        };
      });
      filter(searchEl ? searchEl.value : "");
      updatePurpose();
    }

    function select(kind, index) {
      state.selected = { kind: kind, index: index };
      render();
      onSelect(kind, index);
    }

    function updatePurpose() {
      const stat = document.getElementById("statSelection");
      if (state.selected.kind === "base") {
        if (F.model.isImported(state.doc)) {
          purposeEl.innerHTML = "<b>Scene / imported graph</b>导入模型的节点集合。每个节点生成一个 link；父子节点之间自动生成 joint。";
          selIdEl.textContent = "SCENE";
          if (stat) stat.textContent = "SCENE";
          return;
        }
        purposeEl.innerHTML = "<b>Base / fixed frame</b>整机唯一固定基准，只提供世界坐标和承重，不参与驱动。";
        selIdEl.textContent = "BASE";
        if (stat) stat.textContent = "BASE";
        return;
      }
      const s = state.doc.segments[state.selected.index];
      if (!s) return;
      if (stat) stat.textContent = s.id;
      if (F.model.isImported(state.doc)) {
        const compat = F.model.kernelCompatibility(state.doc);
        purposeEl.innerHTML = "<b>" + s.id + " / imported joint</b>parent "
          + (s.parent < 0 ? "SCENE" : "L" + s.parent) + " · axis "
          + s.joint.axis.map(function (v) { return fmt(v, 2); }).join("/")
          + " · <span class=\"accent\">" + (compat.ok ? "kernel compatible" : "local only") + "</span>";
        selIdEl.textContent = s.id;
        return;
      }
      purposeEl.innerHTML = "<b>" + s.id + " / kinematic joint</b>" + s.name
        + " 的关节与连杆段：负责这一节的姿态和力矩传递，不参与整机路径规划。";
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
