import { Fragment } from 'react';
import { mcpToolName } from '../tool-utils';
import type { ToolSearchPresentation } from './tool-result-content';

/** A ToolSearch settle: the loaded tools as one inline line (the humanized header already says
 * what happened); MCP slugs shed their envelope, keeping the server as a muted suffix. */
export function ToolSearchResult({
  presentation,
}: {
  presentation: ToolSearchPresentation;
}): React.ReactNode {
  const { names, message } = presentation;
  if (names.length === 0) {
    return message ? (
      <p className="whitespace-pre-wrap break-words text-muted-foreground text-sm">{message}</p>
    ) : null;
  }
  return (
    <p className="min-w-0 break-words font-mono text-xs leading-relaxed">
      {names.map((name, index) => {
        const mcp = mcpToolName(name);
        return (
          <Fragment key={name}>
            {index > 0 ? ', ' : null}
            {mcp?.tool ?? name}
            {mcp ? <span className="text-muted-foreground"> ({mcp.server})</span> : null}
          </Fragment>
        );
      })}
    </p>
  );
}
