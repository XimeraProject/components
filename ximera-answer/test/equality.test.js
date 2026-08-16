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
