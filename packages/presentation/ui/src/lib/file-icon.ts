import type { LucideIcon } from 'lucide-react';
import {
  BookOpenIcon,
  BoxIcon,
  CalendarIcon,
  DatabaseIcon,
  FileArchiveIcon,
  FileAudioIcon,
  FileCode2Icon,
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
  HammerIcon,
  PackageIcon,
  PaletteIcon,
  SquareTerminalIcon,
  TypeIcon,
} from 'lucide-react';
import type { MaterialFileIcon } from './material-file-icons';
import {
  MATERIAL_COMPOUND_EXTENSION_ICONS,
  MATERIAL_EXTENSION_ICONS,
  MATERIAL_FILE_NAME_ICONS,
  MATERIAL_FILE_NAME_PREFIX_ICONS,
} from './material-file-icons';

export type FileIconComponent = LucideIcon | MaterialFileIcon;

const MATERIAL_COMPOUND_EXTENSION_ENTRIES = Object.entries(MATERIAL_COMPOUND_EXTENSION_ICONS);
const ARCHIVE_EXTENSIONS = new Set([
  '7z',
  'br',
  'bz',
  'bz2',
  'gz',
  'rar',
  'tar',
  'tgz',
  'xz',
  'zip',
  'zst',
]);
const AUDIO_EXTENSIONS = new Set([
  'aac',
  'aiff',
  'flac',
  'm4a',
  'mp3',
  'oga',
  'ogg',
  'opus',
  'wav',
  'wma',
]);
const BOOK_EXTENSIONS = new Set(['azw', 'azw3', 'epub', 'mobi']);
const CODE_EXTENSIONS = new Set([
  'astro',
  'c',
  'cc',
  'cjs',
  'cpp',
  'cs',
  'dart',
  'erl',
  'ex',
  'exs',
  'go',
  'graphql',
  'h',
  'hpp',
  'hrl',
  'htm',
  'html',
  'java',
  'js',
  'jsx',
  'kt',
  'kts',
  'lua',
  'mjs',
  'php',
  'proto',
  'py',
  'pyi',
  'rb',
  'rs',
  'scala',
  'sol',
  'svelte',
  'swift',
  'ts',
  'tsx',
  'vue',
  'wasm',
  'xml',
]);
const CONFIG_EXTENSIONS = new Set(['cfg', 'conf', 'ini', 'properties', 'toml', 'yaml', 'yml']);
const DATABASE_EXTENSIONS = new Set(['avro', 'db', 'mdb', 'parquet', 'sql', 'sqlite', 'sqlite3']);
const DOCUMENT_EXTENSIONS = new Set(['adoc', 'log', 'odt', 'rst', 'rtf', 'tex', 'txt']);
const FONT_EXTENSIONS = new Set(['eot', 'otf', 'ttf', 'woff', 'woff2']);
const IMAGE_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'heic',
  'heif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp',
]);
const INSTALLER_EXTENSIONS = new Set(['appimage', 'deb', 'dmg', 'exe', 'ipa', 'msi', 'pkg', 'rpm']);
const MODEL_EXTENSIONS = new Set(['fbx', 'glb', 'gltf', 'obj', 'stl']);
const JSON_EXTENSIONS = new Set(['json', 'json5', 'jsonc']);
const PALETTE_EXTENSIONS = new Set(['styl']);
const SPREADSHEET_EXTENSIONS = new Set(['csv', 'ods', 'tsv', 'xls', 'xlsx']);
const TERMINAL_EXTENSIONS = new Set(['bash', 'bat', 'cmd', 'fish', 'ps1', 'sh', 'zsh']);
const VIDEO_EXTENSIONS = new Set([
  'avi',
  'flv',
  'm4v',
  'mkv',
  'mov',
  'mp4',
  'mpeg',
  'mpg',
  'webm',
  'wmv',
]);

