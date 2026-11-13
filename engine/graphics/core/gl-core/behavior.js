
// ============================================================
// 模块六：行为树与情绪系统 BehaviorAI (约1000行)
// 行为树框架 / 情绪系统 / 决策系统
// ============================================================

const OrbBehavior = (function(){
  const { clamp, lerp, EPSILON } = OrbMath;

  // 行为树节点状态
  const NodeStatus = {
    SUCCESS: 'success',
    FAILURE: 'failure',
    RUNNING: 'running'
  };

  // ============================================================
  // BehaviorNode - 行为树节点基类
  // ============================================================
  class BehaviorNode {
    constructor(name = ''){
      this.name = name;
      this.parent = null;
      this.children = [];
      this.status = null;
      this.enabled = true;
      this.userData = {};
    }

    addChild(child){
      child.parent = this;
      this.children.push(child);
      return child;
    }

    removeChild(child){
      const idx = this.children.indexOf(child);
      if(idx >= 0){
        this.children.splice(idx, 1);
        child.parent = null;
      }
    }

    tick(context, dt){
      if(!this.enabled) return NodeStatus.FAILURE;
      this.status = this.update(context, dt);
      return this.status;
    }

    update(context, dt){
      return NodeStatus.SUCCESS;
    }

    reset(){
      this.status = null;
      for(const child of this.children){
        child.reset();
      }
    }

    abort(){
      this.status = null;
      for(const child of this.children){
        child.abort();
      }
    }
  }

  // ============================================================
  // Composite - 组合节点基类
  // ============================================================
  class Composite extends BehaviorNode {
    constructor(name = ''){
      super(name);
      this.currentChildIndex = 0;
    }

    reset(){
      super.reset();
      this.currentChildIndex = 0;
    }
  }

  // Selector - 选择器（或）：只要有一个子节点成功，就成功
  class Selector extends Composite {
    constructor(name = 'Selector'){
      super(name);
    }

    update(context, dt){
      for(let i = this.currentChildIndex; i < this.children.length; i++){
        const status = this.children[i].tick(context, dt);
        if(status === NodeStatus.SUCCESS){
          this.currentChildIndex = 0;
          return NodeStatus.SUCCESS;
        }
        if(status === NodeStatus.RUNNING){
          this.currentChildIndex = i;
          return NodeStatus.RUNNING;
        }
      }
      this.currentChildIndex = 0;
      return NodeStatus.FAILURE;
    }
  }

  // Sequence - 序列（与）：所有子节点都成功才成功
  class Sequence extends Composite {
    constructor(name = 'Sequence'){
      super(name);
    }

    update(context, dt){
      for(let i = this.currentChildIndex; i < this.children.length; i++){
        const status = this.children[i].tick(context, dt);
        if(status === NodeStatus.FAILURE){
          this.currentChildIndex = 0;
          return NodeStatus.FAILURE;
        }
        if(status === NodeStatus.RUNNING){
          this.currentChildIndex = i;
          return NodeStatus.RUNNING;
        }
      }
      this.currentChildIndex = 0;
      return NodeStatus.SUCCESS;
    }
  }

  // Parallel - 并行节点：同时执行所有子节点
  class Parallel extends Composite {
    constructor(name = 'Parallel', successPolicy = 'all', failurePolicy = 'one'){
      super(name);
      this.successPolicy = successPolicy; // 'all' | 'one'
      this.failurePolicy = failurePolicy; // 'all' | 'one'
      this.runningChildren = new Set();
    }

    update(context, dt){
      let successCount = 0;
      let failureCount = 0;

      for(let i = 0; i < this.children.length; i++){
        if(this.runningChildren.has(i) || !this.children[i].status){
          const status = this.children[i].tick(context, dt);
          if(status === NodeStatus.SUCCESS){
            successCount++;
            this.runningChildren.delete(i);
          } else if(status === NodeStatus.FAILURE){
            failureCount++;
            this.runningChildren.delete(i);
          } else {
            this.runningChildren.add(i);
          }
        }
      }

      if(this.failurePolicy === 'one' && failureCount > 0){
        this.abort();
        return NodeStatus.FAILURE;
      }
      if(this.successPolicy === 'one' && successCount > 0){
        this.abort();
        return NodeStatus.SUCCESS;
      }
      if(this.failurePolicy === 'all' && failureCount === this.children.length){
        return NodeStatus.FAILURE;
      }
      if(this.successPolicy === 'all' && successCount === this.children.length){
        return NodeStatus.SUCCESS;
      }

      return NodeStatus.RUNNING;
    }

    reset(){
      super.reset();
      this.runningChildren.clear();
    }

    abort(){
      super.abort();
      this.runningChildren.clear();
    }
  }

  // ============================================================
  // Decorator - 装饰器基类
  // ============================================================
  class Decorator extends BehaviorNode {
    constructor(name = '', child = null){
      super(name);
      if(child) this.addChild(child);
    }

    addChild(child){
      if(this.children.length > 0) this.children[0] = child;
      else super.addChild(child);
      return child;
    }

    update(context, dt){
      if(this.children.length === 0) return NodeStatus.FAILURE;
      return this.children[0].tick(context, dt);
    }
  }

  // Inverter - 反转器：成功变失败，失败变成功
  class Inverter extends Decorator {
    constructor(child = null){
      super('Inverter', child);
    }

    update(context, dt){
      const status = super.update(context, dt);
      if(status === NodeStatus.SUCCESS) return NodeStatus.FAILURE;
      if(status === NodeStatus.FAILURE) return NodeStatus.SUCCESS;
      return status;
    }
  }

  // Repeater - 重复器：重复执行子节点
  class Repeater extends Decorator {
    constructor(child = null, count = -1){
      super('Repeater', child);
      this.count = count; // -1 表示无限重复
      this.currentCount = 0;
    }

    update(context, dt){
      if(this.children.length === 0) return NodeStatus.FAILURE;

      const status = this.children[0].tick(context, dt);

      if(status === NodeStatus.RUNNING) return NodeStatus.RUNNING;

      this.currentCount++;
      if(this.count < 0 || this.currentCount < this.count){
        this.children[0].reset();
        return NodeStatus.RUNNING;
      }

      this.currentCount = 0;
      return NodeStatus.SUCCESS;
    }

    reset(){
      super.reset();
      this.currentCount = 0;
    }
  }

  // RepeatUntilFailure - 重复直到失败
  class RepeatUntilFailure extends Decorator {
    constructor(child = null){
      super('RepeatUntilFailure', child);
    }

    update(context, dt){
      if(this.children.length === 0) return NodeStatus.FAILURE;
      const status = this.children[0].tick(context, dt);
      if(status === NodeStatus.FAILURE) return NodeStatus.SUCCESS;
      this.children[0].reset();
      return NodeStatus.RUNNING;
    }
  }

  // TimeLimit - 时间限制：子节点在指定时间内必须完成
  class TimeLimit extends Decorator {
    constructor(child = null, time = 1){
      super('TimeLimit', child);
      this.time = time;
      this.elapsed = 0;
    }

    update(context, dt){
      if(this.children.length === 0) return NodeStatus.FAILURE;

      this.elapsed += dt;
      if(this.elapsed >= this.time){
        this.children[0].abort();
        this.elapsed = 0;
        return NodeStatus.FAILURE;
      }

      const status = this.children[0].tick(context, dt);
      if(status !== NodeStatus.RUNNING){
        this.elapsed = 0;
      }
      return status;
    }

    reset(){
      super.reset();
      this.elapsed = 0;
    }
  }

  // Cooldown - 冷却：在指定时间后才能再次执行
  class Cooldown extends Decorator {
    constructor(child = null, cooldown = 1){
      super('Cooldown', child);
      this.cooldown = cooldown;
      this.lastExecution = -Infinity;
    }

    update(context, dt){
      const now = context.time || Date.now() / 1000;
      if(now - this.lastExecution < this.cooldown){
        return NodeStatus.FAILURE;
      }

      const status = super.update(context, dt);
      if(status === NodeStatus.SUCCESS || status === NodeStatus.FAILURE){
        this.lastExecution = now;
      }
      return status;
    }
  }

  // ============================================================
  // Leaf - 叶子节点基类
  // ============================================================
  class Leaf extends BehaviorNode {
    constructor(name = ''){
      super(name);
    }
  }

  // Action - 动作节点
  class Action extends Leaf {
    constructor(name = '', action = null){
      super(name);
      this.action = action;
      this.startTime = 0;
    }

    update(context, dt){
      if(!this.action) return NodeStatus.FAILURE;
      return this.action(context, dt, this);
    }

    reset(){
      super.reset();
      this.startTime = 0;
    }
  }

  // Condition - 条件节点
  class Condition extends Leaf {
    constructor(name = '', condition = null){
      super(name);
      this.condition = condition;
    }

    update(context, dt){
      if(!this.condition) return NodeStatus.FAILURE;
      return this.condition(context, dt) ? NodeStatus.SUCCESS : NodeStatus.FAILURE;
    }
  }

  // Wait - 等待节点
  class Wait extends Leaf {
    constructor(name = 'Wait', duration = 1){
      super(name);
      this.duration = duration;
      this.elapsed = 0;
    }

    update(context, dt){
      this.elapsed += dt;
      if(this.elapsed >= this.duration){
        this.elapsed = 0;
        return NodeStatus.SUCCESS;
      }
      return NodeStatus.RUNNING;
    }

    reset(){
      super.reset();
      this.elapsed = 0;
    }
  }

  // ============================================================
  // BehaviorTree - 行为树
  // ============================================================
  class BehaviorTree {
    constructor(root = null){
      this.root = root;
      this.context = {};
      this.enabled = true;
      this.time = 0;
    }

    setRoot(root){
      this.root = root;
    }

    tick(dt){
      if(!this.enabled || !this.root) return NodeStatus.FAILURE;
      this.time += dt;
      this.context.time = this.time;
      this.context.dt = dt;
      return this.root.tick(this.context, dt);
    }

    reset(){
      if(this.root) this.root.reset();
      this.time = 0;
    }
  }

  // ============================================================
  // EmotionSystem - 情绪系统
  // ============================================================
  class EmotionSystem {
    constructor(){
      this.emotions = {
        happy: 0,
        sad: 0,
        angry: 0,
        fear: 0,
        surprise: 0,
        disgust: 0,
        neutral: 1
      };

      this.decayRate = 0.1; // 每秒衰减率
      this.threshold = 0.3; // 情绪触发阈值
      this.currentMood = 'neutral';
      this.moodIntensity = 0;
      this.enabled = true;

      this.onEmotionChange = null;
      this.onMoodChange = null;

      this._history = [];
      this._maxHistory = 100;
    }

    setEmotion(name, value){
      if(this.emotions[name] === undefined) return;
      const oldValue = this.emotions[name];
      this.emotions[name] = clamp(value, 0, 1);

      if(this.onEmotionChange && Math.abs(oldValue - this.emotions[name]) > 0.01){
        this.onEmotionChange(name, this.emotions[name], oldValue);
      }

      this._updateMood();
      this._recordHistory(name, this.emotions[name]);
    }

    addEmotion(name, value){
      if(this.emotions[name] === undefined) return;
      this.setEmotion(name, this.emotions[name] + value);
    }

    getEmotion(name){
      return this.emotions[name] || 0;
    }

    update(dt){
      if(!this.enabled) return;

      // 情绪衰减
      for(const name in this.emotions){
        if(name === 'neutral') continue;
        if(this.emotions[name] > 0){
          this.emotions[name] = Math.max(0, this.emotions[name] - this.decayRate * dt);
        }
      }

      // 中性情绪 = 1 - 其他情绪总和
      let otherSum = 0;
      for(const name in this.emotions){
        if(name !== 'neutral') otherSum += this.emotions[name];
      }
      this.emotions.neutral = Math.max(0, 1 - otherSum);

      this._updateMood();
    }

    _updateMood(){
      let maxEmotion = 'neutral';
      let maxValue = this.emotions.neutral;

      for(const name in this.emotions){
        if(this.emotions[name] > maxValue){
          maxValue = this.emotions[name];
          maxEmotion = name;
        }
      }

      if(maxValue >= this.threshold && maxEmotion !== this.currentMood){
        const oldMood = this.currentMood;
        this.currentMood = maxEmotion;
        this.moodIntensity = maxValue;
        if(this.onMoodChange){
          this.onMoodChange(maxEmotion, maxValue, oldMood);
        }
      } else if(maxEmotion === this.currentMood){
        this.moodIntensity = maxValue;
      }
    }

    _recordHistory(name, value){
      this._history.push({name, value, time: Date.now()});
      if(this._history.length > this._maxHistory){
        this._history.shift();
      }
    }

    getDominantEmotion(){
      return this.currentMood;
    }

    getMoodIntensity(){
      return this.moodIntensity;
    }

    getEmotionState(){
      return {...this.emotions};
    }

    reset(){
      for(const name in this.emotions){
        this.emotions[name] = name === 'neutral' ? 1 : 0;
      }
      this.currentMood = 'neutral';
      this.moodIntensity = 0;
      this._history = [];
    }
  }

  // ============================================================
  // DecisionSystem - 决策系统（基于效用的决策）
  // ============================================================
  class DecisionSystem {
    constructor(){
      this.actions = [];
      this.currentAction = null;
      this.enabled = true;
      this.decisionInterval = 0.5; // 决策间隔
      this.elapsed = 0;
      this.context = {};
    }

    addAction(action){
      this.actions.push(action);
      return action;
    }

    removeAction(action){
      const idx = this.actions.indexOf(action);
      if(idx >= 0) this.actions.splice(idx, 1);
    }

    update(dt){
      if(!this.enabled) return;

      this.elapsed += dt;
      if(this.elapsed < this.decisionInterval) return;
      this.elapsed = 0;

      // 计算每个动作的效用
      let bestAction = null;
      let bestUtility = -Infinity;

      for(const action of this.actions){
        if(!action.enabled) continue;
        const utility = action.evaluate(this.context);
        if(utility > bestUtility){
          bestUtility = utility;
          bestAction = action;
        }
      }

      // 执行最佳动作
      if(bestAction && bestAction !== this.currentAction){
        if(this.currentAction && this.currentAction.onExit){
          this.currentAction.onExit(this.context);
        }
        this.currentAction = bestAction;
        if(this.currentAction.onEnter){
          this.currentAction.onEnter(this.context);
        }
      }

      if(this.currentAction && this.currentAction.onUpdate){
        this.currentAction.onUpdate(this.context, dt);
      }
    }

    setContext(key, value){
      this.context[key] = value;
    }

    getContext(key){
      return this.context[key];
    }

    reset(){
      if(this.currentAction && this.currentAction.onExit){
        this.currentAction.onExit(this.context);
      }
      this.currentAction = null;
      this.elapsed = 0;
    }
  }

  // 决策动作
  class DecisionAction {
    constructor(name = ''){
      this.name = name;
      this.enabled = true;
      this.userData = {};
    }

    evaluate(context){
      return 0;
    }

    onEnter(context){}
    onUpdate(context, dt){}
    onExit(context){}
  }

  // 导出
  return {
    NodeStatus, BehaviorNode, Composite, Selector, Sequence, Parallel,
    Decorator, Inverter, Repeater, RepeatUntilFailure, TimeLimit, Cooldown,
    Leaf, Action, Condition, Wait, BehaviorTree,
    EmotionSystem, DecisionSystem, DecisionAction
  };
})();

if(typeof window !== 'undefined'){
  window.OrbBehavior = OrbBehavior;
}