/**
 * Aevum glTF 动作文件
 *
 * 读取 GLB / glTF 里的 animations，把节点 TRS 通道采样成可渲染的 pose。
 * 只做纯计算，不创建 WebGL；PMX 的 VMD 与 glTF 动作共用“动作文件 -> 时间 -> pose”这条路径。
 *
 * 用法：
 *   const glb = parseGLB(arrayBuffer);
 *   const player = GLTFAnimation.createPlayer(glb);
 *   player.setClip('walk');
 *   player.update(dt);
 *   const pose = player.getPose();   // { rotation, translation, scale }
 *
 * rotation 的 key 是节点索引，value 是 [x, y, z, w]；
 * translation / scale 的 key 也是节点索引，value 是 [x, y, z]。
 *
 * @module Aevum/formats/gltf-animation
 */
(function (root) {
  'use strict';

  function getAccessor() {
    if (root.AEVUM && root.AEVUM.formats && root.AEVUM.formats.readAccessor) {
      return root.AEVUM.formats.readAccessor;
    }
    if (typeof require === 'function') return require('./gltf-accessor.js').readAccessor;
    throw new Error('glTF accessor reader is not loaded');
  }

  function getMath() {
    if (root.AEVUM && root.AEVUM.math) return root.AEVUM.math;
    if (typeof require === 'function') return require('../../math/math.js');
    throw new Error('Aevum math core is not loaded');
  }

  const PATH_STRIDE = { translation: 3, rotation: 4, scale: 3 };

  /**
   * 找到时间所在的关键帧区间。
   * @returns {{index:number, alpha:number}} index 为左关键帧
   */
  function findKeyframe(times, time) {
    if (!times.length) return { index: 0, alpha: 0 };
    if (time <= times[0]) return { index: 0, alpha: 0 };
    if (time >= times[times.length - 1]) {
      return { index: times.length - 1, alpha: 0 };
    }
    let low = 0;
    let high = times.length - 1;
    while (low + 1 < high) {
      const mid = (low + high) >> 1;
      if (times[mid] <= time) low = mid;
      else high = mid;
    }
    const span = times[high] - times[low];
    return { index: low, alpha: span > 0 ? (time - times[low]) / span : 0 };
  }

  function readVector(values, index, stride) {
    const out = new Array(stride);
    const offset = index * stride;
    for (let i = 0; i < stride; i++) out[i] = values[offset + i];
    return out;
  }

  /**
   * 采样一条通道。
   * @param {Object} track { times, values, stride, path, interpolation }
   * @param {number} time 秒
   */
  function sampleTrack(track, time) {
    if (!track || !track.times || !track.times.length) return null;
    const key = findKeyframe(track.times, time);
    const a = readVector(track.values, key.index, track.stride);
    if (key.alpha <= 0 || track.interpolation === 'STEP') return a;
    const bIndex = Math.min(track.times.length - 1, key.index + 1);
    if (bIndex === key.index) return a;
    const b = readVector(track.values, bIndex, track.stride);
    if (track.path === 'rotation') {
      const math = getMath();
      const out = math.Q.create ? math.Q.create() : [0, 0, 0, 0];
      math.Q.slerp(out, a, b, key.alpha);
      const len = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
      out[0] /= len;
      out[1] /= len;
      out[2] /= len;
      out[3] /= len;
      return out;
    }
    const out = new Array(track.stride);
    for (let i = 0; i < track.stride; i++) out[i] = a[i] + (b[i] - a[i]) * key.alpha;
    return out;
  }

  function decodeClip(json, binary, animation, readAccessor) {
    const samplers = [];
    for (let i = 0; i < animation.samplers.length; i += 1) {
      const def = animation.samplers[i];
      const input = json.accessors[def.input];
      const output = json.accessors[def.output];
      if (def.interpolation === 'CUBICSPLINE') {
        throw new Error('暂不支持 CUBICSPLINE 插值：' + (animation.name || 'animation'));
      }
      samplers.push({
        times: readAccessor(json, binary, def.input),
        values: readAccessor(json, binary, def.output),
        interpolation: def.interpolation || 'LINEAR',
        count: input.count,
        stride: Math.max(1, Math.floor(output.count / Math.max(1, input.count)))
      });
    }

    const channels = [];
    for (let i = 0; i < animation.channels.length; i += 1) {
      const channel = animation.channels[i];
      if (!channel.target || channel.target.node === undefined) continue;
      const path = channel.target.path;
      if (!PATH_STRIDE[path]) continue;
      channels.push({
        node: channel.target.node,
        path,
        track: {
          times: samplers[channel.sampler].times,
          values: samplers[channel.sampler].values,
          interpolation: samplers[channel.sampler].interpolation,
          stride: PATH_STRIDE[path],
          path
        }
      });
    }

    let duration = 0;
    for (let i = 0; i < samplers.length; i += 1) {
      const times = samplers[i].times;
      if (times.length) duration = Math.max(duration, times[times.length - 1]);
    }

    return { name: animation.name || 'animation', channels, duration };
  }

  function createPlayer(glb) {
    const json = glb.json || glb;
    const binary = glb.binary || glb.bin;
    if (!json || !json.animations || !json.animations.length) {
      throw new Error('glTF 没有动画');
    }
    const readAccessor = getAccessor();
    const clips = [];
    for (let i = 0; i < json.animations.length; i += 1) {
      clips.push(decodeClip(json, binary, json.animations[i], readAccessor));
    }

    let clipIndex = 0;
    let time = 0;
    let loop = true;
    let playing = true;

    function setClip(nameOrIndex) {
      let index = -1;
      if (typeof nameOrIndex === 'number') index = nameOrIndex;
      else {
        for (let i = 0; i < clips.length; i += 1) {
          if (clips[i].name === nameOrIndex) { index = i; break; }
        }
      }
      if (index < 0 || index >= clips.length) {
        throw new Error('动作不存在：' + nameOrIndex);
      }
      clipIndex = index;
      time = 0;
      return api;
    }

    function update(dt) {
      if (!playing) return api;
      time += Math.max(0, Number(dt) || 0);
      const duration = clips[clipIndex].duration;
      if (time > duration) {
        time = loop && duration > 0 ? time % duration : duration;
      }
      return api;
    }

    function getPose(atTime) {
      const clip = clips[clipIndex];
      const sampleTime = atTime === undefined ? time : atTime;
      const pose = {
        rotation: Object.create(null),
        translation: Object.create(null),
        scale: Object.create(null)
      };
      for (let i = 0; i < clip.channels.length; i += 1) {
        const channel = clip.channels[i];
        const value = sampleTrack(channel.track, sampleTime);
        if (!value) continue;
        const target = pose[channel.path];
        if (target) target[channel.node] = value;
      }
      return pose;
    }

    const api = {
      clips,
      setClip,
      update,
      getPose,
      sampleAt(index, atTime) {
        const previous = clipIndex;
        clipIndex = index;
        const pose = getPose(atTime);
        clipIndex = previous;
        return pose;
      },
      get clip() { return clips[clipIndex].name; },
      get duration() { return clips[clipIndex].duration; },
      get time() { return time; },
      get isPlaying() { return playing; },
      play() { playing = true; return api; },
      pause() { playing = false; return api; },
      setLoop(value) { loop = !!value; return api; },
      reset() { time = 0; return api; }
    };

    return api;
  }

  const api = { createPlayer, sampleTrack, findKeyframe };

  if (!root.AEVUM) root.AEVUM = {};
  if (!root.AEVUM.formats) root.AEVUM.formats = {};
  root.AEVUM.formats.GLTFAnimation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
