import { getElementState } from './model.js';

export function calculateProgress(model) {
  const topLevel = [...document.querySelectorAll('.problem-environment')]
    .filter(el => !el.parentElement?.closest('.problem-environment'));

  if (topLevel.length === 0) return 1.0;

  const total = topLevel.reduce((sum, el) => sum + nodeProgress(el, model), 0);
  return total / topLevel.length;
}

function nodeProgress(el, model) {
  const state = getElementState(model, el.id);
  const children = [...el.querySelectorAll('.problem-environment')]
    .filter(child => child.parentElement?.closest('.problem-environment') === el);

  const selfValue = state.complete ? 1 : 0;
  if (children.length === 0) return selfValue;

  const childSum = children.reduce((sum, child) => sum + nodeProgress(child, model), 0);
  return (childSum + selfValue) / (children.length + 1);
}
