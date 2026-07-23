import { cjk } from '@streamdown/cjk';
import { Badge } from 'coss-ui/components/badge';
import { Checkbox } from 'coss-ui/components/checkbox';
import { Frame } from 'coss-ui/components/frame';
import { Separator } from 'coss-ui/components/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from 'coss-ui/components/table';
import type { Element, Root } from 'hast';
import { isValidElement, useId } from 'react';
import rehypeSlug from 'rehype-slug';
import type { Components, PluginConfig, StreamdownProps } from 'streamdown';
import { defaultRehypePlugins, Streamdown, useIsCodeFenceIncomplete } from 'streamdown';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';
import { cn } from '../lib/cn';
import { ArtifactFenceRenderer } from './artifacts/fence-renderer';
import { detectInlineFilePath } from './artifacts/file-kind';
import { LinkChip } from './link-chip';
import { Favicon } from './link-icon';
import { linkTargetFor } from './link-target';
import { useSmoothText } from './smooth-text-controller';

const INLINE_CODE_CLASS = 'rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]';
const NON_WORD_RE = /\W/g;
/** Streamdown's bundled rehype-sanitize clobbers every id with this prefix; hrefs are not
 * clobbered, so scopeFragmentIdentifiers bakes it into rewritten fragment hrefs up front. */
const SANITIZED_ID_PREFIX = 'user-content-';

interface ScopeFragmentIdentifiersOptions {
  prefix: string;
}

/** Scope every id — heading slugs, footnote ids, raw-HTML ids — to one Markdown instance, and
 * rewrite fragment hrefs to the exact form those ids take once sanitize clobbers them. Ids can
 * then never collide across chat messages, and every fragment href equals its target's DOM id. */
const scopeFragmentIdentifiers: Plugin<[ScopeFragmentIdentifiersOptions], Root> =
  ({ prefix }) =>
  (tree) => {
    visit(tree, 'element', (node) => {
      const id = node.properties.id;
      if (typeof id === 'string' && id.length > 0) {
        node.properties.id = `${prefix}${id}`;
      }
      const href = node.properties.href;
      if (typeof href === 'string' && node.tagName === 'a' && href[0] === '#') {
        node.properties.href = `#${SANITIZED_ID_PREFIX}${prefix}${href.slice(1)}`;
      }
    });
  };

/** Inline code, upgraded to the shared file chip when the span is a viewer-openable path
 * (LinkChip resolves opening — video → browser preview, else the file viewer — and stays an
 * inert chip when the host wires nothing); plain code everywhere else. */
function InlineCode({
  className,
  children,
  node: _node,
  ...rest
}: React.ComponentProps<'code'> & { node?: unknown }): React.ReactNode {
  const path = typeof children === 'string' ? detectInlineFilePath(children) : null;
  if (path !== null) {
    return (
      <LinkChip className={className} target={{ kind: 'file', path }}>
        {children}
      </LinkChip>
    );
  }
  return (
    <code className={cn(INLINE_CODE_CLASS, className)} {...rest}>
      {children}
    </code>
  );
}

const FENCE_LANGUAGE_RE = /language-(\S+)/;
const TRAILING_NEWLINES_RE = /\n+$/;

/** The fence text child is a plain string, except while the animate plugin wraps it. */
function fenceText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (isValidElement<{ children?: unknown }>(children)) {
    const inner = children.props.children;
    if (typeof inner === 'string') return inner;
  }
  return '';
}

/** Every fenced block routes through the artifact pipeline: registry-claimed languages render
 * inline artifacts, everything else degrades to the coss-ui CodeBlock via FenceFallback. */
function FencedCode({
  className,
  children,
  node,
}: React.ComponentProps<'code'> & { node?: Element }): React.ReactNode {
  const isIncomplete = useIsCodeFenceIncomplete();
  const language = FENCE_LANGUAGE_RE.exec(className ?? '')?.[1] ?? '';
  const metastring = node?.properties.metastring;
  return (
    <ArtifactFenceRenderer
      code={fenceText(children).replace(TRAILING_NEWLINES_RE, '')}
      language={language}
      meta={typeof metastring === 'string' ? metastring : undefined}
      isIncomplete={isIncomplete}
    />
  );
}

/** Anchor hashes may be percent-encoded (CJK heading slugs) while element ids are not. */
function decodeFragment(hash: string): string {
  try {
    return decodeURIComponent(hash);
  } catch {
    return hash;
  }
}

/** The nearest ancestor that actually scrolls vertically. Never fall back to scrollIntoView:
 * it walks every ancestor — overflow-hidden layout boxes included — and shoves the app chrome. */
function nearestScrollContainer(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const { overflowY } = window.getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
}

