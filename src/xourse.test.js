import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { load } from 'cheerio';
import os from 'os';
import path from 'path';
import {
  isXourseHtml, removeSpuriousAnchors, parseManifest, writeManifest,
  renderLandingPage, emitScopedCopies, rewriteRelativePaths, materialize,
} from './xourse.js';

// ---------- isXourseHtml ----------

describe('isXourseHtml', () => {
  it('true when xourse description meta present', () => {
    const $ = load('<meta name="description" content="xourse">');
    assert.equal(isXourseHtml($), true);
  });
  it('false when absent', () => {
    const $ = load('<html><head></head></html>');
    assert.equal(isXourseHtml($), false);
  });
  it('false for other description content', () => {
    const $ = load('<meta name="description" content="other">');
    assert.equal(isXourseHtml($), false);
  });
});

// ---------- removeSpuriousAnchors ----------

describe('removeSpuriousAnchors', () => {
  it('unwraps bare <a id> with no href/class', () => {
    const $ = load('<p><a id="s">text</a></p>');
    removeSpuriousAnchors($);
    assert.equal($('a[id]').length, 0);
    assert.equal($('p').text(), 'text');
  });
  it('keeps anchors with class', () => {
    const $ = load('<a id="x" class="activity">t</a>');
    removeSpuriousAnchors($);
    assert.equal($('a[id]').length, 1);
  });
});

// ---------- parseManifest ----------

describe('parseManifest', () => {
  let root, outDir;
  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'tex4npm-xourse-parse-'));
    outDir = path.join(root, 'dist');
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, 'demo.html'),
      '<html><head><title>Demo Title</title></head>' +
      '<body><div class="abstract"><p>Demo abstract.</p></div></body></html>');
    await writeFile(path.join(outDir, 'sample.html'),
      '<html><head><title>Sample Title</title></head>' +
      '<body><div class="abstract">Sample abstract.</div></body></html>');
  });
  after(() => rm(root, { recursive: true, force: true }));

  it('extracts title from <meta name="title">, activities under implicit part', async () => {
    const $ = load(`<html><head>
      <meta name="description" content="xourse">
      <meta name="title" content="My Course">
    </head><body>
      <a class="activity" href="demo">demo</a>
      <a class="activity" href="sample">sample</a>
    </body></html>`);

    const m = await parseManifest($, 'all', root, outDir);
    assert.equal(m.xourse, 'all');
    assert.equal(m.title, 'My Course');
    assert.equal(m.parts.length, 1);
    assert.equal(m.parts[0].title, null);
    assert.equal(m.parts[0].activities.length, 2);
    assert.equal(m.parts[0].activities[0].path, 'demo');
    assert.equal(m.parts[0].activities[0].title, 'Demo Title');
    assert.ok(m.parts[0].activities[0].abstract.includes('Demo abstract'));
    assert.equal(m.flatOrder.join(','), 'demo,sample');
  });

  it('splits by <h1 class="card part">, keeps implicit part when activities precede', async () => {
    const $ = load(`<html><head>
      <meta name="title" content="X">
    </head><body>
      <a class="activity" href="demo">demo</a>
      <h1 class="card part">Part One</h1>
      <a class="activity" href="sample">sample</a>
    </body></html>`);
    const m = await parseManifest($, 'all', root, outDir);
    assert.equal(m.parts.length, 2);
    assert.equal(m.parts[0].title, null);
    assert.deepEqual(m.parts[0].activities.map(a => a.path), ['demo']);
    assert.equal(m.parts[1].title, 'Part One');
    assert.deepEqual(m.parts[1].activities.map(a => a.path), ['sample']);
  });

  it('emits null title/abstract when canonical HTML is missing', async () => {
    const $ = load(`<html><head><meta name="title" content="X"></head>
      <body><a class="activity" href="ghost">ghost</a></body></html>`);
    const m = await parseManifest($, 'all', root, outDir);
    assert.equal(m.parts[0].activities[0].title, null);
    assert.equal(m.parts[0].activities[0].abstract, null);
  });

  it('title is null when meta[name=title] is empty', async () => {
    const $ = load('<meta name="title" content=""><body></body>');
    const m = await parseManifest($, 'all', root, outDir);
    assert.equal(m.title, null);
  });
});

// ---------- writeManifest ----------

