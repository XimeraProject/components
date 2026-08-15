# ximera-answer

**Status:** Phase 0 draft. **The flagship.** Consumed by Phase 4.
**Legacy source:** `original-server/math-answer.js` (453 loc — the largest component in the legacy client).
**Answerable:** yes.

## 1. Purpose

Wire the `\answer{VALUE}` blank inside a math environment into an interactive input. Compare learner input to the authored correct value using `math-expressions` (D8), with optional `data-format` and `data-tolerance` refinements. Owns the tex4npm `"postprocess"` hook that transforms the raw `<span class="answer respondable">` emitted by `ximera.4ht` into the DOM this component's mount targets.

**Phase 4's job is a move-and-extend**, not fresh authorship. The transform that adds `id`, `data-placeholder-id`, and `data-correct-text` **already lives in `tex4npm/src/postprocess.js`** — verified against `specs/fixtures/dist/ximera-answer.html`, which contains `<span class="answer respondable" id="ximera-answer-1" data-placeholder-id="ximera-placeholder-1" data-correct-text="17">` today. Phase 4 (1) *moves* that transform out of tex4npm into `ximera-answer/postprocess.js` via the new `"postprocess"` field on the package's `"latex"` manifest (D5), (2) *extends* it to also carry `data-format` and `data-tolerance` per §9, and (3) *deletes* the residual `\answer`-specific code from tex4npm, completing D3.

## 2. DOM at mount

### Raw output from `ximera.4ht`

```html
… inside a math span rendered by MathJax …
<span class="answer respondable">17</span>
```

That's it — the `.sty` emits only the marker span with the correct answer as its inline text. Everything else is postprocess's job.

### DOM after postprocess

For every `<span class="answer respondable">CORRECT</span>` inside a math span, postprocess:

1. Wraps the outer math span in `<span class="ximera-math-with-answers">`.
2. Inside the math source, replaces `\answer{CORRECT}` with `\cssId{placeholder-N}{\phantom{\text{CORRECT}}}` so MathJax reserves the correct-width space and gives us a DOM handle.
3. Rewrites the `<span class="answer respondable">` to:

```html
<span class="answer respondable"
      id="ximera-answer-N"
      data-placeholder-id="ximera-placeholder-N"
      data-correct-text="17"
      [data-format="integer|float|string|expression"]     ← Phase 4 (see below)
      [data-tolerance="0.01"]                             ← Phase 4 (see below)
      style="display:none"></span>
```

The `.answer.respondable` span is empty in the DOM (its former text content moved into `data-correct-text`). It is the entry key; the visible `<input>` lives inside the `\cssId`'d placeholder after MathJax typesets, per the mount steps below.

**What is emitted today** (verified against `specs/fixtures/dist/ximera-answer.html`): items 1–3 above run inside `tex4npm/src/postprocess.js` and produce the `id` / `data-placeholder-id` / `data-correct-text` / `style="display:none"` attributes. The `data-format` and `data-tolerance` attributes are **missing** — `ximera.4ht`'s `\answer` macro (`\renewcommand{\answer}[2][false]{…}`) silently discards the optional-argument key-value pairs on the HTML side, so `\answer[format=float,tolerance=0.01]{1.414}` reaches the DOM as `data-correct-text="1.414"` with no format/tolerance metadata.

**What Phase 4 adds** for `data-format` / `data-tolerance`: two viable strategies, decision in Phase 4.

- **(A)** Widen the `\answer` macro in `ximera.4ht` (or in the package's own `.4ht` when D5's `"4ht"` support lands in Phase 5) to emit the format/tolerance as data attributes directly. Simpler and correct-by-construction.
- **(B)** Have `ximera-answer/postprocess.js` re-parse the `.tex` source alongside its `.html`, extract each `\answer[options]{…}` invocation in document order, and correlate to the emitted `<span class="answer respondable">` spans by index. More fragile (positional correlation), but avoids a `ximera.4ht` change.

Strategy A is recommended; the fixture data for §6's equality tests assumes it.

Mount `register` selector: `'.answer.respondable'`, `{ answerable: true }`.

## 3. State

