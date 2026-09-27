# reality-runtime-demo

Run the living demo from the repository root:

```bash
npm install
node examples/reality-runtime-demo/demo.mjs
```

The demo uses the real runtime public APIs:

- `createRealityRuntime(...)`
- `runtime.createJourney(...)`
- `runtime.spawn(...)`
- `runtime.enter(...)`
- `experience.focus(...)`
- `experience.observe(...)`
- `experience.act(...)`
- `experience.leave()`

What it shows:

1. Alice, Bob, and Agent enter the same Acme Project reality
2. Each participant keeps a different journey and focus
3. Alice mutates shared task state and the others observe it reactively
4. Agent claims work through the same runtime primitive
5. Cross-participant `viewAs(...)` is denied by the runtime's safe perspective semantics
6. Bob leaves, the runtime is recreated, and Bob re-enters with his durable journey reconstructed
