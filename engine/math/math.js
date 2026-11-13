/**
 * Aevum 数学核心
 * 数学工具库：V3 / V2 / V4 / M3 / M4 / Q / Plane / Ray / AABB / Sphere / Collision
 * 纯计算模块，不依赖 DOM 或 WebGL。
 * @module engine/orb/math
 */
'use strict';

/* ===== 数学工具 ===== */
const V3 = {
  create: () => new Float32Array(3),
  set: (o,x,y,z) => { o[0]=x;o[1]=y;o[2]=z; return o; },
  copy: (o,a) => { o[0]=a[0];o[1]=a[1];o[2]=a[2]; return o; },
  add: (o,a,b) => { o[0]=a[0]+b[0];o[1]=a[1]+b[1];o[2]=a[2]+b[2]; return o; },
  sub: (o,a,b) => { o[0]=a[0]-b[0];o[1]=a[1]-b[1];o[2]=a[2]-b[2]; return o; },
  scale: (o,a,s) => { o[0]=a[0]*s;o[1]=a[1]*s;o[2]=a[2]*s; return o; },
  dot: (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
  cross: (o,a,b) => { o[0]=a[1]*b[2]-a[2]*b[1]; o[1]=a[2]*b[0]-a[0]*b[2]; o[2]=a[0]*b[1]-a[1]*b[0]; return o; },
  len: (a) => Math.sqrt(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]),
  norm: (o,a) => { const l=V3.len(a)||1; o[0]=a[0]/l;o[1]=a[1]/l;o[2]=a[2]/l; return o; },
  lerp: (o,a,b,t) => { o[0]=a[0]+(b[0]-a[0])*t; o[1]=a[1]+(b[1]-a[1])*t; o[2]=a[2]+(b[2]-a[2])*t; return o; },
  clamp: (o,a,min,max) => { o[0]=Math.max(min[0],Math.min(max[0],a[0])); o[1]=Math.max(min[1],Math.min(max[1],a[1])); o[2]=Math.max(min[2],Math.min(max[2],a[2])); return o; },
  min: (o,a,b) => { o[0]=Math.min(a[0],b[0]); o[1]=Math.min(a[1],b[1]); o[2]=Math.min(a[2],b[2]); return o; },
  max: (o,a,b) => { o[0]=Math.max(a[0],b[0]); o[1]=Math.max(a[1],b[1]); o[2]=Math.max(a[2],b[2]); return o; },
  dist: (a,b) => { const dx=a[0]-b[0],dy=a[1]-b[1],dz=a[2]-b[2]; return Math.sqrt(dx*dx+dy*dy+dz*dz); },
  distSq: (a,b) => { const dx=a[0]-b[0],dy=a[1]-b[1],dz=a[2]-b[2]; return dx*dx+dy*dy+dz*dz; },
  negate: (o,a) => { o[0]=-a[0];o[1]=-a[1];o[2]=-a[2]; return o; },
  reflect: (o,i,n) => { const d=2*(i[0]*n[0]+i[1]*n[1]+i[2]*n[2]); o[0]=i[0]-d*n[0];o[1]=i[1]-d*n[1];o[2]=i[2]-d*n[2]; return o; },
  refract: (o,i,n,eta) => { const d=i[0]*n[0]+i[1]*n[1]+i[2]*n[2]; const k=1-eta*eta*(1-d*d); if(k<0){o[0]=0;o[1]=0;o[2]=0;}else{const e=eta*eta+eta*eta*d; o[0]=eta*i[0]-e*n[0];o[1]=eta*i[1]-e*n[1];o[2]=eta*i[2]-e*n[2];} return o; },
  angle: (a,b) => { const d=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; const la=Math.sqrt(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]); const lb=Math.sqrt(b[0]*b[0]+b[1]*b[1]+b[2]*b[2]); return Math.acos(Math.max(-1,Math.min(1,d/(la*lb||1)))); },
  project: (o,a,b) => { const s=(a[0]*b[0]+a[1]*b[1]+a[2]*b[2])/(b[0]*b[0]+b[1]*b[1]+b[2]*b[2]||1); o[0]=b[0]*s;o[1]=b[1]*s;o[2]=b[2]*s; return o; },
  slerp: (o,a,b,t) => { const d=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; const la=V3.len(a),lb=V3.len(b); const c=Math.max(-1,Math.min(1,d/(la*lb||1))); const theta=Math.acos(c); if(theta<0.001){V3.lerp(o,a,b,t);}else{const s=Math.sin(theta); const w1=Math.sin((1-t)*theta)/s, w2=Math.sin(t*theta)/s; o[0]=a[0]*w1+b[0]*w2;o[1]=a[1]*w1+b[1]*w2;o[2]=a[2]*w1+b[2]*w2;} return o; },
  fromArray: (o,arr,off) => { o[0]=arr[off];o[1]=arr[off+1];o[2]=arr[off+2]; return o; },
  toArray: (a,arr,off) => { arr[off]=a[0];arr[off+1]=a[1];arr[off+2]=a[2]; return arr; },
  zero: (o) => { o[0]=0;o[1]=0;o[2]=0; return o; },
  one: (o) => { o[0]=1;o[1]=1;o[2]=1; return o; },
  up: (o) => { o[0]=0;o[1]=1;o[2]=0; return o; },
  forward: (o) => { o[0]=0;o[1]=0;o[2]=-1; return o; },
  right: (o) => { o[0]=1;o[1]=0;o[2]=0; return o; },
};

