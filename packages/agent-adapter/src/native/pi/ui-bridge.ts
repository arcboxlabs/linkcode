import type { ExtensionUIContext, ExtensionUIDialogOptions } from '@earendil-works/pi-coding-agent';
import type { Question, QuestionOutcome, ToolCallUpdate } from '@linkcode/schema';
import { asyncNoop, noop } from 'foxts/noop';
import { nextToolCallId } from '../../adapter';

/**
 * How the bridge reaches the host adapter: `ask` is `BaseAgentAdapter.requestQuestion` (the shared
 * question round-trip; teardown resolves it `cancelled`, which maps to each dialog's default), and
 * `reportError` surfaces extension-raised error notifications.
 */
export interface PiUiHost {
  ask(
    toolCall: ToolCallUpdate,
    questions: Question[],
    signal?: AbortSignal,
  ): Promise<QuestionOutcome>;
  reportError(message: string): void;
}

/**
 * Headless `ExtensionUIContext` for pi extensions running inside the daemon: dialog methods
 * (`select` / `confirm` / `input` / `editor`) forward to the question round-trip, `notify` surfaces
 * errors, and everything that needs a terminal is a no-op. Until this is bound via
 * `session.bindExtensions`, the SDK runs on its internal noOp context, which silently auto-cancels
 * every dialog (select→undefined, confirm→false — verified in runner.js `noOpUIContext`).
 *
 * Mirrors pi's own `--mode rpc` host context (rpc-mode.js), including its omissions: the vendor's
 * headless mode also leaves the TUI-only members (`theme`, editor components, autocomplete)
 * unimplemented at runtime, so the trailing cast matches shipped vendor practice rather than
 * papering over a real gap.
 */
export function createPiUiContext(host: PiUiHost): ExtensionUIContext {
  const context = {
    select: (title, options, opts) =>
      guarded(opts, undefined, async (signal): Promise<string | undefined> => {
        if (options.length === 0) return undefined;
        const answer = await askOne(
          host,
          title,
          {
            questionId: 'select',
            prompt: title,
            multiSelect: false,
            // Labels may repeat; index-based optionIds keep them unique.
            options: options.map((label, index) => ({ optionId: String(index), label })),
          },
          signal,
        );
        if (!answer) return undefined;
        const picked = answer.selectedOptionIds.at(0);
        if (picked !== undefined) return options[Number(picked)];
        // A typed answer is strictly more expressive than a cancel; extensions that only match
        // their own option strings treat an unknown string exactly like undefined.
        return orUndefined(answer.customText);
      }),

    confirm: (title, message, opts) =>
      guarded(opts, false, async (signal) => {
        const answer = await askOne(
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

    input: (title, placeholder, opts) => textDialog(host, title, placeholder, opts),
    // No multi-line editor exists here; a free-text question is the same data.
    editor: (title, prefill) => textDialog(host, title, prefill, undefined),

    notify(message, type) {
      if (type === 'error') host.reportError(message);
      // info/warning notifications have no session-timeline representation; drop them.
    },

    // ── Terminal-only surface: accepted but inert in a GUI host. ──
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
    // TUI-component dialog; resolving undefined is the only headless answer (vendor noOp does the same).
    custom: asyncNoop as ExtensionUIContext['custom'],
    pasteToEditor: noop,
    setEditorText: noop,
    getEditorText: () => '',
    addAutocompleteProvider: noop,
    // noop returns undefined, which is exactly these getters' "nothing here" answer.
    setEditorComponent: noop,
    getEditorComponent: noop as ExtensionUIContext['getEditorComponent'],
    getAllThemes: () => [],
    getTheme: noop as ExtensionUIContext['getTheme'],
    setTheme: () => ({ success: false, error: 'pi: themes are not available in this host' }),
    getToolsExpanded: () => false,
    setToolsExpanded: noop,
  } satisfies Partial<ExtensionUIContext>;
  // `theme` (a live TUI Theme instance) is deliberately absent — see the doc comment; the `unknown`
  // hop is what TypeScript requires for an object narrower than the interface. pi's own headless
  // host (rpc-mode.js) ships the same omission; there is no constructible Theme in a GUI daemon.
  // eslint-disable-next-line sukka/type/no-force-cast-via-top-type -- deliberate partial context, see above
  return context as unknown as ExtensionUIContext;
}

/** Single-question ask, unwrapped to the one answer (or null on cancel/skip). */
async function askOne(host: PiUiHost, title: string, question: Question, signal?: AbortSignal) {
  const outcome = await host.ask(
    // The question card is the whole surface for a UI dialog — there is no separate provider tool
    // card to join, so the payload's toolCall is synthesized and never emitted via emitTool.
    { toolCallId: nextToolCallId(), title, kind: 'other', status: 'in_progress' },
    [question],
    signal,
  );
  if (outcome.outcome !== 'answered') return null;
  return outcome.answers[0] ?? null;
}

function textDialog(
  host: PiUiHost,
  title: string,
  placeholder: string | undefined,
  opts: ExtensionUIDialogOptions | undefined,
): Promise<string | undefined> {
  return guarded(opts, undefined, async (signal) => {
    const answer = await askOne(
      host,
      title,
      {
        questionId: 'input',
        prompt: title,
        multiSelect: false,
        // The schema requires at least one option; the lone structured choice is the skip path and
        // the real answer travels as the question card's free-text `customText`.
        options: [{ optionId: 'skip', label: 'Skip', description: placeholder }],
      },
      signal,
    );
    return orUndefined(answer?.customText);
  });
}

/**
 * Apply pi's dialog dismissal contract (`ExtensionUIDialogOptions`): an aborted signal or an
 * elapsed timeout resolves the dialog with its default value and cancels the host-side question.
 */
function guarded<T>(
  opts: ExtensionUIDialogOptions | undefined,
  fallback: T,
  run: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
  if (opts?.signal?.aborted) return Promise.resolve(fallback);
  const signal = opts?.signal;
  const timeout = opts?.timeout;
  if (!signal && timeout === undefined) return run();

  return new Promise<T>((resolve) => {
    const controller = new AbortController();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => finish(fallback);
    function finish(value: T) {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      controller.abort();
      resolve(value);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    if (timeout !== undefined) timer = setTimeout(() => finish(fallback), timeout);
    run(controller.signal)
      .then(finish)
      .catch(() => finish(fallback));
  });
}

function orUndefined(text: string | undefined): string | undefined {
  return text !== undefined && text.trim().length > 0 ? text : undefined;
}
