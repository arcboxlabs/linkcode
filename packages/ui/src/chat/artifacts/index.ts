export type { ArtifactHostActions } from './context';
export { ArtifactHostActionsProvider, useArtifactHostActions } from './context';
export { ArtifactFenceRenderer } from './fence-renderer';
export { FileArtifactCard } from './file-card';
export { artifactKindForPath, detectInlineFilePath, fileBasename } from './file-kind';
export type { ResolvedInlineArtifact } from './registry';
export {
  artifactFenceLanguages,
  getArtifactKind,
  registerArtifactDetector,
  registerArtifactKind,
} from './registry';
export type {
  ArtifactCapabilities,
  ArtifactKindDefinition,
  ArtifactSyntaxDetector,
  FencedBlock,
  InlineArtifact,
  InlineArtifactProps,
} from './types';
