/**
 * World3D — 全屏 3D 世界引擎
 *
 * 一个全屏 WebGL canvas，3D 模型住在浏览器窗口的 3D 空间里。
 * DOM 窗口浮在上方，模型在后面/旁边走动，可以穿过窗口。
 *
 * 只做一件事：可靠地显示 GLB 模型并让它在屏幕空间自主移动。
 * 标准 PBR 材质，不碰自定义 shader。
 */
(function() {
    'use strict';

    let THREE = null;
    let GLTFLoader = null;
    let FBXLoader = null;
    let VRMLoaderPlugin = null;
    let VRMUtils = null;
    let currentVRM = null;
    let renderer = null;
    let scene = null;
    let camera = null;
    let canvas = null;
    let currentModel = null;
    let clock = null;
    let stageObject = null;
    let stageType = null;
    let procAnimator = null;  // ProceduralAnimator 统一动作引擎

    // === Mixamo 参考骨架 + 世界空间重定向（VRM 跑步/走路动作）===
    let mixamoRoot = null;      // Mixamo 骨架（参考骨架，不渲染）
    let mixamoMixer = null;     // Mixamo 骨架的 mixer
    let mixamoIdleAction = null;
    let mixamoWalkAction = null;
    let mixamoRunAction = null;
    let allMixamoActions = {};
    let boneMap = [];           // Mixamo→VRM 骨骼映射
    let animClipsLoaded = false;
    let animBlend = 0;          // idle/walk 混合权重
    let oneShotAnimation = null;
    let mixamoHipsBone = null;
    let mixamoHipsRestPos = null;
    let vrmHipsBone = null;
    let vrmHipsRestPos = null;
    let hipsPosScale = 1.0;

    // === 剪影灵体模式 ===
    let silhouetteMode = false;      // 是否为剪影灵体模式
    let silhouetteState = 'idle';    // 当前状态: idle/happy/thinking/working/talking/sleeping/error
    let silhouetteColor = '#8b5cf6'; // 剪影颜色
    let silhouetteOpacity = 0.85;     // 剪影透明度
    let silhouetteGlow = 0.3;         // 发光强度 0-1
    let silhouetteMaterials = [];      // 剪影材质列表
    let silhouetteBasePos = null;      // 基础位置
    let silhouetteAnimTime = 0;        // 动画时间
    // 剪影模式动作系统
    let silActionQueue = [];           // 动作队列
    let silCurrentAction = null;       // 当前动作
    let silActionTime = 0;              // 动作时间
    let silActionBlend = 0;             // 动作混合权重
    // 剪影模式粒子系统
    let silParticleCanvas = null;       // 粒子Canvas
    let silParticleCtx = null;          // 粒子上下文
    let silParticles = [];               // 粒子列表
    let silParticleAnimId = null;        // 粒子动画ID

    // === 动画状态机与程序化动作系统 ===
    let animState = 'idle';     // 当前基础状态: idle/walk/run
    let actionQueue = [];        // 动作队列: [{name, duration, priority, startTime, bones}]
    let currentAction = null;    // 当前执行的动作
    let actionBlend = 0;         // 动作混合权重 (0-1)
    let actionDebugFrame = -1;    // 动作调试帧计数器 (-1=不调试)
    // 实时调试偏移: 按键盘调整上臂偏移, 找出正确的旋转轴
    let debugArmMode = false;
    let debugArmOffset = { x: 0, y: 0, z: 0 };
    // 挥手动作偏移覆盖（控制台实时调试用）
    let waveOverride = null;
    // 通用动作偏移覆盖: { actionName: { boneName: {x, y, z} } }
    let actionOverrides = {};

    // 程序化动作定义: duration秒, bones影响的骨骼, priority优先级(1低-3高)
    const PROCEDURAL_ACTIONS = {
        wave:     { duration: 2.0, priority: 2, desc: '挥手' },
        nod:      { duration: 1.5, priority: 2, desc: '点头' },
        shake:    { duration: 1.8, priority: 2, desc: '摇头' },
        think:    { duration: 3.0, priority: 1, desc: '思考(摸下巴)' },
        happy:    { duration: 2.5, priority: 3, desc: '开心(举手跳跃)' },
        surprise: { duration: 1.2, priority: 3, desc: '惊讶(后仰举手)' },
        point:    { duration: 2.0, priority: 2, desc: '指方向' },
        clap:     { duration: 2.0, priority: 2, desc: '鼓掌' },
        shrug:    { duration: 1.5, priority: 1, desc: '耸肩' },
        bow:      { duration: 2.0, priority: 2, desc: '鞠躬' },
        yawn:     { duration: 2.5, priority: 1, desc: '打哈欠' },
        dance:    { duration: 4.0, priority: 2, desc: '跳舞' },
    };

    // 模型状态
    let modelRoot = null;
    let targetPos = null;
    let currentPos = null;
    let modelScale = 1;
    let baseScale = 1;
    let isVisible = false;

    // 自主漫游
    let wander = {
        mode: 'idle',       // idle | walking
        tx: 0, ty: 0,       // 目标屏幕坐标
        nextMove: 0,        // 下次选目标的时间
        speed: 70,          // 像素/秒
        vx: 0, vy: 0,       // 当前速度（像素/秒）
        reactTimer: 0,      // 反应（看窗口）计时
        lookAtWindow: null  // 临时看向的窗口位置
    };

    // 动画状态
    let mouseNDC = { x: 0, y: 0 };
    let breathPhase = 0;
    let idlePhase = Math.random() * 100;
    let lastFrameTime = 0;
    let needsRender = true;
    let rafId = null;
    let blinkTimer = 2 + Math.random() * 3;
    let blinkProgress = 1;
    let lookTimer = 0;
    let lookTarget = { x: 0, y: 0 };
    let lookCurrent = { x: 0, y: 0 };
    let weightShift = 0;
    let secondarySprings = [];
    let walkPhase = 0;

    // 动作状态
    let motionState = { fly: 0, dock: 0, companion: 0 };
    let motionTarget = { fly: 0, dock: 0, companion: 0 };
    let nextActionTime = 3 + Math.random() * 3;
    let actionStart = 0;
    let actionType = 0;
    let reactionArm = null;
    let reactionStart = 0;
    let modelState = 'idle';

    // 骨骼缓存
    let bones = {};
    let normalizedBones = {};  // VRM 归一化骨骼（T-pose空间，程序化动画优先使用）
    let restRotations = {};   // 初始姿态欧拉角（备用）
    let restQuats = {};       // 初始姿态四元数（本地空间）
    let restWorldQuats = {};  // 初始姿态四元数（世界空间，key=骨骼原名）
    let relaxQuats = {};      // A-pose 放松偏移四元数（本地空间）
    let secondaryBones = [];
    let blinkMorph = null;
    let morphMeshes = [];
    let allBoneNames = [];
    let vrmBonesAll = {};           // VRM模型所有骨骼（key=骨骼原名），模块级共享

    // ---- 动作配置（可调，可保存） ----
    const defaultConfig = {
        idle: {
            breathAmp: 0.015, breathFreq: 1.6,
            weightShiftAmp: 0.008, weightShiftFreq: 0.3,
            swayAmp: 0.02, swayFreq: 0.5,
            idleBobAmp: 0.002, idleBobFreq: 1.6,
            idleSwayAmp: 0.004, idleSwayFreq: 0.5,
            headLookRange: 0.18, headAutonomousRange: 0.3,
            blinkMin: 2.5, blinkMax: 5.5,
            actionMin: 5, actionMax: 10
        },
        walk: {
            armSwing: 0.3, forearmBend: 0.15,
            legSwing: 0.35, kneeBend: 0.45,
            hipBob: 0.015, hipSway: 0.015,
            spineTwist: 0.06, walkBob: 0.02,
            accel: 2.5, decel: 4.0, speed: 70
        },
        pose: {
            armOutX: 0.18, armForwardZ: 0,
            elbowBend: 0.12, elbowSide: 0.04,
            shoulderDrop: 0.03, shoulderSide: 0.02,
            idleElbowBend: 0.06, idleKneeBend: 0.04,
            // === 腿部默认内收姿态（已通过Blender烘焙进Lime.vrm的rest pose）===
            thighInward: 1.26,    // 大腿内收 72°
            calfInward: 1.32,     // 小腿内收 75.6°
            footInward: 1.57,     // 脚内收 90°
            elbowBendIdle: 0.15,  // 肘部弯曲 8.6°（站立时）
            shoulderDropIdle: 0.05, // 肩膀下沉 2.9°
            headTilt: 0.05,       // 头部微倾 2.9°
            // === 膝盖内扣修复（新上传模型自动应用）===
            // 方向与 Blender 修复一致：左腿+Y，右腿-Y（小腿内旋让膝盖朝前）
            kneeFixCalfY: 0.25,   // 小腿膝盖修复 14°（内旋，让膝盖朝前）
            kneeFixThighY: 0.05   // 大腿膝盖修复 3°（外旋，配合小腿）
        },
        camera: {
            parallaxX: 0.15, parallaxY: 0.08, parallaxSpeed: 0.04
        },
        manualPose: {}
    };
    let motionConfig = JSON.parse(JSON.stringify(defaultConfig));
    let configLoaded = false;

    let configLoadPromise = null;
    function loadMotionConfig() {
        if (configLoadPromise) return configLoadPromise;
        configLoadPromise = fetch('/api/orb/motion_config').then(r => r.json()).then(data => {
            if (data && typeof data === 'object') {
                // 浅合并每层
                for (const k of Object.keys(defaultConfig)) {
                    if (data[k] && typeof data[k] === 'object' && !Array.isArray(data[k])) {
                        Object.assign(motionConfig[k], data[k]);
                    }
                }
                if (data.manualPose) motionConfig.manualPose = data.manualPose;
            }
            configLoaded = true;
            // 配置加载完成后，如果模型已加载，重新应用姿态
            if (currentModel && Object.keys(bones).length > 0) {
                relaxQuats = {};
                try { autoFixPose(); } catch(e) { console.warn('[World3D] 应用已保存姿态失败:', e); }
                needsRender = true;
            }
            console.log('[World3D] 动作配置已加载');
        }).catch(() => { configLoaded = true; });
        return configLoadPromise;
    }

    // ---- 动画剪辑加载（Mixamo 参考骨架 + 世界空间重定向）----

    function loadAnimClips() {
        if (animClipsLoaded || !currentModel) return Promise.resolve();
        const animUrl = '/static/animations/all_animations.glb';
        console.log('[World3D] 开始加载动画剪辑:', animUrl);
        const configReady = configLoadPromise || Promise.resolve();
        return configReady.then(() => new Promise((resolve) => {
            const loader = new GLTFLoader();
            loader.load(animUrl, (gltf) => {
                if (!gltf.animations || gltf.animations.length === 0) {
                    console.warn('[World3D] 动画文件中无剪辑');
                    resolve();
                    return;
                }
                mixamoRoot = gltf.scene;
                mixamoRoot.traverse(n => { if (n.isMesh) n.visible = false; });
                scene.add(mixamoRoot);
                const mixamoBones = {};
                mixamoRoot.traverse(n => {
                    if (n.isBone) {
                        const shortName = n.name.replace('mixamorig:', '').replace('mixamorig', '');
                        mixamoBones[shortName] = n;
                    }
                });
                const MIXAMO_TO_VRM = [
                    ['Hips','hips'],['Spine','spine'],['Spine1','chest'],
                    ['Neck','neck'],['Head','head'],
                    ['LeftShoulder','leftShoulder'],['LeftArm','leftUpperArm'],
                    ['LeftForeArm','leftLowerArm'],['LeftHand','leftHand'],
                    ['RightShoulder','rightShoulder'],['RightArm','rightUpperArm'],
                    ['RightForeArm','rightLowerArm'],['RightHand','rightHand'],
                    ['LeftUpLeg','leftUpperLeg'],['LeftLeg','leftLowerLeg'],
                    ['LeftFoot','leftFoot'],['RightUpLeg','rightUpperLeg'],
                    ['RightLeg','rightLowerLeg'],['RightFoot','rightFoot'],
                ];
                mixamoMixer = new THREE.AnimationMixer(mixamoRoot);
                allMixamoActions = {};
                for (const clip of gltf.animations) {
                    const name = clip.name.toLowerCase();
                    const action = mixamoMixer.clipAction(clip);
                    allMixamoActions[name] = action;
                    if (name === 'idle') { mixamoIdleAction = action; action.play(); }
                    else if (name === 'walk') { mixamoWalkAction = action; action.play(); action.weight = 0; }
                    else if (name === 'run') { mixamoRunAction = action; action.play(); action.weight = 0; }
                }
                console.log('[World3D] 可用动画:', Object.keys(allMixamoActions));
                mixamoRoot.updateMatrixWorld(true);
                const mixamoRestWorld = {};
                for (const mName of new Set(MIXAMO_TO_VRM.map(p => p[0]))) {
                    if (mixamoBones[mName]) {
                        const wq = new THREE.Quaternion();
                        mixamoBones[mName].getWorldQuaternion(wq);
                        mixamoRestWorld[mName] = wq.clone();
                    }
                }
                mixamoMixer.update(0);
                mixamoRoot.updateMatrixWorld(true);
                vrmBonesAll = {};
                currentModel.traverse(n => { if (n.isBone && n.name) vrmBonesAll[n.name] = n; });
                currentModel.updateMatrixWorld(true);
                mixamoHipsBone = mixamoBones['Hips'] || null;
                vrmHipsBone = vrmBonesAll['Hips'] || vrmBonesAll['hips'] || null;
                for (const [k, b] of Object.entries(vrmBonesAll)) {
                    if (k.toLowerCase() === 'hips' || k === 'J_Bip_C_Hips') { vrmHipsBone = b; break; }
                }
                if (mixamoHipsBone && vrmHipsBone) {
                    const mw = new THREE.Vector3(), vw = new THREE.Vector3();
                    mixamoHipsBone.getWorldPosition(mw);
                    vrmHipsBone.getWorldPosition(vw);
                    hipsPosScale = Math.abs(vw.y) / Math.max(Math.abs(mw.y), 0.01);
                }
                if (currentVRM) {
                    const humanoid = currentVRM.humanoid;
                    boneMap = [];
                    currentModel.updateMatrixWorld(true);
                    for (const [mName, vrmName] of MIXAMO_TO_VRM) {
                        const mBone = mixamoBones[mName];
                        const vBone = humanoid.getRawBoneNode(vrmName);
                        const mRestW = mixamoRestWorld[mName];
                        if (mBone && vBone && mRestW) {
                            const vRestW = new THREE.Quaternion();
                            vBone.getWorldQuaternion(vRestW);
                            boneMap.push({ mName, vrmName, mBone, vBone,
                                mRestWorld: mRestW.clone(), vRestWorld: vRestW.clone(), isVRM: true });
                        }
                    }
                    console.log('[World3D] VRM 骨骼映射: ' + boneMap.length + '/' + MIXAMO_TO_VRM.length + ' 对');
                }
                if (mixamoIdleAction) { animClipsLoaded = true; console.log('[World3D] 动画剪辑加载成功'); }
                resolve();
            }, (xhr) => {
                if (xhr.lengthComputable) {
                    const pct = Math.round(xhr.loaded / xhr.total * 100);
                    if (pct % 25 === 0) console.log('[World3D] 动画文件下载: ' + pct + '%');
                }
            }, (err) => {
                console.warn('[World3D] 动画剪辑加载失败，使用程序化动画:', err);
                resolve();
            });
        }));
    }

    function saveMotionConfig() {
        return fetch('/api/orb/motion_config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(motionConfig)
        }).then(r => r.json());
    }

    function resetMotionConfig() {
        motionConfig = JSON.parse(JSON.stringify(defaultConfig));
    }

    // ---- 初始化 ----

    function init() {
        if (canvas) return;

        canvas = document.createElement('canvas');
        canvas.id = 'world3d-canvas';
        canvas.style.cssText = [
            'position:fixed', 'inset:0', 'width:100%', 'height:100%',
            'z-index:50', 'pointer-events:none',
            'opacity:0', 'transition:opacity 0.8s ease'
        ].join(';');
        document.body.appendChild(canvas);

        renderer = new THREE.WebGLRenderer({
            canvas, alpha: true, antialias: true,
            powerPreference: 'low-power',
            failIfMajorPerformanceCaveat: false
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.1;

        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 200);
        camera.position.set(0, 0, 5);
        camera.lookAt(0, 0, 0);

        // 灯光
        scene.add(new THREE.AmbientLight(0xffffff, 0.75));
        const hemi = new THREE.HemisphereLight(0xffffff, 0xe8e0f0, 0.5);
        scene.add(hemi);
        const key = new THREE.DirectionalLight(0xffffff, 1.4);
        key.position.set(2, 3, 4);
        scene.add(key);
        const fill = new THREE.DirectionalLight(0xffeedd, 0.5);
        fill.position.set(-2, 1, -1);
        scene.add(fill);
        const rim = new THREE.DirectionalLight(0xddddff, 0.4);
        rim.position.set(0, 2, -3);
        scene.add(rim);

        clock = new THREE.Clock();

        window.addEventListener('resize', onResize);
        document.addEventListener('mousemove', onMouseMove);

        onResize();
        startRenderLoop();
        loadMotionConfig();
    }

    function onResize() {
        if (!renderer) return;
        const w = window.innerWidth, h = window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        needsRender = true;
    }

    function onMouseMove(e) {
        mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
        needsRender = true;
    }

    // ---- 坐标转换 ----

    function screenToWorld(screenX, screenY) {
        const ndc = new THREE.Vector3(
            (screenX / window.innerWidth) * 2 - 1,
            -(screenY / window.innerHeight) * 2 + 1,
            0.5
        );
        ndc.unproject(camera);
        const dir = ndc.sub(camera.position).normalize();
        const distance = -camera.position.z / dir.z;
        return camera.position.clone().add(dir.multiplyScalar(distance));
    }

    function worldToScreen(pos) {
        const v = pos.clone().project(camera);
        return {
            x: (v.x * 0.5 + 0.5) * window.innerWidth,
            y: (-v.y * 0.5 + 0.5) * window.innerHeight
        };
    }

    // ---- 模型加载 ----

    function loadModel(url, opts) {
        opts = opts || {};
        init();

        if (modelRoot) {
            scene.remove(modelRoot);
            disposeObject(modelRoot);
            modelRoot = null;
            currentModel = null;
            currentVRM = null;
            bones = {};
            restQuats = {};
            restWorldQuats = {};
            relaxQuats = {};
        }

        return new Promise((resolve, reject) => {
            const isFBX = /\.fbx(\?|$)/i.test(url);
            const onModelLoaded = (model, vrm) => {
                currentModel = model;
                currentVRM = vrm || null;

                if (currentVRM) {
                    // VRM 模型：使用官方库处理旋转、材质、弹簧骨骼
                    VRMUtils.rotateVRM0(currentVRM);
                    currentModel = currentVRM.scene;
                    console.log('[World3D] VRM 模型加载:', currentVRM.meta?.name || 'unknown',
                        'humanoid bones:', Object.keys(currentVRM.humanoid.humanBones).length);
                }

                const box = new THREE.Box3().setFromObject(currentModel);
                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());

                const targetHeight = 1.6;
                baseScale = targetHeight / Math.max(size.y, 0.1);
                modelScale = baseScale;

                modelRoot = new THREE.Group();
                currentModel.position.set(-center.x, -center.y - size.y * 0.5, -center.z);
                modelRoot.add(currentModel);
                modelRoot.scale.setScalar(baseScale);

                cacheBones(currentModel);

                // ===== ProceduralAnimator：统一程序化动作引擎（姿态修正+眨眼增强）=====
                if (typeof ProceduralAnimator !== 'undefined') {
                    try {
                        procAnimator = new ProceduralAnimator(currentModel, {
                            THREE: THREE,
                            isVRM: !!currentVRM,
                            vrm: currentVRM || null,
                            mode: 'morphsOnly'  // world3d 已有完整骨骼动画，ProceduralAnimator 仅负责眨眼/嘴部形态键
                        });
                        if (procAnimator.detect()) {
                            procAnimator.autoCorrectPose();
                            const rpt = procAnimator.getDetectionReport();
                            console.log('[World3D] ProceduralAnimator 就绪:',
                                '骨骼=' + Object.values(rpt).filter(v => v && typeof v === 'string').length,
                                '眨眼形态键=' + rpt.morphs.blink,
                                '总骨骼=' + rpt.totalBones);
                        }
                    } catch (e) {
                        console.warn('[World3D] ProceduralAnimator 初始化失败:', e);
                        procAnimator = null;
                    }
                }

                // 应用默认姿态（VRM模型跳过，因为VRM已有正确的默认姿态，直接修正会覆盖初始旋转导致手臂扭曲）
                if (!currentVRM) {
                    try { applyDefaultPose(); } catch(e) { console.warn('[World3D] applyDefaultPose 失败:', e); }
                }
                if (currentVRM) {
                    // VRM：MToon 材质和 spring bone 由官方库管理，不需要 autoFixPose
                    currentVRM.update(0);
                } else {
                    // 非 VRM GLB：回退到旧的材质和姿势修正
                    normalizeMaterials(currentModel);
                    try { autoFixPose(); } catch(e) { console.warn('[World3D] autoFixPose 失败:', e); }
                }
                initPoseEditing();
                if (!configLoaded) loadMotionConfig();
                // 加载 Mixamo 参考骨架动画（VRM 跑步/走路动作）
                loadAnimClips().catch(e => console.warn('[World3D] loadAnimClips 失败:', e));

                // 初始位置：屏幕下方中央
                const startPos = screenToWorld(window.innerWidth / 2, window.innerHeight - 140);
                modelRoot.position.copy(startPos);
                currentPos = startPos.clone();
                targetPos = startPos.clone();
                wander.tx = window.innerWidth / 2;
                wander.ty = window.innerHeight - 140;

                scene.add(modelRoot);

                // 立即可见
                canvas.style.opacity = '1';
                isVisible = true;
                needsRender = true;
                if (opts.onLoad) opts.onLoad(currentModel);
                resolve(currentModel);
            };

            // 按扩展名选择加载器
            if (isFBX && FBXLoader) {
                console.log('[World3D] 使用 FBXLoader 加载:', url);
                const fbxLoader = new FBXLoader();
                fbxLoader.load(url, (object) => {
                    onModelLoaded(object, null);
                }, (xhr) => {
                    if (opts.onProgress && xhr.lengthComputable) {
                        opts.onProgress(xhr.loaded / xhr.total);
                    }
                }, (err) => {
                    console.error('[World3D] FBX load failed:', err);
                    if (opts.onError) opts.onError(err);
                    reject(err);
                });
            } else {
                const loader = new GLTFLoader();
                // 注册 VRM 插件（对非 VRM 的 GLB 无影响）
                if (VRMLoaderPlugin) {
                    loader.register((parser) => new VRMLoaderPlugin(parser));
                }
                loader.load(url, (gltf) => {
                    onModelLoaded(gltf.scene, gltf.userData.vrm || null);
                }, (xhr) => {
                    if (opts.onProgress && xhr.lengthComputable) {
                        opts.onProgress(xhr.loaded / xhr.total);
                    }
                }, (err) => {
                    console.error('[World3D] load failed:', err);
                    if (opts.onError) opts.onError(err);
                    reject(err);
                });
            }
        });
    }


    // ---- 剪影灵体模式 ----

    function loadSilhouette(url, opts) {
        opts = opts || {};
        init();
        silhouetteMode = true;
        silhouetteState = 'idle';
        silhouetteAnimTime = 0;

        if (modelRoot) {
            scene.remove(modelRoot);
            disposeObject(modelRoot);
            modelRoot = null;
            currentModel = null;
            currentVRM = null;
            bones = {};
            restQuats = {};
            restWorldQuats = {};
            relaxQuats = {};
        }
        silhouetteMaterials = [];

        return new Promise((resolve, reject) => {
            const loader = new GLTFLoader();
            if (VRMLoaderPlugin) {
                loader.register((parser) => new VRMLoaderPlugin(parser));
            }
            loader.load(url, (gltf) => {
                currentModel = gltf.scene;
                currentVRM = gltf.userData.vrm || null;

                if (currentVRM) {
                    VRMUtils.rotateVRM0(currentVRM);
                    currentModel = currentVRM.scene;
                    console.log('[World3D] 剪影灵体加载:', currentVRM.meta?.name || 'unknown');
                }

                // 用纯色半透明材质覆盖所有mesh
                currentModel.traverse((obj) => {
                    if (obj.isMesh) {
                        const mat = new THREE.MeshBasicMaterial({
                            color: new THREE.Color(silhouetteColor),
                            transparent: true,
                            opacity: silhouetteOpacity,
                            side: THREE.DoubleSide,
                            depthWrite: false
                        });
                        obj.material = mat;
                        silhouetteMaterials.push(mat);
                    }
                });

                const box = new THREE.Box3().setFromObject(currentModel);
                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());

                const targetHeight = 1.6;
                baseScale = targetHeight / Math.max(size.y, 0.1);
                modelScale = baseScale;

                modelRoot = new THREE.Group();
                currentModel.position.set(-center.x, -center.y - size.y * 0.5, -center.z);
                modelRoot.add(currentModel);
                modelRoot.scale.setScalar(baseScale);

                // 初始位置：屏幕下方中央
                const startPos = screenToWorld(window.innerWidth / 2, window.innerHeight - 140);
                modelRoot.position.copy(startPos);
                currentPos = startPos.clone();
                targetPos = startPos.clone();
                silhouetteBasePos = startPos.clone();
                wander.tx = window.innerWidth / 2;
                wander.ty = window.innerHeight - 140;

                scene.add(modelRoot);

                // 画布发光效果（CSS filter）
                canvas.style.filter = `drop-shadow(0 0 20px ${silhouetteColor}) drop-shadow(0 0 40px ${silhouetteColor}80)`;
                canvas.style.opacity = '1';
                isVisible = true;
                needsRender = true;

                // 初始化粒子系统
                initSilhouetteParticles();

                console.log('[World3D] 剪影灵体模式已启动');
                if (opts.onLoad) opts.onLoad(gltf);
                resolve(gltf);
            }, (xhr) => {
                if (opts.onProgress && xhr.lengthComputable) {
                    opts.onProgress(xhr.loaded / xhr.total);
                }
            }, (err) => {
                console.error('[World3D] 剪影灵体加载失败:', err);
                silhouetteMode = false;
                if (opts.onError) opts.onError(err);
                reject(err);
            });
        });
    }

    // 设置剪影灵体状态
    function setSilhouetteState(state) {
        if (!silhouetteMode) return;
        silhouetteState = state || 'idle';

        const stateConfig = {
            idle:     { color: '#8b5cf6', opacity: 0.85, glow: 0.3 },
            happy:    { color: '#ec4899', opacity: 0.9,  glow: 0.6 },
            thinking: { color: '#3b82f6', opacity: 0.8,  glow: 0.4 },
            working:  { color: '#f59e0b', opacity: 0.85, glow: 0.5 },
            talking:  { color: '#8b5cf6', opacity: 0.88, glow: 0.5 },
            sleeping: { color: '#6366f1', opacity: 0.6,  glow: 0.15 },
            error:    { color: '#ef4444', opacity: 0.9,  glow: 0.7 },
            success:  { color: '#10b981', opacity: 0.9,  glow: 0.6 },
            alert:    { color: '#f97316', opacity: 0.9,  glow: 0.65 }
        };

        const config = stateConfig[state] || stateConfig.idle;
        silhouetteColor = config.color;
        silhouetteOpacity = config.opacity;
        silhouetteGlow = config.glow;

        // 更新所有材质
        const color = new THREE.Color(silhouetteColor);
        silhouetteMaterials.forEach(mat => {
            mat.color.copy(color);
            mat.opacity = silhouetteOpacity;
        });

        // 更新画布发光效果
        canvas.style.filter = `drop-shadow(0 0 ${20 + silhouetteGlow * 30}px ${silhouetteColor}) drop-shadow(0 0 ${40 + silhouetteGlow * 40}px ${silhouetteColor}80)`;

        console.log('[World3D] 剪影灵体状态:', state);
        needsRender = true;
    }

    // 剪影灵体动作定义（用整体变换实现，不需要骨骼动画）
    const SILHOUETTE_ACTIONS = {
        wave:     { duration: 2.0, desc: '挥手' },
        nod:      { duration: 1.5, desc: '点头' },
        shake:    { duration: 1.8, desc: '摇头' },
        think:    { duration: 3.0, desc: '思考' },
        happy:    { duration: 2.5, desc: '开心跳跃' },
        surprise: { duration: 1.2, desc: '惊讶后仰' },
        bow:      { duration: 2.0, desc: '鞠躬' },
        clap:     { duration: 2.0, desc: '鼓掌' },
        shrug:    { duration: 1.5, desc: '耸肩' },
        point:    { duration: 2.0, desc: '指方向' }
    };

    // 初始化剪影灵体粒子系统
    function initSilhouetteParticles() {
        // 创建粒子Canvas（覆盖在WebGL canvas上面）
        if (silParticleCanvas) {
            silParticleCanvas.remove();
        }
        silParticleCanvas = document.createElement('canvas');
        silParticleCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9998;';
        silParticleCanvas.width = window.innerWidth;
        silParticleCanvas.height = window.innerHeight;
        document.body.appendChild(silParticleCanvas);
        silParticleCtx = silParticleCanvas.getContext('2d');

        // 创建粒子（围绕模型中心漂浮）
        silParticles = [];
        const particleCount = 30;
        for (let i = 0; i < particleCount; i++) {
            silParticles.push({
                x: Math.random() * window.innerWidth,
                y: Math.random() * window.innerHeight,
                vx: (Math.random() - 0.5) * 0.5,
                vy: -Math.random() * 0.8 - 0.2,
                size: Math.random() * 3 + 1,
                opacity: Math.random() * 0.5 + 0.3,
                phase: Math.random() * Math.PI * 2
            });
        }

        // 启动粒子动画
        if (silParticleAnimId) cancelAnimationFrame(silParticleAnimId);
        updateSilhouetteParticles();

        // 窗口大小变化时调整Canvas
        window.addEventListener('resize', () => {
            if (silParticleCanvas) {
                silParticleCanvas.width = window.innerWidth;
                silParticleCanvas.height = window.innerHeight;
            }
        });
    }

    // 更新剪影灵体粒子
    function updateSilhouetteParticles() {
        if (!silParticleCtx || !silhouetteMode) return;

        const ctx = silParticleCtx;
        ctx.clearRect(0, 0, silParticleCanvas.width, silParticleCanvas.height);

        // 获取模型屏幕位置（粒子围绕模型漂浮）
        let modelX = window.innerWidth / 2;
        let modelY = window.innerHeight - 140;
        if (modelRoot) {
            const vector = new THREE.Vector3();
            modelRoot.getWorldPosition(vector);
            vector.project(camera);
            modelX = (vector.x * 0.5 + 0.5) * window.innerWidth;
            modelY = (-vector.y * 0.5 + 0.5) * window.innerHeight;
        }

        const time = performance.now() / 1000;
        const glowColor = silhouetteColor;

        silParticles.forEach((p, i) => {
            // 更新位置
            p.x += p.vx + Math.sin(time + p.phase) * 0.3;
            p.y += p.vy;

            // 围绕模型中心漂浮
            const dx = p.x - modelX;
            const dy = p.y - modelY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 300) {
                // 太远了，重置到模型附近
                p.x = modelX + (Math.random() - 0.5) * 200;
                p.y = modelY + (Math.random() - 0.5) * 200;
            }

            // 超出屏幕顶部，重置到底部
            if (p.y < -10) {
                p.y = window.innerHeight + 10;
                p.x = modelX + (Math.random() - 0.5) * 150;
            }

            // 绘制粒子（发光圆点）
            const pulseOpacity = p.opacity * (0.7 + Math.sin(time * 2 + p.phase) * 0.3);
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = glowColor;
            ctx.globalAlpha = pulseOpacity;
            ctx.fill();

            // 外层光晕
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * 2.5, 0, Math.PI * 2);
            const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2.5);
            gradient.addColorStop(0, glowColor);
            gradient.addColorStop(1, 'transparent');
            ctx.fillStyle = gradient;
            ctx.globalAlpha = pulseOpacity * 0.4;
            ctx.fill();
        });

        ctx.globalAlpha = 1;
        silParticleAnimId = requestAnimationFrame(updateSilhouetteParticles);
    }

    // 销毁剪影灵体粒子系统
    function destroySilhouetteParticles() {
        if (silParticleAnimId) {
            cancelAnimationFrame(silParticleAnimId);
            silParticleAnimId = null;
        }
        if (silParticleCanvas) {
            silParticleCanvas.remove();
            silParticleCanvas = null;
            silParticleCtx = null;
        }
        silParticles = [];
    }

    // 触发剪影灵体动作
    function triggerSilhouetteAction(actionName) {
        if (!silhouetteMode) return false;
        const action = SILHOUETTE_ACTIONS[actionName];
        if (!action) {
            console.warn('[World3D] 未知剪影动作:', actionName);
            return false;
        }
        silActionQueue.push({
            name: actionName,
            duration: action.duration,
            startTime: performance.now() / 1000
        });
        console.log('[World3D] 剪影动作触发:', actionName, action.desc);
        return true;
    }

    // 更新剪影灵体动作（返回动作变换偏移量）
    function updateSilhouetteAction(dt) {
        const result = {
            posOffset: { x: 0, y: 0, z: 0 },
            rotOffset: { x: 0, y: 0, z: 0 },
            scaleOffset: 1,
            active: false
        };

        // 处理动作队列
        const now = performance.now() / 1000;
        if (!silCurrentAction && silActionQueue.length > 0) {
            silCurrentAction = silActionQueue.shift();
            silActionTime = 0;
            silActionBlend = 0;
        }

        if (silCurrentAction) {
            silActionTime += dt;
            const progress = silActionTime / silCurrentAction.duration;
            const actionName = silCurrentAction.name;

            // 淡入淡出
            let blend = 1;
            if (progress < 0.15) blend = progress / 0.15;
            else if (progress > 0.85) blend = (1 - progress) / 0.15;
            blend = Math.max(0, Math.min(1, blend));
            silActionBlend = blend;

            if (blend > 0) {
                result.active = true;
                const t = progress * Math.PI * 2;

                switch (actionName) {
                    case 'wave':
                        // 挥手：上半身轻微右倾 + 上下浮动模拟挥手
                        result.rotOffset.z = Math.sin(t * 3) * 0.08 * blend;
                        result.posOffset.y = Math.abs(Math.sin(t * 3)) * 0.05 * blend;
                        result.rotOffset.y = 0.1 * blend;
                        break;
                    case 'nod':
                        // 点头：前后倾斜
                        result.rotOffset.x = Math.sin(t * 2) * 0.12 * blend;
                        result.posOffset.y = Math.sin(t * 2) * 0.02 * blend;
                        break;
                    case 'shake':
                        // 摇头：左右旋转
                        result.rotOffset.y = Math.sin(t * 2.5) * 0.15 * blend;
                        break;
                    case 'think':
                        // 思考：倾斜 + 轻微浮动
                        result.rotOffset.z = 0.1 * blend;
                        result.posOffset.y = Math.sin(t * 1.5) * 0.03 * blend;
                        break;
                    case 'happy':
                        // 开心：跳跃 + 旋转
                        result.posOffset.y = Math.abs(Math.sin(t * 2)) * 0.15 * blend;
                        result.rotOffset.z = Math.sin(t * 2) * 0.05 * blend;
                        result.scaleOffset = 1 + Math.sin(t * 2) * 0.02 * blend;
                        break;
                    case 'surprise':
                        // 惊讶：后仰 + 上浮
                        result.rotOffset.x = -0.15 * blend;
                        result.posOffset.y = 0.08 * blend;
                        break;
                    case 'bow':
                        // 鞠躬：前倾
                        result.rotOffset.x = 0.25 * Math.sin(progress * Math.PI) * blend;
                        result.posOffset.y = -0.05 * Math.sin(progress * Math.PI) * blend;
                        break;
                    case 'clap':
                        // 鼓掌：轻微上下浮动 + 缩放
                        result.posOffset.y = Math.abs(Math.sin(t * 4)) * 0.04 * blend;
                        result.scaleOffset = 1 + Math.sin(t * 4) * 0.015 * blend;
                        break;
                    case 'shrug':
                        // 耸肩：上下浮动
                        result.posOffset.y = Math.sin(t * 2) * 0.06 * blend;
                        break;
                    case 'point':
                        // 指方向：轻微右倾
                        result.rotOffset.z = -0.08 * blend;
                        result.rotOffset.y = 0.1 * blend;
                        break;
                }
            }

            // 动作结束
            if (progress >= 1) {
                silCurrentAction = null;
                silActionBlend = 0;
            }
        }

        return result;
    }

    // ---- 背景板 ----

    function loadStage(url, type) {
        if (!type || type === 'auto') {
            if (/\.(jpg|jpeg|png|hdr|exr|webp)$/i.test(url)) type = 'panorama';
            else type = 'gltf';
        }
        stageType = type;

        if (type === 'panorama') {
            // 先清除旧场景（会清掉 CSS 背景），再设置新的
            clearStage();
            stageType = 'panorama';
            // 全景图：CSS body 背景（用 cssText 整体覆盖，防止样式表 shorthand 干扰）
            const bgCss = 'url("' + url.replace(/"/g, '%22') + '") center center / cover no-repeat fixed #000';
            document.body.style.setProperty('background', bgCss, 'important');
            // 如果 Three.js 已加载，同时设为环境光照
            if (THREE && scene) {
                const loader = new THREE.TextureLoader();
                return new Promise((resolve, reject) => {
                    loader.load(url, (texture) => {
                        texture.mapping = THREE.EquirectangularReflectionMapping;
                        texture.colorSpace = THREE.SRGBColorSpace;
                        scene.environment = texture;
                        needsRender = true;
                        resolve(texture);
                    }, undefined, reject);
                });
            }
            return Promise.resolve();
        }

        // GLB/glTF 场景需要 Three.js
        if (!scene) init();
        clearStage();
        stageType = 'gltf';
        const loader = new GLTFLoader();
        return new Promise((resolve, reject) => {
            loader.load(url, (gltf) => {
                stageObject = gltf.scene;
                normalizeMaterials(stageObject);
                const box = new THREE.Box3().setFromObject(stageObject);
                const size = box.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);

                if (maxDim > 100) {
                    // 天空盒/环境场景：不居中不缩放，保持原位包围相机
                    stageObject.position.set(0, 0, 0);
                    stageObject.traverse((node) => {
                        if (node.isMesh && node.material) {
                            const mats = Array.isArray(node.material) ? node.material : [node.material];
                            mats.forEach(m => {
                                m.side = THREE.BackSide;
                                m.depthWrite = false;
                                m.fog = false;
                            });
                            node.renderOrder = -1;
                        }
                    });
                } else {
                    // 普通场景：居中并缩放到视野内
                    const center = box.getCenter(new THREE.Vector3());
                    stageObject.position.set(-center.x, -center.y, -center.z - 5);
                    const fovRad = camera.fov * Math.PI / 180;
                    const viewH = 2 * 5 * Math.tan(fovRad / 2);
                    const viewW = viewH * camera.aspect;
                    const s = Math.max(viewW / Math.max(size.x, 0.1), viewH / Math.max(size.y, 0.1)) * 1.2;
                    stageObject.scale.setScalar(s);
                }
                scene.add(stageObject);
                needsRender = true;
                resolve(gltf);
            }, undefined, reject);
        });
    }

    function clearStage() {
        if (stageObject && scene) {
            scene.remove(stageObject);
            disposeObject(stageObject);
            stageObject = null;
        }
        if (scene) {
            if (scene.environment && scene.environment.isTexture) {
                scene.environment.dispose();
            }
            scene.background = null;
            scene.environment = null;
        }
        stageType = null;
        // 清除 CSS 背景
        document.body.style.removeProperty('background');
        document.body.style.backgroundImage = '';
        document.body.style.backgroundSize = '';
        document.body.style.backgroundPosition = '';
        document.body.style.backgroundRepeat = '';
        document.body.style.backgroundAttachment = '';
        document.body.style.backgroundColor = '';
        needsRender = true;
    }

    // ---- 骨骼缓存 ----

    function cacheBones(obj) {
        bones = {};
        restRotations = {};
        restQuats = {};
        restWorldQuats = {};
        relaxQuats = {};
        secondaryBones = [];
        secondarySprings = [];
        allBoneNames = [];

        const nameMap = {
            hips: ['hips', 'hip', 'pelvis', 'j_bip_c', 'j_center', '腰', 'センター', 'center'],
            spine: ['spine', 'j_bip_s', '背骨', '上半身'],
            chest: ['chest', 'upperchest', 'upper_chest', 'j_bip_u', '胸', '上半身2'],
            neck: ['neck', 'j_bip_n', '首', 'kubi'],
            head: ['head', 'j_bip_h', '頭', 'atama', 'headend'],
            leftShoulder: ['leftshoulder', 'lshoulder', 'shoulder.l', 'shoulder_l', 'j_bip_l_shoulder', '肩l', '左肩'],
            rightShoulder: ['rightshoulder', 'rshoulder', 'shoulder.r', 'shoulder_r', 'j_bip_r_shoulder', '肩r', '右肩'],
            leftArm: ['leftupperarm', 'leftarm', 'upperarm.l', 'upperarm_l', 'upperarml', 'j_bip_l_upperarm', '左腕', '左うで'],
            rightArm: ['rightupperarm', 'rightarm', 'upperarm.r', 'upperarm_r', 'upperarmr', 'j_bip_r_upperarm', '右腕', '右うで'],
            leftForearm: ['leftlowerarm', 'leftforearm', 'lowerarm.l', 'lowerarm_l', 'forearm.l', 'forearm_l', 'elbow.l', 'elbow_l', 'lowerarml', 'j_bip_l_lowerarm', '左ひじ', '左肘'],
            rightForearm: ['rightlowerarm', 'rightforearm', 'lowerarm.r', 'lowerarm_r', 'forearm.r', 'forearm_r', 'elbow.r', 'elbow_r', 'lowerarmr', 'j_bip_r_lowerarm', '右ひじ', '右肘'],
            leftHand: ['lefthand', 'lhand', 'hand.l', 'hand_l', 'handl', 'j_bip_l_hand', '左手', '左手首'],
            rightHand: ['righthand', 'rhand', 'hand.r', 'hand_r', 'handr', 'j_bip_r_hand', '右手', '右手首'],
            leftLeg: ['leftupperleg', 'leftleg', 'upperleg.l', 'upperleg_l', 'thigh.l', 'thigh_l', 'leg.l', 'leg_l', 'upperlegl', 'j_bip_l_upperleg', '左足'],
            rightLeg: ['rightupperleg', 'rightleg', 'upperleg.r', 'upperleg_r', 'thigh.r', 'thigh_r', 'leg.r', 'leg_r', 'upperlegr', 'j_bip_r_upperleg', '右足'],
            leftLowerLeg: ['leftlowerleg', 'calf.l', 'calf_l', 'knee.l', 'knee_l', 'lowerleg.l', 'lowerleg_l', 'lowerlegl', 'j_bip_l_lowerleg', '左ひざ', '左膝'],
            rightLowerLeg: ['rightlowerleg', 'calf.r', 'calf_r', 'knee.r', 'knee_r', 'lowerleg.r', 'lowerleg_r', 'lowerlegr', 'j_bip_r_lowerleg', '右ひざ', '右膝'],
            leftFoot: ['leftfoot', 'foot.l', 'foot_l', 'ankle.l', 'ankle_l', 'footl', 'j_bip_l_foot', '左足首', '左つま先'],
            rightFoot: ['rightfoot', 'foot.r', 'foot_r', 'ankle.r', 'ankle_r', 'footr', 'j_bip_r_foot', '右足首', '右つま先']
        };

        const secondaryKeywords = ['hair', 'skirt', 'tail', 'ribbon', 'bust', 'breast',
            '髪', '毛', 'スカート', '尻尾', 'リボン', '前髪', '後髪', '横髪', 'two_side',
            'wing', 'cape', 'loincloth', 'necktie', 'scarf', 'ear', 'accessory'];

        obj.traverse((node) => {
            if (node.isBone) {
                const rawName = node.name || '';
                allBoneNames.push(rawName);
                const name = rawName.toLowerCase().replace(/[\s_.-]/g, '');

                // 为所有骨骼存储 rest quaternion（姿势编辑需要）
                const allKey = 'bone_' + name;
                if (!restQuats[allKey]) {
                    restQuats[allKey] = node.quaternion.clone();
                    restRotations[allKey] = { x: node.rotation.x, y: node.rotation.y, z: node.rotation.z };
                }

                for (const [key, patterns] of Object.entries(nameMap)) {
                    if (bones[key]) continue;
                    for (const p of patterns) {
                        const pn = p.toLowerCase().replace(/[\s_.-]/g, '');
                        // 精确匹配优先；后缀匹配只对较长的模式名生效（避免 arm 误匹配 forearm）
                        if (name === pn || (pn.length >= 6 && name.endsWith(pn)) || (name.length >= 6 && pn.endsWith(name))) {
                            bones[key] = node;
                            restRotations[key] = { x: node.rotation.x, y: node.rotation.y, z: node.rotation.z };
                            restQuats[key] = node.quaternion.clone();
                            break;
                        }
                    }
                }

                const lowName = rawName.toLowerCase();
                if (secondaryKeywords.some(kw => lowName.includes(kw))) {
                    if (!secondaryBones.includes(node)) {
                        secondaryBones.push(node);
                        secondarySprings.push({
                            bone: node,
                            rest: { x: node.rotation.x, y: node.rotation.y, z: node.rotation.z },
                            vel: { x: 0, y: 0, z: 0 },
                            phase: Math.random() * Math.PI * 2
                        });
                    }
                }
            }
        });

        // ===== VRM 官方人形骨骼 API（优先于字符串匹配）=====
        // VRM 模型内部自带标准人形骨骼映射，不管实际骨骼叫什么名字都能正确找到
        if (currentVRM && currentVRM.humanoid) {
            const vrmBoneMap = {
                hips: 'hips',
                spine: 'spine',
                chest: 'chest',
                neck: 'neck',
                head: 'head',
                leftShoulder: 'leftShoulder',
                leftArm: 'leftUpperArm',
                leftForearm: 'leftLowerArm',
                leftHand: 'leftHand',
                rightShoulder: 'rightShoulder',
                rightArm: 'rightUpperArm',
                rightForearm: 'rightLowerArm',
                rightHand: 'rightHand',
                leftLeg: 'leftUpperLeg',
                leftLowerLeg: 'leftLowerLeg',
                leftFoot: 'leftFoot',
                rightLeg: 'rightUpperLeg',
                rightLowerLeg: 'rightLowerLeg',
                rightFoot: 'rightFoot',
            };
            let vrmFound = 0;
            let normFound = 0;
            normalizedBones = {};
            for (const [internalKey, vrmName] of Object.entries(vrmBoneMap)) {
                try {
                    const boneNode = currentVRM.humanoid.getRawBoneNode(vrmName);
                    if (boneNode) {
                        bones[internalKey] = boneNode;
                        restRotations[internalKey] = { x: boneNode.rotation.x, y: boneNode.rotation.y, z: boneNode.rotation.z };
                        restQuats[internalKey] = boneNode.quaternion.clone();
                        vrmFound++;
                    }
                    // 同时缓存归一化骨骼（T-pose空间，程序化动画使用）
                    const normBone = currentVRM.humanoid.getNormalizedBoneNode(vrmName);
                    if (normBone) {
                        normalizedBones[internalKey] = normBone;
                        normFound++;
                    }
                } catch(e) { /* 某些骨骼可能不存在 */ }
            }
            console.log(`[World3D] VRM官方人形API匹配: 原始骨骼${vrmFound}/${Object.keys(vrmBoneMap).length}，归一化骨骼${normFound}/${Object.keys(vrmBoneMap).length}（程序化动画优先使用归一化骨骼）`);
        }

        // 捕获初始姿态的世界旋转（key=骨骼原名，用于重定向）
        restWorldQuats = {};
        try {
            obj.updateMatrixWorld(true);
            obj.traverse((node) => {
                if (node.isBone && node.name) {
                    const wq = new THREE.Quaternion();
                    node.getWorldQuaternion(wq);
                    restWorldQuats[node.name] = wq.clone();
                }
            });
        } catch(e) { console.warn('[World3D] restWorldQuats 捕获失败:', e); }

        // morph 检测
        blinkMorph = null;
        morphMeshes = [];
        obj.traverse((node) => {
            if (node.isMesh && node.morphTargetDictionary) {
                morphMeshes.push(node);
                const dict = node.morphTargetDictionary;
                for (const key of Object.keys(dict)) {
                    const kl = key.toLowerCase();
                    if (kl.includes('blink') || kl.includes('瞬き') || kl.includes('まばたき') ||
                        kl.includes('close') || kl === 'eye_close' || kl.includes('wink')) {
                        if (!blinkMorph || (kl.includes('blink') && !blinkMorph.key.includes('blink'))) {
                            blinkMorph = { mesh: node, key: key, index: dict[key] };
                        }
                    }
                }
            }
        });

        console.log('[World3D] 骨骼:', Object.keys(bones).join(', ') || '无');
        console.log('[World3D] 次级骨骼:', secondaryBones.length, '眨眼 morph:', blinkMorph ? blinkMorph.key : '无');
    }

    /**
     * 自动检测手臂朝向并计算放松偏移（四元数，本地空间）
     */
    function autoFixPose() {
        relaxQuats = {};
        if (!bones.leftArm && !bones.rightArm) return;

        // 关键：先更新所有世界矩阵，否则 getWorldQuaternion 拿到的是单位四元数
        currentModel.updateMatrixWorld(true);

        function fixArm(shoulderKey, armKey, forearmKey, isLeft) {
            const shoulder = bones[shoulderKey];
            const arm = bones[armKey];
            const forearm = bones[forearmKey];
            if (!arm) return;

            // 手臂骨骼在本地空间沿 Y 轴，获取其世界方向
            const worldQuat = new THREE.Quaternion();
            arm.getWorldQuaternion(worldQuat);
            const armDir = new THREE.Vector3(0, 1, 0).applyQuaternion(worldQuat);

            // 目标方向：A-pose，自然下垂并微微外张
            // 左肩 T-pose 朝 +X，右肩朝 -X（glTF 坐标系）
            const p = motionConfig.pose;
            const outX = (isLeft ? p.armOutX : -p.armOutX);
            const targetDir = new THREE.Vector3(outX, -1, p.armForwardZ).normalize();
            const worldDelta = new THREE.Quaternion().setFromUnitVectors(armDir, targetDir);

            let localDelta;
            if (arm.parent) {
                const parentWorldQuat = new THREE.Quaternion();
                arm.parent.getWorldQuaternion(parentWorldQuat);
                const invParent = parentWorldQuat.clone().invert();
                localDelta = invParent.multiply(worldDelta).multiply(parentWorldQuat);
            } else {
                localDelta = worldDelta;
            }
            relaxQuats[armKey] = localDelta;

            // 肘部微弯
            if (forearm) {
                relaxQuats[forearmKey] = new THREE.Quaternion().setFromEuler(
                    new THREE.Euler(p.elbowBend, 0, isLeft ? -p.elbowSide : p.elbowSide, 'XYZ')
                );
            }
            // 肩膀微沉
            if (shoulder) {
                relaxQuats[shoulderKey] = new THREE.Quaternion().setFromEuler(
                    new THREE.Euler(p.shoulderDrop, 0, isLeft ? p.shoulderSide : -p.shoulderSide, 'XYZ')
                );
            }
        }

        try {
            fixArm('leftShoulder', 'leftArm', 'leftForearm', true);
            fixArm('rightShoulder', 'rightArm', 'rightForearm', false);
        } catch(e) {
            console.warn('[World3D] autoFixPose 失败:', e);
        }

        const la = relaxQuats.leftArm, ra = relaxQuats.rightArm;
        console.log('[World3D] 姿态修正:',
            la ? '左臂已修正' : '无左臂',
            ra ? '右臂已修正' : '无右臂');
    }

    // 从 rest pose 重新计算自动修正（姿势编辑时用，避免和手动偏移打架）
    function recalcAutoFixSafe() {
        if (!currentModel) return;
        // 临时把所有命名骨骼重置到 rest（不含 manualQ）
        const saved = {};
        for (const [key, bone] of Object.entries(bones)) {
            saved[key] = bone.quaternion.clone();
            const rq = restQuats[key];
            if (rq) bone.quaternion.copy(rq);
        }
        currentModel.updateMatrixWorld(true);
        relaxQuats = {};
        try { autoFixPose(); } catch(e) { console.warn('[World3D] recalcAutoFixSafe:', e); }
        // 恢复骨骼
        for (const [key, bone] of Object.entries(bones)) {
            if (saved[key]) bone.quaternion.copy(saved[key]);
        }
        currentModel.updateMatrixWorld(true);
        // 姿势编辑模式下更新冻结的修正
        if (poseEditMode) {
            frozenRelaxQuats = {};
            for (const k in relaxQuats) frozenRelaxQuats[k] = relaxQuats[k].clone();
        }
    }

    function disposeObject(obj) {
        obj.traverse((node) => {
            if (node.geometry) node.geometry.dispose();
            if (node.material) {
                const mats = Array.isArray(node.material) ? node.material : [node.material];
                mats.forEach(m => {
                    ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap',
                     'alphaMap', 'aoMap', 'specularMap'].forEach(p => {
                        if (m[p]) m[p].dispose();
                    });
                    m.dispose();
                });
            }
        });
    }

    function normalizeMaterials(obj) {
        let fixedCount = 0;
        obj.traverse((node) => {
            if (!node.isMesh || !node.material) return;
            const mats = Array.isArray(node.material) ? node.material : [node.material];

            mats.forEach((mat, i) => {
                if (!mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial) {
                    const newMat = new THREE.MeshStandardMaterial();
                    if (mat.map) newMat.map = mat.map;
                    if (mat.normalMap) newMat.normalMap = mat.normalMap;
                    if (mat.emissiveMap) newMat.emissiveMap = mat.emissiveMap;
                    if (mat.alphaMap) { newMat.alphaMap = mat.alphaMap; newMat.transparent = true; }
                    if (mat.color) newMat.color.copy(mat.color);
                    if (mat.emissive) newMat.emissive.copy(mat.emissive);
                    newMat.roughness = 0.7;
                    newMat.metalness = 0.0;
                    newMat.side = mat.side || THREE.FrontSide;
                    newMat.transparent = mat.transparent || false;
                    newMat.alphaTest = mat.alphaTest || 0;
                    mats[i] = newMat;
                    fixedCount++;
                } else {
                    if (mat.roughness === 1 && mat.metalness === 0 && !mat.map) {
                        mat.color.setHex(0xe8c8b8);
                        mat.roughness = 0.7;
                    }
                    const c = mat.color;
                    const brightness = (c.r + c.g + c.b) / 3;
                    if (brightness < 0.15 && !mat.map) {
                        c.multiplyScalar(0.3 / Math.max(brightness, 0.01));
                    }
                }

                const m = mats[i];
                if (m.map) {
                    m.map.colorSpace = THREE.SRGBColorSpace;
                    if (!m.map.generateMipmaps) m.map.generateMipmaps = true;
                    m.map.minFilter = THREE.LinearMipmapLinearFilter;
                    m.map.magFilter = THREE.LinearFilter;
                }
                if (m.transparent || (m.map && m.map.format === THREE.RGBAFormat)) {
                    m.side = THREE.DoubleSide;
                }
            });

            if (Array.isArray(node.material)) {
                node.material = mats;
            } else {
                node.material = mats[0];
            }
        });
        if (fixedCount > 0) {
            console.log('[World3D] 替换了', fixedCount, '个非标准材质');
        }
    }

    // ---- 自主漫游 ----

    function pickWanderTarget() {
        const margin = 100;
        // 主要在屏幕下半部分活动
        wander.tx = margin + Math.random() * (window.innerWidth - margin * 2);
        wander.ty = window.innerHeight * 0.45 + Math.random() * (window.innerHeight * 0.4);
        wander.mode = 'walking';
    }

    function glanceAtElement(el, duration) {
        if (!el || !wander) return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0) return;
        wander.lookAtWindow = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
        wander.reactTimer = duration || 2000;
    }

    function updateWander(dt, now) {
        if (!modelRoot) return;

        // 反应计时（看窗口）
        if (wander.reactTimer > 0) {
            wander.reactTimer -= dt * 1000;
            if (wander.reactTimer <= 0) wander.lookAtWindow = null;
        }

        // 选新目标
        if (wander.mode === 'idle' && now > wander.nextMove) {
            pickWanderTarget();
            wander.nextMove = now + 4000 + Math.random() * 7000;
        }

        // 速度驱动移动（有加速/减速，像走路）
        const target = screenToWorld(wander.tx, wander.ty);
        const dx = target.x - currentPos.x;
        const dy = target.y - currentPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const accel = motionConfig.walk.accel;
        const decel = motionConfig.walk.decel;
        const maxSpeed = motionConfig.walk.speed * 0.012; // 世界单位/秒

        if (wander.mode === 'walking') {
            if (dist < 0.08) {
                // 到达目标，减速停下
                wander.vx *= 0.8;
                wander.vy *= 0.8;
                if (Math.abs(wander.vx) < 0.002 && Math.abs(wander.vy) < 0.002) {
                    wander.vx = 0; wander.vy = 0;
                    wander.mode = 'idle';
                    wander.nextMove = now + 2000 + Math.random() * 4000;
                }
            } else {
                // 朝目标加速
                const dirX = dx / dist, dirY = dy / dist;
                // 接近目标时减速
                const slowDown = Math.min(1, dist / 0.5);
                const targetVx = dirX * maxSpeed * slowDown;
                const targetVy = dirY * maxSpeed * slowDown;
                wander.vx += (targetVx - wander.vx) * Math.min(accel * dt, 1);
                wander.vy += (targetVy - wander.vy) * Math.min(accel * dt, 1);
            }
            currentPos.x += wander.vx * dt;
            currentPos.y += wander.vy * dt;
        } else {
            // 闲置时速度归零
            wander.vx *= 0.85;
            wander.vy *= 0.85;
        }
    }

    // ---- 模型控制（外部 API） ----

    function flyToScreen(x, y) {
        wander.tx = x;
        wander.ty = y;
        wander.mode = 'walking';
        wander.nextMove = performance.now() + 5000;
        needsRender = true;
    }

    function flyToElement(el, side) {
        const rect = el.getBoundingClientRect();
        let x = rect.left + rect.width / 2;
        let y = rect.top + rect.height / 2;
        const margin = 60;
        if (side === 'left') x = rect.left - margin;
        else if (side === 'right') x = rect.right + margin;
        else if (side === 'top') y = rect.top - margin;
        else if (side === 'bottom') y = rect.bottom + margin;
        flyToScreen(x, y);
    }

    function setScreenPosition(x, y) {
        const pos = screenToWorld(x, y);
        if (modelRoot) {
            currentPos.copy(pos);
            targetPos.copy(pos);
            wander.vx = 0; wander.vy = 0;
            wander.tx = x;
            wander.ty = y;
            wander.mode = 'idle';
        }
        needsRender = true;
    }

    function setScale(s) {
        modelScale = baseScale * s;
        needsRender = true;
    }

    function show() {
        if (canvas) { canvas.style.opacity = '1'; isVisible = true; }
    }

    function hide() {
        if (canvas) { canvas.style.opacity = '0'; isVisible = false; }
    }

    function hasModel() {
        return !!modelRoot;
    }

    // ---- 渲染循环 ----

    function startRenderLoop() {
        if (rafId) return;

        function loop(now) {
            rafId = requestAnimationFrame(loop);

            if (now - lastFrameTime < 33) return;
            lastFrameTime = now;

            const dt = Math.min(clock.getDelta(), 0.05);
            const t = clock.elapsedTime;

            if (modelRoot && isVisible) {
                if (poseEditMode) {
                    // 姿势编辑模式：停止所有动画，使用与正常模式完全一致的合成方式
                    wander.vx = 0; wander.vy = 0;
                    currentModel.rotation.z = 0;
                    currentModel.position.y = 0;
                    modelRoot.rotation.y *= 0.9;
                    // 对所有命名骨骼应用 relaxQ × restQ × manualQ（与 setBone 一致，animQ=0）
                    for (const [key, bone] of Object.entries(bones)) {
                        if (!bone) continue;
                        const restQ = restQuats[key];
                        if (!restQ) continue;
                        bone.quaternion.copy(restQ);
                        const mp = motionConfig.manualPose[key];
                        if (mp && typeof mp.x === 'number') {
                            const manualQ = new THREE.Quaternion().setFromEuler(
                                new THREE.Euler(mp.x, mp.y, mp.z, 'XYZ')
                            );
                            bone.quaternion.multiply(manualQ);
                        }
                        const relaxQ = relaxQuats[key];
                        if (relaxQ) bone.quaternion.premultiply(relaxQ);
                    }
                    // 非命名骨骼（头发、裙子等次级骨骼）归位
                    const seen = new Set(Object.values(bones));
                    currentModel.traverse(node => {
                        if (node.isBone && !seen.has(node)) {
                            const key = boneKey(node);
                            const restQ = key ? restQuats[key] : null;
                            if (restQ) node.quaternion.copy(restQ);
                        }
                    });
                    // 更新骨架可视化位置
                    updateSkeletonPositions();
                    needsRender = true;
                } else {
                // 自主漫游
                updateWander(dt, now);

                // 位置直接由速度驱动（不再 lerp 漂移）
                modelRoot.position.copy(currentPos);

                // 朝向移动方向（平滑转向）
                const vmag = Math.sqrt(wander.vx * wander.vx + wander.vy * wander.vy);
                const moving = vmag > 0.01;
                if (moving) {
                    const targetYaw = Math.atan2(wander.vx, Math.abs(wander.vy) + 0.01) * 0.5;
                    modelRoot.rotation.y += (targetYaw - modelRoot.rotation.y) * 0.1;
                } else {
                    modelRoot.rotation.y *= 0.92;
                }
                motionTarget.fly = 0;

                // 走路步态频率与速度挂钩
                idlePhase += dt;
                const wc = motionConfig.walk;
                const ic = motionConfig.idle;
                const walkSpeed = moving ? Math.min(vmag * 8, 6) : 0;
                let walkBob = 0;
                if (moving) {
                    walkPhase += dt * (3 + walkSpeed * 1.5);
                    walkBob = Math.abs(Math.sin(walkPhase)) * wc.walkBob * Math.min(vmag * 30, 1);
                } else {
                    walkPhase += dt * 0.5;
                    walkPhase *= 0.95;
                }
                const idleSway = Math.sin(idlePhase * ic.idleSwayFreq) * ic.idleSwayAmp;
                const idleBob = Math.sin(idlePhase * ic.idleBobFreq) * ic.idleBobAmp;

                // 剪影灵体模式：简单动画，跳过复杂骨骼动画
                if (silhouetteMode) {
                    silhouetteAnimTime += dt;
                    const sat = silhouetteAnimTime;

                    // 基础动画
                    let breathScale = 1 + Math.sin(sat * 1.5) * 0.02;
                    let floatY = Math.sin(sat * 0.8) * 0.05;
                    let swayX = Math.sin(sat * 0.5) * 0.02;
                    let swayRot = Math.sin(sat * 0.4) * 0.02;
                    let tiltX = 0, tiltY = 0;

                    // 状态响应
                    if (silhouetteState === 'happy' || silhouetteState === 'success') {
                        floatY += Math.abs(Math.sin(sat * 4)) * 0.15;
                        swayRot += Math.sin(sat * 3) * 0.05;
                        breathScale = 1 + Math.sin(sat * 3) * 0.03;
                    } else if (silhouetteState === 'thinking') {
                        swayRot += 0.08;
                        swayX += Math.sin(sat * 2) * 0.03;
                        tiltY = Math.sin(sat * 1.5) * 0.05;
                    } else if (silhouetteState === 'sleeping') {
                        breathScale = 1 + Math.sin(sat * 0.8) * 0.025;
                        swayRot += -0.05;
                        floatY += 0.08;
                    } else if (silhouetteState === 'error' || silhouetteState === 'alert') {
                        swayX += Math.sin(sat * 25) * 0.04;
                        swayRot += Math.sin(sat * 20) * 0.03;
                    } else if (silhouetteState === 'working' || silhouetteState === 'scanning') {
                        swayRot += Math.sin(sat * 2) * 0.03;
                        breathScale = 1 + Math.sin(sat * 8) * 0.015;
                    } else if (silhouetteState === 'talking') {
                        breathScale = 1 + Math.sin(sat * 15) * 0.012;
                    }

                    // 动作系统（整体变换实现，不需要骨骼动画）
                    const actionResult = updateSilhouetteAction(dt);
                    if (actionResult.active) {
                        floatY += actionResult.posOffset.y;
                        swayX += actionResult.posOffset.x;
                        swayRot += actionResult.rotOffset.z;
                        tiltX += actionResult.rotOffset.x;
                        tiltY += actionResult.rotOffset.y;
                        breathScale *= actionResult.scaleOffset;
                    }

                    // 应用变换
                    currentModel.rotation.z = swayRot;
                    currentModel.rotation.x = tiltX;
                    currentModel.rotation.y = tiltY;
                    currentModel.position.y = floatY;
                    currentModel.position.x = swayX;
                    modelRoot.scale.setScalar(modelScale * breathScale);

                    // VRM更新（保持弹簧骨骼等基础功能，但不应用动画）
                    if (currentVRM) {
                        try { currentVRM.update(dt); } catch(e) {}
                    }

                    needsRender = true;
                } else {
                    // 正常模式：完整骨骼动画
                    currentModel.rotation.z = idleSway;
                    currentModel.position.y = idleBob + walkBob;

                    // 骨骼动画（程序化）
                    applyBoneAnimation(t, dt, moving, vmag);
                    // 程序化动作偏移叠加
                    applyClipAnimation(dt, moving, vmag, t);

                    // ProceduralAnimator：眨眼/嘴部形态键（morphsOnly 模式，不操作骨骼）
                    if (procAnimator) {
                        try {
                            procAnimator.setState(modelState || 'idle');
                            procAnimator.update();
                        } catch (e) { /* 静默失败 */ }
                    }

                    // 腿部内收已通过Blender修改模型rest pose实现，无需代码每帧调整

                    // 呼吸缩放
                    const breathScale = 1 + Math.sin(t * 1.6) * 0.004;
                    modelRoot.scale.setScalar(modelScale * breathScale);

                    needsRender = true;
                }
                }
            }

            // 相机微视差（始终生效，让3D天空盒有纵深可见）
            if (camera) {
                const camTargetX = mouseNDC.x * motionConfig.camera.parallaxX;
                const camTargetY = mouseNDC.y * motionConfig.camera.parallaxY;
                const camDx = camTargetX - camera.position.x;
                const camDy = camTargetY - camera.position.y;
                camera.position.x += camDx * motionConfig.camera.parallaxSpeed;
                camera.position.y += camDy * motionConfig.camera.parallaxSpeed;
                camera.lookAt(0, 0, 0);
                if (stageObject && (Math.abs(camDx) > 0.001 || Math.abs(camDy) > 0.001)) {
                    needsRender = true;
                }
            }

            if (needsRender && renderer && scene && camera) {
                renderer.render(scene, camera);
                needsRender = false;
            }
        }
        rafId = requestAnimationFrame(loop);
    }

    /**
     * 程序化骨骼动画系统（分层叠加）
     */

    /**
     * 程序化动作系统
     */
    function getActionProgress() {
        if (!currentAction) return 0;
        const elapsed = (performance.now() - currentAction.startTime) / 1000;
        return Math.min(elapsed / currentAction.duration, 1);
    }

    function easeInOut(t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    function computeActionOffsets(action, progress) {
        // 计算动作的骨骼旋转偏移 (弧度, XYZ欧拉角, 世界空间)
        // 经验: X轴=前后抬臂, Z轴=侧面抬臂, Y轴=内外旋; 前臂弯曲用X轴
        const offsets = {};
        const t = progress;
        const e = easeInOut(t);
        const sin = Math.sin, PI = Math.PI;

        switch (action.name) {
            case 'wave': // 挥手: 右臂抬起, 前臂弯曲+摆动
                if (waveOverride) {
                    offsets.rightUpperArm = { x: waveOverride.upperX, y: waveOverride.upperY, z: waveOverride.upperZ };
                    offsets.rightLowerArm = { x: waveOverride.lowerX, y: waveOverride.lowerY, z: waveOverride.lowerZ };
                } else {
                    offsets.rightUpperArm = { x: -0.2, y: 0.3, z: -0.45 };
                    offsets.rightLowerArm = { x: 0, y: 0, z: 0 };
                }
                break;
            case 'nod': // 点头
                offsets.head = { x: sin(t * PI * 2.5) * 0.3 * e, y: 0, z: 0 };
                break;
            case 'shake': // 摇头
                offsets.head = { x: 0, y: sin(t * PI * 2.5) * 0.4 * e, z: 0 };
                break;
            case 'think': // 思考: 右臂侧面抬起, 前臂弯曲摸下巴
                offsets.rightUpperArm = { x: -0.2, y: 0.3, z: -0.45 };
                offsets.rightLowerArm = { x: -1.2, y: 0, z: 0 };
                offsets.head = { x: -0.1, y: 0.08, z: 0 };
                break;
            case 'happy': // 开心: 双手前上举起
                offsets.rightUpperArm = { x: -0.2, y: 0.3, z: -0.45 };
                offsets.leftUpperArm = { x: -0.2, y: -0.3, z: 0.45 };
                offsets.rightLowerArm = { x: -0.3, y: 0, z: 0 };
                offsets.leftLowerArm = { x: -0.3, y: 0, z: 0 };
                offsets.head = { x: -0.12, y: 0, z: 0 };
                break;
            case 'surprise': // 惊讶: 双手前上举起, 后仰
                offsets.rightUpperArm = { x: -0.2, y: 0.3, z: -0.45 };
                offsets.leftUpperArm = { x: -0.2, y: -0.3, z: 0.45 };
                offsets.rightLowerArm = { x: -0.3, y: 0, z: 0 };
                offsets.leftLowerArm = { x: -0.3, y: 0, z: 0 };
                offsets.head = { x: -0.3, y: 0, z: 0 };
                offsets.spine = { x: -0.2, y: 0, z: 0 };
                break;
            case 'point': // 指方向: 右手前伸
                offsets.rightUpperArm = { x: -0.2, y: 0.3, z: -0.45 };
                offsets.head = { x: 0, y: 0.2, z: 0 };
                break;
            case 'clap': // 鼓掌: 双臂前抬, 前臂左右摆动
                offsets.rightUpperArm = { x: -0.2, y: 0.3, z: -0.45 };
                offsets.leftUpperArm = { x: -0.2, y: -0.3, z: 0.45 };
                offsets.rightLowerArm = { x: -0.2, y: 0, z: sin(t * PI * 3) * 0.25 };
                offsets.leftLowerArm = { x: -0.2, y: 0, z: -sin(t * PI * 3) * 0.25 };
                break;
            case 'shrug': // 耸肩: 肩膀上下
                offsets.rightShoulder = { x: 0, y: 0, z: -0.25 * sin(t * PI * 2) };
                offsets.leftShoulder = { x: 0, y: 0, z: 0.25 * sin(t * PI * 2) };
                break;
            case 'bow': // 鞠躬: 脊柱前弯
                offsets.spine = { x: 0.5, y: 0, z: 0 };
                offsets.chest = { x: 0.25, y: 0, z: 0 };
                offsets.head = { x: 0.15, y: 0, z: 0 };
                break;
            case 'yawn': // 打哈欠: 头后仰, 右臂侧面抬起捂嘴
                offsets.head = { x: -0.35, y: 0, z: 0 };
                offsets.rightUpperArm = { x: -0.2, y: 0.3, z: -0.45 };
                offsets.rightLowerArm = { x: -1.2, y: 0, z: 0 };
                break;
            case 'dance': // 跳舞: 双臂侧面缓慢摆动
                offsets.rightUpperArm = { x: -0.8, y: 1.2, z: -1.8 + sin(t * PI * 2) * 0.2 };
                offsets.leftUpperArm = { x: -0.8, y: -1.2, z: 1.8 - sin(t * PI * 2) * 0.2 };
                offsets.rightLowerArm = { x: -0.2, y: 0, z: 0 };
                offsets.leftLowerArm = { x: -0.2, y: 0, z: 0 };
                offsets.spine = { x: 0, y: sin(t * PI) * 0.1, z: 0 };
                break;
        }
        // 应用通用动作偏移覆盖
        if (actionOverrides[name]) {
            for (const boneName in actionOverrides[name]) {
                offsets[boneName] = { ...actionOverrides[name][boneName] };
            }
        }
        return offsets;
    }

    function updateActionQueue(dt) {
        // 更新当前动作
        if (currentAction) {
            const progress = getActionProgress();
            if (progress >= 1) {
                currentAction = null;
            }
        }
        // 从队列取下一个动作
        if (!currentAction && actionQueue.length > 0) {
            currentAction = actionQueue.shift();
            currentAction.startTime = performance.now();
            actionDebugFrame = 0;
            console.log(`[ACTION-DEBUG] 动作开始: ${currentAction.name} (${PROCEDURAL_ACTIONS[currentAction.name].desc})`);
        }
        // 动作混合权重平滑过渡
        const targetBlend = currentAction ? 1 : 0;
        actionBlend += (targetBlend - actionBlend) * Math.min(dt * 8, 1);
    }

    /**
     * 基于动画剪辑的骨骼动画
     * VRM 模型：通过 humanoid 归一化骨骼重定向，vrm.update() 处理弹簧/材质
     * 非 VRM：世界空间重定向（旧路径）
     */
    function applyClipAnimation(dt, moving, vmag, t) {
        if (!currentModel) return;
        const ic = motionConfig.idle;

        // 更新动作队列
        updateActionQueue(dt);

        const isVRM = !!currentVRM;

        if (isVRM) {
            // === VRM 模型：世界空间重定向（在 currentVRM.update 之后执行，避免被覆盖）===
            // 1. 先设置眨眼 expression
            blinkTimer -= dt;
            if (blinkTimer <= 0 && blinkProgress >= 1) {
                blinkProgress = 0;
                blinkTimer = 0.15;
            }
            if (blinkProgress < 1) {
                blinkProgress += dt * 8;
                if (blinkProgress >= 1) {
                    blinkProgress = 1;
                    blinkTimer = ic.blinkMin + Math.random() * (ic.blinkMax - ic.blinkMin);
                }
            }
            if (currentVRM.expressionManager) {
                currentVRM.expressionManager.setValue('blink', 1 - blinkProgress);
            }

            // 2. VRM 更新：归一化骨骼→实际骨骼、弹簧骨骼、表情等
            currentVRM.update(dt);
            // 2.5. Mixamo 参考骨架动画 + 世界空间重定向（VRM 跑步/走路动作）
            if (mixamoMixer && boneMap.length > 0) {
                // idle/walk 权重混合
                if (!oneShotAnimation) {
                    const targetWalk = moving ? Math.min(vmag * 25, 1) : 0;
                    animBlend += (targetWalk - animBlend) * Math.min(dt * 6, 1);
                    if (mixamoIdleAction) mixamoIdleAction.weight = 1 - animBlend;
                    if (mixamoWalkAction) {
                        mixamoWalkAction.weight = animBlend;
                        mixamoWalkAction.timeScale = 0.8 + animBlend * 0.8;
                    }
                }
                // 更新 Mixamo 参考骨架
                mixamoMixer.update(dt);
                mixamoRoot.updateMatrixWorld(true);
                // 世界空间重定向：把 Mixamo 的世界空间旋转增量应用到 VRM 骨骼
                currentModel.updateMatrixWorld(true);
                const _pwq = new THREE.Quaternion();
                const _maw = new THREE.Quaternion();
                const _dw = new THREE.Quaternion();
                const _vaw = new THREE.Quaternion();
                for (const pair of boneMap) {
                    const { mBone, vBone, mRestWorld, vRestWorld } = pair;
                    mBone.getWorldQuaternion(_maw);
                    _dw.copy(_maw).multiply(mRestWorld.clone().invert());
                    _vaw.copy(_dw).multiply(vRestWorld);
                    if (vBone.parent) {
                        vBone.parent.getWorldQuaternion(_pwq);
                        vBone.quaternion.copy(_pwq.clone().invert().multiply(_vaw));
                    } else {
                        vBone.quaternion.copy(_vaw);
                    }
                }
            }


            // 3. 程序化动作偏移叠加（世界空间旋转偏移，从父到子顺序）
            if (currentAction && actionBlend > 0.01) {
                const progress = getActionProgress();
                const offsets = computeActionOffsets(currentAction, progress);
                // 建立 vrmName -> vBone 映射（从 VRM humanoid 获取实际骨骼）
                const boneByName = {};
                if (currentVRM && currentVRM.humanoid) {
                    const humanoidBones = ['spine', 'chest', 'neck', 'head',
                        'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
                        'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
                        'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
                        'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'hips'];
                    for (const name of humanoidBones) {
                        const bone = currentVRM.humanoid.getRawBoneNode(name);
                        if (bone) boneByName[name] = bone;
                    }
                }
                // 从父到子的骨骼顺序（避免子骨骼世界矩阵被父骨骼修改影响）
                const boneOrder = ['spine', 'chest', 'neck', 'head',
                    'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
                    'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
                    'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
                    'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'hips'];
                const _parentQ = new THREE.Quaternion();
                const _boneWorldQ = new THREE.Quaternion();
                const _offsetQ = new THREE.Quaternion();
                const _resultQ = new THREE.Quaternion();
                for (const boneName of boneOrder) {
                    if (!offsets[boneName] && !(debugArmMode && boneName === 'rightUpperArm')) continue;
                    const bone = boneByName[boneName];
                    if (!bone) continue;
                    let offset = offsets[boneName] || { x: 0, y: 0, z: 0 };
                    // 调试模式: 用调试偏移代替上臂偏移
                    if (debugArmMode && boneName === 'rightUpperArm') {
                        offset = debugArmOffset;
                    }
                    // VRM模型手臂角度缩放，避免世界空间旋转过度导致手臂后折
                    const isArmBone = ['rightUpperArm','leftUpperArm','rightLowerArm','leftLowerArm'].includes(boneName);
                    const vrmArmScale = (isVRM && isArmBone) ? 0.6 : 1.0;
                    _offsetQ.setFromEuler(new THREE.Euler(
                        offset.x * actionBlend * vrmArmScale, offset.y * actionBlend * vrmArmScale, offset.z * actionBlend * vrmArmScale, 'XYZ'
                    ));
                    bone.getWorldQuaternion(_boneWorldQ);
                    // 左乘: result = offset * currentWorld (偏移在世界轴)
                    _resultQ.copy(_offsetQ).multiply(_boneWorldQ);
                    if (bone.parent) {
                        bone.parent.getWorldQuaternion(_parentQ);
                        _parentQ.invert();
                        bone.quaternion.copy(_parentQ.multiply(_resultQ));
                    } else {
                        bone.quaternion.copy(_resultQ);
                    }
                }
                // 调试输出: 在动作中间帧(progress 0.4-0.6)输出一次
                const _prog = getActionProgress();
                if (actionDebugFrame === 0 && _prog >= 0.4 && _prog <= 0.6) {
                    console.log(`[ACTION-DEBUG] 中间帧 progress=${_prog.toFixed(3)} actionBlend=${actionBlend.toFixed(3)}`);
                    for (const boneName of ['rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperArm', 'leftLowerArm', 'head', 'spine', 'chest']) {
                        if (!offsets[boneName] && !(debugArmMode && boneName === 'rightUpperArm')) continue;
                        const bone = boneByName[boneName];
                        if (!bone) continue;
                        let offset = offsets[boneName] || { x: 0, y: 0, z: 0 };
                        if (debugArmMode && boneName === 'rightUpperArm') {
                            offset = debugArmOffset;
                        }
                        const wq = new THREE.Quaternion();
                        bone.getWorldQuaternion(wq);
                        const eWorld = new THREE.Euler().setFromQuaternion(wq, 'XYZ');
                        const eLocal = new THREE.Euler().setFromQuaternion(bone.quaternion, 'XYZ');
                        const debugTag = (debugArmMode && boneName === 'rightUpperArm') ? ' [DEBUG]' : '';
                        console.log(`[ACTION-DEBUG]   ${boneName}${debugTag}: offset(${offset.x.toFixed(3)},${offset.y.toFixed(3)},${offset.z.toFixed(3)}) ` +
                            `world(${eWorld.x.toFixed(3)},${eWorld.y.toFixed(3)},${eWorld.z.toFixed(3)}) ` +
                            `local(${eLocal.x.toFixed(3)},${eLocal.y.toFixed(3)},${eLocal.z.toFixed(3)})`);
                    }
                    actionDebugFrame = 1;
                }
                // 更新世界矩阵，确保后续头部追踪使用正确的矩阵
                currentModel.updateMatrixWorld(true);
            }

            // 4. 头部追踪（叠加到实际 head 骨骼）
            lookTimer -= dt;
            if (lookTimer <= 0) {
                lookTimer = 2.5 + Math.random() * 4;
                lookTarget.x = (Math.random() - 0.5) * ic.headAutonomousRange;
                lookTarget.y = (Math.random() - 0.5) * 0.15;
            }
            let aimX = mouseNDC.x * ic.headLookRange * 0.7 + lookTarget.x * 0.3;
            let aimY = mouseNDC.y * (ic.headLookRange * 0.55) * 0.7 + lookTarget.y * 0.3;
            if (wander.lookAtWindow) {
                const wp = screenToWorld(wander.lookAtWindow.x, wander.lookAtWindow.y);
                const hdx = wp.x - currentPos.x;
                const hdy = wp.y - currentPos.y;
                aimX = THREE.MathUtils.clamp(hdx * 0.25, -0.5, 0.5);
                aimY = THREE.MathUtils.clamp(hdy * 0.25, -0.3, 0.3);
            }
            lookCurrent.x += (aimX - lookCurrent.x) * 0.07;
            lookCurrent.y += (aimY - lookCurrent.y) * 0.07;
            const headBone = currentVRM.humanoid.getRawBoneNode('head');
            if (headBone) {
                const headAdd = new THREE.Quaternion().setFromEuler(
                    new THREE.Euler(lookCurrent.y, lookCurrent.x, Math.sin(t * 0.35) * 0.01, 'XYZ')
                );
                headBone.quaternion.multiply(headAdd);
            }
        }
    }

    /**
     * 应用默认姿态配置到模型
     * 优先使用 cacheBones 中通过 VRM 官方 humanoid API 缓存的骨骼，
     * 缺失时回退到字符串匹配。
     */
    function applyDefaultPose() {
        if (!currentModel) return;
        const p = motionConfig.pose;

        // ===== 优先使用缓存骨骼（VRM官方API已匹配）=====
        const applyToBone = (bone, rx, ry, rz) => {
            if (!bone) return false;
            if (typeof rx === 'number') bone.rotation.x = rx;
            if (typeof ry === 'number') bone.rotation.y = ry;
            if (typeof rz === 'number') bone.rotation.z = rz;
            return true;
        };

        let applied = 0;
        // 腿部
        if (applyToBone(bones.leftLeg, null, p.thighInward - p.kneeFixThighY, null)) applied++;
        if (applyToBone(bones.rightLeg, null, -p.thighInward + p.kneeFixThighY, null)) applied++;
        if (applyToBone(bones.leftLowerLeg, null, -p.calfInward + p.kneeFixCalfY, null)) applied++;
        if (applyToBone(bones.rightLowerLeg, null, p.calfInward - p.kneeFixCalfY, null)) applied++;
        if (applyToBone(bones.leftFoot, null, -p.footInward, null)) applied++;
        if (applyToBone(bones.rightFoot, null, p.footInward, null)) applied++;
        // 手臂
        if (applyToBone(bones.leftForearm, p.elbowBendIdle, null, null)) applied++;
        if (applyToBone(bones.rightForearm, p.elbowBendIdle, null, null)) applied++;
        if (applyToBone(bones.leftShoulder, null, null, -p.shoulderDropIdle)) applied++;
        if (applyToBone(bones.rightShoulder, null, null, p.shoulderDropIdle)) applied++;
        // 头部
        if (applyToBone(bones.head, null, null, p.headTilt)) applied++;

        // ===== 回退：缺失的骨骼用字符串匹配补充 =====
        const needed = ['leftLeg','rightLeg','leftLowerLeg','rightLowerLeg','leftFoot','rightFoot',
                        'leftForearm','rightForearm','leftShoulder','rightShoulder','head'];
        const missing = needed.filter(k => !bones[k]);
        if (missing.length > 0) {
            console.log(`[World3D] applyDefaultPose: 缓存匹配${applied}/11，缺失${missing.length}个，字符串匹配补充:`, missing);
            currentModel.traverse(node => {
                if (!node.isBone) return;
                const nl = node.name.toLowerCase();
                const isL = nl.endsWith('.l') || nl.includes('_l') || nl.includes('left');
                const isR = nl.endsWith('.r') || nl.includes('_r') || nl.includes('right');
                if (['upperleg','thigh','upleg'].some(k => nl.includes(k))) {
                    node.rotation.y = isL ? (p.thighInward - p.kneeFixThighY) : (isR ? (-p.thighInward + p.kneeFixThighY) : node.rotation.y);
                } else if (['lowerleg','calf','shin'].some(k => nl.includes(k))) {
                    node.rotation.y = isL ? (-p.calfInward + p.kneeFixCalfY) : (isR ? (p.calfInward - p.kneeFixCalfY) : node.rotation.y);
                } else if (nl.includes('foot') && !nl.includes('toe')) {
                    node.rotation.y = isL ? -p.footInward : (isR ? p.footInward : node.rotation.y);
                } else if (['lowerarm','forearm'].some(k => nl.includes(k))) {
                    node.rotation.x = p.elbowBendIdle;
                } else if (nl.includes('shoulder')) {
                    node.rotation.z = isL ? -p.shoulderDropIdle : (isR ? p.shoulderDropIdle : node.rotation.z);
                } else if (nl.includes('head') && !nl.includes('top') && !nl.includes('end')) {
                    node.rotation.z = p.headTilt;
                }
            });
        } else {
            console.log(`[World3D] applyDefaultPose: 全部${applied}/11骨骼通过缓存匹配（VRM官方API）`);
        }
    }

    function applyBoneAnimation(t, dt, moving, vmag) {
        if (!currentModel) return;
        vmag = vmag || 0;
        const walkAmt = moving ? Math.min(vmag * 25, 1) : 0;

        motionState.fly += (motionTarget.fly - motionState.fly) * 0.08;
        motionState.dock += (motionTarget.dock - motionState.dock) * 0.08;
        motionState.companion += (motionTarget.companion - motionState.companion) * 0.08;
        const ms = motionState;
        const handledBones = new Set();

        const setBone = (bone, rx, ry, rz) => {
            if (!bone) return;
            const key = boneKey(bone);
            const restQ = restQuats[key];
            if (!restQ) return;
            handledBones.add(bone);
            const relaxQ = relaxQuats[key];
            const animQ = new THREE.Quaternion().setFromEuler(
                new THREE.Euler(rx, ry, rz, 'XYZ')
            );
            // 合成顺序: autoFixQ × restQ × manualQ × animQ
            // manualQ 在 A-pose 空间（restQ 之后），animQ 在最外层
            bone.quaternion.copy(restQ);
            const mp = motionConfig.manualPose[key];
            if (mp && typeof mp.x === 'number') {
                const manualQ = new THREE.Quaternion().setFromEuler(
                    new THREE.Euler(mp.x, mp.y, mp.z, 'XYZ')
                );
                bone.quaternion.multiply(manualQ);
            }
            bone.quaternion.multiply(animQ);
            if (relaxQ) bone.quaternion.premultiply(relaxQ);
        };

        // 随机闲置动作
        const ic = motionConfig.idle;
        if (t > nextActionTime && ms.dock < 0.1 && !moving) {
            nextActionTime = t + ic.actionMin + Math.random() * (ic.actionMax - ic.actionMin);
            actionStart = t;
            actionType = Math.floor(Math.random() * 8);
        }
        let actY = 0, actZ = 0, actBodyX = 0, actBodyZ = 0, actArmL = 0, actArmR = 0, actLegL = 0, actLegR = 0;
        if (actionStart) {
            const at = t - actionStart;
            if (at < 2.5) {
                const env = Math.sin(at * Math.PI / 2.5) * (1 - at / 2.5);
                switch (actionType) {
                    case 0: actY = env * 0.5; break;                    // 转头
                    case 1: actZ = env * 0.2; break;                    // 歪头
                    case 2: actBodyX = -env * 0.06; actArmL = env * 0.3; actArmR = env * 0.3; break; // 伸展
                    case 3: actBodyX = env * 0.08; break;               // 前倾
                    case 4: actBodyZ = env * 0.06; actLegL = env * 0.05; actLegR = -env * 0.05; break; // 重心转移
                    case 5: actArmL = env * 0.15; actArmR = -env * 0.1; break; // 单手叉腰
                    case 6: actBodyX = env * 0.05; actArmL = env * 0.1; break;  // 挠头
                    case 7: actY = env * 0.3; actBodyX = -env * 0.03; break;    // 环顾
                }
            }
        }

        // ---- 脊柱 & 呼吸 ----
        const breath = Math.sin(t * ic.breathFreq) * ic.breathAmp;
        const stateLean = modelState === 'thinking' ? 0.04 : modelState === 'sleeping' ? -0.08 : 0;
        const wc = motionConfig.walk;

        if (walkAmt > 0.05) {
            // 走路时脊柱随步态轻微扭转（肩胯反向）
            const walkTwist = Math.sin(walkPhase) * wc.spineTwist * walkAmt;
            const walkLean = 0.04 * walkAmt;
            if (bones.chest) setBone(bones.chest, breath * 0.5 + walkLean, -walkTwist * 0.6, Math.sin(walkPhase * 2) * 0.015 * walkAmt);
            if (bones.spine) setBone(bones.spine, breath * 0.3 + walkLean * 0.5, -walkTwist * 0.3, Math.sin(walkPhase * 2) * 0.01 * walkAmt);
        } else {
            const sway = Math.sin(t * ic.swayFreq) * ic.swayAmp;
            const twist = Math.sin(t * 0.35) * 0.02;
            if (bones.chest) setBone(bones.chest, breath + stateLean + actBodyX, twist * 0.5, sway + actBodyZ);
            if (bones.spine) setBone(bones.spine, breath * 0.5 + stateLean * 0.5 + actBodyX * 0.5, twist * 0.3, sway * 0.6 + actBodyZ * 0.6);
        }
        if (bones.neck) setBone(bones.neck, breath * 0.2, actY * 0.15, Math.sin(t * 0.5) * 0.008);

        // ---- 重心 & 胯部 ----
        if (walkAmt > 0.05) {
            const hipBob = Math.abs(Math.sin(walkPhase)) * wc.hipBob * walkAmt;
            const hipSway = Math.sin(walkPhase * 2) * wc.hipSway * walkAmt;
            if (bones.hips) {
                setBone(bones.hips, 0, Math.sin(walkPhase) * 0.04 * walkAmt, hipSway);
                bones.hips.position.y = hipBob;
            }
        } else {
            weightShift = Math.sin(t * ic.weightShiftFreq) * ic.weightShiftAmp;
            if (bones.hips) {
                setBone(bones.hips, 0, 0, weightShift + actBodyZ * 0.5);
                bones.hips.position.y = Math.abs(Math.sin(t * ic.weightShiftFreq)) * 0.002;
            }
        }

        // ---- 头部 ----
        lookTimer -= dt;
        if (lookTimer <= 0) {
            lookTimer = 2.5 + Math.random() * 4;
            lookTarget.x = (Math.random() - 0.5) * ic.headAutonomousRange;
            lookTarget.y = (Math.random() - 0.5) * 0.15;
        }
        let aimX = mouseNDC.x * ic.headLookRange * 0.7 + lookTarget.x * 0.3 + actY;
        let aimY = mouseNDC.y * (ic.headLookRange * 0.55) * 0.7 + lookTarget.y * 0.3;
        if (wander.lookAtWindow) {
            const wp = screenToWorld(wander.lookAtWindow.x, wander.lookAtWindow.y);
            const hdx = wp.x - currentPos.x;
            const hdy = wp.y - currentPos.y;
            aimX = THREE.MathUtils.clamp(hdx * 0.25, -0.5, 0.5);
            aimY = THREE.MathUtils.clamp(hdy * 0.25, -0.3, 0.3);
        }
        lookCurrent.x += (aimX - lookCurrent.x) * 0.07;
        lookCurrent.y += (aimY - lookCurrent.y) * 0.07;
        if (bones.head) {
            setBone(bones.head, lookCurrent.y, lookCurrent.x, actZ + Math.sin(t * 0.35) * 0.01);
        }

        // ---- 肩膀（始终应用 autoFix 修正，走路时轻微反向运动） ----
        if (walkAmt > 0.05) {
            const shoulderShrug = Math.abs(Math.sin(walkPhase)) * 0.02 * walkAmt;
            setBone(bones.leftShoulder, shoulderShrug, 0, Math.sin(walkPhase) * 0.03 * walkAmt);
            setBone(bones.rightShoulder, shoulderShrug, 0, -Math.sin(walkPhase) * 0.03 * walkAmt);
        } else {
            setBone(bones.leftShoulder, 0, 0, 0);
            setBone(bones.rightShoulder, 0, 0, 0);
        }

        // ---- 手臂 ----
        if (walkAmt > 0.05) {
            // 走路摆臂：前后自然摆动，肘部微弯
            const swing = Math.sin(walkPhase) * wc.armSwing * walkAmt;
            const swingOpp = -swing;
            setBone(bones.leftArm, swing, 0, 0);
            setBone(bones.rightArm, swingOpp, 0, 0);
            setBone(bones.leftForearm, wc.forearmBend, 0, 0);
            setBone(bones.rightForearm, wc.forearmBend, 0, 0);
        } else if (ms.fly > 0.1) {
            setBone(bones.leftArm, -0.25, 0.08, 1.0 + actArmL);
            setBone(bones.rightArm, -0.25, -0.08, -1.0 + actArmR);
            setBone(bones.leftForearm, 0.05, 0, 0);
            setBone(bones.rightForearm, 0.05, 0, 0);
        } else {
            // 闲置：自然下垂
            const breatheArm = Math.sin(t * ic.breathFreq) * 0.01;
            setBone(bones.leftArm,
                Math.sin(t * 0.8) * 0.025 + actArmL * 0.4 + breatheArm,
                Math.sin(t * 0.6) * 0.02,
                actArmL * 0.5
            );
            setBone(bones.rightArm,
                Math.sin(t * 0.8 + 0.5) * 0.025 + actArmR * 0.4 + breatheArm,
                Math.sin(t * 0.6 + 1) * 0.015,
                actArmR * 0.5
            );
            setBone(bones.leftForearm, motionConfig.pose.idleElbowBend + Math.sin(t * 0.7) * 0.02, 0, 0);
            setBone(bones.rightForearm, motionConfig.pose.idleElbowBend + Math.sin(t * 0.7 + 0.8) * 0.02, 0, 0);
        }

        // ---- 腿部 ----
        if (walkAmt > 0.05) {
            const legSwing = Math.sin(walkPhase) * wc.legSwing * walkAmt;
            const kneeBend = Math.max(0, Math.sin(walkPhase + Math.PI * 0.7)) * wc.kneeBend * walkAmt;
            const kneeBendOpp = Math.max(0, Math.sin(walkPhase - Math.PI * 0.3)) * wc.kneeBend * walkAmt;
            setBone(bones.leftLeg, legSwing, 0, Math.sin(walkPhase) * 0.02 * walkAmt);
            setBone(bones.rightLeg, -legSwing, 0, -Math.sin(walkPhase) * 0.02 * walkAmt);
            setBone(bones.leftLowerLeg, 0.08 + kneeBend, 0, 0);
            setBone(bones.rightLowerLeg, 0.08 + kneeBendOpp, 0, 0);
            if (bones.leftFoot) setBone(bones.leftFoot, Math.max(0, -legSwing) * 0.3, 0, 0);
            if (bones.rightFoot) setBone(bones.rightFoot, Math.max(0, legSwing) * 0.3, 0, 0);
        } else {
            const ws = weightShift;
            const idleKnee = motionConfig.pose.idleKneeBend;
            if (bones.leftLeg) setBone(bones.leftLeg,
                Math.max(0, ws) * 0.04 + actLegL + ms.dock * 0.25,
                0, ws * 0.01 + ms.dock * 0.04
            );
            if (bones.rightLeg) setBone(bones.rightLeg,
                Math.max(0, -ws) * 0.04 + actLegR + ms.dock * 0.25,
                0, -ws * 0.01 - ms.dock * 0.04
            );
            if (bones.leftLowerLeg) setBone(bones.leftLowerLeg,
                idleKnee + Math.max(0, ws) * 0.04 + Math.sin(t * 1.0) * 0.006 + ms.dock * 0.4,
                0, 0
            );
            if (bones.rightLowerLeg) setBone(bones.rightLowerLeg,
                idleKnee + Math.max(0, -ws) * 0.04 + Math.sin(t * 1.0 + 0.5) * 0.006 + ms.dock * 0.4,
                0, 0
            );
            if (bones.leftFoot) setBone(bones.leftFoot, 0, 0, 0);
            if (bones.rightFoot) setBone(bones.rightFoot, 0, 0, 0);
        }

        // 挥手
        if (reactionArm && reactionStart) {
            const rt = (performance.now() - reactionStart) / 1000;
            if (rt < 1.5) {
                const key = boneKey(reactionArm);
                const restQ = restQuats[key];
                const relaxQ = relaxQuats[key];
                if (restQ) {
                    const waveQ = new THREE.Quaternion().setFromEuler(
                        new THREE.Euler(-0.5, 0, -1.6 + Math.sin(rt * 14) * 0.2, 'XYZ')
                    );
                    reactionArm.quaternion.copy(restQ);
                    const mp = motionConfig.manualPose[key];
                    if (mp && typeof mp.x === 'number') {
                        const manualQ = new THREE.Quaternion().setFromEuler(
                            new THREE.Euler(mp.x, mp.y, mp.z, 'XYZ')
                        );
                        reactionArm.quaternion.multiply(manualQ);
                    }
                    reactionArm.quaternion.multiply(waveQ);
                    if (relaxQ) reactionArm.quaternion.premultiply(relaxQ);
                }
                const isLeft = reactionArm === bones.leftArm;
                const elbow = isLeft ? bones.leftForearm : bones.rightForearm;
                if (elbow) {
                    const ekey = boneKey(elbow);
                    const erestQ = restQuats[ekey];
                    const erelaxQ = relaxQuats[ekey];
                    if (erestQ) {
                        const ewQ = new THREE.Quaternion().setFromEuler(
                            new THREE.Euler(0.7 + Math.sin(rt * 14) * 0.15, 0, 0, 'XYZ')
                        );
                        elbow.quaternion.copy(erestQ);
                        const emp = motionConfig.manualPose[ekey];
                        if (emp && typeof emp.x === 'number') {
                            const emanualQ = new THREE.Quaternion().setFromEuler(
                                new THREE.Euler(emp.x, emp.y, emp.z, 'XYZ')
                            );
                            elbow.quaternion.multiply(emanualQ);
                        }
                        elbow.quaternion.multiply(ewQ);
                        if (erelaxQ) elbow.quaternion.premultiply(erelaxQ);
                    }
                }
            } else {
                reactionArm = null;
                reactionStart = 0;
            }
        }

        // 眨眼
        blinkTimer -= dt;
        if (blinkTimer <= 0 && blinkProgress >= 1) {
            blinkProgress = 0;
            blinkTimer = 0.15;
        }
        if (blinkProgress < 1) {
            blinkProgress += dt * 8;
            if (blinkProgress >= 1) {
                blinkProgress = 1;
                blinkTimer = ic.blinkMin + Math.random() * (ic.blinkMax - ic.blinkMin);
            }
        }
        if (blinkMorph && blinkMorph.mesh.morphTargetInfluences) {
            blinkMorph.mesh.morphTargetInfluences[blinkMorph.index] = 1 - blinkProgress;
        }

        // 未被显式动画的命名骨骼（手部等）：应用 relaxQ × restQ × manualQ，确保与姿势编辑一致
        for (const [key, bone] of Object.entries(bones)) {
            if (!bone || handledBones.has(bone)) continue;
            const restQ = restQuats[key];
            if (!restQ) continue;
            bone.quaternion.copy(restQ);
            const mp = motionConfig.manualPose[key];
            if (mp && typeof mp.x === 'number') {
                const manualQ = new THREE.Quaternion().setFromEuler(
                    new THREE.Euler(mp.x, mp.y, mp.z, 'XYZ')
                );
                bone.quaternion.multiply(manualQ);
            }
            const relaxQ = relaxQuats[key];
            if (relaxQ) bone.quaternion.premultiply(relaxQ);
        }

        // 次级骨骼弹簧
        for (const s of secondarySprings) {
            const b = s.bone;
            const stiffness = 10, damping = 2.2;
            const swayX = Math.sin(t * 1.3 + s.phase) * 0.025 + weightShift * 1.5 + ms.fly * 0.05;
            const swayZ = Math.cos(t * 1.0 + s.phase) * 0.018;
            s.vel.x += (swayX - (b.rotation.x - s.rest.x)) * stiffness * dt;
            s.vel.z += (swayZ - (b.rotation.z - s.rest.z)) * stiffness * dt;
            s.vel.x *= (1 - damping * dt);
            s.vel.z *= (1 - damping * dt);
            b.rotation.x = s.rest.x + s.vel.x;
            b.rotation.z = s.rest.z + s.vel.z;
        }

        // VRM 更新：归一化骨骼旋转→实际骨骼、弹簧骨骼、表情
        // （applyBoneAnimation 是程序化动画路径，没有 Mixamo 动画时调用）
        if (currentVRM) {
            try { currentVRM.update(dt); } catch(e) { /* 忽略 */ }
        }
    }

    function boneKey(bone) {
        for (const [key, b] of Object.entries(bones)) {
            if (b === bone) return key;
        }
        // 未在命名表中的骨骼，用名字作为 key
        return bone && bone.name ? 'bone_' + bone.name.toLowerCase().replace(/[\s_.-]/g, '') : null;
    }

    // ---- 调试面板 ----

    let debugPanel = null;
    let selectedBone = null;
    let poseEditMode = false;
    let poseDragging = false;
    let poseDragMoved = false;
    let poseDragStart = { x: 0, y: 0 };
    let poseDragAxis = 'xy';
    let poseDragFine = false;  // Alt 精细模式
    let raycaster = null;
    let pointer = null;
    let frozenRelaxQuats = null;  // 姿势编辑时冻结的自动修正
    let skeletonGroup = null;    // 骨架可视化组
    let skeletonJoints = null;   // Map: bone → joint mesh
    let skeletonLines = null;    // 骨骼连线
    let hoveredBone = null;      // 鼠标悬停的骨骼
    let poseDragSensitivity = 0.004;  // 拖拽灵敏度

    const PANEL_STYLE = [
        'position:fixed', 'top:60px', 'right:16px', 'z-index:99999',
        'width:300px', 'max-height:calc(100vh - 100px)', 'overflow-y:auto',
        'background:rgba(255,255,255,0.96)', 'border:1px solid #ddd',
        'border-radius:12px', 'box-shadow:0 8px 32px rgba(0,0,0,0.15)',
        'font:12px -apple-system,sans-serif', 'color:#333',
        'display:none', 'flex-direction:column'
    ].join(';');

    const SLIDER_GROUPS = [
        {
            label: '呼吸 & 闲置', category: 'idle',
            sliders: [
                { key: 'breathAmp', label: '呼吸幅度', min: 0, max: 0.08, step: 0.002 },
                { key: 'breathFreq', label: '呼吸频率', min: 0.5, max: 4, step: 0.1 },
                { key: 'weightShiftAmp', label: '重心转移', min: 0, max: 0.05, step: 0.002 },
                { key: 'swayAmp', label: '身体晃动', min: 0, max: 0.1, step: 0.005 },
                { key: 'idleBobAmp', label: '闲置起伏', min: 0, max: 0.02, step: 0.001 },
                { key: 'idleSwayAmp', label: '闲置摇摆', min: 0, max: 0.03, step: 0.002 },
                { key: 'actionMin', label: '随机动作最小间隔(s)', min: 1, max: 15, step: 0.5 },
                { key: 'actionMax', label: '随机动作最大间隔(s)', min: 5, max: 20, step: 0.5 },
            ]
        },
        {
            label: '走路', category: 'walk',
            sliders: [
                { key: 'armSwing', label: '摆臂幅度', min: 0, max: 0.8, step: 0.02 },
                { key: 'forearmBend', label: '走路弯肘', min: 0, max: 0.6, step: 0.02 },
                { key: 'legSwing', label: '迈腿幅度', min: 0, max: 0.8, step: 0.02 },
                { key: 'kneeBend', label: '弯膝幅度', min: 0, max: 1.0, step: 0.02 },
                { key: 'hipBob', label: '胯部起伏', min: 0, max: 0.06, step: 0.002 },
                { key: 'hipSway', label: '胯部左右摆', min: 0, max: 0.06, step: 0.002 },
                { key: 'spineTwist', label: '脊柱扭转', min: 0, max: 0.2, step: 0.01 },
                { key: 'walkBob', label: '走路起伏', min: 0, max: 0.06, step: 0.002 },
                { key: 'speed', label: '移动速度(px/s)', min: 20, max: 150, step: 5 },
            ]
        },
        {
            label: '姿态修正', category: 'pose',
            sliders: [
                { key: 'armOutX', label: '手臂外张', min: 0, max: 0.6, step: 0.01 },
                { key: 'armForwardZ', label: '手臂前倾', min: -0.3, max: 0.3, step: 0.01 },
                { key: 'elbowBend', label: '肘部弯曲', min: 0, max: 0.6, step: 0.01 },
                { key: 'elbowSide', label: '肘部外展', min: 0, max: 0.2, step: 0.01 },
                { key: 'shoulderDrop', label: '肩膀下沉', min: 0, max: 0.2, step: 0.01 },
                { key: 'shoulderSide', label: '肩膀外张', min: 0, max: 0.15, step: 0.01 },
                { key: 'idleElbowBend', label: '闲置弯肘', min: 0, max: 0.3, step: 0.01 },
                { key: 'idleKneeBend', label: '闲置弯膝', min: 0, max: 0.2, step: 0.01 },
            ]
        },
        {
            label: '头部 & 相机', category: 'head_cam',
            sliders: [
                { key: 'headLookRange', label: '头部追踪范围', min: 0, max: 0.5, step: 0.01, category: 'idle' },
                { key: 'headAutonomousRange', label: '自主环视范围', min: 0, max: 0.6, step: 0.02, category: 'idle' },
                { key: 'blinkMin', label: '眨眼最小间隔(s)', min: 1, max: 8, step: 0.5, category: 'idle' },
                { key: 'blinkMax', label: '眨眼最大间隔(s)', min: 3, max: 12, step: 0.5, category: 'idle' },
                { key: 'parallaxX', label: '相机视差X', min: 0, max: 0.5, step: 0.01, category: 'camera' },
                { key: 'parallaxY', label: '相机视差Y', min: 0, max: 0.3, step: 0.01, category: 'camera' },
                { key: 'parallaxSpeed', label: '视差跟随速度', min: 0.01, max: 0.15, step: 0.005, category: 'camera' },
            ]
        }
    ];

    function createDebugPanel() {
        if (debugPanel) return;
        debugPanel = document.createElement('div');
        debugPanel.id = 'world3d-debug-panel';
        debugPanel.style.cssText = PANEL_STYLE;

        // 标题栏
        const header = document.createElement('div');
        header.style.cssText = 'padding:10px 14px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;cursor:move;';
        header.innerHTML = '<b>动作调试</b><span id="w3d-dp-close" style="cursor:pointer;color:#999;font-size:16px;">×</span>';
        debugPanel.appendChild(header);

        // Tab 切换
        const tabs = document.createElement('div');
        tabs.style.cssText = 'display:flex;border-bottom:1px solid #eee;';
        tabs.innerHTML = '<div data-tab="params" class="w3d-tab active" style="flex:1;padding:8px;text-align:center;cursor:pointer;border-bottom:2px solid #6a4c93;font-weight:600;">动作参数</div><div data-tab="pose" class="w3d-tab" style="flex:1;padding:8px;text-align:center;cursor:pointer;color:#999;">姿势编辑</div>';
        debugPanel.appendChild(tabs);

        // 参数面板
        const paramsDiv = document.createElement('div');
        paramsDiv.id = 'w3d-dp-params';
        paramsDiv.style.cssText = 'padding:10px 14px;overflow-y:auto;flex:1;';

        SLIDER_GROUPS.forEach(group => {
            const groupTitle = document.createElement('div');
            groupTitle.style.cssText = 'font-weight:600;color:#6a4c93;margin:8px 0 4px;font-size:11px;text-transform:uppercase;';
            groupTitle.textContent = group.label;
            paramsDiv.appendChild(groupTitle);

            group.sliders.forEach(s => {
                const cat = s.category || group.category;
                const row = document.createElement('div');
                row.style.cssText = 'margin:6px 0;';
                row.innerHTML = `
                    <div style="display:flex;justify-content:space-between;font-size:11px;color:#666;">
                        <span>${s.label}</span>
                        <span class="w3d-val" data-cat="${cat}" data-key="${s.key}">${motionConfig[cat][s.key]}</span>
                    </div>
                    <input type="range" min="${s.min}" max="${s.max}" step="${s.step}"
                        value="${motionConfig[cat][s.key]}"
                        data-cat="${cat}" data-key="${s.key}"
                        style="width:100%;margin:2px 0;">
                `;
                paramsDiv.appendChild(row);
            });
        });

        // 按钮
        const btnDiv = document.createElement('div');
        btnDiv.style.cssText = 'padding:10px 14px;border-top:1px solid #eee;display:flex;gap:8px;';
        btnDiv.innerHTML = `
            <button id="w3d-dp-save" style="flex:1;padding:6px;background:#6a4c93;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;">保存</button>
            <button id="w3d-dp-reset" style="flex:1;padding:6px;background:#eee;color:#333;border:none;border-radius:6px;cursor:pointer;font-size:12px;">重置</button>
        `;
        paramsDiv.appendChild(btnDiv);
        debugPanel.appendChild(paramsDiv);

        // 姿势编辑面板
        const poseDiv = document.createElement('div');
        poseDiv.id = 'w3d-dp-pose';
        poseDiv.style.cssText = 'padding:10px 14px;display:none;flex:1;flex-direction:column;gap:8px;overflow-y:auto;';
        poseDiv.innerHTML = `
            <div style="font-size:11px;color:#666;line-height:1.5;">
                点击紫色关节球选中骨骼，直接拖拽旋转。<br>
                左右拖=绕竖直轴，上下拖=绕水平轴，Shift+拖=绕纵深轴，Alt+拖=精细模式。<br>
                滑块可精细微调，调整后自动保存。
            </div>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
                <input type="checkbox" id="w3d-pose-mode"> 启用姿势编辑（暂停动作）
            </label>
            <div id="w3d-bone-info" style="font-size:12px;color:#6a4c93;min-height:20px;">未选择骨骼</div>
            <div id="w3d-bone-sliders" style="display:none;flex-direction:column;gap:6px;">
                <div>
                    <div style="display:flex;justify-content:space-between;font-size:11px;"><span>X 旋转</span><span id="w3d-bone-x-val">0</span></div>
                    <input type="range" id="w3d-bone-x" min="-3.14" max="3.14" step="0.01" style="width:100%;">
                </div>
                <div>
                    <div style="display:flex;justify-content:space-between;font-size:11px;"><span>Y 旋转</span><span id="w3d-bone-y-val">0</span></div>
                    <input type="range" id="w3d-bone-y" min="-3.14" max="3.14" step="0.01" style="width:100%;">
                </div>
                <div>
                    <div style="display:flex;justify-content:space-between;font-size:11px;"><span>Z 旋转</span><span id="w3d-bone-z-val">0</span></div>
                    <input type="range" id="w3d-bone-z" min="-3.14" max="3.14" step="0.01" style="width:100%;">
                </div>
                <button id="w3d-bone-reset" style="padding:5px;background:#eee;border:none;border-radius:4px;cursor:pointer;font-size:11px;">复位此骨骼</button>
            </div>
            <div style="display:flex;gap:6px;margin-top:8px;">
                <button id="w3d-auto-pose" style="flex:1;padding:7px;background:#6a4c93;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;">一键校准姿势</button>
                <button id="w3d-auto-motion" style="flex:1;padding:7px;background:#4a7c59;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;">一键优化动作</button>
            </div>
            <div id="w3d-bone-list" style="max-height:200px;overflow-y:auto;border:1px solid #eee;border-radius:6px;"></div>
        `;
        debugPanel.appendChild(poseDiv);

        document.body.appendChild(debugPanel);

        // 事件绑定
        debugPanel.querySelector('#w3d-dp-close').onclick = () => { debugPanel.style.display = 'none'; };
        const allTabs = tabs.querySelectorAll('.w3d-tab');
        allTabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const isParams = tab.dataset.tab === 'params';
                allTabs.forEach(t => {
                    t.classList.toggle('active', t === tab);
                    t.style.borderBottom = t === tab ? '2px solid #6a4c93' : 'none';
                    t.style.fontWeight = t === tab ? '600' : 'normal';
                    t.style.color = t === tab ? '#333' : '#999';
                });
                paramsDiv.style.display = isParams ? 'block' : 'none';
                poseDiv.style.display = isParams ? 'none' : 'flex';
            });
        });

        paramsDiv.querySelectorAll('input[type=range]').forEach(input => {
            input.oninput = () => {
                const cat = input.dataset.cat;
                const key = input.dataset.key;
                const val = parseFloat(input.value);
                motionConfig[cat][key] = val;
                const valEl = paramsDiv.querySelector(`.w3d-val[data-cat="${cat}"][data-key="${key}"]`);
                if (valEl) valEl.textContent = val.toFixed(3);
                needsRender = true;
                // 姿态参数改变时重新计算
                if (cat === 'pose') {
                    if (poseEditMode) {
                        recalcAutoFixSafe();
                    } else {
                        relaxQuats = {};
                        try { autoFixPose(); } catch(e) {}
                    }
                }
            };
        });

        debugPanel.querySelector('#w3d-dp-save').onclick = () => {
            saveMotionConfig().then(d => {
                const btn = debugPanel.querySelector('#w3d-dp-save');
                btn.textContent = d.success ? '已保存 ✓' : '保存失败';
                setTimeout(() => btn.textContent = '保存', 1500);
            });
        };
        debugPanel.querySelector('#w3d-dp-reset').onclick = () => {
            resetMotionConfig();
            relaxQuats = {};
            try { autoFixPose(); } catch(e) {}
            paramsDiv.querySelectorAll('input[type=range]').forEach(input => {
                const cat = input.dataset.cat;
                const key = input.dataset.key;
                input.value = motionConfig[cat][key];
                const valEl = paramsDiv.querySelector(`.w3d-val[data-cat="${cat}"][data-key="${key}"]`);
                if (valEl) valEl.textContent = motionConfig[cat][key].toFixed(3);
            });
        };

        // 姿势编辑事件
        const poseCheckbox = debugPanel.querySelector('#w3d-pose-mode');
        poseCheckbox.onchange = () => {
            poseEditMode = poseCheckbox.checked;
            if (poseEditMode && canvas) {
                canvas.style.pointerEvents = 'auto';
                canvas.style.cursor = 'crosshair';
                canvas.style.zIndex = '99998';
                if (!raycaster) initPoseEditing();
                // 冻结当前自动修正，编辑期间不重算
                frozenRelaxQuats = {};
                for (const k in relaxQuats) {
                    frozenRelaxQuats[k] = relaxQuats[k].clone();
                }
                buildBoneList();
                // 显示骨架可视化
                showSkeleton();
                updateSkeletonPositions();
            } else if (canvas) {
                canvas.style.pointerEvents = 'none';
                canvas.style.cursor = 'default';
                canvas.style.zIndex = '50';
                selectedBone = null;
                hoveredBone = null;
                hideSkeleton();
                updateBoneInfo();
                frozenRelaxQuats = null;
                // 退出姿势编辑时自动保存
                saveMotionConfig().then(d => {
                    if (d.success) console.log('[World3D] 姿势已自动保存');
                });
            }
        };

        ['x', 'y', 'z'].forEach(axis => {
            const slider = debugPanel.querySelector(`#w3d-bone-${axis}`);
            slider.oninput = () => {
                if (!selectedBone) return;
                const val = parseFloat(slider.value);
                document.getElementById(`w3d-bone-${axis}-val`).textContent = val.toFixed(3);
                applyManualBoneRotation(selectedBone);
                needsRender = true;
            };
        });

        debugPanel.querySelector('#w3d-bone-reset').onclick = () => {
            if (!selectedBone) return;
            const key = boneKey(selectedBone);
            if (key && motionConfig.manualPose[key]) {
                delete motionConfig.manualPose[key];
                updateBoneSliders();
                needsRender = true;
            }
        };

        // 一键校准姿势：取用户微调后的姿势，左右镜像对称
        debugPanel.querySelector('#w3d-auto-pose').onclick = () => {
            symmetrizePose();
        };

        // 一键优化动作：根据校准后的姿势计算符合运动规律的参数
        debugPanel.querySelector('#w3d-auto-motion').onclick = () => {
            autoTuneMotion();
        };

        // 面板拖拽
        makeDraggable(header, debugPanel);
    }

    function makeDraggable(handle, panel) {
        let startX, startY, startLeft, startTop;
        handle.onmousedown = (e) => {
            if (e.target.tagName === 'SPAN') return;
            startX = e.clientX; startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            startLeft = rect.left; startTop = rect.top;
            const onMove = (ev) => {
                panel.style.left = (startLeft + ev.clientX - startX) + 'px';
                panel.style.top = (startTop + ev.clientY - startY) + 'px';
                panel.style.right = 'auto';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
    }

    function toggleDebugPanel() {
        if (!debugPanel) createDebugPanel();
        debugPanel.style.display = debugPanel.style.display === 'none' ? 'flex' : 'none';
        if (debugPanel.style.display === 'flex' && !configLoaded) {
            loadMotionConfig().then(() => {
                const paramsDiv = document.getElementById('w3d-dp-params');
                if (paramsDiv) {
                    paramsDiv.querySelectorAll('input[type=range]').forEach(input => {
                        const cat = input.dataset.cat;
                        const key = input.dataset.key;
                        input.value = motionConfig[cat][key];
                        const valEl = paramsDiv.querySelector(`.w3d-val[data-cat="${cat}"][data-key="${key}"]`);
                        if (valEl) valEl.textContent = motionConfig[cat][key].toFixed(3);
                    });
                }
                relaxQuats = {};
                try { autoFixPose(); } catch(e) {}
            });
        }
    }

    // ---- 骨骼点选 ----

    function buildBoneList() {
        const list = document.getElementById('w3d-bone-list');
        if (!list) return;
        list.innerHTML = '';
        // 命名骨骼
        const namedKeys = new Set();
        Object.entries(bones).forEach(([key, bone]) => {
            namedKeys.add(bone);
            const item = document.createElement('div');
            item.style.cssText = 'padding:4px 8px;cursor:pointer;font-size:11px;border-bottom:1px solid #f0f0f0;color:#6a4c93;';
            item.textContent = key + (motionConfig.manualPose[key] ? ' *' : '');
            item.onclick = () => selectBone(bone);
            list.appendChild(item);
        });
        // 其他所有骨骼
        if (currentModel) {
            const seen = new Set(namedKeys);
            currentModel.traverse(node => {
                if (node.isBone && !seen.has(node) && node.name) {
                    seen.add(node);
                    const key = boneKey(node);
                    const item = document.createElement('div');
                    item.style.cssText = 'padding:3px 8px;cursor:pointer;font-size:10px;border-bottom:1px solid #f8f8f8;color:#888;';
                    item.textContent = node.name + (key && motionConfig.manualPose[key] ? ' *' : '');
                    item.onclick = () => selectBone(node);
                    list.appendChild(item);
                }
            });
        }
    }

    function selectBone(bone) {
        // 清除上一个选中骨骼的高亮
        if (selectedBone && skeletonJoints) {
            const prevJoint = skeletonJoints.get(selectedBone);
            if (prevJoint) setJointVisualState(prevJoint, prevJoint === hoveredBone ? 'hover' : 'normal');
        }
        selectedBone = bone;
        // 高亮新选中的骨骼
        if (skeletonJoints) {
            const joint = skeletonJoints.get(bone);
            if (joint) setJointVisualState(joint, 'selected');
        }
        updateBoneInfo();
        updateBoneSliders();
        // 高亮列表中选中的骨骼
        const list = document.getElementById('w3d-bone-list');
        if (list) {
            list.querySelectorAll('div').forEach(el => el.style.background = '');
            const key = boneKey(bone);
            list.querySelectorAll('div').forEach(el => {
                if (el.textContent === key || el.textContent === key + ' *' ||
                    el.textContent === bone.name || el.textContent === bone.name + ' *') {
                    el.style.background = '#f0e8ff';
                }
            });
        }
        needsRender = true;
    }

    function updateBoneInfo() {
        const info = document.getElementById('w3d-bone-info');
        const sliders = document.getElementById('w3d-bone-sliders');
        if (!info) return;
        if (selectedBone) {
            const key = boneKey(selectedBone);
            info.textContent = '已选择: ' + (key || selectedBone.name);
            sliders.style.display = 'flex';
        } else {
            info.textContent = '未选择骨骼';
            sliders.style.display = 'none';
        }
    }

    function updateBoneSliders() {
        if (!selectedBone) return;
        const key = boneKey(selectedBone);
        const mp = motionConfig.manualPose[key];
        const euler = mp ? new THREE.Euler(mp.x, mp.y, mp.z, 'XYZ') : new THREE.Euler(0, 0, 0, 'XYZ');
        ['x', 'y', 'z'].forEach(axis => {
            const slider = document.getElementById(`w3d-bone-${axis}`);
            const valEl = document.getElementById(`w3d-bone-${axis}-val`);
            if (slider) slider.value = euler[axis];
            if (valEl) valEl.textContent = euler[axis].toFixed(3);
        });
    }

    // 左右骨骼对
    const SYMMETRY_PAIRS = [
        ['leftShoulder', 'rightShoulder'],
        ['leftArm', 'rightArm'],
        ['leftForearm', 'rightForearm'],
        ['leftHand', 'rightHand'],
        ['leftLeg', 'rightLeg'],
        ['leftLowerLeg', 'rightLowerLeg'],
        ['leftFoot', 'rightFoot'],
    ];

    // 沿 YZ 平面镜像四元数（x → -x）
    function mirrorQuat(q) {
        return new THREE.Quaternion(-q.x, q.y, q.z, -q.w);
    }

    // 从世界四元数反推 manualPose 欧拉角
    function extractManualEuler(bone, worldQ, relaxKey) {
        const restQ = bone.userData.restQuaternion;
        if (!restQ) return null;
        const parentWorldQ = new THREE.Quaternion();
        if (bone.parent) bone.parent.getWorldQuaternion(parentWorldQ);
        const relaxQ = relaxQuats[relaxKey] || new THREE.Quaternion();
        // worldQ = parentWorldQ × relaxQ × restQ × manualQ
        // manualQ = (relaxQ × restQ)^-1 × parentWorldQ^-1 × worldQ
        const baseQ = new THREE.Quaternion().copy(relaxQ).multiply(restQ);
        const manualQ = baseQ.clone().invert().multiply(parentWorldQ.clone().invert()).multiply(worldQ);
        return new THREE.Euler().setFromQuaternion(manualQ, 'XYZ');
    }

    // 一键校准姿势：读取用户微调，左右镜像对称
    function symmetrizePose() {
        if (!currentModel) return;

        // 临时把命名骨骼设为 relaxQ × restQ × manualQ（去掉动画偏移），确保读取的是用户姿势
        const savedQuats = {};
        for (const key in bones) {
            const bone = bones[key];
            if (!bone || !bone.userData.restQuaternion) continue;
            savedQuats[key] = bone.quaternion.clone();
            const restQ = bone.userData.restQuaternion;
            const relaxQ = relaxQuats[key] || new THREE.Quaternion();
            const mp = motionConfig.manualPose[key];
            const manualQ = mp ? new THREE.Quaternion().setFromEuler(new THREE.Euler(mp.x, mp.y, mp.z, 'XYZ')) : new THREE.Quaternion();
            bone.quaternion.copy(restQ).multiply(manualQ).premultiply(relaxQ);
        }
        currentModel.updateMatrixWorld(true);

        const _wq = new THREE.Quaternion();

        SYMMETRY_PAIRS.forEach(([leftKey, rightKey]) => {
            const leftBone = bones[leftKey];
            const rightBone = bones[rightKey];
            if (!leftBone || !rightBone) return;

            leftBone.getWorldQuaternion(_wq);
            const leftWorldQ = _wq.clone();
            rightBone.getWorldQuaternion(_wq);
            const rightWorldQ = _wq.clone();

            // 镜像
            const mirrorLeft = mirrorQuat(leftWorldQ);
            const mirrorRight = mirrorQuat(rightWorldQ);

            // 取平均（处理四元数双覆盖问题：q 和 -q 表示同一旋转）
            if (leftWorldQ.dot(mirrorRight) < 0) {
                mirrorRight.x *= -1; mirrorRight.y *= -1; mirrorRight.z *= -1; mirrorRight.w *= -1;
            }
            if (rightWorldQ.dot(mirrorLeft) < 0) {
                mirrorLeft.x *= -1; mirrorLeft.y *= -1; mirrorLeft.z *= -1; mirrorLeft.w *= -1;
            }
            const leftTargetQ = new THREE.Quaternion().copy(leftWorldQ).add(mirrorRight).normalize();
            const rightTargetQ = new THREE.Quaternion().copy(rightWorldQ).add(mirrorLeft).normalize();

            // 反推 manual 欧拉角
            const leftEuler = extractManualEuler(leftBone, leftTargetQ, leftKey);
            const rightEuler = extractManualEuler(rightBone, rightTargetQ, rightKey);
            if (!leftEuler || !rightEuler) return;

            const threshold = 0.003;
            const saveEuler = (key, euler) => {
                if (Math.abs(euler.x) > threshold || Math.abs(euler.y) > threshold || Math.abs(euler.z) > threshold) {
                    motionConfig.manualPose[key] = {
                        x: parseFloat(euler.x.toFixed(4)),
                        y: parseFloat(euler.y.toFixed(4)),
                        z: parseFloat(euler.z.toFixed(4))
                    };
                } else {
                    delete motionConfig.manualPose[key];
                }
            };
            saveEuler(leftKey, leftEuler);
            saveEuler(rightKey, rightEuler);
        });

        // 恢复骨骼四元数
        for (const key in savedQuats) {
            bones[key].quaternion.copy(savedQuats[key]);
        }
        currentModel.updateMatrixWorld(true);

        // 重新计算自动修正
        try { recalcAutoFixSafe(); } catch(e) { console.warn('[World3D] recalcAutoFixSafe:', e); }

        updateBoneSliders();
        buildBoneList();
        if (skeletonGroup) updateSkeletonPositions();
        needsRender = true;
        saveMotionConfig();
    }

    // 一键优化动作：根据校准后的姿势计算符合运动规律的参数
    function autoTuneMotion() {
        if (!currentModel) return;
        currentModel.updateMatrixWorld(true);

        // 测量手臂在 A-pose 中的方向
        function boneWorldDir(key) {
            const bone = bones[key];
            if (!bone) return null;
            const wq = new THREE.Quaternion();
            bone.getWorldQuaternion(wq);
            return new THREE.Vector3(0, 1, 0).applyQuaternion(wq).normalize();
        }

        // 测量两个骨骼之间的夹角
        function boneAngle(key1, key2) {
            const b1 = bones[key1], b2 = bones[key2];
            if (!b1 || !b2) return 0;
            const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
            b1.getWorldQuaternion(q1);
            b2.getWorldQuaternion(q2);
            return q1.angleTo(q2);
        }

        // 手臂外张角度（手臂方向与垂直向下的夹角）
        const leftArmDir = boneWorldDir('leftArm');
        const rightArmDir = boneWorldDir('rightArm');
        let armOutAngle = 0.2; // 默认约 11°
        if (leftArmDir && rightArmDir) {
            const down = new THREE.Vector3(0, -1, 0);
            const leftAngle = Math.acos(Math.max(-1, Math.min(1, leftArmDir.dot(down))));
            const rightAngle = Math.acos(Math.max(-1, Math.min(1, rightArmDir.dot(down))));
            armOutAngle = (leftAngle + rightAngle) / 2;
        }

        // 肘部弯曲角度
        const elbowBend = (boneAngle('leftArm', 'leftForearm') + boneAngle('rightArm', 'rightForearm')) / 2;
        // 膝盖弯曲角度
        const kneeBend = (boneAngle('leftLeg', 'leftLowerLeg') + boneAngle('rightLeg', 'rightLowerLeg')) / 2;

        // 根据姿势计算走路参数
        // 摆臂幅度：手臂越外张，摆幅略小（避免穿模）；垂直下垂时摆幅最大
        const armSwing = Math.max(0.2, 0.38 - armOutAngle * 0.5);
        // 走路弯肘：在当前肘部弯曲基础上增加一点
        const walkForearmBend = Math.max(0.1, elbowBend + 0.08);
        // 走路弯膝：在当前膝盖弯曲基础上增加
        const walkKneeBend = Math.max(0.35, kneeBend + 0.35);
        // 抬腿幅度：固定合理值
        const legSwing = 0.35;
        // 身体弹性和扭转：小幅自然
        motionConfig.walk.armSwing = parseFloat(armSwing.toFixed(3));
        motionConfig.walk.forearmBend = parseFloat(walkForearmBend.toFixed(3));
        motionConfig.walk.legSwing = legSwing;
        motionConfig.walk.kneeBend = parseFloat(walkKneeBend.toFixed(3));
        motionConfig.walk.hipBob = 0.015;
        motionConfig.walk.hipSway = 0.012;
        motionConfig.walk.spineTwist = 0.05;
        motionConfig.walk.walkBob = 0.02;

        // 闲置参数：根据姿势微调
        motionConfig.idle.breathAmp = 0.015;
        motionConfig.idle.weightShiftAmp = 0.008;
        motionConfig.idle.swayAmp = 0.02;
        motionConfig.idle.idleBobAmp = 0.002;
        motionConfig.idle.idleSwayAmp = 0.004;
        // 闲置时肘部和膝盖保持校准后的弯曲
        motionConfig.pose.idleElbowBend = parseFloat(Math.max(0.04, elbowBend).toFixed(3));
        motionConfig.pose.idleKneeBend = parseFloat(Math.max(0.02, kneeBend).toFixed(3));

        updateParamSliders();
        needsRender = true;
        saveMotionConfig();
    }

    function updateParamSliders() {
        const paramsDiv = document.getElementById('w3d-dp-params');
        if (!paramsDiv) return;
        paramsDiv.querySelectorAll('input[type=range]').forEach(input => {
            const cat = input.dataset.cat;
            const key = input.dataset.key;
            if (motionConfig[cat] && typeof motionConfig[cat][key] === 'number') {
                input.value = motionConfig[cat][key];
                const valEl = paramsDiv.querySelector(`.w3d-val[data-cat="${cat}"][data-key="${key}"]`);
                if (valEl) valEl.textContent = motionConfig[cat][key].toFixed(3);
            }
        });
    }

    function applyManualBoneRotation(bone) {
        const key = boneKey(bone);
        if (!key) return;
        const x = parseFloat(document.getElementById('w3d-bone-x').value);
        const y = parseFloat(document.getElementById('w3d-bone-y').value);
        const z = parseFloat(document.getElementById('w3d-bone-z').value);
        motionConfig.manualPose[key] = { x, y, z };
        // manualPose 在 setBone 和渲染循环中直接叠加，不需要重算 autoFixPose
    }

    function pickBone(mouseX, mouseY) {
        if (!currentModel || !raycaster) return null;
        pointer.x = (mouseX / window.innerWidth) * 2 - 1;
        pointer.y = -(mouseY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);

        // 优先检测骨架关节小球（精准选择）
        if (skeletonGroup && skeletonGroup.visible && skeletonJoints) {
            const jointMeshes = Array.from(skeletonJoints.values());
            const jointHits = raycaster.intersectObjects(jointMeshes, false);
            if (jointHits.length > 0) {
                const hit = jointHits[0].object;
                if (hit.userData.bone) return hit.userData.bone;
            }
        }

        // 回退：检测模型网格，取骨权重最大的骨骼
        const meshes = [];
        currentModel.traverse(n => { if (n.isMesh && n.skeleton) meshes.push(n); });
        const hits = raycaster.intersectObjects(meshes, false);
        if (hits.length === 0) return null;

        const hit = hits[0];
        const mesh = hit.object;
        const skinIndex = mesh.geometry.getAttribute('skinIndex');
        const skinWeight = mesh.geometry.getAttribute('skinWeight');
        if (!skinIndex || !skinWeight) return null;

        // 找到命中三角形的顶点，取骨权重最大的骨骼
        const faceIndex = hit.faceIndex;
        const vertices = [faceIndex * 3, faceIndex * 3 + 1, faceIndex * 3 + 2];
        const boneWeights = {};
        for (const vi of vertices) {
            const idx = [skinIndex.getX(vi), skinIndex.getY(vi), skinIndex.getZ(vi), skinIndex.getW(vi)];
            const w = [skinWeight.getX(vi), skinWeight.getY(vi), skinWeight.getZ(vi), skinWeight.getW(vi)];
            for (let i = 0; i < 4; i++) {
                if (w[i] > 0.01) {
                    const boneIdx = idx[i];
                    boneWeights[boneIdx] = (boneWeights[boneIdx] || 0) + w[i];
                }
            }
        }

        let bestBoneIdx = -1, bestWeight = 0;
        for (const [bi, bw] of Object.entries(boneWeights)) {
            if (bw > bestWeight) { bestWeight = bw; bestBoneIdx = parseInt(bi); }
        }
        if (bestBoneIdx < 0) return null;

        const bone = mesh.skeleton.bones[bestBoneIdx];
        // 尝试匹配到命名骨骼
        const boneName = bone.name.toLowerCase().replace(/[\s_.-]/g, '');
        for (const [key, b] of Object.entries(bones)) {
            if (b === bone) return b;
            const bn = b.name.toLowerCase().replace(/[\s_.-]/g, '');
            if (bn === boneName || (bn.length >= 5 && (boneName.endsWith(bn) || bn.endsWith(boneName)))) return b;
        }
        return bone;
    }

    function onCanvasClick(e) {
        // 拖拽后的 click 事件抑制（避免拖拽后误触）
        if (poseDragMoved) {
            e.preventDefault();
            e.stopPropagation();
            poseDragMoved = false;
            return;
        }
    }

    function onCanvasMouseDown(e) {
        if (!poseEditMode) return;
        e.preventDefault();
        e.stopPropagation();
        // 按下时立即拾取骨骼并选中，同时开始拖拽
        const bone = pickBone(e.clientX, e.clientY);
        if (bone) {
            selectBone(bone);
            poseDragging = true;
            poseDragStart = { x: e.clientX, y: e.clientY };
            poseDragAxis = e.shiftKey ? 'z' : 'xy';
            poseDragFine = e.altKey;
            poseDragMoved = false;
            if (canvas) canvas.style.cursor = 'grabbing';
            needsRender = true;
        }
    }

    function onCanvasMouseMove(e) {
        if (!poseEditMode) return;

        // 拖拽中：旋转骨骼
        if (poseDragging && selectedBone) {
            const sens = poseDragFine ? 0.0015 : 0.004;
            const dx = (e.clientX - poseDragStart.x) * sens;
            const dy = (e.clientY - poseDragStart.y) * sens;
            poseDragStart = { x: e.clientX, y: e.clientY };
            if (Math.abs(dx) > 0.00001 || Math.abs(dy) > 0.00001) poseDragMoved = true;

            const key = boneKey(selectedBone);
            if (key) {
                const cur = motionConfig.manualPose[key] || { x: 0, y: 0, z: 0 };
                if (poseDragAxis === 'z') {
                    cur.z += dx;
                } else {
                    cur.y += dx;  // 左右拖 → 绕竖直轴
                    cur.x += dy;  // 上下拖 → 绕水平轴
                }
                motionConfig.manualPose[key] = cur;
                updateBoneSliders();
                needsRender = true;
            }
            return;
        }

        // 非拖拽：悬停检测，高亮关节
        const bone = pickBone(e.clientX, e.clientY);
        if (bone !== hoveredBone) {
            // 恢复上一个悬停关节
            if (hoveredBone && skeletonJoints) {
                const prevJoint = skeletonJoints.get(hoveredBone);
                if (prevJoint && hoveredBone !== selectedBone) {
                    setJointVisualState(prevJoint, 'normal');
                }
            }
            hoveredBone = bone;
            // 高亮新悬停关节
            if (hoveredBone && skeletonJoints) {
                const joint = skeletonJoints.get(hoveredBone);
                if (joint && hoveredBone !== selectedBone) {
                    setJointVisualState(joint, 'hover');
                }
            }
            if (canvas) canvas.style.cursor = bone ? 'pointer' : 'crosshair';
            needsRender = true;
        }
    }

    function onCanvasMouseUp() {
        if (poseDragging) {
            poseDragging = false;
            if (canvas) canvas.style.cursor = hoveredBone ? 'pointer' : 'crosshair';
            if (poseDragMoved) {
                // 有拖拽，自动保存
                saveMotionConfig().then(d => {
                    if (d.success) console.log('[World3D] 姿势调整已自动保存');
                }).catch(() => {});
            }
            poseDragMoved = false;
        }
    }

    // ---- 骨架可视化 ----

    // 人体骨骼连接关系（父→子）
    const BONE_CONNECTIONS = [
        ['hips', 'spine'], ['spine', 'chest'], ['chest', 'neck'], ['neck', 'head'],
        ['chest', 'leftShoulder'], ['leftShoulder', 'leftArm'], ['leftArm', 'leftForearm'], ['leftForearm', 'leftHand'],
        ['chest', 'rightShoulder'], ['rightShoulder', 'rightArm'], ['rightArm', 'rightForearm'], ['rightForearm', 'rightHand'],
        ['hips', 'leftLeg'], ['leftLeg', 'leftLowerLeg'], ['leftLowerLeg', 'leftFoot'],
        ['hips', 'rightLeg'], ['rightLeg', 'rightLowerLeg'], ['rightLowerLeg', 'rightFoot'],
    ];

    function buildSkeletonVisualization() {
        if (skeletonGroup || !currentModel) return;
        skeletonGroup = new THREE.Group();
        skeletonGroup.renderOrder = 998;
        skeletonJoints = new Map();

        // 为每个命名骨骼创建关节小球
        const jointGeo = new THREE.SphereGeometry(1, 10, 10);
        const jointMatNormal = new THREE.MeshBasicMaterial({ color: 0x6a4c93, transparent: true, opacity: 0.7, depthTest: false });
        const jointMatHover = new THREE.MeshBasicMaterial({ color: 0xff9800, transparent: true, opacity: 0.9, depthTest: false });
        const jointMatSelected = new THREE.MeshBasicMaterial({ color: 0x4caf50, transparent: true, opacity: 1.0, depthTest: false });

        for (const [key, bone] of Object.entries(bones)) {
            const joint = new THREE.Mesh(jointGeo, jointMatNormal);
            joint.renderOrder = 999;
            joint.frustumCulled = false;
            joint.userData.bone = bone;
            joint.userData.isJoint = true;
            joint.userData.mats = { normal: jointMatNormal, hover: jointMatHover, selected: jointMatSelected };
            skeletonGroup.add(joint);
            skeletonJoints.set(bone, joint);
        }

        // 骨骼连线
        const linePositions = [];
        for (const [parentKey, childKey] of BONE_CONNECTIONS) {
            const p = bones[parentKey];
            const c = bones[childKey];
            if (p && c) {
                const pp = new THREE.Vector3();
                const cp = new THREE.Vector3();
                p.getWorldPosition(pp);
                c.getWorldPosition(cp);
                linePositions.push(pp.x, pp.y, pp.z, cp.x, cp.y, cp.z);
            }
        }
        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
        const lineMat = new THREE.LineBasicMaterial({ color: 0x6a4c93, transparent: true, opacity: 0.4, depthTest: false });
        skeletonLines = new THREE.LineSegments(lineGeo, lineMat);
        skeletonLines.renderOrder = 998;
        skeletonLines.frustumCulled = false;
        skeletonGroup.add(skeletonLines);

        scene.add(skeletonGroup);
        skeletonGroup.visible = false;
    }

    function updateSkeletonPositions() {
        if (!skeletonGroup || !skeletonGroup.visible) return;
        currentModel.updateMatrixWorld(true);
        const scale = 0.025 / Math.max(modelScale, 0.1);

        // 更新关节位置
        for (const [bone, joint] of skeletonJoints) {
            const wp = new THREE.Vector3();
            bone.getWorldPosition(wp);
            joint.position.copy(wp);
            joint.scale.setScalar(scale);
        }

        // 更新连线
        if (skeletonLines) {
            const pos = skeletonLines.geometry.attributes.position;
            let idx = 0;
            for (const [parentKey, childKey] of BONE_CONNECTIONS) {
                const p = bones[parentKey];
                const c = bones[childKey];
                if (p && c) {
                    const pp = new THREE.Vector3();
                    const cp = new THREE.Vector3();
                    p.getWorldPosition(pp);
                    c.getWorldPosition(cp);
                    pos.setXYZ(idx, pp.x, pp.y, pp.z);
                    pos.setXYZ(idx + 1, cp.x, cp.y, cp.z);
                    idx += 2;
                }
            }
            pos.needsUpdate = true;
        }
    }

    function setJointVisualState(joint, state) {
        if (!joint || !joint.userData.mats) return;
        joint.material = joint.userData.mats[state] || joint.userData.mats.normal;
    }

    function showSkeleton() {
        if (!skeletonGroup) buildSkeletonVisualization();
        if (skeletonGroup) skeletonGroup.visible = true;
    }

    function hideSkeleton() {
        if (skeletonGroup) skeletonGroup.visible = false;
        hoveredBone = null;
    }

    function initPoseEditing() {
        if (!THREE || !canvas || raycaster) return;
        raycaster = new THREE.Raycaster();
        pointer = new THREE.Vector2();
        canvas.addEventListener('mousedown', onCanvasMouseDown);
        canvas.addEventListener('click', onCanvasClick);
        window.addEventListener('mousemove', onCanvasMouseMove);
        window.addEventListener('mouseup', onCanvasMouseUp);
        console.log('[World3D] 姿势编辑事件已绑定');
    }

    // ---- 模块加载 ----

    function isThirdPartyAllowed() {
        try {
            var val = localStorage.getItem('mrhua_allow_third_party');
            return val === null || val === 'true';
        } catch(e) {
            return true;
        }
    }

    function loadModules() {
        if (!isThirdPartyAllowed()) {
            console.warn('[World3D] 三方库已禁用，无法加载three.js。请在设置中开启"允许使用三方库（需联网）"。');
            return Promise.reject(new Error('三方库已禁用'));
        }
        return Promise.all([
            import('three'),
            import('three/addons/loaders/GLTFLoader.js'),
            import('three/addons/loaders/FBXLoader.js'),
            import('@pixiv/three-vrm')
        ]).then(([THREE_NS, gltfNS, fbxNS, vrmNS]) => {
            THREE = THREE_NS;
            GLTFLoader = gltfNS.GLTFLoader;
            FBXLoader = fbxNS.FBXLoader;
            VRMLoaderPlugin = vrmNS.VRMLoaderPlugin;
            VRMUtils = vrmNS.VRMUtils;
            targetPos = new THREE.Vector3(0, 0, 0);
            currentPos = new THREE.Vector3(0, 0, 0);
        });
    }

    // ---- 公开 API ----

    window.World3D = {
        load(url, opts) {
            if (!THREE) {
                return loadModules().then(() => loadModel(url, opts));
            }
            return loadModel(url, opts);
        },
        // 剪影灵体模式：加载VRM模型并转为纯色半透明剪影
        loadSilhouette(url, opts) {
            if (!THREE) {
                return loadModules().then(() => loadSilhouette(url, opts));
            }
            return loadSilhouette(url, opts);
        },
        // 设置剪影灵体状态：idle/happy/thinking/working/talking/sleeping/error/success/alert
        setSilhouetteState(state) {
            setSilhouetteState(state);
        },
        // 是否为剪影灵体模式
        isSilhouetteMode() {
            return silhouetteMode;
        },
        // 触发剪影灵体动作: wave/nod/shake/think/happy/surprise/bow/clap/shrug/point
        triggerSilhouetteAction(actionName) {
            return triggerSilhouetteAction(actionName);
        },
        // 获取剪影灵体可用动作列表
        getSilhouetteActions() {
            return Object.keys(SILHOUETTE_ACTIONS);
        },
        loadStage(url, type) {
            if (!THREE) {
                return loadModules().then(() => loadStage(url, type));
            }
            return loadStage(url, type);
        },
        clearStage,
        flyToScreen,
        flyToElement,
        setScreenPosition,
        setScale,
        screenToWorld,
        glanceAtElement,
        show,
        hide,
        hasModel,
        getRoot() { return modelRoot; },
        getScene() { return scene; },
        getCamera() { return camera; },
        getRenderer() { return renderer; },
        getVRM() { return currentVRM; },
        getBones() { return bones; },
        getCanvas() { return canvas; },
        setMotion(motion, value) {
            if (motion in motionTarget) {
                motionTarget[motion] = value ? 1 : 0;
                needsRender = true;
            }
        },
        setState(state) {
            modelState = state;
            needsRender = true;
        },
        react(type) {
            if (type === 'wave' || type === 'happy') {
                reactionArm = Math.random() > 0.5 ? bones.leftArm : bones.rightArm;
                reactionStart = performance.now();
                needsRender = true;
            }
        },
        // === 动画动作系统接口 ===
        triggerAction(name, duration) {
            const def = PROCEDURAL_ACTIONS[name];
            if (!def) {
                console.warn('[World3D] 未知动作:', name, '可用:', Object.keys(PROCEDURAL_ACTIONS));
                return false;
            }
            const action = {
                name,
                duration: duration || def.duration,
                priority: def.priority,
                startTime: performance.now(),
                bones: def.bones || []
            };
            // 按优先级插入队列
            let inserted = false;
            for (let i = 0; i < actionQueue.length; i++) {
                if (action.priority > actionQueue[i].priority) {
                    actionQueue.splice(i, 0, action);
                    inserted = true;
                    break;
                }
            }
            if (!inserted) actionQueue.push(action);
            console.log(`[World3D] 动作触发: ${name} (${def.desc}), 队列长度: ${actionQueue.length}`);
            needsRender = true;
            return true;
        },
        getActions() {
            return Object.entries(PROCEDURAL_ACTIONS).map(([name, def]) => ({
                name, desc: def.desc, duration: def.duration, priority: def.priority
            }));
        },
        getCurrentAction() {
            return currentAction ? { name: currentAction.name, desc: PROCEDURAL_ACTIONS[currentAction.name].desc, progress: getActionProgress() } : null;
        },
        getActionQueue() {
            return actionQueue.map(a => ({ name: a.name, desc: PROCEDURAL_ACTIONS[a.name].desc, priority: a.priority }));
        },
        clearActions() {
            actionQueue = [];
            currentAction = null;
            actionBlend = 0;
        },
        // 调试: 设置上臂偏移, 用于找出正确的旋转轴
        setDebugArmOffset(x, y, z) {
            debugArmMode = true;
            debugArmOffset = { x: x || 0, y: y || 0, z: z || 0 };
            console.log(`[DEBUG-ARM] 偏移已设置: x=${debugArmOffset.x.toFixed(3)}, y=${debugArmOffset.y.toFixed(3)}, z=${debugArmOffset.z.toFixed(3)}`);
            needsRender = true;
        },
        getDebugArmOffset() {
            return { ...debugArmOffset, mode: debugArmMode };
        },
        resetDebugArmOffset() {
            debugArmOffset = { x: 0, y: 0, z: 0 };
            console.log('[DEBUG-ARM] 偏移已重置');
            needsRender = true;
        },
        // 实时设置挥手动作偏移（不需要重启）
        setWaveOffset(upperX, upperY, upperZ, lowerX, lowerY, lowerZ) {
            waveOverride = {
                upperX: upperX || 0, upperY: upperY || 0, upperZ: upperZ || 0,
                lowerX: lowerX || 0, lowerY: lowerY || 0, lowerZ: lowerZ || 0
            };
            console.log(`[WAVE-OVERRIDE] 已设置: upper(${waveOverride.upperX},${waveOverride.upperY},${waveOverride.upperZ}) lower(${waveOverride.lowerX},${waveOverride.lowerY},${waveOverride.lowerZ})`);
            needsRender = true;
        },
        resetWaveOffset() {
            waveOverride = null;
            console.log('[WAVE-OVERRIDE] 已重置为默认值');
            needsRender = true;
        },
        getWaveOffset() {
            return waveOverride ? { ...waveOverride } : null;
        },
        // 通用: 设置任意动作任意骨骼的偏移覆盖
        setActionOffset(actionName, boneName, x, y, z) {
            if (!actionOverrides[actionName]) actionOverrides[actionName] = {};
            actionOverrides[actionName][boneName] = { x: x || 0, y: y || 0, z: z || 0 };
            console.log(`[ACTION-OVERRIDE] ${actionName}.${boneName} = (${x||0}, ${y||0}, ${z||0})`);
            needsRender = true;
        },
        resetActionOffset(actionName) {
            delete actionOverrides[actionName];
            console.log(`[ACTION-OVERRIDE] ${actionName} 已重置为默认值`);
            needsRender = true;
        },
        getActionOffset(actionName) {
            return actionOverrides[actionName] ? { ...actionOverrides[actionName] } : null;
        },
        // 一次性设置某个动作的多个骨骼偏移
        setActionOffsets(actionName, offsetsObj) {
            actionOverrides[actionName] = {};
            for (const boneName in offsetsObj) {
                const o = offsetsObj[boneName];
                actionOverrides[actionName][boneName] = { x: o.x || 0, y: o.y || 0, z: o.z || 0 };
            }
            console.log(`[ACTION-OVERRIDE] ${actionName} 已设置 ${Object.keys(offsetsObj).length} 个骨骼`);
            needsRender = true;
        },
        toggleDebugPanel,
        applyDefaultPose,
        getConfig() { return motionConfig; },
        getVRMDebug() {
            if (!currentVRM) return { hasVRM: false };
            const h = currentVRM.humanoid;
            const result = { hasVRM: true, bones: {} };
            for (const name of ['hips', 'spine', 'chest', 'neck', 'head',
                'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
                'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
                'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
                'rightUpperLeg', 'rightLowerLeg', 'rightFoot']) {
                const nb = h.getNormalizedBoneNode(name);
                if (nb) {
                    result.bones[name] = [nb.quaternion.x.toFixed(3), nb.quaternion.y.toFixed(3), nb.quaternion.z.toFixed(3), nb.quaternion.w.toFixed(3)];
                }
            }
            return result;
        },
        getBoneAxisDebug() {
            const result = {};
            const checkBones = [
                ['UpperArmL', 'LowerArmL'], ['UpperArmR', 'LowerArmR'],
                ['UpperLegL', 'LowerLegL'], ['UpperLegR', 'LowerLegR']
            ];
            for (const [boneName, childName] of checkBones) {
                let bone = null, child = null;
                currentModel.traverse(n => {
                    if (n.name === boneName) bone = n;
                    if (n.name === childName) child = n;
                });
                if (!bone || !child) continue;
                const worldQ = new THREE.Quaternion();
                bone.getWorldQuaternion(worldQ);
                const yAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(worldQ);
                const p1 = new THREE.Vector3();
                const p2 = new THREE.Vector3();
                bone.getWorldPosition(p1);
                child.getWorldPosition(p2);
                const childDir = p2.sub(p1).normalize();
                result[boneName] = {
                    yAxis: [yAxis.x.toFixed(3), yAxis.y.toFixed(3), yAxis.z.toFixed(3)],
                    childDir: [childDir.x.toFixed(3), childDir.y.toFixed(3), childDir.z.toFixed(3)],
                    dot: yAxis.dot(childDir).toFixed(3)
                };
            }
            return result;
        },
        setConfig(cfg) {
            if (cfg) {
                for (const k of Object.keys(defaultConfig)) {
                    if (cfg[k] && typeof cfg[k] === 'object') Object.assign(motionConfig[k], cfg[k]);
                }
                if (cfg.manualPose) motionConfig.manualPose = cfg.manualPose;
                relaxQuats = {};
                try { autoFixPose(); } catch(e) {}
                needsRender = true;
            }
        }
    };

    // 全局键盘快捷键（脚本加载即绑定，不依赖 init）
    function bindDebugShortcut() {
        const handler = (e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.shiftKey && (e.key === 'P' || e.key === 'p' || e.key === 'D' || e.key === 'd')) {
                e.preventDefault();
                e.stopPropagation();
                toggleDebugPanel();
            }
        };
        window.addEventListener('keydown', handler, true);
        document.addEventListener('keydown', handler, true);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindDebugShortcut);
    } else {
        bindDebugShortcut();
    }

    // 页面关闭前自动保存配置
    window.addEventListener('beforeunload', () => {
        if (configLoaded && Object.keys(motionConfig.manualPose).length > 0) {
            try {
                const blob = new Blob([JSON.stringify(motionConfig)], { type: 'application/json' });
                // sendBeacon 不阻塞页面关闭
                navigator.sendBeacon('/api/orb/motion_config', blob);
            } catch(e) {}
        }
    });

    // 实时调试: 键盘调整上臂偏移, 找出正确的旋转轴
    // 按 ` 键切换调试模式, 1/2=X, 3/4=Y, 5/6=Z, 0=重置
    window.addEventListener('keydown', (e) => {
        if (e.key === '`') {
            debugArmMode = !debugArmMode;
            console.log(`[DEBUG-ARM] 调试模式: ${debugArmMode ? '开启' : '关闭'}`);
            if (debugArmMode) {
                console.log('[DEBUG-ARM] 控制: 1/2=X±0.1, 3/4=Y±0.1, 5/6=Z±0.1, 0=重置');
            }
            return;
        }
        if (!debugArmMode) return;
        const step = e.shiftKey ? 0.05 : 0.1;
        switch (e.key) {
            case '1': debugArmOffset.x -= step; break;
            case '2': debugArmOffset.x += step; break;
            case '3': debugArmOffset.y -= step; break;
            case '4': debugArmOffset.y += step; break;
            case '5': debugArmOffset.z -= step; break;
            case '6': debugArmOffset.z += step; break;
            case '0': debugArmOffset = { x: 0, y: 0, z: 0 }; break;
            default: return;
        }
        console.log(`[DEBUG-ARM] offset: x=${debugArmOffset.x.toFixed(3)}, y=${debugArmOffset.y.toFixed(3)}, z=${debugArmOffset.z.toFixed(3)}`);
        needsRender = true;
    });

})();
