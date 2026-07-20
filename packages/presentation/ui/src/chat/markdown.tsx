import { cjk } from '@streamdown/cjk';
import { createCodePlugin } from '@streamdown/code';
import { createContext, useContext, useId } from 'react';
import rehypeSlug from 'rehype-slug';
import type { Components, PluginConfig, StreamdownProps } from 'streamdown';
import { defaultRehypePlugins, Streamdown } from 'streamdown';
import { cn } from '../lib/cn';
import { useRenderPrefs } from '../render-prefs';
import { ArtifactFenceRenderer } from './artifacts/fence-renderer';
import { detectInlineFilePath } from './artifacts/file-kind';
import { useArtifactHostActions } from './artifacts/host-actions';
import { artifactFenceLanguages } from './artifacts/registry';
import { useSmoothText } from './smooth-text-controller';

const INLINE_CODE_CLASS = 'rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]';
const NON_WORD_RE = /\W/g;
const SANITIZED_HEADING_PREFIX = 'user-content-';
const MarkdownHeadingPrefixContext = createContext<string | null>(null);

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

function MarkdownLink({
  className,
  children,
  node: _node,
  href,
  ...rest
}: React.ComponentProps<'a'> & { node?: unknown }): React.ReactNode {
  const headingPrefix = useContext(MarkdownHeadingPrefixContext);
  const isFragment = href?.[0] === '#';
  const fragmentHref =
    isFragment && headingPrefix
      ? `#${SANITIZED_HEADING_PREFIX}${headingPrefix}${href.slice(1)}`
      : undefined;
  return (
    <a
      {...rest}
      className={cn('text-primary underline underline-offset-2 hover:opacity-80', className)}
      href={fragmentHref ?? href}
      target={isFragment ? undefined : '_blank'}
      rel={isFragment ? undefined : 'noreferrer'}
      onClick={
        fragmentHref
          ? (event) => {
              const target = event.currentTarget.ownerDocument.getElementById(
                fragmentHref.slice(1),
              );
              if (target) {
                event.preventDefault();
                const scrollContainer = event.currentTarget.closest<HTMLElement>(
                  '[data-markdown-scroll-container]',
                );
                if (!scrollContainer) {
                  target.scrollIntoView({ block: 'start' });
                  return;
                }
                scrollContainer.scrollTo({
                  top:
                    scrollContainer.scrollTop +
                    target.getBoundingClientRect().top -
                    scrollContainer.getBoundingClientRect().top,
                });
              }
            }
          : undefined
      }
    >
      {children}
    </a>
  );
}

// Typography overrides keep the chat-tuned look; fenced code blocks stay on
// Streamdown's defaults for shiki highlighting and copy controls.
const components: Components = {
  a: MarkdownLink,
  p: ({ className, children, node: _node, ...rest }) => (
    <p className={cn('my-2 first:mt-0 last:mb-0', className)} {...rest}>
      {children}
    </p>
  ),
  h1: ({ className, children, node: _node, ...rest }) => (
    <h1 className={cn('mt-4 mb-2 font-semibold text-lg first:mt-0', className)} {...rest}>
      {children}
    </h1>
  ),
  h2: ({ className, children, node: _node, ...rest }) => (
    <h2 className={cn('mt-4 mb-2 font-semibold text-base first:mt-0', className)} {...rest}>
      {children}
    </h2>
  ),
  h3: ({ className, children, node: _node, ...rest }) => (
    <h3 className={cn('mt-3 mb-1.5 font-semibold text-sm first:mt-0', className)} {...rest}>
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

// Artifact-claimed fence languages render as inline artifacts. The language list is snapshotted
// here, hence the module-scope registration constraint documented in artifacts/registry.ts.
const artifactRenderers = [
  { language: artifactFenceLanguages(), component: ArtifactFenceRenderer },
];

type RehypePlugins = NonNullable<StreamdownProps['rehypePlugins']>;

const defaultRehypePluginNames = Object.keys(defaultRehypePlugins);
const rawRehypePluginIndex = defaultRehypePluginNames.indexOf('raw');

function createMarkdownRehypePlugins(headingPrefix: string): RehypePlugins {
  if (rawRehypePluginIndex < 0) {
    throw new Error('Streamdown raw HTML parsing is required for Markdown heading anchors');
  }
  const defaults = Object.values(defaultRehypePlugins);
  const headingSlugPlugin: RehypePlugins[number] = [rehypeSlug, { prefix: headingPrefix }];
  return [
    ...defaults.slice(0, rawRehypePluginIndex + 1),
    headingSlugPlugin,
    ...defaults.slice(rawRehypePluginIndex + 1),
  ];
}

const INSTANT_STREAM_ANIMATION = {
  duration: 0,
  stagger: 0,
} satisfies NonNullable<StreamdownProps['animated']>;

interface MarkdownProps {
  children: string;
  className?: string;
  animated?: StreamdownProps['animated'];
  headingAnchors?: boolean;
}

interface SmoothMarkdownProps extends MarkdownProps {
  isStreaming: boolean;
}

export function Markdown({
  children,
  className,
  animated,
  headingAnchors = false,
}: MarkdownProps): React.ReactNode {
  const { codeTheme } = useRenderPrefs();
  const markdownId = useId();
  const headingPrefix = `markdown-${markdownId.replaceAll(NON_WORD_RE, '')}-`;
  // The @streamdown/code plugin's getThemes() wins over the shikiTheme prop, so the selected theme
  // must be baked into the plugin. createCodePlugin is cheap — its highlighter is created lazily.
  const plugins: PluginConfig = {
    cjk,
    code: createCodePlugin({ themes: codeTheme }),
    renderers: artifactRenderers,
  };
  const content = (
    <Streamdown
      // space-y-0: block rhythm comes from the per-element my-* overrides above,
      // matching the previous react-markdown renderer.
      className={cn('space-y-0 break-words text-sm leading-relaxed', className)}
      components={components}
      animated={animated}
      plugins={plugins}
      mode={headingAnchors ? 'static' : undefined}
      rehypePlugins={headingAnchors ? createMarkdownRehypePlugins(headingPrefix) : undefined}
    >
      {children}
    </Streamdown>
  );
  return headingAnchors ? (
    <MarkdownHeadingPrefixContext.Provider value={headingPrefix}>
      {content}
    </MarkdownHeadingPrefixContext.Provider>
  ) : (
    content
  );
}

/** Markdown whose append-only source growth is drained from a small presentation buffer. */
export function SmoothMarkdown({
  children,
  isStreaming,
  ...props
}: SmoothMarkdownProps): React.ReactNode {
  const visibleText = useSmoothText(children, isStreaming);
  return (
    <Markdown {...props} animated={INSTANT_STREAM_ANIMATION}>
      {visibleText}
    </Markdown>
  );
}
