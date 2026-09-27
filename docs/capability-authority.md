# AppPort Services Authority Matrix

Audited repository: `rkendel1/appport-services`  
Audited ref: `f3a80fe187a26d5f559111f3d0080a0ba6700023`

## Cross-cutting authority findings

- The tenant is derived from the verified principal; it is not accepted as a free caller override.
- The application is the gateway/runtime application; cross-application reads and writes are denied.
- `ServiceGateway` is the authorization enforcement point for consequential effects.
- Provider credentials do not bypass normal authority; they are resolved only after authorization and only for the authorized `credentialRef`.
- UI filtering is not the authority model.
- Durable job and webhook principals are re-attested before execution/delivery.

## Matrix

### API keys

- Durable resources: `ApiKeys`, `ApiKeyPrefixes`, `ApiKeyAuditEvents`
- Owner model: tenant + application
- Caller identity model: verified principal minted by host/API key auth
- Read authority: `apikeys.read`
- Use/execute authority: authenticate key -> verified principal; downstream use occurs under other capabilities
- Mutate authority: `apikeys.create`
- Revoke/delete authority: `apikeys.revoke`
- Enforcement point: `ServiceGateway`; API-key auth adapter for bearer verification
- Flags / gaps: scopes are deprecated and rejected; no ownership transfer/rotation surface

### Webhooks

- Durable resources: `WebhookEndpoints`, `WebhookDeliveries`, `WebhookAuditEvents`
- Owner model: tenant + application; endpoint belongs to the application runtime
- Caller identity model: verified principal for register/emit/remove; attested durable principal for delivery; `integration:<provider>` for inbound
- Read authority: `webhooks.read`
- Use/execute authority: `webhooks.emit`, `webhooks.replay`; internal `webhooks.deliver` / `webhooks.receive`
- Mutate authority: `webhooks.register`, `webhooks.remove`, `webhooks.integrations.register`
- Revoke/delete authority: disable/remove through webhook mutation flows
- Enforcement point: `ServiceGateway` plus destination validation
- Flags / gaps: durable retries exist; exactly-once not claimed; no separate endpoint verification handshake contract found

### Jobs

- Durable resources: `Jobs`, `JobAuditEvents`
- Owner model: tenant + application
- Caller identity model: verified principal at enqueue; attested durable principal at execution; runtime minted `job` principal per run
- Read authority: `jobs.read`
- Use/execute authority: `jobs.execute` (internal, re-authorized each run)
- Mutate authority: `jobs.create`, `jobs.retry`
- Revoke/delete authority: retry exists; no first-class cancel contract found
- Enforcement point: `ServiceGateway` + job lease/execution logic
- Flags / gaps: at-least-once style recovery; stale lease reclaim can allow duplicate work windows

### Schedules

- Durable resources: `JobSchedules`, related `JobAuditEvents`
- Owner model: tenant + application
- Caller identity model: verified principal at create/cancel; materialized jobs inherit durable principal
- Read authority: `schedules.read`
- Use/execute authority: materializes jobs through job execution path
- Mutate authority: `schedules.create`
- Revoke/delete authority: `schedules.cancel`
- Enforcement point: `ServiceGateway` + schedule/job runtime
- Flags / gaps: no timezone or missed-run policy fields

### Notifications

- Durable resources: `Notifications`, `NotificationDeliveries`, `NotificationAuditEvents`
- Owner model: tenant + application; recipient is a protected attribute
- Caller identity model: verified principal for create/update/delete; delivery workers run through runtime internals
- Read authority: `notifications.read`
- Use/execute authority: channel delivery runs through notification service/job path
- Mutate authority: `notifications.send`, `notifications.update`
- Revoke/delete authority: `notifications.delete`
- Enforcement point: `ServiceGateway` + notification service/job recovery
- Flags / gaps: suppression model not found; duplicate provider deliveries still possible in failure windows

### Files metadata

- Durable resources: `Files`, `FileAuditEvents`
- Owner model: tenant + application; file `owner` is a resource attribute
- Caller identity model: verified principal
- Read authority: `files.read`
- Use/execute authority: N/A beyond metadata reads
- Mutate authority: `files.write`
- Revoke/delete authority: `files.delete`
- Enforcement point: `ServiceGateway`
- Flags / gaps: metadata only; no byte upload/download surface

### Configuration variables

- Durable resources: `ConfigurationVariables`, `ConfigurationAuditEvents`
- Owner model: tenant + application + environment
- Caller identity model: verified principal
- Read authority: `configuration.read`
- Use/execute authority: read/use is management/configuration oriented
- Mutate authority: `configuration.write`
- Revoke/delete authority: `configuration.delete`
- Enforcement point: `ServiceGateway`
- Flags / gaps: not mounted by default in built-in runtime

### Credential bindings

- Durable resources: `ConfigurationSecrets`, `ConfigurationAuditEvents`
- Owner model: tenant + application + environment
- Caller identity model: verified principal + authorized `credentialRef`
- Read authority: `configuration.read` for listing binding metadata
- Use/execute authority: `credential.attach`, `credential.rotate`, `credential.detach` control which provider-held credential is linked
- Mutate authority: `configuration.write` plus `credential.*` capability family
- Revoke/delete authority: `configuration.delete` / `credential.detach`
- Enforcement point: `ServiceGateway` with scoped credential resolution
- Flags / gaps: raw secret values are rejected; binding configuration is not itself authority to use the credential

### Secrets protocol

- Durable resources: `Secrets`, `SecretVersions`, `SecretAuditEvents` in Flow only
- Owner model: intended tenant-scoped secret metadata
- Caller identity model: no implemented runtime caller surface
- Read authority: unclear/missing
- Use/execute authority: external custody resolution protocol only
- Mutate authority: unclear/missing
- Revoke/delete authority: unclear/missing
- Enforcement point: no complete operational enforcement surface in audited runtime
- Flags / gaps: ownership and lifecycle are modeled in Flow/types but not implemented as a concrete service

### Runtime events

- Durable resources: in-memory `AppPortEvents` only
- Owner model: process-local runtime, not durable owner state
- Caller identity model: runtime/HTTP caller
- Read authority: runtime/API specific
- Use/execute authority: publish can trigger downstream webhook authority checks
- Mutate authority: POST publish endpoint and runtime publish call
- Revoke/delete authority: bounded retention eviction only
- Enforcement point: runtime + downstream `ServiceGateway` when effects occur
- Flags / gaps: explicit hidden mutable state; not durable authority

## Explicit flags required by the audit

### Ownership implicit or incomplete

- Secrets are modeled but lack a complete operational service, so ownership semantics are incomplete at the runtime surface.
- Runtime events are process-local and do not carry a durable owner model comparable to the other capabilities.

### Authorization missing or partial

- Secrets do not expose a complete public create/read/update/revoke service to audit.
- Configuration exists as service/router code, but the default built-in runtime does not expose it unless separately mounted.

### Identity lost or caller-controlled IDs

- The audited code strongly avoids caller-controlled identity fields for consequential operations.
- Durable job and webhook records store principals, but execution still depends on re-attestation rather than treating the stored record alone as sufficient authority.

### Authorization after sensitive retrieval

- The intended implementation order prevents this: credentials are resolved only after authorization through `ServiceGateway`.

### Provider credentials bypassing normal authority

- No such bypass is intended in the audited design; provider-held secrets are referenced by `credentialRef` and resolved only inside an authorized execution context.
