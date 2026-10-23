// connect.html asks the main process to check and save a server address. Electron has no window.prompt, which a few
// editor menus use (rename tag, link database); a synchronous prompt backed by a modal window (main.cjs) stands in.
const { contextBridge, ipcRenderer, webFrame } = require("electron");

if (location.protocol === "file:" && location.pathname.endsWith("/connect.html")) {
  contextBridge.exposeInMainWorld("acard", {
    connect: (address) => ipcRenderer.invoke("acard:connect", String(address ?? "")),
    local: () => ipcRenderer.invoke("acard:local"),
  });
} else if (location.protocol === "http:" || location.protocol === "https:") {
  contextBridge.exposeInMainWorld("acard", {
    prompt: (message, value) => ipcRenderer.sendSync("acard:prompt", String(message ?? ""), String(value ?? "")),
  });
  webFrame.executeJavaScript("window.prompt = (message, value) => window.acard.prompt(message, value);");
}
