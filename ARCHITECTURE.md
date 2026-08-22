# Ximera architecture

An overview of the workspace, how the pieces compose, and the direction the shared data + event model needs to grow.

---

## The picture

```
  author writes LaTeX ─► tex4npm build ─► static HTML + JS + CSS ─► learner in browser ─► Modulus (persistence)
       (.tex)              (build tool)     (dist/)                   (ximera-core +           (@modulus-learning
                                                                       component packages)      /agent)
```

An author writes a course in LaTeX using the `ximera`/`xourse` document classes and declares their interactive components as ordinary npm dependencies. `tex4npm` compiles the LaTeX to HTML and bundles the JS/CSS of every declared component into a single page-level runtime. In the browser, `ximera-core` restores state from Modulus, dispatches messages as the learner interacts, and reports progress + page state back.

The four workspaces have distinct responsibilities:

| Directory | Role | Analogy |
|-----------|------|---------|
| `tex4npm/` | Build system: `.tex` → HTML, plus esbuild bundle of component JS/CSS | webpack |
| `ximera-core/` | Client-side MVU runtime (model, reducer, renderer, progress) **plus** the base LaTeX class + tex4ht config (`ximera.cls`, `xourse.cls`, `ximera.4ht` — extracted from `latex/*.dtx` sources into `latex/dist/`) | Redux + React DOM + React framework |
| `my-button/` (and future `ximera-*` packages) | Dual LaTeX + JS npm packages defining interactive components | React components |
| `original-server/` | Legacy jQuery client — reference only, being replaced | — |
| `app.modulus-learning.org/` | LTI 1.3 tool: authenticated persistence, progress, LMS score passback | (external) backend |

---

## Build system: tex4npm

`tex4npm` runs in two phases (see `tex4npm/src/`):

**Pre-build (once per invocation).** Scan `node_modules` for packages whose `package.json` has a `"latex"` field. For each:
- Symlink declared `.sty` files into `.tex4npm/texmf/tex/latex/`, so `TEXINPUTS=.tex4npm/texmf//:…` lets `pdflatex`/`latex` find them.
- Add the package's JS entry and declared CSS to a synthetic `.tex4npm/bundle-entry.js`.

Then esbuild bundles that entry into `dist/ximera.js` + `dist/ximera.css`. This is exactly analogous to webpack: `package.json` declares dependencies, the build tool resolves and bundles them, and the author writes ordinary source files.

**Per-`.tex` compile pipeline** (`compile.js`, `artifacts.js`, `postprocess.js`):

1. `pdflatex` with class options `tikzexport,xake` — produces `.aux` and possibly `.sagetex.sage`.
2. Optional `sage`, re-running pdflatex.
3. `latex` (×2, DVI mode) with an inlined `tex4ht.sty` preamble — the same one `htlatex` uses, embedded verbatim so we call `latex` directly and stay in Node.
4. `tex4ht -f/stem -cunihtf -utf8` — DVI → HTML, writes `stem.lg`.
5. `t4ht -f/stem` — CSS output, image processing.
6. `postprocess.js` via cheerio: strip empty `<p></p>`, inject `<meta name="dependency">` cache markers, extract `\answer{VALUE}` from math spans into `<span class="answer respondable">`, mark answerable problems with `data-blocking=""`, and inject `<link>`/`<script defer>` for the bundle.

Incremental rebuilds work because each compiled HTML embeds SHA1 hashes of every file TeX read (from the `.fls` INPUT lines). `dirty.js` compares those to disk on the next run; dirtiness propagates up the `\input`/`\activity` graph.

Concurrency: only the `execa` calls to `pdflatex`/`latex`/`tex4ht` are throttled by a `PQueue` (default `cpus/2`). All post-processing runs outside the queue so I/O-light work never blocks a compile that hasn't started.

---

## The dual LaTeX + JS package convention

The convention that makes a course composable: an npm package can declare both a `.sty` file (LaTeX-side behavior) and a JS entry (browser-side behavior) that operates on the HTML the `.sty` emits.

```json
// package.json
{
  "name": "my-button",
  "main": "index.js",
  "latex": {
    "sty": ["my-button.sty"],
    "css": ["dist/my-button.css"]
  }
}
```

The `.sty` file uses `\ifdefined\HCode` to branch on PDF vs HTML:

```latex
\newcommand{\button}[1]{\fbox{#1}}           % PDF mode
\ifdefined\HCode
  \renewcommand{\button}[1]{%
    \HCode{<button>}#1\HCode{</button>}%     % HTML mode via tex4ht
  }
\fi
```

The JS entry registers a mount function against a CSS selector:

```js
// my-button/index.js
import { register } from 'ximera-core';

register('button', (el, dispatch) => {
  el.classList.add('ximera-button');
  el.addEventListener('click', () => { /* ... */ });
});
```

