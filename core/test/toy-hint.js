// Toy non-answerable component. Uses register + registerReducer + registerRender.
// Simulates ximera-hint's shape: a click on `.toy-hint-trigger` reveals the
// sibling `.toy-hint-content`. Non-answerable — revealing MUST NOT complete
// any problem.
//
// Exports setup() (called explicitly by tests after resetKernel) rather than
// registering at module load, so ESM caching doesn't fight the test harness.

import { register, registerReducer, registerRender } from '../kernel.js';

export function setup() {
  registerReducer('toy-hint:REVEAL', (model, msg) => {
    if (model[msg.id]?.revealed) return model;  // already revealed → no-op
    return { ...model, [msg.id]: { ...model[msg.id], revealed: true } };
  });

  registerRender('.toy-hint-content', (el, entry) => {
    el.dataset.state = entry.revealed ? 'visible' : 'hidden';
  });

  register('.toy-hint-trigger', (el, dispatch) => {
    const content = el.nextElementSibling;
    if (!content?.classList.contains('toy-hint-content')) return;
    if (!content.id) content.id = `toy-hint-${Math.random().toString(36).slice(2, 8)}`;
    el.addEventListener('click', () => {
      dispatch({ type: 'toy-hint:REVEAL', id: content.id });
    });
  });
}
