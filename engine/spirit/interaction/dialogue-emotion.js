/**
 * 灵体交互枢纽扩展 - 高级对话系统/情感引擎/记忆系统/多模态交互/人格模拟
 * 纯JavaScript，零第三方依赖
 * @version 2.0.0
 */
'use strict';

const SpiritInteractionExt = (function () {

  // ============================================================
  // 高级对话引擎 - 上下文管理/意图识别/回复生成/对话状态
  // ============================================================
  class AdvancedDialogueEngine {
    constructor() {
      this.conversations = new Map();
      this.currentConversationId = null;
      this.intentPatterns = new Map();
      this.responseTemplates = new Map();
      this.contextWindow = 10;
      this.maxHistoryLength = 100;
      this.responseDelay = 0;
      this.isTyping = false;
      this.currentResponse = '';
      this.responseProgress = 0;
      this.knowledgeBase = new Map();
      this.fallbackResponses = [
        '我不太确定你在说什么，能再解释一下吗？',
        '这个问题很有趣，让我想想...',
        '我需要更多信息才能回答你。',
        '嗯，我明白你的意思了。',
        '这是一个很好的问题！'
      ];
      this._initDefaultIntents();
    }

    _initDefaultIntents() {
      this.addIntent('greeting', ['你好', '嗨', 'hello', 'hi', '早上好', '晚上好', '在吗'], ['你好！很高兴见到你。', '嗨！今天过得怎么样？', '你好呀，有什么我可以帮你的吗？']);
      this.addIntent('farewell', ['再见', '拜拜', 'bye', '晚安', '走了', '下次见'], ['再见！期待下次聊天。', '晚安，做个好梦。', '拜拜，记得想我哦！']);
      this.addIntent('question', ['什么', '怎么', '为什么', '哪里', '谁', '多少', '何时', '吗', '呢'], null);
      this.addIntent('emotion_happy', ['开心', '高兴', '快乐', '兴奋', '棒', '好', '喜欢', '爱'], null);
      this.addIntent('emotion_sad', ['难过', '伤心', '悲伤', '沮丧', '痛苦', '累', '烦', '郁闷'], null);
      this.addIntent('emotion_angry', ['生气', '愤怒', '讨厌', '烦', '气', '可恶', '该死'], null);
      this.addIntent('compliment', ['漂亮', '好看', '可爱', '聪明', '厉害', '棒', '美', '帅'], null);
      this.addIntent('self_disclosure', ['我觉得', '我认为', '我想', '我的', '我是', '我有'], null);
      this.addIntent('ask_feeling', ['你觉得', '你怎么看', '你认为', '你喜欢', '你想要'], null);
      this.addIntent('joke', ['笑话', '搞笑', '逗我', '讲个'], null);
      this.addIntent('story', ['故事', '讲个', '说说', '聊聊'], null);
    }

    addIntent(name, patterns, responses) {
      this.intentPatterns.set(name, patterns.map(p => new RegExp(p, 'i')));
      if (responses) this.responseTemplates.set(name, responses);
    }

    addKnowledge(topic, content) {
      this.knowledgeBase.set(topic.toLowerCase(), content);
    }

    startConversation(id = 'default') {
      this.currentConversationId = id;
      if (!this.conversations.has(id)) {
        this.conversations.set(id, {
          id,
          messages: [],
          startTime: Date.now(),
          lastActive: Date.now(),
          context: new Map(),
          turnCount: 0,
          currentIntent: null,
          emotionState: 'neutral',
          topic: null
        });
      }
      return this.conversations.get(id);
    }

    endConversation(id) {
      const conv = this.conversations.get(id || this.currentConversationId);
      if (conv) {
        conv.endTime = Date.now();
        conv.duration = conv.endTime - conv.startTime;
      }
      if (id === this.currentConversationId) this.currentConversationId = null;
      return conv;
    }

    processUserInput(input, conversationId = null) {
      const convId = conversationId || this.currentConversationId;
      const conv = this.startConversation(convId);
      const message = {
        role: 'user',
        content: input,
        timestamp: Date.now(),
        intent: this._detectIntent(input),
        emotion: this._detectEmotion(input),
        entities: this._extractEntities(input)
      };
      conv.messages.push(message);
      conv.turnCount++;
      conv.lastActive = Date.now();
      conv.currentIntent = message.intent;
      conv.emotionState = message.emotion;
      if (conv.messages.length > this.maxHistoryLength) {
        conv.messages = conv.messages.slice(-this.maxHistoryLength);
      }
      const response = this._generateResponse(message, conv);
      const responseMessage = {
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
        intent: 'response',
        emotion: this._generateResponseEmotion(message, conv),
        context: this._extractResponseContext(response)
      };
      conv.messages.push(responseMessage);
      this.currentResponse = response;
      return { response, intent: message.intent, emotion: message.emotion, conversation: conv };
    }

    _detectIntent(input) {
      const lowerInput = input.toLowerCase();
      let bestMatch = null;
      let bestScore = 0;
      for (const [intent, patterns] of this.intentPatterns) {
        let score = 0;
        for (const pattern of patterns) {
          if (pattern.test(lowerInput)) score++;
        }
        if (score > bestScore) {
          bestScore = score;
          bestMatch = intent;
        }
      }
      return bestMatch || 'unknown';
    }

    _detectEmotion(input) {
      const lowerInput = input.toLowerCase();
      const emotions = {
        happy: { words: ['开心', '高兴', '快乐', '兴奋', '棒', '好', '喜欢', '爱', '哈哈', '嘻嘻', '😊', '😄'], score: 0 },
        sad: { words: ['难过', '伤心', '悲伤', '沮丧', '痛苦', '累', '烦', '郁闷', '哭', '😭', '😢'], score: 0 },
        angry: { words: ['生气', '愤怒', '讨厌', '气', '可恶', '该死', '恨', '😠', '😡'], score: 0 },
        surprised: { words: ['惊讶', '震惊', '哇', '啊', '什么', '真的', '😮', '😲'], score: 0 },
        fear: { words: ['害怕', '恐惧', '怕', '紧张', '担心', '😨', '😱'], score: 0 },
        disgust: { words: ['恶心', '讨厌', '烦', '鄙视', '🤢', '😒'], score: 0 },
        neutral: { words: [], score: 0.1 }
      };
      for (const [emotion, data] of Object.entries(emotions)) {
        for (const word of data.words) {
          if (lowerInput.includes(word)) data.score += 1;
        }
      }
      let bestEmotion = 'neutral';
      let bestScore = 0.1;
      for (const [emotion, data] of Object.entries(emotions)) {
        if (data.score > bestScore) {
          bestScore = data.score;
          bestEmotion = emotion;
        }
      }
      return bestEmotion;
    }

    _extractEntities(input) {
      const entities = [];
      const timePatterns = [/\d{4}年\d{1,2}月\d{1,2}日/, /今天|明天|昨天|后天/, /早上|中午|下午|晚上|凌晨/];
      for (const pattern of timePatterns) {
        const match = input.match(pattern);
        if (match) entities.push({ type: 'time', value: match[0] });
      }
      const numberPattern = /\d+(\.\d+)?/;
      const numberMatch = input.match(numberPattern);
      if (numberMatch) entities.push({ type: 'number', value: parseFloat(numberMatch[0]) });
      const namePattern = /(?:我叫|我的名字是|我是)([\u4e00-\u9fa5a-zA-Z]+)/;
      const nameMatch = input.match(namePattern);
      if (nameMatch) entities.push({ type: 'name', value: nameMatch[1] });
      return entities;
    }

    _generateResponse(message, conversation) {
      const intent = message.intent;
      const emotion = message.emotion;
      const context = this._getContext(conversation);
      if (this.responseTemplates.has(intent)) {
        const responses = this.responseTemplates.get(intent);
        return responses[Math.floor(Math.random() * responses.length)];
      }
      for (const [topic, content] of this.knowledgeBase) {
        if (message.content.toLowerCase().includes(topic)) {
          return typeof content === 'function' ? content(message, context) : content;
        }
      }
      if (emotion === 'sad') {
        return this._generateEmpatheticResponse(message, context);
      }
      if (emotion === 'happy') {
        return this._generateHappyResponse(message, context);
      }
      if (intent === 'question') {
        return this._generateQuestionResponse(message, context);
      }
      if (intent === 'self_disclosure') {
        return this._generateSelfDisclosureResponse(message, context);
      }
      if (intent === 'ask_feeling') {
        return this._generateOpinionResponse(message, context);
      }
      if (intent === 'compliment') {
        return this._generateComplimentResponse(message, context);
      }
      if (intent === 'joke') {
        return this._generateJoke();
      }
      if (intent === 'story') {
        return this._generateStory(message, context);
      }
      return this.fallbackResponses[Math.floor(Math.random() * this.fallbackResponses.length)];
    }

    _generateEmpatheticResponse(message, context) {
      const responses = [
        '我听到你说的了，这种感觉确实很难受。',
        '我在这里陪着你，想聊聊发生了什么吗？',
        '有时候难过是正常的，给自己一点时间。',
        '我能感受到你的情绪，需要我做什么吗？',
        '无论发生什么，我都会在这里支持你。'
      ];
      return responses[Math.floor(Math.random() * responses.length)];
    }

    _generateHappyResponse(message, context) {
      const responses = [
        '看到你开心我也很高兴！',
        '太棒了！是什么让你这么开心？',
        '你的快乐感染了我！',
        '真好，希望你一直这么开心。',
        '开心的事情值得分享，快告诉我！'
      ];
      return responses[Math.floor(Math.random() * responses.length)];
    }

    _generateQuestionResponse(message, context) {
      const responses = [
        '这是个好问题，让我想想...',
        '关于这个，我觉得需要从几个方面来看。',
        '你问得很深入，我的理解是这样的...',
        '这个问题没有标准答案，但我可以分享我的看法。',
        '让我帮你分析一下这个问题。'
      ];
      return responses[Math.floor(Math.random() * responses.length)];
    }

    _generateSelfDisclosureResponse(message, context) {
      const responses = [
        '谢谢你愿意和我分享这些。',
        '我理解你的感受，这很重要。',
        '你说的这些让我更了解你了。',
        '每个人都有自己的想法，你的感受是有效的。',
        '我在认真听，继续说吧。'
      ];
      return responses[Math.floor(Math.random() * responses.length)];
    }

    _generateOpinionResponse(message, context) {
      const responses = [
        '我觉得这取决于具体情况。',
        '从我的角度来看，我会这样想...',
        '这是个很有意思的话题，我的看法是...',
        '我没有固定的立场，但我可以和你一起探讨。',
        '每个人的看法都不同，我尊重你的观点。'
      ];
      return responses[Math.floor(Math.random() * responses.length)];
    }

    _generateComplimentResponse(message, context) {
      const responses = [
        '谢谢你的夸奖，你也很棒！',
        '你这么说我很开心。',
        '被你欣赏是我的荣幸。',
        '你才是最棒的！',
        '谢谢，我会继续努力的。'
      ];
      return responses[Math.floor(Math.random() * responses.length)];
    }

    _generateJoke() {
      const jokes = [
        '为什么程序员总是分不清万圣节和圣诞节？因为 Oct 31 == Dec 25。',
        '一个程序员走进酒吧，点了一杯啤酒。然后他说："这是我今天的第一个bug。"',
        '为什么程序员喜欢黑暗模式？因为光会吸引bug。',
        '有两种人：一种是能从不完整数据中得出结论的人。',
        '程序员的三大谎言：这很简单、马上就好、不会有bug。'
      ];
      return jokes[Math.floor(Math.random() * jokes.length)];
    }

    _generateStory(message, context) {
      return '从前有一个孤独的旅人，在茫茫人海中寻找着属于自己的归宿。他走过山川湖海，经历春夏秋冬，终于在一个星光璀璨的夜晚，遇见了那个能听懂他心声的存在...';
    }

    _generateResponseEmotion(message, conversation) {
      const emotionMap = {
        happy: 'happy',
        sad: 'empathetic',
        angry: 'calm',
        surprised: 'surprised',
        fear: 'comforting',
        disgust: 'neutral',
        neutral: 'neutral'
      };
      return emotionMap[message.emotion] || 'neutral';
    }

    _extractResponseContext(response) {
      return {
        length: response.length,
        sentenceCount: response.split(/[。！？.!?]/).filter(s => s.trim()).length,
        hasQuestion: response.includes('？') || response.includes('?'),
        topics: []
      };
    }

    _getContext(conversation) {
      const recentMessages = conversation.messages.slice(-this.contextWindow);
      return {
        recentMessages,
        turnCount: conversation.turnCount,
        currentIntent: conversation.currentIntent,
        emotionState: conversation.emotionState,
        topic: conversation.topic,
        userHistory: recentMessages.filter(m => m.role === 'user')
      };
    }

    getConversation(id = null) {
      return this.conversations.get(id || this.currentConversationId);
    }

    getConversationHistory(id = null, limit = 20) {
      const conv = this.getConversation(id);
      return conv ? conv.messages.slice(-limit) : [];
    }

    getCurrentResponse() { return this.currentResponse; }

    setContextWindow(size) { this.contextWindow = Math.max(1, size); }

    setMaxHistoryLength(length) { this.maxHistoryLength = Math.max(10, length); }

    getConversationCount() { return this.conversations.size; }

    getIntentCount() { return this.intentPatterns.size; }

    getKnowledgeBaseSize() { return this.knowledgeBase.size; }

    clearConversations() { this.conversations.clear(); this.currentConversationId = null; }

    dispose() { this.clearConversations(); this.intentPatterns.clear(); this.responseTemplates.clear(); this.knowledgeBase.clear(); }
  }

  // ============================================================
  // 情感引擎 - Plutchik情感轮/情感状态机/情感衰减
  // ============================================================
  class EmotionEngine {
    constructor() {
      this.emotions = {
        joy: 0, trust: 0, fear: 0, surprise: 0,
        sadness: 0, disgust: 0, anger: 0, anticipation: 0
      };
      this.emotionHistory = [];
      this.maxHistoryLength = 100;
      this.decayRate = 0.01;
      this.intensity = 1;
      this.currentMood = 'neutral';
      this.personality = {
        openness: 0.7,
        conscientiousness: 0.6,
        extraversion: 0.5,
        agreeableness: 0.7,
        neuroticism: 0.4
      };
      this.emotionTriggers = new Map();
      this._initDefaultTriggers();
      this.lastUpdate = Date.now();
    }

    _initDefaultTriggers() {
      this.addTrigger('joy', ['开心', '高兴', '快乐', '棒', '好', '喜欢', '爱', '成功', '赢'], 0.3);
      this.addTrigger('sadness', ['难过', '伤心', '悲伤', '失败', '输', '失去', '哭', '痛苦'], 0.3);
      this.addTrigger('anger', ['生气', '愤怒', '讨厌', '可恶', '该死', '恨', '烦'], 0.3);
      this.addTrigger('fear', ['害怕', '恐惧', '怕', '紧张', '担心', '危险'], 0.25);
      this.addTrigger('surprise', ['惊讶', '震惊', '哇', '啊', '什么', '真的', '意外'], 0.2);
      this.addTrigger('disgust', ['恶心', '讨厌', '鄙视', '脏', '丑'], 0.2);
      this.addTrigger('trust', ['相信', '信任', '可靠', '安全', '朋友'], 0.2);
      this.addTrigger('anticipation', ['期待', '希望', '计划', '准备', '未来'], 0.15);
    }

    addTrigger(emotion, keywords, weight) {
      this.emotionTriggers.set(emotion, { keywords, weight });
    }

    processInput(input) {
      const lowerInput = input.toLowerCase();
      const triggered = {};
      for (const [emotion, data] of this.emotionTriggers) {
        for (const keyword of data.keywords) {
          if (lowerInput.includes(keyword)) {
            triggered[emotion] = (triggered[emotion] || 0) + data.weight;
          }
        }
      }
      for (const [emotion, value] of Object.entries(triggered)) {
        this._setEmotion(emotion, this.emotions[emotion] + value * this.intensity);
      }
      this._updateMood();
      this._recordHistory();
      return { emotions: { ...this.emotions }, mood: this.currentMood, triggered };
    }

    _setEmotion(emotion, value) {
      if (this.emotions.hasOwnProperty(emotion)) {
        this.emotions[emotion] = Math.max(0, Math.min(1, value));
      }
    }

    triggerEmotion(emotion, intensity) {
      this._setEmotion(emotion, this.emotions[emotion] + intensity);
      this._updateMood();
      this._recordHistory();
    }

    update(dt) {
      const decay = this.decayRate * dt * 60;
      for (const emotion of Object.keys(this.emotions)) {
        this.emotions[emotion] = Math.max(0, this.emotions[emotion] - decay);
      }
      this._updateMood();
      this.lastUpdate = Date.now();
    }

    _updateMood() {
      const positive = this.emotions.joy + this.emotions.trust + this.emotions.anticipation;
      const negative = this.emotions.sadness + this.emotions.anger + this.emotions.fear + this.emotions.disgust;
      const arousal = positive + negative + this.emotions.surprise;
      const valence = positive - negative;
      if (arousal < 0.1) {
        this.currentMood = 'neutral';
      } else if (valence > 0.3) {
        if (this.emotions.joy > this.emotions.trust) this.currentMood = 'happy';
        else this.currentMood = 'content';
      } else if (valence < -0.3) {
        if (this.emotions.anger > this.emotions.sadness) this.currentMood = 'angry';
        else if (this.emotions.fear > this.emotions.sadness) this.currentMood = 'anxious';
        else this.currentMood = 'sad';
      } else if (this.emotions.surprise > 0.3) {
        this.currentMood = 'surprised';
      } else {
        this.currentMood = 'neutral';
      }
    }

    _recordHistory() {
      this.emotionHistory.push({
        timestamp: Date.now(),
        emotions: { ...this.emotions },
        mood: this.currentMood
      });
      if (this.emotionHistory.length > this.maxHistoryLength) {
        this.emotionHistory.shift();
      }
    }

    getEmotions() { return { ...this.emotions }; }

    getMood() { return this.currentMood; }

    getDominantEmotion() {
      let dominant = 'joy';
      let max = 0;
      for (const [emotion, value] of Object.entries(this.emotions)) {
        if (value > max) { max = value; dominant = emotion; }
      }
      return { emotion: dominant, intensity: max };
    }

    getEmotionVector() {
      return Object.values(this.emotions);
    }

    getArousal() {
      return Object.values(this.emotions).reduce((sum, v) => sum + v, 0) / 8;
    }

    getValence() {
      const positive = this.emotions.joy + this.emotions.trust + this.emotions.anticipation;
      const negative = this.emotions.sadness + this.emotions.anger + this.emotions.fear + this.emotions.disgust;
      return (positive - negative) / 8;
    }

    getEmotionHistory(limit = 20) {
      return this.emotionHistory.slice(-limit);
    }

    setPersonality(traits) {
      Object.assign(this.personality, traits);
      this.decayRate = 0.01 * (1 - this.personality.neuroticism * 0.5);
      this.intensity = 0.8 + this.personality.extraversion * 0.4;
    }

    getPersonality() { return { ...this.personality }; }

    setDecayRate(rate) { this.decayRate = Math.max(0.001, rate); }

    setIntensity(v) { this.intensity = Math.max(0.1, Math.min(2, v)); }

    reset() {
      for (const emotion of Object.keys(this.emotions)) this.emotions[emotion] = 0;
      this.currentMood = 'neutral';
      this.emotionHistory = [];
    }

    dispose() { this.reset(); this.emotionTriggers.clear(); }
  }

  // ============================================================
  // 记忆系统 - 短期/长期记忆/记忆检索/记忆遗忘
  // ============================================================
  class MemorySystem {
    constructor() {
      this.shortTermMemory = [];
      this.longTermMemory = new Map();
      this.maxShortTermSize = 20;
      this.shortTermDecay = 0.01;
      this.longTermCapacity = 1000;
      this.consolidationThreshold = 0.7;
      this.forgettingRate = 0.001;
      this.memoryTypes = ['fact', 'event', 'emotion', 'preference', 'knowledge', 'conversation'];
      this.associations = new Map();
      this.lastAccess = new Map();
    }

    store(content, type = 'fact', importance = 0.5, metadata = {}) {
      const memory = {
        id: this._generateId(),
        content,
        type,
        importance,
        timestamp: Date.now(),
        accessCount: 0,
        lastAccess: Date.now(),
        decay: 1,
        metadata,
        associations: []
      };
      this.shortTermMemory.push(memory);
      if (this.shortTermMemory.length > this.maxShortTermSize) {
        this.shortTermMemory.shift();
      }
      if (importance >= this.consolidationThreshold) {
        this._consolidateToLongTerm(memory);
      }
      return memory;
    }

    _consolidateToLongTerm(memory) {
      if (this.longTermMemory.size >= this.longTermCapacity) {
        this._forgetLeastImportant();
      }
      const longTermMemory = {
        ...memory,
        consolidatedAt: Date.now(),
        recallStrength: 1
      };
      this.longTermMemory.set(memory.id, longTermMemory);
      this._createAssociations(longTermMemory);
    }

    _createAssociations(memory) {
      const keywords = this._extractKeywords(memory.content);
      for (const keyword of keywords) {
        if (!this.associations.has(keyword)) {
          this.associations.set(keyword, new Set());
        }
        this.associations.get(keyword).add(memory.id);
      }
    }

    _extractKeywords(text) {
      const stopWords = ['的', '了', '是', '在', '我', '你', '他', '她', '它', '和', '与', '或', '但', '如果', '因为', '所以', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now'];
      const words = text.toLowerCase().split(/[\s,，。.！!？?、；;：:""'']+/).filter(w => w.length > 1 && !stopWords.includes(w));
      return [...new Set(words)].slice(0, 10);
    }

    retrieve(query, type = null, limit = 5) {
      const results = [];
      const queryKeywords = this._extractKeywords(query);
      for (const memory of this.shortTermMemory) {
        if (type && memory.type !== type) continue;
        const relevance = this._calculateRelevance(memory, query, queryKeywords);
        if (relevance > 0) {
          results.push({ memory, relevance, source: 'short_term' });
        }
      }
      for (const [id, memory] of this.longTermMemory) {
        if (type && memory.type !== type) continue;
        const relevance = this._calculateRelevance(memory, query, queryKeywords);
        if (relevance > 0) {
          results.push({ memory, relevance, source: 'long_term' });
        }
      }
      results.sort((a, b) => b.relevance - a.relevance);
      return results.slice(0, limit);
    }

    _calculateRelevance(memory, query, queryKeywords) {
      let relevance = 0;
      const contentLower = memory.content.toLowerCase();
      for (const keyword of queryKeywords) {
        if (contentLower.includes(keyword)) {
          relevance += 0.2;
        }
      }
      if (memory.type === 'preference' && query.includes('喜欢')) relevance += 0.3;
      if (memory.type === 'fact' && query.includes('什么')) relevance += 0.1;
      relevance += memory.importance * 0.2;
      const timeSinceAccess = (Date.now() - memory.lastAccess) / (1000 * 60 * 60 * 24);
      relevance *= Math.exp(-timeSinceAccess * 0.01);
      return relevance;
    }

    recall(memoryId) {
      const memory = this.longTermMemory.get(memoryId);
      if (memory) {
        memory.accessCount++;
        memory.lastAccess = Date.now();
        memory.recallStrength = Math.min(1, memory.recallStrength + 0.1);
        return memory;
      }
      const shortTerm = this.shortTermMemory.find(m => m.id === memoryId);
      if (shortTerm) {
        shortTerm.accessCount++;
        shortTerm.lastAccess = Date.now();
        return shortTerm;
      }
      return null;
    }

    update(dt) {
      for (const memory of this.shortTermMemory) {
        memory.decay = Math.max(0, memory.decay - this.shortTermDecay * dt * 60);
      }
      this.shortTermMemory = this.shortTermMemory.filter(m => m.decay > 0);
      for (const [id, memory] of this.longTermMemory) {
        const timeSinceAccess = (Date.now() - memory.lastAccess) / (1000 * 60 * 60 * 24);
        memory.recallStrength = Math.max(0, 1 - timeSinceAccess * this.forgettingRate);
      }
    }

    _forgetLeastImportant() {
      let leastImportantId = null;
      let leastImportantValue = Infinity;
      for (const [id, memory] of this.longTermMemory) {
        const value = memory.importance * memory.recallStrength * (1 / (1 + memory.accessCount * 0.1));
        if (value < leastImportantValue) {
          leastImportantValue = value;
          leastImportantId = id;
        }
      }
      if (leastImportantId) {
        this.longTermMemory.delete(leastImportantId);
      }
    }

    forget(memoryId) {
      this.longTermMemory.delete(memoryId);
      this.shortTermMemory = this.shortTermMemory.filter(m => m.id !== memoryId);
    }

    getShortTermMemory() { return [...this.shortTermMemory]; }

    getLongTermMemory(type = null) {
      if (type) {
        return Array.from(this.longTermMemory.values()).filter(m => m.type === type);
      }
      return Array.from(this.longTermMemory.values());
    }

    getMemoryStats() {
      return {
        shortTermCount: this.shortTermMemory.length,
        longTermCount: this.longTermMemory.size,
        associationCount: this.associations.size,
        totalMemories: this.shortTermMemory.length + this.longTermMemory.size
      };
    }

    getPreferences() {
      return this.getLongTermMemory('preference');
    }

    getFacts() {
      return this.getLongTermMemory('fact');
    }

    getEvents() {
      return this.getLongTermMemory('event');
    }

    clear() {
      this.shortTermMemory = [];
      this.longTermMemory.clear();
      this.associations.clear();
      this.lastAccess.clear();
    }

    _generateId() {
      return 'mem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    dispose() { this.clear(); }
  }

  return {
    AdvancedDialogueEngine, EmotionEngine, MemorySystem
  };
})();

if (typeof window !== 'undefined') window.SpiritInteractionExt = SpiritInteractionExt;
if (typeof globalThis !== 'undefined') globalThis.SpiritInteractionExt = SpiritInteractionExt;
