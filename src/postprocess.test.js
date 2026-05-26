import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'fs/promises';
import { load } from 'cheerio';
import os from 'os';
import path from 'path';
import {
  removeEmptyParas, injectDependencyMeta, isXourse,
  removeSpuriousAnchors, enrichActivityLinks, postprocess,
} from './postprocess.js';

describe('removeEmptyParas', () => {
  it('removes a truly empty <p></p>', () => {
    const $ = load('<p></p><p>hello</p>');
    removeEmptyParas($);
    assert.equal($('p').length, 1);
    assert.equal($('p').text(), 'hello');
  });

  it('removes whitespace-only paragraphs', () => {
    const $ = load('<p>   </p><p>text</p>');
    removeEmptyParas($);
    assert.equal($('p').length, 1);
  });

  it('preserves paragraphs with child elements', () => {
    const $ = load('<p><br></p><p><span>hi</span></p>');
    removeEmptyParas($);
    assert.equal($('p').length, 2);
  });

  it('preserves paragraphs with text', () => {
    const $ = load('<p>hello world</p>');
    removeEmptyParas($);
    assert.equal($('p').length, 1);
  });
});

describe('isXourse', () => {
  it('returns true when the xourse meta tag is present', () => {
    const $ = load('<meta name="description" content="xourse">');
    assert.equal(isXourse($), true);
  });

  it('returns false when the meta tag is absent', () => {
    const $ = load('<html><head></head></html>');
    assert.equal(isXourse($), false);
  });

  it('returns false for a different description content', () => {
    const $ = load('<meta name="description" content="other">');
    assert.equal(isXourse($), false);
  });
});

describe('removeSpuriousAnchors', () => {
  it('unwraps bare <a id="..."> with no href or class', () => {
    const $ = load('<p><a id="sec1">text</a></p>');
    removeSpuriousAnchors($);
    assert.equal($('a[id]').length, 0);
    assert.equal($('p').text(), 'text');
  });

  it('preserves anchors that have an href', () => {
    const $ = load('<a id="x" href="#x">link</a>');
    removeSpuriousAnchors($);
    assert.equal($('a[id]').length, 1);
  });

  it('preserves anchors that have a class', () => {
    const $ = load('<a id="x" class="activity">text</a>');
    removeSpuriousAnchors($);
    assert.equal($('a[id]').length, 1);
  });
});

describe('injectDependencyMeta', () => {
  let dir;
  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'tex4npm-post-'));
    await writeFile(path.join(dir, 'main.tex'), 'content');
    await writeFile(path.join(dir, 'macro.sty'), 'macro');
  });
  after(() => rm(dir, { recursive: true, force: true }));

  it('injects one meta tag per input file', async () => {
    const $ = load('<html><head></head></html>');
    await injectDependencyMeta($, [
      path.join(dir, 'main.tex'),
      path.join(dir, 'macro.sty'),
    ], dir);
    assert.equal($('meta[name="dependency"]').length, 2);
  });

  it('meta content has format "HASH relpath"', async () => {
    const $ = load('<html><head></head></html>');
    await injectDependencyMeta($, [path.join(dir, 'main.tex')], dir);
    const content = $('meta[name="dependency"]').attr('content');
    const [hash, relPath] = content.split(' ');
    assert.match(hash, /^[0-9a-f]{40}$/);
    assert.equal(relPath, 'main.tex');
  });

  it('skips files that no longer exist', async () => {
    const $ = load('<html><head></head></html>');
    await injectDependencyMeta($, [path.join(dir, 'ghost.tex')], dir);
    assert.equal($('meta[name="dependency"]').length, 0);
  });
});

describe('enrichActivityLinks', () => {
  let root, outDir;
  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'tex4npm-xourse-'));
    outDir = path.join(root, 'dist');
    await mkdir(outDir, { recursive: true });

    // Compiled activity HTML in outDir
    await writeFile(path.join(outDir, 'section.html'), `
      <html><head><title>My Section</title></head>
      <body><div class="abstract"><p>A great section.</p></div></body></html>
    `);
  });
  after(() => rm(root, { recursive: true, force: true }));

  it('normalizes href and injects title and abstract', async () => {
    // Simulate a xourse HTML at outDir/main.html (source: root/main.tex)
    const $ = load(`<html><head></head><body>
      <a class="activity" href="section.tex">Activity</a>
    </body></html>`);

    await enrichActivityLinks($, path.join(outDir, 'main.html'), root, outDir);

    const link = $('a.activity');
    assert.equal(link.attr('href'), 'section');
    assert.equal(link.find('h2').text(), 'My Section');
    assert.ok(link.find('h3').text().includes('great section'));
  });

  it('skips links whose compiled HTML does not exist yet', async () => {
    const $ = load(`<a class="activity" href="missing.tex">x</a>`);
    await assert.doesNotReject(() =>
      enrichActivityLinks($, path.join(outDir, 'main.html'), root, outDir)
    );
    assert.equal($('a.activity').find('h2').length, 0);
  });

  it('skips links that do not end in .tex', async () => {
    const $ = load(`<a class="activity" href="https://example.com">x</a>`);
    await enrichActivityLinks($, path.join(outDir, 'main.html'), root, outDir);
    assert.equal($('a.activity').find('h2').length, 0);
  });
});

describe('postprocess (integration)', () => {
  let dir;
  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'tex4npm-pp-'));
  });
  after(() => rm(dir, { recursive: true, force: true }));

  it('writes modified HTML back to the file', async () => {
    const htmlPath = path.join(dir, 'out.html');
    await writeFile(htmlPath, '<html><head></head><body><p></p><p>hi</p></body></html>');

    await postprocess(htmlPath, [], dir, dir);

    const result = await readFile(htmlPath, 'utf8');
    const $ = load(result);
    assert.equal($('p').length, 1);
    assert.equal($('p').text(), 'hi');
  });
});
