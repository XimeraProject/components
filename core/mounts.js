// The mount registry. `register(selector, mount, { answerable })` adds one
// entry; boot() iterates all entries and calls each mount(el, dispatch)
// for every element matching its selector.
//
// The answerable-selector union is also derived from this registry — it's
// what update.js's initializeAvailability and propagateCorrectness use to
// find answerable descendants of a problem-environment (D2, D3).

const mounts = new Map(); // selector -> { mount, answerable }

export function register(selector, mount, opts = {}) {
  if (typeof selector !== 'string' || !selector) {
    throw new Error('register: selector must be a non-empty string');
  }
  if (typeof mount !== 'function') {
    throw new Error('register: mount must be a function');
  }
  if (mounts.has(selector)) {
    if (isDev()) {
      console.warn(`ximera-core: mount for selector "${selector}" is being overwritten`);
    }
  }
  mounts.set(selector, { mount, answerable: !!opts.answerable });
}

export function getMounts() {
  return mounts;
}

// Union of all selectors whose mount opted in as { answerable: true }.
// Suitable for direct use in element.querySelectorAll(...) — a comma-joined
// list. Returns '' when nothing is registered (falsy: callers guard on it).
export function getAnswerableSelector() {
  const sels = [];
  for (const [sel, entry] of mounts) {
    if (entry.answerable) sels.push(sel);
  }
  return sels.join(', ');
}

// Test-only: reset the registry between test cases.
export function _resetMounts() {
  mounts.clear();
}

function isDev() {
  return typeof process === 'undefined' || process.env?.NODE_ENV !== 'production';
}
