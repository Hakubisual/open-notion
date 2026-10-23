import { registerComponent } from "../component-registry.js";

const dgsPresets = { report: { figure: false, compact: true }, friendly: {}, paper: { palette: "mono", figure: true }, showcase: { height: "l" } };
const dgsProps = {
  title: { type: "string" }, subtitle: { type: "string" }, caption: { type: "string" }, source: { type: "string" }, unit: { type: "string" }, figure: { type: "boolean" },
  palette: { type: "string", enum: ["acard", "colorblind", "mono"] }, height: { type: "string", enum: ["s", "m", "l"] }, preset: { type: "string", enum: ["report", "friendly", "paper", "showcase"] },
};
const dgsTreeSchema = { type: "object", properties: { name: { type: "string" }, role: { type: "string" }, avatar: { type: "string" }, children: { type: "array", items: { $ref: "#/$defs/person" } } }, required: ["name"] };

function dgsOrg(d, h) {
  const D = h.diagram, rows = [];
  const visit = (value, depth, parent, branch) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || depth > 12 || rows.length >= 80) return "";
    const name = h.str(value.name, "이름 없음", 80), role = h.str(value.role, "", 80), avatar = h.str(value.avatar, "👤", 12);
    rows.push([name, role, parent, depth]);
    const children = h.list(value.children, 24).map((child, i) => visit(child, depth + 1, name, depth ? branch : i + 1)).filter(Boolean);
    return '<li class="dgs-person" data-depth="' + depth + '" style="--dgs-color:' + D.color(d.palette, branch) + '"><div class="dgs-person-card"><span class="dgs-avatar" aria-hidden="true">' + D.esc(avatar) + '</span><div><b>' + D.esc(name) + '</b>' + (role ? '<span class="dgs-role">' + D.esc(role) + '</span>' : '') + '</div></div>' + (children.length ? '<ul>' + children.join('') + '</ul>' : '') + '</li>';
  };
  const tree = visit(d.tree, 0, "—", 0);
  return D.figure("org", d, h, tree ? { label: "조직도", plot: '<div class="dgs-org" role="img" aria-label="' + D.esc(rows.length + '명의 조직도: ' + rows.map(r => r[0] + (r[2] !== '—' ? ', 상위 ' + r[2] : '')).join('; ')) + '"><ul>' + tree + '</ul></div>', table: D.table("조직 구조", ["이름", "역할", "상위", "깊이"], rows) } : { empty: D.EMPTY });
}

