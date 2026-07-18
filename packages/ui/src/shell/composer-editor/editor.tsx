import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { EditorRefPlugin } from '@lexical/react/LexicalEditorRefPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { mergeRegister } from '@lexical/utils';
import type { AgentCommand } from '@linkcode/schema';
import type { EditorState, LexicalEditor } from 'lexical';
import {
  COMMAND_PRIORITY_CRITICAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
} from 'lexical';
import { useEffect } from 'react';
import { cn } from '../../lib/cn';
import type { DirectivePlacementIssue } from './directive-state';
import { directiveStateFor } from './directive-state';
import { COMPOSER_EDITOR_NODES } from './nodes';
import type { DirectiveComposition, EditorDirective, EditorTrigger } from './serialize';
import {
  $analyzeDirectives,
  $caretFlatOffset,
  $computeEditorTrigger,
  $draftText,
} from './serialize';
import { $normalizeDirectiveTokens, registerDirectiveTokenizer } from './tokenize';

/** What the composer mirrors out of the editor after every committed update. */
export interface ComposerDraftSnapshot {
  /** Flat draft text — chips contribute their canonical literals. */
  text: string;
  /** Collapsed-caret offset in the flat text; null for non-caret selections. */
  caretOffset: number | null;
  /** The `@`/`/` token at the caret, with its node-local replacement range. */
  trigger: EditorTrigger | null;
  /** Structural directive composition; catalog validity is derived live by the consumer. */
  composition: DirectiveComposition;
  /** The document-leading directive, including in an invalid multi-directive composition. */
  directive: EditorDirective | null;
}

export const EMPTY_DRAFT_SNAPSHOT: ComposerDraftSnapshot = {
  caretOffset: 0,
  composition: { kind: 'none' },
  directive: null,
  text: '',
  trigger: null,
};

interface ComposerEditorProps {
  className?: string;
  placeholder: string;
  disabled: boolean;
  /** Live directive inputs, mirrored into the per-editor store for chips and the tokenizer. */
  commands: readonly AgentCommand[];
  commandsSupported: boolean;
  shellEnabled: boolean;
  onDraftChange: (snapshot: ComposerDraftSnapshot) => void;
  /** Image files pasted into the editor; text paste stays internal. */
  onPasteFiles: (files: File[]) => void;
  onSubmit: () => void;
  /** While the command menu is open, ArrowUp/Down/Enter are forwarded to the relay input so
   * base-ui's virtual list navigation drives the menu without owning focus. */
  menuOpen: boolean;
  menuHasItems: boolean;
  relayRef: React.RefObject<HTMLInputElement | null>;
  /** Receives the live LexicalEditor for imperative draft operations (submit, insertions). */
  editorRef: React.RefObject<LexicalEditor | null>;
}

function DirectiveStatePlugin({
  commands,
  commandsSupported,
  disabled,
  shellEnabled,
}: Pick<
  ComposerEditorProps,
  'commands' | 'commandsSupported' | 'disabled' | 'shellEnabled'
>): null {
  const [editor] = useLexicalComposerContext();
  // Prop → external-store sync for the chip portals (they can't receive props through Lexical's
  // decorator boundary); not a state watcher.
  useEffect(() => {
    const store = directiveStateFor(editor);
    store.setState({ commands, commandsSupported, disabled, shellEnabled });
    // A late catalog can prove that already-typed mid-line `/name` text is a real command.
    editor.update(() => $normalizeDirectiveTokens(store.getState()), { discrete: true });
  }, [editor, commands, commandsSupported, disabled, shellEnabled]);
  return null;
}

function TokenizerPlugin(): null {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () => registerDirectiveTokenizer(editor, () => directiveStateFor(editor).getState()),
    [editor],
  );
  return null;
}

function EditablePlugin({ disabled }: { disabled: boolean }): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(!disabled);
  }, [editor, disabled]);
  return null;
}

