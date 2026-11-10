/* Kernel panel: owns the bridge WebSocket lifecycle and feeds delta cells
   into the reusable terminal surface. */
(function (global) {
  "use strict";
  var MD = global.MD;
  MD.panels = MD.panels || {};

  MD.panels.kernel = function () {
    var root = document.createElement("div");
    root.className = "pad";
    root.innerHTML =
      '<div class="kernel-bar"><span class="led" data-field="k-led" data-state="offline"></span><strong data-field="k-state">未连接</strong>' +
      '<span class="small" data-field="k-url"></span>' +
      '<span class="small">帧 <b data-field="k-frames">0</b> · 格 <b data-field="k-cells">0</b></span>' +
      '<button class="tbtn" type="button" data-field="k-reconnect">重连</button></div>' +
      '<div class="kernel-stage"><canvas id="vga" data-field="vga" width="960" height="400"></canvas></div>' +
      '<p class="small" style="margin-top:10px">串口桥接把 QEMU 的 80×25 文本帧推到 WebSocket。没有帧时画布保持空白，不填充演示数据。</p>';

    function q(name) { return root.querySelector('[data-field="' + name + '"]'); }
    var socket = null;
    var retry = null;
    var terminal = null;
    var alive = false;
    var frames = 0;
    var cells = 0;

    function status(name, detail) {
      var label = { connecting: "连接中", online: "已连接", offline: "未连接" }[name] || name;
      var text = q("k-state");
      if (text) text.textContent = label + (detail ? " · " + detail : "");
      var led = q("k-led");
      if (led) led.dataset.state = name;
      MD.bus.emit("kernel", { state: name, frames: frames, cells: cells });
    }

    function connect() {
      if (!alive) return;
      if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
      status("connecting");
      try {
        socket = new WebSocket(MD.config.bridgeUrl);
      } catch (err) {
        status("offline", err.message);
        schedule();
        return;
      }
      socket.onopen = function () {
        status("online");
        var url = q("k-url");
        if (url) url.textContent = MD.config.bridgeUrl;
      };
      socket.onmessage = function (event) {
        var msg;
        try { msg = JSON.parse(event.data); } catch (err) { return; }
        if (!msg || msg.type !== "frame" || !Array.isArray(msg.cells)) return;
        var applied = terminal ? terminal.apply(msg.cells) : 0;
        if (!applied) return;
        frames += 1;
        cells += applied;
        var f = q("k-frames");
        var c = q("k-cells");
        if (f) f.textContent = MD.nf(frames, 0);
        if (c) c.textContent = MD.nf(cells, 0);
        MD.bus.emit("kernel", { state: "online", frames: frames, cells: cells });
      };
      socket.onerror = function () { /* close handles retry */ };
      socket.onclose = function () {
        socket = null;
        status("offline");
        schedule();
      };
    }

    function schedule() {
      clearTimeout(retry);
      retry = setTimeout(function () { if (alive) connect(); }, 2000);
    }

    function disconnect() {
      alive = false;
      clearTimeout(retry);
      if (socket) {
        try { socket.close(); } catch (err) { /* already closed */ }
        socket = null;
      }
    }

    root.querySelector('[data-field="k-reconnect"]').addEventListener("click", function () {
      disconnect();
      alive = true;
      connect();
    });

    return {
      element: root,
      mount: function () {
        if (alive) return;
        alive = true;
        var canvas = q("vga");
        terminal = MD.components.terminal(canvas);
        terminal.paint();
        var url = q("k-url");
        if (url) url.textContent = MD.config.bridgeUrl;
        connect();
      },
      destroy: disconnect
    };
  };
})(window);
