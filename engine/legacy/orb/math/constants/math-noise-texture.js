
/* ===== 数学工具扩展（噪声、曲线、插值） ===== */
const MathUtil = {
  clamp: (v,min,max)=>Math.max(min,Math.min(max,v)),
  lerp: (a,b,t)=>a+(b-a)*t,
  inverseLerp: (a,b,v)=>(v-a)/(b-a||1),
  remap: (v,a,b,c,d)=>MathUtil.lerp(c,d,MathUtil.inverseLerp(a,b,v)),
  smoothstep: (a,b,x)=>{ const t=MathUtil.clamp((x-a)/(b-a||1),0,1); return t*t*(3-2*t); },
  smootherstep: (a,b,x)=>{ const t=MathUtil.clamp((x-a)/(b-a||1),0,1); return t*t*t*(t*(t*6-15)+10); },
  pingpong: (t,length)=>{ length=length||1; const m=t%(length*2); return m<length?m:length*2-m; },
  deltaAngle: (a,b)=>{ let d=(b-a)%(Math.PI*2); if(d>Math.PI) d-=Math.PI*2; if(d<-Math.PI) d+=Math.PI*2; return d; },
  lerpAngle: (a,b,t)=>a+MathUtil.deltaAngle(a,b)*t,
  moveTowards: (current,target,maxDelta)=>{ if(Math.abs(target-current)<=maxDelta) return target; return current+Math.sign(target-current)*maxDelta; },
  moveTowardsAngle: (current,target,maxDelta)=>{ const d=MathUtil.deltaAngle(current,target); if(Math.abs(d)<=maxDelta) return target; return current+Math.sign(d)*maxDelta; },
  damp: (current,target,lambda,dt)=>MathUtil.lerp(current,target,1-Math.exp(-lambda*dt)),
  dampAngle: (current,target,lambda,dt)=>MathUtil.lerpAngle(current,target,1-Math.exp(-lambda*dt)),
  approach: (current,target,rate)=>current+(target-current)*rate,
  sign: (v)=>v>0?1:v<0?-1:0,
  fract: (v)=>v-Math.floor(v),
  mod: (a,b)=>((a%b)+b)%b,
  wrap: (v,min,max)=>min+MathUtil.mod(v-min,max-min),
  shortestRotation: (a,b)=>{ let d=(b-a)%(Math.PI*2); if(d>Math.PI)d-=Math.PI*2; if(d<-Math.PI)d+=Math.PI*2; return d; },
  bezier: (p0,p1,p2,p3,t)=>{ const u=1-t, tt=t*t, uu=u*u, uuu=uu*u, ttt=tt*t; return uuu*p0+3*uu*t*p1+3*u*tt*p2+ttt*p3; },
  bezierDerivative: (p0,p1,p2,p3,t)=>{ const u=1-t; return 3*u*u*(p1-p0)+6*u*t*(p2-p1)+3*t*t*(p3-p2); },
  quadraticBezier: (p0,p1,p2,t)=>{ const u=1-t; return u*u*p0+2*u*t*p1+t*t*p2; },
  catmullRom: (p0,p1,p2,p3,t)=>{ const t2=t*t,t3=t2*t; return 0.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t2+(-p0+3*p1-3*p2+p3)*t3); },
  hermite: (p0,t0,p1,t1,t)=>{ const t2=t*t,t3=t2*t; return (2*t3-3*t2+1)*p0+(t3-2*t2+t)*t0+(-2*t3+3*t2)*p1+(t3-t2)*t1; },
  easeInQuad: (t)=>t*t,
  easeOutQuad: (t)=>t*(2-t),
  easeInOutQuad: (t)=>t<0.5?2*t*t:-1+(4-2*t)*t,
  easeInCubic: (t)=>t*t*t,
  easeOutCubic: (t)=>(--t)*t*t+1,
  easeInOutCubic: (t)=>t<0.5?4*t*t*t:(t-1)*(2*t-2)*(2*t-2)+1,
  easeInQuart: (t)=>t*t*t*t,
  easeOutQuart: (t)=>1-(--t)*t*t*t,
  easeInOutQuart: (t)=>t<0.5?8*t*t*t*t:1-8*(--t)*t*t*t,
  easeInQuint: (t)=>t*t*t*t*t,
  easeOutQuint: (t)=>1+(--t)*t*t*t*t,
  easeInOutQuint: (t)=>t<0.5?16*t*t*t*t*t:1+16*(--t)*t*t*t*t,
  easeInSine: (t)=>1-Math.cos(t*Math.PI/2),
  easeOutSine: (t)=>Math.sin(t*Math.PI/2),
  easeInOutSine: (t)=>-(Math.cos(Math.PI*t)-1)/2,
  easeInExpo: (t)=>t===0?0:Math.pow(2,10*(t-1)),
  easeOutExpo: (t)=>t===1?1:1-Math.pow(2,-10*t),
  easeInOutExpo: (t)=>t===0?0:t===1?1:t<0.5?Math.pow(2,20*t-10)/2:(2-Math.pow(2,-20*t+10))/2,
  easeInCirc: (t)=>1-Math.sqrt(1-t*t),
  easeOutCirc: (t)=>Math.sqrt(1-(--t)*t),
  easeInOutCirc: (t)=>t<0.5?(1-Math.sqrt(1-4*t*t))/2:(Math.sqrt(1-(-2*t+2)*(-2*t+2))+1)/2,
  easeInElastic: (t)=>{ if(t===0||t===1)return t; return -Math.pow(2,10*(t-1))*Math.sin((t-1.1)*5*Math.PI); },
  easeOutElastic: (t)=>{ if(t===0||t===1)return t; return Math.pow(2,-10*t)*Math.sin((t-0.1)*5*Math.PI)+1; },
  easeInOutElastic: (t)=>{ if(t===0||t===1)return t; if(t<0.5)return -(Math.pow(2,20*t-10)*Math.sin((20*t-11.125)*Math.PI/4.5))/2; return (Math.pow(2,-20*t+10)*Math.sin((20*t-11.125)*Math.PI/4.5))/2+1; },
  easeInBack: (t)=>{ const s=1.70158; return t*t*((s+1)*t-s); },
  easeOutBack: (t)=>{ const s=1.70158; return (--t)*t*((s+1)*t+s)+1; },
  easeInOutBack: (t)=>{ const s=1.70158*1.525; return t<0.5?(4*t*t*((s+1)*2*t-s))/2:((2*t-2)*(2*t-2)*((s+1)*(t*2-2)+s)+2)/2; },
  easeInBounce: (t)=>1-MathUtil.easeOutBounce(1-t),
  easeOutBounce: (t)=>{ if(t<1/2.75)return 7.5625*t*t; else if(t<2/2.75)return 7.5625*(t-=1.5/2.75)*t+0.75; else if(t<2.5/2.75)return 7.5625*(t-=2.25/2.75)*t+0.9375; else return 7.5625*(t-=2.625/2.75)*t+0.984375; },
  easeInOutBounce: (t)=>t<0.5?(1-MathUtil.easeOutBounce(1-2*t))/2:(1+MathUtil.easeOutBounce(2*t-1))/2,
  randomRange: (min,max)=>min+Math.random()*(max-min),
  randomInt: (min,max)=>Math.floor(min+Math.random()*(max-min+1)),
  randomChoice: (arr)=>arr[Math.floor(Math.random()*arr.length)],
  randomWeighted: (weights)=>{ const total=weights.reduce((a,b)=>a+b,0); let r=Math.random()*total; for(let i=0;i<weights.length;i++){r-=weights[i]; if(r<=0)return i;} return weights.length-1; },
  shuffle: (arr)=>{ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const tmp=arr[i]; arr[i]=arr[j]; arr[j]=tmp; } return arr; },
  degToRad: (d)=>d*Math.PI/180,
  radToDeg: (r)=>r*180/Math.PI,
  distance2D: (x1,y1,x2,y2)=>Math.sqrt((x2-x1)**2+(y2-y1)**2),
  distance3D: (x1,y1,z1,x2,y2,z2)=>Math.sqrt((x2-x1)**2+(y2-y1)**2+(z2-z1)**2),
  lerpColor: (c1,c2,t)=>[c1[0]+(c2[0]-c1[0])*t, c1[1]+(c2[1]-c1[1])*t, c1[2]+(c2[2]-c1[2])*t, c1[3]!==undefined?c1[3]+(c2[3]-c1[3])*t:1],
  colorToHex: (r,g,b)=>'#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1),
  hexToColor: (hex)=>{ const n=parseInt(hex.replace('#',''),16); return [(n>>16)&255, (n>>8)&255, n&255]; },
};

