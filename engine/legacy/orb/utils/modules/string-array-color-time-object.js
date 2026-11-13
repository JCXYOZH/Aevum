const StringUtils = {
  format: function(template){
    const args = Array.prototype.slice.call(arguments, 1);
    return template.replace(/\{(\d+)\}/g, function(match, index){
      return args[index] !== undefined ? args[index] : match;
    });
  },
  formatNamed: function(template, values){
    return template.replace(/\{(\w+)\}/g, function(match, key){
      return values[key] !== undefined ? values[key] : match;
    });
  },
  truncate: function(str, maxLength, suffix){
    if(str.length <= maxLength) return str;
    return str.substring(0, maxLength - (suffix || '...').length) + (suffix || '...');
  },
  padStart: function(str, targetLength, padString){
    padString = padString || ' ';
    while(str.length < targetLength){
      str = padString + str;
    }
    return str.substring(0, targetLength);
  },
  padEnd: function(str, targetLength, padString){
    padString = padString || ' ';
    while(str.length < targetLength){
      str = str + padString;
    }
    return str.substring(0, targetLength);
  },
  capitalize: function(str){
    return str.charAt(0).toUpperCase() + str.slice(1);
  },
  camelCase: function(str){
    return str.replace(/(?:^\w|[A-Z]|\b\w)/g, function(letter, index){
      return index === 0 ? letter.toLowerCase() : letter.toUpperCase();
    }).replace(/[\s_-]+/g, '');
  },
  snakeCase: function(str){
    return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/[\s-]+/g, '_').replace(/^_/, '');
  },
  kebabCase: function(str){
    return str.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/[\s_]+/g, '-').replace(/^-/, '');
  },
  titleCase: function(str){
    return str.replace(/\w\S*/g, function(txt){
      return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    });
  },
  reverse: function(str){
    return str.split('').reverse().join('');
  },
  countOccurrences: function(str, substring){
    let count = 0;
    let pos = 0;
    while((pos = str.indexOf(substring, pos)) !== -1){
      count++;
      pos += substring.length;
    }
    return count;
  },
  isEmpty: function(str){
    return !str || str.trim().length === 0;
  },
  isAlpha: function(str){
    return /^[a-zA-Z]+$/.test(str);
  },
  isNumeric: function(str){
    return /^-?\d+\.?\d*$/.test(str);
  },
  isAlphanumeric: function(str){
    return /^[a-zA-Z0-9]+$/.test(str);
  },
  isEmail: function(str){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
  },
  isURL: function(str){
    try{
      new URL(str);
      return true;
    } catch(e){
      return false;
    }
  },
  slugify: function(str){
    return str.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
  },
  escapeHTML: function(str){
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
  unescapeHTML: function(str){
    const div = document.createElement('div');
    div.innerHTML = str;
    return div.textContent;
  },
  removeWhitespace: function(str){
    return str.replace(/\s+/g, '');
  },
  normalizeWhitespace: function(str){
    return str.replace(/\s+/g, ' ').trim();
  },
  repeat: function(str, count){
    let result = '';
    for(let i = 0; i < count; i++) result += str;
    return result;
  },
  startsWith: function(str, prefix){
    return str.substring(0, prefix.length) === prefix;
  },
  endsWith: function(str, suffix){
    return str.substring(str.length - suffix.length) === suffix;
  },
  between: function(str, start, end){
    const startIdx = str.indexOf(start);
    if(startIdx === -1) return '';
    const endIdx = str.indexOf(end, startIdx + start.length);
    if(endIdx === -1) return '';
    return str.substring(startIdx + start.length, endIdx);
  },
  toNumber: function(str){
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
  },
  toBoolean: function(str){
    return str === 'true' || str === '1' || str === 'yes';
  },
  levenshteinDistance: function(a, b){
    const matrix = [];
    for(let i = 0; i <= b.length; i++) matrix[i] = [i];
    for(let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for(let i = 1; i <= b.length; i++){
      for(let j = 1; j <= a.length; j++){
        if(b.charAt(i-1) === a.charAt(j-1)){
          matrix[i][j] = matrix[i-1][j-1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i-1][j-1] + 1,
            matrix[i][j-1] + 1,
            matrix[i-1][j] + 1
          );
        }
      }
    }
    return matrix[b.length][a.length];
  },
  similarity: function(a, b){
    const longer = a.length > b.length ? a : b;
    if(longer.length === 0) return 1;
    const distance = StringUtils.levenshteinDistance(a, b);
    return (longer.length - distance) / longer.length;
  }
};

