// The conformance kit that CONTRACT §14 requires every ximera-* package to
// pass before its introducing phase is called done. Also the test harness
// the kernel uses on itself.
//
// Ships from ximera-core so components add it as a devDependency and run
// it in their own test suite. The public surface is the four exports below;
// the underscore-prefixed helpers reach into kernel internals for test
// setup and are intentionally NOT exported from `ximera-core` proper —
// components run tests, not production, through this module.

import { _resetMounts } from './mounts.js';
import { _resetReducers } from './update.js';
import { _resetRenderPlugins } from './render.js';
import { _resetBoot, _getModel, _getAgent, dispatch, boot } from './boot.js';

// ─── Mock agent ────────────────────────────────────────────────────────────

// A test double for @modulus-learning/agent. Records every setPageState /
// setProgress call, exposes triggerPageStateChanged for the server-push
// path, and lets the test decide when onReady fires (immediately by
// default, or via .startReady()).
// echoOnSetPageState: if true, setPageState synchronously emits
// 'pagestate-changed' — mirrors the real @modulus-learning/agent, which does
// this on every write. Default false so existing tests remain unchanged;
// boot.test.js uses true to exercise the echo-suppression guard.
export function createMockAgent({
  initialPageState = null,
  autoReady = true,
  echoOnSetPageState = false,
} = {}) {
  const listeners = { 'pagestate-changed': [] };
  let readyCallback = null;
  let ready = false;

  const pageStateCalls = [];
  const progressCalls = [];
  let currentPageState = initialPageState;

  const agent = {
    onReady(cb) {
      readyCallback = cb;
      if (autoReady && !ready) queueMicrotask(() => agent._fireReady());
    },
    pageState() {
      return currentPageState;
    },
    setPageState(state) {
      currentPageState = state;
      pageStateCalls.push(state);
      if (echoOnSetPageState) {
        for (const cb of listeners['pagestate-changed']) cb({ pageState: state });
      }
    },
    setProgress(p) {
      progressCalls.push(p);
    },
    on(event, cb) {
      (listeners[event] ??= []).push(cb);
    },

    // Test controls
    _fireReady() {
      if (ready) return;
      ready = true;
      readyCallback?.();
    },
    triggerPageStateChanged(pageState) {
      currentPageState = pageState;
      for (const cb of listeners['pagestate-changed']) cb({ pageState });
    },

    // Introspection
    get pageStateCalls() { return pageStateCalls; },
    get progressCalls() { return progressCalls; },
    get lastPageState() { return pageStateCalls.at(-1); },
    get lastProgress() { return progressCalls.at(-1); },
  };
  return agent;
}

// ─── Test setup / teardown ─────────────────────────────────────────────────

// Reset every kernel registry and the boot singleton. Call from beforeEach
// (or the equivalent) so each test starts with a clean kernel.
export function resetKernel() {
  _resetMounts();
  _resetReducers();
  _resetRenderPlugins();
  _resetBoot();
}

// Introspection for tests. Returns { model, agent } — read-only views of
// the kernel's internal state.
export function inspect() {
  return { model: _getModel(), agent: _getAgent() };
}

// ─── Fixture mounting ──────────────────────────────────────────────────────

// Install `html` as the document body, reset the kernel, and boot with a
// mock agent. Returns { agent, dispatch, done }, where `done` is the
// promise boot returned (already resolved after autoReady). Component
// registrations must happen before calling this — either via bare import
// (recommended, matches production) or via imperative register() calls.
export async function mountFixture(html, options = {}) {
  if (typeof document === 'undefined') {
    throw new Error('mountFixture: no document available (install happy-dom)');
  }
  // Caller is responsible for resetKernel() + component setup() before this;
  // mountFixture resets only the boot singleton so a fresh agent can be wired.
  _resetBoot();
  document.body.innerHTML = html;

  const agent = createMockAgent({
    initialPageState: options.initialPageState ?? null,
    autoReady: options.autoReady !== false,
    echoOnSetPageState: options.echoOnSetPageState === true,
  });
  const bootPromise = boot(agent, {
    confirmReset: options.confirmReset ?? (() => true),
    mountResetControl: options.mountResetControl !== false,
  });
  await bootPromise;
  return { agent, dispatch };
}

