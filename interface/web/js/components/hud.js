/* =================================================================
   components/hud.js —— 状态栏与重连按钮（逻辑归属：本文件）
   帧数 / 格数计数、连接状态灯、数据来源提示。
   ================================================================= */

(function (A) {
  "use strict";

  const dot = document.getElementById("dot");
  const linkText = document.getElementById("link-text");
  const statFrames = document.getElementById("stat-frames");
  const statCells = document.getElementById("stat-cells");
  const reconnectBtn = document.getElementById("reconnect");
  const sourceHint = document.getElementById("source-hint");

  if (!dot || !linkText || !statFrames || !statCells || !reconnectBtn) return;

  const LABEL = {
    connecting: "连接中…",
    online: "已连接",
    offline: "未连接",
  };

  let frames = 0;
  let cells = 0;

  A.bus.on("frame", function (msg) {
    frames += 1;
    /* msg.cells 一旦缺失或不是数组，这个累加会直接变成 NaN 并且再也回不来，
       整块 HUD 就永久显示 NaN。所以按数组判断一次，坏帧按 0 格计。 */
    cells += Array.isArray(msg && msg.cells) ? msg.cells.length : 0;
    statFrames.textContent = frames.toLocaleString();
    statCells.textContent = cells.toLocaleString();
  });

  A.bus.on("link:state", function (payload) {
    dot.dataset.state = payload.state;
    linkText.textContent = LABEL[payload.state] || payload.state;
    reconnectBtn.disabled = payload.state === "connecting";
  });

  A.bus.on("demo:state", function (payload) {
    if (!sourceHint) return;
    sourceHint.textContent = payload.on
      ? "演示回放 · 还没连上桥接"
      : "串口帧 · " + A.ws.url;
  });

  reconnectBtn.addEventListener("click", function () {
    A.ws.reconnect();
  });
})(window.AEVUM);
