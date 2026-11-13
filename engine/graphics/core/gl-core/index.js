
// ============================================================
// 引擎总入口 OrbWebGLCore
// ============================================================
const OrbWebGLCore = {
  Math: OrbMath,
  Skeleton: OrbSkeleton,
  Animation: OrbAnimation,
  Physics: OrbPhysics,
  Interaction: OrbInteraction,
  Behavior: OrbBehavior,
  PBR: OrbPBR,
  Post: OrbPost,
  Shader: OrbShader,
  version: '1.0.0',
  init(){
    console.log('[OrbWebGLCore] 纯自研WebGL引擎核心初始化完成');
    console.log('[OrbWebGLCore] 模块: Math, Skeleton, Animation, Physics, Interaction, Behavior, PBR, Post, Shader');
  }
};

if(typeof window !== 'undefined'){
  window.OrbWebGLCore = OrbWebGLCore;
}