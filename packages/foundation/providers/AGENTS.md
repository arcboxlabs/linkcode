# packages/foundation/providers — model-provider service directory

`@linkcode/providers` owns which endpoints each provider serves and which one a given agent uses.
Both ends read it: the daemon resolves a session's endpoint at start (`packages/host/engine`
`provider-config.ts`), the client renders binding availability (`packages/client/workbench`
`settings/providers/view.ts`). It previously lived in workbench and the daemon had its own partial
copy of the same facts — keep it here so there is one.

Pure data plus pure functions: no hooks, no browser APIs, no I/O. Its only dependencies are
`@linkcode/schema` types and `foxts`.

## The model

- A **variant is one protocol shape of one service**, reached with the *same secret*. Two endpoints
  that need different secrets, or that mean different things to the user (a plan/reasoning tier
  versus the standard API), are **separate services** — not variants. `cloudflare-gateway` and
  `cloudflare-anthropic` are split for exactly this reason: the pass-through leg authenticates with
  the user's own Anthropic key.
- `variants` is keyed by `AccountProtocol`, so a service cannot declare two variants of one shape.
- `credentialType` sits on the service, not the variant — that is what the shared-secret rule means.
  Differing *header shape* per protocol would be fine (DeepSeek's Anthropic endpoint accepts both
  `x-api-key` and `Authorization: Bearer`); differing secret *value* is not, and would break
  automatic selection. Add a per-variant override only if a real service needs one.
- **Variants are never user-selectable.** The add-account form asks for a secret (and any
  `{placeholder}` values); `resolveBinding` picks the variant per agent. An `Account` therefore
  stores `service` + `endpointParams`, not a resolved URL. `Account.endpoint` means an explicitly
  named endpoint — a custom account, or one written before variants existed — and outranks the
  catalog.

## resolveBinding

One table, no per-service special cases. A service-name check inside a protocol decision is the
smell this package exists to remove.

- `claude-code` — the `anthropic` variant natively; else `openai-chat` through the local translator.
  **Only `openai-chat`**: `TranslatorUpstream.wire` is typed `'openai-chat'` and the sidecar
  implements nothing else, so a responses-only service is unavailable rather than translated.
- `codex` — `openai-responses` only. Chat Completions was removed from the CLI (`wire_api = "chat"`
  is a config-load error since 0.122; we pin 0.144.1), so a chat endpoint answers 404 on
  `POST /responses`.
- `opencode` / `pi` — any shape. They route by provider, so the preferred variant is the one whose
  `knownProvider` names an entry in that agent's own catalog: the agent then carries the wire adapter
  and model metadata and needs only the key. `knownProvider` reaches the adapters through
  `StartOptions.config.knownProvider`.
- `grok-build` — no endpoint axis at all (the headless CLI has no base-URL flag), so it is a vendor
  check, deliberately its own branch rather than an escape hatch in the protocol match.
- An `unavailable` result must fail a session start loudly; the engine does this rather than
  starting an agent against an endpoint it cannot speak.

`knownProvider` ids come from remote vocabularies — `models.dev` for opencode (its `api` field is
the base URL, `npm` fixes the wire) and pi's `KnownProvider` union. A stale id must degrade to "no
known provider" and fall through to current behavior, never fail a session.

## Not here yet

Registering a **custom** provider for an endpoint no agent knows — opencode
`provider.<id>.{npm, models}`, pi `registerProvider` with `models[]` — is unimplemented. pi's
`models[]` requires `reasoning` / `input` / `cost` / `contextWindow` / `maxTokens`, which no
`/v1/models` response carries and `contextWindow` feeds pi's compaction math, so the metadata source
is a real decision. Until it lands, endpoints without a known provider keep the pre-existing
behavior (baseUrl override on a guessed provider).
