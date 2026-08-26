import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { discover } from './discover.js';

const WITH_DOC = '\\begin{document}hello\\end{document}';
const WITHOUT_DOC = '\\newcommand{\\foo}{bar}';
const COMMENTED_DOC = '% \\begin{document}\n\\newcommand{\\foo}{bar}';

let root;

before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'tex4npm-discover-'));
  await mkdir(path.join(root, 'ch1'));
  await mkdir(path.join(root, 'node_modules', 'some-pkg'), { recursive: true });
  await mkdir(path.join(root, '.tex4npm'), { recursive: true });
  await mkdir(path.join(root, 'drafts'));

  await writeFile(path.join(root, 'main.tex'), WITH_DOC);
  await writeFile(path.join(root, 'ch1', 'section.tex'), WITH_DOC);
  await writeFile(path.join(root, 'macros.tex'), WITHOUT_DOC);
  await writeFile(path.join(root, 'commented.tex'), COMMENTED_DOC);
  await writeFile(path.join(root, 'styles.sty'), WITH_DOC);
  await writeFile(path.join(root, 'node_modules', 'some-pkg', 'pkg.tex'), WITH_DOC);
  await writeFile(path.join(root, '.tex4npm', 'bundle-entry.tex'), WITH_DOC);
  await writeFile(path.join(root, 'drafts', 'wip.tex'), WITH_DOC);
});

after(() => rm(root, { recursive: true, force: true }));

describe('discover', () => {
  it('finds .tex files with \\begin{document}', async () => {
    const files = await discover(root);
    assert.ok(files.includes(path.join(root, 'main.tex')));
    assert.ok(files.includes(path.join(root, 'ch1', 'section.tex')));
  });

  it('excludes files without \\begin{document}', async () => {
    const files = await discover(root);
    assert.ok(!files.includes(path.join(root, 'macros.tex')));
  });

  it('excludes files where \\begin{document} is commented out', async () => {
    const files = await discover(root);
    assert.ok(!files.includes(path.join(root, 'commented.tex')));
  });

  it('excludes non-.tex files', async () => {
    const files = await discover(root);
    assert.ok(!files.some(f => f.endsWith('.sty')));
  });

  it('always excludes node_modules/', async () => {
    const files = await discover(root);
    assert.ok(!files.some(f => f.includes('node_modules')));
  });

  it('always excludes .tex4npm/', async () => {
    const files = await discover(root);
    assert.ok(!files.some(f => f.includes('.tex4npm')));
  });

  it('respects user-supplied exclude patterns', async () => {
    const files = await discover(root, { exclude: ['drafts/**'] });
    assert.ok(!files.some(f => f.includes('drafts')));
  });

  it('returns results in sorted order', async () => {
    const files = await discover(root);
    assert.deepEqual(files, [...files].sort());
  });
});
