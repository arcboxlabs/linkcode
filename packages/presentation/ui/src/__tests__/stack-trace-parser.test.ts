import { describe, expect, it } from 'vitest';
import { formatStackLocationPart, parseStackTrace } from '../chat/stack-trace-parser';

describe('parseStackTrace error line', () => {
  it('recognizes a leading `SomethingError:` prefix as the error type', () => {
    const parsed = parseStackTrace('TypeError: value is not a function');
    expect(parsed.errorType).toBe('TypeError');
    expect(parsed.errorMessage).toBe('value is not a function');
  });

  it('recognizes the bare `Error:` prefix as the error type', () => {
    const parsed = parseStackTrace('Error: boom');
    expect(parsed.errorType).toBe('Error');
    expect(parsed.errorMessage).toBe('boom');
  });

  it('treats a colon-bearing line with a non-Error prefix as plain message text', () => {
    const parsed = parseStackTrace('unexpected: yes');
    expect(parsed.errorType).toBeUndefined();
    expect(parsed.errorMessage).toBe('unexpected: yes');
  });

  it('treats a line with no colon as plain message text', () => {
    const parsed = parseStackTrace('something failed');
    expect(parsed.errorType).toBeUndefined();
    expect(parsed.errorMessage).toBe('something failed');
  });

  it('drops blank lines before finding the error line', () => {
    const parsed = parseStackTrace('\n\n  RangeError: out of bounds\n');
    expect(parsed.errorType).toBe('RangeError');
    expect(parsed.errorMessage).toBe('out of bounds');
  });
});

describe('parseStackTrace frames', () => {
  it('splits a parenthesized frame into function name, file path, line, and column', () => {
    const parsed = parseStackTrace(
      ['Error: boom', 'at Object.doThing (/app/src/index.js:10:5)'].join('\n'),
    );
    expect(parsed.frames).toEqual([
      {
        raw: 'at Object.doThing (/app/src/index.js:10:5)',
        functionName: 'Object.doThing',
        filePath: '/app/src/index.js',
        lineNumber: 10,
        columnNumber: 5,
        isInternal: false,
      },
    ]);
  });

  it('parses a bare `at file:line:column` frame with no function name', () => {
    const parsed = parseStackTrace(['Error: boom', 'at /app/src/index.js:12:34'].join('\n'));
    expect(parsed.frames).toEqual([
      {
        raw: 'at /app/src/index.js:12:34',
        functionName: undefined,
        filePath: '/app/src/index.js',
        lineNumber: 12,
        columnNumber: 34,
        isInternal: false,
      },
    ]);
  });

  it('ignores non-frame lines interleaved with `at` frames', () => {
    const parsed = parseStackTrace(
      ['Error: boom', 'caused by:', 'at /app/src/index.js:1:1'].join('\n'),
    );
    expect(parsed.frames).toHaveLength(1);
    expect(parsed.frames[0]?.filePath).toBe('/app/src/index.js');
  });

  it('falls back to the raw line when the location has no line:column suffix', () => {
    const parsed = parseStackTrace(['Error: boom', 'at eval'].join('\n'));
    expect(parsed.frames).toEqual([
      {
        raw: 'at eval',
        functionName: undefined,
        isInternal: false,
      },
    ]);
  });

  it('falls back to the raw line when the location is missing a column', () => {
    const parsed = parseStackTrace(['Error: boom', 'at foo (/app/src/index.js:10)'].join('\n'));
    const [frame] = parsed.frames;
    expect(frame.filePath).toBeUndefined();
    expect(frame.lineNumber).toBeUndefined();
  });

  it('flags frames under node_modules, node: built-ins, and internal/ as internal', () => {
    const parsed = parseStackTrace(
      [
        'Error: boom',
        'at dep (/app/node_modules/pkg/index.js:1:1)',
        'at internalFn (node:internal/process:5:5)',
        'at other (/app/internal/util.js:2:2)',
      ].join('\n'),
    );
    expect(parsed.frames.map((f) => f.isInternal)).toEqual([true, true, true]);
  });
});

describe('formatStackLocationPart', () => {
  it('prefixes a defined number with a colon', () => {
    expect(formatStackLocationPart(5)).toBe(':5');
    expect(formatStackLocationPart(0)).toBe(':0');
  });

  it('returns an empty string for undefined', () => {
    expect(formatStackLocationPart(undefined)).toBe('');
  });
});