function scrollToFragment(event: React.MouseEvent<HTMLAnchorElement>, id: string): void {
  // Fragment navigation must stay in-page even when nothing resolves: the native fallthrough
  // is a real navigation (hash/router side effects; the desktop untrusted-link surface).
  event.preventDefault();
  const target = event.currentTarget.ownerDocument.getElementById(id);
  if (!target) return;
  const scrollContainer =
    event.currentTarget.closest<HTMLElement>('[data-markdown-scroll-container]') ??
    nearestScrollContainer(target);
  if (!scrollContainer) return;
  scrollContainer.scrollTo({
    top:
      scrollContainer.scrollTop +
      target.getBoundingClientRect().top -
      scrollContainer.getBoundingClientRect().top,
  });
}

type MarkdownAnchorProps = React.ComponentProps<'a'> & {
  node?: unknown;
  'data-footnote-ref'?: boolean;
  'data-footnote-backref'?: boolean;
};

function MarkdownLink({
  className,
  children,
  node: _node,
  href,
  'data-footnote-ref': footnoteRef,
  'data-footnote-backref': footnoteBackref,
  ...rest
}: MarkdownAnchorProps): React.ReactNode {
  const fragment = href?.[0] === '#' ? href.slice(1) : null;
  const anchorProps: Omit<MarkdownAnchorProps, 'node'> = {
    ...rest,
    'data-footnote-ref': footnoteRef,
    'data-footnote-backref': footnoteBackref,
    href,
    target: fragment === null ? '_blank' : undefined,
    rel: fragment === null ? 'noreferrer' : undefined,
    onClick:
      fragment === null
        ? undefined
        : (event) => {
            // scopeFragmentIdentifiers rewrote every fragment href to its target's exact
            // DOM id, so resolution is a single lookup (decoded: CJK slugs percent-encode).
            scrollToFragment(event, decodeFragment(fragment));
          },
  };
  // Footnote citations and their back-references render as compact badge chips; the badge
  // supplies its own type scale, so the surrounding sup/section size never distorts them.
  if (footnoteRef !== undefined || footnoteBackref !== undefined) {
    return (
      <Badge
        size="sm"
        variant={footnoteRef === undefined ? 'outline' : 'secondary'}
        className={cn('tabular-nums', className)}
        render={<a {...anchorProps}>{children}</a>}
      />
    );
  }
  const target = linkTargetFor(href);
  // Mention links (plugin/skill/file) render as chips, never anchors: an absolute-path or
  // plugin href reaching native navigation would 404 the SPA or leak to the OS.
  if (target !== null && target.kind !== 'web') {
    return (
      <LinkChip className={className} target={target}>
        {children}
      </LinkChip>
    );
  }

  return (
    <a
      {...anchorProps}
      className={cn('text-primary underline underline-offset-2 hover:opacity-80', className)}
    >
      {target === null ? null : <Favicon hostname={target.hostname} className="me-1" />}
      {children}
    </a>
  );
}

