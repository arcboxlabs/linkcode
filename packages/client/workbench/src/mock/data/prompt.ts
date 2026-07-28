import type { UsageReport } from '@linkcode/schema';

export const MOCK_REPLY =
  'Dev mock host is online. The real daemon is bypassed, but the UI is still using the transport contract.';

/** What a claude-code `/usage` intercept serves (CODE-213), so a future usage panel can be built
 * against the mock host without a live subscription. */
export const MOCK_USAGE_REPORT: UsageReport = {
  session: {
    totalCostUsd: 1.87,
    totalApiDurationMs: 42000,
    totalDurationMs: 340000,
    totalLinesAdded: 120,
    totalLinesRemoved: 34,
    modelUsage: {
      'claude-opus-4-8': {
        inputTokens: 12400,
        outputTokens: 5200,
        cacheReadTokens: 88000,
        cacheCreationTokens: 9100,
        totalCostUsd: 1.87,
      },
    },
  },
  subscriptionType: 'max',
  rateLimits: {
    windows: [
      { id: 'five_hour', utilization: 6, resetsAt: '2026-07-16T07:49:00Z', durationMins: 300 },
      { id: 'seven_day', utilization: 74, resetsAt: '2026-07-18T17:00:00Z', durationMins: 10080 },
      { label: 'Fable', utilization: 100, resetsAt: '2026-07-18T16:59:00Z', durationMins: 10080 },
    ],
    extraUsage: { isEnabled: false, monthlyLimit: null, usedCredits: null, utilization: null },
  },
  behaviors: {
    day: {
      requestCount: 1167,
      sessionCount: 9,
      behaviors: [
        { key: 'long_context', pct: 78, count: 910 },
        { key: 'subagent_heavy', pct: 65, count: 759 },
      ],
      agents: [{ name: 'workflow-subagent', pct: 9 }],
      skills: [{ name: 'artifact-design', pct: 2 }],
      plugins: [],
      mcpServers: [{ name: 'claude.ai Linear', pct: 35 }],
    },
    week: {
      requestCount: 7590,
      sessionCount: 39,
      behaviors: [{ key: 'subagent_heavy', pct: 93, count: 7059 }],
      agents: [
        { name: 'workflow-subagent', pct: 10 },
        { name: 'Explore', pct: 2 },
      ],
      skills: [{ name: 'linear', pct: 9 }],
      plugins: [],
      mcpServers: [{ name: 'claude.ai Linear', pct: 24 }],
    },
  },
};

/** Prompting exactly this text forces the error path (the platform mocks' `?outcome=` analog). */
export const FAIL_PROMPT = 'fail';

/** Simulated round-trip on control ops so list/start loading states stay visible in dev. */
export const CONTROL_LATENCY_MS = 300;
/** Pacing between streamed reply chunks. */
export const CHUNK_LATENCY_MS = 24;

export const WORD_CHUNK_PATTERN = /\S+\s*/g;
