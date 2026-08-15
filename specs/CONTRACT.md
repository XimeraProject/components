# CONTRACT.md

**Status:** Phase 0 draft. Frozen at the end of Phase 2 per PLAN.md §5 (contract-freeze gate). Any change to a documented surface after freeze is semver-major.

**Scope:** The contract between `ximera-core` (the kernel) and every `ximera-*` component package. This is what a component author writes against and what the kernel promises in return. Product motivation lives in `ARCHITECTURE.md` and `PLAN.md`; this document is normative.

**How to read this:** every rule below is either **MUST**, **MUST NOT**, **SHOULD**, or **MAY** in the usual RFC 2119 sense. Verified by the conformance kit (§14). If the spec disagrees with `ximera-core` after Phase 2, the spec wins and core is a bug.

---

## 1. Principles

Verbatim from PLAN.md §1, restated here so this document is self-contained.

**P1 — Decorate, don't render.** The DOM tex4ht produced at build time is authoritative. The runtime never creates content DOM; "render" is a pure projection — `model entry → data-state attributes + native form-value sync` — and CSS owns all visuals. Kernel has no vdom and no DOM library. Kernel dependencies: `@modulus-learning/agent` and nothing else.

**P2 — The problem-environment is kernel, not component.** Availability, `data-blocking`, uncovering, correctness propagation up the tree, and progress roll-up live in core. No `ximera-problem` package.

**P3 — One store, one dispatch.** Components never talk to each other. The MVU loop is the communication framework.

**P4 — The flat model is the contract.** `{ domId → entry }`, JSON-serializable, persisted as-is. Only shared vocabulary: the problem-environment triple `{available, complete, experienced}` and the answerable completion flag `complete: true`. Every other key is private to its owning component.

**P5 — Components may bring their own tools, privately.** A component MAY bundle a micro-renderer (lit-html, `<template>` cloning) inside its own mount/render. Core never knows.

---

## 2. The public API

```ts
// ximera-core exports (frozen at end of Phase 2)

export function register(
  selector: string,
  mount: (el: Element, dispatch: Dispatch) => void,
  opts?: { answerable?: boolean }
): void;

export function registerReducer(
  type: string,                              // MUST be namespaced: "package:MESSAGE"
  reducer: (model: Model, msg: Message) => Model
): void;

export function registerRender(
  selector: string,
  render: (el: Element, entry: Entry, model: Readonly<Model>) => void
): void;

export function dispatch(msg: Message): void;

export type Model = { [domId: string]: Entry };
export type Entry = Record<string, unknown>;           // JSON-serializable
export type Message = { type: string; [key: string]: unknown };
export type Dispatch = (msg: Message) => void;
```

No other symbols are exported. Components MUST NOT import from anywhere except the package's public entry point (enforced by conformance: §14).

---

## 3. The dispatch loop

Every state change — user interaction, restore, reset — flows through this loop:

```
mount(el, dispatch)           component's DOM event fires
      │
      ▼
dispatch(msg)                 the ONLY way to change state
      │
      ▼
registered reducer(model, msg) → newModel     (pure, per-message-type)
      │
      ▼
kernel completion diff        for each answerable entry that flipped
                              complete:false → complete:true,
                              call propagateCorrectness(problemId)
      │
      ▼
render projection             core sets data-state on problem-environments,
                              syncs form values with focus-guard,
                              runs matching registerRender plugins
      │
      ▼
persist                       agent.setPageState(model);
                              agent.setProgress(calculateProgress(model))
```

Server pushes (`pagestate-changed`) re-enter via `PAGE_STATE_RESTORED` and replay the same path. Reset re-enters via `RESET_WORK`. There is no second control flow.

---

## 4. Core-owned messages

Core owns exactly three message types. Every other type MUST be namespaced (§7).

### `PAGE_STATE_RESTORED`

```ts
{ type: 'PAGE_STATE_RESTORED', pageState: Model }
```

**When:** on `agent.onReady` if `agent.pageState()` returned a non-empty object; also on every `pagestate-changed` event from the agent.

**Reducer behavior (core):**
1. Merge `pageState` into the current model (identity restore per D6).
2. Run `initializeAvailability` (§9) so any newly-mounted problem-environments get their `available`/`complete` defaults.
3. `experienced` MAY be set on any environment whose `available: true` is now observed for the first time.

Component reducers MAY also register for this type to normalize their own restored entries (forward-tolerant restore per §12).