const V2 = {
  create: () => new Float32Array(2),
  set: (o,x,y) => { o[0]=x;o[1]=y; return o; },
  copy: (o,a) => { o[0]=a[0];o[1]=a[1]; return o; },
  add: (o,a,b) => { o[0]=a[0]+b[0];o[1]=a[1]+b[1]; return o; },
  sub: (o,a,b) => { o[0]=a[0]-b[0];o[1]=a[1]-b[1]; return o; },
  scale: (o,a,s) => { o[0]=a[0]*s;o[1]=a[1]*s; return o; },
  dot: (a,b) => a[0]*b[0]+a[1]*b[1],
  cross: (a,b) => a[0]*b[1]-a[1]*b[0],
  len: (a) => Math.sqrt(a[0]*a[0]+a[1]*a[1]),
  norm: (o,a) => { const l=V2.len(a)||1; o[0]=a[0]/l;o[1]=a[1]/l; return o; },
  lerp: (o,a,b,t) => { o[0]=a[0]+(b[0]-a[0])*t; o[1]=a[1]+(b[1]-a[1])*t; return o; },
  dist: (a,b) => { const dx=a[0]-b[0],dy=a[1]-b[1]; return Math.sqrt(dx*dx+dy*dy); },
  distSq: (a,b) => { const dx=a[0]-b[0],dy=a[1]-b[1]; return dx*dx+dy*dy; },
  negate: (o,a) => { o[0]=-a[0];o[1]=-a[1]; return o; },
  angle: (a,b) => { const d=a[0]*b[0]+a[1]*b[1]; const la=V2.len(a),lb=V2.len(b); return Math.acos(Math.max(-1,Math.min(1,d/(la*lb||1)))); },
  clamp: (o,a,min,max) => { o[0]=Math.max(min[0],Math.min(max[0],a[0])); o[1]=Math.max(min[1],Math.min(max[1],a[1])); return o; },
  min: (o,a,b) => { o[0]=Math.min(a[0],b[0]); o[1]=Math.min(a[1],b[1]); return o; },
  max: (o,a,b) => { o[0]=Math.max(a[0],b[0]); o[1]=Math.max(a[1],b[1]); return o; },
  reflect: (o,i,n) => { const d=2*(i[0]*n[0]+i[1]*n[1]); o[0]=i[0]-d*n[0];o[1]=i[1]-d*n[1]; return o; },
  project: (o,a,b) => { const s=(a[0]*b[0]+a[1]*b[1])/(b[0]*b[0]+b[1]*b[1]||1); o[0]=b[0]*s;o[1]=b[1]*s; return o; },
  rotate: (o,a,angle) => { const c=Math.cos(angle),s=Math.sin(angle); o[0]=a[0]*c-a[1]*s; o[1]=a[0]*s+a[1]*c; return o; },
  perpendicular: (o,a) => { o[0]=-a[1];o[1]=a[0]; return o; },
  zero: (o) => { o[0]=0;o[1]=0; return o; },
  one: (o) => { o[0]=1;o[1]=1; return o; },
  fromArray: (o,arr,off) => { o[0]=arr[off];o[1]=arr[off+1]; return o; },
  toArray: (a,arr,off) => { arr[off]=a[0];arr[off+1]=a[1]; return arr; },
};

const V4 = {
  create: () => new Float32Array(4),
  set: (o,x,y,z,w) => { o[0]=x;o[1]=y;o[2]=z;o[3]=w; return o; },
  copy: (o,a) => { o[0]=a[0];o[1]=a[1];o[2]=a[2];o[3]=a[3]; return o; },
  add: (o,a,b) => { o[0]=a[0]+b[0];o[1]=a[1]+b[1];o[2]=a[2]+b[2];o[3]=a[3]+b[3]; return o; },
  sub: (o,a,b) => { o[0]=a[0]-b[0];o[1]=a[1]-b[1];o[2]=a[2]-b[2];o[3]=a[3]-b[3]; return o; },
  scale: (o,a,s) => { o[0]=a[0]*s;o[1]=a[1]*s;o[2]=a[2]*s;o[3]=a[3]*s; return o; },
  dot: (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3],
  len: (a) => Math.sqrt(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]+a[3]*a[3]),
  norm: (o,a) => { const l=V4.len(a)||1; o[0]=a[0]/l;o[1]=a[1]/l;o[2]=a[2]/l;o[3]=a[3]/l; return o; },
  lerp: (o,a,b,t) => { o[0]=a[0]+(b[0]-a[0])*t; o[1]=a[1]+(b[1]-a[1])*t; o[2]=a[2]+(b[2]-a[2])*t; o[3]=a[3]+(b[3]-a[3])*t; return o; },
  negate: (o,a) => { o[0]=-a[0];o[1]=-a[1];o[2]=-a[2];o[3]=-a[3]; return o; },
  clamp: (o,a,min,max) => { o[0]=Math.max(min[0],Math.min(max[0],a[0])); o[1]=Math.max(min[1],Math.min(max[1],a[1])); o[2]=Math.max(min[2],Math.min(max[2],a[2])); o[3]=Math.max(min[3],Math.min(max[3],a[3])); return o; },
  min: (o,a,b) => { o[0]=Math.min(a[0],b[0]); o[1]=Math.min(a[1],b[1]); o[2]=Math.min(a[2],b[2]); o[3]=Math.min(a[3],b[3]); return o; },
  max: (o,a,b) => { o[0]=Math.max(a[0],b[0]); o[1]=Math.max(a[1],b[1]); o[2]=Math.max(a[2],b[2]); o[3]=Math.max(a[3],b[3]); return o; },
  dist: (a,b) => { const dx=a[0]-b[0],dy=a[1]-b[1],dz=a[2]-b[2],dw=a[3]-b[3]; return Math.sqrt(dx*dx+dy*dy+dz*dz+dw*dw); },
  distSq: (a,b) => { const dx=a[0]-b[0],dy=a[1]-b[1],dz=a[2]-b[2],dw=a[3]-b[3]; return dx*dx+dy*dy+dz*dz+dw*dw; },
  zero: (o) => { o[0]=0;o[1]=0;o[2]=0;o[3]=0; return o; },
  one: (o) => { o[0]=1;o[1]=1;o[2]=1;o[3]=1; return o; },
  fromArray: (o,arr,off) => { o[0]=arr[off];o[1]=arr[off+1];o[2]=arr[off+2];o[3]=arr[off+3]; return o; },
  toArray: (a,arr,off) => { arr[off]=a[0];arr[off+1]=a[1];arr[off+2]=a[2];arr[off+3]=a[3]; return arr; },
  fromV3: (o,v,w) => { o[0]=v[0];o[1]=v[1];o[2]=v[2];o[3]=w; return o; },
  toV3: (a,o) => { o[0]=a[0];o[1]=a[1];o[2]=a[2]; return o; },
};

