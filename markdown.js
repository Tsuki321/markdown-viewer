const mathJaxUrl = "https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-chtml-full.js";
const wrappedDollar = "$" + String.fromCharCode(96);
const closeWrappedDollar = String.fromCharCode(96) + "$";
const mathEnvironments = new Set([
  "align", "align*", "aligned", "alignedat", "alignat", "alignat*",
  "array", "Bmatrix", "bmatrix", "cases", "CD", "dcases", "dcases*",
  "empheq", "eqnarray", "eqnarray*", "equation", "equation*",
  "flalign", "flalign*", "gather", "gather*", "gathered", "matrix",
  "multline", "multline*", "pmatrix", "rcases", "rcases*", "smallmatrix",
  "split", "subarray", "Vmatrix", "vmatrix",
]);

const markdown = window.markdownit({ html: false, linkify: true });
let mathJaxReady;
let mathRenderQueue = Promise.resolve();

function isEscaped(text, index) {
  let slashCount = 0;
  while (index > 0 && text[--index] === "\\") slashCount++;
  return slashCount % 2 === 1;
}

function inlineMath(state, silent) {
  const { src, pos, posMax } = state;
  const opening = src.startsWith("\\(", pos) ? "\\(" :
    src.startsWith("\\[", pos) ? "\\[" :
    src.startsWith("$$", pos) ? "$$" :
    src.startsWith(wrappedDollar, pos) ? wrappedDollar :
    src[pos] === "$" ? "$" : "";
  if (!opening || (opening[0] === "$" && src[pos - 1] === "$")) return false;

  const closing = { "\\(": "\\)", "\\[": "\\]" }[opening] ||
    (opening === wrappedDollar ? closeWrappedDollar : opening);
  const contentStart = pos + opening.length;
  const inlineDollar = opening === "$";
  if (inlineDollar && /\s/.test(src[contentStart] || " ")) return false;

  const newline = src.indexOf("\n", contentStart);
  const limit = inlineDollar && newline !== -1 ? Math.min(newline, posMax) : posMax;
  let contentEnd = src.indexOf(closing, contentStart);

  while (contentEnd >= 0 && contentEnd + closing.length <= limit) {
    if (!isEscaped(src, contentEnd)) {
      const after = contentEnd + closing.length;
      const content = src.slice(contentStart, contentEnd);
      if (!content.trim()) return false;
      if (inlineDollar && (
        /\s/.test(src[contentEnd - 1]) || /[\d$]/.test(src[after] || "") ||
        (/\d/.test(src[contentStart]) && /^[\d.,]+(?:\s|$)/.test(content) && /^[\p{L}]/u.test(src[after] || ""))
      )) return false;

      if (!silent) {
        const token = state.push("math_inline", "", 0);
        token.content = content;
        token.meta = { display: opening === "$$" || opening === "\\[", original: src.slice(pos, after) };
      }
      state.pos = after;
      return true;
    }
    contentEnd = src.indexOf(closing, contentEnd + closing.length);
  }
  return false;
}

function blockMath(state, start, end, silent) {
  if (state.sCount[start] - state.blkIndent >= 4) return false;

  const firstLine = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
  const environment = /^\\begin\{([A-Za-z]+\*?)\}/.exec(firstLine);
  let opening = "";
  let closing = "";
  if (firstLine.startsWith("$$")) {
    opening = closing = "$$";
  } else if (firstLine.startsWith("\\[")) {
    opening = "\\[";
    closing = "\\]";
  } else if (environment && mathEnvironments.has(environment[1])) {
    opening = environment[0];
    closing = "\\end{" + environment[1] + "}";
  } else {
    return false;
  }

  const lines = [];
  for (let line = start; line < end; line++) {
    if (line > start && state.sCount[line] < state.blkIndent && !state.isEmpty(line)) break;
    const text = line === start ? firstLine.slice(opening.length) : state.getLines(line, line + 1, state.blkIndent, false);
    const last = text.trimEnd();
    const closeAt = last.length - closing.length;
    if (last.endsWith(closing) && !isEscaped(last, closeAt)) {
      lines.push(last.slice(0, closeAt));
      const body = lines.join("\n");
      if (!body.trim() && !environment) return false;
      if (silent) return true;

      const token = state.push("math_block", "", 0);
      token.block = true;
      token.map = [start, line + 1];
      token.content = environment ? opening + body + closing : body.trim();
      token.meta = { display: true, original: opening + body + closing };
      state.line = line + 1;
      return true;
    }
    lines.push(text);
  }
  return false;
}

