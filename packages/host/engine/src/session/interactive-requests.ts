import type { AgentEvent, SessionId } from '@linkcode/schema';
import type { AskEvent, AskResolutionEvent, AskResponseInput } from './ask-response';
import { sessionCancellation, userResolution, validateAskResponse } from './ask-response';

type AskRecord =
  | { request: AskEvent; state: 'open' }
  | { request: AskEvent; state: 'responding'; invalidated: boolean }
  | { request: AskEvent; state: 'resolved'; resolution: AskResolutionEvent };

export class InteractiveRequests {
  private readonly records = new Map<string, AskRecord>();
  private closed = false;

  constructor(private readonly sessionId: SessionId) {}

  open(request: AskEvent): void {
    if (!this.records.has(request.requestId)) {
      this.records.set(request.requestId, { request, state: 'open' });
    }
  }

  beginTurn(): void {
    for (const [requestId, ask] of this.records) {
      if (ask.state === 'resolved') this.records.delete(requestId);
    }
  }

  beginResponse(input: AskResponseInput): AskEvent {
    if (this.closed) throw new Error(`Session is closed: ${this.sessionId}`);
    const ask = this.records.get(input.requestId);
    if (!ask) throw new Error(`Unknown interactive request: ${input.requestId}`);
    if (ask.state === 'responding') {
      throw new Error(`Response already in flight: ${input.requestId}`);
    }
    if (ask.state === 'resolved') {
      throw new Error(`Interactive request already resolved: ${input.requestId}`);
    }
    validateAskResponse(ask.request, input);
    this.records.set(input.requestId, {
      request: ask.request,
      state: 'responding',
      invalidated: false,
    });
    return ask.request;
  }

  restoreResponse(requestId: string, request: AskEvent): AgentEvent[] {
    if (this.closed) return [];
    const ask = this.records.get(requestId);
    if (ask?.state !== 'responding' || ask.request !== request) return [];
    if (ask.invalidated) {
      const resolution = sessionCancellation(request);
      this.records.set(requestId, { request, state: 'resolved', resolution });
      return [resolution];
    }
    this.records.set(requestId, { request, state: 'open' });
    return [request, { type: 'prompt-response-status', requestId, status: 'open' }];
  }

  resolveResponse(input: AskResponseInput, request: AskEvent): AskResolutionEvent | undefined {
    if (this.closed) return undefined;
    const ask = this.records.get(input.requestId);
    if (ask?.state !== 'responding' || ask.request !== request) {
      throw new Error(`Interactive request changed while responding: ${input.requestId}`);
    }
    const resolution = userResolution(input);
    this.records.set(input.requestId, { request, state: 'resolved', resolution });
    return resolution;
  }

  cancelOpen(toolCallId?: string): AskResolutionEvent[] {
    const resolutions: AskResolutionEvent[] = [];
    for (const [requestId, ask] of this.records) {
      if (toolCallId !== undefined && ask.request.toolCall.toolCallId !== toolCallId) continue;
      if (ask.state === 'responding') {
        this.records.set(requestId, { ...ask, invalidated: true });
      } else if (ask.state === 'open') {
        const resolution = sessionCancellation(ask.request);
        this.records.set(requestId, { request: ask.request, state: 'resolved', resolution });
        resolutions.push(resolution);
      }
    }
    return resolutions;
  }

  close(): AskResolutionEvent[] | undefined {
    if (this.closed) return undefined;
    this.closed = true;
    const resolutions: AskResolutionEvent[] = [];
    for (const [requestId, ask] of this.records) {
      if (ask.state === 'resolved') continue;
      const resolution = sessionCancellation(ask.request);
      this.records.set(requestId, { request: ask.request, state: 'resolved', resolution });
      resolutions.push(resolution);
    }
    return resolutions;
  }

  replay(): AgentEvent[] {
    const events: AgentEvent[] = [];
    for (const ask of this.records.values()) {
      if (ask.state === 'resolved') {
        events.push(ask.resolution);
      } else {
        events.push(ask.request);
        if (ask.state === 'responding') {
          events.push({
            type: 'prompt-response-status',
            requestId: ask.request.requestId,
            status: 'responding',
          });
        }
      }
    }
    return events;
  }
}