const M3 = {
  create: () => new Float32Array(9),
  identity: (o) => { o[0]=1;o[1]=0;o[2]=0; o[3]=0;o[4]=1;o[5]=0; o[6]=0;o[7]=0;o[8]=1; return o; },
  copy: (o,a) => { o.set(a); return o; },
  mult: (o,a,b) => {
    const a00=a[0],a01=a[1],a02=a[2], a10=a[3],a11=a[4],a12=a[5], a20=a[6],a21=a[7],a22=a[8];
    const b00=b[0],b01=b[1],b02=b[2], b10=b[3],b11=b[4],b12=b[5], b20=b[6],b21=b[7],b22=b[8];
    o[0]=a00*b00+a01*b10+a02*b20; o[1]=a00*b01+a01*b11+a02*b21; o[2]=a00*b02+a01*b12+a02*b22;
    o[3]=a10*b00+a11*b10+a12*b20; o[4]=a10*b01+a11*b11+a12*b21; o[5]=a10*b02+a11*b12+a12*b22;
    o[6]=a20*b00+a21*b10+a22*b20; o[7]=a20*b01+a21*b11+a22*b21; o[8]=a20*b02+a21*b12+a22*b22;
    return o;
  },
  transpose: (o,a) => { o[0]=a[0];o[1]=a[3];o[2]=a[6]; o[3]=a[1];o[4]=a[4];o[5]=a[7]; o[6]=a[2];o[7]=a[5];o[8]=a[8]; return o; },
  invert: (o,a) => {
    const a00=a[0],a01=a[1],a02=a[2], a10=a[3],a11=a[4],a12=a[5], a20=a[6],a21=a[7],a22=a[8];
    const b01=a22*a11-a12*a21, b11=-a22*a10+a12*a20, b21=a21*a10-a11*a20;
    let det=a00*b01+a01*b11+a02*b21;
    if(!det){ M3.identity(o); return o; }
    det=1/det;
    o[0]=b01*det; o[1]=(-a22*a01+a02*a21)*det; o[2]=(a12*a01-a02*a11)*det;
    o[3]=b11*det; o[4]=(a22*a00-a02*a20)*det; o[5]=(-a12*a00+a02*a10)*det;
    o[6]=b21*det; o[7]=(-a21*a00+a01*a20)*det; o[8]=(a11*a00-a01*a10)*det;
    return o;
  },
  transformVec3: (o,m,v) => { o[0]=m[0]*v[0]+m[1]*v[1]+m[2]*v[2]; o[1]=m[3]*v[0]+m[4]*v[1]+m[5]*v[2]; o[2]=m[6]*v[0]+m[7]*v[1]+m[8]*v[2]; return o; },
  fromRotation: (o,angle) => { const c=Math.cos(angle),s=Math.sin(angle); o[0]=c;o[1]=-s;o[2]=0; o[3]=s;o[4]=c;o[5]=0; o[6]=0;o[7]=0;o[8]=1; return o; },
  fromScale: (o,sx,sy,sz) => { o[0]=sx;o[1]=0;o[2]=0; o[3]=0;o[4]=sy;o[5]=0; o[6]=0;o[7]=0;o[8]=sz; return o; },
  fromQuat: (o,q) => {
    const x=q[0],y=q[1],z=q[2],w=q[3];
    const x2=x+x,y2=y+y,z2=z+z, xx=x*x2,xy=x*y2,xz=x*z2, yy=y*y2,yz=y*z2,zz=z*z2, wx=w*x2,wy=w*y2,wz=w*z2;
    o[0]=1-(yy+zz); o[1]=xy+wz; o[2]=xz-wy;
    o[3]=xy-wz; o[4]=1-(xx+zz); o[5]=yz+wx;
    o[6]=xz+wy; o[7]=yz-wx; o[8]=1-(xx+yy);
    return o;
  },
  determinant: (a) => a[0]*(a[4]*a[8]-a[5]*a[7]) - a[1]*(a[3]*a[8]-a[5]*a[6]) + a[2]*(a[3]*a[7]-a[4]*a[6]),
  trace: (a) => a[0]+a[4]+a[8],
  zero: (o) => { o.fill(0); return o; },
  fromArray: (o,arr,off) => { for(let i=0;i<9;i++) o[i]=arr[off+i]; return o; },
  toArray: (a,arr,off) => { for(let i=0;i<9;i++) arr[off+i]=a[i]; return arr; },
};

const Q = {
  create: () => new Float32Array([0,0,0,1]),
  set: (o,x,y,z,w) => { o[0]=x;o[1]=y;o[2]=z;o[3]=w; return o; },
  copy: (o,a) => { o[0]=a[0];o[1]=a[1];o[2]=a[2];o[3]=a[3]; return o; },
  identity: (o) => { o[0]=0;o[1]=0;o[2]=0;o[3]=1; return o; },
  mult: (o,a,b) => {
    const ax=a[0],ay=a[1],az=a[2],aw=a[3], bx=b[0],by=b[1],bz=b[2],bw=b[3];
    o[0]=ax*bw+aw*bx+ay*bz-az*by;
    o[1]=ay*bw+aw*by+az*bx-ax*bz;
    o[2]=az*bw+aw*bz+ax*by-ay*bx;
    o[3]=aw*bw-ax*bx-ay*by-az*bz;
    return o;
  },
  fromAxisAngle: (o,axis,angle) => {
    const h=angle*0.5, s=Math.sin(h);
    o[0]=axis[0]*s; o[1]=axis[1]*s; o[2]=axis[2]*s; o[3]=Math.cos(h);
    return o;
  },
  fromEuler: (o,x,y,z) => {
    const cx=Math.cos(x*0.5),sx=Math.sin(x*0.5), cy=Math.cos(y*0.5),sy=Math.sin(y*0.5), cz=Math.cos(z*0.5),sz=Math.sin(z*0.5);
    o[0]=sx*cy*cz+cx*sy*sz; o[1]=cx*sy*cz-sx*cy*sz; o[2]=cx*cy*sz+sx*sy*cz; o[3]=cx*cy*cz-sx*sy*sz;
    return o;
  },
  toMat4: (o,q) => {
    const x=q[0],y=q[1],z=q[2],w=q[3];
    const x2=x+x,y2=y+y,z2=z+z, xx=x*x2,xy=x*y2,xz=x*z2, yy=y*y2,yz=y*z2,zz=z*z2, wx=w*x2,wy=w*y2,wz=w*z2;
    o[0]=1-(yy+zz); o[1]=xy+wz; o[2]=xz-wy; o[3]=0;
    o[4]=xy-wz; o[5]=1-(xx+zz); o[6]=yz+wx; o[7]=0;
    o[8]=xz+wy; o[9]=yz-wx; o[10]=1-(xx+yy); o[11]=0;
    o[12]=0; o[13]=0; o[14]=0; o[15]=1;
    return o;
  },
  slerp: (o,a,b,t) => {
    let cosHalf=Q.dot(a,b);
    const b1=Q.create();
    if(cosHalf<0){ cosHalf=-cosHalf; b1[0]=-b[0];b1[1]=-b[1];b1[2]=-b[2];b1[3]=-b[3]; } else Q.copy(b1,b);
    if(cosHalf>0.9995){ Q.lerp(o,a,b1,t); const l=Math.sqrt(o[0]*o[0]+o[1]*o[1]+o[2]*o[2]+o[3]*o[3])||1; o[0]/=l;o[1]/=l;o[2]/=l;o[3]/=l; return o; }
    const halfTheta=Math.acos(cosHalf), sinHalfTheta=Math.sin(halfTheta);
    const ratioA=Math.sin((1-t)*halfTheta)/sinHalfTheta, ratioB=Math.sin(t*halfTheta)/sinHalfTheta;
    o[0]=a[0]*ratioA+b1[0]*ratioB; o[1]=a[1]*ratioA+b1[1]*ratioB; o[2]=a[2]*ratioA+b1[2]*ratioB; o[3]=a[3]*ratioA+b1[3]*ratioB;
    return o;
  },
  dot: (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3],
  lerp: (o,a,b,t) => { o[0]=a[0]+(b[0]-a[0])*t; o[1]=a[1]+(b[1]-a[1])*t; o[2]=a[2]+(b[2]-a[2])*t; o[3]=a[3]+(b[3]-a[3])*t; return o; },
};

