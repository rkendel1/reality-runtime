# Reality Runtime primitive evaluation

This repository now includes a living demo at `examples/reality-runtime-demo/` that uses the real public runtime APIs over the real embedded `@feltdb/core` package.

## Evidence summary

- Runtime entrypoint: `src/index.js`
- FeltDB schema: `feltdb.flow`
- Demo: `examples/reality-runtime-demo/demo.mjs`
- Tests: `tests/runtime.test.mjs`

## Questions

### Is Reality authoritative?

**Mostly yes.** The authoritative world state lives in FeltDB collections (`Workspace`, `Room`, `Equipment`, `WorkOrder`, `WorkspaceEvent`, plus runtime primitives like `Participant`, `Journey`, and `Presence`). The runtime does not keep a second process-local source of truth for that state.

### Is Experience derived?

**Yes.** `Experience.refresh()` rematerializes from FeltDB, and the demo renderer derives participant-facing panels from `snapshot()` plus focus/journey context. Restart reconstruction works by creating a new runtime instance and calling `enter(...)`.

### Is Journey durable?

**Yes.** `Journey` records are persisted in FeltDB and survive runtime recreation.

### Is Presence disposable?

**Yes.** `leave()` ends Presence without deleting the participant, journey, or world state.

### Is Perspective independent from authorization?

**Yes.** Cross-participant `viewAs(...)` is rejected by safe runtime semantics and does not grant impersonation.

### Is Focus local to experience?

**Yes.** Focus is ephemeral experience state. It changes which part of the shared world the demo renders for a participant, but it does not mutate authoritative FeltDB state.

### Is observation reactive?

**Yes.** `Experience.observe(...)` uses FeltDB collection subscriptions; the demo and tests react to shared mutations without polling.

### Are actions real mutations?

**Yes.** Demo actions write directly to FeltDB collections through `experience.act(...)` and those mutations are observed by other participants.

### Can multiple participants inhabit one reality?

**Yes.** Alice, Bob, and Agent share one authoritative Acme Project state while maintaining different journeys and focus.

### Can the runtime restart?

**Yes.** A new runtime instance can reconstruct a participant’s journey and current shared state from durable FeltDB records.

### Is FeltDB authorization sufficient for participant-specific denial in the embedded runtime?

**No.** The public embedded/file `@feltdb/core` runtime exposes auth sessions and Flow policies, but it does not currently enforce participant-scoped record access on collection operations. In local verification, a second signed-in user could still read and update a `self(owner_id)` protected record through the embedded collection API. Because of that limitation:

- this repository keeps `viewAs(...)` on safe semantics only
- the demo can show runtime-level denial for unsafe perspective switching
- the demo cannot honestly claim a participant-specific mutation denial enforced by embedded FeltDB authority

## Conclusion

The current repository provides real evidence that Reality Runtime is a useful primitive for:

- durable shared state
- multi-participant habitation
- durable journeys
- disposable presence
- restart reconstruction
- reactive observation
- focus- and journey-dependent experience rendering

But it does **not** yet prove the full authorization story requested in the issue on the public embedded FeltDB surface. The missing assumption is not in Reality Runtime itself; it is the absence of participant-scoped authority enforcement in the embedded `@feltdb/core` runtime used by this repository.
