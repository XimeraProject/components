// ximera-foldable — collapsible aside with an inline "\unfoldable" span
// that stays visible when the surrounding foldable is closed.
//
// Ports original-server/foldable.js: a chevron button before each
// .foldable div toggles a persisted `collapsed` bit. When the visible
// state matches the div's default, all children show at font-size:base;
// otherwise children shrink to font-size:0, and only .unfoldable spans
// keep their base size (peek-through). `data-original="expandable"`
// inverts the default so an expandable-turned-foldable starts closed.
//
// DOM at mount:
//   <div id="foldableN" class="foldable">…<span class="unfoldable">…</span>…</div>

import { register, registerReducer, registerRender } from 'ximera-core/kernel';

const TOGGLE = 'ximera-foldable:TOGGLE';

registerReducer(TOGGLE, (model, msg) => {
  const cur = model[msg.id]?.collapsed ?? false;
  return { ...model, [msg.id]: { ...model[msg.id], collapsed: !cur } };
});

// A foldable's *visible* state is (collapsed XOR isExpandable):
// regular foldable defaults open; expandable-as-foldable defaults closed.
function isOpen(el, entry) {
  const collapsed = entry?.collapsed ?? false;
  const inverted = el.getAttribute('data-original') === 'expandable';
  return collapsed === inverted;
}

registerRender('.foldable', (el, entry) => {
  const open = isOpen(el, entry);
  el.dataset.state = open ? 'open' : 'closed';
  const button = el.previousElementSibling;
  if (button?.classList.contains('foldable-toggle')) {
    button.dataset.state = open ? 'open' : 'closed';
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
});

register('.foldable', (foldable, dispatch) => {
  // Marker: bail if a toggle button is already sitting immediately before.
  const prev = foldable.previousElementSibling;
  if (prev?.classList.contains('foldable-toggle')) return;

  if (!foldable.id) {
    foldable.id = `foldable-${Math.random().toString(36).slice(2)}`;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'foldable-toggle';
  button.setAttribute('aria-controls', foldable.id);
  button.setAttribute('aria-expanded', 'true');
  button.dataset.state = 'open';
  // FontAwesome 6 chevron (same glyph the check/submit buttons pull from).
  button.innerHTML = '<i class="fa-solid fa-chevron-down" aria-hidden="true"></i>';

  foldable.parentNode.insertBefore(button, foldable);

  button.addEventListener('click', () => {
    dispatch({ type: TOGGLE, id: foldable.id });
  });
});
