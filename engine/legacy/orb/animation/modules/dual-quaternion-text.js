/* ===== 双四元数蒙皮 (Dual Quaternion Skinning) =====
   替代线性混合蒙皮(LBS), 消除糖果包装效应
*/
function createDualQuaternionSkinner(boneSystem, options){
  const dqs = {
    boneSystem: boneSystem,
    maxBones: (options && options.maxBones) || 256,
    _dualQuaternions: null,
    _boneMatrices: null,
    _scratchDQ: null
  };

  function init(){
    dqs._dualQuaternions = new Float32Array(dqs.maxBones * 8);
    dqs._boneMatrices = new Float32Array(dqs.maxBones * 16);
    dqs._scratchDQ = new Float32Array(8);
  }

  function mat4ToDualQuaternion(mat, outReal, outDual){
    const m00=mat[0],m01=mat[1],m02=mat[2],m03=mat[3];
    const m10=mat[4],m11=mat[5],m12=mat[6],m13=mat[7];
    const m20=mat[8],m21=mat[9],m22=mat[10],m23=mat[11];

    const trace = m00 + m11 + m22;
    let qx, qy, qz, qw;
    if(trace > 0){
      const s = 0.5 / Math.sqrt(trace + 1);
      qw = 0.25 / s;
      qx = (m12 - m21) * s;
      qy = (m20 - m02) * s;
      qz = (m01 - m10) * s;
    } else if(m00 > m11 && m00 > m22){
      const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
      qw = (m12 - m21) / s;
      qx = 0.25 * s;
      qy = (m10 + m01) / s;
      qz = (m20 + m02) / s;
    } else if(m11 > m22){
      const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
      qw = (m20 - m02) / s;
      qx = (m10 + m01) / s;
      qy = 0.25 * s;
      qz = (m12 + m21) / s;
    } else {
      const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
      qw = (m01 - m10) / s;
      qx = (m20 + m02) / s;
      qy = (m12 + m21) / s;
      qz = 0.25 * s;
    }

    outReal[0]=qx; outReal[1]=qy; outReal[2]=qz; outReal[3]=qw;

    const tx = mat[12], ty = mat[13], tz = mat[14];
    outDual[0] = 0.5 * ( tx*qw + ty*qz - tz*qy);
    outDual[1] = 0.5 * (-tx*qz + ty*qw + tz*qx);
    outDual[2] = 0.5 * ( tx*qy - ty*qx + tz*qw);
    outDual[3] = -0.5 * (tx*qx + ty*qy + tz*qz);
  }

  function dualQuaternionMult(out, r0, d0, r1, d1){
    out[0] = r0[3]*r1[0] + r0[0]*r1[3] + r0[1]*r1[2] - r0[2]*r1[1];
    out[1] = r0[3]*r1[1] - r0[0]*r1[2] + r0[1]*r1[3] + r0[2]*r1[0];
    out[2] = r0[3]*r1[2] + r0[0]*r1[1] - r0[1]*r1[0] + r0[2]*r1[3];
    out[3] = r0[3]*r1[3] - r0[0]*r1[0] - r0[1]*r1[1] - r0[2]*r1[2];
    out[4] = r0[3]*d1[0] + d0[0]*r1[3] + r0[1]*d1[2] - r0[2]*d1[1] + d0[1]*r1[2] - d0[2]*r1[1];
    out[5] = r0[3]*d1[1] - r0[0]*d1[2] + d0[0]*r1[2] + r0[1]*d1[3] + d0[1]*r1[3] + r0[2]*d1[0] - d0[2]*r1[0];
    out[6] = r0[3]*d1[2] + r0[0]*d1[1] - r0[1]*d1[0] + d0[0]*r1[1] - d0[1]*r1[0] + r0[2]*d1[3] + d0[2]*r1[3];
    out[7] = r0[3]*d1[3] - r0[0]*d1[0] - r0[1]*d1[1] - r0[2]*d1[2] + d0[0]*r1[0] + d0[1]*r1[1] + d0[2]*r1[2];
  }

  function updateBoneDualQuaternions(boneMatrices, boneCount){
    const real = new Float32Array(4), dual = new Float32Array(4);
    for(let i = 0; i < boneCount && i < dqs.maxBones; i++){
      const mat = boneMatrices.subarray(i*16, i*16+16);
      mat4ToDualQuaternion(mat, real, dual);
      dqs._dualQuaternions[i*8] = real[0];
      dqs._dualQuaternions[i*8+1] = real[1];
      dqs._dualQuaternions[i*8+2] = real[2];
      dqs._dualQuaternions[i*8+3] = real[3];
      dqs._dualQuaternions[i*8+4] = dual[0];
      dqs._dualQuaternions[i*8+5] = dual[1];
      dqs._dualQuaternions[i*8+6] = dual[2];
      dqs._dualQuaternions[i*8+7] = dual[3];
    }
  }

  function skinVertex(position, normal, boneIndices, boneWeights, outPos, outNorm){
    const blendReal = [0,0,0,0], blendDual = [0,0,0,0];
    const refReal = dqs._dualQuaternions.subarray(boneIndices[0]*8, boneIndices[0]*8+4);
    let sign = 1;
    for(let w = 0; w < 4; w++){
      const idx = boneIndices[w];
      const weight = boneWeights[w];
      if(weight <= 0 || idx < 0) continue;
      const boneReal = dqs._dualQuaternions.subarray(idx*8, idx*8+4);
      const boneDual = dqs._dualQuaternions.subarray(idx*8+4, idx*8+8);
      if(w > 0){
        const dot = boneReal[0]*refReal[0] + boneReal[1]*refReal[1] + boneReal[2]*refReal[2] + boneReal[3]*refReal[3];
        sign = dot >= 0 ? 1 : -1;
      }
      blendReal[0] += boneReal[0] * weight * sign;
      blendReal[1] += boneReal[1] * weight * sign;
      blendReal[2] += boneReal[2] * weight * sign;
      blendReal[3] += boneReal[3] * weight * sign;
      blendDual[0] += boneDual[0] * weight * sign;
      blendDual[1] += boneDual[1] * weight * sign;
      blendDual[2] += boneDual[2] * weight * sign;
      blendDual[3] += boneDual[3] * weight * sign;
    }

    const len = Math.sqrt(blendReal[0]*blendReal[0] + blendReal[1]*blendReal[1] + blendReal[2]*blendReal[2] + blendReal[3]*blendReal[3]) || 1;
    for(let i = 0; i < 4; i++){
      blendReal[i] /= len;
      blendDual[i] /= len;
    }

    const qx=blendReal[0], qy=blendReal[1], qz=blendReal[2], qw=blendReal[3];
    const dx=blendDual[0], dy=blendDual[1], dz=blendDual[2], dw=blendDual[3];

    const tx = 2 * (-dw*qx + dx*qw - dy*qz + dz*qy);
    const ty = 2 * (-dw*qy + dx*qz + dy*qw - dz*qx);
    const tz = 2 * (-dw*qz - dx*qy + dy*qx + dz*qw);

    const x2 = qx+qx, y2 = qy+qy, z2 = qz+qz;
    const xx = qx*x2, xy = qx*y2, xz = qx*z2;
    const yy = qy*y2, yz = qy*z2, zz = qz*z2;
    const wx = qw*x2, wy = qw*y2, wz = qw*z2;

    const m00 = 1-(yy+zz), m01 = xy-wz, m02 = xz+wy;
    const m10 = xy+wz, m11 = 1-(xx+zz), m12 = yz-wx;
    const m20 = xz-wy, m21 = yz+wx, m22 = 1-(xx+yy);

    outPos[0] = m00*position[0] + m01*position[1] + m02*position[2] + tx;
    outPos[1] = m10*position[0] + m11*position[1] + m12*position[2] + ty;
    outPos[2] = m20*position[0] + m21*position[1] + m22*position[2] + tz;

    outNorm[0] = m00*normal[0] + m01*normal[1] + m02*normal[2];
    outNorm[1] = m10*normal[0] + m11*normal[1] + m12*normal[2];
    outNorm[2] = m20*normal[0] + m21*normal[1] + m22*normal[2];
  }

  function skinMesh(geometry, boneIndices, boneWeights, boneMatrices, boneCount){
    updateBoneDualQuaternions(boneMatrices, boneCount);
    const pos = geometry.positions;
    const norm = geometry.normals;
    const outPos = new Float32Array(pos.length);
    const outNorm = new Float32Array(norm.length);
    const vertCount = pos.length / 3;
    const p = [0,0,0], n = [0,0,0], op = [0,0,0], on = [0,0,0];
    const bi = [0,0,0,0], bw = [0,0,0,0];
    for(let i = 0; i < vertCount; i++){
      p[0]=pos[i*3]; p[1]=pos[i*3+1]; p[2]=pos[i*3+2];
      n[0]=norm[i*3]; n[1]=norm[i*3+1]; n[2]=norm[i*3+2];
      for(let w = 0; w < 4; w++){
        bi[w] = boneIndices[i*4+w];
        bw[w] = boneWeights[i*4+w];
      }
      skinVertex(p, n, bi, bw, op, on);
      outPos[i*3]=op[0]; outPos[i*3+1]=op[1]; outPos[i*3+2]=op[2];
      outNorm[i*3]=on[0]; outNorm[i*3+1]=on[1]; outNorm[i*3+2]=on[2];
    }
    return { positions: outPos, normals: outNorm };
  }

  function getDualQuaternionArray(){
    return dqs._dualQuaternions;
  }

  function getShaderSource(){
    return {
      vertex: `
        const int MAX_BONES = 256;
        attribute vec3 aPosition;
        attribute vec3 aNormal;
        attribute vec4 aBoneIndex;
        attribute vec4 aBoneWeight;
        uniform vec4 uBonesDQ[MAX_BONES * 2];
        uniform mat4 uViewProj;
        varying vec3 vNormal;
        varying vec3 vWorldPos;

        vec4 multQuat(vec4 q1, vec4 q2){
          return vec4(
            q1.w * q2.x + q1.x * q2.w + q1.y * q2.z - q1.z * q2.y,
            q1.w * q2.y - q1.x * q2.z + q1.y * q2.w + q1.z * q2.x,
            q1.w * q2.z + q1.x * q2.y - q1.y * q2.x + q1.z * q2.w,
            q1.w * q2.w - q1.x * q2.x - q1.y * q2.y - q1.z * q2.z
          );
        }

        vec3 rotateVector(vec4 q, vec3 v){
          return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
        }

        vec4 blendDualQuaternions(vec4 indices, vec4 weights){
          vec4 real = vec4(0.0);
          vec4 dual = vec4(0.0);
          int idx0 = int(indices.x) * 2;
          vec4 refReal = uBonesDQ[idx0];
          for(int i = 0; i < 4; i++){
            int idx = int(indices[i]) * 2;
            vec4 boneReal = uBonesDQ[idx];
            vec4 boneDual = uBonesDQ[idx + 1];
            float dot = dot(boneReal, refReal);
            float sign = dot >= 0.0 ? 1.0 : -1.0;
            real += boneReal * weights[i] * sign;
            dual += boneDual * weights[i] * sign;
          }
          float len = length(real);
          real /= len;
          dual /= len;
          return vec4(real.xyz, dual.x);
        }

        void main(){
          vec4 blend = blendDualQuaternions(aBoneIndex, aBoneWeight);
          vec4 real = vec4(blend.xyz, 0.0);
          vec3 translation = 2.0 * vec3(
            -blend.w * real.x + real.w * real.x - real.y * real.z + real.z * real.y,
            -blend.w * real.y + real.x * real.z + real.w * real.y - real.z * real.x,
            -blend.w * real.z - real.x * real.y + real.y * real.x + real.w * real.z
          );
          vec3 worldPos = rotateVector(real, aPosition) + translation;
          vec3 worldNormal = rotateVector(real, aNormal);
          vWorldPos = worldPos;
          vNormal = worldNormal;
          gl_Position = uViewProj * vec4(worldPos, 1.0);
        }
      `,
      fragment: `
        precision mediump float;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        uniform vec3 uLightDir;
        uniform vec3 uColor;
        void main(){
          vec3 normal = normalize(vNormal);
          float diff = max(dot(normal, normalize(uLightDir)), 0.0);
          vec3 color = uColor * (0.3 + diff * 0.7);
          gl_FragColor = vec4(color, 1.0);
        }
      `
    };
  }

  return {
    init, mat4ToDualQuaternion, updateBoneDualQuaternions,
    skinVertex, skinMesh, getDualQuaternionArray, getShaderSource, dqs
  };
}



