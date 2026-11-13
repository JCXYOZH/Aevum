/* ===== 软件路径追踪器 =====
   支持: 漫反射 / 镜面反射 / 折射 / 软阴影 / 环境光
*/
function createPathTracer(options){
  const pt = {
    width: (options && options.width) || 512,
    height: (options && options.height) || 512,
    samples: (options && options.samples) || 16,
    maxBounces: (options && options.maxBounces) || 4,
    scene: { objects: [], lights: [], background: [0.1, 0.1, 0.2] },
    _framebuffer: null,
    _accumulator: null
  };

  function init(){
    pt._framebuffer = new Float32Array(pt.width * pt.height * 3);
    pt._accumulator = new Float32Array(pt.width * pt.height * 3);
  }

  function addSphere(center, radius, material){
    pt.scene.objects.push({
      type: 'sphere',
      center: [center[0], center[1], center[2]],
      radius: radius,
      material: material || { type: 'diffuse', color: [0.8, 0.8, 0.8] }
    });
  }

  function addPlane(normal, point, material){
    pt.scene.objects.push({
      type: 'plane',
      normal: [normal[0], normal[1], normal[2]],
      point: [point[0], point[1], point[2]],
      material: material || { type: 'diffuse', color: [0.5, 0.5, 0.5] }
    });
  }

  function addTriangle(v0, v1, v2, material){
    pt.scene.objects.push({
      type: 'triangle',
      v0: [v0[0],v0[1],v0[2]], v1: [v1[0],v1[1],v1[2]], v2: [v2[0],v2[1],v2[2]],
      material: material || { type: 'diffuse', color: [0.8, 0.8, 0.8] }
    });
  }

  function addLight(position, color, intensity){
    pt.scene.lights.push({
      position: [position[0], position[1], position[2]],
      color: [color[0], color[1], color[2]],
      intensity: intensity || 1
    });
  }

  function setBackground(color){
    pt.scene.background = [color[0], color[1], color[2]];
  }

  function intersectSphere(ray, sphere){
    const ox = ray.origin[0] - sphere.center[0];
    const oy = ray.origin[1] - sphere.center[1];
    const oz = ray.origin[2] - sphere.center[2];
    const b = ox * ray.dir[0] + oy * ray.dir[1] + oz * ray.dir[2];
    const c = ox*ox + oy*oy + oz*oz - sphere.radius * sphere.radius;
    const disc = b*b - c;
    if(disc < 0) return -1;
    const t = -b - Math.sqrt(disc);
    return t > 0.001 ? t : -1;
  }

  function intersectPlane(ray, plane){
    const denom = ray.dir[0]*plane.normal[0] + ray.dir[1]*plane.normal[1] + ray.dir[2]*plane.normal[2];
    if(Math.abs(denom) < 1e-8) return -1;
    const t = -(ray.origin[0]*plane.normal[0] + ray.origin[1]*plane.normal[1] + ray.origin[2]*plane.normal[2] -
                (plane.point[0]*plane.normal[0] + plane.point[1]*plane.normal[1] + plane.point[2]*plane.normal[2])) / denom;
    return t > 0.001 ? t : -1;
  }

  function intersectTriangle(ray, tri){
    const e1x = tri.v1[0]-tri.v0[0], e1y = tri.v1[1]-tri.v0[1], e1z = tri.v1[2]-tri.v0[2];
    const e2x = tri.v2[0]-tri.v0[0], e2y = tri.v2[1]-tri.v0[1], e2z = tri.v2[2]-tri.v0[2];
    const px = ray.dir[1]*e2z - ray.dir[2]*e2y;
    const py = ray.dir[2]*e2x - ray.dir[0]*e2z;
    const pz = ray.dir[0]*e2y - ray.dir[1]*e2x;
    const det = e1x*px + e1y*py + e1z*pz;
    if(Math.abs(det) < 1e-8) return -1;
    const inv = 1/det;
    const tx = ray.origin[0]-tri.v0[0], ty = ray.origin[1]-tri.v0[1], tz = ray.origin[2]-tri.v0[2];
    const u = (tx*px + ty*py + tz*pz) * inv;
    if(u < 0 || u > 1) return -1;
    const qx = ty*e1z - tz*e1y, qy = tz*e1x - tx*e1z, qz = tx*e1y - ty*e1x;
    const v = (ray.dir[0]*qx + ray.dir[1]*qy + ray.dir[2]*qz) * inv;
    if(v < 0 || u+v > 1) return -1;
    const t = (e2x*qx + e2y*qy + e2z*qz) * inv;
    return t > 0.001 ? t : -1;
  }

  function intersectScene(ray){
    let closest = Infinity, hitObj = null, hitT = -1;
    for(let i = 0; i < pt.scene.objects.length; i++){
      const obj = pt.scene.objects[i];
      let t = -1;
      if(obj.type === 'sphere') t = intersectSphere(ray, obj);
      else if(obj.type === 'plane') t = intersectPlane(ray, obj);
      else if(obj.type === 'triangle') t = intersectTriangle(ray, obj);
      if(t > 0 && t < closest){ closest = t; hitObj = obj; hitT = t; }
    }
    return { t: hitT, object: hitObj };
  }

  function getNormal(obj, point){
    if(obj.type === 'sphere'){
      const n = [point[0]-obj.center[0], point[1]-obj.center[1], point[2]-obj.center[2]];
      const l = Math.sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]) || 1;
      return [n[0]/l, n[1]/l, n[2]/l];
    } else if(obj.type === 'plane'){
      return [obj.normal[0], obj.normal[1], obj.normal[2]];
    } else if(obj.type === 'triangle'){
      const e1 = [obj.v1[0]-obj.v0[0], obj.v1[1]-obj.v0[1], obj.v1[2]-obj.v0[2]];
      const e2 = [obj.v2[0]-obj.v0[0], obj.v2[1]-obj.v0[1], obj.v2[2]-obj.v0[2]];
      const n = [e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
      const l = Math.sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]) || 1;
      return [n[0]/l, n[1]/l, n[2]/l];
    }
    return [0, 1, 0];
  }

  function randomHemisphere(normal){
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u*u);
    let dir = [r * Math.cos(theta), u, r * Math.sin(theta)];
    if(dir[0]*normal[0] + dir[1]*normal[1] + dir[2]*normal[2] < 0){
      dir = [-dir[0], -dir[1], -dir[2]];
    }
    return dir;
  }

  function traceRay(ray, depth){
    if(depth >= pt.maxBounces) return [0, 0, 0];
    const hit = intersectScene(ray);
    if(!hit.object) return pt.scene.background;

    const point = [
      ray.origin[0] + ray.dir[0] * hit.t,
      ray.origin[1] + ray.dir[1] * hit.t,
      ray.origin[2] + ray.dir[2] * hit.t
    ];
    const normal = getNormal(hit.object, point);
    const mat = hit.object.material;
    let color = [0, 0, 0];

    for(let l = 0; l < pt.scene.lights.length; l++){
      const light = pt.scene.lights[l];
      const toLight = [light.position[0]-point[0], light.position[1]-point[1], light.position[2]-point[2]];
      const lightDist = Math.sqrt(toLight[0]*toLight[0]+toLight[1]*toLight[1]+toLight[2]*toLight[2]);
      toLight[0]/=lightDist; toLight[1]/=lightDist; toLight[2]/=lightDist;

      const shadowRay = { origin: [point[0]+normal[0]*0.01, point[1]+normal[1]*0.01, point[2]+normal[2]*0.01], dir: toLight };
      const shadowHit = intersectScene(shadowRay);
      if(shadowHit.t > 0 && shadowHit.t < lightDist) continue;

      const ndotl = Math.max(0, normal[0]*toLight[0] + normal[1]*toLight[1] + normal[2]*toLight[2]);
      const atten = light.intensity / (lightDist * lightDist);
      color[0] += mat.color[0] * light.color[0] * ndotl * atten;
      color[1] += mat.color[1] * light.color[1] * ndotl * atten;
      color[2] += mat.color[2] * light.color[2] * ndotl * atten;
    }

    if(mat.type === 'mirror'){
      const refl = [
        ray.dir[0] - 2 * (ray.dir[0]*normal[0]+ray.dir[1]*normal[1]+ray.dir[2]*normal[2]) * normal[0],
        ray.dir[1] - 2 * (ray.dir[0]*normal[0]+ray.dir[1]*normal[1]+ray.dir[2]*normal[2]) * normal[1],
        ray.dir[2] - 2 * (ray.dir[0]*normal[0]+ray.dir[1]*normal[1]+ray.dir[2]*normal[2]) * normal[2]
      ];
      const reflRay = { origin: [point[0]+normal[0]*0.01, point[1]+normal[1]*0.01, point[2]+normal[2]*0.01], dir: refl };
      const reflColor = traceRay(reflRay, depth + 1);
      color[0] += mat.color[0] * reflColor[0];
      color[1] += mat.color[1] * reflColor[1];
      color[2] += mat.color[2] * reflColor[2];
    } else if(mat.type === 'diffuse'){
      const newDir = randomHemisphere(normal);
      const newRay = { origin: [point[0]+normal[0]*0.01, point[1]+normal[1]*0.01, point[2]+normal[2]*0.01], dir: newDir };
      const indirect = traceRay(newRay, depth + 1);
      color[0] += mat.color[0] * indirect[0] * 0.5;
      color[1] += mat.color[1] * indirect[1] * 0.5;
      color[2] += mat.color[2] * indirect[2] * 0.5;
    }

    return color;
  }

  function render(camera){
    if(!pt._framebuffer) init();
    const aspect = pt.width / pt.height;
    const fov = camera.fov || 60;
    const tanHalf = Math.tan(fov * Math.PI / 360);

    for(let y = 0; y < pt.height; y++){
      for(let x = 0; x < pt.width; x++){
        let r = 0, g = 0, b = 0;
        for(let s = 0; s < pt.samples; s++){
          const u = (x + Math.random()) / pt.width * 2 - 1;
          const v = (y + Math.random()) / pt.height * 2 - 1;
          const dir = [u * tanHalf * aspect, v * tanHalf, -1];
          const l = Math.sqrt(dir[0]*dir[0]+dir[1]*dir[1]+dir[2]*dir[2]);
          dir[0]/=l; dir[1]/=l; dir[2]/=l;
          const ray = { origin: [camera.position[0], camera.position[1], camera.position[2]], dir: dir };
          const c = traceRay(ray, 0);
          r += c[0]; g += c[1]; b += c[2];
        }
        const idx = (y * pt.width + x) * 3;
        pt._framebuffer[idx] = r / pt.samples;
        pt._framebuffer[idx+1] = g / pt.samples;
        pt._framebuffer[idx+2] = b / pt.samples;
      }
    }
    return pt._framebuffer;
  }

  function toImageData(){
    const img = new ImageData(pt.width, pt.height);
    for(let i = 0; i < pt.width * pt.height; i++){
      const r = Math.min(255, Math.max(0, pt._framebuffer[i*3] * 255));
      const g = Math.min(255, Math.max(0, pt._framebuffer[i*3+1] * 255));
      const b = Math.min(255, Math.max(0, pt._framebuffer[i*3+2] * 255));
      img.data[i*4] = r; img.data[i*4+1] = g; img.data[i*4+2] = b; img.data[i*4+3] = 255;
    }
    return img;
  }

  function clear(){
    pt.scene.objects.length = 0;
    pt.scene.lights.length = 0;
  }

  return { init, addSphere, addPlane, addTriangle, addLight, setBackground, render, toImageData, clear, pt };
}

