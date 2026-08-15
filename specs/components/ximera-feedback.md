# ximera-feedback

**Status:** Phase 0 draft. Consumed by Phase 3. **May dissolve** — PLAN.md §4 flags this row as a candidate for elimination during Phase 3 if per-component `data-state` vocabulary can carry the same information without a dedicated component. This spec documents the behavior either way, so the decision is a code-vs-code decision, not a spec-vs-nothing one.
**Legacy source:** `original-server/feedback.js` (54 loc).
**Answerable:** no.

## 1. Purpose

Reveal author-written commentary in response to a learner's attempt on the containing problem. Two flavors:

- **`data-feedback="attempt"`** — shown after *any* submission on the parent problem (correct or incorrect). Typical use: "Nice try — remember the units."
- **`data-feedback="correct"`** — shown only when the parent problem transitions to `complete: true`. Typical use: "Yes! Note that 17 is prime — that mattered here."

A third legacy flavor, `data-feedback="script"`, evaluates author-supplied JS to decide visibility. **Deferred** with `ximera-validator` per PLAN.md §2 — this component supports only `attempt` and `correct` in v1.

## 2. DOM at mount

Emitted by `ximera.4ht`'s `\feedback[…]` command:

```html
<div class="feedback" data-feedback="attempt|correct"
     id="feedbackN" titletext=" Feedback (attempt|correct)">
  …author-written prose…
</div>
```

Feedback elements are nested **inside** a `.problem-environment` — never at document top level. The mount function walks upward to find the enclosing problem. Mount `register` selector: `'.feedback[data-feedback="attempt"], .feedback[data-feedback="correct"]'`.

## 3. State

| Key | Type | Owner | Meaning |
|---|---|---|---|
| `visible` | `boolean` | (see §5 — either kernel or ximera-feedback) | Whether the feedback should be shown. Persisted. |

Legacy mapping:

| Legacy | New | Notes |
|---|---|---|
| `available` (on feedback) | `visible` | Renamed to disambiguate from problem-environment `available`. |

## 4. Messages

The interesting question. Two candidate designs:

### Design A — kernel-driven (current `ximera-core` behavior)

Kernel's `propagateCorrectness` and `markAttemptFeedback` (see `ximera-core/update.js`) walk `problemEl.querySelectorAll('.feedback[…]')` and set `visible: true` on matching entries. `ximera-feedback` becomes render-only: a `registerRender('.feedback', …)` that projects `visible` to `data-state`.

**Pros:** simplest possible; already implemented; zero coupling from problems to a feedback component (kernel handles it).
**Cons:** kernel knows about `.feedback` — one class of component the kernel treats specially. Slight violation of P2 (kernel owns only the environment triple, not sibling classes).

### Design B — event-driven (contract-clean)

Kernel emits two additional dispatches after every reduce:

- `PROBLEM_ATTEMPTED { problemId }` — fired when any direct answerable of `problemId` transitions `checked: undefined → checked: <value>` (correct or not).
- `PROBLEM_COMPLETED { problemId }` — fired when `propagateCorrectness` sets `problemId.complete: true`.

`ximera-feedback` registers reducers for both, walks the DOM for matching feedback children, sets `visible: true` on the entries.

**Pros:** kernel has no `.feedback` knowledge; adding a hypothetical `ximera-badges` package (which also cares about problem completion) is straightforward — it just listens on `PROBLEM_COMPLETED` too.
**Cons:** two new core-emitted messages need to be part of the frozen contract; kernel must diff for `checked` transitions on any answerable-entry key that isn't in the shared vocabulary (§7 of PLAN.md P4 says shared vocab is limited).

### Recommendation

**Design B**, promoted to the contract. Cost is two message types in the kernel-owned namespace (§4 of CONTRACT.md grows from three to five: `PAGE_STATE_RESTORED`, `AGENT_READY_OFFLINE`, `RESET_WORK`, `PROBLEM_ATTEMPTED`, `PROBLEM_COMPLETED`). Benefit is a clean P2 boundary.

