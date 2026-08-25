# tex4npm

A Node.js build tool that compiles a hierarchy of Ximera `.tex` files into `.html`, `.js`, and `.css` output. Modeled on the webpack developer experience: declare dependencies in `package.json`, configure via `tex4npm.config.js`, run via npm scripts.

---

## User-facing workflow

```
my-course/
├── package.json          # "build": "tex4npm build", "dev": "tex4npm watch"
├── tex4npm.config.js     # configuration
├── dist/                 # outDir — mirrors source hierarchy
├── main.tex              # \documentclass{xourse}
└── chapter1/
    └── section1.tex
```

```js
// tex4npm.config.js
export default {
  root: '.',        // where to search for .tex files
  outDir: 'dist',   // mirrors source hierarchy
  workers: 4,       // parallel compilation (default: cpu count / 2)
  clean: true,      // delete TeX temp files before each compile
  sage: true,       // run sage if .sagetex.sage is generated
  exclude: [],      // glob patterns to skip
};
```

CLI commands:
- `tex4npm build` — compile all dirty files
- `tex4npm watch` — incremental rebuilds on file change
- `tex4npm clean` — remove outDir and .tex4npm staging area

---

## External tool requirements

| Tool | Purpose |
|------|---------|
| `pdflatex` | First-pass LaTeX compilation (tikzexport, .aux generation) |
| `latex` | DVI-mode compilation with tex4ht.sty injection (HTML conversion passes) |
| `tex4ht` | Converts DVI → HTML using the .4ct/.4tc hook files |
| `t4ht` | Post-processes the .lg file: CSS output, image handling |
| `sage` | Optional: execute embedded SageMath computations |
| `ximera.cls` | LaTeX document class (built from `.dtx` sources in `ximera-core/latex/`) |

---

## Pre-build phase (runs once per `build` or `watch` invocation)

Before any `.tex` file is touched, tex4npm derives the build environment from the current state of `node_modules`. This replaces a postinstall hook — running it here guarantees consistency even if packages were added, removed, or updated without re-running `npm install`.

### Stage 1 — Scan for ximera packages

Use fast-glob to find all `package.json` files under `node_modules/` and filter to those with a `"ximera"` key. This takes a few milliseconds even in large projects.

```js
const manifests = await glob('node_modules/**/package.json', { absolute: true });
const ximeraPackages = (await Promise.all(manifests.map(readJson)))
  .filter(pkg => pkg.ximera);
```

### Stage 2 — Populate `.tex4npm/texmf/`

Clear `.tex4npm/texmf/tex/latex/` and link every `.sty` file declared in each ximera package's `ximera.sty` list into that directory, pointing back to the file's real location in `node_modules/`. This directory is wiped and rebuilt from scratch on every invocation so it cannot drift from `node_modules`.

Use a three-tier fallback to handle platform differences:

```js
function linkSty(src, dest) {
  try {
    fs.symlinkSync(src, dest);           // preferred: instant, reflects live edits to npm-linked packages
  } catch (e) {
    if (e.code !== 'EPERM') throw e;
    try {
      fs.linkSync(src, dest);            // Windows fallback: hard link, no elevated privileges needed
    } catch {
      fs.copyFileSync(src, dest);        // last resort: cross-drive or restricted fs (loses live-edit benefit)
    }
  }
}
```

Symlinks are the preferred path — they mean real-time edits to locally `npm link`ed packages are immediately visible to the compiler without re-running the pre-build phase. Hard links preserve the exact-mirror property but not live edits. Copies work everywhere but are a last resort.

### Stage 3 — Generate `.tex4npm/bundle-entry.js`

Write a synthetic JS entry point that imports every ximera package's JS entry point and every declared CSS file:

```js
// auto-generated — do not edit
import 'ximera-multiple-choice';
import 'ximera-graph-theory';
import 'ximera-multiple-choice/dist/multiple-choice.css';
import 'ximera-graph-theory/dist/graph-theory.css';
```

### Stage 4 — Run esbuild

Bundle `.tex4npm/bundle-entry.js` → `outDir/ximera.js` + `outDir/ximera.css`. Runs every invocation; esbuild is fast enough (sub-second) that incremental checking is not worth the complexity.

---

## Compilation pipeline (per `.tex` file)

All steps run with the working directory set to the `.tex` file's directory — a hard requirement from how TeX resolves relative paths.

### Step 1 — Discover eligible files

A `.tex` file is eligible if it contains `\begin{document}` (after stripping comments). No git-committed requirement (unlike the predecessor tool xake).

