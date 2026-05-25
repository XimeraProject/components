import { readFile } from 'fs/promises';
import { createHash } from 'crypto';
import path from 'path';

export async function hashFile(filePath) {
  const content = await readFile(filePath);
  return createHash('sha1').update(content).digest('hex');
}

// Parse <meta name="dependency" content="HASH rel/path"> tags from HTML.
// Handles either attribute order.
export function parseDependencyMeta(html) {
  const metaRe = /<meta\b([^>]*)>/gi;
  const nameRe = /\bname="dependency"/i;
  const contentRe = /\bcontent="([^"]*)"/i;

  const deps = [];
  for (const meta of html.matchAll(metaRe)) {
    const attrs = meta[1];
    if (!nameRe.test(attrs)) continue;
    const contentMatch = contentRe.exec(attrs);
    if (!contentMatch) continue;
    const spaceIdx = contentMatch[1].indexOf(' ');
    if (spaceIdx === -1) continue;
    const hash = contentMatch[1].slice(0, spaceIdx);
    const relPath = contentMatch[1].slice(spaceIdx + 1);
    deps.push({ hash, relPath });
  }
  return deps;
}

// Returns true if the compiled HTML is missing or any dependency has changed.
export async function isDirty(htmlPath, projectRoot) {
  let html;
  try {
    html = await readFile(htmlPath, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return true;
    throw e;
  }

  const deps = parseDependencyMeta(html);
  if (deps.length === 0) return true;

  for (const { hash, relPath } of deps) {
    const absPath = path.resolve(projectRoot, relPath);
    let current;
    try {
      current = await hashFile(absPath);
    } catch (e) {
      if (e.code === 'ENOENT') return true;
      throw e;
    }
    if (current !== hash) return true;
  }

  return false;
}
