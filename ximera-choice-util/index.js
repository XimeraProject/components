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

// ─── Shuffle ceremony ──────────────────────────────────────────────────────
//
// ximera-multiple-choice and ximera-select-all each had ~20 lines of
// identical setup: detect .shuffle opt-in, generate or restore a seed,
// dispatch a per-package SHUFFLE_INIT message, and permute .choice
// children in place. These helpers ship that pattern once — the pilot
// just calls initShuffleAtMount at mount time and registers the reducer
// via shuffleInitReducer.

// A reducer that idempotently records a shuffle seed at model[problemId].seed.
// Pilots register it under their own message type:
//
//   registerReducer(
//     'ximera-multiple-choice:SHUFFLE_INIT',
//     shuffleInitReducer('ximera-multiple-choice:SHUFFLE_INIT')
//   );
export function shuffleInitReducer() {
  return function reduceShuffleInit(model, msg) {
    const prev = model[msg.problemId] ?? {};
    if (prev.seed !== undefined) return model;
    return { ...model, [msg.problemId]: { ...prev, seed: msg.seed } };
  };
}

// Mount-time shuffle setup. If `container` opts into shuffling (own .shuffle
// class or an ancestor .shuffle), obtain a seed (persisted if the learner
// has one, freshly generated otherwise) and reorder .choice children in
// place. Returns { shuffled: boolean, seed: number|undefined }.
//
// Kept kernel-agnostic — the pilot passes `currentSeed` in explicitly
// rather than importing readModel. This keeps ximera-choice-util a peer
// of ximera-core, not a dependent.
//
// options:
//   currentSeed — the persisted seed on this entry, or undefined
//   dispatch    — the pilot's dispatch function
//   msgType     — the pilot's SHUFFLE_INIT message type
export function initShuffleAtMount(container, { currentSeed, dispatch, msgType } = {}) {
  if (!container?.classList) return { shuffled: false };
  const wants =
    container.classList.contains('shuffle') ||
    (typeof container.closest === 'function' && container.closest('.shuffle') !== null);
  if (!wants) return { shuffled: false };

  const seed = currentSeed ?? generateSeed();
  if (currentSeed === undefined && typeof dispatch === 'function' && msgType) {
    dispatch({ type: msgType, problemId: container.id, seed });
  }
  permuteChoicesInPlace(container, seed);
  return { shuffled: true, seed };
}

// Permute .choice[id] children of `container` according to seed. Idempotent-
// friendly: an already-shuffled DOM will re-shuffle to the same order given
// the same seed. Runs exactly once per mount by convention.
export function permuteChoicesInPlace(container, seed) {
  if (!container?.querySelectorAll) return;
  const choices = [...container.querySelectorAll('.choice')].filter((c) => c.id);
  if (choices.length <= 1) return;
  const originalOrder = choices.map((c) => c.id);
  const shuffledOrder = shuffleIds(originalOrder, seed);
  const parent = choices[0].parentNode;
  for (const id of shuffledOrder) {
    const c = choices.find((el) => el.id === id);
    if (c && c.parentNode === parent) parent.appendChild(c);
  }
}
