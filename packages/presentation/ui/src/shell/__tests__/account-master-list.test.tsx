// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderAccountListItem } from '../providers/account-master-list';
import { AccountList } from '../providers/account-master-list';

function reversed(items: string[]): string[] {
  return [...items].reverse();
}

function passthrough(key: string, values?: Record<string, unknown>): string {
  const interpolation = values ? Object.values(values).join(',') : '';
  return interpolation ? `${key}:${interpolation}` : key;
}

function translations(): typeof passthrough {
  return passthrough;
}

const dnd = vi.hoisted(() => ({
  onDragEnd: undefined as undefined | ((event: { canceled: boolean }) => void),
  move: vi.fn(reversed),
}));

vi.mock('@dnd-kit/helpers', () => ({ move: dnd.move }));
vi.mock('@dnd-kit/react', () => ({
  DragDropProvider({
    children,
    onDragEnd,
  }: {
    children: React.ReactNode;
    onDragEnd: (event: { canceled: boolean }) => void;
  }) {
    dnd.onDragEnd = onDragEnd;
    return children;
  },
}));
vi.mock('@dnd-kit/react/sortable', () => ({
  useSortable: () => ({
    ref: vi.fn(),
    handleRef: vi.fn(),
    isDragging: false,
  }),
}));
vi.mock('use-intl', () => ({ useTranslations: translations }));

afterEach(() => {
  cleanup();
  dnd.move.mockClear();
  dnd.onDragEnd = undefined;
});

const ACCOUNTS: ProviderAccountListItem[] = [
  {
    id: 'account-a',
    label: 'Account A',
    credentialType: 'api-key',
    boundAgents: [],
  },
  {
    id: 'account-b',
    label: 'Account B',
    credentialType: 'api-key',
    boundAgents: [],
  },
];

describe('AccountList', () => {
  it('emits the full reordered account id list when a drag ends', () => {
    const onReorder = vi.fn();
    render(
      <AccountList
        accounts={ACCOUNTS}
        loading={false}
        onAdd={vi.fn()}
        onReorder={onReorder}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'reorderAccount:Account A' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'reorderAccount:Account B' })).toBeTruthy();
    act(() => dnd.onDragEnd?.({ canceled: false }));

    expect(dnd.move).toHaveBeenCalledWith(['account-a', 'account-b'], { canceled: false });
    expect(onReorder).toHaveBeenCalledWith(['account-b', 'account-a']);
  });

  it('disables reordering while the account list is filtered', () => {
    const onReorder = vi.fn();
    render(
      <AccountList
        accounts={ACCOUNTS}
        loading={false}
        onAdd={vi.fn()}
        onReorder={onReorder}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('orderHint')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('searchPlaceholder'), {
      target: { value: 'Account A' },
    });
    expect(screen.queryByText('orderHint')).toBeNull();
    expect(screen.getByRole('button', { name: 'reorderAccount:Account A' })).toHaveProperty(
      'disabled',
      true,
    );
    act(() => dnd.onDragEnd?.({ canceled: false }));

    expect(onReorder).not.toHaveBeenCalled();
  });
});
