// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { asyncNoop } from 'foxts/noop';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DefaultHostFooter, EmptyHostFooter, HostFooter, SessionSidebar } from '../session-sidebar';

const SIDEBAR_TRANSLATIONS: Record<string, string> = {
  newTask: '新建任务',
  search: '搜索',
  automations: '自动化',
  localHost: '本地主机',
  remoteAccess: '远程访问',
  permissionRequests: '权限请求',
  agentAvailability: '智能体可用性',
  notReported: '未报告',
  account: '账户',
  signInCloud: '登录 LinkCode Cloud',
  remoteSignedOut: '登录后可连接远程主机',
};

function translateSidebar(key: string): string {
  return SIDEBAR_TRANSLATIONS[key] ?? key;
}

vi.mock('use-intl', () => ({
  useTranslations() {
    return translateSidebar;
  },
}));

vi.mock('../threads-view', () => ({
  ThreadsView() {
    return null;
  },
}));

afterEach(cleanup);

describe('SessionSidebar i18n', () => {
  it('localizes its primary actions', () => {
    render(
      <SessionSidebar
        threadGroups={[]}
        activeId={null}
        pinnedSessionIds={[]}
        collapsedSections={[]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onToggleSessionPinned={vi.fn()}
        onReorderGroups={vi.fn()}
        onReorderThreads={vi.fn()}
        onStartDraft={vi.fn()}
        onRegisterWorkspace={asyncNoop}
        onRenameWorkspace={asyncNoop}
        onArchiveWorkspace={asyncNoop}
        onToggleGroupCollapsed={vi.fn()}
        onToggleSectionCollapsed={vi.fn()}
        onTogglePreviewExpanded={vi.fn()}
      />,
    );

    expect(screen.getByText('新建任务')).toBeTruthy();
    expect(screen.getByText('搜索')).toBeTruthy();
    expect(screen.getByText('自动化')).toBeTruthy();
  });

  it('localizes every host footer presentation', () => {
    const { rerender } = render(<DefaultHostFooter latency="1 ms" />);
    expect(screen.getByText('本地主机')).toBeTruthy();

    rerender(<EmptyHostFooter />);
    expect(screen.getByText('本地主机')).toBeTruthy();

    rerender(<HostFooter state="Connected" />);
    fireEvent.click(screen.getByRole('button', { name: '本地主机 · Connected' }));
    expect(screen.getByText('远程访问')).toBeTruthy();
    expect(screen.getByText('权限请求')).toBeTruthy();
    expect(screen.getByText('智能体可用性')).toBeTruthy();
    expect(screen.getByText('未报告')).toBeTruthy();
  });
});
