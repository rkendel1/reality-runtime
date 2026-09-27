# AppPort Services Capability Audit

Audited repository: `rkendel1/appport-services`  
Audited ref: `f3a80fe187a26d5f559111f3d0080a0ba6700023`

## Scope and method

This catalog is derived from the actual `appport-services` repository layout, published package metadata, root `package.json`, `packages/`, `src/`, `tests/`, `.flow` definitions, examples, and shipped docs.

Verified high-level facts:

- The monorepo publishes `@appport/services`, `@appport/runtime`, and `create-appport`. Sources: `package.json`, `packages/runtime/package.json`, `packages/create-appport/package.json`.
- The implementation depends on `@feltdb/core`; there is no actual `@appport/core` dependency in the repository. Sources: `package.json`, `packages/runtime/package.json`, `src/index.ts`.
- The durable schema lives in `appport.flow` and is deployed by the runtime at startup. Sources: `appport.flow`, `src/runtime/appport.ts`.
- Public surfaces exist across SDK exports, the `appport-runtime` / `appport-services` CLIs, the built-in HTTP runtime, Express adapters, and management routers. Sources: `src/index.ts`, `src/cli.ts`, `src/runtime/platform.ts`, `src/runtime/management.ts`, `src/runtime/express-middleware.ts`.
- Some advertised areas are only partial today, especially Secrets as an operational capability. Sources: `src/secrets/*`, `src/runtime/appport.ts`, `appport.flow`.

Primary audited sources:

- `package.json`
- `packages/runtime/package.json`
- `packages/create-appport/package.json`
- `appport.flow`
- `src/index.ts`
- `src/runtime/appport.ts`
- `src/runtime/platform.ts`
- `src/runtime/management.ts`
- `src/cli.ts`
- `src/authority/*`
- `src/api-keys/*`
- `src/webhooks/*`
- `src/jobs/*`
- `src/schedules/*`
- `src/notifications/*`
- `src/files/*`
- `src/configuration/*`
- `src/secrets/*`
- `src/storage/*`
- `docs/AUTHORITY.md`
- `tests/*.test.ts`
- `examples/*`

## Cross-cutting findings

### Actual platform surface today

AppPort Services currently provides these meaningful capability surfaces:

1. API keys
2. Webhooks
   - outbound endpoint registration and delivery
   - inbound webhook integrations and replay protection
3. Jobs
4. Schedules
5. Notifications
6. Files metadata
7. Configuration variables and credential bindings
8. Secrets protocol/types only
9. Runtime event stream and management/runtime HTTP surfaces

### Contract boundary

- The portable contract is mostly expressed by internal TypeScript models, service classes, exported runtime APIs, the static capability manifest, and `appport.flow`.
- Capability names are manifest-driven (`apikeys.*`, `webhooks.*`, `jobs.*`, `schedules.*`, `notifications.*`, `files.*`, `configuration.*`, `credential.*`).
- Contract versioning is implicit and static; there is no separate versioned external contract package.
- `ServiceGateway` is the policy enforcement point. Verified identity is required before any effect. Authorization is externalized to `ServiceAuthorizer`.

### Durable state boundary

- FeltDB is the intended durable store for capability state.
- `appport.flow` defines durable collections for API keys, webhooks, jobs, schedules, secrets metadata, configuration, notifications, files, webhook integrations, inbound replay protection, and service-effect evidence.
- The runtime also contains a non-durable in-memory event bus (`AppPortEvents`) used for SSE/event fan-out.

### Confirmed global gaps observed in the audited revision

The machine-readable companion list of confirmed top-level gaps lives in `docs/capabilities.json` under `crossCuttingFindings.confirmedGaps`. This catalog, `docs/capabilities.json`, and `docs/capability-authority.md` should be updated together and revalidated whenever the audit is refreshed.

## Capability: API keys

### Why it qualifies

API keys are a durable, tenant/application-scoped machine identity capability consumed through exported services, runtime APIs, management routes, and CLI commands.

### Contract

- Public types: `src/api-keys/models.ts`
- Public service: `ApiKeyService` from `src/api-keys/service.ts`
- Public runtime surfaces:
  - `application.api.keys.*` via `src/runtime/appport.ts`
  - bearer-token auth adapters in `src/runtime/http-adapter.ts` and `src/runtime/express-middleware.ts`
  - management routes in `src/runtime/management.ts`
  - CLI group in `src/cli.ts`
- Capability identifiers:
  - `apikeys.read`
  - `apikeys.create`
  - `apikeys.revoke`
