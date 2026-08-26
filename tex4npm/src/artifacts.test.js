import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFls, partitionOutputs, parseLg } from './artifacts.js';

const PROJECT_ROOT = '/home/jim/downloads';
const TEX4NPM_TEXMF = '/home/jim/downloads/.tex4npm/texmf';
const NIX_PFX = '/nix/store/sr1h6c1c7f1x4b2v7aya1m6fcxb8z07g-texlive-combined-full-2025-final-texmfdist';

const SAMPLE_FLS = `PWD /home/jim/downloads
INPUT ${NIX_PFX}/tex/latex/base/size12.clo
INPUT ${NIX_PFX}/tex/latex/base/size12.clo
INPUT ${NIX_PFX}/tex/latex/base/size12.clo
INPUT ${NIX_PFX}/tex/latex/geometry/geometry.sty
INPUT sample.tex
OUTPUT sample.log
INPUT ./sample.aux
INPUT ./sample.aux
INPUT sample.aux
OUTPUT sample.aux
OUTPUT sample.pdf
`;

describe('parseFls', () => {
  it('resolves PWD for relative INPUT paths', () => {
    const { inputs } = parseFls(SAMPLE_FLS, PROJECT_ROOT, TEX4NPM_TEXMF);
    assert.ok(inputs.includes('/home/jim/downloads/sample.tex'));
  });

  it('normalizes ./foo and foo to the same path', () => {
    const { inputs } = parseFls(SAMPLE_FLS, PROJECT_ROOT, TEX4NPM_TEXMF);
    const sampleAux = inputs.filter(p => p.endsWith('sample.aux'));
    assert.equal(sampleAux.length, 1);
  });

  it('deduplicates repeated INPUT lines', () => {
    const { inputs } = parseFls(SAMPLE_FLS, PROJECT_ROOT, TEX4NPM_TEXMF);
    const clo = inputs.filter(p => p.endsWith('size12.clo'));
    assert.equal(clo.length, 0, 'system file should be filtered out');
  });

  it('excludes system TeX paths', () => {
    const { inputs } = parseFls(SAMPLE_FLS, PROJECT_ROOT, TEX4NPM_TEXMF);
    assert.ok(inputs.every(p => !p.startsWith('/nix/')));
  });

  it('includes files under tex4npmTexmf', () => {
    const fls = `PWD /home/jim/downloads\nINPUT ${TEX4NPM_TEXMF}/tex/latex/macro.sty\n`;
    const { inputs } = parseFls(fls, PROJECT_ROOT, TEX4NPM_TEXMF);
    assert.ok(inputs.includes(`${TEX4NPM_TEXMF}/tex/latex/macro.sty`));
  });

  it('collects OUTPUT lines deduplicated', () => {
    const { outputs } = parseFls(SAMPLE_FLS, PROJECT_ROOT, TEX4NPM_TEXMF);
    assert.deepEqual(outputs.sort(), [
      '/home/jim/downloads/sample.aux',
      '/home/jim/downloads/sample.log',
      '/home/jim/downloads/sample.pdf',
    ]);
  });
});

describe('partitionOutputs', () => {
  it('sends .aux, .log, .pdf to temps', () => {
    const { temps, artifacts } = partitionOutputs([
      '/project/stem.aux',
      '/project/stem.log',
      '/project/stem.pdf',
      '/project/stem.html',
      '/project/stem-figure0.svg',
    ]);
    assert.deepEqual(temps.sort(), [
      '/project/stem.aux',
      '/project/stem.log',
      '/project/stem.pdf',
    ]);
    assert.deepEqual(artifacts.sort(), [
      '/project/stem-figure0.svg',
      '/project/stem.html',
    ]);
  });

  it('treats .html and .svg as artifacts', () => {
    const { artifacts } = partitionOutputs(['/p/a.html', '/p/b.svg', '/p/c.css']);
    assert.equal(artifacts.length, 3);
  });

  it('treats .xmjax and .xmcss as temps, not artifacts', () => {
    const { temps, artifacts } = partitionOutputs([
      '/project/stem.xmjax',
      '/project/stem.xmcss',
      '/project/stem.html',
    ]);
    assert.ok(temps.includes('/project/stem.xmjax'));
    assert.ok(temps.includes('/project/stem.xmcss'));
    assert.ok(artifacts.includes('/project/stem.html'));
  });
});

describe('parseLg', () => {
  const SAMPLE_LG = `File: sample.html
File: sample.tmp
Font_Css("4"): .small-caps{font-variant: small-caps; }
Font_Css("10"): .htf-cmbx {font-weight: bold; font-style:normal;}
--- characters ---
Font("cmr","10","10","100")
`;

  it('extracts File: entries', () => {
    const files = parseLg(SAMPLE_LG, '/src');
    assert.deepEqual(files, ['/src/sample.html', '/src/sample.tmp']);
  });

  it('ignores Font_Css, Font, and other lines', () => {
    const files = parseLg(SAMPLE_LG, '/src');
    assert.ok(files.every(f => f.endsWith('.html') || f.endsWith('.tmp')));
  });

  it('returns empty array when no File: lines exist', () => {
    assert.deepEqual(parseLg('Font_Css("4"): .foo {}\n', '/src'), []);
  });

  it('resolves filenames relative to dir', () => {
    const files = parseLg('File: out.html\n', '/my/dir');
    assert.deepEqual(files, ['/my/dir/out.html']);
  });
});
