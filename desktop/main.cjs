// Acard Local runs a bundled server or connects to a team's existing server.
// The window only navigates inside the active origin; other links open in the system browser.
const { app, BrowserWindow, Menu, shell, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const TITLE = "Acard Local";
// Electron resolves Windows known folders independently of an APPDATA override.
if (process.platform === "win32" && process.env.APPDATA) {
  app.setPath("appData", path.resolve(process.env.APPDATA));
  app.setPath("userData", path.join(app.getPath("appData"), TITLE));
}
const configFile = () => path.join(app.getPath("userData"), "server.json");

// Up to v0.1 this app had another name and kept its settings, sign-in cookie and storage in %APPDATA%/<old name>
// (Electron's userData follows productName). On the first start of Acard Local, copy that folder over so people stay
// connected and signed in. Runs before app.ready, when Chromium has not opened the profile yet; caches are skipped.
// If a full copy fails (the old app is still running and holds a lock), fall back to the saved server address only.
const LEGACY_PROFILE = "OpenNotion"; // compat: the v0.1 userData folder name, read only
function migrateOldProfile() {
  const legacy = path.join(app.getPath("appData"), LEGACY_PROFILE);
  const target = app.getPath("userData");
  if (fs.existsSync(path.join(target, "server.json")) || !fs.existsSync(path.join(legacy, "server.json"))) return;
  const skip = /^(Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|GrShaderCache|ShaderCache|Crashpad|blob_storage|Singleton\w*|lockfile)$/i;
  try {
    fs.cpSync(legacy, target, { recursive: true, force: false, errorOnExist: false, filter: (src) => !skip.test(path.basename(src)) });
  } catch {
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(path.join(legacy, "server.json"), path.join(target, "server.json"));
  }
}
const readConfig = () => {
  try {
    const config = JSON.parse(fs.readFileSync(configFile(), "utf8"));
    return { ...config, mode: config.mode || (config.server ? "server" : null) };
  } catch { return {}; }
};
const writeConfig = (config) => {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(config));
};

function normalize(input) {
  let text = String(input || "").trim();
  if (!text) throw new Error("Enter the server address.");
  if (!/^https?:\/\//i.test(text)) text = "http://" + text;
  const url = new URL(text);
  return url.origin;
}

// Accepts the address only when an Acard server answers its health check.
async function probe(origin) {
  const res = await fetch(origin + "/__local/health", { signal: AbortSignal.timeout(6000) }).catch(() => null);
  if (!res) throw new Error("No Acard server answered at " + origin + ". Check the address, the port and your network.");
  if (res.status === 403) throw new Error("The server refused this address. Ask the admin to add it to ACARD_ALLOWED_HOSTS.");
  const body = await res.text();
  if (!res.ok || !body.includes("ok")) throw new Error("No Acard server answered at " + origin + ".");
  return origin;
}

let win = null;
let activeOrigin = null;
let server = null;
let opening = null;
let quitting = false;
const inside = (url, origin) => !!origin && (url === origin || url.startsWith(origin + "/"));
const connectURL = pathToFileURL(path.join(__dirname, "connect.html")).href;
const isConnect = (url) => url.split("?")[0] === connectURL;
const resources = (...parts) => path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, "stage"), ...parts);

function showConnect(error, team = false) {
  const locale = app.getLocale().toLowerCase();
  const lang = locale.startsWith("ko") ? "ko" : locale.startsWith("zh") ? "zh" : "en";
  win.loadFile(path.join(__dirname, "connect.html"), { query: { server: readConfig().server || "", error: error || "", team: team ? "1" : "", lang } });
}

