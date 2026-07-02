export const MOCK_REPLY =
  'Dev mock host is online. The real daemon is bypassed, but the UI is still using the transport contract.';

/** Prompting exactly this text forces the error path (the platform mocks' `?outcome=` analog). */
export const FAIL_PROMPT = 'fail';

/** Simulated round-trip on control ops so list/start loading states stay visible in dev. */
export const CONTROL_LATENCY_MS = 300;
/** Pacing between streamed reply chunks. */
export const CHUNK_LATENCY_MS = 24;

export const WORD_CHUNK_PATTERN = /\S+\s*/g;
