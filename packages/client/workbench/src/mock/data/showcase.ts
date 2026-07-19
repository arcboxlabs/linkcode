import type { AgentEvent, ContentBlock, PermissionOption, Plan, ToolCall } from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import { SHOWCASE_TERMINAL_ID } from './sessions';

export const SHOWCASE_PERMISSION_ID = 'mock-permission-edit';
export const SHOWCASE_PERMISSION_TOOL_ID = 'mock-tool-permission-edit';
export const SHOWCASE_QUESTION_ID = 'mock-question-batch';
export const SHOWCASE_QUESTION_TOOL_ID = 'mock-tool-question-batch';

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
    '',
    'Self-contained HTML previews in a sandboxed iframe on its own origin:',
    '',
    '```html',
    '<!doctype html>',
    '<html><body style="font-family: sans-serif; padding: 2rem">',
    '  <h1 id="t">Sandboxed artifact</h1>',
    "  <button onclick=\"document.querySelector('#t').textContent = 'clicked!'\">Click me</button>",
    '</body></html>',
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
  path: 'packages/client/workbench/src/mock/dev-mock-transport.ts',
  oldText: "const coverage = 'thin';\n",
  newText: "const coverage = 'rich';\n",
};

export const SHOWCASE_PERMISSION_OPTIONS: PermissionOption[] = [
  { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
];

export const SHOWCASE_QUESTION = {
  type: 'question-request',
  requestId: SHOWCASE_QUESTION_ID,
  toolCall: {
    toolCallId: SHOWCASE_QUESTION_TOOL_ID,
    title: 'Request user input',
    kind: 'other',
    status: 'pending',
    content: [],
  },
  questions: [
    {
      questionId: 'scope',
      prompt: 'How broad should the change be?',
      header: 'Scope',
      multiSelect: false,
      options: [
        { optionId: 'focused', label: 'Focused', description: 'Only the requested behavior.' },
        {
          optionId: 'broad',
          label: 'Broad',
          description:
            'Include adjacent cleanup across the touched interaction flow, consolidate duplicated state handling, and update related tests when those changes materially improve consistency without broadening the requested product behavior.',
        },
      ],
    },
    {
      questionId: 'checks',
      prompt: 'Which checks should run?',
      header: 'Checks',
      multiSelect: true,
      options: [
        { optionId: 'targeted', label: 'Targeted tests' },
        { optionId: 'full', label: 'Full suite' },
      ],
    },
    {
      questionId: 'handoff',
      prompt: 'How should the result be handed off?',
      header: 'Handoff',
      multiSelect: false,
      options: [
        { optionId: 'summary', label: 'Summary' },
        { optionId: 'details', label: 'Detailed notes' },
      ],
    },
  ],
} satisfies Extract<AgentEvent, { type: 'question-request' }>;

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

export const SHOWCASE_COMPACTION_ID = 'mock-compaction-1';
export const SHOWCASE_COMPACTION_PRE_TOKENS = 193_437;
export const SHOWCASE_COMPACTION_POST_TOKENS = 12_180;
/** How long the live "compacting…" row stays visible before the completed re-emit merges over it. */
export const SHOWCASE_COMPACTION_HOLD_MS = 2400;

export const SHOWCASE_COMPACTION_SUMMARY = [
  'The conversation so far, condensed for the continued turn:',
  '',
  '- Seeded every wired conversation surface: plan, tool bursts, permissions, question, terminal.',
  '- The typecheck run flagged a stale preview import; a follow-up pass re-checks preview coverage.',
  '- Streaming the final reply next so live shimmer states have data.',
].join('\n');

export const SHOWCASE_STREAM_REPLY =
  'Streaming showcase complete: messages, reasoning, plans, tool bodies, diffs, terminal output, permissions, errors, and usage all came from the mock transport.';

export const SHOWCASE_SCRIPT_START_DELAY_MS = 600;
export const SHOWCASE_SCRIPT_STEP_LATENCY_MS = 180;
export const SHOWCASE_STREAM_START_DELAY_MS = 1000;
export const SHOWCASE_STREAM_CHUNK_LATENCY_MS = 220;

export const SHOWCASE_TERMINAL_START_OUTPUT =
  '$ pnpm vitest run packages/client/workbench/src/mock\n✓ dev mock transport (4)\n';

export const SHOWCASE_TERMINAL_EXIT_OUTPUT = 'mock terminal stream finished\n';

const SHOWCASE_STATIC_EXEC_COMMAND =
  'fd -e ts -e tsx --exclude node_modules --exclude coss-ui --exclude target . apps packages | xargs wc -l';

const SHOWCASE_STATIC_EXEC_OUTPUT = [
  '74570 total',
  '---per-dir---',
  'apps/daemon: 2953',
  'apps/desktop: 6804',
  'apps/mobile: 1088',
  'apps/webview: 2246',
  'packages/host/agent-adapter: 11884',
  'packages/host/assets: 1737',
  'packages/client/core: 3698',
  'packages/foundation/common: 94',
  'packages/vendor/coss-ui: 7927',
  'packages/host/engine: 6037',
  'packages/presentation/i18n: 1421',
  'packages/integrations/im-render: 496',
  'packages/system-plane/ipc: 418',
  'packages/foundation/schema: 2003',
  'packages/client/sdk: 600',
  'packages/foundation/transport: 1839',
  'packages/presentation/ui: 20155',
  'packages/client/workbench: 11097',
].join('\n');

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
  'Renderer patches are in; the delivery plan lives in `PLAN.md`, with the summary exported to `docs/report.pdf` and the diagram to `docs/logo.png`. Running the focused checks next.',
);

