import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { render, registerRender, focusGuardSyncValue, _resetRenderPlugins } from '../render.js';

function reset() {
  _resetRenderPlugins();
  document.body.innerHTML = '';
}

test('projects problem-environment data-state', () => {
  reset();
  document.body.innerHTML = `<div class="problem-environment" id="p-1"></div>`;
  render({ 'p-1': { available: true, complete: false, experienced: true } });
  assert.equal(document.getElementById('p-1').dataset.state, 'available experienced');
});

test('projects .complete when set', () => {
  reset();
  document.body.innerHTML = `<div class="problem-environment" id="p-1"></div>`;
  render({ 'p-1': { available: true, complete: true, experienced: true } });
  assert.equal(document.getElementById('p-1').dataset.state, 'available complete experienced');
});

test('projects feedback visibility', () => {
  reset();
  document.body.innerHTML = `<div class="feedback" id="fb-1"></div>`;
  render({ 'fb-1': { visible: true } });
  assert.equal(document.getElementById('fb-1').dataset.state, 'visible');
  render({ 'fb-1': { visible: false } });
  assert.equal(document.getElementById('fb-1').dataset.state, 'hidden');
});

test('reference-inequality skip', () => {
  reset();
  document.body.innerHTML = `<div class="problem-environment" id="p-1"></div>`;
  const entry = { available: true, complete: false, experienced: true };
  const prev = { 'p-1': entry };
  const next = { 'p-1': entry }; // SAME reference
  render(next, prev);
  // dataset.state not touched because ref equal — verify by pre-setting.
  document.getElementById('p-1').dataset.state = 'sentinel';
  render(next, prev);
  assert.equal(document.getElementById('p-1').dataset.state, 'sentinel');
});

test('render plugins receive (el, entry, model)', () => {
  reset();
  document.body.innerHTML = `<div class="thing" id="t-1"></div>`;
  let captured;
  registerRender('.thing', (el, entry, model) => {
    captured = { id: el.id, entry, model };
  });
  const model = { 't-1': { foo: 42 } };
  render(model);
  assert.equal(captured.id, 't-1');
  assert.equal(captured.entry.foo, 42);
  assert.equal(captured.model, model);
});

test('plugin runs after built-in projection', () => {
  reset();
  document.body.innerHTML = `<div class="problem-environment" id="p-1"></div>`;
  registerRender('.problem-environment', (el, entry) => {
    el.dataset.customAttr = entry.available ? 'yes' : 'no';
  });
  render({ 'p-1': { available: true, complete: false, experienced: true } });
  const el = document.getElementById('p-1');
  assert.equal(el.dataset.state, 'available experienced');   // built-in
  assert.equal(el.dataset.customAttr, 'yes');                // plugin
});

test('focusGuardSyncValue skips when element is focused', () => {
  reset();
  document.body.innerHTML = `<input id="i-1" value="original">`;
  const input = document.getElementById('i-1');
  input.focus();
  focusGuardSyncValue(input, 'new-value');
  assert.equal(input.value, 'original');
});

test('focusGuardSyncValue writes when element is not focused', () => {
  reset();
  document.body.innerHTML = `<input id="i-1" value="original">`;
  const input = document.getElementById('i-1');
  focusGuardSyncValue(input, 'new-value');
  assert.equal(input.value, 'new-value');
});

test('focusGuardSyncValue coerces null/undefined to empty string', () => {
  reset();
  document.body.innerHTML = `<input id="i-1" value="original">`;
  focusGuardSyncValue(document.getElementById('i-1'), null);
  assert.equal(document.getElementById('i-1').value, '');
});
