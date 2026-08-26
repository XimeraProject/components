import { readFile, unlink, copyFile, mkdir } from 'fs/promises';
import path from 'path';

const TEMP_EXTENSIONS = new Set([
  '.aux', '.4ct', '.4tc', '.oc', '.md5', '.dpth', '.out', '.jax',
  '.idv', '.lg', '.tmp', '.xref', '.log', '.auxlock', '.dvi', '.pdf',
  '.scmd', '.sout', '.fls', '.xmjax', '.xmcss',
]);

// Parse a .fls file produced by latex -recorder.
// Returns inputs filtered to project-owned files, and all outputs deduplicated.
export function parseFls(content, projectRoot, tex4npmTexmf) {
  let pwd = '';
  const inputs = new Set();
  const outputs = new Set();

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('PWD ')) {
      pwd = line.slice(4).trim();
    } else if (line.startsWith('INPUT ')) {
      const p = resolvePath(line.slice(6).trim(), pwd);
      if (p && isOwned(p, projectRoot, tex4npmTexmf)) inputs.add(p);
    } else if (line.startsWith('OUTPUT ')) {
      const p = resolvePath(line.slice(7).trim(), pwd);
      if (p) outputs.add(p);
    }
  }

  return { inputs: [...inputs], outputs: [...outputs] };
}

// Split output list into artifacts (copy to outDir) and temps (delete).
export function partitionOutputs(outputs) {
  const artifacts = [];
  const temps = [];
  for (const p of outputs) {
    (TEMP_EXTENSIONS.has(path.extname(p)) ? temps : artifacts).push(p);
  }
  return { artifacts, temps };
}

// Copy each artifact into outDir, mirroring the path relative to projectRoot.
export async function copyArtifacts(artifacts, projectRoot, outDir) {
  for (const src of artifacts) {
    const rel = path.relative(projectRoot, src);
    const dest = path.join(outDir, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
  }
}

// Delete temp files. Missing files are silently ignored (idempotent).
export async function deleteTemps(temps) {
  await Promise.all(temps.map(p => unlink(p).catch(e => {
    if (e.code !== 'ENOENT') throw e;
  })));
}

// Parse a .lg file written by tex4ht.
// "File: name" lines list every file tex4ht produced.
// Other lines (Font_Css, Font, --- characters ---, etc.) are metadata for t4ht
// and are ignored for artifact collection.
export function parseLg(content, dir) {
  const files = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^File:\s*(\S+)/);
    if (m) files.push(path.join(dir, m[1]));
  }
  return files;
}

export async function parseLgFile(lgPath, dir) {
  const content = await readFile(lgPath, 'utf8');
  return parseLg(content, dir);
}

export async function parseFlsFile(flsPath, projectRoot, tex4npmTexmf) {
  const content = await readFile(flsPath, 'utf8');
  return parseFls(content, projectRoot, tex4npmTexmf);
}

function resolvePath(p, pwd) {
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.resolve(pwd, p);
}

function isOwned(p, projectRoot, tex4npmTexmf) {
  return p.startsWith(projectRoot + path.sep) || p.startsWith(tex4npmTexmf + path.sep);
}
