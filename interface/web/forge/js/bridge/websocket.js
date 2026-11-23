/* WebSocket seam. This file never imports the kernel and never owns robot state. */
(function (F) {
  "use strict";

  function create(url) {
    return { ws: null, url: url, lastSend: 0, online: false };
  }

  function connect(bridge, callbacks) {
    callbacks = callbacks || {};
    if (bridge.online) return;

    try {
      const ws = new WebSocket(bridge.url);
      bridge.ws = ws;

      ws.onopen = function () {
        bridge.online = true;
        if (callbacks.onOpen) callbacks.onOpen();
      };
      ws.onclose = function () {
        bridge.online = false;
        if (callbacks.onClose) callbacks.onClose();
      };
      ws.onerror = function () {
        if (callbacks.onError) callbacks.onError();
      };
      ws.onmessage = function (event) {
        let message = null;
        try {
          message = JSON.parse(event.data);
        } catch (e) {
          return;
        }
        if (callbacks.onMessage) callbacks.onMessage(message);
      };
    } catch (e) {
      if (callbacks.onError) callbacks.onError(e);
    }
  }

  function disconnect(bridge, callbacks) {
    callbacks = callbacks || {};
    if (!bridge.ws) return;
    try {
      bridge.ws.close();
    } catch (e) {
      bridge.online = false;
      if (callbacks.onClose) callbacks.onClose();
    }
  }

  function send(bridge, packet, force) {
    if (!bridge.online || !bridge.ws || bridge.ws.readyState !== 1) return false;
    const now = performance.now();
    if (!force && now - bridge.lastSend <= 100) return false;
    bridge.lastSend = now;
    try {
      bridge.ws.send(JSON.stringify(packet));
      return true;
    } catch (e) {
      return false;
    }
  }

  F.bridge = {
    create: create,
    connect: connect,
    disconnect: disconnect,
    send: send
  };
})(window.AEVUM.FORGE);
