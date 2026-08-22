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

// Simulate a user selecting a choice by clicking the option element.
// Works even when the panel is hidden (programmatic click bypasses visibility).
function selectChoice(wcEl, choiceId) {
  const opt = wcEl.querySelector(`.ximera-word-option[data-choice-id="${choiceId}"]`);
  opt.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

function getWidget(wcEl) {
  return wcEl.querySelector('.ximera-word-select');
}

function isLocked(wcEl) {
  return getWidget(wcEl)?.getAttribute('aria-disabled') === 'true';
}

// ─── Spec §10 Examples ─────────────────────────────────────────────────────

test('spec example 1: bootstrap with empty pageState', async () => {
  await setup(ohio);
  const { model } = inspect();
  assert.equal(model['problem-1'].available, true);
  assert.equal(model['problem-1'].complete, false);
  assert.equal(model['wc-1'], undefined);

  const wc = document.getElementById('wc-1');
  const widget = getWidget(wc);
  assert.ok(widget, 'custom widget created');

  const opts = wc.querySelectorAll('.ximera-word-option');
  assert.equal(opts.length, 3);
  assert.equal(opts[0].textContent.trim(), 'Cleveland');

  const display = widget.querySelector('.ximera-word-select__display');
  assert.equal(display.textContent, '—');
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
  assert.equal(isLocked(document.getElementById('wc-1')), false);
  assert.equal(agent.lastProgress, 0);
});

test('spec example 3: select correct option → complete + propagation', async () => {
  const { agent } = await setup(ohio);
  selectChoice(document.getElementById('wc-1'), 'c-b');
  const { model } = inspect();
  assert.equal(model['wc-1'].correct, true);
  assert.equal(model['wc-1'].complete, true);
  assert.equal(document.getElementById('wc-1').dataset.state, 'correct');
  assert.equal(isLocked(document.getElementById('wc-1')), true);
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
  assert.equal(isLocked(document.getElementById('wc-1')), false);
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

  const wc = document.getElementById('wc-1');
  assert.equal(getWidget(wc).dataset.chosen, 'c-b');
  assert.equal(isLocked(wc), true);
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

  const wc = document.getElementById('wc-1');
  assert.equal(isLocked(wc), false);
  assert.equal(getWidget(wc).dataset.chosen, '');
});

test('spec example 7: bootstrap directly with pre-completed state', async () => {
  await setup(ohio, {
    initialPageState: {
      'wc-1': { chosen: 'c-b', checked: 'c-b', correct: true, complete: true },
    },
  });
  const { model } = inspect();
  assert.equal(model['problem-1'].complete, true);

  const wc = document.getElementById('wc-1');
  assert.equal(getWidget(wc).dataset.chosen, 'c-b');
  assert.equal(isLocked(wc), true);
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
  // Click an option programmatically after locking — reducer must guard.
  const opt = document.querySelector('.ximera-word-option[data-choice-id="c-a"]');
  opt.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(agent.pageStateCalls.length, before, 'no-op after correct');
});

// ─── Custom dropdown structure ─────────────────────────────────────────────

test('options preserve innerHTML of .choice spans (math-safe)', async () => {
  const html = `
    <div class="problem-environment" id="p-math" role="article">
      <span class="word-choice" id="wc-math">
        <span class="choice" id="m-a"><mjx-container>√2</mjx-container></span>
        <span class="choice correct" id="m-b"><mjx-container>√3</mjx-container></span>
      </span>
    </div>
  `;
  await setup(html);
  const opts = document.querySelectorAll('.ximera-word-option');
  assert.ok(opts[0].innerHTML.includes('mjx-container'), 'math HTML preserved in option');
  assert.ok(opts[1].innerHTML.includes('mjx-container'), 'math HTML preserved in option');
});

test('panel is hidden by default; clicking trigger opens it', async () => {
  await setup(ohio);
  const widget = document.querySelector('.ximera-word-select');
  const panel = widget.querySelector('.ximera-word-select__panel');
  assert.equal(panel.hidden, true);
  assert.equal(widget.getAttribute('aria-expanded'), 'false');

  widget.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(panel.hidden, false);
  assert.equal(widget.getAttribute('aria-expanded'), 'true');
});
