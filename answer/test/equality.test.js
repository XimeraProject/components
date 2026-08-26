// Pure equality-engine tests — spec §10 Example 10. No DOM.
//
// This is the D8 acceptance from PLAN.md: the ported equality engine must
// match the legacy client's answer-checking semantics as recorded in the
// spec's exhaustive-over-format-and-tolerance table.

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAnswer } from '../index.js';

// Rows from specs/components/ximera-answer.md §10 Example 10.
const rows = [
  ['17', '17', undefined, undefined, true, 'integer literal, expression mode'],
  ['17.0', '17', undefined, undefined, true, 'expression equality across notation'],
  ['seventeen', '17', undefined, undefined, false, 'unparseable / unequal symbol'],
  ['17', '17', 'integer', undefined, true, 'integer format equal'],
  ['17.5', '17', 'integer', undefined, false, 'integer format rejects fractional input'],
  ['1.414', '1.414', 'float', undefined, true, 'float format equal'],
  ['1.42', '1.414', 'float', 0.01, true, 'float format within tolerance'],
  ['1.5', '1.414', 'float', 0.01, false, 'float format beyond tolerance'],
  ['cat', 'CAT', 'string', undefined, true, 'string is case-insensitive'],
  ['dog', 'cat', 'string', undefined, false, 'string mismatch'],
  ['2x', '2*x', undefined, undefined, true, 'implicit multiplication symbolic equality'],
  ['x+x', '2*x', undefined, undefined, true, 'symbolic simplification'],
  ['', '17', undefined, undefined, false, 'empty input'],
  ['   ', '17', undefined, undefined, false, 'whitespace-only input'],
];

for (const [response, correctText, format, tolerance, expected, label] of rows) {
  test(`equality: (${JSON.stringify(response)}, ${JSON.stringify(correctText)}, ${format ?? 'expr'}, ${tolerance ?? '-'}) → ${expected}  // ${label}`, () => {
    assert.equal(checkAnswer(response, correctText, format, tolerance), expected);
  });
}

// ─── MathML path ───────────────────────────────────────────────────────────
//
// When MathJax has parsed the authored correct-LaTeX at mount time, the
// resulting MathML is what checkAnswer should treat as the correct side —
// math-expressions.fromMml handles constructs its own fromLatex mishandles
// (e.g. \sqrt{2}).

const SQRT2_MML = '<math><msqrt><mn>2</mn></msqrt></math>';
const FRAC_1_SQRT2_MML =
  '<math><mfrac><mn>1</mn><msqrt><mn>2</mn></msqrt></mfrac></math>';

test('MathML: student \\sqrt{2} matches MathML-derived correct answer', () => {
  assert.equal(
    checkAnswer('\\sqrt{2}', '\\sqrt{2}', undefined, undefined, SQRT2_MML),
    true,
  );
});

test('MathML: student sqrt(2) matches MathML-derived correct answer', () => {
  assert.equal(
    checkAnswer('sqrt(2)', '\\sqrt{2}', undefined, undefined, SQRT2_MML),
    true,
  );
});

test('MathML: nested \\frac{1}{\\sqrt{2}} matches equivalent text 1/sqrt(2)', () => {
  assert.equal(
    checkAnswer('1/sqrt(2)', '\\frac{1}{\\sqrt{2}}', undefined, undefined, FRAC_1_SQRT2_MML),
    true,
  );
});

test('MathML: wrong student answer still rejected', () => {
  assert.equal(
    checkAnswer('sqrt(3)', '\\sqrt{2}', undefined, undefined, SQRT2_MML),
    false,
  );
});

test('MathML: honored only in expression mode — float format ignores MathML', () => {
  // In float mode the correct side is a Number, not an Expression. Passing a
  // MathML string must not derail that path.
  assert.equal(
    checkAnswer('1.414', '1.414', 'float', undefined, SQRT2_MML),
    true,
  );
});

test('MathML: empty correctMathml falls back to LaTeX path', () => {
  // \sqrt{2} through fromLatex; equivalent student input via text.
  assert.equal(
    checkAnswer('sqrt(2)', '\\sqrt{2}', undefined, undefined, ''),
    true,
  );
});

test('MathML: garbage MathML falls through to LaTeX path (no throw)', () => {
  assert.equal(
    checkAnswer('sqrt(2)', '\\sqrt{2}', undefined, undefined, '<not-mathml>'),
    true,
  );
});

test('parseCorrect: prefers MathML over correctText when both usable', () => {
  // Deliberately mismatched correctText and MathML to prove MathML wins:
  // correctText parses as 99, MathML parses as sqrt(2). Student "sqrt(2)"
  // must match — i.e. the MathML side is what was consulted.
  assert.equal(
    checkAnswer('sqrt(2)', '99', undefined, undefined, SQRT2_MML),
    true,
  );
  assert.equal(
    checkAnswer('99', '99', undefined, undefined, SQRT2_MML),
    false,
  );
});
