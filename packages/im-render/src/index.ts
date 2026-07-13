/**
 * @linkcode/im-render — AgentEvent / ConversationItem → Markdown for IM Channel bridges.
 * Pure functions, no React, no platform APIs: the shared rendering base every bridge
 * (Telegram first) formats from. Platform specifics (MarkdownV2 escaping, message length
 * splitting, inline buttons) stay in the bridges.
 */

export {
  blockquote,
  capLines,
  contentBlockToMarkdown,
  contentToMarkdown,
  fence,
} from './blocks';
export type { RenderedItem, RenderedTurn, RenderOptions } from './render';
export {
  permissionMarkdown,
  planMarkdown,
  questionMarkdown,
  renderAgentEvents,
  renderConversation,
  renderItem,
  renderTurns,
  toolCallMarkdown,
} from './render';
