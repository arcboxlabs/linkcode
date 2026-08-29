interface ParsedSemver {
  readonly major: string;
  readonly minor: string;
  readonly patch: string;
  readonly prerelease: readonly string[];
}

interface VersionComparator {
  readonly operator: '<' | '<=' | '=' | '>' | '>=';
  readonly version: ParsedSemver;
}

const RE_DECIMAL = /^(?:0|[1-9]\d*)$/;
const RE_NUMERIC_IDENTIFIER = /^\d+$/;
const RE_SEMVER_IDENTIFIER = /^[\dA-Z-]+$/i;

function compareDecimal(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function parseSemver(value: string): ParsedSemver | null {
  const plusParts = value.split('+');
  if (plusParts.length > 2) return null;
  const versionAndPrerelease = plusParts[0];
  const build = plusParts.length === 2 ? plusParts[1] : null;
  if (
    build !== null &&
    (build.length === 0 || build.split('.').some((part) => !RE_SEMVER_IDENTIFIER.test(part)))
  ) {
    return null;
  }
  const dashIndex = versionAndPrerelease.indexOf('-');
  const core = dashIndex === -1 ? versionAndPrerelease : versionAndPrerelease.slice(0, dashIndex);
  const prereleaseText = dashIndex === -1 ? undefined : versionAndPrerelease.slice(dashIndex + 1);
  const coreParts = core.split('.');
  if (coreParts.length !== 3 || coreParts.some((part) => !RE_DECIMAL.test(part))) return null;
  const prerelease = prereleaseText?.split('.') ?? [];
  if (
    prereleaseText === '' ||
    prerelease.some(
      (part) =>
        !RE_SEMVER_IDENTIFIER.test(part) ||
        (RE_NUMERIC_IDENTIFIER.test(part) && !RE_DECIMAL.test(part)),
    )
  ) {
    return null;
  }
  return {
    major: coreParts[0],
    minor: coreParts[1],
    patch: coreParts[2],
    prerelease,
  };
}

function compareSemver(left: ParsedSemver, right: ParsedSemver): number {
  const coreFields = ['major', 'minor', 'patch'] as const;
  for (let i = 0, len = coreFields.length; i < len; i++) {
    const field = coreFields[i];
    const comparison = compareDecimal(left[field], right[field]);
    if (comparison !== 0) return comparison;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.min(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === rightPart) continue;
    const leftNumeric = RE_NUMERIC_IDENTIFIER.test(leftPart);
    const rightNumeric = RE_NUMERIC_IDENTIFIER.test(rightPart);
    if (leftNumeric && rightNumeric) return compareDecimal(leftPart, rightPart);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  if (left.prerelease.length === right.prerelease.length) return 0;
  return left.prerelease.length < right.prerelease.length ? -1 : 1;
}

function parseVersionRange(value: string): readonly VersionComparator[] | null {
  if (value.length === 0 || value.trim() !== value) return null;
  const parts = value.split(' ');
  if (parts.some((part) => part.length === 0)) return null;
  const comparators: VersionComparator[] = [];
  for (let i = 0, len = parts.length; i < len; i++) {
    const part = parts[i];
    const operator = (['>=', '<=', '>', '<', '='] as const).find((candidate) =>
      part.startsWith(candidate),
    );
    if (!operator) return null;
    const version = parseSemver(part.slice(operator.length));
    if (!version) return null;
    comparators.push({ operator, version });
  }
  return comparators;
}

function comparatorMatches(comparison: number, operator: VersionComparator['operator']): boolean {
  switch (operator) {
    case '<':
      return comparison < 0;
    case '<=':
      return comparison <= 0;
    case '=':
      return comparison === 0;
    case '>':
      return comparison > 0;
    case '>=':
      return comparison >= 0;
    default:
      return false;
  }
}

export function isValidSemver(value: string): boolean {
  return parseSemver(value) !== null;
}

export function isValidVersionRange(value: string): boolean {
  return parseVersionRange(value) !== null;
}

export function matchesVersionRange(appVersion: string, range: string): boolean {
  const parsedVersion = parseSemver(appVersion);
  const comparators = parseVersionRange(range);
  if (!parsedVersion || !comparators) return false;
  return comparators.every((comparator) =>
    comparatorMatches(compareSemver(parsedVersion, comparator.version), comparator.operator),
  );
}
