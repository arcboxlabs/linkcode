import { CodeBlock, CodeBlockActions, CodeBlockCopyButton } from '../code-block';

/** The degradation target for every artifact path (unknown kind, render failure):
 * the fence shows as a plain code block, exactly what a non-artifact fence would be. */
export function FenceFallback({
  code,
  language,
  note,
}: {
  code: string;
  language: string;
  /** Short translated note explaining why the artifact degraded (e.g. render failure). */
  note?: string;
}): React.ReactNode {
  return (
    <CodeBlock code={code} language={language} title={language}>
      {note ? <span className="text-muted-foreground">{note}</span> : null}
      <CodeBlockActions>
        <CodeBlockCopyButton code={code} />
      </CodeBlockActions>
    </CodeBlock>
  );
}
