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

export function checkAnswer(response, correctText, format, tolerance) {
  const student = parseFormattedInput(format, response);
  if (student === undefined) return false;
  if (typeof student === 'number' && Number.isNaN(student)) return false;

  const correct = parseFormattedInput(format, correctText);
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
  const correct = checkAnswer(response, msg.correctText, msg.format, msg.tolerance);
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
  const btn = findCheckButton(el);
  syncAnswerableState(el, entry, btn);

  const placeholder = el.dataset.placeholderId
    ? document.getElementById(el.dataset.placeholderId)
    : null;
  const input = placeholder?.querySelector('.ximera-answer-input');
  if (input) {
    focusGuardSyncValue(input, entry.response ?? '');
    input.disabled = !!entry.correct;
  }

  if (btn) btn.style.display = entry.correct ? 'none' : '';

  if (entry.correct) {
    const popover = placeholder?.querySelector('.ximera-math-popover');
    if (popover) popover.hidden = true;
  }
});

function findCheckButton(answerEl) {
  const wrapper = answerEl.closest('.ximera-math-with-answers');
  let next = wrapper?.nextElementSibling;
  while (next) {
    if (next.classList?.contains('ximera-check-btn') && next.dataset.answerId === answerEl.id) {
      return next;
    }
    if (!next.classList?.contains('ximera-check-btn')) break;
    next = next.nextElementSibling;
  }
  return null;
}

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

  const rect = typeof placeholder.getBoundingClientRect === 'function'
    ? placeholder.getBoundingClientRect()
    : { height: 0 };

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'ximera-answer-input';
  input.setAttribute('aria-label', 'answer');
  input.dataset.answerId = el.id;
  input.style.visibility = 'visible';   // input shows over the hidden phantom
  if (rect.height) input.style.height = `${rect.height}px`;
  placeholder.appendChild(input);

  const popover = document.createElement('div');
  popover.className = 'ximera-math-popover';
  popover.setAttribute('role', 'tooltip');
  popover.hidden = true;
  placeholder.appendChild(popover);

  const wrapper = el.closest('.ximera-math-with-answers');
  const checkExtras = {
    id: el.id,
    correctText: el.dataset.correctText ?? '',
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
  wrapper?.parentNode?.insertBefore(btn, wrapper.nextSibling);

  const doCheck = () => dispatchFn({ type: 'ximera-answer:CHECK', ...checkExtras });

  const debouncedPopover = debounce(() => {
    updatePopover(input, popover, el.dataset.format);
  }, 300);

  input.addEventListener('input', () => {
    dispatchFn({ type: 'ximera-answer:INPUT', id: el.id, value: input.value });
    debouncedPopover();
  });

  // MathJax 4's tex-chtml bundle preloads the assistive Explorer, which
  // installs mousedown/click/focusin/keydown listeners on the mjx-container.
  // Because the input sits inside the rendered CHTML tree (positioned over
  // the placeholder \phantom), those listeners see events first: pointer
  // events get treated as "highlight this subexpression" (blocking focus),
  // and keystrokes get treated as Explorer navigation commands (which beep
  // when they don't match a binding). Stop propagation at the input so
  // ancestor handlers never fire.
  const isolate = (event) => event.stopPropagation();
  input.addEventListener('mousedown', isolate);
  input.addEventListener('click', isolate);
  input.addEventListener('focusin', isolate);
  input.addEventListener('keyup', isolate);
  input.addEventListener('keypress', isolate);

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
    btn.style.display = 'none';
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

  let latex;
  try {
    latex = Expression.fromText(text).tex();
  } catch (err) {
    popover.textContent = String(err?.message ?? err ?? 'parse error');
    popover.hidden = false;
    return;
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
