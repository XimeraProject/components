// Deterministic seeded shuffle for ximera-multiple-choice and
// ximera-select-all. Legacy `original-server/shuffle.js` used non-
// deterministic `_.shuffle`, which meant a learner's saved answer id
// pointed at a different choice on reload — the exact bug PLAN.md §4
// calls out. This module fixes that: given a seed, the shuffle order is
// fully determined and reproducible across runtimes.

// Mulberry32: 32-bit PRNG with a small state and decent statistical
// properties. Uniform enough for shuffling choice lists (typically 3–6
// options); not cryptographic.
function mulberry32(seed) {
  let s = seed | 0;
  return function next() {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher–Yates in-place shuffle, seeded. Returns a new array; input is
// not mutated. Same (ids, seed) → same order on every runtime.
export function shuffleIds(ids, seed) {
  const rng = mulberry32(seed);
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Fresh uint32 seed. Uses crypto.getRandomValues where available (all
// modern browsers + Node 20+); falls back to Math.random for old runtimes.
export function generateSeed() {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0];
  }
  return Math.floor(Math.random() * 0x100000000);
}
