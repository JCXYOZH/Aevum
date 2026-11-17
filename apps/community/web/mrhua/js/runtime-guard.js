/* QtWebEngine 安全加固：禁用会导致渲染进程崩溃的 API */
    (function(){
        var ua = navigator.userAgent || '';
        window._IS_QT = /QtWebEngine|Qt\/\d/.test(ua);
        // SpeechRecognition 在 QtWebEngine 中会触发 bad Mojo message 导致渲染进程崩溃（reason 123）
        // 彻底删除，统一走后端 /api/voice/transcribe
        try { delete window.SpeechRecognition; } catch(e){ window.SpeechRecognition = undefined; }
        try { delete window.webkitSpeechRecognition; } catch(e){ window.webkitSpeechRecognition = undefined; }

        // 错误计数：连续错误超过阈值则显示用户可见的错误面板
        var _errorCount = 0;
        var _errorPanel = null;
        // 嵌入窗口只展示目标窗口，不叠加错误监控悬浮按钮和错误横幅。
        var _EMBED_WANSHARE = /(?:^|[?&])embed=(?:wanshare|subscribe)(?:&|$)/.test(location.search);

        /* ===== 全面错误监控中心 ErrorMonitor ===== */
        var ErrorMonitor = (function(){
            var errors = [];
            var errorMap = {};
            var totalCount = 0;
            var categoryCounts = {page:0, promise:0, resource:0, external:0, cdn:0, webgl:0, noise:0, other:0};
            var toggleBtn = null;
            var overlayEl = null;
            var currentFilter = 'all';
            var MAX_ERRORS = 200;
            var _inAddError = false; // 重入保护：防止 console 拦截器递归调用 addError
            var DATA_VERSION = 3; // 数据格式版本，不匹配时自动清除旧数据

            var EXTERNAL_PATTERNS = [
                /injected\.js/i, /chrome-extension:\/\//i, /moz-extension:\/\//i,
                /edge-extension:\/\//i, /FrameManager/i, /Receiving end does not exist/i,
                /Could not establish connection/i, /Tracking Prevention/i,
                /shared_image_manager/i, /ProduceSkia/i, /fakepath/i
            ];
            var CDN_PATTERNS = [
                /cdn\.jsdelivr\.net/i, /cdnjs\.cloudflare\.com/i, /unpkg\.com/i,
                /cubism\.live2d\.com/i, /cdn\.statically\.io/i, /raw\.githack\.com/i
            ];
            var NOISE_PATTERNS = [
                /^未知错误$/, /noise error/i, /Script error\.?\s*$/i,
                /ResizeObserver loop/i, /non-passive event listener/i
            ];

            function classify(msg, source, stack){
                var text = (msg || '') + ' ' + (source || '') + ' ' + (stack || '');
                for(var i=0;i<NOISE_PATTERNS.length;i++){ if(NOISE_PATTERNS[i].test(text)) return 'noise'; }
                for(var i=0;i<EXTERNAL_PATTERNS.length;i++){ if(EXTERNAL_PATTERNS[i].test(text)) return 'external'; }
                for(var i=0;i<CDN_PATTERNS.length;i++){ if(CDN_PATTERNS[i].test(text)) return 'cdn'; }
                if(/webgl|WebGL|INVALID_VALUE|INVALID_OPERATION|SHADER/i.test(text)) return 'webgl';
                if(/Failed to load resource|404|MIME type|net::ERR|ERR_NAME/i.test(text)) return 'resource';
                if(/unhandled|Promise|rejection/i.test(text) && !source) return 'promise';
                if(/app\.js|orb_skins|orb_extra|orb_renderer|index\.html/i.test(text)) return 'page';
                return 'other';
            }

            function getSeverity(cat){
                if(cat === 'noise') return 'gray';
                if(cat === 'external' || cat === 'cdn') return 'orange';
                return 'red';
            }

            function getCategoryLabel(cat){
                var labels = {page:'页面脚本', promise:'Promise拒绝', resource:'资源加载', external:'外部扩展', cdn:'CDN资源', webgl:'WebGL', noise:'噪声', other:'其他'};
                return labels[cat] || cat;
            }

            // ===== 持久化与自动导出 =====
            var STORAGE_KEY = 'mrhua_error_monitor_log';
            var AUTO_EXPORT_THRESHOLD = 3;
            var hasAutoExported = false;
            var hasRestored = false;
            var _saveTimer = null;
            var _exportTimer = null;
            var _lastExportCount = 0;
            var _burstExportTimer = null;

            function serializeErrors(){
                return errors.map(function(e){
                    return {
                        category: e.category, msg: e.msg, source: e.source,
                        stack: e.stack ? e.stack.substring(0, 500) : '',
                        count: e.count,
                        firstSeen: e.firstSeen ? e.firstSeen.toISOString() : '',
                        lastSeen: e.lastSeen ? e.lastSeen.toISOString() : ''
                    };
                });
            }

            function saveToStorage(){
                try{
                    var data = {
                        version: DATA_VERSION,
                        totalCount: totalCount,
                        categoryCounts: categoryCounts,
                        errors: serializeErrors().slice(-150),
                        savedAt: new Date().toISOString()
                    };
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
                }catch(e){ /* localStorage 可能满或不可用 */ }
            }

            function scheduleSave(){
                // 同步立即保存，不节流（崩溃前必须写入）
                try{ saveToStorage(); }catch(e){}
            }

            function loadFromStorage(){
                try{
                    var raw = localStorage.getItem(STORAGE_KEY);
                    if(!raw) return;
                    var data = JSON.parse(raw);
                    if(!data || !data.errors) return;

                    // 版本检查：旧版本数据（自递归损坏）自动清除
                    if(data.version !== DATA_VERSION){
                        console.log('%c[ErrorMonitor] 检测到旧版本错误数据，自动清除 (version=' + (data.version||'none') + ')', 'background:#e67e22;color:#fff;font-size:12px;padding:2px 8px;border-radius:3px;');
                        localStorage.removeItem(STORAGE_KEY);
                        return;
                    }

                    // 损坏检测：90%以上是other且包含[ErrorMonitor]，说明是自递归损坏数据
                    var otherCount = 0, selfRecursion = 0;
                    for(var i=0;i<data.errors.length;i++){
                        if(data.errors[i].category === 'other') otherCount++;
                        if(data.errors[i].msg && data.errors[i].msg.indexOf('[ErrorMonitor]') !== -1) selfRecursion++;
                    }
                    if(data.errors.length > 10 && otherCount / data.errors.length > 0.9 && selfRecursion > 0){
                        console.log('%c[ErrorMonitor] 检测到自递归损坏数据 (' + selfRecursion + '/' + data.errors.length + ' 条含ErrorMonitor)，自动清除', 'background:#e67e22;color:#fff;font-size:12px;padding:2px 8px;border-radius:3px;');
                        localStorage.removeItem(STORAGE_KEY);
                        return;
                    }

                    totalCount = data.totalCount || 0;
                    categoryCounts = data.categoryCounts || categoryCounts;
                    for(var i=0;i<data.errors.length;i++){
                        var e = data.errors[i];
                        var err = {
                            id: errors.length,
                            category: e.category,
                            severity: getSeverity(e.category),
                            msg: e.msg,
                            source: e.source,
                            stack: e.stack,
                            count: e.count,
                            firstSeen: e.firstSeen ? new Date(e.firstSeen) : new Date(),
                            lastSeen: e.lastSeen ? new Date(e.lastSeen) : new Date(),
                            restored: true
                        };
                        var key = e.category + '::' + e.msg.substring(0,100) + '::' + e.source;
                        errorMap[key] = err;
                        errors.push(err);
                    }
                    hasRestored = true;
                    console.log('%c[ErrorMonitor] 从本地存储恢复 ' + errors.length + ' 条错误 (累计 ' + totalCount + ')', 'background:#2980b9;color:#fff;font-size:12px;padding:2px 8px;border-radius:3px;');
                }catch(e){ console.warn('[ErrorMonitor] 恢复本地存储失败:', e.message); }
            }

            function doExport(){
                var report = {
                    exportedAt: new Date().toISOString(),
                    totalCount: totalCount,
                    uniqueErrors: errors.length,
                    categoryCounts: categoryCounts,
                    restoredFromStorage: hasRestored,
                    errors: serializeErrors()
                };
                var jsonStr = JSON.stringify(report, null, 2);
                var filename = 'error-report-' + new Date().toISOString().replace(/[:.]/g,'-') + '.json';
                // 同时存到服务端统一数据目录（error-reports/），
                // 免得每次都要去浏览器下载目录里翻。
                try {
                    fetch('/api/errors/report', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: jsonStr
                    }).then(function(r){ return r.json(); }).then(function(j){
                        if(j && j.success){
                            origLog.call(console, '%c[ErrorMonitor] 已存档到 ' + j.path, 'background:#27ae60;color:#fff;font-size:12px;padding:2px 8px;border-radius:3px;');
                        }else{
                            origWarn.call(console, '[ErrorMonitor] 服务端存档失败: ' + ((j && j.error) || '未知原因'));
                        }
                    }).catch(function(e){
                        origWarn.call(console, '[ErrorMonitor] 服务端存档请求失败: ' + e.message);
                    });
                } catch(e) {}
                try {
                    var blob = new Blob([jsonStr], {type:'application/json'});
                    var url = URL.createObjectURL(blob);
                    var a = document.createElement('a');
                    a.href = url; a.download = filename;
                    document.body.appendChild(a); a.click(); document.body.removeChild(a);
                    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
                } catch(e) {}
                try {
                    var dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonStr);
                    window.open(dataUrl, '_blank');
                } catch(e2) {}
                console.log('%c[ErrorMonitor] 已自动导出错误报告 (' + errors.length + ' 条)', 'background:#27ae60;color:#fff;font-size:12px;padding:2px 8px;border-radius:3px;');
            }

            // 页面卸载前保存
            window.addEventListener('beforeunload', saveToStorage);

            function addError(opts){
                if(_inAddError) return; // 重入保护：防止递归
                var msg = opts.msg || '未知错误';
                var source = opts.source || '';
                var stack = opts.stack || '';
                var cat = opts.category || classify(msg, source, stack);
                var key = cat + '::' + msg.substring(0, 100) + '::' + source;
                totalCount++;
                categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;

                if(errorMap[key]){
                    errorMap[key].count++;
                    errorMap[key].lastSeen = new Date();
                    errorMap[key].lastStack = stack;
                } else {
                    var err = {
                        id: errors.length,
                        category: cat,
                        severity: getSeverity(cat),
                        msg: msg,
                        source: source,
                        stack: stack,
                        count: 1,
                        firstSeen: new Date(),
                        lastSeen: new Date()
                    };
                    errorMap[key] = err;
                    errors.push(err);
                    if(errors.length > MAX_ERRORS){ errors.shift(); }
                }

                updateBadge();
                if(overlayEl && overlayEl.style.display === 'block') renderOverlay();

                // 持久化到 localStorage（同步立即保存）
                scheduleSave();

                // 控制台醒目输出（设置重入标志，防止拦截器递归）
                _inAddError = true;
                try{
                    var bgColor = cat === 'noise' ? '#666' : cat === 'external' ? '#ff8c00' : cat === 'cdn' ? '#9932cc' : '#d9363e';
                    console.log('%c[ErrorMonitor] #' + totalCount + ' [' + getCategoryLabel(cat) + '] ' + msg,
                        'background:' + bgColor + ';color:#fff;font-size:12px;padding:2px 8px;border-radius:3px;font-weight:bold;');
                    if(source) console.log('%c  来源: ' + source, 'color:#888;font-size:11px;');
                    if(stack && cat !== 'noise') console.log('%c  堆栈:\n' + stack, 'color:#aaa;font-size:10px;white-space:pre-wrap;');
                }finally{ _inAddError = false; }

                // 标题栏实时显示错误摘要（崩溃前从任务栏也能看到）
                updateTitle();
            }

            function updateTitle(){
                var displayCount = totalCount - (categoryCounts.noise || 0);
                if(displayCount > 0){
                    var parts = [];
                    for(var cat in categoryCounts){
                        if(cat !== 'noise' && categoryCounts[cat] > 0){
                            parts.push(getCategoryLabel(cat) + categoryCounts[cat]);
                        }
                    }
                    document.title = '⚠️' + displayCount + '错误 ' + parts.join(' ') + ' | MrHua';
                }
            }

            // 定时保存（每5秒，作为崩溃前兜底）
            function startPeriodicSave(){
                _exportTimer = setInterval(function(){
                    saveToStorage();
                }, 5000);
            }

            // 控制台一键导出（崩溃前快速输入）
            window.__dumpErrors = function(){
                var data = {
                    totalCount: totalCount,
                    categoryCounts: categoryCounts,
                    errors: serializeErrors()
                };
                var json = JSON.stringify(data, null, 2);
                console.log('%c===== ERROR DUMP (' + errors.length + ' unique, ' + totalCount + ' total) =====', 'background:var(--theme-accent);color:#fff;font-size:14px;padding:4px 12px;');
                console.log(json);
                console.log('%c===== END DUMP =====', 'background:var(--theme-accent);color:#fff;font-size:14px;padding:4px 12px;');
                try{
                    navigator.clipboard.writeText(json).then(function(){
                        console.log('%c✅ 错误报告已复制到剪贴板', 'background:#27ae60;color:#fff;font-size:12px;padding:2px 8px;');
                    });
                }catch(e){}
                return json;
            };

            // 控制台快速查看摘要
            window.__errorStats = function(){
                console.log('%c===== ERROR STATS =====', 'background:#2980b9;color:#fff;font-size:14px;padding:4px 12px;');
                console.log('总计:', totalCount, '去重:', errors.length);
                for(var cat in categoryCounts){
                    if(categoryCounts[cat] > 0){
                        console.log('  ' + getCategoryLabel(cat) + ': ' + categoryCounts[cat]);
                    }
                }
                console.log('===== TOP 10 ERRORS =====');
                var sorted = errors.slice().sort(function(a,b){ return b.count - a.count; }).slice(0,10);
                for(var i=0;i<sorted.length;i++){
                    console.log('  #' + (i+1) + ' [' + getCategoryLabel(sorted[i].category) + '] x' + sorted[i].count + ': ' + sorted[i].msg.substring(0,100));
                }
            };

            function updateBadge(){
                if(!toggleBtn) return;
                var displayCount = totalCount - categoryCounts.noise;
                if(displayCount <= 0){ toggleBtn.textContent = '🔍Monitor'; toggleBtn.style.background = '#27ae60'; return; }
                var worst = 'red';
                for(var cat in categoryCounts){
                    if(categoryCounts[cat] > 0 && cat !== 'noise'){
                        var sev = getSeverity(cat);
                        if(sev === 'red'){ worst = 'red'; break; }
                        if(sev === 'orange') worst = 'orange';
                    }
                }
                toggleBtn.textContent = '🔍 ' + displayCount;
                toggleBtn.style.background = worst === 'red' ? 'var(--theme-accent)' : '#f39c12';
            }

            function renderOverlay(){
                if(!overlayEl) return;
                var filtered = currentFilter === 'all' ? errors : errors.filter(function(e){ return e.category === currentFilter; });
                var html = '<div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #444;">';
                html += '<div style="font-weight:bold;color:#ff0;font-size:14px;margin-bottom:6px;">🔍 错误监控中心</div>';
                html += '<div style="font-size:11px;color:#aaa;margin-bottom:8px;">累计 ' + totalCount + ' 条 | 去重后 ' + errors.length + ' 条' + (hasRestored ? ' | 📂 含上次会话恢复' : '') + '</div>';
                if(hasRestored){
                    html += '<div style="font-size:10px;color:#3498db;margin-bottom:6px;padding:4px 8px;background:rgba(52,152,219,0.1);border-radius:3px;">📂 部分错误从本地存储恢复（程序崩溃前已保存），可点击"导出JSON"获取完整报告</div>';
                }
                // 分类统计条
                html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">';
                var cats = ['all','page','promise','resource','external','cdn','webgl','noise','other'];
                for(var i=0;i<cats.length;i++){
                    var c = cats[i];
                    var cnt = c === 'all' ? errors.length : (categoryCounts[c] || 0);
                    if(c !== 'all' && cnt === 0) continue;
                    var active = currentFilter === c;
                    var label = c === 'all' ? '全部' : getCategoryLabel(c);
                    html += '<button data-filter="' + c + '" style="padding:3px 8px;font-size:10px;border:1px solid ' + (active?'#ff0':'#555') + ';border-radius:3px;cursor:pointer;background:' + (active?'#333':'transparent') + ';color:' + (active?'#ff0':'#aaa') + ';">' + label + ' (' + cnt + ')</button>';
                }
                html += '</div>';
                // 操作按钮
                html += '<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;">';
                html += '<button id="em-export" style="padding:4px 10px;font-size:10px;background:#2980b9;color:#fff;border:none;border-radius:3px;cursor:pointer;">📥 导出JSON</button>';
                html += '<button id="em-clear" style="padding:4px 10px;font-size:10px;background:#c0392b;color:#fff;border:none;border-radius:3px;cursor:pointer;">🗑️ 清空记录</button>';
                html += '</div>';
                html += '</div>';

                if(filtered.length === 0){
                    html += '<div style="color:#0f0;text-align:center;padding:20px;">✅ 该分类暂无错误</div>';
                }

                for(var i=filtered.length-1;i>=0;i--){
                    var e = filtered[i];
                    var sevColor = e.severity === 'red' ? '#ff6b6b' : e.severity === 'orange' ? '#ffa500' : '#888';
                    html += '<div style="margin-bottom:10px;padding:8px;border-left:3px solid ' + sevColor + ';background:rgba(255,255,255,0.03);border-radius:0 4px 4px 0;">';
                    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">';
                    html += '<span style="color:' + sevColor + ';font-weight:bold;font-size:11px;">[' + getCategoryLabel(e.category) + ']' + (e.count > 1 ? ' ×' + e.count : '') + '</span>';
                    html += '<span style="color:#666;font-size:10px;">' + e.firstSeen.toLocaleTimeString() + '</span>';
                    html += '</div>';
                    html += '<div style="color:#eee;font-size:11px;word-break:break-all;margin-bottom:4px;">' + escapeHtml(e.msg) + '</div>';
                    if(e.source){ html += '<div style="color:#888;font-size:10px;word-break:break-all;">📄 ' + escapeHtml(e.source) + '</div>'; }
                    if(e.stack && e.category !== 'noise'){
                        html += '<details style="margin-top:4px;"><summary style="color:#6cf;cursor:pointer;font-size:10px;">查看堆栈</summary>';
                        html += '<pre style="color:#aaa;font-size:9px;white-space:pre-wrap;word-break:break-all;margin-top:4px;max-height:200px;overflow:auto;background:rgba(0,0,0,0.3);padding:6px;border-radius:3px;">' + escapeHtml(e.stack) + '</pre>';
                        html += '</details>';
                    }
                    html += '<button data-copy="' + e.id + '" style="margin-top:4px;padding:2px 6px;font-size:9px;background:#555;color:#fff;border:none;border-radius:2px;cursor:pointer;">复制详情</button>';
                    html += '</div>';
                }
                overlayEl.innerHTML = html;

                // 绑定事件
                var filterBtns = overlayEl.querySelectorAll('[data-filter]');
                for(var i=0;i<filterBtns.length;i++){
                    filterBtns[i].onclick = function(){ currentFilter = this.getAttribute('data-filter'); renderOverlay(); };
                }
                var copyBtns = overlayEl.querySelectorAll('[data-copy]');
                for(var i=0;i<copyBtns.length;i++){
                    copyBtns[i].onclick = function(){
                        var id = parseInt(this.getAttribute('data-copy'));
                        var err = errors.find(function(e){ return e.id === id; });
                        if(err){
                            var text = '[' + getCategoryLabel(err.category) + '] ' + err.msg + '\n来源: ' + err.source + '\n次数: ' + err.count + '\n首次: ' + err.firstSeen.toISOString() + '\n堆栈:\n' + err.stack;
                            navigator.clipboard.writeText(text).then(function(){}, function(){});
                        }
                    };
                }
                var exportBtn = document.getElementById('em-export');
                if(exportBtn) exportBtn.onclick = function(){
                    var report = {
                        exportedAt: new Date().toISOString(),
                        totalCount: totalCount,
                        uniqueErrors: errors.length,
                        categoryCounts: categoryCounts,
                        errors: errors.map(function(e){
                            return {category:e.category, msg:e.msg, source:e.source, stack:e.stack, count:e.count, firstSeen:e.firstSeen.toISOString(), lastSeen:e.lastSeen.toISOString()};
                        })
                    };
                    var jsonStr = JSON.stringify(report, null, 2);
                    var filename = 'error-report-' + Date.now() + '.json';
                    var ta = document.createElement('textarea');
                    ta.value = jsonStr; ta.style.position='fixed'; ta.style.opacity='0'; ta.style.left='-9999px';
                    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, jsonStr.length);
                    try { document.execCommand('copy'); console.log('[ErrorMonitor] JSON已复制到剪贴板 (' + jsonStr.length + '字节)'); alert('错误报告JSON已复制到剪贴板，可直接粘贴保存为' + filename); }
                    catch(e) { try { navigator.clipboard.writeText(jsonStr); alert('错误报告JSON已复制到剪贴板'); } catch(e2){ alert('复制失败，请手动选择文本复制'); } }
                    document.body.removeChild(ta);
                    try {
                        var dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonStr);
                        var a = document.createElement('a');
                        a.href = dataUrl; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a);
                    } catch(e3) {}
                };
                var clearBtn = document.getElementById('em-clear');
                if(clearBtn) clearBtn.onclick = function(){
                    console.log('[ErrorMonitor] 清空记录按钮被点击');
                    errors = []; errorMap = {}; totalCount = 0;
                    categoryCounts = {page:0, promise:0, resource:0, external:0, cdn:0, webgl:0, noise:0, other:0};
                    try{ localStorage.removeItem(STORAGE_KEY); console.log('[ErrorMonitor] localStorage已清除'); }catch(e){ console.log('[ErrorMonitor] localStorage清除失败:', e.message); }
                    hasRestored = false;
                    updateBadge(); renderOverlay();
                    console.log('[ErrorMonitor] 清空完成，当前错误数:', errors.length);
                };
                var clearStorageBtn = document.getElementById('em-clear-storage');
                if(clearStorageBtn) clearStorageBtn.onclick = function(){
                    try{ localStorage.removeItem(STORAGE_KEY); }catch(e){}
                    hasRestored = false;
                    errors = errors.filter(function(e){ return !e.restored; });
                    errorMap = {};
                    for(var i=0;i<errors.length;i++){ var k = errors[i].category + '::' + errors[i].msg.substring(0,100) + '::' + errors[i].source; errorMap[k] = errors[i]; }
                    categoryCounts = {page:0, promise:0, resource:0, external:0, cdn:0, webgl:0, noise:0, other:0};
                    totalCount = 0;
                    for(var i=0;i<errors.length;i++){ categoryCounts[errors[i].category] = (categoryCounts[errors[i].category]||0) + errors[i].count; totalCount += errors[i].count; }
                    updateBadge(); renderOverlay();
                };
            }

            function escapeHtml(str){
                if(!str) return '';
                var div = document.createElement('div');
                div.textContent = str;
                return div.innerHTML;
            }

            function init(){
                // 从 localStorage 恢复上次会话的错误（防止崩溃丢失）
                loadFromStorage();
                // 启动定时导出（每15秒检查一次）
                startPeriodicSave();
                // 如果恢复了错误，立即更新标题
                updateTitle();

                toggleBtn = document.createElement('button');
                toggleBtn.id = 'error-monitor-toggle';
                toggleBtn.textContent = '🔍Monitor';
                toggleBtn.style.cssText = 'position:fixed;top:10px;left:10px;z-index:2147483647;background:#27ae60;color:#fff;border:none;padding:8px 14px;border-radius:4px;font-size:13px;cursor:pointer;opacity:0.9;font-weight:bold;box-shadow:0 2px 8px rgba(0,0,0,0.3);transition:background 0.3s;';
                toggleBtn.onmouseover = function(){ toggleBtn.style.opacity = '1'; };
                toggleBtn.onmouseout = function(){ toggleBtn.style.opacity = '0.9'; };
                toggleBtn.onclick = function(){
                    if(!overlayEl){
                        overlayEl = document.createElement('div');
                        overlayEl.id = 'error-monitor-overlay';
                        overlayEl.style.cssText = 'position:fixed;top:55px;left:10px;z-index:2147483647;background:rgba(15,15,20,0.97);color:#eee;font-family:monospace;font-size:11px;padding:12px;border-radius:8px;max-width:520px;max-height:80vh;overflow:auto;display:none;box-shadow:0 8px 32px rgba(0,0,0,0.6);border:1px solid #444;backdrop-filter:blur(10px);';
                        document.body.appendChild(overlayEl);
                    }
                    overlayEl.style.display = overlayEl.style.display === 'none' ? 'block' : 'none';
                    if(overlayEl.style.display === 'block') renderOverlay();
                };
                document.body.appendChild(toggleBtn);

                // 控制台关键词过滤（只捕获包含这些关键词的 console.warn/log）
                var CONSOLE_KEYWORDS = /error|fail|warn|blocked|refused|denied|invalid|undefined|null|exception|tracking|prevention|framemanager|could not|cannot|unable|deprecated|404|500|401|403/i;

                // 错误对象的 message / stack 是不可枚举属性，JSON.stringify(Error) 只会得到 "{}"，
                // 会把真实报错信息完全丢掉。这里显式取出 name / message / stack。
                function mrErrText(a){
                    try{
                        if(!a) return String(a);
                        // instanceof 在不同 realm（iframe / 弹出窗口 / 跨窗口抛出）之间会失效，
                        // 这里补一层鸭子类型判断，避免真实报错又退化成 "{}"。
                        var isErr = (a instanceof Error) || (
                            typeof a === 'object' &&
                            typeof a.message === 'string' &&
                            (typeof a.stack === 'string' ||
                             Object.prototype.toString.call(a).indexOf('Error') !== -1)
                        );
                        if(isErr){
                            return (a.name || 'Error') + ': ' + (a.message || '') + (a.stack ? '\n' + a.stack : '');
                        }
                        if(a && typeof a === 'object'){
                            try{
                                var s = JSON.stringify(a);
                                if(s && s !== '{}') return s;
                            }catch(e){}
                            if(typeof a.message === 'string') return (a.name ? a.name + ': ' : '') + a.message;
                            return Object.prototype.toString.call(a);
                        }
                        return String(a);
                    }catch(e){ return String(a); }
                }

                // 拦截 console.error
                var origError = console.error;
                console.error = function(){
                    var args = Array.prototype.slice.call(arguments);
                    var msg = args.map(mrErrText).join(' ');
                    if(msg.indexOf('[ErrorMonitor]') === -1){
                        addError({msg:msg, source:'console.error', stack:new Error().stack, category:'page'});
                    }
                    origError.apply(console, args);
                };

                // 拦截 console.warn（捕获 Tracking Prevention、FrameManager 等浏览器警告）
                var origWarn = console.warn;
                console.warn = function(){
                    var args = Array.prototype.slice.call(arguments);
                    var msg = args.map(mrErrText).join(' ');
                    if(msg.indexOf('[ErrorMonitor]') === -1 && CONSOLE_KEYWORDS.test(msg)){
                        addError({msg:msg, source:'console.warn', stack:'', category: classify(msg, 'console.warn', '')});
                    }
                    origWarn.apply(console, args);
                };

                // 拦截 console.log（捕获部分浏览器输出的错误信息）
                var origLog = console.log;
                console.log = function(){
                    var args = Array.prototype.slice.call(arguments);
                    var msg = args.map(mrErrText).join(' ');
                    if(msg.indexOf('[ErrorMonitor]') === -1 && CONSOLE_KEYWORDS.test(msg) && /error|fail|blocked|refused|invalid|exception|could not|cannot|unable|404|500|401/i.test(msg)){
                        addError({msg:msg, source:'console.log', stack:'', category: classify(msg, 'console.log', '')});
                    }
                    origLog.apply(console, args);
                };

                // 拦截资源加载错误（捕获阶段）
                document.addEventListener('error', function(e){
                    var target = e.target;
                    if(target && (target.tagName === 'SCRIPT' || target.tagName === 'IMG' || target.tagName === 'LINK' || target.tagName === 'SOURCE')){
                        var url = target.src || target.href || '';
                        var tag = target.tagName.toLowerCase();
                        addError({msg:'资源加载失败: <' + tag + '> ' + url, source:url, stack:'', category:'resource'});
                    }
                }, true);
            }

            return {
                init: init,
                add: addError,
                getStats: function(){ return {total:totalCount, unique:errors.length, categories:categoryCounts}; },
                getErrors: function(){ return errors; }
            };
        })();

        // 页面加载后初始化错误监控；嵌入页不创建悬浮按钮/面板。
        if (!_EMBED_WANSHARE) setTimeout(function(){ ErrorMonitor.init(); }, 300);

        function showErrorPanel(msg, detail) {
            if (_EMBED_WANSHARE || _errorPanel) return;
            _errorPanel = document.createElement('div');
            _errorPanel.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:#fff3f0;border-bottom:2px solid #d9363e;padding:12px 20px;font-family:inherit;box-shadow:0 2px 10px rgba(0,0,0,0.1);';
            _errorPanel.innerHTML = '<div style="display:flex;align-items:flex-start;gap:12px;">' +
                '<span style="font-size:1.2rem;">⚠️</span>' +
                '<div style="flex:1;">' +
                '<div style="font-weight:600;color:#d9363e;font-size:0.9rem;margin-bottom:4px;">页面脚本错误</div>' +
                '<div style="color:#666;font-size:0.8rem;word-break:break-all;">' + (msg || '未知错误') + '</div>' +
                (detail ? '<div style="color:#999;font-size:0.72rem;margin-top:4px;word-break:break-all;">' + detail + '</div>' : '') +
                '<div style="margin-top:6px;font-size:0.75rem;color:#888;">提示：按 Cmd+Shift+R 强制刷新清除缓存，或完全退出应用后重启</div>' +
                '</div>' +
                '<button onclick="this.closest(\'div\').parentElement.remove();window._errorPanel=null;" style="background:none;border:none;color:#999;font-size:1.1rem;cursor:pointer;padding:0 4px;">✕</button>' +
                '</div>';
            document.body.appendChild(_errorPanel);
            window._errorPanel = _errorPanel;
        }

        // 全局错误兜底，防止单个错误中断整个交互
        window.addEventListener('error', function(e){
            var msg = e.message || '未知错误';
            var loc = (e.filename || '') + ':' + (e.lineno || 0) + ':' + (e.colno || 0);
            // 过滤无意义的噪声错误（无消息、无文件名、无行号），通常来自第三方库、GPU 内部，
            // 或者资源加载失败被捕获阶段重复收到。必须在 ErrorMonitor.add 之前返回 ——
            // 以前先 add 再 return，噪声照样进报告（表现为 source 为 ":0:0" 的"未知错误"）。
            if (msg === '未知错误' && loc === ':0:0') {
                return;
            }
            var stack = e.error ? e.error.stack : '';
            // 上报到错误监控中心
            ErrorMonitor.add({msg:msg, source:loc, stack:stack});
            console.warn('[Orb] caught:', msg, 'at', loc, stack);
            _errorCount++;
            // 连续3个以上非噪声错误或包含关键模块错误时显示面板
            if (_errorCount >= 3 || /orb_extra|app\.js|world3d|OrbHub/.test(msg + loc)) {
                showErrorPanel(msg, loc);
            }
            e.preventDefault && e.preventDefault();
        }, true);
        window.addEventListener('unhandledrejection', function(e){
            var reason = e.reason ? (e.reason.message || String(e.reason)) : '未知Promise错误';
            var stack = e.reason && e.reason.stack ? e.reason.stack : '';
            // 上报到错误监控中心
            ErrorMonitor.add({msg:reason, source:'unhandledrejection', stack:stack, category:'promise'});
            // 带上堆栈，否则只看到一句报错无法定位是哪一行
            console.warn('[Orb] unhandled rejection:', reason, stack ? ('\n' + stack) : '');
            _errorCount++;
            if (_errorCount >= 3) {
                showErrorPanel(reason, 'unhandledrejection');
            }
            e.preventDefault && e.preventDefault();
        });
    })();
