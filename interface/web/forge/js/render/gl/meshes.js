/* CPU-side mesh data. No GL calls here; buffers.js uploads it. */
(function (F) {
  "use strict";

  function triNormal(a, b, c) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    return [nx, ny, nz];
  }

  function pushTri(v, a, b, c, n) {
    n = n || triNormal(a, b, c);
    v.push(a[0], a[1], a[2], n[0], n[1], n[2]);
    v.push(b[0], b[1], b[2], n[0], n[1], n[2]);
    v.push(c[0], c[1], c[2], n[0], n[1], n[2]);
  }

  function unitBox() {
    const v = [];
    const face = function (a, b, c, d, n) {
      pushTri(v, a, b, c, n);
      pushTri(v, a, c, d, n);
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

  /* Superellipsoid approximation: a box with industrial, soft edges. */
  function superBox(segU, segV, exponent) {
    segU = segU || 24;
    segV = segV || 12;
    const e = exponent || 0.32;
    const v = [];
    const point = function (u, w) {
      const cu = Math.cos(u), su = Math.sin(u), cw = Math.cos(w), sw = Math.sin(w);
      const sx = Math.sign(cu) * Math.pow(Math.abs(cu), e);
      const sz = Math.sign(su) * Math.pow(Math.abs(su), e);
      const cy = Math.sign(cw) * Math.pow(Math.abs(cw), e);
      const sy = Math.sign(sw) * Math.pow(Math.abs(sw), e);
      return [sx * cy * 0.5, sy * 0.5, sz * cy * 0.5];
    };
    for (let i = 0; i < segU; i++) {
      const u0 = -Math.PI + i / segU * Math.PI * 2;
      const u1 = -Math.PI + (i + 1) / segU * Math.PI * 2;
      for (let j = 0; j < segV; j++) {
        const w0 = -Math.PI / 2 + j / segV * Math.PI;
        const w1 = -Math.PI / 2 + (j + 1) / segV * Math.PI;
        const a = point(u0, w0), b = point(u1, w0);
        const c = point(u1, w1), d = point(u0, w1);
        pushTri(v, a, b, c);
        pushTri(v, a, c, d);
      }
    }
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
      pushTri(v, [x0, y0, -half], [x1, y1, -half], [x1, y1, half], [n0[0] + n1[0], n0[1] + n1[1], 0]);
      pushTri(v, [x0, y0, -half], [x1, y1, half], [x0, y0, half], [n0[0] + n1[0], n0[1] + n1[1], 0]);
      pushTri(v, [0, 0, half], [x0, y0, half], [x1, y1, half], [0, 0, 1]);
      pushTri(v, [0, 0, -half], [x1, y1, -half], [x0, y0, -half], [0, 0, -1]);
    }
    return v;
  }

  function torusZ(major, tube, seg, tubeSeg) {
    seg = seg || 40;
    tubeSeg = tubeSeg || 8;
    const v = [];
    const point = function (u, w) {
      const r = major + tube * Math.cos(w);
      return [r * Math.cos(u), r * Math.sin(u), tube * Math.sin(w)];
    };
    for (let i = 0; i < seg; i++) {
      const u0 = i / seg * Math.PI * 2;
      const u1 = (i + 1) / seg * Math.PI * 2;
      for (let j = 0; j < tubeSeg; j++) {
        const w0 = j / tubeSeg * Math.PI * 2;
        const w1 = (j + 1) / tubeSeg * Math.PI * 2;
        const a = point(u0, w0), b = point(u1, w0);
        const c = point(u1, w1), d = point(u0, w1);
        pushTri(v, a, b, c);
        pushTri(v, a, c, d);
      }
    }
    return v;
  }

  function gridPlane(size, y) {
    const s = size || 80;
    const yy = y === undefined ? 0 : y;
    return [
      -s, yy, -s, 0, 1, 0, s, yy, -s, 0, 1, 0, s, yy, s, 0, 1, 0,
      -s, yy, -s, 0, 1, 0, s, yy, s, 0, 1, 0, -s, yy, s, 0, 1, 0
    ];
  }

  function disk(seg) {
    seg = seg || 48;
    const v = [];
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2;
      const a1 = (i + 1) / seg * Math.PI * 2;
      const p0 = [Math.cos(a0), 0, Math.sin(a0)];
      const p1 = [Math.cos(a1), 0, Math.sin(a1)];
      pushTri(v, [0, 0, 0], p1, p0, [0, 1, 0]);
    }
    return v;
  }

  function bgQuad() {
    return [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];
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
  F.render.superBox = superBox;
  F.render.cylinderZ = cylinderZ;
  F.render.torusZ = torusZ;
  F.render.gridPlane = gridPlane;
  F.render.disk = disk;
  F.render.bgQuad = bgQuad;
  F.render.gridLines = gridLines;
})(window.AEVUM.FORGE);
