// Helpers for integration tests: load a compiled fixture HTML, extract the
// body, install it into happy-dom's document, and re-register components
// against the fresh kernel state.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, '..', '..', 'fixtures', 'dist');

// Read a compiled fixture's body content. tex4npm outputs a full <html>
// document; we only want the interactive content inside <body>.
export function readFixtureBody(stem) {
  const html = readFileSync(join(FIXTURES_DIR, `${stem}.html`), 'utf8');
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  if (!bodyMatch) throw new Error(`No <body> in ${stem}.html — was it compiled?`);
  return bodyMatch[1];
}

// Re-import a fresh copy of a component's index.js so its module-level
// register() calls fire again after resetKernel(). Returns the imported
// module (needed by ximera-answer for its mountReady() await).
export async function reloadComponent(pkgName) {
  const url = new URL(
    `../node_modules/${pkgName}/index.js`,
    import.meta.url
  ).href + `?c=${Math.random()}`;
  return import(url);
}

// Real MathJax typesets \cssId{placeholder-N}{\phantom{...}} into a DOM
// span with id="placeholder-N". Happy-dom doesn't run MathJax; ximera-answer's
// Phase B mount looks up that id and bails if absent. Call this before
// mountFixture() to synthesize an empty placeholder span for every answer
// state-holder in `body` — enough for the mount to install its input, button,
// and popover so integration tests can drive them.
export function simulateMathJaxPlaceholders(body) {
  // Match every data-placeholder-id="ID" on a .answer.respondable span and
  // inject <span id="ID"></span> into the enclosing .mathjax-inline or
  // .mathjax-block if the id isn't already present.
  const stateHolderRe = /<span[^>]*class="answer respondable"[^>]*data-placeholder-id="([^"]+)"[^>]*>/g;
  const ids = [];
  let m;
  while ((m = stateHolderRe.exec(body)) !== null) ids.push(m[1]);

  let out = body;
  for (const id of ids) {
    // Bare `id="…"` present as an attribute (not as the value of another
    // attribute like data-placeholder-id). The leading whitespace/quote
    // check discriminates between them.
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`[\\s"']id="${escaped}"`).test(out)) continue;
    const holder = `<span id="${id}"></span>`;
    out = out.replace(
      new RegExp(`(<span[^>]*data-placeholder-id="${escaped}")`),
      `${holder}$1`
    );
  }
  return out;
}
