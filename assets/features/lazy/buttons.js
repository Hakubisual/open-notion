// notion-parity C3/C4: pressing an action button asks the server to run the button's stored actions.
// The confirm step is the only client-side action; a second press within a second, or while one is running, is ignored.
(function () {
  if (window.AcardButtons) return;
  var last = Object.create(null);
  var failTimers = Object.create(null);
  function fail(key, button, reason) {
    button.title = reason;
    button.classList.add("btn-failed");
    var why = button.nextElementSibling;
    if (!why || !why.classList.contains("btn-why")) {
      why = document.createElement("span");
      why.className = "btn-why";
      why.setAttribute("role", "status");
      button.insertAdjacentElement("afterend", why);
    }
    why.textContent = reason;
    clearTimeout(failTimers[key]);
    failTimers[key] = setTimeout(function () { delete failTimers[key]; button.classList.remove("btn-failed"); if (why.parentNode) why.parentNode.removeChild(why); }, 4000);
  }
  function press(key, url, button, message) {
    var now = Date.now();
    if (button.disabled || button.dataset.busy || now - (last[key] || 0) < 1000) return Promise.resolve(null);
    last[key] = now;
    if (message && !window.confirm(message)) return Promise.resolve(null);
    button.dataset.busy = "1";
    button.setAttribute("aria-busy", "true");
    return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { if (!res.ok) throw new Error(data.error || String(res.status)); return data; }); })
      .then(function (data) { if (data.open) location.assign(data.open); return data; })
      .catch(function (error) { fail(key, button, error.message); return null; })
      .then(function (data) { delete button.dataset.busy; button.removeAttribute("aria-busy"); last[key] = Date.now(); return data; });
  }
  function slug() {
    return (window.AcardReader && window.AcardReader.slug) || decodeURIComponent(location.pathname.replace(/^\//, "").replace(/\/$/, "")) || "index";
  }
  document.addEventListener("click", function (ev) {
    var button = ev.target.closest ? ev.target.closest("button[data-button]") : null;
    if (!button) return;
    ev.preventDefault();
    var id = button.getAttribute("data-button");
    press("b:" + id, "/api/page/" + encodeURIComponent(slug()) + "/button/" + encodeURIComponent(id), button, button.getAttribute("data-confirm"));
  });
  window.AcardButtons = {
    pressCell: function (database, row, prop, button) {
      var confirm = (prop.config.actions || []).filter(function (a) { return a && a.type === "confirm"; })[0];
      return press("r:" + row + ":" + prop.id, "/api/db/" + encodeURIComponent(database) + "/rows/" + encodeURIComponent(row) + "/button/" + encodeURIComponent(prop.id), button, confirm ? (confirm.message || "실행할까요?") : null);
    },
  };
})();
