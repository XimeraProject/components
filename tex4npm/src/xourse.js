import { readFile, writeFile, mkdir, readdir, copyFile } from 'fs/promises';
import { load } from 'cheerio';
import { pathToFileURL } from 'url';
import path from 'path';

// Detect xourse files by the meta tag ximera.cls injects via htlatex.
export function isXourseHtml($) {
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

// Parse a compiled xourse HTML document (cheerio $) into a manifest describing
// the ordered activity list, split into parts.
//
// - xourseStem: the xourse's basename without .html (e.g. "all")
// - srcDir: absolute path to the directory containing the source xourse .tex
// - outDir: absolute path to the compiled dist/ directory
//
// Each activity is enriched with title + abstract read from its canonical
// compiled HTML in outDir.
export async function parseManifest($, xourseStem, srcDir, outDir) {
  const title = ($('meta[name="title"]').attr('content') ?? '').trim() || null;
  const titleHtml = extractTitleHtml($);
  const abstract = $('div.abstract').html()?.trim() ?? null;

  // Walk the body in document order. `.card.part h1` opens a new part,
  // `a.activity` accumulates under the current part. Activities before any
  // part live under an implicit part with title: null.
  const parts = [];
  let current = { title: null, titleHtml: null, activities: [] };

  const bodyChildren = $('body').find('h1.card.part, a.activity[href]').toArray();
  for (const el of bodyChildren) {
    const $el = $(el);
    if ($el.is('h1.card.part')) {
      // Close the current part if it has content or a non-null title.
      if (current.activities.length > 0 || current.title !== null) {
        parts.push(current);
      }
      current = { title: $el.text().trim(), titleHtml: $el.html()?.trim() || null, activities: [] };
    } else if ($el.is('a.activity')) {
      const rawHref = $el.attr('href');
      if (!rawHref) continue;
      // Normalize: resolve relative to srcDir, then make relative to srcDir
      // and drop trailing .tex.
      const absSrc = path.resolve(srcDir, rawHref);
      const relFromRoot = path.relative(srcDir, absSrc).replace(/\.tex$/, '');
      const activityPath = relFromRoot;
      current.activities.push({ path: activityPath, options: $el.attr('data-options') ?? '' });
    }
  }
  // Push the trailing part (implicit or last-labelled).
  if (current.activities.length > 0 || current.title !== null) {
    parts.push(current);
  }

  // Enrich each activity with title + abstract from its canonical HTML.
  for (const part of parts) {
    for (const a of part.activities) {
      const activityHtmlPath = path.join(outDir, `${a.path}.html`);
      try {
        const raw = await readFile(activityHtmlPath, 'utf8');
        const $a = load(raw);
        a.title = $a('title').text().trim() || null;
        a.titleHtml = extractTitleHtml($a);
        a.abstract = $a('div.abstract').html()?.trim() ?? null;
      } catch {
        console.warn(`  ! xourse ${xourseStem}: activity ${a.path} has no compiled HTML at ${activityHtmlPath}`);
        a.title = null;
        a.titleHtml = null;
        a.abstract = null;
      }
    }
  }

  const flatOrder = parts.flatMap(p => p.activities.map(a => a.path));

  return { xourse: xourseStem, title, titleHtml, abstract, parts, flatOrder };
}

// The class emits the activity/xourse title into a hidden
// <div class="ximera-title"> (see title.dtx) so tex4ht renders any inline
// math as MathJax markup — the head <title>/<meta> tags are plain-text only.
// Return the title's inner HTML (unwrapping tex4ht's <h1 class="titleHead">
// shell) so chrome can place the markup in its own elements, or null if the
// element is absent.
function extractTitleHtml($doc) {
  const $div = $doc('div.ximera-title');
  if ($div.length === 0) return null;
  const $h1 = $div.find('h1.titleHead').first();
  const html = $h1.length > 0 ? $h1.html() : $div.html();
  return html?.trim() || null;
}

// Write manifest as JSON alongside the xourse landing page.
export async function writeManifest(manifest, outDir) {
  const target = path.join(outDir, `${manifest.xourse}.manifest.json`);
  await writeFile(target, JSON.stringify(manifest, null, 2) + '\n');
}

// Mutate the loaded xourse HTML (cheerio $) into the landing page:
// - populate <title> from manifest.title
// - rewrite each activity anchor's href to point at the xourse-scoped copy
//
// Visible chrome (activity-card h2/h3 enrichment, layout) belongs to a chrome
// package that provides a `latex.xourse` hook — see materialize() below.
export function renderLandingPage($, manifest) {
  removeSpuriousAnchors($);

  if (manifest.title) {
    if ($('title').length === 0) $('head').append('<title></title>');
    $('title').text(manifest.title);
  }

  // Rewrite each activity anchor's href to `{xourse}/{path}.html`. The
  // href here is source-relative (with or without .tex); normalize by
  // dropping .tex and looking it up in the manifest.
  const known = new Set();
  for (const part of manifest.parts) {
    for (const a of part.activities) known.add(a.path);
  }
  $('a.activity[href]').each((_, el) => {
    const $el = $(el);
    const rawHref = $el.attr('href');
    if (!rawHref) return;
    const key = rawHref.replace(/\.tex$/, '');
    if (!known.has(key)) return;
    $el.attr('href', `${manifest.xourse}/${key}.html`);
  });
}

// Emit one xourse-scoped copy per activity in the manifest.
// For each activity at outDir/{path}.html, write outDir/{xourse}/{path}.html
// with dep meta stripped, canonical link added, and relative asset paths
// rewritten for the extra directory depth. Visible chrome (breadcrumb, TOC,
// pager) is layered by chrome-package hooks; this function only does the
// mechanical work and invokes the hooks.
export async function emitScopedCopies(manifest, outDir, scopedHooks = []) {
  const xourseStem = manifest.xourse;
  const flat = manifest.flatOrder;

  for (let i = 0; i < flat.length; i++) {
    const activityPath = flat[i];
    const canonicalHtml = path.join(outDir, `${activityPath}.html`);
    let raw;
    try {
      raw = await readFile(canonicalHtml, 'utf8');
    } catch {
      console.warn(`  ! xourse ${xourseStem}: cannot read canonical HTML for ${activityPath}`);
      continue;
    }
    const $ = load(raw);

    const target = path.join(outDir, xourseStem, `${activityPath}.html`);
    await copyImagesForScopedCopy(path.dirname(canonicalHtml), path.dirname(target), $);

    rewriteRelativePaths($);

    // Strip build-time dependency metadata from scoped copy.
    $('meta[name="dependency"]').remove();

    // Depth of the scoped copy relative to outDir. The scoped copy lives at
    // outDir/{xourse}/{activityPath}.html, so depth is 1 for a flat path
    // like "demo" and 1 + (nesting of activityPath) for nested paths.
    const scopedDir = path.dirname(path.join(xourseStem, `${activityPath}.html`));
    const upToOut = path.relative(path.join(outDir, scopedDir), outDir) || '.';
    const depth = upToOut === '.' ? 0 : upToOut.split(path.sep).length;

    // Canonical link to the xourse-free copy.
    $('head').append(
      `<link rel="canonical" href="${path.posix.join(upToOut.split(path.sep).join('/'), `${activityPath}.html`)}">`
    );

    // Dispatch chrome-package hooks. Each hook receives the same ctx.
    const prev = i > 0 ? flat[i - 1] : null;
    const next = i + 1 < flat.length ? flat[i + 1] : null;
    const ctx = { manifest, activityPath, prev, next, depth, outDir, htmlPath: target };
    for (const hook of scopedHooks) {
      await hook($, ctx);
    }

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, $.html());
  }
}

