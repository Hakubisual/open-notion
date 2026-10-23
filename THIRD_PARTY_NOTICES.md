# Third-party notices

Acard ships no third-party code in its browser bundles. Some editor behaviour was reimplemented after reading
the following MIT-licensed project; no source files were copied.

## Tiptap

- Project: https://github.com/ueberdosis/tiptap (read at commit 1f93f61, v3.30.3)
- Ideas ported into `editor-next/editor-next.js`: input rules (block shortcuts, inline marks), the typography
  replacement list, find and replace, table keyboard navigation, the emoji `:` suggestion, the file handler.
- License: MIT

```
MIT License

Copyright (c) 2025, Tiptap GmbH

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Fonts (SIL Open Font License 1.1)

The font files in `assets/fonts/` are woff2 subsets of the fonts below. Glyphs are not changed; each file keeps its
copyright notice and the OFL 1.1 license description and URL in its `name` table (name IDs 0, 13, 14). The font
software stays under the SIL Open Font License 1.1, not the AGPL-3.0 license of this repository. The full license text,
with each font's copyright lines, is in `LICENSES/`.

| Font | Files | Copyright | Source | License text |
| --- | --- | --- | --- | --- |
| Pretendard (Variable, font version 1.309) | `assets/fonts/pretendard-core.woff2`, `assets/fonts/pretendard/*.woff2` | Copyright (c) 2021, Kil Hyung-jin, with Reserved Font Name 'Pretendard'; includes Source (Adobe), Inter and M PLUS 1 glyphs under their copyright lines | https://github.com/orioncactus/pretendard | [`LICENSES/OFL-Pretendard.txt`](LICENSES/OFL-Pretendard.txt) |
| Noto Serif KR (weight 400) | `assets/fonts/serif/*.woff2` | (c) 2017-2024 Adobe (http://www.adobe.com/); Copyright 2012 Google Inc. | https://github.com/notofonts/noto-cjk (packaged by https://github.com/fontsource/font-files) | [`LICENSES/OFL-NotoSerifKR.txt`](LICENSES/OFL-NotoSerifKR.txt) |
| JetBrains Mono (2.211) | `assets/fonts/jetbrains-mono.woff2` | Copyright 2020 The JetBrains Mono Project Authors | https://github.com/JetBrains/JetBrainsMono | [`LICENSES/OFL-JetBrainsMono.txt`](LICENSES/OFL-JetBrainsMono.txt) |

OFL 1.1 in short: the fonts may be used, embedded, subset and redistributed, including commercially, as long as the
copyright notice and this license go with them, the font files are not sold on their own, and a modified version is
not published under a Reserved Font Name.

The Acard wordmark (`assets/wordmark*.svg`, `assets/logo*.svg`, `assets/og*.svg`) is drawn from outlines of **Fredoka**
(Copyright 2016 The Fredoka Project Authors, https://github.com/google/fonts/tree/main/ofl/fredoka), also under the SIL
Open Font License 1.1. The font files themselves are not redistributed.

The OFL 1.1 text online: https://openfontlicense.org/open-font-license-official-text/

## Runtime dependencies (installed by `bun install`, not vendored)

| Package | License |
| --- | --- |
| @cfworker/json-schema | MIT |
| @cloudflare/workers-oauth-provider | MIT |
| @modelcontextprotocol/sdk | MIT |
| postgres | Unlicense |
| zod | MIT |
| electron, electron-builder (desktop/ only, dev) | MIT |

All are compatible with distributing Acard under the AGPL-3.0 license.
