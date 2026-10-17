const { app, BrowserWindow, Menu, dialog } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const PORT = 5173;
const DESK_URL = `http://localhost:${PORT}/`;
const root = path.join(__dirname, "..");

let viteProcess = null;
let startedByUs = false;

function ping(host) {
  return new Promise((resolve) => {
    const req = http.get({ host, port: PORT, path: "/", timeout: 700 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function serverUp() {
  return (await ping("127.0.0.1")) || (await ping("localhost"));
}

function startVite() {
  startedByUs = true;
  viteProcess = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
    cwd: root,
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
}

function stopVite() {
  if (!startedByUs || !viteProcess || !viteProcess.pid) return;
  const pid = viteProcess.pid;
  viteProcess = null;
  startedByUs = false;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { shell: true, stdio: "ignore" });
  } else {
    try {
      process.kill(pid);
    } catch {
      /* already gone */
    }
  }
}

async function waitForServer() {
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    if (await serverUp()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("The desk did not start.");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#d7e0e6",
    title: "მტკვარი ALCO",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  let attempts = 0;
  win.webContents.on("did-fail-load", () => {
    attempts += 1;
    if (attempts > 20) return;
    setTimeout(() => {
      if (!win.isDestroyed()) win.loadURL(DESK_URL);
    }, 400);
  });

  win.loadURL(DESK_URL);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  if (!(await serverUp())) startVite();
  try {
    await waitForServer();
  } catch {
    dialog.showErrorBox("მტკვარი", "The desk did not start on port 5173.");
    stopVite();
    app.quit();
    return;
  }
  createWindow();
});

app.on("window-all-closed", () => {
  stopVite();
  app.quit();
});

app.on("before-quit", () => {
  stopVite();
});
