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
// register() calls fire again after resetKernel().
export async function reloadComponent(pkgName) {
  const url = new URL(
    `../node_modules/${pkgName}/index.js`,
    import.meta.url
  ).href + `?c=${Math.random()}`;
  await import(url);
}
