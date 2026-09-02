import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
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
export type EditorTarget =
  | { kind: 'executable'; file: string }
  | { kind: 'mac-app'; bundle: string; label: string };

/**
 * A JetBrains IDE. All open a directory as a project; their bundle is `<label>.app` and their CLI
 * launcher (installed by Toolbox into `~/.local/bin`, or via "Create Command-line Launcher") is
 * `bin`. No `windowsExe`: the standalone Windows installer nests the binary under a version-stamped
 * directory this model can't address, so Windows detection is deliberately left uncovered rather
 * than guessed.
 */
function jetBrains(id: string, label: string, bin: string): EditorCandidate {
  return { id, label, cli: bin, macApp: `${label}.app` };
}

// Editor coverage follows vitejs/launch-editor's editor-info tables (MIT), adapted to this
// install-probing model. Terminal editors (vim/emacs) and EOL apps (Atom/Brackets) are excluded:
// the menu opens a workspace folder in a GUI editor, which neither fits.
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
    id: 'vscodium',
    label: 'VSCodium',
    cli: 'codium',
    macApp: 'VSCodium.app',
    windowsExe: join('VSCodium', 'VSCodium.exe'),
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
  {
    id: 'trae',
    label: 'Trae',
    cli: 'trae',
    macApp: 'Trae.app',
    windowsExe: join('Trae', 'Trae.exe'),
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    cli: 'antigravity',
    macApp: 'Antigravity.app',
    windowsExe: join('Antigravity', 'Antigravity.exe'),
  },
  {
    id: 'sublime-text',
    label: 'Sublime Text',
    cli: 'subl',
    macApp: 'Sublime Text.app',
    windowsExe: join('Sublime Text', 'sublime_text.exe'),
  },
  { id: 'zed', label: 'Zed', cli: 'zed', macApp: 'Zed.app', windowsExe: join('Zed', 'zed.exe') },
  jetBrains('intellij-idea', 'IntelliJ IDEA', 'idea'),
  jetBrains('pycharm', 'PyCharm', 'pycharm'),
  jetBrains('webstorm', 'WebStorm', 'webstorm'),
  jetBrains('phpstorm', 'PhpStorm', 'phpstorm'),
  jetBrains('goland', 'GoLand', 'goland'),
  jetBrains('clion', 'CLion', 'clion'),
  jetBrains('rubymine', 'RubyMine', 'rubymine'),
  jetBrains('rider', 'Rider', 'rider'),
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
  if (platform !== 'win32' && candidate.cli !== undefined) {
    const files = executableSearchLocations(candidate.cli);
    for (let i = 0, len = files.length; i < len; i++) {
      const file = files[i];
      targets.push({ kind: 'executable', file });
    }
  }
  if (platform === 'darwin' && candidate.macApp !== undefined) {
    const roots = ['/Applications', join(homedir(), 'Applications')];
    for (let i = 0, len = roots.length; i < len; i++) {
      const root = roots[i];
      targets.push({
        kind: 'mac-app',
        bundle: join(root, candidate.macApp),
        label: candidate.label,
      });
    }
  }
  if (platform === 'win32' && candidate.windowsExe !== undefined) {
    const roots = windowsProgramRoots();
    for (let i = 0, len = roots.length; i < len; i++) {
      const root = roots[i];
      targets.push({ kind: 'executable', file: join(root, candidate.windowsExe) });
    }
  }
  return targets;
}

/**
 * Whether this target can be launched as it stands. An `executable` target is exec'd directly, so
 * mere existence is not enough — a present but non-executable file would otherwise outrank a
 * working application bundle later in the list.
 */
export function isLaunchable(target: EditorTarget): boolean {
  if (target.kind === 'mac-app') return existsSync(target.bundle);
  try {
    accessSync(target.file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The install this editor would launch from. Resolved per call rather than cached: a snapshot
 * goes stale the moment an editor is installed, moved, upgraded, or removed. */
function resolveInstall(candidate: EditorCandidate): EditorTarget | undefined {
  return editorTargets(candidate, process.platform).find(isLaunchable);
}

export function listEditors(): DetectedEditor[] {
  return EDITOR_CANDIDATES.flatMap((candidate) =>
    resolveInstall(candidate) === undefined ? [] : [{ id: candidate.id, label: candidate.label }],
  );
}

export function openInEditor(editorId: string, path: string): Promise<void> {
  const candidate = nullthrow(
    EDITOR_CANDIDATES.find((each) => each.id === editorId),
    `unknown editor: ${editorId}`,
  );
  const target = nullthrow(
    resolveInstall(candidate),
    `editor is not installed any more: ${editorId}`,
  );

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
