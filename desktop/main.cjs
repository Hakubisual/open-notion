// Acard Local desktop client. Shows connect.html until a server address is saved, then loads that server in the window.
// The window only navigates inside the saved server; other links open in the system browser.
const { app, BrowserWindow, Menu, shell, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const TITLE = "Acard Local";
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
const readServer = () => { try { return JSON.parse(fs.readFileSync(configFile(), "utf8")).server || null; } catch { return null; } };
const writeServer = (server) => fs.writeFileSync(configFile(), JSON.stringify({ server }));

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
const inside = (url, origin) => !!origin && (url === origin || url.startsWith(origin + "/"));

function showConnect(error) {
  win.loadFile(path.join(__dirname, "connect.html"), { query: { server: readServer() || "", error: error || "" } });
}

function showServer() {
  const origin = readServer();
  if (!origin) return showConnect();
  win.loadURL(origin + "/").catch(() => showConnect("Could not open " + origin + "."));
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
    if (inside(url, readServer())) return { action: "allow" };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file:") || inside(url, readServer())) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  win.webContents.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && !url.startsWith("file:")) showConnect("Could not reach the server (" + description + ").");
  });
  showServer();
}

ipcMain.handle("acard:connect", async (_event, input) => {
  try {
    const origin = await probe(normalize(input));
    writeServer(origin);
    showServer();
    return { ok: true, origin };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

const esc = (text) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// The page is blocked in sendSync until returnValue is set, so every exit path must answer exactly once.
ipcMain.on("acard:prompt", (event, message, value) => {
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
      { label: "Change server…", accelerator: "CmdOrCtrl+Shift+S", click: () => showConnect() },
      { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => win && win.webContents.reload() },
      { label: "Sign out", click: () => { const o = readServer(); if (o) win.loadURL(o + "/__local/logout"); } },
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
