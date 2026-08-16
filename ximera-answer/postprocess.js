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

export function injectMathJaxHtmlExtension($) {
  $('script').each((_, el) => {
    const src = $(el).html();
    if (!src || !src.includes('MathJax')) return;
    if (src.includes("'[+]'") || src.includes('"[+]"')) return false;
    const patched = src.replace(
      /(tex\s*:\s*\{)/,
      `$1 packages: { '[+]': ['html'] },`
    );
    if (patched !== src) {
      $(el).html(patched);
      return false;
    }
  });
}

// Regex captures the optional argument (group 1) and the required value (group 2).
// The optional bracket group is a lazy `[^\]]*` so nested brackets are not
// supported — that matches TeX's own key=value convention (no nested [] anyway).
const ANSWER_RE = /\\answer\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g;

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
    const matches = [...html.matchAll(ANSWER_RE)];
    if (matches.length === 0) return;

    const toInsert = [];
    // Walk matches in reverse so slice indices stay valid as we replace.
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      const opts = parseAnswerOptions(m[1]);
      const correctText = m[2].trim();
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
      // Width: \text{VALUE} sizes the slot to the rendered text width.
      // When narrower than MIN_BLANK_EM we append \hspace{extra} so
      // MathJax allocates enough room for a usable field. CSS has no
      // min-width — the phantom is authoritative.
      //
      // Height: \vphantom{\bigg|} is a zero-width strut (~1.5em) MathJax
      // 3 computes reliably; matches an <input> height.
      const escapedText = correctText
        .replace(/\\/g, '\\textbackslash{}')
        .replace(/[{}]/g, '\\$&')
        .replace(/[%$#&_^~]/g, '\\$&');

      const extraEm = Math.max(0, MIN_BLANK_EM - estimateTextWidthEm(correctText));
      const widthContent = extraEm > 0.01
        ? `\\text{${escapedText}}\\hspace{${extraEm.toFixed(2)}em}`
        : `\\text{${escapedText}}`;

      html = html.slice(0, m.index)
        + `\\cssId{${placeholderId}}{\\phantom{${widthContent}\\vphantom{\\bigg|}}}`
        + html.slice(m.index + m[0].length);
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