- Inputs/outputs:
  - create input with name / optional expiration
  - creation returns plaintext secret once
  - read/list/revoke/authenticate return durable metadata/views
- Errors are part of the effective contract through the service and management/runtime adapters.
- Portable? Partially. The consumer can use the public service/runtime contract without reading storage code, but the contract still lives inside this repository rather than a separate package.

### Implementation

- Owner package: root `@appport/services`
- Main implementation: `src/api-keys/service.ts`
- Persistence: `src/storage/api-keys.ts`
- Hashing/validation: scrypt-based hashed secret storage in the service implementation
- Another provider could conceptually implement the same contract because the public API is identity-oriented and only persists metadata plus a secret hash.

### Authority

- Discover/list/read: `apikeys.read`
- Create: `apikeys.create`
- Revoke: `apikeys.revoke`
- Execute/use: authenticate the secret, then use the resulting verified principal elsewhere
- Owner/resource scope:
  - tenant comes from the verified principal
  - application is the gateway application
- Enforcement point: `ServiceGateway`
- Explicit flags:
  - no caller-controlled actor override
  - deprecated scopes are rejected
  - API keys are identity only, not authority

### Durable state

- Flow collections:
  - `ApiKeys`
  - `ApiKeyPrefixes`
  - `ApiKeyAuditEvents`
- Durable records track prefix lookup, secret hash, timestamps, revocation, last use, and audit events.
- No plaintext API key is durably stored.

### Lifecycle

- create
- active/authenticatable
- optional expire
- revoke
- audit last-used

Missing/unclear lifecycle semantics:

- rotation as a first-class operation
- ownership transfer
- explicit pause/resume

### Surfaces

- Contract: implemented
- SDK/service: implemented
- Runtime facade: implemented
- Server/API: implemented
- CLI: implemented
- Tests: implemented
- Examples/docs: implemented

### Gaps

- Scopes remain in durable schema for compatibility but are not the authority model anymore.
- Rotation and transfer are not first-class lifecycle operations.
- Contract versioning is implicit only.

## Capability: Webhooks

### Why it qualifies

Webhooks are durable delivery infrastructure with endpoint registration, outbound delivery records, inbound integration records, replay protection, retries, management routes, runtime integration, and tests.

### Contract

- Public types: `src/webhooks/models.ts`
- Public service: `WebhookService` from `src/webhooks/service.ts`
- Public runtime surfaces:
  - `application.webhooks.*` via `src/runtime/appport.ts`
  - management routes via `src/runtime/management.ts`
  - built-in inbound route at `/_appport/webhooks/inbound/:integrationId`
- Capability identifiers:
  - `webhooks.read`
  - `webhooks.register`
  - `webhooks.remove`
  - `webhooks.emit`
  - `webhooks.replay`
  - `webhooks.integrations.register`
  - internal: `webhooks.deliver`, `webhooks.receive`
- Inputs/outputs include durable endpoint views, delivery views, integration registration, emit inputs, and inbound request/result structures.
- Portable? Partially. The durable endpoint/delivery model is portable; the built-in HTTP runtime and HMAC/header behavior are implementation details around that model.

### Implementation

- Main implementation: `src/webhooks/service.ts`
- Secret/header helpers: `src/webhooks/secrets.ts`
- Persistence: `src/storage/webhooks.ts`
- Provider adapter boundary:
  - destination validation and HTTP POST delivery are implementation/provider detail
  - signing material is resolved through credential custody, not stored locally

### Authority

- Discover/list/read: `webhooks.read`
- Register endpoint: `webhooks.register`
- Remove/disable: `webhooks.remove`
- Emit outbound deliveries: `webhooks.emit`
- Replay delivery: `webhooks.replay`
- Register inbound integration: `webhooks.integrations.register`
- Delivery execution / inbound receive: runtime-internal capabilities
- Owner/resource scope:
  - tenant and application are enforced by the gateway
  - durable principal is captured on emit/replay and re-attested on delivery
  - inbound integrations run as `integration:<provider>`
- Enforcement point: `ServiceGateway`

### Durable state

- Flow collections:
  - `WebhookEndpoints`
  - `WebhookDeliveries`
  - `WebhookAuditEvents`
  - `WebhookIntegrations`
  - `InboundWebhookEvents`
- Durable state includes destination metadata, subscribed events, retry state, principal attestation, inbound replay protection, and audit events.
- Signing material is stored as `signing_credential_ref`, not plaintext.

### Lifecycle

Outbound:

