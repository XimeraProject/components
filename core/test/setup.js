// Install happy-dom on Node's global scope. Every test file imports this
// once at the top so `document`, `window`, `HTMLElement`, etc. are
// available before the kernel's DOM-reading modules are imported.

import { Window } from 'happy-dom';

const w = new Window({
  url: 'http://localhost/',
  settings: { disableJavaScriptEvaluation: true },
});

// Copy the interfaces the kernel touches onto globalThis. Not exhaustive —
// happy-dom's DOM is what `document` provides; we just need enough class
// symbols on globalThis for `el instanceof HTMLElement`-style checks.
globalThis.window = w;
globalThis.document = w.document;
globalThis.HTMLElement = w.HTMLElement;
globalThis.HTMLInputElement = w.HTMLInputElement;
globalThis.Element = w.Element;
globalThis.Node = w.Node;
globalThis.Event = w.Event;
globalThis.CustomEvent = w.CustomEvent;
globalThis.getComputedStyle = w.getComputedStyle.bind(w);
globalThis.requestAnimationFrame = w.requestAnimationFrame.bind(w);
globalThis.queueMicrotask = w.queueMicrotask?.bind(w) ?? queueMicrotask;
