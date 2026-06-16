import type { AgentKind } from '@linkcode/schema';
import type { AgentAdapter } from './adapter';
import { ClaudeCodeAdapter } from './claude-code';
import { CodexAdapter } from './codex';
import { OpenCodeAdapter } from './opencode';
import { PiAdapter } from './pi';

/**
 * adapter 工厂：按 kind 实例化对应 adapter。
 * 新增 agent = 在此登记一个实现 AgentAdapter 的子类，上层无需改动（PLAN §2.5 / §9）。
 */
export function createAdapter(kind: AgentKind): AgentAdapter {
  switch (kind) {
    case 'claude-code':
      return new ClaudeCodeAdapter();
    case 'codex':
      return new CodexAdapter();
    case 'opencode':
      return new OpenCodeAdapter();
    case 'pi':
      return new PiAdapter();
  }
}

export type AdapterFactory = typeof createAdapter;
