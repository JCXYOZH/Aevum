/* Small, dependency-free math used by the renderer, model and controller. */
(function (F) {
  "use strict";

  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;
  const I4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function fmt(v, n) {
    return Number(v).toFixed(n === undefined ? 1 : n);
  }

  function mat4() {
    return new Float32Array(I4);
  }

  function mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] =
          a[r] * b[c * 4] +
          a[4 + r] * b[c * 4 + 1] +
          a[8 + r] * b[c * 4 + 2] +
          a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }

  function trans(x, y, z) {
    const m = mat4();
    m[12] = x;
    m[13] = y;
    m[14] = z;
    return m;
  }

  function scale(x, y, z) {
    const m = mat4();
    m[0] = x;
    m[5] = y;
    m[10] = z;
    return m;
  }

  function rz(a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const m = mat4();
    m[0] = c;
    m[1] = s;
    m[4] = -s;
    m[5] = c;
    return m;
  }

  function axisAngle(axis, angle) {
    let x = axis[0], y = axis[1], z = axis[2];
    const l = Math.hypot(x, y, z) || 1;
    x /= l; y /= l; z /= l;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const t = 1 - c;
    const m = mat4();
    m[0] = t * x * x + c;
    m[1] = t * x * y + s * z;
    m[2] = t * x * z - s * y;
    m[4] = t * x * y - s * z;
    m[5] = t * y * y + c;
    m[6] = t * y * z + s * x;
    m[8] = t * x * z + s * y;
    m[9] = t * y * z - s * x;
    m[10] = t * z * z + c;
    return m;
  }

  function quatToMat(q) {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const n = Math.hypot(x, y, z, w) || 1;
    const qx = x / n, qy = y / n, qz = z / n, qw = w / n;
    const xx = qx * qx, yy = qy * qy, zz = qz * qz;
    const xy = qx * qy, xz = qx * qz, yz = qy * qz;
    const wx = qw * qx, wy = qw * qy, wz = qw * qz;
    const m = mat4();
    m[0] = 1 - 2 * (yy + zz);
    m[1] = 2 * (xy + wz);
    m[2] = 2 * (xz - wy);
    m[4] = 2 * (xy - wz);
    m[5] = 1 - 2 * (xx + zz);
    m[6] = 2 * (yz + wx);
    m[8] = 2 * (xz + wy);
    m[9] = 2 * (yz - wx);
    m[10] = 1 - 2 * (xx + yy);
    return m;
  }

  function trs(translation, rotation, scaleValues) {
    const t = translation || [0, 0, 0];
    const q = rotation || [0, 0, 0, 1];
    const s = scaleValues || [1, 1, 1];
    return mul(mul(trans(t[0], t[1], t[2]), quatToMat(q)), scale(s[0], s[1], s[2]));
  }

  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) / (near - far);
    m[11] = -1;
    m[14] = (2 * far * near) / (near - far);
    return m;
  }

  function lookAt(eye, center, up) {
    let zx = eye[0] - center[0];
    let zy = eye[1] - center[1];
    let zz = eye[2] - center[2];
    let zl = Math.hypot(zx, zy, zz) || 1;
    zx /= zl; zy /= zl; zz /= zl;

    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    let xl = Math.hypot(xx, xy, xz) || 1;
    xx /= xl; xy /= xl; xz /= xl;

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    const m = new Float32Array(16);
    m[0] = xx; m[1] = yx; m[2] = zx;
    m[4] = xy; m[5] = yy; m[6] = zy;
    m[8] = xz; m[9] = yz; m[10] = zz;
    m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    m[15] = 1;
    return m;
  }

  function mat3(m) {
    return new Float32Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]);
  }

  function transformPoint(m, p) {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
    ];
  }

  function translation(m) {
    return [m[12], m[13], m[14]];
  }

  F.math = {
    D2R,
    R2D,
    clamp,
    fmt,
    mat4,
    mul,
    trans,
    scale,
    rz,
    axisAngle,
    quatToMat,
    trs,
    perspective,
    lookAt,
    mat3,
    transformPoint,
    translation
  };
})(window.AEVUM.FORGE);
