// Toy answerable component. Uses register + registerReducer + registerRender
// with { answerable: true }. Trivial correctness rule: input's value must
// equal the .toy-answer element's data-correct attribute.

import { register, registerReducer, registerRender } from '../kernel.js';

export function setup() {
  registerReducer('toy-answer:INPUT', (model, msg) => ({
    ...model,
    [msg.id]: { ...model[msg.id], response: msg.value },
  }));

  registerReducer('toy-answer:CHECK', (model, msg) => {
    const entry = model[msg.id] ?? {};
    const correct = (entry.response ?? '') === msg.correctText;
    return {
      ...model,
      [msg.id]: {
        ...entry,
        attempt: entry.response ?? '',
        correct,
        complete: correct,
        checked: entry.response ?? '',
      },
    };
  });

  registerRender('.toy-answer', (el, entry) => {
    const parts = [];
    if (entry.correct) parts.push('correct');
    else if (entry.attempt !== undefined) parts.push('attempted');
    el.dataset.state = parts.join(' ');
    const input = el.querySelector('input.toy-answer-input');
    if (input) {
      if (document.activeElement !== input && entry.response !== undefined && input.value !== entry.response) {
        input.value = entry.response;
      }
      input.disabled = !!entry.correct;
    }
  });

  register('.toy-answer', (el, dispatch) => {
    if (!el.id) return;
    const correctText = el.dataset.correct ?? '';
    if (!el.querySelector('input.toy-answer-input')) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'toy-answer-input';
      input.setAttribute('aria-label', 'answer');
      el.appendChild(input);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toy-answer-check';
      btn.textContent = 'Check';
      el.appendChild(btn);
      input.addEventListener('input', () => {
        dispatch({ type: 'toy-answer:INPUT', id: el.id, value: input.value });
      });
      btn.addEventListener('click', () => {
        dispatch({ type: 'toy-answer:CHECK', id: el.id, correctText });
      });
    }
  }, { answerable: true });
}
