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

export const SHOWCASE_ARTIFACTS_CONTENT = textBlock(
  [
    'Inline artifacts render fenced diagrams in place — click an element to reference it:',
    '',
    '```mermaid',
    'graph TD',
    '  Composer[Composer draft] --> Detector{Fence detector}',
    '  Detector -->|mermaid / svg| Inline[Inline artifact]',
    '  Detector -->|other| Code[Shiki code block]',
    '```',
    '',
    '```svg',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60" width="200" height="60">',
    '  <rect x="4" y="4" width="192" height="52" rx="8" fill="#6366f1" opacity="0.2" />',
    '  <text x="100" y="36" text-anchor="middle" font-size="14" fill="currentColor">Sanitized svg artifact</text>',
    '</svg>',
    '```',
  ].join('\n'),
);

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

const SHOWCASE_PERMISSION_EDIT_TOOL: ToolCall = {
  toolCallId: SHOWCASE_PERMISSION_TOOL_ID,
  title: 'Apply guarded edit',
  kind: 'edit',
  status: 'pending',
  content: [SHOWCASE_PERMISSION_DIFF],
  rawInput: { path: SHOWCASE_PERMISSION_DIFF.path },
};

const SHOWCASE_PERMISSION_EXEC_TOOL: ToolCall = {
  toolCallId: 'mock-tool-permission-exec',
  title: 'Run database migration',
  kind: 'execute',
  status: 'pending',
  content: [],
  rawInput: { command: 'pnpm run migrate -- --env=dev' },
};

export interface ShowcasePermission {
  requestId: string;
  toolCall: ToolCall;
  options: PermissionOption[];
}

/** Two pending asks with different kinds, so the dock's badge/details and pager are exercisable. */
export const SHOWCASE_PERMISSIONS: ShowcasePermission[] = [
  {
    requestId: SHOWCASE_PERMISSION_ID,
    toolCall: SHOWCASE_PERMISSION_EDIT_TOOL,
    options: SHOWCASE_PERMISSION_OPTIONS,
  },
  {
    requestId: 'mock-permission-exec',
    toolCall: SHOWCASE_PERMISSION_EXEC_TOOL,
    options: SHOWCASE_PERMISSION_OPTIONS,
  },
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

export const SHOWCASE_SCRIPT_START_DELAY_MS = 600;
export const SHOWCASE_SCRIPT_STEP_LATENCY_MS = 180;
export const SHOWCASE_STREAM_START_DELAY_MS = 1000;
export const SHOWCASE_STREAM_CHUNK_LATENCY_MS = 220;

export const SHOWCASE_TERMINAL_START_OUTPUT =
  '$ pnpm vitest run packages/workbench/src/mock\n✓ dev mock transport (4)\n';

export const SHOWCASE_TERMINAL_EXIT_OUTPUT = 'mock terminal stream finished\n';

export const SHOWCASE_PERMISSION_GRANTED_CONTENT = textBlock(
  'Permission granted; mock action applied.',
);

export const SHOWCASE_PERMISSION_DENIED_CONTENT = textBlock(
  'Permission denied; mock action skipped.',
);

export const SHOWCASE_EXPLORE_NARRATION = textBlock(
  'The renderer sources are mapped; patching the conversation surfaces next.',
);

export const SHOWCASE_FILES_NARRATION = textBlock(
  'Renderer patches are in; running the focused checks to confirm nothing regressed.',
);

export const SHOWCASE_COMMANDS_NARRATION = textBlock(
  'Typecheck flagged a stale preview import, so a last pass double-checks the preview and coverage.',
);

export interface ShowcaseToolBursts {
  /** Contiguous read/search calls — renders as an "Explored" group. */
  explore: ToolCall[];
  /** Contiguous edit/delete calls with diffs — renders as an "Edited files" group with summed +/-. */
  files: ToolCall[];
  /** Contiguous execute calls (one failed) — renders as a "Ran commands" group. */
  commands: ToolCall[];
  /** Trailing singletons: failed fetch, think, and the permission-gated edit. */
  wrapUp: ToolCall[];
}

export function createShowcaseToolBursts(terminalId = SHOWCASE_TERMINAL_ID): ShowcaseToolBursts {
  return {
    explore: [
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
    ],
    files: [
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
        toolCallId: 'mock-tool-edit-markdown',
        title: 'Patch markdown styles',
        kind: 'edit',
        status: 'completed',
        content: [
          {
            type: 'diff',
            path: 'packages/ui/src/chat/markdown.tsx',
            oldText: "const tone = 'chat';\n",
            newText: "const tone = 'coss';\nconst scale = 'text-sm';\n",
          },
        ],
      },
      {
        toolCallId: 'mock-tool-delete-legacy',
        title: 'Retire legacy timeline row',
        kind: 'delete',
        status: 'completed',
        content: [
          {
            type: 'diff',
            path: 'packages/ui/src/chat/legacy-row.tsx',
            oldText: 'export function LegacyRow() {\n  return null;\n}\n',
            newText: '',
          },
        ],
      },
    ],
    commands: [
      {
        toolCallId: 'mock-tool-execute',
        title: 'Run focused mock test',
        kind: 'execute',
        status: 'completed',
        content: [{ type: 'terminal', terminalId }],
        rawInput: { command: 'pnpm vitest run packages/workbench/src/mock' },
      },
      {
        toolCallId: 'mock-tool-execute-lint',
        title: 'Run lint',
        kind: 'execute',
        status: 'completed',
        content: [],
        rawInput: { command: 'pnpm lint' },
      },
      {
        toolCallId: 'mock-tool-execute-typecheck',
        title: 'Run typecheck',
        kind: 'execute',
        status: 'failed',
        content: [],
        rawInput: { command: 'pnpm typecheck' },
        rawOutput: { exitCode: 1, message: 'stale preview import' },
      },
    ],
    wrapUp: [
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
          {
            type: 'content',
            content: textBlock('Covered all currently schema-backed chat items.'),
          },
        ],
      },
      ...SHOWCASE_PERMISSIONS.map((permission) => permission.toolCall),
    ],
  };
}
