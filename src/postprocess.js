import { readFile, writeFile } from 'fs/promises';
import { load } from 'cheerio';
import { pathToFileURL } from 'url';
import path from 'path';
import { hashFile } from './dirty.js';

// Run all post-processing steps on an HTML file already copied to outDir.
// Modifies the file in place. Component-specific transforms (extracting
// \answer blanks, MathJax extensions, blocking-problem detection) moved to
// their owning component packages in Phase 4 (D3, D5); tex4npm now runs
// only generic HTML shaping and dispatches to registered package hooks.
export async function postprocess(htmlPath, flsInputs, projectRoot, outDir, {
  xmjaxPath,
  xmcssPath,
  packages = [],
} = {}) {
  // tex4ht outputs CSS counter declarations (env/counter names) before the
  // <?xml ...?> preamble as part of its t4ht pipeline; strip them so cheerio
  // doesn't drag them into <body> as visible text.
  const raw = (await readFile(htmlPath, 'utf8')).replace(/^[^<]+/, '');
  const $ = load(raw);

  ensureCharset($);
  removeEmptyParas($);
  await injectDependencyMeta($, flsInputs, projectRoot);
  if (xmjaxPath) await injectXmjax($, xmjaxPath);
  if (xmcssPath) await injectXmcss($, xmcssPath);
  stripOldXimeraScripts($);

  // Package-provided postprocess hooks (Phase 4, D5). Each hook is an ES
  // module whose default export is `async ($, ctx) => void`. Hooks run in
  // package-discovery order; ordering guarantees between hooks are not part
  // of the contract, so hooks MUST be independent.
  const ctx = { htmlPath, projectRoot, outDir };
  for (const pkg of packages) {
    for (const rel of pkg.postprocess ?? []) {
      const mod = await import(pathToFileURL(path.join(pkg.dir, rel)).href);
      await mod.default($, ctx);
    }
  }

  injectBundleRefs($, htmlPath, outDir);

  await writeFile(htmlPath, $.html());
}

// Guarantee <meta charset="utf-8"> is the first child of <head>.
// tex4ht emits its own charset declaration inline in the body stream, which
// means cheerio ends up with an empty or late-declared charset — browsers
// default to Latin-1 and mojibake curly quotes / em-dashes.
export function ensureCharset($) {
  $('meta[http-equiv="Content-Type"]').remove();
  if (!$('meta[charset]').length) $('head').prepend('<meta charset="utf-8">');
}

// Remove <p></p> elements (empty inner HTML after trimming).
export function removeEmptyParas($) {
  $('p').each((_, el) => {
    if ($(el).html().trim() === '') $(el).remove();
  });
}

// Inject one <meta name="dependency" content="HASH relpath"> per input file.
// relpath is relative to projectRoot so it is stable regardless of outDir location.
export async function injectDependencyMeta($, flsInputs, projectRoot) {
  for (const absPath of flsInputs) {
    let hash;
    try {
      hash = await hashFile(absPath);
    } catch {
      continue; // file disappeared between compile and postprocess
    }
    const relPath = path.relative(projectRoot, absPath);
    $('head').append(`<meta name="dependency" content="${hash} ${relPath}">`);
  }
}

// Read the .xmjax file produced by ximera.cls and inject filtered \newcommand
// definitions inside a hidden \(...\) block so MathJax 3+ processes them and
// the definitions become globally available for math elsewhere on the page.
// (The legacy <script type="math/tex"> idiom is a MathJax 2 mechanism that
// MathJax 3+ no longer honours.)
//
// The .xmjax stream includes tex4ht-oriented definitions whose bodies contain
// literal HTML (`\HCode {<span>...</span>}`). Those angle brackets have to be
// entity-escaped before they land inside our <div>, otherwise the browser
// parses them as real tags and splits the math text node — MathJax then never
// sees a matching `\)` and silently skips the whole block.
export async function injectXmjax($, xmjaxPath) {
  let raw;
  try {
    raw = await readFile(xmjaxPath, 'utf8');
  } catch {
    return;
  }
  const filtered = filterXmjaxCommands(raw);
  if (!filtered.trim()) return;
  const escaped = filtered
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  $('div.preamble').prepend(
    `<div class="xmjax-macros" style="display:none">\\(\n${escaped}\n\\)</div>`,
  );
}

// Keep only \newcommand, \DeclareMathOperator, and \newenvironment lines that
// don't contain sequences known to cause MathJax errors, then normalise ##N→#N.
export function filterXmjaxCommands(raw) {
  const lines = raw.split('\n')
    .filter(l => !/[:*@]/.test(l))
    .filter(l => !l.includes('\\_'))
    .filter(l => !l.includes('\\TU'))
    .filter(l => !l.includes('\\T1'))
    .filter(l => !l.includes('\\?'))
    .filter(l => !l.includes('\\label'))
    .filter(l =>
      l.startsWith('\\newcommand {') ||
      l.startsWith('\\DeclareMathOperator') ||
      l.startsWith('\\newenvironment')
    );
  return lines.join('\n').replace(/##(\d)/g, '#$1');
}

// Read the .xmcss file produced by \xmCSS{} calls in ximera.cfg and inject it
// as <style type="text/css"> inside div.preamble. Used for minipage sizing and
// other layout rules that tex4ht can't express inline.
export async function injectXmcss($, xmcssPath) {
  let raw;
  try {
    raw = await readFile(xmcssPath, 'utf8');
  } catch {
    return;
  }
  if (!raw.trim()) return;
  const css = raw.replace(/\\%/g, '%');
  $('div.preamble').append(`<style type="text/css">\n${css}\n</style>`);
}

// Remove the old ximera.osu.edu CDN <script> and <link> tags injected by ximera.cfg.
// These belong to the old jQuery/xake system; the new ximera.js bundle replaces them.
export function stripOldXimeraScripts($) {
  $('link[href*="ximera.osu.edu"]').remove();
  $('script[src*="ximera.osu.edu"]').remove();
}

// Inject <link> and <script defer> tags pointing to the ximera.js/css bundle.
// Paths are relative from the HTML file's location to outDir.
export function injectBundleRefs($, htmlPath, outDir) {
  const htmlDir = path.dirname(htmlPath);
  const jsRel = path.relative(htmlDir, path.join(outDir, 'ximera.js'));
  const cssRel = path.relative(htmlDir, path.join(outDir, 'ximera.css'));
  $('head').append(`<link rel="stylesheet" href="${cssRel}">`);
  $('body').append(`<script defer src="${jsRel}"></script>`);
}

