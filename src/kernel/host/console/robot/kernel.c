/* ===========================================================================
 * kernel.c —— 32 位裸机内核 + 三自由度平面机械臂实时演示
 *
 * 这个内核在原来的基础上保留了三件事，一行没改语义：
 *     保护模式入口、GDT、0~4MB 恒等分页、双进程协作式上下文切换
 * 换掉的只有一件事：原来两个进程各打印一个计数器，现在
 *     proc1 = 控制器  算一步：正运动学 -> 几何雅可比 -> 阻尼最小二乘 -> 零空间投影
 *     proc2 = 渲染器  画一帧：ASCII 机械臂 + 数值面板
 *
 * 为什么全程用定点数、不用 float
 *   内核没有任何中断表（IDT），cli 之后一路到死；一旦触发 CPU 异常就是三重故障，
 *   屏幕直接黑掉、什么都不打印。更关键的是：两个进程切换时不保存 FPU 状态，
 *   也没有 CR0.TS 惰性切换（那同样要 IDT）。两个进程只要有一个用浮点，就会互相
 *   踩掉 x87 的栈。所以这里全部用 Q16.16 定点数，运算只依赖整数指令，
 *   顺带还有一个好处：定点数下"关节速度 935"会真的逼近溢出，现象更直观。
 *
 * 物理内存布局（boot.asm 已建立 0~4MB 恒等分页）
 *   0x00001000  内核镜像 (.text/.rodata/.data/.bss)   ← 必须整体待在 0x3000 以下
 *   0x00003000  proc1 栈（栈顶 0x4000）
 *   0x00004000  proc2 栈（栈顶 0x5000）
 *   0x00005000  内核主线程栈（栈顶 0x6000）
 *   0x00010000  页目录 PD / 0x00011000 页表 PT（boot.asm 用，内核不碰）
 *   0x00020000  影子显存 4000 字节（见下）—— 放这么高是为了不侵占 .bss 的 8KB 预算
 *   0x000B8000  VGA 文本显存（80x25，每字符 2 字节：字符 + 属性）
 * =========================================================================== */

typedef signed   int        i32;
typedef unsigned int        u32;
typedef unsigned short      u16;
typedef unsigned char       u8;
typedef signed   long long  i64;
typedef unsigned long long  u64;

#define VID_MEM        0xB8000
#define SHADOW         0x20000   /* 影子显存：先画在这里，再一次性搬到 0xB8000 */

/* ---- 串口帧协议：与 src/kernel/host/bridge/serial_bridge.py 一致 ----
 * QEMU 的 COM1 只输出 80x25 文本单元的差量。帧格式：
 *   A5 5A 01 COUNT [row col ch attr] * COUNT CRC
 * 快照放在 0x30000，避免再占内核镜像本身不到 8KB 的空间。
 */
#define SERIAL_COM1      0x3F8
#define FRAME_SNAP       0x30000
#define FRAME_SYNC0      0xA5
#define FRAME_SYNC1      0x5A
#define FRAME_TYPE_DELTA 0x01
#define FRAME_MAX_CELLS  32
#define FRAME_HDR        4
#define FRAME_BUF        (FRAME_HDR + FRAME_MAX_CELLS * 4 + 1)
#define SCR_CELLS        (80 * 25)

/* ---- 颜色 ---- */
#define C_GRAY   0x08
#define C_DGRAY  0x07
#define C_WHITE  0x0F
#define C_GREEN  0x0A
#define C_RED    0x0C
#define C_YELLOW 0x0E
#define C_CYAN   0x0B
#define C_BLUE   0x09
#define C_MAG    0x0D

/* 端口输入（键盘控制器、VGA 状态寄存器要用） */
static inline u8 inb(u16 port)
{
    u8 r;
    __asm__ __volatile__("inb %1, %0" : "=a"(r) : "Nd"(port));
    return r;
}

static inline void outb(u16 port, u8 v)
{
    __asm__ __volatile__("outb %0, %1" : : "a"(v), "Nd"(port));
}

/* 常用的 Q16.16 常量，写成整数避免任何浮点参与 */
#define FX_0_02  1311
#define FX_0_06  3932
#define FX_0_03  1966
#define FX_0_10  6554
#define FX_1_20  78643
#define FX_2_40  157286
#define FX_3_00  196608

/* ---- CP437 制表符与方块（VGA 文本模式原生字符集） ---- */
#define CH_H   0xC4   /* ─ */
#define CH_V   0xB3   /* │ */
#define CH_TL  0xDA   /* ┌ */
#define CH_TR  0xBF   /* ┐ */
#define CH_BL  0xC0   /* └ */
#define CH_BR  0xD9   /* ┘ */
#define CH_TT  0xC2   /* ┬ */
#define CH_BT  0xC1   /* ┴ */
#define CH_FULL 0xDB  /* █ */
#define CH_MED  0xB1   /* ▒ */
#define CH_LIGHT 0xB0  /* ░ */
#define CH_DEG  0xF8   /* ° */

/* ===========================================================================
 * 1. 定点数 Q16.16
 *    一个 i32 存"整数的 1/65536"。加减直接做，乘除要移位。
 *    乘法的中间结果用 i64 —— i386 的 imull 一条指令就出 64 位积，不调库。
 *    除法必须自己写：GCC 对 64 位除法会生成 __udivdi3 调用，而我们是裸链接，
 *    没有 libgcc。这里用移位减法顶上去，47 轮，够用。
 * =========================================================================== */
#define FXBITS 16
#define FXONE  65536

static inline i32 fx_mul(i32 a, i32 b)
{
    return (i32)(((i64)a * (i64)b) >> FXBITS);
}

