// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { IntegrationIcon, integrationBrand } from '../integration-brand';

afterEach(cleanup);

describe('integration brand resolution', () => {
  it('token-matches user-chosen MCP server names against known brands', () => {
    expect(integrationBrand('linear')).toBe('linear');
    expect(integrationBrand('claude_ai_Gmail')).toBe('gmail');
    expect(integrationBrand('github-enterprise')).toBe('github');
    expect(integrationBrand('jira')).toBe('jira');
    expect(integrationBrand('f5fcc7d5-d616-4ac2-9cdb-55372529dad2')).toBeUndefined();
    expect(integrationBrand('workspace')).toBeUndefined();
    // Object-prototype keys are not brands (a `constructor` token once resolved to `Object`).
    expect(integrationBrand('constructor')).toBeUndefined();
    expect(integrationBrand('my-constructor-server')).toBeUndefined();
  });

  it('renders the brand glyph with its brand stamped for styling and tests', () => {
    const { container } = render(<IntegrationIcon brand="linear" className="text-foreground" />);
    const glyph = container.querySelector('[data-brand="linear"]');
    expect(glyph).not.toBeNull();
    expect(glyph?.tagName.toLowerCase()).toBe('svg');
  });
});
