/**
 * Minimal MQTT 3.1.1 client over WebSocket for Aevum World.
 * HiveMQ public broker: wss://broker.hivemq.com:8884/mqtt
 * No external dependency; only QoS 0 state/chat messages are used.
 */
(function (root) {
  'use strict';

  function utf8(value) {
    return new TextEncoder().encode(String(value));
  }

  function concat(parts) {
    var length = 0;
    for (var i = 0; i < parts.length; i++) length += parts[i].length;
    var out = new Uint8Array(length);
    var offset = 0;
    for (var j = 0; j < parts.length; j++) {
      out.set(parts[j], offset);
      offset += parts[j].length;
    }
    return out;
  }

  function u16(value) {
    return new Uint8Array([(value >> 8) & 255, value & 255]);
  }

  function mqttString(value) {
    var bytes = utf8(value);
    return concat([u16(bytes.length), bytes]);
  }

  function remainingLength(length) {
    var out = [];
    do {
      var digit = length % 128;
      length = Math.floor(length / 128);
      if (length > 0) digit |= 128;
      out.push(digit);
    } while (length > 0);
    return new Uint8Array(out);
  }

  function packet(header, body) {
    return concat([new Uint8Array([header]), remainingLength(body.length), body]);
  }

  function readLength(bytes, offset) {
    var multiplier = 1;
    var value = 0;
    var digit;
    do {
      digit = bytes[offset++];
      value += (digit & 127) * multiplier;
      multiplier *= 128;
      if (offset >= bytes.length) return null;
    } while (digit & 128);
    return { value: value, offset: offset };
  }

  function brokerUrl(value) {
    var raw = String(value || '').trim();
    if (!raw) raw = 'broker.hivemq.com';
    if (/^wss?:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
    if (/^https?:\/\//i.test(raw)) {
      return raw.replace(/^http/i, 'ws').replace(/\/+$/, '') + '/mqtt';
    }
    if (raw.indexOf('broker.hivemq.com') >= 0) return 'wss://broker.hivemq.com:8884/mqtt';
    return 'wss://' + raw.replace(/\/+$/, '') + ':8884/mqtt';
  }

  function connect(options) {
    var broker = brokerUrl(options && options.broker);
    var room = String((options && options.room) || 'my_era').replace(/[^A-Za-z0-9_-]/g, '') || 'my_era';
    var id = String((options && options.id) || 'aevum-' + Math.random().toString(36).slice(2, 10));
    var baseTopic = 'aevum/world/v1/' + room;
    var stateTopic = baseTopic + '/state';
    var chatTopic = baseTopic + '/chat';
    var byeTopic = baseTopic + '/bye';
    var socket = null;
    var connected = false;
    var packetId = 1;
    var pingTimer = null;
    var retryTimer = null;
    var closed = false;
    var statusCb = options && options.onStatus || function () {};
    var stateCb = options && options.onState || function () {};
    var chatCb = options && options.onChat || function () {};
    var byeCb = options && options.onBye || function () {};

    function setStatus(value) {
      statusCb(value);
    }

    function send(bytes) {
      if (!socket || socket.readyState !== 1) return false;
      socket.send(bytes);
      return true;
    }

    function subscribe() {
      var topic = mqttString(baseTopic + '/#');
      var body = concat([u16((packetId++ % 65535) || 1), topic, new Uint8Array([0])]);
      send(packet(0x82, body));
      setStatus('online');
    }

    function handlePublish(bytes, offset) {
      var topicLength = (bytes[offset] << 8) | bytes[offset + 1];
      offset += 2;
      var topic = new TextDecoder('utf-8').decode(bytes.subarray(offset, offset + topicLength));
      offset += topicLength;
      var text = new TextDecoder('utf-8').decode(bytes.subarray(offset));
      var payload = null;
      try { payload = JSON.parse(text); } catch (e) { return; }
      if (topic === stateTopic) stateCb(payload);
      else if (topic === chatTopic) chatCb(payload);
      else if (topic === byeTopic) byeCb(payload);
    }

    function handlePacket(bytes) {
      var type = bytes[0] >> 4;
      if (type === 2) {
        connected = true;
        subscribe();
      } else if (type === 3) {
        var length = readLength(bytes, 1);
        if (length) handlePublish(bytes, length.offset);
      } else if (type === 13) {
        // PINGRESP
      }
    }

    function scheduleReconnect() {
      if (closed || retryTimer) return;
      retryTimer = setTimeout(function () {
        retryTimer = null;
        open();
      }, 1500);
    }

    function open() {
      if (closed) return;
      setStatus('connecting');
      try {
        socket = new WebSocket(broker, 'mqtt');
        socket.binaryType = 'arraybuffer';
      } catch (e) {
        setStatus('offline');
        scheduleReconnect();
        return;
      }
      socket.onopen = function () {
        var body = concat([
          mqttString('MQTT'),
          new Uint8Array([4, 0x06]),
          u16(60),
          mqttString(id),
          mqttString(byeTopic),
          mqttString(JSON.stringify({ id: id }))
        ]);
        send(packet(0x10, body));
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = setInterval(function () {
          if (connected) send(new Uint8Array([0xC0, 0x00]));
        }, 30000);
      };
      socket.onmessage = function (event) {
        var data = event.data;
        var bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
        handlePacket(bytes);
      };
      socket.onerror = function () { setStatus('offline'); };
      socket.onclose = function () {
        connected = false;
        setStatus('offline');
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
        scheduleReconnect();
      };
    }

    function publish(suffix, value) {
      if (!connected) return false;
      var topic = baseTopic + '/' + suffix;
      var payload = utf8(JSON.stringify(value));
      return send(packet(0x30, concat([mqttString(topic), payload])));
    }

    function close(graceful) {
      closed = true;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      if (graceful !== false && socket && socket.readyState === 1) {
        try { send(new Uint8Array([0xE0, 0x00])); } catch (e) {}
      }
      if (socket) socket.close();
      socket = null;
      connected = false;
      setStatus('offline');
    }

    open();
    return {
      publish: publish,
      close: close,
      isConnected: function () { return connected; },
      broker: broker,
      room: room
    };
  }

  root.AevumMqtt = { connect: connect, brokerUrl: brokerUrl };
})(typeof window !== 'undefined' ? window : globalThis);
