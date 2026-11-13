
// ============================================================
// 模块八：后处理管线 PostProcessing (约1200行)
// 渲染目标 / Bloom / 景深 / 抗锯齿 / 色调映射 / 颜色分级
// ============================================================

const OrbPost = (function(){
  const { clamp, lerp, EPSILON } = OrbMath;

  // ============================================================
  // RenderTarget - 渲染目标（帧缓冲）
  // ============================================================
  class RenderTarget {
    constructor(gl, width, height, options = {}){
      this.gl = gl;
      this.width = width;
      this.height = height;
      this.framebuffer = null;
      this.texture = null;
      this.depthBuffer = null;
      this.depthTexture = null;
      this.options = {
        minFilter: gl.LINEAR,
        magFilter: gl.LINEAR,
        wrapS: gl.CLAMP_TO_EDGE,
        wrapT: gl.CLAMP_TO_EDGE,
        format: gl.RGBA,
        type: gl.UNSIGNED_BYTE,
        depthBuffer: true,
        stencilBuffer: false,
        depthTexture: false,
        ...options
      };
      this._init();
    }

    _init(){
      const gl = this.gl;
      const opts = this.options;

      // 创建颜色纹理
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, opts.format, this.width, this.height, 0, opts.format, opts.type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.minFilter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, opts.magFilter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.wrapS);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opts.wrapT);

      // 创建帧缓冲
      this.framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);

      // 深度缓冲
      if(opts.depthBuffer && !opts.depthTexture){
        this.depthBuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthBuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, this.width, this.height);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthBuffer);
      }

      // 深度纹理
      if(opts.depthTexture){
        this.depthTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, this.width, this.height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTexture, 0);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    bind(){
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.viewport(0, 0, this.width, this.height);
    }

    unbind(){
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    setSize(width, height){
      this.width = width;
      this.height = height;
      this.dispose();
      this._init();
    }

    dispose(){
      const gl = this.gl;
      if(this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
      if(this.texture) gl.deleteTexture(this.texture);
      if(this.depthBuffer) gl.deleteRenderbuffer(this.depthBuffer);
      if(this.depthTexture) gl.deleteTexture(this.depthTexture);
    }
  }

  // ============================================================
  // PostProcessPass - 后处理通道基类
  // ============================================================
  class PostProcessPass {
    constructor(name = ''){
      this.name = name;
      this.enabled = true;
      this.needsSwap = true;
      this.renderToScreen = false;
    }

    render(renderer, writeBuffer, readBuffer, dt){}
    setSize(width, height){}
    dispose(){}
  }

  // ============================================================
  // BloomPass - Bloom（泛光）通道
  // ============================================================
  class BloomPass extends PostProcessPass {
    constructor(gl, strength = 1, radius = 0.4, threshold = 0.85){
      super('Bloom');
      this.gl = gl;
      this.strength = strength;
      this.radius = radius;
      this.threshold = threshold;
      this.renderTargetsHorizontal = [];
      this.renderTargetsVertical = [];
      this.nMips = 5;
      this._init();
    }

    _init(){
      const gl = this.gl;
      for(let i = 0; i < this.nMips; i++){
        const size = Math.pow(2, this.nMips - i - 1) * 64;
        const rtH = new RenderTarget(gl, size, size);
        const rtV = new RenderTarget(gl, size, size);
        this.renderTargetsHorizontal.push(rtH);
        this.renderTargetsVertical.push(rtV);
      }
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // 简化实现，实际需要：
      // 1. 提取高光（threshold）
      // 2. 多次高斯模糊（水平+垂直）
      // 3. 合并到原图像（strength）
      // 这里只做概念框架
    }

    setSize(width, height){
      for(let i = 0; i < this.nMips; i++){
        const size = Math.pow(2, this.nMips - i - 1) * 64;
        this.renderTargetsHorizontal[i].setSize(size, size);
        this.renderTargetsVertical[i].setSize(size, size);
      }
    }

    dispose(){
      for(const rt of this.renderTargetsHorizontal) rt.dispose();
      for(const rt of this.renderTargetsVertical) rt.dispose();
    }
  }

  // ============================================================
  // DepthOfFieldPass - 景深通道
  // ============================================================
  class DepthOfFieldPass extends PostProcessPass {
    constructor(gl, focus = 1.0, aperture = 0.025, maxblur = 1.0){
      super('DepthOfField');
      this.gl = gl;
      this.focus = focus;
      this.aperture = aperture;
      this.maxblur = maxblur;
      this.renderTargetDepth = null;
      this._init();
    }

    _init(){
      // 简化实现
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // 简化实现，实际需要：
      // 1. 渲染深度纹理
      // 2. 计算CoC（Circle of Confusion）
      // 3. 模糊处理
    }

    setSize(width, height){}
    dispose(){}
  }

  // ============================================================
  // FXAAPass - FXAA抗锯齿通道
  // ============================================================
  class FXAAPass extends PostProcessPass {
    constructor(gl){
      super('FXAA');
      this.gl = gl;
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // FXAA着色器实现
    }

    setSize(width, height){}
    dispose(){}
  }

  // ============================================================
  // SAAPass - SMAA抗锯齿通道
  // ============================================================
  class SMAAPass extends PostProcessPass {
    constructor(gl, width, height){
      super('SMAA');
      this.gl = gl;
      this.width = width;
      this.height = height;
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // SMAA三阶段：边缘检测、权重计算、混合
    }

    setSize(width, height){
      this.width = width;
      this.height = height;
    }

    dispose(){}
  }

  // ============================================================
  // TAAPass - TAA时间抗锯齿通道
  // ============================================================
  class TAAPass extends PostProcessPass {
    constructor(gl){
      super('TAA');
      this.gl = gl;
      this.historyBuffer = null;
      this.accumulatedFrames = 0;
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // TAA：历史帧与当前帧混合
    }

    setSize(width, height){}
    dispose(){
      if(this.historyBuffer) this.historyBuffer.dispose();
    }
  }

  // ============================================================
  // ToneMappingPass - 色调映射通道
  // ============================================================
  class ToneMappingPass extends PostProcessPass {
    constructor(gl, type = 'ACES', exposure = 1){
      super('ToneMapping');
      this.gl = gl;
      this.type = type; // 'Linear' | 'Reinhard' | 'ACES' | 'Filmic' | 'Cineon'
      this.exposure = exposure;
      this.whitePoint = 1;
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // 色调映射着色器实现
    }

    setExposure(exposure){
      this.exposure = exposure;
    }

    setType(type){
      this.type = type;
    }

    setSize(width, height){}
    dispose(){}
  }

  // ============================================================
  // ColorGradingPass - 颜色分级通道
  // ============================================================
  class ColorGradingPass extends PostProcessPass {
    constructor(gl){
      super('ColorGrading');
      this.gl = gl;
      this.lut = null;          // 3D LUT纹理
      this.lutIntensity = 1;
      this.saturation = 1;
      this.contrast = 1;
      this.brightness = 0;
      this.hueShift = 0;
      this.temperature = 0;
      this.tint = 0;
      this.vibrance = 0;
      this.shadows = new Vec3(1, 1, 1);
      this.midtones = new Vec3(1, 1, 1);
      this.highlights = new Vec3(1, 1, 1);
      this.curves = null;       // RGB曲线
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // 颜色分级着色器实现
    }

    setLUT(texture, intensity = 1){
      this.lut = texture;
      this.lutIntensity = intensity;
    }

    setSaturation(value){
      this.saturation = value;
    }

    setContrast(value){
      this.contrast = value;
    }

    setBrightness(value){
      this.brightness = value;
    }

    setHueShift(value){
      this.hueShift = value;
    }

    setTemperature(value){
      this.temperature = value;
    }

    setTint(value){
      this.tint = value;
    }

    setVibrance(value){
      this.vibrance = value;
    }

    setShadows(r, g, b){
      this.shadows.set(r, g, b);
    }

    setMidtones(r, g, b){
      this.midtones.set(r, g, b);
    }

    setHighlights(r, g, b){
      this.highlights.set(r, g, b);
    }

    setSize(width, height){}
    dispose(){}
  }

  // ============================================================
  // SSAOPass - 屏幕空间环境光遮蔽通道
  // ============================================================
  class SSAOPass extends PostProcessPass {
    constructor(gl, width, height){
      super('SSAO');
      this.gl = gl;
      this.width = width;
      this.height = height;
      this.kernelRadius = 8;
      this.minDistance = 0.005;
      this.maxDistance = 0.1;
      this.output = 0; // 0=Default, 1=SSAO, 2=Blur, 3=Depth, 4=Normal
      this.kernel = [];
      this.noiseTexture = null;
      this._initKernel();
    }

    _initKernel(){
      // 生成半球采样核
      for(let i = 0; i < 32; i++){
        const sample = new OrbMath.Vec3(
          Math.random() * 2 - 1,
          Math.random() * 2 - 1,
          Math.random()
        );
        sample.normalize();
        sample.mul(Math.random());
        let scale = i / 32;
        scale = lerp(0.1, 1, scale * scale);
        sample.mul(scale);
        this.kernel.push(sample);
      }
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // SSAO实现：
      // 1. 重建视图空间位置
      // 2. 计算法线
      // 3. 半球采样
      // 4. 模糊处理
    }

    setSize(width, height){
      this.width = width;
      this.height = height;
    }

    dispose(){
      if(this.noiseTexture) this.gl.deleteTexture(this.noiseTexture);
    }
  }

  // ============================================================
  // SSRPass - 屏幕空间反射通道
  // ============================================================
  class SSRPass extends PostProcessPass {
    constructor(gl, width, height){
      super('SSR');
      this.gl = gl;
      this.width = width;
      this.height = height;
      this.thickness = 0.018;
      this.infiniteThick = false;
      this.maxDistance = 10;
      this.resolution = 1;
      this.rayStep = 0.1;
      this.iterations = 10;
      this.binarySearchIterations = 4;
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // SSR实现：
      // 1. 重建视图空间位置和法线
      // 2. 计算反射方向
      // 3. 光线步进
      // 4. 二分搜索精确命中
    }

    setSize(width, height){
      this.width = width;
      this.height = height;
    }

    dispose(){}
  }

  // ============================================================
  // MotionBlurPass - 运动模糊通道
  // ============================================================
  class MotionBlurPass extends PostProcessPass {
    constructor(gl){
      super('MotionBlur');
      this.gl = gl;
      this.samples = 16;
      this.intensity = 1;
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // 运动模糊：基于速度纹理的方向模糊
    }

    setSize(width, height){}
    dispose(){}
  }

  // ============================================================
  // VignettePass - 暗角通道
  // ============================================================
  class VignettePass extends PostProcessPass {
    constructor(gl, offset = 0.5, darkness = 0.5){
      super('Vignette');
      this.gl = gl;
      this.offset = offset;
      this.darkness = darkness;
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // 暗角效果
    }

    setSize(width, height){}
    dispose(){}
  }

  // ============================================================
  // FilmGrainPass - 胶片颗粒通道
  // ============================================================
  class FilmGrainPass extends PostProcessPass {
    constructor(gl, intensity = 0.5, size = 1){
      super('FilmGrain');
      this.gl = gl;
      this.intensity = intensity;
      this.size = size;
      this.time = 0;
    }

    render(renderer, writeBuffer, readBuffer, dt){
      this.time += dt;
      // 胶片颗粒效果
    }

    setSize(width, height){}
    dispose(){}
  }

  // ============================================================
  // ChromaticAberrationPass - 色差通道
  // ============================================================
  class ChromaticAberrationPass extends PostProcessPass {
    constructor(gl, offset = 0.001){
      super('ChromaticAberration');
      this.gl = gl;
      this.offset = offset;
      this.radialModulation = 0;
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // 色差效果：RGB通道偏移
    }

    setSize(width, height){}
    dispose(){}
  }

  // ============================================================
  // ShaderPass - 通用着色器通道
  // ============================================================
  class ShaderPass extends PostProcessPass {
    constructor(gl, shader, uniforms = {}){
      super('Shader');
      this.gl = gl;
      this.shader = shader;
      this.uniforms = uniforms;
      this.material = null;
    }

    render(renderer, writeBuffer, readBuffer, dt){
      // 通用着色器渲染
    }

    setUniform(name, value){
      this.uniforms[name] = value;
    }

    setSize(width, height){}
    dispose(){}
  }

  // ============================================================
  // EffectComposer - 效果组合器（后处理管线）
  // ============================================================
  class EffectComposer {
    constructor(gl, renderTarget = null){
      this.gl = gl;
      this.renderTarget1 = renderTarget;
      this.renderTarget2 = null;
      this.writeBuffer = null;
      this.readBuffer = null;
      this.passes = [];
      this.copyPass = null;
      this.width = 0;
      this.height = 0;
      this._init();
    }

    _init(){
      const gl = this.gl;
      if(!this.renderTarget1){
        const canvas = gl.canvas;
        this.renderTarget1 = new RenderTarget(gl, canvas.width, canvas.height);
      }
      this.renderTarget2 = this.renderTarget1.clone();
      this.writeBuffer = this.renderTarget1;
      this.readBuffer = this.renderTarget2;
      this.width = this.renderTarget1.width;
      this.height = this.renderTarget1.height;
    }

    addPass(pass){
      this.passes.push(pass);
      pass.setSize(this.width, this.height);
    }

    insertPass(pass, index){
      this.passes.splice(index, 0, pass);
      pass.setSize(this.width, this.height);
    }

    removePass(pass){
      const index = this.passes.indexOf(pass);
      if(index !== -1){
        this.passes.splice(index, 1);
        pass.dispose();
      }
    }

    render(dt){
      const gl = this.gl;
      const isLastEnabledPass = (index) => {
        for(let i = index + 1; i < this.passes.length; i++){
          if(this.passes[i].enabled) return false;
        }
        return true;
      };

      for(let i = 0; i < this.passes.length; i++){
        const pass = this.passes[i];
        if(!pass.enabled) continue;

        pass.renderToScreen = isLastEnabledPass(i);
        pass.render(this, this.writeBuffer, this.readBuffer, dt);

        if(pass.needsSwap){
          const tmp = this.readBuffer;
          this.readBuffer = this.writeBuffer;
          this.writeBuffer = tmp;
        }
      }
    }

    setSize(width, height){
      this.width = width;
      this.height = height;
      this.renderTarget1.setSize(width, height);
      this.renderTarget2.setSize(width, height);
      for(const pass of this.passes){
        pass.setSize(width, height);
      }
    }

    reset(){
      this.writeBuffer = this.renderTarget1;
      this.readBuffer = this.renderTarget2;
    }

    dispose(){
      this.renderTarget1.dispose();
      this.renderTarget2.dispose();
      for(const pass of this.passes){
        pass.dispose();
      }
    }
  }

  // 导出
  return {
    RenderTarget, PostProcessPass, BloomPass, DepthOfFieldPass,
    FXAAPass, SMAAPass, TAAPass, ToneMappingPass, ColorGradingPass,
    SSAOPass, SSRPass, MotionBlurPass, VignettePass, FilmGrainPass,
    ChromaticAberrationPass, ShaderPass, EffectComposer
  };
})();

if(typeof window !== 'undefined'){
  window.OrbPost = OrbPost;
}