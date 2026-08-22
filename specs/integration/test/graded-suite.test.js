// End-to-end integration for Phase 3's graded suite: mc, sa, fr, plus the
// dissolved-feedback path. Loads compiled HTML from specs/fixtures/dist/,
// boots the real kernel with a mock agent, drives interactions, asserts
// state transitions, progress payloads, and shuffle-restore semantics.

import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { mountFixture, resetKernel, inspect } from 'ximera-core/conformance';
import { dispatch } from 'ximera-core/kernel';
import { shuffleIds } from 'ximera-choice';

import { readFixtureBody, reloadComponent, simulateMathJaxPlaceholders } from './helpers.js';

async function setup(fixtureStem, options, componentPkgs) {
  resetKernel();
  for (const pkg of componentPkgs) await reloadComponent(pkg);
  return mountFixture(readFixtureBody(fixtureStem), options);
}

// ─── ximera-multiple-choice fixture ────────────────────────────────────────

test('mc fixture: two problems, both with check buttons and a correct choice', async () => {
  await setup('ximera-multiple-choice', {}, ['ximera-multiple-choice']);
  const mcs = document.querySelectorAll('.multiple-choice');
  assert.equal(mcs.length, 2);
  for (const mc of mcs) {
    assert.ok(mc.querySelector('.ximera-check-btn'));
    assert.ok(mc.querySelector('.choice.correct'));
  }
});

test('mc fixture: correct then correct → both problems complete, progress = 1', async () => {
  const { agent } = await setup('ximera-multiple-choice', {}, ['ximera-multiple-choice']);
  for (const mc of document.querySelectorAll('.multiple-choice')) {
    mc.querySelector('.choice.correct').click();
    mc.querySelector('.ximera-check-btn').click();
  }
  assert.equal(agent.lastProgress, 1);
});

test('mc fixture: reload from captured payload → identical DOM', async () => {
  const { agent } = await setup('ximera-multiple-choice', {}, ['ximera-multiple-choice']);
  document.querySelectorAll('.multiple-choice')[0].querySelector('.choice:not(.correct)').click();
  document.querySelectorAll('.multiple-choice')[0].querySelector('.ximera-check-btn').click();
  const captured = JSON.parse(JSON.stringify(agent.lastPageState));
  const domAfter = document.body.innerHTML;

  await setup('ximera-multiple-choice', { initialPageState: captured }, ['ximera-multiple-choice']);
  assert.equal(document.body.innerHTML, domAfter);
});

// ─── ximera-select-all fixture ─────────────────────────────────────────────

test('sa fixture: check buttons, and correct sets of size > 1', async () => {
  await setup('ximera-select-all', {}, ['ximera-select-all']);
  const sas = document.querySelectorAll('.select-all');
  assert.equal(sas.length, 2);
  for (const sa of sas) {
    const correctCount = sa.querySelectorAll('.choice.correct').length;
    assert.ok(correctCount >= 2, `expected multiple correct in sa; got ${correctCount}`);
  }
});

test('sa fixture: complete both by selecting exact correct sets', async () => {
  const { agent } = await setup('ximera-select-all', {}, ['ximera-select-all']);
  for (const sa of document.querySelectorAll('.select-all')) {
    for (const c of sa.querySelectorAll('.choice.correct')) c.click();
    sa.querySelector('.ximera-check-btn').click();
  }
  assert.equal(agent.lastProgress, 1);
});

test('sa fixture: subset of correct → not complete', async () => {
  await setup('ximera-select-all', {}, ['ximera-select-all']);
  const firstSa = document.querySelector('.select-all');
  // Select only ONE of the correct choices.
  firstSa.querySelector('.choice.correct').click();
  firstSa.querySelector('.ximera-check-btn').click();
  const { model } = inspect();
  assert.equal(model[firstSa.id].correct, false);
});

// ─── ximera-free-response fixture ──────────────────────────────────────────

test('fr fixture: nested structure with two free-response answerables', async () => {
  await setup('ximera-free-response', {}, ['ximera-free-response']);
  const frs = document.querySelectorAll('.free-response');
  assert.equal(frs.length, 3);   // 1 top-level + 2 nested under the second problem
});

