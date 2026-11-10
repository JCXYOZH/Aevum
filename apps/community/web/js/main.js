/* =================================================================
   main.js —— 装配入口
   这里只做两件事：发起连接、把模块挂到全局方便调试。
   组件自己在加载时向 bus 注册，顺序由 index.html 决定。
   ================================================================= */

(function (A) {
  "use strict";

  A.ws.connect();

  /* 控制台排查入口：AEVUM.bus / AEVUM.ws / AEVUM.screen / AEVUM.demoFeed */
  window.AEVUM = A;
})(window.AEVUM);
