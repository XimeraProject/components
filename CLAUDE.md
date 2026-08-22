# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Repository overview

This workspace is the active development area for a new npm-based Ximera build system. Ximera is an open-source platform for turning LaTeX-authored course materials into interactive web pages. The workspace contains three main pieces:

| Directory | Role |
|-----------|------|
| `tex4npm/` | The build tool — compiles `.tex` → HTML (analogous to webpack for LaTeX) |
| `ximera-core/` | Client-side JS runtime **and** the LaTeX class + tex4ht config (`.dtx` sources under `latex/`, compiled to `latex/dist/*.cls`/`.4ht`/`.cfg` by `npm run build:latex`) |
| `original-server/` | Legacy jQuery client-side code — reference implementation being replaced by `ximera-core` |

`my-course/` and `my-button/` are working examples of the author-facing npm workflow.

---

## Commands

### tex4npm (the build tool)

```bash
cd tex4npm
node --test src/**/*.test.js          # run all tests
node --test src/compile.test.js       # run a single test file
```

### my-course (author-facing example)

```bash
cd my-course
npm install
npm run build      # tex4npm build — compile dirty .tex files to dist/
npm run dev        # tex4npm watch — incremental watch mode
```

On a fresh clone, `ximera-core/latex/dist/` is empty (it's gitignored). Bootstrap it once with:

```bash
cd ximera-core
npm run build:latex   # extract .cls/.4ht/.cfg from .dtx sources into latex/dist/
```

External tools required on `PATH`: `pdflatex`, `latex`, `tex4ht`, `t4ht` (from `tlmgr install tex4ht`), `makeindex`, and optionally `sage`.

---

## Architecture: how the pieces fit together

### The end-to-end flow

An author writes a course in LaTeX and declares npm package dependencies:

```
my-course/
├── package.json          # depends on ximera-core, my-button, etc.
├── tex4npm.config.js     # { root: 'src', outDir: 'dist' }
└── src/
    └── sample.tex        # \documentclass{ximera}; \usepackage{my-button}
```

Running `npm run build` (which calls `tex4npm build`) produces `dist/sample.html`, `dist/ximera.js`, and `dist/ximera.css`. The JS bundle makes the page interactive.

### tex4npm build phases

**Pre-build (once per invocation — `stage.js` + `bundle.js`):**
1. Scan `node_modules` for packages with a `"latex"` field in `package.json`
2. Symlink each declared `.sty` file into `.tex4npm/texmf/tex/latex/` (so TeX can find them without touching the system installation)
3. Write `.tex4npm/bundle-entry.js` that imports the JS entry and any declared CSS of every latex-npm package
4. Run esbuild to bundle that entry into `dist/ximera.js` + `dist/ximera.css`

**Per-.tex file compile pipeline (`compile.js`):**
1. `pdflatex` — with `tikzexport` + `xake` class options; generates `.aux`, and `.sagetex.sage` if needed
2. Optional: run `sage` and re-run pdflatex if `.sagetex.sage` was produced
3. `latex` ×2 (configurable) — with tex4ht.sty injected via a hardcoded preamble constant (verbatim from the htlatex script); produces `.dvi`, `.4ct`, `.4tc`
4. `tex4ht -f/stem -cunihtf -utf8` — DVI → HTML; writes `stem.lg` listing its output files
5. `t4ht -f/stem` — post-processes `.lg`; handles CSS, images

All latex invocations run with `TEXINPUTS=.tex4npm/texmf//:` prepended so staged `.sty` files are found. All invocations run in the `.tex` file's directory (TeX hard-requires this for relative path resolution).

**Post-processing (`postprocess.js`):**
- Removes `<p></p>` empty elements
- Injects `<meta name="dependency" content="HASH relpath">` tags for incremental rebuild tracking
- Extracts `\answer{VALUE}` patterns from `<span class="mathjax-inline">` elements and inserts `<span class="answer respondable">` after the math span (tex4ht cannot convert `\answer` to HTML itself)
- Adds `data-blocking=""` to `.problem-environment` divs that contain answerables
- Injects `<link>` + `<script defer>` tags pointing to the bundled `ximera.js` / `ximera.css`
- For xourse files: removes spurious `<a id>` anchors, enriches `<a class="activity">` links with title and abstract from the compiled activity HTML

**Dirty-checking (`dirty.js`):**  
The `<meta name="dependency">` tags embedded in compiled HTML are the incremental cache. On the next run, tex4npm reads them, SHA1-hashes the listed files, and skips recompilation if all hashes match. Dirtiness propagates up the dependency graph: if `chapter1/section1.tex` changes, any xourse that `\activity`s it is also recompiled.

### The dual LaTeX + JS package convention

An npm package can be both a LaTeX package and a JavaScript module. It declares the split via a `"latex"` field in `package.json`:

```json
{
  "name": "my-button",
  "main": "index.js",
  "latex": {
    "sty": ["my-button.sty"],
    "css": ["dist/my-button.css"]
  }
}
```

- `"latex".sty` — `.sty` files that get symlinked into `.tex4npm/texmf/tex/latex/` for the TeX compiler
- `"latex".css` — CSS files that get added to the esbuild bundle entry
- `"main"` / `"exports"` — the JS entry point, bundled normally by esbuild

The `.sty` file defines how the macro renders in LaTeX (PDF) and in HTML mode via `\ifdefined\HCode`. The `index.js` wires up browser interactivity for the HTML elements the `.sty` emits.

### ximera-core: the new client-side runtime

`ximera-core` is an Elm-like MVU (model–update–render) runtime that replaces the old jQuery system in `original-server/`. It is itself an npm package with a `"latex"` field and is included in every course that depends on it.

```
index.js      — public API: register(), dispatch(); wires agent events; mounts built-in components
model.js      — immutable model: flat map of element id → state object
update.js     — pure reducer: handles all message types, propagates correctness up the DOM tree
render.js     — reads model, sets data-state attributes on DOM elements (CSS drives the visual change)
progress.js   — traverses .problem-environment tree to compute a [0,1] completion score
```

Interactivity is entirely driven by `data-state` attribute values on DOM elements — CSS rules control visibility, color, etc. No jQuery, no direct DOM mutation for state.

State is persisted via `@modulus-learning/agent` (`agent.setPageState()` / `agent.pageState()`). On page load, the agent fires `onReady` with the saved state; `ximera-core` restores it via `PAGE_STATE_RESTORED`.

Third-party ximera npm packages add custom interactive components by calling `register(cssSelector, mountFn)`. After the agent is ready and the built-in components are mounted, `index.js` iterates the registry and calls each `mountFn(element, dispatch)`.

### ximera-core's LaTeX side

Alongside its JS runtime, `ximera-core/` owns the LaTeX class and tex4ht config: docstrip `.dtx` sources under `ximera-core/latex/`, extracted by `make` (via `npm run build:latex`) into `ximera-core/latex/dist/{ximera,xourse}.{cls,4ht}` and `ximera.cfg`. The `.4ht` files are the tex4ht configuration that tells it how to convert Ximera-specific LaTeX environments (`\begin{problem}`, `\begin{multipleChoice}`, `\answer{}`, etc.) into the specific HTML class structure that the JS runtime and CSS expect. Per-component macros (`\answer`, choice environments, etc.) live in their own pilot packages' `.sty`/`.4ht` files, not in this class.

`ximera-core/package.json`'s `latex` field lists the compiled artifacts (`latex/dist/*.cls`, `latex/dist/*.4ht`, `latex/dist/ximera.cfg`) so `tex4npm/src/stage.js` symlinks them into every course's `.tex4npm/texmf/` before LaTeX compilation. `dist/` is gitignored and shipped in the npm tarball; a `prepare` npm script rebuilds it before `npm publish`.

### original-server/ — legacy reference implementation

These jQuery CommonJS modules implement the same interactive functionality as `ximera-core` but with a different architecture: jQuery plugins, `$.fn.extend`, differential synchronization over WebSocket (`database-websocket.js`) or AJAX (`database.js`), and xAPI/TinCan learning analytics (`tincan.js`). They are kept for reference. Key patterns:

- `$.fn.persistentData(key, value)` — read/write element state that syncs to the server
- `ximera:correct` / `ximera:complete` / `ximera:answer-needed` — jQuery custom events that bubble up the problem tree
- `differentialSynchronization()` — jsondiffpatch-based two-way sync between local `DATABASE` and server shadow

---

## Key design decisions

**Why `tex4npm` calls `latex` directly instead of `htlatex`:**  
`htlatex` is a shell script wrapper. tex4npm injects the exact same tex4ht.sty preamble inline (the `TEX4HT_PREAMBLE` constant in `compile.js`) so that `latex` is called directly. This gives full control over flags and avoids shell-escaping issues across platforms.

**Why only `execa` subprocess calls are throttled (not post-processing):**  
`pdflatex`/`latex`/`tex4ht` are CPU-bound. Post-processing (artifact copying, SHA1 hashing, Cheerio DOM work) is I/O-light and runs immediately after its compile finishes, outside `PQueue`. This keeps all cores busy.

**Why `.tex4npm/texmf/` is wiped on every invocation:**  
To prevent drift from `node_modules`. If a package is removed or updated without a rebuild, the staged `.sty` directory could contain stale files. Wiping and relinking is fast (symlinks).

**`"latex"` vs `"ximera"` field name:**  
The active code in `stage.js` and all package examples use `"latex"` as the field name in `package.json`. The `tex4npm/CLAUDE.md` says `"ximera"` — that is outdated.
