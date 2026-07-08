import process from 'node:process';
import { AgentCliProbe } from './base';

export class ClaudeCodeProbe extends AgentCliProbe {
  readonly kind = 'claude-code' as const;
  protected readonly binaryBase = 'claude';
  protected readonly sdkPackage = '@anthropic-ai/claude-agent-sdk';

  /** `claude --version` prints `2.1.202 (Claude Code)`; the marker rejects impostor binaries. */
  parseVersion(stdout: string): string | undefined {
    return /^(\d+\.\d+\.\d+(?:-\S+)?) \(Claude Code\)/.exec(stdout.trim())?.[1];
  }

  protected platformPackageBase(): string {
    // musl variants exist for linux; our artifacts are glibc, and dev machines follow suit.
    return `claude-agent-sdk-${process.platform}-${process.arch}`;
  }
}