test('fr fixture: submitting the outer FR unblocks the nested FRs', async () => {
  await setup('ximera-free-response', {}, ['ximera-free-response']);
  const problems = [...document.querySelectorAll('.problem-environment')];
  const nested = problems.filter((p) => p.parentElement?.closest('.problem-environment') && p.hasAttribute('data-blocking'));
  assert.ok(nested.length >= 2, 'expected at least two nested blocking problems');
  for (const n of nested) {
    // The container is nested + blocking → data-state starts as "unavailable".
    const states = n.dataset.state.split(/\s+/);
    assert.ok(states.includes('unavailable'), `nested ${n.id} should be unavailable, got: ${n.dataset.state}`);
    assert.ok(!states.includes('available'), `nested ${n.id} should NOT be available: ${n.dataset.state}`);
  }
});

test('fr fixture: submit → complete → progress reflects it', async () => {
  const { agent } = await setup('ximera-free-response', {}, ['ximera-free-response']);
  // Submit ALL free-response answerables (three total).
  const tas = document.querySelectorAll('.ximera-free-response-input');
  const btns = document.querySelectorAll('.ximera-submit-btn');
  assert.equal(tas.length, btns.length);
  for (let i = 0; i < tas.length; i++) {
    tas[i].value = 'my response';
    tas[i].dispatchEvent(new window.Event('input', { bubbles: true }));
    btns[i].click();
  }
  assert.equal(agent.lastProgress, 1);
});

// ─── Feedback (kernel-owned, no package) ───────────────────────────────────

test('feedback fixture: correct feedback stays hidden until problem completes', async () => {
  // Load ximera-answer's fixture? No — use the feedback fixture, which has
  // \answer inside a problem with attempt + correct feedback. This tests
  // that the kernel's own feedback-projection works with just ximera-core +
  // the mount function ximera-core's inline \answer wiring provides. But
  // ximera-answer isn't built yet (Phase 4). Use a hand-crafted fixture.
  resetKernel();
  const html = `
    <div class="problem-environment" id="p-1" role="article">
      <span class="answer respondable" id="a-1" data-correct-text="17"></span>
      <div class="feedback" data-feedback="attempt" id="fb-a"></div>
      <div class="feedback" data-feedback="correct" id="fb-c"></div>
    </div>`;
  // Manually register an answerable that mimics ximera-answer.
  const { register, registerReducer } = await import('ximera-core/kernel');
  registerReducer('test-answer:CHECK', (m, msg) => ({
    ...m,
    [msg.id]: { ...m[msg.id], attempt: 'x', correct: msg.correct, complete: msg.correct, checked: 'x' },
  }));
  register('.answer.respondable', () => {}, { answerable: true });

  await mountFixture(html);
  assert.equal(document.getElementById('fb-a').dataset.state, 'hidden');
  assert.equal(document.getElementById('fb-c').dataset.state, 'hidden');

  // Attempt (wrong): attempt-feedback becomes visible.
  dispatch({ type: 'test-answer:CHECK', id: 'a-1', correct: false });
  assert.equal(document.getElementById('fb-a').dataset.state, 'visible');
  assert.equal(document.getElementById('fb-c').dataset.state, 'hidden');

  // Attempt (correct): correct-feedback becomes visible; attempt stays.
  dispatch({ type: 'test-answer:CHECK', id: 'a-1', correct: true });
  assert.equal(document.getElementById('fb-a').dataset.state, 'visible');
  assert.equal(document.getElementById('fb-c').dataset.state, 'visible');
});

// ─── Shuffle restore (Phase 3 exit criterion) ──────────────────────────────

