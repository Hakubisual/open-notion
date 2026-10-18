# Third-party notices

OpenNotion ships no third-party code in its browser bundles. Some editor behaviour was reimplemented after reading
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

Bundled in `assets/fonts/` and used unmodified (subset into woff2 files):

- **Pretendard** - Copyright (c) 2021 Kil Hyung-jin, with Reserved Font Name Pretendard. https://github.com/orioncactus/pretendard
- **JetBrains Mono** - Copyright 2020 The JetBrains Mono Project Authors. https://github.com/JetBrains/JetBrainsMono

The OpenNotion wordmark in `assets/brand/` is drawn from outlines of **Nunito** (Copyright 2014 The Nunito Project Authors,
https://github.com/googlefonts/nunito), also under the SIL Open Font License 1.1. The font files themselves are not redistributed.

The full OFL 1.1 text: https://openfontlicense.org/open-font-license-official-text/

## Runtime dependencies (installed by `bun install`, not vendored)

| Package | License |
| --- | --- |
| @cfworker/json-schema | MIT |
| @cloudflare/workers-oauth-provider | MIT |
| @modelcontextprotocol/sdk | MIT |
| postgres | Unlicense |
| zod | MIT |
| electron, electron-builder (desktop/ only, dev) | MIT |

All are compatible with distributing OpenNotion under the MIT License.
