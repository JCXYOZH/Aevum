/**
 * MrHua 3D灵体渲染引擎 - orb-advanced-math
 * 高级数学(复数/四元数/矩阵分解/几何)
 * 从 orb-renderer-main.js 拆分 (原行 L23044-L24092)
 * @module orb-advanced-math
 */
'use strict';

const Complex = {
  create: function(real, imag){
    return new Float32Array([real || 0, imag || 0]);
  },
  add: function(out, a, b){
    out[0] = a[0] + b[0];
    out[1] = a[1] + b[1];
    return out;
  },
  sub: function(out, a, b){
    out[0] = a[0] - b[0];
    out[1] = a[1] - b[1];
    return out;
  },
  mul: function(out, a, b){
    const ar = a[0], ai = a[1], br = b[0], bi = b[1];
    out[0] = ar * br - ai * bi;
    out[1] = ar * bi + ai * br;
    return out;
  },
  div: function(out, a, b){
    const br = b[0], bi = b[1];
    const denom = br * br + bi * bi;
    if(denom === 0){ out[0] = 0; out[1] = 0; return out; }
    out[0] = (a[0] * br + a[1] * bi) / denom;
    out[1] = (a[1] * br - a[0] * bi) / denom;
    return out;
  },
  conjugate: function(out, a){
    out[0] = a[0];
    out[1] = -a[1];
    return out;
  },
  magnitude: function(a){
    return Math.sqrt(a[0] * a[0] + a[1] * a[1]);
  },
  magnitudeSq: function(a){
    return a[0] * a[0] + a[1] * a[1];
  },
  angle: function(a){
    return Math.atan2(a[1], a[0]);
  },
  fromPolar: function(out, magnitude, angle){
    out[0] = magnitude * Math.cos(angle);
    out[1] = magnitude * Math.sin(angle);
    return out;
  },
  sqrt: function(out, a){
    const mag = Complex.magnitude(a);
    const ang = Complex.angle(a);
    out[0] = Math.sqrt(mag) * Math.cos(ang / 2);
    out[1] = Math.sqrt(mag) * Math.sin(ang / 2);
    return out;
  },
  exp: function(out, a){
    const ea = Math.exp(a[0]);
    out[0] = ea * Math.cos(a[1]);
    out[1] = ea * Math.sin(a[1]);
    return out;
  },
  log: function(out, a){
    out[0] = Math.log(Complex.magnitude(a));
    out[1] = Complex.angle(a);
    return out;
  },
  pow: function(out, a, n){
    const mag = Math.pow(Complex.magnitude(a), n);
    const ang = Complex.angle(a) * n;
    out[0] = mag * Math.cos(ang);
    out[1] = mag * Math.sin(ang);
    return out;
  },
  sin: function(out, a){
    out[0] = Math.sin(a[0]) * Math.cosh(a[1]);
    out[1] = Math.cos(a[0]) * Math.sinh(a[1]);
    return out;
  },
  cos: function(out, a){
    out[0] = Math.cos(a[0]) * Math.cosh(a[1]);
    out[1] = -Math.sin(a[0]) * Math.sinh(a[1]);
    return out;
  },
  tan: function(out, a){
    const sin = Complex.sin(Complex.create(), a);
    const cos = Complex.cos(Complex.create(), a);
    return Complex.div(out, sin, cos);
  },
  negate: function(out, a){
    out[0] = -a[0];
    out[1] = -a[1];
    return out;
  },
  scale: function(out, a, s){
    out[0] = a[0] * s;
    out[1] = a[1] * s;
    return out;
  },
  equals: function(a, b, epsilon){
    const eps = epsilon || 1e-6;
    return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
  },
  toString: function(a){
    return a[0] + ' + ' + a[1] + 'i';
  }
};

