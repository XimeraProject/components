import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { resolveConfig, loadConfig } from './config.js';

describe('resolveConfig', () => {
  it('applies all defaults when called with no arguments', () => {
    const c = resolveConfig({}, '/project');
    assert.equal(c.root, '/project');
    assert.equal(c.outDir, '/project/dist');
    assert.equal(c.passes, 2);
    assert.equal(c.clean, true);
    assert.equal(c.sage, true);
    assert.deepEqual(c.exclude, []);
    assert.ok(c.workers >= 1);
  });

  it('resolves root and outDir relative to configDir', () => {
    const c = resolveConfig({ root: './content', outDir: '../out' }, '/project');
    assert.equal(c.root, '/project/content');
    assert.equal(c.outDir, '/out');
  });

  it('accepts absolute root and outDir unchanged', () => {
    const c = resolveConfig({ root: '/abs/root', outDir: '/abs/out' }, '/project');
    assert.equal(c.root, '/abs/root');
    assert.equal(c.outDir, '/abs/out');
  });

  it('derives tex4npmDir and tex4npmTexmf from root', () => {
    const c = resolveConfig({ root: '/project' }, '/project');
    assert.equal(c.tex4npmDir, '/project/.tex4npm');
    assert.equal(c.tex4npmTexmf, '/project/.tex4npm/texmf');
  });

  it('passes through workers, passes, clean, sage, exclude', () => {
    const c = resolveConfig({
      workers: 8, passes: 3, clean: false, sage: false, exclude: ['drafts/**'],
    }, '/project');
    assert.equal(c.workers, 8);
    assert.equal(c.passes, 3);
    assert.equal(c.clean, false);
    assert.equal(c.sage, false);
    assert.deepEqual(c.exclude, ['drafts/**']);
  });

  it('throws for non-integer workers', () => {
    assert.throws(() => resolveConfig({ workers: 0 }, '/p'), /workers/);
    assert.throws(() => resolveConfig({ workers: 1.5 }, '/p'), /workers/);
    assert.throws(() => resolveConfig({ workers: -1 }, '/p'), /workers/);
  });

  it('throws for passes other than 2 or 3', () => {
    assert.throws(() => resolveConfig({ passes: 1 }, '/p'), /passes/);
    assert.throws(() => resolveConfig({ passes: 4 }, '/p'), /passes/);
  });

  it('throws when exclude is not an array', () => {
    assert.throws(() => resolveConfig({ exclude: 'drafts/**' }, '/p'), /exclude/);
  });
});

describe('loadConfig', () => {
  it('returns defaults when no config file exists', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tex4npm-cfg-'));
    try {
      const c = await loadConfig(dir);
      assert.equal(c.root, dir);
      assert.equal(c.outDir, path.join(dir, 'dist'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('loads and applies a config file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tex4npm-cfg-'));
    try {
      await writeFile(
        path.join(dir, 'tex4npm.config.js'),
        `export default { outDir: 'out', passes: 3, workers: 2 };\n`
      );
      const c = await loadConfig(dir);
      assert.equal(c.outDir, path.join(dir, 'out'));
      assert.equal(c.passes, 3);
      assert.equal(c.workers, 2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws when config file has invalid values', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tex4npm-cfg-'));
    try {
      await writeFile(
        path.join(dir, 'tex4npm.config.js'),
        `export default { passes: 5 };\n`
      );
      await assert.rejects(() => loadConfig(dir), /passes/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
