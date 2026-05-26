import chokidar from 'chokidar';
import path from 'path';
import { discover } from './discover.js';
import { depsOf } from './deps.js';
import { buildGraph, topoSort, propagateDirty } from './graph.js';
import { isDirty } from './dirty.js';
import { stage } from './stage.js';
import { bundle } from './bundle.js';

// Returns true for .tex files (outside .tex4npm/ and node_modules/)
// and for package.json files directly inside a node_modules package directory.
function isWatchable(filePath, root) {
  const rel = path.relative(root, filePath);
  if (rel.startsWith('.tex4npm')) return false;
  if (rel.endsWith('.tex') && !rel.startsWith('node_modules')) return true;
  if (/^node_modules[/\\](@[^/\\]+[/\\])?[^/\\]+[/\\]package\.json$/.test(rel)) return true;
  return false;
}

// Start watching and return a { close } handle.
// onBuild(files) is called with the list of .tex paths being compiled
// before each incremental build; onError(err) is called on failures.
export function watch(config, buildFn, { onBuild = () => {}, onError = console.error } = {}) {
  let running = false;
  let pending = false;

  async function run(changedPath) {
    if (running) { pending = true; return; }
    running = true;
    try {
      await runBuild(config, buildFn, changedPath, onBuild);
    } catch (err) {
      onError(err);
    } finally {
      running = false;
      if (pending) { pending = false; run(null); }
    }
  }

  // Chokidar v4 only fires change events when watching a directory directly,
  // not when given glob patterns. Watch root and filter in the event handler.
  const watcher = chokidar.watch(config.root, { ignoreInitial: false });

  let initialized = false;

  watcher.on('all', (event, filePath) => {
    if (!isWatchable(filePath, config.root)) return;
    if (initialized) run(filePath);
  });

  watcher.on('ready', () => {
    initialized = true;
    run(null);
  });

  return { close: () => watcher.close() };
}

async function runBuild(config, buildFn, changedPath, onBuild) {
  // Re-stage if a package.json changed (ximera packages may have been added/removed)
  if (!changedPath || changedPath.includes('node_modules')) {
    await stage(config);
    await bundle(config);
  }

  const texFiles = await discover(config.root, { exclude: config.exclude });
  const graph = await buildGraph(texFiles, depsOf);
  const order = topoSort(graph);

  // Determine initially dirty files via SHA1 metadata check
  const initialDirty = new Set(
    await Promise.all(
      texFiles.map(async f => {
        const htmlPath = toOutPath(f, config.root, config.outDir);
        return (await isDirty(htmlPath, config.root)) ? f : null;
      })
    ).then(results => results.filter(Boolean))
  );

  const dirty = propagateDirty(graph, initialDirty);
  const toCompile = order.filter(f => dirty.has(f));

  if (toCompile.length === 0) return;

  onBuild(toCompile);
  await buildFn(toCompile, config);
}

function toOutPath(texPath, root, outDir) {
  return path.join(outDir, path.relative(root, texPath).replace(/\.tex$/, '.html'));
}
