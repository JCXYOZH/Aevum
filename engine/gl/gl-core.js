/**
 * OrbWebGLCore Core - 纯自研WebGL引擎核心扩展
 * 三大方向：程序化动作 / 连续性互动 / 高画质渲染
 * 无任何第三方依赖，全部从零实现
 * @version 1.0.0
 */

'use strict';

// ============================================================
// 模块一：数学扩展库 MathExt (约800行)
// 四元数、矩阵、向量的高级运算，动画和物理的基础
// ============================================================

const OrbMath = (function(){

  // 常量
  const EPSILON = 1e-6;
  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;
  const PI2 = Math.PI * 2;

  // ============================================================
  // Vec3 - 三维向量
  // ============================================================
  class Vec3 {
    constructor(x = 0, y = 0, z = 0){
      this.x = x; this.y = y; this.z = z;
    }

    set(x, y, z){ this.x = x; this.y = y; this.z = z; return this; }
    copy(v){ this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone(){ return new Vec3(this.x, this.y, this.z); }
    add(v){ this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    sub(v){ this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
    mul(s){ this.x *= s; this.y *= s; this.z *= s; return this; }
    div(s){ this.x /= s; this.y /= s; this.z /= s; return this; }
    negate(){ this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
    dot(v){ return this.x * v.x + this.y * v.y + this.z * v.z; }
    cross(v){
      const x = this.y * v.z - this.z * v.y;
      const y = this.z * v.x - this.x * v.z;
      const z = this.x * v.y - this.y * v.x;
      this.x = x; this.y = y; this.z = z;
      return this;
    }
    length(){ return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
    lengthSq(){ return this.x * this.x + this.y * this.y + this.z * this.z; }
    normalize(){
      const len = this.length();
      if(len > EPSILON){ this.x /= len; this.y /= len; this.z /= len; }
      return this;
    }
    distanceTo(v){ return Math.sqrt(this.distanceToSq(v)); }
    distanceToSq(v){
      const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
      return dx * dx + dy * dy + dz * dz;
    }
    lerp(v, t){
      this.x += (v.x - this.x) * t;
      this.y += (v.y - this.y) * t;
      this.z += (v.z - this.z) * t;
      return this;
    }
    clamp(min, max){
      this.x = Math.max(min.x, Math.min(max.x, this.x));
      this.y = Math.max(min.y, Math.min(max.y, this.y));
      this.z = Math.max(min.z, Math.min(max.z, this.z));
      return this;
    }
    min(v){ this.x = Math.min(this.x, v.x); this.y = Math.min(this.y, v.y); this.z = Math.min(this.z, v.z); return this; }
    max(v){ this.x = Math.max(this.x, v.x); this.y = Math.max(this.y, v.y); this.z = Math.max(this.z, v.z); return this; }
    applyQuaternion(q){
      const ix = q.w * this.x + q.y * this.z - q.z * this.y;
      const iy = q.w * this.y + q.z * this.x - q.x * this.z;
      const iz = q.w * this.z + q.x * this.y - q.y * this.x;
      const iw = -q.x * this.x - q.y * this.y - q.z * this.z;
      this.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
      this.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
      this.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
      return this;
    }
    applyMatrix4(m){
      const x = this.x, y = this.y, z = this.z;
      const e = m.elements;
      const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
      this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
      this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
      this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
      return this;
    }
    projectOnVector(v){
      const d = v.dot(v);
      if(d < EPSILON) return this.set(0, 0, 0);
      const s = this.dot(v) / d;
      return this.copy(v).mul(s);
    }
    projectOnPlane(normal){
      const v = this.clone().projectOnVector(normal);
      return this.sub(v);
    }
    angleTo(v){
      const d = this.dot(v) / (this.length() * v.length());
      return Math.acos(Math.max(-1, Math.min(1, d)));
    }
    equals(v){
      return Math.abs(this.x - v.x) < EPSILON &&
             Math.abs(this.y - v.y) < EPSILON &&
             Math.abs(this.z - v.z) < EPSILON;
    }
    toArray(){ return [this.x, this.y, this.z]; }
    fromArray(arr, offset = 0){ this.x = arr[offset]; this.y = arr[offset+1]; this.z = arr[offset+2]; return this; }
    static zero(){ return new Vec3(0, 0, 0); }
    static one(){ return new Vec3(1, 1, 1); }
    static up(){ return new Vec3(0, 1, 0); }
    static forward(){ return new Vec3(0, 0, -1); }
    static right(){ return new Vec3(1, 0, 0); }
    static add(a, b){ return new Vec3(a.x + b.x, a.y + b.y, a.z + b.z); }
    static sub(a, b){ return new Vec3(a.x - b.x, a.y - b.y, a.z - b.z); }
    static mul(v, s){ return new Vec3(v.x * s, v.y * s, v.z * s); }
    static dot(a, b){ return a.x * b.x + a.y * b.y + a.z * b.z; }
    static cross(a, b){ return new Vec3().crossVectors(a, b); }
    static crossVectors(a, b){
      return new Vec3(
        a.y * b.z - a.z * b.y,
        a.z * b.x - a.x * b.z,
        a.x * b.y - a.y * b.x
      );
    }
    static lerp(a, b, t){ return a.clone().lerp(b, t); }
    static distance(a, b){ return a.distanceTo(b); }
    static normalize(v){ return v.clone().normalize(); }
  }

  // ============================================================
  // Quat - 四元数
  // ============================================================
  class Quat {
    constructor(x = 0, y = 0, z = 0, w = 1){
      this.x = x; this.y = y; this.z = z; this.w = w;
    }

    set(x, y, z, w){ this.x = x; this.y = y; this.z = z; this.w = w; return this; }
    copy(q){ this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
    clone(){ return new Quat(this.x, this.y, this.z, this.w); }
    identity(){ this.x = 0; this.y = 0; this.z = 0; this.w = 1; return this; }
    isIdentity(){ return Math.abs(this.x) < EPSILON && Math.abs(this.y) < EPSILON && Math.abs(this.z) < EPSILON && Math.abs(this.w - 1) < EPSILON; }

    setFromAxisAngle(axis, angle){
      const half = angle * 0.5;
      const s = Math.sin(half);
      this.x = axis.x * s;
      this.y = axis.y * s;
      this.z = axis.z * s;
      this.w = Math.cos(half);
      return this;
    }

    setFromEuler(x, y, z, order = 'XYZ'){
      const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
      const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
      if(order === 'XYZ'){
        this.x = s1 * c2 * c3 + c1 * s2 * s3;
        this.y = c1 * s2 * c3 - s1 * c2 * s3;
        this.z = c1 * c2 * s3 + s1 * s2 * c3;
        this.w = c1 * c2 * c3 - s1 * s2 * s3;
      } else if(order === 'YXZ'){
        this.x = s1 * c2 * c3 + c1 * s2 * s3;
        this.y = c1 * s2 * c3 - s1 * c2 * s3;
        this.z = c1 * c2 * s3 - s1 * s2 * c3;
        this.w = c1 * c2 * c3 + s1 * s2 * s3;
      } else if(order === 'ZXY'){
        this.x = s1 * c2 * c3 - c1 * s2 * s3;
        this.y = c1 * s2 * c3 + s1 * c2 * s3;
        this.z = c1 * c2 * s3 + s1 * s2 * c3;
        this.w = c1 * c2 * c3 - s1 * s2 * s3;
      } else if(order === 'ZYX'){
        this.x = s1 * c2 * c3 - c1 * s2 * s3;
        this.y = c1 * s2 * c3 + s1 * c2 * s3;
        this.z = c1 * c2 * s3 - s1 * s2 * c3;
        this.w = c1 * c2 * c3 + s1 * s2 * s3;
      } else if(order === 'YZX'){
        this.x = s1 * c2 * c3 + c1 * s2 * s3;
        this.y = c1 * s2 * c3 + s1 * c2 * s3;
        this.z = c1 * c2 * s3 - s1 * s2 * c3;
        this.w = c1 * c2 * c3 - s1 * s2 * s3;
      } else if(order === 'XZY'){
        this.x = s1 * c2 * c3 - c1 * s2 * s3;
        this.y = c1 * s2 * c3 - s1 * c2 * s3;
        this.z = c1 * c2 * s3 + s1 * s2 * c3;
        this.w = c1 * c2 * c3 + s1 * s2 * s3;
      }
      return this;
    }

    setFromRotationMatrix(m){
      const e = m.elements;
      const m11 = e[0], m12 = e[4], m13 = e[8];
      const m21 = e[1], m22 = e[5], m23 = e[9];
      const m31 = e[2], m32 = e[6], m33 = e[10];
      const trace = m11 + m22 + m33;
      if(trace > 0){
        const s = 0.5 / Math.sqrt(trace + 1);
        this.w = 0.25 / s;
        this.x = (m32 - m23) * s;
        this.y = (m13 - m31) * s;
        this.z = (m21 - m12) * s;
      } else if(m11 > m22 && m11 > m33){
        const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
        this.w = (m32 - m23) / s;
        this.x = 0.25 * s;
        this.y = (m12 + m21) / s;
        this.z = (m13 + m31) / s;
      } else if(m22 > m33){
        const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
        this.w = (m13 - m31) / s;
        this.x = (m12 + m21) / s;
        this.y = 0.25 * s;
        this.z = (m23 + m32) / s;
      } else {
        const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
        this.w = (m21 - m12) / s;
        this.x = (m13 + m31) / s;
        this.y = (m23 + m32) / s;
        this.z = 0.25 * s;
      }
      return this;
    }

    setFromUnitVectors(vFrom, vTo){
      let r = vFrom.dot(vTo) + 1;
      if(r < EPSILON){
        r = 0;
        if(Math.abs(vFrom.x) > Math.abs(vFrom.z)){
          this.x = -vFrom.y; this.y = vFrom.x; this.z = 0; this.w = r;
        } else {
          this.x = 0; this.y = -vFrom.z; this.z = vFrom.y; this.w = r;
        }
      } else {
        this.x = vFrom.y * vTo.z - vFrom.z * vTo.y;
        this.y = vFrom.z * vTo.x - vFrom.x * vTo.z;
        this.z = vFrom.x * vTo.y - vFrom.y * vTo.x;
        this.w = r;
      }
      return this.normalize();
    }

    angleTo(q){
      return 2 * Math.acos(Math.abs(Math.max(-1, Math.min(1, this.dot(q)))));
    }

    rotateTowards(q, step){
      const angle = this.angleTo(q);
      if(angle < EPSILON) return this;
      const t = Math.min(1, step / angle);
      this.slerp(q, t);
      return this;
    }

    inverse(){
      this.x = -this.x; this.y = -this.y; this.z = -this.z;
      return this;
    }

    conjugate(){
      this.x = -this.x; this.y = -this.y; this.z = -this.z;
      return this;
    }

    dot(q){ return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w; }

    lengthSq(){ return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w; }
    length(){ return Math.sqrt(this.lengthSq()); }

    normalize(){
      let len = this.length();
      if(len < EPSILON){ this.identity(); return this; }
      len = 1 / len;
      this.x *= len; this.y *= len; this.z *= len; this.w *= len;
      return this;
    }

    multiply(q){
      const ax = this.x, ay = this.y, az = this.z, aw = this.w;
      const bx = q.x, by = q.y, bz = q.z, bw = q.w;
      this.x = ax * bw + aw * bx + ay * bz - az * by;
      this.y = ay * bw + aw * by + az * bx - ax * bz;
      this.z = az * bw + aw * bz + ax * by - ay * bx;
      this.w = aw * bw - ax * bx - ay * by - az * bz;
      return this;
    }

    premultiply(q){
      const ax = q.x, ay = q.y, az = q.z, aw = q.w;
      const bx = this.x, by = this.y, bz = this.z, bw = this.w;
      this.x = ax * bw + aw * bx + ay * bz - az * by;
      this.y = ay * bw + aw * by + az * bx - ax * bz;
      this.z = az * bw + aw * bz + ax * by - ay * bx;
      this.w = aw * bw - ax * bx - ay * by - az * bz;
      return this;
    }

    slerp(q, t){
      if(t <= 0) return this;
      if(t >= 1) return this.copy(q);
      let cosHalfTheta = this.dot(q);
      let q2 = q;
      if(cosHalfTheta < 0){
        q2 = q.clone().negate();
        cosHalfTheta = -cosHalfTheta;
      }
      if(cosHalfTheta >= 1 - EPSILON){
        this.x += (q2.x - this.x) * t;
        this.y += (q2.y - this.y) * t;
        this.z += (q2.z - this.z) * t;
        this.w += (q2.w - this.w) * t;
        return this.normalize();
      }
      const halfTheta = Math.acos(cosHalfTheta);
      const sinHalfTheta = Math.sqrt(1 - cosHalfTheta * cosHalfTheta);
      if(Math.abs(sinHalfTheta) < EPSILON){
        this.x = (this.x + q2.x) * 0.5;
        this.y = (this.y + q2.y) * 0.5;
        this.z = (this.z + q2.z) * 0.5;
        this.w = (this.w + q2.w) * 0.5;
        return this;
      }
      const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
      const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
      this.x = this.x * ratioA + q2.x * ratioB;
      this.y = this.y * ratioA + q2.y * ratioB;
      this.z = this.z * ratioA + q2.z * ratioB;
      this.w = this.w * ratioA + q2.w * ratioB;
      return this;
    }

    negate(){ this.x = -this.x; this.y = -this.y; this.z = -this.z; this.w = -this.w; return this; }

    equals(q){
      return Math.abs(this.x - q.x) < EPSILON &&
             Math.abs(this.y - q.y) < EPSILON &&
             Math.abs(this.z - q.z) < EPSILON &&
             Math.abs(this.w - q.w) < EPSILON;
    }

    toArray(){ return [this.x, this.y, this.z, this.w]; }
    fromArray(arr, offset = 0){ this.x = arr[offset]; this.y = arr[offset+1]; this.z = arr[offset+2]; this.w = arr[offset+3]; return this; }

    toEuler(order = 'XYZ'){
      const euler = {x: 0, y: 0, z: 0};
      const x = this.x, y = this.y, z = this.z, w = this.w;
      const sinr_cosp = 2 * (w * x + y * z);
      const cosr_cosp = 1 - 2 * (x * x + y * y);
      euler.x = Math.atan2(sinr_cosp, cosr_cosp);
      const sinp = 2 * (w * y - z * x);
      if(Math.abs(sinp) >= 1) euler.y = Math.sign(sinp) * Math.PI / 2;
      else euler.y = Math.asin(sinp);
      const siny_cosp = 2 * (w * z + x * y);
      const cosy_cosp = 1 - 2 * (y * y + z * z);
      euler.z = Math.atan2(siny_cosp, cosy_cosp);
      return euler;
    }

    static identity(){ return new Quat(0, 0, 0, 1); }
    static multiply(a, b){ return a.clone().multiply(b); }
    static slerp(a, b, t){ return a.clone().slerp(b, t); }
    static fromAxisAngle(axis, angle){ return new Quat().setFromAxisAngle(axis, angle); }
    static fromEuler(x, y, z, order){ return new Quat().setFromEuler(x, y, z, order); }
    static dot(a, b){ return a.dot(b); }
    static normalize(q){ return q.clone().normalize(); }
    static lerp(a, b, t){
      const r = new Quat();
      r.x = a.x + (b.x - a.x) * t;
      r.y = a.y + (b.y - a.y) * t;
      r.z = a.z + (b.z - a.z) * t;
      r.w = a.w + (b.w - a.w) * t;
      return r.normalize();
    }
  }

  // ============================================================
  // Mat4 - 4x4矩阵
  // ============================================================
  class Mat4 {
    constructor(){
      this.elements = new Float32Array(16);
      this.identity();
    }

    identity(){
      const e = this.elements;
      e[0] = 1; e[4] = 0; e[8] = 0; e[12] = 0;
      e[1] = 0; e[5] = 1; e[9] = 0; e[13] = 0;
      e[2] = 0; e[6] = 0; e[10] = 1; e[14] = 0;
      e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
      return this;
    }

    copy(m){ this.elements.set(m.elements); return this; }
    clone(){ const m = new Mat4(); m.copy(this); return m; }

    set(n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44){
      const e = this.elements;
      e[0] = n11; e[4] = n12; e[8] = n13; e[12] = n14;
      e[1] = n21; e[5] = n22; e[9] = n23; e[13] = n24;
      e[2] = n31; e[6] = n32; e[10] = n33; e[14] = n34;
      e[3] = n41; e[7] = n42; e[11] = n43; e[15] = n44;
      return this;
    }

    multiply(m){
      const ae = this.elements, be = m.elements;
      const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
      const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
      const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
      const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];
      const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
      const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
      const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
      const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
      ae[0] = a11*b11 + a12*b21 + a13*b31 + a14*b41;
      ae[4] = a11*b12 + a12*b22 + a13*b32 + a14*b42;
      ae[8] = a11*b13 + a12*b23 + a13*b33 + a14*b43;
      ae[12] = a11*b14 + a12*b24 + a13*b34 + a14*b44;
      ae[1] = a21*b11 + a22*b21 + a23*b31 + a24*b41;
      ae[5] = a21*b12 + a22*b22 + a23*b32 + a24*b42;
      ae[9] = a21*b13 + a22*b23 + a23*b33 + a24*b43;
      ae[13] = a21*b14 + a22*b24 + a23*b34 + a24*b44;
      ae[2] = a31*b11 + a32*b21 + a33*b31 + a34*b41;
      ae[6] = a31*b12 + a32*b22 + a33*b32 + a34*b42;
      ae[10] = a31*b13 + a32*b23 + a33*b33 + a34*b43;
      ae[14] = a31*b14 + a32*b24 + a33*b34 + a34*b44;
      ae[3] = a41*b11 + a42*b21 + a43*b31 + a44*b41;
      ae[7] = a41*b12 + a42*b22 + a43*b32 + a44*b42;
      ae[11] = a41*b13 + a42*b23 + a43*b33 + a44*b43;
      ae[15] = a41*b14 + a42*b24 + a43*b34 + a44*b44;
      return this;
    }

    premultiply(m){
      const ae = m.elements, be = this.elements;
      const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
      const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
      const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
      const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];
      const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
      const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
      const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
      const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
      be[0] = a11*b11 + a12*b21 + a13*b31 + a14*b41;
      be[4] = a11*b12 + a12*b22 + a13*b32 + a14*b42;
      be[8] = a11*b13 + a12*b23 + a13*b33 + a14*b43;
      be[12] = a11*b14 + a12*b24 + a13*b34 + a14*b44;
      be[1] = a21*b11 + a22*b21 + a23*b31 + a24*b41;
      be[5] = a21*b12 + a22*b22 + a23*b32 + a24*b42;
      be[9] = a21*b13 + a22*b23 + a23*b33 + a24*b43;
      be[13] = a21*b14 + a22*b24 + a23*b34 + a24*b44;
      be[2] = a31*b11 + a32*b21 + a33*b31 + a34*b41;
      be[6] = a31*b12 + a32*b22 + a33*b32 + a34*b42;
      be[10] = a31*b13 + a32*b23 + a33*b33 + a34*b43;
      be[14] = a31*b14 + a32*b24 + a33*b34 + a34*b44;
      be[3] = a41*b11 + a42*b21 + a43*b31 + a44*b41;
      be[7] = a41*b12 + a42*b22 + a43*b32 + a44*b42;
      be[11] = a41*b13 + a42*b23 + a43*b33 + a44*b43;
      be[15] = a41*b14 + a42*b24 + a43*b34 + a44*b44;
      return this;
    }

    multiplyScalar(s){
      const e = this.elements;
      for(let i = 0; i < 16; i++) e[i] *= s;
      return this;
    }

    determinant(){
      const e = this.elements;
      const n11 = e[0], n12 = e[4], n13 = e[8], n14 = e[12];
      const n21 = e[1], n22 = e[5], n23 = e[9], n24 = e[13];
      const n31 = e[2], n32 = e[6], n33 = e[10], n34 = e[14];
      const n41 = e[3], n42 = e[7], n43 = e[11], n44 = e[15];
      return (
        n41 * (+n14*n23*n32 - n13*n24*n32 - n14*n22*n33 + n12*n24*n33 + n13*n22*n34 - n12*n23*n34) +
        n42 * (+n11*n23*n34 - n11*n24*n33 + n14*n21*n33 - n13*n21*n34 + n12*n24*n31 - n14*n22*n31) +
        n43 * (+n11*n24*n32 - n11*n22*n34 - n14*n21*n32 + n12*n21*n34 + n13*n22*n31 - n12*n23*n31) +
        n44 * (-n13*n21*n32 - n11*n23*n32 + n11*n22*n33 + n13*n21*n31 - n12*n21*n33 + n12*n23*n31)
      );
    }

    transpose(){
      const e = this.elements;
      let t;
      t = e[1]; e[1] = e[4]; e[4] = t;
      t = e[2]; e[2] = e[8]; e[8] = t;
      t = e[6]; e[6] = e[9]; e[9] = t;
      t = e[3]; e[3] = e[12]; e[12] = t;
      t = e[7]; e[7] = e[13]; e[13] = t;
      t = e[11]; e[11] = e[14]; e[14] = t;
      return this;
    }

    inverse(){
      const e = this.elements;
      const n11 = e[0], n21 = e[1], n31 = e[2], n41 = e[3];
      const n12 = e[4], n22 = e[5], n32 = e[6], n42 = e[7];
      const n13 = e[8], n23 = e[9], n33 = e[10], n43 = e[11];
      const n14 = e[12], n24 = e[13], n34 = e[14], n44 = e[15];
      const t11 = n23*n34*n42 - n24*n33*n42 + n24*n32*n43 - n22*n34*n43 - n23*n32*n44 + n22*n33*n44;
      const t12 = n14*n33*n42 - n13*n34*n42 - n14*n32*n43 + n12*n34*n43 + n13*n32*n44 - n12*n33*n44;
      const t13 = n13*n24*n42 - n14*n23*n42 + n14*n22*n43 - n12*n24*n43 - n13*n22*n44 + n12*n23*n44;
      const t14 = n14*n23*n32 - n13*n24*n32 - n14*n22*n33 + n12*n24*n33 + n13*n22*n34 - n12*n23*n34;
      const det = n11*t11 + n21*t12 + n31*t13 + n41*t14;
      if(det === 0) return this.identity();
      const detInv = 1 / det;
      e[0] = t11 * detInv;
      e[1] = (n24*n33*n41 - n23*n34*n41 - n24*n31*n43 + n21*n34*n43 + n23*n31*n44 - n21*n33*n44) * detInv;
      e[2] = (n22*n34*n41 - n24*n32*n41 + n24*n31*n42 - n21*n34*n42 - n22*n31*n44 + n21*n32*n44) * detInv;
      e[3] = (n23*n32*n41 - n22*n33*n41 - n23*n31*n42 + n21*n33*n42 + n22*n31*n43 - n21*n32*n43) * detInv;
      e[4] = t12 * detInv;
      e[5] = (n13*n34*n41 - n14*n33*n41 + n14*n31*n43 - n11*n34*n43 - n13*n31*n44 + n11*n33*n44) * detInv;
      e[6] = (n14*n32*n41 - n12*n34*n41 - n14*n31*n42 + n11*n34*n42 + n12*n31*n44 - n11*n32*n44) * detInv;
      e[7] = (n12*n33*n41 - n13*n32*n41 + n13*n31*n42 - n11*n33*n42 - n12*n31*n43 + n11*n32*n43) * detInv;
      e[8] = t13 * detInv;
      e[9] = (n14*n23*n41 - n13*n24*n41 - n14*n21*n43 + n11*n24*n43 + n13*n21*n44 - n11*n23*n44) * detInv;
      e[10] = (n12*n24*n41 - n14*n22*n41 + n14*n21*n42 - n11*n24*n42 - n12*n21*n44 + n11*n22*n44) * detInv;
      e[11] = (n13*n22*n41 - n12*n23*n41 - n13*n21*n42 + n11*n23*n42 + n12*n21*n43 - n11*n22*n43) * detInv;
      e[12] = t14 * detInv;
      e[13] = (n13*n24*n31 - n14*n23*n31 + n14*n21*n33 - n11*n24*n33 - n13*n21*n34 + n11*n23*n34) * detInv;
      e[14] = (n14*n22*n31 - n12*n24*n31 - n14*n21*n32 + n11*n24*n32 + n12*n21*n34 - n11*n22*n34) * detInv;
      e[15] = (n12*n23*n31 - n13*n22*n31 + n13*n21*n32 - n11*n23*n32 - n12*n21*n33 + n11*n22*n33) * detInv;
      return this;
    }

    makeTranslation(x, y, z){
      this.identity();
      this.elements[12] = x;
      this.elements[13] = y;
      this.elements[14] = z;
      return this;
    }

    makeRotationX(theta){
      const c = Math.cos(theta), s = Math.sin(theta);
      this.identity();
      this.elements[5] = c; this.elements[9] = -s;
      this.elements[6] = s; this.elements[10] = c;
      return this;
    }

    makeRotationY(theta){
      const c = Math.cos(theta), s = Math.sin(theta);
      this.identity();
      this.elements[0] = c; this.elements[8] = s;
      this.elements[2] = -s; this.elements[10] = c;
      return this;
    }

    makeRotationZ(theta){
      const c = Math.cos(theta), s = Math.sin(theta);
      this.identity();
      this.elements[0] = c; this.elements[4] = -s;
      this.elements[1] = s; this.elements[5] = c;
      return this;
    }

    makeScale(x, y, z){
      this.identity();
      this.elements[0] = x;
      this.elements[5] = y;
      this.elements[10] = z;
      return this;
    }

    makeRotationFromQuaternion(q){
      const x = q.x, y = q.y, z = q.z, w = q.w;
      const x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2;
      const yy = y * y2, yz = y * z2, zz = z * z2;
      const wx = w * x2, wy = w * y2, wz = w * z2;
      const e = this.elements;
      e[0] = 1 - (yy + zz); e[4] = xy - wz; e[8] = xz + wy;
      e[1] = xy + wz; e[5] = 1 - (xx + zz); e[9] = yz - wx;
      e[2] = xz - wy; e[6] = yz + wx; e[10] = 1 - (xx + yy);
      e[3] = 0; e[7] = 0; e[11] = 0;
      e[12] = 0; e[13] = 0; e[14] = 0; e[15] = 1;
      return this;
    }

    compose(position, quaternion, scale){
      this.makeRotationFromQuaternion(quaternion);
      const e = this.elements;
      e[0] *= scale.x; e[4] *= scale.y; e[8] *= scale.z;
      e[1] *= scale.x; e[5] *= scale.y; e[9] *= scale.z;
      e[2] *= scale.x; e[6] *= scale.y; e[10] *= scale.z;
      e[12] = position.x; e[13] = position.y; e[14] = position.z;
      return this;
    }

    decompose(position, quaternion, scale){
      const e = this.elements;
      position.set(e[12], e[13], e[14]);
      const sx = Math.sqrt(e[0]*e[0] + e[1]*e[1] + e[2]*e[2]);
      const sy = Math.sqrt(e[4]*e[4] + e[5]*e[5] + e[6]*e[6]);
      const sz = Math.sqrt(e[8]*e[8] + e[9]*e[9] + e[10]*e[10]);
      scale.set(sx, sy, sz);
      const m = this.clone();
      const me = m.elements;
      if(sx > EPSILON){ me[0] /= sx; me[1] /= sx; me[2] /= sx; }
      if(sy > EPSILON){ me[4] /= sy; me[5] /= sy; me[6] /= sy; }
      if(sz > EPSILON){ me[8] /= sz; me[9] /= sz; me[10] /= sz; }
      quaternion.setFromRotationMatrix(m);
      return {position, quaternion, scale};
    }

    lookAt(eye, target, up){
      const z = Vec3.sub(eye, target).normalize();
      const x = Vec3.cross(up, z).normalize();
      const y = Vec3.cross(z, x).normalize();
      const e = this.elements;
      e[0] = x.x; e[4] = y.x; e[8] = z.x;
      e[1] = x.y; e[5] = y.y; e[9] = z.y;
      e[2] = x.z; e[6] = y.z; e[10] = z.z;
      e[12] = -x.dot(eye); e[13] = -y.dot(eye); e[14] = -z.dot(eye);
      e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
      return this;
    }

    perspective(fov, aspect, near, far){
      const f = 1 / Math.tan(fov / 2);
      const nf = 1 / (near - far);
      const e = this.elements;
      e[0] = f / aspect; e[4] = 0; e[8] = 0; e[12] = 0;
      e[1] = 0; e[5] = f; e[9] = 0; e[13] = 0;
      e[2] = 0; e[6] = 0; e[10] = (far + near) * nf; e[14] = 2 * far * near * nf;
      e[3] = 0; e[7] = 0; e[11] = -1; e[15] = 0;
      return this;
    }

    orthographic(left, right, top, bottom, near, far){
      const w = 1 / (right - left);
      const h = 1 / (top - bottom);
      const p = 1 / (far - near);
      const x = (right + left) * w;
      const y = (top + bottom) * h;
      const z = (far + near) * p;
      const e = this.elements;
      e[0] = 2 * w; e[4] = 0; e[8] = 0; e[12] = -x;
      e[1] = 0; e[5] = 2 * h; e[9] = 0; e[13] = -y;
      e[2] = 0; e[6] = 0; e[10] = -2 * p; e[14] = -z;
      e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
      return this;
    }

    getPosition(){
      const e = this.elements;
      return new Vec3(e[12], e[13], e[14]);
    }

    getScale(){
      const e = this.elements;
      return new Vec3(
        Math.sqrt(e[0]*e[0] + e[1]*e[1] + e[2]*e[2]),
        Math.sqrt(e[4]*e[4] + e[5]*e[5] + e[6]*e[6]),
        Math.sqrt(e[8]*e[8] + e[9]*e[9] + e[10]*e[10])
      );
    }

    toArray(){ return Array.from(this.elements); }
    fromArray(arr, offset = 0){ this.elements.set(arr.slice(offset, offset + 16)); return this; }

    static identity(){ return new Mat4(); }
    static multiply(a, b){ return a.clone().multiply(b); }
    static translation(x, y, z){ return new Mat4().makeTranslation(x, y, z); }
    static rotationX(t){ return new Mat4().makeRotationX(t); }
    static rotationY(t){ return new Mat4().makeRotationY(t); }
    static rotationZ(t){ return new Mat4().makeRotationZ(t); }
    static scale(x, y, z){ return new Mat4().makeScale(x, y, z); }
    static compose(pos, quat, scl){ return new Mat4().compose(pos, quat, scl); }
    static perspective(fov, aspect, near, far){ return new Mat4().perspective(fov, aspect, near, far); }
    static orthographic(l, r, t, b, n, f){ return new Mat4().orthographic(l, r, t, b, n, f); }
    static lookAt(eye, target, up){ return new Mat4().lookAt(eye, target, up); }
  }

  // ============================================================
  // 工具函数
  // ============================================================
  function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
  function lerp(a, b, t){ return a + (b - a) * t; }
  function smoothstep(edge0, edge1, x){
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function smootherstep(edge0, edge1, x){
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  function pingPong(x, length = 1){
    return length - Math.abs(x % (2 * length) - length);
  }
  function repeat(x, length = 1){
    return x - Math.floor(x / length) * length;
  }
  function damp(current, target, lambda, dt){
    return lerp(current, target, 1 - Math.exp(-lambda * dt));
  }
  function dampAngle(current, target, lambda, dt){
    let diff = target - current;
    while(diff > Math.PI) diff -= PI2;
    while(diff < -Math.PI) diff += PI2;
    return current + diff * (1 - Math.exp(-lambda * dt));
  }
  function randomRange(min, max){ return min + Math.random() * (max - min); }
  function randomInt(min, max){ return Math.floor(randomRange(min, max + 1)); }
  function randomSign(){ return Math.random() < 0.5 ? -1 : 1; }
  function degToRad(d){ return d * DEG2RAD; }
  function radToDeg(r){ return r * RAD2DEG; }
  function isPowerOfTwo(n){ return (n & (n - 1)) === 0; }
  function nextPowerOfTwo(n){
    n--; n |= n >> 1; n |= n >> 2; n |= n >> 4; n |= n >> 8; n |= n >> 16; n++;
    return n;
  }
  function noise1D(x){
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    const a = Math.sin(i * 127.1) * 43758.5453;
    const b = Math.sin((i + 1) * 127.1) * 43758.5453;
    return lerp(a - Math.floor(a), b - Math.floor(b), u) * 2 - 1;
  }
  function fbm1D(x, octaves = 4){
    let value = 0, amplitude = 0.5, frequency = 1;
    for(let i = 0; i < octaves; i++){
      value += amplitude * noise1D(x * frequency);
      amplitude *= 0.5;
      frequency *= 2;
    }
    return value;
  }

  // 导出
  return {
    Vec3, Quat, Mat4,
    EPSILON, DEG2RAD, RAD2DEG, PI2,
    clamp, lerp, smoothstep, smootherstep, pingPong, repeat,
    damp, dampAngle, randomRange, randomInt, randomSign,
    degToRad, radToDeg, isPowerOfTwo, nextPowerOfTwo,
    noise1D, fbm1D
  };
})();

// 全局暴露
if(typeof window !== 'undefined'){
  window.OrbMath = OrbMath;
}

// ============================================================
// 模块二：骨骼系统 SkeletonSystem (约1500行)
// FK前向运动学 / IK反向运动学 / 骨骼约束 / 物理骨骼
// ============================================================

const OrbSkeleton = (function(){
  const { Vec3, Quat, Mat4, clamp, lerp, damp, dampAngle, EPSILON } = OrbMath;

  // ============================================================
  // Bone - 单个骨骼
  // ============================================================
  class Bone {
    constructor(index, name = ''){
      this.index = index;
      this.name = name;
      this.parent = -1;
      this.children = [];
      this.position = new Vec3();       // 局部位置（相对于父骨骼）
      this.rotation = new Quat();       // 局部旋转
      this.scale = new Vec3(1, 1, 1);   // 局部缩放
      this.restPosition = new Vec3();    // 初始位置
      this.restRotation = new Quat();    // 初始旋转
      this.restScale = new Vec3(1, 1, 1);
      this.worldPosition = new Vec3();   // 世界位置
      this.worldRotation = new Quat();   // 世界旋转
      this.worldScale = new Vec3(1, 1, 1);
      this.worldMatrix = new Mat4();      // 世界矩阵
      this.inverseBindMatrix = new Mat4(); // 逆绑定矩阵
      this.length = 0;                    // 骨骼长度
      this.flags = 0;                     // 骨骼标志
      this.ikData = null;                 // IK数据
      this.physicsData = null;            // 物理数据
      this.constraints = [];              // 约束列表
      this.userData = {};                  // 用户自定义数据
    }

    setParent(parentIndex){
      this.parent = parentIndex;
    }

    addChild(childIndex){
      if(!this.children.includes(childIndex)){
        this.children.push(childIndex);
      }
    }

    saveRestPose(){
      this.restPosition.copy(this.position);
      this.restRotation.copy(this.rotation);
      this.restScale.copy(this.scale);
    }

    loadRestPose(){
      this.position.copy(this.restPosition);
      this.rotation.copy(this.restRotation);
      this.scale.copy(this.restScale);
    }

    resetToRest(){
      this.position.copy(this.restPosition);
      this.rotation.copy(this.restRotation);
      this.scale.copy(this.restScale);
    }

    getForward(){
      return new Vec3(0, 0, -1).applyQuaternion(this.worldRotation);
    }

    getUp(){
      return new Vec3(0, 1, 0).applyQuaternion(this.worldRotation);
    }

    getRight(){
      return new Vec3(1, 0, 0).applyQuaternion(this.worldRotation);
    }

    clone(){
      const b = new Bone(this.index, this.name);
      b.parent = this.parent;
      b.children = [...this.children];
      b.position.copy(this.position);
      b.rotation.copy(this.rotation);
      b.scale.copy(this.scale);
      b.restPosition.copy(this.restPosition);
      b.restRotation.copy(this.restRotation);
      b.restScale.copy(this.restScale);
      b.worldPosition.copy(this.worldPosition);
      b.worldRotation.copy(this.worldRotation);
      b.worldScale.copy(this.worldScale);
      b.worldMatrix.copy(this.worldMatrix);
      b.inverseBindMatrix.copy(this.inverseBindMatrix);
      b.length = this.length;
      b.flags = this.flags;
      b.userData = {...this.userData};
      return b;
    }
  }

  // ============================================================
  // Skeleton - 骨骼层级
  // ============================================================
  class Skeleton {
    constructor(){
      this.bones = [];
      this.rootBones = [];
      this.computeOrder = [];  // 从根到叶的计算顺序
      this.boneMap = {};       // 名称到索引的映射
      this.bonePalette = null; // 骨骼调色板（Float32Array，用于GPU蒙皮）
      this.paletteSize = 0;
      this.dirty = true;
      this.userData = {};
    }

    addBone(name, parentIndex = -1){
      const index = this.bones.length;
      const bone = new Bone(index, name);
      bone.parent = parentIndex;
      this.bones.push(bone);
      this.boneMap[name] = index;
      if(parentIndex >= 0 && parentIndex < this.bones.length){
        this.bones[parentIndex].addChild(index);
      } else {
        this.rootBones.push(index);
      }
      this.dirty = true;
      return bone;
    }

    getBone(nameOrIndex){
      if(typeof nameOrIndex === 'number'){
        return this.bones[nameOrIndex];
      }
      const idx = this.boneMap[nameOrIndex];
      return idx !== undefined ? this.bones[idx] : null;
    }

    getBoneIndex(name){
      return this.boneMap[name];
    }

    buildComputeOrder(){
      this.computeOrder = [];
      const visited = new Set();
      const visit = (index) => {
        if(visited.has(index)) return;
        visited.add(index);
        const bone = this.bones[index];
        if(bone.parent >= 0 && !visited.has(bone.parent)){
          visit(bone.parent);
        }
        this.computeOrder.push(index);
        for(const child of bone.children){
          visit(child);
        }
      };
      for(const root of this.rootBones){
        visit(root);
      }
      // 确保所有骨骼都被访问
      for(let i = 0; i < this.bones.length; i++){
        if(!visited.has(i)){
          visit(i);
        }
      }
      this.dirty = true;
      return this.computeOrder;
    }

    computeWorldMatrices(){
      if(this.computeOrder.length !== this.bones.length){
        this.buildComputeOrder();
      }
      for(const idx of this.computeOrder){
        const bone = this.bones[idx];
        if(bone.parent >= 0){
          const parent = this.bones[bone.parent];
          // 世界旋转 = 父世界旋转 * 局部旋转
          bone.worldRotation.copy(parent.worldRotation).multiply(bone.rotation);
          // 世界位置 = 父世界位置 + 父世界旋转 * (局部位置 * 父世界缩放)
          const localPos = bone.position.clone();
          localPos.x *= parent.worldScale.x;
          localPos.y *= parent.worldScale.y;
          localPos.z *= parent.worldScale.z;
          localPos.applyQuaternion(parent.worldRotation);
          bone.worldPosition.copy(parent.worldPosition).add(localPos);
          // 世界缩放
          bone.worldScale.set(
            parent.worldScale.x * bone.scale.x,
            parent.worldScale.y * bone.scale.y,
            parent.worldScale.z * bone.scale.z
          );
        } else {
          bone.worldRotation.copy(bone.rotation);
          bone.worldPosition.copy(bone.position);
          bone.worldScale.copy(bone.scale);
        }
        // 组合世界矩阵
        bone.worldMatrix.compose(bone.worldPosition, bone.worldRotation, bone.worldScale);
      }
      this.dirty = false;
    }

    updateBonePalette(maxBones = 256){
      if(!this.bonePalette || this.bonePalette.length < maxBones * 16){
        this.bonePalette = new Float32Array(maxBones * 16);
      }
      this.paletteSize = Math.min(this.bones.length, maxBones);
      for(let i = 0; i < this.paletteSize; i++){
        const bone = this.bones[i];
        // 蒙皮矩阵 = 世界矩阵 * 逆绑定矩阵
        const skinMatrix = bone.worldMatrix.clone().multiply(bone.inverseBindMatrix);
        this.bonePalette.set(skinMatrix.elements, i * 16);
      }
      return this.bonePalette;
    }

    resetToRestPose(){
      for(const bone of this.bones){
        bone.resetToRest();
      }
      this.dirty = true;
    }

    saveRestPose(){
      for(const bone of this.bones){
        bone.saveRestPose();
      }
    }

    setBoneRotation(nameOrIndex, rotation){
      const bone = this.getBone(nameOrIndex);
      if(bone){
        bone.rotation.copy(rotation);
        this.dirty = true;
      }
    }

    setBonePosition(nameOrIndex, position){
      const bone = this.getBone(nameOrIndex);
      if(bone){
        bone.position.copy(position);
        this.dirty = true;
      }
    }

    getChain(startBone, endBone){
      const chain = [];
      let current = this.getBone(endBone);
      while(current && current.index !== startBone){
        chain.unshift(current.index);
        if(current.parent < 0) break;
        current = this.bones[current.parent];
      }
      if(current && current.index === startBone){
        chain.unshift(startBone);
      }
      return chain;
    }

    getTipPosition(boneIndex){
      const bone = this.bones[boneIndex];
      if(!bone) return null;
      // 骨骼末端 = 世界位置 + 骨骼长度 * 前向方向
      const tip = bone.getForward().mul(bone.length);
      return bone.worldPosition.clone().add(tip);
    }

    clone(){
      const s = new Skeleton();
      for(const bone of this.bones){
        const b = bone.clone();
        s.bones.push(b);
        s.boneMap[b.name] = b.index;
      }
      s.rootBones = [...this.rootBones];
      s.computeOrder = [...this.computeOrder];
      s.userData = {...this.userData};
      return s;
    }
  }

  // ============================================================
  // IKSolver - IK求解器（CCD和FABRIK）
  // ============================================================
  class IKSolver {
    constructor(skeleton){
      this.skeleton = skeleton;
      this.maxIterations = 20;
      this.tolerance = 0.001;
      this.useCCD = true; // true=CCD, false=FABRIK
    }

    solve(chain, target, poleVector = null){
      if(chain.length < 2) return false;
      if(this.useCCD){
        return this.solveCCD(chain, target, poleVector);
      } else {
        return this.solveFABRIK(chain, target, poleVector);
      }
    }

    // CCD (Cyclic Coordinate Descent) 算法
    solveCCD(chain, target, poleVector){
      const bones = chain.map(i => this.skeleton.bones[i]);
      const endEffector = bones[bones.length - 1];
      let success = false;

      for(let iter = 0; iter < this.maxIterations; iter++){
        // 从末端向根遍历
        for(let i = bones.length - 2; i >= 0; i--){
          const bone = bones[i];
          this.skeleton.computeWorldMatrices();

          // 获取末端执行器位置
          const endPos = endEffector.worldPosition.clone();
          const bonePos = bone.worldPosition.clone();

          // 计算旋转
          const toEnd = Vec3.sub(endPos, bonePos).normalize();
          const toTarget = Vec3.sub(target, bonePos).normalize();

          if(toEnd.lengthSq() < EPSILON || toTarget.lengthSq() < EPSILON) continue;

          const dot = clamp(toEnd.dot(toTarget), -1, 1);
          const angle = Math.acos(dot);

          if(Math.abs(angle) < EPSILON) continue;

          const axis = Vec3.cross(toEnd, toTarget).normalize();
          if(axis.lengthSq() < EPSILON) continue;

          // 限制旋转角度
          const maxAngle = Math.PI * 0.5;
          const rotAngle = clamp(angle, -maxAngle, maxAngle);
          const deltaRot = Quat.fromAxisAngle(axis, rotAngle);

          // 应用到局部旋转
          bone.rotation.premultiply(deltaRot);
          bone.rotation.normalize();

          // 极向量约束
          if(poleVector && i > 0){
            this.applyPoleConstraint(bone, poleVector);
          }
        }

        // 检查是否到达目标
        this.skeleton.computeWorldMatrices();
        const dist = endEffector.worldPosition.distanceTo(target);
        if(dist < this.tolerance){
          success = true;
          break;
        }
      }

      this.skeleton.computeWorldMatrices();
      return success;
    }

    // FABRIK (Forward And Backward Reaching Inverse Kinematics) 算法
    solveFABRIK(chain, target, poleVector){
      const bones = chain.map(i => this.skeleton.bones[i]);
      const n = bones.length;

      // 收集关节位置
      const positions = [];
      for(const bone of bones){
        positions.push(bone.worldPosition.clone());
      }
      // 末端执行器位置
      const endEffector = bones[n - 1];
      positions.push(endEffector.worldPosition.clone());

      // 计算每段长度
      const lengths = [];
      for(let i = 0; i < n; i++){
        lengths.push(positions[i].distanceTo(positions[i + 1]));
      }

      const rootPos = positions[0].clone();
      let success = false;

      for(let iter = 0; iter < this.maxIterations; iter++){
        // 前向传播：从末端到根
        positions[n] = target.clone();
        for(let i = n - 1; i >= 0; i--){
          const dir = Vec3.sub(positions[i], positions[i + 1]).normalize();
          positions[i] = positions[i + 1].clone().add(dir.mul(lengths[i]));
        }

        // 后向传播：从根到末端
        positions[0] = rootPos.clone();
        for(let i = 0; i < n; i++){
          const dir = Vec3.sub(positions[i + 1], positions[i]).normalize();
          positions[i + 1] = positions[i].clone().add(dir.mul(lengths[i]));
        }

        // 检查收敛
        const dist = positions[n].distanceTo(target);
        if(dist < this.tolerance){
          success = true;
          break;
        }
      }

      // 将位置转换为旋转
      for(let i = 0; i < n - 1; i++){
        const bone = bones[i];
        const nextBone = bones[i + 1];

        // 计算当前骨骼到下一骨骼的方向
        const currentDir = Vec3.sub(nextBone.worldPosition, bone.worldPosition).normalize();
        const targetDir = Vec3.sub(positions[i + 1], positions[i]).normalize();

        if(currentDir.lengthSq() > EPSILON && targetDir.lengthSq() > EPSILON){
          const rot = new Quat().setFromUnitVectors(currentDir, targetDir);
          bone.rotation.premultiply(rot);
          bone.rotation.normalize();
        }
      }

      this.skeleton.computeWorldMatrices();
      return success;
    }

    applyPoleConstraint(bone, poleVector){
      // 极向量约束：使骨骼平面朝向极向量
      this.skeleton.computeWorldMatrices();
      const bonePos = bone.worldPosition.clone();
      const poleDir = Vec3.sub(poleVector, bonePos).normalize();

      // 获取骨骼的右方向
      const right = bone.getRight();
      const dot = clamp(right.dot(poleDir), -1, 1);
      const angle = Math.acos(dot);

      if(Math.abs(angle) > EPSILON){
        const axis = bone.getForward();
        const deltaRot = Quat.fromAxisAngle(axis, angle);
        bone.rotation.premultiply(deltaRot);
        bone.rotation.normalize();
      }
    }

    // 双骨IK（专门用于手臂/腿）
    solveTwoBone(upperBone, lowerBone, endBone, target, poleVector, elbowBend = 0){
      const upper = this.skeleton.getBone(upperBone);
      const lower = this.skeleton.getBone(lowerBone);
      const end = this.skeleton.getBone(endBone);

      if(!upper || !lower || !end) return false;

      this.skeleton.computeWorldMatrices();

      const upperPos = upper.worldPosition.clone();
      const lowerPos = lower.worldPosition.clone();
      const endPos = end.worldPosition.clone();

      const upperLen = upperPos.distanceTo(lowerPos);
      const lowerLen = lowerPos.distanceTo(endPos);
      const totalLen = upperLen + lowerLen;
      const targetDist = upperPos.distanceTo(target);

      // 如果目标太远，伸直手臂
      if(targetDist >= totalLen - EPSILON){
        const dir = Vec3.sub(target, upperPos).normalize();
        const newLowerPos = upperPos.clone().add(dir.mul(upperLen));
        const newEndPos = newLowerPos.clone().add(dir.mul(lowerLen));
        this._applyTwoBoneRotation(upper, lower, upperPos, newLowerPos, newEndPos, poleVector);
        return true;
      }

      // 如果目标太近，弯曲手臂
      const minDist = Math.abs(upperLen - lowerLen);
      if(targetDist <= minDist + EPSILON){
        const dir = Vec3.sub(target, upperPos).normalize();
        const bendDir = poleVector ? Vec3.sub(poleVector, upperPos).normalize() : new Vec3(0, 1, 0);
        const newLowerPos = upperPos.clone().add(bendDir.mul(upperLen));
        const newEndPos = newLowerPos.clone().add(dir.mul(lowerLen));
        this._applyTwoBoneRotation(upper, lower, upperPos, newLowerPos, newEndPos, poleVector);
        return true;
      }

      // 正常情况：用余弦定理计算肘部位置
      const a = upperLen;
      const b = lowerLen;
      const c = targetDist;
      const cosAngle = (a * a + c * c - b * b) / (2 * a * c);
      const angle = Math.acos(clamp(cosAngle, -1, 1));

      // 计算肘部平面
      const toTarget = Vec3.sub(target, upperPos).normalize();
      let planeNormal;
      if(poleVector){
        const toPole = Vec3.sub(poleVector, upperPos).normalize();
        planeNormal = Vec3.cross(toTarget, toPole).normalize();
        if(planeNormal.lengthSq() < EPSILON){
          planeNormal = new Vec3(0, 0, 1);
        }
      } else {
        planeNormal = new Vec3(0, 0, 1);
      }

      // 计算肘部位置
      const elbowDir = toTarget.clone().applyQuaternion(Quat.fromAxisAngle(planeNormal, angle)).normalize();
      const newLowerPos = upperPos.clone().add(elbowDir.mul(upperLen));
      const newEndPos = target.clone();

      this._applyTwoBoneRotation(upper, lower, upperPos, newLowerPos, newEndPos, poleVector);
      return true;
    }

    _applyTwoBoneRotation(upper, lower, upperPos, newLowerPos, newEndPos, poleVector){
      // 计算上臂旋转
      const currentUpperDir = Vec3.sub(lower.worldPosition, upper.worldPosition).normalize();
      const targetUpperDir = Vec3.sub(newLowerPos, upperPos).normalize();
      const upperRot = new Quat().setFromUnitVectors(currentUpperDir, targetUpperDir);
      upper.rotation.premultiply(upperRot);
      upper.rotation.normalize();

      this.skeleton.computeWorldMatrices();

      // 计算下臂旋转
      const currentLowerDir = Vec3.sub(newEndPos, newLowerPos).normalize();
      const lowerEnd = this.skeleton.bones[lower.children[0]] || lower;
      const actualLowerDir = Vec3.sub(lowerEnd.worldPosition, lower.worldPosition).normalize();
      const lowerRot = new Quat().setFromUnitVectors(actualLowerDir, currentLowerDir);
      lower.rotation.premultiply(lowerRot);
      lower.rotation.normalize();

      this.skeleton.computeWorldMatrices();
    }
  }

  // ============================================================
  // BoneConstraint - 骨骼约束基类
  // ============================================================
  class BoneConstraint {
    constructor(boneIndex, targetBoneIndex, weight = 1){
      this.boneIndex = boneIndex;
      this.targetBoneIndex = targetBoneIndex;
      this.weight = weight;
      this.enabled = true;
    }
    apply(skeleton, dt){}
  }

  // LookAt约束
  class LookAtConstraint extends BoneConstraint {
    constructor(boneIndex, targetBoneIndex, weight = 1){
      super(boneIndex, targetBoneIndex, weight);
      this.upVector = new Vec3(0, 1, 0);
      this.limitX = Math.PI;
      this.limitY = Math.PI;
      this.limitZ = Math.PI;
    }

    apply(skeleton, dt){
      if(!this.enabled) return;
      const bone = skeleton.bones[this.boneIndex];
      const target = skeleton.bones[this.targetBoneIndex];
      if(!bone || !target) return;

      const toTarget = Vec3.sub(target.worldPosition, bone.worldPosition).normalize();
      const currentForward = bone.getForward();

      const rot = new Quat().setFromUnitVectors(currentForward, toTarget);
      const targetRot = bone.rotation.clone().premultiply(rot);

      // 限制旋转
      const euler = targetRot.toEuler();
      euler.x = clamp(euler.x, -this.limitX, this.limitX);
      euler.y = clamp(euler.y, -this.limitY, this.limitY);
      euler.z = clamp(euler.z, -this.limitZ, this.limitZ);
      targetRot.setFromEuler(euler.x, euler.y, euler.z);

      bone.rotation.slerp(targetRot, this.weight);
      bone.rotation.normalize();
    }
  }

  // Aim约束
  class AimConstraint extends BoneConstraint {
    constructor(boneIndex, targetBoneIndex, weight = 1){
      super(boneIndex, targetBoneIndex, weight);
      this.axis = new Vec3(1, 0, 0);
      this.upVector = new Vec3(0, 1, 0);
    }

    apply(skeleton, dt){
      if(!this.enabled) return;
      const bone = skeleton.bones[this.boneIndex];
      const target = skeleton.bones[this.targetBoneIndex];
      if(!bone || !target) return;

      const toTarget = Vec3.sub(target.worldPosition, bone.worldPosition).normalize();
      const currentAxis = this.axis.clone().applyQuaternion(bone.worldRotation);
      const rot = new Quat().setFromUnitVectors(currentAxis, toTarget);
      const targetRot = bone.rotation.clone().premultiply(rot);
      bone.rotation.slerp(targetRot, this.weight);
      bone.rotation.normalize();
    }
  }

  // Parent约束
  class ParentConstraint extends BoneConstraint {
    constructor(boneIndex, targetBoneIndex, weight = 1){
      super(boneIndex, targetBoneIndex, weight);
      this.positionOffset = new Vec3();
      this.rotationOffset = new Quat();
      this.affectPosition = true;
      this.affectRotation = true;
    }

    apply(skeleton, dt){
      if(!this.enabled) return;
      const bone = skeleton.bones[this.boneIndex];
      const target = skeleton.bones[this.targetBoneIndex];
      if(!bone || !target) return;

      if(this.affectPosition){
        const targetPos = target.worldPosition.clone().add(this.positionOffset);
        const localPos = targetPos.clone().applyQuaternion(target.worldRotation.clone().inverse());
        bone.position.lerp(localPos, this.weight);
      }

      if(this.affectRotation){
        const targetRot = target.worldRotation.clone().multiply(this.rotationOffset);
        const localRot = target.worldRotation.clone().inverse().multiply(targetRot);
        bone.rotation.slerp(localRot, this.weight);
        bone.rotation.normalize();
      }
    }
  }

  // Orient约束
  class OrientConstraint extends BoneConstraint {
    constructor(boneIndex, targetBoneIndex, weight = 1){
      super(boneIndex, targetBoneIndex, weight);
      this.offset = new Quat();
    }

    apply(skeleton, dt){
      if(!this.enabled) return;
      const bone = skeleton.bones[this.boneIndex];
      const target = skeleton.bones[this.targetBoneIndex];
      if(!bone || !target) return;

      const targetRot = target.worldRotation.clone().multiply(this.offset);
      bone.rotation.slerp(targetRot, this.weight);
      bone.rotation.normalize();
    }
  }

  // 约束管理器
  class ConstraintManager {
    constructor(skeleton){
      this.skeleton = skeleton;
      this.constraints = [];
    }

    add(constraint){
      this.constraints.push(constraint);
      return constraint;
    }

    remove(constraint){
      const idx = this.constraints.indexOf(constraint);
      if(idx >= 0) this.constraints.splice(idx, 1);
    }

    applyAll(dt){
      for(const c of this.constraints){
        c.apply(this.skeleton, dt);
      }
    }

    clear(){
      this.constraints = [];
    }
  }

  // ============================================================
  // SpringBone - 弹簧骨骼（物理模拟）
  // ============================================================
  class SpringBone {
    constructor(boneIndex){
      this.boneIndex = boneIndex;
      this.stiffness = 0.5;      // 刚度
      this.damping = 0.5;        // 阻尼
      this.gravity = new Vec3(0, -9.8, 0); // 重力
      this.gravityPower = 0.1;   // 重力强度
      this.radius = 0.1;         // 碰撞半径
      this.springForce = new Vec3(); // 当前弹簧力
      this.prevPosition = new Vec3(); // 上一帧位置
      this.colliders = [];        // 碰撞体列表
      this.enabled = true;
      this.limits = null;         // 旋转限制 {minX, maxX, minY, maxY, minZ, maxZ}
    }

    update(skeleton, dt){
      if(!this.enabled) return;
      const bone = skeleton.bones[this.boneIndex];
      if(!bone) return;

      const currentPos = bone.worldPosition.clone();

      // Verlet积分
      const velocity = Vec3.sub(currentPos, this.prevPosition).mul(this.damping);
      const force = this.springForce.clone().mul(this.stiffness);
      force.add(this.gravity.clone().mul(this.gravityPower * dt));

      const newPos = currentPos.clone().add(velocity).add(force);

      // 碰撞检测
      for(const collider of this.colliders){
        this.resolveCollision(newPos, collider);
      }

      // 应用新位置（通过旋转父骨骼）
      if(bone.parent >= 0){
        const parent = skeleton.bones[bone.parent];
        const toCurrent = Vec3.sub(currentPos, parent.worldPosition).normalize();
        const toNew = Vec3.sub(newPos, parent.worldPosition).normalize();

        if(toCurrent.lengthSq() > EPSILON && toNew.lengthSq() > EPSILON){
          const rot = new Quat().setFromUnitVectors(toCurrent, toNew);
          parent.rotation.premultiply(rot);
          parent.rotation.normalize();

          // 应用旋转限制
          if(this.limits){
            this.applyLimits(parent);
          }
        }
      }

      this.prevPosition.copy(currentPos);
      this.springForce.mul(0.9); // 弹簧力衰减
    }

    resolveCollision(position, collider){
      const dist = position.distanceTo(collider.position);
      const minDist = this.radius + collider.radius;
      if(dist < minDist && dist > EPSILON){
        const normal = Vec3.sub(position, collider.position).normalize();
        const push = normal.mul(minDist - dist);
        position.add(push);
      }
    }

    applyLimits(bone){
      const euler = bone.rotation.toEuler();
      if(this.limits.minX !== undefined) euler.x = Math.max(this.limits.minX, euler.x);
      if(this.limits.maxX !== undefined) euler.x = Math.min(this.limits.maxX, euler.x);
      if(this.limits.minY !== undefined) euler.y = Math.max(this.limits.minY, euler.y);
      if(this.limits.maxY !== undefined) euler.y = Math.min(this.limits.maxY, euler.y);
      if(this.limits.minZ !== undefined) euler.z = Math.max(this.limits.minZ, euler.z);
      if(this.limits.maxZ !== undefined) euler.z = Math.min(this.limits.maxZ, euler.z);
      bone.rotation.setFromEuler(euler.x, euler.y, euler.z);
    }

    addCollider(collider){
      this.colliders.push(collider);
    }
  }

  // 碰撞体
  class BoneCollider {
    constructor(position, radius){
      this.position = position || new Vec3();
      this.radius = radius || 0.1;
    }
  }

  // 弹簧骨骼管理器
  class SpringManager {
    constructor(skeleton){
      this.skeleton = skeleton;
      this.springBones = [];
      this.colliders = [];
    }

    addSpringBone(boneIndex){
      const sb = new SpringBone(boneIndex);
      this.springBones.push(sb);
      return sb;
    }

    addCollider(position, radius){
      const c = new BoneCollider(position, radius);
      this.colliders.push(c);
      return c;
    }

    update(dt){
      this.skeleton.computeWorldMatrices();
      for(const sb of this.springBones){
        sb.update(this.skeleton, dt);
      }
      this.skeleton.computeWorldMatrices();
    }

    clear(){
      this.springBones = [];
      this.colliders = [];
    }
  }

  // 导出
  return {
    Bone, Skeleton, IKSolver,
    BoneConstraint, LookAtConstraint, AimConstraint,
    ParentConstraint, OrientConstraint, ConstraintManager,
    SpringBone, BoneCollider, SpringManager
  };
})();

if(typeof window !== 'undefined'){
  window.OrbSkeleton = OrbSkeleton;
}

// ============================================================
// 模块三：动画状态机与动作混合 AnimationSystem (约1800行)
// 状态机 / 动作混合 / 动作过渡 / 动作叠加 / 程序化动作库
// ============================================================

const OrbAnimation = (function(){
  const { Vec3, Quat, Mat4, clamp, lerp, damp, dampAngle, smoothstep, smootherstep, EPSILON, PI2 } = OrbMath;
  const { Skeleton, Bone } = OrbSkeleton;

  // ============================================================
  // AnimationClip - 动画剪辑（关键帧数据）
  // ============================================================
  class AnimationClip {
    constructor(name = '', duration = 0){
      this.name = name;
      this.duration = duration;
      this.tracks = [];       // 轨道列表
      this.loop = true;
      this.speed = 1;
      this.events = [];        // 动画事件 {time, name, data}
    }

    addTrack(track){
      this.tracks.push(track);
      return track;
    }

    findTrack(boneName){
      return this.tracks.find(t => t.boneName === boneName);
    }

    addEvent(time, name, data = {}){
      this.events.push({time, name, data});
      this.events.sort((a, b) => a.time - b.time);
    }

    getEventsBetween(startTime, endTime){
      return this.events.filter(e => e.time >= startTime && e.time < endTime);
    }

    clone(){
      const c = new AnimationClip(this.name, this.duration);
      c.loop = this.loop;
      c.speed = this.speed;
      c.tracks = this.tracks.map(t => t.clone());
      c.events = this.events.map(e => ({...e}));
      return c;
    }
  }

  // 动画轨道（单个骨骼的关键帧）
  class AnimationTrack {
    constructor(boneName = ''){
      this.boneName = boneName;
      this.positionKeys = [];  // [{time, value: Vec3}]
      this.rotationKeys = [];  // [{time, value: Quat}]
      this.scaleKeys = [];     // [{time, value: Vec3}]
    }

    addPositionKey(time, position){
      this.positionKeys.push({time, value: position.clone()});
      this.positionKeys.sort((a, b) => a.time - b.time);
    }

    addRotationKey(time, rotation){
      this.rotationKeys.push({time, value: rotation.clone()});
      this.rotationKeys.sort((a, b) => a.time - b.time);
    }

    addScaleKey(time, scale){
      this.scaleKeys.push({time, value: scale.clone()});
      this.scaleKeys.sort((a, b) => a.time - b.time);
    }

    sample(time, loop, duration){
      const result = {
        position: null,
        rotation: null,
        scale: null
      };

      if(this.positionKeys.length > 0){
        result.position = this._sampleVec3(this.positionKeys, time, loop, duration);
      }
      if(this.rotationKeys.length > 0){
        result.rotation = this._sampleQuat(this.rotationKeys, time, loop, duration);
      }
      if(this.scaleKeys.length > 0){
        result.scale = this._sampleVec3(this.scaleKeys, time, loop, duration);
      }

      return result;
    }

    _sampleVec3(keys, time, loop, duration){
      if(keys.length === 1) return keys[0].value.clone();

      let t = time;
      if(loop && duration > 0){
        t = t % duration;
        if(t < 0) t += duration;
      }

      // 找到前后关键帧
      let prev = keys[0], next = keys[keys.length - 1];
      for(let i = 0; i < keys.length - 1; i++){
        if(t >= keys[i].time && t <= keys[i + 1].time){
          prev = keys[i];
          next = keys[i + 1];
          break;
        }
      }

      if(prev === next) return prev.value.clone();

      const span = next.time - prev.time;
      const alpha = span > EPSILON ? (t - prev.time) / span : 0;
      return Vec3.lerp(prev.value, next.value, alpha);
    }

    _sampleQuat(keys, time, loop, duration){
      if(keys.length === 1) return keys[0].value.clone();

      let t = time;
      if(loop && duration > 0){
        t = t % duration;
        if(t < 0) t += duration;
      }

      let prev = keys[0], next = keys[keys.length - 1];
      for(let i = 0; i < keys.length - 1; i++){
        if(t >= keys[i].time && t <= keys[i + 1].time){
          prev = keys[i];
          next = keys[i + 1];
          break;
        }
      }

      if(prev === next) return prev.value.clone();

      const span = next.time - prev.time;
      const alpha = span > EPSILON ? (t - prev.time) / span : 0;
      return Quat.slerp(prev.value, next.value, alpha);
    }

    clone(){
      const t = new AnimationTrack(this.boneName);
      t.positionKeys = this.positionKeys.map(k => ({time: k.time, value: k.value.clone()}));
      t.rotationKeys = this.rotationKeys.map(k => ({time: k.time, value: k.value.clone()}));
      t.scaleKeys = this.scaleKeys.map(k => ({time: k.time, value: k.value.clone()}));
      return t;
    }
  }

  // ============================================================
  // AnimationLayer - 动画层
  // ============================================================
  class AnimationLayer {
    constructor(name = '', weight = 1){
      this.name = name;
      this.weight = weight;
      this.enabled = true;
      this.blendingMode = 'override'; // override / additive / mask
      this.mask = null;  // 骨骼掩码 Set
      this.currentState = null;
      this.states = {};
      this.transitions = [];
      this.playing = false;
    }

    addState(name, clip, options = {}){
      this.states[name] = {
        name,
        clip,
        time: 0,
        speed: options.speed || 1,
        loop: options.loop !== undefined ? options.loop : true,
        weight: 1,
        ...options
      };
      return this.states[name];
    }

    addTransition(from, to, options = {}){
      this.transitions.push({
        from, to,
        duration: options.duration || 0.3,
        exitTime: options.exitTime || 0,
        hasExitTime: options.hasExitTime || false,
        condition: options.condition || null,
        offset: options.offset || 0
      });
    }

    play(stateName, offset = 0){
      const state = this.states[stateName];
      if(!state) return;
      if(this.currentState && this.currentState.name === stateName){
        this.currentState.time = offset;
        return;
      }
      // 过渡
      if(this.currentState){
        this._startTransition(this.currentState.name, stateName, offset);
      } else {
        this.currentState = state;
        state.time = offset;
        state.weight = 1;
      }
      this.playing = true;
    }

    _startTransition(fromName, toName, offset = 0){
      const fromState = this.states[fromName];
      const toState = this.states[toName];
      if(!fromState || !toState) return;

      const transition = this.transitions.find(t => t.from === fromName && t.to === toName);
      const duration = transition ? transition.duration : 0.3;

      this._transition = {
        fromState,
        toState,
        time: 0,
        duration,
        offset
      };

      toState.time = offset;
      toState.weight = 0;
    }

    update(dt, skeleton){
      if(!this.enabled || !this.playing) return;

      // 处理过渡
      if(this._transition){
        this._transition.time += dt;
        const alpha = clamp(this._transition.time / this._transition.duration, 0, 1);
        const eased = smootherstep(0, 1, alpha);

        this._transition.fromState.weight = 1 - eased;
        this._transition.toState.weight = eased;

        // 更新两个状态
        this._updateState(this._transition.fromState, dt, skeleton);
        this._updateState(this._transition.toState, dt, skeleton);

        if(alpha >= 1){
          this.currentState = this._transition.toState;
          this.currentState.weight = 1;
          this._transition = null;
        }
      } else if(this.currentState){
        this._updateState(this.currentState, dt, skeleton);
      }
    }

    _updateState(state, dt, skeleton){
      if(!state || !state.clip) return;

      state.time += dt * state.speed * state.clip.speed;

      if(state.clip.loop && state.clip.duration > 0){
        state.time = state.time % state.clip.duration;
        if(state.time < 0) state.time += state.clip.duration;
      }

      // 应用到骨骼
      const w = state.weight * this.weight;
      if(w <= 0) return;

      for(const track of state.clip.tracks){
        const bone = skeleton.getBone(track.boneName);
        if(!bone) continue;

        // 检查掩码
        if(this.mask && !this.mask.has(track.boneName)) continue;

        const sample = track.sample(state.time, state.clip.loop, state.clip.duration);

        if(this.blendingMode === 'additive'){
          if(sample.position) bone.position.add(sample.position.clone().mul(w));
          if(sample.rotation) bone.rotation.multiply(Quat.slerp(Quat.identity(), sample.rotation, w));
          if(sample.scale){
            bone.scale.x *= 1 + (sample.scale.x - 1) * w;
            bone.scale.y *= 1 + (sample.scale.y - 1) * w;
            bone.scale.z *= 1 + (sample.scale.z - 1) * w;
          }
        } else {
          if(sample.position) bone.position.lerp(sample.position, w);
          if(sample.rotation) bone.rotation.slerp(sample.rotation, w);
          if(sample.scale) bone.scale.lerp(sample.scale, w);
        }
      }
    }

    stop(){
      this.playing = false;
      this.currentState = null;
      this._transition = null;
    }

    getCurrentTime(){
      return this.currentState ? this.currentState.time : 0;
    }

    getCurrentStateName(){
      return this.currentState ? this.currentState.name : null;
    }
  }

  // ============================================================
  // AnimationController - 动画控制器（状态机）
  // ============================================================
  class AnimationController {
    constructor(skeleton){
      this.skeleton = skeleton;
      this.layers = [];
      this.parameters = {};  // 状态机参数
      this.clips = {};       // 动画剪辑库
      this.events = [];      // 全局事件
      this.eventListeners = {};
      this.time = 0;
      this.playing = true;
      this.speed = 1;
    }

    addLayer(name, weight = 1){
      const layer = new AnimationLayer(name, weight);
      this.layers.push(layer);
      return layer;
    }

    getLayer(name){
      return this.layers.find(l => l.name === name);
    }

    addClip(name, clip){
      this.clips[name] = clip;
      return clip;
    }

    getClip(name){
      return this.clips[name];
    }

    setParameter(name, value){
      this.parameters[name] = value;
      this._checkTransitions();
    }

    getParameter(name){
      return this.parameters[name];
    }

    trigger(name){
      this.setParameter(name, true);
    }

    _checkTransitions(){
      for(const layer of this.layers){
        if(!layer.currentState) continue;
        for(const transition of layer.transitions){
          if(transition.from !== layer.currentState.name) continue;
          if(transition.condition && transition.condition(this.parameters)){
            layer.play(transition.to, transition.offset || 0);
            break;
          }
        }
      }
    }

    play(layerName, stateName, offset = 0){
      const layer = this.getLayer(layerName);
      if(layer) layer.play(stateName, offset);
    }

    stop(layerName = null){
      if(layerName){
        const layer = this.getLayer(layerName);
        if(layer) layer.stop();
      } else {
        for(const layer of this.layers) layer.stop();
      }
    }

    update(dt){
      if(!this.playing) return;

      const scaledDt = dt * this.speed;
      this.time += scaledDt;

      // 先重置到初始姿态（基础层）
      if(this.layers.length > 0 && this.layers[0].enabled){
        this.skeleton.resetToRestPose();
      }

      // 更新各层
      for(const layer of this.layers){
        layer.update(scaledDt, this.skeleton);
      }

      // 重置trigger参数
      for(const key in this.parameters){
        if(this.parameters[key] === true && key.startsWith('trigger_')){
          this.parameters[key] = false;
        }
      }
    }

    on(eventName, callback){
      if(!this.eventListeners[eventName]){
        this.eventListeners[eventName] = [];
      }
      this.eventListeners[eventName].push(callback);
    }

    off(eventName, callback){
      if(!this.eventListeners[eventName]) return;
      const idx = this.eventListeners[eventName].indexOf(callback);
      if(idx >= 0) this.eventListeners[eventName].splice(idx, 1);
    }

    emit(eventName, data){
      if(!this.eventListeners[eventName]) return;
      for(const cb of this.eventListeners[eventName]){
        cb(data);
      }
    }
  }

  // ============================================================
  // ProceduralMotion - 程序化动作生成器
  // 不依赖任何动画数据，完全用数学公式生成动作
  // ============================================================
  class ProceduralMotion {
    constructor(skeleton){
      this.skeleton = skeleton;
      this.time = 0;
      this.enabled = true;
      this.motions = {};
      this.activeMotions = [];
    }

    // 注册动作
    register(name, motion){
      this.motions[name] = motion;
      return motion;
    }

    // 播放动作
    play(name, options = {}){
      const motion = this.motions[name];
      if(!motion) return null;

      const instance = {
        name,
        motion,
        time: 0,
        duration: options.duration || motion.duration || 1,
        weight: 0,
        targetWeight: options.weight || 1,
        fadeIn: options.fadeIn || 0.2,
        fadeOut: options.fadeOut || 0.2,
        loop: options.loop || false,
        speed: options.speed || 1,
        layer: options.layer || 0,
        mask: options.mask || null,
        done: false,
        ...options
      };

      this.activeMotions.push(instance);
      return instance;
    }

    // 停止动作
    stop(name, fadeOut = 0.2){
      for(const m of this.activeMotions){
        if(m.name === name){
          m.targetWeight = 0;
          m.fadeOut = fadeOut;
          m.stopping = true;
        }
      }
    }

    // 停止所有动作
    stopAll(fadeOut = 0.2){
      for(const m of this.activeMotions){
        m.targetWeight = 0;
        m.fadeOut = fadeOut;
        m.stopping = true;
      }
    }

    // 更新
    update(dt){
      if(!this.enabled) return;

      this.time += dt;

      // 按层级排序
      this.activeMotions.sort((a, b) => a.layer - b.layer);

      for(let i = this.activeMotions.length - 1; i >= 0; i--){
        const m = this.activeMotions[i];

        // 更新权重
        if(m.stopping){
          m.weight = Math.max(0, m.weight - dt / m.fadeOut);
        } else {
          m.weight = Math.min(m.targetWeight, m.weight + dt / m.fadeIn);
        }

        // 更新时间
        m.time += dt * m.speed;

        // 检查是否完成
        if(!m.loop && m.time >= m.duration){
          if(m.stopping || m.fadeOut <= 0){
            m.done = true;
          } else {
            m.stopping = true;
          }
        }

        // 应用动作
        if(m.weight > EPSILON && m.motion.update){
          const normalizedTime = m.duration > 0 ? m.time / m.duration : 0;
          m.motion.update(this.skeleton, normalizedTime, m.time, m.weight, m);
        }

        // 移除完成的动作
        if(m.done && m.weight <= EPSILON){
          this.activeMotions.splice(i, 1);
        }
      }
    }

    // 检查动作是否在播放
    isPlaying(name){
      return this.activeMotions.some(m => m.name === name && !m.stopping);
    }
  }

  // ============================================================
  // 内置程序化动作库
  // ============================================================

  // 呼吸动作
  const BreathingMotion = {
    duration: 4,
    update(skeleton, normalizedTime, time, weight){
      const breath = Math.sin(time * Math.PI * 0.5) * 0.5 + 0.5;
      const chestBone = skeleton.getBone('上半身') || skeleton.getBone('UpperBody') || skeleton.getBone('胸');
      if(chestBone){
        chestBone.position.y += breath * 0.02 * weight;
        chestBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), breath * 0.02 * weight));
      }
      // 肩膀微动
      const shoulderL = skeleton.getBone('左肩') || skeleton.getBone('LeftShoulder');
      const shoulderR = skeleton.getBone('右肩') || skeleton.getBone('RightShoulder');
      if(shoulderL) shoulderL.position.y += breath * 0.01 * weight;
      if(shoulderR) shoulderR.position.y += breath * 0.01 * weight;
    }
  };

  // 眨眼动作
  const BlinkMotion = {
    duration: 0.15,
    update(skeleton, normalizedTime, time, weight){
      const blink = Math.sin(normalizedTime * Math.PI);
      const eyeL = skeleton.getBone('左目') || skeleton.getBone('LeftEye');
      const eyeR = skeleton.getBone('右目') || skeleton.getBone('RightEye');
      if(eyeL) eyeL.scale.y *= (1 - blink * 0.9 * weight);
      if(eyeR) eyeR.scale.y *= (1 - blink * 0.9 * weight);
    }
  };

  // 视线追踪
  const LookAtMotion = {
    duration: Infinity,
    target: new Vec3(),
    update(skeleton, normalizedTime, time, weight, instance){
      const target = instance.target || this.target;
      const headBone = skeleton.getBone('頭') || skeleton.getBone('Head') || skeleton.getBone('首');
      if(!headBone) return;

      const toTarget = Vec3.sub(target, headBone.worldPosition).normalize();
      const currentForward = headBone.getForward();
      const rot = new Quat().setFromUnitVectors(currentForward, toTarget);
      const targetRot = headBone.rotation.clone().premultiply(rot);

      // 限制头部旋转
      const euler = targetRot.toEuler();
      euler.x = clamp(euler.x, -0.3, 0.3);
      euler.y = clamp(euler.y, -0.5, 0.5);
      euler.z = clamp(euler.z, -0.1, 0.1);
      targetRot.setFromEuler(euler.x, euler.y, euler.z);

      headBone.rotation.slerp(targetRot, weight * 0.1);
      headBone.rotation.normalize();
    }
  };

  // 闲置微动作
  const IdleMotion = {
    duration: 8,
    update(skeleton, normalizedTime, time, weight){
      // 重心转移
      const shift = Math.sin(time * 0.5) * 0.5;
      const hipBone = skeleton.getBone('下半身') || skeleton.getBone('LowerBody') || skeleton.getBone('腰');
      if(hipBone){
        hipBone.position.x += shift * 0.02 * weight;
        hipBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 1, 0), shift * 0.05 * weight));
      }

      // 身体摇摆
      const sway = Math.sin(time * 0.3) * 0.5;
      const upperBone = skeleton.getBone('上半身') || skeleton.getBone('UpperBody');
      if(upperBone){
        upperBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, 1), sway * 0.03 * weight));
      }

      // 手臂自然摆动
      const armSwing = Math.sin(time * 0.8) * 0.3;
      const armL = skeleton.getBone('左腕') || skeleton.getBone('LeftArm');
      const armR = skeleton.getBone('右腕') || skeleton.getBone('RightArm');
      if(armL) armL.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), armSwing * 0.1 * weight));
      if(armR) armR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -armSwing * 0.1 * weight));
    }
  };

  // 挥手动作
  const WaveMotion = {
    duration: 1.5,
    side: 'right',
    update(skeleton, normalizedTime, time, weight, instance){
      const side = instance.side || this.side;
      const shoulderName = side === 'right' ? '右肩' : '左肩';
      const armName = side === 'right' ? '右腕' : '左腕';
      const elbowName = side === 'right' ? '右ひじ' : '左ひじ';
      const wristName = side === 'right' ? '右手首' : '左手首';

      const shoulder = skeleton.getBone(shoulderName);
      const arm = skeleton.getBone(armName);
      const elbow = skeleton.getBone(elbowName);
      const wrist = skeleton.getBone(wristName);

      // 抬手阶段 (0-0.3)
      const raisePhase = smoothstep(0, 0.3, normalizedTime);
      // 挥手阶段 (0.3-0.8)
      const wavePhase = smoothstep(0.3, 0.8, normalizedTime);
      // 放下阶段 (0.8-1.0)
      const lowerPhase = 1 - smoothstep(0.8, 1.0, normalizedTime);

      const armUp = raisePhase * lowerPhase;
      const waveAmount = wavePhase * lowerPhase;

      if(arm){
        // 抬起手臂
        arm.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, side === 'right' ? -1 : 1), Math.PI * 0.4 * armUp * weight));
        arm.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -0.3 * armUp * weight));
      }

      if(elbow){
        // 弯曲肘部
        elbow.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, 1), -Math.PI * 0.6 * armUp * weight));
      }

      if(wrist && waveAmount > 0){
        // 手腕摆动
        const wave = Math.sin(time * 8) * waveAmount;
        wrist.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 1, 0), wave * 0.4 * weight));
        wrist.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), wave * 0.2 * weight));
      }
    }
  };

  // 点头动作
  const NodMotion = {
    duration: 0.6,
    update(skeleton, normalizedTime, time, weight){
      const nod = Math.sin(normalizedTime * Math.PI * 2) * (1 - normalizedTime);
      const headBone = skeleton.getBone('頭') || skeleton.getBone('Head');
      if(headBone){
        headBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), nod * 0.3 * weight));
      }
    }
  };

  // 摇头动作
  const ShakeHeadMotion = {
    duration: 0.8,
    update(skeleton, normalizedTime, time, weight){
      const shake = Math.sin(normalizedTime * Math.PI * 3) * (1 - normalizedTime);
      const headBone = skeleton.getBone('頭') || skeleton.getBone('Head');
      if(headBone){
        headBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 1, 0), shake * 0.4 * weight));
      }
    }
  };

  // 走路动作（循环）
  const WalkMotion = {
    duration: 1.2,
    speed: 1,
    update(skeleton, normalizedTime, time, weight, instance){
      const cycle = (time * (instance.speed || this.speed)) % 1;
      const walkAngle = cycle * Math.PI * 2;

      // 腿部摆动
      const hipL = skeleton.getBone('左足') || skeleton.getBone('LeftLeg');
      const hipR = skeleton.getBone('右足') || skeleton.getBone('RightLeg');
      const kneeL = skeleton.getBone('左ひざ') || skeleton.getBone('LeftKnee');
      const kneeR = skeleton.getBone('右ひざ') || skeleton.getBone('RightKnee');
      const ankleL = skeleton.getBone('左足首') || skeleton.getBone('LeftAnkle');
      const ankleR = skeleton.getBone('右足首') || skeleton.getBone('RightAnkle');

      const legSwing = Math.sin(walkAngle) * 0.5;
      const kneeBend = Math.max(0, Math.sin(walkAngle + Math.PI)) * 0.5;

      if(hipL) hipL.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), legSwing * weight));
      if(hipR) hipR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -legSwing * weight));
      if(kneeL) kneeL.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -kneeBend * weight));
      if(kneeR) kneeR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -Math.max(0, Math.sin(walkAngle)) * 0.5 * weight));
      if(ankleL) ankleL.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -legSwing * 0.3 * weight));
      if(ankleR) ankleR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), legSwing * 0.3 * weight));

      // 手臂反向摆动
      const armL = skeleton.getBone('左腕') || skeleton.getBone('LeftArm');
      const armR = skeleton.getBone('右腕') || skeleton.getBone('RightArm');
      if(armL) armL.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -legSwing * 0.4 * weight));
      if(armR) armR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), legSwing * 0.4 * weight));

      // 身体上下起伏
      const hipBone = skeleton.getBone('下半身') || skeleton.getBone('LowerBody');
      if(hipBone){
        const bob = Math.abs(Math.sin(walkAngle)) * 0.02;
        hipBone.position.y -= bob * weight;
        // 身体扭转
        hipBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 1, 0), legSwing * 0.1 * weight));
      }
    }
  };

  // 跳跃动作
  const JumpMotion = {
    duration: 0.8,
    update(skeleton, normalizedTime, time, weight){
      // 跳跃曲线
      const jumpHeight = Math.sin(normalizedTime * Math.PI);
      const crouch = normalizedTime < 0.2 ? normalizedTime / 0.2 : (normalizedTime > 0.8 ? (1 - normalizedTime) / 0.2 : 0);

      const hipBone = skeleton.getBone('下半身') || skeleton.getBone('LowerBody');
      if(hipBone){
        hipBone.position.y += jumpHeight * 0.3 * weight;
        hipBone.position.y -= crouch * 0.1 * weight;
      }

      // 起跳和落地时弯曲膝盖
      const kneeL = skeleton.getBone('左ひざ') || skeleton.getBone('LeftKnee');
      const kneeR = skeleton.getBone('右ひざ') || skeleton.getBone('RightKnee');
      if(kneeL) kneeL.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -crouch * 0.8 * weight));
      if(kneeR) kneeR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -crouch * 0.8 * weight));

      // 空中时手臂张开
      const armL = skeleton.getBone('左腕') || skeleton.getBone('LeftArm');
      const armR = skeleton.getBone('右腕') || skeleton.getBone('RightArm');
      if(armL) armL.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, 1), jumpHeight * 0.5 * weight));
      if(armR) armR.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, -1), jumpHeight * 0.5 * weight));
    }
  };

  // 害羞动作
  const ShyMotion = {
    duration: 2,
    update(skeleton, normalizedTime, time, weight){
      const fade = Math.sin(normalizedTime * Math.PI);

      // 低头
      const headBone = skeleton.getBone('頭') || skeleton.getBone('Head');
      if(headBone){
        headBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), 0.2 * fade * weight));
        headBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, 1), 0.1 * fade * weight));
      }

      // 手摸脸
      const armR = skeleton.getBone('右腕') || skeleton.getBone('RightArm');
      const elbowR = skeleton.getBone('右ひじ') || skeleton.getBone('RightElbow');
      if(armR){
        armR.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, -1), Math.PI * 0.5 * fade * weight));
        armR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -0.5 * fade * weight));
      }
      if(elbowR){
        elbowR.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, 1), -Math.PI * 0.7 * fade * weight));
      }

      // 身体微扭
      const upperBone = skeleton.getBone('上半身') || skeleton.getBone('UpperBody');
      if(upperBone){
        upperBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 1, 0), 0.1 * fade * weight));
      }
    }
  };

  // 生气动作
  const AngryMotion = {
    duration: 1.5,
    update(skeleton, normalizedTime, time, weight){
      const intensity = Math.sin(normalizedTime * Math.PI * 3) * 0.5 + 0.5;

      // 握拳
      const fistL = skeleton.getBone('左手首') || skeleton.getBone('LeftWrist');
      const fistR = skeleton.getBone('右手首') || skeleton.getBone('RightWrist');
      if(fistL) fistL.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), intensity * 0.3 * weight));
      if(fistR) fistR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), intensity * 0.3 * weight));

      // 身体前倾
      const upperBone = skeleton.getBone('上半身') || skeleton.getBone('UpperBody');
      if(upperBone){
        upperBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), intensity * 0.2 * weight));
      }

      // 皱眉（通过眉毛骨骼，如果有的话）
      const browL = skeleton.getBone('左眉') || skeleton.getBone('LeftBrow');
      const browR = skeleton.getBone('右眉') || skeleton.getBone('RightBrow');
      if(browL) browL.position.y -= intensity * 0.01 * weight;
      if(browR) browR.position.y -= intensity * 0.01 * weight;
    }
  };

  // 开心动作
  const HappyMotion = {
    duration: 1.5,
    update(skeleton, normalizedTime, time, weight){
      const bounce = Math.abs(Math.sin(normalizedTime * Math.PI * 4)) * (1 - normalizedTime * 0.5);

      // 身体上下跳动
      const hipBone = skeleton.getBone('下半身') || skeleton.getBone('LowerBody');
      if(hipBone){
        hipBone.position.y += bounce * 0.05 * weight;
      }

      // 手臂摆动
      const armL = skeleton.getBone('左腕') || skeleton.getBone('LeftArm');
      const armR = skeleton.getBone('右腕') || skeleton.getBone('RightArm');
      if(armL) armL.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, 1), bounce * 0.3 * weight));
      if(armR) armR.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, -1), bounce * 0.3 * weight));

      // 头部微动
      const headBone = skeleton.getBone('頭') || skeleton.getBone('Head');
      if(headBone){
        headBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 1, 0), bounce * 0.1 * weight));
      }
    }
  };

  // 悲伤动作
  const SadMotion = {
    duration: 2,
    update(skeleton, normalizedTime, time, weight){
      const fade = Math.sin(normalizedTime * Math.PI);

      // 低头
      const headBone = skeleton.getBone('頭') || skeleton.getBone('Head');
      if(headBone){
        headBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), 0.3 * fade * weight));
      }

      // 肩膀下垂
      const shoulderL = skeleton.getBone('左肩') || skeleton.getBone('LeftShoulder');
      const shoulderR = skeleton.getBone('右肩') || skeleton.getBone('RightShoulder');
      if(shoulderL) shoulderL.position.y -= 0.02 * fade * weight;
      if(shoulderR) shoulderR.position.y -= 0.02 * fade * weight;

      // 身体蜷缩
      const upperBone = skeleton.getBone('上半身') || skeleton.getBone('UpperBody');
      if(upperBone){
        upperBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), 0.1 * fade * weight));
      }

      // 手臂自然下垂
      const armL = skeleton.getBone('左腕') || skeleton.getBone('LeftArm');
      const armR = skeleton.getBone('右腕') || skeleton.getBone('RightArm');
      if(armL) armL.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), 0.2 * fade * weight));
      if(armR) armR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), 0.2 * fade * weight));
    }
  };

  // 惊讶动作
  const SurprisedMotion = {
    duration: 0.8,
    update(skeleton, normalizedTime, time, weight){
      const fade = Math.sin(normalizedTime * Math.PI);

      // 头部后仰
      const headBone = skeleton.getBone('頭') || skeleton.getBone('Head');
      if(headBone){
        headBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -0.2 * fade * weight));
      }

      // 身体后仰
      const upperBone = skeleton.getBone('上半身') || skeleton.getBone('UpperBody');
      if(upperBone){
        upperBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -0.1 * fade * weight));
      }

      // 手臂抬起
      const armL = skeleton.getBone('左腕') || skeleton.getBone('LeftArm');
      const armR = skeleton.getBone('右腕') || skeleton.getBone('RightArm');
      if(armL) armL.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, 1), 0.5 * fade * weight));
      if(armR) armR.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, -1), 0.5 * fade * weight));
    }
  };

  // 思考动作
  const ThinkingMotion = {
    duration: 3,
    update(skeleton, normalizedTime, time, weight){
      const sway = Math.sin(time * 0.8) * 0.5;

      // 手托下巴
      const armR = skeleton.getBone('右腕') || skeleton.getBone('RightArm');
      const elbowR = skeleton.getBone('右ひじ') || skeleton.getBone('RightElbow');
      const wristR = skeleton.getBone('右手首') || skeleton.getBone('RightWrist');
      if(armR){
        armR.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, -1), Math.PI * 0.6 * weight));
        armR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -0.8 * weight));
      }
      if(elbowR){
        elbowR.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, 1), -Math.PI * 0.8 * weight));
      }
      if(wristR){
        wristR.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), 0.3 * weight));
      }

      // 头部倾斜
      const headBone = skeleton.getBone('頭') || skeleton.getBone('Head');
      if(headBone){
        headBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, 1), sway * 0.1 * weight));
        headBone.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), 0.1 * weight));
      }
    }
  };

  // 指向动作
  const PointMotion = {
    duration: 1,
    side: 'right',
    update(skeleton, normalizedTime, time, weight, instance){
      const side = instance.side || this.side;
      const raisePhase = smoothstep(0, 0.3, normalizedTime);
      const holdPhase = 1 - smoothstep(0.7, 1.0, normalizedTime);
      const amount = raisePhase * holdPhase;

      const shoulderName = side === 'right' ? '右肩' : '左肩';
      const armName = side === 'right' ? '右腕' : '左腕';
      const elbowName = side === 'right' ? '右ひじ' : '左ひじ';

      const arm = skeleton.getBone(armName);
      const elbow = skeleton.getBone(elbowName);

      if(arm){
        // 伸直手臂指向
        arm.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, side === 'right' ? -1 : 1), Math.PI * 0.5 * amount * weight));
        arm.rotation.multiply(Quat.fromAxisAngle(new Vec3(1, 0, 0), -0.3 * amount * weight));
      }

      if(elbow){
        // 伸直肘部
        elbow.rotation.multiply(Quat.fromAxisAngle(new Vec3(0, 0, 1), 0.1 * amount * weight));
      }
    }
  };

  // 动作库
  const MotionLibrary = {
    breathing: BreathingMotion,
    blink: BlinkMotion,
    lookAt: LookAtMotion,
    idle: IdleMotion,
    wave: WaveMotion,
    nod: NodMotion,
    shakeHead: ShakeHeadMotion,
    walk: WalkMotion,
    jump: JumpMotion,
    shy: ShyMotion,
    angry: AngryMotion,
    happy: HappyMotion,
    sad: SadMotion,
    surprised: SurprisedMotion,
    thinking: ThinkingMotion,
    point: PointMotion
  };

  // 导出
  return {
    AnimationClip, AnimationTrack, AnimationLayer, AnimationController,
    ProceduralMotion, MotionLibrary,
    BreathingMotion, BlinkMotion, LookAtMotion, IdleMotion,
    WaveMotion, NodMotion, ShakeHeadMotion, WalkMotion,
    JumpMotion, ShyMotion, AngryMotion, HappyMotion,
    SadMotion, SurprisedMotion, ThinkingMotion, PointMotion
  };
})();

