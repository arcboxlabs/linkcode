export interface ParsedStackFrame {
  raw: string;
  functionName?: string;
  filePath?: string;
  lineNumber?: number;
  columnNumber?: number;
  isInternal: boolean;
}

export interface ParsedStackTrace {
  errorType?: string;
  errorMessage: string;
  frames: ParsedStackFrame[];
}

interface ParsedStackLocation {
  filePath: string;
  lineNumber: number;
  columnNumber: number;
}

export function parseStackTrace(trace: string): ParsedStackTrace {
  const lines: string[] = [];
  for (const line of trace.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0) lines.push(trimmed);
  }

  const firstLine = lines[0]?.trim() ?? '';
  const error = parseErrorLine(firstLine);
  const frames: ParsedStackFrame[] = [];
  for (const line of lines.slice(1)) {
    if (line.startsWith('at ')) frames.push(parseStackFrame(line));
  }

  return {
    errorType: error.errorType,
    errorMessage: error.errorMessage,
    frames,
  };
}

function parseErrorLine(line: string): Pick<ParsedStackTrace, 'errorMessage' | 'errorType'> {
  const separator = line.indexOf(':');
  if (separator <= 0) return { errorMessage: line };

  const possibleType = line.slice(0, separator);
  if (possibleType === 'Error' || possibleType.endsWith('Error')) {
    return {
      errorType: possibleType,
      errorMessage: line.slice(separator + 1).trimStart(),
    };
  }

  return { errorMessage: line };
}

function parseStackFrame(line: string): ParsedStackFrame {
  const trimmed = line.trim();
  const body = trimmed.startsWith('at ') ? trimmed.slice(3) : trimmed;
  let functionName: string | undefined;
  let frameLocation = body;

  const locationStart = body.lastIndexOf(' (');
  if (locationStart >= 0 && body.endsWith(')')) {
    functionName = body.slice(0, locationStart);
    frameLocation = body.slice(locationStart + 2, -1);
  }

  const parsedLocation = parseStackLocation(frameLocation);
  if (parsedLocation) {
    return {
      raw: trimmed,
      functionName,
      ...parsedLocation,
      isInternal: isInternalPath(parsedLocation.filePath),
    };
  }

  return {
    raw: trimmed,
    functionName,
    isInternal: isInternalPath(trimmed),
  };
}

function parseStackLocation(location: string): ParsedStackLocation | null {
  const columnSeparator = location.lastIndexOf(':');
  if (columnSeparator < 0) return null;

  const lineSeparator = location.lastIndexOf(':', columnSeparator - 1);
  if (lineSeparator < 0) return null;

  const filePath = location.slice(0, lineSeparator);
  const lineNumber = Number.parseInt(location.slice(lineSeparator + 1, columnSeparator), 10);
  const columnNumber = Number.parseInt(location.slice(columnSeparator + 1), 10);
  if (!Number.isFinite(lineNumber) || !Number.isFinite(columnNumber)) return null;

  return { columnNumber, filePath, lineNumber };
}

function isInternalPath(path: string): boolean {
  return path.includes('node_modules') || path.startsWith('node:') || path.includes('internal/');
}

export function formatStackLocationPart(value: number | undefined): string {
  return typeof value === 'number' ? `:${value}` : '';
}
