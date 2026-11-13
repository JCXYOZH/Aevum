/**
 * MrHua 3D灵体渲染引擎 - orb-vmd-player
 * VMD动画播放器
 * 从 orb-renderer-main.js 拆分 (原行 L2363-L2451)
 * @module orb-vmd-player
 */
'use strict';

/* ===== VMD 动画播放器 ===== */
function createVMDPlayer(vmdData, boneSystem){
  const bones = boneSystem.bones;
  const boneCount = bones.length;
  const poseRotations = new Array(boneCount);
  const posePositions = new Array(boneCount);
  const _identQ = [0,0,0,1];
  for(let i=0;i<boneCount;i++){ poseRotations[i]=_identQ; posePositions[i]=bones[i].position; }
  let currentFrame = 0;
  let playing = false;
  let loop = true;
  let playbackSpeed = 1;
  const _tmpQ = [0,0,0,1];
  const _tmpPos = [0,0,0];
  function findFrameIndex(frames, frame){
    let lo=0, hi=frames.length-1;
    while(lo<=hi){
      const mid=(lo+hi)>>1;
      if(frames[mid].frame===frame) return mid;
      if(frames[mid].frame<frame) lo=mid+1; else hi=mid-1;
    }
    return Math.max(0, lo-1);
  }
  function interpolateBone(boneName, frame){
    const frames = vmdData.boneFrameMap[boneName];
    if(!frames || frames.length===0) return null;
    if(frame<=frames[0].frame) return {position:frames[0].position, rotation:frames[0].rotation};
    if(frame>=frames[frames.length-1].frame) return {position:frames[frames.length-1].position, rotation:frames[frames.length-1].rotation};
    const idx = findFrameIndex(frames, frame);
    const f0 = frames[idx], f1 = frames[idx+1];
    const t = (frame-f0.frame)/(f1.frame-f0.frame);
    const it = f0.interpolation;
    const ax=it[0], ay=it[1], az=it[2], aw=it[3];
    const bx=it[4], by=it[5], bz=it[6], bw=it[7];
    function bezier(t,a,b){ const mt=1-t; return 3*mt*mt*t*a + 3*mt*t*t*b + t*t*t; }
    const tx = bezier(t,ax/127,bx/127);
    const ty = bezier(t,ay/127,by/127);
    const tz = bezier(t,az/127,bz/127);
    const tr = bezier(t,aw/127,bw/127);
    _tmpPos[0]=f0.position[0]+(f1.position[0]-f0.position[0])*tx;
    _tmpPos[1]=f0.position[1]+(f1.position[1]-f0.position[1])*ty;
    _tmpPos[2]=f0.position[2]+(f1.position[2]-f0.position[2])*tz;
    Q.slerp(_tmpQ, f0.rotation, f1.rotation, tr);
    return {position:_tmpPos, rotation:_tmpQ};
  }
  function update(frame){
    currentFrame = frame;
    for(let i=0;i<boneCount;i++){
      const result = interpolateBone(bones[i].name, frame);
      if(result){ poseRotations[i]=result.rotation; posePositions[i]=result.position; }
      else { poseRotations[i]=_identQ; posePositions[i]=bones[i].position; }
    }
  }
  function getMorphWeight(morphName, frame){
    const frames = vmdData.morphFrameMap[morphName];
    if(!frames || frames.length===0) return 0;
    if(frame<=frames[0].frame) return frames[0].weight;
    if(frame>=frames[frames.length-1].frame) return frames[frames.length-1].weight;
    const idx = findFrameIndex(frames, frame);
    const f0=frames[idx], f1=frames[idx+1];
    const t=(frame-f0.frame)/(f1.frame-f0.frame);
    return f0.weight+(f1.weight-f0.weight)*t;
  }
  function tick(deltaTime){
    if(!playing) return;
    currentFrame += deltaTime * 30 * playbackSpeed;
    if(currentFrame > vmdData.totalFrames){
      if(loop) currentFrame = 0;
      else { currentFrame = vmdData.totalFrames; playing = false; }
    }
    update(currentFrame);
  }
  function play(){ playing = true; }
  function pause(){ playing = false; }
  function stop(){ playing = false; currentFrame = 0; update(0); }
  function seek(frame){ currentFrame = Math.max(0, Math.min(vmdData.totalFrames, frame)); update(currentFrame); }
  function setLoop(v){ loop = v; }
  function setSpeed(v){ playbackSpeed = v; }
  console.log('[VMDPlayer] 创建完成 totalFrames=' + vmdData.totalFrames + ' bones=' + boneCount);
  return {
    update, tick, play, pause, stop, seek, setLoop, setSpeed, getMorphWeight,
    get poseRotations(){ return poseRotations; },
    get posePositions(){ return posePositions; },
    get currentFrame(){ return currentFrame; },
    get isPlaying(){ return playing; },
    get totalFrames(){ return vmdData.totalFrames; },
  };
}

