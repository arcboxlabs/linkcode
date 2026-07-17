import { act, fireEvent, screen } from '@testing-library/react';
import { nullthrow } from 'foxts/guard';
import type { LexicalEditor } from 'lexical';
import { getNearestEditorFromDOMNode } from 'lexical';
import { vi } from 'vitest';
import { $draftText, $insertDraftText } from '../composer-editor/serialize';

class InertMutationObserver implements MutationObserver {
  private records: MutationRecord[] = [];

  observe(): void {
    this.records = [];
  }

  disconnect(): void {
    this.records = [];
  }

  takeRecords(): MutationRecord[] {
    const records = this.records;
    this.records = [];
    return records;
  }
}

/** Keep Lexical's editor-state selection authoritative under jsdom, whose DOM Selection and
 * MutationObserver implementations are too partial for contenteditable reconciliation. */
export function setupComposerTestDOM(): void {
  window.getSelection = () => null;
  document.getSelection = () => null;
  window.scrollTo = vi.fn();
  window.MutationObserver = InertMutationObserver;
}

export function composerTextbox(): HTMLElement {
  return screen.getByRole('textbox');
}

export function composerLexicalEditor(): LexicalEditor {
  return nullthrow(getNearestEditorFromDOMNode(composerTextbox()), 'composer editor not mounted');
}

/** jsdom cannot synthesize Lexical's beforeinput/mutation typing path, so insert through the
 * editor while leaving transforms, snapshots, menus, and submit routing unchanged. */
export function typeInComposer(text: string): void {
  act(() => {
    composerLexicalEditor().update(() => $insertDraftText(text), { discrete: true });
  });
}

export async function pressInComposer(key: string): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(composerTextbox(), { code: key, key });
    await Promise.resolve();
  });
}

export function composerText(): string {
  return composerLexicalEditor().read($draftText);
}
