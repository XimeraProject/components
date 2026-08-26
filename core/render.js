// Generic projection: model entry → data-state attribute + optional plugin.
//
// Kernel projects only the two element classes it owns:
//   .problem-environment → "available? complete? experienced?"
//   .feedback            → "visible" | "hidden"
//
// Every other class is component territory: components register renderers
// via registerRender(selector, fn) and project their own data-state
// vocabulary. Renderers MUST be pure projections (CONTRACT §8 rule 1).
//
// This module also exports focusGuardSyncValue, a helper renderers can
// use to sync native form-input values without stealing the caret while
// the learner is typing (CONTRACT §8 rule 4).

// ─── Render plugin registry ────────────────────────────────────────────────

const plugins = []; // [{ selector, render }]

export function registerRender(selector, render) {
  if (typeof selector !== 'string' || !selector) {
    throw new Error('registerRender: selector must be a non-empty string');
  }
  if (typeof render !== 'function') {
    throw new Error('registerRender: render must be a function');
  }
  plugins.push({ selector, render });
}

// Test-only.
export function _resetRenderPlugins() {
  plugins.length = 0;
}

// ─── Main render pass ──────────────────────────────────────────────────────

// Iterate every DOM element that matches a built-in class or a registered
// plugin selector. For each element with an id, project `model[id] ?? {}`
// via the built-in projection and any matching plugin. Skip elements whose
// entry reference hasn't changed since `previousModel` — that's how
// reducer immutability translates to render efficiency.
//
// Iterating by DOM (not by model keys) makes render correct for two edges:
//   1. Elements present at mount but with no model entry yet (fresh visit,
//      before any dispatch) — plugins still project their empty-state DOM.
//   2. Entries removed by RESET_WORK — the DOM element for a cleared id
//      still needs to be re-projected to its empty-state visuals.
export function render(model, previousModel = null) {
  if (typeof document === 'undefined') return;

  const rendered = new Set();

  // Built-in projections for .problem-environment and .feedback.
  for (const el of document.querySelectorAll('.problem-environment[id], .feedback[id]')) {
    if (shouldSkip(model, previousModel, el.id)) continue;
    projectBuiltIn(el, model[el.id] ?? {});
    rendered.add(el.id);
  }

  // Plugin projections.
  for (const { selector, render: fn } of plugins) {
    for (const el of document.querySelectorAll(selector)) {
      if (!el.id) continue;
      if (shouldSkip(model, previousModel, el.id)) continue;
      if (!rendered.has(el.id)) {
        projectBuiltIn(el, model[el.id] ?? {});
        rendered.add(el.id);
      }
      fn(el, model[el.id] ?? {}, model);
    }
  }
}

function shouldSkip(model, previousModel, id) {
  if (previousModel === null) return false;              // initial render
  return model[id] === previousModel[id];                // ref-equal → skip
}

function projectBuiltIn(el, entry) {
  if (el.classList.contains('problem-environment')) {
    const parts = [];
    parts.push(entry.available ? 'available' : 'unavailable');
    if (entry.complete) parts.push('complete');
    if (entry.experienced) parts.push('experienced');
    el.dataset.state = parts.join(' ');
    return;
  }
  if (el.classList.contains('feedback')) {
    el.dataset.state = entry.visible ? 'visible' : 'hidden';
    return;
  }
}

// ─── Focus-guarded form-value sync ─────────────────────────────────────────

// Set el.value = value ONLY IF the element is not currently focused. Prevents
// caret jump when a server-side pagestate-changed arrives while the learner
// is mid-typing. Renderers of native form controls SHOULD wrap value syncs
// in this helper (or its equivalent inline check).
export function focusGuardSyncValue(el, value) {
  if (!el) return;
  if (document.activeElement === el) return;
  const target = value ?? '';
  if (el.value !== target) el.value = target;
}