| Key | Type | Owner | Meaning |
|---|---|---|---|
| `response` | `string` | ximera-answer | Current input value (as typed). Persisted per keystroke. |
| `attempt` | `string \| undefined` | ximera-answer | The `response` value at the last CHECK dispatch. Distinct from `response` because the learner may keep typing after being told they're wrong. |
| `correct` | `boolean` | ximera-answer | Whether the last CHECK evaluated true. |
| `complete` | `boolean` | ximera-answer | `=== correct`. Kernel-observed. |

Legacy `persistentData` mapping: `response` → `response`, `attempt` → `attempt`, `correct` → `correct`, plus `complete`.

## 4. Messages

```
{ type: 'ximera-answer:INPUT', id: string, value: string }
{ type: 'ximera-answer:CHECK', id: string, correctText: string, format?: string, tolerance?: number }
```

Reducer:

- `INPUT`: sets `response = value`. Does not modify `attempt`/`correct`.
- `CHECK`: computes correctness via the equality engine (§6). Sets `attempt = entry.response`, `correct = <result>`, `complete = correct`. If `entry.response` is empty/whitespace, no-op.

## 5. Interactions

Mount is a two-phase dance because MathJax rendering is asynchronous.

**Phase A (immediate):** the mount is called by the kernel after `agent.onReady`. It cannot create the input yet — MathJax hasn't laid out the placeholder. So Phase A is a no-op recording that Phase B is needed. Alternative implementations may skip Phase A entirely and wire everything from a `MathJax.startup.promise` await inside Phase B.

**Phase B (after `MathJax.startup.promise` and `typesetPromise`):** for each `.answer.respondable`:

