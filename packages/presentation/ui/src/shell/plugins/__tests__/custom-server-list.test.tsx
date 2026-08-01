// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomServerList } from '../custom-server-list';

function translateKey(key: string): string {
  return key;
}

vi.mock('use-intl', () => ({
  useTranslations: () => translateKey,
}));

afterEach(cleanup);

const handlers = {
  onAdd: vi.fn(),
  onEdit: vi.fn(),
  onRemove: vi.fn(),
  onToggle: vi.fn(),
};

describe('CustomServerList', () => {
  it('distinguishes loading from a resolved empty list', () => {
    const { container, rerender } = render(
      <CustomServerList rows={undefined} busy={false} {...handlers} />,
    );

    expect(container.querySelector('[data-slot="skeleton"]')).toBeTruthy();
    expect(screen.queryByText('empty')).toBeNull();

    rerender(<CustomServerList rows={[]} busy={false} {...handlers} />);

    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(screen.getByText('empty')).toBeTruthy();
  });
});
