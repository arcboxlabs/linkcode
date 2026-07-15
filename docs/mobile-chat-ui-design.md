# Mobile Conversation UI — Preliminary Design

Status: **draft for review**. Synthesized from a deep-read of three sources, then hardened by a four-lens adversarial review (data contracts · RN/Expo feasibility · architecture rules · design fidelity) against the actual code; every claim below survived or was corrected by that pass.

1. **Paseo** (`~/Developer/paseo`, `packages/app`) — a mature Expo/RN coding-agent chat client; source of proven *mobile mechanics* (list strategy, bottom sheets, keyboard patterns).
2. **LinkCode Desktop** (`packages/ui/src/chat/**`, `src/shell/**`) — source of the *design language* the mobile UI must feel continuous with.
3. **LinkCode contracts** (`packages/schema`, `packages/client-core`) — the data model; mobile already consumes `ConversationItem[]` via `useConversation` (`apps/mobile/src/components/conversation-timeline.tsx`).

Scope: the conversation screen (`/host/[hostId]/session/[sessionId]`), its composer, and the approval/question interaction. Session-inbox polish only where the conversation UI needs it. Out of scope: terminal view, git/diff review surface, voice input, session forking/rewind.

---

## 1. Design-language translation: Desktop → Mobile

Desktop's personality (from the `packages/ui` deep-read) is deliberate and must survive the port:

| Principle (desktop) | Mobile translation |
| --- | --- |
| **Monochrome-first; color = status only** (no brand hue in semantic tokens; green/red/amber/blue reserved for diff counts, status dots, failures) | Use HeroUI Native's neutral `background/foreground/muted` tokens as-is; never introduce an accent-colored primary for chat chrome. Color appears only in: status dots, diff `+/−` counters, destructive/failed text, warning shield. |
| **Text-row density over card sprawl** (tool calls are `py-1` text rows; cards only for diffs/terminal/prompts) | Same: tool calls are single-line rows, not cards. Card chrome in the always-visible conversation column is reserved for prompt-dock cards alone; diff/terminal bodies live in the on-demand tool-detail sheet, attachment pills in the composer tray. Mobile rows get ≥44pt hit areas but keep one-line visual weight. |
| **Failure reads via color, never an ✗ icon** (explicit rule in `tool.tsx` / `activity-group.tsx`) | Identical rule. A failed tool call keeps its kind icon, recolored `danger`. |
| **Progressive disclosure; streaming items force-open, then hand control back** | Collapsed-by-default rows; tool detail opens a bottom sheet (§4.3). Thinking/plan expand in place. |
| **The composer is the one "soft" surface** (`rounded-2xl`, blooms/collapses) | The mobile composer is the largest-radius element on screen (`rounded-2xl`). |
| **User bubble asymmetric corner** (`rounded-2xl rounded-br`) | Same corner truncation, right-aligned, `max-w` ~85%. |
| **Assistant text has no bubble** — full-width plain markdown | Same. |
| IBM Plex Sans / IBM Plex Mono | M1 ships system fonts (RN default + platform `ui-monospace`/`monospace` for code/paths — mandatory from M1). IBM Plex via `expo-font` is an M3 polish decision. |

**Icons**: introduce `lucide-react-native` (pure JS over `react-native-svg`, already a dep; Expo Go-safe; current releases support React 19 + svg 15). Mirrors desktop's `lucide-react`, so the tool-kind glyph map ports 1:1: read=`FileText`, edit=`Pencil`, delete=`Trash2`, move=`FileOutput`, search=`Search`, execute=`Terminal`, think=`Brain`, fetch=`Globe`, task=`Bot`, other=`Wrench`. Inline glyphs 14–16px; touch targets padded to ≥44pt. The icon `Record` is defined **per platform** (web keeps its `lucide-react` map in `tool-utils.ts`; native gets its own `lucide-react-native` map) — icons are deliberately *not* part of the shared-logic promotion in §5.

**Agent brand glyphs**: desktop uses `@proj-airi/lobe-icons` through `unplugin-icons` (a web-only pipeline). M1 renders the `AgentIcon` fallback style — initials in a quiet chip ("CC", "CX", "OC", "PI"), `ghost`-variant equivalent. Hand-ported brand SVGs (via `react-native-svg`) are M3.