describe('writeManifest', () => {
  let outDir;
  before(async () => {
    outDir = await mkdtemp(path.join(os.tmpdir(), 'tex4npm-xourse-wm-'));
  });
  after(() => rm(outDir, { recursive: true, force: true }));

  it('writes JSON at {outDir}/{xourse}.manifest.json', async () => {
    const m = { xourse: 'foo', title: 'T', abstract: null, parts: [], flatOrder: [] };
    await writeManifest(m, outDir);
    const raw = await readFile(path.join(outDir, 'foo.manifest.json'), 'utf8');
    assert.deepEqual(JSON.parse(raw), m);
  });
});

// ---------- renderLandingPage ----------

describe('renderLandingPage', () => {
  it('sets <title>, injects h2/h3, rewrites hrefs to xourse/path.html', () => {
    const $ = load(`<html><head><title></title></head><body>
      <a class="activity" href="demo">demo</a>
      <a class="activity" href="sample">sample</a>
    </body></html>`);
    const manifest = {
      xourse: 'all',
      title: 'My Course',
      abstract: null,
      parts: [{
        title: null,
        activities: [
          { path: 'demo', title: 'Demo', abstract: 'Abs D' },
          { path: 'sample', title: 'Sample', abstract: 'Abs S' },
        ],
      }],
      flatOrder: ['demo', 'sample'],
    };
    renderLandingPage($, manifest);
    assert.equal($('title').text(), 'My Course');
    const demoLink = $('a.activity[href="all/demo.html"]');
    assert.equal(demoLink.length, 1);
    assert.equal(demoLink.find('h2').text(), 'Demo');
    assert.equal(demoLink.find('h3').text(), 'Abs D');
    const sampleLink = $('a.activity[href="all/sample.html"]');
    assert.equal(sampleLink.length, 1);
  });

  it('handles activity anchors whose href still carries .tex', () => {
    const $ = load('<a class="activity" href="demo.tex">demo</a>');
    const manifest = {
      xourse: 'all', title: 'T', abstract: null,
      parts: [{ title: null, activities: [{ path: 'demo', title: 'D', abstract: null }] }],
      flatOrder: ['demo'],
    };
    renderLandingPage($, manifest);
    assert.equal($('a.activity').attr('href'), 'all/demo.html');
  });

  it('unwraps spurious <a id> anchors', () => {
    const $ = load('<body><a id="stray">x</a></body>');
    renderLandingPage($, { xourse: 'a', title: '', abstract: null, parts: [], flatOrder: [] });
    assert.equal($('a[id]').length, 0);
  });
});

// ---------- rewriteRelativePaths ----------

describe('rewriteRelativePaths', () => {
  it('prepends ../ to relative refs, leaves absolute untouched', () => {
    const $ = load(`
      <link href="ximera.css">
      <link href="/root.css">
      <link href="https://cdn/x.css">
      <script src="ximera.js"></script>
      <script src="//example.com/x.js"></script>
      <img src="demo.svg">
      <img src="data:image/png;base64,AAA">
      <a href="foo.html">a</a>
      <a href="#anchor">b</a>
      <a href="mailto:x@y">c</a>
    `);
    rewriteRelativePaths($);
    assert.equal($('link[href="../ximera.css"]').length, 1);
    assert.equal($('link[href="/root.css"]').length, 1);
    assert.equal($('link[href="https://cdn/x.css"]').length, 1);
    assert.equal($('script[src="../ximera.js"]').length, 1);
    assert.equal($('script[src="//example.com/x.js"]').length, 1);
    assert.equal($('img[src="../demo.svg"]').length, 1);
    assert.equal($('img[src="data:image/png;base64,AAA"]').length, 1);
    assert.equal($('a[href="../foo.html"]').length, 1);
    assert.equal($('a[href="#anchor"]').length, 1);
    assert.equal($('a[href="mailto:x@y"]').length, 1);
  });
});

// ---------- emitScopedCopies ----------

