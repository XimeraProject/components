import { Command } from 'commander';
import { rm } from 'fs/promises';
import { existsSync } from 'fs';
import PQueue from 'p-queue';
import path from 'path';
import { loadConfig } from './config.js';
import { discover } from './discover.js';
import { depsOf } from './deps.js';
import { buildGraph, topoSort, propagateDirty } from './graph.js';
import { isDirty } from './dirty.js';
import { stage } from './stage.js';
import { bundle } from './bundle.js';
import { compile } from './compile.js';
import { parseFlsFile, partitionOutputs, copyArtifacts, deleteTemps } from './artifacts.js';
import { postprocess } from './postprocess.js';
import { watch } from './watch.js';

function toOutPath(texPath, root, outDir) {
  return path.join(outDir, path.relative(root, texPath).replace(/\.tex$/, '.html'));
}

// Compile one file: throttle only the execa subprocess calls through the queue;
// artifact copy and HTML post-processing run immediately after, outside the queue.
async function compileFile(texPath, config, queue) {
  // tex4htFiles: files written by the tex4ht binary (html, tmp, etc.)
  const tex4htFiles = await queue.add(() => compile(texPath, config));

  const dir = path.dirname(texPath);
  const stem = path.basename(texPath, '.tex');

  // .fls covers inputs (for dependency metadata) and latex-side outputs (temps).
  const { inputs, outputs } = await parseFlsFile(
    path.join(dir, `${stem}.fls`),
    config.root,
    config.tex4npmTexmf
  );
  const { artifacts: flsArtifacts, temps } = partitionOutputs(outputs);

  // tex4ht artifacts (html, svg, png, css…) come from compile()'s return value,
  // not from .fls — tex4ht doesn't use -recorder.
  const { artifacts: tex4htArtifacts, temps: tex4htTemps } =
    partitionOutputs(tex4htFiles ?? []);

  await copyArtifacts([...flsArtifacts, ...tex4htArtifacts], config.root, config.outDir);

  const htmlOut = toOutPath(texPath, config.root, config.outDir);
  if (existsSync(htmlOut)) {
    await postprocess(htmlOut, inputs, config.root, config.outDir, {
      xmjaxPath: path.join(dir, `${stem}.xmjax`),
      xmcssPath: path.join(dir, `${stem}.xmcss`),
    });
  }

  await deleteTemps([...temps, ...tex4htTemps]);
}

// Compile a batch of .tex files with concurrency capped at config.workers.
// Errors are collected and returned; compilation of other files continues.
// Used by both `build` and `watch`.
export async function compileBatch(texFiles, config) {
  const queue = new PQueue({ concurrency: config.workers });
  const errors = [];

  await Promise.all(texFiles.map(async texPath => {
    try {
      await compileFile(texPath, config, queue);
      console.log(`  ✓ ${path.relative(config.root, texPath)}`);
    } catch (err) {
      errors.push({ file: texPath, err });
      console.error(`  ✗ ${path.relative(config.root, texPath)}: ${err.message}`);
    }
  }));

  return errors;
}

async function runBuild(config) {
  await stage(config);
  await bundle(config);

  const texFiles = await discover(config.root, { exclude: config.exclude });
  const graph = await buildGraph(texFiles, depsOf);
  const order = topoSort(graph);

  const initialDirty = new Set(
    (await Promise.all(
      texFiles.map(async f => {
        const htmlPath = toOutPath(f, config.root, config.outDir);
        return (await isDirty(htmlPath, config.root)) ? f : null;
      })
    )).filter(Boolean)
  );

  const dirty = propagateDirty(graph, initialDirty);
  const toCompile = order.filter(f => dirty.has(f));

  if (toCompile.length === 0) {
    console.log('Nothing to compile.');
    return;
  }

  console.log(`Compiling ${toCompile.length} file(s)...`);
  const errors = await compileBatch(toCompile, config);
  if (errors.length > 0) process.exit(1);
}

export const program = new Command();

program
  .name('tex4npm')
  .description('Build tool for Ximera LaTeX files')
  .version('0.1.0');

program
  .command('build')
  .description('Compile all dirty .tex files to HTML')
  .action(async () => {
    try {
      const config = await loadConfig();
      await runBuild(config);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command('watch')
  .description('Watch for changes and rebuild incrementally')
  .action(async () => {
    try {
      const config = await loadConfig();
      console.log(`Watching ${config.root}...`);
      const handle = watch(config, compileBatch, {
        onBuild: files => console.log(`\nRebuilding ${files.length} file(s)...`),
        onError: err => console.error(err.message),
      });
      process.on('SIGINT', async () => { await handle.close(); process.exit(0); });
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command('clean')
  .description('Remove outDir and .tex4npm staging directory')
  .action(async () => {
    try {
      const config = await loadConfig();
      await rm(config.outDir, { recursive: true, force: true });
      await rm(config.tex4npmDir, { recursive: true, force: true });
      console.log('Cleaned.');
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  });
