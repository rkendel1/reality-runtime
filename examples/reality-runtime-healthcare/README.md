# reality-runtime-healthcare

Run the healthcare demonstration from the repository root:

```bash
npm install
node examples/reality-runtime-healthcare/demo.mjs
```

What it demonstrates:

1. Member, Provider, Health Plan, Employer, and Developer enter one shared synthetic healthcare reality
2. Each participant keeps a different journey and focus over the same durable state
3. Provider submits an authorization and the other experiences update reactively
4. Health Plan reviews and approves the authorization
5. Employer sees aggregate plan context rather than clinical detail in the demo projection
6. Developer replays the same reality at `10:04`
7. The runtime restarts and reconstructs all experiences
8. A current live action submits a claim after replay

Important limitation:

- The public embedded `@feltdb/core` runtime used here still does not enforce participant-scoped record visibility on collection operations, so the healthcare demo remains a truthful synthetic test reality rather than a proof of full healthcare authorization enforcement.
