# Integration suite

End-to-end tests over compiled Ximera HTML. Where per-package tests mount hand-authored fixtures, these tests compile a `.tex` source through `tex4npm`, load the resulting HTML into happy-dom, boot `ximera-core` with a mock agent, and drive user interactions across the full pilot roster on one page.

## What each test proves

- **Mount:** every component's DOM emitted by `ximera.4ht` picks up chrome (hint labels, word-choice select) without errors.
- **Interaction → dispatch → data-state:** clicking / selecting produces the expected model transitions and `data-state` values.
- **Progress:** `agent.setProgress` receives the correct `[0, 1]` value after each answerable is resolved.
- **Persistence:** the exact JSON `agent.setPageState` was called with can round-trip: mount fresh with it and the DOM matches.
- **Reset:** dispatching `RESET_WORK` restores first-visit DOM and progress.

## Running

```
cd specs/integration
npm install     # first time only — symlinks tex4npm and the pilot packages
npm test
```

External tools on `PATH`: `pdflatex`, `latex`, `tex4ht`, `t4ht` (same as `specs/fixtures/`).

## Fixture strategy

The suite reuses the Phase 0 fixtures from `../fixtures/` — they already compile clean and their DOM matches every spec's §2. A single test-run compiles all seven fixtures once (in a `before` hook) and then each test mounts a specific fixture via happy-dom.

The suite grows with every added component: adding a fixture + adding a test to this suite is the acceptance path.
