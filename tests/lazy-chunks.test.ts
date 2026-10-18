import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../assets/editor.js", import.meta.url), "utf8");
const loader = source.slice(source.indexOf("  var lazyPending"), source.indexOf("  var featureListeners"));
const provide = source.match(/provide: (function \(name, api\) \{[^\n]+\})/)![1];

function setup(css = true, fail = false, register = true) {
  const nodes: any[] = [];
  const api = { render: () => "chart" };
  const window: any = { AcardLazy: { chart: { js: "js-hash", ...(css ? { css: "css-hash" } : {}) } } };
  let appended!: () => void;
  const ready = new Promise<void>(resolve => { appended = resolve; });
  const document = {
    createElement: (tag: string) => ({ tag }),
    head: { appendChild(node: any) {
      nodes.push(node);
      if (node.tag === "script") {
        if (register) window.AcardEditor.provide("chart", api);
        if (fail) node.onerror(new Error("network")); else node.onload();
      }
      if (nodes.length === (css ? 2 : 1)) appended();
    } },
  };
  window.AcardEditor = new Function("window", "document", loader + "return { lazy, provide: " + provide + " };")(window, document);
  return { editor: window.AcardEditor, nodes, api, ready };
}

test("loader is under 600 gzip bytes including provide", () => {
  expect(Bun.gzipSync(loader + provide, { level: 9 }).byteLength).toBeLessThan(600);
});

test("concurrent calls share one promise, use versioned URLs, and wait for CSS", async () => {
  const { editor, nodes, api, ready } = setup();
  const first = editor.lazy("chart");
  expect(editor.lazy("chart")).toBe(first);
  await ready;
  expect(nodes.map(node => node.src || node.href)).toEqual(["/lazy/chart.js?v=js-hash", "/lazy/chart.css?v=css-hash"]);
  let resolved = false;
  first.then(() => { resolved = true; });
  await Promise.resolve();
  expect(resolved).toBe(false);
  nodes[1].onload();
  expect(await first).toBe(api);
  expect(editor.lazy("chart")).toBe(first);
  expect(nodes).toHaveLength(2);
});

test("script-only chunks resolve and unknown names reject without loading", async () => {
  const { editor, nodes, api } = setup(false);
  expect(await editor.lazy("chart")).toBe(api);
  await expect(editor.lazy("missing")).rejects.toThrow("Unknown lazy feature");
  expect(nodes).toHaveLength(1);
});

test("network and registration failures reject the cached promise", async () => {
  for (const [fail, register, error] of [[true, true, "network"], [false, false, "Unregistered"]] as const) {
    const { editor, nodes } = setup(false, fail, register);
    const promise = editor.lazy("chart");
    await expect(promise).rejects.toThrow(error);
    expect(editor.lazy("chart")).toBe(promise);
    expect(nodes).toHaveLength(1);
  }
});

test("CSS load failure rejects even after script registration", async () => {
  const { editor, nodes, ready } = setup();
  const promise = editor.lazy("chart");
  await ready;
  nodes[1].onerror(new Error("stylesheet"));
  await expect(promise).rejects.toThrow("stylesheet");
});
