// 라텍 부분집합 -> HTML 변환기. 외부 의존성과 CDN 이 없다.
// 단일 소스 규칙: 읽기 화면은 빌드가 이 파일을 워커에 인라인해 쓰고, 편집기 미리보기는 빌드가 만든
// dist/equation-html.js 를 쓴다. 사본을 손으로 만들지 않는다 — 두 번째 렌더러 사본이 배포 장애를 낸 적 있다.

const GREEK = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ",
  sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "ϕ", chi: "χ",
  psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ",
  Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

const SYM = {
  sum: "∑", prod: "∏", coprod: "∐", int: "∫", iint: "∬", oint: "∮",
  infty: "∞", partial: "∂", nabla: "∇", times: "×", cdot: "·", div: "÷",
  pm: "±", mp: "∓", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠",
  approx: "≈", equiv: "≡", sim: "∼", simeq: "≃", cong: "≅", propto: "∝",
  rightarrow: "→", to: "→", leftarrow: "←", Rightarrow: "⇒", Leftarrow: "⇐",
  leftrightarrow: "↔", Leftrightarrow: "⇔", mapsto: "↦", uparrow: "↑", downarrow: "↓",
  ldots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱", dots: "…",
  in: "∈", notin: "∉", ni: "∋", subset: "⊂", subseteq: "⊆", supset: "⊃", supseteq: "⊇",
  cup: "∪", cap: "∩", setminus: "∖", emptyset: "∅", varnothing: "∅",
  forall: "∀", exists: "∃", nexists: "∄", neg: "¬", land: "∧", lor: "∨",
  oplus: "⊕", ominus: "⊖", otimes: "⊗", oslash: "⊘", perp: "⊥", parallel: "∥",
  angle: "∠", triangle: "△", square: "□", star: "⋆", ast: "∗", circ: "∘",
  bullet: "•", prime: "′", degree: "°", ell: "ℓ", Re: "ℜ", Im: "ℑ", hbar: "ℏ",
  aleph: "ℵ", wp: "℘", quad: "\u2003", qquad: "\u2003\u2003",
  ",": "\u2009", ";": "\u2005", ":": "\u2005", "!": "",
};

// Upright function names (\ln, \sin ...), written as text like \operatorname.
const FUNCS = new Set(["ln", "log", "exp", "sin", "cos", "tan", "min", "max", "lim", "det"]);

const BLACKBOARD = { R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ", P: "ℙ", H: "ℍ", E: "𝔼", F: "𝔽" };

const BIG_DELIM = { "(": "(", "[": "[", "{": "{", "|": "|", "<": "⟨", ".": "" };

function escapeLatex(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function readGroup(src, state) {
  while (state.i < src.length && src[state.i] === " ") state.i += 1;
  if (state.i >= src.length) return "";
  if (src[state.i] !== "{") {
    const ch = src[state.i];
    state.i += 1;
    return ch;
  }
  let depth = 0;
  const start = state.i + 1;
  while (state.i < src.length) {
    const ch = src[state.i];
    if (ch === "\\") { state.i += 2; continue; }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const body = src.slice(start, state.i);
        state.i += 1;
        return body;
      }
    }
    state.i += 1;
  }
  return src.slice(start);
}

function readCommandName(src, state) {
  let name = "";
  while (state.i < src.length && /[a-zA-Z]/.test(src[state.i])) {
    name += src[state.i];
    state.i += 1;
  }
  return name;
}

function parseCommand(src, state, name) {
  if (name === "frac" || name === "dfrac" || name === "tfrac") {
    const num = renderLatex(readGroup(src, state));
    const den = renderLatex(readGroup(src, state));
    return '<span class="mfrac"><span class="mnum">' + num + '</span><span class="mden">' + den + "</span></span>";
  }
  if (name === "sqrt") {
    let root = "";
    if (src[state.i] === "[") {
      state.i += 1;
      const start = state.i;
      while (state.i < src.length && src[state.i] !== "]") state.i += 1;
      root = src.slice(start, state.i);
      state.i += 1;
    }
    const body = renderLatex(readGroup(src, state));
    return '<span class="msqrt">' + (root ? '<span class="mroot">' + renderLatex(root) + "</span>" : "") + "<span class=\"mrad\">√</span><span class=\"mbody\">" + body + "</span></span>";
  }
  if (name === "text" || name === "mathrm" || name === "operatorname" || name === "mbox") {
    return '<span class="mtext">' + escapeLatex(readGroup(src, state)) + "</span>";
  }
  if (name === "mathbb" || name === "Bbb") {
    const body = readGroup(src, state);
    return escapeLatex(BLACKBOARD[body] ?? body);
  }
  if (name === "mathbf" || name === "bm" || name === "boldsymbol") {
    return '<span class="mbf">' + renderLatex(readGroup(src, state)) + "</span>";
  }
  if (name === "mathit") return '<span class="mtext">' + renderLatex(readGroup(src, state)) + "</span>";
  if (name === "left") {
    const delim = (src[state.i] ?? "").trim();
    state.i += 1;
    return '<span class="mbig">' + escapeLatex(BIG_DELIM[delim] ?? delim) + "</span>";
  }
  if (name === "right") {
    const delim = (src[state.i] ?? "").trim();
    state.i += 1;
    return '<span class="mbig">' + escapeLatex(BIG_DELIM[delim] ?? delim) + "</span>";
  }
  if (name === "overline") return '<span class="movr">' + renderLatex(readGroup(src, state)) + "</span>";
  if (name === "underline") return '<span class="mund">' + renderLatex(readGroup(src, state)) + "</span>";
  if (name === "begin" || name === "end") { readGroup(src, state); return ""; }
  if (name === "\\") return "<br>";
  if (FUNCS.has(name)) return '<span class="mtext">' + name + "</span>";
  if (GREEK[name]) return escapeLatex(GREEK[name]);
  if (SYM[name]) return escapeLatex(SYM[name]);
  if (!name) return "";
  // 모르는 커맨드는 지우지 않고 글자로 남긴다 — 조용히 사라지면 쓴 사람이 알아차리지 못한다.
  return '<span class="munk">' + escapeLatex("\\" + name) + "</span>";
}

export function renderLatex(src) {
  const input = String(src ?? "");
  const state = { i: 0 };
  let out = "";
  while (state.i < input.length) {
    const ch = input[state.i];
    if (ch === "\\") {
      state.i += 1;
      if (input[state.i] === undefined) break;
      if (/[a-zA-Z]/.test(input[state.i])) {
        const name = readCommandName(input, state);
        out += parseCommand(input, state, name);
      } else {
        const name = input[state.i];
        state.i += 1;
        out += parseCommand(input, state, name);
      }
      continue;
    }
    if (ch === "^" || ch === "_") {
      state.i += 1;
      const body = renderLatex(readGroup(input, state));
      out += ch === "^" ? "<sup>" + body + "</sup>" : "<sub>" + body + "</sub>";
      continue;
    }
    if (ch === "{" || ch === "}") { state.i += 1; continue; }
    if (ch === "\n") { out += "<br>"; state.i += 1; continue; }
    if (ch === " ") { out += " "; state.i += 1; continue; }
    out += escapeLatex(ch);
    state.i += 1;
  }
  return out;
}

export function equationHtml(latex) {
  return '<span class="math">' + renderLatex(latex) + "</span>";
}
