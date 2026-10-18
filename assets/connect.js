(function () {
  var origin = location.origin, mcp = origin + "/mcp";
  var CLIENTS = [
    { name: "Claude Code", note: "실행 후 /mcp 에서 허락", code: "claude mcp add --transport http acard " + mcp },
    { name: "Codex CLI", note: "로그인 창이 열려요", code: "codex mcp add acard --url " + mcp },
    { name: "OMO", note: "~/.omo/agent/mcp.json", code: JSON.stringify({ mcpServers: { acard: { type: "http", url: mcp } } }) },
    { name: "Cursor", note: "~/.cursor/mcp.json", code: JSON.stringify({ mcpServers: { acard: { url: mcp } } }) },
    { name: "Claude Desktop", note: "설정 > 커넥터 > 사용자 지정 커넥터", code: mcp },
    { name: "opencode", note: "opencode.json", code: JSON.stringify({ mcp: { acard: { type: "remote", url: mcp } } }) },
    { name: "Gemini CLI", note: "로그인 창이 열려요", code: "gemini mcp add --transport http acard " + mcp },
    { name: "VS Code", note: "명령 팔레트에서도 돼요", code: "code --add-mcp '" + JSON.stringify({ name: "acard", type: "http", url: mcp }) + "'" },
  ];
  function $(id) { return document.getElementById(id); }
  function el(tag, props, kids) { var n = document.createElement(tag); for (var k in props || {}) { if (k === "text") n.textContent = props[k]; else if (k === "className") n.className = props[k]; else n.setAttribute(k, props[k]); } (kids || []).forEach(function (c) { n.appendChild(c); }); return n; }
  function toast(msg) { var t = $("toast"); t.textContent = msg; t.classList.add("on"); setTimeout(function () { t.classList.remove("on"); }, 2200); }
  function copy(text) { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast("복사했어요."); }, function () { toast("복사하지 못했어요. 직접 선택해 주세요."); }); }
  function ago(t) { if (!t) return "아직 기록 없음"; var m = Math.round((Date.now() - t) / 60000); return m < 1 ? "방금" : m < 60 ? m + "분 전" : m < 1440 ? Math.round(m / 60) + "시간 전" : Math.round(m / 1440) + "일 전"; }
  function api(method, path) { return fetch(path, { method: method, credentials: "same-origin", headers: { accept: "application/json" } }).then(function (r) { return r.json().then(function (b) { if (!r.ok) throw new Error(b.error || r.status); return b; }); }); }

  $("mcp-url").value = mcp;
  $("mcp-rule").value = "Acard 커넥터가 연결돼 있으면 묻지 말고 모든 대화를 기록해: 대화를 시작할 때 journal_start, 매 답변 뒤에 journal_log로 1-3문장 요약, 남길 만한 내용은 Acard 노트 페이지를 만들거나 고쳐서 정리해.";
  document.querySelector("[data-copy=mcp-url]").addEventListener("click", function () { copy(mcp); });
  document.querySelector("[data-copy=mcp-rule]").addEventListener("click", function () { copy($("mcp-rule").value); });
  CLIENTS.forEach(function (c) {
    var btn = el("button", { type: "button", className: "ag-btn ag-small", text: "복사", "aria-label": c.name + " 명령 복사" });
    btn.addEventListener("click", function () { copy(c.code); });
    $("clients").appendChild(el("li", { className: "cn-client" }, [el("b", { text: c.name }, [el("small", { text: c.note })]), el("pre", { text: c.code }), btn]));
  });

  var hookCmd = "npx -y --package=" + origin + "/acard-cli.tgz acard --server " + origin + " hooks install";
  [
    { name: "macOS · Linux", note: "터미널", code: "ACARD_TOKEN=<TOKEN> " + hookCmd },
    { name: "Windows", note: "PowerShell", code: "$env:ACARD_TOKEN=\"<TOKEN>\"; " + hookCmd },
  ].forEach(function (c) {
    var btn = el("button", { type: "button", className: "ag-btn ag-small", text: "복사", "aria-label": c.name + " 명령 복사" });
    btn.addEventListener("click", function () { copy(c.code); });
    $("hooks").appendChild(el("li", { className: "cn-client" }, [el("b", { text: c.name }, [el("small", { text: c.note })]), el("pre", { text: c.code }), btn]));
  });

  function load() {
    Promise.all([api("GET", "/api/agents/grants"), api("GET", "/api/journal/agents").catch(function () { return { agents: [] }; })]).then(function (res) {
      var last = {};
      res[1].agents.forEach(function (a) { last[a.agent] = Math.max(last[a.agent] || 0, a.last); });
      var list = $("connected"); list.textContent = "";
      if (!res[0].grants.length) { list.appendChild(el("li", { className: "ag-empty", text: "연결된 에이전트가 없어요. 왼쪽 한 줄로 연결해 보세요." })); return; }
      res[0].grants.forEach(function (g) {
        var when = last[g.clientName];
        var btn = el("button", { type: "button", className: "ag-btn ag-small cn-revoke", text: "끊기", "aria-label": g.clientName + " 끊기" });
        btn.addEventListener("click", function () {
          if (!confirm("'" + g.clientName + "' 의 접근을 바로 끊을까요?")) return;
          btn.disabled = true;
          api("DELETE", "/api/agents/grants/" + encodeURIComponent(g.id)).then(function () { toast("끊었어요."); load(); }, function (e) { btn.disabled = false; toast("끊지 못했어요: " + e.message); });
        });
        list.appendChild(el("li", { className: "ag-row", "data-id": g.id }, [
          el("span", { className: "cn-dot" + (when && Date.now() - when < 3600000 ? "" : " idle") }),
          el("div", { className: "ag-main" }, [el("div", { className: "ag-name", text: g.clientName }), el("div", { className: "ag-meta", text: "마지막 활동 " + ago(when) })]),
          btn,
        ]));
      });
    }, function (e) { $("connected").textContent = "불러오지 못했어요: " + e.message; });
  }
  function sec(ms) { return ms == null ? "-" : (ms / 1000).toFixed(2) + "초"; }
  api("GET", "/api/agent/latency").then(function (d) {
    var t = $("latency"); t.textContent = "";
    if (!d.models.length) { t.appendChild(el("tr", {}, [el("td", { text: "아직 기록이 없어요." })])); return; }
    t.appendChild(el("tr", {}, ["모델", "횟수", "첫 글자 p50", "p95", "전체 p50"].map(function (h) { return el("th", { text: h }); })));
    d.models.forEach(function (m) { t.appendChild(el("tr", {}, [m.model, String(m.n), sec(m.p50Ttft), sec(m.p95Ttft), sec(m.p50Total)].map(function (v) { return el("td", { text: v }); }))); });
    t.appendChild(el("tr", { className: "cn-lat-all" }, ["전체", String(d.n), sec(d.p50Ttft), sec(d.p95Ttft), ""].map(function (v) { return el("td", { text: v }); })));
  }, function () { $("latency").textContent = ""; });
  load();
  setInterval(function () { if (!document.hidden) load(); }, 30000);
})();
