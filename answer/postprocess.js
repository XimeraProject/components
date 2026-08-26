// ximera-answer postprocess hook — loaded by tex4npm through the
// "postprocess" field on the package's "latex" manifest (CONTRACT §15).
//
// Two transforms, both scoped to the \answer flow:
//
// 1. injectMathJaxHtmlExtension — extends the window.MathJax tex config to
//    load the HTML TeX extension, which provides \cssId{id}{content}. Must
//    run before extractAnswerBlanks (that emits \cssId into the math source).
//
// 2. extractAnswerBlanks — finds \answer{VALUE} inside math spans (mathjax
//    mode passes math bodies through as raw LaTeX, so tex4ht never renders
//    \answer itself). Replaces each with a \cssId-wrapped \phantom so
//    MathJax carves out a slot of the correct width; adds an invisible
//    state-holder <span class="answer respondable"> after the math element;
//    wraps math + state-holders in .ximera-math-with-answers. Options in
//    the optional bracket (e.g. \answer[format=float,tolerance=0.01]{1.414})
//    become data-format / data-tolerance attributes on the state-holder.

export default async function postprocess($, _ctx) {
  injectMathJaxHtmlExtension($);
  extractAnswerBlanks($);
}

// The html TeX extension provides \cssId. In MathJax 3's tex-chtml-full
// bundle it came preloaded; MathJax 4's tex-chtml bundle only ships
// ams/newcommand/require/autoload/configmacros/textmacros/noundefined,
// so we now add BOTH a `loader.load` entry (fetches the extension code)
// and a `tex.packages` entry (activates it for the tex processor).
export function injectMathJaxHtmlExtension($) {
  $('script').each((_, el) => {
    const src = $(el).html();
    if (!src || !src.includes('MathJax')) return;
    if (src.includes("'[+]'") || src.includes('"[+]"')) return false;
    const patched = src
      .replace(
        /(window\.MathJax\s*=\s*\{)/,
        `$1 loader: { load: ['[tex]/html'] },`
      )
      .replace(
        /(tex\s*:\s*\{)/,
        `$1 packages: { '[+]': ['html'] },`
      );
    if (patched !== src) {
      $(el).html(patched);
      return false;
    }
  });
}

// Locate `\answer` plus its optional `[key=val,...]` prefix. The `{VALUE}`
// body is NOT captured here — VALUE can nest braces (`\answer{\sqrt{2}}`),
// so we hand-scan for the balanced close brace in findAnswerMatches below.
const ANSWER_HEAD_RE = /\\answer\s*(?:\[([^\]]*)\])?\s*\{/g;

// Scan `html` for every `\answer[opts]{VALUE}` occurrence, respecting nested
// braces and `\{`/`\}` escapes inside VALUE. Returns [{start, end, optRaw,
// value}] in document order. `start` is the first char of `\answer`; `end`
// is one past the closing brace.
export function findAnswerMatches(html) {
  const out = [];
  ANSWER_HEAD_RE.lastIndex = 0;
  let m;
  while ((m = ANSWER_HEAD_RE.exec(html)) !== null) {
    const openIdx = m.index + m[0].length - 1;  // position of the `{`
    let depth = 1;
    let i = openIdx + 1;
    while (i < html.length && depth > 0) {
      const c = html[i];
      if (c === '\\' && (html[i + 1] === '{' || html[i + 1] === '}')) {
        i += 2;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    if (depth !== 0) break;   // unbalanced — bail rather than corrupt output
    out.push({
      start: m.index,
      end: i,
      optRaw: m[1],
      value: html.slice(openIdx + 1, i - 1),
    });
    ANSWER_HEAD_RE.lastIndex = i;
  }
  return out;
}

// Estimate the rendered width of \text{VALUE} in em units. Per-character
// averages tuned for math-answer content; conservative so short answers
// still get padded to a usable width.
export function estimateTextWidthEm(text) {
  let w = 0;
  for (const ch of text) {
    if (/\d/.test(ch))                        w += 0.60;
    else if (/[a-z]/.test(ch))                w += 0.52;
    else if (/[A-Z]/.test(ch))                w += 0.68;
    else if (/[.,;:!?'"()\[\]{}]/.test(ch))   w += 0.28;
    else if (/[+\-=<>*/^]/.test(ch))          w += 0.56;
    else                                      w += 0.55;
  }
  return w;
}

export const MIN_BLANK_EM = 2.5;

// Parse "format=float,tolerance=0.01" into { format: 'float', tolerance: '0.01' }.
// Values are trimmed; unknown keys are silently ignored. Missing "=value"
// treats the key as a boolean flag with value "true".
export function parseAnswerOptions(raw) {
  const out = {};
  if (!raw) return out;
  for (const part of raw.split(',')) {
    const eq = part.indexOf('=');
    const key = (eq < 0 ? part : part.slice(0, eq)).trim();
    const val = (eq < 0 ? 'true' : part.slice(eq + 1)).trim();
    if (!key) continue;
    out[key] = val;
  }
  return out;
}

export function extractAnswerBlanks($) {
  let counter = 0;

  $('span.mathjax-inline, div.mathjax-block').each((_, el) => {
    const isBlock = el.tagName.toLowerCase() === 'div';
    const $el = $(el);
    let html = $el.html();
    const matches = findAnswerMatches(html);
    if (matches.length === 0) return;

    const toInsert = [];
    // Walk matches in reverse so slice indices stay valid as we replace.
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      const opts = parseAnswerOptions(m.optRaw);
      const correctText = m.value.trim();
      const n = ++counter;
      const answerId = `ximera-answer-${n}`;
      const placeholderId = `ximera-placeholder-${n}`;

      // Replace \answer{VALUE} with a single \cssId-wrapped \phantom. A
      // single \phantom is important: \cssId attaches the DOM id to the
      // one MathJax node created for its argument, so getElementById
      // returns the element whose bounding rect gives correct width AND
      // height. Splitting into \hphantom+\vphantom risks the id landing
      // on only one child.
      //
      // The raw VALUE is emitted verbatim inside \phantom so MathJax
      // processes it as math — `\answer{\sqrt{2}}` yields an invisible
      // radical of the right width. \hspace{extra} pads to MIN_BLANK_EM
      // when the source is short (heuristic on source length; math often
      // renders narrower than its source, so this errs wider — better
      // than crowding the input on top).
      //
      // \vphantom{\bigg|} is a zero-width strut (~1.5em) MathJax
      // computes reliably; matches an <input> height.
      const extraEm = Math.max(0, MIN_BLANK_EM - estimateTextWidthEm(correctText));
      const widthContent = extraEm > 0.01
        ? `${correctText}\\hspace{${extraEm.toFixed(2)}em}`
        : correctText;

      html = html.slice(0, m.start)
        + `\\cssId{${placeholderId}}{\\phantom{${widthContent}\\vphantom{\\bigg|}}}`
        + html.slice(m.end);
      toInsert.unshift({ answerId, placeholderId, correctText, opts });
    }
    $el.html(html);

    // Insert invisible state-holder spans immediately after the math element.
    // style="display:none" hides them from visual flow; they only hold data.
    let $anchor = $el;
    for (const { answerId, placeholderId, correctText, opts } of toInsert) {
      const attrs = [
        `class="answer respondable"`,
        `id="${answerId}"`,
        `data-placeholder-id="${placeholderId}"`,
        `data-correct-text="${correctText.replace(/"/g, '&quot;')}"`,
      ];
      if (opts.format)    attrs.push(`data-format="${opts.format.replace(/"/g, '&quot;')}"`);
      if (opts.tolerance) attrs.push(`data-tolerance="${opts.tolerance.replace(/"/g, '&quot;')}"`);
      attrs.push(`style="display:none"`);
      const $span = $(`<span ${attrs.join(' ')}></span>`);
      $anchor.after($span);
      $anchor = $span;
    }

    // Wrap the math element + state-holder spans in a container. Use <div>
    // for block math (a <span> cannot validly contain a <div>).
    const wrapperTag = isBlock ? 'div' : 'span';
    const $stateHolders = $el.nextAll('.answer.respondable').slice(0, toInsert.length);
    $el.add($stateHolders).wrapAll(`<${wrapperTag} class="ximera-math-with-answers"></${wrapperTag}>`);
  });
}
