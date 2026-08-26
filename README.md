# Ximera

**Interactive online mathematics, authored in LaTeX.**

Ximera turns ordinary LaTeX course materials into interactive web pages — problems you can answer, hints you can reveal, multiple-choice you can grade — while keeping the source a plain `.tex` file that still compiles to a PDF. This repository is the component monorepo: the build tool, the client-side runtime, and the library of interactive components.

---

## The big idea: a bundler, but for LaTeX

If you've used a JavaScript bundler like webpack, you already understand `tex4npm`.

A webpack project has a `package.json`, declares its dependencies with `npm`, and the bundler walks that dependency graph to assemble one deliverable from many small packages. `tex4npm` does exactly this — except the entry points are `.tex` files, and the packages it resolves carry **LaTeX** alongside their JavaScript.

```
        author writes            tex4npm resolves            browser runs
         LaTeX (.tex)      ─►     npm dependencies      ─►    the result
                                  (each = TeX + JS)

  \documentclass{ximera}         ximera-core                 interactive page:
  \usepackage{ximera-hint}       ximera-hint                 gradable answers,
  \begin{problem} … \end{...}    ximera-multiple-choice      hints, progress,
                                  ximera-chrome               LMS score sync
```

An author declares dependencies the ordinary npm way:

```json
{
  "name": "my-course",
  "dependencies": {
    "ximera-core": "*",
    "ximera-chrome": "*",
    "ximera-hint": "*",
    "ximera-multiple-choice": "*"
  }
}
```

…and writes ordinary LaTeX:

```latex
\documentclass{ximera}
\usepackage{ximera-hint}
\usepackage{ximera-multiple-choice}
\begin{document}
\begin{problem}
  What is $2+2$?
  \begin{multipleChoice}
    \choice{3}
    \choice[correct]{4}
  \end{multipleChoice}
  \begin{hint} Count on your fingers. \end{hint}
\end{problem}
\end{document}
```

Running `npm run build` produces a self-contained `dist/` with the compiled HTML plus a single bundled `ximera.js` / `ximera.css` — everything the page needs to become interactive.

### How an npm package carries LaTeX

The trick that makes this work is a convention: an npm package can be **both** a LaTeX package and a JavaScript module. It declares the split with a `"latex"` field in its `package.json`:

```json
{
  "name": "ximera-foldable",
  "main": "index.js",
  "latex": {
    "sty": ["ximera-foldable.sty"],
    "4ht": ["ximera-foldable.4ht"],
    "css": ["ximera-foldable.css"]
  }
}
```

When `tex4npm` scans `node_modules`, any package with a `"latex"` field is treated specially:

| Field | What `tex4npm` does with it |
|-------|-----------------------------|
| `sty` / `cls` | Symlinks the `.sty`/`.cls` into a private `texmf` tree so `pdflatex` and `latex` find them — no system install touched |
| `4ht` / `cfg` | Stages the tex4ht config that teaches the HTML converter how each macro becomes HTML |
| `css` | Adds it to the page bundle |
| `main` / `exports` | The JS entry, bundled with esbuild like any other module |
| `postprocess` / `xourse` | Optional build-time hooks a package can run over the compiled HTML |

So a single `\usepackage{ximera-foldable}` pulls in the LaTeX macros, the tex4ht rules, the CSS, **and** the browser JavaScript for that component — all from one npm dependency. That's the whole model.

---

## `ximera-core`: the base class and the runtime

Every course depends on `ximera-core`. It is itself one of these dual packages, and it plays two roles:

**On the LaTeX side**, it owns the `ximera` and `xourse` document classes (`\documentclass{ximera}`) and the base tex4ht configuration — the rules that emit each `\begin{problem}…\end{problem}` as a `<div class="problem-environment">` with the structure the runtime expects. These are compiled from `.dtx` sources under `ximera-core/latex/`.

**On the JavaScript side**, it is a small Elm-style **model → update → render** runtime:

- a single immutable **model** keyed by DOM element id,
- a pure **reducer** that turns messages (`ANSWER_CHECK`, `CHOICE_SELECT`, …) into a new model and propagates correctness up the problem tree,
- a **renderer** that projects the model onto `data-state` attributes — CSS then drives every visual change (revealing a hint, coloring a correct answer, uncovering the next sub-problem). No jQuery, no ad-hoc DOM mutation.

Third-party components plug in by calling `register(selector, mount)` (plus `registerReducer` / `registerRender` for state). After the page loads, the runtime mounts every registered component onto its matching elements.

---

## `ximera-chrome`: the look of the page

