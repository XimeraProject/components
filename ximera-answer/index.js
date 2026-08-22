// ximera-answer — the flagship: \answer{VALUE} inside math environments.
//
// The postprocess step (ximera-answer/postprocess.js, run by tex4npm's
// "postprocess" hook) has turned every \answer{V} into an invisible
// state-holder <span class="answer respondable"> alongside a \cssId'd
// \phantom in the math source. MathJax renders that \phantom into a real
// DOM span sized to hold the answer; our mount injects a real <input>
// inside that span and wires user events into the dispatch loop.
//
// Two phases because MathJax typesets asynchronously:
//   Phase A (synchronous): scheduled via `register`. Records the answerable
//     with the kernel, but cannot create the input yet — MathJax may not
//     have run.
//   Phase B (async): awaits `window.MathJax.startup.promise`, then locates
//     the placeholder span and appends the input + Check button + popover.
//
// Tests await `mountReady` (module-level promise) after mountFixture; in
// production this is fire-and-forget.
//
// See specs/components/ximera-answer.md.

import {
  register, registerReducer, registerRender, readModel, focusGuardSyncValue,
  syncAnswerableState, createCheckButton,
} from 'ximera-core/kernel';
import Expression from 'math-expressions';

// ─── Equality engine (D8) ──────────────────────────────────────────────────
//
// Direct port of original-server/math-answer.js:35-55 (parseFormattedInput)
// and 280-380 (the CHECK handler). Uses math-expressions for symbolic
// equality — the identical dependency the legacy client used. Exported
// so equality.test.js can assert against it without going through the DOM.

export function parseFormattedInput(format, input) {
  if (format === 'integer') {
    // Strict: reject anything that isn't a bare signed integer. parseInt
    // would silently accept "17.5" and drop the fractional; the spec's
    // Example 10 requires that to be rejected.
    const trimmed = String(input).trim();
    if (!/^-?\d+$/.test(trimmed)) return undefined;
    return parseInt(trimmed, 10);
  }
  if (format === 'float') {
    const trimmed = String(input).trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed) && !/^-?\.\d+$/.test(trimmed)) return undefined;
    return parseFloat(trimmed);
  }
  if (format === 'string') return input;
  // default: expression
  try { return Expression.fromText(input); }
  catch { try { return Expression.fromLatex(input); } catch { return undefined; } }
}

// Prefer MathML for the correct side when we're in expression mode and MathJax
// gave us MathML for the authored LaTeX. MathML is MathJax's own parse of the
// TeX source, so constructs math-expressions' own fromLatex can't handle
// (macros, spacing, environments) round-trip cleanly through it. Falls back
// to the text/latex path when no MathML is available or parsing fails.
export function parseCorrect(format, correctText, correctMathml) {
  if ((format === undefined || format === 'expression') && correctMathml) {
    try { return Expression.fromMml(correctMathml); } catch { /* fall through */ }
  }
  return parseFormattedInput(format, correctText);
}

export function checkAnswer(response, correctText, format, tolerance, correctMathml) {
  const student = parseFormattedInput(format, response);
  if (student === undefined) return false;
  if (typeof student === 'number' && Number.isNaN(student)) return false;

  const correct = parseCorrect(format, correctText, correctMathml);
  if (correct === undefined) return false;

  const tol = tolerance === undefined || tolerance === '' ? undefined : Number(tolerance);

  if (tol !== undefined && (format === 'float' || format === undefined || format === 'expression')) {
    // Both sides evaluated numerically; absolute tolerance.
    const s = (format === 'float') ? student : safeEval(student);
    const c = (format === 'float') ? correct : safeEval(correct);
    if (Number.isNaN(s) || Number.isNaN(c)) return false;
    return Math.abs(c - s) <= tol;
  }

  if (format === 'string') {
    // Case-insensitive per legacy line 370 (uppercase-normalized).
    return String(correct).toUpperCase() === String(student).toUpperCase();
  }

  if (format === 'integer' || format === 'float') {
    if (Number.isNaN(correct) || Number.isNaN(student)) return false;
    return correct === student;
  }

  // expression (default): symbolic equality
  try { return student.equals(correct); }
  catch { return false; }
}

