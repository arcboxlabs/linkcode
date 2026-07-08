# packages/agent-adapter — vendor coding-agent adapters

`@linkcode/agent-adapter` drives four coding agents through one normalized `AgentAdapter`. It is the deepest vendor-specific layer in the repo: the agent SDKs are fast-moving (three are 0.x; opencode is 1.x), so read the installed `.d.ts` under `node_modules`, not vendor docs, and verify behavior against the installed SDK — never re-derive it from memory.

## Layout

- One native adapter per agent under `src/native/`: `claude-code.ts`, `codex.ts`, `opencode.ts`, `pi.ts` (+ `codex-history.ts`, `agent-bin.ts`). Shared spine: `src/adapter.ts` (the `AgentAdapter` interface + id generators), `src/base.ts` (`BaseAgentAdapter`), `src/registry.ts`, `src/util.ts`, `src/history-util.ts`.
- CLI runtime probing under `src/probe/`: one `AgentCliProbe` subclass per external-CLI agent (`ClaudeCodeProbe`, `CodexProbe` — known install locations + `--version` vendor-marker verification), orchestrated by `AgentRuntimeProber` (`prober.ts`). The daemon probes the shared `agentRuntimeProber` instance once per boot and serves the result as the `agent-runtime.list` wire resource; adapters resolve their spawn path through `resolveBinary(kind)`.
- `createAdapter(kind)` in `registry.ts` is the ONLY factory — a `switch` over `AgentKind` ending in foxts `never(kind, 'agent kind')`, so an unhandled kind fails typecheck. **Adding an agent** = new native adapter class + registry case + extend the `AgentKind` enum.
- Id generators (`adapter.ts`): `nextMessageId()`→`msg-`, `nextToolCallId()`→`tool-`, `nextRequestId()`→`req-` (module counter + `Date.now().toString(36)`). These are the FALLBACK — adapters prefer provider-native ids (claude `toolu_`/message uuid; codex/opencode item/part ids) so live turns and cold-resume history converge by id.
- Each SDK is lazy-loaded via `loadSdk(name, () => import(...))`; on import failure the adapter emits `AgentEvent {type:'error', code:'sdk-unavailable', recoverable:false}` and rethrows — a missing SDK degrades to a clear error, it does not crash the daemon.

## SDK ↔ vendored-CLI lockstep (hard invariant)

An SDK and its native CLI binary ship as a PAIR speaking a **private, unversioned stdio protocol with no handshake** — the exact pair must never drift *silently*. The SDK version alone identifies the pair (platform `optionalDependencies` are exact-pinned: `@anthropic-ai/claude-agent-sdk-<platform>-<arch>`, `@openai/codex-<platform>-<arch>`).

Spawn-path resolution (`AgentRuntimeProber.resolveBinary`, CODE-110/114): **managed/bundled** (`LINKCODE_AGENT_BIN_DIR`, exact pair) → **detected** (user-installed CLI at a known location, version-verified at boot — deliberately a *drifted* pair; forward drift is smoke-verified, e.g. SDK 0.3.179 × claude 2.1.202) → **SDK self-resolution** out of node_modules (dev / standalone daemons; no PATH fallback, resolution failure throws). Packaged apps ship **no** agent binaries since CODE-114 — the compat manifest (CODE-77) will gate detected versions; nightly smoke (CODE-113) keeps the drift window honest.

Pins as of 2026-07 (package.json ranges are caret; the lockfile is the real pin):

| agent | SDK package | version |
| --- | --- | --- |
| claude-code | `@anthropic-ai/claude-agent-sdk` | 0.3.179 |
| codex | `@openai/codex-sdk` | 0.140.0 |
| opencode | `@opencode-ai/sdk` | 1.17.7 |
| pi | `@earendil-works/pi-coding-agent` | 0.79.6 |

