import type { ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../lib/cn';

const components: Components = {
  a: ({ className, children, node: _node, ...rest }) => (
    <a
      className={cn('text-primary underline underline-offset-2 hover:opacity-80', className)}
      target="_blank"
      rel="noreferrer"
      {...rest}
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
  pre: ({ className, children, node: _node, ...rest }) => (
    <pre
      className={cn(
        'my-2 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[13px] leading-relaxed',
        className,
      )}
      {...rest}
    >
      {children}
    </pre>
  ),
  code: ({ className, children, node: _node, ...rest }) => {
    // Fenced blocks may carry no language class; treat multi-line content as a block too.
    const hasLanguage = typeof className === 'string' && className.includes('language-');
    const isBlock = hasLanguage || String(children).includes('\n');
    if (isBlock) {
      return (
        <code className={cn('font-mono', className)} {...rest}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...rest}>
        {children}
      </code>
    );
  },
  table: ({ className, children, node: _node, ...rest }) => (
    <table className={cn('my-2 w-full border-collapse text-[13px]', className)} {...rest}>
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

export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}): ReactElement {
  return (
    <div className={cn('break-words text-[14px] leading-relaxed', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