**Status dot map** — an explicit *adaptation*, not a 1:1 port: HeroUI Native's token set has no `info` or `muted-foreground` equivalents (desktop uses `bg-info` / `bg-muted-foreground/40|25` in `thread-row.tsx`), so mobile substitutes: `starting`→`accent`, `idle`→`muted/40`, `running`→`success`, `awaiting-input`→`warning`, `stopped`→`muted/25`. Used in inbox rows and the conversation header.

**Theming — decided 2026-07-15: ship light + dark with an in-app switcher (M1).** All styling goes through semantic tokens (both palettes come from `heroui-native/styles`; uniwind's generated types already declare `themes: ['light', 'dark']`). Implementation:
- `app.json` `userInterfaceStyle` flips `"light"` → `"automatic"` so the OS reports the real color scheme.
- Switching uses uniwind's built-in API — `Uniwind.setTheme('light' | 'dark' | 'system')` (verified in `uniwind/dist/module/core/config/config.common.d.ts`; `'system'` follows the OS adaptively; `useUniwind()` reads the active theme, e.g. to drive `StatusBar` style).
- Preference (`'system' | 'light' | 'dark'`, default `'system'`) persists in a small `zodPersist` settings store beside `host-store.ts`, applied once at root-layout mount and on change.
- Settings screen gains an **Appearance** row (System / Light / Dark) — mirroring the appearance tab that just landed on desktop/webview.
- Cost acknowledged: every conversation component's definition-of-done includes a visual check in both themes.

**Copy**: all strings via `@linkcode/i18n` `mobile.*` namespaces (en + zh-CN). Product copy says **Thread**; code and wire keep `session` (repo terminology rule).

**Accessibility** (applies to every component below): every icon-only control (kebab, send/stop morph, scroll-to-bottom, `+` menu, prompt choice rows) carries `accessibilityLabel` + `accessibilityRole` from i18n; text respects Dynamic Type via RN's default `allowFontScaling` (bespoke `text-[Npx]` sizes scale with it; layout must tolerate up to ~1.4×); mono/diff/terminal content caps scaling at `maxFontSizeMultiplier={1.2}` and scrolls horizontally rather than reflowing; status conveyed by color (dots, failed rows) always has a text/VoiceOver counterpart (e.g. label "failed").

---

## 2. What we take from Paseo — and what we deliberately don't

**Adopt (proven mobile mechanics, one flagged for verification):**

- **Inverted `FlatList`** for the timeline: newest at index 0, `maintainVisibleContentPosition`, tuned `initialNumToRender`/`windowSize` (Paseo `strategy-native.tsx`). ⚠️ **M1 spike required before commitment**: Paseo's track record is on Expo SDK 54 / RN 0.81 (Paper-compatible), while LinkCode mobile is unconditionally on the New Architecture (SDK 57 / RN 0.86 — no opt-out exists). There are open Fabric issues around `maintainVisibleContentPosition` under fast prepends and around Reanimated views adjacent to inverted lists. The spike prototypes the list + floating button under realistic streaming intervals; fallbacks if it misbehaves: batch live-head flushes (~80ms), non-Reanimated fade for the button, or a non-inverted list with manual bottom anchoring (Paseo's web strategy, portable).
- **Scroll-to-bottom floating button** fading in when the user scrolls off the live edge.
- **Bottom sheet for tool-call detail** (Paseo `tool-call-sheet.tsx`, snap points 60%/95%) — `@gorhom/bottom-sheet@^5.2.14` is already a dependency and is compatible with reanimated 4.5 / gesture-handler 2.32. Inline expansion inside an inverted list is layout-shift-prone; a sheet keeps the transcript stable and gives diffs real estate. **M1 task**: mount `BottomSheetModalProvider` in the root layout (`src/app/_layout.tsx`, inside `GestureHandlerRootView`); every sheet in this design (tool detail now; `+` menu, command list, mention search, pickers in M2) is a `BottomSheetModal` against that one provider — verify stacking order once two can coexist.
- **Split live head from settled history** so token flushes only re-render the in-flight item; settled rows are memoized by item reference (cheap for us — `ConversationItem[]` is replace-by-identity).
- **Status-bucket thinking**: one canonical status→color map feeding every surface.
- **IME guard on send**: CJK composition must never trigger send — send is button-only, no `onSubmitEditing` submit, `blurOnSubmit={false}`.

