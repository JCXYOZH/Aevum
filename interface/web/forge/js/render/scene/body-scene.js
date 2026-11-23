/* Imported kinematic tree: BodyDocument v1 → world matrices + joint anchors. */
(function (F) {
  "use strict";

  const M = F.math;
  F.render = F.render || {};

  function buildBodyScene(doc) {
    const links = [];
    const joints = [];
    const world = [];

    function rootMatrix(seg) {
      return childMatrix(seg, M.mat4());
    }

    function childMatrix(seg, parentWorld) {
      const j = seg.joint;
      let m = parentWorld;
      if (j) {
        m = M.mul(m, M.trans(j.origin[0], j.origin[1], j.origin[2]));
        m = M.mul(m, M.axisAngle(j.axis, seg.q || 0));
      }
      return M.mul(m, M.trs(seg.local.translation, seg.local.rotation, seg.local.scale));
    }

    function anchor(seg, parentWorld) {
      if (seg.joint) {
        const p = parentWorld
          ? M.mul(parentWorld, M.trans(seg.joint.origin[0], seg.joint.origin[1], seg.joint.origin[2]))
          : M.trans(seg.joint.origin[0], seg.joint.origin[1], seg.joint.origin[2]);
        return M.translation(p);
      }
      return M.translation(parentWorld || M.mat4());
    }

    function walk(index, parentWorld) {
      const seg = doc.segments[index];
      if (!seg || world[index]) return;
      const m = parentWorld ? childMatrix(seg, parentWorld) : rootMatrix(seg);
      world[index] = m;
      links[index] = {
        seg: seg,
        model: m,
        normal: M.mat3(m),
        mesh: seg.mesh || null
      };
      joints[index] = {
        id: seg.id,
        pos: anchor(seg, parentWorld),
        axis: seg.joint ? seg.joint.axis : [0, 0, 1],
        q: seg.q || 0
      };
      doc.segments.forEach(function (s, i) {
        if (s.parent === index) walk(i, m);
      });
    }

    doc.segments.forEach(function (s, i) {
      if (s.parent < 0 || !doc.segments[s.parent]) walk(i, null);
    });
    /* 防止 parent 断裂/环导致空数组；未走到的节点按根处理。 */
    doc.segments.forEach(function (s, i) {
      if (!world[i]) walk(i, null);
    });

    return {
      mode: "body",
      links: links.filter(Boolean),
      joints: joints.filter(Boolean),
      end: M.translation(world[world.length - 1] || M.mat4()),
      endMat: world[world.length - 1] || M.mat4()
    };
  }

  function buildScene(doc) {
    if (F.model.isImported(doc)) return buildBodyScene(doc);
    return F.render.buildArmScene(doc);
  }

  F.render.buildBodyScene = buildBodyScene;
  F.render.buildScene = buildScene;
})(window.AEVUM.FORGE);
