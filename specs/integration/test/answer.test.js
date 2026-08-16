// End-to-end integration for ximera-answer against its Phase 0 fixture.
// Fixture has 4 problems: integer, float-with-tolerance, symbolic, and
// a two-blank problem to verify propagation waits for both.

import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { mountFixture, resetKernel, inspect } from 'ximera-core/conformance';
import { dispatch } from 'ximera-core/kernel';

import { readFixtureBody, reloadComponent, simulateMathJaxPlaceholders } from './helpers.js';

async function setup() {
  resetKernel();
  const mod = await reloadComponent('ximera-answer');
  const body = simulateMathJaxPlaceholders(readFixtureBody('ximera-answer'));
  const mounted = await mountFixture(body);
  await mod.mountReady();
  return { ...mounted, mod };
}

test('answer fixture: 4 problems, 7 answer blanks (one quadruple), all top-level available', async () => {
  await setup();
  const problems = [...document.querySelectorAll('.problem-environment')]
    .filter((p) => !p.parentElement?.closest('.problem-environment'));
  assert.equal(problems.length, 4);
  for (const p of problems) assert.ok(p.dataset.state.split(/\s+/).includes('available'));
  const blanks = document.querySelectorAll('.answer.respondable');
  assert.equal(blanks.length, 7);   // 1 + 1 + 1 + 4
});

test('answer fixture: correct integer completes problem 1', async () => {
  const { agent } = await setup();
  const a1 = document.getElementById('ximera-answer-1');
  const input = document.querySelector(`.ximera-answer-input[data-answer-id="${a1.id}"]`);
  input.value = '17';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.querySelector(`.ximera-check-btn[data-answer-id="${a1.id}"]`).click();

  const { model } = inspect();
  assert.equal(model[a1.id].correct, true);
  assert.equal(model[a1.closest('.problem-environment').id].complete, true);
  assert.ok(agent.lastProgress > 0);
});

test('answer fixture: float w/ tolerance', async () => {
  await setup();
  const a2 = document.getElementById('ximera-answer-2');
  const input = document.querySelector(`.ximera-answer-input[data-answer-id="${a2.id}"]`);
  input.value = '1.42';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.querySelector(`.ximera-check-btn[data-answer-id="${a2.id}"]`).click();
  const { model } = inspect();
  assert.equal(model[a2.id].correct, true);
});

test('answer fixture: symbolic answer', async () => {
  await setup();
  const a3 = document.getElementById('ximera-answer-3');
  const input = document.querySelector(`.ximera-answer-input[data-answer-id="${a3.id}"]`);
  input.value = 'x + x';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.querySelector(`.ximera-check-btn[data-answer-id="${a3.id}"]`).click();
  const { model } = inspect();
  assert.equal(model[a3.id].correct, true);
});

test('answer fixture: four-blank problem needs all four to complete', async () => {
  await setup();
  const nested = [...document.querySelectorAll('.answer.respondable')].slice(3);
  assert.equal(nested.length, 4);
  const outerProblem = nested[0].closest('.problem-environment');

  function complete(el) {
    const input = document.querySelector(
      `.ximera-answer-input[data-answer-id="${el.id}"]`
    );
    input.value = el.dataset.correctText;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    document
      .querySelector(`.ximera-check-btn[data-answer-id="${el.id}"]`)
      .click();
  }

  // Complete three of four → outer still incomplete.
  complete(nested[0]);
  complete(nested[1]);
  complete(nested[2]);
  {
    const { model } = inspect();
    assert.equal(model[outerProblem.id].complete, false);
  }

  // Complete the fourth → outer completes.
  complete(nested[3]);
  {
    const { model } = inspect();
    for (const el of nested) assert.equal(model[el.id].complete, true);
    assert.equal(model[outerProblem.id].complete, true);
  }
});

test('answer fixture: reset clears all answers, restores empty inputs', async () => {
  const { agent } = await setup();
  const a1 = document.getElementById('ximera-answer-1');
  const input = document.querySelector(`.ximera-answer-input[data-answer-id="${a1.id}"]`);
  input.value = '17';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.querySelector(`.ximera-check-btn[data-answer-id="${a1.id}"]`).click();
  assert.equal(input.disabled, true);

  dispatch({ type: 'RESET_WORK' });
  const { model } = inspect();
  assert.equal(model[a1.id], undefined);
  assert.equal(input.value, '');
  assert.equal(input.disabled, false);
  assert.equal(agent.lastProgress, 0);
});
