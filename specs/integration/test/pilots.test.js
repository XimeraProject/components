// End-to-end integration tests for the Phase 2 pilots.
// Mounts compiled HTML (from specs/fixtures/dist/) into happy-dom, boots
// the real ximera-core kernel with a mock Modulus agent, drives user
// interactions, and asserts model transitions, data-state values,
// progress payloads, and the exact JSON persisted to the agent.

import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { mountFixture, resetKernel, inspect } from 'ximera-core/conformance';
import { dispatch } from 'ximera-core/kernel';

import { readFixtureBody, reloadComponent } from './helpers.js';

async function setup(stem, options = {}, components = ['ximera-hint', 'ximera-word-choice']) {
  resetKernel();
  for (const pkg of components) await reloadComponent(pkg);
  const body = readFixtureBody(stem);
  return mountFixture(body, options);
}

// ─── ximera-hint fixture ───────────────────────────────────────────────────

test('hint fixture: three hints all hidden on fresh mount', async () => {
  await setup('ximera-hint');
  const contents = document.querySelectorAll('.xmhint-content');
  assert.equal(contents.length, 3);
  for (const el of contents) assert.equal(el.dataset.state, 'hidden');
  for (const h3 of document.querySelectorAll('h3.xmhint')) {
    assert.equal(h3.textContent, 'Hint');
    assert.equal(h3.getAttribute('aria-expanded'), 'false');
  }
});

test('hint fixture: reveal → data-state visible; persisted payload matches', async () => {
  const { agent } = await setup('ximera-hint');
  agent.pageStateCalls.length = 0;
  const [h1] = document.querySelectorAll('h3.xmhint');
  h1.click();

  const { model } = inspect();
  const contents = [...document.querySelectorAll('.xmhint-content')];
  assert.equal(contents[0].dataset.state, 'visible');
  assert.equal(contents[1].dataset.state, 'hidden');
  assert.equal(contents[2].dataset.state, 'hidden');
  assert.equal(model[contents[0].id].revealed, true);
  assert.equal(agent.pageStateCalls.length, 1);
  assert.deepEqual(agent.lastPageState[contents[0].id], { revealed: true });
});

test('hint fixture: reload from captured payload → identical DOM', async () => {
  const { agent } = await setup('ximera-hint');
  document.querySelectorAll('h3.xmhint')[1].click();
  const captured = JSON.parse(JSON.stringify(agent.lastPageState));
  const domAfterInteract = document.body.innerHTML;

  await setup('ximera-hint', { initialPageState: captured });
  assert.equal(document.body.innerHTML, domAfterInteract);
});

// ─── ximera-word-choice fixture ────────────────────────────────────────────

test('word-choice fixture: two problems, both available at mount', async () => {
  await setup('ximera-word-choice');
  const problems = [...document.querySelectorAll('.problem-environment[id^="problem"]')];
  for (const p of problems) {
    assert.equal(p.dataset.state.includes('available'), true);
    assert.equal(p.dataset.state.includes('complete'), false);
  }
  // Two word-choice spans, each got a <select>.
  const wcs = document.querySelectorAll('.word-choice');
  assert.equal(wcs.length, 2);
  for (const wc of wcs) assert.ok(wc.querySelector('select.ximera-word-select'));
});

test('word-choice fixture: correct selection completes problem, progress updates', async () => {
  const { agent } = await setup('ximera-word-choice');
  const [wc1] = document.querySelectorAll('.word-choice');
  const problem1 = wc1.closest('.problem-environment');
  const correctChoice = wc1.querySelector('.choice.correct');

  const sel = wc1.querySelector('select.ximera-word-select');
  sel.value = correctChoice.id;
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));

  const { model } = inspect();
  assert.equal(model[wc1.id].correct, true);
  assert.equal(model[wc1.id].complete, true);
  assert.equal(model[problem1.id].complete, true);
  assert.equal(wc1.dataset.state, 'correct');
  // 1 of 2 problems complete → progress = 0.5
  assert.equal(agent.lastProgress, 0.5);
});

test('word-choice fixture: incorrect selection is attempted, retry-able', async () => {
  const { agent } = await setup('ximera-word-choice');
  const wc1 = document.querySelector('.word-choice');
  const wrong = wc1.querySelector('.choice:not(.correct)');
  const sel = wc1.querySelector('select.ximera-word-select');
  sel.value = wrong.id;
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));

  const { model } = inspect();
  assert.equal(model[wc1.id].correct, false);
  assert.equal(wc1.dataset.state, 'attempted');
  assert.equal(sel.disabled, false);
  assert.equal(agent.lastProgress, 0);
});

test('word-choice fixture: both correct → progress = 1', async () => {
  const { agent } = await setup('ximera-word-choice');
  for (const wc of document.querySelectorAll('.word-choice')) {
    const correct = wc.querySelector('.choice.correct');
    const sel = wc.querySelector('select.ximera-word-select');
    sel.value = correct.id;
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  assert.equal(agent.lastProgress, 1);
});

test('word-choice fixture: reset restores first-visit', async () => {
  const { agent } = await setup('ximera-word-choice');
  // Complete both.
  for (const wc of document.querySelectorAll('.word-choice')) {
    const correct = wc.querySelector('.choice.correct');
    const sel = wc.querySelector('select.ximera-word-select');
    sel.value = correct.id;
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  assert.equal(agent.lastProgress, 1);

  agent.progressCalls.length = 0;
  dispatch({ type: 'RESET_WORK' });
  const { model } = inspect();
  for (const wc of document.querySelectorAll('.word-choice')) {
    assert.equal(model[wc.id], undefined);
    const sel = wc.querySelector('select.ximera-word-select');
    assert.equal(sel.value, '');
    assert.equal(sel.disabled, false);
  }
  assert.equal(agent.lastProgress, 0);
});

// ─── Full my-course sample.html (both pilots together) ─────────────────────

test('my-course sample: hints + word-choice on the same page, together', async () => {
  resetKernel();
  await reloadComponent('ximera-hint');
  await reloadComponent('ximera-word-choice');

  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(
    join(here, '..', '..', '..', 'my-course', 'dist', 'sample.html'),
    'utf8'
  );
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1];

  const { agent } = await mountFixture(body);

  // Hints: two, all hidden at mount.
  const hints = document.querySelectorAll('.xmhint-content');
  assert.equal(hints.length, 2);
  for (const h of hints) assert.equal(h.dataset.state, 'hidden');

  // Word-choice: one problem, still incomplete.
  const wc = document.querySelector('.word-choice');
  assert.ok(wc);
  const problem = wc.closest('.problem-environment');
  assert.equal(problem.dataset.state.includes('complete'), false);

  // Reveal the first hint. Word-choice unaffected, no completion.
  document.querySelectorAll('h3.xmhint')[0].click();
  {
    const { model } = inspect();
    assert.equal(model[hints[0].id].revealed, true);
    assert.equal(problem.dataset.state.includes('complete'), false);
  }

  // Answer the word-choice correctly. Problem completes; progress reflects it.
  const correct = wc.querySelector('.choice.correct');
  const sel = wc.querySelector('select.ximera-word-select');
  sel.value = correct.id;
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  {
    const { model } = inspect();
    assert.equal(model[problem.id].complete, true);
  }

  // Progress: my-course/sample.tex has SIX top-level problems (Phase 4
  // added the float-tolerance answer demo). Only one (word-choice) is
  // complete here, so progress is 1/6.
  assert.equal(Math.abs(agent.lastProgress - 1 / 6) < 1e-9, true,
    `expected ~1/6, got ${agent.lastProgress}`);
});