/* ===== 四元数高级运算 =====
   支持: 对数 / 指数 / 幂 / 样条 / 约束 / 分解
*/
const QuatAdvanced = {
  log: function(out, q){
    const v = [q[0], q[1], q[2]];
    const w = q[3];
    const vLen = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
    if(vLen < 1e-10){
      out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0;
      return out;
    }
    const angle = Math.atan2(vLen, w);
    const s = angle / vLen;
    out[0] = v[0] * s;
    out[1] = v[1] * s;
    out[2] = v[2] * s;
    out[3] = 0;
    return out;
  },
  exp: function(out, q){
    const v = [q[0], q[1], q[2]];
    const vLen = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
    if(vLen < 1e-10){
      out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1;
      return out;
    }
    const sin = Math.sin(vLen);
    const cos = Math.cos(vLen);
    const s = sin / vLen;
    out[0] = v[0] * s;
    out[1] = v[1] * s;
    out[2] = v[2] * s;
    out[3] = cos;
    return out;
  },
  pow: function(out, q, t){
    const logQ = QuatAdvanced.log(Q.create(), q);
    Q.scale(logQ, logQ, t);
    return QuatAdvanced.exp(out, logQ);
  },
  squad: function(out, q1, q2, s1, s2, t){
    const slerp1 = Q.slerp(Q.create(), q1, q2, t);
    const slerp2 = Q.slerp(Q.create(), s1, s2, t);
    return Q.slerp(out, slerp1, slerp2, 2 * t * (1 - t));
  },
  computeSquadIntermediate: function(qPrev, qCurr, qNext){
    const qPrevInv = Q.invert(Q.create(), qPrev);
    const qNextInv = Q.invert(Q.create(), qNext);
    const log1 = QuatAdvanced.log(Q.create(), Q.mult(Q.create(), qPrevInv, qCurr));
    const log2 = QuatAdvanced.log(Q.create(), Q.mult(Q.create(), qNextInv, qCurr));
    const sum = Q.create();
    Q.add(sum, log1, log2);
    Q.scale(sum, sum, -0.25);
    return Q.mult(Q.create(), qCurr, QuatAdvanced.exp(Q.create(), sum));
  },
  constrainToAxis: function(out, q, axis){
    const v = [q[0], q[1], q[2]];
    const projection = v[0]*axis[0] + v[1]*axis[1] + v[2]*axis[2];
    out[0] = axis[0] * projection;
    out[1] = axis[1] * projection;
    out[2] = axis[2] * projection;
    out[3] = q[3];
    return Q.normalize(out, out);
  },
  getTwist: function(q, axis){
    const projected = QuatAdvanced.constrainToAxis(Q.create(), q, axis);
    const angle = 2 * Math.atan2(
      Math.sqrt(projected[0]**2 + projected[1]**2 + projected[2]**2),
      projected[3]
    );
    const sign = (projected[0]*axis[0] + projected[1]*axis[1] + projected[2]*axis[2]) >= 0 ? 1 : -1;
    return angle * sign;
  },
  getSwing: function(out, q, axis){
    const twist = QuatAdvanced.constrainToAxis(Q.create(), q, axis);
    const twistInv = Q.invert(Q.create(), twist);
    return Q.mult(out, q, twistInv);
  },
  decomposeSwingTwist: function(q, axis){
    const twist = QuatAdvanced.constrainToAxis(Q.create(), q, axis);
    const swing = QuatAdvanced.getSwing(Q.create(), q, axis);
    return { swing: swing, twist: twist };
  },
  fromToRotation: function(out, from, to){
    const dot = from[0]*to[0] + from[1]*to[1] + from[2]*to[2];
    if(dot > 0.99999){
      out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1;
      return out;
    }
    if(dot < -0.99999){
      const axis = [1, 0, 0];
      if(Math.abs(from[1]) < 0.9) axis[0] = 0, axis[1] = 1;
      return Q.fromAxisAngle(out, axis, Math.PI);
    }
    const cross = [
      from[1]*to[2] - from[2]*to[1],
      from[2]*to[0] - from[0]*to[2],
      from[0]*to[1] - from[1]*to[0]
    ];
    out[0] = cross[0];
    out[1] = cross[1];
    out[2] = cross[2];
    out[3] = 1 + dot;
    return Q.normalize(out, out);
  },
  lookRotation: function(out, forward, up){
    const f = V3.normalize(V3.create(), forward);
    const u = up || [0, 1, 0];
    const right = V3.cross(V3.create(), u, f);
    V3.normalize(right, right);
    const upVec = V3.cross(V3.create(), f, right);
    const m = M4.create();
    m[0] = right[0]; m[1] = right[1]; m[2] = right[2];
    m[4] = upVec[0]; m[5] = upVec[1]; m[6] = upVec[2];
    m[8] = f[0]; m[9] = f[1]; m[10] = f[2];
    return Q.fromMat4(out, m);
  },
  rotateTowards: function(out, from, to, maxDegreesDelta){
    const angle = Q.angle(from, to);
    if(angle === 0) return Q.copy(out, from);
    const t = Math.min(1, maxDegreesDelta * Math.PI / 180 / angle);
    return Q.slerp(out, from, to, t);
  },
  euler: function(out, x, y, z, order){
    const ord = order || 'XYZ';
    const cx = Math.cos(x * 0.5), sx = Math.sin(x * 0.5);
    const cy = Math.cos(y * 0.5), sy = Math.sin(y * 0.5);
    const cz = Math.cos(z * 0.5), sz = Math.sin(z * 0.5);
    if(ord === 'XYZ'){
      out[0] = sx*cy*cz + cx*sy*sz;
      out[1] = cx*sy*cz - sx*cy*sz;
      out[2] = cx*cy*sz + sx*sy*cz;
      out[3] = cx*cy*cz - sx*sy*sz;
    } else if(ord === 'YXZ'){
      out[0] = sx*cy*cz + cx*sy*sz;
      out[1] = cx*sy*cz - sx*cy*sz;
      out[2] = cx*cy*sz - sx*sy*cz;
      out[3] = cx*cy*cz + sx*sy*sz;
    } else if(ord === 'ZXY'){
      out[0] = sx*cy*cz - cx*sy*sz;
      out[1] = cx*sy*cz + sx*cy*sz;
      out[2] = cx*cy*sz + sx*sy*cz;
      out[3] = cx*cy*cz - sx*sy*sz;
    } else {
      return Q.fromEuler(out, x, y, z);
    }
    return out;
  }
};