### `AGENT_READY_OFFLINE`

```ts
{ type: 'AGENT_READY_OFFLINE' }
```

**When:** `agent.onReady` fires but `agent.pageState()` is empty. Fresh visit.

**Reducer behavior (core):** start with `{}`, run `initializeAvailability`.

### `RESET_WORK`

```ts
{ type: 'RESET_WORK' }
```

**When:** learner confirms the reset control (§13).

**Reducer behavior (core):** clear all entries, re-run `initializeAvailability`. Persist. The subsequent `setProgress(0)` call MUST NOT lower the LTI grade (high-water mark on the Modulus side, §11). Components MAY register for this type to release local, non-model resources (e.g. cancel a pending fetch) but MUST NOT write to the DOM directly — the resulting render will project the cleared state.

---

## 5. The model

**Shape.** A flat map keyed by DOM `id`:

```js
{
  "problem-1":  { available: true,  complete: false, experienced: true },
  "hint-3":     { revealed: true },
  "answer-4":   { response: "17", attempt: "17", correct: true, complete: true },
  "mc-5":       { chosen: "choice-b", checked: "choice-b",
                  correct: true, complete: true, seed: 7413 },
  ...
}
```

**Rules:**

1. Every entry MUST be JSON-serializable. No functions, DOM nodes, Sets, Maps, Dates, or class instances. Arrays and plain objects only.
2. Every top-level key MUST be a real DOM `id` present in the page at mount time.
3. `modelFromPageState` and `modelToPageState` are the identity function. Persistence is by-value; the model is exactly what the server sees (D6).
4. Reducers MUST return a new object for changed entries (immutability); unchanged entries MAY be the same reference. Render skips entries by reference-inequality.

**Shared vocabulary (the only cross-component contract):**

| Key | Owner | Value | Meaning |
|---|---|---|---|
| `available` | kernel (on problem-environments) | `boolean` | Uncovered / revealed. See §9. |
| `complete` | kernel (on problem-environments); component (on answerables) | `boolean` | Environment satisfied / answerable done. Trigger for propagation (§9). |
| `experienced` | kernel (on problem-environments) | `boolean` | Set to `true` the first time an environment becomes visible. Persisted; never reset except by `RESET_WORK`. |

