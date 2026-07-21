// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { CodeBlock } from '../code-block';

afterEach(cleanup);

it('highlights supported code with the configured Shiki pipeline', async () => {
  const { container } = render(
    <CodeBlock code={'const answer: number = 42;'} language="typescript" title="answer.ts" />,
  );

  await waitFor(
    () => {
      expect(container.querySelectorAll('code span[style*="--sdm-c"]').length).toBeGreaterThan(2);
    },
    { timeout: 10000 },
  );
}, 15000);

it('keeps unknown languages readable as plain code', () => {
  const code = 'opaque preview payload';
  const { container } = render(
    <CodeBlock code={code} language="not-a-real-language" title="payload" />,
  );

  expect(container.querySelector('code')?.textContent).toBe(code);
  expect(container.querySelector('[style*="--sdm-c"]')).toBeNull();
});
