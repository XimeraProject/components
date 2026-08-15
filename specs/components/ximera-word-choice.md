# ximera-word-choice

**Status:** Phase 0 draft. Consumed by Phase 2 (pilot #2 — the first answerable).
**Legacy source:** `original-server/word-choice.js` (132 loc).
**Answerable:** yes.

## 1. Purpose

An inline dropdown embedded in prose. Selecting a choice IS the submission — no separate "check" step. Immediate feedback: the selection is either correct (locks) or incorrect (allows re-selection). Proves the D1 observed-completion path end-to-end with the smallest possible answerable.

## 2. DOM at mount

Emitted by `ximera.4ht`'s `\wordChoice` (a `multipleChoice@` variant):

```html
<span class="word-choice" id="word-choiceN">
  <span class="choice correct" id="choiceM">apple</span>
  <span class="choice" id="choiceM+1">banana</span>
  <span class="choice" id="choiceM+2">cherry</span>
</span>
```

- Outer element is an inline `<span>` (not a `<div>`) because word-choice sits mid-sentence.
- Every `.choice` has an `id`. The `.correct` class marks the right answer (authored intent, D9 guardrail 1 — read-only configuration).
- Word-choice is **always** wrapped in a `.problem-environment` (via `\begin{problem}…\end{problem}` in the author's LaTeX). The `.word-choice` element is the answerable; the containing `.problem-environment` is what completes.

Mount `register` selector: `'.word-choice'`, `{ answerable: true }`.

## 3. State

| Key | Type | Owner | Meaning |
|---|---|---|---|
| `chosen` | `string \| undefined` | ximera-word-choice | Id of the currently-selected `.choice`. |
| `checked` | `string \| undefined` | ximera-word-choice | Id of the last-submitted choice. Same as `chosen` in this component. |
| `correct` | `boolean` | ximera-word-choice | Whether the selection is the correct choice. |
| `complete` | `boolean` | ximera-word-choice | `=== correct`. Trigger for propagation (CONTRACT §5, §9). |

Legacy `persistentData` mapping:

| Legacy key | New key | Notes |
|---|---|---|
| `response` (choice id) | `chosen` | Renamed to match multiple-choice for consistency. |
| `correct` | `correct` | Same. |
| — | `checked` | Added: makes render logic consistent with multiple-choice (`checked !== undefined` → attempted state). |
| — | `complete` | Added: derived from `correct`; the answerable-completion contract. |

## 4. Messages

```
{ type: 'ximera-word-choice:SELECT', problemId: string, choiceId: string }
```

Reducer:

```js
registerReducer('ximera-word-choice:SELECT', (model, msg) => {
  const choiceEl = document.getElementById(msg.choiceId);
  const correct = choiceEl?.classList.contains('correct') ?? false;
  return {
    ...model,
    [msg.problemId]: {
      ...model[msg.problemId],
      chosen: msg.choiceId,
      checked: msg.choiceId,
      correct,
      complete: correct,
    },
  };
});
```

Only one message. There is no "check" — selecting IS checking. Kernel's completion diff sees `complete: false → true` on a correct pick and calls `propagateCorrectness(problemId)`.

## 5. Interactions

At mount, the component:

1. Reads all `.choice` children of the `.word-choice`.
2. Prepends a `<select class="ximera-word-select">` with a blank first option (`—`) and one `<option value="choiceId">text</option>` per choice.
3. Hides the original `.choice` spans (`style.display = "none"`) — they remain in the DOM as the read-only answer key (D9).
4. Wires a `change` event on the select that dispatches `SELECT`.

| User action | Dispatched | Resulting entry | Result on DOM |
|---|---|---|---|
| Select an incorrect option | `SELECT { problemId, choiceId }` | `{ chosen, checked, correct: false, complete: false }` | `data-state="attempted"`; select stays enabled; parent problem does not complete |
| Select the correct option | `SELECT { problemId, choiceId }` | `{ chosen, checked, correct: true, complete: true }` | `data-state="correct"`; select disabled; kernel propagates: problem's `data-state="available complete"` |
| Change from an incorrect to another incorrect | `SELECT { problemId, choiceId }` | `{ chosen: newId, checked: newId, correct: false, complete: false }` | `data-state="attempted"`; select remains enabled |
| Change from correct back to another option | (impossible — select is disabled) | — | — |

## 6. Completion

Component sets `complete: true` **iff** `correct: true`. Kernel observes the transition and calls `propagateCorrectness`; the parent `.problem-environment` becomes `complete: true` if this is its only direct answerable, or when its other direct answerables are also complete.

## 7. Rendering

Register a render for `.word-choice`:

```js
registerRender('.word-choice', (el, entry) => {
  const parts = [];
  if (entry.correct) parts.push('correct');
  else if (entry.checked != null) parts.push('attempted');
  el.dataset.state = parts.join(' ');

  const select = el.querySelector('select.ximera-word-select');
  if (select) {
    if (entry.chosen !== undefined && select.value !== entry.chosen) {
      select.value = entry.chosen;
    }
    select.disabled = !!entry.correct;
  }
});
```

The focus guard from CONTRACT §8 rule 4 is not needed for `<select>` (no caret), but the value-inequality check avoids spurious change events.

## 8. Chrome and accessibility

- The generated `<select>` gets `aria-label="answer"` (lifted verbatim from legacy `math-answer` templates for consistency across answerables).
- Marker class: `ximera-word-select` (D7 idempotence — check `if (!el.querySelector('.ximera-word-select'))` before creating).
- Original `.choice` spans keep their ids and `.correct` classes but get `display: none` — they are the answer-key, not visible chrome.
- No auto-focus on restore (CONTRACT §12 rule 4).

## 9. Simplifications vs. legacy

- **No submit button.** Legacy word-choice had a check button after the dropdown; new design uses immediate feedback on `change`. Rationale: the whole point of word-choice is inline flow, and a submit button breaks reading flow. This matches current `ximera-core` behavior.
- **No "try again" state class.** Incorrect selections stay in `data-state="attempted"`; re-selecting simply overwrites `chosen`. Legacy `btn-ximera-incorrect` / `btn-danger` visual states are collapsed into `data-state="attempted"` and delegated to CSS.
- **No `ximera:answer-needed` emit.** Answerability is declared at `register()` time via `{ answerable: true }` (D2), not by bubbled event.

## 10. Examples (become conformance tests)

Given a fixture:

```html
<div class="problem-environment" id="problem-1" role="article">
  What is the capital of Ohio?
  <span class="word-choice" id="wc-1">
    <span class="choice" id="c-a">Cleveland</span>
    <span class="choice correct" id="c-b">Columbus</span>
    <span class="choice" id="c-c">Cincinnati</span>
  </span>
</div>
```

| # | Action | Assert |
|---|---|---|
| 1 | Bootstrap with empty pageState | `problem-1` entry: `{ available: true, complete: false }`; `wc-1` entry undefined; a `<select>` was created inside `.word-choice` with a `—` blank option and three choice options |
| 2 | Simulate select of `c-a` | `wc-1` entry: `{ chosen: "c-a", checked: "c-a", correct: false, complete: false }`; `wc-1[data-state="attempted"]`; `problem-1.complete === false`; select is enabled |
| 3 | Simulate select of `c-b` | `wc-1` entry: `{ chosen: "c-b", checked: "c-b", correct: true, complete: true }`; `wc-1[data-state="correct"]`; select disabled; `problem-1[data-state="available complete"]`; `agent.setProgress(1.0)` was called |
| 4 | Persistence round-trip | After JSON round-trip and re-bootstrap, DOM state matches state 3 exactly |
| 5 | Dispatch `RESET_WORK` from state 3 | Model cleared; DOM back to state 1; `agent.setProgress(0)` called (does not lower LTI grade — CONTRACT §11) |
| 6 | Bootstrap with `pageState: { "wc-1": { chosen: "c-b", checked: "c-b", correct: true, complete: true } }` | State 3 DOM without any user interaction; `problem-1.complete === true` after `PAGE_STATE_RESTORED` propagates |
| 7 | Restore-replay: render twice | DOM byte-identical (CONTRACT §14.4) |
| 8 | Forward-tolerance: bootstrap with `pageState: { "wc-1": { chosen: "c-b", checked: "c-b", correct: true, complete: true, futureKey: 42 } }` | `futureKey` preserved in model; component ignores it (CONTRACT §7 rule 5) |
