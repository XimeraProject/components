import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import xourseHooks, { injectLanding, injectScoped, relPathBetween } from '../xourse.js';

// Small manifest used by most tests below.
function baseManifest() {
  return {
    xourse: 'all',
    title: 'My Course',
    abstract: null,
    parts: [{
      title: null,
      activities: [
        { path: 'demo',   title: 'Demo Title',   abstract: 'Demo abstract' },
        { path: 'sample', title: 'Sample Title', abstract: null },
        { path: 'third',  title: 'Third Title',  abstract: null },
      ],
    }],
    flatOrder: ['demo', 'sample', 'third'],
  };
}

describe('default export', () => {
  it('exposes injectLanding and injectScoped', () => {
    assert.equal(typeof xourseHooks.injectLanding, 'function');
    assert.equal(typeof xourseHooks.injectScoped, 'function');
  });
});

describe('relPathBetween', () => {
  it('same-directory siblings', () => {
    assert.equal(relPathBetween('demo', 'sample'), 'sample.html');
  });

  it('across subdirectories', () => {
    assert.equal(relPathBetween('chapter1/one', 'chapter2/two'), '../chapter2/two.html');
  });

  it('walking up', () => {
    assert.equal(relPathBetween('chapter1/one', 'demo'), '../demo.html');
  });
});

describe('injectLanding', () => {
  it('appends <h2>title</h2><h3>abstract</h3> inside each activity anchor', async () => {
    const $ = load(
      '<span class="ximera-course-title" data-empty=""></span>' +
      '<main class="ximera-content">' +
      '<a class="activity" href="all/demo.html">demo</a>' +
      '<a class="activity" href="all/sample.html">sample</a>' +
      '</main>'
    );
    await injectLanding($, { manifest: baseManifest(), outDir: '/o', htmlPath: '/o/all.html', depth: 0 });
    const $demo = $('a.activity[href="all/demo.html"]');
    assert.equal($demo.find('h2').text(), 'Demo Title');
    assert.equal($demo.find('h3').text(), 'Demo abstract');
    const $sample = $('a.activity[href="all/sample.html"]');
    assert.equal($sample.find('h2').text(), 'Sample Title');
    assert.equal($sample.find('h3').length, 0, 'no h3 when abstract is null');
  });

  it('fills the navbar course-title slot from the manifest', async () => {
    const $ = load(
      '<span class="ximera-course-title" data-empty=""></span>' +
      '<main class="ximera-content"></main>'
    );
    await injectLanding($, { manifest: baseManifest(), outDir: '/o', htmlPath: '/o/all.html', depth: 0 });
    const $slot = $('.ximera-course-title');
    assert.equal($slot.text(), 'My Course');
    assert.equal($slot.attr('data-empty'), undefined);
  });

  it('is idempotent', async () => {
    const $ = load(
      '<main class="ximera-content">' +
      '<a class="activity" href="all/demo.html">demo</a>' +
      '</main>'
    );
    const ctx = { manifest: baseManifest(), outDir: '/o', htmlPath: '/o/all.html', depth: 0 };
    await injectLanding($, ctx);
    await injectLanding($, ctx);
    assert.equal($('a.activity h2').length, 1);
  });

  it('falls back to <body> when no .ximera-content container exists', async () => {
    const $ = load('<body><a class="activity" href="all/demo.html">demo</a></body>');
    await injectLanding($, { manifest: baseManifest(), outDir: '/o', htmlPath: '/o/all.html', depth: 0 });
    assert.equal($('a.activity h2').text(), 'Demo Title');
  });
});