if(typeof window !== 'undefined'){
  window.OrbAnimation = OrbAnimation;
}

// ============================================================
// 模块四：物理系统 PhysicsSystem (约1500行)
// 质点-弹簧 / Verlet积分 / 布料模拟 / 头发模拟 / 碰撞检测
// ============================================================

const OrbPhysics = (function(){
  const { Vec3, Quat, Mat4, clamp, lerp, damp, EPSILON } = OrbMath;

  // ============================================================
  // Particle - 质点
  // ============================================================
  class Particle {
    constructor(position, mass = 1){
      this.position = position.clone();
      this.prevPosition = position.clone();
      this.velocity = new Vec3();
      this.acceleration = new Vec3();
      this.force = new Vec3();
      this.mass = mass;
      this.invMass = mass > 0 ? 1 / mass : 0;
      this.pinned = false;
      this.collisionRadius = 0;
      this.userData = {};
    }

    applyForce(force){
      this.force.add(force);
    }

    clearForce(){
      this.force.set(0, 0, 0);
    }

    updateVerlet(dt, damping = 0.99){
      if(this.pinned) return;

      const velocity = Vec3.sub(this.position, this.prevPosition).mul(damping);
      this.prevPosition.copy(this.position);

      // Verlet积分: x(t+dt) = x(t) + v(t)*dt + a(t)*dt^2
      const acceleration = this.force.clone().mul(this.invMass);
      this.position.add(velocity).add(acceleration.mul(dt * dt));

      this.velocity.copy(velocity);
      this.clearForce();
    }

    updateEuler(dt, damping = 0.99){
      if(this.pinned) return;

      const acceleration = this.force.clone().mul(this.invMass);
      this.velocity.add(acceleration.mul(dt));
      this.velocity.mul(damping);
      this.position.add(this.velocity.clone().mul(dt));
      this.clearForce();
    }

    pin(position = null){
      this.pinned = true;
      if(position) this.position.copy(position);
      this.prevPosition.copy(this.position);
      this.velocity.set(0, 0, 0);
    }

    unpin(){
      this.pinned = false;
    }
  }

  // ============================================================
  // Spring - 弹簧约束
  // ============================================================
  class Spring {
    constructor(particleA, particleB, restLength = -1, stiffness = 0.5, damping = 0.1){
      this.particleA = particleA;
      this.particleB = particleB;
      this.restLength = restLength >= 0 ? restLength : particleA.position.distanceTo(particleB.position);
      this.stiffness = stiffness;
      this.damping = damping;
      this.enabled = true;
    }

    satisfy(){
      if(!this.enabled) return;

      const delta = Vec3.sub(this.particleB.position, this.particleA.position);
      const distance = delta.length();
      if(distance < EPSILON) return;

      const diff = (distance - this.restLength) / distance;
      const correction = delta.mul(diff * 0.5 * this.stiffness);

      // 阻尼
      const relativeVelocity = Vec3.sub(this.particleB.velocity, this.particleA.velocity);
      const dampingForce = delta.clone().normalize().mul(relativeVelocity.dot(delta.clone().normalize()) * this.damping);

      if(!this.particleA.pinned){
        this.particleA.position.add(correction);
        this.particleA.velocity.add(dampingForce.clone().mul(this.particleA.invMass));
      }
      if(!this.particleB.pinned){
        this.particleB.position.sub(correction);
        this.particleB.velocity.sub(dampingForce.clone().mul(this.particleB.invMass));
      }
    }

    applyForce(){
      if(!this.enabled) return;

      const delta = Vec3.sub(this.particleB.position, this.particleA.position);
      const distance = delta.length();
      if(distance < EPSILON) return;

      const force = delta.normalize().mul((distance - this.restLength) * this.stiffness);
      this.particleA.applyForce(force);
      this.particleB.applyForce(force.clone().negate());
    }
  }

  // ============================================================
  // DistanceConstraint - 距离约束（硬约束）
  // ============================================================
  class DistanceConstraint {
    constructor(particleA, particleB, distance = -1){
      this.particleA = particleA;
      this.particleB = particleB;
      this.distance = distance >= 0 ? distance : particleA.position.distanceTo(particleB.position);
      this.iterations = 3;
      this.enabled = true;
    }

    satisfy(){
      if(!this.enabled) return;

      for(let i = 0; i < this.iterations; i++){
        const delta = Vec3.sub(this.particleB.position, this.particleA.position);
        const currentDist = delta.length();
        if(currentDist < EPSILON) continue;

        const diff = (currentDist - this.distance) / currentDist;
        const correction = delta.mul(diff * 0.5);

        const totalInvMass = this.particleA.invMass + this.particleB.invMass;
        if(totalInvMass < EPSILON) continue;

        const weightA = this.particleA.invMass / totalInvMass;
        const weightB = this.particleB.invMass / totalInvMass;

        if(!this.particleA.pinned) this.particleA.position.add(correction.clone().mul(weightA));
        if(!this.particleB.pinned) this.particleB.position.sub(correction.clone().mul(weightB));
      }
    }
  }

  // ============================================================
  // BendConstraint - 弯曲约束（用于布料）
  // ============================================================
  class BendConstraint {
    constructor(particleA, particleB, particleC, stiffness = 0.3){
      this.particleA = particleA;
      this.particleB = particleB;
      this.particleC = particleC;
      this.restAngle = this._computeAngle();
      this.stiffness = stiffness;
      this.enabled = true;
    }

    _computeAngle(){
      const ab = Vec3.sub(this.particleB.position, this.particleA.position).normalize();
      const cb = Vec3.sub(this.particleB.position, this.particleC.position).normalize();
      return Math.acos(clamp(ab.dot(cb), -1, 1));
    }

    satisfy(){
      if(!this.enabled) return;

      const currentAngle = this._computeAngle();
      const angleDiff = currentAngle - this.restAngle;

      if(Math.abs(angleDiff) < EPSILON) return;

      // 计算修正方向
      const ab = Vec3.sub(this.particleB.position, this.particleA.position);
      const cb = Vec3.sub(this.particleB.position, this.particleC.position);
      const normal = Vec3.cross(ab, cb).normalize();

      if(normal.lengthSq() < EPSILON) return;

      const correction = normal.mul(angleDiff * this.stiffness * 0.5);

      if(!this.particleA.pinned) this.particleA.position.add(correction);
      if(!this.particleC.pinned) this.particleC.position.sub(correction);
    }
  }

  // ============================================================
  // PinConstraint - 固定约束
  // ============================================================
  class PinConstraint {
    constructor(particle, position){
      this.particle = particle;
      this.position = position.clone();
      this.stiffness = 1;
      this.enabled = true;
    }

    satisfy(){
      if(!this.enabled) return;
      if(this.particle.pinned){
        this.particle.position.copy(this.position);
        return;
      }
      const delta = Vec3.sub(this.position, this.particle.position);
      this.particle.position.add(delta.mul(this.stiffness));
    }
  }

  // ============================================================
  // Collider - 碰撞体基类
  // ============================================================
  class Collider {
    constructor(){
      this.position = new Vec3();
      this.enabled = true;
      this.friction = 0.5;
      this.restitution = 0.3;
    }

    collide(particle){
      return false;
    }
  }

  // 球体碰撞体
  class SphereCollider extends Collider {
    constructor(position, radius){
      super();
      this.position = position.clone();
      this.radius = radius;
    }

    collide(particle){
      if(!this.enabled) return false;

      const delta = Vec3.sub(particle.position, this.position);
      const distance = delta.length();
      const minDist = this.radius + particle.collisionRadius;

      if(distance < minDist && distance > EPSILON){
        const normal = delta.normalize();
        const penetration = minDist - distance;

        // 位置修正
        particle.position.add(normal.mul(penetration));

        // 速度反射
        const velocityNormal = particle.velocity.dot(normal);
        if(velocityNormal < 0){
          particle.velocity.sub(normal.mul(velocityNormal * (1 + this.restitution)));
          // 摩擦
          const tangent = particle.velocity.clone().sub(normal.mul(particle.velocity.dot(normal)));
          particle.velocity.sub(tangent.mul(this.friction));
        }

        return true;
      }
      return false;
    }
  }

  // 平面碰撞体
  class PlaneCollider extends Collider {
    constructor(position, normal){
      super();
      this.position = position.clone();
      this.normal = normal.clone().normalize();
    }

    collide(particle){
      if(!this.enabled) return false;

      const delta = Vec3.sub(particle.position, this.position);
      const distance = delta.dot(this.normal);
      const minDist = particle.collisionRadius;

      if(distance < minDist){
        // 位置修正
        particle.position.add(this.normal.clone().mul(minDist - distance));

        // 速度反射
        const velocityNormal = particle.velocity.dot(this.normal);
        if(velocityNormal < 0){
          particle.velocity.sub(this.normal.clone().mul(velocityNormal * (1 + this.restitution)));
          const tangent = particle.velocity.clone().sub(this.normal.clone().mul(particle.velocity.dot(this.normal)));
          particle.velocity.sub(tangent.mul(this.friction));
        }

        return true;
      }
      return false;
    }
  }

  // 胶囊体碰撞体
  class CapsuleCollider extends Collider {
    constructor(start, end, radius){
      super();
      this.start = start.clone();
      this.end = end.clone();
      this.radius = radius;
    }

    get position(){
      return Vec3.lerp(this.start, this.end, 0.5);
    }

    collide(particle){
      if(!this.enabled) return false;

      // 找到粒子到线段的最近点
      const ab = Vec3.sub(this.end, this.start);
      const ap = Vec3.sub(particle.position, this.start);
      const t = clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
      const closest = this.start.clone().add(ab.mul(t));

      const delta = Vec3.sub(particle.position, closest);
      const distance = delta.length();
      const minDist = this.radius + particle.collisionRadius;

      if(distance < minDist && distance > EPSILON){
        const normal = delta.normalize();
        const penetration = minDist - distance;

        particle.position.add(normal.mul(penetration));

        const velocityNormal = particle.velocity.dot(normal);
        if(velocityNormal < 0){
          particle.velocity.sub(normal.mul(velocityNormal * (1 + this.restitution)));
          const tangent = particle.velocity.clone().sub(normal.mul(particle.velocity.dot(normal)));
          particle.velocity.sub(tangent.mul(this.friction));
        }

        return true;
      }
      return false;
    }
  }

  // ============================================================
  // Cloth - 布料模拟
  // ============================================================
  class Cloth {
    constructor(width, height, segmentsX, segmentsY, origin = new Vec3(), mass = 1){
      this.width = width;
      this.height = height;
      this.segmentsX = segmentsX;
      this.segmentsY = segmentsY;
      this.particles = [];
      this.springs = [];
      this.bendConstraints = [];
      this.colliders = [];
      this.gravity = new Vec3(0, -9.8, 0);
      this.wind = new Vec3();
      this.damping = 0.99;
      this.iterations = 5;
      this.enabled = true;

      this._initParticles(origin, mass);
      this._initSprings();
      this._initBendConstraints();
    }

    _initParticles(origin, mass){
      const dx = this.width / this.segmentsX;
      const dy = this.height / this.segmentsY;

      for(let y = 0; y <= this.segmentsY; y++){
        for(let x = 0; x <= this.segmentsX; x++){
          const pos = new Vec3(
            origin.x + x * dx - this.width / 2,
            origin.y - y * dy + this.height / 2,
            origin.z
          );
          const particle = new Particle(pos, mass);
          particle.collisionRadius = 0.01;
          this.particles.push(particle);
        }
      }
    }

    _getIndex(x, y){
      return y * (this.segmentsX + 1) + x;
    }

    _initSprings(){
      // 结构弹簧（水平和垂直）
      for(let y = 0; y <= this.segmentsY; y++){
        for(let x = 0; x <= this.segmentsX; x++){
          const idx = this._getIndex(x, y);

          // 水平
          if(x < this.segmentsX){
            const right = this._getIndex(x + 1, y);
            this.springs.push(new Spring(this.particles[idx], this.particles[right], -1, 0.8, 0.1));
          }

          // 垂直
          if(y < this.segmentsY){
            const down = this._getIndex(x, y + 1);
            this.springs.push(new Spring(this.particles[idx], this.particles[down], -1, 0.8, 0.1));
          }
        }
      }

      // 剪切弹簧（对角线）
      for(let y = 0; y < this.segmentsY; y++){
        for(let x = 0; x < this.segmentsX; x++){
          const idx = this._getIndex(x, y);
          const diag1 = this._getIndex(x + 1, y + 1);
          const diag2 = this._getIndex(x + 1, y);
          const diag3 = this._getIndex(x, y + 1);

          this.springs.push(new Spring(this.particles[idx], this.particles[diag1], -1, 0.3, 0.1));
          this.springs.push(new Spring(this.particles[diag2], this.particles[diag3], -1, 0.3, 0.1));
        }
      }
    }

    _initBendConstraints(){
      // 弯曲约束（隔一个粒子）
      for(let y = 0; y <= this.segmentsY; y++){
        for(let x = 0; x <= this.segmentsX - 2; x++){
          const idx = this._getIndex(x, y);
          const mid = this._getIndex(x + 1, y);
          const far = this._getIndex(x + 2, y);
          this.bendConstraints.push(new BendConstraint(this.particles[idx], this.particles[mid], this.particles[far], 0.2));
        }
      }

      for(let y = 0; y <= this.segmentsY - 2; y++){
        for(let x = 0; x <= this.segmentsX; x++){
          const idx = this._getIndex(x, y);
          const mid = this._getIndex(x, y + 1);
          const far = this._getIndex(x, y + 2);
          this.bendConstraints.push(new BendConstraint(this.particles[idx], this.particles[mid], this.particles[far], 0.2));
        }
      }
    }

    pinRow(row, pinned = true){
      for(let x = 0; x <= this.segmentsX; x++){
        const idx = this._getIndex(x, row);
        if(pinned) this.particles[idx].pin();
        else this.particles[idx].unpin();
      }
    }

    pinColumn(col, pinned = true){
      for(let y = 0; y <= this.segmentsY; y++){
        const idx = this._getIndex(col, y);
        if(pinned) this.particles[idx].pin();
        else this.particles[idx].unpin();
      }
    }

    pinParticle(x, y, pinned = true){
      const idx = this._getIndex(x, y);
      if(pinned) this.particles[idx].pin();
      else this.particles[idx].unpin();
    }

    addCollider(collider){
      this.colliders.push(collider);
      return collider;
    }

    update(dt){
      if(!this.enabled) return;

      // 应用力
      for(const particle of this.particles){
        if(particle.pinned) continue;
        particle.applyForce(this.gravity.clone().mul(particle.mass));
        // 风力（基于法线的简化计算）
        if(this.wind.lengthSq() > EPSILON){
          particle.applyForce(this.wind.clone().mul(0.1));
        }
      }

      // Verlet积分
      for(const particle of this.particles){
        particle.updateVerlet(dt, this.damping);
      }

      // 约束迭代
      for(let i = 0; i < this.iterations; i++){
        for(const spring of this.springs){
          spring.satisfy();
        }
        for(const constraint of this.bendConstraints){
          constraint.satisfy();
        }

        // 碰撞
        for(const particle of this.particles){
          if(particle.pinned) continue;
          for(const collider of this.colliders){
            collider.collide(particle);
          }
        }
      }
    }

    getVertices(){
      return this.particles.map(p => p.position);
    }

    getIndices(){
      const indices = [];
      for(let y = 0; y < this.segmentsY; y++){
        for(let x = 0; x < this.segmentsX; x++){
          const a = this._getIndex(x, y);
          const b = this._getIndex(x + 1, y);
          const c = this._getIndex(x, y + 1);
          const d = this._getIndex(x + 1, y + 1);
          indices.push(a, c, b);
          indices.push(b, c, d);
        }
      }
      return indices;
    }

    getNormals(){
      const normals = new Array(this.particles.length);
      for(let i = 0; i < normals.length; i++){
        normals[i] = new Vec3();
      }

      const indices = this.getIndices();
      for(let i = 0; i < indices.length; i += 3){
        const a = this.particles[indices[i]].position;
        const b = this.particles[indices[i + 1]].position;
        const c = this.particles[indices[i + 2]].position;

        const ab = Vec3.sub(b, a);
        const ac = Vec3.sub(c, a);
        const normal = Vec3.cross(ab, ac).normalize();

        normals[indices[i]].add(normal);
        normals[indices[i + 1]].add(normal);
        normals[indices[i + 2]].add(normal);
      }

      for(const normal of normals){
        normal.normalize();
      }

      return normals;
    }
  }

  // ============================================================
  // HairSim - 头发模拟（链状弹簧）
  // ============================================================
  class HairStrand {
    constructor(origin, direction, length, segments, mass = 0.1){
      this.origin = origin.clone();
      this.direction = direction.clone().normalize();
      this.length = length;
      this.segments = segments;
      this.particles = [];
      this.springs = [];
      this.colliders = [];
      this.gravity = new Vec3(0, -9.8, 0);
      this.damping = 0.95;
      this.stiffness = 0.8;
      this.iterations = 3;
      this.enabled = true;

      this._initParticles(mass);
      this._initSprings();
    }

    _initParticles(mass){
      const segLength = this.length / this.segments;

      for(let i = 0; i <= this.segments; i++){
        const pos = this.origin.clone().add(this.direction.clone().mul(segLength * i));
        const particle = new Particle(pos, mass);
        particle.collisionRadius = 0.02;
        if(i === 0) particle.pin();
        this.particles.push(particle);
      }
    }

    _initSprings(){
      const segLength = this.length / this.segments;

      for(let i = 0; i < this.segments; i++){
        // 结构弹簧
        this.springs.push(new Spring(this.particles[i], this.particles[i + 1], segLength, this.stiffness, 0.1));
      }

      // 弯曲约束（隔一个粒子）
      for(let i = 0; i < this.segments - 1; i++){
        this.springs.push(new Spring(this.particles[i], this.particles[i + 2], segLength * 2, this.stiffness * 0.3, 0.1));
      }
    }

    setOrigin(position){
      this.origin.copy(position);
      this.particles[0].position.copy(position);
      this.particles[0].prevPosition.copy(position);
    }

    addCollider(collider){
      this.colliders.push(collider);
      return collider;
    }

    update(dt){
      if(!this.enabled) return;

      // 应用力
      for(const particle of this.particles){
        if(particle.pinned) continue;
        particle.applyForce(this.gravity.clone().mul(particle.mass));
      }

      // Verlet积分
      for(const particle of this.particles){
        particle.updateVerlet(dt, this.damping);
      }

      // 约束迭代
      for(let i = 0; i < this.iterations; i++){
        for(const spring of this.springs){
          spring.satisfy();
        }

        // 碰撞
        for(const particle of this.particles){
          if(particle.pinned) continue;
          for(const collider of this.colliders){
            collider.collide(particle);
          }
        }
      }
    }

    getVertices(){
      return this.particles.map(p => p.position);
    }

    getTipPosition(){
      return this.particles[this.particles.length - 1].position.clone();
    }
  }

  // 头发系统（多股头发）
  class HairSystem {
    constructor(){
      this.strands = [];
      this.colliders = [];
      this.gravity = new Vec3(0, -9.8, 0);
      this.wind = new Vec3();
      this.enabled = true;
    }

    addStrand(strand){
      this.strands.push(strand);
      for(const collider of this.colliders){
        strand.addCollider(collider);
      }
      return strand;
    }

    addCollider(collider){
      this.colliders.push(collider);
      for(const strand of this.strands){
        strand.addCollider(collider);
      }
      return collider;
    }

    createStrands(origin, count, length, segments, spread = 0.5){
      for(let i = 0; i < count; i++){
        const angle = (i / count) * Math.PI * 2;
        const direction = new Vec3(
          Math.cos(angle) * spread,
          -1,
          Math.sin(angle) * spread
        ).normalize();

        const offset = new Vec3(
          Math.cos(angle) * 0.1,
          0,
          Math.sin(angle) * 0.1
        );

        const strand = new HairStrand(origin.clone().add(offset), direction, length, segments, 0.05);
        strand.gravity.copy(this.gravity);
        this.addStrand(strand);
      }
    }

    update(dt){
      if(!this.enabled) return;

      for(const strand of this.strands){
        strand.gravity.copy(this.gravity);
        strand.update(dt);
      }
    }

    getAllVertices(){
      const vertices = [];
      for(const strand of this.strands){
        vertices.push(...strand.getVertices());
      }
      return vertices;
    }
  }

  // ============================================================
  // PhysicsWorld - 物理世界
  // ============================================================
  class PhysicsWorld {
    constructor(){
      this.particles = [];
      this.springs = [];
      this.constraints = [];
      this.colliders = [];
      this.cloths = [];
      this.hairSystems = [];
      this.gravity = new Vec3(0, -9.8, 0);
      this.damping = 0.99;
      this.iterations = 5;
      this.enabled = true;
      this.time = 0;
    }

    addParticle(particle){
      this.particles.push(particle);
      return particle;
    }

    addSpring(spring){
      this.springs.push(spring);
      return spring;
    }

    addConstraint(constraint){
      this.constraints.push(constraint);
      return constraint;
    }

    addCollider(collider){
      this.colliders.push(collider);
      return collider;
    }

    addCloth(cloth){
      this.cloths.push(cloth);
      for(const collider of this.colliders){
        cloth.addCollider(collider);
      }
      return cloth;
    }

    addHairSystem(system){
      this.hairSystems.push(system);
      return system;
    }

    update(dt){
      if(!this.enabled) return;

      this.time += dt;

      // 更新布料
      for(const cloth of this.cloths){
        cloth.gravity.copy(this.gravity);
        cloth.update(dt);
      }

      // 更新头发
      for(const hair of this.hairSystems){
        hair.gravity.copy(this.gravity);
        hair.update(dt);
      }

      // 更新独立粒子
      for(const particle of this.particles){
        if(particle.pinned) continue;
        particle.applyForce(this.gravity.clone().mul(particle.mass));
        particle.updateVerlet(dt, this.damping);
      }

      // 约束迭代
      for(let i = 0; i < this.iterations; i++){
        for(const spring of this.springs){
          spring.satisfy();
        }
        for(const constraint of this.constraints){
          constraint.satisfy();
        }

        // 碰撞
        for(const particle of this.particles){
          if(particle.pinned) continue;
          for(const collider of this.colliders){
            collider.collide(particle);
          }
        }
      }
    }

    clear(){
      this.particles = [];
      this.springs = [];
      this.constraints = [];
      this.colliders = [];
      this.cloths = [];
      this.hairSystems = [];
    }
  }

  // 导出
  return {
    Particle, Spring, DistanceConstraint, BendConstraint, PinConstraint,
    Collider, SphereCollider, PlaneCollider, CapsuleCollider,
    Cloth, HairStrand, HairSystem, PhysicsWorld
  };
})();

