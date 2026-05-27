import { readFile, writeFile } from 'fs/promises';
import { load } from 'cheerio';
import path from 'path';
import { hashFile } from './dirty.js';

// Run all post-processing steps on an HTML file already copied to outDir.
// Modifies the file in place.
export async function postprocess(htmlPath, flsInputs, projectRoot, outDir, { xmjaxPath, xmcssPath } = {}) {
  const $ = load(await readFile(htmlPath, 'utf8'));

  removeEmptyParas($);
  await injectDependencyMeta($, flsInputs, projectRoot);
  if (xmjaxPath) await injectXmjax($, xmjaxPath);
  if (xmcssPath) await injectXmcss($, xmcssPath);

  if (isXourse($)) {
    removeSpuriousAnchors($);
    await enrichActivityLinks($, htmlPath, projectRoot, outDir);
  }

  await writeFile(htmlPath, $.html());
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

// Detect xourse files by the meta tag ximera.cls injects via htlatex.
export function isXourse($) {
  return $('meta[name="description"][content="xourse"]').length > 0;
}

// htlatex inserts bare <a id="..."> anchors with no href or class.
// Unwrap them in place, preserving any child content.
export function removeSpuriousAnchors($) {
  $('a[id]').each((_, el) => {
    if (!$(el).attr('href') && !$(el).attr('class')) {
      $(el).replaceWith($(el).contents());
    }
  });
}

// Read the .xmjax file produced by ximera.cls and inject filtered \newcommand
// definitions as <script type="math/tex"> inside div.preamble so MathJax can
// render custom commands in the browser.
export async function injectXmjax($, xmjaxPath) {
  let raw;
  try {
    raw = await readFile(xmjaxPath, 'utf8');
  } catch {
    return;
  }
  const filtered = filterXmjaxCommands(raw);
  if (!filtered.trim()) return;
  $('div.preamble').prepend(`<script type="math/tex">\n${filtered}\n</script>`);
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

// For each <a class="activity" href="something.tex"> in a xourse file:
//   - resolve the href relative to the mirrored source path
//   - normalize it to projectRoot-relative without .tex extension
//   - read the compiled activity HTML and inject <h2>title</h2><h3>abstract</h3>
export async function enrichActivityLinks($, htmlPath, projectRoot, outDir) {
  // Map htmlPath back to its source directory through the mirrored hierarchy.
  const srcDir = path.dirname(
    path.join(projectRoot, path.relative(outDir, htmlPath))
  );

  for (const el of $('a.activity[href]').toArray()) {
    const href = $(el).attr('href');
    if (!href.endsWith('.tex')) continue;

    const absSrc = path.resolve(srcDir, href);
    const relSrc = path.relative(projectRoot, absSrc);

    // Normalize href: relative to projectRoot, no .tex extension
    $(el).attr('href', relSrc.replace(/\.tex$/, ''));

    // Read the compiled activity HTML to extract title and abstract
    const activityHtmlPath = path.join(outDir, relSrc.replace(/\.tex$/, '.html'));
    let activityHtml;
    try {
      activityHtml = await readFile(activityHtmlPath, 'utf8');
    } catch {
      continue; // activity not yet compiled, skip enrichment
    }

    const $a = load(activityHtml);
    const title = $a('title').text().trim();
    const abstract = $a('div.abstract').html()?.trim() ?? '';

    if (title) $(el).append(`<h2>${title}</h2>`);
    if (abstract) $(el).append(`<h3>${abstract}</h3>`);
  }
}
