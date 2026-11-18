/* Error desk panel: real log lines plus the relay contract code table.
   When no line matches, the list stays empty rather than showing examples. */
(function (global) {
  "use strict";
  var MD = global.MD;
  MD.panels = MD.panels || {};

  MD.panels.errors = function () {
    var root = document.createElement("div");
    root.className = "pad";
    root.innerHTML =
      '<div class="eyebrow">ERROR DESK / 0xRRFFTT</div>' +
      '<h1 class="h1" style="font-size:19px">错误看板</h1>' +
      '<p class="lead">左列是日志里真实出现的错误行；下面是从 command/relay/contracts/errors.json 读出的码表。没有错误时保持空，不塞示例。</p>' +
      '<div class="toolbar" style="margin-top:12px"><span class="tag tag--red" data-field="e-count">0 条</span><span class="small">trainer logs + relay contract</span><button class="tbtn" type="button" data-field="e-refresh">刷新</button></div>' +
      '<ul class="errors-list" data-field="e-list"></ul>' +
      '<div class="code-table"><div class="code-table__head"><span>错误码表</span><span data-field="e-table-count">—</span></div><div class="code-table__body" data-field="e-table"></div></div>';

    var timer = null;
    function q(name) { return root.querySelector('[data-field="' + name + '"]'); }

    function refresh() {
      MD.api.errors().then(function (data) {
        render(data.errors || [], data.known || {});
      }).catch(function (err) {
        var list = q("e-list");
        if (list) list.innerHTML = '<li class="empty">监控服务未连：' + MD.escapeText(err.message) + "</li>";
        MD.bus.emit("errors", { errors: [] });
      });
    }

    function render(errors, known) {
      var list = q("e-list");
      var table = q("e-table");
      if (!list || !table) return;
      q("e-count").textContent = errors.length + " 条";
      list.innerHTML = "";
      if (!errors.length) {
        list.innerHTML = '<li class="empty">当前 trainer.stdout / trainer.stderr 里没有匹配 error、failed、exception 或 0x 的行。没有错误就不填示例。</li>';
      } else {
        errors.slice(-30).reverse().forEach(function (row) {
          var li = document.createElement("li");
          li.className = "err-row";
          var codes = (row.codes || []).map(function (c) {
            return '<span class="err-row__code">' + MD.escapeText(c) + "</span>";
          }).join(" ");
          var knownText = (row.known || []).map(function (item) {
            return item && item.name ? MD.escapeText(item.name + " · " + item.message) : "";
          }).filter(Boolean).join(" / ");
          li.innerHTML = '<div class="err-row__top">' + (codes || '<span class="err-row__code">LOG</span>') +
            '<span class="err-row__src">' + MD.escapeText(row.source || "log") + "</span></div>" +
            '<p class="err-row__line">' + MD.escapeText(row.line || "") + "</p>" +
            (knownText ? '<p class="err-row__known">' + knownText + "</p>" : "");
          list.appendChild(li);
        });
      }

      var keys = Object.keys(known);
      q("e-table-count").textContent = keys.length + " 个码";
      table.innerHTML = "";
      keys.sort().forEach(function (code) {
        var item = known[code] || {};
        var row = document.createElement("div");
        row.className = "code-row";
        row.innerHTML = "<code>" + MD.escapeText(item.code || code) + "</code><span>" + MD.escapeText((item.name || "") + " · " + (item.message || "")) + "</span>";
        table.appendChild(row);
      });
      if (!keys.length) table.innerHTML = '<div class="empty">错误码表没有读到：command/relay/contracts/errors.json。</div>';
      MD.bus.emit("errors", { errors: errors, known: known });
    }

    root.querySelector('[data-field="e-refresh"]').addEventListener("click", refresh);

    return {
      element: root,
      mount: function () {
        refresh();
        if (!timer) timer = setInterval(refresh, 5000);
      },
      destroy: function () {
        clearInterval(timer);
        timer = null;
      }
    };
  };
})(window);