registerComponent({
  id: "diagram-org", family: "diagram", name: "조직도",
  description: "A top-down organization chart with compact person cards and indented phone branches, using tree: {name, role, avatar (emoji), children: [recursive persons]}.",
  schema: { type: "object", $defs: { person: dgsTreeSchema }, properties: { ...dgsProps, tree: { $ref: "#/$defs/person", type: "object" } }, required: ["tree"] },
  presets: dgsPresets, defaults: { tree: null },
  sample: { title: "조직도", subtitle: "팀의 조직 구조와 담당자를 나타냅니다.", tree: { name: "김지훈", role: "대표", avatar: "👤", children: [{ name: "이서연", role: "기획팀", avatar: "👩🏻", children: [{ name: "정하은", role: "기획자", avatar: "👩🏻" }, { name: "김도현", role: "PM", avatar: "👨🏻" }] }, { name: "박민준", role: "디자인팀", avatar: "👨🏻", children: [{ name: "한지민", role: "UI 디자이너", avatar: "👩🏻" }, { name: "오세훈", role: "UX 디자이너", avatar: "👨🏻" }] }, { name: "최유진", role: "개발팀", avatar: "👩🏻", children: [{ name: "이준호", role: "프론트엔드", avatar: "👨🏻" }, { name: "권민서", role: "백엔드", avatar: "👩🏻" }] }] }, caption: "조직도" },
  slash: { label: "조직도", hint: "팀과 담당자의 계층 구조", ico: "♙", aliases: "조직도 팀 계층 organization org chart tree" },
  css: '.ui-diagram-org .dgs-org{padding:var(--space-3) 0;font-size:var(--fs-12)}.ui-diagram-org .dgs-org ul{list-style:none;padding:0;margin:0;min-width:0}.ui-diagram-org .dgs-person{position:relative;min-width:0;flex:1}.ui-diagram-org .dgs-person-card{position:relative;display:flex;align-items:center;justify-content:center;gap:var(--space-1);padding:var(--space-2);border:1px solid color-mix(in srgb,var(--dgs-color) 55%,var(--color-border));border-radius:var(--radius-xs);background:color-mix(in srgb,var(--dgs-color) 12%,var(--color-surface));min-width:0;overflow-wrap:anywhere}.ui-diagram-org .dgs-person-card>div{min-width:0}.ui-diagram-org .dgs-avatar{flex:none;font-size:var(--fs-20)}.ui-diagram-org .dgs-role{display:block;color:var(--color-text-dim);font-size:var(--fs-11)}.ui-diagram-org .dgs-org>ul>.dgs-person>.dgs-person-card{width:fit-content;min-width:100px;margin:auto}.ui-diagram-org .dgs-org>ul>.dgs-person>ul{display:flex;gap:var(--space-2);margin-top:var(--space-6)}.ui-diagram-org .dgs-org>ul>.dgs-person>ul>.dgs-person:before{content:"";position:absolute;left:50%;top:calc(-1 * var(--space-3));height:var(--space-3);border-left:1px solid var(--color-border)}.ui-diagram-org .dgs-org>ul>.dgs-person>ul>.dgs-person:after{content:"";position:absolute;left:calc(-1 * var(--space-2));right:0;top:calc(-1 * var(--space-3));border-top:1px solid var(--color-border)}.ui-diagram-org .dgs-org>ul>.dgs-person>ul>.dgs-person:first-child:after{left:50%}.ui-diagram-org .dgs-org>ul>.dgs-person>ul>.dgs-person:last-child:after{right:50%}.ui-diagram-org .dgs-org>ul>.dgs-person>.dgs-person-card:after{content:"";position:absolute;top:100%;left:50%;height:var(--space-3);border-left:1px solid var(--color-border)}.ui-diagram-org .dgs-person[data-depth="1"] ul{margin:var(--space-2) 0 0 var(--space-1);padding-left:var(--space-2);border-left:1px solid var(--color-border)}.ui-diagram-org .dgs-person[data-depth="1"] li{margin-top:var(--space-2)}.ui-diagram-org .dgs-person[data-depth="1"] li .dgs-person-card{border:0;background:transparent;justify-content:flex-start;padding:0}.ui-diagram-org .dgs-person[data-depth="1"] li .dgs-avatar{font-size:var(--fs-17)}@container (max-width:359px){.ui-diagram-org .dgs-org>ul>.dgs-person>ul{display:block;margin:var(--space-3) 0 0 var(--space-2);padding-left:var(--space-3);border-left:1px solid var(--color-border)}.ui-diagram-org .dgs-org>ul>.dgs-person>.dgs-person-card{margin:0}.ui-diagram-org .dgs-org>ul>.dgs-person>ul>.dgs-person{margin-top:var(--space-3)}.ui-diagram-org .dgs-org .dgs-person:before,.ui-diagram-org .dgs-org .dgs-person:after,.ui-diagram-org .dgs-org .dgs-person-card:after{display:none}.ui-diagram-org .dgs-person-card{justify-content:flex-start}.ui-diagram-org .dgs-person[data-depth="1"] ul{margin-left:0;padding-left:var(--space-2)}}',
  render: dgsOrg,
});