- register endpoint
- active
- disable/remove
- emit delivery record
- retrying/running delivery attempts
- delivered / failed / denied terminal states
- replay when allowed

Inbound:

- register integration
- active
- receive signed request
- verify signature/timestamp
- persist replay key
- hand off event as integration principal
- disable/remove

### Surfaces

- Contract: implemented
- SDK/service: implemented
- Runtime facade: implemented
- Server/API: implemented
- CLI: implemented
- Events/tests/docs: implemented

### Gaps

- No separate portable transport abstraction package.
- Endpoint verification/challenge semantics are not a separate first-class contract.
- Delivery can still execute twice in failure windows; retries are durable, but exactly-once is not claimed.

## Capability: Jobs

### Why it qualifies

Jobs are durable deferred execution primitives with queue state, leasing, retries, runtime startup loops, worker support, management routes, and tests.

### Contract

- Public types: `src/jobs/models.ts`
- Public services: `JobService`, `JobWorker`
- Runtime facade: `application.jobs.*`
- Management routes: `src/runtime/management.ts`
- CLI group: `job` in `src/cli.ts`
- Capability identifiers:
  - `jobs.read`
  - `jobs.create`
  - `jobs.retry`
  - internal: `jobs.execute`
- Inputs/outputs include job create payloads, durable job state, retry state, and execution context/run results.
- Portable? Mostly, at the service contract level. The lease/polling worker is implementation-specific.

### Implementation

- Main implementation: `src/jobs/service.ts`
- Persistence: `src/jobs/store.ts`
- Worker loop: `src/jobs/worker.ts`
- Runtime integration: `src/runtime/appport.ts`

### Authority

- Read/list: `jobs.read`
- Submit: `jobs.create`
- Retry: `jobs.retry`
- Execute: internal `jobs.execute`, re-authorized on every run
- Durable principal from enqueue/schedule is attested before execution
- Enforcement point: `ServiceGateway`

### Durable state

- Flow collections:
  - `Jobs`
  - `JobAuditEvents`
- Durable records store payload, type, run time, attempts, lease owner/expiration, errors, and principal attestation.
- `ServiceEffectEvidence` is also part of the auditable trail for consequential runs.

### Lifecycle

- enqueue
- scheduled/pending
- leased/running
- completed
- retrying
- failed
- manual retry

### Idempotency and retry

- Retry state is durable.
- Leases can become stale and be reclaimed.
- Double execution is still possible in failure windows; the repo implements at-least-once style recovery rather than exactly-once guarantees.
- No generic idempotency key exists for normal job creation.

### Surfaces

- Contract: implemented
- SDK/service: implemented
- Runtime facade: implemented
- Server/API: implemented
- CLI: implemented
- Tests/docs/examples: implemented

### Gaps

- No first-class cancellation contract surfaced in the audited implementation.
- No exactly-once execution guarantee.
- Queue/provider abstraction is limited to the built-in durable worker model.

## Capability: Schedules

### Why it qualifies

Schedules are durable recurring execution resources that materialize jobs through the same runtime and authority model.

### Contract

- Public types: `src/schedules/models.ts`
- Public service: `ScheduleService` in `src/schedules/service.ts`
- Runtime facade: `application.schedules.*`
- Management routes: `src/runtime/management.ts`
- Capability identifiers:
  - `schedules.read`
  - `schedules.create`
  - `schedules.cancel`
- Portable? Partially. The public model is portable, but interval parsing/materialization is bound to the built-in job system.

### Implementation

- Thin wrapper over job scheduling in `src/schedules/service.ts`
- Durable scheduling implementation lives in `src/jobs/service.ts`

### Authority

- Read/list: `schedules.read`
- Create: `schedules.create`
- Disable/cancel: `schedules.cancel`
- Materialized job executions are re-authorized through job execution
- Enforcement point: `ServiceGateway`

### Durable state

- Flow collections:
  - `JobSchedules`
  - `JobAuditEvents` for schedule-related operations
- Durable schedule state stores interval string, next run time, enabled flag, creator, and optional durable principal.

### Lifecycle

- create
- enabled
- materialize due job
- advance `nextRunAt`
- disable/cancel

### Gaps

- No timezone field
- No missed-execution policy field
- No richer recurrence model beyond the interval string
- Contract-level linkage to downstream jobs exists behaviorally but is not a separate public type graph

## Capability: Notifications

### Why it qualifies

Notifications are a durable inbox/delivery capability with channels, deliveries, retries, idempotency keys, management routes, docs, and tests.

