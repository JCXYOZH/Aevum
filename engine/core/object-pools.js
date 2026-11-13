/**
 * 前端引擎核心优化模块
 * 包含：对象池、数据结构优化、热路径优化、SIMD-like操作、缓存友好设计
 * 零依赖，纯原生实现
 * @version 2.0.0
 */

'use strict';

const OrbCoreOpt = (function () {

  // ============================================================
  // 对象池 - 减少GC压力
  // ============================================================
  class ObjectPool {
    constructor(factory, resetFn, initialSize = 64, maxSize = 4096) {
      this._factory = factory;
      this._resetFn = resetFn;
      this._pool = [];
      this._maxSize = maxSize;
      this._created = 0;
      this._borrowed = 0;
      this._peakBorrowed = 0;
      for (let i = 0; i < initialSize; i++) {
        this._pool.push(this._factory());
        this._created++;
      }
    }

    acquire() {
      let obj;
      if (this._pool.length > 0) {
        obj = this._pool.pop();
      } else {
        obj = this._factory();
        this._created++;
      }
      this._borrowed++;
      if (this._borrowed > this._peakBorrowed) this._peakBorrowed = this._borrowed;
      return obj;
    }

    release(obj) {
      if (this._resetFn) this._resetFn(obj);
      if (this._pool.length < this._maxSize) {
        this._pool.push(obj);
      }
      this._borrowed--;
    }

    prewarm(count) {
      while (this._pool.length < count && this._pool.length < this._maxSize) {
        this._pool.push(this._factory());
        this._created++;
      }
    }

    shrink() {
      const target = Math.floor(this._peakBorrowed * 1.5);
      while (this._pool.length > target) this._pool.pop();
    }

    clear() { this._pool.length = 0; }
    getStats() {
      return {
        created: this._created,
        inPool: this._pool.length,
        borrowed: this._borrowed,
        peakBorrowed: this._peakBorrowed,
        maxSize: this._maxSize
      };
    }
  }

  // ============================================================
  //  typed array 池 - 高性能数值数组复用
  // ============================================================
  class TypedArrayPool {
    constructor() {
      this._pools = new Map();
      this._types = {
        Float32: Float32Array,
        Float64: Float64Array,
        Int32: Int32Array,
        Uint32: Uint32Array,
        Int16: Int16Array,
        Uint16: Uint16Array,
        Int8: Int8Array,
        Uint8: Uint8Array,
        Uint8Clamped: Uint8ClampedArray
      };
    }

    _getKey(type, size) { return `${type}_${size}`; }

    acquire(type, size) {
      const key = this._getKey(type, size);
      if (!this._pools.has(key)) this._pools.set(key, []);
      const pool = this._pools.get(key);
      if (pool.length > 0) return pool.pop();
      const Ctor = this._types[type];
      if (!Ctor) throw new Error(`Unknown typed array type: ${type}`);
      return new Ctor(size);
    }

    release(type, size, arr) {
      const key = this._getKey(type, size);
      if (!this._pools.has(key)) this._pools.set(key, []);
      const pool = this._pools.get(key);
      if (pool.length < 256) {
        arr.fill(0);
        pool.push(arr);
      }
    }

    acquireFloat32(size) { return this.acquire('Float32', size); }
    releaseFloat32(size, arr) { this.release('Float32', size, arr); }
    acquireUint16(size) { return this.acquire('Uint16', size); }
    releaseUint16(size, arr) { this.release('Uint16', size, arr); }

    clear() { for (const pool of this._pools.values()) pool.length = 0; }
    getStats() {
      const stats = {};
      for (const [key, pool] of this._pools) stats[key] = pool.length;
      return stats;
    }
  }

  const typedArrayPool = new TypedArrayPool();

  // ============================================================
  // 环形缓冲区 - 高性能队列
  // ============================================================
  class RingBuffer {
    constructor(capacity = 1024) {
      this._capacity = capacity;
      this._buffer = new Array(capacity);
      this._head = 0;
      this._tail = 0;
      this._size = 0;
    }

    push(item) {
      if (this._size === this._capacity) {
        this._grow();
      }
      this._buffer[this._tail] = item;
      this._tail = (this._tail + 1) % this._capacity;
      this._size++;
    }

    pop() {
      if (this._size === 0) return undefined;
      const item = this._buffer[this._head];
      this._buffer[this._head] = undefined;
      this._head = (this._head + 1) % this._capacity;
      this._size--;
      return item;
    }

    peek() { return this._size > 0 ? this._buffer[this._head] : undefined; }
    get size() { return this._size; }
    get capacity() { return this._capacity; }
    isEmpty() { return this._size === 0; }
    isFull() { return this._size === this._capacity; }

    _grow() {
      const newCapacity = this._capacity * 2;
      const newBuffer = new Array(newCapacity);
      for (let i = 0; i < this._size; i++) {
        newBuffer[i] = this._buffer[(this._head + i) % this._capacity];
      }
      this._buffer = newBuffer;
      this._capacity = newCapacity;
      this._head = 0;
      this._tail = this._size;
    }

    clear() {
      this._buffer.fill(undefined);
      this._head = 0;
      this._tail = 0;
      this._size = 0;
    }

    forEach(callback) {
      for (let i = 0; i < this._size; i++) {
        callback(this._buffer[(this._head + i) % this._capacity], i);
      }
    }

    toArray() {
      const arr = [];
      for (let i = 0; i < this._size; i++) {
        arr.push(this._buffer[(this._head + i) % this._capacity]);
      }
      return arr;
    }
  }

  // ============================================================
  // 优先队列 - 基于二叉堆
  // ============================================================
  class PriorityQueue {
    constructor(comparator = (a, b) => a.priority - b.priority) {
      this._heap = [];
      this._comparator = comparator;
    }

    push(item) {
      this._heap.push(item);
      this._siftUp(this._heap.length - 1);
    }

    pop() {
      if (this._heap.length === 0) return undefined;
      const top = this._heap[0];
      const last = this._heap.pop();
      if (this._heap.length > 0) {
        this._heap[0] = last;
        this._siftDown(0);
      }
      return top;
    }

    peek() { return this._heap.length > 0 ? this._heap[0] : undefined; }
    get size() { return this._heap.length; }
    isEmpty() { return this._heap.length === 0; }

    _siftUp(index) {
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (this._comparator(this._heap[index], this._heap[parent]) >= 0) break;
        [this._heap[index], this._heap[parent]] = [this._heap[parent], this._heap[index]];
        index = parent;
      }
    }

    _siftDown(index) {
      const length = this._heap.length;
      while (true) {
        let smallest = index;
        const left = 2 * index + 1;
        const right = 2 * index + 2;
        if (left < length && this._comparator(this._heap[left], this._heap[smallest]) < 0) smallest = left;
        if (right < length && this._comparator(this._heap[right], this._heap[smallest]) < 0) smallest = right;
        if (smallest === index) break;
        [this._heap[index], this._heap[smallest]] = [this._heap[smallest], this._heap[index]];
        index = smallest;
      }
    }

    clear() { this._heap.length = 0; }
    toArray() { return this._heap.slice().sort(this._comparator); }
  }

  // ============================================================
  // 链表 - 频繁插入删除场景
  // ============================================================
  class LinkedListNode {
    constructor(value) {
      this.value = value;
      this.prev = null;
      this.next = null;
    }
  }

  class LinkedList {
    constructor() {
      this.head = null;
      this.tail = null;
      this._size = 0;
    }

    push(value) {
      const node = new LinkedListNode(value);
      if (!this.head) {
        this.head = this.tail = node;
      } else {
        node.prev = this.tail;
        this.tail.next = node;
        this.tail = node;
      }
      this._size++;
      return node;
    }

    pop() {
      if (!this.tail) return undefined;
      const node = this.tail;
      if (node.prev) {
        node.prev.next = null;
        this.tail = node.prev;
      } else {
        this.head = this.tail = null;
      }
      this._size--;
      return node.value;
    }

    shift() {
      if (!this.head) return undefined;
      const node = this.head;
      if (node.next) {
        node.next.prev = null;
        this.head = node.next;
      } else {
        this.head = this.tail = null;
      }
      this._size--;
      return node.value;
    }

    remove(node) {
      if (node.prev) node.prev.next = node.next;
      else this.head = node.next;
      if (node.next) node.next.prev = node.prev;
      else this.tail = node.prev;
      this._size--;
    }

    insertAfter(node, value) {
      const newNode = new LinkedListNode(value);
      newNode.prev = node;
      newNode.next = node.next;
      if (node.next) node.next.prev = newNode;
      else this.tail = newNode;
      node.next = newNode;
      this._size++;
      return newNode;
    }

    get size() { return this._size; }
    isEmpty() { return this._size === 0; }

    forEach(callback) {
      let current = this.head;
      let index = 0;
      while (current) {
        callback(current.value, index);
        current = current.next;
        index++;
      }
    }

    toArray() {
      const arr = [];
      this.forEach(v => arr.push(v));
      return arr;
    }

    clear() {
      this.head = this.tail = null;
      this._size = 0;
    }
  }

  // ============================================================
  //  LRU 缓存
  // ============================================================
  class LRUCache {
    constructor(maxSize = 512) {
      this._maxSize = maxSize;
      this._map = new Map();
      this._list = new LinkedList();
      this._hits = 0;
      this._misses = 0;
    }

    get(key) {
      if (!this._map.has(key)) {
        this._misses++;
        return undefined;
      }
      const entry = this._map.get(key);
      this._list.remove(entry.node);
      entry.node = this._list.push(entry.value);
      this._hits++;
      return entry.value;
    }

    set(key, value) {
      if (this._map.has(key)) {
        const entry = this._map.get(key);
        this._list.remove(entry.node);
        entry.value = value;
        entry.node = this._list.push(value);
      } else {
        if (this._map.size >= this._maxSize) {
          const oldestKey = this._list.shift();
          this._map.delete(oldestKey);
        }
        const node = this._list.push(value);
        this._map.set(key, { value, node });
      }
    }

    has(key) { return this._map.has(key); }
    delete(key) {
      if (this._map.has(key)) {
        const entry = this._map.get(key);
        this._list.remove(entry.node);
        this._map.delete(key);
        return true;
      }
      return false;
    }

    clear() {
      this._map.clear();
      this._list.clear();
      this._hits = 0;
      this._misses = 0;
    }

    get size() { return this._map.size; }
    getStats() {
      const total = this._hits + this._misses;
      return {
        size: this._map.size,
        maxSize: this._maxSize,
        hits: this._hits,
        misses: this._misses,
        hitRate: total > 0 ? this._hits / total : 0
      };
    }
  }

  // ============================================================
  // 位集合 - 高效布尔数组
  // ============================================================
  class BitSet {
    constructor(size = 32) {
      this._size = size;
      this._words = new Uint32Array(Math.ceil(size / 32));
    }

    set(index, value = true) {
      const wordIndex = index >> 5;
      const bitIndex = index & 31;
      if (value) this._words[wordIndex] |= (1 << bitIndex);
      else this._words[wordIndex] &= ~(1 << bitIndex);
    }

    get(index) {
      const wordIndex = index >> 5;
      const bitIndex = index & 31;
      return (this._words[wordIndex] & (1 << bitIndex)) !== 0;
    }

    toggle(index) {
      const wordIndex = index >> 5;
      const bitIndex = index & 31;
      this._words[wordIndex] ^= (1 << bitIndex);
    }

    clear() { this._words.fill(0); }
    get size() { return this._size; }

    count() {
      let count = 0;
      for (let i = 0; i < this._words.length; i++) {
        let w = this._words[i];
        w = w - ((w >> 1) & 0x55555555);
        w = (w & 0x33333333) + ((w >> 2) & 0x33333333);
        w = (w + (w >> 4)) & 0x0F0F0F0F;
        count += (w * 0x01010101) >> 24;
      }
      return count;
    }

    and(other) {
      const result = new BitSet(this._size);
      for (let i = 0; i < this._words.length; i++) {
        result._words[i] = this._words[i] & other._words[i];
      }
      return result;
    }

    or(other) {
      const result = new BitSet(this._size);
      for (let i = 0; i < this._words.length; i++) {
        result._words[i] = this._words[i] | other._words[i];
      }
      return result;
    }

    xor(other) {
      const result = new BitSet(this._size);
      for (let i = 0; i < this._words.length; i++) {
        result._words[i] = this._words[i] ^ other._words[i];
      }
      return result;
    }

    not() {
      const result = new BitSet(this._size);
      for (let i = 0; i < this._words.length; i++) {
        result._words[i] = ~this._words[i];
      }
      return result;
    }

    toArray() {
      const arr = [];
      for (let i = 0; i < this._size; i++) {
        if (this.get(i)) arr.push(i);
      }
      return arr;
    }
  }

  // ============================================================
  // 快速数学工具 - 热路径优化
  // ============================================================
  const FastMath = {
    _sinTable: null,
    _cosTable: null,
    _tableSize: 4096,
    _tableMask: 4095,

    init() {
      this._sinTable = new Float32Array(this._tableSize);
      this._cosTable = new Float32Array(this._tableSize);
      for (let i = 0; i < this._tableSize; i++) {
        const angle = (i / this._tableSize) * Math.PI * 2;
        this._sinTable[i] = Math.sin(angle);
        this._cosTable[i] = Math.cos(angle);
      }
    },

    sin(angle) {
      if (!this._sinTable) this.init();
      const idx = Math.round(((angle % (Math.PI * 2)) / (Math.PI * 2)) * this._tableSize) & this._tableMask;
      return this._sinTable[idx];
    },

    cos(angle) {
      if (!this._cosTable) this.init();
      const idx = Math.round(((angle % (Math.PI * 2)) / (Math.PI * 2)) * this._tableSize) & this._tableMask;
      return this._cosTable[idx];
    },

    fastInvSqrt(x) {
      const buffer = new ArrayBuffer(4);
      const f32 = new Float32Array(buffer);
      const u32 = new Uint32Array(buffer);
      f32[0] = x;
      u32[0] = 0x5f3759df - (u32[0] >> 1);
      let y = f32[0];
      y = y * (1.5 - 0.5 * x * y * y);
      return y;
    },

    clamp(value, min, max) {
      return value < min ? min : (value > max ? max : value);
    },

    lerp(a, b, t) { return a + (b - a) * t; },

    smoothstep(edge0, edge1, x) {
      const t = this.clamp((x - edge0) / (edge1 - edge0), 0, 1);
      return t * t * (3 - 2 * t);
    },

    smootherstep(edge0, edge1, x) {
      const t = this.clamp((x - edge0) / (edge1 - edge0), 0, 1);
      return t * t * t * (t * (t * 6 - 15) + 10);
    },

    degToRad(deg) { return deg * Math.PI / 180; },
    radToDeg(rad) { return rad * 180 / Math.PI; },

    isPowerOfTwo(x) { return (x & (x - 1)) === 0 && x !== 0; },

    nextPowerOfTwo(x) {
      x--;
      x |= x >> 1;
      x |= x >> 2;
      x |= x >> 4;
      x |= x >> 8;
      x |= x >> 16;
      x++;
      return x;
    },

    hash(x, y = 0, z = 0) {
      let h = x * 374761393 + y * 668265263 + z * 2147483647;
      h = (h ^ (h >> 13)) * 1274126177;
      return (h ^ (h >> 16)) >>> 0;
    },

    randomRange(min, max) { return min + Math.random() * (max - min); },

    randomInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); },

    distance(x1, y1, x2, y2) {
      const dx = x2 - x1, dy = y2 - y1;
      return Math.sqrt(dx * dx + dy * dy);
    },

    distance3D(x1, y1, z1, x2, y2, z2) {
      const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    },

    normalizeAngle(angle) {
      while (angle > Math.PI) angle -= Math.PI * 2;
      while (angle < -Math.PI) angle += Math.PI * 2;
      return angle;
    },

    moveTowards(current, target, maxDelta) {
      if (Math.abs(target - current) <= maxDelta) return target;
      return current + Math.sign(target - current) * maxDelta;
    },

    damp(current, target, lambda, dt) {
      return this.lerp(current, target, 1 - Math.exp(-lambda * dt));
    }
  };

  // ============================================================
  // 向量操作 - 类型化数组直接操作，避免对象分配
  // ============================================================
  const VecOps = {
    create3() { return new Float32Array(3); },
    create4() { return new Float32Array(4); },
    createMat4() {
      const m = new Float32Array(16);
      m[0] = m[5] = m[10] = m[15] = 1;
      return m;
    },

    set3(out, x, y, z) { out[0] = x; out[1] = y; out[2] = z; return out; },
    copy3(out, a) { out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; return out; },
    add3(out, a, b) { out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; out[2] = a[2] + b[2]; return out; },
    sub3(out, a, b) { out[0] = a[0] - b[0]; out[1] = a[1] - b[1]; out[2] = a[2] - b[2]; return out; },
    scale3(out, a, s) { out[0] = a[0] * s; out[1] = a[1] * s; out[2] = a[2] * s; return out; },
    dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
    cross3(out, a, b) {
      const x = a[1] * b[2] - a[2] * b[1];
      const y = a[2] * b[0] - a[0] * b[2];
      const z = a[0] * b[1] - a[1] * b[0];
      out[0] = x; out[1] = y; out[2] = z;
      return out;
    },
    length3(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); },
    normalize3(out, a) {
      const len = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1;
      out[0] = a[0] / len; out[1] = a[1] / len; out[2] = a[2] / len;
      return out;
    },
    lerp3(out, a, b, t) {
      out[0] = a[0] + (b[0] - a[0]) * t;
      out[1] = a[1] + (b[1] - a[1]) * t;
      out[2] = a[2] + (b[2] - a[2]) * t;
      return out;
    },

    // 四元数操作
    createQuat() { const q = new Float32Array(4); q[3] = 1; return q; },
    identityQuat(out) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1; return out; },
    copyQuat(out, a) { out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; out[3] = a[3]; return out; },
    multiplyQuat(out, a, b) {
      const ax = a[0], ay = a[1], az = a[2], aw = a[3];
      const bx = b[0], by = b[1], bz = b[2], bw = b[3];
      out[0] = ax * bw + aw * bx + ay * bz - az * by;
      out[1] = ay * bw + aw * by + az * bx - ax * bz;
      out[2] = az * bw + aw * bz + ax * by - ay * bx;
      out[3] = aw * bw - ax * bx - ay * by - az * bz;
      return out;
    },
    normalizeQuat(out, a) {
      const len = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3]) || 1;
      out[0] = a[0] / len; out[1] = a[1] / len; out[2] = a[2] / len; out[3] = a[3] / len;
      return out;
    },
    slerpQuat(out, a, b, t) {
      let ax = a[0], ay = a[1], az = a[2], aw = a[3];
      let bx = b[0], by = b[1], bz = b[2], bw = b[3];
      let cosHalfTheta = aw * bw + ax * bx + ay * by + az * bz;
      if (cosHalfTheta < 0) {
        bw = -bw; bx = -bx; by = -by; bz = -bz;
        cosHalfTheta = -cosHalfTheta;
      }
      if (cosHalfTheta >= 1.0) {
        out[0] = ax; out[1] = ay; out[2] = az; out[3] = aw;
        return out;
      }
      const halfTheta = Math.acos(cosHalfTheta);
      const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);
      if (Math.abs(sinHalfTheta) < 0.001) {
        out[0] = (ax * 0.5 + bx * 0.5);
        out[1] = (ay * 0.5 + by * 0.5);
        out[2] = (az * 0.5 + bz * 0.5);
        out[3] = (aw * 0.5 + bw * 0.5);
        return out;
      }
      const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
      const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
      out[0] = ax * ratioA + bx * ratioB;
      out[1] = ay * ratioA + by * ratioB;
      out[2] = az * ratioA + bz * ratioB;
      out[3] = aw * ratioA + bw * ratioB;
      return out;
    },

    // 矩阵操作
    identityMat4(out) {
      out.fill(0);
      out[0] = out[5] = out[10] = out[15] = 1;
      return out;
    },
    multiplyMat4(out, a, b) {
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          out[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j] + a[i * 4 + 3] * b[12 + j];
        }
      }
      return out;
    },
    perspectiveMat4(out, fovy, aspect, near, far) {
      const f = 1.0 / Math.tan(fovy / 2);
      out.fill(0);
      out[0] = f / aspect;
      out[5] = f;
      out[10] = (far + near) / (near - far);
      out[11] = -1;
      out[14] = (2 * far * near) / (near - far);
      return out;
    },
    lookAtMat4(out, eye, center, up) {
      const zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
      let len = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1;
      const z0 = zx / len, z1 = zy / len, z2 = zz / len;
      const xx = up[1] * z2 - up[2] * z1;
      const xy = up[2] * z0 - up[0] * z2;
      const xz = up[0] * z1 - up[1] * z0;
      len = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1;
      const x0 = xx / len, x1 = xy / len, x2 = xz / len;
      const y0 = z1 * x2 - z2 * x1;
      const y1 = z2 * x0 - z0 * x2;
      const y2 = z0 * x1 - z1 * x0;
      out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
      out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
      out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
      out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
      out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
      out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
      out[15] = 1;
      return out;
    },
    translateMat4(out, a, v) {
      const x = v[0], y = v[1], z = v[2];
      if (a !== out) out.set(a);
      out[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
      out[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
      out[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
      out[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
      return out;
    },
    scaleMat4(out, a, v) {
      const x = v[0], y = v[1], z = v[2];
      out[0] = a[0] * x; out[1] = a[1] * x; out[2] = a[2] * x; out[3] = a[3] * x;
      out[4] = a[4] * y; out[5] = a[5] * y; out[6] = a[6] * y; out[7] = a[7] * y;
      out[8] = a[8] * z; out[9] = a[9] * z; out[10] = a[10] * z; out[11] = a[11] * z;
      out[12] = a[12]; out[13] = a[13]; out[14] = a[14]; out[15] = a[15];
      return out;
    }
  };

  // ============================================================
  // 性能分析器 - 函数级耗时统计
  // ============================================================
  class Profiler {
    constructor() {
      this._timers = new Map();
      this._currentStack = [];
      this._enabled = false;
      this._frameData = [];
      this._maxFrames = 300;
    }

    enable() { this._enabled = true; }
    disable() { this._enabled = false; }
    isEnabled() { return this._enabled; }

    begin(name) {
      if (!this._enabled) return;
      if (!this._timers.has(name)) {
        this._timers.set(name, { total: 0, calls: 0, max: 0, min: Infinity });
      }
      this._currentStack.push({ name, start: performance.now() });
    }

    end(name) {
      if (!this._enabled) return;
      const idx = this._currentStack.findIndex(t => t.name === name);
      if (idx === -1) return;
      const timer = this._currentStack.splice(idx, 1)[0];
      const elapsed = performance.now() - timer.start;
      const data = this._timers.get(name);
      data.total += elapsed;
      data.calls++;
      data.max = Math.max(data.max, elapsed);
      data.min = Math.min(data.min, elapsed);
    }

    frame() {
      if (!this._enabled) return;
      const frameStats = {};
      for (const [name, data] of this._timers) {
        frameStats[name] = { ...data, avg: data.total / data.calls };
      }
      this._frameData.push(frameStats);
      if (this._frameData.length > this._maxFrames) this._frameData.shift();
      for (const data of this._timers.values()) {
        data.total = 0; data.calls = 0; data.max = 0; data.min = Infinity;
      }
    }

    getReport() {
      const report = {};
      for (const [name, data] of this._timers) {
        report[name] = {
          calls: data.calls,
          totalMs: data.total.toFixed(2),
          avgMs: (data.total / (data.calls || 1)).toFixed(4),
          maxMs: data.max.toFixed(4),
          minMs: data.min === Infinity ? 'N/A' : data.min.toFixed(4)
        };
      }
      return report;
    }

    getFrameHistory() { return this._frameData.slice(); }
    clear() { this._timers.clear(); this._frameData.length = 0; }
  }

  const profiler = new Profiler();

  // ============================================================
  // 公开API
  // ============================================================
  return {
    ObjectPool,
    TypedArrayPool,
    typedArrayPool,
    RingBuffer,
    PriorityQueue,
    LinkedList,
    LinkedListNode,
    LRUCache,
    BitSet,
    FastMath,
    VecOps,
    Profiler,
    profiler
  };
})();

if (typeof window !== 'undefined') window.OrbCoreOpt = OrbCoreOpt;
if (typeof globalThis !== 'undefined') globalThis.OrbCoreOpt = OrbCoreOpt;
