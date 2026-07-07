import { AgentCliProbe } from './base';

export class CodexProbe extends AgentCliProbe {
  readonly kind = 'codex' as const;
  protected readonly binaryBase = 'codex';

  /** `codex --version` prints `codex-cli 0.142.4`. */
  parseVersion(stdout: string): string | undefined {
    return /^codex-cli (\d+\.\d+\.\d+(?:-\S+)?)/.exec(stdout.trim())?.[1];
  }
}
