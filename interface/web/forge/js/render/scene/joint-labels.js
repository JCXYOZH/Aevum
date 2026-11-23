/* Screen-space joint labels; projection and hit points live together. */
(function (F) {
  "use strict";

  function createJointLabels(container, canvas) {
    const labelEls = {};
    let screenJoints = [];

    function ensure(doc) {
      container.innerHTML = "";
      for (let i = 0; i < doc.segments.length; i++) {
        const d = document.createElement("div");
        d.className = "joint-label";
        d.innerHTML = '<span class="id">' + doc.segments[i].id + '</span><span class="val"></span>';
        container.appendChild(d);
        labelEls[doc.segments[i].id] = d;
      }
      screenJoints = [];
    }

    function project(vp, p) {
      const c = [
        vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12],
        vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13],
        vp[2] * p[0] + vp[6] * p[1] + vp[10] * p[2] + vp[14],
        vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15]
      ];
      if (c[3] <= 0.001) return null;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      return {
        x: (c[0] / c[3] * 0.5 + 0.5) * w,
        y: (1 - (c[1] / c[3] * 0.5 + 0.5)) * h
      };
    }

    function update(scene, vp, selected) {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      screenJoints = [];
      for (let i = 0; i < scene.joints.length; i++) {
        const j = scene.joints[i];
        const p = project(vp, j.pos);
        const el = labelEls[j.id];
        if (!p || p.x < -80 || p.x > w + 80 || p.y < -50 || p.y > h + 50) {
          if (el) el.style.display = "none";
          continue;
        }
        if (el) {
          el.style.display = "block";
          el.style.left = p.x + "px";
          el.style.top = p.y + "px";
          el.classList.toggle("sel", selected.kind === "joint" && selected.index === i);
          const val = el.querySelector(".val");
          if (val) val.textContent = F.math.fmt((j.q || 0) * F.math.R2D, 0) + "°";
        }
        screenJoints.push({ index: i, x: p.x, y: p.y });
      }
      return screenJoints;
    }

    function joints() {
      return screenJoints;
    }

    return { ensure: ensure, update: update, project: project, joints: joints };
  }

  F.render.createJointLabels = createJointLabels;
})(window.AEVUM.FORGE);
