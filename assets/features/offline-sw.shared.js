(function () {
  var sw = navigator.serviceWorker;
  if (!sw) return;
  function identify() {
    sw.controller?.postMessage({ type: "acard-id", id: document.querySelector('meta[name="acard-id"]')?.content || null });
  }
  identify();
  sw.addEventListener("controllerchange", identify);
  window.addEventListener("pageshow", identify);
  sw.register("/sw.js", { type: "module" }).catch(console.warn);
})();
