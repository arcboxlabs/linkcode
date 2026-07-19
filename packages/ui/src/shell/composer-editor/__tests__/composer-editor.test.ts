import { createHeadlessEditor } from '@lexical/headless';
import { noop } from 'foxts/noop';
import type { LexicalEditor, NodeKey } from 'lexical';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isTextNode,
  HISTORIC_TAG,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import type { ComposerDirectiveControls, ComposerDirectiveState } from '../directive-state';
import {
  $createCommandNode,
  $createMentionNode,
  $createShellNode,
  COMPOSER_EDITOR_NODES,
} from '../nodes';
import {
  $analyzeDirectives,
  $caretFlatOffset,
  $computeEditorTrigger,
  $convertDirectiveToText,
  $draftDirective,
  $draftText,
  $moveDirectiveToStart,
  $removeDirective,
  $replaceTriggerWith,
} from '../serialize';
import { $normalizeDirectiveTokens, registerDirectiveTokenizer } from '../tokenize';

const COMMANDS = [{ aliases: ['cost'], name: 'usage' }, { name: 'review' }];
const READY_DIRECTIVE_CONTROLS: ComposerDirectiveControls = {
  shell: { state: 'ready', onRunShellCommand: noop },
  slash: { state: 'ready', commands: COMMANDS, onInvokeCommand: noop },
};

function createEditor(
  getState: () => Pick<ComposerDirectiveState, 'directiveControls' | 'suppressed'> = () => ({
    directiveControls: READY_DIRECTIVE_CONTROLS,
    suppressed: new Set(),
  }),
): LexicalEditor {
  const editor = createHeadlessEditor({
    namespace: 'composer-editor-test',
    nodes: COMPOSER_EDITOR_NODES,
    onError(error) {
      throw error;
    },
  });
  registerDirectiveTokenizer(editor, getState);
  return editor;
}

function setDraft(editor: LexicalEditor, text: string): void {
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      if (text) paragraph.append($createTextNode(text));
      root.append(paragraph);
    },
    { discrete: true },
  );
}

function setStructuredCommandDraft(editor: LexicalEditor, before: string, after: string): void {
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      if (before) paragraph.append($createTextNode(before));
      paragraph.append($createCommandNode('review'));
      if (after) paragraph.append($createTextNode(after));
      $getRoot().clear().append(paragraph);
    },
    { discrete: true },
  );
}

/** Node types of the first paragraph's children — the draft's shape. */
function draftShape(editor: LexicalEditor): string[] {
  return editor.read(() => {
    const first = $getRoot().getFirstChild();
    return $isElementNode(first) ? first.getChildren().map((node) => node.getType()) : [];
  });
}

function draftText(editor: LexicalEditor): string {
  return editor.read($draftText);
}

/** Set the draft and place the caret at the end of the last text node. */
function triggerAtEnd(editor: LexicalEditor, draft: string): void {
  setDraft(editor, draft);
  editor.update(
    () => {
      const paragraph = $getRoot().getFirstChild();
      if (!$isElementNode(paragraph)) throw new Error('expected paragraph');
      const text = paragraph.getLastChildOrThrow();
      if (!$isTextNode(text)) throw new Error('expected text');
      text.select(text.getTextContentSize(), text.getTextContentSize());
    },
    { discrete: true },
  );
}

function directiveState(
  over: Partial<ComposerDirectiveControls> = {},
): Pick<ComposerDirectiveState, 'directiveControls'> {
  return {
    directiveControls: { ...READY_DIRECTIVE_CONTROLS, ...over },
  };
}