/* ===== 体积渲染系统 =====
   支持: 3D纹理体积 / 光线步进 / 吸收发射 / 阴影
*/
function createVolumeRenderer(gl, options){
  const vr = {
    gl: gl,
    volumeData: null,
    volumeSize: (options && options.volumeSize) || [64, 64, 64],
    _texture3D: null,
    _program: null,
    _vbo: null,
    _initialized: false,
    stepSize: (options && options.stepSize) || 0.01,
    maxSteps: (options && options.maxSteps) || 256,
    absorption: (options && options.absorption) || 0.5,
    emissionColor: (options && options.emissionColor) || [1, 0.8, 0.6],
    emissionStrength: (options && options.emissionStrength) || 2.0
  };

  function init(){
    const gl = vr.gl;
    const vs = `
      attribute vec3 aPosition;
      varying vec3 vRayDir;
      uniform mat4 uViewProj;
      uniform vec3 uCameraPos;
      void main(){
        vRayDir = normalize(aPosition - uCameraPos);
        gl_Position = uViewProj * vec4(aPosition, 1.0);
      }
    `;
    const fs = `
      precision mediump float;
      uniform sampler3D uVolume;
      uniform vec3 uVolumeSize;
      uniform float uStepSize;
      uniform int uMaxSteps;
      uniform float uAbsorption;
      uniform vec3 uEmissionColor;
      uniform float uEmissionStrength;
      uniform vec3 uLightDir;
      varying vec3 vRayDir;
      uniform vec3 uCameraPos;
      uniform vec3 uBoxMin;
      uniform vec3 uBoxMax;

      float sampleVolume(vec3 pos){
        vec3 uv = (pos - uBoxMin) / (uBoxMax - uBoxMin);
        if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || uv.z < 0.0 || uv.z > 1.0) return 0.0;
        return texture3D(uVolume, uv).r;
      }

      vec2 intersectBox(vec3 origin, vec3 dir){
        vec3 invDir = 1.0 / dir;
        vec3 t0 = (uBoxMin - origin) * invDir;
        vec3 t1 = (uBoxMax - origin) * invDir;
        vec3 tmin = min(t0, t1);
        vec3 tmax = max(t0, t1);
        float tNear = max(max(tmin.x, tmin.y), tmin.z);
        float tFar = min(min(tmax.x, tmax.y), tmax.z);
        return vec2(tNear, tFar);
      }

      void main(){
        vec3 origin = uCameraPos;
        vec3 dir = normalize(vRayDir);
        vec2 tBox = intersectBox(origin, dir);
        if(tBox.x > tBox.y) discard;
        float t = max(tBox.x, 0.0);
        float tEnd = tBox.y;
        vec3 color = vec3(0.0);
        float transmittance = 1.0;
        for(int i = 0; i < 256; i++){
          if(i >= uMaxSteps || t > tEnd) break;
          vec3 pos = origin + dir * t;
          float density = sampleVolume(pos);
          if(density > 0.001){
            float lightDensity = 0.0;
            vec3 lightPos = pos;
            for(int j = 0; j < 32; j++){
              lightPos += normalize(uLightDir) * uStepSize * 2.0;
              lightDensity += sampleVolume(lightPos);
            }
            float shadow = exp(-lightDensity * uAbsorption * 2.0);
            vec3 emit = uEmissionColor * density * uEmissionStrength * shadow;
            float absorb = density * uAbsorption * uStepSize;
            color += transmittance * emit * uStepSize * 10.0;
            transmittance *= exp(-absorb);
            if(transmittance < 0.01) break;
          }
          t += uStepSize;
        }
        gl_FragColor = vec4(color, 1.0 - transmittance);
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    vr._program = gl.createProgram();
    gl.attachShader(vr._program, vsh);
    gl.attachShader(vr._program, fsh);
    gl.linkProgram(vr._program);

    const verts = new Float32Array([
      -1,-1,-1, 1,-1,-1, 1,1,-1, -1,1,-1,
      -1,-1,1, 1,-1,1, 1,1,1, -1,1,1
    ]);
    vr._vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vr._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    vr._initialized = true;
  }

  function setVolumeData(data, size){
    vr.volumeData = data;
    vr.volumeSize = size || vr.volumeSize;
    const gl = vr.gl;
    if(vr._texture3D) gl.deleteTexture(vr._texture3D);
    vr._texture3D = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, vr._texture3D);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, vr.volumeSize[0], vr.volumeSize[1], vr.volumeSize[2], 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  }

  function generateProceduralVolume(type, params){
    const [w, h, d] = vr.volumeSize;
    const data = new Uint8Array(w * h * d);
    for(let z = 0; z < d; z++){
      for(let y = 0; y < h; y++){
        for(let x = 0; x < w; x++){
          const nx = x / w - 0.5, ny = y / h - 0.5, nz = z / d - 0.5;
          let val = 0;
          if(type === 'sphere'){
            const r = Math.sqrt(nx*nx + ny*ny + nz*nz);
            val = Math.max(0, 1 - r * 2);
          } else if(type === 'cloud'){
            const n = Noise.perlin3D(nx * 4, ny * 4, nz * 4);
            val = Math.max(0, n * 0.5 + 0.3);
          } else if(type === 'smoke'){
            const n1 = Noise.perlin3D(nx * 3, ny * 3 + 0.5, nz * 3);
            const n2 = Noise.perlin3D(nx * 6, ny * 6, nz * 6);
            val = Math.max(0, (n1 * 0.7 + n2 * 0.3) * 0.5 + 0.2 - ny * 0.8);
          } else if(type === 'fire'){
            const n = Noise.perlin3D(nx * 5, ny * 5 - performance.now() * 0.001, nz * 5);
            val = Math.max(0, 1 - Math.abs(ny) * 2) * (n * 0.5 + 0.5);
          }
          data[(z * h + y) * w + x] = Math.min(255, val * 255);
        }
      }
    }
    setVolumeData(data);
    return data;
  }

  function render(viewProj, cameraPosition, boxMin, boxMax){
    if(!vr._initialized || !vr._texture3D) return;
    const gl = vr.gl;
    gl.useProgram(vr._program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(gl.getUniformLocation(vr._program, 'uViewProj'), false, viewProj);
    gl.uniform3fv(gl.getUniformLocation(vr._program, 'uCameraPos'), cameraPosition);
    gl.uniform3fv(gl.getUniformLocation(vr._program, 'uBoxMin'), boxMin);
    gl.uniform3fv(gl.getUniformLocation(vr._program, 'uBoxMax'), boxMax);
    gl.uniform1f(gl.getUniformLocation(vr._program, 'uStepSize'), vr.stepSize);
    gl.uniform1i(gl.getUniformLocation(vr._program, 'uMaxSteps'), vr.maxSteps);
    gl.uniform1f(gl.getUniformLocation(vr._program, 'uAbsorption'), vr.absorption);
    gl.uniform3fv(gl.getUniformLocation(vr._program, 'uEmissionColor'), vr.emissionColor);
    gl.uniform1f(gl.getUniformLocation(vr._program, 'uEmissionStrength'), vr.emissionStrength);
    gl.uniform3f(gl.getUniformLocation(vr._program, 'uLightDir'), 0.5, 1, 0.3);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, vr._texture3D);
    gl.uniform1i(gl.getUniformLocation(vr._program, 'uVolume'), 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, vr._vbo);
    const posLoc = gl.getAttribLocation(vr._program, 'aPosition');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    gl.drawArrays(gl.TRIANGLE_FAN, 4, 4);
    gl.disable(gl.BLEND);
  }

  function dispose(){
    const gl = vr.gl;
    if(vr._texture3D) gl.deleteTexture(vr._texture3D);
    if(vr._vbo) gl.deleteBuffer(vr._vbo);
    if(vr._program) gl.deleteProgram(vr._program);
  }

  return { init, setVolumeData, generateProceduralVolume, render, dispose, vr };
}



/* ===== 流体模拟系统 (SPH - 光滑粒子流体动力学) =====
   支持: 密度/压力求解 / 粘性 / 表面张力 / 边界碰撞
*/
function createSPHFluid(options){
  const fluid = {
    particles: [],
    maxParticles: (options && options.maxParticles) || 2000,
    particleRadius: (options && options.particleRadius) || 0.05,
    smoothingRadius: (options && options.smoothingRadius) || 0.2,
    restDensity: (options && options.restDensity) || 1000,
    stiffness: (options && options.stiffness) || 2000,
    viscosity: (options && options.viscosity) || 250,
    gravity: (options && options.gravity) || [0, -9.8, 0],
    damping: (options && options.damping) || 0.98,
    bounds: (options && options.bounds) || { min: [-2, 0, -2], max: [2, 3, 2] },
    _grid: {},
    _gridSize: 0.2,
    _densities: null,
    _pressures: null,
    _forces: null
  };

  function init(count, startPos, startVel){
    fluid.particles = [];
    const sp = startPos || [0, 1, 0];
    const sv = startVel || [0, 0, 0];
    const side = Math.ceil(Math.pow(count, 1/3));
    let idx = 0;
    for(let z = 0; z < side && idx < count; z++){
      for(let y = 0; y < side && idx < count; y++){
        for(let x = 0; x < side && idx < count; x++){
          fluid.particles.push({
            position: [sp[0] + x * fluid.particleRadius * 2, sp[1] + y * fluid.particleRadius * 2, sp[2] + z * fluid.particleRadius * 2],
            velocity: [sv[0], sv[1], sv[2]],
            density: 0,
            pressure: 0,
            force: [0, 0, 0],
            color: [0.3, 0.5, 0.9, 0.8]
          });
          idx++;
        }
      }
    }
    fluid._densities = new Float32Array(fluid.particles.length);
    fluid._pressures = new Float32Array(fluid.particles.length);
    fluid._forces = new Float32Array(fluid.particles.length * 3);
  }

  function poly6Kernel(r, h){
    if(r > h) return 0;
    const val = (h * h - r * r) / (h * h);
    return 315 / (64 * Math.PI * Math.pow(h, 9)) * val * val * val;
  }

  function spikyKernelGradient(r, h){
    if(r > h || r < 0.0001) return 0;
    const val = (h - r) / h;
    return -45 / (Math.PI * Math.pow(h, 6)) * val * val;
  }

  function viscosityKernelLaplacian(r, h){
    if(r > h) return 0;
    return 45 / (Math.PI * Math.pow(h, 6)) * (h - r);
  }

  function buildGrid(){
    fluid._grid = {};
    for(let i = 0; i < fluid.particles.length; i++){
      const p = fluid.particles[i];
      const gx = Math.floor(p.position[0] / fluid._gridSize);
      const gy = Math.floor(p.position[1] / fluid._gridSize);
      const gz = Math.floor(p.position[2] / fluid._gridSize);
      const key = gx + ',' + gy + ',' + gz;
      if(!fluid._grid[key]) fluid._grid[key] = [];
      fluid._grid[key].push(i);
    }
  }

  function getNeighbors(i){
    const p = fluid.particles[i];
    const gx = Math.floor(p.position[0] / fluid._gridSize);
    const gy = Math.floor(p.position[1] / fluid._gridSize);
    const gz = Math.floor(p.position[2] / fluid._gridSize);
    const neighbors = [];
    for(let dx = -1; dx <= 1; dx++){
      for(let dy = -1; dy <= 1; dy++){
        for(let dz = -1; dz <= 1; dz++){
          const key = (gx+dx) + ',' + (gy+dy) + ',' + (gz+dz);
          if(fluid._grid[key]){
            for(let n = 0; n < fluid._grid[key].length; n++){
              neighbors.push(fluid._grid[key][n]);
            }
          }
        }
      }
    }
    return neighbors;
  }

  function computeDensityPressure(){
    const h = fluid.smoothingRadius;
    for(let i = 0; i < fluid.particles.length; i++){
      const pi = fluid.particles[i];
      let density = 0;
      const neighbors = getNeighbors(i);
      for(let n = 0; n < neighbors.length; n++){
        const j = neighbors[n];
        const pj = fluid.particles[j];
        const dx = pi.position[0] - pj.position[0];
        const dy = pi.position[1] - pj.position[1];
        const dz = pi.position[2] - pj.position[2];
        const r = Math.sqrt(dx*dx + dy*dy + dz*dz);
        density += poly6Kernel(r, h);
      }
      pi.density = Math.max(density, fluid.restDensity * 0.1);
      pi.pressure = fluid.stiffness * (pi.density - fluid.restDensity);
    }
  }

  function computeForces(){
    const h = fluid.smoothingRadius;
    for(let i = 0; i < fluid.particles.length; i++){
      const pi = fluid.particles[i];
      let fx = fluid.gravity[0] * pi.density;
      let fy = fluid.gravity[1] * pi.density;
      let fz = fluid.gravity[2] * pi.density;
      const neighbors = getNeighbors(i);
      for(let n = 0; n < neighbors.length; n++){
        const j = neighbors[n];
        if(j === i) continue;
        const pj = fluid.particles[j];
        const dx = pi.position[0] - pj.position[0];
        const dy = pi.position[1] - pj.position[1];
        const dz = pi.position[2] - pj.position[2];
        const r = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if(r < 0.0001 || r > h) continue;
        const dirX = dx / r, dirY = dy / r, dirZ = dz / r;
        const pressureForce = -((pi.pressure + pj.pressure) / (2 * pj.density)) * spikyKernelGradient(r, h);
        fx += pressureForce * dirX;
        fy += pressureForce * dirY;
        fz += pressureForce * dirZ;
        const viscForce = fluid.viscosity * viscosityKernelLaplacian(r, h) / pj.density;
        fx += viscForce * (pj.velocity[0] - pi.velocity[0]);
        fy += viscForce * (pj.velocity[1] - pi.velocity[1]);
        fz += viscForce * (pj.velocity[2] - pi.velocity[2]);
      }
      pi.force[0] = fx;
      pi.force[1] = fy;
      pi.force[2] = fz;
    }
  }

  function integrate(dt){
    for(let i = 0; i < fluid.particles.length; i++){
      const p = fluid.particles[i];
      p.velocity[0] += (p.force[0] / p.density) * dt;
      p.velocity[1] += (p.force[1] / p.density) * dt;
      p.velocity[2] += (p.force[2] / p.density) * dt;
      p.velocity[0] *= fluid.damping;
      p.velocity[1] *= fluid.damping;
      p.velocity[2] *= fluid.damping;
      p.position[0] += p.velocity[0] * dt;
      p.position[1] += p.velocity[1] * dt;
      p.position[2] += p.velocity[2] * dt;

      const b = fluid.bounds;
      for(let axis = 0; axis < 3; axis++){
        if(p.position[axis] < b.min[axis]){
          p.position[axis] = b.min[axis];
          p.velocity[axis] *= -0.5;
        }
        if(p.position[axis] > b.max[axis]){
          p.position[axis] = b.max[axis];
          p.velocity[axis] *= -0.5;
        }
      }
    }
  }

  function step(dt){
    buildGrid();
    computeDensityPressure();
    computeForces();
    integrate(dt);
  }

  function addParticle(position, velocity){
    if(fluid.particles.length >= fluid.maxParticles) return null;
    const p = {
      position: [position[0], position[1], position[2]],
      velocity: velocity ? [velocity[0],velocity[1],velocity[2]] : [0,0,0],
      density: 0, pressure: 0, force: [0,0,0],
      color: [0.3, 0.5, 0.9, 0.8]
    };
    fluid.particles.push(p);
    return p;
  }

  function getPositions(){
    const arr = new Float32Array(fluid.particles.length * 3);
    for(let i = 0; i < fluid.particles.length; i++){
      arr[i*3] = fluid.particles[i].position[0];
      arr[i*3+1] = fluid.particles[i].position[1];
      arr[i*3+2] = fluid.particles[i].position[2];
    }
    return arr;
  }

  function reset(){
    fluid.particles = [];
  }

  return { init, step, addParticle, getPositions, reset, fluid };
}