const BUILD_FILES = new Set(['cmakelists.txt', 'justfile', 'makefile', 'taskfile.yml']);
const CONFIG_FILES = new Set(['.editorconfig', '.stylelintrc', '.stylelintrc.json']);
const PACKAGE_FILES = new Set(['podfile']);

const KNOWN_EXTENSIONS = new Set([
  'ics',
  'lock',
  'md',
  'markdown',
  ...Object.keys(MATERIAL_EXTENSION_ICONS),
  ...ARCHIVE_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ...BOOK_EXTENSIONS,
  ...CODE_EXTENSIONS,
  ...CONFIG_EXTENSIONS,
  ...DATABASE_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS,
  ...FONT_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...INSTALLER_EXTENSIONS,
  ...JSON_EXTENSIONS,
  ...MODEL_EXTENSIONS,
  ...PALETTE_EXTENSIONS,
  ...SPREADSHEET_EXTENSIONS,
  ...TERMINAL_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
]);

/** Whether this basename or extension is a file identity the icon system recognizes. The chat
 * renderer uses it as path evidence: a bare token chips only when it would also get a
 * non-generic file icon, so prose like `origin/main` or `foo.bar` never chips. */
export function hasKnownFileIdentity(name: string): boolean {
  const basename = fileBasename(name).toLowerCase();
  if (iconForFileName(basename) !== undefined) return true;
  for (const [compoundExtension] of MATERIAL_COMPOUND_EXTENSION_ENTRIES) {
    if (basename.endsWith(`.${compoundExtension}`)) return true;
  }
  return KNOWN_EXTENSIONS.has(fileExtension(basename));
}

export interface FileIconInput {
  kind?: string;
  mimeType?: string;
  name: string;
}

export function fileIconFor({ kind, mimeType, name }: FileIconInput): FileIconComponent {
  if (kind === 'directory') return FolderIcon;
  if (kind === 'url') return GlobeIcon;

  const basename = fileBasename(name).toLowerCase();
  const extension = fileExtension(basename);
  const normalizedMimeType = mimeType?.toLowerCase();

  const fileNameIcon = iconForFileName(basename);
  if (fileNameIcon) return fileNameIcon;

  for (const [compoundExtension, icon] of MATERIAL_COMPOUND_EXTENSION_ENTRIES) {
    if (icon && basename.endsWith(`.${compoundExtension}`)) return icon;
  }

  const extensionIcon = MATERIAL_EXTENSION_ICONS[extension];
  if (extensionIcon) return extensionIcon;

  const semanticIcon = iconForSemanticHint(kind, normalizedMimeType);
  if (semanticIcon) return semanticIcon;

  return lucideIconForExtension(extension, kind);
}

function iconForFileName(basename: string): FileIconComponent | undefined {
  const materialIcon = MATERIAL_FILE_NAME_ICONS[basename];
  if (materialIcon) return materialIcon;

  for (const [prefix, icon] of MATERIAL_FILE_NAME_PREFIX_ICONS) {
    if (basename.startsWith(prefix)) return icon;
  }

  if (basename === '.envrc' || basename === '.env' || basename.startsWith('.env.')) {
    return FileKey2Icon;
  }
  if (basename.endsWith('-lock.json')) return FileLock2Icon;
  if (BUILD_FILES.has(basename)) return HammerIcon;
  if (PACKAGE_FILES.has(basename)) return PackageIcon;
  if (
    CONFIG_FILES.has(basename) ||
    basename.includes('.config.') ||
    (basename[0] === '.' && (basename.endsWith('rc') || basename.includes('rc.')))
  ) {
    return FileCogIcon;
  }
  return undefined;
}

