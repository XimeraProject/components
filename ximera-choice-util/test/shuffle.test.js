import test from 'node:test';
import assert from 'node:assert/strict';

import { shuffleIds, generateSeed } from '../index.js';

test('same (ids, seed) → same order every call', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const seed = 42;
  const first = shuffleIds(ids, seed);
  const second = shuffleIds(ids, seed);
  assert.deepEqual(first, second);
});

test('different seeds produce different orders', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const s1 = shuffleIds(ids, 1);
  const s2 = shuffleIds(ids, 2);
  // Not a strict guarantee, but for these small seeds/inputs it holds.
  assert.notDeepEqual(s1, s2);
});

test('shuffle preserves the set of ids (no drops, no duplicates)', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const out = shuffleIds(ids, 12345);
  assert.equal(out.length, ids.length);
  assert.deepEqual([...out].sort(), [...ids].sort());
});

test('input array is not mutated', () => {
  const ids = ['a', 'b', 'c'];
  const snapshot = [...ids];
  shuffleIds(ids, 99);
  assert.deepEqual(ids, snapshot);
});

test('empty input returns empty output', () => {
  assert.deepEqual(shuffleIds([], 1), []);
});

test('single-element input returns single-element output', () => {
  assert.deepEqual(shuffleIds(['solo'], 1), ['solo']);
});

test('generateSeed returns a uint32', () => {
  for (let i = 0; i < 10; i++) {
    const s = generateSeed();
    assert.equal(Number.isInteger(s), true);
    assert.ok(s >= 0 && s <= 0xFFFFFFFF, `seed out of uint32 range: ${s}`);
  }
});

test('generateSeed produces different values across calls', () => {
  const seeds = new Set();
  for (let i = 0; i < 100; i++) seeds.add(generateSeed());
  // With crypto.getRandomValues we expect all 100 unique. Fall-back to
  // Math.random still gives extreme unlikeliness of collisions in 100.
  assert.ok(seeds.size > 90, `too few unique seeds: ${seeds.size}/100`);
});
