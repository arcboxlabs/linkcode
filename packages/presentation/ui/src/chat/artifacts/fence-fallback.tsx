import { ChatCardActions } from '../chat-card';
import { CodeBlock, CodeBlockCopyButton } from '../code-block';

/** The degradation target for every artifact path (unknown kind, render failure):
 * the fence shows as a plain code block, exactly what a non-artifact fence would be. */
export function FenceFallback({
  code,
  language,
  note,
  action,
}: {
  code: string;
  language: string;
  /** Short translated note explaining why the artifact degraded (e.g. render failure). */
  note?: string;
  /** Optional artifact action placed before Copy in the source header. */
  action?: React.ReactNode;
}): React.ReactNode {
  return (
    <CodeBlock code={code} language={language} title={language}>
      <ChatCardActions>
        {note ? <span className="min-w-0 truncate text-muted-foreground">{note}</span> : null}
        {action}
        <CodeBlockCopyButton code={code} />
      </ChatCardActions>
    </CodeBlock>
  );
}
