import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { register, getMounts, getAnswerableSelector, _resetMounts } from '../mounts.js';

test('register + getMounts', () => {
  _resetMounts();
  const fn = () => {};
  register('.foo', fn);
  const mounts = getMounts();
  assert.equal(mounts.size, 1);
  assert.equal(mounts.get('.foo').mount, fn);
  assert.equal(mounts.get('.foo').answerable, false);
});

test('answerable opts populate the union', () => {
  _resetMounts();
  register('.a', () => {}, { answerable: true });
  register('.b', () => {});
  register('.c', () => {}, { answerable: true });
  assert.equal(getAnswerableSelector(), '.a, .c');
});

test('getAnswerableSelector is empty when no mounts opt in', () => {
  _resetMounts();
  register('.a', () => {});
  assert.equal(getAnswerableSelector(), '');
});

test('register throws on bad input', () => {
  _resetMounts();
  assert.throws(() => register('', () => {}), /non-empty string/);
  assert.throws(() => register('.a', null), /must be a function/);
});
