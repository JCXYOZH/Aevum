/**
 * 旧 3D 灵体引擎装载器。
 *
 * 页面拆分后由 boot.js 在 DOM 与 UI 脚本就绪后调用。
 * 这里只装载 Aevum 实际存在的 legacy orb 模块；旧页面里缺失的
 * spirit-render-extra / humanoid-action / world3d-main 等文件不在此处猜测路径。
 */
window.startMrHuaEngine = function startMrHuaEngine() {
    if (!window.OrbLoader || typeof window.OrbLoader.loadAll !== 'function') {
        console.warn('[引擎] OrbLoader 未就绪，跳过 3D 灵体装载');
        return;
    }

    console.log('[引擎] 开始装载 legacy orb 模块，共 ' + window.OrbLoader.moduleCount + ' 个文件');
    window.OrbLoader.loadAll(function (result) {
        if (!result || !result.success) {
            console.error('[引擎] legacy orb 模块装载失败', result && result.errors);
            return;
        }
        console.log('[引擎] legacy orb 模块装载完成 ' + result.loaded + '/' + result.total);
    });
};