/* (a/b) 的 Q16.16 表示 = (a<<16)/b，用移位减法实现，避开 64 位除法例程 */
static i32 fx_div(i32 a, i32 b)
{
    u32 ua, ub, q = 0, r = 0;
    int i, neg = 0, ovf = 0;

    if (b == 0)
        return (a < 0) ? (i32)0x80000000 : (i32)0x7FFFFFFF;

    if ((a < 0) != (b < 0)) neg = 1;
    ua = (a < 0) ? (u32)(-(i64)a) : (u32)a;
    ub = (b < 0) ? (u32)(-(i64)b) : (u32)b;

    for (i = 46; i >= 0; i--) {
        u32 bit = (i >= FXBITS) ? ((ua >> (i - FXBITS)) & 1u) : 0u;
        r = (r << 1) | bit;
        if (r >= ub) {
            r -= ub;
            if (i < 32) q |= (1u << i);
            else        ovf = 1;          /* 商超出 32 位：饱和 */
        }
    }
    if (ovf) return neg ? (i32)0x80000000 : (i32)0x7FFFFFFF;
    return neg ? -(i32)q : (i32)q;
}

/* 64 位整数开方，移位减法，不用除法 */
static u32 isqrt64(u64 n)
{
    u64 res = 0, bit = (u64)1 << 62;
    while (bit > n) bit >>= 2;
    while (bit) {
        if (n >= res + bit) {
            n -= res + bit;
            res = (res >> 1) + bit;
        } else {
            res >>= 1;
        }
        bit >>= 2;
    }
    return (u32)res;
}

/* sqrt(x)，x 是 Q16.16 */
static i32 fx_sqrt(i32 x)
{
    if (x <= 0) return 0;
    return (i32)isqrt64((u64)(u32)x << FXBITS);
}

/* ===========================================================================
 * 2. 三角函数：查表 + 线性插值
 *    表是 sin(0..90 度)，91 项 364 字节。任意角度先折到第一象限再查。
 *    没有 libm，这是最省的做法。
 * =========================================================================== */
#define DEG90  5898240        /* 90 度，Q16.16 */
#define DEG180 11796480       /* 180 度 */
#define DEG360 23592960       /* 360 度 */

static const i32 sin_tab[91] = {
         0,   1144,   2287,   3430,   4572,   5712,   6850,
      7987,   9121,  10252,  11380,  12505,  13626,  14742,
     15855,  16962,  18064,  19161,  20252,  21336,  22415,
     23486,  24550,  25607,  26656,  27697,  28729,  29753,
     30767,  31772,  32768,  33754,  34729,  35693,  36647,
     37590,  38521,  39441,  40348,  41243,  42126,  42995,
     43852,  44695,  45525,  46341,  47143,  47930,  48703,
     49461,  50203,  50931,  51643,  52339,  53020,  53684,
     54332,  54963,  55578,  56175,  56756,  57319,  57865,
     58393,  58903,  59396,  59870,  60326,  60764,  61183,
     61584,  61966,  62328,  62672,  62997,  63303,  63589,
     63856,  64104,  64332,  64540,  64729,  64898,  65048,
     65177,  65287,  65376,  65446,  65496,  65526,  65536,
};

static i32 sin_quad(i32 rem)          /* rem 在 [0, 90 度) */
{
    i32 idx = rem >> FXBITS;
    i32 f   = rem & (FXONE - 1);
    if (idx >= 90) return sin_tab[90];
    return sin_tab[idx] + (i32)(((i64)(sin_tab[idx + 1] - sin_tab[idx]) * f) >> FXBITS);
}

/* 输入：角度（Q16.16 度） */
static i32 fx_sin_deg(i32 deg)
{
    i32 d = deg % DEG360;             /* i32 的 % 是单条 idiv，不调库 */
    i32 quad, rem;
    if (d < 0) d += DEG360;
    quad = d / DEG90;
    rem  = d - quad * DEG90;
    switch (quad) {
        case 0:  return  sin_quad(rem);
        case 1:  return  sin_quad(DEG90 - rem);
        case 2:  return -sin_quad(rem);
        default: return -sin_quad(DEG90 - rem);
    }
}

/* 输入：弧度（Q16.16 弧度）—— 关节角就用这个单位 */
#define FX_180_PI 3754936         /* 180/pi = 57.29578 */
static inline i32 fx_sin(i32 rad) { return fx_sin_deg(fx_mul(rad, FX_180_PI)); }
static inline i32 fx_cos(i32 rad) { return fx_sin_deg(fx_mul(rad, FX_180_PI) + DEG90); }
static inline i32 fx_deg(i32 rad) { return fx_mul(rad, FX_180_PI); }   /* 弧度->度 */
static inline i32 fx_rad(i32 deg) { return fx_div(deg, FX_180_PI); }   /* 度->弧度 */

/* ===========================================================================
 * 3. 机械臂模型：三自由度平面臂
 *    本意和那台 7 自由度 S-R-S 臂完全一样的数学，只是任务维数从 6 降到 2，
 *    雅可比从 6x7 变成 2x3。三个现象一个不少，但在文本屏上是一条真能看的臂。
 * =========================================================================== */
#define NLINK 3
#define REACH 52429               /* 0.30+0.30+0.20 = 0.80 m */

static const i32 L0 = 19661;      /* 0.30 m */
static const i32 L1 = 19661;      /* 0.30 m */
static const i32 L2 = 13107;      /* 0.20 m */

typedef struct { i32 x, y; } vec2;

static vec2  P_ELBOW, P_WRIST, P_END;   /* 肘心 / 腕心 / 末端 */
static vec2  P_TARGET;                  /* 目标点 */
static vec2  V_TARGET;                  /* 目标点速度（前馈用） */
static vec2  P_TARGET_PREV;             /* 上一步目标点，用来做数值前馈 */

