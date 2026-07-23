// @vitest-environment jsdom

import type { PluginConfigSet } from '@linkcode/schema';
import { getPluginCatalog, setPluginConfig } from '@linkcode/sdk';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePluginSettings } from '../hooks';

const { useDataMock, useMutationMock } = vi.hoisted(() => ({
  useDataMock: vi.fn(),
  useMutationMock: vi.fn(),
}));

vi.mock('../../../runtime/tayori', () => ({
  useData: useDataMock,
  useMutation: useMutationMock,
}));

const configMutate = vi.fn();
const trigger = vi.fn();

beforeEach(() => {
  configMutate.mockReset().mockResolvedValue(undefined);
  trigger.mockReset().mockResolvedValue({ ok: true });
  useDataMock.mockImplementation((operation: unknown) =>
    operation === getPluginCatalog
      ? { data: [], error: undefined, isLoading: false, mutate: vi.fn() }
      : {
          data: { units: [], serviceBindings: {}, connectors: [] },
          error: undefined,
          isLoading: false,
          mutate: configMutate,
        },
  );
  useMutationMock.mockImplementation((operation: unknown) => {
    expect(operation).toBe(setPluginConfig);
    return { trigger, error: undefined, isMutating: false };
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('usePluginSettings', () => {
  const patch: PluginConfigSet = { units: [{ unitId: 'github-read', enabled: true }] };

  it('revalidates config only after the host acknowledges the write', async () => {
    const { result } = renderHook(() => usePluginSettings());

    await result.current.save(patch);

    expect(trigger).toHaveBeenCalledWith({ plugins: patch });
    expect(configMutate).toHaveBeenCalledTimes(1);
    expect(trigger.mock.invocationCallOrder[0]).toBeLessThan(
      configMutate.mock.invocationCallOrder[0] ?? Number.NaN,
    );
  });

  it('leaves the cached config untouched when the write fails', async () => {
    trigger.mockRejectedValue(new Error('request failed'));
    const { result } = renderHook(() => usePluginSettings());

    await expect(result.current.save(patch)).rejects.toThrow('request failed');

    expect(configMutate).not.toHaveBeenCalled();
  });
});
