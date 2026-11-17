/*
 * Aevum 回路订阅窗口：只复用现有 MrHua 窗口与表单样式，不新增外观层。
 * 公开接口：POST /api/loop/subscribe、GET /api/loop/confirm、GET /api/loop/unsubscribe。
 */
(function () {
    'use strict';

    var visitSent = false;

    function $(id) {
        return document.getElementById(id);
    }

    function setResult(message, kind) {
        var el = $('loop-subscribe-result');
        if (!el) return;
        el.textContent = message || '';
        el.setAttribute('data-state', kind === 'error' ? 'error' : (kind === 'success' ? 'ok' : ''));
        el.style.color = kind === 'error'
            ? 'var(--theme-error)'
            : (kind === 'success' ? 'var(--theme-success)' : '#555');
    }

    function setBusy(busy) {
        var btn = $('loop-subscribe-submit');
        if (!btn) return;
        btn.disabled = !!busy;
        btn.textContent = busy ? '登记中…' : '登记订阅';
    }

    function validEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }

    function recordVisit() {
        if (visitSent) return;
        visitSent = true;
        // 只交域名和页面组；query、完整 URL、IP、UA 都不进库。
        fetch('/api/loop/visit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source: document.referrer || location.hostname || '',
                page_group: 'subscribe',
                page: location.pathname
            })
        }).catch(function () {});
    }

    function focus() {
        var email = $('loop-subscribe-email');
        if (!email) return;
        setTimeout(function () {
            try { email.focus(); } catch (e) {}
        }, 60);
    }

    function open() {
        // 只有 MrHua 的旧窗口需要 openWindow；3D 桌面的原生订阅面板
        // 自己就是窗口，不能再调用 openWindow('subscribe')，否则会重复开窗。
        if (document.getElementById('win-subscribe') && typeof window.openWindow === 'function') {
            window.openWindow('subscribe');
        }
        recordVisit();
        focus();
    }

    function submit(event) {
        event.preventDefault();
        var email = $('loop-subscribe-email');
        var consent = $('loop-subscribe-consent');
        var scope = $('loop-subscribe-scope');
        var value = email ? email.value.trim() : '';

        if (!validEmail(value)) {
            setResult('邮箱格式不正确，请检查后再试。', 'error');
            if (email) email.focus();
            return;
        }
        if (!consent || !consent.checked) {
            setResult('请先勾选同意，再登记订阅。', 'error');
            if (consent) consent.focus();
            return;
        }

        setBusy(true);
        setResult('正在登记…', '');
        fetch('/api/loop/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: value,
                scope: scope ? scope.value.trim() : 'release',
                page: location.pathname
            })
        }).then(function (response) {
            return response.json().catch(function () { return {}; });
        }).then(function (data) {
            if (data && data.success === false) {
                setResult((data && data.error) || '登记失败，请稍后再试。', 'error');
                return;
            }
            setResult('已登记。确认链接点开后才算正式订阅；之后只会收到这一类更新。', 'success');
            if (email) email.value = '';
            if (consent) consent.checked = false;
        }).catch(function () {
            setResult('网络暂时不可用，请稍后再试。', 'error');
        }).then(function () {
            setBusy(false);
        });
    }

    function handleToken(action, token) {
        fetch('/api/loop/' + action + '?token=' + encodeURIComponent(token), {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        }).then(function (response) {
            return response.json().catch(function () { return {}; });
        }).then(function (data) {
            if (data && data.success) {
                setResult(action === 'confirm'
                    ? '已确认订阅。之后只会收到这一类更新。'
                    : '已退订。邮箱密文和链接 token 都已清除。', 'success');
                return;
            }
            setResult((data && (data.detail || data.error)) || '链接无效或已使用过。', 'error');
        }).catch(function () {
            setResult('链接暂时无法验证，请稍后再试。', 'error');
        });
    }

    function prepareDirect() {
        // 公开订阅不经过登录门禁；直接链接也不该被身份认证窗口盖住。
        window.__identityAutoOpened = true;
        var skip = document.getElementById('gate-skip');
        if (skip) skip.click();
        var gate = document.getElementById('gateway-stage');
        if (gate) gate.style.display = 'none';
        var stage = document.getElementById('main-stage');
        if (stage) {
            stage.style.opacity = '1';
            stage.style.pointerEvents = 'auto';
        }
        try {
            if (typeof window.closeWindow === 'function') window.closeWindow('identity');
        } catch (e) {}
    }

    function init() {
        var form = $('loop-subscribe-form');
        if (!form || form.dataset.loopBound === '1') return;
        form.dataset.loopBound = '1';
        form.addEventListener('submit', submit);

        var params = new URLSearchParams(location.search);
        var confirm = params.get('loop_confirm') || params.get('confirm');
        var unsub = params.get('loop_unsub') || params.get('unsub');
        if (confirm || unsub) {
            setTimeout(function () {
                prepareDirect();
                open();
                handleToken(confirm ? 'confirm' : 'unsubscribe', confirm || unsub);
            }, 0);
        } else if (params.get('subscribe') === '1' || location.hash === '#subscribe') {
            setTimeout(function () {
                prepareDirect();
                open();
            }, 0);
        }
    }

    window.MrHuaSubscribe = { open: open, focus: focus, init: init };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
