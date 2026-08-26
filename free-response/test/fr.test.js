// ximera-free-response conformance tests. Every §10 Example row from
// specs/components/ximera-free-response.md is a test here.

import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { mountFixture, resetKernel, inspect } from '@ximera/core/conformance';
import { dispatch } from '@ximera/core/kernel';

async function loadFr() {
  const url = new URL('../index.js', import.meta.url).href + `?c=${Math.random()}`;
  await import(url);
}

async function setup(html, options) {
  resetKernel();
  await loadFr();
  return mountFixture(html, options);
}

const simple = `
  <div class="problem-environment" id="p-1" role="article">
    <div class="free-response" id="fr-1">Write two sentences about foo.</div>
  </div>
`;

function typeInto(text) {
  const ta = document.querySelector('.ximera-free-response-input');
  ta.value = text;
  ta.dispatchEvent(new window.Event('input', { bubbles: true }));
}
function submit() {
  document.querySelector('.ximera-submit-btn').click();
}

// ─── Spec §10 Examples ─────────────────────────────────────────────────────

test('spec 1: bootstrap fresh — textarea + submit button appended once each', async () => {
  await setup(simple);
  const tas = document.querySelectorAll('.ximera-free-response-input');
  const btns = document.querySelectorAll('.ximera-submit-btn');
  assert.equal(tas.length, 1);
  assert.equal(btns.length, 1);
  const { model } = inspect();
  assert.equal(model['fr-1'], undefined);
  assert.equal(model['p-1'].complete, false);
});

test('spec 2: type text → response state, submit button not disabled', async () => {
  await setup(simple);
  typeInto('hello world');
  const { model } = inspect();
  assert.equal(model['fr-1'].response, 'hello world');
  const btn = document.querySelector('.ximera-submit-btn');
  assert.equal(btn.textContent, 'Submit');
  assert.equal(btn.disabled, false);
});

test('spec 3: submit → complete, propagation, progress = 1', async () => {
  const { agent } = await setup(simple);
  typeInto('hello world');
  submit();
  const { model } = inspect();
  assert.equal(model['fr-1'].submitted, true);
  assert.equal(model['fr-1'].complete, true);
  assert.equal(model['p-1'].complete, true);
  const btn = document.querySelector('.ximera-submit-btn');
  assert.equal(btn.textContent, 'Submitted');
  assert.equal(btn.disabled, true);
  assert.equal(agent.lastProgress, 1);
});

test('spec 4: edit response after submit — submitted stays true', async () => {
  await setup(simple);
  typeInto('hello world');
  submit();
  typeInto('hello world more');
  const { model } = inspect();
  assert.equal(model['fr-1'].response, 'hello world more');
  assert.equal(model['fr-1'].submitted, true);
  assert.equal(model['fr-1'].complete, true);
});

test('spec 5: submit with empty textarea → no-op', async () => {
  const { agent } = await setup(simple);
  const before = agent.pageStateCalls.length;
  submit();
  assert.equal(agent.pageStateCalls.length, before);
  const { model } = inspect();
  assert.equal(model['fr-1'], undefined);
});

test('spec 6: submit with whitespace-only textarea → no-op', async () => {
  const { agent } = await setup(simple);
  typeInto('   \n\t  ');
  const before = agent.pageStateCalls.length;
  submit();
  // The INPUT calls added to pageStateCalls, so before includes those.
  // We only care that SUBMIT didn't add another one.
  const after = agent.pageStateCalls.length;
  assert.equal(after, before);
  const { model } = inspect();
  assert.equal(model['fr-1'].submitted, undefined);
});

test('spec 7: persistence round-trip from submitted', async () => {
  const { agent: a1 } = await setup(simple);
  typeInto('hello');
  submit();
  const captured = JSON.parse(JSON.stringify(a1.lastPageState));
  await setup(simple, { initialPageState: captured });
  const ta = document.querySelector('.ximera-free-response-input');
  const btn = document.querySelector('.ximera-submit-btn');
  assert.equal(ta.value, 'hello');
  assert.equal(btn.textContent, 'Submitted');
  assert.equal(btn.disabled, true);
});

test('spec 8: focus guard — value not overwritten while focused', async () => {
  await setup(simple);
  const ta = document.querySelector('.ximera-free-response-input');
  ta.focus();
  ta.value = 'typed-by-user';
  // Simulate a server push: dispatch PAGE_STATE_RESTORED with a different response.
  dispatch({
    type: 'PAGE_STATE_RESTORED',
    pageState: { 'fr-1': { response: 'server-value' } },
  });
  assert.equal(ta.value, 'typed-by-user');   // NOT overwritten while focused
});

test('spec 9: reset from submitted → first-visit', async () => {
  const { agent } = await setup(simple);
  typeInto('hello');
  submit();
  agent.progressCalls.length = 0;
  dispatch({ type: 'RESET_WORK' });
  const { model } = inspect();
  assert.equal(model['fr-1'], undefined);
  const ta = document.querySelector('.ximera-free-response-input');
  const btn = document.querySelector('.ximera-submit-btn');
  assert.equal(ta.value, '');
  assert.equal(btn.textContent, 'Submit');
  assert.equal(btn.disabled, false);
  assert.equal(agent.lastProgress, 0);
});

test('spec 10: restore-replay idempotence', async () => {
  await setup(simple);
  typeInto('hello');
  submit();
  const html1 = document.body.innerHTML;
  const { model } = inspect();
  dispatch({
    type: 'PAGE_STATE_RESTORED',
    pageState: JSON.parse(JSON.stringify(model)),
  });
  assert.equal(document.body.innerHTML, html1);
});
