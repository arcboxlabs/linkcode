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
