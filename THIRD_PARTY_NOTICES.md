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
| Noto Serif KR (weights 400 and 700) | `assets/fonts/serif/*.woff2` | (c) 2017-2024 Adobe (http://www.adobe.com/); Copyright 2012 Google Inc. | https://github.com/notofonts/noto-cjk (packaged by https://github.com/fontsource/font-files) | [`LICENSES/OFL-NotoSerifKR.txt`](LICENSES/OFL-NotoSerifKR.txt) |
| JetBrains Mono (2.211) | `assets/fonts/jetbrains-mono.woff2` | Copyright 2020 The JetBrains Mono Project Authors | https://github.com/JetBrains/JetBrainsMono | [`LICENSES/OFL-JetBrainsMono.txt`](LICENSES/OFL-JetBrainsMono.txt) |
| Gothic A1 (400, 700) | `assets/fonts/lib/gothic/*.woff2` | (C) Copyright HanYang I&C Co.,Ltd. | https://github.com/google/fonts/tree/main/ofl/gothica1 | [`LICENSES/OFL-GothicA1.txt`](LICENSES/OFL-GothicA1.txt) |
| IBM Plex Sans KR (400, 700), shipped as "Acard Office Sans" | `assets/fonts/lib/office/*.woff2` | Copyright © 2017 IBM Corp. with Reserved Font Name "Plex" | https://github.com/google/fonts/tree/main/ofl/ibmplexsanskr | [`LICENSES/OFL-IBMPlexSansKR.txt`](LICENSES/OFL-IBMPlexSansKR.txt) |
| Gowun Dodum (400) | `assets/fonts/lib/dodum/*.woff2` | Copyright 2021 The Gowun Dodum Project Authors | https://github.com/yangheeryu/Gowun-Dodum | [`LICENSES/OFL-GowunDodum.txt`](LICENSES/OFL-GowunDodum.txt) |
| Gowun Batang (400, 700) | `assets/fonts/lib/batang/*.woff2` | Copyright 2021 The Gowun Batang Project Authors | https://github.com/yangheeryu/Gowun-Batang | [`LICENSES/OFL-GowunBatang.txt`](LICENSES/OFL-GowunBatang.txt) |
| Nanum Myeongjo (400, 700), shipped as "Acard Classic Serif" | `assets/fonts/lib/myeongjo/*.woff2` | Copyright (c) 2010, NHN Corporation, with Reserved Font Name Nanum, NanumMyeongjo and others | https://github.com/google/fonts/tree/main/ofl/nanummyeongjo | [`LICENSES/OFL-NanumMyeongjo.txt`](LICENSES/OFL-NanumMyeongjo.txt) |
| Hahmlet (700 instance) | `assets/fonts/lib/hahmlet/*.woff2` | Copyright 2020 The Hahmlet Project Authors | https://github.com/hyper-type/hahmlet | [`LICENSES/OFL-Hahmlet.txt`](LICENSES/OFL-Hahmlet.txt) |
| Nanum Pen Script (400), shipped as "Acard Pen" | `assets/fonts/lib/pen/*.woff2` | Copyright (c) 2010, NHN Corporation, with Reserved Font Name Nanum, NanumPen and others | https://github.com/google/fonts/tree/main/ofl/nanumpenscript | [`LICENSES/OFL-NanumPenScript.txt`](LICENSES/OFL-NanumPenScript.txt) |
| Gamja Flower (400) | `assets/fonts/lib/gamja/*.woff2` | Copyright (c) YoonDesign Inc. | https://github.com/google/fonts/tree/main/ofl/gamjaflower | [`LICENSES/OFL-GamjaFlower.txt`](LICENSES/OFL-GamjaFlower.txt) |
| Poor Story (400) | `assets/fonts/lib/poorstory/*.woff2` | Copyright (c) YoonDesign Inc. | https://github.com/google/fonts/tree/main/ofl/poorstory | [`LICENSES/OFL-PoorStory.txt`](LICENSES/OFL-PoorStory.txt) |
| Do Hyeon (400) | `assets/fonts/lib/dohyeon/*.woff2` | Copyright 2018 The Do Hyeon Project Authors | https://github.com/google/fonts/tree/main/ofl/dohyeon | [`LICENSES/OFL-DoHyeon.txt`](LICENSES/OFL-DoHyeon.txt) |
| Jua (400) | `assets/fonts/lib/jua/*.woff2` | Copyright 2018 The Jua Project Authors | https://github.com/google/fonts/tree/main/ofl/jua | [`LICENSES/OFL-Jua.txt`](LICENSES/OFL-Jua.txt) |
| Black Han Sans (400) | `assets/fonts/lib/blackhan/*.woff2` | Copyright 2015 The Black Han Sans Project Authors | https://github.com/zesstype/Black-Han-Sans | [`LICENSES/OFL-BlackHanSans.txt`](LICENSES/OFL-BlackHanSans.txt) |
| D2Coding 1.3.2 (400, 700; Hangul only), shipped as "Acard Mono KR" | `assets/fonts/lib/mono/*.woff2` | Copyright (c) 2015, NAVER Corporation, with Reserved Font Name D2Coding and D2Coding-Bold | https://github.com/naver/d2codingfont | [`LICENSES/OFL-D2Coding.txt`](LICENSES/OFL-D2Coding.txt) |

The page fonts in `assets/fonts/lib/` (`scripts/fonts-library.py`, listed in `assets/fonts/catalog.json`) are cut from the
fonts above in the same way; `assets/fonts/lib/preview/*.woff2` hold only each font's name and a short sample for the font
picker. A subset is a Modified Version under OFL 1.1, so a font with a Reserved Font Name is shipped under another name
(name IDs 1, 3, 4, 6 and the CSS font-family): IBM Plex Sans KR as "Acard Office Sans", Nanum Myeongjo as "Acard Classic
Serif", Nanum Pen Script as "Acard Pen" and D2Coding as "Acard Mono KR". The original copyright lines (name ID 0) stay.

OFL 1.1 in short: the fonts may be used, embedded, subset and redistributed, including commercially, as long as the
copyright notice and this license go with them, the font files are not sold on their own, and a modified version is
not published under a Reserved Font Name.

The "Acard" letters of the wordmark (`assets/wordmark*.svg`, `assets/og*.svg`) are drawn from outlines of
**Pretendard Bold** (Copyright (c) 2021, Kil Hyung-jin, https://github.com/orioncactus/pretendard), also under the SIL
Open Font License 1.1. The outlines are paths in the SVG files; no font file is loaded for them.

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