/* ===== 噪声函数 ===== */
const Noise = {
  _perm: null,
  _initPerm: function(){
    const p = new Uint8Array(512);
    const perm = new Uint8Array(256);
    for(let i=0;i<256;i++) perm[i]=i;
    for(let i=255;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const tmp=perm[i]; perm[i]=perm[j]; perm[j]=tmp; }
    for(let i=0;i<512;i++) p[i]=perm[i&255];
    Noise._perm = p;
  },
  _fade: function(t){ return t*t*t*(t*(t*6-15)+10); },
  _lerp: function(a,b,t){ return a+(b-a)*t; },
  _grad: function(hash,x,y,z){
    const h=hash&15;
    const u=h<8?x:y;
    const v=h<4?y:h===12||h===14?x:z;
    return ((h&1)===0?u:-u)+((h&2)===0?v:-v);
  },
  perlin2: function(x,y){
    if(!Noise._perm) Noise._initPerm();
    const p=Noise._perm;
    const X=Math.floor(x)&255, Y=Math.floor(y)&255;
    x-=Math.floor(x); y-=Math.floor(y);
    const u=Noise._fade(x), v=Noise._fade(y);
    const A=p[X]+Y, B=p[X+1]+Y;
    return Noise._lerp(Noise._lerp(Noise._grad(p[A],x,y,0), Noise._grad(p[B],x-1,y,0), u), Noise._lerp(Noise._grad(p[A+1],x,y-1,0), Noise._grad(p[B+1],x-1,y-1,0), u), v);
  },
  perlin3: function(x,y,z){
    if(!Noise._perm) Noise._initPerm();
    const p=Noise._perm;
    const X=Math.floor(x)&255, Y=Math.floor(y)&255, Z=Math.floor(z)&255;
    x-=Math.floor(x); y-=Math.floor(y); z-=Math.floor(z);
    const u=Noise._fade(x), v=Noise._fade(y), w=Noise._fade(z);
    const A=p[X]+Y, AA=p[A]+Z, AB=p[A+1]+Z, B=p[X+1]+Y, BA=p[B]+Z, BB=p[B+1]+Z;
    return Noise._lerp(Noise._lerp(Noise._lerp(Noise._grad(p[AA],x,y,z), Noise._grad(p[BA],x-1,y,z), u), Noise._lerp(Noise._grad(p[AB],x,y-1,z), Noise._grad(p[BB],x-1,y-1,z), u), v), Noise._lerp(Noise._lerp(Noise._grad(p[AA+1],x,y,z-1), Noise._grad(p[BA+1],x-1,y,z-1), u), Noise._lerp(Noise._grad(p[AB+1],x,y-1,z-1), Noise._grad(p[BB+1],x-1,y-1,z-1), u), v), w);
  },
  fbm2: function(x,y,octaves,lacunarity,gain){
    octaves=octaves||4; lacunarity=lacunarity||2; gain=gain||0.5;
    let amp=1, freq=1, sum=0, norm=0;
    for(let i=0;i<octaves;i++){ sum+=amp*Noise.perlin2(x*freq,y*freq); norm+=amp; amp*=gain; freq*=lacunarity; }
    return sum/norm;
  },
  fbm3: function(x,y,z,octaves,lacunarity,gain){
    octaves=octaves||4; lacunarity=lacunarity||2; gain=gain||0.5;
    let amp=1, freq=1, sum=0, norm=0;
    for(let i=0;i<octaves;i++){ sum+=amp*Noise.perlin3(x*freq,y*freq,z*freq); norm+=amp; amp*=gain; freq*=lacunarity; }
    return sum/norm;
  },
  ridged2: function(x,y,octaves,lacunarity,gain){
    octaves=octaves||4; lacunarity=lacunarity||2; gain=gain||0.5;
    let amp=1, freq=1, sum=0, norm=0;
    for(let i=0;i<octaves;i++){ const n=1-Math.abs(Noise.perlin2(x*freq,y*freq)); sum+=amp*n*n; norm+=amp; amp*=gain; freq*=lacunarity; }
    return sum/norm;
  },
  value2: function(x,y){
    const xi=Math.floor(x), yi=Math.floor(y);
    const xf=x-xi, yf=y-yi;
    const u=Noise._fade(xf), v=Noise._fade(yf);
    const a=MathUtil.fract(Math.sin(xi*127.1+yi*311.7)*43758.5453);
    const b=MathUtil.fract(Math.sin((xi+1)*127.1+yi*311.7)*43758.5453);
    const c=MathUtil.fract(Math.sin(xi*127.1+(yi+1)*311.7)*43758.5453);
    const d=MathUtil.fract(Math.sin((xi+1)*127.1+(yi+1)*311.7)*43758.5453);
    return Noise._lerp(Noise._lerp(a,b,u), Noise._lerp(c,d,u), v);
  },
  cellular2: function(x,y){
    const xi=Math.floor(x), yi=Math.floor(y);
    let d1=Infinity, d2=Infinity;
    for(let i=-1;i<=1;i++){
      for(let j=-1;j<=1;j++){
        const cx=xi+i+MathUtil.fract(Math.sin((xi+i)*127.1+(yi+j)*311.7)*43758.5453);
        const cy=yi+j+MathUtil.fract(Math.sin((xi+i)*269.5+(yi+j)*183.3)*43758.5453);
        const dx=x-cx, dy=y-cy, d=dx*dx+dy*dy;
        if(d<d1){ d2=d1; d1=d; } else if(d<d2){ d2=d; }
      }
    }
    return { f1:Math.sqrt(d1), f2:Math.sqrt(d2) };
  },
};

