/**
 * MrHua 页面装载器。
 *
 * 先把 partials 按 manifest 顺序拼进 #mrhua-root，再按 scripts.json 顺序装载
 * Aevum 现有的 UI / 引擎脚本。这样窗口 DOM 一定先于 app-shell.js 存在。
 */
(function () {
    'use strict';

    var ROOT_ID = 'mrhua-root';
    var MANIFEST_URL = './partials/manifest.json';
    var SCRIPTS_URL = './js/scripts.json';

    function fetchJSON(url) {
        return fetch(url).then(function (response) {
            if (!response.ok) throw new Error(url + ' 读取失败：HTTP ' + response.status);
            return response.json();
        });
    }

    function fetchText(url) {
        return fetch(url).then(function (response) {
            if (!response.ok) throw new Error(url + ' 读取失败：HTTP ' + response.status);
            return response.text();
        });
    }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = src;
            script.async = false;
            script.onload = function () { resolve(src); };
            script.onerror = function () { reject(new Error(src + ' 装载失败')); };
            document.head.appendChild(script);
        });
    }

    function hideInitialLoading() {
        var el = document.getElementById('initial-loading');
        if (!el) return;
        el.style.opacity = '0';
        setTimeout(function () {
            if (el && el.parentNode) el.parentNode.removeChild(el);
        }, 500);
    }

    function watchGateTimeout() {
        setTimeout(function () {
            if (window._gateFinished) return;
            var tip = document.createElement('div');
            tip.style.cssText = 'position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#fff;padding:10px 20px;border-radius:8px;font-size:0.85rem;z-index:2000;cursor:pointer;';
            tip.textContent = '页面加载较慢，点击此处跳过动画';
            tip.onclick = function () {
                var skipBtn = document.getElementById('gate-skip');
                if (skipBtn) skipBtn.click();
                if (tip.parentNode) tip.parentNode.removeChild(tip);
            };
            document.body.appendChild(tip);
        }, 10000);
    }

    function showFatal(error) {
        console.error('[MrHua] 页面装载失败', error);
        var root = document.getElementById(ROOT_ID);
        if (!root) return;
        root.innerHTML = '';
        var box = document.createElement('div');
        box.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;background:#f5f5f7;color:#333;z-index:99999;padding:24px;text-align:center;';
        var title = document.createElement('h1');
        title.style.cssText = 'font-size:1.2rem;margin:0 0 8px;';
        title.textContent = 'MrHua 页面模块加载失败';
        var detail = document.createElement('p');
        detail.style.cssText = 'font-size:0.85rem;color:#666;max-width:720px;line-height:1.7;';
        detail.textContent = String(error && error.message ? error.message : error);
        box.appendChild(title);
        box.appendChild(detail);
        root.appendChild(box);
    }

    function boot() {
        var root = document.getElementById(ROOT_ID);
        if (!root) {
            showFatal(new Error('缺少 #' + ROOT_ID));
            return;
        }

        var params = new URLSearchParams(window.location.search);
        var embedMode = params.get('embed') || '';
        if (params.get('public') === '1') {
            // 最小免认证页面：只放行页面可见性，后端接口仍按各自规则鉴权。
            window.MR_PUBLIC_PAGE = true;
            document.body.classList.add('mrhua-public-page');
        }
        if (embedMode === 'wanshare') {
            window.MR_EMBED_WANSHARE = true;
            window.__identityAutoOpened = true;
            document.body.classList.add('mrhua-embed-window', 'mrhua-embed-wanshare');
        }

        Promise.all([fetchJSON(MANIFEST_URL), fetchJSON(SCRIPTS_URL)])
            .then(function (results) {
                var manifest = results[0];
                var scripts = results[1];
                var first = manifest[0];
                var rest = manifest.slice(1);

                return fetchText('./partials/' + first).then(function (firstPart) {
                    root.innerHTML = firstPart;
                    return Promise.all(rest.map(function (path) {
                        return fetchText('./partials/' + path);
                    }));
                }).then(function (parts) {
                    root.insertAdjacentHTML('beforeend', parts.join('\n'));
                    hideInitialLoading();
                    watchGateTimeout();

                    return scripts.reduce(function (chain, src) {
                        return chain.then(function () {
                            return loadScript(src).catch(function (error) {
                                console.error('[MrHua] 脚本装载失败，页面结构仍保留', error);
                            });
                        });
                    }, Promise.resolve()).then(function () {
                        // QtWebEngine 偶发：app-shell 的 script 已 200 但没执行，
                        // 窗口管理整体缺席。这里只在确实没初始化时补装一次，避免重复。
                        if (typeof window.openWindow === 'function') {
                            if (typeof window.mrRenderLauncher === 'function') window.mrRenderLauncher();
                            return;
                        }
                        return fetchText('/interface/console/shell/app-shell.js?fallback=' + Date.now())
                            .then(function (code) {
                                // 不用 <script> 再插一次：QtWebEngine 对这份大脚本的
                                // script 元素偶发不执行，fetch + eval 可以稳定跑起来。
                                (0, eval)(code);
                                if (typeof window.mrRenderLauncher === 'function') window.mrRenderLauncher();
                            })
                            .catch(function (error) {
                                console.error('[MrHua] app-shell 补装失败', error);
                            });
                    });
                });
            })
            .then(function () {
                // 嵌入广域网只需要窗口本身，不启动 3D 灵体引擎；否则会额外装载整套 legacy orb 模块。
                if (!window.MR_EMBED_WANSHARE && window.startMrHuaEngine) {
                    window.startMrHuaEngine();
                }
                if (!window.MR_EMBED_WANSHARE) return;

                /* 嵌入广域网：跳过开门动画，直接打开广域网窗口。
                   app-shell 只保留窗口自身逻辑，不显示身份认证和其它壳层。 */
                var skipBtn = document.getElementById('gate-skip');
                if (skipBtn) skipBtn.click();
                window.setTimeout(function () {
                    if (typeof window.openWindow === 'function') {
                        window.openWindow('wanshare');
                    }
                }, 400);
            })
            .catch(showFatal);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();
