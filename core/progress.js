import { getEntry } from './model.js';

// Recursive average of `complete` over the problem-environment tree.
// Returns a value in [0, 1] — no-problems pages return 1.
//
// Kernel calls agent.setProgress(this value) after every dispatch. The
// server-side high-water mark ensures reset (which drops this to 0)
// never lowers the learner's LTI grade (CONTRACT §11).
export function calculateProgress(model) {
  if (typeof document === 'undefined') return 1.0;

  const topLevel = [...document.querySelectorAll('.problem-environment')]
    .filter(el => !el.parentElement?.closest('.problem-environment'));

  if (topLevel.length === 0) return 1.0;

  const total = topLevel.reduce((sum, el) => sum + nodeProgress(el, model), 0);
  return total / topLevel.length;
}

function nodeProgress(el, model) {
  const entry = getEntry(model, el.id);
  const children = [...el.querySelectorAll('.problem-environment')]
    .filter(child => child.parentElement?.closest('.problem-environment') === el);

  const selfValue = entry.complete ? 1 : 0;
  if (children.length === 0) return selfValue;

  const childSum = children.reduce((sum, c) => sum + nodeProgress(c, model), 0);
  return (childSum + selfValue) / (children.length + 1);
}