// Chat-tuned typography on coss-ui primitives. Fenced code routes through the artifact
// pipeline (FencedCode), so Streamdown's own fence chrome and code plugin are unused.
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
  // Streamdown's h4-h6 defaults (text-lg/text-base) would outsize the h1 above.
  h4: ({ className, children, node: _node, ...rest }) => (
    <h4 className={cn('mt-3 mb-1.5 font-semibold text-sm first:mt-0', className)} {...rest}>
      {children}
    </h4>
  ),
  h5: ({ className, children, node: _node, ...rest }) => (
    <h5 className={cn('mt-3 mb-1.5 font-medium text-sm first:mt-0', className)} {...rest}>
      {children}
    </h5>
  ),
  h6: ({ className, children, node: _node, ...rest }) => (
    <h6
      className={cn('mt-3 mb-1.5 font-medium text-muted-foreground text-sm first:mt-0', className)}
      {...rest}
    >
      {children}
    </h6>
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
    <li
      className={cn(
        'leading-relaxed',
        className?.includes('task-list-item') && 'list-none',
        className,
      )}
      {...rest}
    >
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
  code: FencedCode,
  // Sanitize forces every surviving <input> into a disabled checkbox (GFM task lists).
  input: ({ className, checked }) => (
    <Checkbox
      checked={Boolean(checked)}
      disabled
      className={cn('me-1.5 align-text-bottom', className)}
    />
  ),
  // Streamdown's default forces text-sm, defeating native superscript sizing (footnote refs).
  sup: ({ className, children, node: _node, ...rest }) => (
    <sup className={className} {...rest}>
      {children}
    </sup>
  ),
  // The coss.com "framed card" table particle (p-table-2): Frame chrome around a card-variant
  // table, whose header sits on the muted frame and whose body is the rounded card surface.
  table: ({ className, children, node: _node, ...rest }) => (
    <Frame className="my-2">
      <Table variant="card" className={className} {...rest}>
        {children}
      </Table>
    </Frame>
  ),
  thead: ({ className, children, node: _node, ...rest }) => (
    <TableHeader className={className} {...rest}>
      {children}
    </TableHeader>
  ),
  tbody: ({ className, children, node: _node, ...rest }) => (
    <TableBody className={className} {...rest}>
      {children}
    </TableBody>
  ),
  tr: ({ className, children, node: _node, ...rest }) => (
    <TableRow className={className} {...rest}>
      {children}
    </TableRow>
  ),
  // whitespace-normal + line height: the coss-ui data-grid cells assume single-line content,
  // but Markdown tables carry prose.
  th: ({ className, children, node: _node, ...rest }) => (
    <TableHead className={cn('whitespace-normal leading-normal', className)} {...rest}>
      {children}
    </TableHead>
  ),
  td: ({ className, children, node: _node, ...rest }) => (
    <TableCell className={cn('whitespace-normal leading-normal', className)} {...rest}>
      {children}
    </TableCell>
  ),
  hr: ({ className }) => <Separator className={cn('my-3', className)} />,
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

const plugins: PluginConfig = { cjk };

// remark-gfm appends footnote definitions as a trailing <section data-footnotes>; set it off
// from the body the way GitHub does. Styled from here because overriding `section` would lose
// Streamdown's empty-footnote filtering during streaming.
const FOOTNOTE_SECTION_CLASS =
  '[&_section[data-footnotes]]:mt-4 [&_section[data-footnotes]]:border-t [&_section[data-footnotes]]:border-border [&_section[data-footnotes]]:pt-3 [&_section[data-footnotes]]:text-muted-foreground [&_section[data-footnotes]]:text-xs';

type RehypePlugins = NonNullable<StreamdownProps['rehypePlugins']>;

const defaultRehypePluginNames = Object.keys(defaultRehypePlugins);
const rawRehypePluginIndex = defaultRehypePluginNames.indexOf('raw');

interface SanitizeSchemaLike {
  protocols?: { href?: unknown };
}

/** Streamdown's bundled sanitize schema drops hrefs with unknown protocols; mention links
 * (`plugin://…`) must survive to MarkdownLink, so the sanitize options tuple is cloned with
 * the protocol allowed. Absolute-path mentions already pass as relative URLs. */
function allowMentionLinkProtocols(entry: RehypePlugins[number]): RehypePlugins[number] {
  const [plugin, schema] = Array.isArray(entry) ? entry : [];
  const protocols = (schema as SanitizeSchemaLike | undefined)?.protocols;
  const href = protocols?.href;
  if (plugin === undefined || !Array.isArray(href)) {
    throw new Error('Streamdown sanitize schema changed shape; mention links would be stripped');
  }
  return [
    plugin,
    { ...(schema as SanitizeSchemaLike), protocols: { ...protocols, href: [...href, 'plugin'] } },
  ];
}

const defaultRehypePluginValues = Object.values(defaultRehypePlugins).map((entry, index) =>
  defaultRehypePluginNames[index] === 'sanitize' ? allowMentionLinkProtocols(entry) : entry,
);

function createMarkdownRehypePlugins(scopePrefix: string): RehypePlugins {
  if (rawRehypePluginIndex < 0) {
    throw new Error('Streamdown raw HTML parsing is required for Markdown heading anchors');
  }
  const defaults = defaultRehypePluginValues;
  const scopePlugin: RehypePlugins[number] = [scopeFragmentIdentifiers, { prefix: scopePrefix }];
  return [
    ...defaults.slice(0, rawRehypePluginIndex + 1),
    // Slug headings first so freshly assigned ids get scoped along with everything else.
    rehypeSlug,
    scopePlugin,
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
  /** Parse as one static document so repeated-heading slugs dedupe document-wide (file and
   * preview surfaces). Heading anchors themselves resolve on every surface. */
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
  const markdownId = useId();
  const scopePrefix = `markdown-${markdownId.replaceAll(NON_WORD_RE, '')}-`;
  return (
    <Streamdown
      // space-y-0: block rhythm comes from the per-element my-* overrides above,
      // matching the previous react-markdown renderer.
      className={cn(
        'space-y-0 break-words text-sm leading-relaxed',
        FOOTNOTE_SECTION_CLASS,
        className,
      )}
      components={components}
      animated={animated}
      plugins={plugins}
      // Static mode parses the whole document in one pass, so repeated headings dedupe
      // across the document; chat stays in streaming mode and slugs per block.
      mode={headingAnchors ? 'static' : undefined}
      rehypePlugins={createMarkdownRehypePlugins(scopePrefix)}
    >
      {children}
    </Streamdown>
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
