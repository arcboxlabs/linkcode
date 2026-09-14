import { homedir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

type SDK = typeof import('@anthropic-ai/claude-agent-sdk');
export type ClaudeHistorySdk = Pick<
  SDK,
  | 'getSessionInfo'
  | 'getSessionMessages'
  | 'listSessions'
  | 'listSubagents'
  | 'getSubagentMessages'
  | 'forkSession'
>;

export function claudeConfigDir(environment: NodeJS.ProcessEnv, cwd = process.cwd()): string {
  return path.resolve(
    cwd,
    environment.CLAUDE_CONFIG_DIR || path.join(environment.HOME || homedir(), '.claude'),
  );
}

// The SDK captures its config root from process.env. A worker isolates concurrent account roots.
const HISTORY_WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
import(workerData.sdk).then(async (sdk) => {
  parentPort.postMessage(await sdk[workerData.method](...workerData.args));
});
`;

function callHistory<T>(root: string, method: keyof ClaudeHistorySdk, args: unknown[]): Promise<T> {
  const worker = new Worker(HISTORY_WORKER, {
    eval: true,
    execArgv: [],
    env: { ...process.env, CLAUDE_CONFIG_DIR: root },
    workerData: { sdk: import.meta.resolve('@anthropic-ai/claude-agent-sdk'), method, args },
  });
  return new Promise<T>((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) =>
      reject(new Error(`Claude history worker exited before replying (${code})`)),
    );
  }).finally(() => worker.terminate());
}

export function claudeHistorySdk(sdk: ClaudeHistorySdk, root: string): ClaudeHistorySdk {
  if (root === claudeConfigDir(process.env)) return sdk;
  return {
    getSessionInfo: (...args) => callHistory(root, 'getSessionInfo', args),
    getSessionMessages: (...args) => callHistory(root, 'getSessionMessages', args),
    listSessions: (...args) => callHistory(root, 'listSessions', args),
    listSubagents: (...args) => callHistory(root, 'listSubagents', args),
    getSubagentMessages: (...args) => callHistory(root, 'getSubagentMessages', args),
    forkSession: (...args) => callHistory(root, 'forkSession', args),
  };
}