### Contract

- Public types: `src/notifications/models.ts`
- Public services and channel registry:
  - `NotificationService`
  - `NotificationChannelRegistry`
  - built-in in-app and browser channels
- HTTP router: `src/notifications/http.ts`
- Runtime facade: `application.notifications.*`
- Capability identifiers:
  - `notifications.read`
  - `notifications.send`
  - `notifications.update`
  - `notifications.delete`
- Inputs/outputs include notification create/list/get state, per-channel delivery state, audit records, and delivery job integration.
- Portable? Fairly portable at the durable notification/delivery contract level; channel implementations are provider adapters.

### Implementation

- Main implementation: `src/notifications/service.ts`
- Channel/provider boundary: `src/notifications/channels.ts`
- Sensitive-data screening: `src/notifications/sensitive.ts`
- Persistence: `src/storage/notifications.ts`

### Authority

- Read/list/get: `notifications.read`
- Create/send: `notifications.send`
- Mark/read/ack/dismiss and other state changes: `notifications.update`
- Delete: `notifications.delete`
- Delivery execution occurs through jobs/runtime internals
- Enforcement point: `ServiceGateway`

### Durable state

- Flow collections:
  - `Notifications`
  - `NotificationDeliveries`
  - `NotificationAuditEvents`
- Durable state includes recipient, body/metadata, source, channels, status, idempotency keys, per-channel delivery attempts, failure reason, read/ack/dismiss timestamps, expiration, and audit events.

### Lifecycle

- create/send
- pending/unread
- per-channel queued delivery rows
- delivered / retrying / failed
- read / acknowledged / dismissed
- expired
- delete

### Idempotency and retry

- Notification creation supports idempotency keys.
- Delivery rows also carry idempotency keys.
- Delivery retries are durable and can be recovered through jobs.
- Duplicate delivery is still possible across provider failure windows.

### Gaps

- No suppression model found in the audited implementation.
- Browser delivery is a pointer event, not a complete portable notification transport.
- Notification provider metadata is channel-specific rather than a separately versioned provider contract.

## Capability: Files metadata

### Why it qualifies

The repository implements a durable file metadata service with ownership, audit, and management/runtime surfaces, even though it is not a blob storage capability.

### Contract

- Public types: `src/files/models.ts`
- Public service: `FileService`
- Runtime facade: `application.files.*`
- Management routes: `src/runtime/management.ts`
- Capability identifiers:
  - `files.read`
  - `files.write`
  - `files.delete`
- Portable? Limited but meaningful. The contract is metadata-centric and can be provider-neutral if another provider stores the actual bytes elsewhere.

### Implementation

- Main implementation: `src/files/service.ts`
- Persistence: `src/storage/files.ts`

### Authority

- List/get: `files.read`
- Create/update: `files.write`
- Delete: `files.delete`
- Owner/resource fields are durable attributes used for authorization
- Enforcement point: `ServiceGateway`

### Durable state

- Flow collections:
  - `Files`
  - `FileAuditEvents`
- Durable state records owner, filename, content type, size, checksum, storage key, metadata, timestamps, and soft deletion marker.
- No file body/blob storage is present in this repository.

### Lifecycle

- create metadata record
- update metadata
- soft delete via `deletedAt`

### Gaps

- No upload/download transport
- No content-addressed blob lifecycle
- No explicit replacement/version history model
- The capability is metadata-only, which is narrower than a full portable file capability

## Capability: Configuration and credential bindings

### Why it qualifies

The repository implements durable configuration variables and secret/credential bindings with management HTTP surfaces, docs, tests, and FeltDB persistence.

### Contract

- Public types: `src/configuration/models.ts`
- Public service: `ConfigurationService`
- HTTP surfaces:
  - `src/configuration/http.ts`
  - management mounting in `src/runtime/management.ts`
  - optional UI router in `src/configuration/ui.ts`
- Capability identifiers:
  - `configuration.read`
  - `configuration.write`
  - `configuration.delete`
  - `credential.attach`
  - `credential.rotate`
  - `credential.detach`
- Portable? Partially. Variables/bindings are portable; current surfaces are management-oriented and not mounted by default in the built-in runtime.

### Implementation

- Main implementation: `src/configuration/service.ts`
- Persistence: `src/configuration/storage.ts`
- Provider boundary:
  - literal variables are stored directly
  - secret-like values are represented only by `credentialRef`

### Authority

