/* Viewport renderer: owns the draw order, not the camera or the model. */
(function (F) {
  "use strict";

  const M = F.math;

  function createRenderer(canvas, labels) {
    const ctx = F.render.createContext(canvas);
    const buffers = F.render.createBuffers(ctx);
    const gl = ctx.gl;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        gl.viewport(0, 0, canvas.width, canvas.height);
      }
    }

    function draw(doc, scene, vp, selected) {
      resize();

      gl.clearColor(0.035, 0.047, 0.058, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);

      gl.useProgram(ctx.meshProg);
      gl.uniformMatrix4fv(ctx.meshLoc.uVP, false, vp);

      /* ground */
      buffers.drawMesh(
        buffers.boxMesh,
        M.mul(M.trans(0, -0.03, 0), M.scale(5.5, 0.04, 5.5)),
        M.mat3(M.mat4()),
        [0.075, 0.09, 0.10]
      );

      /* base */
      buffers.drawMesh(
        buffers.boxMesh,
        M.mul(M.trans(0, doc.base.h / 2, 0), M.scale(doc.base.w, doc.base.h, doc.base.d)),
        M.mat3(M.mat4()),
        doc.base.color
      );

      /* feet */
      [-0.18, 0.18].forEach(function (x) {
        [-0.13, 0.13].forEach(function (z) {
          buffers.drawMesh(
            buffers.boxMesh,
            M.mul(M.trans(x, 0.025, z), M.scale(0.09, 0.05, 0.09)),
            M.mat3(M.mat4()),
            [0.10, 0.12, 0.13]
          );
        });
      });

      /* links */
      for (let i = 0; i < scene.links.length; i++) {
        const l = scene.links[i];
        const col = (selected.kind === "joint" && selected.index === i)
          ? [0.55, 0.95, 0.98]
          : l.seg.color;
        buffers.drawMesh(buffers.boxMesh, l.model, l.normal, col);
      }

      /* joint handles */
      for (let i = 0; i < scene.joints.length; i++) {
        const col = (selected.kind === "joint" && selected.index === i)
          ? [1.0, 0.68, 0.22]
          : [0.35, 0.42, 0.45];
        buffers.drawMesh(buffers.cylMesh, M.trans.apply(null, scene.joints[i].pos), M.mat3(M.mat4()), col);
      }

      /* tool / gripper */
      const tool = scene.endMat;
      buffers.drawMesh(
        buffers.boxMesh,
        M.mul(M.mul(tool, M.trans(doc.tool.length / 2, 0, 0)), M.scale(doc.tool.length, doc.tool.width, doc.tool.depth)),
        M.mat3(tool),
        [0.55, 0.33, 0.12]
      );
      [0.045, -0.045].forEach(function (y) {
        buffers.drawMesh(
          buffers.boxMesh,
          M.mul(M.mul(tool, M.trans(doc.tool.length + 0.08, y, 0)), M.scale(0.14, 0.035, 0.04)),
          M.mat3(tool),
          [0.92, 0.58, 0.20]
        );
      });

      /* grid overlay */
      buffers.drawLines(buffers.lineMesh, vp, [0.18, 0.38, 0.42]);

      labels.update(scene, vp, selected);
    }

    return { canvas: canvas, gl: gl, resize: resize, draw: draw };
  }

  F.render.createRenderer = createRenderer;
})(window.AEVUM.FORGE);
