import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, topoSort, propagateDirty } from './graph.js';

// Synchronous depsOfFn built from a plain object map.
const makeDepsOf = map => async f => map[f] ?? [];

describe('buildGraph', () => {
  it('builds an empty graph from no files', async () => {
    const g = await buildGraph([], makeDepsOf({}));
    assert.equal(g.deps.size, 0);
    assert.equal(g.dependents.size, 0);
  });

  it('records edges between compilable files', async () => {
    // A depends on B
    const g = await buildGraph(['/A', '/B'], makeDepsOf({ '/A': ['/B'] }));
    assert.deepEqual(g.deps.get('/A'), ['/B']);
    assert.deepEqual(g.dependents.get('/B'), ['/A']);
  });

  it('ignores deps to non-compilable files (not in the set)', async () => {
    // /macro.sty is not in the files list
    const g = await buildGraph(['/A'], makeDepsOf({ '/A': ['/macro.sty'] }));
    assert.deepEqual(g.deps.get('/A'), []);
  });
});

describe('topoSort', () => {
  it('returns a single file unchanged', async () => {
    const g = await buildGraph(['/A'], makeDepsOf({}));
    assert.deepEqual(topoSort(g), ['/A']);
  });

  it('puts dependency before dependent (A depends on B → [B, A])', async () => {
    const g = await buildGraph(['/A', '/B'], makeDepsOf({ '/A': ['/B'] }));
    const order = topoSort(g);
    assert.ok(order.indexOf('/B') < order.indexOf('/A'));
  });

  it('handles a linear chain C←B←A correctly', async () => {
    // A depends on B, B depends on C → order: C, B, A
    const g = await buildGraph(
      ['/A', '/B', '/C'],
      makeDepsOf({ '/A': ['/B'], '/B': ['/C'] })
    );
    const order = topoSort(g);
    assert.ok(order.indexOf('/C') < order.indexOf('/B'));
    assert.ok(order.indexOf('/B') < order.indexOf('/A'));
  });

  it('handles a diamond (A depends on B and C, both depend on D)', async () => {
    const g = await buildGraph(
      ['/A', '/B', '/C', '/D'],
      makeDepsOf({ '/A': ['/B', '/C'], '/B': ['/D'], '/C': ['/D'] })
    );
    const order = topoSort(g);
    assert.ok(order.indexOf('/D') < order.indexOf('/B'));
    assert.ok(order.indexOf('/D') < order.indexOf('/C'));
    assert.ok(order.indexOf('/B') < order.indexOf('/A'));
    assert.ok(order.indexOf('/C') < order.indexOf('/A'));
  });

  it('throws on a direct cycle', async () => {
    const g = await buildGraph(['/A', '/B'], makeDepsOf({ '/A': ['/B'], '/B': ['/A'] }));
    assert.throws(() => topoSort(g), /Circular/);
  });

  it('throws on a three-node cycle and names the files', async () => {
    const g = await buildGraph(
      ['/A', '/B', '/C'],
      makeDepsOf({ '/A': ['/B'], '/B': ['/C'], '/C': ['/A'] })
    );
    assert.throws(() => topoSort(g), /Circular/);
  });
});

describe('propagateDirty', () => {
  it('returns the initial dirty set when there are no dependents', async () => {
    const g = await buildGraph(['/A', '/B'], makeDepsOf({}));
    const dirty = propagateDirty(g, new Set(['/A']));
    assert.deepEqual([...dirty].sort(), ['/A']);
  });

  it('marks direct dependent dirty', async () => {
    // A depends on B; B is dirty → A becomes dirty
    const g = await buildGraph(['/A', '/B'], makeDepsOf({ '/A': ['/B'] }));
    const dirty = propagateDirty(g, new Set(['/B']));
    assert.ok(dirty.has('/A'));
    assert.ok(dirty.has('/B'));
  });

  it('propagates transitively through a chain', async () => {
    const g = await buildGraph(
      ['/A', '/B', '/C'],
      makeDepsOf({ '/A': ['/B'], '/B': ['/C'] })
    );
    const dirty = propagateDirty(g, new Set(['/C']));
    assert.deepEqual([...dirty].sort(), ['/A', '/B', '/C']);
  });

  it('does not double-visit nodes (diamond graph)', async () => {
    const g = await buildGraph(
      ['/A', '/B', '/C', '/D'],
      makeDepsOf({ '/A': ['/B', '/C'], '/B': ['/D'], '/C': ['/D'] })
    );
    const dirty = propagateDirty(g, new Set(['/D']));
    assert.deepEqual([...dirty].sort(), ['/A', '/B', '/C', '/D']);
  });
});