function dgsErdTables(d, h) {
  const names = new Set();
  return h.list(d.tables, 12).filter(t => t && typeof t === "object" && !Array.isArray(t)).map((t, i) => ({ name: h.str(t.name, "table_" + (i + 1), 60), fields: h.list(t.fields, 24).filter(f => f && typeof f === "object" && !Array.isArray(f)).map((f, j) => ({ name: h.str(f.name, "field_" + (j + 1), 60), type: h.str(f.type, "TEXT", 30), key: h.oneOf(f.key, ["pk", "fk"], "") })) })).filter(t => { if (names.has(t.name)) return false; names.add(t.name); return true; });
}
function dgsErdBody(tables, relations, d, h, narrow) {
  const D = h.diagram, width = narrow ? 320 : 600, cardW = narrow ? 238 : 244, gap = 28, fieldH = 25, boxes = [];
  let y = 12;
  for (let i = 0; i < tables.length; i += narrow ? 1 : 2) {
    const group = tables.slice(i, i + (narrow ? 1 : 2)), rowH = Math.max(...group.map(t => 38 + Math.max(1, t.fields.length) * fieldH));
    group.forEach((t, j) => boxes.push({ ...t, x: narrow ? 8 : j ? 344 : 12, y, w: cardW, height: 38 + Math.max(1, t.fields.length) * fieldH }));
    y += rowH + gap;
  }
  const lookup = new Map();
  boxes.forEach((t, i) => t.fields.forEach((f, j) => { const key = t.name + "." + f.name; if (!lookup.has(key)) lookup.set(key, { box: t, index: i, y: t.y + 38 + fieldH * (j + 0.5) }); }));
  let body = '';
  relations.forEach((r, i) => {
    const a = lookup.get(r.from), b = lookup.get(r.to);
    if (!a || !b) return;
    const facing = a.box.x !== b.box.x, left = a.box.x < b.box.x;
    const x1 = a.box.x + (facing && !left ? 0 : cardW), x2 = b.box.x + (facing && left ? 0 : cardW);
    const lane = facing ? 276 + (i % 5) * 12 : narrow ? 263 + (i % 5) * 10 : a.box.x < 300 ? 276 + (i % 5) * 12 : 592 + (i % 4) * 2;
    // Vertical segments stay in a gutter, including relations spanning several rows.
    const route = `M${x1} ${a.y} H${lane} V${b.y} H${x2}`;
    body += '<path class="dgs-relation" data-kind="' + r.kind + '" d="' + route + '"/><g class="dgs-cardinality">';
    const foot = (x, fy, direction, many) => many ? `<path d="M${x} ${fy - 6} L${x + direction * 11} ${fy} L${x} ${fy + 6} M${x} ${fy} H${x + direction * 11}"/>` : `<path d="M${x + direction * 7} ${fy - 6} V${fy + 6}"/>`;
    body += foot(x1, a.y, facing && !left ? -1 : 1, r.kind === "n-n") + foot(x2, b.y, facing && left ? -1 : 1, r.kind !== "1-1") + '</g>';
  });
  boxes.forEach((t, i) => {
    const color = D.color(d.palette, i);
    body += '<g class="dgs-entity" data-table="' + D.esc(t.name) + '" style="--dgs-color:' + color + '"><rect x="' + t.x + '" y="' + t.y + '" width="' + cardW + '" height="' + t.height + '"/><path class="dgs-entity-head" d="M' + t.x + ' ' + t.y + ' h' + cardW + ' v34 h-' + cardW + 'Z"/>' + D.text(t.x + 12, t.y + 17, D.wrap(t.name, cardW - 24, 20, 1)[0], 20, { anchor: "start", weight: 700 });
    t.fields.forEach((f, j) => {
      const fy = t.y + 38 + fieldH * (j + 0.5);
      body += '<g class="dgs-field" data-field="' + D.esc(t.name + '.' + f.name) + '"><title>' + D.esc(f.name + ' · ' + f.type + (f.key ? ' · ' + f.key.toUpperCase() : '')) + '</title>' + D.text(t.x + 8, fy, f.key ? f.key.toUpperCase() : "", 15, { anchor: "start", fill: color, weight: 700 }) + D.text(t.x + 36, fy, D.wrap(f.name, cardW - 124, 17, 1)[0], 17, { anchor: "start" }) + D.text(t.x + cardW - 8, fy, D.wrap(f.type, 72, 15, 1)[0], 15, { anchor: "end", cls: "dgc-muted" }) + '</g>';
    });
    if (!t.fields.length) body += D.text(t.x + cardW / 2, t.y + 50, "필드 없음", 12, { cls: "dgc-muted" });
    body += '</g>';
  });
  return { w: width, h: Math.max(90, y - gap + 12), body };
}

