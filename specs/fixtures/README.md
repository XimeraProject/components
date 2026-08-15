# Fixtures

Compilable `.tex` sources — one per row of the v1 roster in `PLAN.md` §4. Each fixture is the mount target for its component's conformance tests (see the spec's Examples section under `specs/components/<name>.md`) and, in Phase 5, becomes the golden-file oracle when the LaTeX macros migrate out of `ximeraLatex/` into per-package `.sty` files.

## Building

```
cd specs/fixtures
npm install       # first time only — symlinks tex4npm and ximera-core from the workspace
npm run build     # compiles every *.tex into dist/*.html
```

External tools on `PATH`: `pdflatex`, `latex`, `tex4ht`, `t4ht`. `ximera.cls` MUST be installed in the user's texmf tree (see `ximeraLatex/installingLocally.md`).

## Fixtures

| File | Component | What it exercises |
|---|---|---|
| `ximera-hint.tex` | `ximera-hint` | Three hints in a single problem; per-hint reveal; document-order pedagogy |
| `ximera-word-choice.tex` | `ximera-word-choice` | Inline single-select dropdown embedded in prose |
| `ximera-multiple-choice.tex` | `ximera-multiple-choice` | Explicit-check radio group with one correct choice |
| `ximera-select-all.tex` | `ximera-select-all` | Checkbox multi-select with two correct choices |
| `ximera-free-response.tex` | `ximera-free-response` | Ungraded prose response |
| `ximera-feedback.tex` | `ximera-feedback` | Attempt + correct feedback siblings under one problem |
| `ximera-answer.tex` | `ximera-answer` | Integer answer + float-with-tolerance answer; nested problems for propagation |

## Notes

- The fixtures use only stock `ximeraLatex` macros. They do not `\usepackage{ximera-hint}` or similar — those npm packages own their JavaScript, but the LaTeX macros (`\begin{hint}`, `\wordChoice{…}`, `\begin{multipleChoice}`, etc.) come from `ximera.cls` today. Phase 5 optionally migrates macros into per-package `.sty` files; when it does, this workspace's `package.json` will grow those dependencies.
- The `\answer[format=…,tolerance=…]{…}` options are silently dropped by the current `ximera.4ht` emission (only the value survives). Phase 4 (owner: `ximera-answer/postprocess.js`) adds the `data-format` / `data-tolerance` pass-through by parsing the `.tex` source alongside the compiled HTML. Fixtures record the *authored* form; the DOM they produce today lacks those attributes.
