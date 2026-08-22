import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  registerReducer, runReduce, initializeAvailability, propagateCorrectness,
  _resetReducers,
} from '../update.js';
import { register, _resetMounts } from '../mounts.js';

function resetAll() {
  _resetReducers();
  _resetMounts();
  document.body.innerHTML = '';
}

// ─── registerReducer validation ────────────────────────────────────────────

test('registerReducer rejects core-owned types', () => {
  resetAll();
  assert.throws(() => registerReducer('PAGE_STATE_RESTORED', () => {}), /core-owned/);
  assert.throws(() => registerReducer('AGENT_READY_OFFLINE', () => {}), /core-owned/);
  assert.throws(() => registerReducer('RESET_WORK', () => {}), /core-owned/);
});

test('registerReducer rejects duplicate types', () => {
  resetAll();
  registerReducer('ximera-x:TEST', (m) => m);
  assert.throws(() => registerReducer('ximera-x:TEST', (m) => m), /already registered/);
});

// ─── initializeAvailability ────────────────────────────────────────────────

test('initializeAvailability: top-level problem gets available/experienced', () => {
  resetAll();
  document.body.innerHTML = `<div class="problem-environment" id="p-1"></div>`;
  const model = initializeAvailability({});
  assert.equal(model['p-1'].available, true);
  assert.equal(model['p-1'].complete, false);
  assert.equal(model['p-1'].experienced, true);
});

test('initializeAvailability: nested blocking starts unavailable', () => {
  resetAll();
  register('.answerable', () => {}, { answerable: true });
  document.body.innerHTML = `
    <div class="problem-environment" id="outer">
      <span class="answerable" id="a-1"></span>
      <div class="problem-environment" id="inner">
        <span class="answerable" id="a-2"></span>
      </div>
    </div>`;
  const model = initializeAvailability({});
  assert.equal(model['outer'].available, true);
  assert.equal(model['inner'].available, false);
  assert.equal(model['inner'].experienced, false);
});

test('initializeAvailability: preserves persisted available=true', () => {
  resetAll();
  register('.answerable', () => {}, { answerable: true });
  document.body.innerHTML = `
    <div class="problem-environment" id="outer">
      <span class="answerable" id="a-1"></span>
      <div class="problem-environment" id="inner">
        <span class="answerable" id="a-2"></span>
      </div>
    </div>`;
  const model = initializeAvailability({ inner: { available: true, complete: false } });
  assert.equal(model['inner'].available, true);
  assert.equal(model['inner'].experienced, true); // newly-available → experienced
});

test('initializeAvailability: D3 sets data-blocking at runtime', () => {
  resetAll();
  register('.answerable', () => {}, { answerable: true });
  document.body.innerHTML = `
    <div class="problem-environment" id="outer">
      <div class="problem-environment" id="inner">
        <span class="answerable" id="a-1"></span>
      </div>
    </div>`;
  const inner = document.getElementById('inner');
  assert.equal(inner.hasAttribute('data-blocking'), false);
  initializeAvailability({});
  assert.equal(inner.hasAttribute('data-blocking'), true);
});

test('initializeAvailability: preserves unknown keys (forward-tolerant)', () => {
  resetAll();
  document.body.innerHTML = `<div class="problem-environment" id="p-1"></div>`;
  const model = initializeAvailability({ 'p-1': { futureKey: 42 } });
  assert.equal(model['p-1'].futureKey, 42);
});

// ─── runReduce: core reducers ──────────────────────────────────────────────

test('AGENT_READY_OFFLINE produces fresh model', () => {
  resetAll();
  document.body.innerHTML = `<div class="problem-environment" id="p-1"></div>`;
  const model = runReduce({}, { type: 'AGENT_READY_OFFLINE' });
  assert.equal(model['p-1'].available, true);
});

test('PAGE_STATE_RESTORED merges then initializes availability', () => {
  resetAll();
  register('.a', () => {}, { answerable: true });
  document.body.innerHTML = `
    <div class="problem-environment" id="outer">
      <span class="a" id="a-1"></span>
      <div class="problem-environment" id="inner">
        <span class="a" id="a-2"></span>
      </div>
    </div>`;
  const persisted = { 'inner': { available: true, complete: true }, 'a-2': { complete: true } };
  const model = runReduce({}, { type: 'PAGE_STATE_RESTORED', pageState: persisted });
  assert.equal(model['inner'].available, true);
  assert.equal(model['inner'].complete, true);
  assert.equal(model['a-2'].complete, true);
});

test('RESET_WORK clears entries and re-initializes', () => {
  resetAll();
  document.body.innerHTML = `<div class="problem-environment" id="p-1"></div>`;
  const before = { 'p-1': { available: true, complete: true, experienced: true } };
  const after = runReduce(before, { type: 'RESET_WORK' });
  assert.equal(after['p-1'].available, true);
  assert.equal(after['p-1'].complete, false);
  assert.equal(after['p-1'].experienced, true); // top-level → newly available → experienced
});

// ─── Component reducers + D1 completion diff ───────────────────────────────

test('runReduce dispatches to registered component reducer', () => {
  resetAll();
  registerReducer('ximera-x:PING', (m, msg) => ({ ...m, [msg.id]: { pinged: true } }));
  const after = runReduce({}, { type: 'ximera-x:PING', id: 'foo' });
  assert.equal(after['foo'].pinged, true);
});