async function freePort() {
  for (let port = 47811; port <= 47830; port++) {
    const free = await new Promise((resolve, reject) => {
      const listener = net.createServer();
      listener.once("error", (error) => error.code === "EADDRINUSE" || error.code === "EACCES" ? resolve(false) : reject(error));
      listener.listen(port, "127.0.0.1", () => listener.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error("No local port is available between 47811 and 47830.");
}

function stopServer() {
  const child = server;
  if (!child) return Promise.resolve();
  server = null;
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill(), 3000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.stdin.end();
  });
}

async function startServer() {
  const port = await freePort();
  const locale = app.getLocale().toLowerCase();
  const exe = process.env.ACARD_LOCAL_SERVER_EXE || resources("server", "acard-server" + (process.platform === "win32" ? ".exe" : ""));
  const child = server = spawn(exe, [], {
    env: { ...process.env, ACARD_DATA_DIR: path.join(app.getPath("userData"), "data"), ACARD_APP_DIR: resources("app"),
      ACARD_PORT: String(port), ACARD_LANG: locale.startsWith("ko") ? "ko" : locale.startsWith("zh") ? "zh" : "en",
      ACARD_CLOUD_URL: "", ACARD_HOST: "127.0.0.1", ACARD_PASSWORD: "" },
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  let tail = "";
  child.stdin.on("error", () => {}); // A server that exits early can close stdin before shutdown.
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(new Error(error + "\n\nServer output:\n" + (tail || "(no output)"))) : resolve();
    };
    const timer = setTimeout(() => finish("The local server did not become ready within 20 seconds."), 20000);
    child.stdout.on("data", (chunk) => {
      tail = (tail + chunk).slice(-8000);
      if (/(^|\n)READY [^\r\n]+[\r\n]/.test(tail)) finish();
    });
    child.stderr.on("data", (chunk) => { tail = (tail + chunk).slice(-8000); });
    child.once("error", (error) => finish("Could not start the local server: " + error.message));
    child.once("exit", (code) => finish("The local server exited with code " + code + "."));
  });
  fs.writeFileSync(path.join(app.getPath("userData"), "local.json"), JSON.stringify({ port }));
  return "http://127.0.0.1:" + port;
}

function openMode(config) {
  if (opening) return opening;
  opening = (async () => {
    try {
      if (config.mode === "local") {
        if (!server) activeOrigin = await startServer();
      } else {
        await stopServer();
        activeOrigin = config.server;
      }
      if (!quitting) await win.loadURL(activeOrigin + "/");
    } catch (error) {
      await stopServer();
      activeOrigin = null;
      if (!quitting) showConnect(String(error.message || error));
    } finally { opening = null; }
  })();
  return opening;
}

function useLocal() {
  if (opening) return opening;
  writeConfig({ mode: "local" });
  return openMode({ mode: "local" });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, title: TITLE, icon: path.join(__dirname, "icon.png"),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, "preload.cjs") },
  });
  // Pages set their own title; keep the app name in it so this window is told apart from the hosted Acard app.
  win.on("page-title-updated", (event, title) => {
    event.preventDefault();
    win.setTitle(title && !title.includes(TITLE) ? title + " - " + TITLE : TITLE);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (inside(url, activeOrigin)) { win.loadURL(url); return { action: "deny" }; }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (isConnect(url) || inside(url, activeOrigin)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  win.webContents.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && !url.startsWith("file:")) showConnect("Could not reach the server (" + description + ").");
  });
  const config = readConfig();
  if (config.mode === "local" || config.mode === "server" && config.server) openMode(config);
  else showConnect();
}

ipcMain.handle("acard:local", (event) => {
  if (event.sender !== win.webContents || !isConnect(event.senderFrame.url)) return;
  return useLocal();
});
ipcMain.handle("acard:connect", async (event, input) => {
  if (event.sender !== win.webContents || !isConnect(event.senderFrame.url)) return { ok: false, error: "Open the Server menu to change modes." };
  try {
    if (opening) throw new Error("Wait for the current server to finish starting.");
    const origin = await probe(normalize(input));
    writeConfig({ mode: "server", server: origin });
    await openMode({ mode: "server", server: origin });
    return { ok: true, origin };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

const esc = (text) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// The page is blocked in sendSync until returnValue is set, so every exit path must answer exactly once.
ipcMain.on("acard:prompt", (event, message, value) => {
  if (!inside(event.senderFrame.url, activeOrigin)) { event.returnValue = null; return; }
  const dialog = new BrowserWindow({
    parent: BrowserWindow.fromWebContents(event.sender), modal: true, width: 420, height: 190, resizable: false,
    minimizable: false, maximizable: false, title: TITLE, autoHideMenuBar: true, show: false,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  let answered = false;
  const answer = (result) => { if (answered) return; answered = true; event.returnValue = result; if (!dialog.isDestroyed()) dialog.destroy(); };
  dialog.webContents.on("will-navigate", (navigation, url) => {
    navigation.preventDefault();
    const parsed = new URL(url);
    answer(parsed.hostname === "ok.prompt" ? parsed.searchParams.get("v") ?? "" : null);
  });
  dialog.on("closed", () => answer(null));
  const html = '<!doctype html><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;margin:20px;font-size:14px}input{width:100%;box-sizing:border-box;padding:8px;margin:10px 0;font-size:14px}.b{text-align:right}button{padding:6px 14px;margin-left:6px}</style>'
    + "<form id=f><label>" + esc(message) + '</label><input id=v autofocus value="' + esc(value) + '"><div class=b><button type=button id=c>Cancel</button><button>OK</button></div></form>'
    + "<script>f.onsubmit=e=>{e.preventDefault();location.href='https://ok.prompt/?v='+encodeURIComponent(v.value)};c.onclick=()=>{location.href='https://cancel.prompt/'};addEventListener('keydown',e=>{if(e.key==='Escape')c.click()});v.select()</script>";
  dialog.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  dialog.once("ready-to-show", () => dialog.show());
});

function buildMenu() {
  const isMac = process.platform === "darwin";
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: "appMenu" }] : []),
    { label: "Server", submenu: [
      { label: "Use on this computer", click: () => useLocal() },
      { label: "Connect to a team server…", click: () => showConnect("", true) },
      { label: "Change server…", accelerator: "CmdOrCtrl+Shift+S", click: () => showConnect("", true) },
      { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => win && win.webContents.reload() },
      { label: "Sign out", click: () => { if (activeOrigin) win.loadURL(activeOrigin + "/__local/logout"); } },
      { type: "separator" },
      isMac ? { role: "close" } : { role: "quit" },
    ] },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]));
}

try { migrateOldProfile(); } catch (error) { console.error("profile migration failed:", error); }
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", (event) => {
  if (!server && !opening) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  (async () => { await opening; await stopServer(); app.quit(); })();
});
