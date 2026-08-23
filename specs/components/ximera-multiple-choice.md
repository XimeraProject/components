# ximera-multiple-choice

**Status:** Phase 0 draft. Consumed by Phase 3.
**Legacy sources:** `original-server/multiple-choice.js` (207 loc), `original-server/shuffle.js` (61 loc).
**Answerable:** yes.

## 1. Purpose

A radio-button-style single-select with an explicit "Check work" step. Tracks wrong answers so they can be visually eliminated on re-attempt. When wrapped in a `\shuffle{…}` (or marked `.shuffle` on the outer div), presents its choices in a per-learner deterministic order backed by a persisted seed — the exact bug the legacy `_.shuffle` had (choice restore mismatch on reload) is what this design is engineered to prevent.

## 2. DOM at mount

Emitted by `ximera.4ht`'s `multipleChoice` environment:

```html
<div class="multiple-choice" id="problemN"
     [data-id="var-name"]
     titletext=" Multiple Choice">
  <span class="choice" [data-value="A"] id="choiceM">First option</span>
  <span class="choice correct" [data-value="B"] id="choiceM+1">Second option</span>
  <span class="choice" [data-value="C"] id="choiceM+2">Third option</span>
</div>
```

Optional shuffle marker (authored via `\begin{shuffle}` or an mc-key, TBD in LaTeX): the outer `.multiple-choice` also has class `shuffle`, or is inside a `.shuffle` ancestor. If neither, choices render in document order.

`data-id` (optional) exposes the selected choice's `data-value` as a JS global — a legacy affordance for `ximera-validator` (deferred). This component preserves the attribute for later use but takes no action on it.

Mount `register` selector: `'.multiple-choice'`, `{ answerable: true }`.

## 3. State

| Key | Type | Owner | Meaning |
|---|---|---|---|
| `chosen` | `string \| undefined` | ximera-mc | Id of the choice the learner has clicked but not yet submitted. |
| `checked` | `string \| undefined` | ximera-mc | Id of the last-submitted choice. `checked === chosen` after a Check click; may diverge if the learner re-selects without checking. |
| `correct` | `boolean` | ximera-mc | Whether `checked` is the correct choice. |
| `complete` | `boolean` | ximera-mc | `=== correct`. Kernel-observed. |
| `wrong` | `{ [choiceId]: true }` | ximera-mc | Set of choice ids that have been submitted incorrectly. Used to render eliminated choices. |
| `seed` | `number` (integer) | ximera-mc | Present only when shuffle is enabled; persisted from the first mount, drives deterministic permutation. |

Legacy mapping:

| Legacy key | New key | Notes |
|---|---|---|
| `chosen` | `chosen` | Same. |
| `checked` | `checked` | Same. |
| `correct` | `correct` | Same. |
| `wrong` | `wrong` | Same shape (`{id: true}` map). |
| — | `complete` | Added; kernel-observed. |
| `initialized` + `shuffle` (array of ids, on `.shuffle` element) | `seed` (number) | Replaced with a numeric seed persisted on the mc entry itself. The array-of-ids was non-deterministic (`_.shuffle`) — see §9. |

## 4. Messages

```
{ type: 'ximera-multiple-choice:SELECT', problemId: string, choiceId: string }
{ type: 'ximera-multiple-choice:CHECK',  problemId: string }
{ type: 'ximera-multiple-choice:SHUFFLE_INIT', problemId: string, seed: number }
```

Reducer summary:

- `SELECT`: sets `chosen = choiceId`; leaves `checked`, `correct`, `wrong` alone. No-op if `entry.correct === true` (locked after correct).
- `CHECK`: if no `chosen`, no-op. Otherwise reads the `.choice[id=chosen]` element's `.correct` class; sets `checked = chosen`, `correct = …`, `complete = correct`. On incorrect, sets `wrong[chosen] = true`.
- `SHUFFLE_INIT`: sets `seed`. Dispatched by mount when it observes no `seed` on a shuffled problem. Idempotent by construction — re-dispatch is a no-op because mount checks the current entry.

## 5. Interactions

Mount steps:

1. If `.multiple-choice` has (or is inside) `.shuffle` and `model[problemId].seed === undefined`, generate a seed via `crypto.getRandomValues(new Uint32Array(1))[0]` and dispatch `SHUFFLE_INIT`.
2. Read `.choice` children. If shuffle enabled, sort them in-DOM using deterministic Fisher-Yates seeded by `entry.seed` (fixture `specs/fixtures/data/shuffle.json` defines the exact algorithm). Order applies **once** at mount; render never touches DOM order.
3. Attach a `click` handler to each `.choice` that dispatches `SELECT`.
4. Append a `<button class="ximera-check-btn">Check</button>` at the end (marker-class idempotent).
5. Attach a `click` handler to the Check button that dispatches `CHECK`.

| User action | Dispatched | Resulting entry | Result on DOM |
|---|---|---|---|
| Click choice `c-a` (fresh) | `SELECT {problemId, choiceId:"c-a"}` | `{ chosen: "c-a" }` | `.multiple-choice[data-state=""]`; `.choice#c-a[data-state="selected"]`; check button enabled |
| Click Check | `CHECK {problemId}` | `{ chosen, checked: "c-a", correct: false, complete: false, wrong: {"c-a": true} }` | `data-state="attempted"`; `#c-a[data-state="selected eliminated"]`; check button re-enabled but greyed until new selection |
| Click choice `c-b` (correct) | `SELECT` | `{ chosen: "c-b", checked: "c-a", wrong: {…} }` | `#c-b[data-state="selected"]`; `#c-a[data-state="eliminated"]` (not selected anymore) |
| Click Check | `CHECK` | `{ chosen, checked: "c-b", correct: true, complete: true, wrong }` | `.multiple-choice[data-state="correct"]`; the Check button gains `data-state="correct"` and paints its green ✓ badge (styled in ximera-core.css) — it stays visible; CSS highlights only the `.choice.correct` and fades the rest; kernel propagates to problem-environment |

