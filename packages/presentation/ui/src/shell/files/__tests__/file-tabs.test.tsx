// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileTabStrip } from '../file-tabs';

function translateKey(key: string): string {
  return key;
}

vi.mock('use-intl', () => ({
  useTranslations: () => translateKey,
}));

afterEach(cleanup);

describe('FileTabStrip', () => {
  it('closes the targeted tab only for a middle click', () => {
    const onSelectTab = vi.fn();
    const onCloseTab = vi.fn();
    render(
      <FileTabStrip
        tabs={[
          { id: 'readme', path: '/repo/README.md' },
          { id: 'source', path: '/repo/src/index.ts' },
        ]}
        activeTabId="readme"
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
      />,
    );

    const sourceTab = screen.getByRole('button', { name: 'index.ts' });
    const rightMouseDown = new MouseEvent('mousedown', {
      bubbles: true,
      button: 2,
      cancelable: true,
    });
    fireEvent(sourceTab, rightMouseDown);
    expect(rightMouseDown.defaultPrevented).toBe(false);
    fireEvent(sourceTab, new MouseEvent('auxclick', { bubbles: true, button: 2 }));
    expect(onCloseTab).not.toHaveBeenCalled();

    const middleMouseDown = new MouseEvent('mousedown', {
      bubbles: true,
      button: 1,
      cancelable: true,
    });
    fireEvent(sourceTab, middleMouseDown);
    expect(middleMouseDown.defaultPrevented).toBe(true);
    expect(onCloseTab).not.toHaveBeenCalled();

    fireEvent(sourceTab, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(onCloseTab).toHaveBeenCalledOnce();
    expect(onCloseTab).toHaveBeenCalledWith('source');
    expect(onSelectTab).not.toHaveBeenCalled();
  });
});
