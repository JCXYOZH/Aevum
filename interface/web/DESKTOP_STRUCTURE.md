# Desktop shell structure

`desktop.html` is only the shell: top bar, dock, desk, dialog and the window
template. Styles and behavior live in their own files.

## CSS

| File | Responsibility |
| --- | --- |
| `styles/desktop/tokens.css` | color, type and layout variables |
| `styles/desktop/shell.css` | top bar, dock, desk background, footer |
| `styles/desktop/windows.css` | window frame, title bar, resize handle, overview cards/slots |
| `styles/desktop/launchpad.css` | launchpad grid and app tiles |
| `styles/desktop/panels.css` | trainer chart, kernel stage, relay feed, error rows |
| `styles/desktop/camera.css` | local photo window: stage, flash, file drop |
| `styles/desktop/dialog.css` | add-window dialog |
| `styles/desktop/responsive.css` | narrow-screen rules |
| `styles/scene3d.css` | shared 3D ground-grid layer, node anchors, character slots, scene tools (see `SCENE3D.md`) |

## JavaScript

| File | Responsibility |
| --- | --- |
| `js/desktop/core.js` | namespace, DOM helpers, icons, config, event bus, app store |
| `js/desktop/api.js` | HTTP boundary and relay contract parsing |
| `js/desktop/components/window.js` | window manager: open/focus/drag/resize/min/max/close |
| `js/desktop/components/topbar.js` | service pills, clock, shell actions |
| `js/desktop/components/dock.js` | left launch rail |
| `js/desktop/components/launchpad.js` | full-screen app grid and custom slots |
| `js/desktop/components/dialog.js` | add-window dialog |
| `js/desktop/components/terminal.js` | reusable 80×25 text surface |
| `js/desktop/components/line-chart.js` | reusable loss chart |
| `js/desktop/panels/*.js` | one panel per file: kernel, trainer, relay, errors, exhibit, camera |
| `js/desktop/main.js` | boot and wire components/panels; exposes `window.MemoriaDesk` |
| `js/scene/scene-core.js` | shared WebGL ground grid, camera matrices, DOM anchor projection, ray picking, character slots, frame hooks, 3D photo backdrop |
| `js/scene/models.config.js` | single source for VRM/PMX/Live2D/action model paths |
| `js/scene/scene-vrm.js` | VRM character pass: transparent canvas, real model load, idle pose, slot placement |
| `js/scene/scene-pmx.js` | PMX character pass: parser, textures, idle pose, slot placement |
| `js/scene/scene-live2d.js` | Live2D screen-space character pass anchored to a slot, optional replacement for slot 02 |
| `ENGINE_INTEGRATION.md` | Engine modules already used, near-term candidates, and duplicates to avoid |
| `SCENE3D.md` | Scene architecture, camera, ground shader, character slots and movement |
| `js/scene/scene-desktop.js` | desktop app-to-node layout; nodes are visual-only, character slots reuse `MD.bus` |
| `js/scene/scene-showcase.js` | `index.html` `#world` layout; node clicks scroll to sections or open the 3D desktop |
| `js/scene/world/*.js` | split world-scene source; runtime bundle and engine coverage are documented in `WORLD_SCENE.md` |
| `world.html` | standalone live world page; `?embed=1` hides the capture HUD |
| `WORLD_SCENE.md` | world module map, build order and honest engine coverage |

## Extension API

```js
MemoriaDesk.open("trainer");
MemoriaDesk.addWindow("构建记录房", "http://127.0.0.1:9000/");
MemoriaDesk.apps();
```

Custom windows are persisted in `localStorage` under
`memoria.desktop.windows`. The relay bridge address can be overridden with
`?relay=http://host:8790` and `?bridge=ws://host:8765`.

`?world=1` switches the desk to the live 3D world. The world is a second WebGL2
canvas inside `.scene3d`, behind the transparent grid/overlay canvas, so the
desktop camera, picking, slots and windows keep working. The grid is hidden in
this mode; characters are placed on the terrain after the world reports its
height samples. The normal grid background and character layer remain the
default.
