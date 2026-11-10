const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");

const MONITOR_PORT = Number(process.env.MEMORIA_MONITOR_PORT || 8781);
const MONITOR_URL = process.env.MEMORIA_MONITOR_URL || `http://127.0.0.1:${MONITOR_PORT}/`;
let monitorProcess = null;
let mainWindow = null;

function portOpen(port, timeout = 350) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function pythonPath() {
  if (process.env.MEMORIA_PYTHON) return process.env.MEMORIA_PYTHON;
  const venv = "D:\\venv\\Scripts\\python.exe";
  return fs.existsSync(venv) ? venv : "python";
}

function monitorDir() {
  if (process.env.MEMORIA_MONITOR_DIR) return process.env.MEMORIA_MONITOR_DIR;
  if (app.isPackaged) return path.join(process.resourcesPath, "monitor");
  return path.resolve(__dirname, "..", "console", "monitor");
}

function monitorLaunch() {
  const dir = monitorDir();
  const exe = process.env.MEMORIA_MONITOR_EXE
    || (app.isPackaged ? path.join(dir, "memoria-monitor.exe") : "");
  if (exe && fs.existsSync(exe)) {
    return { command: exe, args: ["--port", String(MONITOR_PORT)], cwd: path.dirname(exe), script: exe };
  }
  const script = path.join(dir, "desktop_server.py");
  if (!fs.existsSync(script)) return null;
  return {
    command: pythonPath(),
    args: ["-X", "utf8", "desktop_server.py", "--port", String(MONITOR_PORT)],
    cwd: dir,
    script,
  };
}

function packagedBuildRoot() {
  if (process.env.MEMORIA_BUILD_ROOT) return process.env.MEMORIA_BUILD_ROOT;
  const candidates = [
    path.join(process.resourcesPath, "model-root.txt"),
    path.join(path.dirname(process.execPath), "model-root.txt"),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) return path.resolve(path.dirname(file), value);
    } catch (error) {
      // A missing or unreadable hint is not fatal; fall back to the bundled path.
    }
  }
  return path.join(process.resourcesPath, "build");
}

function monitorEnv() {
  // The frozen monitor resolves its pages next to the executable. The Electron
  // build copies web/ and contracts/ into resources, so tell the server exactly
  // where those resources live instead of guessing from a temporary path.
  const env = { ...process.env };
  if (app.isPackaged) {
    env.MEMORIA_ROOT = process.resourcesPath;
    env.MEMORIA_WEB_ROOT = env.MEMORIA_WEB_ROOT || path.join(process.resourcesPath, "web");
    env.MEMORIA_ERROR_TABLE = env.MEMORIA_ERROR_TABLE || path.join(process.resourcesPath, "contracts", "errors.json");
    env.MEMORIA_BUILD_ROOT = packagedBuildRoot();
  }
  return env;
}

async function ensureMonitor() {
  if (process.env.MEMORIA_NO_MONITOR === "1") return;
  if (await portOpen(MONITOR_PORT)) return;

  const launch = monitorLaunch();
  if (!launch) return;

  monitorProcess = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: monitorEnv(),
    windowsHide: true,
    stdio: "ignore",
  });
  monitorProcess.on("error", () => {
    monitorProcess = null;
  });

  for (let i = 0; i < 40; i += 1) {
    if (await portOpen(MONITOR_PORT, 180)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function createWindow() {
  await ensureMonitor();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#f6f0e3",
    title: "Memoria Control Desk",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(MONITOR_URL);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    await createWindow();
  } catch (error) {
    dialog.showErrorBox(
      "Memoria Control Desk",
      `无法打开桌面监控服务。\n\n先运行 scripts\\desktop.ps1，或用 MEMORIA_MONITOR_URL 指向已启动的服务。\n\n${error.message}`,
    );
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (monitorProcess) {
    monitorProcess.kill();
    monitorProcess = null;
  }
});
