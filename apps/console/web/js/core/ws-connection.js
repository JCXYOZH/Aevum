/* =================================================================
   core/ws-connection.js —— 唯一持有 WebSocket 的地方
   对外只暴露 connect / reconnect / state，其余组件通过事件订阅：
     link:state  { state: "connecting" | "online" | "offline", detail }
     frame       { type: "frame", cells: [[row, col, ch, attr], ...] }
   ================================================================= */

(function (A) {
  "use strict";

  function resolveWsUrl() {
    const loc = window.location;
    const host = loc.host;
    const loopback = host.split(":")[0] === "127.0.0.1" || host.split(":")[0] === "localhost";

    // file:// 直开、以及本地静态服务器：页面没有反向代理，直连本机桥接
    if (!host || loopback) {
      return "ws://127.0.0.1:8765";
    }

    // 线上：桥接由反向代理挂在同域的 /ws，https 页面必须用 wss
    const scheme = loc.protocol === "https:" ? "wss:" : "ws:";
    return scheme + "//" + host + "/ws";
  }

  const WS_URL = resolveWsUrl();
  const RETRY_DELAY = 2000;

  let socket = null;
  let retryTimer = null;
  let state = "offline";

  function setState(next, detail) {
    state = next;
    A.bus.emit("link:state", { state: next, detail: detail || null });
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, RETRY_DELAY);
  }

  function connect() {
    clearTimeout(retryTimer);

    if (
      socket &&
      (socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    setState("connecting");

    try {
      socket = new WebSocket(WS_URL);
    } catch (err) {
      setState("offline", err.message);
      scheduleRetry();
      return;
    }

    socket.onopen = function () {
      setState("online");
    };

    socket.onmessage = function (event) {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        return;
      }
      if (msg && msg.type === "frame" && Array.isArray(msg.cells)) {
        A.bus.emit("frame", msg);
      }
    };

    socket.onerror = function () {
      /* 浏览器紧接着会触发 onclose，重连逻辑统一放那边 */
    };

    socket.onclose = function () {
      socket = null;
      setState("offline");
      scheduleRetry();
    };
  }

  function reconnect() {
    clearTimeout(retryTimer);
    if (socket) {
      try {
        socket.close();
      } catch (err) {
        /* 已经断了就忽略 */
      }
      socket = null;
    }
    connect();
  }

  A.ws = {
    connect: connect,
    reconnect: reconnect,
    get state() {
      return state;
    },
    url: WS_URL,
  };
})(window.AEVUM);
