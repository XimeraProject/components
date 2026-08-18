// Shared DOM/answerable helpers. Every ximera-* pilot component reaches
// for the same set of DOM ceremonies — assembling data-state strings from
// a model entry, wiring `.choice` children as a radio/checkbox group,
// creating the .ximera-check-btn / .ximera-submit-btn that the pilot
// dispatches its message from. This module ships them once so pilots
// can drop 15–30 lines of near-identical boilerplate apiece.
//
// Everything here is pure DOM + JSON. Nothing here touches the kernel's
// dispatch / reducer / render registries — pilots pass their own
// `dispatch` function in explicitly. That's the coupling boundary:
// pilots know their own message shape; helpers know only how to turn
// a click / keystroke into "call this dispatch with this message".
//
// Selector conventions:
//   .ximera-btn         — shape base (padding, radius, focus).
//   .ximera-check-btn   — primary check-answer button (paired with .ximera-btn).
//   .ximera-submit-btn  — primary submit-response button (same).
//   .ximera-btn--full   — full-width sizing (standalone problems).
//   .ximera-btn--icon   — compact icon-only sizing (inline math).
//
// State conventions (set by pilots via el.dataset.state on the container
// and/or btn.dataset.state on the button):
//   "correct"   — the answer is correct; button flips to success palette.
//   "attempted" — one or more incorrect attempts recorded; button flips
//                 to danger palette. (Legacy Ximera called this
//                 "incorrect" — both are accepted by the CSS for
//                 compatibility with future third-party components.)
//   ""          — fresh / no attempt yet.

// ─── Answerable data-state ─────────────────────────────────────────────────

// Given a model entry, return the container's data-state string:
//   "correct"   — entry.correct is truthy
//   "attempted" — entry.checked is set but not correct
//   ""          — neither
//
// This is the exact three-line pattern that .multiple-choice, .select-all,
// .word-choice, .free-response, and .ximera-answer's renderers all
// duplicated before this helper existed.
export function answerableDataState(entry) {
  if (entry?.correct) return 'correct';
  if (entry?.checked != null) return 'attempted';
  return '';
}

// Sync the answerable container's data-state (and, if given, the check
// button's data-state) from a model entry. Renderers call this once at
// the top of their projection.
export function syncAnswerableState(containerEl, entry, buttonEl = null) {
  const s = answerableDataState(entry);
  containerEl.dataset.state = s;
  if (buttonEl) buttonEl.dataset.state = s;
}

// ─── Answerable button factory ─────────────────────────────────────────────

// Build a check / submit button and wire its click to a dispatch. Returns
// the freshly created HTMLButtonElement — the caller appends it wherever
// they want.
//
// options:
//   dispatch  — the pilot's dispatch function (required)
//   type      — the reducer message type to dispatch on click (required)
//   extras    — additional key/value pairs merged into the message
//   kind      — 'check' | 'submit' (defaults to 'check'). Controls which
//               kind class (.ximera-check-btn / .ximera-submit-btn) the
//               button gets. Both look identical by default; a course
//               theme can override one without the other.
//   variant   — undefined | 'full' | 'icon'. Adds .ximera-btn--full or
//               .ximera-btn--icon. Default is a normal-sized text button.
//   label     — button text content (default: 'Check' or 'Submit' by kind).
//   ariaLabel — aria-label (default: 'check answer' or 'submit response').
//   attrs     — additional attributes to set on the button (e.g.
//               { 'data-answer-id': el.id }).
export function createAnswerableButton({
  dispatch,
  type,
  extras = {},
  kind = 'check',
  variant,
  label,
  ariaLabel,
  attrs,
} = {}) {
  if (typeof document === 'undefined') {
    throw new Error('createAnswerableButton: no document available');
  }
  if (typeof dispatch !== 'function') {
    throw new Error('createAnswerableButton: dispatch must be a function');
  }
  if (typeof type !== 'string' || !type) {
    throw new Error('createAnswerableButton: type must be a non-empty string');
  }

  const btn = document.createElement('button');
  btn.type = 'button';

  const classes = ['ximera-btn'];
  classes.push(kind === 'submit' ? 'ximera-submit-btn' : 'ximera-check-btn');
  if (variant === 'full') classes.push('ximera-btn--full');
  else if (variant === 'icon') classes.push('ximera-btn--icon');
  btn.className = classes.join(' ');

  btn.textContent =
    label ?? (kind === 'submit' ? 'Submit' : 'Check');
  btn.setAttribute(
    'aria-label',
    ariaLabel ?? (kind === 'submit' ? 'submit response' : 'check answer')
  );

  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      btn.setAttribute(k, String(v));
    }
  }

  btn.addEventListener('click', () => dispatch({ type, ...extras }));
  return btn;
}

// Convenience: same defaults as createAnswerableButton with kind='check'.
export function createCheckButton(options) {
  return createAnswerableButton({ ...options, kind: 'check' });
}

// Convenience: same defaults as createAnswerableButton with kind='submit'.
export function createSubmitButton(options) {
  return createAnswerableButton({ ...options, kind: 'submit' });
}

// ─── Choice-list wiring ────────────────────────────────────────────────────

// Wire every .choice[id] child of `container` as a keyboard-accessible
// radio (single-select) or checkbox (multi-select). Sets role/tabindex/
// aria-checked on each choice, installs click and Enter/Space handlers
// that dispatch `buildMessage(choiceId)`. Sets role on the container.
//
// Renderers still control the `data-state` on each choice (which one is
// selected, which is revealed correct, etc.) — this helper only wires
// input, never state.
//
// options:
//   role         — 'radio' | 'checkbox' (required). Determines the DOM
//                  a11y role on each .choice and on the container
//                  (radiogroup / group).
//   buildMessage — (choiceId: string) => message object. The pilot's
//                  namespace + payload live here.
export function wireChoiceList(container, dispatch, { role, buildMessage }) {
  if (!container || typeof container.querySelectorAll !== 'function') return;
  if (role !== 'radio' && role !== 'checkbox') {
    throw new Error(`wireChoiceList: role must be 'radio' or 'checkbox' (got ${role})`);
  }
  if (typeof dispatch !== 'function') {
    throw new Error('wireChoiceList: dispatch must be a function');
  }
  if (typeof buildMessage !== 'function') {
    throw new Error('wireChoiceList: buildMessage must be a function');
  }

  container.setAttribute('role', role === 'radio' ? 'radiogroup' : 'group');

  container.querySelectorAll('.choice').forEach((choice) => {
    if (!choice.id) return;
    choice.setAttribute('role', role);
    choice.setAttribute('tabindex', '0');
    choice.setAttribute('aria-checked', 'false');
    const activate = () => dispatch(buildMessage(choice.id));
    choice.addEventListener('click', activate);
    choice.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
  });
}
