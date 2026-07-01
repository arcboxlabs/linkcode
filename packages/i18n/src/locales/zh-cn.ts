export const zhCN = {
  common: {
    daemonCommand: 'pnpm --filter @linkcode/daemon dev',
  },
  workbench: {
    connection: {
      connected: '已连接',
      connecting: '正在连接 daemon…',
      error: '无法连接到 daemon（{url}）。请先运行 {command}。',
      retry: '重试',
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
    composer: {
      placeholderDisconnected: '请先创建或选择会话',
      send: '发送',
      stop: '停止',
      commands: '命令',
      mentions: '提及',
      noCommands: '没有可用命令',
      noMentions: '没有匹配项',
      modelDefault: '默认',
    },
    mode: {
      label: '模式',
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
  settings: {
    title: '设置',
    back: '返回',
    searchPlaceholder: '搜索设置...',
    tabs: {
      general: '通用',
      connection: '连接',
      about: '关于',
      agents: '智能体',
    },
    general: {
      appearance: '外观',
      appearanceHint: 'LinkCode 在此设备上的外观。',
      theme: '主题',
      themeSystem: '跟随系统',
      themeLight: '浅色',
      themeDark: '深色',
      language: '语言',
      languageHint: '界面语言。「自动」跟随系统。',
      languageAuto: '自动',
    },
    connection: {
      title: 'Daemon',
      hint: '此客户端连接的本地 daemon。',
      url: 'Daemon 地址',
      urlHint: '修改后会立即重新连接。',
      invalidUrl: '请输入有效的 URL。',
      save: '保存并重连',
    },
    about: {
      version: '版本',
      checkForUpdates: '检查更新',
      status: {
        checking: '正在检查更新…',
        available: '发现更新，正在下载…',
        notAvailable: '已是最新版本。',
        downloading: '正在下载更新…',
        downloaded: '更新已就绪，重启以安装。',
        error: '检查更新失败。',
      },
    },
    agents: {
      title: '智能体',
      hint: '各智能体的 provider 配置。',
      unavailable: '连接到 daemon 后即可配置智能体。',
      enabled: '启用',
      defaultModel: '默认模型',
      apiKey: 'API 密钥',
      apiKeyPlaceholder: '保存在 daemon 上',
      save: '保存',
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
