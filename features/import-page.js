(() => {
  function importPageHtml() {
    const versions = globalThis.ACARD_STATIC_VERSIONS || {};
    const asset = ext => "/lazy/import." + ext + (versions["lazy/import." + ext] ? "?v=" + versions["lazy/import." + ext] : "");
    return [
      '<!doctype html><html lang="ko"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
      '<meta name="robots" content="noindex, nofollow"><meta name="color-scheme" content="light dark">',
      '<title>노션에서 가져오기 · Acard</title><link rel="icon" href="/favicon.svg" type="image/svg+xml">',
      '<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/editor.css">',
      '<link rel="stylesheet" href="/acard-shell.css"><link rel="stylesheet" href="/acard-mobile.css">',
      '<link rel="stylesheet" href="' + asset("css") + '"></head><body class="reader">',
      '<a class="skip" href="#main">본문으로</a>',
      mobileBarHtml("Acard"),
      '<div class="shell"><nav class="sidebar" id="sidebar" aria-label="문서 목록">',
      sideNavHtml([], "import", "Acard").replace('<div class="side-ws">', PJ_SIDE_PH + '<div class="side-ws">'),
      sideFootHtml(),
      '</nav><main id="main" class="import-main"><div id="results" class="results" hidden></div>',
      '<section id="import-page" aria-labelledby="import-title">',
      '<header class="import-heading"><h1 id="import-title">노션에서 가져오기</h1>',
      '<p>노션에서 내보낸 파일을 그대로 옮겨요. 원본은 바뀌지 않아요.</p></header>',
      '<div id="import-drop" class="import-drop" aria-describedby="import-limits">',
      '<svg class="import-upload-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M28 4H12a4 4 0 0 0-4 4v32a4 4 0 0 0 4 4h24a4 4 0 0 0 4-4V16Z"/><path d="M28 4v12h12M24 34V23m-5 5 5-5 5 5"/></svg>',
      '<h2>zip 또는 .md 파일을 여기에 끌어다 놓으세요</h2><p class="import-or">또는</p>',
      '<button type="button" class="import-pick" id="import-pick">파일 고르기</button>',
      '<input type="file" id="import-files" accept=".zip,.md" multiple hidden>',
      '<p id="import-limits" class="import-limits">ZIP 최대 30MB · Markdown 파일당 최대 2MB</p></div>',
      '<div id="import-status" class="import-status" role="status" aria-live="polite" aria-atomic="true" hidden></div>',
      '<section class="import-card" aria-labelledby="import-help-title"><h2 id="import-help-title">노션에서 내보내는 법</h2>',
      '<ol class="import-steps"><li>노션 왼쪽 위 ··· → 설정 → 내보내기</li>',
      '<li>형식은 Markdown &amp; CSV, 하위 페이지 포함</li><li>받은 zip을 위에 놓기</li></ol></section>',
      '<section class="import-card import-results" id="import-results" aria-labelledby="import-results-title" hidden>',
      '<h2 id="import-results-title">가져온 페이지</h2><ul id="import-pages"></ul></section>',
      '</section></main></div>',
      thumbBarHtml("import"), paletteHtml(), shortcutsHtml(), sidePanelHtml(),
      '<script src="/app.js"></script>', FOLDERS_TAG,
      '<script src="' + asset("js") + '"></script></body></html>',
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