/* ===== 矩阵分解系统 =====
   支持: SVD / QR / LU / Cholesky / 特征值
*/
const MatrixDecomp = {
  transpose: function(out, m){
    for(let i = 0; i < 4; i++){
      for(let j = 0; j < 4; j++){
        out[i*4+j] = m[j*4+i];
      }
    }
    return out;
  },
  determinant3: function(m){
    return m[0]*(m[4]*m[8]-m[5]*m[7]) - m[1]*(m[3]*m[8]-m[5]*m[6]) + m[2]*(m[3]*m[7]-m[4]*m[6]);
  },
  inverse3: function(out, m){
    const det = MatrixDecomp.determinant3(m);
    if(Math.abs(det) < 1e-10) return null;
    const invDet = 1 / det;
    out[0] = (m[4]*m[8] - m[5]*m[7]) * invDet;
    out[1] = (m[2]*m[7] - m[1]*m[8]) * invDet;
    out[2] = (m[1]*m[5] - m[2]*m[4]) * invDet;
    out[3] = (m[5]*m[6] - m[3]*m[8]) * invDet;
    out[4] = (m[0]*m[8] - m[2]*m[6]) * invDet;
    out[5] = (m[2]*m[3] - m[0]*m[5]) * invDet;
    out[6] = (m[3]*m[7] - m[4]*m[6]) * invDet;
    out[7] = (m[1]*m[6] - m[0]*m[7]) * invDet;
    out[8] = (m[0]*m[4] - m[1]*m[3]) * invDet;
    return out;
  },
  decomposeTRS: function(m){
    const translation = [m[12], m[13], m[14]];
    const sx = Math.sqrt(m[0]*m[0] + m[1]*m[1] + m[2]*m[2]);
    const sy = Math.sqrt(m[4]*m[4] + m[5]*m[5] + m[6]*m[6]);
    const sz = Math.sqrt(m[8]*m[8] + m[9]*m[9] + m[10]*m[10]);
    const scale = [sx, sy, sz];
    const rotMat = M4.create();
    for(let i = 0; i < 3; i++){
      rotMat[i*4] = m[i*4] / sx;
      rotMat[i*4+1] = m[i*4+1] / sy;
      rotMat[i*4+2] = m[i*4+2] / sz;
    }
    const rotation = Q.fromMat4(Q.create(), rotMat);
    return { translation: translation, rotation: rotation, scale: scale };
  },
  composeTRS: function(out, translation, rotation, scale){
    const x = rotation[0], y = rotation[1], z = rotation[2], w = rotation[3];
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    out[0] = (1 - (yy + zz)) * scale[0];
    out[1] = (xy + wz) * scale[0];
    out[2] = (xz - wy) * scale[0];
    out[3] = 0;
    out[4] = (xy - wz) * scale[1];
    out[5] = (1 - (xx + zz)) * scale[1];
    out[6] = (yz + wx) * scale[1];
    out[7] = 0;
    out[8] = (xz + wy) * scale[2];
    out[9] = (yz - wx) * scale[2];
    out[10] = (1 - (xx + yy)) * scale[2];
    out[11] = 0;
    out[12] = translation[0];
    out[13] = translation[1];
    out[14] = translation[2];
    out[15] = 1;
    return out;
  },
  gramSchmidt: function(vectors){
    const result = [];
    for(let i = 0; i < vectors.length; i++){
      const v = [...vectors[i]];
      for(let j = 0; j < result.length; j++){
        const dot = v[0]*result[j][0] + v[1]*result[j][1] + v[2]*result[j][2];
        v[0] -= dot * result[j][0];
        v[1] -= dot * result[j][1];
        v[2] -= dot * result[j][2];
      }
      const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
      if(len > 1e-10){
        v[0] /= len; v[1] /= len; v[2] /= len;
        result.push(v);
      }
    }
    return result;
  },
  qrDecompose: function(m){
    const cols = [
      [m[0], m[4], m[8]],
      [m[1], m[5], m[9]],
      [m[2], m[6], m[10]]
    ];
    const qCols = MatrixDecomp.gramSchmidt(cols);
    const Q = M4.create();
    for(let i = 0; i < qCols.length && i < 3; i++){
      Q[i*4] = qCols[i][0];
      Q[i*4+1] = qCols[i][1];
      Q[i*4+2] = qCols[i][2];
    }
    const Qt = MatrixDecomp.transpose(M4.create(), Q);
    const R = M4.mult(M4.create(), Qt, m);
    return { Q: Q, R: R };
  },
  luDecompose: function(m){
    const n = 3;
    const L = [[1,0,0],[0,1,0],[0,0,1]];
    const U = [[m[0],m[1],m[2]],[m[4],m[5],m[6]],[m[8],m[9],m[10]]];
    for(let k = 0; k < n-1; k++){
      for(let i = k+1; i < n; i++){
        if(Math.abs(U[k][k]) < 1e-10) continue;
        L[i][k] = U[i][k] / U[k][k];
        for(let j = k; j < n; j++){
          U[i][j] -= L[i][k] * U[k][j];
        }
      }
    }
    return { L: L, U: U };
  },
  cholesky: function(m){
    const n = 3;
    const L = [[0,0,0],[0,0,0],[0,0,0]];
    const A = [[m[0],m[1],m[2]],[m[4],m[5],m[6]],[m[8],m[9],m[10]]];
    for(let i = 0; i < n; i++){
      for(let j = 0; j <= i; j++){
        let sum = 0;
        for(let k = 0; k < j; k++) sum += L[i][k] * L[j][k];
        if(i === j){
          const val = A[i][i] - sum;
          if(val <= 0) return null;
          L[i][j] = Math.sqrt(val);
        } else {
          L[i][j] = (A[i][j] - sum) / L[j][j];
        }
      }
    }
    return L;
  },
  eigenvalues2x2: function(a, b, c, d){
    const trace = a + d;
    const det = a * d - b * c;
    const disc = trace * trace - 4 * det;
    if(disc < 0) return null;
    const sqrtDisc = Math.sqrt(disc);
    return [(trace + sqrtDisc) / 2, (trace - sqrtDisc) / 2];
  },
  trace: function(m){
    return m[0] + m[5] + m[10] + m[15];
  },
  frobeniusNorm: function(m){
    let sum = 0;
    for(let i = 0; i < 16; i++) sum += m[i] * m[i];
    return Math.sqrt(sum);
  },
  isIdentity: function(m, epsilon){
    const eps = epsilon || 1e-6;
    const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    for(let i = 0; i < 16; i++){
      if(Math.abs(m[i] - identity[i]) > eps) return false;
    }
    return true;
  },
  isOrthogonal: function(m, epsilon){
    const eps = epsilon || 1e-6;
    const mtm = M4.mult(M4.create(), MatrixDecomp.transpose(M4.create(), m), m);
    return MatrixDecomp.isIdentity(mtm, eps);
  }
};