static i32   q[NLINK];                  /* 关节角，Q16.16 弧度 */
static i32   dq[NLINK];                 /* 本步关节速度，rad/s */
static i32   w_manip;                   /* 可操作度 w = sigma_max * sigma_min */
static i32   sigma_min;                 /* 最弱方向的能力 */
static i32   sigma_max;
static i32   err_mm;                    /* 末端误差，毫米 */
static i32   limit_margin;              /* 最小关节限位余量，度 */
static i32   null_share;                /* 零空间速度占比 0..1 */
static int   null_on = 1;               /* 零空间开关 */
static i32   lap_smin_min;              /* 本圈扫到过的最小 sigma_min */
static i32   lap_speed_max;             /* 本圈扫到过的最大关节速度需求（加阻尼） */
static i32   nodamp_speed;              /* 本步不加阻尼时需要多大关节速度 */
static i32   lap_nodamp_max;            /* 本圈不加阻尼时的峰值 */
static int   frame_no = 0;
static i32   phase = 0;                 /* 目标点在圆周上的相位 */

/* 正运动学：从三个关节角算出三个关键点 */
static void fk(void)
{
    i32 t1 = q[0], t2 = q[0] + q[1], t3 = q[0] + q[1] + q[2];
    i32 c1 = fx_cos(t1), s1 = fx_sin(t1);
    i32 c2 = fx_cos(t2), s2 = fx_sin(t2);
    i32 c3 = fx_cos(t3), s3 = fx_sin(t3);

    P_ELBOW.x = fx_mul(L0, c1);
    P_ELBOW.y = fx_mul(L0, s1);
    P_WRIST.x = P_ELBOW.x + fx_mul(L1, c2);
    P_WRIST.y = P_ELBOW.y + fx_mul(L1, s2);
    P_END.x   = P_WRIST.x + fx_mul(L2, c3);
    P_END.y   = P_WRIST.y + fx_mul(L2, s3);
}

/* 几何雅可比 2x3：J[i][j] = 第 j 个关节转 1 rad/s 时，末端第 i 个分量的速度 */
static void jacobian(i32 J[2][NLINK])
{
    i32 t1 = q[0], t2 = q[0] + q[1], t3 = q[0] + q[1] + q[2];
    i32 s1 = fx_sin(t1), c1 = fx_cos(t1);
    i32 s2 = fx_sin(t2), c2 = fx_cos(t2);
    i32 s3 = fx_sin(t3), c3 = fx_cos(t3);
    i32 a1 = fx_mul(L0, s1), a2 = fx_mul(L1, s2), a3 = fx_mul(L2, s3);
    i32 b1 = fx_mul(L0, c1), b2 = fx_mul(L1, c2), b3 = fx_mul(L2, c3);

    J[0][0] = -(a1 + a2 + a3);
    J[0][1] = -(a2 + a3);
    J[0][2] = -a3;
    J[1][0] =  (b1 + b2 + b3);
    J[1][1] =  (b2 + b3);
    J[1][2] =  b3;
}

/* ===========================================================================
 * 4. 控制器
 *    一步做四件事：
 *      ① 末端误差 -> 期望速度
 *      ② 阻尼最小二乘求最小范数解  dq = Jt (J Jt + lam^2 I)^-1 V
 *      ③ 零空间投影累加附加动作   dq += (I - Jt A^-1 J) z
 *      ④ 从 J Jt 的 2x2 特征值算出 sigma_max / sigma_min / 可操作度
 * =========================================================================== */
#define KP          393216      /* 位置增益 6.0 (1/s) */
#define LAM2        419         /* 阻尼系数 lam = 0.08，lam^2 = 0.0064 —— 单位与 sigma 一致 (m/rad) */
#define K_NULL      16384       /* 零空间增益 0.25 */
#define DT          1092        /* 步长 1/60 s，Q16.16 */
#define Q_LIMIT     193986      /* 关节限位 +-170 度（弧度） */
#define STEPS_PER_SIN 200       /* 一个来回 200 步（越短目标越快，奇异越吃紧） */
#define TGT_SPEED  18529        /* 目标的线速度 = R*omega*60 = 0.225*0.020944*60 = 0.283 m/s */

/* 期望姿势：让三个关节都往中间收 */
static const i32 q_pref[NLINK] = { 17157, 34315, 34315 };  /* 15, 30, 30 度 */

