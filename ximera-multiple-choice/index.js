// ximera-multiple-choice — radio-style single-select with explicit Check.
//
// Answerable. Correct on Check → complete → kernel propagates. Wrong
// answers are recorded in a `wrong` map for the render to visually
// eliminate. When the outer .multiple-choice has the .shuffle class
// (either on itself or on an ancestor), choices are permuted at mount
// time by a deterministic Fisher–Yates seeded from entry.seed — the
// seed is persisted, so a learner's saved answer id lands on the same
// choice on reload. See specs/components/ximera-multiple-choice.md.
//
// DOM at mount:
//   <div class="multiple-choice" id="problemN" [data-id="..."]>
//     <span class="choice [correct]" [data-value="..."] id="choiceM">…</span>
//     …
//   </div>

import {
  register, registerReducer, registerRender, readModel,
  syncAnswerableState, createCheckButton, wireChoiceList,
} from 'ximera-core/kernel';
import { initShuffleAtMount, shuffleInitReducer } from 'ximera-choice-util';

// ─── Reducers ──────────────────────────────────────────────────────────────

registerReducer('ximera-multiple-choice:SELECT', (model, msg) => {
  const prev = model[msg.problemId] ?? {};
  if (prev.correct === true) return model;                     // locked
  if (prev.chosen === msg.choiceId) return model;              // no-op re-click
  return {
    ...model,
    [msg.problemId]: { ...prev, chosen: msg.choiceId },
  };
});

registerReducer('ximera-multiple-choice:CHECK', (model, msg) => {
  const prev = model[msg.problemId] ?? {};
  if (!prev.chosen) return model;
  if (prev.correct === true) return model;                     // already locked
  const choiceEl = document.getElementById(prev.chosen);
  const correct = choiceEl?.classList.contains('correct') ?? false;
  const wrong = { ...(prev.wrong ?? {}) };
  if (!correct) wrong[prev.chosen] = true;
  return {
    ...model,
    [msg.problemId]: {
      ...prev,
      checked: prev.chosen,
      correct,
      complete: correct,
      wrong,
    },
  };
});

registerReducer('ximera-multiple-choice:SHUFFLE_INIT', shuffleInitReducer());

// ─── Render ────────────────────────────────────────────────────────────────

registerRender('.multiple-choice', (el, entry) => {
  const btn = el.querySelector('.ximera-check-btn');
  syncAnswerableState(el, entry, btn);

  el.querySelectorAll('.choice').forEach((choice) => {
    const cp = [];
    if (choice.id === entry.chosen) cp.push('selected');
    if (entry.wrong?.[choice.id]) cp.push('eliminated');
    if (entry.correct) cp.push('revealed');
    choice.dataset.state = cp.join(' ');
    choice.setAttribute('aria-checked', choice.id === entry.chosen ? 'true' : 'false');
  });

  if (btn) btn.style.display = entry.correct ? 'none' : '';
});

// ─── Mount ─────────────────────────────────────────────────────────────────

register('.multiple-choice', (el, dispatch) => {
  if (!el.id) return;
  // Idempotence marker: presence of the Check button.
  if (el.querySelector('.ximera-check-btn')) return;

  initShuffleAtMount(el, {
    currentSeed: readModel()[el.id]?.seed,
    dispatch,
    msgType: 'ximera-multiple-choice:SHUFFLE_INIT',
  });

  wireChoiceList(el, dispatch, {
    role: 'radio',
    buildMessage: (choiceId) => ({
      type: 'ximera-multiple-choice:SELECT',
      problemId: el.id,
      choiceId,
    }),
  });

  el.appendChild(createCheckButton({
    dispatch,
    type: 'ximera-multiple-choice:CHECK',
    extras: { problemId: el.id },
    variant: 'full',
  }));
}, { answerable: true });