/* ===== 字体与文本渲染系统 =====
   支持: 位图字体 / SDF字体 / 文本布局 / 自动换行 / 对齐
*/
function createFontRenderer(gl, options){
  const fr = {
    gl: gl,
    fonts: {},
    currentFont: null,
    _program: null,
    _vbo: null,
    _vao: null,
    _initialized: false,
    _maxChars: (options && options.maxChars) || 4096
  };

  function init(){
    const gl = fr.gl;
    const vs = `
      attribute vec2 aPosition;
      attribute vec2 aUV;
      attribute vec4 aColor;
      uniform vec2 uResolution;
      varying vec2 vUV;
      varying vec4 vColor;
      void main(){
        vec2 pos = aPosition / uResolution * 2.0 - 1.0;
        pos.y = -pos.y;
        gl_Position = vec4(pos, 0.0, 1.0);
        vUV = aUV;
        vColor = aColor;
      }
    `;
    const fs = `
      precision mediump float;
      uniform sampler2D uFontTexture;
      uniform float uSDF;
      varying vec2 vUV;
      varying vec4 vColor;
      void main(){
        float dist = texture2D(uFontTexture, vUV).a;
        if(uSDF > 0.5){
          float alpha = smoothstep(0.48, 0.52, dist);
          gl_FragColor = vec4(vColor.rgb, vColor.a * alpha);
        } else {
          if(dist < 0.1) discard;
          gl_FragColor = vec4(vColor.rgb, vColor.a * dist);
        }
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    fr._program = gl.createProgram();
    gl.attachShader(fr._program, vsh);
    gl.attachShader(fr._program, fsh);
    gl.linkProgram(fr._program);

    fr._vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, fr._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, fr._maxChars * 6 * 12 * 4, gl.DYNAMIC_DRAW);
    fr._initialized = true;
  }

  function createBitmapFont(name, texture, glyphData, options){
    const font = {
      name: name,
      texture: texture,
      glyphs: {},
      lineHeight: (options && options.lineHeight) || 32,
      base: (options && options.base) || 24,
      scaleW: (options && options.scaleW) || 512,
      scaleH: (options && options.scaleH) || 512,
      isSDF: (options && options.isSDF) || false,
      kernings: {}
    };
    if(glyphData){
      for(let i = 0; i < glyphData.length; i++){
        const g = glyphData[i];
        font.glyphs[g.char] = {
          x: g.x, y: g.y, width: g.width, height: g.height,
          xoffset: g.xoffset || 0, yoffset: g.yoffset || 0,
          xadvance: g.xadvance || g.width
        };
      }
    }
    fr.fonts[name] = font;
    if(!fr.currentFont) fr.currentFont = font;
    return font;
  }

  function generateDefaultFont(name, options){
    const size = (options && options.size) || 32;
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#fff';
    ctx.font = size + 'px monospace';
    ctx.textBaseline = 'top';
    const glyphs = [];
    let x = 0, y = 0;
    const chars = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
    for(let i = 0; i < chars.length; i++){
      const ch = chars[i];
      const w = ctx.measureText(ch).width;
      if(x + w + 2 > 512){ x = 0; y += size + 4; }
      ctx.fillText(ch, x, y);
      glyphs.push({ char: ch, x: x, y: y, width: w, height: size, xoffset: 0, yoffset: 0, xadvance: w + 1 });
      x += w + 2;
    }
    const gl = fr.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return createBitmapFont(name, tex, glyphs, { lineHeight: size + 4, base: size, scaleW: 512, scaleH: 512 });
  }

  function setFont(name){
    if(fr.fonts[name]) fr.currentFont = fr.fonts[name];
  }

  function measureText(text, fontSize){
    if(!fr.currentFont) return { width: 0, height: 0 };
    const font = fr.currentFont;
    const scale = fontSize / font.lineHeight;
    let width = 0;
    for(let i = 0; i < text.length; i++){
      const g = font.glyphs[text[i]];
      if(g) width += g.xadvance * scale;
      else width += font.lineHeight * 0.5 * scale;
    }
    return { width: width, height: font.lineHeight * scale };
  }

  function wrapText(text, maxWidth, fontSize){
    if(!fr.currentFont) return [text];
    const lines = [];
    const paragraphs = text.split('\n');
    for(let p = 0; p < paragraphs.length; p++){
      const words = paragraphs[p].split(' ');
      let current = '';
      for(let w = 0; w < words.length; w++){
        const test = current ? current + ' ' + words[w] : words[w];
        const m = measureText(test, fontSize);
        if(m.width > maxWidth && current){
          lines.push(current);
          current = words[w];
        } else {
          current = test;
        }
      }
      if(current) lines.push(current);
    }
    return lines;
  }

  function drawText(text, x, y, fontSize, color, options){
    if(!fr.currentFont || !fr._initialized) return;
    const font = fr.currentFont;
    const gl = fr.gl;
    const scale = fontSize / font.lineHeight;
    const align = (options && options.align) || 'left';
    const baseline = (options && options.baseline) || 'top';
    const lineHeight = (options && options.lineHeight) || fontSize * 1.2;

    let lines = [text];
    if(options && options.maxWidth){
      lines = wrapText(text, options.maxWidth, fontSize);
    }

    const vertices = new Float32Array(fr._maxChars * 6 * 12);
    let vi = 0;
    let curX = x, curY = y;

    for(let l = 0; l < lines.length; l++){
      const line = lines[l];
      const m = measureText(line, fontSize);
      if(align === 'center') curX = x - m.width / 2;
      else if(align === 'right') curX = x - m.width;
      else curX = x;

      if(baseline === 'middle') curY = y - lineHeight / 2 + l * lineHeight;
      else if(baseline === 'bottom') curY = y - lineHeight + l * lineHeight;
      else curY = y + l * lineHeight;

      for(let i = 0; i < line.length; i++){
        const g = font.glyphs[line[i]];
        if(!g){ curX += font.lineHeight * 0.5 * scale; continue; }
        const gx = curX + g.xoffset * scale;
        const gy = curY + g.yoffset * scale;
        const gw = g.width * scale;
        const gh = g.height * scale;
        const u0 = g.x / font.scaleW;
        const v0 = g.y / font.scaleH;
        const u1 = (g.x + g.width) / font.scaleW;
        const v1 = (g.y + g.height) / font.scaleH;

        const verts = [
          gx, gy, u0, v0, color[0], color[1], color[2], color[3],
          gx+gw, gy, u1, v0, color[0], color[1], color[2], color[3],
          gx, gy+gh, u0, v1, color[0], color[1], color[2], color[3],
          gx+gw, gy, u1, v0, color[0], color[1], color[2], color[3],
          gx+gw, gy+gh, u1, v1, color[0], color[1], color[2], color[3],
          gx, gy+gh, u0, v1, color[0], color[1], color[2], color[3]
        ];
        for(let v = 0; v < 72; v++) vertices[vi++] = verts[v];
        curX += g.xadvance * scale;
      }
    }

    gl.useProgram(fr._program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.uniform2f(gl.getUniformLocation(fr._program, 'uResolution'), gl.canvas.width, gl.canvas.height);
    gl.uniform1f(gl.getUniformLocation(fr._program, 'uSDF'), font.isSDF ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, font.texture);
    gl.uniform1i(gl.getUniformLocation(fr._program, 'uFontTexture'), 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, fr._vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices.subarray(0, vi));
    const posLoc = gl.getAttribLocation(fr._program, 'aPosition');
    const uvLoc = gl.getAttribLocation(fr._program, 'aUV');
    const colLoc = gl.getAttribLocation(fr._program, 'aColor');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 48, 0);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 48, 8);
    gl.enableVertexAttribArray(colLoc);
    gl.vertexAttribPointer(colLoc, 4, gl.FLOAT, false, 48, 16);
    gl.drawArrays(gl.TRIANGLES, 0, vi / 12);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  function dispose(){
    const gl = fr.gl;
    if(fr._vbo) gl.deleteBuffer(fr._vbo);
    if(fr._program) gl.deleteProgram(fr._program);
    for(const name in fr.fonts){
      if(fr.fonts[name].texture) gl.deleteTexture(fr.fonts[name].texture);
    }
  }

  return { init, createBitmapFont, generateDefaultFont, setFont, measureText, wrapText, drawText, dispose, fr };
}
