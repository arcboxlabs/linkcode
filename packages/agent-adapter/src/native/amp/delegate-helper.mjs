#!/usr/bin/env node
// Amp per-tool approval delegate helper.
//
// The legacy amp CLI spawns THIS file directly (no shell, empty argv) for every tool call that
// matches our `{tool:'*', action:'delegate', to:<this>}` rule. Contract, verified against the
// pinned CLI bundle (@sourcegraph/amp 0.0.1761408090):
//   - context arrives via env: AGENT_TOOL_NAME, AGENT_TOOL_USE_ID, AMP_THREAD_ID, plus the
//     LINKCODE_AMP_BRIDGE_URL / LINKCODE_AMP_BRIDGE_TOKEN the AmpAdapter injected into the CLI env;
//   - the tool's raw arguments arrive as JSON on stdin (then stdin is closed);
//   - the DECISION is the process EXIT CODE: 0 = allow, anything ≥2 = deny (stderr is surfaced as
//     the reason). Exit code 1 is FORBIDDEN — the CLI masks it into a silent generic denial with no
//     message, so we never use it. There is no stdout response protocol.
//
// This blocks until the LinkCode approval round-trip answers (or the daemon drops the connection),
// so a tool call genuinely waits for the user — with a generous safety timeout so a dead bridge
// can't hang the turn forever. Fails CLOSED (deny) on any error.
import process from 'node:process';

const EXIT_ALLOW = 0;
const EXIT_DENY = 2;
const SAFETY_TIMEOUT_MS = 5 * 60 * 1000;

function deny(reason) {
  if (reason) process.stderr.write(String(reason));
  process.exit(EXIT_DENY);
}

async function readStdin() {
  process.stdin.setEncoding('utf8');
  let body = '';
  for await (const chunk of process.stdin) body += chunk;
  return body;
}

async function main() {
  const url = process.env.LINKCODE_AMP_BRIDGE_URL;
  const token = process.env.LINKCODE_AMP_BRIDGE_TOKEN;
  if (!url || !token) return deny('amp delegate: approval bridge not configured');

  let args;
  try {
    args = JSON.parse(await readStdin());
  } catch {
    args = undefined;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SAFETY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-amp-bridge-token': token },
      body: JSON.stringify({
        toolName: process.env.AGENT_TOOL_NAME ?? '',
        toolUseId: process.env.AGENT_TOOL_USE_ID ?? '',
        threadId: process.env.AMP_THREAD_ID,
        args,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return deny(`amp delegate: bridge returned ${res.status}`);
    const data = await res.json();
    if (data && data.decision === 'allow') process.exit(EXIT_ALLOW);
    return deny('Denied by LinkCode approval');
  } catch {
    return deny('amp delegate: approval bridge unreachable or timed out');
  } finally {
    clearTimeout(timer);
  }
}

void main();