function mathPlaceholder(token, env, block = false) {
  const index = env.formulas.push(token) - 1;
  const tag = block ? "div" : "span";
  const cssClass = block ? "math-block" : token.meta.display ? "math-inline math-display" : "math-inline";
  const original = markdown.utils.escapeHtml(token.meta.original);
  return '<' + tag + ' class="' + cssClass + '" data-formula="' + index +
    '"><span class="math-source">' + original + '</span></' + tag + '>';
}

markdown.inline.ruler.before("escape", "math_inline", inlineMath);
markdown.block.ruler.before("fence", "math_block", blockMath, {
  alt: ["paragraph", "reference", "blockquote", "list"],
});
markdown.renderer.rules.math_inline = (tokens, index, options, env) => mathPlaceholder(tokens[index], env);
markdown.renderer.rules.math_block = (tokens, index, options, env) => mathPlaceholder(tokens[index], env, true) + "\n";

const renderFence = markdown.renderer.rules.fence;
markdown.renderer.rules.fence = (tokens, index, options, env, renderer) => {
  const token = tokens[index];
  if (/^(?:math|latex|tex)$/i.test(token.info.trim())) {
    return mathPlaceholder({
      content: token.content,
      meta: { display: true, original: token.content },
    }, env, true) + "\n";
  }
  return renderFence(tokens, index, options, env, renderer);
};

markdown.core.ruler.after("text_join", "task_lists", (state) => {
  for (let i = 2; i < state.tokens.length; i++) {
    const item = state.tokens[i - 2];
    const paragraph = state.tokens[i - 1];
    const inline = state.tokens[i];
    if (item.type !== "list_item_open" || paragraph.type !== "paragraph_open" || inline.type !== "inline") continue;

    const mark = /^\[([ xX])\][ \t]+/.exec(inline.content);
    const text = inline.children[0];
    if (!mark || text?.type !== "text" || !text.content.startsWith(mark[0])) continue;

    const check = new state.Token("task_checkbox", "", 0);
    check.meta = { checked: mark[1] !== " " };
    text.content = text.content.slice(mark[0].length);
    inline.children.unshift(check);
    item.attrJoin("class", "task-list-item");
  }
});

markdown.renderer.rules.task_checkbox = (tokens, index) => {
  const { checked } = tokens[index].meta;
  return '<input type="checkbox" disabled' + (checked ? ' checked' : '') +
    ' aria-label="' + (checked ? 'Completed task' : 'Incomplete task') + '"> ';
};

const validateLink = markdown.validateLink;
markdown.validateLink = (url) => {
  const scheme = /^[a-z][a-z\d+.-]*:/i.exec(url.trim())?.[0];
  return validateLink(url) && (!scheme || /^(?:https?|mailto|tel):$/i.test(scheme) ||
    /^data:image\/(?:gif|jpe?g|png|webp);base64,/i.test(url));
};

const renderImage = markdown.renderer.rules.image;
markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const token = tokens[index];
  token.attrSet("loading", "lazy");
  token.attrSet("decoding", "async");
  token.attrSet("referrerpolicy", "no-referrer");
  return renderImage(tokens, index, options, env, renderer);
};