// Copy every <img src> referenced by $ from canonicalDir into scopedDir,
// preserving the relative path so <img src> attributes need no rewriting.
export async function copyImagesForScopedCopy(canonicalDir, scopedDir, $) {
  const srcs = new Set();
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src && !isAbsoluteOrSpecial(src)) srcs.add(src);
  });
  for (const src of srcs) {
    const srcPath = path.resolve(canonicalDir, src);
    const destPath = path.resolve(scopedDir, src);
    await mkdir(path.dirname(destPath), { recursive: true });
    try {
      await copyFile(srcPath, destPath);
    } catch {
      // image missing from canonical build — skip silently
    }
  }
}

function isAbsoluteOrSpecial(val) {
  return (
    !val ||
    val.startsWith('http://') ||
    val.startsWith('https://') ||
    val.startsWith('//') ||
    val.startsWith('/') ||
    val.startsWith('#') ||
    val.startsWith('mailto:') ||
    val.startsWith('data:')
  );
}

// Rewrite href/src attributes that are relative (not absolute URLs or
// data:/mailto:/#anchor) by prepending "../" to account for the extra
// directory depth of a xourse-scoped copy.
// Images (<img src>) are excluded: they are copied alongside the scoped HTML
// by copyImagesForScopedCopy(), so their paths need no adjustment.
export function rewriteRelativePaths($) {
  const rewrite = (el, attr) => {
    const val = $(el).attr(attr);
    if (isAbsoluteOrSpecial(val)) return;
    $(el).attr(attr, `../${val}`);
  };

  $('link[href]').each((_, el) => rewrite(el, 'href'));
  $('script[src]').each((_, el) => rewrite(el, 'src'));
  $('img[src]').each((_, el) => rewrite(el, 'src'));
  $('source[src]').each((_, el) => rewrite(el, 'src'));
  $('a[href]').each((_, el) => rewrite(el, 'href'));
}

