/* =================================================================
   core/demo-feed.js —— 离线时的演示数据源（可选模块）
   桥接没起来时，按内核的真实输出节奏造帧，让页面不至于一片黑。
   只要连上 8765 就会自动停，不会和真实数据抢屏。
   整段删掉不会影响其它模块（此文件是唯一引用点）。
   ================================================================= */

(function (A) {
  "use strict";

  const COLS = 80;
  const TICK_MS = 220;

  let running = false;
  let timer = null;
  let col = 0;

  function emitBootLine() {
    const line = "[aevum] kernel offline demo";
    const cells = [];
    for (let i = 0; i < line.length; i++) {
      cells.push([0, i, line.charCodeAt(i), 0x07]);
    }
    A.bus.emit("frame", { type: "frame", cells: cells, demo: true });
  }

  function tick() {
    const cells = [];
    const prevCol = (col + COLS - 1) % COLS;

    cells.push([12, prevCol, 0x20, 0x07]);
    cells.push([12, col, 0x2d, 0x0f]);

    const label = "col=";
    for (let i = 0; i < label.length; i++) {
      cells.push([13, i, label.charCodeAt(i), 0x07]);
    }
    cells.push([13, 4, 0x30 + Math.floor(col / 10), 0x07]);
    cells.push([13, 5, 0x30 + (col % 10), 0x07]);

    col = (col + 1) % COLS;
    A.bus.emit("frame", { type: "frame", cells: cells, demo: true });
  }

  function start() {
    if (running) return;
    running = true;
    col = 0;
    emitBootLine();
    timer = setInterval(tick, TICK_MS);
    A.bus.emit("demo:state", { on: true });
  }

  function stop() {
    if (!running) return;
    running = false;
    clearInterval(timer);
    timer = null;
    A.bus.emit("demo:state", { on: false });
  }

  A.bus.on("link:state", function (payload) {
    if (payload.state === "online") stop();
    else if (payload.state === "offline") start();
  });

  A.demoFeed = {
    start: start,
    stop: stop,
    get running() {
      return running;
    },
  };
})(window.AEVUM);
