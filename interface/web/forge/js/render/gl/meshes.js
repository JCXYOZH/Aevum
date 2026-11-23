/* CPU-side mesh data. No GL calls here; buffers.js uploads it. */
(function (F) {
  "use strict";

  function unitBox() {
    const v = [];
    const face = function (a, b, c, d, n) {
      v.push.apply(v, a); v.push.apply(v, n);
      v.push.apply(v, b); v.push.apply(v, n);
      v.push.apply(v, c); v.push.apply(v, n);
      v.push.apply(v, a); v.push.apply(v, n);
      v.push.apply(v, c); v.push.apply(v, n);
      v.push.apply(v, d); v.push.apply(v, n);
    };
    const A = [-.5, -.5, -.5], B = [.5, -.5, -.5], C = [.5, .5, -.5], D = [-.5, .5, -.5];
    const E = [-.5, -.5, .5], Fv = [.5, -.5, .5], G = [.5, .5, .5], H = [-.5, .5, .5];
    face(E, Fv, G, H, [0, 0, 1]);
    face(B, A, D, C, [0, 0, -1]);
    face(Fv, B, C, G, [1, 0, 0]);
    face(A, E, H, D, [-1, 0, 0]);
    face(D, C, G, H, [0, 1, 0]);
    face(A, B, Fv, E, [0, -1, 0]);
    return v;
  }

  function cylinderZ(r, h, seg) {
    seg = seg || 18;
    const v = [];
    const half = h / 2;
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2;
      const a1 = (i + 1) / seg * Math.PI * 2;
      const x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r;
      const x1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r;
      const n0 = [Math.cos(a0), Math.sin(a0), 0], n1 = [Math.cos(a1), Math.sin(a1), 0];
      v.push(x0, y0, -half, n0[0], n0[1], n0[2], x1, y1, -half, n1[0], n1[1], n1[2], x1, y1, half, n1[0], n1[1], n1[2]);
      v.push(x0, y0, -half, n0[0], n0[1], n0[2], x1, y1, half, n1[0], n1[1], n1[2], x0, y0, half, n0[0], n0[1], n0[2]);
      v.push(0, 0, half, 0, 0, 1, x0, y0, half, n0[0], n0[1], n0[2], x1, y1, half, n1[0], n1[1], n1[2]);
      v.push(0, 0, -half, 0, 0, -1, x1, y1, -half, n1[0], n1[1], n1[2], x0, y0, -half, n0[0], n0[1], n0[2]);
    }
    return v;
  }

  function gridLines() {
    const v = [];
    const N = 12, S = 0.25;
    for (let i = -N; i <= N; i++) {
      v.push(-N * S, 0.012, i * S, N * S, 0.012, i * S);
      v.push(i * S, 0.012, -N * S, i * S, 0.012, N * S);
    }
    return v;
  }

  F.render.unitBox = unitBox;
  F.render.cylinderZ = cylinderZ;
  F.render.gridLines = gridLines;
})(window.AEVUM.FORGE);
