# 3D world scene

The world scene is a real WebGL2 render, not a screenshot. It can run alone or
behind the desktop shell.

| Entry | Purpose |
| --- | --- |
| `world.html` | Standalone world capture page |
| `world.html?embed=1` | Same world with the capture HUD hidden |
| `world.html?time=0.72` | Set the day/night clock (`0..1`) for a fixed lighting moment |
| `desktop.html?world=1` | Desktop shell with the world rendered inside the scene layer |

## Controls

`world.html` has a `WORLD CONTROL` panel in the upper right. It is wired to
`window.AEVUM_WORLD_CONTROL`, exposed by `world-runtime.js`:

- **Time of day**: a 24-hour slider plus presets for 黎明 (`07:12`), 正午
  (`12:00`), 黄昏 (`17:12`) and 夜晚 (`21:36`). The current clock is shown as
  `HH:MM`.
- **Weather**: `clear`, `cloudy`, `rain`, `storm`, `snow` and `fog`, each
  calling `WeatherSystem.setWeather(name, false)` immediately.

The same panel stays visible in `?embed=1` (top-right), and the desktop world
(`desktop.html?world=1`) renders its own copy of the panel over the live
`scene3d__world` canvas. On desktop it uses the native light panel style and
can collapse to a compact `世界环境` pill with the `隐藏` button. Both use the
shared `js/scene/world-controls.js` binder, so the photo page and the desktop
world do not drift apart.

## Layers

`desktop.html?world=1` keeps the normal desktop DOM and adds a real WebGL2
`scene3d__world` canvas behind the transparent `scene-core` overlay. The
scene-core canvas still owns the orbit camera, pointer picking, DOM anchors and
character slots, but its grid is hidden. The world renderer is a render-only
build of the same world runtime: no VRM model, no capture HUD, no iframe.

The world canvas is created by `js/scene/scene-world.js` only when `world=1`;
the normal desktop never downloads the world bundle. Character loading waits
for `AEVUM_SCENE_READY`, so the VRM/PMX slots start on terrain height instead of
the old `y=0` plane.

## Source files

The scene is split by responsibility under `js/scene/world/`:

| File | Responsibility |
| --- | --- |
| `world-context.js` | canvas, WebGL2 context, shared constants, program helpers |
| `world-shaders.js` | terrain/sky/water/grass/shadow/post/rain programs |
| `world-vegetation.js` | tree, grass and flower mesh builders |
| `world-terrain.js` | terrain shaping around spawn and lake |
| `world-runtime.js` | boot, engine systems, camera, draw loop, VRM action |
| `world-controls.js` | shared time/weather panel binder for `world.html` and the desktop world layer |
| `world-scene.bundle.js` | generated runtime bundle loaded by `world.html` |
| `../scene-world.js` | desktop adapter: creates the world canvas, bridges the desktop camera, terrain height and readiness |

The five source files are classic script fragments that must share one lexical
scope. Browser `<script>` tags do not share top-level `var` state reliably, so
the page loads the generated bundle. Rebuild it with:

```powershell
cd D:\Aevum
$mods = "interface/web/js/scene/world"
$order = @(
  "world-context.js",
  "world-shaders.js",
  "world-vegetation.js",
  "world-terrain.js",
  "world-runtime.js"
)
$all = ($order | ForEach-Object { [IO.File]::ReadAllText((Join-Path $mods $_)) }) -join "`r`n"
$bundle = "(function(){`r`n'use strict';`r`n" + $all + "`r`n})();`r`n"
[IO.File]::WriteAllText((Join-Path $mods "world-scene.bundle.js"), $bundle, (New-Object Text.UTF8Encoding $false))
```

Do not reorder the files: the shader programs must exist before runtime boot,
and terrain/vegetation helpers must exist before the draw loop starts.

## Desktop render-only mode

`scene-world.js` sets these globals before it loads the bundle:

