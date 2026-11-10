/* Relay panel: heartbeat, context polling and one composer. It reports
   online/views through the bus so overview does not duplicate HTTP calls. */
(function (global) {
  "use strict";
  var MD = global.MD;
  MD.panels = MD.panels || {};

  MD.panels.relay = function () {
    var root = document.createElement("div");
    root.className = "relay-grid";
    root.innerHTML =
      '<div class="relay-bar"><div><strong>房间 · <span data-field="r-room">lobby</span></strong><div class="relay-meters"><span>在线 <b data-field="r-online">—</b></span><span>浏览 <b data-field="r-views">—</b></span><span>落盘 <b>false</b></span></div></div><span class="relay-state" data-field="r-state" data-state="idle">未连接</span></div>' +
      '<ol class="relay-feed" data-field="r-feed"><li class="post"><p class="post__body">还没有帖子。发第一条，它只进服务端内存。</p></li></ol>' +
      '<div class="relay-compose"><input data-field="r-nick" maxlength="16" placeholder="昵称" autocomplete="off"><textarea data-field="r-text" rows="2" maxlength="2000" placeholder="说点什么。会写进房间会话，不落盘。"></textarea><div class="toolbar"><span class="small">Ctrl+Enter 发送 · <span data-field="r-base"></span></span><button class="tbtn tbtn--solid" type="button" data-field="r-send">发送</button></div></div>';

    var room = "lobby";
    var polling = false;
    var signature = "";
    var rendered = false;
    var timers = [];
    var alive = false;
    var client = (function () {
      var id = sessionStorage.getItem("memoria.relay.client");
      if (!id) {
        id = "c-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
        sessionStorage.setItem("memoria.relay.client", id);
      }
      return id;
    })();

    function q(name) { return root.querySelector('[data-field="' + name + '"]'); }
    function set(name, text) { var node = q(name); if (node) node.textContent = text; }
    function state(text, kind) {
      var node = q("r-state");
      if (node) { node.textContent = text; node.dataset.state = kind || "idle"; }
    }

    function describe(result) { return MD.api.describe(result); }

    function heartbeat() {
      if (!alive) return Promise.resolve();
      return MD.api.relay("POST", "/v1/presence", { client: client }).then(function (result) {
        if (!result.data.ok) {
          state(describe(result), "error");
          MD.bus.emit("relay", { ok: false });
          return;
        }
        room = result.data.room || room;
        set("r-room", room);
        set("r-online", result.data.online);
        set("r-views", result.data.views);
        state("已连接 · 契约 " + (result.data.magic || "?") + "/" + (result.data.v || "?"), "online");
        MD.bus.emit("relay", { ok: true, online: result.data.online, views: result.data.views, room: room });
      }).catch(function (err) {
        state("连不上：" + (err && err.message ? err.message : err), "error");
        MD.bus.emit("relay", { ok: false });
      });
    }

    function splitAuthor(content) {
      var at = content.indexOf("：");
      if (at < 0) at = content.indexOf(":");
      if (at > 0 && at <= 20) return { who: content.slice(0, at), body: content.slice(at + 1).trim() };
      return { who: "匿名", body: content };
    }

    function render(messages) {
      var feed = q("r-feed");
      if (!feed) return;
      var last = messages[messages.length - 1] || {};
      var sig = messages.length + "|" + (last.ts || "") + "|" + (last.content || "");
      if (sig === signature) return;
      signature = sig;
      var atBottom = rendered && feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 36;
      feed.innerHTML = "";
      if (!messages.length) {
        feed.innerHTML = '<li class="post"><p class="post__body">还没有帖子。发第一条，它只进服务端内存。</p></li>';
        rendered = true;
        return;
      }
      messages.forEach(function (msg) {
        var li = document.createElement("li");
        li.className = "post" + (msg.role === "system" ? " post--system" : "");
        var meta = document.createElement("div");
        meta.className = "post__meta";
        var who = document.createElement("span");
        who.className = "post__who";
        who.textContent = msg.role === "system" ? "房间" : (msg.role === "assistant" ? "中继" : splitAuthor(String(msg.content || "")).who);
        var time = document.createElement("span");
        time.className = "post__time";
        time.textContent = msg.ts ? new Date(Number(msg.ts) * 1000).toLocaleTimeString().slice(0, 5) : "";
        meta.appendChild(who);
        meta.appendChild(time);
        var body = document.createElement("p");
        body.className = "post__body";
        body.textContent = msg.role === "system" ? msg.content : splitAuthor(String(msg.content || "")).body;
        li.appendChild(meta);
        li.appendChild(body);
        feed.appendChild(li);
      });
      if (atBottom) feed.scrollTop = feed.scrollHeight;
      rendered = true;
    }

    function poll() {
      if (!alive || polling) return;
      polling = true;
      MD.api.relay("GET", "/v1/sessions/" + encodeURIComponent(room) + "/context?limit=80").then(function (result) {
        if (result.data.ok) { render(result.data.messages || []); return; }
        if (result.data.code === "0x010101") { signature = ""; render([]); return; }
        state(describe(result), "error");
      }).catch(function (err) {
        state("连不上：" + (err && err.message ? err.message : err), "error");
      }).then(function () { polling = false; });
    }

    function send() {
      var text = (q("r-text").value || "").trim();
      if (!text) { q("r-text").focus(); return; }
      var who = ((q("r-nick").value || "").trim() || "匿名").slice(0, 16);
      q("r-nick").value = who;
      localStorage.setItem("memoria.relay.nick", who);
      q("r-send").disabled = true;
      MD.api.relay("POST", "/v1/sessions/" + encodeURIComponent(room) + "/messages", { role: "user", content: who + "：" + text }).then(function (result) {
        if (!result.data.ok) { state("发送未通过：" + describe(result), "error"); return; }
        q("r-text").value = "";
        return poll();
      }).catch(function (err) {
        state("发送失败：" + (err && err.message ? err.message : err), "error");
      }).then(function () { q("r-send").disabled = false; });
    }

    q("r-base").textContent = MD.config.relayBase.replace(/^https?:\/\//, "");
    q("r-send").addEventListener("click", send);
    q("r-text").addEventListener("keydown", function (event) {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send(); }
    });

    return {
      element: root,
      mount: function () {
        if (alive) return;
        alive = true;
        q("r-nick").value = localStorage.getItem("memoria.relay.nick") || "";
        heartbeat();
        poll();
        timers.push(setInterval(heartbeat, 15000));
        timers.push(setInterval(function () { if (!document.hidden) poll(); }, 4000));
      },
      destroy: function () {
        alive = false;
        timers.forEach(function (timer) { clearInterval(timer); });
        timers = [];
      }
    };
  };
})(window);
