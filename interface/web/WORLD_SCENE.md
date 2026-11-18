# 3D world scene

The world scene is a real WebGL2 render, not a screenshot. It can run alone or
behind the desktop shell.

| Entry | Purpose |
| --- | --- |
| `world.html` | Standalone world capture page |
| `world.html?embed=1` | Same world with the capture HUD hidden |
| `desktop.html?world=1` | Desktop shell with the world as its background layer |

## Layers

`desktop.html?world=1` keeps the normal desktop DOM and loads
`world.html?embed=1` in a full-bleed iframe behind the windows. The world layer
is `pointer-events: none`; the desktop dock, windows and dialogs stay on top.
The old grid/character layer is hidden while this mode is active.

The iframe source is stored in `data-src` and only assigned when `world=1`, so
the normal desktop does not download the 38 MB VRM model.

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

## Engine systems actually used

| Capability | State |
| --- | --- |
| `WorldEngine` | used for lifecycle and system containers |
| `TerrainSystem` | generated, shaped, sampled for height and normal |
| `WaterSystem` | level, wave height and water shader |
| `VegetationSystem` | tree/grass data generation; meshes are built by this scene |
| `WeatherSystem` | clear/cloud state; rain draw path exists |
| `DayNightCycle` | time, ambient and sun color |
| `SkySystem` | sky gradient, clouds, sun direction |
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
- `WeatherSystem` rain/snow/storm transitions
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