static void control_step(void)
{
    i32 J[2][NLINK], Jt[2], A[2][2], Ai[2][2], det, inv;
    i32 a, b, c, a0, b0, c0, tr, disc, lam_min, t;
    i32 dqn[NLINK], z[NLINK], JtAi[NLINK][2];
    i32 nrm = 0, nrm_null = 0;
    int i, j;

    fk();
    jacobian(J);

    /* ---- ① 期望末端速度 ---- */
    {
        i32 ex = P_TARGET.x - P_END.x;
        i32 ey = P_TARGET.y - P_END.y;
        /* 误差范数：Q16.16 里直接平方会把小误差截断成 0（0.1mm 的平方只有 1e-8），
           所以先换算成微米再平方求和开方，最后折回毫米，分辨率 1 微米 */
        i32 exum = (i32)(((i64)ex * 1000000) >> FXBITS);
        i32 eyum = (i32)(((i64)ey * 1000000) >> FXBITS);
        i64 sq   = (i64)exum * exum + (i64)eyum * eyum;
        i32 r_um = (i32)isqrt64((u64)sq);      /* 微米，普通整数 */
        err_mm   = fx_div(r_um, 1000);          /* 微米 -> 毫米，Q16.16（定点除法避开 __divdi3） */
        /* 比例项 + 目标速度前馈。
           只用比例项时，跟踪匀速目标的稳态误差 = v / KP（这里约 52 mm）；
           把目标速度直接加进去，这一项滞后就消掉了。 */
        Jt[0] = fx_mul(KP, ex) + V_TARGET.x;
        Jt[1] = fx_mul(KP, ey) + V_TARGET.y;
    }

    /* ---- ② J Jt（2x2，对称），加上 lam^2 做阻尼 ---- */
    a0 = fx_mul(J[0][0], J[0][0]) + fx_mul(J[0][1], J[0][1]) + fx_mul(J[0][2], J[0][2]);
    b0 = fx_mul(J[0][0], J[1][0]) + fx_mul(J[0][1], J[1][1]) + fx_mul(J[0][2], J[1][2]);
    c0 = fx_mul(J[1][0], J[1][0]) + fx_mul(J[1][1], J[1][1]) + fx_mul(J[1][2], J[1][2]);
    a = a0 + LAM2;  b = b0;  c = c0 + LAM2;

    det = fx_mul(a, c) - fx_mul(b, b);
    inv = fx_div(FXONE, det);
    Ai[0][0] =  fx_mul(c, inv);
    Ai[0][1] = -fx_mul(b, inv);
    Ai[1][1] =  fx_mul(a, inv);
    Ai[1][0] =  Ai[0][1];

    /* ---- 最小范数解 dq = Jt * Ai * V ---- */
    {
        i32 x0 = fx_mul(Ai[0][0], Jt[0]) + fx_mul(Ai[0][1], Jt[1]);
        i32 x1 = fx_mul(Ai[1][0], Jt[0]) + fx_mul(Ai[1][1], Jt[1]);
        for (i = 0; i < NLINK; i++)
            dq[i] = fx_mul(J[0][i], x0) + fx_mul(J[1][i], x1);
    }
    for (i = 0; i < NLINK; i++) nrm += (dq[i] < 0 ? -dq[i] : dq[i]);

    /* ---- ③ 零空间：N = I - Jt Ai J，把附加目标投影进去 ---- */
    for (i = 0; i < NLINK; i++) {
        JtAi[i][0] = fx_mul(J[0][i], Ai[0][0]) + fx_mul(J[1][i], Ai[1][0]);
        JtAi[i][1] = fx_mul(J[0][i], Ai[0][1]) + fx_mul(J[1][i], Ai[1][1]);
    }
    for (i = 0; i < NLINK; i++)
        z[i] = -fx_mul(K_NULL, q[i] - q_pref[i]);

    for (i = 0; i < NLINK; i++) {
        i32 acc = 0;
        for (j = 0; j < NLINK; j++) {
            i32 nij = ((i == j) ? FXONE : 0)
                    - (fx_mul(JtAi[i][0], J[0][j]) + fx_mul(JtAi[i][1], J[1][j]));
            acc += fx_mul(nij, z[j]);
        }
        dqn[i] = null_on ? acc : 0;
        dq[i] += dqn[i];
        nrm_null += (dqn[i] < 0 ? -dqn[i] : dqn[i]);
    }

    /* 用定点除法，避免 GCC 对 64 位除法生成 __divdi3（裸链接没有 libgcc） */
    null_share = (nrm + nrm_null > 0) ? fx_div(nrm_null, nrm + nrm_null) : 0;

    /* ---- ④ 奇异值：2x2 特征值的闭式解，不需要 SVD ---- */
    tr   = a0 + c0;
    disc = fx_mul(tr, tr) - 4 * (fx_mul(a0, c0) - fx_mul(b0, b0));
    if (disc < 0) disc = 0;
    t = fx_sqrt(disc);
    lam_min  = (tr - t) / 2;
    sigma_min = fx_sqrt(lam_min);
    sigma_max = fx_sqrt((tr + t) / 2);
    {
        i32 d2 = fx_mul(a0, c0) - fx_mul(b0, b0);
        w_manip = (d2 > 0) ? fx_sqrt(d2) : 0;
    }

    /* ---- 对照：同一个动作，如果不加阻尼（纯伪逆）需要多大关节速度 ----
       阻尼的作用就是把"最弱方向"上的动作压小。这里把它放出来，
       和加阻尼的结果并排显示，一眼就能看出阻尼在干什么。 */
    {
        i32 dn = fx_mul(a0, c0) - fx_mul(b0, b0);
        i32 iv = fx_div(FXONE, dn);
        i32 i00 =  fx_mul(c0, iv), i01 = -fx_mul(b0, iv), i11 = fx_mul(a0, iv);
        i32 x0 = fx_mul(i00, Jt[0]) + fx_mul(i01, Jt[1]);
        i32 x1 = fx_mul(i01, Jt[0]) + fx_mul(i11, Jt[1]);
        i32 m = 0;
        for (i = 0; i < NLINK; i++) {
            i32 v = fx_mul(J[0][i], x0) + fx_mul(J[1][i], x1);
            if (v < 0) v = -v;
            if (v > m) m = v;
        }
        nodamp_speed = m;
        if (nodamp_speed > lap_nodamp_max) lap_nodamp_max = nodamp_speed;
    }

    /* ---- 本圈极值统计：任何一帧都能看出整圈扫过的范围 ---- */
    {
        i32 sp = 0;
        for (i = 0; i < NLINK; i++) {
            i32 a = dq[i] < 0 ? -dq[i] : dq[i];
            if (a > sp) sp = a;
        }
        if (sp > lap_speed_max) lap_speed_max = sp;
        if (sigma_min < lap_smin_min) lap_smin_min = sigma_min;
    }

    /* ---- 积分，并统计限位余量 ---- */
    limit_margin = 200 * FXONE;
    for (i = 0; i < NLINK; i++) {
        i32 lim;
        q[i] += fx_mul(dq[i], DT);
        lim = fx_deg(Q_LIMIT - (q[i] < 0 ? -q[i] : q[i]));
        if (lim < limit_margin) limit_margin = lim;
    }

    /* ---- 目标路径：沿半径方向来回扫（三角波），最外端刻意超出可达半径 ----
       为什么故意让它够不到：最小范数解会自动避开奇异构型 —— 只要目标在可达范围内，
       它总能找到一个不那么直的姿势去够，σmin 掉不下去。只有把目标推到工作空间外面，
       手臂才被逼到"完全相同于一根直杆"的极限构型，这时 σmin 才真正塌到 0。
       这也正是工程上的真实教训：轨迹规划不能贴着工作空间边界走。 ----
       为什么不用圆周：圆周运动在最远端是纯切向的，而手臂接近全伸展时
       "推不动"的方向恰恰是径向 —— 切向运动压不出奇异，任务照样轻松完成。
       三角波在最远端速度仍然是径向的，这才是最能暴露奇异的方向。 */
    {
        i32 t = phase;
        i32 s;
        if (t < 100) s = FXONE - (t * 2 * FXONE) / 100;              /* 1 -> -1 */
        else         s = ((t - 100) * 2 * FXONE) / 100 - FXONE;      /* -1 -> 1 */

        P_TARGET_PREV.x = P_TARGET.x;
        P_TARGET_PREV.y = P_TARGET.y;

        P_TARGET.x = 34734 + fx_mul(17433, s);                       /* 0.530 +- 0.266 */
        P_TARGET.y =  9830 + fx_mul(1311, fx_sin(phase * 2059));     /* 0.150 + 小幅摆动 */

        /* 前馈速度：目标位置的逐步差分再乘 60 步/秒。
           用差分而不是解析式，这样换任何目标路径都不用改这里。 */
        V_TARGET.x = (i32)((i64)(P_TARGET.x - P_TARGET_PREV.x) * 60);
        V_TARGET.y = (i32)((i64)(P_TARGET.y - P_TARGET_PREV.y) * 60);

        phase++;
        if (phase >= STEPS_PER_SIN) {
            phase = 0;
            frame_no++;
            lap_smin_min  = 0x7FFFFFFF;   /* 新的一圈，极值重新统计 */
            lap_speed_max = 0;
            lap_nodamp_max = 0;
        }
    }
}

