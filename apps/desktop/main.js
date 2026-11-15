const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");

const APP_ID = "cn.mrhua.memoria";
const APP_ICON = path.join(__dirname, "icon.ico");
const PORTS = {
  relay: Number(process.env.MEMORIA_RELAY_PORT || 8790),
  monitor: Number(process.env.MEMORIA_MONITOR_PORT || 8781),
  bridge: Number(process.env.MEMORIA_BRIDGE_PORT || 8765),
  serial: Number(process.env.MEMORIA_SERIAL_PORT || 5555),
};
const MONITOR_URL = process.env.MEMORIA_MONITOR_URL || `http://127.0.0.1:${PORTS.monitor}/`;
const children = new Map();
let mainWindow = null;
let shuttingDown = false;

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

function repoRoot() {
  return path.resolve(__dirname, "..", "..");
}

function pythonPath() {
  if (process.env.MEMORIA_PYTHON) return process.env.MEMORIA_PYTHON;
  const venv = "D:\\venv\\Scripts\\python.exe";
  return fs.existsSync(venv) ? venv : "python";
}

function appRoot() {
  return app.isPackaged ? process.resourcesPath : repoRoot();
}

function serviceDir(name) {
  const roots = app.isPackaged
    ? {
        monitor: path.join(process.resourcesPath, "monitor"),
        relay: path.join(process.resourcesPath, "relay"),
        bridge: path.join(process.resourcesPath, "bridge"),
        kernel: path.join(process.resourcesPath, "kernel"),
        qemu: path.join(process.resourcesPath, "qemu"),
      }
    : {
        monitor: path.join(repoRoot(), "apps", "console", "monitor"),
        relay: path.join(repoRoot(), "apps", "relay"),
        bridge: path.join(repoRoot(), "apps", "console", "bridge"),
        kernel: path.join(repoRoot(), "apps", "console", "kernel"),
        qemu: "",
      };
  return roots[name] || "";
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

function buildRoot() {
  return app.isPackaged ? packagedBuildRoot() : path.join(repoRoot(), "build");
}

function logDir() {
  const dir = process.env.MEMORIA_LOG_DIR || path.join(app.getPath("userData"), "logs");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    console.error("cannot create log directory", dir, error);
  }
  return dir;
}

function logFile(name) {
  return path.join(logDir(), `${name}.log`);
}

