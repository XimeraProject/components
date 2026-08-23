# ximera-select-all

**Status:** Phase 0 draft. Consumed by Phase 3.
**Legacy source:** `original-server/select-all.js` (156 loc; the legacy file's first comment reads "BADBAD: This code is unfortunately a minor tweak of multiple-choice. The similar code should be shared somehow." — this design does the sharing).
**Answerable:** yes.

## 1. Purpose

A checkbox-style multi-select: the learner chooses any subset of options, then Checks. Correct iff the chosen set is exactly the set of `.choice.correct` elements. Shares the shuffle util with `ximera-multiple-choice` (§9 of that spec).

## 2. DOM at mount

Emitted by `ximera.4ht`'s `selectAll` environment:

```html
<div class="select-all" id="problemN"
     titletext=" Select All">
  <span class="choice correct" id="choiceM">Even numbers</span>
  <span class="choice" id="choiceM+1">Odd numbers</span>
  <span class="choice correct" id="choiceM+2">Positive numbers</span>
</div>
```

Multiple `.choice.correct` may be present (that's the point). Shuffle marker (optional): `.shuffle` class on the outer div. Mount `register` selector: `'.select-all'`, `{ answerable: true }`.

## 3. State

| Key | Type | Owner | Meaning |
|---|---|---|---|
| `chosen` | `string[]` | ximera-sa | Currently-selected choice ids. Order is insertion order but is treated as a set for equality. |
| `checked` | `string[] \| undefined` | ximera-sa | The set at the last CHECK dispatch. |
| `correct` | `boolean` | ximera-sa | Whether `sortedSet(checked) === sortedSet(correctIds)`. |
| `complete` | `boolean` | ximera-sa | `=== correct`. Kernel-observed. |
| `seed` | `number` | ximera-sa | Present when shuffle is enabled; same rules as mc. |

Legacy mapping: same shape as legacy `select-all.js` (`chosen`/`checked` as arrays), plus `complete`. No `wrong` map — with sets, "eliminate a specific wrong pick" doesn't cleanly generalize; the whole submission is either correct or not.

## 4. Messages

```
{ type: 'ximera-select-all:TOGGLE', problemId: string, choiceId: string }
{ type: 'ximera-select-all:CHECK',  problemId: string }
{ type: 'ximera-select-all:SHUFFLE_INIT', problemId: string, seed: number }
```

Reducer summary:

- `TOGGLE`: flip presence of `choiceId` in `entry.chosen` array. If `entry.correct === true`, no-op (locked).
- `CHECK`: if `entry.chosen` empty, no-op. Otherwise compute `correct` by comparing the sorted `chosen` to the sorted list of `.choice.correct` ids inside the problem. Set `checked = chosen.slice()`, `correct`, `complete = correct`.
- `SHUFFLE_INIT`: same as mc.

## 5. Interactions

Mount steps identical to mc §5 steps 1–2 (shuffle init), then:

3. Attach a `click` handler to each `.choice` that dispatches `TOGGLE`.
4. Append a `<button class="ximera-check-btn">Check</button>` (marker-class idempotent).
5. Attach a `click` handler that dispatches `CHECK`.

| User action | Dispatched | Resulting entry (partial) | Result on DOM |
|---|---|---|---|
| Click c-a (empty → in) | `TOGGLE { problemId, choiceId:"c-a" }` | `chosen: ["c-a"]` | `#c-a[data-state="selected"]` |
| Click c-a again | `TOGGLE` | `chosen: []` | `#c-a[data-state=""]` |
| Click c-a, c-c; Check | `CHECK` | `checked: ["c-a","c-c"], correct: true, complete: true` (if `.correct` set matches) | `.select-all[data-state="correct"]`; the Check button gains `data-state="correct"` and paints its green ✓ badge (styled in ximera-core.css) — it stays visible; CSS highlights `.choice.correct` and fades every `.choice:not(.correct)` |
| Click c-a, c-b; Check | `CHECK` | `checked: ["c-a","c-b"], correct: false, complete: false` | `data-state="attempted"`; toggles remain enabled; learner can adjust and re-Check |

## 6. Completion

`complete: true` iff the sorted `checked` array equals the sorted list of `.choice.correct` ids inside the problem.

## 7. Rendering

```js
registerRender('.select-all', (el, entry) => {
  const parts = [];
  if (entry.correct) parts.push('correct');
  else if (entry.checked != null) parts.push('attempted');
  el.dataset.state = parts.join(' ');

  const chosenSet = new Set(entry.chosen ?? []);
  el.querySelectorAll('.choice').forEach(choice => {
    const cp = [];
    if (chosenSet.has(choice.id)) cp.push('selected');
    choice.dataset.state = cp.join(' ');
    choice.setAttribute('aria-checked', chosenSet.has(choice.id) ? 'true' : 'false');
  });
  // Note: the Check button is NOT hidden on correct. syncAnswerableState
  // sets data-state="correct" on both the outer .select-all and the
  // button; ximera-core.css paints the button's green ✓ badge.
  // Non-correct choices are visually faded via
  // `.select-all[data-state~="correct"] .choice:not(.correct)`.
});
```

## 8. Chrome and accessibility

- Each `.choice` gets `role="checkbox"`, `tabindex="0"`, `aria-checked` (dynamic per render). Enter/Space toggles.
- Outer `.select-all` gets `role="group"` (not `radiogroup` — it's multi-select) and an `aria-label` derived from `titletext`.
- Check button same as mc.
- No auto-focus.

## 9. Shuffle

Same algorithm and seed rules as `ximera-multiple-choice` §9. The `ximera-mc-shuffle` util is a shared internal module that both packages import (via a package they both depend on, or duplicated code — Phase 3 refactors this per PLAN.md §5 Phase 3).

## 10. Examples (become conformance tests)

Given a fixture with two correct answers:

```html
<div class="problem-environment" id="p-1" role="article">
  <div class="select-all" id="sa-1">
    <span class="choice correct" id="c-a">A</span>
    <span class="choice" id="c-b">B</span>
    <span class="choice correct" id="c-c">C</span>
    <span class="choice" id="c-d">D</span>
  </div>
</div>
```

| # | Action | Assert |
|---|---|---|
| 1 | Bootstrap fresh | Check button appended once |
| 2 | Toggle c-a, toggle c-c, Check | `sa-1.correct === true, complete === true`; `p-1.complete === true`; check button stays visible, `dataset.state === "correct"` (paints ✓ badge); no choice carries a `revealed` data-state |
| 3 | Toggle c-a, toggle c-b, Check | `correct === false, complete === false`; `data-state="attempted"`; learner can continue |
| 4 | From state 3, toggle c-b off, toggle c-c on, Check | `correct === true, complete === true` |
| 5 | From state 3 (attempted), toggle c-b off — no Check | `chosen: ["c-a"]`; `checked` still `["a","b"]` from state 3; `correct` still false; `complete` false (unchanged); `data-state="attempted"` still |
| 6 | Toggle a choice while correct | No-op (component reducer returns same reference) |
| 7 | Persistence round-trip from state 2 | DOM restored exactly |
| 8 | Reset from state 2 | Entry cleared; check button `dataset.state === ""` (badge cleared, back to first-visit chrome) |
| 9 | Restore-replay | Render twice, DOM byte-identical |
| 10 | Set-equality: chosen `[c-c, c-a]` equals `[c-a, c-c]` | Correct — order-insensitive |