describe('directive tokenizer', () => {
  it('chips a leading command at its boundary space, known or not', () => {
    const editor = createEditor();
    setDraft(editor, '/usage now');
    expect(draftShape(editor)).toEqual(['composer-command', 'text']);
    expect(draftText(editor)).toBe('/usage now');

    setDraft(editor, '/typo x');
    expect(draftShape(editor)).toEqual(['composer-command', 'text']);
    expect(draftText(editor)).toBe('/typo x');
  });

  it('waits for the boundary unless forced (submit path)', () => {
    const editor = createEditor();
    setDraft(editor, '/usage');
    expect(draftShape(editor)).toEqual(['text']);

    editor.update(() => $normalizeDirectiveTokens({ suppressed: new Set() }, { force: true }), {
      discrete: true,
    });
    expect(draftShape(editor)).toEqual(['composer-command']);
    expect(draftText(editor)).toBe('/usage');
  });

  it('chips a leading $ only after it has a shell payload', () => {
    const editor = createEditor();
    setDraft(editor, '$ls -la');
    expect(draftShape(editor)).toEqual(['composer-shell', 'text']);
    expect(draftText(editor)).toBe('$ls -la');

    setDraft(editor, '$');
    expect(draftShape(editor)).toEqual(['text']);

    setDraft(editor, '$   ');
    expect(draftShape(editor)).toEqual(['text']);

    setDraft(editor, '$ ls');
    expect(draftShape(editor)).toEqual(['composer-shell', 'text']);
  });

  it('chips a command when a line break supplies its boundary', () => {
    const editor = createEditor();
    setDraft(editor, '/usage');

    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        if (!$isElementNode(paragraph)) throw new Error('expected paragraph');
        paragraph.append($createLineBreakNode(), $createTextNode('args'));
      },
      { discrete: true },
    );

    expect(draftShape(editor)).toEqual(['composer-command', 'linebreak', 'text']);
    expect(draftText(editor)).toBe('/usage\nargs');
  });

  it('keeps mid-line slash and dollar-sign tokens as prose', () => {
    const editor = createEditor();
    for (const draft of [
      'run /usage now',
      'run /typo now',
      'run $ now',
      'pay $5',
      'echo $HOME',
      ' $ls',
    ]) {
      setDraft(editor, draft);
      expect(draftShape(editor)).toEqual(['text']);
      expect(draftText(editor)).toBe(draft);
    }
  });

  it('keeps converted directive occurrences editable without suppressing later tokens', () => {
    const suppressed = new Set<NodeKey>();
    const editor = createEditor(() => ({
      directiveControls: READY_DIRECTIVE_CONTROLS,
      suppressed,
    }));
    setDraft(editor, '/typo');
    editor.update(() => $normalizeDirectiveTokens({ suppressed }, { force: true }), {
      discrete: true,
    });
    editor.update(
      () => {
        const first = $getRoot().getFirstChild();
        if (!$isElementNode(first)) throw new Error('expected paragraph');
        const converted = $convertDirectiveToText(first.getFirstChildOrThrow().getKey());
        if (converted) suppressed.add(converted);
      },
      { discrete: true },
    );
    expect(draftShape(editor)).toEqual(['text']);
    expect(draftText(editor)).toBe('/typo');
    expect(editor.read(() => $computeEditorTrigger(suppressed))).toBeNull();

    editor.update(
      () => {
        const first = $getRoot().getFirstChild();
        if (!$isElementNode(first)) throw new Error('expected paragraph');
        const converted = first.getFirstChildOrThrow();
        if (!$isTextNode(converted)) throw new Error('expected converted text');
        converted.setTextContent('/review edited');
      },
      { discrete: true },
    );
    expect(draftShape(editor)).toEqual(['text']);
    expect(draftText(editor)).toBe('/review edited');

    editor.update(
      () => {
        const first = $getRoot().getFirstChild();
        if (!$isElementNode(first)) throw new Error('expected paragraph');
        first.append($createTextNode(' /usage '));
      },
      { discrete: true },
    );
    expect(draftShape(editor)).toEqual(['text', 'text']);
    expect(draftText(editor)).toBe('/review edited /usage ');
  });

  it('keeps more than one converted occurrence as prose', () => {
    const suppressed = new Set<NodeKey>();
    const editor = createEditor(() => ({
      directiveControls: READY_DIRECTIVE_CONTROLS,
      suppressed,
    }));
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createCommandNode('review'),
          $createTextNode(' '),
          $createCommandNode('usage'),
        );
        $getRoot().clear().append(paragraph);
      },
      { discrete: true, tag: HISTORIC_TAG },
    );
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        if (!$isElementNode(paragraph)) throw new Error('expected paragraph');
        for (const child of paragraph.getChildren()) {
          if (child.getType() !== 'composer-command') continue;
          const converted = $convertDirectiveToText(child.getKey());
          if (converted) suppressed.add(converted);
        }
        $normalizeDirectiveTokens({ suppressed }, { force: true });
      },
      { discrete: true },
    );
    expect(draftShape(editor)).toEqual(['text', 'text', 'text']);
    expect(draftText(editor)).toBe('/review /usage');
  });

  it('treats text after a leading directive as its payload', () => {
    const editor = createEditor();
    setDraft(editor, '/review compare /usage ');
    expect(draftShape(editor)).toEqual(['composer-command', 'text']);
    expect(editor.read(() => $draftDirective(directiveState()))).toMatchObject({
      args: 'compare /usage',
      kind: 'command',
      name: 'review',
    });

    setDraft(editor, '$ echo /review ');
    expect(draftShape(editor)).toEqual(['composer-shell', 'text']);
    expect(editor.read(() => $draftDirective(directiveState()))).toMatchObject({
      command: 'echo /review',
      kind: 'shell',
    });
  });

  it('does not tokenize during history replays', () => {
    const editor = createEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode('/usage now'));
        $getRoot().clear().append(paragraph);
      },
      { discrete: true, tag: HISTORIC_TAG },
    );
    expect(draftShape(editor)).toEqual(['text']);
  });

  it('keeps a displaced chip and reports invalid placement', () => {
    const editor = createEditor();
    setDraft(editor, '/usage rest');
    expect(draftShape(editor)).toEqual(['composer-command', 'text']);

    editor.update(
      () => {
        const first = $getRoot().getFirstChild();
        if (!$isElementNode(first)) throw new Error('expected paragraph');
        first.getFirstChildOrThrow().insertBefore($createTextNode('hi '));
      },
      { discrete: true },
    );
    expect(draftShape(editor)).toEqual(['text', 'composer-command', 'text']);
    expect(draftText(editor)).toBe('hi /usage rest');
    expect(editor.read($analyzeDirectives).composition).toMatchObject({
      issue: 'misplaced',
      kind: 'blocked',
    });
  });

  it('keeps a chip displaced by structural nodes', () => {
    const editor = createEditor();
    setDraft(editor, '/usage rest');

    editor.update(
      () => {
        const first = $getRoot().getFirstChild();
        if (!$isElementNode(first)) throw new Error('expected paragraph');
        first.getFirstChildOrThrow().insertBefore($createLineBreakNode());
      },
      { discrete: true },
    );
    expect(draftShape(editor)).toContain('composer-command');
    expect(draftText(editor)).toBe('\n/usage rest');
  });
});

