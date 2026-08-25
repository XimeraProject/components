// ximera-chrome runtime entry — hydrates the navbar progress bar from
// `.problem-environment[data-state]` values that ximera-core sets on render.
// The kernel already tracks progress internally (progress.js); we mirror that
// number into the visible bar by observing DOM state changes.

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
    const topLevel = topLevelProblems();
    if (topLevel.length === 0) {
      // No problems on page — hide the bar entirely rather than showing 100%.
      bar.style.display = 'none';
      return;
    }
    const complete = topLevel.filter(el => el.dataset.state === 'complete').length;
    const pct = Math.round((complete / topLevel.length) * 100);
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

function topLevelProblems() {
  return [...document.querySelectorAll('.problem-environment')]
    .filter(el => !el.parentElement?.closest('.problem-environment'));
}
