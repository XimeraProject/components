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

import { register, registerReducer, registerRender, readModel } from 'ximera-core/kernel';
import { shuffleIds, generateSeed } from 'ximera-choice-util';

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

registerReducer('ximera-multiple-choice:SHUFFLE_INIT', (model, msg) => {
  const prev = model[msg.problemId] ?? {};
  if (prev.seed !== undefined) return model;
  return { ...model, [msg.problemId]: { ...prev, seed: msg.seed } };
});

// ─── Render ────────────────────────────────────────────────────────────────

registerRender('.multiple-choice', (el, entry) => {
  const parts = [];
  if (entry.correct) parts.push('correct');
  else if (entry.checked != null) parts.push('attempted');
  el.dataset.state = parts.join(' ');

  el.querySelectorAll('.choice').forEach((choice) => {
    const cp = [];
    if (choice.id === entry.chosen) cp.push('selected');
    if (entry.wrong?.[choice.id]) cp.push('eliminated');
    if (entry.correct) cp.push('revealed');
    choice.dataset.state = cp.join(' ');
    choice.setAttribute('aria-checked', choice.id === entry.chosen ? 'true' : 'false');
  });

  const btn = el.querySelector('.ximera-check-btn');
  if (btn) btn.style.display = entry.correct ? 'none' : '';
});

// ─── Mount ─────────────────────────────────────────────────────────────────

register('.multiple-choice', (el, dispatch) => {
  if (!el.id) return;
  // Idempotence marker: presence of the Check button.
  if (el.querySelector('.ximera-check-btn')) return;

  // Shuffle setup. .shuffle on the element itself OR on an ancestor
  // opts into deterministic per-learner permutation.
  const wantsShuffle =
    el.classList.contains('shuffle') || el.closest('.shuffle') !== null;

  if (wantsShuffle) {
    // The entry is what the kernel has after the initial reduce — it may
    // already carry a seed from persisted state. If not, generate one and
    // dispatch SHUFFLE_INIT so it lands in the model and persists.
    const currentEntry = readModel()[el.id] ?? {};
    const seed = currentEntry.seed ?? generateSeed();
    if (currentEntry.seed === undefined) {
      dispatch({ type: 'ximera-multiple-choice:SHUFFLE_INIT', problemId: el.id, seed });
    }
    permuteChoicesInPlace(el, seed);
  }

  // Wire choice clicks.
  el.querySelectorAll('.choice').forEach((choice) => {
    if (!choice.id) return;
    choice.setAttribute('role', 'radio');
    choice.setAttribute('tabindex', '0');
    choice.setAttribute('aria-checked', 'false');
    const select = () => dispatch({
      type: 'ximera-multiple-choice:SELECT',
      problemId: el.id,
      choiceId: choice.id,
    });
    choice.addEventListener('click', select);
    choice.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select();
      }
    });
  });

  el.setAttribute('role', 'radiogroup');

  // Check button.
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ximera-check-btn';
  btn.textContent = 'Check';
  btn.setAttribute('aria-label', 'check answer');
  btn.addEventListener('click', () => {
    dispatch({ type: 'ximera-multiple-choice:CHECK', problemId: el.id });
  });
  el.appendChild(btn);
}, { answerable: true });

// ─── Helpers ───────────────────────────────────────────────────────────────

// Reorder .choice children of el in place per the seeded shuffle. Runs
// exactly once at mount; render never touches DOM order (guardrail 2:
// renders are pure projections).
function permuteChoicesInPlace(el, seed) {
  const choices = [...el.querySelectorAll('.choice')].filter((c) => c.id);
  if (choices.length <= 1) return;
  const originalOrder = choices.map((c) => c.id);
  const shuffledOrder = shuffleIds(originalOrder, seed);
  // Re-append in shuffled order. appendChild moves the node — no clone.
  const parent = choices[0].parentNode;
  for (const id of shuffledOrder) {
    const c = document.getElementById(id);
    if (c && c.parentNode === parent) parent.appendChild(c);
  }
}