**Every other key is private** to the component that owns the DOM element. Components MUST NOT read or write keys they don't own on entries they don't own. Kernel MAY read `complete` on any answerable entry (that's how §9 works).

---

## 6. Registering a component

```js
import { register } from 'ximera-core';

register('.word-choice', (el, dispatch) => {
  // el is one matched element; called once per element on the page.
  // Attach event listeners; add control chrome idempotently (§13);
  // dispatch namespaced messages on user interaction.
}, { answerable: true });
```

**Rules:**

1. `register(selector, mount, opts)` is idempotent per element. Kernel guarantees `mount(el, dispatch)` is called exactly once per matching element per page load.
2. `selector` MUST be a valid CSS selector matching only the component's own DOM shape (emitted by its `.sty` / `.4ht`).
3. `opts.answerable: true` adds `selector` to the answerable registry (D2). Kernel's `getDirectAnswerables(problemEl)` then treats matching elements as answerable children of a problem-environment for completion propagation (§9).
4. `mount` runs **after** the Modulus agent is ready and the initial `PAGE_STATE_RESTORED`/`AGENT_READY_OFFLINE` has been reduced. Persisted state is already in the model when `mount` runs.
5. `mount` MUST NOT create content DOM. It MAY create control chrome (buttons, popovers) subject to §13.
6. `mount` MUST NOT read learner state from the DOM. It reads authored configuration only (§10).
7. `mount` MAY read the current entry via `document.getElementById(el.id)` and kernel-provided helpers, but SHOULD rely on `registerRender` for state-driven UI updates.

---

## 7. Registering a reducer

```js
registerReducer('ximera-word-choice:SELECT', (model, msg) => {
  const el = document.getElementById(msg.problemId);
  const chosen = document.getElementById(msg.choiceId);
  const correct = chosen?.classList.contains('correct') ?? false;
  return {
    ...model,
    [msg.problemId]: {
      ...model[msg.problemId],
      chosen: msg.choiceId,
      checked: msg.choiceId,
      correct,
      complete: correct,     // triggers propagation on transition
    },
  };
});
```

**Rules:**

1. `type` MUST be namespaced: `"<package>:MESSAGE"`. The kernel emits a dev-mode warning for unnamespaced or colliding types.
2. Reducer MUST be pure: same input → same output, no I/O, no timers, no `dispatch` calls, no DOM writes.
3. Reducer MAY read the DOM for authored configuration (e.g. which `.choice` has class `correct`). It MUST NOT read learner state from the DOM — that comes from `model` (§10 guardrail 1).
4. Reducer MUST return a new object for changed entries. Unchanged entries MAY be the same reference.
5. Reducer MUST be forward-tolerant on restore: if the persisted entry has unknown keys, keep them; if expected keys are missing, default them; never rename a persisted key without a shim (D6).
6. Exactly one reducer per `type`. Duplicate registration is a startup error.

**Kernel completion diff (D1).** After every reduce, kernel iterates every answerable entry present in both `oldModel` and `newModel` and checks for a `complete: false → true` transition. For each transition, kernel calls `propagateCorrectness(newModel, findParentProblemId(id))` (§9). Components MUST NOT call `propagateCorrectness`.

---

## 8. Registering a renderer

```js
registerRender('.word-choice', (el, entry, model) => {
  const parts = [];
  if (entry.correct) parts.push('correct');
  else if (entry.checked != null) parts.push('attempted');
  el.dataset.state = parts.join(' ');

  const select = el.querySelector('select.ximera-word-select');
  if (select) {
    if (entry.chosen !== undefined) select.value = entry.chosen;
    select.disabled = !!entry.correct;
  }
});
```

**Rules:**

1. Render MUST be a pure projection of `entry` (and read-only `model` for cross-entry lookups). No dispatch, no side effects other than DOM writes to `el` and its descendants.
2. Render MUST be idempotent: running twice produces the same DOM as running once. Enforced by the restore-replay conformance test (§14).
3. Render MUST NOT rely on prior DOM state. `el.dataset.state = "…"` is a full replacement; incremental class add/remove is fine only when derivable from `entry` alone.
4. Render SHOULD sync native form values with a focus guard:
   ```js
   if (document.activeElement !== input && input.value !== entry.response) {
     input.value = entry.response ?? '';
   }
   ```
   This prevents caret jumping while the learner types (kernel does the same for its own form syncs).
5. Kernel runs the built-in projection first (problem-environment `data-state`, feedback `data-state`), then component renders in registration order for elements matching each selector.
6. Kernel skips render for an entry when the `oldModel[id] === newModel[id]` (reference equality). Reducers get this "for free" by returning the same reference for unchanged entries.

---

## 9. Answerables, availability, propagation

These behaviors are **kernel-owned** (P2). Components do not implement them; components only opt into being answerable.

### Answerable registry (D2)

An element is *answerable* if its DOM matches any selector registered with `{ answerable: true }`. Kernel maintains this as the union of all such selectors — call it `answerableSelector`. Legacy `ximera:answer-needed` bubbled events do not exist in the new runtime.

### `getDirectAnswerables(problemEl)` (kernel-internal)

Returns the ids of elements that:
- Match `answerableSelector`, AND
- Are descendants of `problemEl`, AND
- Have **no intervening `.problem-environment`** between themselves and `problemEl`.

"Direct" scoping is what makes nested problems compose: a nested problem's answerables count toward that inner problem, not the outer one.

### `initializeAvailability(model)` (kernel-internal)

Runs on `PAGE_STATE_RESTORED` and `AGENT_READY_OFFLINE`. For every `.problem-environment[id]`:

- If the environment is top-level (no ancestor `.problem-environment`) → `available: true`.
- Else if the environment lacks `data-blocking` → `available: true`.
- Else (nested + blocking) → `available: false` unless it already had `available: true` in the restored model.

`data-blocking` is authored (or set by postprocess for older content). In the new design `data-blocking` is **computed at runtime** from the answerable registry (D3): an environment is blocking iff it directly contains an answerable. The attribute stays as an author override for edge cases.

### `propagateCorrectness(model, problemId)` (kernel-internal)

Called by the kernel's completion diff (§7). Given a problem-environment id:

1. Compute `answerables = getDirectAnswerables(problemEl)`. If empty, return.
2. If **every** answerable has `entry.complete === true`, mark the problem `complete: true`.
3. When the problem transitions to `complete: true`:
   - Any direct-child `.problem-environment[data-blocking]` becomes `available: true`. This is the "uncovering" behavior.
   - Any direct-child `.feedback[data-feedback="correct"]` becomes visible (§12 or `ximera-feedback` spec).
   - Recurse to the parent problem-environment.

Components never observe this recursion; they see it only as their own state, or as changes to problem-environment `data-state` values.

### `experienced` (product decision)

Kernel sets `experienced: true` on a problem-environment the first time it observes `available: true` for that environment. Once set, `experienced` persists through everything except `RESET_WORK`. `xAPI` emission is dropped; the flag stays because it is part of the environment triple.

---

## 10. Two DOM guardrails (D9, normative)

**Guardrail 1 — The DOM is read-only configuration.**

- Authored intent MAY be read from the DOM: `.choice.correct`, `data-format="integer"`, `data-tolerance="0.01"`, `data-feedback="attempt"`, `<span class="answer respondable" data-correct-text="…">`.
- Learner state MUST NOT live in classes/attributes that logic reads back. `chosen`, `response`, `correct`, `revealed`, `seed`, etc. live in the model. `data-state` values written by render are one-way (kernel/component → CSS); no logic re-parses them.
- Consequence: a stray DOM edit or MathJax rerender cannot corrupt learner state.

**Guardrail 2 — Renders are pure projections.**

- A render function MUST produce the same DOM every time it runs for the same `(entry, model)`. Marker-class-guarded chrome creation (§13) is the only exception, and MUST use `if (!el.querySelector('.marker')) createIt();`.
- Enforced mechanically by `restoreReplay` in the conformance kit (§14): render twice, assert deep-equal DOM.

---

## 11. Persistence

**Round-trip.** `modelToPageState = model → model` (identity). `modelFromPageState = pageState → pageState` (identity). The kernel calls `agent.setPageState(model)` after every dispatch that changes the model.

**Progress.** After every model change, kernel calls `agent.setProgress(score)` where `score = calculateProgress(model) ∈ [0, 1]`. `calculateProgress` is a recursive average of `complete` over the problem-environment tree.

**Reset never lowers the LTI grade.** `agent.setProgress` on the Modulus side is a high-water mark. `RESET_WORK` clears the model → `setProgress(0)` — but the server's stored progress does not decrease. The learner-facing confirmation dialog states this.

**Forward tolerance (D6).**

- On `PAGE_STATE_RESTORED`, a reducer receives entries whose keys reflect whatever version of the component wrote them. Reducers MUST NOT crash on unknown keys and MUST NOT silently drop them.
- Renames are a semver-major operation and MUST ship a migration shim in the reducer that reads the old key and writes the new key on the first restore.

**No legacy migration.** The old-server persistent-data format never enters Modulus. v1's first release is the starting point of the compatibility promise; it runs forward only.

---

## 12. Chrome and accessibility (D7)

The compiled HTML has content DOM. Components add *control chrome* — Check buttons, dropdowns, hint toggles, popovers, badges — during `mount`. Rules:

1. **Marker-class idempotence.** Every created element MUST carry a marker class (e.g. `ximera-check-btn`). Before creating, check `if (!el.querySelector('.ximera-check-btn'))`. This makes re-mounts and restores safe.
2. **Aria affordances verbatim.** Every component spec MUST record its `aria-label`, `role`, `aria-checked`, `aria-expanded`, `aria-live` attributes as lifted from the legacy templates. Component authors copy them; conformance tests assert their presence.
3. **`aria-live` regions.** Correct/incorrect announcements go through an `aria-live="assertive"` region attached to the problem's chrome, as the legacy does.
4. **Focus not stolen.** Auto-focus MUST NOT happen on `PAGE_STATE_RESTORED` or `AGENT_READY_OFFLINE` — the learner scrolled, don't yank them back.
5. **Keyboard.** Anything clickable MUST be Enter/Space activatable. `role="button"` + `tabindex="0"` for anchor-like activators; native `<button>` preferred where the layout allows it.

---

## 13. The reset control (kernel-owned)

- Kernel mounts a Reset button after `initializeAvailability` finishes, into `#ximera-page-controls`. If the mount point doesn't exist, kernel creates it as a sibling of the first `.problem-environment`.
- Marker class: `ximera-reset-btn` (§12 rule 1).
- Click behavior: show a confirmation dialog stating "This clears your work on this page. Your grade cannot go down — resetting starts fresh but doesn't lower a score you've already earned."
- On confirm: `dispatch({ type: 'RESET_WORK' })`.
- Reset MUST behave identically to a first visit for every downstream test (§14).

---

## 14. Conformance

Every `ximera-*` package in the v1 roster MUST pass the conformance kit before its Phase-of-introduction is called done. The kit ships from `ximera-core` in Phase 1 and grows through Phases 2–4.

### 14.1 Mount

- Given the component's Phase 0 fixture HTML compiled through tex4npm, calling `import 'the-package'` (which triggers its `register(...)` at module load) and then bootstrapping core MUST result in every matched element having received `mount` exactly once.
- Test uses **public API only**. No imports from `ximera-core/*` internals.

### 14.2 Dispatch → completion → propagation

For each answerable component:
- Simulate the user interaction sequence that legacy behavior calls "correct".
- Assert the component's entry has `complete: true`.
- Assert the containing problem-environment's entry has `complete: true`.
- Assert every ancestor problem-environment up to the top has `complete: true` if this was its only answerable.

### 14.3 Persistence round-trip

- Take the model after 14.2.
- `restored = JSON.parse(JSON.stringify(model))`.
- Bootstrap a fresh kernel with `agent.pageState()` returning `restored`.
- Assert `model === restored` (structurally) after `PAGE_STATE_RESTORED` reduces.

### 14.4 Restore-replay idempotence

- Run `render(model)` twice.
- Assert the DOM subtree under every component root is deep-equal after each run (`outerHTML` compare after normalizing whitespace).

### 14.5 Reset then restore = first visit

- Start from a completed state; dispatch `RESET_WORK`.
- Assert the resulting model matches a first-visit `AGENT_READY_OFFLINE` model.
- Assert `setProgress` was called with `0`.
- Assert the DOM matches a first-visit render.

### 14.6 No internal imports

- Static analysis: the package's built bundle imports only `ximera-core` (public entry) and any peer dependencies declared in `peerDependencies`. No `ximera-core/model.js` or similar deep imports.

### 14.7 Spec examples

- Every `(input → outcome)` pair listed in the component's spec `### Examples` section is a passing test.

---

## 15. Component package shape

Every `ximera-*` package ships:

```
ximera-<name>/
├── package.json         "latex" field: {"sty": [...], "css": [...],
│                                        "4ht": [...] (Phase 5),
│                                        "postprocess": "./postprocess.js" (Phase 4)}
│                        "peerDependencies": { "ximera-core": "^1.0.0" }
├── <name>.sty           LaTeX-side rendering; \ifdefined\HCode branch emits
│                        the DOM the mount function expects
├── index.js             calls register(...), registerReducer(...), registerRender(...)
│                        at module load — no side effects beyond that
├── postprocess.js       optional (Phase 4+): cheerio transform for tex4npm's post stage
├── spec.md              symlink or copy of specs/components/ximera-<name>.md
└── test/                spec examples as executable tests; consumes the conformance kit
```

The `"latex"` field is what makes the package participate in the tex4npm build (see `ARCHITECTURE.md` → "The dual LaTeX + JS package convention"). Phase 4 adds `"postprocess"`; Phase 5 adds `"4ht"`.

---

## 16. What is *not* in the contract

- **Content DOM shape** — that's per-component, defined in each spec.
- **CSS** — components ship their own CSS in the `"latex".css` array; visuals are entirely component-owned.
- **Message payload structure** — beyond the `type` string and the namespacing rule, kernel is agnostic.
- **How a component computes correctness** — a component decides, then sets `complete: true`. `ximera-answer` uses `math-expressions` (D8); others read the DOM's `.correct` class.
- **Which components exist** — the v1 roster is in PLAN.md §4; v2+ opens after Phase 6.
- **What the LaTeX macros look like** — that's `ximeraLatex` / per-package `.sty`.

---

## Decision index

Cross-reference of the D-decisions from PLAN.md §2 to the sections that make them normative:

| Decision | Section |
|---|---|
| D1 — Reducer plugins + observed completion | §4, §7 |
| D2 — Answerable registry | §6, §9 |
| D3 — Blocking computed at runtime | §9 |
| D4 — Generic projection + `registerRender` plugins | §8 |
| D5 — tex4npm `"4ht"` + `"postprocess"` fields | §15 (deferred to Phase 4/5) |
| D6 — Identity persistence, forward-tolerant reducers | §5, §11 |
| D7 — Idempotent chrome, aria verbatim | §12 |
| D8 — `math-expressions` equality | out of scope here; owned by `ximera-answer` spec |
| D9 — DOM read-only, renders pure | §10 |
