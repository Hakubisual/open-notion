// Inline markdown -> Acard richText runs (the shape assets/editor-model.js richText accepts). Runs in the Worker, in
// browsers and in tests: no Node APIs. Every top-level name starts with "imp" (the Worker inlines all import-*.ts).
//   impInlineRuns(text, { link }) -> { text, richText } | null (null: no inline markup, the caller keeps plain text)
//   link(target, label, heading) resolves [[target]] / [[target#heading|label]] to { href } or { mention: slug };
//   null keeps the literal "[[...]]" text. Marks: ** __ bold, * _ italic (word-boundary rules of block-html.js
//   inline()), `code`, ~~strike~~, ==highlight== (background yellow), [label](href) with the safeHref rule plus the
//   imp-page: / imp-asset: placeholders; an unsafe href keeps the label as text.

export type ImpRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  href?: string;
  color?: string;
  background?: string;
  mention?: { type: "page"; slug: string };
};
export type ImpMarks = Omit<ImpRun, "text">;
export type ImpLinkResolver = (target: string, label: string, heading: string) => { href?: string; mention?: string } | null | undefined;
export type ImpInlineOpts = { link?: ImpLinkResolver; href?: (href: string) => string | null };

const impWordChar = /[\p{L}\p{N}_]/u;
const impEscapable = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;

export function impInlineHrefOk(value: string): boolean {
  if (value.startsWith("imp-page:") || value.startsWith("imp-asset:")) return true;
  return /^(https?:|mailto:|\/(?!\/)|#)[^\s\0-\x1f\x7f\\]*$/i.test(value);
}

export function impInlineRuns(text: string, opts: ImpInlineOpts = {}): { text: string; richText: ImpRun[] } | null {
  const runs: ImpRun[] = [];
  if (!impParseInline(String(text), {}, opts, runs, false)) return null;
  const richText = impMergeRuns(runs);
  return { text: richText.map((run) => run.text).join(""), richText };
}

export function impStripInline(text: string, opts: ImpInlineOpts = {}): string {
  const parsed = impInlineRuns(text, opts);
  return parsed ? parsed.text : String(text);
}

// Returns true when any markup was consumed (the visible text differs from the source or a run carries a mark).
function impParseInline(src: string, marks: ImpMarks, opts: ImpInlineOpts, out: ImpRun[], inLink: boolean): boolean {
  const n = src.length;
  let changed = false, plain = "", i = 0;
  const flush = () => { if (plain) { out.push({ text: plain, ...marks }); plain = ""; } };
  const prev = (at: number) => (at > 0 ? src[at - 1] : "");
  const sub = (from: number, to: number, extra: ImpMarks, link: boolean) => {
    flush();
    impParseInline(src.slice(from, to), { ...marks, ...extra }, opts, out, link);
    changed = true;
  };
  while (i < n) {
    const c = src[i], next = i + 1 < n ? src[i + 1] : "";
    if (c === "\\" && next && impEscapable.test(next)) { plain += next; i += 2; changed = true; continue; }
    if (c === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) { flush(); out.push({ text: src.slice(i + 1, end), ...marks, code: true }); i = end + 1; changed = true; continue; }
    }
    if (c === "[" && next === "[") {
      const end = src.indexOf("]]", i + 2);
      const inner = end > i + 2 ? src.slice(i + 2, end) : "";
      if (inner && !inner.includes("\n") && !inner.includes("[[")) {
        const link = impWikiLink(inner, opts);
        if (link) { flush(); out.push({ ...marks, ...link }); changed = true; } else plain += src.slice(i, end + 2);
        i = end + 2;
        continue;
      }
    }
    if (c === "[" && !inLink) {
      const end = impScanTo(src, i + 1, "]");
      if (end > i + 1 && src[end + 1] === "(") {
        const close = impHrefEnd(src, end + 2);
        if (close > end + 2) {
          const href = src.slice(end + 2, close);
          const mapped = opts.href ? opts.href(href) : href;
          sub(i + 1, end, mapped && impInlineHrefOk(mapped) ? { href: mapped } : {}, true);
          i = close + 1;
          continue;
        }
      }
    }
    if ((c === "*" || c === "_") && next === c) {
      const end = c === "*" || !impWordChar.test(prev(i)) ? impFindDouble(src, i + 2, c + c, c === "_") : -1;
      if (end > 0) { sub(i + 2, end, { bold: true }, inLink); i = end + 2; continue; }
    }
    if ((c === "~" || c === "=") && next === c) {
      const end = impFindDouble(src, i + 2, c + c, true);
      if (end > 0) { sub(i + 2, end, c === "~" ? { strike: true } : { background: "yellow" }, inLink); i = end + 2; continue; }
    }
    if (c === "*" || c === "_") {
      const before = prev(i);
      const open = !impWordChar.test(before) && (c === "_" || before !== "*") && next !== "" && !/\s/.test(next) && next !== c;
      const end = open ? impFindSingle(src, i + 1, c) : -1;
      if (end > 0) { sub(i + 1, end, { italic: true }, inLink); i = end + 1; continue; }
    }
    plain += c;
    i += 1;
  }
  flush();
  return changed;
}

