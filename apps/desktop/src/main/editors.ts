import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { executableSearchLocations } from '@linkcode/common/node';
import type { DetectedEditor } from '@linkcode/ipc';
import { nullthrow } from 'foxact/nullthrow';

/**
 * Detects the external editors installed on this machine and opens a workspace in one, backing
 * the chrome title menu's "open in editor" item (CODE-379).
 */

/** One editor we know how to find and launch. Absent fields simply yield no candidate path. */
export interface EditorCandidate {
  id: string;
  label: string;
  /**
   * CLI base name, probed on PATH and the shared fallback install locations. POSIX only: the
   * Windows editor CLIs are `.cmd` shims, which `spawn` cannot exec without a shell.
   */
  cli?: string;
  /** Application-bundle directory name under `/Applications` or `~/Applications`. */
  macApp?: string;
  /** Executable path relative to a Windows program root. */
  windowsExe?: string;
}

/** A resolved, launchable editor install. */
type EditorTarget =
  | { kind: 'executable'; file: string }
  | { kind: 'mac-app'; bundle: string; label: string };

const EDITOR_CANDIDATES: EditorCandidate[] = [
  {
    id: 'vscode',
    label: 'Visual Studio Code',
    cli: 'code',
    macApp: 'Visual Studio Code.app',
    windowsExe: join('Microsoft VS Code', 'Code.exe'),
  },
  {
    id: 'vscode-insiders',
    label: 'Visual Studio Code - Insiders',
    cli: 'code-insiders',
    macApp: 'Visual Studio Code - Insiders.app',
    windowsExe: join('Microsoft VS Code Insiders', 'Code - Insiders.exe'),
  },
  {
    id: 'cursor',
    label: 'Cursor',
    cli: 'cursor',
    macApp: 'Cursor.app',
    windowsExe: join('cursor', 'Cursor.exe'),
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    cli: 'windsurf',
    macApp: 'Windsurf.app',
    windowsExe: join('Windsurf', 'Windsurf.exe'),
  },
  { id: 'zed', label: 'Zed', cli: 'zed', macApp: 'Zed.app', windowsExe: join('Zed', 'zed.exe') },
  {
    id: 'sublime-text',
    label: 'Sublime Text',
    cli: 'subl',
    macApp: 'Sublime Text.app',
    windowsExe: join('Sublime Text', 'sublime_text.exe'),
  },
];

/** Roots Windows installers target, in the order they are probed. */
function windowsProgramRoots(): string[] {
  const roots = [
    process.env.LOCALAPPDATA === undefined ? undefined : join(process.env.LOCALAPPDATA, 'Programs'),
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
  ];
  return roots.filter((root) => root !== undefined);
}

/**
 * Every place `candidate` may be installed on `platform`, in precedence order. On macOS the app
 * bundle is probed alongside the CLI because the `code`-style shim is opt-in — plenty of installs
 * have the editor but not the command.
 */
export function editorTargets(
  candidate: EditorCandidate,
  platform: NodeJS.Platform,
): EditorTarget[] {
  const targets: EditorTarget[] = [];
  if (candidate.cli !== undefined && platform !== 'win32') {
    for (const file of executableSearchLocations(candidate.cli)) {
      targets.push({ kind: 'executable', file });
    }
  }
  if (candidate.macApp !== undefined && platform === 'darwin') {
    for (const root of ['/Applications', join(homedir(), 'Applications')]) {
      targets.push({
        kind: 'mac-app',
        bundle: join(root, candidate.macApp),
        label: candidate.label,
      });
    }
  }
  if (candidate.windowsExe !== undefined && platform === 'win32') {
    for (const root of windowsProgramRoots()) {
      targets.push({ kind: 'executable', file: join(root, candidate.windowsExe) });
    }
  }
  return targets;
}

function targetPath(target: EditorTarget): string {
  return target.kind === 'mac-app' ? target.bundle : target.file;
}

// Probed once per process: an editor installed mid-session appears after a restart.
let installs: Map<string, EditorTarget> | undefined;

function detectInstalls(): Map<string, EditorTarget> {
  installs ??= new Map(
    EDITOR_CANDIDATES.flatMap((candidate) => {
      const target = editorTargets(candidate, process.platform).find((each) =>
        existsSync(targetPath(each)),
      );
      return target === undefined ? [] : [[candidate.id, target] as const];
    }),
  );
  return installs;
}

export function listEditors(): DetectedEditor[] {
  const found = detectInstalls();
  return EDITOR_CANDIDATES.flatMap(({ id, label }) => (found.has(id) ? [{ id, label }] : []));
}

export function openInEditor(editorId: string, path: string): Promise<void> {
  const target = nullthrow(detectInstalls().get(editorId), `unknown editor: ${editorId}`);

  const [file, args] =
    target.kind === 'mac-app'
      ? ['/usr/bin/open', ['-a', target.bundle, path]]
      : [target.file, [path]];

  return new Promise((resolve, reject) => {
    // Detached with ignored stdio: the editor outlives this app, and nobody drains its pipes.
    // windowsHide keeps a console-subsystem launcher from flashing a window on packaged Windows.
    const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
