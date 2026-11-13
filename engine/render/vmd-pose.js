/**
 * VMD 动作采样。
 *
 * 把 VMD 的骨骼关键帧按时间线性插值成渲染器可用的姿态数组。
 * 旋转按四元数 slerp，位移按线性插值；没有关键帧的骨骼保持静止。
 * 纯计算模块，不依赖 WebGL。
 */
'use strict';

const math = (typeof require === 'function')
  ? require('../orb/math.js')
  : (typeof window !== 'undefined' ? window.AEVUM.math : null);

function findTrackFrame(track, frame) {
  if (!track || track.length === 0) return null;
  if (frame <= track[0].frame) return { a: track[0], b: track[0], t: 0 };
  if (frame >= track[track.length - 1].frame) {
    const last = track[track.length - 1];
    return { a: last, b: last, t: 0 };
  }

  for (let i = 0; i < track.length - 1; i += 1) {
    const a = track[i];
    const b = track[i + 1];
    if (frame >= a.frame && frame <= b.frame) {
      const span = b.frame - a.frame;
      return { a, b, t: span > 0 ? (frame - a.frame) / span : 0 };
    }
  }
  return null;
}

function sampleVMDPose(model, vmd, frame, out) {
  const pose = out || model.bones.map(() => ({
    rotation: [0, 0, 0, 1],
    translation: [0, 0, 0]
  }));

  if (!vmd || !vmd.boneFrameMap) return pose;

  for (let i = 0; i < model.bones.length; i += 1) {
    const bone = model.bones[i];
    const track = vmd.boneFrameMap[bone.name];
    if (!track) continue;

    const sample = findTrackFrame(track, frame);
    if (!sample) continue;

    if (sample.t === 0) {
      pose[i].rotation = sample.a.rotation.slice();
      pose[i].translation = sample.a.position.slice();
    } else {
      math.Q.slerp(pose[i].rotation, sample.a.rotation, sample.b.rotation, sample.t);
      pose[i].translation = [
        sample.a.position[0] + (sample.b.position[0] - sample.a.position[0]) * sample.t,
        sample.a.position[1] + (sample.b.position[1] - sample.a.position[1]) * sample.t,
        sample.a.position[2] + (sample.b.position[2] - sample.a.position[2]) * sample.t
      ];
    }
  }

  return pose;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sampleVMDPose, findTrackFrame };
}

if (typeof window !== 'undefined') {
  window.AEVUM = window.AEVUM || {};
  window.AEVUM.render = window.AEVUM.render || {};
  window.AEVUM.render.sampleVMDPose = sampleVMDPose;
}