const M4 = {
  create: () => new Float32Array(16),
  identity: (o) => { o.fill(0); o[0]=o[5]=o[10]=o[15]=1; return o; },
  copy: (o,a) => { o.set(a); return o; },
  mult: (o,a,b) => {
    const a00=a[0],a01=a[1],a02=a[2],a03=a[3], a10=a[4],a11=a[5],a12=a[6],a13=a[7], a20=a[8],a21=a[9],a22=a[10],a23=a[11], a30=a[12],a31=a[13],a32=a[14],a33=a[15];
    const b00=b[0],b01=b[1],b02=b[2],b03=b[3], b10=b[4],b11=b[5],b12=b[6],b13=b[7], b20=b[8],b21=b[9],b22=b[10],b23=b[11], b30=b[12],b31=b[13],b32=b[14],b33=b[15];
    o[0]=a00*b00+a01*b10+a02*b20+a03*b30; o[1]=a00*b01+a01*b11+a02*b21+a03*b31; o[2]=a00*b02+a01*b12+a02*b22+a03*b32; o[3]=a00*b03+a01*b13+a02*b23+a03*b33;
    o[4]=a10*b00+a11*b10+a12*b20+a13*b30; o[5]=a10*b01+a11*b11+a12*b21+a13*b31; o[6]=a10*b02+a11*b12+a12*b22+a13*b32; o[7]=a10*b03+a11*b13+a12*b23+a13*b33;
    o[8]=a20*b00+a21*b10+a22*b20+a23*b30; o[9]=a20*b01+a21*b11+a22*b21+a23*b31; o[10]=a20*b02+a21*b12+a22*b22+a23*b32; o[11]=a20*b03+a21*b13+a22*b23+a23*b33;
    o[12]=a30*b00+a31*b10+a32*b20+a33*b30; o[13]=a30*b01+a31*b11+a32*b21+a33*b31; o[14]=a30*b02+a31*b12+a32*b22+a33*b32; o[15]=a30*b03+a31*b13+a32*b23+a33*b33;
    return o;
  },
  fromTRS: (o,pos,rot,scale) => {
    Q.toMat4(o,rot);
    if(scale){ o[0]*=scale[0];o[1]*=scale[0];o[2]*=scale[0]; o[4]*=scale[1];o[5]*=scale[1];o[6]*=scale[1]; o[8]*=scale[2];o[9]*=scale[2];o[10]*=scale[2]; }
    o[12]=pos[0]; o[13]=pos[1]; o[14]=pos[2];
    return o;
  },
  perspective: (o,fovy,aspect,near,far) => {
    const f=1/Math.tan(fovy/2), nf=1/(near-far);
    o.fill(0);
    o[0]=f/aspect; o[5]=f; o[10]=(far+near)*nf; o[11]=-1; o[14]=2*far*near*nf;
    return o;
  },
  lookAt: (o,eye,target,up) => {
    const z=V3.create(); V3.sub(z,eye,target); V3.norm(z,z);
    const x=V3.create(); V3.cross(x,up,z); V3.norm(x,x);
    const y=V3.create(); V3.cross(y,z,x);
    o[0]=x[0];o[1]=y[0];o[2]=z[0];o[3]=0;
    o[4]=x[1];o[5]=y[1];o[6]=z[1];o[7]=0;
    o[8]=x[2];o[9]=y[2];o[10]=z[2];o[11]=0;
    o[12]=-V3.dot(x,eye); o[13]=-V3.dot(y,eye); o[14]=-V3.dot(z,eye); o[15]=1;
    return o;
  },
  invert: (o,a) => {
    const a00=a[0],a01=a[1],a02=a[2],a03=a[3], a10=a[4],a11=a[5],a12=a[6],a13=a[7], a20=a[8],a21=a[9],a22=a[10],a23=a[11], a30=a[12],a31=a[13],a32=a[14],a33=a[15];
    const b00=a00*a11-a01*a10, b01=a00*a12-a02*a10, b02=a00*a13-a03*a10, b03=a01*a12-a02*a11, b04=a01*a13-a03*a11, b05=a02*a13-a03*a12;
    const b06=a20*a31-a21*a30, b07=a20*a32-a22*a30, b08=a20*a33-a23*a30, b09=a21*a32-a22*a31, b10=a21*a33-a23*a31, b11=a22*a33-a23*a32;
    let det=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
    if(!det) return M4.identity(o);
    det=1/det;
    o[0]=(a11*b11-a12*b10+a13*b09)*det; o[1]=(a02*b10-a01*b11-a03*b09)*det; o[2]=(a31*b05-a32*b04+a33*b03)*det; o[3]=(a22*b04-a21*b05-a23*b03)*det;
    o[4]=(a12*b08-a10*b11-a13*b07)*det; o[5]=(a00*b11-a02*b08+a03*b07)*det; o[6]=(a32*b02-a30*b05-a33*b01)*det; o[7]=(a20*b05-a22*b02+a23*b01)*det;
    o[8]=(a10*b10-a11*b08+a13*b06)*det; o[9]=(a01*b08-a00*b10-a03*b06)*det; o[10]=(a30*b04-a31*b02+a33*b00)*det; o[11]=(a21*b02-a20*b04-a23*b00)*det;
    o[12]=(a11*b07-a10*b09-a12*b06)*det; o[13]=(a00*b09-a01*b07+a02*b06)*det; o[14]=(a31*b01-a30*b03-a32*b00)*det; o[15]=(a20*b03-a21*b01+a22*b00)*det;
    return o;
  },
};

