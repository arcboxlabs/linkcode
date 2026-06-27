export const zhCN = {
  common: {
    appName: 'Link Code',
    daemonCommand: 'pnpm --filter @linkcode/daemon dev',
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
      searchPlaceholder: '搜索会话…',
    },
    session: {
      stop: '停止会话',
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
      thinking: '思考中…',
      thought: '思考',
    },
    tool: {
      input: '输入',
      output: '输出',
      terminal: '终端',
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
    },
    permission: {
      title: '权限请求',
      answered: '已处理',
      responding: '正在提交…',
    },
    error: {
      title: '操作失败',
      dismiss: '关闭',
    },
    composer: {
      placeholder: '输入消息…（/ 命令，@ 提及）',
      placeholderDisconnected: '请先创建或选择会话',
      add: '添加',
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
  },
  mobile: {
    title: 'Link Code · Mobile',
    contract: '共享数据契约 · wire v{version} · 来自 @linkcode/schema',
    registeredAgents: '已登记的 agent 适配',
    tunnel:
      '数据面将经 Server tunnel（Socket.IO）远程接入本地 Host。\nUI 库 HeroUI 的接入步骤见 HEROUI_SETUP.md（NativeWind 已接入）。',
  },
} as const;

type WidenMessages<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : WidenMessages<T[K]>;
};

export type LocaleMessages = WidenMessages<typeof zhCN>;