- **Bumping an SDK** moves the exact pair the SDK self-resolves in dev; detected user installs are unaffected (their drift is the compat manifest's problem, CODE-77/113). Nothing is staged at package time anymore (CODE-114).
- Quirk: `@openai/codex-<arch>` is an npm alias for `@openai/codex@<ver>-<arch>`, so querying the registry by the alias name 404s — resolve via the `@openai/codex` version.

## BaseAgentAdapter contract

Every new adapter MUST honor these (`base.ts`); downstream relies on them, they are not conventions:

- **`emitTool(patch)`** merges partial `ToolCallUpdate` patches into a per-`toolCallId` snapshot and emits a COMPLETE `ToolCall` on every change (so downstream can replace-by-id). A tool at `completed`/`failed` is terminal — late updates are ignored; a stray post-teardown event can't revive it.
- **`teardown()`** (idempotent) sweeps liveness on cancel/stop/abnormal-end: resolves every pending permission ask `{outcome:'cancelled'}` and forces every non-terminal tool to `failed`. A cancelled turn never leaves a stuck tool or a hung permission.
- **`streamDelta(id, fullText, kind)`** turns a provider's CUMULATIVE per-item text into incremental deltas keyed by item id. codex/opencode report cumulative and MUST use it; claude/pi emit true incremental deltas and call `emitAssistantText`/`emitThought` directly. Mixing the two double-renders or drops text.
- **`freshSegment()`** opens fresh `messageId` AND `thoughtId` cursors; call it at turn start and after EVERY tool call (`buildConversation` buckets `agent-message-chunk` by `messageId`; `message-grouping.test.ts` guards it). A message's `messageId` must stay STABLE across all its deltas (the Pi adapter once minted a new id per delta and broke dedup).

## claude-code (richest adapter)

- **Streaming-input mode** (one persistent `Query` fed by an `AsyncMessageQueue`): the older single-message-per-turn + resume design silently ignored a changed model option on resume, so live model/permission/effort switching is ONLY possible in streaming mode — do not revert to `query()`+resume. Live switches: `Query#setModel`, `Query#setPermissionMode`, `Query#applyFlagSettings`. State is emitted only AFTER the CLI accepts a switch; a rejected one is not rolled back optimistically.
- **Approval policies** (CODE-78) map 1:1 onto the SDK `PermissionMode` in Claude Desktop's menu order: `default` (Ask), `acceptEdits` (Accept edits), `plan` (Plan mode), `auto` (Auto mode), `bypassPermissions` (Bypass). The SDK's `dontAsk` tier is deliberately off the menu. Claude models permissions and plan as ONE axis, so `plan` rides the approval-policy channel (not the generic set-mode axis codex uses). approval-policy is a locked, orthogonal SECOND axis; the engine caches the latest state and replays it on `session.attach` — without the replay the menu vanishes after reconnect.
- **Startup permissionMode trap**: the SDK-driven CLI pins startup `permissionMode` to `'default'` unless `options.permissionMode` is passed — unlike the interactive CLI it does NOT read `settings.json` `permissions.defaultMode` itself (verified on the 0.3.179 CLI even with explicit `settingSources`). The adapter resolves the default via `settingsDefaultMode(cwd)` (`.claude/settings.local.json` > `.claude/settings.json` > `~/.claude/settings.json`) and passes it as `options.permissionMode` when the Query is built — never hardcode a default. `allowDangerouslySkipPermissions:true` must ALWAYS be set at startup: it is only the gate for `--allow-dangerously-skip-permissions`, and a later live switch to Bypass is rejected if the gate was off.
- **Effort** (`low|medium|high|xhigh|max|ultracode`) has two channels: `low`–`xhigh` and `ultracode` switch LIVE via `applyFlagSettings`; `max` cannot travel flag-settings and enters ONLY via the `--effort` startup flag, which then outranks flag-settings for the process lifetime. Pass `options.effort` ONLY for `max` — passing it for any other level pins that level and makes every later live switch a silent no-op. Any transition into or out of `max` closes and rebuilds the Query (resuming under the sniffed session id).
- **Subagent** (CODE-80): the vendored CLI's spawn tool is named `Agent`, NOT `Task` (only old transcripts use `Task`) — match both exactly or you miss real spawns. Frames carry `parent_tool_use_id`; the adapter forwards subagent text via `forwardSubagentText:true` at message level and DROPS subagent stream deltas to avoid double-render. Cold recovery reads on-disk `subagents/agent-{id}.jsonl`, spliced right AFTER the parent Agent announce (children live in the SAME turn as the parent).
- **File mutations surface structurally**: an `Edit` tool_use → `{type:'diff', path, oldText, newText}`; `Write` → whole-file `{type:'diff', path, newText}`. The announce-time diff is stashed in `pendingEditDiffs` and re-attached at settle because `emitTool`'s merge replaces content wholesale (else the result text wipes the diff). Auto-denied tools never reach `canUseTool` — the ONLY carrier of the reason is the SDK system message subtype `permission_denied` (`decision_reason`), dropped onto the tool-call as `failed`.
- **Auth**: `query()` has no `apiKey` option; `config.apiKey` reaches the CLI as `ANTHROPIC_API_KEY` via `options.env`. Because env REPLACES the subprocess environment, the adapter spreads `{...env, ANTHROPIC_API_KEY}` so PATH/HOME survive; omitting env entirely = inherit parent = the login/ChatGPT-auth path. Observed on the 0.3.x CLI (no repo code sets or proves it — re-verify before relying): auto mode needs `CLAUDE_CODE_ENABLE_AUTO_MODE=1` on Bedrock/gateway setups and is free on direct API-key/OAuth.

## codex

- Runs autonomously (CODE-85): `threadOptions()` always sets `approvalPolicy:'never'` and `skipGitRepoCheck:true` because `@openai/codex-sdk` exposes NO interactive approval callback (a blocking policy would strand the turn). codex advertises no approval policies and rejects `set-approval-policy`.
- **Sandbox**: `codexConfiguredSandbox()` reads `$CODEX_HOME/config.toml` (default `~/.codex/config.toml`) for the active profile's or top-level `sandbox_mode` (`read-only|workspace-write|danger-full-access`). If the user configured ANY sandbox, `threadOptions` sets `sandboxMode=undefined` (codex's own resolution wins — NEVER silently loosen a stricter read-only); it injects `workspace-write` ONLY when unset (codex's built-in default is the stricter read-only). Honoring `config.toml` `approval_policy` is an explicit unfinished follow-up.
- StopReason is always `end_turn`. Tool kinds: `file_change`→edit, `command_execution`→execute, `web_search`→fetch, `mcp_tool_call`→other, `todo_list`→ a distinct `{type:'plan'}` event (not a tool). History reads `~/.codex` jsonl directly (`sessions/` + `archived_sessions/` + `session_index.jsonl`, filtered by cwd), skipping corrupt lines.

## opencode & pi

- **opencode** — `consumeEvents()` runs one long-lived `event.subscribe()`. A clean SSE close is EXPECTED at normal turn end (`session.idle`) or on cancel (abort closes without a matching `session.idle`); it is fatal ONLY while a turn is active with no cancel pending, and the fatal path emits status `stopped` (NOT `idle`) so the UI disables the composer — misclassifying it (the pre-fix bug) stranded the composer enabled against a dead adapter. Each event has its own try/catch. A resubscribe loop is the intended recovery but is NOT built yet (CODE-9). Do NOT teach opencode to accept `set-model` from code-reading alone — it rejects via base pending live provider verification (claude's own "looks live-switchable" read was wrong).
- **pi** — pure JS in-process (`createAgentSession()`), no binary spawn, unaffected by asar-spawn, not staged. auth via `authStorage.setRuntimeApiKey(provider, apiKey)` overriding `~/.pi/agent/auth.json` + env; model `provider/rest`, falls back to `modelRegistry.getAvailable()[0]`.

## Capability, auth & cancel matrices

Product code must branch on `historyCapabilities` — never assume an op is supported. Unsupported `read`/`resume` reject clearly (`'<kind>: history read is not supported'`); unsupported `list` returns empty `{sessions:[]}`.

| agent | list/read/resume | set-model | set-effort | set-approval-policy | packaged binary (CODE-114) |
| --- | --- | --- | --- | --- | --- |
| claude-code | ✓ | ✓ | ✓ | ✓ | detected user install / managed dir |
| codex | ✓ | ✗ | ✗ | ✗ | detected user install / managed dir |
| opencode | ✗ | ✗ | ✗ | ✗ | self-spawns server via PATH (CODE-76) |
| pi | ✗ | ✗ | ✗ | ✗ | in-process JS |

- **apiKey injection** (all read `StartOptions.config.apiKey`, four shapes): claude-code → `ANTHROPIC_API_KEY` in spawned env; codex → `new Codex({apiKey})` (honors `CODEX_HOME`); opencode → nested `config.provider[providerID].options.apiKey` (providerID = before `/` in model); pi → `authStorage.setRuntimeApiKey`.
- **Cancellation**: codex `AbortController.signal`; pi `session.abort()`; opencode `client.session.abort({sessionID})`; claude-code `Query#interrupt()` with a `cancelling` flag suppressing the interrupt-induced stream error. After any cancel, base `send()` also calls `teardown()`.
- **MCP gap**: `StartOptions.mcpServers` is DEFINED in `schema/agent.ts` but consumed by NO native adapter (claude `query()` doesn't forward it) — a ready-but-unwired slot blocking all MCP passthrough (CODE-93 prerequisite). Pi's SDK has no `mcpServers` support at all; the other three could inject stdio MCP once wired.

## Version seams

Three compatibility seams move independently and must be kept in sync: **SDK↔binary** (private protocol, no handshake — above), **SDK↔adapter** (0.x compile-time types), **client↔daemon** (the wire validates a per-message `z.literal(WIRE_PROTOCOL_VERSION)` with no negotiation). The safe update unit is an SDK+binary pair kept in sync with client/daemon; in-flight sessions can only be DRAINED across an update, not migrated live.

## Traps

- **Agent produces no text, 0 tokens, no error event** → a 401/auth failure (e.g. a Claude Code process started with a fake HOME whose credentials live in the real Keychain) is SWALLOWED into an empty turn — the adapter emits no error. When an agent "produces nothing," suspect auth, not an empty response. (Known bug, memory-only — re-verify against current claude-code error handling.)
- **Deny reason lost** → auto-denied tools never reach `canUseTool`; consume the `permission_denied` system message or the reason vanishes.
- **claude diff wiped by result text** → `emitTool`'s merge replaces content wholesale; keep the `pendingEditDiffs` stash/re-attach.
- **Composer stuck enabled after opencode error** → the stream-end fatal path must emit `stopped`, not `idle`.

## Design constraint (forward-looking)

Do NOT hard-weld "agent runs bare in the local cwd." Agents today run directly on the real machine (`query({cwd})`, `~/.codex`, local `AuthStorage`) and can `rm -rf` the host — an unmitigated hazard. Keep room for an `executionBackend` dimension (local-direct / arcbox-sandbox / cloud): `AgentSession` + `StartOptions` do not block inserting it later, so it need not be built before arcbox's sandbox tier ships. There is no `executionBackend` field yet and cwd is always local.

## Elsewhere

- Packaging (no agent binaries ship; platform packages are excluded from the asar) lives in `apps/desktop/AGENTS.md` and `docs/RELEASE.md`; the asar-spawn fix (defense-in-depth for any SDK-internal spawn) lives in `apps/daemon/AGENTS.md`.
- tayori / front-end consumption of these events is NOT this package's concern.
