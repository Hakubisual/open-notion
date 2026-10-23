import { describe, expect, test } from "bun:test";
import "../components/index.js";
import { getComponent, renderComponentBlock } from "../component-registry.js";

const ixcIds = ["ix-button", "ix-segmented", "ix-toggle", "ix-progress"];
const ixcRender = (ui: string, data: unknown) => renderComponentBlock({ type: "component", text: typeof data === "string" ? data : JSON.stringify(data), meta: { ui } });
const ixcCount = (html: string, cls: string) => (html.match(new RegExp('class="' + cls + '[ "]', "g")) || []).length;

describe("interactive controls", () => {
  test("catalog metadata, samples, defaults and presets render", () => {
    for (const id of ixcIds) {
      const c = getComponent(id)!;
      expect(c.family).toBe("interactive");
      expect(c.schema.required.length).toBeGreaterThan(0);
      for (const field of c.schema.required) expect(c.defaults[field]).toBeDefined();
      expect(c.slash.aliases).toMatch(/[가-힣]/);
      expect(c.slash.aliases).toMatch(/[a-z]{3}/);
      expect(Object.keys(c.presets).sort()).toEqual(["friendly", "paper", "report", "showcase"]);
      for (const data of [c.sample, {}, { items: [null, [], "bad"], buttons: 1, options: false }, "{broken"]) {
        const html = ixcRender(id, data);
        expect(html).toContain('data-ui="' + id + '"');
        expect(html).not.toContain("ui-fallback");
      }
      for (const preset of Object.keys(c.presets)) expect(ixcRender(id, { ...c.sample, preset })).toContain('data-preset="' + preset + '"');
    }
  });

  test("links accept HTTPS and local paths, reject unsafe or malformed destinations", () => {
    const safe = ["/", "/notes?q=a&b=2", "/ok\"x", "https://example.org/notes", "HTTPS://example.org"];
    const unsafe = ["javascript:alert(1)", "http://example.org", "//example.org", "/\\example.org", "/\n/example.org", "https://", "https:///", "https://bad host", "mailto:a@b.test", "#anchor", "relative", ""];
    const html = ixcRender("ix-button", { buttons: [...safe, ...unsafe].map((href) => ({ label: "link", href, variant: "bogus", size: "xl" })) });
    expect((html.match(/<a class=/g) || []).length).toBe(safe.length);
    expect((html.match(/aria-disabled="true"/g) || []).length).toBe(unsafe.length);
    expect(html).toContain('href="/ok&quot;x"');
    expect(html).toContain("ui-ixc-primary ui-ixc-size-m");
    expect(html).not.toContain("javascript:");
  });

  test("segmented controls isolate repeated groups and select exactly one valid radio", () => {
    const options = [{ label: "A", text: "one\n\ntwo\nthree" }, { label: "B" }];
    const html = ixcRender("ix-segmented", { options, selected: 1 });
    expect(html).toMatch(/id="[^"]+-1" aria-controls="[^"]+" checked/);
    expect(html).toContain("<p>one</p><p>two<br>three</p>");
    for (const selected of [-1, 2, 0.5, "1", null]) {
      const fallback = ixcRender("ix-segmented", { options, selected });
      expect(fallback).toMatch(/id="[^"]+-0" aria-controls="[^"]+" checked/);
      expect((fallback.match(/ checked/g) || []).length).toBe(1);
    }
    const twice = html + ixcRender("ix-segmented", { options, selected: 1 });
    const ids = [...twice.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const match of twice.matchAll(/(?:for|aria-controls)="([^"]+)"/g)) expect(ids).toContain(match[1]);
    expect(new Set([...twice.matchAll(/name="([^"]+)"/g)].map((m) => m[1])).size).toBe(2);
    expect(ixcCount(ixcRender("ix-segmented", { options: Array.from({ length: 20 }, () => ({})) }), "ui-ixc-radio")).toBe(8);
  });

  test("switches stay read-only, labelled and keyboard reachable with strict boolean states", () => {
    const html = ixcRender("ix-toggle", { items: [{ label: "A", on: true, note: "note" }, { label: "B", on: "true" }, { label: "C", on: 1 }] });
    expect((html.match(/aria-checked="true"/g) || []).length).toBe(1);
    expect((html.match(/aria-checked="false"/g) || []).length).toBe(2);
    expect((html.match(/aria-readonly="true" tabindex="0" aria-labelledby=/g) || []).length).toBe(3);
    expect(html).toContain('aria-describedby="');
    expect(html).not.toContain("<input");
  });

  test("progress clamps values and draws exact normalized ring lengths", () => {
    const html = ixcRender("ix-progress", { items: [-10, 0, 72.36, 100, 900, "72", null].map((value) => ({ value, kind: "ring" })) });
    expect([...html.matchAll(/aria-valuenow="([^"]+)"/g)].map((m) => m[1])).toEqual(["0", "0", "72.4", "100", "100", "0", "0"]);
    expect(html).toContain('pathLength="100" stroke-dasharray="72.4 100"');
    expect(html).toContain('stroke-dasharray="0 100"');
    expect(html).toContain('stroke-dasharray="100 100"');
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(ixcRender("ix-progress", { items: [{ value: 72, kind: "bogus" }] })).toContain('style="width:72%"');
  });

  test("step math floors completed steps and bounds marker count", () => {
    for (const [value, completed, current] of [[0, 0, 0], [24, 0, 1], [25, 1, 1], [72, 2, 1], [100, 4, 0]]) {
      const html = ixcRender("ix-progress", { items: [{ value, kind: "steps", steps: 4 }] });
      expect(ixcCount(html, "ui-ixc-step")).toBe(4);
      expect((html.match(/ui-ixc-step-done/g) || []).length).toBe(completed);
      expect((html.match(/ui-ixc-step-current/g) || []).length).toBe(current);
    }
    for (const [steps, count] of [[-10, 2], [0, 2], [3.9, 3], [1000, 12], [null, 4]] as const) expect(ixcCount(ixcRender("ix-progress", { items: [{ value: 50, kind: "steps", steps }] }), "ui-ixc-step")).toBe(count);
    expect(ixcCount(ixcRender("ix-progress", { items: Array.from({ length: 40 }, () => ({ value: 1 })) }), "ui-ixc-progress")).toBe(24);
  });

  test("all text stays escaped and responsive, print and focus rules are present", () => {
    const evil = '<script>alert(1)</script>\"><img src=x onerror=alert(1)>';
    for (const id of ixcIds) {
      const html = ixcRender(id, { title: evil, subtitle: evil, caption: evil, buttons: [{ label: evil, href: evil, icon: evil }], options: [{ label: evil, text: evil }], items: [{ label: evil, note: evil, value: evil }] });
      expect(html).not.toMatch(/<script|<img/);
      const css = getComponent(id)!.css;
      expect(css).toContain("container-type:inline-size");
      expect(css).toContain("@container");
      expect(css).toContain("@media print");
      expect(css).toContain(":focus-visible");
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|border-radius:\s*\d+px|font-size:\s*\d+px/);
    }
    expect(getComponent("ix-segmented")!.css).toContain(".ui-ixc-panels>.ui-ixc-panel{display:block}");
  });
});
