import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'fs/promises';
import { load } from 'cheerio';
import os from 'os';
import path from 'path';
import {
  removeEmptyParas, injectDependencyMeta, isXourse,
  removeSpuriousAnchors, enrichActivityLinks, postprocess,
  injectXmjax, injectXmcss, filterXmjaxCommands,
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

describe('filterXmjaxCommands', () => {
  it('keeps \\newcommand lines', () => {
    const result = filterXmjaxCommands('\\newcommand {\\foo}[1]{#1}\n');
    assert.ok(result.includes('\\newcommand'));
  });

  it('keeps \\DeclareMathOperator lines', () => {
    const result = filterXmjaxCommands('\\DeclareMathOperator {\\Re}{Re}\n');
    assert.ok(result.includes('\\DeclareMathOperator'));
  });

  it('keeps \\newenvironment lines', () => {
    const result = filterXmjaxCommands('\\newenvironment {prompt}{}{}\n');
    assert.ok(result.includes('\\newenvironment'));
  });

  it('removes lines containing : * or @', () => {
    const result = filterXmjaxCommands(
      '\\newcommand {\\:foo}[0]{}\n\\newcommand {\\bar}[0]{}\n'
    );
    assert.ok(!result.includes('\\:foo'));
    assert.ok(result.includes('\\bar'));
  });

  it('removes lines containing \\label', () => {
    const result = filterXmjaxCommands(
      '\\newcommand {\\baz}[1]{\\label{##1}}\n\\newcommand {\\ok}[0]{}\n'
    );
    assert.ok(!result.includes('\\baz'));
    assert.ok(result.includes('\\ok'));
  });

  it('replaces ##N with #N', () => {
    const result = filterXmjaxCommands('\\newcommand {\\foo}[2]{##1 ##2}\n');
    assert.ok(result.includes('#1 #2'));
    assert.ok(!result.includes('##'));
  });

  it('drops lines that do not start with a recognised prefix', () => {
    const result = filterXmjaxCommands('\\renewcommand {\\foo}{}\n');
    assert.equal(result.trim(), '');
  });
});

describe('injectXmjax', () => {
  let dir;
  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'tex4npm-xmjax-'));
  });
  after(() => rm(dir, { recursive: true, force: true }));

  it('prepends a math/tex script into div.preamble', async () => {
    const xmjaxPath = path.join(dir, 'sample.xmjax');
    await writeFile(xmjaxPath, '\\newcommand {\\foo}[0]{bar}\n');
    const $ = load('<html><body><div class="preamble"></div></body></html>');
    await injectXmjax($, xmjaxPath);
    const script = $('div.preamble script[type="math/tex"]');
    assert.equal(script.length, 1);
    assert.ok(script.html().includes('\\newcommand'));
  });

  it('does nothing when the file is absent', async () => {
    const $ = load('<html><body><div class="preamble"></div></body></html>');
    await assert.doesNotReject(() => injectXmjax($, path.join(dir, 'missing.xmjax')));
    assert.equal($('div.preamble script').length, 0);
  });

  it('does nothing when no commands survive filtering', async () => {
    const xmjaxPath = path.join(dir, 'empty.xmjax');
    await writeFile(xmjaxPath, '\\renewcommand {\\foo}{}\n');
    const $ = load('<html><body><div class="preamble"></div></body></html>');
    await injectXmjax($, xmjaxPath);
    assert.equal($('div.preamble script').length, 0);
  });
});

describe('injectXmcss', () => {
  let dir;
  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'tex4npm-xmcss-'));
  });
  after(() => rm(dir, { recursive: true, force: true }));

  it('appends a text/css style into div.preamble', async () => {
    const xmcssPath = path.join(dir, 'sample.xmcss');
    await writeFile(xmcssPath, '#minipage0{width:50%;}');
    const $ = load('<html><body><div class="preamble"></div></body></html>');
    await injectXmcss($, xmcssPath);
    const style = $('div.preamble style[type="text/css"]');
    assert.equal(style.length, 1);
    assert.ok(style.html().includes('50%'));
  });

  it('unescapes \\% to %', async () => {
    const xmcssPath = path.join(dir, 'escape.xmcss');
    await writeFile(xmcssPath, 'width:50\\%;');
    const $ = load('<html><body><div class="preamble"></div></body></html>');
    await injectXmcss($, xmcssPath);
    assert.ok($('div.preamble style').html().includes('50%'));
    assert.ok(!$('div.preamble style').html().includes('\\%'));
  });

  it('does nothing when the file is absent', async () => {
    const $ = load('<html><body><div class="preamble"></div></body></html>');
    await assert.doesNotReject(() => injectXmcss($, path.join(dir, 'missing.xmcss')));
    assert.equal($('div.preamble style').length, 0);
  });

  it('does nothing when the file is empty', async () => {
    const xmcssPath = path.join(dir, 'empty.xmcss');
    await writeFile(xmcssPath, '');
    const $ = load('<html><body><div class="preamble"></div></body></html>');
    await injectXmcss($, xmcssPath);
    assert.equal($('div.preamble style').length, 0);
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