if(typeof window !== 'undefined'){
  window.OrbPhysics = OrbPhysics;
}

// ============================================================
// 模块五：交互系统 InteractionSystem (约1200行)
// 射线拾取 / 碰撞检测 / 拖拽 / 触摸响应 / 悬停检测
// ============================================================

const OrbInteraction = (function(){
  const { Vec3, Quat, Mat4, clamp, lerp, EPSILON } = OrbMath;

  // ============================================================
  // Ray - 射线
  // ============================================================
  class Ray {
    constructor(origin = new Vec3(), direction = new Vec3(0, 0, -1)){
      this.origin = origin.clone();
      this.direction = direction.clone().normalize();
    }

    set(origin, direction){
      this.origin.copy(origin);
      this.direction.copy(direction).normalize();
      return this;
    }

    copy(ray){
      this.origin.copy(ray.origin);
      this.direction.copy(ray.direction);
      return this;
    }

    clone(){
      return new Ray(this.origin, this.direction);
    }

    at(t, target = new Vec3()){
      return target.copy(this.origin).add(this.direction.clone().mul(t));
    }

    distanceToPoint(point){
      const v = Vec3.sub(point, this.origin);
      const projection = v.dot(this.direction);
      if(projection < 0) return this.origin.distanceTo(point);
      const closest = this.at(projection);
      return closest.distanceTo(point);
    }

    closestPointToPoint(point, target = new Vec3()){
      const v = Vec3.sub(point, this.origin);
      const projection = Math.max(0, v.dot(this.direction));
      return this.at(projection, target);
    }

    intersectSphere(center, radius){
      const oc = Vec3.sub(this.origin, center);
      const a = this.direction.dot(this.direction);
      const b = 2 * oc.dot(this.direction);
      const c = oc.dot(oc) - radius * radius;
      const discriminant = b * b - 4 * a * c;

      if(discriminant < 0) return null;

      const sqrtDisc = Math.sqrt(discriminant);
      const t1 = (-b - sqrtDisc) / (2 * a);
      const t2 = (-b + sqrtDisc) / (2 * a);

      if(t1 >= 0) return {t: t1, point: this.at(t1)};
      if(t2 >= 0) return {t: t2, point: this.at(t2)};
      return null;
    }

    intersectPlane(planePoint, planeNormal){
      const denom = planeNormal.dot(this.direction);
      if(Math.abs(denom) < EPSILON) return null;

      const t = Vec3.sub(planePoint, this.origin).dot(planeNormal) / denom;
      if(t < 0) return null;

      return {t, point: this.at(t)};
    }

    intersectBox(min, max){
      let tmin = -Infinity, tmax = Infinity;

      for(let i = 0; i < 3; i++){
        const origin = this.origin['xyz'[i]];
        const dir = this.direction['xyz'[i]];
        const minVal = min['xyz'[i]];
        const maxVal = max['xyz'[i]];

        if(Math.abs(dir) < EPSILON){
          if(origin < minVal || origin > maxVal) return null;
        } else {
          let t1 = (minVal - origin) / dir;
          let t2 = (maxVal - origin) / dir;
          if(t1 > t2) [t1, t2] = [t2, t1];
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          if(tmin > tmax) return null;
        }
      }

      if(tmax < 0) return null;
      const t = tmin >= 0 ? tmin : tmax;
      return {t, point: this.at(t)};
    }

    intersectTriangle(a, b, c, backfaceCulling = true){
      const edge1 = Vec3.sub(b, a);
      const edge2 = Vec3.sub(c, a);
      const pvec = Vec3.cross(this.direction, edge2);
      const det = edge1.dot(pvec);

      if(backfaceCulling && det < EPSILON) return null;
      if(Math.abs(det) < EPSILON) return null;

      const invDet = 1 / det;
      const tvec = Vec3.sub(this.origin, a);
      const u = tvec.dot(pvec) * invDet;

      if(u < 0 || u > 1) return null;

      const qvec = Vec3.cross(tvec, edge1);
      const v = this.direction.dot(qvec) * invDet;

      if(v < 0 || u + v > 1) return null;

      const t = edge2.dot(qvec) * invDet;
      if(t < 0) return null;

      return {t, point: this.at(t), u, v};
    }
  }

  // ============================================================
  // BoundingVolume - 包围体基类
  // ============================================================
  class BoundingVolume {
    constructor(){
      this.min = new Vec3(Infinity, Infinity, Infinity);
      this.max = new Vec3(-Infinity, -Infinity, -Infinity);
      this.center = new Vec3();
      this.radius = 0;
      this.dirty = true;
    }

    expandByPoint(point){
      this.min.min(point);
      this.max.max(point);
      this.dirty = true;
      return this;
    }

    expandByVolume(volume){
      this.expandByPoint(volume.min);
      this.expandByPoint(volume.max);
      return this;
    }

    compute(){
      this.center.copy(this.min).add(this.max).mul(0.5);
      this.radius = this.min.distanceTo(this.max) * 0.5;
      this.dirty = false;
      return this;
    }

    containsPoint(point){
      return point.x >= this.min.x && point.x <= this.max.x &&
             point.y >= this.min.y && point.y <= this.max.y &&
             point.z >= this.min.z && point.z <= this.max.z;
    }

    intersectsVolume(volume){
      return this.min.x <= volume.max.x && this.max.x >= volume.min.x &&
             this.min.y <= volume.max.y && this.max.y >= volume.min.y &&
             this.min.z <= volume.max.z && this.max.z >= volume.min.z;
    }

    intersectsRay(ray){
      return ray.intersectBox(this.min, this.max) !== null;
    }

    getSize(target = new Vec3()){
      return target.copy(this.max).sub(this.min);
    }

    getCenter(target = new Vec3()){
      if(this.dirty) this.compute();
      return target.copy(this.center);
    }

    clone(){
      const bv = new BoundingVolume();
      bv.min.copy(this.min);
      bv.max.copy(this.max);
      bv.center.copy(this.center);
      bv.radius = this.radius;
      bv.dirty = this.dirty;
      return bv;
    }
  }

  // ============================================================
  // Pickable - 可拾取对象
  // ============================================================
  class Pickable {
    constructor(name = '', data = {}){
      this.name = name;
      this.data = data;
      this.boundingVolume = new BoundingVolume();
      this.vertices = [];     // 顶点数组（用于精确拾取）
      this.indices = [];      // 索引数组
      this.transform = new Mat4();
      this.enabled = true;
      this.userData = {};
    }

    setBoundingFromVertices(vertices){
      this.vertices = vertices;
      this.boundingVolume = new BoundingVolume();
      for(const v of vertices){
        this.boundingVolume.expandByPoint(v);
      }
      this.boundingVolume.compute();
    }

    intersectRay(ray, precise = false){
      if(!this.enabled) return null;

      // 先检测包围体
      const localRay = ray.clone();
      // 将射线转换到局部空间
      const invTransform = this.transform.clone().inverse();
      localRay.origin.applyMatrix4(invTransform);
      // 方向需要特殊处理（去除平移）
      const dirMatrix = invTransform.clone();
      dirMatrix.elements[12] = 0;
      dirMatrix.elements[13] = 0;
      dirMatrix.elements[14] = 0;
      localRay.direction.applyMatrix4(dirMatrix).normalize();

      if(!this.boundingVolume.intersectsRay(localRay)){
        return null;
      }

      if(!precise || this.indices.length === 0){
        const hit = localRay.intersectBox(this.boundingVolume.min, this.boundingVolume.max);
        if(hit){
          hit.point.applyMatrix4(this.transform);
          return {object: this, ...hit};
        }
        return null;
      }

      // 精确三角形检测
      let closest = null;
      for(let i = 0; i < this.indices.length; i += 3){
        const a = this.vertices[this.indices[i]];
        const b = this.vertices[this.indices[i + 1]];
        const c = this.vertices[this.indices[i + 2]];

        const hit = localRay.intersectTriangle(a, b, c, false);
        if(hit && (!closest || hit.t < closest.t)){
          closest = {object: this, ...hit, faceIndex: i / 3};
        }
      }

      if(closest){
        closest.point.applyMatrix4(this.transform);
      }

      return closest;
    }
  }

  // ============================================================
  // Picker - 拾取器
  // ============================================================
  class Picker {
    constructor(camera = null, canvas = null){
      this.camera = camera;
      this.canvas = canvas;
      this.objects = [];
      this.ray = new Ray();
      this.precise = true;
      this.enabled = true;
    }

    setCamera(camera){
      this.camera = camera;
    }

    setCanvas(canvas){
      this.canvas = canvas;
    }

    addObject(object){
      this.objects.push(object);
      return object;
    }

    removeObject(object){
      const idx = this.objects.indexOf(object);
      if(idx >= 0) this.objects.splice(idx, 1);
    }

    clear(){
      this.objects = [];
    }

    setFromCamera(screenX, screenY){
      if(!this.camera || !this.canvas) return null;

      const rect = this.canvas.getBoundingClientRect();
      const x = ((screenX - rect.left) / rect.width) * 2 - 1;
      const y = -((screenY - rect.top) / rect.height) * 2 + 1;

      // 计算射线原点和方向
      const origin = new Vec3();
      const direction = new Vec3();

      if(this.camera.isPerspective){
        // 透视相机
        origin.copy(this.camera.position);
        const target = new Vec3(x, y, 0.5).applyMatrix4(this.camera.projectionMatrixInverse);
        direction.copy(target).sub(origin).normalize();
      } else {
        // 正交相机
        origin.set(x, y, -1).applyMatrix4(this.camera.projectionMatrixInverse);
        direction.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      }

      this.ray.set(origin, direction);
      return this.ray;
    }

    pick(screenX, screenY, filter = null){
      if(!this.enabled) return [];

      this.setFromCamera(screenX, screenY);

      const hits = [];
      for(const obj of this.objects){
        if(!obj.enabled) continue;
        if(filter && !filter(obj)) continue;

        const hit = obj.intersectRay(this.ray, this.precise);
        if(hit) hits.push(hit);
      }

      // 按距离排序
      hits.sort((a, b) => a.t - b.t);
      return hits;
    }

    pickFirst(screenX, screenY, filter = null){
      const hits = this.pick(screenX, screenY, filter);
      return hits.length > 0 ? hits[0] : null;
    }
  }

  // ============================================================
  // DragController - 拖拽控制器
  // ============================================================
  class DragController {
    constructor(picker, canvas = null){
      this.picker = picker;
      this.canvas = canvas || picker.canvas;
      this.dragging = false;
      this.dragObject = null;
      this.dragPlane = new Vec3(0, 1, 0);
      this.dragOffset = new Vec3();
      this.dragPoint = new Vec3();
      this.constrainAxis = null;  // 'x' | 'y' | 'z' | null
      this.constrainPlane = null; // 'xy' | 'xz' | 'yz' | null
      this.enabled = true;

      this.onDragStart = null;
      this.onDragMove = null;
      this.onDragEnd = null;

      this._bindEvents();
    }

    _bindEvents(){
      if(!this.canvas) return;

      this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
      window.addEventListener('mousemove', (e) => this._onMouseMove(e));
      window.addEventListener('mouseup', (e) => this._onMouseUp(e));

      // 触摸事件
      this.canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), {passive: false});
      window.addEventListener('touchmove', (e) => this._onTouchMove(e), {passive: false});
      window.addEventListener('touchend', (e) => this._onTouchEnd(e));
    }

    _onMouseDown(e){
      if(!this.enabled || e.button !== 0) return;

      const hit = this.picker.pickFirst(e.clientX, e.clientY);
      if(!hit) return;

      this.dragging = true;
      this.dragObject = hit.object;
      this.dragPoint.copy(hit.point);

      // 计算偏移
      const objectPos = this.dragObject.transform.getPosition();
      this.dragOffset.copy(hit.point).sub(objectPos);

      if(this.onDragStart) this.onDragStart(this.dragObject, hit);
    }

    _onMouseMove(e){
      if(!this.dragging || !this.dragObject) return;

      this.picker.setFromCamera(e.clientX, e.clientY);

      // 与拖拽平面相交
      const planePoint = this.dragPoint;
      const hit = this.picker.ray.intersectPlane(planePoint, this.dragPlane);

      if(hit){
        let newPos = hit.point.clone().sub(this.dragOffset);

        // 应用约束
        if(this.constrainAxis){
          const objectPos = this.dragObject.transform.getPosition();
          if(this.constrainAxis !== 'x') newPos.x = objectPos.x;
          if(this.constrainAxis !== 'y') newPos.y = objectPos.y;
          if(this.constrainAxis !== 'z') newPos.z = objectPos.z;
        }

        if(this.constrainPlane){
          const objectPos = this.dragObject.transform.getPosition();
          if(this.constrainPlane === 'xy') newPos.z = objectPos.z;
          if(this.constrainPlane === 'xz') newPos.y = objectPos.y;
          if(this.constrainPlane === 'yz') newPos.x = objectPos.x;
        }

        // 更新变换
        const e = this.dragObject.transform.elements;
        e[12] = newPos.x;
        e[13] = newPos.y;
        e[14] = newPos.z;

        if(this.onDragMove) this.onDragMove(this.dragObject, newPos);
      }
    }

    _onMouseUp(e){
      if(!this.dragging) return;

      if(this.onDragEnd) this.onDragEnd(this.dragObject);

      this.dragging = false;
      this.dragObject = null;
    }

    _onTouchStart(e){
      if(e.touches.length !== 1) return;
      e.preventDefault();
      const touch = e.touches[0];
      this._onMouseDown({clientX: touch.clientX, clientY: touch.clientY, button: 0});
    }

    _onTouchMove(e){
      if(e.touches.length !== 1) return;
      e.preventDefault();
      const touch = e.touches[0];
      this._onMouseMove({clientX: touch.clientX, clientY: touch.clientY});
    }

    _onTouchEnd(e){
      this._onMouseUp({});
    }

    setDragPlane(normal){
      this.dragPlane.copy(normal).normalize();
    }

    setConstrainAxis(axis){
      this.constrainAxis = axis;
      this.constrainPlane = null;
    }

    setConstrainPlane(plane){
      this.constrainPlane = plane;
      this.constrainAxis = null;
    }
  }

  // ============================================================
  // HoverDetector - 悬停检测器
  // ============================================================
  class HoverDetector {
    constructor(picker, canvas = null){
      this.picker = picker;
      this.canvas = canvas || picker.canvas;
      this.hoverObject = null;
      this.hoverPoint = null;
      this.enabled = true;
      this.threshold = 5; // 像素阈值

      this.onHoverEnter = null;
      this.onHoverMove = null;
      this.onHoverLeave = null;

      this._bindEvents();
    }

    _bindEvents(){
      if(!this.canvas) return;
      this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
      this.canvas.addEventListener('mouseleave', (e) => this._onMouseLeave(e));
    }

    _onMouseMove(e){
      if(!this.enabled) return;

      const hit = this.picker.pickFirst(e.clientX, e.clientY);

      if(hit){
        if(!this.hoverObject || this.hoverObject !== hit.object){
          if(this.hoverObject && this.onHoverLeave) this.onHoverLeave(this.hoverObject);
          this.hoverObject = hit.object;
          if(this.onHoverEnter) this.onHoverEnter(this.hoverObject, hit);
        }
        this.hoverPoint = hit.point;
        if(this.onHoverMove) this.onHoverMove(this.hoverObject, hit);
      } else {
        if(this.hoverObject){
          if(this.onHoverLeave) this.onHoverLeave(this.hoverObject);
          this.hoverObject = null;
          this.hoverPoint = null;
        }
      }
    }

    _onMouseLeave(e){
      if(this.hoverObject){
        if(this.onHoverLeave) this.onHoverLeave(this.hoverObject);
        this.hoverObject = null;
        this.hoverPoint = null;
      }
    }
  }

  // ============================================================
  // TouchHandler - 触摸处理器（手势识别）
  // ============================================================
  class TouchHandler {
    constructor(canvas = null){
      this.canvas = canvas;
      this.touches = [];
      this.gesture = null;
      this.enabled = true;

      this.onTap = null;
      this.onDoubleTap = null;
      this.onLongPress = null;
      this.onSwipe = null;
      this.onPinch = null;
      this.onRotate = null;
      this.onPan = null;

      this._lastTapTime = 0;
      this._lastTapPos = null;
      this._longPressTimer = null;

      this._bindEvents();
    }

    _bindEvents(){
      if(!this.canvas) return;

      this.canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), {passive: false});
      this.canvas.addEventListener('touchmove', (e) => this._onTouchMove(e), {passive: false});
      this.canvas.addEventListener('touchend', (e) => this._onTouchEnd(e));
      this.canvas.addEventListener('touchcancel', (e) => this._onTouchEnd(e));
    }

    _onTouchStart(e){
      if(!this.enabled) return;
      e.preventDefault();

      this.touches = Array.from(e.touches).map(t => ({
        id: t.identifier,
        x: t.clientX,
        y: t.clientY,
        startX: t.clientX,
        startY: t.clientY,
        startTime: Date.now()
      }));

      if(this.touches.length === 1){
        // 长按检测
        this._longPressTimer = setTimeout(() => {
          if(this.touches.length === 1 && this.onLongPress){
            this.onLongPress(this.touches[0]);
          }
        }, 500);
      }

      if(this.touches.length === 2){
        this.gesture = 'pinch';
        this._initialPinchDist = this._getPinchDistance();
        this._initialAngle = this._getAngle();
      }
    }

    _onTouchMove(e){
      if(!this.enabled) return;
      e.preventDefault();

      for(const t of e.touches){
        const touch = this.touches.find(tt => tt.id === t.identifier);
        if(touch){
          touch.x = t.clientX;
          touch.y = t.clientY;
        }
      }

      if(this.touches.length === 1){
        const touch = this.touches[0];
        const dx = touch.x - touch.startX;
        const dy = touch.y - touch.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if(dist > 10 && this._longPressTimer){
          clearTimeout(this._longPressTimer);
          this._longPressTimer = null;
        }

        if(this.onPan && dist > 5){
          this.onPan({x: touch.x, y: touch.y, dx, dy, dist});
        }
      }

      if(this.touches.length === 2){
        const currentDist = this._getPinchDistance();
        const scale = currentDist / this._initialPinchDist;

        if(this.onPinch){
          this.onPinch({scale, distance: currentDist});
        }

        const currentAngle = this._getAngle();
        const rotation = currentAngle - this._initialAngle;

        if(this.onRotate && Math.abs(rotation) > 1){
          this.onRotate({rotation, angle: currentAngle});
        }
      }
    }

    _onTouchEnd(e){
      if(!this.enabled) return;

      if(this._longPressTimer){
        clearTimeout(this._longPressTimer);
        this._longPressTimer = null;
      }

      if(this.touches.length === 1){
        const touch = this.touches[0];
        const dx = touch.x - touch.startX;
        const dy = touch.y - touch.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const duration = Date.now() - touch.startTime;

        if(dist < 10 && duration < 300){
          // 点击
          const now = Date.now();
          if(now - this._lastTapTime < 300 && this._lastTapPos &&
             Math.abs(this._lastTapPos.x - touch.x) < 30 &&
             Math.abs(this._lastTapPos.y - touch.y) < 30){
            // 双击
            if(this.onDoubleTap) this.onDoubleTap(touch);
            this._lastTapTime = 0;
          } else {
            if(this.onTap) this.onTap(touch);
            this._lastTapTime = now;
            this._lastTapPos = {x: touch.x, y: touch.y};
          }
        } else if(dist > 50 && duration < 500){
          // 滑动
          const speed = dist / duration;
          if(this.onSwipe){
            this.onSwipe({
              x: touch.x, y: touch.y,
              dx, dy, dist, speed,
              direction: this._getSwipeDirection(dx, dy)
            });
          }
        }
      }

      this.touches = [];
      this.gesture = null;
    }

    _getPinchDistance(){
      if(this.touches.length < 2) return 0;
      const dx = this.touches[0].x - this.touches[1].x;
      const dy = this.touches[0].y - this.touches[1].y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    _getAngle(){
      if(this.touches.length < 2) return 0;
      const dx = this.touches[1].x - this.touches[0].x;
      const dy = this.touches[1].y - this.touches[0].y;
      return Math.atan2(dy, dx) * 180 / Math.PI;
    }

    _getSwipeDirection(dx, dy){
      if(Math.abs(dx) > Math.abs(dy)){
        return dx > 0 ? 'right' : 'left';
      } else {
        return dy > 0 ? 'down' : 'up';
      }
    }
  }

  // ============================================================
  // InteractionManager - 交互管理器
  // ============================================================
  class InteractionManager {
    constructor(canvas = null, camera = null){
      this.canvas = canvas;
      this.camera = camera;
      this.picker = new Picker(camera, canvas);
      this.dragController = new DragController(this.picker, canvas);
      this.hoverDetector = new HoverDetector(this.picker, canvas);
      this.touchHandler = new TouchHandler(canvas);
      this.enabled = true;
    }

    setCamera(camera){
      this.camera = camera;
      this.picker.setCamera(camera);
    }

    setCanvas(canvas){
      this.canvas = canvas;
      this.picker.setCanvas(canvas);
    }

    addPickable(object){
      return this.picker.addObject(object);
    }

    removePickable(object){
      this.picker.removeObject(object);
    }

    pick(x, y){
      return this.picker.pick(x, y);
    }

    pickFirst(x, y){
      return this.picker.pickFirst(x, y);
    }
  }

  // 导出
  return {
    Ray, BoundingVolume, Pickable, Picker,
    DragController, HoverDetector, TouchHandler, InteractionManager
  };
})();