`ximera-core/index.js` iterates the registry after the Modulus agent is ready and calls each `mountFn(element, dispatch)` for every matching element on the page. New component packages plug in with nothing more than a `"latex"` field, a `.sty` that emits recognizable HTML, and a `register(selector, mount)` call.

For richer components (see below), the mount function will also dispatch messages and read state — the contract `ximera-core` is meant to expose.

---

## Client runtime: ximera-core

`ximera-core` is a small Elm-style MVU runtime. Five files:

```
index.js      public API: register(selector, mount), dispatch(msg); mounts built-ins
model.js      immutable model: flat { elementId → { …state } } map
update.js     pure reducer: one case per message type
render.js     reads model, sets data-state="…" attributes; CSS drives visuals
progress.js   walks .problem-environment tree → [0,1] score
```

### Model

The model is a flat map keyed by DOM `id`:

```js
{
  "problem-1":  { available: true, complete: false, experienced: true },
  "answer-3":   { response: "17", attempt: "17", correct: true, complete: true },
  "problem-2":  { available: false, complete: false },
  "choice-4":   { revealed: true },
  ...
}
```

Every interactive DOM node with an `id` may hold an entry. Shape is per-element-type (an answer has `response`/`attempt`/`correct`; a multiple-choice has `chosen`/`checked`/`wrong`/`correct`) but the containing `problem-environment` state is uniform: `{ available, complete, experienced }`.

### Messages

Messages are plain objects with a `type`. Current set (from `update.js`):

- Lifecycle: `PAGE_STATE_RESTORED`, `AGENT_READY_OFFLINE`
- Answer blanks: `ANSWER_INPUT`, `ANSWER_CHECK`
- Multiple choice: `CHOICE_SELECT`, `MULTIPLE_CHOICE_CHECK`
- Select-all: `SELECT_ALL_TOGGLE`, `SELECT_ALL_CHECK`
- Word choice: `WORD_CHOICE_SELECT`
- Free response: `FREE_RESPONSE_INPUT`, `FREE_RESPONSE_SUBMIT`
- Hints: `HINT_REVEAL`

Each case in the reducer returns a new model. On any `*_CHECK` that lands `correct`, `propagateCorrectness(model, problemId)` walks upward: if every direct answerable child of a `problem-environment` reports `complete`, the environment itself becomes complete, its `correct`/`attempt` feedbacks become visible, its direct-child blocking sub-problems become `available: true`, and the propagation recurses to the parent problem-environment.

### Render

`render.js` is a pure `model → DOM` projection. It never mutates state; for each entry it sets `el.dataset.state = "…"` and syncs the values of native form inputs (`<input>`, `<textarea>`, `<select>`). All visual behavior — hiding an unavailable problem, coloring a correct answer, revealing feedback, expanding a hint — lives in CSS driven by `data-state="…"`. This is what makes the runtime cheap: the DOM `ximera.4ht` produced is authoritative, and the model only decorates it.

### Progress

`progress.js` recursively averages `state.complete` over the tree of `.problem-environment` elements to compute a `[0,1]` score. That score is what Modulus receives via `agent.setProgress(...)` and eventually flows to Canvas.

---

## Persistence: the Modulus agent

The client talks to `app.modulus-learning.org` through `@modulus-learning/agent`. The surface `ximera-core` uses is small:

```
agent.onReady(callback)                       // fires after auth + initial state fetch
agent.pageState()          → any              // last state received/submitted
agent.setPageState(state)                     // persists to Modulus (background)
agent.setProgress(number ∈ [0,1])             // high-water mark; contributes to LTI grade
agent.on('pagestate-changed', ({pageState})) // server-side change echoed back
```

`ximera-core`'s wiring (see `index.js`):

- On `onReady`: read `pageState()`, either restore into the model via `PAGE_STATE_RESTORED` or emit `AGENT_READY_OFFLINE`, mount all built-in components, then run registered third-party mounts.
- Every `dispatch` calls `agent.setPageState(modelToPageState(model))` and `agent.setProgress(calculateProgress(model))`.
- The agent may push server-side updates as `pagestate-changed`, which re-enters the reducer via `PAGE_STATE_RESTORED`.

