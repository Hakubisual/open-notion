(function () {
  "use strict";
  var editor = window.AcardEditor;
  if (!editor) return;
  var active = null;

  function button(text, action, primary) {
    var node = document.createElement("button");
    node.type = "button";
    node.textContent = text;
    if (primary) node.className = "photo-text-primary";
    node.addEventListener("click", action);
    return node;
  }

  async function compress(file) {
    if (!file.type.startsWith("image/")) throw Error("사진 파일을 선택해 주세요.");
    var image;
    try { image = await createImageBitmap(file); }
    catch (_) { throw Error("이 사진을 열 수 없어요. JPEG나 PNG로 다시 선택해 주세요."); }
    try {
      var scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      var canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      var context = canvas.getContext("2d");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (var quality = 0.9; quality >= 0.3; quality -= 0.15) {
        var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, "image/jpeg", quality); });
        if (!blob) throw Error("사진을 변환하지 못했어요.");
        if (blob.size <= 1.5 * 1024 * 1024) return blob;
      }
      throw Error("사진이 너무 커요. 글이 있는 부분만 잘라 다시 선택해 주세요.");
    } finally { image.close(); }
  }

  function open(id) {
    if (active) return;
    var dialog = document.createElement("dialog");
    dialog.className = "photo-text-dialog";
    dialog.setAttribute("aria-labelledby", "photo-text-title");
    var title = document.createElement("h2");
    title.id = "photo-text-title";
    title.innerHTML = '<span class="photo-text-badge" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></svg></span>사진에서 글 가져오기';
    var help = document.createElement("p");
    help.textContent = "사진을 고르거나 촬영해 주세요.";
    var status = document.createElement("p");
    status.setAttribute("role", "status");
    var fields = document.createElement("div");
    fields.className = "photo-text-fields";
    var actions = document.createElement("div");
    actions.className = "photo-text-actions";
    var note = document.createElement("p");
    note.className = "photo-text-note";
    note.textContent = "사진은 저장하지 않아요. 글을 읽을 때만 Cloudflare AI로 보내요.";
    var controller = new AbortController(), previousFocus = document.activeElement, previewUrl;
    active = dialog;

    function close() {
      controller.abort();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      dialog.close();
      dialog.remove();
      active = null;
      if (previousFocus && previousFocus.isConnected) previousFocus.focus();
    }
    dialog.addEventListener("cancel", function (event) { event.preventDefault(); close(); });
    var dismiss = button("×", close);
    dismiss.className = "photo-text-dismiss";
    dismiss.setAttribute("aria-label", "닫기");
    var cancel = button("취소", close);
    actions.append(cancel);

    async function choose(event) {
      var file = event.target.files[0];
      if (!file) return;
      fields.querySelectorAll("input").forEach(function (input) { input.disabled = true; });
      status.textContent = "사진에서 글을 읽고 있어요…";
      try {
        var blob = await compress(file);
        if (controller.signal.aborted) return;
        var result = await editor.api("/ai/photo-text", {
          method: "POST", headers: { "content-type": "image/jpeg" }, body: blob, signal: controller.signal
        });
        if (controller.signal.aborted) return;
        fields.replaceChildren();
        dialog.classList.add("photo-text-preview");
        fields.classList.add("photo-text-columns");
        previewUrl = URL.createObjectURL(file);
        var preview = document.createElement("img");
        preview.className = "photo-text-image";
        preview.src = previewUrl;
        preview.alt = "선택한 사진";
        help.textContent = "읽어 온 글을 확인하고 고쳐 주세요.";
        status.textContent = result.text ? "" : "읽을 수 있는 글이 없어요. 다른 사진을 선택해 주세요.";
        var text = document.createElement("textarea");
        text.id = "photo-text-result";
        text.setAttribute("aria-label", "읽어 온 글");
        text.value = result.text;
        text.rows = 8;
        var resultField = document.createElement("div");
        resultField.className = "photo-text-result";
        var resultLabel = document.createElement("label");
        resultLabel.htmlFor = text.id;
        resultLabel.textContent = "읽은 글";
        resultField.append(resultLabel, text);
        fields.append(preview, resultField);
        var insert = button("아래에 넣기", function () {
          var block = editor.state.blocks.find(function (item) { return item.id === id; });
          if (!block) { status.textContent = "원래 블록이 없어졌어요. 닫고 다시 선택해 주세요."; return; }
          if (!text.value.trim()) { status.textContent = "넣을 글을 입력해 주세요."; return; }
          editor.insertBlocksAfter(id, text.value.trim().split(/\r?\n/).map(function (line) {
            return { type: "paragraph", text: line, indent: block.indent };
          }));
          if (block.text === "/") editor.replaceBlockText(id, "");
          close();
        }, true);
        insert.disabled = !result.text.trim();
        text.addEventListener("input", function () { insert.disabled = !text.value.trim(); });
        var reselect = button("다시 고르기", function () { close(); open(id); });
        reselect.className = "photo-text-secondary";
        cancel.className = "photo-text-cancel";
        actions.replaceChildren(insert, reselect, cancel);
        text.focus();
      } catch (error) {
        if (!controller.signal.aborted) {
          status.textContent = error.message;
          fields.querySelectorAll("input").forEach(function (input) { input.disabled = false; input.value = ""; });
        }
      }
    }

    function picker(label, camera) {
      var wrapper = document.createElement("label");
      wrapper.textContent = label;
      var input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.setAttribute("aria-label", label);
      if (camera) input.setAttribute("capture", "environment");
      input.addEventListener("change", choose);
      wrapper.appendChild(input);
      fields.appendChild(wrapper);
    }
    picker("사진 선택", false);
    if (matchMedia("(pointer: coarse)").matches) picker("사진 촬영", true);
    dialog.append(title, dismiss, help, fields, status, note, actions);
    document.body.appendChild(dialog);
    dialog.showModal();
  }
  editor.provide("photo-text", { open: open });
})();
