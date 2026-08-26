// End-to-end smoke test: two toy components run through the conformance kit.
// This is the Phase 1 exit-criterion demonstration.

import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { mountFixture, resetKernel, inspect } from '../conformance.js';
import { dispatch } from '../kernel.js';

// Register both toy components at module load. This is how real component
// packages will do it — component index.js runs register()/registerReducer()
// as side effects, and any test importing them picks up the registrations.
// We reset the kernel before each mount so registrations from prior tests
// don't leak between fixtures.

import { setup as setupToyHint } from './toy-hint.js';
import { setup as setupToyAnswer } from './toy-answer.js';

async function withToyHint(html, options) {
  resetKernel();
  setupToyHint();
  return mountFixture(html, options);
}

async function withToyAnswer(html, options) {
  resetKernel();
  setupToyAnswer();
  return mountFixture(html, options);
}

// ─── toy-hint (non-answerable) ─────────────────────────────────────────────

test('toy-hint: mount adds no chrome but wires the trigger', async () => {
  await withToyHint(`
    <button class="toy-hint-trigger">Show hint</button>
    <div class="toy-hint-content" id="hint-1">the hint</div>
  `);
  const content = document.getElementById('hint-1');
  assert.equal(content.dataset.state, 'hidden');
});

test('toy-hint: click reveals; second click is no-op', async () => {
  await withToyHint(`
    <button class="toy-hint-trigger">Show hint</button>
    <div class="toy-hint-content" id="hint-1">the hint</div>
  `);
  const btn = document.querySelector('.toy-hint-trigger');
  btn.click();
  const { model, agent } = inspect();
  assert.equal(model['hint-1'].revealed, true);
  assert.equal(document.getElementById('hint-1').dataset.state, 'visible');
  const pageStateCallCount = agent.pageStateCalls.length;
  btn.click();
  assert.equal(agent.pageStateCalls.length, pageStateCallCount);   // no re-dispatch
});

test('toy-hint: revealing does NOT complete anything (non-answerable)', async () => {
  await withToyHint(`
    <div class="problem-environment" id="p-1">
      <button class="toy-hint-trigger">Show hint</button>
      <div class="toy-hint-content" id="hint-1">the hint</div>
    </div>
  `);
  document.querySelector('.toy-hint-trigger').click();
  const { model } = inspect();
  assert.equal(model['p-1'].complete, false);
});

test('toy-hint: restore from persisted revealed state', async () => {
  await withToyHint(
    `<button class="toy-hint-trigger">Show hint</button>
     <div class="toy-hint-content" id="hint-1">the hint</div>`,
    { initialPageState: { 'hint-1': { revealed: true } } }
  );
  assert.equal(document.getElementById('hint-1').dataset.state, 'visible');
});

// ─── toy-answer (answerable) ───────────────────────────────────────────────

test('toy-answer: incorrect submission → attempted state', async () => {
  await withToyAnswer(`
    <div class="problem-environment" id="p-1">
      <span class="toy-answer" id="a-1" data-correct="17"></span>
    </div>
  `);
  const input = document.querySelector('.toy-answer-input');
  input.value = '18';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.querySelector('.toy-answer-check').click();
  const { model } = inspect();
  assert.equal(model['a-1'].correct, false);
  assert.equal(model['a-1'].complete, false);
  assert.equal(model['p-1'].complete, false);
  assert.equal(document.getElementById('a-1').dataset.state, 'attempted');
});

test('toy-answer: correct submission → complete + propagation', async () => {
  const { agent } = await withToyAnswer(`
    <div class="problem-environment" id="p-1">
      <span class="toy-answer" id="a-1" data-correct="17"></span>
    </div>
  `);
  const input = document.querySelector('.toy-answer-input');
  input.value = '17';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.querySelector('.toy-answer-check').click();
  const { model } = inspect();
  assert.equal(model['a-1'].correct, true);
  assert.equal(model['a-1'].complete, true);
  assert.equal(model['p-1'].complete, true);
  assert.equal(agent.lastProgress, 1);
});

test('toy-answer: uncovers nested blocking sub-problem on completion', async () => {
  await withToyAnswer(`
    <div class="problem-environment" id="outer">
      <span class="toy-answer" id="a-outer" data-correct="a"></span>
      <div class="problem-environment" id="inner">
        <span class="toy-answer" id="a-inner" data-correct="b"></span>
      </div>
    </div>
  `);
  // Initially inner is unavailable.
  assert.equal(document.getElementById('inner').dataset.state, 'unavailable');
  // Complete the outer answerable.
  const inputs = document.querySelectorAll('.toy-answer-input');
  const checks = document.querySelectorAll('.toy-answer-check');
  inputs[0].value = 'a';
  inputs[0].dispatchEvent(new window.Event('input', { bubbles: true }));
  checks[0].click();
  const { model } = inspect();
  assert.equal(model['outer'].complete, true);
  assert.equal(model['inner'].available, true);
  assert.equal(document.getElementById('inner').dataset.state.includes('available'), true);
});

test('toy-answer: persistence round-trip preserves state', async () => {
  const { agent } = await withToyAnswer(`
    <div class="problem-environment" id="p-1">
      <span class="toy-answer" id="a-1" data-correct="17"></span>
    </div>
  `);
  const input = document.querySelector('.toy-answer-input');
  input.value = '17';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.querySelector('.toy-answer-check').click();
  const serialized = JSON.parse(JSON.stringify(agent.lastPageState));

  // Re-mount fresh with the serialized state.
  await withToyAnswer(
    `<div class="problem-environment" id="p-1">
       <span class="toy-answer" id="a-1" data-correct="17"></span>
     </div>`,
    { initialPageState: serialized }
  );
  const { model } = inspect();
  assert.equal(model['a-1'].correct, true);
  assert.equal(model['p-1'].complete, true);
  const restoredInput = document.querySelector('.toy-answer-input');
  assert.equal(restoredInput.value, '17');
  assert.equal(restoredInput.disabled, true);
});

test('toy-answer: reset from completed → first-visit', async () => {
  await withToyAnswer(
    `<div class="problem-environment" id="p-1">
       <span class="toy-answer" id="a-1" data-correct="17"></span>
     </div>`,
    { initialPageState: {
        'a-1': { response: '17', attempt: '17', correct: true, complete: true, checked: '17' },
        'p-1': { available: true, complete: true, experienced: true },
      } }
  );
  const { agent } = inspect();
  agent.progressCalls.length = 0;
  dispatch({ type: 'RESET_WORK' });
  const { model } = inspect();
  assert.equal(model['a-1'], undefined);
  assert.equal(model['p-1'].complete, false);
  assert.equal(agent.lastProgress, 0);
  // DOM reflects reset — input cleared and re-enabled.
  const input = document.querySelector('.toy-answer-input');
  assert.equal(input.disabled, false);
});
