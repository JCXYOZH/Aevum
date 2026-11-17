/* ============================================================
 * orb_extra.js — 灵体交互枢纽扩展（补齐 128 种交互）
 * 依赖 app.js 中的 initOrbHub（window.OrbHub / openWindow / WindowManager）
 * ============================================================ */
(function () {
    'use strict';

    const $ = id => document.getElementById(id);
    const orb = $('orb'), orbStage = $('orb-stage'), orbRing = $('orb-ring');
    function isChatOpen() { const w = $('win-chat'); return w && w.classList.contains('active'); }
    const waveform = $('orb-waveform'), dropHint = $('drop-hint');
    const ringSwitcher = $('ring-switcher');
    const orbThumbs = $('orb-thumbs'), particleCanvas = $('orb-particles');
    if (!orb || !orbStage) return;

    // 确保 window.OrbHub 存在（app.js 中的 initOrbHub 可能尚未执行）
    if (!window.OrbHub) window.OrbHub = {};

    /* ============ 工具函数 ============ */
    const rect = el => el.getBoundingClientRect();
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    function activeWindows() { return Array.from(document.querySelectorAll('.window.active')); }
    function topWindow() {
        const wins = activeWindows();
        if (!wins.length) return null;
        return wins.sort((a, b) => (parseInt(b.style.zIndex) || 1500) - (parseInt(a.style.zIndex) || 1500))[0];
    }

    /* ============ 粒子系统（GPU 友好：30fps、页面隐藏时暂停） ============ */
    const pctx = particleCanvas ? particleCanvas.getContext('2d', { alpha: true }) : null;
    let particles = [], particleRAF = null, particleMode = 'idle', particleLastFrame = 0;
    function initParticles() {
        if (!pctx) return;
        particles = [];
        for (let i = 0; i < 10; i++) {
            particles.push({
                angle: Math.random() * Math.PI * 2,
                radius: 55 + Math.random() * 25,
                speed: 0.002 + Math.random() * 0.003,
                size: 1.5 + Math.random() * 2,
                hue: 260 + Math.random() * 60,
                alpha: 0.25 + Math.random() * 0.3,
                pulse: Math.random() * Math.PI * 2
            });
        }
    }
    function drawParticles(ts) {
        if (!pctx) return;
        particleRAF = requestAnimationFrame(drawParticles);
        // 30fps 节流
        if (ts - particleLastFrame < 33) return;
        particleLastFrame = ts;
        // 页面隐藏或灵体休眠时不绘制
        if (document.hidden || orb.classList.contains('sleeping')) return;
        const w = particleCanvas.width, h = particleCanvas.height;
        pctx.clearRect(0, 0, w, h);
        const cx = w / 2, cy = h / 2;
        const speedMul = particleMode === 'thinking' ? 3 : particleMode === 'working' ? 4 : 0.8;
        particles.forEach(p => {
            p.angle += p.speed * speedMul;
            p.pulse += 0.025;
            const x = cx + Math.cos(p.angle) * p.radius;
            const y = cy + Math.sin(p.angle) * p.radius;
            const a = p.alpha * (0.6 + 0.4 * Math.sin(p.pulse));
            pctx.beginPath();
            pctx.arc(x, y, p.size, 0, Math.PI * 2);
            pctx.fillStyle = `hsla(${p.hue},70%,65%,${a})`;
            pctx.fill();
        });
    }
    function startParticles() { if (!particleRAF && pctx) { initParticles(); particleRAF = requestAnimationFrame(drawParticles); } }
    function stopParticles() { if (particleRAF) { cancelAnimationFrame(particleRAF); particleRAF = null; } }
    function setParticleMode(m) { particleMode = m; }
    // 延迟启动粒子，避免和开门动画抢 GPU
    setTimeout(startParticles, 3000);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopParticles(); else startParticles();
    });

    /* ============ 星光爆发（任务完成） ============ */
    function starBurst(count = 16) {
        for (let i = 0; i < count; i++) {
            const s = document.createElement('div');
            s.className = 'star-particle';
            s.style.left = '50%'; s.style.top = '50%';
            orb.appendChild(s);
            const angle = (i / count) * Math.PI * 2;
            const dist = 80 + Math.random() * 60;
            const dx = Math.cos(angle) * dist, dy = Math.sin(angle) * dist;
            s.animate([
                { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
                { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(0)`, opacity: 0 }
            ], { duration: 800 + Math.random() * 400, easing: 'cubic-bezier(.22,1,.36,1)' });
            setTimeout(() => s.remove(), 1200);
        }
    }

    /* ============ 1. 三击：新建会话 ============ */
    let clickCount = 0, clickTimer = null;
    orb.addEventListener('click', e => {
        clickCount++;
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => { clickCount = 0; }, 400);
        if (clickCount === 3) {
            clickCount = 0;
            e.preventDefault(); e.stopPropagation();
            newSession();
        }
    }, true);
    function newSession() {
        // 清空对话
        const chatBody = document.querySelector('#win-chat .chat-messages, #win-chat .messages, #chat-messages');
        if (chatBody) chatBody.innerHTML = '';
        fetch('/api/chat/new_session', { method: 'POST' }).catch(() => {});
        window.OrbHub.showBubble('新会话已开始');
        setTimeout(() => window.OrbHub.hideBubble(), 2000);
    }

    /* ============ 2. 长按：语音输入 ============ */
    let pressTimer = null, longPressed = false, pressStart = 0, suppressNextClick = false;
    orb.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        longPressed = false;
        pressStart = Date.now();
        pressTimer = setTimeout(() => {
            longPressed = true;
            suppressNextClick = true;
            startVoiceRecord();
        }, 500);
    });
    orb.addEventListener('mouseup', () => {
        clearTimeout(pressTimer);
        if (longPressed) { stopVoiceRecord(); longPressed = false; }
    });
    orb.addEventListener('mouseleave', () => {
        clearTimeout(pressTimer);
        if (longPressed) { stopVoiceRecord(); longPressed = false; }
    });
    // 长按松手后会触发 click，这里拦截掉
    orb.addEventListener('click', e => {
        if (suppressNextClick) { suppressNextClick = false; e.preventDefault(); e.stopPropagation(); }
    }, true);

    function startVoiceRecord() {
        if (!window.VoiceInput || !VoiceInput.supported) {
            window.OrbHub.showBubble('当前环境不支持语音录制');
            setTimeout(() => window.OrbHub.hideBubble(), 2000);
            return;
        }
        orb.classList.add('recording');
        waveform.classList.add('show');
        VoiceInput.start(function (ev) {
            if (ev.state === 'recording') {
                orb.classList.add('recording');
                waveform.classList.add('show');
            } else if (ev.state === 'processing') {
                // 保持波形
            } else if (ev.state === 'result') {
                orb.classList.remove('recording');
                waveform.classList.remove('show');
                if (ev.text) {
                    openWindow('chat');
                    setTimeout(() => {
                        const ci = document.getElementById('chat-input');
                        if (ci) { ci.value = ev.text; ci.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
                    }, 150);
                }
            } else if (ev.state === 'error') {
                orb.classList.remove('recording');
                waveform.classList.remove('show');
                console.warn('语音:', ev.error);
            }
        });
    }
    function stopVoiceRecord() {
        if (window.VoiceInput && VoiceInput.isRecording) VoiceInput.stop();
        orb.classList.remove('recording');
        waveform.classList.remove('show');
    }

    /* ============ 3. Shift+点击：截图 ============ */
    orb.addEventListener('click', e => {
        if (e.shiftKey) {
            e.preventDefault(); e.stopPropagation();
            takeScreenshot();
        }
    }, true);
    function takeScreenshot() {
        window.OrbHub.setState('working');
        if (window.pywebview && window.pywebview.api && window.pywebview.api.screenshot) {
            window.pywebview.api.screenshot().then(path => {
                window.OrbHub.setState('');
                window.OrbHub.showBubble('截图已保存：' + path);
                setTimeout(() => window.OrbHub.hideBubble(), 3000);
            }).catch(() => { window.OrbHub.setState('error'); });
        } else {
            // 降级：html2canvas 或提示
            window.OrbHub.setState('');
            window.OrbHub.showBubble('截图功能需要桌面环境支持');
            setTimeout(() => window.OrbHub.hideBubble(), 2500);
        }
    }

    /* ============ 4. Ctrl+点击：独立对话窗口 ============ */
    orb.addEventListener('click', e => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault(); e.stopPropagation();
            openIndependentChat();
        }
    }, true);
    function openIndependentChat() {
        openWindow('chat');
        const win = $('win-chat');
        if (win) {
            win.style.width = '520px';
            win.style.height = '600px';
            win.style.left = (window.innerWidth - 540) + 'px';
            win.style.top = '80px';
            if (WindowManager) WindowManager.focusWindow('chat');
        }
    }

    /* ============ 5. Alt+点击：切换灵体大小 ============ */
    orb.addEventListener('click', e => {
        if (e.altKey) {
            e.preventDefault(); e.stopPropagation();
            orb.classList.toggle('small');
            orb.classList.toggle('large');
        }
    }, true);

    /* ============ 6. 自主游走系统（灵体自己在页面里游动） ============ */
    const wander = {
        x: window.innerWidth / 2, y: window.innerHeight / 2,  // 当前位置
        tx: window.innerWidth / 2, ty: window.innerHeight / 2, // 目标位置
        vx: 0, vy: 0,           // 速度
        mode: 'idle',           // idle | wander | follow | guide | flee | return
        guideEl: null,          // 引导目标元素
        guideTimer: 0,
        nextMove: 0,            // 下次决定方向的时间
        mouseX: -9999, mouseY: -9999,
        mouseSpeed: 0, lastMouseX: 0, lastMouseY: 0, lastMouseT: 0,
        paused: false,
        attractUntil: 0,        // 吸引注意力直到此时
    };

    // 缓动函数
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    function pickWanderTarget() {
        // 选一个不被窗口占据的位置
        const margin = 100;
        let attempts = 0;
        while (attempts < 12) {
            const x = margin + Math.random() * (window.innerWidth - margin * 2);
            const y = margin + 60 + Math.random() * (window.innerHeight - margin * 2 - 80);
            if (!isPointCoveredByWindow(x, y)) {
                wander.tx = x; wander.ty = y; return;
            }
            attempts++;
        }
        // 实在没地方就去屏幕边缘
        wander.tx = margin + Math.random() * (window.innerWidth - margin * 2);
        wander.ty = window.innerHeight - 120;
    }

    function isPointCoveredByWindow(x, y) {
        const wins = activeWindows();
        for (const w of wins) {
            const r = w.getBoundingClientRect();
            if (x > r.left + 20 && x < r.right - 20 && y > r.top + 20 && y < r.bottom - 20) return true;
        }
        return false;
    }

    /* ============ 菜单栏停靠 ============ */
    let barDockState = 'auto';  // 'auto'=自动(最大化时停靠) | 'docked'=用户手动停靠 | 'released'=用户手动释放(不再自动停靠)
    let _barDocked = false;
    let _barDockAnimating = false;

    function enterBarDock(slot) {
        if (_barDocked || _barDockAnimating) return;
        const sr = slot.getBoundingClientRect();
        if (sr.width < 10) return; // 槽位还没渲染好
        _barDockAnimating = true;
        // 先平滑飞到槽位，到达后再缩小
        wander.tx = sr.left + sr.width / 2;
        wander.ty = sr.top + sr.height / 2;
        wander.mode = 'bar-dock-fly';
        wander.guideEl = null;
        wander.barDocked = false;
        wander.paused = false;
        wander._lastT = performance.now();
        const flyStart = performance.now();
        const flyDuration = 600;
        function checkArrival() {
            const elapsed = performance.now() - flyStart;
            const dx = wander.x - wander.tx, dy = wander.y - wander.ty;
            if (elapsed > flyDuration || (Math.abs(dx) < 3 && Math.abs(dy) < 3)) {
                // 到达槽位，切换到停靠状态
                _barDocked = true;
                _barDockAnimating = false;
                orb.classList.add('bar-docked');
                slot.classList.add('active');
                orbStage.style.zIndex = '10001';
                wander.x = wander.tx;
                wander.y = wander.ty;
                wander.mode = 'bar-dock';
                wander.barDocked = true;
            } else {
                requestAnimationFrame(checkArrival);
            }
        }
        requestAnimationFrame(checkArrival);
    }

    function exitBarDock() {
        if (!_barDocked && !_barDockAnimating) return;
        _barDocked = false;
        _barDockAnimating = false;
        const slot = document.getElementById('taskbar-orb-slot');
        if (slot) slot.classList.remove('active');
        orb.classList.remove('bar-docked');
        orbStage.style.zIndex = '';
        // 从槽位平滑飞回中央
        const sr = slot ? slot.getBoundingClientRect() : null;
        if (sr && sr.width > 10) {
            wander.x = sr.left + sr.width / 2;
            wander.y = sr.top + sr.height / 2;
        }
        wander.vx = 0; wander.vy = 0;
        wander.tx = window.innerWidth / 2;
        wander.ty = window.innerHeight / 2 - 40;
        wander.mode = 'guide';
        wander.guideEl = null;
        wander.barDocked = false;
        wander.paused = false;
        wander.guideTimer = performance.now() + 1200;
        wander.nextMove = performance.now() + 1500;
    }

    function hasMaximizedWindow() {
        const wins = document.querySelectorAll('.window.active:not(.minimized)');
        for (const w of wins) {
            const r = w.getBoundingClientRect();
            if (r.width > window.innerWidth * 0.85 && r.height > window.innerHeight * 0.8) return true;
        }
        return false;
    }

    function getBarDockTarget() {
        const slot = document.getElementById('taskbar-orb-slot');
        if (!slot) return null;
        // 用户手动释放后，不再自动停靠，直到用户再次手动点击停靠
        if (barDockState === 'released') return null;
        const maximized = hasMaximizedWindow();
        let shouldDock = barDockState === 'docked' || maximized;
        if (!shouldDock) return null;
        const sr = slot.getBoundingClientRect();
        if (sr.width < 10) return null;
        return { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2, slot };
    }

    function dockToBar(dock) {
        if (dock) {
            barDockState = 'docked';
            const taskbar = document.getElementById('taskbar');
            if (taskbar) taskbar.style.display = 'flex';
            // 等任务栏渲染后再飞入
            let tries = 0;
            function tryDock() {
                const target = getBarDockTarget();
                if (target) enterBarDock(target.slot);
                else if (tries++ < 10) requestAnimationFrame(tryDock);
            }
            requestAnimationFrame(tryDock);
        } else {
            barDockState = 'released';
            exitBarDock();
        }
    }
    window.OrbHub.dockToBar = dockToBar;
    window.OrbHub.isDocking = function() { return _barDocked || _barDockAnimating || barDockState === 'docked'; };

    /* ============ 伴飞模式：窗口打开时灵体缩小停靠在窗口角落 ============ */
    function getCompanionTarget() {
        const wins = document.querySelectorAll('.window.active:not(.minimized)');
        if (!wins.length) return null;
        let topWin = null, topZ = 0;
        wins.forEach(w => {
            const z = parseInt(w.style.zIndex || window.getComputedStyle(w).zIndex || '1500', 10);
            if (z >= topZ) { topZ = z; topWin = w; }
        });
        if (!topWin) return null;
        const r = topWin.getBoundingClientRect();
        if (r.width < 50 || r.height < 50) return null;
        // 停靠在窗口右侧、标题栏下方，避开关闭按钮；仍夹在视口内
        const cx = Math.max(30, Math.min(window.innerWidth - 30, r.right + 26));
        const cy = Math.max(30, Math.min(window.innerHeight - 60, r.top + 92));
        return { x: cx, y: cy, win: topWin };
    }

    // 位置缓存：只在值实际变化时才写 DOM，避免60fps重复触发扩展 MutationObserver
    let _cachedOrbX = null, _cachedOrbY = null, _cachedOrbTransform = null, _cachedOrbMargin = null;
    let _wanderLastFrameT = 0;
    function setOrbStagePos(x, y) {
        const xs = x + 'px', ys = y + 'px';
        if (_cachedOrbX !== xs) { orbStage.style.left = xs; _cachedOrbX = xs; }
        if (_cachedOrbY !== ys) { orbStage.style.top = ys; _cachedOrbY = ys; }
        if (_cachedOrbTransform !== 'translate(-50%,-50%)') { orbStage.style.transform = 'translate(-50%,-50%)'; _cachedOrbTransform = 'translate(-50%,-50%)'; }
    }
    function setOrbMarginTop(v) {
        if (_cachedOrbMargin !== v) { orb.style.marginTop = v; _cachedOrbMargin = v; }
    }

    function wanderTick(ts) {
        requestAnimationFrame(wanderTick);
        // 限速30fps + 页面隐藏时暂停，减少 rAF 回调触发扩展
        if (document.hidden) return;
        if (ts && _wanderLastFrameT && ts - _wanderLastFrameT < 33) return;
        _wanderLastFrameT = ts || performance.now();
        if (wander.paused) return;
        // 3D 模型激活时，2D 灵体完全停用（位置/停靠/引导都不执行）
        if (window.OrbSkins && window.OrbSkins._world3dActive && window.World3D && window.World3D.hasModel()) return;
        try {
        const now = ts || performance.now();

        // 菜单栏停靠：窗口最大化或用户强制时，灵体飞到菜单栏槽位（引导模式优先）
        const barDock = wander.mode === 'guide' ? null : getBarDockTarget();
        if (barDock) {
            if (!_barDocked && !_barDockAnimating && wander.mode !== 'bar-dock-fly') {
                enterBarDock(barDock.slot);
            }
            if (_barDocked) {
                // 已停靠：固定在槽位中心
                wander.x = barDock.x;
                wander.y = barDock.y;
                wander.tx = barDock.x;
                wander.ty = barDock.y;
                wander.barDocked = true;
                wander.mode = 'bar-dock';
                setOrbStagePos(wander.x, wander.y);
                if (typeof updateMinDotsPos === 'function') updateMinDotsPos();
                return;
            }
            // 飞行中：让正常移动逻辑把灵体带到 tx,ty，但跳过伴飞/避障
            if (wander.mode === 'bar-dock-fly') {
                const last = wander._lastT || now;
                const dt = Math.min((now - last) / 16.67, 3);
                wander._lastT = now;
                const dx = wander.tx - wander.x, dy = wander.ty - wander.y;
                wander.vx += dx * 0.08 * dt;
                wander.vy += dy * 0.08 * dt;
                wander.vx *= 0.82; wander.vy *= 0.82;
                wander.x += wander.vx * dt;
                wander.y += wander.vy * dt;
                setOrbStagePos(wander.x, wander.y);
                if (typeof updateMinDotsPos === 'function') updateMinDotsPos();
                return;
            }
        } else if ((_barDocked || _barDockAnimating) && barDockState !== 'docked') {
            exitBarDock();
        }
        if (_barDocked) {
            setOrbStagePos(wander.x, wander.y);
            if (typeof updateMinDotsPos === 'function') updateMinDotsPos();
            return;
        }

        // 伴飞模式：有活动窗口时缩小停靠在窗口右上角（菜单栏停靠优先）
        const companion = getCompanionTarget();
        if (companion && wander.mode !== 'guide') {
            if (!orb.classList.contains('companion')) {
                orb.classList.add('companion');
                orbStage.style.zIndex = '10001'; // 高于窗口，可见
            }
            wander.companion = true;
            wander.tx = companion.x;
            wander.ty = companion.y;
            wander.mode = 'companion';
        } else if (!companion && wander.mode === 'companion') {
            orb.classList.remove('companion');
            orbStage.style.zIndex = '';
            wander.companion = false;
            wander.mode = 'idle';
            wander.nextMove = now + 500;
        }

        const isMMD = orb.classList.contains('skin-mmd');
        const baseSize = isMMD ? 150 : 110;
        const orbsize = wander.barDocked ? (isMMD ? 28 : 24) : wander.companion ? (isMMD ? 64 : 36) : orb.classList.contains('docked') ? (isMMD ? 90 : 56) : orb.classList.contains('small') ? 72 : baseSize;
        const speed = wander.mode === 'bar-dock' ? 0.3 : wander.mode === 'magnetic' ? 0.08 : wander.mode === 'companion' ? 0.35 : wander.mode === 'flee' ? 0.15 : wander.mode === 'guide' ? 0.08 : wander.mode === 'follow' ? 0.06 : 0.04;

        // 引导模式：朝目标元素移动
        if (wander.mode === 'guide' && wander.guideEl) {
            const r = wander.guideEl.getBoundingClientRect();
            if (r.width === 0) { wander.mode = 'idle'; wander.guideEl = null; }
            else {
                wander.tx = r.left + r.width / 2;
                wander.ty = r.top - 50;
                if (now > wander.guideTimer) { wander.mode = 'idle'; wander.guideEl = null; }
            }
        } else if (wander.mode === 'guide' && !wander.guideEl && now > wander.guideTimer) {
            // 无目标元素的引导（如从停靠飞回中央）：定时器到期后回到空闲，让伴飞等逻辑接管
            wander.mode = 'idle';
        }

        // 空闲时定期选新目标（3D 模型激活时不随机漫游，站在默认位置）
        const has3DModel = window.World3D && window.World3D.hasModel();
        if (wander.mode === 'idle' && now > wander.nextMove) {
            if (has3DModel) {
                // 3D 模型：站在屏幕下方中央，不随机飞
                wander.tx = window.innerWidth / 2;
                wander.ty = window.innerHeight - 140;
                wander.nextMove = now + 30000; // 30秒内不重新选目标
            } else {
                pickWanderTarget();
                wander.nextMove = now + 3000 + Math.random() * 6000;
            }
        }

        // 鼠标反应：鼠标快速靠近时躲开（害羞），鼠标静止时慢慢靠近（好奇）
        // 伴飞/引导模式下不触发
        const dxm = wander.mouseX - wander.x, dym = wander.mouseY - wander.y;
        const distMouse = Math.sqrt(dxm * dxm + dym * dym);
        if (wander.mode !== 'guide' && wander.mode !== 'companion' && wander.mode !== 'bar-dock' && wander.mode !== 'return' && !has3DModel) {
            if (distMouse < 120 && wander.mouseSpeed > 0.5) {
                // 快速靠近 → 害羞躲开
                wander.mode = 'flee';
                wander.tx = wander.x - dxm * 2;
                wander.ty = wander.y - dym * 2;
                wander.fleeUntil = now + 600;
            } else if (wander.mode === 'flee' && now > (wander.fleeUntil || 0)) {
                wander.mode = 'idle';
            } else if (distMouse < 100 && wander.mouseSpeed < 0.3 && wander.mode === 'idle') {
                // 鼠标靠近且静止 → 磁吸：缓缓飘向鼠标，方便点击
                wander.mode = 'magnetic';
                wander.tx = wander.mouseX;
                wander.ty = wander.mouseY;
                wander.magneticUntil = now + 1500;
            } else if (wander.mode === 'magnetic') {
                // 持续追踪鼠标位置
                wander.tx = wander.mouseX;
                wander.ty = wander.mouseY;
                if (now > (wander.magneticUntil || 0) || distMouse > 150 || wander.mouseSpeed > 0.8) {
                    wander.mode = 'idle';
                }
            } else if (distMouse < 300 && distMouse > 80 && wander.mouseSpeed < 0.15 && Math.random() < 0.002) {
                // 偶尔好奇地靠近鼠标
                wander.mode = 'follow';
                wander.tx = wander.mouseX + (Math.random() - 0.5) * 100;
                wander.ty = wander.mouseY + 60 + Math.random() * 40;
                wander.followUntil = now + 2000;
            } else if (wander.mode === 'follow' && now > (wander.followUntil || 0)) {
                wander.mode = 'idle';
            }
        }

        // 吸引注意力时在原地跳动（不影响引导/伴飞/停靠模式）
        if (now < wander.attractUntil && wander.mode !== 'guide' && wander.mode !== 'companion' && wander.mode !== 'bar-dock' && wander.mode !== 'bar-dock-fly') {
            const t = (wander.attractUntil - now) / 1000;
            wander.tx = wander.x; wander.ty = wander.y;
            setOrbMarginTop(Math.sin(now / 80) * 8 + 'px');
        } else {
            setOrbMarginTop('');
        }

        // 空气墙：边界余量
        const pad = orbsize / 2 + 16;
        const taskbarH = document.getElementById('taskbar') && document.getElementById('taskbar').style.display !== 'none' ? 52 : 16;
        const minX = pad, maxX = window.innerWidth - pad;
        const minY = pad, maxY = window.innerHeight - taskbarH;

        // 先把目标夹在空气墙内，避免朝屏幕外使劲
        wander.tx = Math.max(minX, Math.min(maxX, wander.tx));
        wander.ty = Math.max(minY, Math.min(maxY, wander.ty));

        // 平滑移动
        const dx = wander.tx - wander.x, dy = wander.ty - wander.y;
        wander.vx = wander.vx * 0.85 + dx * speed * 0.15;
        wander.vy = wander.vy * 0.85 + dy * speed * 0.15;
        wander.x += wander.vx;
        wander.y += wander.vy;

        // 空气墙：碰到边界时速度归零，不硬拉
        if (wander.x < minX) { wander.x = minX; wander.vx = Math.abs(wander.vx) * 0.3; }
        if (wander.x > maxX) { wander.x = maxX; wander.vx = -Math.abs(wander.vx) * 0.3; }
        if (wander.y < minY) { wander.y = minY; wander.vy = Math.abs(wander.vy) * 0.3; }
        if (wander.y > maxY) { wander.y = maxY; wander.vy = -Math.abs(wander.vy) * 0.3; }

        // 避开窗口（伴飞/菜单栏停靠模式下不躲避）
        if (wander.mode !== 'companion' && wander.mode !== 'bar-dock') {
            const wins = activeWindows();
            for (const w of wins) {
                const r = w.getBoundingClientRect();
                if (wander.x > r.left - orbsize/2 && wander.x < r.right + orbsize/2 &&
                    wander.y > r.top - orbsize/2 && wander.y < r.bottom + orbsize/2) {
                    const overlapL = wander.x - (r.left - orbsize/2);
                    const overlapR = (r.right + orbsize/2) - wander.x;
                    const overlapT = wander.y - (r.top - orbsize/2);
                    const overlapB = (r.bottom + orbsize/2) - wander.y;
                    const minO = Math.min(overlapL, overlapR, overlapT, overlapB);
                    if (minO === overlapL) wander.x = r.left - orbsize/2 - 5;
                    else if (minO === overlapR) wander.x = r.right + orbsize/2 + 5;
                    else if (minO === overlapT) wander.y = r.top - orbsize/2 - 5;
                    else wander.y = r.bottom + orbsize/2 + 5;
                    wander.vx *= -0.5; wander.vy *= -0.5;
                }
            }
        }

        // 避窗后再次夹在空气墙内
        wander.x = Math.max(minX, Math.min(maxX, wander.x));
        wander.y = Math.max(minY, Math.min(maxY, wander.y));

        // 应用位置（直接控制 stage，同步位置给其他模块读取）
        setOrbStagePos(wander.x, wander.y);
        if (window._orbPos) { window._orbPos.x = wander.x; window._orbPos.y = wander.y; }
        if (typeof updateMinDotsPos === 'function') updateMinDotsPos();
        // 把运动速度传给 MMD 模型，驱动飞行动作
        if (window.orbSkins && typeof window.orbSkins.setMotion === 'function') {
            const spd = Math.sqrt(wander.vx * wander.vx + wander.vy * wander.vy);
            window.orbSkins.setMotion(wander.vx, wander.vy, spd);
        }
        } catch(err) {
            // 任何异常都不允许卡死灵体：下一帧继续，重置为安全状态
            console.warn('wanderTick error:', err);
            wander.mode = 'idle';
            wander.vx = 0; wander.vy = 0;
            wander.guideEl = null;
            try {
                setOrbStagePos(wander.x, wander.y);
            } catch(e2) {}
        }
    }

    // 鼠标追踪
    document.addEventListener('mousemove', e => {
        const now = performance.now();
        const dt = now - wander.lastMouseT;
        if (dt > 0) {
            const mdx = e.clientX - wander.lastMouseX, mdy = e.clientY - wander.lastMouseY;
            wander.mouseSpeed = Math.min(Math.sqrt(mdx*mdx + mdy*mdy) / dt, 3);
        }
        wander.mouseX = e.clientX; wander.mouseY = e.clientY;
        wander.lastMouseX = e.clientX; wander.lastMouseY = e.clientY;
        wander.lastMouseT = now;
    }, { passive: true });

    // 窗口大小变化
    window.addEventListener('resize', () => {
        wander.x = Math.min(wander.x, window.innerWidth - 80);
        wander.y = Math.min(wander.y, window.innerHeight - 80);
    });

    // 启动游走（开门动画结束后）
    setTimeout(() => {
        // 安全检查：确保 orb-stage 在 body 下（防止热重载残留）
        if (orbStage && orbStage.parentNode !== document.body) {
            document.body.appendChild(orbStage);
            orbStage.classList.remove('bar-slot-mode');
            orb.classList.remove('bar-docked');
        }
        _barDocked = false;
        wander.nextMove = performance.now() + 800;
        requestAnimationFrame(wanderTick);
    }, 1800);

    /* ============ 7. AI 控制灵体（无言引导） ============ */
    // 引导灵体到某个元素/位置，吸引用户注意
    function guideTo(target, opts = {}) {
        const duration = opts.duration || 4000;
        // 3D 模型激活时：不移动位置，只让模型看一眼窗口
        if (window.World3D && window.World3D.hasModel()) {
            let el = null;
            if (typeof target === 'string') el = document.querySelector(target);
            else if (target && target.getBoundingClientRect) el = target;
            if (el && window.World3D.glanceAtElement) window.World3D.glanceAtElement(el, duration);
            return;
        }
        // 引导优先：取消菜单栏停靠，避免 dock 逻辑拦截移动
        if (_barDocked || _barDockAnimating) {
            barDockState = 'released';
            exitBarDock();
        }
        // 引导期间退出伴飞
        if (orb.classList.contains('companion')) {
            orb.classList.remove('companion');
            orbStage.style.zIndex = '';
            wander.companion = false;
        }
        if (typeof target === 'string') {
            const el = document.querySelector(target);
            if (!el) return;
            wander.guideEl = el;
        } else if (target && target.getBoundingClientRect) {
            wander.guideEl = target;
        } else if (target && typeof target === 'object') {
            wander.guideEl = null;
            wander.tx = target.x; wander.ty = target.y;
        }
        wander.mode = 'guide';
        wander.guideTimer = performance.now() + duration;
        // 灵体发光脉冲吸引注意
        orb.animate([
            { boxShadow: '0 0 40px rgba(255,193,7,0.3)' },
            { boxShadow: '0 0 80px rgba(255,193,7,0.7), 0 0 140px rgba(255,193,7,0.3)' },
            { boxShadow: '0 0 40px rgba(255,193,7,0.3)' }
        ], { duration: 1200, iterations: 3 });
    }

    // 吸引注意力（原地跳动+发光）
    function attract(duration = 2000) {
        wander.attractUntil = performance.now() + duration;
        orb.animate([
            { transform: 'scale(1)' },
            { transform: 'scale(1.15)' },
            { transform: 'scale(1)' }
        ], { duration: 600, iterations: 3 });
        try { if (window.ModelAction && window.ModelAction.getType()) { window.ModelAction.blink(); } } catch(e) {}
    }

    // 灵体"看向"某个方向（微微倾斜）
    function lookAt(x, y) {
        const dx = x - wander.x, dy = y - wander.y;
        const angle = Math.atan2(dy, dx) * 0.1;
        orb.style.transform = `rotate(${angle}rad)`;
        setTimeout(() => { orb.style.transform = ''; }, 1500);
        try { if (window.ModelAction && window.ModelAction.getType()) { window.ModelAction.lookAt((x/window.innerWidth)*2-1, (y/window.innerHeight)*2-1); } } catch(e) {}
    }

    // 灵体"点头"（对用户操作的回应）
    function nod() {
        orb.animate([
            { transform: 'translateY(0)' },
            { transform: 'translateY(8px) scaleY(0.92)' },
            { transform: 'translateY(-4px) scaleY(1.02)' },
            { transform: 'translateY(0)' }
        ], { duration: 500 });
        try { if (window.ModelAction && window.ModelAction.getType()) { window.ModelAction.nod(); } } catch(e) {}
    }

    // 灵体"摇头"
    function shake() {
        orb.animate([
            { transform: 'translateX(0)' },
            { transform: 'translateX(-8px)' },
            { transform: 'translateX(8px)' },
            { transform: 'translateX(-4px)' },
            { transform: 'translateX(0)' }
        ], { duration: 500 });
        try { if (window.ModelAction && window.ModelAction.getType()) { window.ModelAction.shake(); } } catch(e) {}
    }

    // 开心地蹦跳
    function happyBounce() {
        starBurst(12);
        orb.animate([
            { transform: 'translateY(0) scale(1)' },
            { transform: 'translateY(-20px) scale(1.1)' },
            { transform: 'translateY(0) scale(0.95)' },
            { transform: 'translateY(-8px) scale(1.03)' },
            { transform: 'translateY(0) scale(1)' }
        ], { duration: 700 });
        try { if (window.ModelAction && window.ModelAction.getType()) { window.ModelAction.setEmotion('happy'); window.ModelAction.wave('right'); } } catch(e) {}
    }

    // 脉冲：单次光圈扩散
    function pulse(color) {
        const c = color || 'rgba(106,76,147,0.6)';
        orbRing.style.background = `radial-gradient(circle, ${c} 0%, transparent 70%)`;
        orbRing.classList.add('show', 'notification');
        setTimeout(() => orbRing.classList.remove('notification'), 800);
        setTimeout(() => { orbRing.classList.remove('show'); orbRing.style.background = ''; }, 1200);
    }
    // 发光：持续发光一段时间
    function glow(color, duration) {
        const c = color || 'rgba(106,76,147,0.5)';
        const prev = orb.style.boxShadow;
        orb.style.boxShadow = `0 0 60px ${c}, 0 0 120px ${c}`;
        orb.style.transition = 'box-shadow 0.4s';
        setTimeout(() => { orb.style.boxShadow = prev; orb.style.transition = ''; }, duration || 2000);
    }

    window.OrbHub.wander = wander;
    window.OrbHub.guideTo = guideTo;
    window.OrbHub.attract = attract;
    window.OrbHub.lookAt = lookAt;
    window.OrbHub.nod = nod;
    window.OrbHub.shake = shake;
    window.OrbHub.happyBounce = happyBounce;
    window.OrbHub.pulse = pulse;
    window.OrbHub.glow = glow;
    window.OrbHub.pauseWander = () => { wander.paused = true; };
    window.OrbHub.resumeWander = () => { wander.paused = false; };
    window.OrbHub.executeCommand = executeOrbCommand;

    // 模型/后端打开了窗口：立即清除思考状态，给一个完成反馈，让伴飞模式接管
    window.OrbHub.modelOpenedWindow = function(winId) {
        // 清除思考/扫描状态
        window.OrbHub.setState('');
        window.OrbHub.setProgress(false);
        setParticleMode('idle');
        // 短暂完成反馈
        happyBounce();
        pulse('rgba(46,204,113,0.5)');
        // 伴飞模式会在 wanderTick 中自动检测到活动窗口并接管
    };

    /* ============ 7b. 后端指令轮询（AI 可远程操控灵体） ============ */
    function pollOrbCommands() {
        fetch('/api/orb/commands').then(r => r.json()).then(data => {
            (data.commands || []).forEach(cmd => executeOrbCommand(cmd));
        }).catch(() => {});
    }
    function executeOrbCommand(cmd) {
        if (!cmd || !cmd.action) return;
        // emote 子类型统一取 emote 字段；cmd.type 兼容历史指令
        // （旧格式把子类型放在 type 上，会和 SSE 信封的 type 撞名）。
        const _emote = cmd.emote || cmd.type;
        try {
        // 防抖：同一窗口 1 秒内不重复 open
        if (cmd.action === 'open' && cmd.target) {
            const now = Date.now();
            if (window._lastOrbOpen && window._lastOrbOpen[cmd.target] && now - window._lastOrbOpen[cmd.target] < 1000) return;
            window._lastOrbOpen = window._lastOrbOpen || {};
            window._lastOrbOpen[cmd.target] = now;
        }
        switch (cmd.action) {
            case 'open':
                // 打开窗口并引导灵体飞过去（已打开则只聚焦，不重复初始化）
                if (cmd.target && typeof openWindow === 'function') {
                    const existing = document.getElementById('win-' + cmd.target);
                    if (existing && existing.classList.contains('active') && !existing.classList.contains('minimized')) {
                        // 窗口已打开：只聚焦+引导，不重复触发 openWindow
                        if (window.WindowManager) window.WindowManager.focusWindow(cmd.target);
                    } else {
                        openWindow(cmd.target);
                    }
                    // 窗口已打开：立即清除思考状态，给完成反馈
                    if (window.OrbHub.modelOpenedWindow) window.OrbHub.modelOpenedWindow(cmd.target);
                    setTimeout(() => {
                        const el = document.getElementById('win-' + cmd.target);
                        if (el) guideTo(el, { duration: 2000 });
                    }, 300);
                }
                break;
            case 'guide':
                if (cmd.target && typeof cmd.target === 'string') {
                    // 窗口 ID 自动转为选择器
                    const sel = cmd.target.startsWith('#') || cmd.target.startsWith('.') || cmd.target.startsWith('[')
                        ? cmd.target : '#win-' + cmd.target;
                    guideTo(sel, { duration: cmd.duration });
                } else if (cmd.target && typeof cmd.target === 'object') guideTo(cmd.target, { duration: cmd.duration });
                else if (cmd.x != null && cmd.y != null) guideTo({ x: cmd.x, y: cmd.y }, { duration: cmd.duration });
                break;
            case 'attract': attract(cmd.duration || 2000); break;
            case 'move':
                if (cmd.x != null && cmd.y != null) {
                    wander.mode = 'guide'; wander.guideEl = null;
                    wander.tx = cmd.x; wander.ty = cmd.y;
                    wander.guideTimer = performance.now() + (cmd.duration || 3000);
                }
                break;
            case 'emote':
                if (_emote === 'nod') nod();
                else if (_emote === 'shake') shake();
                else if (_emote === 'happy') happyBounce();
                else if (_emote === 'look' && cmd.x != null) lookAt(cmd.x, cmd.y || wander.y);
                else if (_emote === 'pulse') pulse();
                else if (_emote === 'glow') glow(cmd.color);
                else if (_emote === 'wiggle') nudge();
                else if (_emote === 'sleep') { wander.paused = true; orb.classList.add('sleeping'); }
                else if (_emote === 'wake') { wander.paused = false; orb.classList.remove('sleeping'); }
                else if (_emote === 'finding' && window.OrbHub.finding) window.OrbHub.finding(cmd.severity || 'info');
                break;
            case 'state':
                window.OrbHub.setState(cmd.state || '');
                if (cmd.state === 'success') happyBounce();
                if (cmd.state === 'error') shake();
                if (cmd.state === 'alert') attract(2000);
                break;
            case 'react':
                orbReact(cmd.type, cmd);
                break;
            case 'companion':
                // 显式控制伴飞模式
                if (cmd.enabled === false) { orb.classList.remove('companion'); wander.companion = false; }
                break;
            case 'skin':
                if (window.OrbSkins && cmd.skin) {
                    window.OrbSkins.apply(cmd.skin);
                    if (window.OrbSkins.renderSelector) window.OrbSkins.renderSelector();
                    happyBounce();
                }
                break;
        }
        } catch (e) {
            // 灵体动作是纯装饰：任何异常都不能冒泡到调用方
            // （SSE 分支里冒泡会把整轮对话当成"连接中断"结束）。
            console.warn('[orb] 执行指令失败:', cmd && cmd.action, e);
        }
    }
    setInterval(pollOrbCommands, 2000);

    /* ============ 7c. 前端意图指令执行器 ============ */
    function executeIntentCommands(cmds) {
        if (!cmds || !cmds.length) return;
        cmds.forEach(cmd => {
            try {
                switch (cmd.action) {
                    case 'open_window':
                        // 已打开则只聚焦，不重复初始化
                        const _ew = document.getElementById('win-' + cmd.window);
                        if (_ew && _ew.classList.contains('active') && !_ew.classList.contains('minimized')) {
                            if (window.WindowManager) window.WindowManager.focusWindow(cmd.window);
                        } else {
                            openWindow(cmd.window);
                        }
                        // 窗口已打开：立即清除思考状态
                        if (window.OrbHub.modelOpenedWindow) window.OrbHub.modelOpenedWindow(cmd.window);
                        setTimeout(() => {
                            const el = document.getElementById('win-' + cmd.window);
                            if (el) guideTo(el, { duration: 2500 });
                        }, 400);
                        break;
                    case 'set_theme':
                        document.body.setAttribute('data-theme', cmd.theme);
                        localStorage.setItem('mrhua_theme', cmd.theme);
                        if (cmd.theme === 'dark') document.body.style.background = '#1a1a2e';
                        else document.body.style.background = '';
                        break;
                    case 'set_setting':
                        localStorage.setItem('mrhua_set_' + cmd.key, JSON.stringify(cmd.value));
                        if (cmd.key === 'reduce_motion') {
                            document.body.classList.toggle('reduce-motion', !!cmd.value);
                        }
                        break;
                    case 'orb_emote':
                        if (cmd.type === 'happy') happyBounce();
                        else if (cmd.type === 'shake') shake();
                        else if (cmd.type === 'nod') nod();
                        else if (cmd.type === 'attract') attract(2000);
                        else if (cmd.type === 'pulse') pulse();
                        else if (cmd.type === 'glow') glow();
                        else if (cmd.type === 'wiggle') nudge();
                        else if (cmd.type === 'sleep') { wander.paused = true; orb.classList.add('sleeping'); }
                        else if (cmd.type === 'wake') { wander.paused = false; orb.classList.remove('sleeping'); }
                        break;
                    case 'orb_state':
                        window.OrbHub.setState(cmd.state || '');
                        break;
                    case 'orb_react':
                        orbReact(cmd.type, cmd);
                        break;
                    case 'orb_guide': {
                        const el = document.getElementById('win-' + cmd.window);
                        if (el) guideTo(el, { duration: 4000 });
                        else openWindow(cmd.window);
                        break;
                    }
                    case 'orb_skin':
                        if (window.OrbSkins) {
                            window.OrbSkins.apply(cmd.skin);
                            window.OrbSkins.renderSelector();
                            happyBounce();
                        }
                        break;
                    case 'orb_skin_editor':
                        if (window.OrbSkins) window.OrbSkins.openCustomizer();
                        break;
                    case 'orb_skin_import':
                        if (window.OrbSkins) window.OrbSkins.openImport();
                        break;
                }
            } catch (e) { console.warn('intent cmd error:', e); }
        });
    }
    window.executeIntentCommands = executeIntentCommands;

    // 拦截用户发送的消息，先做意图识别
    function interceptIntent(text) {
        if (!text) return;
        fetch('/api/intent/parse', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        }).then(r => r.json()).then(d => {
            if (d.success && d.commands && d.commands.length) {
                setTimeout(() => executeIntentCommands(d.commands), 100);
            }
        }).catch(() => {});
    }
    // 钩住聊天发送按钮
    setTimeout(() => {
        const sendBtn = document.getElementById('chat-send');
        if (sendBtn) {
            sendBtn.addEventListener('click', () => {
                const ci = document.getElementById('chat-input');
                if (ci) interceptIntent(ci.value.trim());
            }, true);
        }
        const ci = document.getElementById('chat-input');
        if (ci) {
            ci.addEventListener('keydown', e => {
                if (e.key === 'Enter' && !e.shiftKey) interceptIntent(ci.value.trim());
            }, true);
        }
    }, 1000);

    // 启动时恢复主题
    try {
        const savedTheme = localStorage.getItem('mrhua_theme');
        if (savedTheme) document.body.setAttribute('data-theme', savedTheme);
        const savedMotion = JSON.parse(localStorage.getItem('mrhua_set_reduce_motion') || 'false');
        if (savedMotion) document.body.classList.add('reduce-motion');
    } catch (e) {}

    /* ============ 8. 拖窗口到灵体最小化 ============ */
    document.addEventListener('dragstart', e => {
        const win = e.target && e.target.closest ? e.target.closest('.window') : null;
        if (win) win.dataset.dragging = 'true';
    });
    document.addEventListener('dragend', e => {
        const win = e.target && e.target.closest ? e.target.closest('.window') : null;
        if (win && win.dataset.dragging === 'true') {
            win.dataset.dragging = 'false';
            const or = rect(orb);
            if (e.clientX > or.left && e.clientX < or.right && e.clientY > or.top && e.clientY < or.bottom) {
                const id = win.id.replace('win-', '');
                if (WindowManager) WindowManager.minimizeWindow(id);
            }
        }
    });

    /* ============ 9. 鼠标悬停光效（CSS 驱动，不额外创建粒子） ============ */
    orb.addEventListener('mousemove', e => {
        const or = rect(orb);
        const mx = ((e.clientX - or.left) / or.width - 0.5) * 20;
        const my = ((e.clientY - or.top) / or.height - 0.5) * 20;
        orb.style.transform = `translate(${mx}px, ${my}px)`;
    });
    orb.addEventListener('mouseleave', () => { orb.style.transform = ''; });

    /* ============ 10. 窗口缩略图环绕 ============ */
    function renderOrbThumbs() {
        if (!orbThumbs) return;
        orbThumbs.innerHTML = '';
        const wins = activeWindows().slice(0, 8);
        const tools = window.OrbHub ? window.OrbHub.tools : [];
        // 根据灵体位置自适应半径，避免缩略图超出屏幕
        const cx = wander.x, cy = wander.y;
        const margin = 50;
        const maxR = Math.min(130, cx - margin, cy - margin - 60, window.innerWidth - cx - margin, window.innerHeight - cy - margin);
        const r = Math.max(60, maxR);
        wins.forEach((w, i) => {
            const id = w.id.replace('win-', '');
            const tool = tools.find(t => t.id === id);
            const angle = -Math.PI / 2 + (i - (wins.length - 1) / 2) * 0.55;
            const el = document.createElement('div');
            el.className = 'orb-thumb';
            el.textContent = tool ? tool.icon : '🗔';
            el.style.left = `calc(50% + ${Math.cos(angle) * r}px)`;
            el.style.top = `calc(50% + ${Math.sin(angle) * r}px)`;
            el.onclick = () => { if (WindowManager) WindowManager.focusWindow(id); };
            orbThumbs.appendChild(el);
            requestAnimationFrame(() => el.classList.add('show'));
        });
    }
    document.addEventListener('window-opened', renderOrbThumbs);
    document.addEventListener('window-closed', renderOrbThumbs);
    setInterval(() => {
        if (orbStage.classList.contains('show')) renderOrbThumbs();
    }, 2000);

    /* ============ 13. 拖放提示增强 ============ */
    document.addEventListener('dragenter', e => {
        if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
            dropHint.classList.add('show');
        }
    });
    document.addEventListener('dragleave', e => {
        if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
            dropHint.classList.remove('show');
        }
    });
    document.addEventListener('drop', () => dropHint.classList.remove('show'));

    /* ============ 14. 环形窗口切换器（Alt+Tab） ============ */
    let ringItems = [], ringIdx = 0, ringActive = false;
    function showRingSwitcher() {
        const wins = activeWindows();
        if (!wins.length) return;
        ringSwitcher.innerHTML = '';
        ringItems = wins;
        ringIdx = 0;
        const tools = window.OrbHub ? window.OrbHub.tools : [];
        const R = 140;
        wins.forEach((w, i) => {
            const id = w.id.replace('win-', '');
            const tool = tools.find(t => t.id === id);
            const angle = (i / wins.length) * Math.PI * 2 - Math.PI / 2;
            const el = document.createElement('div');
            el.className = 'ring-switch-item' + (i === 0 ? ' active' : '');
            el.textContent = tool ? tool.icon : '🗔';
            
            el.style.left = `calc(50% + ${Math.cos(angle) * R}px)`;
            el.style.top = `calc(50% + ${Math.sin(angle) * R}px)`;
            ringSwitcher.appendChild(el);
        });
        ringSwitcher.classList.add('show');
        ringActive = true;
    }
    function advanceRing(dir) {
        if (!ringActive) return;
        ringIdx = (ringIdx + dir + ringItems.length) % ringItems.length;
        ringSwitcher.querySelectorAll('.ring-switch-item').forEach((el, i) => {
            el.classList.toggle('active', i === ringIdx);
        });
    }
    function hideRingSwitcher() {
        ringSwitcher.classList.remove('show');
        if (ringActive && ringItems[ringIdx] && WindowManager) {
            WindowManager.focusWindow(ringItems[ringIdx].id.replace('win-', ''));
        }
        ringActive = false;
    }

    /* ============ 19. 键盘快捷键补齐 ============ */
    document.addEventListener('keydown', e => {
        const tag = (e.target.tagName || '').toLowerCase();
        const isInput = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
        const ctrl = e.ctrlKey || e.metaKey;

        // Alt+Tab 环形切换
        if (e.altKey && (e.key === 'Tab' || e.key === '`')) {
            e.preventDefault();
            if (!ringActive) showRingSwitcher();
            else advanceRing(e.shiftKey ? -1 : 1);
            return;
        }

        // Ctrl+1~9 切换窗口
        if (ctrl && /^[1-9]$/.test(e.key)) {
            e.preventDefault();
            const wins = activeWindows();
            const idx = parseInt(e.key) - 1;
            if (wins[idx] && WindowManager) WindowManager.focusWindow(wins[idx].id.replace('win-', ''));
            return;
        }

        // Ctrl+L 聚焦输入框
        if (ctrl && e.key === 'l') { e.preventDefault(); window.OrbHub.openChat(); return; }

        // Ctrl+F 搜索
        if (ctrl && e.key === 'f') { e.preventDefault(); openWindow('search'); return; }
        // Ctrl+C/V 在非输入区不拦截
        // Ctrl+` 切换灵体大小
        if (ctrl && e.key === '`') { e.preventDefault(); orb.classList.toggle('small'); return; }
        // Shift+A 打开关于/状态
        if (e.shiftKey && (e.key === 'A' || e.key === 'a') && !isInput) { e.preventDefault(); openWindow('status'); return; }
        // F11 全屏
        if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); return; }
        // PageUp/Down 切换窗口
        if ((e.key === 'PageUp' || e.key === 'PageDown') && !isInput) {
            e.preventDefault();
            const wins = activeWindows();
            if (wins.length > 1) {
                const top = topWindow(), idx = wins.indexOf(top);
                const next = e.key === 'PageDown' ? wins[(idx + 1) % wins.length] : wins[(idx - 1 + wins.length) % wins.length];
                if (next && WindowManager) WindowManager.focusWindow(next.id.replace('win-', ''));
            }
            return;
        }
        // Tab 循环窗口（非输入区）
        if (e.key === 'Tab' && !isInput && !ctrl && !e.altKey) {
            e.preventDefault();
            const wins = activeWindows();
            if (wins.length > 1) {
                const top = topWindow(), idx = wins.indexOf(top);
                const next = e.shiftKey ? wins[(idx - 1 + wins.length) % wins.length] : wins[(idx + 1) % wins.length];
                if (next && WindowManager) WindowManager.focusWindow(next.id.replace('win-', ''));
            }
            return;
        }
        // 空格长按说话（非输入区）
        if (e.key === ' ' && !isInput && !ctrl && !e.altKey) {
            e.preventDefault();
            if (!e.repeat) startVoiceRecord();
            return;
        }
    });
    document.addEventListener('keyup', e => {
        if (e.key === ' ' && !e.target.isContentEditable && (e.target.tagName || '').toLowerCase() !== 'input') {
            if (window.VoiceInput && VoiceInput.isRecording) stopVoiceRecord();
        }
        if (e.key === 'Alt' && ringActive) hideRingSwitcher();
    });

    function toggleFullscreen() {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
        else document.exitFullscreen().catch(() => {});
    }

    /* ============ 20. 灵体状态联动（监听后端事件） ============ */
    // 监听工具调用进度
    document.addEventListener('tool-progress', e => {
        const { tool, progress, status } = e.detail || {};
        if (status === 'start') {
            window.OrbHub.setState('working');
            window.OrbHub.setProgress(true);
            setParticleMode('working');
        } else if (status === 'end') {
            window.OrbHub.setState('success');
            window.OrbHub.setProgress(false);
            setParticleMode('idle');
            starBurst(12);
            setTimeout(() => window.OrbHub.setState(''), 1000);
        } else if (typeof progress === 'number') {
            // 可扩展：进度百分比
        }
    });
    // 监听AI思考
    document.addEventListener('ai-thinking', () => {
        window.OrbHub.setState('thinking');
        setParticleMode('thinking');
    });
    document.addEventListener('ai-reply', () => {
        window.OrbHub.setState('speaking');
        setParticleMode('idle');
        setTimeout(() => window.OrbHub.setState(''), 800);
    });
    document.addEventListener('ai-error', () => {
        window.OrbHub.setState('error');
        setParticleMode('idle');
        setTimeout(() => window.OrbHub.setState(''), 1500);
    });

    /* ============ 21b. 统一事件反应系统 ============ */
    // 任何模块都可以 dispatchEvent(new CustomEvent('orb-react', {detail:{type:'scan',state:'scanning'}}))
    // 也可以用快捷事件名：orb-scan, orb-install, orb-download, orb-upload, orb-complete,
    // orb-disconnect, orb-reconnect, orb-wait, orb-alert, orb-pulse, orb-glow
    const REACT_MAP = {
        scan:       { state: 'scanning',    particle: 'working', duration: 0 },
        install:    { state: 'installing',  particle: 'working', duration: 0 },
        download:   { state: 'downloading', particle: 'working', duration: 0 },
        upload:     { state: 'uploading',   particle: 'working', duration: 0 },
        waiting:    { state: 'waiting',     particle: 'idle',    duration: 0 },
        complete:   { state: 'complete',    particle: 'idle',    duration: 1200, emote: 'happy' },
        success:    { state: 'success',     particle: 'idle',    duration: 1200, emote: 'happy' },
        error:      { state: 'error',       particle: 'idle',    duration: 1500, emote: 'shake' },
        alert:      { state: 'alert',       particle: 'idle',    duration: 0,    emote: 'attract' },
        disconnect: { state: 'disconnected',particle: 'idle',    duration: 0 },
        reconnect:  { state: '',            particle: 'idle',    duration: 800,  emote: 'happy' },
        thinking:   { state: 'thinking',    particle: 'thinking',duration: 0 },
        speaking:   { state: 'speaking',    particle: 'idle',    duration: 800 },
        recording:  { state: 'recording',   particle: 'working', duration: 0 },
        listening:  { state: 'listening',   particle: 'idle',    duration: 0 },
    };
    // 发现结果反应：按严重程度发光
    const FINDING_COLORS = {
        info:     'rgba(52,152,219,0.6)',
        low:      'rgba(46,204,113,0.6)',
        medium:   'rgba(241,196,15,0.7)',
        high:     'rgba(230,126,34,0.75)',
        critical: 'rgba(231,76,60,0.8)',
    };
    function orbFinding(severity, message) {
        const color = FINDING_COLORS[severity] || FINDING_COLORS.info;
        pulse(color);
        glow(color, 1500);
        if (severity === 'critical' || severity === 'high') {
            shake();
        } else if (severity === 'medium') {
            nudge();
        }
        // 粒子爆发
        starBurst(severity === 'critical' ? 20 : 10);
    }
    window.OrbHub.finding = orbFinding;
    let _reactTimer = null;
    function orbReact(type, opts) {
        opts = opts || {};
        const cfg = REACT_MAP[type] || {};
        const state = opts.state || cfg.state;
        const dur = opts.duration != null ? opts.duration : cfg.duration;
        if (state != null) window.OrbHub.setState(state);
        if (cfg.particle) setParticleMode(cfg.particle);
        if (cfg.emote === 'happy') happyBounce();
        else if (cfg.emote === 'shake') shake();
        else if (cfg.emote === 'attract') attract(2000);
        if (dur > 0) {
            clearTimeout(_reactTimer);
            _reactTimer = setTimeout(() => {
                window.OrbHub.setState('');
                setParticleMode('idle');
            }, dur);
        }
    }
    window.OrbHub.react = orbReact;
    document.addEventListener('orb-react', e => orbReact(e.detail.type, e.detail));
    Object.keys(REACT_MAP).forEach(t => {
        document.addEventListener('orb-' + t, e => orbReact(t, e.detail));
    });

    // 安全工具执行自动反应
    document.addEventListener('security-tool-start', () => orbReact('scan'));
    document.addEventListener('security-tool-end', () => orbReact('complete'));
    document.addEventListener('security-tool-error', () => orbReact('error'));
    // 工具安装自动反应
    document.addEventListener('tool-install-start', () => orbReact('install'));
    document.addEventListener('tool-install-done', () => orbReact('complete'));
    // 连接状态自动反应
    document.addEventListener('connection-lost', () => orbReact('disconnect'));
    document.addEventListener('connection-restored', () => orbReact('reconnect'));
    // 认证提醒
    document.addEventListener('auth-required', () => orbReact('alert'));

    /* ============ 21. AI 主动交互 ============ */
    // 主动建议发光
    function proactiveSuggest(chips) {
        window.OrbHub.showSuggestions(chips);
        orb.animate([
            { boxShadow: '0 0 40px rgba(106,76,147,0.2)' },
            { boxShadow: '0 0 80px rgba(106,76,147,0.5)' },
            { boxShadow: '0 0 40px rgba(106,76,147,0.2)' }
        ], { duration: 1200, iterations: 2 });
    }
    // 提醒轻推
    function nudge() {
        orb.animate([
            { transform: 'translateX(0)' },
            { transform: 'translateX(-8px)' },
            { transform: 'translateX(8px)' },
            { transform: 'translateX(0)' }
        ], { duration: 400 });
        window.OrbHub.showNotification();
        try { if (window.ModelAction && window.ModelAction.getType()) { window.ModelAction.blink(); window.ModelAction.nod(); } } catch(e) {}
    }
    window.OrbHub.proactiveSuggest = proactiveSuggest;
    window.OrbHub.nudge = nudge;
    window.OrbHub.starBurst = starBurst;

    // 情绪色彩
    function setEmotion(emotion) {
        const colors = {
            happy: 'rgba(39,174,96,0.3)',
            sad: 'rgba(52,152,219,0.3)',
            angry: 'rgba(231,76,60,0.3)',
            thinking: 'rgba(106,76,147,0.3)',
            neutral: 'rgba(255,107,107,0.2)'
        };
        orb.style.boxShadow = `0 0 40px ${colors[emotion] || colors.neutral},0 0 80px ${colors[emotion] || colors.neutral}`;
    }
    window.OrbHub.setEmotion = setEmotion;

    /* ============ 22. 协作感知 ============ */
    document.addEventListener('collab-message', e => {
        const { from, direction } = e.detail || {};
        // 消息方向亮
        orb.animate([
            { filter: 'brightness(1)' },
            { filter: 'brightness(1.4)' },
            { filter: 'brightness(1)' }
        ], { duration: 600 });
        if (from) {
            window.OrbHub.showBubble(`${from} 发送了消息`);
            setTimeout(() => window.OrbHub.hideBubble(), 2500);
        }
    });

    /* ============ 23. 触控手势 ============ */
    let touchState = { startX: 0, startY: 0, startT: 0, pins: [] };
    orbStage.addEventListener('touchstart', e => {
        if (e.touches.length === 1) {
            touchState.startX = e.touches[0].clientX;
            touchState.startY = e.touches[0].clientY;
            touchState.startT = Date.now();
        } else if (e.touches.length === 2) {
            touchState.pins = [
                { x: e.touches[0].clientX, y: e.touches[0].clientY },
                { x: e.touches[1].clientX, y: e.touches[1].clientY }
            ];
            touchState.pinchDist = Math.hypot(
                touchState.pins[1].x - touchState.pins[0].x,
                touchState.pins[1].y - touchState.pins[0].y
            );
        }
    }, { passive: true });
    orbStage.addEventListener('touchend', e => {
        if (e.changedTouches.length === 1) {
            const dx = e.changedTouches[0].clientX - touchState.startX;
            const dy = e.changedTouches[0].clientY - touchState.startY;
            const dt = Date.now() - touchState.startT;
            const dist = Math.hypot(dx, dy);
            // 三指滑动由 gestureend 处理，这里处理单指
            if (dist < 20 && dt < 300) {
                // 单击
                window.OrbHub.openChat();
            } else if (dist > 80 && dt < 400) {
                // 滑动
                if (Math.abs(dy) > Math.abs(dx)) {
                    if (dy < 0) openWindow('tasks'); else if(window.OrbHub)window.OrbHub.showExpose();
                }
            }
        }
    }, { passive: true });

    // 双指捏合 Exposé / 张开聚焦
    document.addEventListener('touchmove', e => {
        if (e.touches.length === 2 && touchState.pinchDist) {
            const d = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].y - e.touches[0].y);
            if (d < touchState.pinchDist * 0.6) {
                // 捏合 → Exposé
                if(window.OrbHub)window.OrbHub.showExpose();
                touchState.pinchDist = null;
            } else if (d > touchState.pinchDist * 1.5) {
                // 张开 → 聚焦灵体
                if(window.OrbHub)window.OrbHub.hideExpose();
                const wins = activeWindows();
                if (wins.length === 1 && WindowManager) WindowManager.focusWindow(wins[0].id.replace('win-', ''));
                touchState.pinchDist = null;
            }
        }
    }, { passive: true });

    // 三指滑动
    let threeFingerStart = null;
    document.addEventListener('touchstart', e => {
        if (e.touches.length === 3) {
            threeFingerStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
    }, { passive: true });
    document.addEventListener('touchend', e => {
        if (threeFingerStart && e.changedTouches.length >= 1) {
            const t = e.changedTouches[0];
            const dx = t.clientX - threeFingerStart.x, dy = t.clientY - threeFingerStart.y;
            if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx)) {
                if (dy < 0) { if(window.OrbHub)window.OrbHub.showExpose(); }
                else { window.OrbHub.openChat(); }
            } else if (Math.abs(dx) > 60) {
                const wins = activeWindows();
                if (wins.length > 1) {
                    const top = topWindow(), idx = wins.indexOf(top);
                    const next = dx > 0 ? wins[(idx + 1) % wins.length] : wins[(idx - 1 + wins.length) % wins.length];
                    if (next && WindowManager) WindowManager.focusWindow(next.id.replace('win-', ''));
                }
            }
            threeFingerStart = null;
        }
    }, { passive: true });

    /* ============ 24. 剪贴板智能识别 ============ */
    document.addEventListener('paste', e => {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) return;
        const cd = e.clipboardData || window.clipboardData;
        if (!cd) return;
        const text = cd.getData('text');
        if (!text) return;
        const trimmed = text.trim();
        let prompt = null;
        if (/^https?:\/\/[^\s]+$/.test(trimmed)) {
            prompt = `帮我分析这个链接：${trimmed}`;
        } else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) {
            prompt = `扫描这个 IP：${trimmed}`;
        }
        if (prompt) {
            setTimeout(() => {
                window.OrbHub.openChat();
                const ci = document.getElementById('chat-input');
                if (ci) { ci.value = prompt; ci.focus(); }
            }, 100);
        }
    });

    /* ============ 25. 屏幕热区 ============ */
    let cornerTimer = null, cornerZone = null;
    document.addEventListener('mousemove', e => {
        const zone = 5;
        let hit = null;
        if (e.clientX < zone && e.clientY < zone) hit = 'tl';
        else if (e.clientX > window.innerWidth - zone && e.clientY < zone) hit = 'tr';
        else if (e.clientX < zone && e.clientY > window.innerHeight - zone) hit = 'bl';
        else if (e.clientX > window.innerWidth - zone && e.clientY > window.innerHeight - zone) hit = 'br';
        if (hit && hit !== cornerZone) {
            cornerZone = hit;
            clearTimeout(cornerTimer);
            cornerTimer = setTimeout(() => {
                if (hit === 'tr') { if(window.OrbHub)window.OrbHub.showPalette(); }
                else if (hit === 'tl') { openWindow('tasks'); }
                else if (hit === 'br') { window.OrbHub.openChat(); }
                else if (hit === 'bl') { if(window.OrbHub)window.OrbHub.showExpose(); }
                cornerZone = null;
            }, 300);
        } else if (!hit) {
            cornerZone = null;
            clearTimeout(cornerTimer);
        }
    });

    /* ============ 26. 无障碍 ============ */
    // 屏幕阅读器：灵体 aria-label 已在 HTML 设置
    orbStage.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            window.OrbHub.openChat();
        }
    });
    // 高对比度 / 减弱动画 / 大字体（可通过设置切换）
    window.OrbHub.setAccessibility = opts => {
        document.body.classList.toggle('high-contrast', !!opts.highContrast);
        document.body.classList.toggle('reduce-motion', !!opts.reduceMotion);
        document.body.classList.toggle('large-font', !!opts.largeFont);
        localStorage.setItem('mrhua_a11y', JSON.stringify(opts));
    };
    try {
        const saved = JSON.parse(localStorage.getItem('mrhua_a11y') || '{}');
        if (Object.keys(saved).length) window.OrbHub.setAccessibility(saved);
    } catch (e) {}

    /* ============ 27. 窗口从灵体展开（hook openWindow） ============ */
    const _origOpenWindow = window.openWindow;
    if (_origOpenWindow) {
        window.openWindow = function (id) {
            _origOpenWindow.apply(this, arguments);
            setTimeout(() => {
                const win = $('win-' + id);
                if (win) {
                    win.classList.remove('from-orb');
                    void win.offsetWidth; // reflow
                    win.classList.add('from-orb');
                    setTimeout(() => win.classList.remove('from-orb'), 400);
                }
            }, 10);
        };
    }

    /* ============ 28. 最小化为灵体光点（hook minimizeWindow） ============ */
    const _origMinimize = WindowManager ? WindowManager.minimizeWindow : null;
    if (_origMinimize && WindowManager) {
        WindowManager.minimizeWindow = function (id) {
            const win = $('win-' + id);
            const tools = window.OrbHub ? window.OrbHub.tools : [];
            const tool = tools.find(t => t.id === id);
            if (win && tool) {
                // 创建光点
                const dot = document.createElement('div');
                dot.className = 'min-dot';
                dot.id = 'min-dot-' + id;
                dot.textContent = tool.icon;
                
                const wr = win.getBoundingClientRect();
                dot.style.left = wr.left + 'px';
                dot.style.top = wr.top + 'px';
                document.body.appendChild(dot);
                // 动画到灵体周围（夹在屏幕内）
                requestAnimationFrame(() => {
                    const or = rect(orb);
                    const cx = or.left + or.width / 2, cy = or.top + or.height / 2;
                    const dots = document.querySelectorAll('.min-dot');
                    const i = dots.length - 1;
                    const angle = Math.PI * 0.7 + i * 0.4;
                    const r = 80;
                    let dx = cx + Math.cos(angle) * r - 18;
                    let dy = cy + Math.sin(angle) * r - 18;
                    dx = Math.max(4, Math.min(window.innerWidth - 40, dx));
                    dy = Math.max(4, Math.min(window.innerHeight - 80, dy));
                    dot.style.left = dx + 'px';
                    dot.style.top = dy + 'px';
                });
                dot.onclick = () => {
                    dot.remove();
                    WindowManager.restoreWindow ? WindowManager.restoreWindow(id) : _origOpenWindow(id);
                };
            }
            _origMinimize.call(this, id);
        };
    }

    /* ============ 29. 灵体休眠（5分钟无操作） ============ */
    let idleTimer = null;
    function resetIdle() {
        orb.classList.remove('sleeping');
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => orb.classList.add('sleeping'), 5 * 60 * 1000);
    }
    ['mousemove', 'keydown', 'click', 'touchstart'].forEach(ev =>
        document.addEventListener(ev, resetIdle, { passive: true })
    );
    resetIdle();

    /* ============ 30. 通知声音（可选） ============ */
    window.OrbHub.playSound = function (type = 'pop') {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            const ctx = new AC();
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            const freqs = { pop: 660, notify: 880, success: 523, error: 220 };
            o.frequency.value = freqs[type] || 660;
            o.type = 'sine';
            g.gain.setValueAtTime(0.08, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
            o.start(); o.stop(ctx.currentTime + 0.2);
        } catch (e) {}
    };

    /* ============ 31. 方向引导（新用户提示） ============ */
    // 注意：真正的 guideTo（让灵体飞到目标位置）定义在前面，这里不覆盖
    function guideHint(el, text) {
        const r = el.getBoundingClientRect();
        if (window.OrbHub.showBubble) window.OrbHub.showBubble(text);
        // 灵体朝向目标微微倾斜
        orb.animate([
            { transform: 'rotate(0deg)' },
            { transform: `rotate(${r.left < window.innerWidth / 2 ? -10 : 10}deg)` },
            { transform: 'rotate(0deg)' }
        ], { duration: 800 });
    }
    if (window.OrbHub) window.OrbHub.guideHint = guideHint;

    /* ============ 32. 节奏同步（灵体随系统状态呼吸节奏变化） ============ */
    function syncRhythm(cpuLoad) {
        const dur = cpuLoad > 0.7 ? 1.5 : cpuLoad > 0.4 ? 3 : 4;
        orb.style.animationDuration = `${dur}s`;
    }
    if (window.OrbHub) window.OrbHub.syncRhythm = syncRhythm;

    /* ============ 初始化 · 无言引导 ============ */
    orbStage.tabIndex = 0;

    // 开门后灵体用动作打招呼（不用文字）
    const gateway = $('gateway-stage');
    function greet() {
        setTimeout(() => { happyBounce(); }, 400);
        setTimeout(() => { attract(1500); }, 1200);
    }
    if (gateway) {
        const obs = new MutationObserver(() => {
            if (gateway.style.display === 'none' || gateway.style.opacity === '0') {
                greet(); obs.disconnect();
            }
        });
        obs.observe(gateway, { attributes: true, attributeFilter: ['style'] });
        setTimeout(greet, 4500);
    } else setTimeout(greet, 500);

    // 工具完成时灵体开心蹦跳
    document.addEventListener('tool-progress', e => {
        if (e.detail && e.detail.status === 'end') {
            setTimeout(() => happyBounce(), 100);
        }
    });
    // AI 回复时灵体点头
    document.addEventListener('ai-reply', () => { setTimeout(nod, 50); });
    // 出错时灵体摇头
    document.addEventListener('ai-error', () => { setTimeout(shake, 50); });

    // 新通知时灵体吸引注意
    document.addEventListener('new-notification', () => { attract(2500); });

    // 首次用户长时间无操作，灵体主动靠近鼠标（好奇）
    let idleSince = Date.now();
    ['mousemove', 'keydown', 'click'].forEach(ev =>
        document.addEventListener(ev, () => { idleSince = Date.now(); }, { passive: true })
    );
    setInterval(() => {
        if (Date.now() - idleSince > 45000 && isChatOpen() === false) {
            // 灵体慢慢游到屏幕下方偏中，轻轻跳动，邀请点击
            wander.mode = 'guide'; wander.guideEl = null;
            wander.tx = window.innerWidth / 2 + (Math.random() - 0.5) * 200;
            wander.ty = window.innerHeight * 0.6;
            wander.guideTimer = performance.now() + 3000;
            idleSince = Date.now();
        }
    }, 10000);

    /* ============ 33. 统一模型动作枢纽（程序化动作 + 连续性互动） ============ */
    // 不依赖任何第三方动画库，所有动作通过数学公式直接计算骨骼变换
    const ModelAction = (function() {
        let _currentType = null;      // 'pmx' | 'live2d' | 'mmd-three' | 'vrm' | null
        let _pmx = null;               // PMX模型引用 { instance, animator, camera }
        let _live2d = null;            // Live2D模型引用
        let _vrm = null;               // VRM模型引用
        let _vrmBoneCache = {};        // VRM骨骼缓存
        let _vrmAction = null;         // VRM当前动作
        let _vrmActionTime = 0;        // VRM动作时间
        let _breathPhase = 0;          // 呼吸相位
        let _talkVolume = 0;           // 说话音量 0-1
        let _talkTarget = 0;           // 说话目标音量
        let _emotion = 'neutral';      // 当前情绪
        let _actionQueue = [];         // 动作队列
        let _currentAction = null;     // 当前动作
        let _actionTime = 0;           // 动作时间
        let _lookX = 0, _lookY = 0;   // 目光目标
        let _lookCurX = 0, _lookCurY = 0; // 当前目光（平滑）

        // 检测当前模型类型
        function detect() {
            // PMX模型（自研渲染器）
            if (window.OrbSkins && window.OrbSkins._nativeModel && window.OrbSkins._nativeModel.instance) {
                const mi = window.OrbSkins._nativeModel.instance;
                if (mi.animator) {
                    _pmx = { instance: mi, animator: mi.animator, camera: window.OrbSkins._nativeModel.camera };
                    _currentType = 'pmx';
                    return 'pmx';
                }
            }
            // MMD模型（three.js路径，通过OrbSkins.mmdMesh访问）
            if (window.OrbSkins && window.OrbSkins.mmdMesh) {
                _currentType = 'mmd-three';
                return 'mmd-three';
            }
            // VRM模型（three-vrm，通过OrbSkins._vrm访问）
            if (window.OrbSkins && window.OrbSkins._vrm) {
                _vrm = window.OrbSkins._vrm;
                _vrmBoneCache = {};
                _currentType = 'vrm';
                return 'vrm';
            }
            // Live2D模型（自研渲染器，通过OrbSkins.live2dRenderer访问）
            if (window.OrbSkins && window.OrbSkins.live2dRenderer && window.OrbSkins.live2dRenderer.model) {
                _live2d = window.OrbSkins.live2dRenderer;
                _currentType = 'live2d';
                return 'live2d';
            }
            _currentType = null;
            _pmx = null;
            _live2d = null;
            _vrm = null;
            _vrmBoneCache = {};
            return null;
        }

        // VRM骨骼名称映射表（标准名 -> 可能的变体名）
        const _VRM_BONE_ALIASES = {
            'head': ['head', 'Head', 'HEAD', '頭', 'head_bone'],
            'neck': ['neck', 'Neck', 'NECK', '首'],
            'spine': ['spine', 'Spine', 'SPINE', '背骨', 'spine_01'],
            'chest': ['chest', 'Chest', 'CHEST', '胸', 'upperChest', 'UpperChest', 'spine_02'],
            'hips': ['hips', 'Hips', 'HIPS', '腰', 'pelvis', 'Pelvis'],
            'leftShoulder': ['leftShoulder', 'LeftShoulder', 'LeftShoulder_bone', '左肩', 'L_shoulder'],
            'leftUpperArm': ['leftUpperArm', 'LeftUpperArm', 'LeftArm', 'leftArm', '左上腕', 'L_arm', 'L_upperArm'],
            'leftLowerArm': ['leftLowerArm', 'LeftLowerArm', 'LeftForeArm', 'leftForeArm', '左前腕', 'L_foreArm', 'L_lowerArm'],
            'leftHand': ['leftHand', 'LeftHand', '左手', 'L_hand'],
            'rightShoulder': ['rightShoulder', 'RightShoulder', 'RightShoulder_bone', '右肩', 'R_shoulder'],
            'rightUpperArm': ['rightUpperArm', 'RightUpperArm', 'RightArm', 'rightArm', '右上腕', 'R_arm', 'R_upperArm'],
            'rightLowerArm': ['rightLowerArm', 'RightLowerArm', 'RightForeArm', 'rightForeArm', '右前腕', 'R_foreArm', 'R_lowerArm'],
            'rightHand': ['rightHand', 'RightHand', '右手', 'R_hand'],
            'leftUpperLeg': ['leftUpperLeg', 'LeftUpperLeg', 'LeftLeg', 'leftLeg', '左大腿', 'L_leg', 'L_upperLeg'],
            'leftLowerLeg': ['leftLowerLeg', 'LeftLowerLeg', 'LeftShin', 'leftShin', '左脛', 'L_shin', 'L_lowerLeg'],
            'leftFoot': ['leftFoot', 'LeftFoot', '左足', 'L_foot'],
            'rightUpperLeg': ['rightUpperLeg', 'RightUpperLeg', 'RightLeg', 'rightLeg', '右大腿', 'R_leg', 'R_upperLeg'],
            'rightLowerLeg': ['rightLowerLeg', 'RightLowerLeg', 'RightShin', 'rightShin', '右脛', 'R_shin', 'R_lowerLeg'],
            'rightFoot': ['rightFoot', 'RightFoot', '右足', 'R_foot']
        };

        // VRM辅助函数：获取骨骼（适配自研GLTFLoader转换器的boneMap格式，支持模糊匹配）
        function _vrmGetBone(name) {
            if (!_vrm) return null;
            if (name in _vrmBoneCache) return _vrmBoneCache[name];
            try {
                // 自研转换器格式：boneMap（先精确匹配，再模糊匹配）
                if (_vrm.boneMap) {
                    // 精确匹配
                    if (_vrm.boneMap[name]) {
                        _vrmBoneCache[name] = _vrm.boneMap[name];
                        return _vrm.boneMap[name];
                    }
                    // 模糊匹配（通过别名表）
                    const aliases = _VRM_BONE_ALIASES[name] || [name];
                    for (const alias of aliases) {
                        if (_vrm.boneMap[alias]) {
                            _vrmBoneCache[name] = _vrm.boneMap[alias];
                            return _vrm.boneMap[alias];
                        }
                    }
                    // 不区分大小写匹配
                    const nameLower = name.toLowerCase();
                    for (const key of Object.keys(_vrm.boneMap)) {
                        if (key.toLowerCase() === nameLower) {
                            _vrmBoneCache[name] = _vrm.boneMap[key];
                            return _vrm.boneMap[key];
                        }
                    }
                    // 包含匹配（如 "LeftArm" 包含 "arm"）
                    for (const key of Object.keys(_vrm.boneMap)) {
                        if (key.toLowerCase().includes(nameLower) && nameLower.length > 3) {
                            _vrmBoneCache[name] = _vrm.boneMap[key];
                            return _vrm.boneMap[key];
                        }
                    }
                }
                // 兼容three-vrm格式
                if (_vrm.humanoid) {
                    const node = _vrm.humanoid.getRawBoneNode(name);
                    _vrmBoneCache[name] = node;
                    return node;
                }
            } catch(e) {}
            return null;
        }

        // VRM辅助函数：设置表情
        function _vrmSetExpression(name, value) {
            if (!_vrm || !_vrm.expressionManager) return;
            try {
                _vrm.expressionManager.setValue(name, value);
            } catch(e) {}
        }

        // VRM辅助函数：触发临时动作
        function _vrmTriggerAction(actionName, duration) {
            _vrmAction = actionName;
            _vrmActionTime = 0;
            _vrmActionDuration = duration || 1.0;
        }
        let _vrmActionDuration = 1.0;

        // 眨眼
        function blink() {
            detect();
            if (_currentType === 'pmx' && _pmx.animator.triggerBlink) {
                _pmx.animator.triggerBlink();
                return true;
            }
            if (_currentType === 'mmd-three' && window.OrbSkins) {
                // three.js路径：触发一次开心反应（包含弹跳），眨眼由渲染循环自动处理
                if (typeof window.OrbSkins.mmdReact === 'function') {
                    window.OrbSkins.mmdReact('happy');
                }
                return true;
            }
            if (_currentType === 'live2d' && _live2d.triggerBlink) {
                _live2d.triggerBlink();
                return true;
            }
            if (_currentType === 'vrm') {
                // VRM：触发快速眨眼（设置blink表情，由update方法动画处理）
                _vrmTriggerAction('blink', 0.3);
                return true;
            }
            return false;
        }

        // 挥手
        function wave(side) {
            detect();
            const s = side || 'right';
            if (_currentType === 'pmx' && _pmx.animator.triggerWave) {
                _pmx.animator.triggerWave(s);
                return true;
            }
            if (_currentType === 'mmd-three' && window.OrbSkins) {
                // three.js路径：调用身体动作系统（抬起手臂+身体倾斜+头部转向+手势）
                if (typeof window.OrbSkins.setBodyAction === 'function') {
                    window.OrbSkins.setBodyAction('wave');
                }
                // 如果指定左手，额外设置左手手势
                if (s === 'left' && typeof window.OrbSkins.setGesture === 'function') {
                    window.OrbSkins.setGesture('wave', 'left');
                }
                return true;
            }
            if (_currentType === 'live2d' && _live2d.triggerWave) {
                _live2d.triggerWave(s);
                return true;
            }
            if (_currentType === 'vrm') {
                // VRM：通过World3D的triggerAction触发（不会被渲染循环覆盖）
                if (window.World3D && typeof window.World3D.triggerAction === 'function') {
                    window.World3D.triggerAction('wave', 2.0);
                    console.log('[ModelAction] VRM wave -> World3D.triggerAction(wave)');
                } else {
                    // 回退：直接操作骨骼（可能被World3D渲染循环覆盖）
                    _vrmTriggerAction('wave_' + s, 2.0);
                }
                _vrmSetExpression('happy', 0.5);
                return true;
            }
            // 回退：DOM动画
            if (typeof happyBounce === 'function') happyBounce();
            return false;
        }

        // 点头
        function nod() {
            detect();
            if (_currentType === 'pmx' && _pmx.animator.triggerNod) {
                _pmx.animator.triggerNod();
                return true;
            }
            if (_currentType === 'mmd-three' && window.OrbSkins) {
                // three.js路径：调用身体动作系统
                if (typeof window.OrbSkins.setBodyAction === 'function') {
                    window.OrbSkins.setBodyAction('nod');
                }
                return true;
            }
            if (_currentType === 'live2d' && _live2d.triggerNod) {
                _live2d.triggerNod();
                return true;
            }
            if (_currentType === 'vrm') {
                // VRM：通过World3D的triggerAction触发
                if (window.World3D && typeof window.World3D.triggerAction === 'function') {
                    window.World3D.triggerAction('nod', 1.5);
                    console.log('[ModelAction] VRM nod -> World3D.triggerAction(nod)');
                } else {
                    _vrmTriggerAction('nod', 1.0);
                }
                return true;
            }
            // 回退：DOM动画
            if (typeof nod === 'function') { try { nod(); } catch(e){} }
            return false;
        }

        // 摇头
        function shake() {
            detect();
            if (_currentType === 'pmx' && _pmx.animator.triggerShake) {
                _pmx.animator.triggerShake();
                return true;
            }
            if (_currentType === 'mmd-three' && window.OrbSkins) {
                // three.js路径：调用身体动作系统
                if (typeof window.OrbSkins.setBodyAction === 'function') {
                    window.OrbSkins.setBodyAction('shake');
                }
                return true;
            }
            if (_currentType === 'live2d' && _live2d.triggerShake) {
                _live2d.triggerShake();
                return true;
            }
            if (_currentType === 'vrm') {
                // VRM：通过World3D的triggerAction触发
                if (window.World3D && typeof window.World3D.triggerAction === 'function') {
                    window.World3D.triggerAction('shake', 1.8);
                    console.log('[ModelAction] VRM shake -> World3D.triggerAction(shake)');
                } else {
                    _vrmTriggerAction('shake', 1.0);
                }
                return true;
            }
            if (typeof shake === 'function') { try { shake(); } catch(e){} }
            return false;
        }

        // 目光跟随
        function lookAt(x, y) {
            _lookX = Math.max(-1, Math.min(1, x));
            _lookY = Math.max(-1, Math.min(1, y));
            detect();
            if (_currentType === 'pmx' && _pmx.animator.setLookTarget) {
                _pmx.animator.setLookTarget(_lookX * 0.5, _lookY * 0.3);
                return true;
            }
            if (_currentType === 'mmd-three' && window.OrbSkins) {
                // three.js路径：直接设置鼠标位置，渲染循环会自动让头部跟随
                window.OrbSkins._mmdMouseX = _lookX;
                window.OrbSkins._mmdMouseY = _lookY;
                return true;
            }
            if (_currentType === 'live2d' && _live2d.setLookTarget) {
                _live2d.setLookTarget(_lookX, _lookY);
                return true;
            }
            if (_currentType === 'vrm' && window.OrbSkins) {
                // VRM：直接设置鼠标位置，渲染循环会自动让头部和视线跟随
                window.OrbSkins._vrmMouseX = _lookX;
                window.OrbSkins._vrmMouseY = _lookY;
                return true;
            }
            return false;
        }

        // VRM连招预设
        const VRM_COMBOS = {
            greet: [
                { action: 'wave_right', duration: 2.0 },
                { action: 'nod', duration: 1.0 }
            ],
            happy: [
                { action: 'wave_right', duration: 1.5 },
                { action: 'wave_left', duration: 1.5 },
                { action: 'nod', duration: 0.8 }
            ],
            think: [
                { action: 'nod', duration: 0.8 },
                { action: 'shake', duration: 0.8 },
                { action: 'nod', duration: 0.8 }
            ],
            surprise: [
                { action: 'shake', duration: 1.0 },
                { action: 'nod', duration: 0.6 }
            ],
            shy: [
                { action: 'wave_right', duration: 1.5 },
                { action: 'nod', duration: 0.8 }
            ],
            dance: [
                { action: 'wave_right', duration: 1.0 },
                { action: 'wave_left', duration: 1.0 },
                { action: 'shake', duration: 0.8 },
                { action: 'nod', duration: 0.8 }
            ],
            idle: [
                { action: 'blink', duration: 0.3 },
                { action: 'nod', duration: 0.8 }
            ],
            bow: [
                { action: 'nod', duration: 1.5 }
            ]
        };
        let _vrmComboTimer = null;
        let _vrmComboRunning = false;

        // 播放连招（自动连续播放一系列动作）
        function playCombo(comboName, options) {
            detect();
            if (_currentType === 'mmd-three' && window.OrbSkins && typeof window.OrbSkins.playCombo === 'function') {
                return window.OrbSkins.playCombo(comboName, options);
            }
            if (_currentType === 'vrm') {
                // VRM连招
                const combo = VRM_COMBOS[comboName];
                if (!combo) return false;
                stopCombo();
                _vrmComboRunning = true;
                const opts = options || {};
                const loop = opts.loop || false;
                const interval = opts.interval || 0.3;
                let stepIndex = 0;
                const playStep = () => {
                    if (!_vrmComboRunning) return;
                    if (stepIndex >= combo.length) {
                        if (loop) { stepIndex = 0; }
                        else { _vrmComboRunning = false; if (opts.onComplete) opts.onComplete(); return; }
                    }
                    const step = combo[stepIndex];
                    // 触发对应动作
                    if (step.action === 'wave_right') wave('right');
                    else if (step.action === 'wave_left') wave('left');
                    else if (step.action === 'nod') nod();
                    else if (step.action === 'shake') shake();
                    else if (step.action === 'blink') blink();
                    stepIndex++;
                    _vrmComboTimer = setTimeout(playStep, (step.duration + interval) * 1000);
                };
                playStep();
                return true;
            }
            return false;
        }
        function stopCombo() {
            if (window.OrbSkins && typeof window.OrbSkins.stopCombo === 'function') {
                window.OrbSkins.stopCombo();
            }
            // VRM连招停止
            if (_vrmComboTimer) { clearTimeout(_vrmComboTimer); _vrmComboTimer = null; }
            _vrmComboRunning = false;
        }
        function playRandomCombo(options) {
            detect();
            if (_currentType === 'mmd-three' && window.OrbSkins && typeof window.OrbSkins.playRandomCombo === 'function') {
                return window.OrbSkins.playRandomCombo(options);
            }
            if (_currentType === 'vrm') {
                const names = Object.keys(VRM_COMBOS);
                const randomName = names[Math.floor(Math.random() * names.length)];
                return playCombo(randomName, options);
            }
            return false;
        }
        function getCombos() {
            if (window.OrbSkins && typeof window.OrbSkins.getCombos === 'function') {
                return window.OrbSkins.getCombos();
            }
            // VRM连招列表
            return Object.keys(VRM_COMBOS);
        }

        // 设置说话音量（0-1），用于口型同步
        function setTalkVolume(vol) {
            _talkTarget = Math.max(0, Math.min(1, vol));
        }

        // 设置情绪
        function setEmotion(emotion) {
            _emotion = emotion || 'neutral';
            detect();
            if (_currentType === 'pmx' && _pmx.animator.setEmotion) {
                _pmx.animator.setEmotion(_emotion);
            }
            if (_currentType === 'mmd-three' && window.OrbSkins) {
                // three.js路径：根据情绪映射到身体动作
                const emotionMap = {
                    'happy': 'happy',
                    'joy': 'happy',
                    'excited': 'happy',
                    'surprise': 'surprise',
                    'shocked': 'surprise',
                    'sad': 'sway',
                    'cry': 'sway',
                    'angry': 'shake',
                    'mad': 'shake',
                    'think': 'think',
                    'thinking': 'think',
                    'shy': 'sway',
                    'blush': 'sway',
                    'neutral': null,
                    'idle': null,
                    'calm': null
                };
                const action = emotionMap[_emotion];
                if (action && typeof window.OrbSkins.setBodyAction === 'function') {
                    window.OrbSkins.setBodyAction(action);
                }
                // 同时触发反应（弹跳效果）
                if (_emotion === 'happy' || _emotion === 'surprise') {
                    if (typeof window.OrbSkins.mmdReact === 'function') {
                        window.OrbSkins.mmdReact(_emotion);
                    }
                }
            }
            if (_currentType === 'live2d' && _live2d.setEmotion) {
                _live2d.setEmotion(_emotion);
            }
            if (_currentType === 'vrm') {
                // VRM：优先通过World3D的triggerAction触发身体动作，同时设置表情
                const world3DActionMap = {
                    'happy': 'happy', 'joy': 'happy', 'excited': 'happy',
                    'surprised': 'surprise', 'shocked': 'surprise',
                    'think': 'think', 'thinking': 'think',
                    'shy': 'shrug', 'blush': 'shrug'
                };
                const w3dAction = world3DActionMap[_emotion];
                if (w3dAction && window.World3D && typeof window.World3D.triggerAction === 'function') {
                    window.World3D.triggerAction(w3dAction);
                    console.log('[ModelAction] VRM emotion', _emotion, '-> World3D.triggerAction(' + w3dAction + ')');
                }
                // 同时设置VRM表情
                const vrmEmotionMap = {
                    'happy': 'happy', 'joy': 'happy', 'excited': 'happy',
                    'angry': 'angry', 'mad': 'angry',
                    'sad': 'sad', 'cry': 'sad',
                    'relaxed': 'relaxed', 'calm': 'relaxed', 'neutral': 'relaxed',
                    'surprised': 'surprised', 'shocked': 'surprised',
                    'shy': 'happy', 'blush': 'happy'
                };
                const vrmExpr = vrmEmotionMap[_emotion];
                if (vrmExpr) {
                    ['happy', 'angry', 'sad', 'relaxed', 'surprised'].forEach(e => {
                        if (e !== vrmExpr) _vrmSetExpression(e, 0);
                    });
                    _vrmSetExpression(vrmExpr, 0.8);
                }
            }
        }

        // 每帧更新（连续性互动：呼吸、说话口型、目光平滑）
        function update(dt) {
            detect();
            if (!_currentType) return;

            // 呼吸：胸部轻微起伏
            _breathPhase += dt * 1.2; // 约每分钟72次
            const breathVal = (Math.sin(_breathPhase) + 1) * 0.5; // 0-1

            // 说话音量平滑
            _talkVolume += (_talkTarget - _talkVolume) * Math.min(1, dt * 10);

            // 目光平滑
            _lookCurX += (_lookX - _lookCurX) * Math.min(1, dt * 5);
            _lookCurY += (_lookY - _lookCurY) * Math.min(1, dt * 5);

            if (_currentType === 'pmx' && _pmx.animator) {
                // PMX：说话状态同步到animator（animator内部处理下颌运动）
                if (typeof _pmx.animator.setTalking === 'function') {
                    _pmx.animator.setTalking(_talkVolume > 0.05);
                }
            }

            if (_currentType === 'mmd-three' && window.OrbSkins) {
                // three.js路径：说话状态同步（如果模型有嘴部形态键，可在这里应用）
                // 呼吸、眨眼、头部跟随由initMMD的渲染循环自动处理，这里不重复
                // 存储说话音量供其他模块使用
                window.OrbSkins._mmdTalkVolume = _talkVolume;
                window.OrbSkins._mmdIsTalking = _talkVolume > 0.05;
            }

            if (_currentType === 'live2d' && _live2d) {
                // Live2D：更新参数
                if (_live2d.updateParams) {
                    _live2d.updateParams({
                        breath: breathVal,
                        talkVolume: _talkVolume,
                        lookX: _lookCurX,
                        lookY: _lookCurY,
                        emotion: _emotion
                    });
                }
            }

            if (_currentType === 'vrm' && _vrm) {
                // VRM：动作动画处理
                _vrmActionTime += dt;
                const t = _vrmActionTime;
                const dur = _vrmActionDuration;

                if (_vrmAction === 'blink') {
                    // 眨眼：快速闭合然后睁开
                    const blinkVal = t < 0.1 ? (t / 0.1) : (t < 0.2 ? 1 : Math.max(0, 1 - (t - 0.2) / 0.1));
                    _vrmSetExpression('blink', blinkVal);
                    if (t > dur) { _vrmAction = null; _vrmSetExpression('blink', 0); }
                }
                else if (_vrmAction === 'wave_right' || _vrmAction === 'wave_left') {
                    // 挥手：抬起手臂+上下摆动
                    const side = _vrmAction === 'wave_right' ? 'right' : 'left';
                    const upperArm = _vrmGetBone(side + 'UpperArm');
                    const lowerArm = _vrmGetBone(side + 'LowerArm');
                    const hand = _vrmGetBone(side + 'Hand');
                    const shoulder = _vrmGetBone(side + 'Shoulder');
                    // 抬起进度（0-1）
                    const raiseProgress = Math.min(1, t / 0.3);
                    // 摆动
                    const wave = Math.sin(t * 8) * 0.3;
                    if (upperArm) {
                        upperArm.rotation.z = (side === 'right' ? -1 : 1) * 2.5 * raiseProgress;
                        upperArm.rotation.x = -0.3 * raiseProgress;
                    }
                    if (lowerArm) {
                        lowerArm.rotation.x = 0.8 + wave;
                        lowerArm.rotation.z = wave * 0.5;
                    }
                    if (hand) hand.rotation.z = wave;
                    if (shoulder) shoulder.rotation.z = (side === 'right' ? -1 : 1) * 0.2 * raiseProgress;
                    // 身体轻微倾斜
                    const spine = _vrmGetBone('spine');
                    if (spine) spine.rotation.z = (side === 'right' ? 1 : -1) * 0.05 * raiseProgress;
                    // 头部转向挥手方向
                    const head = _vrmGetBone('head');
                    if (head) head.rotation.y = (side === 'right' ? 1 : -1) * 0.2 * raiseProgress;
                    if (t > dur) {
                        _vrmAction = null;
                        // 重置骨骼（由渲染循环的基础动画接管）
                        _vrmSetExpression('happy', 0);
                    }
                }
                else if (_vrmAction === 'nod') {
                    // 点头：上下点头
                    const head = _vrmGetBone('head');
                    const neck = _vrmGetBone('neck');
                    const nodVal = Math.sin(t * 6) * 0.3 * Math.max(0, 1 - t / dur);
                    if (head) head.rotation.x = nodVal;
                    if (neck) neck.rotation.x = nodVal * 0.5;
                    if (t > dur) _vrmAction = null;
                }
                else if (_vrmAction === 'shake') {
                    // 摇头：左右摇头
                    const head = _vrmGetBone('head');
                    const neck = _vrmGetBone('neck');
                    const shakeVal = Math.sin(t * 8) * 0.4 * Math.max(0, 1 - t / dur);
                    if (head) head.rotation.y = shakeVal;
                    if (neck) neck.rotation.y = shakeVal * 0.5;
                    if (t > dur) _vrmAction = null;
                }

                // 说话音量：设置aa表情（口型）
                if (_talkVolume > 0.05) {
                    _vrmSetExpression('aa', Math.min(1, _talkVolume));
                } else {
                    _vrmSetExpression('aa', 0);
                }

                // 更新VRM（表情、视线等由渲染循环处理，这里只更新expressionManager）
                if (_vrm.expressionManager) {
                    try { _vrm.expressionManager.update(dt); } catch(e) {}
                }
            }
        }

        // 启动连续性互动循环
        let _rafId = null;
        let _lastTime = 0;
        function start() {
            if (_rafId) return;
            _lastTime = performance.now();
            const loop = (now) => {
                _rafId = requestAnimationFrame(loop);
                const dt = Math.min(0.05, (now - _lastTime) / 1000);
                _lastTime = now;
                update(dt);
            };
            _rafId = requestAnimationFrame(loop);
        }

        function stop() {
            if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
        }

        // 获取当前模型类型
        function getType() { detect(); return _currentType; }

        // ============ 画质控制 ============
        let _qualityLevel = 'high'; // low / medium / high / ultra
        let _resolutionScale = null; // null=自动, 数字=固定缩放
        let _antiAliasing = true;
        let _postProcessEnabled = true;

        // 设置画质等级
        function setQuality(level) {
            _qualityLevel = level || 'high';
            const presets = {
                low:    { scale: 1.0, aa: false, pp: false },
                medium: { scale: 1.5, aa: true,  pp: false },
                high:   { scale: 2.0, aa: true,  pp: true  },
                ultra:  { scale: 3.0, aa: true,  pp: true  }
            };
            const p = presets[_qualityLevel] || presets.high;
            _resolutionScale = p.scale;
            _antiAliasing = p.aa;
            _postProcessEnabled = p.pp;
            _applyQuality();
            return true;
        }

        // 设置分辨率缩放（1.0-4.0）
        function setResolutionScale(scale) {
            _resolutionScale = Math.max(0.5, Math.min(4.0, scale));
            _applyQuality();
            return true;
        }

        // 设置抗锯齿
        function setAntiAliasing(enabled) {
            _antiAliasing = !!enabled;
            _applyQuality();
            return true;
        }

        // 设置后处理开关
        function setPostProcess(enabled) {
            _postProcessEnabled = !!enabled;
            _applyQuality();
            return true;
        }

        // 应用画质设置到渲染器
        function _applyQuality() {
            detect();
            if (_currentType === 'pmx' && window.OrbSkins) {
                // PMX：存储自定义缩放并触发resize
                if (window.OrbSkins._nativeModel) {
                    window.OrbSkins._nativeModel._customScale = _resolutionScale;
                    window.OrbSkins._nativeModel._aaEnabled = _antiAliasing;
                }
                if (typeof window.OrbSkins._nativeResizeMMD === 'function') {
                    try { window.OrbSkins._nativeResizeMMD(); } catch(e) {}
                }
                // 后处理开关
                if (window.OrbSkins._nativeMMD && window.OrbSkins._nativeMMD.postProcess) {
                    window.OrbSkins._nativeMMD.postProcess._enabled = _postProcessEnabled;
                }
            }
            if (_currentType === 'mmd-three' && window.OrbSkins && window.OrbSkins.mmdRenderer) {
                // three.js路径：设置渲染器像素比
                try {
                    const renderer = window.OrbSkins.mmdRenderer;
                    if (renderer.setPixelRatio) {
                        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, _resolutionScale || 2));
                    }
                } catch(e) {}
            }
            if (_currentType === 'live2d' && _live2d) {
                // Live2D：存储设置供resize使用
                _live2d._customScale = _resolutionScale;
                _live2d._aaEnabled = _antiAliasing;
                // 触发resize
                if (typeof _live2d.resize === 'function') {
                    try { _live2d.resize(); } catch(e) {}
                }
            }
        }

        // 获取当前画质信息
        function getQualityInfo() {
            return {
                level: _qualityLevel,
                resolutionScale: _resolutionScale,
                antiAliasing: _antiAliasing,
                postProcess: _postProcessEnabled,
                modelType: _currentType
            };
        }

        // ============ 飞行模式 ============
        function startFly(opts) {
            if (window.OrbSkins && typeof window.OrbSkins.startFly === 'function') {
                window.OrbSkins.startFly(opts);
                return true;
            }
            return false;
        }
        function stopFly() {
            if (window.OrbSkins && typeof window.OrbSkins.stopFly === 'function') {
                window.OrbSkins.stopFly();
                return true;
            }
            return false;
        }
        function toggleFly(opts) {
            if (window.OrbSkins && typeof window.OrbSkins.toggleFly === 'function') {
                window.OrbSkins.toggleFly(opts);
                return true;
            }
            return false;
        }
        function isFlying() {
            return !!(window.OrbSkins && window.OrbSkins._flyState && window.OrbSkins._flyState.enabled);
        }

        // 暴露接口
        return {
            detect, blink, wave, nod, shake, lookAt,
            setTalkVolume, setEmotion, update, start, stop, getType,
            setQuality, setResolutionScale, setAntiAliasing, setPostProcess, getQualityInfo,
            startFly, stopFly, toggleFly, isFlying,
            playCombo, stopCombo, playRandomCombo, getCombos,
            get breathPhase() { return _breathPhase; },
            get talkVolume() { return _talkVolume; },
            get emotion() { return _emotion; }
        };
    })();

    // 暴露到全局
    window.ModelAction = ModelAction;
    window.OrbHub.ModelAction = ModelAction;

    // 启动连续性互动循环
    ModelAction.start();

    // 鼠标移动：模型目光跟随
    document.addEventListener('mousemove', (e) => {
        const nx = (e.clientX / window.innerWidth) * 2 - 1;
        const ny = (e.clientY / window.innerHeight) * 2 - 1;
        ModelAction.lookAt(nx, ny);
    }, { passive: true });

    // AI说话时：口型同步（监听ai-reply和ai-thinking事件）
    document.addEventListener('ai-thinking', () => {
        ModelAction.setTalkVolume(0.3); // 思考时轻微微动
    });
    document.addEventListener('ai-reply', () => {
        // 模拟说话音量波动
        let vol = 0.8;
        const talkAnim = setInterval(() => {
            vol = 0.5 + Math.random() * 0.5;
            ModelAction.setTalkVolume(vol);
        }, 100);
        setTimeout(() => {
            clearInterval(talkAnim);
            ModelAction.setTalkVolume(0);
        }, 3000);
    });
    document.addEventListener('ai-error', () => {
        ModelAction.setTalkVolume(0);
        ModelAction.shake();
    });

    // 工具完成时：挥手+开心
    document.addEventListener('tool-progress', (e) => {
        if (e.detail && e.detail.status === 'end') {
            setTimeout(() => {
                ModelAction.wave('right');
                ModelAction.setEmotion('happy');
                setTimeout(() => ModelAction.setEmotion('neutral'), 2000);
            }, 100);
        }
    });

    console.log('🌸 灵体交互扩展已加载');
})();