The Modulus agent (`apps/agent`) is the only npm-published artefact of the Modulus repo. It handles authentication, retry/backoff, offline detection, and contribution targets (so an activity's progress can also roll up into a "book" or "chapter" accumulator). No learner PII crosses the boundary into activity code — the agent only exposes an opaque `user.id` and `user.full_name`.

---

## Problem-environment uncovering

`ximera.cls` and its `ximera.4ht` counterpart emit each `\begin{problem} … \end{problem}` as `<div class="problem-environment" id="…">`. `postprocess.js` additionally sets `data-blocking=""` on any environment that contains answerable content.

At mount time (`update.js#initializeAvailability`), every problem-environment is stamped with `available: true|false`:

- Top-level or non-blocking → `available: true` (uncovered).
- Nested + blocking → `available: false` (covered) until unlocked.

When a problem-environment reaches `complete: true`, `propagateCorrectness` sets `available: true` on its direct-child blocking sub-problems. `render.js` writes `data-state="available complete …"` and CSS handles the reveal (fade-in, expand, prompt, whatever the theme chooses). This is the "uncovering" behavior: progression through a problem is entirely a function of the model, and reversible — a `PAGE_STATE_RESTORED` message on a returning learner replays the same reveals from persisted state.

---

## The direction: a common data + event model

Today `ximera-core` bundles every interactive type it knows about (answer blanks, multiple-choice, select-all, word-choice, free-response, hints). The design goal is to factor those out into individual `ximera-*` packages that plug in through a stable contract, so the ecosystem can grow without touching core. Concretely:

- `ximera-answer` — the `\answer{…}` blank inside math (currently `mountAnswerBlanks` in `ximera-core/index.js`).
- `ximera-multiple-choice`, `ximera-select-all`, `ximera-word-choice` — currently `mountMultipleChoice`, `mountSelectAll`, `mountWordChoice`.
- `ximera-free-response`, `ximera-hint`, `ximera-feedback` — the remaining built-ins.
- `my-button` and other author-supplied components — already outside core.

For that split to work, `ximera-core` needs to expose (and document) the contract those packages consume. That contract is essentially what `index.js` already does internally, promoted to a public surface:

1. **DOM contract.** The `.sty` (and its tex4ht hooks in `.4ht`) must emit a stable class + attribute shape. E.g. a graded interactive must be inside a `.problem-environment[id]`; the interactive itself needs a unique id; answerable elements must be in the set `getDirectAnswerables` recognizes.
2. **Registration.** `register(selector, mount)` runs `mount(el, dispatch)` after Modulus is ready.
3. **Messages.** Components define their own message types and register reducer cases. Today this is monolithic in `update.js`; splitting it means either (a) a plugin-provided reducer, `registerReducer(type, fn)`, or (b) a small set of standard messages every component conforms to (e.g. `RESPOND {id, value}`, `SUBMIT {id, correct}`). Option (b) reduces surface area but loses component-specific state; option (a) is closer to the current shape.
4. **Model shape.** State keyed by DOM id, per-element schema owned by the component that dispatches into it. Uniform contract only on `problem-environment` (`{available, complete, experienced}`) and answerables (must set `complete: true` to unblock the parent).
5. **Render contract.** Components own their `data-state` vocabulary; core renders only problem-environment + feedback. Alternative: components register a render function analogous to their reducer.
6. **Progress contract.** Any element listed by `getDirectAnswerables` must transition to `complete: true` when done. This is the single hook that makes problem-environment uncovering work uniformly — free-response, multiple-choice, and hypothetical future components all reduce to it.
7. **Persistence.** `modelToPageState` / `modelFromPageState` remain the identity function (see `model.js`). Components need only store JSON-serializable state under their DOM id, and Modulus takes care of the round-trip.

The uncovered choice — reducer plugins vs. a fixed message vocabulary — is the main open design question for extracting components. The current `update.js` reads DOM classes to decide correctness (`.choice.correct`), which suggests the sensible split is: components own their `dispatch` calls and reducer cases, and core owns only propagation up the `problem-environment` tree and persistence.

---

## Repository layout, at a glance

```
ximera-two/
├── ARCHITECTURE.md          this file
├── CLAUDE.md                agent-facing project notes (overrides + pointers)
├── PIPELINE.md              detailed .tex → .html pipeline (predates tex4npm; still useful)
├── tex4npm/                 build tool (webpack analogue)
│   ├── bin/tex4npm.js       CLI entry
│   └── src/                 cli, config, discover, deps, graph, dirty, compile,
│                            artifacts, postprocess, bundle, stage, watch (+ tests)
├── ximera-core/             MVU runtime (index, model, update, render, progress)
│   └── latex/               .dtx sources → dist/{ximera,xourse}.{cls,4ht}, ximera.cfg
├── my-button/               minimal dual LaTeX+JS component (\button macro + click hook)
├── my-course/               example course consuming the above via npm
├── original-server/         legacy jQuery client (reference only)
└── app.modulus-learning.org/  external: LTI tool, published agent, gradebook
```

For deeper dives:
- `tex4npm/CLAUDE.md` — module-by-module notes on the build system.
- `PIPELINE.md` — the raw `.tex → .html` mechanics.
- `app.modulus-learning.org/docs/ARCHITECTURE.md` — the Modulus side of the boundary.
