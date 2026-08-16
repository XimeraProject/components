// my-button — click-N-to-complete graded button.
//
// Reference third-party graded component. Full participation in the kernel
// contract: registered as answerable, click reducer, model-driven render,
// persistence via identity, reset via RESET_WORK.
//
// DOM at mount (from my-button.4ht):
//   <button class="ximera-button" id="ximera-button-K" data-count="N">label</button>

import { register, registerReducer, registerRender } from 'ximera-core/kernel';

// ─── Reducer ───────────────────────────────────────────────────────────────

registerReducer('my-button:CLICK', (model, msg) => {
  const prev = model[msg.id] ?? { clicks: 0 };
  if (prev.complete === true) return model;                 // idempotent after complete
  const clicks = (prev.clicks ?? 0) + 1;
  const complete = clicks >= msg.count;
  return { ...model, [msg.id]: { ...prev, clicks, complete } };
});

// ─── Render ────────────────────────────────────────────────────────────────

registerRender('.ximera-button', (el, entry) => {
  const count = Number(el.dataset.count) || 1;
  const label = el.dataset.labelText ?? '';
  const clicks = entry.clicks ?? 0;

  if (entry.complete) {
    el.textContent = `${label} (${count}/${count})`;
    el.dataset.state = 'complete';
    el.disabled = true;
  } else if (clicks > 0) {
    el.textContent = `${label} (${clicks}/${count})`;
    el.dataset.state = 'progress';
    el.disabled = false;
  } else {
    el.textContent = label;
    el.dataset.state = '';
    el.disabled = false;
  }
});

// ─── Mount ─────────────────────────────────────────────────────────────────

register('.ximera-button', (el, dispatch) => {
  if (!el.id) return;
  // Idempotence marker: data-label-text captures the author-provided label
  // on first mount; presence is our re-mount guard.
  if (el.dataset.labelText === undefined) {
    el.dataset.labelText = el.textContent.trim();
  }

  const count = Number(el.dataset.count) || 1;
  el.addEventListener('click', () => {
    dispatch({ type: 'my-button:CLICK', id: el.id, count });
  });
}, { answerable: true });
