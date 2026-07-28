import type { ExtensionUIContext, ExtensionUIDialogOptions } from '@earendil-works/pi-coding-agent';
import type { Question, QuestionOutcome, ToolCallUpdate } from '@linkcode/schema';
import { asyncNoop, noop } from 'foxts/noop';
import { nextToolCallId } from '../../adapter';

export interface PiUiHost {
  ask(
    toolCall: ToolCallUpdate,
    questions: Question[],
    signal?: AbortSignal,
  ): Promise<QuestionOutcome>;
  reportError(message: string): void;
}

export function createPiUiContext(host: PiUiHost): ExtensionUIContext {
  const context = {
    select: (title: string, options: string[], opts?: ExtensionUIDialogOptions) =>
      guarded(opts, undefined, async (signal) => {
        const answer = await ask(
          host,
          title,
          {
            questionId: 'select',
            prompt: title,
            multiSelect: false,
            options: options.map((label, index) => ({ optionId: String(index), label })),
          },
          signal,
        );
        const selected = answer?.selectedOptionIds[0];
        return selected === undefined ? answer?.customText : options[Number(selected)];
      }),
    confirm: (title: string, message: string, opts?: ExtensionUIDialogOptions) =>
      guarded(opts, false, async (signal) => {
        const answer = await ask(
          host,
          title,
          {
            questionId: 'confirm',
            prompt: message ? `${title}\n\n${message}` : title,
            multiSelect: false,
            options: [
              { optionId: 'yes', label: 'Yes' },
              { optionId: 'no', label: 'No' },
            ],
          },
          signal,
        );
        return answer?.selectedOptionIds[0] === 'yes';
      }),
    input: (title: string, placeholder?: string, opts?: ExtensionUIDialogOptions) =>
      text(host, title, placeholder, opts),
    editor: (title: string, prefill?: string) => text(host, title, prefill),
    notify(message: string, type?: 'info' | 'warning' | 'error') {
      if (type === 'error') host.reportError(message);
    },
    onTerminalInput: () => noop,
    setStatus: noop,
    setWorkingMessage: noop,
    setWorkingVisible: noop,
    setWorkingIndicator: noop,
    setHiddenThinkingLabel: noop,
    setWidget: noop,
    setFooter: noop,
    setHeader: noop,
    setTitle: noop,
    custom: asyncNoop as ExtensionUIContext['custom'],
    pasteToEditor: noop,
    setEditorText: noop,
    getEditorText: () => '',
    addAutocompleteProvider: noop,
    setEditorComponent: noop,
    getEditorComponent: noop as ExtensionUIContext['getEditorComponent'],
    getAllThemes: () => [],
    getTheme: noop as ExtensionUIContext['getTheme'],
    setTheme: () => ({ success: false, error: 'pi: themes are not available in this host' }),
    getToolsExpanded: () => false,
    setToolsExpanded: noop,
  } satisfies Partial<ExtensionUIContext>;
  // The SDK's own RPC context likewise omits TUI-only live objects such as `theme`.
  // eslint-disable-next-line sukka/type/no-force-cast-via-top-type -- deliberate RPC subset
  return context as unknown as ExtensionUIContext;
}

async function ask(host: PiUiHost, title: string, question: Question, signal?: AbortSignal) {
  const result = await host.ask(
    { toolCallId: nextToolCallId(), title, kind: 'other', status: 'in_progress' },
    [question],
    signal,
  );
  return result.outcome === 'answered' ? result.answers[0] : undefined;
}
function text(
  host: PiUiHost,
  title: string,
  placeholder?: string,
  opts?: ExtensionUIDialogOptions,
) {
  return guarded(
    opts,
    undefined,
    async (signal) =>
      (
        await ask(
          host,
          title,
          {
            questionId: 'input',
            prompt: title,
            multiSelect: false,
            options: [{ optionId: 'skip', label: 'Skip', description: placeholder }],
          },
          signal,
        )
      )?.customText?.trim() || undefined,
  );
}
function guarded<T>(
  opts: ExtensionUIDialogOptions | undefined,
  fallback: T,
  run: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
  if (opts?.signal?.aborted) return Promise.resolve(fallback);
  if (!opts?.signal && opts?.timeout === undefined) return run();
  return new Promise((resolve) => {
    const controller = new AbortController();
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function abort() {
      finish(fallback);
    }
    function finish(value: T) {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      opts?.signal?.removeEventListener('abort', abort);
      controller.abort();
      resolve(value);
    }
    opts?.signal?.addEventListener('abort', abort, { once: true });
    if (opts?.timeout !== undefined) timer = setTimeout(abort, opts.timeout);
    run(controller.signal).then(finish).catch(abort);
  });
}
