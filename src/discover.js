import { readFile } from 'fs/promises';
import glob from 'fast-glob';

const COMMENT_RE = /%.*/g;
const ALWAYS_IGNORE = ['node_modules/**', '.tex4npm/**'];

function hasDocument(source) {
  return source.replace(COMMENT_RE, '').includes('\\begin{document}');
}

// Returns absolute paths of all eligible .tex files under root,
// sorted for a deterministic build order.
export async function discover(root, { exclude = [] } = {}) {
  const files = await glob('**/*.tex', {
    cwd: root,
    absolute: true,
    ignore: [...ALWAYS_IGNORE, ...exclude],
  });

  const results = await Promise.all(
    files.map(async f => {
      const source = await readFile(f, 'utf8');
      return hasDocument(source) ? f : null;
    })
  );

  return results.filter(Boolean).sort();
}