describe('canonical text invariant', () => {
  it('flat text is the concatenation of node literals', () => {
    const editor = createEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createCommandNode('review'),
          $createTextNode(' '),
          $createMentionNode('src/app.ts'),
          $createTextNode(' fix'),
        );
        $getRoot().clear().append(paragraph);
      },
      { discrete: true },
    );
    expect(draftText(editor)).toBe('/review "src/app.ts" fix');
  });

  it('escapes quotes inside mention paths', () => {
    const editor = createEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append($createMentionNode('a"b.ts'));
        $getRoot().clear().append(paragraph);
      },
      { discrete: true },
    );
    expect(draftText(editor)).toBe(String.raw`"a\"b.ts"`);
  });
});

describe('$draftDirective', () => {
  it('classifies a supported command with its argument text', () => {
    const editor = createEditor();
    setDraft(editor, '/usage now please');
    const directive = editor.read(() => $draftDirective(directiveState()));
    expect(directive).toEqual({
      args: 'now please',
      kind: 'command',
      name: 'usage',
      status: 'supported',
    });
  });

  it('matches catalog aliases', () => {
    const editor = createEditor();
    setDraft(editor, '/cost ');
    const directive = editor.read(() => $draftDirective(directiveState()));
    expect(directive).toMatchObject({ kind: 'command', name: 'cost', status: 'supported' });
  });

  it('distinguishes loading, authoritative unknown, and unsupported commands', () => {
    const editor = createEditor();
    setDraft(editor, '/typo x');
    expect(editor.read(() => $draftDirective(directiveState()))).toMatchObject({
      status: 'unknown',
    });
    expect(
      editor.read(() =>
        $draftDirective(
          directiveState({
            slash: { state: 'loading', onInvokeCommand: noop },
          }),
        ),
      ),
    ).toMatchObject({ status: 'supported' });
    expect(
      editor.read(() => $draftDirective(directiveState({ slash: { state: 'unsupported' } }))),
    ).toMatchObject({ status: 'unsupported' });
  });

  it('classifies shell drafts by capability', () => {
    const editor = createEditor();
    setDraft(editor, '$ls -la');
    expect(editor.read(() => $draftDirective(directiveState()))).toEqual({
      command: 'ls -la',
      kind: 'shell',
      status: 'supported',
    });
    expect(
      editor.read(() => $draftDirective(directiveState({ shell: { state: 'unsupported' } }))),
    ).toMatchObject({ status: 'unsupported' });
  });

  it('serializes mention chips into command arguments', () => {
    const editor = createEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createCommandNode('review'),
          $createTextNode(' '),
          $createMentionNode('src/app.ts'),
          $createTextNode(' carefully'),
        );
        $getRoot().clear().append(paragraph);
      },
      { discrete: true },
    );
    expect(editor.read(() => $draftDirective(directiveState()))).toMatchObject({
      args: '"src/app.ts" carefully',
      kind: 'command',
      name: 'review',
    });
  });

  it('blocks a supported command outside offset zero', () => {
    const editor = createEditor();
    setStructuredCommandDraft(editor, 'please ', ' now');
    expect(editor.read(() => $draftDirective(directiveState()))).toMatchObject({
      directive: { kind: 'command', name: 'review' },
      issue: 'misplaced',
      kind: 'invalid',
    });
  });

  it('moves a lone misplaced directive to the start without doubling separator whitespace', () => {
    const editor = createEditor();
    for (const [before, after, expected] of [
      ['please ', ' now', '/review please now'],
      [' ', ' now', '/review now'],
    ]) {
      setStructuredCommandDraft(editor, before, after);
      editor.update(
        () => {
          const analysis = $analyzeDirectives();
          if (analysis.composition.kind !== 'blocked') {
            throw new Error('expected blocked directive');
          }
          $moveDirectiveToStart(analysis.composition.directive.nodeKey);
        },
        { discrete: true },
      );
      expect(draftText(editor)).toBe(expected);
      expect(editor.read($analyzeDirectives).composition.kind).toBe('ready');
    }
  });

  it('normalizes boundary whitespace when removing a directive', () => {
    const editor = createEditor();
    for (const [before, after, expected] of [
      ['please ', ' now', 'please now'],
      ['', ' now', 'now'],
      ['please ', ' ', 'please'],
      ['', ' ', ''],
    ]) {
      setStructuredCommandDraft(editor, before, after);
      editor.update(
        () => {
          const analysis = $analyzeDirectives();
          if (analysis.composition.kind === 'none') throw new Error('expected directive');
          $removeDirective(analysis.composition.directive.nodeKey);
        },
        { discrete: true },
      );
      expect(draftText(editor)).toBe(expected);
    }
  });

  it('blocks multiple structured directives instead of flattening them to prose', () => {
    const editor = createEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createCommandNode('review'),
          $createTextNode(' '),
          $createCommandNode('usage'),
        );
        $getRoot().clear().append(paragraph);
      },
      { discrete: true },
    );
    expect(editor.read(() => $draftDirective(directiveState()))).toMatchObject({
      directive: { kind: 'command', name: 'usage' },
      issue: 'multiple',
      kind: 'invalid',
    });
  });

  it('classifies everything else as text — prose containing / stays prose', () => {
    const editor = createEditor();
    setDraft(editor, 'hello /usage');
    expect(editor.read(() => $draftDirective(directiveState()))).toEqual({
      kind: 'text',
      text: 'hello /usage',
    });
  });
});

