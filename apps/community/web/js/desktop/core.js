/* Shared desk primitives: DOM helpers, icons, config, event bus and app store.
   Every component and panel reads this namespace; nothing here owns a window. */
(function (global) {
  "use strict";

  var MD = global.MD = global.MD || {};

  MD.$ = function (id) { return document.getElementById(id); };
  MD.qs = function (selector, root) { return (root || document).querySelector(selector); };
  MD.qsa = function (selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  };

  MD.escapeText = function (value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  MD.escapeAttr = function (value) {
    return MD.escapeText(value).replace(/"/g, "&quot;");
  };
  MD.nf = function (value, digits) {
    if (value === null || value === undefined || value === "") return "—";
    var number = Number(value);
    if (!isFinite(number)) return String(value);
    return number.toLocaleString("en-US", { maximumFractionDigits: digits === undefined ? 3 : digits });
  };

  var ICONS = {
    grid: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
    terminal: '<path d="M3 5h18v14H3z"/><path d="m7 9 3 3-3 3M13 15h4"/>',
    camera: '<rect x="3" y="7" width="18" height="13" rx="1"/><path d="M8 7l2-3h4l2 3M12 11a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/>',
    pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
    alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 9v5M12 17.5v.2"/>',
    page: '<path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4M9 11h6M9 14h6M9 17h4"/>',
    mail: '<path d="M3 5h18v14H3z"/><path d="m3 6 9 7 9-7"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    sliders: '<path d="M5 4v16M12 4v16M19 4v16"/><path d="M2 9h6M9 15h6M16 7h6"/>',
    layers: '<path d="M12 3 2 8l10 5 10-5z"/><path d="M2 12l10 5 10-5M2 16l10 5 10-5"/>',
    close: '<path d="m5 5 14 14M19 5 5 19"/>',
    maximize: '<path d="M4 4h16v16H4z"/>',
    minimize: '<path d="M4 12h16"/>'
  };
  MD.icon = function (name, cls) {
    return '<svg class="' + (cls || "") + '" viewBox="0 0 24 24" aria-hidden="true">' +
      (ICONS[name] || ICONS.grid) + '</svg>';
  };

  var params = new URLSearchParams(global.location.search);
  var loopback = /^(127\.0\.0\.1|localhost)$/.test(global.location.hostname);

  function sameOriginWs(path) {
    if (!global.location.host) return "";
    var scheme = global.location.protocol === "https:" ? "wss:" : "ws:";
    return scheme + "//" + global.location.host + path;
  }

  MD.config = {
    relayBase: (params.get("relay") || (loopback ? "http://127.0.0.1:8790" : "")).replace(/\/$/, ""),
    bridgeUrl: params.get("bridge") || (loopback ? "ws://127.0.0.1:8765" : sameOriginWs("/ws")),
    monitorBase: ""
  };

  MD.bus = (function () {
    var handlers = {};
    return {
      on: function (name, fn) {
        (handlers[name] = handlers[name] || []).push(fn);
        return function () { MD.bus.off(name, fn); };
      },
      off: function (name, fn) {
        handlers[name] = (handlers[name] || []).filter(function (item) { return item !== fn; });
      },
      emit: function (name, payload) {
        (handlers[name] || []).forEach(function (fn) {
          try { fn(payload); } catch (err) { console.error("[desk:bus]", name, err); }
        });
      }
    };
  })();

  MD.baseApps = [
    { id: "overview", title: "总览", meta: "OVERVIEW", icon: "grid", w: 540, h: 660, desc: "项目本体与四个入口" },
    { id: "kernel", title: "内核实况", meta: "80×25 VGA", icon: "terminal", w: 1000, h: 600, desc: "QEMU 串口帧 / VGA" },
    { id: "trainer", title: "训练监控", meta: "LOSS / EPOCH", icon: "pulse", w: 690, h: 610, desc: "JSONL 指标 / 错误" },
    { id: "model", title: "模型对话", meta: "CHECKPOINT", icon: "layers", w: 720, h: 620, desc: "加载检查点并生成文本" },
    { id: "relay", title: "中继交流", meta: "ROOM / LOBBY", icon: "chat", w: 590, h: 590, desc: "在线、浏览、发帖" },
    { id: "errors", title: "错误看板", meta: "0xRRFFTT", icon: "alert", w: 680, h: 600, desc: "错误码与日志" },
    { id: "exhibit", title: "展示页", meta: "LEGACY PAGE", icon: "page", w: 940, h: 660, desc: "原 AEVUM 长页" },
    { id: "camera", title: "拍照", meta: "LOCAL / RAM", icon: "camera", w: 560, h: 560, desc: "拍下 3D 场景；图片只在本次页面内存中" },
    {
      id: "mrhua",
      title: "MrHua",
      meta: "WORKBENCH / SHELL",
      icon: "grid",
      w: 1200,
      h: 800,
      desc: "完整 MrHua 工作台：3D 灵体、窗口体系与广域网",
      external: true,
      url: "/mrhua/"
    },
    {
      id: "subscribe",
      title: "订阅",
      meta: "AEVUM / MAIL",
      icon: "mail",
      w: 620,
      h: 520,
      desc: "只订 Aevum 更新；一人一封，可退订"
    },
    {
      id: "mrhua-wan",
      title: "MrHua 广域网",
      meta: "WAN / MQTT",
      icon: "chat",
      w: 1000,
      h: 740,
      desc: "MrHua 广域网通信页",
      external: true,
      url: "/mrhua/?embed=wanshare"
    }
  ];

  // 当前演示阶段显示 MrHua 工作台、订阅、内核实况、原展示页和拍照窗口；其它窗口代码仍在，避免删掉以后要用的入口。
  MD.visibleApps = ["mrhua", "subscribe", "kernel", "exhibit", "camera"];

  MD.state = {
    wins: new Map(),
    z: 10,
    custom: [],
    kernelFrames: 0,
    kernelCells: 0
  };

  function loadCustom() {
    try {
      var raw = localStorage.getItem("memoria.desktop.windows");
      var data = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(data)) return [];
      return data.filter(function (item) {
        return item && typeof item.id === "string" && typeof item.title === "string" && typeof item.url === "string";
      }).slice(0, 12);
    } catch (err) {
      return [];
    }
  }

  function saveCustom() {
    try {
      localStorage.setItem("memoria.desktop.windows", JSON.stringify(MD.state.custom));
    } catch (err) {
      /* Storage can be disabled; the in-memory window still works for this session. */
    }
  }

  MD.initStore = function () {
    MD.state.custom = loadCustom();
    MD.state.custom.forEach(function (app) {
      MD.baseApps.push({
        id: app.id, title: app.title, meta: "EXTENSION", icon: "page",
        w: 760, h: 560, desc: app.url, url: app.url, custom: true
      });
    });
  };

  MD.getApp = function (id) {
    return MD.baseApps.find(function (app) { return app.id === id; }) || null;
  };

  MD.listApps = function () {
    if (!MD.visibleApps) return MD.baseApps.slice();
    return MD.baseApps.filter(function (app) {
      return app.custom || MD.visibleApps.indexOf(app.id) !== -1;
    });
  };

  MD.addCustom = function (title, rawUrl) {
    var normalized;
    try {
      normalized = new URL(rawUrl, global.location.href);
    } catch (err) {
      return { error: "地址不合法。" };
    }
    if (!/^(http:|https:|file:)$/.test(normalized.protocol)) {
      return { error: "只接受 http / https / file 地址。" };
    }
    var id = "custom-" + Date.now().toString(36);
    var app = {
      id: id, title: title.slice(0, 24), meta: "EXTENSION", icon: "page",
      w: 760, h: 560, desc: rawUrl, url: rawUrl, custom: true
    };
    MD.state.custom.push({ id: id, title: app.title, url: app.url });
    MD.baseApps.push(app);
    saveCustom();
    MD.bus.emit("apps", MD.listApps());
    return { app: app };
  };

  MD.removeCustom = function (id) {
    MD.state.custom = MD.state.custom.filter(function (item) { return item.id !== id; });
    MD.baseApps = MD.baseApps.filter(function (app) { return !(app.custom && app.id === id); });
    saveCustom();
    MD.bus.emit("apps", MD.listApps());
  };
})(window);
