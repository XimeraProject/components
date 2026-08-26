import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import postprocess, { renderHeader, renderFooter } from '../postprocess.js';
import { config } from '../config.js';

describe('renderHeader', () => {
  it('includes the project name and inline logo SVG', () => {
    const html = renderHeader();
    assert.ok(html.includes(config.projectName));
    assert.ok(html.includes('<svg'));
  });

  it('exposes an empty course-title slot for xourse hooks to fill', () => {
    const html = renderHeader();
    const $ = load(html);
    assert.equal($('.ximera-course-title').length, 1);
    assert.equal($('.ximera-course-title').attr('data-empty'), '');
    assert.equal($('.ximera-course-title').text(), '');
  });

  it('reserves the progress bar and page-controls mount points', () => {
    const html = renderHeader();
    const $ = load(html);
    assert.equal($('#ximera-progress').length, 1);
    assert.equal($('#ximera-progress').attr('role'), 'progressbar');
    assert.equal($('#ximera-page-controls').length, 1);
  });

  it('renders the nav as a proper <nav> element for a11y', () => {
    const html = renderHeader();
    const $ = load(html);
    assert.equal($('nav.ximera-nav').length, 1);
    assert.equal($('nav.ximera-nav').attr('aria-label'), 'Site');
  });
});

describe('renderFooter', () => {
  it('emits one anchor per configured link', () => {
    const html = renderFooter();
    const $ = load(html);
    assert.equal($('.ximera-footer-links a').length, config.footerLinks.length);
  });

  it('includes the footer note', () => {
    const html = renderFooter();
    assert.ok(html.includes(config.footerNote.split(' ')[0]));
  });

  it('inlines the ghosted wordmark svg behind the footer', () => {
    const html = renderFooter();
    const $ = load(html);
    assert.equal($('.ximera-footer-mark').length, 1);
    assert.equal($('.ximera-footer-mark').attr('aria-hidden'), 'true');
    assert.ok($('.ximera-footer-mark svg').length >= 1);
  });
});

describe('postprocess (chrome scaffold)', () => {
  it('wraps body children in <main class="ximera-content">', async () => {
    const $ = load('<html><head><title>T</title></head><body><p>hello</p></body></html>');
    await postprocess($, {});
    assert.equal($('main.ximera-content').length, 1);
    assert.equal($('main.ximera-content p').text(), 'hello');
  });

  it('prepends header and appends footer around main', async () => {
    const $ = load('<html><head><title>T</title></head><body><p>x</p></body></html>');
    await postprocess($, {});
    const bodyChildren = $('body').children().toArray().map(el => el.tagName);
    assert.deepEqual(bodyChildren, ['header', 'main', 'footer']);
  });

  it('injects font preconnect + stylesheet into <head>', async () => {
    const $ = load('<html><head><title>T</title></head><body><p>x</p></body></html>');
    await postprocess($, {});
    assert.equal($('#ximera-chrome-fonts').length, 1);
    assert.ok($('link[rel="preconnect"]').length >= 1);
  });

  it('preserves non-element body content (text nodes)', async () => {
    const $ = load('<html><body>plain text</body></html>');
    await postprocess($, {});
    assert.match($('main.ximera-content').text(), /plain text/);
  });

  it('is idempotent when applied twice', async () => {
    const $ = load('<html><head><title>T</title></head><body><p>x</p></body></html>');
    await postprocess($, {});
    await postprocess($, {});
    assert.equal($('main.ximera-content').length, 1);
    assert.equal($('header.ximera-header').length, 1);
    assert.equal($('footer.ximera-footer').length, 1);
    assert.equal($('#ximera-chrome-fonts').length, 1);
  });
});