test('runReduce fires propagation on complete: false → true', () => {
  resetAll();
  register('.a', () => {}, { answerable: true });
  document.body.innerHTML = `
    <div class="problem-environment" id="p-1">
      <span class="a" id="a-1"></span>
    </div>`;
  registerReducer('ximera-a:COMPLETE', (m, msg) => ({
    ...m, [msg.id]: { ...m[msg.id], complete: true },
  }));
  let model = runReduce({}, { type: 'AGENT_READY_OFFLINE' });
  model = runReduce(model, { type: 'ximera-a:COMPLETE', id: 'a-1' });
  assert.equal(model['a-1'].complete, true);
  assert.equal(model['p-1'].complete, true);   // propagated
});

test('runReduce reveals attempt feedback on checked-but-not-complete', () => {
  resetAll();
  register('.a', () => {}, { answerable: true });
  document.body.innerHTML = `
    <div class="problem-environment" id="p-1">
      <span class="a" id="a-1"></span>
      <div class="feedback" data-feedback="attempt" id="fb-attempt"></div>
    </div>`;
  registerReducer('ximera-a:CHECK', (m, msg) => ({
    ...m, [msg.id]: { ...m[msg.id], checked: 'x', correct: false, complete: false },
  }));
  let model = runReduce({}, { type: 'AGENT_READY_OFFLINE' });
  model = runReduce(model, { type: 'ximera-a:CHECK', id: 'a-1' });
  assert.equal(model['fb-attempt'].visible, true);
});

// ─── propagateCorrectness recursion ────────────────────────────────────────

test('propagateCorrectness recurses to parent', () => {
  resetAll();
  register('.a', () => {}, { answerable: true });
  document.body.innerHTML = `
    <div class="problem-environment" id="outer">
      <div class="problem-environment" id="middle">
        <div class="problem-environment" id="inner">
          <span class="a" id="a-1"></span>
        </div>
      </div>
    </div>`;
  let model = runReduce({}, { type: 'AGENT_READY_OFFLINE' });
  // Complete the answerable.
  model = { ...model, 'a-1': { complete: true } };
  model = propagateCorrectness(model, 'inner');
  assert.equal(model['inner'].complete, true);
  assert.equal(model['middle'].complete, true);
  assert.equal(model['outer'].complete, true);
});

test('propagateCorrectness reveals correct+attempt feedback on completion', () => {
  resetAll();
  register('.a', () => {}, { answerable: true });
  document.body.innerHTML = `
    <div class="problem-environment" id="p-1">
      <span class="a" id="a-1"></span>
      <div class="feedback" data-feedback="attempt" id="fb-attempt"></div>
      <div class="feedback" data-feedback="correct" id="fb-correct"></div>
    </div>`;
  let model = runReduce({}, { type: 'AGENT_READY_OFFLINE' });
  model = { ...model, 'a-1': { complete: true } };
  model = propagateCorrectness(model, 'p-1');
  assert.equal(model['fb-attempt'].visible, true);
  assert.equal(model['fb-correct'].visible, true);
});

test('propagateCorrectness uncovers direct-child blockers', () => {
  resetAll();
  register('.a', () => {}, { answerable: true });
  document.body.innerHTML = `
    <div class="problem-environment" id="outer">
      <span class="a" id="a-1"></span>
      <div class="problem-environment" id="inner">
        <span class="a" id="a-2"></span>
      </div>
    </div>`;
  let model = runReduce({}, { type: 'AGENT_READY_OFFLINE' });
  assert.equal(model['inner'].available, false);
  model = { ...model, 'a-1': { complete: true } };
  model = propagateCorrectness(model, 'outer');
  assert.equal(model['inner'].available, true);
});

// ─── theorem-like / no-answerable containers don't gate ────────────────────

test('initializeAvailability: theorem-like wrapper reveals inner problem immediately', () => {
  resetAll();
  register('.a', () => {}, { answerable: true });
  document.body.innerHTML = `
    <div class="theorem-like problem-environment" id="thm">
      <div class="problem-environment" id="inner">
        <span class="a" id="a-1"></span>
      </div>
    </div>`;
  const model = initializeAvailability({});
  // The theorem has no answerables of its own, so nothing at that level
  // could ever be "completed first". Its blocking child must therefore be
  // available from the start.
  assert.equal(model['thm'].available, true);
  assert.equal(model['inner'].available, true);
  assert.equal(model['inner'].experienced, true);
});

test('propagateCorrectness uncovers blocker through no-answerable wrapper', () => {
  resetAll();
  register('.a', () => {}, { answerable: true });
  document.body.innerHTML = `
    <div class="problem-environment" id="outer">
      <span class="a" id="a-1"></span>
      <div class="theorem-like problem-environment" id="thm">
        <div class="problem-environment" id="inner">
          <span class="a" id="a-2"></span>
        </div>
      </div>
    </div>`;
  let model = runReduce({}, { type: 'AGENT_READY_OFFLINE' });
  // Outer has answerables — it gates. Inner is still hidden while outer's
  // answer is unanswered, even though a transparent theorem sits between.
  assert.equal(model['inner'].available, false);
  model = { ...model, 'a-1': { complete: true } };
  model = propagateCorrectness(model, 'outer');
  // After the outer's answerable completes, the theorem doesn't need to
  // "become complete" to open its child — outer reaches through.
  assert.equal(model['inner'].available, true);
});