/* ===========================================================================
 * 5. 显存与字符绘制
 *    先画在影子显存（0x20000），再一次性搬到 0xB8000，避免逐字符写造成的撕裂。
 * =========================================================================== */
#define SCR_W 80
#define SCR_H 25
#define CV_X  1        /* 画布左边界列 */
#define CV_Y  2        /* 画布上边界行：让第 0 行留给标题 */
#define CV_W  42       /* 画布宽 */
#define CV_H  19       /* 画布高 */

/* 世界窗口：x ∈ [-0.85, 0.85]，y ∈ [-0.90, 0.90]，跨度 1.70 x 1.80 m
   画布是 42 列 x 20 行，字符单元高宽比约 1:2，所以像素上接近正方 */
#define WX0    (-55706)  /* -0.85 m（必须是负数，写反了整条臂会被 clamp 到角落） */
#define WY0    (-58982)  /* -0.90 m */
#define WSPANX 111411    /* 1.70 m */
#define WSPANY 117965    /* 1.80 m */

static u16 *const VBUF = (u16 *)SHADOW;

static void cell(int c, int r, char ch, u8 attr)
{
    if (c < 0 || c >= SCR_W || r < 0 || r >= SCR_H) return;
    VBUF[r * SCR_W + c] = (u16)(u8)ch | ((u16)attr << 8);
}

static void text(int c, int r, const char *s, u8 attr)
{
    while (*s) cell(c++, r, *s++, attr);
}

static void fill(int c0, int r0, int c1, int r1, char ch, u8 attr)
{
    int c, r;
    for (r = r0; r <= r1; r++)
        for (c = c0; c <= c1; c++) cell(c, r, ch, attr);
}

static void clear_all(u8 attr)
{
    int i;
    for (i = 0; i < SCR_W * SCR_H; i++)
        VBUF[i] = (u16)' ' | ((u16)attr << 8);
}

/* Bresenham 直线，在字符网格上画 */
static void line(int c0, int r0, int c1, int r1, char ch, u8 attr)
{
    int dx = c1 - c0, dy = r1 - r0;
    int sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
    int adx = dx < 0 ? -dx : dx, ady = dy < 0 ? -dy : dy;
    int err = adx - ady, e2;
    for (;;) {
        cell(c0, r0, ch, attr);
        if (c0 == c1 && r0 == r1) break;
        e2 = 2 * err;
        if (e2 > -ady) { err -= ady; c0 += sx; }
        if (e2 <  adx) { err += adx; r0 += sy; }
    }
}

/* 世界坐标 -> 字符格 */
static int wx(i32 x)
{
    i32 t = fx_div(x - WX0, WSPANX);
    int c = CV_X + (int)(((i64)t * (CV_W - 1)) >> FXBITS);
    if (c < CV_X) c = CV_X;
    if (c > CV_X + CV_W - 1) c = CV_X + CV_W - 1;
    return c;
}
static int wy(i32 y)
{
    i32 t = fx_div(y - WY0, WSPANY);
    int r = CV_Y + CV_H - 1 - (int)(((i64)t * (CV_H - 1)) >> FXBITS);
    if (r < CV_Y) r = CV_Y;
    if (r > CV_Y + CV_H - 1) r = CV_Y + CV_H - 1;
    return r;
}

static void vsync(void)
{
    int g;
    for (g = 0; g < 400000 && (inb(0x3DA) & 0x08); g++) ;
    for (g = 0; g < 400000 && !(inb(0x3DA) & 0x08); g++) ;
}

static void flush(void)
{
    u32 *s = (u32 *)VBUF, *d = (u32 *)VID_MEM;
    int i;
    for (i = 0; i < (SCR_W * SCR_H) / 2; i++) d[i] = s[i];
}

/* ===========================================================================
 * 5.1 串口帧旁路：只读 VGA，不改变渲染逻辑
 * =========================================================================== */
static u16 *const serial_snapshot = (u16 *)FRAME_SNAP;
static u8 serial_frame[FRAME_BUF];
static u32 serial_scan_count = 0;
static u32 serial_full_request = 0;

