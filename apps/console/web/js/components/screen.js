/* =================================================================
   components/screen.js —— VGA 文本屏渲染（逻辑归属：本文件）
   唯一维护 screen 缓冲与 canvas 的地方。
   80×25 格，每格 12×16 像素，画布 960×400。
   ================================================================= */

(function (A) {
  "use strict";

  const COLS = 80;
  const ROWS = 25;
  const CELL_W = 12;
  const CELL_H = 16;

  /* VGA 16 色调色板，下标即属性字节的低 4 位（前景）/高 4 位（背景） */
  const PAL = [
    "#000000", "#0000aa", "#00aa00", "#00aaaa",
    "#aa0000", "#aa00aa", "#aa5500", "#aaaaaa",
    "#555555", "#5555ff", "#55ff55", "#55ffff",
    "#ff5555", "#ff55ff", "#ffff55", "#ffffff",
  ];

  const canvas = document.getElementById("vga");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const screen = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) row.push({ ch: 0x20, attr: 0x07 });
    screen.push(row);
  }

  function drawCell(row, col) {
    const cell = screen[row][col];
    const fg = PAL[cell.attr & 0x0f];
    const bg = PAL[(cell.attr >> 4) & 0x0f];
    const x = col * CELL_W;
    const y = row * CELL_H;

    ctx.fillStyle = bg;
    ctx.fillRect(x, y, CELL_W, CELL_H);

    if (cell.ch >= 0x20 && cell.ch < 0x7f) {
      ctx.fillStyle = fg;
      ctx.font = "14px 'Cascadia Mono', Consolas, monospace";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      const glyph = String.fromCharCode(cell.ch);
      const width = ctx.measureText(glyph).width;
      ctx.fillText(glyph, x + (CELL_W - width) / 2, y + CELL_H / 2 + 1);
    }
  }

  function paintAll() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) drawCell(r, c);
    }
  }

  function applyCells(cells) {
    for (let i = 0; i < cells.length; i++) {
      const item = cells[i];
      const row = item[0];
      const col = item[1];
      if (row < 0 || row >= ROWS || col < 0 || col >= COLS) continue;
      screen[row][col].ch = item[2];
      screen[row][col].attr = item[3];
      drawCell(row, col);
    }
  }

  A.bus.on("frame", function (msg) {
    applyCells(msg.cells);
  });

  A.screen = {
    clear: function () {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          screen[r][c].ch = 0x20;
          screen[r][c].attr = 0x07;
        }
      }
      paintAll();
    },
    paintAll: paintAll,
  };

  paintAll();
})(window.AEVUM);
