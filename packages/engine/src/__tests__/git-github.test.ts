import { describe, expect, it } from 'vitest';
import { isAuthFailureStderr, rollUpChecks } from '../git/github';

describe('rollUpChecks', () => {
  it('reports none without checks', () => {
    expect(rollUpChecks(null)).toBe('none');
    expect(rollUpChecks([])).toBe('none');
  });

  it('passes when every check concluded successfully', () => {
    expect(
      rollUpChecks([
        { status: 'COMPLETED', conclusion: 'SUCCESS' },
        { status: 'COMPLETED', conclusion: 'SKIPPED' },
        { state: 'SUCCESS' },
      ]),
    ).toBe('passing');
  });

  it('is pending while any check is still running', () => {
    expect(
      rollUpChecks([
        { status: 'COMPLETED', conclusion: 'SUCCESS' },
        { status: 'IN_PROGRESS', conclusion: null },
      ]),
    ).toBe('pending');
    expect(rollUpChecks([{ state: 'PENDING' }])).toBe('pending');
  });

  it('fails as soon as one check failed, even with others running', () => {
    expect(
      rollUpChecks([
        { status: 'COMPLETED', conclusion: 'FAILURE' },
        { status: 'IN_PROGRESS', conclusion: null },
      ]),
    ).toBe('failing');
    expect(rollUpChecks([{ state: 'ERROR' }])).toBe('failing');
  });
});

describe('isAuthFailureStderr', () => {
  it('recognizes gh auth guidance', () => {
    expect(isAuthFailureStderr('To get started with GitHub CLI, please run:  gh auth login')).toBe(
      true,
    );
    expect(isAuthFailureStderr('HTTP 401: Bad credentials')).toBe(true);
  });

  it('does not misclassify other failures', () => {
    expect(isAuthFailureStderr('no pull requests found for branch "x"')).toBe(false);
    expect(isAuthFailureStderr('could not resolve to a Repository')).toBe(false);
  });
});