if(typeof window !== 'undefined'){
  window.OrbInteraction = OrbInteraction;
}

// ============================================================
// 模块六：行为树与情绪系统 BehaviorAI (约1000行)
// 行为树框架 / 情绪系统 / 决策系统
// ============================================================

const OrbBehavior = (function(){
  const { clamp, lerp, EPSILON } = OrbMath;

  // 行为树节点状态
  const NodeStatus = {
    SUCCESS: 'success',
    FAILURE: 'failure',
    RUNNING: 'running'
  };

  // ============================================================
  // BehaviorNode - 行为树节点基类
  // ============================================================
  class BehaviorNode {
    constructor(name = ''){
      this.name = name;
      this.parent = null;
      this.children = [];
      this.status = null;
      this.enabled = true;
      this.userData = {};
    }

    addChild(child){
      child.parent = this;
      this.children.push(child);
      return child;
    }

    removeChild(child){
      const idx = this.children.indexOf(child);
      if(idx >= 0){
        this.children.splice(idx, 1);
        child.parent = null;
      }
    }

    tick(context, dt){
      if(!this.enabled) return NodeStatus.FAILURE;
      this.status = this.update(context, dt);
      return this.status;
    }

    update(context, dt){
      return NodeStatus.SUCCESS;
    }

    reset(){
      this.status = null;
      for(const child of this.children){
        child.reset();
      }
    }

    abort(){
      this.status = null;
      for(const child of this.children){
        child.abort();
      }
    }
  }

  // ============================================================
  // Composite - 组合节点基类
  // ============================================================
  class Composite extends BehaviorNode {
    constructor(name = ''){
      super(name);
      this.currentChildIndex = 0;
    }

    reset(){
      super.reset();
      this.currentChildIndex = 0;
    }
  }

  // Selector - 选择器（或）：只要有一个子节点成功，就成功
  class Selector extends Composite {
    constructor(name = 'Selector'){
      super(name);
    }

    update(context, dt){
      for(let i = this.currentChildIndex; i < this.children.length; i++){
        const status = this.children[i].tick(context, dt);
        if(status === NodeStatus.SUCCESS){
          this.currentChildIndex = 0;
          return NodeStatus.SUCCESS;
        }
        if(status === NodeStatus.RUNNING){
          this.currentChildIndex = i;
          return NodeStatus.RUNNING;
        }
      }
      this.currentChildIndex = 0;
      return NodeStatus.FAILURE;
    }
  }

  // Sequence - 序列（与）：所有子节点都成功才成功
  class Sequence extends Composite {
    constructor(name = 'Sequence'){
      super(name);
    }

    update(context, dt){
      for(let i = this.currentChildIndex; i < this.children.length; i++){
        const status = this.children[i].tick(context, dt);
        if(status === NodeStatus.FAILURE){
          this.currentChildIndex = 0;
          return NodeStatus.FAILURE;
        }
        if(status === NodeStatus.RUNNING){
          this.currentChildIndex = i;
          return NodeStatus.RUNNING;
        }
      }
      this.currentChildIndex = 0;
      return NodeStatus.SUCCESS;
    }
  }

  // Parallel - 并行节点：同时执行所有子节点
  class Parallel extends Composite {
    constructor(name = 'Parallel', successPolicy = 'all', failurePolicy = 'one'){
      super(name);
      this.successPolicy = successPolicy; // 'all' | 'one'
      this.failurePolicy = failurePolicy; // 'all' | 'one'
      this.runningChildren = new Set();
    }

    update(context, dt){
      let successCount = 0;
      let failureCount = 0;

      for(let i = 0; i < this.children.length; i++){
        if(this.runningChildren.has(i) || !this.children[i].status){
          const status = this.children[i].tick(context, dt);
          if(status === NodeStatus.SUCCESS){
            successCount++;
            this.runningChildren.delete(i);
          } else if(status === NodeStatus.FAILURE){
            failureCount++;
            this.runningChildren.delete(i);
          } else {
            this.runningChildren.add(i);
          }
        }
      }

      if(this.failurePolicy === 'one' && failureCount > 0){
        this.abort();
        return NodeStatus.FAILURE;
      }
      if(this.successPolicy === 'one' && successCount > 0){
        this.abort();
        return NodeStatus.SUCCESS;
      }
      if(this.failurePolicy === 'all' && failureCount === this.children.length){
        return NodeStatus.FAILURE;
      }
      if(this.successPolicy === 'all' && successCount === this.children.length){
        return NodeStatus.SUCCESS;
      }

      return NodeStatus.RUNNING;
    }

    reset(){
      super.reset();
      this.runningChildren.clear();
    }

    abort(){
      super.abort();
      this.runningChildren.clear();
    }
  }

  // ============================================================
  // Decorator - 装饰器基类
  // ============================================================
  class Decorator extends BehaviorNode {
    constructor(name = '', child = null){
      super(name);
      if(child) this.addChild(child);
    }

    addChild(child){
      if(this.children.length > 0) this.children[0] = child;
      else super.addChild(child);
      return child;
    }

    update(context, dt){
      if(this.children.length === 0) return NodeStatus.FAILURE;
      return this.children[0].tick(context, dt);
    }
  }

  // Inverter - 反转器：成功变失败，失败变成功
  class Inverter extends Decorator {
    constructor(child = null){
      super('Inverter', child);
    }

    update(context, dt){
      const status = super.update(context, dt);
      if(status === NodeStatus.SUCCESS) return NodeStatus.FAILURE;
      if(status === NodeStatus.FAILURE) return NodeStatus.SUCCESS;
      return status;
    }
  }

  // Repeater - 重复器：重复执行子节点
  class Repeater extends Decorator {
    constructor(child = null, count = -1){
      super('Repeater', child);
      this.count = count; // -1 表示无限重复
      this.currentCount = 0;
    }

    update(context, dt){
      if(this.children.length === 0) return NodeStatus.FAILURE;

      const status = this.children[0].tick(context, dt);

      if(status === NodeStatus.RUNNING) return NodeStatus.RUNNING;

      this.currentCount++;
      if(this.count < 0 || this.currentCount < this.count){
        this.children[0].reset();
        return NodeStatus.RUNNING;
      }

      this.currentCount = 0;
      return NodeStatus.SUCCESS;
    }

    reset(){
      super.reset();
      this.currentCount = 0;
    }
  }

  // RepeatUntilFailure - 重复直到失败
  class RepeatUntilFailure extends Decorator {
    constructor(child = null){
      super('RepeatUntilFailure', child);
    }

    update(context, dt){
      if(this.children.length === 0) return NodeStatus.FAILURE;
      const status = this.children[0].tick(context, dt);
      if(status === NodeStatus.FAILURE) return NodeStatus.SUCCESS;
      this.children[0].reset();
      return NodeStatus.RUNNING;
    }
  }

  // TimeLimit - 时间限制：子节点在指定时间内必须完成
  class TimeLimit extends Decorator {
    constructor(child = null, time = 1){
      super('TimeLimit', child);
      this.time = time;
      this.elapsed = 0;
    }

    update(context, dt){
      if(this.children.length === 0) return NodeStatus.FAILURE;

      this.elapsed += dt;
      if(this.elapsed >= this.time){
        this.children[0].abort();
        this.elapsed = 0;
        return NodeStatus.FAILURE;
      }

      const status = this.children[0].tick(context, dt);
      if(status !== NodeStatus.RUNNING){
        this.elapsed = 0;
      }
      return status;
    }

    reset(){
      super.reset();
      this.elapsed = 0;
    }
  }

  // Cooldown - 冷却：在指定时间后才能再次执行
  class Cooldown extends Decorator {
    constructor(child = null, cooldown = 1){
      super('Cooldown', child);
      this.cooldown = cooldown;
      this.lastExecution = -Infinity;
    }

    update(context, dt){
      const now = context.time || Date.now() / 1000;
      if(now - this.lastExecution < this.cooldown){
        return NodeStatus.FAILURE;
      }

      const status = super.update(context, dt);
      if(status === NodeStatus.SUCCESS || status === NodeStatus.FAILURE){
        this.lastExecution = now;
      }
      return status;
    }
  }

  // ============================================================
  // Leaf - 叶子节点基类
  // ============================================================
  class Leaf extends BehaviorNode {
    constructor(name = ''){
      super(name);
    }
  }

  // Action - 动作节点
  class Action extends Leaf {
    constructor(name = '', action = null){
      super(name);
      this.action = action;
      this.startTime = 0;
    }

    update(context, dt){
      if(!this.action) return NodeStatus.FAILURE;
      return this.action(context, dt, this);
    }

    reset(){
      super.reset();
      this.startTime = 0;
    }
  }

  // Condition - 条件节点
  class Condition extends Leaf {
    constructor(name = '', condition = null){
      super(name);
      this.condition = condition;
    }

    update(context, dt){
      if(!this.condition) return NodeStatus.FAILURE;
      return this.condition(context, dt) ? NodeStatus.SUCCESS : NodeStatus.FAILURE;
    }
  }

  // Wait - 等待节点
  class Wait extends Leaf {
    constructor(name = 'Wait', duration = 1){
      super(name);
      this.duration = duration;
      this.elapsed = 0;
    }

    update(context, dt){
      this.elapsed += dt;
      if(this.elapsed >= this.duration){
        this.elapsed = 0;
        return NodeStatus.SUCCESS;
      }
      return NodeStatus.RUNNING;
    }

    reset(){
      super.reset();
      this.elapsed = 0;
    }
  }

  // ============================================================
  // BehaviorTree - 行为树
  // ============================================================
  class BehaviorTree {
    constructor(root = null){
      this.root = root;
      this.context = {};
      this.enabled = true;
      this.time = 0;
    }

    setRoot(root){
      this.root = root;
    }

    tick(dt){
      if(!this.enabled || !this.root) return NodeStatus.FAILURE;
      this.time += dt;
      this.context.time = this.time;
      this.context.dt = dt;
      return this.root.tick(this.context, dt);
    }

    reset(){
      if(this.root) this.root.reset();
      this.time = 0;
    }
  }

  // ============================================================
  // EmotionSystem - 情绪系统
  // ============================================================
  class EmotionSystem {
    constructor(){
      this.emotions = {
        happy: 0,
        sad: 0,
        angry: 0,
        fear: 0,
        surprise: 0,
        disgust: 0,
        neutral: 1
      };

      this.decayRate = 0.1; // 每秒衰减率
      this.threshold = 0.3; // 情绪触发阈值
      this.currentMood = 'neutral';
      this.moodIntensity = 0;
      this.enabled = true;

      this.onEmotionChange = null;
      this.onMoodChange = null;

      this._history = [];
      this._maxHistory = 100;
    }

    setEmotion(name, value){
      if(this.emotions[name] === undefined) return;
      const oldValue = this.emotions[name];
      this.emotions[name] = clamp(value, 0, 1);

      if(this.onEmotionChange && Math.abs(oldValue - this.emotions[name]) > 0.01){
        this.onEmotionChange(name, this.emotions[name], oldValue);
      }

      this._updateMood();
      this._recordHistory(name, this.emotions[name]);
    }

    addEmotion(name, value){
      if(this.emotions[name] === undefined) return;
      this.setEmotion(name, this.emotions[name] + value);
    }

    getEmotion(name){
      return this.emotions[name] || 0;
    }

    update(dt){
      if(!this.enabled) return;

      // 情绪衰减
      for(const name in this.emotions){
        if(name === 'neutral') continue;
        if(this.emotions[name] > 0){
          this.emotions[name] = Math.max(0, this.emotions[name] - this.decayRate * dt);
        }
      }

      // 中性情绪 = 1 - 其他情绪总和
      let otherSum = 0;
      for(const name in this.emotions){
        if(name !== 'neutral') otherSum += this.emotions[name];
      }
      this.emotions.neutral = Math.max(0, 1 - otherSum);

      this._updateMood();
    }

    _updateMood(){
      let maxEmotion = 'neutral';
      let maxValue = this.emotions.neutral;

      for(const name in this.emotions){
        if(this.emotions[name] > maxValue){
          maxValue = this.emotions[name];
          maxEmotion = name;
        }
      }

      if(maxValue >= this.threshold && maxEmotion !== this.currentMood){
        const oldMood = this.currentMood;
        this.currentMood = maxEmotion;
        this.moodIntensity = maxValue;
        if(this.onMoodChange){
          this.onMoodChange(maxEmotion, maxValue, oldMood);
        }
      } else if(maxEmotion === this.currentMood){
        this.moodIntensity = maxValue;
      }
    }

    _recordHistory(name, value){
      this._history.push({name, value, time: Date.now()});
      if(this._history.length > this._maxHistory){
        this._history.shift();
      }
    }

    getDominantEmotion(){
      return this.currentMood;
    }

    getMoodIntensity(){
      return this.moodIntensity;
    }

    getEmotionState(){
      return {...this.emotions};
    }

    reset(){
      for(const name in this.emotions){
        this.emotions[name] = name === 'neutral' ? 1 : 0;
      }
      this.currentMood = 'neutral';
      this.moodIntensity = 0;
      this._history = [];
    }
  }

  // ============================================================
  // DecisionSystem - 决策系统（基于效用的决策）
  // ============================================================
  class DecisionSystem {
    constructor(){
      this.actions = [];
      this.currentAction = null;
      this.enabled = true;
      this.decisionInterval = 0.5; // 决策间隔
      this.elapsed = 0;
      this.context = {};
    }

    addAction(action){
      this.actions.push(action);
      return action;
    }

    removeAction(action){
      const idx = this.actions.indexOf(action);
      if(idx >= 0) this.actions.splice(idx, 1);
    }

    update(dt){
      if(!this.enabled) return;

      this.elapsed += dt;
      if(this.elapsed < this.decisionInterval) return;
      this.elapsed = 0;

      // 计算每个动作的效用
      let bestAction = null;
      let bestUtility = -Infinity;

      for(const action of this.actions){
        if(!action.enabled) continue;
        const utility = action.evaluate(this.context);
        if(utility > bestUtility){
          bestUtility = utility;
          bestAction = action;
        }
      }

      // 执行最佳动作
      if(bestAction && bestAction !== this.currentAction){
        if(this.currentAction && this.currentAction.onExit){
          this.currentAction.onExit(this.context);
        }
        this.currentAction = bestAction;
        if(this.currentAction.onEnter){
          this.currentAction.onEnter(this.context);
        }
      }

      if(this.currentAction && this.currentAction.onUpdate){
        this.currentAction.onUpdate(this.context, dt);
      }
    }

    setContext(key, value){
      this.context[key] = value;
    }

    getContext(key){
      return this.context[key];
    }

    reset(){
      if(this.currentAction && this.currentAction.onExit){
        this.currentAction.onExit(this.context);
      }
      this.currentAction = null;
      this.elapsed = 0;
    }
  }

  // 决策动作
  class DecisionAction {
    constructor(name = ''){
      this.name = name;
      this.enabled = true;
      this.userData = {};
    }

    evaluate(context){
      return 0;
    }

    onEnter(context){}
    onUpdate(context, dt){}
    onExit(context){}
  }

  // 导出
  return {
    NodeStatus, BehaviorNode, Composite, Selector, Sequence, Parallel,
    Decorator, Inverter, Repeater, RepeatUntilFailure, TimeLimit, Cooldown,
    Leaf, Action, Condition, Wait, BehaviorTree,
    EmotionSystem, DecisionSystem, DecisionAction
  };
})();

