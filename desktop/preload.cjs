// connect.html asks the main process to check and save a server address. Electron has no window.prompt, which a few
// editor menus use (rename tag, link database); a synchronous prompt backed by a modal window (main.cjs) stands in.
const { contextBridge, ipcRenderer, webFrame } = require("electron");

contextBridge.exposeInMainWorld("opennotion", {
  connect: (address) => ipcRenderer.invoke("opennotion:connect", String(address ?? "")),
  prompt: (message, value) => ipcRenderer.sendSync("opennotion:prompt", String(message ?? ""), String(value ?? "")),
});
webFrame.executeJavaScript("window.prompt = (message, value) => window.opennotion.prompt(message, value);");