/* ===== 平面几何 ===== */
const Plane = {
  create: () => new Float32Array(4),
  set: (o,a,b,c,d) => { o[0]=a;o[1]=b;o[2]=c;o[3]=d; return o; },
  fromNormalPoint: (o,normal,point) => { const d=-(normal[0]*point[0]+normal[1]*point[1]+normal[2]*point[2]); o[0]=normal[0];o[1]=normal[1];o[2]=normal[2];o[3]=d; return o; },
  fromPoints: (o,a,b,c) => {
    const v1x=b[0]-a[0],v1y=b[1]-a[1],v1z=b[2]-a[2];
    const v2x=c[0]-a[0],v2y=c[1]-a[1],v2z=c[2]-a[2];
    const nx=v1y*v2z-v1z*v2y, ny=v1z*v2x-v1x*v2z, nz=v1x*v2y-v1y*v2x;
    const len=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
    o[0]=nx/len;o[1]=ny/len;o[2]=nz/len;o[3]=-(o[0]*a[0]+o[1]*a[1]+o[2]*a[2]); return o;
  },
  normalize: (o,p) => { const len=Math.sqrt(p[0]*p[0]+p[1]*p[1]+p[2]*p[2])||1; o[0]=p[0]/len;o[1]=p[1]/len;o[2]=p[2]/len;o[3]=p[3]/len; return o; },
  dot: (p,v) => p[0]*v[0]+p[1]*v[1]+p[2]*v[2]+p[3],
  dotCoord: (p,x,y,z) => p[0]*x+p[1]*y+p[2]*z+p[3],
  distance: (p,point) => p[0]*point[0]+p[1]*point[1]+p[2]*point[2]+p[3],
  flip: (o,p) => { o[0]=-p[0];o[1]=-p[1];o[2]=-p[2];o[3]=-p[3]; return o; },
  projectPoint: (o,plane,point) => { const d=Plane.distance(plane,point); o[0]=point[0]-plane[0]*d;o[1]=point[1]-plane[1]*d;o[2]=point[2]-plane[2]*d; return o; },
  intersectRay: (plane,rayOrigin,rayDir) => { const denom=plane[0]*rayDir[0]+plane[1]*rayDir[1]+plane[2]*rayDir[2]; if(Math.abs(denom)<1e-8) return -1; const t=-(plane[0]*rayOrigin[0]+plane[1]*rayOrigin[1]+plane[2]*rayOrigin[2]+plane[3])/denom; return t>=0?t:-1; },
  copy: (o,a) => { o[0]=a[0];o[1]=a[1];o[2]=a[2];o[3]=a[3]; return o; },
};

/* ===== 射线几何 ===== */
const Ray = {
  create: () => ({ origin: new Float32Array(3), dir: new Float32Array([0,0,-1]) }),
  set: (o,origin,dir) => { o.origin[0]=origin[0];o.origin[1]=origin[1];o.origin[2]=origin[2]; const l=Math.sqrt(dir[0]*dir[0]+dir[1]*dir[1]+dir[2]*dir[2])||1; o.dir[0]=dir[0]/l;o.dir[1]=dir[1]/l;o.dir[2]=dir[2]/l; return o; },
  pointAt: (o,ray,t) => { o[0]=ray.origin[0]+ray.dir[0]*t;o[1]=ray.origin[1]+ray.dir[1]*t;o[2]=ray.origin[2]+ray.dir[2]*t; return o; },
  intersectSphere: (ray,center,radius) => {
    const ox=ray.origin[0]-center[0],oy=ray.origin[1]-center[1],oz=ray.origin[2]-center[2];
    const dx=ray.dir[0],dy=ray.dir[1],dz=ray.dir[2];
    const b=ox*dx+oy*dy+oz*dz, c=ox*ox+oy*oy+oz*oz-radius*radius;
    const disc=b*b-c; if(disc<0) return -1; const t=-b-Math.sqrt(disc); return t>=0?t:-1;
  },
  intersectAABB: (ray,min,max) => {
    let tmin=0,tmax=Infinity;
    for(let i=0;i<3;i++){
      if(Math.abs(ray.dir[i])<1e-8){ if(ray.origin[i]<min[i]||ray.origin[i]>max[i]) return -1; }
      else {
        const inv=1/ray.dir[i]; let t1=(min[i]-ray.origin[i])*inv, t2=(max[i]-ray.origin[i])*inv;
        if(t1>t2){let tmp=t1;t1=t2;t2=tmp;}
        tmin=Math.max(tmin,t1); tmax=Math.min(tmax,t2);
        if(tmin>tmax) return -1;
      }
    }
    return tmin;
  },
  intersectPlane: (ray,plane) => Plane.intersectRay(plane,ray.origin,ray.dir),
  intersectTriangle: (ray,v0,v1,v2) => {
    const e1x=v1[0]-v0[0],e1y=v1[1]-v0[1],e1z=v1[2]-v0[2];
    const e2x=v2[0]-v0[0],e2y=v2[1]-v0[1],e2z=v2[2]-v0[2];
    const px=ray.dir[1]*e2z-ray.dir[2]*e2y, py=ray.dir[2]*e2x-ray.dir[0]*e2z, pz=ray.dir[0]*e2y-ray.dir[1]*e2x;
    const det=e1x*px+e1y*py+e1z*pz; if(Math.abs(det)<1e-8) return -1;
    const inv=1/det, tx=ray.origin[0]-v0[0],ty=ray.origin[1]-v0[1],tz=ray.origin[2]-v0[2];
    const u=(tx*px+ty*py+tz*pz)*inv; if(u<0||u>1) return -1;
    const qx=ty*e1z-tz*e1y, qy=tz*e1x-tx*e1z, qz=tx*e1y-ty*e1x;
    const v=(ray.dir[0]*qx+ray.dir[1]*qy+ray.dir[2]*qz)*inv; if(v<0||u+v>1) return -1;
    const t=(e2x*qx+e2y*qy+e2z*qz)*inv; return t>=0?t:-1;
  },
  closestPoint: (o,ray,point) => {
    const dx=point[0]-ray.origin[0],dy=point[1]-ray.origin[1],dz=point[2]-ray.origin[2];
    const t=dx*ray.dir[0]+dy*ray.dir[1]+dz*ray.dir[2];
    o[0]=ray.origin[0]+ray.dir[0]*Math.max(0,t);o[1]=ray.origin[1]+ray.dir[1]*Math.max(0,t);o[2]=ray.origin[2]+ray.dir[2]*Math.max(0,t); return o;
  },
  distanceToPoint: (ray,point) => {
    const dx=point[0]-ray.origin[0],dy=point[1]-ray.origin[1],dz=point[2]-ray.origin[2];
    const t=Math.max(0,dx*ray.dir[0]+dy*ray.dir[1]+dz*ray.dir[2]);
    const cx=ray.origin[0]+ray.dir[0]*t-ray.origin[0],cy=ray.origin[1]+ray.dir[1]*t-ray.origin[1],cz=ray.origin[2]+ray.dir[2]*t-ray.origin[2];
    return Math.sqrt((point[0]-ray.origin[0]-cx)*(point[0]-ray.origin[0]-cx)+(point[1]-ray.origin[1]-cy)*(point[1]-ray.origin[1]-cy)+(point[2]-ray.origin[2]-cz)*(point[2]-ray.origin[2]-cz));
  },
};