describe('caret and trigger geometry', () => {
  it('computes flat caret offsets across chips', () => {
    const editor = createEditor();
    setDraft(editor, '/usage now');
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        if (!$isElementNode(paragraph)) throw new Error('expected paragraph');
        const rest = paragraph.getLastChildOrThrow();
        if (!$isTextNode(rest)) throw new Error('expected text');
        rest.select(0, 0);
      },
      { discrete: true },
    );
    // The chip serializes as '/usage' (6 chars); the caret sits at the start of ' now'.
    expect(editor.read($caretFlatOffset)).toBe(6);
  });

  it('includes Lexical block separators in flat offsets', () => {
    const editor = createEditor();
    editor.update(
      () => {
        const first = $createParagraphNode().append($createTextNode('one'));
        const secondText = $createTextNode('@two');
        const second = $createParagraphNode().append(secondText);
        $getRoot().clear().append(first, second);
        secondText.select(4, 4);
      },
      { discrete: true },
    );

    expect(draftText(editor)).toBe('one\n\n@two');
    expect(editor.read($caretFlatOffset)).toBe('one\n\n@two'.length);
    expect(editor.read($computeEditorTrigger)).toMatchObject({ flatStart: 'one\n\n'.length });

    editor.update(() => $getRoot().select(1, 1), { discrete: true });
    expect(editor.read($caretFlatOffset)).toBe('one\n\n'.length);

    editor.update(() => $getRoot().select(2, 2), { discrete: true });
    expect(editor.read($caretFlatOffset)).toBe('one\n\n@two'.length);
  });

  it('detects mention and slash triggers node-locally', () => {
    const editor = createEditor();
    setDraft(editor, 'hi @que');
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        if (!$isElementNode(paragraph)) throw new Error('expected paragraph');
        const text = paragraph.getFirstChildOrThrow();
        if (!$isTextNode(text)) throw new Error('expected text');
        text.select(7, 7);
      },
      { discrete: true },
    );
    expect(editor.read($computeEditorTrigger)).toMatchObject({
      flatStart: 3,
      kind: 'mention',
      query: 'que',
      start: 3,
    });
  });

  it('treats a chip boundary as a token boundary', () => {
    const editor = createEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const text = $createTextNode('@q');
        paragraph.append($createMentionNode('src/app.ts'), text);
        $getRoot().clear().append(paragraph);
        text.select(2, 2);
      },
      { discrete: true },
    );
    expect(editor.read($computeEditorTrigger)).toMatchObject({
      kind: 'mention',
      query: 'q',
      start: 0,
    });
  });

  it('ignores mid-word @', () => {
    const editor = createEditor();
    setDraft(editor, 'email x@y');
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        if (!$isElementNode(paragraph)) throw new Error('expected paragraph');
        const text = paragraph.getFirstChildOrThrow();
        if (!$isTextNode(text)) throw new Error('expected text');
        text.select(9, 9);
      },
      { discrete: true },
    );
    expect(editor.read($computeEditorTrigger)).toBeNull();
  });
});