function safeEval(expr) {
  if (typeof expr === 'number') return expr;
  try { return expr.evaluate({}); } catch { return NaN; }
}

// ─── Reducers ──────────────────────────────────────────────────────────────

registerReducer('ximera-answer:INPUT', (model, msg) => {
  const prev = model[msg.id] ?? {};
  if (prev.correct === true) return model;                     // locked
  if (prev.response === msg.value) return model;               // no-op
  return { ...model, [msg.id]: { ...prev, response: msg.value } };
});

registerReducer('ximera-answer:CHECK', (model, msg) => {
  const prev = model[msg.id] ?? {};
  if (prev.correct === true) return model;                     // already locked
  const response = (prev.response ?? '').trim();
  if (response === '') return model;                           // no-op empty
  const correct = checkAnswer(
    response, msg.correctText, msg.format, msg.tolerance, msg.correctMathml,
  );
  return {
    ...model,
    [msg.id]: {
      ...prev,
      attempt: prev.response,
      correct,
      complete: correct,
      checked: prev.response,      // for kernel's attempt-feedback observer
    },
  };
});

// ─── Render ────────────────────────────────────────────────────────────────

registerRender('.answer.respondable', (el, entry) => {
  const placeholder = el.dataset.placeholderId
    ? document.getElementById(el.dataset.placeholderId)
    : null;
  const btn = placeholder?.querySelector('.ximera-check-btn') ?? null;

  // Container follows the generic answerable state — the shared render
  // logic (progress, CSS palettes) reads it. The button gets a stricter
  // state: 'attempted' only when the current input still equals the value
  // we last checked. Type something new and the incorrect badge clears;
  // type back to the same wrong value and it reappears without needing
  // another CHECK — matches original-server's math-answer chrome.
  syncAnswerableState(el, entry);
  if (btn) {
    let s = '';
    if (entry?.correct) s = 'correct';
    else if (entry?.checked != null && entry.response === entry.checked) s = 'attempted';
    btn.dataset.state = s;
  }

  const input = placeholder?.querySelector('.ximera-answer-input');
  if (input) {
    focusGuardSyncValue(input, entry.response ?? '');
    input.disabled = !!entry.correct;
  }

  if (entry.correct) {
    const popover = placeholder?.querySelector('.ximera-math-popover');
    if (popover) popover.hidden = true;
  }
});

// ─── Mount ─────────────────────────────────────────────────────────────────
//
// mountPromises collects the Phase B promise for every mounted element so
// tests can await settlement via `await mountReady`. In production this is
// harmless — nothing awaits it and errors go to console.

const mountPromises = [];

export const mountReady = () => Promise.allSettled(mountPromises);

register('.answer.respondable', (el, dispatchFn) => {
  if (!el.id) return;
  mountPromises.push(mountPhaseB(el, dispatchFn).catch((err) => {
    console.warn(`ximera-answer: mount failed for #${el.id}:`, err);
  }));
}, { answerable: true });

