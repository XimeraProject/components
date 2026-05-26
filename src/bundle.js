import * as esbuild from 'esbuild';
import path from 'path';

// Pure: build the esbuild options object. Exported for testing.
export function makeBuildOptions(bundleEntry, outDir) {
  return {
    entryPoints: [bundleEntry],
    bundle: true,
    outdir: outDir,
    entryNames: 'ximera',   // produces ximera.js and ximera.css
    logLevel: 'warning',    // show warnings/errors, suppress info
  };
}

// Bundle .tex4npm/bundle-entry.js → outDir/ximera.js + outDir/ximera.css.
// Runs on every build invocation; esbuild is fast enough that skipping
// incremental checking is not worth the complexity.
export async function bundle(config) {
  const bundleEntry = path.join(config.tex4npmDir, 'bundle-entry.js');
  await esbuild.build(makeBuildOptions(bundleEntry, config.outDir));
}
