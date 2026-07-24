// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { InlineCitationSource } from '../inline-citation';
import { UrlLinkIcon } from '../link-icon';
import { Source } from '../sources';

afterEach(cleanup);

it('loads the destination and Google favicon concurrently with a local fallback', () => {
  const { container } = render(<UrlLinkIcon url="https://internal.example.test/docs" />);

  expect(container.querySelector('svg')).not.toBeNull();
  const images = [...container.querySelectorAll('img')];
  expect(images).toHaveLength(2);
  expect(images.map((image) => image.getAttribute('src'))).toEqual([
    'https://internal.example.test/favicon.ico',
    'https://www.google.com/s2/favicons?domain=https%3A%2F%2Finternal.example.test&sz=32',
  ]);
  for (const image of images) {
    expect(image.getAttribute('alt')).toBe('');
    expect(image.getAttribute('decoding')).toBe('async');
    expect(image.getAttribute('draggable')).toBe('false');
    expect(image.getAttribute('loading')).toBeNull();
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(image.classList).toContain('opacity-0');
  }
});

it('keeps the first successful favicon', () => {
  const { container } = render(<UrlLinkIcon url="https://example.com/docs" />);
  const [destination, google] = [...container.querySelectorAll('img')];

  fireEvent.load(google);
  expect(container.querySelector('svg')).toBeNull();
  expect(google.classList).toContain('opacity-100');
  expect(destination.classList).toContain('opacity-0');

  fireEvent.load(destination);
  expect(google.classList).toContain('opacity-100');
  expect(destination.classList).toContain('opacity-0');
});

it('resets the favicon when the url changes', () => {
  const { container, rerender } = render(<UrlLinkIcon url="https://first.example/docs" />);
  const [firstImage] = container.querySelectorAll('img');
  fireEvent.load(firstImage);
  expect(container.querySelector('svg')).toBeNull();

  rerender(<UrlLinkIcon url="https://second.example/docs" />);

  expect(container.querySelector('svg')).not.toBeNull();
  expect([...container.querySelectorAll('img')].map((image) => image.getAttribute('src'))).toEqual([
    'https://second.example/favicon.ico',
    'https://www.google.com/s2/favicons?domain=https%3A%2F%2Fsecond.example&sz=32',
  ]);
});

it('keeps the favicon when only the url path changes', () => {
  const { container, rerender } = render(<UrlLinkIcon url="https://example.com/first" />);
  const [favicon] = container.querySelectorAll('img');
  fireEvent.load(favicon);

  rerender(<UrlLinkIcon url="https://example.com/second" />);

  expect(container.querySelector('svg')).toBeNull();
  expect(favicon.classList).toContain('opacity-100');
});

it('uses the fallback for non-web urls', () => {
  const { getByText } = render(<UrlLinkIcon url="/docs" fallback={<span>fallback</span>} />);
  expect(getByText('fallback')).not.toBeNull();
});

it('renders favicons for source and citation urls', () => {
  const { container } = render(
    <>
      <Source source={{ id: 'source', title: 'Source', url: 'https://source.example/docs' }} />
      <InlineCitationSource
        citation={{
          id: 'citation',
          sourceId: 'source',
          title: 'Citation',
          url: 'https://citation.example/docs',
        }}
      />
    </>,
  );

  expect(container.querySelectorAll('img')).toHaveLength(4);
});