/* ===== 高级几何生成 =====
   支持: 圆锥 / 圆台 / 胶囊体 / 棱柱 / 环面结 / 螺旋
*/
const AdvancedGeometry = {
  createCone: function(radius, height, segments, options){
    const opts = options || {};
    const segs = segments || 24;
    const vertices = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const topY = height / 2;
    const bottomY = -height / 2;
    for(let i = 0; i <= segs; i++){
      const angle = (i / segs) * Math.PI * 2;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      vertices.push(radius * cos, bottomY, radius * sin);
      const slope = Math.atan2(radius, height);
      normals.push(cos * Math.cos(slope), Math.sin(slope), sin * Math.cos(slope));
      uvs.push(i / segs, 0);
    }
    vertices.push(0, topY, 0);
    normals.push(0, 1, 0);
    uvs.push(0.5, 1);
    const topIndex = segs + 1;
    for(let i = 0; i < segs; i++){
      indices.push(i, i + 1, topIndex);
    }
    if(opts.capBottom){
      vertices.push(0, bottomY, 0);
      normals.push(0, -1, 0);
      uvs.push(0.5, 0.5);
      const centerIndex = vertices.length / 3 - 1;
      const capStart = centerIndex + 1;
      for(let i = 0; i <= segs; i++){
        const angle = (i / segs) * Math.PI * 2;
        vertices.push(radius * Math.cos(angle), bottomY, radius * Math.sin(angle));
        normals.push(0, -1, 0);
        uvs.push(0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5);
      }
      for(let i = 0; i < segs; i++){
        indices.push(centerIndex, capStart + i + 1, capStart + i);
      }
    }
    return {
      vertices: new Float32Array(vertices),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: new Uint16Array(indices)
    };
  },
  createCylinder: function(topRadius, bottomRadius, height, segments, options){
    const opts = options || {};
    const segs = segments || 24;
    const vertices = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const topY = height / 2;
    const bottomY = -height / 2;
    for(let i = 0; i <= segs; i++){
      const angle = (i / segs) * Math.PI * 2;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      vertices.push(bottomRadius * cos, bottomY, bottomRadius * sin);
      vertices.push(topRadius * cos, topY, topRadius * sin);
      const ny = (topRadius - bottomRadius) / height;
      const nl = Math.sqrt(1 + ny * ny);
      normals.push(cos / nl, ny / nl, sin / nl);
      normals.push(cos / nl, ny / nl, sin / nl);
      uvs.push(i / segs, 0);
      uvs.push(i / segs, 1);
    }
    for(let i = 0; i < segs; i++){
      const i0 = i * 2, i1 = i * 2 + 1, i2 = i * 2 + 2, i3 = i * 2 + 3;
      indices.push(i0, i2, i1);
      indices.push(i1, i2, i3);
    }
    if(opts.capTop){
      const centerIdx = vertices.length / 3;
      vertices.push(0, topY, 0);
      normals.push(0, 1, 0);
      uvs.push(0.5, 0.5);
      const startIdx = vertices.length / 3;
      for(let i = 0; i <= segs; i++){
        const angle = (i / segs) * Math.PI * 2;
        vertices.push(topRadius * Math.cos(angle), topY, topRadius * Math.sin(angle));
        normals.push(0, 1, 0);
        uvs.push(0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5);
      }
      for(let i = 0; i < segs; i++){
        indices.push(centerIdx, startIdx + i, startIdx + i + 1);
      }
    }
    if(opts.capBottom){
      const centerIdx = vertices.length / 3;
      vertices.push(0, bottomY, 0);
      normals.push(0, -1, 0);
      uvs.push(0.5, 0.5);
      const startIdx = vertices.length / 3;
      for(let i = 0; i <= segs; i++){
        const angle = (i / segs) * Math.PI * 2;
        vertices.push(bottomRadius * Math.cos(angle), bottomY, bottomRadius * Math.sin(angle));
        normals.push(0, -1, 0);
        uvs.push(0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5);
      }
      for(let i = 0; i < segs; i++){
        indices.push(centerIdx, startIdx + i + 1, startIdx + i);
      }
    }
    return {
      vertices: new Float32Array(vertices),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: new Uint16Array(indices)
    };
  },
  createCapsule: function(radius, height, segments, rings){
    const segs = segments || 24;
    const r = rings || 12;
    const vertices = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const halfHeight = height / 2;
    for(let ring = 0; ring <= r; ring++){
      const phi = (ring / r) * Math.PI;
      const y = Math.cos(phi) * radius;
      const ringRadius = Math.sin(phi) * radius;
      for(let seg = 0; seg <= segs; seg++){
        const theta = (seg / segs) * Math.PI * 2;
        const x = ringRadius * Math.cos(theta);
        const z = ringRadius * Math.sin(theta);
        const yOffset = y >= 0 ? halfHeight : -halfHeight;
        vertices.push(x, y + yOffset, z);
        const nl = Math.sqrt(x*x + y*y + z*z) || 1;
        normals.push(x/nl, y/nl, z/nl);
        uvs.push(seg / segs, ring / r);
      }
    }
    for(let ring = 0; ring < r; ring++){
      for(let seg = 0; seg < segs; seg++){
        const i0 = ring * (segs + 1) + seg;
        const i1 = i0 + segs + 1;
        indices.push(i0, i1, i0 + 1);
        indices.push(i0 + 1, i1, i1 + 1);
      }
    }
    return {
      vertices: new Float32Array(vertices),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: new Uint16Array(indices)
    };
  },
  createPrism: function(sides, radius, height){
    const n = sides || 6;
    const vertices = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const topY = height / 2, bottomY = -height / 2;
    for(let i = 0; i <= n; i++){
      const angle = (i / n) * Math.PI * 2;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      vertices.push(radius * cos, bottomY, radius * sin);
      vertices.push(radius * cos, topY, radius * sin);
      const nextAngle = ((i + 0.5) / n) * Math.PI * 2;
      normals.push(Math.cos(nextAngle), 0, Math.sin(nextAngle));
      normals.push(Math.cos(nextAngle), 0, Math.sin(nextAngle));
      uvs.push(i / n, 0);
      uvs.push(i / n, 1);
    }
    for(let i = 0; i < n; i++){
      const i0 = i * 2, i1 = i * 2 + 1, i2 = i * 2 + 2, i3 = i * 2 + 3;
      indices.push(i0, i2, i1);
      indices.push(i1, i2, i3);
    }
    const topCenter = vertices.length / 3;
    vertices.push(0, topY, 0);
    normals.push(0, 1, 0);
    uvs.push(0.5, 0.5);
    const topStart = vertices.length / 3;
    for(let i = 0; i <= n; i++){
      const angle = (i / n) * Math.PI * 2;
      vertices.push(radius * Math.cos(angle), topY, radius * Math.sin(angle));
      normals.push(0, 1, 0);
      uvs.push(0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5);
    }
    for(let i = 0; i < n; i++){
      indices.push(topCenter, topStart + i, topStart + i + 1);
    }
    const bottomCenter = vertices.length / 3;
    vertices.push(0, bottomY, 0);
    normals.push(0, -1, 0);
    uvs.push(0.5, 0.5);
    const bottomStart = vertices.length / 3;
    for(let i = 0; i <= n; i++){
      const angle = (i / n) * Math.PI * 2;
      vertices.push(radius * Math.cos(angle), bottomY, radius * Math.sin(angle));
      normals.push(0, -1, 0);
      uvs.push(0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5);
    }
    for(let i = 0; i < n; i++){
      indices.push(bottomCenter, bottomStart + i + 1, bottomStart + i);
    }
    return {
      vertices: new Float32Array(vertices),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: new Uint16Array(indices)
    };
  },
  createTorusKnot: function(p, q, radius, tube, tubularSegments, radialSegments){
    const P = p || 2, Q = q || 3;
    const R = radius || 1;
    const r = tube || 0.3;
    const tub = tubularSegments || 128;
    const rad = radialSegments || 16;
    const vertices = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    function getPoint(u){
      const cu = Math.cos(u), su = Math.sin(u);
      const quOverP = Q / P * u;
      const cs = Math.cos(quOverP);
      return [
        R * (2 + cs) * 0.5 * cu,
        R * (2 + cs) * 0.5 * su,
        R * Math.sin(quOverP) * 0.5
      ];
    }
    for(let i = 0; i <= tub; i++){
      const u = i / tub * Math.PI * 2 * P;
      const p0 = getPoint(u);
      const p1 = getPoint(u + 0.01);
      const tangent = [p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]];
      const tl = Math.sqrt(tangent[0]**2 + tangent[1]**2 + tangent[2]**2) || 1;
      tangent[0]/=tl; tangent[1]/=tl; tangent[2]/=tl;
      let normal = [1, 0, 0];
      if(Math.abs(tangent[0]) > 0.9) normal = [0, 1, 0];
      const binormal = [
        tangent[1]*normal[2] - tangent[2]*normal[1],
        tangent[2]*normal[0] - tangent[0]*normal[2],
        tangent[0]*normal[1] - tangent[1]*normal[0]
      ];
      normal = [
        binormal[1]*tangent[2] - binormal[2]*tangent[1],
        binormal[2]*tangent[0] - binormal[0]*tangent[2],
        binormal[0]*tangent[1] - binormal[1]*tangent[0]
      ];
      for(let j = 0; j <= rad; j++){
        const v = j / rad * Math.PI * 2;
        const cv = Math.cos(v), sv = Math.sin(v);
        const nx = normal[0] * cv + binormal[0] * sv;
        const ny = normal[1] * cv + binormal[1] * sv;
        const nz = normal[2] * cv + binormal[2] * sv;
        vertices.push(p0[0] + r * nx, p0[1] + r * ny, p0[2] + r * nz);
        normals.push(nx, ny, nz);
        uvs.push(i / tub, j / rad);
      }
    }
    for(let i = 0; i < tub; i++){
      for(let j = 0; j < rad; j++){
        const a = i * (rad + 1) + j;
        const b = a + rad + 1;
        indices.push(a, b, a + 1);
        indices.push(a + 1, b, b + 1);
      }
    }
    return {
      vertices: new Float32Array(vertices),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: new Uint16Array(indices)
    };
  },
  createSpiral: function(radius, height, turns, segments){
    const R = radius || 1;
    const H = height || 2;
    const T = turns || 3;
    const segs = segments || 100;
    const vertices = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    for(let i = 0; i <= segs; i++){
      const t = i / segs;
      const angle = t * T * Math.PI * 2;
      const y = (t - 0.5) * H;
      const x = R * Math.cos(angle);
      const z = R * Math.sin(angle);
      vertices.push(x, y, z);
      const nx = Math.cos(angle), nz = Math.sin(angle);
      const ny = 0;
      normals.push(nx, ny, nz);
      uvs.push(t, 0);
    }
    for(let i = 0; i < segs; i++){
      indices.push(i, i + 1, i);
    }
    return {
      vertices: new Float32Array(vertices),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: new Uint16Array(indices),
      lineMode: true
    };
  },
  createSuperellipsoid: function(e1, e2, segments, rings){
    const n1 = e1 || 1, n2 = e2 || 1;
    const segs = segments || 32, r = rings || 16;
    const vertices = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    function sgn(x){ return x > 0 ? 1 : (x < 0 ? -1 : 0); }
    function spow(v, e){ return sgn(v) * Math.pow(Math.abs(v), e); }
    for(let ring = 0; ring <= r; ring++){
      const eta = (ring / r - 0.5) * Math.PI;
      const cosEta = Math.cos(eta), sinEta = Math.sin(eta);
      for(let seg = 0; seg <= segs; seg++){
        const omega = (seg / segs) * Math.PI * 2;
        const cosOmega = Math.cos(omega), sinOmega = Math.sin(omega);
        const x = spow(cosEta, n1) * spow(cosOmega, n2);
        const y = spow(sinEta, n1);
        const z = spow(cosEta, n1) * spow(sinOmega, n2);
        vertices.push(x, y, z);
        const nx = spow(cosEta, 2-n1) * spow(cosOmega, 2-n2);
        const ny = spow(sinEta, 2-n1);
        const nz = spow(cosEta, 2-n1) * spow(sinOmega, 2-n2);
        const nl = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
        normals.push(nx/nl, ny/nl, nz/nl);
        uvs.push(seg / segs, ring / r);
      }
    }
    for(let ring = 0; ring < r; ring++){
      for(let seg = 0; seg < segs; seg++){
        const a = ring * (segs + 1) + seg;
        const b = a + segs + 1;
        indices.push(a, b, a + 1);
        indices.push(a + 1, b, b + 1);
      }
    }
    return {
      vertices: new Float32Array(vertices),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: new Uint16Array(indices)
    };
  }
};

