"use client";

import { useClipboard } from 'foxact/use-clipboard';

export function useCopyToClipboard({
  timeout = 2000,
  onCopy,
}: {
  timeout?: number;
  onCopy?: () => void;
} = {}): { copyToClipboard: (value: string) => void; isCopied: boolean } {
  const { copy, copied: isCopied } = useClipboard({ timeout });

  const copyToClipboard = (value: string): void => {
    copy(value).then(() => {
      if (onCopy) {
        onCopy();
      }
    }, console.error);
  };

  return { copyToClipboard, isCopied };
}
