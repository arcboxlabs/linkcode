// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { UrlLinkIcon } from '../link-icon';

afterEach(cleanup);

it('renders web urls with a local icon and no remote image', () => {
  const { container } = render(<UrlLinkIcon url="https://internal.example.test/docs" />);
  expect(container.querySelector('svg')).not.toBeNull();
  expect(container.querySelector('img')).toBeNull();
});

it('uses the fallback for non-web urls', () => {
  const { getByText } = render(<UrlLinkIcon url="/docs" fallback={<span>fallback</span>} />);
  expect(getByText('fallback')).not.toBeNull();
});