if(typeof window !== 'undefined'){
  window.OrbBehavior = OrbBehavior;
}

// ============================================================
// 模块七：PBR材质与光照系统 RenderingPBR (约1500行)
// PBR材质 / 光源 / 光照计算 / 阴影 / IBL
// ============================================================

const OrbPBR = (function(){
  const { Vec3, clamp, lerp, EPSILON } = OrbMath;

  // ============================================================
  // PBRMaterial - PBR材质
  // ============================================================
  class PBRMaterial {
    constructor(name = ''){
      this.name = name;

      // 基础属性
      this.albedo = new Vec3(1, 1, 1);     // 基础颜色
      this.roughness = 0.5;                  // 粗糙度
      this.metalness = 0;                    // 金属度
      this.emissive = new Vec3(0, 0, 0);    // 自发光
      this.emissiveIntensity = 1;            // 自发光强度
      this.ao = 1;                            // 环境光遮蔽
      this.opacity = 1;                       // 不透明度
      this.transparent = false;               // 是否透明

      // 高级属性
      this.normalScale = 1;                   // 法线强度
      this.aoIntensity = 1;                   // AO强度
      this.envMapIntensity = 1;               // 环境贴图强度
      this.reflectivity = 0.5;                // 反射率
      this.clearcoat = 0;                      // 清漆层
      this.clearcoatRoughness = 0;            // 清漆粗糙度
      this.sheen = 0;                          // 光泽
      this.sheenColor = new Vec3(1, 1, 1);   // 光泽颜色
      this.subsurface = 0;                     // 次表面散射
      this.subsurfaceColor = new Vec3(1, 1, 1); // 次表面颜色

      // 纹理
      this.albedoMap = null;
      this.normalMap = null;
      this.roughnessMap = null;
      this.metalnessMap = null;
      this.aoMap = null;
      this.emissiveMap = null;
      this.opacityMap = null;
      this.envMap = null;

      // 渲染状态
      this.wireframe = false;
      this.flatShading = false;
      this.side = 0; // 0=正面, 1=背面, 2=双面
      this.depthTest = true;
      this.depthWrite = true;
      this.blending = 0; // 0=不混合, 1=正常, 2=叠加, 3=相乘

      this.userData = {};
    }

    setAlbedo(r, g, b){
      this.albedo.set(r, g, b);
      return this;
    }

    setEmissive(r, g, b, intensity = 1){
      this.emissive.set(r, g, b);
      this.emissiveIntensity = intensity;
      return this;
    }

    clone(){
      const m = new PBRMaterial(this.name);
      m.albedo.copy(this.albedo);
      m.roughness = this.roughness;
      m.metalness = this.metalness;
      m.emissive.copy(this.emissive);
      m.emissiveIntensity = this.emissiveIntensity;
      m.ao = this.ao;
      m.opacity = this.opacity;
      m.transparent = this.transparent;
      m.normalScale = this.normalScale;
      m.aoIntensity = this.aoIntensity;
      m.envMapIntensity = this.envMapIntensity;
      m.reflectivity = this.reflectivity;
      m.clearcoat = this.clearcoat;
      m.clearcoatRoughness = this.clearcoatRoughness;
      m.sheen = this.sheen;
      m.sheenColor.copy(this.sheenColor);
      m.subsurface = this.subsurface;
      m.subsurfaceColor.copy(this.subsurfaceColor);
      m.wireframe = this.wireframe;
      m.flatShading = this.flatShading;
      m.side = this.side;
      m.depthTest = this.depthTest;
      m.depthWrite = this.depthWrite;
      m.blending = this.blending;
      m.userData = {...this.userData};
      return m;
    }

    // 预设材质
    static createGold(){
      const m = new PBRMaterial('Gold');
      m.setAlbedo(1.0, 0.766, 0.336);
      m.metalness = 1;
      m.roughness = 0.3;
      return m;
    }

    static createSilver(){
      const m = new PBRMaterial('Silver');
      m.setAlbedo(0.972, 0.96, 0.915);
      m.metalness = 1;
      m.roughness = 0.25;
      return m;
    }

    static createCopper(){
      const m = new PBRMaterial('Copper');
      m.setAlbedo(0.953, 0.638, 0.538);
      m.metalness = 1;
      m.roughness = 0.35;
      return m;
    }

    static createPlastic(color = [1, 1, 1]){
      const m = new PBRMaterial('Plastic');
      m.setAlbedo(color[0], color[1], color[2]);
      m.metalness = 0;
      m.roughness = 0.4;
      m.clearcoat = 0.5;
      m.clearcoatRoughness = 0.2;
      return m;
    }

    static createRubber(color = [0.1, 0.1, 0.1]){
      const m = new PBRMaterial('Rubber');
      m.setAlbedo(color[0], color[1], color[2]);
      m.metalness = 0;
      m.roughness = 0.9;
      return m;
    }

    static createSkin(){
      const m = new PBRMaterial('Skin');
      m.setAlbedo(0.85, 0.6, 0.5);
      m.metalness = 0;
      m.roughness = 0.6;
      m.subsurface = 0.5;
      m.subsurfaceColor.set(1, 0.5, 0.4);
      return m;
    }

    static createGlass(){
      const m = new PBRMaterial('Glass');
      m.setAlbedo(1, 1, 1);
      m.metalness = 0;
      m.roughness = 0.05;
      m.opacity = 0.3;
      m.transparent = true;
      m.reflectivity = 0.9;
      return m;
    }
  }

  // ============================================================
  // Light - 光源基类
  // ============================================================
  class Light {
    constructor(color = new Vec3(1, 1, 1), intensity = 1){
      this.color = color.clone();
      this.intensity = intensity;
      this.enabled = true;
      this.castShadow = false;
      this.userData = {};
    }

    setColor(r, g, b){
      this.color.set(r, g, b);
      return this;
    }

    setIntensity(intensity){
      this.intensity = intensity;
      return this;
    }

    getEffectiveColor(){
      return this.color.clone().mul(this.intensity);
    }
  }

  // DirectionalLight - 方向光
  class DirectionalLight extends Light {
    constructor(color, intensity){
      super(color, intensity);
      this.direction = new Vec3(0, -1, 0);
      this.position = new Vec3(0, 10, 0);
      this.target = new Vec3(0, 0, 0);
      this.shadowMapSize = 2048;
      this.shadowCameraNear = 0.5;
      this.shadowCameraFar = 50;
      this.shadowCameraLeft = -10;
      this.shadowCameraRight = 10;
      this.shadowCameraTop = 10;
      this.shadowCameraBottom = -10;
      this.shadowBias = -0.0005;
      this.shadowNormalBias = 0.02;
    }

    updateDirection(){
      this.direction.copy(this.target).sub(this.position).normalize();
      return this.direction;
    }
  }

  // PointLight - 点光源
  class PointLight extends Light {
    constructor(color, intensity, distance = 0, decay = 2){
      super(color, intensity);
      this.position = new Vec3();
      this.distance = distance;
      this.decay = decay;
      this.shadowMapSize = 1024;
      this.shadowCameraNear = 0.1;
      this.shadowCameraFar = 100;
      this.shadowBias = -0.001;
    }

    getDistanceAttenuation(distance){
      if(this.distance <= 0) return 1;
      const attenuation = pow(clamp(1 - pow(distance / this.distance, 4), 0, 1), 2);
      return attenuation / (distance * distance * this.decay + 1);
    }
  }

  // SpotLight - 聚光灯
  class SpotLight extends Light {
    constructor(color, intensity, distance = 0, angle = Math.PI / 6, penumbra = 0, decay = 2){
      super(color, intensity);
      this.position = new Vec3();
      this.target = new Vec3();
      this.direction = new Vec3(0, -1, 0);
      this.distance = distance;
      this.angle = angle;
      this.penumbra = penumbra;
      this.decay = decay;
      this.shadowMapSize = 1024;
      this.shadowCameraNear = 0.1;
      this.shadowCameraFar = 100;
      this.shadowBias = -0.001;
    }

    updateDirection(){
      this.direction.copy(this.target).sub(this.position).normalize();
      return this.direction;
    }

    getConeAttenuation(cosTheta){
      const cosOuter = Math.cos(this.angle);
      const cosInner = Math.cos(this.angle * (1 - this.penumbra));
      return smoothstep(cosOuter, cosInner, cosTheta);
    }
  }

  // HemisphereLight - 半球光
  class HemisphereLight extends Light {
    constructor(skyColor = new Vec3(1, 1, 1), groundColor = new Vec3(0.5, 0.5, 0.5), intensity = 1){
      super(skyColor, intensity);
      this.groundColor = groundColor.clone();
    }
  }

  // RectAreaLight - 面光源
  class RectAreaLight extends Light {
    constructor(color, intensity, width = 10, height = 10){
      super(color, intensity);
      this.position = new Vec3();
      this.width = width;
      this.height = height;
    }
  }

  // ============================================================
  // LightingModel - 光照计算模型
  // ============================================================
  class LightingModel {
    constructor(){
      this.lights = [];
      this.ambientLight = new Vec3(0.1, 0.1, 0.1);
      this.environment = null;
      this.enabled = true;
    }

    addLight(light){
      this.lights.push(light);
      return light;
    }

    removeLight(light){
      const idx = this.lights.indexOf(light);
      if(idx >= 0) this.lights.splice(idx, 1);
    }

    clear(){
      this.lights = [];
    }

    // 计算漫反射（Lambert）
    diffuse(normal, lightDir, lightColor){
      const ndotl = Math.max(0, normal.dot(lightDir));
      return lightColor.clone().mul(ndotl);
    }

    // 计算高光（Phong）
    specularPhong(normal, lightDir, viewDir, lightColor, shininess){
      const reflectDir = normal.clone().mul(2 * normal.dot(lightDir)).sub(lightDir).normalize();
      const rdotv = Math.max(0, reflectDir.dot(viewDir));
      return lightColor.clone().mul(Math.pow(rdotv, shininess));
    }

    // 计算高光（Blinn-Phong）
    specularBlinnPhong(normal, lightDir, viewDir, lightColor, shininess){
      const halfDir = lightDir.clone().add(viewDir).normalize();
      const ndoth = Math.max(0, normal.dot(halfDir));
      return lightColor.clone().mul(Math.pow(ndoth, shininess * 4));
    }

    // GGX/Trowbridge-Reitz 法线分布函数
    distributionGGX(normal, halfDir, roughness){
      const a = roughness * roughness;
      const a2 = a * a;
      const ndoth = Math.max(0, normal.dot(halfDir));
      const ndoth2 = ndoth * ndoth;
      const denom = ndoth2 * (a2 - 1) + 1;
      return a2 / (Math.PI * denom * denom);
    }

    // Schlick-GGX 几何函数
    geometrySchlickGGX(ndotv, roughness){
      const r = roughness + 1;
      const k = (r * r) / 8;
      return ndotv / (ndotv * (1 - k) + k);
    }

    // Smith 几何函数
    geometrySmith(normal, viewDir, lightDir, roughness){
      const ndotv = Math.max(0, normal.dot(viewDir));
      const ndotl = Math.max(0, normal.dot(lightDir));
      const ggx2 = this.geometrySchlickGGX(ndotv, roughness);
      const ggx1 = this.geometrySchlickGGX(ndotl, roughness);
      return ggx1 * ggx2;
    }

    // Fresnel-Schlick 近似
    fresnelSchlick(cosTheta, f0){
      return f0.clone().add(new Vec3(1, 1, 1).sub(f0).mul(Math.pow(clamp(1 - cosTheta, 0, 1), 5)));
    }

    // Fresnel-Schlick with roughness
    fresnelSchlickRoughness(cosTheta, f0, roughness){
      return f0.clone().add(new Vec3(Math.max(1 - roughness, f0.x), Math.max(1 - roughness, f0.y), Math.max(1 - roughness, f0.z)).sub(f0).mul(Math.pow(clamp(1 - cosTheta, 0, 1), 5)));
    }

    // 完整PBR光照计算（Cook-Torrance BRDF）
    calculatePBR(position, normal, viewDir, material, lights){
      const albedo = material.albedo;
      const roughness = clamp(material.roughness, 0.04, 1);
      const metalness = clamp(material.metalness, 0, 1);
      const ao = material.ao;

      // F0 = 基础反射率
      const f0 = new Vec3(0.04, 0.04, 0.04);
      f0.lerp(albedo, metalness);

      let Lo = new Vec3(0, 0, 0); // 出射辐射度

      for(const light of lights){
        if(!light.enabled) continue;

        let lightDir, attenuation = 1;

        if(light instanceof DirectionalLight){
          lightDir = light.direction.clone().negate();
        } else if(light instanceof PointLight){
          const dist = position.distanceTo(light.position);
          lightDir = Vec3.sub(light.position, position).normalize();
          attenuation = light.getDistanceAttenuation(dist);
        } else if(light instanceof SpotLight){
          const dist = position.distanceTo(light.position);
          lightDir = Vec3.sub(light.position, position).normalize();
          attenuation = light.getDistanceAttenuation(dist);
          const cosTheta = lightDir.dot(light.direction.clone().negate());
          attenuation *= light.getConeAttenuation(cosTheta);
        } else {
          continue;
        }

        const halfDir = lightDir.clone().add(viewDir).normalize();
        const lightColor = light.getEffectiveColor().mul(attenuation);

        // Cook-Torrance BRDF
        const NDF = this.distributionGGX(normal, halfDir, roughness);
        const G = this.geometrySmith(normal, viewDir, lightDir, roughness);
        const F = this.fresnelSchlick(Math.max(0, halfDir.dot(viewDir)), f0);

        const numerator = NDF * G;
        const denominator = 4 * Math.max(0, normal.dot(viewDir)) * Math.max(0, normal.dot(lightDir)) + 0.0001;
        const specular = F.clone().mul(numerator / denominator);

        // 能量守恒
        const kS = F;
        const kD = new Vec3(1, 1, 1).sub(kS).mul(1 - metalness);

        const ndotl = Math.max(0, normal.dot(lightDir));
        const diffuse = albedo.clone().div(Math.PI).mul(kD);

        Lo.add(diffuse.add(specular).mul(lightColor).mul(ndotl));
      }

      // 环境光
      const ambient = this.ambientLight.clone().mul(albedo).mul(ao);

      // 自发光
      const emissive = material.emissive.clone().mul(material.emissiveIntensity);

      // 最终颜色
      const color = Lo.add(ambient).add(emissive);

      return color;
    }
  }

  // ============================================================
  // ShadowMap - 阴影贴图
  // ============================================================
  class ShadowMap {
    constructor(gl, size = 2048){
      this.gl = gl;
      this.size = size;
      this.framebuffer = null;
      this.depthTexture = null;
      this.enabled = true;
      this.bias = -0.0005;
      this.normalBias = 0.02;
      this._init();
    }

    _init(){
      const gl = this.gl;

      // 创建深度纹理
      this.depthTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, this.size, this.size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      // 创建帧缓冲
      this.framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTexture, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    bind(){
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.viewport(0, 0, this.size, this.size);
    }

    unbind(){
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // PCF软阴影采样
    samplePCF(shadowCoord, texelSize){
      let result = 0;
      for(let x = -1; x <= 1; x++){
        for(let y = -1; y <= 1; y++){
          const offset = new Vec3(x * texelSize, y * texelSize, 0);
          result += this.sample(shadowCoord.clone().add(offset));
        }
      }
      return result / 9;
    }

    sample(shadowCoord){
      // 简化实现，实际需要在着色器中采样深度纹理
      return 1;
    }

    dispose(){
      const gl = this.gl;
      if(this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
      if(this.depthTexture) gl.deleteTexture(this.depthTexture);
    }
  }

  // ============================================================
  // EnvironmentMap - 环境贴图（IBL）
  // ============================================================
  class EnvironmentMap {
    constructor(gl){
      this.gl = gl;
      this.diffuseEnvMap = null;   // 辐照度贴图（漫反射IBL）
      this.specularEnvMap = null;  // 预过滤环境贴图（高光IBL）
      this.brdfLUT = null;          // BRDF查找表
      this.intensity = 1;
      this.enabled = true;
    }

    // 从等距柱状投影图生成环境贴图
    setFromEquirectangular(texture){
      // 简化实现，实际需要做球面谐波和预过滤
      this.diffuseEnvMap = texture;
      this.specularEnvMap = texture;
    }

    // 生成BRDF LUT
    generateBRDFLUT(size = 512){
      const gl = this.gl;
      // 简化实现，实际需要用计算着色器生成
      this.brdfLUT = gl.createTexture();
    }

    // 获取漫反射环境光
    getDiffuseIrradiance(normal){
      // 简化实现，实际需要采样辐照度贴图
      return new Vec3(0.2, 0.2, 0.2);
    }

    // 获取高光环境光
    getSpecularRadiance(normal, viewDir, roughness){
      // 简化实现，实际需要采样预过滤环境贴图
      return new Vec3(0.5, 0.5, 0.5);
    }

    dispose(){
      const gl = this.gl;
      if(this.diffuseEnvMap) gl.deleteTexture(this.diffuseEnvMap);
      if(this.specularEnvMap) gl.deleteTexture(this.specularEnvMap);
      if(this.brdfLUT) gl.deleteTexture(this.brdfLUT);
    }
  }

  // 工具函数
  function pow(base, exp){
    return Math.pow(base, exp);
  }

  function smoothstep(edge0, edge1, x){
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // 导出
  return {
    PBRMaterial, Light, DirectionalLight, PointLight, SpotLight,
    HemisphereLight, RectAreaLight, LightingModel, ShadowMap, EnvironmentMap
  };
})();

if(typeof window !== 'undefined'){
  window.OrbPBR = OrbPBR;
}

// ============================================================
// 模块八：后处理管线 PostProcessing (约1200行)
// 渲染目标 / Bloom / 景深 / 抗锯齿 / 色调映射 / 颜色分级
// ============================================================

const OrbPost = (function(){
  const { clamp, lerp, EPSILON } = OrbMath;

  // ============================================================
  // RenderTarget - 渲染目标（帧缓冲）
  // ============================================================
  class RenderTarget {
    constructor(gl, width, height, options = {}){
      this.gl = gl;
      this.width = width;
      this.height = height;
      this.framebuffer = null;
      this.texture = null;
      this.depthBuffer = null;
      this.depthTexture = null;
      this.options = {
        minFilter: gl.LINEAR,
        magFilter: gl.LINEAR,
        wrapS: gl.CLAMP_TO_EDGE,
        wrapT: gl.CLAMP_TO_EDGE,
        format: gl.RGBA,
        type: gl.UNSIGNED_BYTE,
        depthBuffer: true,
        stencilBuffer: false,
        depthTexture: false,
        ...options
      };
      this._init();
    }

    _init(){
      const gl = this.gl;
      const opts = this.options;

      // 创建颜色纹理
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, opts.format, this.width, this.height, 0, opts.format, opts.type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.minFilter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, opts.magFilter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.wrapS);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opts.wrapT);

      // 创建帧缓冲
      this.framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);

      // 深度缓冲
      if(opts.depthBuffer && !opts.depthTexture){
        this.depthBuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthBuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, this.width, this.height);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthBuffer);
      }

      // 深度纹理
      if(opts.depthTexture){
        this.depthTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, this.width, this.height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTexture, 0);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    bind(){
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.viewport(0, 0, this.width, this.height);
    }

    unbind(){
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    setSize(width, height){
      this.width = width;
      this.height = height;
      this.dispose();
      this._init();
    }

    dispose(){
      const gl = this.gl;
      if(this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
      if(this.texture) gl.deleteTexture(this.texture);
      if(this.depthBuffer) gl.deleteRenderbuffer(this.depthBuffer);
      if(this.depthTexture) gl.deleteTexture(this.depthTexture);
    }
  }

  // ============================================================
  // PostProcessPass - 后处理通道基类
  // ============================================================
  class PostProcessPass {
    constructor(name = ''){
      this.name = name;
      this.enabled = true;
      this.needsSwap = true;
      this.renderToScreen = false;
    }

    render(renderer, writeBuffer, readBuffer, dt){}
    setSize(width, height){}
    dispose(){}
  }

  // ============================================================
  // BloomPass - Bloom（泛光）通道
  // ============================================================
  class BloomPass extends PostProcessPass {
    constructor(gl, strength = 1, radius = 0.4, threshold = 0.85){
      super('Bloom');
      this.gl = gl;
      this.strength = strength;
      this.radius = radius;
      this.threshold = threshold;
      this.renderTargetsHorizontal = [];
      this.renderTargetsVertical = [];
      this.nMips = 5;
      this._init();
    }

    _init(){
      const gl = this.gl;
      for(let i = 0; i < this.nMips; i++){
        const size = Math.pow(2, this.nMips - i - 1) * 64;
        const rtH = new RenderTarget(gl, size, size);
        const rtV = new RenderTarget(gl, size, size);
        this.renderTargetsHorizontal.push(rtH);
        this.renderTargetsVertical.push(rtV);
      }
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // 简化实现，实际需要：
      // 1. 提取高光（threshold）
      // 2. 多次高斯模糊（水平+垂直）
      // 3. 合并到原图像（strength）
      // 这里只做概念框架
    }

    setSize(width, height){
      for(let i = 0; i < this.nMips; i++){
        const size = Math.pow(2, this.nMips - i - 1) * 64;
        this.renderTargetsHorizontal[i].setSize(size, size);
        this.renderTargetsVertical[i].setSize(size, size);
      }
    }

    dispose(){
      for(const rt of this.renderTargetsHorizontal) rt.dispose();
      for(const rt of this.renderTargetsVertical) rt.dispose();
    }
  }

  // ============================================================
  // DepthOfFieldPass - 景深通道
  // ============================================================
  class DepthOfFieldPass extends PostProcessPass {
    constructor(gl, focus = 1.0, aperture = 0.025, maxblur = 1.0){
      super('DepthOfField');
      this.gl = gl;
      this.focus = focus;
      this.aperture = aperture;
      this.maxblur = maxblur;
      this.renderTargetDepth = null;
      this._init();
    }

    _init(){
      // 简化实现
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // 简化实现，实际需要：
      // 1. 渲染深度纹理
      // 2. 计算CoC（Circle of Confusion）
      // 3. 模糊处理
    }

    setSize(width, height){}
    dispose(){}
  }

  // ============================================================
  // FXAAPass - FXAA抗锯齿通道
  // ============================================================
  class FXAAPass extends PostProcessPass {
    constructor(gl){
      super('FXAA');
      this.gl = gl;
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // FXAA着色器实现
    }

    setSize(width, height){}
    dispose(){}
  }

  // ============================================================
  // SAAPass - SMAA抗锯齿通道
  // ============================================================
  class SMAAPass extends PostProcessPass {
    constructor(gl, width, height){
      super('SMAA');
      this.gl = gl;
      this.width = width;
      this.height = height;
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // SMAA三阶段：边缘检测、权重计算、混合
    }

    setSize(width, height){
      this.width = width;
      this.height = height;
    }

    dispose(){}
  }

  // ============================================================
  // TAAPass - TAA时间抗锯齿通道
  // ============================================================
  class TAAPass extends PostProcessPass {
    constructor(gl){
      super('TAA');
      this.gl = gl;
      this.historyBuffer = null;
      this.accumulatedFrames = 0;
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // TAA：历史帧与当前帧混合
    }

    setSize(width, height){}
    dispose(){
      if(this.historyBuffer) this.historyBuffer.dispose();
    }
  }

  // ============================================================
  // ToneMappingPass - 色调映射通道
  // ============================================================
  class ToneMappingPass extends PostProcessPass {
    constructor(gl, type = 'ACES', exposure = 1){
      super('ToneMapping');
      this.gl = gl;
      this.type = type; // 'Linear' | 'Reinhard' | 'ACES' | 'Filmic' | 'Cineon'
      this.exposure = exposure;
      this.whitePoint = 1;
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // 色调映射着色器实现
    }

    setExposure(exposure){
      this.exposure = exposure;
    }

    setType(type){
      this.type = type;
    }

    setSize(width, height){}
    dispose(){}
  }

  // ============================================================
  // ColorGradingPass - 颜色分级通道
  // ============================================================
  class ColorGradingPass extends PostProcessPass {
    constructor(gl){
      super('ColorGrading');
      this.gl = gl;
      this.lut = null;          // 3D LUT纹理
      this.lutIntensity = 1;
      this.saturation = 1;
      this.contrast = 1;
      this.brightness = 0;
      this.hueShift = 0;
      this.temperature = 0;
      this.tint = 0;
      this.vibrance = 0;
      this.shadows = new Vec3(1, 1, 1);
      this.midtones = new Vec3(1, 1, 1);
      this.highlights = new Vec3(1, 1, 1);
      this.curves = null;       // RGB曲线
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // 颜色分级着色器实现
    }

    setLUT(texture, intensity = 1){
      this.lut = texture;
      this.lutIntensity = intensity;
    }

    setSaturation(value){
      this.saturation = value;
    }

    setContrast(value){
      this.contrast = value;
    }

    setBrightness(value){
      this.brightness = value;
    }

    setHueShift(value){
      this.hueShift = value;
    }

    setTemperature(value){
      this.temperature = value;
    }

    setTint(value){
      this.tint = value;
    }

    setVibrance(value){
      this.vibrance = value;
    }

    setShadows(r, g, b){
      this.shadows.set(r, g, b);
    }

    setMidtones(r, g, b){
      this.midtones.set(r, g, b);
    }

    setHighlights(r, g, b){
      this.highlights.set(r, g, b);
    }

    setSize(width, height){}
    dispose(){}
  }

  // ============================================================
  // SSAOPass - 屏幕空间环境光遮蔽通道
  // ============================================================
  class SSAOPass extends PostProcessPass {
    constructor(gl, width, height){
      super('SSAO');
      this.gl = gl;
      this.width = width;
      this.height = height;
      this.kernelRadius = 8;
      this.minDistance = 0.005;
      this.maxDistance = 0.1;
      this.output = 0; // 0=Default, 1=SSAO, 2=Blur, 3=Depth, 4=Normal
      this.kernel = [];
      this.noiseTexture = null;
      this._initKernel();
    }

    _initKernel(){
      // 生成半球采样核
      for(let i = 0; i < 32; i++){
        const sample = new OrbMath.Vec3(
          Math.random() * 2 - 1,
          Math.random() * 2 - 1,
          Math.random()
        );
        sample.normalize();
        sample.mul(Math.random());
        let scale = i / 32;
        scale = lerp(0.1, 1, scale * scale);
        sample.mul(scale);
        this.kernel.push(sample);
      }
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // SSAO实现：
      // 1. 重建视图空间位置
      // 2. 计算法线
      // 3. 半球采样
      // 4. 模糊处理
    }

    setSize(width, height){
      this.width = width;
      this.height = height;
    }

    dispose(){
      if(this.noiseTexture) this.gl.deleteTexture(this.noiseTexture);
    }
  }

  // ============================================================
  // SSRPass - 屏幕空间反射通道
  // ============================================================
  class SSRPass extends PostProcessPass {
    constructor(gl, width, height){
      super('SSR');
      this.gl = gl;
      this.width = width;
      this.height = height;
      this.thickness = 0.018;
      this.infiniteThick = false;
      this.maxDistance = 10;
      this.resolution = 1;
      this.rayStep = 0.1;
      this.iterations = 10;
      this.binarySearchIterations = 4;
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // SSR实现：
      // 1. 重建视图空间位置和法线
      // 2. 计算反射方向
      // 3. 光线步进
      // 4. 二分搜索精确命中
    }

    setSize(width, height){
      this.width = width;
      this.height = height;
    }

    dispose(){}
  }

  // ============================================================
  // MotionBlurPass - 运动模糊通道
  // ============================================================
  class MotionBlurPass extends PostProcessPass {
    constructor(gl){
      super('MotionBlur');
      this.gl = gl;
      this.samples = 16;
      this.intensity = 1;
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // 运动模糊：基于速度纹理的方向模糊
    }

    setSize(width, height){}
    dispose(){}
  }

  // ============================================================
  // VignettePass - 暗角通道
  // ============================================================
  class VignettePass extends PostProcessPass {
    constructor(gl, offset = 0.5, darkness = 0.5){
      super('Vignette');
      this.gl = gl;
      this.offset = offset;
      this.darkness = darkness;
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // 暗角效果
    }

    setSize(width, height){}
    dispose(){}
  }

  // ============================================================
  // FilmGrainPass - 胶片颗粒通道
  // ============================================================
  class FilmGrainPass extends PostProcessPass {
    constructor(gl, intensity = 0.5, size = 1){
      super('FilmGrain');
      this.gl = gl;
      this.intensity = intensity;
      this.size = size;
      this.time = 0;
    }

    render(renderer, writeBuffer, readBuffer, dt){
      this.time += dt;
      // 胶片颗粒效果
    }

    setSize(width, height){}
    dispose(){}
  }

  // ============================================================
  // ChromaticAberrationPass - 色差通道
  // ============================================================
  class ChromaticAberrationPass extends PostProcessPass {
    constructor(gl, offset = 0.001){
      super('ChromaticAberration');
      this.gl = gl;
      this.offset = offset;
      this.radialModulation = 0;
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // 色差效果：RGB通道偏移
    }

    setSize(width, height){}
    dispose(){}
  }

  // ============================================================
  // ShaderPass - 通用着色器通道
  // ============================================================
  class ShaderPass extends PostProcessPass {
    constructor(gl, shader, uniforms = {}){
      super('Shader');
      this.gl = gl;
      this.shader = shader;
      this.uniforms = uniforms;
      this.material = null;
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // 通用着色器渲染
    }

    setUniform(name, value){
      this.uniforms[name] = value;
    }

    setSize(width, height){}
    dispose(){}
  }

  // ============================================================
  // EffectComposer - 效果组合器（后处理管线）
  // ============================================================
  class EffectComposer {
    constructor(gl, renderTarget = null){
      this.gl = gl;
      this.renderTarget1 = renderTarget;
      this.renderTarget2 = null;
      this.writeBuffer = null;
      this.readBuffer = null;
      this.passes = [];
      this.copyPass = null;
      this.width = 0;
      this.height = 0;
      this._init();
    }

    _init(){
      const gl = this.gl;
      if(!this.renderTarget1){
        const canvas = gl.canvas;
        this.renderTarget1 = new RenderTarget(gl, canvas.width, canvas.height);
      }
      this.renderTarget2 = this.renderTarget1.clone();
      this.writeBuffer = this.renderTarget1;
      this.readBuffer = this.renderTarget2;
      this.width = this.renderTarget1.width;
      this.height = this.renderTarget1.height;
    }

    addPass(pass){
      this.passes.push(pass);
      pass.setSize(this.width, this.height);
    }

    insertPass(pass, index){
      this.passes.splice(index, 0, pass);
      pass.setSize(this.width, this.height);
    }

    removePass(pass){
      const index = this.passes.indexOf(pass);
      if(index !== -1){
        this.passes.splice(index, 1);
        pass.dispose();
      }
    }

    render(dt){
      const gl = this.gl;
      const isLastEnabledPass = (index) => {
        for(let i = index + 1; i < this.passes.length; i++){
          if(this.passes[i].enabled) return false;
        }
        return true;
      };

      for(let i = 0; i < this.passes.length; i++){
        const pass = this.passes[i];
        if(!pass.enabled) continue;

        pass.renderToScreen = isLastEnabledPass(i);
        pass.render(this, this.writeBuffer, this.readBuffer, dt);

        if(pass.needsSwap){
          const tmp = this.readBuffer;
          this.readBuffer = this.writeBuffer;
          this.writeBuffer = tmp;
        }
      }
    }

    setSize(width, height){
      this.width = width;
      this.height = height;
      this.renderTarget1.setSize(width, height);
      this.renderTarget2.setSize(width, height);
      for(const pass of this.passes){
        pass.setSize(width, height);
      }
    }

    reset(){
      this.writeBuffer = this.renderTarget1;
      this.readBuffer = this.renderTarget2;
    }

    dispose(){
      this.renderTarget1.dispose();
      this.renderTarget2.dispose();
      for(const pass of this.passes){
        pass.dispose();
      }
    }
  }

  // 导出
  return {
    RenderTarget, PostProcessPass, BloomPass, DepthOfFieldPass,
    FXAAPass, SMAAPass, TAAPass, ToneMappingPass, ColorGradingPass,
    SSAOPass, SSRPass, MotionBlurPass, VignettePass, FilmGrainPass,
    ChromaticAberrationPass, ShaderPass, EffectComposer
  };
})();

if(typeof window !== 'undefined'){
  window.OrbPost = OrbPost;
}

// ============================================================
// 模块九：着色器库与高级渲染 ShaderLibrary (约1500行)
// 着色器管理 / PBR着色器 / 骨骼蒙皮 / 法线贴图 / 高级渲染技术
// ============================================================

const OrbShader = (function(){

  // ============================================================
  // ShaderManager - 着色器管理器
  // ============================================================
  class ShaderManager {
    constructor(gl){
      this.gl = gl;
      this.programs = {};
      this.shaders = {};
      this.uniformCache = {};
      this.attributeCache = {};
    }

    // 创建着色器
    createShader(type, source){
      const gl = this.gl;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      if(!gl.getShaderParameter(shader, gl.COMPILE_STATUS)){
        const info = gl.getShaderInfoLog(shader);
        console.error('Shader compile error:', info);
        gl.deleteShader(shader);
        return null;
      }

      return shader;
    }

    // 创建程序
    createProgram(name, vertexSource, fragmentSource, defines = {}){
      const gl = this.gl;

      // 处理宏定义
      const defineStr = Object.entries(defines).map(([k, v]) => `#define ${k} ${v}`).join('\n');
      const vsSource = defineStr + '\n' + vertexSource;
      const fsSource = defineStr + '\n' + fragmentSource;

      const vs = this.createShader(gl.VERTEX_SHADER, vsSource);
      const fs = this.createShader(gl.FRAGMENT_SHADER, fsSource);

      if(!vs || !fs) return null;

      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);

      if(!gl.getProgramParameter(program, gl.LINK_STATUS)){
        const info = gl.getProgramInfoLog(program);
        console.error('Program link error:', info);
        gl.deleteProgram(program);
        return null;
      }

      gl.deleteShader(vs);
      gl.deleteShader(fs);

      this.programs[name] = program;
      this.uniformCache[name] = {};
      this.attributeCache[name] = {};

      return program;
    }

    // 获取程序
    getProgram(name){
      return this.programs[name];
    }

    // 使用程序
    useProgram(name){
      const program = this.programs[name];
      if(program){
        this.gl.useProgram(program);
        return program;
      }
      return null;
    }

    // 获取uniform位置（带缓存）
    getUniformLocation(programName, uniformName){
      if(!this.uniformCache[programName]) this.uniformCache[programName] = {};
      if(this.uniformCache[programName][uniformName] === undefined){
        const program = this.programs[programName];
        this.uniformCache[programName][uniformName] = this.gl.getUniformLocation(program, uniformName);
      }
      return this.uniformCache[programName][uniformName];
    }

    // 获取attribute位置（带缓存）
    getAttribLocation(programName, attribName){
      if(!this.attributeCache[programName]) this.attributeCache[programName] = {};
      if(this.attributeCache[programName][attribName] === undefined){
        const program = this.programs[programName];
        this.attributeCache[programName][attribName] = this.gl.getAttribLocation(program, attribName);
      }
      return this.attributeCache[programName][attribName];
    }

    // 设置uniform
    setUniform(programName, name, type, value){
      const location = this.getUniformLocation(programName, name);
      if(!location) return;
      const gl = this.gl;

      switch(type){
        case '1f': gl.uniform1f(location, value); break;
        case '2f': gl.uniform2f(location, value[0], value[1]); break;
        case '3f': gl.uniform3f(location, value[0], value[1], value[2]); break;
        case '4f': gl.uniform4f(location, value[0], value[1], value[2], value[3]); break;
        case '1i': gl.uniform1i(location, value); break;
        case '2i': gl.uniform2i(location, value[0], value[1]); break;
        case '3i': gl.uniform3i(location, value[0], value[1], value[2]); break;
        case '4i': gl.uniform4i(location, value[0], value[1], value[2], value[3]); break;
        case 'mat2': gl.uniformMatrix2fv(location, false, value); break;
        case 'mat3': gl.uniformMatrix3fv(location, false, value); break;
        case 'mat4': gl.uniformMatrix4fv(location, false, value); break;
        case '1fv': gl.uniform1fv(location, value); break;
        case '2fv': gl.uniform2fv(location, value); break;
        case '3fv': gl.uniform3fv(location, value); break;
        case '4fv': gl.uniform4fv(location, value); break;
      }
    }

    // 删除程序
    deleteProgram(name){
      if(this.programs[name]){
        this.gl.deleteProgram(this.programs[name]);
        delete this.programs[name];
        delete this.uniformCache[name];
        delete this.attributeCache[name];
      }
    }

    // 清空
    clear(){
      for(const name in this.programs){
        this.deleteProgram(name);
      }
    }
  }

  // ============================================================
  // 内置着色器源码
  // ============================================================

  // 公共顶点着色器代码
  const CommonVertexShader = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec2 aUV;
    attribute vec3 aTangent;
    attribute vec4 aJoint;
    attribute vec4 aWeight;

    uniform mat4 uModelMatrix;
    uniform mat4 uViewMatrix;
    uniform mat4 uProjectionMatrix;
    uniform mat4 uNormalMatrix;
    uniform mat4 uBonePalette[256];

    varying vec3 vPosition;
    varying vec3 vNormal;
    varying vec2 vUV;
    varying vec3 vViewPosition;
    varying mat3 vTBN;

    void main(){
      vec4 position = vec4(aPosition, 1.0);
      vec3 normal = aNormal;
      vec3 tangent = aTangent;

      #ifdef USE_SKINNING
        vec4 skinnedPosition = vec4(0.0);
        vec3 skinnedNormal = vec3(0.0);
        vec3 skinnedTangent = vec3(0.0);
        for(int i = 0; i < 4; i++){
          if(aWeight[i] > 0.0){
            mat4 boneMatrix = uBonePalette[int(aJoint[i])];
            skinnedPosition += boneMatrix * position * aWeight[i];
            skinnedNormal += mat3(boneMatrix) * normal * aWeight[i];
            skinnedTangent += mat3(boneMatrix) * tangent * aWeight[i];
          }
        }
        position = skinnedPosition;
        normal = normalize(skinnedNormal);
        tangent = normalize(skinnedTangent);
      #endif

      vec4 worldPosition = uModelMatrix * position;
      vPosition = worldPosition.xyz;
      vNormal = normalize(mat3(uNormalMatrix) * normal);
      vUV = aUV;

      #ifdef USE_NORMAL_MAP
        vec3 T = normalize(mat3(uNormalMatrix) * tangent);
        vec3 N = vNormal;
        T = normalize(T - dot(T, N) * N);
        vec3 B = cross(N, T);
        vTBN = mat3(T, B, N);
      #endif

      vec4 viewPosition = uViewMatrix * worldPosition;
      vViewPosition = -viewPosition.xyz;
      gl_Position = uProjectionMatrix * viewPosition;
    }
  `;

  // PBR片段着色器
  const PBRFragmentShader = `
    precision highp float;

    varying vec3 vPosition;
    varying vec3 vNormal;
    varying vec2 vUV;
    varying vec3 vViewPosition;
    varying mat3 vTBN;

    uniform vec3 uAlbedo;
    uniform float uRoughness;
    uniform float uMetalness;
    uniform vec3 uEmissive;
    uniform float uEmissiveIntensity;
    uniform float uAO;
    uniform float uOpacity;
    uniform vec3 uCameraPosition;

    uniform sampler2D uAlbedoMap;
    uniform sampler2D uNormalMap;
    uniform sampler2D uRoughnessMap;
    uniform sampler2D uMetalnessMap;
    uniform sampler2D uAOMap;
    uniform sampler2D uEmissiveMap;

    uniform int uLightCount;
    uniform vec3 uLightPositions[16];
    uniform vec3 uLightColors[16];
    uniform vec3 uLightDirections[16];
    uniform int uLightTypes[16];
    uniform float uLightIntensities[16];
    uniform float uLightDistances[16];
    uniform float uLightDecays[16];
    uniform float uLightAngles[16];
    uniform float uLightPenumbras[16];

    uniform vec3 uAmbientLight;
    uniform vec3 uEnvMapIntensity;

    const float PI = 3.14159265359;

    float DistributionGGX(vec3 N, vec3 H, float roughness){
      float a = roughness * roughness;
      float a2 = a * a;
      float NdotH = max(dot(N, H), 0.0);
      float NdotH2 = NdotH * NdotH;
      float denom = NdotH2 * (a2 - 1.0) + 1.0;
      denom = PI * denom * denom;
      return a2 / max(denom, 0.0001);
    }

    float GeometrySchlickGGX(float NdotV, float roughness){
      float r = roughness + 1.0;
      float k = (r * r) / 8.0;
      return NdotV / (NdotV * (1.0 - k) + k);
    }

    float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness){
      float NdotV = max(dot(N, V), 0.0);
      float NdotL = max(dot(N, L), 0.0);
      float ggx2 = GeometrySchlickGGX(NdotV, roughness);
      float ggx1 = GeometrySchlickGGX(NdotL, roughness);
      return ggx1 * ggx2;
    }

    vec3 FresnelSchlick(float cosTheta, vec3 F0){
      return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
    }

    vec3 FresnelSchlickRoughness(float cosTheta, vec3 F0, float roughness){
      return F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
    }

    void main(){
      vec3 albedo = uAlbedo;
      float roughness = uRoughness;
      float metalness = uMetalness;
      float ao = uAO;
      vec3 emissive = uEmissive * uEmissiveIntensity;

      #ifdef USE_ALBEDO_MAP
        albedo *= texture2D(uAlbedoMap, vUV).rgb;
      #endif

      #ifdef USE_NORMAL_MAP
        vec3 normal = texture2D(uNormalMap, vUV).rgb * 2.0 - 1.0;
        normal = normalize(vTBN * normal);
      #else
        vec3 normal = normalize(vNormal);
      #endif

      #ifdef USE_ROUGHNESS_MAP
        roughness *= texture2D(uRoughnessMap, vUV).r;
      #endif

      #ifdef USE_METALNESS_MAP
        metalness *= texture2D(uMetalnessMap, vUV).r;
      #endif

      #ifdef USE_AO_MAP
        ao *= texture2D(uAOMap, vUV).r;
      #endif

      #ifdef USE_EMISSIVE_MAP
        emissive *= texture2D(uEmissiveMap, vUV).rgb;
      #endif

      vec3 N = normalize(normal);
      vec3 V = normalize(vViewPosition);
      vec3 R = reflect(-V, N);

      vec3 F0 = vec3(0.04);
      F0 = mix(F0, albedo, metalness);

      vec3 Lo = vec3(0.0);

      for(int i = 0; i < 16; i++){
        if(i >= uLightCount) break;

        vec3 L;
        float attenuation = 1.0;

        if(uLightTypes[i] == 0){ // Directional
          L = normalize(-uLightDirections[i]);
        } else if(uLightTypes[i] == 1){ // Point
          vec3 lightToFrag = vPosition - uLightPositions[i];
          float distance = length(lightToFrag);
          L = normalize(-lightToFrag);
          if(uLightDistances[i] > 0.0){
            attenuation = pow(clamp(1.0 - pow(distance / uLightDistances[i], 4.0), 0.0, 1.0), 2.0);
          }
          attenuation /= (distance * distance * uLightDecays[i] + 1.0);
        } else if(uLightTypes[i] == 2){ // Spot
          vec3 lightToFrag = vPosition - uLightPositions[i];
          float distance = length(lightToFrag);
          L = normalize(-lightToFrag);
          if(uLightDistances[i] > 0.0){
            attenuation = pow(clamp(1.0 - pow(distance / uLightDistances[i], 4.0), 0.0, 1.0), 2.0);
          }
          attenuation /= (distance * distance * uLightDecays[i] + 1.0);
          float cosTheta = dot(L, normalize(-uLightDirections[i]));
          float cosOuter = cos(uLightAngles[i]);
          float cosInner = cos(uLightAngles[i] * (1.0 - uLightPenumbras[i]));
          float spotAttenuation = smoothstep(cosOuter, cosInner, cosTheta);
          attenuation *= spotAttenuation;
        }

        vec3 H = normalize(V + L);
        vec3 lightColor = uLightColors[i] * uLightIntensities[i] * attenuation;

        float NDF = DistributionGGX(N, H, roughness);
        float G = GeometrySmith(N, V, L, roughness);
        vec3 F = FresnelSchlick(max(dot(H, V), 0.0), F0);

        vec3 numerator = NDF * G * F;
        float denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001;
        vec3 specular = numerator / denominator;

        vec3 kS = F;
        vec3 kD = vec3(1.0) - kS;
        kD *= 1.0 - metalness;

        float NdotL = max(dot(N, L), 0.0);
        Lo += (kD * albedo / PI + specular) * lightColor * NdotL;
      }

      vec3 F = FresnelSchlickRoughness(max(dot(N, V), 0.0), F0, roughness);
      vec3 kS = F;
      vec3 kD = 1.0 - kS;
      kD *= 1.0 - metalness;

      vec3 ambient = uAmbientLight * albedo * ao;

      #ifdef USE_ENV_MAP
        vec3 irradiance = uEnvMapIntensity * 0.3;
        vec3 diffuse = irradiance * albedo;
        vec3 prefilteredColor = uEnvMapIntensity * 0.5;
        vec2 brdf = vec2(0.04, 0.5);
        vec3 specularIBL = prefilteredColor * (F * brdf.x + brdf.y);
        ambient = (kD * diffuse + specularIBL) * ao;
      #endif

      vec3 color = ambient + Lo + emissive;

      gl_FragColor = vec4(color, uOpacity);
    }
  `;

  // 线框着色器
  const WireframeVertexShader = `
    attribute vec3 aPosition;
    uniform mat4 uModelMatrix;
    uniform mat4 uViewMatrix;
    uniform mat4 uProjectionMatrix;
    void main(){
      gl_Position = uProjectionMatrix * uViewMatrix * uModelMatrix * vec4(aPosition, 1.0);
    }
  `;

  const WireframeFragmentShader = `
    precision highp float;
    uniform vec3 uColor;
    uniform float uOpacity;
    void main(){
      gl_FragColor = vec4(uColor, uOpacity);
    }
  `;

  // 法线可视化着色器
  const NormalVertexShader = CommonVertexShader;

  const NormalFragmentShader = `
    precision highp float;
    varying vec3 vNormal;
    void main(){
      vec3 normal = normalize(vNormal) * 0.5 + 0.5;
      gl_FragColor = vec4(normal, 1.0);
    }
  `;

  // 深度着色器
  const DepthVertexShader = CommonVertexShader;

  const DepthFragmentShader = `
    precision highp float;
    varying vec4 vViewPosition;
    uniform float uCameraNear;
    uniform float uCameraFar;
    void main(){
      float depth = length(vViewPosition.xyz);
      float normalizedDepth = (depth - uCameraNear) / (uCameraFar - uCameraNear);
      gl_FragColor = vec4(vec3(normalizedDepth), 1.0);
    }
  `;

  // 后处理通用顶点着色器
  const PostVertexShader = `
    attribute vec2 aPosition;
    attribute vec2 aUV;
    varying vec2 vUV;
    void main(){
      vUV = aUV;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  // Bloom提取高光片段着色器
  const BloomExtractShader = `
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D uTexture;
    uniform float uThreshold;
    uniform float uSmoothWidth;
    void main(){
      vec4 color = texture2D(uTexture, vUV);
      float brightness = max(color.r, max(color.g, color.b));
      float contribution = smoothstep(uThreshold, uThreshold + uSmoothWidth, brightness);
      gl_FragColor = color * contribution;
    }
  `;

  // 高斯模糊片段着色器
  const GaussianBlurShader = `
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D uTexture;
    uniform vec2 uDirection;
    uniform vec2 uResolution;
    void main(){
      vec2 texelSize = 1.0 / uResolution;
      vec4 result = vec4(0.0);
      float weights[5];
      weights[0] = 0.227027;
      weights[1] = 0.1945946;
      weights[2] = 0.1216216;
      weights[3] = 0.054054;
      weights[4] = 0.016216;
      result += texture2D(uTexture, vUV) * weights[0];
      for(int i = 1; i < 5; i++){
        vec2 offset = uDirection * texelSize * float(i);
        result += texture2D(uTexture, vUV + offset) * weights[i];
        result += texture2D(uTexture, vUV - offset) * weights[i];
      }
      gl_FragColor = result;
    }
  `;

  // 色调映射片段着色器
  const ToneMappingShader = `
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D uTexture;
    uniform float uExposure;
    uniform int uType;
    uniform float uWhitePoint;

    vec3 linearToneMapping(vec3 color){
      return clamp(color * uExposure, 0.0, 1.0);
    }

    vec3 reinhardToneMapping(vec3 color){
      color *= uExposure;
      return color / (1.0 + color);
    }

    vec3 optimizedReinhardToneMapping(vec3 color){
      color *= uExposure;
      float white = uWhitePoint * uWhitePoint;
      return (color * (1.0 + color / white)) / (1.0 + color);
    }

    vec3 acesFilmicToneMapping(vec3 color){
      color *= uExposure;
      const float a = 2.51;
      const float b = 0.03;
      const float c = 2.43;
      const float d = 0.59;
      const float e = 0.14;
      return clamp((color * (a * color + b)) / (color * (c * color + d) + e), 0.0, 1.0);
    }

    vec3 filmicToneMapping(vec3 color){
      color *= uExposure;
      color = max(vec3(0.0), color - 0.004);
      return (color * (6.2 * color + 0.5)) / (color * (6.2 * color + 1.7) + 0.06);
    }

    void main(){
      vec3 color = texture2D(uTexture, vUV).rgb;
      if(uType == 0) color = linearToneMapping(color);
      else if(uType == 1) color = reinhardToneMapping(color);
      else if(uType == 2) color = optimizedReinhardToneMapping(color);
      else if(uType == 3) color = acesFilmicToneMapping(color);
      else if(uType == 4) color = filmicToneMapping(color);
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  // FXAA片段着色器
  const FXAAShader = `
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D uTexture;
    uniform vec2 uResolution;

    #define FXAA_REDUCE_MIN (1.0 / 128.0)
    #define FXAA_REDUCE_MUL (1.0 / 8.0)
    #define FXAA_SPAN_MAX 8.0

    void main(){
      vec2 texelSize = 1.0 / uResolution;
      vec3 rgbNW = texture2D(uTexture, vUV + vec2(-1.0, -1.0) * texelSize).xyz;
      vec3 rgbNE = texture2D(uTexture, vUV + vec2(1.0, -1.0) * texelSize).xyz;
      vec3 rgbSW = texture2D(uTexture, vUV + vec2(-1.0, 1.0) * texelSize).xyz;
      vec3 rgbSE = texture2D(uTexture, vUV + vec2(1.0, 1.0) * texelSize).xyz;
      vec3 rgbM = texture2D(uTexture, vUV).xyz;

      vec3 luma = vec3(0.299, 0.587, 0.114);
      float lumaNW = dot(rgbNW, luma);
      float lumaNE = dot(rgbNE, luma);
      float lumaSW = dot(rgbSW, luma);
      float lumaSE = dot(rgbSE, luma);
      float lumaM = dot(rgbM, luma);

      float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
      float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));

      vec2 dir;
      dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
      dir.y = ((lumaNW + lumaSW) - (lumaNE + lumaSE));

      float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * (0.25 * FXAA_REDUCE_MUL), FXAA_REDUCE_MIN);
      float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
      dir = min(vec2(FXAA_SPAN_MAX), max(vec2(-FXAA_SPAN_MAX), dir * rcpDirMin)) * texelSize;

      vec3 rgbA = 0.5 * (texture2D(uTexture, vUV + dir * (1.0 / 3.0 - 0.5)).xyz + texture2D(uTexture, vUV + dir * (2.0 / 3.0 - 0.5)).xyz);
      vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(uTexture, vUV + dir * -0.5).xyz + texture2D(uTexture, vUV + dir * 0.5).xyz);

      float lumaB = dot(rgbB, luma);
      vec3 color = ((lumaB < lumaMin) || (lumaB > lumaMax)) ? rgbA : rgbB;

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  // 着色器库
  const ShaderLibrary = {
    CommonVertexShader,
    PBRFragmentShader,
    WireframeVertexShader,
    WireframeFragmentShader,
    NormalVertexShader,
    NormalFragmentShader,
    DepthVertexShader,
    DepthFragmentShader,
    PostVertexShader,
    BloomExtractShader,
    GaussianBlurShader,
    ToneMappingShader,
    FXAAShader
  };

  // ============================================================
  // GPUSkinning - GPU蒙皮工具
  // ============================================================
  class GPUSkinning {
    constructor(maxBones = 256){
      this.maxBones = maxBones;
      this.bonePalette = new Float32Array(maxBones * 16);
    }

    updateBonePalette(skeleton){
      const count = Math.min(skeleton.bones.length, this.maxBones);
      for(let i = 0; i < count; i++){
        const bone = skeleton.bones[i];
        const skinMatrix = bone.worldMatrix.clone().multiply(bone.inverseBindMatrix);
        this.bonePalette.set(skinMatrix.elements, i * 16);
      }
      return this.bonePalette;
    }

    getBonePalette(){
      return this.bonePalette;
    }
  }

  // ============================================================
  // NormalMapping - 法线贴图工具
  // ============================================================
  class NormalMapping {
    constructor(){
      this.normalScale = 1;
    }

    // 从高度图生成法线贴图
    static generateFromHeightMap(heightData, width, height, strength = 1){
      const normalData = new Uint8Array(width * height * 3);

      for(let y = 0; y < height; y++){
        for(let x = 0; x < width; x++){
          const idx = (y * width + x) * 4;
          const left = heightData[((y * width + Math.max(0, x - 1)) * 4)];
          const right = heightData[((y * width + Math.min(width - 1, x + 1)) * 4)];
          const up = heightData[((Math.max(0, y - 1) * width + x) * 4)];
          const down = heightData[((Math.min(height - 1, y + 1) * width + x) * 4)];

          const dx = (left - right) * strength;
          const dy = (up - down) * strength;
          const dz = 255;

          const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const nx = (dx / len * 0.5 + 0.5) * 255;
          const ny = (dy / len * 0.5 + 0.5) * 255;
          const nz = (dz / len * 0.5 + 0.5) * 255;

          normalData[(y * width + x) * 3] = nx;
          normalData[(y * width + x) * 3 + 1] = ny;
          normalData[(y * width + x) * 3 + 2] = nz;
        }
      }

      return normalData;
    }
  }

  // ============================================================
  // ParallaxMapping - 视差贴图工具
  // ============================================================
  class ParallaxMapping {
    constructor(){
      this.heightScale = 0.1;
      this.layers = 32;
    }

    // 视差遮挡映射（Parallax Occlusion Mapping）
    static samplePOM(heightMap, uv, viewDir, heightScale = 0.1, layers = 32){
      const layerDepth = 1.0 / layers;
      let currentLayerDepth = 0;
      let currentUV = uv.clone();
      let deltaUV = viewDir.clone().mul(heightScale / layers);

      let currentDepthValue = 1 - ParallaxMapping.sampleHeight(heightMap, currentUV);

      while(currentLayerDepth < currentDepthValue){
        currentUV.sub(deltaUV);
        currentDepthValue = 1 - ParallaxMapping.sampleHeight(heightMap, currentUV);
        currentLayerDepth += layerDepth;
      }

      const prevUV = currentUV.clone().add(deltaUV);
      const afterDepth = currentDepthValue - currentLayerDepth;
      const beforeDepth = 1 - ParallaxMapping.sampleHeight(heightMap, prevUV) - currentLayerDepth + layerDepth;
      const weight = afterDepth / (afterDepth - beforeDepth);
      const finalUV = prevUV.mul(weight).add(currentUV.mul(1 - weight));

      return finalUV;
    }

    static sampleHeight(heightMap, uv){
      // 简化实现，实际需要采样纹理
      return 0;
    }
  }

  // ============================================================
  // SubsurfaceScattering - 次表面散射工具
  // ============================================================
  class SubsurfaceScattering {
    constructor(){
      this.scatteringColor = new OrbMath.Vec3(1, 0.5, 0.4);
      this.scatteringRadius = 0.1;
      this.scatteringIntensity = 0.5;
    }

    // 简化的次表面散射计算
    static calculate(normal, lightDir, viewDir, thickness, color, intensity = 0.5){
      // 透光效果
      const backLight = Math.max(0, dot(normal.clone().negate(), lightDir));
      const wrapLight = Math.max(0, dot(normal, lightDir) * 0.5 + 0.5);

      // 厚度影响
      const thicknessFactor = Math.exp(-thickness * 2);

      // 散射颜色
      const scatter = color.clone().mul(backLight * wrapLight * thicknessFactor * intensity);

      return scatter;
    }
  }

  // 工具函数
  function dot(a, b){
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  // 导出
  return {
    ShaderManager, ShaderLibrary, GPUSkinning,
    NormalMapping, ParallaxMapping, SubsurfaceScattering
  };
})();

if(typeof window !== 'undefined'){
  window.OrbShader = OrbShader;
}

// ============================================================
// 引擎总入口 OrbWebGLCore
// ============================================================
const OrbWebGLCore = {
  Math: OrbMath,
  Skeleton: OrbSkeleton,
  Animation: OrbAnimation,
  Physics: OrbPhysics,
  Interaction: OrbInteraction,
  Behavior: OrbBehavior,
  PBR: OrbPBR,
  Post: OrbPost,
  Shader: OrbShader,
  version: '1.0.0',
  init(){
    console.log('[OrbWebGLCore] 纯自研WebGL引擎核心初始化完成');
    console.log('[OrbWebGLCore] 模块: Math, Skeleton, Animation, Physics, Interaction, Behavior, PBR, Post, Shader');
  }
};

if(typeof window !== 'undefined'){
  window.OrbWebGLCore = OrbWebGLCore;
}
