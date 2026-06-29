import { useClipboard } from 'foxact/use-clipboard';

export function useCopyButton(
  value: string,
  timeout: number,
): {
  copied: boolean;
  copyValue: () => void;
} {
  const { copied, copy, reset } = useClipboard({ timeout });

  function copyValue(): void {
    reset();
    void copy(value);
  }

  return { copied, copyValue };
}
