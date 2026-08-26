// ximera-hint — click-to-reveal accordion hints.
//
// Non-answerable: revealing a hint does not complete anything. See
// specs/components/ximera-hint.md for the full behavior spec.
//
// DOM at mount (from ximera.4ht's `expandable` environment with class xmhint):
//   <div class="accordion">
//     <h3 class="xmhint"></h3>              (empty — mount injects "Hint" label)
//     <div class="accordion-item xmhint-content" id="accordion-itemN">…</div>
//   </div>

import { register, registerReducer, registerRender } from '@ximera/core/kernel';

let hintCounter = 0;

registerReducer('ximera-hint:REVEAL', (model, msg) => {
  if (model[msg.id]?.revealed) return model;   // idempotent (CONTRACT §7 rule 4)
  return { ...model, [msg.id]: { ...model[msg.id], revealed: true } };
});

registerRender('.xmhint-content', (el, entry) => {
  el.dataset.state = entry.revealed ? 'visible' : 'hidden';
  const header = el.previousElementSibling;
  if (header?.classList.contains('xmhint')) {
    header.setAttribute('aria-expanded', entry.revealed ? 'true' : 'false');
  }
});

register('h3.xmhint', (header, dispatch) => {
  const content = header.nextElementSibling;
  if (!content?.classList.contains('xmhint-content')) return;
  if (!content.id) content.id = `ximera-hint-${++hintCounter}`;

  // Give the header an id so aria-labelledby on the content region can point
  // to it. Marker: the id itself.
  if (!header.id) header.id = `${content.id}-header`;

  // ximera.4ht emits <h3 class="xmhint"></h3> with no visible text. Inject
  // "Hint" idempotently — a re-mount doesn't double-fill.
  if (header.textContent.trim() === '') {
    header.textContent = 'Hint';
  }

  // Marker: role="button" is our idempotence guard for the chrome attributes.
  if (header.getAttribute('role') !== 'button') {
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', 'false');
    header.setAttribute('aria-controls', content.id);
  }

  content.setAttribute('role', 'region');
  content.setAttribute('aria-labelledby', header.id);

  const reveal = () => dispatch({ type: 'ximera-hint:REVEAL', id: content.id });
  header.addEventListener('click', reveal);
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      reveal();
    }
  });
});
