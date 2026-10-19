# Client features

Add top-level `assets/features/*.js` and `*.css` files, using these suffixes:

- Ordinary `.js` and `.css` files go into `/features.js` and `/features.css`,
  loaded ONLY by `editor.html`, after `editor.js`.
- `.reader.js` and `.reader.css` files go ONLY into `/features-reader.js` and
  `/features-reader.css`, loaded by static reader layouts and worker `pageShell`.
- `.shared.js` files go into both JavaScript bundles. This is the explicit
  opt-in for code needed on both surfaces. There is no shared CSS suffix;
  `.shared.css` remains an ordinary editor-only stylesheet.

Each bundle preserves sorted filename order and uses content-hash URLs. Empty
or whitespace-only inputs contribute no content. Each reader tag is omitted
entirely when its corresponding bundle is empty, including in `pageShell`.
Editor-only features therefore do not consume the reader first-screen budget.
README files and original feature sources are not shipped. Empty bundle files
are valid. Scripts are classic scripts: use an IIFE and no imports or exports.
Check `window.AcardEditor` or `window.AcardReader` before installing a feature.
No runtime CDN or third-party client dependencies.

## Lazy editor features

Put heavy feature code in `assets/features/lazy/<name>.js`, optionally with
`<name>.css`; names use lowercase letters, digits and hyphens. These classic
scripts are emitted only as `dist/lazy/<name>.js|css`, never concatenated into
either feature bundle. The build prefixes `features.js` with `window.AcardLazy`,
a name-to-extension-to-content-hash map. Each asset loads with its own `?v=hash`.

Call `AcardEditor.lazy(name)` only when the user opens that feature. It returns
the same cached Promise for every call, loads the script and optional stylesheet
once, and resolves after both load with the API registered synchronously by the
chunk through `AcardEditor.provide(name, api)`. Missing chunks, load failures, or
missing registration reject the cached Promise; callers display a failure state.
Do not preload lazy chunks or add them to HTML tags or eager CSS imports.

Lazy JS and CSS count in total client raw bytes, not either first screen. Each
chunk's combined JS + optional CSS must fit `caps.lazyMaxRaw` (40,000 bytes).
Reader/editor first-screen caps stay fixed as the total feature collection grows.

`AcardEditor` exposes:

- `on(event, fn)` registers a synchronous listener and returns an unsubscribe
  function. Events are `ready` (editor API), `beforeSave` (mutable `{ title,
  blocks }` payload), `saved` (that payload) and `saveFailed` (Error). Listener
  errors are logged and isolated. `ready` fires after initial page render and
  setup; late subscribers receive it immediately.
- `state` is a getter for the live editor state; `slug` is the editor URL slug.
- `api(path, options)` requests `/api` + path and resolves parsed JSON, rejecting
  non-OK responses; `scheduleSave()`, `render()`, `setSave(text, on)`, and `save()`
  retain the core contracts. `save()` returns a promise and drains dirty changes.
- `transport(slug, payload)` is replaceable, returns `Promise<Response>`, and
  defaults to JSON `PUT /api/page/<encoded slug>`. Save parses the response and
  checks its status. Wrap the previous function to compose transports.
- `insertBlocksAfter(id, blocks)` inserts after that block's subtree, supplies
  missing block defaults/IDs, renders, schedules saving and returns inserted
  IDs. An unknown anchor throws. Supplied IDs must be unique.
- `replaceBlockText(id, text)` replaces plain text, clears stale rich text,
  renders and schedules saving. An unknown block throws.
- `getSelection()` returns `{ text, blockId, blockIds }`: native selected text,
  anchor block ID (or null), and checkbox-selected block IDs. No DOM Range is
  retained across rendering.

`AcardReader = { on(event, fn), slug }`: `on("ready", fn)` calls the listener
with the reader API after DOMContentLoaded (or immediately if already loaded),
including late subscribers, and returns an unsubscribe function. `slug` is
decoded and `/` and `/home/` resolve to `index`.

## Editor provider

All editor network calls (`editor.js`, `db.js`, `editor-next`) go through
`window.AcardEditorProvider.fetch(url, init)` when it is installed before the
editor scripts load; the default is the browser `fetch` to the same origin.
A host embeds the editor against a different backend by installing a provider
first:

```html
<script>
  window.AcardEditorProvider = {
    fetch: function (url, init) { return fetch("https://api.example.com" + url, init); }
  };
</script>
<script src="/editor.js"></script>
```

The save path still flows through the wrappable `transport()` chain, so
save-queue, changed-blocks and conflict policy are unaffected.
