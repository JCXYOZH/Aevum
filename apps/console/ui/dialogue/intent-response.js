/**
 * 灵体交互 - 对话管理/意图分类/响应选择/上下文管理/情感计算
 * 纯JavaScript，零第三方依赖
 * @version 5.0.0
 */
'use strict';

const SpiritInteractionV5 = (function () {

  class DialogueManager {
    constructor() {
      this.sessions = new Map();
      this.currentSession = null;
      this.maxHistoryLength = 100;
      this.sessionTimeout = 30 * 60 * 1000;
      this.callbacks = new Map();
      this.stats = { sessions: 0, messages: 0, activeSessions: 0 };
      this.intentClassifier = new IntentClassifier();
      this.responseSelector = new ResponseSelector();
      this.contextManager = new ContextManager();
    }

    createSession(id = 'default', config = {}) {
      const session = {
        id,
        messages: [],
        startTime: Date.now(),
        lastActiveTime: Date.now(),
        turnCount: 0,
        context: new Map(),
        personality: config.personality || {
          name: '灵体',
          tone: 'gentle',
          empathy: 0.8,
          humor: 0.3
        },
        state: 'active',
        metadata: config.metadata || {}
      };
      this.sessions.set(id, session);
      this.currentSession = session;
      this.stats.sessions++;
      this.stats.activeSessions++;
      return session;
    }

    removeSession(id) {
      const session = this.sessions.get(id);
      if (session) {
        session.state = 'ended';
        this.sessions.delete(id);
        this.stats.activeSessions--;
        if (this.currentSession?.id === id) {
          this.currentSession = null;
        }
      }
    }

    getSession(id) {
      return this.sessions.get(id);
    }

    getCurrentSession() {
      return this.currentSession;
    }

    setCurrentSession(id) {
      const session = this.sessions.get(id);
      if (session) {
        this.currentSession = session;
      }
    }

    async process(input, sessionId = 'default') {
      let session = this.sessions.get(sessionId);
      if (!session) {
        session = this.createSession(sessionId);
      }
      if (session.state !== 'active') {
        session.state = 'active';
      }
      session.lastActiveTime = Date.now();
      session.turnCount++;
      const userMessage = {
        id: this._generateId(),
        role: 'user',
        content: input,
        timestamp: Date.now(),
        intent: null,
        entities: [],
        sentiment: null,
        confidence: 0
      };
      const analysis = this.intentClassifier.classify(input);
      userMessage.intent = analysis.intent;
      userMessage.entities = analysis.entities;
      userMessage.sentiment = analysis.sentiment;
      userMessage.confidence = analysis.confidence;
      session.messages.push(userMessage);
      if (session.messages.length > this.maxHistoryLength) {
        session.messages.shift();
      }
      this.stats.messages++;
      this.contextManager.update(session, userMessage);
      const response = await this.responseSelector.select({
        input,
        intent: analysis.intent,
        entities: analysis.entities,
        sentiment: analysis.sentiment,
        context: session.context,
        history: session.messages,
        personality: session.personality
      });
      const assistantMessage = {
        id: this._generateId(),
        role: 'assistant',
        content: response.text,
        timestamp: Date.now(),
        emotion: response.emotion,
        actions: response.actions || [],
        confidence: response.confidence || 0
      };
      session.messages.push(assistantMessage);
      if (session.messages.length > this.maxHistoryLength) {
        session.messages.shift();
      }
      this.stats.messages++;
      this.contextManager.update(session, assistantMessage);
      const callback = this.callbacks.get('response');
      if (callback) callback(assistantMessage, session);
      return assistantMessage;
    }

    getHistory(sessionId = 'default', limit = 50) {
      const session = this.sessions.get(sessionId);
      if (!session) return [];
      return session.messages.slice(-limit);
    }

    getRecentMessages(sessionId = 'default', count = 10) {
      return this.getHistory(sessionId, count);
    }

    getContext(sessionId = 'default') {
      const session = this.sessions.get(sessionId);
      return session ? Object.fromEntries(session.context) : {};
    }

    setContext(sessionId, key, value) {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.context.set(key, {
          value,
          timestamp: Date.now(),
          source: 'external'
        });
      }
    }

    clearContext(sessionId = 'default') {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.context.clear();
      }
    }

    getPersonality(sessionId = 'default') {
      const session = this.sessions.get(sessionId);
      return session ? { ...session.personality } : null;
    }

    setPersonality(sessionId, personality) {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.personality = { ...session.personality, ...personality };
      }
    }

    getSessionIds() {
      return Array.from(this.sessions.keys());
    }

    getActiveSessions() {
      return Array.from(this.sessions.values()).filter(s => s.state === 'active');
    }

    getStats() {
      return {
        ...this.stats,
        activeSessions: this.getActiveSessions().length
      };
    }

    on(event, callback) {
      this.callbacks.set(event, callback);
    }

    off(event) {
      this.callbacks.delete(event);
    }

    cleanup() {
      const now = Date.now();
      for (const [id, session] of this.sessions) {
        if (now - session.lastActiveTime > this.sessionTimeout) {
          session.state = 'timeout';
          this.sessions.delete(id);
          this.stats.activeSessions--;
        }
      }
    }

    clear() {
      this.sessions.clear();
      this.currentSession = null;
      this.callbacks.clear();
      this.stats = { sessions: 0, messages: 0, activeSessions: 0 };
    }

    _generateId() {
      return 'msg_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
    }
  }

  class IntentClassifier {
    constructor() {
      this.intents = new Map();
      this.entityExtractors = new Map();
      this.stopWords = new Set(['的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这']);
      this._initDefaultIntents();
      this._initDefaultEntityExtractors();
    }

    _initDefaultIntents() {
      const intents = [
        { name: 'greeting', keywords: ['你好', '嗨', '哈喽', '在吗', 'hello', 'hi', '早上好', '下午好', '晚上好'], weight: 1.0 },
        { name: 'farewell', keywords: ['再见', '拜拜', '晚安', 'bye', 'goodbye', '下次见', '走了'], weight: 1.0 },
        { name: 'question', keywords: ['什么', '为什么', '怎么', '如何', '哪里', '谁', '吗', '呢', '？', '?', '能不能', '可以吗'], weight: 0.8 },
        { name: 'command', keywords: ['帮我', '请', '给我', '做', '创建', '打开', '关闭', '开始', '停止', '执行'], weight: 0.7 },
        { name: 'emotion_positive', keywords: ['开心', '高兴', '喜欢', '爱', '棒', '好', '赞', '哈哈', '太棒了', '太好了'], weight: 0.9 },
        { name: 'emotion_negative', keywords: ['难过', '伤心', '生气', '讨厌', '烦', '累', '痛苦', '郁闷', '焦虑', '害怕'], weight: 0.9 },
        { name: 'thanks', keywords: ['谢谢', '感谢', 'thanks', 'thank you', '多谢', '辛苦了'], weight: 1.0 },
        { name: 'apology', keywords: ['对不起', '抱歉', '不好意思', 'sorry', '原谅我'], weight: 1.0 },
        { name: 'agreement', keywords: ['对', '是的', '没错', '同意', '好的', '嗯', '行', '可以', '没问题'], weight: 0.8 },
        { name: 'disagreement', keywords: ['不对', '不是', '不同意', '错', '否', '不行', '不可以'], weight: 0.8 },
        { name: 'time', keywords: ['几点', '什么时候', '今天', '明天', '昨天', '日期', '时间', '星期'], weight: 0.9 },
        { name: 'weather', keywords: ['天气', '下雨', '晴天', '温度', '冷', '热', '下雪', '刮风'], weight: 0.9 },
        { name: 'music', keywords: ['歌', '音乐', '唱', '播放', '旋律', '歌曲', '歌手'], weight: 0.8 },
        { name: 'story', keywords: ['故事', '讲', '小说', '情节', '剧情', '讲讲'], weight: 0.8 },
        { name: 'joke', keywords: ['笑话', '搞笑', '逗', '幽默', '段子', '讲个笑话'], weight: 0.9 },
        { name: 'compliment', keywords: ['漂亮', '帅', '聪明', '厉害', '优秀', '可爱', '美丽', '好看'], weight: 0.8 },
        { name: 'complaint', keywords: ['差', '烂', '糟糕', '失望', '问题', 'bug', '不好', '不行'], weight: 0.8 },
        { name: 'request_info', keywords: ['介绍', '说明', '解释', '告诉', '描述', '什么是', '定义'], weight: 0.7 },
        { name: 'small_talk', keywords: ['聊', '说说', '谈谈', '随便', '聊聊', '唠唠'], weight: 0.6 },
        { name: 'help', keywords: ['帮助', '帮忙', '怎么办', '如何', '教程', '指导'], weight: 0.8 },
        { name: 'self_disclosure', keywords: ['我觉得', '我认为', '我想', '我喜欢', '我讨厌', '我的'], weight: 0.5 },
        { name: 'relationship', keywords: ['朋友', '家人', '妈妈', '爸爸', '女朋友', '男朋友', '老婆', '老公'], weight: 0.7 },
        { name: 'work_study', keywords: ['工作', '学习', '考试', '作业', '项目', '代码', '编程', 'bug'], weight: 0.7 },
        { name: 'health', keywords: ['身体', '健康', '生病', '感冒', '发烧', '医院', '医生', '吃药'], weight: 0.8 },
        { name: 'food', keywords: ['吃', '饭', '食物', '美食', '饿', '渴', '喝', '菜'], weight: 0.7 },
        { name: 'travel', keywords: ['旅游', '旅行', '出去玩', '机票', '酒店', '景点', '攻略'], weight: 0.8 },
        { name: 'shopping', keywords: ['买', '购物', '价格', '便宜', '贵', '淘宝', '京东', '商品'], weight: 0.7 },
        { name: 'entertainment', keywords: ['电影', '电视', '游戏', '玩', '动漫', '小说', '综艺'], weight: 0.7 },
        { name: 'technology', keywords: ['电脑', '手机', '软件', '硬件', '网络', 'AI', '人工智能', '技术'], weight: 0.7 }
      ];
      for (const intent of intents) {
        this.intents.set(intent.name, intent);
      }
    }

    _initDefaultEntityExtractors() {
      this.entityExtractors.set('time', (text) => {
        const entities = [];
        const patterns = [
          /\d{1,2}[:：]\d{2}/g,
          /\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/g,
          /(今天|明天|昨天|后天|大后天|前天|大前天|早上|上午|中午|下午|晚上|凌晨|傍晚|今晚|明早)/g
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
      this.entityExtractors.set('email', (text) => {
        const entities = [];
        const pattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          entities.push({ type: 'email', value: match[0], index: match.index });
        }
        return entities;
      });
      this.entityExtractors.set('person', (text) => {
        const entities = [];
        const pattern = /(?:我|你|他|她|它|我们|你们|他们|她们|它们|妈妈|爸爸|哥哥|姐姐|弟弟|妹妹|老师|同学|朋友|老板|同事)/g;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          entities.push({ type: 'person', value: match[0], index: match.index });
        }
        return entities;
      });
      this.entityExtractors.set('location', (text) => {
        const entities = [];
        const pattern = /(?:北京|上海|广州|深圳|杭州|成都|重庆|武汉|西安|南京|天津|苏州|长沙|郑州|东莞|青岛|沈阳|宁波|昆明|大连|厦门|济南|哈尔滨|福州|长春|石家庄|南宁|南昌|贵阳|合肥|太原|兰州|乌鲁木齐|呼和浩特|银川|西宁|海口|拉萨|香港|澳门|台湾|中国|美国|日本|韩国|英国|法国|德国|俄罗斯|加拿大|澳大利亚)/g;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          entities.push({ type: 'location', value: match[0], index: match.index });
        }
        return entities;
      });
    }

    addIntent(name, keywords, weight = 0.5) {
      this.intents.set(name, { name, keywords, weight });
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
          score = (score / intent.keywords.length) * intent.weight;
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
      const positiveWords = ['好', '棒', '喜欢', '爱', '开心', '高兴', '快乐', '幸福', '满意', '优秀', '赞', '不错', '完美', '精彩', '可爱', '漂亮', '帅', '太好了', '太棒了'];
      const negativeWords = ['差', '烂', '讨厌', '恨', '难过', '伤心', '痛苦', '失望', '糟糕', '生气', '愤怒', '烦', '累', '悲伤', '郁闷', '焦虑', '害怕', '不好', '不行'];
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
      this.fallbackResponses = [
        '嗯，让我想想这个问题...',
        '这个话题很有意思，你能再详细说说吗？',
        '我理解你的意思，我的想法是...',
        '关于这个，我是这样看的...',
        '好的，我来跟你聊聊这个~'
      ];
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
        command: ['好的，我来帮你处理~', '没问题，马上就好~', '好的，正在为你执行...', '收到，我这就去办~'],
        help: ['别担心，我来帮你！', '没问题，告诉我具体遇到了什么问题？', '好的，我来一步步教你~', '放心，有我在呢~'],
        emotion_positive: ['看到你开心我也很开心~', '哈哈，什么事这么高兴呀？', '你的好心情感染到我了~', '太棒了！继续保持哦~'],
        emotion_negative: ['别难过，我在这里陪你~', '发生什么事了？可以跟我说说吗？', '抱抱你，一切都会好起来的~', '我理解你的感受，慢慢来~'],
        time: ['现在的时间是...', '关于时间，我来告诉你~', '好的，时间信息如下~'],
        weather: ['今天的天气是...', '关于天气，我来查一下~', '好的，天气预报如下~'],
        music: ['好的，为你播放音乐~', '想听什么歌呢？', '好的，音乐来了~'],
        story: ['好的，我来给你讲个故事~', '从前有座山，山里有座庙...', '好的，故事开始了~'],
        food: ['说到吃的，我也饿了~', '你想吃什么呢？', '好的，美食推荐来了~'],
        health: ['身体最重要，要好好照顾自己哦~', '关于健康，我建议...', '好的，健康小贴士来了~'],
        work_study: ['工作/学习辛苦了！', '关于这个问题，我来帮你分析~', '好的，我们一起来解决这个问题~'],
        technology: ['关于技术，我来跟你聊聊~', '这个技术问题很有意思~', '好的，技术解答来了~']
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
        tired: ['累了就休息一下吧，身体最重要~', '辛苦啦，要不要我给你讲个笑话放松一下？', '好好休息，我会在这里等你~'],
        anxious: ['别担心，深呼吸~', '我理解你的焦虑，我们一起来面对~', '放轻松，一切都会好起来的~']
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
      let confidence = 0.5;
      if (sentiment && sentiment.label !== 'neutral' && Math.abs(sentiment.score) > 0.5) {
        const emotionKey = sentiment.label === 'positive' ? 'happy' : 'sad';
        const emotionResponses = this.emotionResponses.get(emotionKey);
        if (emotionResponses) {
          text = this._randomChoice(emotionResponses);
          emotion = emotionKey;
          confidence = 0.8;
        }
      }
      if (!text && this.templates.has(intent)) {
        const responses = this.templates.get(intent);
        text = this._randomChoice(responses);
        confidence = 0.7;
      }
      if (!text) {
        for (const generator of this.responseGenerators.values()) {
          try {
            const generated = await generator(context);
            if (generated) {
              text = generated.text || generated;
              emotion = generated.emotion || emotion;
              actions = generated.actions || actions;
              confidence = generated.confidence || confidence;
              break;
            }
          } catch (e) {
            console.error('Response generator error:', e);
          }
        }
      }
      if (!text) {
        text = this._randomChoice(this.fallbackResponses);
        confidence = 0.3;
      }
      text = this._applyPersonality(text, personality);
      if (intent === 'question') {
        actions.push({ type: 'search', query: input });
      } else if (intent === 'command') {
        actions.push({ type: 'execute', command: input });
      }
      return { text, emotion, actions, confidence };
    }

    _applyPersonality(text, personality) {
      let result = text;
      if (personality?.formality > 0.7) {
        result = result.replace(/~|呀|呢|啦|哈/g, '');
      }
      if (personality?.humor > 0.7 && Math.random() < 0.3) {
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
      this.maxContextAge = 10 * 60 * 1000;
      this.maxContextItems = 50;
      this.contextExtractors = new Map();
      this._initDefaultExtractors();
    }

    _initDefaultExtractors() {
      this.contextExtractors.set('topic', (message) => {
        const topics = ['工作', '学习', '生活', '情感', '健康', '技术', '娱乐', '美食', '旅游', '购物'];
        for (const topic of topics) {
          if (message.content.includes(topic)) {
            return topic;
          }
        }
        return null;
      });
      this.contextExtractors.set('emotion', (message) => {
        return message.sentiment?.label || null;
      });
      this.contextExtractors.set('intent', (message) => {
        return message.intent || null;
      });
    }

    update(session, message) {
      if (!session.context) session.context = new Map();
      for (const [key, extractor] of this.contextExtractors) {
        const value = extractor(message);
        if (value) {
          session.context.set(key, {
            value,
            timestamp: Date.now(),
            source: message.role
          });
        }
      }
      session.context.set('lastMessage', {
        value: message.content,
        timestamp: Date.now(),
        source: message.role
      });
      if (message.entities && message.entities.length > 0) {
        for (const entity of message.entities) {
          session.context.set(`entity_${entity.type}`, {
            value: entity.value,
            timestamp: Date.now(),
            source: message.role
          });
        }
      }
      this._cleanup(session);
    }

    _cleanup(session) {
      const now = Date.now();
      for (const [key, value] of session.context) {
        if (now - value.timestamp > this.maxContextAge) {
          session.context.delete(key);
        }
      }
      if (session.context.size > this.maxContextItems) {
        const entries = Array.from(session.context.entries()).sort((a, b) => b[1].timestamp - a[1].timestamp);
        session.context = new Map(entries.slice(0, this.maxContextItems));
      }
    }

    get(session, key) {
      const item = session.context?.get(key);
      return item ? item.value : null;
    }

    set(session, key, value, source = 'external') {
      if (!session.context) session.context = new Map();
      session.context.set(key, {
        value,
        timestamp: Date.now(),
        source
      });
    }

    remove(session, key) {
      session.context?.delete(key);
    }

    clear(session) {
      if (session.context) session.context.clear();
    }

    getAll(session) {
      if (!session.context) return {};
      const result = {};
      for (const [key, value] of session.context) {
        result[key] = value.value;
      }
      return result;
    }

    getRecent(session, count = 10) {
      if (!session.context) return [];
      return Array.from(session.context.entries())
        .sort((a, b) => b[1].timestamp - a[1].timestamp)
        .slice(0, count)
        .map(([key, value]) => ({ key, value: value.value, timestamp: value.timestamp, source: value.source }));
    }

    addExtractor(name, extractor) {
      this.contextExtractors.set(name, extractor);
    }

    removeExtractor(name) {
      this.contextExtractors.delete(name);
    }

    getExtractorNames() {
      return Array.from(this.contextExtractors.keys());
    }

    setMaxContextAge(age) {
      this.maxContextAge = age;
    }

    setMaxContextItems(count) {
      this.maxContextItems = count;
    }

    clear() {
      this.contextExtractors.clear();
      this._initDefaultExtractors();
    }
  }

  return {
    DialogueManager, IntentClassifier, ResponseSelector, ContextManager
  };
})();

if (typeof window !== 'undefined') window.SpiritInteractionV5 = SpiritInteractionV5;
if (typeof globalThis !== 'undefined') globalThis.SpiritInteractionV5 = SpiritInteractionV5;
