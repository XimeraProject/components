import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { program, compileBatch } from './cli.js';
import { resolveConfig } from './config.js';

describe('program command structure', () => {
  it('is named tex4npm', () => {
    assert.equal(program.name(), 'tex4npm');
  });

  it('registers build, watch, and clean commands', () => {
    const names = program.commands.map(c => c.name());
    assert.ok(names.includes('build'), 'missing build');
    assert.ok(names.includes('watch'), 'missing watch');
    assert.ok(names.includes('clean'), 'missing clean');
  });

  it('each command has a description', () => {
    for (const cmd of program.commands) {
      assert.ok(cmd.description().length > 0, `${cmd.name()} has no description`);
    }
  });
});

describe('compileBatch error handling', () => {
  let root, outDir, config;

  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'tex4npm-cli-'));
    outDir = path.join(root, 'dist');
    await mkdir(outDir, { recursive: true });
    config = resolveConfig({ root, outDir }, root);
  });

  after(() => rm(root, { recursive: true, force: true }));

  it('returns errors instead of throwing when a file fails to compile', async () => {
    // compile() will fail: the tex file does not exist so pdflatex (or execa)
    // will throw. compileBatch must catch it and return the error.
    const errors = await compileBatch([path.join(root, 'ghost.tex')], config);
    assert.ok(errors.length > 0, 'expected at least one error');
    assert.equal(errors[0].file, path.join(root, 'ghost.tex'));
    assert.ok(errors[0].err instanceof Error);
  });

  it('continues compiling remaining files after one fails', async () => {
    const compiled = [];
    // Inject a fake compileBatch-like loop by passing two files;
    // the second will also fail but both should be attempted.
    const errors = await compileBatch(
      [path.join(root, 'a.tex'), path.join(root, 'b.tex')],
      config
    );
    // Both non-existent files should produce errors, not stop at the first.
    assert.equal(errors.length, 2);
  });
});