registerComponent({
  id: "diagram-erd", family: "diagram", name: "데이터베이스 ERD",
  description: "An entity relationship diagram with field-aligned crow's-foot connectors, using tables: [{name, fields:[{name,type,key:pk|fk}]}] and relations: [{from:table.field,to:table.field,kind:1-1|1-n|n-n}].",
  schema: { type: "object", properties: { ...dgsProps, tables: { type: "array", items: { type: "object", properties: { name: { type: "string" }, fields: { type: "array", items: { type: "object", properties: { name: { type: "string" }, type: { type: "string" }, key: { type: "string", enum: ["pk", "fk"] } }, required: ["name"] } } }, required: ["name"] } }, relations: { type: "array", items: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, kind: { type: "string", enum: ["1-1", "1-n", "n-n"] } }, required: ["from", "to"] } } }, required: ["tables"] },
  presets: dgsPresets, defaults: { tables: [], relations: [] },
  sample: { title: "데이터베이스 ERD", subtitle: "주요 테이블과 관계를 ERD로 나타냅니다.", tables: [{ name: "users", fields: [{ name: "id", type: "UUID", key: "pk" }, { name: "name", type: "VARCHAR" }, { name: "email", type: "VARCHAR" }, { name: "created_at", type: "DATETIME" }] }, { name: "notes", fields: [{ name: "id", type: "UUID", key: "pk" }, { name: "user_id", type: "UUID", key: "fk" }, { name: "title", type: "VARCHAR" }, { name: "content", type: "TEXT" }, { name: "created_at", type: "DATETIME" }] }, { name: "tags", fields: [{ name: "id", type: "UUID", key: "pk" }, { name: "name", type: "VARCHAR" }, { name: "color", type: "VARCHAR" }] }], relations: [{ from: "users.id", to: "notes.user_id", kind: "1-n" }, { from: "notes.id", to: "tags.id", kind: "n-n" }], caption: "ERD · | 하나, 갈래 여러 개" },
  slash: { label: "데이터베이스 ERD", hint: "테이블과 필드의 관계", ico: "▤", aliases: "데이터베이스 관계 엔터티 테이블 erd entity relationship database" },
  css: '.ui-diagram-erd .dgs-entity>rect{fill:var(--color-surface);stroke:color-mix(in srgb,var(--dgs-color) 65%,var(--color-border));rx:var(--radius-xs)}.ui-diagram-erd .dgs-entity-head{fill:color-mix(in srgb,var(--dgs-color) 23%,var(--color-surface))}.ui-diagram-erd .dgs-relation,.ui-diagram-erd .dgs-cardinality{fill:none;stroke:var(--color-text-dim);stroke-width:1.4;stroke-linejoin:round}@container (min-width:360px){.ui-diagram-erd .vk-fig .dgc-wide{display:block}.ui-diagram-erd .vk-fig .dgc-narrow{display:none}}',
  render(d, h) {
    const D = h.diagram, tables = dgsErdTables(d, h);
    if (!tables.length) return D.figure("erd", d, h, { empty: D.EMPTY });
    const valid = new Set(tables.flatMap(t => t.fields.map(f => t.name + '.' + f.name)));
    const relations = h.list(d.relations, 24).filter(r => r && typeof r === "object").map(r => ({ from: h.str(r.from, "", 121), to: h.str(r.to, "", 121), kind: h.oneOf(r.kind, ["1-1", "1-n", "n-n"], "1-n") })).filter(r => valid.has(r.from) && valid.has(r.to));
    return D.figure("erd", d, h, { ...dgsErdBody(tables, relations, d, h, false), narrow: dgsErdBody(tables, relations, d, h, true), label: "데이터베이스 ERD", desc: tables.length + '개 테이블과 ' + relations.length + '개 관계', table: D.table("테이블 필드", ["테이블", "필드", "타입", "키"], tables.flatMap(t => t.fields.map(f => [t.name, f.name, f.type, f.key]))) + D.table("테이블 관계", ["출발 필드", "도착 필드", "관계"], relations.map(r => [r.from, r.to, r.kind])) });
  },
});

