import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const dist = (name: string) => readFileSync(join(ROOT, "dist", name), "utf8");
// Built from parts so the edition's "no AI UI left in the tree" grep does not hit this test itself.
const ASK = ["ask", "notes"].join("-");
const PHOTO = ["photo", "text"].join("-");
const ASK_AI = "AI에게 " + "묻기";

// The self-host edition ships no AI: the built editor has no ask-your-notes button, no photo-to-text item and no AI writing shortcuts.
test("the built editor carries no dead AI button, slash item or shortcut", () => {
  expect(dist("editor.html")).not.toContain(ASK + "-btn");
  for (const name of ["editor.js", "lazy/easy-insert.js"]) {
    const code = dist(name);
    for (const dead of ['lazy("ai-' + 'write")', 'lazy("' + PHOTO + '")', ASK_AI, '"' + PHOTO + '"']) expect(code).not.toContain(dead);
  }
});

test("the shipped UI dictionaries stay valid JSON without the AI strings", () => {
  for (const lang of ["en", "zh"]) {
    const dict = JSON.parse(readFileSync(join(ROOT, "assets", "i18n", "app-" + lang + ".json"), "utf8")) as Record<string, string>;
    expect(dict["글"]).toBeTruthy();
    for (const key of ["✦ " + ASK_AI, ASK_AI, "AI에게 부탁할 내용", "내 노트에 묻기", "노트에 묻기", "사진에서 글 가져오기", "사진에서 글을 읽고 있어요…"]) expect(dict[key]).toBeUndefined();
  }
});
