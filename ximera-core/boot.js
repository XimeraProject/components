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
      const saved = agent.pageState();
      if (saved && typeof saved === 'object' && Object.keys(saved).length > 0) {
        dispatch({ type: 'PAGE_STATE_RESTORED', pageState: saved });
      } else {
        dispatch({ type: 'AGENT_READY_OFFLINE' });
      }

      // Mount reset control BEFORE component mounts, so the button is
      // present even in fixtures that lack a mount point of their own.
      if (shouldMountReset) mountResetControl(confirmReset);

      // Run registered mounts. Each mount fn is called once per matching
      // element on the page.
      if (typeof document !== 'undefined') {
        for (const [selector, { mount }] of getMounts()) {
          document.querySelectorAll(selector).forEach(el => mount(el, dispatch));
        }
      }

      // Initial render pass across every DOM element matching a plugin
      // selector or a built-in class. Uses null previousModel so nothing
      // is ref-skipped — first render paints the whole page.
      render(model, null);

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