describe('injectScoped', () => {
  function loadCanonical() {
    return load(
      '<span class="ximera-course-title" data-empty=""></span>' +
      '<main class="ximera-content"><p>activity body</p></main>'
    );
  }

  it('fills the navbar course-title slot from the manifest', async () => {
    const $ = loadCanonical();
    await injectScoped($, {
      manifest: baseManifest(), activityPath: 'demo',
      prev: null, next: 'sample', depth: 1,
      outDir: '/o', htmlPath: '/o/all/demo.html',
    });
    const $slot = $('.ximera-course-title');
    assert.equal($slot.text(), 'My Course');
    assert.equal($slot.attr('data-empty'), undefined);
  });

  it('adds data-xourse-layout on the content container', async () => {
    const $ = loadCanonical();
    await injectScoped($, {
      manifest: baseManifest(), activityPath: 'demo',
      prev: null, next: 'sample', depth: 1,
      outDir: '/o', htmlPath: '/o/all/demo.html',
    });
    assert.equal($('main.ximera-content').attr('data-xourse-layout'), '');
  });

  it('injects breadcrumb pointing at the xourse landing via depth', async () => {
    const $ = loadCanonical();
    await injectScoped($, {
      manifest: baseManifest(), activityPath: 'demo',
      prev: null, next: 'sample', depth: 1,
      outDir: '/o', htmlPath: '/o/all/demo.html',
    });
    const $crumb = $('nav.xourse-breadcrumb');
    assert.equal($crumb.length, 1);
    assert.equal($crumb.find('a').attr('href'), '../all.html');
    assert.match($crumb.text(), /My Course/);
    assert.equal($crumb.find('.xourse-crumb-current').text(), 'Demo Title');
  });

  it('breadcrumb uses depth=2 for nested activities', async () => {
    const m = baseManifest();
    m.parts[0].activities.unshift({ path: 'chapter1/section1', title: 'Deep', abstract: null });
    m.flatOrder.unshift('chapter1/section1');
    const $ = loadCanonical();
    await injectScoped($, {
      manifest: m, activityPath: 'chapter1/section1',
      prev: null, next: 'demo', depth: 2,
      outDir: '/o', htmlPath: '/o/all/chapter1/section1.html',
    });
    assert.equal($('nav.xourse-breadcrumb a').attr('href'), '../../all.html');
  });

  it('injects a TOC with one <li> per activity, current marked', async () => {
    const $ = loadCanonical();
    await injectScoped($, {
      manifest: baseManifest(), activityPath: 'sample',
      prev: 'demo', next: 'third', depth: 1,
      outDir: '/o', htmlPath: '/o/all/sample.html',
    });
    const $toc = $('aside.xourse-toc');
    assert.equal($toc.length, 1);
    const $items = $toc.find('li');
    assert.equal($items.length, 3);
    const current = $items.filter('[data-state="current"]');
    assert.equal(current.length, 1);
    assert.match(current.text(), /Sample Title/);
    assert.equal(current.find('a').length, 0, 'current is not a link');
  });

  it('injects a pager with prev and next inside the body block', async () => {
    const $ = loadCanonical();
    await injectScoped($, {
      manifest: baseManifest(), activityPath: 'sample',
      prev: 'demo', next: 'third', depth: 1,
      outDir: '/o', htmlPath: '/o/all/sample.html',
    });
    const $pager = $('nav.xourse-pager');
    assert.equal($pager.length, 1);
    assert.equal($pager.find('a.xourse-prev').attr('href'), 'demo.html');
    assert.equal($pager.find('a.xourse-next').attr('href'), 'third.html');
    assert.match($pager.find('a.xourse-prev').text(), /Demo Title/);
    assert.match($pager.find('a.xourse-next').text(), /Third Title/);
  });

  it('pager emits placeholder spans when prev or next is null', async () => {
    const $ = loadCanonical();
    await injectScoped($, {
      manifest: baseManifest(), activityPath: 'demo',
      prev: null, next: 'sample', depth: 1,
      outDir: '/o', htmlPath: '/o/all/demo.html',
    });
    assert.equal($('nav.xourse-pager a.xourse-prev').length, 0);
    assert.equal($('nav.xourse-pager span.xourse-prev').length, 1);
    assert.equal($('nav.xourse-pager a.xourse-next').length, 1);
  });

  it('the original body content lands inside .xourse-body', async () => {
    const $ = loadCanonical();
    await injectScoped($, {
      manifest: baseManifest(), activityPath: 'demo',
      prev: null, next: 'sample', depth: 1,
      outDir: '/o', htmlPath: '/o/all/demo.html',
    });
    const $body = $('main.ximera-content > .xourse-body');
    assert.equal($body.length, 1);
    assert.equal($body.find('> p').text(), 'activity body');
  });
});