function dgsVenn(d, h) {
  const D = h.diagram, sets = h.list(d.sets, 3).filter(s => typeof s === "string" || s && typeof s === "object" && !Array.isArray(s)).map((s, i) => ({ label: h.str(typeof s === "string" ? s : s.label, "집합 " + (i + 1), 80), description: h.str(s.description, "", 100) }));
  if (sets.length < 2) return D.figure("venn", d, h, { empty: D.EMPTY });
  const three = sets.length === 3, centers = three ? [[180, 108], [116, 218], [244, 218]] : [[126, 152], [234, 152]], radius = three ? 96 : 108;
  const anchors = three ? [[180, 65], [89, 237], [271, 237]] : [[80, 148], [280, 148]];
  const locations = three ? { '0,1': [121, 154], '0,2': [239, 154], '1,2': [180, 266], '0,1,2': [180, 199] } : { '0,1': [180, 152] };
  const overlaps = h.list(d.overlaps, 4).filter(o => o && typeof o === "object").map(o => ({ key: [...new Set(h.list(o.sets, 3).filter(n => Number.isInteger(n) && n >= 0 && n < sets.length))].sort().join(','), label: h.str(o.label, "", 80) })).filter(o => locations[o.key] && o.label);
  let body = centers.map((p, i) => '<circle class="dgs-set" cx="' + p[0] + '" cy="' + p[1] + '" r="' + radius + '" fill="' + D.color(d.palette, i) + '" stroke="' + D.color(d.palette, i) + '"><title>' + D.esc(sets[i].label) + '</title></circle>').join('');
  sets.forEach((s, i) => {
    const [x, y] = anchors[i];
    body += '<g class="dgs-set-label"><title>' + D.esc(s.label + (s.description ? ': ' + s.description : '')) + '</title>';
    D.wrap(s.label, three ? 86 : 92, 16, 2).forEach((line, j) => { body += D.text(x, y + j * 19, line, 16, { weight: 700 }); });
    D.wrap(s.description, 84, 12, 2).forEach((line, j) => { body += D.text(x, y + 39 + j * 16, line, 12); });
    body += '</g>';
  });
  const seen = new Set();
  overlaps.forEach(o => {
    if (seen.has(o.key)) return;
    seen.add(o.key);
    const [x, y] = locations[o.key];
    body += '<g class="dgs-overlap" data-sets="' + o.key + '"><title>' + D.esc(o.label) + '</title>';
    D.wrap(o.label, o.key === '0,1,2' ? 65 : 62, 12, 2).forEach((line, j) => { body += D.text(x, y + j * 15, line, 12, { weight: o.key === '0,1,2' ? 700 : 500 }); });
    body += '</g>';
  });
  return D.figure("venn", d, h, { w: 360, h: three ? 326 : 280, body, label: "벤 다이어그램", desc: sets.map(s => s.label).join(', ') + '의 공통 영역', table: D.table("집합과 공통 영역", ["영역", "설명"], [...sets.map(s => [s.label, s.description]), ...overlaps.filter((o, i) => overlaps.findIndex(p => p.key === o.key) === i).map(o => [o.key.split(',').map(k => sets[Number(k)].label).join(' ∩ '), o.label])]) });
}

registerComponent({
  id: "diagram-venn", family: "diagram", name: "벤 다이어그램",
  description: "Two or three translucent overlapping sets with labels, using sets: [{label,description}] and overlaps: [{sets:[zero-based indices],label}] for pairwise and triple intersections.",
  schema: { type: "object", properties: { ...dgsProps, sets: { type: "array", minItems: 2, maxItems: 3, items: { type: "object", properties: { label: { type: "string" }, description: { type: "string" } }, required: ["label"] } }, overlaps: { type: "array", items: { type: "object", properties: { sets: { type: "array", items: { type: "integer", minimum: 0, maximum: 2 } }, label: { type: "string" } }, required: ["sets", "label"] } } }, required: ["sets"] },
  presets: dgsPresets, defaults: { sets: [], overlaps: [] },
  sample: { title: "서비스 핵심 가치 벤 다이어그램", subtitle: "세 가지 핵심 가치의 관계를 나타냅니다.", sets: [{ label: "사용성", description: "쉽고 직관적" }, { label: "협업", description: "함께 만드는 생산성" }, { label: "유연성", description: "어디서나 작업 가능" }], overlaps: [{ sets: [0, 1], label: "효율성" }, { sets: [0, 2], label: "접근성" }, { sets: [1, 2], label: "지속성" }, { sets: [0, 1, 2], label: "Acard" }], caption: "벤 다이어그램" },
  slash: { label: "벤 다이어그램", hint: "두세 집합의 공통점", ico: "◉", aliases: "벤 집합 교집합 공통 venn intersection overlap sets" },
  css: '.ui-diagram-venn .dgs-set{fill-opacity:.27;stroke-width:1.3;stroke-opacity:.7}.ui-diagram-venn .dgs-set-label,.ui-diagram-venn .dgs-overlap{fill:var(--color-text)}.ui-diagram-venn .dgc-svg{max-width:440px;margin:auto}',
  render: dgsVenn,
});