## 6. Completion

`complete: true` iff a `CHECK` message lands on a choice whose `.correct` class is set. Kernel's completion diff fires `propagateCorrectness` once.

## 7. Rendering

```js
registerRender('.multiple-choice', (el, entry) => {
  const parts = [];
  if (entry.correct) parts.push('correct');
  else if (entry.checked != null) parts.push('attempted');
  el.dataset.state = parts.join(' ');

  el.querySelectorAll('.choice').forEach(choice => {
    const cp = [];
    if (choice.id === entry.chosen) cp.push('selected');
    if (entry.wrong?.[choice.id]) cp.push('eliminated');
    choice.dataset.state = cp.join(' ');
  });
  // Note: the Check button is NOT hidden on correct. syncAnswerableState
  // (called via the shared kernel helper) sets data-state="correct" on
  // both the outer .multiple-choice and the button, and the button's
  // shared correct-state chrome (ximera-core.css) paints a green ✓ badge.
  // Non-correct choices are visually faded via a CSS rule keyed off
  // `.multiple-choice[data-state~="correct"] .choice:not(.correct)`.
});
```

## 8. Chrome and accessibility

Lifted from legacy `multiple-choice.js` templates:

- Each `.choice` gets `role="radio"`, `tabindex="0"`, `aria-checked="false"` (or `"true"` when `chosen`). Keyboard: Enter/Space activates.
- The `.multiple-choice` outer element gets `role="radiogroup"` and `aria-live="assertive"` on the region that shows the correct/incorrect chrome (via a wrapping `<div class="ximera-mc-status">`, marker-class idempotent).
- Check button: `<button class="ximera-check-btn" type="button" aria-label="check answer">Check</button>`.
- No auto-focus on restore.

## 9. Shuffling

**Determinism.** The legacy `shuffle.js` used `_.shuffle` (non-deterministic) with a comment saying "this must be done deterministically" — the exact bug the plan calls out. New implementation: deterministic Fisher-Yates seeded from `entry.seed`.

**Algorithm** — the code below **is** the spec (no separate oracle file). Deterministic-by-construction: a given `(ids, seed)` produces exactly one order across runtimes, so the conformance test in §10 just invokes the implementation and compares to the DOM.

```js
// Mulberry32 PRNG, seeded by entry.seed (uint32).
// Fisher-Yates in-place from the end. Reproducible cross-runtime.
function shuffle(ids, seed) {
  const rng = mulberry32(seed);
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function mulberry32(s) {
  return function() {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

**Where seed comes from.** Fresh random on first mount, persisted via `SHUFFLE_INIT`. This means learner A and learner B see different shuffles, but a given learner sees the same shuffle every reload — which is what makes `chosen: "c-b"` restore correctly.

**Where it applies.** DOM permutation of `.choice` children happens **once at mount**, after the seed is known. Render never touches DOM order (Guardrail 2: renders are pure projections).

## 10. Examples (become conformance tests)

Given a fixture without shuffle:

```html
<div class="problem-environment" id="p-1" role="article">
  <div class="multiple-choice" id="mc-1">
    <span class="choice" id="c-a">Alpha</span>
    <span class="choice correct" id="c-b">Beta</span>
    <span class="choice" id="c-c">Gamma</span>
  </div>
</div>
```

| # | Action | Assert |
|---|---|---|
| 1 | Bootstrap fresh | Check button appended (marker-class present exactly once); mc-1 entry undefined; problem p-1 available |
| 2 | Click c-a, click Check | `mc-1: { chosen: "c-a", checked: "c-a", correct: false, complete: false, wrong: { "c-a": true } }`; `#c-a[data-state="selected eliminated"]` |
| 3 | Click c-b, click Check | `mc-1: { chosen: "c-b", checked: "c-b", correct: true, complete: true, wrong: { "c-a": true } }`; `p-1.complete === true`; check button stays visible, `dataset.state === "correct"` (paints ✓ badge); no choice carries a `revealed` data-state |
| 4 | Persistence round-trip from state 3 | DOM restored to state 3 |
| 5 | Reset from state 3 | `mc-1` entry cleared; DOM back to state 1; check button re-visible; `agent.setProgress(0)` called |
| 6 | Restore-replay | Render twice, DOM byte-identical |

Given a shuffled fixture (`.shuffle` on `.multiple-choice`):

| # | Action | Assert |
|---|---|---|
| 7 | Bootstrap fresh | Mount dispatched `SHUFFLE_INIT`; `mc-1.seed` is a uint32; `.choice` DOM order matches `shuffle([c-a, c-b, c-c], seed)` per §9 algorithm |
| 8 | Reload with persisted `{ mc-1: { seed: 123, chosen: "c-b", checked: "c-b", correct: true, complete: true } }` | DOM order matches `shuffle([c-a, c-b, c-c], 123)` computed by the §9 algorithm (test invokes the same function to get the expected order); `c-b[data-state="selected"]`; check button `dataset.state === "correct"`; **the correct answer is where the learner clicked it last time — the whole point of the persisted seed** |
| 9 | Reset a shuffled problem | Entry cleared; on the next mount, a fresh seed is generated → NEW shuffle order → learner sees a re-permuted problem. This is intentional; documented in the reset confirmation. |
