// Happy-dom conformance tests for the ximera-answer mount + reducers +
// render. Fixtures pre-populate the placeholder span at the id that
// data-placeholder-id points to, simulating MathJax having typeset the
// \cssId'd \phantom into a real DOM element.

import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { mountFixture, resetKernel, inspect } from 'ximera-core/conformance';
import { dispatch } from 'ximera-core/kernel';

async function loadAnswer() {
  const url = new URL('../index.js', import.meta.url).href + `?c=${Math.random()}`;
  return import(url);
}

async function setup(html, options) {
  resetKernel();
  const mod = await loadAnswer();
  const mounted = await mountFixture(html, options);
  // Wait for the async Phase B mount to complete.
  await mod.mountReady();
  return { ...mounted, mod };
}

// Fixture: one integer answer with a pre-populated placeholder.
function oneIntFixture() {
  return `
    <div class="problem-environment" id="p-1" role="article">
      My favorite number is <span class="ximera-math-with-answers">
        <span class="mathjax-inline">
          <span id="placeholder-1"></span>
        </span>
        <span class="answer respondable"
              id="a-1"
              data-placeholder-id="placeholder-1"
              data-correct-text="17"
              style="display:none"></span>
      </span>.
    </div>
  `;
}

function floatFixture() {
  return `
    <div class="problem-environment" id="p-2" role="article">
      Approx: <span class="ximera-math-with-answers">
        <span class="mathjax-inline"><span id="placeholder-2"></span></span>
        <span class="answer respondable"
              id="a-2"
              data-placeholder-id="placeholder-2"
              data-correct-text="1.414"
              data-format="float"
              data-tolerance="0.01"
              style="display:none"></span>
      </span>.
    </div>
  `;
}

function symbolicFixture() {
  return `
    <div class="problem-environment" id="p-3" role="article">
      Simplify: <span class="ximera-math-with-answers">
        <span class="mathjax-inline"><span id="placeholder-3"></span></span>
        <span class="answer respondable"
              id="a-3"
              data-placeholder-id="placeholder-3"
              data-correct-text="2*x"
              style="display:none"></span>
      </span>.
    </div>
  `;
}

// Fixture: an \answer{\sqrt{2}} case. data-correct-mathml is pre-set (in
// production it's populated by mountPhaseB after MathJax.tex2mml — but
// happy-dom has no MathJax, so we prime it directly to exercise the same
// path the reducer takes).
function sqrt2MathmlFixture() {
  return `
    <div class="problem-environment" id="p-5" role="article">
      Simplify: <span class="ximera-math-with-answers">
        <span class="mathjax-inline"><span id="placeholder-5"></span></span>
        <span class="answer respondable"
              id="a-5"
              data-placeholder-id="placeholder-5"
              data-correct-text="\\sqrt{2}"
              data-correct-mathml="&lt;math&gt;&lt;msqrt&gt;&lt;mn&gt;2&lt;/mn&gt;&lt;/msqrt&gt;&lt;/math&gt;"
              style="display:none"></span>
      </span>.
    </div>
  `;
}

function twoBlanksFixture() {
  return `
    <div class="problem-environment" id="p-4" role="article">
      <span class="ximera-math-with-answers">
        <span class="mathjax-inline">
          <span id="placeholder-4a"></span>
          <span id="placeholder-4b"></span>
        </span>
        <span class="answer respondable" id="a-4a"
              data-placeholder-id="placeholder-4a" data-correct-text="3"
              style="display:none"></span>
        <span class="answer respondable" id="a-4b"
              data-placeholder-id="placeholder-4b" data-correct-text="4"
              style="display:none"></span>
      </span>
    </div>
  `;
}

function typeAndCheck(answerId, value) {
  const input = document.querySelector(`.ximera-answer-input[data-answer-id="${answerId}"]`);
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  const btn = document.querySelector(`.ximera-check-btn[data-answer-id="${answerId}"]`);
  btn.click();
}

// ─── 1. Mount idempotence ──────────────────────────────────────────────────

test('mount: creates one input, one check button, one popover per answer', async () => {
  await setup(oneIntFixture());
  assert.equal(document.querySelectorAll('.ximera-answer-input').length, 1);
  assert.equal(document.querySelectorAll('.ximera-check-btn').length, 1);
  assert.equal(document.querySelectorAll('.ximera-math-popover').length, 1);
  const input = document.querySelector('.ximera-answer-input');
  assert.equal(input.getAttribute('aria-label'), 'answer');
  const btn = document.querySelector('.ximera-check-btn');
  assert.equal(btn.getAttribute('aria-label'), 'check work');
});

