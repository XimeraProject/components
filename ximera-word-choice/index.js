// ximera-word-choice — inline dropdown, single-select, immediate feedback.
//
// Answerable: selection IS the submission. Correct → complete → kernel
// propagates completion up. See specs/components/ximera-word-choice.md.
//
// DOM at mount (from ximera.4ht's multipleChoice@ variant):
//   <span class="word-choice" id="word-choiceN">
//     <span class="choice [correct]" id="choiceM">…</span>
//     …
//   </span>

import { register, registerReducer, registerRender } from 'ximera-core/kernel';

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
  const parts = [];
  if (entry.correct) parts.push('correct');
  else if (entry.checked != null) parts.push('attempted');
  el.dataset.state = parts.join(' ');

  const select = el.querySelector('select.ximera-word-select');
  if (select) {
    if (entry.chosen !== undefined && select.value !== entry.chosen) {
      select.value = entry.chosen;
    } else if (entry.chosen === undefined && select.value !== '') {
      select.value = '';
    }
    select.disabled = !!entry.correct;
  }
});

register('.word-choice', (el, dispatch) => {
  if (!el.id) return;
  // Idempotence marker: presence of the generated <select>.
  if (el.querySelector('select.ximera-word-select')) return;

  const choices = [...el.querySelectorAll('.choice')];
  const select = document.createElement('select');
  select.className = 'ximera-word-select';
  select.setAttribute('aria-label', 'answer');

  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '—';
  select.appendChild(blank);

  for (const choice of choices) {
    if (!choice.id) continue;
    const opt = document.createElement('option');
    opt.value = choice.id;
    opt.textContent = choice.textContent.trim();
    select.appendChild(opt);
  }

  // Hide the original .choice spans — they remain in the DOM as the read-only
  // answer key (D9 guardrail 1). The select is what the learner interacts with.
  for (const choice of choices) {
    choice.style.display = 'none';
  }

  el.prepend(select);

  select.addEventListener('change', () => {
    if (!select.value) return;
    dispatch({
      type: 'ximera-word-choice:SELECT',
      problemId: el.id,
      choiceId: select.value,
    });
  });
}, { answerable: true });