describe('$replaceTriggerWith', () => {
  it('replaces the token and appends a separating space', () => {
    const editor = createEditor();
    triggerAtEnd(editor, 'hi @que');
    editor.update(
      () => {
        const trigger = $computeEditorTrigger();
        if (!trigger) throw new Error('expected trigger');
        $replaceTriggerWith(trigger, $createMentionNode('src/app.ts'));
      },
      { discrete: true },
    );
    expect(draftText(editor)).toBe('hi "src/app.ts" ');
    expect(editor.read($caretFlatOffset)).toBe('hi "src/app.ts" '.length);
  });

  it('skips the separator when whitespace already follows', () => {
    const editor = createEditor();
    setDraft(editor, 'hi @que rest');
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        if (!$isElementNode(paragraph)) throw new Error('expected paragraph');
        const text = paragraph.getFirstChildOrThrow();
        if (!$isTextNode(text)) throw new Error('expected text');
        text.select(7, 7);
        const trigger = $computeEditorTrigger();
        if (!trigger) throw new Error('expected trigger');
        $replaceTriggerWith(trigger, $createMentionNode('src/app.ts'));
      },
      { discrete: true },
    );
    expect(draftText(editor)).toBe('hi "src/app.ts" rest');
  });

  it('skips the separator before a line break sibling', () => {
    const editor = createEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const triggerText = $createTextNode('see @q');
        paragraph.append(triggerText, $createLineBreakNode(), $createTextNode('next'));
        $getRoot().append(paragraph);
        triggerText.select(6, 6);
        const trigger = $computeEditorTrigger();
        if (!trigger) throw new Error('expected trigger');
        $replaceTriggerWith(trigger, $createMentionNode('src/app.ts'));
      },
      { discrete: true },
    );

    expect(draftText(editor)).toBe('see "src/app.ts"\nnext');
  });

  it('keeps command-menu chips at both leading and mid-text positions', () => {
    const editor = createEditor();
    triggerAtEnd(editor, '/rev');
    editor.update(
      () => {
        const trigger = $computeEditorTrigger();
        if (!trigger) throw new Error('expected trigger');
        $replaceTriggerWith(trigger, $createCommandNode('review'));
      },
      { discrete: true },
    );
    expect(draftShape(editor)).toEqual(['composer-command', 'text']);
    expect(draftText(editor)).toBe('/review ');

    const editor2 = createEditor();
    triggerAtEnd(editor2, 'hi /rev');
    editor2.update(
      () => {
        const trigger = $computeEditorTrigger();
        if (!trigger) throw new Error('expected trigger');
        $replaceTriggerWith(trigger, $createCommandNode('review'));
      },
      { discrete: true },
    );
    expect(draftShape(editor2)).toEqual(['text', 'composer-command', 'text']);
    expect(draftText(editor2)).toBe('hi /review ');
    expect(editor2.read($analyzeDirectives).composition).toMatchObject({
      issue: 'misplaced',
      kind: 'blocked',
    });
  });
});

describe('shell chip round-trip', () => {
  it('keeps the $ literal for clipboard/serialization', () => {
    const editor = createEditor();
    setDraft(editor, '$echo hi');
    editor.read(() => {
      const paragraph = $getRoot().getFirstChild();
      if (!$isElementNode(paragraph)) throw new Error('expected paragraph');
      expect(paragraph.getFirstChildOrThrow().getTextContent()).toBe('$');
    });
    expect(draftText(editor)).toBe('$echo hi');
  });

  it('imports/exports chips through JSON round-trips', () => {
    const editor = createEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createCommandNode('usage'),
          $createTextNode(' '),
          $createMentionNode('src/app.ts'),
          $createShellNode(),
        );
        $getRoot().clear().append(paragraph);
      },
      { discrete: true, tag: HISTORIC_TAG },
    );
    const json = JSON.stringify(editor.getEditorState().toJSON());
    const restored = createEditor();
    restored.setEditorState(restored.parseEditorState(json));
    expect(draftText(restored)).toBe('/usage "src/app.ts"$');
  });
});
