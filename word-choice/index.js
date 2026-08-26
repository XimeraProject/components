// ximera-word-choice — inline custom dropdown, single-select, immediate feedback.
//
// Uses a custom <span>-based dropdown instead of a native <select> so that
// MathJax-rendered HTML inside .choice spans is preserved in the options and
// in the selected-value display. Native <select>/<option> only accept plain
// text, which loses all math rendering.
//
// DOM at mount (from ximera.4ht's multipleChoice@ variant):
//   <span class="word-choice" id="word-choiceN">
//     <span class="choice [correct]" id="choiceM">…</span>
//     …
//   </span>
//
// After mount:
//   <span class="word-choice" id="word-choiceN">
//     <span class="ximera-word-select" role="combobox" …>
//       <span class="ximera-word-select__display">…</span>
//       <span class="ximera-word-select__arrow" aria-hidden>▾</span>
//       <span class="ximera-word-select__panel" role="listbox" hidden>
//         <span class="ximera-word-option" role="option" data-choice-id="choiceM">…</span>
//         …
//       </span>
//     </span>
//     <span class="choice …" id="choiceM" style="display:none">…</span>
//     …
//   </span>

import {
  register, registerReducer, registerRender, syncAnswerableState,
} from '@ximera/core/kernel';

registerReducer('ximera-word-choice:SELECT', (model, msg) => {
  const prev = model[msg.problemId] ?? {};
  if (prev.correct === true) return model;              // locked (CONTRACT §7 rule 4)
  const choiceEl = document.getElementById(msg.choiceId);
  const correct = choiceEl?.classList.contains('correct') ?? false;
  return {
    ...model,
    [msg.problemId]: {
      ...prev,
      chosen: msg.choiceId,
      checked: msg.choiceId,
      correct,
      complete: correct,
    },
  };
});

registerRender('.word-choice', (el, entry) => {
  syncAnswerableState(el, entry);

  const widget = el.querySelector('.ximera-word-select');
  if (!widget) return;

  const display = widget.querySelector('.ximera-word-select__display');
  const panel = widget.querySelector('.ximera-word-select__panel');

  // Reflect chosen option in the display element.
  if (display) {
    if (entry.chosen !== undefined) {
      const choiceEl = document.getElementById(entry.chosen);
      if (choiceEl) display.innerHTML = choiceEl.innerHTML;
    } else {
      display.textContent = '—';
    }
  }

  // Sync aria-selected and data-chosen.
  panel?.querySelectorAll('.ximera-word-option').forEach(opt => {
    opt.setAttribute('aria-selected', opt.dataset.choiceId === entry.chosen ? 'true' : 'false');
  });
  widget.dataset.chosen = entry.chosen ?? '';

  // Lock when correct.
  const locked = !!entry.correct;
  widget.setAttribute('aria-disabled', locked ? 'true' : 'false');
  if (locked) widget.removeAttribute('tabindex');
  else widget.setAttribute('tabindex', '0');
});

register('.word-choice', (el, dispatch) => {
  if (!el.id) return;
  if (el.querySelector('.ximera-word-select')) return;  // idempotent

  const choices = [...el.querySelectorAll('.choice')];

  // ── Build widget ─────────────────────────────────────────────────────────

  const widget = document.createElement('span');
  widget.className = 'ximera-word-select';
  widget.setAttribute('role', 'combobox');
  widget.setAttribute('aria-haspopup', 'listbox');
  widget.setAttribute('aria-expanded', 'false');
  widget.setAttribute('aria-disabled', 'false');
  widget.setAttribute('tabindex', '0');
  widget.dataset.chosen = '';

  const display = document.createElement('span');
  display.className = 'ximera-word-select__display';
  display.textContent = '—';

  const arrow = document.createElement('span');
  arrow.className = 'ximera-word-select__arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '▾';

  const panel = document.createElement('span');
  panel.className = 'ximera-word-select__panel';
  panel.setAttribute('role', 'listbox');
  panel.hidden = true;

  for (const choice of choices) {
    if (!choice.id) continue;
    const opt = document.createElement('span');
    opt.className = 'ximera-word-option';
    opt.setAttribute('role', 'option');
    opt.setAttribute('aria-selected', 'false');
    opt.setAttribute('tabindex', '-1');
    opt.dataset.choiceId = choice.id;
    opt.innerHTML = choice.innerHTML;    // preserves MathJax-rendered content
    panel.appendChild(opt);
  }

  widget.appendChild(display);
  widget.appendChild(arrow);
  widget.appendChild(panel);

  for (const choice of choices) choice.style.display = 'none';

  el.prepend(widget);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const isLocked = () => widget.getAttribute('aria-disabled') === 'true';

  function openPanel() {
    if (isLocked()) return;
    panel.hidden = false;
    widget.setAttribute('aria-expanded', 'true');
    panel.querySelector('.ximera-word-option')?.focus();
  }

  function closePanel() {
    panel.hidden = true;
    widget.setAttribute('aria-expanded', 'false');
  }

  function choose(choiceId) {
    closePanel();
    dispatch({ type: 'ximera-word-choice:SELECT', problemId: el.id, choiceId });
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  // Trigger: click opens/closes panel (but not when clicking inside the panel).
  widget.addEventListener('click', (e) => {
    if (panel.contains(e.target)) return;
    if (panel.hidden) openPanel();
    else closePanel();
  });

  // Options: click selects.
  panel.addEventListener('click', (e) => {
    const opt = e.target.closest('.ximera-word-option');
    if (opt?.dataset.choiceId) choose(opt.dataset.choiceId);
  });

  // Trigger keyboard: Enter/Space toggles, ArrowDown opens, Escape closes.
  widget.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (panel.hidden) openPanel(); else closePanel();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (panel.hidden) openPanel();
    } else if (e.key === 'Escape') {
      closePanel();
    }
  });

  // Panel keyboard: arrows navigate, Enter/Space selects, Escape returns to trigger.
  panel.addEventListener('keydown', (e) => {
    const opts = [...panel.querySelectorAll('.ximera-word-option')];
    const idx = opts.indexOf(document.activeElement);
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const focused = document.activeElement;
      if (focused?.dataset.choiceId) choose(focused.dataset.choiceId);
    } else if (e.key === 'Escape') {
      closePanel();
      widget.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      opts[Math.min(idx + 1, opts.length - 1)]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx === 0) { closePanel(); widget.focus(); }
      else opts[idx - 1]?.focus();
    }
  });

  // Close when clicking outside.
  document.addEventListener('click', (e) => {
    if (!widget.contains(e.target)) closePanel();
  });

}, { answerable: true });
