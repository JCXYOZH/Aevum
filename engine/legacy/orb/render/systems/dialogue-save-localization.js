function createPerceptionSystem(owner, options){
  const perc = {
    owner: owner,
    _senses: {
      vision: { enabled: true, range: 20, fov: Math.PI * 0.5, rayCount: 8 },
      hearing: { enabled: true, range: 15, threshold: 0.5 },
      touch: { enabled: true, range: 1 },
      smell: { enabled: false, range: 10 }
    },
    _memory: [],
    _maxMemory: (options && options.maxMemory) || 50,
    _memoryDuration: (options && options.memoryDuration) || 30,
    _threats: [],
    _knownEntities: new Map(),
    _lastUpdate: 0
  };

  function setSenseEnabled(sense, enabled){
    if(perc._senses[sense]) perc._senses[sense].enabled = enabled;
  }

  function setSenseRange(sense, range){
    if(perc._senses[sense]) perc._senses[sense].range = range;
  }

  function update(position, forward, entities, dt, currentTime){
    perc._lastUpdate = currentTime;
    perc._threats = [];
    perc._knownEntities.clear();
    if(perc._senses.vision.enabled){
      senseVision(position, forward, entities, currentTime);
    }
    if(perc._senses.hearing.enabled){
      senseHearing(position, entities, currentTime);
    }
    if(perc._senses.touch.enabled){
      senseTouch(position, entities, currentTime);
    }
    updateMemory(currentTime);
  }

  function senseVision(position, forward, entities, currentTime){
    const vision = perc._senses.vision;
    for(let i = 0; i < entities.length; i++){
      const entity = entities[i];
      if(entity === perc.owner) continue;
      const toEntity = [
        entity.position[0] - position[0],
        entity.position[1] - position[1],
        entity.position[2] - position[2]
      ];
      const dist = Math.sqrt(toEntity[0]**2 + toEntity[1]**2 + toEntity[2]**2);
      if(dist > vision.range) continue;
      const dir = [toEntity[0]/dist, toEntity[1]/dist, toEntity[2]/dist];
      const dot = forward[0]*dir[0] + forward[1]*dir[1] + forward[2]*dir[2];
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      if(angle <= vision.fov * 0.5){
        const awareness = 1 - (dist / vision.range);
        perc._knownEntities.set(entity.id || i, {
          entity: entity,
          position: [...entity.position],
          lastSeen: currentTime,
          awareness: awareness,
          sense: 'vision'
        });
        if(entity.isThreat){
          perc._threats.push({ entity: entity, position: [...entity.position], threatLevel: awareness });
        }
      }
    }
  }

  function senseHearing(position, entities, currentTime){
    const hearing = perc._senses.hearing;
    for(let i = 0; i < entities.length; i++){
      const entity = entities[i];
      if(entity === perc.owner) continue;
      if(!entity.noiseLevel || entity.noiseLevel < hearing.threshold) continue;
      const dist = Math.sqrt(
        (entity.position[0]-position[0])**2 +
        (entity.position[1]-position[1])**2 +
        (entity.position[2]-position[2])**2
      );
      if(dist > hearing.range) continue;
      const awareness = entity.noiseLevel * (1 - dist / hearing.range);
      const key = entity.id || ('heard_' + i);
      if(!perc._knownEntities.has(key)){
        perc._knownEntities.set(key, {
          entity: entity,
          position: [...entity.position],
          lastHeard: currentTime,
          awareness: awareness,
          sense: 'hearing'
        });
      }
    }
  }

  function senseTouch(position, entities, currentTime){
    const touch = perc._senses.touch;
    for(let i = 0; i < entities.length; i++){
      const entity = entities[i];
      if(entity === perc.owner) continue;
      const dist = Math.sqrt(
        (entity.position[0]-position[0])**2 +
        (entity.position[1]-position[1])**2 +
        (entity.position[2]-position[2])**2
      );
      if(dist <= touch.range){
        const key = entity.id || ('touched_' + i);
        perc._knownEntities.set(key, {
          entity: entity,
          position: [...entity.position],
          lastTouched: currentTime,
          awareness: 1,
          sense: 'touch'
        });
      }
    }
  }

  function updateMemory(currentTime){
    for(const [key, info] of perc._knownEntities){
      perc._memory.push({
        key: key,
        entity: info.entity,
        position: [...info.position],
        time: currentTime,
        sense: info.sense,
        awareness: info.awareness
      });
    }
    for(let i = perc._memory.length - 1; i >= 0; i--){
      if(currentTime - perc._memory[i].time > perc._memoryDuration){
        perc._memory.splice(i, 1);
      }
    }
    if(perc._memory.length > perc._maxMemory){
      perc._memory.splice(0, perc._memory.length - perc._maxMemory);
    }
  }

  function getKnownEntities(){
    return Array.from(perc._knownEntities.values());
  }

  function getThreats(){
    return [...perc._threats];
  }

  function getHighestThreat(){
    if(perc._threats.length === 0) return null;
    return perc._threats.reduce(function(max, t){ return t.threatLevel > max.threatLevel ? t : max; });
  }

  function getMemory(){
    return [...perc._memory];
  }

  function isAwareOf(entity){
    return perc._knownEntities.has(entity.id) || perc._memory.some(function(m){ return m.entity === entity; });
  }

  function getLastKnownPosition(entity){
    const known = perc._knownEntities.get(entity.id);
    if(known) return [...known.position];
    for(let i = perc._memory.length - 1; i >= 0; i--){
      if(perc._memory[i].entity === entity) return [...perc._memory[i].position];
    }
    return null;
  }

  function clear(){
    perc._memory = [];
    perc._threats = [];
    perc._knownEntities.clear();
  }

  return { setSenseEnabled, setSenseRange, update, getKnownEntities, getThreats, getHighestThreat, getMemory, isAwareOf, getLastKnownPosition, clear, perc };
}

