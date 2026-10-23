(function () {
  "use strict";
  var ROLES = [["full", "전체 허용"], ["edit", "편집 허용"], ["comment", "댓글 허용"], ["read", "읽기 허용"]];
  var LINK_ROLES = [["read", "읽기 허용"], ["comment", "댓글 허용"], ["edit", "편집 허용"]];
  var ICON = {
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20a15 15 0 0 1 0-20"/>',
    gear: '<path d="M12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3a1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8a1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  };
  function ico(name) { return '<svg class="shd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + "</svg>"; }
  function esc(text) { return String(text == null ? "" : text).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function options(list, value) { return list.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === value ? " selected" : "") + ">" + o[1] + "</option>"; }).join(""); }
  function roleName(role) { var found = ROLES.filter(function (r) { return r[0] === role; })[0]; return found ? found[1] : "권한 없음"; }
  function day(ms) { var d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

  var style = document.createElement("style");
  style.textContent = ".shd{--shd-accent:#1c7189;--shd-accent-soft:#e4f6fb;--shd-ink:#1f6f82;width:min(480px,calc(100% - 24px));max-height:calc(100dvh - 32px);overflow:auto;padding:0;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow-menu);font:var(--fs-14,14px)/1.5 var(--font-body)}html[data-theme=\"dark\"] .shd{--shd-accent:#57c3dc;--shd-accent-soft:#1d3a42;--shd-ink:#a6e6f4}html[data-theme=\"dark\"] .shd-primary{color:#16131f !important}@media (prefers-color-scheme:dark){html:not([data-theme=\"light\"]) .shd{--shd-accent:#57c3dc;--shd-accent-soft:#1d3a42;--shd-ink:#a6e6f4}html:not([data-theme=\"light\"]) .shd-primary{color:#16131f !important}}.shd::backdrop{background:rgba(30,28,50,.18)}.shd *{box-sizing:border-box}.shd button,.shd select,.shd input{font:inherit;color:inherit}.shd-tabs{display:flex;align-items:flex-end;gap:4px;padding:0 16px;border-bottom:1px solid var(--line)}.shd-tab{padding:12px 8px 10px;border:0;border-bottom:2px solid transparent;background:none;color:var(--fg-dim);cursor:pointer;font-weight:600;margin-bottom:-1px}.shd-tab[aria-selected=\"true\"]{color:var(--fg);border-bottom-color:var(--shd-accent)}.shd-help{margin-left:auto;display:inline-flex;align-items:center;gap:6px;padding:12px 0 10px;border:0;background:none;color:var(--fg-dim);cursor:pointer;font-size:var(--fs-13,13px)}.shd-help svg,.shd-ico{width:16px;height:16px;flex:none}.shd-body{padding:14px 16px 16px}.shd-panel[hidden],.shd [hidden]{display:none !important}.shd-helptext{margin:0 0 12px;padding:10px 12px;border-radius:10px;background:var(--bg-soft);color:var(--fg-dim);font-size:var(--fs-13,13px)}.shd-helptext p{margin:0 0 6px}.shd-helptext p:last-child{margin:0}.shd-invite{display:flex;gap:8px;align-items:stretch}.shd-invite input{flex:1;min-width:0;height:38px;padding:0 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);outline:none}.shd-invite input:focus{border-color:var(--shd-accent);box-shadow:0 0 0 3px var(--shd-accent-soft)}.shd-invite select{height:38px;max-width:104px;padding:0 6px;border:1px solid var(--line);border-radius:8px;background:var(--bg)}.shd-primary{height:38px;padding:0 16px;border:0;border-radius:8px;background:var(--shd-accent);color:#fff !important;font-weight:700;cursor:pointer;white-space:nowrap}.shd-primary:disabled,.shd-ghost:disabled{opacity:.55;cursor:wait}.shd-ghost{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);cursor:pointer;white-space:nowrap}.shd-ghost:hover,.shd-plain:hover{background:var(--bg-soft)}.shd-plain{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 8px;border:0;border-radius:8px;background:none;cursor:pointer;font-weight:600}.shd-danger{color:#c2414f !important}.shd-sent{margin:10px 0 0;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg-soft);font-size:var(--fs-13,13px)}.shd-sent p{margin:0 0 6px;color:var(--fg-dim)}.shd-copyrow{display:flex;gap:6px;align-items:center;margin-top:6px}.shd-copyrow input{flex:1;min-width:0;height:32px;padding:0 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);font:var(--fs-12,12px) var(--font-mono)}.shd-copyrow b{font:700 var(--fs-15,15px) var(--font-mono);letter-spacing:2px}.shd-list{margin:12px 0 0;padding:0;list-style:none}.shd-person{display:flex;align-items:center;gap:10px;padding:7px 0}.shd-avatar{width:32px;height:32px;flex:none;border-radius:50%;object-fit:cover;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent-strong);font-weight:700}.shd-who{flex:1;min-width:0}.shd-who strong{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.shd-who small{display:block;color:var(--fg-dim);font-size:var(--fs-12,12px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.shd-role{max-width:130px;height:32px;padding:0 4px;border:0;border-radius:6px;background:none;font-weight:600;cursor:pointer;text-align:right}.shd-role:hover{background:var(--bg-soft)}.shd-static{font-weight:600;padding:0 6px;white-space:nowrap}.shd-label{margin:14px 0 6px;color:var(--fg-dim);font-size:var(--fs-12,12px);font-weight:600}.shd-general{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.shd-tile{width:32px;height:32px;flex:none;display:grid;place-items:center;border-radius:8px;background:var(--bg-soft);color:var(--fg-dim)}.shd-tile.on{background:var(--shd-accent-soft);color:var(--shd-ink)}.shd-general select{height:32px;border:0;border-radius:6px;background:none;font-weight:600;cursor:pointer}.shd-general select:hover{background:var(--bg-soft)}.shd-general .shd-level{margin-left:auto}.shd-note{margin:4px 0 0 42px;color:var(--fg-dim);font-size:var(--fs-12,12px)}.shd-inherit{display:flex;align-items:center;gap:8px;margin-top:12px;padding:8px 10px;border-radius:8px;background:var(--bg-soft);font-size:var(--fs-13,13px)}.shd-inherit span{flex:1}.shd-switch{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0}.shd-switch span{flex:1}.shd-switch small{display:block;color:var(--fg-dim);font-size:var(--fs-12,12px)}.shd-switch input[type=\"checkbox\"]{width:18px;height:18px;accent-color:var(--shd-accent)}.shd-switch input[type=\"date\"],.shd-switch input[type=\"text\"],.shd-switch select{height:32px;padding:0 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);max-width:170px}.shd-sees{margin-top:12px;border-top:1px solid var(--line);padding-top:10px;font-size:var(--fs-13,13px)}.shd-sees summary{cursor:pointer;color:var(--fg-dim);font-weight:600}.shd-sees ul{margin:8px 0 0;padding-left:18px;color:var(--fg-dim)}.shd-requests{margin-top:12px;padding:10px 12px;border-radius:10px;background:#fff8e6;color:#6b4d00}html[data-theme=\"dark\"] .shd-requests{background:#3a3220;color:#f2d38a}.shd-requests .shd-person small{color:inherit;opacity:.8}.shd-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}.shd-adv{margin-top:10px;padding:4px 12px 8px;border:1px solid var(--line);border-radius:10px}.shd-adv h3{margin:8px 0 2px;font-size:var(--fs-13,13px);color:var(--fg-dim)}.shd-agent{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:var(--fs-13,13px)}.shd-agent span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.shd-agent small{color:var(--fg-dim)}.shd-agent select{height:30px;border:1px solid var(--line);border-radius:6px;background:var(--bg)}.shd-banner{display:flex;align-items:center;gap:8px;margin:12px 0 0;padding:10px 12px;border-radius:8px;background:var(--shd-accent-soft);color:var(--shd-ink)}.shd-banner button:first-child{flex:1;padding:0;border:0;background:none;color:inherit;text-align:left;cursor:pointer}.shd-banner .shd-x{width:24px;height:24px;border:0;border-radius:6px;background:none;color:inherit;cursor:pointer;font-size:var(--fs-17,17px);line-height:1}.shd-status{min-height:18px;margin:8px 0 0;color:var(--shd-ink);font-size:var(--fs-12,12px)}.shd-status.err{color:#c2414f}.shd-pub p{margin:0 0 10px;color:var(--fg-dim)}.shd-pub .shd-primary{width:100%}@media (max-width:480px){.shd{width:calc(100% - 16px);margin:auto 8px 8px;border-radius:16px}.shd-invite{flex-wrap:wrap}.shd-invite input{flex-basis:100%;height:44px}.shd-invite select,.shd-primary{height:44px}.shd-invite .shd-primary{flex:1}.shd-role,.shd-general select,.shd-ghost,.shd-plain{min-height:44px}}";
  document.head.appendChild(style);
  var dialog = document.createElement("dialog");
  dialog.className = "shd";
  dialog.setAttribute("aria-label", "공유");
  document.body.appendChild(dialog);
  var slug = "", state = null, me = null, tab = "share", sent = [], help = false, advanced = false, publishing = false;

  function api(path, method, body) {
    return fetch("/api/page/" + encodeURIComponent(slug) + "/access" + (path || ""), { method: method || "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { if (!res.ok) throw new Error(data.error || "요청하지 못했어요 (" + res.status + ")"); return data; }); });
  }
  function say(text, bad) { var node = dialog.querySelector(".shd-status"); if (node) { node.textContent = text || ""; node.classList.toggle("err", Boolean(bad)); } }
  function act(promise, done) { return promise.then(function (value) { return load().then(function () { if (done) say(done); return value; }); }).catch(function (error) { say(error.message, true); }); }
  function copy(text, label) {
    var finish = function () { say(label || "링크를 복사했어요."); };
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(finish, function () { say("복사하지 못했어요. 주소를 직접 복사해 주세요: " + text, true); });
    else say("주소를 직접 복사해 주세요: " + text);
  }
  function abs(path) { return new URL(path, location.origin).href; }
  function pageUrl() { return abs("/" + (slug === "index" ? "home" : encodeURIComponent(slug)) + "/"); }
  function publishCopy() {
    if (publishing || state.role !== "full") return;
    publishing = true;
    render();
    var published = state.publish && state.publish.url ? Promise.resolve(state.publish) : api("/publish", "POST");
    published.then(function (pub) {
      state.publish = Object.assign({}, state.publish, { url: pub.url });
      render();
      return copy(abs(pub.url), "링크를 복사했어요. " + abs(pub.url));
    }).catch(function (error) { say(error.message, true); }).finally(function () {
      publishing = false;
      var button = dialog.querySelector("[data-publish-copy]");
      if (button) button.disabled = false;
    });
  }

  function personRow(p) {
    var name = p.email.split("@")[0];
    var control = p.inherited
      ? '<span class="shd-static" title="상위 페이지에서 상속">' + roleName(p.role) + "</span>"
      : '<select class="shd-role" data-rule="' + esc(p.id) + '" aria-label="' + esc(p.email) + ' 권한">' + options(ROLES, p.role) + '<option disabled>──────</option><option value="code">새 초대 코드 만들기</option><option value="remove">권한 규칙 삭제</option></select>';
    return '<li class="shd-person"><span class="shd-avatar">' + esc(name.slice(0, 1).toUpperCase()) + '</span><span class="shd-who"><strong>' + esc(name) + "</strong><small>" + esc(p.email) + (p.inherited ? " · 상위 페이지에서 상속" : "") + (p.expires ? " · " + day(p.expires) + "까지" : "") + "</small></span>" + control + "</li>";
  }

  function sentHtml() {
    if (!sent.length) return "";
    return '<div class="shd-sent" role="status"><p>메일 발송이 아직 연결되지 않았어요. 아래 링크와 코드를 초대한 사람에게 직접 보내 주세요. 코드는 24시간 동안 쓸 수 있어요.</p>' + sent.map(function (s, i) {
      return '<div class="shd-copyrow"><span>' + esc(s.email) + '</span></div><div class="shd-copyrow"><input readonly value="' + esc(abs(s.url)) + '" aria-label="초대 링크"><b>' + esc(s.code) + '</b><button type="button" class="shd-ghost" data-copy-invite="' + i + '">복사</button></div>';
    }).join("") + "</div>";
  }

  function shareTab() {
    if (state.role !== "full") {
      return '<p class="shd-label">내 권한</p><div class="shd-general"><span class="shd-tile">' + ico("lock") + '</span><strong>' + roleName(state.role) + "</strong></div>" +
        (state.role === "edit" ? "" : '<div class="shd-foot"><span></span><button type="button" class="shd-ghost" data-ask-edit>편집 권한 요청</button></div>') +
        '<div class="shd-foot"><span></span><button type="button" class="shd-ghost" data-copy-page>' + ico("link") + "링크 복사</button></div>";
    }
    var link = state.link, onLink = Boolean(link && !link.inherited);
    var avatar = me && me.avatar ? '<img class="shd-avatar" src="' + esc(me.avatar) + '" alt="">' : '<span class="shd-avatar">' + esc((me && me.name || "나").slice(0, 1)) + "</span>";
    var html = '<form class="shd-invite"><input name="email" type="text" inputmode="email" autocomplete="off" placeholder="쉼표로 구분한 이메일" aria-label="초대할 이메일"><select name="role" aria-label="초대 권한">' + options(ROLES, "read") + '</select><button class="shd-primary" type="submit">공유하기</button></form>' + sentHtml() +
      '<ul class="shd-list"><li class="shd-person">' + avatar + '<span class="shd-who"><strong>' + esc(me && me.name || "나") + "(나)</strong><small>" + esc(me && me.email || "") + '</small></span><span class="shd-static">전체 허용</span></li>' + state.people.map(personRow).join("") + "</ul>";
    if (state.requests.length) {
      html += '<div class="shd-requests"><strong>권한 요청 ' + state.requests.length + "건</strong><ul class=\"shd-list\">" + state.requests.map(function (r) {
        return '<li class="shd-person"><span class="shd-who"><strong>' + esc(r.email) + "</strong><small>" + (r.role === "edit" ? "편집 허용" : "읽기 허용") + " 요청" + (r.note ? " · " + esc(r.note) : "") + '</small></span><button type="button" class="shd-ghost" data-request="' + esc(r.id) + '" data-decision="approve">승인</button><button type="button" class="shd-plain shd-danger" data-request="' + esc(r.id) + '" data-decision="deny">거절</button></li>';
      }).join("") + "</ul></div>";
    }
    html += '<p class="shd-label">일반 사용 권한</p><div class="shd-general"><span class="shd-tile' + (link ? " on" : "") + '">' + ico(link ? "globe" : "lock") + '</span><select data-general aria-label="일반 사용 권한"' + (link && link.inherited ? " disabled" : "") + '><option value="invited"' + (link ? "" : " selected") + '>초대받은 사용자만</option><option value="link"' + (link ? " selected" : "") + ">링크가 있는 모든 사용자</option></select>" +
      (onLink ? '<select class="shd-level" data-link-role aria-label="링크 권한">' + options(LINK_ROLES, link.role) + "</select>" : link ? '<span class="shd-static shd-level">' + roleName(link.role) + "</span>" : "") + "</div>" +
      '<p class="shd-note">' + (link ? (link.inherited ? "상위 페이지에서 상속한 링크예요. 바꾸려면 상위 페이지에서 바꿔 주세요." : link.role === "read" ? "링크가 있으면 누구나 읽을 수 있어요." : link.role === "edit" ? "링크가 있으면 누구나 읽을 수 있어요. 받는 사람은 이메일로 받은 코드를 확인한 뒤 편집할 수 있어요(회원가입 필요 없음)." : "링크가 있으면 누구나 읽을 수 있어요. 받는 사람은 이메일로 받은 코드를 확인한 뒤 댓글을 달 수 있어요(회원가입 필요 없음).") + (link.expires ? " " + day(link.expires) + "에 만료돼요." : "") : "초대받은 사람만 이 페이지를 열 수 있어요.") + "</p>";
    if (state.parent) {
      html += '<div class="shd-inherit"><span>' + (state.inherit ? "상위 페이지에서 상속: 상위 페이지를 공유받은 사람도 이 페이지를 볼 수 있어요." : "이 페이지만의 권한을 쓰고 있어요. 상위 페이지의 공유는 적용되지 않아요.") + '</span><button type="button" class="shd-ghost" data-inherit="' + (state.inherit ? "off" : "on") + '">' + (state.inherit ? "상속 끊기" : "상속 복원") + "</button></div>";
    }
    html += '<details class="shd-sees"><summary>다른 사람에게 표시되는 내용</summary><ul>' +
      (state.people.length ? state.people.map(function (p) { return "<li>" + esc(p.email) + ": " + roleName(p.role) + (p.inherited ? " (상위 페이지에서 상속)" : "") + "</li>"; }).join("") : "<li>초대한 사람이 없어요.</li>") +
      "<li>" + (link ? "링크가 있는 모든 사용자: <span>" + roleName(link.role) + "</span>" : "링크로는 열 수 없어요.") + "</li><li>" + (state.publish ? "웹에 게시됨: 누구나 게시 주소로 읽을 수 있어요." : "웹에 게시되지 않았어요.") + "</li>" +
      "<li>하위 페이지도 같은 권한을 상속해요. 사이드바와 검색에는 볼 수 있는 페이지만 보여요.</li></ul></details>";
    html += '<div class="shd-foot"><button type="button" class="shd-plain" data-adv aria-expanded="' + advanced + '">' + ico("gear") + '고급</button><button type="button" class="shd-ghost" data-copy-link>' + ico("link") + "링크 복사</button></div>";
    if (advanced) html += advancedHtml(onLink);
    html += '<div class="shd-foot"><button type="button" class="shd-primary" data-publish-copy' + (publishing ? " disabled" : "") + '>' + (state.publish && state.publish.url ? "게시 링크 복사" : "웹에 게시하고 링크 복사") + '</button></div>';
    return html;
  }

  function advancedHtml(onLink) {
    var s = state.settings, link = state.link;
    return '<div class="shd-adv"><h3>링크와 보호</h3>' +
      '<label class="shd-switch"><span>링크 만료<small>' + (onLink ? "이 날짜가 지나면 링크로 열 수 없어요." : "링크가 있는 모든 사용자로 바꾸면 정할 수 있어요.") + '</small></span><input type="date" data-expiry value="' + (link && link.expires ? day(link.expires) : "") + '"' + (onLink ? "" : " disabled") + "></label>" +
      '<label class="shd-switch"><span>검색 엔진 허용<small>게시한 페이지를 검색 결과에 보여요.</small></span><input type="checkbox" data-setting="allowIndex"' + (s.allowIndex ? " checked" : "") + "></label>" +
      themeHtml(s) +
      '<label class="shd-switch"><span>복제·내보내기 허용<small>끄면 내보내기·복제 버튼을 숨기고 서버에서 막아요 (화면 복사까지 막지는 못해요).</small></span><input type="checkbox" data-setting="allowExport"' + (s.allowExport ? " checked" : "") + "></label>" +
      "<h3>에이전트 사용 권한</h3>" + (state.agents.length ? state.agents.map(function (a) {
        return '<label class="shd-agent"><span>' + esc(a.name) + "<br><small>토큰 권한 " + (a.scopes.indexOf("write") >= 0 ? "읽기·쓰기" : "읽기") + " · 이 페이지에서 " + (a.effective.length ? (a.effective.indexOf("write") >= 0 ? "읽기·쓰기" : "읽기만") : "막힘") + (a.inherited ? " (상위 페이지 규칙)" : "") + '</small></span><select data-agent="' + esc(a.id) + '" aria-label="' + esc(a.name) + ' 권한">' +
          options([["inherit", "기본 (토큰 권한 그대로)"], ["write", "읽기·쓰기"], ["read", "읽기만"], ["none", "막기"]], a.inherited ? "inherit" : a.level) + "</select></label>";
      }).join("") + '<p class="shd-note" style="margin-left:0">페이지 규칙은 토큰 권한을 좁히기만 해요. 읽기 토큰에 쓰기를 줄 수는 없어요.</p>' : '<p class="shd-note" style="margin-left:0">연결된 에이전트 토큰이 없어요. 설정 &gt; 에이전트 연결에서 만들 수 있어요.</p>') + "</div>";
  }

  // issue 116: the theme a shared or published page opens in. "system" keeps the viewer's own setting.
  function themeHtml(s) {
    return '<label class="shd-switch"><span>보는 사람 테마<small>공유·게시 페이지가 이 테마로 열려요. 보는 사람은 화면에서 다시 바꿀 수 있어요.</small></span><select data-theme-pick aria-label="보는 사람 테마">' +
      options([["system", "보는 사람 설정 따름"], ["light", "항상 라이트"], ["dark", "항상 다크"]], s.theme || "system") + "</select></label>";
  }

  function publishTab() {
    if (state.role !== "full") return "<p>전체 허용 권한이 있는 사람만 게시할 수 있어요.</p>";
    var pub = state.publish, s = state.settings, html = '<div class="shd-pub">';
    if (!pub) html += "<p>이 페이지를 웹에 공개 페이지로 게시해요. 누구나 게시 주소로 읽을 수 있고, 다른 페이지와 댓글은 공개되지 않아요.</p><button type=\"button\" class=\"shd-primary\" data-publish>게시</button>";
    else {
      html += pub.url ? '<p>웹에 게시됐어요.</p><div class="shd-copyrow"><input readonly value="' + esc(abs(pub.url)) + '" aria-label="게시 주소"><button type="button" class="shd-ghost" data-copy-publish>' + ico("link") + '복사</button><a class="shd-ghost" href="' + esc(pub.url) + '" target="_blank" rel="noopener">사이트 보기</a></div>' : '<p>예전에 만든 공개 링크로 게시돼 있어요 (' + pub.legacy + "개). 주소는 만들 때만 보여요.</p><button type=\"button\" class=\"shd-ghost\" data-publish>새 게시 주소 만들기</button>";
      html += '<label class="shd-switch"><span>하위 페이지도 게시<small>켜면 하위 페이지도 게시 주소 아래에서 열려요.</small></span><input type="checkbox" data-setting="publishSubpages"' + (s.publishSubpages ? " checked" : "") + "></label>" +
        '<label class="shd-switch"><span>검색 엔진 색인<small>켜면 검색 엔진이 이 페이지를 찾을 수 있어요.</small></span><input type="checkbox" data-setting="allowIndex"' + (s.allowIndex ? " checked" : "") + "></label>" +
        themeHtml(s) +
        '<label class="shd-switch"><span>사이트 제목</span><input type="text" data-site-title maxlength="120" value="' + esc(s.siteTitle) + '" placeholder="비우면 페이지 제목"></label>' +
        '<div class="shd-foot"><span></span><button type="button" class="shd-ghost shd-danger" data-unpublish>게시 중단</button></div>';
    }
    return html + "</div>";
  }

  function render() {
    var helpHtml = help ? '<div class="shd-helptext"><p>이메일로 초대하면 그 사람은 받은 링크와 6자리 코드로 이 페이지와 하위 페이지만 열 수 있어요.</p><p>권한은 상위 페이지에서 하위 페이지로 상속돼요. 둘 이상이면 가장 넓은 권한을 따라요.</p><p>게시하면 웹에서 누구나 읽을 수 있는 공개 페이지가 생겨요.</p></div>' : "";
    dialog.innerHTML = '<div class="shd-tabs" role="tablist"><button type="button" role="tab" class="shd-tab" data-tab="share" aria-selected="' + (tab === "share") + '">공유</button>' + (state && state.role === "full" ? '<button type="button" role="tab" class="shd-tab" data-tab="publish" aria-selected="' + (tab === "publish") + '">게시</button>' : "") +
      '<button type="button" class="shd-help" data-help aria-expanded="' + help + '">' + ico("help") + "공유 기능 사용법</button></div>" +
      '<div class="shd-body">' + helpHtml + (state ? (tab === "share" ? shareTab() : publishTab()) : "<p>불러오는 중…</p>") + '<p class="shd-status" role="status" aria-live="polite"></p></div>';
  }

  function load() {
    return api().then(function (data) { state = data; render(); refocus(); });
  }
  function refocus() {
    if (dialog.open && !dialog.contains(document.activeElement)) { var first = dialog.querySelector("input:not([type=checkbox]),textarea") || dialog.querySelector("button:not(.shd-tab)"); if (first) first.focus(); }
  }

  dialog.addEventListener("click", function (event) {
    var t = event.target.closest("button, a");
    if (!t || !dialog.contains(t)) return;
    if (t.dataset.tab) { tab = t.dataset.tab; render(); }
    else if (t.hasAttribute("data-help")) { help = !help; render(); }
    else if (t.hasAttribute("data-adv")) { advanced = !advanced; render(); }
    else if (t.hasAttribute("data-banner-close")) { localStorage.setItem("acard-share-banner", "off"); render(); }
    else if (t.hasAttribute("data-copy-link")) copy(state.link ? abs(state.link.url) : pageUrl(), state.link ? "링크가 있는 모든 사용자용 주소를 복사했어요." : "페이지 주소를 복사했어요. 초대받은 사람만 열 수 있어요.");
    else if (t.hasAttribute("data-copy-page")) copy(pageUrl());
    else if (t.hasAttribute("data-copy-publish")) copy(abs(state.publish.url), "게시 주소를 복사했어요.");
    else if (t.hasAttribute("data-publish-copy")) publishCopy();
    else if (t.dataset.copyInvite) { var s = sent[Number(t.dataset.copyInvite)]; copy(abs(s.url) + "\n코드: " + s.code, "초대 링크와 코드를 복사했어요."); }
    else if (t.dataset.inherit) act(api("/settings", "PUT", { inherit: t.dataset.inherit === "on" }), t.dataset.inherit === "on" ? "상위 페이지 권한을 다시 상속해요." : "이 페이지만의 권한을 써요.");
    else if (t.dataset.request) act(api("/requests/" + t.dataset.request, "POST", { decision: t.dataset.decision }).then(function (data) { if (data.invite) sent = [data.invite]; }), t.dataset.decision === "approve" ? "요청을 승인했어요." : "요청을 거절했어요.");
    else if (t.hasAttribute("data-publish")) act(api("/publish", "POST"), "웹에 게시했어요.");
    else if (t.hasAttribute("data-unpublish")) { if (window.confirm("게시를 중단할까요? 게시 주소로는 더 열 수 없어요.")) act(api("/publish", "DELETE"), "게시를 중단했어요."); }
    else if (t.hasAttribute("data-ask-edit")) api("/request", "POST", { role: "edit" }).then(function () { say("편집 권한을 요청했어요."); }, function (error) { say(error.message, true); });
  });

  dialog.addEventListener("change", function (event) {
    var t = event.target;
    if (t.dataset.rule) {
      if (t.value === "remove") { if (window.confirm("이 사람의 권한을 지울까요?")) act(api("/rules/" + t.dataset.rule, "DELETE"), "권한 규칙을 삭제했어요."); else render(); }
      else if (t.value === "code") act(api("/rules/" + t.dataset.rule + "/code", "POST").then(function (data) { var person = state.people.filter(function (p) { return p.id === t.dataset.rule; })[0]; sent = [{ email: person ? person.email : "", url: data.url, code: data.code }]; }), "새 초대 코드를 만들었어요.");
      else act(api("/rules/" + t.dataset.rule, "PATCH", { role: t.value }), "권한을 바꿨어요.");
    } else if (t.hasAttribute("data-general")) {
      act(api("/general", "PUT", t.value === "link" ? { mode: "link", role: "read" } : { mode: "invited" }), t.value === "link" ? "링크가 있으면 누구나 읽을 수 있어요." : "초대받은 사람만 열 수 있어요.");
    } else if (t.hasAttribute("data-link-role")) {
      act(api("/general", "PUT", { mode: "link", role: t.value, expires: state.link.expires }), "링크 권한을 바꿨어요.");
    } else if (t.hasAttribute("data-expiry")) {
      var end = t.value ? new Date(t.value + "T23:59:59").getTime() : null;
      act(api("/general", "PUT", { mode: "link", role: state.link.role, expires: end }), end ? "링크가 " + t.value + "에 만료돼요." : "만료 날짜를 지웠어요.");
    } else if (t.dataset.setting) {
      var patch = {}; patch[t.dataset.setting] = t.checked;
      act(api("/settings", "PUT", patch), "설정을 바꿨어요.");
    } else if (t.hasAttribute("data-theme-pick")) {
      act(api("/settings", "PUT", { theme: t.value }), t.value === "system" ? "보는 사람의 테마 설정을 따라요." : t.value === "dark" ? "공유 페이지가 다크로 열려요." : "공유 페이지가 라이트로 열려요.");
    } else if (t.hasAttribute("data-site-title")) {
      act(api("/settings", "PUT", { siteTitle: t.value }), "사이트 제목을 저장했어요.");
    } else if (t.dataset.agent) {
      act(api("/agents", "PUT", { token: t.dataset.agent, level: t.value }), "에이전트 권한을 바꿨어요.");
    }
  });

  dialog.addEventListener("submit", function (event) {
    event.preventDefault();
    var form = event.target, email = form.email.value.trim();
    if (!email) { form.email.focus(); return; }
    var button = form.querySelector("button");
    button.disabled = true;
    api("", "POST", { email: email, role: form.role.value }).then(function (data) {
      sent = data.invites;
      return load().then(function () { say(data.invites.length + "명을 초대했어요."); });
    }).catch(function (error) { say(error.message, true); button.disabled = false; });
  });

  dialog.addEventListener("click", function (event) { if (event.target === dialog) dialog.close(); });

  var api_ = {
    open: function (page) {
      slug = page || "index"; state = null; sent = []; tab = "share"; advanced = false;
      render();
      if (!dialog.open) dialog.showModal();
      refocus();
      if (!me) fetch("/api/profile", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (d && d.email) { me = { email: d.email, name: (d.profile && d.profile.display_name) || d.email.split("@")[0], avatar: d.profile && d.profile.avatar_url }; if (state) { render(); refocus(); } }
      }).catch(function () {});
      load().catch(function (error) { dialog.querySelector(".shd-body").innerHTML = '<p class="shd-status err">' + esc(error.message) + "</p>"; });
    },
  };
  window.AcardShare = api_;
  if (window.AcardEditor) window.AcardEditor.provide("share-dialog", api_);
})();
