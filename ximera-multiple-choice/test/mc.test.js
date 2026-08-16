// ximera-multiple-choice conformance tests. Every §10 Example row from
// specs/components/ximera-multiple-choice.md is a test here.

import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { mountFixture, resetKernel, inspect } from 'ximera-core/conformance';
import { dispatch } from 'ximera-core/kernel';
import { shuffleIds } from 'ximera-choice-util';

async function loadMc() {
  const url = new URL('../index.js', import.meta.url).href + `?c=${Math.random()}`;
  await import(url);
}

async function setup(html, options) {
  resetKernel();
  await loadMc();
  return mountFixture(html, options);
}

const primes = `
  <div class="problem-environment" id="p-1" role="article">
    <div class="multiple-choice" id="mc-1">
      <span class="choice" id="c-a">Alpha</span>
      <span class="choice correct" id="c-b">Beta</span>
      <span class="choice" id="c-c">Gamma</span>
    </div>
  </div>
`;

function clickChoice(id) {
  document.getElementById(id).click();
}
function clickCheck() {
  document.querySelector('.ximera-check-btn').click();
}

// ─── Spec §10 non-shuffled Examples ────────────────────────────────────────

test('spec 1: bootstrap fresh — check button appended once', async () => {
  await setup(primes);
  const btns = document.querySelectorAll('.ximera-check-btn');
  assert.equal(btns.length, 1);
  const { model } = inspect();
  assert.equal(model['mc-1'], undefined);
  assert.equal(model['p-1'].available, true);
});

test('spec 2: incorrect submission → attempted, choice eliminated', async () => {
  await setup(primes);
  clickChoice('c-a');
  clickCheck();
  const { model } = inspect();
  assert.equal(model['mc-1'].chosen, 'c-a');
  assert.equal(model['mc-1'].checked, 'c-a');
  assert.equal(model['mc-1'].correct, false);
  assert.equal(model['mc-1'].complete, false);
  assert.deepEqual(model['mc-1'].wrong, { 'c-a': true });
  const ca = document.getElementById('c-a');
  assert.equal(ca.dataset.state.includes('eliminated'), true);
});

test('spec 3: correct submission → complete + propagation, check button hidden', async () => {
  const { agent } = await setup(primes);
  clickChoice('c-b');
  clickCheck();
  const { model } = inspect();
  assert.equal(model['mc-1'].correct, true);
  assert.equal(model['mc-1'].complete, true);
  assert.equal(model['p-1'].complete, true);
  assert.equal(agent.lastProgress, 1);
  const btn = document.querySelector('.ximera-check-btn');
  assert.equal(btn.style.display, 'none');
});

test('spec 4: persistence round-trip preserves state', async () => {
  const { agent: a1 } = await setup(primes);
  clickChoice('c-a');
  clickCheck();
  clickChoice('c-b');
  clickCheck();
  const captured = JSON.parse(JSON.stringify(a1.lastPageState));

  await setup(primes, { initialPageState: captured });
  const { model } = inspect();
  assert.equal(model['mc-1'].correct, true);
  assert.equal(model['mc-1'].wrong['c-a'], true);
  assert.equal(model['p-1'].complete, true);
  assert.equal(document.querySelector('.ximera-check-btn').style.display, 'none');
});

test('spec 5: reset from completed → first-visit', async () => {
  const { agent } = await setup(primes);
  clickChoice('c-b');
  clickCheck();
  agent.progressCalls.length = 0;
  dispatch({ type: 'RESET_WORK' });
  const { model } = inspect();
  assert.equal(model['mc-1'], undefined);
  assert.equal(agent.lastProgress, 0);
  assert.equal(document.querySelector('.ximera-check-btn').style.display, '');
  for (const c of document.querySelectorAll('.choice')) {
    assert.equal(c.dataset.state, '');
  }
});

test('spec 6: restore-replay idempotence', async () => {
  await setup(primes);
  clickChoice('c-b');
  clickCheck();
  const html1 = document.body.innerHTML;
  const { model } = inspect();
  dispatch({
    type: 'PAGE_STATE_RESTORED',
    pageState: JSON.parse(JSON.stringify(model)),
  });
  assert.equal(document.body.innerHTML, html1);
});

