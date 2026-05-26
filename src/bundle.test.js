import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access } from 'fs/promises';
import { rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { makeBuildOptions, bundle } from './bundle.js';

describe('makeBuildOptions', () => {
  it('sets entryPoints to the bundle-entry.js path', () => {
    const opts = makeBuildOptions('/project/.tex4npm/bundle-entry.js', '/project/dist');
    assert.deepEqual(opts.entryPoints, ['/project/.tex4npm/bundle-entry.js']);
  });

  it('sets outdir to the provided outDir', () => {
    const opts = makeBuildOptions('/entry.js', '/dist');
    assert.equal(opts.outdir, '/dist');
  });

  it('uses ximera as the entry name (produces ximera.js / ximera.css)', () => {
    const opts = makeBuildOptions('/entry.js', '/dist');
    assert.equal(opts.entryNames, 'ximera');
  });

  it('enables bundling', () => {
    const opts = makeBuildOptions('/entry.js', '/dist');
    assert.equal(opts.bundle, true);
  });
});

describe('bundle (integration)', () => {
  let dir;
  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'tex4npm-bundle-'));
    await mkdir(path.join(dir, '.tex4npm'), { recursive: true });
    await mkdir(path.join(dir, 'dist'), { recursive: true });
  });
  after(() => rm(dir, { recursive: true, force: true }));

  it('produces ximera.js in outDir from a JS entry point', async () => {
    await writeFile(
      path.join(dir, '.tex4npm', 'bundle-entry.js'),
      'export const x = 42;\n'
    );
    await bundle({ tex4npmDir: path.join(dir, '.tex4npm'), outDir: path.join(dir, 'dist') });
    await assert.doesNotReject(() => access(path.join(dir, 'dist', 'ximera.js')));
  });

  it('produces ximera.css in outDir when CSS is imported', async () => {
    const cssPath = path.join(dir, '.tex4npm', 'test.css');
    await writeFile(cssPath, 'body { margin: 0; }\n');
    await writeFile(
      path.join(dir, '.tex4npm', 'bundle-entry.js'),
      `import './test.css';\n`
    );
    await bundle({ tex4npmDir: path.join(dir, '.tex4npm'), outDir: path.join(dir, 'dist') });
    await assert.doesNotReject(() => access(path.join(dir, 'dist', 'ximera.css')));
  });

  it('produces valid JS that contains bundled content', async () => {
    await writeFile(
      path.join(dir, '.tex4npm', 'bundle-entry.js'),
      'globalThis.__tex4npm_loaded = true;\n'
    );
    await bundle({ tex4npmDir: path.join(dir, '.tex4npm'), outDir: path.join(dir, 'dist') });
    const { readFile } = await import('fs/promises');
    const js = await readFile(path.join(dir, 'dist', 'ximera.js'), 'utf8');
    assert.ok(js.includes('__tex4npm_loaded'));
  });
});
