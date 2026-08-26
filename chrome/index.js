// ximera-chrome runtime entry — drives the navbar progress bar entirely from
// the `.problem-environment[data-state]` values ximera-core sets on render.
// This is a local, Modulus-independent stand-in: the number it shows mirrors
// what ximera-core computes in progress.js (recursive average of `complete`
// over the problem tree), so page progress works whether or not a Modulus
// backend is connected.

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrateProgress, { once: true });
  } else {
    hydrateProgress();
  }
}

function hydrateProgress() {
  const bar = document.getElementById('ximera-progress');
  if (!bar) return;

  const fill = bar.querySelector('.ximera-progress-fill');
  const value = bar.querySelector('.ximera-progress-value');
  if (!fill) return;

  function update() {
    const progress = pageProgress();
    if (progress === null) {
      // No problems on page — hide the bar entirely rather than showing 100%.
      bar.style.display = 'none';
      return;
    }
    const pct = Math.round(progress * 100);
    fill.style.width = `${pct}%`;
    if (value) value.textContent = `${pct}%`;
    bar.setAttribute('aria-valuenow', String(pct));
  }

  update();

  // React to state changes anywhere in the tree — ximera-core toggles
  // data-state on .problem-environment as answers come in.
  const observer = new MutationObserver(update);
  for (const el of document.querySelectorAll('.problem-environment')) {
    observer.observe(el, { attributes: true, attributeFilter: ['data-state'] });
  }
}

// Recursive average of `complete` over the top-level problem tree, matching
// ximera-core/progress.js. Returns [0,1], or null when the page has no
// problems (so the caller can hide the bar).
function pageProgress() {
  const topLevel = topLevelProblems();
  if (topLevel.length === 0) return null;
  const total = topLevel.reduce((sum, el) => sum + nodeProgress(el), 0);
  return total / topLevel.length;
}

function nodeProgress(el) {
  const children = childProblems(el);
  const self = isComplete(el) ? 1 : 0;
  if (children.length === 0) return self;
  const childSum = children.reduce((sum, c) => sum + nodeProgress(c), 0);
  return (childSum + self) / (children.length + 1);
}

function topLevelProblems() {
  return [...document.querySelectorAll('.problem-environment')]
    .filter(el => !el.parentElement?.closest('.problem-environment'));
}

function childProblems(el) {
  return [...el.querySelectorAll('.problem-environment')]
    .filter(child => child.parentElement?.closest('.problem-environment') === el);
}

// data-state is a space-joined token list (e.g. "available complete"), so test
// for the token rather than string-equality against the whole attribute.
function isComplete(el) {
  return (el.dataset.state ?? '').split(/\s+/).includes('complete');
}
