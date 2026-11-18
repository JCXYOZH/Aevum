/* =================================================================
   core/wander.js —— 通用游走引擎（可复用到任何页面元素）
   提取自 MrHua 的自主游走系统（engine-extra.js 第 232–667 行）：
   弹簧插值、空气墙、避障、躲鼠标 / 磁吸、30fps 节流、页面隐藏暂停。
   这里去掉了窗口停靠 / 3D 模型 / 菜单栏等家电专属逻辑，
   只保留“一个元素在一块区域里自己活着”的部分。

   用法：
     const handle = AEVUM.wander.attach(el, {
       obstacles: [panelEl],   // 元素或 () => rect
       pad: 18,                // 离屏幕边缘的余量
       size: 160,              // 半宽基准，默认取 el.offsetWidth
       onMove(state) {}        // 每帧回调，可拿 x/y/vx/vy/mode
     });
     handle.detach();          // 停用并移除监听

   模式：idle（随机漫游）| flee（躲开快速靠近的指针）| magnet（指针停驻时飘过去）
   ================================================================= */

(function (A) {
  "use strict";

  const FRAME_GAP = 33; /* 30fps，降低无谓的 DOM 写入 */

  function clamp(v, min, max) {
    if (v < min) return min;
    if (v > max) return max;
    return v;
  }

  function attach(el, options) {
    const opts = options || {};
    const obstacleSource = opts.obstacles || [];

    const state = {
      x: 0,
      y: 0,
      tx: 0,
      ty: 0,
      vx: 0,
      vy: 0,
      mode: "idle",
      nextMove: 0,
      mouseX: -9999,
      mouseY: -9999,
      mouseSpeed: 0,
      lastMouseX: 0,
      lastMouseY: 0,
      lastMouseT: 0,
      fleeUntil: 0,
      magnetUntil: 0,
    };

    let raf = null;
    let lastTick = 0;
    let stopped = false;

    function radius() {
      return (opts.size || el.offsetWidth || 140) / 2;
    }

    function viewBounds() {
      const pad = opts.pad == null ? 16 : opts.pad;
      const r = radius() + pad;
      const clampToViewport = opts.clampViewport !== false;

      let left = 0;
      let right = window.innerWidth;
      let top = 0;
      let bottom = window.innerHeight;

      /* 给一块参照区域（如首屏下半部），传函数以便跟随滚动 */
      if (typeof opts.bounds === "function") {
        const rect = opts.bounds();
        if (rect) {
          left = rect.left;
          right = rect.right;
          top = rect.top;
          bottom = rect.bottom;
        }
      }

      /* 参照区域超出视口的部分要裁掉，否则游走目标会跑到屏幕外。
         元素锚在页面里（跟着内容滚动）时要关掉这一步：那时坐标是相对所在容器的，
         拿视口去裁会把它按滚动位置一路挤扁。 */
      if (clampToViewport) {
        left = Math.max(left, 0);
        right = Math.min(right, window.innerWidth);
        top = Math.max(top, 0);
        bottom = Math.min(bottom, window.innerHeight);
      }

      /* 区域比元素还小的时候，把这一轴钉在中线：宁可少动，也不要把元素挤到区域外面去 */
      const cx = (left + right) / 2;
      const cy = (top + bottom) / 2;
      const roomyX = right - left > r * 2;
      const roomyY = bottom - top > r * 2;

      return {
        minX: roomyX ? left + r : cx,
        maxX: roomyX ? right - r : cx,
        minY: roomyY ? top + r : cy,
        maxY: roomyY ? bottom - r : cy,
      };
    }

    function obstacles() {
      const list = [];
      for (let i = 0; i < obstacleSource.length; i++) {
        const item = obstacleSource[i];
        if (!item) continue;
        const rect =
          typeof item === "function" ? item() : item.getBoundingClientRect();
        if (rect && rect.width > 4 && rect.height > 4) list.push(rect);
      }
      return list;
    }

    function hits(x, y, rects) {
      const r = radius();
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        if (
          x > rect.left - r &&
          x < rect.right + r &&
          y > rect.top - r &&
          y < rect.bottom + r
        ) {
          return true;
        }
      }
      return false;
    }

    function pickTarget() {
      const b = viewBounds();
      const rects = obstacles();
      for (let i = 0; i < 14; i++) {
        const x = b.minX + Math.random() * Math.max(1, b.maxX - b.minX);
        const y = b.minY + Math.random() * Math.max(1, b.maxY - b.minY);
        if (!hits(x, y, rects)) {
          state.tx = x;
          state.ty = y;
          return;
        }
      }
      /* 实在找不到空地就取边缘，避免元素卡死在障碍里 */
      state.tx = b.minX + Math.random() * Math.max(1, b.maxX - b.minX);
      state.ty = b.minY + Math.random() * Math.max(1, b.maxY - b.minY);
    }

    function place() {
      const tilt = clamp(state.vx * 1.4, -10, 10);
      el.style.transform =
        "translate3d(" +
        state.x.toFixed(1) +
        "px," +
        state.y.toFixed(1) +
        "px,0) translate(-50%,-50%) rotate(" +
        tilt.toFixed(2) +
        "deg)";
    }

    function step(now) {
      const b = viewBounds();
      const rects = obstacles();
      const r = radius();

      /* 指针停下后速度要衰减，否则会一直误判成“快速靠近” */
      if (now - state.lastMouseT > 120) {
        state.mouseSpeed = Math.max(0, state.mouseSpeed * 0.9);
      }

      if (state.mode === "idle" && now > state.nextMove) {
        pickTarget();
        state.nextMove = now + 2600 + Math.random() * 4200;
      }
      if (state.mode === "idle" && hits(state.tx, state.ty, rects)) {
        pickTarget();
      }

      const dmx = state.mouseX - state.x;
      const dmy = state.mouseY - state.y;
      const dist = Math.sqrt(dmx * dmx + dmy * dmy);

      if (dist < 150 && state.mouseSpeed > 0.55) {
        /* 快速靠近 → 害羞躲开 */
        state.mode = "flee";
        state.tx = state.x - dmx * 1.6;
        state.ty = state.y - dmy * 1.6;
        state.fleeUntil = now + 700;
      } else if (state.mode === "flee" && now > state.fleeUntil) {
        state.mode = "idle";
        state.nextMove = now + 500;
      } else if (state.mode === "idle" && dist < 120 && state.mouseSpeed < 0.25) {
        /* 指针停驻 → 飘过去（方便点到它） */
        state.mode = "magnet";
        state.tx = state.mouseX;
        state.ty = state.mouseY;
        state.magnetUntil = now + 1600;
      } else if (state.mode === "magnet") {
        state.tx = state.mouseX;
        state.ty = state.mouseY;
        if (now > state.magnetUntil || dist > 190 || state.mouseSpeed > 0.85) {
          state.mode = "idle";
          state.nextMove = now + 400;
        }
      }

      state.tx = clamp(state.tx, b.minX, b.maxX);
      state.ty = clamp(state.ty, b.minY, b.maxY);

      let speed;
      if (state.mode === "magnet") speed = 0.075;
      else if (state.mode === "flee") speed = 0.12;
      else speed = 0.045;

      const dx = state.tx - state.x;
      const dy = state.ty - state.y;
      state.vx = state.vx * 0.85 + dx * speed * 0.15;
      state.vy = state.vy * 0.85 + dy * speed * 0.15;
      state.x += state.vx;
      state.y += state.vy;

      /* 边界：贴住即停，不做反向弹开。
         舞台通常很窄，硬反弹会变成连续撞墙，看起来一顿一顿的。 */
      if (state.x < b.minX) {
        state.x = b.minX;
        state.vx = 0;
      } else if (state.x > b.maxX) {
        state.x = b.maxX;
        state.vx = 0;
      }
      if (state.y < b.minY) {
        state.y = b.minY;
        state.vy = 0;
      } else if (state.y > b.maxY) {
        state.y = b.maxY;
        state.vy = 0;
      }

      /* 避障：每帧只推开一小步，滑出去而不是瞬移 */
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        if (
          !(
            state.x > rect.left - r &&
            state.x < rect.right + r &&
            state.y > rect.top - r &&
            state.y < rect.bottom + r
          )
        ) {
          continue;
        }

        const gap = 6;
        const stepMax = 7;
        const left = state.x - (rect.left - r);
        const right = rect.right + r - state.x;
        const top = state.y - (rect.top - r);
        const bottom = rect.bottom + r - state.y;
        const min = Math.min(left, right, top, bottom);

        if (min === left) {
          state.x = Math.max(rect.left - r - gap, state.x - stepMax);
        } else if (min === right) {
          state.x = Math.min(rect.right + r + gap, state.x + stepMax);
        } else if (min === top) {
          state.y = Math.max(rect.top - r - gap, state.y - stepMax);
        } else {
          state.y = Math.min(rect.bottom + r + gap, state.y + stepMax);
        }
      }

      state.x = clamp(state.x, b.minX, b.maxX);
      state.y = clamp(state.y, b.minY, b.maxY);

      place();
      if (typeof opts.onMove === "function") opts.onMove(state);
    }

    function tick(ts) {
      if (stopped) return;
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      if (ts - lastTick < FRAME_GAP) return;
      lastTick = ts;
      step(ts);
    }

    function onPointer(e) {
      const now = performance.now();
      /* 指针坐标默认是视口的；元素锚在容器里时，交给调用方换算到同一坐标系 */
      let px = e.clientX;
      let py = e.clientY;
      if (typeof opts.toLocal === "function") {
        const p = opts.toLocal(e.clientX, e.clientY);
        if (p) {
          px = p.x;
          py = p.y;
        }
      }
      const dt = now - state.lastMouseT;
      if (dt > 0 && dt < 400) {
        const dx = px - state.lastMouseX;
        const dy = py - state.lastMouseY;
        state.mouseSpeed = Math.min(
          Math.sqrt(dx * dx + dy * dy) / dt,
          3
        );
      } else {
        state.mouseSpeed = 0;
      }
      state.mouseX = px;
      state.mouseY = py;
      state.lastMouseX = px;
      state.lastMouseY = py;
      state.lastMouseT = now;
    }

    function onResize() {
      const b = viewBounds();
      state.x = clamp(state.x, b.minX, b.maxX);
      state.y = clamp(state.y, b.minY, b.maxY);
      place();
    }

    function start() {
      const b = viewBounds();

      /* 显式起点优先（用于“从屏幕底部升上来”这类入场）；
         没有就落在区域下缘，而不是顶边——元素不该一出现就钉在最上面。 */
      if (
        opts.start &&
        typeof opts.start.x === "number" &&
        typeof opts.start.y === "number"
      ) {
        state.x = opts.start.x;
        state.y = opts.start.y;
      } else {
        state.x = (b.minX + b.maxX) / 2;
        state.y = b.maxY - 24;
      }

      state.x = clamp(state.x, b.minX, b.maxX);
      state.y = clamp(state.y, b.minY, b.maxY);
      state.tx = state.x;
      state.ty = state.y;
      state.nextMove = performance.now() + 1200;
      place();
      window.addEventListener("pointermove", onPointer, { passive: true });
      window.addEventListener("resize", onResize);
      raf = requestAnimationFrame(tick);
    }

    function detach() {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("resize", onResize);
      el.style.transform = "";
    }

    start();

    return {
      detach: detach,
      get state() {
        return state;
      },
    };
  }

  A.wander = { attach: attach };
})(window.AEVUM);