**Reject / defer (with reasons):**

- **Paseo's workbench shell** (tabs/panes/workspace deck) — LinkCode mobile is a focused chat client over a stack navigator.
- **Elaborate shimmer** (MaskedView+SVG+reanimated) — a simple opacity pulse on the running row's title communicates the same.
- **Inline permission cards in the timeline** — LinkCode desktop's **prompt dock** (fixed, above the composer) is the house pattern and is better on mobile: the actionable thing is always at your thumb, never scrolled away.
- **Message queueing while running** — desktop doesn't have it; out of scope. Send morphs to Stop.
- **Voice, GitHub attachments, fork/rewind** — not in the contract; out of scope.

---

## 3. Information architecture

Navigation stays the existing expo-router stack. Two screens change:

```
/host/[hostId]              — Threads inbox (M2 row upgrade; existing new-thread form stays)
/host/[hostId]/session/[id] — Conversation screen (this design, M1)
```

**Inbox row anatomy** (M2 — desktop `ThreadRow` aligned, enriched for mobile):

```
[AgentIcon chip ⊙status-dot]  Title (1 line, truncate)              12:40
                              cwd basename · last-message preview…
```

Reality check from review: `session.list` (`SessionInfo`) carries **no message content** — desktop's preview-less rows are a data constraint, not just a density choice. The M2 preview line therefore renders only for sessions whose transcript is already cached client-side (opened this app-run, or from the M3 persisted seed cache), from the last `message` item via client-core's `contentPreview(blocks)`; other rows show `cwd basename` + status text only. A per-row `history.read` sweep is explicitly rejected (N× round-trips over the tunnel). Relative timestamp comes from `SessionInfo.updatedAt`.

---

## 4. Conversation screen

### 4.0 Layout skeleton

```
┌──────────────────────────────────────┐
│ ‹  [CC⊙] Fix composer drag bug   ⋯   │  header (safe-area top)
├──────────────────────────────────────┤
│   ┌────────────────────────────┐(R)  │  user bubble, right
│   │ 帮我修一下 composer 的拖拽  │     │
│   └────────────────────────────┘     │
│                                      │
│  ⏺ Thought · 12s                  ›  │  thinking row (collapsed)
│  ⌕ Searched composer drag        ›   │  tool rows (py-1 density)
│  ✎ composer.tsx        +24 −3    ›   │
│  ◌ pnpm test composer                │  ← spinner icon, title pulses
│                                      │
│  Assistant markdown text, full       │  assistant: no bubble
│  width, no bubble…                   │
│                            [ ↓ ]     │  scroll-to-bottom (floating)
├──────────────────────────────────────┤
│ ┌ Allow "Edit composer.tsx"? ──────┐ │  prompt dock (when pending)
│ │ ① Allow once   ② Always  ③ Deny  │ │
│ └──────────────────────────────────┘ │
│ ┌ Step 2/5 · Wire drop handler    ›┐ │  plan tracker (collapsed)
├──────────────────────────────────────┤
│ ╭──────────────────────────────────╮ │
│ │ ＋  Message Claude Code…      ⬆ │ │  composer (rounded-2xl)
│ ╰──────────────────────────────────╯ │  (safe-area bottom)
└──────────────────────────────────────┘
```

### 4.1 Header

