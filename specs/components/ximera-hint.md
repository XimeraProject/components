# ximera-hint

**Status:** Phase 0 draft. Consumed by Phase 2 (pilot #1).
**Legacy sources:** `original-server/hint.js` (60 loc), `original-server/problem.js` (hint-registration block).
**Answerable:** no. Hints never contribute to problem completion.

## 1. Purpose

Turn each `\begin{hint}…\end{hint}` in the compiled HTML into a click-to-reveal accordion. Once revealed, the hint stays revealed across reloads. Non-answerable: revealing a hint MUST NOT set any answerable's `complete`.

## 2. DOM at mount

Emitted by `ximera.4ht`'s `expandable` environment with class `xmhint`:

```html
<div class="accordion">
  <h3 class="xmhint"></h3>
  <div class="accordion-item xmhint-content" id="accordion-itemN">
    …hint body…
  </div>
</div>
```

The outer `.accordion` has no id. **The entry key is the content div's id** (`accordion-itemN`). If the content div has no id at mount (defensive — tex4ht should always assign one), the mount function MUST synthesize one (`ximera-hint-<counter>`) so the entry can be keyed.

**Note — the h3 is emitted empty.** `\RenewEnviron{hint}{\begin{expandable}{xmhint}{}…}` in `ximera.4ht` passes `{}` as the visible label, so tex4ht outputs `<h3 class="xmhint"></h3>` with no text content. The mount function is responsible for injecting the visible label (see §8). Confirmed against Phase 0 fixture output (`specs/fixtures/dist/ximera-hint.html`).

Mount `register` selector: `'h3.xmhint'`. The mount function walks to `nextElementSibling` (the `.xmhint-content`) to find the content div.

## 3. State

| Key | Type | Owner | Meaning |
|---|---|---|---|
| `revealed` | `boolean` | ximera-hint | Whether the learner has revealed this hint. Persisted. |

Legacy `persistentData` mapping:

| Legacy key | New key | Notes |
|---|---|---|
| `available` (on hint) | `revealed` | Renamed. Old name overloaded with problem-availability. |
| `collapsed` | *(dropped)* | Collapse-after-reveal toggle removed per §9. |
| `uncovered-all-hints` (on problem) | *(dropped)* | No per-problem reveal button, no counter. |

## 4. Messages

```
{ type: 'ximera-hint:REVEAL', id: string }
```

Reducer:

```js
registerReducer('ximera-hint:REVEAL', (model, msg) => ({
  ...model,
  [msg.id]: { ...model[msg.id], revealed: true },
}));
```

No other messages. `revealed: true` is monotonic — hints never un-reveal. `RESET_WORK` (core-owned) clears the entry as usual.

## 5. Interactions

| User action | Dispatched | Resulting entry | Result on DOM |
|---|---|---|---|
| Click `h3.xmhint` (or Enter/Space with focus on it) | `ximera-hint:REVEAL { id }` | `{ revealed: true }` | `.xmhint-content[data-state="visible"]`; `h3[aria-expanded="true"]` |

Clicking a hint that is already revealed is a no-op (reducer returns same reference for the entry, so render is skipped).

## 6. Completion

N/A — non-answerable. `getDirectAnswerables` never returns a hint id.

## 7. Rendering

Register a render for `.xmhint-content`:

```js
registerRender('.xmhint-content', (el, entry) => {
  el.dataset.state = entry.revealed ? 'visible' : 'hidden';
  const header = el.previousElementSibling;
  if (header?.classList.contains('xmhint')) {
    header.setAttribute('aria-expanded', entry.revealed ? 'true' : 'false');
  }
});
```

Visuals owned by CSS: `.xmhint-content[data-state="hidden"] { display: none; }` (or `max-height: 0` + transition for animation). The component ships its own CSS via the `"latex".css` field.

## 8. Chrome and accessibility

Attributes set once at mount (idempotent — check before setting):

- `h3.xmhint` gets `role="button"`, `tabindex="0"`, `aria-expanded="false"` (initial). Marker: the `role="button"` attribute itself is the guard.
- `h3.xmhint` gets its visible text set to `"Hint"` (via `textContent`), because `ximera.4ht` emits it empty (§2). Marker: `h3.textContent.trim() !== ''`, so re-mount does not double-fill. When i18n is added later, the label is looked up from the same translation table that produced `titletext`.
- `.xmhint-content` gets `role="region"` and `aria-labelledby="<h3-id>"`. The h3 gets a synthesized id if it lacks one (marker: presence of the id).

Keyboard: Enter and Space on the h3 dispatch `REVEAL`. Focus MUST NOT be moved to the revealed content — the learner is at the trigger.

Announce: on first reveal, `.xmhint-content` becomes visible in the flow; screen readers pick up the region. No `aria-live` is needed because the reveal is a direct response to a click.

## 9. Simplifications vs. legacy

Documented drops (per PLAN.md §2 product decisions):

- **30-second countdown lock** on hint reveal — dropped entirely. No timer, no `.seconds-remaining`, no `fa-lock`/`fa-unlock` icon swap.
- **"1 of N" counter** on the reveal button — dropped. No per-problem cycling button.
- **Collapse-after-reveal** — the legacy allowed toggling a revealed hint closed again via `persistentData('collapsed', …)`. Dropped: once revealed, stays revealed. Reduces state, avoids the "did I collapse it or forget it?" ambiguity.
- **Per-problem reveal button** — legacy `problem.js` prepended a single "Reveal Hint" button on the parent problem that walked hints in doc order. Dropped in favor of per-hint click. Consequence: reveal order is not enforced by the runtime — the learner may click hint 2 before hint 1. This is deemed acceptable for the pilot.

If ordered-reveal turns out to be pedagogically important, it can be re-added in a later minor version by having the render project a `data-state="locked"` on hints whose predecessors are unrevealed — a strict UI addition, no contract change.

## 10. Examples (become conformance tests)

Given a fixture with three hints:

```html
<div class="accordion">
  <h3 class="xmhint">Hint</h3>
  <div class="accordion-item xmhint-content" id="hint-1">First hint.</div>
</div>
<div class="accordion">
  <h3 class="xmhint">Hint</h3>
  <div class="accordion-item xmhint-content" id="hint-2">Second hint.</div>
</div>
<div class="accordion">
  <h3 class="xmhint">Hint</h3>
  <div class="accordion-item xmhint-content" id="hint-3">Third hint.</div>
</div>
```

| # | Action | Assert |
|---|---|---|
| 1 | Bootstrap kernel with empty pageState | `hint-1/2/3` all have `data-state="hidden"`; `aria-expanded="false"` on all h3s |
| 2 | Click first h3 | `model["hint-1"].revealed === true`; DOM: `hint-1[data-state="visible"]`; other hints still hidden; kernel called `agent.setPageState({ "hint-1": { revealed: true } })` |
| 3 | Click first h3 again | Model unchanged; no re-render (reducer returned same ref); no new agent call |
| 4 | Click third h3 (before second) | `model["hint-3"].revealed === true`; `hint-2` still hidden; no enforcement of doc order |
| 5 | Bootstrap fresh kernel with `pageState: { "hint-3": { revealed: true } }` | `hint-3[data-state="visible"]` immediately; `hint-1`, `hint-2` hidden |
| 6 | Dispatch `RESET_WORK` | `model === {}` (after initializeAvailability re-populates any problem-envs, none apply here); all hints hidden |
| 7 | Render twice on the same model | DOM byte-identical after each render (restore-replay idempotence, CONTRACT §14.4) |
