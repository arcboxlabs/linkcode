import type { AgentEvent, ContentBlock, PermissionOption, Plan, ToolCall } from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import { SHOWCASE_TERMINAL_ID } from './sessions';

export const SHOWCASE_PERMISSION_ID = 'mock-permission-edit';
export const SHOWCASE_PERMISSION_TOOL_ID = 'mock-tool-permission-edit';

const TRANSPARENT_PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

export const SHOWCASE_USER_CONTENT: ContentBlock[] = [
  textBlock('Show me every currently wired conversation surface.'),
];

export const SHOWCASE_THOUGHT_CONTENT = textBlock(
  'Planning a compact data-plane tour: plan, tools, permission, terminal, and media.',
);

export const SHOWCASE_INTRO_CONTENT = textBlock(
  'Here is a mocked transcript that uses the same wire events as the daemon.',
);

export const SHOWCASE_ARCHITECTURE_LINK: ContentBlock = {
  type: 'resource_link',
  uri: 'file:///mock/linkcode/docs/ARCHITECTURE.md',
  name: 'docs/ARCHITECTURE.md',
  mimeType: 'text/markdown',
  description: 'Architecture source of truth',
};

export const SHOWCASE_EMBEDDED_RESOURCE: ContentBlock = {
  type: 'resource',
  resource: {
    uri: 'mock://notes/showcase.md',
    text: '# Mock note\n\nThis embedded resource renders through `ContentBlockView`.',
    mimeType: 'text/markdown',
  },
};

export const SHOWCASE_IMAGE: ContentBlock = {
  type: 'image',
  data: TRANSPARENT_PIXEL,
  mimeType: 'image/png',
};

export const SHOWCASE_PLAN: Plan = {
  entries: [
    {
      content: 'Seed representative conversation events',
      priority: 'high',
      status: 'completed',
    },
    {
      content: 'Exercise tool bodies and permission UI',
      priority: 'high',
      status: 'in_progress',
    },
    { content: 'Finish with a live streamed reply', priority: 'medium', status: 'pending' },
  ],
};

export const SHOWCASE_PERMISSION_DIFF: Extract<ToolCall['content'][number], { type: 'diff' }> = {
  type: 'diff',
  path: 'packages/workbench/src/mock/dev-mock-transport.ts',
  oldText: "const coverage = 'thin';\n",
  newText: "const coverage = 'rich';\n",
};

export const SHOWCASE_PERMISSION_OPTIONS: PermissionOption[] = [
  { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
];

export const SHOWCASE_ERROR_EVENT: Extract<AgentEvent, { type: 'error' }> = {
  type: 'error',
  message: 'Recoverable mock diagnostic: preview service returned 503.',
  code: 'MOCK_PREVIEW_UNAVAILABLE',
  recoverable: true,
};

export const SHOWCASE_STREAM_THOUGHT_CONTENT = textBlock(
  'Now streaming the final answer so the composer and bubble shimmer have live data.',
);

export const SHOWCASE_STREAM_REPLY =
  'Streaming showcase complete: messages, reasoning, plans, tool bodies, diffs, terminal output, permissions, errors, and usage all came from the mock transport.';

export const SHOWCASE_TERMINAL_START_OUTPUT =
  '$ pnpm vitest run packages/workbench/src/mock\n✓ dev mock transport (4)\n';

export const SHOWCASE_TERMINAL_EXIT_OUTPUT = 'mock terminal stream finished\n';

export const SHOWCASE_PERMISSION_GRANTED_CONTENT = textBlock(
  'Permission granted; mock edit applied.',
);

export const SHOWCASE_PERMISSION_DENIED_CONTENT = textBlock(
  'Permission denied; mock edit skipped.',
);

export function createShowcaseToolSnapshots(terminalId = SHOWCASE_TERMINAL_ID): ToolCall[] {
  return [
    {
      toolCallId: 'mock-tool-read',
      title: 'Read architecture notes',
      kind: 'read',
      status: 'completed',
      locations: [{ path: 'docs/ARCHITECTURE.md', line: 1 }],
      content: [
        {
          type: 'content',
          content: textBlock('Read the architecture sections for data-plane boundaries.'),
        },
      ],
      rawInput: { path: 'docs/ARCHITECTURE.md' },
    },
    {
      toolCallId: 'mock-tool-search',
      title: 'Search chat renderers',
      kind: 'search',
      status: 'completed',
      content: [],
      rawInput: { query: 'permission-request|tool-call|plan' },
      rawOutput: {
        matches: [
          'packages/ui/src/chat/conversation-view.tsx',
          'packages/client-core/src/conversation.ts',
        ],
      },
    },
    {
      toolCallId: 'mock-tool-edit-diff',
      title: 'Preview renderer patch',
      kind: 'edit',
      status: 'completed',
      content: [
        {
          type: 'diff',
          path: 'packages/ui/src/chat/conversation-view.tsx',
          oldText: 'case "tool": return null;\n',
          newText: 'case "tool": return <ToolCallItem toolCall={item.toolCall} />;\n',
        },
      ],
    },
    {
      toolCallId: 'mock-tool-execute',
      title: 'Run focused mock test',
      kind: 'execute',
      status: 'completed',
      content: [{ type: 'terminal', terminalId }],
      rawInput: { command: 'pnpm vitest run packages/workbench/src/mock' },
    },
    {
      toolCallId: 'mock-tool-fetch',
      title: 'Fetch unavailable preview',
      kind: 'fetch',
      status: 'failed',
      content: [],
      rawInput: { url: 'https://mock.invalid/preview' },
      rawOutput: { status: 503, message: 'Mocked fetch failure for error-state coverage' },
    },
    {
      toolCallId: 'mock-tool-think',
      title: 'Summarize coverage',
      kind: 'think',
      status: 'completed',
      content: [
        { type: 'content', content: textBlock('Covered all currently schema-backed chat items.') },
      ],
    },
    {
      toolCallId: SHOWCASE_PERMISSION_TOOL_ID,
      title: 'Apply guarded edit',
      kind: 'edit',
      status: 'pending',
      content: [SHOWCASE_PERMISSION_DIFF],
      rawInput: { path: SHOWCASE_PERMISSION_DIFF.path },
    },
  ];
}