/* ===== 对话系统 =====
   支持: 对话树 / 条件分支 / 选项 / 变量
*/
function createDialogueSystem(options){
  const dlg = {
    _nodes: new Map(),
    _currentNode: null,
    _variables: {},
    _history: [],
    _listeners: [],
    _speaker: ''
  };

  function addNode(id, data){
    dlg._nodes.set(id, { id: id, ...data });
  }

  function removeNode(id){
    dlg._nodes.delete(id);
  }

  function start(nodeId){
    const node = dlg._nodes.get(nodeId);
    if(!node) return false;
    dlg._currentNode = node;
    dlg._speaker = node.speaker || '';
    dlg._history.push({ nodeId: nodeId, time: Date.now() });
    emitEvent('nodeStart', node);
    if(node.onEnter) node.onEnter(dlg);
    return true;
  }

  function selectOption(index){
    if(!dlg._currentNode || !dlg._currentNode.options) return false;
    const option = dlg._currentNode.options[index];
    if(!option) return false;
    if(option.condition && !option.condition(dlg)) return false;
    if(option.onSelect) option.onSelect(dlg);
    if(option.next){
      return start(option.next);
    }
    return true;
  }

  function advance(){
    if(!dlg._currentNode) return false;
    if(dlg._currentNode.next){
      return start(dlg._currentNode.next);
    }
    return false;
  }

  function getCurrentNode(){
    return dlg._currentNode;
  }

  function getText(){
    return dlg._currentNode ? dlg._currentNode.text : '';
  }

  function getSpeaker(){
    return dlg._currentNode ? dlg._currentNode.speaker || '' : '';
  }

  function getOptions(){
    if(!dlg._currentNode || !dlg._currentNode.options) return [];
    return dlg._currentNode.options.filter(function(opt){
      return !opt.condition || opt.condition(dlg);
    }).map(function(opt){
      return { text: opt.text, available: !opt.condition || opt.condition(dlg) };
    });
  }

  function setVariable(name, value){
    dlg._variables[name] = value;
    emitEvent('variableChange', { name: name, value: value });
  }

  function getVariable(name){
    return dlg._variables[name];
  }

  function getHistory(){
    return [...dlg._history];
  }

  function hasVisited(nodeId){
    return dlg._history.some(function(h){ return h.nodeId === nodeId; });
  }

  function on(event, callback){
    dlg._listeners.push({ event: event, callback: callback });
  }

  function emitEvent(event, data){
    for(let i = 0; i < dlg._listeners.length; i++){
      if(dlg._listeners[i].event === event){
        try{ dlg._listeners[i].callback(data); } catch(e){ console.error('[Dialogue] 事件错误:', e); }
      }
    }
  }

  function isFinished(){
    return !dlg._currentNode;
  }

  function reset(){
    dlg._currentNode = null;
    dlg._variables = {};
    dlg._history = [];
    dlg._speaker = '';
  }

  function clear(){
    dlg._nodes.clear();
    reset();
    dlg._listeners = [];
  }

  return { addNode, removeNode, start, selectOption, advance, getCurrentNode, getText, getSpeaker, getOptions, setVariable, getVariable, getHistory, hasVisited, on, isFinished, reset, clear, dlg };
}

