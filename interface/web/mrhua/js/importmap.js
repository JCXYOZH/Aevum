/* 三方库开关：Aevum 当前没有 /cdn-proxy，默认关闭；需要 three/VRM 时手动打开 */
    (function(){
        try {
            var allowThirdParty = localStorage.getItem('mrhua_allow_third_party');
            if (allowThirdParty === 'true') {
                var importMap = document.createElement('script');
                importMap.type = 'importmap';
                importMap.textContent = JSON.stringify({
                    "imports": {
                        "three": "/cdn-proxy/three@0.170.0/build/three.module.js",
                        "three/addons/": "/cdn-proxy/three@0.170.0/examples/jsm/",
                        "@pixiv/three-vrm": "/cdn-proxy/@pixiv/three-vrm@3.4.1/lib/three-vrm.module.js"
                    }
                });
                document.head.appendChild(importMap);
            }
        } catch(e) {
            console.warn('[三方库开关] importmap注入失败:', e);
        }
    })();