/* ===== 数组工具库 =====
   支持: 去重 / 分组 / 分块 / 扁平化 / 随机
*/
const ArrayUtils = {
  unique: function(arr){
    return [...new Set(arr)];
  },
  uniqueBy: function(arr, key){
    const seen = new Set();
    return arr.filter(function(item){
      const k = typeof key === 'function' ? key(item) : item[key];
      if(seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  },
  groupBy: function(arr, key){
    return arr.reduce(function(result, item){
      const k = typeof key === 'function' ? key(item) : item[key];
      if(!result[k]) result[k] = [];
      result[k].push(item);
      return result;
    }, {});
  },
  chunk: function(arr, size){
    const chunks = [];
    for(let i = 0; i < arr.length; i += size){
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  },
  flatten: function(arr, depth){
    if(depth === undefined) depth = 1;
    if(depth <= 0) return arr.slice();
    return arr.reduce(function(result, item){
      if(Array.isArray(item)){
        return result.concat(ArrayUtils.flatten(item, depth - 1));
      }
      result.push(item);
      return result;
    }, []);
  },
  flattenDeep: function(arr){
    return ArrayUtils.flatten(arr, Infinity);
  },
  shuffle: function(arr){
    const result = [...arr];
    for(let i = result.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  },
  sample: function(arr){
    return arr[Math.floor(Math.random() * arr.length)];
  },
  sampleSize: function(arr, n){
    return ArrayUtils.shuffle(arr).slice(0, n);
  },
  compact: function(arr){
    return arr.filter(Boolean);
  },
  without: function(arr){
    const values = Array.prototype.slice.call(arguments, 1);
    return arr.filter(function(item){
      return values.indexOf(item) === -1;
    });
  },
  intersection: function(){
    const arrays = Array.prototype.slice.call(arguments);
    if(arrays.length === 0) return [];
    return arrays[0].filter(function(item){
      return arrays.every(function(arr){
        return arr.indexOf(item) !== -1;
      });
    });
  },
  difference: function(arr1, arr2){
    return arr1.filter(function(item){
      return arr2.indexOf(item) === -1;
    });
  },
  union: function(){
    return ArrayUtils.unique(ArrayUtils.flatten(Array.prototype.slice.call(arguments)));
  },
  partition: function(arr, predicate){
    const pass = [], fail = [];
    for(let i = 0; i < arr.length; i++){
      if(predicate(arr[i])) pass.push(arr[i]);
      else fail.push(arr[i]);
    }
    return [pass, fail];
  },
  zip: function(){
    const arrays = Array.prototype.slice.call(arguments);
    const length = Math.min.apply(null, arrays.map(function(a){ return a.length; }));
    const result = [];
    for(let i = 0; i < length; i++){
      result.push(arrays.map(function(a){ return a[i]; }));
    }
    return result;
  },
  unzip: function(arr){
    if(arr.length === 0) return [];
    const length = arr[0].length;
    const result = [];
    for(let i = 0; i < length; i++){
      result.push(arr.map(function(a){ return a[i]; }));
    }
    return result;
  },
  range: function(start, end, step){
    if(end === undefined){ end = start; start = 0; }
    step = step || 1;
    const result = [];
    for(let i = start; i < end; i += step){
      result.push(i);
    }
    return result;
  },
  sum: function(arr){
    return arr.reduce(function(a, b){ return a + b; }, 0);
  },
  average: function(arr){
    return arr.length > 0 ? ArrayUtils.sum(arr) / arr.length : 0;
  },
  median: function(arr){
    const sorted = [...arr].sort(function(a, b){ return a - b; });
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  },
  mode: function(arr){
    const frequency = {};
    let maxFreq = 0;
    let result = [];
    for(let i = 0; i < arr.length; i++){
      frequency[arr[i]] = (frequency[arr[i]] || 0) + 1;
      if(frequency[arr[i]] > maxFreq){
        maxFreq = frequency[arr[i]];
        result = [arr[i]];
      } else if(frequency[arr[i]] === maxFreq){
        result.push(arr[i]);
      }
    }
    return result;
  },
  min: function(arr){
    return Math.min.apply(null, arr);
  },
  max: function(arr){
    return Math.max.apply(null, arr);
  },
  first: function(arr, n){
    if(n === undefined) return arr[0];
    return arr.slice(0, n);
  },
  last: function(arr, n){
    if(n === undefined) return arr[arr.length - 1];
    return arr.slice(Math.max(arr.length - n, 0));
  },
  initial: function(arr){
    return arr.slice(0, -1);
  },
  rest: function(arr){
    return arr.slice(1);
  },
  fill: function(arr, value, start, end){
    const result = [...arr];
    const s = start || 0;
    const e = end || result.length;
    for(let i = s; i < e; i++) result[i] = value;
    return result;
  },
  removeDuplicates: function(arr){
    return ArrayUtils.unique(arr);
  },
  countBy: function(arr, key){
    return arr.reduce(function(result, item){
      const k = typeof key === 'function' ? key(item) : item[key];
      result[k] = (result[k] || 0) + 1;
      return result;
    }, {});
  },
  pluck: function(arr, key){
    return arr.map(function(item){ return item[key]; });
  },
  sortBy: function(arr, key, order){
    const dir = order === 'desc' ? -1 : 1;
    return [...arr].sort(function(a, b){
      const va = typeof key === 'function' ? key(a) : a[key];
      const vb = typeof key === 'function' ? key(b) : b[key];
      if(va < vb) return -1 * dir;
      if(va > vb) return 1 * dir;
      return 0;
    });
  },
  debounce: function(fn, delay){
    let timer = null;
    return function(){
      const args = arguments;
      const context = this;
      clearTimeout(timer);
      timer = setTimeout(function(){
        fn.apply(context, args);
      }, delay);
    };
  },
  throttle: function(fn, limit){
    let inThrottle = false;
    return function(){
      const args = arguments;
      const context = this;
      if(!inThrottle){
        fn.apply(context, args);
        inThrottle = true;
        setTimeout(function(){
          inThrottle = false;
        }, limit);
      }
    };
  },
  memoize: function(fn){
    const cache = new Map();
    return function(){
      const key = JSON.stringify(arguments);
      if(cache.has(key)) return cache.get(key);
      const result = fn.apply(this, arguments);
      cache.set(key, result);
      return result;
    };
  },
  once: function(fn){
    let called = false;
    let result;
    return function(){
      if(!called){
        called = true;
        result = fn.apply(this, arguments);
      }
      return result;
    };
  },
  curry: function(fn){
    const arity = fn.length;
    return function curried(){
      const args = Array.prototype.slice.call(arguments);
      if(args.length >= arity){
        return fn.apply(this, args);
      }
      return function(){
        return curried.apply(this, args.concat(Array.prototype.slice.call(arguments)));
      };
    };
  },
  compose: function(){
    const fns = Array.prototype.slice.call(arguments);
    return function(){
      let result = fns[fns.length - 1].apply(this, arguments);
      for(let i = fns.length - 2; i >= 0; i--){
        result = fns[i](result);
      }
      return result;
    };
  },
  pipe: function(){
    const fns = Array.prototype.slice.call(arguments);
    return function(){
      let result = fns[0].apply(this, arguments);
      for(let i = 1; i < fns.length; i++){
        result = fns[i](result);
      }
      return result;
    };
  }
};

/* ===== 颜色工具库 =====
   支持: RGB/HSL/HEX转换 / 混合 / 亮度 / 对比度
*/
const ColorUtils = {
  hexToRgb: function(hex){
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  },
  rgbToHex: function(r, g, b){
    return '#' + [r, g, b].map(function(x){
      const hex = Math.round(Math.max(0, Math.min(255, x))).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
  },
  rgbToHsl: function(r, g, b){
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if(max === min){
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch(max){
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  },
  hslToRgb: function(h, s, l){
    h /= 360; s /= 100; l /= 100;
    let r, g, b;
    if(s === 0){
      r = g = b = l;
    } else {
      const hue2rgb = function(p, q, t){
        if(t < 0) t += 1;
        if(t > 1) t -= 1;
        if(t < 1/6) return p + (q - p) * 6 * t;
        if(t < 1/2) return q;
        if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
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
  mix: function(color1, color2, ratio){
    ratio = ratio !== undefined ? ratio : 0.5;
    return {
      r: Math.round(color1.r + (color2.r - color1.r) * ratio),
      g: Math.round(color1.g + (color2.g - color1.g) * ratio),
      b: Math.round(color1.b + (color2.b - color1.b) * ratio)
    };
  },
  lighten: function(color, amount){
    const hsl = ColorUtils.rgbToHsl(color.r, color.g, color.b);
    hsl.l = Math.min(100, hsl.l + amount);
    return ColorUtils.hslToRgb(hsl.h, hsl.s, hsl.l);
  },
  darken: function(color, amount){
    const hsl = ColorUtils.rgbToHsl(color.r, color.g, color.b);
    hsl.l = Math.max(0, hsl.l - amount);
    return ColorUtils.hslToRgb(hsl.h, hsl.s, hsl.l);
  },
  saturate: function(color, amount){
    const hsl = ColorUtils.rgbToHsl(color.r, color.g, color.b);
    hsl.s = Math.min(100, hsl.s + amount);
    return ColorUtils.hslToRgb(hsl.h, hsl.s, hsl.l);
  },
  desaturate: function(color, amount){
    const hsl = ColorUtils.rgbToHsl(color.r, color.g, color.b);
    hsl.s = Math.max(0, hsl.s - amount);
    return ColorUtils.hslToRgb(hsl.h, hsl.s, hsl.l);
  },
  rotateHue: function(color, degrees){
    const hsl = ColorUtils.rgbToHsl(color.r, color.g, color.b);
    hsl.h = (hsl.h + degrees) % 360;
    if(hsl.h < 0) hsl.h += 360;
    return ColorUtils.hslToRgb(hsl.h, hsl.s, hsl.l);
  },
  luminance: function(color){
    return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
  },
  contrast: function(color1, color2){
    const l1 = ColorUtils.luminance(color1);
    const l2 = ColorUtils.luminance(color2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  },
  isLight: function(color){
    return ColorUtils.luminance(color) > 128;
  },
  isDark: function(color){
    return ColorUtils.luminance(color) <= 128;
  },
  complementary: function(color){
    return ColorUtils.rotateHue(color, 180);
  },
  analogous: function(color, count){
    count = count || 3;
    const colors = [];
    const step = 30;
    const start = -Math.floor(count / 2) * step;
    for(let i = 0; i < count; i++){
      colors.push(ColorUtils.rotateHue(color, start + i * step));
    }
    return colors;
  },
  triadic: function(color){
    return [
      color,
      ColorUtils.rotateHue(color, 120),
      ColorUtils.rotateHue(color, 240)
    ];
  },
  tetradic: function(color){
    return [
      color,
      ColorUtils.rotateHue(color, 90),
      ColorUtils.rotateHue(color, 180),
      ColorUtils.rotateHue(color, 270)
    ];
  },
  monochromatic: function(color, count){
    count = count || 5;
    const hsl = ColorUtils.rgbToHsl(color.r, color.g, color.b);
    const colors = [];
    for(let i = 0; i < count; i++){
      const l = 20 + (i / (count - 1)) * 60;
      colors.push(ColorUtils.hslToRgb(hsl.h, hsl.s, l));
    }
    return colors;
  },
  random: function(){
    return {
      r: Math.floor(Math.random() * 256),
      g: Math.floor(Math.random() * 256),
      b: Math.floor(Math.random() * 256)
    };
  },
  toArray: function(color){
    return [color.r / 255, color.g / 255, color.b / 255];
  },
  fromArray: function(arr){
    return { r: arr[0] * 255, g: arr[1] * 255, b: arr[2] * 255 };
  },
  toString: function(color){
    return 'rgb(' + color.r + ', ' + color.g + ', ' + color.b + ')';
  }
};



/* ===== 时间与日期工具库 =====
   支持: 格式化 / 解析 / 计算 / 时区
*/
const TimeUtils = {
  format: function(date, format){
    const d = date instanceof Date ? date : new Date(date);
    const map = {
      'YYYY': d.getFullYear(),
      'MM': String(d.getMonth() + 1).padStart(2, '0'),
      'DD': String(d.getDate()).padStart(2, '0'),
      'HH': String(d.getHours()).padStart(2, '0'),
      'mm': String(d.getMinutes()).padStart(2, '0'),
      'ss': String(d.getSeconds()).padStart(2, '0'),
      'SSS': String(d.getMilliseconds()).padStart(3, '0')
    };
    return format.replace(/YYYY|MM|DD|HH|mm|ss|SSS/g, function(match){
      return map[match];
    });
  },
  parse: function(str, format){
    const map = {
      'YYYY': 'year', 'MM': 'month', 'DD': 'day',
      'HH': 'hour', 'mm': 'minute', 'ss': 'second'
    };
    const result = { year: 1970, month: 0, day: 1, hour: 0, minute: 0, second: 0 };
    let strIdx = 0, fmtIdx = 0;
    while(fmtIdx < format.length && strIdx < str.length){
      let matched = false;
      for(const token in map){
        if(format.substring(fmtIdx, fmtIdx + token.length) === token){
          const len = token.length;
          const value = parseInt(str.substring(strIdx, strIdx + len));
          if(!isNaN(value)){
            if(map[token] === 'month') result.month = value - 1;
            else result[map[token]] = value;
          }
          strIdx += len;
          fmtIdx += len;
          matched = true;
          break;
        }
      }
      if(!matched){
        strIdx++;
        fmtIdx++;
      }
    }
    return new Date(result.year, result.month, result.day, result.hour, result.minute, result.second);
  },
  addDays: function(date, days){
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  },
  addHours: function(date, hours){
    const d = new Date(date);
    d.setHours(d.getHours() + hours);
    return d;
  },
  addMinutes: function(date, minutes){
    const d = new Date(date);
    d.setMinutes(d.getMinutes() + minutes);
    return d;
  },
  addSeconds: function(date, seconds){
    const d = new Date(date);
    d.setSeconds(d.getSeconds() + seconds);
    return d;
  },
  diffDays: function(date1, date2){
    return Math.floor((new Date(date2) - new Date(date1)) / (1000 * 60 * 60 * 24));
  },
  diffHours: function(date1, date2){
    return Math.floor((new Date(date2) - new Date(date1)) / (1000 * 60 * 60));
  },
  diffMinutes: function(date1, date2){
    return Math.floor((new Date(date2) - new Date(date1)) / (1000 * 60));
  },
  diffSeconds: function(date1, date2){
    return Math.floor((new Date(date2) - new Date(date1)) / 1000);
  },
  isSameDay: function(date1, date2){
    const d1 = new Date(date1), d2 = new Date(date2);
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
  },
  isToday: function(date){
    return TimeUtils.isSameDay(date, new Date());
  },
  isYesterday: function(date){
    return TimeUtils.isSameDay(date, TimeUtils.addDays(new Date(), -1));
  },
  isTomorrow: function(date){
    return TimeUtils.isSameDay(date, TimeUtils.addDays(new Date(), 1));
  },
  isLeapYear: function(year){
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  },
  getDaysInMonth: function(year, month){
    return new Date(year, month + 1, 0).getDate();
  },
  getDayOfYear: function(date){
    const d = new Date(date);
    const start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d - start) / (1000 * 60 * 60 * 24));
  },
  getWeekOfYear: function(date){
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  },
  startOfDay: function(date){
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  },
  endOfDay: function(date){
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
  },
  startOfWeek: function(date){
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
  },
  endOfWeek: function(date){
    const d = TimeUtils.startOfWeek(date);
    d.setDate(d.getDate() + 6);
    d.setHours(23, 59, 59, 999);
    return d;
  },
  startOfMonth: function(date){
    const d = new Date(date);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  },
  endOfMonth: function(date){
    const d = new Date(date);
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    d.setHours(23, 59, 59, 999);
    return d;
  },
  relativeTime: function(date){
    const now = new Date();
    const diff = now - new Date(date);
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if(seconds < 60) return '刚刚';
    if(minutes < 60) return minutes + '分钟前';
    if(hours < 24) return hours + '小时前';
    if(days < 7) return days + '天前';
    if(days < 30) return Math.floor(days / 7) + '周前';
    if(days < 365) return Math.floor(days / 30) + '个月前';
    return Math.floor(days / 365) + '年前';
  },
  formatDuration: function(ms){
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if(days > 0) return days + '天 ' + (hours % 24) + '小时';
    if(hours > 0) return hours + '小时 ' + (minutes % 60) + '分钟';
    if(minutes > 0) return minutes + '分钟 ' + (seconds % 60) + '秒';
    return seconds + '秒';
  },
  getTimezoneOffset: function(){
    return -new Date().getTimezoneOffset() / 60;
  },
  getTimezoneName: function(){
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  },
  toUTC: function(date){
    const d = new Date(date);
    return new Date(d.getTime() + d.getTimezoneOffset() * 60000);
  },
  fromUTC: function(date){
    const d = new Date(date);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  }
};

/* ===== 对象工具库 =====
   支持: 深拷贝 / 合并 / 比较 / 遍历 / 路径访问
*/
const ObjectUtils = {
  deepClone: function(obj){
    if(obj === null || typeof obj !== 'object') return obj;
    if(obj instanceof Date) return new Date(obj.getTime());
    if(obj instanceof Array) return obj.map(function(item){ return ObjectUtils.deepClone(item); });
    if(obj instanceof Map) return new Map(Array.from(obj.entries()).map(function([k, v]){ return [k, ObjectUtils.deepClone(v)]; }));
    if(obj instanceof Set) return new Set(Array.from(obj).map(function(v){ return ObjectUtils.deepClone(v); }));
    const result = {};
    for(const key in obj){
      if(obj.hasOwnProperty(key)){
        result[key] = ObjectUtils.deepClone(obj[key]);
      }
    }
    return result;
  },
  deepMerge: function(target, source){
    if(!source || typeof source !== 'object') return target;
    if(!target || typeof target !== 'object') return ObjectUtils.deepClone(source);
    if(source instanceof Array){
      return source.map(function(item){ return ObjectUtils.deepClone(item); });
    }
    const result = { ...target };
    for(const key in source){
      if(source.hasOwnProperty(key)){
        if(source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])){
          result[key] = ObjectUtils.deepMerge(result[key], source[key]);
        } else {
          result[key] = ObjectUtils.deepClone(source[key]);
        }
      }
    }
    return result;
  },
  deepEqual: function(a, b){
    if(a === b) return true;
    if(a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    if(a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if(a instanceof Array || b instanceof Array){
      if(!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      for(let i = 0; i < a.length; i++){
        if(!ObjectUtils.deepEqual(a[i], b[i])) return false;
      }
      return true;
    }
    const keysA = Object.keys(a), keysB = Object.keys(b);
    if(keysA.length !== keysB.length) return false;
    for(let i = 0; i < keysA.length; i++){
      if(!ObjectUtils.deepEqual(a[keysA[i]], b[keysA[i]])) return false;
    }
    return true;
  },
  get: function(obj, path, defaultValue){
    const keys = path.split('.');
    let current = obj;
    for(let i = 0; i < keys.length; i++){
      if(current === null || current === undefined) return defaultValue;
      current = current[keys[i]];
    }
    return current !== undefined ? current : defaultValue;
  },
  set: function(obj, path, value){
    const keys = path.split('.');
    let current = obj;
    for(let i = 0; i < keys.length - 1; i++){
      if(current[keys[i]] === undefined || current[keys[i]] === null){
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
    return obj;
  },
  has: function(obj, path){
    const keys = path.split('.');
    let current = obj;
    for(let i = 0; i < keys.length; i++){
      if(current === null || current === undefined || !(keys[i] in current)) return false;
      current = current[keys[i]];
    }
    return true;
  },
  delete: function(obj, path){
    const keys = path.split('.');
    let current = obj;
    for(let i = 0; i < keys.length - 1; i++){
      if(current === null || current === undefined) return false;
      current = current[keys[i]];
    }
    if(current && keys[keys.length - 1] in current){
      delete current[keys[keys.length - 1]];
      return true;
    }
    return false;
  },
  flatten: function(obj, prefix){
    prefix = prefix || '';
    const result = {};
    for(const key in obj){
      if(obj.hasOwnProperty(key)){
        const newKey = prefix ? prefix + '.' + key : key;
        if(obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key]) && !(obj[key] instanceof Date)){
          Object.assign(result, ObjectUtils.flatten(obj[key], newKey));
        } else {
          result[newKey] = obj[key];
        }
      }
    }
    return result;
  },
  unflatten: function(obj){
    const result = {};
    for(const key in obj){
      if(obj.hasOwnProperty(key)){
        ObjectUtils.set(result, key, obj[key]);
      }
    }
    return result;
  },
  pick: function(obj, keys){
    const result = {};
    for(let i = 0; i < keys.length; i++){
      if(keys[i] in obj) result[keys[i]] = obj[keys[i]];
    }
    return result;
  },
  omit: function(obj, keys){
    const result = { ...obj };
    for(let i = 0; i < keys.length; i++){
      delete result[keys[i]];
    }
    return result;
  },
  mapValues: function(obj, fn){
    const result = {};
    for(const key in obj){
      if(obj.hasOwnProperty(key)){
        result[key] = fn(obj[key], key);
      }
    }
    return result;
  },
  mapKeys: function(obj, fn){
    const result = {};
    for(const key in obj){
      if(obj.hasOwnProperty(key)){
        result[fn(obj[key], key)] = obj[key];
      }
    }
    return result;
  },
  filterValues: function(obj, predicate){
    const result = {};
    for(const key in obj){
      if(obj.hasOwnProperty(key) && predicate(obj[key], key)){
        result[key] = obj[key];
      }
    }
    return result;
  },
  findKey: function(obj, predicate){
    for(const key in obj){
      if(obj.hasOwnProperty(key) && predicate(obj[key], key)){
        return key;
      }
    }
    return undefined;
  },
  invert: function(obj){
    const result = {};
    for(const key in obj){
      if(obj.hasOwnProperty(key)){
        result[obj[key]] = key;
      }
    }
    return result;
  },
  size: function(obj){
    return Object.keys(obj).length;
  },
  isEmpty: function(obj){
    return Object.keys(obj).length === 0;
  },
  isPlainObject: function(obj){
    return obj !== null && typeof obj === 'object' && !Array.isArray(obj) && !(obj instanceof Date) && !(obj instanceof RegExp);
  },
  toQueryString: function(obj){
    const parts = [];
    for(const key in obj){
      if(obj.hasOwnProperty(key) && obj[key] !== undefined && obj[key] !== null){
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(obj[key]));
      }
    }
    return parts.join('&');
  },
  fromQueryString: function(str){
    const result = {};
    const pairs = str.replace(/^\?/, '').split('&');
    for(let i = 0; i < pairs.length; i++){
      const pair = pairs[i].split('=');
      if(pair[0]) result[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
    }
    return result;
  }
};

/* ===== 性能监控系统 =====
   支持: FPS / 帧时间 / 内存 / 调用计数 / 历史记录
*/