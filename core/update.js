import { getEntry, setEntry, initialModel, modelFromPageState } from './model.js';
import { getAnswerableSelector } from './mounts.js';

// The three core-owned message types (CONTRACT §4). Component reducers cannot
// register for these; the kernel handles them directly.
const CORE_MESSAGES = new Set([
  'PAGE_STATE_RESTORED',
  'AGENT_READY_OFFLINE',
  'RESET_WORK',
]);

// ─── Reducer registry (D1) ─────────────────────────────────────────────────

const reducers = new Map(); // type -> reducer

export function registerReducer(type, reducer) {
  if (typeof type !== 'string' || !type) {
    throw new Error('registerReducer: type must be a non-empty string');
  }
  if (typeof reducer !== 'function') {
    throw new Error('registerReducer: reducer must be a function');
  }
  if (CORE_MESSAGES.has(type)) {
    throw new Error(`registerReducer: "${type}" is a core-owned message type`);
  }
  if (reducers.has(type)) {
    throw new Error(`registerReducer: reducer for "${type}" already registered`);
  }
  if (!type.includes(':') && isDev()) {
    console.warn(
      `ximera-core: reducer type "${type}" is not namespaced ` +
      `(expected "<package>:MESSAGE")`
    );
  }
  reducers.set(type, reducer);
}

// Test-only.
export function _resetReducers() {
  reducers.clear();
}

// ─── Core reducers ─────────────────────────────────────────────────────────

function coreReduce(model, msg) {
  switch (msg.type) {
    case 'PAGE_STATE_RESTORED': {
      const merged = { ...model, ...modelFromPageState(msg.pageState) };
      return initializeAvailability(merged);
    }
    case 'AGENT_READY_OFFLINE':
      return initializeAvailability(initialModel());
    case 'RESET_WORK':
      return initializeAvailability(initialModel());
    default: {
      const r = reducers.get(msg.type);
      if (!r) {
        if (isDev()) {
          console.warn(`ximera-core: no reducer for message type "${msg.type}"`);
        }
        return model;
      }
      return r(model, msg);
    }
  }
}

// ─── initializeAvailability ────────────────────────────────────────────────

// Walk .problem-environment[id] in the DOM and stamp the environment triple
// { available, complete, experienced } into the model.
//
// Rules (CONTRACT §9):
//   - top-level (no ancestor .problem-environment) → available: true
//   - non-blocking → available: true
//   - nested + blocking with no gating ancestor → available: true
//     (a "gating ancestor" is the nearest ancestor problem-environment
//     that has direct answerables; theorem-like wrappers and other pure
//     containers have none, so their blocking descendants are revealed
//     immediately — nothing at that level can be completed first)
//   - nested + blocking with a complete gating ancestor → available: true
//   - otherwise → available: false UNLESS the entry already has
//     available: true (persisted from a prior completion)
//
// Blocking is either the author-set data-blocking attribute OR computed
// at runtime from the answerable-selector union (D3): if the environment
// directly contains an answerable, it blocks. Runtime-computed blocking
// stamps the data-blocking attribute for CSS to react to.
//
// Newly-available environments are marked experienced. All existing entry
// keys are preserved (forward-tolerant per D6).
export function initializeAvailability(model) {
  if (typeof document === 'undefined') return model;

  let next = model;
  const answerableSelector = getAnswerableSelector();

  for (const el of document.querySelectorAll('.problem-environment')) {
    if (!el.id) continue;

    const isTopLevel = !el.parentElement?.closest('.problem-environment');
    let isBlocking = el.hasAttribute('data-blocking');
    if (!isBlocking && answerableSelector && hasDirectAnswerable(el, answerableSelector)) {
      isBlocking = true;
      el.setAttribute('data-blocking', '');
    }

    const gate = findGatingAncestor(el, answerableSelector);
    const gateOpen = !gate || getEntry(next, gate.id).complete === true;

    const existing = getEntry(next, el.id);
    const shouldBeAvailable =
      isTopLevel || !isBlocking || gateOpen || existing.available === true;

    const merged = {
      complete: false,
      experienced: false,
      ...existing,
      available: shouldBeAvailable,
    };
    if (merged.available && !merged.experienced) merged.experienced = true;

    next = { ...next, [el.id]: merged };
  }

  return next;
}

function hasDirectAnswerable(el, answerableSelector) {
  for (const m of el.querySelectorAll(answerableSelector)) {
    if (m.closest('.problem-environment') === el) return true;
  }
  return false;
}

// Walk up problem-environment ancestors, skipping ones with no direct
// answerables (theorem-like wrappers, containers, etc.). Return the
// nearest ancestor that could gate — the one whose completion actually
// controls reveal. Returns null when no gating ancestor exists.
function findGatingAncestor(el, answerableSelector) {
  if (!answerableSelector) return null;
  let cur = el.parentElement?.closest('.problem-environment');
  while (cur) {
    if (hasDirectAnswerable(cur, answerableSelector)) return cur;
    cur = cur.parentElement?.closest('.problem-environment');
  }
  return null;
}

// ─── propagateCorrectness ──────────────────────────────────────────────────

