/* Reusable 80x25 VGA text surface. It knows nothing about WebSocket or QEMU;
   the kernel panel feeds it delta cells. */
(function (global) {
  "use strict";
  var MD = global.MD;

  MD.components = MD.components || {};

  MD.components.terminal = function (canvas, options) {
    options = options || {};
    var cols = options.cols || 80;
    var rows = options.rows || 25;
    var cw = options.cw || 12;
    var ch = options.ch || 16;
    var palette = options.palette || [
      "#000000", "#0000aa", "#00aa00", "#00aaaa", "#aa0000", "#aa00aa", "#aa5500", "#aaaaaa",
      "#555555", "#5555ff", "#55ff55", "#55ffff", "#ff5555", "#ff55ff", "#ffff55", "#ffffff"
    ];
    var ctx = canvas.getContext("2d");
    var screen = [];

    for (var r = 0; r < rows; r += 1) {
      var row = [];
      for (var c = 0; c < cols; c += 1) row.push({ ch: 32, attr: 7 });
      screen.push(row);
    }

    function paint() {
      for (var y = 0; y < rows; y += 1) {
        for (var x = 0; x < cols; x += 1) {
          var cell = screen[y][x];
          var px = x * cw;
          var py = y * ch;
          ctx.fillStyle = palette[(cell.attr >> 4) & 0x0f];
          ctx.fillRect(px, py, cw, ch);
          if (cell.ch >= 32 && cell.ch < 127) {
            ctx.fillStyle = palette[cell.attr & 0x0f];
            ctx.font = "14px Consolas, monospace";
            ctx.textBaseline = "middle";
            ctx.textAlign = "left";
            ctx.fillText(String.fromCharCode(cell.ch), px + 2, py + ch / 2 + 1);
          }
        }
      }
    }

    return {
      apply: function (cells) {
        if (!Array.isArray(cells)) return 0;
        var applied = 0;
        cells.forEach(function (item) {
          if (!Array.isArray(item) || item.length < 4) return;
          var row = item[0];
          var col = item[1];
          if (row < 0 || row >= rows || col < 0 || col >= cols) return;
          screen[row][col].ch = item[2];
          screen[row][col].attr = item[3];
          applied += 1;
        });
        if (applied) paint();
        return applied;
      },
      clear: function () {
        for (var y = 0; y < rows; y += 1) {
          for (var x = 0; x < cols; x += 1) screen[y][x] = { ch: 32, attr: 7 };
        }
        paint();
      },
      paint: paint
    };
  };
})(window);
