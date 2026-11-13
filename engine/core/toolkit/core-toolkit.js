/**
 * 引擎核心扩展 - 工具库/调试系统/插件系统/资源管理/输入系统/事件系统
 * 纯JavaScript，零第三方依赖
 * @version 2.0.0
 */
'use strict';

const EngineCoreExt = (function () {

  // ============================================================
  // 工具库 - 数学/字符串/数组/对象/颜色/时间工具
  // ============================================================
  class Utils {
    constructor() {
      this.math = this._createMathUtils();
      this.string = this._createStringUtils();
      this.array = this._createArrayUtils();
      this.object = this._createObjectUtils();
      this.color = this._createColorUtils();
      this.time = this._createTimeUtils();
      this.geometry = this._createGeometryUtils();
      this.random = this._createRandomUtils();
    }

    _createMathUtils() {
      return {
        clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
        lerp: (a, b, t) => a + (b - a) * t,
        inverseLerp: (a, b, v) => (v - a) / (b - a),
        remap: (v, inMin, inMax, outMin, outMax) => this.clamp((v - inMin) / (inMax - inMin), 0, 1) * (outMax - outMin) + outMin,
        smoothstep: (edge0, edge1, x) => {
          const t = this.clamp((x - edge0) / (edge1 - edge0), 0, 1);
          return t * t * (3 - 2 * t);
        },
        smootherstep: (edge0, edge1, x) => {
          const t = this.clamp((x - edge0) / (edge1 - edge0), 0, 1);
          return t * t * t * (t * (t * 6 - 15) + 10);
        },
        degToRad: (deg) => deg * Math.PI / 180,
        radToDeg: (rad) => rad * 180 / Math.PI,
        isPowerOfTwo: (n) => (n & (n - 1)) === 0 && n !== 0,
        nextPowerOfTwo: (n) => {
          n--;
          n |= n >> 1; n |= n >> 2; n |= n >> 4; n |= n >> 8; n |= n >> 16;
          return ++n;
        },
        factorial: (n) => {
          if (n < 0) return NaN;
          if (n <= 1) return 1;
          let result = 1;
          for (let i = 2; i <= n; i++) result *= i;
          return result;
        },
        gcd: (a, b) => b === 0 ? Math.abs(a) : this.gcd(b, a % b),
        lcm: (a, b) => Math.abs(a * b) / this.gcd(a, b),
        bezier: (t, p0, p1, p2, p3) => {
          const u = 1 - t;
          return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3;
        },
        catmullRom: (t, p0, p1, p2, p3) => {
          const t2 = t * t, t3 = t2 * t;
          return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2*p0 - 5*p1 + 4*p2 - p3) * t2 + (-p0 + 3*p1 - 3*p2 + p3) * t3);
        },
        distance: (x1, y1, x2, y2) => Math.sqrt((x2-x1)**2 + (y2-y1)**2),
        distance3D: (x1, y1, z1, x2, y2, z2) => Math.sqrt((x2-x1)**2 + (y2-y1)**2 + (z2-z1)**2),
        normalize: (v) => {
          const l = Math.sqrt(v[0]**2 + v[1]**2 + v[2]**2) || 1;
          return [v[0]/l, v[1]/l, v[2]/l];
        },
        dot: (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2],
        cross: (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]],
        quaternionMultiply: (a, b) => [
          a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
          a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
          a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
          a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2]
        ],
        eulerToQuaternion: (x, y, z) => {
          const cx = Math.cos(x/2), sx = Math.sin(x/2);
          const cy = Math.cos(y/2), sy = Math.sin(y/2);
          const cz = Math.cos(z/2), sz = Math.sin(z/2);
          return [sx*cy*cz - cx*sy*sz, cx*sy*cz + sx*cy*sz, cx*cy*sz - sx*sy*cz, cx*cy*cz + sx*sy*sz];
        },
        slerp: (a, b, t) => {
          let dot = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
          let bCopy = [...b];
          if (dot < 0) { bCopy = [-b[0], -b[1], -b[2], -b[3]]; dot = -dot; }
          if (dot > 0.9995) {
            return this.normalize([a[0]+(bCopy[0]-a[0])*t, a[1]+(bCopy[1]-a[1])*t, a[2]+(bCopy[2]-a[2])*t, a[3]+(bCopy[3]-a[3])*t]);
          }
          const theta0 = Math.acos(Math.max(-1, Math.min(1, dot)));
          const theta = theta0 * t;
          const sinTheta = Math.sin(theta), sinTheta0 = Math.sin(theta0);
          const s0 = Math.cos(theta) - dot * sinTheta / sinTheta0;
          const s1 = sinTheta / sinTheta0;
          return [a[0]*s0+bCopy[0]*s1, a[1]*s0+bCopy[1]*s1, a[2]*s0+bCopy[2]*s1, a[3]*s0+bCopy[3]*s1];
        }
      };
    }

    _createStringUtils() {
      return {
        capitalize: (s) => s.charAt(0).toUpperCase() + s.slice(1),
        camelCase: (s) => s.replace(/[-_](.)/g, (_, c) => c.toUpperCase()),
        snakeCase: (s) => s.replace(/[A-Z]/g, m => '_' + m.toLowerCase()).replace(/^_/, ''),
        kebabCase: (s) => s.replace(/[A-Z]/g, m => '-' + m.toLowerCase()).replace(/^-/, ''),
        truncate: (s, maxLen, suffix = '...') => s.length > maxLen ? s.slice(0, maxLen - suffix.length) + suffix : s,
        padStart: (s, targetLength, padString = ' ') => s.padStart(targetLength, padString),
        padEnd: (s, targetLength, padString = ' ') => s.padEnd(targetLength, padString),
        escapeHtml: (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'),
        unescapeHtml: (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'"),
        stripTags: (s) => s.replace(/<[^>]*>/g, ''),
        removeWhitespace: (s) => s.replace(/\s+/g, ''),
        countWords: (s) => s.trim().split(/\s+/).filter(w => w.length > 0).length,
        countLines: (s) => s.split('\n').length,
        reverse: (s) => s.split('').reverse().join(''),
        isPalindrome: (s) => {
          const cleaned = s.toLowerCase().replace(/[^a-z0-9]/g, '');
          return cleaned === cleaned.split('').reverse().join('');
        },
        toTitleCase: (s) => s.replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()),
        slugify: (s) => s.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, ''),
        formatNumber: (n, decimals = 0) => n.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ','),
        formatBytes: (bytes, decimals = 2) => {
          if (bytes === 0) return '0 Bytes';
          const k = 1024, dm = decimals < 0 ? 0 : decimals, sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
        },
        formatTime: (seconds) => {
          const h = Math.floor(seconds / 3600);
          const m = Math.floor((seconds % 3600) / 60);
          const s = Math.floor(seconds % 60);
          return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
      };
    }

    _createArrayUtils() {
      return {
        chunk: (arr, size) => {
          const chunks = [];
          for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
          return chunks;
        },
        flatten: (arr) => arr.reduce((flat, item) => flat.concat(Array.isArray(item) ? this.flatten(item) : item), []),
        unique: (arr) => [...new Set(arr)],
        shuffle: (arr) => {
          const result = [...arr];
          for (let i = result.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
          }
          return result;
        },
        sample: (arr, n = 1) => {
          if (n === 1) return arr[Math.floor(Math.random() * arr.length)];
          return this.shuffle(arr).slice(0, n);
        },
        groupBy: (arr, key) => {
          return arr.reduce((groups, item) => {
            const groupKey = typeof key === 'function' ? key(item) : item[key];
            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(item);
            return groups;
          }, {});
        },
        sortBy: (arr, key, ascending = true) => {
          return [...arr].sort((a, b) => {
            const valA = typeof key === 'function' ? key(a) : a[key];
            const valB = typeof key === 'function' ? key(b) : b[key];
            if (valA < valB) return ascending ? -1 : 1;
            if (valA > valB) return ascending ? 1 : -1;
            return 0;
          });
        },
        sum: (arr) => arr.reduce((total, item) => total + (typeof item === 'number' ? item : 0), 0),
        average: (arr) => arr.length > 0 ? this.sum(arr) / arr.length : 0,
        median: (arr) => {
          const sorted = [...arr].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        },
        mode: (arr) => {
          const frequency = {};
          let maxFreq = 0, result = [];
          for (const item of arr) {
            frequency[item] = (frequency[item] || 0) + 1;
            if (frequency[item] > maxFreq) { maxFreq = frequency[item]; result = [item]; }
            else if (frequency[item] === maxFreq) result.push(item);
          }
          return result;
        },
        range: (start, end, step = 1) => {
          const result = [];
          if (step > 0) for (let i = start; i < end; i += step) result.push(i);
          else for (let i = start; i > end; i += step) result.push(i);
          return result;
        },
        zip: (...arrays) => {
          const length = Math.min(...arrays.map(a => a.length));
          return Array.from({ length }, (_, i) => arrays.map(a => a[i]));
        },
        unzip: (arr) => arr[0].map((_, i) => arr.map(row => row[i])),
        intersect: (a, b) => a.filter(x => b.includes(x)),
        difference: (a, b) => a.filter(x => !b.includes(x)),
        union: (a, b) => this.unique([...a, ...b]),
        compact: (arr) => arr.filter(Boolean),
        without: (arr, ...values) => arr.filter(x => !values.includes(x)),
        partition: (arr, predicate) => [arr.filter(predicate), arr.filter(x => !predicate(x))],
        pluck: (arr, key) => arr.map(item => item[key]),
        invoke: (arr, methodName, ...args) => arr.map(item => typeof item[methodName] === 'function' ? item[methodName](...args) : undefined)
      };
    }

    _createObjectUtils() {
      return {
        deepClone: (obj) => {
          if (obj === null || typeof obj !== 'object') return obj;
          if (obj instanceof Date) return new Date(obj.getTime());
          if (obj instanceof Array) return obj.map(item => this.deepClone(item));
          if (obj instanceof Map) return new Map(Array.from(obj.entries()).map(([k, v]) => [k, this.deepClone(v)]));
          if (obj instanceof Set) return new Set(Array.from(obj.values()).map(v => this.deepClone(v)));
          const result = {};
          for (const key of Object.keys(obj)) result[key] = this.deepClone(obj[key]);
          return result;
        },
        deepMerge: (target, source) => {
          const result = this.deepClone(target);
          for (const key of Object.keys(source)) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && !(source[key] instanceof Date) && !(source[key] instanceof Map) && !(source[key] instanceof Set)) {
              result[key] = this.deepMerge(result[key] || {}, source[key]);
            } else {
              result[key] = this.deepClone(source[key]);
            }
          }
          return result;
        },
        get: (obj, path, defaultValue) => {
          const keys = path.split('.');
          let current = obj;
          for (const key of keys) {
            if (current === null || current === undefined || !(key in current)) return defaultValue;
            current = current[key];
          }
          return current;
        },
        set: (obj, path, value) => {
          const keys = path.split('.');
          let current = obj;
          for (let i = 0; i < keys.length - 1; i++) {
            if (!(keys[i] in current) || typeof current[keys[i]] !== 'object') current[keys[i]] = {};
            current = current[keys[i]];
          }
          current[keys[keys.length - 1]] = value;
          return obj;
        },
        has: (obj, path) => {
          const keys = path.split('.');
          let current = obj;
          for (const key of keys) {
            if (current === null || current === undefined || !(key in current)) return false;
            current = current[key];
          }
          return true;
        },
        delete: (obj, path) => {
          const keys = path.split('.');
          let current = obj;
          for (let i = 0; i < keys.length - 1; i++) {
            if (!(keys[i] in current)) return false;
            current = current[keys[i]];
          }
          return delete current[keys[keys.length - 1]];
        },
        keys: (obj) => Object.keys(obj),
        values: (obj) => Object.values(obj),
        entries: (obj) => Object.entries(obj),
        fromEntries: (entries) => Object.fromEntries(entries),
        mapValues: (obj, fn) => {
          const result = {};
          for (const [key, value] of Object.entries(obj)) result[key] = fn(value, key, obj);
          return result;
        },
        mapKeys: (obj, fn) => {
          const result = {};
          for (const [key, value] of Object.entries(obj)) result[fn(key, value, obj)] = value;
          return result;
        },
        pick: (obj, keys) => {
          const result = {};
          for (const key of keys) if (key in obj) result[key] = obj[key];
          return result;
        },
        omit: (obj, keys) => {
          const result = { ...obj };
          for (const key of keys) delete result[key];
          return result;
        },
        invert: (obj) => {
          const result = {};
          for (const [key, value] of Object.entries(obj)) result[value] = key;
          return result;
        },
        isEmpty: (obj) => Object.keys(obj).length === 0,
        size: (obj) => Object.keys(obj).length,
        toQueryString: (obj) => Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&'),
        fromQueryString: (str) => {
          const params = new URLSearchParams(str);
          const result = {};
          for (const [key, value] of params) result[key] = value;
          return result;
        }
      };
    }

    _createColorUtils() {
      return {
        hexToRgb: (hex) => {
          const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
          return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
        },
        rgbToHex: (r, g, b) => '#' + [r, g, b].map(x => {
          const hex = Math.round(Math.max(0, Math.min(255, x))).toString(16);
          return hex.length === 1 ? '0' + hex : hex;
        }).join(''),
        rgbToHsl: (r, g, b) => {
          r /= 255; g /= 255; b /= 255;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          let h, s, l = (max + min) / 2;
          if (max === min) { h = s = 0; }
          else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
              case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
              case g: h = ((b - r) / d + 2) / 6; break;
              case b: h = ((r - g) / d + 4) / 6; break;
            }
          }
          return { h: h * 360, s: s * 100, l: l * 100 };
        },
        hslToRgb: (h, s, l) => {
          h /= 360; s /= 100; l /= 100;
          let r, g, b;
          if (s === 0) { r = g = b = l; }
          else {
            const hue2rgb = (p, q, t) => {
              if (t < 0) t += 1;
              if (t > 1) t -= 1;
              if (t < 1/6) return p + (q - p) * 6 * t;
              if (t < 1/2) return q;
              if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
              return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
          }
          return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
        },
        lerpColor: (color1, color2, t) => ({
          r: Math.round(color1.r + (color2.r - color1.r) * t),
          g: Math.round(color1.g + (color2.g - color1.g) * t),
          b: Math.round(color1.b + (color2.b - color1.b) * t)
        }),
        randomColor: () => ({
          r: Math.floor(Math.random() * 256),
          g: Math.floor(Math.random() * 256),
          b: Math.floor(Math.random() * 256)
        }),
        brightness: (r, g, b) => (r * 299 + g * 587 + b * 114) / 1000,
        isLight: (r, g, b) => this.brightness(r, g, b) > 128,
        isDark: (r, g, b) => this.brightness(r, g, b) <= 128,
        contrast: (r1, g1, b1, r2, g2, b2) => {
          const lum1 = this.brightness(r1, g1, b1) / 255;
          const lum2 = this.brightness(r2, g2, b2) / 255;
          const brightest = Math.max(lum1, lum2);
          const darkest = Math.min(lum1, lum2);
          return (brightest + 0.05) / (darkest + 0.05);
        }
      };
    }

    _createTimeUtils() {
      return {
        now: () => Date.now(),
        timestamp: () => Math.floor(Date.now() / 1000),
        format: (date, format = 'YYYY-MM-DD HH:mm:ss') => {
          const d = date instanceof Date ? date : new Date(date);
          const pad = (n) => n.toString().padStart(2, '0');
          return format
            .replace('YYYY', d.getFullYear())
            .replace('MM', pad(d.getMonth() + 1))
            .replace('DD', pad(d.getDate()))
            .replace('HH', pad(d.getHours()))
            .replace('mm', pad(d.getMinutes()))
            .replace('ss', pad(d.getSeconds()))
            .replace('SSS', d.getMilliseconds().toString().padStart(3, '0'));
        },
        parse: (str) => new Date(str),
        addDays: (date, days) => {
          const result = new Date(date);
          result.setDate(result.getDate() + days);
          return result;
        },
        addHours: (date, hours) => {
          const result = new Date(date);
          result.setHours(result.getHours() + hours);
          return result;
        },
        addMinutes: (date, minutes) => {
          const result = new Date(date);
          result.setMinutes(result.getMinutes() + minutes);
          return result;
        },
        diffDays: (date1, date2) => Math.floor((new Date(date2) - new Date(date1)) / (1000 * 60 * 60 * 24)),
        diffHours: (date1, date2) => Math.floor((new Date(date2) - new Date(date1)) / (1000 * 60 * 60)),
        diffMinutes: (date1, date2) => Math.floor((new Date(date2) - new Date(date1)) / (1000 * 60)),
        isToday: (date) => {
          const d = new Date(date), today = new Date();
          return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
        },
        isThisWeek: (date) => {
          const d = new Date(date), now = new Date();
          const startOfWeek = new Date(now);
          startOfWeek.setDate(now.getDate() - now.getDay());
          startOfWeek.setHours(0, 0, 0, 0);
          const endOfWeek = new Date(startOfWeek);
          endOfWeek.setDate(startOfWeek.getDate() + 7);
          return d >= startOfWeek && d < endOfWeek;
        },
        isThisMonth: (date) => {
          const d = new Date(date), now = new Date();
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        },
        startOfDay: (date) => {
          const d = new Date(date);
          d.setHours(0, 0, 0, 0);
          return d;
        },
        endOfDay: (date) => {
          const d = new Date(date);
          d.setHours(23, 59, 59, 999);
          return d;
        },
        relativeTime: (date) => {
          const now = Date.now();
          const diff = now - new Date(date).getTime();
          const seconds = Math.floor(diff / 1000);
          const minutes = Math.floor(seconds / 60);
          const hours = Math.floor(minutes / 60);
          const days = Math.floor(hours / 24);
          if (days > 30) return this.format(date, 'YYYY-MM-DD');
          if (days > 0) return `${days}天前`;
          if (hours > 0) return `${hours}小时前`;
          if (minutes > 0) return `${minutes}分钟前`;
          return '刚刚';
        }
      };
    }

    _createGeometryUtils() {
      return {
        createPlane: (width, height, segmentsW = 1, segmentsH = 1) => {
          const vertices = [], normals = [], uvs = [], indices = [];
          for (let y = 0; y <= segmentsH; y++) {
            for (let x = 0; x <= segmentsW; x++) {
              vertices.push((x / segmentsW - 0.5) * width, 0, (y / segmentsH - 0.5) * height);
              normals.push(0, 1, 0);
              uvs.push(x / segmentsW, y / segmentsH);
            }
          }
          for (let y = 0; y < segmentsH; y++) {
            for (let x = 0; x < segmentsW; x++) {
              const a = y * (segmentsW + 1) + x;
              const b = a + segmentsW + 1;
              indices.push(a, b, a + 1, a + 1, b, b + 1);
            }
          }
          return { vertices: new Float32Array(vertices), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
        },
        createBox: (width, height, depth) => {
          const w = width / 2, h = height / 2, d = depth / 2;
          const vertices = [
            -w, -h, d, w, -h, d, w, h, d, -w, h, d,
            w, -h, -d, -w, -h, -d, -w, h, -d, w, h, -d,
            -w, h, d, w, h, d, w, h, -d, -w, h, -d,
            -w, -h, -d, w, -h, -d, w, -h, d, -w, -h, d,
            w, -h, d, w, -h, -d, w, h, -d, w, h, d,
            -w, -h, -d, -w, -h, d, -w, h, d, -w, h, -d
          ];
          const normals = [
            0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
            0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
            0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
            0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
            1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
            -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0
          ];
          const uvs = [];
          for (let i = 0; i < 6; i++) uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
          const indices = [];
          for (let i = 0; i < 6; i++) {
            const base = i * 4;
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
          return { vertices: new Float32Array(vertices), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
        },
        createSphere: (radius, widthSegments = 32, heightSegments = 16) => {
          const vertices = [], normals = [], uvs = [], indices = [];
          for (let y = 0; y <= heightSegments; y++) {
            const v = y / heightSegments;
            const phi = v * Math.PI;
            for (let x = 0; x <= widthSegments; x++) {
              const u = x / widthSegments;
              const theta = u * Math.PI * 2;
              const px = -radius * Math.cos(theta) * Math.sin(phi);
              const py = radius * Math.cos(phi);
              const pz = radius * Math.sin(theta) * Math.sin(phi);
              vertices.push(px, py, pz);
              normals.push(px / radius, py / radius, pz / radius);
              uvs.push(u, 1 - v);
            }
          }
          for (let y = 0; y < heightSegments; y++) {
            for (let x = 0; x < widthSegments; x++) {
              const a = y * (widthSegments + 1) + x;
              const b = a + widthSegments + 1;
              indices.push(a, b, a + 1, a + 1, b, b + 1);
            }
          }
          return { vertices: new Float32Array(vertices), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
        },
        createCylinder: (radiusTop, radiusBottom, height, radialSegments = 32, heightSegments = 1) => {
          const vertices = [], normals = [], uvs = [], indices = [];
          for (let y = 0; y <= heightSegments; y++) {
            const v = y / heightSegments;
            const radius = radiusTop + (radiusBottom - radiusTop) * v;
            for (let x = 0; x <= radialSegments; x++) {
              const u = x / radialSegments;
              const theta = u * Math.PI * 2;
              const px = radius * Math.cos(theta);
              const py = -height / 2 + v * height;
              const pz = radius * Math.sin(theta);
              vertices.push(px, py, pz);
              normals.push(Math.cos(theta), 0, Math.sin(theta));
              uvs.push(u, v);
            }
          }
          for (let y = 0; y < heightSegments; y++) {
            for (let x = 0; x < radialSegments; x++) {
              const a = y * (radialSegments + 1) + x;
              const b = a + radialSegments + 1;
              indices.push(a, b, a + 1, a + 1, b, b + 1);
            }
          }
          return { vertices: new Float32Array(vertices), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
        },
        computeBoundingBox: (vertices) => {
          let minX = Infinity, minY = Infinity, minZ = Infinity;
          let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
          for (let i = 0; i < vertices.length; i += 3) {
            minX = Math.min(minX, vertices[i]);
            minY = Math.min(minY, vertices[i + 1]);
            minZ = Math.min(minZ, vertices[i + 2]);
            maxX = Math.max(maxX, vertices[i]);
            maxY = Math.max(maxY, vertices[i + 1]);
            maxZ = Math.max(maxZ, vertices[i + 2]);
          }
          return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], center: [(minX+maxX)/2, (minY+maxY)/2, (minZ+maxZ)/2], size: [maxX-minX, maxY-minY, maxZ-minZ] };
        },
        computeBoundingSphere: (vertices) => {
          const box = this.computeBoundingBox(vertices);
          const center = box.center;
          let maxRadius = 0;
          for (let i = 0; i < vertices.length; i += 3) {
            const dx = vertices[i] - center[0];
            const dy = vertices[i + 1] - center[1];
            const dz = vertices[i + 2] - center[2];
            const radius = Math.sqrt(dx*dx + dy*dy + dz*dz);
            if (radius > maxRadius) maxRadius = radius;
          }
          return { center, radius: maxRadius };
        },
        computeNormals: (vertices, indices) => {
          const normals = new Float32Array(vertices.length);
          for (let i = 0; i < indices.length; i += 3) {
            const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
            const e1 = [vertices[b] - vertices[a], vertices[b + 1] - vertices[a + 1], vertices[b + 2] - vertices[a + 2]];
            const e2 = [vertices[c] - vertices[a], vertices[c + 1] - vertices[a + 1], vertices[c + 2] - vertices[a + 2]];
            const n = [e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
            normals[a] += n[0]; normals[a + 1] += n[1]; normals[a + 2] += n[2];
            normals[b] += n[0]; normals[b + 1] += n[1]; normals[b + 2] += n[2];
            normals[c] += n[0]; normals[c + 1] += n[1]; normals[c + 2] += n[2];
          }
          for (let i = 0; i < normals.length; i += 3) {
            const l = Math.sqrt(normals[i]**2 + normals[i+1]**2 + normals[i+2]**2) || 1;
            normals[i] /= l; normals[i+1] /= l; normals[i+2] /= l;
          }
          return normals;
        }
      };
    }

    _createRandomUtils() {
      let seed = 12345;
      return {
        setSeed: (s) => { seed = s; },
        next: () => {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          return seed / 0x7fffffff;
        },
        range: (min, max) => min + this.next() * (max - min),
        int: (min, max) => Math.floor(this.range(min, max + 1)),
        pick: (arr) => arr[Math.floor(this.next() * arr.length)],
        gaussian: (mean = 0, stdDev = 1) => {
          const u1 = this.next(), u2 = this.next();
          return mean + stdDev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        },
        chance: (probability) => this.next() < probability,
        weighted: (items, weights) => {
          const total = weights.reduce((sum, w) => sum + w, 0);
          let r = this.next() * total;
          for (let i = 0; i < items.length; i++) {
            r -= weights[i];
            if (r <= 0) return items[i];
          }
          return items[items.length - 1];
        },
        shuffle: (arr) => {
          const result = [...arr];
          for (let i = result.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
          }
          return result;
        },
        color: () => `#${Math.floor(this.next() * 16777215).toString(16).padStart(6, '0')}`,
        uuid: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = this.next() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        })
      };
    }
  }

  // ============================================================
  // 调试系统 - 性能监控/日志/断言/错误处理
  // ============================================================
  class DebugSystem {
    constructor() {
      this.enabled = true;
      this.verbose = false;
      this.logs = [];
      this.maxLogs = 1000;
      this.performanceMetrics = {
        fps: 0,
        frameTime: 0,
        drawCalls: 0,
        triangles: 0,
        memoryUsage: 0,
        gpuMemory: 0,
        updateTime: 0,
        renderTime: 0,
        physicsTime: 0,
        animationTime: 0
      };
      this.frameCount = 0;
      this.lastFpsUpdate = 0;
      this.fpsHistory = [];
      this.assertions = { passed: 0, failed: 0, errors: [] };
      this.breakpoints = new Set();
      this.profilers = new Map();
      this.errorHandlers = [];
      this._initErrorHandling();
    }

    _initErrorHandling() {
      if (typeof window !== 'undefined') {
        window.addEventListener('error', (event) => {
          this.error('Global Error', event.message, event.filename, event.lineno, event.colno);
        });
        window.addEventListener('unhandledrejection', (event) => {
          this.error('Unhandled Promise Rejection', event.reason);
        });
      }
    }

    log(message, ...args) {
      if (!this.enabled) return;
      const entry = { type: 'log', message, args, timestamp: Date.now(), level: 'info' };
      this.logs.push(entry);
      if (this.logs.length > this.maxLogs) this.logs.shift();
      if (this.verbose) console.log('[DEBUG]', message, ...args);
    }

    warn(message, ...args) {
      if (!this.enabled) return;
      const entry = { type: 'warn', message, args, timestamp: Date.now(), level: 'warning' };
      this.logs.push(entry);
      if (this.logs.length > this.maxLogs) this.logs.shift();
      console.warn('[DEBUG WARN]', message, ...args);
    }

    error(message, ...args) {
      if (!this.enabled) return;
      const entry = { type: 'error', message, args, timestamp: Date.now(), level: 'error', stack: new Error().stack };
      this.logs.push(entry);
      if (this.logs.length > this.maxLogs) this.logs.shift();
      console.error('[DEBUG ERROR]', message, ...args);
      for (const handler of this.errorHandlers) {
        try { handler(entry); } catch (e) { console.error('Error handler failed:', e); }
      }
    }

    assert(condition, message) {
      if (condition) {
        this.assertions.passed++;
      } else {
        this.assertions.failed++;
        this.assertions.errors.push({ message, timestamp: Date.now(), stack: new Error().stack });
        this.error('Assertion Failed:', message);
        if (this.breakpoints.has('assert')) debugger;
      }
    }

    startProfile(name) {
      this.profilers.set(name, {
        startTime: performance.now(),
        endTime: null,
        duration: 0,
        calls: 1
      });
    }

    endProfile(name) {
      const profiler = this.profilers.get(name);
      if (profiler) {
        profiler.endTime = performance.now();
        profiler.duration = profiler.endTime - profiler.startTime;
        return profiler.duration;
      }
      return 0;
    }

    getProfile(name) {
      return this.profilers.get(name);
    }

    getAllProfiles() {
      return Object.fromEntries(this.profilers);
    }

    updateFrameMetrics(frameTime, drawCalls, triangles) {
      this.frameCount++;
      this.performanceMetrics.frameTime = frameTime;
      this.performanceMetrics.drawCalls = drawCalls;
      this.performanceMetrics.triangles = triangles;
      const now = performance.now();
      if (now - this.lastFpsUpdate >= 1000) {
        this.performanceMetrics.fps = Math.round(this.frameCount * 1000 / (now - this.lastFpsUpdate));
        this.fpsHistory.push({ time: now, fps: this.performanceMetrics.fps });
        if (this.fpsHistory.length > 60) this.fpsHistory.shift();
        this.frameCount = 0;
        this.lastFpsUpdate = now;
      }
      if (typeof performance !== 'undefined' && performance.memory) {
        this.performanceMetrics.memoryUsage = performance.memory.usedJSHeapSize;
      }
    }

    setMetric(name, value) {
      if (this.performanceMetrics.hasOwnProperty(name)) {
        this.performanceMetrics[name] = value;
      }
    }

    getPerformanceMetrics() {
      return { ...this.performanceMetrics };
    }

    getFpsHistory() {
      return [...this.fpsHistory];
    }

    getLogs(type = null, limit = 50) {
      let filtered = this.logs;
      if (type) filtered = filtered.filter(log => log.type === type);
      return filtered.slice(-limit);
    }

    clearLogs() { this.logs = []; }

    addErrorHandler(handler) {
      this.errorHandlers.push(handler);
    }

    removeErrorHandler(handler) {
      const idx = this.errorHandlers.indexOf(handler);
      if (idx !== -1) this.errorHandlers.splice(idx, 1);
    }

    addBreakpoint(name) { this.breakpoints.add(name); }
    removeBreakpoint(name) { this.breakpoints.delete(name); }
    clearBreakpoints() { this.breakpoints.clear(); }

    setEnabled(v) { this.enabled = v; }
    setVerbose(v) { this.verbose = v; }
    setMaxLogs(n) { this.maxLogs = n; }

    getAssertionReport() {
      return {
        passed: this.assertions.passed,
        failed: this.assertions.failed,
        total: this.assertions.passed + this.assertions.failed,
        passRate: this.assertions.passed + this.assertions.failed > 0 ? this.assertions.passed / (this.assertions.passed + this.assertions.failed) : 1,
        errors: [...this.assertions.errors]
      };
    }

    reset() {
      this.logs = [];
      this.fpsHistory = [];
      this.assertions = { passed: 0, failed: 0, errors: [] };
      this.profilers.clear();
      this.frameCount = 0;
      this.performanceMetrics = {
        fps: 0, frameTime: 0, drawCalls: 0, triangles: 0,
        memoryUsage: 0, gpuMemory: 0, updateTime: 0, renderTime: 0,
        physicsTime: 0, animationTime: 0
      };
    }

    dispose() { this.reset(); this.errorHandlers = []; this.breakpoints.clear(); }
  }

  // ============================================================
  // 插件系统 - 插件注册/加载/卸载/生命周期
  // ============================================================
  class PluginSystem {
    constructor(engine) {
      this.engine = engine;
      this.plugins = new Map();
      this.loadedPlugins = new Set();
      this.enabledPlugins = new Set();
      this.pluginOrder = [];
      this.hooks = new Map();
      this.events = new (typeof EventTarget !== 'undefined' ? EventTarget : class { addEventListener(){} removeEventListener(){} dispatchEvent(){return true;} })();
      this._initDefaultHooks();
    }

    _initDefaultHooks() {
      this.hooks.set('beforeInit', []);
      this.hooks.set('afterInit', []);
      this.hooks.set('beforeUpdate', []);
      this.hooks.set('afterUpdate', []);
      this.hooks.set('beforeRender', []);
      this.hooks.set('afterRender', []);
      this.hooks.set('beforeDestroy', []);
      this.hooks.set('afterDestroy', []);
      this.hooks.set('onResize', []);
      this.hooks.set('onError', []);
      this.hooks.set('onSceneLoad', []);
      this.hooks.set('onSceneUnload', []);
    }

    register(pluginDefinition) {
      const plugin = {
        id: pluginDefinition.id || `plugin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: pluginDefinition.name || 'Unnamed Plugin',
        version: pluginDefinition.version || '1.0.0',
        author: pluginDefinition.author || 'Unknown',
        description: pluginDefinition.description || '',
        dependencies: pluginDefinition.dependencies || [],
        priority: pluginDefinition.priority || 100,
        enabled: true,
        initialized: false,
        instance: null,
        definition: pluginDefinition
      };
      if (this.plugins.has(plugin.id)) {
        console.warn(`Plugin ${plugin.id} already registered, overwriting`);
      }
      this.plugins.set(plugin.id, plugin);
      this._updatePluginOrder();
      return plugin.id;
    }

    unregister(pluginId) {
      const plugin = this.plugins.get(pluginId);
      if (!plugin) return false;
      if (plugin.initialized) this.unload(pluginId);
      this.plugins.delete(pluginId);
      this._updatePluginOrder();
      return true;
    }

    load(pluginId) {
      const plugin = this.plugins.get(pluginId);
      if (!plugin) {
        console.error(`Plugin ${pluginId} not found`);
        return false;
      }
      if (plugin.initialized) {
        console.warn(`Plugin ${pluginId} already loaded`);
        return true;
      }
      for (const dep of plugin.dependencies) {
        if (!this.plugins.has(dep)) {
          console.error(`Plugin ${pluginId} requires dependency ${dep} which is not registered`);
          return false;
        }
        if (!this.plugins.get(dep).initialized) {
          if (!this.load(dep)) {
            console.error(`Failed to load dependency ${dep} for plugin ${pluginId}`);
            return false;
          }
        }
      }
      try {
        if (typeof plugin.definition.init === 'function') {
          plugin.instance = plugin.definition.init(this.engine) || {};
        } else {
          plugin.instance = {};
        }
        plugin.initialized = true;
        this.loadedPlugins.add(pluginId);
        this.enabledPlugins.add(pluginId);
        this._registerHooks(plugin);
        this.events.dispatchEvent(new CustomEvent('pluginLoaded', { detail: { pluginId } }));
        this.log(`Plugin loaded: ${plugin.name} v${plugin.version}`);
        return true;
      } catch (error) {
        console.error(`Failed to load plugin ${pluginId}:`, error);
        plugin.initialized = false;
        return false;
      }
    }

    unload(pluginId) {
      const plugin = this.plugins.get(pluginId);
      if (!plugin || !plugin.initialized) return false;
      try {
        if (typeof plugin.definition.destroy === 'function') {
          plugin.definition.destroy(this.engine, plugin.instance);
        }
        this._unregisterHooks(plugin);
        plugin.initialized = false;
        plugin.instance = null;
        this.loadedPlugins.delete(pluginId);
        this.enabledPlugins.delete(pluginId);
        this.events.dispatchEvent(new CustomEvent('pluginUnloaded', { detail: { pluginId } }));
        this.log(`Plugin unloaded: ${plugin.name}`);
        return true;
      } catch (error) {
        console.error(`Failed to unload plugin ${pluginId}:`, error);
        return false;
      }
    }

    enable(pluginId) {
      const plugin = this.plugins.get(pluginId);
      if (plugin) {
        plugin.enabled = true;
        this.enabledPlugins.add(pluginId);
      }
    }

    disable(pluginId) {
      const plugin = this.plugins.get(pluginId);
      if (plugin) {
        plugin.enabled = false;
        this.enabledPlugins.delete(pluginId);
      }
    }

    _registerHooks(plugin) {
      if (!plugin.definition.hooks) return;
      for (const [hookName, handler] of Object.entries(plugin.definition.hooks)) {
        if (!this.hooks.has(hookName)) this.hooks.set(hookName, []);
        this.hooks.get(hookName).push({ pluginId: plugin.id, handler });
      }
    }

    _unregisterHooks(plugin) {
      for (const [hookName, handlers] of this.hooks) {
        this.hooks.set(hookName, handlers.filter(h => h.pluginId !== plugin.id));
      }
    }

    triggerHook(hookName, ...args) {
      const handlers = this.hooks.get(hookName);
      if (!handlers) return;
      for (const { pluginId, handler } of handlers) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin || !plugin.enabled || !plugin.initialized) continue;
        try {
          handler.call(plugin.instance, this.engine, ...args);
        } catch (error) {
          console.error(`Hook ${hookName} in plugin ${pluginId} failed:`, error);
        }
      }
    }

    _updatePluginOrder() {
      this.pluginOrder = Array.from(this.plugins.values())
        .sort((a, b) => a.priority - b.priority)
        .map(p => p.id);
    }

    loadAll() {
      let loaded = 0;
      for (const pluginId of this.pluginOrder) {
        if (this.load(pluginId)) loaded++;
      }
      return loaded;
    }

    unloadAll() {
      let unloaded = 0;
      for (const pluginId of [...this.pluginOrder].reverse()) {
        if (this.unload(pluginId)) unloaded++;
      }
      return unloaded;
    }

    getPlugin(pluginId) {
      return this.plugins.get(pluginId);
    }

    getPluginInstance(pluginId) {
      return this.plugins.get(pluginId)?.instance;
    }

    getRegisteredPlugins() {
      return Array.from(this.plugins.values()).map(p => ({
        id: p.id, name: p.name, version: p.version, author: p.author,
        description: p.description, priority: p.priority, enabled: p.enabled,
        initialized: p.initialized, dependencies: p.dependencies
      }));
    }

    getLoadedPlugins() {
      return Array.from(this.loadedPlugins);
    }

    getEnabledPlugins() {
      return Array.from(this.enabledPlugins);
    }

    isLoaded(pluginId) {
      return this.loadedPlugins.has(pluginId);
    }

    isEnabled(pluginId) {
      return this.enabledPlugins.has(pluginId);
    }

    getPluginCount() {
      return this.plugins.size;
    }

    getLoadedCount() {
      return this.loadedPlugins.size;
    }

    addEventListener(type, listener) {
      this.events.addEventListener(type, listener);
    }

    removeEventListener(type, listener) {
      this.events.removeEventListener(type, listener);
    }

    log(message) {
      if (this.engine?.debug) this.engine.debug.log('[PluginSystem]', message);
    }

    dispose() {
      this.unloadAll();
      this.plugins.clear();
      this.loadedPlugins.clear();
      this.enabledPlugins.clear();
      this.pluginOrder = [];
      this.hooks.clear();
    }
  }

  // ============================================================
  // 输入系统 - 键盘/鼠标/触摸/游戏手柄
  // ============================================================
  class InputSystem {
    constructor(canvas = null) {
      this.canvas = canvas;
      this.keys = new Map();
      this.mouse = { x: 0, y: 0, deltaX: 0, deltaY: 0, buttons: [false, false, false], wheel: 0, wheelDelta: 0 };
      this.touches = new Map();
      this.gamepads = [];
      this.events = new (typeof EventTarget !== 'undefined' ? EventTarget : class { addEventListener(){} removeEventListener(){} dispatchEvent(){return true;} })();
      this.enabled = true;
      this.lockPointer = false;
      this._lastMouseX = 0;
      this._lastMouseY = 0;
      this._initEventListeners();
    }

    _initEventListeners() {
      if (typeof window === 'undefined') return;
      window.addEventListener('keydown', (e) => {
        if (!this.enabled) return;
        this.keys.set(e.code, { pressed: true, time: Date.now(), repeat: e.repeat });
        this.events.dispatchEvent(new CustomEvent('keydown', { detail: { code: e.code, key: e.key, repeat: e.repeat } }));
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      });
      window.addEventListener('keyup', (e) => {
        if (!this.enabled) return;
        this.keys.set(e.code, { pressed: false, time: Date.now(), repeat: false });
        this.events.dispatchEvent(new CustomEvent('keyup', { detail: { code: e.code, key: e.key } }));
      });
      const target = this.canvas || window;
      target.addEventListener('mousemove', (e) => {
        if (!this.enabled) return;
        const rect = this.canvas?.getBoundingClientRect?.() || { left: 0, top: 0 };
        this.mouse.x = e.clientX - rect.left;
        this.mouse.y = e.clientY - rect.top;
        this.mouse.deltaX = this.mouse.x - this._lastMouseX;
        this.mouse.deltaY = this.mouse.y - this._lastMouseY;
        this._lastMouseX = this.mouse.x;
        this._lastMouseY = this.mouse.y;
        this.events.dispatchEvent(new CustomEvent('mousemove', { detail: { x: this.mouse.x, y: this.mouse.y, deltaX: this.mouse.deltaX, deltaY: this.mouse.deltaY } }));
      });
      target.addEventListener('mousedown', (e) => {
        if (!this.enabled) return;
        this.mouse.buttons[e.button] = true;
        this.events.dispatchEvent(new CustomEvent('mousedown', { detail: { button: e.button, x: this.mouse.x, y: this.mouse.y } }));
      });
      target.addEventListener('mouseup', (e) => {
        if (!this.enabled) return;
        this.mouse.buttons[e.button] = false;
        this.events.dispatchEvent(new CustomEvent('mouseup', { detail: { button: e.button, x: this.mouse.x, y: this.mouse.y } }));
      });
      target.addEventListener('wheel', (e) => {
        if (!this.enabled) return;
        this.mouse.wheelDelta = e.deltaY;
        this.mouse.wheel += e.deltaY;
        this.events.dispatchEvent(new CustomEvent('wheel', { detail: { deltaY: e.deltaY, deltaX: e.deltaX } }));
        e.preventDefault();
      }, { passive: false });
      target.addEventListener('contextmenu', (e) => e.preventDefault());
      target.addEventListener('touchstart', (e) => {
        if (!this.enabled) return;
        for (const touch of e.changedTouches) {
          const rect = this.canvas?.getBoundingClientRect?.() || { left: 0, top: 0 };
          this.touches.set(touch.identifier, {
            id: touch.identifier,
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top,
            startX: touch.clientX - rect.left,
            startY: touch.clientY - rect.top,
            startTime: Date.now()
          });
        }
        this.events.dispatchEvent(new CustomEvent('touchstart', { detail: { touches: this.getTouches() } }));
        e.preventDefault();
      }, { passive: false });
      target.addEventListener('touchmove', (e) => {
        if (!this.enabled) return;
        for (const touch of e.changedTouches) {
          const existing = this.touches.get(touch.identifier);
          if (existing) {
            const rect = this.canvas?.getBoundingClientRect?.() || { left: 0, top: 0 };
            existing.x = touch.clientX - rect.left;
            existing.y = touch.clientY - rect.top;
          }
        }
        this.events.dispatchEvent(new CustomEvent('touchmove', { detail: { touches: this.getTouches() } }));
        e.preventDefault();
      }, { passive: false });
      target.addEventListener('touchend', (e) => {
        if (!this.enabled) return;
        for (const touch of e.changedTouches) {
          this.touches.delete(touch.identifier);
        }
        this.events.dispatchEvent(new CustomEvent('touchend', { detail: { touches: this.getTouches() } }));
        e.preventDefault();
      }, { passive: false });
      if (typeof navigator !== 'undefined' && navigator.getGamepads) {
        window.addEventListener('gamepadconnected', (e) => {
          this.gamepads[e.gamepad.index] = { connected: true, id: e.gamepad.id, buttons: [], axes: [] };
          this.events.dispatchEvent(new CustomEvent('gamepadconnected', { detail: { index: e.gamepad.index, id: e.gamepad.id } }));
        });
        window.addEventListener('gamepaddisconnected', (e) => {
          if (this.gamepads[e.gamepad.index]) {
            this.gamepads[e.gamepad.index].connected = false;
          }
          this.events.dispatchEvent(new CustomEvent('gamepaddisconnected', { detail: { index: e.gamepad.index } }));
        });
      }
    }

    update() {
      this.mouse.deltaX = 0;
      this.mouse.deltaY = 0;
      this.mouse.wheelDelta = 0;
      if (typeof navigator !== 'undefined' && navigator.getGamepads) {
        const pads = navigator.getGamepads();
        for (let i = 0; i < pads.length; i++) {
          if (pads[i]) {
            this.gamepads[i] = {
              connected: true,
              id: pads[i].id,
              buttons: pads[i].buttons.map(b => ({ pressed: b.pressed, value: b.value })),
              axes: [...pads[i].axes]
            };
          }
        }
      }
    }

    isKeyPressed(code) {
      return this.keys.get(code)?.pressed || false;
    }

    wasKeyPressed(code) {
      const key = this.keys.get(code);
      if (!key || !key.pressed) return false;
      const wasPressed = key._wasPressed;
      key._wasPressed = true;
      return !wasPressed;
    }

    getKeyState(code) {
      return this.keys.get(code) || { pressed: false, time: 0, repeat: false };
    }

    getPressedKeys() {
      return Array.from(this.keys.entries()).filter(([_, v]) => v.pressed).map(([k]) => k);
    }

    isMouseButtonPressed(button = 0) {
      return this.mouse.buttons[button] || false;
    }

    getMousePosition() {
      return { x: this.mouse.x, y: this.mouse.y };
    }

    getMouseDelta() {
      return { x: this.mouse.deltaX, y: this.mouse.deltaY };
    }

    getMouseWheel() {
      return this.mouse.wheel;
    }

    getMouseWheelDelta() {
      return this.mouse.wheelDelta;
    }

    getTouches() {
      return Array.from(this.touches.values());
    }

    getTouchCount() {
      return this.touches.size;
    }

    getGamepad(index = 0) {
      return this.gamepads[index] || null;
    }

    getConnectedGamepads() {
      return this.gamepads.filter(g => g?.connected);
    }

    isGamepadButtonPressed(gamepadIndex, buttonIndex) {
      return this.gamepads[gamepadIndex]?.buttons[buttonIndex]?.pressed || false;
    }

    getGamepadAxis(gamepadIndex, axisIndex) {
      return this.gamepads[gamepadIndex]?.axes[axisIndex] || 0;
    }

    setCanvas(canvas) {
      this.canvas = canvas;
    }

    setEnabled(v) {
      this.enabled = v;
    }

    reset() {
      this.keys.clear();
      this.mouse = { x: 0, y: 0, deltaX: 0, deltaY: 0, buttons: [false, false, false], wheel: 0, wheelDelta: 0 };
      this.touches.clear();
    }

    addEventListener(type, listener) {
      this.events.addEventListener(type, listener);
    }

    removeEventListener(type, listener) {
      this.events.removeEventListener(type, listener);
    }

    dispose() {
      this.reset();
      this.gamepads = [];
    }
  }

  return {
    Utils, DebugSystem, PluginSystem, InputSystem
  };
})();

if (typeof window !== 'undefined') window.EngineCoreExt = EngineCoreExt;
if (typeof globalThis !== 'undefined') globalThis.EngineCoreExt = EngineCoreExt;