### Step 2 — Build dependency graph

Parse each eligible file for `\input{}`, `\activity{}`, `\include{}`, `\includeonly{}` references. Build a DAG, topologically sort it so dependencies compile before dependents. Propagate dirtiness: if B is dirty and A depends on B, A is also dirty.

### Step 3 — Dirty checking

Read the existing `outDir/.../file.html` and parse its `<meta name="dependency">` tags (one per file, format below). Recompute SHA1 hashes of the named files. If any hash differs (or if the `.html` doesn't exist), the file is dirty.

The dependency tags cover all files TeX actually read during the prior compilation — `.tex`, `.sty`, `.cls`, images — so a change to `macro.sty` is caught without any special-casing.

### Step 4 — Compile

All invocations run in the `.tex` file's directory with `TEXINPUTS=<repo-root>/.tex4npm/texmf//:<default>` injected.

**4a — pdflatex pass (tikzexport + .aux generation)**

```
pdflatex -recorder -file-line-error -shell-escape \
  "\PassOptionsToClass{tikzexport}{ximera}\PassOptionsToClass{xake}{ximera}\nonstopmode\input{stem}"
```

Check the resulting `stem.fls` OUTPUT lines: if `stem.sagetex.sage` appears, run `sage stem.sagetex.sage` then re-run pdflatex with `-recorder`.

**4b — latex passes with tex4ht.sty injection (HTML conversion)**

Rather than invoking `htlatex` or `make4ht` as wrappers, we call `latex` directly, reproducing the tex4ht.sty injection preamble extracted from the htlatex script. The config string (`ximera,charset=utf-8,-css`) is embedded via `\RequirePackage[config,html]{tex4ht}` hooked into `\@documentclasshook`:

```
latex -recorder -interaction=nonstopmode -shell-escape -file-line-error \
  "\makeatletter...\HCode ximera,charset=utf-8,-css.a.b.c.\input stem"
```

The full injection preamble (from the htlatex source) is a fixed string with the config substituted in; it is stored as a constant in `compile.js`.

Run this **twice**: the first pass generates `.4ct`/`.4tc` hook files; the second pass uses them to emit correct HTML markup into the DVI. A third pass (as htlatex does) improves cross-reference resolution — this is configurable (`passes: 2 | 3`, default `2`) and worth validating against real Ximera content. The `-recorder` flag is passed on each pass; the `.fls` is overwritten each time, so only the final pass's `.fls` is used.

**4c — tex4ht (DVI → HTML)**

```
tex4ht -f/stem -cunihtf -utf8
```

Reads the `.4ct`/`.4tc` files and the `.dvi` to produce `stem.html` (and possibly `.css` files). Writes `stem.lg`.

**4d — t4ht (post-processing)**

```
t4ht -f/stem
```

Reads `stem.lg` and handles CSS output, image processing, and other file generation.

### Step 5 — Collect artifacts and copy to outDir

Artifact tracking uses two sources, because `latex` and `tex4ht`/`t4ht` are separate binaries with separate output sets:

**From `stem.fls`** (final latex pass, `-recorder` output):
- INPUT lines → dependency metadata (Step 6)
- OUTPUT lines → latex-side temp files to delete (`.4ct`, `.4tc`, `.dvi`, `.aux`, `.log`, `.fls`, etc.)

**From `stem.lg`** (written by tex4ht, read by t4ht):
- Parse for output file declarations → this is the artifact manifest for HTML, CSS, SVG, PNG and any other files produced by tex4ht/t4ht. The exact `.lg` format needs to be confirmed against real output, but it is the authoritative record of what tex4ht produced.

Copy every artifact (from `.lg`) to mirrored outDir: `chapter1/section1.svg` → `dist/chapter1/section1.svg`. Relative paths inside the HTML (e.g. `<img src="section1-figure0.svg">`) remain valid because all artifacts for a given file land in the same mirrored directory.

### Step 6 — HTML post-processing (via cheerio)

Run on the HTML copy in outDir:

1. Remove all `<p></p>` empty paragraph elements
2. Parse the final latex pass's `.fls` INPUT lines; filter to files under the project `root` or `.tex4npm/texmf/` (drop system TeX paths like `/usr/share/texmf/…`). Compute SHA1 of each. Inject into `<head>` — one tag per file:
   ```html
   <meta name="dependency" content="a3f9c2... main.tex">
   <meta name="dependency" content="7b1e4d... chapter1/section1.tex">
   <meta name="dependency" content="f02c89... .tex4npm/texmf/tex/latex/macro.sty">
   ```
   Paths are relative to project root.
3. For xourse files (detected via `<meta name="description" content="xourse">`):
   - Remove spurious `<a id="...">` anchors inserted by htlatex
   - For each `<a class="activity" href="activity.tex">`: normalize the href, read the compiled `activity.html`, extract its `<title>` and `<div class="abstract">`, inject `<h2>` and `<h3>` inside the activity link

### Step 7 — Clean temp files from source directory

Two precise lists, no glob patterns needed:
- Delete OUTPUT lines from the final `stem.fls` that have temp extensions (`.4ct`, `.4tc`, `.dvi`, `.aux`, `.log`, `.fls`, etc.) — these are the latex-side intermediates
- Delete temp files named in `stem.lg` (tex4ht/t4ht intermediates such as `.idv`, `.lg` itself, etc.) after the `.lg` has been fully parsed

---

## Ximera npm packages

npm packages can serve as **dual LaTeX + web asset packages**. A package like `ximera-multiple-choice` defines the `\begin{multipleChoice}` LaTeX environment *and* ships the JavaScript that makes the rendered HTML elements interactive.

### Package convention

Ximera packages declare assets via a `"ximera"` field in `package.json`:

```json
{
  "name": "ximera-multiple-choice",
  "main": "dist/index.js",
  "ximera": {
    "sty": ["multiple-choice.sty"],
    "css": ["dist/multiple-choice.css"]
  }
}
```

The JS entry point uses the standard `"main"`/`"exports"` field — it is a regular npm module. The `"ximera"` field only needs to declare `.sty` and `.css` files that are not otherwise discoverable.

All installed ximera packages are always bundled — if it's in `package.json`, the author wants it.

### LaTeX path injection

When invoking pdflatex/htlatex, tex4npm sets:

```
TEXINPUTS=.tex4npm/texmf//:<original-TEXINPUTS>
```

This makes all staged `.sty` files findable without touching the system TeX installation. The `//` suffix means kpathsea searches recursively; the trailing `:` preserves the original search path.

---

## Concurrency model

`pdflatex` and `htlatex` are CPU-bound single-core processes. The p-queue concurrency limit is `Math.max(1, os.cpus().length / 2)` and it wraps **only the `execa` subprocess calls** — the pdflatex and htlatex invocations. Everything else (`.fls` parsing, artifact copying, SHA1 hashing, Cheerio post-processing, temp-file deletion) runs outside the queue immediately after the subprocess finishes, and is therefore unconstrained and concurrent across all in-flight files.

```js
// Only this is throttled:
const html = await queue.add(() => execa('htlatex', [...args], { cwd: sourceDir }));

// These run freely, concurrently across all files:
const artifacts = await parseFlsOutputs(flsPath);
await copyArtifacts(artifacts, outDir);
await postprocess(path.join(outDir, 'stem.html'));
```

This ensures the CPU cores are kept busy with TeX work while I/O-light steps never wait behind a compile that hasn't started yet.

---

## Source module layout

```
src/
├── cli.js          — commander CLI: build | watch | clean
├── config.js       — load and validate tex4npm.config.js
├── discover.js     — walk tree, find eligible .tex files
├── deps.js         — parse \input{}, \activity{}, \include{}, \includeonly{}
├── graph.js        — build DAG, topological sort, dirty propagation
├── dirty.js        — SHA1 dirty-check via <meta name="dependency"> in HTML
├── compile.js      — orchestrate pdflatex → sage? → pdflatex → htlatex for one file
├── artifacts.js    — parse .fls OUTPUT lines, copy artifacts to outDir, delete temp files
├── postprocess.js  — cheerio: remove <p></p>, inject deps, enrich xourse links
├── bundle.js       — esbuild integration for JS/CSS from ximera packages
├── stage.js        — pre-build: scan node_modules, populate .tex4npm/, generate bundle-entry.js
└── watch.js        — chokidar watcher → incremental rebuild loop
```

## Key dependencies

| Package | Purpose |
|---------|---------|
| `execa` | Run pdflatex, htlatex, sage as subprocesses |
| `cheerio` | Server-side HTML DOM manipulation for post-processing |
| `chokidar` | File watching for dev/watch mode |
| `esbuild` | Bundle JS and CSS from ximera npm packages |
| `p-queue` | Throttle execa subprocess calls only (default: `os.cpus().length / 2`); post-processing runs outside the queue |
| `commander` | CLI argument parsing |
| `fast-glob` | File discovery across the source tree |
