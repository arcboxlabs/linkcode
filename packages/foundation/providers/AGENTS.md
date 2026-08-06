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
  stores `service` + `endpointParams`, not a resolved URL.
- **`Account.endpoint` only outranks the catalog when the user named it.** The pre-variant add flow
  wrote an endpoint onto *every* catalog account, so honoring all of them would pin existing
  accounts to one protocol forever — an upgraded OpenAI account would lose codex, which works today
  because `OPENAI_BASE_URL` points at a host that does serve `/responses`. `pinnedEndpoint()`
  settles it by exact `baseUrl` match against the service's own variants: a match is the catalog's
  own output and is replaced by per-agent resolution; anything else was typed by a human (a custom
  account, or a catalog account edited through the custom form, which keeps its `service`) and is
  kept. Match on the URL, not on "the service declares this protocol" — the looser rule would
  silently discard a hand-typed proxy. A filled templated URL matches nothing and stays pinned;
  those accounts were never broken.
  - **Every caller asks `pinnedEndpoint()`, never `Account.endpoint` directly.** It is exported for
    exactly this reason: the client used the raw field once and immediately disagreed with the
    resolver about the same account — showing a pinned endpoint for one that resolves per agent.
    Display, edit-form prefill, and resolution have to answer the question identically.
- **`models` is service-level and spelled out, never derived.** One secret reaches one model list,
  and the ids are identical whichever protocol shape an agent resolves to — so the list belongs to
  the service, not the variant, and one fetch serves every agent bound to the account. The URL is
  written out because deriving it from a variant's `baseUrl` + protocol is wrong wherever variants
  sit on different paths: DeepSeek's `/anthropic` variant would give `/anthropic/v1/models` and
  Vercel's bare-origin one a root `/models`, neither of which exists. `wire` picks the auth header
  and response shape only. Absent means the service serves no list, and the account is freeform-only
  — true for both Cloudflare entries, whose `/compat` route has no model-list path (docs + verified
  live). Anthropic's list defaults to `limit=20`, so the full list must be asked for.
- **A missing variant is a claim about the vendor, so verify it.** Omitting `openai-responses`
  refuses codex outright, and an unverified assumption that "that endpoint doesn't serve it anyway"
  once shipped exactly that gap for xAI, OpenRouter and Vercel — all three do serve
  `POST {baseUrl}/responses` (checked against vendor docs 2026-08). Cloudflare's `/compat` genuinely
  does not; its Responses route is `/openai/responses`, a different path, which is why that entry
  has no responses variant. Added responses variants deliberately carry no `knownProvider`, so
  `preferredProtocols` keeps opencode and pi on the shape their own catalogs know.

## resolveBinding

One table, no per-service special cases. A service-name check inside a protocol decision is the
smell this package exists to remove.

- `claude-code` — the `anthropic` variant natively; else `openai-chat` through the local translator.
  **Only `openai-chat`**: `TranslatorUpstream.wire` is typed `'openai-chat'` and the sidecar
  implements nothing else, so a responses-only service is unavailable rather than translated.
- `codex` — `openai-responses` only. Chat Completions was removed from the CLI (`wire_api = "chat"`
  is a config-load error since 0.122), so a chat endpoint answers 404 on `POST /responses`.
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
`provider.<id>.{npm, models}`, pi `registerProvider` with `models[]` — is unimplemented. Endpoints
without a known provider keep the pre-existing behavior (baseUrl override on a guessed provider).

Metadata is **not** the blocker it was once recorded as: both agents accept a bare id and fill the
rest themselves (checked against opencode's config schema, where every `Model` field is optional in
v1 and v2, and pi's `modelFromJson`, which defaults `contextWindow` to 128000 and `maxTokens` to
16384). The reason to still avoid declaring models is the opposite one — **declaring a model the
agent already knows destroys good metadata.** pi's `applyModelsJson` replaces on id match, so
redeclaring `deepseek-v4-pro` overwrites its real 1M context window with that 128000 default and
makes the session compact constantly, silently. If custom registration is ever built, it must
declare only ids the agent's own catalog lacks, and reach for pi's `modelOverrides` (a field-level
patch that does not replace) whenever a known model needs one value changed.

**Do not fake the gap by passing a wire hint.** pi's `ProviderConfigInput` accepts `api`, so
`registerProvider({ baseUrl, api })` typechecks — and the SDK discards it on any call without
`models`. An earlier revision shipped exactly that, with a comment and a doc paragraph asserting the
wire was pinned; nothing failed, because a baseUrl-only injection is correct precisely when the
target provider's built-in wire already matches, which is every provider pi ships metadata for. The
correct scope is therefore known providers, and the honest statement of the limit is that
differently-shaped endpoints are out of scope until the metadata question is answered.
