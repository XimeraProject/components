import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm } from 'fs/promises';
import { createHash } from 'crypto';
import os from 'os';
import path from 'path';
import { hashFile, parseDependencyMeta, isDirty } from './dirty.js';

const sha1 = s => createHash('sha1').update(s).digest('hex');

describe('parseDependencyMeta', () => {
  it('parses a single dependency tag', () => {
    const html = `<meta name="dependency" content="abc123 main.tex">`;
    assert.deepEqual(parseDependencyMeta(html), [{ hash: 'abc123', relPath: 'main.tex' }]);
  });

  it('handles content before name', () => {
    const html = `<meta content="abc123 main.tex" name="dependency">`;
    assert.deepEqual(parseDependencyMeta(html), [{ hash: 'abc123', relPath: 'main.tex' }]);
  });

  it('parses multiple tags', () => {
    const html = `
      <meta name="dependency" content="aaa chapter1/a.tex">
      <meta name="dependency" content="bbb .tex4npm/texmf/tex/latex/macro.sty">
    `;
    const deps = parseDependencyMeta(html);
    assert.equal(deps.length, 2);
    assert.equal(deps[0].relPath, 'chapter1/a.tex');
    assert.equal(deps[1].relPath, '.tex4npm/texmf/tex/latex/macro.sty');
  });

  it('ignores unrelated meta tags', () => {
    const html = `
      <meta name="viewport" content="width=device-width">
      <meta name="dependency" content="abc123 main.tex">
      <meta name="description" content="xourse">
    `;
    assert.equal(parseDependencyMeta(html).length, 1);
  });

  it('returns empty array when no dependency tags exist', () => {
    assert.deepEqual(parseDependencyMeta('<html><head></head></html>'), []);
  });
});

describe('hashFile', () => {
  it('produces the expected SHA1 for known content', async () => {
    const tmp = path.join(os.tmpdir(), `tex4npm-test-${process.pid}.txt`);
    await writeFile(tmp, 'hello world');
    try {
      const h = await hashFile(tmp);
      assert.equal(h, sha1('hello world'));
    } finally {
      await rm(tmp, { force: true });
    }
  });
});

describe('isDirty', () => {
  const dir = os.tmpdir();

  it('returns true when HTML does not exist', async () => {
    const result = await isDirty(path.join(dir, 'nonexistent-99999.html'), dir);
    assert.equal(result, true);
  });

  it('returns true when HTML has no dependency meta tags', async () => {
    const html = path.join(dir, `tex4npm-nodeps-${process.pid}.html`);
    await writeFile(html, '<html><head></head><body>hi</body></html>');
    try {
      assert.equal(await isDirty(html, dir), true);
    } finally {
      await rm(html, { force: true });
    }
  });

  it('returns false when all hashes match', async () => {
    const src = path.join(dir, `tex4npm-src-${process.pid}.tex`);
    await writeFile(src, 'content');
    const h = sha1('content');
    const html = path.join(dir, `tex4npm-clean-${process.pid}.html`);
    const rel = path.relative(dir, src);
    await writeFile(html, `<meta name="dependency" content="${h} ${rel}">`);
    try {
      assert.equal(await isDirty(html, dir), false);
    } finally {
      await rm(src, { force: true });
      await rm(html, { force: true });
    }
  });

  it('returns true when a hash differs', async () => {
    const src = path.join(dir, `tex4npm-changed-${process.pid}.tex`);
    await writeFile(src, 'new content');
    const html = path.join(dir, `tex4npm-stale-${process.pid}.html`);
    const rel = path.relative(dir, src);
    await writeFile(html, `<meta name="dependency" content="000000 ${rel}">`);
    try {
      assert.equal(await isDirty(html, dir), true);
    } finally {
      await rm(src, { force: true });
      await rm(html, { force: true });
    }
  });

  it('returns true when a dependency file has been deleted', async () => {
    const html = path.join(dir, `tex4npm-missing-dep-${process.pid}.html`);
    await writeFile(html, `<meta name="dependency" content="abc123 ghost.tex">`);
    try {
      assert.equal(await isDirty(html, dir), true);
    } finally {
      await rm(html, { force: true });
    }
  });
});