/* ===== 存档系统 =====
   支持: 多槽位 / 自动存档 / 序列化 / 元数据
*/
function createSaveSystem(options){
  const save = {
    _slots: new Map(),
    _maxSlots: (options && options.maxSlots) || 10,
    _autoSaveSlot: (options && options.autoSaveSlot) || 0,
    _currentSlot: -1,
    _serializers: new Map(),
    _storageKey: (options && options.storageKey) || 'game_saves',
    _listeners: []
  };

  function registerSerializer(type, serializeFn, deserializeFn){
    save._serializers.set(type, { serialize: serializeFn, deserialize: deserializeFn });
  }

  function saveGame(slotIndex, data, metadata){
    if(slotIndex < 0 || slotIndex >= save._maxSlots) return false;
    const slot = {
      index: slotIndex,
      data: serializeData(data),
      metadata: metadata || {},
      timestamp: Date.now(),
      version: (options && options.version) || '1.0'
    };
    save._slots.set(slotIndex, slot);
    save._currentSlot = slotIndex;
    persist();
    emitEvent('saved', { slot: slotIndex, metadata: slot.metadata });
    return true;
  }

  function loadGame(slotIndex){
    const slot = save._slots.get(slotIndex);
    if(!slot) return null;
    save._currentSlot = slotIndex;
    emitEvent('loaded', { slot: slotIndex, metadata: slot.metadata });
    return deserializeData(slot.data);
  }

  function autoSave(data, metadata){
    return saveGame(save._autoSaveSlot, data, { ...metadata, autoSave: true });
  }

  function deleteSave(slotIndex){
    if(save._slots.delete(slotIndex)){
      persist();
      emitEvent('deleted', { slot: slotIndex });
      return true;
    }
    return false;
  }

  function getSaveInfo(slotIndex){
    const slot = save._slots.get(slotIndex);
    if(!slot) return null;
    return {
      index: slot.index,
      metadata: slot.metadata,
      timestamp: slot.timestamp,
      version: slot.version,
      date: new Date(slot.timestamp).toLocaleString()
    };
  }

  function getAllSaves(){
    const saves = [];
    for(const [index, slot] of save._slots){
      saves.push(getSaveInfo(index));
    }
    return saves.sort(function(a, b){ return b.timestamp - a.timestamp; });
  }

  function getCurrentSlot(){
    return save._currentSlot;
  }

  function hasSave(slotIndex){
    return save._slots.has(slotIndex);
  }

  function serializeData(data){
    const result = {};
    for(const key in data){
      const value = data[key];
      if(value && value._type && save._serializers.has(value._type)){
        const serializer = save._serializers.get(value._type);
        result[key] = { _type: value._type, _data: serializer.serialize(value) };
      } else {
        result[key] = JSON.parse(JSON.stringify(value));
      }
    }
    return result;
  }

  function deserializeData(data){
    const result = {};
    for(const key in data){
      const value = data[key];
      if(value && value._type && save._serializers.has(value._type)){
        const serializer = save._serializers.get(value._type);
        result[key] = serializer.deserialize(value._data);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  function persist(){
    try{
      const data = {};
      for(const [index, slot] of save._slots){
        data[index] = slot;
      }
      localStorage.setItem(save._storageKey, JSON.stringify(data));
    } catch(e){
      console.error('[SaveSystem] 持久化失败:', e);
    }
  }

  function restore(){
    try{
      const data = localStorage.getItem(save._storageKey);
      if(data){
        const parsed = JSON.parse(data);
        for(const index in parsed){
          save._slots.set(parseInt(index), parsed[index]);
        }
      }
    } catch(e){
      console.error('[SaveSystem] 恢复失败:', e);
    }
  }

  function on(event, callback){
    save._listeners.push({ event: event, callback: callback });
  }

  function emitEvent(event, data){
    for(let i = 0; i < save._listeners.length; i++){
      if(save._listeners[i].event === event){
        try{ save._listeners[i].callback(data); } catch(e){ console.error('[SaveSystem] 事件错误:', e); }
      }
    }
  }

  function exportSave(slotIndex){
    const slot = save._slots.get(slotIndex);
    return slot ? JSON.stringify(slot) : null;
  }

  function importSave(json){
    try{
      const slot = JSON.parse(json);
      if(slot.index !== undefined){
        save._slots.set(slot.index, slot);
        persist();
        return true;
      }
    } catch(e){
      console.error('[SaveSystem] 导入失败:', e);
    }
    return false;
  }

  function clearAll(){
    save._slots.clear();
    save._currentSlot = -1;
    persist();
  }

  restore();
  return { registerSerializer, saveGame, loadGame, autoSave, deleteSave, getSaveInfo, getAllSaves, getCurrentSlot, hasSave, on, exportSave, importSave, clearAll, save };
}

/* ===== 本地化系统 =====
   支持: 多语言 / 文本替换 / 变量插值 / 复数形式
*/
function createLocalization(options){
  const loc = {
    _currentLanguage: (options && options.defaultLanguage) || 'zh-CN',
    _languages: new Map(),
    _fallbackLanguage: (options && options.fallbackLanguage) || 'en-US',
    _listeners: []
  };

  function addLanguage(code, strings){
    loc._languages.set(code, { ...strings });
  }

  function setLanguage(code){
    if(loc._languages.has(code)){
      loc._currentLanguage = code;
      emitEvent('languageChange', code);
      return true;
    }
    return false;
  }

  function getLanguage(){
    return loc._currentLanguage;
  }

  function getAvailableLanguages(){
    return Array.from(loc._languages.keys());
  }

  function t(key, variables){
    const strings = loc._languages.get(loc._currentLanguage);
    let text = strings ? strings[key] : undefined;
    if(text === undefined){
      const fallback = loc._languages.get(loc._fallbackLanguage);
      text = fallback ? fallback[key] : undefined;
    }
    if(text === undefined) return key;
    if(variables){
      for(const varName in variables){
        text = text.replace(new RegExp('\\{' + varName + '\\}', 'g'), variables[varName]);
      }
    }
    return text;
  }

  function tPlural(key, count, variables){
    const pluralKey = key + '_' + getPluralForm(count);
    let text = t(pluralKey, { count: count, ...variables });
    if(text === pluralKey){
      text = t(key, { count: count, ...variables });
    }
    return text;
  }

  function getPluralForm(count){
    const lang = loc._currentLanguage;
    if(lang === 'zh-CN' || lang === 'ja' || lang === 'ko'){
      return 'other';
    }
    if(lang === 'en-US' || lang === 'en-GB'){
      return count === 1 ? 'one' : 'other';
    }
    if(lang === 'ru' || lang === 'pl'){
      if(count % 10 === 1 && count % 100 !== 11) return 'one';
      if(count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20)) return 'few';
      return 'many';
    }
    return count === 1 ? 'one' : 'other';
  }

  function hasKey(key){
    const strings = loc._languages.get(loc._currentLanguage);
    if(strings && strings[key] !== undefined) return true;
    const fallback = loc._languages.get(loc._fallbackLanguage);
    return fallback && fallback[key] !== undefined;
  }

  function addString(lang, key, value){
    if(!loc._languages.has(lang)) loc._languages.set(lang, {});
    loc._languages.get(lang)[key] = value;
  }

  function on(event, callback){
    loc._listeners.push({ event: event, callback: callback });
  }

  function emitEvent(event, data){
    for(let i = 0; i < loc._listeners.length; i++){
      if(loc._listeners[i].event === event){
        try{ loc._listeners[i].callback(data); } catch(e){ console.error('[Localization] 事件错误:', e); }
      }
    }
  }

  function getLanguageName(code){
    const names = {
      'zh-CN': '简体中文',
      'zh-TW': '繁體中文',
      'en-US': 'English (US)',
      'en-GB': 'English (UK)',
      'ja': '日本語',
      'ko': '한국어',
      'fr': 'Français',
      'de': 'Deutsch',
      'es': 'Español',
      'ru': 'Русский'
    };
    return names[code] || code;
  }

  return { addLanguage, setLanguage, getLanguage, getAvailableLanguages, t, tPlural, hasKey, addString, on, getLanguageName, loc };
}



/* ===== 复数数学系统 =====
   支持: 基本运算 / 极坐标 / 根 / 对数 / 三角函数
*/