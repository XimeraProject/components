import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateProgress } from '../progress.js';

function almost(a, b, eps = 1e-9) {
  return Math.abs(a - b) < eps;
}

test('no problems → 1.0', () => {
  document.body.innerHTML = '';
  assert.equal(calculateProgress({}), 1.0);
});

test('single top-level problem, not complete → 0', () => {
  document.body.innerHTML = `<div class="problem-environment" id="p-1"></div>`;
  assert.equal(calculateProgress({ 'p-1': { complete: false } }), 0);
});

test('single top-level problem, complete → 1', () => {
  document.body.innerHTML = `<div class="problem-environment" id="p-1"></div>`;
  assert.equal(calculateProgress({ 'p-1': { complete: true } }), 1);
});

test('two siblings, one complete → 0.5', () => {
  document.body.innerHTML = `
    <div class="problem-environment" id="p-1"></div>
    <div class="problem-environment" id="p-2"></div>
  `;
  assert.equal(calculateProgress({ 'p-1': { complete: true }, 'p-2': { complete: false } }), 0.5);
});

test('nested: parent + one child, both incomplete → 0', () => {
  document.body.innerHTML = `
    <div class="problem-environment" id="outer">
      <div class="problem-environment" id="inner"></div>
    </div>
  `;
  assert.equal(calculateProgress({}), 0);
});

test('nested: child complete but not parent → 0.5', () => {
  document.body.innerHTML = `
    <div class="problem-environment" id="outer">
      <div class="problem-environment" id="inner"></div>
    </div>
  `;
  // outer's nodeProgress = (childSum + selfValue) / (children+1) = (1 + 0) / 2 = 0.5
  const p = calculateProgress({ 'inner': { complete: true }, 'outer': { complete: false } });
  assert.ok(almost(p, 0.5), `expected 0.5, got ${p}`);
});

test('nested: both complete → 1', () => {
  document.body.innerHTML = `
    <div class="problem-environment" id="outer">
      <div class="problem-environment" id="inner"></div>
    </div>
  `;
  const p = calculateProgress({ 'inner': { complete: true }, 'outer': { complete: true } });
  assert.ok(almost(p, 1.0), `expected 1.0, got ${p}`);
});
