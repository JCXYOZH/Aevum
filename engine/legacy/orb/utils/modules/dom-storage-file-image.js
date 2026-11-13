const DOMUtils = {
  create: function(tag, attrs, children){
    const el = document.createElement(tag);
    if(attrs){
      for(const key in attrs){
        if(key === 'class') el.className = attrs[key];
        else if(key === 'style' && typeof attrs[key] === 'object') Object.assign(el.style, attrs[key]);
        else if(key.startsWith('on') && typeof attrs[key] === 'function') el.addEventListener(key.substring(2).toLowerCase(), attrs[key]);
        else if(key === 'dataset' && typeof attrs[key] === 'object') Object.assign(el.dataset, attrs[key]);
        else el.setAttribute(key, attrs[key]);
      }
    }
    if(children){
      if(typeof children === 'string') el.textContent = children;
      else if(children instanceof Node) el.appendChild(children);
      else if(Array.isArray(children)){
        children.forEach(function(child){
          if(typeof child === 'string') el.appendChild(document.createTextNode(child));
          else if(child instanceof Node) el.appendChild(child);
        });
      }
    }
    return el;
  },
  select: function(selector, context){
    return (context || document).querySelector(selector);
  },
  selectAll: function(selector, context){
    return Array.from((context || document).querySelectorAll(selector));
  },
  byId: function(id){
    return document.getElementById(id);
  },
  byClass: function(className, context){
    return Array.from((context || document).getElementsByClassName(className));
  },
  byTag: function(tagName, context){
    return Array.from((context || document).getElementsByTagName(tagName));
  },
  append: function(parent, child){
    if(typeof child === 'string') parent.appendChild(document.createTextNode(child));
    else parent.appendChild(child);
    return parent;
  },
  prepend: function(parent, child){
    if(typeof child === 'string') child = document.createTextNode(child);
    parent.insertBefore(child, parent.firstChild);
    return parent;
  },
  insertAfter: function(newNode, referenceNode){
    referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling);
    return newNode;
  },
  insertBefore: function(newNode, referenceNode){
    referenceNode.parentNode.insertBefore(newNode, referenceNode);
    return newNode;
  },
  remove: function(el){
    if(el && el.parentNode) el.parentNode.removeChild(el);
  },
  empty: function(el){
    while(el.firstChild) el.removeChild(el.firstChild);
  },
  replace: function(oldEl, newEl){
    oldEl.parentNode.replaceChild(newEl, oldEl);
    return newEl;
  },
  clone: function(el, deep){
    return el.cloneNode(deep !== false);
  },
  contains: function(parent, child){
    return parent.contains(child);
  },
  matches: function(el, selector){
    return el.matches(selector);
  },
  closest: function(el, selector){
    return el.closest(selector);
  },
  parent: function(el, selector){
    if(selector) return el.closest(selector);
    return el.parentNode;
  },
  children: function(el, selector){
    if(selector) return Array.from(el.children).filter(function(c){ return c.matches(selector); });
    return Array.from(el.children);
  },
  firstChild: function(el, selector){
    const children = DOMUtils.children(el, selector);
    return children.length > 0 ? children[0] : null;
  },
  lastChild: function(el, selector){
    const children = DOMUtils.children(el, selector);
    return children.length > 0 ? children[children.length - 1] : null;
  },
  siblings: function(el, selector){
    const siblings = Array.from(el.parentNode.children).filter(function(c){ return c !== el; });
    if(selector) return siblings.filter(function(s){ return s.matches(selector); });
    return siblings;
  },
  next: function(el, selector){
    let next = el.nextElementSibling;
    while(next && selector && !next.matches(selector)) next = next.nextElementSibling;
    return next;
  },
  prev: function(el, selector){
    let prev = el.previousElementSibling;
    while(prev && selector && !prev.matches(selector)) prev = prev.previousElementSibling;
    return prev;
  },
  index: function(el){
    return Array.from(el.parentNode.children).indexOf(el);
  },
  attr: function(el, name, value){
    if(value === undefined) return el.getAttribute(name);
    if(value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
    return el;
  },
  removeAttr: function(el, name){
    el.removeAttribute(name);
    return el;
  },
  hasAttr: function(el, name){
    return el.hasAttribute(name);
  },
  data: function(el, key, value){
    if(value === undefined) return el.dataset[key];
    el.dataset[key] = value;
    return el;
  },
  text: function(el, value){
    if(value === undefined) return el.textContent;
    el.textContent = value;
    return el;
  },
  html: function(el, value){
    if(value === undefined) return el.innerHTML;
    el.innerHTML = value;
    return el;
  },
  val: function(el, value){
    if(value === undefined) return el.value;
    el.value = value;
    return el;
  },
  addClass: function(el, className){
    el.classList.add(className);
    return el;
  },
  removeClass: function(el, className){
    el.classList.remove(className);
    return el;
  },
  toggleClass: function(el, className, force){
    el.classList.toggle(className, force);
    return el;
  },
  hasClass: function(el, className){
    return el.classList.contains(className);
  },
  replaceClass: function(el, oldClass, newClass){
    el.classList.replace(oldClass, newClass);
    return el;
  },
  css: function(el, prop, value){
    if(typeof prop === 'object'){
      Object.assign(el.style, prop);
      return el;
    }
    if(value === undefined) return getComputedStyle(el).getPropertyValue(prop);
    el.style[prop] = value;
    return el;
  },
  show: function(el, display){
    el.style.display = display || '';
    return el;
  },
  hide: function(el){
    el.style.display = 'none';
    return el;
  },
  toggle: function(el){
    el.style.display = el.style.display === 'none' ? '' : 'none';
    return el;
  },
  isVisible: function(el){
    return el.offsetParent !== null;
  },
  width: function(el, value){
    if(value === undefined) return el.offsetWidth;
    el.style.width = value + 'px';
    return el;
  },
  height: function(el, value){
    if(value === undefined) return el.offsetHeight;
    el.style.height = value + 'px';
    return el;
  },
  position: function(el){
    return { left: el.offsetLeft, top: el.offsetTop };
  },
  offset: function(el){
    const rect = el.getBoundingClientRect();
    return {
      top: rect.top + window.pageYOffset,
      left: rect.left + window.pageXOffset,
      width: rect.width,
      height: rect.height
    };
  },
  rect: function(el){
    return el.getBoundingClientRect();
  },
  scrollTop: function(el, value){
    const target = el || window;
    if(value === undefined) return target === window ? window.pageYOffset : target.scrollTop;
    if(target === window) window.scrollTo(0, value);
    else target.scrollTop = value;
    return target;
  },
  scrollLeft: function(el, value){
    const target = el || window;
    if(value === undefined) return target === window ? window.pageXOffset : target.scrollLeft;
    if(target === window) window.scrollTo(value, 0);
    else target.scrollLeft = value;
    return target;
  },
  scrollIntoView: function(el, behavior){
    el.scrollIntoView({ behavior: behavior || 'smooth', block: 'start' });
    return el;
  },
  focus: function(el){
    el.focus();
    return el;
  },
  blur: function(el){
    el.blur();
    return el;
  },
  disabled: function(el, value){
    if(value === undefined) return el.disabled;
    el.disabled = value;
    return el;
  },
  checked: function(el, value){
    if(value === undefined) return el.checked;
    el.checked = value;
    return el;
  },
  serializeForm: function(form){
    const formData = new FormData(form);
    const result = {};
    for(const [key, value] of formData.entries()){
      if(result[key]){
        if(!Array.isArray(result[key])) result[key] = [result[key]];
        result[key].push(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  },
  resetForm: function(form){
    form.reset();
    return form;
  },
  on: function(el, event, handler, options){
    el.addEventListener(event, handler, options);
    return el;
  },
  off: function(el, event, handler, options){
    el.removeEventListener(event, handler, options);
    return el;
  },
  once: function(el, event, handler, options){
    el.addEventListener(event, handler, { ...options, once: true });
    return el;
  },
  trigger: function(el, event, detail){
    const evt = new CustomEvent(event, { detail: detail, bubbles: true, cancelable: true });
    el.dispatchEvent(evt);
    return el;
  },
  delegate: function(parent, selector, event, handler){
    parent.addEventListener(event, function(e){
      const target = e.target.closest(selector);
      if(target && parent.contains(target)) handler.call(target, e);
    });
    return parent;
  }
};

/* ===== 存储工具库 =====
   支持: LocalStorage / SessionStorage / Cookie / 内存缓存
*/
const StorageUtils = {
  local: {
    set: function(key, value){
      try{
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch(e){
        console.error('[Storage] LocalStorage set error:', e);
        return false;
      }
    },
    get: function(key, defaultValue){
      try{
        const value = localStorage.getItem(key);
        return value !== null ? JSON.parse(value) : defaultValue;
      } catch(e){
        return defaultValue;
      }
    },
    remove: function(key){
      localStorage.removeItem(key);
    },
    clear: function(){
      localStorage.clear();
    },
    has: function(key){
      return localStorage.getItem(key) !== null;
    },
    keys: function(){
      return Object.keys(localStorage);
    },
    size: function(){
      return localStorage.length;
    },
    forEach: function(callback){
      for(let i = 0; i < localStorage.length; i++){
        const key = localStorage.key(i);
        callback(key, StorageUtils.local.get(key));
      }
    }
  },
  session: {
    set: function(key, value){
      try{
        sessionStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch(e){
        return false;
      }
    },
    get: function(key, defaultValue){
      try{
        const value = sessionStorage.getItem(key);
        return value !== null ? JSON.parse(value) : defaultValue;
      } catch(e){
        return defaultValue;
      }
    },
    remove: function(key){
      sessionStorage.removeItem(key);
    },
    clear: function(){
      sessionStorage.clear();
    },
    has: function(key){
      return sessionStorage.getItem(key) !== null;
    },
    keys: function(){
      return Object.keys(sessionStorage);
    },
    size: function(){
      return sessionStorage.length;
    }
  },
  cookie: {
    set: function(name, value, options){
      options = options || {};
      let cookie = encodeURIComponent(name) + '=' + encodeURIComponent(JSON.stringify(value));
      if(options.expires){
        const expires = options.expires instanceof Date ? options.expires : new Date(Date.now() + options.expires * 86400000);
        cookie += '; expires=' + expires.toUTCString();
      }
      if(options.path) cookie += '; path=' + options.path;
      if(options.domain) cookie += '; domain=' + options.domain;
      if(options.secure) cookie += '; secure';
      if(options.sameSite) cookie += '; sameSite=' + options.sameSite;
      document.cookie = cookie;
    },
    get: function(name, defaultValue){
      const cookies = document.cookie.split(';');
      for(let i = 0; i < cookies.length; i++){
        const cookie = cookies[i].trim();
        if(cookie.indexOf(encodeURIComponent(name) + '=') === 0){
          try{
            return JSON.parse(decodeURIComponent(cookie.substring(encodeURIComponent(name).length + 1)));
          } catch(e){
            return defaultValue;
          }
        }
      }
      return defaultValue;
    },
    remove: function(name, options){
      options = options || {};
      StorageUtils.cookie.set(name, '', { ...options, expires: new Date(0) });
    },
    has: function(name){
      return document.cookie.split(';').some(function(c){
        return c.trim().indexOf(encodeURIComponent(name) + '=') === 0;
      });
    },
    keys: function(){
      return document.cookie.split(';').map(function(c){
        return decodeURIComponent(c.trim().split('=')[0]);
      }).filter(Boolean);
    },
    clear: function(options){
      const keys = StorageUtils.cookie.keys();
      keys.forEach(function(key){
        StorageUtils.cookie.remove(key, options);
      });
    },
    size: function(){
      return StorageUtils.cookie.keys().length;
    }
  },
  memory: {
    _store: {},
    set: function(key, value, ttl){
      StorageUtils.memory._store[key] = {
        value: value,
        expiresAt: ttl ? Date.now() + ttl : 0
      };
    },
    get: function(key, defaultValue){
      const entry = StorageUtils.memory._store[key];
      if(!entry) return defaultValue;
      if(entry.expiresAt > 0 && Date.now() > entry.expiresAt){
        delete StorageUtils.memory._store[key];
        return defaultValue;
      }
      return entry.value;
    },
    remove: function(key){
      delete StorageUtils.memory._store[key];
    },
    clear: function(){
      StorageUtils.memory._store = {};
    },
    has: function(key){
      const entry = StorageUtils.memory._store[key];
      if(!entry) return false;
      if(entry.expiresAt > 0 && Date.now() > entry.expiresAt){
        delete StorageUtils.memory._store[key];
        return false;
      }
      return true;
    },
    keys: function(){
      return Object.keys(StorageUtils.memory._store);
    },
    size: function(){
      return Object.keys(StorageUtils.memory._store).length;
    },
    cleanup: function(){
      const now = Date.now();
      for(const key in StorageUtils.memory._store){
        if(StorageUtils.memory._store[key].expiresAt > 0 && now > StorageUtils.memory._store[key].expiresAt){
          delete StorageUtils.memory._store[key];
        }
      }
    }
  },
  getBestStorage: function(){
    if(StorageUtils.local.has('__test__')) return 'local';
    if(StorageUtils.session.has('__test__')) return 'session';
    return 'memory';
  }
};

/* ===== 文件工具库 =====
   支持: 读取 / 写入 / 下载 / 格式转换
*/
const FileUtils = {
  readAsText: function(file){
    return new Promise(function(resolve, reject){
      const reader = new FileReader();
      reader.onload = function(e){ resolve(e.target.result); };
      reader.onerror = function(e){ reject(e); };
      reader.readAsText(file);
    });
  },
  readAsDataURL: function(file){
    return new Promise(function(resolve, reject){
      const reader = new FileReader();
      reader.onload = function(e){ resolve(e.target.result); };
      reader.onerror = function(e){ reject(e); };
      reader.readAsDataURL(file);
    });
  },
  readAsArrayBuffer: function(file){
    return new Promise(function(resolve, reject){
      const reader = new FileReader();
      reader.onload = function(e){ resolve(e.target.result); };
      reader.onerror = function(e){ reject(e); };
      reader.readAsArrayBuffer(file);
    });
  },
  readAsJSON: function(file){
    return FileUtils.readAsText(file).then(function(text){
      return JSON.parse(text);
    });
  },
  download: function(content, filename, mimeType){
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 100);
  },
  downloadJSON: function(data, filename){
    FileUtils.download(JSON.stringify(data, null, 2), filename || 'data.json', 'application/json');
  },
  downloadText: function(text, filename){
    FileUtils.download(text, filename || 'text.txt', 'text/plain');
  },
  downloadCSV: function(rows, filename){
    const csv = rows.map(function(row){
      return row.map(function(cell){
        if(typeof cell === 'string' && (cell.includes(',') || cell.includes('"') || cell.includes('\n'))){
          return '"' + cell.replace(/"/g, '""') + '"';
        }
        return cell;
      }).join(',');
    }).join('\n');
    FileUtils.download('\uFEFF' + csv, filename || 'data.csv', 'text/csv');
  },
  formatSize: function(bytes){
    if(bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
  },
  getExtension: function(filename){
    const parts = filename.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  },
  getBaseName: function(filename){
    return filename.split('.').slice(0, -1).join('.');
  },
  getMimeType: function(filename){
    const ext = FileUtils.getExtension(filename);
    const types = {
      'txt': 'text/plain', 'html': 'text/html', 'css': 'text/css',
      'js': 'application/javascript', 'json': 'application/json',
      'xml': 'application/xml', 'pdf': 'application/pdf',
      'zip': 'application/zip', 'png': 'image/png', 'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg', 'gif': 'image/gif', 'svg': 'image/svg+xml',
      'webp': 'image/webp', 'mp3': 'audio/mpeg', 'wav': 'audio/wav',
      'mp4': 'video/mp4', 'webm': 'video/webm', 'csv': 'text/csv',
      'md': 'text/markdown', 'yaml': 'text/yaml', 'yml': 'text/yaml'
    };
    return types[ext] || 'application/octet-stream';
  },
  isImage: function(filename){
    return ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(FileUtils.getExtension(filename));
  },
  isVideo: function(filename){
    return ['mp4', 'webm', 'avi', 'mov', 'mkv', 'flv'].includes(FileUtils.getExtension(filename));
  },
  isAudio: function(filename){
    return ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'].includes(FileUtils.getExtension(filename));
  },
  isText: function(filename){
    return ['txt', 'html', 'css', 'js', 'json', 'xml', 'csv', 'md', 'yaml', 'yml', 'log'].includes(FileUtils.getExtension(filename));
  },
  openFilePicker: function(accept, multiple){
    return new Promise(function(resolve){
      const input = document.createElement('input');
      input.type = 'file';
      if(accept) input.accept = accept;
      if(multiple) input.multiple = true;
      input.onchange = function(){
        resolve(multiple ? Array.from(input.files) : input.files[0]);
      };
      input.click();
    });
  },
  openImagePicker: function(){
    return FileUtils.openFilePicker('image/*', false);
  },
  dataURLToBlob: function(dataURL){
    const parts = dataURL.split(';base64,');
    const contentType = parts[0].split(':')[1];
    const raw = window.atob(parts[1]);
    const rawLength = raw.length;
    const uInt8Array = new Uint8Array(rawLength);
    for(let i = 0; i < rawLength; i++){
      uInt8Array[i] = raw.charCodeAt(i);
    }
    return new Blob([uInt8Array], { type: contentType });
  },
  blobToDataURL: function(blob){
    return new Promise(function(resolve, reject){
      const reader = new FileReader();
      reader.onload = function(e){ resolve(e.target.result); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  },
  arrayBufferToBlob: function(buffer, mimeType){
    return new Blob([buffer], { type: mimeType || 'application/octet-stream' });
  },
  blobToArrayBuffer: function(blob){
    return new Promise(function(resolve, reject){
      const reader = new FileReader();
      reader.onload = function(e){ resolve(e.target.result); };
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
  }
};

/* ===== 图片工具库 =====
   支持: 加载 / 缩放 / 裁剪 / 压缩 / 格式转换
*/
const ImageUtils = {
  load: function(src){
    return new Promise(function(resolve, reject){
      const img = new Image();
      img.onload = function(){ resolve(img); };
      img.onerror = function(e){ reject(e); };
      img.src = src;
    });
  },
  resize: function(img, maxWidth, maxHeight){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    let width = img.width, height = img.height;
    if(maxWidth && width > maxWidth){
      height = height * (maxWidth / width);
      width = maxWidth;
    }
    if(maxHeight && height > maxHeight){
      width = width * (maxHeight / height);
      height = maxHeight;
    }
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
  },
  crop: function(img, x, y, width, height){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(img, x, y, width, height, 0, 0, width, height);
    return canvas;
  },
  compress: function(img, quality, maxWidth, maxHeight){
    const canvas = ImageUtils.resize(img, maxWidth, maxHeight);
    return canvas.toDataURL('image/jpeg', quality || 0.8);
  },
  toDataURL: function(img, format, quality){
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL(format || 'image/png', quality);
  },
  toBlob: function(img, format, quality){
    return new Promise(function(resolve){
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvas.toBlob(function(blob){ resolve(blob); }, format || 'image/png', quality);
    });
  },
  getAverageColor: function(img){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1;
    canvas.height = 1;
    ctx.drawImage(img, 0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return { r: data[0], g: data[1], b: data[2], a: data[3] };
  },
  getDominantColors: function(img, count){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const size = 50;
    canvas.width = size;
    canvas.height = size;
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    const colorMap = {};
    for(let i = 0; i < data.length; i += 4){
      const r = Math.round(data[i] / 32) * 32;
      const g = Math.round(data[i+1] / 32) * 32;
      const b = Math.round(data[i+2] / 32) * 32;
      const key = r + ',' + g + ',' + b;
      colorMap[key] = (colorMap[key] || 0) + 1;
    }
    const sorted = Object.entries(colorMap).sort(function(a, b){ return b[1] - a[1]; });
    return sorted.slice(0, count || 5).map(function([key]){
      const [r, g, b] = key.split(',').map(Number);
      return { r: r, g: g, b: b };
    });
  },
  grayscale: function(img){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for(let i = 0; i < data.length; i += 4){
      const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
      data[i] = data[i+1] = data[i+2] = gray;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  },
  invert: function(img){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for(let i = 0; i < data.length; i += 4){
      data[i] = 255 - data[i];
      data[i+1] = 255 - data[i+1];
      data[i+2] = 255 - data[i+2];
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  },
  sepia: function(img){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for(let i = 0; i < data.length; i += 4){
      const r = data[i], g = data[i+1], b = data[i+2];
      data[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
      data[i+1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
      data[i+2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  },
  brightness: function(img, amount){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for(let i = 0; i < data.length; i += 4){
      data[i] = Math.max(0, Math.min(255, data[i] + amount));
      data[i+1] = Math.max(0, Math.min(255, data[i+1] + amount));
      data[i+2] = Math.max(0, Math.min(255, data[i+2] + amount));
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  },
  contrast: function(img, amount){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const factor = (259 * (amount + 255)) / (255 * (259 - amount));
    for(let i = 0; i < data.length; i += 4){
      data[i] = Math.max(0, Math.min(255, factor * (data[i] - 128) + 128));
      data[i+1] = Math.max(0, Math.min(255, factor * (data[i+1] - 128) + 128));
      data[i+2] = Math.max(0, Math.min(255, factor * (data[i+2] - 128) + 128));
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  },
  rotate: function(img, degrees){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const rad = degrees * Math.PI / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    canvas.width = img.width * cos + img.height * sin;
    canvas.height = img.width * sin + img.height * cos;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    return canvas;
  },
  flip: function(img, horizontal, vertical){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.translate(horizontal ? canvas.width : 0, vertical ? canvas.height : 0);
    ctx.scale(horizontal ? -1 : 1, vertical ? -1 : 1);
    ctx.drawImage(img, 0, 0);
    return canvas;
  },
  watermark: function(img, text, x, y, font, color){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    ctx.font = font || '20px Arial';
    ctx.fillStyle = color || 'rgba(255, 255, 255, 0.8)';
    ctx.fillText(text, x || 10, y || 30);
    return canvas;
  },
  createThumbnail: function(img, size){
    return ImageUtils.resize(img, size, size);
  },
  getImageInfo: function(img){
    return {
      width: img.width,
      height: img.height,
      aspectRatio: img.width / img.height,
      megapixels: (img.width * img.height) / 1000000
    };
  }
};



/* ===== 键盘快捷键系统 =====
   支持: 组合键 / 序列 / 上下文 / 冲突检测
*/