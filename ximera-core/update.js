import { getElementState, setElementState } from './model.js';
import Expression from 'math-expressions';

export function update(model, msg) {
  switch (msg.type) {

    case 'PAGE_STATE_RESTORED':
      return initializeAvailability(msg.pageState);

    case 'AGENT_READY_OFFLINE':
      return initializeAvailability(model);

    case 'ANSWER_INPUT':
      return setElementState(model, msg.id, { response: msg.value });

    case 'ANSWER_CHECK': {
      const state = getElementState(model, msg.id);
      const correct = checkAnswer(state.response ?? '', msg.correctText);
      let next = setElementState(model, msg.id, {
        attempt: state.response ?? '',
        correct,
        complete: correct,
      });
      const problemId = findParentProblemId(msg.id);
      if (problemId) next = propagateCorrectness(next, problemId);
      else if (!correct) next = markAttemptFeedback(next, problemId);
      return next;
    }

    case 'CHOICE_SELECT':
      return setElementState(model, msg.problemId, { chosen: msg.choiceId });

    case 'MULTIPLE_CHOICE_CHECK': {
      const state = getElementState(model, msg.problemId);
      if (!state.chosen) return model;
      const choiceEl = document.getElementById(state.chosen);
      const correct = choiceEl?.classList.contains('correct') ?? false;
      const wrong = { ...(state.wrong ?? {}) };
      if (!correct) wrong[state.chosen] = true;
      let next = setElementState(model, msg.problemId, {
        checked: state.chosen,
        correct,
        complete: correct,
        wrong,
      });
      if (correct) next = propagateCorrectness(next, msg.problemId);
      else next = markAttemptFeedback(next, msg.problemId);
      return next;
    }

    case 'SELECT_ALL_TOGGLE': {
      const state = getElementState(model, msg.problemId);
      const chosen = state.chosen ?? [];
      const next = chosen.includes(msg.choiceId)
        ? chosen.filter(id => id !== msg.choiceId)
        : [...chosen, msg.choiceId];
      return setElementState(model, msg.problemId, { chosen: next });
    }

    case 'SELECT_ALL_CHECK': {
      const state = getElementState(model, msg.problemId);
      if (!state.chosen?.length) return model;
      const correct = checkSelectAll(msg.problemId, state.chosen);
      let next = setElementState(model, msg.problemId, {
        checked: [...state.chosen],
        correct,
        complete: correct,
      });
      if (correct) next = propagateCorrectness(next, msg.problemId);
      else next = markAttemptFeedback(next, msg.problemId);
      return next;
    }

    case 'WORD_CHOICE_SELECT': {
      // Immediate feedback: selecting a word IS the answer (no separate check step).
      const choiceEl = document.getElementById(msg.choiceId);
      const correct = choiceEl?.classList.contains('correct') ?? false;
      let next = setElementState(model, msg.problemId, {
        chosen: msg.choiceId,
        checked: msg.choiceId,
        correct,
        complete: correct,
      });
      if (correct) next = propagateCorrectness(next, msg.problemId);
      else next = markAttemptFeedback(next, msg.problemId);
      return next;
    }

    case 'FREE_RESPONSE_INPUT':
      return setElementState(model, msg.id, { response: msg.value });

    case 'FREE_RESPONSE_SUBMIT': {
      // Any submission counts as complete; unblocks subsequent problems.
      let next = setElementState(model, msg.id, { submitted: true, complete: true });
      const problemId = findParentProblemId(msg.id);
      if (problemId) next = propagateCorrectness(next, problemId);
      return next;
    }

    case 'HINT_REVEAL':
      return setElementState(model, msg.id, { revealed: true });

    default:
      return model;
  }
}

// ─── Initialization ────────────────────────────────────────────────────────

