/* Boot file: wires the shell components to panel factories and owns the
   only two intervals that are not panel-scoped (health + clock is in topbar). */
(function (global) {
  "use strict";
  var MD = global.MD;

  MD.initStore();

  var manager = MD.components.windowManager({
    desk: MD.qs(".desk"),
    layer: MD.$("windows"),
    template: MD.$("win-template"),
    onFocus: function (activeId) { dock.refresh(activeId); },
    onClose: function () { launchpad.render(); }
  });

  var topbar = MD.components.topbar({
    root: MD.qs(".topbar"),
    foot: MD.qs(".foot"),
    onOpen: function (service) {
      openWindow({ bridge: "kernel", relay: "relay", trainer: "trainer" }[service] || "exhibit");
    },
    onLaunchpad: function () { launchpad.show(); },
    onAdd: function () { dialog.open(); }
  });

  var dock = MD.components.dock({
    root: MD.qs(".dock"),
    onOpen: openWindow,
    onLaunchpad: function () { launchpad.show(); },
    onAdd: function () { dialog.open(); }
  });

  var launchpad = MD.components.launchpad({
    root: MD.$("launchpad"),
    onOpen: function (id) { launchpad.hide(); openWindow(id); },
    onAdd: function () { dialog.open(); },
    onRemove: removeCustom
  });

  var dialog = MD.components.addDialog({
    root: MD.$("add-dialog"),
    onSubmit: function (title, url) {
      if (!title) return "窗口名不能为空。";
      if (!url) return "地址不能为空。";
      var result = MD.addCustom(title, url);
      if (result.error) return result.error;
      launchpad.hide();
      openWindow(result.app.id);
      return "";
    }
  });

  function createPanel(app) {
    if (app.id === "overview") return MD.panels.overview({
      openWindow: openWindow,
      openAdd: function () { dialog.open(); },
      removeCustom: removeCustom
    });
    if (app.id === "kernel") return MD.panels.kernel();
    if (app.id === "trainer") return MD.panels.trainer();
    if (app.id === "model") return MD.panels.model();
    if (app.id === "relay") return MD.panels.relay();
    if (app.id === "errors") return MD.panels.errors();
    if (app.id === "exhibit") return MD.panels.exhibit({ title: "AEVUM 展示页" });
    if (app.id === "camera") return MD.panels.camera();
    if (app.id === "subscribe") return MD.panels.subscribe();
    if (app.url) return MD.panels.exhibit({ url: app.url, title: app.title });
    return MD.panels.exhibit({ url: "index.html", title: app.title });
  }

  function openWindow(id) {
    var app = MD.getApp(id);
    if (!app) return;
    // 沉浸模式会隐藏 .windows 层；从启动项打开窗口时先返回桌面视图。
    var desk = MD.qs(".desk");
    if (desk && desk.classList.contains("scene-focus")) {
      var focusToggle = MD.qs('[data-scene-view="focus"]');
      if (focusToggle) focusToggle.click();
    }
    var existing = manager.get(id);
    if (existing) {
      manager.open(id, app, existing.panel);
      return;
    }
    manager.open(id, app, createPanel(app));
  }

  function removeCustom(id) {
    manager.close(id);
    MD.removeCustom(id);
    launchpad.render();
  }

  function refreshHealth() {
    MD.api.health().then(function (data) {
      var services = data.services || {};
      var trainer = data.trainer || {};
      topbar.setPill("bridge", services.bridge && services.bridge.ok ? "ok" : "bad", "内核");
      topbar.setPill("relay", services.relay && services.relay.ok ? "ok" : "bad", "中继");
      topbar.setPill("web", services.web && services.web.ok ? "ok" : "bad", "页面");
      topbar.setPill("trainer", trainer.running ? "ok" : (trainer.available ? "wait" : "bad"), trainer.running ? "训练中" : (trainer.available ? "已停止" : "无训练"));
      topbar.setFoot("监控服务：已连接 · " + new Date().toLocaleTimeString());
      MD.bus.emit("health", data);
    }).catch(function (err) {
      ["bridge", "relay", "web"].forEach(function (name) {
        topbar.setPill(name, "bad", name === "bridge" ? "内核" : name === "relay" ? "中继" : "页面");
      });
      topbar.setPill("trainer", "bad", "训练");
      topbar.setFoot("监控服务：未连接（" + err.message + "）");
      MD.bus.emit("health", { error: err.message, services: {} });
    });
  }

  MD.bus.on("request-open", openWindow);

  refreshHealth();
  setInterval(refreshHealth, 5000);

  global.MemoriaDesk = {
    open: openWindow,
    close: function (id) { manager.close(id); },
    apps: function () { return MD.listApps(); },
    addWindow: function (title, url) {
      var result = MD.addCustom(title, url);
      if (!result.error) openWindow(result.app.id);
      return result;
    }
  };
})(window);