// ─── Shuffled Examples ─────────────────────────────────────────────────────

const shuffled = `
  <div class="problem-environment" id="p-1" role="article">
    <div class="multiple-choice shuffle" id="mc-1">
      <span class="choice" id="c-a">Alpha</span>
      <span class="choice correct" id="c-b">Beta</span>
      <span class="choice" id="c-c">Gamma</span>
    </div>
  </div>
`;

test('spec 7: fresh mount with shuffle → seed generated, DOM permuted', async () => {
  await setup(shuffled);
  const { model } = inspect();
  const seed = model['mc-1'].seed;
  assert.equal(typeof seed, 'number');
  assert.ok(seed >= 0 && seed <= 0xFFFFFFFF);

  const expectedOrder = shuffleIds(['c-a', 'c-b', 'c-c'], seed);
  const domOrder = [...document.querySelectorAll('#mc-1 .choice')].map((c) => c.id);
  assert.deepEqual(domOrder, expectedOrder);
});

test('spec 8: reload with persisted seed → DOM matches shuffle(ids, seed)', async () => {
  await setup(shuffled, {
    initialPageState: {
      'mc-1': {
        seed: 123,
        chosen: 'c-b',
        checked: 'c-b',
        correct: true,
        complete: true,
      },
    },
  });
  const expectedOrder = shuffleIds(['c-a', 'c-b', 'c-c'], 123);
  const domOrder = [...document.querySelectorAll('#mc-1 .choice')].map((c) => c.id);
  assert.deepEqual(domOrder, expectedOrder);

  // The correct answer is at the position seed 123 placed it — and the
  // learner's chosen id (c-b) is still selected + correct.
  assert.equal(document.getElementById('c-b').dataset.state.includes('selected'), true);
});

test('spec 9: reset on a shuffled problem clears seed → next mount reshuffles', async () => {
  const { agent } = await setup(shuffled);
  const { model: model1 } = inspect();
  const seed1 = model1['mc-1'].seed;

  dispatch({ type: 'RESET_WORK' });
  const { model: model2 } = inspect();
  assert.equal(model2['mc-1'], undefined);

  // Simulate a fresh mount (the reset kept the current mounts registered;
  // dispatching RESET_WORK cleared the entry so the next SHUFFLE_INIT
  // will insert a new seed — but nothing re-fires SHUFFLE_INIT in the
  // current session. To validate the reshuffle-after-reset property we
  // start a new session with the reset-cleared payload.)
  const captured = JSON.parse(JSON.stringify(agent.lastPageState));
  await setup(shuffled, { initialPageState: captured });
  const { model: model3 } = inspect();
  const seed2 = model3['mc-1'].seed;
  assert.notEqual(seed1, seed2, 'a fresh seed after reset');
});

// ─── Re-selection semantics ────────────────────────────────────────────────

test('re-clicking the same choice is a no-op (reducer ref-preserves)', async () => {
  const { agent } = await setup(primes);
  clickChoice('c-b');
  const before = agent.pageStateCalls.length;
  clickChoice('c-b');
  assert.equal(agent.pageStateCalls.length, before);
});

test('after correct, further clicks are locked (no state change)', async () => {
  const { agent } = await setup(primes);
  clickChoice('c-b');
  clickCheck();
  const before = agent.pageStateCalls.length;
  clickChoice('c-a');
  clickCheck();
  assert.equal(agent.pageStateCalls.length, before);
});

test('keyboard: Enter and Space on a choice select it', async () => {
  await setup(primes);
  const c = document.getElementById('c-b');
  c.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const { model } = inspect();
  assert.equal(model['mc-1'].chosen, 'c-b');

  await setup(primes);
  document.getElementById('c-a').dispatchEvent(
    new window.KeyboardEvent('keydown', { key: ' ', bubbles: true })
  );
  const { model: m2 } = inspect();
  assert.equal(m2['mc-1'].chosen, 'c-a');
});
