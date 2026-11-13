/**
 * Aevum VMD 播放器
 *
 * 在 vmd-pose 的采样之上补播放状态：播放、暂停、循环、seek、倍速。
 * 不直接改渲染器，每次 tick 返回当前帧的 pose，调用方交给渲染器。
 *
 * @module Aevum/render/vmd-player
 */
(function (root) {
  'use strict';

  function getSampler() {
    if (root.AEVUM && root.AEVUM.render && root.AEVUM.render.sampleVMDPose) {
      return root.AEVUM.render.sampleVMDPose;
    }
    if (typeof require === 'function') return require('./vmd-pose.js').sampleVMDPose;
    throw new Error('sampleVMDPose is not loaded');
  }

  function createVMDPlayer(vmd, model, options) {
    const opts = options || {};
    const sample = getSampler();
    const totalFrames = vmd && vmd.totalFrames ? vmd.totalFrames : 0;
    const fps = opts.fps || 30;
    let frame = 0;
    let playing = false;
    let loop = opts.loop === undefined ? true : !!opts.loop;
    let speed = opts.speed || 1;

    function poseAt(targetFrame) {
      return sample(model, vmd, targetFrame);
    }

    function seek(targetFrame) {
      const clamped = Math.max(0, Math.min(totalFrames, Number(targetFrame) || 0));
      frame = clamped;
      return poseAt(frame);
    }

    function tick(deltaSeconds) {
      if (!playing) return poseAt(frame);
      frame += (deltaSeconds || 0) * fps * speed;
      if (frame > totalFrames) {
        if (loop) {
          frame = totalFrames > 0 ? frame % totalFrames : 0;
        } else {
          frame = totalFrames;
          playing = false;
        }
      }
      return poseAt(frame);
    }

    return {
      play() { playing = true; },
      pause() { playing = false; },
      stop() {
        playing = false;
        frame = 0;
        return poseAt(0);
      },
      seek,
      tick,
      setLoop(value) { loop = !!value; },
      setSpeed(value) { speed = Number(value) || 1; },
      getPose() { return poseAt(frame); },
      getMorphWeight(name) {
        const track = vmd && vmd.morphFrameMap ? vmd.morphFrameMap[name] : null;
        if (!track || track.length === 0) return 0;
        if (frame <= track[0].frame) return track[0].weight;
        if (frame >= track[track.length - 1].frame) return track[track.length - 1].weight;
        for (let i = 0; i < track.length - 1; i += 1) {
          if (frame >= track[i].frame && frame <= track[i + 1].frame) {
            const span = track[i + 1].frame - track[i].frame;
            const t = span > 0 ? (frame - track[i].frame) / span : 0;
            return track[i].weight + (track[i + 1].weight - track[i].weight) * t;
          }
        }
        return 0;
      },
      get frame() { return frame; },
      get isPlaying() { return playing; },
      get loop() { return loop; },
      get totalFrames() { return totalFrames; }
    };
  }

  const api = { createVMDPlayer };
  if (!root.AEVUM) root.AEVUM = {};
  if (!root.AEVUM.render) root.AEVUM.render = {};
  root.AEVUM.render.createVMDPlayer = createVMDPlayer;
  root.AEVUM.render.VMDPlayer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
