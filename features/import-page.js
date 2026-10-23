(() => {
  function importPageHtml() {
    const versions = globalThis.ACARD_STATIC_VERSIONS || {};
    const lazy = (name, ext) => "/lazy/" + name + "." + ext + (versions["lazy/" + name + "." + ext] ? "?v=" + versions["lazy/" + name + "." + ext] : "");
    const line = (d) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>";
    const guide = (id, title, icon, steps) => [
      '<section class="import-guide" aria-labelledby="' + id + '">',
      '<span class="import-guide-icon" aria-hidden="true">' + line(icon) + "</span>",
      '<div class="import-guide-body"><h2 id="' + id + '">' + title + "</h2>",
      '<ol class="import-steps">' + steps.map((s) => "<li>" + s + "</li>").join("") + "</ol></div></section>",
    ].join("");
    return [
      '<!doctype html><html lang="ko"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
      '<meta name="robots" content="noindex, nofollow"><meta name="color-scheme" content="light dark">',
      '<title>노션·옵시디언에서 가져오기 · Acard</title><link rel="icon" href="/favicon.svg" type="image/svg+xml">',
      '<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/editor.css">',
      '<link rel="stylesheet" href="/acard-shell.css"><link rel="stylesheet" href="/acard-mobile.css">',
      '<link rel="stylesheet" href="' + lazy("import", "css") + '"></head><body class="reader">',
      '<a class="skip" href="#main">본문으로</a>',
      mobileBarHtml("Acard"),
      '<div class="shell"><nav class="sidebar" id="sidebar" aria-label="문서 목록">',
      sideNavHtml([], "import", "Acard").replace('<div class="side-ws">', PJ_SIDE_PH + '<div class="side-ws">'),
      sideFootHtml(),
      '</nav><main id="main" class="import-main" data-live-keep><div id="results" class="results" hidden></div>',
      '<section id="import-page" aria-labelledby="import-title" data-engine="' + lazy("import-engine", "js") + '" data-notion="' + lazy("import-notion", "js") + '" data-obsidian="' + lazy("import-obsidian", "js") + '">',
      '<header class="import-heading"><h1 id="import-title">노션·옵시디언에서 가져오기</h1>',
      '<p>내보낸 파일을 그대로 옮겨요. 원본은 바뀌지 않아요.</p></header>',
      '<div class="import-guides">',
      guide("import-notion-title", "노션에서 내보내는 법", '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>', ["··· → 설정 → 내보내기", "Markdown &amp; CSV, 하위 페이지 포함", "받은 zip을 위에 놓기"]),
      guide("import-vault-title", "옵시디언 볼트 옮기는 법", '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 10v6m-3-3 3 3 3-3"/>', ["볼트 폴더를 고르거나", "폴더를 zip으로 압축해", "위에 놓기"]),
      "</div>",
      '<div id="import-drop" class="import-drop" aria-describedby="import-limits">',
      '<span class="import-upload-icon" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M24 30V10m-8 8 8-8 8 8"/><path d="M8 30v6a4 4 0 0 0 4 4h24a4 4 0 0 0 4-4v-6"/></svg></span>',
      '<h2>zip 파일이나 볼트 폴더를 여기에 끌어다 놓으세요</h2>',
      '<div class="import-buttons"><button type="button" class="import-btn is-primary" id="import-pick">zip 파일 고르기</button>',
      '<button type="button" class="import-btn is-secondary" id="import-folder-pick">폴더 고르기</button></div>',
      '<input type="file" id="import-files" accept=".zip,.md" multiple hidden>',
      '<input type="file" id="import-folder" webkitdirectory multiple hidden>',
      '<p id="import-limits" class="import-limits">한 번에 500MB · 파일 하나 10MB까지</p></div>',
      '<div id="import-status" class="import-status" role="status" aria-live="polite" aria-atomic="true" hidden></div>',
      '<section id="import-progress" class="import-card import-progress" hidden><div class="import-progress-row"><div class="import-progress-main">',
      '<p id="import-progress-text" class="import-progress-text" role="status" aria-live="polite"></p>',
      '<div id="import-bar" class="import-bar" role="progressbar" aria-labelledby="import-progress-text" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0"><span id="import-bar-fill"></span></div>',
      '<p id="import-progress-sub" class="import-progress-sub"></p></div>',
      '<button type="button" class="import-btn is-secondary" id="import-stop" disabled>멈추기</button></div></section>',
      '<section id="import-result" class="import-card import-result" role="status" aria-live="polite" hidden></section>',
      '<section id="import-error" class="import-card import-error" role="status" aria-live="polite" hidden></section>',
      '<div id="import-dialog" class="import-dialog" hidden></div>',
      '</section></main></div>',
      thumbBarHtml("import"), paletteHtml(), shortcutsHtml(), sidePanelHtml(),
      '<script src="/app.js"></script>', FOLDERS_TAG,
      '<script src="' + lazy("import", "js") + '"></script></body></html>',
    ].join("\n");
  }

  registerFeature({
    authenticatedRoutes: async ({ path, method }) => {
      if (path !== "/import" && path !== "/import/") return null;
      if (method !== "GET" && method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
      return new Response(method === "HEAD" ? null : importPageHtml(), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" },
      });
    },
  });
})();
