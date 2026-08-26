import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { tex4htArg, makeTexInputs, compile } from './compile.js';

// Records all calls made through the fake runner.
function makeRecorder() {
  const calls = [];
  const run = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { stdout: '', stderr: '' };
  };
  return { calls, run };
}

const BASE_CONFIG = {
  tex4npmTexmf: '/project/.tex4npm/texmf',
  passes: 2,
};

describe('tex4htArg', () => {
  it('contains the tex4ht preamble', () => {
    assert.ok(tex4htArg('stem').includes('\\RequirePackage'));
    assert.ok(tex4htArg('stem').includes('tex4ht'));
  });

  it('ends with the config string and \\input STEM', () => {
    const arg = tex4htArg('mystem');
    assert.ok(arg.includes('ximera,charset=utf-8,-css.a.b.c.'));
    assert.ok(arg.endsWith('\\input mystem'));
  });

  it('works correctly with a plain basename stem', () => {
    const arg = tex4htArg('section');
    assert.ok(arg.endsWith('\\input section'));
  });
});

describe('makeTexInputs', () => {
  it('prepends the texmf path with recursive // suffix', () => {
    const result = makeTexInputs('/project/.tex4npm/texmf');
    assert.ok(result.startsWith('/project/.tex4npm/texmf//'));
  });

  it('includes a trailing colon to preserve default TeX paths', () => {
    const orig = process.env.TEXINPUTS;
    delete process.env.TEXINPUTS;
    try {
      assert.ok(makeTexInputs('/p').endsWith(':'));
    } finally {
      if (orig !== undefined) process.env.TEXINPUTS = orig;
    }
  });

  it('appends an existing TEXINPUTS value', () => {
    const orig = process.env.TEXINPUTS;
    process.env.TEXINPUTS = '/existing';
    try {
      assert.ok(makeTexInputs('/p').includes('/existing'));
    } finally {
      if (orig !== undefined) process.env.TEXINPUTS = orig;
      else delete process.env.TEXINPUTS;
    }
  });
});

describe('compile call sequence', () => {
  let dir;
  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'tex4npm-compile-'));
    // compile() reads stem.lg after tex4ht runs; pre-create it for the recorder tests
    await writeFile(path.join(dir, 'stem.lg'), 'File: stem.html\n');
  });
  after(() => rm(dir, { recursive: true, force: true }));

  const makeTexPath = () => path.join(dir, 'stem.tex');

  it('calls pdflatex, then latex×passes, then tex4ht, then t4ht', async () => {
    const { calls, run } = makeRecorder();
    await compile(makeTexPath(), { ...BASE_CONFIG, passes: 2 }, { run });

    assert.equal(calls[0].cmd, 'pdflatex');
    assert.equal(calls[1].cmd, 'latex');
    assert.equal(calls[2].cmd, 'latex');
    assert.equal(calls[3].cmd, 'tex4ht');
    assert.equal(calls[4].cmd, 't4ht');
    assert.equal(calls.length, 5);
  });

  it('runs latex three times when passes: 3', async () => {
    const { calls, run } = makeRecorder();
    await compile(makeTexPath(), { ...BASE_CONFIG, passes: 3 }, { run });
    assert.equal(calls.filter(c => c.cmd === 'latex').length, 3);
  });

  it('passes -recorder flag to pdflatex and latex', async () => {
    const { calls, run } = makeRecorder();
    await compile(makeTexPath(), BASE_CONFIG, { run });
    const latexCalls = calls.filter(c => c.cmd === 'pdflatex' || c.cmd === 'latex');
    assert.ok(latexCalls.every(c => c.args.includes('-recorder')));
  });

  it('passes -f/stem to tex4ht and t4ht', async () => {
    const { calls, run } = makeRecorder();
    await compile(makeTexPath(), BASE_CONFIG, { run });
    assert.ok(calls.find(c => c.cmd === 'tex4ht').args.includes('-f/stem'));
    assert.ok(calls.find(c => c.cmd === 't4ht').args.includes('-f/stem'));
  });

  it('does not pass modified TEXINPUTS to tex4ht or t4ht', async () => {
    const { calls, run } = makeRecorder();
    await compile(makeTexPath(), BASE_CONFIG, { run });
    const tex4htCall = calls.find(c => c.cmd === 'tex4ht');
    const t4htCall = calls.find(c => c.cmd === 't4ht');
    assert.ok(!tex4htCall.opts?.env?.TEXINPUTS);
    assert.ok(!t4htCall.opts?.env?.TEXINPUTS);
  });

  it('returns files listed in stem.lg', async () => {
    const { run } = makeRecorder();
    const files = await compile(makeTexPath(), BASE_CONFIG, { run });
    assert.ok(files.some(f => f.endsWith('stem.html')));
  });
});