1. Locate the `<span id="placeholder-N">` (the `\cssId`'d `\phantom`). MathJax's DOM output.
2. Make the placeholder a positioning container (`position: relative; display: inline-block; visibility: hidden`).
3. Create `<input type="text" class="ximera-answer-input" aria-label="answer">`, sized to `100%` × `<phantom height>px` (from the placeholder's `getBoundingClientRect()`). Append inside the placeholder — this puts the input in MathJax's own flow, so line wraps and zooms move it correctly.
4. Create an optional `<div class="ximera-math-popover">` sibling for MathJax-rendered previews of the learner's input.
5. Insert `<button class="ximera-check-btn" type="button">Check</button>` after the `.ximera-math-with-answers` wrapper.
6. Wire: `input` on the input → dispatch `INPUT`, then (debounced 300ms) update the popover; Enter or Check-click → dispatch `CHECK`.

| User action | Dispatched | Resulting entry | DOM |
|---|---|---|---|
| Type "1" then "7" | 2 × `INPUT` | `response: "17"` (progressively) | popover renders MathJax preview after 300ms idle |
| Click Check with response "17" | `CHECK { id, correctText: "17" }` | `{ response, attempt: "17", correct: true, complete: true }` | input disabled; check button hidden; `.answer.respondable[data-state="respondable correct"]`; kernel propagates |
| Click Check with response "18" | `CHECK` | `{ response, attempt: "18", correct: false, complete: false }` | `data-state="respondable attempted"`; input still enabled; check button still visible; learner keeps typing |

## 6. Equality engine (D8)

Ported from `original-server/math-answer.js` lines 35–55 (`parseFormattedInput`) and 280–380 (the CHECK handler). The engine reads `data-format` and `data-tolerance` from the `.answer.respondable` element:

```js
function parseFormattedInput(format, input) {
  if (format === 'integer') return parseInt(input, 10);
  if (format === 'float')   return parseFloat(input);
  if (format === 'string')  return input;
  // default: expression
  try { return Expression.fromText(input); }
  catch { try { return Expression.fromLatex(input); } catch { return undefined; } }
}

function checkAnswer(response, correctText, format, tolerance) {
  const student = parseFormattedInput(format, response);
  if (student === undefined) return false;

  const correct = parseFormattedInput(format, correctText);

  if (tolerance !== undefined && (format === 'float' || format === undefined || format === 'expression')) {
    // Both sides evaluated numerically; absolute tolerance.
    const s = (format === 'float') ? student : student.evaluate({});
    const c = (format === 'float') ? correct : correct.evaluate({});
    return Math.abs(c - s) <= tolerance;
  }

  if (format === 'string') {
    // Case-insensitive per legacy line 370 (uppercase-normalized).
    return String(correct).toUpperCase() === String(student).toUpperCase();
  }

  if (format === 'integer' || format === 'float') {
    return correct === student;
  }

  // expression (default): symbolic equality
  return student.equals(correct);
}
```

The inline algorithm above **is** the spec — it ports the legacy `math-answer.js` checker directly, reusing `math-expressions` for symbolic equality rather than reimplementing it. Phase 4 acceptance is that the spec's Example 10 (§10) — a hand-authored table of `(input, correctText, format, tolerance) → expected` pairs, exhaustive over the four formats and both tolerance modes — passes against the ported code.

**No separately recorded oracle from the legacy client.** The original plan called for a data-file capture of the legacy checker's outputs before porting, as a belt-and-suspenders check against D8 semantic drift. That was descoped from Phase 0: the mitigation reduces to "reuse `math-expressions`, don't reimplement" (still solid — `math-expressions` is the identical dependency the legacy client used) plus end-to-end validation on real courses in Phase 6. If drift shows up on a specific course, the fix is to add its examples to §10 and iterate.

## 7. Rendering

```js
registerRender('.answer.respondable', (el, entry) => {
  const parts = ['respondable'];
  if (entry.correct) parts.push('correct');
  else if (entry.attempt !== undefined) parts.push('attempted');
  el.dataset.state = parts.join(' ');

  const placeholder = document.getElementById(el.dataset.placeholderId);
  const input = placeholder?.querySelector('.ximera-answer-input');
  if (input) {
    if (document.activeElement !== input && entry.response !== undefined && input.value !== entry.response) {
      input.value = entry.response;
    }
    input.disabled = !!entry.correct;
  }

  const wrapper = el.closest('.ximera-math-with-answers');
  const btn = wrapper?.nextElementSibling;
  if (btn?.classList.contains('ximera-check-btn') && btn.dataset.answerId === el.id) {
    btn.style.display = entry.correct ? 'none' : '';
  }
});
```

Focus guard is essential here — the learner is typing when server-side `pagestate-changed` might arrive.

## 8. Chrome and accessibility

Lifted from legacy `math-answer.js` `template`:

- `<input aria-label="answer" type="text">` (line 18 of legacy).
- Check button: `aria-label="check work"`, tooltip title "Click to check your answer." (lines 26–33).
- Correct badge: `aria-label="correct answer"`, `aria-live="assertive"` — rendered by CSS off `data-state="respondable correct"` (no separate button element required, but marker span optional).
- Incorrect badge: `aria-label="incorrect! try again"`, `aria-live="assertive"` — same.
- Space key inside the input MUST NOT open the MathJax context menu (legacy line 106–110: `event.stopPropagation()` on keyCode 32).
- Enter inside the input triggers Check (legacy line 437–442).

Keyboard summary: Tab into input, type, Enter to check (or Tab to Check button then Space/Enter).

## 9. What ships in v1, and what doesn't

**Included in v1:**

- `integer`, `float`, `string`, `expression` formats — **gated on Phase 4 emitting `data-format` in the DOM** (see §2 strategy A/B). Without that, the equality engine has no way to know which format was authored, and every answer defaults to `expression`.
- Absolute tolerance via `data-tolerance` — same gate: today's DOM does not carry the attribute.
- Math-expressions symbolic equality with `fromText` → `fromLatex` fallback.
- Postprocess-owned `<span class="answer respondable">` extraction (Phase 4 *moves* the existing transform out of `tex4npm/src/postprocess.js` into `ximera-answer/postprocess.js`, extends it with format/tolerance passthrough, and deletes the tex4npm original — completing D3).
- MathJax input popover preview (nice-to-have; may be gated on a config flag).

**Explicitly deferred:**

- **Per-answer statistics.** Legacy displayed a bar-chart tooltip of learner response frequencies on each answer (lines 217–219 of `math-answer.js`, driven by an `ximera:statistics:answers` event). Not in v1 — this is the first legitimate P5 micro-renderer case per PLAN.md §4 backlog. When it returns, it lives inside `ximera-answer` and uses a private renderer (lit-html or `<template>`) with no contract change.
- **`math-palette`.** Legacy had a floating math keyboard for tablet/touch input. Not in v1.
- **`data-validator`.** JS code that evaluates a custom `(student, correct) => bool`. This is `ximera-validator` and is deferred to v2 with `javascript.js` / `interactives.js` (PLAN.md §2).
- **Async correctness** (a `Promise` returned by the checker). Legacy handled this for remote validators. Not in v1; if it returns, it's a `ximera-validator` concern.
- **`data-id` global variable exposure** (legacy line 60–65). Deferred with `ximera-validator`.

## 10. Examples (become conformance tests)

Given a fixture with two answer blanks:

```html
<div class="problem-environment" id="p-1" role="article">
  My favorite number is
  <span class="ximera-math-with-answers">
    <span class="mathjax-inline">y = <mjx-container>… \phantom … cssId=placeholder-1 …</mjx-container></span>
    <span class="answer respondable" id="a-1"
          data-placeholder-id="placeholder-1"
          data-correct-text="17"></span>
  </span>
  and my second favorite is
  <span class="ximera-math-with-answers">
    <span class="mathjax-inline">…placeholder-2…</span>
    <span class="answer respondable" id="a-2"
          data-placeholder-id="placeholder-2"
          data-correct-text="1.414"
          data-format="float"
          data-tolerance="0.01"></span>
  </span>.
</div>
```

| # | Action | Assert |
|---|---|---|
| 1 | Bootstrap fresh, wait for MathJax typeset | Two `<input class="ximera-answer-input">`s exist, one per placeholder; two Check buttons exist (marker-class idempotent) |
| 2 | Type "17" into a-1's input, click Check | `a-1: { response: "17", attempt: "17", correct: true, complete: true }`; `a-1[data-state="respondable correct"]`; input disabled; p-1 NOT yet complete (a-2 unanswered) |
| 3 | Type "1.42" into a-2's input, click Check | `a-2.correct === true` (|1.414 − 1.42| = 0.006 ≤ 0.01); `p-1.complete === true`; `agent.setProgress(1.0)` |
| 4 | Type "1.5" into a-2's input, click Check | `a-2.correct === false` (|1.414 − 1.5| = 0.086 > 0.01); `p-1.complete === false`; retry allowed |
| 5 | Type "seventeen" into a-1, click Check | `a-1.correct === false` (`parseInt` semantics if format-less would go to expression path; here no format so expression: "seventeen" fails to parse → student undefined → false) |
| 6 | Persistence: state 3 → JSON → restore | DOM restored exactly; inputs disabled; check buttons hidden |
| 7 | Focus guard: focus a-1 input, type "1", pagestate-changed arrives with `a-1.response: "server-value"` | input.value still "1"; on blur+next render, syncs |
| 8 | Reset from state 3 | Both entries cleared; inputs empty and enabled; check buttons visible |
| 9 | Restore-replay | Render twice, DOM byte-identical |
| 10 | Equality suite | The hand-authored table below (each row an independent test): `("17", "17", undefined, undefined) → true` · `("17.0", "17", undefined, undefined) → true` (expression equality) · `("seventeen", "17", undefined, undefined) → false` · `("17", "17", "integer", undefined) → true` · `("17.5", "17", "integer", undefined) → false` (parseInt drops fractional) · `("1.414", "1.414", "float", undefined) → true` · `("1.42", "1.414", "float", 0.01) → true` · `("1.5", "1.414", "float", 0.01) → false` · `("cat", "CAT", "string", undefined) → true` (case-insensitive) · `("dog", "cat", "string", undefined) → false` · `("2x", "2*x", undefined, undefined) → true` (symbolic) · `("x+x", "2*x", undefined, undefined) → true` (symbolic simplification) · `("", "17", undefined, undefined) → false` (empty input) · `("  ", "17", undefined, undefined) → false` (whitespace-only) |