function iconForSemanticHint(
  kind: string | undefined,
  mimeType: string | undefined,
): FileIconComponent | undefined {
  // A staged attachment classified as a generic file is not a supported visual preview.
  if (kind === 'file' && mimeType?.startsWith('image/')) return FileIcon;
  if (kind === 'image') return FileImageIcon;
  if (kind === 'audio') return FileAudioIcon;
  if (kind === 'video') return FileVideoIcon;
  if (kind === 'pdf') return MATERIAL_EXTENSION_ICONS.pdf;

  if (mimeType === 'application/pdf') return MATERIAL_EXTENSION_ICONS.pdf;
  if (mimeType === 'application/msword' || mimeType?.includes('wordprocessingml')) {
    return MATERIAL_EXTENSION_ICONS.doc;
  }
  if (mimeType === 'application/vnd.ms-powerpoint' || mimeType?.includes('presentationml')) {
    return MATERIAL_EXTENSION_ICONS.ppt;
  }
  if (mimeType?.includes('json')) return FileJson2Icon;
  if (mimeType === 'text/markdown') return MATERIAL_EXTENSION_ICONS.md;
  if (mimeType === 'text/html') return MATERIAL_EXTENSION_ICONS.html;
  if (mimeType === 'text/css') return MATERIAL_EXTENSION_ICONS.css;
  if (mimeType === 'application/xml' || mimeType === 'text/xml') {
    return MATERIAL_EXTENSION_ICONS.xml;
  }
  if (mimeType === 'application/yaml' || mimeType === 'text/yaml') {
    return FileCogIcon;
  }
  if (mimeType?.startsWith('audio/')) return FileAudioIcon;
  if (mimeType?.startsWith('video/')) return FileVideoIcon;
  if (mimeType?.startsWith('image/')) return FileImageIcon;
  if (mimeType?.startsWith('font/')) return TypeIcon;
  if (mimeType?.startsWith('model/')) return BoxIcon;
  if (mimeType?.includes('spreadsheet')) return FileSpreadsheetIcon;
  if (mimeType?.includes('zip') || mimeType?.includes('compressed')) return FileArchiveIcon;
  if (mimeType?.startsWith('text/')) return FileTextIcon;
  if (kind === 'document') return FileTextIcon;
  return undefined;
}

function lucideIconForExtension(extension: string, kind: string | undefined): LucideIcon {
  if (extension === 'lock') return FileLock2Icon;
  if (ARCHIVE_EXTENSIONS.has(extension)) return FileArchiveIcon;
  if (AUDIO_EXTENSIONS.has(extension)) return FileAudioIcon;
  if (BOOK_EXTENSIONS.has(extension)) return BookOpenIcon;
  if (CODE_EXTENSIONS.has(extension)) return FileCode2Icon;
  if (CONFIG_EXTENSIONS.has(extension)) return FileCogIcon;
  if (DATABASE_EXTENSIONS.has(extension)) return DatabaseIcon;
  if (DOCUMENT_EXTENSIONS.has(extension)) return FileTextIcon;
  if (FONT_EXTENSIONS.has(extension)) return TypeIcon;
  if (IMAGE_EXTENSIONS.has(extension)) return kind === 'file' ? FileIcon : FileImageIcon;
  if (INSTALLER_EXTENSIONS.has(extension)) return PackageIcon;
  if (JSON_EXTENSIONS.has(extension)) return FileJson2Icon;
  if (MODEL_EXTENSIONS.has(extension)) return BoxIcon;
  if (PALETTE_EXTENSIONS.has(extension)) return PaletteIcon;
  if (extension === 'ics') return CalendarIcon;
  if (SPREADSHEET_EXTENSIONS.has(extension)) return FileSpreadsheetIcon;
  if (TERMINAL_EXTENSIONS.has(extension)) return SquareTerminalIcon;
  if (VIDEO_EXTENSIONS.has(extension)) return FileVideoIcon;
  return FileIcon;
}

function fileBasename(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash === -1 ? path : path.slice(slash + 1);
}

function fileExtension(basename: string): string {
  const dot = basename.lastIndexOf('.');
  return dot > 0 && dot < basename.length - 1 ? basename.slice(dot + 1) : '';
}
