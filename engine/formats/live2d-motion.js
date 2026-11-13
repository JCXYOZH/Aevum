/**
 * Live2D motion3 动作解析与采样。
 *
 * motion3 由 Meta 与 Curves 组成，每条曲线以 Id 指向参数，Segments 按
 * “起点时间、起点值、段类型、控制点/终点”编码。这里只解析参数曲线，
 * 支持线性、贝塞尔、阶梯与反向阶梯四种段类型，不依赖渲染器。
 */
'use strict';

function _cubic(a, b, c, d, u) {
  const v = 1 - u;
  return v * v * v * a + 3 * v * v * u * b + 3 * v * u * u * c + u * u * u * d;
}

function _solveBezierTime(t0, c1, c2, t1, target) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    const value = _cubic(t0, c1, c2, t1, mid);
    if (value < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function _parseSegments(segments, id) {
  if (!Array.isArray(segments) || segments.length < 4) {
    throw new Error('motion3 曲线 ' + id + ' 的 Segments 不完整');
  }
  const t0 = Number(segments[0]);
  const v0 = Number(segments[1]);
  const list = [];
  let cursor = 2;
  let prevT = t0;
  let prevV = v0;
  while (cursor < segments.length) {
    const type = Number(segments[cursor]);
    cursor += 1;
    if (type === 1) {
      if (cursor + 5 >= segments.length) throw new Error('motion3 贝塞尔段不完整: ' + id);
      list.push({
        type: 1,
        t0: prevT,
        v0: prevV,
        c1t: Number(segments[cursor]),
        c1v: Number(segments[cursor + 1]),
        c2t: Number(segments[cursor + 2]),
        c2v: Number(segments[cursor + 3]),
        t1: Number(segments[cursor + 4]),
        v1: Number(segments[cursor + 5])
      });
      prevT = Number(segments[cursor + 4]);
      prevV = Number(segments[cursor + 5]);
      cursor += 6;
    } else if (type === 0 || type === 2 || type === 3) {
      if (cursor + 1 >= segments.length) throw new Error('motion3 段不完整: ' + id);
      list.push({
        type,
        t0: prevT,
        v0: prevV,
        t1: Number(segments[cursor]),
        v1: Number(segments[cursor + 1])
      });
      prevT = Number(segments[cursor]);
      prevV = Number(segments[cursor + 1]);
      cursor += 2;
    } else {
      throw new Error('motion3 未知段类型 ' + type + ': ' + id);
    }
  }
  return { startTime: t0, startValue: v0, segments: list };
}

class Live2DMotion {
  constructor(json) {
    if (!json || !Array.isArray(json.Curves)) {
      throw new Error('motion3 缺少 Curves');
    }
    const meta = json.Meta || {};
    this.duration = Number(meta.Duration) || 0;
    this.fps = Number(meta.Fps) || 30;
    this.loop = Boolean(meta.Loop);
    this.curves = [];
    for (let i = 0; i < json.Curves.length; i += 1) {
      const curve = json.Curves[i];
      if (!curve || curve.Target !== 'Parameter' || !curve.Id) continue;
      this.curves.push({
        id: curve.Id,
        track: _parseSegments(curve.Segments, curve.Id)
      });
    }
  }

  sampleAt(time) {
    let t = Number(time) || 0;
    if (this.duration > 0) {
      t = this.loop ? ((t % this.duration) + this.duration) % this.duration : Math.max(0, Math.min(this.duration, t));
    }
    const values = {};
    for (let i = 0; i < this.curves.length; i += 1) {
      values[this.curves[i].id] = this._sampleCurve(this.curves[i].track, t);
    }
    return values;
  }

  _sampleCurve(track, time) {
    if (time <= track.startTime) return track.startValue;
    const segments = track.segments;
    if (!segments.length) return track.startValue;
    if (time >= segments[segments.length - 1].t1) return segments[segments.length - 1].v1;
    let lo = 0;
    let hi = segments.length - 1;
    let index = 0;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (segments[mid].t1 < time) lo = mid + 1;
      else {
        index = mid;
        hi = mid - 1;
      }
    }
    const seg = segments[index];
    if (time <= seg.t0) return seg.v0;
    if (time >= seg.t1) return seg.v1;
    const span = seg.t1 - seg.t0;
    if (span <= 0) return seg.v1;
    if (seg.type === 1) {
      const u = _solveBezierTime(seg.t0, seg.c1t, seg.c2t, seg.t1, time);
      return _cubic(seg.v0, seg.c1v, seg.c2v, seg.v1, u);
    }
    if (seg.type === 2) return seg.v0;
    if (seg.type === 3) return seg.v1;
    const ratio = (time - seg.t0) / span;
    return seg.v0 + (seg.v1 - seg.v0) * ratio;
  }
}

function parseMotion3(json) {
  return new Live2DMotion(json);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Live2DMotion, parseMotion3 };
}
if (typeof window !== 'undefined') {
  window.AEVUM = window.AEVUM || {};
  window.AEVUM.formats = window.AEVUM.formats || {};
  window.AEVUM.formats.Live2DMotion = Live2DMotion;
  window.AEVUM.formats.parseMotion3 = parseMotion3;
}
