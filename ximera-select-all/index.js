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

import { register, registerReducer, registerRender, readModel } from 'ximera-core/kernel';
import { shuffleIds, generateSeed } from 'ximera-choice-util';

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

registerReducer('ximera-select-all:SHUFFLE_INIT', (model, msg) => {
  const prev = model[msg.problemId] ?? {};
  if (prev.seed !== undefined) return model;
  return { ...model, [msg.problemId]: { ...prev, seed: msg.seed } };
});

// ─── Render ────────────────────────────────────────────────────────────────

registerRender('.select-all', (el, entry) => {
  const parts = [];
  if (entry.correct) parts.push('correct');
  else if (entry.checked != null) parts.push('attempted');
  el.dataset.state = parts.join(' ');

  const chosenSet = new Set(entry.chosen ?? []);
  el.querySelectorAll('.choice').forEach((choice) => {
    const cp = [];
    if (chosenSet.has(choice.id)) cp.push('selected');
    if (entry.correct) cp.push('revealed');
    choice.dataset.state = cp.join(' ');
    choice.setAttribute('aria-checked', chosenSet.has(choice.id) ? 'true' : 'false');
  });

  const btn = el.querySelector('.ximera-check-btn');
  if (btn) btn.style.display = entry.correct ? 'none' : '';
});

// ─── Mount ─────────────────────────────────────────────────────────────────

register('.select-all', (el, dispatch) => {
  if (!el.id) return;
  if (el.querySelector('.ximera-check-btn')) return;

  const wantsShuffle =
    el.classList.contains('shuffle') || el.closest('.shuffle') !== null;

  if (wantsShuffle) {
    const currentEntry = readModel()[el.id] ?? {};
    const seed = currentEntry.seed ?? generateSeed();
    if (currentEntry.seed === undefined) {
      dispatch({ type: 'ximera-select-all:SHUFFLE_INIT', problemId: el.id, seed });
    }
    permuteChoicesInPlace(el, seed);
  }

  el.setAttribute('role', 'group');

  el.querySelectorAll('.choice').forEach((choice) => {
    if (!choice.id) return;
    choice.setAttribute('role', 'checkbox');
    choice.setAttribute('tabindex', '0');
    choice.setAttribute('aria-checked', 'false');
    const toggle = () => dispatch({
      type: 'ximera-select-all:TOGGLE',
      problemId: el.id,
      choiceId: choice.id,
    });
    choice.addEventListener('click', toggle);
    choice.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  });

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ximera-check-btn';
  btn.textContent = 'Check';
  btn.setAttribute('aria-label', 'check answer');
  btn.addEventListener('click', () => {
    dispatch({ type: 'ximera-select-all:CHECK', problemId: el.id });
  });
  el.appendChild(btn);
}, { answerable: true });

// ─── Helpers ───────────────────────────────────────────────────────────────

function permuteChoicesInPlace(el, seed) {
  const choices = [...el.querySelectorAll('.choice')].filter((c) => c.id);
  if (choices.length <= 1) return;
  const originalOrder = choices.map((c) => c.id);
  const shuffledOrder = shuffleIds(originalOrder, seed);
  const parent = choices[0].parentNode;
  for (const id of shuffledOrder) {
    const c = document.getElementById(id);
    if (c && c.parentNode === parent) parent.appendChild(c);
  }
}
