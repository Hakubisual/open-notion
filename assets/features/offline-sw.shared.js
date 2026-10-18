(function () {
  if (!(window.AcardReader || window.AcardEditor) || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js", { type: "module", scope: "/", updateViaCache: "none" }).catch(function (error) { console.warn("Offline registration failed", error); });
})();
