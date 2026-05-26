// Build a DAG from compilable .tex files and compute compilation order.
//
// Edge direction convention: if A has \input{B}, then A depends on B.
//   deps.get(A)        = [B, ...]   — what A needs before it can compile
//   dependents.get(B)  = [A, ...]   — what must recompile if B changes

// depsOfFn: (filePath: string) => Promise<string[]>
// Returns only paths that are in the texFiles set (non-compilable shared
// macro files are excluded — their changes are caught by .fls dirty checking).
export async function buildGraph(texFiles, depsOfFn) {
  const fileSet = new Set(texFiles);
  const deps = new Map();
  const dependents = new Map();

  for (const f of texFiles) {
    deps.set(f, []);
    dependents.set(f, []);
  }

  for (const f of texFiles) {
    for (const dep of await depsOfFn(f)) {
      if (fileSet.has(dep)) {
        deps.get(f).push(dep);
        dependents.get(dep).push(f);
      }
    }
  }

  return { deps, dependents };
}

// Returns files in compilation order (dependencies before dependents).
// Throws if a cycle is detected, naming the files involved.
export function topoSort({ deps, dependents }) {
  const inDegree = new Map([...deps.keys()].map(f => [f, 0]));
  for (const [f, fileDeps] of deps) {
    inDegree.set(f, fileDeps.length);
  }

  const queue = [...inDegree.entries()]
    .filter(([, d]) => d === 0)
    .map(([f]) => f);
  const order = [];

  while (queue.length > 0) {
    const node = queue.shift();
    order.push(node);
    for (const dependent of dependents.get(node)) {
      const d = inDegree.get(dependent) - 1;
      inDegree.set(dependent, d);
      if (d === 0) queue.push(dependent);
    }
  }

  if (order.length !== deps.size) {
    const inCycle = [...deps.keys()].filter(f => !order.includes(f));
    throw new Error(
      `Circular \\input dependency detected among:\n  ${inCycle.join('\n  ')}`
    );
  }

  return order;
}

// Propagates dirtiness forward through dependents.
// Returns a new Set containing initialDirty plus all transitive dependents.
export function propagateDirty({ dependents }, initialDirty) {
  const dirty = new Set(initialDirty);
  const queue = [...initialDirty];

  while (queue.length > 0) {
    const node = queue.shift();
    for (const dependent of (dependents.get(node) ?? [])) {
      if (!dirty.has(dependent)) {
        dirty.add(dependent);
        queue.push(dependent);
      }
    }
  }

  return dirty;
}
