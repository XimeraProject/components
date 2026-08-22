// Cheerio-based tests for the postprocess hook (extraction + MathJax config
// injection). These tests were migrated from tex4npm/src/postprocess.test.js
// in Phase 4 when the answer transforms moved out of tex4npm.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import {
  extractAnswerBlanks, injectMathJaxHtmlExtension,
  estimateTextWidthEm, parseAnswerOptions, findAnswerMatches,
} from '../postprocess.js';

describe('estimateTextWidthEm', () => {
  it('returns a positive value for non-empty strings', () => {
    assert.ok(estimateTextWidthEm('7') > 0);
    assert.ok(estimateTextWidthEm('abc') > 0);
  });

  it('single digit is below the 2.5em minimum blank width', () => {
    assert.ok(estimateTextWidthEm('7') < 2.5);
  });

  it('width scales with length', () => {
    assert.ok(estimateTextWidthEm('ab') < estimateTextWidthEm('abcd'));
  });
});

describe('parseAnswerOptions', () => {
  it('parses a single key=value pair', () => {
    assert.deepEqual(parseAnswerOptions('format=float'), { format: 'float' });
  });

  it('parses multiple comma-separated pairs and trims', () => {
    assert.deepEqual(
      parseAnswerOptions(' format = float , tolerance = 0.01 '),
      { format: 'float', tolerance: '0.01' }
    );
  });

  it('treats a bare key as boolean true', () => {
    assert.deepEqual(parseAnswerOptions('given'), { given: 'true' });
  });

  it('returns {} for empty / undefined input', () => {
    assert.deepEqual(parseAnswerOptions(''), {});
    assert.deepEqual(parseAnswerOptions(undefined), {});
  });
});

describe('findAnswerMatches (balanced-brace parser)', () => {
  it('captures a simple value', () => {
    const ms = findAnswerMatches('x = \\answer{7}');
    assert.equal(ms.length, 1);
    assert.equal(ms[0].value, '7');
  });

  it('captures a value with nested braces (\\sqrt{2})', () => {
    const ms = findAnswerMatches('\\answer{\\sqrt{2}}');
    assert.equal(ms.length, 1);
    assert.equal(ms[0].value, '\\sqrt{2}');
  });

  it('captures a value with deep nesting', () => {
    const ms = findAnswerMatches('\\answer{\\frac{1}{\\sqrt{2}}}');
    assert.equal(ms.length, 1);
    assert.equal(ms[0].value, '\\frac{1}{\\sqrt{2}}');
  });

  it('captures the optional argument alongside a nested value', () => {
    const ms = findAnswerMatches('\\answer[format=symbolic]{\\sqrt{2}}');
    assert.equal(ms.length, 1);
    assert.equal(ms[0].optRaw, 'format=symbolic');
    assert.equal(ms[0].value, '\\sqrt{2}');
  });

  it('honors \\{ and \\} escapes inside the value', () => {
    const ms = findAnswerMatches('\\answer{a\\{b\\}c}');
    assert.equal(ms.length, 1);
    assert.equal(ms[0].value, 'a\\{b\\}c');
  });

  it('finds multiple occurrences with mixed nesting', () => {
    const ms = findAnswerMatches('\\answer{\\sqrt{2}} + \\answer{3}');
    assert.equal(ms.length, 2);
    assert.equal(ms[0].value, '\\sqrt{2}');
    assert.equal(ms[1].value, '3');
  });

  it('bails without corrupting output when braces are unbalanced', () => {
    const ms = findAnswerMatches('\\answer{\\sqrt{2}');   // missing final `}`
    assert.equal(ms.length, 0);
  });
});

