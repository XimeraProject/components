// ximera-chrome xourse hook — runs on xourse landing pages and scoped copies
// during tex4npm's materialize phase. tex4npm handles the mechanical work
// (manifest, path rewriting, canonical link, dep meta stripping); this hook
// layers the visible chrome inside .ximera-content.
//
// Contract: default export is an object with { injectLanding, injectScoped }.
// Both are `async ($, ctx) => void`.

import path from 'path';

export default {
  injectLanding,
  injectScoped,
};

// Landing-page enrichment: for each activity anchor inside .ximera-content,
// append <h2>title</h2><h3>abstract</h3> from the manifest.
//
// ctx: { manifest, outDir, htmlPath, depth }
export async function injectLanding($, ctx) {
  const { manifest } = ctx;
  const $container = ensureContainer($);

  setCourseTitle($, manifest.title ?? manifest.xourse);

  const byPath = new Map();
  for (const part of manifest.parts) {
    for (const a of part.activities) byPath.set(a.path, a);
  }

  $container.find('a.activity[href]').each((_, el) => {
    const $el = $(el);
    // tex4npm has already rewritten href to `{xourse}/{path}.html`.
    const href = $el.attr('href');
    const key = hrefToActivityPath(href, manifest.xourse);
    const a = byPath.get(key);
    if (!a) return;
    if ($el.find('h2').length === 0) {
      // Strip the original text (activity stem, e.g. "demo") so only the
      // enriched title/abstract show. Idempotent-safe: on a second run,
      // the h2 check above short-circuits before we touch the DOM.
      $el.contents().filter((_, node) => node.type === 'text').remove();
      if (a.title)    $el.append(`<h2>${titleMarkup(a, a.path)}</h2>`);
      if (a.abstract) $el.append(`<h3>${a.abstract}</h3>`);
    }
  });
}

// Scoped-copy chrome: inject breadcrumb, left TOC, and bottom pager inside
// .ximera-content. Adds `data-xourse-layout` on the content element so CSS
// switches to the 2-column grid.
//
// ctx: { manifest, activityPath, prev, next, outDir, htmlPath, depth }
export async function injectScoped($, ctx) {
  const { manifest, activityPath, prev, next, depth } = ctx;
  const $container = ensureContainer($);
  $container.attr('data-xourse-layout', '');

  setCourseTitle($, manifest.title ?? manifest.xourse);

  const meta = new Map();
  for (const part of manifest.parts) {
    for (const a of part.activities) meta.set(a.path, a);
  }

  const up = '../'.repeat(depth);
  const landingHref = `${up}${manifest.xourse}.html`;

  // Body children are the activity content. Move them into a .xourse-body
  // so the grid places them in the right column next to the sticky TOC.
  // Ordering inside .xourse-body: breadcrumb, activity content, pager.
  const $activity = $container.contents();
  const $body = $('<div class="xourse-body"></div>');
  $body.append(renderBreadcrumb(manifest, activityPath, meta, landingHref));
  $body.append($activity);
  $body.append(renderPager(activityPath, prev, next, meta));
  $container.append(renderToc(manifest, activityPath, meta));
  $container.append($body);
}

// Write the course/xourse title into the navbar slot injected by postprocess.
// When no chrome shell is present (bare tests), silently skip.
function setCourseTitle($, title) {
  if (!title) return;
  const $slot = $('.ximera-course-title');
  if ($slot.length === 0) return;
  $slot.text(title);
  $slot.removeAttr('data-empty');
}

// The manifest anchor rewrite gave us `{xourse}/{path}.html`. Turn that back
// into `{path}` for lookup against manifest.byPath.
function hrefToActivityPath(href, xourseStem) {
  if (!href) return null;
  const prefix = `${xourseStem}/`;
  let s = href.startsWith(prefix) ? href.slice(prefix.length) : href;
  return s.replace(/\.html$/, '');
}

function ensureContainer($) {
  let $c = $('main.ximera-content');
  if ($c.length > 0) return $c;
  // Chrome postprocess didn't run (bare page) — fall back to <body>.
  return $('body');
}

function renderBreadcrumb(manifest, activityPath, meta, landingHref) {
  const parts = [
    `<a href="${escapeAttr(landingHref)}">${titleMarkup(manifest, manifest.xourse)}</a>`,
    `<span class="xourse-crumb-current">${titleMarkup(meta.get(activityPath), activityPath)}</span>`,
  ];
  return `<nav class="xourse-breadcrumb" aria-label="Breadcrumb">${parts.join('<span class="xourse-crumb-sep"> › </span>')}</nav>`;
}

function renderToc(manifest, activityPath, _meta) {
  const parts = manifest.parts.map(part => {
    const items = part.activities.map(a => {
      const label = titleMarkup(a, a.path);
      const isCurrent = a.path === activityPath;
      const stateAttr = isCurrent ? ' data-state="current"' : '';
      if (isCurrent) {
        return `<li${stateAttr}><span>${label}</span></li>`;
      }
      const href = relPathBetween(activityPath, a.path);
      return `<li${stateAttr}><a href="${escapeAttr(href)}">${label}</a></li>`;
    }).join('');
    const heading = part.title ? `<h4 class="xourse-toc-part">${titleMarkup(part, part.title)}</h4>` : '';
    return `${heading}<ol class="xourse-toc-list">${items}</ol>`;
  }).join('');
  return `<aside class="xourse-toc" aria-label="Table of contents">${parts}</aside>`;
}

function renderPager(activityPath, prev, next, meta) {
  const prevBlock = prev
    ? `<a class="xourse-prev" href="${escapeAttr(relPathBetween(activityPath, prev))}">` +
        `<span class="xourse-pager-label">Previous</span>` +
        `<span class="xourse-pager-title">${titleMarkup(meta.get(prev), prev)}</span>` +
      '</a>'
    : '<span class="xourse-prev xourse-pager-empty"></span>';
  const nextBlock = next
    ? `<a class="xourse-next" href="${escapeAttr(relPathBetween(activityPath, next))}">` +
        `<span class="xourse-pager-label">Next</span>` +
        `<span class="xourse-pager-title">${titleMarkup(meta.get(next), next)}</span>` +
      '</a>'
    : '<span class="xourse-next xourse-pager-empty"></span>';
  return `<nav class="xourse-pager" aria-label="Activity navigation">${prevBlock}${nextBlock}</nav>`;
}

// Relative URL from one scoped-copy activity to another. Both paths are
// outDir-relative activity stems (e.g. "demo" or "chapter1/section1"); the
// scoped copies live at outDir/{xourse}/{path}.html so a same-dir sibling is
// just "sibling.html". Uses POSIX separators for URLs.
export function relPathBetween(fromActivity, toActivity) {
  const fromDir = path.posix.dirname(fromActivity);
  const rel = path.posix.relative(fromDir, `${toActivity}.html`);
  return rel || `./${path.posix.basename(toActivity)}.html`;
}

// Title markup for a manifest item (activity or part). Prefer titleHtml —
// tex4ht-rendered HTML that preserves inline math as MathJax markup — and use
// it verbatim. Fall back to the escaped plain-text title, then the fallback
// (e.g. the activity path) when no title was compiled.
function titleMarkup(item, fallback) {
  if (item?.titleHtml) return item.titleHtml;
  return escapeHtml(item?.title ?? fallback);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s);
}
