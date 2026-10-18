const $ = (id) => document.getElementById(id);
const form = $("step1"), nameIn = $("display_name"), handleIn = $("handle"), state = $("handle-state");
const msg = form.querySelector(".msg");
const show = (kind, text) => { msg.className = `msg ${kind}`; msg.textContent = text; };
let seq = 0, timer, original = "";

async function checkHandle() {
  const h = handleIn.value.trim().toLowerCase();
  const my = ++seq;
  if (!h) { state.className = "handle-state"; state.textContent = ""; return false; }
  const body = await (await fetch(`/api/handle?h=${encodeURIComponent(h)}`)).json().catch(() => ({}));
  if (my !== seq) return false;
  const ok = body.status === "ok";
  state.className = `handle-state ${ok ? "ok" : "err"}`;
  state.textContent = h === original && ok ? "지금 쓰는 주소예요" : body.message ?? "주소를 확인하지 못했어요.";
  return ok;
}

handleIn.addEventListener("input", () => {
  handleIn.value = handleIn.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
  clearTimeout(timer); timer = setTimeout(checkHandle, 300);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearTimeout(timer);
  if (!(await checkHandle())) { handleIn.focus(); return; }
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    const res = await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ display_name: nameIn.value, handle: handleIn.value, lang: $("lang").value }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { show("err", body.message ?? "저장하지 못했어요."); return; }
    original = body.profile.handle;
    show("ok", "저장했어요.");
    if ($("lang").value !== (window.ACARD_LANG || "ko")) location.reload();
  } catch { show("err", "네트워크 연결을 확인해 주세요."); }
  finally { btn.disabled = false; }
});

(async () => {
  const res = await fetch("/api/profile");
  if (res.status === 401) { location.replace("/login"); return; }
  if (!res.ok) { show("err", "프로필을 불러오지 못했어요. 잠시 후 다시 열어 주세요."); return; }
  const { email, profile } = await res.json();
  if (!profile) { location.replace("/onboarding"); return; }
  $("me-email").textContent = email;
  nameIn.value = profile.display_name;
  handleIn.value = original = profile.handle;
  $("lang").value = profile.lang || window.ACARD_LANG || "ko";
  const a = $("avatar");
  if (profile.avatar_url) a.style.backgroundImage = `url("${profile.avatar_url}")`;
  else a.textContent = profile.display_name.trim()[0]?.toUpperCase() ?? "A";
  const saved = profile.home_layout?.widgets ?? [];
  homeOn = new Set(saved);
  homeOrder = [...saved, ...homeOrder.filter((k) => !saved.includes(k))];
  paintHome();
  checkHandle();
})();

const HOME_NAMES = { board: "작업 보드", progress: "진행 현황", blog: "블로그", notes: "작업 노트" };
let homeOrder = ["board", "progress", "blog", "notes"], homeOn = new Set();
function paintHome() {
  const list = $("home-widgets");
  list.innerHTML = "";
  homeOrder.forEach((k, i) => {
    const li = document.createElement("li");
    li.className = homeOn.has(k) ? "on" : "";
    li.dataset.k = k;
    li.innerHTML = `<label><input type="checkbox" ${homeOn.has(k) ? "checked" : ""}><span>${HOME_NAMES[k]}</span></label><button type="button" data-move="-1" aria-label="위로" ${i === 0 ? "disabled" : ""}>↑</button><button type="button" data-move="1" aria-label="아래로" ${i === homeOrder.length - 1 ? "disabled" : ""}>↓</button>`;
    list.append(li);
  });
}
$("home-widgets").addEventListener("change", (e) => { const k = e.target.closest("li").dataset.k; e.target.checked ? homeOn.add(k) : homeOn.delete(k); paintHome(); });
$("home-widgets").addEventListener("click", (e) => {
  const b = e.target.closest("[data-move]"); if (!b) return;
  const i = homeOrder.indexOf(b.closest("li").dataset.k), j = i + Number(b.dataset.move);
  [homeOrder[i], homeOrder[j]] = [homeOrder[j], homeOrder[i]]; paintHome();
});
$("home-save").addEventListener("click", async () => {
  const msg = $("home-msg"), btn = $("home-save");
  const widgets = homeOrder.filter((k) => homeOn.has(k));
  btn.disabled = true;
  try {
    const add = widgets.filter((k) => k !== "progress");
    if (add.length) { const r = await fetch("/api/home/starter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ presets: add }) }); if (!r.ok) throw r; }
    const res = await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ home_layout: { widgets } }) });
    if (!res.ok) throw res;
    msg.className = "msg ok"; msg.textContent = "홈을 저장했어요.";
  } catch { msg.className = "msg err"; msg.textContent = "저장하지 못했어요."; }
  finally { btn.disabled = false; }
});

fetch("/api/me/ai-usage").then((r) => (r.ok ? r.json() : null)).then((d) => {
  if (!d || !d.usage) return;
  const cap = (v) => (v === null || v === undefined ? "제한 없음" : Number(v).toLocaleString("ko-KR") + "회");
  const month = d.limits.callsPerMonth ?? null;
  $("ai-usage-month").textContent = "이번 달 AI 사용 " + Number(d.usage.month).toLocaleString("ko-KR") + (month === null ? "회" : "/" + cap(month));
  $("ai-usage-day").textContent = "오늘 " + Number(d.usage.day).toLocaleString("ko-KR") + "/" + cap(d.limits.callsPerDay);
  $("ai-usage").hidden = false;
}).catch(() => {});
