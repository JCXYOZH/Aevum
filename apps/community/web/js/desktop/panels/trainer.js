/* Trainer panel: polls the monitor JSONL endpoint and draws a real loss
   series. No synthetic points are generated when the file is absent. */
(function (global) {
  "use strict";
  var MD = global.MD;
  MD.panels = MD.panels || {};

  MD.panels.trainer = function () {
    var root = document.createElement("div");
    root.className = "pad";
    root.innerHTML =
      '<div class="toolbar"><span class="tag tag--amber" data-field="t-badge">等待指标</span><span class="small" data-field="t-path">build/training_metrics.jsonl</span>' +
      '<button class="tbtn" type="button" data-field="t-refresh" style="margin-left:auto">刷新</button></div>' +
      '<div class="kv" style="margin-top:12px">' +
        '<div><dt>DEVICE</dt><dd data-field="t-device">—</dd></div>' +
        '<div><dt>STEP</dt><dd data-field="t-step" class="is-big">—</dd></div>' +
        '<div><dt>TRAIN LOSS</dt><dd data-field="t-loss" class="is-big">—</dd></div>' +
        '<div><dt>EVAL LOSS</dt><dd data-field="t-eval" class="is-big">—</dd></div>' +
        '<div><dt>EPOCH</dt><dd data-field="t-epoch">—</dd></div>' +
        '<div><dt>PARAMS</dt><dd data-field="t-params">—</dd></div>' +
        '<div><dt>VOCAB</dt><dd data-field="t-vocab">—</dd></div>' +
        '<div><dt>SEQ / BATCH</dt><dd data-field="t-shape">—</dd></div>' +
      '</div>' +
      '<div class="chart-wrap"><div class="chart-head"><span>STEP LOSS · 真实 JSONL</span><b data-field="t-chart-note">0 点</b></div><canvas id="loss-chart" data-field="loss-chart"></canvas></div>' +
      '<div class="logbox"><div class="logbox__head"><span>trainer stdout</span><span data-field="t-time">—</span></div><pre data-field="t-log">等待训练日志。</pre></div>' +
      '<div class="logbox logbox--err"><div class="logbox__head"><span>trainer stderr</span><button class="tbtn" type="button" data-open="errors">查看错误看板</button></div><pre data-field="t-err">没有 stderr 行。</pre></div>' +
      '<p class="small" style="margin-top:10px">启动训练时加 --metrics 和输出重定向，监控服务就能读；不启动训练时这里只显示历史指标，不会生成假曲线。</p>';

    var timer = null;
    var chart = null;

    function q(name) { return root.querySelector('[data-field="' + name + '"]'); }
    function set(name, text) { var node = q(name); if (node) node.textContent = text; }

    function refresh() {
      MD.api.trainer().then(render).catch(function (err) {
        var badge = q("t-badge");
        if (badge) { badge.textContent = "监控服务未连"; badge.className = "tag tag--red"; }
        MD.bus.emit("trainer", { error: err.message, running: false, available: false });
      });
    }

    function render(data) {
      var latest = data.latest || {};
      var summary = data.summary || {};
      var stateLabel = data.running ? "训练中" : (data.done ? "已完成" : (data.available ? "已停止" : "等待指标"));
      var badge = q("t-badge");
      if (badge) {
        badge.textContent = stateLabel;
        badge.className = "tag " + (data.running ? "tag--amber" : (data.done ? "tag--teal" : "tag--red"));
      }
      set("t-path", data.path || "build/training_metrics.jsonl");
      set("t-device", summary.device || "—");
      set("t-step", latest.step !== undefined ? MD.nf(latest.step, 0) : "—");
      set("t-loss", latest.loss !== undefined ? Number(latest.loss).toFixed(5) : "—");
      set("t-eval", latest.eval_loss !== undefined ? Number(latest.eval_loss).toFixed(5) : (data.epochs && data.epochs.length ? Number(data.epochs[data.epochs.length - 1].eval_loss).toFixed(5) : "—"));
      set("t-epoch", latest.epoch !== undefined ? (Number(latest.epoch) + 1) + " / " + (summary.epochs_total || "—") : "—");
      set("t-params", summary.params ? MD.nf(summary.params, 0) : "—");
      set("t-vocab", summary.vocab ? MD.nf(summary.vocab, 0) : "—");
      set("t-shape", (summary.seq_length || "—") + " / " + (summary.batch || "—"));
      set("t-time", latest.time ? new Date(latest.time * 1000).toLocaleTimeString() : "—");
      set("t-log", (data.logs && data.logs.stdout) || "没有 stdout。");
      set("t-err", (data.logs && data.logs.stderr) || "没有 stderr 行。");
      set("t-chart-note", (data.points ? data.points.length : 0) + " 点");
      if (chart) chart.draw(data.points || [], data.epochs || []);
      MD.bus.emit("trainer", data);
    }

    root.querySelector('[data-field="t-refresh"]').addEventListener("click", refresh);
    root.querySelector('[data-open="errors"]').addEventListener("click", function (event) {
      event.stopPropagation();
      MD.bus.emit("request-open", "errors");
    });

    return {
      element: root,
      mount: function () {
        chart = MD.components.lineChart(q("loss-chart"));
        set("t-chart-note", window.devicePixelRatio > 1 ? "DPR " + window.devicePixelRatio : "1×");
        refresh();
        if (!timer) timer = setInterval(refresh, 3000);
      },
      destroy: function () {
        clearInterval(timer);
        timer = null;
      }
    };
  };
})(window);
