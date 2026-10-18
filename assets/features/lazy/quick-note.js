(function () {
  "use strict";
  var editor = window.AcardEditor, dialog, field, status, statusText, saveButton, inbox, opener, request, saving = false;
  function button(label) {
    return Array.from(document.querySelectorAll("button")).find(function (node) { return node.textContent.trim() === label; });
  }
  function close() {
    if (saving) return;
    dialog.close();
    if (opener && opener.isConnected) opener.focus();
  }
  function open() {
    if (!dialog) {
      var style = document.createElement("style");
      style.textContent = '.quick-note{box-sizing:border-box;width:min(600px,calc(100% - 32px));max-height:calc(100dvh - 32px);overflow:auto;padding:var(--space-6);border:1px solid var(--line);border-radius:var(--radius-md);background:var(--surface);color:var(--fg);box-shadow:var(--shadow-menu);font:var(--text-ui)/1.6 var(--font-body)}.quick-note::backdrop{background:#26252c40}.quick-note h2{display:flex;align-items:center;gap:var(--space-3);margin:0 0 var(--space-5);padding-right:var(--space-8);font-size:var(--fs-21,21px)}.quick-note-badge{display:grid;place-items:center;flex:none;width:40px;height:40px;border-radius:var(--radius-sm);background:var(--tag-blue-bg);color:var(--tag-blue-fg)}.quick-note-badge svg{width:24px;height:24px}.quick-note textarea{box-sizing:border-box;display:block;width:100%;min-height:176px;padding:var(--space-3);border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--bg);color:var(--fg);font:var(--text-body)/1.6 var(--font-body);resize:vertical}.quick-note-hint{text-align:right;margin:var(--space-2) 0;color:var(--fg-dim);font-size:var(--text-small)}.quick-note footer{display:flex;justify-content:flex-end;align-items:center;gap:var(--space-2);margin-top:var(--space-4)}.quick-note button{min-height:44px;padding:var(--space-2) var(--space-4);font:inherit;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--bg);color:var(--fg);cursor:pointer}.quick-note button:hover{background:var(--bg-soft)}.quick-note button[type=submit]{background:var(--accent);color:var(--on-accent)}.quick-note .quick-note-dismiss{position:absolute;top:var(--space-4);right:var(--space-4);width:44px;padding:0;border:0;background:transparent;color:var(--fg-dim);font-size:var(--fs-24,24px)}.quick-note button:disabled{opacity:.6;cursor:wait}.quick-note :focus-visible{outline:2px solid var(--accent);outline-offset:2px}.quick-note [role=status]{margin-top:var(--space-4);white-space:pre-wrap}.quick-note [role=status]:has(span:empty){display:none}.quick-note-success{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-2);padding:var(--space-3);border-radius:var(--radius-sm);background:var(--tag-green-bg);color:var(--tag-green-fg)}.quick-note [role=status] svg{display:none;width:20px;height:20px;flex:none}.quick-note .quick-note-success svg{display:block}.quick-note a{color:inherit;text-underline-offset:3px}.quick-note a[hidden]{display:none}@media(max-width:600px){.quick-note{margin:auto auto 16px;padding:var(--space-5)}.quick-note textarea{min-height:144px}.quick-note-success a{margin-left:28px}}';
      document.head.appendChild(style);
      dialog = document.createElement("dialog");
      dialog.className = "quick-note";
      dialog.setAttribute("aria-labelledby", "quick-note-title");
      dialog.innerHTML = '<form><h2 id="quick-note-title"><span class="quick-note-badge" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m13 6 5 5"/></svg></span>빠른 메모</h2><button type="button" class="quick-note-dismiss" aria-label="닫기">×</button><textarea id="quick-note-text" aria-label="메모" aria-describedby="quick-note-hint" maxlength="10000" placeholder="떠오른 생각을 적어 두세요"></textarea><div id="quick-note-hint" class="quick-note-hint">Ctrl/Cmd + Enter로 저장</div><div role="status" aria-live="polite"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="m7 12 3 3 7-7" fill="none" stroke="var(--tag-green-bg)" stroke-width="2"/></svg><span></span><a hidden>빠른 메모 열기</a></div><footer><button type="submit">저장</button><button type="button">닫기</button></footer></form>';
      document.body.appendChild(dialog);
      field = dialog.querySelector("textarea");
      status = dialog.querySelector('[role="status"]');
      statusText = status.querySelector("span");
      saveButton = dialog.querySelector('[type="submit"]');
      inbox = dialog.querySelector("a");
      dialog.querySelectorAll('[type="button"]').forEach(function (node) { node.onclick = close; });
      dialog.addEventListener("cancel", function (e) { e.preventDefault(); close(); });
      dialog.querySelector("form").onsubmit = function (e) { e.preventDefault(); save(); };
      field.addEventListener("keydown", function (e) { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !e.isComposing) { e.preventDefault(); save(); } });
    }
    opener = document.activeElement;
    var menu = document.getElementById("more-menu");
    if (menu) menu.hidden = true;
    if (!dialog.open) dialog.showModal();
    field.focus();
  }
  async function save() {
    if (saving) return;
    status.classList.remove("quick-note-success");
    inbox.hidden = true;
    var text = field.value.trim();
    if (!text) { statusText.textContent = "메모를 적어 주세요."; return; }
    if (!request || request.text !== text) request = { clientId: crypto.randomUUID(), text: text };
    saving = true; saveButton.disabled = true; field.readOnly = true;
    statusText.textContent = "저장 중…";
    try {
      var response = await fetch("/api/quick-note", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(15000) });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error || "저장하지 못했어요. 로그인과 연결을 확인해 주세요.");
      statusText.textContent = "저장됨 · 빠른 메모에 추가했어요";
      status.classList.add("quick-note-success");
      inbox.href = "/" + encodeURIComponent(data.slug) + "/"; inbox.hidden = false;
      field.value = ""; request = null;
    } catch (error) {
      statusText.textContent = error instanceof TypeError || error.name === "TimeoutError" || navigator.onLine === false
        ? "오프라인이거나 연결이 끊겼어요. 메모는 이 창에 남아 있어요. 연결 후 저장을 다시 눌러 주세요."
        : error.message;
    } finally { saving = false; saveButton.disabled = false; field.readOnly = false; }
  }
  async function run(key) {
    if (key === "q") return open();
    if (key === "/" || key === "k") return document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    if (key === "?") return document.getElementById("shortcuts-open").click();
    if (key === "gh") { location.href = "/"; return; }
    if (key === "gt") return (document.querySelector('[data-act="trash"]') || button("휴지통")).click();
    if (key === "n") {
      try {
        if (editor) await editor.save();
        if (editor && editor.openTemplatePicker) return editor.openTemplatePicker();
        var response = await fetch("/api/pages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "제목 없음" }) });
        var page = await response.json();
        if (!response.ok) throw new Error(page.error || "새 페이지를 만들지 못했어요.");
        location.href = "/edit/" + encodeURIComponent(page.slug) + "/?templates";
      } catch (error) { alert(error.message || "연결을 확인해 주세요."); }
    }
  }
  window.AcardQuickNote = { run: run };
  if (editor) editor.provide("quick-note", window.AcardQuickNote);
})();
