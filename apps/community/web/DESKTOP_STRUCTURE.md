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
| `styles/desktop/dialog.css` | add-window dialog |
| `styles/desktop/responsive.css` | narrow-screen rules |

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
| `js/desktop/panels/*.js` | one panel per file: overview, kernel, trainer, relay, errors, exhibit |
| `js/desktop/main.js` | boot and wire components/panels; exposes `window.MemoriaDesk` |

## Extension API

```js
MemoriaDesk.open("trainer");
MemoriaDesk.addWindow("构建记录房", "http://127.0.0.1:9000/");
MemoriaDesk.apps();
```

Custom windows are persisted in `localStorage` under
`memoria.desktop.windows`. The relay bridge address can be overridden with
`?relay=http://host:8790` and `?bridge=ws://host:8765`.
