// ximera-core public API — the kernel entry.
//
// This module has NO side effects. Import it, register your things, then
// call boot(agent) explicitly. The `ximera-core` main entry (./index.js)
// is a thin wrapper that additionally imports @modulus-learning/agent and
// calls boot with a real agent. Tests import from here directly and
// supply a mock agent.
//
// Everything not exported below is kernel-internal (CONTRACT §14.6).

export { register } from './mounts.js';
export { registerReducer } from './update.js';
export { registerRender } from './render.js';
export { dispatch, boot } from './boot.js';