| Global | Meaning |
| --- | --- |
| `AEVUM_WORLD_RENDER_ONLY` | skip VRM loading/HUD and use the supplied canvas |
| `AEVUM_WORLD_CANVAS` | the `scene3d__world` canvas |
| `AEVUM_WORLD_CAMERA` | returns desktop camera position, target, fov and buffer size |
| `AEVUM_WORLD_RENDERER` | ready world API: `heightAt(x,z)`, `resize(w,h)`, `frame(now)` |
| `AEVUM_SCENE_READY` | set after terrain height is wired into scene slots |

The render-only branch returns before `VRMRenderer` is created. `world.html`
still uses the full boot path, VRM model and capture HUD.

## Sky, time and weather

`world-runtime.js` advances `DayNightCycle.time` every frame. `sunDirectionFor(time)`
maps that clock to a sun that stays in front of the camera and moves down/up
with time, so the sun remains visible instead of disappearing behind the sky
sphere. The sky shader uses the same sun direction for the disc, halo and
atmospheric tint. Stars fade in only when the sun is below the horizon; a
screen-space star field avoids the old stretched-star bands near the horizon.

`WeatherSystem` starts from `?weather=` (default `clear`) and the runtime
re-schedules clear / cloudy / rain / storm / snow every 3–5 minutes. Rain and
snow are real world-space line particles. `?weather=rain`, `?weather=storm`,
`?weather=snow` and `?weather=fog` force the state immediately for capture
and verification.

The surface shadow pass casts terrain plus near tree and grass groups. Each
caster gets its own VAO, so the old "buffer size" class of errors does not
return. The cascade matrix comes from `ShadowSystem.getShadowMatrix(2)`, so
the engine's cascade split is the one actually sampled by the terrain,
vegetation and character shaders.

## Engine systems actually used

| Capability | How it reaches the rendered frame |
| --- | --- |
| `WorldEngine` | lifecycle, system containers, object add/remove/getVisibleObjects |
| `TerrainSystem` | generated, shaped, height/normal sampling; `getLODLevel` chooses one shared LOD for all 16 chunk meshes, avoiding T-junction cracks at chunk borders |
| `WaterSystem` | level and wave height, plus the base water pass |
| `VegetationSystem` | tree/grass data generation; near meshes are built by this scene |
| `WeatherSystem` | clear/cloud/rain/storm/snow/fog state; rain and snow particles; wind, cloud, fog and thunder values feed sky, water and post |
| `DayNightCycle` | time drives sun direction, ambient and sun color |
| `SkySystem` | sky gradient, clouds, time-aware sun, night stars, storm flash |
| `LightSystem` | directional and ambient light |
| `ShadowSystem` | quality/distance, cascade matrices, terrain/tree/grass shadow casters |
| `PostProcessing` | `addPass`, `render` and the runtime backend: world post pass + FXAA pass |
| `FrustumCulling` | culls object instances; tree/grass use distance-grouped meshes |
| `CameraController` | camera state is copied into the controller |
| `World3DExt.VolumetricFog` | fog colour, density, height, falloff and sun scatter feed the post shader |
| `World3DExt.AdvancedWaterSystem` | wave definitions and all water state (colour, foam, caustics, transparency, reflectivity) drive the rendered water shader |

Far grass is no longer a second instanced layer. It is merged into the base
`VegetationSystem` grass array and rendered by the same `makeGrassMesh` /
`grassProgram`, so fog, shadow and wind are shared. The old
`World3DExt.VegetationSystem` implementation has been removed.

Every row above now contributes to a real frame. The previous "not yet driven"
list is closed; the only honest caveat is that the advanced water system supplies
the wave model and uniforms, while the scene keeps one shared water pass instead
of drawing its second water plane.

## Visual contract

- Real VRM model and real `run` clip from `engine/assets`.
- Real WebGL2 terrain, water, trees, grass, sky, shadow and post.
- No generated image, poster, fake UI or reused screenshot.
- The capture page keeps its 1600×900 frame; embed mode stretches the same
  canvas into the desktop viewport.
- Weather verification: `?weather=snow` shows snow particles, `?weather=storm`
  shows rain and storm sky, `?time=0.9` shows night objects and fireflies.

