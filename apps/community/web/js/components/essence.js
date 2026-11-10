/* =================================================================
   components/essence.js —— 彩色灵体组件（逻辑归属：本文件）
   形：形态 / 光晕 / 脉冲（样式在 styles/essence.css）
   动：交给 core/wander.js。

   位置模型：灵体是页面里的一件东西，不是视口上的悬浮层。
   - 它在 section.hero 里绝对定位（hero 就是它的包含块），坐标全部相对 hero 算；
     页面滚动时它跟着内容一起走，滚回来还在原处，不需要任何滚动补偿；
   - 只有一条锚线：文字块下方、“进度口径”那行再往下一点。它挂着这条线左右游走，
     不做入场位移、不做滚动显隐、不在中途重算落点，所以既不会瞬移也不会消失；
   - 窄屏 / 减弱动效：不挂载，留在文档流里静态展示。
   ================================================================= */

(function (A) {
  "use strict";

  const root = document.getElementById("essence");
  if (!root) return;

  const hero = document.getElementById("hero");
  const heroText = document.querySelector(".hero__inner");
  const note = document.querySelector(".hero__note");
  if (!hero || !heroText) return;

  const FREE_MIN_WIDTH = 860;
  const MIN_SIZE = 96;
  const MAX_SIZE = 190;
  const ANCHOR_GAP = 64; /* 锚线：进度口径那行下沿再往下让一段，别贴着正文 */
  const BAND_EXTRA = 28; /* 游走带比灵体本身高出的部分，只够上下浮一点 */

  /* 系统关掉“动画效果”时，浏览器会报 prefers-reduced-motion: reduce，
     此时灵体按无障碍规则退回静态。加 ?motion=on 可强制开启动效，
     方便演示和截图，不影响默认行为。 */
  const forceMotion = /[?&]motion=on(&|$)/.test(window.location.search);
  const reduced =
    !forceMotion &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let motion = null;
  let resizeTimer = null;

  function clamp(v, min, max) {
    if (v < min) return min;
    if (v > max) return max;
    return v;
  }

  /* 下面几个坐标都写成「相对 hero」的形式。
     getBoundingClientRect 的差值和滚动位置无关，所以页面滚到哪都适用，
     不需要读 scrollY，也就不需要任何滚动监听。 */
  function heroBox() {
    return hero.getBoundingClientRect();
  }

  function textBox() {
    const h = heroBox();
    const t = heroText.getBoundingClientRect();
    return {
      left: t.left - h.left,
      right: t.right - h.left,
      top: t.top - h.top,
      bottom: t.bottom - h.top,
      width: t.width,
      height: t.height,
    };
  }

  function anchorLine() {
    const h = heroBox();
    const element = note || heroText;
    return element.getBoundingClientRect().bottom - h.top + ANCHOR_GAP;
  }

  /* 游走带：贴着锚线的一条窄带，左右到文字列两端。
     它在这里主要做横向移动，纵向只留一点余量，看起来就是“挂在那条线上活着”。 */
  function bandRect() {
    const h = heroBox();
    const size = root.offsetWidth || MIN_SIZE;
    const top = anchorLine();
    const limit = h.height - 24;
    return {
      left: textBox().left,
      right: textBox().right,
      top: top,
      bottom: Math.min(top + size + BAND_EXTRA, limit),
    };
  }

  /* 尺寸跟着锚线下面剩下的空间走：空间不够先缩，而不是让光团压回正文 */
  function fitSize() {
    const h = heroBox();
    const room = h.height - anchorLine() - 40;
    return Math.round(
      clamp(Math.min(room, window.innerWidth * 0.13), MIN_SIZE, MAX_SIZE)
    );
  }

  function mount() {
    if (motion || reduced) return;
    if (window.innerWidth < FREE_MIN_WIDTH) return; /* 窄屏留在文档流里 */

    root.style.width = fitSize() + "px";
    root.classList.add("essence--anchored");

    const band = bandRect();
    motion = A.wander.attach(root, {
      pad: 8,
      /* 坐标是相对 hero 的，不能拿视口去裁，否则一滚动就被挤扁 */
      clampViewport: false,
      /* 起点就是这条线的正中，没有“从屏幕底下升上来”那套位移 */
      start: {
        x: (band.left + band.right) / 2,
        y: (band.top + band.bottom) / 2,
      },
      bounds: bandRect,
      obstacles: [textBox],
      /* 指针给的是视口坐标，换算进同一个相对坐标系 */
      toLocal: function (cx, cy) {
        const h = heroBox();
        return { x: cx - h.left, y: cy - h.top };
      },
    });
  }

  /* 不再用 opacity 做入场：元素默认就是可见的。
     以前先写 opacity:0、等 load 后再改回 1，只要 mount 抛一次异常、
     或者 load/rAF 的时序没走到，这个 0 就永久留下——表现就是“有时候没有灵体”。
     现在动画挂不上也只是退回文档流里的静态形态，不会整块消失。 */
  function boot() {
    try {
      mount();
    } catch (err) {
      console.error("[essence] 游走挂载失败，退回静态形态：", err);
    }
  }

  function afterSettled(fn) {
    function run() {
      requestAnimationFrame(function () {
        requestAnimationFrame(fn);
      });
    }
    if (document.readyState === "complete") run();
    else window.addEventListener("load", run, { once: true });
  }

  afterSettled(boot);

  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!motion) {
        /* 启动时窗口太窄没挂上，变宽后补挂一次；仍挂不上就保持静态形态 */
        try {
          mount();
        } catch (err) {
          console.error("[essence] 补挂失败：", err);
        }
        return;
      }
      /* 舞台和锚线都是跟着版面算的，窗口一变就重算尺寸，位置由引擎自行收敛 */
      root.style.width = fitSize() + "px";
    }, 160);
  });

  /* ---------- 收到帧时向外荡一圈光晕 ----------
     不用 remove class → void offsetWidth → add class 那套强制同步重排：
     每来一帧逼浏览器重算一次布局，只为让动画从头播。改成 Web Animations API，
     动画直接跑在合成线程上，也不跟某个状态类绑死。 */
  const PULSE_MIN_GAP = 700;
  const PULSE_MS = 520;
  const halo = root.querySelector(".essence__halo");

  let lastPulse = 0;

  function pulse() {
    if (!halo || reduced) return;
    halo.animate(
      [
        { transform: "scale(1)", opacity: 0.42 },
        { transform: "scale(1.08)", opacity: 0 },
      ],
      { duration: PULSE_MS, easing: "ease-out" }
    );
  }

  A.bus.on("frame", function () {
    const now = performance.now();
    if (now - lastPulse < PULSE_MIN_GAP) return;
    lastPulse = now;
    pulse();
  });

  A.bus.on("link:state", function (payload) {
    root.dataset.state = payload.state === "online" ? "online" : "offline";
  });
})(window.AEVUM);
