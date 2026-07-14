/// <reference types="unplugin-icons/types/react" />

import {
  BoxIcon,
  DatabaseIcon,
  FileArchiveIcon,
  FileAudioIcon,
  FileCogIcon,
  FileIcon,
  FileImageIcon,
  FileJson2Icon,
  FileKey2Icon,
  FileLock2Icon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileVideoIcon,
  FolderIcon,
  GlobeIcon,
  PackageIcon,
  SquareTerminalIcon,
  TypeIcon,
} from 'lucide-react';
import { describe, expect, it } from 'vitest';
import BiomeFileIcon from '~icons/material-icon-theme/biome';
import DockerFileIcon from '~icons/material-icon-theme/docker';
import GitFileIcon from '~icons/material-icon-theme/git';
import MarkdownFileIcon from '~icons/material-icon-theme/markdown';
import NodeFileIcon from '~icons/material-icon-theme/nodejs';
import NpmFileIcon from '~icons/material-icon-theme/npm';
import PdfFileIcon from '~icons/material-icon-theme/pdf';
import PnpmFileIcon from '~icons/material-icon-theme/pnpm';
import ReactTypeScriptFileIcon from '~icons/material-icon-theme/react-ts';
import RustFileIcon from '~icons/material-icon-theme/rust';
import TestTypeScriptFileIcon from '~icons/material-icon-theme/test-ts';
import TypeScriptConfigFileIcon from '~icons/material-icon-theme/tsconfig';
import TypeScriptFileIcon from '~icons/material-icon-theme/typescript';
import TypeScriptDefFileIcon from '~icons/material-icon-theme/typescript-def';
import UnityFileIcon from '~icons/material-icon-theme/unity';
import ViteFileIcon from '~icons/material-icon-theme/vite';
import WordFileIcon from '~icons/material-icon-theme/word';
import { fileIconFor } from '../file-icon';

describe('fileIconFor', () => {
  it.each([
    ['.envrc', FileKey2Icon],
    ['.gitignore', GitFileIcon],
    ['.npmrc', NpmFileIcon],
    ['.nvmrc', NodeFileIcon],
    ['.pnpmfile.cjs', PnpmFileIcon],
    ['AGENTS.md', MarkdownFileIcon],
    ['biome.json', BiomeFileIcon],
    ['Cargo.lock', RustFileIcon],
    ['Cargo.toml', RustFileIcon],
    ['Dockerfile', DockerFileIcon],
    ['package.json', NodeFileIcon],
    ['tsconfig.json', TypeScriptConfigFileIcon],
    ['vite.config.ts', ViteFileIcon],
    ['src/main.ts', TypeScriptFileIcon],
    ['src/main.tsx', ReactTypeScriptFileIcon],
    ['src/types.d.ts', TypeScriptDefFileIcon],
    ['src/math.test.ts', TestTypeScriptFileIcon],
    ['src/math.test.tsx', ReactTypeScriptFileIcon],
    ['data.json', FileJson2Icon],
    ['notes.txt', FileTextIcon],
    ['composer.lock', FileLock2Icon],
    ['report.csv', FileSpreadsheetIcon],
    ['archive.tar.gz', FileArchiveIcon],
    ['recording.flac', FileAudioIcon],
    ['clip.webm', FileVideoIcon],
    ['photo.webp', FileImageIcon],
    ['report.pdf', PdfFileIcon],
    ['letter.docx', WordFileIcon],
    ['cache.sqlite3', DatabaseIcon],
    ['font.woff2', TypeIcon],
    ['scripts/release.sh', SquareTerminalIcon],
    ['model.glb', BoxIcon],
    ['plugin.unitypackage', UnityFileIcon],
    ['installer.dmg', PackageIcon],
    ['settings.yaml', FileCogIcon],
  ])('maps %s to a specific icon', (name, icon) => {
    expect(fileIconFor({ name })).toBe(icon);
  });

  it('uses kind and MIME hints for extensionless attachments', () => {
    expect(fileIconFor({ kind: 'directory', name: 'package.json' })).toBe(FolderIcon);
    expect(fileIconFor({ kind: 'url', name: 'docs' })).toBe(GlobeIcon);
    expect(fileIconFor({ mimeType: 'audio/mpeg', name: 'recording' })).toBe(FileAudioIcon);
    expect(fileIconFor({ mimeType: 'application/pdf', name: 'report' })).toBe(PdfFileIcon);
    expect(fileIconFor({ mimeType: 'application/json', name: 'data' })).toBe(FileJson2Icon);
  });

  it('keeps unsupported image attachments generic without changing file-browser icons', () => {
    expect(fileIconFor({ kind: 'file', mimeType: 'image/svg+xml', name: 'vector.svg' })).toBe(
      FileIcon,
    );
    expect(fileIconFor({ name: 'vector.svg' })).toBe(FileImageIcon);
  });

  it('falls back to the generic file icon', () => {
    expect(fileIconFor({ name: 'unknown.custom-extension' })).toBe(FileIcon);
  });
});