**Decision to be made in Phase 3, before contract-freeze.** This spec is written against Design B; if Design A is chosen instead, edit §5's message names to internal kernel calls and the rest stands.

Message payloads:

```
{ type: 'PROBLEM_ATTEMPTED',  problemId: string }   // core-owned, kernel-emitted
{ type: 'PROBLEM_COMPLETED',  problemId: string }   // core-owned, kernel-emitted
```

Component reducer:

```js
registerReducer('PROBLEM_ATTEMPTED', (model, msg) => {
  const el = document.getElementById(msg.problemId);
  if (!el) return model;
  let next = model;
  for (const fb of el.querySelectorAll('.feedback[data-feedback="attempt"]')) {
    if (fb.closest('.problem-environment') === el && fb.id) {
      next = { ...next, [fb.id]: { ...next[fb.id], visible: true } };
    }
  }
  return next;
});

registerReducer('PROBLEM_COMPLETED', (model, msg) => {
  // Same shape, but for both "attempt" and "correct" flavors — completion is
  // also an attempt, semantically.
  …
});
```

## 5. Interactions

No direct DOM interactions — the component has no chrome. Its state changes only in response to kernel-emitted problem events (Design B) or kernel writes (Design A).

## 6. Completion

N/A — non-answerable.

## 7. Rendering

```js
registerRender('.feedback', (el, entry) => {
  el.dataset.state = entry.visible ? 'visible' : 'hidden';
});
```

CSS owns visuals: `.feedback[data-state="hidden"] { display: none; }`, etc.

## 8. Chrome and accessibility

- No chrome created at mount.
- `.feedback` gets `role="status"` and `aria-live="polite"` (marker: the `role` attribute) — screen readers announce feedback when it becomes visible.
- Initial DOM: `data-state="hidden"` set by first render pass.

## 9. Simplifications vs. legacy

- **`data-feedback="script"` dropped.** Legacy allowed inline JS to decide visibility. This is `ximera-validator` territory (deferred to v2 per PLAN.md §2).
- **Fade animation dropped from state semantics.** Legacy did `fadeTo('slow', 1)` on show. Fade is now purely a CSS concern (`transition: opacity 0.3s`).

## 10. Examples (become conformance tests)

Given a fixture:

```html
<div class="problem-environment" id="p-1" role="article">
  My favorite number is <span class="answer respondable" id="a-1" data-correct-text="17"></span>.
  <div class="feedback" data-feedback="attempt" id="fb-attempt">Not quite — try again.</div>
  <div class="feedback" data-feedback="correct" id="fb-correct">Right! 17 is prime.</div>
</div>
```

| # | Action | Assert |
|---|---|---|
| 1 | Bootstrap fresh | Both feedbacks `data-state="hidden"`; `fb-attempt.visible === undefined`; `fb-correct.visible === undefined` |
| 2 | Learner submits an incorrect answer | Kernel emits `PROBLEM_ATTEMPTED { problemId: "p-1" }`; `fb-attempt.visible === true`; `fb-attempt[data-state="visible"]`; `fb-correct` still hidden |
| 3 | Learner submits the correct answer | Kernel emits `PROBLEM_ATTEMPTED` AND (after propagation) `PROBLEM_COMPLETED`; `fb-attempt.visible === true` (unchanged); `fb-correct.visible === true`; both `data-state="visible"` |
| 4 | Bootstrap with `pageState: { "fb-correct": { visible: true } }` | `fb-correct` visible immediately; `fb-attempt` hidden |
| 5 | Restore-replay | Render twice, DOM byte-identical |
| 6 | Reset from state 3 | Both feedbacks hidden |
| 7 | Nesting: a nested problem's feedback | Not affected by its outer problem's completion; verified via a fixture with two nested `.problem-environment`s each carrying feedback |
