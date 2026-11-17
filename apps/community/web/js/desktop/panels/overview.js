/* Overview panel: the small dashboard of the whole desk. It subscribes to
   bus events, so each source panel stays independent. */
(function (global) {
  "use strict";
  var MD = global.MD;
  MD.panels = MD.panels || {};

  MD.panels.overview = function (ctx) {
    var root = document.createElement("div");
    root.className = "pad";
    root.innerHTML =
      '<div class="eyebrow">AEVUM / MEMORIA</div>' +
      '<h1 class="h1">一个桌面，<span>不只一个页面</span></h1>' +
      '<p class="lead">左边是启动项，中间可以同时开多个窗口。内核串口、AI 训练、模型加载、中继房间和错误码各占一个窗口；原来的展示长页没有删，已经改成「展示页」启动项。</p>' +
      '<div class="rule"></div>' +
      '<div class="eyebrow">桌面操作</div>' +
      '<p class="lead">窗口先渲染，3D 场景和角色模型随后加载，避免功能等模型。拖标题栏移动，拖右下角缩放，双击标题栏最大化；左侧启动项、底部 Dock 和启动台都能重新打开窗口。灵体单击不打开任何窗口；双击灵体打开命令面板，右键打开环形菜单，中键看 Exposé，滚轮切窗，长按进语音。</p>' +
      '<p class="small">MrHua 是桌面里的程序入口，订阅是桌面原生窗口；两套手册分开，MrHua 的内部说明留在 MrHua 里。这里只写桌面本身怎么用，不放按钮，也不做第二个启动项。</p>' +
      '<div class="rule"></div>' +
      '<div class="eyebrow">社区角色文化</div>' +
      '<p class="lead">角色是社区里的职责和权限，不是 AI 模型，也不是可以购买或上传的角色皮肤。注册用户和访客各自拥有隔离数据作用域；角色不会自动获得平台管理权。访客可以先看公开概览、进入公共广域网、用 AI 对话和发送文本；文件、投票和治理写操作仍要登录或相应角色。</p>' +
      '<p class="small">访客：可查看公开概览、进入公共广域网、和 AI 对话、发送文本；不能上传文件、投票或管理社区。成员：已注册并激活，拥有自己的隔离数据目录，可保存对话、使用文件与回路订阅。贡献者：持续参与代码、文档或社区内容，可对提案投票。审核员：审核内容和标记违规，没有封禁、改角色权。维护者：维护具体项目或模块，可审核合并、发布候选版本。版主：删除消息、置顶话题、踢人、警告。仲裁者：处理申诉和争议，可否决不当提案。管理员：分配角色、封禁用户、管理房间、发布版本，不能修改治理规则。所有者：平台创建者，最高决策权，可修改治理规则和发起分叉。禁言：因违规被限制发言，可查看但不能发送，到期恢复。</p>' +
      '<div class="rule"></div>' +
      '<div class="cards">' +
        '<button class="card" type="button" data-open="kernel"><div class="card__top"><span class="card__title">内核实况</span><span class="card__state" data-field="ov-kernel">等待</span></div><div class="card__num" data-field="ov-frames">—</div><p class="card__desc">80×25 格子，串口帧直接画到 canvas。连不上桥接时显示未连接，不假装有帧。</p></button>' +
        '<button class="card" type="button" data-open="trainer"><div class="card__top"><span class="card__title">训练监控</span><span class="card__state" data-field="ov-trainer">等待</span></div><div class="card__num" data-field="ov-loss">—<small>loss</small></div><p class="card__desc">读 JSONL 指标：step、epoch、loss、eval、device 与参数。没有数据就显示等待，不编造曲线。</p></button>' +
        '<button class="card" type="button" data-open="model"><div class="card__top"><span class="card__title">模型对话</span><span class="card__state" data-field="ov-model">待加载</span></div><div class="card__num" data-field="ov-checkpoints">—<small>检查点</small></div><p class="card__desc">选择 build/ 下的检查点，调用 memoria_gen_cpu.exe 加载并生成。权重不进开源目录。</p></button>' +
        '<button class="card" type="button" data-open="relay"><div class="card__top"><span class="card__title">中继交流</span><span class="card__state" data-field="ov-relay">未连接</span></div><div class="card__num" data-field="ov-online">—<small>在线</small></div><p class="card__desc">纯内存房间：进房心跳、上下文轮询、发帖。错误原样显示 0xRRFFTT。</p></button>' +
        '<button class="card" type="button" data-open="errors"><div class="card__top"><span class="card__title">错误看板</span><span class="card__state" data-field="ov-errors">0</span></div><div class="card__num" data-field="ov-errnum">—</div><p class="card__desc">把训练器 stderr、stdout 与 0xRRFFTT 码表并排；只看日志里真实出现的错误。</p></button>' +
        '<button class="card" type="button" data-open="exhibit"><div class="card__top"><span class="card__title">展示页</span><span class="card__state">长页</span></div><div class="card__num">AEVUM<small>project</small></div><p class="card__desc">原项目介绍页保留为独立启动项；项目说明、阶段与参与方式在那边，不复制成看板。</p></button>' +
      '</div>' +
      '<div class="rule"></div>' +
      '<div class="eyebrow">窗口插槽 / 留给别人</div>' +
      '<div class="slots" data-field="overview-slots"></div>' +
      '<p class="small">每个插槽都是一个可打开的窗口。名字和地址保存在本机；地址不合法会当场拒绝。</p>';

    var offs = [];
    function q(name) { return root.querySelector('[data-field="' + name + '"]'); }
    function set(name, text) { var node = q(name); if (node) node.textContent = text; }
    function setHTML(name, html) { var node = q(name); if (node) node.innerHTML = html; }

    function renderSlots() {
      var slots = q("overview-slots");
      if (!slots) return;
      slots.innerHTML = "";
      var custom = MD.listApps().filter(function (app) { return app.custom; });
      var count = Math.max(3, custom.length + 1);
      for (var i = 0; i < count; i += 1) {
        var app = custom[i];
        if (app) {
          slots.innerHTML += '<button class="slot" type="button" data-open="' + MD.escapeAttr(app.id) + '"><span class="slot__no">SLOT ' + (i + 1) + '</span><span class="slot__title">' + MD.escapeText(app.title) + '</span><span class="slot__desc">' + MD.escapeText(app.url) + '</span><span class="slot__x" data-remove-custom="' + MD.escapeAttr(app.id) + '" title="移除">×</span></button>';
        } else {
          slots.innerHTML += '<button class="slot" type="button" data-add="1"><span class="slot__no">SLOT ' + (i + 1) + '</span><span class="slot__title">空插槽</span><span class="slot__desc">点击新增一个窗口</span></button>';
        }
      }
    }

    root.addEventListener("click", function (event) {
      var remove = event.target.closest("[data-remove-custom]");
      if (remove) {
        event.stopPropagation();
        ctx.removeCustom(remove.dataset.removeCustom);
        return;
      }
      var add = event.target.closest("[data-add]");
      if (add) { ctx.openAdd(); return; }
      var open = event.target.closest("[data-open]");
      if (open) ctx.openWindow(open.dataset.open);
    });

    var offApps = MD.bus.on("apps", renderSlots);
    var offHealth = MD.bus.on("health", function (data) {
      var services = data.services || {};
      if (services.bridge) set("ov-kernel", services.bridge.ok ? "已连接" : "未连接");
      if (services.relay) set("ov-relay", services.relay.ok ? "在线" : "未连接");
    });
    var offKernel = MD.bus.on("kernel", function (data) {
      set("ov-frames", MD.nf(data.frames, 0) + " 帧");
      set("ov-kernel", data.state === "online" ? "已连接" : "未连接");
    });
    var offTrainer = MD.bus.on("trainer", function (data) {
      var latest = data.latest || {};
      var stateLabel = data.running ? "训练中" : (data.done ? "已完成" : (data.available ? "已停止" : "等待指标"));
      set("ov-trainer", stateLabel);
      setHTML("ov-loss", (latest.loss !== undefined ? Number(latest.loss).toFixed(3) : "—") + "<small>loss</small>");
    });
    var offRelay = MD.bus.on("relay", function (data) {
      set("ov-relay", data.ok ? "在线" : "未连接");
      if (data.online !== undefined) setHTML("ov-online", data.online + "<small>在线</small>");
    });
    var offErrors = MD.bus.on("errors", function (data) {
      set("ov-errors", String((data.errors || []).length));
      set("ov-errnum", String((data.errors || []).length));
    });
    var offModel = MD.bus.on("model", function (data) {
      set("ov-model", data.ok ? "已生成" : "失败");
    });

    renderSlots();

    return {
      element: root,
      mount: function () {
        offs = [offApps, offHealth, offKernel, offTrainer, offRelay, offErrors, offModel];
      },
      destroy: function () {
        offs.forEach(function (off) { off(); });
      }
    };
  };
})(window);
