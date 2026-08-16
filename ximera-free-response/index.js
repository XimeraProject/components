// ximera-free-response — ungraded prose response.
//
// Answerable. "Submitted != correct": any non-empty submission sets
// complete: true, which unblocks downstream problems just like a
// graded-correct answer would (CONTRACT §5, PLAN.md §4 answerable rule).
// See specs/components/ximera-free-response.md.
//
// DOM at mount (from ximera.4ht's freeResponse environment):
//   <div class="free-response" id="problemN">…author prose…</div>

import { register, registerReducer, registerRender, focusGuardSyncValue }
  from 'ximera-core/kernel';

// ─── Reducers ──────────────────────────────────────────────────────────────

registerReducer('ximera-free-response:INPUT', (model, msg) => {
  const prev = model[msg.id] ?? {};
  if (prev.response === msg.value) return model;
  return { ...model, [msg.id]: { ...prev, response: msg.value } };
});

registerReducer('ximera-free-response:SUBMIT', (model, msg) => {
  const prev = model[msg.id] ?? {};
  const trimmed = (prev.response ?? '').trim();
  if (trimmed === '') return model;                          // no-op empty
  if (prev.submitted === true) return model;                 // already submitted
  return {
    ...model,
    [msg.id]: { ...prev, submitted: true, complete: true },
  };
});

// ─── Render ────────────────────────────────────────────────────────────────

registerRender('.free-response', (el, entry) => {
  el.dataset.state = entry.submitted ? 'submitted' : '';

  const ta = el.querySelector('textarea.ximera-free-response-input');
  if (ta) {
    focusGuardSyncValue(ta, entry.response);
    // Textarea stays editable post-submit — the learner may revise, but the
    // submitted/complete flag stays true (pedagogically: the submission is
    // what counts; further edits are the learner's own reflection).
  }

  const btn = el.querySelector('.ximera-submit-btn');
  if (btn) {
    btn.disabled = !!entry.submitted;
    btn.textContent = entry.submitted ? 'Submitted' : 'Submit';
  }
});

// ─── Mount ─────────────────────────────────────────────────────────────────

register('.free-response', (el, dispatch) => {
  if (!el.id) return;
  // Idempotence marker: textarea presence.
  if (el.querySelector('textarea.ximera-free-response-input')) return;

  const ta = document.createElement('textarea');
  ta.className = 'ximera-free-response-input';
  ta.setAttribute('aria-label', 'response');
  ta.setAttribute('rows', '5');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ximera-submit-btn';
  btn.textContent = 'Submit';
  btn.setAttribute('aria-label', 'submit response');

  ta.addEventListener('input', () => {
    dispatch({ type: 'ximera-free-response:INPUT', id: el.id, value: ta.value });
  });
  btn.addEventListener('click', () => {
    dispatch({ type: 'ximera-free-response:SUBMIT', id: el.id });
  });

  el.appendChild(ta);
  el.appendChild(btn);
}, { answerable: true });
