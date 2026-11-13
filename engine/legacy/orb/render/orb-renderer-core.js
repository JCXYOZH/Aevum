/**
 * MrHua 3D灵体渲染引擎 - orb-renderer-core
 * WebGL渲染器核心(着色器/上下文)
 * 从 orb-renderer-main.js 拆分 (原行 L2545-L2813)
 * @module orb-renderer-core
 */
'use strict';

/* ===== WebGL 渲染器 ===== */
const VERT_SRC = `
precision highp float;
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUV;
attribute vec4 aBoneIndex;
attribute vec4 aBoneWeight;
attribute vec3 aMorphOffset;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform mat4 uBonePalette[BONE_PALETTE_SIZE];
uniform float uMorphEnabled;
uniform float uOutlineScale;
varying vec3 vNormal;
varying vec2 vUV;
varying vec3 vWorldPos;
void main(){
  vec3 basePos = aPosition;
  vec3 baseNrm = aNormal;
  if(uMorphEnabled > 0.5){
    basePos = aPosition + aMorphOffset;
  }
  if(uOutlineScale > 0.001){
    basePos = basePos + baseNrm * uOutlineScale;
  }
  vec4 pos = vec4(basePos, 1.0);
  vec3 nrm = baseNrm;
  float w0 = aBoneWeight.x;
  float w1 = aBoneWeight.y;
  float w2 = aBoneWeight.z;
  float w3 = aBoneWeight.w;
  float total = w0+w1+w2+w3;
  if(total > 0.0001){
    float invTotal = 1.0/total;
    w0*=invTotal; w1*=invTotal; w2*=invTotal; w3*=invTotal;
    vec4 skinned = vec4(0.0);
    vec3 skinnedN = vec3(0.0);
    if(w0 > 0.001){ mat4 m0 = uBonePalette[int(aBoneIndex.x)]; skinned += m0*pos*w0; skinnedN += mat3(m0)*nrm*w0; }
    if(w1 > 0.001){ mat4 m1 = uBonePalette[int(aBoneIndex.y)]; skinned += m1*pos*w1; skinnedN += mat3(m1)*nrm*w1; }
    if(w2 > 0.001){ mat4 m2 = uBonePalette[int(aBoneIndex.z)]; skinned += m2*pos*w2; skinnedN += mat3(m2)*nrm*w2; }
    if(w3 > 0.001){ mat4 m3 = uBonePalette[int(aBoneIndex.w)]; skinned += m3*pos*w3; skinnedN += mat3(m3)*nrm*w3; }
    pos = skinned;
    nrm = normalize(skinnedN);
  }
  vec4 worldPos = uModel * pos;
  vWorldPos = worldPos.xyz;
  vNormal = mat3(uModel) * nrm;
  vUV = vec2(aUV.x, 1.0 - aUV.y);
  gl_Position = uProj * uView * worldPos;
}`;

