/**
 * Aevum PMX 变形（Morph）求值
 *
 * 只做“权重 -> 数据”的纯计算，不接触 WebGL，便于 Node 测试。
 * 支持的 morph：
 *   - 顶点变形：输出新的顶点位置
 *   - 骨骼变形：输出叠加到骨骼 pose 上的位移 / 旋转
 *   - 组变形 / 翻转变形：递归展开被引用的 morph
 *   - UV / 材质 / 冲量：记录数量，暂不参与当前渲染管线
 *
 * 用法：
 *   const result = PMXMorph.apply(model, { 5: 1.0 });
 *   renderer.setMorphWeights({ 5: 1.0 }, result);
 *
 * @module Aevum/render/pmx-morph
 */
(function (root) {
  'use strict';

  function getMath() {
    if (root.AEVUM && root.AEVUM.math) return root.AEVUM.math;
    if (typeof require === 'function') return require('../orb/math.js');
    throw new Error('Aevum math core is not loaded');
  }

  function normalizeWeights(weights) {
    if (!weights) return {};
    if (Array.isArray(weights)) {
      const result = {};
      for (let i = 0; i < weights.length; i++) {
        if (weights[i]) result[i] = weights[i];
      }
      return result;
    }
    return weights;
  }

  function apply(model, weights) {
    if (!model) throw new Error('PMXMorph.apply 需要 PMX 模型');
    const weightMap = normalizeWeights(weights);
    const count = model.vertexCount || 0;
    const positions = new Float32Array(count * 3);
    const changed = new Uint8Array(count);
    const bonePose = Object.create(null);
    const stats = {
      vertexMorphs: 0,
      boneMorphs: 0,
      uvMorphs: 0,
      materialMorphs: 0,
      impulseMorphs: 0,
      groupMorphs: 0,
      changedVertices: 0,
      maxDelta: 0
    };

    for (let i = 0; i < count; i++) {
      const p = model.vertices[i].position;
      positions[i * 3] = p[0];
      positions[i * 3 + 1] = p[1];
      positions[i * 3 + 2] = p[2];
    }

    const stack = [];
    const active = new Set();

    function applyOne(morphIndex, weight) {
      const morph = model.morphs[morphIndex];
      if (!morph || !morph.elements || weight === 0) return;

      if (active.has(morphIndex)) return; // 防御循环引用
      active.add(morphIndex);

      if (morph.type === 1) {
        stats.vertexMorphs++;
        const elements = morph.elements;
        for (let e = 0; e < elements.length; e++) {
          const element = elements[e];
          const v = element.vertexIndex;
          if (v == null || v < 0 || v >= count) continue;
          const base = v * 3;
          const dx = (element.position[0] || 0) * weight;
          const dy = (element.position[1] || 0) * weight;
          const dz = (element.position[2] || 0) * weight;
          positions[base] += dx;
          positions[base + 1] += dy;
          positions[base + 2] += dz;
          if (!changed[v] && (dx || dy || dz)) changed[v] = 1;
          const magnitude = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
          if (magnitude > stats.maxDelta) stats.maxDelta = magnitude;
        }
      } else if (morph.type === 2) {
        stats.boneMorphs++;
        const math = getMath();
        const elements = morph.elements;
        for (let e = 0; e < elements.length; e++) {
          const element = elements[e];
          const boneIndex = element.boneIndex;
          if (boneIndex == null || boneIndex < 0) continue;
          const current = bonePose[boneIndex] || {
            translation: [0, 0, 0],
            rotation: math.Q.identity(math.Q.create())
          };
          current.translation[0] += (element.translation[0] || 0) * weight;
          current.translation[1] += (element.translation[1] || 0) * weight;
          current.translation[2] += (element.translation[2] || 0) * weight;
          if (element.rotation) {
            const q = math.Q.identity(math.Q.create());
            q[0] = element.rotation[0] * weight;
            q[1] = element.rotation[1] * weight;
            q[2] = element.rotation[2] * weight;
            q[3] = element.rotation[3] * weight;
            current.rotation = math.Q.mult(math.Q.create(), q, current.rotation);
          }
          bonePose[boneIndex] = current;
        }
      } else if (morph.type === 0 || morph.type === 9) {
        stats.groupMorphs++;
        const elements = morph.elements;
        for (let e = 0; e < elements.length; e++) {
          const element = elements[e];
          stack.push([element.morphIndex, weight * (element.morphWeight || 0)]);
        }
      } else if (morph.type >= 3 && morph.type <= 7) {
        stats.uvMorphs++;
      } else if (morph.type === 8) {
        stats.materialMorphs++;
      } else if (morph.type === 10) {
        stats.impulseMorphs++;
      }

      active.delete(morphIndex);
    }

    for (const key in weightMap) {
      if (!Object.prototype.hasOwnProperty.call(weightMap, key)) continue;
      stack.push([Number(key), weightMap[key]]);
    }

    while (stack.length) {
      const item = stack.pop();
      applyOne(item[0], item[1]);
    }

    for (let i = 0; i < count; i++) {
      if (changed[i]) stats.changedVertices++;
    }
    return { positions, bonePose, stats };
  }

  function findIndex(model, nameOrIndex) {
    if (!model || nameOrIndex == null) return -1;
    if (typeof nameOrIndex === 'number') return nameOrIndex;
    const morphs = model.morphs || [];
    for (let i = 0; i < morphs.length; i++) {
      if (morphs[i].name === nameOrIndex || morphs[i].nameEn === nameOrIndex) return i;
    }
    return -1;
  }

  const api = { apply, findIndex };
  if (!root.AEVUM) root.AEVUM = {};
  if (!root.AEVUM.render) root.AEVUM.render = {};
  root.AEVUM.render.PMXMorph = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
