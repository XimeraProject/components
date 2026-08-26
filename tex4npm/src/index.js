// Public API for use as a library (not just a CLI).
export { compileBatch } from './cli.js';
export { loadConfig, resolveConfig } from './config.js';
export { discover } from './discover.js';
export { buildGraph, topoSort, propagateDirty } from './graph.js';
export { isDirty, hashFile } from './dirty.js';
export { parseFls, partitionOutputs, copyArtifacts, deleteTemps } from './artifacts.js';
export { postprocess } from './postprocess.js';
export {
  isXourseHtml,
  removeSpuriousAnchors,
  parseManifest,
  writeManifest,
  renderLandingPage,
  emitScopedCopies,
  rewriteRelativePaths,
  materialize,
} from './xourse.js';
export { stage } from './stage.js';
export { bundle } from './bundle.js';
export { watch } from './watch.js';
