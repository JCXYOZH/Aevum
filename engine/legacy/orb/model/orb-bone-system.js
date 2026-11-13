/**
 * MrHua 3D灵体渲染引擎 - orb-bone-system
 * 骨骼蒙皮系统
 * 从 orb-renderer-main.js 拆分 (原行 L2129-L2243)
 * @module orb-bone-system
 */
'use strict';

/* ===== 骨骼系统 ===== */
function buildBoneSystem(model, referencedBones){
  const bones = model.bones;
  const n = bones.length;
  const restLocal = new Array(n);
  const restGlobal = new Array(n);
  const inverseBind = new Array(n);
  const currentLocal = new Array(n);
  const currentGlobal = new Array(n);
  const palette = new Float32Array(n*16);
  const order = [];
  const visited = new Uint8Array(n);
  const inStack = new Uint8Array(n);

  function visitIter(start){
    if(visited[start]) return;
    const stack = [start];
    while(stack.length > 0){
      const i = stack[stack.length - 1];
      if(visited[i]){ stack.pop(); continue; }
      if(inStack[i]){
        // 检测到循环，强制标记为已访问并加入order
        visited[i] = 1; order.push(i); stack.pop(); continue;
      }
      inStack[i] = 1;
      const p = bones[i].parent;
      if(p >= 0 && p < n && !visited[p]){
        stack.push(p);
      } else {
        visited[i] = 1; order.push(i); stack.pop();
      }
    }
  }
  for(let i=0;i<n;i++) visitIter(i);

  let computeOrder = order;
  // 临时禁用computeOrder过滤，测试下半身消失问题
  // if(referencedBones && referencedBones.length > 0 && referencedBones.length < n){
  //   const needed = new Uint8Array(n);
  //   let neededCount = 0;
  //   for(let ri=0; ri<referencedBones.length; ri++){
  //     let bi = referencedBones[ri];
  //     while(bi >= 0 && bi < n && !needed[bi]){
  //       needed[bi] = 1; neededCount++;
  //       bi = bones[bi].parent;
  //     }
  //   }
  //   if(neededCount < n){
  //     computeOrder = new Array(neededCount);
  //     let ci = 0;
  //     for(let oi=0; oi<order.length; oi++){
  //       if(needed[order[oi]]) computeOrder[ci++] = order[oi];
  //     }
  //   }
  // }

  const tmp=M4.create();
  const _identQ = Q.identity(Q.create());
  const _unitScl = [1,1,1];
  // 修复骨骼自引用：parent=i时视为无父骨骼，否则localPos=0导致蒙皮矩阵为单位矩阵
  let _selfRefCount = 0;
  for(let i=0;i<n;i++){
    if(bones[i] && bones[i].parent === i){
      bones[i].parent = -1;
      _selfRefCount++;
    }
  }
  if(_selfRefCount>0) console.log('[PMX-BONE] 修复骨骼自引用: ' + _selfRefCount + ' 个骨骼的parent指向自己，已改为-1');
  for(const i of order){
    const b=bones[i] || {position:[0,0,0],parent:-1};
    const pos=b.position || [0,0,0];
    // PMX骨骼position是绝对位置，有父骨骼时需计算相对平移
    let localPos = pos;
    if(b.parent>=0 && b.parent<n && bones[b.parent]){
      const pp = bones[b.parent].position || [0,0,0];
      localPos = [pos[0]-pp[0], pos[1]-pp[1], pos[2]-pp[2]];
    }
    const rot=Q.identity(Q.create());
    const scl=[1,1,1];
    restLocal[i]=M4.fromTRS(M4.create(),localPos,rot,scl);
    if(b.parent>=0 && b.parent<n && restGlobal[b.parent]){
      restGlobal[i]=M4.mult(M4.create(),restGlobal[b.parent],restLocal[i]);
    } else {
      restGlobal[i]=M4.copy(M4.create(),restLocal[i]);
    }
    inverseBind[i]=M4.invert(M4.create(),restGlobal[i]);
    currentLocal[i]=M4.copy(M4.create(),restLocal[i]);
    currentGlobal[i]=M4.copy(M4.create(),restGlobal[i]);
  }

  function computePalette(poseRotations, posePositions){
    for(const i of computeOrder){
      const b=bones[i] || {position:[0,0,0],parent:-1};
      const absPos = (posePositions && posePositions[i]) ? posePositions[i] : (b.position || [0,0,0]);
      let localPos = absPos;
      if(b.parent>=0 && b.parent<n && bones[b.parent]){
        const pp = (posePositions && posePositions[b.parent]) ? posePositions[b.parent] : (bones[b.parent].position || [0,0,0]);
        localPos = [absPos[0]-pp[0], absPos[1]-pp[1], absPos[2]-pp[2]];
      }
      const rot = poseRotations && poseRotations[i] ? poseRotations[i] : _identQ;
      M4.fromTRS(currentLocal[i],localPos,rot,_unitScl);
      if(b.parent>=0 && b.parent<n && currentGlobal[b.parent]){
        M4.mult(currentGlobal[i],currentGlobal[b.parent],currentLocal[i]);
      } else {
        M4.copy(currentGlobal[i],currentLocal[i]);
      }
      M4.mult(tmp,currentGlobal[i],inverseBind[i]);
      palette.set(tmp, i*16);
    }
    return palette;
  }

  return { bones, order, computeOrder, restGlobal, inverseBind, computePalette, palette };
}

