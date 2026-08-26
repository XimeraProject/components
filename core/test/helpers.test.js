import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  answerableDataState,
  syncAnswerableState,
  createAnswerableButton,
  createCheckButton,
  createSubmitButton,
  wireChoiceList,
} from '../helpers.js';

// ─── answerableDataState ───────────────────────────────────────────────────

test('answerableDataState returns "correct" when entry.correct is truthy', () => {
  assert.equal(answerableDataState({ correct: true }), 'correct');
  assert.equal(answerableDataState({ correct: true, checked: 'x' }), 'correct');
});

test('answerableDataState returns "attempted" when checked is set but not correct', () => {
  assert.equal(answerableDataState({ checked: 'x' }), 'attempted');
  assert.equal(answerableDataState({ checked: 'x', correct: false }), 'attempted');
  assert.equal(answerableDataState({ checked: '' }), 'attempted'); // empty string is set
});

test('answerableDataState returns "" for empty / undefined entries', () => {
  assert.equal(answerableDataState(undefined), '');
  assert.equal(answerableDataState({}), '');
  assert.equal(answerableDataState({ response: 'partial' }), '');
});

// ─── syncAnswerableState ───────────────────────────────────────────────────

test('syncAnswerableState sets data-state on container only when no button', () => {
  const el = document.createElement('div');
  syncAnswerableState(el, { correct: true });
  assert.equal(el.dataset.state, 'correct');
});

test('syncAnswerableState mirrors data-state onto the button', () => {
  const el = document.createElement('div');
  const btn = document.createElement('button');
  syncAnswerableState(el, { checked: 'x' }, btn);
  assert.equal(el.dataset.state, 'attempted');
  assert.equal(btn.dataset.state, 'attempted');
});

// ─── createAnswerableButton / createCheckButton / createSubmitButton ───────

test('createCheckButton — default class + label + aria', () => {
  const seen = [];
  const btn = createCheckButton({
    dispatch: (m) => seen.push(m),
    type: 'foo:CHECK',
    extras: { id: 'q1' },
  });
  assert.equal(btn.tagName, 'BUTTON');
  assert.equal(btn.type, 'button');
  assert.equal(btn.textContent, 'Check');
  assert.equal(btn.getAttribute('aria-label'), 'check answer');
  assert.ok(btn.classList.contains('ximera-btn'));
  assert.ok(btn.classList.contains('ximera-check-btn'));
  btn.click();
  assert.deepEqual(seen, [{ type: 'foo:CHECK', id: 'q1' }]);
});

test('createSubmitButton — submit class + Submit label', () => {
  const btn = createSubmitButton({
    dispatch: () => {},
    type: 'foo:SUBMIT',
  });
  assert.equal(btn.textContent, 'Submit');
  assert.equal(btn.getAttribute('aria-label'), 'submit response');
  assert.ok(btn.classList.contains('ximera-submit-btn'));
  assert.ok(!btn.classList.contains('ximera-check-btn'));
});

test('createAnswerableButton — variant=full adds --full class', () => {
  const btn = createAnswerableButton({
    dispatch: () => {},
    type: 'x',
    variant: 'full',
  });
  assert.ok(btn.classList.contains('ximera-btn--full'));
  assert.ok(!btn.classList.contains('ximera-btn--icon'));
});

test('createAnswerableButton — variant=icon adds --icon class', () => {
  const btn = createAnswerableButton({
    dispatch: () => {},
    type: 'x',
    variant: 'icon',
  });
  assert.ok(btn.classList.contains('ximera-btn--icon'));
});

test('createAnswerableButton — custom label + ariaLabel + attrs', () => {
  const btn = createAnswerableButton({
    dispatch: () => {},
    type: 'x',
    label: 'Go',
    ariaLabel: 'go button',
    attrs: { 'data-answer-id': 'q7', 'data-foo': 'bar' },
  });
  assert.equal(btn.textContent, 'Go');
  assert.equal(btn.getAttribute('aria-label'), 'go button');
  assert.equal(btn.getAttribute('data-answer-id'), 'q7');
  assert.equal(btn.getAttribute('data-foo'), 'bar');
});

test('createAnswerableButton — validation errors', () => {
  assert.throws(() => createAnswerableButton({ type: 'x' }), /dispatch/);
  assert.throws(() => createAnswerableButton({ dispatch: () => {} }), /type/);
  assert.throws(() => createAnswerableButton({ dispatch: () => {}, type: '' }), /type/);
});

// ─── wireChoiceList ────────────────────────────────────────────────────────

test('wireChoiceList — role=radio wires radiogroup + click dispatch', () => {
  const container = document.createElement('div');
  container.innerHTML = '<span class="choice" id="c1">A</span><span class="choice" id="c2">B</span>';
  const seen = [];
  wireChoiceList(container, (m) => seen.push(m), {
    role: 'radio',
    buildMessage: (id) => ({ type: 'test:PICK', id }),
  });
  assert.equal(container.getAttribute('role'), 'radiogroup');
  const [c1, c2] = container.querySelectorAll('.choice');
  assert.equal(c1.getAttribute('role'), 'radio');
  assert.equal(c1.getAttribute('tabindex'), '0');
  assert.equal(c1.getAttribute('aria-checked'), 'false');
  c1.click();
  c2.click();
  assert.deepEqual(seen, [
    { type: 'test:PICK', id: 'c1' },
    { type: 'test:PICK', id: 'c2' },
  ]);
});

test('wireChoiceList — role=checkbox sets group + checkbox roles', () => {
  const container = document.createElement('div');
  container.innerHTML = '<span class="choice" id="c1">A</span>';
  wireChoiceList(container, () => {}, {
    role: 'checkbox',
    buildMessage: () => ({ type: 'x' }),
  });
  assert.equal(container.getAttribute('role'), 'group');
  assert.equal(container.querySelector('.choice').getAttribute('role'), 'checkbox');
});

test('wireChoiceList — Enter and Space activate a choice', () => {
  const container = document.createElement('div');
  container.innerHTML = '<span class="choice" id="c1">A</span>';
  const seen = [];
  wireChoiceList(container, (m) => seen.push(m), {
    role: 'radio',
    buildMessage: (id) => ({ id }),
  });
  const c = container.querySelector('.choice');
  c.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  c.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  c.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  assert.deepEqual(seen, [{ id: 'c1' }, { id: 'c1' }]);
});

test('wireChoiceList — skips .choice without id', () => {
  const container = document.createElement('div');
  container.innerHTML = '<span class="choice">no-id</span><span class="choice" id="c1">A</span>';
  const seen = [];
  wireChoiceList(container, (m) => seen.push(m), {
    role: 'radio',
    buildMessage: (id) => ({ id }),
  });
  const spans = container.querySelectorAll('.choice');
  spans[0].click();          // unwired
  spans[1].click();          // wired
  assert.deepEqual(seen, [{ id: 'c1' }]);
});

test('wireChoiceList — bad role rejects', () => {
  const container = document.createElement('div');
  assert.throws(
    () => wireChoiceList(container, () => {}, { role: 'bogus', buildMessage: () => ({}) }),
    /radio.*checkbox/,
  );
});
