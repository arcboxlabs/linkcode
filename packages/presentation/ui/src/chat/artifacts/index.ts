export { ArtifactHostActionsProvider } from './context';
export { ArtifactFenceRenderer } from './fence-renderer';
export { FileArtifactCard } from './file-card';
export { artifactKindForPath, fileBasename } from './file-kind';
export type { ArtifactHostActions } from './host-actions';
export { useArtifactHostActions } from './host-actions';
export type { ResolvedInlineArtifact } from './registry';
export { getArtifactKind, registerArtifactDetector, registerArtifactKind } from './registry';
export type {
  ArtifactCapabilities,
  ArtifactKindDefinition,
  ArtifactSyntaxDetector,
  FencedBlock,
  InlineArtifact,
  InlineArtifactProps,
} from './types';