function appendLog(name, message) {
  try {
    fs.appendFileSync(logFile(name), `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch (error) {
    console.error("cannot append log", name, error);
  }
}

function startProcess(name, command, args, options) {
  const out = fs.openSync(logFile(name), "a");
  const child = spawn(command, args, {
    ...options,
    windowsHide: true,
    stdio: ["ignore", out, out],
  });
  children.set(name, child);
  appendLog(name, `spawn ${command} ${args.join(" ")} (cwd=${options.cwd || ""})`);
  child.on("error", (error) => {
    appendLog(name, `spawn error: ${error.message}`);
    children.delete(name);
  });
  child.on("exit", (code, signal) => {
    appendLog(name, `exit code=${code} signal=${signal}`);
    if (!shuttingDown) children.delete(name);
  });
  return child;
}

async function waitForPort(name, port, seconds = 20) {
  for (let i = 0; i < seconds * 5; i += 1) {
    if (await portOpen(port, 250)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  appendLog(name, `port ${port} did not open within ${seconds}s`);
  return false;
}

function monitorLaunch() {
  const dir = serviceDir("monitor");
  const exe = process.env.MEMORIA_MONITOR_EXE
    || (app.isPackaged ? path.join(dir, "memoria-monitor.exe") : "");
  const common = [
    "--port", String(PORTS.monitor),
    "--relay-port", String(PORTS.relay),
    "--bridge-port", String(PORTS.bridge),
    "--serial-port", String(PORTS.serial),
  ];
  if (exe && fs.existsSync(exe)) {
    return { command: exe, args: common, cwd: path.dirname(exe) };
  }
  const script = path.join(dir, "desktop_server.py");
  if (!fs.existsSync(script)) return null;
  return {
    command: pythonPath(),
    args: ["-X", "utf8", "desktop_server.py", ...common],
    cwd: dir,
  };
}

function relayLaunch() {
  const dir = serviceDir("relay");
  const exe = process.env.MEMORIA_RELAY_EXE
    || (app.isPackaged ? path.join(dir, "memoria-relay.exe") : "");
  const common = ["--host", "127.0.0.1", "--port", String(PORTS.relay)];
  if (exe && fs.existsSync(exe)) {
    return { command: exe, args: common, cwd: path.dirname(exe) };
  }
  const entry = path.join(dir, "relay_entry.py");
  if (!fs.existsSync(entry)) return null;
  return {
    command: pythonPath(),
    args: ["-X", "utf8", entry, ...common],
    cwd: dir,
  };
}

function bridgeLaunch() {
  const dir = serviceDir("bridge");
  const exe = process.env.MEMORIA_BRIDGE_EXE
    || (app.isPackaged ? path.join(dir, "memoria-bridge.exe") : "");
  if (exe && fs.existsSync(exe)) {
    return { command: exe, args: [], cwd: path.dirname(exe) };
  }
  const script = path.join(dir, "serial_bridge.py");
  if (!fs.existsSync(script)) return null;
  return {
    command: pythonPath(),
    args: ["-X", "utf8", "serial_bridge.py"],
    cwd: dir,
  };
}

function qemuPath() {
  if (process.env.MEMORIA_QEMU) return process.env.MEMORIA_QEMU;
  if (app.isPackaged) return path.join(serviceDir("qemu"), "qemu-system-i386.exe");
  const candidates = [
    path.join(repoRoot(), "qemu", "qemu-system-i386.exe"),
    "C:\\Program Files\\qemu\\qemu-system-i386.exe",
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "qemu-system-i386";
}

function qemuLaunch() {
  const robotDisk = path.join(serviceDir("kernel"), "robot", "disk.img");
  const disk = fs.existsSync(robotDisk) ? robotDisk : path.join(serviceDir("kernel"), "disk.img");
  if (!fs.existsSync(disk)) return null;
  const serial = `tcp:127.0.0.1:${PORTS.serial},server=on,wait=off`;
  return {
    command: qemuPath(),
    args: [
      "-drive", `format=raw,file=${disk}`,
      "-display", "none",
      "-monitor", "none",
      "-no-reboot",
      "-serial", serial,
    ],
    cwd: path.dirname(disk),
  };
}

function serviceEnv() {
  const env = { ...process.env };
  env.QEMU_SERIAL_HOST = "127.0.0.1";
  env.QEMU_SERIAL_PORT = String(PORTS.serial);
  env.BRIDGE_WS_HOST = "127.0.0.1";
  env.BRIDGE_WS_PORT = String(PORTS.bridge);
  if (app.isPackaged) {
    env.MEMORIA_ROOT = process.resourcesPath;
    env.MEMORIA_WEB_ROOT = env.MEMORIA_WEB_ROOT || path.join(process.resourcesPath, "web");
    env.MEMORIA_ERROR_TABLE = env.MEMORIA_ERROR_TABLE || path.join(process.resourcesPath, "contracts", "errors.json");
    env.MEMORIA_BUILD_ROOT = buildRoot();
    env.MEMORIA_DATA_ROOT = env.MEMORIA_DATA_ROOT || path.join(process.resourcesPath, "data");
    const runtimeDir = path.join(buildRoot(), "runtime");
    try {
      fs.mkdirSync(runtimeDir, { recursive: true });
    } catch (error) {
      appendLog("monitor", `cannot create runtime dir: ${error.message}`);
    }
    if (!env.MEMORIA_TORCH_LIB && fs.existsSync(runtimeDir)) env.MEMORIA_TORCH_LIB = runtimeDir;
  }
  return env;
}

async function ensurePort(name, port, launch) {
  if (await portOpen(port)) return true;
  if (!launch) {
    appendLog(name, "launch target is missing");
    return false;
  }
  startProcess(name, launch.command, launch.args, {
    cwd: launch.cwd,
    env: serviceEnv(),
  });
  return waitForPort(name, port);
}

async function ensureRelay() {
  if (process.env.MEMORIA_NO_RELAY === "1") return true;
  return ensurePort("relay", PORTS.relay, relayLaunch());
}

async function ensureMonitor() {
  if (process.env.MEMORIA_NO_MONITOR === "1") return true;
  return ensurePort("monitor", PORTS.monitor, monitorLaunch());
}

async function ensureKernel() {
  if (process.env.MEMORIA_NO_KERNEL === "1") return true;
  const qemu = qemuLaunch();
  if (!qemu) {
    appendLog("qemu", "kernel disk image or qemu executable is missing");
    return false;
  }
  // 桥接先起：QEMU 一开机就发出的首帧不会因为桥接晚到而丢掉。
  if (!(await ensurePort("bridge", PORTS.bridge, bridgeLaunch()))) return false;
  return ensurePort("qemu", PORTS.serial, qemu);
}

async function ensureServices() {
  await ensureRelay();
  await ensureMonitor();
  await ensureKernel();
}

function stopProcess(name, child) {
  if (!child || child.killed) return;
  if (process.platform === "win32") {
    try {
      const taskkill = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
      spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      return;
    } catch (error) {
      appendLog(name, `taskkill failed: ${error.message}`);
    }
  }
  try {
    child.kill("SIGTERM");
  } catch (error) {
    appendLog(name, `kill failed: ${error.message}`);
  }
}

function stopAll() {
  shuttingDown = true;
  for (const [name, child] of children) stopProcess(name, child);
  children.clear();
}

async function createWindow() {
  await ensureServices();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#f6f0e3",
    title: "Memoria Control Desk",
    icon: fs.existsSync(APP_ICON) ? APP_ICON : undefined,
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
  app.setAppUserModelId(APP_ID);
  try {
    await createWindow();
  } catch (error) {
    dialog.showErrorBox(
      "Memoria Control Desk",
      `无法打开桌面监控服务。\n\n日志目录：${logDir()}\n\n${error.message}`,
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

app.on("before-quit", stopAll);
