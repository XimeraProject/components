import { execa } from 'execa';
import path from 'path';

const TEX_CONFIG = 'ximera,charset=utf-8,-css';
const TEX4HT_OPTIONS = ['-cunihtf', '-utf8'];
const LATEX_FLAGS = [
  '-recorder',
  '-interaction=nonstopmode',
  '-shell-escape',
  '-file-line-error',
];

// The tex4ht.sty injection preamble extracted verbatim from the htlatex script.
// When passed as the sole argument to latex, it loads tex4ht.sty with the
// ximera configuration via \@documentclasshook before \begin{document}.
const TEX4HT_PREAMBLE =
  '\\makeatletter\\def\\HCode{\\futurelet\\HCode\\HChar}' +
  '\\def\\HChar{\\ifx"\\HCode\\def\\HCode"##1"{\\Link##1}\\expandafter\\HCode\\else\\expandafter\\Link\\fi}' +
  '\\def\\Link#1.a.b.c.{\\g@addto@macro\\@documentclasshook{\\RequirePackage[#1,html]{tex4ht}}' +
  '\\let\\HCode\\documentstyle\\def\\documentstyle{\\let\\documentstyle\\HCode\\expandafter' +
  '\\def\\csname tex4ht\\endcsname{#1,html}\\def\\HCode####1{\\documentstyle[tex4ht,}' +
  '\\@ifnextchar[{\\HCode}{\\documentstyle[tex4ht]}}}\\makeatother\\HCode ';

// Build the single latex argument that injects tex4ht.sty and inputs the file.
export function tex4htArg(stem) {
  return `${TEX4HT_PREAMBLE}${TEX_CONFIG}.a.b.c.\\input ${stem}`;
}

// Build the TEXINPUTS value that prepends the staged .sty files.
export function makeTexInputs(tex4npmTexmf) {
  const existing = process.env.TEXINPUTS ?? '';
  return `${tex4npmTexmf}//:${existing}`;
}

// Parse the file list from tex4ht's stdout.
// tex4ht prints lines like "file sample.html" and "file sample.tmp"
// inside [...] blocks for each page — these are the files it wrote.
export function parseTex4htStdout(stdout, dir) {
  const files = [];
  for (const line of stdout.split('\n')) {
    // Lines take two forms: "[1 file name.html" and " file name.tmp"
    const m = line.match(/\bfile\s+(\S+)/);
    if (m) files.push(path.join(dir, m[1]));
  }
  return files;
}

// Compile a single .tex file through the full pipeline:
//   pdflatex → latex×passes → tex4ht → t4ht
//
// Returns the list of files tex4ht wrote to the source directory.
//
// run: injectable subprocess executor (defaults to execa). Tests pass a
// recording fake to verify the call sequence without spawning real processes.
export async function compile(texPath, config, { run = execa } = {}) {
  const dir = path.dirname(texPath);
  const stem = path.basename(texPath, '.tex');

  // Only latex/pdflatex need the augmented TEXINPUTS to find staged .sty files.
  // tex4ht and t4ht use their own search paths and must not get a modified env.
  const latexEnv = { ...process.env, TEXINPUTS: makeTexInputs(config.tex4npmTexmf) };
  const latexOpts = { cwd: dir, env: latexEnv };
  const tex4htOpts = { cwd: dir };

  const pdflatexArg =
    `\\PassOptionsToClass{tikzexport}{ximera}` +
    `\\PassOptionsToClass{xake}{ximera}` +
    `\\PassOptionsToClass{xake}{xourse}` +
    `\\nonstopmode\\input{${stem}}`;

  // pdflatex pass: tikzexport + .aux generation
  await run('pdflatex', [...LATEX_FLAGS, pdflatexArg], latexOpts);

  // latex passes with tex4ht.sty injection (2 or 3, per config.passes)
  for (let i = 0; i < config.passes; i++) {
    await run('latex', [...LATEX_FLAGS, tex4htArg(stem)], latexOpts);
  }

  // tex4ht: DVI → HTML. Stdout lists the files it produced.
  const { stdout } = await run('tex4ht', [`-f/${stem}`, ...TEX4HT_OPTIONS], tex4htOpts);
  const tex4htFiles = parseTex4htStdout(stdout ?? '', dir);

  // t4ht: post-processing (.lg → CSS, images, etc.)
  await run('t4ht', [`-f/${stem}`], tex4htOpts);

  return tex4htFiles;
}