/* ===== AABB 轴对齐包围盒 ===== */
const AABB = {
  create: () => ({ min: new Float32Array([Infinity,Infinity,Infinity]), max: new Float32Array([-Infinity,-Infinity,-Infinity]) }),
  set: (o,min,max) => { o.min[0]=min[0];o.min[1]=min[1];o.min[2]=min[2]; o.max[0]=max[0];o.max[1]=max[1];o.max[2]=max[2]; return o; },
  fromPoints: (o,points) => { AABB.reset(o); for(let i=0;i<points.length;i++) AABB.expand(o,points[i]); return o; },
  fromCenterSize: (o,center,size) => { const hx=size[0]*0.5,hy=size[1]*0.5,hz=size[2]*0.5; o.min[0]=center[0]-hx;o.min[1]=center[1]-hy;o.min[2]=center[2]-hz; o.max[0]=center[0]+hx;o.max[1]=center[1]+hy;o.max[2]=center[2]+hz; return o; },
  reset: (o) => { o.min[0]=o.min[1]=o.min[2]=Infinity; o.max[0]=o.max[1]=o.max[2]=-Infinity; return o; },
  expand: (o,point) => { o.min[0]=Math.min(o.min[0],point[0]);o.min[1]=Math.min(o.min[1],point[1]);o.min[2]=Math.min(o.min[2],point[2]); o.max[0]=Math.max(o.max[0],point[0]);o.max[1]=Math.max(o.max[1],point[1]);o.max[2]=Math.max(o.max[2],point[2]); return o; },
  expandAABB: (o,other) => { o.min[0]=Math.min(o.min[0],other.min[0]);o.min[1]=Math.min(o.min[1],other.min[1]);o.min[2]=Math.min(o.min[2],other.min[2]); o.max[0]=Math.max(o.max[0],other.max[0]);o.max[1]=Math.max(o.max[1],other.max[1]);o.max[2]=Math.max(o.max[2],other.max[2]); return o; },
  center: (o,aabb) => { o[0]=(aabb.min[0]+aabb.max[0])*0.5;o[1]=(aabb.min[1]+aabb.max[1])*0.5;o[2]=(aabb.min[2]+aabb.max[2])*0.5; return o; },
  size: (o,aabb) => { o[0]=aabb.max[0]-aabb.min[0];o[1]=aabb.max[1]-aabb.min[1];o[2]=aabb.max[2]-aabb.min[2]; return o; },
  halfSize: (o,aabb) => { o[0]=(aabb.max[0]-aabb.min[0])*0.5;o[1]=(aabb.max[1]-aabb.min[1])*0.5;o[2]=(aabb.max[2]-aabb.min[2])*0.5; return o; },
  containsPoint: (aabb,point) => point[0]>=aabb.min[0]&&point[0]<=aabb.max[0]&&point[1]>=aabb.min[1]&&point[1]<=aabb.max[1]&&point[2]>=aabb.min[2]&&point[2]<=aabb.max[2],
  intersects: (a,b) => a.min[0]<=b.max[0]&&a.max[0]>=b.min[0]&&a.min[1]<=b.max[1]&&a.max[1]>=b.min[1]&&a.min[2]<=b.max[2]&&a.max[2]>=b.min[2],
  intersection: (o,a,b) => { o.min[0]=Math.max(a.min[0],b.min[0]);o.min[1]=Math.max(a.min[1],b.min[1]);o.min[2]=Math.max(a.min[2],b.min[2]); o.max[0]=Math.min(a.max[0],b.max[0]);o.max[1]=Math.min(a.max[1],b.max[1]);o.max[2]=Math.min(a.max[2],b.max[2]); return o; },
  union: (o,a,b) => { o.min[0]=Math.min(a.min[0],b.min[0]);o.min[1]=Math.min(a.min[1],b.min[1]);o.min[2]=Math.min(a.min[2],b.min[2]); o.max[0]=Math.max(a.max[0],b.max[0]);o.max[1]=Math.max(a.max[1],b.max[1]);o.max[2]=Math.max(a.max[2],b.max[2]); return o; },
  volume: (aabb) => (aabb.max[0]-aabb.min[0])*(aabb.max[1]-aabb.min[1])*(aabb.max[2]-aabb.min[2]),
  surfaceArea: (aabb) => { const w=aabb.max[0]-aabb.min[0],h=aabb.max[1]-aabb.min[1],d=aabb.max[2]-aabb.min[2]; return 2*(w*h+w*d+h*d); },
  longestAxis: (aabb) => { const w=aabb.max[0]-aabb.min[0],h=aabb.max[1]-aabb.min[1],d=aabb.max[2]-aabb.min[2]; if(w>=h&&w>=d)return 0; if(h>=d)return 1; return 2; },
  translate: (o,aabb,offset) => { o.min[0]=aabb.min[0]+offset[0];o.min[1]=aabb.min[1]+offset[1];o.min[2]=aabb.min[2]+offset[2]; o.max[0]=aabb.max[0]+offset[0];o.max[1]=aabb.max[1]+offset[1];o.max[2]=aabb.max[2]+offset[2]; return o; },
  scale: (o,aabb,s) => { const c=AABB.create(); AABB.center(c,aabb); const h=AABB.create(); AABB.halfSize(h,aabb); o.min[0]=c[0]-h[0]*s;o.min[1]=c[1]-h[1]*s;o.min[2]=c[2]-h[2]*s; o.max[0]=c[0]+h[0]*s;o.max[1]=c[1]+h[1]*s;o.max[2]=c[2]+h[2]*s; return o; },
  isValid: (aabb) => aabb.min[0]<=aabb.max[0]&&aabb.min[1]<=aabb.max[1]&&aabb.min[2]<=aabb.max[2],
  copy: (o,a) => { o.min[0]=a.min[0];o.min[1]=a.min[1];o.min[2]=a.min[2]; o.max[0]=a.max[0];o.max[1]=a.max[1];o.max[2]=a.max[2]; return o; },
  clone: (a) => { const o=AABB.create(); AABB.copy(o,a); return o; },
  corners: (aabb,out) => {
    if(!out) out=new Array(8);
    for(let i=0;i<8;i++){
      out[i]=[
        i&1?aabb.max[0]:aabb.min[0],
        i&2?aabb.max[1]:aabb.min[1],
        i&4?aabb.max[2]:aabb.min[2]
      ];
    }
    return out;
  },
};