function dgsMatrix(d, h) {
  const D = h.diagram, quadrantNames = ["빠른 실행", "계획", "위임", "제외"], colorOrder = [2, 0, 1, 3];
  const quadrants = quadrantNames.map((fallback, i) => h.str(h.list(d.quadrants, 4)[i], fallback, 80));
  const items = h.list(d.items, 48).filter(it => it && typeof it === "object" && !Array.isArray(it)).map((it, i) => {
    const explicit = Number.isInteger(it.quadrant) && it.quadrant >= 0 && it.quadrant <= 3 ? it.quadrant : null;
    const rawX = D.num(it.x), rawY = D.num(it.y);
    const x = Math.max(0, Math.min(1, rawX === null ? explicit === 1 || explicit === 3 ? .75 : .25 : rawX));
    const y = Math.max(0, Math.min(1, rawY === null ? explicit === 2 || explicit === 3 ? .25 : .75 : rawY));
    return { label: h.str(it.label, "항목 " + (i + 1), 100), x, y, quadrant: explicit === null ? (y >= .5 ? 0 : 2) + (x >= .5 ? 1 : 0) : explicit };
  });
  const axis = (value, fallback) => ({ label: h.str(value && value.label, fallback, 40), low: h.str(value && value.low, "낮음", 30), high: h.str(value && value.high, "높음", 30) });
  const x = axis(d.x, "노력"), y = axis(d.y, "영향도");
  const plot = '<div class="dgs-matrix" role="img" aria-label="' + D.esc(y.label + '와 ' + x.label + '에 따른 ' + items.length + '개 항목의 우선순위') + '"><div class="dgs-y-axis"><span>' + D.esc(y.high) + '</span><b>' + D.esc(y.label) + '</b><span>' + D.esc(y.low) + '</span></div><div class="dgs-quadrants">' + quadrants.map((title, q) => '<section class="dgs-quadrant" data-quadrant="' + q + '" style="--dgs-color:' + D.color(d.palette, colorOrder[q]) + '"><h4>' + D.esc(title) + '</h4><ul>' + items.filter(it => it.quadrant === q).map(it => '<li data-x="' + it.x + '" data-y="' + it.y + '"><i aria-hidden="true"></i><span>' + D.esc(it.label) + '</span></li>').join('') + '</ul></section>').join('') + '</div><div class="dgs-x-axis"><span>' + D.esc(x.low) + '</span><b>' + D.esc(x.label) + '</b><span>' + D.esc(x.high) + '</span></div></div>';
  return D.figure("matrix", d, h, { plot, label: "우선순위 매트릭스", table: D.table("우선순위 항목", ["항목", x.label, y.label, "사분면"], items.map(it => [it.label, it.x, it.y, quadrants[it.quadrant]])) });
}

