import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { load } from 'cheerio';
import os from 'os';
import path from 'path';
import {
  ensureCharset, removeEmptyParas, injectDependencyMeta, postprocess,
  injectXmjax, injectXmcss, filterXmjaxCommands,
  stripOldXimeraScripts, unwrapSvgObjects, inlineSvgImages,
} from './postprocess.js';

describe('ensureCharset', () => {
  it('prepends <meta charset="utf-8"> as first child of <head>', () => {
    const $ = load('<html><head><title>T</title></head><body></body></html>');
    ensureCharset($);
    assert.equal($('head').children().first().attr('charset'), 'utf-8');
  });

  it('removes any pre-existing http-equiv Content-Type meta', () => {
    const $ = load('<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body></body></html>');
    ensureCharset($);
    assert.equal($('meta[http-equiv="Content-Type"]').length, 0);
    assert.equal($('meta[charset]').length, 1);
  });

  it('is idempotent when called twice', () => {
    const $ = load('<html><head></head><body></body></html>');
    ensureCharset($);
    ensureCharset($);
    assert.equal($('meta[charset]').length, 1);
  });
});

describe('unwrapSvgObjects', () => {
  it('promotes an inner <img> when the <object> has fallback content', () => {
    const $ = load('<object type="image/svg+xml" data="fig.svg"><img src="fig.svg" alt=""></object>');
    unwrapSvgObjects($);
    assert.equal($('object').length, 0);
    assert.equal($('img').length, 1);
    assert.equal($('img').attr('src'), 'fig.svg');
  });

  it('synthesizes an <img> from the data attribute when the <object> is empty', () => {
    const $ = load('<object type="image/svg+xml" data="./main-figure4.svg" class="graphics"></object>');
    unwrapSvgObjects($);
    assert.equal($('object').length, 0);
    assert.equal($('img').length, 1);
    assert.equal($('img').attr('src'), './main-figure4.svg');
  });

  it('leaves non-svg <object> elements alone', () => {
    const $ = load('<object type="application/pdf" data="doc.pdf"></object>');
    unwrapSvgObjects($);
    assert.equal($('object').length, 1);
  });
});

describe('inlineSvgImages', () => {
  let tmpDir;
  before(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'inline-svg-'));
    await writeFile(path.join(tmpDir, 'fig.svg'),
      `<?xml version='1.0' encoding='UTF-8'?><svg xmlns='http://www.w3.org/2000/svg'><text>hello</text></svg>`);
  });
  after(() => rm(tmpDir, { recursive: true, force: true }));

  it('replaces <img src="*.svg"> with the inline <svg> element', async () => {
    const $ = load(`<p><img src="fig.svg"></p>`);
    await inlineSvgImages($, tmpDir);
    assert.equal($('img').length, 0);
    assert.equal($('svg').length, 1);
    assert.equal($('svg text').text(), 'hello');
  });

  it('strips the XML declaration before inserting', async () => {
    const $ = load(`<img src="fig.svg">`);
    await inlineSvgImages($, tmpDir);
    assert.ok(!$.html().includes('<?xml'));
  });

  it('leaves <img src="*.svg"> in place when the file is missing', async () => {
    const $ = load(`<img src="missing.svg">`);
    await inlineSvgImages($, tmpDir);
    assert.equal($('img').length, 1);
  });

  it('leaves non-SVG <img> elements alone', async () => {
    const $ = load(`<img src="photo.png">`);
    await inlineSvgImages($, tmpDir);
    assert.equal($('img').length, 1);
    assert.equal($('svg').length, 0);
  });
});

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

  it('prepends a hidden \\(...\\) macros block into div.preamble', async () => {
    const xmjaxPath = path.join(dir, 'sample.xmjax');
    await writeFile(xmjaxPath, '\\newcommand {\\foo}[0]{bar}\n');
    const $ = load('<html><body><div class="preamble"></div></body></html>');
    await injectXmjax($, xmjaxPath);
    const block = $('div.preamble div.xmjax-macros');
    assert.equal(block.length, 1);
    const html = block.html();
    assert.ok(html.includes('\\newcommand'));
    assert.ok(html.includes('\\('));
    assert.ok(html.includes('\\)'));
    assert.match(block.attr('style') ?? '', /display\s*:\s*none/);
  });

  it('does nothing when the file is absent', async () => {
    const $ = load('<html><body><div class="preamble"></div></body></html>');
    await assert.doesNotReject(() => injectXmjax($, path.join(dir, 'missing.xmjax')));
    assert.equal($('div.preamble div.xmjax-macros').length, 0);
  });

  it('does nothing when no commands survive filtering', async () => {
    const xmjaxPath = path.join(dir, 'empty.xmjax');
    await writeFile(xmjaxPath, '\\renewcommand {\\foo}{}\n');
    const $ = load('<html><body><div class="preamble"></div></body></html>');
    await injectXmjax($, xmjaxPath);
    assert.equal($('div.preamble div.xmjax-macros').length, 0);
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

describe('stripOldXimeraScripts', () => {
  it('removes ximera.osu.edu script and link tags', () => {
    const $ = load(
      '<head>' +
      '<link href="https://ximera.osu.edu/public/stylesheets/standalone.css" rel="stylesheet">' +
      '<script src="https://ximera.osu.edu/public/javascripts/standalone.min.js"></script>' +
      '</head>'
    );
    stripOldXimeraScripts($);
    assert.equal($('link[href*="ximera.osu.edu"]').length, 0);
    assert.equal($('script[src*="ximera.osu.edu"]').length, 0);
  });

  it('leaves unrelated tags intact', () => {
    const $ = load('<link rel="stylesheet" href="/other.css"><script src="/other.js"></script>');
    stripOldXimeraScripts($);
    assert.equal($('link').length, 1);
    assert.equal($('script').length, 1);
  });
});

describe('postprocess (integration)', () => {
  let dir;
  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'tex4npm-pp-'));
  });
  after(() => rm(dir, { recursive: true, force: true }));

  it('strips tex4ht CSS counter declarations that appear before <html>', async () => {
    const htmlPath = path.join(dir, 'counter-garbage.html');
    await writeFile(htmlPath,
      'freeResponse\nmultipleChoice\n' +
      '<html><head></head><body><p>content</p></body></html>'
    );

    await postprocess(htmlPath, [], dir, dir);

    const result = await readFile(htmlPath, 'utf8');
    assert.ok(!result.includes('freeResponse'), 'counter name should be stripped');
    assert.ok(!result.includes('multipleChoice'), 'counter name should be stripped');
    assert.ok(result.includes('content'), 'real content should survive');
  });

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
