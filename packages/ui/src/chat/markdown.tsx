import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../lib/cn';
import { CodeBlock } from './code-block';

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
  pre: ({ children }) => children,
  code({ className, children, node: _node, ...rest }) {
    // Fenced blocks may carry no language class; treat multi-line content as a block too.
    const text = reactNodeText(children);
    const language = codeLanguageFromClassName(className);
    const isBlock = Boolean(language) || text.includes('\n');
    if (isBlock) {
      return <CodeBlock code={trimTrailingMarkdownNewline(text)} language={language} />;
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

const LANGUAGE_CLASS_PREFIX = 'language-';

function codeLanguageFromClassName(className: string | undefined): string | undefined {
  if (!className) return undefined;
  return className
    .split(' ')
    .find((name) => name.startsWith(LANGUAGE_CLASS_PREFIX))
    ?.slice(LANGUAGE_CLASS_PREFIX.length);
}

function trimTrailingMarkdownNewline(value: string): string {
  return value.endsWith('\n') ? value.slice(0, -1) : value;
}

function reactNodeText(value: React.ReactNode): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(reactNodeText).join('');
  return '';
}

export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}): React.ReactNode {
  return (
    <div className={cn('break-words text-[14px] leading-relaxed', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
