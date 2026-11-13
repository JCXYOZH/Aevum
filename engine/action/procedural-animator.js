/**
 * Aevum 人形动作：程序化骨骼与 Morph 动作。
 */
/**
 * ProceduralAnimator — 纯代码驱动的程序化人形动作引擎
 *
 * 不依赖任何外部动画文件（.vmd/.bvh/.fbx动画）或第三方动画库。
 * 全部动作通过骨骼变换数学 + 正弦/噪声函数实时计算。
 *
 * 支持骨骼命名约定：MMD(日文)、VRM、Mixamo、Blender、glTF标准、自定义
 * 支持模型类型：PMX/PMD、VRM、GLB/glTF、FBX（任何含骨骼的three.js模型）
 *
 * 功能层：
 *   1. 骨骼自动检测（100+命名模式，左右对称，缺失回退）
 *   2. 休息姿态捕获（加载时冻结原始变换）
 *   3. 自动姿态修正（T-pose/A-pose检测，手臂/腿部朝向校正）
 *   4. 呼吸（胸腔/脊柱/肩膀/腹部多层联动）
 *   5. 闲置微摆（胯部/脊柱/头部/手指自然微动）
 *   6. 眨眼（形态键优先，眼睑骨骼回退）
 *   7. 状态姿态（idle/happy/thinking/working/talking/sleeping/error）
 *   8. 重心转移（胯部/腿部/重心左右摆动）
 *   9. 手臂闲置（自然下垂+微摆+呼吸联动）
 *  10. 视线跟随（头部/颈部平滑追踪目标点）
 *  11. 平滑插值（所有动作 lerp/slerp，无突变）
 */
