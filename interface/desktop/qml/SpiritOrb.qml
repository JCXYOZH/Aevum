import QtQuick

Item {
    id: root
    property real phase: 0

    implicitWidth: 44
    implicitHeight: 44

    Canvas {
        id: canvas
        anchors.fill: parent

        onPaint: {
            var ctx = getContext("2d");
            var w = width;
            var h = height;
            var cx = w / 2;
            var cy = h / 2;
            var r = Math.min(w, h) * 0.34;
            var t = root.phase;

            ctx.clearRect(0, 0, w, h);
            ctx.globalCompositeOperation = "source-over";

            // 两层柔光，保留原页面“灵体”的珊瑚 / 青 / 琥珀三色关系。
            var halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.52);
            halo.addColorStop(0.00, "rgba(255, 190, 11, 0.22)");
            halo.addColorStop(0.38, "rgba(78, 205, 196, 0.14)");
            halo.addColorStop(0.72, "rgba(255, 107, 107, 0.07)");
            halo.addColorStop(1.00, "rgba(246, 240, 227, 0)");
            ctx.fillStyle = halo;
            ctx.beginPath();
            ctx.arc(cx, cy, Math.min(w, h) * 0.52, 0, Math.PI * 2);
            ctx.fill();

            ctx.save();
            ctx.translate(cx + Math.sin(t * 0.9) * w * 0.035, cy + Math.cos(t * 0.7) * h * 0.025);

            var core = ctx.createRadialGradient(-w * 0.10, -h * 0.12, 0, 0, 0, r * 1.22);
            core.addColorStop(0.00, "rgba(255, 107, 107, 0.78)");
            core.addColorStop(0.34, "rgba(78, 205, 196, 0.62)");
            core.addColorStop(0.72, "rgba(255, 190, 11, 0.58)");
            core.addColorStop(1.00, "rgba(255, 190, 11, 0.10)");
            ctx.fillStyle = core;

            ctx.beginPath();
            ctx.scale(
                1.0 + Math.sin(t * 1.4) * 0.06,
                1.0 + Math.cos(t * 1.1) * 0.05
            );
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fill();

            // 偏左上的内层高光，让它像活物而不是纯色圆点。
            var sheen = ctx.createRadialGradient(-r * 0.34, -r * 0.38, 0, -r * 0.10, -r * 0.12, r * 0.72);
            sheen.addColorStop(0.00, "rgba(255, 255, 255, 0.36)");
            sheen.addColorStop(0.55, "rgba(255, 255, 255, 0.08)");
            sheen.addColorStop(1.00, "rgba(255, 255, 255, 0)");
            ctx.fillStyle = sheen;
            ctx.beginPath();
            ctx.arc(-r * 0.10, -r * 0.12, r * 0.72, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
        }
    }

    Timer {
        interval: 16
        repeat: true
        running: true
        onTriggered: {
            root.phase += 0.032;
            canvas.requestPaint();
        }
    }
}