static void serial_init(void)
{
    outb(SERIAL_COM1 + 1, 0x00);
    outb(SERIAL_COM1 + 3, 0x80);
    outb(SERIAL_COM1 + 0, 0x01);
    outb(SERIAL_COM1 + 1, 0x00);
    outb(SERIAL_COM1 + 3, 0x03);
    outb(SERIAL_COM1 + 2, 0xC7);
    outb(SERIAL_COM1 + 4, 0x0B);
}

static void serial_putc(u8 b)
{
    while (!(inb(SERIAL_COM1 + 5) & 0x20)) { }
    outb(SERIAL_COM1, b);
}

static void serial_write(const u8 *buf, u32 len)
{
    u32 i;
    for (i = 0; i < len; i++) serial_putc(buf[i]);
}

/* 桥接在窗口新连接时发一个 'F'，让内核补一整帧，避免只能看到之后的变化。 */
static void serial_poll(void)
{
    while (inb(SERIAL_COM1 + 5) & 1) {
        u8 b = inb(SERIAL_COM1);
        if (b == 'F') serial_full_request = 1;
    }
}

static void serial_send_frame(u32 count)
{
    u32 total;
    u8 crc = 0;
    u32 i;

    if (!count) return;
    serial_frame[3] = (u8)count;
    total = FRAME_HDR + count * 4;
    for (i = 0; i < total; i++) crc ^= serial_frame[i];
    serial_frame[total] = crc;
    serial_write(serial_frame, total + 1);
}

static void serial_scan(void)
{
    u16 *vga = (u16 *)VID_MEM;
    u32 count = 0;
    u32 i;
    u32 full = serial_full_request || (serial_scan_count == 0) || ((serial_scan_count % 120) == 0);
    if (full) serial_full_request = 0;

    serial_frame[0] = FRAME_SYNC0;
    serial_frame[1] = FRAME_SYNC1;
    serial_frame[2] = FRAME_TYPE_DELTA;

    for (i = 0; i < SCR_CELLS; i++) {
        u16 v = vga[i];
        if (!full && v == serial_snapshot[i]) continue;

        if (count >= FRAME_MAX_CELLS) {
            serial_send_frame(count);
            count = 0;
            serial_frame[0] = FRAME_SYNC0;
            serial_frame[1] = FRAME_SYNC1;
            serial_frame[2] = FRAME_TYPE_DELTA;
        }

        {
            u32 p = FRAME_HDR + count * 4;
            serial_frame[p + 0] = (u8)(i / SCR_W);
            serial_frame[p + 1] = (u8)(i % SCR_W);
            serial_frame[p + 2] = (u8)(v & 0xFF);
            serial_frame[p + 3] = (u8)((v >> 8) & 0xFF);
        }
        serial_snapshot[i] = v;
        count++;
    }
    serial_send_frame(count);
    serial_scan_count++;
}

/* ===========================================================================
 * 6. 数字格式化（没有 libc，自己拆十进制）
 * =========================================================================== */
static int put_dec(char *o, u32 v)
{
    char t[12];
    int n = 0, i;
    do { t[n++] = (char)('0' + (v % 10)); v /= 10; } while (v);
    for (i = 0; i < n; i++) o[i] = t[n - 1 - i];
    return n;
}

/* Q16.16 -> 十进制字符串，dec 位小数 */
static int s_fx(char *o, i32 v, int dec)
{
    u32 sc = 1, a, ip, fp;
    int i, p = 0, neg = 0;

    for (i = 0; i < dec; i++) sc *= 10;
    if (v < 0) { neg = 1; a = (u32)(-(i64)v); } else a = (u32)v;
    ip = a >> FXBITS;
    fp = (u32)(((u64)(a & 0xFFFF) * sc) >> FXBITS);
    if (fp >= sc) { fp -= sc; ip++; }

    if (neg) o[p++] = '-';
    p += put_dec(o + p, ip);
    if (dec) {
        o[p++] = '.';
        for (i = dec - 1; i >= 0; i--) { o[p + i] = (char)('0' + (fp % 10)); fp /= 10; }
        p += dec;
    }
    o[p] = 0;
    return p;
}

/* ===========================================================================
 * 7. 渲染一帧
 * =========================================================================== */
#define TRACE_N 48
static u16 trace[TRACE_N];
static int trace_i = 0;

static void bar(int col, int row, int width, i32 frac, u8 attr)
{
    int n = (int)(((i64)frac * width) >> FXBITS);
    int i;
    if (n < 0) n = 0;
    if (n > width) n = width;
    for (i = 0; i < width; i++)
        cell(col + i, row, i < n ? (char)CH_FULL : (char)CH_LIGHT, attr);
}

