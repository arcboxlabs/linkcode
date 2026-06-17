export const locales = ['zh-CN', 'en'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'zh-CN';

export const messages = {
  'zh-CN': {
    common: {
      appName: 'Link Code',
      daemonCommand: 'pnpm --filter @linkcode/daemon dev',
      unavailable: '暂无消息。',
    },
    workbench: {
      connection: {
        connecting: '正在连接 daemon…',
        error: '无法连接到 daemon（{url}）。请先运行 {command}。',
        retry: '重试',
      },
      sidebar: {
        title: '会话',
        newSession: '新建会话',
        empty: '还没有会话',
        emptyHint: '点击「新建会话」开始。',
        searchPlaceholder: '搜索会话…',
      },
      session: {
        untitled: '新会话',
        stop: '停止会话',
        running: '运行中',
        statusStarting: '启动中',
        statusIdle: '空闲',
        statusRunning: '运行中',
        'statusAwaiting-input': '等待输入',
        statusStopped: '已停止',
      },
      newSession: {
        title: '新建会话',
        agent: 'Agent',
        cwd: '工作目录',
        cwdPlaceholder: '/path/to/repo',
        create: '创建',
        cancel: '取消',
      },
      conversation: {
        emptyTitle: '开始对话',
        emptyHint: '在下方输入消息，{agent} 会在 {cwd} 中开始工作。',
        you: '你',
        thinking: '思考中…',
        thought: '思考',
        copy: '复制',
        copied: '已复制',
        showMore: '展开',
        showLess: '收起',
      },
      tool: {
        input: '输入',
        output: '输出',
        diff: '变更',
        terminal: '终端',
        exitCode: '退出码 {code}',
        statusPending: '待处理',
        statusIn_progress: '进行中',
        statusCompleted: '已完成',
        statusFailed: '失败',
        kindRead: '读取',
        kindEdit: '编辑',
        kindDelete: '删除',
        kindMove: '移动',
        kindSearch: '搜索',
        kindExecute: '执行',
        kindThink: '思考',
        kindFetch: '获取',
        kindOther: '工具',
      },
      plan: {
        title: '计划',
        statusPending: '待办',
        statusIn_progress: '进行中',
        statusCompleted: '已完成',
      },
      permission: {
        title: '权限请求',
        answered: '已处理',
      },
      composer: {
        placeholder: '输入消息…（/ 命令，@ 提及）',
        placeholderDisconnected: '请先创建或选择会话',
        send: '发送',
        stop: '停止',
        commands: '命令',
        mentions: '提及',
        noCommands: '没有可用命令',
        noMentions: '没有匹配项',
      },
      mode: {
        label: '模式',
      },
      usage: {
        tokens: '{input} 输入 · {output} 输出',
      },
      content: {
        image: '[图片]',
        audio: '[音频]',
        resourceLink: '[资源：{name}]',
        resource: '[资源]',
      },
      agentKind: {
        'claude-code': 'Claude Code',
        codex: 'Codex',
        opencode: 'OpenCode',
        pi: 'Pi',
      },
      stopReason: {
        end_turn: '完成',
        max_tokens: '达到 token 上限',
        max_turn_requests: '达到请求上限',
        refusal: '已拒绝',
        cancelled: '已取消',
      },
    },
    web: {
      title: 'Link Code · Web',
      connectionError: '无法连接到 daemon（{url}）。请先运行 {command}。',
      connecting: '连接中...',
      panels: {
        session: '会话',
        permissions: '待确认权限',
        messages: '消息',
      },
      session: {
        start: '启动会话',
        connected: '已连接 · {sessionId}',
      },
      composer: {
        placeholderReady: '输入消息...',
        placeholderDisconnected: '请先启动会话',
        send: '发送',
      },
      events: {
        image: '[image]',
        audio: '[audio]',
        resourceLink: '[resource: {name}]',
        resource: '[resource]',
        configUpdated: 'config updated',
        permissionRequest: '权限请求 · {title}',
        mode: 'mode · {modeId}',
      },
    },
    mobile: {
      title: 'Link Code · Mobile',
      contract: '共享数据契约 · wire v{version} · 来自 @linkcode/schema',
      registeredAgents: '已登记的 agent 适配',
      tunnel:
        '数据面将经 Server tunnel（Socket.IO）远程接入本地 Host。\nUI 库 HeroUI 的接入步骤见 HEROUI_SETUP.md（NativeWind 已接入）。',
    },
  },
  en: {
    common: {
      appName: 'Link Code',
      daemonCommand: 'pnpm --filter @linkcode/daemon dev',
      unavailable: 'No messages yet.',
    },
    workbench: {
      connection: {
        connecting: 'Connecting to the daemon…',
        error: 'Unable to connect to the daemon ({url}). Run {command} first.',
        retry: 'Retry',
      },
      sidebar: {
        title: 'Sessions',
        newSession: 'New session',
        empty: 'No sessions yet',
        emptyHint: 'Click “New session” to begin.',
        searchPlaceholder: 'Search sessions…',
      },
      session: {
        untitled: 'New session',
        stop: 'Stop session',
        running: 'Running',
        statusStarting: 'Starting',
        statusIdle: 'Idle',
        statusRunning: 'Running',
        'statusAwaiting-input': 'Awaiting input',
        statusStopped: 'Stopped',
      },
      newSession: {
        title: 'New session',
        agent: 'Agent',
        cwd: 'Working directory',
        cwdPlaceholder: '/path/to/repo',
        create: 'Create',
        cancel: 'Cancel',
      },
      conversation: {
        emptyTitle: 'Start the conversation',
        emptyHint: 'Type a message below — {agent} will get to work in {cwd}.',
        you: 'You',
        thinking: 'Thinking…',
        thought: 'Thought',
        copy: 'Copy',
        copied: 'Copied',
        showMore: 'Show more',
        showLess: 'Show less',
      },
      tool: {
        input: 'Input',
        output: 'Output',
        diff: 'Changes',
        terminal: 'Terminal',
        exitCode: 'exit {code}',
        statusPending: 'Pending',
        statusIn_progress: 'Running',
        statusCompleted: 'Done',
        statusFailed: 'Failed',
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
        statusPending: 'To do',
        statusIn_progress: 'In progress',
        statusCompleted: 'Done',
      },
      permission: {
        title: 'Permission request',
        answered: 'Handled',
      },
      composer: {
        placeholder: 'Type a message…  (/ commands, @ mentions)',
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
      usage: {
        tokens: '{input} in · {output} out',
      },
      content: {
        image: '[image]',
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
      stopReason: {
        end_turn: 'Completed',
        max_tokens: 'Token limit reached',
        max_turn_requests: 'Request limit reached',
        refusal: 'Refused',
        cancelled: 'Cancelled',
      },
    },
    web: {
      title: 'Link Code · Web',
      connectionError: 'Unable to connect to daemon ({url}). Run {command} first.',
      connecting: 'Connecting...',
      panels: {
        session: 'Session',
        permissions: 'Pending permissions',
        messages: 'Messages',
      },
      session: {
        start: 'Start session',
        connected: 'Connected · {sessionId}',
      },
      composer: {
        placeholderReady: 'Type a message...',
        placeholderDisconnected: 'Start a session first',
        send: 'Send',
      },
      events: {
        image: '[image]',
        audio: '[audio]',
        resourceLink: '[resource: {name}]',
        resource: '[resource]',
        configUpdated: 'config updated',
        permissionRequest: 'Permission request · {title}',
        mode: 'mode · {modeId}',
      },
    },
    mobile: {
      title: 'Link Code · Mobile',
      contract: 'Shared data contract · wire v{version} · from @linkcode/schema',
      registeredAgents: 'Registered agent adapters',
      tunnel:
        'The data plane will connect to the local Host remotely through the Server tunnel (Socket.IO).\nHeroUI setup lives in HEROUI_SETUP.md (NativeWind is already configured).',
    },
  },
} as const;

export type Messages = (typeof messages)[Locale];

export function getMessages(locale: Locale): Messages {
  return messages[locale];
}

export function resolveLocale(input: string | readonly string[] | undefined): Locale {
  const candidates = typeof input === 'string' ? [input] : (input ?? []);
  for (const candidate of candidates) {
    const normalized = normalizeLocale(candidate);
    if (normalized) return normalized;
  }
  return defaultLocale;
}

function normalizeLocale(value: string): Locale | null {
  const lower = value.toLowerCase();
  if (lower === 'zh' || lower.startsWith('zh-')) return 'zh-CN';
  if (lower === 'en' || lower.startsWith('en-')) return 'en';
  return null;
}
