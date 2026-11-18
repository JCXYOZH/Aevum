# 3D world scene

The world scene is a real WebGL2 render, not a screenshot. It can run alone or
behind the desktop shell.

| Entry | Purpose |
| --- | --- |
| `world.html` | Standalone world capture page |
| `world.html?embed=1` | Same world with the capture HUD hidden |
| `world.html?time=0.72` | Set the day/night clock (`0..1`) for a fixed lighting moment |
| `desktop.html?world=1` | Desktop shell with the world rendered inside the scene layer |

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
re-schedules clear / cloud / rain every 3–5 minutes. Rain particles are real
world-space line segments. `?weather=rain` forces rain immediately for capture
and verification.

The surface shadow pass currently casts terrain only. Tree and grass shadow
VAOs are built by the original shadow pass but were the source of repeated
`glDrawElements: Insufficient buffer size` warnings; the main render path now
keeps only the terrain caster until the per-group shadow buffers are rebuilt.

## Engine systems actually used

| Capability | State |
| --- | --- |
| `WorldEngine` | used for lifecycle and system containers |
| `TerrainSystem` | generated, shaped, sampled for height and normal |
| `WaterSystem` | level, wave height and water shader |
| `VegetationSystem` | tree/grass data generation; meshes are built by this scene |
| `WeatherSystem` | clear/cloud/rain state; desktop and standalone pages render rain particles |
| `DayNightCycle` | time drives sun direction, ambient and sun color |
| `SkySystem` | sky gradient, clouds, time-aware sun position, night stars |
| `LightSystem` | directional and ambient light |
| `ShadowSystem` | quality/distance settings; the scene owns its 2048 shadow map |
| `PostProcessing` | reads grading values; the scene owns the post shader |
| `FrustumCulling` | four quadrant groups for trees and grass |
| `CameraController` | camera state is copied into the controller |
| `VolumetricFog` | parameters feed the post shader's fog approximation |

Not yet driven by the rendered frame:

- `World3DExt.AdvancedWaterSystem`
- `World3DExt.VegetationSystem`
- `TerrainSystem.lodLevels` / `getLODLevel`
- `PostProcessing.addPass` / `render`
- `ShadowSystem` cascaded matrices
- `WeatherSystem` snow/storm transitions
- `WorldEngine.addObject` / `removeObject`

So the page does not claim 100% engine coverage. The honest number is: every
major world category (terrain, water, vegetation, sky, light, shadow, weather,
post, culling, camera, fog, animation) is present, but several alternate
implementations are not.

## Visual contract

- Real VRM model and real `run` clip from `engine/assets`.
- Real WebGL2 terrain, water, trees, grass, sky, shadow and post.
- No generated image, poster, fake UI or reused screenshot.
- The capture page keeps its 1600×900 frame; embed mode stretches the same
  canvas into the desktop viewport.
