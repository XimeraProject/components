// ximera-select-all — checkbox-style multi-select with explicit Check.
//
// Answerable. Correct iff the chosen set equals the set of .choice.correct
// ids. Shuffle util shared with ximera-multiple-choice — same seeded
// deterministic order rules apply. See specs/components/ximera-select-all.md.
//
// DOM at mount:
//   <div class="select-all" id="problemN">
//     <span class="choice [correct]" id="choiceM">…</span>
//     …
//   </div>

import {
  register, registerReducer, registerRender, readModel,
  syncAnswerableState, createCheckButton, wireChoiceList,
} from 'ximera-core/kernel';
import { initShuffleAtMount, shuffleInitReducer } from 'ximera-choice-util';

// ─── Reducers ──────────────────────────────────────────────────────────────

registerReducer('ximera-select-all:TOGGLE', (model, msg) => {
  const prev = model[msg.problemId] ?? {};
  if (prev.correct === true) return model;                   // locked
  const chosen = prev.chosen ?? [];
  const next = chosen.includes(msg.choiceId)
    ? chosen.filter((id) => id !== msg.choiceId)
    : [...chosen, msg.choiceId];
  return {
    ...model,
    [msg.problemId]: { ...prev, chosen: next },
  };
});

registerReducer('ximera-select-all:CHECK', (model, msg) => {
  const prev = model[msg.problemId] ?? {};
  if (prev.correct === true) return model;
  const chosen = prev.chosen ?? [];
  if (chosen.length === 0) return model;

  const el = document.getElementById(msg.problemId);
  if (!el) return model;
  const correctIds = [...el.querySelectorAll('.choice.correct')].map((c) => c.id);
  const sortedChosen = [...chosen].sort();
  const sortedCorrect = [...correctIds].sort();
  const correct =
    sortedChosen.length === sortedCorrect.length &&
    sortedChosen.every((id, i) => id === sortedCorrect[i]);

  return {
    ...model,
    [msg.problemId]: {
      ...prev,
      checked: [...chosen],
      correct,
      complete: correct,
    },
  };
});

registerReducer('ximera-select-all:SHUFFLE_INIT', shuffleInitReducer());

// ─── Render ────────────────────────────────────────────────────────────────

registerRender('.select-all', (el, entry) => {
  const btn = el.querySelector('.ximera-check-btn');
  syncAnswerableState(el, entry, btn);

  const chosenSet = new Set(entry.chosen ?? []);
  el.querySelectorAll('.choice').forEach((choice) => {
    const cp = [];
    if (chosenSet.has(choice.id)) cp.push('selected');
    if (entry.correct) cp.push('revealed');
    choice.dataset.state = cp.join(' ');
    choice.setAttribute('aria-checked', chosenSet.has(choice.id) ? 'true' : 'false');
  });

  if (btn) btn.style.display = entry.correct ? 'none' : '';
});

// ─── Mount ─────────────────────────────────────────────────────────────────

register('.select-all', (el, dispatch) => {
  if (!el.id) return;
  if (el.querySelector('.ximera-check-btn')) return;

  initShuffleAtMount(el, {
    currentSeed: readModel()[el.id]?.seed,
    dispatch,
    msgType: 'ximera-select-all:SHUFFLE_INIT',
  });

  wireChoiceList(el, dispatch, {
    role: 'checkbox',
    buildMessage: (choiceId) => ({
      type: 'ximera-select-all:TOGGLE',
      problemId: el.id,
      choiceId,
    }),
  });

  el.appendChild(createCheckButton({
    dispatch,
    type: 'ximera-select-all:CHECK',
    extras: { problemId: el.id },
    variant: 'full',
  }));
}, { answerable: true });
