import process from 'node:process';
import { AgentCliProbe } from './base';

export class CodexProbe extends AgentCliProbe {
  readonly kind = 'codex' as const;
  protected readonly binaryBase = 'codex';
  /** No JS SDK since the app-server rewrite — `@openai/codex` is the CLI carrier package whose
   * platform binaries install as same-scope siblings. */
  protected readonly sdkPackage = '@openai/codex';

  /** `codex --version` prints `codex-cli 0.142.4`. */
  parseVersion(stdout: string): string | undefined {
    return /^codex-cli (\d+\.\d+\.\d+(?:-\S+)?)/.exec(stdout.trim())?.[1];
  }

  protected platformPackageBase(): string {
    return `codex-${process.platform}-${process.arch}`;
  }
}
