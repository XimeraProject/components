import { readFile } from 'fs/promises';
import path from 'path';

// Matches \input{foo}, \activity{foo}, \include{foo}, \includeonly{foo}
// with optional whitespace and an optional .tex extension in the argument.
const DEP_RE = /\\(?:input|activity|include|includeonly)\s*\{([^}]+)\}/g;
const COMMENT_RE = /%.*/g;

export function parseDeps(source) {
  const stripped = source.replace(COMMENT_RE, '');
  const deps = [];
  for (const match of stripped.matchAll(DEP_RE)) {
    let dep = match[1].trim();
    if (!dep.endsWith('.tex')) dep += '.tex';
    deps.push(dep);
  }
  return deps;
}

// Returns deps as paths relative to the same directory as texPath.
export async function depsOf(texPath) {
  const source = await readFile(texPath, 'utf8');
  const dir = path.dirname(texPath);
  return parseDeps(source).map(dep => path.join(dir, dep));
}
