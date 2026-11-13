
/* ===== 粒子系统 ===== */
const EmitterType = { POINT: 0, SPHERE: 1, BOX: 2, CONE: 3, CIRCLE: 4 };
function createParticleSystem(gl, maxParticles, options){
  const opt = options || {};
  const ps = {
    gl: gl,
    maxParticles: maxParticles,
    particles: [],
    _positionData: new Float32Array(maxParticles*3),
    _colorData: new Float32Array(maxParticles*4),
    _sizeData: new Float32Array(maxParticles),
    _positionBuffer: null,
    _colorBuffer: null,
    _sizeBuffer: null,
    _program: null,
    _texture: opt.texture || null,
    emitters: [],
    gravity: opt.gravity ? opt.gravity.slice() : [0,-9.8,0],
    wind: opt.wind ? opt.wind.slice() : [0,0,0],
    globalDamping: opt.globalDamping !== undefined ? opt.globalDamping : 0.98,
    blending: opt.blending !== undefined ? opt.blending : true,
    depthWrite: opt.depthWrite !== undefined ? opt.depthWrite : false,
    _activeCount: 0,
  };
  ps._positionBuffer = gl.createBuffer();
  ps._colorBuffer = gl.createBuffer();
  ps._sizeBuffer = gl.createBuffer();
  const vsSrc = 'attribute vec3 aPos; attribute vec4 aColor; attribute float aSize; uniform mat4 uViewProj; varying vec4 vColor; void main(){ vColor=aColor; vec4 p=uViewProj*vec4(aPos,1.0); gl_Position=p; gl_PointSize=aSize/p.w*100.0; }';
  const fsSrc = 'precision highp float; varying vec4 vColor; uniform sampler2D uTex; uniform int uHasTex; void main(){ if(uHasTex==1){ vec4 t=texture2D(uTex,gl_PointCoord); gl_FragColor=vColor*t; if(gl_FragColor.a<0.01) discard; } else { vec2 d=gl_PointCoord-0.5; float r=dot(d,d); if(r>0.25) discard; gl_FragColor=vColor; } }';
  function compileShader(type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }
  const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
  ps._program = gl.createProgram();
  gl.attachShader(ps._program, vs);
  gl.attachShader(ps._program, fs);
  gl.linkProgram(ps._program);
  ps._aPos = gl.getAttribLocation(ps._program, 'aPos');
  ps._aColor = gl.getAttribLocation(ps._program, 'aColor');
  ps._aSize = gl.getAttribLocation(ps._program, 'aSize');
  ps._uViewProj = gl.getUniformLocation(ps._program, 'uViewProj');
  ps._uTex = gl.getUniformLocation(ps._program, 'uTex');
  ps._uHasTex = gl.getUniformLocation(ps._program, 'uHasTex');
  function createParticle(position, velocity, color, size, life){
    return {
      position: position ? position.slice() : [0,0,0],
      velocity: velocity ? velocity.slice() : [0,0,0],
      color: color ? color.slice() : [1,1,1,1],
      size: size || 1,
      life: life || 1,
      maxLife: life || 1,
      alive: true,
    };
  }
  function createEmitter(type, position, options){
    const opt = options || {};
    return {
      type: type,
      position: position ? position.slice() : [0,0,0],
      rotation: opt.rotation ? opt.rotation.slice() : [0,0,0],
      rate: opt.rate || 10,
      _accumulator: 0,
      life: opt.life || 1,
      size: opt.size || 1,
      sizeVariation: opt.sizeVariation || 0,
      speed: opt.speed || 1,
      speedVariation: opt.speedVariation || 0,
      color: opt.color ? opt.color.slice() : [1,1,1,1],
      colorVariation: opt.colorVariation || 0,
      spread: opt.spread || 0.5,
      radius: opt.radius || 1,
      halfExtents: opt.halfExtents ? opt.halfExtents.slice() : [1,1,1],
      angle: opt.angle || Math.PI/4,
      enabled: true,
    };
  }
  function addEmitter(emitter){ ps.emitters.push(emitter); return emitter; }
  function removeEmitter(emitter){
    const idx = ps.emitters.indexOf(emitter);
    if(idx >= 0) ps.emitters.splice(idx,1);
  }
  function emitParticle(emitter){
    let pos = [0,0,0], vel = [0,0,0];
    if(emitter.type === EmitterType.POINT){
      pos = emitter.position.slice();
      const theta = Math.random()*Math.PI*2;
      const phi = Math.acos(2*Math.random()-1);
      vel = [Math.sin(phi)*Math.cos(theta), Math.cos(phi), Math.sin(phi)*Math.sin(theta)];
    } else if(emitter.type === EmitterType.SPHERE){
      const theta = Math.random()*Math.PI*2;
      const phi = Math.acos(2*Math.random()-1);
      const r = emitter.radius*Math.cbrt(Math.random());
      pos = [emitter.position[0]+r*Math.sin(phi)*Math.cos(theta), emitter.position[1]+r*Math.cos(phi), emitter.position[2]+r*Math.sin(phi)*Math.sin(theta)];
      vel = [Math.sin(phi)*Math.cos(theta), Math.cos(phi), Math.sin(phi)*Math.sin(theta)];
    } else if(emitter.type === EmitterType.BOX){
      pos = [emitter.position[0]+(Math.random()*2-1)*emitter.halfExtents[0], emitter.position[1]+(Math.random()*2-1)*emitter.halfExtents[1], emitter.position[2]+(Math.random()*2-1)*emitter.halfExtents[2]];
      vel = [0,1,0];
    } else if(emitter.type === EmitterType.CONE){
      const theta = Math.random()*Math.PI*2;
      const r = Math.random()*emitter.radius;
      pos = [emitter.position[0]+r*Math.cos(theta), emitter.position[1], emitter.position[2]+r*Math.sin(theta)];
      const spread = emitter.spread;
      vel = [(Math.random()*2-1)*spread, 1, (Math.random()*2-1)*spread];
    } else if(emitter.type === EmitterType.CIRCLE){
      const theta = Math.random()*Math.PI*2;
      pos = [emitter.position[0]+Math.cos(theta)*emitter.radius, emitter.position[1], emitter.position[2]+Math.sin(theta)*emitter.radius];
      vel = [0,1,0];
    }
    const speed = emitter.speed + (Math.random()*2-1)*emitter.speedVariation;
    vel[0]*=speed; vel[1]*=speed; vel[2]*=speed;
    const vl=Math.sqrt(vel[0]**2+vel[1]**2+vel[2]**2)||1;
    vel[0]/=vl; vel[1]/=vl; vel[2]/=vl;
    vel[0]*=speed; vel[1]*=speed; vel[2]*=speed;
    const color = [
      emitter.color[0]+(Math.random()*2-1)*emitter.colorVariation,
      emitter.color[1]+(Math.random()*2-1)*emitter.colorVariation,
      emitter.color[2]+(Math.random()*2-1)*emitter.colorVariation,
      emitter.color[3],
    ];
    const size = emitter.size + (Math.random()*2-1)*emitter.sizeVariation;
    const life = emitter.life;
    if(ps.particles.length < ps.maxParticles){
      ps.particles.push(createParticle(pos, vel, color, size, life));
    }
  }
  function update(dt){
    for(const emitter of ps.emitters){
      if(!emitter.enabled) continue;
      emitter._accumulator += emitter.rate * dt;
      while(emitter._accumulator >= 1){
        emitParticle(emitter);
        emitter._accumulator -= 1;
      }
    }
    for(let i=ps.particles.length-1;i>=0;i--){
      const p = ps.particles[i];
      p.life -= dt;
      if(p.life <= 0){ ps.particles.splice(i,1); continue; }
      p.velocity[0] += ps.gravity[0]*dt;
      p.velocity[1] += ps.gravity[1]*dt;
      p.velocity[2] += ps.gravity[2]*dt;
      p.velocity[0] += ps.wind[0]*dt;
      p.velocity[1] += ps.wind[1]*dt;
      p.velocity[2] += ps.wind[2]*dt;
      p.velocity[0] *= ps.globalDamping;
      p.velocity[1] *= ps.globalDamping;
      p.velocity[2] *= ps.globalDamping;
      p.position[0] += p.velocity[0]*dt;
      p.position[1] += p.velocity[1]*dt;
      p.position[2] += p.velocity[2]*dt;
      p.color[3] = (p.life/p.maxLife) * (p.color[3] || 1);
    }
    ps._activeCount = ps.particles.length;
  }
  function render(viewProj){
    if(ps._activeCount === 0) return;
    gl.useProgram(ps._program);
    gl.uniformMatrix4fv(ps._uViewProj, false, viewProj);
    gl.uniform1i(ps._uHasTex, ps._texture ? 1 : 0);
    if(ps._texture){ gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ps._texture); gl.uniform1i(ps._uTex, 0); }
    for(let i=0;i<ps._activeCount;i++){
      const p = ps.particles[i];
      ps._positionData[i*3]=p.position[0]; ps._positionData[i*3+1]=p.position[1]; ps._positionData[i*3+2]=p.position[2];
      ps._colorData[i*4]=p.color[0]; ps._colorData[i*4+1]=p.color[1]; ps._colorData[i*4+2]=p.color[2]; ps._colorData[i*4+3]=p.color[3];
      ps._sizeData[i]=p.size;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, ps._positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, ps._positionData.subarray(0,ps._activeCount*3), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(ps._aPos);
    gl.vertexAttribPointer(ps._aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, ps._colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, ps._colorData.subarray(0,ps._activeCount*4), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(ps._aColor);
    gl.vertexAttribPointer(ps._aColor, 4, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, ps._sizeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, ps._sizeData.subarray(0,ps._activeCount), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(ps._aSize);
    gl.vertexAttribPointer(ps._aSize, 1, gl.FLOAT, false, 0, 0);
    if(ps.blending){ gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
    if(!ps.depthWrite) gl.depthMask(false);
    gl.drawArrays(gl.POINTS, 0, ps._activeCount);
    if(!ps.depthWrite) gl.depthMask(true);
  }
  function clear(){ ps.particles.length = 0; ps._activeCount = 0; }
  function dispose(){
    gl.deleteBuffer(ps._positionBuffer);
    gl.deleteBuffer(ps._colorBuffer);
    gl.deleteBuffer(ps._sizeBuffer);
    gl.deleteProgram(ps._program);
  }
  console.log('[ParticleSystem] 创建完成 maxParticles=' + maxParticles);
  return { update, render, addEmitter, removeEmitter, createEmitter, createParticle, clear, dispose, get activeCount(){return ps._activeCount;}, ps };
}

/* ===== 几何生成系统 ===== */
function createPlaneGeometry(width, height, segmentsW, segmentsH){
  const sw = segmentsW || 1, sh = segmentsH || 1;
  const positions = [], normals = [], uvs = [], indices = [];
  for(let y=0;y<=sh;y++){
    for(let x=0;x<=sw;x++){
      const u=x/sw, v=y/sh;
      positions.push((u-0.5)*width, 0, (v-0.5)*height);
      normals.push(0,1,0);
      uvs.push(u, v);
    }
  }
  for(let y=0;y<sh;y++){
    for(let x=0;x<sw;x++){
      const a=y*(sw+1)+x, b=a+1, c=a+(sw+1), d=c+1;
      indices.push(a,c,b, b,c,d);
    }
  }
  return { positions:new Float32Array(positions), normals:new Float32Array(normals), uvs:new Float32Array(uvs), indices:new Uint32Array(indices), vertexCount:positions.length/3, indexCount:indices.length };
}
function createBoxGeometry(width, height, depth, segmentsW, segmentsH, segmentsD){
  const sw=segmentsW||1, sh=segmentsH||1, sd=segmentsD||1;
  const positions=[], normals=[], uvs=[], indices=[];
  function buildFace(nx,ny,nz, ux,uy,uz, vx,vy,vz, w,h,d, segU, segV){
    const start = positions.length/3;
    for(let y=0;y<=segV;y++){
      for(let x=0;x<=segU;x++){
        const u=x/segU, v=y/segV;
        positions.push(nx*w/2+ux*(u-0.5)*w+vx*(v-0.5)*h, ny*h/2+uy*(u-0.5)*w+vy*(v-0.5)*h, nz*d/2+uz*(u-0.5)*w+vz*(v-0.5)*h);
        normals.push(nx,ny,nz);
        uvs.push(u,v);
      }
    }
    for(let y=0;y<segV;y++){
      for(let x=0;x<segU;x++){
        const a=start+y*(segU+1)+x, b=a+1, c=a+(segU+1), d=c+1;
        indices.push(a,c,b,b,c,d);
      }
    }
  }
  buildFace(0,1,0, 1,0,0, 0,0,1, width,height,depth, sw,sd);
  buildFace(0,-1,0, 1,0,0, 0,0,-1, width,height,depth, sw,sd);
  buildFace(1,0,0, 0,0,1, 0,1,0, width,height,depth, sd,sh);
  buildFace(-1,0,0, 0,0,-1, 0,1,0, width,height,depth, sd,sh);
  buildFace(0,0,1, 1,0,0, 0,1,0, width,height,depth, sw,sh);
  buildFace(0,0,-1, -1,0,0, 0,1,0, width,height,depth, sw,sh);
  return { positions:new Float32Array(positions), normals:new Float32Array(normals), uvs:new Float32Array(uvs), indices:new Uint32Array(indices), vertexCount:positions.length/3, indexCount:indices.length };
}
function createSphereGeometry(radius, widthSegments, heightSegments){
  const ws=widthSegments||32, hs=heightSegments||16;
  const positions=[], normals=[], uvs=[], indices=[];
  for(let y=0;y<=hs;y++){
    const v=y/hs, theta=v*Math.PI;
    for(let x=0;x<=ws;x++){
      const u=x/ws, phi=u*Math.PI*2;
      const px=-radius*Math.sin(theta)*Math.cos(phi), py=radius*Math.cos(theta), pz=radius*Math.sin(theta)*Math.sin(phi);
      positions.push(px,py,pz);
      normals.push(px/radius,py/radius,pz/radius);
      uvs.push(u,v);
    }
  }
  for(let y=0;y<hs;y++){
    for(let x=0;x<ws;x++){
      const a=y*(ws+1)+x, b=a+1, c=a+(ws+1), d=c+1;
      indices.push(a,c,b,b,c,d);
    }
  }
  return { positions:new Float32Array(positions), normals:new Float32Array(normals), uvs:new Float32Array(uvs), indices:new Uint32Array(indices), vertexCount:positions.length/3, indexCount:indices.length };
}
function createCylinderGeometry(radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded){
  const rs=radialSegments||32, hs=heightSegments||1;
  const positions=[], normals=[], uvs=[], indices=[];
  for(let y=0;y<=hs;y++){
    const v=y/hs, r=radiusTop+(radiusBottom-radiusTop)*v;
    for(let x=0;x<=rs;x++){
      const u=x/rs, theta=u*Math.PI*2;
      positions.push(r*Math.cos(theta), (v-0.5)*height, r*Math.sin(theta));
      normals.push(Math.cos(theta),0,Math.sin(theta));
      uvs.push(u,v);
    }
  }
  for(let y=0;y<hs;y++){
    for(let x=0;x<rs;x++){
      const a=y*(rs+1)+x, b=a+1, c=a+(rs+1), d=c+1;
      indices.push(a,c,b,b,c,d);
    }
  }
  if(!openEnded){
    const topStart=positions.length/3;
    positions.push(0,height/2,0); normals.push(0,1,0); uvs.push(0.5,0.5);
    for(let x=0;x<=rs;x++){
      const u=x/rs, theta=u*Math.PI*2;
      positions.push(radiusTop*Math.cos(theta),height/2,radiusTop*Math.sin(theta));
      normals.push(0,1,0); uvs.push(Math.cos(theta)*0.5+0.5,Math.sin(theta)*0.5+0.5);
    }
    for(let x=0;x<rs;x++) indices.push(topStart,topStart+x+2,topStart+x+1);
    const bottomStart=positions.length/3;
    positions.push(0,-height/2,0); normals.push(0,-1,0); uvs.push(0.5,0.5);
    for(let x=0;x<=rs;x++){
      const u=x/rs, theta=u*Math.PI*2;
      positions.push(radiusBottom*Math.cos(theta),-height/2,radiusBottom*Math.sin(theta));
      normals.push(0,-1,0); uvs.push(Math.cos(theta)*0.5+0.5,Math.sin(theta)*0.5+0.5);
    }
    for(let x=0;x<rs;x++) indices.push(bottomStart,bottomStart+x+1,bottomStart+x+2);
  }
  return { positions:new Float32Array(positions), normals:new Float32Array(normals), uvs:new Float32Array(uvs), indices:new Uint32Array(indices), vertexCount:positions.length/3, indexCount:indices.length };
}
function createTorusGeometry(radius, tube, radialSegments, tubularSegments, arc){
  const rs=radialSegments||16, ts=tubularSegments||100, a=arc||Math.PI*2;
  const positions=[], normals=[], uvs=[], indices=[];
  for(let j=0;j<=rs;j++){
    for(let i=0;i<=ts;i++){
      const u=i/ts*a, v=j/rs*Math.PI*2;
      const x=(radius+tube*Math.cos(v))*Math.cos(u), y=tube*Math.sin(v), z=(radius+tube*Math.cos(v))*Math.sin(u);
      positions.push(x,y,z);
      const cx=radius*Math.cos(u), cz=radius*Math.sin(u);
      const nx=x-cx, ny=y, nz=z-cz;
      const nl=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
      normals.push(nx/nl,ny/nl,nz/nl);
      uvs.push(i/ts,j/rs);
    }
  }
  for(let j=1;j<=rs;j++){
    for(let i=1;i<=ts;i++){
      const a=(ts+1)*j+i-1, b=(ts+1)*(j-1)+i-1, c=(ts+1)*(j-1)+i, d=(ts+1)*j+i;
      indices.push(a,b,d,b,c,d);
    }
  }
  return { positions:new Float32Array(positions), normals:new Float32Array(normals), uvs:new Float32Array(uvs), indices:new Uint32Array(indices), vertexCount:positions.length/3, indexCount:indices.length };
}
function computeGeometryNormals(geometry){
  const positions=geometry.positions, indices=geometry.indices;
  const normals=new Float32Array(positions.length);
  for(let i=0;i<indices.length;i+=3){
    const ia=indices[i]*3, ib=indices[i+1]*3, ic=indices[i+2]*3;
    const ax=positions[ib]-positions[ia], ay=positions[ib+1]-positions[ia+1], az=positions[ib+2]-positions[ia+2];
    const bx=positions[ic]-positions[ia], by=positions[ic+1]-positions[ia+1], bz=positions[ic+2]-positions[ia+2];
    const nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx;
    normals[ia]+=nx; normals[ia+1]+=ny; normals[ia+2]+=nz;
    normals[ib]+=nx; normals[ib+1]+=ny; normals[ib+2]+=nz;
    normals[ic]+=nx; normals[ic+1]+=ny; normals[ic+2]+=nz;
  }
  for(let i=0;i<normals.length;i+=3){
    const l=Math.sqrt(normals[i]**2+normals[i+1]**2+normals[i+2]**2)||1;
    normals[i]/=l; normals[i+1]/=l; normals[i+2]/=l;
  }
  geometry.normals = normals;
  return geometry;
}
function mergeGeometry(geometries){
  let totalVerts=0, totalIndices=0;
  for(const g of geometries){ totalVerts+=g.vertexCount; totalIndices+=g.indexCount; }
  const positions=new Float32Array(totalVerts*3), normals=new Float32Array(totalVerts*3), uvs=new Float32Array(totalVerts*2), indices=new Uint32Array(totalIndices);
  let vo=0, io=0;
  for(const g of geometries){
    positions.set(g.positions, vo*3);
    if(g.normals) normals.set(g.normals, vo*3);
    if(g.uvs) uvs.set(g.uvs, vo*2);
    for(let i=0;i<g.indexCount;i++) indices[io+i]=g.indices[i]+vo;
    vo+=g.vertexCount; io+=g.indexCount;
  }
  return { positions, normals, uvs, indices, vertexCount:totalVerts, indexCount:totalIndices };
}

/* ===== 动画混合系统 ===== */
const BlendMode = { OVERRIDE: 0, ADDITIVE: 1, MULTIPLY: 2, LERP: 3 };
function createAnimationClip(name, duration, tracks){
  return {
    name: name,
    duration: duration || 0,
    tracks: tracks || [],
    loop: true,
    speed: 1,
    _cache: {},
  };
}
function createAnimationTrack(boneName, type, keyframes){
  return {
    boneName: boneName,
    type: type || 'rotation',
    keyframes: keyframes || [],
    _sorted: false,
  };
}
function createAnimationMixer(boneSystem){
  const bones = boneSystem.bones;
  const boneCount = bones.length;
  const mixer = {
    boneSystem: boneSystem,
    clips: [],
    activeActions: [],
    _poseRotations: new Array(boneCount),
    _posePositions: new Array(boneCount),
    _tempQ: [0,0,0,1],
    _tempPos: [0,0,0],
    time: 0,
  };
  const _identQ = [0,0,0,1];
  for(let i=0;i<boneCount;i++){ mixer._poseRotations[i]=_identQ; mixer._posePositions[i]=bones[i].position; }
  function addClip(clip){ mixer.clips.push(clip); return clip; }
  function removeClip(clip){
    const idx = mixer.clips.indexOf(clip);
    if(idx >= 0) mixer.clips.splice(idx,1);
  }
  function play(clipName, options){
    const opt = options || {};
    const clip = mixer.clips.find(c=>c.name===clipName);
    if(!clip) return null;
    const action = {
      clip: clip,
      time: opt.startTime || 0,
      weight: opt.weight !== undefined ? opt.weight : 1,
      blendMode: opt.blendMode || BlendMode.OVERRIDE,
      loop: opt.loop !== undefined ? opt.loop : clip.loop,
      speed: opt.speed || clip.speed,
      enabled: true,
      _boneMap: {},
    };
    for(const track of clip.tracks){
      const boneIdx = bones.findIndex(b=>b.name===track.boneName);
      if(boneIdx >= 0) action._boneMap[track.boneName] = boneIdx;
    }
    mixer.activeActions.push(action);
    return action;
  }
  function stop(clipName){
    for(let i=mixer.activeActions.length-1;i>=0;i--){
      if(mixer.activeActions[i].clip.name===clipName) mixer.activeActions.splice(i,1);
    }
  }
  function stopAll(){ mixer.activeActions.length = 0; }
  function sampleTrack(track, time, out){
    if(!track._sorted){ track.keyframes.sort((a,b)=>a.time-b.time); track._sorted=true; }
    const kfs = track.keyframes;
    if(kfs.length===0) return null;
    if(time <= kfs[0].time){ if(track.type==='rotation'){out[0]=kfs[0].value[0];out[1]=kfs[0].value[1];out[2]=kfs[0].value[2];out[3]=kfs[0].value[3];} else {out[0]=kfs[0].value[0];out[1]=kfs[0].value[1];out[2]=kfs[0].value[2];} return out; }
    if(time >= kfs[kfs.length-1].time){ const v=kfs[kfs.length-1].value; if(track.type==='rotation'){out[0]=v[0];out[1]=v[1];out[2]=v[2];out[3]=v[3];} else {out[0]=v[0];out[1]=v[1];out[2]=v[2];} return out; }
    let lo=0, hi=kfs.length-1;
    while(lo<=hi){ const mid=(lo+hi)>>1; if(kfs[mid].time===time){ const v=kfs[mid].value; if(track.type==='rotation'){out[0]=v[0];out[1]=v[1];out[2]=v[2];out[3]=v[3];} else {out[0]=v[0];out[1]=v[1];out[2]=v[2];} return out; } if(kfs[mid].time<time) lo=mid+1; else hi=mid-1; }
    const i0=Math.max(0,lo-1), i1=Math.min(kfs.length-1,lo);
    const t=(time-kfs[i0].time)/(kfs[i1].time-kfs[i0].time||1);
    if(track.type==='rotation'){ Q.slerp(out, kfs[i0].value, kfs[i1].value, t); }
    else { out[0]=kfs[i0].value[0]+(kfs[i1].value[0]-kfs[i0].value[0])*t; out[1]=kfs[i0].value[1]+(kfs[i1].value[1]-kfs[i0].value[1])*t; out[2]=kfs[i0].value[2]+(kfs[i1].value[2]-kfs[i0].value[2])*t; }
    return out;
  }
  function update(dt){
    mixer.time += dt;
    for(let i=0;i<boneCount;i++){ mixer._poseRotations[i]=_identQ; mixer._posePositions[i]=bones[i].position; }
    for(const action of mixer.activeActions){
      if(!action.enabled) continue;
      action.time += dt * action.speed;
      if(action.loop && action.clip.duration>0) action.time %= action.clip.duration;
      else if(!action.loop && action.time >= action.clip.duration){ action.enabled=false; continue; }
      for(const track of action.clip.tracks){
        const boneIdx = action._boneMap[track.boneName];
        if(boneIdx === undefined) continue;
        if(track.type==='rotation'){
          const q = sampleTrack(track, action.time, mixer._tempQ);
          if(q){
            if(action.blendMode===BlendMode.OVERRIDE){ mixer._poseRotations[boneIdx] = [q[0],q[1],q[2],q[3]]; }
            else if(action.blendMode===BlendMode.LERP){ const cur=mixer._poseRotations[boneIdx]; Q.slerp(mixer._tempQ, cur, q, action.weight); mixer._poseRotations[boneIdx]=[mixer._tempQ[0],mixer._tempQ[1],mixer._tempQ[2],mixer._tempQ[3]]; }
            else if(action.blendMode===BlendMode.ADDITIVE){ const cur=mixer._poseRotations[boneIdx]; Q.mult(mixer._tempQ, q, cur); mixer._poseRotations[boneIdx]=[mixer._tempQ[0],mixer._tempQ[1],mixer._tempQ[2],mixer._tempQ[3]]; }
          }
        } else if(track.type==='position'){
          const p = sampleTrack(track, action.time, mixer._tempPos);
          if(p){
            if(action.blendMode===BlendMode.OVERRIDE){ mixer._posePositions[boneIdx] = [p[0],p[1],p[2]]; }
            else if(action.blendMode===BlendMode.LERP){ const cur=mixer._posePositions[boneIdx]; mixer._posePositions[boneIdx]=[cur[0]+(p[0]-cur[0])*action.weight, cur[1]+(p[1]-cur[1])*action.weight, cur[2]+(p[2]-cur[2])*action.weight]; }
            else if(action.blendMode===BlendMode.ADDITIVE){ const cur=mixer._posePositions[boneIdx]; mixer._posePositions[boneIdx]=[cur[0]+p[0]*action.weight, cur[1]+p[1]*action.weight, cur[2]+p[2]*action.weight]; }
          }
        }
      }
    }
  }
  function getPose(){ return { rotations: mixer._poseRotations, positions: mixer._posePositions }; }
  function crossFade(fromClipName, toClipName, duration){
    const fromAction = mixer.activeActions.find(a=>a.clip.name===fromClipName);
    if(!fromAction) return play(toClipName);
    const toAction = play(toClipName, {weight:0});
    if(!toAction) return null;
    const startTime = mixer.time;
    const fadeAction = { update: function(dt){ const t=Math.min(1,(mixer.time-startTime)/duration); fromAction.weight=1-t; toAction.weight=t; if(t>=1){ stop(fromClipName); return true; } return false; } };
    mixer._fadeActions = mixer._fadeActions || [];
    mixer._fadeActions.push(fadeAction);
    return toAction;
  }
  console.log('[AnimationMixer] 创建完成 bones=' + boneCount);
  return { addClip, removeClip, play, stop, stopAll, update, getPose, crossFade, mixer };
}