function initializeAvailability(model) {
  let next = { ...model };

  document.querySelectorAll('.problem-environment').forEach(el => {
    const id = el.id;
    if (!id) return;
    const parentProblem = el.parentElement?.closest('.problem-environment');
    const isBlocking = el.hasAttribute('data-blocking');
    // Top-level problems start available; nested blocking problems start unavailable
    if (!parentProblem || !isBlocking) {
      next = setElementState(next, id, { available: true, complete: false, ...getElementState(next, id) });
    } else {
      const existing = getElementState(next, id);
      if (existing.available === undefined) {
        next = setElementState(next, id, { available: false, complete: false });
      }
    }
  });

  return next;
}

// ─── Correctness propagation ───────────────────────────────────────────────

function propagateCorrectness(model, problemId) {
  const problemEl = document.getElementById(problemId);
  if (!problemEl) return model;

  const answerables = getDirectAnswerables(problemEl);
  // All answerables must have complete:true. Free-response uses submitted→complete;
  // graded types use correct→complete. Both set complete:true in their handlers.
  const allComplete = answerables.every(id => getElementState(model, id).complete === true);

  let next = model;

  if (allComplete && answerables.length > 0) {
    next = setElementState(next, problemId, { complete: true });

    // Reveal correct and attempt feedbacks
    problemEl.querySelectorAll('.feedback').forEach(fb => {
      const type = fb.dataset.feedback;
      if (fb.id && fb.closest('.problem-environment') === problemEl &&
          (type === 'correct' || type === 'attempt' || !type)) {
        next = setElementState(next, fb.id, { visible: true });
      }
    });

    // Unlock direct child blocking problems
    problemEl.querySelectorAll('.problem-environment[data-blocking]').forEach(child => {
      if (child.parentElement?.closest('.problem-environment') === problemEl && child.id) {
        next = setElementState(next, child.id, { available: true });
      }
    });

    // Propagate up to parent
    const parentProblem = problemEl.parentElement?.closest('.problem-environment');
    if (parentProblem?.id) next = propagateCorrectness(next, parentProblem.id);
  }

  return next;
}

function markAttemptFeedback(model, problemId) {
  if (!problemId) return model;
  const problemEl = document.getElementById(problemId);
  if (!problemEl) return model;
  let next = model;
  problemEl.querySelectorAll('.feedback[data-feedback="attempt"]').forEach(fb => {
    if (fb.id && fb.closest('.problem-environment') === problemEl) {
      next = setElementState(next, fb.id, { visible: true });
    }
  });
  return next;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

// Returns IDs of direct answerable children.
// "Direct" means no intervening .problem-environment between them and problemEl.
function getDirectAnswerables(problemEl) {
  const ids = [];
  const walk = (el) => {
    for (const child of el.children) {
      if (child.classList.contains('problem-environment')) continue;
      if (
        (child.classList.contains('answer') && child.classList.contains('respondable')) ||
        child.classList.contains('multiple-choice') ||
        child.classList.contains('select-all') ||
        child.classList.contains('word-choice') ||
        child.classList.contains('free-response')
      ) {
        if (child.id) ids.push(child.id);
      }
      walk(child);
    }
  };
  walk(problemEl);
  return ids;
}

function findParentProblemId(answerId) {
  const el = document.getElementById(answerId);
  return el?.closest('.problem-environment')?.id ?? null;
}

// Use math-expressions for symbolic equality; fall back to case-insensitive string comparison.
function checkAnswer(response, correctText) {
  if (!response.trim()) return false;
  try {
    return Expression.fromText(response).equals(Expression.fromText(correctText));
  } catch {
    return response.trim().toLowerCase() === correctText.trim().toLowerCase();
  }
}

function checkSelectAll(problemId, chosen) {
  const el = document.getElementById(problemId);
  if (!el) return false;
  const correctIds = [...el.querySelectorAll('.choice.correct')].map(c => c.id);
  const sortedChosen = [...chosen].sort();
  const sortedCorrect = [...correctIds].sort();
  return (
    sortedChosen.length === sortedCorrect.length &&
    sortedChosen.every((id, i) => id === sortedCorrect[i])
  );
}