// Load each package.latex.xourse module and split its default export into
// injectLanding/injectScoped hook arrays. A hook module's default export is
// either an object with { injectLanding?, injectScoped? } (per D5 for
// xourse-aware chrome) or a single async function that acts on any page.
async function loadXourseHooks(packages) {
  const landing = [];
  const scoped = [];
  for (const pkg of packages) {
    for (const rel of pkg.xourse ?? []) {
      const mod = await import(pathToFileURL(path.join(pkg.dir, rel)).href);
      const def = mod.default;
      if (!def) continue;
      if (typeof def === 'function') {
        landing.push(def);
        scoped.push(def);
      } else {
        if (typeof def.injectLanding === 'function') landing.push(def.injectLanding);
        if (typeof def.injectScoped === 'function') scoped.push(def.injectScoped);
      }
    }
  }
  return { landing, scoped };
}

// Top-level orchestration: scan outDir for compiled xourse HTMLs, and for
// each one produce a manifest, a landing page, scoped copies, and a JSON
// manifest file.
//
// projectRoot: the project's config.root (source directory).
// outDir: the project's config.outDir.
// packages: latex packages discovered by stage(); their `.xourse` field
//   lists chrome hooks to invoke on landing pages and scoped copies.
export async function materialize(projectRoot, outDir, packages = []) {
  const { landing: landingHooks, scoped: scopedHooks } = await loadXourseHooks(packages);
  const xourses = await findXourseHtmls(outDir);
  for (const htmlPath of xourses) {
    const raw = await readFile(htmlPath, 'utf8');
    const $ = load(raw);
    if (!isXourseHtml($)) continue;

    const relFromOut = path.relative(outDir, htmlPath);
    const xourseStem = relFromOut.replace(/\.html$/, '');
    // srcDir mirrors outDir hierarchy.
    const srcDir = path.dirname(path.join(projectRoot, relFromOut));

    const manifest = await parseManifest($, xourseStem, srcDir, outDir);
    await writeManifest(manifest, outDir);
    renderLandingPage($, manifest);

    // Dispatch chrome-package landing hooks. Landing pages sit at outDir
    // root, so depth = 0.
    const landingCtx = { manifest, outDir, htmlPath, depth: 0 };
    for (const hook of landingHooks) {
      await hook($, landingCtx);
    }

    await writeFile(htmlPath, $.html());
    await emitScopedCopies(manifest, outDir, scopedHooks);
    console.log(`  ✓ materialized xourse ${xourseStem} (${manifest.flatOrder.length} activities)`);
  }
}

// Recursively find every .html file under outDir whose <meta description>
// marks it as a xourse.
async function findXourseHtmls(outDir) {
  const results = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        try {
          const raw = await readFile(full, 'utf8');
          if (raw.includes('name="description" content="xourse"')) {
            results.push(full);
          }
        } catch {
          // skip unreadable files
        }
      }
    }
  }
  await walk(outDir);
  return results;
}
