# ximera-free-response

**Status:** Phase 0 draft. Consumed by Phase 3.
**Legacy source:** `original-server/free-response.js` (85 loc).
**Answerable:** yes, but **completion is set on submission, not correctness** — see §6.

## 1. Purpose

An ungraded free-form text response. The learner types prose (Markdown-flavored in the legacy client; plain text in this pilot — see §9), then Submits. Submitting counts as completion; no correctness evaluation happens client-side. Unblocks subsequent nested problems just like a correct graded answer would. First component in the plan that uses `registerRender` for something beyond `data-state` and native-value sync.

## 2. DOM at mount

Emitted by `ximera.4ht`'s `freeResponse` environment:

```html
<div class="free-response" id="problemN"
     titletext=" Free Response">
  …prompt / model-solution markup…
</div>
```

The compiled body may contain author-written prose describing the prompt or a model solution. The mount function appends a `<textarea>` and Submit button as chrome — it does not read or modify the prose. Mount `register` selector: `'.free-response'`, `{ answerable: true }`.

## 3. State

| Key | Type | Owner | Meaning |
|---|---|---|---|
| `response` | `string` | ximera-fr | Current textarea content. Persisted on every keystroke (rate-limited by the natural batching of `agent.setPageState`). |
| `submitted` | `boolean` | ximera-fr | Set to `true` on Submit. Monotonic (survives further edits). |
| `complete` | `boolean` | ximera-fr | `=== submitted`. Any submission satisfies completion. |

Legacy mapping: `response` → `response`. `submitted` and `complete` are additions; the legacy client used TinCan/xAPI to report submission (xAPI is dropped, so we track it locally).

## 4. Messages

```
{ type: 'ximera-free-response:INPUT', id: string, value: string }
{ type: 'ximera-free-response:SUBMIT', id: string }
```

Reducer summary:

- `INPUT`: sets `response = value`. Does not affect `submitted`/`complete`. Continues to fire after submission (the learner may edit their response; the completion flag stays true).
- `SUBMIT`: if `entry.response` is empty (whitespace-only counts as empty), no-op. Otherwise sets `submitted: true, complete: true`.

## 5. Interactions

Mount steps:

1. Append a `<textarea class="ximera-free-response-input" aria-label="response" rows="5">` (marker: `ximera-free-response-input`).
2. Append a `<button class="ximera-submit-btn" type="button">Submit</button>` (marker: `ximera-submit-btn`).
3. Wire `input`/`change` on the textarea → dispatch `INPUT` with `.value`.
4. Wire `click` on the button → dispatch `SUBMIT`.

| User action | Dispatched | Resulting entry | DOM |
|---|---|---|---|
| Type "hello" | 5 × `INPUT` (one per keystroke, coalesced by agent throttling) | `response: "hello"` | textarea.value == "hello"; button enabled |
| Click Submit (response non-empty) | `SUBMIT { id }` | `submitted: true, complete: true` | `data-state="submitted"`; button `disabled` and textContent "Submitted"; kernel propagates: parent problem becomes complete |
| Type more after submission | `INPUT` | `response: <new>` | Value updates; `submitted` still `true` |
| Click Submit with empty response | `SUBMIT` no-op | No change | No change |

## 6. Completion

**Any submission of a non-empty response sets `complete: true`.** This is the "submitted ≠ correct" rule PLAN.md §4 calls out. Rationale: free-response is ungraded on the client; the completion contract is about *unblocking downstream problems*, not correctness. An instructor may grade the response externally via Modulus; that grade never re-enters this component.

Consequence for progress: a submitted free-response contributes `complete: true` to its parent problem-environment just like a correct graded answer would. `agent.setProgress` reflects this — free-response counts fully.

## 7. Rendering

Component-owned render (kernel handles the `.problem-environment` `data-state`):

```js
registerRender('.free-response', (el, entry) => {
  el.dataset.state = entry.submitted ? 'submitted' : '';

  const ta = el.querySelector('textarea.ximera-free-response-input');
  if (ta) {
    if (document.activeElement !== ta && entry.response !== undefined && ta.value !== entry.response) {
      ta.value = entry.response;
    }
    // Textarea remains editable post-submit (allows revisions; submission stays flagged).
  }

  const btn = el.querySelector('.ximera-submit-btn');
  if (btn) {
    btn.disabled = !!entry.submitted;
    btn.textContent = entry.submitted ? 'Submitted' : 'Submit';
  }
});
```

Focus guard per CONTRACT §8 rule 4 — this is where the guard actually matters (learner is typing when a `pagestate-changed` push arrives). Without it, caret jumps to end of value on every remote update.

## 8. Chrome and accessibility

Verbatim from legacy:

- Textarea: `aria-label="response"` (matches the answer-input labeling used by `ximera-answer`).
- Button: `type="button"`, `aria-label="submit response"`.
- No auto-focus on restore or on submit.
- The textarea is not focused on mount either — the learner arrives from prose above and shouldn't be yanked into the input.

## 9. Simplifications vs. legacy

- **No Markdown preview.** Legacy used `pagedown-editor` / `pagedown-sanitizer` for a live Markdown preview pane and a toolbar. Dropped for the pilot: plain textarea, plain text. Preview + toolbar can return as a private component-internal renderer (P5) without contract change.
- **No "View model solution" toggle.** Legacy had a button to reveal an authored solution (via `ng-show="db.viewSolution"`). Dropped; can return later as a `data-model-solution` DOM contract if useful.
- **No `TinCan.submitted` emit.** xAPI is dropped entirely (PLAN.md §2). Submission is purely local state.

## 10. Examples (become conformance tests)

Given a fixture:

```html
<div class="problem-environment" id="p-1" role="article">
  <div class="free-response" id="fr-1">Write two sentences about foo.</div>
</div>
```

| # | Action | Assert |
|---|---|---|
| 1 | Bootstrap fresh | textarea + submit button appended once each (marker-class idempotent); `fr-1` entry undefined; `p-1.complete === false` |
| 2 | Type "hello world" | `fr-1.response === "hello world"`; button says "Submit"; not disabled |
| 3 | Click Submit | `fr-1: { response: "hello world", submitted: true, complete: true }`; button "Submitted", disabled; `p-1.complete === true`; `agent.setProgress(1.0)` |
| 4 | Type " more" (continue editing after submit) | `fr-1.response === "hello world more"`; `submitted` still `true`; `complete` still `true` |
| 5 | Click Submit with empty textarea (fresh) | `SUBMIT` reducer returns same reference (no-op); `submitted` stays `false` |
| 6 | Click Submit with whitespace-only textarea | Same as 5 — no-op |
| 7 | Persistence round-trip from state 3 | DOM restored exactly; button "Submitted", disabled |
| 8 | Focus guard: focus textarea, then dispatch `PAGE_STATE_RESTORED` with `response: "server-value"` | textarea.value **not** changed while focused; on next re-render after blur, syncs |
| 9 | Reset from state 3 | Entry cleared; textarea empty; button "Submit", enabled; `p-1.complete === false` |
| 10 | Restore-replay | Render twice, DOM byte-identical |
