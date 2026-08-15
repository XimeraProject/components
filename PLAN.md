# Ximera Greenfield Build Plan

The definitive plan for building the new Ximera client runtime and component ecosystem from scratch. The legacy jQuery client (`XimeraProject/server/public/javascripts`, vendored as `original-server/`) is the **behavioral specification and test oracle** — never the codebase. Components are born as npm packages and never live inside core. All previously open product decisions are now resolved (§2).

**What we are building:** author writes LaTeX → `tex4npm` compiles to static HTML and bundles component JS/CSS → in the browser, a small MVU kernel (`ximera-core`) restores state from Modulus, coordinates component packages through a single dispatch loop, and reports page state + progress back for LTI grade passback.

---

## 1. Architecture principles (locked)

**P1 — Decorate, don't render.** The DOM tex4ht produced at build time is authoritative. The runtime never creates content DOM; "render" is a pure projection — `model entry → data-state attributes + native form-value sync` — and CSS owns all visuals. Consequence: **no vdom, no DOM library in the kernel.** There is no changing tree structure to reconcile; MathJax and tex4ht have hands on the DOM, and a vdom that doesn't own the whole tree desyncs (the legacy `visibility:hidden` hack is the scar tissue). Kernel dependencies: `@modulus-learning/agent` and nothing else.

**P2 — The problem-environment is kernel, not component.** Availability, `data-blocking`, uncovering, correctness propagation up the tree, and progress roll-up are the coordination fabric every component plugs into. There is no `ximera-problem` package; legacy `problem.js` + `activity.js` behaviors live in core.

**P3 — One store, one dispatch: the MVU loop is the communication framework.** Components never talk to each other; they communicate through the model:

```
mount(el, dispatch)   component wires DOM events → dispatch(msg)
dispatch(msg)         → registered reducer → new model
kernel diff           answerable flipped complete:true? → propagateCorrectness
render projection     model → data-state → CSS reacts
same tick             agent.setPageState(model); agent.setProgress(score)
```

Server pushes (`pagestate-changed`) re-enter as `PAGE_STATE_RESTORED` and replay through the identical path.

**P4 — The flat model is the contract.** State is `{ domId → entry }`, JSON-serializable, persisted as-is (`modelToPageState` = identity). The only shared vocabulary: problem-environments carry `{available, complete, experienced}`, and answerables must set `complete: true` when done. Every other key (`chosen`, `revealed`, `seed`, …) is private to the component that owns that id.

**P5 — Components may bring their own tools, privately.** A component whose UI is genuinely data-driven (e.g. a future statistics display) may bundle a micro-renderer (lit-html, `<template>` cloning) inside its own mount/render. Core never knows; components pay for what they use.

---

## 2. Design decisions

### Architecture decisions (record in `CONTRACT.md`)

