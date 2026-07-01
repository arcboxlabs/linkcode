import type { LocaleMessages } from './zh-cn';

export const en = {
  common: {
    daemonCommand: 'pnpm --filter @linkcode/daemon dev',
  },
  workbench: {
    connection: {
      connected: 'Connected',
      connecting: 'Connecting to the daemon…',
      error: 'Unable to connect to the daemon ({url}). Run {command} first.',
      retry: 'Retry',
    },
    conversation: {
      emptyTitle: 'Start the conversation',
      emptyHint: 'Type a message below — {agent} will get to work in {cwd}.',
      thinking: 'Thinking…',
      thought: 'Thought',
    },
    tool: {
      input: 'Input',
      output: 'Output',
      terminal: 'Terminal',
      kindRead: 'Read',
      kindEdit: 'Edit',
      kindDelete: 'Delete',
      kindMove: 'Move',
      kindSearch: 'Search',
      kindExecute: 'Run',
      kindThink: 'Think',
      kindFetch: 'Fetch',
      kindOther: 'Tool',
    },
    plan: {
      title: 'Plan',
    },
    permission: {
      title: 'Permission request',
      answered: 'Handled',
      responding: 'Submitting…',
    },
    composer: {
      placeholderDisconnected: 'Create or pick a session first',
      send: 'Send',
      stop: 'Stop',
      commands: 'Commands',
      mentions: 'Mentions',
      noCommands: 'No commands available',
      noMentions: 'No matches',
    },
    mode: {
      label: 'Mode',
    },
    content: {
      audio: '[audio]',
      resourceLink: '[resource: {name}]',
      resource: '[resource]',
    },
    agentKind: {
      'claude-code': 'Claude Code',
      codex: 'Codex',
      opencode: 'OpenCode',
      pi: 'Pi',
    },
  },
  mobile: {
    title: 'Link Code · Mobile',
    contract: 'Shared data contract · wire v{version} · from @linkcode/schema',
    registeredAgents: 'Registered agent adapters',
    tunnel:
      'The data plane will connect to the local Host remotely through the Server tunnel (Socket.IO).\nHeroUI setup lives in HEROUI_SETUP.md (NativeWind is already configured).',
  },
} as const satisfies LocaleMessages;