/* ===== 球体几何 ===== */
const Sphere = {
  create: () => ({ center: new Float32Array(3), radius: 1 }),
  set: (o,center,radius) => { o.center[0]=center[0];o.center[1]=center[1];o.center[2]=center[2]; o.radius=radius; return o; },
  fromPoints: (o,points) => {
    const c=V3.create(); for(let i=0;i<points.length;i++){c[0]+=points[i][0];c[1]+=points[i][1];c[2]+=points[i][2];}
    c[0]/=points.length;c[1]/=points.length;c[2]/=points.length;
    let r=0; for(let i=0;i<points.length;i++){const d=V3.dist(c,points[i]);if(d>r)r=d;}
    o.center[0]=c[0];o.center[1]=c[1];o.center[2]=c[2];o.radius=r; return o;
  },
  fromAABB: (o,aabb) => { const c=V3.create();AABB.center(c,aabb); const h=V3.create();AABB.halfSize(h,aabb); o.center[0]=c[0];o.center[1]=c[1];o.center[2]=c[2]; o.radius=V3.len(h); return o; },
  containsPoint: (sphere,point) => V3.distSq(sphere.center,point)<=sphere.radius*sphere.radius,
  intersects: (a,b) => V3.distSq(a.center,b.center)<=(a.radius+b.radius)*(a.radius+b.radius),
  intersectsAABB: (sphere,aabb) => {
    let dx=Math.max(aabb.min[0]-sphere.center[0],0,sphere.center[0]-aabb.max[0]);
    let dy=Math.max(aabb.min[1]-sphere.center[1],0,sphere.center[1]-aabb.max[1]);
    let dz=Math.max(aabb.min[2]-sphere.center[2],0,sphere.center[2]-aabb.max[2]);
    return dx*dx+dy*dy+dz*dz<=sphere.radius*sphere.radius;
  },
  intersectsPlane: (sphere,plane) => Math.abs(Plane.distance(plane,sphere.center))<=sphere.radius,
  merge: (o,a,b) => {
    const d=V3.create();V3.sub(d,b.center,a.center); const dist=V3.len(d);
    if(a.radius>=dist+b.radius){Sphere.copy(o,a);return o;}
    if(b.radius>=dist+a.radius){Sphere.copy(o,b);return o;}
    const dir=V3.create();V3.norm(dir,d);
    const r=(dist+a.radius+b.radius)*0.5;
    o.center[0]=a.center[0]+dir[0]*(r-a.radius);
    o.center[1]=a.center[1]+dir[1]*(r-a.radius);
    o.center[2]=a.center[2]+dir[2]*(r-a.radius);
    o.radius=r; return o;
  },
  volume: (sphere) => (4/3)*Math.PI*sphere.radius*sphere.radius*sphere.radius,
  surfaceArea: (sphere) => 4*Math.PI*sphere.radius*sphere.radius,
  translate: (o,sphere,offset) => { o.center[0]=sphere.center[0]+offset[0];o.center[1]=sphere.center[1]+offset[1];o.center[2]=sphere.center[2]+offset[2]; o.radius=sphere.radius; return o; },
  scale: (o,sphere,s) => { o.center[0]=sphere.center[0];o.center[1]=sphere.center[1];o.center[2]=sphere.center[2]; o.radius=sphere.radius*s; return o; },
  copy: (o,a) => { o.center[0]=a.center[0];o.center[1]=a.center[1];o.center[2]=a.center[2]; o.radius=a.radius; return o; },
  clone: (a) => { const o=Sphere.create();Sphere.copy(o,a);return o; },
};

