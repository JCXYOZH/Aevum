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