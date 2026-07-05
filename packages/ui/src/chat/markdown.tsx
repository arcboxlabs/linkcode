import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import type { Components, PluginConfig } from 'streamdown';
import { Streamdown } from 'streamdown';
import { cn } from '../lib/cn';
import { ArtifactFenceRenderer, artifactFenceLanguages, useArtifactHostActions } from './artifacts';
import { detectInlineFilePath } from './artifacts/file-kind';

const INLINE_CODE_CLASS = 'rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]';

/** Inline code, upgraded to a file link when the span is a viewer-openable path and
 * the host wires `openFile` (degrades to plain code everywhere else). */
function InlineCode({
  className,
  children,
  node: _node,
  ...rest
}: React.ComponentProps<'code'> & { node?: unknown }): React.ReactNode {
  const actions = useArtifactHostActions();
  const openFile = actions?.openFile;
  const path = openFile && typeof children === 'string' ? detectInlineFilePath(children) : null;

  if (openFile && path !== null) {
    return (
      <button
        type="button"
        className={cn(
          INLINE_CODE_CLASS,
          'cursor-pointer underline decoration-dotted underline-offset-2 hover:bg-accent',
          className,
        )}
        onClick={() => openFile(path)}
      >
        {children}
      </button>
    );
  }
  return (
    <code className={cn(INLINE_CODE_CLASS, className)} {...rest}>
      {children}
    </code>
  );
}

// Typography overrides keep the chat-tuned look; fenced code blocks stay on
// Streamdown's defaults for shiki highlighting and copy controls.
const components: Components = {
  a: ({ className, children, node: _node, ...rest }) => (
    <a
      {...rest}
      className={cn('text-primary underline underline-offset-2 hover:opacity-80', className)}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  ),
  p: ({ className, children, node: _node, ...rest }) => (
    <p className={cn('my-2 first:mt-0 last:mb-0', className)} {...rest}>
      {children}
    </p>
  ),
  h1: ({ className, children, node: _node, ...rest }) => (
    <h1 className={cn('mt-4 mb-2 font-semibold text-lg', className)} {...rest}>
      {children}
    </h1>
  ),
  h2: ({ className, children, node: _node, ...rest }) => (
    <h2 className={cn('mt-4 mb-2 font-semibold text-base', className)} {...rest}>
      {children}
    </h2>
  ),
  h3: ({ className, children, node: _node, ...rest }) => (
    <h3 className={cn('mt-3 mb-1.5 font-semibold text-sm', className)} {...rest}>
      {children}
    </h3>
  ),
  ul: ({ className, children, node: _node, ...rest }) => (
    <ul className={cn('my-2 list-disc space-y-1 pl-5', className)} {...rest}>
      {children}
    </ul>
  ),
  ol: ({ className, children, node: _node, ...rest }) => (
    <ol className={cn('my-2 list-decimal space-y-1 pl-5', className)} {...rest}>
      {children}
    </ol>
  ),
  li: ({ className, children, node: _node, ...rest }) => (
    <li className={cn('leading-relaxed', className)} {...rest}>
      {children}
    </li>
  ),
  blockquote: ({ className, children, node: _node, ...rest }) => (
    <blockquote
      className={cn('my-2 border-l-2 border-border pl-3 italic text-muted-foreground', className)}
      {...rest}
    >
      {children}
    </blockquote>
  ),
  inlineCode: InlineCode,
  table: ({ className, children, node: _node, ...rest }) => (
    <table className={cn('my-2 w-full border-collapse text-sm', className)} {...rest}>
      {children}
    </table>
  ),
  th: ({ className, children, node: _node, ...rest }) => (
    <th
      className={cn('border border-border bg-muted px-2 py-1 text-left font-semibold', className)}
      {...rest}
    >
      {children}
    </th>
  ),
  td: ({ className, children, node: _node, ...rest }) => (
    <td className={cn('border border-border px-2 py-1', className)} {...rest}>
      {children}
    </td>
  ),
  hr: ({ className, node: _node, ...rest }) => (
    <hr className={cn('my-3 border-border', className)} {...rest} />
  ),
  strong: ({ className, children, node: _node, ...rest }) => (
    <strong className={cn('font-semibold', className)} {...rest}>
      {children}
    </strong>
  ),
  em: ({ className, children, node: _node, ...rest }) => (
    <em className={cn('italic', className)} {...rest}>
      {children}
    </em>
  ),
};

const plugins: PluginConfig = {
  cjk,
  code,
  // Fences whose language a registered artifact kind claims render as inline
  // artifacts; everything else stays on the default shiki code block. The language
  // list is snapshotted here, hence the module-scope registration constraint
  // documented in artifacts/registry.ts.
  renderers: [{ language: artifactFenceLanguages(), component: ArtifactFenceRenderer }],
};

export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}): React.ReactNode {
  return (
    <Streamdown
      // space-y-0: block rhythm comes from the per-element my-* overrides above,
      // matching the previous react-markdown renderer.
      className={cn('space-y-0 break-words text-sm leading-relaxed', className)}
      components={components}
      plugins={plugins}
    >
      {children}
    </Streamdown>
  );
}