| # | Decision |
|---|---|
| D1 | **Reducer plugins + observed completion.** `registerReducer(type, fn)`; component message types namespaced (`ximera-answer:CHECK`). Core owns exactly three messages: `PAGE_STATE_RESTORED`, `AGENT_READY_OFFLINE`, `RESET_WORK`. Core diffs answerable entries around every reduce; a flip to `complete: true` triggers propagation — components never call it. |
| D2 | **Answerable registry.** `register(selector, mount, { answerable: true })`; `getDirectAnswerables` queries the registered union. (Successor to the legacy's bubbled `ximera:answer-needed` events.) |
| D3 | **Blocking computed at runtime** from the registry at `initializeAvailability`; `data-blocking` attribute kept as author override. Postprocess stops guessing what's answerable. |
| D4 | **Generic projection in core; optional `registerRender(selector, fn)` plugins** — pure, idempotent, no dispatching, read only their own entry. |
| D5 | **tex4npm `latex` field grows `"4ht"`** (per-package tex4ht hooks) **and `"postprocess"`** (cheerio transform module, run in the unthrottled post stage). tex4npm ends with zero component-specific code. |
| D6 | **Persistence is the identity mapping; reducers forward-tolerant** (restore what you recognize, default the rest, never rename persisted keys without a shim). |
| D7 | **Content DOM from the build; control chrome from mounts, idempotently.** Check buttons / badges / toggles created with `createElement` behind a marker-class guard so re-mounts and restores never duplicate. Legacy `aria-label` / `aria-live="assertive"` affordances carried over verbatim. |
| D8 | **Answer comparison = `math-expressions`,** the semantics existing courses were written against (`fromText` → `fromLatex` fallback; formats `integer`/`float`/`string`/expression). Correct answers come from the `\answer{…}` spans postprocess emits — no MathML scraping. Equality/tolerance semantics recorded as fixtures from the legacy client before porting. |
| D9 | **Two guardrails on manual DOM** (normative contract text): (1) the DOM is read-only configuration — the answer key in `.choice.correct` may be read; learner state may never be stored in classes/attributes that logic reads back; (2) render functions are pure projections, safe to run twice — enforced by restore-replay conformance tests. |

### Product decisions (resolved)

| Question | Resolution | Consequences |
|---|---|---|
| Reset-work button | **Included.** | Kernel feature: core-owned `RESET_WORK` message clears the model, re-runs `initializeAvailability`, persists the cleared state. Core mounts the button (D7-idempotent, aria-labelled, with confirmation) into a theme-provided mount point (`#ximera-page-controls`), creating one if absent. **Reset cannot lower the LTI grade** — `setProgress` is a high-water mark on the Modulus side, so the learner can safely start over. State this in the learner-facing confirmation text. |
| Hint gating | **Simplified.** | Click-to-reveal, `revealed` persisted, hints revealed in document order. The legacy 30 s countdown lock and "1 of N" counters are **dropped**; `ximera-hint` becomes the smallest possible pilot. |
| `ximera-validator` | **Deferred to v2.** | `validator.js` / `javascript.js` / `interactives.js` move to the backlog (§4). v1 ships six components + kernel. |
| TinCan / xAPI | **Dropped entirely.** | No xAPI statements anywhere, client or server request. Note: the `experienced` flag **stays** — it is part of the problem-environment model triple and is set by the kernel when an available environment is first seen; only the statement emission dies with `tincan.js`. |
| Legacy state migration | **None.** | Old-server page state never enters Modulus (different backend, different keying). The persisted-state compatibility promise starts at v1's first release and runs forward only. |

---

## 3. The kernel: `ximera-core` spec

Five modules, targeted smaller than the ~740 lines of `database.js` + `problem.js` + `activity.js` they replace:

| Module | Responsibilities |
|---|---|
| `index.js` | Public API: `register(selector, mount, opts)`, `registerReducer(type, fn)`, `registerRender(selector, fn)`, `dispatch(msg)`. Bootstrap: `agent.onReady` → `pageState()` → `PAGE_STATE_RESTORED` or `AGENT_READY_OFFLINE` → `initializeAvailability` → mount reset-work control → run registered mounts → subscribe `pagestate-changed`. Dev-mode lint: unnamespaced or colliding message types. |
| `model.js` | Immutable flat map; reducers return new objects only for changed entries. `modelTo/FromPageState` = identity. |
| `update.js` | The three core reducers — `PAGE_STATE_RESTORED` (merge persisted entries, forward-tolerant), `AGENT_READY_OFFLINE` (fresh model), `RESET_WORK` (clear all entries, re-run `initializeAvailability`) — plus `initializeAvailability` (top-level or non-blocking → available; nested + blocking → covered), `propagateCorrectness` (all direct answerable children complete → environment complete, child blockers become available, recurse), and the D1 completion-diff wrapper around every reduce. |
| `render.js` | For each changed entry (reference-inequality skip): stamp `el.dataset.state`; sync form values with the focus guard — `if (document.activeElement !== el && el.value !== state.response) el.value = state.response;` — then run matching render plugins. |
| `progress.js` | Recursive average of `complete` over the `.problem-environment` tree → `[0,1]` → `agent.setProgress`. Never called with a decreasing intent — Modulus's high-water mark handles reset semantics. |

Ships with a **conformance test kit** every component runs: mount on fixture HTML via the public API only; dispatch; assert answerables reach `complete: true` and propagation fires; state survives `JSON.parse(JSON.stringify(…))`; restore replay is idempotent (render twice = render once); reset then restore behaves like first visit; no imports of core internals.

---

## 4. Package roster

### v1 (this plan)

| Package | Legacy source | Notes |
|---|---|---|
| `ximera-hint` | `hint.js` | Pilot #1. Simplified per §2: click-to-reveal only. No grading; exercises D7 chrome and `revealed` state |
| `ximera-word-choice` | `word-choice.js` | Pilot #2: first answerable; proves D1/D2/uncovering end-to-end |
| `ximera-multiple-choice`, `ximera-select-all` | `multiple-choice.js`, `select-all.js`, `shuffle.js` | Shared choice util; **persist the shuffle `seed`** from day one or restored answers land on reshuffled options |
| `ximera-free-response` | `free-response.js` | Submitted ≠ correct — spec defines what sets `complete`; exercises `registerRender` |
| `ximera-feedback` | `feedback.js` | May dissolve into per-component `data-state` vocabulary — decided when reached in Phase 3 |
| `ximera-answer` | `math-answer.js` (453 loc, the flagship) | D8 engine; consumes postprocess `\answer` spans; owns the `"postprocess"` hook; statistics + math-palette deferred |

### Backlog (v2+)

`ximera-validator` (deferred by decision: `validator.js`, `javascript.js`, `interactives.js`), `ximera-desmos`, `ximera-sage`, `ximera-code`, `ximera-youtube`, `ximera-geogebra`, annotator, image-environment, math-palette, per-answer statistics (the first legitimate P5 micro-renderer case).

### Not ported

`database.js` (replaced by the Modulus agent + kernel model store, reset button excepted — that moves to the kernel), `tincan.js` (xAPI dropped entirely), `instructor.js` / `gradebook.js` / `invigilator.js` / `supervision.js` / `users.js` / `profile.js` (server-app concerns, Modulus's side).

---

## 5. Phases

Each phase states its goal, the work, and hard exit criteria. A phase is done when its exit criteria pass in CI, not before.

### Phase 0 — Behavior specs and fixtures
*Goal: turn the legacy client into a written, testable specification, with the §2 simplifications applied.*

Work:
1. One-page **behavior spec** per v1 roster row: the DOM the component needs at mount; its state keys, mapped from legacy `persistentData` (`correct`, `chosen`, `available`, `response`, `attempt`, `seed`, `collapsed`, …); every interaction and its resulting dispatch; the completion condition; chrome + accessibility requirements (aria attributes lifted verbatim from the legacy templates); and the simplifications applied (e.g. the hint spec documents the *simplified* behavior and notes what was dropped).
2. One **fixture `.tex` source** per component, drawn from real courses where possible, compiled through tex4npm — these are the mount targets for every test in every later phase, and their compiled HTML becomes the golden-file oracle for Phase 5.
3. **Recorded examples** from the legacy client for the two genuinely subtle behaviors: answer equality (inputs × formats → correct/incorrect, per D8) and seeded shuffle (seed → order). These become executable test cases.
4. `CONTRACT.md` **draft**: D1–D9, the three core messages, the public API signatures, the model vocabulary, the conformance requirements.

Exit criteria: every spec reviewed and agreed; every fixture compiles clean through tex4npm; the answer-equality and shuffle example sets are captured as data files; contract draft complete.

### Phase 1 — Kernel
*Goal: implement `ximera-core` exactly per §3, with zero component knowledge and one dependency.*

Work: the five modules; the three core messages including `RESET_WORK` and the reset button chrome; the conformance test kit, published so component packages can depend on it.

Exit criteria: conformance kit green against synthetic fixtures (hand-written HTML + toy components exercising every API); reset round-trip verified against a mocked agent — reset → cleared state persisted → availability reinitialized → a subsequent restore behaves like a first visit → progress high-water untouched; dependency list is exactly `@modulus-learning/agent`.

### Phase 2 — Pilots prove the contract; contract freezes
*Goal: validate every contract surface with the two simplest packages, then freeze the contract.*

Work: build `ximera-hint` (simplified — exercises registration, chrome idempotence, non-answerable state, render projection), then `ximera-word-choice` (exercises the answerable registry, observed completion, propagation, uncovering). Each ships the full package template: `latex` field, peerDependency on core, conformance kit in its test script, its Phase 0 spec's examples as tests. Wire both into `my-course`. Stand up the **headless-browser integration suite**: interact → assert `data-state` transitions, progress value, and the exact `setPageState`/`setProgress` payloads sent to a mocked agent → reset → assert first-visit behavior → reload from a captured payload → assert identical DOM. This suite grows with every subsequent component.

Exit criteria: `my-course` demonstrates mount, interaction, uncovering, reset, and reload-restore with only the kernel + two packages; both pilots pass conformance; **the contract is frozen** — from here, any change to a contract surface (API signatures, environment triple, persistence rules, message namespacing) is semver-major. If a pilot cannot be expressed through the contract, this is the phase to revise it: nothing is published yet.

### Phase 3 — Graded suite
*Goal: the remaining non-flagship components, in dependency order.*

Work: (1) `ximera-multiple-choice` + `ximera-select-all` together — factor the shared choice/shuffle util, seed persisted from the first dispatch; (2) `ximera-free-response` — implements its spec's completion rule, first real use of `registerRender`; (3) `ximera-feedback` — build it, or record the decision that it dissolves into per-component `data-state` vocabulary and delete the roster row.

Exit criteria: each package passes conformance + its spec examples; the integration suite covers each; the shuffle restore test proves saved answers land on the original order.

### Phase 4 — Flagship and the build-tool hook
*Goal: `ximera-answer`, and the removal of all component knowledge from tex4npm.*

Work: port the D8 comparison engine with the Phase 0 equality fixtures as the acceptance tests; consume the `<span class="answer respondable">` spans; implement the `"postprocess"` `latex`-field hook in tex4npm and move the `\answer` transform into the package; delete postprocess's remaining answerable/blocking heuristics (completing D3).

Exit criteria: full v1 roster (kernel + six packages) published; `grep` proves tex4npm and core contain no component-specific code; every Phase 0 equality fixture passes; the integration suite covers all specs end-to-end on `my-course`.

### Phase 5 — LaTeX-side migration (per component, optional)
*Goal: move component macros out of `ximeraLatex` where it pays.*

Work, per component: move macros + tex4ht hooks into the package's `.sty`/`.4ht` (using D5's `"4ht"` support); deprecation shim in `ximera.cls` that warns on double definition; verify against the Phase 0 golden HTML and the PDF branch (`\ifdefined\HCode`).

Exit criteria, per migrated component: golden files byte-identical; PDF output unchanged; mismatched `ximeraLatex`/package versions warn rather than silently break. Components deeply entangled with `ximera.4ht` internals may stay put indefinitely — the contract allows it.

### Phase 6 — Ecosystem
*Goal: make the seventh component someone else's afternoon project.*

Work: npm scope + changesets; the semver policy from Phase 2's freeze written down; `create-ximera-component` scaffold generated from the pilot template; the author guide — "build a graded interactive in one file" — using `my-button` upgraded to a *graded* component as the worked example; CI matrix (each package × oldest and newest supported core). Then the backlog opens, `ximera-validator` first in line for v2, each new package written from the guide.

Exit criteria: the graded `my-button` demo works with zero changes to core or tex4npm — this is the acceptance test for the entire program; scaffold produces a package that passes conformance out of the box.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Answer-checking semantics drift from what courses assume | D8 fixtures recorded from the legacy client *before* porting (Phase 0.3); reuse `math-expressions`, don't reimplement |
| Manual-DOM rot (state smeared into the DOM — the actual legacy failure mode) | D9 guardrails are normative contract text; restore-replay tests enforce idempotence mechanically |
| Chrome duplication / lost accessibility | D7 marker-class idempotence; aria attributes lifted verbatim into specs |
| MathJax mutating tex4ht DOM under the runtime | Decorate-only posture (P1); `data-state` + CSS visibility, never structural mutation; pilot fixtures are MathJax-heavy on purpose |
| Reset surprises learners (lost work) or instructors (grade changes) | Confirmation dialog; documented high-water-mark semantics — reset never lowers the LTI grade |
| Contract can't express a component | Discovered in Phase 2, pre-publication and pre-freeze — cheap to revise |
| Silent reshuffle breaks restored choice answers | Persisted `seed` from the first dispatch; explicit restore test in Phase 3 |
| Scope creep from the legacy long tail | §2 resolutions recorded; backlog ≠ blocker; validator explicitly v2 |
| tex4ht fragility in Phase 5 | Golden files; per-component, optional, shimmed |
| DOM-id instability across course edits (pre-existing) | Out of scope; tracked; candidate follow-on: stable authored ids |

---

## 7. Milestones

| Phase | Outcome | Sizing |
|---|---|---|
| 0 | Specs, fixtures, recorded examples, `CONTRACT.md` draft | M |
| 1 | Kernel (incl. reset) + conformance kit | M |
| 2 | Pilots in `my-course`; **contract frozen** | M |
| 3 | Choice suite, free-response, feedback decision | M |
| 4 | `ximera-answer` + `"postprocess"` hook; tex4npm component-free | L (the flagship) |
| 5 | LaTeX macros migrated where sensible | M, parallelizable |
| 6 | Scaffold, guide, CI matrix, graded `my-button`; backlog opens with `ximera-validator` | M, ongoing |

The through-line: one flag (`complete: true` on answerables), one loop (dispatch → reduce → propagate → project → persist), one authority (the build-time DOM). Everything in this plan is arranged so those three stay true while the ecosystem grows around them — and the ~1,600 lines of jQuery in `original-server` finish their career as a test oracle.
