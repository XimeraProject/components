import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  initialModel, getEntry, setEntry, delEntry,
  modelToPageState, modelFromPageState,
} from '../model.js';

test('initialModel is an empty object', () => {
  const m = initialModel();
  assert.deepEqual(m, {});
});

test('getEntry returns {} for missing ids', () => {
  assert.deepEqual(getEntry({}, 'nope'), {});
});

test('setEntry merges partial state', () => {
  const m1 = setEntry({}, 'a', { x: 1 });
  assert.deepEqual(m1, { a: { x: 1 } });
  const m2 = setEntry(m1, 'a', { y: 2 });
  assert.deepEqual(m2, { a: { x: 1, y: 2 } });
});

test('setEntry returns new refs for changed entries only', () => {
  const m1 = { a: { x: 1 }, b: { y: 2 } };
  const m2 = setEntry(m1, 'a', { x: 3 });
  assert.notStrictEqual(m2, m1);      // model ref changed
  assert.notStrictEqual(m2.a, m1.a);  // changed entry ref changed
  assert.strictEqual(m2.b, m1.b);     // unchanged entry ref preserved
});

test('delEntry removes a key and returns a new model', () => {
  const m1 = { a: { x: 1 }, b: { y: 2 } };
  const m2 = delEntry(m1, 'a');
  assert.deepEqual(m2, { b: { y: 2 } });
  assert.notStrictEqual(m2, m1);
});

test('delEntry is a no-op for missing ids', () => {
  const m1 = { a: { x: 1 } };
  const m2 = delEntry(m1, 'nope');
  assert.strictEqual(m2, m1);
});

test('modelTo/FromPageState are identity (D6)', () => {
  const m = { a: { x: 1 } };
  assert.strictEqual(modelToPageState(m), m);
  assert.strictEqual(modelFromPageState(m), m);
});

test('modelFromPageState coerces null/undefined to {}', () => {
  assert.deepEqual(modelFromPageState(null), {});
  assert.deepEqual(modelFromPageState(undefined), {});
});
