# Prompt interaction design QA

## Sources

- Question layout reference: `/var/folders/p9/6ggjwjj97ll8gtlfbmqftbl00000gn/T/codex-clipboard-45b08fc8-5951-451e-986b-42a14f99eca7.png`
- Permission layout reference: `/var/folders/p9/6ggjwjj97ll8gtlfbmqftbl00000gn/T/codex-clipboard-f07076c3-afba-47fb-9c7b-736fdf5ce460.png`
- Question implementation capture: `/private/tmp/code137-question-final.png`
- Permission implementation capture: `/private/tmp/code137-permission-final.png`
- Focused long-description capture: `/private/tmp/code137-question-long-tooltip.png`
- Desktop question capture: `/var/folders/p9/6ggjwjj97ll8gtlfbmqftbl00000gn/T/com.openai.sky.CUAService/Electron Screenshot 2026-07-16 at 5.39.26 PM.jpeg`
- Desktop focused-tooltip capture: `/var/folders/p9/6ggjwjj97ll8gtlfbmqftbl00000gn/T/com.openai.sky.CUAService/Electron Screenshot 2026-07-16 at 5.41.32 PM.jpeg`
- Desktop permission capture: `/var/folders/p9/6ggjwjj97ll8gtlfbmqftbl00000gn/T/com.openai.sky.CUAService/Electron Screenshot 2026-07-16 at 5.44.30 PM.jpeg`

## Comparison

The reference and implementation captures were inspected together. The implementation preserves the reference hierarchy and interaction model while using the existing coss-ui density, typography, color, radius, and control primitives:

- The question header keeps the title, compact pager, queued count, and dismiss action on one row.
- Options keep the shortcut, title, and single-line description together; only overflowing descriptions expose the full text in a tooltip.
- The custom answer remains the final option and enters editing only when explicitly activated.
- The permission prompt keeps persistent approval on the left and immediate reject/allow actions on the right, with the immediate allow action primary.
- Permission details remain fully inspectable rather than truncated.

Intentional differences from the references are the host application's narrower conversation column, coss-ui tokens, product wording, and the final-page-only atomic submit required by LinkCode's multi-question protocol.

## Interaction checks

- Verified pager navigation through all three questions.
- Verified number shortcuts select radio and multi-select options; modified, repeated, composing, editable-target, and responding key events are ignored.
- Verified the pager cannot advance without a valid current answer.
- Verified one final submit sends all answers atomically.
- Verified the long description tooltip appears on keyboard focus and short descriptions do not open an empty tooltip.
- Verified focusing the custom-answer affordance does not erase a structured answer.
- Verified permission requests render FIFO and resolve one at a time.
- Verified fresh browser reload produced no new warning or error console entries.
- Repeated the pager, number-shortcut, tooltip-focus, atomic-submit, permission-layout, and FIFO checks in the real Electron shell through Computer Use.

## Automated checks

- Targeted prompt/lifecycle suite: 109 tests passed.
- Question prompt suite after the final visual changes: 12 tests passed.
- `pnpm check:ci`: passed.
- `pnpm test`: 132 files and 1,024 tests passed. The sandboxed attempt could not bind loopback ports; the required unsandboxed rerun passed.

## Iterations

1. Restored the Codex-like pager and numeric navigation while retaining LinkCode's authoritative request lifecycle.
2. Replaced the oversized prompt chrome with coss-ui frame, button, form, pagination, keyboard-hint, tooltip, and alert-dialog primitives.
3. Constrained descriptions to one row and anchored the tooltip to the actual overflowing description region.
4. Corrected custom-answer focus behavior, permission action order, selected-row styling, persistent approval placement, and terminal request replay/deduplication.

## Result

Passed.