/* ===== 碰撞检测 ===== */
const Collision = {
  pointInTriangle: (p,a,b,c) => {
    const v0x=b[0]-a[0],v0y=b[1]-a[1],v0z=b[2]-a[2];
    const v1x=c[0]-a[0],v1y=c[1]-a[1],v1z=c[2]-a[2];
    const v2x=p[0]-a[0],v2y=p[1]-a[1],v2z=p[2]-a[2];
    const d00=v0x*v0x+v0y*v0y+v0z*v0z, d01=v0x*v1x+v0y*v1y+v0z*v1z, d02=v0x*v2x+v0y*v2y+v0z*v2z;
    const d11=v1x*v1x+v1y*v1y+v1z*v1z, d12=v1x*v2x+v1y*v2y+v1z*v2z;
    const denom=d00*d11-d01*d01; if(Math.abs(denom)<1e-8) return false;
    const inv=1/denom, u=(d11*d02-d01*d12)*inv, v=(d00*d12-d01*d02)*inv;
    return u>=0&&v>=0&&u+v<=1;
  },
  closestPointOnTriangle: (o,p,a,b,c) => {
    const abx=b[0]-a[0],aby=b[1]-a[1],abz=b[2]-a[2];
    const acx=c[0]-a[0],acy=c[1]-a[1],acz=c[2]-a[2];
    const apx=p[0]-a[0],apy=p[1]-a[1],apz=p[2]-a[2];
    const d1=abx*apx+aby*apy+abz*apz, d2=acx*apx+acy*apy+acz*apz;
    if(d1<=0&&d2<=0){o[0]=a[0];o[1]=a[1];o[2]=a[2];return o;}
    const bpx=p[0]-b[0],bpy=p[1]-b[1],bpz=p[2]-b[2];
    const d3=abx*bpx+aby*bpy+abz*bpz, d4=acx*bpx+acy*bpy+acz*bpz;
    if(d3>=0&&d4<=d3){o[0]=b[0];o[1]=b[1];o[2]=b[2];return o;}
    const vc=d1*d4-d3*d2;
    if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3);o[0]=a[0]+abx*v;o[1]=a[1]+aby*v;o[2]=a[2]+abz*v;return o;}
    const cpx=p[0]-c[0],cpy=p[1]-c[1],cpz=p[2]-c[2];
    const d5=abx*cpx+aby*cpy+abz*cpz, d6=acx*cpx+acy*cpy+acz*cpz;
    if(d6>=0&&d5<=d6){o[0]=c[0];o[1]=c[1];o[2]=c[2];return o;}
    const vb=d5*d2-d1*d6;
    if(vb<=0&&d2>=0&&d6<=0){const w=d2/(d2-d6);o[0]=a[0]+acx*w;o[1]=a[1]+acy*w;o[2]=a[2]+acz*w;return o;}
    const va=d3*d6-d5*d4;
    if(va<=0&&(d4-d3)>=0&&(d5-d6)>=0){const w=(d4-d3)/((d4-d3)+(d5-d6));o[0]=b[0]+(c[0]-b[0])*w;o[1]=b[1]+(c[1]-b[1])*w;o[2]=b[2]+(c[2]-b[2])*w;return o;}
    const denom=1/(va+vb+vc);
    const u=vb*denom,v=vc*denom;
    o[0]=a[0]+abx*u+acx*v;o[1]=a[1]+aby*u+acy*v;o[2]=a[2]+abz*u+acz*v;return o;
  },
  pointTriangleDistance: (p,a,b,c) => { const cp=V3.create();Collision.closestPointOnTriangle(cp,p,a,b,c); return V3.dist(p,cp); },
  segmentIntersectsSphere: (p0,p1,center,radius) => {
    const dx=p1[0]-p0[0],dy=p1[1]-p0[1],dz=p1[2]-p0[2];
    const fx=p0[0]-center[0],fy=p0[1]-center[1],fz=p0[2]-center[2];
    const a=dx*dx+dy*dy+dz*dz, b=2*(fx*dx+fy*dy+fz*dz), c=fx*fx+fy*fy+fz*fz-radius*radius;
    let disc=b*b-4*a*c; if(disc<0) return false; disc=Math.sqrt(disc);
    const t1=(-b-disc)/(2*a), t2=(-b+disc)/(2*a);
    return (t1>=0&&t1<=1)||(t2>=0&&t2<=1)||(t1<0&&t2>1);
  },
  segmentIntersectsAABB: (p0,p1,min,max) => {
    let tmin=0,tmax=1;
    for(let i=0;i<3;i++){
      const d=p1[i]-p0[i];
      if(Math.abs(d)<1e-8){ if(p0[i]<min[i]||p0[i]>max[i]) return false; }
      else {
        const inv=1/d; let t1=(min[i]-p0[i])*inv, t2=(max[i]-p0[i])*inv;
        if(t1>t2){let tmp=t1;t1=t2;t2=tmp;}
        tmin=Math.max(tmin,t1); tmax=Math.min(tmax,t2);
        if(tmin>tmax) return false;
      }
    }
    return true;
  },
  segmentIntersectsTriangle: (p0,p1,v0,v1,v2) => {
    const e1x=v1[0]-v0[0],e1y=v1[1]-v0[1],e1z=v1[2]-v0[2];
    const e2x=v2[0]-v0[0],e2y=v2[1]-v0[1],e2z=v2[2]-v0[2];
    const dx=p1[0]-p0[0],dy=p1[1]-p0[1],dz=p1[2]-p0[2];
    const px=dy*e2z-dz*e2y, py=dz*e2x-dx*e2z, pz=dx*e2y-dy*e2x;
    const det=e1x*px+e1y*py+e1z*pz; if(Math.abs(det)<1e-8) return -1;
    const inv=1/det, tx=p0[0]-v0[0],ty=p0[1]-v0[1],tz=p0[2]-v0[2];
    const u=(tx*px+ty*py+tz*pz)*inv; if(u<0||u>1) return -1;
    const qx=ty*e1z-tz*e1y, qy=tz*e1x-tx*e1z, qz=tx*e1y-ty*e1x;
    const v=(dx*qx+dy*qy+dz*qz)*inv; if(v<0||u+v>1) return -1;
    const t=(e2x*qx+e2y*qy+e2z*qz)*inv; return (t>=0&&t<=1)?t:-1;
  },
  sphereSphereSweep: (pos0,pos1,r0,r1) => {
    const dx=pos1[0]-pos0[0],dy=pos1[1]-pos0[1],dz=pos1[2]-pos0[2];
    const r=r0+r1, a=dx*dx+dy*dy+dz*dz;
    if(a<=r*r) return 0;
    const b=-2*a, c=a-r*r, disc=b*b-4*a*c;
    if(disc<0) return -1;
    return (-b-Math.sqrt(disc))/(2*a);
  },
  aabbAABBSweep: (min0,max0,min1,max1,vel) => {
    let tmin=0,tmax=1;
    for(let i=0;i<3;i++){
      if(Math.abs(vel[i])<1e-8){ if(min0[i]>max1[i]||max0[i]<min1[i]) return -1; }
      else {
        const inv=1/vel[i];
        let t1=(min1[i]-max0[i])*inv, t2=(max1[i]-min0[i])*inv;
        if(t1>t2){let tmp=t1;t1=t2;t2=tmp;}
        tmin=Math.max(tmin,t1); tmax=Math.min(tmax,t2);
        if(tmin>tmax) return -1;
      }
    }
    return tmin;
  },
  separatingAxisTest: (axes,min0,max0,min1,max1) => {
    for(let i=0;i<axes.length;i++){
      const ax=axes[i];
      let p0min=Infinity,p0max=-Infinity,p1min=Infinity,p1max=-Infinity;
      for(let j=0;j<8;j++){
        const v0=[j&1?max0[0]:min0[0],j&2?max0[1]:min0[1],j&4?max0[2]:min0[2]];
        const v1=[j&1?max1[0]:min1[0],j&2?max1[1]:min1[1],j&4?max1[2]:min1[2]];
        const d0=v0[0]*ax[0]+v0[1]*ax[1]+v0[2]*ax[2];
        const d1=v1[0]*ax[0]+v1[1]*ax[1]+v1[2]*ax[2];
        p0min=Math.min(p0min,d0);p0max=Math.max(p0max,d0);
        p1min=Math.min(p1min,d1);p1max=Math.max(p1max,d1);
      }
      if(p0max<p1min||p1max<p0min) return false;
    }
    return true;
  },
};


/* ===== Aevum 统一导出 ===== */
(function (root) {
  var api = {
    V2: V2,
    V3: V3,
    V4: V4,
    M3: M3,
    M4: M4,
    Q: Q,
    Plane: Plane,
    Ray: Ray,
    AABB: AABB,
    Sphere: Sphere,
    Collision: Collision
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.AEVUM = root.AEVUM || {};
    root.AEVUM.math = Object.assign(root.AEVUM.math || {}, api);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);