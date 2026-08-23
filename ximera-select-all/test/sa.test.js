// ximera-select-all conformance tests. Every §10 Example row from
// specs/components/ximera-select-all.md is a test here.

import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { mountFixture, resetKernel, inspect } from 'ximera-core/conformance';
import { dispatch } from 'ximera-core/kernel';

async function loadSa() {
  const url = new URL('../index.js', import.meta.url).href + `?c=${Math.random()}`;
  await import(url);
}

async function setup(html, options) {
  resetKernel();
  await loadSa();
  return mountFixture(html, options);
}

const primes = `
  <div class="problem-environment" id="p-1" role="article">
    <div class="select-all" id="sa-1">
      <span class="choice correct" id="c-a">A</span>
      <span class="choice" id="c-b">B</span>
      <span class="choice correct" id="c-c">C</span>
      <span class="choice" id="c-d">D</span>
    </div>
  </div>
`;

function toggle(id) { document.getElementById(id).click(); }
function check() { document.querySelector('.ximera-check-btn').click(); }

// ─── Spec §10 Examples ─────────────────────────────────────────────────────

test('spec 1: bootstrap fresh — check button appended once', async () => {
  await setup(primes);
  assert.equal(document.querySelectorAll('.ximera-check-btn').length, 1);
});

test('spec 2: toggle c-a and c-c, check → correct + complete, Check flips to correct badge', async () => {
  const { agent } = await setup(primes);
  toggle('c-a'); toggle('c-c'); check();
  const { model } = inspect();
  assert.equal(model['sa-1'].correct, true);
  assert.equal(model['sa-1'].complete, true);
  assert.equal(model['p-1'].complete, true);
  assert.equal(agent.lastProgress, 1);
  const btn = document.querySelector('.ximera-check-btn');
  assert.notEqual(btn.style.display, 'none');
  assert.equal(btn.dataset.state, 'correct');
  // Nothing gains a 'revealed' data-state — CSS drives highlight via .correct.
  for (const c of document.querySelectorAll('.choice')) {
    assert.equal(c.dataset.state.includes('revealed'), false);
  }
});

test('spec 3: toggle c-a and c-b, check → incorrect (mismatched set)', async () => {
  await setup(primes);
  toggle('c-a'); toggle('c-b'); check();
  const { model } = inspect();
  assert.equal(model['sa-1'].correct, false);
  assert.equal(model['sa-1'].complete, false);
  assert.equal(document.getElementById('sa-1').dataset.state, 'attempted');
});

test('spec 4: from state 3 — untoggle b, toggle c, check → correct', async () => {
  await setup(primes);
  toggle('c-a'); toggle('c-b'); check();
  toggle('c-b'); toggle('c-c'); check();
  const { model } = inspect();
  assert.equal(model['sa-1'].correct, true);
});

test('spec 5: from state 3 — toggling without re-check preserves checked', async () => {
  await setup(primes);
  toggle('c-a'); toggle('c-b'); check();
  const { model: m1 } = inspect();
  assert.deepEqual(m1['sa-1'].checked, ['c-a', 'c-b']);

  toggle('c-b');   // toggle off, no re-check
  const { model: m2 } = inspect();
  assert.deepEqual(m2['sa-1'].chosen, ['c-a']);
  assert.deepEqual(m2['sa-1'].checked, ['c-a', 'c-b']);   // unchanged
  assert.equal(m2['sa-1'].correct, false);
});

test('spec 6: toggling while correct is a no-op', async () => {
  const { agent } = await setup(primes);
  toggle('c-a'); toggle('c-c'); check();
  const before = agent.pageStateCalls.length;
  toggle('c-b');
  assert.equal(agent.pageStateCalls.length, before);
});

test('spec 7: persistence round-trip from completed', async () => {
  const { agent: a1 } = await setup(primes);
  toggle('c-a'); toggle('c-c'); check();
  const captured = JSON.parse(JSON.stringify(a1.lastPageState));
  await setup(primes, { initialPageState: captured });
  const { model } = inspect();
  assert.equal(model['sa-1'].correct, true);
  assert.equal(model['p-1'].complete, true);
});

test('spec 8: reset from completed → first-visit', async () => {
  const { agent } = await setup(primes);
  toggle('c-a'); toggle('c-c'); check();
  agent.progressCalls.length = 0;
  dispatch({ type: 'RESET_WORK' });
  const { model } = inspect();
  assert.equal(model['sa-1'], undefined);
  const btn = document.querySelector('.ximera-check-btn');
  assert.equal(btn.style.display, '');
  assert.equal(btn.dataset.state, '');
  assert.equal(agent.lastProgress, 0);
});

test('spec 9: restore-replay idempotence', async () => {
  await setup(primes);
  toggle('c-a'); toggle('c-c'); check();
  const html1 = document.body.innerHTML;
  const { model } = inspect();
  dispatch({
    type: 'PAGE_STATE_RESTORED',
    pageState: JSON.parse(JSON.stringify(model)),
  });
  assert.equal(document.body.innerHTML, html1);
});

test('spec 10: set-equality is order-insensitive ([c-c, c-a] == [c-a, c-c])', async () => {
  await setup(primes);
  // Toggle in c-c first, then c-a → chosen = ['c-c', 'c-a']
  toggle('c-c'); toggle('c-a'); check();
  const { model } = inspect();
  assert.equal(model['sa-1'].correct, true);
});

// ─── Keyboard ──────────────────────────────────────────────────────────────

test('keyboard: Enter and Space toggle a choice', async () => {
  await setup(primes);
  document.getElementById('c-a').dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
  );
  document.getElementById('c-c').dispatchEvent(
    new window.KeyboardEvent('keydown', { key: ' ', bubbles: true })
  );
  const { model } = inspect();
  assert.deepEqual(model['sa-1'].chosen, ['c-a', 'c-c']);
});
