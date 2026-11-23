/* Camera state and projection. Orbit input can be added here without touching the renderer. */
(function (F) {
  "use strict";

  const D2R = F.math.D2R;

  function createCamera() {
    return { yaw: 0.22, pitch: 0.18, dist: 3.15, target: [0.52, 0.38, 0] };
  }

  function cameraEye(cam) {
    const cp = Math.cos(cam.pitch);
    const sp = Math.sin(cam.pitch);
    return [
      cam.target[0] + cam.dist * cp * Math.sin(cam.yaw),
      cam.target[1] + cam.dist * sp,
      cam.target[2] + cam.dist * cp * Math.cos(cam.yaw)
    ];
  }

  function viewProjection(cam, canvas) {
    return F.math.mul(
      F.math.perspective(42 * D2R, canvas.width / 2 / canvas.height, 0.08, 60),
      F.math.lookAt(cameraEye(cam), cam.target, [0, 1, 0])
    );
  }

  function fitCamera(doc, cam) {
    const scene = F.render.buildScene(doc);
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    scene.links.forEach(function (l) {
      const p = F.math.translation(l.model);
      const b = l.mesh && l.mesh.bounds && l.mesh.bounds.size ? l.mesh.bounds.size : [0.1, 0.1, 0.1];
      for (let c = 0; c < 3; c++) {
        mn[c] = Math.min(mn[c], p[c] - b[c] / 2);
        mx[c] = Math.max(mx[c], p[c] + b[c] / 2);
      }
    });
    if (!isFinite(mn[0])) return;
    cam.target = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    const span = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2], 0.4);
    cam.dist = Math.max(1.2, span * 2.0);
  }

  F.render.createCamera = createCamera;
  F.render.cameraEye = cameraEye;
  F.render.viewProjection = viewProjection;
  F.render.fitCamera = fitCamera;
})(window.AEVUM.FORGE);
