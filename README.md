# reality-runtime

Small reality runtime built on the real `@feltdb/core` npm package.

## What this repository contains

This implementation intentionally stays on the verified public `@feltdb/core` surface:

- `createFeltDB(...)`
- `parseFlowSpec(...)`
- `db.deployFlowSpec(...)`
- `db.collection(name)`
- `db.transaction(...)`
- `Collection.find/get/insert/update/delete/subscribe`

The runtime adds seven concepts on top of that authority:

- **Reality** = authoritative FeltDB state governed by `.flow`
- **Journey** = durable goal-context record
- **Presence** = durable participation/session history
- **Perspective** = experiential input (`participant` + optional `journey`)
- **Experience** = reconstructable materialized runtime handle
- **Focus** = ephemeral attention state
- **Spawn** = materialization from FeltDB + `.flow` + participant context

## Security boundary

`viewAs(...)` is implemented with **safe semantics only**.

`viewAs != impersonation`

`viewAs != permission escalation`

The public embedded `@feltdb/core` runtime exposes local auth helpers, but it does **not** expose a principal-scoped delegated read API that can safely materialize Bob's authorized state while Alice remains the acting principal. This repository therefore rejects cross-participant `viewAs(...)` requests instead of faking authorization in JavaScript.

## Architecture

```text
.flow
+ FeltDB authoritative collections
+ participant
+ optional journey
        ↓
   createRealityRuntime()
        ↓
     spawn / enter
        ↓
     Experience
```

```text
Reality (authoritative) ───────▶ Experience (materialized)
          │                                │
          ├── Journey (durable context)    ├── Perspective (input)
          └── Presence (durable history)   └── Focus (ephemeral attention)
```

## Audit record

- **FeltDB package/version used:** `@feltdb/core@0.11.8`
- **`.flow` loading mechanism:** `parseFlowSpec(source)` + `db.deployFlowSpec(spec)`
- **collection API:** `db.collection(name)` and `Collection.find/get/insert/update/delete/subscribe`
- **query API:** `Collection.find/query` and `db.query(...)`
- **transaction API:** `db.transaction(...)`
- **authorization API:** `db.auth.signUp/signIn/signOut/session` plus `.flow` policies; embedded/local public API does not enforce participant-scoped record visibility on collection reads
- **identity / operation API:** `db.auth.session()` actor identity, `AtomicTransactionResult.transactionId`, `revisionId`, `operationIds`
- **subscription API:** `Collection.subscribe(...)`
- **existing test harness:** none in the original repository; this implementation uses Node's built-in `node:test`

## Reference example

The bundled `feltdb.flow` includes a small shared workspace example:

- `Workspace`
- `Room`
- `Equipment`
- `WorkOrder`
- `WorkspaceEvent`

Example journey: `repair-machine-17`

Participants can be `person`, `agent`, `device`, or `organization`.

## Limitations verified against the real public API

1. Durable journeys, presences, reconstruction, and subscriptions work on the embedded file runtime.
2. Embedded/local auth exists, but `.flow` policy enforcement is not applied to collection reads in the public embedded runtime.
3. Because of that gap, this repository does **not** fake participant-specific authorized projections in TypeScript.
4. Cross-participant `viewAs(...)` safely throws `UnauthorizedPerspectiveError`.

## Run tests

```bash
npm test
```

## Run the living demo

```bash
npm install
node examples/reality-runtime-demo/demo.mjs
```

See `examples/reality-runtime-demo/README.md` for the demo sequence and `docs/reality-runtime-primitive.md` for the primitive evaluation.