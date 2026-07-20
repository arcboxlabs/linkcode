/** Capability bits per artifact kind. P1 consumes `inlineCapable` only; the panel viewer
 * (CODE-61), sandboxed hosting (CODE-62), and interaction bridge (CODE-64) read the rest. */
export interface ArtifactCapabilities {
  /** Renders directly inside the conversation flow. */
  inlineCapable: boolean;
  /** Can open in the right-panel artifact viewer. */
  panelCapable: boolean;
  /** Must render inside the sandboxed per-artifact origin served by the daemon. */
  sandboxRequired: boolean;
  /** Emits user interactions back to the host (e.g. click-to-composer). */
  interactive: boolean;
}

/** A fenced code block as Streamdown hands it to custom renderers. */
export interface FencedBlock {
  language: string;
  code: string;
  meta?: string;
  /** The closing fence has not streamed in yet. */
  isIncomplete: boolean;
}

/** View-model slice of the project-wide Artifact contract. P1 only produces inline sources;
 * file/url sources arrive with the panel viewer and sandbox hosting. */
export interface InlineArtifact {
  kind: string;
  title?: string;
  source: { type: 'inline'; language: string; text: string };
  /** Which detector produced this artifact. */
  detectorId: string;
}

export interface InlineArtifactProps {
  artifact: InlineArtifact;
  /** The source is still streaming; renderers show progressive or last-good output. */
  isIncomplete: boolean;
}

export interface ArtifactKindDefinition {
  id: string;
  capabilities: ArtifactCapabilities;
  /** Fence languages the baseline detector maps to this kind. */
  fenceLanguages: readonly string[];
  /** Inline renderer; required when `capabilities.inlineCapable`. */
  Inline?: React.ComponentType<InlineArtifactProps>;
}

/** Pluggable syntax detector. Vendor detectors (e.g. `<antArtifact>` tags, CODE-64) register
 * through the same interface and take precedence; the rendering layer never sees the syntax. */
export interface ArtifactSyntaxDetector {
  id: string;
  /** Return the normalized artifact for a fence this detector recognizes, or null to pass. */
  detectFence: (block: FencedBlock) => InlineArtifact | null;
}
