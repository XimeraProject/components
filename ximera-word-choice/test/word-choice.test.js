// ximera-word-choice conformance tests. Every row of
// specs/components/ximera-word-choice.md §10 Examples is a test here.

import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { mountFixture, resetKernel, inspect } from 'ximera-core/conformance';
import { dispatch } from 'ximera-core/kernel';

async function loadWordChoice() {
  const url = new URL('../index.js', import.meta.url).href + `?c=${Math.random()}`;
  await import(url);
}

async function setup(html, options) {
  resetKernel();
  await loadWordChoice();
  return mountFixture(html, options);
}

const ohio = `
  <div class="problem-environment" id="problem-1" role="article">
    What is the capital of Ohio?
    <span class="word-choice" id="wc-1">
      <span class="choice" id="c-a">Cleveland</span>
      <span class="choice correct" id="c-b">Columbus</span>
      <span class="choice" id="c-c">Cincinnati</span>
    </span>
  </div>
`;

function selectChoice(wcEl, choiceId) {
  const sel = wcEl.querySelector('select.ximera-word-select');
  sel.value = choiceId;
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
}

// ─── Spec §10 Examples ─────────────────────────────────────────────────────

test('spec example 1: bootstrap with empty pageState', async () => {
  await setup(ohio);
  const { model } = inspect();
  assert.equal(model['problem-1'].available, true);
  assert.equal(model['problem-1'].complete, false);
  assert.equal(model['wc-1'], undefined);
  const wc = document.getElementById('wc-1');
  const sel = wc.querySelector('select.ximera-word-select');
  assert.ok(sel, 'select element created');
  assert.equal(sel.options.length, 4);            // — + 3 choices
  assert.equal(sel.options[0].textContent, '—');
  assert.equal(sel.options[1].textContent, 'Cleveland');
});

test('spec example 2: select incorrect option → attempted', async () => {
  const { agent } = await setup(ohio);
  selectChoice(document.getElementById('wc-1'), 'c-a');
  const { model } = inspect();
  assert.equal(model['wc-1'].chosen, 'c-a');
  assert.equal(model['wc-1'].checked, 'c-a');
  assert.equal(model['wc-1'].correct, false);
  assert.equal(model['wc-1'].complete, false);
  assert.equal(document.getElementById('wc-1').dataset.state, 'attempted');
  assert.equal(model['problem-1'].complete, false);
  const sel = document.querySelector('select.ximera-word-select');
  assert.equal(sel.disabled, false);
  // Progress: 0 total (not complete).
  assert.equal(agent.lastProgress, 0);
});

test('spec example 3: select correct option → complete + propagation', async () => {
  const { agent } = await setup(ohio);
  selectChoice(document.getElementById('wc-1'), 'c-b');
  const { model } = inspect();
  assert.equal(model['wc-1'].correct, true);
  assert.equal(model['wc-1'].complete, true);
  assert.equal(document.getElementById('wc-1').dataset.state, 'correct');
  const sel = document.querySelector('select.ximera-word-select');
  assert.equal(sel.disabled, true);
  assert.equal(model['problem-1'].complete, true);
  assert.equal(agent.lastProgress, 1);
});

test('spec example 4: change from incorrect to another incorrect keeps enabled', async () => {
  await setup(ohio);
  selectChoice(document.getElementById('wc-1'), 'c-a');
  selectChoice(document.getElementById('wc-1'), 'c-c');
  const { model } = inspect();
  assert.equal(model['wc-1'].chosen, 'c-c');
  assert.equal(model['wc-1'].correct, false);
  const sel = document.querySelector('select.ximera-word-select');
  assert.equal(sel.disabled, false);
});

test('spec example 5: persistence round-trip', async () => {
  const { agent: agent1 } = await setup(ohio);
  selectChoice(document.getElementById('wc-1'), 'c-b');
  const captured = JSON.parse(JSON.stringify(agent1.lastPageState));

  await setup(ohio, { initialPageState: captured });
  const { model } = inspect();
  assert.equal(model['wc-1'].correct, true);
  assert.equal(model['problem-1'].complete, true);
  assert.equal(document.getElementById('wc-1').dataset.state, 'correct');
  const sel = document.querySelector('select.ximera-word-select');
  assert.equal(sel.value, 'c-b');
  assert.equal(sel.disabled, true);
});

test('spec example 6: RESET_WORK from completed → first-visit', async () => {
  const { agent } = await setup(ohio);
  selectChoice(document.getElementById('wc-1'), 'c-b');
  agent.progressCalls.length = 0;
  dispatch({ type: 'RESET_WORK' });
  const { model } = inspect();
  assert.equal(model['wc-1'], undefined);
  assert.equal(model['problem-1'].complete, false);
  assert.equal(agent.lastProgress, 0);
  const sel = document.querySelector('select.ximera-word-select');
  assert.equal(sel.disabled, false);
  assert.equal(sel.value, '');
});

test('spec example 7: bootstrap directly with pre-completed state', async () => {
  await setup(ohio, {
    initialPageState: {
      'wc-1': { chosen: 'c-b', checked: 'c-b', correct: true, complete: true },
    },
  });
  const { model } = inspect();
  assert.equal(model['problem-1'].complete, true);
  const sel = document.querySelector('select.ximera-word-select');
  assert.equal(sel.value, 'c-b');
  assert.equal(sel.disabled, true);
});

test('spec example 8: forward-tolerance — unknown persisted keys are preserved', async () => {
  await setup(ohio, {
    initialPageState: {
      'wc-1': {
        chosen: 'c-b', checked: 'c-b', correct: true, complete: true,
        futureKey: 42,
      },
    },
  });
  const { model } = inspect();
  assert.equal(model['wc-1'].futureKey, 42);
});

// ─── Restore-replay idempotence (CONTRACT §14.4) ───────────────────────────

test('restore-replay: render twice = render once', async () => {
  await setup(ohio);
  selectChoice(document.getElementById('wc-1'), 'c-b');
  const html1 = document.body.innerHTML;
  const { model } = inspect();
  dispatch({
    type: 'PAGE_STATE_RESTORED',
    pageState: JSON.parse(JSON.stringify(model)),
  });
  assert.equal(document.body.innerHTML, html1);
});

// ─── After-correct lockout ─────────────────────────────────────────────────

test('re-selecting after correct is a no-op (locked)', async () => {
  const { agent } = await setup(ohio);
  selectChoice(document.getElementById('wc-1'), 'c-b');
  const before = agent.pageStateCalls.length;
  // The select is disabled, so change events shouldn't fire from user actions.
  // But if somehow triggered programmatically, the reducer must guard.
  const sel = document.querySelector('select.ximera-word-select');
  sel.value = 'c-a';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(agent.pageStateCalls.length, before, 'no-op after correct');
});
