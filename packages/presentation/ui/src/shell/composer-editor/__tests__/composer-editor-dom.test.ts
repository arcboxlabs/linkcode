// @vitest-environment jsdom

import { createHeadlessEditor } from '@lexical/headless';
import { describe, expect, it } from 'vitest';
import {
  $createCommandNode,
  $createMentionNode,
  $createShellNode,
  COMPOSER_EDITOR_NODES,
} from '../nodes';

describe('composer chip DOM export', () => {
  it('degrades every chip to its canonical text for external paste', () => {
    const editor = createHeadlessEditor({
      namespace: 'composer-editor-dom-test',
      nodes: COMPOSER_EDITOR_NODES,
      onError(error: Error) {
        throw error;
      },
    });
    let exported: Array<string | null> = [];

    editor.update(
      () => {
        exported = [
          $createCommandNode('review'),
          $createShellNode(),
          $createMentionNode('a"b.ts'),
        ].map((node) => node.exportDOM().element?.textContent ?? null);
      },
      { discrete: true },
    );

    expect(exported).toEqual(['/review', '$', '[a"b.ts](./a"b.ts)']);
  });
});