export const SHOWCASE_COMMANDS_NARRATION = textBlock(
  'Typecheck flagged a stale preview import, so a last pass double-checks the preview and coverage.',
);

export interface ShowcaseToolBursts {
  /** Contiguous read/search calls — renders as an "Explored" group. */
  explore: ToolCall[];
  /** Contiguous file calls — renders as an "Edited files" group with curated paths and summed +/-. */
  files: ToolCall[];
  /** Contiguous execute calls (one failed) — renders as a "Ran commands" group. */
  commands: ToolCall[];
  /** Trailing singletons: failed fetch, think, custom tool, subagent, and permission asks. */
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
        rawInput: {
          path: 'docs/ARCHITECTURE.md',
          offset: 0,
          limit: 120,
          internalRequestId: 'mock-read-173',
        },
      },
      {
        toolCallId: 'mock-tool-search',
        title: 'Search chat renderers',
        kind: 'search',
        status: 'completed',
        content: [],
        rawInput: {
          query: 'permission-request|tool-call|plan',
          glob: '**/*.{ts,tsx}',
          cwd: '/mock/linkcode',
        },
        rawOutput: {
          matches: [
            'packages/presentation/ui/src/chat/conversation-view.tsx',
            'packages/client/core/src/conversation.ts',
          ],
          files: 2,
          elapsedMs: 17,
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
            path: 'packages/presentation/ui/src/chat/conversation-view.tsx',
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
            path: 'packages/presentation/ui/src/chat/markdown.tsx',
            oldText: "const tone = 'chat';\n",
            newText: "const tone = 'coss';\nconst scale = 'text-sm';\n",
          },
        ],
      },
      {
        toolCallId: 'mock-tool-write-plan',
        title: 'Write PLAN.md',
        kind: 'edit',
        status: 'completed',
        locations: [{ path: 'PLAN.md' }],
        rawInput: { file_path: 'PLAN.md' },
        content: [],
      },
      {
        toolCallId: 'mock-tool-delete-legacy',
        title: 'Retire legacy timeline row',
        kind: 'delete',
        status: 'completed',
        content: [
          {
            type: 'diff',
            path: 'packages/presentation/ui/src/chat/legacy-row.tsx',
            oldText: 'export function LegacyRow() {\n  return null;\n}\n',
            newText: '',
          },
        ],
      },
      {
        toolCallId: 'mock-tool-move-preview',
        title: 'Move preview renderer',
        kind: 'move',
        status: 'completed',
        locations: [{ path: 'packages/presentation/ui/src/chat/artifacts/preview.tsx' }],
        content: [],
        rawInput: {
          path: 'packages/presentation/ui/src/chat/preview.tsx',
          move_path: 'packages/presentation/ui/src/chat/artifacts/preview.tsx',
          overwrite: false,
          internalRequestId: 'mock-move-173',
        },
      },
    ],
    commands: [
      {
        toolCallId: 'mock-tool-execute',
        title: 'Run focused mock test',
        kind: 'execute',
        status: 'completed',
        content: [{ type: 'terminal', terminalId }],
        rawInput: { command: 'pnpm vitest run packages/client/workbench/src/mock' },
      },
      {
        toolCallId: 'mock-tool-execute-lint',
        title: 'Count TypeScript lines',
        kind: 'execute',
        status: 'completed',
        content: [{ type: 'content', content: textBlock(SHOWCASE_STATIC_EXEC_OUTPUT) }],
        rawInput: {
          command: SHOWCASE_STATIC_EXEC_COMMAND,
          description: 'Count TS lines per app/package',
        },
        rawOutput: SHOWCASE_STATIC_EXEC_OUTPUT,
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
        toolCallId: 'mock-tool-fetch-envelope',
        title: 'WebFetch',
        kind: 'fetch',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: textBlock('# Arknights\n\nA tower-defense mobile game by Hypergryph.'),
          },
        ],
        rawInput: { url: 'https://en.wikipedia.org/wiki/Arknights' },
        rawOutput: {
          bytes: 192511,
          code: 200,
          codeText: 'OK',
          durationMs: 5404,
          url: 'https://en.wikipedia.org/wiki/Arknights',
        },
      },
      {
        toolCallId: 'mock-tool-fetch',
        title: 'Fetch unavailable preview',
        kind: 'fetch',
        status: 'failed',
        content: [],
        rawInput: {
          url: 'https://mock.invalid/preview',
          headers: { authorization: 'Bearer mock-token' },
          traceId: 'mock-fetch-173',
        },
        rawOutput: {
          status: 503,
          message: 'Mocked fetch failure for error-state coverage',
          responseBody: '<internal diagnostic>',
        },
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
      {
        toolCallId: 'mock-tool-other-capability',
        title: 'workspace.inspectCapability',
        kind: 'other',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: textBlock('Workspace capability is available.'),
          },
        ],
        rawInput: {
          workspaceId: 'mock-workspace-internal',
          includeDebug: true,
          traceId: 'mock-other-173',
        },
        rawOutput: { ok: true, internalRequestId: 'mock-other-result-173' },
      },
      {
        toolCallId: 'mock-tool-mcp-slug',
        title: 'mcp__linear__get_issue',
        kind: 'other',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: textBlock('CODE-228 · feat(ui): richer tool-call details'),
          },
        ],
        rawInput: { id: 'CODE-228', includeRelations: true },
        rawOutput: { content: [{ type: 'text', text: 'CODE-228' }] },
      },
      {
        toolCallId: 'mock-tool-task-review',
        title: 'Review metadata policy',
        kind: 'task',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: textBlock('Reviewed the normal-mode metadata allowlist.'),
          },
        ],
        rawInput: {
          description: 'Review metadata policy',
          prompt: 'Inspect every adapter payload and report internal implementation details.',
          subagent_type: 'Explore',
        },
        rawOutput: { agentId: 'mock-subagent-internal', traceId: 'mock-task-173' },
      },
      SHOWCASE_QUESTION.toolCall,
      ...SHOWCASE_PERMISSIONS.map((permission) => permission.toolCall),
    ],
  };
}
