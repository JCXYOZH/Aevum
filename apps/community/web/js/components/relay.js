/* ============================================================
   relay.js —— 中继交流区（逻辑归属：本文件）
   进房心跳（在线/浏览计数）→ 轮询房间上下文 → 发帖。

   所有内容都只在服务端内存里：房间会话一过期或进程退出，帖子全部消失。
   面板不伪造成功：任何非 2xx 都原样显示 0xRRFFTT。
   ============================================================ */
(function () {
  var section = document.getElementById('relay');
  if (!section) {
    return;
  }

  /* 地址口径：
     - 本地预演时，页面可以显式给 data-base 指到 127.0.0.1:8790；
     - 线上不写死主机，直接走 nginx 同源反代 /v1/，否则浏览器会把地址指回用户自己的电脑。 */
  function resolveBase() {
    var declared = (section.getAttribute('data-base') || '').replace(/\/+$/, '');
    var pageIsLocal = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
    var targetIsLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(?::|\/|$)/.test(declared);
    if (declared && !(targetIsLocal && !pageIsLocal)) {
      return declared;
    }
    return location.origin === 'null' ? '' : location.origin;
  }

  var base = resolveBase();
  var els = {
    room: document.getElementById('relay-room'),
    online: document.getElementById('relay-online'),
    views: document.getElementById('relay-views'),
    state: document.getElementById('relay-state'),
    feed: document.getElementById('relay-feed'),
    empty: document.getElementById('relay-empty'),
    nick: document.getElementById('relay-nick'),
    text: document.getElementById('relay-text'),
    send: document.getElementById('relay-send')
  };

  var room = 'lobby';
  var client = (function () {
    var id = sessionStorage.getItem('relay.client');
    if (!id) {
      id = 'c-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      sessionStorage.setItem('relay.client', id);
    }
    return id;
  })();
  var lastSignature = '';
  var polling = false;
  var hasRendered = false;

  // ------------------------- 基础 -------------------------
  function call(method, path, body) {
    var init = {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store'
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    return fetch(base + path, init).then(function (resp) {
      return resp.text().then(function (text) {
        var data;
        try {
          data = text ? JSON.parse(text) : {};
        } catch (err) {
          data = { ok: false, raw: text.slice(0, 160) };
        }
        return { status: resp.status, data: data, contract: resp.headers.get('X-Relay-Contract') };
      });
    });
  }

  function describe(result) {
    var data = result.data || {};
    if (data.ok) {
      var ver = data.magic && data.v ? ' · ' + data.magic + '/' + data.v : '';
      return 'ok · ' + result.status + ver;
    }
    return (data.code || '?') + ' ' + (data.name || '') + ' · ' + result.status;
  }

  function setState(text, state) {
    els.state.textContent = text;
    els.state.dataset.state = state || 'idle';
  }

  function stamp(ts) {
    var d = new Date((Number(ts) || 0) * 1000);
    if (isNaN(d.getTime())) {
      return '';
    }
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  // ------------------------- 进房与计数 -------------------------
  function heartbeat() {
    return call('POST', '/v1/presence', { client: client }).then(function (result) {
      if (!result.data.ok) {
        setState(describe(result), 'error');
        return;
      }
      room = result.data.room || room;
      els.room.textContent = room;
      els.online.textContent = result.data.online;
      els.views.textContent = result.data.views;
      setState('已连接 · 契约 ' + (result.data.magic || '?') + '/' + (result.data.v || '?'), 'online');
    }).catch(function (err) {
      setState('连不上：' + (err && err.message ? err.message : err), 'error');
    });
  }

  // ------------------------- 帖子流 -------------------------
  function splitAuthor(content) {
    var at = content.indexOf('：');
    if (at < 0) {
      at = content.indexOf(':');
    }
    if (at > 0 && at <= 20) {
      return { who: content.slice(0, at), body: content.slice(at + 1).trim() };
    }
    return { who: '匿名', body: content };
  }

  function render(messages) {
    var last = messages[messages.length - 1] || {};
    var signature = messages.length + '|' + (last.ts || '') + '|' + (last.content || '');
    if (signature === lastSignature) {
      return;
    }
    lastSignature = signature;

    /* 论坛从第一条读起，不学聊天那样一进来就贴到底部；
       只有“之前已经渲染过、并且人正停在底部”时才继续跟随新帖子。 */
    var atBottom = hasRendered &&
      els.feed.scrollTop + els.feed.clientHeight >= els.feed.scrollHeight - 48;
    els.feed.textContent = '';

    messages.forEach(function (msg) {
      var li = document.createElement('li');
      var meta = document.createElement('div');
      var body = document.createElement('p');
      body.className = 'post__body';

      var isSystem = msg.role === 'system';
      li.className = 'post' + (isSystem ? ' post--system' : '');

      var who;
      if (isSystem) {
        who = '房间';
        body.textContent = msg.content;
      } else if (msg.role === 'assistant') {
        who = '中继';
        body.textContent = msg.content;
      } else {
        var parsed = splitAuthor(String(msg.content || ''));
        who = parsed.who;
        body.textContent = parsed.body;
      }

      var name = document.createElement('span');
      name.className = 'post__who';
      name.textContent = who;
      meta.appendChild(name);

      var time = document.createElement('time');
      time.className = 'post__time';
      time.textContent = stamp(msg.ts);
      meta.appendChild(time);

      li.appendChild(meta);
      li.appendChild(body);
      els.feed.appendChild(li);
    });

    els.empty.hidden = messages.length > 0;
    if (atBottom) {
      els.feed.scrollTop = els.feed.scrollHeight;
    }
    hasRendered = true;
  }

  function poll() {
    if (polling) {
      return Promise.resolve();
    }
    polling = true;
    return call('GET', '/v1/sessions/' + encodeURIComponent(room) + '/context?limit=80')
      .then(function (result) {
        if (result.data.ok) {
          render(result.data.messages || []);
          return;
        }
        if (result.data.code === '0x010101') {
          // 房间冷却到期了：下一次心跳会重新开一间，旧的帖子不回来
          lastSignature = '';
          render([]);
          els.empty.hidden = false;
          els.empty.textContent = '房间已冷却，等下一次心跳重开。';
          return;
        }
        setState(describe(result), 'error');
      })
      .catch(function (err) {
        setState('连不上：' + (err && err.message ? err.message : err), 'error');
      })
      .then(function () {
        polling = false;
      });
  }

  function send() {
    var text = els.text.value.trim();
    if (!text) {
      els.text.focus();
      return;
    }
    var who = (els.nick.value.trim() || '匿名').slice(0, 16);
    els.nick.value = who;
    localStorage.setItem('relay.nick', who);

    els.send.disabled = true;
    call('POST', '/v1/sessions/' + encodeURIComponent(room) + '/messages', {
      role: 'user',
      content: who + '：' + text
    }).then(function (result) {
      if (!result.data.ok) {
        setState('发送未通过：' + describe(result), 'error');
        return;
      }
      els.text.value = '';
      return poll();
    }).catch(function (err) {
      setState('发送失败：' + (err && err.message ? err.message : err), 'error');
    }).then(function () {
      els.send.disabled = false;
    });
  }

  // ------------------------- 启动 -------------------------
  els.send.addEventListener('click', send);
  els.text.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      send();
    }
  });

  els.nick.value = localStorage.getItem('relay.nick') || '';

  heartbeat();
  poll();
  setInterval(heartbeat, 15000);
  setInterval(function () {
    if (!document.hidden) {
      poll();
    }
  }, 3000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      heartbeat();
      poll();
    }
  });
})();
