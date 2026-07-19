import type { ContentBlock, EffortLevel, StartOptions } from '@linkcode/schema';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { AUTH_FAILED_ERROR_CODE } from '../../adapter';
import { BaseAgentAdapter } from '../../base';
import { grokEnv, readAgentCredential } from '../../credential';
import { asHistoryId } from '../../history-util';
import { agentRuntimeProber } from '../../probe';
import { contentToText } from '../../util';
import type { GrokStreamEvent } from './map';
import { isAuthFailureMessage, mapGrokStopReason, mapGrokUsage } from './map';
import type { GrokEffort, GrokHeadlessRun } from './process';
import { runGrokHeadless } from './process';

const RE_RESUME_FAIL = /session|resume|not found/i;
const DEFAULT_GROK_MODEL = 'grok-4.5';

/**
 * Grok Build adapter — drives the local `grok` CLI in **headless** mode (`grok -p`), not ACP.
 *
 * One process per prompt; multi-turn continues with `--resume <sessionId>` from the previous
 * `end` event. `streaming-json` emits text/thought/end only (no tool cards on 0.2.102). Tools
 * still execute under `--permission-mode bypassPermissions` because headless cannot wait for
 * interactive approval.
 */
export class GrokBuildAdapter extends BaseAgentAdapter {
  readonly kind = 'grok-build' as const;

  private binaryPath: string | null = null;
  private model: string | undefined;
  private effort: GrokEffort = 'high';
  private resumeSessionId: string | null = null;
  private activeRun: GrokHeadlessRun | null = null;
  private cancelled = false;

  protected onStart(opts: StartOptions): Promise<void> {
    const resolved = agentRuntimeProber.resolveBinary('grok-build');
    if (!resolved) {
      const message =
        'grok-build: CLI not found. Install Grok Build (https://x.ai/cli) and ensure `grok` is on a known path (~/.local/bin/grok or ~/.grok/bin/grok).';
      this.emitError(message, 'sdk-unavailable', false);
      return Promise.reject(new Error(message));
    }
    this.binaryPath = resolved;
    this.model = opts.model;
    // Reflect the verified CLI default without turning it into a `-m` override.
    this.emitModel(this.model ?? DEFAULT_GROK_MODEL);
    this.emitEffort(this.effort);
    return Promise.resolve();
  }

  protected async onPrompt(content: ContentBlock[]): Promise<void> {
    if (!this.binaryPath || !this.opts) {
      throw new Error('grok-build: session not started');
    }
    if (this.activeRun) {
      throw new Error('grok-build: a turn is already in progress');
    }

    const prompt = contentToText(content);
    this.cancelled = false;
    this.freshSegment();
    this.emitStatus('running');

    const cred = readAgentCredential(this.opts.config);
    const env = grokEnv(cred);

    try {
      await this.runTurn({
        prompt,
        resumeSessionId: this.resumeSessionId ?? undefined,
        env,
      });
    } catch (err) {
      // Cancel settles inside runTurn (no throw). Other failures surface here.
      const message = extractErrorMessage(err) ?? 'grok-build: turn failed';
      this.emitError(
        message,
        isAuthFailureMessage(message) ? AUTH_FAILED_ERROR_CODE : undefined,
        !isAuthFailureMessage(message),
      );
      this.teardown();
      this.emitStatus('idle');
    }
  }

  protected override onCancel(): Promise<void> {
    this.cancelled = true;
    this.activeRun?.kill();
    this.activeRun = null;
    return Promise.resolve();
  }

  protected override onStop(): Promise<void> {
    this.activeRun?.kill();
    this.activeRun = null;
    this.resumeSessionId = null;
    this.binaryPath = null;
    return Promise.resolve();
  }

  protected override onSetModel(model: string): Promise<void> {
    this.model = model;
    this.emitModel(model);
    return Promise.resolve();
  }

  protected override onSetEffort(effort: EffortLevel): Promise<void> {
    const mapped = effortFromLevel(effort);
    this.effort = mapped;
    this.emitEffort(mapped);
    return Promise.resolve();
  }

  private async runTurn(input: {
    prompt: string;
    resumeSessionId?: string;
    env?: Record<string, string>;
  }): Promise<void> {
    const binaryPath = this.binaryPath;
    const opts = this.opts;
    if (!binaryPath || !opts) throw new Error('grok-build: session not started');
    let sawEnd = false;

    const run = runGrokHeadless({
      binaryPath,
      cwd: opts.cwd,
      prompt: input.prompt,
      model: this.model,
      effort: this.effort,
      resumeSessionId: input.resumeSessionId,
      env: input.env,
      onEvent: (event) => {
        if (event.type === 'end') sawEnd = true;
        this.handleStreamEvent(event);
      },
    });
    this.activeRun = run;

    try {
      const { exitCode, stderrTail } = await run.done;
      if (this.cancelled) {
        this.emitStop('cancelled');
        this.teardown();
        this.emitStatus('idle');
        return;
      }
      if (!sawEnd && exitCode !== 0) {
        const detail =
          stderrTail.length > 0
            ? stderrTail
            : exitCode === null
              ? 'terminated by signal'
              : `exit ${String(exitCode)}`;
        const message = `grok-build: headless process failed (${detail})`;
        if (input.resumeSessionId && RE_RESUME_FAIL.test(detail)) {
          this.resumeSessionId = null;
        }
        throw new Error(message);
      }
      if (!sawEnd) this.emitStop('end_turn');
      this.teardown();
      this.emitStatus('idle');
    } finally {
      this.activeRun = null;
    }
  }

  private handleStreamEvent(event: GrokStreamEvent): void {
    switch (event.type) {
      case 'text': {
        if (typeof event.data === 'string') this.emitAssistantText(event.data, this.messageId);
        break;
      }
      case 'thought': {
        if (typeof event.data === 'string') this.emitThought(event.data, this.thoughtId);
        break;
      }
      case 'end': {
        if (typeof event.sessionId === 'string' && event.sessionId.length > 0) {
          this.resumeSessionId = event.sessionId;
          this.emitSessionRef(asHistoryId(event.sessionId));
        }
        const usage = mapGrokUsage(event.usage);
        if (usage) this.emitUsage(usage);
        this.emitStop(
          mapGrokStopReason(typeof event.stopReason === 'string' ? event.stopReason : undefined),
        );
        break;
      }
      case 'error': {
        const message =
          typeof event.message === 'string' && event.message.length > 0
            ? event.message
            : 'grok-build: headless error';
        this.emitError(
          message,
          isAuthFailureMessage(message) ? AUTH_FAILED_ERROR_CODE : undefined,
          !isAuthFailureMessage(message),
        );
        break;
      }
      default:
        // Docs: event list is non-exhaustive (max_turns_reached, auto_compact_*, …).
        break;
    }
  }
}

function effortFromLevel(effort: EffortLevel | undefined): GrokEffort {
  if (effort === undefined || effort === 'high') return 'high';
  if (effort === 'low' || effort === 'medium') return effort;
  throw new Error(
    `grok-build: effort '${effort}' is not supported (expected low, medium, or high)`,
  );
}
