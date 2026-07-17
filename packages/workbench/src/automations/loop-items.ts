import type { LoopId, LoopRecord, LoopStatus } from '@linkcode/schema';

/** A loop reduced to what the Automations master list renders (localized by the UI). */
export interface LoopListItem {
  loopId: LoopId;
  /** Display name: the loop's name, or an excerpt of its prompt. */
  name: string;
  status: LoopStatus;
  iterationCount: number;
  updatedAt: number;
}

const NAME_EXCERPT_MAX = 60;
/** Running first (needs attention), then the rest by recency. */
const STATUS_RANK: Record<LoopStatus, number> = {
  running: 0,
  failed: 1,
  succeeded: 2,
  stopped: 3,
};

function displayName(loop: LoopRecord): string {
  const name = loop.spec.name?.trim();
  if (name) return name;
  const prompt = loop.spec.prompt.trim().replaceAll(/\s+/g, ' ');
  return prompt.length > NAME_EXCERPT_MAX ? `${prompt.slice(0, NAME_EXCERPT_MAX - 1)}…` : prompt;
}

/** Running loops first, then failed/succeeded/stopped; within a status, most recently updated first. */
export function buildLoopItems(loops: LoopRecord[] | undefined): LoopListItem[] {
  if (!loops) return [];
  return loops
    .map(
      (loop): LoopListItem => ({
        loopId: loop.loopId,
        name: displayName(loop),
        status: loop.status,
        iterationCount: loop.iterationCount,
        updatedAt: loop.updatedAt,
      }),
    )
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.updatedAt - a.updatedAt);
}