/* ===== 弹簧约束系统 =====
   支持: 线性弹簧 / 角度弹簧 / 阻尼 / 临界阻尼
*/
function createSpringSystem(options){
  const ss = {
    _springs: [],
    _gravity: (options && options.gravity) || [0, -9.8, 0],
    _damping: (options && options.damping) || 0.98,
    _iterations: (options && options.iterations) || 4
  };

  function addParticle(position, mass){
    const particle = {
      position: position ? [...position] : [0,0,0],
      prevPosition: position ? [...position] : [0,0,0],
      velocity: [0,0,0],
      mass: mass || 1,
      invMass: 1 / (mass || 1),
      pinned: false,
      acceleration: [0,0,0]
    };
    return particle;
  }

  function addSpring(particleA, particleB, restLength, stiffness, damping){
    const spring = {
      a: particleA,
      b: particleB,
      restLength: restLength || V3.dist(particleA.position, particleB.position),
      stiffness: stiffness !== undefined ? stiffness : 1,
      damping: damping !== undefined ? damping : 0.1
    };
    ss._springs.push(spring);
    return spring;
  }

  function removeSpring(spring){
    const idx = ss._springs.indexOf(spring);
    if(idx >= 0) ss._springs.splice(idx, 1);
  }

  function setGravity(x, y, z){
    ss._gravity = [x, y, z];
  }

  function update(dt){
    const particles = new Set();
    for(let i = 0; i < ss._springs.length; i++){
      particles.add(ss._springs[i].a);
      particles.add(ss._springs[i].b);
    }
    particles.forEach(function(p){
      if(p.pinned) return;
      p.acceleration[0] = ss._gravity[0] * p.invMass;
      p.acceleration[1] = ss._gravity[1] * p.invMass;
      p.acceleration[2] = ss._gravity[2] * p.invMass;
      p.velocity[0] += p.acceleration[0] * dt;
      p.velocity[1] += p.acceleration[1] * dt;
      p.velocity[2] += p.acceleration[2] * dt;
      p.velocity[0] *= ss._damping;
      p.velocity[1] *= ss._damping;
      p.velocity[2] *= ss._damping;
      p.prevPosition[0] = p.position[0];
      p.prevPosition[1] = p.position[1];
      p.prevPosition[2] = p.position[2];
      p.position[0] += p.velocity[0] * dt;
      p.position[1] += p.velocity[1] * dt;
      p.position[2] += p.velocity[2] * dt;
    });
    for(let iter = 0; iter < ss._iterations; iter++){
      for(let i = 0; i < ss._springs.length; i++){
        const s = ss._springs[i];
        const delta = [
          s.b.position[0] - s.a.position[0],
          s.b.position[1] - s.a.position[1],
          s.b.position[2] - s.a.position[2]
        ];
        const dist = Math.sqrt(delta[0]**2 + delta[1]**2 + delta[2]**2) || 0.0001;
        const diff = (dist - s.restLength) / dist;
        const totalInvMass = s.a.invMass + s.b.invMass;
        if(totalInvMass === 0) continue;
        const correction = [
          delta[0] * diff * s.stiffness,
          delta[1] * diff * s.stiffness,
          delta[2] * diff * s.stiffness
        ];
        if(!s.a.pinned){
          s.a.position[0] += correction[0] * (s.a.invMass / totalInvMass);
          s.a.position[1] += correction[1] * (s.a.invMass / totalInvMass);
          s.a.position[2] += correction[2] * (s.a.invMass / totalInvMass);
        }
        if(!s.b.pinned){
          s.b.position[0] -= correction[0] * (s.b.invMass / totalInvMass);
          s.b.position[1] -= correction[1] * (s.b.invMass / totalInvMass);
          s.b.position[2] -= correction[2] * (s.b.invMass / totalInvMass);
        }
      }
    }
    particles.forEach(function(p){
      if(p.pinned) return;
      p.velocity[0] = (p.position[0] - p.prevPosition[0]) / dt;
      p.velocity[1] = (p.position[1] - p.prevPosition[1]) / dt;
      p.velocity[2] = (p.position[2] - p.prevPosition[2]) / dt;
    });
  }

  function getSpringCount(){
    return ss._springs.length;
  }

  function clear(){
    ss._springs = [];
  }

  return { addParticle, addSpring, removeSpring, setGravity, update, getSpringCount, clear, ss };
}

