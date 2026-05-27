import * as esbuild from 'esbuild';
import path from 'path';

// Pure: build the esbuild options object. Exported for testing.
// nodePaths: extra directories esbuild searches for bare imports, appended
// after the standard node_modules walk. Pass the project's node_modules so
// that packages like my-button (resolved from their own directory) can still
// import shared packages like ximera-core that live in the project root.
export function makeBuildOptions(bundleEntry, outDir, nodePaths = []) {
  return {
    entryPoints: [bundleEntry],
    bundle: true,
    outdir: outDir,
    entryNames: 'ximera',   // produces ximera.js and ximera.css
    logLevel: 'warning',    // show warnings/errors, suppress info
    nodePaths,
  };
}

// Bundle .tex4npm/bundle-entry.js → outDir/ximera.js + outDir/ximera.css.
// Runs on every build invocation; esbuild is fast enough that skipping
// incremental checking is not worth the complexity.
export async function bundle(config) {
  const bundleEntry = path.join(config.tex4npmDir, 'bundle-entry.js');
  const nodeModulesDir = path.join(config.configDir, 'node_modules');
  await esbuild.build(makeBuildOptions(bundleEntry, config.outDir, [nodeModulesDir]));
}
