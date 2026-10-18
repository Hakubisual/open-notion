(() => {
  const editor = window.AcardEditor;
  if (!editor) return;
  const panel = document.createElement("dialog");
  panel.className = "ask-notes";
  panel.setAttribute("aria-labelledby", "ask-notes-title");
  panel.innerHTML = '<header><h2 id="ask-notes-title">내 노트에 묻기</h2><button type="button" aria-label="닫기">닫기</button></header><p class="ask-hint">내 노트에서 답을 찾고, 출처를 함께 보여 드려요.</p><form><label for="ask-notes-question">궁금한 내용</label><textarea id="ask-notes-question" maxlength="500" required rows="3" placeholder="예: 프로젝트 출시는 언제인가요?"></textarea><div class="ask-actions"><span>500자까지 물어볼 수 있어요.</span><button type="submit">묻기</button></div></form><p class="ask-status" role="status"></p><section class="ask-result" hidden><h3>노트에서 찾은 답</h3><div class="ask-answer"></div><h3>참고한 노트</h3><div class="ask-sources"></div></section>';
  document.body.append(panel);
  const form = panel.querySelector("form"), question = panel.querySelector("textarea");
  const submit = form.querySelector("button"), status = panel.querySelector(".ask-status");
  const result = panel.querySelector(".ask-result"), answer = panel.querySelector(".ask-answer"), sources = panel.querySelector(".ask-sources");
  let controller, opener;
  const link = (source, label) => {
    const anchor = document.createElement("a");
    anchor.href = "/" + encodeURIComponent(source.slug) + "/#block-" + encodeURIComponent(source.block_id);
    anchor.textContent = label;
    return anchor;
  };
  panel.querySelector("header button").onclick = () => panel.close();
  panel.addEventListener("close", () => {
    if (controller) controller.abort();
    controller = null;
    submit.disabled = false;
    form.removeAttribute("aria-busy");
    status.textContent = "";
    opener?.focus();
  });
  form.onsubmit = async event => {
    event.preventDefault();
    if (controller || !question.value.trim()) return;
    const request = controller = new AbortController();
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    status.textContent = "노트를 찾아 답을 쓰고 있어요…";
    result.hidden = true;
    try {
      const data = await editor.api("/ai/ask", { method: "POST", body: JSON.stringify({ question: question.value }), signal: request.signal });
      if (request.signal.aborted) return;
      answer.replaceChildren();
      for (const part of data.answer.split(/(\[\d+\])/)) {
        const source = data.sources.find(source => part === "[" + source.n + "]");
        answer.append(source ? link(source, part) : document.createTextNode(part));
      }
      sources.replaceChildren();
      data.sources.forEach(source => {
        const card = link(source, "[" + source.n + "] " + source.title);
        const snippet = document.createElement("span");
        snippet.textContent = source.snippet;
        card.append(snippet);
        sources.append(card);
      });
      sources.previousElementSibling.hidden = !data.sources.length;
      result.hidden = false;
      status.textContent = data.sources.length ? "답을 찾았어요. 번호를 누르면 원문으로 이동해요." : "";
    } catch (error) {
      if (!request.signal.aborted) status.textContent = error.message;
    } finally {
      if (controller === request) {
        controller = null;
        submit.disabled = false;
        form.removeAttribute("aria-busy");
      }
    }
  };
  editor.provide("ask-notes", { open(button) { opener = button; panel.showModal(); question.focus(); } });
})();