function impWikiLink(inner: string, opts: ImpInlineOpts): ImpRun | null {
  const pipe = inner.indexOf("|");
  const left = (pipe < 0 ? inner : inner.slice(0, pipe)).trim();
  const alias = pipe < 0 ? "" : inner.slice(pipe + 1).trim();
  const hash = left.indexOf("#");
  const target = (hash < 0 ? left : left.slice(0, hash)).trim();
  const heading = hash < 0 ? "" : left.slice(hash + 1).trim();
  const label = alias || (heading ? (target ? target + " > " + heading : heading) : target);
  if (!label || !opts.link) return null;
  const hit = opts.link(target, label, heading);
  if (!hit) return null;
  if (typeof hit.mention === "string" && hit.mention) return { text: label, mention: { type: "page", slug: hit.mention } };
  if (typeof hit.href === "string" && impInlineHrefOk(hit.href)) return { text: label, href: hit.href };
  return null;
}

// Index of `stop` at or after `from`, skipping escapes and code spans; -1 when absent or past a newline.
function impScanTo(src: string, from: number, stop: string): number {
  for (let j = from; j < src.length; ) {
    const ch = src[j];
    if (ch === "\n") return -1;
    if (ch === "\\") { j += 2; continue; }
    if (ch === "`") { const end = src.indexOf("`", j + 1); j = end > j ? end + 1 : j + 1; continue; }
    if (ch === stop) return j;
    j += 1;
  }
  return -1;
}

// Closing ")" of a link destination, allowing balanced parentheses; -1 on whitespace or a missing close.
function impHrefEnd(src: string, from: number): number {
  let depth = 0;
  for (let j = from; j < src.length; j += 1) {
    const ch = src[j];
    if (/\s/.test(ch)) return -1;
    if (ch === "(") depth += 1;
    else if (ch === ")") { if (depth === 0) return j; depth -= 1; }
  }
  return -1;
}

// Closing double delimiter (** __ ~~ ==). strict: content must not start or end with whitespace and, for __, the
// close must not run into a word character (intraword __ stays literal). ** stays lenient: Notion exports "**bold **".
function impFindDouble(src: string, from: number, delim: string, strict: boolean): number {
  for (let j = from; j < src.length; ) {
    const ch = src[j];
    if (ch === "\\") { j += 2; continue; }
    if (ch === "`") { const end = src.indexOf("`", j + 1); j = end > j ? end + 1 : j + 1; continue; }
    if (src.startsWith(delim, j)) {
      const content = src.slice(from, j);
      const after = j + 2 < src.length ? src[j + 2] : "";
      const ok = content.length > 0 && (!strict || (!/^\s/.test(content) && !/\s$/.test(content) && (delim !== "__" || !impWordChar.test(after))));
      if (ok) return j;
      j += 2;
      continue;
    }
    j += 1;
  }
  return -1;
}

// Closing single * or _ with the inline() rules: no newline inside, a nested ** / __ is content, any other lone
// delimiter that cannot close ends the attempt (the regex [^*] / [^_] content rule).
function impFindSingle(src: string, from: number, delim: string): number {
  for (let j = from; j < src.length; ) {
    const ch = src[j];
    if (ch === "\n") return -1;
    if (ch === "\\") { j += 2; continue; }
    if (ch === "`") { const end = src.indexOf("`", j + 1); j = end > j ? end + 1 : j + 1; continue; }
    if (ch === delim) {
      if (src[j + 1] === delim) { j += 2; continue; }
      const content = src.slice(from, j);
      const after = j + 1 < src.length ? src[j + 1] : "";
      return content.length > 0 && !/\s$/.test(content) && !impWordChar.test(after) && (delim === "_" || after !== "*") ? j : -1;
    }
    j += 1;
  }
  return -1;
}

function impMarkKey(run: ImpRun): string {
  return [run.bold, run.italic, run.underline, run.strike, run.code, run.href, run.color, run.background, run.mention?.slug].map(String).join("|");
}

function impMergeRuns(runs: ImpRun[]): ImpRun[] {
  const out: ImpRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = out[out.length - 1];
    if (last && impMarkKey(last) === impMarkKey(run)) last.text += run.text;
    else out.push({ ...run });
  }
  return out;
}