const FRAG_SRC = `
precision highp float;
varying vec3 vNormal;
varying vec2 vUV;
varying vec3 vWorldPos;
uniform vec3 uDiffuse;
uniform vec3 uAmbient;
uniform vec3 uSpecular;
uniform float uShininess;
uniform sampler2D uTexture;
uniform int uHasTexture;
uniform vec3 uLightDir;
uniform vec3 uCameraPos;
uniform int uRawTexture;
uniform vec3 uHemisphereSky;
uniform vec3 uHemisphereGround;
uniform float uHemisphereIntensity;
uniform float uRimPower;
uniform float uRimIntensity;
uniform vec3 uRimColor;
uniform float uOutlineWidth;
uniform vec3 uOutlineColor;
uniform float uExposure;
uniform float uSaturation;
uniform float uContrast;
uniform float uBrightness;
void main(){
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightDir);
  float diff = max(dot(N,L),0.0);
  vec3 V = normalize(uCameraPos - vWorldPos);
  vec3 H = normalize(L+V);
  float NdotH = max(dot(N,H),0.0);
  float spec = pow(NdotH, max(uShininess,1.0));
  float NdotV = max(dot(N,V),0.0);
  float rim = pow(1.0 - NdotV, uRimPower);

  // 半球光：基于法线方向在天空色和地面色之间插值
  float hemiFactor = N.y * 0.5 + 0.5;
  vec3 hemisphere = mix(uHemisphereGround, uHemisphereSky, hemiFactor) * uHemisphereIntensity;

  vec3 baseColor = uDiffuse;
  if(uHasTexture == 1){
    vec4 tex = texture2D(uTexture, vUV);
    // 纹理是sRGB编码，解码到线性空间进行光照计算
    baseColor = pow(max(tex.rgb, 0.0), vec3(2.2)) * uDiffuse;
  }
  if(uRawTexture == 1){
    gl_FragColor = vec4(baseColor, 1.0);
    return;
  }

  // 主光照：环境光 + 半球光 + 漫反射 + 镜面反射 + 菲涅尔边缘光（线性空间）
  // 菲涅尔效应：视角与法线夹角越大，边缘光越强，增强立体感和高亮
  float fresnel = pow(1.0 - NdotV, 3.0);
  vec3 rimLight = uRimColor * rim * uRimIntensity + vec3(0.15, 0.18, 0.25) * fresnel * 0.6;

  // 简单AO近似：暗部区域（法线背离光源）加深，增强体积感
  float aoFactor = mix(0.75, 1.0, diff * 0.5 + hemiFactor * 0.5);

  vec3 color = (uAmbient * baseColor * 1.4
             + hemisphere * baseColor * 1.0
             + baseColor * diff * 2.0
             + uSpecular * spec * 0.9) * aoFactor
             + rimLight * 0.7;

  // 色调映射：ACES近似，明亮且保留高光细节
  color = (color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14);

  // 曝光控制
  color *= uExposure;

  // 亮度偏移
  color += uBrightness;

  // 对比度控制
  color = (color - 0.5) * uContrast + 0.5;

  // 饱和度控制
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(luma), color, uSaturation);

  // gamma校正：线性空间转sRGB显示
  color = pow(max(color, 0.0), vec3(0.4545));

  gl_FragColor = vec4(color, 1.0);
}`;

