'use strict';

(function () {
  const canvas = document.getElementById('view');
  const live2dCanvas = document.getElementById('live2dView');
  const debugCanvas = document.getElementById('debug');
  const debugCtx = debugCanvas.getContext('2d');
  const toast = document.getElementById('toast');
  const modelSelect = document.getElementById('modelSelect');
  const formatSelect = document.getElementById('formatSelect');
  const actionSelect = document.getElementById('actionSelect');
  const actionHint = document.getElementById('actionHint');
  const catalogMeta = document.getElementById('catalogMeta');
  const modelMeta = document.getElementById('modelMeta');
  const yawRange = document.getElementById('yawRange');
  const zoomRange = document.getElementById('zoomRange');
  const yawValue = document.getElementById('yawValue');
  const zoomValue = document.getElementById('zoomValue');
  const statRenderer = document.getElementById('statRenderer');
  const statBones = document.getElementById('statBones');
  const statTris = document.getElementById('statTris');
  const statFps = document.getElementById('statFps');
  const live2dState = document.getElementById('live2dState');
  const live2dHint = document.getElementById('live2dHint');
  const emotionSelect = document.getElementById('emotionSelect');
  const emotionValue = document.getElementById('emotionValue');
  const coverageGrid = document.getElementById('coverageGrid');
  const math = window.AEVUM.math;
  const retarget = window.AEVUM.render.AnimationRetarget.retargetPose;
  const ActionStateMachine = window.AEVUM.action.Core.ActionStateMachine;
  const query = new URLSearchParams(location.search);

  // 模型清单只从外部 YAML 读取，页面和代码里不保存具体模型路径。
  let MODELS = Object.create(null);
  let allModels = [];
  let actionLibraryUrl = '';
  let catalogUrl = 'models.yaml';

  const TYPE_LABELS = { vrm: 'VRM', pmx: 'PMX', live2d: 'Live2D' };
  const CLIP_FOR = {
    idle: 'idle',
    walk: 'walk',
    run: 'run',
    greet: 'standing_greeting'
  };

  // 与 demo 页一致：源片段首帧不是落地相位，跑步/走路先截到接触段。
  const START_OFFSET = { walk: 0.08, run: 0.12, greet: 1.0 };

  const features = {
    texture: document.getElementById('optTexture'),
    light: document.getElementById('optLight'),
    toon: document.getElementById('optToon'),
    sphere: document.getElementById('optSphere'),
    outline: document.getElementById('optOutline'),
    wireframe: document.getElementById('optWireframe'),
    bones: document.getElementById('optBones'),
    grid: document.getElementById('optGrid'),
    autoRotate: document.getElementById('optAutoRotate'),
    visible: document.getElementById('optVisible'),
    paused: document.getElementById('optPaused'),
    ground: document.getElementById('optGround')
  };

  const FEATURE_LABELS = {
    texture: '贴图',
    light: '光照',
    toon: '卡通着色',
    sphere: '球面贴图',
    outline: '描边',
    wireframe: '线框',
    bones: '骨骼',
    grid: '地面网格',
    autoRotate: '自动旋转',
    visible: '显示模型',
    paused: '暂停动作',
    ground: '接地'
  };

  const FEATURE_GROUPS = [
    { master: 'masterMaterial', label: '材质与光照', keys: ['texture', 'light', 'toon', 'sphere', 'outline'] },
    { master: 'masterDebug', label: '网格与调试', keys: ['wireframe', 'bones', 'grid', 'visible'] },
    { master: 'masterMotion', label: '姿态与动作', keys: ['ground', 'paused'] }
  ];

  const COVERAGE = [
    { key: 'math', label: 'math / 数学', test: function (root) { return Boolean(root.math); } },
    { key: 'formats', label: 'formats / 格式解析', test: function (root) { return Boolean(root.formats); } },
    { key: 'render', label: 'render / 渲染', test: function (root) { return Boolean(root.render); } },
    { key: 'animation', label: 'animation / 动画', test: function (root) { return Boolean(root.action); } },
    { key: 'graphics', label: 'graphics / 图形', test: function (root) { return Boolean(root.graphics); } },
    { key: 'core', label: 'core / 核心', test: function (root) { return Boolean(root.core); } },
    { key: 'loaders', label: 'loaders / 加载', test: function (root) { return Boolean(root.loaders); } },
    { key: 'character', label: 'character / 角色', test: function (root) { return Boolean(root.character); } },
    { key: 'world', label: 'world / 世界', test: function (root) { return Boolean(root.world); } },
    { key: 'legacy', label: 'legacy / 旧 Orb', test: function (root) { return Boolean(root.legacy); } }
  ];

  for (const key of Object.keys(features)) {
    if (query.has(key)) features[key].checked = query.get(key) !== '0';
  }

  let current = null;
  let actionGLB = null;
  let player = null;
  let idlePlayer = null;
  let stateMachine = null;
  let yaw = 16 * Math.PI / 180;
  if (query.has('yaw')) {
    const value = parseFloat(query.get('yaw'));
    if (Number.isFinite(value)) yaw = value * Math.PI / 180;
  }
  let zoom = 1;
  let dragging = false;
  let dragX = 0;
  let lastFrame = performance.now();
  let fpsFrames = 0;
  let fpsTime = performance.now();
  let modelVisible = features.visible.checked;
  let paused = features.paused.checked;
  let autoRotate = features.autoRotate.checked;
  let currentAction = 'idle';
  let loadToken = 0;

  if (query.get('action') && CLIP_FOR[query.get('action')]) {
    actionSelect.value = query.get('action');
    currentAction = query.get('action');
  }
  if (query.get('format') && ['vrm', 'pmx', 'live2d'].includes(query.get('format'))) {
    formatSelect.value = query.get('format');
  }
  if (query.get('emotion')) {
    emotionSelect.value = query.get('emotion');
    emotionValue.textContent = emotionSelect.value;
  }
  if (query.has('zoom')) {
    const value = parseFloat(query.get('zoom'));
    if (Number.isFinite(value)) zoom = clamp(value, 0.5, 2.5);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function parseYamlValue(value) {
    const text = String(value || '').trim();
    if (text.length >= 2 && ((text[0] === '"' && text[text.length - 1] === '"') ||
      (text[0] === "'" && text[text.length - 1] === "'"))) {
      return text.slice(1, -1);
    }
    return text;
  }

  // 清单只使用“顶层键 + models 列表 + 扁平字段”这一小段 YAML，
  // 这里按同样结构读取，避免为了一个配置引入运行时依赖。
  function parseCatalogYaml(source) {
    const result = { models: [] };
    let inModels = false;
    let currentModel = null;
    for (const raw of String(source).split(/\r?\n/)) {
      const line = raw.replace(/\t/g, '  ');
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const indent = line.length - line.trimStart().length;
      const text = line.trim();
      if (indent === 0) {
        const pair = text.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!pair) continue;
        if (pair[1] === 'models') {
          inModels = true;
          currentModel = null;
          result.models = [];
          continue;
        }
        inModels = false;
        result[pair[1]] = parseYamlValue(pair[2]);
        continue;
      }
      if (!inModels) continue;
      if (text.startsWith('- ')) {
        const body = text.slice(2).trim();
        const pair = body.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (pair) {
          currentModel = {};
          result.models.push(currentModel);
          currentModel[pair[1]] = parseYamlValue(pair[2]);
        } else {
          currentModel = null;
          result.models.push(parseYamlValue(body));
        }
        continue;
      }
      if (!currentModel) continue;
      const pair = text.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (pair) currentModel[pair[1]] = parseYamlValue(pair[2]);
    }
    return result;
  }

  function inferModelType(url) {
    if (/\.vrm$/i.test(url)) return 'vrm';
    if (/\.pmx$/i.test(url)) return 'pmx';
    if (/\.json$/i.test(url)) return 'live2d';
    return '';
  }

  function inferModelLabel(url) {
    const file = String(url).split(/[\\/]/).pop() || url;
    const lower = file.toLowerCase();
    if (lower === 'model.vrm') return 'VRM 模型';
    if (lower === 'model3.json') return 'Live2D 模型';
    const name = file.replace(/\.model3\.json$/i, '').replace(/\.(vrm|pmx|json)$/i, '');
    return name || file;
  }

  function normalizeModelEntry(raw) {
    const item = typeof raw === 'string' ? { url: raw } : (raw || {});
    const url = item.url || item.path;
    if (!url) return null;
    const type = item.type || inferModelType(url);
    if (!type) return null;
    const slash = url.lastIndexOf('/');
    return {
      id: item.id || url,
      label: item.label || inferModelLabel(url),
      type: type,
      url: url,
      base: item.base || (type === 'pmx' && slash >= 0 ? url.slice(0, slash) : '')
    };
  }

  function normalizeCatalogUrl(value) {
    let text = String(value || '').trim();
    try {
      text = decodeURIComponent(text);
    } catch (error) {
      // 保留原始字符串，下面仍按路径安全处理。
    }
    text = text.replace(/\\/g, '/').replace(/\/+$/, '');
    if (text.startsWith('engine/')) text = text.slice('engine/'.length);
    return text || 'models.yaml';
  }

  function typeLabel(type) {
    return TYPE_LABELS[type] || type;
  }

  function applyCatalog(json) {
    const list = Array.isArray(json.models) ? json.models : [];
    allModels = list.map(normalizeModelEntry).filter(Boolean);
    MODELS = Object.create(null);
    for (const item of allModels) MODELS[item.id] = item;
    actionLibraryUrl = json.actions || '';
    catalogMeta.textContent = '清单：' + catalogUrl + ' · ' + allModels.length + ' 个模型';
    if (!allModels.length) throw new Error('模型清单中没有可用条目');
    refreshModelOptions(query.get('model'));
  }

  async function loadCatalogData() {
    catalogUrl = normalizeCatalogUrl(query.get('catalog') || 'models.yaml');
    catalogMeta.textContent = '清单：加载中…';
    const response = await fetch(catalogUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error('模型清单加载失败：' + response.status + ' · ' + catalogUrl);
    applyCatalog(parseCatalogYaml(await response.text()));
  }

  function refreshModelOptions(preferredKey) {
    const filter = formatSelect.value;
    const list = filter ? allModels.filter(function (item) { return item.type === filter; }) : allModels;
    modelSelect.textContent = '';
    if (!list.length) {
      const empty = document.createElement('option');
      empty.textContent = filter ? '当前格式没有模型' : '清单中没有模型';
      empty.disabled = true;
      modelSelect.appendChild(empty);
      modelMeta.textContent = '类型：-';
      return null;
    }
    const groups = [];
    for (const type of ['vrm', 'pmx', 'live2d']) {
      const items = list.filter(function (item) { return item.type === type; });
      if (!items.length) continue;
      const group = document.createElement('optgroup');
      group.label = typeLabel(type);
      for (const item of items) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.label;
        group.appendChild(option);
      }
      modelSelect.appendChild(group);
      groups.push(type);
    }
    if (!groups.length) {
      const empty = document.createElement('option');
      empty.textContent = '没有可显示的模型格式';
      empty.disabled = true;
      modelSelect.appendChild(empty);
      return null;
    }
    const requested = preferredKey && list.some(function (item) { return item.id === preferredKey; })
      ? preferredKey
      : list[0].id;
    modelSelect.value = requested;
    return requested;
  }

  function showToast(message, isError) {
    toast.textContent = message;
    toast.classList.toggle('is-error', Boolean(isError));
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    if (debugCanvas.width !== width || debugCanvas.height !== height) {
      debugCanvas.width = width;
      debugCanvas.height = height;
    }
    debugCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function textureUrlsFor(modelDef, parsed) {
    return (parsed.textures || []).map(function (item) {
      const path = String(item.path || '').replace(/\\/g, '/');
      return encodeURI(modelDef.base + '/' + path);
    });
  }

  function rendererOptions(renderer) {
    if (!renderer || !renderer.options) return;
    renderer.options.texture = features.texture.checked;
    renderer.options.light = features.light.checked;
    renderer.options.wireframe = features.wireframe.checked;
    if ('toon' in renderer.options) renderer.options.toon = features.toon.checked;
    if ('sphere' in renderer.options) renderer.options.sphere = features.sphere.checked;
    if ('outline' in renderer.options) renderer.options.outline = features.outline.checked;
    if ('flipY' in renderer.options) renderer.options.flipY = query.get('flip') === '1';
  }

  function syncFeatureState() {
    modelVisible = features.visible.checked;
    paused = features.paused.checked;
    autoRotate = features.autoRotate.checked;
  }

  function updateReadout(renderer, descriptor, modelDef) {
    const rendererNames = { vrm: 'VRM', pmx: 'PMX', live2d: 'Live2D' };
    statRenderer.textContent = rendererNames[descriptor.type] || descriptor.type;
    statBones.textContent = String(descriptor.bones || '-');
    statTris.textContent = descriptor.triangles ? descriptor.triangles.toLocaleString() : '-';
    if (modelDef) {
      const typeText = typeLabel(descriptor.type);
      const label = String(modelDef.label || '');
      const prefix = label.toLowerCase().indexOf(typeText.toLowerCase()) === 0
        ? ''
        : typeText + ' · ';
      modelMeta.textContent = prefix + label + ' · ' +
        (descriptor.bones || '-') + ' 骨骼 · ' +
        (descriptor.triangles ? descriptor.triangles.toLocaleString() : '-') + ' 三角面';
    }
    if (renderer && descriptor.type !== 'live2d') rendererOptions(renderer);
  }

  function setDisabled(key, disabled) {
    const row = document.querySelector('[data-feature="' + key + '"]');
    if (row) row.classList.toggle('is-disabled', disabled);
    if (features[key]) features[key].disabled = disabled;
  }

  function setCameraAvailability(type) {
    const isLive2D = type === 'live2d';
    yawRange.disabled = isLive2D;
    zoomRange.disabled = isLive2D;
  }

  function setLive2dAvailability(type) {
    const isLive2D = type === 'live2d';
    live2dState.textContent = isLive2D ? '已启用' : '未选择';
    live2dState.classList.toggle('is-on', isLive2D);
    live2dHint.textContent = isLive2D
      ? '当前是 Live2D 模型，可以直接触发眨眼、挥手、点头、摇头和情绪。'
      : '选择 Live2D 模型后，这组控件才会启用。';
    for (const button of document.querySelectorAll('[data-live2d-action]')) {
      button.disabled = !isLive2D;
    }
    emotionSelect.disabled = !isLive2D;
  }

  function setFeatureAvailability(type) {
    const isHumanoid = type === 'vrm';
    const isPmx = type === 'pmx';
    const isLive2D = type === 'live2d';
    setDisabled('bones', !isHumanoid);
    setDisabled('ground', !isHumanoid);
    // toon / sphere / outline 是 PMX 材质特性，VRM 下不显示为可用。
    ['toon', 'sphere', 'outline'].forEach(function (key) { setDisabled(key, !isPmx); });
    // Live2D 不走网格蒙皮与地面修正，只保留模型自身绘制。
    ['texture', 'light', 'wireframe', 'grid', 'autoRotate', 'visible', 'paused'].forEach(function (key) {
      setDisabled(key, isLive2D);
    });
    actionSelect.disabled = !isHumanoid || !player || !player.clips || !player.clips.length;
    actionHint.textContent = isHumanoid ? '从动作库读取' : (isPmx ? 'PMX 使用程序化待机' : 'Live2D 使用自带动作');
    setCameraAvailability(type);
    setLive2dAvailability(type);
    syncMasterStates();
  }

  function syncMasterStates() {
    for (const group of FEATURE_GROUPS) {
      const master = document.getElementById(group.master);
      if (!master) continue;
      const enabled = group.keys.filter(function (key) { return !features[key].disabled; });
      const checked = enabled.filter(function (key) { return features[key].checked; });
      master.disabled = enabled.length === 0;
      master.checked = enabled.length > 0 && checked.length === enabled.length;
      master.indeterminate = checked.length > 0 && checked.length < enabled.length;
    }
  }

  async function loadActionLibrary() {
    if (actionGLB) return actionGLB;
    if (!actionLibraryUrl) return null;
    const response = await fetch(actionLibraryUrl);
    if (!response.ok) throw new Error('动作库加载失败 ' + response.status);
    actionGLB = window.AEVUM.formats.parseGLB(await response.arrayBuffer());
    return actionGLB;
  }

  function setupActionPlayer(vrm) {
    player = null;
    idlePlayer = null;
    stateMachine = null;
    if (!actionGLB) return;
    player = window.AEVUM.formats.GLTFAnimation.createPlayer(actionGLB);
    idlePlayer = window.AEVUM.formats.GLTFAnimation.createPlayer(actionGLB);
    if (idlePlayer.clips.some(function (clip) { return clip.name === 'idle'; })) {
      idlePlayer.setClip('idle').reset().setLoop(true).play();
    } else {
      idlePlayer = null;
    }
    stateMachine = new ActionStateMachine();
    const names = Object.keys(CLIP_FOR).filter(function (name) {
      return player.clips.some(function (clip) { return clip.name === CLIP_FOR[name]; });
    });
    for (const name of names) stateMachine.addState(name, {});
    for (const from of names) {
      for (const to of names) {
        if (from === to) continue;
        stateMachine.addTransition(from, to, function (conditions) {
          return conditions.get('target') === to;
        }, { priority: 1 });
      }
    }
    stateMachine.onStateChange = function (target) {
      const clip = CLIP_FOR[target];
      if (!clip || !hasClip(clip)) return;
      player.setClip(clip).reset().setLoop(true).play();
      const startOffset = START_OFFSET[target] || 0;
      if (startOffset > 0) player.update(startOffset);
    };
    const initial = names.indexOf(currentAction) >= 0 ? currentAction : (names[0] || 'idle');
    stateMachine.currentState = initial;
    currentAction = initial;
    actionSelect.value = initial;
    if (hasClip(CLIP_FOR[initial])) {
      player.setClip(CLIP_FOR[initial]).reset().setLoop(true).play();
      if (START_OFFSET[initial]) player.update(START_OFFSET[initial]);
    }
  }

  function hasClip(name) {
    return Boolean(player && player.clips.some(function (clip) { return clip.name === name; }));
  }

  function updateActionAvailability() {
    actionSelect.disabled = !(current && current.type === 'vrm' && player && player.clips && player.clips.length);
    if (current && current.type === 'vrm' && player) {
      const names = Object.keys(CLIP_FOR).filter(function (name) { return hasClip(CLIP_FOR[name]); });
      actionHint.textContent = names.length ? '从动作库读取' : '动作库没有匹配片段';
    }
  }

  async function loadModel(key) {
    const token = ++loadToken;
    if (!key) {
      showToast('没有可加载的模型', true);
      return;
    }
    const modelDef = MODELS[key] || allModels[0];
    if (!modelDef) throw new Error('模型清单为空');
    const previous = current;
    current = null;
    player = null;
    idlePlayer = null;
    stateMachine = null;
    actionGLB = null;
    modelVisible = features.visible.checked;
    setFeatureAvailability(modelDef.type);
    showToast('正在加载 ' + modelDef.label + '…');
    resizeCanvas();

    try {
      if (previous && previous.type === 'live2d' && previous.renderer) {
        previous.renderer.destroy();
      } else if (previous && previous.renderer && previous.renderer.gl) {
        previous.renderer.gl.clear(previous.renderer.gl.COLOR_BUFFER_BIT | previous.renderer.gl.DEPTH_BUFFER_BIT);
      }
      live2dCanvas.style.display = 'none';
      canvas.style.visibility = 'visible';
      emotionSelect.value = 'neutral';
      emotionValue.textContent = 'neutral';

      let renderer;
      let descriptor;
      if (modelDef.type === 'vrm') {
        const response = await fetch(modelDef.url);
        if (!response.ok) throw new Error('模型加载失败 ' + response.status + ' · ' + modelDef.url);
        const vrm = window.AEVUM.formats.parseVRM(await response.arrayBuffer());
        if (token !== loadToken) return;
        try {
          await loadActionLibrary();
        } catch (error) {
          actionGLB = null;
          showToast('动作库不可用，先显示绑定姿态：' + error.message, true);
        }
        if (token !== loadToken) return;
        renderer = new window.AEVUM.render.VRMRenderer(canvas);
        renderer.viewYaw = yaw;
        renderer.zoom = zoom;
        await renderer.loadVRM(vrm);
        setupActionPlayer(vrm);
        descriptor = {
          type: 'vrm',
          bones: (vrm.humanBones || []).length,
          triangles: countVrmTriangles(vrm)
        };
        current = { key: key, type: 'vrm', modelDef: modelDef, renderer: renderer, vrm: vrm };
      } else if (modelDef.type === 'pmx') {
        const response = await fetch(modelDef.url);
        if (!response.ok) throw new Error('模型加载失败 ' + response.status + ' · ' + modelDef.url);
        const buffer = await response.arrayBuffer();
        if (token !== loadToken) return;
        const parsed = new window.PMXParser().parse(buffer);
        const textureUrls = textureUrlsFor(modelDef, parsed);
        renderer = new window.AEVUM.render.WebGLRenderer(canvas);
        rendererOptions(renderer);
        await renderer.loadPMX(parsed, textureUrls, { rotateY: 0 });
        descriptor = {
          type: 'pmx',
          bones: parsed.boneCount,
          triangles: Math.floor(parsed.indexCount / 3)
        };
        current = { key: key, type: 'pmx', modelDef: modelDef, renderer: renderer, parsed: parsed };
      } else if (modelDef.type === 'live2d') {
        canvas.style.visibility = 'hidden';
        live2dCanvas.style.display = 'block';
        renderer = new window.AEVUM.render.Live2DRenderer(live2dCanvas);
        await renderer.loadModel(modelDef.url);
        if (token !== loadToken) { renderer.destroy(); return; }
        renderer.resize();
        renderer.start();
        const model = renderer.getModel();
        descriptor = {
          type: 'live2d',
          bones: model && model.drawables && model.drawables.count ? model.drawables.count : 0,
          triangles: 0
        };
        current = { key: key, type: 'live2d', modelDef: modelDef, renderer: renderer };
        if (renderer.setEmotion) renderer.setEmotion(emotionSelect.value);
      } else {
        throw new Error('不支持的模型类型：' + modelDef.type);
      }

      updateReadout(renderer, descriptor, modelDef);
      setFeatureAvailability(modelDef.type);
      updateActionAvailability();
      syncMasterStates();
      showToast(modelDef.label + ' · ' + (descriptor.bones || '-') + ' 骨骼 · ' +
        (descriptor.triangles ? descriptor.triangles.toLocaleString() : '-') + ' 三角面');
      yaw = Number(yawRange.value) * Math.PI / 180;
      zoom = Number(zoomRange.value);
      modelSelect.value = key;
    } catch (error) {
      current = null;
      live2dCanvas.style.display = 'none';
      canvas.style.visibility = 'visible';
      setFeatureAvailability('');
      setLive2dAvailability(false);
      modelMeta.textContent = '类型：-';
      showToast('加载失败：' + error.message, true);
      console.error(error);
    }
  }

  function countVrmTriangles(vrm) {
    let count = 0;
    const json = vrm.json || {};
    for (const mesh of json.meshes || []) {
      for (const primitive of mesh.primitives || []) {
        const accessor = json.accessors && json.accessors[primitive.indices];
        if (accessor && accessor.count) count += Math.floor(accessor.count / 3);
      }
    }
    return count;
  }

  function currentBounds() {
    if (!current || current.type === 'live2d') return null;
    if (current.type === 'vrm') return current.renderer.bounds;
    const renderer = current.renderer;
    if (!renderer.model) return null;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const vertex of renderer.model.vertices) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], vertex.position[axis]);
        max[axis] = Math.max(max[axis], vertex.position[axis]);
      }
    }
    return { min: min, max: max };
  }

  function projectPoint(point, matrix, width, height) {
    const x = matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12];
    const y = matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13];
    const w = matrix[3] * point[0] + matrix[7] * point[1] + matrix[11] * point[2] + matrix[15];
    if (w <= 0.001) return null;
    return {
      x: (x / w * 0.5 + 0.5) * width,
      y: (1 - (y / w * 0.5 + 0.5)) * height
    };
  }

  function drawGrid() {
    const ctx = debugCtx;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);
    if (!features.grid.checked || !current) return;
    const bounds = currentBounds();
    if (!bounds) return;
    const matrix = current.renderer.lastViewProj || current.renderer.viewProj;
    if (!matrix) return;
    const center = [
      (bounds.min[0] + bounds.max[0]) / 2,
      0,
      (bounds.min[2] + bounds.max[2]) / 2
    ];
    const size = Math.max(
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
      1
    );
    const step = size / 10;
    const half = size * 1.6;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(120, 160, 200, .2)';
    for (let offset = -half; offset <= half; offset += step) {
      const a = projectPoint([center[0] + offset, 0, center[2] - half], matrix, width, height);
      const b = projectPoint([center[0] + offset, 0, center[2] + half], matrix, width, height);
      if (a && b) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      const c = projectPoint([center[0] - half, 0, center[2] + offset], matrix, width, height);
      const d = projectPoint([center[0] + half, 0, center[2] + offset], matrix, width, height);
      if (c && d) {
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(d.x, d.y);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(89, 211, 200, .32)';
    ctx.beginPath();
    const origin = projectPoint([center[0], 0, center[2]], matrix, width, height);
    if (origin) {
      ctx.arc(origin.x, origin.y, 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawVrmBones(target) {
    if (!features.bones.checked || !current || current.type !== 'vrm' || !target) return;
    const ctx = debugCtx;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const vrm = current.vrm;
    const renderer = current.renderer;
    const world = window.AEVUM.render.computeNodeWorld(
      vrm.json, math, target.rotation, { translation: target.translation }
    );
    const boneNode = {};
    for (const item of vrm.humanBones || []) boneNode[item.bone] = item.node;
    const matrix = renderer.lastViewProj;
    if (!matrix) return;

    function pointFor(name) {
      const index = boneNode[name];
      if (index === undefined) return null;
      const m = world[index];
      if (!m) return null;
      return projectPoint([m[12], m[13], m[14]], matrix, width, height);
    }

    const chains = [
      ['hips', 'spine', 'chest', 'neck', 'head'],
      ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes'],
      ['rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'],
      ['leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand'],
      ['rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand']
    ];
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#45d6ff';
    for (const chain of chains) {
      for (let i = 0; i + 1 < chain.length; i += 1) {
        const a = pointFor(chain[i]);
        const b = pointFor(chain[i + 1]);
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#ffe08a';
    for (const name of ['hips', 'spine', 'chest', 'neck', 'head',
      'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
      'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
      'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
      'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand']) {
      const point = pointFor(name);
      if (!point) continue;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawOverlays(target) {
    drawGrid();
    drawVrmBones(target);
  }

  function updateCamera(dt) {
    if (autoRotate) yaw += dt * 0.35;
    if (yaw > Math.PI) yaw -= Math.PI * 2;
    if (yaw < -Math.PI) yaw += Math.PI * 2;
    yawRange.value = String(Math.round(yaw * 180 / Math.PI));
    yawValue.textContent = Math.round(yaw * 180 / Math.PI) + '°';
    zoomValue.textContent = zoom.toFixed(2) + '×';
    if (!current) return;
    if (current.type === 'live2d') return;
    if (current.type === 'vrm') {
      current.renderer.viewYaw = yaw;
      current.renderer.zoom = zoom;
    } else {
      const camera = current.renderer.camera;
      const base = current.renderer.baseCamera || camera;
      if (!current.renderer.baseCamera) {
        current.renderer.baseCamera = {
          eye: camera.eye.slice(),
          target: camera.target.slice(),
          fov: camera.fov,
          near: camera.near,
          far: camera.far
        };
      }
      camera.eye[0] = base.target[0] + (base.eye[0] - base.target[0]) / zoom;
      camera.eye[1] = base.target[1] + (base.eye[1] - base.target[1]) / zoom;
      camera.eye[2] = base.target[2] + (base.eye[2] - base.target[2]) / zoom;
      current.renderer.modelMatrix = math.M4.create();
      const q = math.Q.create();
      math.Q.fromAxisAngle(q, [0, 1, 0], yaw + Math.PI);
      math.Q.toMat4(current.renderer.modelMatrix, q);
    }
  }

  function clearView() {
    const gl = current && current.renderer && current.renderer.gl;
    if (!gl) return;
    gl.clearColor(0.03, 0.045, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    resizeCanvas();
    updateCamera(dt);
    syncFeatureState();

    let target = null;
    if (current && current.type !== 'live2d') {
      const renderer = current.renderer;
      rendererOptions(renderer);
      if (modelVisible) {
        if (current.type === 'vrm') {
          if (stateMachine && !paused) stateMachine.update(dt);
          if (player) {
            if (!paused) player.update(dt);
            if (idlePlayer && !paused) idlePlayer.update(dt);
            const source = player.getPose();
            target = retarget(current.vrm, actionGLB.json, source, {
              ikState: features.ground.checked ? { foot: null, anchor: null, ground: null } : null
            });
            // 打招呼只让右臂跟 greeting 动作，左臂借 idle 的结果；
            // 否则源片段的左臂会一直横在身体侧面，看起来像 T-pose。
            if (currentAction === 'greet' && idlePlayer) {
              const idleTarget = retarget(current.vrm, actionGLB.json, idlePlayer.getPose(), {
                ikState: features.ground.checked ? { foot: null, anchor: null, ground: null } : null
              });
              const humanoid = {};
              (current.vrm.humanBones || []).forEach(function (bone) { humanoid[bone.bone] = bone.node; });
              ['leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand'].forEach(function (bone) {
                const index = humanoid[bone];
                if (index !== undefined && idleTarget.rotation[index]) {
                  target.rotation[index] = idleTarget.rotation[index];
                }
              });
            }
          } else {
            target = { rotation: {}, translation: { x: 0, y: 0, z: 0 } };
          }
          renderer.render(now / 1000, target.rotation, { translation: target.translation });
        } else {
          const pose = window.AEVUM.render.makeIdlePose(current.parsed, paused ? 0 : now / 1000);
          renderer.render(paused ? 0 : now / 1000, pose);
          target = { rotation: pose.rotation, translation: { x: 0, y: 0, z: 0 } };
        }
      } else {
        clearView();
      }
    }
    if (!current || current.type !== 'live2d') drawOverlays(target);

    fpsFrames += 1;
    if (now - fpsTime >= 500) {
      statFps.textContent = Math.round(fpsFrames * 1000 / (now - fpsTime));
      fpsFrames = 0;
      fpsTime = now;
    }
    requestAnimationFrame(frame);
  }

  function runtimeFeatureChanged(key) {
    if (key === 'visible' && !features.visible.checked) clearView();
    if (current && current.type !== 'live2d' && current.renderer) {
      rendererOptions(current.renderer);
    }
    syncFeatureState();
    syncMasterStates();
  }

  function bindFeature(key) {
    features[key].addEventListener('change', function () {
      runtimeFeatureChanged(key);
      showToast((features[key].checked ? '开启：' : '关闭：') + FEATURE_LABELS[key]);
    });
  }

  function bindMaster(group) {
    const master = document.getElementById(group.master);
    if (!master) return;
    master.addEventListener('change', function () {
      const enabled = group.keys.filter(function (key) { return !features[key].disabled; });
      const next = master.checked;
      for (const key of enabled) features[key].checked = next;
      runtimeFeatureChanged(enabled[0] || 'texture');
      showToast((next ? '开启：' : '关闭：') + group.label);
      syncMasterStates();
    });
  }

  function selectModelFromFilter() {
    const key = refreshModelOptions(modelSelect.value);
    if (!key) {
      showToast('当前格式没有可用模型', true);
      return;
    }
    loadModel(key);
  }

  function live2dAction(action) {
    if (!current || current.type !== 'live2d' || !current.renderer) {
      showToast('只有 Live2D 模型支持这个操作', true);
      return;
    }
    const renderer = current.renderer;
    if (action === 'blink') renderer.triggerBlink();
    if (action === 'wave') renderer.triggerWave('right');
    if (action === 'nod') renderer.triggerNod();
    if (action === 'shake') renderer.triggerShake();
    showToast('Live2D：' + ({ blink: '眨眼', wave: '挥手', nod: '点头', shake: '摇头' })[action]);
  }

  function renderCoverage() {
    const root = window.AEVUM || {};
    coverageGrid.textContent = '';
    let onCount = 0;
    for (const item of COVERAGE) {
      const on = item.test(root);
      if (on) onCount += 1;
      const row = document.createElement('div');
      row.className = 'coverage-item' + (on ? ' is-on' : '');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.textContent = item.label;
      row.appendChild(dot);
      row.appendChild(text);
      coverageGrid.appendChild(row);
    }
    const note = document.querySelector('.coverage-note');
    if (note) {
      note.textContent = '已接入 ' + onCount + ' / ' + COVERAGE.length +
        ' 类；只列当前验证页实际接入的分类，未接入的分类不伪造开关。';
    }
  }

  function buildShareUrl() {
    const params = new URLSearchParams();
    params.set('catalog', catalogUrl);
    if (current) params.set('model', current.key);
    if (formatSelect.value) params.set('format', formatSelect.value);
    if (current && current.type === 'vrm') params.set('action', currentAction);
    params.set('yaw', String(Math.round(yaw * 180 / Math.PI)));
    params.set('zoom', zoom.toFixed(2));
    for (const key of Object.keys(features)) {
      params.set(key, features[key].checked ? '1' : '0');
    }
    if (current && current.type === 'live2d') params.set('emotion', emotionSelect.value);
    return location.origin + location.pathname + '?' + params.toString();
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.top = '0';
      area.style.left = '0';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      let copied = false;
      try {
        copied = document.execCommand('copy');
      } catch (error) {
        copied = false;
      }
      document.body.removeChild(area);
      if (copied) resolve();
      else reject(new Error('copy failed'));
    });
  }

  async function copyShareUrl() {
    const url = buildShareUrl();
    try {
      await copyText(url);
      showToast('已复制当前验证链接');
    } catch (error) {
      showToast('复制失败，请手动复制：' + url, true);
    }
  }

  async function refreshCatalog() {
    showToast('正在刷新模型清单…');
    try {
      await loadCatalogData();
      const key = current && MODELS[current.key] ? current.key : modelSelect.value;
      if (key) await loadModel(key);
      showToast('清单已刷新：' + allModels.length + ' 个模型');
    } catch (error) {
      showToast('刷新失败：' + error.message, true);
      console.error(error);
    }
  }

  for (const key of Object.keys(features)) bindFeature(key);
  for (const group of FEATURE_GROUPS) bindMaster(group);

  formatSelect.addEventListener('change', selectModelFromFilter);

  modelSelect.addEventListener('change', function () {
    loadModel(modelSelect.value);
  });

  actionSelect.addEventListener('change', function () {
    const target = actionSelect.value;
    if (!stateMachine || !hasClip(CLIP_FOR[target])) return;
    currentAction = target;
    stateMachine.setCondition('target', target);
  });

  for (const button of document.querySelectorAll('[data-live2d-action]')) {
    button.addEventListener('click', function () {
      live2dAction(button.getAttribute('data-live2d-action'));
    });
  }

  emotionSelect.addEventListener('change', function () {
    emotionValue.textContent = emotionSelect.value;
    if (current && current.type === 'live2d' && current.renderer) {
      current.renderer.setEmotion(emotionSelect.value);
      showToast('Live2D 情绪：' + emotionSelect.value);
    }
  });

  yawRange.addEventListener('input', function () {
    yaw = Number(yawRange.value) * Math.PI / 180;
    yawValue.textContent = yawRange.value + '°';
  });

  zoomRange.addEventListener('input', function () {
    zoom = Number(zoomRange.value);
    zoomValue.textContent = zoom.toFixed(2) + '×';
  });

  canvas.addEventListener('pointerdown', function (event) {
    dragging = true;
    dragX = event.clientX;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', function (event) {
    if (!dragging) return;
    yaw += (event.clientX - dragX) * 0.009;
    dragX = event.clientX;
    yawRange.value = String(clamp(Math.round(yaw * 180 / Math.PI), -180, 180));
    yawValue.textContent = yawRange.value + '°';
  });

  canvas.addEventListener('pointerup', function (event) {
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener('wheel', function (event) {
    event.preventDefault();
    zoom = clamp(zoom * (event.deltaY > 0 ? 0.9 : 1.1), 0.5, 2.5);
    zoomRange.value = String(zoom);
    zoomValue.textContent = zoom.toFixed(2) + '×';
  }, { passive: false });

  document.getElementById('resetView').addEventListener('click', function () {
    yaw = 16 * Math.PI / 180;
    zoom = 1;
    yawRange.value = '16';
    zoomRange.value = '1';
    yawValue.textContent = '16°';
    zoomValue.textContent = '1.00×';
    if (current && current.type === 'pmx') current.renderer.baseCamera = null;
  });

  document.getElementById('resetOptions').addEventListener('click', function () {
    for (const key of Object.keys(features)) features[key].checked = true;
    features.wireframe.checked = false;
    features.bones.checked = false;
    features.autoRotate.checked = false;
    features.paused.checked = false;
    emotionSelect.value = 'neutral';
    emotionValue.textContent = 'neutral';
    if (current && current.type === 'live2d' && current.renderer) current.renderer.setEmotion('neutral');
    runtimeFeatureChanged('texture');
    showToast('开关已重置');
  });

  document.getElementById('refreshCatalog').addEventListener('click', refreshCatalog);
  document.getElementById('copyLink').addEventListener('click', copyShareUrl);

  window.addEventListener('resize', function () {
    resizeCanvas();
    if (current && current.type === 'live2d') current.renderer.resize();
  });

  resizeCanvas();
  setFeatureAvailability('');
  setLive2dAvailability(false);
  renderCoverage();
  loadCatalogData()
    .then(function () {
      const key = modelSelect.value;
      if (key) return loadModel(key);
      throw new Error('模型清单为空');
    })
    .catch(function (error) {
      console.error(error);
      showToast(error.message || String(error), true);
    });
  requestAnimationFrame(frame);
})();
