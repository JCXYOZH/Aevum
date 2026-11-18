/**
 * 灵体交互 - 对话管理/情感计算/记忆系统/行为决策/人格模拟
 * 纯JavaScript，零第三方依赖
 * @version 3.0.0
 */
'use strict';

const SpiritInteractionV3 = (function () {

  class DialogueManager {
    constructor() {
      this.conversations = new Map();
      this.currentConversation = null;
      this.intentClassifier = new IntentClassifier();
      this.responseSelector = new ResponseSelector();
      this.contextManager = new ContextManager();
      this.personality = {
        name: '灵体',
        tone: 'gentle',
        empathy: 0.8,
        humor: 0.3,
        formality: 0.5
      };
      this.maxHistoryLength = 50;
      this.isProcessing = false;
      this.callbacks = new Map();
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
      const analysis = this.intentClassifier.classify(input);
      userMessage.intent = analysis.intent;
      userMessage.entities = analysis.entities;
      userMessage.sentiment = analysis.sentiment;
      conversation.messages.push(userMessage);
      this.contextManager.update(conversation, userMessage);
      const context = this.contextManager.getContext(conversation);
      const response = await this.responseSelector.select({
        input,
        intent: analysis.intent,
        entities: analysis.entities,
        sentiment: analysis.sentiment,
        context,
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
      this.isProcessing = false;
      const callback = this.callbacks.get('response');
      if (callback) callback(assistantMessage);
      return assistantMessage;
    }

    getConversation(id = 'default') {
      return this.conversations.get(id);
    }

    getCurrentConversation() {
      return this.currentConversation;
    }

    getHistory(conversationId = 'default', limit = 10) {
      const conversation = this.conversations.get(conversationId);
      if (!conversation) return [];
      return conversation.messages.slice(-limit);
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
      this.callbacks.clear();
    }
  }

  class IntentClassifier {
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

    classify(text) {
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

  class ResponseSelector {
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

    async select(context) {
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

  class ContextManager {
    constructor() {
      this.maxContextLength = 20;
      this.contextExpiryTime = 5 * 60 * 1000;
      this.importantEntities = new Set(['time', 'location', 'person', 'event']);
    }

    update(conversation, message) {
      if (!conversation.context) {
        conversation.context = new Map();
      }
      if (message.entities) {
        for (const entity of message.entities) {
          if (this.importantEntities.has(entity.type)) {
            conversation.context.set(entity.type, {
              value: entity.value,
              timestamp: Date.now(),
              source: message.role
            });
          }
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
      this._cleanExpiredContext(conversation);
    }

    getContext(conversation) {
      if (!conversation.context) return {};
      const context = {};
      for (const [key, value] of conversation.context) {
        context[key] = value.value;
      }
      return context;
    }

    getRecentMessages(conversation, count = 5) {
      if (!conversation.messages) return [];
      return conversation.messages.slice(-count);
    }

    _cleanExpiredContext(conversation) {
      if (!conversation.context) return;
      const now = Date.now();
      for (const [key, value] of conversation.context) {
        if (value.timestamp && now - value.timestamp > this.contextExpiryTime) {
          conversation.context.delete(key);
        }
      }
    }

    clearContext(conversation) {
      if (conversation.context) {
        conversation.context.clear();
      }
    }

    setMaxContextLength(length) {
      this.maxContextLength = Math.max(1, length);
    }

    setContextExpiryTime(time) {
      this.contextExpiryTime = Math.max(1000, time);
    }

    addImportantEntity(type) {
      this.importantEntities.add(type);
    }

    removeImportantEntity(type) {
      this.importantEntities.delete(type);
    }

    getImportantEntities() {
      return Array.from(this.importantEntities);
    }
  }

  return {
    DialogueManager, IntentClassifier, ResponseSelector, ContextManager
  };
})();

if (typeof window !== 'undefined') window.SpiritInteractionV3 = SpiritInteractionV3;
if (typeof globalThis !== 'undefined') globalThis.SpiritInteractionV3 = SpiritInteractionV3;
