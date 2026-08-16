# ximera-feedback

**Status:** **Dissolved at Phase 3.** No `ximera-feedback` package will be built. Feedback behavior lives entirely in `ximera-core`.

**Legacy source:** `original-server/feedback.js` (54 loc).
**Answerable:** no.

## Decision

Phase 3 §5 of PLAN.md gave two paths for feedback: build a dedicated package (Design A / Design B in the original draft of this spec) or dissolve the row entirely. **The row is dissolved.** Rationale:

1. **The kernel already handles it.** `ximera-core/update.js` `propagateCorrectness` reveals `.feedback[data-feedback="correct"|"attempt"]` on problem completion, and `markAttemptFeedback` reveals `.feedback[data-feedback="attempt"]` on any incorrect submission. Both write `{ visible: true }` to the feedback entry.
2. **The kernel already renders it.** `ximera-core/render.js` `projectBuiltIn` sets `data-state="visible"|"hidden"` on `.feedback` elements. `ximera-core/ximera-core.css` provides the visibility rules.
3. **A package would have nothing left to do.** With state, projection, and visuals all kernel-owned, a `ximera-feedback` package would be an empty shell — no `register`, no `registerReducer`, no `registerRender`.

Verified by Phase 2's integration suite: the feedback fixture (`specs/fixtures/ximera-feedback.tex`) already produces working attempt + correct feedback with only `ximera-core` bundled.

## Trade-off: kernel is coupled to `.feedback`

The kernel now has one class of DOM element it treats specially — `.feedback` — which is a small violation of P2 ("kernel owns only the environment triple, not sibling classes"). This is a pragmatic exception, weighed against the cost of introducing two new core-owned messages (`PROBLEM_ATTEMPTED`, `PROBLEM_COMPLETED`) for a single downstream consumer.

## When to revisit — Design B, in future

If a second component ever needs to react to problem-attempt/completion events (a hypothetical `ximera-badges` awarding milestone badges on completion, a `ximera-analytics-hook` firing on every attempt), promote the coupling into a public contract: kernel emits `PROBLEM_ATTEMPTED { problemId }` and `PROBLEM_COMPLETED { problemId }` post-propagation; both feedback and the new consumer register reducers for those types. This would be a semver-minor addition to CONTRACT.md §4 (two new core-owned messages) — additive, backward-compatible with the freeze. Do it when a second consumer arrives, not before.

## What the ecosystem sees

- No `ximera-feedback` package to install; feedback works out of the box with `ximera-core`.
- The `\feedback[attempt|correct]{…}` LaTeX macro (in `ximera.cls` / `ximera.4ht`) continues to emit the DOM the kernel expects. Phase 5's optional macro migration does not apply here.
- The `data-feedback="script"` flavor remains **deferred with `ximera-validator`** (PLAN.md §2). Kernel currently does not handle it; when `ximera-validator` lands, it will register a reducer for a namespaced message that reveals script-flavor feedback.

## Roster impact

`PLAN.md §4` lists `ximera-feedback` in the v1 roster. That row is now removed in spirit — a build note should annotate PLAN.md accordingly. The v1 shipped roster becomes: **kernel + five packages** (`ximera-hint`, `ximera-word-choice`, `ximera-multiple-choice`, `ximera-select-all`, `ximera-free-response`, `ximera-answer`).