/* ===== 关节约束系统 =====
   支持: 球关节 / 铰链关节 / 滑动关节 / 圆锥限制
*/
function createJointSystem(){
  const js = {
    _joints: [],
    _bodies: new Map()
  };

  function registerBody(id, body){
    js._bodies.set(id, body);
  }

  function addBallJoint(bodyA, bodyB, anchorA, anchorB){
    const joint = {
      type: 'ball',
      bodyA: bodyA,
      bodyB: bodyB,
      anchorA: [...anchorA],
      anchorB: [...anchorB],
      enabled: true,
      breakForce: Infinity
    };
    js._joints.push(joint);
    return joint;
  }

  function addHingeJoint(bodyA, bodyB, anchorA, anchorB, axisA, axisB, limits){
    const joint = {
      type: 'hinge',
      bodyA: bodyA,
      bodyB: bodyB,
      anchorA: [...anchorA],
      anchorB: [...anchorB],
      axisA: [...axisA],
      axisB: [...axisB],
      lowerLimit: limits ? limits.lower : -Math.PI,
      upperLimit: limits ? limits.upper : Math.PI,
      angle: 0,
      enabled: true
    };
    js._joints.push(joint);
    return joint;
  }

  function addSliderJoint(bodyA, bodyB, axisA, axisB, limits){
    const joint = {
      type: 'slider',
      bodyA: bodyA,
      bodyB: bodyB,
      axisA: [...axisA],
      axisB: [...axisB],
      lowerLimit: limits ? limits.lower : 0,
      upperLimit: limits ? limits.upper : 1,
      position: 0,
      enabled: true
    };
    js._joints.push(joint);
    return joint;
  }

  function addConeJoint(bodyA, bodyB, anchorA, anchorB, axisA, axisB, swing1, swing2, twist){
    const joint = {
      type: 'cone',
      bodyA: bodyA,
      bodyB: bodyB,
      anchorA: [...anchorA],
      anchorB: [...anchorB],
      axisA: [...axisA],
      axisB: [...axisB],
      swingLimit1: swing1 || Math.PI * 0.25,
      swingLimit2: swing2 || Math.PI * 0.25,
      twistLimit: twist || Math.PI * 0.5,
      enabled: true
    };
    js._joints.push(joint);
    return joint;
  }

  function removeJoint(joint){
    const idx = js._joints.indexOf(joint);
    if(idx >= 0) js._joints.splice(idx, 1);
  }

  function solve(dt){
    for(let i = 0; i < js._joints.length; i++){
      const joint = js._joints[i];
      if(!joint.enabled) continue;
      if(joint.type === 'ball'){
        solveBallJoint(joint);
      } else if(joint.type === 'hinge'){
        solveHingeJoint(joint);
      } else if(joint.type === 'slider'){
        solveSliderJoint(joint);
      } else if(joint.type === 'cone'){
        solveConeJoint(joint);
      }
    }
  }

  function solveBallJoint(joint){
    const a = joint.bodyA, b = joint.bodyB;
    if(!a || !b) return;
    const worldA = [
      a.position[0] + joint.anchorA[0],
      a.position[1] + joint.anchorA[1],
      a.position[2] + joint.anchorA[2]
    ];
    const worldB = [
      b.position[0] + joint.anchorB[0],
      b.position[1] + joint.anchorB[1],
      b.position[2] + joint.anchorB[2]
    ];
    const delta = [worldB[0]-worldA[0], worldB[1]-worldA[1], worldB[2]-worldA[2]];
    const totalInvMass = (a.invMass || 0) + (b.invMass || 0);
    if(totalInvMass === 0) return;
    const correction = 0.5;
    a.position[0] += delta[0] * (a.invMass / totalInvMass) * correction;
    a.position[1] += delta[1] * (a.invMass / totalInvMass) * correction;
    a.position[2] += delta[2] * (a.invMass / totalInvMass) * correction;
    b.position[0] -= delta[0] * (b.invMass / totalInvMass) * correction;
    b.position[1] -= delta[1] * (b.invMass / totalInvMass) * correction;
    b.position[2] -= delta[2] * (b.invMass / totalInvMass) * correction;
  }

  function solveHingeJoint(joint){
    solveBallJoint(joint);
  }

  function solveSliderJoint(joint){
  }

  function solveConeJoint(joint){
    solveBallJoint(joint);
  }

  function getJointCount(){
    return js._joints.length;
  }

  function clear(){
    js._joints = [];
    js._bodies.clear();
  }

  return { registerBody, addBallJoint, addHingeJoint, addSliderJoint, addConeJoint, removeJoint, solve, getJointCount, clear, js };
}



/* ===== PBR着色器库 =====
   支持: 金属度/粗糙度 / 法线贴图 / 环境光遮蔽 / IBL
*/
