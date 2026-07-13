import type { AgentKind } from '@linkcode/schema';

/**
 * Adapters with a *verified* native image-input primitive in their installed SDK (or, for codex,
 * a live `codex app-server` probe — see `packages/agent-adapter/src/native/codex/adapter.ts`).
 * Static and hand-curated, like `AGENT_MODEL_OPTIONS` in `agent-models.ts`: only list an adapter
 * once its image path has actually been exercised, not from reading the SDK types alone.
 *
 *   claude-code  SDK's `MessageParam.content` accepts an `ImageBlockParam` array element
 *                (base64 jpeg/png/gif/webp) — see claude-code.ts's onPrompt.
 *   opencode     `session.promptAsync({parts})` already accepts a `FilePartInput` alongside
 *                the text part — see opencode.ts's onPrompt.
 *   pi           `session.prompt(text, {images: ImageContent[]})` is a near 1:1 match for our
 *                own schema's image block — see pi.ts's onPrompt.
 *   codex        no JS SDK; confirmed by sending a real turn/start with a solid-color probe
 *                image against a live app-server (0.144.1) and reading the model's answer back —
 *                see codex/adapter.ts's startTurn.
 */
export const AGENT_ATTACHMENT_SUPPORT: Partial<Record<AgentKind, true>> = {
  'claude-code': true,
  codex: true,
  opencode: true,
  pi: true,
};