function KeyboardPlugin({
  menuOpen,
  menuHasItems,
  relayRef,
  onSubmit,
  onPasteFiles,
}: Pick<
  ComposerEditorProps,
  'menuHasItems' | 'menuOpen' | 'onPasteFiles' | 'onSubmit' | 'relayRef'
>): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    function forwardToRelay(event: KeyboardEvent): void {
      relayRef.current?.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          code: event.code,
          key: event.key,
        }),
      );
    }
    return mergeRegister(
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          // A null event is Lexical's own composition-cleanup dispatch — not a user Enter.
          if (event === null) return false;
          // Decorator chips are real buttons. Let their native keyboard activation open the
          // action menu instead of bubbling Enter into composer submit.
          if (event.target !== editor.getRootElement()) return false;
          // IME candidate confirm (CJK) is never submit/select.
          if (event.isComposing || event.key === 'Process') return true;
          if (event.shiftKey) return false;
          event.preventDefault();
          // Both outcomes run editor updates of their own (menu select mutates the draft,
          // submit force-tokenizes then clears); defer them out of this command dispatch —
          // a nested discrete update inside it is illegal.
          if (menuOpen) {
            // An open menu owns Enter even when filtering leaves it empty.
            if (menuHasItems) queueMicrotask(() => forwardToRelay(event));
            return true;
          }
          queueMicrotask(onSubmit);
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event) => {
          if (!menuOpen || !menuHasItems) return false;
          event.preventDefault();
          forwardToRelay(event);
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event) => {
          if (!menuOpen || !menuHasItems) return false;
          event.preventDefault();
          forwardToRelay(event);
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          // Duck-typed rather than `instanceof ClipboardEvent`: jsdom (vitest) has no
          // ClipboardEvent global, and cross-realm events would defeat instanceof anyway.
          const clipboardData = 'clipboardData' in event ? event.clipboardData : null;
          if (!clipboardData) return false;
          const files = Array.from(clipboardData.files).filter((file) =>
            file.type.startsWith('image/'),
          );
          if (files.length === 0) return false;
          event.preventDefault();
          onPasteFiles(files);
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    );
  }, [editor, menuOpen, menuHasItems, relayRef, onSubmit, onPasteFiles]);
  return null;
}

/**
 * The composer's rich editing surface: multiline plain text plus atomic directive/mention chips.
 * Owns nothing but the draft — catalog data, menus, submit routing, and attachments stay with
 * the composer, wired through props and the imperative `editorRef`.
 */
export function ComposerEditor({
  className,
  placeholder,
  disabled,
  commands,
  commandsSupported,
  shellEnabled,
  onDraftChange,
  onPasteFiles,
  onSubmit,
  menuOpen,
  menuHasItems,
  relayRef,
  editorRef,
}: ComposerEditorProps): React.ReactNode {
  function handleChange(editorState: EditorState, editor: LexicalEditor): void {
    // Mid-composition states are transient; the compositionend commit reports the final draft.
    if (editor.isComposing()) return;
    const store = directiveStateFor(editor);
    const next = editorState.read(() => {
      const analysis = $analyzeDirectives();
      const placementIssues: Partial<Record<string, DirectivePlacementIssue>> = {};
      if (analysis.composition.kind === 'blocked') {
        for (const key of analysis.blockedKeys) placementIssues[key] = analysis.composition.issue;
      }
      return {
        caretOffset: $caretFlatOffset(),
        composition: analysis.composition,
        directive: analysis.leading,
        placementIssues,
        text: $draftText(),
        trigger: $computeEditorTrigger(store.getState().suppressed),
      };
    });
    store.setState({ placementIssues: next.placementIssues });
    onDraftChange(next);
  }

  return (
    <LexicalComposer
      initialConfig={{
        editable: !disabled,
        namespace: 'linkcode-composer',
        nodes: COMPOSER_EDITOR_NODES,
        onError(error) {
          throw error;
        },
      }}
    >
      <div className="relative w-full">
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              aria-multiline
              aria-placeholder={placeholder}
              className={cn('outline-none', className)}
              data-slot="composer-editor"
              placeholder={
                // Shares `className` so padding and text metrics match the editable surface.
                <div
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute inset-0 select-none text-muted-foreground',
                    className,
                  )}
                >
                  {placeholder}
                </div>
              }
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <OnChangePlugin onChange={handleChange} />
      <EditorRefPlugin editorRef={editorRef} />
      <DirectiveStatePlugin
        commands={commands}
        commandsSupported={commandsSupported}
        disabled={disabled}
        shellEnabled={shellEnabled}
      />
      <TokenizerPlugin />
      <EditablePlugin disabled={disabled} />
      <KeyboardPlugin
        menuHasItems={menuHasItems}
        menuOpen={menuOpen}
        onPasteFiles={onPasteFiles}
        onSubmit={onSubmit}
        relayRef={relayRef}
      />
    </LexicalComposer>
  );
}