describe('emitScopedCopies', () => {
  let outDir;
  before(async () => {
    outDir = await mkdtemp(path.join(os.tmpdir(), 'tex4npm-scoped-'));
    // Canonical activities
    await writeFile(path.join(outDir, 'demo.html'),
      '<html><head><meta name="dependency" content="hash demo.tex">' +
      '<link rel="stylesheet" href="ximera.css"></head>' +
      '<body><p>demo</p><img src="demo-figure0.svg"></body></html>');
    await writeFile(path.join(outDir, 'sample.html'),
      '<html><head><link rel="stylesheet" href="ximera.css"></head>' +
      '<body><p>sample</p></body></html>');
    await writeFile(path.join(outDir, 'third.html'),
      '<html><head><link rel="stylesheet" href="ximera.css"></head>' +
      '<body><p>third</p></body></html>');
  });
  after(() => rm(outDir, { recursive: true, force: true }));

  it('writes one file per activity under {xourse}/, with nav, canonical, rewritten paths', async () => {
    const manifest = {
      xourse: 'all',
      title: 'My Course',
      abstract: null,
      parts: [{
        title: null,
        activities: [
          { path: 'demo', title: 'Demo', abstract: null },
          { path: 'sample', title: 'Sample', abstract: null },
          { path: 'third', title: 'Third', abstract: null },
        ],
      }],
      flatOrder: ['demo', 'sample', 'third'],
    };
    await emitScopedCopies(manifest, outDir);

    // First (demo): no prev, has next=sample
    const demoRaw = await readFile(path.join(outDir, 'all', 'demo.html'), 'utf8');
    const $demo = load(demoRaw);
    assert.equal($demo('meta[name="dependency"]').length, 0, 'dep meta stripped');
    assert.equal($demo('link[rel="canonical"]').attr('href'), '../demo.html');
    assert.equal($demo('nav.xourse-nav').length, 1);
    assert.equal($demo('a.xourse-crumb').attr('href'), '../all.html');
    assert.equal($demo('a.xourse-prev').length, 0, 'no prev on first');
    assert.equal($demo('a.xourse-next').length, 1);
    assert.equal($demo('a.xourse-next').attr('href'), 'sample.html');
    assert.equal($demo('link[href="../ximera.css"]').length, 1);
    assert.equal($demo('img[src="../demo-figure0.svg"]').length, 1);

    // Middle (sample): has both
    const sampleRaw = await readFile(path.join(outDir, 'all', 'sample.html'), 'utf8');
    const $sample = load(sampleRaw);
    assert.equal($sample('a.xourse-prev').attr('href'), 'demo.html');
    assert.equal($sample('a.xourse-next').attr('href'), 'third.html');

    // Last (third): no next
    const thirdRaw = await readFile(path.join(outDir, 'all', 'third.html'), 'utf8');
    const $third = load(thirdRaw);
    assert.equal($third('a.xourse-next').length, 0);
    assert.equal($third('a.xourse-prev').attr('href'), 'sample.html');
  });
});

// ---------- materialize (integration) ----------

describe('materialize', () => {
  let root, outDir;
  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'tex4npm-materialize-'));
    outDir = path.join(root, 'dist');
    await mkdir(outDir, { recursive: true });

    // xourse landing page
    await writeFile(path.join(outDir, 'all.html'),
      '<html><head>' +
      '<meta name="description" content="xourse">' +
      '<meta name="title" content="My Course">' +
      '<title></title>' +
      '</head><body>' +
      '<a class="activity" href="demo">demo</a>' +
      '<a class="activity" href="sample">sample</a>' +
      '</body></html>');

    // Canonical activities
    await writeFile(path.join(outDir, 'demo.html'),
      '<html><head><title>Demo Title</title><link rel="stylesheet" href="ximera.css"></head>' +
      '<body><div class="abstract">Demo abstract.</div></body></html>');
    await writeFile(path.join(outDir, 'sample.html'),
      '<html><head><title>Sample Title</title><link rel="stylesheet" href="ximera.css"></head>' +
      '<body><div class="abstract">Sample abstract.</div></body></html>');
  });
  after(() => rm(root, { recursive: true, force: true }));

  it('emits landing page, manifest, and scoped copies', async () => {
    await materialize(root, outDir);

    // Manifest
    const manifestRaw = await readFile(path.join(outDir, 'all.manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw);
    assert.equal(manifest.xourse, 'all');
    assert.equal(manifest.title, 'My Course');
    assert.deepEqual(manifest.flatOrder, ['demo', 'sample']);

    // Landing page mutated in place
    const landing = await readFile(path.join(outDir, 'all.html'), 'utf8');
    const $l = load(landing);
    assert.equal($l('title').text(), 'My Course');
    assert.equal($l('a.activity[href="all/demo.html"]').find('h2').text(), 'Demo Title');
    assert.equal($l('a.activity[href="all/sample.html"]').find('h2').text(), 'Sample Title');

    // Scoped copies exist
    assert.ok(existsSync(path.join(outDir, 'all', 'demo.html')));
    assert.ok(existsSync(path.join(outDir, 'all', 'sample.html')));
  });
});