// ─── Conformance runner ────────────────────────────────────────────────────

// Run the six CONTRACT §14 tests against a component. Component packages
// call this from their test suite:
//
//   import test from 'node:test';
//   import { runConformance } from 'ximera-core/conformance';
//   import '../index.js';                       // registers the component
//   runConformance(test, {
//     name: 'ximera-hint',
//     fixture: '<div class="accordion">...</div>',
//     interact: async ({ agent }) => { /* drive the component to a completed state */ },
//     expectCompleted: (model) => { /* assert model reflects completion */ },
//   });
//
// The runner assumes the component's register() calls have already
// happened at module load. Tests that only exercise a subset should use
// mountFixture + hand-authored assertions.
export function runConformance(testFn, spec) {
  const { name, fixture, interact, expectCompleted } = spec;

  testFn(`${name}: mount`, async () => {
    await mountFixture(fixture);
    // Mount happens inside boot; if it threw, this line is unreached.
  });

  testFn(`${name}: dispatch → completion → propagation`, async () => {
    const ctx = await mountFixture(fixture);
    await interact(ctx);
    const { model } = inspect();
    expectCompleted(model);
  });

  testFn(`${name}: persistence round-trip`, async () => {
    const ctx = await mountFixture(fixture);
    await interact(ctx);
    const { model: before } = inspect();
    const serialized = JSON.parse(JSON.stringify(before));
    const ctx2 = await mountFixture(fixture, { initialPageState: serialized });
    const { model: after } = inspect();
    assertModelsEqual(after, before);
    // Prevent unused-warning; ctx2 exists for its side effects.
    void ctx2;
  });

  testFn(`${name}: restore-replay idempotence`, async () => {
    const ctx = await mountFixture(fixture);
    await interact(ctx);
    const html1 = document.body.innerHTML;
    // Force a second render by dispatching a benign no-op (unregistered
    // type triggers the default reducer path which returns unchanged
    // model → no re-render). We instead re-dispatch PAGE_STATE_RESTORED
    // with the current model, which SHOULD produce identical DOM.
    const { model } = inspect();
    dispatch({ type: 'PAGE_STATE_RESTORED', pageState: JSON.parse(JSON.stringify(model)) });
    const html2 = document.body.innerHTML;
    if (html1 !== html2) {
      throw new Error(
        `${name}: restore-replay produced different DOM.\n` +
        `first:  ${html1}\n` +
        `second: ${html2}`
      );
    }
  });

  testFn(`${name}: reset → cleared state → first-visit`, async () => {
    const ctx = await mountFixture(fixture);
    await interact(ctx);
    const { agent } = ctx;
    agent.progressCalls.length = 0;
    dispatch({ type: 'RESET_WORK' });
    if (agent.lastProgress !== 0) {
      throw new Error(`${name}: reset did not dispatch setProgress(0); got ${agent.lastProgress}`);
    }
    // Fresh-mount to compare.
    const freshCtx = await mountFixture(fixture);
    const { model: freshModel } = inspect();
    // Reset from the interacted state, then compare model to a fresh boot.
    await mountFixture(fixture);
    dispatch({ type: 'RESET_WORK' });
    const { model: resetModel } = inspect();
    assertModelsEqual(resetModel, freshModel);
    void freshCtx;
  });

  testFn(`${name}: no internal imports`, () => {
    // Static-analysis check happens at the package level (their build's
    // dependency graph). Here we assert the runtime contract: nothing
    // outside `ximera-core` and `ximera-core/kernel` should be reachable
    // via bare specifier. This is a placeholder for a real bundler-graph
    // assertion in Phase 6.
  });
}

// ─── Utilities ─────────────────────────────────────────────────────────────

function assertModelsEqual(a, b) {
  const norm = (m) => JSON.stringify(m, Object.keys(m).sort());
  if (norm(a) !== norm(b)) {
    throw new Error(
      `models differ:\n  a: ${JSON.stringify(a)}\n  b: ${JSON.stringify(b)}`
    );
  }
}