static void render(void)
{
    char buf[40];
    int c, r, i, p;
    u8 sc, vc, sp_max;

    clear_all(C_DGRAY);

    /* ---- 顶栏 ---- */
    text(1, 0, " 3-DOF Planar Arm  |  Jacobian live demo ", C_WHITE);
    p = 0;
    p += put_dec(buf, (u32)frame_no);
    buf[p] = 0;
    text(62, 0, buf, C_GRAY);

    /* ---- 画布边框 ---- */
    for (c = CV_X - 1; c <= CV_X + CV_W; c++) {
        cell(c, CV_Y - 1, (char)CH_H, C_GRAY);
        cell(c, CV_Y + CV_H, (char)CH_H, C_GRAY);
    }
    for (r = CV_Y - 1; r <= CV_Y + CV_H; r++) {
        cell(CV_X - 1, r, (char)CH_V, C_GRAY);
        cell(CV_X + CV_W, r, (char)CH_V, C_GRAY);
    }
    cell(CV_X - 1, CV_Y - 1, (char)CH_TL, C_GRAY);
    cell(CV_X + CV_W, CV_Y - 1, (char)CH_TR, C_GRAY);
    cell(CV_X - 1, CV_Y + CV_H, (char)CH_BL, C_GRAY);
    cell(CV_X + CV_W, CV_Y + CV_H, (char)CH_BR, C_GRAY);

    /* ---- 基座水平参考线（字画布上的 x 轴） ---- */
    for (c = CV_X; c <= CV_X + CV_W - 1; c++) cell(c, wy(0), '.', C_GRAY);

    /* ---- 末端轨迹 ---- */
    for (i = 0; i < TRACE_N; i++) {
        u16 t = trace[i];
        if (t) cell(t & 0xFF, (int)(t >> 8), '.', C_BLUE);
    }

    /* ---- 目标点 ---- */
    cell(wx(P_TARGET.x), wy(P_TARGET.y), 'o', C_YELLOW);

    /* ---- 三条连杆 + 关节标记 ---- */
    {
        int c0 = wx(0), r0 = wy(0);
        int c1 = wx(P_ELBOW.x), r1 = wy(P_ELBOW.y);
        int c2 = wx(P_WRIST.x), r2 = wy(P_WRIST.y);
        int c3 = wx(P_END.x),   r3 = wy(P_END.y);
        line(c0, r0, c1, r1, (char)CH_FULL, C_CYAN);
        line(c1, r1, c2, r2, (char)CH_FULL, C_CYAN);
        line(c2, r2, c3, r3, (char)CH_FULL, C_MAG);
        cell(c1, r1, 'O', C_WHITE);
        cell(c2, r2, '*', C_WHITE);
        cell(c3, r3, '@', C_GREEN);
        cell(c0, r0, '#', C_WHITE);
    }

    /* ---- 右侧面板 ---- */
    {
        int X = 45;
        text(X, 1, "ARM STATUS", C_CYAN);
        text(X + 22, 1, null_on ? "nullsp ON " : "nullsp OFF", null_on ? C_GREEN : C_RED);
        for (c = X; c < X + 32; c++) cell(c, 2, (char)CH_H, C_GRAY);

        text(X, 3, "joint angles", C_GRAY);
        for (i = 0; i < NLINK; i++) {
            int rr = 4 + i;
            int L = 0, k;
            cell(X + 1, rr, 'q', C_GRAY);
            cell(X + 2, rr, (char)('1' + i), C_GRAY);
            s_fx(buf, fx_deg(q[i]), 1);
            while (buf[L]) L++;                 /* 右对齐到 6 字符字段 */
            for (k = 0; k < 6 - L; k++) cell(X + 5 + k, rr, ' ', C_GRAY);
            text(X + 11 - L, rr, buf, C_WHITE);
            cell(X + 12, rr, (char)CH_DEG, C_GRAY);
        }

        text(X, 8, "manipulability w", C_GRAY);
        s_fx(buf, w_manip, 4);
        text(X + 18, 8, buf, C_WHITE);

        text(X, 9, "weakest dir  smin", C_GRAY);
        s_fx(buf, sigma_min, 4);
        if (sigma_min < FX_0_02)      sc = C_RED;
        else if (sigma_min < FX_0_10) sc = C_YELLOW;
        else                          sc = C_GREEN;
        text(X + 18, 9, buf, sc);

        text(X, 10, "lap worst smin", C_GRAY);
        s_fx(buf, (lap_smin_min == 0x7FFFFFFF) ? sigma_min : lap_smin_min, 4);
        {
            i32 wmin = (lap_smin_min == 0x7FFFFFFF) ? sigma_min : lap_smin_min;
            u8 wc = (wmin < FX_0_03) ? C_RED : (wmin < FX_0_10 ? C_YELLOW : C_GREEN);
            text(X + 18, 10, buf, wc);
        }

        bar(X, 11, 32, sigma_max > 0 ? fx_div(sigma_min, sigma_max) : 0, sc);

        text(X, 13, "speed  no damping", C_GRAY);
        s_fx(buf, nodamp_speed, 2);
        text(X + 20, 13, buf, nodamp_speed > FX_3_00 ? C_RED : C_YELLOW);
        text(X + 27, 13, "rad/s", C_GRAY);

        text(X, 14, "speed  damped", C_GRAY);
        {
            i32 sp = 0;
            for (i = 0; i < NLINK; i++) {
                i32 a = dq[i] < 0 ? -dq[i] : dq[i];
                if (a > sp) sp = a;
            }
            s_fx(buf, sp, 2);
            sp_max = (sp > FX_2_40) ? C_RED : (sp > FX_1_20 ? C_YELLOW : C_GREEN);
            text(X + 20, 14, buf, sp_max);
            text(X + 27, 14, "rad/s", C_GRAY);
            bar(X, 15, 32, fx_div(sp, FX_3_00), sp_max);
        }

        text(X, 17, "lap peak no damp", C_GRAY);
        s_fx(buf, lap_nodamp_max, 1);
        text(X + 20, 17, buf, lap_nodamp_max > FX_3_00 ? C_RED : C_YELLOW);
        text(X + 27, 17, "rad/s", C_GRAY);

        text(X, 16, "lap peak damped", C_GRAY);
        s_fx(buf, lap_speed_max, 2);
        text(X + 20, 16, buf, lap_speed_max > FX_2_40 ? C_RED : C_GREEN);
        text(X + 27, 16, "rad/s", C_GRAY);

        text(X, 18, "tip error", C_GRAY);
        s_fx(buf, err_mm, 3);
        text(X + 20, 18, buf, C_WHITE);
        text(X + 27, 18, "mm", C_GRAY);

        text(X, 19, "limit margin", C_GRAY);
        s_fx(buf, limit_margin, 1);
        text(X + 20, 19, buf, C_WHITE);
        cell(X + 27, 19, (char)CH_DEG, C_GRAY);

        text(X, 20, "nullsp share", C_GRAY);
        s_fx(buf, null_share, 3);
        text(X + 20, 20, buf, C_WHITE);
    }

    /* ---- 底部 ---- */
    for (c = 0; c < SCR_W; c++) cell(c, 21, (char)CH_H, C_GRAY);
    text(2, 22, "tip @   elbow O   wrist *   target o   path .   base #   radial sweep", C_GRAY);
    text(2, 23, "target sweeps 0.30..0.81 m ; reach 0.80 m ; outer end unreachable on purpose", C_GRAY);
    {
        i32 wmin = (lap_smin_min == 0x7FFFFFFF) ? sigma_min : lap_smin_min;
        i32 wmx  = lap_speed_max;
        if (wmin < FX_0_03)
            text(2, 24, ">>> smin collapsed: no-damping demand 5+ rad/s -- damping is what bounds it <<<", C_RED);
        else if (wmx > FX_3_00)
            text(2, 24, ">>> no-damping demand exceeds the 3.00 rad/s motor limit; damping contains it <<<", C_YELLOW);
        else if (wmx > FX_1_20)
            text(2, 24, ">>> joint speed demand rises sharply as the arm reaches full extension <<<", C_YELLOW);
        else
            text(2, 24, "OK: joint speed demand stays inside the 3.00 rad/s motor capability", C_GREEN);
    }
}