Where `ximera-core` provides the machinery, **`ximera-chrome`** provides the *style and shell* — the visual identity wrapped around the raw compiled content. It supplies the page-level CSS (typography, layout, theorem-environment styling, colors) and, for **xourse** files (Ximera's multi-activity "courses"), it builds the navigational chrome: the header and footer, the breadcrumb, the table of contents, and the previous/next pager — all via build-time `postprocess` and `xourse` hooks that rewrite the compiled HTML.

Swap in a different chrome package and the same LaTeX content takes on a completely different appearance.

---

## The component packages

Everything else in this repo is an interactive or presentational **component**: a dual LaTeX + JS package that owns one piece of the page. Each combines the `.tex` macros (how it renders in PDF and how tex4ht turns it into HTML) with the JavaScript that makes the emitted HTML behave.

**Interactive** — dispatch messages into the `ximera-core` model, contribute to progress, and persist their state:

| Package | LaTeX | What it does |
|---------|-------|--------------|
| `ximera-answer` | `\answer{…}` | Fill-in-the-blank answer inside math, checked against the author's value |
| `ximera-multiple-choice` | `multipleChoice` | Single-correct choice list |
| `ximera-select-all` | `selectAll` | Choose-all-that-apply list |
| `ximera-word-choice` | `\wordChoice` | Inline pick-the-right-word |
| `ximera-free-response` | `freeResponse` | Free-text response |
| `ximera-hint` | `hint` | Progressively revealed hints |
| `ximera-foldable` | `foldable` / `accordion` / `expandable` | Collapsible callouts and accordions |

**Presentational & content** — style or embed, no graded state:

| Package | LaTeX | What it does |
|---------|-------|--------------|
| `ximera-dialogue` | `dialogue` | Styled conversational exchanges |
| `ximera-verbatim` | code environments | Syntax-styled code / verbatim blocks |
| `ximera-video` | `\youtube` | Embedded YouTube videos |
| `ximera-xkcd` | `\xkcd` | Embedded xkcd comics |

**Shared LaTeX helpers** — macros reused by the components above:

| Package | Provides |
|---------|----------|
| `ximera-choice` | The shared `\choice` / `\otherchoice` / `\inlinechoice` macros used by multiple-choice and select-all |
| `ximera-proof` | The `proof` environment |

Adding a new interactive component means writing a new package with a `"latex"` field, a `.sty` that emits recognizable HTML, and a `register(selector, mount)` call — nothing in core has to change.

---

## Persistence and grading: Modulus

The components never talk to a server directly. State and grades flow through **Modulus** via the `@modulus-learning/agent` package. On page load the agent restores the learner's saved **page state** (so revealed hints, entered answers, and uncovered problems come back exactly as they were left). As the learner interacts, `ximera-core` reports the updated page state and a `[0, 1]` **progress score** back to the agent, which handles authentication, offline buffering, and — over LTI 1.3 — passing the score back to the LMS gradebook (Canvas and friends).

The activity code stays blissfully unaware of any of this: it dispatches messages and updates a model; Modulus takes care of the round-trip.

---

## Repository layout

```
components/
├── tex4npm/        the build tool — resolves npm deps, compiles .tex → HTML, bundles JS/CSS
├── ximera-core/    base ximera/xourse LaTeX classes + the MVU client runtime
├── ximera-chrome/  page styling + xourse navigation chrome
└── ximera-*/       interactive and presentational components (answer, hint, foldable, …)
```

---

## Getting started

```bash
# 1. Bootstrap ximera-core's LaTeX artifacts (dist/ is gitignored)
cd ximera-core && npm install && npm run build:latex

# 2. From a course directory (package.json + tex4npm.config.js):
npm install
npm run build      # compile dirty .tex files into dist/
npm run dev        # incremental watch mode
```

### Running the build tool's tests

```bash
cd tex4npm
node --test src/**/*.test.js
```

### Requirements

A working TeX installation providing these on your `PATH`:

- `pdflatex`, `latex`
- `tex4ht`, `t4ht` (`tlmgr install tex4ht`)
- `makeindex`
- optionally `sage` (for `sagetex` content)

Plus Node.js for `tex4npm` and the component packages.

---

## How a build actually runs

For the curious, one `.tex` file goes through:

1. **`pdflatex`** — with the `tikzexport` + `xake` class options; produces `.aux` and, if used, a SageMath script.
2. **`sage`** (optional) — runs generated Sage, then re-runs pdflatex.
3. **`latex` ×2** — in DVI mode, with the tex4ht preamble injected inline (so we call `latex` directly instead of the `htlatex` shell wrapper and keep full control of flags).
4. **`tex4ht`** — turns the DVI into HTML using the staged `.4ht` configs.
5. **`t4ht`** — emits CSS and processes images.
6. **post-processing** — cleans the HTML, extracts `\answer` values into gradable spans, injects the bundle `<link>`/`<script>`, runs each package's `postprocess`/`xourse` hooks, and embeds dependency hashes so the next build can skip unchanged files.

Incremental rebuilds work because each compiled page records SHA-1 hashes of every file TeX read; dirtiness propagates up the `\input` / `\activity` graph.
