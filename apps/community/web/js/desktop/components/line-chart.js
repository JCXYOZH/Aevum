/* Reusable loss chart. Input is plain points + epoch summaries; it never
   touches the API or DOM outside its own canvas. */
(function (global) {
  "use strict";
  var MD = global.MD;
  MD.components = MD.components || {};

  MD.components.lineChart = function (canvas, options) {
    options = options || {};
    var emptyText = options.emptyText || "等待训练指标";
    var ctx = canvas.getContext("2d");

    return {
      draw: function (points, epochs) {
        var dpr = window.devicePixelRatio || 1;
        var cssW = canvas.clientWidth || 600;
        var cssH = canvas.clientHeight || 190;
        canvas.width = Math.floor(cssW * dpr);
        canvas.height = Math.floor(cssH * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);

        var padL = 44, padR = 14, padT = 14, padB = 24;
        var w = cssW - padL - padR;
        var h = cssH - padT - padB;
        ctx.fillStyle = "#0a1015";
        ctx.fillRect(0, 0, cssW, cssH);

        var values = (points || []).filter(function (p) { return typeof p.loss === "number"; });
        if (!values.length) {
          ctx.strokeStyle = "#27333f";
          ctx.lineWidth = 1;
          ctx.strokeRect(padL, padT, w, h);
          ctx.fillStyle = "#637486";
          ctx.font = "11px Consolas, monospace";
          ctx.textAlign = "center";
          ctx.fillText(emptyText, cssW / 2, cssH / 2);
          return;
        }

        var min = Math.min.apply(null, values.map(function (p) { return p.loss; }));
        var max = Math.max.apply(null, values.map(function (p) { return p.loss; }));
        if (max - min < 0.05) { max += 0.03; min -= 0.03; }
        var y = function (v) { return padT + h - (v - min) / (max - min) * h; };
        var x = function (i) { return padL + (values.length <= 1 ? 0 : i / (values.length - 1) * w); };

        ctx.strokeStyle = "#27333f";
        ctx.lineWidth = 1;
        ctx.font = "9px Consolas, monospace";
        ctx.fillStyle = "#637486";
        ctx.textAlign = "right";
        for (var g = 0; g <= 4; g += 1) {
          var value = min + (max - min) * (g / 4);
          var gy = padT + h - (g / 4) * h;
          ctx.fillText(value.toFixed(3), padL - 6, gy + 3);
          ctx.beginPath();
          ctx.moveTo(padL, gy);
          ctx.lineTo(padL + w, gy);
          ctx.stroke();
        }

        ctx.strokeStyle = "#d9a35f";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        values.forEach(function (p, i) {
          if (i === 0) ctx.moveTo(x(i), y(p.loss));
          else ctx.lineTo(x(i), y(p.loss));
        });
        ctx.stroke();

        ctx.fillStyle = "rgba(217,163,95,.55)";
        values.forEach(function (p, i) {
          if (values.length > 120 && i % Math.ceil(values.length / 90) !== 0) return;
          ctx.fillRect(x(i) - 1, y(p.loss) - 1, 2, 2);
        });

        if (epochs && epochs.length) {
          ctx.strokeStyle = "rgba(87,183,176,.55)";
          ctx.setLineDash([4, 4]);
          epochs.forEach(function (e) {
            if (typeof e.eval_loss !== "number") return;
            var ey = y(e.eval_loss);
            if (ey < padT || ey > padT + h) return;
            ctx.beginPath();
            ctx.moveTo(padL, ey);
            ctx.lineTo(padL + w, ey);
            ctx.stroke();
          });
          ctx.setLineDash([]);
        }

        ctx.fillStyle = "#637486";
        ctx.textAlign = "left";
        ctx.fillText("step " + values[0].step, padL, cssH - 7);
        ctx.textAlign = "right";
        ctx.fillText("step " + values[values.length - 1].step, padL + w, cssH - 7);
      }
    };
  };
})(window);