/* ===========================================================================
 * 8. 两个进程：控制器 / 渲染器
 *    上下文切换机制和原版完全一样（协作式、1:1），只是两边都真的有活干了。
 * =========================================================================== */
#define TASK_RUNNING         0
#define TASK_INTERRUPTIBLE   1

struct context {
    unsigned int eax, ebx, ecx, edx, esi, edi, ebp, esp, eip;
};

struct task_struct {
    int  pid;
    int  state;
    char comm[16];
    struct context ctx;
};

struct task_struct p1, p2, init_task;
struct task_struct *current;

#define STACK_P1 0x4000
#define STACK_P2 0x5000
#define CTX_SLOTS 8

__attribute__((naked))
void cpu_switch(unsigned int *save_esp, unsigned int new_esp)
{
    __asm__ __volatile__(
        "pushl %ebp\n\t"
        "pushl %edi\n\t"
        "pushl %esi\n\t"
        "pushl %edx\n\t"
        "pushl %ecx\n\t"
        "pushl %ebx\n\t"
        "pushl %eax\n\t"
        "movl  32(%esp), %eax\n\t"
        "movl  %esp, (%eax)\n\t"
        "movl  36(%esp), %eax\n\t"
        "movl  %eax, %esp\n\t"
        "popl  %eax\n\t"
        "popl  %ebx\n\t"
        "popl  %ecx\n\t"
        "popl  %edx\n\t"
        "popl  %esi\n\t"
        "popl  %edi\n\t"
        "popl  %ebp\n\t"
        "ret\n\t"
    );
}

void switch_to(struct task_struct *next)
{
    struct task_struct *prev = current;
    current = next;
    cpu_switch(&prev->ctx.esp, next->ctx.esp);
}

static void task_init(struct task_struct *t, int pid, const char *name,
                      void (*entry)(void), unsigned int stack_top)
{
    unsigned int *sp = (unsigned int *)(stack_top - CTX_SLOTS * 4);
    int i;
    t->pid = pid;
    t->state = TASK_RUNNING;
    for (i = 0; i < 15 && name[i]; i++) t->comm[i] = name[i];
    t->comm[i] = '\0';
    for (i = 0; i < CTX_SLOTS - 1; i++) sp[i] = 0;
    sp[CTX_SLOTS - 1] = (unsigned int)entry;
    t->ctx.esp = (unsigned int)sp;
    t->ctx.eip = (unsigned int)entry;
}

void proc1(void)                       /* 控制器：算一步 */
{
    while (1) {
        control_step();
        p1.state = TASK_INTERRUPTIBLE;
        switch_to(&p2);
        p1.state = TASK_RUNNING;
    }
}

void proc2(void)                       /* 渲染器：画一帧 */
{
    int frames = 0;
    while (1) {
        /* 键盘轮询（不需要中断，直接读 PS/2 控制器端口） */
        if (inb(0x64) & 1) {
            u8 sc = inb(0x60);
            if (sc == 0x39) null_on = !null_on;      /* 空格：切换零空间 */
        }
        serial_poll();
        render();
        flush();
        if ((frames & 7) == 0) serial_scan();
        vsync();

        trace[trace_i] = (u16)(wx(P_END.x) | (wy(P_END.y) << 8));
        trace_i = (trace_i + 1) % TRACE_N;

        frames++;
        if (frames % 420 == 0) null_on = !null_on;   /* 自动演示两种模式 */

        p2.state = TASK_INTERRUPTIBLE;
        switch_to(&p1);
        p2.state = TASK_RUNNING;
    }
}

void kernel_main(void)
{
    int i;

    for (i = 0; i < TRACE_N; i++) trace[i] = 0;

    serial_init();
    for (i = 0; i < SCR_CELLS; i++)
        serial_snapshot[i] = ((u16)C_DGRAY << 8) | (u16)' ';

    q[0] = 17157;   /* 15 度 */
    q[1] = 34315;   /* 30 度 */
    q[2] = 34315;   /* 30 度 */
    P_TARGET.x = 34734 + 17433;  /* 最外端 (0.796, 0.15) -> |r|=0.810 m，超出 0.80 的可达半径 */
    P_TARGET.y =  9830;
    phase = 0;
    V_TARGET.x = 0;
    V_TARGET.y = 0;
    P_TARGET_PREV.x = P_TARGET.x;
    P_TARGET_PREV.y = P_TARGET.y;
    lap_smin_min = 0x7FFFFFFF;
    lap_speed_max = 0;
    lap_nodamp_max = 0;

    task_init(&p1, 1, "ctrl", proc1, STACK_P1);
    task_init(&p2, 2, "draw", proc2, STACK_P2);

    init_task.pid = 0;
    init_task.state = TASK_RUNNING;
    current = &init_task;

    switch_to(&p1);

    while (1)
        __asm__ __volatile__("hlt");
}