// Poll until MathJax has replaced our config literal with the real object
// (which exposes `.startup`, `.typesetPromise`, etc). Bounded so a genuinely
// absent MathJax script doesn't hang mount forever.
async function waitForMathJax(timeoutMs = 10000, intervalMs = 50) {
  if (typeof window === 'undefined') return undefined;
  const deadline = Date.now() + timeoutMs;
  while (!window.MathJax?.startup) {
    if (Date.now() >= deadline) return window.MathJax;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return window.MathJax;
}

async function mountPhaseB(el, dispatchFn) {
  // Wait for MathJax to finish typesetting so the \cssId'd \phantom span exists.
  // The agent's onReady can beat MathJax's <script async> to the finish line;
  // when that happens window.MathJax is still just our config literal and has
  // no `.startup` yet, so optional-chaining `mj?.startup?.promise` would
  // silently skip the await and we'd check for the placeholder before MathJax
  // has even parsed the page. Poll until MathJax installs itself.
  const mj = await waitForMathJax();
  if (mj?.startup?.promise) await mj.startup.promise;
  if (mj?.typesetPromise) {
    try { await mj.typesetPromise(); } catch { /* first-load races are fine */ }
  }

  // Ask MathJax to parse the authored correct-LaTeX into MathML — it's the
  // same TeX parser that just typeset the phantom, so it handles macros
  // math-expressions' own fromLatex cannot. The reducer prefers this MathML
  // over the raw LaTeX when checking equality. tex2mml is synchronous once
  // startup.promise resolves; wrap the call defensively so a bad TeX source
  // (or an environment without tex2mml — happy-dom, older MathJax) falls
  // through to the LaTeX path.
  if (mj && typeof mj.tex2mml === 'function' && el.dataset.correctText && !el.dataset.correctMathml) {
    try {
      const mml = mj.tex2mml(el.dataset.correctText, { display: false });
      if (typeof mml === 'string' && mml.trim() !== '') {
        el.dataset.correctMathml = mml;
      }
    } catch { /* leave data-correct-mathml unset; equality falls back */ }
  }

  const placeholder = document.getElementById(el.dataset.placeholderId);
  if (!placeholder) {
    console.warn(
      `ximera-answer: no placeholder #${el.dataset.placeholderId} for answer #${el.id} ` +
      `(MathJax may not have typeset yet — refresh?)`
    );
    return;
  }

  // Marker-class idempotence: bail if we already installed chrome for this el.
  if (placeholder.querySelector('.ximera-answer-input')) return;

  placeholder.style.position = placeholder.style.position || 'relative';
  placeholder.style.display = placeholder.style.display || 'inline-block';
  placeholder.style.visibility = 'hidden';
  // The phantom sizes to the answer text ("17" ≈ 1em), which leaves no
  // room for the input + Check button pair. Widen it so the flex group
  // has usable horizontal space; the min-width doesn't affect layout on
  // longer answers where the phantom already exceeds it.
  placeholder.style.minWidth = '10em';

  // Input + Check button ride together in a flex group that overlays the
  // hidden \phantom. The group is a sibling of the placeholder's contents
  // but positioned absolutely inside it so the phantom's baseline anchors
  // the whole assembly to the surrounding math. Original-server used
  // Bootstrap's .input-group for the same effect.
  const group = document.createElement('span');
  group.className = 'ximera-input-group';
  group.style.visibility = 'visible';
  placeholder.appendChild(group);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'ximera-answer-input';
  input.setAttribute('aria-label', 'answer');
  input.dataset.answerId = el.id;
  // The placeholder is visibility:hidden so MathJax's phantom doesn't
  // paint over our chrome; the group re-declares visibility:visible so
  // its children paint. Without this explicit setting on the input,
  // browsers treat it as "should inherit hidden" for focus purposes —
  // keystrokes bypass the input and MathJax 4's Explorer beeps at them.
  input.style.visibility = 'visible';
  // Height is intentionally NOT set inline: align-items: stretch on the
  // group sizes the input to the row height, and browsers center text
  // vertically in an <input> when the height comes from layout. Setting
  // height inline from placeholder.getBoundingClientRect().height would
  // stretch the input past its line-height and push text to the top.
  group.appendChild(input);

  const checkExtras = {
    id: el.id,
    correctText: el.dataset.correctText ?? '',
    correctMathml: el.dataset.correctMathml ?? '',
    format: el.dataset.format,
    tolerance: el.dataset.tolerance,
  };
  const btn = createCheckButton({
    dispatch: dispatchFn,
    type: 'ximera-answer:CHECK',
    extras: checkExtras,
    variant: 'icon',
    ariaLabel: 'check work',
    attrs: { 'data-answer-id': el.id },
  });
  group.appendChild(btn);

  const popover = document.createElement('div');
  popover.className = 'ximera-math-popover';
  popover.setAttribute('role', 'tooltip');
  popover.hidden = true;
  // Placeholder is visibility:hidden (see above) so MathJax's phantom
  // doesn't paint through our chrome; every visible child has to opt
  // back in explicitly. Without this, `popover.hidden = false` clears
  // display:none but the popover still won't paint.
  popover.style.visibility = 'visible';
  placeholder.appendChild(popover);

  const doCheck = () => dispatchFn({ type: 'ximera-answer:CHECK', ...checkExtras });

  const debouncedPopover = debounce(() => {
    updatePopover(input, popover, el.dataset.format);
  }, 300);

  input.addEventListener('input', () => {
    dispatchFn({ type: 'ximera-answer:INPUT', id: el.id, value: input.value });
    debouncedPopover();
  });

  // MathJax 4's tex-chtml bundle preloads the assistive Explorer, which
  // installs pointer/focus/keyboard listeners on the mjx-container.
  // Because our input + Check button sit inside the rendered CHTML tree
  // (positioned over the placeholder \phantom), those listeners see
  // events first: pointer/focus events get treated as "highlight this
  // subexpression" (blocking focus), and keystrokes get treated as
  // Explorer navigation commands (which beep when they don't match a
  // binding). Stop propagation at the input-group so nothing that
  // originates from the input, the button, or anything nested reaches
  // the ancestor mjx-container.
  const isolate = (event) => event.stopPropagation();
  for (const type of [
    'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick',
    'contextmenu', 'focusin', 'focusout', 'keydown', 'keyup', 'keypress',
    'touchstart', 'touchend',
  ]) {
    group.addEventListener(type, isolate);
  }

  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    // Legacy line 437-442: Enter triggers Check.
    if (event.keyCode === 13 || event.key === 'Enter') {
      event.preventDefault();
      doCheck();
    }
  });

  input.addEventListener('blur', () => { popover.hidden = true; });
  input.addEventListener('focus', () => {
    // Correct-and-locked answers stay silent; otherwise re-show the last preview.
    if (input.disabled) return;
    debouncedPopover();
  });

  // Reconcile against the current model. The initial render fired before
  // Phase B installed this chrome, so we replay the projection now for the
  // input and the Check button (data-state on el is already correct).
  const entry = readModel()[el.id];
  if (entry?.response) input.value = entry.response;
  if (entry?.correct) {
    input.disabled = true;
    btn.dataset.state = 'correct';
  } else if (entry?.checked != null && entry.response === entry.checked) {
    btn.dataset.state = 'attempted';
  }
}