// Use the parser to protect code and display math before repairing source spacing.
export function formatMarkdown(source) {
  const input = source.replace(/\r\n?/g, "\n");
  const tokens = [];
  markdown.block.parse(input, markdown, {}, tokens);
  const protectedLines = new Set();
  for (const token of tokens) {
    if (!["fence", "code_block", "math_block"].includes(token.type)) continue;
    for (let line = token.map[0]; line < token.map[1]; line++) protectedLines.add(line);
  }

  const lines = input.split("\n");
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (protectedLines.has(i) || /^(?: {4}|\t)/.test(line)) {
      result.push(line);
      continue;
    }
    if (!line.trim()) {
      if (result.length && result[result.length - 1] !== "") result.push("");
      continue;
    }

    line = line.replace(/^( {0,3}#{1,6})[ \t]+(?=[^#\s])/, "$1 ")
      .replace(/^( {0,3}#{1,6})(?=\p{L})/u, "$1 ")
      .replace(/^( {0,3}(?:[-+*]|\d{1,9}[.)]))[ \t]*(\[[ xX]\])[ \t]*(?=\S)/, "$1 $2 ")
      .replace(/^( {0,3}>\s*)(?=\S)/, (prefix) => prefix.endsWith(" ") ? prefix : prefix + " ");
    if (!/(?: {2,}|\t)$/.test(line)) line = line.replace(/ $/, "");
    result.push(line);
  }
  const lastSourceLine = lines.length - (input.endsWith("\n") ? 2 : 1);
  if (!protectedLines.has(lastSourceLine) && result[result.length - 1] === "") result.pop();
  return result.length ? result.join("\n") + "\n" : "";
}

function loadMathJax() {
  if (mathJaxReady) return mathJaxReady;
  mathJaxReady = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = "MathJax-script";
    script.src = mathJaxUrl;
    script.async = true;
    const timeout = window.setTimeout(() => reject(new Error("MathJax timed out.")), 15000);
    function fail(error) {
      window.clearTimeout(timeout);
      reject(error);
    }

    window.MathJax = {
      loader: { load: ["ui/safe"], failed: fail },
      startup: { typeset: false },
      tex: {
        packages: { "[+]": ["physics"], "[-]": ["require", "noerrors", "noundefined"] },
        tags: "ams",
      },
      options: {
        enableMenu: false,
        safeOptions: { allow: { URLs: "none", classes: "none", cssIDs: "none", styles: "safe" } },
      },
    };
    script.addEventListener("error", () => fail(new Error("MathJax could not load.")), { once: true });
    script.addEventListener("load", () => {
      window.MathJax.startup.promise.then(() => {
        window.clearTimeout(timeout);
        resolve(window.MathJax);
      }, fail);
    }, { once: true });
    document.head.append(script);
  });
  return mathJaxReady;
}

function setHeadingLinks(fragment) {
  const used = new Set();
  for (const heading of fragment.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
    const base = heading.textContent.toLowerCase().trim()
      .replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, "").replace(/\s+/g, "-") || "heading";
    let slug = base;
    for (let count = 1; used.has(slug); count++) slug = base + "-" + count;
    used.add(slug);
    heading.id = "doc-" + slug;
  }
  for (const link of fragment.querySelectorAll('a[href^="#"]')) {
    const hash = link.getAttribute("href").slice(1);
    let slug;
    try {
      slug = decodeURIComponent(hash);
    } catch {
      continue;
    }
    if (used.has(slug)) link.setAttribute("href", "#doc-" + slug);
  }
}

async function typesetFormulas(fragment, formulas) {
  const placeholders = fragment.querySelectorAll("[data-formula]");
  try {
    const mathJax = await loadMathJax();
    mathJax.texReset();
    for (const placeholder of placeholders) {
      const { content, meta } = formulas[Number(placeholder.dataset.formula)];
      try {
        const rendered = await mathJax.tex2chtmlPromise(content, { display: meta.display });
        for (const link of rendered.querySelectorAll("[href]")) link.removeAttribute("href");
        placeholder.replaceChildren(rendered);
      } catch {
        placeholder.title = "This LaTeX expression could not be rendered.";
      }
    }
    const stylesheet = mathJax.chtmlStylesheet();
    if (!stylesheet.isConnected) document.head.append(stylesheet);
  } catch {
    for (const placeholder of placeholders) placeholder.title = "MathJax could not load.";
  }
}

export async function renderMarkdown(source) {
  const env = { formulas: [] };
  const template = document.createElement("template");
  template.innerHTML = markdown.render(formatMarkdown(source), env);
  setHeadingLinks(template.content);
  if (env.formulas.length) {
    const task = mathRenderQueue.then(() => typesetFormulas(template.content, env.formulas));
    mathRenderQueue = task.catch(() => {});
    await task;
  }
  return template.content;
}
