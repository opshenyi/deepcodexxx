import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, shell } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SERVER_URL = "http://127.0.0.1:17361";
const SERVER_READY_TIMEOUT_MS = 15_000;
let managedServer: ChildProcess | undefined;

async function createWindow() {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#f6f7f8",
    title: "DeepCodex",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env.DEEPCODEX_WEB_URL;
  if (devUrl) {
    await window.loadURL(devUrl);
    return;
  }

  await ensureDesktopServer();
  await window.loadFile(path.resolve(__dirname, "../../web/dist/index.html"));
}

app.whenReady().then(createWindow);

app.on("before-quit", () => {
  stopDesktopServer();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

async function ensureDesktopServer(): Promise<void> {
  if (process.env.DEEPCODEX_DESKTOP_START_SERVER === "false") {
    return;
  }

  const healthUrl = `${desktopServerUrl()}/api/health`;
  if (await isServerHealthy(healthUrl, 750)) {
    return;
  }

  const serverEntry = process.env.DEEPCODEX_SERVER_ENTRY
    ? path.resolve(process.env.DEEPCODEX_SERVER_ENTRY)
    : path.resolve(__dirname, "../../server/dist/index.js");
  const workspaceRoot = path.resolve(__dirname, "../../..");
  const serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      DEEPCODEX_PORT: desktopServerPort()
    },
    stdio: "ignore",
    windowsHide: true
  });
  managedServer = serverProcess;
  managedServer.unref();

  await waitForServer(healthUrl, SERVER_READY_TIMEOUT_MS, serverProcess);
}

function stopDesktopServer(): void {
  if (managedServer && !managedServer.killed) {
    managedServer.kill();
  }
  managedServer = undefined;
}

function desktopServerUrl(): string {
  return process.env.DEEPCODEX_SERVER_URL ?? DEFAULT_SERVER_URL;
}

function desktopServerPort(): string {
  if (process.env.DEEPCODEX_PORT) {
    return process.env.DEEPCODEX_PORT;
  }
  const parsed = new URL(desktopServerUrl());
  return parsed.port || (parsed.protocol === "https:" ? "443" : "80");
}

async function waitForServer(
  healthUrl: string,
  timeoutMs: number,
  serverProcess: ChildProcess
): Promise<void> {
  const startedAt = Date.now();
  let exited = false;
  serverProcess.once("exit", () => {
    exited = true;
  });

  while (Date.now() - startedAt < timeoutMs) {
    if (await isServerHealthy(healthUrl, 1_000)) {
      return;
    }
    if (exited) {
      throw new Error("DeepCodex desktop server exited before it became healthy.");
    }
    await delay(250);
  }

  throw new Error(`DeepCodex desktop server did not become healthy within ${timeoutMs}ms.`);
}

function isServerHealthy(healthUrl: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get(healthUrl, (response) => {
      response.resume();
      resolve(Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300));
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => {
      resolve(false);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
