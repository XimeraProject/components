import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat } from 'fs/promises';
import os from 'os';
import path from 'path';
import { findLatexPackages, populateTexmf, generateBundleEntry, stage } from './stage.js';

// Build a fake node_modules layout in a temp directory.
async function makeRoot(packages) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tex4npm-stage-'));
  for (const [name, pkg, files = {}] of packages) {
    const pkgDir = path.join(root, 'node_modules', name);
    await mkdir(pkgDir, { recursive: true });
    await writeFile(path.join(pkgDir, 'package.json'), JSON.stringify({ name, ...pkg }));
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(pkgDir, rel);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, content);
    }
  }
  return root;
}

describe('findLatexPackages', () => {
  let root;
  before(async () => {
    root = await makeRoot([
      ['ximera-foo', { latex: { sty: ['foo.sty'], css: ['dist/foo.css'] } },
        { 'foo.sty': '\\ProvidesPackage{foo}', 'dist/foo.css': '.foo{}' }],
      ['plain-pkg', { description: 'no latex field' }],
      ['@org/ximera-bar', { latex: { sty: ['bar.sty'], css: [] } },
        { 'bar.sty': '\\ProvidesPackage{bar}' }],
    ]);
  });
  after(() => rm(root, { recursive: true, force: true }));

  it('returns packages with a latex field', async () => {
    const pkgs = await findLatexPackages(root);
    assert.equal(pkgs.length, 2);
    assert.ok(pkgs.some(p => p.name === 'ximera-foo'));
    assert.ok(pkgs.some(p => p.name === '@org/ximera-bar'));
  });

  it('skips packages without a latex field', async () => {
    const pkgs = await findLatexPackages(root);
    assert.ok(!pkgs.some(p => p.name === 'plain-pkg'));
  });

  it('exposes sty and css arrays', async () => {
    const pkgs = await findLatexPackages(root);
    const foo = pkgs.find(p => p.name === 'ximera-foo');
    assert.deepEqual(foo.sty, ['foo.sty']);
    assert.deepEqual(foo.css, ['dist/foo.css']);
  });

  it('defaults the 4ht array to [] when not declared', async () => {
    const pkgs = await findLatexPackages(root);
    const foo = pkgs.find(p => p.name === 'ximera-foo');
    assert.deepEqual(foo.fourht, []);
  });

  it('exposes the 4ht array when declared', async () => {
    const r = await makeRoot([
      ['ximera-baz', { latex: { sty: ['baz.sty'], '4ht': ['baz.4ht'] } },
        { 'baz.sty': '', 'baz.4ht': '' }],
    ]);
    try {
      const pkgs = await findLatexPackages(r);
      const baz = pkgs.find(p => p.name === 'ximera-baz');
      assert.deepEqual(baz.fourht, ['baz.4ht']);
    } finally {
      await rm(r, { recursive: true, force: true });
    }
  });

  it('defaults cls and cfg arrays to [] when not declared', async () => {
    const pkgs = await findLatexPackages(root);
    const foo = pkgs.find(p => p.name === 'ximera-foo');
    assert.deepEqual(foo.cls, []);
    assert.deepEqual(foo.cfg, []);
  });

  it('exposes cls and cfg arrays when declared', async () => {
    const r = await makeRoot([
      ['ximeralatex', { latex: { cls: ['foo.cls'], cfg: ['foo.cfg'] } },
        { 'foo.cls': '', 'foo.cfg': '' }],
    ]);
    try {
      const pkgs = await findLatexPackages(r);
      const xl = pkgs.find(p => p.name === 'ximeralatex');
      assert.deepEqual(xl.cls, ['foo.cls']);
      assert.deepEqual(xl.cfg, ['foo.cfg']);
    } finally {
      await rm(r, { recursive: true, force: true });
    }
  });
});

