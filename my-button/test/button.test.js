// my-button conformance tests. Mirrors the 9-scenario structure of
// ximera-free-response/test/fr.test.js — same shape, different mechanic.

import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { mountFixture, resetKernel, inspect } from 'ximera-core/conformance';
import { dispatch } from 'ximera-core/kernel';

async function loadButton() {
  const url = new URL('../index.js', import.meta.url).href + `?c=${Math.random()}`;
  await import(url);
}

async function setup(html, options) {
  resetKernel();
  await loadButton();
  return mountFixture(html, options);
}

const fixture = (count = 3) => `
  <div class="problem-environment" id="p-1" role="article">
    <button class="ximera-button" id="b-1" data-count="${count}">Push!</button>
  </div>
`;

function click() {
  document.querySelector('.ximera-button').click();
}

// ─── §10 Examples ──────────────────────────────────────────────────────────

test('spec 1: bootstrap fresh — button in DOM, label restored, problem incomplete', async () => {
  await setup(fixture(3));
  const btn = document.querySelector('.ximera-button');
  assert.equal(btn.dataset.labelText, 'Push!');
  assert.equal(btn.textContent, 'Push!');
  assert.equal(btn.disabled, false);
  const { model } = inspect();
  assert.equal(model['b-1'], undefined);
  assert.equal(model['p-1'].complete, false);
});

test('spec 2: click once (count=3) — clicks=1, label counts, not complete', async () => {
  await setup(fixture(3));
  click();
  const { model } = inspect();
  assert.equal(model['b-1'].clicks, 1);
  assert.equal(model['b-1'].complete, false);
  const btn = document.querySelector('.ximera-button');
  assert.equal(btn.textContent, 'Push! (1/3)');
  assert.equal(btn.disabled, false);
});

test('spec 3: click N times → complete, propagation, progress = 1', async () => {
  const { agent } = await setup(fixture(3));
  click(); click(); click();
  const { model } = inspect();
  assert.equal(model['b-1'].clicks, 3);
  assert.equal(model['b-1'].complete, true);
  assert.equal(model['p-1'].complete, true);
  const btn = document.querySelector('.ximera-button');
  assert.equal(btn.textContent, 'Push! (3/3)');
  assert.equal(btn.disabled, true);
  assert.equal(btn.dataset.state, 'complete');
  assert.equal(agent.lastProgress, 1);
});

test('spec 4: click past N — model unchanged, no additional pageState writes', async () => {
  const { agent } = await setup(fixture(2));
  click(); click();                    // now complete
  const modelAtComplete = JSON.parse(JSON.stringify(inspect().model));
  const callsAtComplete = agent.pageStateCalls.length;
  click();                             // extra click after complete
  const modelAfter = inspect().model;
  assert.equal(modelAfter['b-1'].clicks, 2);
  assert.equal(modelAfter['b-1'].complete, true);
  // model reference stability: entry unchanged
  assert.deepEqual(modelAfter['b-1'], modelAtComplete['b-1']);
  // No further setPageState calls after the completing click
  assert.equal(agent.pageStateCalls.length, callsAtComplete);
});

test('spec 5: persistence round-trip mid-progress — clicks and label restored', async () => {
  const { agent: a1 } = await setup(fixture(3));
  click(); click();
  const captured = JSON.parse(JSON.stringify(a1.lastPageState));
  await setup(fixture(3), { initialPageState: captured });
  const { model } = inspect();
  assert.equal(model['b-1'].clicks, 2);
  assert.equal(model['b-1'].complete, false);
  const btn = document.querySelector('.ximera-button');
  assert.equal(btn.textContent, 'Push! (2/3)');
  assert.equal(btn.disabled, false);
});

test('spec 6: persistence round-trip from complete — button disabled after reload', async () => {
  const { agent: a1 } = await setup(fixture(2));
  click(); click();
  const captured = JSON.parse(JSON.stringify(a1.lastPageState));
  await setup(fixture(2), { initialPageState: captured });
  const btn = document.querySelector('.ximera-button');
  assert.equal(btn.textContent, 'Push! (2/2)');
  assert.equal(btn.disabled, true);
  assert.equal(btn.dataset.state, 'complete');
  const { model } = inspect();
  assert.equal(model['b-1'].complete, true);
  assert.equal(model['p-1'].complete, true);
});

test('spec 7: restore-replay idempotence', async () => {
  await setup(fixture(3));
  click(); click();
  const html1 = document.body.innerHTML;
  const { model } = inspect();
  dispatch({
    type: 'PAGE_STATE_RESTORED',
    pageState: JSON.parse(JSON.stringify(model)),
  });
  assert.equal(document.body.innerHTML, html1);
});

test('spec 8: reset from complete → first-visit', async () => {
  const { agent } = await setup(fixture(2));
  click(); click();
  agent.progressCalls.length = 0;
  dispatch({ type: 'RESET_WORK' });
  const { model } = inspect();
  assert.equal(model['b-1'], undefined);
  const btn = document.querySelector('.ximera-button');
  assert.equal(btn.textContent, 'Push!');
  assert.equal(btn.disabled, false);
  assert.equal(agent.lastProgress, 0);
});

test('spec 9: count=1 degenerate — one click completes', async () => {
  await setup(fixture(1));
  click();
  const { model } = inspect();
  assert.equal(model['b-1'].clicks, 1);
  assert.equal(model['b-1'].complete, true);
  assert.equal(model['p-1'].complete, true);
  const btn = document.querySelector('.ximera-button');
  assert.equal(btn.textContent, 'Push! (1/1)');
  assert.equal(btn.disabled, true);
});