- Read/list: `configuration.read`
- Create/update variable: `configuration.write`
- Delete: `configuration.delete`
- Attach/rotate/detach credential bindings: `credential.*`
- Enforcement point: `ServiceGateway`

### Durable state

- Flow collections:
  - `ConfigurationVariables`
  - `ConfigurationSecrets`
  - `ConfigurationAuditEvents`
- Durable records are scoped by tenant/application/environment.
- Raw secret values are intentionally rejected; only credential references persist.

### Lifecycle

- define variable or bind credential
- update/rotate
- list/read
- delete/detach

### Gaps

- No `application.configuration` facade is exposed by `AppPortApplication`.
- Built-in runtime does not mount configuration routes/UI by default.
- Secrets here are credential bindings, not a complete secret-management capability.

## Inventory entry: Secrets protocol

### Why it is included

Secrets are represented strongly enough in the repository to matter to the platform boundary, but today they are primarily contract/types/protocol, not a complete operational capability surface.

### Contract

- Public types and errors: `src/secrets/models.ts`, `src/secrets/errors.ts`, `src/secrets/index.ts`
- Resolution protocol: `src/secrets/protocol.ts`
- Flow state exists for:
  - `Secrets`
  - `SecretVersions`
  - `SecretAuditEvents`
- Portable? As a protocol, yes. As a complete implemented capability, no.

### Implementation

- There is no `SecretService` equivalent exposed and no `application.secrets` runtime surface.
- Runtime capability registry leaves secrets as a no-op/non-constructed entry.
- Actual secret material is expected to remain with an external credential provider/custody boundary.

### Authority

- The audited manifest uses `credential.attach`, `credential.rotate`, and `credential.detach` through configuration binding flows.
- There is no implemented first-class `secrets.read/create/update/delete` capability surface to audit as an operational runtime feature.

### Durable state

- Flow defines secret metadata/version/audit collections.
- The runtime repository does not demonstrate those collections being surfaced by a concrete service implementation.

### Lifecycle

- register/create metadata
- version
- expire/revoke/retire
- resolve through scoped resolver

### Gaps

- This is the clearest contract/implementation gap in the repository.
- There is no discoverable agent-facing runtime surface for secrets today.
- Applications/agents would need source-level knowledge of the protocol and external custody model.

## Inventory entry: Runtime events and subscriptions

### Why it is included

The runtime exposes event publication and subscription surfaces, but they are not a durable portable capability on the same footing as jobs or notifications.

### Contract

- Types: `src/runtime/platform.ts`
- Runtime surfaces:
  - `application.publish(...)`
  - `/_appport/events` GET (SSE) / POST (publish)
- Portable? Weakly. The shape is public, but the implementation is explicitly in-process and HTTP/SSE-oriented.

### Implementation

- In-memory event bus: `AppPortEvents` in `src/runtime/platform.ts`
- Event fan-out integrates with webhook emission and in-process handlers in `src/runtime/appport.ts`

### Authority

- Event publishing that would cause webhook fan-out requires a verified principal.
- Read/subscribe behavior is runtime/API specific.
- Enforcement point is still the runtime plus `ServiceGateway` when a consequential downstream effect occurs.

### Durable state

- None for the event stream itself.
- Up to 1,000 in-memory events are retained for replay.
- This is explicit process-local mutable state.

### Lifecycle

- publish
- retain in memory
- replay by SSE last-event-id
- drop on process restart / bounded retention eviction

### Gaps

- Not durable
- Not provider-neutral
- HTTP/SSE assumptions leak into the public surface
- Should not be treated as authoritative application state

## Cross-capability relationships actually present

- Event publish -> webhook delivery creation
- Job schedules -> durable jobs
- Notification send -> notification delivery rows -> optional job execution for channel delivery
- Configuration secret bindings -> credential references -> external custody resolution
- Webhook signing -> credential reference -> external custody resolution

## Boundary between platform capability and application state

The repository intends durable platform capability state to live in the AppPort collections from `appport.flow`, while application state remains outside these AppPort capability records. However, the boundary is incomplete in a few places:

- the runtime event bus is process-local state rather than durable capability state
- configuration/UI are management surfaces, not part of the main runtime application facade
- secrets are modeled durably in Flow but do not have a complete runtime capability surface

## Agent usability summary

An autonomous agent can reasonably discover and use:

- API keys
- webhooks
- jobs
- schedules
- notifications
- files metadata
- configuration bindings

An autonomous agent cannot fully rely on portable public capability documentation alone for:

- secrets as an operational service
- durable event subscriptions
- implicit contract versioning
