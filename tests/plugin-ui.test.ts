import { describe, expect, test } from "bun:test";
import { checkTree, PLUGIN_UI_LIMITS, renderTreeHtml, ui, uiAuto } from "../plugin-ui.js";

const html = (tree: unknown, opts = {}) => renderTreeHtml(checkTree(tree).tree, opts);

describe("plugin UI tree (#144)", () => {
  test("components render from data, never from HTML", () => {
    const out = html([ui.heading("합계"), ui.stat("단어", 1200, "+12%"), ui.compare(["항목", "A", "B"], [["속도", true, false]], 2), ui.chart("bar", ["월", "화"], [{ name: "n", data: [3, 5] }]), ui.steps([{ title: "쓰기", state: "done" }, { title: "검토", state: "now" }]), ui.callout("warning", "주의", "**굵게** `code`")]);
    expect(out).toContain('class="pl-stat"');
    expect(out).toContain('<span class="pl-delta up">+12%</span>');
    expect(out).toContain('<td class="pl-hl"><span class="pl-no"');
    expect(out).toContain("<svg class=\"pl-chart\"");
    expect(out).toContain('class="pl-step done"');
    expect(out).toContain("<b>굵게</b> <code>code</code>");
  });

  test("text is escaped everywhere, unknown nodes and fields are dropped", () => {
    const evil = '<img src=x onerror=alert(1)>"\'';
    const r = checkTree([{ t: "text", text: evil }, { t: "html", html: "<script>alert(1)</script>" }, { t: "button", label: evil, action: "x\" onclick=\"alert(1)" }, { t: "chart", kind: "bar", labels: [evil], series: [{ name: evil, data: [1] }] }, { t: "stat", label: "a", value: "b", onload: "x" }]);
    expect(r.warnings).toContain("unknown node html");
    const out = renderTreeHtml(r.tree);
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    const tagsWithoutValues = (out.match(/<[a-z][^>]*>/gi) || []).map((tag) => tag.replace(/"[^"]*"/g, '""'));
    for (const tag of tagsWithoutValues) expect(tag).not.toMatch(/\son[a-z]+=/i);
    expect(out).toContain('data-action="click"');
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;&quot;&#39;");
  });

  test("limits: too many nodes are cut, too deep is cut, too big is refused", () => {
    const many = Array.from({ length: 10 }, () => ui.row(...Array.from({ length: 50 }, (_, i) => ui.text(String(i)))));
    const cut = checkTree(many);
    expect(cut.warnings).toContain("too many nodes");
    expect(JSON.stringify(cut.tree).match(/"t":/g)!.length).toBe(PLUGIN_UI_LIMITS.nodes + 1);
    let deep: any = ui.text("leaf");
    for (let i = 0; i < 20; i++) deep = ui.column(deep);
    expect(checkTree(deep).warnings).toContain("too deep");
    const big = Array.from({ length: 50 }, () => ui.list(Array.from({ length: 50 }, () => "x".repeat(2000))));
    expect(checkTree(big)).toMatchObject({ tree: null, warnings: expect.arrayContaining(["too big"]) });
  });

  test("static rendering disables every control (shared pages)", () => {
    const tree = [ui.slider("n", "개수", 3, 0, 10), ui.button("다시", "again", "primary"), ui.input("q", "검색", ""), ui.select("s", "정렬", [{ value: "a", label: "A" }], "a"), ui.toggle("t", "켜기", true), ui.form("send", "보내기", ui.input("x", "x", ""))];
    const live = html(tree), still = html(tree, { static: true });
    expect(live).not.toContain(" disabled");
    expect((still.match(/ disabled/g) || []).length).toBe(7);
    expect(still).not.toContain("<script");
  });

  test("slider values are clamped and controls keep only safe names", () => {
    const r = checkTree(ui.slider("n", "x", 999, 0, 10));
    expect(r.tree!.children[0].value).toBe(10);
    expect(checkTree({ t: "input", name: "a b<", label: "x" }).tree!.children[0].name).toBe("value");
  });

  test("ui.auto picks a layout by content kind (Intelligent UI)", () => {
    expect(uiAuto(42)[0].t).toBe("stat");
    expect(uiAuto({ 방문: 10, 가입: 3 })[0].t).toBe("stats");
    expect(uiAuto([{ 이름: "A", 가격: 3 }, { 이름: "B", 가격: 5 }])[0]).toMatchObject({ t: "compare", columns: ["이름", "가격"] });
    expect(uiAuto(["조사", "시안", "출시"])[0].t).toBe("steps");
    expect(uiAuto([1, 4, 9])[0]).toMatchObject({ t: "chart", kind: "line" });
    expect(uiAuto([{ x: "월", y: 2 }, { x: "화", y: 5 }])[0]).toMatchObject({ t: "chart", labels: ["월", "화"] });
    expect(uiAuto("그냥 글")[0].t).toBe("text");
  });
});
