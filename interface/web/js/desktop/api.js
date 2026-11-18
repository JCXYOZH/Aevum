/* HTTP boundary. Components never call fetch directly; this file owns paths,
   response parsing and the relay contract header. */
(function (global) {
  "use strict";
  var MD = global.MD;
  if (!MD) throw new Error("core.js must load before api.js");

  function readJSON(resp) {
    return resp.text().then(function (text) {
      var data;
      try { data = text ? JSON.parse(text) : {}; } catch (err) { data = { ok: false, raw: text.slice(0, 160) }; }
      return data;
    });
  }

  MD.api = {
    get: function (path) {
      return fetch(path, { cache: "no-store" }).then(function (resp) {
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        return resp.json();
      });
    },
    health: function () { return MD.api.get("/api/health"); },
    trainer: function () { return MD.api.get("/api/trainer"); },
    errors: function () { return MD.api.get("/api/errors"); },
    model: function () { return MD.api.get("/api/model"); },
    modelGenerate: function (body) {
      return fetch("/api/model/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(body)
      }).then(function (resp) {
        return readJSON(resp).then(function (data) {
          data.status = resp.status;
          return data;
        });
      });
    },
    relay: function (method, path, body) {
      var init = { method: method, headers: { "Content-Type": "application/json" }, cache: "no-store" };
      if (body !== undefined) init.body = JSON.stringify(body);
      return fetch(MD.config.relayBase + path, init).then(function (resp) {
        return readJSON(resp).then(function (data) {
          return {
            status: resp.status,
            data: data,
            contract: resp.headers.get("X-Relay-Contract")
          };
        });
      });
    },
    describe: function (result) {
      var data = result.data || {};
      if (data.ok) {
        var ver = data.magic && data.v ? " · " + data.magic + "/" + data.v : "";
        return "ok · " + result.status + ver;
      }
      return (data.code || "?") + " " + (data.name || "") + " · " + result.status;
    }
  };
})(window);