registerComponent({
  id: "diagram-matrix", family: "diagram", name: "우선순위 매트릭스",
  description: "A two-by-two priority matrix with collision-free quadrant lists, axes x/y: {label,low,high}, quadrants: [top-left,top-right,bottom-left,bottom-right titles], and items: [{label,x:0-1,y:0-1,quadrant:optional index 0-3}].",
  schema: { type: "object", properties: { ...dgsProps, x: { type: "object", properties: { label: { type: "string" }, low: { type: "string" }, high: { type: "string" } } }, y: { type: "object", properties: { label: { type: "string" }, low: { type: "string" }, high: { type: "string" } } }, quadrants: { type: "array", maxItems: 4, items: { type: "string" } }, items: { type: "array", items: { type: "object", properties: { label: { type: "string" }, x: { type: "number", minimum: 0, maximum: 1 }, y: { type: "number", minimum: 0, maximum: 1 }, quadrant: { type: "integer", minimum: 0, maximum: 3 } }, required: ["label"] } } }, required: ["items"] },
  presets: dgsPresets, defaults: { items: [] },
  sample: { title: "기능 우선순위 매트릭스", subtitle: "기능의 중요도와 개발 노력을 기준으로 분류합니다.", x: { label: "노력", low: "낮음", high: "높음" }, y: { label: "영향도", low: "낮음", high: "높음" }, quadrants: ["빠른 실행", "계획", "위임", "제외"], items: [{ label: "간편 메모", x: .2, y: .8 }, { label: "단축키 개선", x: .3, y: .6 }, { label: "AI 요약 기능", x: .7, y: .9 }, { label: "협업 기능", x: .8, y: .7 }, { label: "테마 옵션", x: .2, y: .3 }, { label: "다국어 지원", x: .4, y: .2 }, { label: "모바일 앱", x: .8, y: .3 }, { label: "오프라인 모드", x: .9, y: .2 }], caption: "우선순위 매트릭스" },
  slash: { label: "우선순위 매트릭스", hint: "중요도와 노력으로 분류", ico: "⊞", aliases: "매트릭스 우선순위 사분면 중요도 matrix quadrant priority impact effort" },
  css: '.ui-diagram-matrix .dgs-matrix{display:grid;grid-template-columns:32px minmax(0,1fr);grid-template-rows:1fr auto;gap:var(--space-2);padding:var(--space-3) 0;font-size:var(--fs-12)}.ui-diagram-matrix .dgs-quadrants{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-1);border-left:1px solid var(--color-text-dim);border-bottom:1px solid var(--color-text-dim);padding:0 0 var(--space-2) var(--space-2)}.ui-diagram-matrix .dgs-quadrant{min-width:0;border:1px solid color-mix(in srgb,var(--dgs-color) 35%,var(--color-border));border-radius:var(--radius-xs);padding:var(--space-2);background:color-mix(in srgb,var(--dgs-color) 15%,var(--color-surface));overflow-wrap:anywhere}.ui-diagram-matrix .dgs-quadrant h4{margin:0 0 var(--space-2);text-align:center;font-size:var(--fs-13);color:var(--color-text)}.ui-diagram-matrix .dgs-quadrant ul{display:grid;gap:var(--space-2);padding:0;margin:0;list-style:none}.ui-diagram-matrix .dgs-quadrant li{display:flex;align-items:baseline;gap:var(--space-1);line-height:1.5}.ui-diagram-matrix .dgs-quadrant i{width:9px;height:9px;flex:none;border-radius:var(--radius-pill);background:var(--dgs-color)}.ui-diagram-matrix .dgs-quadrant li span{min-width:0}.ui-diagram-matrix .dgs-x-axis{grid-column:2;display:flex;justify-content:space-between;gap:var(--space-1);color:var(--color-text-dim);overflow-wrap:anywhere}.ui-diagram-matrix .dgs-y-axis{display:flex;flex-direction:column;justify-content:space-between;align-items:center;gap:var(--space-1);color:var(--color-text-dim);overflow-wrap:anywhere}.ui-diagram-matrix .dgs-y-axis b{writing-mode:vertical-rl}.ui-diagram-matrix .dgs-x-axis>*{max-width:33%;min-width:0}.ui-diagram-matrix .dgs-y-axis>*{max-width:100%}.ui-diagram-matrix .dgs-x-axis b,.ui-diagram-matrix .dgs-y-axis b{color:var(--color-text)}@container (max-width:359px){.ui-diagram-matrix .dgs-matrix{grid-template-columns:25px minmax(0,1fr);gap:var(--space-1)}.ui-diagram-matrix .dgs-quadrant{padding:var(--space-2) var(--space-1)}}',
  render: dgsMatrix,
});
