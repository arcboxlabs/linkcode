/* eslint-disable @eslint-react/no-array-index-key -- mdast nodes carry no ids; every parse
   replaces the whole tree, so per-render index keys are stable. */
import type { ListItem, PhrasingContent, RootContent } from 'mdast';
import { Linking, Text, View } from 'react-native';
import { CodeBlock } from './code-block';
import { parseMarkdown } from './parse';

const MONO = { fontFamily: 'Menlo', fontSize: 13 } as const;

function renderInline(nodes: PhrasingContent[]): React.ReactNode {
  return nodes.map((node, key) => {
    switch (node.type) {
      case 'text':
        return node.value;
      case 'strong':
        return (
          <Text key={key} className="font-semibold">
            {renderInline(node.children)}
          </Text>
        );
      case 'emphasis':
        return (
          <Text key={key} className="italic">
            {renderInline(node.children)}
          </Text>
        );
      case 'delete':
        return (
          <Text key={key} className="line-through text-muted">
            {renderInline(node.children)}
          </Text>
        );
      case 'inlineCode':
        return (
          <Text key={key} className="bg-surface-secondary text-foreground" style={MONO}>
            {node.value}
          </Text>
        );
      case 'link':
        return (
          <Text
            key={key}
            className="text-accent underline"
            onPress={() => {
              void Linking.openURL(node.url);
            }}
          >
            {renderInline(node.children)}
          </Text>
        );
      case 'break':
        return '\n';
      case 'image':
        return (
          <Text key={key} className="italic text-muted">
            [{node.alt || 'image'}]
          </Text>
        );
      default:
        return 'value' in node ? (
          <Text key={key} style={MONO}>
            {node.value}
          </Text>
        ) : null;
    }
  });
}

function renderListItem(item: ListItem, key: number, ordered: boolean, start: number) {
  const marker =
    item.checked === undefined || item.checked === null
      ? ordered
        ? `${start + key}.`
        : '•'
      : item.checked
        ? '☑'
        : '☐';
  return (
    <View key={key} className="flex-row gap-2">
      <Text className="text-body text-muted">{marker}</Text>
      <View className="min-w-0 flex-1 gap-1">
        {item.children.map((child, index) => renderBlock(child, index))}
      </View>
    </View>
  );
}

function renderBlock(node: RootContent, key: number): React.ReactNode {
  switch (node.type) {
    case 'paragraph':
      return (
        <Text key={key} className="text-body text-foreground">
          {renderInline(node.children)}
        </Text>
      );
    case 'heading': {
      const size =
        node.depth === 1
          ? 'font-bold text-title'
          : node.depth === 2
            ? 'font-semibold text-headline'
            : 'font-semibold text-body';
      return (
        <Text key={key} className={`${size} text-foreground`}>
          {renderInline(node.children)}
        </Text>
      );
    }
    case 'code':
      return <CodeBlock key={key} code={node.value} lang={node.lang ?? undefined} />;
    case 'list':
      return (
        <View key={key} className="gap-1">
          {node.children.map((item, index) =>
            renderListItem(item, index, node.ordered ?? false, node.start ?? 1),
          )}
        </View>
      );
    case 'blockquote':
      return (
        <View key={key} className="gap-2 border-border border-l-2 pl-3 opacity-80">
          {node.children.map((child, index) => renderBlock(child, index))}
        </View>
      );
    case 'thematicBreak':
      return <View key={key} className="my-1 h-px bg-border" />;
    case 'table':
      return (
        <View key={key} className="gap-1.5">
          {node.children.map((row, rowIndex) => (
            <View key={rowIndex} className="flex-row gap-3">
              {row.children.map((cell, cellIndex) => (
                <Text
                  key={cellIndex}
                  className={
                    rowIndex === 0
                      ? 'flex-1 font-semibold text-foreground text-subhead'
                      : 'flex-1 text-foreground text-subhead'
                  }
                >
                  {renderInline(cell.children)}
                </Text>
              ))}
            </View>
          ))}
        </View>
      );
    case 'html':
      return (
        <Text key={key} className="text-muted" style={MONO}>
          {node.value}
        </Text>
      );
    default:
      return null;
  }
}

/** Markdown → native views, sharing the web renderer's dialect (remark + GFM) and its
 * mid-stream repair (remend) so the two clients render agent output identically. */
export function NativeMarkdown({
  source,
  streaming,
}: {
  source: string;
  /** Repairs unterminated markdown while the message is still streaming. */
  streaming?: boolean;
}): React.ReactNode {
  const tree = parseMarkdown(source, streaming);
  return (
    <View className="gap-2.5">{tree.children.map((node, index) => renderBlock(node, index))}</View>
  );
}