describe('populateTexmf', () => {
  let root, tex4npmTexmf;
  before(async () => {
    root = await makeRoot([
      ['ximera-foo', { latex: { sty: ['foo.sty'] } }, { 'foo.sty': '' }],
    ]);
    tex4npmTexmf = path.join(root, '.tex4npm', 'texmf');
  });
  after(() => rm(root, { recursive: true, force: true }));

  it('creates a symlink (or file) in the latex dir for each .sty', async () => {
    const pkgs = await findLatexPackages(root);
    await populateTexmf(tex4npmTexmf, pkgs);
    const dest = path.join(tex4npmTexmf, 'tex', 'latex', 'foo.sty');
    const stat = await lstat(dest);
    assert.ok(stat.isSymbolicLink() || stat.isFile());
  });

  it('wipes and rebuilds the latex dir on repeated calls', async () => {
    const pkgs = await findLatexPackages(root);
    await populateTexmf(tex4npmTexmf, pkgs);
    await populateTexmf(tex4npmTexmf, pkgs); // second call must not throw
    const dest = path.join(tex4npmTexmf, 'tex', 'latex', 'foo.sty');
    const stat = await lstat(dest);
    assert.ok(stat.isSymbolicLink() || stat.isFile());
  });

  it('throws on .sty filename collision between two packages', async () => {
    const collRoot = await makeRoot([
      ['ximera-a', { latex: { sty: ['shared.sty'] } }, { 'shared.sty': '' }],
      ['ximera-b', { latex: { sty: ['shared.sty'] } }, { 'shared.sty': '' }],
    ]);
    try {
      const pkgs = await findLatexPackages(collRoot);
      await assert.rejects(
        () => populateTexmf(path.join(collRoot, '.tex4npm', 'texmf'), pkgs),
        /collision/
      );
    } finally {
      await rm(collRoot, { recursive: true, force: true });
    }
  });

  it('symlinks .4ht files alongside .sty files', async () => {
    const r = await makeRoot([
      ['ximera-baz', { latex: { sty: ['baz.sty'], '4ht': ['baz.4ht'] } },
        { 'baz.sty': '', 'baz.4ht': '' }],
    ]);
    try {
      const pkgs = await findLatexPackages(r);
      await populateTexmf(path.join(r, '.tex4npm', 'texmf'), pkgs);
      const dest = path.join(r, '.tex4npm', 'texmf', 'tex', 'latex', 'baz.4ht');
      const stat = await lstat(dest);
      assert.ok(stat.isSymbolicLink() || stat.isFile());
    } finally {
      await rm(r, { recursive: true, force: true });
    }
  });

  it('throws on .4ht filename collision across packages', async () => {
    const collRoot = await makeRoot([
      ['ximera-a', { latex: { '4ht': ['shared.4ht'] } }, { 'shared.4ht': '' }],
      ['ximera-b', { latex: { '4ht': ['shared.4ht'] } }, { 'shared.4ht': '' }],
    ]);
    try {
      const pkgs = await findLatexPackages(collRoot);
      await assert.rejects(
        () => populateTexmf(path.join(collRoot, '.tex4npm', 'texmf'), pkgs),
        /collision/
      );
    } finally {
      await rm(collRoot, { recursive: true, force: true });
    }
  });

  it('symlinks .cls and .cfg files alongside .sty/.4ht', async () => {
    const r = await makeRoot([
      ['ximeralatex', { latex: { cls: ['ximera.cls'], cfg: ['ximera.cfg'] } },
        { 'ximera.cls': '', 'ximera.cfg': '' }],
    ]);
    try {
      const pkgs = await findLatexPackages(r);
      await populateTexmf(path.join(r, '.tex4npm', 'texmf'), pkgs);
      for (const name of ['ximera.cls', 'ximera.cfg']) {
        const dest = path.join(r, '.tex4npm', 'texmf', 'tex', 'latex', name);
        const stat = await lstat(dest);
        assert.ok(stat.isSymbolicLink() || stat.isFile());
      }
    } finally {
      await rm(r, { recursive: true, force: true });
    }
  });
});

describe('generateBundleEntry', () => {
  let root, tex4npmDir;
  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'tex4npm-bundle-'));
    tex4npmDir = path.join(root, '.tex4npm');
  });
  after(() => rm(root, { recursive: true, force: true }));

  it('generates correct imports for JS and CSS', async () => {
    const packages = [
      { name: 'ximera-foo', sty: [], css: ['dist/foo.css'] },
      { name: 'ximera-bar', sty: [], css: [] },
    ];
    await generateBundleEntry(tex4npmDir, packages);
    const content = await readFile(path.join(tex4npmDir, 'bundle-entry.js'), 'utf8');
    assert.ok(content.includes(`import "ximera-foo";`));
    assert.ok(content.includes(`import "ximera-bar";`));
    assert.ok(content.includes(`import "ximera-foo/dist/foo.css";`));
    assert.ok(!content.includes('ximera-bar/'));
  });

  it('generates an empty (header-only) file when there are no packages', async () => {
    await generateBundleEntry(tex4npmDir, []);
    const content = await readFile(path.join(tex4npmDir, 'bundle-entry.js'), 'utf8');
    assert.ok(content.startsWith('// auto-generated'));
  });

  it('omits the JS import for latex-only packages (hasJs=false)', async () => {
    const packages = [
      { name: 'ximera-foo', sty: [], css: [], hasJs: true },
      { name: 'ximeralatex', sty: [], css: [], hasJs: false },
    ];
    await generateBundleEntry(tex4npmDir, packages);
    const content = await readFile(path.join(tex4npmDir, 'bundle-entry.js'), 'utf8');
    assert.ok(content.includes(`import "ximera-foo";`));
    assert.ok(!content.includes(`import "ximeralatex";`));
  });
});

describe('stage (integration)', () => {
  let root;
  before(async () => {
    root = await makeRoot([
      ['ximera-foo', { main: 'index.js', latex: { sty: ['foo.sty'], css: ['dist/foo.css'] } },
        { 'foo.sty': '', 'dist/foo.css': '', 'index.js': '' }],
    ]);
  });
  after(() => rm(root, { recursive: true, force: true }));

  it('runs all three stages and returns the package list', async () => {
    const config = {
      configDir: root,
      root,
      tex4npmDir: path.join(root, '.tex4npm'),
      tex4npmTexmf: path.join(root, '.tex4npm', 'texmf'),
    };
    const pkgs = await stage(config);
    assert.equal(pkgs.length, 1);
    // .sty symlink/file exists
    const sty = path.join(root, '.tex4npm', 'texmf', 'tex', 'latex', 'foo.sty');
    await assert.doesNotReject(() => lstat(sty));
    // bundle-entry.js exists and imports the package
    const entry = await readFile(path.join(root, '.tex4npm', 'bundle-entry.js'), 'utf8');
    assert.ok(entry.includes(`import "ximera-foo";`));
  });
});