function createRenderer(canvas){
  const _gl2Supported = !!document.createElement('canvas').getContext('webgl2');
  const gl = canvas.getContext('webgl',{antialias:true,alpha:true,premultipliedAlpha:false,powerPreference:'high-performance',failIfMajorPerformanceCaveat:false}) || canvas.getContext('experimental-webgl',{antialias:true,alpha:true,premultipliedAlpha:false,powerPreference:'high-performance'});
  if(!gl) throw new Error('WebGL 不可用');
  const isWebGL2 = false;
  let _contextLost = false;
  let _contextLostCount = 0;
  canvas.addEventListener('webglcontextlost', function(e){ e.preventDefault(); _contextLost = true; _contextLostCount++; if(_contextLostCount <= 3) console.log('[NativeRenderer] WebGL上下文丢失! 次数=' + _contextLostCount); });
  canvas.addEventListener('webglcontextrestored', function(){ _contextLost = false; console.log('[NativeRenderer] WebGL上下文恢复! 需重新加载模型'); });
  const uintExt = gl.getExtension('OES_element_index_uint');
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(-1.0, -1.0);
  gl.clearColor(0.08, 0.08, 0.10, 1.0);
  console.log('[NativeRenderer] WebGL初始化完成 uint32扩展=' + !!uintExt + '  vendor=' + gl.getParameter(gl.VENDOR) + ' renderer=' + gl.getParameter(gl.RENDERER));

  const maxVertUniforms = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) || 128;
  // 去掉硬编码1024上限，直接使用硬件计算值（每个骨骼4个uniform，预留32个给其他uniform）
  const maxBones = Math.max(64, Math.floor((maxVertUniforms - 32) / 4));
  const anisoExt = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('MOZ_EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
  const maxAniso = anisoExt ? gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
  const vaoExt = gl.getExtension('OES_vertex_array_object');
  console.log('[NativeRenderer] 顶点uniform上限=' + maxVertUniforms + ' 骨骼调色板最大=' + maxBones + ' 各向异性=' + maxAniso + ' VAO=' + !!vaoExt + ' WebGL2备用=' + _gl2Supported);

  function compile(type,src){
    const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error('着色器编译失败: '+gl.getShaderInfoLog(s));
    return s;
  }
  const vs=compile(gl.VERTEX_SHADER,VERT_SRC.replace('BONE_PALETTE_SIZE',maxBones));
  const fs=compile(gl.FRAGMENT_SHADER,FRAG_SRC);
  const prog=gl.createProgram(); gl.attachShader(prog,vs); gl.attachShader(prog,fs); gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog,gl.LINK_STATUS)) throw new Error('程序链接失败: '+gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const loc = {
    aPosition: gl.getAttribLocation(prog,'aPosition'),
    aNormal: gl.getAttribLocation(prog,'aNormal'),
    aUV: gl.getAttribLocation(prog,'aUV'),
    aBoneIndex: gl.getAttribLocation(prog,'aBoneIndex'),
    aBoneWeight: gl.getAttribLocation(prog,'aBoneWeight'),
    aMorphOffset: gl.getAttribLocation(prog,'aMorphOffset'),
    uProj: gl.getUniformLocation(prog,'uProj'),
    uView: gl.getUniformLocation(prog,'uView'),
    uModel: gl.getUniformLocation(prog,'uModel'),
    uBonePalette: gl.getUniformLocation(prog,'uBonePalette[0]'),
    uMorphEnabled: gl.getUniformLocation(prog,'uMorphEnabled'),
    uOutlineScale: gl.getUniformLocation(prog,'uOutlineScale'),
    uDiffuse: gl.getUniformLocation(prog,'uDiffuse'),
    uAmbient: gl.getUniformLocation(prog,'uAmbient'),
    uSpecular: gl.getUniformLocation(prog,'uSpecular'),
    uShininess: gl.getUniformLocation(prog,'uShininess'),
    uTexture: gl.getUniformLocation(prog,'uTexture'),
    uHasTexture: gl.getUniformLocation(prog,'uHasTexture'),
    uRawTexture: gl.getUniformLocation(prog,'uRawTexture'),
    uLightDir: gl.getUniformLocation(prog,'uLightDir'),
    uCameraPos: gl.getUniformLocation(prog,'uCameraPos'),
    uHemisphereSky: gl.getUniformLocation(prog,'uHemisphereSky'),
    uHemisphereGround: gl.getUniformLocation(prog,'uHemisphereGround'),
    uHemisphereIntensity: gl.getUniformLocation(prog,'uHemisphereIntensity'),
    uRimPower: gl.getUniformLocation(prog,'uRimPower'),
    uRimIntensity: gl.getUniformLocation(prog,'uRimIntensity'),
    uRimColor: gl.getUniformLocation(prog,'uRimColor'),
    uOutlineWidth: gl.getUniformLocation(prog,'uOutlineWidth'),
    uOutlineColor: gl.getUniformLocation(prog,'uOutlineColor'),
    uExposure: gl.getUniformLocation(prog,'uExposure'),
    uSaturation: gl.getUniformLocation(prog,'uSaturation'),
    uContrast: gl.getUniformLocation(prog,'uContrast'),
    uBrightness: gl.getUniformLocation(prog,'uBrightness'),
  };

  function createBuffer(data,target){
    const b=gl.createBuffer(); gl.bindBuffer(target,b); gl.bufferData(target,data,gl.STATIC_DRAW); return b;
  }

  function isPOT(v){ return (v & (v-1)) === 0; }
  function setupTexParams(w,h){
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // 近距离观察场景：使用LINEAR不使用mipmap，保留原始纹理细节
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    if(anisoExt && maxAniso > 1){
      gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso);
    }
  }
  function loadTexture(url){
    return new Promise(async (resolve,reject)=>{
      const isTGA = /\.tga(\?|$)/i.test(url);
      if(isTGA){
        try{
          const resp = await fetch(url);
          if(!resp.ok){ resolve(null); return; }
          const buf = await resp.arrayBuffer();
          const tga = decodeTGA(buf);
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tga.width, tga.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, tga.data);
          setupTexParams(tga.width, tga.height);
          console.log('[NativeRenderer] TGA纹理加载成功:', url.split('/').pop(), tga.width+'x'+tga.height, 'depth='+tga.depth, 'type='+tga.imageType, 'desc=0x'+tga.descriptor.toString(16), isPOT(tga.width)&&isPOT(tga.height)?'mipmap':'no-mipmap');
          resolve(tex);
        } catch(e){
          console.log('[NativeRenderer] TGA解码失败:', url.split('/').pop(), e.message);
          resolve(null);
        }
        return;
      }
      const img=new Image(); img.crossOrigin='anonymous';
      img.onload=()=>{
        const tex=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
        setupTexParams(img.width, img.height);
        resolve(tex);
      };
      img.onerror=()=>resolve(null);
      img.src=url;
    });
  }

  return { gl, prog, loc, createBuffer, loadTexture, maxBones, _vaoExt: vaoExt, _isWebGL2: isWebGL2, get _contextLost(){ return _contextLost; } };
}