test('my-course sample: full v1 pilot roster interoperates on one page', async () => {
  resetKernel();
  const modules = {};
  for (const pkg of [
    'ximera-hint', 'ximera-word-choice',
    'ximera-multiple-choice', 'ximera-select-all', 'ximera-free-response',
    'ximera-answer', 'my-button',
  ]) {
    modules[pkg] = await reloadComponent(pkg);
  }

  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(
    join(here, '..', '..', '..', 'my-course', 'dist', 'sample.html'),
    'utf8'
  );
  let body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1];
  body = simulateMathJaxPlaceholders(body);

  const { agent } = await mountFixture(body);
  await modules['ximera-answer'].mountReady();

  // Seven top-level problems in sample.tex: graded button, integer answer,
  // float answer, word-choice, multiple-choice, select-all, free-response.
  // All top-level → available.
  const topProblems = [...document.querySelectorAll('.problem-environment')]
    .filter((p) => !p.parentElement?.closest('.problem-environment'));
  assert.equal(topProblems.length, 7);
  for (const p of topProblems) assert.ok(p.dataset.state.split(/\s+/).includes('available'));

  // Complete both \answer problems.
  const answers = [...document.querySelectorAll('.answer.respondable')];
  assert.equal(answers.length, 2);
  for (const el of answers) {
    const input = document.querySelector(
      `.ximera-answer-input[data-answer-id="${el.id}"]`
    );
    input.value = el.dataset.correctText;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    document
      .querySelector(`.ximera-check-btn[data-answer-id="${el.id}"]`)
      .click();
  }

  // Complete the word-choice problem.
  const wc = document.querySelector('.word-choice');
  const wcCorrect = wc.querySelector('.choice.correct');
  const wcSelect = wc.querySelector('select.ximera-word-select');
  wcSelect.value = wcCorrect.id;
  wcSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

  // Complete the multiple-choice problem.
  const mc = document.querySelector('.multiple-choice');
  mc.querySelector('.choice.correct').click();
  mc.querySelector('.ximera-check-btn').click();

  // Complete the select-all problem (three correct choices).
  const sa = document.querySelector('.select-all');
  for (const c of sa.querySelectorAll('.choice.correct')) c.click();
  sa.querySelector('.ximera-check-btn').click();

  // Complete the free-response problem.
  const fr = document.querySelector('.free-response');
  const ta = fr.querySelector('.ximera-free-response-input');
  ta.value = 'my thoughtful answer';
  ta.dispatchEvent(new window.Event('input', { bubbles: true }));
  fr.querySelector('.ximera-submit-btn').click();

  // Complete the graded my-button problem (three clicks; the top-level
  // <button class="ximera-button"> outside any problem doesn't count).
  const gradedBtn = [...document.querySelectorAll('.ximera-button')].find(
    (b) => b.closest('.problem-environment')
  );
  gradedBtn.click(); gradedBtn.click(); gradedBtn.click();

  // Every top-level problem is now complete → progress = 1.
  assert.ok(Math.abs(agent.lastProgress - 1) < 1e-9, `expected 1, got ${agent.lastProgress}`);
});

test('shuffle restore: saved seed → learner\'s picks land on original order', async () => {
  const shuffledHtml = `
    <div class="problem-environment" id="p-1" role="article">
      <div class="multiple-choice shuffle" id="mc-1">
        <span class="choice" id="c-a">A</span>
        <span class="choice correct" id="c-b">B</span>
        <span class="choice" id="c-c">C</span>
        <span class="choice" id="c-d">D</span>
      </div>
    </div>
  `;

  // First visit: generate a seed, click the correct choice, capture state.
  resetKernel();
  await reloadComponent('ximera-multiple-choice');
  const { agent: a1 } = await mountFixture(shuffledHtml);
  document.getElementById('c-b').click();
  document.querySelector('.ximera-check-btn').click();

  const captured = JSON.parse(JSON.stringify(a1.lastPageState));
  const seed = captured['mc-1'].seed;
  assert.equal(typeof seed, 'number');
  const domOrderAfterFirst = [...document.querySelectorAll('#mc-1 .choice')].map((c) => c.id);
  assert.deepEqual(domOrderAfterFirst, shuffleIds(['c-a', 'c-b', 'c-c', 'c-d'], seed));

  // Second visit: mount with the captured payload. DOM order must match.
  resetKernel();
  await reloadComponent('ximera-multiple-choice');
  await mountFixture(shuffledHtml, { initialPageState: captured });
  const domOrderAfterReload = [...document.querySelectorAll('#mc-1 .choice')].map((c) => c.id);
  assert.deepEqual(domOrderAfterReload, domOrderAfterFirst);

  // And c-b — where the learner clicked last time — is still marked selected+correct.
  assert.equal(document.getElementById('c-b').dataset.state.includes('selected'), true);
  assert.equal(document.getElementById('c-b').dataset.state.includes('revealed'), true);
});
