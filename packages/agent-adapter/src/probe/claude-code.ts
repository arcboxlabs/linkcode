import { AgentCliProbe } from './base';

export class ClaudeCodeProbe extends AgentCliProbe {
  readonly kind = 'claude-code' as const;
  protected readonly binaryBase = 'claude';

  /** `claude --version` prints `2.1.202 (Claude Code)`; the marker rejects impostor binaries. */
  parseVersion(stdout: string): string | undefined {
    return /^(\d+\.\d+\.\d+(?:-\S+)?) \(Claude Code\)/.exec(stdout.trim())?.[1];
  }
}
