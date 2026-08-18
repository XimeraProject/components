# my-course

A minimal Ximera course that doubles as the workspace's smoke test. `src/sample.tex` exercises every v1 pilot on one page — `\button`, `\answer`, `\begin{hint}`, `\wordChoice`, `\begin{multipleChoice}`, `\begin{selectAll}`, `\begin{freeResponse}`, and the feedback environments — so a clean build here means the whole pipeline is healthy end-to-end.

## Building

```
cd my-course
npm install       # first time only — links tex4npm and the pilot packages from the workspace
npm run build     # compile every .tex under src/ into dist/
npm run dev       # incremental watch mode
```

Output lands in `dist/`:

- `sample.html` — the compiled page
- `ximera.js` / `ximera.css` — the bundled runtime, produced once per invocation from every latex-npm package's JS/CSS entries

Open `dist/sample.html` in a browser. Buttons click, hints reveal, answers grade, progress persists across reloads.

## Prerequisites

External tools on `PATH`: `pdflatex`, `latex`, `tex4ht`, `t4ht` (from `tlmgr install tex4ht`). No system-wide install of any Ximera `.sty` or `.cls` file is required — `tex4npm` stages every `latex`-declared package from `node_modules/` into `.tex4npm/texmf/` at build time.

## How this course is wired

`package.json` lists each pilot as a direct dependency; `node_modules/` contains symlinks back into the workspace so edits to a pilot show up on the next `npm run build` without a publish step. `tex4npm.config.js` points the build at `src/` and `dist/`.

Adding a new pilot to the demo is two lines: `npm install <pkg>` (or add a symlink and re-run `npm install`) and `\usepackage{<pkg>}` at the top of `sample.tex`.
