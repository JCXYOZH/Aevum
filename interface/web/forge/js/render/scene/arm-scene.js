/* Kinematic 3R arm scene: pure document → world transforms. No GL objects. */
(function (F) {
  "use strict";

  const M = F.math;

  function buildArmScene(doc) {
    const joints = [];
    const links = [];
    let m = M.trans(0, doc.base.h, 0);

    for (let i = 0; i < doc.segments.length; i++) {
      const seg = doc.segments[i];
      joints.push({ id: seg.id, pos: M.translation(m), axis: [0, 0, 1], q: seg.q });
      const rot = M.mul(m, M.rz(seg.q));
      links.push({
        seg: seg,
        model: M.mul(M.mul(rot, M.trans(seg.length / 2, 0, 0)), M.scale(seg.length, seg.width, seg.depth)),
        normal: M.mat3(rot)
      });
      m = M.mul(rot, M.trans(seg.length, 0, 0));
    }

    return { joints: joints, links: links, end: M.translation(m), endMat: m };
  }

  F.render.buildArmScene = buildArmScene;
})(window.AEVUM.FORGE);
