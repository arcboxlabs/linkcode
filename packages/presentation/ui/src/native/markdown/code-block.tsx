import type { ThemedToken } from '@shikijs/core';
import { noop } from 'foxact/noop';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useState } from 'react';
import { ScrollView, Text, useColorScheme, View } from 'react-native';

const CODE_FONT = { fontFamily: 'Menlo', fontSize: 12, lineHeight: 18 } as const;

interface HighlightedCode {
  code: string;
  lang: string;
  colorScheme: 'light' | 'dark';
  tokens: ThemedToken[][];
}

/** Fenced code block: mono, horizontally scrollable, shiki-highlighted once the lazily
 * imported highlighter resolves (plain text until then / for unknown languages). */
export function CodeBlock({ code, lang }: { code: string; lang?: string }): React.ReactNode {
  const colorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [highlighted, setHighlighted] = useState<HighlightedCode | null>(null);
  const tokens =
    highlighted?.code === code &&
    highlighted.lang === lang &&
    highlighted.colorScheme === colorScheme
      ? highlighted.tokens
      : null;

  useAbortableEffect(
    (signal) => {
      if (!lang) return;
      void import('./highlight')
        .then(({ highlightCode }) => highlightCode(code, lang, colorScheme))
        .then((next) => {
          if (!signal.aborted) {
            setHighlighted(next ? { code, lang, colorScheme, tokens: next } : null);
          }
        })
        // A crashed highlighter must never take down the message; the plain block stands.
        .catch(noop);
    },
    [code, lang, colorScheme],
  );

  return (
    <View className="rounded-lg bg-surface-secondary">
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="px-3 py-2.5">
          {tokens
            ? tokens.map((line, index) => (
                // eslint-disable-next-line @eslint-react/no-array-index-key -- lines have no identity; the token tree is replaced wholesale per highlight
                <Text key={index} style={CODE_FONT}>
                  {line.length === 0
                    ? ' '
                    : line.map((token, tokenIndex) => (
                        // eslint-disable-next-line @eslint-react/no-array-index-key -- see above
                        <Text key={tokenIndex} style={[CODE_FONT, { color: token.color }]}>
                          {token.content}
                        </Text>
                      ))}
                </Text>
              ))
            : code.split('\n').map((line, index) => (
                // eslint-disable-next-line @eslint-react/no-array-index-key -- see above
                <Text key={index} className="text-foreground" style={CODE_FONT}>
                  {line.length === 0 ? ' ' : line}
                </Text>
              ))}
        </View>
      </ScrollView>
    </View>
  );
}
