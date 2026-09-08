# packages/client/core — the cross-platform data-plane client

`LinkCodeClient` (session semantics over any `Transport`), the per-session `EventBuffer`, the
conversation view-model builder, and the conversation store shared by desktop, webview, and mobile.
Framework-agnostic except `react.tsx` (the `useSyncExternalStore` hooks).

## Conversation seeding — two merge paths

`createConversationStore` folds a seed, then the live `agent.event` buffer. Which seed a surface
reads is decided once, in `readConversationSeed` (`conversation-read.ts`), and both paths must keep
working until the compatibility floor passes v80:

- **Projection path** (`ConversationProjectionSeed`): the host advertises the turn graph
  (`client.supportsConversationGraph`, wire ≥ `CONVERSATION_GRAPH_WIRE_VERSION`) **and** the session
  has turn rows (`conversation.read` names a `leafTurnId`). Pages are walked as one snapshot; a
  `graphRevision`/leaf change between pages or the daemon's typed `conflict` restarts the walk.
  Merge rule: drop live events at or below the final page's `(epoch, seq)` watermark, older epochs
  included; fold everything above. Nothing is matched by content — the daemon mints one identity per
  user row (`userRowMessageId`, `msg-<turnId>`) for the live echo and the read alike.
- **History path** (`ConversationSeed`): ≤v79 hosts and sessions without turn rows (pre-existing
  sessions until the single-lineage migration). `history.read` transcript + the connection's receive
  cut (`uptoSeq`); user rows are matched by content because provider and host ids never converge.
  Retires with the floor bump.

Rules the projection store enforces — keep them when touching it:

- **Interactive events are never dropped on the watermark** (`permission-*`, `question-*`,
  `prompt-response-status`): their state lives in the daemon's interaction registry, a read may
  predate them, and the builder folds repeats idempotently. Unstamped frames (the dev mock, an old
  host) always fold.
- **A skip in the daemon position asks for one re-read** through `onResync`: an epoch jump (a
  relaunch, a daemon restart), a same-epoch sequence gap (frames missed while detached), or a
  `conversation.graph.changed` revision past the read whose new leaf's row never arrived live (an
  edit or rewrite from any device, a stale read). The request fires at most once per store, via a
  microtask so it never runs inside a render; folding continues meanwhile. A persisted seed carries
  no watermark, supersedes nothing, and takes its baseline from the first stamped event.
- **A stamped repeat stays in the `EventBuffer`** (attach replays resolved asks): dropping it would
  read as a gap. Only unstamped repeats are deduped.
- **Durable user rows carry attachment refs** (`resource_link` with an `attachment:` URI). The live
  echo is text-only; do not overlay echo content onto a read row — that leaked inline base64 and
  hid the durable refs. Pending drafts render from the client's blob cache until submit roots the
  attachment.
- Live user echoes carry no envelope `turnId` (they precede turn tracking); never bucket by it.
- **A parked view is frozen at its read — its content, not the session's state.** Browsing an
  earlier version reads toward that `leafTurnId` (`ConversationSeedSource.leafTurnId`) with
  `followLive: false`: the live stream's content belongs to the active lineage's run and must not
  fold into another version, and a graph change is the owner's business (the "continued
  elsewhere" chip), not a re-read. Session state (`status`, policy, model, effort, mode,
  capabilities, commands, models, usage) still folds from the live buffer, latest wins, no
  watermark — those events reach a client only live, so a store that skipped them would render the
  composer at defaults while parked. The caller decides
  `followLive` from the read the store holds — a leaf on, behind, or ahead of the host default
  follows; another version is frozen — never from view state, which runs ahead of the read by a
  round trip on every switch.
- **Edits and continues are explicit-parent submits** (`submitTurn(…, target)`): the daemon
  validates the parent and `expectedGraphRevision` and answers typed `conflict`/`busy`; the
  client never calls `history.branch` on a host that serves the graph and can fork.

`history-unavailable` read items become `ConversationItem`s of that kind under the current turn:
the prompt-only fallback for a lost, compacted, or never-recorded transcript.