// ─── Popover (live math preview) ───────────────────────────────────────────

async function updatePopover(input, popover, format) {
  const text = (input.value ?? '').trim();
  if (text === '' || format === 'string') {
    popover.hidden = true;
    return;
  }
  // Purely numeric input (with an optional leading -) needs no preview
  // unless we're in expression mode where "2" might parse to a symbol.
  if (format !== 'expression' && /^-?[0-9.]+$/.test(text)) {
    popover.hidden = true;
    return;
  }

  // Try the text grammar first ("sqrt(2)", "2x", "x^2") — that's what
  // students most often type. Fall back to the LaTeX grammar so a student
  // who's typing raw TeX ("\sqrt{2}", "\frac{1}{2}") also gets a preview.
  // This mirrors the parseFormattedInput fallback order used for checking.
  // Parse failures are the norm mid-typing; surface nothing rather than a
  // "syntax error" popover.
  let latex;
  try {
    latex = Expression.fromText(text).tex();
  } catch {
    try {
      latex = Expression.fromLatex(text).tex();
    } catch {
      popover.hidden = true;
      return;
    }
  }

  popover.textContent = `\\(${latex}\\)`;
  popover.hidden = false;

  const mj = typeof window !== 'undefined' ? window.MathJax : undefined;
  if (mj?.typesetPromise) {
    try { await mj.typesetPromise([popover]); } catch { /* best-effort */ }
  }
}

function debounce(fn, ms) {
  let handle;
  return (...args) => {
    if (handle) clearTimeout(handle);
    handle = setTimeout(() => { fn(...args); handle = undefined; }, ms);
  };
}
