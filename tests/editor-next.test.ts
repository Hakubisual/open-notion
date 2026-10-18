import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { editorNextChunk } from "../scripts/build-editor-next.ts";

const shipped = (ext: string) => readFileSync(new URL("../assets/features/lazy/editor-next." + ext, import.meta.url), "utf8");

test("shipped editor-next chunk is the current build of editor-next/", async () => {
  const built = await editorNextChunk();
  expect(shipped("js")).toBe(built.js);
  expect(shipped("css")).toBe(built.css);
});

test("editor-next stays inside the lazy chunk cap", () => {
  expect(shipped("js").length + shipped("css").length).toBeLessThanOrEqual(40000);
});

function flag(search: string, stored: string | null) {
  const store = new Map<string, string>(stored ? [["acard-editor", stored]] : []);
  const listeners: string[] = [];
  const window: any = { AcardEditor: { on: (event: string) => listeners.push(event) }, addEventListener: (type: string) => listeners.push("window:" + type) };
  const document = { getElementById: () => null, documentElement: { dataset: {} as Record<string, string> } };
  const localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
  new Function("window", "document", "localStorage", "location", readFileSync(new URL("../assets/features/editor-next.js", import.meta.url), "utf8"))(window, document, localStorage, { search });
  return { on: window.AcardEditorNext.on, stored: store.get("acard-editor") ?? null, listeners, dataset: document.documentElement.dataset };
}

test("new editor is on by default and ?editor=classic (remembered) brings the old editor back", () => {
  expect(flag("", null)).toMatchObject({ on: true, stored: null, dataset: { editor: "next" } });
  expect(flag("", "classic")).toMatchObject({ on: false, listeners: [] });
  expect(flag("?editor=next", null)).toMatchObject({ on: true, stored: "next", dataset: { editor: "next" } });
  expect(flag("", "next").listeners).toEqual(["window:keydown", "ready"]);
  expect(flag("?editor=classic", "next")).toMatchObject({ on: false, stored: "classic" });
});
