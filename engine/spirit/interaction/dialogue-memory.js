/**
 * 灵体交互 - 对话引擎/情感计算/记忆系统/行为决策/人格模拟
 * 纯JavaScript，零第三方依赖
 * @version 6.0.0
 */
'use strict';

const SpiritInteractionV6 = (function () {

  class DialogueEngine {
    constructor() {
      this.conversations = new Map();
      this.currentConversation = null;
      this.intentRecognizer = new IntentRecognizer();
      this.responseGenerator = new ResponseGenerator();
      this.context = new Map();
      this.history = [];
      this.maxHistoryLength = 50;
      this.personality = {
        name: '灵体',
        tone: 'gentle',
        empathy: 0.8,
        humor: 0.3,
        formality: 0.5
      };
      this.callbacks = new Map();
      this.isProcessing = false;
    }

    startConversation(id = 'default') {
      const conversation = {
        id,
        messages: [],
        startTime: Date.now(),
        lastActiveTime: Date.now(),
        turnCount: 0,
        context: new Map()
      };
      this.conversations.set(id, conversation);
      this.currentConversation = conversation;
      return conversation;
    }

    async process(input, conversationId = 'default') {
      let conversation = this.conversations.get(conversationId);
      if (!conversation) {
        conversation = this.startConversation(conversationId);
      }
      this.isProcessing = true;
      conversation.lastActiveTime = Date.now();
      conversation.turnCount++;
      const userMessage = {
        role: 'user',
        content: input,
        timestamp: Date.now(),
        intent: null,
        entities: [],
        sentiment: null
      };
      const analysis = this.intentRecognizer.analyze(input);
      userMessage.intent = analysis.intent;
      userMessage.entities = analysis.entities;
      userMessage.sentiment = analysis.sentiment;
      conversation.messages.push(userMessage);
      this.history.push({ role: 'user', content: input, timestamp: Date.now() });
      if (this.history.length > this.maxHistoryLength) {
        this.history.shift();
      }
      this._updateContext(conversation, userMessage);
      const response = await this.responseGenerator.generate({
        input,
        intent: analysis.intent,
        entities: analysis.entities,
        sentiment: analysis.sentiment,
        context: conversation.context,
        history: conversation.messages,
        personality: this.personality
      });
      const assistantMessage = {
        role: 'assistant',
        content: response.text,
        timestamp: Date.now(),
        emotion: response.emotion,
        actions: response.actions || []
      };
      conversation.messages.push(assistantMessage);
      this.history.push({ role: 'assistant', content: response.text, timestamp: Date.now() });
      if (this.history.length > this.maxHistoryLength) {
        this.history.shift();
      }
      this.isProcessing = false;
      const callback = this.callbacks.get('response');
      if (callback) callback(assistantMessage);
      return assistantMessage;
    }

    _updateContext(conversation, message) {
      if (message.entities) {
        for (const entity of message.entities) {
          conversation.context.set(entity.type, {
            value: entity.value,
            timestamp: Date.now(),
            source: message.role
          });
        }
      }
      if (message.intent) {
        conversation.context.set('lastIntent', {
          value: message.intent,
          timestamp: Date.now()
        });
      }
      if (message.sentiment) {
        conversation.context.set('lastSentiment', {
          value: message.sentiment,
          timestamp: Date.now()
        });
      }
      conversation.context.set('lastMessage', {
        value: message.content,
        timestamp: Date.now(),
        role: message.role
      });
    }

    getConversation(id = 'default') {
      return this.conversations.get(id);
    }

    getCurrentConversation() {
      return this.currentConversation;
    }

    getHistory() {
      return [...this.history];
    }

    setPersonality(personality) {
      this.personality = { ...this.personality, ...personality };
    }

    getPersonality() {
      return { ...this.personality };
    }

    on(event, callback) {
      this.callbacks.set(event, callback);
    }

    clearConversation(id = 'default') {
      this.conversations.delete(id);
      if (this.currentConversation?.id === id) {
        this.currentConversation = null;
      }
    }

    clearAll() {
      this.conversations.clear();
      this.currentConversation = null;
      this.history = [];
      this.callbacks.clear();
    }
  }

  class IntentRecognizer {
    constructor() {
      this.intents = new Map();
      this.entityExtractors = new Map();
      this._initDefaultIntents();
      this._initDefaultEntityExtractors();
    }

    _initDefaultIntents() {
      const defaultIntents = [
        { name: 'greeting', keywords: ['你好', '嗨', '哈喽', '在吗', 'hello', 'hi'], confidence: 0.9 },
        { name: 'farewell', keywords: ['再见', '拜拜', '晚安', 'bye', 'goodbye'], confidence: 0.9 },
        { name: 'question', keywords: ['什么', '为什么', '怎么', '如何', '哪里', '谁', '吗', '呢'], confidence: 0.7 },
        { name: 'command', keywords: ['帮我', '请', '给我', '做', '创建', '打开', '关闭'], confidence: 0.6 },
        { name: 'emotion_positive', keywords: ['开心', '高兴', '喜欢', '爱', '棒', '好', '赞'], confidence: 0.8 },
        { name: 'emotion_negative', keywords: ['难过', '伤心', '生气', '讨厌', '烦', '累', '痛苦'], confidence: 0.8 },
        { name: 'thanks', keywords: ['谢谢', '感谢', 'thanks', 'thank you'], confidence: 0.9 },
        { name: 'apology', keywords: ['对不起', '抱歉', '不好意思', 'sorry'], confidence: 0.9 },
        { name: 'agreement', keywords: ['对', '是的', '没错', '同意', '好的', '嗯'], confidence: 0.7 },
        { name: 'disagreement', keywords: ['不对', '不是', '不同意', '错', '否'], confidence: 0.7 },
        { name: 'time', keywords: ['几点', '什么时候', '今天', '明天', '昨天', '日期', '时间'], confidence: 0.8 },
        { name: 'weather', keywords: ['天气', '下雨', '晴天', '温度', '冷', '热'], confidence: 0.8 },
        { name: 'music', keywords: ['歌', '音乐', '唱', '播放', '旋律'], confidence: 0.7 },
        { name: 'story', keywords: ['故事', '讲', '小说', '情节'], confidence: 0.7 },
        { name: 'joke', keywords: ['笑话', '搞笑', '逗', '幽默'], confidence: 0.8 },
        { name: 'compliment', keywords: ['漂亮', '帅', '聪明', '厉害', '优秀', '可爱'], confidence: 0.7 },
        { name: 'complaint', keywords: ['差', '烂', '糟糕', '失望', '问题', 'bug'], confidence: 0.7 },
        { name: 'request_info', keywords: ['介绍', '说明', '解释', '告诉', '描述'], confidence: 0.6 },
        { name: 'small_talk', keywords: ['聊', '说说', '谈谈', '随便'], confidence: 0.5 }
      ];
      for (const intent of defaultIntents) {
        this.intents.set(intent.name, intent);
      }
    }

    _initDefaultEntityExtractors() {
      this.entityExtractors.set('time', (text) => {
        const entities = [];
        const patterns = [
          /\d{1,2}[:：]\d{2}/g,
          /\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/g,
          /(今天|明天|昨天|后天|大后天|前天|大前天|早上|上午|中午|下午|晚上|凌晨|傍晚)/g
        ];
        for (const pattern of patterns) {
          let match;
          while ((match = pattern.exec(text)) !== null) {
            entities.push({ type: 'time', value: match[0], index: match.index });
          }
        }
        return entities;
      });
      this.entityExtractors.set('number', (text) => {
        const entities = [];
        const pattern = /\d+(\.\d+)?/g;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          entities.push({ type: 'number', value: parseFloat(match[0]), index: match.index });
        }
        return entities;
      });
      this.entityExtractors.set('url', (text) => {
        const entities = [];
        const pattern = /https?:\/\/[^\s]+/g;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          entities.push({ type: 'url', value: match[0], index: match.index });
        }
        return entities;
      });
    }

    addIntent(name, keywords, confidence = 0.5) {
      this.intents.set(name, { name, keywords, confidence });
    }

    removeIntent(name) {
      this.intents.delete(name);
    }

    addEntityExtractor(type, extractor) {
      this.entityExtractors.set(type, extractor);
    }

    removeEntityExtractor(type) {
      this.entityExtractors.delete(type);
    }

    analyze(text) {
      const lowerText = text.toLowerCase();
      const scores = new Map();
      for (const [name, intent] of this.intents) {
        let score = 0;
        let matchCount = 0;
        for (const keyword of intent.keywords) {
          if (lowerText.includes(keyword.toLowerCase())) {
            score += 1;
            matchCount++;
          }
        }
        if (matchCount > 0) {
          score = (score / intent.keywords.length) * intent.confidence;
          scores.set(name, score);
        }
      }
      let bestIntent = 'unknown';
      let bestScore = 0;
      for (const [name, score] of scores) {
        if (score > bestScore) {
          bestScore = score;
          bestIntent = name;
        }
      }
      const entities = this._extractEntities(text);
      const sentiment = this._analyzeSentiment(text);
      return {
        intent: bestIntent,
        confidence: bestScore,
        allScores: Object.fromEntries(scores),
        entities,
        sentiment
      };
    }

    _extractEntities(text) {
      const entities = [];
      for (const extractor of this.entityExtractors.values()) {
        entities.push(...extractor(text));
      }
      return entities;
    }

    _analyzeSentiment(text) {
      const positiveWords = ['好', '棒', '喜欢', '爱', '开心', '高兴', '快乐', '幸福', '满意', '优秀', '赞', '不错', '完美', '精彩', '可爱', '漂亮', '帅'];
      const negativeWords = ['差', '烂', '讨厌', '恨', '难过', '伤心', '痛苦', '失望', '糟糕', '生气', '愤怒', '烦', '累', '悲伤', '郁闷', '焦虑', '害怕'];
      let positiveScore = 0;
      let negativeScore = 0;
      for (const word of positiveWords) {
        if (text.includes(word)) positiveScore++;
      }
      for (const word of negativeWords) {
        if (text.includes(word)) negativeScore++;
      }
      const total = positiveScore + negativeScore;
      const score = total > 0 ? (positiveScore - negativeScore) / total : 0;
      let label = 'neutral';
      if (score > 0.3) label = 'positive';
      else if (score < -0.3) label = 'negative';
      return { score, label, positive: positiveScore, negative: negativeScore };
    }

    getIntentNames() {
      return Array.from(this.intents.keys());
    }

    getIntentCount() {
      return this.intents.size;
    }

    getEntityExtractorTypes() {
      return Array.from(this.entityExtractors.keys());
    }

    clear() {
      this.intents.clear();
      this.entityExtractors.clear();
      this._initDefaultIntents();
      this._initDefaultEntityExtractors();
    }
  }

  class ResponseGenerator {
    constructor() {
      this.templates = new Map();
      this.emotionResponses = new Map();
      this.responseGenerators = new Map();
      this._initDefaultTemplates();
      this._initDefaultEmotionResponses();
    }

    _initDefaultTemplates() {
      const templates = {
        greeting: ['你好呀！很高兴见到你~', '嗨！今天过得怎么样？', '你好！有什么我可以帮你的吗？', '哈喽！欢迎回来~'],
        farewell: ['再见！期待下次聊天~', '拜拜！保重哦~', '晚安！做个好梦~', '再见！有需要随时找我~'],
        thanks: ['不客气！能帮到你我很开心~', '不用谢！这是我应该做的~', '客气啦！随时为你服务~', '哈哈，不用谢！'],
        apology: ['没关系的，我理解~', '不用道歉，我不会介意的~', '没事啦，别放在心上~', '没关系，我们继续吧~'],
        agreement: ['嗯嗯，我也是这么想的~', '对呀，你说得没错！', '是的呢，英雄所见略同~', '完全同意！'],
        disagreement: ['嗯，这个我有不同的看法呢...', '也许可以换个角度想想？', '我觉得可能不是这样哦~', '这个问题我们可以再讨论一下~'],
        compliment: ['谢谢你的夸奖！我会继续努力的~', '哈哈，被你这么说我很开心~', '你也很棒呀！', '谢谢！你的认可对我很重要~'],
        joke: ['为什么程序员总是分不清万圣节和圣诞节？因为 Oct 31 = Dec 25！', '有一个程序员去买面包，他说："给我一个面包，如果有鸡蛋就买两个。"结果他买了两个面包回来。', '调试代码就像在一部悬疑片中扮演侦探，同时你又是凶手。'],
        small_talk: ['好呀，想聊点什么呢？', '没问题，我陪你聊~', '好的，你说我听着~', '哈哈，好呀好呀！'],
        question: ['关于这个问题，我是这样理解的...', '嗯，让我想想这个问题...', '这个问题很有意思，我的看法是...', '好的，关于这个问题，我来解释一下~'],
        command: ['好的，我来帮你处理~', '没问题，马上就好~', '好的，正在为你执行...', '收到，我这就去办~']
      };
      for (const [intent, responses] of Object.entries(templates)) {
        this.templates.set(intent, responses);
      }
    }

    _initDefaultEmotionResponses() {
      const emotionResponses = {
        happy: ['看到你开心我也很开心~', '哈哈，什么事这么高兴呀？', '你的好心情感染到我了~'],
        sad: ['别难过，我在这里陪你~', '发生什么事了？可以跟我说说吗？', '抱抱你，一切都会好起来的~'],
        angry: ['深呼吸，先冷静一下~', '我理解你的感受，慢慢来~', '有什么不开心的可以跟我倾诉~'],
        tired: ['累了就休息一下吧，身体最重要~', '辛苦啦，要不要我给你讲个笑话放松一下？', '好好休息，我会在这里等你~']
      };
      for (const [emotion, responses] of Object.entries(emotionResponses)) {
        this.emotionResponses.set(emotion, responses);
      }
    }

    addTemplate(intent, responses) {
      this.templates.set(intent, responses);
    }

    addEmotionResponse(emotion, responses) {
      this.emotionResponses.set(emotion, responses);
    }

    addResponseGenerator(name, generator) {
      this.responseGenerators.set(name, generator);
    }

    removeResponseGenerator(name) {
      this.responseGenerators.delete(name);
    }

    async generate(context) {
      const { input, intent, entities, sentiment, history, personality } = context;
      let text = '';
      let emotion = 'neutral';
      let actions = [];
      if (sentiment && sentiment.label !== 'neutral') {
        const emotionKey = sentiment.label === 'positive' ? 'happy' : 'sad';
        const emotionResponses = this.emotionResponses.get(emotionKey);
        if (emotionResponses) {
          text = this._randomChoice(emotionResponses);
          emotion = emotionKey;
        }
      }
      if (!text && this.templates.has(intent)) {
        const responses = this.templates.get(intent);
        text = this._randomChoice(responses);
      }
      if (!text) {
        for (const generator of this.responseGenerators.values()) {
          try {
            const generated = await generator(context);
            if (generated) {
              text = generated.text || generated;
              emotion = generated.emotion || emotion;
              actions = generated.actions || actions;
              break;
            }
          } catch (e) {
            console.error('Response generator error:', e);
          }
        }
      }
      if (!text) {
        text = this._generateGenericResponse(input, intent, personality);
      }
      text = this._applyPersonality(text, personality);
      if (intent === 'question') {
        actions.push({ type: 'search', query: input });
      } else if (intent === 'command') {
        actions.push({ type: 'execute', command: input });
      }
      return { text, emotion, actions };
    }

    _generateGenericResponse(input, intent, personality) {
      const responses = [
        `关于"${input}"，我是这样理解的...`,
        `嗯，你提到的"${input}"很有意思呢。`,
        `让我想想关于"${input}"的事情...`,
        `"${input}"这个话题，我可以跟你聊聊~`,
        `好的，关于"${input}"，我的想法是...`
      ];
      return this._randomChoice(responses);
    }

    _applyPersonality(text, personality) {
      let result = text;
      if (personality.formality > 0.7) {
        result = result.replace(/~|呀|呢|啦|哈/g, '');
      }
      if (personality.humor > 0.7 && Math.random() < 0.3) {
        result += ' 哈哈，开个玩笑~';
      }
      return result;
    }

    _randomChoice(array) {
      return array[Math.floor(Math.random() * array.length)];
    }

    getTemplateCount() {
      return this.templates.size;
    }

    getEmotionResponseCount() {
      return this.emotionResponses.size;
    }

    getResponseGeneratorNames() {
      return Array.from(this.responseGenerators.keys());
    }

    clear() {
      this.templates.clear();
      this.emotionResponses.clear();
      this.responseGenerators.clear();
      this._initDefaultTemplates();
      this._initDefaultEmotionResponses();
    }
  }

  class EmotionEngine {
    constructor() {
      this.emotions = new Map();
      this.currentMood = 'neutral';
      this.moodIntensity = 0.5;
      this.personalityTraits = {
        openness: 0.7,
        conscientiousness: 0.6,
        extraversion: 0.5,
        agreeableness: 0.8,
        neuroticism: 0.3
      };
      this.emotionDecayRate = 0.05;
      this.emotionHistory = [];
      this.maxHistoryLength = 100;
      this.triggers = new Map();
      this._initDefaultEmotions();
      this._initDefaultTriggers();
    }

    _initDefaultEmotions() {
      const emotionTypes = [
        { name: 'joy', value: 0, category: 'positive', color: '#FFD700' },
        { name: 'sadness', value: 0, category: 'negative', color: '#4169E1' },
        { name: 'anger', value: 0, category: 'negative', color: '#DC143C' },
        { name: 'fear', value: 0, category: 'negative', color: '#8B008B' },
        { name: 'surprise', value: 0, category: 'neutral', color: '#00CED1' },
        { name: 'disgust', value: 0, category: 'negative', color: '#556B2F' },
        { name: 'trust', value: 0.5, category: 'positive', color: '#32CD32' },
        { name: 'anticipation', value: 0.3, category: 'positive', color: '#FF8C00' },
        { name: 'love', value: 0, category: 'positive', color: '#FF69B4' },
        { name: 'calm', value: 0.5, category: 'neutral', color: '#E0E0E0' },
        { name: 'excitement', value: 0, category: 'positive', color: '#FF4500' },
        { name: 'boredom', value: 0, category: 'negative', color: '#808080' },
        { name: 'shame', value: 0, category: 'negative', color: '#9932CC' },
        { name: 'guilt', value: 0, category: 'negative', color: '#8B4513' },
        { name: 'pride', value: 0, category: 'positive', color: '#DAA520' },
        { name: 'hope', value: 0.3, category: 'positive', color: '#87CEEB' },
        { name: 'gratitude', value: 0, category: 'positive', color: '#98FB98' },
        { name: 'compassion', value: 0.5, category: 'positive', color: '#F0E68C' },
        { name: 'envy', value: 0, category: 'negative', color: '#2E8B57' },
        { name: 'jealousy', value: 0, category: 'negative', color: '#556B2F' }
      ];
      for (const emotion of emotionTypes) {
        this.emotions.set(emotion.name, { ...emotion });
      }
    }

    _initDefaultTriggers() {
      this.addTrigger('joy', ['开心', '高兴', '快乐', '哈哈', '棒', '好', '喜欢', '爱', '成功', '赢'], 0.3);
      this.addTrigger('sadness', ['难过', '伤心', '哭', '失败', '失去', '离别', '遗憾'], 0.3);
      this.addTrigger('anger', ['生气', '愤怒', '讨厌', '烦', '气死', '可恶'], 0.3);
      this.addTrigger('fear', ['害怕', '恐惧', '担心', '紧张', '可怕', '恐怖'], 0.3);
      this.addTrigger('surprise', ['惊讶', '吃惊', '没想到', '居然', '竟然', '哇'], 0.3);
      this.addTrigger('love', ['爱', '喜欢', '心动', '甜蜜', '浪漫', '拥抱'], 0.3);
      this.addTrigger('trust', ['相信', '信任', '可靠', '安全', '放心'], 0.2);
      this.addTrigger('gratitude', ['谢谢', '感谢', '感激', '感恩'], 0.3);
      this.addTrigger('excitement', ['兴奋', '激动', '期待', '太棒了', '耶'], 0.3);
      this.addTrigger('calm', ['平静', '安静', '放松', '休息', '慢慢来'], 0.2);
    }

    addTrigger(emotion, keywords, intensity = 0.2) {
      this.triggers.set(emotion, { keywords, intensity });
    }

    processInput(text) {
      const lowerText = text.toLowerCase();
      for (const [emotionName, trigger] of this.triggers) {
        for (const keyword of trigger.keywords) {
          if (lowerText.includes(keyword.toLowerCase())) {
            this.triggerEmotion(emotionName, trigger.intensity);
          }
        }
      }
      this._updateMood();
      this._decayEmotions();
      this._recordHistory();
      return this.getEmotionalState();
    }

    triggerEmotion(name, intensity = 0.5) {
      const emotion = this.emotions.get(name);
      if (emotion) {
        emotion.value = Math.min(1, emotion.value + intensity);
        this._updateMood();
      }
    }

    _updateMood() {
      let positiveSum = 0;
      let negativeSum = 0;
      let positiveCount = 0;
      let negativeCount = 0;
      for (const emotion of this.emotions.values()) {
        if (emotion.category === 'positive') {
          positiveSum += emotion.value;
          positiveCount++;
        } else if (emotion.category === 'negative') {
          negativeSum += emotion.value;
          negativeCount++;
        }
      }
      const positiveAvg = positiveCount > 0 ? positiveSum / positiveCount : 0;
      const negativeAvg = negativeCount > 0 ? negativeSum / negativeCount : 0;
      const moodScore = positiveAvg - negativeAvg;
      if (moodScore > 0.3) {
        this.currentMood = 'positive';
      } else if (moodScore < -0.3) {
        this.currentMood = 'negative';
      } else {
        this.currentMood = 'neutral';
      }
      this.moodIntensity = Math.abs(moodScore);
    }

    _decayEmotions() {
      for (const emotion of this.emotions.values()) {
        emotion.value = Math.max(0, emotion.value - this.emotionDecayRate);
      }
    }

    _recordHistory() {
      const snapshot = {
        timestamp: Date.now(),
        mood: this.currentMood,
        intensity: this.moodIntensity,
        emotions: {}
      };
      for (const [name, emotion] of this.emotions) {
        if (emotion.value > 0.01) {
          snapshot.emotions[name] = emotion.value;
        }
      }
      this.emotionHistory.push(snapshot);
      if (this.emotionHistory.length > this.maxHistoryLength) {
        this.emotionHistory.shift();
      }
    }

    getEmotionalState() {
      const activeEmotions = [];
      for (const [name, emotion] of this.emotions) {
        if (emotion.value > 0.05) {
          activeEmotions.push({ name, value: emotion.value, category: emotion.category, color: emotion.color });
        }
      }
      activeEmotions.sort((a, b) => b.value - a.value);
      return {
        mood: this.currentMood,
        moodIntensity: this.moodIntensity,
        dominantEmotion: activeEmotions[0] || null,
        activeEmotions,
        personalityTraits: { ...this.personalityTraits }
      };
    }

    getEmotionValue(name) {
      const emotion = this.emotions.get(name);
      return emotion ? emotion.value : 0;
    }

    setPersonalityTrait(trait, value) {
      if (this.personalityTraits.hasOwnProperty(trait)) {
        this.personalityTraits[trait] = Math.max(0, Math.min(1, value));
      }
    }

    getPersonalityTraits() {
      return { ...this.personalityTraits };
    }

    getEmotionHistory() {
      return [...this.emotionHistory];
    }

    getEmotionNames() {
      return Array.from(this.emotions.keys());
    }

    getEmotionCount() {
      return this.emotions.size;
    }

    setDecayRate(rate) {
      this.emotionDecayRate = Math.max(0, Math.min(1, rate));
    }

    reset() {
      for (const emotion of this.emotions.values()) {
        emotion.value = emotion.name === 'calm' || emotion.name === 'trust' || emotion.name === 'compassion' || emotion.name === 'hope' ? 0.3 : 0;
      }
      this.currentMood = 'neutral';
      this.moodIntensity = 0.5;
      this.emotionHistory = [];
    }
  }

  class MemorySystem {
    constructor() {
      this.shortTermMemory = [];
      this.longTermMemory = new Map();
      this.episodicMemory = [];
      this.semanticMemory = new Map();
      this.proceduralMemory = new Map();
      this.maxShortTermLength = 20;
      this.consolidationThreshold = 3;
      this.forgettingRate = 0.01;
      this.associations = new Map();
      this.callbacks = new Map();
    }

    store(type, content, metadata = {}) {
      const memory = {
        id: this._generateId(),
        type,
        content,
        metadata,
        timestamp: Date.now(),
        accessCount: 0,
        lastAccessTime: Date.now(),
        importance: metadata.importance || 0.5,
        emotionalWeight: metadata.emotionalWeight || 0
      };
      if (type === 'short_term') {
        this.shortTermMemory.push(memory);
        if (this.shortTermMemory.length > this.maxShortTermLength) {
          const removed = this.shortTermMemory.shift();
          if (removed.accessCount >= this.consolidationThreshold || removed.importance > 0.7) {
            this._consolidateToLongTerm(removed);
          }
        }
      } else if (type === 'long_term') {
        this.longTermMemory.set(memory.id, memory);
      } else if (type === 'episodic') {
        this.episodicMemory.push(memory);
      } else if (type === 'semantic') {
        this.semanticMemory.set(content, memory);
      } else if (type === 'procedural') {
        this.proceduralMemory.set(content, memory);
      }
      const callback = this.callbacks.get('store');
      if (callback) callback(memory);
      return memory;
    }

    _consolidateToLongTerm(memory) {
      const longTermMemory = {
        ...memory,
        type: 'long_term',
        consolidatedAt: Date.now(),
        consolidationCount: (memory.consolidationCount || 0) + 1
      };
      this.longTermMemory.set(memory.id, longTermMemory);
    }

    retrieve(type, query, limit = 10) {
      let results = [];
      if (type === 'short_term') {
        results = this.shortTermMemory.filter(m => this._matches(m, query));
      } else if (type === 'long_term') {
        results = Array.from(this.longTermMemory.values()).filter(m => this._matches(m, query));
      } else if (type === 'episodic') {
        results = this.episodicMemory.filter(m => this._matches(m, query));
      } else if (type === 'semantic') {
        results = Array.from(this.semanticMemory.values()).filter(m => this._matches(m, query));
      } else if (type === 'all') {
        results = [
          ...this.shortTermMemory,
          ...this.longTermMemory.values(),
          ...this.episodicMemory,
          ...this.semanticMemory.values()
        ].filter(m => this._matches(m, query));
      }
      for (const memory of results) {
        memory.accessCount++;
        memory.lastAccessTime = Date.now();
      }
      results.sort((a, b) => {
        const scoreA = this._calculateRelevance(a, query);
        const scoreB = this._calculateRelevance(b, query);
        return scoreB - scoreA;
      });
      return results.slice(0, limit);
    }

    _matches(memory, query) {
      if (!query) return true;
      const content = typeof memory.content === 'string' ? memory.content : JSON.stringify(memory.content);
      return content.toLowerCase().includes(query.toLowerCase());
    }

    _calculateRelevance(memory, query) {
      let score = memory.importance * 0.3;
      score += Math.min(1, memory.accessCount / 10) * 0.2;
      const timeSinceAccess = Date.now() - memory.lastAccessTime;
      score += Math.max(0, 1 - timeSinceAccess / (1000 * 60 * 60 * 24)) * 0.2;
      score += memory.emotionalWeight * 0.3;
      if (query) {
        const content = typeof memory.content === 'string' ? memory.content : JSON.stringify(memory.content);
        if (content.toLowerCase().includes(query.toLowerCase())) {
          score += 0.5;
        }
      }
      return score;
    }

    associate(key, relatedKeys) {
      if (!this.associations.has(key)) {
        this.associations.set(key, new Set());
      }
      const associationSet = this.associations.get(key);
      for (const relatedKey of relatedKeys) {
        associationSet.add(relatedKey);
        if (!this.associations.has(relatedKey)) {
          this.associations.set(relatedKey, new Set());
        }
        this.associations.get(relatedKey).add(key);
      }
    }

    getAssociations(key) {
      const associationSet = this.associations.get(key);
      return associationSet ? Array.from(associationSet) : [];
    }

    forget(memoryId) {
      this.shortTermMemory = this.shortTermMemory.filter(m => m.id !== memoryId);
      this.longTermMemory.delete(memoryId);
      this.episodicMemory = this.episodicMemory.filter(m => m.id !== memoryId);
    }

    getMemoryStats() {
      return {
        shortTermCount: this.shortTermMemory.length,
        longTermCount: this.longTermMemory.size,
        episodicCount: this.episodicMemory.length,
        semanticCount: this.semanticMemory.size,
        proceduralCount: this.proceduralMemory.size,
        associationCount: this.associations.size,
        totalAccesses: this._countTotalAccesses()
      };
    }

    _countTotalAccesses() {
      let total = 0;
      for (const memory of this.shortTermMemory) total += memory.accessCount;
      for (const memory of this.longTermMemory.values()) total += memory.accessCount;
      for (const memory of this.episodicMemory) total += memory.accessCount;
      return total;
    }

    on(event, callback) {
      this.callbacks.set(event, callback);
    }

    off(event) {
      this.callbacks.delete(event);
    }

    clear() {
      this.shortTermMemory = [];
      this.longTermMemory.clear();
      this.episodicMemory = [];
      this.semanticMemory.clear();
      this.proceduralMemory.clear();
      this.associations.clear();
    }

    _generateId() {
      return 'mem_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
    }
  }

  return {
    DialogueEngine, IntentRecognizer, ResponseGenerator, EmotionEngine, MemorySystem
  };
})();

if (typeof window !== 'undefined') window.SpiritInteractionV6 = SpiritInteractionV6;
if (typeof globalThis !== 'undefined') globalThis.SpiritInteractionV6 = SpiritInteractionV6;
