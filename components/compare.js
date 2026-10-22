// Compare (비교표): options side by side with one recommended column. Contract: component-registry.js.
import { registerComponent } from "../component-registry.js";

const CMP_UI_YES = '<svg class="ui-cmp-yes" viewBox="0 0 16 16" width="16" height="16" role="img" aria-label="예" focusable="false"><circle cx="8" cy="8" r="8" fill="currentColor"/><path d="M4.6 8.3l2.2 2.2 4.6-4.9" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CMP_UI_NO = '<span class="ui-cmp-no" role="img" aria-label="아니요">—</span>';

function cmpUiCell(value, h) {
  if (value === true || value === "yes") return CMP_UI_YES;
  if (value === false || value === "no") return CMP_UI_NO;
  return h.rich(h.str(value, "", 160));
}

registerComponent({
  id: "compare", name: "비교표",
  description: "Comparison table. columns: header cells, the first one names the row labels (e.g. [\"항목\",\"A안\",\"B안\"]); rows: [[label, cell, cell...]] aligned to columns. A cell \"yes\"/true draws a check, \"no\"/false a dash. highlight = column index to recommend (1 = first option) with badge text (default 추천).",
  schema: { type: "object", properties: { columns: { type: "array", minItems: 2, maxItems: 6, items: { type: "string" } }, rows: { type: "array", maxItems: 24, items: { type: "array", items: { type: ["string", "number", "boolean"] } } }, highlight: { type: "integer", minimum: 1 }, badge: { type: "string" } }, required: ["columns", "rows"] },
  defaults: { columns: ["항목", "A", "B"], rows: [], badge: "추천" },
  sample: {
    columns: ["항목", "A안", "B안"], highlight: 2, badge: "추천",
    rows: [["온보딩 방식", "단계별 가이드 중심", "템플릿 중심의 빠른 시작"], ["개발 리소스", "3주", "5주"], ["예상 가입 전환율", "+8%", "**+15%**"], ["확장 가능성", "no", "yes"]],
  },
  slash: { label: "비교표", hint: "선택지 나란히 비교", ico: "⇄", aliases: "비교 비교표 선택지 플랜 compare comparison pricing" },
  css: ".ui-compare{container-type:inline-size}.ui-cmp{overflow-x:auto;scrollbar-width:thin;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface)}.ui-cmp:focus-visible{outline:none;box-shadow:var(--focus-ring)}" +
    ".ui-cmp table.ui-cmp-t{display:table;width:100%;margin:0;border-collapse:separate;border-spacing:0;font-size:var(--fs-14)}" +
    ".ui-cmp-t th,.ui-cmp-t td{padding:var(--space-2) var(--space-4);border:0;border-top:1px solid var(--color-border);text-align:center;vertical-align:middle;line-height:var(--lh-ui)}" +
    ".ui-cmp-t thead th{border-top:0;background:var(--color-surface-soft);color:var(--color-text);font-size:var(--fs-14);font-weight:650;white-space:nowrap}" +
    ".ui-cmp-t th:first-child,.ui-cmp-t td:first-child{text-align:left;color:var(--color-text-dim);font-weight:500}.ui-cmp-t tbody th{background:transparent;font-size:var(--fs-14)}.ui-cmp-t th+th,.ui-cmp-t td+td{border-left:1px solid var(--color-border)}" +
    ".ui-cmp-t .ui-cmp-hl{background:var(--color-accent-soft);color:var(--color-text)}.ui-cmp-t thead th.ui-cmp-hl{background:var(--color-accent-soft)}.ui-cmp-t td.ui-cmp-hl{font-weight:600}" +
    ".ui-cmp-badge{display:inline-block;margin-left:var(--space-2);padding:1px var(--space-2);border-radius:var(--radius-pill);background:var(--color-accent);color:var(--color-on-accent);font-size:var(--fs-12);font-weight:650;vertical-align:1px}" +
    ".ui-cmp-yes{display:block;margin:0 auto;color:var(--color-accent)}.ui-cmp-yes path{stroke:var(--color-surface)}.ui-cmp-no{color:var(--color-text-dim)}" +
    ".ui-cmp-t tbody tr>*{transition:background var(--dur-fast)}@media (hover:hover){.ui-cmp-t tbody tr:hover>:not(.ui-cmp-hl){background:var(--color-surface-soft)}}" +
    "@container (max-width:419px){.ui-cmp-t th,.ui-cmp-t td{padding:var(--space-2) var(--space-3)}.ui-cmp-t thead th{white-space:normal}}",
  render(d, h) {
    const columns = h.list(d.columns, 6).map((c) => h.str(c, "", 60));
    const width = Math.max(2, columns.length);
    const rows = h.list(d.rows).filter(Array.isArray);
    const raw = Number(d.highlight);
    const hl = Number.isInteger(raw) && raw >= 1 && raw < width ? raw : -1;
    const badge = h.str(d.badge, "추천", 16);
    const cls = (j) => (j === hl ? ' class="ui-cmp-hl"' : "");
    let head = "";
    for (let j = 0; j < width; j += 1) {
      head += "<th scope=\"col\"" + cls(j) + ">" + h.rich(columns[j] || "") + (j === hl ? '<span class="ui-cmp-badge">' + h.esc(badge) + "</span>" : "") + "</th>";
    }
    const body = rows.map((r) => {
      let out = '<th scope="row">' + h.rich(h.str(r[0], "", 80)) + "</th>";
      for (let j = 1; j < width; j += 1) out += "<td" + cls(j) + ">" + cmpUiCell(r[j], h) + "</td>";
      return "<tr>" + out + "</tr>";
    }).join("");
    return '<div class="ui-cmp" tabindex="0" role="region" aria-label="비교표"><table class="ui-cmp-t"><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div>";
  },
});
