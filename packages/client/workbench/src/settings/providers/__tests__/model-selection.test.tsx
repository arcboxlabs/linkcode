// @vitest-environment jsdom

import type { AccountModel } from '@linkcode/schema';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { nullthrow } from 'foxts/guard';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelSelection } from '../model-selection';

function translateKey(key: string): string {
  return key;
}

vi.mock('use-intl', () => ({
  useTranslations: () => translateKey,
}));

afterEach(cleanup);

const NONE: AccountModel[] = [];
const RE_REFRESH = /models\.refresh/;
const RE_ADD = /models\.add/;
const RE_BAD_KEY = /invalid api key/;

/** Renders with the selection held above, the way both account forms do through `Controller`. */
function Harness({
  initial = NONE,
  onFetch,
}: {
  initial?: AccountModel[];
  onFetch?: () => Promise<AccountModel[]>;
}): React.ReactNode {
  const [selected, setSelected] = useState(initial);
  return <ModelSelection onChange={setSelected} onFetch={onFetch} selected={selected} />;
}

function rowFor(id: string): HTMLInputElement {
  const row = nullthrow(screen.getByText(id).closest('label'), `no row for ${id}`);
  return nullthrow(row.querySelector('input'), `no checkbox for ${id}`);
}

describe('ModelSelection', () => {
  it('fetches a list, and only ticked ids become the set', async () => {
    const onFetch = vi
      .fn()
      .mockResolvedValue([
        { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
        { id: 'deepseek-v4-flash' },
      ]);
    render(<Harness onFetch={onFetch} />);

    fireEvent.click(screen.getByRole('button', { name: RE_REFRESH }));
    await waitFor(() => expect(screen.getByText('deepseek-v4-pro')).toBeTruthy());

    expect(rowFor('deepseek-v4-pro').checked).toBe(false);
    fireEvent.click(rowFor('deepseek-v4-pro'));
    await waitFor(() => expect(rowFor('deepseek-v4-pro').checked).toBe(true));
    expect(rowFor('deepseek-v4-flash').checked).toBe(false);
  });

  it('keeps a picked id the list no longer returns, rather than silently unpicking it', async () => {
    // A freeform entry, or one the vendor has retired: dropping it would change the account's set
    // behind the user's back on the next refresh.
    const onFetch = vi.fn().mockResolvedValue([{ id: 'gpt-5' }]);
    render(<Harness initial={[{ id: 'retired-model' }]} onFetch={onFetch} />);

    fireEvent.click(screen.getByRole('button', { name: RE_REFRESH }));
    await waitFor(() => expect(screen.getByText('gpt-5')).toBeTruthy());

    expect(rowFor('retired-model').checked).toBe(true);
  });

  it('adds a hand-typed id and refuses a duplicate', () => {
    render(<Harness initial={[{ id: 'already' }]} />);

    const input = screen.getByPlaceholderText('models.addPlaceholder');
    fireEvent.change(input, { target: { value: 'typed-model' } });
    fireEvent.click(screen.getByRole('button', { name: RE_ADD }));
    expect(rowFor('typed-model').checked).toBe(true);
    expect((input as HTMLInputElement).value).toBe('');

    fireEvent.change(input, { target: { value: 'already' } });
    fireEvent.click(screen.getByRole('button', { name: RE_ADD }));
    expect(screen.getAllByText('already')).toHaveLength(1);
  });

  it('moves a picked model to the head when it becomes the default', () => {
    const onChange = vi.fn();
    render(
      <ModelSelection
        selected={[
          { id: 'model-a', label: 'Model A' },
          { id: 'model-b', label: 'Model B' },
        ]}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole('button', { name: 'models.defaultModel' })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'models.makeDefault' }));

    expect(onChange).toHaveBeenCalledWith([
      { id: 'model-b', label: 'Model B' },
      { id: 'model-a', label: 'Model A' },
    ]);
  });

  it("surfaces the fetch failure's own reason instead of swallowing it", async () => {
    const onFetch = vi.fn().mockRejectedValue(new Error('401 Unauthorized — invalid api key'));
    render(<Harness onFetch={onFetch} />);

    fireEvent.click(screen.getByRole('button', { name: RE_REFRESH }));
    await waitFor(() => expect(screen.getByText(RE_BAD_KEY)).toBeTruthy());
  });

  it('offers no fetch when nothing can list the endpoint', () => {
    render(<Harness />);

    expect(screen.queryByRole('button', { name: RE_REFRESH })).toBeNull();
    expect(screen.getByText('models.hintUnlistable')).toBeTruthy();
  });
});
