/* VRM character pass for the 3D ground-grid scene.
   It draws into its own transparent WebGL2 canvas and shares the scene's
   viewProjection, so the model stands on the same y=0 grid as the nodes. */
(function (global) {
  "use strict";

  var NS = global.AEVUM = global.AEVUM || {};
  var sceneNS = NS.scene = NS.scene || {};

  function attach(options) {
    var mount = options.mount;
    var scene = options.scene;
    var slotId = options.slotId || "host";
    var url = options.modelUrl;
    if (!mount || !scene || !url) throw new Error("scene-vrm: mount, scene and modelUrl are required");
    if (mount.__aevumVrm) return mount.__aevumVrm;

    var math = NS.math;
    var Render = NS.render || {};
    var formats = NS.formats || {};
    if (!math || !Render.VRMRenderer || !formats.parseVRM) {
      throw new Error("scene-vrm: VRM renderer or parser is not loaded");
    }

    var canvas = document.createElement("canvas");
    canvas.className = "scene3d__characters";
    canvas.setAttribute("aria-hidden", "true");
    var characterMount = options.characterMount || mount;
    var overlay = mount.querySelector(".scene3d__overlay");
    if (overlay && characterMount === mount) mount.insertBefore(canvas, overlay);
    else characterMount.appendChild(canvas);

    var renderer = null;
    var vrm = null;
    var modelMatrix = null;
    var home = scene.slotWorld(slotId);
    var position = home ? [home[0], 0, home[2]] : [0, 0, 0];
    var target = null;
    var baseYaw = Number(options.yaw) || 0;
    var yaw = baseYaw;
    var speed = options.speed == null ? 1.8 : Math.max(0.2, Number(options.speed));
    var moving = false;
    var metrics = null;
    var look = options.look || null;
    var bindings = null;
    var startedAt = 0;
    var actionGLB = null;
    var actionPlayer = null;
    var actionReady = false;
    var actionPromise = null;
    var actionUrl = options.actionUrl ||
      (global.AEVUM_MODEL_CONFIG && global.AEVUM_MODEL_CONFIG.actions) ||
      "";
    var walkLegFilter = Object.create(null);
    var walkArmLimit = Object.create(null);
    var runMode = false;
    var runSpeed = options.runSpeed == null ? 3.2 : Math.max(0.2, Number(options.runSpeed));
    var runDistance = options.runDistance == null ? 5 : Math.max(0.5, Number(options.runDistance));
    var lighting = options.lighting || {
      direction: [0.35, 0.85, 0.42],
      color: [0.78, 0.74, 0.66],
      ambient: [0.22, 0.24, 0.3],
      rim: [0.55, 0.78, 1],
      rimStrength: 0.2,
      specular: 0.08
    };
    var state = {
      status: "loading",
      renderer: null,
      vrm: null,
      label: "角色位 01",
      title: "",
      position: position.slice(),
      moving: false,
      running: false
    };

    function setStatus(text) {
      if (scene.setStatus) scene.setStatus(text);
    }

    function lerpAngle(from, to, alpha) {
      var delta = (to - from + Math.PI) % (Math.PI * 2);
      if (delta < 0) delta += Math.PI * 2;
      delta -= Math.PI;
      return from + delta * alpha;
    }

    function metricsFor(rendererInstance) {
      var b = rendererInstance.bounds;
      var height = b.max[1] - b.min[1];
      if (!height || !isFinite(height)) height = 1;
      return {
        scale: (options.height || 1.75) / height,
        center: [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2]
      };
    }

    function placeMatrix(point, m, angle) {
      var matrix = math.M4.create();
      var c = Math.cos(angle);
      var s = Math.sin(angle);
      var scale = m.scale;
      var center = m.center;
      matrix[0] = c * scale;
      matrix[1] = 0;
      matrix[2] = -s * scale;
      matrix[3] = 0;
      matrix[4] = 0;
      matrix[5] = scale;
      matrix[6] = 0;
      matrix[7] = 0;
      matrix[8] = s * scale;
      matrix[9] = 0;
      matrix[10] = c * scale;
      matrix[11] = 0;
      matrix[12] = point[0] - (c * scale * center[0] + s * scale * center[2]);
      matrix[13] = point[1] - scale * center[1];
      matrix[14] = point[2] - (-s * scale * center[0] + c * scale * center[2]);
      matrix[15] = 1;
      return matrix;
    }

    function step(dt) {
      var stepDt = dt || 0;
      var wasMoving = moving;
      var wasRunning = moving && runMode;
      if (target) {
        var dx = target[0] - position[0];
        var dz = target[2] - position[2];
        var distance = Math.sqrt(dx * dx + dz * dz);
        if (distance > 0.01) {
          var distanceStep = Math.min(distance, (runMode ? runSpeed : speed) * Math.max(stepDt, 0.001));
          position[0] += dx / distance * distanceStep;
          position[2] += dz / distance * distanceStep;
          var desiredYaw = baseYaw + Math.atan2(dx, dz);
          yaw = lerpAngle(yaw, desiredYaw, 1 - Math.exp(-Math.max(stepDt, 0.001) * 7));
          moving = true;
        } else {
          position[0] = target[0];
          position[2] = target[2];
          target = null;
          runMode = false;
          moving = false;
        }
      } else {
        yaw = lerpAngle(yaw, baseYaw, 1 - Math.exp(-Math.max(stepDt, 0.001) * 3));
        runMode = false;
        moving = false;
      }
      state.position[0] = position[0];
      state.position[1] = position[1];
      state.position[2] = position[2];
      state.moving = moving;
      state.running = moving && runMode;
      state.yaw = yaw;
      if (wasMoving !== moving || wasRunning !== state.running) {
        if (state.running) setStatus(state.label + " · 跑步中");
        else if (moving) setStatus(state.label + " · 移动中");
        else if (state.title) setStatus(state.label + " · VRM / " + state.title);
        else setStatus(state.label + " · 待机");
      }
    }

    function hasActionClip(name) {
      return Boolean(actionPlayer && actionPlayer.clips.some(function (clip) { return clip.name === name; }));
    }

    function useAction(actionName, dt) {
      if (!actionReady || !actionPlayer || !actionGLB || !Render.AnimationRetarget) return null;
      if (!hasActionClip(actionName)) return null;
      if (actionPlayer.clip !== actionName) {
        actionPlayer.setClip(actionName).setLoop(true).play();
        var offset = actionName === "run" ? 0.12 : 0.08;
        if (offset) actionPlayer.update(offset);
        walkLegFilter = Object.create(null);
        walkArmLimit = Object.create(null);
      }
      actionPlayer.update(dt);
      try {
        return Render.AnimationRetarget.retargetPose(vrm, actionGLB.json, actionPlayer.getPose(), {
          footClearance: actionName === "walk",
          runPose: actionName === "run",
          dt: Math.max(0.001, Number(dt) || 0.016),
          legSmoothState: actionName === "walk" ? walkLegFilter : null,
          armLimitState: walkArmLimit
        });
      } catch (error) {
        if (global.console) console.warn("scene-vrm: action retarget failed, falling back to procedural", error);
        actionPlayer = null;
        actionReady = false;
        return null;
      }
    }

    function loadActions() {
      if (actionReady) return Promise.resolve();
      if (!actionUrl) return Promise.resolve();
      if (!formats.parseGLB || !formats.GLTFAnimation || !Render.AnimationRetarget) return Promise.resolve();
      if (actionPromise) return actionPromise;
      actionPromise = fetch(actionUrl)
        .then(function (response) {
          if (!response.ok) throw new Error("动作库加载失败 " + response.status + " · " + actionUrl);
          return response.arrayBuffer();
        })
        .then(function (buffer) {
          actionGLB = formats.parseGLB(buffer);
          actionPlayer = formats.GLTFAnimation.createPlayer(actionGLB);
          var walkClip = actionPlayer.clips.find(function (clip) { return clip.name === "walk"; });
          if (walkClip) walkClip.duration += 1 / 30;
          actionReady = actionPlayer.clips.some(function (clip) { return clip.name === "walk" || clip.name === "run"; });
        })
        .catch(function (error) {
          actionGLB = null;
          actionPlayer = null;
          actionReady = false;
          if (global.console) console.warn("scene-vrm: action library unavailable", error);
        })
        .then(function () {
          actionPromise = null;
        });
      return actionPromise;
    }

    function frame(now, dt) {
      if (!renderer || !vrm || !metrics) return;
      if (!startedAt) startedAt = now;
      step(dt);
      modelMatrix = placeMatrix(position, metrics, yaw);
      var t = (now - startedAt) / 1000;
      var actionName = moving ? (state.running ? "run" : "walk") : null;
      var actionPose = actionName ? useAction(actionName, dt) : null;
      var pose;
      var transforms = null;
      if (actionPose) {
        pose = actionPose.rotation;
        transforms = { translation: actionPose.translation };
      } else {
        var animation = Render.ProceduralAnimation;
        if (animation && animation.makeVRMPose) {
          pose = animation.makeVRMPose(vrm, t, {
            state: actionName || "idle",
            look: look ? look.getLook() : null,
            bindings: bindings
          });
        } else {
          pose = Render.makeVRMIdlePose(vrm, t);
        }
      }
      renderer.render(t, pose, transforms, {
        viewProjection: scene.getViewProjection(),
        modelMatrix: modelMatrix,
        cameraPosition: scene.camera ? scene.camera.position : null,
        lighting: lighting,
        clearColor: [0, 0, 0, 0]
      });
    }

    function moveTo(point, moveOptions) {
      if (!point) return;
      var nextTarget = [
        Math.max(-18, Math.min(18, Number(point[0]) || 0)),
        0,
        Math.max(-18, Math.min(18, Number(point[2]) || 0))
      ];
      var distance = Math.hypot(nextTarget[0] - position[0], nextTarget[2] - position[2]);
      target = nextTarget;
      runMode = Boolean(moveOptions && moveOptions.run) || distance > runDistance;
      /* 只有真正移动时才需要动作库；先走程序化动作，动作库到达后自动切换。 */
      if (!actionReady && !actionPromise) loadActions();
    }

    function boot() {
      if (!home) throw new Error("scene-vrm: slot not found: " + slotId);
      canvas.hidden = true;
      setStatus("角色位 01 · 载入 VRM");
      renderer = new Render.VRMRenderer(canvas, {
        context: { alpha: true, antialias: true },
        clearColor: [0, 0, 0, 0]
      });
      state.renderer = renderer;
      return fetch(url)
        .then(function (response) {
          if (!response.ok) throw new Error("VRM 加载失败 " + response.status + " · " + url);
          return response.arrayBuffer();
        })
        .then(function (buffer) {
          vrm = formats.parseVRM(buffer);
          state.vrm = vrm;
          return renderer.loadVRM(vrm);
        })
        .then(function () {
          metrics = metricsFor(renderer);
          var animation = Render.ProceduralAnimation;
          if (animation && animation.detectVRMBones) bindings = animation.detectVRMBones(vrm);
          modelMatrix = placeMatrix(position, metrics, yaw);
          canvas.hidden = false;
          state.status = "ready";
          var title = vrm.meta && vrm.meta.title ? vrm.meta.title : "已接入";
          state.title = title;
          if (scene.setSlotMeta) scene.setSlotMeta(slotId, "VRM / " + title);
          setStatus("角色位 01 · VRM / " + title);
          scene.onFrame(frame);
          return state;
        })
        .catch(function (error) {
          state.status = "error";
          state.error = error;
          canvas.hidden = true;
          setStatus("角色位 01 · VRM 加载失败");
          if (global.console) console.error("scene-vrm:", error);
          throw error;
        });
    }

    var handle = {
      canvas: canvas,
      ready: boot(),
      state: state,
      renderer: null,
      moveTo: moveTo,
      getPosition: function () { return state.position.slice(); }
    };
    mount.__aevumVrm = handle;
    handle.ready.then(function () {
      handle.renderer = renderer;
    }, function () {});
    return handle;
  }

  sceneNS.attachVRM = attach;
})(window);
