import type { WorkspaceFile } from '@linkcode/schema';

/**
 * Fixtures answering `file.read` in the dev mock host, matched by path suffix. Shapes
 * mirror what the engine's file service returns for each encoding branch.
 */

const PLAN_MD = `# PLAN.md — Mock delivery plan

## Goals

Ship the files viewer behind the right panel's \`files\` section.

1. Message-level artifact cards for tool-produced files
2. Daemon-backed reads with workspace containment
3. Markdown / PDF / image viewers sharing the artifact kind registry

## Notes

Long-form markdown renders through the same Streamdown pipeline as chat, so tables,
code fences, and \`inline code\` all behave identically.

| Layer | Status |
| ----- | ------ |
| schema | done |
| engine | done |
| viewer | in progress |
`;

// A 1x1 transparent PNG (same bytes as the showcase image block).
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// A deliberately minimal PDF; pdfium rebuilds the missing xref table on load.
const PDF_SOURCE = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 320 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 46>>stream
BT /F1 18 Tf 60 100 Td (Mock PDF file) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
startxref
0
%%EOF
`;

/** Paths answering `file.list` — nested dirs, a flattenable single-child chain, and
 * suffixes `mockFileFixture` serves so tree clicks open real viewers. */
export const MOCK_WORKSPACE_FILES: readonly string[] = [
  'README.md',
  'PLAN.md',
  'assets/logo.png',
  'docs/reports/quarterly.pdf',
  'docs/notes.md',
  'src/app/main.md',
  'src/app/routes/dashboard.md',
  'src/lib/helpers.md',
];

export function mockFileFixture(cwd: string, requestPath: string): WorkspaceFile | null {
  const absolute = requestPath[0] === '/' ? requestPath : `${cwd}/${requestPath}`;
  const base = { path: absolute, mtimeMs: Date.now() };
  if (requestPath.endsWith('.md')) {
    return {
      ...base,
      size: PLAN_MD.length,
      encoding: 'utf8',
      content: PLAN_MD,
      mimeType: 'text/markdown',
    };
  }
  if (requestPath.endsWith('.png')) {
    return {
      ...base,
      size: 68,
      encoding: 'base64',
      content: PNG_BASE64,
      mimeType: 'image/png',
    };
  }
  if (requestPath.endsWith('.pdf')) {
    return {
      ...base,
      size: PDF_SOURCE.length,
      encoding: 'base64',
      content: btoa(PDF_SOURCE),
      mimeType: 'application/pdf',
    };
  }
  return null;
}
