# ximera-core LaTeX sources

`ximera.dtx` is the docstrip driver; `src/*.dtx` contain the modular
class + tex4ht definitions. Running `make` extracts them into `dist/`:

- `dist/ximera.cls`, `dist/xourse.cls` — LaTeX document classes
- `dist/ximera.4ht`, `dist/xourse.4ht` — tex4ht configuration
- `dist/ximera.cfg` — tex4ht runtime config

These outputs are **gitignored** and produced on demand. From the
`ximera-core/` root:

    npm run build:latex

`tex4npm` reads the `latex.cls`/`latex.4ht`/`latex.cfg` arrays in
`ximera-core/package.json` and symlinks the `dist/` files into a
per-course TeX tree at build time — so `dist/` must exist before
`cd my-course && npm run build` is run.

For downstream consumers installing via npm, `package.json`'s
`prepare` hook builds `dist/` automatically at `npm pack` /
`npm publish` time; the tarball ships the compiled artifacts, not
the `.dtx` sources.

## Requirements

`pdflatex`, `makeindex`, and the tex4ht package must be on `PATH`.
Install via TeX Live (`tlmgr install tex4ht` if not already
present).
