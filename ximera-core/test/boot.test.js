import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { mountFixture, resetKernel, inspect, createMockAgent } from '../conformance.js';
import { register, registerReducer, dispatch, boot } from '../kernel.js';

test('boot dispatches AGENT_READY_OFFLINE on empty pageState', async () => {
  resetKernel();
  await mountFixture(`<div class="problem-environment" id="p-1"></div>`);
  const { model } = inspect();
  assert.equal(model['p-1'].available, true);
});

test('boot dispatches PAGE_STATE_RESTORED when pageState is non-empty', async () => {
  resetKernel();
  await mountFixture(
    `<div class="problem-environment" id="p-1"></div>`,
    { initialPageState: { 'p-1': { available: true, complete: true, experienced: true } } }
  );
  const { model } = inspect();
  assert.equal(model['p-1'].complete, true);
});

test('boot mounts reset control into #ximera-page-controls', async () => {
  resetKernel();
  await mountFixture(`<div class="problem-environment" id="p-1"></div>`);
  const controls = document.getElementById('ximera-page-controls');
  assert.ok(controls, 'ximera-page-controls container created');
  const btn = controls.querySelector('.ximera-reset-btn');
  assert.ok(btn, 'reset button created');
  assert.equal(btn.getAttribute('aria-label'), 'reset work on this page');
});

test('boot reuses an existing #ximera-page-controls container', async () => {
  resetKernel();
  await mountFixture(
    `<div id="ximera-page-controls"></div>
     <div class="problem-environment" id="p-1"></div>`
  );
  const controls = document.querySelectorAll('#ximera-page-controls');
  assert.equal(controls.length, 1);
});

test('reset button click dispatches RESET_WORK after confirmation', async () => {
  resetKernel();
  const { agent } = await mountFixture(
    `<div class="problem-environment" id="p-1"></div>`,
    { initialPageState: { 'p-1': { available: true, complete: true, experienced: true } } }
  );
  const btn = document.querySelector('.ximera-reset-btn');
  agent.progressCalls.length = 0;
  btn.click();
  const { model } = inspect();
  assert.equal(model['p-1'].complete, false);
  assert.equal(agent.lastProgress, 0);
});

test('reset round-trip: reset → cleared state persisted → first-visit equivalence', async () => {
  resetKernel();
  register('.a', () => {}, { answerable: true });
  registerReducer('test-a:COMPLETE', (m, msg) => ({
    ...m, [msg.id]: { ...m[msg.id], complete: true },
  }));

  const html = `
    <div class="problem-environment" id="p-1">
      <span class="a" id="a-1"></span>
    </div>`;
  const ctx = await mountFixture(html);
  dispatch({ type: 'test-a:COMPLETE', id: 'a-1' });
  const { model: completedModel } = inspect();
  assert.equal(completedModel['p-1'].complete, true);
  assert.equal(ctx.agent.lastProgress, 1);

  // Now reset. Progress goes to 0.
  ctx.agent.progressCalls.length = 0;
  dispatch({ type: 'RESET_WORK' });
  const { model: resetModel } = inspect();
  assert.equal(resetModel['p-1'].complete, false);
  assert.equal(resetModel['a-1'], undefined);        // cleared
  assert.equal(ctx.agent.lastProgress, 0);
  assert.deepEqual(ctx.agent.lastPageState, resetModel); // persisted

  // Fresh mount from a hypothetical first visit.
  const ctx2 = await mountFixture(html);
  const { model: freshModel } = inspect();

  // Reset then compare to fresh: models must match structurally.
  // (Note: mountFixture already reset kernel state.)
  assert.deepEqual(resetModel, freshModel);
  void ctx2;
});

test('boot throws when called twice on the same kernel state', async () => {
  resetKernel();
  document.body.innerHTML = '';
  const agent = createMockAgent();
  await boot(agent, { mountResetControl: false });
  await assert.rejects(
    () => boot(agent, { mountResetControl: false }),
    /boot\(\) called twice/
  );
});

test('pagestate-changed re-enters via PAGE_STATE_RESTORED', async () => {
  resetKernel();
  const { agent } = await mountFixture(
    `<div class="problem-environment" id="p-1"></div>`
  );
  agent.triggerPageStateChanged({
    'p-1': { available: true, complete: true, experienced: true },
  });
  const { model } = inspect();
  assert.equal(model['p-1'].complete, true);
});

// Real @modulus-learning/agent synchronously emits 'pagestate-changed' on
// every setPageState. Without the echo-suppression guard, dispatch →
// setPageState → emit → dispatch loops until the stack overflows. This
// test uses the mock's echoOnSetPageState mode to reproduce that path.
test('setPageState echo does not re-enter dispatch (no infinite loop)', async () => {
  resetKernel();
  registerReducer('test:BUMP', (m, msg) => ({
    ...m,
    [msg.id]: { ...(m[msg.id] ?? {}), n: (m[msg.id]?.n ?? 0) + 1 },
  }));
  const { agent } = await mountFixture(
    `<div class="problem-environment" id="p-1"></div>`,
    { echoOnSetPageState: true }
  );
  const callsBefore = agent.pageStateCalls.length;
  dispatch({ type: 'test:BUMP', id: 'p-1' });
  const { model } = inspect();
  assert.equal(model['p-1'].n, 1);
  // Exactly one setPageState per dispatch — the echo must not trigger another.
  assert.equal(agent.pageStateCalls.length, callsBefore + 1);
});