// ─── 2. Correct integer completes the problem ──────────────────────────────

test('correct integer answer completes the problem, disables input, Check turns green', async () => {
  const { agent } = await setup(oneIntFixture());
  typeAndCheck('a-1', '17');
  const { model } = inspect();
  assert.equal(model['a-1'].correct, true);
  assert.equal(model['a-1'].complete, true);
  assert.equal(model['p-1'].complete, true);
  const answerEl = document.getElementById('a-1');
  assert.ok(answerEl.dataset.state.split(/\s+/).includes('correct'));
  const input = document.querySelector('.ximera-answer-input');
  assert.equal(input.disabled, true);
  const btn = document.querySelector('.ximera-check-btn');
  assert.notEqual(btn.style.display, 'none');
  assert.equal(btn.dataset.state, 'correct');
  assert.equal(agent.lastProgress, 1);
});

// ─── 3. Wrong integer is attempted, retry-able ─────────────────────────────

test('wrong answer records attempt, keeps input enabled, Check turns red', async () => {
  const { agent } = await setup(oneIntFixture());
  typeAndCheck('a-1', '18');
  const { model } = inspect();
  assert.equal(model['a-1'].correct, false);
  assert.equal(model['a-1'].attempt, '18');
  assert.equal(model['p-1'].complete, false);
  const answerEl = document.getElementById('a-1');
  assert.ok(answerEl.dataset.state.split(/\s+/).includes('attempted'));
  const input = document.querySelector('.ximera-answer-input');
  assert.equal(input.disabled, false);
  const btn = document.querySelector('.ximera-check-btn');
  assert.notEqual(btn.style.display, 'none');
  assert.equal(btn.dataset.state, 'attempted');
  assert.equal(agent.lastProgress, 0);
});

// Editing the input after a wrong check clears the red badge until the
// student presses Check again — but if they type back to the same wrong
// value the badge reappears without a re-check. Matches original-server.
test('incorrect state clears when input diverges, reappears on match', async () => {
  await setup(oneIntFixture());
  typeAndCheck('a-1', '18');
  const btn = document.querySelector('.ximera-check-btn');
  assert.equal(btn.dataset.state, 'attempted');

  const input = document.querySelector('.ximera-answer-input');
  input.value = '19';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(btn.dataset.state, '');

  input.value = '18';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(btn.dataset.state, 'attempted');
});

// ─── 4. Float w/ tolerance ─────────────────────────────────────────────────

test('float with tolerance: 1.42 vs 1.414 tol 0.01 → correct', async () => {
  await setup(floatFixture());
  typeAndCheck('a-2', '1.42');
  const { model } = inspect();
  assert.equal(model['a-2'].correct, true);
  assert.equal(model['p-2'].complete, true);
});

test('float with tolerance: 1.5 vs 1.414 tol 0.01 → wrong', async () => {
  await setup(floatFixture());
  typeAndCheck('a-2', '1.5');
  const { model } = inspect();
  assert.equal(model['a-2'].correct, false);
});

// ─── 5. Symbolic ───────────────────────────────────────────────────────────

test('symbolic: x+x vs 2*x → correct', async () => {
  await setup(symbolicFixture());
  typeAndCheck('a-3', 'x+x');
  const { model } = inspect();
  assert.equal(model['a-3'].correct, true);
  assert.equal(model['p-3'].complete, true);
});

// ─── 5b. MathML-authored answer ────────────────────────────────────────────
//
// End-to-end: with data-correct-mathml populated (as mountPhaseB does in
// production via MathJax.tex2mml), the CHECK reducer forwards the MathML
// through to checkAnswer, which parses it via math-expressions.fromMml.
// The student can type either LaTeX \sqrt{2} or the text form sqrt(2) and
// still get credit.

test('MathML: student sqrt(2) matches \\answer{\\sqrt{2}}', async () => {
  await setup(sqrt2MathmlFixture());
  typeAndCheck('a-5', 'sqrt(2)');
  const { model } = inspect();
  assert.equal(model['a-5'].correct, true);
  assert.equal(model['p-5'].complete, true);
});

test('MathML: student \\sqrt{2} matches \\answer{\\sqrt{2}}', async () => {
  await setup(sqrt2MathmlFixture());
  typeAndCheck('a-5', '\\sqrt{2}');
  const { model } = inspect();
  assert.equal(model['a-5'].correct, true);
});

