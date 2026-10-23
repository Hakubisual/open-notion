const T = (k) => (window.ACARD_T || {})[k] || k;
const form = document.querySelector("form[data-action]");
const msg = form.querySelector(".msg");
const button = form.querySelector('button[type="submit"]');
const action = form.dataset.action;

const show = (kind, text) => { msg.className = `msg ${kind}`; msg.textContent = text; };

// #45: the sidebar keeps its last tree in localStorage under this epoch; whoever signs in next starts without it.
try { localStorage.setItem("acard-cache-epoch", String(Date.now())); } catch {}
navigator.serviceWorker?.controller?.postMessage({ type: "acard-id", id: null });
const cleared = window.caches ? caches.keys().then(names => Promise.all(names.map(name => caches.delete(name)))).catch(() => {}) : Promise.resolve();

const params = new URLSearchParams(location.search);
if (params.get("e") === "link") show("err", T("js.auth.link"));
if (params.get("e") === "oauth") show("err", T("js.auth.oauth"));
if (params.get("reset") === "1") show("ok", T("js.auth.resetDone"));
if (params.get("deleted") === "1") show("ok", T("js.auth.deleted"));

const next = (() => { const n = params.get("next") || "/"; return n.startsWith("/") && !n.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(n) ? n : "/"; })();
const google = document.querySelector(".btn-google");
if (google && next !== "/") google.href = "/api/auth/google?next=" + encodeURIComponent(next);
document.querySelectorAll('.switch a[href="/login"], .switch a[href="/signup"]').forEach((a) => {
  if (next !== "/") a.href += "?next=" + encodeURIComponent(next);
});

const done = {
  signup: () => show("ok", T("js.auth.signupDone")),
  login: () => location.assign(next),
  forgot: () => show("ok", T("js.auth.forgotDone")),
  reset: () => location.assign("/login?reset=1"),
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  if (action === "signup" && (next === "/beta" || next.startsWith("/oauth/authorize?"))) data.next = next;
  button.disabled = true;
  try {
    await Promise.race([cleared, new Promise(resolve => setTimeout(resolve, 2000))]);
    const res = await fetch(`/api/auth/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { show("err", body.message ?? T("js.generic")); return; }
    done[action]();
  } catch {
    show("err", T("js.network"));
  } finally {
    button.disabled = false;
  }
});
