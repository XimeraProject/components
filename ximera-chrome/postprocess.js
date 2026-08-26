// ximera-chrome canonical postprocess hook — runs on every compiled HTML page.
// Wraps existing <body> children in <main class="ximera-content"> and adds a
// sticky navbar + full-width footer around it. Xourse landing/scoped hooks
// (xourse.js) then set the course title in the navbar and inject breadcrumb /
// TOC / pager INSIDE .ximera-content.
//
// Contract (tex4npm CONTRACT §15): default export is `async ($, ctx) => void`.
// ctx: { htmlPath, projectRoot, outDir }.

import { config } from './config.js';

export default async function postprocess($, _ctx) {
  if ($('main.ximera-content').length > 0) return; // idempotent

  ensureHead($);

  const $body = $('body');
  const bodyChildren = $body.contents();
  const $main = $('<main class="ximera-content"></main>');
  $main.append(bodyChildren);
  $body.empty();
  $body.append(renderHeader());
  $body.append($main);
  $body.append(renderFooter());

  hoistMacros($body, $main);
}

// Move the \newcommand block (ximera-core emits it as a hidden
// <div class="xmjax-macros">) to the very top of <body>, ahead of all chrome.
// MathJax applies a \newcommand only to math that appears later in document
// order, and the xourse hooks (xourse.js) inject breadcrumb / TOC / pager
// titles ABOVE the activity content where the block lives — so without this
// those titles would render before their macros (e.g. \RR) are defined.
// It must be moved, not copied: a duplicate \newcommand block makes MathJax
// error with "already defined".
function hoistMacros($body, $main) {
  const $macros = $main.find('.xmjax-macros').first();
  if ($macros.length > 0) $body.prepend($macros);
}

// Inject font preconnect + stylesheet into <head>. Idempotent by marker id.
function ensureHead($) {
  const $head = $('head');
  if ($head.length === 0) return;
  if ($head.find('#ximera-chrome-fonts').length > 0) return;
  $head.append(
    '<link rel="preconnect" href="https://fonts.googleapis.com">' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '<link id="ximera-chrome-fonts" rel="stylesheet" href="' +
      'https://fonts.googleapis.com/css2?' +
      'family=IBM+Plex+Sans:wght@400;600&' +
      'family=IBM+Plex+Mono:wght@400;600&display=swap' +
    '">'
  );
}

export function renderHeader() {
  return (
    '<header class="ximera-header">' +
      '<nav class="ximera-nav" aria-label="Site">' +
        `<span class="ximera-brand" role="img" aria-label="${escapeAttr(config.projectName)}">` +
          `<span class="ximera-logo">${config.logoSvg}</span>` +
          `<span class="ximera-project-name">${escapeHtml(config.projectName)}</span>` +
        '</span>' +
        '<span class="ximera-course-title" data-empty=""></span>' +
        '<div class="ximera-nav-controls">' +
          '<div id="ximera-progress" class="ximera-progress" role="progressbar" ' +
            'aria-label="Course progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
            '<span class="ximera-progress-label">Progress</span>' +
            '<span class="ximera-progress-track"><span class="ximera-progress-fill"></span></span>' +
            '<span class="ximera-progress-value">0%</span>' +
          '</div>' +
          '<div id="ximera-page-controls" class="ximera-page-controls"></div>' +
          '<div id="ximera-user" class="ximera-slot"></div>' +
        '</div>' +
      '</nav>' +
    '</header>'
  );
}

export function renderFooter() {
  const links = config.footerLinks
    .map(({ label, href }) => `<a href="${escapeAttr(href)}">${escapeHtml(label)}</a>`)
    .join('');
  return (
    '<footer class="ximera-footer">' +
      `<span class="ximera-footer-mark" aria-hidden="true">${config.logoSvg}</span>` +
      '<div class="ximera-footer-inner">' +
        `<div class="ximera-footer-links">${links}</div>` +
        `<div class="ximera-footer-note">${escapeHtml(config.footerNote)}</div>` +
      '</div>' +
    '</footer>'
  );
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