Back chevron (lucide `ChevronLeft`, replacing the literal `‹`), `AgentIcon` with status dot, session title (fallback: `{Agent} in {cwd basename}` — desktop's `repositoryLabel` rule), kebab menu (`Ellipsis`): Stop thread / Copy thread ID / (later: model & effort info). `SessionStatusChip` leaves the header (dot carries status); the chip stays in the inbox.

### 4.2 Timeline (list mechanics)

- **Inverted `FlatList`** over `conversation.items` reversed (pending the §2 Fabric spike); `keyExtractor` = item identity (`id`/`toolCallId`/`requestId`/`compactionId`). `maintainVisibleContentPosition={{ minIndexForVisible: 0 }}`, `initialNumToRender≈30`, `removeClippedSubviews={false}`.
- **Scroll-to-bottom button**: 44pt circle, `ChevronDown`, bottom-right above the dock, fades when >1 viewport from the live edge (plain `Animated`/opacity if the spike shows Reanimated+inverted-list issues).
- **History seeding (required for usefulness)**: `useConversation(sessionId)` alone only shows live events — a reopened thread renders empty. M1 adds a mobile hook mirroring workbench's `useSeededConversation` *logic* (ported, not imported — the workbench implementation is SWR/tayori-tied): page `client.readHistory(kind, { historyId, cursor })` to the end, build `ConversationSeed { events, uptoSeq }`, pass to `useConversation(sessionId, seed)`. Persisted seed cache is M3.
- **Attach on focus**: call `client.attachSession(sessionId)` on screen focus — the daemon re-broadcasts open asks to late attachers; without it a killed-and-reopened app misses pending approvals (the builder de-dups replayed asks by `requestId`). There is **no detach call**: client-core has no `detachSession` method, and the engine's `session.detach` handler is a no-op while our subscription mode stays the default `'all'` — narrowing to `'attached'` (plus a real detach) is the future bandwidth optimization noted in §9.
- **Auto-resume on open**: desktop already auto-resumes a stopped session the moment it's selected (`use-workbench-sessions.ts` `applySelection`). Mobile matches: navigating into a `stopped` session fires `resumeSession(sessionId)` silently; a slim "Resuming…" state shows on the status dot only. No manual "Resume" button.

### 4.3 Per-item rendering

| `ConversationItem.kind` | Treatment |
| --- | --- |
| `message` role=user | Right-aligned bubble: neutral wash token, `rounded-2xl` with squared bottom-right, `max-w [85%]`, 15px text. >20 lines clamps with "Show more". Image blocks render as rounded thumbnails above the text (tap → full-screen viewer, M2). **Long-press → context menu: Copy text** (`expo-clipboard`). |
| `message` role=assistant | No bubble. Full-width markdown via **`@ronradtke/react-native-markdown-display`** (maintained fork, Jan 2025 — the original is unmaintained since 2023 and Paseo carries local patches over it; budget a thin RenderRules wrapper): tight paragraph rhythm, mono inline code on muted bg, fenced code in a bordered `rounded-lg` horizontally-scrollable block, platform mono. Syntax highlighting deferred (M3; Paseo's CodeMirror-grammar tokenizer is the reference). Streaming: last block re-renders per chunk; subtle ▍ caret while `isStreaming`. **Long-press → Copy text** (desktop's turn-copy is always-visible, not hover-gated — mobile must not drop it). |
| `reasoning` | Collapsed row: `Brain` glyph + "Thought" + first-line preview, muted. Title pulses (opacity) while streaming; forced open while streaming, user toggle after. Expanded: `border-l-2 pl-3` indented italic — desktop's exact treatment. |
| `tool` | **One-line row** (desktop `ToolCallItem` anatomy): `[kind icon] [title truncate] [· summary muted truncate] [+N −N] [›]`. Icon swaps to spinner while `in_progress` (title pulses); `danger` recolor on `failed` (no ✗). Summary = curated string per kind (command / path / query / URL) via the shared `toolCallSummary` port (§5). Chevron only when a body exists. **Tap → bottom sheet** (60%/95%): metadata chips, then diff blocks (add=`success/10` bg, del=`danger/10`, mono, `+/−` gutter, per-file path header + counters — LCS diff from the shared `diff-utils` port, §5), terminal/text output, failure message. **Terminal output**: desktop's `ansi-to-react` is DOM-only — M1 strips ANSI escapes and renders plain mono; M2 adds color via a pure tokenizer (`anser`-style) mapped to styled RN `<Text>` runs (§5/§6). Consecutive tool rows tighten vertical gap (Paseo `toolSequence` spacing); desktop's activity-group *bucketing* is M2, via the promoted `activity-groups` logic (§5). |
| `plan` | Not rendered inline. Surfaces as the **plan tracker** pinned in the dock area (§4.4). |
| `approval` / `question` | **Resolved asks render nothing** — matching desktop exactly: an accepted (or declined-but-already-snapshotted) approval leaves no receipt (`conversation-view.tsx` returns `null`; "Accepted / pending asks leave no receipt"); the one rendered case is declined-and-never-snapshotted → a full tool row recolored `danger`. Resolved questions never leave a trace. Note: desktop's "declined" detection is ephemeral per-client state (a `useState` map in `workbench.tsx`); mobile mirrors that limitation — after kill-and-reopen, a declined-unsnapshotted ask simply doesn't render, which is acceptable and identical to a desktop remount. Live asks surface only in the **prompt dock**. |
| `compaction` | Divider row: `FoldVertical` glyph + "Context compacted" + `193.4k → 5.0k tokens`, hairline rule filling the row. |
| `error` | Alert row: `TriangleAlert` + message + `(CODE)`; stronger danger border when `recoverable: false`. |

Subagent narration (`parentToolCallId`) renders indented under its `task` row in M1 (flat, `border-l-2 pl-3`); a nested viewer is M3.

### 4.4 Prompt dock (approvals · questions · plan)

Position: between timeline and composer; `rounded-xl` bordered cards — the only card chrome in the always-visible conversation column, matching desktop's `ConversationPromptAlert` frame.

- **One prompt at a time**, desktop's priority model: first pending item wins; a question is a hard boundary; multiple pending permissions page with `‹ 1/3 ›` in the card header.
- **Permission prompt**: title *Allow "{tool title}"?* + kind badge; detail rows (file path / command / URL, mono); for `other` kind, raw JSON args in a scrollable mono box (the deliberate exception — the user must see what they approve). Numbered choice rows (① ② ③), full-width, single tap submits `respondPermission(sessionId, requestId, { outcome: 'selected', optionId })`; deny options tint `danger`; skip (✕) sends `{ outcome: 'cancelled' }`. Tapped row shows a spinner and the card disables while in flight.
- **Question prompt**: `Question[]` batch pages within the card (`Next` → `Submit answers`); radio vs checkbox per `multiSelect`; optional free-text "Other" row per question; single-select auto-advances. Resolves as one `QuestionOutcome` (`answered` + `QuestionAnswer[]`, or `cancelled`).
- **Plan tracker**: collapsed `Step N/M · current entry` with a circular progress ring, below any active prompt (desktop `StepPromptRow`); expands in place (`○` pending / spinner `in_progress` / `✓` completed, strikethrough).
- Haptics: `expo-haptics` light impact on approve/deny/submit.

### 4.5 Composer

```
[staged attachment pills row]            ← M2, only when present
╭─────────────────────────────────────╮
│ ＋   auto-growing TextInput      ⬆/■ │   rounded-2xl frame
╰─────────────────────────────────────╯
```

- **Input**: HeroUI-styled multiline `TextInput`, 1 row min, ~6 rows max then internal scroll. Placeholder: *"Message {agent}…"* (i18n). Send is button-only (IME safety); Enter inserts newline.
- **Send/Stop morph**: round button; idle+text → `ArrowUp` (send = `useSendInput(sessionId)` invoked with `{ type: 'prompt', content: [{ type: 'text', text }] }` — the hook wraps `client.send`, equivalent to `client.prompt`); running → `Square` (stop = `cancel(sessionId)`); idle+empty → disabled. Optimistic clear on send; on `request.failed`, restore the text **and** show an error toast (silent restoration reads as a glitch).
- **Keyboard avoidance** (locked pairing): keep Android's default `softwareKeyboardLayoutMode: 'resize'` (no `app.json` change) and use `KeyboardAvoidingView` with `behavior="padding"` on iOS, `behavior={undefined}` on Android — per Expo guidance; `height`-on-Android over resize mode is a known-bad combination for bottom-pinned composers. `react-native-keyboard-controller` (Paseo's choice) requires a dev build — deferred with §9.5.
- **`＋` menu** (M2): `BottomSheetModal` — Photo library (`expo-image-picker`), **Camera** (capture — a mobile-first win Paseo lacks), File (`expo-document-picker`). Staged attachments render as desktop-style pills (56pt thumbnails, ✕ remove, error badge) above the input. Validation from schema constants: `SUPPORTED_ATTACHMENT_IMAGE_MIME_TYPES`, `MAX_ATTACHMENT_BYTES` (8 MiB), `MAX_ATTACHMENT_TOTAL_BYTES` (12 MiB); attach as `{ type: 'image', data: base64, mimeType }` blocks in the same `content` array — no separate upload channel exists or is needed.
- **Slash commands** (M2): `/` at token start opens a sheet listing the view-model's `availableCommands` (name + description + argumentHint); selection inserts or sends `{ type: 'command', name }`.
- **@-mentions** (M2): `@` trigger → sheet with file search backed by the `file.suggest` operation (`cwd` must be a registered workspace root). Insert as quoted path (desktop convention — portable across agents). The debounce/generation *pattern* from `workbench/files/mentions.ts` is **ported, not imported** — that file is a tayori/`useData` hook (workbench is desktop/webview-scoped; mobile doesn't depend on it); mobile reimplements the state machine over its own client call, checking `foxact`/`foxts` first for the debounce primitive.
- **Model/effort/approval-policy controls** (M2): compact chips in a footer row inside the frame (shield = approval policy; model name), each opening a `BottomSheetModal` picker driven by `approvalPolicy.availablePolicies`/`currentPolicyId` from the view-model and the `setModel`/`setEffort`/`setApprovalPolicy` client methods. Server-reflected only — no optimistic flip (desktop rule).

### 4.6 Empty / edge states

- **New/empty thread**: centered `EmptyState` (existing native component) + composer focused.
- **Stopped session**: auto-resumed on open (§4.2) — no manual gate.
- **Disconnected**: the existing `HostConnection` gate covers cold connects; mid-conversation drops show a slim "Reconnecting…" banner under the header.
- **Awaiting-input awareness**: while the app is alive (foreground or briefly backgrounded with the socket open), `SessionNotification` broadcasts drive in-app banners/local notifications for *non-focused* sessions (M3, mirroring workbench's suppression logic minus `document.hasFocus`). True backgrounded/killed-app delivery requires remote push through the Server tunnel — undecided `linkcodehq`-side work, blocked on §9.3; it is **not** achievable in this repo alone and is not an M3 item.

---

## 5. Component inventory & placement

Per the `packages/ui` boundary rule (native subpath = pure presentation, view-models + callbacks, no client-core/routing):

**`packages/ui/src/native/chat/`** (new, shared presentation):
`conversation-list.tsx`, `user-message.tsx`, `assistant-message.tsx`, `reasoning-row.tsx`, `tool-row.tsx`, `tool-detail-sheet.tsx`, `diff-block.tsx`, `terminal-block.tsx`, `compaction-row.tsx`, `error-row.tsx`, `prompt-dock.tsx` (+ `permission-prompt.tsx`, `question-prompt.tsx`, `plan-tracker.tsx`), `composer.tsx`, `attachment-pills.tsx`, `agent-icon.tsx`, `status-dot.tsx`.

**Shared platform-neutral logic — locked location: `packages/common`, new scoped export `@linkcode/common/chat`** (pure schema-derived functions; no React, no DOM, no icons — `common` already depends on `@linkcode/schema`, and neither `packages/ui` (two platform halves only, per its AGENTS.md and export map) nor `packages/workbench` (desktop/webview data-plane runtime; mobile doesn't depend on it) is a sanctioned home). Moved from `packages/ui/src/chat/**` with the web half re-importing:
- `toolCallSummary` / `toolCallMetadata` / `hasToolBody` string+predicate logic (from `tool-utils.ts` — the lucide icon `Record` stays per-platform, §1);
- `activity-groups.ts` bucketing (`groupTimeline`, M2);
- `diff-utils.ts` (the pure LCS line diff — do not re-derive it);
- (M2) an ANSI-escape tokenizer for terminal output (strip-only helper lands M1).

**`apps/mobile/src/`** (wiring):
`hooks/use-seeded-conversation.ts` (history paging → seed), `hooks/use-conversation-actions.ts` (send/stop/respond wrappers over client-core), screen composition in `app/host/[hostId]/session/[sessionId].tsx`. Existing `ConversationTimeline` is superseded — replaced by the shared components as part of this change, not left as a stub.

---

## 6. New dependencies (Expo Go-compatible, SDK 57-pinned via `expo install`)

| Dep | Milestone | Why | Risk |
| --- | --- | --- | --- |
| `lucide-react-native` | M1 | Icon set mirroring desktop | Pure JS over existing `react-native-svg`; React 19-compatible |
| `@ronradtke/react-native-markdown-display` | M1 | Assistant markdown (maintained fork; original is 2023-stale and Paseo patches it) | Pure JS, markdown-it based; budget a RenderRules wrapper |
| `expo-clipboard` | M1 | Long-press copy | Expo module, in Go |
| `expo-haptics` | M1 | Approve/deny/send feedback | Expo module, in Go |
| `expo-image-picker` | M2 | Photo library + camera | In Go — but note: the `app.json` permission strings only compile into dev/standalone builds; Expo Go testing shows Expo Go's own generic permission copy |
| `expo-document-picker` | M2 | File attachments | Same note |

Explicitly **not** added: `react-native-keyboard-controller` (dev-build only), `@shopify/flash-list` (plain FlatList suffices at Paseo-verified scale), NativeWind (forbidden), gesture-handler 3.x (HeroUI peer pin).

---

## 7. Phasing

- **M1 — a usable conversation**: Fabric list spike (§2) → header, seeded timeline (all item kinds readable; tool sheet with diff + ANSI-stripped terminal text), prompt dock (permissions + questions interactive), plan tracker, composer (text send / stop / failure toast), auto-resume, attach-on-focus, long-press copy, `BottomSheetModalProvider` mount, **theme unlock + Appearance switcher (§1)**, accessibility labels, i18n (en + zh-CN), status-dot map. *Definition of done: drive a full Claude Code turn — prompt → tool approval → diff review → reply — from the phone against a real daemon, in both themes.*
- **M2 — parity affordances**: attachments (library + camera + files, schema-validated), slash commands, @-mentions, model/effort/approval-policy chips, activity grouping, ANSI color, inbox preview rows (cached-transcript scope, §3).
- **M3 — polish**: in-app/local notifications (alive-socket scope, §4.6), persisted seed cache, brand SVG glyphs, IBM Plex option, syntax highlighting, subagent viewer.

Each milestone lands as its own Linear issue/branch per repo process.

---

## 8. Paseo attribution summary

Adopted: inverted-FlatList strategy (spike-gated on Fabric), bottom-sheet tool details, live-head/settled-history render split, scroll-to-bottom affordance, status-bucket color discipline, IME-safe send. Improved on: camera capture in the attachment flow (absent in Paseo), haptics on conversation actions (unused in Paseo), simpler running-state pulse instead of the two-platform shimmer. Rejected: workbench tab/pane shell, inline permission cards (LinkCode's dock wins), message queueing, dual voice systems.

---

## 9. Decisions & open questions

**Decided 2026-07-15:**

- **Theming**: keep both color schemes and implement in-app switching (System / Light / Dark) — spec in §1, lands in M1.
- **Multi-agent**: the initial release assumes one agent per session, switched via the inbox; no multi-agent chrome. (The broader "concurrent vs switched" product question remains an ARCHITECTURE.md open question for future work — this decision only confirms the conversation UI does not wait on it.)

**Still open (raise, do not answer unilaterally):**

1. **Server/tunnel semantics** (an ARCHITECTURE.md open question): remote push notifications, offline queueing, and tunnel auth hardening are undecided Server-side (`linkcodehq`) work; §4.6's notification scope is bounded by this.
2. **Subscription narrowing**: should mobile eventually run `subscription.set { mode: 'attached' }` (plus a real client-side `detachSession`) to save tunnel bandwidth, accepting the inbox then needs a notification-driven status refresh? (Today the engine's `session.detach` is a no-op and client-core exposes no detach method.)
3. **Expo Go → dev build**: `react-native-keyboard-controller`, real permission-string copy, and push notifications all require leaving Expo Go. When does the project take that step?