describe('extractAnswerBlanks', () => {
  it('creates a state-holder span with data-correct-text', () => {
    const $ = load('<span class="mathjax-inline">\\(x = \\answer{7}\\)</span>');
    extractAnswerBlanks($);
    assert.equal($('.answer.respondable').length, 1);
    assert.equal($('.answer.respondable').attr('data-correct-text'), '7');
  });

  it('replaces \\answer with a single \\cssId-wrapped \\phantom', () => {
    const $ = load('<span class="mathjax-inline">\\(x = \\answer{7}\\)</span>');
    extractAnswerBlanks($);
    const mathHtml = $('span.mathjax-inline').html();
    assert.ok(mathHtml.includes('\\cssId{'));
    assert.ok(mathHtml.includes('\\phantom{'));
    assert.ok(mathHtml.includes('\\vphantom{\\bigg|}'));
    assert.ok(!mathHtml.includes('\\answer'));
  });

  it('carries data-format / data-tolerance through from options', () => {
    const $ = load('<span class="mathjax-inline">\\(\\answer[format=float,tolerance=0.01]{1.414}\\)</span>');
    extractAnswerBlanks($);
    const span = $('.answer.respondable');
    assert.equal(span.attr('data-correct-text'), '1.414');
    assert.equal(span.attr('data-format'), 'float');
    assert.equal(span.attr('data-tolerance'), '0.01');
  });

  it('omits data-format / data-tolerance when not authored', () => {
    const $ = load('<span class="mathjax-inline">\\(\\answer{17}\\)</span>');
    extractAnswerBlanks($);
    const span = $('.answer.respondable');
    assert.equal(span.attr('data-format'), undefined);
    assert.equal(span.attr('data-tolerance'), undefined);
  });

  it('carries data-format only when only format is set', () => {
    const $ = load('<span class="mathjax-inline">\\(\\answer[format=integer]{5}\\)</span>');
    extractAnswerBlanks($);
    const span = $('.answer.respondable');
    assert.equal(span.attr('data-format'), 'integer');
    assert.equal(span.attr('data-tolerance'), undefined);
  });

  it('wraps math span + state-holder in .ximera-math-with-answers', () => {
    const $ = load('<span class="mathjax-inline">\\(\\answer{3}\\)</span>');
    extractAnswerBlanks($);
    assert.equal($('.ximera-math-with-answers').length, 1);
    assert.equal($('.ximera-math-with-answers span.mathjax-inline').length, 1);
    assert.equal($('.ximera-math-with-answers .answer.respondable').length, 1);
  });

  it('handles multiple \\answer in one math span', () => {
    const $ = load('<span class="mathjax-inline">\\(\\answer{1} + \\answer{2}\\)</span>');
    extractAnswerBlanks($);
    assert.equal($('.answer.respondable').length, 2);
    assert.equal($('.ximera-math-with-answers').length, 1);
  });

  it('processes \\answer inside display math using <div> wrapper', () => {
    const $ = load('<div class="mathjax-block">\\[ \\answer{5} \\]</div>');
    extractAnswerBlanks($);
    assert.equal($('div.ximera-math-with-answers').length, 1);
    assert.equal($('span.ximera-math-with-answers').length, 0);
    assert.equal($('.answer.respondable').length, 1);
  });

  it('adds \\hspace padding for short answers below minimum width', () => {
    const $ = load('<span class="mathjax-inline">\\(\\answer{7}\\)</span>');
    extractAnswerBlanks($);
    assert.ok($('span.mathjax-inline').html().includes('\\hspace{'));
  });

  it('handles \\answer{\\sqrt{2}} — nested braces do not orphan a close brace', () => {
    const $ = load('<div class="mathjax-block">\\[ \\sqrt{1+1} = \\answer{\\sqrt{2}}. \\]</div>');
    extractAnswerBlanks($);
    const span = $('.answer.respondable');
    assert.equal(span.attr('data-correct-text'), '\\sqrt{2}');
    // No stray closing brace should have been left behind (the previous
    // regex left one, producing a MathJax "extra close brace" error).
    const mathHtml = $('div.mathjax-block').html();
    const opens = (mathHtml.match(/\{/g) ?? []).length;
    const closes = (mathHtml.match(/\}/g) ?? []).length;
    assert.equal(opens, closes);
    assert.ok(!mathHtml.includes('\\answer'));
  });

  it('emits the correct-text as raw math inside \\phantom (not \\text)', () => {
    // The whole point of the fix: MathJax must typeset the argument as
    // math so a radical/fraction/etc. gets its real rendered width.
    const $ = load('<span class="mathjax-inline">\\(\\answer{\\sqrt{2}}\\)</span>');
    extractAnswerBlanks($);
    const mathHtml = $('span.mathjax-inline').html();
    assert.ok(mathHtml.includes('\\phantom{\\sqrt{2}'));
    // Older text-escaping path is gone.
    assert.ok(!mathHtml.includes('\\text{\\textbackslash'));
  });

  it('assigns unique IDs across multiple spans', () => {
    const $ = load(
      '<span class="mathjax-inline">\\(\\answer{3}\\)</span>' +
      '<span class="mathjax-inline">\\(\\answer{5}\\)</span>'
    );
    extractAnswerBlanks($);
    const ids = $('.answer.respondable').map((_, el) => $(el).attr('id')).toArray();
    assert.equal(new Set(ids).size, 2);
  });
});

describe('injectMathJaxHtmlExtension', () => {
  it('adds html package to an existing tex config', () => {
    const $ = load(`<html><head>
      <script>window.MathJax = { tex: { tags: "ams" } };</script>
    </head></html>`);
    injectMathJaxHtmlExtension($);
    const src = $('script').html();
    assert.ok(src.includes("'[+]'") || src.includes('"[+]"'));
    assert.ok(src.includes('html'));
  });

  it('adds loader.load so MathJax 4 fetches the html extension', () => {
    const $ = load(`<html><head>
      <script>window.MathJax = { tex: { tags: "ams" } };</script>
    </head></html>`);
    injectMathJaxHtmlExtension($);
    const src = $('script').html();
    assert.ok(src.includes('loader'));
    assert.ok(src.includes('[tex]/html'));
  });

  it('is idempotent — does not double-patch', () => {
    const $ = load(`<html><head>
      <script>window.MathJax = { tex: { tags: "ams" } };</script>
    </head></html>`);
    injectMathJaxHtmlExtension($);
    injectMathJaxHtmlExtension($);
    const count = ($('script').html().match(/\[\+\]/g) ?? []).length;
    assert.equal(count, 1);
  });

  it('does nothing when no MathJax script is present', () => {
    const $ = load('<html><head><script>var x = 1;</script></head></html>');
    assert.doesNotThrow(() => injectMathJaxHtmlExtension($));
  });
});
