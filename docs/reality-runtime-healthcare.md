# Reality Runtime healthcare evaluation

This document evaluates the healthcare demonstration built on the actual `RealityRuntime` and embedded public `@feltdb/core` APIs.

## Evidence

- Runtime: `src/index.js`
- Healthcare flow: `examples/reality-runtime-healthcare/healthcare.flow`
- Healthcare demo: `examples/reality-runtime-healthcare/demo.mjs`
- Healthcare tests: `tests/healthcare.test.mjs`

## Shared reality

**Yes.** Member, Provider, Health Plan, Employer, and Developer all inhabit one durable healthcare demo reality backed by the same FeltDB collections and event timeline.

## Multiple perspectives

**Partially.** The demo produces clearly different participant experiences from the same underlying reality, but embedded FeltDB still does not enforce participant-scoped record visibility on collection reads. The differing healthcare experiences are therefore honest projections over shared state, not proof of complete authority enforcement by the embedded runtime.

## Journey

**Yes.** Each participant has a durable journey record with distinct goal/context, and those journeys survive restart.

## Focus

**Yes.** Each participant can focus on a different slice of the same reality (`authorization`, `encounter`, `coverage`, `plan`, `workflow`) without mutating authoritative state.

## Live observation

**Yes.** A single authoritative mutation, such as submitting or approving an authorization, propagates through FeltDB subscriptions and updates the other participant experiences without polling.

## Replay

**Yes.** The healthcare demo reconstructs historical experiences from the durable `HealthcareEvent` timeline. The same timestamp can be replayed for Member, Provider, Health Plan, Employer, and Developer, and each participant gets a different materialized experience.

## Authority

**Partially / not fully proven.** Perspective remains subordinate to runtime safety semantics because cross-participant `viewAs(...)` is denied. But the embedded public `@feltdb/core` runtime still does not enforce participant-scoped record visibility on collection operations, so the healthcare demo cannot honestly claim fully enforced healthcare authorization boundaries from FeltDB alone.

## Developer experience

**Yes, within the synthetic demo environment.** The Developer can inspect journeys, actions, decisions, evidence, replayed state, and the live workflow without reaching into internal process memory. The demo explicitly treats this as a development/test reality rather than production healthcare access.

## Restart

**Yes.** The runtime can restart and reconstruct all five participant experiences from durable Participant, Journey, Presence, healthcare domain records, and the event timeline.

## Simplicity

**Mostly yes.** The demo uses the Reality Runtime primitives directly:

- Reality
- Participant
- Journey
- Perspective
- Focus
- Experience
- Observe / Act

The only extra demo-specific mechanism is a durable healthcare event timeline used to support replay reconstruction. It stays inside FeltDB and does not add a second persistence layer, but it does show that replay currently requires explicit domain support rather than falling out of the base runtime automatically.

## Conclusion

**Does Reality Runtime make this healthcare scenario substantially easier to model than building five separate participant-specific applications directly on FeltDB?**

**Yes, with an important limitation.**

The healthcare demo shows that one shared durable reality plus participant, journey, focus, replay, and experience primitives is a useful way to model multi-party healthcare workflows without building five separate applications. However, the current embedded FeltDB surface still does not provide the participant-scoped authorization enforcement that a full healthcare proof would require, so the demo validates the primitive more strongly for shared reality, live observation, replay, and restart reconstruction than for strict healthcare authority boundaries.