/* ===== 纹理解码扩展（BMP、DDS） ===== */
function decodeBMP(buffer){
  const view = new DataView(buffer);
  if(view.getUint16(0, true) !== 0x4D42) throw new Error('BMP: 无效文件头');
  const fileSize = view.getUint32(2, true);
  const dataOffset = view.getUint34(10, true);
  const headerSize = view.getUint32(14, true);
  let width, height, bitCount, compression;
  if(headerSize === 12){
    width = view.getInt16(18, true);
    height = view.getInt16(20, true);
    bitCount = view.getUint16(24, true);
    compression = 0;
  } else {
    width = view.getInt32(18, true);
    height = view.getInt32(22, true);
    bitCount = view.getUint16(28, true);
    compression = view.getUint32(30, true);
  }
  const topDown = height < 0;
  height = Math.abs(height);
  const pixels = new Uint8Array(width*height*4);
  const rowSize = Math.floor((bitCount*width+31)/32)*4;
  let pos = dataOffset;
  for(let y=0;y<height;y++){
    const rowY = topDown ? y : height-1-y;
    const rowOffset = rowY*width*4;
    if(bitCount === 24){
      for(let x=0;x<width;x++){
        const b=view.getUint8(pos), g=view.getUint8(pos+1), r=view.getUint8(pos+2);
        pixels[rowOffset+x*4]=r; pixels[rowOffset+x*4+1]=g; pixels[rowOffset+x*4+2]=b; pixels[rowOffset+x*4+3]=255;
        pos+=3;
      }
    } else if(bitCount === 32){
      for(let x=0;x<width;x++){
        const b=view.getUint8(pos), g=view.getUint8(pos+1), r=view.getUint8(pos+2), a=view.getUint8(pos+3);
        pixels[rowOffset+x*4]=r; pixels[rowOffset+x*4+1]=g; pixels[rowOffset+x*4+2]=b; pixels[rowOffset+x*4+3]=a;
        pos+=4;
      }
    } else if(bitCount === 16){
      for(let x=0;x<width;x++){
        const v=view.getUint16(pos, true);
        const r=(v&0x7C00)>>10, g=(v&0x03E0)>>5, b=v&0x001F;
        pixels[rowOffset+x*4]=(r<<3)|(r>>2); pixels[rowOffset+x*4+1]=(g<<3)|(g>>2); pixels[rowOffset+x*4+2]=(b<<3)|(b>>2); pixels[rowOffset+x*4+3]=255;
        pos+=2;
      }
    } else if(bitCount === 8){
      const paletteOffset = headerSize === 12 ? 26 : 54;
      const palette = [];
      for(let i=0;i<256;i++){
        const b=view.getUint8(paletteOffset+i*4), g=view.getUint8(paletteOffset+i*4+1), r=view.getUint8(paletteOffset+i*4+2);
        palette.push([r,g,b,255]);
      }
      for(let x=0;x<width;x++){
        const idx=view.getUint8(pos++);
        const c=palette[idx];
        pixels[rowOffset+x*4]=c[0]; pixels[rowOffset+x*4+1]=c[1]; pixels[rowOffset+x*4+2]=c[2]; pixels[rowOffset+x*4+3]=c[3];
      }
    }
    pos += rowSize - (bitCount/8)*width;
  }
  console.log('[BMP] 解码完成 ' + width + 'x' + height + ' bit=' + bitCount);
  return { width, height, data: pixels, hasAlpha: bitCount===32 };
}
function decodeDDS(buffer){
  const view = new DataView(buffer);
  if(view.getUint32(0, true) !== 0x20534444) throw new Error('DDS: 无效文件头');
  const height = view.getUint32(12, true);
  const width = view.getUint32(16, true);
  const pitch = view.getUint32(20, true);
  const depth = view.getUint32(24, true);
  const mipMapCount = view.getUint32(28, true);
  const pixelFormatSize = view.getUint32(76, true);
  const flags = view.getUint32(80, true);
  const fourCC = view.getUint32(84, true);
  const rgbBitCount = view.getUint32(88, true);
  const rBitMask = view.getUint32(92, true);
  const gBitMask = view.getUint32(96, true);
  const bBitMask = view.getUint32(100, true);
  const aBitMask = view.getUint32(104, true);
  const isCompressed = (flags & 0x4) !== 0;
  let format = 'unknown';
  if(isCompressed){
    if(fourCC === 0x31545844) format = 'DXT1';
    else if(fourCC === 0x33545844) format = 'DXT3';
    else if(fourCC === 0x35545844) format = 'DXT5';
    else if(fourCC === 0x30315844) format = 'DX10';
  }
  const blockSize = format === 'DXT1' ? 8 : 16;
  const dataOffset = 128;
  const data = new Uint8Array(buffer, dataOffset);
  const mipmaps = [];
  let offset = 0;
  let w = width, h = height;
  for(let m=0;m<Math.max(1,mipMapCount);m++){
    const bw = Math.max(1, Math.floor((w+3)/4));
    const bh = Math.max(1, Math.floor((h+3)/4));
    const size = isCompressed ? bw*bh*blockSize : w*h*(rgbBitCount/8);
    mipmaps.push({ width:w, height:h, data: data.slice(offset, offset+size), offset, size });
    offset += size;
    w = Math.max(1, w>>1); h = Math.max(1, h>>1);
  }
  console.log('[DDS] 解码完成 ' + width + 'x' + height + ' format=' + format + ' mipmaps=' + mipmaps.length);
  return { width, height, format, mipmaps, isCompressed, hasAlpha: format!=='DXT1' };
}
function decodePNG(buffer){
  return new Promise((resolve,reject)=>{
    const blob = new Blob([buffer], {type:'image/png'});
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = ()=>{
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0,0,img.width,img.height);
      URL.revokeObjectURL(url);
      resolve({ width: img.width, height: img.height, data: imageData.data, hasAlpha: true });
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error('PNG解码失败')); };
    img.src = url;
  });
}
function decodeJPEG(buffer){
  return new Promise((resolve,reject)=>{
    const blob = new Blob([buffer], {type:'image/jpeg'});
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = ()=>{
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0,0,img.width,img.height);
      URL.revokeObjectURL(url);
      resolve({ width: img.width, height: img.height, data: imageData.data, hasAlpha: false });
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error('JPEG解码失败')); };
    img.src = url;
  });
}
function createTextureFromDecoded(gl, decoded, options){
  const opt = options || {};
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, opt.flipY !== false);
  if(decoded.format && decoded.format.startsWith('DXT')){
    const ext = gl.getExtension('WEBGL_compressed_texture_s3tc');
    if(ext){
      const glFormat = decoded.format==='DXT1' ? ext.COMPRESSED_RGB_S3TC_DXT1_EXT : decoded.format==='DXT3' ? ext.COMPRESSED_RGBA_S3TC_DXT3_EXT : ext.COMPRESSED_RGBA_S3TC_DXT5_EXT;
      for(const mip of decoded.mipmaps){
        gl.compressedTexImage2D(gl.TEXTURE_2D, decoded.mipmaps.indexOf(mip), glFormat, mip.width, mip.height, 0, mip.data);
      }
    }
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, decoded.width, decoded.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, decoded.data);
    if(opt.generateMipmaps !== false && (decoded.width & (decoded.width-1))===0 && (decoded.height & (decoded.height-1))===0){
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opt.wrapS || gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opt.wrapT || gl.CLAMP_TO_EDGE);
  return tex;
}