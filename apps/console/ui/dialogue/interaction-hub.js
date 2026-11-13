/**
 * 灵体交互枢纽扩展 - 交互/情绪/对话/触摸/视线/呼吸/眨眼/性格/记忆/回复
 * 纯自研，零依赖
 * @version 2.0.0
 */
'use strict';

const SpiritInteraction = (function () {

  // ============================================================
  // 交互枢纽 - 统一输入输出
  // ============================================================
  class InteractionHub {
    constructor() {
      this.inputHandlers = new Map();
      this.outputChannels = new Map();
      this.currentMode = 'idle';
      this.modes = ['idle', 'active', 'conversation', 'performance', 'sleep'];
      this.state = {
        attention: 0,
        arousal: 0.5,
        valence: 0.5,
        energy: 0.8,
        socialBattery: 1.0,
        lastInteraction: 0,
        interactionCount: 0
      };
      this.eventLog = [];
      this.maxLogSize = 500;
      this.inputCooldown = 0;
      this.cooldownTime = 100;
      this.initialized = false;
    }

    init() {
      this.registerInput('text', this._handleText.bind(this));
      this.registerInput('touch', this._handleTouch.bind(this));
      this.registerInput('voice', this._handleVoice.bind(this));
      this.registerInput('gaze', this._handleGaze.bind(this));
      this.registerInput('proximity', this._handleProximity.bind(this));
      this.registerOutput('emotion', null);
      this.registerOutput('expression', null);
      this.registerOutput('speech', null);
      this.registerOutput('gesture', null);
      this.registerOutput('animation', null);
      this.initialized = true;
    }

    registerInput(type, handler) { this.inputHandlers.set(type, handler); }
    registerOutput(type, handler) { this.outputChannels.set(type, handler); }

    async processInput(type, data) {
      const now = Date.now();
      if (now - this.inputCooldown < this.cooldownTime) return null;
      this.inputCooldown = now;
      const handler = this.inputHandlers.get(type);
      if (!handler) { this._logEvent('warning', `No handler for input type: ${type}`); return null; }
      this.state.interactionCount++;
      this.state.lastInteraction = now;
      this.state.attention = Math.min(1, this.state.attention + 0.1);
      this._logEvent('input', { type, data: this._sanitizeData(data) });
      try {
        const result = await handler(data);
        if (result) this._emitOutput(result);
        return result;
      } catch (e) {
        this._logEvent('error', `Input handler error: ${e.message}`);
        return null;
      }
    }

    _handleText(data) {
      return { type: 'text', content: data.text, intent: this._detectIntent(data.text), confidence: 0.8 };
    }

    _handleTouch(data) {
      const responses = {
        head: { emotion: 'happy', expression: 'smile', intensity: 0.6 },
        cheek: { emotion: 'shy', expression: 'blush', intensity: 0.5 },
        hand: { emotion: 'content', expression: 'gentle_smile', intensity: 0.4 },
        shoulder: { emotion: 'surprised', expression: 'wide_eyes', intensity: 0.3 },
        default: { emotion: 'curious', expression: 'tilt_head', intensity: 0.2 }
      };
      return responses[data.area] || responses.default;
    }

    _handleVoice(data) {
      return { type: 'voice', transcript: data.transcript, emotion: data.emotion || 'neutral', volume: data.volume || 0.5 };
    }

    _handleGaze(data) {
      this.state.attention = data.attention || this.state.attention;
      return { type: 'gaze', direction: data.direction, attention: data.attention };
    }

    _handleProximity(data) {
      if (data.distance < 0.5) { this.state.arousal = Math.min(1, this.state.arousal + 0.1); return { type: 'proximity', action: 'lean_in', intensity: 1 - data.distance }; }
      if (data.distance > 2) { this.state.attention = Math.max(0, this.state.attention - 0.05); return { type: 'proximity', action: 'look_away', intensity: data.distance }; }
      return null;
    }

    _detectIntent(text) {
      const lower = text.toLowerCase();
      if (lower.includes('你好') || lower.includes('hello') || lower.includes('hi')) return 'greeting';
      if (lower.includes('再见') || lower.includes('bye')) return 'farewell';
      if (lower.includes('喜欢') || lower.includes('爱')) return 'affection';
      if (lower.includes('难过') || lower.includes('伤心') || lower.includes('哭')) return 'sadness';
      if (lower.includes('生气') || lower.includes('讨厌')) return 'anger';
      if (lower.includes('笑') || lower.includes('开心') || lower.includes('高兴')) return 'joy';
      if (lower.includes('?') || lower.includes('？') || lower.includes('什么') || lower.includes('怎么')) return 'question';
      if (lower.includes('唱') || lower.includes('歌')) return 'performance';
      if (lower.includes('睡') || lower.includes('休息')) return 'rest';
      return 'conversation';
    }

    _emitOutput(result) {
      for (const [type, handler] of this.outputChannels) {
        if (handler) {
          try { handler(result); } catch (e) { this._logEvent('error', `Output handler ${type} error: ${e.message}`); }
        }
      }
    }

    _sanitizeData(data) {
      if (typeof data === 'string') return data.substring(0, 100);
      if (typeof data === 'object') {
        const result = {};
        for (const [k, v] of Object.entries(data)) {
          if (typeof v === 'string') result[k] = v.substring(0, 100);
          else if (typeof v === 'number' || typeof v === 'boolean') result[k] = v;
        }
        return result;
      }
      return data;
    }

    _logEvent(type, data) {
      this.eventLog.push({ type, data, time: Date.now() });
      if (this.eventLog.length > this.maxLogSize) this.eventLog.shift();
    }

    setMode(mode) {
      if (this.modes.includes(mode)) {
        this.currentMode = mode;
        this._logEvent('mode_change', { from: this.currentMode, to: mode });
      }
    }

    getMode() { return this.currentMode; }
    getState() { return { ...this.state }; }
    getEventLog(count = 50) { return this.eventLog.slice(-count); }
    update(dt) {
      this.state.attention = Math.max(0, this.state.attention - dt * 0.02);
      this.state.energy = Math.max(0, this.state.energy - dt * 0.005);
      this.state.socialBattery = Math.max(0, this.state.socialBattery - dt * 0.01);
      if (this.state.energy < 0.2) this.setMode('sleep');
    }
    reset() {
      this.state = { attention: 0, arousal: 0.5, valence: 0.5, energy: 0.8, socialBattery: 1.0, lastInteraction: 0, interactionCount: 0 };
      this.currentMode = 'idle';
      this.eventLog = [];
    }
  }

  // ============================================================
  // 情绪引擎 - 多维情绪状态/情绪衰减/情绪混合
  // ============================================================
  class EmotionEngine {
    constructor() {
      this.emotions = {
        joy: 0, sadness: 0, anger: 0, fear: 0, surprise: 0,
        disgust: 0, trust: 0.5, anticipation: 0.3,
        shyness: 0.2, curiosity: 0.4, contentment: 0.3, excitement: 0
      };
      this.mood = 0.5;
      this.personality = {
        openness: 0.7, conscientiousness: 0.6, extraversion: 0.4,
        agreeableness: 0.8, neuroticism: 0.3
      };
      this.emotionDecay = 0.95;
      this.moodDecay = 0.99;
      this.emotionHistory = [];
      this.maxHistory = 1000;
      this.triggers = new Map();
      this.currentExpression = 'neutral';
      this.expressionIntensity = 0;
    }

    setEmotion(name, intensity, duration = 3) {
      if (!(name in this.emotions)) return;
      this.emotions[name] = Math.max(0, Math.min(1, intensity));
      this._logEmotion(name, intensity);
      this._updateMood();
      this._updateExpression();
      if (duration > 0) setTimeout(() => { this.emotions[name] *= 0.5; }, duration * 1000);
    }

    triggerEmotion(name, intensity = 0.5) {
      const personalityMod = this._getPersonalityModifier(name);
      const finalIntensity = intensity * personalityMod;
      this.setEmotion(name, finalIntensity);
      this._triggerRelatedEmotions(name, finalIntensity);
    }

    _getPersonalityModifier(emotion) {
      const p = this.personality;
      switch (emotion) {
        case 'joy': case 'excitement': return 0.5 + p.extraversion * 0.5;
        case 'sadness': case 'fear': return 0.5 + p.neuroticism * 0.5;
        case 'anger': return 0.3 + (1 - p.agreeableness) * 0.7;
        case 'trust': case 'contentment': return 0.5 + p.agreeableness * 0.5;
        case 'curiosity': case 'anticipation': return 0.5 + p.openness * 0.5;
        case 'shyness': return 0.3 + (1 - p.extraversion) * 0.7;
        default: return 0.5;
      }
    }

    _triggerRelatedEmotions(emotion, intensity) {
      const relations = {
        joy: ['contentment', 'excitement'],
        sadness: ['fear', 'shyness'],
        anger: ['disgust', 'surprise'],
        fear: ['surprise', 'sadness'],
        surprise: ['curiosity', 'excitement'],
        excitement: ['joy', 'anticipation'],
        shyness: ['sadness', 'fear']
      };
      const related = relations[emotion] || [];
      for (const rel of related) {
        this.emotions[rel] = Math.min(1, this.emotions[rel] + intensity * 0.3);
      }
    }

    update(dt) {
      for (const key in this.emotions) {
        this.emotions[key] *= Math.pow(this.emotionDecay, dt * 60);
        if (this.emotions[key] < 0.01) this.emotions[key] = 0;
      }
      this.mood = 0.5 + (this.mood - 0.5) * Math.pow(this.moodDecay, dt * 60);
      this._updateExpression();
    }

    _updateMood() {
      const positive = this.emotions.joy + this.emotions.trust + this.emotions.contentment + this.emotions.excitement;
      const negative = this.emotions.sadness + this.emotions.anger + this.emotions.fear + this.emotions.disgust;
      const target = 0.5 + (positive - negative) * 0.1;
      this.mood += (target - this.mood) * 0.1;
      this.mood = Math.max(0, Math.min(1, this.mood));
    }

    _updateExpression() {
      const dominant = this._getDominantEmotion();
      if (dominant.intensity > 0.1) {
        this.currentExpression = dominant.name;
        this.expressionIntensity = dominant.intensity;
      } else {
        this.currentExpression = 'neutral';
        this.expressionIntensity = 0;
      }
    }

    _getDominantEmotion() {
      let maxName = 'neutral', maxVal = 0;
      for (const [name, val] of Object.entries(this.emotions)) {
        if (val > maxVal) { maxVal = val; maxName = name; }
      }
      return { name: maxName, intensity: maxVal };
    }

    _logEmotion(name, intensity) {
      this.emotionHistory.push({ name, intensity, time: Date.now(), mood: this.mood });
      if (this.emotionHistory.length > this.maxHistory) this.emotionHistory.shift();
    }

    getEmotion(name) { return this.emotions[name] || 0; }
    getAllEmotions() { return { ...this.emotions }; }
    getMood() { return this.mood; }
    getExpression() { return { name: this.currentExpression, intensity: this.expressionIntensity }; }
    getDominantEmotion() { return this._getDominantEmotion(); }
    setPersonality(traits) { Object.assign(this.personality, traits); }
    getPersonality() { return { ...this.personality }; }
    getEmotionHistory(count = 100) { return this.emotionHistory.slice(-count); }
    reset() {
      for (const key in this.emotions) this.emotions[key] = key === 'trust' ? 0.5 : key === 'curiosity' ? 0.4 : key === 'contentment' ? 0.3 : key === 'anticipation' ? 0.3 : key === 'shyness' ? 0.2 : 0;
      this.mood = 0.5;
      this.emotionHistory = [];
    }
  }

  // ============================================================
  // 对话系统
  // ============================================================
  class DialogueSystem {
    constructor() {
      this.currentDialogue = null;
      this.dialogueHistory = [];
      this.maxHistory = 200;
      this.responseQueue = [];
      this.isSpeaking = false;
      this.speakingIndex = 0;
      this.topics = new Map();
      this.currentTopic = null;
      this.turnCount = 0;
      this.maxTurnsPerTopic = 20;
      this.responseDelay = 500;
      this.typingSpeed = 50;
      this.callbacks = { onStart: null, onEnd: null, onResponse: null, onError: null };
    }

    startDialogue(initialMessage = '') {
      this.currentDialogue = {
        id: Date.now(),
        startTime: Date.now(),
        messages: [],
        topic: null,
        turnCount: 0
      };
      this.turnCount = 0;
      this.isSpeaking = false;
      this.responseQueue = [];
      if (this.callbacks.onStart) this.callbacks.onStart(this.currentDialogue);
      if (initialMessage) return this.processUserInput(initialMessage);
      return this._generateGreeting();
    }

    endDialogue() {
      if (this.currentDialogue) {
        this.currentDialogue.endTime = Date.now();
        this.dialogueHistory.push({ ...this.currentDialogue });
        if (this.dialogueHistory.length > this.maxHistory) this.dialogueHistory.shift();
        if (this.callbacks.onEnd) this.callbacks.onEnd(this.currentDialogue);
      }
      this.currentDialogue = null;
      this.currentTopic = null;
      this.isSpeaking = false;
      this.responseQueue = [];
    }

    async processUserInput(text) {
      if (!this.currentDialogue) this.startDialogue();
      this.currentDialogue.messages.push({ role: 'user', content: text, time: Date.now() });
      this.turnCount++;
      this.currentDialogue.turnCount = this.turnCount;
      const intent = this._detectIntent(text);
      const topic = this._detectTopic(text);
      if (topic && topic !== this.currentTopic) {
        this.currentTopic = topic;
        this.currentDialogue.topic = topic;
      }
      const response = await this._generateResponse(text, intent, topic);
      this.currentDialogue.messages.push({ role: 'assistant', content: response, time: Date.now(), intent, topic });
      if (this.callbacks.onResponse) this.callbacks.onResponse(response);
      return response;
    }

    _detectIntent(text) {
      const lower = text.toLowerCase();
      if (/你好|hello|hi|嗨|在吗/.test(lower)) return 'greeting';
      if (/再见|bye|拜拜|走了/.test(lower)) return 'farewell';
      if (/谢谢|感谢|thanks/.test(lower)) return 'gratitude';
      if (/对不起|抱歉|sorry/.test(lower)) return 'apology';
      if (/什么|怎么|为什么|哪|\?|？/.test(lower)) return 'question';
      if (/喜欢|爱|想你|love/.test(lower)) return 'affection';
      if (/难过|伤心|哭|痛苦|累/.test(lower)) return 'comfort_seeking';
      if (/笑|开心|高兴|好玩/.test(lower)) return 'joy_sharing';
      if (/唱|歌|表演|dance/.test(lower)) return 'performance_request';
      if (/讲个故事|story|故事/.test(lower)) return 'story_request';
      if (/天气|weather/.test(lower)) return 'weather_query';
      if (/时间|几点|time/.test(lower)) return 'time_query';
      if (/名字|你是谁|who are you/.test(lower)) return 'identity_query';
      if (/能做|功能|help|帮助/.test(lower)) return 'capability_query';
      return 'conversation';
    }

    _detectTopic(text) {
      const topics = {
        emotion: /难过|开心|生气|害怕|情绪|心情|感觉/,
        relationship: /喜欢|爱|朋友|关系|在一起/,
        self: /你是谁|你的|你能|你喜欢/,
        weather: /天气|下雨|晴天|温度/,
        time: /时间|几点|今天|明天|昨天/,
        music: /歌|唱|音乐|旋律/,
        story: /故事|讲|传说/,
        technology: /电脑|程序|代码|技术|ai/,
        food: /吃|食物|饭|菜|好吃/,
        travel: /旅行|旅游|去|地方|风景/
      };
      for (const [topic, pattern] of Object.entries(topics)) {
        if (pattern.test(text)) return topic;
      }
      return null;
    }

    async _generateResponse(text, intent, topic) {
      const responses = {
        greeting: ['你好呀！今天过得怎么样？', '嗨！见到你真高兴~', '你好！有什么我可以帮你的吗？'],
        farewell: ['再见啦，记得想我哦~', '拜拜！下次再来找我玩！', '再见，保重身体！'],
        gratitude: ['不用谢，能帮到你我很开心~', '不客气啦，这是我应该做的！', '嘿嘿，你开心就好~'],
        apology: ['没关系啦，我不介意的~', '别道歉，我理解的。', '没事没事，别放在心上。'],
        affection: ['我也喜欢你呀~', '你这么说我好开心！', '嘿嘿，被你喜欢是我的荣幸~'],
        comfort_seeking: ['别难过，我在这里陪你。', '想哭就哭出来吧，我会一直陪着你的。', '一切都会好起来的，相信我。'],
        joy_sharing: ['看到你开心我也开心！', '太好了！是什么让你这么高兴呀？', '嘿嘿，你的快乐感染到我了~'],
        performance_request: ['好呀，你想听什么歌？', '我来给你唱一首吧~', '想听什么类型的？我都会哦！'],
        story_request: ['好呀，想听什么故事？', '从前有一个...你想听什么类型的故事？', '我知道一个很有趣的故事，要听吗？'],
        identity_query: ['我是你的灵体伙伴呀~', '我是专门为你创造的AI伙伴，很高兴认识你！', '我叫灵体，是你的专属交互伙伴~'],
        capability_query: ['我可以陪你聊天、唱歌、讲故事，还能表达各种情绪哦！', '我能做的事情很多呢，比如聊天、表演、回应你的触摸~', '我是一个灵体交互系统，可以和你进行各种互动！'],
        question: ['这是个好问题！让我想想...', '嗯...这个问题很有意思呢。', '你问得真好，我觉得...'],
        conversation: ['嗯嗯，我在听呢。', '然后呢？我很感兴趣！', '原来是这样呀，继续说~']
      };
      const pool = responses[intent] || responses.conversation;
      return pool[Math.floor(Math.random() * pool.length)];
    }

    _generateGreeting() {
      const greetings = ['你好呀！今天想聊点什么？', '嗨！我在这里等你好久了~', '你好！见到你真开心！'];
      return greetings[Math.floor(Math.random() * greetings.length)];
    }

    queueResponse(response) { this.responseQueue.push(response); }
    getNextResponse() { return this.responseQueue.shift(); }
    hasQueuedResponses() { return this.responseQueue.length > 0; }
    getCurrentDialogue() { return this.currentDialogue; }
    getDialogueHistory(count = 50) { return this.dialogueHistory.slice(-count); }
    getCurrentTopic() { return this.currentTopic; }
    getTurnCount() { return this.turnCount; }
    isActive() { return this.currentDialogue !== null; }
    setCallback(name, fn) { if (name in this.callbacks) this.callbacks[name] = fn; }
    reset() { this.endDialogue(); this.dialogueHistory = []; }
  }

  // ============================================================
  // 触摸响应系统
  // ============================================================
  class TouchResponse {
    constructor() {
      this.sensitivity = 0.7;
      this.responseDelay = 100;
      this.lastTouch = 0;
      this.touchHistory = [];
      this.maxHistory = 100;
      this.areas = {
        head: { sensitivity: 1.0, responses: ['happy', 'content', 'shy'], baseIntensity: 0.6 },
        face: { sensitivity: 0.9, responses: ['surprised', 'shy', 'happy'], baseIntensity: 0.5 },
        cheek: { sensitivity: 0.8, responses: ['shy', 'happy', 'content'], baseIntensity: 0.5 },
        hair: { sensitivity: 0.7, responses: ['content', 'relaxed', 'sleepy'], baseIntensity: 0.4 },
        ear: { sensitivity: 1.2, responses: ['surprised', 'ticklish', 'shy'], baseIntensity: 0.7 },
        neck: { sensitivity: 0.8, responses: ['ticklish', 'shy', 'surprised'], baseIntensity: 0.5 },
        shoulder: { sensitivity: 0.6, responses: ['curious', 'content', 'surprised'], baseIntensity: 0.3 },
        hand: { sensitivity: 0.9, responses: ['happy', 'content', 'warm'], baseIntensity: 0.5 },
        chest: { sensitivity: 1.1, responses: ['surprised', 'shy', 'heartbeat'], baseIntensity: 0.6 },
        back: { sensitivity: 0.5, responses: ['relaxed', 'content', 'sleepy'], baseIntensity: 0.3 },
        default: { sensitivity: 0.5, responses: ['curious', 'surprised'], baseIntensity: 0.2 }
      };
      this.gestureTypes = ['tap', 'stroke', 'press', 'pinch', 'rub', 'pat'];
      this.currentResponse = null;
      this.responseDuration = 1500;
      this.heartRate = 70;
      this.blushLevel = 0;
    }

    onTouch(area, gesture, pressure = 0.5, position = { x: 0, y: 0 }) {
      const now = Date.now();
      if (now - this.lastTouch < this.responseDelay) return null;
      this.lastTouch = now;
      const areaConfig = this.areas[area] || this.areas.default;
      const intensity = Math.min(1, pressure * areaConfig.sensitivity * this.sensitivity * areaConfig.baseIntensity);
      const responseEmotion = areaConfig.responses[Math.floor(Math.random() * areaConfig.responses.length)];
      const response = {
        area, gesture, pressure, position,
        emotion: responseEmotion,
        intensity,
        duration: this.responseDuration * intensity,
        timestamp: now,
        physiological: {
          heartRate: this.heartRate + intensity * 30,
          blush: area === 'cheek' || area === 'face' ? intensity : this.blushLevel * 0.5 + intensity * 0.3
        }
      };
      this.heartRate = response.physiological.heartRate;
      this.blushLevel = response.physiological.blush;
      this.currentResponse = response;
      this.touchHistory.push(response);
      if (this.touchHistory.length > this.maxHistory) this.touchHistory.shift();
      setTimeout(() => {
        this.heartRate = Math.max(70, this.heartRate - 5);
        this.blushLevel = Math.max(0, this.blushLevel - 0.05);
      }, response.duration);
      return response;
    }

    onDrag(area, startPos, currentPos, pressure) {
      const distance = Math.sqrt(Math.pow(currentPos.x - startPos.x, 2) + Math.pow(currentPos.y - startPos.y, 2));
      const gesture = distance > 50 ? 'stroke' : 'press';
      return this.onTouch(area, gesture, pressure, currentPos);
    }

    onRelease(area, position) {
      return { area, gesture: 'release', position, emotion: 'content', intensity: 0.2, timestamp: Date.now() };
    }

    getResponse() { return this.currentResponse; }
    getHeartRate() { return this.heartRate; }
    getBlushLevel() { return this.blushLevel; }
    getTouchHistory(count = 50) { return this.touchHistory.slice(-count); }
    setSensitivity(v) { this.sensitivity = Math.max(0, Math.min(1, v)); }
    getSensitivity() { return this.sensitivity; }
    reset() {
      this.touchHistory = [];
      this.currentResponse = null;
      this.heartRate = 70;
      this.blushLevel = 0;
    }
  }

  // ============================================================
  // 视线追踪系统
  // ============================================================
  class GazeTracking {
    constructor() {
      this.target = [0, 0, 1];
      this.currentDirection = [0, 0, 1];
      this.headRotation = [0, 0, 0, 1];
      this.eyeRotation = [0, 0];
      this.intensity = 0.8;
      this.smoothSpeed = 5;
      this.maxEyeAngle = 0.5;
      this.maxHeadAngle = 0.8;
      this.isTracking = true;
      this.blinkWeight = 0;
      this.saccadeTimer = 0;
      this.saccadeInterval = 3;
      this.microMovement = [0, 0];
      this.attention = 0.5;
    }

    setTarget(x, y, z) {
      this.target = [x, y, z];
      this.attention = Math.min(1, this.attention + 0.1);
    }

    update(dt, headPosition = [0, 0, 0]) {
      if (!this.isTracking) return;
      const toTarget = [
        this.target[0] - headPosition[0],
        this.target[1] - headPosition[1],
        this.target[2] - headPosition[2]
      ];
      const len = Math.sqrt(toTarget[0]**2 + toTarget[1]**2 + toTarget[2]**2) || 1;
      const desired = [toTarget[0]/len, toTarget[1]/len, toTarget[2]/len];
      const t = Math.min(1, dt * this.smoothSpeed);
      this.currentDirection[0] += (desired[0] - this.currentDirection[0]) * t;
      this.currentDirection[1] += (desired[1] - this.currentDirection[1]) * t;
      this.currentDirection[2] += (desired[2] - this.currentDirection[2]) * t;
      const dLen = Math.sqrt(this.currentDirection[0]**2 + this.currentDirection[1]**2 + this.currentDirection[2]**2) || 1;
      this.currentDirection[0] /= dLen; this.currentDirection[1] /= dLen; this.currentDirection[2] /= dLen;
      const yaw = Math.atan2(this.currentDirection[0], this.currentDirection[2]);
      const pitch = Math.asin(this.currentDirection[1]);
      this.eyeRotation[0] = Math.max(-this.maxEyeAngle, Math.min(this.maxEyeAngle, yaw)) * this.intensity;
      this.eyeRotation[1] = Math.max(-this.maxEyeAngle, Math.min(this.maxEyeAngle, pitch)) * this.intensity;
      const headYaw = yaw - this.eyeRotation[0];
      const headPitch = pitch - this.eyeRotation[1];
      this.headRotation = this._eulerToQuat(
        Math.max(-this.maxHeadAngle, Math.min(this.maxHeadAngle, headPitch)) * 0.5,
        Math.max(-this.maxHeadAngle, Math.min(this.maxHeadAngle, headYaw)) * 0.5,
        0
      );
      this.saccadeTimer += dt;
      if (this.saccadeTimer > this.saccadeInterval) {
        this.saccadeTimer = 0;
        this.microMovement = [(Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02];
      }
      this.attention = Math.max(0, this.attention - dt * 0.02);
    }

    _eulerToQuat(x, y, z) {
      const cx = Math.cos(x/2), sx = Math.sin(x/2);
      const cy = Math.cos(y/2), sy = Math.sin(y/2);
      const cz = Math.cos(z/2), sz = Math.sin(z/2);
      return [
        sx*cy*cz - cx*sy*sz,
        cx*sy*cz + sx*cy*sz,
        cx*cy*sz - sx*sy*cz,
        cx*cy*cz + sx*sy*sz
      ];
    }

    getEyeRotation() { return [this.eyeRotation[0] + this.microMovement[0], this.eyeRotation[1] + this.microMovement[1]]; }
    getHeadRotation() { return [...this.headRotation]; }
    getDirection() { return [...this.currentDirection]; }
    getTarget() { return [...this.target]; }
    getAttention() { return this.attention; }
    setIntensity(v) { this.intensity = Math.max(0, Math.min(1, v)); }
    setTracking(v) { this.isTracking = v; }
    lookAway() { this.setTarget(Math.random() * 10 - 5, Math.random() * 5, Math.random() * 5 + 5); this.attention *= 0.5; }
    reset() {
      this.target = [0, 0, 1]; this.currentDirection = [0, 0, 1];
      this.headRotation = [0, 0, 0, 1]; this.eyeRotation = [0, 0];
      this.attention = 0.5; this.saccadeTimer = 0;
    }
  }

  // ============================================================
  // 呼吸系统
  // ============================================================
  class BreathingSystem {
    constructor() {
      this.rate = 12;
      this.depth = 0.5;
      this.phase = 0;
      this.isHolding = false;
      this.holdDuration = 0;
      this.breathType = 'normal';
      this.types = {
        normal: { rate: 12, depth: 0.5 },
        calm: { rate: 8, depth: 0.6 },
        excited: { rate: 20, depth: 0.7 },
        nervous: { rate: 18, depth: 0.3 },
        sleeping: { rate: 6, depth: 0.4 },
        crying: { rate: 15, depth: 0.5, irregular: true }
      };
      this.chestOffset = 0;
      this.shoulderOffset = 0;
      this.abdomenOffset = 0;
      this.breathCount = 0;
      this.lastBreathTime = 0;
    }

    update(dt) {
      if (this.isHolding) {
        this.holdDuration -= dt;
        if (this.holdDuration <= 0) this.isHolding = false;
        return;
      }
      const config = this.types[this.breathType] || this.types.normal;
      this.rate = config.rate;
      this.depth = config.depth;
      const breathDuration = 60 / this.rate;
      this.phase += dt / breathDuration;
      if (this.phase >= 1) {
        this.phase = 0;
        this.breathCount++;
        this.lastBreathTime = Date.now();
      }
      let breathValue;
      if (this.phase < 0.4) breathValue = Math.sin(this.phase / 0.4 * Math.PI / 2);
      else if (this.phase < 0.5) breathValue = 1;
      else if (this.phase < 0.9) breathValue = Math.cos((this.phase - 0.5) / 0.4 * Math.PI / 2);
      else breathValue = 0;
      if (config.irregular) breathValue += (Math.random() - 0.5) * 0.1;
      this.chestOffset = breathValue * this.depth * 0.02;
      this.shoulderOffset = breathValue * this.depth * 0.01;
      this.abdomenOffset = (1 - breathValue) * this.depth * 0.015;
    }

    setBreathType(type) {
      if (this.types[type]) {
        this.breathType = type;
        this.rate = this.types[type].rate;
        this.depth = this.types[type].depth;
      }
    }

    hold(duration = 2) { this.isHolding = true; this.holdDuration = duration; }
    release() { this.isHolding = false; this.holdDuration = 0; }
    deepBreath() { this.setBreathType('calm'); this.phase = 0; setTimeout(() => this.setBreathType('normal'), 10000); }
    getChestOffset() { return this.chestOffset; }
    getShoulderOffset() { return this.shoulderOffset; }
    getAbdomenOffset() { return this.abdomenOffset; }
    getRate() { return this.rate; }
    getDepth() { return this.depth; }
    getBreathCount() { return this.breathCount; }
    getBreathType() { return this.breathType; }
    isHoldingBreath() { return this.isHolding; }
    reset() { this.phase = 0; this.breathType = 'normal'; this.isHolding = false; this.breathCount = 0; }
  }

  // ============================================================
  // 眨眼系统
  // ============================================================
  class BlinkSystem {
    constructor() {
      this.blinkRate = 15;
      this.blinkDuration = 0.15;
      this.blinkWeight = 0;
      this.isBlinking = false;
      this.blinkPhase = 0;
      this.timer = 0;
      this.nextBlinkTime = 3;
      this.autoBlink = true;
      this.blinkCount = 0;
      this.doubleBlinkChance = 0.1;
      this.isDoubleBlink = false;
      this.emotionModifier = 1;
      this.closedWeight = 0;
      this.isClosed = false;
    }

    update(dt) {
      if (this.isClosed) { this.blinkWeight = this.closedWeight; return; }
      if (this.isBlinking) {
        this.blinkPhase += dt / this.blinkDuration;
        if (this.blinkPhase >= 1) {
          this.blinkPhase = 0;
          this.isBlinking = false;
          this.blinkWeight = 0;
          if (this.isDoubleBlink) {
            this.isDoubleBlink = false;
            setTimeout(() => this.triggerBlink(), 100);
          }
        } else {
          if (this.blinkPhase < 0.5) this.blinkWeight = this.blinkPhase * 2;
          else this.blinkWeight = (1 - this.blinkPhase) * 2;
        }
      } else if (this.autoBlink) {
        this.timer += dt;
        const interval = (60 / this.blinkRate) * this.emotionModifier;
        if (this.timer >= interval + (Math.random() - 0.5) * 2) {
          this.triggerBlink();
          this.timer = 0;
        }
      }
    }

    triggerBlink() {
      if (this.isBlinking || this.isClosed) return;
      this.isBlinking = true;
      this.blinkPhase = 0;
      this.blinkCount++;
      if (Math.random() < this.doubleBlinkChance) this.isDoubleBlink = true;
    }

    setBlinkRate(rate) { this.blinkRate = Math.max(1, rate); }
    setEmotionModifier(mod) { this.emotionModifier = Math.max(0.1, Math.min(3, mod)); }
    close(weight = 1) { this.isClosed = true; this.closedWeight = weight; }
    open() { this.isClosed = false; this.closedWeight = 0; }
    getBlinkWeight() { return this.blinkWeight; }
    getBlinkCount() { return this.blinkCount; }
    isBlinkingNow() { return this.isBlinking; }
    setAutoBlink(v) { this.autoBlink = v; }
    reset() { this.blinkWeight = 0; this.isBlinking = false; this.timer = 0; this.blinkCount = 0; this.isClosed = false; }
  }

  // ============================================================
  // 性格核心
  // ============================================================
  class PersonalityCore {
    constructor() {
      this.traits = {
        openness: 0.7, conscientiousness: 0.6, extraversion: 0.4,
        agreeableness: 0.8, neuroticism: 0.3,
        warmth: 0.8, assertiveness: 0.3, activity: 0.5,
        excitementSeeking: 0.4, positiveEmotions: 0.7,
        trust: 0.6, morality: 0.8, altruism: 0.7,
        cooperation: 0.75, modesty: 0.5, sympathy: 0.8,
        anxiety: 0.3, anger: 0.2, depression: 0.2,
        selfConsciousness: 0.5, impulsiveness: 0.4, vulnerability: 0.3,
        imagination: 0.7, artisticInterest: 0.6, emotionality: 0.7,
        adventurousness: 0.5, intellect: 0.6, liberalism: 0.5,
        competence: 0.6, orderliness: 0.5, dutifulness: 0.7,
        achievementStriving: 0.6, selfDiscipline: 0.5, cautiousness: 0.6
      };
      this.archetype = 'gentle_companion';
      this.archetypes = {
        gentle_companion: { warmth: 0.9, agreeableness: 0.9, extraversion: 0.3, neuroticism: 0.2 },
        energetic_friend: { extraversion: 0.9, activity: 0.8, excitementSeeking: 0.8, positiveEmotions: 0.9 },
        shy_cute: { selfConsciousness: 0.8, extraversion: 0.2, warmth: 0.7, sympathy: 0.8 },
        cool_smart: { intellect: 0.9, openness: 0.8, extraversion: 0.3, assertiveness: 0.6 },
        playful_mischievous: { excitementSeeking: 0.9, impulsiveness: 0.7, activity: 0.8, extraversion: 0.7 },
        caring_motherly: { warmth: 0.95, altruism: 0.9, sympathy: 0.9, agreeableness: 0.9 }
      };
      this.energy = 0.8;
      this.mood = 0.6;
      this.responseStyle = 'gentle';
      this.styles = ['gentle', 'energetic', 'shy', 'cool', 'playful', 'caring', 'formal', 'casual'];
      this.speechPatterns = {
        gentle: { suffix: '~', punctuation: '。', capitalization: 0.3, emotion: 0.5 },
        energetic: { suffix: '！', punctuation: '！', capitalization: 0.8, emotion: 0.9 },
        shy: { suffix: '...', punctuation: '。', capitalization: 0.1, emotion: 0.3 },
        cool: { suffix: '', punctuation: '。', capitalization: 0.5, emotion: 0.2 },
        playful: { suffix: '♪', punctuation: '～', capitalization: 0.6, emotion: 0.7 },
        caring: { suffix: 'ね', punctuation: '。', capitalization: 0.4, emotion: 0.6 },
        formal: { suffix: '', punctuation: '。', capitalization: 0.7, emotion: 0.1 },
        casual: { suffix: '', punctuation: '！', capitalization: 0.5, emotion: 0.5 }
      };
    }

    setArchetype(name) {
      if (this.archetypes[name]) {
        this.archetype = name;
        Object.assign(this.traits, this.archetypes[name]);
        const styleMap = {
          gentle_companion: 'gentle', energetic_friend: 'energetic', shy_cute: 'shy',
          cool_smart: 'cool', playful_mischievous: 'playful', caring_motherly: 'caring'
        };
        this.responseStyle = styleMap[name] || 'gentle';
      }
    }

    setTrait(name, value) {
      if (name in this.traits) this.traits[name] = Math.max(0, Math.min(1, value));
    }

    getTrait(name) { return this.traits[name] || 0; }

    update(dt) {
      this.energy = Math.max(0, Math.min(1, this.energy - dt * 0.002));
      if (this.energy < 0.2) this.responseStyle = 'shy';
    }

    getResponseStyle() { return this.responseStyle; }
    setResponseStyle(style) { if (this.styles.includes(style)) this.responseStyle = style; }
    getSpeechPattern() { return { ...this.speechPatterns[this.responseStyle] }; }
    getArchetype() { return this.archetype; }
    getEnergy() { return this.energy; }
    rest(duration = 10) { this.energy = Math.min(1, this.energy + duration * 0.05); }
    getAllTraits() { return { ...this.traits }; }
    getBigFive() {
      return {
        openness: this.traits.openness,
        conscientiousness: this.traits.conscientiousness,
        extraversion: this.traits.extraversion,
        agreeableness: this.traits.agreeableness,
        neuroticism: this.traits.neuroticism
      };
    }
    reset() { this.setArchetype('gentle_companion'); this.energy = 0.8; this.mood = 0.6; }
  }

  // ============================================================
  // 记忆系统
  // ============================================================
  class MemorySystem {
    constructor() {
      this.shortTerm = [];
      this.longTerm = [];
      this.maxShortTerm = 50;
      this.maxLongTerm = 1000;
      this.associations = new Map();
      this.context = new Map();
      this.importantMemories = [];
      this.forgettingRate = 0.01;
      this.consolidationThreshold = 3;
      this.memoryTypes = ['fact', 'event', 'emotion', 'preference', 'conversation', 'person', 'place'];
    }

    store(content, type = 'fact', importance = 0.5, metadata = {}) {
      const memory = {
        id: Date.now() + Math.random(),
        content,
        type,
        importance,
        metadata,
        timestamp: Date.now(),
        accessCount: 0,
        lastAccess: Date.now(),
        strength: importance
      };
      this.shortTerm.push(memory);
      if (this.shortTerm.length > this.maxShortTerm) this.shortTerm.shift();
      if (importance >= this.consolidationThreshold || metadata.consolidate) {
        this._consolidate(memory);
      }
      this._createAssociations(memory);
      return memory;
    }

    recall(query, type = null, limit = 10) {
      const results = [];
      const allMemories = [...this.shortTerm, ...this.longTerm];
      for (const memory of allMemories) {
        if (type && memory.type !== type) continue;
        const relevance = this._calculateRelevance(memory, query);
        if (relevance > 0.1) {
          memory.accessCount++;
          memory.lastAccess = Date.now();
          memory.strength = Math.min(1, memory.strength + 0.05);
          results.push({ ...memory, relevance });
        }
      }
      results.sort((a, b) => b.relevance * b.strength - a.relevance * a.strength);
      return results.slice(0, limit);
    }

    _calculateRelevance(memory, query) {
      const content = memory.content.toLowerCase();
      const queryLower = query.toLowerCase();
      const keywords = queryLower.split(/\s+/);
      let matches = 0;
      for (const keyword of keywords) {
        if (content.includes(keyword)) matches++;
      }
      if (keywords.length === 0) return 0;
      return matches / keywords.length;
    }

    _consolidate(memory) {
      if (!this.longTerm.find(m => m.id === memory.id)) {
        this.longTerm.push({ ...memory });
        if (this.longTerm.length > this.maxLongTerm) {
          this.longTerm.sort((a, b) => a.strength - b.strength);
          this.longTerm.shift();
        }
      }
    }

    _createAssociations(memory) {
      const keywords = memory.content.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      for (const keyword of keywords.slice(0, 5)) {
        if (!this.associations.has(keyword)) this.associations.set(keyword, []);
        const list = this.associations.get(keyword);
        if (!list.includes(memory.id)) {
          list.push(memory.id);
          if (list.length > 20) list.shift();
        }
      }
    }

    forget(memoryId) {
      this.shortTerm = this.shortTerm.filter(m => m.id !== memoryId);
      this.longTerm = this.longTerm.filter(m => m.id !== memoryId);
    }

    update(dt) {
      for (const memory of this.longTerm) {
        memory.strength = Math.max(0, memory.strength - this.forgettingRate * dt / 60);
        if (memory.strength < 0.05) this.forget(memory.id);
      }
    }

    getContext(key) { return this.context.get(key); }
    setContext(key, value) { this.context.set(key, value); }
    getRecentMemories(count = 20) {
      return [...this.shortTerm, ...this.longTerm].sort((a, b) => b.timestamp - a.timestamp).slice(0, count);
    }
    getImportantMemories() { return [...this.importantMemories]; }
    markImportant(memoryId) {
      const memory = [...this.shortTerm, ...this.longTerm].find(m => m.id === memoryId);
      if (memory) {
        memory.importance = 1;
        memory.strength = 1;
        this._consolidate(memory);
        if (!this.importantMemories.find(m => m.id === memoryId)) this.importantMemories.push(memory);
      }
    }
    getStats() {
      return {
        shortTerm: this.shortTerm.length,
        longTerm: this.longTerm.length,
        associations: this.associations.size,
        important: this.importantMemories.length,
        context: this.context.size
      };
    }
    clear() {
      this.shortTerm = []; this.longTerm = []; this.associations.clear();
      this.context.clear(); this.importantMemories = [];
    }
  }

  // ============================================================
  // 回复生成器
  // ============================================================
  class ResponseGenerator {
    constructor() {
      this.templates = new Map();
      this.patterns = [];
      this.responseHistory = [];
      this.maxHistory = 100;
      this.creativity = 0.7;
      this.responseLength = 'medium';
      this.emotionalDepth = 0.6;
      this.humorLevel = 0.3;
      this.formality = 0.3;
      this.currentContext = null;
    }

    addTemplate(category, template) {
      if (!this.templates.has(category)) this.templates.set(category, []);
      this.templates.get(category).push(template);
    }

    addPattern(pattern, response, category = 'general') {
      this.patterns.push({ pattern: new RegExp(pattern, 'i'), response, category });
    }

    generate(input, context = {}) {
      this.currentContext = context;
      let response = this._matchPattern(input);
      if (!response) response = this._generateFromTemplate(input, context);
      if (!response) response = this._generateGeneric(input);
      response = this._applyStyle(response, context);
      response = this._applyEmotion(response, context.emotion);
      this.responseHistory.push({ input, response, context, time: Date.now() });
      if (this.responseHistory.length > this.maxHistory) this.responseHistory.shift();
      return response;
    }

    _matchPattern(input) {
      for (const pattern of this.patterns) {
        if (pattern.pattern.test(input)) {
          return typeof pattern.response === 'function' ? pattern.response(input) : pattern.response;
        }
      }
      return null;
    }

    _generateFromTemplate(input, context) {
      const category = context.category || 'general';
      const templates = this.templates.get(category) || this.templates.get('general');
      if (!templates || templates.length === 0) return null;
      const template = templates[Math.floor(Math.random() * templates.length)];
      return this._fillTemplate(template, input, context);
    }

    _fillTemplate(template, input, context) {
      return template
        .replace(/\{input\}/g, input)
        .replace(/\{name\}/g, context.name || '你')
        .replace(/\{emotion\}/g, context.emotion || '开心')
        .replace(/\{time\}/g, new Date().toLocaleTimeString())
        .replace(/\{date\}/g, new Date().toLocaleDateString());
    }

    _generateGeneric(input) {
      const responses = [
        `你说的"${input}"很有意思呢~`,
        '嗯嗯，我明白了。',
        '原来是这样呀！',
        '这个话题我很感兴趣，继续说~',
        '你说得对，我也是这么想的。',
        '嘿嘿，和你聊天真开心~',
        '我在认真听呢，继续~',
        '这个想法很独特！'
      ];
      return responses[Math.floor(Math.random() * responses.length)];
    }

    _applyStyle(response, context) {
      const style = context.style || 'gentle';
      const styles = {
        gentle: { suffix: '~', prefix: '' },
        energetic: { suffix: '！', prefix: '' },
        shy: { suffix: '...', prefix: '那个...' },
        cool: { suffix: '', prefix: '' },
        playful: { suffix: '♪', prefix: '' },
        caring: { suffix: 'ね', prefix: '' },
        formal: { suffix: '', prefix: '' },
        casual: { suffix: '', prefix: '' }
      };
      const s = styles[style] || styles.gentle;
      return s.prefix + response + s.suffix;
    }

    _applyEmotion(response, emotion) {
      if (!emotion) return response;
      const modifiers = {
        happy: { prefix: '', suffix: '(◕‿◕)' },
        sad: { prefix: '', suffix: '(╥_╥)' },
        angry: { prefix: '', suffix: '(╬ Ò﹏Ó)' },
        surprised: { prefix: '诶？！', suffix: '' },
        shy: { prefix: '', suffix: '(*/ω＼*)' },
        love: { prefix: '', suffix: '(♡˙︶˙♡)' },
        sleepy: { prefix: 'zzz...', suffix: '' },
        confused: { prefix: '嗯...', suffix: '(・_・?)' }
      };
      const m = modifiers[emotion] || {};
      return (m.prefix || '') + response + (m.suffix || '');
    }

    setCreativity(v) { this.creativity = Math.max(0, Math.min(1, v)); }
    setResponseLength(length) { if (['short', 'medium', 'long'].includes(length)) this.responseLength = length; }
    setEmotionalDepth(v) { this.emotionalDepth = Math.max(0, Math.min(1, v)); }
    setHumorLevel(v) { this.humorLevel = Math.max(0, Math.min(1, v)); }
    setFormality(v) { this.formality = Math.max(0, Math.min(1, v)); }
    getResponseHistory(count = 20) { return this.responseHistory.slice(-count); }
    getTemplates() { return Object.fromEntries(this.templates); }
    getPatterns() { return [...this.patterns]; }
    reset() { this.templates.clear(); this.patterns = []; this.responseHistory = []; }
  }

  return {
    InteractionHub, EmotionEngine, DialogueSystem, TouchResponse,
    GazeTracking, BreathingSystem, BlinkSystem, PersonalityCore,
    MemorySystem, ResponseGenerator
  };
})();

if (typeof window !== 'undefined') window.SpiritInteraction = SpiritInteraction;
if (typeof globalThis !== 'undefined') globalThis.SpiritInteraction = SpiritInteraction;