// Given a problem-environment id: if every direct answerable child has
// complete: true, mark the environment complete, uncover direct-child
// blockers, mark direct-child correct/attempt feedback visible, and
// recurse to the parent problem-environment.
export function propagateCorrectness(model, problemId) {
  if (typeof document === 'undefined') return model;
  const problemEl = document.getElementById(problemId);
  if (!problemEl) return model;

  const answerableSelector = getAnswerableSelector();
  const answerables = answerableSelector
    ? getDirectAnswerableIds(problemEl, answerableSelector)
    : [];
  const directChildProblems = getDirectChildProblemIds(problemEl);

  // Completion rules:
  //   - If this env has direct answerables: complete iff every one is complete.
  //   - Else if it has only nested problem-envs (a container): complete iff
  //     every direct-child problem is complete.
  //   - Else: nothing here can drive completion — bail.
  let allComplete;
  if (answerables.length > 0) {
    allComplete = answerables.every(id => getEntry(model, id).complete === true);
  } else if (directChildProblems.length > 0) {
    allComplete = directChildProblems.every(id => getEntry(model, id).complete === true);
  } else {
    return model;
  }
  if (!allComplete) return model;

  let next = model;
  if (!getEntry(next, problemId).complete) {
    next = setEntry(next, problemId, { complete: true });
  }

  // Reveal direct-child feedback (attempt and correct flavors). Feedback
  // for wrong-answer-only cases lives in markAttemptFeedback below.
  for (const fb of problemEl.querySelectorAll('.feedback[id]')) {
    if (fb.closest('.problem-environment') !== problemEl) continue;
    const type = fb.dataset.feedback;
    if (type === 'correct' || type === 'attempt' || !type) {
      if (!getEntry(next, fb.id).visible) {
        next = setEntry(next, fb.id, { visible: true });
      }
    }
  }

  // Uncover blocking descendants whose gating ancestor is this problem —
  // reaches through theorem-like/wrapper envs that have no answerables of
  // their own, so a completion here still opens the semantically-next
  // problem even when it's a grand-descendant.
  const answerableSelectorForBlockers = getAnswerableSelector();
  for (const child of problemEl.querySelectorAll('.problem-environment[data-blocking]')) {
    if (!child.id) continue;
    if (findGatingAncestor(child, answerableSelectorForBlockers) !== problemEl) continue;
    const childEntry = getEntry(next, child.id);
    if (!childEntry.available) {
      next = setEntry(next, child.id, { available: true, experienced: true });
    }
  }

  // Recurse to parent problem-environment.
  const parent = problemEl.parentElement?.closest('.problem-environment');
  if (parent?.id) next = propagateCorrectness(next, parent.id);

  return next;
}

// Reveal .feedback[data-feedback="attempt"] for an incorrect submission.
// Called by runReduce when it observes an answerable entry gain a `checked`
// key without becoming complete.
export function markAttemptFeedback(model, problemId) {
  if (typeof document === 'undefined') return model;
  const problemEl = document.getElementById(problemId);
  if (!problemEl) return model;

  let next = model;
  for (const fb of problemEl.querySelectorAll('.feedback[data-feedback="attempt"][id]')) {
    if (fb.closest('.problem-environment') !== problemEl) continue;
    if (!getEntry(next, fb.id).visible) {
      next = setEntry(next, fb.id, { visible: true });
    }
  }
  return next;
}

function getDirectAnswerableIds(problemEl, answerableSelector) {
  const ids = [];
  for (const el of problemEl.querySelectorAll(answerableSelector)) {
    if (el.closest('.problem-environment') === problemEl && el.id) {
      ids.push(el.id);
    }
  }
  return ids;
}

function getDirectChildProblemIds(problemEl) {
  const ids = [];
  for (const el of problemEl.querySelectorAll('.problem-environment')) {
    if (el.parentElement?.closest('.problem-environment') === problemEl && el.id) {
      ids.push(el.id);
    }
  }
  return ids;
}

// ─── runReduce: the dispatch loop's reducer step ───────────────────────────

// Calls the appropriate reducer, then does the D1 completion diff: for
// every answerable entry that transitioned complete: false → true, calls
// propagateCorrectness. For every answerable entry that gained a
// `checked` key without becoming complete, reveals attempt feedback.
export function runReduce(model, msg) {
  const before = model;
  const after = coreReduce(model, msg);
  if (after === before) return after;

  if (typeof document === 'undefined') return after;
  const answerableSelector = getAnswerableSelector();
  if (!answerableSelector) return after;

  let result = after;
  for (const id of Object.keys(after)) {
    const beforeEntry = before[id] ?? {};
    const afterEntry = after[id];
    if (!afterEntry) continue;

    const el = document.getElementById(id);
    if (!el || !el.matches(answerableSelector)) continue;

    const problemEl = el.closest('.problem-environment');
    if (!problemEl?.id) continue;

    // Newly complete → propagate.
    if (beforeEntry.complete !== true && afterEntry.complete === true) {
      result = propagateCorrectness(result, problemEl.id);
      continue;
    }
    // Newly checked (attempted) without becoming complete → attempt feedback.
    const wasChecked = beforeEntry.checked !== undefined;
    const isChecked = afterEntry.checked !== undefined;
    if (!wasChecked && isChecked && afterEntry.complete !== true) {
      result = markAttemptFeedback(result, problemEl.id);
    }
  }
  return result;
}

function isDev() {
  return typeof process === 'undefined' || process.env?.NODE_ENV !== 'production';
}
