import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeps } from './deps.js';

describe('parseDeps', () => {
  it('finds \\input with .tex extension', () => {
    assert.deepEqual(parseDeps('\\input{chapter1.tex}'), ['chapter1.tex']);
  });

  it('adds .tex when missing', () => {
    assert.deepEqual(parseDeps('\\input{chapter1}'), ['chapter1.tex']);
  });

  it('finds \\activity', () => {
    assert.deepEqual(parseDeps('\\activity{exercises/hw1}'), ['exercises/hw1.tex']);
  });

  it('finds \\include and \\includeonly', () => {
    assert.deepEqual(
      parseDeps('\\include{a}\n\\includeonly{b}'),
      ['a.tex', 'b.tex']
    );
  });

  it('ignores commented-out commands', () => {
    assert.deepEqual(parseDeps('% \\input{hidden}\n\\input{visible}'), ['visible.tex']);
  });

  it('handles multiple deps', () => {
    assert.deepEqual(
      parseDeps('\\input{a}\n\\activity{b}\n\\input{c.tex}'),
      ['a.tex', 'b.tex', 'c.tex']
    );
  });

  it('returns empty array for no deps', () => {
    assert.deepEqual(parseDeps('\\begin{document}hello\\end{document}'), []);
  });
});
