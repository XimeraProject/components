import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { load } from 'cheerio';
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
  const abstract = $('div.abstract').html()?.trim() ?? null;

  // Walk the body in document order. `.card.part h1` opens a new part,
  // `a.activity` accumulates under the current part. Activities before any
  // part live under an implicit part with title: null.
  const parts = [];
  let current = { title: null, activities: [] };

  const bodyChildren = $('body').find('h1.card.part, a.activity[href]').toArray();
  for (const el of bodyChildren) {
    const $el = $(el);
    if ($el.is('h1.card.part')) {
      // Close the current part if it has content or a non-null title.
      if (current.activities.length > 0 || current.title !== null) {
        parts.push(current);
      }
      current = { title: $el.text().trim(), activities: [] };
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
        a.abstract = $a('div.abstract').html()?.trim() ?? null;
      } catch {
        console.warn(`  ! xourse ${xourseStem}: activity ${a.path} has no compiled HTML at ${activityHtmlPath}`);
        a.title = null;
        a.abstract = null;
      }
    }
  }

  const flatOrder = parts.flatMap(p => p.activities.map(a => a.path));

  return { xourse: xourseStem, title, abstract, parts, flatOrder };
}

// Write manifest as JSON alongside the xourse landing page.
export async function writeManifest(manifest, outDir) {
  const target = path.join(outDir, `${manifest.xourse}.manifest.json`);
  await writeFile(target, JSON.stringify(manifest, null, 2) + '\n');
}

// Mutate the loaded xourse HTML (cheerio $) into the landing page:
// - populate <title> from manifest.title
// - inject <h2>title</h2><h3>abstract</h3> inside each activity anchor
// - rewrite each activity anchor's href to point at the xourse-scoped copy
export function renderLandingPage($, manifest) {
  removeSpuriousAnchors($);

  if (manifest.title) {
    if ($('title').length === 0) $('head').append('<title></title>');
    $('title').text(manifest.title);
  }

  // Build a map path -> activity meta for quick lookup during anchor rewrite.
  const byPath = new Map();
  for (const part of manifest.parts) {
    for (const a of part.activities) byPath.set(a.path, a);
  }

  $('a.activity[href]').each((_, el) => {
    const $el = $(el);
    const rawHref = $el.attr('href');
    if (!rawHref) return;
    // The href here is source-relative (with or without .tex); normalize by
    // dropping .tex and treating as manifest key. The manifest already used
    // srcDir-relative paths, so this matches.
    const key = rawHref.replace(/\.tex$/, '');
    const a = byPath.get(key);
    if (!a) return;

    // Inject title / abstract inside the anchor.
    if (a.title && $el.find('h2').length === 0) $el.append(`<h2>${a.title}</h2>`);
    if (a.abstract && $el.find('h3').length === 0) $el.append(`<h3>${a.abstract}</h3>`);

    // Rewrite href to the xourse-scoped copy: `{xourse}/{path}.html`.
    $el.attr('href', `${manifest.xourse}/${a.path}.html`);
  });
}

// Emit one xourse-scoped copy per activity in the manifest.
// For each activity at outDir/{path}.html, write outDir/{xourse}/{path}.html
// with nav injected and asset paths rewritten for the extra directory depth.
export async function emitScopedCopies(manifest, outDir) {
  const xourseStem = manifest.xourse;
  const flat = manifest.flatOrder;

  // Build metadata lookup for nav labels.
  const meta = new Map();
  for (const part of manifest.parts) {
    for (const a of part.activities) meta.set(a.path, a);
  }

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

    rewriteRelativePaths($);

    // Strip build-time dependency metadata from scoped copy.
    $('meta[name="dependency"]').remove();

    // Depth of the scoped copy relative to outDir: xourse + activityPath dirname.
    // Path up to outDir: number of separators in `${xourseStem}/${activityPath}` minus filename.
    const scopedRel = path.join(xourseStem, `${activityPath}.html`);
    const scopedDir = path.dirname(scopedRel);
    const upToOut = path.relative(path.join(outDir, scopedDir), outDir) || '.';

    // Canonical link to the xourse-free copy.
    $('head').append(
      `<link rel="canonical" href="${path.posix.join(upToOut.split(path.sep).join('/'), `${activityPath}.html`)}">`
    );

    // Nav: breadcrumb + prev/next.
    const prev = i > 0 ? flat[i - 1] : null;
    const next = i + 1 < flat.length ? flat[i + 1] : null;
    const nav = [];
    const upSlash = upToOut.split(path.sep).join('/');
    nav.push(`<a href="${path.posix.join(upSlash, `${xourseStem}.html`)}" class="xourse-crumb">${escapeHtml(manifest.title ?? xourseStem)}</a>`);
    if (prev) {
      const prevMeta = meta.get(prev) ?? {};
      const prevHref = relPath(activityPath, prev);
      nav.push(`<a href="${prevHref}" class="xourse-prev">← ${escapeHtml(prevMeta.title ?? prev)}</a>`);
    }
    if (next) {
      const nextMeta = meta.get(next) ?? {};
      const nextHref = relPath(activityPath, next);
      nav.push(`<a href="${nextHref}" class="xourse-next">${escapeHtml(nextMeta.title ?? next)} →</a>`);
    }
    $('body').prepend(`<nav class="xourse-nav">\n  ${nav.join('\n  ')}\n</nav>`);

    // Write to outDir/{xourse}/{activityPath}.html
    const target = path.join(outDir, xourseStem, `${activityPath}.html`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, $.html());
  }
}

// Compute a same-xourse relative link from one activity path to another.
// Both are outDir-relative (no leading slash, no .html). The scoped copies
// live at outDir/{xourse}/{path}.html, so we compute the path from the
// current activity's directory to the target activity's file.
function relPath(fromActivity, toActivity) {
  const fromDir = path.dirname(fromActivity);
  const toFile = `${toActivity}.html`;
  const rel = path.relative(fromDir, toFile);
  // Ensure POSIX separators for URLs.
  return rel.split(path.sep).join('/') || `./${path.basename(toFile)}`;
}

// Rewrite href/src attributes that are relative (not absolute URLs or
// data:/mailto:/#anchor) by prepending "../" to account for the extra
// directory depth of a xourse-scoped copy.
export function rewriteRelativePaths($) {
  const isSkipped = (val) => (
    !val ||
    val.startsWith('http://') ||
    val.startsWith('https://') ||
    val.startsWith('//') ||
    val.startsWith('/') ||
    val.startsWith('#') ||
    val.startsWith('mailto:') ||
    val.startsWith('data:')
  );

  const rewrite = (el, attr) => {
    const val = $(el).attr(attr);
    if (isSkipped(val)) return;
    $(el).attr(attr, `../${val}`);
  };

  $('link[href]').each((_, el) => rewrite(el, 'href'));
  $('script[src]').each((_, el) => rewrite(el, 'src'));
  $('img[src]').each((_, el) => rewrite(el, 'src'));
  $('source[src]').each((_, el) => rewrite(el, 'src'));
  $('a[href]').each((_, el) => rewrite(el, 'href'));
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// Top-level orchestration: scan outDir for compiled xourse HTMLs, and for
// each one produce a manifest, a landing page, scoped copies, and a JSON
// manifest file.
//
// projectRoot: the project's config.root (source directory).
// outDir: the project's config.outDir.
export async function materialize(projectRoot, outDir) {
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
    await writeFile(htmlPath, $.html());
    await emitScopedCopies(manifest, outDir);
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
