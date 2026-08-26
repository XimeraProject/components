import { Window } from 'happy-dom';

const w = new Window({
  url: 'http://localhost/',
  settings: { disableJavaScriptEvaluation: true },
});

globalThis.window = w;
globalThis.document = w.document;
globalThis.HTMLElement = w.HTMLElement;
globalThis.HTMLButtonElement = w.HTMLButtonElement;
globalThis.Element = w.Element;
globalThis.Node = w.Node;
globalThis.Event = w.Event;
globalThis.KeyboardEvent = w.KeyboardEvent;
globalThis.queueMicrotask = w.queueMicrotask?.bind(w) ?? queueMicrotask;
