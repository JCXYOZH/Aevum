/* Model panel: lists local checkpoints, loads one through memoria_gen.exe and
   shows the sampled continuation. The browser never touches weights; the
   monitor service spawns the executable and returns stdout. */
(function (global) {
  "use strict";
  var MD = global.MD;
  MD.panels = MD.panels || {};

  MD.panels.model = function () {
    var root = document.createElement("div");
    root.className = "pad model-panel";
    root.innerHTML =
      '<div class="eyebrow">MODEL / CHECKPOINT</div>' +
      '<h1 class="h1">加载模型，<span>然后对话</span></h1>' +
      '<p class="lead">本地检查点走生成 exe；云端模型由监控服务代理，地址和密钥留在后端 config.yaml，页面不保存、不直连。</p>' +
      '<div class="model-status">' +
        '<span class="model-chip" data-field="m-exe">检查可执行文件…</span>' +
        '<span class="model-chip" data-field="m-count">检查点 —</span>' +
        '<span class="model-chip" data-field="m-state">待加载</span>' +
      '</div>' +
      '<div class="model-form">' +
        '<label class="model-field model-field--wide"><span>检查点</span><select data-field="m-checkpoint"></select></label>' +
        '<label class="model-field"><span>语料（词表必须一致）</span><input type="text" data-field="m-data" spellcheck="false"></label>' +
        '<label class="model-field"><span>设备</span><select data-field="m-device"><option value="cpu">cpu</option><option value="cuda">cuda</option></select></label>' +
        '<label class="model-field model-field--wide"><span>提示词</span><textarea data-field="m-prompt" rows="3" spellcheck="false"></textarea></label>' +
        '<label class="model-field"><span>新 token 上限</span><input type="number" data-field="m-max" min="1" max="256" step="1"></label>' +
        '<label class="model-field"><span>温度</span><input type="number" data-field="m-temp" min="0.1" max="2" step="0.1"></label>' +
        '<div class="model-actions"><button class="tbtn tbtn--primary" type="button" data-field="m-run">加载并生成</button><span class="model-hint">Ctrl+Enter 也可以提交</span></div>' +
      '</div>' +
      '<details class="model-cloud">' +
        '<summary class="model-cloud__head"><span>云端模型 / 后端代理</span><span class="tag tag--teal">后端代理</span></summary>' +
        '<p class="model-hint">云端对话走监控服务，模型名、接口和密钥只读 config.yaml。此页只显示后端状态，不保存地址、不直接请求模型服务。</p>' +
        '<div class="model-meta" data-field="m-cloud-state">读取云端状态…</div>' +
      '</details>' +
      '<div class="model-meta" data-field="m-meta">还没有请求。</div>' +
      '<div class="model-result"><div class="model-result__head"><span>生成结果</span><span>stdout / stderr</span></div>' +
        '<pre class="model-output" data-field="m-output">还没有生成结果。选择检查点后点「加载并生成」。</pre>' +
        '<pre class="model-log" data-field="m-log"></pre>' +
      '</div>';

    function q(name) { return root.querySelector('[data-field="' + name + '"]'); }
    function set(name, text) { var node = q(name); if (node) node.textContent = text; }
    function selectedCheckpoint() {
      var node = q("m-checkpoint");
      return node && node.value ? node.value : "";
    }

    function fillDefaults(data) {
      var defaults = data.defaults || {};
      var dataNode = q("m-data");
      if (dataNode && defaults.data) dataNode.value = defaults.data;
      var promptNode = q("m-prompt");
      if (promptNode && !promptNode.value) promptNode.value = defaults.prompt || "What ";
      var maxNode = q("m-max");
      if (maxNode && defaults.max_new_tokens) maxNode.value = defaults.max_new_tokens;
      var tempNode = q("m-temp");
      if (tempNode && defaults.temperature) tempNode.value = defaults.temperature;
      var deviceNode = q("m-device");
      if (deviceNode && defaults.device) deviceNode.value = defaults.device;
    }

    function renderCheckpoints(data) {
      var select = q("m-checkpoint");
      if (!select) return;
      var items = data.checkpoints || [];
      select.innerHTML = "";
      if (!items.length) {
        select.innerHTML = '<option value="">build/ 下没有检查点</option>';
        set("m-count", "检查点 0");
        return;
      }
      items.forEach(function (item) {
        var option = document.createElement("option");
        option.value = item.path;
        option.textContent = item.name + " · " + (item.format === "memoria" ? "native" : "disguised") +
          (item.vocab_size ? " · vocab " + item.vocab_size : "");
        select.appendChild(option);
      });
      var preferred = (data.defaults || {}).checkpoint;
      if (preferred) {
        var match = items.filter(function (item) { return item.path === preferred; })[0];
        if (match) select.value = preferred;
      }
      set("m-count", "检查点 " + items.length);
    }

    function refresh() {
      MD.api.model().then(function (data) {
        var exeName = (data.exe || "memoria_gen_cpu.exe").split(/[\\/]/).pop();
        set("m-exe", exeName + (data.available ? " 已构建" : " 缺失"));
        renderCheckpoints(data);
        fillDefaults(data);
        set("m-state", data.available ? "待加载" : "需要先构建");
        var cloud = data.cloud || {};
        var mode = cloud.mode === "cloud" ? "云端" : "本地";
        var key = cloud.has_key ? "密钥已配置" : "密钥未配置";
        var tools = cloud.video_tool ? "生成工具已启用" : "生成工具未启用";
        set("m-cloud-state", mode + " · " + (cloud.model || "未配置模型") +
          (cloud.endpoint_host ? " · " + cloud.endpoint_host : "") +
          " · " + key + " · " + tools);
      }).catch(function (err) {
        set("m-exe", "监控服务不可用");
        set("m-state", "未连接");
        set("m-meta", err.message);
        set("m-cloud-state", "读不到云端状态：" + err.message);
      });
    }

    function busy(on) {
      var button = q("m-run");
      if (button) {
        button.disabled = on;
        button.textContent = on ? "生成中…" : "加载并生成";
      }
      if (on) set("m-state", "加载中");
    }

    function run() {
      var checkpoint = selectedCheckpoint();
      if (!checkpoint) {
        set("m-state", "没有检查点");
        return;
      }
      var payload = {
        checkpoint: checkpoint,
        data: q("m-data").value.trim(),
        prompt: q("m-prompt").value,
        max_new_tokens: Number(q("m-max").value || 48),
        temperature: Number(q("m-temp").value || 1),
        device: q("m-device").value
      };
      if (!payload.prompt) {
        set("m-state", "提示词为空");
        return;
      }
      busy(true);
      set("m-output", "加载检查点…");
      set("m-log", "");
      set("m-meta", "checkpoint=" + checkpoint + " · device=" + payload.device);
      MD.api.modelGenerate(payload).then(function (result) {
        busy(false);
        if (!result.ok) {
          set("m-state", "失败");
          set("m-output", result.message || result.text || "生成失败，查看日志。");
          set("m-meta", "HTTP " + (result.status || "?") + " · " + (result.duration_ms || 0) + " ms");
          MD.bus.emit("model", { ok: false, error: result.message || "generation failed" });
        } else {
          set("m-state", "已完成");
          set("m-output", result.text);
          set("m-meta", "HTTP " + (result.status || 200) + " · " + (result.duration_ms || 0) + " ms · " + result.checkpoint);
          MD.bus.emit("model", { ok: true, checkpoint: result.checkpoint, device: result.device });
        }
        set("m-log", (result.stdout || "") + (result.stderr ? "\n[stderr]\n" + result.stderr : ""));
      }).catch(function (err) {
        busy(false);
        set("m-state", "未连接");
        set("m-output", "无法连接到监控服务。");
        set("m-log", err.message);
        MD.bus.emit("model", { ok: false, error: err.message });
      });
    }

    root.addEventListener("click", function (event) {
      if (event.target.closest("[data-field='m-run']")) run();
    });
    root.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && event.target.closest("[data-field='m-prompt']")) {
        event.preventDefault();
        run();
      }
    });

    refresh();
    return { element: root };
  };
})(window);