test('MathML: wrong student answer stays wrong', async () => {
  await setup(sqrt2MathmlFixture());
  typeAndCheck('a-5', 'sqrt(3)');
  const { model } = inspect();
  assert.equal(model['a-5'].correct, false);
});

// ─── 6. Focus guard ────────────────────────────────────────────────────────

test('focus guard: server pageState-changed does not stomp input.value while focused', async () => {
  await setup(oneIntFixture());
  const input = document.querySelector('.ximera-answer-input');
  input.value = '1';
  input.focus();
  Object.defineProperty(document, 'activeElement', {
    configurable: true, get: () => input,
  });
  // Server push: another client wrote "server-value"
  dispatch({
    type: 'PAGE_STATE_RESTORED',
    pageState: { 'a-1': { response: 'server-value' } },
  });
  // Focus guard should keep the local value
  assert.equal(input.value, '1');
});

// ─── 7. Persistence round-trip ─────────────────────────────────────────────

test('persistence: correct-answer state survives JSON round-trip', async () => {
  const { agent } = await setup(oneIntFixture());
  typeAndCheck('a-1', '17');
  const captured = JSON.parse(JSON.stringify(agent.lastPageState));
  assert.equal(captured['a-1'].correct, true);
  assert.equal(captured['a-1'].response, '17');

  await setup(oneIntFixture(), { initialPageState: captured });
  const input = document.querySelector('.ximera-answer-input');
  assert.equal(input.disabled, true);
  assert.equal(input.value, '17');
  const btn = document.querySelector('.ximera-check-btn');
  assert.notEqual(btn.style.display, 'none');
  assert.equal(btn.dataset.state, 'correct');
});

// ─── 8. Reset behaves like first visit ─────────────────────────────────────

test('reset: after correct, RESET_WORK clears entry, re-enables input', async () => {
  const { agent } = await setup(oneIntFixture());
  typeAndCheck('a-1', '17');
  assert.equal(agent.lastProgress, 1);

  dispatch({ type: 'RESET_WORK' });
  const { model } = inspect();
  assert.equal(model['a-1'], undefined);
  assert.equal(model['p-1'].complete, false);
  const input = document.querySelector('.ximera-answer-input');
  assert.equal(input.disabled, false);
  assert.equal(input.value, '');
  const btn = document.querySelector('.ximera-check-btn');
  assert.notEqual(btn.style.display, 'none');
  assert.equal(agent.lastProgress, 0);
});

// ─── 9. Two blanks in one problem ──────────────────────────────────────────

test('two blanks: problem completes only when both are correct', async () => {
  await setup(twoBlanksFixture());
  typeAndCheck('a-4a', '3');
  {
    const { model } = inspect();
    assert.equal(model['a-4a'].complete, true);
    assert.equal(model['p-4'].complete, false);   // a-4b unanswered
  }
  typeAndCheck('a-4b', '4');
  {
    const { model } = inspect();
    assert.equal(model['a-4a'].complete, true);
    assert.equal(model['a-4b'].complete, true);
    assert.equal(model['p-4'].complete, true);
  }
});

// ─── 10. Popover surfaces for non-numeric input ────────────────────────────

test('popover: symbolic input unhides popover; numeric-only keeps it hidden', async () => {
  await setup(symbolicFixture());
  const input = document.querySelector('.ximera-answer-input');
  const popover = document.querySelector('.ximera-math-popover');

  // Numeric-only in default (expression) mode: 300ms debounce applies.
  input.value = '5';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 320));
  assert.equal(popover.hidden, true);

  // Symbolic input: popover unhides.
  input.value = '2x';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 320));
  assert.equal(popover.hidden, false);
  assert.ok(popover.textContent.startsWith('\\('));
});

// A pending debounced popover call that fires AFTER the student's
// correct-answer render must not re-show the popover on the now-disabled
// input — the input can't be blurred back, so nothing else would hide it.
test('popover: correct answer hides popover even against a pending debounce', async () => {
  await setup(symbolicFixture());
  const input = document.querySelector('.ximera-answer-input');
  const popover = document.querySelector('.ximera-math-popover');

  // Type a symbolic value and immediately click Check — the input event
  // schedules updatePopover for +300ms, and the click marks the answer
  // correct within that window.
  typeAndCheck('a-3', 'x+x');
  const { model } = inspect();
  assert.equal(model['a-3'].correct, true);
  assert.equal(input.disabled, true);

  // Let the debounced popover callback fire; it must NOT re-show.
  await new Promise(r => setTimeout(r, 320));
  assert.equal(popover.hidden, true);
});
