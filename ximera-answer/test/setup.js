// Global happy-dom setup + stub MathJax.
//
// MathJax is treated as an environment resource, not a dependency: we stub
// the minimum surface ximera-answer's mount touches (startup.promise +
// typesetPromise) so the async two-phase mount can run to completion in the
// test process. We do NOT actually render the \cssId'd \phantom into a DOM
// element — instead, test fixtures pre-populate the placeholder span at the
// expected id, simulating what MathJax would produce.

import { Window } from 'happy-dom';

const w = new Window({
  url: 'http://localhost/',
  settings: { disableJavaScriptEvaluation: true },
});

globalThis.window = w;
globalThis.document = w.document;
globalThis.HTMLElement = w.HTMLElement;
globalThis.HTMLInputElement = w.HTMLInputElement;
globalThis.HTMLButtonElement = w.HTMLButtonElement;
globalThis.Element = w.Element;
globalThis.Node = w.Node;
globalThis.Event = w.Event;
globalThis.KeyboardEvent = w.KeyboardEvent;
globalThis.queueMicrotask = w.queueMicrotask?.bind(w) ?? queueMicrotask;

w.MathJax = {
  startup: { promise: Promise.resolve() },
  typesetPromise: async () => {},
};
