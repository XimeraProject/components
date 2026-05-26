import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { access } from 'fs/promises';
import os from 'os';
import path from 'path';

const DEFAULTS = {
  root: '.',
  outDir: 'dist',
  workers: Math.max(1, Math.floor(os.cpus().length / 2)),
  passes: 2,
  clean: true,
  exclude: [],
};

// Pure: merge user config with defaults, resolve paths to absolute,
// and compute derived paths. configDir is the directory of the config file.
export function resolveConfig(userConfig = {}, configDir = process.cwd()) {
  const merged = { ...DEFAULTS, ...userConfig };

  validate(merged);

  const root = path.resolve(configDir, merged.root);
  const outDir = path.resolve(configDir, merged.outDir);
  const tex4npmDir = path.join(root, '.tex4npm');

  return {
    root,
    outDir,
    tex4npmDir,
    tex4npmTexmf: path.join(tex4npmDir, 'texmf'),
    workers: merged.workers,
    passes: merged.passes,
    clean: merged.clean,
    exclude: merged.exclude,
  };
}

// Load tex4npm.config.js from cwd, falling back to all defaults if absent.
export async function loadConfig(cwd = process.cwd()) {
  const configPath = path.join(cwd, 'tex4npm.config.js');

  try {
    await access(configPath);
  } catch {
    return resolveConfig({}, cwd);
  }

  const mod = await import(pathToFileURL(configPath).href);
  const userConfig = mod.default ?? mod;
  return resolveConfig(userConfig, cwd);
}

function validate({ workers, passes, exclude }) {
  if (!Number.isInteger(workers) || workers < 1)
    throw new Error(`config.workers must be a positive integer (got ${workers})`);

  if (passes !== 2 && passes !== 3)
    throw new Error(`config.passes must be 2 or 3 (got ${passes})`);

  if (!Array.isArray(exclude))
    throw new Error(`config.exclude must be an array (got ${typeof exclude})`);
}
