// ximera-core production entry.
//
// Imports the kernel, then imports the real Modulus agent, then auto-boots.
// The tex4npm-generated bundle imports this file; other packages register
// their mounts/reducers/renders (via `ximera-core/kernel`) at module load,
// and by the time boot()'s onReady fires, the registrations are in place.
//
// Tests bypass this file and import from `ximera-core/kernel` +
// `ximera-core/conformance` instead — see CONTRACT §2.

import { boot } from './kernel.js';
import { ModulusAgent } from '@modulus-learning/agent';

export * from './kernel.js';

// Fire boot on module load. `boot` awaits agent.onReady internally, so
// this doesn't block the module resolution graph.
boot(new ModulusAgent());
