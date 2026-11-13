/* ============================================================
 * orb_skins.js — 灵体皮肤系统
 * 不内置角色，由用户自己定制或导入：
 *   - blob：默认光球
 *   - custom：用户在定制器中创建的 SVG 角色（形状/颜色/眼睛）
 *   - svg：用户上传的 SVG 文件
 *   - live2d：用户导入的 Live2D 模型
 * 每个身份档案（主用户/子用户）独立保存皮肤选择。
 * ============================================================ */
/* 三方库开关检查工具函数 */
function _isThirdPartyAllowed() {
    try {
        var val = localStorage.getItem('mrhua_allow_third_party');
        return val === null || val === 'true';
    } catch(e) {
        return true;
    }
}

(function() {
    'use strict';

    // ============ 角色生成器：根据参数生成 SVG ============
    const SHAPES = {
        circle: { label: '圆形', body: (c) => `<circle cx="50" cy="50" r="40" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/>` },
        blob:   { label: '流体', body: (c) => `<path d="M50,10 C74,10 88,28 88,52 C88,70 76,82 68,86 C60,90 40,90 32,86 C24,82 12,70 12,52 C12,28 26,10 50,10 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/>` },
        ghost:  { label: '幽灵', body: (c) => `<path d="M50,8 C72,8 84,26 84,48 L84,92 Q76,84 68,92 Q60,84 52,92 Q44,84 36,92 Q28,84 20,92 Q16,86 16,92 L16,48 C16,26 28,8 50,8 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/>` },
        slime:  { label: '果冻', body: (c) => `<path d="M14,58 Q14,18 50,18 Q86,18 86,58 L86,76 Q78,68 70,76 Q62,68 54,76 Q46,68 38,76 Q30,68 22,76 Q14,68 14,76 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1"><animate attributeName="d" dur="2.5s" repeatCount="indefinite" values="M14,58 Q14,18 50,18 Q86,18 86,58 L86,76 Q78,68 70,76 Q62,68 54,76 Q46,68 38,76 Q30,68 22,76 Q14,68 14,76 Z;M14,58 Q14,22 50,22 Q86,22 86,58 L86,76 Q78,70 70,76 Q62,68 54,76 Q46,70 38,76 Q30,68 22,76 Q14,70 14,76 Z;M14,58 Q14,18 50,18 Q86,18 86,58 L86,76 Q78,68 70,76 Q62,68 54,76 Q46,68 38,76 Q30,68 22,76 Q14,68 14,76 Z"/></path>` },
        star:   { label: '星形', body: (c) => `<path d="M50,8 L61,38 L93,38 L67,57 L76,88 L50,69 L24,88 L33,57 L7,38 L39,38 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8" stroke-linejoin="round"/>` },
        heart:  { label: '心形', body: (c) => `<path d="M50,88 C20,66 8,48 8,32 C8,18 20,8 32,8 C40,8 47,13 50,20 C53,13 60,8 68,8 C80,8 92,18 92,32 C92,48 80,66 50,88 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/>` },
        cat:    { label: '猫咪', body: (c) => `<path d="M50,12 C72,12 84,30 84,52 C84,72 70,86 50,86 C30,86 16,72 16,52 C16,30 28,12 50,12 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><path d="M22,20 L18,6 L34,18 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><path d="M78,20 L82,6 L66,18 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/>` },
        fox:    { label: '狐狸', body: (c) => `<path d="M50,14 C70,14 82,30 82,50 C82,68 68,82 50,82 C32,82 18,68 18,50 C18,30 30,14 50,14 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><path d="M24,22 L16,8 L36,20 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><path d="M76,22 L84,8 L64,20 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><ellipse cx="50" cy="62" rx="10" ry="7" fill="#fff" opacity="0.5"/>` },
        robot:  { label: '机器人', body: (c) => `<rect x="18" y="18" width="64" height="56" rx="8" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><rect x="42" y="8" width="16" height="12" rx="2" fill="${c.stroke}"/><circle cx="50" cy="6" r="4" fill="#ff6b6b"/><line x1="10" y1="40" x2="18" y2="40" stroke="${c.stroke}" stroke-width="3"/><line x1="82" y1="40" x2="90" y2="40" stroke="${c.stroke}" stroke-width="3"/>` },
        angel:  { label: '天使', body: (c) => `<path d="M50,14 C68,14 80,28 80,48 C80,66 66,80 50,80 C34,80 20,66 20,48 C20,28 32,14 50,14 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><path d="M18,38 C4,30 2,50 12,56 C6,50 8,42 18,42 Z" fill="#fff" opacity="0.7" stroke="${c.stroke}" stroke-width="0.5"/><path d="M82,38 C96,30 98,50 88,56 C94,50 92,42 82,42 Z" fill="#fff" opacity="0.7" stroke="${c.stroke}" stroke-width="0.5"/><circle cx="50" cy="10" r="6" fill="#ffd700" opacity="0.8"/>` },
        cloud:  { label: '云朵', body: (c) => `<path d="M28,70 C14,70 8,58 14,48 C14,36 28,32 36,38 C38,26 54,22 62,30 C74,26 88,36 86,50 C94,54 92,70 80,70 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8" opacity="0.9"/>` },
        moon:   { label: '月亮', body: (c) => `<path d="M60,10 C38,10 20,28 20,50 C20,72 38,90 60,90 C48,82 42,68 42,50 C42,32 48,18 60,10 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><circle cx="70" cy="30" r="3" fill="#fff" opacity="0.6"/><circle cx="75" cy="55" r="2" fill="#fff" opacity="0.5"/><circle cx="68" cy="72" r="2.5" fill="#fff" opacity="0.4"/>` },
        rabbit: { label: '兔子', body: (c) => `<ellipse cx="50" cy="58" rx="28" ry="26" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><ellipse cx="38" cy="22" rx="7" ry="18" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8" transform="rotate(-10 38 22)"/><ellipse cx="62" cy="22" rx="7" ry="18" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8" transform="rotate(10 62 22)"/><ellipse cx="38" cy="24" rx="3" ry="12" fill="#ffb6c1" opacity="0.5" transform="rotate(-10 38 24)"/><ellipse cx="62" cy="24" rx="3" ry="12" fill="#ffb6c1" opacity="0.5" transform="rotate(10 62 24)"/>` },
        bear:   { label: '小熊', body: (c) => `<circle cx="50" cy="55" r="30" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><circle cx="28" cy="32" r="10" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><circle cx="72" cy="32" r="10" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><circle cx="28" cy="32" r="5" fill="#d4a574" opacity="0.5"/><circle cx="72" cy="32" r="5" fill="#d4a574" opacity="0.5"/><ellipse cx="50" cy="68" rx="12" ry="8" fill="#d4a574" opacity="0.4"/>` },
        panda:  { label: '熊猫', body: (c) => `<circle cx="50" cy="55" r="30" fill="#fff" stroke="${c.stroke}" stroke-width="0.8"/><circle cx="28" cy="32" r="10" fill="#2d3436"/><circle cx="72" cy="32" r="10" fill="#2d3436"/><ellipse cx="38" cy="50" rx="8" ry="10" fill="#2d3436" transform="rotate(-15 38 50)"/><ellipse cx="62" cy="50" rx="8" ry="10" fill="#2d3436" transform="rotate(15 62 50)"/><ellipse cx="50" cy="62" rx="5" ry="4" fill="#2d3436"/>` },
        penguin:{ label: '企鹅', body: (c) => `<ellipse cx="50" cy="55" rx="26" ry="32" fill="#2d3436" stroke="${c.stroke}" stroke-width="0.8"/><ellipse cx="50" cy="60" rx="18" ry="24" fill="#fff"/><ellipse cx="38" cy="38" rx="10" ry="12" fill="#fff"/><ellipse cx="62" cy="38" rx="10" ry="12" fill="#fff"/><path d="M45,52 L55,52 L50,58 Z" fill="#ffa502"/>` },
        fish:   { label: '小鱼', body: (c) => `<ellipse cx="45" cy="50" rx="28" ry="18" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><path d="M70,50 L88,35 L88,65 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><path d="M35,42 Q40,35 45,42" stroke="${c.stroke}" stroke-width="1" fill="none"/><path d="M35,58 Q40,65 45,58" stroke="${c.stroke}" stroke-width="1" fill="none"/>` },
        bird:   { label: '小鸟', body: (c) => `<ellipse cx="50" cy="55" rx="24" ry="22" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><path d="M28,45 Q15,40 18,55 Q20,65 32,58 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><path d="M72,45 Q85,40 82,55 Q80,65 68,58 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><path d="M70,50 L82,48 L70,54 Z" fill="#ffa502"/><path d="M42,72 L46,82 L50,72 Z" fill="#ffa502"/><path d="M54,72 L58,82 L62,72 Z" fill="#ffa502"/>` },
        frog:   { label: '青蛙', body: (c) => `<ellipse cx="50" cy="60" rx="30" ry="24" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><circle cx="35" cy="35" r="12" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><circle cx="65" cy="35" r="12" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><ellipse cx="42" cy="68" rx="8" ry="4" fill="#fff" opacity="0.3"/><ellipse cx="58" cy="68" rx="8" ry="4" fill="#fff" opacity="0.3"/>` },
        boy:    { label: '男孩', body: (c) => `<circle cx="50" cy="35" r="20" fill="#ffdbac" stroke="${c.stroke}" stroke-width="0.8"/><path d="M30,30 Q30,15 50,15 Q70,15 70,30 L70,25 Q60,20 50,22 Q40,20 30,25 Z" fill="#2d3436"/><path d="M30,55 L70,55 L75,85 L25,85 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/>` },
        girl:   { label: '女孩', body: (c) => `<circle cx="50" cy="35" r="20" fill="#ffdbac" stroke="${c.stroke}" stroke-width="0.8"/><path d="M28,32 Q25,12 50,12 Q75,12 72,32 L75,55 Q65,48 50,50 Q35,48 25,55 Z" fill="#8b4513"/><path d="M30,55 L70,55 L80,88 L20,88 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/>` },
        wizard: { label: '巫师', body: (c) => `<circle cx="50" cy="45" r="18" fill="#ffdbac" stroke="${c.stroke}" stroke-width="0.8"/><path d="M30,42 L50,5 L70,42 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><ellipse cx="50" cy="42" rx="22" ry="5" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><path d="M32,60 L68,60 L75,88 L25,88 Z" fill="#4a4a6a" stroke="${c.stroke}" stroke-width="0.8"/><circle cx="68" cy="12" r="4" fill="#ffd700"/>` },
        dragon: { label: '小龙', body: (c) => `<ellipse cx="48" cy="55" rx="26" ry="20" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><path d="M70,45 Q85,35 82,50 Q80,60 68,55 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><path d="M25,40 L20,25 L30,35 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><path d="M35,38 L32,22 L42,33 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><path d="M45,36 L44,20 L54,31 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><path d="M72,60 Q85,65 80,75" stroke="#ff6b6b" stroke-width="3" fill="none" stroke-linecap="round"/>` },
        phoenix:{ label: '凤凰', body: (c) => `<ellipse cx="50" cy="55" rx="20" ry="22" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><path d="M30,50 Q10,35 15,55 Q18,70 35,60 Z" fill="#ff6b6b" opacity="0.8"/><path d="M70,50 Q90,35 85,55 Q82,70 65,60 Z" fill="#ffa502" opacity="0.8"/><path d="M45,75 Q40,90 50,88 Q60,90 55,75" fill="#ff6b6b" opacity="0.7"/><path d="M40,78 Q30,95 42,92" fill="#ffa502" opacity="0.6"/><path d="M60,78 Q70,95 58,92" fill="#ffd700" opacity="0.6"/><path d="M45,25 Q50,10 55,25" fill="#ffd700"/>` },
        unicorn:{ label: '独角兽', body: (c) => `<ellipse cx="50" cy="60" rx="28" ry="22" fill="#fff" stroke="${c.stroke}" stroke-width="0.8"/><path d="M48,35 L46,15 L54,15 L52,35 Z" fill="#ffd700" stroke="${c.stroke}" stroke-width="0.6"/><path d="M30,40 Q20,30 25,50 Q28,58 35,50" fill="#ffb6c1" opacity="0.6"/><path d="M70,40 Q80,30 75,50 Q72,58 65,50" fill="#ffb6c1" opacity="0.6"/><ellipse cx="42" cy="55" rx="3" ry="5" fill="#ffb6c1" opacity="0.4"/><ellipse cx="58" cy="55" rx="3" ry="5" fill="#ffb6c1" opacity="0.4"/>` },
        fairy:  { label: '精灵', body: (c) => `<circle cx="50" cy="40" r="15" fill="#ffdbac" stroke="${c.stroke}" stroke-width="0.8"/><path d="M35,55 L65,55 L70,80 L30,80 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/><ellipse cx="25" cy="50" rx="15" ry="20" fill="#87ceeb" opacity="0.4" stroke="${c.stroke}" stroke-width="0.5"/><ellipse cx="75" cy="50" rx="15" ry="20" fill="#87ceeb" opacity="0.4" stroke="${c.stroke}" stroke-width="0.5"/><path d="M42,28 Q40,18 50,20 Q60,18 58,28" fill="#ffd700"/><circle cx="20" cy="30" r="2" fill="#ffd700" opacity="0.8"/><circle cx="80" cy="35" r="1.5" fill="#ffd700" opacity="0.7"/><circle cx="15" cy="60" r="1.5" fill="#87ceeb" opacity="0.6"/>` },
    };

    const EYE_STYLES = {
        round:  { label: '圆眼', draw: (state, cx, cy) => {
            const ry = state === 'sleeping' ? 0.8 : state === 'thinking' ? 2.5 : 4;
            return `<ellipse cx="${cx}" cy="${cy}" rx="4" ry="${ry}" fill="#2d3436">${state !== 'sleeping' ? `<animate attributeName="ry" values="4;4;0.5;4;4" dur="${cx < 50 ? 4 : 4.3}s" repeatCount="indefinite"/>` : ''}</ellipse>${state !== 'sleeping' ? `<circle cx="${cx+1.5}" cy="${cy-1.5}" r="1.3" fill="#fff"/>` : ''}`;
        }},
        dot:    { label: '点眼', draw: (state, cx, cy) => state === 'sleeping' ? `<line x1="${cx-4}" y1="${cy}" x2="${cx+4}" y2="${cy}" stroke="#2d3436" stroke-width="2" stroke-linecap="round"/>` : `<circle cx="${cx}" cy="${cy}" r="3.5" fill="#2d3436"/><circle cx="${cx+1}" cy="${cy-1}" r="1.2" fill="#fff"/>` },
        anime:  { label: '动漫眼', draw: (state, cx, cy) => {
            if (state === 'sleeping') return `<path d="M${cx-5},${cy} Q${cx},${cy+3} ${cx+5},${cy}" stroke="#2d3436" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
            const h = state === 'thinking' ? 5 : 7;
            return `<ellipse cx="${cx}" cy="${cy}" rx="4.5" ry="${h}" fill="#fff" stroke="#2d3436" stroke-width="1"/><ellipse cx="${cx}" cy="${cy+1}" rx="3" ry="${h-1.5}" fill="#2d3436"/><circle cx="${cx+1}" cy="${cy-1}" r="1.5" fill="#fff"/><circle cx="${cx-1}" cy="${cy+2}" r="0.8" fill="#fff" opacity="0.6"/>`;
        }},
        closed: { label: '眯眯眼', draw: (state, cx, cy) => `<path d="M${cx-5},${cy} Q${cx},${cy+3} ${cx+5},${cy}" stroke="#2d3436" stroke-width="1.8" fill="none" stroke-linecap="round"/>` },
        star:   { label: '星星眼', draw: (state, cx, cy) => state === 'sleeping' ? `<line x1="${cx-4}" y1="${cy}" x2="${cx+4}" y2="${cy}" stroke="#2d3436" stroke-width="2" stroke-linecap="round"/>` : `<path d="M${cx},${cy-4} L${cx+1.2},${cy-1.2} L${cx+4},${cy} L${cx+1.2},${cy+1.2} L${cx},${cy+4} L${cx-1.2},${cy+1.2} L${cx-4},${cy} L${cx-1.2},${cy-1.2} Z" fill="#2d3436"/>` },
    };

    // 状态 → 颜色变体
    function stateColors(baseColor, state) {
        const tints = {
            error:      { hue: 0, sat: 70, light: 65 },
            alert:      { hue: 30, sat: 80, light: 60 },
            thinking:   { hue: 210, sat: 70, light: 60 },
            working:    { hue: 45, sat: 85, light: 58 },
            scanning:   { hue: 45, sat: 85, light: 58 },
            success:    { hue: 145, sat: 60, light: 45 },
            complete:   { hue: 145, sat: 60, light: 45 },
            sleeping:   { hue: 250, sat: 40, light: 70 },
        };
        if (!state || !tints[state]) return { fill: baseColor, glow: baseColor + '59' };
        // 简单混合：如果状态色和基色不同，用状态色
        const t = tints[state];
        const stateColor = `hsl(${t.hue}, ${t.sat}%, ${t.light}%)`;
        return { fill: stateColor, glow: `hsla(${t.hue}, ${t.sat}%, ${t.light}%, 0.35)` };
    }

    function generateCharacterSVG(params, state) {
        const shape = SHAPES[params.shape] || SHAPES.blob;
        const eyeStyle = EYE_STYLES[params.eyes] || EYE_STYLES.round;
        const colors = stateColors(params.color || '#6a4c93', state);
        const fill = `url(#char-grad-${params._uid || 0})`;
        const stroke = colors.fill;

        // 嘴巴表情系统
        let mouth;
        if (state === 'happy' || state === 'success' || state === 'complete') {
            mouth = `<path d="M40,60 Q50,74 60,60" stroke="#2d3436" stroke-width="2" fill="none" stroke-linecap="round"/>`;
        } else if (state === 'error' || state === 'alert') {
            mouth = `<path d="M42,68 Q50,58 58,68" stroke="#2d3436" stroke-width="2" fill="none" stroke-linecap="round"/>`;
        } else if (state === 'thinking') {
            mouth = `<path d="M44,64 L56,64" stroke="#2d3436" stroke-width="2" fill="none" stroke-linecap="round"/>`;
        } else if (state === 'sleeping') {
            mouth = `<ellipse cx="50" cy="66" rx="4" ry="2" fill="#2d3436" opacity="0.5"/>`;
        } else if (state === 'working' || state === 'scanning') {
            mouth = `<path d="M44,62 Q50,68 56,62" stroke="#2d3436" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
        } else if (state === 'surprised') {
            mouth = `<ellipse cx="50" cy="65" rx="5" ry="7" fill="#2d3436"/>`;
        } else if (state === 'angry') {
            mouth = `<path d="M42,68 L58,68" stroke="#2d3436" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
        } else if (state === 'love') {
            mouth = `<path d="M42,60 Q50,72 58,60 Q54,66 50,66 Q46,66 42,60 Z" fill="#ff6b9d"/>`;
        } else {
            mouth = `<path d="M45,64 Q50,67 55,64" stroke="#2d3436" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
        }

        // 眉毛（根据状态变化）
        let brows = '';
        if (state === 'angry') {
            brows = `<path d="M32,38 L44,42" stroke="#2d3436" stroke-width="2" stroke-linecap="round"/><path d="M68,38 L56,42" stroke="#2d3436" stroke-width="2" stroke-linecap="round"/>`;
        } else if (state === 'thinking') {
            brows = `<path d="M32,40 L44,38" stroke="#2d3436" stroke-width="1.5" stroke-linecap="round"/><path d="M56,40 L68,42" stroke="#2d3436" stroke-width="1.5" stroke-linecap="round"/>`;
        } else if (state === 'happy' || state === 'success') {
            brows = `<path d="M32,38 Q38,34 44,38" stroke="#2d3436" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M56,38 Q62,34 68,38" stroke="#2d3436" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
        }

        const blush = params.blush !== false ? `<ellipse cx="28" cy="58" rx="6" ry="3.5" fill="rgba(255,150,150,0.35)"/><ellipse cx="72" cy="58" rx="6" ry="3.5" fill="rgba(255,150,150,0.35)"/>` : '';
        const zzz = state === 'sleeping' ? `<text x="72" y="28" font-size="11" fill="#a29bfe" opacity="0.8">z</text><text x="80" y="18" font-size="8" fill="#a29bfe" opacity="0.6">z</text><text x="86" y="10" font-size="6" fill="#a29bfe" opacity="0.4">z</text>` : '';
        const think = state === 'thinking' ? `<circle cx="76" cy="28" r="3.5" fill="none" stroke="#54a0ff" stroke-width="1.5" opacity="0.8"/><circle cx="84" cy="20" r="2.5" fill="none" stroke="#54a0ff" stroke-width="1.2" opacity="0.6"/><circle cx="90" cy="14" r="1.5" fill="none" stroke="#54a0ff" stroke-width="1" opacity="0.4"/>` : '';
        const hearts = state === 'love' ? `<text x="72" y="25" font-size="14" fill="#ff6b9d">♥</text><text x="82" y="15" font-size="10" fill="#ff6b9d" opacity="0.7">♥</text>` : '';
        const exclaim = state === 'alert' || state === 'error' ? `<text x="74" y="26" font-size="18" fill="#ff6b6b" font-weight="bold">!</text>` : '';
        const question = state === 'confused' ? `<text x="74" y="26" font-size="16" fill="#feca57" font-weight="bold">?</text>` : '';

        const uid = params._uid || 0;
        return `<svg viewBox="0 0 100 100" width="100%" height="100%" style="overflow:visible;">
            <defs><radialGradient id="char-grad-${uid}" cx="35%" cy="28%" r="72%">
                <stop offset="0%" stop-color="rgba(255,255,255,0.85)"/>
                <stop offset="45%" stop-color="${colors.fill}" stop-opacity="0.88"/>
                <stop offset="100%" stop-color="${colors.fill}" stop-opacity="0.65"/>
            </radialGradient></defs>
            <ellipse cx="50" cy="54" rx="42" ry="44" fill="${colors.glow}"/>
            ${shape.body({fill, stroke})}
            ${blush}
            ${brows}
            ${eyeStyle.draw(state, 38, 48)}
            ${eyeStyle.draw(state, 62, 48)}
            ${mouth}
            ${zzz}${think}${hearts}${exclaim}${question}
        </svg>`;
    }

    // ============ 皮肤管理器 ============
    function OrbSkins() {
        this.state = '';
        this.live2dRenderer = null;
        this.characterEl = null;
        this.customSkins = [];
        this.identityKey = 'main';
        this.customChars = {};  // 身份档案 → 定制参数
        this.currentSkin = 'blob';
        this.currentType = 'blob';
        // 新增：UI 状态
        this._searchQuery = '';
        this._sortMode = localStorage.getItem('mrhua_orb_sort') || 'default'; // default/recent/name
        this._collapsedCats = JSON.parse(localStorage.getItem('mrhua_orb_collapsed') || '{}');
        this._favorites = JSON.parse(localStorage.getItem('mrhua_orb_favorites') || '[]');
        this._recent = JSON.parse(localStorage.getItem('mrhua_orb_recent') || '[]');
        this._batchMode = false;
        this._batchSelected = {};
        this._isLoading = false;
    }

    OrbSkins.prototype.getIdentityKey = function() {
        // 优先使用激活的身份档案 ID，没有则用 main
        if (window._activeSubUser) return 'sub_' + window._activeSubUser;
        return 'main';
    };

    OrbSkins.prototype.loadForIdentity = function() {
        const key = this.getIdentityKey();
        this.identityKey = key;
        try {
            this.customChars = JSON.parse(localStorage.getItem('mrhua_orb_chars') || '{}');
        } catch(e) { this.customChars = {}; }
        const saved = localStorage.getItem('mrhua_orb_skin_' + key) || localStorage.getItem('mrhua_orb_skin') || 'blob';
        this.currentSkin = saved;
        if (this.characterEl) this.apply(saved);
    };

    OrbSkins.prototype.saveSkin = function(skinId) {
        try {
            localStorage.setItem('mrhua_orb_skin_' + this.identityKey, skinId);
            localStorage.setItem('mrhua_orb_skin', skinId); // 兼容
        } catch(e) {}
    };

    // 启动时自动恢复上次选择的模型（等待 World3D 就绪后加载，避免静默失败）
    OrbSkins.prototype._autoApplySavedSkin = function() {
        let skinId = this.currentSkin;
        if (!skinId || skinId === 'blob') return; // 默认光球，无需加载
        let skin = this.getSkin(skinId);

        // 智能匹配：如果保存的 ID 找不到（可能是重新上传后目录 ID 变了），尝试按名称匹配
        if (!skin || skin.id !== skinId) {
            console.warn('[OrbSkins] 保存的模型 ID 不存在:', skinId, '尝试智能匹配...');
            // 提取模型名称（去掉 custom_ 前缀和 _数字 后缀）
            const nameMatch = skinId.match(/^custom_(.+)_\d+$/);
            const baseName = nameMatch ? nameMatch[1] : skinId.replace(/^custom_/, '');
            // 尝试找名称相似的 3D 模型（包括 glb/vrm/mmd）
            const allSkins = this.getAllSkins();
            let matched = allSkins.find(s =>
                (s.type === 'glb' || s.type === 'vrm' || s.type === 'mmd') &&
                s.id.includes(baseName)
            );
            // 如果没找到，取最近的一个 3D 模型
            if (!matched) {
                matched = allSkins.find(s => s.type === 'glb' || s.type === 'vrm' || s.type === 'mmd');
            }
            if (matched) {
                console.log('[OrbSkins] 智能匹配到模型:', matched.id, '(原ID:', skinId + ')');
                skinId = matched.id;
                skin = matched;
                // 更新保存的 ID
                this.saveSkin(skinId);
                this.currentSkin = skinId;
            } else {
                console.warn('[OrbSkins] 未找到可匹配的 3D 模型，打开模型选择面板');
                // 提示用户模型不存在，并打开皮肤选择窗口让用户重新选择
                try {
                    if (window.toast) window.toast('保存的模型不存在，请重新选择', 'warning');
                    else console.log('[OrbSkins] 保存的模型不存在，请重新选择');
                } catch(e) {}
                // 延迟打开皮肤选择窗口（等大门动画结束后）
                setTimeout(() => {
                    try {
                        if (window.openWindow) window.openWindow('skins');
                        else if (window.WindowManager && WindowManager.open) WindowManager.open('skins');
                    } catch(e) {}
                }, 2000);
                return;
            }
        }

        const needsWorld3D = skin.type === 'glb' || skin.type === 'vrm';
        const needsMMDEngine = skin.type === 'mmd';
        let attempts = 0;
        const maxAttempts = 120; // 最多等60秒（含等待大门动画）

        const tryApply = () => {
            // 等待大门动画完成，避免模型加载（PMX解析/TGA解码）堵塞UI线程导致大门卡住
            if (!window._gateFinished) {
                attempts++;
                if (attempts < maxAttempts) {
                    setTimeout(tryApply, 500);
                } else {
                    console.warn('[OrbSkins] 自动恢复模型超时：大门动画未完成');
                }
                return;
            }
            if (needsWorld3D && !window.World3D) {
                attempts++;
                if (attempts < maxAttempts) {
                    setTimeout(tryApply, 500);
                } else {
                    console.warn('[OrbSkins] 自动恢复模型超时：World3D 未就绪');
                }
                return;
            }
            // MMD模型需要等待3D引擎模块加载完成（有自研渲染器则跳过）
            if (needsMMDEngine && !this._mmdModule && !window.MrHuaRenderer) {
                attempts++;
                if (attempts < maxAttempts) {
                    setTimeout(tryApply, 500);
                } else {
                    console.warn('[OrbSkins] 自动恢复模型超时：MMD引擎未就绪（自研渲染器=' + !!window.MrHuaRenderer + '）');
                }
                return;
            }
            console.log('[OrbSkins] 自动恢复模型:', skinId, skin.type);
            this.apply(skinId);
        };

        setTimeout(tryApply, 500);
    };

    OrbSkins.prototype.saveCustomChar = function(params) {
        try {
            this.customChars[this.identityKey] = params;
            localStorage.setItem('mrhua_orb_chars', JSON.stringify(this.customChars));
        } catch(e) {}
    };

    OrbSkins.prototype.getCustomChar = function() {
        return this.customChars[this.identityKey] || { shape: 'blob', eyes: 'round', color: '#6a4c93', blush: true };
    };

    OrbSkins.prototype.getAllSkins = function() {
        const skins = [{ id: 'blob', name: '光球', type: 'blob', desc: '默认灵体' }];
        // 当前身份的定制角色 - 直接检查 customChars，不使用 getCustomChar()（它会返回默认值导致无法删除）
        const cc = this.customChars[this.identityKey];
        if (cc && cc.shape) {
            skins.push({ id: 'custom', name: cc.name || '我的角色', type: 'custom', desc: '定制角色', params: cc });
        }
        return skins.concat(this.customSkins);
    };

    OrbSkins.prototype.getSkin = function(skinId) {
        return this.getAllSkins().find(s => s.id === skinId) || this.getAllSkins()[0];
    };

    OrbSkins.prototype.init = function() {
        const orb = document.getElementById('orb');
        if (!orb) return;
        this.characterEl = document.createElement('div');
        this.characterEl.id = 'orb-character';
        this.characterEl.style.cssText = 'position:absolute;inset:0;display:none;pointer-events:none;z-index:2;';
        orb.appendChild(this.characterEl);

        this.scanCustomSkins().then(() => {
            this.loadForIdentity();
            // 预加载MMD/3D引擎模块（程序启动时就开始加载，用户切换时立即可用）
            this._preload3DEngine();
            // 自动恢复上次选择的模型（非默认光球时）
            this._autoApplySavedSkin();
        });

        // 启动时加载背景板（即使没有3D模型也生效，CSS背景方式）
        if (window.World3D && window.World3D.loadStage) {
            this._loadWorld3DStage();
        } else {
            // World3D 可能还没加载，延迟重试
            setTimeout(() => {
                if (window.World3D && window.World3D.loadStage) this._loadWorld3DStage();
            }, 1500);
        }

        // 身份档案切换时立即换肤
        window.addEventListener('orb-identity-changed', () => this.loadForIdentity());

        // 启动 SSE 状态机连接（后端AI实时控制灵体状态）
        this._startStateStream();

        // 键盘快捷键
        var self = this;
        document.addEventListener('keydown', function(e) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            var skins = self.getAllSkins();
            if (e.key >= '1' && e.key <= '9') {
                var idx = parseInt(e.key) - 1;
                if (skins[idx]) { self.apply(skins[idx].id); self.renderSelector(); }
            } else if (e.key === 'b' || e.key === 'B') {
                self.apply('blob'); self.renderSelector();
            } else if (e.key === 'f' || e.key === 'F') {
                var searchInput = document.querySelector('#orb-skin-list input[type="text"]');
                if (searchInput) { searchInput.focus(); e.preventDefault(); }
            }
        });

        // 拖拽上传2D图片
        var skinList = document.getElementById('orb-skin-list');
        if (skinList) {
            skinList.addEventListener('dragover', function(e) {
                e.preventDefault();
                skinList.style.background = '#eef2ff';
            });
            skinList.addEventListener('dragleave', function(e) {
                e.preventDefault();
                skinList.style.background = '';
            });
            skinList.addEventListener('drop', function(e) {
                e.preventDefault();
                skinList.style.background = '';
                var files = e.dataTransfer.files;
                if (files && files.length > 0) {
                    var file = files[0];
                    if (file.type.indexOf('image/') === 0) {
                        self._showCustomPrompt('请输入角色名称：', file.name.replace(/\.[^.]+$/, ''), function(name) {
                            var formData = new FormData();
                            formData.append('file', file);
                            formData.append('name', name);
                            fetch('/api/orb/skins/image_upload', { method: 'POST', body: formData })
                                .then(function(r) { return r.json(); })
                                .then(function(data) {
                                    if (data.success) { self.scanCustomSkins().then(function() { self.apply(data.id); }); }
                                    else { alert('上传失败：' + (data.error || '未知错误')); }
                                })
                                .catch(function(err) { alert('上传失败：' + err.message); });
                        });
                    }
                }
            });
        }
    };

    // 预加载3D引擎模块（自研渲染器已通过 script 标签加载，无需预加载）
    OrbSkins.prototype._preload3DEngine = function() {
        if (this._3DEnginePreloading) return;
        this._3DEnginePreloading = true;
        if (window.MrHuaRenderer) {
            console.log('[OrbSkins] 自研渲染器已就绪，跳过模块预加载');
            return;
        }
        console.log('[OrbSkins] 自研渲染器未加载，跳过3D预加载');
    };

    // 预加载单个3D模型（在后台加载，用户切换时立即可用）
    OrbSkins.prototype._preloadModel = function(skin, mods) {
        if (!skin || !skin.model_url) return;
        if (this._preloadedModels && this._preloadedModels[skin.id]) return;
        // 标记正在预加载中
        this._preloadingModels = this._preloadingModels || {};
        if (this._preloadingModels[skin.id]) return; // 已经在预加载中
        this._preloadingModels[skin.id] = true;

        this._preloadedModels = this._preloadedModels || {};
        const THREE = mods.THREE;

        // 预加载完成后的回调
        const onLoad = (result, type) => {
            console.log('[OrbSkins] 3D模型预加载完成:', skin.name, type);
            this._preloadedModels[skin.id] = Object.assign({ type, skin }, result);
            delete this._preloadingModels[skin.id];
            // 触发等待回调
            if (this._preloadWaiters && this._preloadWaiters[skin.id]) {
                this._preloadWaiters[skin.id].forEach(cb => cb(this._preloadedModels[skin.id]));
                delete this._preloadWaiters[skin.id];
            }
        };

        const onError = (err) => {
            console.warn('[OrbSkins] 3D模型预加载失败:', skin.name, err);
            delete this._preloadingModels[skin.id];
            // 触发等待回调（传null表示失败）
            if (this._preloadWaiters && this._preloadWaiters[skin.id]) {
                this._preloadWaiters[skin.id].forEach(cb => cb(null));
                delete this._preloadWaiters[skin.id];
            }
        };

        // 根据模型类型选择加载器
        if (skin.type === 'mmd' || skin.model_url.match(/\.(pmx|pmd)$/i)) {
            // MMD模型预加载
            const loader = new mods.MMDLoader();
            loader.load(skin.model_url, (mesh) => onLoad({ mesh }, 'mmd'), undefined, onError);
        } else if (skin.type === 'vrm' || skin.model_url.match(/\.vrm$/i)) {
            // VRM模型预加载
            const loader = new mods.GLTFLoader();
            loader.register((parser) => new mods.VRMLoaderPlugin(parser));
            loader.load(skin.model_url, (gltf) => onLoad({ gltf }, 'vrm'), undefined, onError);
        } else {
            // GLB/GLTF模型预加载
            const loader = new mods.GLTFLoader();
            loader.load(skin.model_url, (gltf) => onLoad({ gltf }, 'glb'), undefined, onError);
        }
    };

    // 等待模型预加载完成
    OrbSkins.prototype._waitForPreload = function(skinId, callback) {
        if (this._preloadedModels && this._preloadedModels[skinId]) {
            callback(this._preloadedModels[skinId]);
            return;
        }
        if (!this._preloadingModels || !this._preloadingModels[skinId]) {
            callback(null); // 没有在预加载
            return;
        }
        this._preloadWaiters = this._preloadWaiters || {};
        this._preloadWaiters[skinId] = this._preloadWaiters[skinId] || [];
        this._preloadWaiters[skinId].push(callback);
    };

    // 获取预加载的模型（如果有的话）
    OrbSkins.prototype._getPreloadedModel = function(skinId) {
        if (this._preloadedModels && this._preloadedModels[skinId]) {
            const preloaded = this._preloadedModels[skinId];
            console.log('[OrbSkins] 使用预加载模型:', preloaded.skin.name);
            return preloaded;
        }
        return null;
    };

    OrbSkins.prototype._startStateStream = function() {
        if (this._stateEventSource) return;
        try {
            const es = new EventSource('/api/orb/state/stream');
            this._stateEventSource = es;
            es.onmessage = (e) => {
                try {
                    const state = JSON.parse(e.data);
                    this._applyStateFromBackend(state);
                } catch(err) {
                    console.warn('[OrbSkins] 状态解析失败:', err);
                }
            };
            es.onerror = () => {
                console.warn('[OrbSkins] SSE连接断开，5秒后重连...');
                this._stateEventSource = null;
                setTimeout(() => this._startStateStream(), 5000);
            };
            console.log('[OrbSkins] 状态机SSE连接已建立');
        } catch(err) {
            console.warn('[OrbSkins] SSE不支持，改用轮询:', err);
            this._startStatePolling();
        }
    };

    OrbSkins.prototype._startStatePolling = function() {
        if (this._statePollTimer) return;
        this._statePollTimer = setInterval(() => {
            fetch('/api/orb/state').then(r => r.json()).then(state => {
                this._applyStateFromBackend(state);
            }).catch(() => {});
        }, 500);
    };

    OrbSkins.prototype._applyStateFromBackend = function(state) {
        if (!state) return;
        // 应用表情状态
        if (state.state && state.state !== this.state) {
            this.setState(state.state);
        }
        // 应用说话状态
        if (typeof state.talking === 'boolean') {
            this.setImageTalking(state.talking);
            // 同步到其他皮肤类型
            if (this.currentType === 'svg' && state.talking) {
                // SVG角色说话时可以添加嘴部动画
            }
        }
        // 应用动作（如果有程序化动作系统）
        if (state.action && window.World3D && window.World3D.triggerAction) {
            // 可以触发程序化动作
        }
    };

    OrbSkins.prototype.scanCustomSkins = function() {
        return fetch('/api/orb/skins').then(r => r.json()).then(data => {
            if (data.skins) {
                this.customSkins = data.skins;
                this.renderSelector();
            }
        }).catch(() => {});
    };

    // ============ 辅助方法 ============
    OrbSkins.prototype._getTypeInfo = function(skin) {
        var map = {
            blob:    { label: '光球',   color: '#6b7280', icon: '🔮', desc: '默认光球灵体（2D CSS动画）' },
            custom:  { label: '定制',   color: '#8b5cf6', icon: '🎨', desc: '参数化定制角色（SVG 2D）' },
            image:   { label: '2D图片', color: '#06b6d4', icon: '🖼️', desc: '2D 静态图片（PNG/JPG/GIF）' },
            svg:     { label: 'SVG',    color: '#10b981', icon: '✏️', desc: 'SVG 矢量图形（2D）' },
            live2d:  { label: 'Live2D', color: '#0ea5e9', icon: '🎭', desc: 'Live2D 动态模型（2.5D，灵体球内）' },
            mmd:     { label: 'MMD',    color: '#ec4899', icon: '💃', desc: 'MMD/PMX 模型（3D，灵体球内）' },
            glb:     { label: 'GLB',    color: '#f59e0b', icon: '🧊', desc: 'glTF/GLB 3D模型（全屏3D世界）' },
            gltf:    { label: 'glTF',   color: '#f59e0b', icon: '🧊', desc: 'glTF 3D模型（全屏3D世界）' },
            vrm:     { label: 'VRM',    color: '#f97316', icon: '🧊', desc: 'VRM 虚拟人形模型（全屏3D世界）' },
            fbx:     { label: 'FBX',    color: '#a855f7', icon: '🧊', desc: 'FBX 3D模型（全屏3D世界，无需Blender）' }
        };
        return map[skin.type] || { label: skin.type || '其他', color: '#6b7280', icon: '📦', desc: '未知类型' };
    };

    OrbSkins.prototype._getThumbnail = function(skin, size) {
        size = size || 44;
        var info = this._getTypeInfo(skin);
        if (skin.type === 'blob') {
            return '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#a78bfa,#6a4c93);box-shadow:0 0 12px rgba(106,76,147,0.4);display:flex;align-items:center;justify-content:center;font-size:' + (size*0.4) + 'px;">🔮</div>';
        }
        if (skin.type === 'custom' && skin.params) {
            return '<div style="width:' + size + 'px;height:' + size + 'px;overflow:hidden;border-radius:8px;background:#f9fafb;">' + generateCharacterSVG(skin.params, '') + '</div>';
        }
        if (skin.type === 'image' && skin.url) {
            return '<img src="' + skin.url + '" style="width:' + size + 'px;height:' + size + 'px;object-fit:cover;border-radius:8px;" alt="">';
        }
        return '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:8px;background:' + info.color + '15;display:flex;align-items:center;justify-content:center;font-size:' + (size*0.45) + 'px;">' + info.icon + '</div>';
    };

    OrbSkins.prototype._isFavorite = function(skinId) {
        return this._favorites.indexOf(skinId) >= 0;
    };

    OrbSkins.prototype._toggleFavorite = function(skinId) {
        var idx = this._favorites.indexOf(skinId);
        if (idx >= 0) this._favorites.splice(idx, 1);
        else this._favorites.push(skinId);
        localStorage.setItem('mrhua_orb_favorites', JSON.stringify(this._favorites));
    };

    OrbSkins.prototype._addToRecent = function(skinId) {
        this._recent = this._recent.filter(function(id) { return id !== skinId; });
        this._recent.unshift(skinId);
        if (this._recent.length > 20) this._recent = this._recent.slice(0, 20);
        localStorage.setItem('mrhua_orb_recent', JSON.stringify(this._recent));
    };

    OrbSkins.prototype._getFilteredSkins = function() {
        var self = this;
        var skins = this.getAllSkins();
        var q = (this._searchQuery || '').toLowerCase().trim();
        if (q) {
            skins = skins.filter(function(s) {
                return (s.name || '').toLowerCase().indexOf(q) >= 0 ||
                    (s.desc || '').toLowerCase().indexOf(q) >= 0 ||
                    (s.type || '').toLowerCase().indexOf(q) >= 0 ||
                    s.id.toLowerCase().indexOf(q) >= 0;
            });
        }
        if (this._sortMode === 'name') {
            skins.sort(function(a, b) { return (a.name || '').localeCompare(b.name || '', 'zh'); });
        } else if (this._sortMode === 'recent') {
            var order = {};
            this._recent.forEach(function(id, i) { order[id] = i; });
            skins.sort(function(a, b) {
                var oa = order[a.id] !== undefined ? order[a.id] : 999;
                var ob = order[b.id] !== undefined ? order[b.id] : 999;
                return oa - ob;
            });
        }
        skins.sort(function(a, b) {
            var fa = self._isFavorite(a.id) ? 0 : 1;
            var fb = self._isFavorite(b.id) ? 0 : 1;
            return fa - fb;
        });
        return skins;
    };

    OrbSkins.prototype._toggleCategory = function(catKey) {
        this._collapsedCats[catKey] = !this._collapsedCats[catKey];
        localStorage.setItem('mrhua_orb_collapsed', JSON.stringify(this._collapsedCats));
    };

    OrbSkins.prototype._showCustomConfirm = function(msg, onConfirm) {
        var overlay = document.getElementById('custom-modal-overlay');
        if (overlay) {
            document.getElementById('custom-modal-msg').textContent = msg;
            var btns = document.getElementById('custom-modal-btns');
            btns.innerHTML = '';
            var cancel = document.createElement('button');
            cancel.textContent = '取消';
            cancel.style.cssText = 'padding:7px 18px;border:1px solid #ddd;border-radius:8px;background:#fff;color:#666;cursor:pointer;font-size:0.85rem;';
            cancel.onclick = function() { overlay.style.display = 'none'; };
            var ok = document.createElement('button');
            ok.textContent = '确定';
            ok.style.cssText = 'padding:7px 18px;border:none;border-radius:8px;background:#ef4444;color:#fff;cursor:pointer;font-size:0.85rem;';
            ok.onclick = function() { overlay.style.display = 'none'; onConfirm(); };
            btns.appendChild(cancel);
            btns.appendChild(ok);
            overlay.style.display = 'flex';
        } else {
            if (confirm(msg)) onConfirm();
        }
    };

    OrbSkins.prototype._showCustomPrompt = function(msg, defaultValue, onConfirm) {
        var overlay = document.getElementById('custom-modal-overlay');
        if (overlay) {
            document.getElementById('custom-modal-msg').innerHTML = msg + '<br><input id="custom-prompt-input" type="text" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;margin-top:10px;box-sizing:border-box;">';
            var input = document.getElementById('custom-prompt-input');
            input.value = defaultValue || '';
            var btns = document.getElementById('custom-modal-btns');
            btns.innerHTML = '';
            var cancel = document.createElement('button');
            cancel.textContent = '取消';
            cancel.style.cssText = 'padding:7px 18px;border:1px solid #ddd;border-radius:8px;background:#fff;color:#666;cursor:pointer;font-size:0.85rem;';
            cancel.onclick = function() { overlay.style.display = 'none'; };
            var ok = document.createElement('button');
            ok.textContent = '确定';
            ok.style.cssText = 'padding:7px 18px;border:none;border-radius:8px;background:#4f46e5;color:#fff;cursor:pointer;font-size:0.85rem;';
            ok.onclick = function() { var v = input.value.trim(); overlay.style.display = 'none'; if (v) onConfirm(v); };
            input.onkeydown = function(e) { if (e.key === 'Enter') ok.click(); };
            btns.appendChild(cancel);
            btns.appendChild(ok);
            overlay.style.display = 'flex';
            setTimeout(function() { input.focus(); }, 50);
        } else {
            var v = prompt(msg, defaultValue);
            if (v) onConfirm(v);
        }
    };

    OrbSkins.prototype._renameSkin = function(skinId) {
        var self = this;
        var skin = this.getSkin(skinId);
        if (!skin || skin.id === 'blob') return;
        this._showCustomPrompt('重命名皮肤：', skin.name, function(newName) {
            if (skin.id === 'custom' || skin.type === 'custom') {
                // 定制角色：更新 customChars 中的名称
                if (self.customChars[self.identityKey]) {
                    self.customChars[self.identityKey].name = newName;
                    localStorage.setItem('mrhua_orb_chars', JSON.stringify(self.customChars));
                }
                self.renderSelector();
            } else if (skin.id.indexOf('custom_') === 0) {
                fetch('/api/orb/skins/rename', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: skinId, name: newName })
                }).then(function(r) { return r.json(); }).then(function(d) {
                    if (d.success) { self.scanCustomSkins(); }
                }).catch(function() {});
            } else {
                skin.name = newName;
                self.renderSelector();
            }
        });
    };

    OrbSkins.prototype._exportSkin = function(skinId) {
        var skin = this.getSkin(skinId);
        if (!skin) return;
        var data = JSON.stringify(skin, null, 2);
        var blob = new Blob([data], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = (skin.name || skin.id).replace(/[^\w\u4e00-\u9fa5]/g, '_') + '.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    OrbSkins.prototype._deleteSkin = function(skinId) {
        var self = this;
        var skin = this.getSkin(skinId);
        if (!skin || skin.id === 'blob') return;
        this._showCustomConfirm('确定删除「' + skin.name + '」？此操作不可撤销。', function() {
            if (skin.id === 'custom' || skin.type === 'custom') {
                // 定制角色：从 customChars 中删除当前身份的定制参数
                delete self.customChars[self.identityKey];
                localStorage.setItem('mrhua_orb_chars', JSON.stringify(self.customChars));
                if (self.currentSkin === skinId) { self.currentSkin = 'blob'; self.apply('blob'); }
                self._favorites = self._favorites.filter(function(id) { return id !== skinId; });
                localStorage.setItem('mrhua_orb_favorites', JSON.stringify(self._favorites));
                self.renderSelector();
            } else if (skin.id.indexOf('custom_') === 0) {
                fetch('/api/orb/skins/delete', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: skinId })
                }).then(function(r) { return r.json(); }).then(function(d) {
                    if (d.success) {
                        if (self.currentSkin === skinId) self.currentSkin = 'blob';
                        self._favorites = self._favorites.filter(function(id) { return id !== skinId; });
                        localStorage.setItem('mrhua_orb_favorites', JSON.stringify(self._favorites));
                        self.scanCustomSkins();
                    }
                }).catch(function() {});
            } else {
                self.customSkins = self.customSkins.filter(function(s) { return s.id !== skinId; });
                if (self.currentSkin === skinId) { self.currentSkin = 'blob'; self.apply('blob'); }
                self._favorites = self._favorites.filter(function(id) { return id !== skinId; });
                localStorage.setItem('mrhua_orb_favorites', JSON.stringify(self._favorites));
                self.renderSelector();
            }
        });
    };

    OrbSkins.prototype._enterBatchMode = function() {
        this._batchMode = true;
        this._batchSelected = {};
        this.renderSelector();
    };

    OrbSkins.prototype._exitBatchMode = function() {
        this._batchMode = false;
        this._batchSelected = {};
        this.renderSelector();
    };

    OrbSkins.prototype._toggleBatchSelect = function(skinId) {
        if (this._batchSelected[skinId]) delete this._batchSelected[skinId];
        else this._batchSelected[skinId] = true;
        this.renderSelector();
    };

    OrbSkins.prototype._batchDelete = function() {
        var self = this;
        var ids = Object.keys(this._batchSelected);
        if (ids.length === 0) return;
        this._showCustomConfirm('确定删除选中的 ' + ids.length + ' 个皮肤？', function() {
            var done = 0;
            ids.forEach(function(id) {
                if (id === 'custom') {
                    delete self.customChars[self.identityKey];
                    localStorage.setItem('mrhua_orb_chars', JSON.stringify(self.customChars));
                    done++;
                    if (done >= ids.length) { self._exitBatchMode(); self.renderSelector(); }
                } else if (id.indexOf('custom_') === 0) {
                    fetch('/api/orb/skins/delete', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: id })
                    }).then(function() { done++; if (done >= ids.length) { self._exitBatchMode(); self.scanCustomSkins(); } }).catch(function() { done++; if (done >= ids.length) { self._exitBatchMode(); self.scanCustomSkins(); } });
                } else {
                    self.customSkins = self.customSkins.filter(function(s) { return s.id !== id; });
                    done++;
                    if (done >= ids.length) { self._exitBatchMode(); self.renderSelector(); }
                }
            });
        });
    };

    OrbSkins.prototype._openImageUpload = function() {
        var self = this;
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png,image/jpeg,image/webp,image/gif';
        input.onchange = function(e) {
            var file = e.target.files[0];
            if (!file) return;
            self._showCustomPrompt('请输入角色名称：', file.name.replace(/\.[^.]+$/, ''), function(name) {
                var formData = new FormData();
                formData.append('file', file);
                formData.append('name', name);
                fetch('/api/orb/skins/image_upload', { method: 'POST', body: formData })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) {
                            self.scanCustomSkins().then(function() { self.apply(data.id); });
                        } else {
                            alert('上传失败：' + (data.error || '未知错误'));
                        }
                    })
                    .catch(function(err) { alert('上传失败：' + err.message); });
            });
        };
        input.click();
    };

    OrbSkins.prototype._toggleSilhouette = function() {
        if (!window.World3D) { alert('World3D 未加载'); return; }
        var skin = this.getSkin(this.currentSkin);
        var modelUrl = skin && (skin.model_url || skin.url || skin.path);
        var isSil = window.World3D.isSilhouetteMode && window.World3D.isSilhouetteMode();
        if (isSil) {
            if (modelUrl) { window.World3D.load(modelUrl); }
            else { alert('无法获取模型路径，请重新选择3D模型'); }
        } else {
            if (modelUrl) {
                window.World3D.loadSilhouette(modelUrl);
                alert('已进入剪影灵体模式！\n\n可用动作：\n' + (window.World3D.getSilhouetteActions ? window.World3D.getSilhouetteActions().join(', ') : 'wave, nod, shake') + '\n\n测试：window.World3D.triggerSilhouetteAction("wave")');
            } else {
                alert('当前皮肤不是3D模型，无法转成剪影灵体\n\n请先选择一个VRM/GLB模型');
            }
        }
        this.renderSelector();
    };

    // 皮肤元数据（name/desc、类型标签）来自服务端 manifest.json，
    // 由上传接口原样落盘（web.py 的 api_orb_skin_upload / image_upload / live2d 等），
    // 属不可信数据。该选择器用 innerHTML 组装按钮，必须转义后再拼接，
    // 否则一次皮肤上传即可在任何客户端渲染选择器时执行脚本。
    function _skinText(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ============ 皮肤选择器（增强版） ============
    OrbSkins.prototype.renderSelector = function() {
        var self = this;
        var list = document.getElementById('orb-skin-list');
        if (!list) return;
        // 保存搜索框焦点状态，避免重建DOM后失焦
        var activeEl = document.activeElement;
        var wasSearchFocused = activeEl && activeEl.tagName === 'INPUT' && activeEl.closest && activeEl.closest('#orb-skin-list');
        var cursorPos = wasSearchFocused ? activeEl.selectionStart : -1;
        var allSkins = this.getAllSkins();
        var skins = this._getFilteredSkins();
        list.innerHTML = '';

        // 顶部工具栏
        var toolbar = document.createElement('div');
        toolbar.style.cssText = 'display:flex;gap:6px;margin-bottom:10px;align-items:center;';
        var searchWrap = document.createElement('div');
        searchWrap.style.cssText = 'flex:1;position:relative;';
        var searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = '搜索皮肤名称/类型...';
        searchInput.value = this._searchQuery || '';
        searchInput.style.cssText = 'width:100%;padding:7px 10px 7px 28px;border:1px solid #e5e7eb;border-radius:8px;font-size:0.78rem;box-sizing:border-box;outline:none;transition:border-color 0.15s;';
        searchInput.onfocus = function() { searchInput.style.borderColor = '#4f46e5'; };
        searchInput.onblur = function() { searchInput.style.borderColor = '#e5e7eb'; };
        searchInput.oninput = function() { self._searchQuery = searchInput.value; self.renderSelector(); };
        var searchIcon = document.createElement('span');
        searchIcon.style.cssText = 'position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:0.75rem;opacity:0.5;pointer-events:none;';
        searchIcon.textContent = '🔍';
        searchWrap.appendChild(searchIcon);
        searchWrap.appendChild(searchInput);
        toolbar.appendChild(searchWrap);

        var sortSelect = document.createElement('select');
        sortSelect.style.cssText = 'padding:7px 6px;border:1px solid #e5e7eb;border-radius:8px;font-size:0.75rem;background:#fff;cursor:pointer;outline:none;';
        [{ key: 'default', label: '默认排序' }, { key: 'recent', label: '最近使用' }, { key: 'name', label: '名称排序' }].forEach(function(o) {
            var opt = document.createElement('option');
            opt.value = o.key; opt.textContent = o.label;
            if (self._sortMode === o.key) opt.selected = true;
            sortSelect.appendChild(opt);
        });
        sortSelect.onchange = function() { self._sortMode = sortSelect.value; localStorage.setItem('mrhua_orb_sort', self._sortMode); self.renderSelector(); };
        toolbar.appendChild(sortSelect);

        var batchBtn = document.createElement('button');
        batchBtn.textContent = this._batchMode ? '✓ 完成' : '☰ 批量';
        batchBtn.style.cssText = 'padding:7px 10px;border:1px solid ' + (this._batchMode ? '#4f46e5' : '#e5e7eb') + ';border-radius:8px;font-size:0.75rem;background:' + (this._batchMode ? '#4f46e5' : '#fff') + ';color:' + (this._batchMode ? '#fff' : '#6b7280') + ';cursor:pointer;white-space:nowrap;';
        batchBtn.onclick = function() { self._batchMode ? self._exitBatchMode() : self._enterBatchMode(); };
        toolbar.appendChild(batchBtn);
        list.appendChild(toolbar);

        // 排版切换
        var layout = localStorage.getItem('mrhua_orb_layout') || 'grid';
        var layoutBar = document.createElement('div');
        layoutBar.style.cssText = 'display:flex;gap:4px;margin-bottom:10px;padding:3px;background:#f3f4f6;border-radius:8px;';
        [{ key: 'list', label: '列表' }, { key: 'grid', label: '网格' }, { key: 'compact', label: '紧凑' }].forEach(function(l) {
            var btn = document.createElement('button');
            btn.textContent = l.label;
            btn.style.cssText = 'flex:1;padding:5px;border:none;border-radius:6px;background:' + (layout === l.key ? '#fff' : 'transparent') + ';color:' + (layout === l.key ? '#4f46e5' : '#6b7280') + ';font-size:0.72rem;font-weight:' + (layout === l.key ? '600' : '400') + ';cursor:pointer;box-shadow:' + (layout === l.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none') + ';';
            btn.onclick = function() { localStorage.setItem('mrhua_orb_layout', l.key); self.renderSelector(); };
            layoutBar.appendChild(btn);
        });
        list.appendChild(layoutBar);

        // 空状态
        if (skins.length === 0) {
            var empty = document.createElement('div');
            empty.style.cssText = 'text-align:center;padding:30px 20px;color:#9ca3af;';
            if (this._searchQuery) {
                empty.innerHTML = '<div style="font-size:1.8rem;margin-bottom:8px;">🔍</div><div style="font-size:0.82rem;">没有找到匹配「' + _skinText(this._searchQuery) + '」的皮肤</div>';
            } else {
                empty.innerHTML = '<div style="font-size:1.8rem;margin-bottom:8px;">📦</div><div style="font-size:0.82rem;">还没有自定义皮肤</div><div style="font-size:0.72rem;margin-top:4px;">点击下方按钮创建或导入</div>';
            }
            list.appendChild(empty);
        } else {
            // 分类
            var categories = {
                default: { title: '默认灵体', skins: [], color: '#6b7280' },
                custom: { title: '定制角色', skins: [], color: '#8b5cf6' },
                image: { title: '2D图片', skins: [], color: '#06b6d4' },
                svg: { title: 'SVG皮肤', skins: [], color: '#10b981' },
                model3d: { title: '3D模型', skins: [], color: '#f59e0b' },
                other: { title: '其他', skins: [], color: '#6b7280' }
            };
            skins.forEach(function(skin) {
                if (skin.id === 'blob') categories.default.skins.push(skin);
                else if (skin.type === 'custom') categories.custom.skins.push(skin);
                else if (skin.type === 'image') categories.image.skins.push(skin);
                else if (skin.type === 'svg') categories.svg.skins.push(skin);
                else if (['glb', 'vrm', 'live2d', 'mmd'].indexOf(skin.type) >= 0) categories.model3d.skins.push(skin);
                else categories.other.skins.push(skin);
            });

            Object.entries(categories).forEach(function(entry) {
                var catKey = entry[0], cat = entry[1];
                if (cat.skins.length === 0) return;
                var collapsed = self._collapsedCats[catKey];
                var catHeader = document.createElement('div');
                catHeader.style.cssText = 'font-size:0.76rem;color:' + cat.color + ';margin:12px 0 6px;font-weight:700;display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;';
                catHeader.innerHTML = '<span style="display:inline-block;width:12px;transition:transform 0.2s;transform:rotate(' + (collapsed ? 0 : 90) + 'deg);">▶</span>' + cat.title + ' <span style="font-size:0.65rem;color:#9ca3af;font-weight:400;">(' + cat.skins.length + ')</span>';
                catHeader.onclick = function() { self._toggleCategory(catKey); self.renderSelector(); };
                list.appendChild(catHeader);
                if (collapsed) return;

                var grid = document.createElement('div');
                if (layout === 'list') grid.style.cssText = 'display:flex;flex-direction:column;gap:5px;margin-bottom:6px;';
                else if (layout === 'compact') grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:5px;margin-bottom:6px;';
                else grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px;margin-bottom:6px;';

                cat.skins.forEach(function(skin) {
                    var wrap = document.createElement('div');
                    wrap.style.cssText = 'position:relative;';
                    var active = skin.id === self.currentSkin;
                    var isFav = self._isFavorite(skin.id);
                    var info = self._getTypeInfo(skin);
                    var selected = self._batchSelected[skin.id];
                    var btn = document.createElement('button');
                    btn.dataset.skinId = skin.id;
                    var thumbSize = layout === 'compact' ? 32 : (layout === 'list' ? 36 : 44);
                    btn.title = info.desc + (skin.desc ? ' — ' + skin.desc : '');

                    if (layout === 'compact') {
                        btn.style.cssText = 'width:100%;padding:6px 4px;border:2px solid ' + (active ? cat.color : (selected ? '#4f46e5' : '#e5e7eb')) + ';border-radius:8px;background:' + (active ? cat.color + '10' : (selected ? '#eef2ff' : '#fff')) + ';cursor:pointer;font-size:0.7rem;color:' + (active ? cat.color : '#374151') + ';transition:all 0.15s;text-align:center;display:flex;flex-direction:column;align-items:center;gap:3px;';
                        btn.innerHTML = self._getThumbnail(skin, thumbSize) + '<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%;">' + _skinText(skin.name) + '</div>';
                    } else if (layout === 'list') {
                        btn.style.cssText = 'width:100%;padding:7px 10px;border:2px solid ' + (active ? cat.color : (selected ? '#4f46e5' : '#e5e7eb')) + ';border-radius:8px;background:' + (active ? cat.color + '10' : (selected ? '#eef2ff' : '#fff')) + ';cursor:pointer;font-size:0.78rem;color:' + (active ? cat.color : '#374151') + ';transition:all 0.15s;text-align:left;display:flex;align-items:center;gap:8px;';
                        btn.innerHTML = self._getThumbnail(skin, thumbSize) + '<div style="flex:1;min-width:0;"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _skinText(skin.name) + '</div><div style="font-size:0.65rem;color:#9ca3af;margin-top:1px;"><span style="display:inline-block;padding:1px 5px;border-radius:3px;background:' + info.color + '15;color:' + info.color + ';margin-right:4px;">' + _skinText(info.label) + '</span>' + _skinText(skin.desc || '') + '</div></div>';
                    } else {
                        btn.style.cssText = 'width:100%;padding:8px;border:2px solid ' + (active ? cat.color : (selected ? '#4f46e5' : '#e5e7eb')) + ';border-radius:10px;background:' + (active ? cat.color + '10' : (selected ? '#eef2ff' : '#fff')) + ';cursor:pointer;font-size:0.78rem;color:' + (active ? cat.color : '#374151') + ';transition:all 0.15s;text-align:left;display:flex;align-items:center;gap:8px;';
                        btn.innerHTML = self._getThumbnail(skin, thumbSize) + '<div style="flex:1;min-width:0;"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _skinText(skin.name) + '</div><div style="font-size:0.65rem;color:#9ca3af;margin-top:2px;display:flex;align-items:center;gap:4px;"><span style="display:inline-block;padding:1px 5px;border-radius:3px;background:' + info.color + '15;color:' + info.color + ';">' + _skinText(info.label) + '</span>' + _skinText(skin.desc || '') + '</div></div>';
                    }

                    if (self._batchMode) {
                        btn.onclick = function(e) { e.stopPropagation(); self._toggleBatchSelect(skin.id); };
                    } else {
                        btn.onclick = function() { self.apply(skin.id); self.renderSelector(); };
                    }
                    btn.onmouseenter = function() { if (!active && !selected) btn.style.borderColor = cat.color; };
                    btn.onmouseleave = function() { if (!active && !selected) btn.style.borderColor = '#e5e7eb'; };
                    wrap.appendChild(btn);

                    if (!self._batchMode && skin.id !== 'blob') {
                        var actions = document.createElement('div');
                        actions.style.cssText = 'position:absolute;top:3px;right:3px;display:flex;gap:2px;z-index:2;';
                        var favBtn = document.createElement('button');
                        favBtn.textContent = isFav ? '⭐' : '☆';
                        favBtn.title = isFav ? '取消收藏' : '收藏';
                        favBtn.style.cssText = 'width:20px;height:20px;padding:0;border:none;border-radius:50%;background:' + (isFav ? '#fef3c7' : 'rgba(255,255,255,0.85)') + ';color:' + (isFav ? '#f59e0b' : '#9ca3af') + ';font-size:0.7rem;cursor:pointer;line-height:20px;text-align:center;backdrop-filter:blur(4px);';
                        favBtn.onmouseenter = function() { favBtn.style.background = '#fef3c7'; favBtn.style.color = '#f59e0b'; };
                        favBtn.onmouseleave = function() { favBtn.style.background = isFav ? '#fef3c7' : 'rgba(255,255,255,0.85)'; favBtn.style.color = isFav ? '#f59e0b' : '#9ca3af'; };
                        favBtn.onclick = function(e) { e.stopPropagation(); self._toggleFavorite(skin.id); self.renderSelector(); };
                        actions.appendChild(favBtn);

                        var renameBtn = document.createElement('button');
                        renameBtn.textContent = '✏️';
                        renameBtn.title = '重命名';
                        renameBtn.style.cssText = 'width:20px;height:20px;padding:0;border:none;border-radius:50%;background:rgba(255,255,255,0.85);font-size:0.65rem;cursor:pointer;line-height:20px;text-align:center;backdrop-filter:blur(4px);';
                        renameBtn.onmouseenter = function() { renameBtn.style.background = '#dbeafe'; };
                        renameBtn.onmouseleave = function() { renameBtn.style.background = 'rgba(255,255,255,0.85)'; };
                        renameBtn.onclick = function(e) { e.stopPropagation(); self._renameSkin(skin.id); };
                        actions.appendChild(renameBtn);

                        var exportBtn = document.createElement('button');
                        exportBtn.textContent = '📤';
                        exportBtn.title = '导出皮肤配置';
                        exportBtn.style.cssText = 'width:20px;height:20px;padding:0;border:none;border-radius:50%;background:rgba(255,255,255,0.85);font-size:0.65rem;cursor:pointer;line-height:20px;text-align:center;backdrop-filter:blur(4px);';
                        exportBtn.onmouseenter = function() { exportBtn.style.background = '#d1fae5'; };
                        exportBtn.onmouseleave = function() { exportBtn.style.background = 'rgba(255,255,255,0.85)'; };
                        exportBtn.onclick = function(e) { e.stopPropagation(); self._exportSkin(skin.id); };
                        actions.appendChild(exportBtn);

                        var delBtn = document.createElement('button');
                        delBtn.textContent = '✕';
                        delBtn.title = '删除';
                        delBtn.style.cssText = 'width:20px;height:20px;padding:0;border:none;border-radius:50%;background:rgba(255,255,255,0.85);color:#9ca3af;font-size:0.65rem;cursor:pointer;line-height:20px;text-align:center;backdrop-filter:blur(4px);';
                        delBtn.onmouseenter = function() { delBtn.style.background = '#ef4444'; delBtn.style.color = '#fff'; };
                        delBtn.onmouseleave = function() { delBtn.style.background = 'rgba(255,255,255,0.85)'; delBtn.style.color = '#9ca3af'; };
                        delBtn.onclick = function(e) { e.stopPropagation(); self._deleteSkin(skin.id); };
                        actions.appendChild(delBtn);
                        wrap.appendChild(actions);
                    }

                    if (self._batchMode && skin.id !== 'blob') {
                        var check = document.createElement('div');
                        check.style.cssText = 'position:absolute;top:4px;left:4px;width:18px;height:18px;border:2px solid ' + (selected ? '#4f46e5' : '#d1d5db') + ';border-radius:4px;background:' + (selected ? '#4f46e5' : '#fff') + ';display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.7rem;z-index:2;';
                        check.textContent = selected ? '✓' : '';
                        wrap.appendChild(check);
                    }
                    grid.appendChild(wrap);
                });
                list.appendChild(grid);
            });
        }

        // 批量操作底栏
        if (this._batchMode) {
            var batchBar = document.createElement('div');
            batchBar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;background:#eef2ff;border-radius:8px;margin-top:10px;';
            var count = Object.keys(this._batchSelected).length;
            var allSelected = skins.filter(function(s) { return s.id !== 'blob'; }).every(function(s) { return self._batchSelected[s.id]; });
            var selectAllBtn = document.createElement('button');
            selectAllBtn.textContent = allSelected ? '取消全选' : '全选';
            selectAllBtn.style.cssText = 'padding:5px 12px;border:1px solid #c7d2fe;border-radius:6px;background:#fff;color:#4f46e5;font-size:0.75rem;cursor:pointer;';
            selectAllBtn.onclick = function() {
                if (allSelected) { self._batchSelected = {}; }
                else { skins.filter(function(s) { return s.id !== 'blob'; }).forEach(function(s) { self._batchSelected[s.id] = true; }); }
                self.renderSelector();
            };
            var delBtn = document.createElement('button');
            delBtn.textContent = '删除选中 (' + count + ')';
            delBtn.disabled = count === 0;
            delBtn.style.cssText = 'padding:5px 12px;border:none;border-radius:6px;background:' + (count > 0 ? '#ef4444' : '#d1d5db') + ';color:#fff;font-size:0.75rem;cursor:' + (count > 0 ? 'pointer' : 'not-allowed') + ';';
            delBtn.onclick = function() { if (count > 0) self._batchDelete(); };
            batchBar.appendChild(selectAllBtn);
            batchBar.appendChild(delBtn);
            list.appendChild(batchBar);
        }

        // 快捷操作区
        var actionTitle = document.createElement('div');
        actionTitle.style.cssText = 'font-size:0.76rem;color:#6b7280;margin:14px 0 6px;font-weight:700;';
        actionTitle.textContent = '⚡ 快捷操作';
        list.appendChild(actionTitle);

        var actionGrid = document.createElement('div');
        actionGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:6px;';

        var silActive = window.World3D && window.World3D.isSilhouetteMode && window.World3D.isSilhouetteMode();
        var stageActive = !!localStorage.getItem('mrhua_orb_stage_' + this.getIdentityKey());
        var actions = [
            { icon: '🎨', label: '定制角色', color: '#8b5cf6', onclick: function() { self.openCustomizer(); } },
            { icon: '🖼️', label: '上传2D图片', color: '#06b6d4', onclick: function() { self._openImageUpload(); }, title: '上传 PNG/JPG 图片作为2D灵体（支持透明背景）' },
            { icon: '📁', label: '导入3D模型', color: '#f59e0b', onclick: function() { self.openImport(); } },
            { icon: '👻', label: '剪影灵体', color: '#a78bfa', onclick: function() { self._toggleSilhouette(); }, active: silActive },
            { icon: '🏞️', label: '背景板', color: '#10b981', onclick: function() { self.openStagePicker(); }, active: stageActive },
            { icon: '🔄', label: '重置光球', color: '#ef4444', onclick: function() { self.apply('blob'); self.renderSelector(); } }
        ];

        actions.forEach(function(a) {
            var btn = document.createElement('button');
            var isActive = a.active;
            btn.style.cssText = 'padding:8px 6px;border:2px ' + (isActive ? 'solid' : 'dashed') + ' ' + (isActive ? a.color : '#e5e7eb') + ';border-radius:10px;background:' + (isActive ? a.color + '10' : '#fff') + ';cursor:pointer;font-size:0.72rem;color:' + (isActive ? a.color : '#6b7280') + ';transition:all 0.15s;display:flex;flex-direction:column;align-items:center;gap:2px;';
            btn.innerHTML = '<div style="font-size:1rem;">' + a.icon + '</div>' + a.label + (isActive ? ' ✓' : '');
            if (a.title) btn.title = a.title;
            btn.onmouseenter = function() { if (!isActive) { btn.style.borderColor = a.color; btn.style.background = a.color + '08'; } };
            btn.onmouseleave = function() { if (!isActive) { btn.style.borderColor = '#e5e7eb'; btn.style.background = '#fff'; } };
            btn.onclick = a.onclick;
            actionGrid.appendChild(btn);
        });
        list.appendChild(actionGrid);

        // 统计信息
        var stats = document.createElement('div');
        stats.style.cssText = 'text-align:center;font-size:0.65rem;color:#d1d5db;margin-top:10px;';
        var customCount = allSkins.filter(function(s) { return s.id !== 'blob'; }).length;
        stats.textContent = '共 ' + allSkins.length + ' 个皮肤 · ' + customCount + ' 个自定义 · ' + this._favorites.length + ' 个收藏';
        list.appendChild(stats);

        // 恢复搜索框焦点和光标位置
        if (wasSearchFocused) {
            var newInput = list.querySelector('input[type="text"]');
            if (newInput) {
                newInput.focus();
                try { newInput.setSelectionRange(cursorPos, cursorPos); } catch(e) {}
            }
        }
    };

    OrbSkins.prototype.apply = function(skinId) {
        const skin = this.getSkin(skinId);
        if (!skin) return;
        this.currentSkin = skinId;
        this.currentType = skin.type === 'custom' ? 'svg' : skin.type;
        this.saveSkin(skinId);
        this._addToRecent(skinId);

        const orb = document.getElementById('orb');
        if (!orb || !this.characterEl) return;
        this.destroyLive2D();
        this.destroyMMD();
        this.destroyImageSkin();
        this._stopWorld3DFollow();
        orb.classList.remove('has-stage', 'skin-world3d');
        orb.style.opacity = '';

        if (skin.type === 'blob') {
            this.characterEl.style.display = 'none';
            this.characterEl.innerHTML = '';
            orb.classList.remove('skin-svg', 'skin-live2d', 'skin-mmd');
            orb.classList.add('skin-blob');
        } else if (skin.type === 'custom') {
            orb.classList.remove('skin-blob', 'skin-live2d', 'skin-mmd');
            orb.classList.add('skin-svg');
            this.characterEl.style.display = 'block';
            this.renderCustom(skin.params);
        } else if (skin.type === 'svg') {
            orb.classList.remove('skin-blob', 'skin-live2d', 'skin-mmd');
            orb.classList.add('skin-svg');
            this.characterEl.style.display = 'block';
            if (skin.svg_file) {
                const base = '/static/orb_skins/' + skin.id.replace('custom_', '') + '/';
                fetch(base + skin.svg_file).then(r => r.text()).then(svg => {
                    this.characterEl.innerHTML = svg;
                    this.characterEl.classList.add('svg-breathing');
                }).catch(() => {
                    this.characterEl.innerHTML = '<div style="color:#999;font-size:10px;text-align:center;padding-top:40px;">SVG 加载失败</div>';
                });
            }
        } else if (skin.type === 'image') {
            orb.classList.remove('skin-blob', 'skin-svg', 'skin-live2d', 'skin-mmd');
            orb.classList.add('skin-image');
            this.characterEl.style.display = 'block';
            this.characterEl.innerHTML = '';
            this.loadImageSkin(skin);
        } else if (skin.type === 'live2d') {
            orb.classList.remove('skin-blob', 'skin-svg', 'skin-mmd');
            orb.classList.add('skin-live2d');
            this.characterEl.style.display = 'block';
            this.characterEl.innerHTML = '';
            this.loadLive2D(skin);
        } else if (skin.type === 'mmd') {
            orb.classList.remove('skin-blob', 'skin-svg', 'skin-live2d');
            orb.classList.add('skin-mmd');
            this.characterEl.style.display = 'block';
            this.characterEl.innerHTML = '';
            this.loadMMD(skin);
        } else if (skin.type === 'glb' || skin.type === 'gltf' || skin.type === 'vrm' || skin.type === 'fbx') {
            // 3D 模型（GLB/glTF/VRM/FBX）：在全屏 3D 世界中显示，灵体本身变透明
            orb.classList.remove('skin-blob', 'skin-svg', 'skin-live2d', 'skin-mmd');
            orb.classList.add('skin-world3d');
            this.characterEl.style.display = 'none';
            this.characterEl.innerHTML = '';
            this.loadWorld3D(skin);
        }
    };

    // ============ 全屏 3D 世界（GLB 模型） ============
    OrbSkins.prototype.loadWorld3D = function(skin) {
        if (!window.World3D) {
            console.warn('[OrbSkins] World3D 未就绪，回退到光球');
            return;
        }
        // 灵体光球隐藏，保留交互热区
        const orb = document.getElementById('orb');
        const stage = document.getElementById('orb-stage');
        if (orb) orb.classList.add('skin-world3d');
        if (stage) stage.classList.add('world3d-active');

        const url = skin.model_url;
        console.log('[OrbSkins] World3D 加载:', url);
        window.World3D.load(url, {
            onProgress: (pct) => {
                if (window.updateOrbStatus) window.updateOrbStatus(`加载模型 ${Math.round(pct * 100)}%`);
            },
            onLoad: () => {
                console.log('[OrbSkins] World3D 模型加载成功');
                if (window.updateOrbStatus) window.updateOrbStatus('');
                this._startWorld3DFollow();
                // 加载背景板
                this._loadWorld3DStage();

                // 暴露VRM对象给ModelAction检测（World3D路径）
                const vrm = window.World3D.getVRM();
                if (vrm) {
                    this._vrm = vrm;
                    this._world3dVRM = true;
                    console.log('[OrbSkins] World3D VRM已暴露给ModelAction, humanoid bones:', Object.keys(vrm.humanoid.humanBones).length);
                }

                // 绑定点击事件到World3D的canvas
                const w3dCanvas = window.World3D.getCanvas();
                if (w3dCanvas && !this._world3dClickBound) {
                    this._world3dClickBound = true;
                    w3dCanvas.style.pointerEvents = 'auto';
                    w3dCanvas.addEventListener('click', (e) => {
                        console.log('[OrbSkins] World3D模型被点击');
                        // 触发ModelAction动作
                        if (window.ModelAction) {
                            if (typeof window.ModelAction.wave === 'function') window.ModelAction.wave('right');
                            if (typeof window.ModelAction.setEmotion === 'function') {
                                window.ModelAction.setEmotion('happy');
                                setTimeout(() => { if (window.ModelAction) window.ModelAction.setEmotion('neutral'); }, 2000);
                            }
                        }
                        // 同时触发World3D自身的反应
                        if (window.World3D && typeof window.World3D.react === 'function') {
                            window.World3D.react('wave');
                        }
                    });
                    console.log('[OrbSkins] World3D点击事件已绑定');
                }
            },
            onError: (err) => {
                console.error('[OrbSkins] World3D 加载失败:', err);
                if (orb) orb.classList.remove('skin-world3d');
                if (stage) stage.classList.remove('world3d-active');
            }
        }).catch(err => {
            console.error('[OrbSkins] World3D 模块加载异常:', err);
            if (orb) orb.classList.remove('skin-world3d');
            if (stage) stage.classList.remove('world3d-active');
        });
    };

    /** 从 localStorage 读取背景板设置并加载到 World3D */
    OrbSkins.prototype._loadWorld3DStage = function() {
        if (!window.World3D || !window.World3D.loadStage) return;
        const identityKey = this.getIdentityKey();
        const stageUrl = localStorage.getItem('mrhua_orb_stage_' + identityKey);
        const stageType = localStorage.getItem('mrhua_orb_stage_type_' + identityKey) || 'auto';
        if (!stageUrl) return;
        window.World3D.loadStage(stageUrl, stageType).then(() => {
            const orb = document.getElementById('orb');
            if (orb) orb.classList.add('has-stage');
            console.log('[OrbSkins] 背景板加载成功:', stageUrl);
        }).catch(err => {
            console.warn('[OrbSkins] 背景板加载失败:', err);
        });
    };

    OrbSkins.prototype._startWorld3DFollow = function() {
        // 3D 模型自主漫游，不再逐帧跟随 2D 灵体位置
        if (!window.World3D) return;
        // 标记 2D 灵体停用（orb_extra.js 的 wander 会检查此标志）
        this._world3dActive = true;
        // 初始位置由 world3d.js 自己处理（屏幕下方中央）
    };

    OrbSkins.prototype._stopWorld3DFollow = function() {
        this._world3dActive = false;
        const orb = document.getElementById('orb');
        const stage = document.getElementById('orb-stage');
        if (orb) orb.classList.remove('skin-world3d');
        if (stage) stage.classList.remove('world3d-active');
    };

    OrbSkins.prototype.renderCustom = function(params) {
        params._uid = this.identityKey.length;
        this.characterEl.innerHTML = generateCharacterSVG(params, this.state);
        this.characterEl.classList.add('svg-breathing');
    };

    // ============ 2D 图片灵体系统 ============
    OrbSkins.prototype.loadImageSkin = function(skin) {
        const base = '/static/orb_skins/' + skin.id.replace('custom_', '') + '/';
        const imgUrl = base + (skin.image_file || 'character.png');
        const config = skin.config || {};

        // 创建容器
        const container = document.createElement('div');
        container.className = 'orb-image-container';
        container.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;overflow:visible;';

        // 创建灵体光环（背景发光）
        const aura = document.createElement('div');
        aura.className = 'orb-image-aura';
        aura.style.cssText = 'position:absolute;width:70%;height:70%;border-radius:50%;background:radial-gradient(circle, rgba(139,92,246,0.3) 0%, rgba(139,92,246,0.1) 40%, transparent 70%);filter:blur(20px);animation:auraPulse 3s ease-in-out infinite;pointer-events:none;';
        container.appendChild(aura);

        // 创建粒子容器
        const particleCanvas = document.createElement('canvas');
        particleCanvas.className = 'orb-image-particles';
        particleCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
        container.appendChild(particleCanvas);

        // 创建图片包装器（用于倾斜/3D效果）
        const imgWrapper = document.createElement('div');
        imgWrapper.className = 'orb-image-wrapper';
        imgWrapper.style.cssText = 'position:relative;z-index:2;transition:transform 0.1s ease-out;transform-style:preserve-3d;';

        // 创建图片元素
        const img = document.createElement('img');
        img.src = imgUrl;
        img.className = 'orb-image-character';
        img.style.cssText = 'max-width:80%;max-height:80%;object-fit:contain;filter:drop-shadow(0 8px 24px rgba(0,0,0,0.3)) drop-shadow(0 0 20px rgba(139,92,246,0.3));transition:filter 0.3s;';
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            console.log('[OrbSkins] 2D图片灵体加载成功:', imgUrl);
            this._startImageAnimation(img, imgWrapper, aura, particleCanvas, config);
            this._startParticleEffect(particleCanvas);
        };
        img.onerror = () => {
            container.innerHTML = '<div style="color:#999;font-size:10px;text-align:center;padding-top:40px;">图片加载失败</div>';
        };

        imgWrapper.appendChild(img);
        container.appendChild(imgWrapper);
        this.characterEl.appendChild(container);
        this._imageSkin = { img, imgWrapper, aura, particleCanvas, config, container, animState: { breath: 0, float: 0, sway: 0, blink: 0, talk: 0 } };
    };

    OrbSkins.prototype._startParticleEffect = function(canvas) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const particles = [];
        const particleCount = 25;

        const resize = () => {
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;
        };
        resize();
        window.addEventListener('resize', resize);

        for (let i = 0; i < particleCount; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                size: Math.random() * 3 + 1,
                speedX: (Math.random() - 0.5) * 0.5,
                speedY: -Math.random() * 0.8 - 0.2,
                opacity: Math.random() * 0.5 + 0.2,
                hue: Math.random() * 60 + 250
            });
        }

        const animate = () => {
            if (!this._imageSkin) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particles.forEach(p => {
                p.x += p.speedX;
                p.y += p.speedY;
                if (p.y < -10) {
                    p.y = canvas.height + 10;
                    p.x = Math.random() * canvas.width;
                }
                if (p.x < -10) p.x = canvas.width + 10;
                if (p.x > canvas.width + 10) p.x = -10;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fillStyle = `hsla(${p.hue}, 80%, 70%, ${p.opacity})`;
                ctx.fill();
            });
            requestAnimationFrame(animate);
        };
        animate();
    };

    OrbSkins.prototype._startImageAnimation = function(img, imgWrapper, aura, particleCanvas, config) {
        if (!this._imageAnimRAF) {
            this._imageAnimRAF = true;
            const animate = () => {
                if (!this._imageSkin) {
                    this._imageAnimRAF = false;
                    return;
                }
                const state = this._imageSkin.animState;
                const now = performance.now() / 1000;

                // 基础动画
                const breathScale = 1 + Math.sin(now * 1.5) * 0.02 * (config.breathScale || 1);
                const floatY = Math.sin(now * 0.8) * (config.floatAmp || 6);
                const swayX = Math.sin(now * 0.5) * (config.swayAmp || 2);
                const swayRot = Math.sin(now * 0.4) * 1;

                let scaleX = breathScale, scaleY = breathScale;
                let translateY = floatY;
                let translateX = swayX;
                let rotate = swayRot;
                let tiltX = 0, tiltY = 0;
                let glowIntensity = 0.3;
                let auraScale = 1;

                // 说话状态
                if (this.state === 'talking' || this._isTalking) {
                    const talkScale = 1 + Math.sin(now * 15) * 0.01;
                    scaleY *= talkScale;
                    glowIntensity = 0.5 + Math.sin(now * 10) * 0.2;
                }

                // 开心状态
                if (this.state === 'happy' || this.state === 'success' || this.state === 'complete') {
                    translateY += Math.abs(Math.sin(now * 4)) * 12;
                    rotate += Math.sin(now * 3) * 4;
                    glowIntensity = 0.6;
                    auraScale = 1.1 + Math.sin(now * 5) * 0.1;
                }

                // 思考状态
                if (this.state === 'thinking') {
                    rotate += 6;
                    translateX += Math.sin(now * 2) * 3;
                    tiltY = Math.sin(now * 1.5) * 5;
                }

                // 睡眠状态
                if (this.state === 'sleeping') {
                    scaleY = 1 + Math.sin(now * 0.8) * 0.025;
                    rotate += -4;
                    translateY += 8;
                    glowIntensity = 0.15;
                    auraScale = 0.9;
                }

                // 错误/警告状态
                if (this.state === 'error' || this.state === 'alert') {
                    translateX += Math.sin(now * 25) * 4;
                    rotate += Math.sin(now * 20) * 3;
                    glowIntensity = 0.7;
                }

                // 工作/扫描状态
                if (this.state === 'working' || this.state === 'scanning') {
                    rotate += Math.sin(now * 2) * 2;
                    glowIntensity = 0.4 + Math.sin(now * 8) * 0.15;
                    auraScale = 1 + Math.sin(now * 6) * 0.05;
                }

                // 应用变换
                imgWrapper.style.transform = `translate(${translateX}px, ${translateY}px) rotate(${rotate}deg) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(${scaleX}, ${scaleY})`;

                // 应用发光效果
                img.style.filter = `drop-shadow(0 8px 24px rgba(0,0,0,0.3)) drop-shadow(0 0 ${20 * glowIntensity}px rgba(139,92,246,${glowIntensity}))`;

                // 应用光环效果
                if (aura) {
                    aura.style.transform = `scale(${auraScale})`;
                    aura.style.opacity = 0.5 + glowIntensity * 0.5;
                }

                requestAnimationFrame(animate);
            };
            requestAnimationFrame(animate);
        }
    };

    OrbSkins.prototype.setImageTalking = function(isTalking) {
        this._isTalking = isTalking;
    };

    OrbSkins.prototype.destroyImageSkin = function() {
        if (this._imageSkin) {
            this._imageSkin = null;
        }
        this._isTalking = false;
    };

    OrbSkins.prototype.setState = function(state) {
        this.state = state || '';
        if (this.currentType === 'svg') {
            const skin = this.getSkin(this.currentSkin);
            if (skin.type === 'custom') this.renderCustom(skin.params);
        } else if (this.currentType === 'image') {
            // 2D图片灵体通过动画循环自动响应状态变化，无需额外操作
        } else if (this.currentType === 'live2d' && this.live2dRenderer) {
            this.playLive2DMotion(state);
        } else if (this.currentType === 'mmd' && this.mmdMesh) {
            this.setMMDState(state);
        }
    };

    // ============ 角色定制器 ============
    OrbSkins.prototype.openCustomizer = function() {
        const existing = document.getElementById('orb-customizer');
        if (existing) existing.remove();
        const params = this.getCustomChar();
        const overlay = document.createElement('div');
        overlay.id = 'orb-customizer';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:100000;display:flex;align-items:center;justify-content:center;';
        const shapeOptions = Object.entries(SHAPES).map(([k,v]) => `<option value="${k}" ${params.shape===k?'selected':''}>${v.label}</option>`).join('');
        const eyeOptions = Object.entries(EYE_STYLES).map(([k,v]) => `<option value="${k}" ${params.eyes===k?'selected':''}>${v.label}</option>`).join('');
        overlay.innerHTML = `
            <div style="background:#fff;border-radius:14px;padding:20px;width:380px;max-height:85vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                    <span style="font-size:1rem;font-weight:600;color:#333;">🎨 定制角色</span>
                    <button id="orb-cust-close" style="border:none;background:none;font-size:1.1rem;cursor:pointer;color:#999;">✕</button>
                </div>
                <div id="orb-cust-preview" style="width:120px;height:120px;margin:0 auto 14px;position:relative;"></div>
                <label style="font-size:0.8rem;color:#666;display:block;margin-bottom:4px;">角色名称</label>
                <input id="orb-cust-name" type="text" value="${params.name || ''}" placeholder="我的角色" style="width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.82rem;margin-bottom:10px;box-sizing:border-box;">
                <label style="font-size:0.8rem;color:#666;display:block;margin-bottom:4px;">形状</label>
                <select id="orb-cust-shape" style="width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.82rem;margin-bottom:10px;box-sizing:border-box;">${shapeOptions}</select>
                <label style="font-size:0.8rem;color:#666;display:block;margin-bottom:4px;">眼睛</label>
                <select id="orb-cust-eyes" style="width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.82rem;margin-bottom:10px;box-sizing:border-box;">${eyeOptions}</select>
                <label style="font-size:0.8rem;color:#666;display:block;margin-bottom:4px;">主色</label>
                <input id="orb-cust-color" type="color" value="${params.color || '#6a4c93'}" style="width:100%;height:34px;border:1px solid #ddd;border-radius:6px;cursor:pointer;margin-bottom:10px;box-sizing:border-box;">
                <label style="font-size:0.8rem;color:#666;display:flex;align-items:center;gap:6px;margin-bottom:14px;cursor:pointer;">
                    <input id="orb-cust-blush" type="checkbox" ${params.blush !== false ? 'checked' : ''}> 腮红
                </label>
                <div style="display:flex;gap:8px;">
                    <button id="orb-cust-save" style="flex:1;padding:8px;background:#6a4c93;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;">保存并使用</button>
                    <button id="orb-cust-cancel" style="padding:8px 16px;background:#f0f0f0;color:#666;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;">取消</button>
                </div>
                <div style="font-size:0.7rem;color:#aaa;margin-top:10px;text-align:center;">角色保存在本地，每个身份档案独立</div>
            </div>`;
        document.body.appendChild(overlay);

        const preview = overlay.querySelector('#orb-cust-preview');
        const updatePreview = () => {
            const p = {
                name: overlay.querySelector('#orb-cust-name').value,
                shape: overlay.querySelector('#orb-cust-shape').value,
                eyes: overlay.querySelector('#orb-cust-eyes').value,
                color: overlay.querySelector('#orb-cust-color').value,
                blush: overlay.querySelector('#orb-cust-blush').checked,
                _uid: 999
            };
            preview.innerHTML = generateCharacterSVG(p, this.state);
        };
        overlay.querySelectorAll('select, input').forEach(el => el.addEventListener('input', updatePreview));
        updatePreview();

        overlay.querySelector('#orb-cust-close').onclick = () => overlay.remove();
        overlay.querySelector('#orb-cust-cancel').onclick = () => overlay.remove();
        overlay.querySelector('#orb-cust-save').onclick = () => {
            const p = {
                name: overlay.querySelector('#orb-cust-name').value || '我的角色',
                shape: overlay.querySelector('#orb-cust-shape').value,
                eyes: overlay.querySelector('#orb-cust-eyes').value,
                color: overlay.querySelector('#orb-cust-color').value,
                blush: overlay.querySelector('#orb-cust-blush').checked
            };
            this.saveCustomChar(p);
            this.apply('custom');
            this.renderSelector();
            overlay.remove();
        };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    };

    // ============ 导入 SVG / Live2D ============
    OrbSkins.prototype.openImport = function() {
        const existing = document.getElementById('orb-import');
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.id = 'orb-import';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:100000;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#fff;border-radius:14px;padding:20px;width:400px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                    <span style="font-size:1rem;font-weight:600;color:#333;">📁 导入角色</span>
                    <button id="orb-imp-close" style="border:none;background:none;font-size:1.1rem;cursor:pointer;color:#999;">✕</button>
                </div>
                <div style="margin-bottom:12px;">
                    <label style="font-size:0.82rem;color:#555;font-weight:600;">上传 SVG 文件</label>
                    <input type="file" id="orb-imp-svg" accept=".svg" style="width:100%;margin-top:6px;font-size:0.8rem;">
                    <div style="font-size:0.7rem;color:#aaa;margin-top:3px;">SVG 建议 viewBox 0 0 100 100，角色居中</div>
                </div>
                <div style="margin-bottom:12px;">
                    <label style="font-size:0.82rem;color:#555;font-weight:600;">上传 2D 图片（PNG/JPG/WebP，支持透明背景）</label>
                    <input type="file" id="orb-imp-image" accept=".png,.jpg,.jpeg,.webp,.gif" style="width:100%;margin-top:6px;font-size:0.8rem;">
                    <div style="font-size:0.7rem;color:#aaa;margin-top:3px;">PNG 透明背景效果最佳，建议角色居中、尺寸 512x1024 或 1024x2048</div>
                </div>
                <div style="border-top:1px solid #eee;margin:12px 0;padding-top:12px;">
                    <label style="font-size:0.82rem;color:#555;font-weight:600;">上传模型</label>
                    <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
                        <label style="flex:1;min-width:90px;padding:8px;border:1px solid #ddd;border-radius:8px;background:#f8f8fa;cursor:pointer;font-size:0.78rem;color:#555;text-align:center;">
                            📦 ZIP / RAR
                            <input type="file" id="orb-imp-l2d-zip" accept=".zip,.rar" style="display:none;">
                        </label>
                        <label style="flex:1;min-width:90px;padding:8px;border:1px solid #ddd;border-radius:8px;background:#f8f8fa;cursor:pointer;font-size:0.78rem;color:#555;text-align:center;">
                            📄 PMX
                            <input type="file" id="orb-imp-pmx" accept=".pmx,.pmd" style="display:none;">
                        </label>
                        <label style="flex:1;min-width:90px;padding:8px;border:1px solid #6a4c93;border-radius:8px;background:#f3f0f8;cursor:pointer;font-size:0.78rem;color:#6a4c93;text-align:center;font-weight:600;">
                            ✨ 3D模型
                            <input type="file" id="orb-imp-vrm" accept=".vrm,.glb,.gltf,.fbx" style="display:none;">
                        </label>
                        <label style="flex:1;min-width:90px;padding:8px;border:1px solid #ddd;border-radius:8px;background:#f8f8fa;cursor:pointer;font-size:0.78rem;color:#555;text-align:center;">
                            📂 文件夹
                            <input type="file" id="orb-imp-folder" webkitdirectory directory style="display:none;">
                        </label>
                    </div>
                    <div id="orb-imp-file-name" style="font-size:0.72rem;color:#888;margin-top:4px;min-height:1.2em;word-break:break-all;"></div>
                    <div style="font-size:0.7rem;color:#aaa;margin-top:3px;">支持 VRM / GLB / GLTF / FBX（VRM/FBX 自动转 GLB）；ZIP 自动识别 Live2D/MMD；.max 需先用 3ds Max 导出 FBX</div>
                    <details style="margin-top:8px;">
                        <summary style="font-size:0.75rem;color:#888;cursor:pointer;">高级：通过 URL 添加</summary>
                        <input type="text" id="orb-imp-l2d-url" placeholder="model3.json 的 URL" style="width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.8rem;margin-top:6px;box-sizing:border-box;">
                        <input type="text" id="orb-imp-l2d-core" placeholder="Cubism Core URL（可选，默认 CDN）" style="width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.78rem;margin-top:6px;box-sizing:border-box;">
                    </details>
                    <div style="font-size:0.7rem;color:#aaa;margin-top:3px;">Live2D Cubism Core 受 Live2D 许可协议约束</div>
                </div>
                <button id="orb-imp-save" style="width:100%;padding:8px;background:#6a4c93;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;margin-top:8px;">导入</button>
                <div id="orb-imp-status" style="font-size:0.75rem;color:#6a4c93;margin-top:6px;text-align:center;display:none;"></div>
            </div>`;
        document.body.appendChild(overlay);

        const setStatus = (msg, isError) => {
            const st = overlay.querySelector('#orb-imp-status');
            st.textContent = msg;
            st.style.color = isError ? '#e74c3c' : '#6a4c93';
            st.style.display = 'block';
        };

        overlay.querySelector('#orb-imp-close').onclick = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        // 显示选中的文件名
        const fileNameEl = overlay.querySelector('#orb-imp-file-name');
        const updateFileName = () => {
            const z = overlay.querySelector('#orb-imp-l2d-zip').files[0];
            const p = overlay.querySelector('#orb-imp-pmx').files[0];
            const v = overlay.querySelector('#orb-imp-vrm').files[0];
            const f = overlay.querySelector('#orb-imp-folder').files;
            const img = overlay.querySelector('#orb-imp-image').files[0];
            if (img) fileNameEl.textContent = '已选: ' + img.name + '（2D图片）';
            else if (z) fileNameEl.textContent = '已选: ' + z.name;
            else if (v) fileNameEl.textContent = '已选: ' + v.name + '（VRM）';
            else if (p) fileNameEl.textContent = '已选: ' + p.name + '（单文件无贴图）';
            else if (f && f.length) fileNameEl.textContent = '已选文件夹: ' + f.length + ' 个文件';
            else fileNameEl.textContent = '';
        };
        overlay.querySelector('#orb-imp-l2d-zip').addEventListener('change', updateFileName);
        overlay.querySelector('#orb-imp-pmx').addEventListener('change', updateFileName);
        overlay.querySelector('#orb-imp-vrm').addEventListener('change', updateFileName);
        overlay.querySelector('#orb-imp-folder').addEventListener('change', updateFileName);
        overlay.querySelector('#orb-imp-image').addEventListener('change', updateFileName);

        overlay.querySelector('#orb-imp-save').onclick = () => {
            const svgFile = overlay.querySelector('#orb-imp-svg').files[0];
            const imageFile = overlay.querySelector('#orb-imp-image').files[0];
            const l2dZip = overlay.querySelector('#orb-imp-l2d-zip').files[0];
            const pmxFile = overlay.querySelector('#orb-imp-pmx').files[0];
            const vrmFile = overlay.querySelector('#orb-imp-vrm').files[0];
            const folderFiles = overlay.querySelector('#orb-imp-folder').files;
            const l2dUrl = overlay.querySelector('#orb-imp-l2d-url').value.trim();
            const l2dCore = overlay.querySelector('#orb-imp-l2d-core').value.trim();
            const saveBtn = overlay.querySelector('#orb-imp-save');
            if (svgFile) {
                saveBtn.disabled = true; setStatus('正在上传 SVG...');
                const formData = new FormData();
                formData.append('file', svgFile);
                formData.append('name', svgFile.name.replace(/\.svg$/i, ''));
                fetch('/api/orb/skins/upload', { method: 'POST', body: formData })
                    .then(r => r.json()).then(d => {
                        if (d.success) { this.scanCustomSkins(); overlay.remove(); }
                        else { saveBtn.disabled = false; setStatus('上传失败: ' + (d.error || ''), true); }
                    }).catch(err => { saveBtn.disabled = false; setStatus('上传失败: ' + err.message, true); });
            } else if (imageFile) {
                saveBtn.disabled = true; setStatus('正在上传 2D 图片...');
                const formData = new FormData();
                formData.append('file', imageFile);
                formData.append('name', imageFile.name.replace(/\.(png|jpg|jpeg|webp|gif)$/i, ''));
                fetch('/api/orb/skins/image_upload', { method: 'POST', body: formData })
                    .then(r => r.json()).then(d => {
                        if (d.success) { this.scanCustomSkins(); this.apply(d.id); overlay.remove(); }
                        else { saveBtn.disabled = false; setStatus('上传失败: ' + (d.error || ''), true); }
                    }).catch(err => { saveBtn.disabled = false; setStatus('上传失败: ' + err.message, true); });
            } else if (l2dZip) {
                saveBtn.disabled = true; setStatus('正在上传并解压模型包...');
                const formData = new FormData();
                formData.append('file', l2dZip);
                formData.append('name', l2dZip.name.replace(/\.zip$/i, ''));
                fetch('/api/orb/skins/live2d/upload', { method: 'POST', body: formData })
                    .then(r => r.json()).then(d => {
                        if (d.success) {
                            if (d.warning) {
                                setStatus(d.warning, true);
                                saveBtn.disabled = false;
                                return;
                            }
                            if (d.type === 'gltf') {
                                saveBtn.disabled = false;
                                setStatus('这是场景文件，请通过「🏞️ 背景板」按钮上传', true);
                                return;
                            }
                            if (d.type === 'mmd' && d.all_models && d.all_models.length > 1) {
                                this._showModelPicker(overlay, d, saveBtn, setStatus);
                            } else {
                                this.scanCustomSkins(); this.apply(d.id); overlay.remove();
                            }
                        }
                        else { saveBtn.disabled = false; setStatus('上传失败: ' + (d.error || ''), true); }
                    }).catch(err => { saveBtn.disabled = false; setStatus('上传失败: ' + err.message, true); });
            } else if (vrmFile) {
                if (!/\.(vrm|glb|gltf|fbx)$/i.test(vrmFile.name)) {
                    setStatus('请选择 .vrm / .glb / .gltf / .fbx 文件', true); return;
                }
                saveBtn.disabled = true;
                const isVrm = /\.vrm$/i.test(vrmFile.name);
                const isFbx = /\.fbx$/i.test(vrmFile.name);
                const needsConvert = isVrm || isFbx;
                setStatus(needsConvert ? `正在转换${isFbx ? ' FBX' : ' VRM'} 模型（约10-30秒）...` : '正在上传 GLB 模型...');
                const formData = new FormData();
                formData.append('file', vrmFile);
                formData.append('name', vrmFile.name.replace(/\.(vrm|glb|gltf|fbx)$/i, ''));
                let endpoint;
                if (isVrm) endpoint = '/api/orb/skins/vrm_to_glb';
                else if (isFbx) endpoint = '/api/orb/skins/fbx_to_glb';
                else endpoint = '/api/orb/skins/gltf_upload';
                fetch(endpoint, { method: 'POST', body: formData })
                    .then(r => r.json()).then(d => {
                        if (d.success) {
                            // 后端返回 type='glb'/'gltf'，注册为 world3d 皮肤
                            const skinId = d.skin_id || ('glb_' + Date.now());
                            const skin = {
                                id: skinId,
                                name: vrmFile.name.replace(/\.[^.]+$/, ''),
                                type: 'glb',
                                model_url: d.model_url
                            };
                            if (!this.customSkins) this.customSkins = [];
                            this.customSkins = this.customSkins.filter(s => s.id !== skinId);
                            this.customSkins.push(skin);
                            this.apply(skin);
                            overlay.remove();
                        } else { saveBtn.disabled = false; setStatus('上传失败: ' + (d.error || ''), true); }
                    }).catch(err => { saveBtn.disabled = false; setStatus('上传失败: ' + err.message, true); });
            } else if (pmxFile) {
                saveBtn.disabled = true; setStatus('正在上传 PMX 文件...');
                const formData = new FormData();
                formData.append('file', pmxFile);
                formData.append('name', pmxFile.name.replace(/\.(pmx|pmd)$/i, ''));
                fetch('/api/orb/skins/pmx_upload', { method: 'POST', body: formData })
                    .then(r => r.json()).then(d => {
                        if (d.success) { this.scanCustomSkins(); this.apply(d.id); overlay.remove(); }
                        else { saveBtn.disabled = false; setStatus('上传失败: ' + (d.error || ''), true); }
                    }).catch(err => { saveBtn.disabled = false; setStatus('上传失败: ' + err.message, true); });
            } else if (folderFiles && folderFiles.length > 0) {
                saveBtn.disabled = true; setStatus('正在上传文件夹 (' + folderFiles.length + ' 个文件)...');
                const formData = new FormData();
                const folderName = folderFiles[0].webkitRelativePath.split('/')[0] || 'model';
                formData.append('name', folderName);
                for (let i = 0; i < folderFiles.length; i++) {
                    const f = folderFiles[i];
                    const relPath = f.webkitRelativePath.substring(folderName.length + 1);
                    formData.append('files', f, relPath);
                }
                fetch('/api/orb/skins/folder_upload', { method: 'POST', body: formData })
                    .then(r => r.json()).then(d => {
                        if (d.success) {
                            if (d.type === 'mmd' && d.all_models && d.all_models.length > 1) {
                                this._showModelPicker(overlay, d, saveBtn, setStatus);
                            } else {
                                this.scanCustomSkins(); this.apply(d.id); overlay.remove();
                            }
                        }
                        else { saveBtn.disabled = false; setStatus('上传失败: ' + (d.error || ''), true); }
                    }).catch(err => { saveBtn.disabled = false; setStatus('上传失败: ' + err.message, true); });
            } else if (l2dUrl) {
                saveBtn.disabled = true; setStatus('正在添加 Live2D URL...');
                fetch('/api/orb/skins/live2d', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model_url: l2dUrl, core_url: l2dCore, name: 'Live2D' })
                }).then(r => r.json()).then(d => {
                    if (d.success) { this.scanCustomSkins(); overlay.remove(); }
                    else { saveBtn.disabled = false; setStatus('添加失败: ' + (d.error || ''), true); }
                }).catch(err => { saveBtn.disabled = false; setStatus('添加失败: ' + err.message, true); });
            } else {
                setStatus('请选择 SVG / 2D图片 / 模型文件', true);
            }
        };
    };

    // 背景板选择：上传 ZIP/RAR 包含的 PMX 作为场景背景
    /** 设置背景板后立即应用（无需重载模型） */
    OrbSkins.prototype._applyStageNow = function(stageUrl, stageType) {
        if (!window.World3D || !window.World3D.loadStage) return;
        // 全景图是 CSS 背景，任何模型类型都能立即生效
        if (stageType === 'panorama' || !stageUrl) {
            if (stageUrl) {
                window.World3D.loadStage(stageUrl, 'panorama').then(() => {
                    const orb = document.getElementById('orb');
                    if (orb) orb.classList.add('has-stage');
                }).catch(() => {});
            } else {
                window.World3D.clearStage();
                const orb = document.getElementById('orb');
                if (orb) orb.classList.remove('has-stage');
            }
        } else if (this.currentType === 'glb' || this.currentType === 'vrm') {
            window.World3D.loadStage(stageUrl, stageType).then(() => {
                const orb = document.getElementById('orb');
                if (orb) orb.classList.add('has-stage');
            }).catch(() => {});
        } else if (this.currentType === 'mmd') {
            this.apply(this.currentSkin);
        }
    };

    OrbSkins.prototype.openStagePicker = function() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:100000;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#fff;border-radius:14px;padding:20px;width:380px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                    <span style="font-size:1rem;font-weight:600;color:#333;">🏞️ 背景板设置</span>
                    <button id="stage-close" style="border:none;background:none;font-size:1.1rem;cursor:pointer;color:#999;">✕</button>
                </div>
                <div style="font-size:0.8rem;color:#666;line-height:1.6;margin-bottom:12px;">
                    上传背景板。支持：图片（.jpg/.png，直接作为全屏背景）、Blender 场景（.blend，可渲染全景图或转 glTF 3D 场景）、glTF（.glb/.gltf，实时 3D 背景）。
                </div>
                <input type="file" id="stage-file" style="width:100%;font-size:0.8rem;margin-bottom:10px;">
                <div id="stage-blend-opt" style="display:block;margin-bottom:10px;font-size:0.78rem;color:#666;padding:8px;background:#f9f5fc;border-radius:6px;">
                    <div style="margin-bottom:4px;color:#6a4c93;font-weight:600;">Blender 场景处理方式（选择 .blend 文件后生效）：</div>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                        <input type="radio" name="blend-mode" value="panorama" checked> 渲染全景图（推荐，轻量快速）
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:4px;">
                        <input type="radio" name="blend-mode" value="gltf"> 转换为 glTF（实时 3D，文件较大）
                    </label>
                </div>
                <div id="stage-existing" style="margin-bottom:10px;">
                    <div style="font-size:0.78rem;color:#666;margin-bottom:4px;">已渲染的全景图（点击直接使用）：</div>
                    <div id="stage-pano-list" style="display:flex;gap:6px;flex-wrap:wrap;font-size:0.75rem;color:#999;">加载中...</div>
                </div>
                <button id="stage-upload" style="width:100%;padding:8px;background:#6a4c93;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;">上传背景板</button>
                <button id="stage-clear" style="width:100%;padding:8px;margin-top:6px;background:#f0f0f0;color:#666;border:1px solid #ddd;border-radius:8px;cursor:pointer;font-size:0.82rem;">清除背景板</button>
                <div id="stage-status" style="font-size:0.75rem;color:#6a4c93;margin-top:8px;text-align:center;"></div>
            </div>`;
        document.body.appendChild(overlay);
        const setStatus = (msg, err) => {
            const st = overlay.querySelector('#stage-status');
            st.textContent = msg;
            st.style.color = err ? '#e74c3c' : '#6a4c93';
        };
        overlay.querySelector('#stage-close').onclick = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        // 加载已渲染的全景图列表
        fetch('/api/orb/skins/panoramas').then(r => r.json()).then(d => {
            const list = overlay.querySelector('#stage-pano-list');
            if (!d.panoramas || !d.panoramas.length) {
                list.innerHTML = '<span style="color:#bbb;">暂无</span>';
                return;
            }
            list.innerHTML = '';
            d.panoramas.forEach(p => {
                const btn = document.createElement('button');
                btn.style.cssText = 'padding:4px 8px;background:#f0f0f0;border:1px solid #ddd;border-radius:6px;cursor:pointer;font-size:0.72rem;color:#6a4c93;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                btn.textContent = p.id.replace(/^pano_/, '').replace(/_\d+$/, '').slice(0, 20);
                btn.title = p.id;
                btn.onclick = () => {
                    localStorage.setItem('mrhua_orb_stage_' + this.getIdentityKey(), p.url);
                    localStorage.setItem('mrhua_orb_stage_type_' + this.getIdentityKey(), 'panorama');
                    this._applyStageNow(p.url, 'panorama');
                    setStatus('全景图背景板已应用');
                    this.renderSelector();
                    setTimeout(() => overlay.remove(), 600);
                };
                list.appendChild(btn);
            });
        }).catch(() => {
            const list = overlay.querySelector('#stage-pano-list');
            if (list) list.innerHTML = '<span style="color:#bbb;">加载失败</span>';
        });

        // 文件选择后提示
        overlay.querySelector('#stage-file').addEventListener('change', (e) => {
            const f = e.target.files[0];
            const opt = overlay.querySelector('#stage-blend-opt');
            if (f) opt.style.opacity = f.name.toLowerCase().endsWith('.blend') ? '1' : '0.5';
        });

        overlay.querySelector('#stage-upload').onclick = () => {
            const file = overlay.querySelector('#stage-file').files[0];
            if (!file) { setStatus('请先选择文件', true); return; }
            const isBlend = file.name.toLowerCase().endsWith('.blend');
            const isGltf = /\.(glb|gltf)$/i.test(file.name);
            const isImage = /\.(jpg|jpeg|png|hdr)$/i.test(file.name);
            if (!isBlend && !isGltf && !isImage) { setStatus('支持 .jpg/.png/.blend/.glb/.gltf 格式', true); return; }

            const fd = new FormData();
            fd.append('file', file);
            fd.append('name', 'stage_' + file.name.replace(/\.[^.]+$/, ''));

            if (isImage) {
                // 全景图直接上传到 gltf_upload 端点保存
                setStatus('正在上传全景图...');
                fetch('/api/orb/skins/gltf_upload', { method: 'POST', body: fd })
                    .then(r => r.json()).then(d => {
                        if (d.success) {
                            localStorage.setItem('mrhua_orb_stage_' + this.getIdentityKey(), d.model_url);
                            localStorage.setItem('mrhua_orb_stage_type_' + this.getIdentityKey(), 'panorama');
                            setStatus('背景板设置成功');
                            this.renderSelector();
                            setTimeout(() => overlay.remove(), 800);
                            this._applyStageNow(d.model_url, 'panorama');
                        } else {
                            setStatus('上传失败: ' + (d.error || ''), true);
                        }
                    }).catch(err => setStatus('上传失败: ' + err.message, true));
            } else if (isBlend) {
                const blendMode = overlay.querySelector('input[name="blend-mode"]:checked').value;
                if (blendMode === 'panorama') {
                    setStatus('正在用 Blender 渲染全景图，可能需要几十秒...');
                    // 按屏幕分辨率请求（2:1 全景比例）
                    const sw = window.screen.width || 1920;
                    const sh = window.screen.height || 1080;
                    const panoW = Math.min(4096, Math.max(1024, sw));
                    const panoH = Math.round(panoW / 2);
                    fd.append('width', panoW);
                    fd.append('height', panoH);
                    fetch('/api/orb/skins/blender_panorama', { method: 'POST', body: fd })
                        .then(r => r.json()).then(d => {
                            if (d.success) {
                                localStorage.setItem('mrhua_orb_stage_' + this.getIdentityKey(), d.pano_url);
                                localStorage.setItem('mrhua_orb_stage_type_' + this.getIdentityKey(), 'panorama');
                                setStatus('全景图背景板设置成功');
                                this.renderSelector();
                                setTimeout(() => overlay.remove(), 800);
                                this._applyStageNow(d.pano_url, 'panorama');
                            } else {
                                setStatus('渲染失败: ' + (d.error || ''), true);
                            }
                        }).catch(err => setStatus('渲染失败: ' + err.message, true));
                } else {
                    setStatus('正在用 Blender 转换，可能需要几十秒...');
                    fetch('/api/orb/skins/blender_convert', { method: 'POST', body: fd })
                        .then(r => r.json()).then(d => {
                            if (d.success) {
                                localStorage.setItem('mrhua_orb_stage_' + this.getIdentityKey(), d.model_url);
                                localStorage.setItem('mrhua_orb_stage_type_' + this.getIdentityKey(), d.type || 'gltf');
                                setStatus('背景板设置成功');
                                this.renderSelector();
                                setTimeout(() => overlay.remove(), 800);
                                this._applyStageNow(d.model_url, d.type || 'gltf');
                            } else {
                                setStatus('转换失败: ' + (d.error || ''), true);
                            }
                        }).catch(err => setStatus('转换失败: ' + err.message, true));
                }
            } else if (isGltf) {
                // 直接上传 glb/gltf 到 live2d/upload 端点（它会保存文件但找不到模型文件）
                // 改用专门的处理：直接 FormData 上传到一个通用端点
                setStatus('正在上传 glTF...');
                fd.append('name', 'stage_gltf');
                fetch('/api/orb/skins/gltf_upload', { method: 'POST', body: fd })
                    .then(r => r.json()).then(d => {
                        if (d.success) {
                            localStorage.setItem('mrhua_orb_stage_' + this.getIdentityKey(), d.model_url);
                            localStorage.setItem('mrhua_orb_stage_type_' + this.getIdentityKey(), 'gltf');
                            setStatus('背景板设置成功');
                            this.renderSelector();
                            setTimeout(() => overlay.remove(), 800);
                            this._applyStageNow(d.model_url, 'gltf');
                        } else {
                            setStatus('上传失败: ' + (d.error || ''), true);
                        }
                    }).catch(err => setStatus('上传失败: ' + err.message, true));
            }
        };
        overlay.querySelector('#stage-clear').onclick = () => {
            localStorage.removeItem('mrhua_orb_stage_' + this.getIdentityKey());
            localStorage.removeItem('mrhua_orb_stage_type_' + this.getIdentityKey());
            this._clearFullscreenStage();
            if (window.World3D) window.World3D.clearStage();
            const orbEl = document.getElementById('orb');
            if (orbEl) orbEl.classList.remove('has-stage');
            setStatus('已清除');
            this.renderSelector();
            if (this.currentType === 'mmd') this.apply(this.currentSkin);
            setTimeout(() => overlay.remove(), 600);
        };
    };

    // ZIP 中有多个 MMD 模型时，让用户选择
    OrbSkins.prototype._showModelPicker = function(overlay, d, saveBtn, setStatus) {
        const box = overlay.querySelector('#orb-imp-picker');
        if (box) box.remove();
        const picker = document.createElement('div');
        picker.id = 'orb-imp-picker';
        picker.style.cssText = 'margin-top:12px;border-top:1px solid #eee;padding-top:12px;background:#fff;';
        const title = document.createElement('div');
        title.style.cssText = 'font-size:0.82rem;color:#555;font-weight:600;margin-bottom:8px;';
        title.textContent = 'ZIP 中有 ' + d.all_models.length + ' 个模型，选择一个：';
        picker.appendChild(title);
        d.all_models.forEach((m, i) => {
            const fname = m.split('/').pop().split('\\').pop();
            const btn = document.createElement('button');
            btn.textContent = (i === 0 ? '● ' : '○ ') + fname;
            btn.dataset.model = m;
            btn.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 12px;margin-bottom:6px;border:1px solid #ddd;border-radius:8px;background:#f8f8fa;cursor:pointer;font-size:0.8rem;color:#333;font-family:inherit;transition:all 0.15s;';
            btn.onmouseenter = () => { btn.style.background = '#f3e5f5'; btn.style.borderColor = '#6a4c93'; };
            btn.onmouseleave = () => { btn.style.background = '#f8f8fa'; btn.style.borderColor = '#ddd'; };
            btn.onclick = () => {
                picker.querySelectorAll('button').forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });
                btn.style.opacity = '1';
                btn.style.background = '#e8d5f5';
                setStatus('正在切换模型...');
                fetch('/api/orb/skins/select_model', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ skin_dir: d.skin_dir, model: m })
                }).then(r => r.json()).then(r => {
                    if (r.success) { this.scanCustomSkins(); this.apply(d.id); overlay.remove(); }
                    else { picker.querySelectorAll('button').forEach(b => { b.disabled = false; b.style.opacity = '1'; }); setStatus('切换失败: ' + (r.error || ''), true); }
                }).catch(err => { picker.querySelectorAll('button').forEach(b => { b.disabled = false; b.style.opacity = '1'; }); setStatus('切换失败: ' + err.message, true); });
            };
            picker.appendChild(btn);
        });
        saveBtn.parentNode.insertBefore(picker, saveBtn);
        saveBtn.style.display = 'none';
        // 添加取消按钮
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '取消（使用第一个）';
        cancelBtn.style.cssText = 'width:100%;padding:8px;background:#f0f0f0;color:#666;border:1px solid #ddd;border-radius:8px;cursor:pointer;font-size:0.82rem;margin-top:6px;font-family:inherit;';
        cancelBtn.onclick = () => { this.scanCustomSkins(); this.apply(d.id); overlay.remove(); };
        picker.appendChild(cancelBtn);
        // 滚动到选择区域
        setTimeout(() => picker.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    };

    // ============ Live2D ============
    // WebGL 能力探测：Live2D 链路（PIXI 6.x 与自研渲染器）都强依赖 webgl 上下文，
    // 拿不到上下文时 PIXI 会在创建 Application 时抛 "WebGL unsupported" 且没有 canvas 回退。
    OrbSkins.prototype._hasWebGL = function() {
        if (this._webglSupport !== undefined) return this._webglSupport;
        var ok = false;
        try {
            var c = document.createElement('canvas');
            var attrs = { alpha: true, premultipliedAlpha: false, antialias: true,
                          preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: false };
            var gl = c.getContext('webgl2', attrs) || c.getContext('webgl', attrs)
                     || c.getContext('experimental-webgl', attrs);
            if (gl) {
                // 有的机器上上下文“创建成功但已丢失/随即丢失”，只看 getContext 非空会误判为可用
                var lostEarly = false, selfLoss = false;
                c.addEventListener('webglcontextlost', function(){ if (!selfLoss) lostEarly = true; }, false);
                ok = (typeof gl.isContextLost === 'function') ? !gl.isContextLost() : true;
                var lose = gl.getExtension('WEBGL_lose_context');
                if (lose) { selfLoss = true; lose.loseContext(); }   // 探针用完即弃，主动释放
                ok = ok && !lostEarly;
            }
        } catch(e) { ok = false; }
        this._webglSupport = ok;
        return ok;
    };

    // Live2D 失败统一出口：控制台留痕 + 灵体球内可见提示（避免只剩一块空白画布）。
    // 只做显示层回退：把 orb 的皮肤类换回默认光球，让球体本身仍有内容；
    // 绝不写回 localStorage / 皮肤配置（不调用 saveSkin），用户已保存的选择保持不变。
    OrbSkins.prototype._live2dFail = function(msg) {
        console.error('[OrbSkins] ' + String(msg).replace(/\n/g, ' / '));
        var orb = document.getElementById('orb');
        if (orb && orb.classList.contains('skin-live2d')) {
            orb.classList.remove('skin-live2d', 'skin-svg', 'skin-mmd');
            orb.classList.add('skin-blob');
        }
        this._mmdShowStatus(msg);
    };

    OrbSkins.prototype.loadLive2D = function(skin) {
        const self = this;
        // 没有 WebGL 就没有任何可用的 Live2D 渲染路径（PIXI 6.x 无 canvas 回退，
        // 自研 OrbLive2DRenderer 同样取 webgl 上下文）。此处直接可见化失败：
        // 否则会先白拉三个 CDN 脚本，再在空白画布上抛错，用户只看到灵体球变空。
        if (!this._hasWebGL()) {
            this._mmdProgress(0, '错误', '环境不支持 WebGL');
            this._live2dFail('无法显示 Live2D 模型\n当前环境不支持 WebGL\n请改用其它皮肤，或开启硬件加速后重试');
            return;
        }
        this._mmdShowStatus('正在加载 Live2D 引擎...');
        // 三方库开关检查：PIXI.js和pixi-live2d-display需要联网
        if (!_isThirdPartyAllowed()) {
            console.warn('[OrbSkins] 三方库已禁用，尝试使用自研Live2D渲染器');
            this._mmdProgress(10, '引擎', '三方库禁用，尝试自研渲染器');
            // 尝试使用自研的OrbLive2DRenderer（只需要本地Cubism Core，不需要PIXI.js）
            // initLive2DNative 在本文件里没有实现，直接调用会抛 TypeError：
            // 必须同时确认渲染器对象与入口方法都在，否则走可见化失败分支。
            if (typeof window.OrbLive2DRenderer !== 'undefined'
                && typeof this.initLive2DNative === 'function') {
                this._mmdProgress(20, '引擎', '自研Live2D渲染器就绪');
                this.initLive2DNative(skin);
                return;
            } else {
                this._mmdProgress(0, '错误', '无可用Live2D渲染器');
                this._live2dFail('Live2D引擎加载失败\n' + (typeof window.OrbLive2DRenderer === 'undefined'
                    ? '三方库已禁用且自研渲染器未加载'
                    : '三方库已禁用且自研渲染器接口不可用'));
                return;
            }
        }
        const cdnPixi = '/cdn-proxy/pixi.js@6.5.10/dist/browser/pixi.min.js';
        const cdnLive2D = '/cdn-proxy/pixi-live2d-display@0.3.1/dist/cubism4.min.js';
        const localCore = '/static/vendor/live2dcubismcore.min.js?v=20260827';

        // 0.3.1 cubism4 构建在加载时就检查 Cubism4 runtime，所以必须先加载 core
        const loadDisplayAndInit = () => {
            self._mmdShowStatus('正在加载 Live2D 加载器...');
            self.loadScript(cdnLive2D, () => {
                if (window.PIXI && window.PIXI.live2d) {
                    self._mmdShowStatus('');
                    self.initLive2D(skin);
                } else {
                    self.characterEl.innerHTML = '<div style="color:#999;font-size:10px;text-align:center;padding-top:40px;">Live2D加载器失败</div>';
                }
            });
        };

        const loadCore = () => {
            self._mmdShowStatus('正在加载 Cubism Core...');
            if (window.Live2DCubismCore) {
                loadDisplayAndInit();
            } else {
                self.loadScript(localCore, () => {
                    if (window.Live2DCubismCore) loadDisplayAndInit();
                    else self.characterEl.innerHTML = '<div style="color:#999;font-size:10px;text-align:center;padding-top:40px;">Cubism Core 加载失败</div>';
                });
            }
        };

        if (!window.PIXI) {
            self._mmdShowStatus('正在加载 PIXI.js...');
            self.loadScript(cdnPixi, () => {
                loadCore();
            });
        } else {
            loadCore();
        }
    };

    OrbSkins.prototype.loadScript = function(src, cb) {
        const s = document.createElement('script');
        s.src = src;
        s.onload = cb;
        s.onerror = () => {
            this.characterEl.innerHTML = '<div style="color:#999;font-size:10px;text-align:center;padding-top:40px;">脚本加载失败<br>检查网络</div>';
        };
        document.head.appendChild(s);
    };

    // 多源 fallback 脚本加载：依次尝试多个URL，直到成功
    OrbSkins.prototype.loadScriptFallback = function(urls, cb, idx) {
        idx = idx || 0;
        if (idx >= urls.length) {
            console.error('[OrbSkins] 所有脚本源都加载失败:', urls);
            this.characterEl.innerHTML = '<div style="color:#999;font-size:10px;text-align:center;padding-top:40px;">脚本加载失败<br>所有源均不可用</div>';
            return;
        }
        const s = document.createElement('script');
        s.src = urls[idx];
        s.onload = () => { console.log('[OrbSkins] 脚本加载成功:', urls[idx]); cb(); };
        s.onerror = () => {
            console.warn('[OrbSkins] 脚本加载失败，尝试下一个源:', urls[idx]);
            this.loadScriptFallback(urls, cb, idx + 1);
        };
        document.head.appendChild(s);
    };

    OrbSkins.prototype.initLive2D = function(skin) {
        if (!window.PIXI || !window.PIXI.live2d) {
            this._live2dFail('Live2D 加载器不可用\n请检查网络后重试');
            return;
        }
        const self = this;
        const canvas = document.createElement('canvas');
        // 固定大尺寸，不依赖小容器；居中显示
        const W = 420, H = 520; // 增宽到420，避免左右剪裁
        canvas.style.cssText = 'width:' + W + 'px;height:' + H + 'px;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);';
        this.characterEl.innerHTML = '';
        this.characterEl.style.overflow = 'visible';
        const orbEl = document.getElementById('orb');
        const orbStageEl = document.getElementById('orb-stage');
        if (orbEl) orbEl.style.overflow = 'visible';
        if (orbStageEl) orbStageEl.style.overflow = 'visible';
        this.characterEl.appendChild(canvas);

        try {
            this.live2dApp = new PIXI.Application({
                view: canvas, transparent: true, autoStart: true,
                width: W, height: H, resolution: window.devicePixelRatio || 1, antialias: true
            });
            PIXI.live2d.Live2DModel.from(skin.model_url).then(model => {
                this.live2dModel = model;
                this.live2dApp.stage.addChild(model);
                // 模型高度占画布的80%
                // 按宽度和高度都适配，取较小值，避免左右或上下剪裁
                const scaleX = (W * 0.85) / model.width;
                const scaleY = (H * 0.8) / model.height;
                const scale = Math.min(scaleX, scaleY);
                model.scale.set(scale);
                model.anchor.set(0.5, 0.5);
                model.x = W / 2;
                model.y = H / 2 + H * 0.05;
                console.log('[OrbSkins] Live2D model:', model.width.toFixed(0)+'x'+model.height.toFixed(0), 'scale:', scale.toFixed(3));
                this._mmdShowStatus('');
                this.playLive2DMotion(this.state);
            }).catch(err => {
                console.error('[OrbSkins] Live2D模型加载失败:', err);
                this.characterEl.innerHTML = '<div style="color:#999;font-size:9px;text-align:center;padding-top:35px;">模型加载失败<br>' + (err.message || err) + '</div>';
            });
        } catch(e) {
            console.error('[OrbSkins] Live2D初始化失败:', e);
            // PIXI 6.x 拿不到 webgl 上下文时在这里抛错；画布已经插入，必须清掉并给出可见提示
            this.characterEl.innerHTML = '';
            if (/webgl/i.test((e && e.message) || '')) {
                this._live2dFail('无法显示 Live2D 模型\n当前环境不支持 WebGL\n请改用其它皮肤，或开启硬件加速后重试');
            } else {
                this._live2dFail('Live2D 初始化失败\n' + ((e && e.message) || e));
            }
        }
    };

    OrbSkins.prototype.playLive2DMotion = function(state) {
        if (!this.live2dModel || !this.live2dModel.internalModel) return;
        const mm = this.live2dModel.internalModel.motionManager;
        if (!mm) return;
        const motionMap = {
            thinking: 'TapBody', working: 'Flick', scanning: 'Flick',
            success: 'TapBody', complete: 'TapBody', happy: 'TapBody',
            error: 'Shake', alert: 'Flick', sleeping: 'Idle', '': 'Idle'
        };
        const group = motionMap[state] || 'Idle';
        try {
            if (state === 'happy' || state === 'success' || state === 'complete')
                mm.expressionManager && mm.expressionManager.setRandomExpression();
            mm.startMotion(group, 0, group === 'Idle' ? 2 : 0);
        } catch(e) {}
    };

    OrbSkins.prototype.destroyLive2D = function() {
        if (this.live2dApp) {
            try { this.live2dApp.destroy(true, { children: true, texture: true, baseTexture: true }); } catch(e) {}
            this.live2dApp = null;
        if (this.characterEl) this.characterEl.style.overflow = '';
        const orbEl2 = document.getElementById('orb');
        const orbStageEl2 = document.getElementById('orb-stage');
        if (orbEl2) orbEl2.style.overflow = '';
        if (orbStageEl2) orbStageEl2.style.overflow = '';
            this.live2dModel = null;
        }
    };

    // ============ 3D 模型加载（MMD PMX/PMD + VRM） ============
    OrbSkins.prototype.loadMMD = function(skin) {
        const self = this;
        console.log('[OrbSkins.loadMMD] 入口 skin=' + (skin.name||skin.id) + ' MrHuaRenderer=' + !!window.MrHuaRenderer + ' _mmdModule=' + !!this._mmdModule);
        // VRM 格式走专用管线
        if (skin.model_url && /\.vrm(\?|$)/i.test(skin.model_url)) {
            return this.loadVRM(skin);
        }

        // 防重复加载：如果正在加载同一个模型，直接返回
        if (this._mmdLoadingSkinId === skin.id && this._mmdIsLoading) {
            console.log('[OrbSkins] 模型已在加载中，跳过重复加载:', skin.name);
            return;
        }
        this._mmdLoadingSkinId = skin.id;
        this._mmdIsLoading = true;

        // 强制使用自研渲染器（测试模式）
        if (window.MrHuaRenderer) {
            console.log('[OrbSkins] 使用three.js MMD加载器（自研渲染器材质有bug，临时切换）');
            this._mmdShowStatus('three.js加载中...');
            this._mmdProgress(15, '引擎', 'three.js WebGL');
            // 先加载three.js模块，加载成功后再调用initMMD
            const self = this;
            const _origWarn = console.warn;
            console.warn = function(){};
            if (!_isThirdPartyAllowed()) {
                console.warn = _origWarn;
                console.warn('[OrbSkins] 三方库已禁用，回退自研渲染器');
                self._mmdProgress(10, '引擎', '三方库禁用，回退自研');
                if (window.MrHuaRenderer) {
                    self._mmdProgress(20, '引擎', '自研渲染器就绪');
                    self.initMMDNative(skin);
                } else {
                    self._mmdProgress(0, '错误', '无可用渲染器');
                    self._mmdShowStatus('3D引擎加载失败\n三方库已禁用且自研渲染器未加载');
                }
                return;
            }
            const loadPromise = window._mmdModulePromise || (window._mmdModulePromise = Promise.all([
                import('three'),
                import('three/addons/loaders/MMDLoader.js'),
                import('three/addons/loaders/GLTFLoader.js'),
                import('@pixiv/three-vrm')
            ]).then(([THREE, mmd, gltf, vrmMod]) => {
                console.warn = _origWarn;
                window.THREE = THREE;
                return { THREE, MMDLoader: mmd.MMDLoader, GLTFLoader: gltf.GLTFLoader, VRMLoaderPlugin: vrmMod.VRMLoaderPlugin, VRM: vrmMod.VRM };
            }).catch(err => {
                console.warn = _origWarn;
                window._mmdModulePromise = null;
                throw err;
            }));
            loadPromise.then((mods) => {
                self._mmdProgress(20, '引擎', '模块就绪');
                self._mmdModule = mods;
                self.initMMD(skin);
            }).catch(err => {
                console.warn('[OrbSkins] CDN引擎加载失败:', err.message);
                self._mmdProgress(0, '错误', 'CDN加载失败');
                self._mmdShowStatus('3D引擎加载失败\n' + err.message);
            });
            return;
        }

        // 自研渲染器未加载，动态加载 orb_renderer.js
        if (!window._orbRendererLoading) {
            window._orbRendererLoading = true;
            console.log('[OrbSkins] 自研渲染器未就绪，动态加载 orb_renderer.js...');
            const script = document.createElement('script');
            script.src = '/static/orb_renderer.js?v=dynamic_' + Date.now();
            script.onload = () => {
                console.log('[OrbSkins] orb_renderer.js 动态加载完成, MrHuaRenderer=' + !!window.MrHuaRenderer);
                window._orbRendererLoading = false;
                if (window.MrHuaRenderer) {
                    self._mmdIsLoading = false;
                    self._mmdLoadingSkinId = null;
                    self.loadMMD(skin);
                }
            };
            script.onerror = () => {
                console.error('[OrbSkins] orb_renderer.js 动态加载失败');
                window._orbRendererLoading = false;
            };
            document.head.appendChild(script);
        }
        // 等待动态加载完成（最多5秒）
        let waitCount = 0;
        const waitForNative = () => {
            if (window.MrHuaRenderer) {
                self._mmdIsLoading = false;
                self._mmdLoadingSkinId = null;
                self.loadMMD(skin);
            } else if (waitCount < 50) {
                waitCount++;
                setTimeout(waitForNative, 100);
            } else {
                console.warn('[OrbSkins] 自研渲染器等待超时，回退到 three.js 路径');
            }
        };
        waitForNative();

        // 如果自研渲染器已加载成功，waitForNative会重新调用loadMMD，这里跳过three.js路径
        if (window.MrHuaRenderer) {
            this._mmdIsLoading = false;
            this._mmdLoadingSkinId = null;
            return;
        }

        // 检查是否有预加载的模型
        const preloaded = this._getPreloadedModel(skin.id);
        if (preloaded && preloaded.type === 'mmd') {
            console.log('[OrbSkins] 使用预加载的MMD模型，直接初始化');
            this._mmdShowStatus('正在初始化模型...');
            this._mmdProgress(90, '初始化', '使用预加载模型');
            // 延迟一帧执行，确保UI更新
            setTimeout(() => {
                this.initMMD(skin, preloaded.mesh);
            }, 16);
            return;
        }

        // 如果模型正在预加载中，等待预加载完成
        if (this._preloadingModels && this._preloadingModels[skin.id]) {
            console.log('[OrbSkins] 模型正在预加载中，等待完成...');
            this._mmdShowStatus('正在加载模型...');
            this._mmdProgress(20, '等待', '预加载中');
            this._waitForPreload(skin.id, (result) => {
                if (result && result.type === 'mmd') {
                    console.log('[OrbSkins] 预加载完成，使用预加载模型');
                    this._mmdProgress(90, '初始化', '使用预加载模型');
                    setTimeout(() => {
                        this.initMMD(skin, result.mesh);
                    }, 16);
                } else {
                    // 预加载失败，重新加载
                    console.log('[OrbSkins] 预加载失败，重新加载模型');
                    this._mmdIsLoading = false;
                    this._mmdLoadingSkinId = null;
                    this.loadMMD(skin);
                }
            });
            return;
        }

        // 检查模块是否已经预加载完成
        if (this._mmdModule) {
            console.log('[OrbSkins] 3D引擎模块已预加载完成，直接加载模型');
            this._mmdShowStatus('正在加载模型...');
            this._mmdProgress(30, '模型', skin.name || 'MMD');
            this._mmdModule = this._mmdModule; // 确保模块可用
            this.initMMD(skin);
            return;
        }

        this._mmdShowStatus('正在加载 3D 引擎...');
        this._mmdProgress(5, '引擎', 'Three.js CDN');
        const _origWarn = console.warn;
        console.warn = function(...args) {
            const msg = args.join(' ');
            if (msg.indexOf('MMDLoader') >= 0 && msg.indexOf('deprecated') >= 0) return;
            _origWarn.apply(console, args);
        };
        if (!_isThirdPartyAllowed()) {
            console.warn = _origWarn;
            console.warn('[OrbSkins] 三方库已禁用，回退自研渲染器');
            self._mmdProgress(10, '引擎', '三方库禁用，回退自研');
            if (window.MrHuaRenderer) {
                self._mmdProgress(20, '引擎', '自研渲染器就绪');
                self.initMMDNative(skin);
            } else {
                self._mmdProgress(0, '错误', '无可用渲染器');
                self._mmdShowStatus('3D引擎加载失败\n三方库已禁用且自研渲染器未加载');
            }
            return;
        }
        const loadPromise = window._mmdModulePromise || (window._mmdModulePromise = Promise.all([
            import('three'),
            import('three/addons/loaders/MMDLoader.js'),
            import('three/addons/loaders/GLTFLoader.js'),
            import('@pixiv/three-vrm')
        ]).then(([THREE, mmd, gltf, vrmMod]) => {
            console.warn = _origWarn;
            window.THREE = THREE;
            return { THREE, MMDLoader: mmd.MMDLoader, GLTFLoader: gltf.GLTFLoader, VRMLoaderPlugin: vrmMod.VRMLoaderPlugin, VRM: vrmMod.VRM };
        }).catch(err => {
            console.warn = _origWarn;
            window._mmdModulePromise = null;
            throw err;
        }));
        loadPromise.then((mods) => {
            self._mmdProgress(20, '引擎', '模块就绪');
            self._mmdModule = mods;
            self.initMMD(skin);
        }).catch(err => {
            console.warn('[OrbSkins] CDN引擎加载失败，回退自研渲染器:', err.message);
            self._mmdProgress(10, '引擎', 'CDN失败，回退自研');
            if (window.MrHuaRenderer) {
                self._mmdProgress(20, '引擎', '自研渲染器就绪');
                self.initMMDNative(skin);
            } else {
                self._mmdProgress(0, '错误', '无可用渲染器');
                self._mmdShowStatus('3D 引擎加载失败\nCDN不可用且自研渲染器未加载');
            }
        });
    };

    // ============ 自研 WebGL MMD 渲染管线 ============
    OrbSkins.prototype.initMMDNative = function(skin) {
        const self = this;
        const orb = document.getElementById('orb');
        const orbStage = document.getElementById('orb-stage');
        if (!orb || !orbStage || !this.characterEl) return;

        // DOM 安全检查
        orb.style.transform = '';
        orb.style.marginTop = ''; orb.style.marginLeft = '';
        orb.style.right = '0';
        orb.style.top = '50%';
        orb.style.transform = 'translateY(-50%)';
        orb.classList.add('skin-mmd');
        orb.style.setProperty('width', '280px', 'important');
        orb.style.setProperty('height', '300px', 'important');
        orb.style.setProperty('background', 'transparent', 'important');
        orb.style.setProperty('box-shadow', 'none', 'important');
        orb.style.setProperty('border-radius', '0', 'important');
        if (this.characterEl.parentNode !== orb) orb.appendChild(this.characterEl);
        if (orb.parentNode !== orbStage) orbStage.appendChild(orb);
        if (getComputedStyle(orb).position === 'static') orb.style.position = 'relative';
        this.characterEl.style.setProperty('position', 'absolute', 'important');
        this.characterEl.style.setProperty('width', '360px', 'important');
        this.characterEl.style.setProperty('height', '390px', 'important');
        this.characterEl.style.setProperty('left', '50%', 'important');
        this.characterEl.style.setProperty('top', '50%', 'important');
        this.characterEl.style.setProperty('transform', 'translate(-50%, -50%)', 'important');
        this.characterEl.style.setProperty('display', 'block', 'important');

        // 创建 canvas
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;display:block;cursor:default;';
        this.characterEl.innerHTML = '';
        this.characterEl.appendChild(canvas);

        // 鼠标互动：悬停检测 + 点击触发动作
        let _hoverBone = null;
        canvas.addEventListener('mousemove', (e) => {
            if(!modelInstance || !modelInstance.raycast) return;
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const cam = camera || { distance: 60, height: 12, x: 0, y: 10, z: 0, eyeX:0, eyeY:12, eyeZ:50, targetX:0, targetY:10, targetZ:0 };
            try {
                const hit = modelInstance.raycast(cam, mx, my, rect.width, rect.height);
                if(hit){
                    _hoverBone = hit.boneName;
                    canvas.style.cursor = 'pointer';
                } else {
                    _hoverBone = null;
                    canvas.style.cursor = 'default';
                }
            } catch(err) { /* 射线检测失败时静默 */ }
        });
        canvas.addEventListener('click', (e) => {
            if(!modelInstance || !modelInstance.animator) return;
            // 点击触发眨眼 + 轻微挥手
            if(modelInstance.animator.triggerBlink) modelInstance.animator.triggerBlink();
            if(modelInstance.animator.triggerWave) modelInstance.animator.triggerWave(_hoverBone && _hoverBone.includes('左') ? 'left' : 'right');
            console.log('[NativeMMD] 点击互动，悬停骨骼:', _hoverBone);
        });

        let renderer, modelInstance, camera, animId, running = true;

        function getResolutionScale() {
            const dpr = window.devicePixelRatio || 1;
            const sw = window.screen.width || 1920;
            let baseScale;
            if (sw >= 3840) baseScale = 2.5;
            else if (sw >= 2560) baseScale = 2.2;
            else if (sw >= 1920) baseScale = 1.8;
            else baseScale = 1.5;
            if (dpr > 1.5) baseScale += 0.3;
            else if (dpr > 1.25) baseScale += 0.15;
            return Math.min(3.5, Math.max(1.5, baseScale));
        }
        let _resizeTimer = null;
        let postProcess = null;
        function resize() {
            if (!renderer) return;
            if (_resizeTimer) clearTimeout(_resizeTimer);
            _resizeTimer = setTimeout(() => {
                const rect = self.characterEl.getBoundingClientRect();
                // 支持自定义分辨率缩放（由ModelAction画质控制设置）
                const customScale = self._nativeModel ? self._nativeModel._customScale : null;
                const scale = customScale || getResolutionScale();
                const sw = window.screen.width || 1920;
                // 自定义缩放时提高最大尺寸限制
                const maxDim = customScale ? 4096 : (sw >= 3840 ? 2048 : (sw >= 2560 ? 1536 : 1024));
                let w = Math.max(1, Math.floor(rect.width * scale));
                let h = Math.max(1, Math.floor(rect.height * scale));
                if (w > maxDim || h > maxDim) {
                    const ratio = Math.min(maxDim / w, maxDim / h);
                    w = Math.floor(w * ratio);
                    h = Math.floor(h * ratio);
                }
                if (canvas.width !== w || canvas.height !== h) {
                    canvas.width = w; canvas.height = h;
                    renderer.gl.viewport(0, 0, w, h);
                    if(postProcess) postProcess.resize(w, h);
                }
            }, 100);
        }
        // 暴露手动resize方法（供画质控制调用）
        this._nativeResizeMMD = resize;

        const ro = new ResizeObserver(resize);
        ro.observe(this.characterEl);

        // 鼠标交互
        let mouseX = 0, mouseY = 0;
        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            mouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
            mouseY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
        });

        // 渲染循环（限制30fps + 页面隐藏时暂停，减少 rAF 回调触发扩展）
        let _lastFrameT = 0;
        function loop() {
            if (!running) return;
            animId = requestAnimationFrame(loop);
            if (document.hidden) return;
            const now = performance.now();
            if (now - _lastFrameT < 33) return;
            _lastFrameT = now;
            if (renderer && modelInstance) {
                // canvas 尺寸为0时自动修复
                if (!renderer.gl.canvas.width || !renderer.gl.canvas.height) resize();
                const cam = camera || { distance: 60, height: 12, x: 0, y: 10, z: 0 };
                // 鼠标微移相机（不覆盖模型中心）
                cam._mouseX = mouseX;
                cam._mouseY = mouseY;

                // 目光跟随鼠标（将鼠标位置-1~1映射为头部旋转角度-0.2~0.2弧度）
                if(modelInstance.animator && modelInstance.animator.setLookTarget){
                    const lookX = mouseX * 0.2;
                    const lookY = -mouseY * 0.12;
                    modelInstance.animator.setLookTarget(lookX, lookY);
                }

                // 注意：animator.update() 由渲染器 renderModel 内部调用，这里不需要重复调用
                // 重复调用会导致动画状态被更新两次，破坏动画

                try {
                    // 色彩调整参数（降低亮度、增强色彩）
                    const renderOpts = {
                        exposure: 0.72,        // 曝光降低（更暗）
                        saturation: 1.5,       // 饱和度增强（更鲜艳）
                        contrast: 1.25,        // 对比度增强
                        brightness: -0.08,     // 亮度降低
                        hemisphereIntensity: 0.55,  // 半球光降低
                        rimIntensity: 0.05     // 边缘光降低
                    };
                    if(postProcess){
                        postProcess.render(renderer, modelInstance, cam, renderOpts);
                    } else {
                        MrHuaRenderer.renderModel(renderer, modelInstance, cam, renderOpts);
                    }
                }
                catch(e) { console.warn('[NativeMMD] render error:', e.message); }
            }
        }

        // 初始化渲染器
        try {
            renderer = MrHuaRenderer.createRenderer(canvas);
            // 立即设置 canvas 尺寸
            resize();
            // 如果尺寸仍为0，用默认值
            if (!canvas.width || !canvas.height) {
                canvas.width = 512; canvas.height = 512;
                renderer.gl.viewport(0, 0, 512, 512);
            }
        } catch(e) {
            this._mmdShowStatus('WebGL 初始化失败\n' + e.message);
            return;
        }

        this._mmdProgress(30, '下载', skin.name || 'MMD');
        const modelUrl = skin.model_url;
        console.log('[NativeMMD] 开始加载模型 URL:', modelUrl, 'MrHuaRenderer.loadPMXModel=', typeof MrHuaRenderer.loadPMXModel);

        try {
            MrHuaRenderer.loadPMXModel(modelUrl, renderer).then((mi) => {
                modelInstance = mi;
                // 暴露模型实例给外部动作系统
                self._nativeModel = { instance: modelInstance, renderer: renderer, canvas: canvas, camera: null };
                self._mmdProgress(90, '渲染', '顶点:' + mi.vertexCount + ' 材质:' + mi.materialCount);

                // 根据模型尺寸设置相机
                const size = mi.size;
                const center = mi.center;
                const maxDim = Math.max(size[0], size[1], size[2]);
                const fitDist = maxDim * 2.2;
                camera = {
                    distance: fitDist,
                    height: center[1] + size[1] * 0.1,
                    x: center[0],
                    y: center[1],
                    z: center[2],
                };
                // 更新暴露的模型引用（包含camera）
                if (self._nativeModel) self._nativeModel.camera = camera;

                resize();

                // 创建后期处理管线
                postProcess = null;
                try {
                    if(MrHuaRenderer.createPostProcessPipeline){
                        postProcess = MrHuaRenderer.createPostProcessPipeline(renderer.gl, canvas.width || 512, canvas.height || 512);
                        console.log('[NativeMMD] 后期处理管线已创建，效果数量=21');
                    }
                } catch(e){ console.warn('[NativeMMD] 后期处理管线创建失败:', e.message); }

                // 自动运行渲染诊断（前3帧）
                try {
                    if(MrHuaRenderer.diagnoseRender) MrHuaRenderer.diagnoseRender(renderer, modelInstance, camera);
                } catch(e) { console.warn('[NativeMMD] 诊断失败:', e.message); }

                loop();

                self._mmdProgress(100, '完成', mi.model.modelName || skin.name);
                self._mmdShowStatus('');
                console.log('[NativeMMD] 模型加载成功:', mi.model.modelName, '顶点:', mi.vertexCount, '材质:', mi.materialCount, '尺寸:', size.map(v=>v.toFixed(1)).join('x'));

                // ============ 后端模型验证与计算校验 ============
                console.error('[ModelValidation] 🚀 验证代码已执行，模型名=' + (mi.model.modelName || 'unknown') + ' 顶点=' + mi.vertexCount + ' 材质=' + mi.materialCount);
                self._modelValidationReport = null;
                self._calcCheckInterval = null;
                try {
                    const m = mi.model;
                    console.error('[ModelValidation] 步骤1: 开始提取模型数据, m.bones=' + !!m.bones + ' m.positions=' + !!m.positions + ' m.boneIndices=' + !!m.boneIndices + ' m.materials=' + !!m.materials);
                    const modelData = {
                        name: m.modelName || skin.name || 'unknown',
                        path: modelUrl,
                        format_type: 'pmx',
                        bones: (function(){
                            var boneList = m.bones || [];
                            var boneCount = boneList.length;
                            var fixedCount = 0;
                            var result = boneList.map(function(b, i){
                                // 获取原始parent_index
                                var rawParent = b.parentIndex !== undefined ? b.parentIndex : (b.parent !== undefined ? b.parent : -1);
                                // 确保是整数
                                if(typeof rawParent !== 'number' || isNaN(rawParent)) rawParent = -1;
                                rawParent = Math.floor(rawParent);
                                // 范围检查和修正
                                var fixedParent = rawParent;
                                if(fixedParent >= boneCount || fixedParent < -1){
                                    fixedParent = -1;
                                    fixedCount++;
                                }
                                return {
                                    index: i,
                                    name: b.name || b.nameEn || '',
                                    name_en: b.nameEn || '',
                                    parent_index: fixedParent,
                                    _raw_parent_index: rawParent,
                                    _parent_fixed: fixedParent !== rawParent,
                                    position: b.position ? [b.position[0], b.position[1], b.position[2]] : [0, 0, 0],
                                    rotation: b.rotation ? [b.rotation[0], b.rotation[1], b.rotation[2], b.rotation[3]] : [0, 0, 0, 1],
                                    scale: b.scale ? [b.scale[0], b.scale[1], b.scale[2]] : [1, 1, 1],
                                    has_ik: !!b.ik,
                                    ik: b.ik ? {
                                        target_bone: b.ik.targetBone !== undefined ? b.ik.targetBone : -1,
                                        iterations: b.ik.iterations || 0,
                                        chain_length: b.ik.links ? b.ik.links.length : 0,
                                        links: b.ik.links ? b.ik.links.map(function(link, li){
                                            var linkBone = link.boneIndex !== undefined ? link.boneIndex : -1;
                                            if(typeof linkBone !== 'number' || isNaN(linkBone)) linkBone = -1;
                                            linkBone = Math.floor(linkBone);
                                            if(linkBone >= boneCount || linkBone < -1) linkBone = -1;
                                            return {
                                                bone_index: linkBone,
                                                has_limit: !!link.hasLimit,
                                                lower_limit: link.lowerLimit ? [link.lowerLimit[0], link.lowerLimit[1], link.lowerLimit[2]] : null,
                                                upper_limit: link.upperLimit ? [link.upperLimit[0], link.upperLimit[1], link.upperLimit[2]] : null
                                            };
                                        }) : []
                                    } : null,
                                    is_ik: !!b.isIK,
                                    visible: b.visible !== false,
                                    inherit_rotation: b.inheritRotation !== undefined ? b.inheritRotation : false,
                                    inherit_translation: b.inheritTranslation !== undefined ? b.inheritTranslation : false,
                                    additional_transform: b.additionalTransform !== undefined ? b.additionalTransform : 0
                                };
                            });
                            if(fixedCount > 0){
                                console.warn('[ModelValidation] 已修正 ' + fixedCount + ' 个骨骼的无效父骨骼索引（设置为-1）');
                            }
                            return result;
                        })(),
                        vertices: m.positions && m.boneIndices ? (function(){
                            const v = [];
                            const count = Math.min(m.vertexCount || 0, 3000);
                            for(let i=0;i<count;i++){
                                const weights = [];
                                for(let j=0;j<4;j++){
                                    const wi = m.boneIndices[i*4+j];
                                    const wv = m.boneWeights[i*4+j];
                                    if(wi >= 0 && wv > 0) weights.push([wi, wv]);
                                }
                                v.push({index: i, weights: weights});
                            }
                            return v;
                        })() : [],
                        materials: m.materials ? m.materials.map((mat, i) => ({
                            index: i,
                            name: mat.name || mat.nameEn || '',
                            name_en: mat.nameEn || '',
                            diffuse: mat.diffuse ? [mat.diffuse[0], mat.diffuse[1], mat.diffuse[2], mat.diffuse[3]] : [0.8, 0.8, 0.8, 1.0],
                            specular: mat.specular ? [mat.specular[0], mat.specular[1], mat.specular[2]] : [0.5, 0.5, 0.5],
                            ambient: mat.ambient ? [mat.ambient[0], mat.ambient[1], mat.ambient[2]] : [0.3, 0.3, 0.3],
                            shininess: mat.shininess !== undefined ? mat.shininess : 0,
                            has_texture: !!mat.textureIndex || mat.textureIndex === 0,
                            texture_index: mat.textureIndex !== undefined ? mat.textureIndex : -1,
                            has_sphere_texture: !!mat.sphereTextureIndex || mat.sphereTextureIndex === 0,
                            sphere_texture_index: mat.sphereTextureIndex !== undefined ? mat.sphereTextureIndex : -1,
                            sphere_texture_mode: mat.sphereTextureMode !== undefined ? mat.sphereTextureMode : 0,
                            has_toon_texture: !!mat.toonTextureIndex || mat.toonTextureIndex === 0,
                            toon_texture_index: mat.toonTextureIndex !== undefined ? mat.toonTextureIndex : -1,
                            toon_texture_mode: mat.toonTextureMode !== undefined ? mat.toonTextureMode : 0,
                            surface_count: mat.surfaceCount || 0,
                            has_edge: !!mat.edge,
                            edge_size: mat.edge && mat.edge.size !== undefined ? mat.edge.size : 0,
                            edge_color: mat.edge && mat.edge.color ? [mat.edge.color[0], mat.edge.color[1], mat.edge.color[2], mat.edge.color[3]] : null,
                            comment: mat.comment || '',
                            is_shared_toon: mat.isSharedToon !== undefined ? mat.isSharedToon : false
                        })) : [],
                        ik_chains: m.bones && m.bones.filter ? m.bones.filter(b => b.ik).map((b, i) => ({
                            name: b.name || b.nameEn || '',
                            target_bone: b.ik ? b.ik.targetBone : -1,
                            iterations: b.ik ? b.ik.iterations : 0,
                            chain_length: b.ik && b.ik.links ? b.ik.links.length : 0,
                            links: b.ik && b.ik.links ? b.ik.links.map((link, li) => ({
                                bone_index: link.boneIndex !== undefined ? link.boneIndex : -1,
                                has_limit: !!link.hasLimit,
                                lower_limit: link.lowerLimit ? [link.lowerLimit[0], link.lowerLimit[1], link.lowerLimit[2]] : null,
                                upper_limit: link.upperLimit ? [link.upperLimit[0], link.upperLimit[1], link.upperLimit[2]] : null
                            })) : []
                        })) : [],
                        morphs: m.morphs ? m.morphs.map((mp, i) => ({
                            index: i,
                            name: mp.name || mp.nameEn || '',
                            name_en: mp.nameEn || '',
                            type: mp.type !== undefined ? mp.type : -1,
                            element_count: mp.elements ? mp.elements.length : 0,
                            has_vertices: mp.elements && mp.elements.length > 0 && mp.elements[0].vertexIndex !== undefined,
                            has_bones: mp.elements && mp.elements.length > 0 && mp.elements[0].boneIndex !== undefined,
                            has_materials: mp.elements && mp.elements.length > 0 && mp.elements[0].materialIndex !== undefined,
                            has_uv: mp.elements && mp.elements.length > 0 && mp.elements[0].uvOffset !== undefined,
                            has_group: mp.elements && mp.elements.length > 0 && mp.elements[0].groupIndex !== undefined
                        })) : [],
                        textures: m.textures || [],
                        vertex_count: m.vertexCount || 0,
                        bone_count: m.boneCount || 0,
                        material_count: m.materialCount || 0,
                        morph_count: m.morphs ? m.morphs.length : 0,
                        rigid_body_count: m.rigidBodies ? m.rigidBodies.length : 0,
                        joint_count: m.joints ? m.joints.length : 0,
                        physics: m.rigidBodies || m.joints ? {
                            rigid_bodies: m.rigidBodies ? m.rigidBodies.map((rb, i) => ({
                                index: i,
                                name: rb.name || rb.nameEn || '',
                                bone_index: rb.boneIndex !== undefined ? rb.boneIndex : -1,
                                group: rb.group !== undefined ? rb.group : 0,
                                group_mask: rb.groupMask !== undefined ? rb.groupMask : 0,
                                shape_type: rb.shapeType !== undefined ? rb.shapeType : 0,
                                size: rb.size ? [rb.size[0], rb.size[1], rb.size[2]] : [0, 0, 0],
                                position: rb.position ? [rb.position[0], rb.position[1], rb.position[2]] : [0, 0, 0],
                                rotation: rb.rotation ? [rb.rotation[0], rb.rotation[1], rb.rotation[2]] : [0, 0, 0],
                                mass: rb.mass !== undefined ? rb.mass : 0,
                                linear_damping: rb.linearDamping !== undefined ? rb.linearDamping : 0,
                                angular_damping: rb.angularDamping !== undefined ? rb.angularDamping : 0,
                                restitution: rb.restitution !== undefined ? rb.restitution : 0,
                                friction: rb.friction !== undefined ? rb.friction : 0,
                                physics_mode: rb.physicsMode !== undefined ? rb.physicsMode : 0
                            })) : [],
                            joints: m.joints ? m.joints.map((jt, i) => ({
                                index: i,
                                name: jt.name || jt.nameEn || '',
                                rigid_body_a: jt.rigidBodyA !== undefined ? jt.rigidBodyA : -1,
                                rigid_body_b: jt.rigidBodyB !== undefined ? jt.rigidBodyB : -1,
                                position: jt.position ? [jt.position[0], jt.position[1], jt.position[2]] : [0, 0, 0],
                                rotation: jt.rotation ? [jt.rotation[0], jt.rotation[1], jt.rotation[2]] : [0, 0, 0],
                                spring_position: jt.springPosition ? [jt.springPosition[0], jt.springPosition[1], jt.springPosition[2]] : [0, 0, 0],
                                spring_rotation: jt.springRotation ? [jt.springRotation[0], jt.springRotation[1], jt.springRotation[2]] : [0, 0, 0],
                                limit_lower: jt.limitLower ? [jt.limitLower[0], jt.limitLower[1], jt.limitLower[2]] : [0, 0, 0],
                                limit_upper: jt.limitUpper ? [jt.limitUpper[0], jt.limitUpper[1], jt.limitUpper[2]] : [0, 0, 0]
                            })) : []
                        } : null
                    };

                    console.error('[ModelValidation] 步骤2: 数据提取完成, 骨骼=' + modelData.bones.length + ' 顶点(抽样)=' + modelData.vertices.length + ' 材质=' + modelData.materials.length + ' IK链=' + modelData.ik_chains.length + ' 形态键=' + modelData.morphs.length);

                    console.error('[ModelValidation] 步骤3: 开始发送验证请求...');
                    fetch('/api/model/validate', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({model_data: modelData, format_type: 'pmx'})
                    }).then(r => {
                        console.error('[ModelValidation] 步骤4: 收到响应 status=' + r.status);
                        return r.json();
                    }).then(result => {
                        console.error('[ModelValidation] 步骤5: 响应解析完成 success=' + result.success);
                        if(result.success && result.report){
                            self._modelValidationReport = result.report;
                            const report = result.report;
                            const issues = report.issues || [];
                            const critical = issues.filter(i => i.severity === 'critical').length;
                            const high = issues.filter(i => i.severity === 'high').length;
                            const medium = issues.filter(i => i.severity === 'medium').length;
                            const low = issues.filter(i => i.severity === 'low').length;
                            const info = issues.filter(i => i.severity === 'info').length;

                            // 按类别统计
                            const categories = {};
                            issues.forEach(i => { categories[i.category] = (categories[i.category] || 0) + 1; });

                            console.log('');
                            console.log('╔════════════════════════════════════════════════════════════╗');
                            console.log('║          🧠 3D模型验证报告 - ' + (report.model_name || modelData.name).substring(0, 30) + ' '.repeat(Math.max(0, 30 - (report.model_name || modelData.name).length)) + '║');
                            console.log('╠════════════════════════════════════════════════════════════╣');
                            console.log('║  📊 模型统计:');
                            console.log('║    顶点: ' + (report.model_stats ? report.model_stats.vertex_count : modelData.vertex_count) + ' | 骨骼: ' + (report.model_stats ? report.model_stats.bone_count : modelData.bone_count) + ' | 材质: ' + (report.model_stats ? report.model_stats.material_count : modelData.material_count));
                            console.log('║    IK链: ' + (report.model_stats ? report.model_stats.ik_chain_count : modelData.ik_chains.length) + ' | 形态键: ' + (report.model_stats ? report.model_stats.morph_count : modelData.morphs.length) + ' | 纹理: ' + (report.model_stats ? report.model_stats.texture_count : modelData.textures.length));
                            console.log('║    刚体: ' + (modelData.rigid_body_count || 0) + ' | 关节: ' + (modelData.joint_count || 0));
                            console.log('╠════════════════════════════════════════════════════════════╣');
                            console.log('║  ⚠️  问题统计 (共' + issues.length + '个):');
                            console.log('║    🔴 严重(critical): ' + critical + '  |  🟠 高(high): ' + high + '  |  🟡 中(medium): ' + medium + '  |  🟢 低(low): ' + low + '  |  ℹ️  信息(info): ' + info);
                            console.log('╠════════════════════════════════════════════════════════════╣');
                            console.log('║  📂 按类别统计:');
                            Object.keys(categories).forEach(cat => {
                                console.log('║    ' + cat + ': ' + categories[cat] + '个');
                            });
                            console.log('╠════════════════════════════════════════════════════════════╣');
                            console.log('║  ⏱️  验证耗时: ' + (report.duration ? report.duration.toFixed(3) : '?') + '秒 | 检查项: ' + (report.total_checks || 0) + '项');
                            console.log('╚════════════════════════════════════════════════════════════╝');
                            console.log('');

                            if(issues.length > 0){
                                console.log('📋 详细问题列表:');
                                console.log('─'.repeat(70));
                                issues.forEach((issue, idx) => {
                                    const severityIcon = issue.severity === 'critical' ? '🔴' : issue.severity === 'high' ? '🟠' : issue.severity === 'medium' ? '🟡' : issue.severity === 'low' ? '🟢' : 'ℹ️';
                                    console.log('');
                                    console.log(severityIcon + ' [' + idx + '] [' + issue.severity.toUpperCase() + '] [' + issue.category + '] ' + issue.title);
                                    if(issue.location) console.log('   📍 位置: ' + issue.location);
                                    if(issue.description) console.log('   📝 描述: ' + issue.description);
                                    if(issue.expected) console.log('   ✅ 期望: ' + issue.expected);
                                    if(issue.actual) console.log('   ❌ 实际: ' + issue.actual);
                                    if(issue.auto_fixable) console.log('   🔧 可自动修复: 是');
                                    if(issue.fix_suggestion) console.log('   💡 修复建议: ' + issue.fix_suggestion);
                                    if(issue.confidence !== undefined) console.log('   🎯 置信度: ' + (issue.confidence * 100).toFixed(0) + '%');
                                });
                                console.log('');
                                console.log('─'.repeat(70));
                            } else {
                                console.log('✅ 模型验证通过，未发现任何问题！');
                            }

                            // 上报验证结果到后端（让终端日志也能看到）
                            try {
                                fetch('/api/orb/skins/validation_log', {
                                    method: 'POST',
                                    headers: {'Content-Type': 'application/json'},
                                    body: JSON.stringify({
                                        model_name: report.model_name || modelData.name,
                                        total_issues: issues.length,
                                        critical: critical,
                                        high: high,
                                        medium: medium,
                                        low: low,
                                        categories: categories,
                                        duration: report.duration,
                                        issues: issues.slice(0, 10).map(i => ({severity: i.severity, category: i.category, title: i.title, location: i.location}))
                                    })
                                }).catch(() => {});
                            } catch(e) {}

                            // 自动修复
                            if(self._applyValidationFixes){
                                console.log('');
                                console.log('🔧 开始自动修复...');
                                const fixes = self._applyValidationFixes(result.report, mi);
                                console.log('✅ 自动修复完成，共应用 ' + fixes + ' 项修复');
                                console.log('');
                            }
                            // 启动计算校验
                            if(self._startCalculationCheck){
                                self._startCalculationCheck(mi, renderer);
                            }
                        } else {
                            console.error('❌ 模型验证失败: ' + (result.error || '未知错误'));
                        }
                    }).catch(e => {
                        console.error('❌ 模型验证请求异常: ' + e.message);
                        console.error(e.stack);
                    });
                } catch(e) {
                    console.warn('[ModelValidation] ❌ 验证准备失败:', e.message, e.stack);
                }

                // 保存引用供销毁
                self._nativeMMD = { renderer, modelInstance, canvas, ro, animId, postProcess, stop: () => { running = false; if(animId) cancelAnimationFrame(animId); ro.disconnect(); if(postProcess) postProcess.dispose(); } };

                // ============ 飞行模式 ============
                self._flyState = { enabled: false, animId: null, x: 0, y: 0, speed: 0.15, amplitude: 0.3, phase: 0, origStyle: null };
                self.startFly = function(opts) {
                    const fs = self._flyState;
                    if(fs.enabled) return;
                    opts = opts || {};
                    fs.speed = opts.speed || 0.12;
                    fs.amplitude = opts.amplitude || 0.35;
                    fs.phase = opts.phase || 0;
                    // 保存原始样式
                    fs.origStyle = {
                        position: orb.style.position,
                        right: orb.style.right,
                        left: orb.style.left,
                        top: orb.style.top,
                        bottom: orb.style.bottom,
                        transform: orb.style.transform,
                        width: orb.style.width,
                        height: orb.style.height,
                        zIndex: orb.style.zIndex,
                        pointerEvents: orb.style.pointerEvents
                    };
                    // 设置飞行模式样式：fixed定位，屏幕上方，不阻挡点击
                    orb.style.position = 'fixed';
                    orb.style.right = '';
                    orb.style.left = '0';
                    orb.style.top = '0';
                    orb.style.bottom = '';
                    orb.style.transform = '';
                    orb.style.width = '100vw';
                    orb.style.height = '35vh';
                    orb.style.zIndex = '9998';
                    orb.style.pointerEvents = 'none';
                    // characterEl也调整，确保不阻挡点击
                    self.characterEl.style.width = '280px';
                    self.characterEl.style.height = '310px';
                    self.characterEl.style.pointerEvents = 'none';
                    fs.enabled = true;
                    fs._lastTime = performance.now();
                    function flyLoop() {
                        if(!fs.enabled) return;
                        const now = performance.now();
                        const dt = (now - fs._lastTime) / 1000;
                        fs._lastTime = now;
                        fs.phase += dt * fs.speed;
                        // 左右飞行：正弦波，从屏幕左侧到右侧
                        const t = (Math.sin(fs.phase) + 1) / 2; // 0-1
                        const screenW = window.innerWidth;
                        const modelW = 280;
                        fs.x = t * (screenW - modelW);
                        // 上下轻微浮动
                        fs.y = Math.sin(fs.phase * 2.3) * 15;
                        // 应用位置：在屏幕顶部区域飞行，不挡按钮
                        self.characterEl.style.left = (fs.x + modelW/2) + 'px';
                        self.characterEl.style.top = (40 + fs.y) + 'px';
                        self.characterEl.style.transform = 'translate(-50%, 0)';
                        fs.animId = requestAnimationFrame(flyLoop);
                    }
                    flyLoop();
                    console.log('[NativeMMD] 飞行模式已启动 speed=' + fs.speed + ' amp=' + fs.amplitude);
                };
                self.stopFly = function() {
                    const fs = self._flyState;
                    if(!fs.enabled) return;
                    fs.enabled = false;
                    if(fs.animId) cancelAnimationFrame(fs.animId);
                    // 恢复原始样式
                    if(fs.origStyle) {
                        orb.style.position = fs.origStyle.position;
                        orb.style.right = fs.origStyle.right;
                        orb.style.left = fs.origStyle.left;
                        orb.style.top = fs.origStyle.top;
                        orb.style.bottom = fs.origStyle.bottom;
                        orb.style.transform = fs.origStyle.transform;
                        orb.style.width = fs.origStyle.width;
                        orb.style.height = fs.origStyle.height;
                        orb.style.zIndex = fs.origStyle.zIndex;
                        orb.style.pointerEvents = fs.origStyle.pointerEvents;
                    }
                    // 恢复characterEl样式
                    self.characterEl.style.left = '50%';
                    self.characterEl.style.top = '50%';
                    self.characterEl.style.transform = 'translate(-50%, -50%)';
                    self.characterEl.style.width = '360px';
                    self.characterEl.style.height = '390px';
                    self.characterEl.style.pointerEvents = '';
                    console.log('[NativeMMD] 飞行模式已停止');
                };
                self.toggleFly = function(opts) {
                    if(self._flyState.enabled) self.stopFly();
                    else self.startFly(opts);
                };

                // 模型加载完成后自动启动飞行模式（避免挡着窗口按钮）
                setTimeout(() => {
                    try { self.startFly({speed: 0.08}); } catch(e) { console.warn('[NativeMMD] 自动启动飞行模式失败:', e.message); }
                }, 500);
            }).catch((err) => {
                console.error('[NativeMMD] 模型加载失败(promise):', err);
                self._mmdProgress(0, '错误', err.message || '加载失败');
                self._mmdShowStatus('模型加载失败\n' + (err.message || ''));
            });
        } catch(e) {
            console.error('[NativeMMD] 模型加载失败(sync):', e);
            self._mmdProgress(0, '错误', e.message || '加载失败');
            self._mmdShowStatus('模型加载失败\n' + (e.message || ''));
        }
    };

    // ============ VRM 模型管线 ============
    OrbSkins.prototype.loadVRM = function(skin) {
        this._mmdShowStatus('正在加载 3D 引擎...');
        this._mmdProgress(5, '引擎', 'Three.js + VRM');
        if (!_isThirdPartyAllowed()) {
            console.warn('[OrbSkins] 三方库已禁用，VRM模型需要three.js');
            this._mmdProgress(0, '错误', '三方库已禁用');
            this._mmdShowStatus('VRM引擎加载失败三方库已禁用，请在设置中开启"允许使用三方库（需联网）"');
            return;
        }
        const loadPromise = window._mmdModulePromise || (window._mmdModulePromise = Promise.all([
            import('three'),
            import('three/addons/loaders/GLTFLoader.js'),
            import('@pixiv/three-vrm')
        ]).then(([THREE, gltf, vrmMod]) => {
            window.THREE = THREE;
            return { THREE, GLTFLoader: gltf.GLTFLoader, VRMUtils: vrmMod.VRMUtils, VRM: vrmMod.VRM };
        }).catch(err => {
            window._mmdModulePromise = null;
            throw err;
        }));
        loadPromise.then((mods) => {
            this._mmdProgress(20, '引擎', 'VRM 模块就绪');
            this._mmdModule = mods;
            this.initVRM(skin);
        }).catch(err => {
            console.error('VRM module load failed:', err);
            this._mmdProgress(0, '错误', err.message || '加载失败');
            this._mmdShowStatus('VRM 引擎加载失败\n' + (err.message || ''));
        });
    };

    OrbSkins.prototype.initVRM = function(skin) {
        const mod = this._mmdModule;
        const THREE = mod.THREE;
        // 用three.js的GLTFLoader加载VRM（VRM本质是glTF，不用three-vrm避免colorSpace bug）
        const GLTFLoader = mod.GLTFLoader;
        console.log('[OrbSkins] initVRM 使用three.js GLTFLoader加载VRM');

        const orb = document.getElementById('orb');
        const characterEl = this.characterEl;
        if (!orb || !characterEl) return;

        // 清理旧的
        if (this._vrmRenderer) { this._vrmRenderer.dispose(); this._vrmRenderer = null; }
        characterEl.innerHTML = '';
        characterEl.style.display = 'block';
        orb.classList.add('skin-mmd'); // 复用 MMD 的尺寸 CSS

        // 状态覆盖层
        const statusOverlay = document.createElement('div');
        statusOverlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:#999;text-align:center;pointer-events:none;z-index:10;white-space:pre-line;';
        characterEl.appendChild(statusOverlay);

        // 进度条
        const progressEl = document.createElement('div');
        progressEl.style.cssText = 'position:absolute;bottom:6px;left:10%;right:10%;height:3px;background:rgba(0,0,0,0.08);border-radius:2px;z-index:10;pointer-events:none;';
        const progressBar = document.createElement('div');
        progressBar.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,#6a4c93,#9b7ec7);border-radius:2px;transition:width .3s;';
        progressEl.appendChild(progressBar);
        characterEl.appendChild(progressEl);

        const setStatus = (msg) => { statusOverlay.textContent = msg; };
        const setProgress = (pct, label, detail) => {
            progressBar.style.width = pct + '%';
            if (label) console.log(`🧸 VRM加载 [${'█'.repeat(Math.floor(pct/5))}${'░'.repeat(20-Math.floor(pct/5))}] ${pct}% ${label}${detail ? ' ' + detail : ''}`);
        };

        setStatus('正在加载模型...');
        setProgress(25, '模型', skin.model_url.split('/').pop());

        // 创建渲染器
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'width:360px;height:520px;display:block;pointer-events:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);';
        characterEl.appendChild(canvas);

        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
        this._vrmRenderer = renderer;

        // 自适应分辨率
        const resizeRenderer = () => {
            // 固定渲染分辨率 720x1040 (显示360x520的2倍，保证清晰)
            const rw = 720, rh = 1040;
            renderer.setSize(rw, rh, false);
            return { w: rw, h: rh };
        };
        const rs = resizeRenderer();

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(30, rs.w / rs.h, 0.1, 100);
        camera.position.set(0, 1.25, 3.0);
        camera.lookAt(0, 1.1, 0);

        // 光照
        scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const dir = new THREE.DirectionalLight(0xffffff, 1.2);
        dir.position.set(1, 2, 3);
        scene.add(dir);
        const fill = new THREE.DirectionalLight(0xffeedd, 0.4);
        fill.position.set(-1, 1, -1);
        scene.add(fill);

        const ro = new ResizeObserver(() => {
            const s = resizeRenderer();
            camera.aspect = s.w / s.h;
            camera.updateProjectionMatrix();
        });
        ro.observe(characterEl);
        this._vrmResizeObs = ro;

        // 鼠标跟随
        this._vrmMouseX = 0; this._vrmMouseY = 0;
        this._vrmMouseHandler = (e) => {
            const rect = canvas.getBoundingClientRect();
            if (rect.width < 50) { this._vrmMouseX = 0; this._vrmMouseY = 0; return; }
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dx = e.clientX - cx, dy = e.clientY - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const radius = Math.max(rect.width, rect.height) * 2;
            if (dist > radius) { this._vrmMouseX *= 0.9; this._vrmMouseY *= 0.9; return; }
            this._vrmMouseX = Math.max(-1, Math.min(1, dx / (rect.width * 2)));
            this._vrmMouseY = Math.max(-1, Math.min(1, dy / (rect.height * 2)));
        };
        document.addEventListener('mousemove', this._vrmMouseHandler);

        // 点击交互（Raycaster检测点击模型）
        this._vrmRaycaster = new THREE.Raycaster();
        this._vrmPointer = new THREE.Vector2();
        this._vrmClickHandler = (e) => {
            if (!currentVRM) return;
            const rect = canvas.getBoundingClientRect();
            this._vrmPointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this._vrmPointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            this._vrmRaycaster.setFromCamera(this._vrmPointer, camera);
            const intersects = this._vrmRaycaster.intersectObjects(currentVRM.scene.children, true);
            if (intersects.length > 0) {
                console.log('[OrbSkins] VRM模型被点击，触发wave动作');
                // 触发ModelAction的挥手动作
                if (window.ModelAction && typeof window.ModelAction.wave === 'function') {
                    window.ModelAction.wave('right');
                }
                // 同时触发开心反应
                if (window.ModelAction && typeof window.ModelAction.setEmotion === 'function') {
                    window.ModelAction.setEmotion('happy');
                    setTimeout(() => {
                        if (window.ModelAction) window.ModelAction.setEmotion('neutral');
                    }, 2000);
                }
            }
        };
        canvas.addEventListener('click', this._vrmClickHandler);

        let currentVRM = null;
        let vrmModelUrl = skin.model_url;

        // ============================================================
        // 自研GLTFLoader -> three.js 转换器（不用three-vrm，避免colorSpace bug）
        // ============================================================
        OrbSkins.prototype._convertGLTFToThree = function(model, THREE) {
            const result = { scene: new THREE.Group(), bones: [], boneMap: {}, materials: [], skinnedMeshes: [] };
            const textureCache = {};
            const loadTexture = (texIndex) => {
                if (texIndex === undefined || texIndex < 0) return null;
                if (textureCache[texIndex]) return textureCache[texIndex];
                const texInfo = model.textures[texIndex];
                if (!texInfo) return null;
                const imgInfo = model.images[texInfo.source];
                if (!imgInfo) return null;
                let texture = null;
                try {
                    if (imgInfo.bufferView) {
                        const bv = imgInfo.bufferView;
                        const blob = new Blob([bv.buffer.slice(bv.byteOffset, bv.byteOffset + bv.byteLength)], { type: imgInfo.mimeType || 'image/png' });
                        texture = new THREE.TextureLoader().load(URL.createObjectURL(blob));
                    } else if (imgInfo.uri) {
                        texture = new THREE.TextureLoader().load(imgInfo.uri);
                    }
                    if (texture) { texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping; }
                } catch(e) { console.warn('[GLTF-Convert] 纹理加载失败:', e); }
                textureCache[texIndex] = texture;
                return texture;
            };
            // 材质
            for (let i = 0; i < model.materials.length; i++) {
                const m = model.materials[i];
                const pbr = m.pbrMetallicRoughness || {};
                const mat = new THREE.MeshStandardMaterial({
                    color: new THREE.Color().fromArray(pbr.baseColorFactor || [1,1,1,1]),
                    metalness: pbr.metallicFactor !== undefined ? pbr.metallicFactor : 0,
                    roughness: pbr.roughnessFactor !== undefined ? pbr.roughnessFactor : 1,
                    transparent: m.alphaMode === 'BLEND',
                    opacity: (pbr.baseColorFactor && pbr.baseColorFactor[3] !== undefined) ? pbr.baseColorFactor[3] : 1,
                    side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide
                });
                if (pbr.baseColorTexture) { const t = loadTexture(pbr.baseColorTexture.index); if (t) mat.map = t; }
                if (m.normalTexture) { const t = loadTexture(m.normalTexture.index); if (t) mat.normalMap = t; }
                if (m.emissiveTexture) { const t = loadTexture(m.emissiveTexture.index); if (t) mat.emissiveMap = t; }
                if (m.emissiveFactor) mat.emissive = new THREE.Color().fromArray(m.emissiveFactor);
                result.materials.push(mat);
            }
            // 骨骼
            for (let i = 0; i < model.nodes.length; i++) {
                const n = model.nodes[i];
                const bone = new THREE.Bone();
                bone.name = n.name || `bone_${i}`;
                bone.position.fromArray(n.translation || [0,0,0]);
                bone.quaternion.fromArray(n.rotation || [0,0,0,1]);
                bone.scale.fromArray(n.scale || [1,1,1]);
                bone.userData.nodeIndex = i;
                result.bones.push(bone);
                result.boneMap[bone.name] = bone;
            }
            for (let i = 0; i < model.nodes.length; i++) {
                for (const childIdx of (model.nodes[i].children || [])) {
                    if (result.bones[childIdx]) result.bones[i].add(result.bones[childIdx]);
                }
            }
            // 几何体
            const createGeometry = (primitive) => {
                const geo = new THREE.BufferGeometry();
                const a = primitive.attributes;
                if (a.POSITION) geo.setAttribute('position', new THREE.Float32BufferAttribute(a.POSITION, 3));
                if (a.NORMAL) geo.setAttribute('normal', new THREE.Float32BufferAttribute(a.NORMAL, 3));
                if (a.TEXCOORD_0) geo.setAttribute('uv', new THREE.Float32BufferAttribute(a.TEXCOORD_0, 2));
                if (a.JOINTS_0) {
                    // 关键：skinIndex必须用整数类型，不能用Float32Array，否则索引会变成浮点数导致bones[index]为undefined
                    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(a.JOINTS_0, 4));
                }
                if (a.WEIGHTS_0) geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(a.WEIGHTS_0, 4));
                if (primitive.indices) geo.setIndex(primitive.indices);
                return geo;
            };
            // 节点层级
            const rootNodes = model.scenes[0] ? model.scenes[0].nodes : [0];
            const addedNodes = new Set();
            const addNode = (nodeIdx, parent) => {
                if (addedNodes.has(nodeIdx)) return;
                addedNodes.add(nodeIdx);
                const n = model.nodes[nodeIdx];
                if (!n) return;
                const bone = result.bones[nodeIdx];
                if (bone) {
                    parent.add(bone);
                    if (n.mesh >= 0 && model.meshes[n.mesh]) {
                        const meshData = model.meshes[n.mesh];
                        for (const prim of meshData.primitives) {
                            const geo = createGeometry(prim);
                            const mat = result.materials[prim.material] || new THREE.MeshStandardMaterial({ color: 0xffffff });
                            const skinned = new THREE.SkinnedMesh(geo, mat);
                            skinned.name = meshData.name || `mesh_${n.mesh}`;
                            if (n.skin >= 0 && model.skins[n.skin]) {
                                // 关键：不能用.filter(Boolean)，否则Skeleton.bones索引和skinIndex不匹配
                                // 为缺失的骨骼创建占位bone，保持索引一致
                                const jointBones = model.skins[n.skin].joints.map(j => {
                                    if (result.bones[j]) return result.bones[j];
                                    const placeholder = new THREE.Bone();
                                    placeholder.name = 'placeholder_' + j;
                                    result.bones[j] = placeholder;
                                    // 关键：把占位bone添加到场景中，否则matrixWorld不会被计算
                                    result.scene.add(placeholder);
                                    return placeholder;
                                });
                                skinned.bind(new THREE.Skeleton(jointBones), new THREE.Matrix4());
                                result.skinnedMeshes.push(skinned);
                            }
                            bone.add(skinned);
                        }
                    }
                    for (const childIdx of (n.children || [])) addNode(childIdx, bone);
                }
            };
            for (const rootIdx of rootNodes) addNode(rootIdx, result.scene);
            return result;
        };

        // 加载 VRM（用自研GLTFLoader，不用three-vrm，避免colorSpace bug）
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            setStatus('模型解析超时');
            setProgress(0, '错误', '超时');
        }, 30000);

        setProgress(30, '下载', '加载模型文件...');

        // 用three.js的GLTFLoader加载VRM（VRM本质是glTF+扩展）
        const loader = new GLTFLoader();
        loader.load(vrmModelUrl, (gltf) => {
            if (timedOut) return;
            clearTimeout(timeout);
            setProgress(70, '渲染', '处理模型数据...');

            // 从gltf.scene中提取骨骼和蒙皮网格
            const bones = [];
            const boneMap = {};
            const skinnedMeshes = [];
            gltf.scene.traverse((obj) => {
                if (obj.isBone) {
                    bones.push(obj);
                    boneMap[obj.name] = obj;
                }
                if (obj.isSkinnedMesh) {
                    skinnedMeshes.push(obj);
                }
            });
            console.log('[OrbSkins] three.js GLTFLoader加载完成:', skinnedMeshes.length, '个蒙皮网格,', bones.length, '个骨骼');

            const converted = { scene: gltf.scene, bones: bones, boneMap: boneMap, skinnedMeshes: skinnedMeshes };
            currentVRM = converted;
            this._vrm = converted;
            this._vrmBoneMap = boneMap;
            scene.add(gltf.scene);

            gltf.scene.updateMatrixWorld(true);

            // 自动取景（与MMD统一：边距0.65/0.70，考虑z轴，安全系数1.25）
            const box = new THREE.Box3().setFromObject(converted.scene);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            const fovRad = camera.fov * Math.PI / 180;
            const fitDistY = (size.y * 0.65) / Math.tan(fovRad / 2);
            const fitDistX = (size.x * 0.70) / (Math.tan(fovRad / 2) * camera.aspect);
            const fitDistZ = (size.z * 0.5) / Math.tan(fovRad / 2);
            let dist = Math.max(fitDistY, fitDistX, fitDistZ) * 1.25;
            camera.position.set(0, center.y + size.y * 0.02, center.z + dist);
            camera.lookAt(0, center.y, center.z);

            setStatus('');
            setProgress(100, '完成', converted.bones.length + '骨骼/' + converted.skinnedMeshes.length + '蒙皮网格');
            setTimeout(() => { statusOverlay.style.display = 'none'; progressEl.style.display = 'none'; }, 800);

            // 加载背景板
            this._loadVRMStage(scene, THREE, vrmModelUrl);

        }).catch((err) => {
            clearTimeout(timeout);
            console.error('VRM load failed:', err);
            setStatus('模型加载失败\n' + (err.message || ''));
            setProgress(0, '错误', err.message || '');
        });

        // 渲染循环
        const clock = new THREE.Clock();
        let raf;

        // 骨骼缓存（从自研转换器的boneMap中获取）
        const boneCache = {};
        const getBone = (name) => {
            if (name in boneCache) return boneCache[name];
            const node = currentVRM && currentVRM.boneMap ? currentVRM.boneMap[name] : null;
            boneCache[name] = node;
            return node;
        };

        const render = () => {
            raf = requestAnimationFrame(render);
            const dt = Math.min(clock.getDelta(), 0.05);
            const t = clock.elapsedTime;

            if (currentVRM) {
                const vrm = currentVRM;

                // 呼吸
                const breath = Math.sin(t * 1.8) * 0.015;
                const chest = getBone('chest');
                const spine = getBone('spine');
                const hips = getBone('hips');
                const head = getBone('head');
                const neck = getBone('neck');
                const leftUpperArm = getBone('leftUpperArm');
                const rightUpperArm = getBone('rightUpperArm');
                const leftLowerArm = getBone('leftLowerArm');
                const rightLowerArm = getBone('rightLowerArm');
                const leftUpperLeg = getBone('leftUpperLeg');
                const rightUpperLeg = getBone('rightUpperLeg');
                const leftLowerLeg = getBone('leftLowerLeg');
                const rightLowerLeg = getBone('rightLowerLeg');

                if (chest) chest.rotation.x = breath;
                if (spine) spine.rotation.x = breath * 0.5;

                // 身体微摆
                if (hips) {
                    hips.rotation.z = Math.sin(t * 0.6) * 0.015;
                    hips.position.y = Math.sin(t * 1.8) * 0.003;
                }

                // 头部环视 + 鼠标跟随
                if (head) {
                    let lookX = 0, lookY = 0;
                    if (characterEl.clientWidth > 50) {
                        lookX = this._vrmMouseX * 0.25;
                        lookY = -this._vrmMouseY * 0.15;
                    } else {
                        lookX = Math.sin(t * 0.3) * 0.15;
                        lookY = Math.sin(t * 0.2) * 0.08;
                    }
                    head.rotation.y = lookX;
                    head.rotation.x = lookY;
                }

                // 眨眼（用骨骼操作模拟，不用three-vrm expressionManager）
                // VRM的眨眼通常通过形态键实现，这里暂时用头部微动代替
                // 后续可以接入自研FacialAnimation引擎

                // 视线（头部已经跟随鼠标，这里不需要额外的lookAt）

                // SpringBone 物理（自研转换器暂不支持，后续可接入）

                // 停靠检测
                const isDocked = orb.classList.contains('bar-docked');
                const dockTarget = isDocked ? 1 : 0;
                this._vrmDock = (this._vrmDock || 0) + (dockTarget - (this._vrmDock || 0)) * 0.05;
                const dk = this._vrmDock;

                // 坐姿（停靠时）
                if (leftUpperLeg) leftUpperLeg.rotation.x = dk * 0.3;
                if (rightUpperLeg) rightUpperLeg.rotation.x = dk * 0.3;
                if (leftLowerLeg) leftLowerLeg.rotation.x = dk * 0.5;
                if (rightLowerLeg) rightLowerLeg.rotation.x = dk * 0.5;

                // 飞行动作
                const speed = this._motionSpeed || 0;
                if (speed > 0.5) {
                    const tilt = Math.min(speed * 0.08, 0.2);
                    if (chest) chest.rotation.x += tilt;
                    if (spine) spine.rotation.x += tilt * 0.5;
                    if (leftUpperArm) leftUpperArm.rotation.z = -0.25;
                    if (rightUpperArm) rightUpperArm.rotation.z = 0.25;
                }

                // 更新模型矩阵（three.js自动处理骨骼矩阵）
            }

            renderer.render(scene, camera);
        };
        render();
        this._vrmRenderLoop = render;
        this._vrmScene = scene;
        this._vrmCamera = camera;
        this._vrmResizeCleanup = () => { ro.disconnect(); cancelAnimationFrame(raf); };
    };

    OrbSkins.prototype._loadVRMStage = function(scene, THREE, modelUrl) {
        const identityKey = this.getIdentityKey();
        const stageUrl = localStorage.getItem('mrhua_orb_stage_' + identityKey);
        if (!stageUrl) return;

        // 天空盒全景图
        if (/\.(jpg|jpeg|png|hdr|exr)$/i.test(stageUrl)) {
            const loader = new THREE.TextureLoader();
            loader.load(stageUrl, (texture) => {
                texture.mapping = THREE.EquirectangularReflectionMapping;
                texture.colorSpace = THREE.SRGBColorSpace;
                scene.background = texture;
                scene.environment = texture;
                const orb = document.getElementById('orb');
                if (orb) orb.classList.add('has-stage');
            });
            return;
        }

        // glTF/GLB 背景
        if (/\.(glb|gltf)$/i.test(stageUrl)) {
            const loader = new this._mmdModule.GLTFLoader();
            loader.load(stageUrl, (gltf) => {
                this._showFullscreenStage(gltf.scene, THREE);
                const orb = document.getElementById('orb');
                if (orb) orb.classList.add('has-stage');
            });
        }
    };

    OrbSkins.prototype.setVRMMotion = function(vx, vy, speed) {
        this._motionSpeed = speed;
    };

    OrbSkins.prototype.destroyVRM = function() {
        if (this._vrmResizeCleanup) { this._vrmResizeCleanup(); this._vrmResizeCleanup = null; }
        if (this._vrmMouseHandler) {
            document.removeEventListener('mousemove', this._vrmMouseHandler);
            this._vrmMouseHandler = null;
        }
        if (this._vrmRenderer) { this._vrmRenderer.dispose(); this._vrmRenderer = null; }
        this._vrm = null;
        this._vrmScene = null;
        this._vrmCamera = null;
        this._vrmRenderLoop = null;
    };

    // 根据后端验证结果自动调整渲染参数
    OrbSkins.prototype._applyValidationFixes = function(report, modelInstance) {
        try {
            const issues = report.issues || [];
            let fixesApplied = 0;

            // 1. 骨骼结构问题：检查是否有缺失的关键骨骼
            const skeletonIssues = issues.filter(i => i.category === 'skeleton');
            if(skeletonIssues.length > 0){
                const missingBones = skeletonIssues.filter(i => i.title && i.title.includes('缺失'));
                if(missingBones.length > 0){
                    console.log('[ValidationFix] 检测到缺失骨骼:', missingBones.map(b => b.title).join(', '));
                    // 调整animator的骨骼映射容错
                    if(modelInstance.animator && modelInstance.animator.boneMap){
                        console.log('[ValidationFix] 已启用骨骼映射容错模式');
                        fixesApplied++;
                    }
                }
            }

            // 2. 蒙皮权重问题：检查是否有权重异常
            const skinIssues = issues.filter(i => i.category === 'skin_weight');
            if(skinIssues.length > 0){
                const weightSumIssues = skinIssues.filter(i => i.title && i.title.includes('权重和'));
                if(weightSumIssues.length > 0){
                    console.log('[ValidationFix] 检测到蒙皮权重异常:', weightSumIssues.length, '个顶点');
                    // 降低蒙皮精度要求，避免渲染 artifacts
                    if(modelInstance.boneSystem){
                        modelInstance.boneSystem._skinWeightTolerance = 0.15;
                        console.log('[ValidationFix] 已调整蒙皮权重容差为0.15');
                        fixesApplied++;
                    }
                }
            }

            // 3. IK问题：检查IK链是否稳定
            const ikIssues = issues.filter(i => i.category === 'ik');
            if(ikIssues.length > 0){
                const unstableIK = ikIssues.filter(i => i.title && (i.title.includes('不稳定') || i.title.includes('迭代')));
                if(unstableIK.length > 0){
                    console.log('[ValidationFix] 检测到IK不稳定:', unstableIK.length, '条链');
                    // 降低IK迭代次数，避免抖动
                    if(modelInstance.boneSystem && modelInstance.boneSystem.ikChains){
                        modelInstance.boneSystem.ikChains.forEach(chain => {
                            if(chain.iterations > 20) chain.iterations = 20;
                        });
                        console.log('[ValidationFix] 已限制IK迭代次数为20');
                        fixesApplied++;
                    }
                }
            }

            // 4. 材质问题：检查是否有异常材质
            const materialIssues = issues.filter(i => i.category === 'material');
            if(materialIssues.length > 0){
                console.log('[ValidationFix] 检测到材质问题:', materialIssues.length, '个');
                // 启用材质容错渲染
                if(modelInstance.model && modelInstance.model.materials){
                    modelInstance.model.materials.forEach(mat => {
                        if(!mat.diffuse) mat.diffuse = [0.8, 0.8, 0.85, 1.0];
                    });
                    console.log('[ValidationFix] 已修复缺失的材质参数');
                    fixesApplied++;
                }
            }

            // 5. 渲染问题：检查是否有顶点/法线异常
            const renderIssues = issues.filter(i => i.category === 'rendering');
            if(renderIssues.length > 0){
                console.log('[ValidationFix] 检测到渲染问题:', renderIssues.length, '个');
                // 启用法线容错
                if(modelInstance.model){
                    modelInstance.model._normalTolerance = true;
                    console.log('[ValidationFix] 已启用法线容错模式');
                    fixesApplied++;
                }
            }

            console.log('[ValidationFix] 自动修复完成，共应用', fixesApplied, '项修复');
            return fixesApplied;
        } catch(e) {
            console.warn('[ValidationFix] 自动修复失败:', e.message);
            return 0;
        }
    };

    // 启动定期计算校验（把前端计算结果发给后端校验）
    OrbSkins.prototype._startCalculationCheck = function(modelInstance, renderer) {
        try {
            if(this._calcCheckInterval) clearInterval(this._calcCheckInterval);

            let checkCount = 0;
            const MAX_CHECKS = 5; // 最多校验5次，避免性能影响

            this._calcCheckInterval = setInterval(() => {
                if(checkCount >= MAX_CHECKS){
                    clearInterval(this._calcCheckInterval);
                    this._calcCheckInterval = null;
                    console.log('[CalcCheck] 计算校验完成，共校验', checkCount, '次');
                    return;
                }

                try {
                    // 收集前端计算结果
                    const boneSystem = modelInstance.boneSystem;
                    const animator = modelInstance.animator;

                    if(!boneSystem || !animator) return;

                    // 采样几个关键骨骼的计算结果
                    const boneSamples = [];
                    const sampleIndices = [0, 1, 2, 3, 4, 5, 10, 20, 30, 50];
                    sampleIndices.forEach(idx => {
                        if(boneSystem.bones && boneSystem.bones[idx]){
                            const bone = boneSystem.bones[idx];
                            boneSamples.push({
                                index: idx,
                                name: bone.name || bone.nameEn || '',
                                position: bone.worldPosition ? [bone.worldPosition[0], bone.worldPosition[1], bone.worldPosition[2]] : null,
                                rotation: bone.worldRotation ? [bone.worldRotation[0], bone.worldRotation[1], bone.worldRotation[2], bone.worldRotation[3]] : null
                            });
                        }
                    });

                    // 采样顶点位置
                    const vertexSamples = [];
                    if(modelInstance.model && modelInstance.model.positions){
                        const vertexCount = modelInstance.model.vertexCount || 0;
                        const sampleCount = Math.min(100, vertexCount);
                        for(let i=0;i<sampleCount;i++){
                            const vi = Math.floor(i * vertexCount / sampleCount);
                            vertexSamples.push({
                                index: vi,
                                x: modelInstance.model.positions[vi*3],
                                y: modelInstance.model.positions[vi*3+1],
                                z: modelInstance.model.positions[vi*3+2]
                            });
                        }
                    }

                    const calcData = {
                        calculation_type: 'bone_matrix_vertex',
                        data: {
                            bone_count: boneSystem.bones ? boneSystem.bones.length : 0,
                            vertex_count: modelInstance.model ? modelInstance.model.vertexCount : 0,
                            bone_samples: boneSamples,
                            vertex_samples: vertexSamples,
                            frame: checkCount
                        }
                    };

                    fetch('/api/model/verify/calculation', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(calcData)
                    }).then(r => r.json()).then(result => {
                        if(result.success){
                            checkCount++;
                            const issues = result.result.issues || result.result.errors || [];
                            if(issues.length > 0){
                                console.warn('[CalcCheck] 第', checkCount, '次校验发现', issues.length, '个计算问题:', issues.slice(0, 5));
                            } else {
                                console.log('[CalcCheck] 第', checkCount, '次校验通过');
                            }
                        }
                    }).catch(() => {});
                } catch(e) {
                    console.warn('[CalcCheck] 校验准备失败:', e.message);
                }
            }, 2000); // 每2秒校验一次

            console.log('[CalcCheck] 计算校验已启动，最多校验', MAX_CHECKS, '次');
        } catch(e) {
            console.warn('[CalcCheck] 启动失败:', e.message);
        }
    };

    OrbSkins.prototype._mmdShowStatus = function(msg) {
        if (!this.characterEl) return;
        let statusEl = this.characterEl.querySelector('.mmd-status');
        if (!statusEl) {
            statusEl = document.createElement('div');
            statusEl.className = 'mmd-status';
            statusEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#999;font-size:9px;text-align:center;line-height:1.5;pointer-events:none;z-index:2;white-space:pre-line;padding:8px;box-sizing:border-box;';
            this.characterEl.appendChild(statusEl);
        }
        statusEl.textContent = msg;
    };

    OrbSkins.prototype._mmdClearStatus = function() {
        const statusEl = this.characterEl && this.characterEl.querySelector('.mmd-status');
        if (statusEl) statusEl.remove();
    };

    // 上报进度到终端
    OrbSkins.prototype._mmdProgress = function(percent, stage, msg) {
        try {
            fetch('/api/orb/skins/progress', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ percent, stage, msg })
            }).catch(() => {});
        } catch(e) {}
    };

    OrbSkins.prototype.initMMD = function(skin, preloadedMesh) {
        const mod = this._mmdModule;
        if (!mod || !mod.THREE || !mod.MMDLoader) {
            this.characterEl.innerHTML = '<div style="color:#999;font-size:9px;text-align:center;padding-top:35px;">MMD 模块未就绪</div>';
            return;
        }
        const THREE = mod.THREE;
        const orb = document.getElementById('orb');
        const orbStage = document.getElementById('orb-stage');
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'width:360px;height:520px;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);';
        this.characterEl.innerHTML = '';
        this.characterEl.appendChild(canvas);

        // 安全检查：确保模型容器在正确的 DOM 层级中，重置可能导致偏移的残留样式
        if (orb && orbStage) {
            // 重置 #orb 残留 transform（lookAt/nod/mousemove 动画可能未正确清除，导致模型偏移出框框）
            orb.style.transform = '';
            orb.style.marginTop = '';
            orb.style.marginLeft = '';
            orb.style.left = '';
            orb.style.top = '';
            // 确保 characterEl 在 #orb 内
            if (this.characterEl.parentNode !== orb) {
                orb.appendChild(this.characterEl);
            }
            // 确保 #orb 在 #orb-stage 内
            if (orb.parentNode !== orbStage) {
                orbStage.appendChild(orb);
            }
            // 确保定位正确
            if (getComputedStyle(orb).position === 'static') {
                orb.style.position = 'relative';
            }
            this.characterEl.style.position = 'absolute';

            // MutationObserver：实时监控 DOM 变化，立即修复框框分离
            if (this._mmdDomObserver) this._mmdDomObserver.disconnect();
            this._mmdDomObserver = new MutationObserver(() => {
                if (orb.parentNode !== orbStage) {
                    orbStage.appendChild(orb);
                    console.warn('[MMD] DOM监控: #orb 被移出 #orb-stage，已修复');
                }
                if (this.characterEl && this.characterEl.parentNode !== orb) {
                    orb.appendChild(this.characterEl);
                    console.warn('[MMD] DOM监控: characterEl 被移出 #orb，已修复');
                }
                const pos = getComputedStyle(orb).position;
                if (pos === 'fixed' || pos === 'absolute') {
                    orb.style.position = 'relative';
                    console.warn('[MMD] DOM监控: #orb position=' + pos + '，已修复为 relative');
                }
            });
            this._mmdDomObserver.observe(orb, { attributes: true, attributeFilter: ['style', 'class'], childList: false });
            this._mmdDomObserver.observe(orbStage, { childList: true, subtree: false });
        }

        // 根据灵体当前尺寸选择内部分辨率（小尺寸时降低分辨率省性能）
        const getCanvasSize = () => {
            // 固定渲染分辨率 720x1040 (显示360x520的2倍，保证清晰)
            return { w: 720, h: 1040 };
        };
        let { w, h } = getCanvasSize();
        let renderer;
        try {
            renderer = new THREE.WebGLRenderer({
                canvas, alpha: true, antialias: w >= 160, preserveDrawingBuffer: true,
                powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false
            });
        } catch(e) {
            this._mmdShowStatus('WebGL 不可用');
            return;
        }
        const dpr = Math.min(window.devicePixelRatio || 1, w >= 256 ? 1.5 : 1);
        renderer.setPixelRatio(dpr);
        renderer.setSize(w, h, false);
        renderer.setClearColor(0x000000, 0);
        this._mmdRenderer = renderer;
        this._mmdCanvas = canvas;
        this._mmdProgress(25, 'WebGL', '渲染器就绪');

        canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            if (this._mmdRAF) { cancelAnimationFrame(this._mmdRAF); this._mmdRAF = null; }
        }, false);
        canvas.addEventListener('webglcontextrestored', () => {
            if (this.mmdMesh) this._mmdRender();
        }, false);

        // 鼠标跟随：头部骨骼看向鼠标（仅在灵体附近响应，小尺寸时降低灵敏度）
        this._mmdMouseX = 0; this._mmdMouseY = 0;
        this._mmdMouseHandler = (e) => {
            const rect = canvas.getBoundingClientRect();
            if (rect.width < 50) { this._mmdMouseX = 0; this._mmdMouseY = 0; return; }
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dx = e.clientX - cx, dy = e.clientY - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const radius = Math.max(rect.width, rect.height) * 2;
            if (dist > radius) { this._mmdMouseX *= 0.9; this._mmdMouseY *= 0.9; return; }
            this._mmdMouseX = Math.max(-1, Math.min(1, dx / (rect.width * 2)));
            this._mmdMouseY = Math.max(-1, Math.min(1, dy / (rect.height * 2)));
        };
        document.addEventListener('mousemove', this._mmdMouseHandler);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 1000);
        camera.position.set(0, 8, 28);
        camera.lookAt(0, 8, 0);
        this._mmdCamera = camera;
        this._mmdScene = scene;

        // 灵体尺寸变化时自适应分辨率和宽高比
        if (this._mmdResizeObs) this._mmdResizeObs.disconnect();
        this._mmdResizeObs = new ResizeObserver(() => {
            if (!this._mmdRenderer) return;
            const { w: nw, h: nh } = getCanvasSize();
            this._mmdRenderer.setSize(nw, nh, false);
            this._mmdCamera.aspect = nw / nh;
            this._mmdCamera.updateProjectionMatrix();
        });
        this._mmdResizeObs.observe(this.characterEl);

        // 监听灵体停靠状态，切换坐姿
        this._mmdDocked = false;
        if (this._mmdClassObs) this._mmdClassObs.disconnect();
        const orbEl = document.getElementById('orb');
        if (orbEl) {
            this._mmdClassObs = new MutationObserver(() => {
                this._mmdDocked = orbEl.classList.contains('bar-docked');
            });
            this._mmdClassObs.observe(orbEl, { attributes: true, attributeFilter: ['class'] });
        }

        scene.add(new THREE.AmbientLight(0xffffff, 0.9));
        const dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(5, 15, 10);
        scene.add(dir);
        const fill = new THREE.DirectionalLight(0xffeedd, 0.4);
        fill.position.set(-5, 5, -5);
        scene.add(fill);
        scene.add(new THREE.HemisphereLight(0xfff5e6, 0x444466, 0.5));

        const modelUrl = skin.model_url;

        // 自定义 LoadingManager：修正贴图路径大小写和斜杠问题
        const texManager = new THREE.LoadingManager();
        texManager.setURLModifier((url) => {
            if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url;
            if (url.startsWith('http://') || url.startsWith('https://')) return url;
            let fixedUrl = url.replace(/\\/g, '/');
            // 缺失的Toon贴图(.bmp)用对应的PNG贴图代替（支持两种格式，BMP不存在时用PNG）
            // 例如: _04_Toon.bmp -> _04.png
            if (fixedUrl.includes('_Toon.bmp')) {
                const originalName = fixedUrl.split('/').pop();
                const pngName = originalName.replace('_Toon.bmp', '.png');
                fixedUrl = fixedUrl.replace(originalName, pngName);
            }
            return fixedUrl;
        });
        const loader = new mod.MMDLoader(texManager);

        // 15 秒超时
        let timedOut = false;
        const loadTimeout = setTimeout(() => {
            timedOut = true;
            this._mmdProgress(0, '超时', '15秒无响应');
            this._mmdShowStatus('解析超时（15秒）\n模型可能不兼容');
        }, 15000);

        // 模型加载完成的回调（提取为变量，预加载时可以直接调用）
        const onModelLoaded = (mesh) => {
            if (timedOut) return;
            clearTimeout(loadTimeout);
            this._mmdProgress(85, '解析', '构建几何体...');
            try {
                this.mmdMesh = mesh;
                this.mmdScene = scene;
                this.mmdCamera = camera;
                this.mmdRenderer = renderer;
                this.mmdTHREE = THREE;
                scene.add(mesh);

                const box = new THREE.Box3().setFromObject(mesh);
                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());

                // 灵体取景：增加边距，确保模型完整显示（考虑动画时会超出bounding box）
                const aspect = w / h;
                const fovRad = camera.fov * Math.PI / 180;
                // 高度和宽度都增加边距（0.65/0.7），并乘以1.25的安全系数
                const fitDistY = (size.y * 0.65) / Math.tan(fovRad / 2);
                const fitDistX = (size.x * 0.70) / (Math.tan(fovRad / 2) * aspect);
                // 考虑模型深度，确保z轴也在视野内
                const fitDistZ = (size.z * 0.5) / Math.tan(fovRad / 2);
                const fitDist = Math.max(fitDistY, fitDistX, fitDistZ) * 1.25;
                camera.position.set(center.x, center.y + size.y * 0.02, center.z + fitDist);
                camera.lookAt(center.x, center.y, center.z);
                this.mmdCenter = center;
                this.mmdBaseY = camera.position.y;
                this.mmdBaseZ = camera.position.z;
                this.mmdModelSize = size;
                console.log('[MMD] 相机设置: 距离=', fitDist.toFixed(1),
                    '模型尺寸=', size.x.toFixed(1), 'x', size.y.toFixed(1), 'x', size.z.toFixed(1),
                    'aspect=', aspect.toFixed(2));

                // 调试信息
                let vertCount = 0, matCount = 0;
                mesh.traverse(o => {
                    if (o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
                        vertCount += o.geometry.attributes.position.count;
                    }
                    if (o.material) {
                        matCount += Array.isArray(o.material) ? o.material.length : 1;
                    }
                });
                const dbg = `顶点:${vertCount} 材质:${matCount} 尺寸:${size.x.toFixed(1)}x${size.y.toFixed(1)}x${size.z.toFixed(1)}`;
                console.log('[MMD] 模型加载成功:', dbg, '相机:', camera.position.toArray().map(v=>v.toFixed(1)));
                this._mmdProgress(95, '渲染', dbg);
                // 重置加载标志
                this._mmdIsLoading = false;
                this._mmdLoadingSkinId = null;

                // 主动替换材质：MMD 自定义 shader 在 QtWebEngine 中渲染黑色
                // 用 MeshPhongMaterial 保留贴图和颜色，确保可见
                const replaceMaterials = () => {
                    let textureCount = 0;
                    let loadedTextures = 0;
                    mesh.traverse(o => {
                        if (!o.isMesh || !o.material) return;
                        const origMats = Array.isArray(o.material) ? o.material : [o.material];
                        const newMats = origMats.map(om => {
                            // 获取原始颜色，如果颜色太暗则使用白色
                            let col = 0xffffff;
                            if (om.color && om.color.r !== undefined) {
                                const maxC = Math.max(om.color.r, om.color.g, om.color.b);
                                if (maxC > 0.05) col = om.color.clone();
                            }
                            // 处理贴图：监听加载完成事件
                            let map = om.map || null;
                            if (map && !map.image) {
                                textureCount++;
                                map.addEventListener('update', () => {
                                    loadedTextures++;
                                    if (loadedTextures >= textureCount) {
                                        console.log('[MMD] 所有贴图加载完成');
                                    }
                                });
                            }
                            // emissive：只有原始材质有emissive且不为黑色时才保留
                            let emissive = 0x000000;
                            let emissiveIntensity = 0;
                            if (om.emissive) {
                                const em = om.emissive;
                                const emMax = Math.max(em.r || 0, em.g || 0, em.b || 0);
                                if (emMax > 0.05) {
                                    emissive = om.emissive.clone();
                                    emissiveIntensity = om.emissiveIntensity || 0.3;
                                }
                            }
                            const params = {
                                color: col,
                                map: map,
                                transparent: om.transparent || false,
                                opacity: om.opacity !== undefined ? om.opacity : 1,
                                side: THREE.DoubleSide,
                                emissive: emissive,
                                emissiveIntensity: emissiveIntensity,
                                shininess: om.shininess || 30
                            };
                            if (om.emissiveMap) params.emissiveMap = om.emissiveMap;
                            if (om.alphaMap) params.alphaMap = om.alphaMap;
                            if (om.normalMap) { params.normalMap = om.normalMap; params.normalScale = om.normalScale; }
                            if (om.specularMap) params.specularMap = om.specularMap;
                            if (om.specular) params.specular = om.specular;
                            const newMat = new THREE.MeshPhongMaterial(params);
                            newMat.needsUpdate = true;
                            return newMat;
                        });
                        o.material = Array.isArray(o.material) ? newMats : newMats[0];
                        o.castShadow = false;
                        o.receiveShadow = false;
                    });
                    console.log('[MMD] 材质已替换为 PhongMaterial（保留贴图，emissive已优化）',
                        '贴图数量:', textureCount);
                };
                replaceMaterials();

                // 查找身体各部位骨骼（MMD 标准日文名 + 英文名）
                this._mmdHeadBone = null;
                this._mmdNeckBone = null;
                this._mmdSpineBones = []; // 所有脊柱骨骼（按从下到上排序）
                this._mmdSpineBone = null;   // 脊柱下（Spine）
                this._mmdChestBone = null;   // 胸腔（Chest）
                this._mmdUpperChestBone = null; // 上胸（UpperChest）
                this._mmdArmBones = { left: null, right: null };
                this._mmdElbowBones = { left: null, right: null };
                this._mmdShoulderBones = { left: null, right: null };
                this._mmdLegBones = { left: null, right: null };
                this._mmdKneeBones = { left: null, right: null };
                this._mmdAnkleBones = { left: null, right: null };
                this._mmdToeBones = { left: null, right: null }; // 脚趾
                this._mmdHipBone = null;
                this._mmdBlinkMorphs = [];
                this._mmdBrowMorphs = [];
                this._mmdMouthMorphs = [];
                this._mmdBoneRest = {}; // 保存骨骼初始旋转
                this._mmdBoneRestPos = {}; // 保存骨骼初始位置
                // 手部骨骼（用于手势系统）
                this._mmdHandBones = {
                    left: { wrist: null, thumb: [], index: [], middle: [], ring: [], pinky: [] },
                    right: { wrist: null, thumb: [], index: [], middle: [], ring: [], pinky: [] }
                };
                // 手势系统状态
                this._mmdGesture = { current: 'relax', target: 'relax', blend: 1, startTime: 0 };
                mesh.traverse(o => {
                    if (o.isBone && o.name) {
                        const n = o.name.toLowerCase();
                        this._mmdBoneRest[o.id] = { x: o.rotation.x, y: o.rotation.y, z: o.rotation.z };
                        this._mmdBoneRestPos[o.id] = { x: o.position.x, y: o.position.y, z: o.position.z };
                        // 头部
                        if ((n.includes('head') || n.includes('頭') || n === '首') && !n.includes('eye') && !n.includes('brow') && !n.includes('jaw') && !n.includes('neck')) {
                            if (!this._mmdHeadBone) this._mmdHeadBone = o;
                        }
                        // 脖子
                        if (n === 'neck' || n.includes('首') && n.includes('neck') || n === '首根') {
                            if (!this._mmdNeckBone) this._mmdNeckBone = o;
                        }
                        // 脊柱/上半身/腰 - 区分Spine、Chest、UpperChest
                        if (n.includes('spine') || n.includes('upperbody') || n.includes('upper body') || n.includes('上半身') || n === '上半身2' || n.includes('上体') || n.includes('waist') || n === '腰') {
                            this._mmdSpineBones.push(o);
                            // 区分具体骨骼
                            if (n.includes('upperchest') || n.includes('upper chest') || n === '上半身2' || n.includes('上胸')) {
                                if (!this._mmdUpperChestBone) this._mmdUpperChestBone = o;
                            } else if (n.includes('chest') || n === '上半身' || n.includes('胸腔') || n.includes('胸')) {
                                if (!this._mmdChestBone) this._mmdChestBone = o;
                            } else if (n.includes('spine') || n.includes('waist') || n === '腰' || n.includes('下半身')) {
                                if (!this._mmdSpineBone) this._mmdSpineBone = o;
                            }
                        }
                        // 臀部/下半身/中心
                        if (n === 'hip' || n === 'hips' || n.includes('下半身') || n.includes('下身') || n.includes('骨盤') || n === 'center' || n === 'センター') {
                            if (!this._mmdHipBone) {
                                this._mmdHipBone = o;
                                this._mmdHipRestX = o.position.x;
                            }
                        }
                        // 肩膀
                        if (n.includes('left shoulder') || n === '左肩' || n === 'l shoulder') {
                            if (!this._mmdShoulderBones.left) this._mmdShoulderBones.left = o;
                        }
                        if (n.includes('right shoulder') || n === '右肩' || n === 'r shoulder') {
                            if (!this._mmdShoulderBones.right) this._mmdShoulderBones.right = o;
                        }
                        // 上臂
                        if (!n.includes('twist') && !n.includes('捩')) {
                            if ((n.includes('left arm') || n.includes('left_arm') || n === '左腕' || n === 'l arm') && !n.includes('elbow') && !n.includes('ひじ')) {
                                if (!this._mmdArmBones.left) this._mmdArmBones.left = o;
                            }
                            if ((n.includes('right arm') || n.includes('right_arm') || n === '右腕' || n === 'r arm') && !n.includes('elbow') && !n.includes('ひじ')) {
                                if (!this._mmdArmBones.right) this._mmdArmBones.right = o;
                            }
                        }
                        // 肘部/前臂
                        if (n.includes('left elbow') || n.includes('left_elbow') || n.includes('左ひじ') || n === '左肘' || n.includes('left forearm')) {
                            if (!this._mmdElbowBones.left) this._mmdElbowBones.left = o;
                        }
                        if (n.includes('right elbow') || n.includes('right_elbow') || n.includes('右ひじ') || n === '右肘' || n.includes('right forearm')) {
                            if (!this._mmdElbowBones.right) this._mmdElbowBones.right = o;
                        }
                        // 手腕
                        if ((n.includes('left hand') || n.includes('left_hand') || n === '左手首' || n.includes('left wrist') || n === 'l hand') && !n.includes('finger') && !n.includes('指')) {
                            if (!this._mmdHandBones.left.wrist) this._mmdHandBones.left.wrist = o;
                        }
                        if ((n.includes('right hand') || n.includes('right_hand') || n === '右手首' || n.includes('right wrist') || n === 'r hand') && !n.includes('finger') && !n.includes('指')) {
                            if (!this._mmdHandBones.right.wrist) this._mmdHandBones.right.wrist = o;
                        }
                        // 手指（拇指/食指/中指/无名指/小指）
                        const isLeft = n.includes('left') || n.includes('左') || n.startsWith('l ');
                        const isRight = n.includes('right') || n.includes('右') || n.startsWith('r ');
                        const handSide = isLeft ? 'left' : (isRight ? 'right' : null);
                        if (handSide) {
                            if (n.includes('thumb') || n.includes('親指') || n.includes('拇指')) {
                                this._mmdHandBones[handSide].thumb.push(o);
                            } else if (n.includes('index') || n.includes('人指') || n.includes('食指') || n.includes('人差し指')) {
                                this._mmdHandBones[handSide].index.push(o);
                            } else if (n.includes('middle') || n.includes('中指')) {
                                this._mmdHandBones[handSide].middle.push(o);
                            } else if (n.includes('ring') || n.includes('薬指') || n.includes('无名指')) {
                                this._mmdHandBones[handSide].ring.push(o);
                            } else if (n.includes('pinky') || n.includes('小指')) {
                                this._mmdHandBones[handSide].pinky.push(o);
                            }
                        }
                        // 大腿
                        if (n.includes('left leg') || n.includes('left_leg') || n === '左足' || n === '左太もも' || n === 'l leg') {
                            if (!this._mmdLegBones.left) this._mmdLegBones.left = o;
                        }
                        if (n.includes('right leg') || n.includes('right_leg') || n === '右足' || n === '右太もも' || n === 'r leg') {
                            if (!this._mmdLegBones.right) this._mmdLegBones.right = o;
                        }
                        // 膝盖
                        if (n.includes('left knee') || n.includes('left_knee') || n === '左ひざ' || n === '左膝') {
                            if (!this._mmdKneeBones.left) this._mmdKneeBones.left = o;
                        }
                        if (n.includes('right knee') || n.includes('right_knee') || n === '右ひざ' || n === '右膝') {
                            if (!this._mmdKneeBones.right) this._mmdKneeBones.right = o;
                        }
                        // 脚踝
                        if (n.includes('left ankle') || n.includes('left_ankle') || n === '左足首' || n === 'l ankle') {
                            if (!this._mmdAnkleBones.left) this._mmdAnkleBones.left = o;
                        }
                        if (n.includes('right ankle') || n.includes('right_ankle') || n === '右足首' || n === 'r ankle') {
                            if (!this._mmdAnkleBones.right) this._mmdAnkleBones.right = o;
                        }
                        // 脚趾
                        if (n.includes('left toe') || n.includes('left_toe') || n === '左足先' || n === '左つま先' || n === 'l toe') {
                            if (!this._mmdToeBones.left) this._mmdToeBones.left = o;
                        }
                        if (n.includes('right toe') || n.includes('right_toe') || n === '右足先' || n === '右つま先' || n === 'r toe') {
                            if (!this._mmdToeBones.right) this._mmdToeBones.right = o;
                        }
                    }
                    if (o.isMesh && o.morphTargetDictionary) {
                        Object.keys(o.morphTargetDictionary).forEach(k => {
                            const kl = k.toLowerCase();
                            if (kl.includes('wink') || kl.includes(' blink') || kl.includes('瞬き') || kl.includes('まばたき') || kl.includes('目を閉じる')) {
                                this._mmdBlinkMorphs.push({ mesh: o, name: k, idx: o.morphTargetDictionary[k] });
                            }
                            if (kl.includes('brow') || kl.includes('眉')) {
                                this._mmdBrowMorphs.push({ mesh: o, name: k, idx: o.morphTargetDictionary[k] });
                            }
                            if (kl.includes('mouth') || kl.includes('口') || kl.includes('smile') || kl.includes('笑')) {
                                this._mmdMouthMorphs.push({ mesh: o, name: k, idx: o.morphTargetDictionary[k] });
                            }
                        });
                    }
                });
                this._mmdBlinkTimer = 0;
                this._mmdIdleTime = performance.now();
                this._mmdBonesFound = {
                    head: !!this._mmdHeadBone,
                    spine: this._mmdSpineBones.length,
                    arms: !!(this._mmdArmBones.left || this._mmdArmBones.right),
                    hip: !!this._mmdHipBone
                };
                console.log('[MMD] 骨骼:', JSON.stringify(this._mmdBonesFound),
                    '头:', this._mmdHeadBone?.name,
                    '脖子:', this._mmdNeckBone?.name,
                    '脊柱下:', this._mmdSpineBone?.name,
                    '胸腔:', this._mmdChestBone?.name,
                    '上胸:', this._mmdUpperChestBone?.name,
                    '臀部:', this._mmdHipBone?.name,
                    '脊柱总数:', this._mmdSpineBones.length,
                    '眨眼:', this._mmdBlinkMorphs.length);
                console.log('[MMD] 上肢骨骼:',
                    '左肩:', this._mmdShoulderBones.left?.name,
                    '左大臂:', this._mmdArmBones.left?.name,
                    '左小臂:', this._mmdElbowBones.left?.name,
                    '| 右肩:', this._mmdShoulderBones.right?.name,
                    '右大臂:', this._mmdArmBones.right?.name,
                    '右小臂:', this._mmdElbowBones.right?.name);
                console.log('[MMD] 下肢骨骼:',
                    '左大腿:', this._mmdLegBones.left?.name,
                    '左小腿:', this._mmdKneeBones.left?.name,
                    '左脚踝:', this._mmdAnkleBones.left?.name,
                    '左脚趾:', this._mmdToeBones.left?.name,
                    '| 右大腿:', this._mmdLegBones.right?.name,
                    '右小腿:', this._mmdKneeBones.right?.name,
                    '右脚踝:', this._mmdAnkleBones.right?.name,
                    '右脚趾:', this._mmdToeBones.right?.name);

                // 手部骨骼检测日志
                const leftHand = this._mmdHandBones.left;
                const rightHand = this._mmdHandBones.right;
                console.log('[MMD] 手部骨骼:',
                    '左手腕:', leftHand.wrist?.name,
                    '左拇指:', leftHand.thumb.length, '左食指:', leftHand.index.length,
                    '左中指:', leftHand.middle.length, '左无名指:', leftHand.ring.length, '左小指:', leftHand.pinky.length,
                    '| 右手腕:', rightHand.wrist?.name,
                    '右拇指:', rightHand.thumb.length, '右食指:', rightHand.index.length,
                    '右中指:', rightHand.middle.length, '右无名指:', rightHand.ring.length, '右小指:', rightHand.pinky.length);

                // 首帧渲染后检查（带错误重试：three.js shader 首次编译可能间歇性失败）
                // 使用 this._mmdCheckVisibleTimer 追踪，模型重新初始化时取消旧链
                if (this._mmdCheckVisibleTimer) { clearTimeout(this._mmdCheckVisibleTimer); this._mmdCheckVisibleTimer = null; }
                const self = this;
                const checkVisible = (attempt) => {
                    // 模型已被重新初始化或销毁，停止重试
                    if (self.mmdRenderer !== renderer || !self.mmdRenderer) return;
                    try {
                        renderer.render(scene, camera);
                        const info = renderer.info;
                        const cw = canvas.width, ch = canvas.height;
                        if (attempt === 0) {
                            console.log('[MMD] 首帧: drawCalls=' + info.render.calls + ' tris=' + info.render.triangles + ' buffer=' + cw + 'x' + ch);
                        }
                        const gl = renderer.getContext();
                        const px = new Uint8Array(4);
                        gl.readPixels(Math.floor(cw/2), Math.floor(ch/2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
                        console.log('[MMD] 中心像素 RGBA:', px[0], px[1], px[2], px[3], '(attempt ' + attempt + ')');
                        if (px[3] < 10 && attempt < 5) {
                            self._mmdCheckVisibleTimer = setTimeout(() => checkVisible(attempt + 1), 500);
                        }
                    } catch(e) {
                        // three.js shader 首次编译可能间歇性失败（uniform null / trim 错误），延迟重试
                        console.warn('[MMD] 渲染检查失败（第' + attempt + '次），500ms后重试:', e.message);
                        if (attempt < 5) {
                            self._mmdCheckVisibleTimer = setTimeout(() => checkVisible(attempt + 1), 500);
                        } else {
                            console.error('[MMD] 渲染检查多次失败，跳过:', e);
                        }
                    }
                };
                this._mmdCheckVisibleTimer = setTimeout(() => checkVisible(0), 300);

                // ===== ProceduralAnimator：统一程序化动作引擎 =====
                if (typeof ProceduralAnimator !== 'undefined') {
                    try {
                        this._procAnim = new ProceduralAnimator(mesh, { THREE: THREE, isVRM: false });
                        const detected = this._procAnim.detect();
                        if (detected) {
                            // 禁用 autoCorrectPose：修改休息姿势会导致模型变形，保持原始姿势
                            // this._procAnim.autoCorrectPose();
                            const report = this._procAnim.getDetectionReport();
                            const foundCount = Object.values(report).filter(v => v && typeof v === 'string').length;
                            console.log('[ProceduralAnimator] 骨骼检测:', foundCount + '/25 标准部位',
                                '形态键: blink=' + report.morphs.blink + ' smile=' + report.morphs.smile + ' mouth=' + report.morphs.mouthOpen,
                                '总骨骼:', report.totalBones);
                        }
                    } catch (e) {
                        console.warn('[ProceduralAnimator] 初始化失败:', e);
                        this._procAnim = null;
                    }
                }

                this._mmdStart = performance.now();
                this._mmdRender();
                this._mmdClearStatus();
                this._mmdProgress(100, '完成', skin.name || 'MMD');

                // 加载背景板
                const stageUrl = localStorage.getItem('mrhua_orb_stage_' + this.getIdentityKey());
                const stageType = localStorage.getItem('mrhua_orb_stage_type_' + this.getIdentityKey()) || 'mmd';
                if (stageUrl) {
                    this._mmdShowStatus('正在加载背景板...');
                    if (stageType === 'gltf' || /\.(glb|gltf)$/i.test(stageUrl)) {
                        const GLTFLoader = this._mmdModule && this._mmdModule.GLTFLoader;
                        if (GLTFLoader) {
                            const gltfLoader = new GLTFLoader();
                            gltfLoader.load(stageUrl, (gltf) => {
                                this._showFullscreenStage(gltf.scene, THREE);
                                this._mmdClearStatus();
                                orb.classList.add('has-stage');
                                console.log('[MMD] glTF 背景板加载成功（全屏）');
                            }, (xhr) => {
                                if (xhr.lengthComputable) {
                                    const pct = Math.round(xhr.loaded / xhr.total * 100);
                                    this._mmdShowStatus('背景板加载中 ' + pct + '%');
                                }
                            }, (err) => {
                                console.warn('glTF stage load failed:', err);
                                this._mmdShowStatus('背景板加载失败');
                                setTimeout(() => this._mmdClearStatus(), 2000);
                            });
                        } else {
                            this._mmdShowStatus('GLTFLoader 未就绪');
                            setTimeout(() => this._mmdClearStatus(), 2000);
                        }
                    } else {
                        // MMD PMX 背景板也用全屏渲染
                        const stageLoader = new mod.MMDLoader();
                        stageLoader.load(stageUrl, (stageMesh) => {
                            this._showFullscreenStage(stageMesh, THREE);
                            orb.classList.add('has-stage');
                            this._mmdClearStatus();
                        }, undefined, (err) => {
                            console.warn('Stage load failed:', err);
                            this._mmdShowStatus('背景板加载失败');
                            setTimeout(() => this._mmdClearStatus(), 2000);
                        });
                    }
                }
            } catch (e) {
                console.error('MMD mesh processing error:', e);
                this._mmdProgress(0, '错误', e.message || '处理失败');
                this._mmdShowStatus('模型处理失败\n' + (e.message || ''));
            }
        };

        // 如果传入了预加载的mesh，直接使用，不需要网络加载
        if (preloadedMesh) {
            console.log('[MMD] 使用预加载模型，跳过网络下载');
            onModelLoaded(preloadedMesh);
            return;
        }

        // 正常加载模型
        loader.load(modelUrl, onModelLoaded, (xhr) => {
            if (timedOut) return;
            if (xhr.lengthComputable && xhr.total > 0) {
                const pct = Math.round(xhr.loaded / xhr.total * 100);
                // 下载阶段占 25%-80%，解析占 80%-100%
                const termPct = 25 + Math.round(pct * 0.55);
                if (pct < 100) {
                    this._mmdShowStatus('下载模型 ' + pct + '%');
                    this._mmdProgress(termPct, '下载', pct + '%');
                } else {
                    this._mmdShowStatus('正在解析模型...');
                    this._mmdProgress(80, '解析', 'PMX 解析中...');
                }
            }
        }, (err) => {
            if (timedOut) return;
            clearTimeout(loadTimeout);
            console.error('MMD load error:', err);
            this._mmdProgress(0, '错误', (err && err.message) || '加载失败');
            const msg = (err && err.message) ? err.message : '可能缺少贴图或格式不支持';
            this._mmdShowStatus('模型加载失败\n' + msg);
        });
    };

    OrbSkins.prototype._mmdRender = function() {
        if (!this.mmdRenderer || !this.mmdScene || !this.mmdCamera) return;
        // 页面隐藏时暂停渲染，减少 rAF 回调触发扩展的频率
        if (document.hidden) { this._mmdRAF = requestAnimationFrame(() => this._mmdRender()); return; }
        // 帧率控制：限制最高 60fps，保证动作流畅无拖影
        const now = performance.now();
        if (this._mmdLastFrameT && now - this._mmdLastFrameT < 16) {
            this._mmdRAF = requestAnimationFrame(() => this._mmdRender());
            return;
        }
        // 计算实际帧间隔dt（限制最大值0.05秒，防止跳帧时动作跳跃）
        const prevFrameT = this._mmdLastFrameT || now;
        this._mmdLastFrameT = now;
        this._mmdRAF = requestAnimationFrame(() => this._mmdRender());
        const THREE = this.mmdTHREE || window.THREE;
        if (!THREE || !this.mmdMesh) { this.mmdRenderer.render(this.mmdScene, this.mmdCamera); return; }
        const t = (now - this._mmdStart) / 1000;
        const dt = Math.min((now - prevFrameT) / 1000, 0.016);

        // 缓存 DOM 元素，避免每帧 getElementById
        if (!this._mmdOrbEl) this._mmdOrbEl = document.getElementById('orb');
        if (!this._mmdOrbStageEl) this._mmdOrbStageEl = document.getElementById('orb-stage');
        const _orb = this._mmdOrbEl;
        const _orbStage = this._mmdOrbStageEl;
        if (_orb && _orbStage) {
            // 廉价检查（每帧）：父元素是否正确
            let _needFix = false;
            if (_orb.parentNode !== _orbStage) { _orbStage.appendChild(_orb); _needFix = true; }
            if (this.characterEl && this.characterEl.parentNode !== _orb) { _orb.appendChild(this.characterEl); _needFix = true; }
            // 廉价检查（每帧）：inline position 是否为 fixed
            if (_orb.style.position === 'fixed' || _orb.style.position === 'absolute') {
                _orb.style.position = ''; _needFix = true;
            }
            if (this.characterEl && this.characterEl.style.position === 'fixed') {
                this.characterEl.style.position = 'absolute'; _needFix = true;
            }
            // characterEl 居中样式只设置一次（避免每帧60次DOM变更触发扩展疯狂响应）
            if (this.characterEl && !this._charStyleLocked) {
                this.characterEl.style.left = '50%';
                this.characterEl.style.top = '50%';
                this.characterEl.style.transform = 'translate(-50%,-50%)';
                this.characterEl.style.bottom = 'auto';
                this.characterEl.style.right = 'auto';
                this.characterEl.style.position = 'absolute';
                this._charStyleLocked = true;
            }
            // 昂贵检查（每200ms）：getComputedStyle + getBoundingClientRect
            if (!this._domCheckTimer || performance.now() - this._domCheckTimer > 200) {
                this._domCheckTimer = performance.now();
                const _orbPos = getComputedStyle(_orb).position;
                if (_orbPos === 'fixed' || _orbPos === 'absolute') {
                    _orb.style.position = 'relative'; _needFix = true;
                }
                const _orbRect = _orb.getBoundingClientRect();
                const _stageRect = _orbStage.getBoundingClientRect();
                const _dx = Math.abs((_orbRect.left + _orbRect.width/2) - (_stageRect.left + _stageRect.width/2));
                const _dy = Math.abs((_orbRect.top + _orbRect.height/2) - (_stageRect.top + _stageRect.height/2));
                if (_dx > 20 || _dy > 20) {
                    _orb.style.position = '';
                    _orb.style.transform = '';
                    _orb.style.marginTop = '';
                    _orb.style.marginLeft = '';
                    _orb.style.left = '';
                    _orb.style.top = '';
                    _orb.style.bottom = '';
                    _orb.style.right = '';
                    if (_orb.parentNode !== _orbStage) _orbStage.appendChild(_orb);
                    // 框框分离修复后重置样式锁，下一帧重新设置居中
                    this._charStyleLocked = false;
                    _needFix = true;
                }
            }
            if (_needFix && !this._domFixLogged) {
                console.log('[OrbSkins] DOM 安全检查已修复框框分离');
                this._domFixLogged = true;
                setTimeout(() => { this._domFixLogged = false; }, 2000);
            }
        }

        // 运动状态（由外部 orb_extra.js 通过 setMotion 更新）
        const motion = this._mmdMotion || { vx: 0, vy: 0, speed: 0, flying: false };
        // 平滑运动参数
        this._mmdMotionSmooth = this._mmdMotionSmooth || { tilt: 0, yaw: 0, bank: 0, fly: 0, dock: 0 };
        const ms = this._mmdMotionSmooth;
        const speed = Math.min(motion.speed / 8, 1); // 归一化速度
        const targetTilt = speed * 0.2; // 前倾角度
        const targetYaw = motion.vx !== 0 ? Math.atan2(motion.vx, Math.abs(motion.vy) + 0.1) * 0.2 : 0;
        const targetBank = -motion.vx * 0.015;
        const targetFly = speed > 0.15 ? 1 : 0;
        const targetDock = this._mmdDocked ? 1 : 0;
        ms.tilt += (targetTilt - ms.tilt) * 0.08;
        ms.yaw += (targetYaw - ms.yaw) * 0.06;
        ms.bank += (targetBank - ms.bank) * 0.06;
        ms.fly += (targetFly - ms.fly) * 0.08;
        ms.dock += (targetDock - ms.dock) * 0.05;

        // 呼吸：多层正弦叠加，更自然
        const breath = 1 + Math.sin(t * 2.0) * 0.012 + Math.sin(t * 0.9) * 0.006;
        let pulse = 1;
        if (this._mmdPulseStart) {
            const pt = (performance.now() - this._mmdPulseStart) / 300;
            if (pt < 1) {
                pulse = 1 + (this._mmdPulse - 1) * Math.sin(pt * Math.PI);
            } else {
                this._mmdPulseStart = null;
            }
        }
        const s = breath * pulse;
        this.mmdMesh.scale.set(s, s, s);

        // 浮动 + 状态相关的运动幅度
        const stateAmp = { thinking: 0.06, working: 0.18, scanning: 0.22, sleeping: 0.02 };
        const amp = stateAmp[this.state] !== undefined ? stateAmp[this.state] : 0.12;
        // 安全重置：模型根节点 x/z 始终为 0，防止骨骼操作或外部代码导致的水平偏移累积
        this.mmdMesh.position.x = 0;
        this.mmdMesh.position.z = 0;
        this.mmdMesh.position.y = Math.sin(t * 1.8) * amp;

        // 身体整体摇摆 + 飞行姿态
        const swaySpeed = this.state === 'scanning' ? 2.0 : 0.6;
        this.mmdMesh.rotation.y = Math.sin(t * swaySpeed) * 0.1 + ms.yaw;
        this.mmdMesh.rotation.z = Math.sin(t * 0.8) * 0.025 + ms.bank;
        this.mmdMesh.rotation.x = -ms.tilt;

        // 随机闲置动作：每 4-8 秒做一次
        if (!this._mmdNextAction) this._mmdNextAction = t + 2 + Math.random() * 3;
        if (t > this._mmdNextAction) {
            this._mmdNextAction = t + 4 + Math.random() * 4;
            this._mmdActionStart = t;
            this._mmdActionType = Math.floor(Math.random() * 8);
        }
        let actX = 0, actY = 0, actZ = 0, actBodyX = 0, actBodyZ = 0, actArmL = 0, actArmR = 0, actLegL = 0, actLegR = 0;
        if (this._mmdActionStart) {
            const at = t - this._mmdActionStart;
            if (at < 2.2) {
                const env = Math.sin(at * Math.PI / 2.2) * (1 - at / 2.2);
                switch (this._mmdActionType) {
                    case 0: actY = env * 0.6; break;                    // 左右看
                    case 1: actZ = env * 0.3; break;                    // 歪头
                    case 2: actBodyX = -env * 0.1; actArmL = env * 0.4; actArmR = env * 0.4; break; // 伸展
                    case 3: actBodyX = env * 0.12; break;               // 前倾
                    case 4: actBodyZ = env * 0.1; actLegL = env * 0.08; actLegR = -env * 0.08; break; // 重心转移
                    case 5: actArmL = env * 0.2; actArmR = -env * 0.15; break; // 抖肩
                    case 6: actBodyX = env * 0.08; actArmL = env * 0.15; break; // 单手叉腰
                    case 7: actY = env * 0.4; actBodyX = -env * 0.05; break;    // 回头看
                }
            }
        }

        // 辅助：相对于初始姿态设置骨骼旋转
        const setBone = (bone, rx, ry, rz) => {
            const rest = this._mmdBoneRest[bone.id];
            if (!rest) return;
            bone.rotation.x = rest.x + rx;
            bone.rotation.y = rest.y + ry;
            bone.rotation.z = rest.z + rz;
        };

        // 脊柱运动：S 形自然弯曲，呼吸时伸展，上半身动得多
        if (this._mmdSpineBones.length > 0) {
            const breath = Math.sin(t * 2.0) * 0.01;
            const stateLean = this.state === 'thinking' ? 0.06 : this.state === 'sleeping' ? -0.12 : 0;
            const dockLean = -ms.dock * 0.08; // 停靠时微微后靠
            const sway = Math.sin(t * 0.7) * 0.025;
            const twist = Math.sin(t * 0.5) * 0.015;
            const n = this._mmdSpineBones.length;
            this._mmdSpineBones.forEach((bone, i) => {
                const k = n === 1 ? 1 : Math.pow((i + 1) / n, 1.3);
                setBone(bone,
                    breath * k + stateLean * k + actBodyX * k + dockLean * k,
                    twist * k,
                    sway * k + actBodyZ * k
                );
            });
        }

        // 脖子：头部和脊柱之间的缓冲
        if (this._mmdNeckBone) {
            setBone(this._mmdNeckBone,
                Math.sin(t * 0.8) * 0.02,
                Math.sin(t * 0.5) * 0.03,
                Math.sin(t * 0.6) * 0.015
            );
        }

        // 肩膀：呼吸时微微上下，配合手臂摆动
        if (this._mmdShoulderBones.left) {
            setBone(this._mmdShoulderBones.left,
                Math.sin(t * 2.0) * 0.02 + Math.sin(t * 1.1) * 0.015,
                0,
                Math.sin(t * 1.1) * 0.03 + actArmL * 0.3
            );
        }
        if (this._mmdShoulderBones.right) {
            setBone(this._mmdShoulderBones.right,
                Math.sin(t * 2.0 + 0.5) * 0.02 + Math.sin(t * 1.1 + 1) * 0.015,
                0,
                Math.sin(t * 1.1 + 1) * 0.03 + actArmR * 0.3
            );
        }

        // 重心/臀部：左右转移，带动全身
        const weightShift = Math.sin(t * 0.55);
        if (this._mmdHipBone) {
            setBone(this._mmdHipBone,
                Math.sin(t * 0.6) * 0.008,
                Math.sin(t * 0.4) * 0.015,
                weightShift * 0.025 + actBodyZ * 0.5
            );
            this._mmdHipBone.position.x = (this._mmdHipRestX || 0) + weightShift * 0.035;
            this._mmdHipBone.position.y = (this._mmdBoneRestPos[this._mmdHipBone.id]?.y || 0) + Math.abs(Math.sin(t * 1.1)) * 0.008;
        }

        // 大腿：重心转移时微微弯曲，停靠时轻微坐姿
        const docked = ms.dock;
        if (this._mmdLegBones.left) {
            setBone(this._mmdLegBones.left,
                Math.max(0, weightShift) * 0.04 + actLegL + docked * 0.3,
                0,
                weightShift * 0.015 + docked * 0.05
            );
        }
        if (this._mmdLegBones.right) {
            setBone(this._mmdLegBones.right,
                Math.max(0, -weightShift) * 0.04 + actLegR + docked * 0.3,
                0,
                -weightShift * 0.015 - docked * 0.05
            );
        }
        // 膝盖：自然微屈，停靠时微弯
        if (this._mmdKneeBones.left) {
            setBone(this._mmdKneeBones.left,
                0.03 + Math.max(0, weightShift) * 0.06 + Math.sin(t * 1.1) * 0.01 + docked * 0.5,
                0, 0
            );
        }
        if (this._mmdKneeBones.right) {
            setBone(this._mmdKneeBones.right,
                0.03 + Math.max(0, -weightShift) * 0.06 + Math.sin(t * 1.1 + 0.5) * 0.01 + docked * 0.5,
                0, 0
            );
        }

        // 上臂：自然摆动，配合身体重心，飞行时微向后
        const armSwing = Math.sin(t * 1.0);
        const flyArm = ms.fly;
        if (this._mmdArmBones.left) {
            setBone(this._mmdArmBones.left,
                armSwing * 0.06 + 0.02 - flyArm * 0.25,
                Math.sin(t * 0.7) * 0.02 + flyArm * 0.08,
                -weightShift * 0.03 + Math.sin(t * 1.1) * 0.04 + actArmL + flyArm * 0.1
            );
        }
        if (this._mmdArmBones.right) {
            setBone(this._mmdArmBones.right,
                -armSwing * 0.06 + 0.02 - flyArm * 0.25,
                Math.sin(t * 0.7 + 1) * 0.02 - flyArm * 0.08,
                weightShift * 0.03 + Math.sin(t * 1.1 + 1) * 0.04 + actArmR - flyArm * 0.1
            );
        }
        // 前臂/肘部：飞行时微伸
        if (this._mmdElbowBones.left) {
            setBone(this._mmdElbowBones.left,
                0.15 + Math.sin(t * 1.0 + 0.5) * 0.04 + actArmL * 0.5 - flyArm * 0.05,
                0,
                Math.sin(t * 0.8) * 0.02
            );
        }
        if (this._mmdElbowBones.right) {
            setBone(this._mmdElbowBones.right,
                0.15 + Math.sin(t * 1.0 + 1.5) * 0.04 + actArmR * 0.5 - flyArm * 0.05,
                0,
                Math.sin(t * 0.8 + 1) * 0.02
            );
        }
        // 挥手反应
        if (this._mmdReactArm && this._mmdReactStart) {
            const rt = (performance.now() - this._mmdReactStart) / 1000;
            if (rt < 1.5) {
                const rest = this._mmdBoneRest[this._mmdReactArm.id] || {x:0,y:0,z:0};
                this._mmdReactArm.rotation.z = rest.z - 1.8 + Math.sin(rt * 15) * 0.25;
                this._mmdReactArm.rotation.x = rest.x - 0.6;
                // 挥手时肘部也弯曲
                const isLeft = this._mmdReactArm === this._mmdArmBones.left;
                const elbow = isLeft ? this._mmdElbowBones.left : this._mmdElbowBones.right;
                if (elbow) {
                    const erest = this._mmdBoneRest[elbow.id] || {x:0};
                    elbow.rotation.x = erest.x + 0.8 + Math.sin(rt * 15) * 0.2;
                }
            } else {
                this._mmdReactArm = null;
                this._mmdReactStart = null;
            }
        }

        // 手势系统更新（在手臂骨骼更新之后执行，可以覆盖默认手臂动画）
        this._updateGesture(dt, t);

        // 头部转动：基础环视 + 鼠标跟随（平滑插值）+ 闲置动作 + 状态
        if (this._mmdHeadBone) {
            const rest = this._mmdBoneRest[this._mmdHeadBone.id] || {x:0,y:0,z:0};
            let targetX, targetY;
            if (this.state === 'thinking') {
                targetX = 0.2 + Math.sin(t * 0.5) * 0.1;
                targetY = Math.sin(t * 0.3) * 0.1;
            } else if (this.state === 'scanning') {
                targetX = Math.sin(t * 3) * 0.35;
                targetY = Math.sin(t * 2.2) * 0.3;
            } else if (this.state === 'sleeping') {
                targetX = -0.2;
                targetY = Math.sin(t * 0.3) * 0.05;
            } else {
                targetX = Math.sin(t * 0.6) * 0.15;
                targetY = Math.sin(t * 0.4) * 0.1;
            }
            if (this._mmdMouseX !== undefined) {
                targetX += this._mmdMouseY * 0.25;
                targetY += this._mmdMouseX * 0.35;
            }
            targetX += actX;
            targetY += actY;
            this._mmdHeadBone.rotation.y += ((rest.y + targetY) - this._mmdHeadBone.rotation.y) * 0.1;
            this._mmdHeadBone.rotation.x += ((rest.x + targetX) - this._mmdHeadBone.rotation.x) * 0.1;
            this._mmdHeadBone.rotation.z += ((rest.z + actZ) - this._mmdHeadBone.rotation.z) * 0.1;
        }

        // 身体动作系统更新（在头部转动之后执行，可以覆盖默认的头部、脊柱等动画）
        this._updateBodyAction(dt, t);

        // 眨眼：每 3-5 秒眨一次
        if (this._mmdBlinkMorphs.length > 0) {
            this._mmdBlinkTimer = (this._mmdBlinkTimer || 0) + dt;
            let blinkVal = 0;
            const blinkCycle = this._mmdBlinkTimer % 4;
            if (blinkCycle > 3.85) {
                // 快速眨眼：0.15 秒完成闭合和睁开
                const bt = (blinkCycle - 3.85) / 0.15;
                blinkVal = bt < 0.5 ? bt * 2 : 2 - bt * 2;
                blinkVal = Math.max(0, Math.min(1, blinkVal));
            }
            this._mmdBlinkMorphs.forEach(bm => {
                if (bm.mesh.morphTargetInfluences) {
                    bm.mesh.morphTargetInfluences[bm.idx] = blinkVal;
                }
            });
        }

        // 状态颜色叠加
        const stateColors = {
            thinking: 0.15, working: 0.25, scanning: 0.25,
            error: 0.4, alert: 0.4, success: 0.15, complete: 0.15,
            sleeping: 0.1
        };
        const em = stateColors[this.state] || 0;
        this.mmdMesh.traverse(o => {
            if (o.material && o.material.emissive) {
                o.material.emissive.setRGB(em * 0.6, em * 0.3, em * 0.8);
            }
        });

        // ===== ProceduralAnimator 统一动作引擎（覆盖骨骼级动画）=====
        if (this._procAnim) {
            try {
                this._procAnim.setState(this.state || 'idle');
                this._procAnim.setDock(this._mmdDocked ? 1 : 0);
                // 鼠标视线跟随
                const mx = this._mmdMouseX || 0;
                const my = this._mmdMouseY || 0;
                if (Math.abs(mx) > 0.01 || Math.abs(my) > 0.01) {
                    this._procAnim.setLookTarget(mx * 0.4, -my * 0.25, true);
                } else {
                    this._procAnim.setLookTarget(0, 0, false);
                }
                this._procAnim.update();
            } catch (e) {
                console.warn('[ProceduralAnimator] update 失败:', e);
            }
        }

        this.mmdRenderer.render(this.mmdScene, this.mmdCamera);
    };

    // ============ MMD 手势系统 ============
    // 手势配置：每个手势定义各手指的弯曲程度（0=伸直，1=完全弯曲）
    // 以及手腕、手臂的旋转角度
    const MMD_GESTURES = {
        relax: {
            desc: '放松',
            fingers: { thumb: 0.3, index: 0.4, middle: 0.4, ring: 0.4, pinky: 0.4 },
            wrist: { x: 0, y: 0, z: 0 }
        },
        open: {
            desc: '张开手掌',
            fingers: { thumb: 0.1, index: 0.05, middle: 0.05, ring: 0.05, pinky: 0.05 },
            wrist: { x: 0, y: 0, z: 0 }
        },
        fist: {
            desc: '握拳',
            fingers: { thumb: 0.8, index: 1.0, middle: 1.0, ring: 1.0, pinky: 1.0 },
            wrist: { x: 0.2, y: 0, z: 0 }
        },
        point: {
            desc: '指向',
            fingers: { thumb: 0.5, index: 0.0, middle: 1.0, ring: 1.0, pinky: 1.0 },
            wrist: { x: 0, y: 0, z: 0 }
        },
        thumbsUp: {
            desc: '点赞',
            fingers: { thumb: 0.0, index: 1.0, middle: 1.0, ring: 1.0, pinky: 1.0 },
            wrist: { x: 0, y: 0.3, z: 0 }
        },
        peace: {
            desc: '剪刀手',
            fingers: { thumb: 0.5, index: 0.0, middle: 0.0, ring: 1.0, pinky: 1.0 },
            wrist: { x: 0, y: 0, z: 0 }
        },
        rock: {
            desc: '摇滚',
            fingers: { thumb: 0.5, index: 0.0, middle: 1.0, ring: 1.0, pinky: 0.0 },
            wrist: { x: 0, y: 0, z: 0 }
        },
        wave: {
            desc: '挥手',
            fingers: { thumb: 0.2, index: 0.1, middle: 0.1, ring: 0.1, pinky: 0.1 },
            wrist: { x: 0, y: 0, z: 0 },
            waveMotion: true // 启用挥手摆动动画
        },
        ok: {
            desc: 'OK手势',
            fingers: { thumb: 0.6, index: 0.6, middle: 0.0, ring: 0.0, pinky: 0.0 },
            wrist: { x: 0, y: 0, z: 0 }
        },
        pinch: {
            desc: '捏',
            fingers: { thumb: 0.4, index: 0.4, middle: 0.8, ring: 0.9, pinky: 0.9 },
            wrist: { x: 0, y: 0, z: 0 }
        }
    };

    // 设置手势（支持左右手分别设置，或同时设置）
    OrbSkins.prototype.setGesture = function(gestureName, hand) {
        if (!this.mmdMesh || !this._mmdHandBones) return false;
        const gesture = MMD_GESTURES[gestureName];
        if (!gesture) {
            console.warn('[MMD] 未知手势:', gestureName, '可用:', Object.keys(MMD_GESTURES).join(', '));
            return false;
        }
        // hand: 'left' | 'right' | 'both'（默认both）
        const hands = hand === 'left' ? ['left'] : hand === 'right' ? ['right'] : ['left', 'right'];
        hands.forEach(h => {
            if (!this._mmdGesture[h]) {
                this._mmdGesture[h] = { current: 'relax', target: 'relax', blend: 1, startTime: 0 };
            }
            this._mmdGesture[h].target = gestureName;
            this._mmdGesture[h].startTime = performance.now();
            this._mmdGesture[h].blend = 0;
        });
        console.log('[MMD] 手势设置:', gestureName, gesture.desc, '手:', hands.join('+'));
        return true;
    };

    // 获取可用手势列表
    OrbSkins.prototype.getGestures = function() {
        return Object.entries(MMD_GESTURES).map(([key, val]) => ({ name: key, desc: val.desc }));
    };

    // 更新手势动画（在渲染循环中调用）
    OrbSkins.prototype._updateGesture = function(dt, time) {
        if (!this._mmdHandBones || !this._mmdGesture) return;

        ['left', 'right'].forEach(hand => {
            const gs = this._mmdGesture[hand];
            if (!gs) return;

            // 手势过渡（200ms淡入）
            const elapsed = (performance.now() - gs.startTime) / 1000;
            if (gs.blend < 1 && gs.target !== gs.current) {
                gs.blend = Math.min(1, elapsed / 0.2);
                if (gs.blend >= 1) {
                    gs.current = gs.target;
                }
            }

            const currentGesture = MMD_GESTURES[gs.current] || MMD_GESTURES.relax;
            const targetGesture = MMD_GESTURES[gs.target] || MMD_GESTURES.relax;
            const blend = gs.blend;

            // 应用手指旋转
            const handBones = this._mmdHandBones[hand];
            ['thumb', 'index', 'middle', 'ring', 'pinky'].forEach(finger => {
                const bones = handBones[finger];
                if (!bones || bones.length === 0) return;

                const currentCurl = currentGesture.fingers[finger] || 0;
                const targetCurl = targetGesture.fingers[finger] || 0;
                const curl = currentCurl * (1 - blend) + targetCurl * blend;

                // 每个指节都应用弯曲（越靠近指尖弯曲越大）
                bones.forEach((bone, idx) => {
                    const rest = this._mmdBoneRest[bone.id];
                    if (!rest) return;
                    // 弯曲角度：每个指节递增
                    const curlAmount = curl * (0.5 + idx * 0.3);
                    // X轴旋转（弯曲手指）
                    bone.rotation.x = rest.x + curlAmount * 1.2;
                    // 轻微的Z轴旋转（手指自然收拢）
                    if (finger !== 'thumb') {
                        const fingerIndex = ['index', 'middle', 'ring', 'pinky'].indexOf(finger);
                        bone.rotation.z = rest.z + (fingerIndex - 1.5) * 0.05 * curl;
                    }
                });
            });

            // 应用手腕旋转
            if (handBones.wrist) {
                const rest = this._mmdBoneRest[handBones.wrist.id];
                if (rest) {
                    const cw = currentGesture.wrist || { x: 0, y: 0, z: 0 };
                    const tw = targetGesture.wrist || { x: 0, y: 0, z: 0 };
                    handBones.wrist.rotation.x = rest.x + (cw.x * (1 - blend) + tw.x * blend);
                    handBones.wrist.rotation.y = rest.y + (cw.y * (1 - blend) + tw.y * blend);
                    handBones.wrist.rotation.z = rest.z + (cw.z * (1 - blend) + tw.z * blend);

                    // 挥手动作：手腕左右摆动
                    if (targetGesture.waveMotion && blend > 0.5) {
                        handBones.wrist.rotation.z += Math.sin(time * 8) * 0.15;
                    }
                }
            }
        });
    };

    // ============ MMD 身体动作系统 ============
    // 身体动作配置：每个动作定义各骨骼的旋转角度和动画曲线
    const MMD_BODY_ACTIONS = {
        nod: {
            desc: '点头',
            duration: 1.5,
            // 头部绕X轴向下旋转，然后恢复
            head: { x: [0, -0.35, -0.35, 0], y: 0, z: 0 },
            // 脖子配合头部轻微点头
            neck: { x: [0, -0.15, -0.15, 0], y: 0, z: 0 },
            // 上胸轻微跟随
            upperChest: { x: [0, -0.05, -0.05, 0], y: 0, z: 0 },
            // 脊柱轻微跟随
            spine: { x: [0, -0.08, -0.08, 0], y: 0, z: 0 }
        },
        shake: {
            desc: '摇头',
            duration: 1.8,
            // 头部绕Y轴左右旋转
            head: { x: 0, y: [-0.35, 0.35, -0.35, 0], z: 0 },
            // 脖子配合头部左右旋转
            neck: { x: 0, y: [-0.15, 0.15, -0.15, 0], z: 0 },
            // 上胸轻微跟随
            upperChest: { x: 0, y: [-0.05, 0.05, -0.05, 0], z: 0 },
            // 脊柱轻微跟随
            spine: { x: 0, y: [-0.08, 0.08, -0.08, 0], z: 0 }
        },
        bow: {
            desc: '鞠躬',
            duration: 2.0,
            head: { x: [0, 0.4, 0.4, 0], y: 0, z: 0 },
            spine: { x: [0, 0.5, 0.5, 0], y: 0, z: 0 },
            hip: { x: [0, 0.2, 0.2, 0], y: 0, z: 0 }
        },
        jump: {
            desc: '跳跃',
            duration: 1.2,
            position: { y: [0, 0.3, 0] },
            knee: { x: [0, 0.5, 0], y: 0, z: 0 },
            arm: { x: [0, -0.3, 0], y: 0, z: 0 }
        },
        sway: {
            desc: '摇摆',
            duration: 2.5,
            spine: { x: 0, y: 0, z: [-0.1, 0.1, -0.1] },
            hip: { x: 0, y: 0, z: [-0.05, 0.05, -0.05] },
            head: { x: 0, y: 0, z: [0.05, -0.05, 0.05] }
        },
        think: {
            desc: '思考',
            duration: 3.0,
            head: { x: 0.1, y: 0.1, z: -0.1 },
            spine: { x: 0.05, y: 0, z: 0 },
            rightArm: { x: -1.2, y: 0, z: 0.3 },
            rightElbow: { x: 1.5, y: 0, z: 0 },
            rightHand: 'pinch'
        },
        happy: {
            desc: '开心',
            duration: 3.0,
            // 跳跃，两次小跳
            position: { y: [0, 0.3, 0, 0.35, 0] },
            // 身体兴奋前倾
            spine: { x: [0, -0.15, 0, -0.15, 0], y: [0, 0.1, 0, 0.1, 0], z: 0 },
            // 头部开心摆动
            head: { x: [0, -0.2, 0, -0.2, 0], y: [0, 0.2, 0, 0.2, 0], z: [0, 0.1, 0, -0.1, 0] },
            neck: { x: [0, -0.1, 0, -0.1, 0], y: [0, 0.1, 0, 0.1, 0], z: 0 },
            // 双臂高高举起
            leftArm: { x: [-0.3, -2.2, -0.3, -2.2, -0.3], y: 0, z: [-0.3, -0.8, -0.3, -0.8, -0.3] },
            rightArm: { x: [-0.3, -2.2, -0.3, -2.2, -0.3], y: 0, z: [0.3, 0.8, 0.3, 0.8, 0.3] },
            // 肘部弯曲，手臂摆动
            leftElbow: { x: [0.2, 0.5, 0.2, 0.5, 0.2], y: 0, z: [0, 0.2, 0, -0.2, 0] },
            rightElbow: { x: [0.2, 0.5, 0.2, 0.5, 0.2], y: 0, z: [0, -0.2, 0, 0.2, 0] },
            // 膝盖轻微弯曲，跳跃缓冲
            leftKnee: { x: [0, 0.3, 0, 0.3, 0], y: 0, z: 0 },
            rightKnee: { x: [0, 0.3, 0, 0.3, 0], y: 0, z: 0 },
            leftHand: 'open',
            rightHand: 'open'
        },
        surprise: {
            desc: '惊讶',
            duration: 1.5,
            head: { x: [-0.2, -0.2, 0], y: 0, z: 0 },
            spine: { x: [-0.15, -0.15, 0], y: 0, z: 0 },
            leftArm: { x: [-1.0, -1.0, 0], y: 0, z: [-0.5, -0.5, 0] },
            rightArm: { x: [-1.0, -1.0, 0], y: 0, z: [0.5, 0.5, 0] },
            leftHand: 'open',
            rightHand: 'open'
        },
        shrug: {
            desc: '耸肩',
            duration: 1.5,
            leftShoulder: { x: 0, y: 0, z: [0, 0.5, 0] },
            rightShoulder: { x: 0, y: 0, z: [0, -0.5, 0] },
            leftElbow: { x: [0, 0.8, 0], y: 0, z: 0 },
            rightElbow: { x: [0, 0.8, 0], y: 0, z: 0 }
        },
        wave: {
            desc: '挥手',
            duration: 2.5,
            // 右肩抬起
            rightShoulder: { x: 0, y: 0, z: [0, -0.6, -0.6, 0] },
            // 身体轻微向右倾斜，增加动感
            spine: { x: [0, -0.05, -0.05, 0], y: [0, 0.05, 0.05, 0], z: [0, -0.03, -0.03, 0] },
            chest: { x: [0, -0.03, -0.03, 0], y: [0, 0.08, 0.08, 0], z: 0 },
            // 头部微微转向挥手方向，微笑感
            head: { x: [0, -0.1, -0.1, 0], y: [0, 0.2, 0.2, 0], z: [0, 0.12, 0.12, 0] },
            neck: { x: [0, -0.05, -0.05, 0], y: [0, 0.1, 0.1, 0], z: 0 },
            // 右臂高高抬起，大臂外展
            rightArm: { x: [-0.3, -2.7, -2.7, -0.3], y: [0, 0.2, 0.2, 0], z: [0.2, 1.15, 1.15, 0.2] },
            // 肘部弯曲，手腕左右摆动
            rightElbow: { x: [0.2, 1.1, 1.1, 0.2], y: [0, 0.15, 0.15, 0], z: [0, 0.3, -0.3, 0] },
            rightHand: 'wave',
            // 左臂自然下垂，轻微摆动
            leftArm: { x: [-0.1, -0.2, -0.2, -0.1], y: 0, z: [-0.1, -0.15, -0.15, -0.1] },
            leftElbow: { x: [0.1, 0.2, 0.2, 0.1], y: 0, z: 0 },
            leftHand: 'relax'
        },
        point: {
            desc: '指向',
            duration: 2.0,
            // 右肩抬起
            rightShoulder: { x: 0, y: 0, z: [0, -0.3, -0.3, 0] },
            // 脊柱+胸腔前倾
            spine: { x: [0, 0.1, 0.1, 0], y: 0, z: [0, 0.05, 0.05, 0] },
            chest: { x: [0, 0.08, 0.08, 0], y: 0, z: 0 },
            upperChest: { x: [0, 0.05, 0.05, 0], y: 0, z: 0 },
            // 头部看向手指方向
            head: { x: [0, -0.05, -0.05, 0], y: [0, 0.2, 0.2, 0], z: [0, 0.1, 0.1, 0] },
            neck: { x: [0, -0.03, -0.03, 0], y: [0, 0.1, 0.1, 0], z: 0 },
            // 右臂前伸，大臂外展
            rightArm: { x: [-0.2, -1.2, -1.2, -0.2], y: [0, 0.1, 0.1, 0], z: [0.1, 0.4, 0.4, 0.1] },
            // 小臂伸直
            rightElbow: { x: [0.1, 0.15, 0.15, 0.1], y: 0, z: 0 },
            rightHand: 'point',
            // 左臂自然下垂，保持平衡
            leftArm: { x: [-0.1, -0.15, -0.15, -0.1], y: 0, z: [-0.1, -0.15, -0.15, -0.1] },
            leftElbow: { x: [0.1, 0.2, 0.2, 0.1], y: 0, z: 0 },
            leftHand: 'relax'
        },
        shy: {
            desc: '害羞',
            duration: 2.5,
            head: { x: 0.2, y: -0.1, z: 0.1 },
            spine: { x: 0.1, y: 0, z: 0.05 },
            leftArm: { x: -0.8, y: 0, z: -0.2 },
            rightArm: { x: -0.8, y: 0, z: 0.2 },
            leftElbow: { x: 1.2, y: 0, z: 0 },
            rightElbow: { x: 1.2, y: 0, z: 0 },
            leftHand: 'open',
            rightHand: 'open'
        },
        angry: {
            desc: '生气',
            duration: 2.0,
            head: { x: 0.15, y: 0, z: 0 },
            spine: { x: 0.2, y: 0, z: 0 },
            leftArm: { x: -0.5, y: 0, z: -0.8 },
            rightArm: { x: -0.5, y: 0, z: 0.8 },
            leftElbow: { x: 1.5, y: 0, z: 0 },
            rightElbow: { x: 1.5, y: 0, z: 0 },
            leftHand: 'fist',
            rightHand: 'fist'
        },
        cry: {
            desc: '哭泣',
            duration: 3.0,
            head: { x: 0.3, y: 0, z: [0, 0.05, -0.05, 0] },
            spine: { x: 0.2, y: 0, z: [0, 0.03, -0.03, 0] },
            leftArm: { x: -1.0, y: 0, z: -0.3 },
            rightArm: { x: -1.0, y: 0, z: 0.3 },
            leftElbow: { x: 1.8, y: 0, z: 0 },
            rightElbow: { x: 1.8, y: 0, z: 0 },
            leftHand: 'open',
            rightHand: 'open'
        },
        sleep: {
            desc: '睡觉',
            duration: 3.0,
            head: { x: 0.4, y: 0, z: 0.1 },
            spine: { x: 0.3, y: 0, z: 0 },
            leftArm: { x: -0.3, y: 0, z: -0.2 },
            rightArm: { x: -0.3, y: 0, z: 0.2 },
            leftElbow: { x: 0.5, y: 0, z: 0 },
            rightElbow: { x: 0.5, y: 0, z: 0 },
            leftHand: 'relax',
            rightHand: 'relax'
        },
        cheer: {
            desc: '欢呼',
            duration: 3.0,
            // 跳跃，三次小跳
            position: { y: [0, 0.35, 0, 0.4, 0, 0.35, 0] },
            // 身体兴奋前倾，左右摆动
            spine: { x: [0, -0.2, 0, -0.2, 0, -0.2, 0], y: [0, 0.15, 0, -0.15, 0, 0.15, 0], z: [0, 0.1, 0, -0.1, 0, 0.1, 0] },
            // 头部开心摆动
            head: { x: [0, -0.25, 0, -0.25, 0, -0.25, 0], y: [0, 0.25, 0, -0.25, 0, 0.25, 0], z: [0, 0.15, 0, -0.15, 0, 0.15, 0] },
            neck: { x: [0, -0.15, 0, -0.15, 0, -0.15, 0], y: [0, 0.15, 0, -0.15, 0, 0.15, 0], z: 0 },
            // 双臂高高举起，握拳庆祝
            leftArm: { x: [-0.3, -2.5, -0.3, -2.5, -0.3, -2.5, -0.3], y: 0, z: [-0.3, -0.9, -0.3, -0.9, -0.3, -0.9, -0.3] },
            rightArm: { x: [-0.3, -2.5, -0.3, -2.5, -0.3, -2.5, -0.3], y: 0, z: [0.3, 0.9, 0.3, 0.9, 0.3, 0.9, 0.3] },
            // 肘部弯曲，手臂上下摆动
            leftElbow: { x: [0.3, 0.6, 0.3, 0.6, 0.3, 0.6, 0.3], y: 0, z: 0 },
            rightElbow: { x: [0.3, 0.6, 0.3, 0.6, 0.3, 0.6, 0.3], y: 0, z: 0 },
            // 膝盖弯曲，跳跃缓冲
            leftKnee: { x: [0, 0.4, 0, 0.4, 0, 0.4, 0], y: 0, z: 0 },
            rightKnee: { x: [0, 0.4, 0, 0.4, 0, 0.4, 0], y: 0, z: 0 },
            // 脚踝配合跳跃
            leftAnkle: { x: [0, -0.2, 0, -0.2, 0, -0.2, 0], y: 0, z: 0 },
            rightAnkle: { x: [0, -0.2, 0, -0.2, 0, -0.2, 0], y: 0, z: 0 },
            leftHand: 'fist',
            rightHand: 'fist'
        },
        clap: {
            desc: '鼓掌',
            duration: 2.5,
            // 身体轻微前倾，左右摆动
            spine: { x: [0, 0.1, 0, 0.1, 0, 0.1, 0], y: [0, 0.05, 0, -0.05, 0, 0.05, 0], z: 0 },
            // 头部微笑，轻微摆动
            head: { x: [0, -0.1, 0, -0.1, 0, -0.1, 0], y: [0, 0.15, 0, 0.15, 0, 0.15, 0], z: [0, 0.05, 0, -0.05, 0, 0.05, 0] },
            neck: { x: [0, -0.05, 0, -0.05, 0, -0.05, 0], y: [0, 0.08, 0, 0.08, 0, 0.08, 0], z: 0 },
            // 双臂在胸前抬起
            leftArm: { x: [-1.0, -1.2, -1.0, -1.2, -1.0, -1.2, -1.0], y: 0, z: [-0.5, -0.3, -0.5, -0.3, -0.5, -0.3, -0.5] },
            rightArm: { x: [-1.0, -1.2, -1.0, -1.2, -1.0, -1.2, -1.0], y: 0, z: [0.5, 0.3, 0.5, 0.3, 0.5, 0.3, 0.5] },
            // 肘部弯曲，双手在胸前拍击
            leftElbow: { x: [1.5, 1.8, 1.5, 1.8, 1.5, 1.8, 1.5], y: 0, z: [0, 0.4, 0, 0.4, 0, 0.4, 0] },
            rightElbow: { x: [1.5, 1.8, 1.5, 1.8, 1.5, 1.8, 1.5], y: 0, z: [0, -0.4, 0, -0.4, 0, -0.4, 0] },
            // 膝盖轻微弯曲，增加动感
            leftKnee: { x: [0, 0.1, 0, 0.1, 0, 0.1, 0], y: 0, z: 0 },
            rightKnee: { x: [0, 0.1, 0, 0.1, 0, 0.1, 0], y: 0, z: 0 },
            leftHand: 'open',
            rightHand: 'open'
        },
        salute: {
            desc: '敬礼',
            duration: 2.0,
            head: { x: 0, y: 0, z: 0 },
            spine: { x: -0.05, y: 0, z: 0 },
            rightArm: { x: -1.8, y: 0, z: 0.3 },
            rightElbow: { x: 0.5, y: 0, z: 0 },
            rightHand: 'open',
            leftArm: { x: -0.2, y: 0, z: -0.1 },
            leftElbow: { x: 0.3, y: 0, z: 0 },
            leftHand: 'relax'
        },
        crossArms: {
            desc: '抱臂',
            duration: 1.5,
            head: { x: 0.05, y: 0, z: 0 },
            spine: { x: 0.1, y: 0, z: 0 },
            leftArm: { x: -0.8, y: 0, z: 0.5 },
            rightArm: { x: -0.8, y: 0, z: -0.5 },
            leftElbow: { x: 1.5, y: 0, z: 0 },
            rightElbow: { x: 1.5, y: 0, z: 0 },
            leftHand: 'relax',
            rightHand: 'relax'
        },
        walk: {
            desc: '走路',
            duration: 2.0,
            loop: true,
            // 身体上下起伏
            position: { y: [0, 0.05, 0, 0.05, 0] },
            // 头部自然摆动
            head: { x: [0, 0.03, 0, 0.03, 0], y: [0, 0.05, 0, -0.05, 0], z: [0, 0.03, 0, -0.03, 0] },
            neck: { x: [0, 0.02, 0, 0.02, 0], y: [0, 0.03, 0, -0.03, 0], z: 0 },
            // 脊柱分层运动
            spineLower: { x: [0.08, 0.1, 0.08, 0.1, 0.08], y: 0, z: [0, 0.03, 0, -0.03, 0] },
            chest: { x: [0.05, 0.07, 0.05, 0.07, 0.05], y: 0, z: [0, 0.04, 0, -0.04, 0] },
            upperChest: { x: [0.03, 0.05, 0.03, 0.05, 0.03], y: 0, z: [0, 0.05, 0, -0.05, 0] },
            // 臀部摆动
            hip: { x: 0, y: [0, 0.05, 0, -0.05, 0], z: [0, 0.03, 0, -0.03, 0] },
            // 左臂前后摆动
            leftArm: { x: [-0.5, -0.8, -0.5, -0.2, -0.5], y: 0, z: -0.15 },
            // 右臂前后摆动（与左臂相反）
            rightArm: { x: [-0.5, -0.2, -0.5, -0.8, -0.5], y: 0, z: 0.15 },
            // 肘部自然弯曲
            leftElbow: { x: [0.5, 0.7, 0.5, 0.3, 0.5], y: 0, z: 0 },
            rightElbow: { x: [0.5, 0.3, 0.5, 0.7, 0.5], y: 0, z: 0 },
            // 左腿前后摆动
            leftLeg: { x: [0, 0.5, 0, -0.3, 0], y: 0, z: 0 },
            // 右腿前后摆动（与左腿相反）
            rightLeg: { x: [0, -0.3, 0, 0.5, 0], y: 0, z: 0 },
            // 膝盖弯曲，配合步伐
            leftKnee: { x: [0, 0.8, 0, 0.2, 0], y: 0, z: 0 },
            rightKnee: { x: [0, 0.2, 0, 0.8, 0], y: 0, z: 0 },
            // 脚踝配合步伐
            leftAnkle: { x: [0, -0.3, 0, 0.15, 0], y: 0, z: 0 },
            rightAnkle: { x: [0, 0.15, 0, -0.3, 0], y: 0, z: 0 },
            // 脚趾蹬地发力
            leftToe: { x: [0, -0.2, 0, 0.1, 0], y: 0, z: 0 },
            rightToe: { x: [0, 0.1, 0, -0.2, 0], y: 0, z: 0 },
            leftHand: 'relax',
            rightHand: 'relax'
        },
        dance: {
            desc: '跳舞',
            duration: 4.0,
            loop: true,
            // 身体上下跳动，左右摇摆
            position: { y: [0, 0.15, 0, 0.15, 0, 0.15, 0, 0.15, 0] },
            // 头部随节奏摆动
            head: { x: [0, -0.15, 0, 0.15, 0, -0.15, 0, 0.15, 0], y: [0, 0.2, 0, -0.2, 0, 0.2, 0, -0.2, 0], z: [0, 0.1, 0, -0.1, 0, 0.1, 0, -0.1, 0] },
            neck: { x: [0, -0.08, 0, 0.08, 0, -0.08, 0, 0.08, 0], y: [0, 0.1, 0, -0.1, 0, 0.1, 0, -0.1, 0], z: 0 },
            // 脊柱大幅度摆动
            spine: { x: [0, 0.15, 0, -0.15, 0, 0.15, 0, -0.15, 0], y: [0, 0.2, 0, -0.2, 0, 0.2, 0, -0.2, 0], z: [0, 0.15, 0, -0.15, 0, 0.15, 0, -0.15, 0] },
            // 臀部摆动
            hip: { x: 0, y: [0, 0.15, 0, -0.15, 0, 0.15, 0, -0.15, 0], z: [0, 0.1, 0, -0.1, 0, 0.1, 0, -0.1, 0] },
            // 左臂大幅度摆动
            leftArm: { x: [-0.5, -1.8, -0.5, -1.0, -0.5, -1.8, -0.5, -1.0, -0.5], y: 0, z: [-0.3, -1.0, -0.3, -0.6, -0.3, -1.0, -0.3, -0.6, -0.3] },
            // 右臂大幅度摆动
            rightArm: { x: [-0.5, -1.0, -0.5, -1.8, -0.5, -1.0, -0.5, -1.8, -0.5], y: 0, z: [0.3, 0.6, 0.3, 1.0, 0.3, 0.6, 0.3, 1.0, 0.3] },
            // 肘部弯曲，配合手臂摆动
            leftElbow: { x: [0.5, 1.2, 0.5, 0.8, 0.5, 1.2, 0.5, 0.8, 0.5], y: 0, z: [0, 0.3, 0, -0.3, 0, 0.3, 0, -0.3, 0] },
            rightElbow: { x: [0.5, 0.8, 0.5, 1.2, 0.5, 0.8, 0.5, 1.2, 0.5], y: 0, z: [0, -0.3, 0, 0.3, 0, -0.3, 0, 0.3, 0] },
            // 腿部配合舞蹈节奏
            leftLeg: { x: [0, 0.15, 0, -0.1, 0, 0.15, 0, -0.1, 0], y: [0, 0.08, 0, -0.08, 0, 0.08, 0, -0.08, 0], z: 0 },
            rightLeg: { x: [0, -0.1, 0, 0.15, 0, -0.1, 0, 0.15, 0], y: [0, -0.08, 0, 0.08, 0, -0.08, 0, 0.08, 0], z: 0 },
            // 膝盖弯曲，配合舞蹈
            leftKnee: { x: [0, 0.3, 0, 0.15, 0, 0.3, 0, 0.15, 0], y: 0, z: 0 },
            rightKnee: { x: [0, 0.15, 0, 0.3, 0, 0.15, 0, 0.3, 0], y: 0, z: 0 },
            // 脚踝配合舞蹈
            leftAnkle: { x: [0, -0.15, 0, 0.08, 0, -0.15, 0, 0.08, 0], y: 0, z: 0 },
            rightAnkle: { x: [0, 0.08, 0, -0.15, 0, 0.08, 0, -0.15, 0], y: 0, z: 0 },
            leftHand: 'open',
            rightHand: 'open'
        },
        turn: {
            desc: '转身',
            duration: 2.0,
            // 臀部（根旋转）：整体旋转90度
            hip: { x: 0, y: [0, 0.3, 0.6, 0.9, 1.2], z: 0 },
            // 脊柱跟随旋转（延迟一点，增加自然感）
            spineLower: { x: 0, y: [0, 0.25, 0.5, 0.8, 1.1], z: 0 },
            chest: { x: 0, y: [0, 0.2, 0.4, 0.7, 1.0], z: 0 },
            upperChest: { x: 0, y: [0, 0.15, 0.3, 0.6, 0.9], z: 0 },
            // 脖子和头部跟随旋转（最后转动）
            neck: { x: 0, y: [0, 0.1, 0.25, 0.5, 0.8], z: 0 },
            head: { x: 0, y: [0, 0.05, 0.2, 0.4, 0.7], z: 0 },
            // 肩膀自然摆动
            leftShoulder: { x: 0, y: 0, z: [0, -0.1, -0.15, -0.1, 0] },
            rightShoulder: { x: 0, y: 0, z: [0, 0.1, 0.15, 0.1, 0] },
            // 手臂自然摆动
            leftArm: { x: [0, -0.1, -0.15, -0.1, 0], y: 0, z: [0, 0.1, 0.15, 0.1, 0] },
            rightArm: { x: [0, -0.15, -0.1, -0.15, 0], y: 0, z: [0, -0.1, -0.15, -0.1, 0] },
            // 腿部微调重心
            leftLeg: { x: [0, 0.05, 0.1, 0.05, 0], y: 0, z: 0 },
            rightLeg: { x: [0, 0.1, 0.05, 0.1, 0], y: 0, z: 0 },
            // 膝盖轻微弯曲，增加重心转移感
            leftKnee: { x: [0, 0.1, 0.15, 0.1, 0], y: 0, z: 0 },
            rightKnee: { x: [0, 0.15, 0.1, 0.15, 0], y: 0, z: 0 }
        },
        sit: {
            desc: '坐下',
            duration: 1.5,
            position: { y: [0, -0.2, -0.2] },
            head: { x: [0, 0.05, 0.05], y: 0, z: 0 },
            neck: { x: [0, 0.03, 0.03], y: 0, z: 0 },
            spine: { x: [0, 0.1, 0.1], y: 0, z: 0 },
            hip: { x: [0, 0.3, 0.3], y: 0, z: 0 },
            leftLeg: { x: [0, -0.8, -0.8], y: 0, z: 0 },
            rightLeg: { x: [0, -0.8, -0.8], y: 0, z: 0 },
            leftKnee: { x: [0, 1.2, 1.2], y: 0, z: 0 },
            rightKnee: { x: [0, 1.2, 1.2], y: 0, z: 0 },
            leftAnkle: { x: [0, 0.3, 0.3], y: 0, z: 0 },
            rightAnkle: { x: [0, 0.3, 0.3], y: 0, z: 0 },
            leftArm: { x: [-0.2, -0.3, -0.3], y: 0, z: -0.1 },
            rightArm: { x: [-0.2, -0.3, -0.3], y: 0, z: 0.1 },
            leftElbow: { x: [0.3, 0.5, 0.5], y: 0, z: 0 },
            rightElbow: { x: [0.3, 0.5, 0.5], y: 0, z: 0 }
        },
        stand: {
            desc: '站立',
            duration: 1.0,
            position: { y: [-0.2, 0] },
            head: { x: [0.05, 0], y: 0, z: 0 },
            neck: { x: [0.03, 0], y: 0, z: 0 },
            spine: { x: [0.1, 0], y: 0, z: 0 },
            hip: { x: [0.3, 0], y: 0, z: 0 },
            leftLeg: { x: [-0.8, 0], y: 0, z: 0 },
            rightLeg: { x: [-0.8, 0], y: 0, z: 0 },
            leftKnee: { x: [1.2, 0], y: 0, z: 0 },
            rightKnee: { x: [1.2, 0], y: 0, z: 0 },
            leftAnkle: { x: [0.3, 0], y: 0, z: 0 },
            rightAnkle: { x: [0.3, 0], y: 0, z: 0 }
        },
        breath: {
            desc: '呼吸（自然起伏）',
            duration: 4.0,
            loop: true,
            spine: { x: [0, 0.03, 0, -0.01, 0], y: 0, z: 0 },
            head: { x: [0, 0.01, 0, -0.005, 0], y: 0, z: 0 },
            neck: { x: [0, 0.005, 0, -0.003, 0], y: 0, z: 0 }
        },
        idle: {
            desc: '待机（全身低频微动）',
            duration: 8.0,
            loop: true,
            // 头部缓慢左右微转
            head: { x: [0, 0.02, 0, -0.02, 0, 0.01, 0, -0.01, 0], y: [0, 0.04, 0, -0.04, 0, 0.02, 0, -0.02, 0], z: [0, 0.01, 0, -0.01, 0, 0.005, 0, -0.005, 0] },
            // 脖子配合头部
            neck: { x: [0, 0.015, 0, -0.015, 0], y: [0, 0.02, 0, -0.02, 0], z: 0 },
            // 脊柱下：呼吸感轻微起伏
            spineLower: { x: [0, 0.015, 0, -0.01, 0, 0.01, 0, -0.005, 0], y: 0, z: [0, 0.01, 0, -0.01, 0] },
            // 胸腔：呼吸感
            chest: { x: [0, 0.02, 0, -0.015, 0, 0.015, 0, -0.01, 0], y: 0, z: [0, 0.015, 0, -0.015, 0] },
            // 上胸：轻微晃动
            upperChest: { x: [0, 0.01, 0, -0.01, 0], y: 0, z: [0, 0.02, 0, -0.02, 0] },
            // 臀部：身体微微上下起伏（呼吸感）
            hip: { x: [0, 0.01, 0, -0.005, 0], y: [0, 0.015, 0, -0.01, 0], z: 0 },
            // 肩膀轻微晃动
            leftShoulder: { x: 0, y: 0, z: [0, 0.03, 0, -0.02, 0] },
            rightShoulder: { x: 0, y: 0, z: [0, -0.02, 0, 0.03, 0] },
            // 大臂微动
            leftArm: { x: [0, 0.02, 0, -0.01, 0], y: 0, z: [0, 0.015, 0, -0.01, 0] },
            rightArm: { x: [0, -0.01, 0, 0.02, 0], y: 0, z: [0, -0.01, 0, 0.015, 0] },
            // 大腿微动
            leftLeg: { x: [0, 0.005, 0, -0.005, 0], y: 0, z: 0 },
            rightLeg: { x: [0, -0.005, 0, 0.005, 0], y: 0, z: 0 }
        },
        relax: {
            desc: '放松站立（腿并拢、手自然下垂）',
            duration: 1.0,
            // 头部正视前方
            head: { x: 0, y: 0, z: 0 },
            neck: { x: 0, y: 0, z: 0 },
            // 脊柱挺直
            spineLower: { x: 0, y: 0, z: 0 },
            chest: { x: 0, y: 0, z: 0 },
            upperChest: { x: 0, y: 0, z: 0 },
            // 臀部正对前方
            hip: { x: 0, y: 0, z: 0 },
            // 肩膀放松下沉
            leftShoulder: { x: 0, y: 0, z: 0 },
            rightShoulder: { x: 0, y: 0, z: 0 },
            // 手臂从T-pose下垂到身体两侧（z轴控制上下，-1.0自然下垂）
            leftArm: { x: 0, y: 0, z: -0.6 },
            rightArm: { x: 0, y: 0, z: 0.6 },
            // 肘部微弯，自然下垂
            leftElbow: { x: 0.15, y: 0, z: 0 },
            rightElbow: { x: 0.15, y: 0, z: 0 },
            // 大腿并拢
            leftLeg: { x: 0, y: 0, z: -0.05 },
            rightLeg: { x: 0, y: 0, z: 0.05 },
            // 小腿伸直
            leftKnee: { x: 0, y: 0, z: 0 },
            rightKnee: { x: 0, y: 0, z: 0 },
            // 脚正对前方
            leftAnkle: { x: 0, y: 0, z: 0 },
            rightAnkle: { x: 0, y: 0, z: 0 },
            // 脚趾放松
            leftToe: { x: 0, y: 0, z: 0 },
            rightToe: { x: 0, y: 0, z: 0 },
            // 手势：放松（不要张开）
            leftHand: 'relax',
            rightHand: 'relax'
        }
    };

    // 设置身体动作
    OrbSkins.prototype.setBodyAction = function(actionName) {
        console.log('[BODY-DEBUG] setBodyAction被调用:', actionName, 'mmdMesh存在:', !!this.mmdMesh);
        if (!this.mmdMesh) {
            console.warn('[BODY-DEBUG] mmdMesh不存在，无法设置动作');
            return false;
        }
        const action = MMD_BODY_ACTIONS[actionName];
        if (!action) {
            console.warn('[MMD] 未知身体动作:', actionName, '可用:', Object.keys(MMD_BODY_ACTIONS).join(', '));
            return false;
        }
        this._bodyActionDebugged = false; // 重置调试标志，让新动作重新输出调试日志
        this._mmdBodyAction = {
            name: actionName,
            action: action,
            startTime: performance.now(),
            duration: action.duration || 2.0
        };
        // 如果动作定义了手势，同时设置手势
        if (action.leftHand) this.setGesture(action.leftHand, 'left');
        if (action.rightHand) this.setGesture(action.rightHand, 'right');
        console.log('[MMD] 身体动作:', actionName, action.desc);
        // 立即应用一帧，确保动作生效（不等待渲染循环）
        setTimeout(() => {
            if (this._mmdBodyAction && this._mmdBodyAction.name === actionName) {
                this._updateBodyAction(0, performance.now());
                console.log('[BODY-DEBUG] 已立即应用一帧');
            }
        }, 16);
        return true;
    };

    // 获取可用身体动作列表
    OrbSkins.prototype.getBodyActions = function() {
        return Object.entries(MMD_BODY_ACTIONS).map(([key, val]) => ({ name: key, desc: val.desc }));
    };

    // ============ 自动连招系统 ============
    // 预设连招
    const MMD_ACTION_COMBOS = {
        greet: {
            desc: '打招呼连招',
            actions: ['wave', 'nod', 'happy', 'relax']
        },
        happy: {
            desc: '开心连招',
            actions: ['happy', 'wave', 'nod', 'happy', 'relax']
        },
        think: {
            desc: '思考连招',
            actions: ['think', 'nod', 'shake', 'think', 'relax']
        },
        surprise: {
            desc: '惊讶连招',
            actions: ['surprise', 'shake', 'happy', 'wave', 'relax']
        },
        shy: {
            desc: '害羞连招',
            actions: ['sway', 'nod', 'sway', 'relax']
        },
        dance: {
            desc: '跳舞连招',
            actions: ['sway', 'happy', 'sway', 'wave', 'sway', 'happy', 'relax']
        },
        idle: {
            desc: '日常闲置连招',
            actions: ['breath', 'sway', 'nod', 'think', 'shake', 'breath', 'relax']
        },
        bow: {
            desc: '鞠躬致谢连招',
            actions: ['nod', 'bow', 'wave', 'happy', 'relax']
        }
    };

    // 获取可用连招列表
    OrbSkins.prototype.getCombos = function() {
        return Object.entries(MMD_ACTION_COMBOS).map(([key, val]) => ({ name: key, desc: val.desc, actions: val.actions }));
    };

    // 播放连招（自动连续播放一系列动作）
    // comboName: 连招名称（预设）或动作数组
    // options: { loop: false, interval: 800, shuffle: false, onComplete: null }
    OrbSkins.prototype.playCombo = function(comboName, options) {
        options = options || {};
        let actions;
        if (Array.isArray(comboName)) {
            actions = comboName;
        } else if (MMD_ACTION_COMBOS[comboName]) {
            actions = MMD_ACTION_COMBOS[comboName].actions;
        } else {
            console.warn('[MMD] 未知连招:', comboName, '可用:', Object.keys(MMD_ACTION_COMBOS).join(', '));
            return false;
        }
        if (options.shuffle) {
            actions = actions.slice().sort(() => Math.random() - 0.5);
        }
        this._stopCombo();
        this._comboRunning = true;
        this._comboLoop = options.loop || false;
        this._comboInterval = options.interval || 800;
        this._comboOnComplete = options.onComplete || null;
        console.log('[MMD] 开始连招:', comboName, '动作数:', actions.length, '循环:', this._comboLoop);
        this._playComboStep(actions, 0);
        return true;
    };

    // 播放连招的某一步
    OrbSkins.prototype._playComboStep = function(actions, index) {
        if (!this._comboRunning) return;
        if (index >= actions.length) {
            if (this._comboLoop) {
                console.log('[MMD] 连招循环播放');
                this._playComboStep(actions, 0);
            } else {
                console.log('[MMD] 连招播放完成');
                this._comboRunning = false;
                if (this._comboOnComplete) this._comboOnComplete();
            }
            return;
        }
        const actionName = actions[index];
        // 'relax' 是特殊动作：不播放身体动作，只等待
        if (actionName === 'relax' || actionName === 'breath') {
            // 清除当前身体动作，让模型恢复自然呼吸
            this._mmdBodyAction = null;
            const waitTime = this._comboInterval * 1.5;
            setTimeout(() => {
                this._playComboStep(actions, index + 1);
            }, waitTime);
            return;
        }
        // 播放动作
        const action = MMD_BODY_ACTIONS[actionName];
        if (!action) {
            console.warn('[MMD] 连招中未知动作:', actionName, '跳过');
            this._playComboStep(actions, index + 1);
            return;
        }
        this.setBodyAction(actionName);
        // 动作播放完成后，等待间隔，然后播放下一个
        const actionDuration = (action.duration || 2.0) * 1000;
        const totalTime = actionDuration + this._comboInterval;
        setTimeout(() => {
            this._playComboStep(actions, index + 1);
        }, totalTime);
    };

    // 停止连招
    OrbSkins.prototype.stopCombo = function() {
        this._stopCombo();
        console.log('[MMD] 连招已停止');
    };

    OrbSkins.prototype._stopCombo = function() {
        this._comboRunning = false;
        this._comboLoop = false;
    };

    // 随机播放一套连招
    OrbSkins.prototype.playRandomCombo = function(options) {
        const combos = Object.keys(MMD_ACTION_COMBOS);
        const randomCombo = combos[Math.floor(Math.random() * combos.length)];
        return this.playCombo(randomCombo, options);
    };

    // 辅助函数：根据关键帧数组和进度计算当前值
    function _interpKeyframes(keys, progress) {
        if (!keys || !Array.isArray(keys)) return keys || 0;
        if (keys.length === 1) return keys[0];
        const seg = 1 / (keys.length - 1);
        const idx = Math.min(Math.floor(progress / seg), keys.length - 2);
        const t = (progress - idx * seg) / seg;
        // 平滑插值（ease-in-out）
        const smoothT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        return keys[idx] + (keys[idx + 1] - keys[idx]) * smoothT;
    }

    // 辅助函数：根据骨骼名称获取旋转范围限制（防止动作幅度过大导致变形）
    function _getBoneLimits(boneName) {
        const n = (boneName || '').toLowerCase();
        // 头部：点头/转头/歪头范围
        if (n.includes('头') || n.includes('head')) {
            return { x: [-0.6, 0.5], y: [-0.9, 0.9], z: [-0.35, 0.35] };
        }
        // 脖子
        if (n.includes('首') || n.includes('neck')) {
            return { x: [-0.35, 0.35], y: [-0.6, 0.6], z: [-0.25, 0.25] };
        }
        // 肩膀
        if (n.includes('肩') || n.includes('shoulder')) {
            return { x: [-0.4, 0.4], y: [-0.4, 0.4], z: [-1.0, 0.6] };
        }
        // 肘部（只能弯曲，不能过度旋转）
        if (n.includes('肘') || n.includes('elbow') || n.includes('ひじ')) {
            return { x: [0, 2.3], y: [-0.6, 0.6], z: [-0.6, 0.6] };
        }
        // 手腕/手臂（大臂可以大范围举起，但有限制）
        if (n.includes('腕') || n.includes('arm') || n.includes('手首')) {
            return { x: [-2.9, 0.6], y: [-1.2, 1.2], z: [-1.6, 1.6] };
        }
        // 膝盖（只能弯曲）
        if (n.includes('膝') || n.includes('knee') || n.includes('ひざ')) {
            return { x: [0, 2.2], y: [-0.4, 0.4], z: [-0.4, 0.4] };
        }
        // 腿部
        if (n.includes('足') || n.includes('leg') || n.includes('もも')) {
            return { x: [-1.6, 1.6], y: [-0.6, 0.6], z: [-0.6, 0.6] };
        }
        // 臀部/腰
        if (n.includes('腰') || n.includes('hip') || n.includes('骨盤')) {
            return { x: [-0.6, 0.6], y: [-0.6, 0.6], z: [-0.4, 0.4] };
        }
        // 脊柱/胸腔（上半身，范围适中）
        if (n.includes('脊柱') || n.includes('spine') || n.includes('上半身') || n.includes('下半身') || n.includes('chest')) {
            return { x: [-0.4, 0.4], y: [-0.4, 0.4], z: [-0.3, 0.3] };
        }
        // 手指（弯曲范围）
        if (n.includes('指') || n.includes('finger') || n.includes('親指') || n.includes('人差指') || n.includes('中指') || n.includes('薬指') || n.includes('小指')) {
            return { x: [-0.2, 1.8], y: [-0.3, 0.3], z: [-0.3, 0.3] };
        }
        // 默认：通用限制
        return { x: [-1.5, 1.5], y: [-1.0, 1.0], z: [-1.0, 1.0] };
    }

    // 辅助函数：限制数值在范围内
    function _clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    // 辅助函数：应用骨骼旋转（带肢体范围限制，防止动作幅度过大导致变形）
    // 如果 absolute === true 或 offset.absolute === true 或 window._mmdAbsoluteMode === true，使用绝对旋转值；否则使用相对偏移量（rest + offset）
    function _applyBoneRotation(bone, rest, offset, absolute) {
        if (!bone || !rest) return;
        const limits = _getBoneLimits(bone.name);
        if (absolute || offset.absolute || window._mmdAbsoluteMode) {
            // 绝对旋转模式：直接设置骨骼旋转值（也应用范围限制）
            bone.rotation.x = _clamp(offset.x || 0, limits.x[0], limits.x[1]);
            bone.rotation.y = _clamp(offset.y || 0, limits.y[0], limits.y[1]);
            bone.rotation.z = _clamp(offset.z || 0, limits.z[0], limits.z[1]);
        } else {
            // 相对偏移模式：rest + offset（对偏移量应用范围限制）
            const ox = _clamp(offset.x || 0, limits.x[0], limits.x[1]);
            const oy = _clamp(offset.y || 0, limits.y[0], limits.y[1]);
            const oz = _clamp(offset.z || 0, limits.z[0], limits.z[1]);
            bone.rotation.x = rest.x + ox;
            bone.rotation.y = rest.y + oy;
            bone.rotation.z = rest.z + oz;
        }
    }

    // 更新身体动作（在渲染循环中调用）
    OrbSkins.prototype._updateBodyAction = function(dt, time) {
        if (!this._mmdBodyAction || !this.mmdMesh) return;

        const ba = this._mmdBodyAction;
        const action = ba.action;
        // 调试日志：只在第一次调用时输出
        if (!this._bodyActionDebugged) {
            this._bodyActionDebugged = true;
            console.log('[BODY-DEBUG] 动作开始:', ba.name, 'duration:', ba.duration);
            console.log('[BODY-DEBUG] 左臂骨骼:', this._mmdArmBones.left ? this._mmdArmBones.left.name : '未找到',
                        '右臂骨骼:', this._mmdArmBones.right ? this._mmdArmBones.right.name : '未找到');
            if (this._mmdArmBones.left) {
                const rest = this._mmdBoneRest[this._mmdArmBones.left.id];
                console.log('[BODY-DEBUG] 左臂rest:', rest ? `(${rest.x.toFixed(3)},${rest.y.toFixed(3)},${rest.z.toFixed(3)})` : '无');
            }
        }
        // 设置绝对旋转模式全局变量（relax等动作使用绝对旋转，不依赖模型默认姿势）
        window._mmdAbsoluteMode = action.absolute || false;
        const elapsed = (performance.now() - ba.startTime) / 1000;
        // 循环动作：进度循环，而不是停在1
        let progress;
        let _aw = 1; // 动作权重：淡出阶段逐渐减小到0
        const fadeDuration = action.fadeOut !== undefined ? action.fadeOut : 0.6; // 默认淡出0.6秒
        if (action.loop) {
            progress = (elapsed % ba.duration) / ba.duration;
        } else {
            if (elapsed <= ba.duration) {
                progress = elapsed / ba.duration;
            } else if (elapsed <= ba.duration + fadeDuration) {
                // 淡出阶段：保持最后一帧，权重逐渐减小
                progress = 1;
                _aw = 1 - (elapsed - ba.duration) / fadeDuration;
            } else {
                // 淡出完成，清除动作，恢复默认姿势
                this._mmdBodyAction = null;
                return;
            }
        }

        const THREE = this.mmdTHREE || window.THREE;
        // 带权重的关键帧插值（淡出时乘以权重）
        function _ikW(keys, p) { return _interpKeyframes(keys, p) * _aw; }

        // 应用头部旋转
        if (action.head && this._mmdHeadBone) {
            const rest = this._mmdBoneRest[this._mmdHeadBone.id];
            if (rest) {
                _applyBoneRotation(this._mmdHeadBone, rest, {
                    x: _ikW(action.head.x, progress),
                    y: _ikW(action.head.y, progress),
                    z: _ikW(action.head.z, progress)
                });
            }
        }

        // 应用脖子旋转
        if (action.neck && this._mmdNeckBone) {
            const rest = this._mmdBoneRest[this._mmdNeckBone.id];
            if (rest) {
                _applyBoneRotation(this._mmdNeckBone, rest, {
                    x: _ikW(action.neck.x, progress),
                    y: _ikW(action.neck.y, progress),
                    z: _ikW(action.neck.z, progress)
                });
            }
        }

        // 应用脊柱旋转（所有脊柱骨骼）
        if (action.spine && this._mmdSpineBones.length > 0) {
            this._mmdSpineBones.forEach((bone, idx) => {
                const rest = this._mmdBoneRest[bone.id];
                if (rest) {
                    const factor = 1 / (idx + 1); // 越靠上的脊柱影响越大
                    _applyBoneRotation(bone, rest, {
                        x: _ikW(action.spine.x, progress) * factor,
                        y: _ikW(action.spine.y, progress) * factor,
                        z: _ikW(action.spine.z, progress) * factor
                    });
                }
            });
        }

        // 应用脊柱下（Spine）独立旋转
        if (action.spineLower && this._mmdSpineBone) {
            const rest = this._mmdBoneRest[this._mmdSpineBone.id];
            if (rest) {
                _applyBoneRotation(this._mmdSpineBone, rest, {
                    x: _ikW(action.spineLower.x, progress),
                    y: _ikW(action.spineLower.y, progress),
                    z: _ikW(action.spineLower.z, progress)
                });
            }
        }

        // 应用胸腔（Chest）独立旋转
        if (action.chest && this._mmdChestBone) {
            const rest = this._mmdBoneRest[this._mmdChestBone.id];
            if (rest) {
                _applyBoneRotation(this._mmdChestBone, rest, {
                    x: _ikW(action.chest.x, progress),
                    y: _ikW(action.chest.y, progress),
                    z: _ikW(action.chest.z, progress)
                });
            }
        }

        // 应用上胸（UpperChest）独立旋转
        if (action.upperChest && this._mmdUpperChestBone) {
            const rest = this._mmdBoneRest[this._mmdUpperChestBone.id];
            if (rest) {
                _applyBoneRotation(this._mmdUpperChestBone, rest, {
                    x: _ikW(action.upperChest.x, progress),
                    y: _ikW(action.upperChest.y, progress),
                    z: _ikW(action.upperChest.z, progress)
                });
            }
        }

        // 应用臀部旋转
        if (action.hip && this._mmdHipBone) {
            const rest = this._mmdBoneRest[this._mmdHipBone.id];
            if (rest) {
                _applyBoneRotation(this._mmdHipBone, rest, {
                    x: _ikW(action.hip.x, progress),
                    y: _ikW(action.hip.y, progress),
                    z: _ikW(action.hip.z, progress)
                });
            }
        }

        // 应用左臂旋转
        if (action.leftArm && this._mmdArmBones.left) {
            const rest = this._mmdBoneRest[this._mmdArmBones.left.id];
            if (rest) {
                _applyBoneRotation(this._mmdArmBones.left, rest, {
                    x: _ikW(action.leftArm.x, progress),
                    y: _ikW(action.leftArm.y, progress),
                    z: _ikW(action.leftArm.z, progress)
                });
            }
        }

        // 应用右臂旋转
        if (action.rightArm && this._mmdArmBones.right) {
            const rest = this._mmdBoneRest[this._mmdArmBones.right.id];
            if (rest) {
                _applyBoneRotation(this._mmdArmBones.right, rest, {
                    x: _ikW(action.rightArm.x, progress),
                    y: _ikW(action.rightArm.y, progress),
                    z: _ikW(action.rightArm.z, progress)
                });
            }
        }

        // 应用通用手臂旋转（同时作用于左右手臂）
        if (action.arm) {
            ['left', 'right'].forEach(side => {
                const bone = this._mmdArmBones[side];
                if (bone) {
                    const rest = this._mmdBoneRest[bone.id];
                    if (rest) {
                        _applyBoneRotation(bone, rest, {
                            x: _ikW(action.arm.x, progress),
                            y: _ikW(action.arm.y, progress),
                            z: _ikW(action.arm.z, progress) * (side === 'left' ? -1 : 1)
                        });
                    }
                }
            });
        }

        // 应用左肘旋转
        if (action.leftElbow && this._mmdElbowBones.left) {
            const rest = this._mmdBoneRest[this._mmdElbowBones.left.id];
            if (rest) {
                _applyBoneRotation(this._mmdElbowBones.left, rest, {
                    x: _ikW(action.leftElbow.x, progress),
                    y: _ikW(action.leftElbow.y, progress),
                    z: _ikW(action.leftElbow.z, progress)
                });
            }
        }

        // 应用右肘旋转
        if (action.rightElbow && this._mmdElbowBones.right) {
            const rest = this._mmdBoneRest[this._mmdElbowBones.right.id];
            if (rest) {
                _applyBoneRotation(this._mmdElbowBones.right, rest, {
                    x: _ikW(action.rightElbow.x, progress),
                    y: _ikW(action.rightElbow.y, progress),
                    z: _ikW(action.rightElbow.z, progress)
                });
            }
        }

        // 应用左肩旋转
        if (action.leftShoulder && this._mmdShoulderBones.left) {
            const rest = this._mmdBoneRest[this._mmdShoulderBones.left.id];
            if (rest) {
                _applyBoneRotation(this._mmdShoulderBones.left, rest, {
                    x: _ikW(action.leftShoulder.x, progress),
                    y: _ikW(action.leftShoulder.y, progress),
                    z: _ikW(action.leftShoulder.z, progress)
                });
            }
        }

        // 应用右肩旋转
        if (action.rightShoulder && this._mmdShoulderBones.right) {
            const rest = this._mmdBoneRest[this._mmdShoulderBones.right.id];
            if (rest) {
                _applyBoneRotation(this._mmdShoulderBones.right, rest, {
                    x: _ikW(action.rightShoulder.x, progress),
                    y: _ikW(action.rightShoulder.y, progress),
                    z: _ikW(action.rightShoulder.z, progress)
                });
            }
        }

        // 应用左腿旋转
        if (action.leftLeg && this._mmdLegBones.left) {
            const rest = this._mmdBoneRest[this._mmdLegBones.left.id];
            if (rest) {
                _applyBoneRotation(this._mmdLegBones.left, rest, {
                    x: _ikW(action.leftLeg.x, progress),
                    y: _ikW(action.leftLeg.y, progress),
                    z: _ikW(action.leftLeg.z, progress)
                });
            }
        }

        // 应用右腿旋转
        if (action.rightLeg && this._mmdLegBones.right) {
            const rest = this._mmdBoneRest[this._mmdLegBones.right.id];
            if (rest) {
                _applyBoneRotation(this._mmdLegBones.right, rest, {
                    x: _ikW(action.rightLeg.x, progress),
                    y: _ikW(action.rightLeg.y, progress),
                    z: _ikW(action.rightLeg.z, progress)
                });
            }
        }

        // 应用左膝盖旋转
        if (action.leftKnee && this._mmdKneeBones.left) {
            const rest = this._mmdBoneRest[this._mmdKneeBones.left.id];
            if (rest) {
                _applyBoneRotation(this._mmdKneeBones.left, rest, {
                    x: _ikW(action.leftKnee.x, progress),
                    y: _ikW(action.leftKnee.y, progress),
                    z: _ikW(action.leftKnee.z, progress)
                });
            }
        }

        // 应用右膝盖旋转
        if (action.rightKnee && this._mmdKneeBones.right) {
            const rest = this._mmdBoneRest[this._mmdKneeBones.right.id];
            if (rest) {
                _applyBoneRotation(this._mmdKneeBones.right, rest, {
                    x: _ikW(action.rightKnee.x, progress),
                    y: _ikW(action.rightKnee.y, progress),
                    z: _ikW(action.rightKnee.z, progress)
                });
            }
        }

        // 应用通用膝盖旋转（同时作用于左右膝盖）
        if (action.knee) {
            if (this._mmdKneeBones.left) {
                const rest = this._mmdBoneRest[this._mmdKneeBones.left.id];
                if (rest) _applyBoneRotation(this._mmdKneeBones.left, rest, { x: _ikW(action.knee.x, progress) });
            }
            if (this._mmdKneeBones.right) {
                const rest = this._mmdBoneRest[this._mmdKneeBones.right.id];
                if (rest) _applyBoneRotation(this._mmdKneeBones.right, rest, { x: _ikW(action.knee.x, progress) });
            }
        }

        // 应用左脚踝旋转
        if (action.leftAnkle && this._mmdAnkleBones.left) {
            const rest = this._mmdBoneRest[this._mmdAnkleBones.left.id];
            if (rest) {
                _applyBoneRotation(this._mmdAnkleBones.left, rest, {
                    x: _ikW(action.leftAnkle.x, progress),
                    y: _ikW(action.leftAnkle.y, progress),
                    z: _ikW(action.leftAnkle.z, progress)
                });
            }
        }

        // 应用右脚踝旋转
        if (action.rightAnkle && this._mmdAnkleBones.right) {
            const rest = this._mmdBoneRest[this._mmdAnkleBones.right.id];
            if (rest) {
                _applyBoneRotation(this._mmdAnkleBones.right, rest, {
                    x: _ikW(action.rightAnkle.x, progress),
                    y: _ikW(action.rightAnkle.y, progress),
                    z: _ikW(action.rightAnkle.z, progress)
                });
            }
        }

        // 应用左脚趾旋转
        if (action.leftToe && this._mmdToeBones.left) {
            const rest = this._mmdBoneRest[this._mmdToeBones.left.id];
            if (rest) {
                _applyBoneRotation(this._mmdToeBones.left, rest, {
                    x: _ikW(action.leftToe.x, progress),
                    y: _ikW(action.leftToe.y, progress),
                    z: _ikW(action.leftToe.z, progress)
                });
            }
        }

        // 应用右脚趾旋转
        if (action.rightToe && this._mmdToeBones.right) {
            const rest = this._mmdBoneRest[this._mmdToeBones.right.id];
            if (rest) {
                _applyBoneRotation(this._mmdToeBones.right, rest, {
                    x: _ikW(action.rightToe.x, progress),
                    y: _ikW(action.rightToe.y, progress),
                    z: _ikW(action.rightToe.z, progress)
                });
            }
        }

        // 应用整体位置偏移（跳跃等）
        if (action.position) {
            const yOffset = _ikW(action.position.y, progress);
            this.mmdMesh.position.y = yOffset;
        }

        // 重置绝对旋转模式全局变量
        window._mmdAbsoluteMode = false;
    };

    OrbSkins.prototype.setMMDState = function(state) {
        // 状态变化时给一个弹跳效果（通过 _mmdPulse 叠加到呼吸缩放）
        if (this.mmdMesh) {
            this._mmdPulse = (state === 'success' || state === 'complete') ? 1.08 :
                             (state === 'error' || state === 'alert') ? 0.95 : 1;
            this._mmdPulseStart = performance.now();
        }
    };

    OrbSkins.prototype._showFullscreenStage = function(gltfScene, THREE) {
        // 销毁旧的全屏背景
        this._clearFullscreenStage();
        const canvas = document.createElement('canvas');
        canvas.id = 'orb-stage-bg';
        canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:0;pointer-events:none;';
        document.body.insertBefore(canvas, document.body.firstChild);
        let renderer;
        try {
            renderer = new THREE.WebGLRenderer({
                canvas, alpha: true, antialias: false,
                powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false
            });
        } catch(e) { console.warn('Stage renderer failed:', e); return; }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 0.75));
        renderer.setSize(window.innerWidth, window.innerHeight, false);
        renderer.setClearColor(0xf5f5f7, 1);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);

        // 光照
        scene.add(new THREE.AmbientLight(0xffffff, 1.0));
        const dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(5, 10, 7);
        scene.add(dir);
        const fill = new THREE.DirectionalLight(0xffeedd, 0.4);
        fill.position.set(-5, 5, -5);
        scene.add(fill);
        scene.add(new THREE.HemisphereLight(0xfff5e6, 0x444466, 0.5));

        // 取景：把场景放到相机前方
        const box = new THREE.Box3().setFromObject(gltfScene);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 10;
        const fovRad = camera.fov * Math.PI / 180;
        const dist = (maxDim * 0.6) / Math.tan(fovRad / 2);
        camera.position.set(0, size.y * 0.1, dist);
        camera.lookAt(0, 0, 0);

        // 重置模型位置到原点
        gltfScene.position.set(-center.x, -center.y, -center.z);
        // MMD 材质替换（MMDToonMaterial 在 QtWebEngine 渲染黑色）
        gltfScene.traverse(obj => {
            if (obj.isMesh && obj.material) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                const newMats = mats.map(om => {
                    if (om.isMeshPhongMaterial || om.isMeshStandardMaterial || om.isMeshBasicMaterial) return om;
                    const params = { color: om.color ? om.color.clone() : 0xffffff };
                    if (om.map) params.map = om.map;
                    if (om.emissive) params.emissive = om.emissive;
                    if (om.emissiveMap) params.emissiveMap = om.emissiveMap;
                    if (om.alphaMap) params.alphaMap = om.alphaMap;
                    if (om.normalMap) params.normalMap = om.normalMap;
                    if (om.specularMap) params.specularMap = om.specularMap;
                    if (om.specular) params.specular = om.specular;
                    if (om.opacity !== undefined) { params.opacity = om.opacity; params.transparent = om.transparent; }
                    if (om.side) params.side = om.side;
                    return new THREE.MeshPhongMaterial(params);
                });
                obj.material = Array.isArray(obj.material) ? newMats : newMats[0];
            }
        });
        scene.add(gltfScene);

        // 窗口大小变化
        const onResize = () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight, false);
        };
        window.addEventListener('resize', onResize);

        // 缓慢旋转/呼吸（30fps 省 GPU）
        const start = performance.now();
        let raf, lastFrame = 0;
        const animate = (now) => {
            raf = requestAnimationFrame(animate);
            if (now - lastFrame < 33) return;
            lastFrame = now;
            const t = (now - start) / 1000;
            camera.position.x = Math.sin(t * 0.05) * maxDim * 0.05;
            camera.position.y = size.y * 0.1 + Math.sin(t * 0.08) * maxDim * 0.02;
            camera.lookAt(0, 0, 0);
            renderer.render(scene, camera);
        };
        animate();

        this._stageBg = { canvas, renderer, scene, camera, onResize, raf, gltfScene };
        console.log('[MMD] 全屏背景板已启动');
    };

    OrbSkins.prototype._clearFullscreenStage = function() {
        if (this._stageBg) {
            try {
                cancelAnimationFrame(this._stageBg.raf);
                window.removeEventListener('resize', this._stageBg.onResize);
                this._stageBg.gltfScene.traverse(obj => {
                    if (obj.geometry) obj.geometry.dispose();
                    if (obj.material) {
                        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                        mats.forEach(m => {
                            ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','specularMap','alphaMap'].forEach(p => {
                                if (m[p]) try { m[p].dispose(); } catch(e){}
                            });
                            try { m.dispose(); } catch(e){}
                        });
                    }
                });
                this._stageBg.renderer.dispose();
                this._stageBg.canvas.remove();
            } catch(e) {}
            this._stageBg = null;
        }
    };

    OrbSkins.prototype.setMotion = function(vx, vy, speed) {
        // 由 orb_extra.js 每帧调用，传入灵体运动速度
        this._mmdMotion = { vx: vx || 0, vy: vy || 0, speed: speed || 0, flying: speed > 1 };
        this.setVRMMotion(vx, vy, speed);
    };

    OrbSkins.prototype.mmdReact = function(type) {
        // 点击/互动反应：type = 'happy' | 'surprise' | 'wave'
        if (!this.mmdMesh) return;
        this._mmdPulse = type === 'surprise' ? 1.15 : 1.1;
        this._mmdPulseStart = performance.now();
        if (type === 'wave' && this._mmdArmBones.right) {
            // 挥手：右臂抬起
            this._mmdReactArm = this._mmdArmBones.right;
            this._mmdReactStart = performance.now();
        }
        // 触发一次闲置动作
        this._mmdNextAction = (performance.now() - this._mmdStart) / 1000 + 0.1;
    };

    OrbSkins.prototype.destroyMMD = function() {
        // 清理自研 WebGL 渲染器
        if (this._nativeMMD) {
            try { this._nativeMMD.stop(); } catch(e){}
            try {
                const gl = this._nativeMMD.renderer && this._nativeMMD.renderer.gl;
                if (gl) { const loseExt = gl.getExtension('WEBGL_lose_context'); if (loseExt) loseExt.loseContext(); }
            } catch(e){}
            this._nativeMMD = null;
        }
        // 重置加载标志，允许重新加载
        this._mmdIsLoading = false;
        this._mmdLoadingSkinId = null;
        this._charStyleLocked = false;
        this._mmdOrbEl = null;
        this._mmdOrbStageEl = null;
        this._mmdLastFrameT = null;
        if (this._mmdDomObserver) { this._mmdDomObserver.disconnect(); this._mmdDomObserver = null; }
        if (this._mmdCheckVisibleTimer) { clearTimeout(this._mmdCheckVisibleTimer); this._mmdCheckVisibleTimer = null; }
        this.destroyVRM();
        if (this._mmdRAF) { cancelAnimationFrame(this._mmdRAF); this._mmdRAF = null; }
        this._clearFullscreenStage();
        if (this._mmdResizeObs) { this._mmdResizeObs.disconnect(); this._mmdResizeObs = null; }
        if (this._mmdClassObs) { this._mmdClassObs.disconnect(); this._mmdClassObs = null; }
        if (this._mmdMouseHandler) {
            document.removeEventListener('mousemove', this._mmdMouseHandler);
            this._mmdMouseHandler = null;
        }
        if (this.mmdRenderer) {
            try {
                const gl = this.mmdRenderer.getContext();
                if (this.mmdScene) {
                    this.mmdScene.traverse(obj => {
                        if (obj.geometry) obj.geometry.dispose();
                        if (obj.material) {
                            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                            mats.forEach(m => {
                                ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','specularMap','alphaMap'].forEach(prop => {
                                    if (m[prop]) { try { m[prop].dispose(); } catch(e){} }
                                });
                                try { m.dispose(); } catch(e){}
                            });
                        }
                    });
                }
                this.mmdRenderer.dispose();
                if (gl) {
                    const loseExt = gl.getExtension('WEBGL_lose_context');
                    if (loseExt) loseExt.loseContext();
                }
            } catch(e) {}
            this.mmdRenderer = null;
            this.mmdScene = null;
            this.mmdCamera = null;
            this.mmdMesh = null;
            this.mmdStage = null;
        }
    };

    // ============ 挂载 ============
    window.OrbSkins = new OrbSkins();

    const style = document.createElement('style');
    style.textContent = `
        #orb.skin-blob { background: radial-gradient(circle at 30% 30%, rgba(255,107,107,0.85), rgba(78,205,196,0.7), rgba(255,190,11,0.8)); }
        #orb.skin-svg, #orb.skin-live2d, #orb.skin-mmd {
            background: none !important; box-shadow: none !important;
            border-radius: 50% !important;
            animation: orbFloat 3s ease-in-out infinite !important;
        }
        #orb.skin-svg *, #orb.skin-live2d *, #orb.skin-mmd * { pointer-events: none; }
        @keyframes orbFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        #orb-character.svg-breathing { animation: svgBreathe 2.5s ease-in-out infinite; transform-origin: center; }
        @keyframes svgBreathe { 0%,100%{transform:scale(1)} 50%{transform:scale(1.04)} }
        #orb.skin-svg.sleeping #orb-character, #orb.skin-live2d.sleeping #orb-character, #orb.skin-mmd.sleeping #orb-character { opacity:0.7; }
        #orb.skin-svg #orb-inner, #orb.skin-live2d #orb-inner, #orb.skin-mmd #orb-inner { display:none; }
        #orb.companion.skin-svg #orb-character, #orb.bar-docked.skin-svg #orb-character,
        #orb.companion.skin-mmd #orb-character, #orb.bar-docked.skin-mmd #orb-character { padding:2px; }
    `;
    document.head.appendChild(style);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.OrbSkins.init());
    } else {
        window.OrbSkins.init();
    }

    // 挂钩 OrbHub.setState
    const _hook = setInterval(() => {
        if (window.OrbHub && window.OrbHub.setState) {
            clearInterval(_hook);
            const _orig = window.OrbHub.setState;
            window.OrbHub.setState = function(s) {
                _orig(s);
                if (window.OrbSkins) window.OrbSkins.setState(s);
            };
        }
    }, 100);

})();
