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

  F.render.createCamera = createCamera;
  F.render.cameraEye = cameraEye;
  F.render.viewProjection = viewProjection;
})(window.AEVUM.FORGE);
