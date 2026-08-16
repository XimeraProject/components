import { initialModel, modelToPageState } from './model.js';
import { runReduce } from './update.js';
import { render } from './render.js';
import { calculateProgress } from './progress.js';
import { getMounts } from './mounts.js';

// The kernel's single model instance. Every dispatch reads-and-replaces this
// via runReduce. All updates flow through dispatch(), so this variable is
// the single source of truth.
let model = initialModel();
let agentRef = null;
let bootedOnce = false;

// readModel: read-only snapshot of the current model. Consumers MUST NOT
// mutate; JavaScript can't enforce it, so treat the returned object as
// frozen. Useful in mount functions that need to consult persisted state
// (e.g. reading a shuffle seed that survived a reload) before dispatching.
export function readModel() {
  return model;
}

// dispatch: the only way to change the model. Runs the reducer, re-renders
// changed entries, persists via the agent.
export function dispatch(msg) {
  const before = model;
  model = runReduce(model, msg);
  if (model === before) return;    // no-op reduce → no render, no persist
  render(model, before);
  if (agentRef) {
    agentRef.setPageState(modelToPageState(model));
    agentRef.setProgress(calculateProgress(model));
  }
}

// boot(agent, options?): wire up the kernel to a Modulus agent (or a mock).
// Idempotent-guarded: calling twice throws so tests can't accidentally
// double-boot.
//
// options:
//   confirmReset: (msg) => boolean  — override the built-in confirmation dialog
//                                     (default uses window.confirm)
//   mountResetControl: boolean       — set false to skip reset-button chrome
//                                     (default true)
export async function boot(agent, options = {}) {
  if (bootedOnce) {
    throw new Error('ximera-core: boot() called twice');
  }
  bootedOnce = true;
  agentRef = agent;

  const confirmReset =
    options.confirmReset ??
    ((msg) => (typeof window !== 'undefined' ? window.confirm(msg) : true));
  const shouldMountReset = options.mountResetControl !== false;

  await new Promise((resolve) => {
    agent.onReady(() => {
      // Boot sequence: reduce → mount → render → persist.
      //
      // Reducing before mounting means the model reflects the initial
      // state before any mount function reads it. Mounting before
      // rendering means every attribute the mount adds is in place
      // before the first render sets its dependent attributes — this
      // is what makes DOM byte-identical on first-visit and reload
      // (attribute insertion order is deterministic across paths).

      const saved = agent.pageState();
      const initialMsg =
        saved && typeof saved === 'object' && Object.keys(saved).length > 0
          ? { type: 'PAGE_STATE_RESTORED', pageState: saved }
          : { type: 'AGENT_READY_OFFLINE' };
      model = runReduce(model, initialMsg);

      if (shouldMountReset) mountResetControl(confirmReset);
      if (typeof document !== 'undefined') {
        for (const [selector, { mount }] of getMounts()) {
          document.querySelectorAll(selector).forEach(el => mount(el, dispatch));
        }
      }

      // One render pass across every matched element. Null previousModel
      // means nothing is ref-skipped.
      render(model, null);

      // Persist the initial state so an offline/first-visit page still
      // reports its baseline progress.
      agent.setPageState(modelToPageState(model));
      agent.setProgress(calculateProgress(model));

      resolve();
    });
  });

  // Server-pushed state updates re-enter the dispatch loop.
  agent.on('pagestate-changed', ({ pageState }) => {
    dispatch({ type: 'PAGE_STATE_RESTORED', pageState });
  });
}

// ─── Reset control chrome ──────────────────────────────────────────────────

// Insert a reset button into #ximera-page-controls (creating the container
// if absent). Idempotent by marker class (D7).
function mountResetControl(confirmReset) {
  if (typeof document === 'undefined') return;

  let controls = document.getElementById('ximera-page-controls');
  if (!controls) {
    controls = document.createElement('div');
    controls.id = 'ximera-page-controls';
    const firstProblem = document.querySelector('.problem-environment');
    if (firstProblem?.parentNode) {
      firstProblem.parentNode.insertBefore(controls, firstProblem);
    } else {
      document.body?.appendChild(controls);
    }
  }

  if (controls.querySelector('.ximera-reset-btn')) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ximera-reset-btn';
  btn.textContent = 'Reset work';
  btn.setAttribute('aria-label', 'reset work on this page');
  btn.addEventListener('click', () => {
    const ok = confirmReset(
      'This clears your work on this page. Your grade cannot go down — ' +
      'resetting starts fresh but does not lower a score you have already earned.'
    );
    if (ok) dispatch({ type: 'RESET_WORK' });
  });
  controls.appendChild(btn);
}

// ─── Test-only ─────────────────────────────────────────────────────────────

// Reset kernel singleton state between test cases. Not part of the public
// contract — reachable only via ximera-core/conformance.
export function _resetBoot() {
  model = initialModel();
  agentRef = null;
  bootedOnce = false;
}

export function _getModel() {
  return model;
}

export function _getAgent() {
  return agentRef;
}