(function (global) {
    'use strict';

    // ===== 骨骼命名模式库（按部位分组，每组按优先级排序）=====
    // 每条规则：{ match: 正则或函数, side: 'left'|'right'|'center', priority: 数字 }
    const BONE_PATTERNS = {
        hips: [
            /^(hips|hip|pelvis|root|center|centre|j_bip_c|j_center)$/i,
            /(センター|中心|腰|骨盤|骨盆|下半身|下身)/,
            /(hip|pelvis)/i
        ],
        spine: [
            /^(spine|spine1|lowerback|j_bip_s|waist)$/i,
            /(背骨|脊柱|腰骨|上半身下)/,
            /spine[_\s]?[1l]/i
        ],
        chest: [
            /^(chest|spine2|upperback|j_bip_upperbody|upperbody)$/i,
            /(上半身|胸腔|胸骨|胸)/,
            /spine[_\s]?[2u]/i
        ],
        upperChest: [
            /^(upperchest|upper_chest|spine3|j_bip_upperbody2)$/i,
            /(上半身2|上胸)/,
            /spine[_\s]?3/i
        ],
        neck: [
            /^(neck|neck1|j_bip_n)$/i,
            /(首|頸|脖子)/,
            /neck/i
        ],
        head: [
            /^(head|j_bip_h|headend)$/i,
            /(頭|头|あたま)/,
            /head(?!band|phone|set|light)/i
        ],
        // 左臂链
        leftShoulder: [
            /^(leftshoulder|lshoulder|shoulder\.l|shoulder_l|j_bip_l_shoulder|shoulderl)$/i,
            /(左肩|肩l|左鎖骨)/,
            /shoulder.*left|left.*shoulder/i
        ],
        leftArm: [
            /^(leftupperarm|leftarm|upperarm\.l|upperarm_l|upperarml|j_bip_l_upperarm|arml)$/i,
            /(左腕|左うで|左上腕)/,
            /(upperarm|arm).*left|left.*(upperarm|arm)/i
        ],
        leftForearm: [
            /^(leftlowerarm|leftforearm|lowerarm\.l|lowerarm_l|forearm\.l|forearm_l|elbow\.l|elbow_l|lowerarml|j_bip_l_lowerarm)$/i,
            /(左ひじ|左肘|左前腕)/,
            /(lowerarm|forearm|elbow).*left|left.*(lowerarm|forearm|elbow)/i
        ],
        leftHand: [
            /^(lefthand|lhand|hand\.l|hand_l|handl|j_bip_l_hand|wristl)$/i,
            /(左手|左手首|左手首)/,
            /(hand|wrist).*left|left.*(hand|wrist)/i
        ],
        // 右臂链
        rightShoulder: [
            /^(rightshoulder|rshoulder|shoulder\.r|shoulder_r|j_bip_r_shoulder|shoulderr)$/i,
            /(右肩|肩r|右鎖骨)/,
            /shoulder.*right|right.*shoulder/i
        ],
        rightArm: [
            /^(rightupperarm|rightarm|upperarm\.r|upperarm_r|upperarmr|j_bip_r_upperarm|armr)$/i,
            /(右腕|右うで|右上腕)/,
            /(upperarm|arm).*right|right.*(upperarm|arm)/i
        ],
        rightForearm: [
            /^(rightlowerarm|rightforearm|lowerarm\.r|lowerarm_r|forearm\.r|forearm_r|elbow\.r|elbow_r|lowerarmr|j_bip_r_lowerarm)$/i,
            /(右ひじ|右肘|右前腕)/,
            /(lowerarm|forearm|elbow).*right|right.*(lowerarm|forearm|elbow)/i
        ],
        rightHand: [
            /^(righthand|rhand|hand\.r|hand_r|handr|j_bip_r_hand|wristr)$/i,
            /(右手|右手首)/,
            /(hand|wrist).*right|right.*(hand|wrist)/i
        ],
        // 左腿链
        leftLeg: [
            /^(leftupperleg|leftleg|upperleg\.l|upperleg_l|thigh\.l|thigh_l|leg\.l|leg_l|upperlegl|j_bip_l_upperleg)$/i,
            /(左足|左太もも|左大腿|左腿)/,
            /(upperleg|thigh|leg).*left|left.*(upperleg|thigh|leg)/i
        ],
        leftLowerLeg: [
            /^(leftlowerleg|calf\.l|calf_l|knee\.l|knee_l|lowerleg\.l|lowerleg_l|lowerlegl|j_bip_l_lowerleg|shin\.l)$/i,
            /(左ひざ|左膝|左すね|左小腿)/,
            /(lowerleg|calf|knee|shin).*left|left.*(lowerleg|calf|knee|shin)/i
        ],
        leftFoot: [
            /^(leftfoot|foot\.l|foot_l|ankle\.l|ankle_l|footl|j_bip_l_foot)$/i,
            /(左足首|左つま先|左脚首)/,
            /(foot|ankle).*left|left.*(foot|ankle)/i
        ],
        leftToes: [
            /^(lefttoes|toes\.l|toe\.l|toes_l|j_bip_l_toes)$/i,
            /(左つま先|左足指)/,
            /(toe|toes).*left|left.*(toe|toes)/i
        ],
        // 右腿链
        rightLeg: [
            /^(rightupperleg|rightleg|upperleg\.r|upperleg_r|thigh\.r|thigh_r|leg\.r|leg_r|upperlegr|j_bip_r_upperleg)$/i,
            /(右足|右太もも|右大腿|右腿)/,
            /(upperleg|thigh|leg).*right|right.*(upperleg|thigh|leg)/i
        ],
        rightLowerLeg: [
            /^(rightlowerleg|calf\.r|calf_r|knee\.r|knee_r|lowerleg\.r|lowerleg_r|lowerlegr|j_bip_r_lowerleg|shin\.r)$/i,
            /(右ひざ|右膝|右すね|右小腿)/,
            /(lowerleg|calf|knee|shin).*right|right.*(lowerleg|calf|knee|shin)/i
        ],
        rightFoot: [
            /^(rightfoot|foot\.r|foot_r|ankle\.r|ankle_r|footr|j_bip_r_foot)$/i,
            /(右足首|右つま先|右脚首)/,
            /(foot|ankle).*right|right.*(foot|ankle)/i
        ],
        rightToes: [
            /^(righttoes|toes\.r|toe\.r|toes_r|j_bip_r_toes)$/i,
            /(右つま先|右足指)/,
            /(toe|toes).*right|right.*(toe|toes)/i
        ],
        // 眼睑（眨眼骨骼回退）
        leftEye: [
            /^(lefteye|eye\.l|eye_l|j_bip_l_eye|eyelid_l|lefteyelid)$/i,
            /(左目|左眼)/,
            /(eye|eyelid).*left|left.*(eye|eyelid)/i
        ],
        rightEye: [
            /^(righteye|eye\.r|eye_r|j_bip_r_eye|eyelid_r|righteyelid)$/i,
            /(右目|右眼)/,
            /(eye|eyelid).*right|right.*(eye|eyelid)/i
        ],
        // 下颌（说话时动）
        jaw: [
            /^(jaw|j_bip_face_jaw|chin)$/i,
            /(顎|颚|下颌|下巴)/,
            /jaw/i
        ]
    };

    // 形态键（morph target）命名模式
    const MORPH_PATTERNS = {
        blink: [
            /(wink|blink|瞬き|まばたき|目を閉じる|闭眼|眨眼)/i,
            /^eye(close|smile|wink)/i
        ],
        smile: [
            /(smile|笑い|微笑|笑)/i
        ],
        mouthOpen: [
            /(mouth.*open|open.*mouth|口開|张嘴|a\s*$)/i
        ]
    };

    // 辅助：平滑插值
    function lerp(a, b, t) { return a + (b - a) * t; }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function smoothstep(edge0, edge1, x) {
        const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
        return t * t * (3 - 2 * t);
    }

    // ===== ProceduralAnimator 类 =====
    class ProceduralAnimator {
        /**
         * @param {THREE.Object3D} model - 含骨骼的模型（SkinnedMesh 的父对象）
         * @param {Object} options - { scale: 模型缩放基准, isVRM: boolean, vrm: VRM实例 }
         */
        constructor(model, options) {
            this.model = model;
            this.options = options || {};
            this.THREE = this.options.THREE || (global.THREE);
            this.bones = {};          // 标准部位 -> Bone 对象
            this.restRot = {};        // 标准部位 -> {x,y,z} 休息旋转
            this.restPos = {};        // 标准部位 -> {x,y,z} 休息位置
            this.restQuat = {};       // 标准部位 -> Quaternion 休息四元数
            this.allBones = [];       // 所有骨骼列表
            this.morphs = { blink: [], smile: [], mouthOpen: [] };
            this.morphMeshes = [];
            this.detected = false;
            this.poseCorrected = false;
            this.mode = this.options.mode || 'full'; // 'full' = 骨骼+形态键, 'morphsOnly' = 仅形态键(眨眼/嘴部)
            this.time = 0;
            this.dt = 0;
            this.state = 'idle';
            this.lookTarget = { x: 0, y: 0, active: false };
            this.lookCurrent = { x: 0, y: 0 };
            this.blinkTimer = 0;
            this.blinkValue = 0;
            this.blinkPhase = 'open'; // open/closing/closed/opening
            this.nextBlink = 3 + Math.random() * 5;
            this.idlePhase = Math.random() * Math.PI * 2;
            this.breathPhase = Math.random() * Math.PI * 2;
            this.weightShiftPhase = Math.random() * Math.PI * 2;
            this.smooth = {
                breath: 0, sway: 0, weight: 0, stateBlend: {},
                armL: 0, armR: 0, legL: 0, legR: 0, headX: 0, headY: 0,
                jaw: 0, dock: 0, fly: 0
            };
            this.dockAmount = 0;
            this.flyAmount = 0;
            this.talking = false;
            this.talkPhase = 0;
            this._lastTime = performance.now();
        }

        // ===== 骨骼检测 =====
        detect() {
            if (!this.model || !this.THREE) return false;
            this.bones = {};
            this.allBones = [];
            this.morphs = { blink: [], smile: [], mouthOpen: [] };
            this.morphMeshes = [];

            // 收集所有骨骼
            this.model.traverse((node) => {
                if (node.isBone) {
                    this.allBones.push(node);
                }
                // 收集形态键
                if (node.isMesh && node.morphTargetDictionary && node.morphTargetInfluences) {
                    this.morphMeshes.push(node);
                    const dict = node.morphTargetDictionary;
                    for (const [name, idx] of Object.entries(dict)) {
                        for (const [mtype, patterns] of Object.entries(MORPH_PATTERNS)) {
                            if (patterns.some(p => p.test(name))) {
                                this.morphs[mtype].push({ mesh: node, name, idx });
                                break;
                            }
                        }
                    }
                }
            });

            // VRM 官方人形骨骼 API（优先级最高）
            if (this.options.vrm && this.options.vrm.humanoid) {
                const vrmMap = {
                    hips: 'hips', spine: 'spine', chest: 'chest', upperChest: 'upperChest',
                    neck: 'neck', head: 'head',
                    leftShoulder: 'leftShoulder', leftArm: 'leftUpperArm',
                    leftForearm: 'leftLowerArm', leftHand: 'leftHand',
                    rightShoulder: 'rightShoulder', rightArm: 'rightUpperArm',
                    rightForearm: 'rightLowerArm', rightHand: 'rightHand',
                    leftLeg: 'leftUpperLeg', leftLowerLeg: 'leftLowerLeg',
                    leftFoot: 'leftFoot', leftToes: 'leftToes',
                    rightLeg: 'rightUpperLeg', rightLowerLeg: 'rightLowerLeg',
                    rightFoot: 'rightFoot', rightToes: 'rightToes',
                    jaw: 'jaw'
                };
                for (const [key, vrmKey] of Object.entries(vrmMap)) {
                    try {
                        const boneNode = this.options.vrm.humanoid.getNormalizedBoneNode(vrmKey);
                        if (boneNode) this.bones[key] = boneNode;
                    } catch (e) { /* 某些 VRM 版本 API 不同 */ }
                }
            }

            // 字符串匹配补充（VRM 未找到的部位）
            for (const [key, patterns] of Object.entries(BONE_PATTERNS)) {
                if (this.bones[key]) continue;
                for (const bone of this.allBones) {
                    const rawName = bone.name || '';
                    for (const pat of patterns) {
                        if (pat.test(rawName)) {
                            this.bones[key] = bone;
                            break;
                        }
                    }
                    if (this.bones[key]) break;
                }
            }

            // 捕获休息姿态
            for (const [key, bone] of Object.entries(this.bones)) {
                this.restRot[key] = { x: bone.rotation.x, y: bone.rotation.y, z: bone.rotation.z };
                this.restPos[key] = { x: bone.position.x, y: bone.position.y, z: bone.position.z };
                this.restQuat[key] = bone.quaternion.clone();
            }

            this.detected = true;
            return true;
        }

        // ===== 自动姿态修正 =====
        autoCorrectPose() {
            if (!this.detected || this.poseCorrected) return;
            const T = this.THREE;
            if (!T) return;

            // 安全检查：标准骨骼检测过少（<5）说明不是标准人形模型，跳过修正避免飞散
            const detectedCount = ['hips', 'spine', 'chest', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg']
                .filter(k => this.bones[k]).length;
            if (detectedCount < 5) {
                console.warn('[ProceduralAnimator] 跳过姿态修正: 标准骨骼仅 ' + detectedCount + ' 个，非标准人形模型');
                this.poseCorrected = true;
                return;
            }

            this.model.updateMatrixWorld(true);

            // 用子骨骼世界位置确定骨骼实际长轴方向（不依赖本地轴约定，兼容 MMD/VRM/Mixamo）
            const getBoneDirByChild = (bone, childBone) => {
                if (!bone) return null;
                const parentPos = new T.Vector3();
                bone.getWorldPosition(parentPos);
                let childPos = null;
                if (childBone) {
                    childPos = new T.Vector3();
                    childBone.getWorldPosition(childPos);
                } else {
                    // 回退：找第一个子骨骼
                    for (const child of bone.children) {
                        if (child.isBone) {
                            childPos = new T.Vector3();
                            child.getWorldPosition(childPos);
                            break;
                        }
                    }
                }
                if (!childPos) return null;
                const dir = childPos.clone().sub(parentPos).normalize();
                if (dir.lengthSq() < 0.01) return null;
                return dir;
            };

            // 将世界空间四元数增量转换为骨骼本地空间
            const worldToLocalDelta = (bone, worldDelta) => {
                if (!bone.parent) return worldDelta.clone();
                const parentWorldQuat = new T.Quaternion();
                bone.parent.getWorldQuaternion(parentWorldQuat);
                const invParent = parentWorldQuat.clone().invert();
                return invParent.clone().multiply(worldDelta).multiply(parentWorldQuat);
            };

            // 应用修正到休息姿态
            const applyCorrection = (key, bone, localDelta) => {
                const restQ = (this.restQuat[key] || bone.quaternion.clone()).clone();
                this.restQuat[key] = localDelta.multiply(restQ);
                const e = new T.Euler().setFromQuaternion(this.restQuat[key], 'XYZ');
                this.restRot[key] = { x: e.x, y: e.y, z: e.z };
            };

            // 安全修正：角度不超过 maxAngle，避免方向检测错误导致骨骼飞散
            const safeCorrect = (key, bone, childBone, targetDir, maxAngle) => {
                if (!bone) return false;
                const currentDir = getBoneDirByChild(bone, childBone);
                if (!currentDir) return false;
                const dot = currentDir.dot(targetDir);
                if (dot > 0.95) return false; // 已经接近目标，跳过
                const angle = Math.acos(clamp(dot, -1, 1));
                if (angle > maxAngle) {
                    console.warn('[ProceduralAnimator] 跳过' + key + '修正: 角度过大 ' + (angle * 180 / Math.PI).toFixed(0) + '° > ' + (maxAngle * 180 / Math.PI).toFixed(0) + '°');
                    return false;
                }
                const worldDelta = new T.Quaternion().setFromUnitVectors(currentDir, targetDir);
                const localDelta = worldToLocalDelta(bone, worldDelta);
                applyCorrection(key, bone, localDelta);
                return true;
            };

            // 手臂修正：T-pose/A-pose → 自然下垂约34°(0.6rad)从水平，微外张，不要完全垂直下垂
            const leftArm = this.bones.leftArm;
            if (leftArm) {
                // 目标方向：向左下约34°，X=-cos(34°)≈-0.83, Y=-sin(34°)≈-0.56
                const targetDir = new T.Vector3(-0.83, -0.56, 0).normalize();
                if (safeCorrect('leftArm', leftArm, this.bones.leftForearm, targetDir, 2.8)) {
                    console.log('[ProceduralAnimator] 左臂已修正');
                }
            }
            const rightArm = this.bones.rightArm;
            if (rightArm) {
                const targetDir = new T.Vector3(0.83, -0.56, 0).normalize();
                if (safeCorrect('rightArm', rightArm, this.bones.rightForearm, targetDir, 2.8)) {
                    console.log('[ProceduralAnimator] 右臂已修正');
                }
            }

            // 肘部微弯（自然姿态）
            if (this.bones.leftForearm) this.restRot.leftForearm.x += 0.12;
            if (this.bones.rightForearm) this.restRot.rightForearm.x += 0.12;

            // 腿部修正：自然站立微内收，最大修正 60°（腿通常已经向下，不需要大修正）
            for (const side of ['left', 'right']) {
                const legBone = this.bones[side + 'Leg'];
                if (!legBone) continue;
                const inwardX = side === 'left' ? 0.05 : -0.05;
                const targetDir = new T.Vector3(inwardX, -1, 0).normalize();
                safeCorrect(side + 'Leg', legBone, this.bones[side + 'LowerLeg'], targetDir, 1.05);
            }

            // 膝盖微弯
            if (this.bones.leftLowerLeg) this.restRot.leftLowerLeg.x += 0.04;
            if (this.bones.rightLowerLeg) this.restRot.rightLowerLeg.x += 0.04;

            this.poseCorrected = true;
        }

        // ===== 辅助：相对于休息姿态设置骨骼 =====
        setBone(key, rx, ry, rz) {
            const bone = this.bones[key];
            const rest = this.restRot[key];
            if (!bone || !rest) return;
            if (rx !== undefined && rx !== null) bone.rotation.x = rest.x + rx;
            if (ry !== undefined && ry !== null) bone.rotation.y = rest.y + ry;
            if (rz !== undefined && rz !== null) bone.rotation.z = rest.z + rz;
        }

        setBonePos(key, px, py, pz) {
            const bone = this.bones[key];
            const rest = this.restPos[key];
            if (!bone || !rest) return;
            if (px !== undefined && px !== null) bone.position.x = rest.x + px;
            if (py !== undefined && py !== null) bone.position.y = rest.y + py;
            if (pz !== undefined && pz !== null) bone.position.z = rest.z + pz;
        }

        // ===== 眨眼系统 =====
        updateBlink(dt) {
            this.blinkTimer += dt;
            if (this.blinkPhase === 'open') {
                if (this.blinkTimer > this.nextBlink) {
                    this.blinkPhase = 'closing';
                    this.blinkTimer = 0;
                }
            } else if (this.blinkPhase === 'closing') {
                this.blinkValue = smoothstep(0, 0.08, this.blinkTimer);
                if (this.blinkTimer > 0.08) {
                    this.blinkPhase = 'closed';
                    this.blinkTimer = 0;
                }
            } else if (this.blinkPhase === 'closed') {
                if (this.blinkTimer > 0.06) {
                    this.blinkPhase = 'opening';
                    this.blinkTimer = 0;
                }
            } else if (this.blinkPhase === 'opening') {
                this.blinkValue = 1 - smoothstep(0, 0.15, this.blinkTimer);
                if (this.blinkTimer > 0.15) {
                    this.blinkPhase = 'open';
                    this.blinkTimer = 0;
                    this.nextBlink = 2.5 + Math.random() * 5.5;
                    this.blinkValue = 0;
                }
            }

            // 应用眨眼
            const bv = this.blinkValue;
            // 形态键优先
            if (this.morphs.blink.length > 0) {
                for (const m of this.morphs.blink) {
                    m.mesh.morphTargetInfluences[m.idx] = bv;
                }
            } else {
                // 眼睑骨骼回退：旋转眼睑骨骼
                if (this.bones.leftEye) {
                    this.setBone('leftEye', bv * 0.5, 0, 0);
                }
                if (this.bones.rightEye) {
                    this.setBone('rightEye', bv * 0.5, 0, 0);
                }
            }
        }

        // ===== 呼吸系统 =====
        updateBreathing(dt, t) {
            // 多层正弦叠加，模拟自然呼吸
            const breath = Math.sin(t * 1.8 + this.breathPhase) * 0.015
                         + Math.sin(t * 0.9 + this.breathPhase * 0.5) * 0.008
                         + Math.sin(t * 3.6 + this.breathPhase * 1.3) * 0.003;

            // 胸腔：呼吸时前后微动
            if (this.bones.chest) {
                this.setBone('chest', breath * 1.2, 0, 0);
            }
            // 上胸：呼吸幅度更大
            if (this.bones.upperChest) {
                this.setBone('upperChest', breath * 0.8, 0, 0);
            }
            // 脊柱：呼吸联动
            if (this.bones.spine) {
                this.setBone('spine', breath * 0.5, 0, 0);
            }
            // 肩膀：呼吸时微微上下
            if (this.bones.leftShoulder) {
                this.setBone('leftShoulder', breath * 0.3, 0, 0);
            }
            if (this.bones.rightShoulder) {
                this.setBone('rightShoulder', breath * 0.3, 0, 0);
            }
            return breath;
        }

        // ===== 闲置微摆 =====
        updateIdleSway(dt, t) {
            // 身体整体微摆（低频）
            const swayX = Math.sin(t * 0.5 + this.idlePhase) * 0.02;
            const swayZ = Math.sin(t * 0.35 + this.idlePhase * 0.7) * 0.015;
            const twist = Math.sin(t * 0.4 + this.idlePhase * 1.2) * 0.012;

            // 胯部/根骨骼：不修改旋转和位置
            // MMD 模型 hips=センター(根骨骼，位于腰部高度)，旋转它会导致整模型绕脚底原点大幅偏移
            // VRM/glTF 模型 hips=骨盆(非根骨骼)，但重心转移效果可通过脊柱旋转实现，无需动 hips
            const weightShift = Math.sin(t * 0.45 + this.weightShiftPhase) * 0.03;

            // 脊柱 S 形弯曲（增强：补偿 hips 不旋转后的重心转移效果）
            const spineBones = [this.bones.spine, this.bones.chest, this.bones.upperChest].filter(Boolean);
            spineBones.forEach((bone, i) => {
                const k = spineBones.length === 1 ? 1 : (i + 1) / spineBones.length;
                const key = bone === this.bones.spine ? 'spine' : bone === this.bones.chest ? 'chest' : 'upperChest';
                // 重心转移：脊柱下部随 weightShift 侧倾，上部反向微调保持头部稳定
                const shiftComp = (1 - k * 0.5) * weightShift;
                this.setBone(key, swayX * k * 0.5 + shiftComp * 0.3, twist * k, swayZ * k + shiftComp);
            });

            // 脖子：头部和脊柱之间的缓冲
            if (this.bones.neck) {
                this.setBone('neck', Math.sin(t * 0.7) * 0.015, Math.sin(t * 0.5) * 0.02, Math.sin(t * 0.6) * 0.01);
            }

            return { swayX, swayZ, twist, weightShift };
        }

        // ===== 手臂闲置 =====
        updateArms(dt, t, breath, sway) {
            // 手臂自然下垂 + 微摆 + 呼吸联动
            const armSwingL = Math.sin(t * 0.8 + this.idlePhase) * 0.03;
            const armSwingR = Math.sin(t * 0.8 + this.idlePhase + 0.5) * 0.03;
            const armSwayL = Math.sin(t * 0.6 + this.idlePhase * 0.8) * 0.02;
            const armSwayR = Math.sin(t * 0.6 + this.idlePhase * 0.8 + 1) * 0.015;

            if (this.bones.leftArm) {
                this.setBone('leftArm',
                    armSwingL + breath * 0.3,
                    armSwayL,
                    0
                );
            }
            if (this.bones.rightArm) {
                this.setBone('rightArm',
                    armSwingR + breath * 0.3,
                    armSwayR,
                    0
                );
            }
            // 肘部：呼吸时微弯变化
            if (this.bones.leftForearm) {
                this.setBone('leftForearm', Math.sin(t * 0.7) * 0.015, 0, 0);
            }
            if (this.bones.rightForearm) {
                this.setBone('rightForearm', Math.sin(t * 0.7 + 0.5) * 0.015, 0, 0);
            }
        }

        // ===== 腿部闲置 =====
        updateLegs(dt, t, weightShift, dockAmount) {
            const dock = dockAmount || 0;
            // 重心转移时腿部微弯
            if (this.bones.leftLeg) {
                this.setBone('leftLeg',
                    Math.max(0, weightShift) * 0.05 + dock * 0.35,
                    0,
                    weightShift * 0.02 + dock * 0.06
                );
            }
            if (this.bones.rightLeg) {
                this.setBone('rightLeg',
                    Math.max(0, -weightShift) * 0.05 + dock * 0.35,
                    0,
                    -weightShift * 0.02 + dock * 0.06
                );
            }
            // 膝盖
            if (this.bones.leftLowerLeg) {
                this.setBone('leftLowerLeg', dock * 0.5, 0, 0);
            }
            if (this.bones.rightLowerLeg) {
                this.setBone('rightLowerLeg', dock * 0.5, 0, 0);
            }
        }

        // ===== 视线跟随 =====
        updateLookAt(dt, t) {
            if (!this.lookTarget.active) {
                // 自主视线：缓慢环视
                const autoX = Math.sin(t * 0.25 + this.idlePhase) * 0.15;
                const autoY = Math.sin(t * 0.18 + this.idlePhase * 0.6) * 0.08;
                this.lookCurrent.x += (autoX - this.lookCurrent.x) * 0.03;
                this.lookCurrent.y += (autoY - this.lookCurrent.y) * 0.03;
            } else {
                this.lookCurrent.x += (this.lookTarget.x - this.lookCurrent.x) * 0.08;
                this.lookCurrent.y += (this.lookTarget.y - this.lookCurrent.y) * 0.08;
            }

            if (this.bones.head) {
                this.setBone('head',
                    this.lookCurrent.y,
                    this.lookCurrent.x,
                    Math.sin(t * 0.35) * 0.008
                );
            }
        }

        // ===== 状态姿态 =====
        updateStatePose(dt, t) {
            const s = this.state;
            // 各状态的额外偏移
            let headTilt = 0, bodyLean = 0, armExtraL = 0, armExtraR = 0, chestExtra = 0;

            switch (s) {
                case 'thinking':
                    headTilt = 0.08;
                    bodyLean = 0.05;
                    armExtraL = 0.1; // 手托下巴趋势
                    break;
                case 'happy':
                    headTilt = -0.03;
                    chestExtra = 0.02; // 挺胸
                    break;
                case 'working':
                case 'scanning':
                    bodyLean = 0.08; // 前倾
                    break;
                case 'sleeping':
                    bodyLean = -0.12; // 后靠
                    headTilt = 0.1;
                    break;
                case 'talking':
                    // 说话时头部微动
                    headTilt = Math.sin(t * 5) * 0.02;
                    break;
                case 'error':
                    headTilt = Math.sin(t * 3) * 0.05; // 摇头
                    break;
            }

            // 应用状态偏移（叠加在基础动作上）
            if (this.bones.head && headTilt) {
                const rest = this.restRot.head;
                if (rest) this.bones.head.rotation.z += headTilt;
            }
            if (this.bones.spine && bodyLean) {
                const rest = this.restRot.spine;
                if (rest) this.bones.spine.rotation.x += bodyLean;
            }
            if (this.bones.chest && chestExtra) {
                const rest = this.restRot.chest;
                if (rest) this.bones.chest.rotation.x += chestExtra;
            }

            // 说话时下颌运动
            if (s === 'talking' || this.talking) {
                this.talkPhase += dt * 8;
                const jawOpen = (Math.sin(this.talkPhase) * 0.5 + 0.5) * 0.15;
                if (this.bones.jaw) {
                    this.setBone('jaw', jawOpen, 0, 0);
                }
                // 形态键：嘴张开
                if (this.morphs.mouthOpen.length > 0) {
                    for (const m of this.morphs.mouthOpen) {
                        m.mesh.morphTargetInfluences[m.idx] = jawOpen * 3;
                    }
                }
            }
        }

        // ===== 主更新循环 =====
        update() {
            if (!this.detected) return;
            const now = performance.now();
            this.dt = Math.min((now - this._lastTime) / 1000, 0.05);
            this._lastTime = now;
            this.time += this.dt;
            const t = this.time;
            const dt = this.dt;

            // 1. 眨眼
            this.updateBlink(dt);

            // morphsOnly 模式：仅处理形态键(眨眼/嘴部)，不操作骨骼，避免与外部骨骼动画冲突
            if (this.mode === 'morphsOnly') {
                // 仅处理说话时下颌/嘴部形态键
                if (this.state === 'talking' || this.talking) {
                    this.talkPhase += dt * 8;
                    const jawOpen = (Math.sin(this.talkPhase) * 0.5 + 0.5) * 0.15;
                    if (this.morphs.mouthOpen.length > 0) {
                        for (const m of this.morphs.mouthOpen) {
                            m.mesh.morphTargetInfluences[m.idx] = jawOpen * 3;
                        }
                    }
                }
                return;
            }

            // 2. 呼吸
            const breath = this.updateBreathing(dt, t);

            // 3. 闲置微摆
            const sway = this.updateIdleSway(dt, t);

            // 4. 手臂
            this.updateArms(dt, t, breath, sway);

            // 5. 腿部
            this.updateLegs(dt, t, sway.weightShift, this.dockAmount);

            // 6. 视线
            this.updateLookAt(dt, t);

            // 7. 状态姿态（最后叠加）
            this.updateStatePose(dt, t);

            // VRM 官方更新（如果有）
            if (this.options.vrm && typeof this.options.vrm.update === 'function') {
                try { this.options.vrm.update(dt); } catch (e) {}
            }
        }

        // ===== 公共 API =====
        setState(state) { this.state = state; }
        setLookTarget(x, y, active) {
            this.lookTarget.x = x !== undefined ? x : this.lookTarget.x;
            this.lookTarget.y = y !== undefined ? y : this.lookTarget.y;
            this.lookTarget.active = active !== undefined ? active : true;
        }
        setDock(amount) { this.dockAmount = clamp(amount, 0, 1); }
        setFly(amount) { this.flyAmount = clamp(amount, 0, 1); }
        setTalking(talking) { this.talking = talking; if (talking) this.talkPhase = 0; }
        triggerBlink() {
            if (this.blinkPhase === 'open') {
                this.blinkPhase = 'closing';
                this.blinkTimer = 0;
            }
        }
        getBone(key) { return this.bones[key] || null; }
        hasBone(key) { return !!this.bones[key]; }
        getDetectionReport() {
            const report = {};
            for (const key of Object.keys(BONE_PATTERNS)) {
                report[key] = this.bones[key] ? this.bones[key].name : null;
            }
            report.morphs = {
                blink: this.morphs.blink.length,
                smile: this.morphs.smile.length,
                mouthOpen: this.morphs.mouthOpen.length
            };
            report.totalBones = this.allBones.length;
            return report;
        }
    }

    // 导出
    global.ProceduralAnimator = ProceduralAnimator;
    if (typeof module !== 'undefined' && module.exports) module.exports = ProceduralAnimator;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.ProceduralAnimator;
}

if (typeof globalThis !== 'undefined') {
  globalThis.AEVUM = globalThis.AEVUM || {};
  globalThis.AEVUM.action = globalThis.AEVUM.action || {};
  globalThis.AEVUM.action.Procedural = globalThis.ProceduralAnimator;
}
